@echo off
chcp 65001 >nul
title CYBERPUMP 5M - 虛擬幣5分鐘暴漲即時分析系統

echo ===================================================================
echo   CYBERPUMP 5M // 虛擬幣 5 分鐘高頻異動監控雷達
echo   Binance 實時長連接 (WebSocket 1000ms Push)
echo ===================================================================
echo.
echo 正在啟動後端服務與幣安即時數據流...
start http://127.0.0.1:8000
python main.py
pause
