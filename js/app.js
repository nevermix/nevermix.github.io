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

  function formatErrorLogTime(isoText) {
    if (!isoText) return '';
    const d = new Date(isoText);
    if (Number.isNaN(d.getTime())) return esc(isoText);
    return d.toLocaleString('zh-TW');
  }

  function formatFeedbackTime(isoText) {
    if (!isoText) return '';
    const d = new Date(isoText);
    if (Number.isNaN(d.getTime())) return esc(isoText);
    return d.toLocaleString('zh-TW');
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
    const titles = { overview: '概覽', accounts: '帳戶', ledger: '流水帳', reports: '報表', projects: '專案', search: '搜尋', feedback: '意見反饋', errorlogs: '開發者欄位', settings: '設定' };
    const tt = $('topbar-title');
    if (tt) tt.textContent = titles[name] || name;
    refreshCurrentView();
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

    const comboData = MozeData.dailyNetCumulative(rangeStart, rangeEnd, accId);
    const dailyExp = MozeData.expenseByDay(rangeStart, rangeEnd, accId);
    const merged = comboData.map((d, i) => ({
      date: d.date,
      expense: dailyExp[i] ? dailyExp[i].amount : 0,
      cumulative: d.cumulative,
    }));
    const comboContainer = $('ov-combo-chart');
    if (comboContainer) MozeCharts.comboChart(comboContainer, merged);

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
          const spent = txs.filter(t => t.type === 'expense' && t.categoryId === b.categoryId && t.date >= mStart && t.date <= mEnd)
            .reduce((s, t) => s + t.amount, 0);
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
    const results = $('search-results');
    if (!input || !results) return;
    const q = input.value.trim();
    if (!q) {
      results.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>輸入關鍵字搜尋</p></div>';
      return;
    }
    const txs = MozeData.searchTx(q);
    if (!txs.length) {
      results.innerHTML = '<div class="empty-state"><p>找不到符合的交易</p></div>';
      return;
    }
    results.innerHTML = txs.map(t => txItemHTML(t)).join('');
    bindTxDelete(results);
  }

  function renderFeedback() {
    const statusEl = $('feedback-submit-status');

    if (statusEl && !statusEl.dataset.locked) {
      statusEl.textContent = currentUser
        ? '送出後會連同登入帳號資訊一起附上。'
        : '未登入也可以送出。';
    }
  }

  function resetFeedbackStatus() {
    const statusEl = $('feedback-submit-status');
    if (!statusEl) return;
    delete statusEl.dataset.locked;
    statusEl.style.color = 'var(--text-dim)';
    statusEl.textContent = currentUser
      ? '送出後會連同登入帳號資訊一起附上。'
      : '未登入也可以送出。';
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
              <div class="error-log-time">${esc(formatErrorLogTime(log.createdAt))}</div>
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

      feedbackListEl.innerHTML = items.map(function (item) {
        const meta = [];
        if (item.contact) meta.push(`<span>聯絡：${esc(item.contact)}</span>`);
        if (item.device) meta.push(`<span>裝置：${esc(item.device)}</span>`);
        if (item.authEmail) meta.push(`<span>帳號：${esc(item.authEmail)}</span>`);
        if (item.pageUrl) meta.push(`<span>頁面：${esc(item.pageUrl)}</span>`);
        return `
          <div class="feedback-item">
            <div class="feedback-item-header">
              <div class="feedback-item-title">問題回報</div>
              <div class="feedback-item-time">${esc(formatFeedbackTime(item.createdAt))}</div>
            </div>
            <div class="feedback-item-message">${esc(item.message || '')}</div>
            ${meta.length ? `<div class="feedback-item-meta">${meta.join('')}</div>` : ''}
          </div>
        `;
      }).join('');
    });
  }

  /* ═══════════════════════════════════════ */
  /*             ⑦ 設定頁                    */
  /* ═══════════════════════════════════════ */
  const ADMIN_EMAIL = 'kevin1542638@gmail.com';

  function renderSettings() {
    const s = MozeData.getState();
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
    let icon = esc(MozeData.catIcon(t.categoryId));
    let titleText = esc(t.title || MozeData.catName(t.categoryId));
    let amountClass = t.type;
    let amountPrefix = t.type === 'income' ? '+' : (t.type === 'expense' ? '-' : '');
    let extra = '';

    if (t.type === 'transfer') {
      icon = '🔄';
      titleText = esc(t.title) || `${esc(MozeData.acctName(t.accountId))} → ${esc(MozeData.acctName(t.toAccountId))}`;
      amountPrefix = '';
      if (t.fee > 0) extra = ` <span style="font-size:11px;color:var(--text-muted)">(手續費 ${MozeData.formatMoney(t.fee)})</span>`;
    }

    const tagsHtml = (t.tags || []).map(tag => `<span class="tx-tag">${esc(tag)}</span>`).join('');

    return `<div class="tx-item">
      <div class="tx-icon">${icon}</div>
      <div class="tx-info">
        <div class="tx-title">${titleText}</div>
        <div class="tx-meta">
          <span>${esc(t.date)} ${esc(t.time || '')}</span>
          ${t.note ? `<span>${esc(t.note)}</span>` : ''}
          <span>${esc(MozeData.acctName(t.accountId))}</span>
          ${tagsHtml}
        </div>
      </div>
      <span class="tx-amount ${amountClass}">${amountPrefix}${MozeData.formatMoney(t.amount)}${extra}</span>
      <button class="tx-delete" data-del-tx="${esc(t.id)}" title="刪除">✕</button>
    </div>`;
  }

  function bindTxDelete(container) {
    if (!container) return;
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

  function openModal() {
    const overlay = $('tx-modal-overlay');
    if (overlay) overlay.classList.add('open');
    txType = 'expense';
    updateModalType();
    const s = MozeData.getState();
    populateAccountSelect('tx-account', false);
    populateAccountSelect('tx-from-account', false);
    populateAccountSelect('tx-to-account', false);
    populateCategorySelect('tx-category');
    populateProjectSelect('tx-project');
    const txAcc = $('tx-account');
    if (txAcc) txAcc.value = s.activeAccountId;
    const txFrom = $('tx-from-account');
    if (txFrom) txFrom.value = s.activeAccountId;
    const txDate = $('tx-date');
    if (txDate) txDate.value = MozeData.today();
    const txTime = $('tx-time');
    if (txTime) txTime.value = new Date().toTimeString().slice(0, 5);
    const txAmount = $('tx-amount');
    if (txAmount) txAmount.value = '';
    const txTitle = $('tx-title');
    if (txTitle) txTitle.value = '';
    const txNote = $('tx-note');
    if (txNote) txNote.value = '';
    const txTags = $('tx-tags');
    if (txTags) txTags.value = '';
    const txFee = $('tx-fee');
    if (txFee) txFee.value = '0';
  }

  function closeModal() {
    const overlay = $('tx-modal-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  function updateModalType() {
    $$el('#tx-type-tabs .type-tab').forEach(b => b.classList.toggle('active', b.dataset.type === txType));
    const transfer = $('tx-transfer-fields');
    const normal = $('tx-normal-fields');
    if (transfer) transfer.style.display = txType === 'transfer' ? 'block' : 'none';
    if (normal) normal.style.display = txType === 'transfer' ? 'none' : 'block';
  }

  function saveTransaction() {
    const amount = parseFloat(($('tx-amount') || {}).value);
    if (!amount || amount <= 0) { alert('請輸入有效金額'); return; }

    const tagsRaw = ($('tx-tags') || {}).value || '';
    const tags = tagsRaw.split(/[,，]/).map(s => s.trim()).filter(Boolean);

    const tx = {
      type: txType,
      amount,
      fee: parseFloat(($('tx-fee') || {}).value) || 0,
      accountId: txType === 'transfer' ? (($('tx-from-account') || {}).value || '') : (($('tx-account') || {}).value || ''),
      toAccountId: txType === 'transfer' ? (($('tx-to-account') || {}).value || '') : '',
      categoryId: ($('tx-category') || {}).value || '',
      date: ($('tx-date') || {}).value || MozeData.today(),
      time: ($('tx-time') || {}).value || '00:00',
      title: ($('tx-title') || {}).value || '',
      note: ($('tx-note') || {}).value || '',
      tags,
      projectId: ($('tx-project') || {}).value || '',
    };

    MozeData.addTransaction(tx);
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

    /* 日期區間 */
    const rs = $('range-start');
    const re = $('range-end');
    if (rs) rs.addEventListener('change', () => { rangeStart = rs.value; refreshAll(); });
    if (re) re.addEventListener('change', () => { rangeEnd = re.value; refreshAll(); });

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
    const overlay = $('tx-modal-overlay');
    if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    $$el('#tx-type-tabs .type-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        txType = tab.dataset.type;
        updateModalType();
      });
    });

    const btnSaveTx = $('btn-save-tx');
    if (btnSaveTx) btnSaveTx.addEventListener('click', saveTransaction);

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

  function showLogin() {
    showApp(null);
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
