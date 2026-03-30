/* ===== sync.js — Google Identity Services + Firebase Auth + Realtime DB ===== */
'use strict';

var MozeSync = (function () {

  var FIREBASE_CONFIG = {
    apiKey: 'AIzaSyAEbehc911kz5Uvx7D4DQ6pAcqN7lPQgpg',
    authDomain: 'moze-lite.firebaseapp.com',
    databaseURL: 'https://moze-lite-default-rtdb.firebaseio.com',
    projectId: 'moze-lite',
  };

  var GOOGLE_CLIENT_ID = '721616309882-7o6u74re11djphai6j0dgpq42ki3agtr.apps.googleusercontent.com';
  var ADMIN_EMAIL = 'kevin1542638@gmail.com';
  var ERROR_LOG_BUFFER_KEY = 'moze-lite-error-log-buffer-v1';
  var ERROR_LOG_LIMIT = 50;
  var LAST_SYNCED_UID_KEY = 'moze-lite-last-synced-uid-v1';
  var FEEDBACK_COOLDOWN_KEY = 'moze-lite-feedback-cooldown-v1';
  var FEEDBACK_COOLDOWN_MS = 30000;

  var auth = null;
  var db = null;
  var dataRef = null;
  var userIndexRef = null;
  var syncing = false;
  var pushTimer = null;
  var statusEl = null;
  var initialized = false;
  var saveBound = false;
  var gisInitialized = false;
  var gisButtonRendered = false;

  function setStatus(text, color) {
    if (!statusEl) statusEl = document.getElementById('sync-status');
    if (statusEl) { statusEl.textContent = text; statusEl.style.color = color || '#8e8e96'; }
  }

  function setLoginHint(text) {
    var el = document.getElementById('login-hint');
    if (el) el.textContent = text;
  }

  function truncateText(value, maxLen) {
    if (value === undefined || value === null) return '';
    var text = String(value);
    return text.length > maxLen ? text.slice(0, maxLen) : text;
  }

  function readBufferedErrorLogs() {
    try {
      var raw = localStorage.getItem(ERROR_LOG_BUFFER_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('readBufferedErrorLogs failed', e);
      return [];
    }
  }

  function saveBufferedErrorLogs(entries) {
    try {
      localStorage.setItem(ERROR_LOG_BUFFER_KEY, JSON.stringify(entries.slice(-ERROR_LOG_LIMIT)));
    } catch (e) {
      console.warn('saveBufferedErrorLogs failed', e);
    }
  }

  function removeBufferedErrorLog(id) {
    var entries = readBufferedErrorLogs().filter(function (entry) { return entry.id !== id; });
    saveBufferedErrorLogs(entries);
  }

  function clearBufferedErrorLogs() {
    try {
      localStorage.removeItem(ERROR_LOG_BUFFER_KEY);
    } catch (e) {
      console.warn('clearBufferedErrorLogs failed', e);
    }
  }

  function queueErrorLog(entry) {
    var entries = readBufferedErrorLogs();
    entries.push(entry);
    saveBufferedErrorLogs(entries);
  }

  function getLastSyncedUid() {
    try {
      return localStorage.getItem(LAST_SYNCED_UID_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function setLastSyncedUid(uid) {
    try {
      if (uid) localStorage.setItem(LAST_SYNCED_UID_KEY, uid);
      else localStorage.removeItem(LAST_SYNCED_UID_KEY);
    } catch (e) {
      console.warn('setLastSyncedUid failed', e);
    }
  }

  function sendToTelemetry(entry) {
    if (typeof MozeTelemetry === 'undefined' || typeof MozeTelemetry.captureError !== 'function') return;
    MozeTelemetry.captureError(entry);
  }

  function normalizeErrorLog(input) {
    var now = new Date().toISOString();
    var source = truncateText(input && input.source ? input.source : 'app', 80);
    var message = truncateText(input && input.message ? input.message : 'Unknown error', 500);
    var stack = truncateText(input && input.stack ? input.stack : '', 4000);
    var context = truncateText(input && input.context ? input.context : '', 500);
    var level = truncateText(input && input.level ? input.level : 'error', 20);
    var url = truncateText(input && input.url ? input.url : window.location.href, 300);
    var userAgent = truncateText(window.navigator.userAgent || '', 300);
    return {
      id: (input && input.id) ? input.id : (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
      source: source,
      message: message,
      stack: stack,
      context: context,
      level: level,
      url: url,
      userAgent: userAgent,
      createdAt: (input && input.createdAt) ? input.createdAt : now,
    };
  }

  function detectBrowser(ua) {
    if (/Edg\//.test(ua)) return 'Edge';
    if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
    return 'Unknown';
  }

  function detectOs(ua, platform) {
    if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
    if (/Android/.test(ua)) return 'Android';
    if (/Mac/.test(platform || '')) return 'macOS';
    if (/Win/.test(platform || '')) return 'Windows';
    if (/Linux/.test(platform || '')) return 'Linux';
    return 'Unknown OS';
  }

  function buildDeviceLabel() {
    var ua = window.navigator.userAgent || '';
    var platform = window.navigator.platform || '';
    var deviceType = /iPhone/.test(ua) ? 'iPhone'
      : /iPad/.test(ua) ? 'iPad'
      : /Android/.test(ua) && /Mobile/.test(ua) ? 'Android Phone'
      : /Android/.test(ua) ? 'Android Tablet'
      : /Mac/.test(platform) ? 'Mac'
      : /Win/.test(platform) ? 'Windows PC'
      : /Linux/.test(platform) ? 'Linux Device'
      : 'Unknown Device';
    return [deviceType, detectOs(ua, platform), detectBrowser(ua)].join(' / ');
  }

  function normalizeFeedback(input) {
    var now = new Date().toISOString();
    var user = auth && auth.currentUser ? auth.currentUser : null;
    return {
      message: truncateText(input && input.message ? String(input.message).trim() : '', 1000),
      contact: truncateText(input && input.contact ? String(input.contact).trim() : '', 120),
      createdAt: now,
      pageUrl: truncateText(window.location.href, 300),
      userAgent: truncateText(window.navigator.userAgent || '', 300),
      device: truncateText(buildDeviceLabel(), 120),
      authUid: user && user.uid ? truncateText(user.uid, 128) : '',
      authEmail: user && user.email ? truncateText(String(user.email).toLowerCase(), 160) : '',
    };
  }

  function getLastFeedbackSubmitAt() {
    try {
      return parseInt(localStorage.getItem(FEEDBACK_COOLDOWN_KEY) || '0', 10) || 0;
    } catch (e) {
      return 0;
    }
  }

  function setLastFeedbackSubmitAt(ts) {
    try {
      localStorage.setItem(FEEDBACK_COOLDOWN_KEY, String(ts || 0));
    } catch (e) {
      console.warn('setLastFeedbackSubmitAt failed', e);
    }
  }

  function writeErrorLog(entry) {
    if (!db || !auth || !auth.currentUser || !isAdmin(auth.currentUser)) {
      return Promise.reject(new Error('admin-only'));
    }
    return db.ref('adminLogs/' + auth.currentUser.uid + '/' + entry.id).set(entry);
  }

  function flushBufferedErrorLogs() {
    if (!db || !auth || !auth.currentUser || !isAdmin(auth.currentUser)) {
      return Promise.resolve();
    }
    var entries = readBufferedErrorLogs();
    if (!entries.length) return Promise.resolve();

    return entries.reduce(function (chain, entry) {
      return chain.then(function () {
        return writeErrorLog(entry).then(function () {
          removeBufferedErrorLog(entry.id);
        });
      });
    }, Promise.resolve()).catch(function (err) {
      console.warn('flushBufferedErrorLogs failed', err);
    });
  }

  /* ─── Firebase 初始化 ─── */
  function initFirebase() {
    if (initialized) return;
    if (typeof firebase === 'undefined') { setLoginHint('Firebase SDK 載入失敗'); return; }
    firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.database();
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    initialized = true;
  }

  /* ─── Google Identity Services 登入 ─── */
  function initGoogleSignIn() {
    if (gisInitialized) {
      renderGoogleButton();
      return;
    }
    if (typeof google === 'undefined' || !google.accounts) {
      setTimeout(initGoogleSignIn, 300);
      return;
    }
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: onGoogleCredential,
      auto_select: false,
    });
    gisInitialized = true;
    renderGoogleButton();
  }

  function renderGoogleButton() {
    if (!gisInitialized || gisButtonRendered || typeof google === 'undefined' || !google.accounts) return;
    var btnEl = document.getElementById('google-signin-btn');
    if (!btnEl) return;
    google.accounts.id.renderButton(btnEl, {
      theme: 'outline',
      size: 'large',
      shape: 'rectangular',
      text: 'signin_with',
      locale: 'zh-TW',
      width: 280,
    });
    gisButtonRendered = true;
  }

  function onGoogleCredential(response) {
    initFirebase();
    if (!auth) { setLoginHint('Firebase 初始化失敗'); return; }
    setLoginHint('正在登入…');
    var credential = firebase.auth.GoogleAuthProvider.credential(response.credential);
    auth.signInWithCredential(credential).then(function () {
      setLoginHint('');
    }).catch(function (err) {
      logError({
        source: 'auth',
        message: 'Google sign-in failed',
        stack: err && err.stack ? err.stack : '',
        context: (err && (err.code || err.message)) ? ((err.code || '') + ' ' + (err.message || '')) : '',
      });
      setLoginHint('登入失敗：' + (err.code || '') + ' ' + (err.message || ''));
    });
  }

  /* ─── 登出 ─── */
  function signOut() {
    stopSync();
    setLastSyncedUid('');
    if (typeof google !== 'undefined' && google.accounts) {
      google.accounts.id.disableAutoSelect();
    }
    if (auth) return auth.signOut();
    return Promise.resolve();
  }

  function deleteUserAccount() {
    initFirebase();
    if (!auth || !db || !auth.currentUser) {
      return Promise.reject(new Error('not-signed-in'));
    }

    var user = auth.currentUser;
    var uid = user.uid;

    stopSync();
    setStatus('刪除帳號中…', '#f6c342');

    return Promise.all([
      db.ref('users/' + uid).remove(),
      db.ref('userIndex/' + uid).remove(),
    ]).then(function () {
      return user.delete();
    }).then(function () {
      setLastSyncedUid('');
      if (typeof google !== 'undefined' && google.accounts) {
        google.accounts.id.disableAutoSelect();
      }
      setLoginHint('');
      setStatus('帳號已刪除', '#81c784');
    }).catch(function (err) {
      if (err && err.code === 'auth/requires-recent-login') {
        setStatus('需要重新登入', '#e57373');
      } else {
        setStatus('刪除失敗', '#e57373');
      }
      throw err;
    });
  }

  /* ─── Auth 狀態監聽 ─── */
  function onAuthChanged(callback) {
    initFirebase();
    if (!auth) { setLoginHint('Firebase 初始化失敗'); return; }
    auth.onAuthStateChanged(function (user) {
      if (user) { setLoginHint(''); }
      callback(user);
    });
  }

  /* ─── 即時同步 ─── */
  function startSync(uid) {
    if (dataRef) stopSync();
    dataRef = db.ref('users/' + uid + '/moze-data');
    userIndexRef = db.ref('userIndex/' + uid);
    setStatus('連線中…', '#f6c342');

    // Keep a minimal per-user index so the admin panel can count users
    // without needing read access to every user's private accounting data.
    userIndexRef.set(true).catch(function (err) {
      logError({
        source: 'sync',
        message: 'Failed to write user index',
        stack: err && err.stack ? err.stack : '',
        context: err && err.message ? err.message : '',
      });
      console.warn('user index sync failed', err);
    });

    flushBufferedErrorLogs();

    dataRef.once('value').then(function (snapshot) {
      var remote = snapshot.val();
      var localState = MozeData.getState();
      var hasLocalData = typeof MozeData.hasMeaningfulData === 'function' && MozeData.hasMeaningfulData();
      var stateDiffers = !!remote && JSON.stringify(remote) !== JSON.stringify(localState);
      var isReturningSyncedUser = getLastSyncedUid() === uid;
      if (remote) {
        if (hasLocalData && stateDiffers && !isReturningSyncedUser) {
          var useLocal = window.confirm(
            '這個 Google 帳戶已經有雲端資料。\n\n按「確定」：用目前本機資料覆蓋雲端。\n按「取消」：用雲端資料覆蓋目前本機資料。'
          );
          if (useLocal) {
            pushNow();
          } else {
            syncing = true;
            MozeData.replaceState(remote);
            syncing = false;
            setLastSyncedUid(uid);
            if (typeof window.mozeRefreshAll === 'function') {
              try { window.mozeRefreshAll(); } catch (e) { console.warn(e); }
            }
            setStatus('已同步 ✓', '#81c784');
          }
        } else {
          syncing = true;
          MozeData.replaceState(remote);
          syncing = false;
          setLastSyncedUid(uid);
          if (typeof window.mozeRefreshAll === 'function') {
            try { window.mozeRefreshAll(); } catch (e) { console.warn(e); }
          }
          setStatus('已同步 ✓', '#81c784');
        }
      } else {
        pushNow();
      }
      dataRef.on('value', onRemoteChange);
    }).catch(function () {
      setStatus('連線失敗', '#e57373');
      logError({
        source: 'sync',
        message: 'Initial sync connection failed',
      });
      dataRef.on('value', onRemoteChange);
    });

    if (!saveBound) {
      saveBound = true;
      MozeData.onSave(debouncedPush);
    }
  }

  function stopSync() {
    if (dataRef) { try { dataRef.off(); } catch (e) {} dataRef = null; }
    userIndexRef = null;
  }

  function onRemoteChange(snapshot) {
    if (syncing) return;
    var data = snapshot.val();
    if (!data) return;
    syncing = true;
    try { MozeData.replaceState(data); setStatus('已同步 ✓', '#81c784'); }
    catch (e) { console.warn('sync error', e); }
    setTimeout(function () {
      syncing = false;
      if (typeof window.mozeRefreshAll === 'function') {
        try { window.mozeRefreshAll(); } catch (e) { console.warn(e); }
      }
    }, 60);
  }

  function pushNow() {
    if (!dataRef || syncing) return;
    var state = MozeData.getState();
    if (!state) return;
    syncing = true;
    setStatus('同步中…', '#f6c342');
    dataRef.set(JSON.parse(JSON.stringify(state))).then(function () {
      syncing = false;
      setLastSyncedUid(auth && auth.currentUser ? auth.currentUser.uid : '');
      setStatus('已同步 ✓', '#81c784');
    }).catch(function (err) {
      syncing = false;
      var detail = err && (err.code || err.message) ? (err.code || err.message) : 'unknown error';
      setStatus('同步失敗', '#e57373');
      logError({
        source: 'sync',
        message: 'Push to cloud failed',
        stack: err && err.stack ? err.stack : '',
        context: detail,
      });
      console.warn('pushNow failed', detail, err);
    });
  }

  function debouncedPush() {
    if (!dataRef || syncing) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 800);
  }

  function fetchUserCount(callback) {
    if (!db) { callback(0, []); return; }
    db.ref('userIndex').once('value').then(function (snapshot) {
      var data = snapshot.val();
      if (!data) { callback(0, []); return; }
      var uids = Object.keys(data);
      callback(uids.length, uids);
    }).catch(function (err) {
      logError({
        source: 'admin',
        message: 'Fetch user count failed',
        stack: err && err.stack ? err.stack : '',
        context: err && err.message ? err.message : '',
      });
      console.warn('fetchUserCount failed', err);
      callback(0, []);
    });
  }

  function fetchErrorLogs(callback) {
    if (!db || !auth || !auth.currentUser || !isAdmin(auth.currentUser)) {
      callback(new Error('forbidden'), []);
      return;
    }
    db.ref('adminLogs/' + auth.currentUser.uid).once('value').then(function (snapshot) {
      var data = snapshot.val() || {};
      var logs = Object.keys(data).map(function (id) {
        return normalizeErrorLog(Object.assign({ id: id }, data[id]));
      }).sort(function (a, b) {
        return String(b.createdAt).localeCompare(String(a.createdAt));
      });
      callback(null, logs);
    }).catch(function (err) {
      console.warn('fetchErrorLogs failed', err);
      callback(err, []);
    });
  }

  function submitFeedback(input) {
    initFirebase();
    if (!db) {
      return Promise.reject(new Error('firebase-unavailable'));
    }

    var entry = normalizeFeedback(input || {});
    if (!entry.message || entry.message.length < 3) {
      return Promise.reject(new Error('feedback-too-short'));
    }

    var now = Date.now();
    if (now - getLastFeedbackSubmitAt() < FEEDBACK_COOLDOWN_MS) {
      return Promise.reject(new Error('feedback-cooldown'));
    }

    var ref = db.ref('feedbackInbox').push();
    return ref.set(entry).then(function () {
      setLastFeedbackSubmitAt(now);
      return Object.assign({ id: ref.key }, entry);
    }).catch(function (err) {
      logError({
        source: 'feedback',
        message: 'Submit feedback failed',
        stack: err && err.stack ? err.stack : '',
        context: err && err.message ? err.message : '',
      });
      throw err;
    });
  }

  function fetchFeedback(callback) {
    if (!db || !auth || !auth.currentUser || !isAdmin(auth.currentUser)) {
      callback(new Error('forbidden'), []);
      return;
    }
    db.ref('feedbackInbox').once('value').then(function (snapshot) {
      var data = snapshot.val() || {};
      var items = Object.keys(data).map(function (id) {
        var entry = data[id] || {};
        return {
          id: id,
          message: truncateText(entry.message || '', 1000),
          contact: truncateText(entry.contact || '', 120),
          createdAt: truncateText(entry.createdAt || '', 40),
          pageUrl: truncateText(entry.pageUrl || '', 300),
          userAgent: truncateText(entry.userAgent || '', 300),
          device: truncateText(entry.device || '', 120),
          authUid: truncateText(entry.authUid || '', 128),
          authEmail: truncateText(entry.authEmail || '', 160),
        };
      }).sort(function (a, b) {
        return String(b.createdAt).localeCompare(String(a.createdAt));
      });
      callback(null, items);
    }).catch(function (err) {
      console.warn('fetchFeedback failed', err);
      callback(err, []);
    });
  }

  function clearErrorLogs() {
    if (!db || !auth || !auth.currentUser || !isAdmin(auth.currentUser)) {
      return Promise.reject(new Error('forbidden'));
    }
    var ref = db.ref('adminLogs/' + auth.currentUser.uid);
    return ref.once('value').then(function (snapshot) {
      var data = snapshot.val() || {};
      var ids = Object.keys(data);
      if (!ids.length) {
        clearBufferedErrorLogs();
        return;
      }
      return Promise.all(ids.map(function (id) {
        return ref.child(id).remove();
      })).then(function () {
        clearBufferedErrorLogs();
      });
    });
  }

  function logError(input) {
    var entry = normalizeErrorLog(input || {});
    queueErrorLog(entry);
    sendToTelemetry(entry);
    if (!db || !auth || !auth.currentUser || !isAdmin(auth.currentUser)) {
      return Promise.resolve(entry);
    }
    return writeErrorLog(entry).then(function () {
      removeBufferedErrorLog(entry.id);
      return entry;
    }).catch(function (err) {
      console.warn('writeErrorLog failed', err);
      return entry;
    });
  }

  function isAdmin(user) {
    var email = user && user.email ? String(user.email).toLowerCase() : '';
    return !!email && email === ADMIN_EMAIL;
  }

  function getCurrentUser() {
    return auth ? auth.currentUser : null;
  }

  return {
    initFirebase: initFirebase,
    initGoogleSignIn: initGoogleSignIn,
    signOut: signOut,
    deleteUserAccount: deleteUserAccount,
    onAuthChanged: onAuthChanged,
    startSync: startSync,
    stopSync: stopSync,
    setStatus: setStatus,
    fetchUserCount: fetchUserCount,
    submitFeedback: submitFeedback,
    fetchFeedback: fetchFeedback,
    fetchErrorLogs: fetchErrorLogs,
    clearErrorLogs: clearErrorLogs,
    logError: logError,
    getCurrentUser: getCurrentUser,
    isAdmin: isAdmin,
  };
})();
