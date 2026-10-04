/**
 * CYBERPUMP 5M - Dual Mode Real-time Engine
 * Supports both Local FastAPI WebSocket Mode and Pure Client-side GitHub Pages Mode (Direct Binance WS/REST)
 */

(function () {
  'use strict';

  const STABLE_COINS = new Set([
    'USDCUSDT', 'FDUSDUSDT', 'EURUSDT', 'TUSDUSDT', 'USDPUSDT', 
    'AEURUSDT', 'BUSDUSDT', 'DAIUSDT', 'WBTCUSDT', 'USDSUSDT', 
    'EURIUSDT', 'USDEUSDT', 'USDDUSDT'
  ]);

  // State Management
  const state = {
    ws: null,
    wsConnected: false,
    isDirectMode: false,
    soundEnabled: true,
    alertThreshold: 2.0,
    minVolume: 10000,
    searchQuery: '',
    currentSort: 'price_chg_5m',
    viewMode: 'table',
    marketData: {}, // symbol -> coin
    historyBuffers: {}, // symbol -> array of { ts, price, quote_vol }
    alertsList: [],
    alertCooldown: {},
    previousPrices: {},
    audioCtx: null
  };

  // DOM Elements
  const el = {
    wsStatusBadge: document.getElementById('ws-status-badge'),
    wsStatusText: document.getElementById('ws-status-text'),
    wsPingBadge: document.getElementById('ws-ping-badge'),
    btnSoundToggle: document.getElementById('btn-sound-toggle'),
    soundIcon: document.getElementById('sound-icon'),
    soundLabel: document.getElementById('sound-label'),
    thresholdSelect: document.getElementById('threshold-select'),
    viewTableBtn: document.getElementById('view-table-btn'),
    viewCardsBtn: document.getElementById('view-cards-btn'),
    tableContainer: document.getElementById('table-container'),
    cardsContainer: document.getElementById('cards-container'),
    cryptoTbody: document.getElementById('crypto-tbody'),
    radarFeed: document.getElementById('radar-feed'),
    radarAlertCount: document.getElementById('radar-alert-count'),
    radarEmptyState: document.getElementById('radar-empty-state'),
    radarThresholdVal: document.getElementById('radar-threshold-val'),
    symbolSearch: document.getElementById('symbol-search'),
    clearSearch: document.getElementById('clear-search'),
    minVolFilter: document.getElementById('min-vol-filter'),
    sortTabs: document.getElementById('sort-tabs'),
    
    // Overview Cards
    topGainerSymbol: document.getElementById('top-gainer-symbol'),
    topGainerPrice: document.getElementById('top-gainer-price'),
    topGainerGain: document.getElementById('top-gainer-gain'),
    topGainerVol: document.getElementById('top-gainer-vol'),
    topSpikeSymbol: document.getElementById('top-spike-symbol'),
    topSpikeMultiple: document.getElementById('top-spike-multiple'),
    topSpikeGain: document.getElementById('top-spike-gain'),
    topSpikeVol: document.getElementById('top-spike-vol'),
    bullCount: document.getElementById('bull-count'),
    bearCount: document.getElementById('bear-count'),
    bullPct: document.getElementById('bull-pct'),
    sentimentBar: document.getElementById('sentiment-bar'),
    sentimentTag: document.getElementById('sentiment-tag'),
    totalTrackedCoins: document.getElementById('total-tracked-coins'),
    total5mVol: document.getElementById('total-5m-vol'),

    // Modal
    coinModal: document.getElementById('coin-modal'),
    modalClose: document.getElementById('modal-close'),
    modalSymbol: document.getElementById('modal-symbol'),
    modalPrice: document.getElementById('modal-price'),
    modalGain5m: document.getElementById('modal-gain-5m'),
    modalSpike: document.getElementById('modal-spike'),
    modalChg1m: document.getElementById('modal-chg-1m'),
    modalChg15m: document.getElementById('modal-chg-15m'),
    modalChg24h: document.getElementById('modal-chg-24h'),
    modalVol5m: document.getElementById('modal-vol-5m'),
    modalVol24h: document.getElementById('modal-vol-24h'),
    modalSurgeScore: document.getElementById('modal-surge-score'),
    modalChartRange: document.getElementById('modal-chart-range'),
    modalCanvas: document.getElementById('modal-canvas'),
    modalBinanceLink: document.getElementById('modal-binance-link'),
    modalTvLink: document.getElementById('modal-tv-link')
  };

  // --- Web Audio API Chime Synthesizer ---
  function initAudio() {
    if (!state.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) state.audioCtx = new AudioContext();
    }
    if (state.audioCtx && state.audioCtx.state === 'suspended') {
      state.audioCtx.resume();
    }
  }

  function playPumpChime() {
    if (!state.soundEnabled) return;
    try {
      initAudio();
      if (!state.audioCtx) return;

      const now = state.audioCtx.currentTime;
      const osc = state.audioCtx.createOscillator();
      const gain = state.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(state.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch (e) {
      console.warn('Audio playback error:', e);
    }
  }

  // --- Feed Mode Determination ---
  function initDataFeed() {
    const isLocalhost = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';

    if (isLocalhost && window.location.port === '8000') {
      // Connect to local Python FastAPI WebSocket
      connectLocalWebSocket();
    } else {
      // Running on GitHub Pages or static host: Connect DIRECTLY to Binance!
      state.isDirectMode = true;
      connectDirectBinance();
    }
  }

  // --- Mode A: Local Python Server WebSocket ---
  function connectLocalWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    updateStatusUI(false, '正在連線至本地即時流...');

    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => {
      state.wsConnected = true;
      updateStatusUI(true, '本地服務 + 幣安長連接 (1000ms TICK)');
    };

    state.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const rtt = Math.max(1, Math.round(Date.now() - (msg.ts * 1000 || Date.now())));
        el.wsPingBadge.textContent = `${Math.min(rtt, 120)} ms`;

        if (msg.type === 'TICK') {
          if (msg.overview) updateOverviewUI(msg.overview);
          if (msg.top_5m && Array.isArray(msg.top_5m)) {
            msg.top_5m.forEach(coin => {
              state.marketData[coin.symbol] = coin;
              // store sparkline
              if (coin.sparkline) {
                state.historyBuffers[coin.symbol] = coin.sparkline.map((p, i) => ({
                  ts: Date.now() - (coin.sparkline.length - i) * 20000,
                  price: p
                }));
              }
            });
          }
          renderMarket();
        } else if (msg.type === 'ALERT') {
          handleAlert(msg.data);
        }
      } catch (err) {
        console.error('Error handling WS message:', err);
      }
    };

    state.ws.onclose = () => {
      state.wsConnected = false;
      updateStatusUI(false, '切換至幣安官方瀏覽器直連模式...');
      setTimeout(() => {
        state.isDirectMode = true;
        connectDirectBinance();
      }, 1500);
    };

    state.ws.onerror = (err) => {
      console.warn('Local WS error, falling back to direct mode:', err);
      state.ws.close();
    };
  }

  // --- Mode B: Pure Client-Side Mode (Direct Binance API & WebSocket for GitHub Pages) ---
  async function connectDirectBinance() {
    updateStatusUI(false, '正在直連幣安官方撮合數據...');
    el.wsPingBadge.textContent = 'REST INIT';

    try {
      // 1. Fetch 24hr tickers to sort liquid pairs
      const res24h = await fetch('https://api.binance.com/api/v3/ticker/24hr');
      const tickers24h = await res24h.json();

      const usdtPairs = tickers24h.filter(t => 
        t.symbol.endsWith('USDT') && 
        !STABLE_COINS.has(t.symbol) &&
        /^[A-Z0-9]+$/.test(t.symbol)
      );

      usdtPairs.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
      const topPairs = usdtPairs.slice(0, 150);
      const topSymbols = topPairs.map(t => t.symbol);
      const vol24hMap = {};
      const chg24hMap = {};
      topPairs.forEach(t => {
        vol24hMap[t.symbol] = parseFloat(t.quoteVolume);
        chg24hMap[t.symbol] = parseFloat(t.priceChangePercent);
      });

      // 2. Fetch rolling 5m seed snapshot in batches of 75
      const now = Date.now() / 1000;
      for (let i = 0; i < Math.min(topSymbols.length, 150); i += 75) {
        const batch = topSymbols.slice(i, i + 75);
        const param = encodeURIComponent(JSON.stringify(batch));
        const url = `https://api.binance.com/api/v3/ticker?symbols=${param}&windowSize=5m`;
        try {
          const res5m = await fetch(url);
          if (res5m.ok) {
            const data5m = await res5m.json();
            data5m.forEach(item => {
              const s = item.symbol;
              const last_p = parseFloat(item.lastPrice);
              const open_p = parseFloat(item.openPrice);
              const vol_5m = parseFloat(item.quoteVolume);
              const qvol_24h = vol24hMap[s] || vol_5m;
              const avg_5m_vol = qvol_24h / 288.0;
              const vol_spike = vol_5m / Math.max(avg_5m_vol, 1.0);
              const pct_5m = parseFloat(item.priceChangePercent);

              // Initialize buffer with 5m ago checkpoint and current checkpoint
              state.historyBuffers[s] = [
                { ts: now - 300, price: open_p, quote_vol: Math.max(0, qvol_24h - vol_5m) },
                { ts: now, price: last_p, quote_vol: qvol_24h }
              ];

              state.marketData[s] = {
                symbol: s,
                base_asset: s.replace('USDT', ''),
                last_price: last_p,
                high_5m: parseFloat(item.highPrice),
                low_5m: parseFloat(item.lowPrice),
                price_chg_5m: pct_5m,
                price_chg_1m: 0.0,
                price_chg_15m: pct_5m,
                price_chg_24h: chg24hMap[s] || 0.0,
                vol_5m: vol_5m,
                vol_24h: qvol_24h,
                vol_spike: parseFloat(vol_spike.toFixed(2)),
                surge_score: parseFloat((pct_5m * 0.7 + Math.min(vol_spike, 10) * 0.3).toFixed(2)),
                sparkline: [open_p, (open_p + last_p)/2, last_p],
                updated_at: now
              };
            });
          }
        } catch (e) {
          console.warn('Batch 5m fetch error:', e);
        }
      }

      computeAndRenderClientSide();

      // 3. Connect to Binance official WebSocket stream
      const binanceWsUrl = 'wss://stream.binance.com:9443/ws/!miniTicker@arr';
      state.ws = new WebSocket(binanceWsUrl);

      state.ws.onopen = () => {
        state.wsConnected = true;
        updateStatusUI(true, '幣安官方即時長連接 (GitHub Pages 直連)');
      };

      let lastPingCheck = Date.now();
      state.ws.onmessage = (event) => {
        const t0 = Date.now();
        if (t0 - lastPingCheck > 2000) {
          el.wsPingBadge.textContent = 'ONLINE';
          lastPingCheck = t0;
        }

        try {
          const tickers = JSON.parse(event.data);
          processDirectTickers(tickers);
        } catch (err) {
          console.error('WS parse error:', err);
        }
      };

      state.ws.onclose = () => {
        state.wsConnected = false;
        updateStatusUI(false, '幣安連線斷開，3秒後自動重連...');
        setTimeout(connectDirectBinance, 3000);
      };

      state.ws.onerror = (err) => {
        console.warn('Binance WS error:', err);
        state.ws.close();
      };

    } catch (err) {
      console.error('Failed to init Direct Binance Feed:', err);
      updateStatusUI(false, '連線異常，正在重試...');
      setTimeout(connectDirectBinance, 4000);
    }
  }

  function processDirectTickers(tickers) {
    const now = Date.now() / 1000;

    tickers.forEach(t => {
      const s = t.s;
      if (!s || !state.marketData[s]) return;

      const lastPrice = parseFloat(t.c);
      const quoteVol24h = parseFloat(t.q);

      let buf = state.historyBuffers[s];
      if (!buf) {
        buf = [];
        state.historyBuffers[s] = buf;
      }

      buf.push({ ts: now, price: lastPrice, quote_vol: quoteVol24h });
      if (buf.length > 500) buf.shift();

      // Calculate 1m, 5m, 15m changes from buffer
      const p1m = getBufferCheckpoint(buf, now - 60);
      const p5m = getBufferCheckpoint(buf, now - 300);
      const p15m = getBufferCheckpoint(buf, now - 900);

      const chg1m = p1m.price > 0 ? ((lastPrice - p1m.price) / p1m.price * 100) : 0;
      const chg5m = p5m.price > 0 ? ((lastPrice - p5m.price) / p5m.price * 100) : 0;
      const chg15m = p15m.price > 0 ? ((lastPrice - p15m.price) / p15m.price * 100) : 0;

      const vol5m = Math.max(0, quoteVol24h - p5m.quote_vol);
      const avg5mVol = quoteVol24h / 288.0;
      const volSpike = vol5m / Math.max(avg5mVol, 1.0);
      const surgeScore = parseFloat((chg5m * 0.7 + Math.min(volSpike, 10.0) * 0.3).toFixed(2));

      // 5m High and Low
      const recent = buf.filter(b => b.ts >= now - 300);
      const high5m = recent.length ? Math.max(...recent.map(r => r.price)) : lastPrice;
      const low5m = recent.length ? Math.min(...recent.map(r => r.price)) : lastPrice;

      // Sample sparkline
      const sparkline = sampleSparkline(buf, 12);

      const coin = state.marketData[s];
      coin.last_price = lastPrice;
      coin.high_5m = high5m;
      coin.low_5m = low5m;
      coin.price_chg_1m = parseFloat(chg1m.toFixed(2));
      coin.price_chg_5m = parseFloat(chg5m.toFixed(2));
      coin.price_chg_15m = parseFloat(chg15m.toFixed(2));
      coin.vol_5m = parseFloat(vol5m.toFixed(1));
      coin.vol_24h = parseFloat(quoteVol24h.toFixed(1));
      coin.vol_spike = parseFloat(volSpike.toFixed(2));
      coin.surge_score = surgeScore;
      coin.sparkline = sparkline;
      coin.updated_at = now;

      // Check pump alert
      checkClientAlert(coin, now);
    });

    computeAndRenderClientSide();
  }

  function getBufferCheckpoint(buf, targetTs) {
    if (!buf || !buf.length) return { price: 0, quote_vol: 0 };
    if (targetTs <= buf[0].ts) return buf[0];
    let closest = buf[0];
    for (let i = 0; i < buf.length; i++) {
      if (buf[i].ts <= targetTs) closest = buf[i];
      else break;
    }
    return closest;
  }

  function sampleSparkline(buf, count = 12) {
    if (!buf || !buf.length) return [];
    if (buf.length <= count) return buf.map(b => b.price);
    const step = buf.length / count;
    const res = [];
    for (let i = 0; i < count; i++) {
      res.push(buf[Math.floor(i * step)].price);
    }
    return res;
  }

  function checkClientAlert(coin, now) {
    if (coin.price_chg_5m >= state.alertThreshold && coin.vol_5m >= state.minVolume && coin.vol_spike >= 1.2) {
      const lastAlert = state.alertCooldown[coin.symbol] || 0;
      if (now - lastAlert > 150) {
        state.alertCooldown[coin.symbol] = now;
        const alert = {
          id: `${coin.symbol}_${Math.floor(now)}`,
          timestamp: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
          symbol: coin.symbol,
          base_asset: coin.base_asset,
          price: coin.last_price,
          price_chg_5m: coin.price_chg_5m,
          vol_5m: coin.vol_5m,
          vol_spike: coin.vol_spike,
          type: 'PUMP'
        };
        handleAlert(alert);
      }
    }
  }

  function computeAndRenderClientSide() {
    const coins = Object.values(state.marketData);
    if (!coins.length) return;

    const gaining = coins.filter(c => c.price_chg_5m > 0).length;
    const losing = coins.filter(c => c.price_chg_5m < 0).length;
    const bullRatio = (gaining / Math.max(coins.length, 1)) * 100;
    const total5mVol = coins.reduce((acc, c) => acc + (c.vol_5m || 0), 0);

    const sortedByGain = [...coins].sort((a, b) => b.price_chg_5m - a.price_chg_5m);
    const sortedBySpike = [...coins].filter(c => c.price_chg_5m > 0).sort((a, b) => b.vol_spike - a.vol_spike);

    const overview = {
      total_tracked: coins.length,
      gaining_5m: gaining,
      losing_5m: losing,
      bull_ratio: parseFloat(bullRatio.toFixed(1)),
      total_5m_volume_usdt: total5mVol,
      top_gainer: sortedByGain[0] || null,
      top_spike: sortedBySpike[0] || null
    };

    updateOverviewUI(overview);
    renderMarket();
  }

  function updateStatusUI(connected, text) {
    if (connected) {
      el.wsStatusBadge.className = 'stream-status';
      el.wsStatusText.textContent = text;
      el.wsStatusBadge.querySelector('.status-dot').style.backgroundColor = 'var(--neon-green)';
    } else {
      el.wsStatusBadge.className = 'stream-status disconnected';
      el.wsStatusText.textContent = text;
      el.wsStatusBadge.querySelector('.status-dot').style.backgroundColor = 'var(--neon-red)';
      el.wsPingBadge.textContent = '--';
    }
  }

  function handleAlert(alert) {
    if (!alert) return;
    state.alertsList.unshift(alert);
    if (state.alertsList.length > 50) state.alertsList.pop();

    playPumpChime();
    renderAlerts();
  }

  // --- Overview UI Updates ---
  function updateOverviewUI(ov) {
    if (!ov) return;

    if (ov.top_gainer) {
      const tg = ov.top_gainer;
      el.topGainerSymbol.textContent = tg.symbol.replace('USDT', '');
      el.topGainerPrice.textContent = `$${formatPrice(tg.last_price)}`;
      el.topGainerGain.textContent = `${tg.price_chg_5m >= 0 ? '+' : ''}${tg.price_chg_5m.toFixed(2)}%`;
      el.topGainerGain.className = `gain-badge-giant ${tg.price_chg_5m >= 0 ? 'positive' : 'negative'}`;
      el.topGainerVol.textContent = `$${formatNumber(tg.vol_5m)}`;
    }

    if (ov.top_spike) {
      const ts = ov.top_spike;
      el.topSpikeSymbol.textContent = ts.symbol.replace('USDT', '');
      el.topSpikeMultiple.textContent = `${ts.vol_spike.toFixed(1)}x`;
      el.topSpikeGain.textContent = `${ts.price_chg_5m >= 0 ? '+' : ''}${ts.price_chg_5m.toFixed(2)}%`;
      el.topSpikeVol.textContent = `$${formatNumber(ts.vol_5m)}`;
    }

    el.bullCount.textContent = ov.gaining_5m || 0;
    el.bearCount.textContent = ov.losing_5m || 0;
    const bullPct = ov.bull_ratio || 50;
    el.bullPct.textContent = `${bullPct.toFixed(1)}%`;
    el.sentimentBar.style.width = `${bullPct}%`;

    if (bullPct >= 60) {
      el.sentimentTag.textContent = '強烈多頭';
      el.sentimentTag.className = 'tag-pill tag-pump';
    } else if (bullPct <= 40) {
      el.sentimentTag.textContent = '空頭主導';
      el.sentimentTag.className = 'tag-pill tag-spike';
    } else {
      el.sentimentTag.textContent = '震盪整理';
      el.sentimentTag.className = 'tag-pill tag-sentiment';
    }

    el.totalTrackedCoins.textContent = ov.total_tracked || 0;
    el.total5mVol.textContent = `$${(ov.total_5m_volume_usdt / 1e6).toFixed(2)} M`;
  }

  // --- Rendering Market List / Table ---
  function renderMarket() {
    let coins = Object.values(state.marketData);

    if (state.searchQuery) {
      const q = state.searchQuery.toUpperCase();
      coins = coins.filter(c => c.symbol.includes(q) || c.base_asset.includes(q));
    }

    if (state.minVolume > 0) {
      coins = coins.filter(c => c.vol_5m >= state.minVolume);
    }

    // 嚴格只保留上漲幣種（5分鐘漲幅 > 0）
    coins = coins.filter(c => c.price_chg_5m > 0);

    coins.sort((a, b) => {
      return (b[state.currentSort] || 0) - (a[state.currentSort] || 0);
    });

    if (state.viewMode === 'table') {
      renderTable(coins.slice(0, 50));
    } else {
      renderCards(coins.slice(0, 36));
    }
  }

  function renderTable(coins) {
    if (!coins.length) {
      el.cryptoTbody.innerHTML = `
        <tr>
          <td colspan="10" class="loading-state">
            <span>無符合目前過濾條件的幣種</span>
          </td>
        </tr>`;
      return;
    }

    const fragment = document.createDocumentFragment();

    coins.forEach((coin, idx) => {
      const tr = document.createElement('tr');
      tr.id = `row-${coin.symbol}`;

      const prevPrice = state.previousPrices[coin.symbol];
      let flashClass = '';
      if (prevPrice !== undefined) {
        if (coin.last_price > prevPrice) flashClass = 'flash-up';
        else if (coin.last_price < prevPrice) flashClass = 'flash-down';
      }
      state.previousPrices[coin.symbol] = coin.last_price;

      const rankNum = idx + 1;
      const rankClass = rankNum === 1 ? 'rank-top-1' : rankNum === 2 ? 'rank-top-2' : rankNum === 3 ? 'rank-top-3' : '';

      const chg5mClass = coin.price_chg_5m >= 0 ? 'positive' : 'negative';
      const chg1mClass = coin.price_chg_1m >= 0 ? 'positive' : 'negative';
      const chg15mClass = coin.price_chg_15m >= 0 ? 'positive' : 'negative';

      const isHotSpike = coin.vol_spike >= 3.0;
      const spikeBadgeClass = isHotSpike ? 'spike-hot' : 'spike-normal';

      const sparkSvg = generateSparklineSvg(coin.sparkline, coin.price_chg_5m >= 0);

      tr.innerHTML = `
        <td class="col-rank ${rankClass}">${rankNum}</td>
        <td class="col-symbol">
          <div class="symbol-cell">
            <div class="token-avatar">${coin.base_asset.slice(0, 3)}</div>
            <div class="token-names">
              <span class="token-symbol">${coin.base_asset}</span>
              <span class="token-pair">/USDT</span>
            </div>
          </div>
        </td>
        <td class="col-price">
          <span class="price-text ${flashClass}">$${formatPrice(coin.last_price)}</span>
        </td>
        <td class="col-chg5m">
          <div class="gain-cell">
            <span class="gain-badge ${chg5mClass}">${coin.price_chg_5m >= 0 ? '+' : ''}${coin.price_chg_5m.toFixed(2)}%</span>
            <div class="gain-mini-bar-bg">
              <div class="gain-mini-bar-fill ${chg5mClass}" style="width: ${Math.min(Math.abs(coin.price_chg_5m) * 15, 100)}%;"></div>
            </div>
          </div>
        </td>
        <td class="col-chg1m">
          <span class="velocity-badge ${chg1mClass}">${coin.price_chg_1m >= 0 ? '▲ +' : '▼ '}${coin.price_chg_1m.toFixed(2)}%</span>
        </td>
        <td class="col-chg15m">
          <span class="velocity-badge ${chg15mClass}">${coin.price_chg_15m >= 0 ? '+' : ''}${coin.price_chg_15m.toFixed(2)}%</span>
        </td>
        <td class="col-vol5m font-mono">
          $${formatNumber(coin.vol_5m)}
        </td>
        <td class="col-spike">
          <span class="spike-badge ${spikeBadgeClass}">
            ${isHotSpike ? '🔥 ' : ''}${coin.vol_spike.toFixed(1)}x
          </span>
        </td>
        <td class="col-spark">
          ${sparkSvg}
        </td>
        <td class="col-actions">
          <div class="action-links">
            <a href="https://www.binance.com/zh-TC/trade/${coin.symbol}?type=spot" target="_blank" class="btn-mini-trade" title="前往幣安交易" onclick="event.stopPropagation();">
              交易
            </a>
          </div>
        </td>
      `;

      tr.addEventListener('click', () => openModal(coin));
      fragment.appendChild(tr);
    });

    el.cryptoTbody.innerHTML = '';
    el.cryptoTbody.appendChild(fragment);
  }

  function renderCards(coins) {
    if (!coins.length) {
      el.cardsContainer.innerHTML = '<div class="loading-state">無符合目前過濾條件的幣種</div>';
      return;
    }

    const fragment = document.createDocumentFragment();

    coins.forEach(coin => {
      const card = document.createElement('div');
      card.className = 'coin-card';
      const chgClass = coin.price_chg_5m >= 0 ? 'positive' : 'negative';
      const sparkSvg = generateSparklineSvg(coin.sparkline, coin.price_chg_5m >= 0, 240, 36);

      card.innerHTML = `
        <div class="card-top-row">
          <span class="card-symbol">${coin.base_asset}<small style="font-size:0.7em;color:var(--text-muted)">/USDT</small></span>
          <span class="card-gain ${chgClass}">${coin.price_chg_5m >= 0 ? '+' : ''}${coin.price_chg_5m.toFixed(2)}%</span>
        </div>
        <div class="card-mid-row">
          <span class="card-price">$${formatPrice(coin.last_price)}</span>
          <span class="spike-badge ${coin.vol_spike >= 3 ? 'spike-hot' : 'spike-normal'}">
            ${coin.vol_spike >= 3 ? '🔥 ' : ''}${coin.vol_spike.toFixed(1)}x
          </span>
        </div>
        <div class="card-sparkline-box">
          ${sparkSvg}
        </div>
        <div class="card-footer">
          <span>5M量: $${formatNumber(coin.vol_5m)}</span>
          <span>1M: ${coin.price_chg_1m >= 0 ? '+' : ''}${coin.price_chg_1m.toFixed(2)}%</span>
        </div>
      `;

      card.addEventListener('click', () => openModal(coin));
      fragment.appendChild(card);
    });

    el.cardsContainer.innerHTML = '';
    el.cardsContainer.appendChild(fragment);
  }

  function generateSparklineSvg(points, isPositive, width = 90, height = 28) {
    if (!points || points.length < 2) {
      return `<svg class="sparkline-svg ${isPositive ? 'positive' : 'negative'}" viewBox="0 0 ${width} ${height}"><line x1="0" y1="${height/2}" x2="${width}" y2="${height/2}" stroke="currentColor"/></svg>`;
    }

    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = (max - min) || 1;

    const coords = points.map((p, i) => {
      const x = (i / (points.length - 1)) * (width - 4) + 2;
      const y = height - 4 - ((p - min) / range) * (height - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const d = `M ${coords.join(' L ')}`;
    return `
      <svg class="sparkline-svg ${isPositive ? 'positive' : 'negative'}" viewBox="0 0 ${width} ${height}">
        <path d="${d}" />
      </svg>
    `;
  }

  function renderAlerts() {
    if (!state.alertsList.length) {
      el.radarEmptyState.style.display = 'flex';
      el.radarAlertCount.textContent = '0 則異動';
      return;
    }

    el.radarEmptyState.style.display = 'none';
    el.radarAlertCount.textContent = `${state.alertsList.length} 則異動`;

    const fragment = document.createDocumentFragment();

    state.alertsList.forEach(alert => {
      const div = document.createElement('div');
      div.className = 'alert-card';

      div.innerHTML = `
        <div class="alert-card-top">
          <div class="alert-symbol-box">
            <span class="alert-type-tag">${alert.type}</span>
            <span class="alert-symbol">${alert.base_asset}</span>
          </div>
          <span class="alert-gain">+${alert.price_chg_5m.toFixed(2)}%</span>
        </div>
        <div class="alert-card-bottom">
          <span class="alert-time">⏱️ ${alert.timestamp}</span>
          <span class="alert-vol">🔥 ${alert.vol_spike.toFixed(1)}x 放量 ($${formatNumber(alert.vol_5m)})</span>
        </div>
      `;

      div.addEventListener('click', () => {
        const coin = state.marketData[alert.symbol];
        if (coin) openModal(coin);
      });

      fragment.appendChild(div);
    });

    el.radarFeed.innerHTML = '';
    el.radarFeed.appendChild(fragment);
  }

  async function openModal(coin) {
    if (!coin) return;

    el.modalSymbol.textContent = coin.symbol;
    el.modalPrice.textContent = `$${formatPrice(coin.last_price)}`;
    el.modalGain5m.textContent = `${coin.price_chg_5m >= 0 ? '+' : ''}${coin.price_chg_5m.toFixed(2)}%`;
    el.modalGain5m.className = `modal-gain-val ${coin.price_chg_5m >= 0 ? 'highlight-green' : 'negative'}`;
    el.modalSpike.textContent = `${coin.vol_spike.toFixed(1)}x`;

    el.modalChg1m.textContent = `${coin.price_chg_1m >= 0 ? '+' : ''}${coin.price_chg_1m.toFixed(2)}%`;
    el.modalChg15m.textContent = `${coin.price_chg_15m >= 0 ? '+' : ''}${coin.price_chg_15m.toFixed(2)}%`;
    el.modalChg24h.textContent = `${coin.price_chg_24h >= 0 ? '+' : ''}${coin.price_chg_24h.toFixed(2)}%`;
    el.modalVol5m.textContent = `$${formatNumber(coin.vol_5m)}`;
    el.modalVol24h.textContent = `$${formatNumber(coin.vol_24h)}`;
    el.modalSurgeScore.textContent = `${coin.surge_score}`;

    el.modalChartRange.textContent = `5M 最高: $${formatPrice(coin.high_5m)} | 最低: $${formatPrice(coin.low_5m)}`;
    el.modalBinanceLink.href = `https://www.binance.com/zh-TC/trade/${coin.symbol}?type=spot`;
    el.modalTvLink.href = `https://www.tradingview.com/chart/?symbol=BINANCE:${coin.symbol}`;

    el.coinModal.style.display = 'flex';

    // Draw Canvas Chart from history buffer
    const buf = state.historyBuffers[coin.symbol];
    if (buf && buf.length > 1) {
      const prices = buf.map(b => b.price);
      drawCanvasChart(prices, coin.price_chg_5m >= 0);
    } else {
      drawCanvasChart(coin.sparkline || [coin.last_price], coin.price_chg_5m >= 0);
    }
  }

  function drawCanvasChart(prices, isPositive) {
    const canvas = el.modalCanvas;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    if (!prices || prices.length < 2) return;

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = (max - min) || 1;
    const padding = 20;

    const points = prices.map((p, i) => {
      const x = padding + (i / (prices.length - 1)) * (width - padding * 2);
      const y = height - padding - ((p - min) / range) * (height - padding * 2);
      return { x, y, p };
    });

    const grad = ctx.createLinearGradient(0, 0, 0, height);
    if (isPositive) {
      grad.addColorStop(0, 'rgba(0, 245, 160, 0.25)');
      grad.addColorStop(1, 'rgba(0, 245, 160, 0.0)');
    } else {
      grad.addColorStop(0, 'rgba(255, 56, 96, 0.25)');
      grad.addColorStop(1, 'rgba(255, 56, 96, 0.0)');
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.forEach(pt => ctx.lineTo(pt.x, pt.y));
    ctx.lineTo(points[points.length - 1].x, height - padding);
    ctx.lineTo(points[0].x, height - padding);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.forEach(pt => ctx.lineTo(pt.x, pt.y));
    ctx.strokeStyle = isPositive ? '#00f5a0' : '#ff3860';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    const last = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = isPositive ? '#00f5a0' : '#ff3860';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function formatPrice(val) {
    if (val === undefined || val === null) return '0.00';
    const num = Number(val);
    if (num >= 1000) return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (num >= 1) return num.toFixed(3);
    if (num >= 0.01) return num.toFixed(4);
    return num.toFixed(6);
  }

  function formatNumber(num) {
    if (!num) return '0.0k';
    const n = Number(num);
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return n.toFixed(0);
  }

  function setupEventListeners() {
    el.btnSoundToggle.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      initAudio();
      el.soundIcon.textContent = state.soundEnabled ? '🔊' : '🔇';
      el.soundLabel.textContent = `警報音效: ${state.soundEnabled ? '開' : '關'}`;
      el.btnSoundToggle.className = `nav-btn ${state.soundEnabled ? '' : 'sound-off'}`;
      if (state.soundEnabled) playPumpChime();
    });

    el.thresholdSelect.addEventListener('change', (e) => {
      state.alertThreshold = parseFloat(e.target.value);
      el.radarThresholdVal.textContent = `${state.alertThreshold.toFixed(1)}%`;
    });

    el.viewTableBtn.addEventListener('click', () => {
      state.viewMode = 'table';
      el.viewTableBtn.classList.add('active');
      el.viewCardsBtn.classList.remove('active');
      el.tableContainer.style.display = 'block';
      el.cardsContainer.style.display = 'none';
      renderMarket();
    });

    el.viewCardsBtn.addEventListener('click', () => {
      state.viewMode = 'cards';
      el.viewCardsBtn.classList.add('active');
      el.viewTableBtn.classList.remove('active');
      el.tableContainer.style.display = 'none';
      el.cardsContainer.style.display = 'grid';
      renderMarket();
    });

    el.sortTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentSort = btn.dataset.sort;
      renderMarket();
    });

    el.minVolFilter.addEventListener('change', (e) => {
      state.minVolume = parseFloat(e.target.value);
      renderMarket();
    });

    el.symbolSearch.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim();
      el.clearSearch.style.display = state.searchQuery ? 'block' : 'none';
      renderMarket();
    });

    el.clearSearch.addEventListener('click', () => {
      state.searchQuery = '';
      el.symbolSearch.value = '';
      el.clearSearch.style.display = 'none';
      renderMarket();
    });

    el.modalClose.addEventListener('click', () => {
      el.coinModal.style.display = 'none';
    });

    el.coinModal.addEventListener('click', (e) => {
      if (e.target === el.coinModal) el.coinModal.style.display = 'none';
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.coinModal.style.display === 'flex') {
        el.coinModal.style.display = 'none';
      }
    });
  }

  function init() {
    setupEventListeners();
    initDataFeed();
  }

  window.addEventListener('DOMContentLoaded', init);
})();
