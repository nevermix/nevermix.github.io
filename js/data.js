/* ===== data.js — 資料層：狀態管理、遷移、餘額計算、區間彙總 ===== */
'use strict';

const STORAGE_KEY = 'moze-lite-v3';
const OLD_STORAGE_KEY = 'moze-lite-v1';

const DEFAULT_CATEGORIES = [
  { id: 'cat-food',    name: '餐飲', icon: '🍔' },
  { id: 'cat-trans',   name: '交通', icon: '🚌' },
  { id: 'cat-shop',    name: '購物', icon: '🛒' },
  { id: 'cat-bill',    name: '帳單', icon: '📄' },
  { id: 'cat-fun',     name: '娛樂', icon: '🎮' },
  { id: 'cat-med',     name: '醫療', icon: '🏥' },
  { id: 'cat-other',   name: '其他', icon: '📦' },
  { id: 'cat-salary',  name: '薪資', icon: '💰' },
];

const DEFAULT_ACCOUNTS = [
  { id: 'acc-cash',   name: '現金',     group: '現金',   openingBalance: 0, icon: '💵' },
  { id: 'acc-ctbc',   name: '中國信託', group: '銀行',   openingBalance: 0, icon: '🏦' },
  { id: 'acc-cathay', name: '國泰世華', group: '銀行',   openingBalance: 0, icon: '🏦' },
  { id: 'acc-wallet', name: 'Wallet',   group: '電子支付', openingBalance: 0, icon: '📱' },
  { id: 'acc-line',   name: 'Line Pay', group: '電子支付', openingBalance: 0, icon: '💚' },
];

const ACCOUNT_GROUPS = ['現金', '銀行', '電子支付', '證券', '加密', '信用卡', '其他'];

const CHART_COLORS = [
  '#ffd54f', '#29b6f6', '#ff7043', '#66bb6a', '#ab47bc',
  '#ef5350', '#26c6da', '#9ccc65', '#ec407a', '#5c6bc0',
];

/* ───── 工具函式 ───── */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function today() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function nowTime() {
  const d = new Date();
  return d.toTimeString().slice(0, 5);
}

function monthKey(dateStr) {
  return dateStr.slice(0, 7);
}

function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

function parseMonth(mk) {
  const [y, m] = mk.split('-').map(Number);
  return { y, m };
}

