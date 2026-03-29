/* ===== sync.js — Firebase Auth + Realtime Database 即時同步 ===== */
'use strict';

var MozeSync = (function () {

  var FIREBASE_CONFIG = {
    apiKey: 'AIzaSyAEbehc911kz5Uvx7D4DQ6pAcqN7lPQgpg',
    authDomain: 'moze-lite.firebaseapp.com',
    databaseURL: 'https://moze-lite-default-rtdb.firebaseio.com',
    projectId: 'moze-lite',
  };

  var app = null;
  var auth = null;
  var db = null;
  var dataRef = null;
  var syncing = false;
  var pushTimer = null;
  var statusEl = null;
  var initialized = false;
  var saveBound = false;

  function setStatus(text, color) {
    if (!statusEl) statusEl = document.getElementById('sync-status');
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.style.color = color || '#8e8e96';
    }
  }

  function setLoginHint(text) {
    var el = document.getElementById('login-hint');
    if (el) el.textContent = text;
  }

  function initFirebase() {
    if (initialized) return;
    if (typeof firebase === 'undefined') {
      setLoginHint('Firebase SDK 載入失敗');
      return;
    }
    app = firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.database();
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    initialized = true;
  }

  function signInWithGoogle() {
    initFirebase();
    var provider = new firebase.auth.GoogleAuthProvider();
    setLoginHint('正在登入…');
    return auth.signInWithPopup(provider).then(function () {
      setLoginHint('登入成功！');
    }).catch(function (err) {
      console.warn('login error:', err.code, err.message);
      setLoginHint('登入失敗：' + (err.code || '') + '\n' + (err.message || ''));
    });
  }

  function signOut() {
    stopSync();
    if (auth) return auth.signOut();
    return Promise.resolve();
  }

  function onAuthChanged(callback) {
    initFirebase();
    if (!auth) { setLoginHint('Firebase 初始化失敗'); return; }

    auth.onAuthStateChanged(function (user) {
      if (user) { setLoginHint(''); }
      callback(user);
    });
  }

  function startSync(uid) {
    if (dataRef) stopSync();
    dataRef = db.ref('users/' + uid + '/moze-data');
    setStatus('連線中…', '#f6c342');

    dataRef.once('value').then(function (snapshot) {
      var remote = snapshot.val();
      if (remote) {
        syncing = true;
        MozeData.replaceState(remote);
        syncing = false;
        if (typeof window.mozeRefreshAll === 'function') {
          try { window.mozeRefreshAll(); } catch (e) { console.warn(e); }
        }
        setStatus('已同步 ✓', '#81c784');
      } else {
        pushNow();
      }
      dataRef.on('value', onRemoteChange);
    }).catch(function () {
      setStatus('連線失敗', '#e57373');
      dataRef.on('value', onRemoteChange);
    });

    if (!saveBound) {
      saveBound = true;
      MozeData.onSave(debouncedPush);
    }
  }

  function stopSync() {
    if (dataRef) {
      try { dataRef.off(); } catch (e) {}
      dataRef = null;
    }
  }

  function onRemoteChange(snapshot) {
    if (syncing) return;
    var data = snapshot.val();
    if (!data) return;
    syncing = true;
    try {
      MozeData.replaceState(data);
      setStatus('已同步 ✓', '#81c784');
    } catch (e) { console.warn('sync apply error', e); }
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
    var payload = JSON.parse(JSON.stringify(state));
    syncing = true;
    setStatus('同步中…', '#f6c342');
    dataRef.set(payload).then(function () {
      syncing = false;
      setStatus('已同步 ✓', '#81c784');
    }).catch(function () {
      syncing = false;
      setStatus('同步失敗', '#e57373');
    });
  }

  function debouncedPush() {
    if (!dataRef || syncing) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 800);
  }

  return {
    initFirebase: initFirebase,
    signInWithGoogle: signInWithGoogle,
    signOut: signOut,
    onAuthChanged: onAuthChanged,
    startSync: startSync,
    stopSync: stopSync,
    setStatus: setStatus,
  };
})();
