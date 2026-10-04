import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from engine import CryptoSurgeEngine

logger = logging.getLogger("CryptoServer")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

engine = CryptoSurgeEngine(top_n_track=250)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting CryptoSurgeEngine...")
    await engine.start()
    yield
    # Shutdown
    logger.info("Stopping CryptoSurgeEngine...")
    await engine.stop()

app = FastAPI(
    title="CyberPump 5M - 虛擬幣5分鐘暴漲分析系統",
    description="實時監控幣安所有主流USDT交易對5分鐘滾動漲幅與資金異動",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Endpoints
@app.get("/api/status")
async def get_status():
    return {
        "status": "online",
        "is_ws_connected": engine.is_ws_connected,
        "total_tracked": len(engine.market_data),
        "last_update_ts": engine.last_update_ts,
        "alert_threshold": engine.alert_threshold,
        "min_vol_threshold": engine.min_vol_threshold
    }

@app.get("/api/market")
async def get_market():
    overview = engine.get_market_overview()
    top_5m = engine.get_top_gainers_5m(limit=15)
    top_spikes = engine.get_top_volume_spikes(limit=10)
    return {
        "overview": overview,
        "top_5m": top_5m,
        "top_spikes": top_spikes
    }

@app.get("/api/symbols")
async def get_symbols(
    sort_by: str = Query("price_chg_5m", description="Sort field: price_chg_5m, price_chg_1m, price_chg_15m, price_chg_24h, vol_5m, vol_spike, surge_score"),
    order: str = Query("desc", description="desc or asc"),
    min_vol_5m: float = Query(0.0, description="Minimum 5m USDT volume"),
    search: Optional[str] = Query(None, description="Search symbol"),
    limit: int = Query(60, le=250)
):
    coins = list(engine.market_data.values())

    # Search filter
    if search:
        s_upper = search.strip().upper()
        coins = [c for c in coins if s_upper in c['symbol'] or s_upper in c['base_asset']]

    # Volume filter
    if min_vol_5m > 0:
        coins = [c for c in coins if c['vol_5m'] >= min_vol_5m]

    # 嚴格只保留5分鐘上漲幣種
    coins = [c for c in coins if c.get('price_chg_5m', 0.0) > 0]

    # Sorting
    valid_sorts = {
        'price_chg_5m', 'price_chg_1m', 'price_chg_15m', 
        'price_chg_24h', 'vol_5m', 'vol_24h', 'vol_spike', 
        'surge_score', 'last_price'
    }
    key_field = sort_by if sort_by in valid_sorts else 'price_chg_5m'
    reverse = (order.lower() == 'desc')

    coins.sort(key=lambda x: x.get(key_field, 0.0), reverse=reverse)
    return {
        "total": len(coins),
        "items": coins[:limit]
    }

@app.get("/api/alerts")
async def get_alerts():
    return list(engine.alerts)[:50]

@app.post("/api/settings")
async def update_settings(
    threshold: float = Query(..., ge=0.5, le=20.0),
    min_vol: float = Query(..., ge=0.0)
):
    engine.alert_threshold = threshold
    engine.min_vol_threshold = min_vol
    return {
        "status": "success",
        "alert_threshold": engine.alert_threshold,
        "min_vol_threshold": engine.min_vol_threshold
    }

@app.get("/api/symbol/{symbol}")
async def get_symbol_detail(symbol: str):
    s = symbol.upper()
    data = engine.market_data.get(s)
    if not data:
        return {"error": "Symbol not found"}
    
    dq = engine.history.get(s)
    history_points = []
    if dq:
        # Return recent points (timestamp, price, volume)
        history_points = [
            {"t": int(ts * 1000), "p": round(p, 6), "v": round(v, 2)}
            for ts, p, v in list(dq)[-60:]
        ]

    return {
        "info": data,
        "history": history_points
    }

# WebSocket for ultra-low latency push
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    alert_queue = engine.subscribe_alerts()
    
    async def alert_forwarder():
        """Push instant alert as soon as detected"""
        try:
            while True:
                alert = await alert_queue.get()
                await websocket.send_json({
                    "type": "ALERT",
                    "data": alert
                })
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    forwarder_task = asyncio.create_task(alert_forwarder())

    try:
        while True:
            # Stream live market summary & top 5m gainers every 1000ms
            overview = engine.get_market_overview()
            top_gainers = engine.get_top_gainers_5m(limit=25)
            top_spikes = engine.get_top_volume_spikes(limit=10)

            payload = {
                "type": "TICK",
                "ts": engine.last_update_ts,
                "overview": overview,
                "top_5m": top_gainers,
                "top_spikes": top_spikes
            }
            await websocket.send_json(payload)
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"WS client disconnected: {e}")
    finally:
        forwarder_task.cancel()
        engine.unsubscribe_alerts(alert_queue)

# Root and static assets
@app.get("/")
async def root():
    return FileResponse("index.html")

@app.get("/app.js")
async def get_app_js():
    return FileResponse("app.js", media_type="application/javascript")

@app.get("/style.css")
async def get_style_css():
    return FileResponse("style.css", media_type="text/css")

app.mount("/static", StaticFiles(directory="static"), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False, log_level="info")
