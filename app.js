/**
 * CYBERPUMP 5M - Dual Mode Real-time Engine
 * Features:
 * - Direct Binance WebSocket / REST connection & Local Python FastAPI fallback
 * - Custom Watchlist (自選幣種監控) with persistent storage
 * - Advanced Alert Condition Rules (自定義警報條件: 5M%、1M%、爆量倍數、最低成交量、監控範圍)
 * - Multi-sound Chime Synthesizer (Web Audio API)
 * - Browser Desktop Notifications (HTML5 Notification API)
 * - Real-time TradingView Candlestick Widget + Real-time Canvas Tick-by-Tick chart
 * - Dynamic Fullscreen Modal
 */

(function () {
  'use strict';

  const STABLE_COINS = new Set([
    'USDCUSDT', 'FDUSDUSDT', 'EURUSDT', 'TUSDUSDT', 'USDPUSDT', 
    'AEURUSDT', 'BUSDUSDT', 'DAIUSDT', 'WBTCUSDT', 'USDSUSDT', 
    'EURIUSDT', 'USDEUSDT', 'USDDUSDT'
  ]);

  // Load Watchlist from LocalStorage
  let initialWatchlist = new Set();
  try {
    const saved = localStorage.getItem('cyberpump_watchlist');
    if (saved) initialWatchlist = new Set(JSON.parse(saved));
  } catch (e) {}

  // Load Target Prices from LocalStorage
  let initialTargetPrices = {};
  try {
    const savedTargets = localStorage.getItem('cyberpump_target_prices');
    if (savedTargets) initialTargetPrices = JSON.parse(savedTargets);
  } catch (e) {}

  // Load Alert Rules from LocalStorage
  let initialRules = {
    scope: 'all',       // 'all' | 'watchlist'
    chg5m: 2.0,         // 5m gain >= X%
    use1m: true,        // require 1m velocity
    chg1m: 0.4,         // 1m velocity >= X%
    useSpike: true,     // require volume spike
    spike: 2.0,         // spike >= X times
    minVol: 10000,      // 5m volume >= X USDT
    sound: true,        // Web Audio chime
    desktop: false,     // Desktop Push Notification
    soundType: 'siren', // 'siren' | 'cyber' | 'radar' | 'ding'
    cooldown: 120       // seconds cooldown per coin
  };
  try {
    const savedRules = localStorage.getItem('cyberpump_alert_rules');
    if (savedRules) initialRules = { ...initialRules, ...JSON.parse(savedRules) };
  } catch (e) {}

  // State Management
  const state = {
    ws: null,
    wsConnected: false,
    isDirectMode: false,
    soundEnabled: initialRules.sound,
    watchlist: initialWatchlist,
    targetPrices: initialTargetPrices,
    alertRules: initialRules,
    minVolume: 10000,
    searchQuery: '',
    currentSort: 'price_chg_5m',
    viewMode: 'table',
    marketData: {}, // symbol -> coin
    historyBuffers: {}, // symbol -> array of { ts, price, quote_vol }
    alertsList: [],
    alertCooldown: {},
    previousPrices: {},
    audioCtx: null,
    activeModalSymbol: null,
    activeChartTab: 'tv',
    tvInterval: '5',
    titleFlashingTimer: null,
    activeAlarmCoin: null
  };

  // DOM Elements
  const el = {
    wsStatusBadge: document.getElementById('ws-status-badge'),
    wsStatusText: document.getElementById('ws-status-text'),
    wsPingBadge: document.getElementById('ws-ping-badge'),
    btnAlertSettings: document.getElementById('btn-alert-settings'),
    btnSoundToggle: document.getElementById('btn-sound-toggle'),
    soundIcon: document.getElementById('sound-icon'),
    soundLabel: document.getElementById('sound-label'),
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
    watchlistCountBadge: document.getElementById('watchlist-count-badge'),
    tabWatchlistBtn: document.getElementById('tab-watchlist-btn'),
    
    // Emergency Alarm Banner
    alarmBanner: document.getElementById('alarm-banner'),
    alarmBannerText: document.getElementById('alarm-banner-text'),
    alarmBtnUnmute: document.getElementById('alarm-btn-unmute'),
    alarmBtnInspect: document.getElementById('alarm-btn-inspect'),
    alarmBtnStop: document.getElementById('alarm-btn-stop'),

    // Monitor Control Panel
    summaryChg5m: document.getElementById('summary-chg5m'),
    summaryChg1m: document.getElementById('summary-chg1m'),
    summarySpike: document.getElementById('summary-spike'),
    summaryScope: document.getElementById('summary-scope'),
    summarySound: document.getElementById('summary-sound'),
    btnQuickSettings: document.getElementById('btn-quick-settings'),
    btnQuickTest: document.getElementById('btn-quick-test'),

    // Target Coin Controller
    btnScopeAll: document.getElementById('btn-scope-all'),
    btnScopeWatchlist: document.getElementById('btn-scope-watchlist'),
    quickFavCount: document.getElementById('quick-fav-count'),
    quickCoinInput: document.getElementById('quick-coin-input'),
    btnQuickAdd: document.getElementById('btn-quick-add'),
    hotChipsContainer: document.getElementById('hot-chips-container'),
    monitoredPillsList: document.getElementById('monitored-pills-list'),

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

    // 5M Strategy Signals Radar
    signalsPumpCards: document.getElementById('signals-pump-cards'),
    signalsDumpCards: document.getElementById('signals-dump-cards'),
    signalsUpdateTime: document.getElementById('signals-update-time'),

    // Coin Modal
    coinModal: document.getElementById('coin-modal'),
    modalCardElement: document.getElementById('modal-card-element'),
    modalFullscreenBtn: document.getElementById('modal-fullscreen-btn'),
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
    modalStarBtn: document.getElementById('modal-star-btn'),
    modalBinanceLink: document.getElementById('modal-binance-link'),
    modalTvLink: document.getElementById('modal-tv-link'),
    tabTvChart: document.getElementById('tab-tv-chart'),
    tabCanvasChart: document.getElementById('tab-canvas-chart'),
    tvChartWrapper: document.getElementById('tv-chart-wrapper'),
    canvasChartSection: document.getElementById('canvas-chart-section'),

    // Modal Target Price
    modalTargetInput: document.getElementById('modal-target-price-input'),
    modalBtnSetTarget: document.getElementById('modal-btn-set-target'),
    modalBtnClearTarget: document.getElementById('modal-btn-clear-target'),
    modalTargetStatus: document.getElementById('modal-target-status'),
    modalTargetVal: document.getElementById('modal-target-val'),

    // Settings Modal
    alertSettingsModal: document.getElementById('alert-settings-modal'),
    modalSettingsClose: document.getElementById('modal-settings-close'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    scopeAll: document.getElementById('scope-all'),
    scopeWatchlist: document.getElementById('scope-watchlist'),
    labelScopeAll: document.getElementById('label-scope-all'),
    labelScopeWatchlist: document.getElementById('label-scope-watchlist'),
    settingsFavCount: document.getElementById('settings-fav-count'),
    favListBadge: document.getElementById('fav-list-badge'),
    favTagsBox: document.getElementById('fav-tags-box'),
    btnClearFav: document.getElementById('btn-clear-fav'),
    inputChg5m: document.getElementById('input-chg5m'),
    valChg5m: document.getElementById('val-chg5m'),
    chkUse1m: document.getElementById('chk-use-1m'),
    inputChg1m: document.getElementById('input-chg1m'),
    valChg1m: document.getElementById('val-chg1m'),
    chkUseSpike: document.getElementById('chk-use-spike'),
    inputChgspike: document.getElementById('input-chgspike'),
    valSpike: document.getElementById('val-spike'),
    selectMinvol: document.getElementById('select-minvol'),
    chkSound: document.getElementById('chk-sound'),
    chkDesktop: document.getElementById('chk-desktop'),
    soundType: document.getElementById('sound-type'),
    btnTestSound: document.getElementById('btn-test-sound'),
    btnTestNotify: document.getElementById('btn-test-notify')
  };

  // --- Global Interaction Helpers ---
  window.cyberpumpToggleStar = function (symbol, event) {
    if (event) event.stopPropagation();
    toggleWatchlist(symbol);
  };

  window.cyberpumpOpenSymbol = function (symbol) {
    if (!symbol) return;
    const s = symbol.toUpperCase();
    const c = state.marketData[s] || {
      symbol: s,
      base_asset: s.replace('USDT', ''),
      last_price: 0,
      price_chg_5m: 0,
      vol_5m: 0,
      vol_spike: 1.0
    };
    openModal(c);
  };

  function toggleWatchlist(symbol) {
    if (state.watchlist.has(symbol)) {
      state.watchlist.delete(symbol);
    } else {
      state.watchlist.add(symbol);
      ensureCoinTracked(symbol);
    }
    saveWatchlist();
    updateWatchlistUI();
    renderMarket();
    if (state.activeModalSymbol === symbol) {
      updateModalStarButton(symbol);
    }
  }

  function saveWatchlist() {
    try {
      localStorage.setItem('cyberpump_watchlist', JSON.stringify([...state.watchlist]));
    } catch (e) {}
  }

  function saveTargetPrices() {
    try {
      localStorage.setItem('cyberpump_target_prices', JSON.stringify(state.targetPrices));
    } catch (e) {}
  }

  function updateWatchlistUI() {
    const count = state.watchlist.size;
    if (el.watchlistCountBadge) el.watchlistCountBadge.textContent = count;
    if (el.settingsFavCount) el.settingsFavCount.textContent = count;
    if (el.favListBadge) el.favListBadge.textContent = count;
    if (el.quickFavCount) el.quickFavCount.textContent = count;
    renderFavTags();
    renderMonitoredPills();
    updateRulesSummaryUI();
  }

  function renderFavTags() {
    if (!el.favTagsBox) return;
    if (state.watchlist.size === 0) {
      el.favTagsBox.innerHTML = '<span class="empty-fav-hint">尚未加入自選幣種，可在列表或卡片點擊 ⭐ 快速加入</span>';
      return;
    }

    const fragment = document.createDocumentFragment();
    state.watchlist.forEach(sym => {
      const span = document.createElement('span');
      span.className = 'fav-tag-pill';
      span.innerHTML = `
        <span>${sym}</span>
        <button type="button" class="fav-tag-remove" title="移除">✕</button>
      `;
      span.querySelector('.fav-tag-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleWatchlist(sym);
      });
      fragment.appendChild(span);
    });

    el.favTagsBox.innerHTML = '';
    el.favTagsBox.appendChild(fragment);
  }

  function renderMonitoredPills() {
    if (!el.monitoredPillsList) return;
    if (state.watchlist.size === 0) {
      el.monitoredPillsList.innerHTML = '<span class="pills-empty">尚未選取指定幣種，可點選上方熱門幣或輸入代碼</span>';
      return;
    }

    const fragment = document.createDocumentFragment();
    state.watchlist.forEach(sym => {
      const span = document.createElement('span');
      span.className = 'pills-item';
      const coin = state.marketData[sym];
      const gainText = coin ? `${coin.price_chg_5m >= 0 ? '+' : ''}${coin.price_chg_5m.toFixed(1)}%` : '';
      span.innerHTML = `
        <span>${sym.replace('USDT', '')} <small style="font-size:0.8em;opacity:0.8;">${gainText}</small></span>
        <button type="button" class="pills-item-remove" title="移除指定監控">✕</button>
      `;
      span.querySelector('.pills-item-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleWatchlist(sym);
      });
      span.addEventListener('click', () => {
        if (state.marketData[sym]) openModal(state.marketData[sym]);
      });
      fragment.appendChild(span);
    });

    el.monitoredPillsList.innerHTML = '';
    el.monitoredPillsList.appendChild(fragment);
  }

  function updateRulesSummaryUI() {
    const rules = state.alertRules;
    if (el.summaryChg5m) el.summaryChg5m.textContent = `≥ ${rules.chg5m.toFixed(1)}%`;
    if (el.summaryChg1m) el.summaryChg1m.textContent = rules.use1m ? `≥ ${rules.chg1m.toFixed(1)}%` : '不限';
    if (el.summarySpike) el.summarySpike.textContent = rules.useSpike ? `≥ ${rules.spike.toFixed(1)}x` : '不限';
    if (el.summaryScope) {
      const isCustom = rules.scope === 'watchlist';
      el.summaryScope.textContent = isCustom ? `僅監控指定清單 (${state.watchlist.size}檔)` : '全市場掃描 (150+)';
      el.summaryScope.className = isCustom ? 'rule-value highlight-cyan' : 'rule-value highlight-green';
    }
    if (el.summarySound) {
      let soundName = '防空警笛';
      if (rules.soundType === 'cyber') soundName = '科技雙頻';
      else if (rules.soundType === 'radar') soundName = '急促蜂鳴';
      else if (rules.soundType === 'ding') soundName = '清脆和弦';
      el.summarySound.textContent = state.soundEnabled ? `🔊 ${soundName}` : '🔇 已靜音';
      el.summarySound.className = state.soundEnabled ? 'rule-value highlight-green' : 'rule-value';
    }

    if (el.btnScopeAll && el.btnScopeWatchlist) {
      if (rules.scope === 'watchlist') {
        el.btnScopeWatchlist.classList.add('active');
        el.btnScopeAll.classList.remove('active');
      } else {
        el.btnScopeAll.classList.add('active');
        el.btnScopeWatchlist.classList.remove('active');
      }
    }
  }

  function updateModalTargetPriceUI(symbol) {
    if (!el.modalTargetInput) return;
    const target = state.targetPrices[symbol];
    if (target) {
      el.modalTargetInput.value = target;
      if (el.modalTargetStatus) {
        el.modalTargetStatus.style.display = 'block';
        el.modalTargetVal.textContent = `$${formatPrice(target)}`;
      }
      if (el.modalBtnClearTarget) el.modalBtnClearTarget.style.display = 'inline-block';
      if (el.modalBtnSetTarget) el.modalBtnSetTarget.textContent = '更新目標價';
    } else {
      el.modalTargetInput.value = '';
      if (el.modalTargetStatus) el.modalTargetStatus.style.display = 'none';
      if (el.modalBtnClearTarget) el.modalBtnClearTarget.style.display = 'none';
      if (el.modalBtnSetTarget) el.modalBtnSetTarget.textContent = '儲存警報價';
    }
  }

  function updateModalStarButton(symbol) {
    if (!el.modalStarBtn) return;
    const isFav = state.watchlist.has(symbol);
    if (isFav) {
      el.modalStarBtn.className = 'action-btn btn-star-action active';
      el.modalStarBtn.innerHTML = '<span>🔔 已在指定監控中 (點擊取消)</span>';
    } else {
      el.modalStarBtn.className = 'action-btn btn-star-action';
      el.modalStarBtn.innerHTML = '<span>➕ 加入指定監控</span>';
    }
  }

  // --- Web Audio API Chime & Siren Synthesizer ---
  function initAudio() {
    if (!state.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) state.audioCtx = new AudioContext();
    }
    if (state.audioCtx && state.audioCtx.state === 'suspended') {
      state.audioCtx.resume();
    }
  }

  function playAlertSound(type = state.alertRules.soundType) {
    if (!state.soundEnabled && !state.alertRules.sound) return;
    try {
      initAudio();
      if (!state.audioCtx) return;

      const ctx = state.audioCtx;
      const now = ctx.currentTime;

      if (type === 'siren') {
        // High-urgency Air Raid Siren sweeping oscillation
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(650, now);
        osc.frequency.linearRampToValueAtTime(1300, now + 0.35);
        osc.frequency.linearRampToValueAtTime(650, now + 0.7);
        osc.frequency.linearRampToValueAtTime(1300, now + 1.05);
        osc.frequency.linearRampToValueAtTime(650, now + 1.4);
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.48);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 1.5);
      } else if (type === 'radar') {
        // Rapid 3 high-pitch beeps
        for (let i = 0; i < 3; i++) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(1400, now + i * 0.09);
          gain.gain.setValueAtTime(0.3, now + i * 0.09);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.06);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + i * 0.09);
          osc.stop(now + i * 0.09 + 0.07);
        }
      } else if (type === 'ding') {
        // Crystal chord triad (C6, E6, G6)
        [1046.5, 1318.5, 1567.98].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + i * 0.04);
          gain.gain.setValueAtTime(0.2, now + i * 0.04);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + i * 0.04);
          osc.stop(now + 0.48);
        });
      } else {
        // Default Cyber Chime (880Hz -> 1320Hz)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.35);
      }
    } catch (e) {
      console.warn('Audio playback error:', e);
    }
  }

  // --- Title Flashing Functions ---
  function startTitleFlashing(text) {
    stopTitleFlashing();
    let toggle = false;
    state.titleFlashingTimer = setInterval(() => {
      document.title = toggle ? text : '🚨🚨 CYBERPUMP 暴漲緊急警報 🚨🚨';
      toggle = !toggle;
    }, 600);
  }

  function stopTitleFlashing() {
    if (state.titleFlashingTimer) {
      clearInterval(state.titleFlashingTimer);
      state.titleFlashingTimer = null;
    }
    document.title = 'CYBERPUMP 5M // 虛擬幣5分鐘暴漲即時分析系統';
  }

  // --- Browser Desktop Push Notification ---
  function sendDesktopNotification(alert) {
    if (!state.alertRules.desktop) return;
    if (!("Notification" in window)) return;

    if (Notification.permission === "granted") {
      new Notification(`🚨 [PUMP] ${alert.symbol} 飆升 +${alert.price_chg_5m ? alert.price_chg_5m.toFixed(2) : '0'}%!`, {
        body: `現價: $${formatPrice(alert.price)} | 5M量: $${formatNumber(alert.vol_5m)} (${alert.vol_spike ? alert.vol_spike.toFixed(1) : '1.0'}x 放量)`,
        tag: alert.symbol
      });
    }
  }

  // --- Alert Trigger Logic with Custom Rules ---
  function checkCustomAlert(coin, now) {
    const rules = state.alertRules;

    // Check 0: Individual coin target price alert (目標價突破)
    if (state.targetPrices[coin.symbol]) {
      const target = state.targetPrices[coin.symbol];
      if (coin.last_price >= target) {
        delete state.targetPrices[coin.symbol];
        saveTargetPrices();
        const priceAlert = {
          id: `price_${coin.symbol}_${Math.floor(now)}`,
          timestamp: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
          symbol: coin.symbol,
          base_asset: coin.base_asset,
          price: coin.last_price,
          price_chg_5m: coin.price_chg_5m,
          price_chg_1m: coin.price_chg_1m,
          vol_5m: coin.vol_5m,
          vol_spike: coin.vol_spike,
          type: 'PRICE_TARGET'
        };
        handleAlert(priceAlert);
        if (state.activeModalSymbol === coin.symbol) {
          updateModalTargetPriceUI(coin.symbol);
        }
        return;
      }
    }

    // Scope check: If set to watchlist only, ignore non-watchlist coins
    if (rules.scope === 'watchlist' && !state.watchlist.has(coin.symbol)) {
      return;
    }

    // Condition 1: 5m gain
    if (coin.price_chg_5m < rules.chg5m) return;

    // Condition 2: 1m velocity (if enabled)
    if (rules.use1m && coin.price_chg_1m < rules.chg1m) return;

    // Condition 3: Volume spike multiple (if enabled)
    if (rules.useSpike && coin.vol_spike < rules.spike) return;

    // Condition 4: Minimum 5m volume
    if (coin.vol_5m < rules.minVol) return;

    // Condition 5: Cooldown
    const lastAlert = state.alertCooldown[coin.symbol] || 0;
    if (now - lastAlert > rules.cooldown) {
      state.alertCooldown[coin.symbol] = now;
      const alert = {
        id: `${coin.symbol}_${Math.floor(now)}`,
        timestamp: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
        symbol: coin.symbol,
        base_asset: coin.base_asset,
        price: coin.last_price,
        price_chg_5m: coin.price_chg_5m,
        price_chg_1m: coin.price_chg_1m,
        vol_5m: coin.vol_5m,
        vol_spike: coin.vol_spike,
        type: 'PUMP'
      };
      handleAlert(alert);
    }
  }

  function handleAlert(alert) {
    if (!alert) return;
    state.alertsList.unshift(alert);
    if (state.alertsList.length > 50) state.alertsList.pop();

    triggerEmergencyAlarm(alert);
    renderAlerts();
  }

  function triggerEmergencyAlarm(alert) {
    playAlertSound(state.alertRules.soundType);
    sendDesktopNotification(alert);

    // Emergency Top Banner
    if (el.alarmBanner && el.alarmBannerText) {
      state.activeAlarmCoin = alert.symbol;
      const gainStr = alert.price_chg_5m !== undefined 
        ? `${alert.price_chg_5m >= 0 ? '+' : ''}${alert.price_chg_5m.toFixed(2)}%` 
        : '';
      const spikeStr = alert.vol_spike ? `爆量 ${alert.vol_spike.toFixed(1)}x` : '';
      const priceStr = alert.price ? `現價: $${formatPrice(alert.price)}` : '';
      let typeLabel = '🚀 5分鐘暴漲';
      if (alert.type === 'PRICE_TARGET') typeLabel = '🎯 目標價突破';
      else if (alert.type === 'MILESTONE') typeLabel = '🔥 二次暴拉衝刺';

      el.alarmBannerText.textContent = `${typeLabel}！【${alert.symbol}】 ${gainStr} ${spikeStr} (${priceStr})`;
      el.alarmBanner.style.display = 'block';

      if (el.alarmBtnUnmute) {
        if (!state.audioCtx || state.audioCtx.state === 'suspended') {
          el.alarmBtnUnmute.style.display = 'inline-block';
        } else {
          el.alarmBtnUnmute.style.display = 'none';
        }
      }
    }

    // Title Flashing
    startTitleFlashing(`🚨【暴漲警報】${alert.symbol} 飆升!`);
  }

  // --- Dynamic Single Coin Loader ---
  async function ensureCoinTracked(sym) {
    if (!sym) return null;
    let symbol = sym.toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
    if (!symbol) return null;
    if (!symbol.endsWith('USDT')) symbol += 'USDT';

    if (state.marketData[symbol] && state.historyBuffers[symbol]) {
      return state.marketData[symbol];
    }

    try {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
      if (!res.ok) return null;
      const t = await res.json();
      const lastPrice = parseFloat(t.lastPrice || 0);
      const quoteVol = parseFloat(t.quoteVolume || 0);
      const pct24h = parseFloat(t.priceChangePercent || 0);
      const now = Date.now() / 1000;

      let pct5m = 0.0;
      let vol5m = quoteVol / 288.0;
      try {
        const res5 = await fetch(`https://api.binance.com/api/v3/ticker?symbol=${symbol}&windowSize=5m`);
        if (res5.ok) {
          const d5 = await res5.json();
          pct5m = parseFloat(d5.priceChangePercent || 0);
          vol5m = parseFloat(d5.quoteVolume || vol5m);
        }
      } catch (e) {}

      const avg5mVol = quoteVol / 288.0;
      const volSpike = vol5m / Math.max(avg5mVol, 1.0);

      const coin = {
        symbol: symbol,
        base_asset: symbol.replace('USDT', ''),
        last_price: lastPrice,
        high_5m: lastPrice,
        low_5m: lastPrice,
        price_chg_5m: pct5m,
        price_chg_1m: 0.0,
        price_chg_15m: pct5m,
        price_chg_24h: pct24h,
        vol_5m: vol5m,
        vol_24h: quoteVol,
        vol_spike: parseFloat(volSpike.toFixed(2)),
        surge_score: parseFloat((pct5m * 0.7 + Math.min(volSpike, 10) * 0.3).toFixed(2)),
        sparkline: [lastPrice, lastPrice],
        updated_at: now
      };

      state.marketData[symbol] = coin;
      state.historyBuffers[symbol] = [
        { ts: now - 300, price: lastPrice, quote_vol: Math.max(0, quoteVol - vol5m) },
        { ts: now, price: lastPrice, quote_vol: quoteVol }
      ];

      scheduleRender();
      return coin;
    } catch (err) {
      console.warn(`Could not load ticker for ${symbol}:`, err);
      return null;
    }
  }

  // --- Render Throttler ---
  let renderScheduled = false;
  let lastRenderTime = 0;
  function scheduleRender() {
    const now = performance.now();
    if (renderScheduled) return;

    const timeSinceLast = now - lastRenderTime;
    const delay = Math.max(0, 300 - timeSinceLast);

    renderScheduled = true;
    setTimeout(() => {
      requestAnimationFrame(() => {
        renderScheduled = false;
        lastRenderTime = performance.now();
        computeAndRenderClientSide();
      });
    }, delay);
  }

  // --- Feed Mode Determination ---
  function initDataFeed() {
    const isLocalhost = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';

    if (isLocalhost && window.location.port === '8000') {
      connectLocalWebSocket();
    } else {
      state.isDirectMode = true;
      connectDirectBinance();
    }
  }

  // --- Mode A: Local Python Server WebSocket ---
  function connectLocalWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    updateStatusUI(false, '正在連線至本地即時流...');

    if (state.ws) {
      try {
        state.ws.onopen = null;
        state.ws.onmessage = null;
        state.ws.onclose = null;
        state.ws.onerror = null;
        state.ws.close();
      } catch (e) {}
      state.ws = null;
    }

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
          if (msg.signals_5m) render5mSignals(msg.signals_5m);
          if (msg.top_5m && Array.isArray(msg.top_5m)) {
            const now = Date.now() / 1000;
            msg.top_5m.forEach(coin => {
              state.marketData[coin.symbol] = coin;
              if (coin.sparkline) {
                state.historyBuffers[coin.symbol] = coin.sparkline.map((p, i) => ({
                  ts: Date.now() - (coin.sparkline.length - i) * 20000,
                  price: p
                }));
              }
              checkCustomAlert(coin, now);
            });
          }
          if (state.activeModalSymbol && state.marketData[state.activeModalSymbol]) {
            updateModalDynamic(state.marketData[state.activeModalSymbol]);
          }
          scheduleRender();
        } else if (msg.type === 'ALERT') {
          if (state.alertRules.scope === 'all' || state.watchlist.has(msg.data.symbol)) {
            handleAlert(msg.data);
          }
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

    // Clean teardown of existing WS
    if (state.ws) {
      try {
        state.ws.onclose = null;
        state.ws.onerror = null;
        state.ws.onmessage = null;
        state.ws.close();
      } catch (e) {}
      state.ws = null;
    }

    try {
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
      const now = Date.now() / 1000;

      // Immediate baseline initialization: never leaves screen blank!
      topPairs.forEach(t => {
        vol24hMap[t.symbol] = parseFloat(t.quoteVolume);
        chg24hMap[t.symbol] = parseFloat(t.priceChangePercent);
        const s = t.symbol;
        if (!state.marketData[s]) {
          const lastP = parseFloat(t.lastPrice || 0);
          const qVol = parseFloat(t.quoteVolume || 0);
          state.marketData[s] = {
            symbol: s,
            base_asset: s.replace('USDT', ''),
            last_price: lastP,
            high_5m: lastP,
            low_5m: lastP,
            price_chg_5m: 0.0,
            price_chg_1m: 0.0,
            price_chg_15m: 0.0,
            price_chg_24h: chg24hMap[s] || 0.0,
            vol_5m: qVol / 288.0,
            vol_24h: qVol,
            vol_spike: 1.0,
            surge_score: 0.0,
            sparkline: [lastP, lastP],
            updated_at: now
          };
          state.historyBuffers[s] = [
            { ts: now - 300, price: lastP, quote_vol: Math.max(0, qVol - qVol / 288.0) },
            { ts: now, price: lastP, quote_vol: qVol }
          ];
        }
      });

      // Also ensure all watchlist coins are loaded
      state.watchlist.forEach(sym => {
        ensureCoinTracked(sym);
      });

      // Try 5m rolling window for top 100 pairs
      for (let i = 0; i < Math.min(topSymbols.length, 100); i += 50) {
        const batch = topSymbols.slice(i, i + 50);
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

      if (state.ws) {
        try {
          state.ws.onopen = null;
          state.ws.onmessage = null;
          state.ws.onclose = null;
          state.ws.onerror = null;
          state.ws.close();
        } catch (e) {}
        state.ws = null;
      }

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
      if (!s) return;

      // If user is monitoring this coin but it wasn't in top 150, register it dynamically
      if (!state.marketData[s]) {
        if (state.watchlist.has(s)) {
          const lastP = parseFloat(t.c);
          const qVol = parseFloat(t.q);
          state.marketData[s] = {
            symbol: s,
            base_asset: s.replace('USDT', ''),
            last_price: lastP,
            high_5m: lastP,
            low_5m: lastP,
            price_chg_5m: 0.0,
            price_chg_1m: 0.0,
            price_chg_15m: 0.0,
            price_chg_24h: 0.0,
            vol_5m: 0.0,
            vol_24h: qVol,
            vol_spike: 1.0,
            surge_score: 0.0,
            sparkline: [lastP],
            updated_at: now
          };
        } else {
          return;
        }
      }

      const lastPrice = parseFloat(t.c);
      const quoteVol24h = parseFloat(t.q);

      let buf = state.historyBuffers[s];
      if (!buf) {
        buf = [];
        state.historyBuffers[s] = buf;
      }

      buf.push({ ts: now, price: lastPrice, quote_vol: quoteVol24h });
      if (buf.length > 350) buf.splice(0, buf.length - 350);

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

      const recent = buf.filter(b => b.ts >= now - 300);
      const high5m = recent.length ? Math.max(...recent.map(r => r.price)) : lastPrice;
      const low5m = recent.length ? Math.min(...recent.map(r => r.price)) : lastPrice;

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

      // Check pump alert with custom user conditions and milestone support
      checkCustomAlert(coin, now);
    });

    if (state.activeModalSymbol && state.marketData[state.activeModalSymbol]) {
      updateModalDynamic(state.marketData[state.activeModalSymbol]);
    }

    scheduleRender();
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

  function computeAndRenderClientSide() {
    const coins = Object.values(state.marketData);
    if (!coins.length) return;

    const gaining = coins.filter(c => c.price_chg_5m > 0).length;
    const losing = coins.filter(c => c.price_chg_5m < 0).length;
    const bullRatio = (gaining / Math.max(coins.length, 1)) * 100;
    const total5mVol = coins.reduce((acc, c) => acc + (c.vol_5m || 0), 0);

    const sortedByGain = [...coins].filter(c => c.price_chg_5m > 0).sort((a, b) => b.price_chg_5m - a.price_chg_5m);
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
    const clientSignals = generateClient5mSignals();
    if (clientSignals) {
      render5mSignals(clientSignals);
    }
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

  // --- 5M Quantitative Strategy Signals Radar ---
  function generateClient5mSignals() {
    const coins = Object.values(state.marketData).filter(c => (c.vol_5m || 0) >= 1000);
    if (!coins.length) return null;

    const gainers = [...coins]
      .filter(c => (c.price_chg_5m || 0) > 0)
      .sort((a, b) => b.price_chg_5m - a.price_chg_5m)
      .slice(0, 5)
      .map(c => generateSignalData(c, true));

    const losers = [...coins]
      .filter(c => (c.price_chg_5m || 0) < 0)
      .sort((a, b) => a.price_chg_5m - b.price_chg_5m)
      .slice(0, 5)
      .map(c => generateSignalData(c, false));

    return {
      gainers,
      losers,
      updated_at: Date.now() / 1000
    };
  }

  function generateSignalData(coin, isGainer) {
    const sym = coin.symbol || '';
    const p = coin.last_price || 0;
    const chg5m = coin.price_chg_5m || 0;
    const chg1m = coin.price_chg_1m || 0;
    const h5 = coin.high_5m || p;
    const l5 = coin.low_5m || p;
    const vol5m = coin.vol_5m || 0;
    const volSpike = coin.vol_spike || 1.0;

    const span = h5 - l5;
    const pos = span > 1e-8 ? (p - l5) / span : 0.5;

    let action = '做多';
    let actionCode = 'LONG';
    let stars = 3;
    let tpPct = 3.0;
    let slPct = 1.5;
    let reason = '';

    if (isGainer) {
      if (pos < 0.4 && chg1m < 0) {
        action = '做空';
        actionCode = 'SHORT';
        stars = volSpike >= 4.0 ? 5 : (volSpike >= 2.0 ? 4 : 3);
        tpPct = Math.min(Math.max(Math.abs(chg5m) * 0.8, 2.5), 8.0);
        slPct = Math.max(((h5 - p) / Math.max(p, 1e-8)) * 100 * 1.1, 1.2);
        reason = '高位放量插針留長上影，衝高動能衰竭，反抽逢高摸頂空';
      } else if (pos >= 0.65 && chg1m >= 0) {
        action = '做多';
        actionCode = 'LONG';
        stars = volSpike >= 2.5 ? 5 : 4;
        tpPct = Math.min(Math.max(Math.abs(chg5m) * 0.9, 2.8), 7.0);
        slPct = Math.max(((p - l5) / Math.max(p, 1e-8)) * 100 * 0.8, 1.3);
        reason = '5M 放量突破強勢收高，多頭買盤充沛，順勢追多吃慣性';
      } else {
        action = chg1m >= 0 ? '做多' : '做空';
        actionCode = action === '做多' ? 'LONG' : 'SHORT';
        stars = 3;
        tpPct = Math.min(Math.max(Math.abs(chg5m) * 0.7, 2.0), 5.0);
        slPct = 1.5;
        reason = '5M 震盪推升中，多空爭奪激烈，輕倉試單控風險';
      }
    } else {
      if (pos > 0.5 && chg1m > 0) {
        action = '做多';
        actionCode = 'LONG';
        stars = volSpike >= 2.0 ? 4 : 3;
        tpPct = Math.min(Math.max(Math.abs(chg5m) * 0.8, 2.5), 6.0);
        slPct = Math.max(((p - l5) / Math.max(p, 1e-8)) * 100 * 1.1, 1.2);
        reason = '5M 急殺打出下影線支撐，短線空頭力竭，博超跌快速反彈';
      } else if (pos <= 0.35 && chg1m <= 0) {
        action = '做空';
        actionCode = 'SHORT';
        stars = (volSpike >= 2.5 || Math.abs(chg5m) >= 2.5) ? 5 : 4;
        tpPct = Math.min(Math.max(Math.abs(chg5m) * 0.9, 3.0), 8.0);
        slPct = Math.max(((h5 - p) / Math.max(p, 1e-8)) * 100 * 0.7, 1.4);
        reason = '5M 放量破位大陰線，貼近最低點，空方慣性下殺順勢空';
      } else {
        action = '做空';
        actionCode = 'SHORT';
        stars = 3;
        tpPct = Math.min(Math.max(Math.abs(chg5m) * 0.7, 2.2), 5.0);
        slPct = 1.5;
        reason = '5M 破位陰跌，反彈無量壓制明顯，逢高佈局空單';
      }
    }

    tpPct = parseFloat(tpPct.toFixed(1));
    slPct = parseFloat(slPct.toFixed(1));
    const rr = parseFloat((tpPct / Math.max(slPct, 0.1)).toFixed(1));

    return {
      symbol: sym,
      base_asset: coin.base_asset || sym.replace('USDT', ''),
      last_price: p,
      price_chg_5m: chg5m,
      price_chg_1m: chg1m,
      vol_5m: vol5m,
      vol_spike: volSpike,
      high_5m: h5,
      low_5m: l5,
      action,
      action_code: actionCode,
      stars,
      tp_pct: tpPct,
      sl_pct: slPct,
      rr_ratio: rr,
      reason
    };
  }

  function render5mSignals(signals) {
    if (!signals) return;

    if (el.signalsUpdateTime) {
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      el.signalsUpdateTime.textContent = `即時更新: ${timeStr}`;
    }

    if (signals.gainers && el.signalsPumpCards) {
      renderSignalCardsList(el.signalsPumpCards, signals.gainers, true);
    }

    if (signals.losers && el.signalsDumpCards) {
      renderSignalCardsList(el.signalsDumpCards, signals.losers, false);
    }
  }

  function renderSignalCardsList(container, list, isPump) {
    if (!list || !list.length) {
      container.innerHTML = `
        <div class="signals-loading-placeholder">
          <span>暫無充足成交量之標的</span>
        </div>`;
      return;
    }

    const html = list.map((item, idx) => {
      const isLong = item.action_code === 'LONG' || item.action === '做多';
      const actionClass = isLong ? 'action-long' : 'action-short';
      const actionText = isLong ? '🟢 建議做多 LONG' : '🔴 建議做空 SHORT';
      const chgClass = item.price_chg_5m >= 0 ? 'badge-pump' : 'badge-dump';
      const chgSign = item.price_chg_5m >= 0 ? '+' : '';
      const starIcons = '★'.repeat(item.stars) + '☆'.repeat(Math.max(0, 5 - item.stars));
      const cardTypeClass = isPump ? 'pump-card' : 'dump-card';

      return `
        <div class="signal-card ${cardTypeClass}" data-symbol="${item.symbol}" onclick="window.cyberpumpOpenSymbol('${item.symbol}')">
          <div class="signal-card-header">
            <div class="signal-token-left">
              <span class="signal-rank-badge">#${idx + 1}</span>
              <span class="signal-symbol">${item.base_asset}<span class="signal-symbol-sub">/USDT</span></span>
            </div>
            <div class="signal-price-right">
              <span class="signal-price">$${formatPrice(item.last_price)}</span>
              <span class="signal-chg-badge ${chgClass}">${chgSign}${item.price_chg_5m.toFixed(2)}%</span>
            </div>
          </div>
          <div class="signal-card-body">
            <div class="signal-action-row">
              <div class="signal-action-badge ${actionClass}">
                ${actionText}
              </div>
              <div class="signal-stars" title="信心評級: ${item.stars} 顆星">
                <span class="stars-icons">${starIcons}</span>
                <span class="stars-text">${item.stars}/5 顆星</span>
              </div>
            </div>
            <div class="signal-targets-grid">
              <div class="target-item target-tp">
                <span class="target-label">預期止盈 (TP)</span>
                <span class="target-val highlight-green">+${item.tp_pct}%</span>
              </div>
              <div class="target-item target-sl">
                <span class="target-label">建議止損 (SL)</span>
                <span class="target-val highlight-red">-${item.sl_pct}%</span>
              </div>
              <div class="target-item target-rr">
                <span class="target-label">盈虧比 (R:R)</span>
                <span class="target-val highlight-cyan">1 : ${item.rr_ratio}</span>
              </div>
            </div>
            <div class="signal-footer-row">
              <div class="signal-vol-info">
                <span>5M 成交: <strong>$${formatNumber(item.vol_5m)}</strong></span>
                <span class="signal-spike-tag">爆量 ${item.vol_spike.toFixed(1)}x</span>
              </div>
              <div class="signal-reason">
                💡 <strong>策略邏輯:</strong> ${item.reason}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = html;
  }

  // --- Rendering Market List / Table with In-Place Keyed Reconciliation ---
  function renderMarket() {
    let coins = Object.values(state.marketData);

    // Search filter
    if (state.searchQuery) {
      const q = state.searchQuery.toUpperCase();
      coins = coins.filter(c => c.symbol.includes(q) || c.base_asset.includes(q));
    }

    // Min volume filter
    if (state.minVolume > 0) {
      coins = coins.filter(c => c.vol_5m >= state.minVolume);
    }

    // Watchlist mode vs Discovery mode
    if (state.currentSort === 'watchlist') {
      // In Watchlist mode, show ALL coins the user chose to monitor!
      coins = coins.filter(c => state.watchlist.has(c.symbol));
      coins.sort((a, b) => (b.price_chg_5m || 0) - (a.price_chg_5m || 0));
    } else {
      // In Discovery mode, filter strictly positive gainers only
      coins = coins.filter(c => c.price_chg_5m > 0);
      coins.sort((a, b) => (b[state.currentSort] || 0) - (a[state.currentSort] || 0));
    }

    if (state.viewMode === 'table') {
      renderTable(coins.slice(0, 50));
    } else {
      renderCards(coins.slice(0, 36));
    }
  }

  function renderTable(coins) {
    if (!coins.length) {
      const msg = state.currentSort === 'watchlist' 
        ? '自選監控清單目前無幣種，請在上方輸入代碼或點擊熱門幣加入'
        : '無符合目前過濾條件的幣種';
      el.cryptoTbody.innerHTML = `
        <tr>
          <td colspan="11" class="loading-state">
            <span>${msg}</span>
          </td>
        </tr>`;
      return;
    }

    // If currently showing a loading-state tr, clear it first
    if (el.cryptoTbody.querySelector('.loading-state')) {
      el.cryptoTbody.innerHTML = '';
    }

    // Map existing rows by symbol
    const existingRows = new Map();
    const currentChildren = Array.from(el.cryptoTbody.children);
    currentChildren.forEach(child => {
      if (child.dataset && child.dataset.symbol) {
        existingRows.set(child.dataset.symbol, child);
      }
    });

    const targetSymbols = new Set(coins.map(c => c.symbol));

    // Remove rows not in coins
    currentChildren.forEach(child => {
      if (!child.dataset || !child.dataset.symbol || !targetSymbols.has(child.dataset.symbol)) {
        child.remove();
      }
    });

    coins.forEach((coin, idx) => {
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
      const isFav = state.watchlist.has(coin.symbol);

      let tr = existingRows.get(coin.symbol);

      if (tr) {
        // In-place update existing row elements: Zero DOM recreation!
        const rankEl = tr.querySelector('.col-rank');
        if (rankEl && rankEl.textContent !== String(rankNum)) {
          rankEl.textContent = rankNum;
          rankEl.className = `col-rank ${rankClass}`;
        }

        const monitorBtn = tr.querySelector('.btn-monitor');
        if (monitorBtn) {
          monitorBtn.className = `btn-monitor ${isFav ? 'active' : ''}`;
          monitorBtn.innerHTML = `<span class="bell-icon">${isFav ? '🔔' : '➕'}</span><span>${isFav ? '監控中' : '監控'}</span>`;
        }

        const priceEl = tr.querySelector('.price-text');
        if (priceEl) {
          priceEl.textContent = `$${formatPrice(coin.last_price)}`;
          if (flashClass) {
            priceEl.className = `price-text ${flashClass}`;
            setTimeout(() => { priceEl.className = 'price-text'; }, 600);
          }
        }

        const gainBadge = tr.querySelector('.gain-badge');
        if (gainBadge) {
          gainBadge.textContent = `${coin.price_chg_5m >= 0 ? '+' : ''}${coin.price_chg_5m.toFixed(2)}%`;
          gainBadge.className = `gain-badge ${chg5mClass}`;
        }

        const fillBar = tr.querySelector('.gain-mini-bar-fill');
        if (fillBar) {
          fillBar.style.width = `${Math.min(Math.abs(coin.price_chg_5m) * 15, 100)}%`;
          fillBar.className = `gain-mini-bar-fill ${chg5mClass}`;
        }

        const v1m = tr.querySelector('.col-chg1m .velocity-badge');
        if (v1m) {
          v1m.textContent = `${coin.price_chg_1m >= 0 ? '▲ +' : '▼ '}${coin.price_chg_1m.toFixed(2)}%`;
          v1m.className = `velocity-badge ${chg1mClass}`;
        }

        const v15m = tr.querySelector('.col-chg15m .velocity-badge');
        if (v15m) {
          v15m.textContent = `${coin.price_chg_15m >= 0 ? '+' : ''}${coin.price_chg_15m.toFixed(2)}%`;
          v15m.className = `velocity-badge ${chg15mClass}`;
        }

        const volEl = tr.querySelector('.col-vol5m');
        if (volEl) volEl.textContent = `$${formatNumber(coin.vol_5m)}`;

        const spikeEl = tr.querySelector('.col-spike .spike-badge');
        if (spikeEl) {
          spikeEl.textContent = `${isHotSpike ? '🔥 ' : ''}${coin.vol_spike.toFixed(1)}x`;
          spikeEl.className = `spike-badge ${spikeBadgeClass}`;
        }

        const sparkCell = tr.querySelector('.col-spark');
        if (sparkCell) sparkCell.innerHTML = sparkSvg;

      } else {
        // Create new TR
        tr = document.createElement('tr');
        tr.id = `row-${coin.symbol}`;
        tr.dataset.symbol = coin.symbol;
        tr.innerHTML = `
          <td class="col-fav">
            <button type="button" class="btn-monitor ${isFav ? 'active' : ''}" title="${isFav ? '點擊取消指定監控' : '點擊加入指定監控'}" onclick="window.cyberpumpToggleStar('${coin.symbol}', event)">
              <span class="bell-icon">${isFav ? '🔔' : '➕'}</span>
              <span>${isFav ? '監控中' : '監控'}</span>
            </button>
          </td>
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
          <td class="col-vol5m font-mono">$${formatNumber(coin.vol_5m)}</td>
          <td class="col-spike">
            <span class="spike-badge ${spikeBadgeClass}">${isHotSpike ? '🔥 ' : ''}${coin.vol_spike.toFixed(1)}x</span>
          </td>
          <td class="col-spark">${sparkSvg}</td>
          <td class="col-actions">
            <div class="action-links">
              <a href="https://www.binance.com/zh-TC/trade/${coin.symbol}?type=spot" target="_blank" class="btn-mini-trade" title="前往幣安交易" onclick="event.stopPropagation();">
                交易
              </a>
            </div>
          </td>
        `;
        tr.addEventListener('click', () => openModal(coin));
      }

      // Ensure proper DOM position without recreating nodes
      if (el.cryptoTbody.children[idx] !== tr) {
        el.cryptoTbody.insertBefore(tr, el.cryptoTbody.children[idx] || null);
      }
    });
  }

  function renderCards(coins) {
    if (!coins.length) {
      el.cardsContainer.innerHTML = '<div class="loading-state">無符合目前過濾條件的幣種</div>';
      return;
    }

    if (el.cardsContainer.querySelector('.loading-state')) {
      el.cardsContainer.innerHTML = '';
    }

    const existingCards = new Map();
    const currentChildren = Array.from(el.cardsContainer.children);
    currentChildren.forEach(child => {
      if (child.dataset && child.dataset.symbol) {
        existingCards.set(child.dataset.symbol, child);
      }
    });

    const targetSymbols = new Set(coins.map(c => c.symbol));
    currentChildren.forEach(child => {
      if (!child.dataset || !child.dataset.symbol || !targetSymbols.has(child.dataset.symbol)) {
        child.remove();
      }
    });

    coins.forEach((coin, idx) => {
      const chgClass = coin.price_chg_5m >= 0 ? 'positive' : 'negative';
      const sparkSvg = generateSparklineSvg(coin.sparkline, coin.price_chg_5m >= 0, 240, 36);
      const isFav = state.watchlist.has(coin.symbol);
      const isHotSpike = coin.vol_spike >= 3.0;

      let card = existingCards.get(coin.symbol);
      if (card) {
        const starBtn = card.querySelector('.btn-star');
        if (starBtn) {
          starBtn.className = `btn-star ${isFav ? 'active' : ''}`;
          starBtn.title = isFav ? '取消自選' : '加入自選';
        }
        const gainEl = card.querySelector('.card-gain');
        if (gainEl) {
          gainEl.textContent = `${coin.price_chg_5m >= 0 ? '+' : ''}${coin.price_chg_5m.toFixed(2)}%`;
          gainEl.className = `card-gain ${chgClass}`;
        }
        const priceEl = card.querySelector('.card-price');
        if (priceEl) priceEl.textContent = `$${formatPrice(coin.last_price)}`;

        const spikeEl = card.querySelector('.spike-badge');
        if (spikeEl) {
          spikeEl.textContent = `${isHotSpike ? '🔥 ' : ''}${coin.vol_spike.toFixed(1)}x`;
          spikeEl.className = `spike-badge ${isHotSpike ? 'spike-hot' : 'spike-normal'}`;
        }
        const sparkBox = card.querySelector('.card-sparkline-box');
        if (sparkBox) sparkBox.innerHTML = sparkSvg;

        const footer = card.querySelector('.card-footer');
        if (footer) {
          footer.innerHTML = `
            <span>5M量: $${formatNumber(coin.vol_5m)}</span>
            <span>1M: ${coin.price_chg_1m >= 0 ? '+' : ''}${coin.price_chg_1m.toFixed(2)}%</span>
          `;
        }
      } else {
        card = document.createElement('div');
        card.className = 'coin-card';
        card.dataset.symbol = coin.symbol;
        card.innerHTML = `
          <button type="button" class="btn-star ${isFav ? 'active' : ''}" style="position:absolute;top:12px;right:12px;z-index:2;" title="${isFav ? '取消自選' : '加入自選'}" onclick="window.cyberpumpToggleStar('${coin.symbol}', event)">
            ★
          </button>
          <div class="card-top-row" style="padding-right:26px;">
            <span class="card-symbol">${coin.base_asset}<small style="font-size:0.7em;color:var(--text-muted)">/USDT</small></span>
            <span class="card-gain ${chgClass}">${coin.price_chg_5m >= 0 ? '+' : ''}${coin.price_chg_5m.toFixed(2)}%</span>
          </div>
          <div class="card-mid-row">
            <span class="card-price">$${formatPrice(coin.last_price)}</span>
            <span class="spike-badge ${isHotSpike ? 'spike-hot' : 'spike-normal'}">
              ${isHotSpike ? '🔥 ' : ''}${coin.vol_spike.toFixed(1)}x
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
        card.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          openModal(state.marketData[coin.symbol] || coin);
        });
      }

      if (el.cardsContainer.children[idx] !== card) {
        el.cardsContainer.insertBefore(card, el.cardsContainer.children[idx] || null);
      }
    });
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

  function loadTradingViewWidget(symbol) {
    const box = document.getElementById('tradingview-embed-box');
    if (!box) return;
    box.innerHTML = '';
    const currentInterval = state.tvInterval || "5";

    function createWidget() {
      if (window.TradingView) {
        new window.TradingView.widget({
          autosize: true,
          symbol: `BINANCE:${symbol}`,
          interval: currentInterval,
          timezone: "Asia/Taipei",
          theme: "dark",
          style: "1",
          locale: "zh_TW",
          toolbar_bg: "#0e121b",
          enable_publishing: false,
          hide_top_toolbar: false,
          hide_legend: false,
          save_image: false,
          container_id: "tradingview-embed-box",
          studies: ["Volume@tv-basicstudies"]
        });
      } else {
        box.innerHTML = '<div style="color:var(--text-muted);display:flex;align-items:center;justify-content:center;height:100%;">TradingView 即時圖表載入中...</div>';
        setTimeout(() => {
          if (state.activeModalSymbol === symbol && window.TradingView) {
            createWidget();
          }
        }, 500);
      }
    }
    createWidget();
  }

  function updateModalDynamic(coin) {
    if (!coin || state.activeModalSymbol !== coin.symbol) return;

    el.modalPrice.textContent = `$${formatPrice(coin.last_price)}`;
    el.modalGain5m.textContent = `+${coin.price_chg_5m.toFixed(2)}%`;
    el.modalGain5m.className = `modal-gain-val highlight-green`;
    el.modalSpike.textContent = `${coin.vol_spike.toFixed(1)}x`;

    el.modalChg1m.textContent = `${coin.price_chg_1m >= 0 ? '+' : ''}${coin.price_chg_1m.toFixed(2)}%`;
    el.modalChg15m.textContent = `${coin.price_chg_15m >= 0 ? '+' : ''}${coin.price_chg_15m.toFixed(2)}%`;
    el.modalChg24h.textContent = `${coin.price_chg_24h >= 0 ? '+' : ''}${coin.price_chg_24h.toFixed(2)}%`;
    el.modalVol5m.textContent = `$${formatNumber(coin.vol_5m)}`;
    el.modalVol24h.textContent = `$${formatNumber(coin.vol_24h)}`;
    el.modalSurgeScore.textContent = `${coin.surge_score}`;
    el.modalChartRange.textContent = `5M 最高: $${formatPrice(coin.high_5m)} | 最低: $${formatPrice(coin.low_5m)}`;

    // If canvas tab is visible, continuously redraw canvas in real time
    if (state.activeChartTab === 'canvas') {
      const buf = state.historyBuffers[coin.symbol];
      if (buf && buf.length > 1) {
        drawCanvasChart(buf.map(b => b.price), coin.price_chg_5m >= 0);
      }
    }
  }

  async function openModal(coin) {
    if (!coin) return;
    state.activeModalSymbol = coin.symbol;

    el.modalSymbol.textContent = coin.symbol;
    updateModalStarButton(coin.symbol);
    updateModalTargetPriceUI(coin.symbol);
    updateModalDynamic(coin);

    // Sync active interval button state
    document.querySelectorAll('.btn-interval').forEach(btn => {
      if (btn.dataset.interval === (state.tvInterval || "5")) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    el.modalBinanceLink.href = `https://www.binance.com/zh-TC/trade/${coin.symbol}?type=spot`;
    el.modalTvLink.href = `https://www.tradingview.com/chart/?symbol=BINANCE:${coin.symbol}`;

    el.coinModal.style.display = 'flex';

    // Embed live TradingView widget
    loadTradingViewWidget(coin.symbol);

    // Also prepare Canvas Chart from history buffer
    const buf = state.historyBuffers[coin.symbol];
    if (buf && buf.length > 1) {
      drawCanvasChart(buf.map(b => b.price), coin.price_chg_5m >= 0);
    } else {
      drawCanvasChart(coin.sparkline || [coin.last_price], coin.price_chg_5m >= 0);
    }
  }

  function drawCanvasChart(prices, isPositive) {
    const canvas = el.modalCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    if (!prices || prices.length < 2) return;

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = (max - min) || 1;
    const padding = 25;

    const points = prices.map((p, i) => {
      const x = padding + (i / (prices.length - 1)) * (width - padding * 2);
      const y = height - padding - ((p - min) / range) * (height - padding * 2);
      return { x, y, p };
    });

    const grad = ctx.createLinearGradient(0, 0, 0, height);
    if (isPositive) {
      grad.addColorStop(0, 'rgba(0, 245, 160, 0.28)');
      grad.addColorStop(1, 'rgba(0, 245, 160, 0.0)');
    } else {
      grad.addColorStop(0, 'rgba(255, 56, 96, 0.28)');
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
    ctx.arc(last.x, last.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = isPositive ? '#00f5a0' : '#ff3860';
    ctx.lineWidth = 2.5;
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

  // --- Settings Modal Synchronization ---
  function openSettingsModal() {
    const rules = state.alertRules;
    if (rules.scope === 'watchlist') {
      el.scopeWatchlist.checked = true;
      el.labelScopeWatchlist.classList.add('active');
      el.labelScopeAll.classList.remove('active');
    } else {
      el.scopeAll.checked = true;
      el.labelScopeAll.classList.add('active');
      el.labelScopeWatchlist.classList.remove('active');
    }

    el.inputChg5m.value = rules.chg5m;
    el.valChg5m.textContent = `≥ ${rules.chg5m.toFixed(1)}%`;

    el.chkUse1m.checked = rules.use1m;
    el.inputChg1m.value = rules.chg1m;
    el.valChg1m.textContent = `≥ ${rules.chg1m.toFixed(1)}%`;

    el.chkUseSpike.checked = rules.useSpike;
    el.inputChgspike.value = rules.spike;
    el.valSpike.textContent = `≥ ${rules.spike.toFixed(1)}x`;

    el.selectMinvol.value = rules.minVol;
    el.chkSound.checked = rules.sound;
    el.chkDesktop.checked = rules.desktop;
    el.soundType.value = rules.soundType;

    updateWatchlistUI();
    el.alertSettingsModal.style.display = 'flex';
  }

  function saveSettingsFromUI() {
    state.alertRules.scope = el.scopeWatchlist.checked ? 'watchlist' : 'all';
    state.alertRules.chg5m = parseFloat(el.inputChg5m.value);
    state.alertRules.use1m = el.chkUse1m.checked;
    state.alertRules.chg1m = parseFloat(el.inputChg1m.value);
    state.alertRules.useSpike = el.chkUseSpike.checked;
    state.alertRules.spike = parseFloat(el.inputChgspike.value);
    state.alertRules.minVol = parseFloat(el.selectMinvol.value);
    state.alertRules.sound = el.chkSound.checked;
    state.alertRules.desktop = el.chkDesktop.checked;
    state.alertRules.soundType = el.soundType.value;

    state.soundEnabled = state.alertRules.sound;
    el.soundIcon.textContent = state.soundEnabled ? '🔊' : '🔇';
    el.soundLabel.textContent = `警報音效: ${state.soundEnabled ? '開' : '關'}`;
    el.btnSoundToggle.className = `nav-btn ${state.soundEnabled ? '' : 'sound-off'}`;

    if (el.radarThresholdVal) {
      el.radarThresholdVal.textContent = `${state.alertRules.chg5m.toFixed(1)}%`;
    }

    try {
      localStorage.setItem('cyberpump_alert_rules', JSON.stringify(state.alertRules));
    } catch (e) {}

    updateRulesSummaryUI();
    renderMarket();

    el.alertSettingsModal.style.display = 'none';
  }

  function setupEventListeners() {
    // Sound Toggle
    el.btnSoundToggle.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      state.alertRules.sound = state.soundEnabled;
      initAudio();
      el.soundIcon.textContent = state.soundEnabled ? '🔊' : '🔇';
      el.soundLabel.textContent = `警報音效: ${state.soundEnabled ? '開' : '關'}`;
      el.btnSoundToggle.className = `nav-btn ${state.soundEnabled ? '' : 'sound-off'}`;
      if (state.soundEnabled) playAlertSound();
      try {
        localStorage.setItem('cyberpump_alert_rules', JSON.stringify(state.alertRules));
      } catch (e) {}
    });

    // Alert Settings Button
    if (el.btnAlertSettings) {
      el.btnAlertSettings.addEventListener('click', openSettingsModal);
    }
    if (el.modalSettingsClose) {
      el.modalSettingsClose.addEventListener('click', () => el.alertSettingsModal.style.display = 'none');
    }
    if (el.btnSaveSettings) {
      el.btnSaveSettings.addEventListener('click', saveSettingsFromUI);
    }

    // Settings Radio Switcher
    if (el.scopeAll && el.scopeWatchlist) {
      el.scopeAll.addEventListener('change', () => {
        el.labelScopeAll.classList.add('active');
        el.labelScopeWatchlist.classList.remove('active');
      });
      el.scopeWatchlist.addEventListener('change', () => {
        el.labelScopeWatchlist.classList.add('active');
        el.labelScopeAll.classList.remove('active');
      });
    }

    // Sliders input events
    if (el.inputChg5m) {
      el.inputChg5m.addEventListener('input', (e) => {
        el.valChg5m.textContent = `≥ ${parseFloat(e.target.value).toFixed(1)}%`;
      });
    }
    if (el.inputChg1m) {
      el.inputChg1m.addEventListener('input', (e) => {
        el.valChg1m.textContent = `≥ ${parseFloat(e.target.value).toFixed(1)}%`;
      });
    }
    if (el.inputChgspike) {
      el.inputChgspike.addEventListener('input', (e) => {
        el.valSpike.textContent = `≥ ${parseFloat(e.target.value).toFixed(1)}x`;
      });
    }

    // Preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = parseFloat(btn.dataset.val);
        el.inputChg5m.value = val;
        el.valChg5m.textContent = `≥ ${val.toFixed(1)}%`;
      });
    });

    // Test Sound & Notification Buttons
    if (el.btnTestSound) {
      el.btnTestSound.addEventListener('click', () => {
        initAudio();
        playAlertSound(el.soundType.value);
      });
    }
    if (el.btnTestNotify) {
      el.btnTestNotify.addEventListener('click', () => {
        if (!("Notification" in window)) {
          alert('您的瀏覽器不支援桌面通知');
          return;
        }
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            new Notification('🔔 [測試警報] 桌面通知已啟用！', {
              body: '當市場幣種暴漲拉盤時，系統將即時發出桌面推播！'
            });
            el.chkDesktop.checked = true;
          } else {
            alert('桌面通知權限已被拒絕，請在瀏覽器網址列旁允許通知權限');
          }
        });
      });
    }

    // Clear Watchlist Button
    if (el.btnClearFav) {
      el.btnClearFav.addEventListener('click', () => {
        if (confirm('確定要清空所有自選關注幣種嗎？')) {
          state.watchlist.clear();
          saveWatchlist();
          updateWatchlistUI();
          renderMarket();
        }
      });
    }

    // Modal Star Button
    if (el.modalStarBtn) {
      el.modalStarBtn.addEventListener('click', () => {
        if (state.activeModalSymbol) {
          toggleWatchlist(state.activeModalSymbol);
        }
      });
    }

    // Quick Add Target Coin to Monitor
    function handleQuickAddCoin() {
      if (!el.quickCoinInput) return;
      let val = el.quickCoinInput.value.trim().toUpperCase();
      if (!val) return;
      if (!val.endsWith('USDT')) val += 'USDT';

      state.watchlist.add(val);
      saveWatchlist();
      updateWatchlistUI();
      el.quickCoinInput.value = '';
      ensureCoinTracked(val);
      renderMarket();
    }

    if (el.btnQuickAdd) el.btnQuickAdd.addEventListener('click', handleQuickAddCoin);
    if (el.quickCoinInput) {
      el.quickCoinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleQuickAddCoin();
      });
    }

    // One-Click Hot Recommendation Chips
    document.querySelectorAll('.chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sym = btn.dataset.sym;
        if (sym) {
          toggleWatchlist(sym);
          ensureCoinTracked(sym);
        }
      });
    });

    // Timeframe Interval Bar Selector for TradingView
    document.querySelectorAll('.btn-interval').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.btn-interval').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.tvInterval = btn.dataset.interval;
        if (state.activeModalSymbol) {
          loadTradingViewWidget(state.activeModalSymbol);
        }
      });
    });

    // Table Row Event Delegation (Eliminates click loss and recreation overhead)
    if (el.cryptoTbody) {
      el.cryptoTbody.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('a')) return;
        const tr = e.target.closest('tr');
        if (!tr || !tr.dataset || !tr.dataset.symbol) return;
        const sym = tr.dataset.symbol;
        if (state.marketData[sym]) {
          openModal(state.marketData[sym]);
        }
      });
    }

    // Scope Quick Switchers in Control Bar
    if (el.btnScopeAll) {
      el.btnScopeAll.addEventListener('click', () => {
        state.alertRules.scope = 'all';
        try { localStorage.setItem('cyberpump_alert_rules', JSON.stringify(state.alertRules)); } catch (e) {}
        updateRulesSummaryUI();
        renderMarket();
      });
    }

    if (el.btnScopeWatchlist) {
      el.btnScopeWatchlist.addEventListener('click', () => {
        state.alertRules.scope = 'watchlist';
        try { localStorage.setItem('cyberpump_alert_rules', JSON.stringify(state.alertRules)); } catch (e) {}
        updateRulesSummaryUI();
        state.currentSort = 'watchlist';
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        if (el.tabWatchlistBtn) el.tabWatchlistBtn.classList.add('active');
        renderMarket();
      });
    }

    // Quick Settings & Test Alarm Buttons in Status Box
    if (el.btnQuickSettings) {
      el.btnQuickSettings.addEventListener('click', openSettingsModal);
    }

    if (el.btnQuickTest) {
      el.btnQuickTest.addEventListener('click', () => {
        initAudio();
        const sampleCoin = Object.values(state.marketData)[0] || {
          symbol: 'SOLUSDT',
          base_asset: 'SOL',
          last_price: 154.20,
          price_chg_5m: 3.65,
          vol_spike: 4.2,
          vol_5m: 850000
        };
        const alertObj = {
          id: `test_${Date.now()}`,
          timestamp: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
          symbol: sampleCoin.symbol,
          base_asset: sampleCoin.base_asset,
          price: sampleCoin.last_price,
          price_chg_5m: sampleCoin.price_chg_5m || 3.5,
          price_chg_1m: 0.8,
          vol_5m: sampleCoin.vol_5m || 500000,
          vol_spike: sampleCoin.vol_spike || 3.5,
          type: 'PUMP'
        };
        handleAlert(alertObj);
      });
    }

    // Emergency Alarm Banner Actions
    if (el.alarmBtnUnmute) {
      el.alarmBtnUnmute.addEventListener('click', () => {
        initAudio();
        if (state.audioCtx && state.audioCtx.state === 'running') {
          el.alarmBtnUnmute.style.display = 'none';
          playAlertSound(state.alertRules.soundType);
        }
      });
    }

    // Modern browser autoplay audio context unlock on any interaction
    const unlockAudio = () => {
      initAudio();
      document.removeEventListener('click', unlockAudio);
      document.removeEventListener('keydown', unlockAudio);
      document.removeEventListener('touchstart', unlockAudio);
    };
    document.addEventListener('click', unlockAudio, { once: true });
    document.addEventListener('keydown', unlockAudio, { once: true });
    document.addEventListener('touchstart', unlockAudio, { once: true });

    if (el.alarmBtnInspect) {
      el.alarmBtnInspect.addEventListener('click', () => {
        if (state.activeAlarmCoin && state.marketData[state.activeAlarmCoin]) {
          openModal(state.marketData[state.activeAlarmCoin]);
        }
        if (el.alarmBanner) el.alarmBanner.style.display = 'none';
        stopTitleFlashing();
      });
    }

    if (el.alarmBtnStop) {
      el.alarmBtnStop.addEventListener('click', () => {
        if (el.alarmBanner) el.alarmBanner.style.display = 'none';
        stopTitleFlashing();
      });
    }

    window.addEventListener('focus', () => {
      stopTitleFlashing();
    });

    // Modal Target Price Save & Clear
    if (el.modalBtnSetTarget) {
      el.modalBtnSetTarget.addEventListener('click', () => {
        if (!state.activeModalSymbol || !el.modalTargetInput) return;
        const targetVal = parseFloat(el.modalTargetInput.value);
        if (isNaN(targetVal) || targetVal <= 0) {
          alert('請輸入有效的目標價格！');
          return;
        }
        state.targetPrices[state.activeModalSymbol] = targetVal;
        saveTargetPrices();
        updateModalTargetPriceUI(state.activeModalSymbol);
        state.watchlist.add(state.activeModalSymbol);
        saveWatchlist();
        updateWatchlistUI();
        renderMarket();
      });
    }

    if (el.modalBtnClearTarget) {
      el.modalBtnClearTarget.addEventListener('click', () => {
        if (!state.activeModalSymbol) return;
        delete state.targetPrices[state.activeModalSymbol];
        saveTargetPrices();
        updateModalTargetPriceUI(state.activeModalSymbol);
      });
    }

    // Settings Modal Profile Preset Chips (極速靈敏, 標準主力, 巨鯨暴拉)
    document.querySelectorAll('.profile-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.profile-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const p = chip.dataset.profile;
        if (p === 'sensitive') {
          el.inputChg5m.value = 1.0;
          el.valChg5m.textContent = '≥ 1.0%';
          el.chkUse1m.checked = true;
          el.inputChg1m.value = 0.2;
          el.valChg1m.textContent = '≥ 0.2%';
          el.chkUseSpike.checked = true;
          el.inputChgspike.value = 1.5;
          el.valSpike.textContent = '≥ 1.5x';
          el.selectMinvol.value = '5000';
        } else if (p === 'standard') {
          el.inputChg5m.value = 2.0;
          el.valChg5m.textContent = '≥ 2.0%';
          el.chkUse1m.checked = true;
          el.inputChg1m.value = 0.4;
          el.valChg1m.textContent = '≥ 0.4%';
          el.chkUseSpike.checked = true;
          el.inputChgspike.value = 2.0;
          el.valSpike.textContent = '≥ 2.0x';
          el.selectMinvol.value = '10000';
        } else if (p === 'whale') {
          el.inputChg5m.value = 4.0;
          el.valChg5m.textContent = '≥ 4.0%';
          el.chkUse1m.checked = true;
          el.inputChg1m.value = 0.8;
          el.valChg1m.textContent = '≥ 0.8%';
          el.chkUseSpike.checked = true;
          el.inputChgspike.value = 3.0;
          el.valSpike.textContent = '≥ 3.0x';
          el.selectMinvol.value = '50000';
        }
      });
    });

    // View Mode Toggle
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

    // Sort Tabs
    el.sortTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentSort = btn.dataset.sort;
      renderMarket();
    });

    // Min Volume Filter
    el.minVolFilter.addEventListener('change', (e) => {
      state.minVolume = parseFloat(e.target.value);
      renderMarket();
    });

    // Search Input
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

    // Chart Mode Tabs (TradingView vs Canvas)
    const tabTv = document.getElementById('tab-tv-chart');
    const tabCanvas = document.getElementById('tab-canvas-chart');
    const tvWrapper = document.getElementById('tv-chart-wrapper');
    const canvasSection = document.getElementById('canvas-chart-section');

    if (tabTv && tabCanvas) {
      tabTv.addEventListener('click', () => {
        tabTv.classList.add('active');
        tabCanvas.classList.remove('active');
        if (tvWrapper) tvWrapper.style.display = 'block';
        if (canvasSection) canvasSection.style.display = 'none';
        state.activeChartTab = 'tv';
      });

      tabCanvas.addEventListener('click', () => {
        tabCanvas.classList.add('active');
        tabTv.classList.remove('active');
        if (tvWrapper) tvWrapper.style.display = 'none';
        if (canvasSection) canvasSection.style.display = 'block';
        state.activeChartTab = 'canvas';
        if (state.activeModalSymbol && state.marketData[state.activeModalSymbol]) {
          const coin = state.marketData[state.activeModalSymbol];
          const buf = state.historyBuffers[coin.symbol];
          if (buf && buf.length > 1) {
            drawCanvasChart(buf.map(b => b.price), coin.price_chg_5m >= 0);
          }
        }
      });
    }

    // Fullscreen Toggle Button
    const fullscreenBtn = document.getElementById('modal-fullscreen-btn');
    const modalCard = document.getElementById('modal-card-element');
    if (fullscreenBtn && modalCard) {
      fullscreenBtn.addEventListener('click', () => {
        modalCard.classList.toggle('fullscreen');
        const isFull = modalCard.classList.contains('fullscreen');
        fullscreenBtn.textContent = isFull ? '🗗' : '⛶';
        fullscreenBtn.title = isFull ? '還原視窗大小' : '切換放大全螢幕視窗';
        
        if (state.activeChartTab === 'canvas' && state.activeModalSymbol) {
          setTimeout(() => {
            const canvas = el.modalCanvas;
            if (canvas && canvas.parentElement) {
              canvas.width = canvas.parentElement.clientWidth || 900;
              const coin = state.marketData[state.activeModalSymbol];
              const buf = state.historyBuffers[coin.symbol];
              if (buf && buf.length > 1) {
                drawCanvasChart(buf.map(b => b.price), coin.price_chg_5m >= 0);
              }
            }
          }, 100);
        }
      });
    }

    // Coin Modal Close
    el.modalClose.addEventListener('click', () => {
      el.coinModal.style.display = 'none';
      state.activeModalSymbol = null;
    });

    el.coinModal.addEventListener('click', (e) => {
      if (e.target === el.coinModal) {
        el.coinModal.style.display = 'none';
        state.activeModalSymbol = null;
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (el.alertSettingsModal.style.display === 'flex') {
          el.alertSettingsModal.style.display = 'none';
        } else if (el.coinModal.style.display === 'flex') {
          el.coinModal.style.display = 'none';
          state.activeModalSymbol = null;
        }
      }
    });
  }

  async function loadInitialSignals() {
    const isLocalhost = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
    if (isLocalhost && window.location.port === '8000') {
      try {
        const res = await fetch('/api/signals/5m');
        if (res.ok) {
          const data = await res.json();
          render5mSignals(data);
        }
      } catch (e) {}
    }
  }

  function init() {
    setupEventListeners();
    updateWatchlistUI();
    if (state.watchlist && state.watchlist.size > 0) {
      state.watchlist.forEach(sym => {
        ensureCoinTracked(sym);
      });
    }
    initDataFeed();
    loadInitialSignals();
  }

  window.addEventListener('DOMContentLoaded', init);
})();