function addMonths(mk, n) {
  let { y, m } = parseMonth(mk);
  m += n;
  while (m > 12) { y++; m -= 12; }
  while (m < 1)  { y--; m += 12; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

function monthRange(startMk, endMk) {
  const list = [];
  let cur = startMk;
  while (cur <= endMk) {
    list.push(cur);
    cur = addMonths(cur, 1);
  }
  return list;
}

function formatMoney(n) {
  const abs = Math.abs(n);
  const s = abs % 1 === 0 ? abs.toLocaleString() : abs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return n < 0 ? `-$${s}` : `$${s}`;
}

function dateBetween(d, start, end) {
  return d >= start && d <= end;
}

function clampText(value, fallback, maxLen) {
  const text = value === undefined || value === null ? fallback : String(value);
  return text.slice(0, maxLen);
}

function toNumber(value, fallback) {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
}

/* ───── MozeData 單例 ───── */
const MozeData = (() => {
  let state = null;

  function blank() {
    return {
      accounts: JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS)),
      categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      transactions: [],
      stockTrades: [],
      projects: [],
      budgets: [],
      upcoming: [],
      settings: { liabilities: 0 },
      activeAccountId: 'acc-cash',
      selectedAccountId: 'acc-cash',
    };
  }

  /* ─ 遷移 v1 → v3 ─ */
  function migrateV1() {
    const raw = localStorage.getItem(OLD_STORAGE_KEY);
    if (!raw) return null;
    try {
      const old = JSON.parse(raw);
      const s = blank();
      if (old.accounts && old.accounts.length) {
        s.accounts = old.accounts.map(a => ({
          id: a.id || uid(),
          name: a.name || '帳戶',
          group: a.group || '現金',
          openingBalance: a.openingBalance || 0,
          icon: a.icon || '💵',
        }));
      }
      if (old.categories && old.categories.length) {
        s.categories = old.categories.map(c => ({
          id: c.id || uid(),
          name: c.name,
          icon: c.icon || '📦',
        }));
      }
      if (old.transactions) {
        s.transactions = old.transactions.map(t => ({
          id: t.id || uid(),
          type: t.type || 'expense',
          amount: t.amount || 0,
          fee: t.fee || 0,
          accountId: t.accountId || s.accounts[0].id,
          toAccountId: t.toAccountId || '',
          categoryId: t.categoryId || s.categories[0].id,
          date: t.date || today(),
          time: t.time || '00:00',
          title: t.title || t.note || '',
          note: t.note || '',
          tags: t.tags || [],
          projectId: t.projectId || '',
        }));
      }
      if (old.stockTrades) {
        s.stockTrades = toArr(old.stockTrades).map(st => ({
          id: st.id || uid(),
          symbol: st.symbol || '',
          market: st.market || 'TWSE',
          name: st.name || '',
          side: st.side || 'buy',
          shares: st.shares || 0,
          price: st.price || 0,
          fee: st.fee || 0,
          date: st.date || today(),
          note: st.note || '',
        }));
      }
      s.activeAccountId = old.activeAccountId || s.accounts[0].id;
      s.selectedAccountId = s.activeAccountId;
      if (old.settings) s.settings = { ...s.settings, ...old.settings };
      return s;
    } catch (e) {
      console.error('v1 migration failed', e);
      return null;
    }
  }

  function toArr(v) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') return Object.values(v);
    return [];
  }

  function fixState() {
    if (!state || typeof state !== 'object') { state = blank(); return; }
    state.accounts     = toArr(state.accounts);
    state.categories   = toArr(state.categories);
    state.transactions = toArr(state.transactions);
    state.stockTrades  = toArr(state.stockTrades);
    state.projects     = toArr(state.projects);
    state.budgets      = toArr(state.budgets);
    state.upcoming     = toArr(state.upcoming);
    if (!state.accounts.length)
      state.accounts = JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS));
    if (!state.categories.length)
      state.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    if (!state.settings || typeof state.settings !== 'object') state.settings = { liabilities: 0 };
    state.settings.liabilities = toNumber(state.settings.liabilities, 0);

    state.accounts = state.accounts.map((a, idx) => ({
      id: clampText(a && a.id, `acc-${uid()}-${idx}`, 100),
      name: clampText(a && a.name, '帳戶', 80),
      group: clampText(a && a.group, '其他', 40),
      openingBalance: toNumber(a && a.openingBalance, 0),
      icon: clampText(a && a.icon, '💵', 16),
    }));

    state.categories = state.categories.map((c, idx) => ({
      id: clampText(c && c.id, `cat-${uid()}-${idx}`, 100),
      name: clampText(c && c.name, '未分類', 80),
      icon: clampText(c && c.icon, '📦', 16),
    }));

    state.projects = state.projects.map((p, idx) => ({
      id: clampText(p && p.id, `proj-${uid()}-${idx}`, 100),
      name: clampText(p && p.name, '專案', 80),
      icon: clampText(p && p.icon, '📁', 16),
      start: clampText(p && p.start, today(), 10),
      end: clampText(p && p.end, '', 10),
    }));

    state.budgets = state.budgets.map((b, idx) => ({
      id: clampText(b && b.id, `budget-${uid()}-${idx}`, 100),
      projectId: clampText(b && b.projectId, '', 100),
      categoryId: clampText(b && b.categoryId, '', 100),
      limitMonthly: toNumber(b && b.limitMonthly, 0),
    })).filter(b => b.projectId && b.categoryId);

    state.upcoming = state.upcoming.map((u, idx) => ({
      id: clampText(u && u.id, `up-${uid()}-${idx}`, 100),
      title: clampText(u && u.title, '提醒', 120),
      amount: toNumber(u && u.amount, 0),
      type: (u && (u.type === 'income' || u.type === 'expense')) ? u.type : 'expense',
      accountId: clampText(u && u.accountId, state.activeAccountId || 'acc-cash', 100),
      nextDate: clampText(u && u.nextDate, today(), 10),
    }));

    if (!state.activeAccountId)   state.activeAccountId = state.accounts[0].id;
    if (!state.selectedAccountId) state.selectedAccountId = state.activeAccountId;
    state.activeAccountId = clampText(state.activeAccountId, state.accounts[0].id, 100);
    state.selectedAccountId = clampText(state.selectedAccountId, state.activeAccountId, 100);

    state.transactions = state.transactions.map((t, idx) => {
      const rawTags = Array.isArray(t && t.tags) ? t.tags : (t && t.tags ? toArr(t.tags) : []);
      return {
        id: clampText(t && t.id, `tx-${uid()}-${idx}`, 100),
        type: (t && (t.type === 'expense' || t.type === 'income' || t.type === 'transfer')) ? t.type : 'expense',
        amount: toNumber(t && t.amount, 0),
        fee: toNumber(t && t.fee, 0),
        accountId: clampText(t && t.accountId, state.activeAccountId, 100),
        toAccountId: clampText(t && t.toAccountId, '', 100),
        categoryId: clampText(t && t.categoryId, state.categories[0].id, 100),
        date: clampText(t && t.date, today(), 10),
        time: clampText(t && t.time, '00:00', 5),
        title: clampText(t && t.title, '', 120),
        note: clampText(t && t.note, '', 500),
        tags: rawTags.map(tag => clampText(tag, '', 40)).filter(Boolean),
        projectId: clampText(t && t.projectId, '', 100),
      };
    });

    state.stockTrades = state.stockTrades.map((t, idx) => ({
      id: clampText(t && t.id, `stock-${uid()}-${idx}`, 100),
      symbol: clampText((t && t.symbol ? String(t.symbol).toUpperCase().replace(/\s+/g, '') : ''), '', 20),
      market: (t && (t.market === 'TWSE' || t.market === 'TPEx')) ? t.market : 'TWSE',
      name: clampText(t && t.name, '', 80),
      side: (t && (t.side === 'buy' || t.side === 'sell')) ? t.side : 'buy',
      shares: toNumber(t && t.shares, 0),
      price: toNumber(t && t.price, 0),
      fee: toNumber(t && t.fee, 0),
      date: clampText(t && t.date, today(), 10),
      note: clampText(t && t.note, '', 500),
    })).filter(t => t.symbol && t.shares > 0 && t.price >= 0);

    state = {
      accounts: state.accounts,
      categories: state.categories,
      transactions: state.transactions,
      stockTrades: state.stockTrades,
      projects: state.projects,
      budgets: state.budgets,
      upcoming: state.upcoming,
      settings: { liabilities: toNumber(state.settings && state.settings.liabilities, 0) },
      activeAccountId: state.activeAccountId,
      selectedAccountId: state.selectedAccountId,
    };
  }

  function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        state = JSON.parse(raw);
        fixState();
        return;
      } catch (_) { /* fall through */ }
    }
    const migrated = migrateV1();
    if (migrated) {
      state = migrated;
      fixState();
      save();
      return;
    }
    state = blank();
    save();
  }

  const _saveCallbacks = [];

  function save() {
    fixState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    _saveCallbacks.forEach(cb => { try { cb(); } catch(e) { console.warn('save callback error', e); } });
  }

  function saveQuiet() {
    fixState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function onSave(cb) { _saveCallbacks.push(cb); }

  function replaceState(newState) {
    state = newState || {};
    fixState();
    saveQuiet();
  }

  function getState() { return state; }

  /* ─ 帳戶 CRUD ─ */
  function addAccount(name, group, icon, openingBalance) {
    const a = { id: uid(), name, group: group || '現金', icon: icon || '💵', openingBalance: openingBalance || 0 };
    state.accounts.push(a);
    save();
    return a;
  }

  function renameAccount(id, name) {
    const a = state.accounts.find(x => x.id === id);
    if (a) { a.name = name; save(); }
  }

  function updateAccount(id, fields) {
    const a = state.accounts.find(x => x.id === id);
    if (a) { Object.assign(a, fields); save(); }
  }

  function deleteAccount(id, mergeToId) {
    if (state.accounts.length <= 1) return false;
    if (mergeToId) {
      state.transactions.forEach(t => {
        if (t.accountId === id) t.accountId = mergeToId;
        if (t.toAccountId === id) t.toAccountId = mergeToId;
      });
      state.upcoming.forEach(u => { if (u.accountId === id) u.accountId = mergeToId; });
    }
    state.accounts = state.accounts.filter(x => x.id !== id);
    if (state.activeAccountId === id) state.activeAccountId = state.accounts[0].id;
    if (state.selectedAccountId === id) state.selectedAccountId = state.accounts[0].id;
    save();
    return true;
  }

  function accountTxCount(id) {
    return state.transactions.filter(t => t.accountId === id || t.toAccountId === id).length;
  }

  /* ─ 分類 CRUD ─ */
  function addCategory(name, icon) {
    const c = { id: uid(), name, icon: icon || '📦' };
    state.categories.push(c);
    save();
    return c;
  }

  function updateCategory(id, fields) {
    const c = state.categories.find(x => x.id === id);
    if (c) { Object.assign(c, fields); save(); }
  }

  function deleteCategory(id) {
    const used = state.transactions.some(t => t.categoryId === id);
    if (used) return false;
    state.categories = state.categories.filter(x => x.id !== id);
    save();
    return true;
  }

  function catName(id) {
    const c = state.categories.find(x => x.id === id);
    return c ? c.name : '未知';
  }

  function catIcon(id) {
    const c = state.categories.find(x => x.id === id);
    return c ? c.icon : '📦';
  }

  function acctName(id) {
    const a = state.accounts.find(x => x.id === id);
    return a ? a.name : '未知';
  }

  function acctIcon(id) {
    const a = state.accounts.find(x => x.id === id);
    return a ? a.icon : '💵';
  }

  /* ─ 交易 CRUD ─ */
  function addTransaction(tx) {
    const t = {
      id: uid(),
      type: tx.type || 'expense',
      amount: parseFloat(tx.amount) || 0,
      fee: parseFloat(tx.fee) || 0,
      accountId: tx.accountId || state.activeAccountId,
      toAccountId: tx.toAccountId || '',
      categoryId: tx.categoryId || state.categories[0].id,
      date: tx.date || today(),
      time: tx.time || nowTime(),
      title: tx.title || '',
      note: tx.note || '',
      tags: tx.tags || [],
      projectId: tx.projectId || '',
    };
    state.transactions.push(t);
    save();
    return t;
  }

  function updateTransaction(id, tx) {
    const t = state.transactions.find(x => x.id === id);
    if (!t) return null;
    t.type = tx.type || 'expense';
    t.amount = parseFloat(tx.amount) || 0;
    t.fee = parseFloat(tx.fee) || 0;
    t.accountId = tx.accountId || state.activeAccountId;
    t.toAccountId = tx.toAccountId || '';
    t.categoryId = tx.categoryId || state.categories[0].id;
    t.date = tx.date || today();
    t.time = tx.time || nowTime();
    t.title = tx.title || '';
    t.note = tx.note || '';
    t.tags = Array.isArray(tx.tags) ? tx.tags : [];
    t.projectId = tx.projectId || '';
    save();
    return t;
  }

  /* ─ 股票交易 CRUD ─ */
  function addStockTrade(trade) {
    const t = {
      id: uid(),
      symbol: String(trade.symbol || '').toUpperCase().replace(/\s+/g, ''),
      market: trade.market === 'TPEx' ? 'TPEx' : 'TWSE',
      name: trade.name || '',
      side: trade.side === 'sell' ? 'sell' : 'buy',
      shares: parseFloat(trade.shares) || 0,
      price: parseFloat(trade.price) || 0,
      fee: parseFloat(trade.fee) || 0,
      date: trade.date || today(),
      note: trade.note || '',
    };
    state.stockTrades.push(t);
    save();
    return t;
  }

  function deleteStockTrade(id) {
    state.stockTrades = state.stockTrades.filter(x => x.id !== id);
    save();
  }

  function stockTradesSorted() {
    return [...state.stockTrades].sort((a, b) => {
      const byDate = String(a.date || '').localeCompare(String(b.date || ''));
      if (byDate !== 0) return byDate;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  function stockTradesList() {
    return [...state.stockTrades].sort((a, b) => {
      const byDate = String(b.date || '').localeCompare(String(a.date || ''));
      if (byDate !== 0) return byDate;
      return String(b.id || '').localeCompare(String(a.id || ''));
    });
  }

  function canSellStock(symbol, market, shares) {
    const normalizedSymbol = String(symbol || '').toUpperCase().replace(/\s+/g, '');
    const qty = parseFloat(shares) || 0;
    if (!normalizedSymbol || qty <= 0) return false;
    const holding = stockPortfolio().holdings.find(h => h.symbol === normalizedSymbol && h.market === market);
    return !!holding && holding.shares + 1e-8 >= qty;
  }

  function stockPortfolio(priceMap) {
    const quotes = priceMap || {};
    const positions = {};
    let realizedTotal = 0;

    stockTradesSorted().forEach(trade => {
      const key = `${trade.market}:${trade.symbol}`;
      if (!positions[key]) {
        positions[key] = {
          symbol: trade.symbol,
          market: trade.market,
          name: trade.name || trade.symbol,
          shares: 0,
          costBasis: 0,
          avgCost: 0,
          realizedPnl: 0,
          totalFees: 0,
          tradeCount: 0,
          lastTradeDate: trade.date,
        };
      }
      const pos = positions[key];
      if (trade.name) pos.name = trade.name;
      pos.totalFees += trade.fee;
      pos.tradeCount += 1;
      pos.lastTradeDate = trade.date;

      if (trade.side === 'buy') {
        pos.costBasis += trade.shares * trade.price + trade.fee;
        pos.shares += trade.shares;
        pos.avgCost = pos.shares > 0 ? pos.costBasis / pos.shares : 0;
        return;
      }

      if (trade.shares > pos.shares + 1e-8) {
        pos.invalid = true;
        return;
      }

      const currentAvg = pos.shares > 0 ? pos.costBasis / pos.shares : 0;
      const proceeds = trade.shares * trade.price - trade.fee;
      const costRemoved = currentAvg * trade.shares;
      const realized = proceeds - costRemoved;

      pos.realizedPnl += realized;
      realizedTotal += realized;
      pos.shares -= trade.shares;
      pos.costBasis -= costRemoved;
      if (pos.shares <= 1e-8) {
        pos.shares = 0;
        pos.costBasis = 0;
        pos.avgCost = 0;
      } else {
        pos.avgCost = pos.costBasis / pos.shares;
      }
    });

    const all = Object.values(positions).map(pos => {
      const quote = quotes[`${pos.market}:${pos.symbol}`] || {};
      const latestClose = toNumber(quote.latestClose, NaN);
      const hasQuote = Number.isFinite(latestClose);
      const marketValue = hasQuote ? pos.shares * latestClose : 0;
      const unrealized = hasQuote ? marketValue - pos.costBasis : 0;
      return {
        ...pos,
        latestClose: hasQuote ? latestClose : null,
        latestDate: quote.latestDate || '',
        history: quote.history || [],
        marketValue: hasQuote ? marketValue : null,
        unrealized: hasQuote ? unrealized : null,
        unrealizedPct: hasQuote && pos.costBasis > 0 ? unrealized / pos.costBasis : null,
      };
    });

    const holdings = all
      .filter(pos => pos.shares > 1e-8)
      .sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0) || a.symbol.localeCompare(b.symbol));

    const totals = holdings.reduce((acc, pos) => {
      acc.costBasis += pos.costBasis;
      acc.marketValue += pos.marketValue || 0;
      acc.unrealized += pos.unrealized || 0;
      return acc;
    }, { costBasis: 0, marketValue: 0, unrealized: 0 });

    return {
      holdings,
      all,
      realizedTotal,
      totals,
    };
  }

  function deleteTransaction(id) {
    state.transactions = state.transactions.filter(x => x.id !== id);
    save();
  }

  /* ─ 專案 CRUD ─ */
  function addProject(name, icon, start, end) {
    const p = { id: uid(), name, icon: icon || '📁', start: start || today(), end: end || '' };
    state.projects.push(p);
    save();
    return p;
  }

  function deleteProject(id) {
    state.transactions.forEach(t => { if (t.projectId === id) t.projectId = ''; });
    state.budgets = state.budgets.filter(b => b.projectId !== id);
    state.projects = state.projects.filter(x => x.id !== id);
    save();
  }

  /* ─ 預算 CRUD ─ */
  function setBudget(projectId, categoryId, limitMonthly) {
    let b = state.budgets.find(x => x.projectId === projectId && x.categoryId === categoryId);
    if (b) {
      b.limitMonthly = limitMonthly;
    } else {
      b = { id: uid(), projectId, categoryId, limitMonthly };
      state.budgets.push(b);
    }
    save();
    return b;
  }

  function deleteBudget(id) {
    state.budgets = state.budgets.filter(x => x.id !== id);
    save();
  }

  /* ─ 即將到來 CRUD ─ */
  function addUpcoming(item) {
    const u = {
      id: uid(),
      title: item.title || '',
      amount: parseFloat(item.amount) || 0,
      type: item.type || 'expense',
      accountId: item.accountId || state.activeAccountId,
      nextDate: item.nextDate || today(),
    };
    state.upcoming.push(u);
    save();
    return u;
  }

  function deleteUpcoming(id) {
    state.upcoming = state.upcoming.filter(x => x.id !== id);
    save();
  }

  /* ─ 餘額計算 ─ */
  function accountBalance(accId) {
    const acc = state.accounts.find(a => a.id === accId);
    let bal = acc ? acc.openingBalance : 0;
    state.transactions.forEach(t => {
      if (t.type === 'income' && t.accountId === accId)   bal += t.amount;
      if (t.type === 'expense' && t.accountId === accId)  bal -= t.amount;
      if (t.type === 'transfer') {
        if (t.accountId === accId)   bal -= (t.amount + t.fee);
        if (t.toAccountId === accId) bal += t.amount;
      }
    });
    return bal;
  }

  function totalAssets() {
    return state.accounts.reduce((sum, a) => {
      const b = accountBalance(a.id);
      return sum + (b > 0 ? b : 0);
    }, 0);
  }

  function totalLiabilities() {
    const fromAccounts = state.accounts.reduce((sum, a) => {
      const b = accountBalance(a.id);
      return sum + (b < 0 ? Math.abs(b) : 0);
    }, 0);
    return fromAccounts + (state.settings.liabilities || 0);
  }

  function netWorth() {
    return totalAssets() - totalLiabilities();
  }

  /* ─ 區間彙總 ─ */
  function txInRange(startDate, endDate, accId) {
    return state.transactions.filter(t => {
      if (accId && accId !== 'all' && t.accountId !== accId && t.toAccountId !== accId) return false;
      return dateBetween(t.date, startDate, endDate);
    });
  }

  function summary(startDate, endDate, accId) {
    const txs = txInRange(startDate, endDate, accId);
    let income = 0, expense = 0, fee = 0, count = 0;
    txs.forEach(t => {
      if (t.type === 'income')  income += t.amount;
      if (t.type === 'expense') { expense += t.amount; fee += t.fee; count++; }
      if (t.type === 'transfer') fee += t.fee;
    });
    const days = Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1);
    return { income, expense, fee, balance: income - expense - fee, count, days, daily: expense / days };
  }

  function expenseByCategory(startDate, endDate, accId) {
    const txs = txInRange(startDate, endDate, accId).filter(t => t.type === 'expense');
    const map = {};
    txs.forEach(t => {
      if (!map[t.categoryId]) map[t.categoryId] = 0;
      map[t.categoryId] += t.amount;
    });
    const total = Object.values(map).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(map)
      .map(([catId, amount]) => ({ catId, name: catName(catId), icon: catIcon(catId), amount, pct: amount / total }))
      .sort((a, b) => b.amount - a.amount);
  }

  function expenseByMonth(startMk, endMk, accId) {
    const months = monthRange(startMk, endMk);
    return months.map(mk => {
      const { y, m } = parseMonth(mk);
      const sd = `${mk}-01`;
      const ed = `${mk}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
      const txs = txInRange(sd, ed, accId).filter(t => t.type === 'expense');
      const amount = txs.reduce((s, t) => s + t.amount, 0);
      return { month: mk, amount };
    });
  }

  function expenseByDay(startDate, endDate, accId) {
    const txs = txInRange(startDate, endDate, accId).filter(t => t.type === 'expense');
    const map = {};
    txs.forEach(t => {
      if (!map[t.date]) map[t.date] = 0;
      map[t.date] += t.amount;
    });
    const result = [];
    const cur = new Date(startDate);
    const last = new Date(endDate);
    while (cur <= last) {
      const d = cur.toISOString().slice(0, 10);
      result.push({ date: d, amount: map[d] || 0 });
      cur.setDate(cur.getDate() + 1);
    }
    return result;
  }

  function dailyNetCumulative(startDate, endDate, accId) {
    const txs = txInRange(startDate, endDate, accId);
    const map = {};
    txs.forEach(t => {
      if (!map[t.date]) map[t.date] = 0;
      if (t.type === 'income')  map[t.date] += t.amount;
      if (t.type === 'expense') map[t.date] -= t.amount;
      if (t.type === 'transfer' && t.accountId === accId) map[t.date] -= t.fee;
    });
    const result = [];
    let cum = 0;
    const cur = new Date(startDate);
    const last = new Date(endDate);
    while (cur <= last) {
      const d = cur.toISOString().slice(0, 10);
      cum += (map[d] || 0);
      result.push({ date: d, net: map[d] || 0, cumulative: cum });
      cur.setDate(cur.getDate() + 1);
    }
    return result;
  }

  function accountBalanceOverTime(accId, startDate, endDate) {
    const acc = state.accounts.find(a => a.id === accId);
    let bal = acc ? acc.openingBalance : 0;
    const sorted = state.transactions.filter(t => t.accountId === accId || t.toAccountId === accId)
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    const balBefore = {};
    sorted.forEach(t => {
      if (t.date < startDate) {
        if (t.type === 'income' && t.accountId === accId)  bal += t.amount;
        if (t.type === 'expense' && t.accountId === accId) bal -= t.amount;
        if (t.type === 'transfer') {
          if (t.accountId === accId)   bal -= (t.amount + t.fee);
          if (t.toAccountId === accId) bal += t.amount;
        }
      }
    });
    const dayMap = {};
    sorted.filter(t => dateBetween(t.date, startDate, endDate)).forEach(t => {
      if (!dayMap[t.date]) dayMap[t.date] = 0;
      if (t.type === 'income' && t.accountId === accId)  dayMap[t.date] += t.amount;
      if (t.type === 'expense' && t.accountId === accId) dayMap[t.date] -= t.amount;
      if (t.type === 'transfer') {
        if (t.accountId === accId)   dayMap[t.date] -= (t.amount + t.fee);
        if (t.toAccountId === accId) dayMap[t.date] += t.amount;
      }
    });
    const result = [];
    const cur = new Date(startDate);
    const last = new Date(endDate);
    while (cur <= last) {
      const d = cur.toISOString().slice(0, 10);
      bal += (dayMap[d] || 0);
      result.push({ date: d, balance: bal });
      cur.setDate(cur.getDate() + 1);
    }
    return result;
  }

  function expenseByAccount(startDate, endDate) {
    const map = {};
    state.transactions.filter(t => t.type === 'expense' && dateBetween(t.date, startDate, endDate)).forEach(t => {
      if (!map[t.accountId]) map[t.accountId] = 0;
      map[t.accountId] += t.amount;
    });
    const total = Object.values(map).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(map)
      .map(([accId, amount]) => ({ accId, name: acctName(accId), icon: acctIcon(accId), amount, pct: amount / total }))
      .sort((a, b) => b.amount - a.amount);
  }

  function txByDateGroups(startDate, endDate, accId) {
    const txs = txInRange(startDate, endDate, accId).sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
    const groups = {};
    txs.forEach(t => {
      if (!groups[t.date]) groups[t.date] = [];
      groups[t.date].push(t);
    });
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }

  function searchTx(query) {
    const q = query.toLowerCase();
    return state.transactions.filter(t => {
      if (t.title && t.title.toLowerCase().includes(q)) return true;
      if (t.note && t.note.toLowerCase().includes(q)) return true;
      if (t.tags && t.tags.some(tag => tag.toLowerCase().includes(q))) return true;
      const cn = catName(t.categoryId);
      if (cn.toLowerCase().includes(q)) return true;
      return false;
    }).sort((a, b) => b.date.localeCompare(a.date));
  }

  /* ─ 月曆輔助 ─ */
  function datesWithTx(mk, accId) {
    const { y, m } = parseMonth(mk);
    const sd = `${mk}-01`;
    const ed = `${mk}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
    const txs = txInRange(sd, ed, accId);
    const set = new Set(txs.map(t => t.date));
    return set;
  }

  /* ─ 匯出 / 匯入 ─ */
  function exportJSON() {
    return JSON.stringify(state, null, 2);
  }

  function importJSON(json) {
    try {
      const imported = JSON.parse(json);
      if (!imported.accounts || !imported.transactions) throw new Error('invalid');
      state = imported;
      if (!state.projects) state.projects = [];
      if (!state.budgets) state.budgets = [];
      if (!state.upcoming) state.upcoming = [];
      if (!state.stockTrades) state.stockTrades = [];
      if (!state.settings) state.settings = { liabilities: 0 };
      if (!state.selectedAccountId) state.selectedAccountId = state.activeAccountId;
      fixState();
      save();
      return true;
    } catch (e) {
      console.error('Import failed', e);
      return false;
    }
  }

  function setActiveAccount(id) {
    state.activeAccountId = id;
    save();
  }

  function setSelectedAccount(id) {
    state.selectedAccountId = id;
    save();
  }

  function setLiabilities(val) {
    state.settings.liabilities = parseFloat(val) || 0;
    save();
  }

  function resetLocalData() {
    state = blank();
    save();
  }

  function hasMeaningfulData() {
    if (!state) return false;
    if (state.transactions.length || state.stockTrades.length || state.projects.length || state.budgets.length || state.upcoming.length) return true;
    if ((state.settings && parseFloat(state.settings.liabilities)) || 0) return true;
    if (JSON.stringify(state.accounts) !== JSON.stringify(DEFAULT_ACCOUNTS)) return true;
    if (JSON.stringify(state.categories) !== JSON.stringify(DEFAULT_CATEGORIES)) return true;
    return false;
  }

  load();

  return {
    getState, save, saveQuiet, load, onSave, replaceState,
    addAccount, renameAccount, updateAccount, deleteAccount, accountTxCount,
    addCategory, updateCategory, deleteCategory, catName, catIcon,
    acctName, acctIcon,
    addTransaction, updateTransaction, deleteTransaction,
    addStockTrade, deleteStockTrade, stockTradesList, stockPortfolio, canSellStock,
    addProject, deleteProject,
    setBudget, deleteBudget,
    addUpcoming, deleteUpcoming,
    accountBalance, totalAssets, totalLiabilities, netWorth,
    txInRange, summary, expenseByCategory, expenseByMonth, expenseByDay,
    dailyNetCumulative, accountBalanceOverTime, expenseByAccount,
    txByDateGroups, searchTx, datesWithTx,
    exportJSON, importJSON,
    setActiveAccount, setSelectedAccount, setLiabilities,
    resetLocalData,
    hasMeaningfulData,
    formatMoney, monthKey, addMonths, parseMonth, monthRange, daysInMonth, today, uid,
    CHART_COLORS, ACCOUNT_GROUPS,
  };
})();
