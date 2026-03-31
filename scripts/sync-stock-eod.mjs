import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const DATABASE_URL = process.env.FIREBASE_DATABASE_URL || 'https://moze-lite-default-rtdb.firebaseio.com';
const SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const TWSE_URL = 'https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=open_data';
const TPEX_URL = 'https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?l=zh-tw&se=EW&o=data';

if (!SERVICE_ACCOUNT_JSON) {
  throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON');
}

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(SERVICE_ACCOUNT_JSON)),
    databaseURL: DATABASE_URL,
  });
}

const db = getDatabase();

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells.map(cell => cell.trim());
}

function parseCsvRows(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(parseCsvLine);
}

function rocDateToIso(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length !== 7) return '';
  const year = Number(digits.slice(0, 3)) + 1911;
  const month = digits.slice(3, 5);
  const day = digits.slice(5, 7);
  return `${year}-${month}-${day}`;
}

function parseMoney(raw) {
  const value = Number(String(raw || '').replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

function textAt(row, headers, key) {
  const index = headers.indexOf(key);
  return index >= 0 ? row[index] : '';
}

async function fetchOfficialQuotes() {
  const [twseText, tpexText] = await Promise.all([
    fetch(TWSE_URL).then(res => res.text()),
    fetch(TPEX_URL).then(res => res.text()),
  ]);

  const twseRows = parseCsvRows(twseText);
  const tpexRows = parseCsvRows(tpexText);

  const twseHeaders = twseRows.shift() || [];
  const tpexHeaders = tpexRows.shift() || [];
  const quotes = {};

  twseRows.forEach(row => {
    const symbol = textAt(row, twseHeaders, '證券代號');
    const close = parseMoney(textAt(row, twseHeaders, '收盤價'));
    const latestDate = rocDateToIso(textAt(row, twseHeaders, '日期'));
    if (!symbol || close === null || !latestDate) return;
    quotes[`TWSE:${symbol}`] = {
      symbol,
      market: 'TWSE',
      name: textAt(row, twseHeaders, '證券名稱') || symbol,
      latestClose: close,
      latestDate,
    };
  });

  tpexRows.forEach(row => {
    const symbol = textAt(row, tpexHeaders, '代號');
    const close = parseMoney(textAt(row, tpexHeaders, '收盤'));
    const latestDate = rocDateToIso(textAt(row, tpexHeaders, '資料日期'));
    if (!symbol || close === null || !latestDate) return;
    quotes[`TPEx:${symbol}`] = {
      symbol,
      market: 'TPEx',
      name: textAt(row, tpexHeaders, '名稱') || symbol,
      latestClose: close,
      latestDate,
    };
  });

  return quotes;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function uniqueTrackedSymbols(stockTrades) {
  const seen = new Set();
  return toArray(stockTrades).reduce((list, trade) => {
    const symbol = String(trade && trade.symbol ? trade.symbol : '').toUpperCase().replace(/\s+/g, '');
    const market = trade && trade.market === 'TPEx' ? 'TPEx' : 'TWSE';
    if (!symbol) return list;
    const key = `${market}:${symbol}`;
    if (seen.has(key)) return list;
    seen.add(key);
    list.push({ symbol, market });
    return list;
  }, []);
}

function pruneHistory(history, latestDate, latestClose, name, market) {
  const next = { ...(history || {}) };
  next[latestDate] = {
    close: latestClose,
    fetchedAt: new Date().toISOString(),
    name,
    market,
  };
  const keepDates = Object.keys(next).sort((a, b) => b.localeCompare(a)).slice(0, 5);
  return keepDates.sort((a, b) => a.localeCompare(b)).reduce((acc, date) => {
    acc[date] = next[date];
    return acc;
  }, {});
}

async function main() {
  const quotes = await fetchOfficialQuotes();
  const usersSnap = await db.ref('users').get();
  const users = usersSnap.val() || {};
  const uidList = Object.keys(users);
  const missing = [];

  for (const uid of uidList) {
    const mozeData = (users[uid] && users[uid]['moze-data']) || {};
    const trackedSymbols = uniqueTrackedSymbols(mozeData.stockTrades);
    if (!trackedSymbols.length) continue;

    trackedSymbols.forEach(item => {
      const key = `${item.market}:${item.symbol}`;
      const quote = quotes[key];
      if (!quote) missing.push(key);
    });
  }

  const trackedSet = new Set(['TWSE:2330', 'TWSE:0050', 'TWSE:0056', 'TWSE:2317', 'TWSE:2412']);
  uidList.forEach(uid => {
    const mozeData = (users[uid] && users[uid]['moze-data']) || {};
    uniqueTrackedSymbols(mozeData.stockTrades).forEach(item => trackedSet.add(`${item.market}:${item.symbol}`));
  });

  const existingPublicSnap = await db.ref('stockQuotesPublic').get();
  const existingPublic = existingPublicSnap.val() || {};
  const nextPublic = {};

  trackedSet.forEach(key => {
    const [market, symbol] = key.split(':');
    const quote = quotes[key];
    if (!quote) {
      missing.push(key);
      if (existingPublic[market] && existingPublic[market][symbol]) {
        if (!nextPublic[market]) nextPublic[market] = {};
        nextPublic[market][symbol] = existingPublic[market][symbol];
      }
      return;
    }
    const existingEntry = existingPublic[market] && existingPublic[market][symbol];
    const history = pruneHistory(existingEntry && existingEntry.history, quote.latestDate, quote.latestClose, quote.name, quote.market);
    if (!nextPublic[market]) nextPublic[market] = {};
    nextPublic[market][symbol] = {
      symbol: quote.symbol,
      market: quote.market,
      name: quote.name,
      latestClose: quote.latestClose,
      latestDate: quote.latestDate,
      updatedAt: new Date().toISOString(),
      history,
    };
  });

  await db.ref('stockQuotesPublic').set(nextPublic);

  console.log(`Updated official EOD quotes for ${uidList.length} user(s).`);
  if (missing.length) {
    console.warn(`Missing quotes for: ${[...new Set(missing)].join(', ')}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
