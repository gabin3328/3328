# CYBERPUMP 5M // 虛擬幣 5 分鐘高頻暴漲分析系統

> 實時監控幣安（Binance）主流 USDT 現貨交易對 5 分鐘滾動漲跌幅、主力爆量異動倍數與市場多空情緒。

---

## ⚡ 核心特點

1. **零延遲滾動 5 分鐘漲幅計算**：
   - 啟動瞬間自動調用幣安 `GET /api/v3/ticker?windowSize=5m` 預載前 250 檔高流動性現貨對歷史快照，達成「零等待」即刻展示。
   - 長連接直通幣安官方 WebSocket `wss://stream.binance.com:9443/ws/!miniTicker@arr`（1000ms TICK 推送），以滑動窗口算法（Sliding Window Ring Buffer）即時計算 1m 急速、5m 漲幅、15m 波段。

2. **主力放量異動倍數（Volume Spike Multiplier）**：
   - 算法：$\text{爆量倍數} = \frac{\text{5M 實際成交額}}{\text{24H 成交額} / 288}$
   - 若倍數 $\ge 3.0\times$ 且 5 分鐘價格向上拉升，代表主力資金異常建倉／點火，自動標記 🔥 警報。

3. **低量雜訊過濾器**：
   - 支援一鍵過濾全部流動性／$10k／$50k／$100k／$500k USDT 成交額，杜絕薄盤無量操縱假拉盤。

4. **即時異動雷達與 Web Audio 聲響提示**：
   - 當幣種 5 分鐘拉升突破門檻（1.0% ~ 5.0%）且放量時，雷達廣播即刻推播，並使用 Web Audio API 合成雙音頻提示音（可一鍵靜音）。

5. **雙模式架構（Dual Architecture）**：
   - **本地極速模式**：運行 `python main.py`，由 Python FastAPI 高效能後端聚合與廣播。
   - **GitHub Pages 零伺服器模式**：直接透過靜態託管（`index.html` + `app.js` + `style.css`），瀏覽器直連幣安官方 WebSocket 與 CORS API，24/7 免費運作！

---

## 🚀 本地快速啟動

### Windows 一鍵啟動：
直接雙擊執行 `run.bat`，或在命令提示字元中執行：
```bash
python main.py
```
啟動後在瀏覽器開啟：`http://127.0.0.1:8000`

---

## 🌐 GitHub Pages 線上啟用方式

1. 將代碼推送至 GitHub 倉庫後，點擊倉庫上方的 **Settings**（設定）。
2. 在左側選單選擇 **Pages**。
3. 在 **Build and deployment** 下方的 **Branch**：
   - 選擇 `main`（或 `master`）
   - 資料夾選擇 `/ (root)`
   - 點擊 **Save**。
4. 稍等 1~2 分鐘，即可透過 `https://gabin3328.github.io/3328/` 隨時隨地開啟即時分析儀表板！
