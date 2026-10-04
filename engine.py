import asyncio
import json
import logging
import time
from collections import deque
from datetime import datetime
from typing import Dict, List, Optional, Set
import aiohttp
import websockets

logger = logging.getLogger("CryptoEngine")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

STABLE_COINS = {
    'USDCUSDT', 'FDUSDUSDT', 'EURUSDT', 'TUSDUSDT', 'USDPUSDT', 
    'AEURUSDT', 'BUSDUSDT', 'DAIUSDT', 'WBTCUSDT', 'USDSUSDT', 
    'EURIUSDT', 'USDEUSDT', 'USDDUSDT'
}

class CryptoSurgeEngine:
    def __init__(self, top_n_track: int = 250):
        self.top_n_track = top_n_track
        self.symbols_info: Dict[str, dict] = {}
        # symbol -> deque of (timestamp, price, quote_volume)
        self.history: Dict[str, deque] = {}
        # Current aggregated data for all tracked symbols
        self.market_data: Dict[str, dict] = {}
        # Alerts history
        self.alerts: deque = deque(maxlen=200)
        self.alert_cooldown: Dict[str, float] = {}
        
        # State flags
        self.is_running = False
        self.is_ws_connected = False
        self.last_update_ts = 0.0
        self.alert_threshold = 2.0  # default 2% in 5m
        self.min_vol_threshold = 10000.0  # min 10k USDT in 5m for alert
        
        # Callbacks for WebSocket broadcaster
        self.alert_subscribers: List[asyncio.Queue] = []
        self._session: Optional[aiohttp.ClientSession] = None

    async def start(self):
        """Main lifecycle entrypoint"""
        self.is_running = True
        self._session = aiohttp.ClientSession()
        
        logger.info("Initializing market universe and 5m rolling snapshot...")
        await self._init_symbols_and_snapshot()
        
        # Launch background tasks
        asyncio.create_task(self._ws_loop())
        asyncio.create_task(self._periodic_resync_loop())

    async def stop(self):
        self.is_running = False
        if self._session and not self._session.closed:
            await self._session.close()

    async def _init_symbols_and_snapshot(self):
        """Fetch exchangeInfo, 24hr tickers, and seed initial 5m rolling windows"""
        try:
            # 1. Exchange info for active trading pairs
            async with self._session.get("https://api.binance.com/api/v3/exchangeInfo", timeout=10) as r:
                ex_info = await r.json()
            
            valid_symbols = {
                s['symbol']: s for s in ex_info['symbols']
                if s['quoteAsset'] == 'USDT' 
                and s['status'] == 'TRADING' 
                and s['isSpotTradingAllowed']
                and s['symbol'].isascii() 
                and s['symbol'].isalnum()
                and s['symbol'] not in STABLE_COINS
            }

            # 2. 24hr tickers to sort by liquidity
            async with self._session.get("https://api.binance.com/api/v3/ticker/24hr", timeout=10) as r:
                tickers_24h = await r.json()

            active_tickers = [t for t in tickers_24h if t['symbol'] in valid_symbols]
            active_tickers.sort(key=lambda x: float(x['quoteVolume']), reverse=True)

            # Track top N most liquid pairs
            tracked_tickers = active_tickers[:self.top_n_track]
            tracked_symbols = [t['symbol'] for t in tracked_tickers]
            
            vol_24h_map = {t['symbol']: float(t['quoteVolume']) for t in tracked_tickers}
            chg_24h_map = {t['symbol']: float(t['priceChangePercent']) for t in tracked_tickers}

            # 3. Seed 5m rolling windows via batch REST calls (100 symbols per batch)
            now = time.time()
            seeded_count = 0
            
            for i in range(0, len(tracked_symbols), 100):
                batch = tracked_symbols[i:i+100]
                param = json.dumps(batch, separators=(',', ':'))
                url = f"https://api.binance.com/api/v3/ticker?symbols={param}&windowSize=5m"
                try:
                    async with self._session.get(url, timeout=10) as r:
                        if r.status == 200:
                            data_5m = await r.json()
                            for item in data_5m:
                                s = item['symbol']
                                last_p = float(item['lastPrice'])
                                open_p = float(item['openPrice'])
                                vol_5m = float(item['quoteVolume'])
                                high_5m = float(item['highPrice'])
                                low_5m = float(item['lowPrice'])
                                qvol_24h = vol_24h_map.get(s, vol_5m)
                                
                                # Expected average 5m volume = 24h volume / 288
                                avg_5m_vol = qvol_24h / 288.0
                                vol_spike = vol_5m / max(avg_5m_vol, 1.0)
                                
                                dq = deque(maxlen=700)
                                # 5 minutes ago checkpoint
                                dq.append((now - 300, open_p, max(0.0, qvol_24h - vol_5m)))
                                # Current checkpoint
                                dq.append((now, last_p, qvol_24h))
                                self.history[s] = dq

                                pct_5m = float(item['priceChangePercent'])
                                self.market_data[s] = {
                                    'symbol': s,
                                    'base_asset': s.replace('USDT', ''),
                                    'last_price': last_p,
                                    'high_5m': high_5m,
                                    'low_5m': low_5m,
                                    'price_chg_5m': pct_5m,
                                    'price_chg_1m': 0.0,
                                    'price_chg_15m': pct_5m,
                                    'price_chg_24h': chg_24h_map.get(s, 0.0),
                                    'vol_5m': vol_5m,
                                    'vol_24h': qvol_24h,
                                    'vol_spike': round(vol_spike, 2),
                                    'surge_score': round(pct_5m * 0.7 + min(vol_spike, 10.0) * 0.3, 2),
                                    'trades_5m': int(item.get('count', 0)),
                                    'sparkline': [open_p, (open_p + last_p)/2, last_p],
                                    'updated_at': now
                                }
                                seeded_count += 1
                except Exception as ex:
                    logger.warning(f"Error seeding batch {i}: {ex}")

            self.last_update_ts = now
            logger.info(f"Initialized {seeded_count} symbols with instant 5m history!")
        except Exception as e:
            logger.error(f"Failed to initialize snapshot: {e}", exc_info=True)

    async def _ws_loop(self):
        """Binance spot miniTicker array WebSocket stream"""
        ws_url = "wss://stream.binance.com:9443/ws/!miniTicker@arr"
        
        while self.is_running:
            try:
                logger.info(f"Connecting to Binance WebSocket: {ws_url}")
                async with websockets.connect(
                    ws_url, 
                    ping_interval=20, 
                    ping_timeout=20, 
                    max_size=10_000_000
                ) as ws:
                    self.is_ws_connected = True
                    logger.info("Connected to Binance Spot WebSocket stream.")
                    
                    async for message in ws:
                        if not self.is_running:
                            break
                        now = time.time()
                        data = json.loads(message)
                        self._process_mini_tickers(data, now)
                        self.last_update_ts = now
            except Exception as e:
                self.is_ws_connected = False
                logger.warning(f"WebSocket disconnected ({e}). Reconnecting in 3 seconds...")
                await asyncio.sleep(3)

    def _process_mini_tickers(self, tickers: list, now: float):
        """Process incoming 1000ms miniTickers and update rolling stats"""
        for t in tickers:
            symbol = t.get('s')
            if not symbol or symbol not in self.market_data:
                continue
            
            try:
                last_price = float(t['c'])
                quote_vol_24h = float(t['q'])
            except (ValueError, KeyError):
                continue
            
            dq = self.history.get(symbol)
            if dq is None:
                dq = deque(maxlen=700)
                self.history[symbol] = dq
            
            dq.append((now, last_price, quote_vol_24h))

            # Calculate 1m, 5m, 15m rolling changes
            p_1m, v_1m = self._get_checkpoint_data(dq, now - 60)
            p_5m, v_5m = self._get_checkpoint_data(dq, now - 300)
            p_15m, v_15m = self._get_checkpoint_data(dq, now - 900)

            chg_1m = ((last_price - p_1m) / p_1m * 100) if p_1m > 0 else 0.0
            chg_5m = ((last_price - p_5m) / p_5m * 100) if p_5m > 0 else 0.0
            chg_15m = ((last_price - p_15m) / p_15m * 100) if p_15m > 0 else 0.0

            vol_5m = max(0.0, quote_vol_24h - v_5m)
            avg_5m_vol = quote_vol_24h / 288.0
            vol_spike = vol_5m / max(avg_5m_vol, 1.0)
            surge_score = round(chg_5m * 0.7 + min(vol_spike, 10.0) * 0.3, 2)

            # High and Low in the 5m window
            recent_prices = [p for ts, p, _ in dq if ts >= now - 300]
            high_5m = max(recent_prices) if recent_prices else last_price
            low_5m = min(recent_prices) if recent_prices else last_price

            # Compact sparkline: 12 sampled points across the available history
            sparkline = self._sample_sparkline(dq, count=12)

            item = self.market_data[symbol]
            item.update({
                'last_price': last_price,
                'high_5m': high_5m,
                'low_5m': low_5m,
                'price_chg_1m': round(chg_1m, 2),
                'price_chg_5m': round(chg_5m, 2),
                'price_chg_15m': round(chg_15m, 2),
                'vol_5m': round(vol_5m, 1),
                'vol_24h': round(quote_vol_24h, 1),
                'vol_spike': round(vol_spike, 2),
                'surge_score': surge_score,
                'sparkline': sparkline,
                'updated_at': now
            })

            # Check pump / dump alert triggers
            self._check_alert(item, now)

    def _get_checkpoint_data(self, dq: deque, target_ts: float):
        """Find the closest (ts, price, quote_vol) to target_ts in the deque"""
        if not dq:
            return 0.0, 0.0
        
        # If target_ts is older than our oldest checkpoint, return the oldest
        if target_ts <= dq[0][0]:
            return dq[0][1], dq[0][2]
        
        # Traverse from newest to oldest to find closest timestamp <= target_ts
        closest = dq[0]
        for ts, p, v in dq:
            if ts <= target_ts:
                closest = (ts, p, v)
            else:
                break
        return closest[1], closest[2]

    def _sample_sparkline(self, dq: deque, count: int = 12) -> list:
        """Sample equidistant prices from the deque for smooth rendering"""
        if not dq:
            return []
        if len(dq) <= count:
            return [round(p, 6) for _, p, _ in dq]
        step = len(dq) / count
        return [round(dq[int(i * step)][1], 6) for i in range(count)]

    def _check_alert(self, coin: dict, now: float):
        """Trigger pump alert if conditions are met with cooldown"""
        s = coin['symbol']
        chg_5m = coin['price_chg_5m']
        vol_5m = coin['vol_5m']
        vol_spike = coin['vol_spike']

        # Alert condition: 5m gain exceeds threshold, min volume met, and volume spike >= 1.5x
        if chg_5m >= self.alert_threshold and vol_5m >= self.min_vol_threshold and vol_spike >= 1.2:
            last_alert_time = self.alert_cooldown.get(s, 0.0)
            # 2.5 minutes cooldown per coin
            if now - last_alert_time > 150:
                self.alert_cooldown[s] = now
                alert = {
                    'id': f"{s}_{int(now)}",
                    'timestamp': datetime.fromtimestamp(now).strftime("%H:%M:%S"),
                    'ts_epoch': now,
                    'symbol': s,
                    'base_asset': coin['base_asset'],
                    'price': coin['last_price'],
                    'price_chg_5m': chg_5m,
                    'price_chg_1m': coin['price_chg_1m'],
                    'vol_5m': vol_5m,
                    'vol_spike': vol_spike,
                    'type': 'PUMP' if chg_5m > 0 else 'DUMP'
                }
                self.alerts.appendleft(alert)
                logger.info(f"🚨 ALERT [{alert['type']}]: {s} +{chg_5m:.2f}% (5m) | 5m Vol: {vol_5m/1e3:.1f}k USDT | Spike: {vol_spike}x")
                
                # Push to all alert subscribers
                for q in self.alert_subscribers:
                    try:
                        q.put_nowait(alert)
                    except asyncio.QueueFull:
                        pass

    async def _periodic_resync_loop(self):
        """Every 90s, update 24h volumes & check for fresh coins"""
        while self.is_running:
            await asyncio.sleep(90)
            try:
                async with self._session.get("https://api.binance.com/api/v3/ticker/24hr", timeout=10) as r:
                    tickers = await r.json()
                for t in tickers:
                    s = t['symbol']
                    if s in self.market_data:
                        self.market_data[s]['price_chg_24h'] = float(t['priceChangePercent'])
            except Exception as e:
                logger.debug(f"Periodic resync error: {e}")

    def get_top_gainers_5m(self, limit: int = 50, min_vol: float = 0.0) -> List[dict]:
        """Get top gainers in the last 5 minutes with optional volume filter"""
        coins = [
            c for c in self.market_data.values() 
            if c['vol_5m'] >= min_vol
        ]
        coins.sort(key=lambda x: x['price_chg_5m'], reverse=True)
        return coins[:limit]

    def get_top_volume_spikes(self, limit: int = 20, min_vol: float = 5000.0) -> List[dict]:
        """Get coins with the highest volume surge ratio in the last 5 minutes"""
        coins = [
            c for c in self.market_data.values() 
            if c['vol_5m'] >= min_vol and c['price_chg_5m'] > 0
        ]
        coins.sort(key=lambda x: x['vol_spike'], reverse=True)
        return coins[:limit]

    def get_market_overview(self) -> dict:
        """Market breadth and sentiment statistics"""
        all_coins = list(self.market_data.values())
        if not all_coins:
            return {}
        
        gaining_5m = sum(1 for c in all_coins if c['price_chg_5m'] > 0)
        losing_5m = sum(1 for c in all_coins if c['price_chg_5m'] < 0)
        neutral_5m = len(all_coins) - gaining_5m - losing_5m
        
        total_5m_vol = sum(c['vol_5m'] for c in all_coins)
        top_gainer = max(all_coins, key=lambda x: x['price_chg_5m'], default=None)
        top_spike = max(all_coins, key=lambda x: x['vol_spike'], default=None)

        return {
            'total_tracked': len(all_coins),
            'gaining_5m': gaining_5m,
            'losing_5m': losing_5m,
            'neutral_5m': neutral_5m,
            'bull_ratio': round(gaining_5m / max(len(all_coins), 1) * 100, 1),
            'total_5m_volume_usdt': round(total_5m_vol, 0),
            'top_gainer': top_gainer,
            'top_spike': top_spike,
            'is_ws_connected': self.is_ws_connected,
            'last_update_ts': self.last_update_ts
        }

    def subscribe_alerts(self) -> asyncio.Queue:
        q = asyncio.Queue(maxsize=50)
        self.alert_subscribers.append(q)
        return q

    def unsubscribe_alerts(self, q: asyncio.Queue):
        if q in self.alert_subscribers:
            self.alert_subscribers.remove(q)
