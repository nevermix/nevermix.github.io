/* ===== app.js — 應用層：事件綁定、畫面更新、所有視圖渲染 ===== */
'use strict';

(function () {
  /* ─── 安全取元素 ─── */
  function $(id) { return document.getElementById(id); }
  function $el(sel) { return document.querySelector(sel); }
  function $$el(sel) { return document.querySelectorAll(sel); }

  /* ─── XSS 防護 ─── */
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ─── 前置檢查 ─── */
  if (typeof MozeData === 'undefined' || typeof MozeCharts === 'undefined') {
    document.body.innerHTML = '<div style="padding:40px;color:#e57373;font-size:18px">錯誤：MozeData 或 MozeCharts 未載入，請確認 JS 檔案引入順序。</div>';
    return;
  }

  /* ─── 全局狀態 ─── */
  let currentView = 'overview';
  let rangeStart = '';
  let rangeEnd = '';
  let calMonth = MozeData.monthKey(MozeData.today());
  let selectedProjectId = '';
  let reportRange = 1;
  let currentUser = null;
  let globalErrorBound = false;
  let selectedStockKey = '';
  let stockQuotesCache = {};
  let stockQuotesLoading = false;
  let stockQuotesReady = false;
  let datePickerTarget = null;
  let datePickerMonth = '';
  let currentMorePane = 'general';
  const HOT_STOCKS = [
    { market: 'TWSE', symbol: '2330', name: '台積電' },
    { market: 'TWSE', symbol: '0050', name: '元大台灣50' },
    { market: 'TWSE', symbol: '0056', name: '元大高股息' },
    { market: 'TWSE', symbol: '2317', name: '鴻海' },
    { market: 'TWSE', symbol: '2412', name: '中華電' },
  ];

  function openAuthModal() {
    const overlay = $('auth-modal-overlay');
    if (overlay) overlay.classList.add('open');
    if (typeof MozeSync !== 'undefined') MozeSync.initGoogleSignIn();
    updateAuthPanel();
  }

  function closeAuthModal() {
    const overlay = $('auth-modal-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  function updateAuthPanel() {
    const isLoggedIn = !!currentUser;
    const isAdmin = typeof MozeSync !== 'undefined' && typeof MozeSync.isAdmin === 'function' && MozeSync.isAdmin(currentUser);
    const userName = $('user-name');
    const userAvatar = $('user-avatar');
    const triggerBtn = $('btn-open-auth-modal');
    const localWarning = $('local-mode-warning');
    const modeLabel = $('auth-mode-label');
    const modeCopy = $('auth-mode-copy');
    const guestBtn = $('btn-continue-guest');
    const signOutBtn = $('btn-sign-out');
    const deleteUserBtn = $('btn-delete-user-account');
    const errorNav = $('nav-errorlogs');

    if (userName) userName.textContent = isLoggedIn ? (currentUser.displayName || currentUser.email || '已登入') : '本機模式';
    if (triggerBtn) triggerBtn.textContent = isLoggedIn ? '帳號' : '連線';

    if (userAvatar) {
      if (isLoggedIn && currentUser.photoURL) {
        userAvatar.src = currentUser.photoURL;
        userAvatar.style.display = 'block';
      } else {
        userAvatar.removeAttribute('src');
        userAvatar.style.display = 'none';
      }
    }

    if (modeLabel) modeLabel.textContent = isLoggedIn ? '目前為 Google 雲端同步模式' : '目前為本機模式';
    if (modeCopy) modeCopy.textContent = isLoggedIn
      ? '已登入後，資料會同步到你的 Firebase 帳號空間。登出後會停留在本機模式。'
      : '未登入時資料只會留在這台裝置，不會同步到雲端。';
    if (guestBtn) guestBtn.style.display = isLoggedIn ? 'none' : '';
    if (signOutBtn) signOutBtn.style.display = isLoggedIn ? '' : 'none';
    if (deleteUserBtn) deleteUserBtn.style.display = isLoggedIn ? '' : 'none';
    if (errorNav) errorNav.style.display = isAdmin ? '' : 'none';
    if (localWarning) localWarning.style.display = isLoggedIn ? 'none' : '';
    if (!isAdmin && currentView === 'errorlogs') switchView('overview');
  }

  function formatDateTime(isoText) {
    if (!isoText) return '';
    const d = new Date(isoText);
    if (Number.isNaN(d.getTime())) return esc(isoText);
    return d.toLocaleString('zh-TW');
  }

  function stockSymbolLabel(symbol, market) {
    return `${symbol}${market === 'TPEx' ? ' .TWO' : ' .TW'}`;
  }

  function stockKey(symbol, market) {
    return `${market === 'TPEx' ? 'TPEx' : 'TWSE'}:${String(symbol || '').toUpperCase()}`;
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function isoFromDate(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function parseIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function monthLabel(monthValue) {
    const date = parseIsoDate(`${monthValue}-01`);
    if (!date) return monthValue;
    return `${date.getFullYear()} / ${pad2(date.getMonth() + 1)}`;
  }

  function parseStockQuotesMap(raw) {
    const map = {};
    Object.keys(raw || {}).forEach(market => {
      const bucket = raw[market] || {};
      Object.keys(bucket).forEach(symbol => {
        const entry = bucket[symbol] || {};
        const historyObj = entry.history || {};
        const history = Object.keys(historyObj)
          .sort((a, b) => a.localeCompare(b))
          .map(date => ({
            date,
            close: parseFloat(historyObj[date] && historyObj[date].close) || 0,
          }));
        map[stockKey(symbol, market)] = {
          symbol,
          market: entry.market || market || 'TWSE',
          name: entry.name || symbol,
          latestClose: Number.isFinite(parseFloat(entry.latestClose)) ? parseFloat(entry.latestClose) : null,
          latestDate: entry.latestDate || '',
          updatedAt: entry.updatedAt || '',
          history,
        };
      });
    });
    return map;
  }

  function loadStockQuotes(force) {
    if (typeof MozeSync === 'undefined' || typeof MozeSync.fetchStockQuotes !== 'function') {
      stockQuotesCache = {};
      stockQuotesReady = false;
      return Promise.resolve({});
    }
    if (!force && stockQuotesReady && Object.keys(stockQuotesCache).length) {
      return Promise.resolve(stockQuotesCache);
    }
    if (stockQuotesLoading) return Promise.resolve(stockQuotesCache);

    stockQuotesLoading = true;
    return new Promise(function (resolve) {
      MozeSync.fetchStockQuotes(function (err, data) {
        stockQuotesLoading = false;
        if (!err) {
          stockQuotesCache = parseStockQuotesMap(data || {});
          stockQuotesReady = true;
        }
        resolve(stockQuotesCache);
      });
    });
  }

  function closeDatePicker() {
    datePickerTarget = null;
    const overlay = $('date-picker-overlay');
    if (overlay) {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
    }
  }

  function setDateInputValue(input, value) {
    if (!input) return;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function renderDatePicker() {
    const titleEl = $('date-picker-title');
    const gridEl = $('date-picker-grid');
    if (!datePickerTarget || !titleEl || !gridEl) return;

    const baseDate = parseIsoDate(`${datePickerMonth}-01`) || new Date(`${MozeData.monthKey(MozeData.today())}-01T00:00:00`);
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const leading = firstDay.getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const prevDays = new Date(year, month, 0).getDate();
    const selectedValue = datePickerTarget.value || '';
    const todayValue = MozeData.today();

    titleEl.textContent = monthLabel(`${year}-${pad2(month + 1)}`);
    gridEl.innerHTML = '';

    for (let i = 0; i < 42; i += 1) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'date-picker-day';

      let dateValue = '';
      if (i < leading) {
        const day = prevDays - leading + i + 1;
        btn.classList.add('muted');
        dateValue = isoFromDate(new Date(year, month - 1, day));
        btn.textContent = String(day);
      } else if (i < leading + days) {
        const day = i - leading + 1;
        dateValue = isoFromDate(new Date(year, month, day));
        btn.textContent = String(day);
      } else {
        const day = i - leading - days + 1;
        btn.classList.add('muted');
        dateValue = isoFromDate(new Date(year, month + 1, day));
        btn.textContent = String(day);
      }

      if (dateValue === todayValue) btn.classList.add('today');
      if (dateValue === selectedValue) btn.classList.add('selected');

      btn.addEventListener('click', function () {
        if (!datePickerTarget) return;
        setDateInputValue(datePickerTarget, dateValue);
        closeDatePicker();
      });
      gridEl.appendChild(btn);
    }
  }

  function openDatePicker(input) {
    if (!input) return;
    datePickerTarget = input;
    datePickerMonth = MozeData.monthKey(input.value || MozeData.today());
    const overlay = $('date-picker-overlay');
    if (overlay) {
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
    }
    renderDatePicker();
  }

  function getFeedbackStatusBaseText() {
    return currentUser
      ? '送出後會連同登入帳號資訊一起附上。'
      : '未登入也可以送出。';
  }

  const QUERY_CATEGORY_ALIASES = {
    '餐飲': ['吃飯', '吃', '飲食', '餐費', '早餐', '午餐', '晚餐', '宵夜', '便當', '餐廳', '咖啡'],
    '交通': ['交通', '搭車', '捷運', '公車', '計程車', '高鐵', '火車', '油錢', '停車'],
    '購物': ['購物', '買東西', '網購', '蝦皮', 'momo'],
    '娛樂': ['娛樂', '電影', '遊戲', '唱歌', '出遊'],
    '醫療': ['醫療', '看病', '診所', '醫院', '藥'],
    '帳單': ['帳單', '水電', '電話費', '房租', '保費'],
    '其他': ['其他', '雜項'],
    '薪資': ['薪資', '薪水', '收入', '薪金']
  };

  function formatLocalDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function startOfWeek(date) {
    const copy = new Date(date);
    const day = copy.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    copy.setDate(copy.getDate() + diff);
    return copy;
  }

  function endOfWeek(date) {
    const copy = startOfWeek(date);
    copy.setDate(copy.getDate() + 6);
    return copy;
  }

  function resolveNamedCategory(query) {
    const categories = MozeData.getState().categories || [];
    const direct = categories.find(c => query.includes(String(c.name || '').toLowerCase()));
    if (direct) return direct;

    return categories.find(c => {
      const aliases = QUERY_CATEGORY_ALIASES[c.name] || [];
      return aliases.some(alias => query.includes(alias.toLowerCase()));
    }) || null;
  }

  function resolveNamedAccount(query) {
    return (MozeData.getState().accounts || []).find(a =>
      query.includes(String(a.name || '').toLowerCase())
    ) || null;
  }

  function resolveQueryRange(query) {
    const now = new Date();
    let start = new Date(now);
    let end = new Date(now);
    let label = '今天';

    if (query.includes('昨天')) {
      start.setDate(start.getDate() - 1);
      end = new Date(start);
      label = '昨天';
    } else if (query.includes('上週')) {
      const lastWeekBase = startOfWeek(now);
      lastWeekBase.setDate(lastWeekBase.getDate() - 7);
      start = lastWeekBase;
      end = endOfWeek(lastWeekBase);
      label = '上週';
    } else if (query.includes('本週') || query.includes('這週')) {
      start = startOfWeek(now);
      end = endOfWeek(now);
      label = '本週';
    } else if (query.includes('上個月') || query.includes('上月')) {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
      label = '上個月';
    } else if (query.includes('本月') || query.includes('這個月')) {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      label = '本月';
    } else if (/近 ?3 ?個?月|最近 ?3 ?個?月|近三個月|最近三個月/.test(query)) {
      start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      label = '近 3 個月';
    }

    return {
      start: formatLocalDate(start),
      end: formatLocalDate(end),
      label,
    };
  }

  function hasExplicitRange(query) {
    return /今天|昨天|本週|這週|上週|本月|這個月|上個月|上月|近 ?3 ?個?月|最近 ?3 ?個?月|近三個月|最近三個月/.test(query);
  }

  function detectQueryIntent(query) {
    if (/月報表|報表|圓餅圖|圓餅|分布|分析/.test(query)) return 'report';
    if (/幾筆|多少筆/.test(query)) return 'count';
    if (/收入|賺|進帳/.test(query)) return 'income';
    if (/花多少|花了多少|支出多少|花費多少|用了多少|花了|支出|花費/.test(query)) return 'expense';
    if (/多少/.test(query)) return 'expense';
    return '';
  }

  function parseNaturalLanguageQuery(rawQuery) {
    const query = rawQuery.trim().toLowerCase().replace(/[？?]/g, '');
    if (!query) return null;

    const intent = detectQueryIntent(query);
    const category = resolveNamedCategory(query);
    const account = resolveNamedAccount(query);
    const range = intent === 'report' && !hasExplicitRange(query)
      ? resolveQueryRange('本月')
      : resolveQueryRange(query);

    if (!intent || (intent !== 'report' && !category && !account && !hasExplicitRange(query))) {
      return null;
    }

    return { intent, category, account, range };
  }

  function answerNaturalLanguageQuery(rawQuery) {
    const parsed = parseNaturalLanguageQuery(rawQuery);
    if (!parsed) return null;
    const normalizedQuery = rawQuery.trim().toLowerCase().replace(/[？?]/g, '');
    const accountId = parsed.account ? parsed.account.id : 'all';

    let txs = MozeData.txInRange(parsed.range.start, parsed.range.end, accountId);
    let items = MozeData.txItemsInRange(parsed.range.start, parsed.range.end, accountId);
    if (parsed.category) {
      items = items.filter(t => t.categoryId === parsed.category.id);
      const matchedIds = new Set(items.map(item => item.txId));
      txs = txs.filter(t => matchedIds.has(t.id));
    }

    let labelType = '交易';
    if (parsed.intent === 'count') {
      if (/收入|賺|進帳/.test(normalizedQuery)) {
        txs = txs.filter(t => t.type === 'income');
        items = items.filter(t => t.type === 'income');
        labelType = '收入';
      } else if (/花|支出|花費/.test(normalizedQuery)) {
        txs = txs.filter(t => t.type === 'expense');
        items = items.filter(t => t.type === 'expense');
        labelType = '支出';
      }
    } else if (parsed.intent === 'income') {
      txs = txs.filter(t => t.type === 'income');
      items = items.filter(t => t.type === 'income');
      labelType = '收入';
    } else {
      txs = txs.filter(t => t.type === 'expense');
      items = items.filter(t => t.type === 'expense');
      labelType = '支出';
    }

    const targetLabel = parsed.category ? parsed.category.name : (parsed.account ? parsed.account.name : labelType);
    const meta = `${parsed.range.label}｜${parsed.range.start} ~ ${parsed.range.end}`;

    if (parsed.intent === 'report') {
      const summary = MozeData.summary(parsed.range.start, parsed.range.end, accountId);
      const categoryData = MozeData.expenseByCategory(parsed.range.start, parsed.range.end, accountId);
      const reportTxs = txs.filter(t => t.type === 'expense');
      return {
        text: `${parsed.range.label}月報表已整理`,
        meta: `${meta}｜支出 ${MozeData.formatMoney(summary.expense)}｜收入 ${MozeData.formatMoney(summary.income)}`,
        txs: reportTxs,
        visuals: {
          summary,
          categoryData,
          title: parsed.account ? `${parsed.range.label} ${parsed.account.name} 分類圓餅圖` : `${parsed.range.label} 分類圓餅圖`,
        }
      };
    }

    if (parsed.intent === 'count') {
      return {
        text: `${parsed.range.label}${targetLabel}共有 ${items.length} 筆`,
        meta,
        txs,
      };
    }

    const total = items.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);
    return {
      text: `${parsed.range.label}${targetLabel}${labelType}共 ${MozeData.formatMoney(total)}`,
      meta: `${meta}｜共 ${items.length} 筆`,
      txs,
    };
  }

  function renderSearchVisuals(visuals) {
    const container = $('search-visuals');
    if (!container) return;
    if (!visuals) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="search-visuals-grid">
        <div class="search-summary-card">
          <div class="search-summary-title">月報表摘要</div>
          <div class="search-summary-metric"><span>支出</span><span>${esc(MozeData.formatMoney(visuals.summary.expense))}</span></div>
          <div class="search-summary-metric"><span>收入</span><span>${esc(MozeData.formatMoney(visuals.summary.income))}</span></div>
          <div class="search-summary-metric"><span>筆數</span><span>${esc(String(visuals.summary.count))}</span></div>
          <div class="search-summary-metric"><span>日均支出</span><span>${esc(MozeData.formatMoney(visuals.summary.daily))}</span></div>
        </div>
        <div class="search-chart-card">
          <div class="search-chart-title">${esc(visuals.title)}</div>
          <div id="search-donut-chart"></div>
        </div>
      </div>
    `;

    const donut = $('search-donut-chart');
    if (donut) {
      MozeCharts.donut(donut, visuals.categoryData, { centerLabel: '支出' });
    }
  }

  function recordClientError(payload) {
    if (typeof MozeSync !== 'undefined' && typeof MozeSync.logError === 'function') {
      MozeSync.logError(payload);
      return;
    }
    if (typeof MozeTelemetry !== 'undefined' && typeof MozeTelemetry.captureError === 'function') {
      MozeTelemetry.captureError(payload);
    }
  }

  function bindGlobalErrorHandlers() {
    if (globalErrorBound) return;
    globalErrorBound = true;

    window.addEventListener('error', function (event) {
      recordClientError({
        source: 'window.onerror',
        message: event && event.message ? event.message : 'Unhandled error',
        stack: event && event.error && event.error.stack ? event.error.stack : '',
        context: event && event.filename ? `${event.filename}:${event.lineno || 0}:${event.colno || 0}` : '',
      });
    });

    window.addEventListener('unhandledrejection', function (event) {
      const reason = event && event.reason;
      recordClientError({
        source: 'unhandledrejection',
        message: reason && reason.message ? reason.message : String(reason || 'Promise rejected'),
        stack: reason && reason.stack ? reason.stack : '',
      });
    });
  }

  function initRange() {
    const t = MozeData.today();
    const mk = MozeData.monthKey(t);
    const { y, m } = MozeData.parseMonth(mk);
    rangeStart = `${mk}-01`;
    rangeEnd = `${mk}-${String(MozeData.daysInMonth(y, m)).padStart(2, '0')}`;
    const rs = $('range-start');
    const re = $('range-end');
    if (rs) rs.value = rangeStart;
    if (re) re.value = rangeEnd;
  }

  /* ─── 視圖切換 ─── */
  function switchView(name) {
    currentView = name;
    $$el('.view').forEach(v => v.classList.remove('active'));
    const target = $('view-' + name);
    if (target) target.classList.add('active');
    $$el('.sidebar-nav .nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));
    $$el('.bottom-nav .bnav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));
    const titles = { overview: '概覽', accounts: '帳戶', stocks: '股票', ledger: '流水帳', reports: '報表', projects: '專案', search: '搜尋', feedback: '意見反饋', errorlogs: '開發者欄位', settings: '更多功能' };
    const tt = $('topbar-title');
    if (tt) tt.textContent = titles[name] || name;
    refreshCurrentView();
  }

  function switchMorePane(name) {
    currentMorePane = name || 'general';
    $$el('.more-nav-item').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.morePaneNav === currentMorePane);
    });
    $$el('.more-pane').forEach(function (pane) {
      pane.classList.toggle('active', pane.dataset.morePane === currentMorePane);
    });
  }

  /* ─── 刷新所有 ─── */
  function refreshAll() {
    try {
      refreshCurrentView();
    } catch (e) {
      recordClientError({
        source: 'app.refreshAll',
        message: e && e.message ? e.message : 'refreshAll failed',
        stack: e && e.stack ? e.stack : '',
      });
      console.warn('refreshAll:', e.message);
    }
  }

  function refreshCurrentView() {
    switch (currentView) {
      case 'overview': renderOverview(); break;
      case 'accounts': renderAccounts(); break;
      case 'stocks': renderStocks(); break;
      case 'ledger': renderLedger(); break;
      case 'reports': renderReports(); break;
      case 'projects': renderProjects(); break;
      case 'search': renderSearch(); break;
      case 'feedback': renderFeedback(); break;
      case 'errorlogs': renderErrorLogs(); break;
      case 'settings': renderSettings(); break;
    }
  }

  /* ═══════════════════════════════════════ */
  /*             ① 概覽頁                    */
  /* ═══════════════════════════════════════ */
  function renderOverview() {
    const s = MozeData.getState();
    const accId = s.activeAccountId;
    const cur = MozeData.summary(rangeStart, rangeEnd, accId);

    const days = Math.round((new Date(rangeEnd) - new Date(rangeStart)) / 86400000) + 1;
    const prevEnd = new Date(new Date(rangeStart).getTime() - 86400000).toISOString().slice(0, 10);
    const prevStart = new Date(new Date(prevEnd).getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
    const prev = MozeData.summary(prevStart, prevEnd, accId);

    const setVal = (id, val) => { const e = $(id); if (e) e.textContent = val; };
    const setClass = (id, cls) => { const e = $(id); if (e) e.className = 'card-change ' + cls; };

    setVal('ov-balance', MozeData.formatMoney(cur.balance));
    setVal('ov-expense', MozeData.formatMoney(cur.expense));
    setVal('ov-income', MozeData.formatMoney(cur.income));

    function pctChange(cur, prev, id) {
      if (!prev) { setVal(id, ''); return; }
      const pct = ((cur - prev) / (prev || 1) * 100).toFixed(1);
      const arrow = pct >= 0 ? '▲' : '▼';
      setVal(id, `${arrow} ${Math.abs(pct)}% vs 上期`);
      setClass(id, pct >= 0 ? 'up' : 'down');
    }
    pctChange(cur.balance, prev.balance, 'ov-balance-change');
    pctChange(cur.expense, prev.expense, 'ov-expense-change');
    pctChange(cur.income, prev.income, 'ov-income-change');

    const comboContainer = $('ov-combo-chart');
    if (comboContainer) {
      const balanceData = MozeData.accountBalanceOverTime(accId, rangeStart, rangeEnd);
      MozeCharts.accountTrend(comboContainer, balanceData, { color: '#67c6f3' });
    }

    renderCalendar();
    renderUpcoming();
  }

  function renderCalendar() {
    const grid = $('cal-grid');
    const title = $('cal-title');
    if (!grid || !title) return;
    title.textContent = calMonth;
    const { y, m } = MozeData.parseMonth(calMonth);
    const dim = MozeData.daysInMonth(y, m);
    const firstDay = new Date(y, m - 1, 1).getDay();
    const txDates = MozeData.datesWithTx(calMonth, MozeData.getState().activeAccountId);
    const todayStr = MozeData.today();

    const heads = ['日', '一', '二', '三', '四', '五', '六'];
    let html = heads.map(h => `<div class="cal-head">${h}</div>`).join('');
    for (let i = 0; i < firstDay; i++) html += '<div class="cal-day empty"></div>';
    for (let d = 1; d <= dim; d++) {
      const ds = `${calMonth}-${String(d).padStart(2, '0')}`;
      const cls = ['cal-day'];
      if (txDates.has(ds)) cls.push('has-tx');
      if (ds === todayStr) cls.push('today');
      html += `<div class="${cls.join(' ')}" data-date="${ds}">${d}</div>`;
    }
    grid.innerHTML = html;
    grid.querySelectorAll('.cal-day:not(.empty)').forEach(el => {
      el.addEventListener('click', () => {
        const d = el.dataset.date;
        const rs = $('range-start');
        const re = $('range-end');
        if (rs) rs.value = d;
        if (re) re.value = d;
        rangeStart = d;
        rangeEnd = d;
        refreshAll();
      });
    });
  }

  function renderUpcoming() {
    const list = $('upcoming-list');
    if (!list) return;
    const s = MozeData.getState();
    if (!s.upcoming.length) {
      list.innerHTML = '<div class="empty-state"><p>尚無提醒</p></div>';
      return;
    }
    list.innerHTML = s.upcoming.sort((a, b) => a.nextDate.localeCompare(b.nextDate)).map(u => `
      <div class="upcoming-item">
        <div class="upcoming-info">
          <span>${esc(u.title) || '提醒'}</span>
          <span class="upcoming-date">${esc(u.nextDate)} · ${esc(MozeData.acctName(u.accountId))}</span>
        </div>
        <span class="upcoming-amount" style="color:${u.type === 'income' ? 'var(--green)' : 'var(--red)'}">
          ${u.type === 'income' ? '+' : '-'}${MozeData.formatMoney(u.amount)}
        </span>
        <button class="btn-icon" data-del-up="${esc(u.id)}" title="刪除">✕</button>
      </div>
    `).join('');
    list.querySelectorAll('[data-del-up]').forEach(btn => {
      btn.addEventListener('click', () => {
        MozeData.deleteUpcoming(btn.dataset.delUp);
        renderUpcoming();
      });
    });
  }

  /* ═══════════════════════════════════════ */
  /*             ② 帳戶頁                    */
  /* ═══════════════════════════════════════ */
  function renderAccounts() {
    const s = MozeData.getState();
    const nw = $('acc-net-worth');
    const ta = $('acc-total-assets');
    const tl = $('acc-total-liab');
    if (nw) nw.textContent = MozeData.formatMoney(MozeData.netWorth());
    if (ta) ta.textContent = MozeData.formatMoney(MozeData.totalAssets());
    if (tl) tl.textContent = MozeData.formatMoney(MozeData.totalLiabilities());

    const groupList = $('acc-group-list');
    if (groupList) {
      let html = '';
      MozeData.ACCOUNT_GROUPS.forEach(g => {
        const accs = s.accounts.filter(a => a.group === g);
        if (!accs.length) return;
        html += `<div class="account-group-title">${esc(g)}</div>`;
        accs.forEach(a => {
          const bal = MozeData.accountBalance(a.id);
          const sel = a.id === s.selectedAccountId ? ' selected' : '';
          html += `<div class="account-list-item${sel}" data-acc-id="${esc(a.id)}">
            <span class="acc-name"><span>${esc(a.icon)}</span> ${esc(a.name)}</span>
            <span class="acc-balance" style="color:${bal >= 0 ? 'var(--green)' : 'var(--red)'}">${MozeData.formatMoney(bal)}</span>
          </div>`;
        });
      });
      groupList.innerHTML = html;
      groupList.querySelectorAll('.account-list-item').forEach(el => {
        el.addEventListener('click', () => {
          MozeData.setSelectedAccount(el.dataset.accId);
          renderAccounts();
          const layout = $('accounts-layout');
          if (layout) layout.classList.add('show-detail');
        });
      });
    }

    renderAccountDetail();
  }

  function renderStocks() {
    const shell = $('stocks-shell');
    if (!shell) return;

    const portfolio = MozeData.stockPortfolio(stockQuotesCache);
    const holdings = portfolio.holdings;
    const allPositions = portfolio.all;
    const trades = MozeData.stockTradesList();
    const coveredHoldings = holdings.filter(item => item.latestClose !== null);
    const coveredMarketValue = coveredHoldings.length
      ? coveredHoldings.reduce((sum, item) => sum + (item.marketValue || 0), 0)
      : null;
    const coveredUnrealized = coveredHoldings.length
      ? coveredHoldings.reduce((sum, item) => sum + (item.unrealized || 0), 0)
      : null;
    const latestText = coveredHoldings.length
      ? `已同步 ${coveredHoldings.length} 檔持股收盤價`
      : '尚未收到持股收盤價';
    const stockStatus = '收盤價使用公開官方 EOD 資料，雲端只保留最近 5 個交易日。盤中即時價目前未啟用。';
    const invalidCount = allPositions.filter(item => item.invalid).length;
    const hotStockCards = HOT_STOCKS.map(function (item) {
      const quote = stockQuotesCache[stockKey(item.symbol, item.market)] || null;
      const priceText = quote && quote.latestClose !== null ? MozeData.formatMoney(quote.latestClose) : '—';
      const latestDate = quote && quote.latestDate ? quote.latestDate : '尚未同步';
      const isSelected = selectedStockKey === stockKey(item.symbol, item.market);
      return `
        <button class="stocks-hot-item${isSelected ? ' active' : ''}" type="button" data-stock-key="${esc(stockKey(item.symbol, item.market))}">
          <div class="stocks-hot-name">${esc(item.name)}</div>
          <div class="stocks-hot-symbol">${esc(stockSymbolLabel(item.symbol, item.market))}</div>
          <div class="stocks-hot-price">${esc(priceText)}</div>
          <div class="stocks-hot-date">${esc(latestDate)}</div>
        </button>
      `;
    }).join('');

    if (!selectedStockKey || !allPositions.some(item => stockKey(item.symbol, item.market) === selectedStockKey)) {
      selectedStockKey = holdings[0]
        ? stockKey(holdings[0].symbol, holdings[0].market)
        : (HOT_STOCKS[0] ? stockKey(HOT_STOCKS[0].symbol, HOT_STOCKS[0].market) : '');
    }

    const selectedPosition = allPositions.find(item => stockKey(item.symbol, item.market) === selectedStockKey) || null;
    const selectedQuote = stockQuotesCache[selectedStockKey] || null;
    const detailSource = selectedPosition || (selectedQuote ? {
      ...selectedQuote,
      shares: 0,
      avgCost: 0,
      marketValue: null,
      unrealized: null,
      realizedPnl: 0,
    } : null);
    const historyPoints = detailSource && detailSource.history && detailSource.history.length
      ? detailSource.history.map(item => ({ date: item.date, label: item.date, value: item.close }))
      : [];

    shell.innerHTML = `
      <div class="card">
        <div class="stocks-card-head">
          <div class="card-title">熱門股票收盤價</div>
          <div class="stocks-caption">所有使用者共用同一份公開收盤價資料。</div>
        </div>
        <div class="stocks-hot-grid">${hotStockCards}</div>
      </div>
      <div class="stocks-summary-grid">
        <div class="card">
          <div class="card-title">持股成本</div>
          <div class="card-value">${esc(MozeData.formatMoney(portfolio.totals.costBasis))}</div>
          <div class="card-change">${esc(latestText)}</div>
        </div>
        <div class="card">
          <div class="card-title">股票市值</div>
          <div class="card-value ${coveredMarketValue !== null && coveredMarketValue >= portfolio.totals.costBasis ? 'positive' : 'negative'}">${coveredMarketValue !== null ? esc(MozeData.formatMoney(coveredMarketValue)) : '—'}</div>
          <div class="card-change">以最近收盤價計算</div>
        </div>
        <div class="card">
          <div class="card-title">未實現損益</div>
          <div class="card-value ${coveredUnrealized !== null && coveredUnrealized >= 0 ? 'positive' : 'negative'}">${coveredUnrealized !== null ? esc(MozeData.formatMoney(coveredUnrealized)) : '—'}</div>
          <div class="card-change">${esc(stockStatus)}</div>
        </div>
        <div class="card">
          <div class="card-title">已實現損益</div>
          <div class="card-value ${portfolio.realizedTotal >= 0 ? 'positive' : 'negative'}">${esc(MozeData.formatMoney(portfolio.realizedTotal))}</div>
          <div class="card-change">${invalidCount ? `有 ${invalidCount} 筆賣出超過持股，請檢查交易順序` : '賣出後會計入已實現損益'}</div>
        </div>
      </div>
      <div class="stocks-layout">
        <div class="stocks-left">
          <div class="card">
            <div class="stocks-card-head">
              <div class="card-title">持股總覽</div>
              <button class="btn btn-secondary btn-sm" id="btn-refresh-stock-quotes" type="button">重新整理收盤價</button>
            </div>
            <div class="stocks-caption">免費版使用官方 EOD 收盤資料。收盤價由雲端每日排程更新。</div>
            <div id="stocks-holdings-list">${renderStockHoldingsList(holdings)}</div>
          </div>
          <div class="card">
            <div class="card-title">股票交易紀錄</div>
            <div class="stocks-caption">買進會累加成本，賣出會依加權平均成本計算已實現損益。</div>
            <div id="stock-trade-list">${renderStockTradeList(trades)}</div>
          </div>
        </div>
        <div class="stocks-right">
          <div class="card">
            <div class="card-title">新增股票交易</div>
            <div class="stocks-form-grid">
              <div class="form-group">
                <label>市場</label>
                <select id="stock-trade-market">
                  <option value="TWSE">上市 TWSE</option>
                  <option value="TPEx">上櫃 TPEx</option>
                </select>
              </div>
              <div class="form-group">
                <label>股票代號</label>
                <input type="text" id="stock-trade-symbol" placeholder="2330 / 00679B">
              </div>
              <div class="form-group">
                <label>股票名稱（選填）</label>
                <input type="text" id="stock-trade-name" placeholder="台積電">
              </div>
              <div class="form-group">
                <label>買賣方向</label>
                <select id="stock-trade-side">
                  <option value="buy">買進</option>
                  <option value="sell">賣出</option>
                </select>
              </div>
              <div class="form-group">
                <label>股數</label>
                <input type="number" id="stock-trade-shares" placeholder="1000" step="0.0001">
              </div>
              <div class="form-group">
                <label>成交價</label>
                <input type="number" id="stock-trade-price" placeholder="950" step="0.0001">
              </div>
              <div class="form-group">
                <label>手續費</label>
                <input type="number" id="stock-trade-fee" placeholder="0" step="0.01" value="0">
              </div>
              <div class="form-group">
                <label>交易日期</label>
                <input type="text" id="stock-trade-date" class="date-text-input" data-date-picker readonly inputmode="none" placeholder="YYYY-MM-DD" value="${esc(MozeData.today())}">
              </div>
            </div>
            <div class="form-group">
              <label>備註</label>
              <textarea id="stock-trade-note" placeholder="可選填，例如分批布局、停利原因"></textarea>
            </div>
            <button class="btn btn-primary btn-block" id="btn-add-stock-trade" type="button">新增股票交易</button>
          </div>
          <div class="card">
            <div class="stocks-card-head">
              <div>
                <div class="card-title">持股明細</div>
                <div class="stocks-caption">${detailSource ? `${esc(detailSource.name || detailSource.symbol)} / ${esc(stockSymbolLabel(detailSource.symbol, detailSource.market))}` : '尚未選擇股票'}</div>
              </div>
            </div>
            ${renderSelectedStockDetail(detailSource)}
            <div id="stock-history-chart" class="chart-container"></div>
          </div>
        </div>
      </div>
    `;

    const historyEl = $('stock-history-chart');
    if (historyEl) {
      if (historyPoints.length) {
        MozeCharts.lineChart(historyEl, historyPoints, { color: '#ffd54f', height: 220 });
      } else {
        historyEl.innerHTML = '<div class="empty-state"><p>目前沒有可顯示的最近 5 日收盤價。</p></div>';
      }
    }

    const refreshBtn = $('btn-refresh-stock-quotes');
    if (refreshBtn) {
      refreshBtn.disabled = !currentUser;
      refreshBtn.addEventListener('click', function () {
        if (!currentUser) return;
        refreshBtn.disabled = true;
        refreshBtn.textContent = '讀取中…';
        loadStockQuotes(true).then(function () {
          renderStocks();
        });
      });
    }

    $$el('[data-stock-key]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectedStockKey = btn.dataset.stockKey || '';
        renderStocks();
      });
    });

    $$el('[data-del-stock-trade]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!window.confirm('確定要刪除這筆股票交易嗎？')) return;
        MozeData.deleteStockTrade(btn.dataset.delStockTrade);
        renderStocks();
      });
    });

    const addTradeBtn = $('btn-add-stock-trade');
    if (addTradeBtn) {
      addTradeBtn.addEventListener('click', function () {
        const market = ($('stock-trade-market') || {}).value || 'TWSE';
        const symbol = String((($('stock-trade-symbol') || {}).value || '')).toUpperCase().replace(/\s+/g, '');
        const name = (($('stock-trade-name') || {}).value || '').trim();
        const side = (($('stock-trade-side') || {}).value || 'buy');
        const shares = parseFloat((($('stock-trade-shares') || {}).value || '0'));
        const price = parseFloat((($('stock-trade-price') || {}).value || '0'));
        const fee = parseFloat((($('stock-trade-fee') || {}).value || '0'));
        const date = (($('stock-trade-date') || {}).value || MozeData.today());
        const note = (($('stock-trade-note') || {}).value || '').trim();

        if (!symbol) { alert('請輸入股票代號'); return; }
        if (!shares || shares <= 0) { alert('股數必須大於 0'); return; }
        if (!Number.isFinite(price) || price < 0) { alert('成交價格式不正確'); return; }
        if (!Number.isFinite(fee) || fee < 0) { alert('手續費格式不正確'); return; }
        if (side === 'sell' && !MozeData.canSellStock(symbol, market, shares)) {
          alert('賣出股數超過目前持股，請先確認股票交易紀錄。');
          return;
        }

        MozeData.addStockTrade({ market, symbol, name, side, shares, price, fee, date, note });
        selectedStockKey = stockKey(symbol, market);
        renderStocks();
      });
    }

    if (!stockQuotesReady && !stockQuotesLoading) {
      loadStockQuotes(false).then(function () {
        if (currentView === 'stocks') renderStocks();
      });
    }
  }

  function renderStockHoldingsList(holdings) {
    if (!holdings.length) {
      return '<div class="empty-state"><p>目前沒有持股。先新增一筆買進交易。</p></div>';
    }
    return `
      <div class="stocks-holdings-list">
        ${holdings.map(function (item) {
          const activeClass = stockKey(item.symbol, item.market) === selectedStockKey ? ' active' : '';
          const closeText = item.latestClose !== null ? MozeData.formatMoney(item.latestClose) : '—';
          const mvText = item.marketValue !== null ? MozeData.formatMoney(item.marketValue) : '—';
          const pnlText = item.unrealized !== null ? MozeData.formatMoney(item.unrealized) : '—';
          const pnlClass = item.unrealized === null ? '' : (item.unrealized >= 0 ? 'positive' : 'negative');
          return `
            <button class="stocks-holding-item${activeClass}" type="button" data-stock-key="${esc(stockKey(item.symbol, item.market))}">
              <div class="stocks-holding-main">
                <div class="stocks-holding-title">${esc(item.name || item.symbol)} <span class="stocks-holding-code">${esc(stockSymbolLabel(item.symbol, item.market))}</span></div>
                <div class="stocks-holding-meta">持股 ${esc(String(item.shares))} 股 · 均價 ${esc(MozeData.formatMoney(item.avgCost))}</div>
              </div>
              <div class="stocks-holding-side">
                <div>收盤 ${esc(closeText)}</div>
                <div>市值 ${esc(mvText)}</div>
                <div class="${pnlClass}">損益 ${esc(pnlText)}</div>
              </div>
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderStockTradeList(trades) {
    if (!trades.length) {
      return '<div class="empty-state"><p>還沒有任何股票交易。</p></div>';
    }
    return `
      <div class="stocks-trade-list">
        ${trades.map(function (trade) {
          const directionClass = trade.side === 'buy' ? 'positive' : 'negative';
          return `
            <div class="stocks-trade-item">
              <div class="stocks-trade-main">
                <div class="stocks-trade-title">${trade.side === 'buy' ? '買進' : '賣出'} ${esc(trade.name || trade.symbol)} <span class="stocks-holding-code">${esc(stockSymbolLabel(trade.symbol, trade.market))}</span></div>
                <div class="stocks-trade-meta">${esc(trade.date)} · ${esc(String(trade.shares))} 股 · 單價 ${esc(MozeData.formatMoney(trade.price))} · 手續費 ${esc(MozeData.formatMoney(trade.fee))}</div>
                ${trade.note ? `<div class="stocks-trade-note">${esc(trade.note)}</div>` : ''}
              </div>
              <div class="stocks-trade-actions">
                <div class="${directionClass}">${esc(MozeData.formatMoney(trade.shares * trade.price))}</div>
                <button class="btn btn-secondary btn-sm" type="button" data-del-stock-trade="${esc(trade.id)}">刪除</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderSelectedStockDetail(item) {
    if (!item) {
      return '<div class="empty-state"><p>選擇一檔股票後可查看收盤價與損益。</p></div>';
    }
    const latestClose = item.latestClose !== null ? MozeData.formatMoney(item.latestClose) : '—';
    const marketValue = item.marketValue !== null ? MozeData.formatMoney(item.marketValue) : '—';
    const unrealized = item.unrealized !== null ? MozeData.formatMoney(item.unrealized) : '—';
    const unrealizedClass = item.unrealized === null ? '' : (item.unrealized >= 0 ? 'positive' : 'negative');
    const historyText = item.latestDate ? `最新收盤日：${item.latestDate}` : '尚未同步到收盤價';
    return `
      <div class="stocks-detail-grid">
        <div class="stocks-detail-metric"><span>持股</span><strong>${esc(String(item.shares))} 股</strong></div>
        <div class="stocks-detail-metric"><span>均價</span><strong>${esc(MozeData.formatMoney(item.avgCost))}</strong></div>
        <div class="stocks-detail-metric"><span>最新收盤</span><strong>${esc(latestClose)}</strong></div>
        <div class="stocks-detail-metric"><span>市值</span><strong>${esc(marketValue)}</strong></div>
        <div class="stocks-detail-metric"><span>未實現</span><strong class="${unrealizedClass}">${esc(unrealized)}</strong></div>
        <div class="stocks-detail-metric"><span>已實現</span><strong class="${item.realizedPnl >= 0 ? 'positive' : 'negative'}">${esc(MozeData.formatMoney(item.realizedPnl))}</strong></div>
      </div>
      <div class="stocks-caption" style="margin-bottom:12px">${esc(historyText)}</div>
      <div class="stocks-history-list">
        ${(item.history && item.history.length)
          ? item.history.slice().reverse().map(function (entry) {
            return `<div class="stocks-history-row"><span>${esc(entry.date)}</span><strong>${esc(MozeData.formatMoney(entry.close))}</strong></div>`;
          }).join('')
          : '<div class="empty-state"><p>目前沒有最近 5 日收盤資料。</p></div>'}
      </div>
    `;
  }

  function renderAccountDetail() {
    const s = MozeData.getState();
    const acc = s.accounts.find(a => a.id === s.selectedAccountId);
    if (!acc) return;
    const bal = MozeData.accountBalance(acc.id);
    const setVal = (id, val) => { const e = $(id); if (e) e.textContent = val; };
    setVal('acc-detail-icon', acc.icon);
    setVal('acc-detail-name', acc.name);
    setVal('acc-detail-balance', `餘額：${MozeData.formatMoney(bal)}`);

    const sum = MozeData.summary(rangeStart, rangeEnd, acc.id);
    const stats = $('acc-detail-stats');
    if (stats) {
      const maxBar = Math.max(sum.income, sum.expense, 1);
      stats.innerHTML = `
        <div class="stat-row"><span style="width:50px;color:var(--green)">收入</span>
          <div class="stat-bar-wrap"><div class="stat-bar" style="width:${(sum.income / maxBar) * 100}%;background:var(--green)"></div></div>
          <span style="min-width:80px;text-align:right">${MozeData.formatMoney(sum.income)}</span></div>
        <div class="stat-row"><span style="width:50px;color:var(--red)">支出</span>
          <div class="stat-bar-wrap"><div class="stat-bar" style="width:${(sum.expense / maxBar) * 100}%;background:var(--red)"></div></div>
          <span style="min-width:80px;text-align:right">${MozeData.formatMoney(sum.expense)}</span></div>
      `;
    }

    const trendContainer = $('acc-detail-trend');
    if (trendContainer) {
      const balData = MozeData.accountBalanceOverTime(acc.id, rangeStart, rangeEnd);
      MozeCharts.accountTrend(trendContainer, balData);
    }

    const txList = $('acc-tx-list');
    if (txList) {
      const txs = MozeData.txInRange(rangeStart, rangeEnd, acc.id)
        .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
      if (!txs.length) {
        txList.innerHTML = '<div class="empty-state"><p>此區間無交易</p></div>';
      } else {
        txList.innerHTML = txs.map(t => txItemHTML(t)).join('');
        bindTxDelete(txList);
      }
    }
  }

  /* ═══════════════════════════════════════ */
  /*             ③ 流水帳頁                  */
  /* ═══════════════════════════════════════ */
  function renderLedger() {
    const s = MozeData.getState();
    populateAccountSelect('ledger-account', true);
    populateMonthSelect();

    const accSel = $('ledger-account');
    const typeSel = $('ledger-type');
    const monthSel = $('ledger-month');
    const accId = accSel ? accSel.value : 'all';
    const typeFilter = typeSel ? typeSel.value : 'all';
    const monthFilter = monthSel ? monthSel.value : 'all';

    let txs = s.transactions.slice();
    if (accId !== 'all') txs = txs.filter(t => t.accountId === accId || t.toAccountId === accId);
    if (typeFilter !== 'all') txs = txs.filter(t => t.type === typeFilter);
    if (monthFilter !== 'all') txs = txs.filter(t => MozeData.monthKey(t.date) === monthFilter);
    txs.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));

    const list = $('ledger-list');
    if (!list) return;
    if (!txs.length) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">📒</div><p>目前沒有交易紀錄</p></div>';
      return;
    }

    let html = '';
    let lastDate = '';
    txs.forEach(t => {
      if (t.date !== lastDate) {
        lastDate = t.date;
        html += `<div class="tx-group-date">${t.date}</div>`;
      }
      html += txItemHTML(t);
    });
    list.innerHTML = html;
    bindTxDelete(list);
  }

  function populateMonthSelect() {
    const sel = $('ledger-month');
    if (!sel) return;
    const cur = sel.value;
    const months = new Set();
    MozeData.getState().transactions.forEach(t => months.add(MozeData.monthKey(t.date)));
    const sorted = Array.from(months).sort().reverse();
    sel.innerHTML = '<option value="all">全部月份</option>' + sorted.map(m => `<option value="${m}"${m === cur ? ' selected' : ''}>${m}</option>`).join('');
  }

  /* ═══════════════════════════════════════ */
  /*             ④ 報表頁                    */
  /* ═══════════════════════════════════════ */
  function renderReports() {
    const s = MozeData.getState();
    const accId = s.activeAccountId;
    const sum = MozeData.summary(rangeStart, rangeEnd, accId);

    const setVal = (id, val) => { const e = $(id); if (e) e.textContent = val; };
    setVal('rpt-total', MozeData.formatMoney(sum.expense));
    setVal('rpt-count', sum.count);
    setVal('rpt-daily', MozeData.formatMoney(sum.daily));

    const statBars = $('rpt-stat-bars');
    if (statBars) {
      const maxBar = Math.max(sum.expense, sum.fee, 1);
      statBars.innerHTML = `
        <div class="stat-row"><span style="width:60px;color:var(--red)">支出</span>
          <div class="stat-bar-wrap"><div class="stat-bar" style="width:${(sum.expense / maxBar) * 100}%;background:var(--red)"></div></div>
          <span style="min-width:80px;text-align:right">${MozeData.formatMoney(sum.expense)}</span></div>
        <div class="stat-row"><span style="width:60px;color:var(--accent2)">手續費</span>
          <div class="stat-bar-wrap"><div class="stat-bar" style="width:${(sum.fee / maxBar) * 100}%;background:var(--accent2)"></div></div>
          <span style="min-width:80px;text-align:right">${MozeData.formatMoney(sum.fee)}</span></div>
        <div style="margin-top:8px;font-weight:600">合計：${MozeData.formatMoney(sum.expense + sum.fee)}</div>
      `;
    }

    const catData = MozeData.expenseByCategory(rangeStart, rangeEnd, accId);
    const rankTable = $('rpt-rank-table');
    if (rankTable) {
      const top10 = catData.slice(0, 10);
      if (!top10.length) {
        rankTable.innerHTML = '<p style="color:var(--text-muted)">無資料</p>';
      } else {
        rankTable.innerHTML = `<table class="rank-table"><thead><tr><th>#</th><th>分類</th><th>金額</th><th>占比</th></tr></thead><tbody>
          ${top10.map((d, i) => `<tr><td class="rank-num">${i + 1}</td><td>${esc(d.icon)} ${esc(d.name)}</td><td>${MozeData.formatMoney(d.amount)}</td><td class="rank-pct">${(d.pct * 100).toFixed(1)}%</td></tr>`).join('')}
        </tbody></table>`;
      }
    }

    const catDonut = $('rpt-cat-donut');
    if (catDonut) MozeCharts.donut(catDonut, catData, { centerLabel: '支出' });

    const accData = MozeData.expenseByAccount(rangeStart, rangeEnd);
    const accDonut = $('rpt-acc-donut');
    if (accDonut) MozeCharts.donut(accDonut, accData, { centerLabel: '帳戶' });

    const catVbar = $('rpt-cat-vbar');
    if (catVbar) MozeCharts.verticalBars(catVbar, catData.map(d => ({ ...d, label: d.name })));

    const catHbar = $('rpt-cat-hbar');
    if (catHbar) MozeCharts.horizontalBars(catHbar, catData);

    const startMk = MozeData.monthKey(rangeStart);
    const endMk = MozeData.monthKey(rangeEnd);
    const monthData = MozeData.expenseByMonth(startMk, endMk, accId);

    const monthLine = $('rpt-month-line');
    if (monthLine) {
      MozeCharts.lineChart(monthLine, monthData.map(d => ({ date: d.month, label: d.month, value: d.amount })), { color: '#e57373' });
    }

    const monthVbar = $('rpt-month-vbar');
    if (monthVbar) {
      MozeCharts.verticalBars(monthVbar, monthData.map(d => ({ name: d.month, label: d.month, amount: d.amount })));
    }

    const dailyData = MozeData.expenseByDay(rangeStart, rangeEnd, accId);
    const dailyLine = $('rpt-daily-line');
    if (dailyLine) {
      MozeCharts.lineChart(dailyLine, dailyData.map(d => ({ date: d.date, label: d.date, value: d.amount })), { color: '#f6c342' });
    }

    const dateGroups = $('rpt-date-groups');
    if (dateGroups) {
      const groups = MozeData.txByDateGroups(rangeStart, rangeEnd, accId);
      const expenseGroups = groups.map(([date, txs]) => {
        const expTxs = txs.filter(t => t.type === 'expense');
        return [date, expTxs];
      }).filter(([, txs]) => txs.length > 0);

      if (!expenseGroups.length) {
        dateGroups.innerHTML = '<p style="color:var(--text-muted)">無資料</p>';
      } else {
        dateGroups.innerHTML = expenseGroups.map(([date, txs]) => {
          const total = txs.reduce((s, t) => s + t.amount, 0);
          return `<div class="tx-group-date">${date} — ${MozeData.formatMoney(total)}</div>` +
            txs.map(t => txItemHTML(t)).join('');
        }).join('');
        bindTxDelete(dateGroups);
      }
    }
  }

  /* ═══════════════════════════════════════ */
  /*             ⑤ 專案頁                    */
  /* ═══════════════════════════════════════ */
  function renderProjects() {
    const s = MozeData.getState();
    const list = $('project-list');
    if (list) {
      if (!s.projects.length) {
        list.innerHTML = '<div class="empty-state"><p>尚無專案</p></div>';
      } else {
        list.innerHTML = s.projects.map(p => `
          <div class="project-list-item${p.id === selectedProjectId ? ' selected' : ''}" data-proj-id="${esc(p.id)}">
            <span>${esc(p.icon)} ${esc(p.name)}</span>
            <button class="btn-icon" data-del-proj="${esc(p.id)}" title="刪除">✕</button>
          </div>
        `).join('');
        list.querySelectorAll('.project-list-item').forEach(el => {
          el.addEventListener('click', (e) => {
            if (e.target.closest('[data-del-proj]')) return;
            selectedProjectId = el.dataset.projId;
            renderProjects();
          });
        });
        list.querySelectorAll('[data-del-proj]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('確定刪除此專案？')) {
              MozeData.deleteProject(btn.dataset.delProj);
              if (selectedProjectId === btn.dataset.delProj) selectedProjectId = '';
              renderProjects();
            }
          });
        });
      }
    }

    populateCategorySelect('budget-cat');
    renderProjectDetail();
  }

  function renderProjectDetail() {
    const s = MozeData.getState();
    const proj = s.projects.find(p => p.id === selectedProjectId);
    const header = $('proj-detail-header');
    if (!proj) {
      if (header) header.textContent = '選擇一個專案';
      const stats = $('proj-detail-stats');
      if (stats) stats.innerHTML = '';
      const budgetList = $('proj-budget-list');
      if (budgetList) budgetList.innerHTML = '';
      const txList = $('proj-tx-list');
      if (txList) txList.innerHTML = '';
      return;
    }

    if (header) header.innerHTML = `${esc(proj.icon)} ${esc(proj.name)}`;

    const txs = s.transactions.filter(t => t.projectId === proj.id);
    const inflow = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const outflow = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const net = inflow - outflow;

    const stats = $('proj-detail-stats');
    if (stats) {
      const mx = Math.max(inflow, outflow, 1);
      stats.innerHTML = `
        <div class="stat-row"><span style="width:50px;color:var(--green)">流入</span>
          <div class="stat-bar-wrap"><div class="stat-bar" style="width:${(inflow / mx) * 100}%;background:var(--green)"></div></div>
          <span style="min-width:80px;text-align:right">${MozeData.formatMoney(inflow)}</span></div>
        <div class="stat-row"><span style="width:50px;color:var(--red)">流出</span>
          <div class="stat-bar-wrap"><div class="stat-bar" style="width:${(outflow / mx) * 100}%;background:var(--red)"></div></div>
          <span style="min-width:80px;text-align:right">${MozeData.formatMoney(outflow)}</span></div>
        <div style="margin-top:6px;font-weight:600">淨額：<span style="color:${net >= 0 ? 'var(--green)' : 'var(--red)'}">${MozeData.formatMoney(net)}</span></div>
      `;
    }

    const budgets = s.budgets.filter(b => b.projectId === proj.id);
    const budgetList = $('proj-budget-list');
    if (budgetList) {
      if (!budgets.length) {
        budgetList.innerHTML = '<p style="color:var(--text-muted);font-size:12px">尚未設定預算</p>';
      } else {
        const curMonth = MozeData.monthKey(MozeData.today());
        const { y, m } = MozeData.parseMonth(curMonth);
        const mStart = `${curMonth}-01`;
        const mEnd = `${curMonth}-${String(MozeData.daysInMonth(y, m)).padStart(2, '0')}`;
        budgetList.innerHTML = budgets.map(b => {
          const spent = txs
            .filter(t => t.type === 'expense' && t.date >= mStart && t.date <= mEnd)
            .flatMap(t => MozeData.transactionItems(t))
            .filter(item => item.categoryId === b.categoryId)
            .reduce((s, item) => s + item.amount, 0);
          const pct = Math.min(100, (spent / (b.limitMonthly || 1)) * 100);
          const over = spent > b.limitMonthly;
          return `<div class="budget-row">
            <span style="width:70px;font-size:13px">${esc(MozeData.catIcon(b.categoryId))} ${esc(MozeData.catName(b.categoryId))}</span>
            <div class="budget-progress"><div class="budget-progress-bar${over ? ' over' : ''}" style="width:${pct}%"></div></div>
            <span style="font-size:12px;min-width:100px;text-align:right">${MozeData.formatMoney(spent)} / ${MozeData.formatMoney(b.limitMonthly)}</span>
            <button class="btn-icon" data-del-budget="${b.id}">✕</button>
          </div>`;
        }).join('');
        budgetList.querySelectorAll('[data-del-budget]').forEach(btn => {
          btn.addEventListener('click', () => {
            MozeData.deleteBudget(btn.dataset.delBudget);
            renderProjectDetail();
          });
        });
      }
    }

    const txList = $('proj-tx-list');
    if (txList) {
      const sorted = txs.sort((a, b) => b.date.localeCompare(a.date));
      if (!sorted.length) {
        txList.innerHTML = '<div class="empty-state"><p>無交易</p></div>';
      } else {
        txList.innerHTML = sorted.map(t => txItemHTML(t)).join('');
        bindTxDelete(txList);
      }
    }
  }

  /* ═══════════════════════════════════════ */
  /*             ⑥ 搜尋頁                    */
  /* ═══════════════════════════════════════ */
  function renderSearch() {
    const input = $('search-input');
    const answer = $('search-answer');
    const visuals = $('search-visuals');
    const results = $('search-results');
    if (!input || !results || !answer || !visuals) return;
    const q = input.value.trim();
    if (!q) {
      answer.innerHTML = '';
      visuals.innerHTML = '';
      results.innerHTML = '<div class="search-results-card"><div class="empty-state"><div class="empty-icon">🔍</div><p>輸入關鍵字搜尋</p></div></div>';
      return;
    }

    const naturalAnswer = answerNaturalLanguageQuery(q);
    if (naturalAnswer) {
      answer.innerHTML = `
        <div class="search-answer-card">
          <div class="search-answer-label">自然語言查詢結果</div>
          <div class="search-answer-text">${esc(naturalAnswer.text)}</div>
          <div class="search-answer-meta">${esc(naturalAnswer.meta)}</div>
        </div>
      `;
      renderSearchVisuals(naturalAnswer.visuals || null);
      if (!naturalAnswer.txs.length) {
        results.innerHTML = '<div class="search-results-card"><div class="empty-state"><p>這個條件下目前沒有符合的交易。</p></div></div>';
        return;
      }
      results.innerHTML = `
        <div class="search-results-card">
          <div class="search-results-title">符合條件的交易</div>
          ${naturalAnswer.txs
            .slice()
            .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time))
            .map(t => txItemHTML(t)).join('')}
        </div>
      `;
      bindTxDelete(results);
      return;
    }

    answer.innerHTML = '';
    visuals.innerHTML = '';
    const txs = MozeData.searchTx(q);
    if (!txs.length) {
      results.innerHTML = '<div class="search-results-card"><div class="empty-state"><p>找不到符合的交易</p></div></div>';
      return;
    }
    results.innerHTML = `
      <div class="search-results-card">
        <div class="search-results-title">搜尋結果</div>
        ${txs.map(t => txItemHTML(t)).join('')}
      </div>
    `;
    bindTxDelete(results);
  }

  function renderFeedback() {
    const statusEl = $('feedback-submit-status');

    if (statusEl && !statusEl.dataset.locked) {
      statusEl.textContent = getFeedbackStatusBaseText();
    }
  }

  function resetFeedbackStatus() {
    const statusEl = $('feedback-submit-status');
    if (!statusEl) return;
    delete statusEl.dataset.locked;
    statusEl.style.color = 'var(--text-dim)';
    statusEl.textContent = getFeedbackStatusBaseText();
  }

  function renderFeedbackInboxItems(items) {
    return items.map(function (item) {
      const meta = [];
      if (item.contact) meta.push(`<span>聯絡：${esc(item.contact)}</span>`);
      if (item.device) meta.push(`<span>裝置：${esc(item.device)}</span>`);
      if (item.authEmail) meta.push(`<span>帳號：${esc(item.authEmail)}</span>`);
      if (item.pageUrl) meta.push(`<span>頁面：${esc(item.pageUrl)}</span>`);
      return `
        <div class="feedback-item">
          <div class="feedback-item-header">
            <div class="feedback-item-title">問題回報</div>
            <div class="feedback-item-time">${esc(formatDateTime(item.createdAt))}</div>
          </div>
          <div class="feedback-item-message">${esc(item.message || '')}</div>
          ${meta.length ? `<div class="feedback-item-meta">${meta.join('')}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  function renderErrorLogs() {
    const isAdmin = typeof MozeSync !== 'undefined' && typeof MozeSync.isAdmin === 'function' && MozeSync.isAdmin(currentUser);
    const countEl = $('error-log-count');
    const statusEl = $('error-log-status');
    const listEl = $('error-log-list');
    const feedbackCountEl = $('feedback-inbox-count');
    const feedbackStatusEl = $('feedback-inbox-status');
    const feedbackListEl = $('feedback-inbox-list');

    if (!countEl || !statusEl || !listEl || !feedbackCountEl || !feedbackStatusEl || !feedbackListEl) return;

    if (!isAdmin) {
      countEl.textContent = '0';
      statusEl.textContent = '僅管理員帳號可查看此頁面。';
      listEl.innerHTML = '<div class="empty-state"><p>你沒有權限查看報錯日誌。</p></div>';
      feedbackCountEl.textContent = '0';
      feedbackStatusEl.textContent = '僅管理員帳號可查看此頁面。';
      feedbackListEl.innerHTML = '<div class="empty-state"><p>你沒有權限查看意見反饋。</p></div>';
      return;
    }

    statusEl.textContent = '讀取中…';
    if (typeof MozeSync === 'undefined' || typeof MozeSync.fetchErrorLogs !== 'function') {
      countEl.textContent = '0';
      statusEl.textContent = '報錯日誌模組未載入。';
      listEl.innerHTML = '<div class="empty-state"><p>無法讀取報錯日誌。</p></div>';
      return;
    }

    MozeSync.fetchErrorLogs(function (err, logs) {
      if (err) {
        countEl.textContent = '0';
        statusEl.textContent = '讀取失敗，請稍後再試。';
        listEl.innerHTML = '<div class="empty-state"><p>無法讀取報錯日誌。</p></div>';
        return;
      }

      countEl.textContent = logs.length;
      let statusText = logs.length ? '僅管理員帳號可查看與清空。' : '目前沒有報錯紀錄。';
      if (typeof MozeTelemetry !== 'undefined' && typeof MozeTelemetry.getStatus === 'function') {
        const telemetryStatus = MozeTelemetry.getStatus();
        statusText += ` Sentry：${telemetryStatus.detail}。`;
      }
      statusEl.textContent = statusText;
      if (!logs.length) {
        listEl.innerHTML = '<div class="empty-state"><p>目前沒有報錯紀錄。</p></div>';
        return;
      }

      listEl.className = 'error-log-list';
      listEl.innerHTML = logs.map(function (log) {
        const meta = [];
        if (log.level) meta.push(`<span>層級：${esc(log.level)}</span>`);
        if (log.url) meta.push(`<span>頁面：${esc(log.url)}</span>`);
        if (log.context) meta.push(`<span>上下文：${esc(log.context)}</span>`);
        return `
          <div class="error-log-item">
            <div class="error-log-item-header">
              <div class="error-log-source">${esc(log.source || 'app')}</div>
              <div class="error-log-time">${esc(formatDateTime(log.createdAt))}</div>
            </div>
            <div class="error-log-message">${esc(log.message || 'Unknown error')}</div>
            ${meta.length ? `<div class="error-log-meta">${meta.join('')}</div>` : ''}
            ${log.stack ? `<pre class="error-log-stack">${esc(log.stack)}</pre>` : ''}
          </div>
        `;
      }).join('');
    });

    feedbackStatusEl.textContent = '讀取中…';
    if (typeof MozeSync === 'undefined' || typeof MozeSync.fetchFeedback !== 'function') {
      feedbackCountEl.textContent = '0';
      feedbackStatusEl.textContent = '反饋模組未載入。';
      feedbackListEl.innerHTML = '<div class="empty-state"><p>無法讀取反饋內容。</p></div>';
      return;
    }

    MozeSync.fetchFeedback(function (err, items) {
      if (err) {
        feedbackCountEl.textContent = '0';
        feedbackStatusEl.textContent = '讀取失敗，請稍後再試。';
        feedbackListEl.innerHTML = '<div class="empty-state"><p>無法讀取反饋內容。</p></div>';
        return;
      }

      feedbackCountEl.textContent = items.length;
      feedbackStatusEl.textContent = items.length ? '只有管理員帳號可以查看這些反饋。' : '目前沒有收到反饋。';
      if (!items.length) {
        feedbackListEl.innerHTML = '<div class="empty-state"><p>目前沒有收到反饋。</p></div>';
        return;
      }

      feedbackListEl.innerHTML = renderFeedbackInboxItems(items);
    });
  }

  /* ═══════════════════════════════════════ */
  /*             ⑦ 設定頁                    */
  /* ═══════════════════════════════════════ */
  const ADMIN_EMAIL = 'kevin1542638@gmail.com';

  function renderLibraryList(elementId, kind) {
    const el = $(elementId);
    if (!el) return;
    const items = MozeData.libraryList(kind);
    if (!items.length) {
      el.innerHTML = '<div class="empty-state"><p>目前沒有資料</p></div>';
      return;
    }
    el.innerHTML = items.map(function (item) {
      return `<div class="settings-list-row">
        <span>${esc(item.name)}</span>
        <button class="btn-icon" data-del-library="${esc(kind)}:${esc(item.id)}" title="刪除">✕</button>
      </div>`;
    }).join('');
    el.querySelectorAll('[data-del-library]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const [bucket, id] = btn.dataset.delLibrary.split(':');
        MozeData.deleteLibraryEntry(bucket, id);
        renderSettings();
        renderModalLibraryLists();
      });
    });
  }

  function renderModalLibraryLists() {
    const merchantList = $('tx-merchants');
    const counterpartList = $('tx-counterparts');
    const templateList = $('tx-title-templates');
    if (merchantList) {
      merchantList.innerHTML = MozeData.libraryList('merchants').map(item => `<option value="${esc(item.name)}"></option>`).join('');
    }
    if (counterpartList) {
      counterpartList.innerHTML = MozeData.libraryList('counterparts').map(item => `<option value="${esc(item.name)}"></option>`).join('');
    }
    if (templateList) {
      templateList.innerHTML = MozeData.libraryList('titleTemplates').map(item => `<option value="${esc(item.name)}"></option>`).join('');
    }
    $$el('#tx-items-list .tx-item-title').forEach(function (input) {
      input.setAttribute('list', 'tx-title-templates');
    });
  }

  function renderSettings() {
    const s = MozeData.getState();
    switchMorePane(currentMorePane);
    const liabInput = $('settings-liabilities');
    if (liabInput) liabInput.value = s.settings.liabilities || 0;

    const catList = $('settings-cat-list');
    if (catList) {
      catList.innerHTML = s.categories.map(c => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)">
          <span style="font-size:18px">${esc(c.icon)}</span>
          <span style="flex:1">${esc(c.name)}</span>
          <button class="btn-icon" data-del-cat="${esc(c.id)}" title="刪除">✕</button>
        </div>
      `).join('');
      catList.querySelectorAll('[data-del-cat]').forEach(btn => {
        btn.addEventListener('click', () => {
          const ok = MozeData.deleteCategory(btn.dataset.delCat);
          if (!ok) alert('此分類仍有交易紀錄，無法刪除。');
          renderSettings();
        });
      });
    }

    renderLibraryList('settings-merchant-list', 'merchants');
    renderLibraryList('settings-counterpart-list', 'counterparts');
    renderLibraryList('settings-template-list', 'titleTemplates');
    renderModalLibraryLists();

    const groupList = $('more-account-group-list');
    if (groupList) {
      const counts = {};
      (s.accounts || []).forEach(function (acc) {
        const key = acc.group || '其他';
        counts[key] = (counts[key] || 0) + 1;
      });
      const groups = Object.keys(counts).sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); });
      groupList.innerHTML = groups.length
        ? groups.map(function (group) {
            return `<div class="settings-list-row"><span>${esc(group)}</span><span class="settings-help-text">${counts[group]} 個帳戶</span></div>`;
          }).join('')
        : '<div class="empty-state"><p>目前沒有帳戶分組</p></div>';
    }

    const adminPanel = $('admin-panel');
    if (!adminPanel) return;
    let email = '';
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
      email = firebase.auth().currentUser.email || '';
    } else if (currentUser) {
      email = currentUser.email || '';
    }
    if (email.toLowerCase() === ADMIN_EMAIL) {
      adminPanel.style.display = '';
      if (typeof MozeSync !== 'undefined') {
        MozeSync.fetchUserCount(function (count, uids) {
          const countEl = $('admin-user-count');
          if (countEl) countEl.textContent = count;
          const listEl = $('admin-user-list');
          if (listEl) listEl.textContent = '使用者 UID：' + uids.join(', ');
        });
      }
    } else {
      adminPanel.style.display = 'none';
    }
  }

  /* ═══════════════════════════════════════ */
  /*           交易項目 HTML                  */
  /* ═══════════════════════════════════════ */
  function txItemHTML(t) {
    const items = MozeData.transactionItems(t);
    const primaryItem = MozeData.txPrimaryItem(t);
    let icon = esc(primaryItem ? MozeData.catIcon(primaryItem.categoryId) : MozeData.catIcon(t.categoryId));
    let titleText = esc(t.title || (primaryItem ? (primaryItem.title || MozeData.catName(primaryItem.categoryId)) : MozeData.catName(t.categoryId)));
    let amountClass = t.type;
    let amountPrefix = t.type === 'income' ? '+' : (t.type === 'expense' ? '-' : '');
    let extra = '';

    if (t.type === 'transfer') {
      icon = '🔄';
      titleText = esc(t.title) || `${esc(MozeData.acctName(t.accountId))} → ${esc(MozeData.acctName(t.toAccountId))}`;
      amountPrefix = '';
      if (t.fee > 0) extra = ` <span style="font-size:11px;color:var(--text-muted)">(手續費 ${MozeData.formatMoney(t.fee)})</span>`;
    } else if (items.length > 1) {
      titleText = `${titleText} <span style="font-size:11px;color:var(--text-muted)">+${items.length - 1} 項</span>`;
    }

    const tagsHtml = (t.tags || []).map(tag => `<span class="tx-tag">${esc(tag)}</span>`).join('');
    const itemPreview = t.type === 'transfer' ? '' : `<span>${esc(items.slice(0, 3).map(function (item) {
      const label = item.title || MozeData.catName(item.categoryId);
      return `${label} ${MozeData.formatMoney(item.amount)}`;
    }).join(' / '))}${items.length > 3 ? ' ...' : ''}</span>`;

    return `<div class="tx-item">
      <div class="tx-icon">${icon}</div>
      <div class="tx-info">
        <div class="tx-title">${titleText}</div>
        <div class="tx-meta">
          <span>${esc(t.date)} ${esc(t.time || '')}</span>
          ${t.note ? `<span>${esc(t.note)}</span>` : ''}
          <span>${esc(MozeData.acctName(t.accountId))}</span>
          ${itemPreview}
          ${tagsHtml}
        </div>
      </div>
      <span class="tx-amount ${amountClass}">${amountPrefix}${MozeData.formatMoney(t.amount)}${extra}</span>
      <button class="tx-delete" data-edit-tx="${esc(t.id)}" title="編輯">✎</button>
      <button class="tx-delete" data-del-tx="${esc(t.id)}" title="刪除">✕</button>
    </div>`;
  }

  function bindTxDelete(container) {
    if (!container) return;
    container.querySelectorAll('[data-edit-tx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tx = MozeData.getState().transactions.find(x => x.id === btn.dataset.editTx);
        if (!tx) return;
        openModal(tx);
      });
    });
    container.querySelectorAll('[data-del-tx]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('確定刪除此筆交易？')) {
          MozeData.deleteTransaction(btn.dataset.delTx);
          refreshAll();
        }
      });
    });
  }

  /* ═══════════════════════════════════════ */
  /*           下拉選單填充                    */
  /* ═══════════════════════════════════════ */
  function populateAccountSelect(selId, withAll) {
    const sel = $(selId);
    if (!sel) return;
    const s = MozeData.getState();
    const cur = sel.value;
    let html = withAll ? '<option value="all">全部帳戶</option>' : '';
    s.accounts.forEach(a => {
      html += `<option value="${esc(a.id)}"${a.id === cur ? ' selected' : ''}>${esc(a.icon)} ${esc(a.name)}</option>`;
    });
    sel.innerHTML = html;
  }

  function populateCategorySelect(selId) {
    const sel = $(selId);
    if (!sel) return;
    const s = MozeData.getState();
    const cur = sel.value;
    sel.innerHTML = s.categories.map(c =>
      `<option value="${esc(c.id)}"${c.id === cur ? ' selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`
    ).join('');
  }

  function populateProjectSelect(selId) {
    const sel = $(selId);
    if (!sel) return;
    const s = MozeData.getState();
    const cur = sel.value;
    sel.innerHTML = '<option value="">無</option>' + s.projects.map(p =>
      `<option value="${esc(p.id)}"${p.id === cur ? ' selected' : ''}>${esc(p.icon)} ${esc(p.name)}</option>`
    ).join('');
  }

  /* ═══════════════════════════════════════ */
  /*           彈窗邏輯                       */
  /* ═══════════════════════════════════════ */
  let txType = 'expense';
  let txMode = 'expense';
  let editingTxId = null;
  let txAdvancedMode = 'single';
  let txAdvancedDraftMode = 'single';
  let txInstallmentDraft = null;
  let activeTxItemRowId = '';

  const TX_MODE_META = {
    expense: { label: '支出', baseType: 'expense', tag: '' },
    income: { label: '收入', baseType: 'income', tag: '' },
    transfer: { label: '轉帳', baseType: 'transfer', tag: '' },
    receivable: { label: '應收款項', baseType: 'income', tag: '應收款項' },
    payable: { label: '應付款項', baseType: 'expense', tag: '應付款項' },
    system: { label: '系統', baseType: 'expense', tag: '系統' },
  };

  const ADVANCED_MODE_META = {
    single: { label: '單次', summary: '立即入帳' },
    recurring: { label: '週期', summary: '週期草稿' },
    installment: { label: '分期', summary: '分期草稿' },
  };

  function defaultInstallmentDraft(totalAmount) {
    return {
      enabled: true,
      totalAmount: Math.max(0, parseFloat(totalAmount) || 0),
      periods: 3,
      interestType: 'none',
      interestValue: 0,
      rounding: 'last_adjust',
      firstPayment: 0,
      gracePeriods: 0,
      bookingMode: 'immediate',
      rewardMode: 'each_period',
    };
  }

  function currentModalNormalAmount() {
    return collectModalItems().reduce(function (sum, item) {
      return sum + (parseFloat(item.amount) || 0);
    }, 0);
  }

  function installmentPreview(config) {
    const draft = config || defaultInstallmentDraft(0);
    const totalAmount = Math.max(0, parseFloat(draft.totalAmount) || 0);
    const periods = Math.max(1, Math.round(parseFloat(draft.periods) || 1));
    const interestValue = Math.max(0, parseFloat(draft.interestValue) || 0);
    const firstPayment = Math.max(0, parseFloat(draft.firstPayment) || 0);
    let totalWithInterest = totalAmount;
    if (draft.interestType === 'fixed_total') totalWithInterest += interestValue;
    else if (draft.interestType === 'fixed_each') totalWithInterest += interestValue * periods;
    else if (draft.interestType === 'annual_rate') totalWithInterest += totalAmount * (interestValue / 100) * (periods / 12);
    const remaining = Math.max(0, totalWithInterest - firstPayment);
    const rawPerPeriod = periods > 0 ? (remaining / periods) : remaining;
    const perPeriodAmount = draft.rounding === 'round'
      ? Math.round(rawPerPeriod)
      : Math.round(rawPerPeriod * 100) / 100;
    return {
      totalAmount,
      periods,
      interestType: draft.interestType,
      interestValue,
      firstPayment,
      gracePeriods: Math.max(0, Math.round(parseFloat(draft.gracePeriods) || 0)),
      bookingMode: draft.bookingMode || 'immediate',
      rewardMode: draft.rewardMode || 'each_period',
      rounding: draft.rounding || 'last_adjust',
      totalWithInterest,
      perPeriodAmount,
    };
  }

  function readInstallmentDraftFromFields() {
    return installmentPreview({
      enabled: true,
      totalAmount: (($('tx-installment-total') || {}).value || 0),
      periods: (($('tx-installment-periods') || {}).value || 1),
      interestType: (($('tx-installment-interest-type') || {}).value || 'none'),
      interestValue: (($('tx-installment-interest-value') || {}).value || 0),
      rounding: (($('tx-installment-rounding') || {}).value || 'last_adjust'),
      firstPayment: (($('tx-installment-first-payment') || {}).value || 0),
      gracePeriods: (($('tx-installment-grace-periods') || {}).value || 0),
      bookingMode: (($('tx-installment-booking-mode') || {}).value || 'immediate'),
      rewardMode: (($('tx-installment-reward-mode') || {}).value || 'each_period'),
    });
  }

  function renderInstallmentDraft() {
    const draft = installmentPreview(txInstallmentDraft || defaultInstallmentDraft(currentModalNormalAmount()));
    txInstallmentDraft = draft;
    const panel = $('tx-advanced-installment-panel');
    if (panel) panel.style.display = txAdvancedDraftMode === 'installment' ? 'block' : 'none';
    const total = $('tx-installment-total');
    if (total) total.value = draft.totalAmount ? String(draft.totalAmount) : '';
    const periods = $('tx-installment-periods');
    if (periods) periods.value = String(draft.periods);
    const interestType = $('tx-installment-interest-type');
    if (interestType) interestType.value = draft.interestType;
    const interestValue = $('tx-installment-interest-value');
    if (interestValue) interestValue.value = String(draft.interestValue || 0);
    const rounding = $('tx-installment-rounding');
    if (rounding) rounding.value = draft.rounding;
    const firstPayment = $('tx-installment-first-payment');
    if (firstPayment) firstPayment.value = String(draft.firstPayment || 0);
    const bookingMode = $('tx-installment-booking-mode');
    if (bookingMode) bookingMode.value = draft.bookingMode;
    const gracePeriods = $('tx-installment-grace-periods');
    if (gracePeriods) gracePeriods.value = String(draft.gracePeriods || 0);
    const rewardMode = $('tx-installment-reward-mode');
    if (rewardMode) rewardMode.value = draft.rewardMode;
    const perPeriod = $('tx-installment-per-period');
    if (perPeriod) perPeriod.value = MozeData.formatMoney(draft.perPeriodAmount || 0);
  }

  function baseTypeForMode(mode) {
    return (TX_MODE_META[mode] || TX_MODE_META.expense).baseType;
  }

  function modeFromTx(tx) {
    if (!tx) return 'expense';
    if (tx.type === 'transfer') return 'transfer';
    const tags = Array.isArray(tx.tags) ? tx.tags : [];
    if (tags.includes('應收款項')) return 'receivable';
    if (tags.includes('應付款項')) return 'payable';
    if (tags.includes('系統')) return 'system';
    return tx.type === 'income' ? 'income' : 'expense';
  }

  function advancedModeFromTx(tx) {
    if (tx && tx.installment && tx.installment.enabled) return 'installment';
    const tags = Array.isArray(tx && tx.tags) ? tx.tags : [];
    if (tags.includes('分期草稿')) return 'installment';
    if (tags.includes('週期草稿')) return 'recurring';
    return 'single';
  }

  function modalHintText(mode) {
    if (mode === 'transfer') return '第一階段保留既有轉帳模型。';
    if (mode === 'receivable') return '第一階段先以一般收入交易寫入，並加上「應收款項」標籤。';
    if (mode === 'payable') return '第一階段先以一般支出交易寫入，並加上「應付款項」標籤。';
    if (mode === 'system') return '第一階段先以一般支出交易寫入，並加上「系統」標籤。';
    return '';
  }

  function modalCategoriesForMode(mode) {
    const categories = (MozeData.getState().categories || []).slice();
    const expensePreferred = ['cat-food', 'cat-trans', 'cat-shop', 'cat-bill', 'cat-fun', 'cat-med', 'cat-other'];
    const incomePreferred = ['cat-salary', 'cat-reward', 'cat-interest', 'cat-other'];
    const systemPreferred = ['cat-fee', 'cat-discount', 'cat-reward', 'cat-interest', 'cat-other'];
    const payablePreferred = ['cat-bill', 'cat-med', 'cat-shop', 'cat-other'];
    function pick(ids) {
      return categories
        .filter(function (cat) { return ids.includes(cat.id); })
        .sort(function (a, b) { return ids.indexOf(a.id) - ids.indexOf(b.id); });
    }

    if (mode === 'transfer') return [];
    if (mode === 'income' || mode === 'receivable') return pick(incomePreferred);
    if (mode === 'system') return pick(systemPreferred);
    if (mode === 'payable') return pick(payablePreferred);
    if (mode === 'expense') return pick(expensePreferred);
    return pick(expensePreferred);
  }

  function ensureModalCategorySelection() {
    const select = $('tx-category');
    const pool = modalCategoriesForMode(txMode);
    if (!select || !pool.length) return;
    const activeRow = activeTxItemRow();
    const targetCategoryId = activeRow
      ? ((activeRow.querySelector('.tx-item-category') || {}).value || '')
      : select.value;
    if (pool.some(function (cat) { return cat.id === targetCategoryId; })) {
      select.value = targetCategoryId;
      return;
    }
    select.value = pool[0].id;
  }

  function renderModalCategoryPills() {
    const wrap = $('tx-category-pills');
    const select = $('tx-category');
    if (!wrap || !select) return;
    const pool = modalCategoriesForMode(txMode);
    if (!pool.length) {
      wrap.innerHTML = '<div class="tx-phase-note">此模式目前不使用分類。</div>';
      return;
    }
    ensureModalCategorySelection();
    wrap.innerHTML = pool.map(function (cat) {
      const active = cat.id === select.value ? ' active' : '';
      return `<button class="tx-category-pill${active}" type="button" data-tx-category="${esc(cat.id)}">
        <span class="tx-category-pill-icon">${esc(cat.icon)}</span>
        <span class="tx-category-pill-label">${esc(cat.name)}</span>
      </button>`;
    }).join('');
  }

  function syncAdvancedSummary() {
    const trigger = $('btn-open-advanced-settings');
    const summary = $('tx-advanced-summary-text');
    const meta = ADVANCED_MODE_META[txAdvancedMode] || ADVANCED_MODE_META.single;
    if (trigger) {
      if (txAdvancedMode === 'installment') {
        const preview = installmentPreview(txInstallmentDraft || defaultInstallmentDraft(currentModalNormalAmount()));
        trigger.textContent = `分期｜${preview.periods} 期`;
      } else {
        trigger.textContent = meta.label;
      }
    }
    if (summary) {
      if (txAdvancedMode === 'installment') {
        const preview = installmentPreview(txInstallmentDraft || defaultInstallmentDraft(currentModalNormalAmount()));
        summary.textContent = `${preview.bookingMode === 'per_period' ? '按期入帳' : '立即入帳'}｜每期 ${MozeData.formatMoney(preview.perPeriodAmount)}`;
      } else {
        summary.textContent = meta.summary;
      }
    }
  }

  function renderAdvancedTabs() {
    $$el('#tx-advanced-tabs .type-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.advancedMode === txAdvancedDraftMode);
    });
    const note = $('tx-advanced-note');
    renderInstallmentDraft();
    if (!note) return;
    if (txAdvancedDraftMode === 'single') note.textContent = '目前模式會立即入帳。';
    else if (txAdvancedDraftMode === 'recurring') note.textContent = '第一階段先完成 UI。週期事件第二階段才會自動生成。';
    else note.textContent = '第一階段會儲存分期母單與設定，不會先自動生成各期交易。';
  }

  function openAdvancedModal() {
    if (!txInstallmentDraft) {
      txInstallmentDraft = defaultInstallmentDraft(currentModalNormalAmount());
    }
    txAdvancedDraftMode = txAdvancedMode;
    const overlay = $('tx-advanced-overlay');
    if (overlay) overlay.classList.add('open');
    renderAdvancedTabs();
  }

  function closeAdvancedModal() {
    const overlay = $('tx-advanced-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  function syncMirroredModalFields() {
    const date = $('tx-date');
    const dateTransfer = $('tx-date-transfer');
    const time = $('tx-time');
    const timeTransfer = $('tx-time-transfer');
    const note = $('tx-note');
    const noteTransfer = $('tx-note-transfer');
    if (date && dateTransfer) dateTransfer.value = date.value;
    if (time && timeTransfer) timeTransfer.value = time.value;
    if (note && noteTransfer) noteTransfer.value = note.value;
  }

  function syncBackFromTransferFields() {
    const date = $('tx-date');
    const dateTransfer = $('tx-date-transfer');
    const time = $('tx-time');
    const timeTransfer = $('tx-time-transfer');
    const note = $('tx-note');
    const noteTransfer = $('tx-note-transfer');
    if (date && dateTransfer) date.value = dateTransfer.value;
    if (time && timeTransfer) time.value = timeTransfer.value;
    if (note && noteTransfer) note.value = noteTransfer.value;
  }

  function setModalMode(mode) {
    txMode = TX_MODE_META[mode] ? mode : 'expense';
    txType = baseTypeForMode(txMode);
    updateModalType();
  }

  function blankModalItem(categoryId) {
    return {
      id: MozeData.uid(),
      categoryId: categoryId || (($('tx-category') || {}).value || (MozeData.getState().categories[0] || {}).id || ''),
      title: '',
      amount: '',
    };
  }

  function activeTxItemRow() {
    if (!activeTxItemRowId) return null;
    return $el(`[data-tx-item-row="${activeTxItemRowId}"]`);
  }

  function setActiveTxItemRow(id) {
    activeTxItemRowId = id || '';
    $$el('#tx-items-list .tx-item-row').forEach(function (row) {
      row.classList.toggle('active', row.dataset.txItemRow === activeTxItemRowId);
    });
    renderModalCategoryPills();
  }

  function syncModalItemsSummary() {
    const totalEl = $('tx-items-total');
    if (!totalEl) return;
    const total = collectModalItems().reduce(function (sum, item) {
      return sum + (parseFloat(item.amount) || 0);
    }, 0);
    totalEl.textContent = `合計 ${MozeData.formatMoney(total)}`;
  }

  function modalItemOptions(selectedId) {
    const pool = modalCategoriesForMode(txMode);
    return pool.map(function (cat) {
      return `<option value="${esc(cat.id)}"${cat.id === selectedId ? ' selected' : ''}>${esc(cat.icon)} ${esc(cat.name)}</option>`;
    }).join('');
  }

  function renderModalItemRows(items) {
    const list = $('tx-items-list');
    if (!list) return;
    const categoryPool = modalCategoriesForMode(txMode);
    const fallbackCategoryId = (($('tx-category') || {}).value || (categoryPool[0] || {}).id || (MozeData.getState().categories[0] || {}).id || '');
    const rows = (items && items.length ? items : [blankModalItem()]).map(function (item) {
      const categoryId = categoryPool.some(function (cat) { return cat.id === item.categoryId; })
        ? item.categoryId
        : fallbackCategoryId;
      return {
        id: item.id || MozeData.uid(),
        categoryId,
        title: item.title || '',
        amount: item.amount === 0 ? '0' : (item.amount || ''),
      };
    });
    if (!rows.some(function (item) { return item.id === activeTxItemRowId; })) {
      activeTxItemRowId = rows[0].id;
    }
    list.innerHTML = rows.map(function (item, index) {
      return `<div class="tx-item-row${item.id === activeTxItemRowId ? ' active' : ''}" data-tx-item-row="${esc(item.id)}">
        <div class="tx-item-row-grid">
          <select class="tx-item-category">${modalItemOptions(item.categoryId)}</select>
          <input class="tx-item-title" type="text" value="${esc(item.title)}" placeholder="名稱" list="tx-title-templates">
          <input class="tx-item-amount" type="number" value="${esc(String(item.amount))}" step="0.01" placeholder="金額">
        </div>
        <div class="tx-item-actions">
          <button class="tx-item-action" type="button" data-move-tx-item="up:${esc(item.id)}" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="tx-item-action" type="button" data-move-tx-item="down:${esc(item.id)}" ${index === rows.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="tx-item-action tx-item-remove" type="button" data-remove-tx-item="${esc(item.id)}" ${rows.length === 1 ? 'disabled' : ''}>✕</button>
        </div>
      </div>`;
    }).join('');
    renderModalLibraryLists();
    syncModalItemsSummary();
  }

  function collectModalItems() {
    return Array.from($$el('#tx-items-list .tx-item-row')).map(function (row) {
      return {
        id: row.dataset.txItemRow || MozeData.uid(),
        categoryId: (row.querySelector('.tx-item-category') || {}).value || '',
        title: ((row.querySelector('.tx-item-title') || {}).value || '').trim(),
        amount: parseFloat((row.querySelector('.tx-item-amount') || {}).value) || 0,
      };
    }).filter(function (item) {
      return item.amount > 0 || item.title;
    });
  }

  function openModal(existingTx) {
    const overlay = $('tx-modal-overlay');
    if (overlay) overlay.classList.add('open');
    editingTxId = existingTx && existingTx.id ? existingTx.id : null;
    txMode = modeFromTx(existingTx);
    txType = baseTypeForMode(txMode);
    txAdvancedMode = advancedModeFromTx(existingTx);
    txInstallmentDraft = existingTx && existingTx.installment
      ? { ...existingTx.installment }
      : defaultInstallmentDraft(existingTx ? (existingTx.amount || 0) : 0);
    const s = MozeData.getState();
    const modalTitle = $('tx-modal-title');
    if (modalTitle) modalTitle.textContent = editingTxId ? '編輯記錄' : '新增記錄';
    const saveBtn = $('btn-save-tx');
    if (saveBtn) saveBtn.textContent = editingTxId ? '更新交易' : '儲存交易';
    populateAccountSelect('tx-account', false);
    populateAccountSelect('tx-from-account', false);
    populateAccountSelect('tx-to-account', false);
    populateCategorySelect('tx-category');
    populateProjectSelect('tx-project');
    const txAcc = $('tx-account');
    if (txAcc) txAcc.value = existingTx ? (existingTx.accountId || s.activeAccountId) : s.activeAccountId;
    const txFrom = $('tx-from-account');
    if (txFrom) txFrom.value = existingTx ? (existingTx.accountId || s.activeAccountId) : s.activeAccountId;
    const txTo = $('tx-to-account');
    if (txTo) txTo.value = existingTx ? (existingTx.toAccountId || '') : '';
    const txCategory = $('tx-category');
    if (txCategory) txCategory.value = existingTx ? (existingTx.categoryId || txCategory.value) : txCategory.value;
    const txProject = $('tx-project');
    if (txProject) txProject.value = existingTx ? (existingTx.projectId || '') : '';
    const txMerchant = $('tx-merchant');
    if (txMerchant) txMerchant.value = existingTx ? (existingTx.merchant || '') : '';
    const txCounterpart = $('tx-counterpart');
    if (txCounterpart) txCounterpart.value = existingTx ? (existingTx.counterpart || '') : '';
    const txParentTitle = $('tx-parent-title');
    if (txParentTitle) txParentTitle.value = existingTx ? (existingTx.title || '') : '';
    const txDate = $('tx-date');
    if (txDate) txDate.value = existingTx ? (existingTx.date || MozeData.today()) : MozeData.today();
    const txDateTransfer = $('tx-date-transfer');
    if (txDateTransfer) txDateTransfer.value = existingTx ? (existingTx.date || MozeData.today()) : MozeData.today();
    const txTime = $('tx-time');
    if (txTime) txTime.value = existingTx ? (existingTx.time || '00:00') : new Date().toTimeString().slice(0, 5);
    const txTimeTransfer = $('tx-time-transfer');
    if (txTimeTransfer) txTimeTransfer.value = existingTx ? (existingTx.time || '00:00') : new Date().toTimeString().slice(0, 5);
    const txAmountTransfer = $('tx-amount-transfer');
    if (txAmountTransfer) txAmountTransfer.value = existingTx ? String(existingTx.amount || '') : '';
    const txNote = $('tx-note');
    if (txNote) txNote.value = existingTx ? (existingTx.note || '') : '';
    const txNoteTransfer = $('tx-note-transfer');
    if (txNoteTransfer) txNoteTransfer.value = existingTx ? (existingTx.note || '') : '';
    const txTags = $('tx-tags');
    if (txTags) txTags.value = existingTx ? ((existingTx.tags || []).join(', ')) : '';
    const txFee = $('tx-fee');
    if (txFee) txFee.value = existingTx ? String(existingTx.fee || 0) : '0';
    const modalItems = existingTx && existingTx.type !== 'transfer'
      ? MozeData.transactionItems(existingTx).map(function (item) {
          return {
            id: item.id,
            categoryId: item.categoryId,
            title: item.title || '',
            amount: item.amount,
          };
        })
      : [blankModalItem()];
    activeTxItemRowId = modalItems[0] ? modalItems[0].id : '';
    renderModalItemRows(modalItems);
    updateModalType();
    syncAdvancedSummary();
    syncMirroredModalFields();
  }

  function closeModal() {
    const overlay = $('tx-modal-overlay');
    if (overlay) overlay.classList.remove('open');
    editingTxId = null;
    txMode = 'expense';
    txType = 'expense';
    txAdvancedMode = 'single';
    txInstallmentDraft = defaultInstallmentDraft(0);
    activeTxItemRowId = '';
    const modalTitle = $('tx-modal-title');
    if (modalTitle) modalTitle.textContent = '新增記錄';
    const saveBtn = $('btn-save-tx');
    if (saveBtn) saveBtn.textContent = '儲存交易';
    syncAdvancedSummary();
  }

  function updateModalType() {
    $$el('#tx-type-tabs .type-tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === txMode);
    });
    const transfer = $('tx-transfer-fields');
    const normal = $('tx-normal-fields');
    if (transfer) transfer.style.display = txType === 'transfer' ? 'block' : 'none';
    if (normal) normal.style.display = txType === 'transfer' ? 'none' : 'block';
    const hint = $('tx-mode-hint');
    if (hint) {
      hint.textContent = modalHintText(txMode);
      hint.style.display = hint.textContent ? 'block' : 'none';
    }
    if (txType !== 'transfer') {
      const items = collectModalItems();
      renderModalItemRows(items.length ? items : [blankModalItem(($('tx-category') || {}).value || '')]);
    }
    renderModalCategoryPills();
  }

  function saveTransaction() {
    if (txType === 'transfer') syncBackFromTransferFields();
    const items = txType === 'transfer' ? [] : collectModalItems();
    const amount = txType === 'transfer'
      ? parseFloat(($('tx-amount-transfer') || {}).value)
      : items.reduce((sum, item) => sum + item.amount, 0);
    if (!amount || amount <= 0) {
      alert(txType === 'transfer' ? '請輸入有效金額' : '請至少新增一個有效內容');
      return;
    }

    const tagsRaw = ($('tx-tags') || {}).value || '';
    const tags = tagsRaw.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    const modeTag = (TX_MODE_META[txMode] || {}).tag;
    if (modeTag && !tags.includes(modeTag)) tags.push(modeTag);
    if (txAdvancedMode === 'recurring' && !tags.includes('週期草稿')) tags.push('週期草稿');
    if (txAdvancedMode === 'installment' && !tags.includes('分期草稿')) tags.push('分期草稿');

    const tx = {
      type: txType,
      amount,
      fee: parseFloat(($('tx-fee') || {}).value) || 0,
      accountId: txType === 'transfer' ? (($('tx-from-account') || {}).value || '') : (($('tx-account') || {}).value || ''),
      toAccountId: txType === 'transfer' ? (($('tx-to-account') || {}).value || '') : '',
      categoryId: txType === 'transfer' ? '' : ((items[0] || {}).categoryId || (($('tx-category') || {}).value || '')),
      date: (txType === 'transfer' ? ($('tx-date-transfer') || {}).value : ($('tx-date') || {}).value) || MozeData.today(),
      time: (txType === 'transfer' ? ($('tx-time-transfer') || {}).value : ($('tx-time') || {}).value) || '00:00',
      title: txType === 'transfer' ? '' : ((($('tx-parent-title') || {}).value || '').trim() || ((items[0] || {}).title || '')),
      merchant: (($('tx-merchant') || {}).value || '').trim(),
      counterpart: (($('tx-counterpart') || {}).value || '').trim(),
      note: (txType === 'transfer' ? ($('tx-note-transfer') || {}).value : ($('tx-note') || {}).value) || '',
      tags,
      items,
      installment: txAdvancedMode === 'installment' ? installmentPreview(txInstallmentDraft || defaultInstallmentDraft(amount)) : null,
      projectId: ($('tx-project') || {}).value || '',
    };

    if (editingTxId) MozeData.updateTransaction(editingTxId, tx);
    else MozeData.addTransaction(tx);
    if (tx.merchant) MozeData.addLibraryEntry('merchants', tx.merchant);
    if (tx.counterpart) MozeData.addLibraryEntry('counterparts', tx.counterpart);
    closeModal();
    refreshAll();
  }

  /* ═══════════════════════════════════════ */
  /*           事件綁定                       */
  /* ═══════════════════════════════════════ */
  let eventsBound = false;
  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    /* 側欄導航 */
    $$el('.sidebar-nav .nav-item').forEach(n => {
      n.addEventListener('click', () => switchView(n.dataset.view));
    });

    /* 底部導航 */
    $$el('.bottom-nav .bnav-item').forEach(n => {
      n.addEventListener('click', () => switchView(n.dataset.view));
    });

    $$el('[data-more-pane-nav]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchMorePane(btn.dataset.morePaneNav);
      });
    });

    const btnGoProjects = $('btn-go-projects');
    if (btnGoProjects) btnGoProjects.addEventListener('click', function () {
      switchView('projects');
    });
    const btnGoErrorlogs = $('btn-go-errorlogs');
    if (btnGoErrorlogs) btnGoErrorlogs.addEventListener('click', function () {
      switchView('errorlogs');
    });

    /* 日期區間 */
    const rs = $('range-start');
    const re = $('range-end');
    if (rs) rs.addEventListener('change', () => { rangeStart = rs.value; refreshAll(); });
    if (re) re.addEventListener('change', () => { rangeEnd = re.value; refreshAll(); });

    document.addEventListener('click', function (event) {
      const dateInput = event.target.closest('[data-date-picker]');
      const insidePicker = event.target.closest('#date-picker-popover');
      const overlay = $('date-picker-overlay');

      if (dateInput) {
        event.preventDefault();
        openDatePicker(dateInput);
        return;
      }

      if (overlay && overlay.classList.contains('open') && !insidePicker) {
        closeDatePicker();
      }
    });

    document.addEventListener('focusin', function (event) {
      const dateInput = event.target.closest('[data-date-picker]');
      if (dateInput) openDatePicker(dateInput);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeDatePicker();
    });

    const dpPrev = $('date-picker-prev');
    const dpNext = $('date-picker-next');
    const dpToday = $('date-picker-today');
    const dpClose = $('date-picker-close');
    if (dpPrev) dpPrev.addEventListener('click', function () {
      datePickerMonth = MozeData.addMonths(datePickerMonth, -1);
      renderDatePicker();
    });
    if (dpNext) dpNext.addEventListener('click', function () {
      datePickerMonth = MozeData.addMonths(datePickerMonth, 1);
      renderDatePicker();
    });
    if (dpToday) dpToday.addEventListener('click', function () {
      if (!datePickerTarget) return;
      setDateInputValue(datePickerTarget, MozeData.today());
      closeDatePicker();
    });
    if (dpClose) dpClose.addEventListener('click', closeDatePicker);

    const rp = $('range-prev');
    const rn = $('range-next');
    if (rp) rp.addEventListener('click', () => shiftRange(-1));
    if (rn) rn.addEventListener('click', () => shiftRange(1));

    /* 月曆導航 */
    const cp = $('cal-prev');
    const cn = $('cal-next');
    if (cp) cp.addEventListener('click', () => { calMonth = MozeData.addMonths(calMonth, -1); renderCalendar(); });
    if (cn) cn.addEventListener('click', () => { calMonth = MozeData.addMonths(calMonth, 1); renderCalendar(); });

    /* 即將到來 */
    const btnUp = $('btn-add-upcoming');
    if (btnUp) btnUp.addEventListener('click', () => {
      const title = ($('up-title') || {}).value;
      const amount = ($('up-amount') || {}).value;
      const type = ($('up-type') || {}).value;
      const accountId = ($('up-account') || {}).value;
      const nextDate = ($('up-date') || {}).value;
      if (!title || !amount) { alert('請填入標題與金額'); return; }
      MozeData.addUpcoming({ title, amount, type, accountId, nextDate: nextDate || MozeData.today() });
      if ($('up-title')) $('up-title').value = '';
      if ($('up-amount')) $('up-amount').value = '';
      renderUpcoming();
    });

    /* 新增帳戶 */
    const btnAddAcc = $('btn-add-account');
    if (btnAddAcc) btnAddAcc.addEventListener('click', () => {
      const name = ($('new-acc-name') || {}).value.trim();
      if (!name) { alert('請輸入帳戶名稱'); return; }
      const group = ($('new-acc-group') || {}).value;
      const icon = ($('new-acc-icon') || {}).value || '💵';
      const bal = parseFloat(($('new-acc-balance') || {}).value) || 0;
      MozeData.addAccount(name, group, icon, bal);
      if ($('new-acc-name')) $('new-acc-name').value = '';
      renderAccounts();
    });

    /* 改名帳戶 */
    const btnRename = $('btn-rename-acc');
    if (btnRename) btnRename.addEventListener('click', () => {
      const s = MozeData.getState();
      const acc = s.accounts.find(a => a.id === s.selectedAccountId);
      if (!acc) return;
      const newName = prompt('新帳戶名稱：', acc.name);
      if (newName && newName.trim()) {
        MozeData.renameAccount(acc.id, newName.trim());
        renderAccounts();
      }
    });

    /* 刪除帳戶 */
    const btnDelAcc = $('btn-delete-acc');
    if (btnDelAcc) btnDelAcc.addEventListener('click', () => {
      const s = MozeData.getState();
      if (s.accounts.length <= 1) { alert('至少保留一個帳戶'); return; }
      const acc = s.accounts.find(a => a.id === s.selectedAccountId);
      if (!acc) return;
      const count = MozeData.accountTxCount(acc.id);
      if (count > 0) {
        const others = s.accounts.filter(a => a.id !== acc.id);
        const mergeTarget = prompt(`此帳戶有 ${count} 筆交易。\n請輸入要合併到的帳戶名稱：\n${others.map(a => a.name).join('、')}`);
        if (!mergeTarget) return;
        const target = others.find(a => a.name === mergeTarget);
        if (!target) { alert('找不到該帳戶'); return; }
        MozeData.deleteAccount(acc.id, target.id);
      } else {
        if (!confirm(`確定刪除帳戶「${acc.name}」？`)) return;
        MozeData.deleteAccount(acc.id);
      }
      MozeData.setSelectedAccount(MozeData.getState().accounts[0].id);
      renderAccounts();
    });

    /* 流水帳篩選 */
    const lAcc = $('ledger-account');
    const lType = $('ledger-type');
    const lMonth = $('ledger-month');
    if (lAcc) lAcc.addEventListener('change', renderLedger);
    if (lType) lType.addEventListener('change', renderLedger);
    if (lMonth) lMonth.addEventListener('change', renderLedger);

    /* 報表快捷按鈕 */
    $$el('#report-shortcuts button').forEach(btn => {
      btn.addEventListener('click', () => {
        const months = parseInt(btn.dataset.range);
        reportRange = months;
        $$el('#report-shortcuts button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        setReportRange(months);
        renderReports();
      });
    });

    /* 專案 */
    const btnAddProj = $('btn-add-project');
    if (btnAddProj) btnAddProj.addEventListener('click', () => {
      const name = ($('new-proj-name') || {}).value.trim();
      if (!name) { alert('請輸入專案名稱'); return; }
      const icon = ($('new-proj-icon') || {}).value || '📁';
      const start = ($('new-proj-start') || {}).value || MozeData.today();
      const p = MozeData.addProject(name, icon, start, '');
      selectedProjectId = p.id;
      if ($('new-proj-name')) $('new-proj-name').value = '';
      renderProjects();
    });

    const btnSetBudget = $('btn-set-budget');
    if (btnSetBudget) btnSetBudget.addEventListener('click', () => {
      if (!selectedProjectId) { alert('請先選擇專案'); return; }
      const catId = ($('budget-cat') || {}).value;
      const limit = parseFloat(($('budget-limit') || {}).value);
      if (!catId || !limit || limit <= 0) { alert('請選擇分類並輸入有效上限'); return; }
      MozeData.setBudget(selectedProjectId, catId, limit);
      if ($('budget-limit')) $('budget-limit').value = '';
      renderProjectDetail();
    });

    /* 搜尋 */
    const searchInput = $('search-input');
    if (searchInput) {
      let debounce;
      searchInput.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(renderSearch, 200);
      });
    }
    $$el('[data-query-chip]').forEach(btn => {
      btn.addEventListener('click', () => {
        const search = $('search-input');
        if (!search) return;
        search.value = btn.dataset.queryChip || '';
        renderSearch();
      });
    });

    /* 設定 */
    const btnSaveLiab = $('btn-save-liabilities');
    if (btnSaveLiab) btnSaveLiab.addEventListener('click', () => {
      MozeData.setLiabilities(($('settings-liabilities') || {}).value);
      alert('已儲存');
    });

    const btnAddCat = $('btn-add-cat');
    if (btnAddCat) btnAddCat.addEventListener('click', () => {
      const name = ($('new-cat-name') || {}).value.trim();
      if (!name) { alert('請輸入分類名稱'); return; }
      const icon = ($('new-cat-icon') || {}).value || '📦';
      MozeData.addCategory(name, icon);
      if ($('new-cat-name')) $('new-cat-name').value = '';
      renderSettings();
    });

    const btnAddMerchant = $('btn-add-merchant');
    if (btnAddMerchant) btnAddMerchant.addEventListener('click', () => {
      const input = $('new-merchant-name');
      const name = ((input || {}).value || '').trim();
      if (!name) return;
      MozeData.addLibraryEntry('merchants', name);
      if (input) input.value = '';
      renderSettings();
    });

    const btnAddCounterpart = $('btn-add-counterpart');
    if (btnAddCounterpart) btnAddCounterpart.addEventListener('click', () => {
      const input = $('new-counterpart-name');
      const name = ((input || {}).value || '').trim();
      if (!name) return;
      MozeData.addLibraryEntry('counterparts', name);
      if (input) input.value = '';
      renderSettings();
    });

    const btnAddTemplate = $('btn-add-template');
    if (btnAddTemplate) btnAddTemplate.addEventListener('click', () => {
      const input = $('new-template-name');
      const name = ((input || {}).value || '').trim();
      if (!name) return;
      MozeData.addLibraryEntry('titleTemplates', name);
      if (input) input.value = '';
      renderSettings();
    });

    const btnExport = $('btn-export');
    if (btnExport) btnExport.addEventListener('click', () => {
      const json = MozeData.exportJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `accounting-backup-${MozeData.today()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    const btnImport = $('btn-import');
    const importFile = $('import-file');
    if (btnImport && importFile) {
      btnImport.addEventListener('click', () => importFile.click());
      importFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const ok = MozeData.importJSON(ev.target.result);
          if (ok) { alert('還原成功！'); refreshAll(); }
          else alert('還原失敗，請確認檔案格式。');
        };
        reader.readAsText(file);
        importFile.value = '';
      });
    }

    /* 彈窗 */
    const btnOpen = $('btn-open-modal');
    if (btnOpen) btnOpen.addEventListener('click', openModal);
    const fabAdd = $('fab-add-tx');
    if (fabAdd) fabAdd.addEventListener('click', openModal);
    const btnClose = $('tx-modal-close');
    if (btnClose) btnClose.addEventListener('click', closeModal);
    const btnCancelTx = $('btn-cancel-tx');
    if (btnCancelTx) btnCancelTx.addEventListener('click', closeModal);
    const overlay = $('tx-modal-overlay');
    if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    const categoryPills = $('tx-category-pills');
    if (categoryPills) {
      categoryPills.addEventListener('click', function (event) {
        const btn = event.target.closest('[data-tx-category]');
        if (!btn) return;
        const select = $('tx-category');
        if (!select) return;
        select.value = btn.dataset.txCategory;
        const nextItems = collectModalItems();
        const targetId = activeTxItemRowId || ((nextItems[0] || {}).id);
        const patchedItems = nextItems.map(function (item) {
          return item.id === targetId ? { ...item, categoryId: btn.dataset.txCategory } : item;
        });
        if (!patchedItems.length) patchedItems.push(blankModalItem(btn.dataset.txCategory));
        renderModalItemRows(patchedItems);
        renderModalCategoryPills();
      });
    }

    $$el('#tx-type-tabs .type-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        setModalMode(tab.dataset.mode);
      });
    });

    const btnSaveTx = $('btn-save-tx');
    if (btnSaveTx) btnSaveTx.addEventListener('click', saveTransaction);
    const btnSaveTxTop = $('btn-save-tx-top');
    if (btnSaveTxTop) btnSaveTxTop.addEventListener('click', saveTransaction);

    const time = $('tx-time');
    const timeTransfer = $('tx-time-transfer');
    const note = $('tx-note');
    const noteTransfer = $('tx-note-transfer');
    const date = $('tx-date');
    const dateTransfer = $('tx-date-transfer');
    if (time && timeTransfer) {
      time.addEventListener('input', function () { timeTransfer.value = time.value; });
      timeTransfer.addEventListener('input', function () { time.value = timeTransfer.value; });
    }
    if (note && noteTransfer) {
      note.addEventListener('input', function () { noteTransfer.value = note.value; });
      noteTransfer.addEventListener('input', function () { note.value = noteTransfer.value; });
    }
    if (date && dateTransfer) {
      date.addEventListener('change', function () { dateTransfer.value = date.value; });
      dateTransfer.addEventListener('change', function () { date.value = dateTransfer.value; });
    }

    const btnOpenAdvanced = $('btn-open-advanced-settings');
    if (btnOpenAdvanced) btnOpenAdvanced.addEventListener('click', openAdvancedModal);
    const btnCloseAdvanced = $('tx-advanced-close');
    if (btnCloseAdvanced) btnCloseAdvanced.addEventListener('click', closeAdvancedModal);
    const btnCancelAdvanced = $('tx-advanced-cancel');
    if (btnCancelAdvanced) btnCancelAdvanced.addEventListener('click', closeAdvancedModal);
    const btnConfirmAdvanced = $('tx-advanced-confirm');
    if (btnConfirmAdvanced) {
      btnConfirmAdvanced.addEventListener('click', function () {
        if (txAdvancedDraftMode === 'installment') {
          txInstallmentDraft = readInstallmentDraftFromFields();
        }
        txAdvancedMode = txAdvancedDraftMode;
        syncAdvancedSummary();
        closeAdvancedModal();
      });
    }
    const advancedOverlay = $('tx-advanced-overlay');
    if (advancedOverlay) {
      advancedOverlay.addEventListener('click', function (event) {
        if (event.target === advancedOverlay) closeAdvancedModal();
      });
    }
    $$el('#tx-advanced-tabs .type-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        if (txAdvancedDraftMode === 'installment') {
          txInstallmentDraft = readInstallmentDraftFromFields();
        }
        txAdvancedDraftMode = tab.dataset.advancedMode;
        renderAdvancedTabs();
      });
    });

    ['tx-installment-total','tx-installment-periods','tx-installment-interest-type','tx-installment-interest-value','tx-installment-rounding','tx-installment-first-payment','tx-installment-booking-mode','tx-installment-grace-periods','tx-installment-reward-mode']
      .forEach(function (id) {
        const input = $(id);
        if (!input) return;
        input.addEventListener('input', function () {
          txInstallmentDraft = readInstallmentDraftFromFields();
          renderInstallmentDraft();
        });
        input.addEventListener('change', function () {
          txInstallmentDraft = readInstallmentDraftFromFields();
          renderInstallmentDraft();
        });
      });

    const btnAddTxItemRow = $('btn-add-tx-item-row');
    if (btnAddTxItemRow) {
      btnAddTxItemRow.addEventListener('click', function () {
        const rows = collectModalItems();
        const newItem = blankModalItem(($('tx-category') || {}).value || '');
        rows.push(newItem);
        activeTxItemRowId = newItem.id;
        renderModalItemRows(rows);
      });
    }
    const txItemsList = $('tx-items-list');
    if (txItemsList) {
      txItemsList.addEventListener('focusin', function (event) {
        const row = event.target.closest('.tx-item-row');
        if (!row) return;
        setActiveTxItemRow(row.dataset.txItemRow);
      });
      txItemsList.addEventListener('click', function (event) {
        const row = event.target.closest('.tx-item-row');
        if (row) setActiveTxItemRow(row.dataset.txItemRow);
      });
      txItemsList.addEventListener('input', function () {
        syncModalItemsSummary();
        if (txAdvancedMode === 'installment') syncAdvancedSummary();
      });
      txItemsList.addEventListener('change', function () {
        syncModalItemsSummary();
        if (txAdvancedMode === 'installment') syncAdvancedSummary();
        renderModalCategoryPills();
      });
      txItemsList.addEventListener('click', function (event) {
        const moveBtn = event.target.closest('[data-move-tx-item]');
        if (moveBtn) {
          const [direction, id] = moveBtn.dataset.moveTxItem.split(':');
          const rows = collectModalItems();
          const index = rows.findIndex(function (item) { return item.id === id; });
          if (index === -1) return;
          const swapIndex = direction === 'up' ? index - 1 : index + 1;
          if (swapIndex < 0 || swapIndex >= rows.length) return;
          const temp = rows[index];
          rows[index] = rows[swapIndex];
          rows[swapIndex] = temp;
          activeTxItemRowId = id;
          renderModalItemRows(rows);
          return;
        }
        const btn = event.target.closest('[data-remove-tx-item]');
        if (!btn) return;
        const rows = collectModalItems();
        const removedIndex = rows.findIndex(function (item) { return item.id === btn.dataset.removeTxItem; });
        const nextRows = rows.filter(function (item) {
          return item.id !== btn.dataset.removeTxItem;
        });
        const fallback = nextRows[Math.max(0, removedIndex - 1)] || nextRows[0];
        activeTxItemRowId = fallback ? fallback.id : '';
        renderModalItemRows(nextRows.length ? nextRows : [blankModalItem(($('tx-category') || {}).value || '')]);
      });
    }

    const btnOpenAuth = $('btn-open-auth-modal');
    if (btnOpenAuth) btnOpenAuth.addEventListener('click', openAuthModal);
    const btnOpenAuthFab = $('btn-open-auth-fab');
    if (btnOpenAuthFab) btnOpenAuthFab.addEventListener('click', openAuthModal);
    const authClose = $('auth-modal-close');
    if (authClose) authClose.addEventListener('click', closeAuthModal);
    const authOverlay = $('auth-modal-overlay');
    if (authOverlay) authOverlay.addEventListener('click', (e) => {
      if (e.target === authOverlay) closeAuthModal();
    });
    const btnGuest = $('btn-continue-guest');
    if (btnGuest) btnGuest.addEventListener('click', closeAuthModal);
    const btnSignOut = $('btn-sign-out');
    if (btnSignOut) {
      btnSignOut.addEventListener('click', function () {
        MozeSync.signOut().then(function () {
          closeAuthModal();
          showApp(null);
        });
      });
    }
    const btnDeleteUser = $('btn-delete-user-account');
    if (btnDeleteUser) {
      btnDeleteUser.addEventListener('click', function () {
        if (!currentUser) return;
        const ok = window.confirm(
          '刪除後會移除這個 Google/Firebase 帳號在雲端的記帳資料，且無法復原。\n\n確定要刪除帳號與雲端資料嗎？'
        );
        if (!ok) return;
        MozeSync.deleteUserAccount().then(function () {
          MozeData.resetLocalData();
          closeAuthModal();
          showApp(null);
        }).catch(function (err) {
          if (!err) return;
          if (err.code === 'auth/requires-recent-login') {
            alert('此操作需要重新登入。請先登出，再重新用 Google 登入後再試一次。');
          } else {
            alert('刪除帳號失敗：' + (err.message || err.code || 'unknown error'));
          }
        });
      });
    }

    const btnSubmitFeedback = $('btn-submit-feedback');
    if (btnSubmitFeedback) {
      btnSubmitFeedback.addEventListener('click', function () {
        const messageEl = $('feedback-message');
        const contactEl = $('feedback-contact');
        const statusEl = $('feedback-submit-status');
        const message = ((messageEl && messageEl.value) || '').trim();
        const contact = ((contactEl && contactEl.value) || '').trim();

        if (typeof MozeSync === 'undefined' || typeof MozeSync.submitFeedback !== 'function') {
          if (statusEl) {
            statusEl.textContent = '反饋模組未載入，請稍後再試。';
            statusEl.style.color = 'var(--red)';
            statusEl.dataset.locked = '1';
          }
          return;
        }

        if (!message || message.length < 3) {
          if (statusEl) {
            statusEl.textContent = '請至少輸入 3 個字描述問題或建議。';
            statusEl.style.color = 'var(--red)';
            statusEl.dataset.locked = '1';
          }
          return;
        }

        if (statusEl) {
          statusEl.textContent = '送出中…';
          statusEl.style.color = 'var(--text-dim)';
          statusEl.dataset.locked = '1';
        }
        btnSubmitFeedback.disabled = true;

        MozeSync.submitFeedback({ message, contact }).then(function () {
          if (messageEl) messageEl.value = '';
          if (contactEl) contactEl.value = '';
          if (statusEl) {
            statusEl.textContent = '已送出，謝謝你的回饋。';
            statusEl.style.color = 'var(--green)';
          }
          if (typeof MozeSync !== 'undefined' && typeof MozeSync.isAdmin === 'function' && MozeSync.isAdmin(currentUser)) {
            renderFeedback();
          }
        }).catch(function (err) {
          if (!statusEl) return;
          if (err && err.message === 'feedback-cooldown') {
            statusEl.textContent = '送出太快，請 30 秒後再試。';
          } else if (err && err.message === 'feedback-too-short') {
            statusEl.textContent = '內容太短，請補充更多細節。';
          } else {
            statusEl.textContent = '送出失敗，請稍後再試。';
          }
          statusEl.style.color = 'var(--red)';
        }).finally(function () {
          btnSubmitFeedback.disabled = false;
        });
      });
    }

    const feedbackMessage = $('feedback-message');
    if (feedbackMessage) feedbackMessage.addEventListener('input', resetFeedbackStatus);
    const feedbackContact = $('feedback-contact');
    if (feedbackContact) feedbackContact.addEventListener('input', resetFeedbackStatus);

    const btnRefreshFeedback = $('btn-refresh-feedback');
    if (btnRefreshFeedback) btnRefreshFeedback.addEventListener('click', renderFeedback);

    const btnRefreshErrorLogs = $('btn-refresh-errorlogs');
    if (btnRefreshErrorLogs) btnRefreshErrorLogs.addEventListener('click', renderErrorLogs);
    const btnClearErrorLogs = $('btn-clear-errorlogs');
    if (btnClearErrorLogs) {
      btnClearErrorLogs.addEventListener('click', function () {
        const isAdmin = typeof MozeSync !== 'undefined' && typeof MozeSync.isAdmin === 'function' && MozeSync.isAdmin(currentUser);
        if (!isAdmin) return;
        if (!window.confirm('確定要清空所有報錯日誌嗎？')) return;
        MozeSync.clearErrorLogs().then(function () {
          renderErrorLogs();
        }).catch(function (err) {
          alert('清空失敗：' + (err && (err.message || err.code) ? (err.message || err.code) : 'unknown error'));
        });
      });
    }
  }

  /* ─── 區間操作 ─── */
  function shiftRange(dir) {
    const days = Math.round((new Date(rangeEnd) - new Date(rangeStart)) / 86400000) + 1;
    const ms = dir * days * 86400000;
    const ns = new Date(new Date(rangeStart).getTime() + ms);
    const ne = new Date(new Date(rangeEnd).getTime() + ms);
    rangeStart = ns.toISOString().slice(0, 10);
    rangeEnd = ne.toISOString().slice(0, 10);
    const rs = $('range-start');
    const re = $('range-end');
    if (rs) rs.value = rangeStart;
    if (re) re.value = rangeEnd;
    refreshAll();
  }

  function setReportRange(months) {
    const t = MozeData.today();
    const mk = MozeData.monthKey(t);
    const endMk = mk;
    const startMk = MozeData.addMonths(mk, -(months - 1));
    const { y: sy, m: sm } = MozeData.parseMonth(startMk);
    const { y: ey, m: em } = MozeData.parseMonth(endMk);
    rangeStart = `${startMk}-01`;
    rangeEnd = `${endMk}-${String(MozeData.daysInMonth(ey, em)).padStart(2, '0')}`;
    const rs = $('range-start');
    const re = $('range-end');
    if (rs) rs.value = rangeStart;
    if (re) re.value = rangeEnd;
  }

  /* ─── 即將到來帳戶下拉 ─── */
  function initUpcomingAccount() {
    populateAccountSelect('up-account', false);
    const upDate = $('up-date');
    if (upDate) upDate.value = MozeData.today();
  }

  /* ─── PWA standalone 偵測 ─── */
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
    document.body.classList.add('pwa-standalone');
  }

  /* ─── 帳戶頁返回按鈕（手機） ─── */
  const accBackBtn = $('acc-back-btn');
  if (accBackBtn) {
    accBackBtn.addEventListener('click', () => {
      const layout = $('accounts-layout');
      if (layout) layout.classList.remove('show-detail');
    });
  }

  /* ─── 暴露 refreshAll 供同步模組呼叫 ─── */
  window.mozeRefreshAll = refreshAll;

  /* ─── 登入 / 登出 UI ─── */
  function showApp(user) {
    currentUser = user || null;
    stockQuotesCache = {};
    stockQuotesLoading = false;
    stockQuotesReady = false;
    const appLayout = $('app-layout');
    if (appLayout) appLayout.style.display = '';

    updateAuthPanel();
    if (typeof MozeSync !== 'undefined') {
      MozeSync.setStatus(user ? '雲端同步中…' : '本機模式（未同步）', user ? '#f6c342' : '#8e8e96');
    }
    if (typeof MozeTelemetry !== 'undefined') {
      if (typeof MozeTelemetry.init === 'function') MozeTelemetry.init();
      if (typeof MozeTelemetry.setUser === 'function') MozeTelemetry.setUser(user || null);
      if (typeof MozeTelemetry.setTag === 'function') MozeTelemetry.setTag('auth_mode', user ? 'cloud' : 'local');
    }

    initRange();
    bindEvents();
    bindGlobalErrorHandlers();
    initUpcomingAccount();
    refreshAll();
  }

  /* ─── 監聽登入狀態 + 初始化 GIS 按鈕 ─── */
  if (typeof MozeSync !== 'undefined') {
    MozeSync.onAuthChanged(function (user) {
      if (user) {
        showApp(user);
        MozeSync.startSync(user.uid);
        closeAuthModal();
      } else {
        showApp(null);
      }
    });
  } else {
    initRange();
    bindEvents();
    initUpcomingAccount();
    refreshAll();
  }
})();
