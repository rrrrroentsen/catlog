/* CatLog 猫咪日志 —— 界面。由 src/ 里的 7 段源码拼成（node dev/build.js），不要直接改这个文件。 */
(function () {
'use strict';
var BUILD = '1.1.0';

/* ---------- 00-guard：先对一下几个文件是不是同一版 ---------- */
// 更新的时候，新旧文件有可能混在一起：这个文件已经是新的，core.js 还是手机缓存里的旧文件（或者仓库里只传了一部分）。
// 混着跑会出各种怪错，所以在做任何事之前先对版本：
//   对不上 → 绕过缓存把几个文件重新取一遍，自动重新加载一次；
//   还对不上 → 停在一页说明上，不往下跑。记过的东西都在，不会动。
var MIXED = (function () {
  var core = window.CL && typeof window.CL.VERSION === 'string' ? window.CL.VERSION : '', FLAG = 'catlog:v1:reloaded', mark = BUILD + '/' + core;
  if (core === BUILD) { try { sessionStorage.removeItem(FLAG); } catch (e) { /* 用不了就算了 */ } return false; }
  var tried = true;
  try { tried = sessionStorage.getItem(FLAG) === mark; if (!tried) sessionStorage.setItem(FLAG, mark); } catch (e) { tried = true; }
  function refresh() {
    var done = false, again = function () { if (!done) { done = true; location.reload(); } };
    try {
      Promise.all(['./', 'core.js', 'charts.js', 'app.js', 'styles.css'].map(function (f) {
        return fetch(f, { cache: 'reload' }).then(function (r) { return r.text(); }).catch(function () { return null; });
      })).then(again, again);
    } catch (e) { again(); }
    setTimeout(again, 8000);
  }
  if (!tried) { refresh(); return true; }
  var view = document.getElementById('view');
  if (view) {
    view.innerHTML = '<section class="card notice warn" id="mixed" style="margin:24px 16px"><b>正在更新，还没装完整</b>' +
      '<p>这个页面的几个文件不是同一个版本：界面是 v' + BUILD + '，计算规则是 ' + (core ? 'v' + core.replace(/[^0-9A-Za-z.]/g, '').slice(0, 12) : '没加载到') + '。多半是刚更新，手机上还留着一部分旧文件。</p>' +
      '<p>联网以后点「再试一次」。一直这样的话，看看 GitHub 仓库里是不是把新版本的文件全部传上去了。记过的东西都还在。</p>' +
      '<button type="button" class="btn pri wide" id="mixed-retry">再试一次</button></section>';
    document.getElementById('mixed-retry').addEventListener('click', function () { this.disabled = true; this.textContent = '正在重新加载…'; refresh(); });
  }
  return true;
})();
if (MIXED) return;

/* ---------- 10-base：环境、本机存储、状态、小工具、图标 ---------- */
var ENV = window.CATLOG_ENV || {};            // 预览版里是 { preview: true }
var VERSION = CL.VERSION;

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"'`]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
}
function nowIso() { return new Date().toISOString(); }
function fmtBytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : (n || 0) + ' B'; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* 本机存储。同一个 github.io 域名下还有别的工具，所以键名都带 catlog: 前缀 */
var DEMO = !!ENV.preview || (function () { try { return localStorage.getItem('catlog:v1:demo') === '1'; } catch (e) { return false; } })();
var KEY = DEMO ? 'catlog:v1:demo:' : 'catlog:v1:';
function lsGet(k, dflt) { try { var v = localStorage.getItem(KEY + k); return v == null ? dflt : JSON.parse(v); } catch (e) { return dflt; } }
function lsSet(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
function lsDel(k) { try { localStorage.removeItem(KEY + k); } catch (e) { /* 存不了也能用 */ } }

/* 大块的东西（表格的快照、照片）放 IndexedDB；用不了就只放在内存里 */
var DB = (function () {
  var NAME = DEMO ? 'catlog-demo' : 'catlog', STORES = ['kv', 'thumb', 'full', 'up'];
  var dbp = null, mem = {};
  STORES.forEach(function (s) { mem[s] = new Map(); });
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (res) {
      try {
        var rq = indexedDB.open(NAME, 1);
        rq.onupgradeneeded = function () { STORES.forEach(function (s) { if (!rq.result.objectStoreNames.contains(s)) rq.result.createObjectStore(s); }); };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { res(null); };
        rq.onblocked = function () { res(null); };
      } catch (e) { res(null); }
    });
    return dbp;
  }
  function run(store, mode, fn) {
    return open().then(function (db) {
      if (!db) return fn(null);
      return new Promise(function (res) {
        try {
          var tx = db.transaction(store, mode), rq = fn(tx.objectStore(store)), out;
          if (rq) rq.onsuccess = function () { out = rq.result; };
          tx.oncomplete = function () { res(out); };
          tx.onerror = function () { res(undefined); };
          tx.onabort = function () { res(undefined); };
        } catch (e) { res(undefined); }
      });
    });
  }
  return {
    get: function (store, key) { return run(store, 'readonly', function (s) { return s ? s.get(key) : mem[store].get(key); }); },
    set: function (store, key, val) { return run(store, 'readwrite', function (s) { if (s) return s.put(val, key); mem[store].set(key, val); }); },
    del: function (store, key) { return run(store, 'readwrite', function (s) { if (s) return s.delete(key); mem[store].delete(key); }); },
    keys: function (store) { return run(store, 'readonly', function (s) { return s ? s.getAllKeys() : Array.from(mem[store].keys()); }); },
    clear: function (store) { return run(store, 'readwrite', function (s) { if (s) return s.clear(); mem[store].clear(); }); },
    ok: function () { return open().then(function (db) { return !!db; }); }
  };
})();

/* 状态 */
var S = {
  demo: DEMO,
  auth: null,                 // { u: 接口地址, t: 口令 }
  me: 'a',
  base: CL.emptyTables(),     // 表格那边的内容（上次同步到的）
  T: CL.emptyTables(),        // 界面用的 = base + 还没发出去的操作
  rev: 0,
  backend: '',
  queue: [],                  // 还没被表格确认的操作
  pend: {},                   // 等着上传的照片和文件：id → { row, date }
  sync: { state: 'idle', at: 0, err: '', busy: false, again: false },
  ui: { pet: '', theme: 'auto', filter: 'all', seg: 'vaccine', range: 'all', calYm: '', tlLimit: 40, listW: false },
  tab: 'home',
  today: CL.today(),
  ready: false
};

function unit() { var s = S.T.settings.unit; return s && s.value === 'lb' ? 'lb' : 'kg'; }
function pets() {
  return CL.vals(S.T.pets).sort(function (a, b) { return a.sort - b.sort || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) || (a.id < b.id ? -1 : 1); });
}
function pet() {
  var list = pets();
  if (!list.length) return null;
  return S.T.pets[S.ui.pet] || list[0];
}
function member(id) { return S.T.members[id] || { id: id, name: id === 'a' ? '成员 A' : id === 'b' ? '成员 B' : '', color: CL.MEMBER_COLORS[id] || '#888888' }; }
function whoName(id) { return id ? member(id).name : ''; }
function saveUi() { lsSet('ui', S.ui); }

/* 图标：24×24 的线条画，颜色跟着文字走 */
var ICONS = {
  home: 'M5 10V5.2l4 2.4a8.3 8.3 0 0 1 6 0l4-2.4V10a7.4 7.4 0 0 1-7 9.5A7.4 7.4 0 0 1 5 10zM9.6 12.6v.4M14.4 12.6v.4M11 15.4l1 .8 1-.8',
  timeline: 'M6.5 4.5v15M11 7h8.5M11 12h8.5M11 17h5.5M6.5 7v.01M6.5 12v.01M6.5 17v.01',
  growth: 'M4 19.5h16M5 15.5l4.5-5 3.5 3 6-7.5M15.5 6h3.5v3.5',
  records: 'M9 4.5h6v3H9zM9 6H7A1.5 1.5 0 0 0 5.5 7.5v11A1.5 1.5 0 0 0 7 20h10a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 17 6h-2M12 11v5M9.5 13.5h5',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  chevR: 'M9.5 5.5l6.5 6.5-6.5 6.5',
  chevL: 'M14.5 5.5L8 12l6.5 6.5',
  chevD: 'M5.5 9.5L12 16l6.5-6.5',
  prefs: 'M4 7.5h8M17 7.5h3M4 16.5h3M12 16.5h8M14.5 5.3a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4zM9.5 14.3a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z',
  weight: 'M7.5 4.5h9A2.5 2.5 0 0 1 19 7v10a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 17V7a2.5 2.5 0 0 1 2.5-2.5zM8.3 11a5.2 5.2 0 0 1 7.4 0M12 11.5l1.8-2.6',
  daily: 'M12 3.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4zM8.3 12.3l2.6 2.6 4.8-5.2',
  food: 'M4 11.5h16c0 4.3-3.5 7.5-8 7.5s-8-3.2-8-7.5zM8.5 8v.01M12 6.3v.01M15.5 8v.01',
  activity: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM6.3 8.6c3.3.4 7.2 3 9.2 8.8M4.6 13.4c3-.6 6 .8 8.2 6.2M10 4.4c3.2 1.4 6.8 5 8.6 9.8',
  health: 'M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z',
  moment: 'M5.5 7.5h2.3l1.4-2.2h5.6l1.4 2.2h2.3A1.5 1.5 0 0 1 20 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5V9a1.5 1.5 0 0 1 1.5-1.5zM12 10a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z',
  vaccine: 'M15.5 3.5l5 5M18 6l-2 2M12.5 6.5l5 5M14 8l-8.5 8.5v2h2L16 10M4 20l1.5-1.5M9.5 12.5l1.5 1.5M11.5 10.5L13 12',
  deworm: 'M12 3.5l7 2.6v5.4c0 4.3-2.9 7.5-7 9-4.1-1.5-7-4.7-7-9V6.1zM8.8 12l2.3 2.3 4.1-4.4',
  doc: 'M7.5 3.5h6.5l4.5 4.5v10.5A1.5 1.5 0 0 1 17 20H7.5A1.5 1.5 0 0 1 6 18.5V5a1.5 1.5 0 0 1 1.5-1.5zM14 3.5V8h4.5M9 12.5h6M9 16h4',
  clip: 'M8.5 12.5l5.2-5.2a2.9 2.9 0 0 1 4.1 4.1l-7.2 7.2a4.4 4.4 0 0 1-6.2-6.2l6.6-6.6',
  trash: 'M5 7h14M9.5 7V4.5h5V7M7 7l.8 11.6A1.5 1.5 0 0 0 9.3 20h5.4a1.5 1.5 0 0 0 1.5-1.4L17 7M10.2 10.5v6M13.8 10.5v6',
  edit: 'M5 19l.9-3.9L15.6 5.4a1.9 1.9 0 0 1 2.7 0l.3.3a1.9 1.9 0 0 1 0 2.7L8.9 18.1zM14 7l3 3',
  star: 'M12 4.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8z',
  alert: 'M12 4.5l8.3 14.3H3.7zM12 10.3v4.2M12 17.2v.01',
  sync: 'M19 12a7 7 0 0 1-12.2 4.7M5 12a7 7 0 0 1 12.2-4.7M17.6 3.8v3.7h-3.7M6.4 20.2v-3.7h3.7',
  cloudOff: 'M4 4l16 16M8.2 8.3A4.5 4.5 0 0 0 7 17h9.5M10.7 6.2A5.5 5.5 0 0 1 17 10.5a3.6 3.6 0 0 1 2.3 5.9',
  calendar: 'M5 6.5h14v13H5zM5 10.5h14M8.5 4v4M15.5 4v4',
  cake: 'M5 19.5h14v-6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2zM5 15.5c1.2 1 2.3 1 3.5 0s2.3-1 3.5 0 2.3 1 3.5 0 2.3-1 3.5 0M8.5 11.5V9M12 11.5V9M15.5 11.5V9M8.5 6.3v.01M12 6.3v.01M15.5 6.3v.01',
  house: 'M4 11.2l8-6.7 8 6.7M6 9.6v9.9h12V9.6M10 19.5v-5h4v5',
  image: 'M6 4.5h12A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5zM4.5 15.5l4-4 3.5 3.5 2.5-2.5 5 5M15 8.5v.01',
  open: 'M13.5 5H19v5.5M19 5l-8 8M17 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18V8.5A1.5 1.5 0 0 1 6.5 7H11',
  paw: 'M12 12.6c2.5 0 4.4 1.9 4.4 3.9s-1.6 2.7-4.4 2.7-4.4-.7-4.4-2.7 1.9-3.9 4.4-3.9zM6.8 9.2a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM10 5.6a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM14 5.6a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM17.2 9.2a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
  info: 'M12 3.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4zM12 11v5.2M12 7.9v.01',
  more: 'M6 12v.01M12 12v.01M18 12v.01',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  zoom: 'M10.5 4.5a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM15 15l4.5 4.5M10.5 8v5M8 10.5h5',
  insure: 'M12 3.5V5M4 12.5a8 8 0 0 1 16 0zM12 12.5v5.5a2 2 0 0 1-4 0'
};
function ico(name, cls) {
  return '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + (ICONS[name] || '') + '"/></svg>';
}
// 每种记录用哪个图标、哪个颜色编号（颜色在 styles.css 的 --k1…--k8）
var KIND = {
  weight: { icon: 'weight', c: 1, name: '体重' }, food: { icon: 'food', c: 2, name: '饮食' }, daily: { icon: 'daily', c: 3, name: '日常' },
  activity: { icon: 'activity', c: 4, name: '活动' }, moment: { icon: 'moment', c: 5, name: '瞬间' }, deworm: { icon: 'deworm', c: 6, name: '驱虫' },
  vaccine: { icon: 'vaccine', c: 7, name: '疫苗' }, health: { icon: 'health', c: 8, name: '健康' }, doc: { icon: 'doc', c: 0, name: '文件' }
};
function kico(kind, cls) { var k = KIND[kind] || KIND.doc; return '<span class="kico k' + k.c + (cls ? ' ' + cls : '') + '">' + ico(k.icon) + '</span>'; }

/* 提示条：可以带一个「撤销」 */
var toastTimer = null;
function toast(text, opt) {
  opt = opt || {};
  var root = $('#toast-root');
  if (!root) return;
  clearTimeout(toastTimer);
  root.innerHTML = '<div class="toast' + (opt.bad ? ' bad' : '') + '" role="status">' + (opt.bad ? ico('alert', 'sm') : '') + '<span>' + esc(text) + '</span>' +
    (opt.undo ? '<button type="button" class="toast-btn" data-act="toast-undo">撤销</button>' : '') + '</div>';
  toast.undo = opt.undo || null;
  toastTimer = setTimeout(function () { root.innerHTML = ''; toast.undo = null; }, opt.ms || (opt.undo ? 6000 : 2600));
}

/* 外观：跟随系统、浅色、深色 */
var themeSet = false;
function applyTheme() {
  var t = S.ui.theme, el = document.documentElement;
  if (t === 'light' || t === 'dark') { el.setAttribute('data-theme', t); themeSet = true; }
  else if (themeSet || !ENV.preview) { el.removeAttribute('data-theme'); themeSet = false; }   // 预览版里「跟随系统」时不去动外面页面定的深浅
}

/* ---------- 20-sync：和表格同步、离线队列、照片和文件 ---------- */
var MAX_FILE = 12 * 1024 * 1024;
function ApiError(code, message) { this.code = code; this.message = message || code; }

// 调后端。演示模式下「后端」就在浏览器里（Demo）。
function api(action, payload, timeout) {
  if (S.demo) return Demo.call(action, payload || {});
  if (!S.auth) return Promise.reject(new ApiError('auth', '还没有初始化'));
  var body = JSON.stringify(Object.assign({ v: 1, token: S.auth.t, action: action }, payload || {}));
  var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, timeout || 30000);
  // 用 text/plain 发 POST：这算「简单请求」，浏览器不会先发 OPTIONS 预检（Apps Script 不回应预检）。
  // Apps Script 先回 302，跳到另一个域名再给结果，所以要跟随跳转；不带任何 cookie。
  return fetch(S.auth.u, {
    method: 'POST', body: body, headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    redirect: 'follow', credentials: 'omit', cache: 'no-store', signal: ctl ? ctl.signal : undefined
  }).then(function (r) { return r.text(); }).then(function (text) {
    clearTimeout(timer);
    var j;
    try { j = JSON.parse(text); } catch (e) { throw new ApiError('bad_response', '接口返回的不是数据。常见原因：部署时「谁可以访问」（Who has access）没选「任何人」（Anyone），或者改了后端代码以后没有发新版本。'); }
    if (!j || !j.ok) throw new ApiError(j && j.error || 'server', j && j.message || '后端出错了');
    return j;
  }, function () { clearTimeout(timer); throw new ApiError('network', '连不上网络'); });
}

/* ---- 操作队列：每次改动先记在本机，界面立刻变，再发给表格 ---- */
function saveQueue() { lsSet('queue', S.queue); }
function applyLocal(T, op) {
  var tb = T[op.table];
  if (!tb || !op.row) return;
  if (op.t === 'del') { delete tb[op.row.id]; return; }
  var r = CL.fromWire(op.table, op.t === 'undel' ? op.keep : op.row);
  if (!r) return;
  var old = S.base[op.table][r.id];
  if (old && old.drive_id) r.drive_id = old.drive_id;
  if ('updated_by' in r) { r.updated_by = S.me; r.updated_at = op.at || ''; if (!r.created_by) r.created_by = old ? old.created_by : S.me; if (!r.created_at) r.created_at = old ? old.created_at : (op.at || ''); }
  tb[r.id] = r;
}
function rebuild() {
  var T = CL.emptyTables(), id;
  CL.TABLES.forEach(function (t) { var b = S.base[t]; for (var k in b) T[t][k] = b[k]; });
  for (id in S.pend) if (!T.media[id]) T.media[id] = S.pend[id].row;
  S.queue.forEach(function (op) { applyLocal(T, op); });
  S.T = T;
}
function enqueue(op) {
  op.id = CL.newId() + CL.newId().slice(0, 4);
  op.at = nowIso();
  S.queue.push(op);
  saveQueue();
  applyLocal(S.T, op);
  paintSync();
  syncSoon();
}
// row 是网页里的一行（清洗过的）
function put(table, row) { enqueue({ table: table, t: 'put', row: CL.toWire(table, row, unit()) }); }
function del(table, id) { var old = S.T[table][id]; if (old) enqueue({ table: table, t: 'del', row: { id: id } }); return old; }
function undel(table, row) { enqueue({ table: table, t: 'undel', row: { id: row.id }, keep: row }); }
// 新的一行：补上「谁、什么时候」
function stamp(row) { row.created_by = S.me; row.created_at = nowIso(); return row; }

/* ---- 表格内容的本机快照 ---- */
// 同步到新内容就马上存一份（不攒着：攒着的那一小会儿里关掉页面，下次离线打开就会少东西）
function saveSnapSoon() { saveSnap(); }
function saveSnap() {
  var tables = {};
  CL.TABLES.forEach(function (t) { tables[t] = CL.vals(S.base[t]); });
  return DB.set('kv', 'snap', { v: 1, rev: S.rev, backend: S.backend, me: S.me, tables: tables, at: Date.now() });
}
function loadSnap() {
  return DB.get('kv', 'snap').then(function (s) {
    if (!s || s.v !== 1 || !s.tables) return false;
    var base = CL.emptyTables();
    CL.TABLES.forEach(function (t) { (Array.isArray(s.tables[t]) ? s.tables[t] : []).forEach(function (r) { var c = CL.fromWire(t, r); if (c) base[t][c.id] = c; }); });
    S.base = base; S.rev = Number(s.rev) || 0; S.backend = String(s.backend || '');
    if (s.me === 'a' || s.me === 'b') S.me = s.me;
    return true;
  }, function () { return false; });
}

/* ---- 同步 ---- */
var syncTimer = null, retryN = 0, RETRY = [2000, 5000, 10000, 20000, 45000];
function setSync(state, err) { S.sync.state = state; S.sync.err = err || ''; if (state === 'ok') S.sync.at = Date.now(); paintSync(); }
function syncSoon(ms) { clearTimeout(syncTimer); syncTimer = setTimeout(function () { sync(); }, ms == null ? 250 : ms); }
function waiting() { return S.queue.length + Object.keys(S.pend).length; }
// 这条操作现在能不能发：新版本才有的表（保险），后端还是旧的、或者还不知道后端是哪一版时，先留在手机上。
// （旧后端收到不认识的表会说「收到了」然后什么也不做，发过去就等于丢了。）
function sendable(op) { var need = CL.TABLE_SINCE[op.table]; return !need || S.demo || (!!S.backend && CL.verGte(S.backend, need)); }
function held() { return S.queue.filter(function (o) { return !sendable(o); }).length; }
function sync(full) {
  if (!S.demo && !S.auth) return Promise.resolve(false);
  if (full) S.sync.full = true;
  if (S.sync.busy) { S.sync.again = true; return S.sync.p; }
  S.sync.busy = true;
  clearTimeout(syncTimer);
  paintSync();
  var sent = [], wantFull = !!S.sync.full;
  S.sync.p = flushUploads().then(function () {
    sent = S.queue.filter(sendable).slice(0, 200);
    return api('sync', { since: wantFull ? 0 : S.rev, full: wantFull, ops: sent.map(function (o) { return { id: o.id, table: o.table, t: o.t, row: o.row }; }) }, 90000);
  }).then(function (res) {
    if (wantFull) S.sync.full = false;
    var acked = {};
    (Array.isArray(res.acked) ? res.acked : sent.map(function (o) { return o.id; })).forEach(function (id) { acked[id] = 1; });
    var before = S.queue.length;
    S.queue = S.queue.filter(function (o) { return !acked[o.id]; });
    if (S.queue.length !== before) saveQueue();
    if (!res.unchanged) CL.merge(S.base, res.changes || {}, !!res.reset);
    var moved = !res.unchanged || S.queue.length !== before || res.rev !== S.rev;
    if (typeof res.rev === 'number' && isFinite(res.rev)) S.rev = res.rev;
    if (res.me === 'a' || res.me === 'b') S.me = res.me;
    if (res.v) S.backend = String(res.v).slice(0, 20);
    if (moved) { rebuild(); saveSnapSoon(); }      // 没有变化的例行检查不用重存一遍
    if (upFailed) {
      setSync('err', '有 ' + upFailed + ' 个文件还没传上去，稍后会再试');
      syncTimer = setTimeout(function () { sync(); }, RETRY[Math.min(retryN++, RETRY.length - 1)]);
    } else { retryN = 0; setSync('ok'); }
    if (!res.unchanged || sent.length) render();
    return !upFailed;
  }).catch(function (e) {
    var code = e && e.code || 'network';
    if (code === 'auth') { setSync('auth', e.message); render(); return false; }
    setSync(navigator.onLine === false ? 'offline' : 'err', e && e.message || '');
    syncTimer = setTimeout(function () { sync(); }, RETRY[Math.min(retryN++, RETRY.length - 1)]);
    return false;
  }).then(function (ok) {
    S.sync.busy = false;
    var again = S.sync.again; S.sync.again = false;
    paintSync();
    if (ok && (again || S.queue.some(sendable) || Object.keys(S.pend).length)) syncSoon(S.queue.length ? 60 : 250);
    return ok;
  });
  return S.sync.p;
}

/* ---- 上传：照片和文件先存在本机，排队传给表格那边的 Drive ---- */
function savePend() { lsSet('uploads', Object.keys(S.pend).map(function (id) { return { id: id, row: S.pend[id].row, date: S.pend[id].date }; })); }
function loadPend() {
  (lsGet('uploads', []) || []).forEach(function (x) {
    var r = x && CL.clean.media(x.row || {});
    if (r) S.pend[r.id] = { row: r, date: CL.isYmd(x.date) ? x.date : '' };
  });
}
function dropPend(id) { delete S.pend[id]; savePend(); DB.del('up', id); }
var upFailed = 0;
function flushUploads() {
  var chain = Promise.resolve();
  upFailed = 0;
  Object.keys(S.pend).forEach(function (id) { chain = chain.then(function () { return uploadOne(id); }); });
  return chain;
}
function uploadOne(id) {
  var p = S.pend[id];
  if (!p) return Promise.resolve();
  return DB.get('up', id).then(function (rec) {
    if (!rec || !rec.blob) { dropPend(id); rebuild(); render(); toast('有一个文件在这部手机上找不到了，请重新添加', { bad: true }); return null; }
    return blobToB64(rec.blob).then(function (b64) {
      return api('upload', { id: id, kind: p.row.kind, name: p.row.name, mime: p.row.mime, w: p.row.w, h: p.row.h, thumb: rec.thumb || '', data: b64, date: p.date }, 300000);
    }).then(function (res) {
      var row = CL.fromWire('media', res.row);
      if (row) S.base.media[row.id] = row;
      dropPend(id); rebuild(); saveSnapSoon(); paintSync();
    }, function (e) {
      var code = e && e.code;
      if (code === 'too_large' || code === 'bad_request') { dropPend(id); rebuild(); render(); toast('「' + p.row.name + '」没传上去：' + e.message, { bad: true, ms: 6000 }); return; }
      if (code === 'network' || code === 'auth' || code === 'bad_response') throw e;
      upFailed++;                       // 表格那边临时出错：这个文件先留着，别把记录的同步也堵住
    });
  });
}

/* ---- 照片和文件的本机缓存 ---- */
var MEDIA = { thumb: new Map(), url: new Map(), blob: new Map(), want: new Set(), miss: new Map(), loading: new Map(), timer: null, active: 0, waiters: [] };
var OPENABLE = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'text/plain'];
function safeMime(m) { m = String(m || '').toLowerCase(); return OPENABLE.indexOf(m) >= 0 ? m : 'application/octet-stream'; }   // 别的类型一律当「下载」，不在页面里打开

function needThumb(id) {
  if (MEDIA.thumb.has(id) || MEDIA.want.has(id)) return;
  var m = MEDIA.miss.get(id);
  if (m && Date.now() - m < 30000) return;
  MEDIA.want.add(id);
  clearTimeout(MEDIA.timer);
  MEDIA.timer = setTimeout(pullThumbs, 60);
}
function pullThumbs() {
  var ids = Array.from(MEDIA.want);
  MEDIA.want.clear();
  if (!ids.length) return;
  Promise.all(ids.map(function (id) {
    return DB.get('thumb', id).then(function (v) { if (CL.okThumb(v)) { MEDIA.thumb.set(id, v); return ''; } return id; }, function () { return id; });
  })).then(function (rest) {
    rest = rest.filter(Boolean);
    hydrate();
    var chain = Promise.resolve();
    while (rest.length) (function (batch) {
      chain = chain.then(function () {
        return api('thumbs', { ids: batch }, 60000).then(function (res) {
          var got = res.thumbs || {};
          batch.forEach(function (id) { var v = got[id]; if (CL.okThumb(v)) { MEDIA.thumb.set(id, v); DB.set('thumb', id, v); } else MEDIA.miss.set(id, Date.now()); });
          hydrate();
        }, function () { batch.forEach(function (id) { MEDIA.miss.set(id, Date.now()); }); });
      });
    })(rest.splice(0, 16));
  });
}
function limit(fn) {     // 同时最多取两个文件
  return new Promise(function (res, rej) {
    function go() { MEDIA.active++; fn().then(function (v) { done(); res(v); }, function (e) { done(); rej(e); }); }
    function done() { MEDIA.active--; var n = MEDIA.waiters.shift(); if (n) n(); }
    if (MEDIA.active < 2) go(); else MEDIA.waiters.push(go);
  });
}
// 取原图或文件，返回可以放进 <img> 或链接里的地址
function fullUrl(id) {
  if (MEDIA.url.has(id)) return Promise.resolve(MEDIA.url.get(id));
  if (MEDIA.loading.has(id)) return MEDIA.loading.get(id);
  var p = DB.get('full', id).then(function (rec) {
    if (rec && rec.blob) { touchFull(id, rec.blob.size); return rec.blob; }
    return limit(function () { return api('media', { id: id }, 300000); }).then(function (res) {
      var blob = b64ToBlob(res.data, safeMime(res.mime));
      DB.set('full', id, { blob: blob, t: Date.now() });
      touchFull(id, blob.size);
      return blob;
    });
  }).then(function (blob) {
    var u = URL.createObjectURL(blob);
    MEDIA.url.set(id, u); MEDIA.blob.set(id, blob); MEDIA.loading.delete(id);
    return u;
  }, function (e) { MEDIA.loading.delete(id); throw e; });
  MEDIA.loading.set(id, p);
  return p;
}
// 原图缓存不能无限长大：记下每个的大小和最近用的时间，超过 300 MB 就从最久没用的删起
var fullIdx = null, fullIdxP = null, fullIdxTimer = null;
function touchFull(id, size) {
  fullIdxP = fullIdxP || DB.get('kv', 'fullidx').then(function (v) { fullIdx = v && typeof v === 'object' ? v : {}; }, function () { fullIdx = {}; });
  fullIdxP.then(function () {
    fullIdx[id] = [size || 0, Date.now()];
    clearTimeout(fullIdxTimer);
    fullIdxTimer = setTimeout(function () {
      var ids = Object.keys(fullIdx), total = ids.reduce(function (n, k) { return n + fullIdx[k][0]; }, 0);
      if (total > 300 * 1048576) {
        ids.sort(function (a, b) { return fullIdx[a][1] - fullIdx[b][1]; });
        for (var i = 0; i < ids.length && total > 220 * 1048576; i++) {
          if (S.pend[ids[i]]) continue;
          total -= fullIdx[ids[i]][0]; DB.del('full', ids[i]); delete fullIdx[ids[i]];
        }
      }
      DB.set('kv', 'fullidx', fullIdx);
    }, 1500);
  });
}
// 把页面上的 <img data-mid> 填上图：先缩略图，标了 data-full 的再换成原图
function hydrate(root) {
  $$('img[data-mid]', root).forEach(function (img) {
    var id = img.getAttribute('data-mid'), full = img.hasAttribute('data-full');
    var u = MEDIA.url.get(id), t = MEDIA.thumb.get(id);
    if (full && u) { if (img.getAttribute('src') !== u) img.src = u; img.classList.add('ok', 'hd'); return; }
    if (t) { if (img.getAttribute('src') !== t) img.src = t; img.classList.add('ok'); } else needThumb(id);
    if (full) fullUrl(id).then(function (url) { if (img.isConnected && img.getAttribute('data-mid') === id) { img.src = url; img.classList.add('ok', 'hd'); } }, function () {
      if (!img.isConnected || img.getAttribute('data-mid') !== id || img.classList.contains('fail')) return;
      img.classList.add('fail');
      if (img.id === 'vw-img') toast('原图没取到，先看小图。联网后再点开试试', { bad: true });
    });
  });
}

/* ---- 选了照片或文件以后：压缩 → 存本机 → 排队上传。返回编号数组 ---- */
function addFiles(files, mode, date) {
  var out = [], chain = Promise.resolve(), list = Array.prototype.slice.call(files || [], 0, 12);
  list.forEach(function (file) { chain = chain.then(function () { return addOne(file, mode, date).then(function (id) { if (id) out.push(id); }); }); });
  return chain.then(function () { savePend(); rebuild(); paintSync(); syncSoon(1200); return out; });
}
function addOne(file, mode, date) {
  var isImg = /^image\//.test(file.type || '') || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(file.name || '');
  if (isImg) return prepImage(file, mode).then(function (p) {
    return stash('img', (file.name || 'photo').replace(/\.[^.]*$/, '') + '.jpg', 'image/jpeg', p.blob, p.w, p.h, p.thumb, date);
  }, function () { toast('这张图片读不出来' + (file.name ? '：' + file.name : ''), { bad: true }); return ''; });
  if (mode === 'photo') { toast('这里只能选图片', { bad: true }); return Promise.resolve(''); }
  if (file.size > MAX_FILE) { toast('「' + file.name + '」有 ' + fmtBytes(file.size) + '，上限是 12 MB', { bad: true, ms: 5000 }); return Promise.resolve(''); }
  if (!file.size) { toast('「' + file.name + '」是空的', { bad: true }); return Promise.resolve(''); }
  return stash('file', file.name || '文件', file.type || 'application/octet-stream', file, 0, 0, '', date);
}
function stash(kind, name, mime, blob, w, h, thumb, date) {
  var id = CL.newId();
  var row = CL.clean.media(stamp({ id: id, kind: kind, name: name, mime: mime, size: blob.size, w: w, h: h }));
  S.pend[id] = { row: row, date: CL.isYmd(date) ? date : S.today };
  if (thumb) { MEDIA.thumb.set(id, thumb); DB.set('thumb', id, thumb); }
  MEDIA.url.set(id, URL.createObjectURL(blob)); MEDIA.blob.set(id, blob);
  return Promise.all([DB.set('up', id, { blob: blob, thumb: thumb }), DB.set('full', id, { blob: blob, t: Date.now() })]).then(function () { touchFull(id, blob.size); return id; });
}
// 从一篇记录里拿掉一个文件：还没传上去的直接作废，传过的记一条删除
function removeMedia(id) {
  if (S.pend[id]) { dropPend(id); rebuild(); return; }
  if (S.T.media[id]) del('media', id);
}

function decodeImage(file) {
  function viaImg() {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () { res(im); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); };
      im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('decode')); };
      im.src = u;
    });
  }
  if (typeof createImageBitmap === 'function') {
    try { return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(viaImg); } catch (e) { return viaImg(); }   // 老一点的浏览器不认第二个参数
  }
  return viaImg();
}
// 照片缩到最长边 1600，拍的文件（疫苗本、化验单）缩到 2200，字还能看清
function prepImage(file, mode) {
  var max = mode === 'doc' ? 2200 : 1600, q = mode === 'doc' ? 0.86 : 0.82;
  return decodeImage(file).then(function (src) {
    var sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
    if (!sw || !sh) throw new Error('empty');
    var k = Math.min(1, max / Math.max(sw, sh)), w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.drawImage(src, 0, 0, w, h);
    if (src.close) src.close();
    var thumb = makeThumb(c);
    return canvasBlob(c, q).then(function (blob) { return { blob: blob, w: w, h: h, thumb: thumb }; });
  });
}
// 缩略图：短边 320，太长的一边从中间裁；内容超过 4 万字就降画质、再缩小（表格一个格子最多放 5 万字）
function makeThumb(canvas) {
  var w = canvas.width, h = canvas.height, steps = [[320, 0.6], [280, 0.55], [240, 0.55], [200, 0.5], [160, 0.5], [120, 0.45]], out = '';
  for (var i = 0; i < steps.length; i++) {
    var s = steps[i][0], k = Math.min(1, s / Math.min(w, h));
    var cw = Math.max(1, Math.min(Math.round(w * k), Math.round(s * 1.5))), ch = Math.max(1, Math.min(Math.round(h * k), Math.round(s * 1.5)));
    var c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    c.getContext('2d').drawImage(canvas, (w - cw / k) / 2, (h - ch / k) / 2, cw / k, ch / k, 0, 0, cw, ch);
    out = c.toDataURL('image/jpeg', steps[i][1]);
    if (out.length <= 40000) break;
  }
  return CL.okThumb(out) && out.length <= 44000 ? out : '';
}
function canvasBlob(c, q) {
  return new Promise(function (res, rej) {
    if (c.toBlob) c.toBlob(function (b) { if (b) res(b); else rej(new Error('blob')); }, 'image/jpeg', q);
    else res(b64ToBlob(c.toDataURL('image/jpeg', q).split(',')[1], 'image/jpeg'));
  });
}
function blobToB64(blob) {
  return new Promise(function (res, rej) {
    var fr = new FileReader();
    fr.onload = function () { var s = String(fr.result || ''); res(s.slice(s.indexOf(',') + 1)); };
    fr.onerror = function () { rej(new Error('read')); };
    fr.readAsDataURL(blob);
  });
}
function b64ToBlob(b64, mime) {
  var bin = atob(String(b64 || '')), n = bin.length, arr = new Uint8Array(n);
  for (var i = 0; i < n; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/* ---------- 30-demo：演示模式。「后端」就在浏览器里，数据是编的，照片是画出来的 ---------- */
var Demo = (function () {
  var tables = null, rev = 1, userThumbs = new Map(), userData = new Map();

  function call(action, p) {
    return new Promise(function (res, rej) {
      setTimeout(function () {
        try { res(handle(action, p || {})); }
        catch (e) { rej(e instanceof ApiError ? e : new ApiError('server', String(e && e.message || e))); }
      }, ENV.demoDelay == null ? 90 : ENV.demoDelay);
    });
  }
  function handle(action, p) {
    if (!tables) seed();
    if (action === 'sync') return doSync(p);
    if (action === 'upload') return doUpload(p);
    if (action === 'thumbs') return doThumbs(p);
    if (action === 'media') return doMedia(p);
    throw new ApiError('bad_request', '不认识的操作');
  }
  // 重新打开页面时，用本机的快照把「后端」恢复成上次的样子
  function restore(base, r) {
    tables = {};
    CL.TABLES.forEach(function (t) {
      tables[t] = CL.map();
      CL.vals(base[t]).forEach(function (row) { var w = CL.toWire(t, row, 'kg'); w.rev = row.rev || 1; w.updated_by = row.updated_by || ''; w.updated_at = row.updated_at || ''; tables[t][row.id] = w; });
    });
    rev = r || 1;
  }

  function doSync(p) {
    var ops = Array.isArray(p.ops) ? p.ops : [], acked = [], next = rev + 1, touched = false, now = nowIso();
    ops.forEach(function (o) {
      acked.push(o.id);
      var tb = tables[o.table];
      if (!tb || !o.row || !o.row.id) return;
      var id = o.row.id, cur = tb[id];
      if (o.table === 'members' && id !== 'a') return;
      if (o.t === 'put') {
        if (o.table === 'media') return;
        var row = Object.assign({}, cur || { created_by: 'a', created_at: o.row.created_at || now }, o.row);
        if (cur) { row.created_by = cur.created_by; row.created_at = cur.created_at; }
        row.deleted = false; row.rev = next; row.updated_by = 'a'; row.updated_at = now;
        tb[id] = row; touched = true;
      } else if (cur) { cur.deleted = o.t === 'del'; cur.rev = next; cur.updated_by = 'a'; cur.updated_at = now; touched = true; }
    });
    if (touched) rev = next;
    var since = Number(p.since) || 0, full = !!p.full || since === 0 || since > rev;
    if (!full && !ops.length && since === rev) return { ok: true, v: VERSION, me: 'a', rev: rev, unchanged: true };
    var changes = {};
    CL.TABLES.forEach(function (t) {
      var rows = CL.vals(tables[t]).filter(function (r) { return full ? !r.deleted : r.rev > since; });
      if (rows.length) changes[t] = rows.map(function (r) { return Object.assign({}, r); });
    });
    return { ok: true, v: VERSION, me: 'a', rev: rev, reset: full, changes: changes, acked: acked };
  }
  function doUpload(p) {
    var old = tables.media[p.id];
    if (old) return { ok: true, row: Object.assign({}, old), dup: true };
    var data = String(p.data || '');
    if (data.length > MAX_FILE * 1.4) throw new ApiError('too_large', '文件太大，上限 12 MB');
    var now = nowIso();
    rev++;
    var row = { id: p.id, kind: p.kind === 'img' ? 'img' : 'file', name: p.name, mime: p.mime, size: Math.floor(data.length * 3 / 4), w: p.w, h: p.h,
      created_by: 'a', created_at: now, updated_by: 'a', updated_at: now, rev: rev, deleted: false };
    tables.media[p.id] = row;
    if (CL.okThumb(p.thumb)) userThumbs.set(p.id, p.thumb);
    userData.set(p.id, data);
    return { ok: true, row: Object.assign({}, row) };
  }
  function doThumbs(p) {
    var out = {};
    (p.ids || []).forEach(function (id) {
      if (/^dm_/.test(id) || /^dd_/.test(id)) out[id] = paint(id, 240).toDataURL('image/jpeg', 0.7);
      else if (userThumbs.has(id)) out[id] = userThumbs.get(id);
    });
    return { ok: true, thumbs: out };
  }
  function doMedia(p) {
    var id = p.id, row = tables.media[id];
    if (!row || row.deleted) throw new ApiError('not_found', '找不到这个文件');
    if (/^dm_/.test(id) || /^dd_/.test(id)) return { ok: true, id: id, mime: 'image/jpeg', name: row.name, data: paint(id, 900).toDataURL('image/jpeg', 0.85).split(',')[1] };
    if (/^dp_/.test(id)) return { ok: true, id: id, mime: 'application/pdf', name: row.name, data: btoa(pdf(['CatLog demo', 'Annual checkup report (sample file)', 'Weight 4.52 kg   Temp 38.6 C   Heart 168 bpm', 'This PDF is generated in the browser.'])) };
    if (userData.has(id)) return { ok: true, id: id, mime: row.mime, name: row.name, data: userData.get(id) };
    throw new ApiError('not_found', '演示模式里，重新打开页面以后自己加的文件就不在了');
  }

  /* ---- 画出来的示例照片。编号里带着画法：dm_姿势_色相_年龄百分比_序号 ---- */
  function paint(id, short) {
    var parts = id.split('_'), c = document.createElement('canvas');
    if (parts[0] === 'dd') { c.width = Math.round(short * 0.75); c.height = short; paper(c.getContext('2d'), c.width, c.height, parts[1]); return c; }
    c.width = Math.round(short * 4 / 3); c.height = short;
    cat(c.getContext('2d'), c.width, c.height, { pose: parts[1], hue: +parts[2] || 210, age: clamp((+parts[3] || 100) / 100, 0, 1), n: +parts[4] || 0 });
    return c;
  }
  function cat(g, W, H, o) {
    var s = W / 400, k = 0.6 + 0.4 * o.age, fur = '#8d98aa', dark = '#75819a', light = '#d9dee6', pink = '#eaa0b0', amber = '#e3a23a';
    var cx = W * 0.5, base = H * 0.8;
    function ell(x, y, rx, ry, c, rot) { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot || 0, 0, 6.2832); g.fill(); }
    function tri(a, b, c2, d, e, f, c) { g.fillStyle = c; g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.lineTo(e, f); g.closePath(); g.fill(); }
    function curve(pts, w, c) { g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(pts[0], pts[1]); g.bezierCurveTo(pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]); g.stroke(); }
    // 背景：墙、地面、一件小东西
    g.fillStyle = 'hsl(' + o.hue + ',42%,87%)'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'hsl(' + o.hue + ',30%,76%)'; g.fillRect(0, H * 0.7, W, H * 0.3);
    var prop = o.n % 4;
    if (prop === 0) { g.fillStyle = 'hsl(' + o.hue + ',55%,94%)'; g.fillRect(W * 0.08, H * 0.1, W * 0.26, H * 0.38); g.fillStyle = 'hsl(' + o.hue + ',42%,87%)'; g.fillRect(W * 0.205, H * 0.1, W * 0.01, H * 0.38); g.fillRect(W * 0.08, H * 0.285, W * 0.26, H * 0.012); }
    if (prop === 1) { ell(W * 0.85, H * 0.82, 20 * s, 20 * s, 'hsl(' + ((o.hue + 150) % 360) + ',55%,62%)'); curve([W * 0.83, H * 0.79, W * 0.85, H * 0.8, W * 0.87, H * 0.83, W * 0.86, H * 0.86], 2 * s, 'rgba(255,255,255,.7)'); }
    if (prop === 2) { g.fillStyle = 'hsl(' + ((o.hue + 180) % 360) + ',30%,58%)'; g.fillRect(W * 0.8, H * 0.6, W * 0.1, H * 0.12); ell(W * 0.85, H * 0.5, 26 * s, 34 * s, 'hsl(140,32%,52%)'); ell(W * 0.81, H * 0.56, 16 * s, 22 * s, 'hsl(140,32%,46%)', -0.5); }
    if (prop === 3) ell(cx, base + 6 * s, 150 * s * k, 26 * s * k, 'hsl(' + ((o.hue + 40) % 360) + ',40%,66%)');
    ell(cx, base + 6 * s * k, 96 * s * k, 11 * s * k, 'rgba(30,40,60,.16)');
    var hr = (40 + 12 * (1 - o.age)) * s * k;            // 小猫的头相对大一些
    function head(x, y, asleep) {
      tri(x - hr * 0.95, y - hr * 0.35, x - hr * 0.72, y - hr * 1.28, x - hr * 0.12, y - hr * 0.8, fur);
      tri(x + hr * 0.95, y - hr * 0.35, x + hr * 0.72, y - hr * 1.28, x + hr * 0.12, y - hr * 0.8, fur);
      tri(x - hr * 0.78, y - hr * 0.55, x - hr * 0.68, y - hr * 1.05, x - hr * 0.34, y - hr * 0.78, pink);
      tri(x + hr * 0.78, y - hr * 0.55, x + hr * 0.68, y - hr * 1.05, x + hr * 0.34, y - hr * 0.78, pink);
      ell(x, y, hr * 1.1, hr * 0.96, fur);
      ell(x, y + hr * 0.36, hr * 0.56, hr * 0.38, light);
      if (asleep) { curve([x - hr * 0.6, y - hr * 0.02, x - hr * 0.5, y + hr * 0.12, x - hr * 0.3, y + hr * 0.12, x - hr * 0.2, y - hr * 0.02], 2.4 * s * k, '#3a4254'); curve([x + hr * 0.2, y - hr * 0.02, x + hr * 0.3, y + hr * 0.12, x + hr * 0.5, y + hr * 0.12, x + hr * 0.6, y - hr * 0.02], 2.4 * s * k, '#3a4254'); }
      else { [-1, 1].forEach(function (d) { ell(x + d * hr * 0.42, y - hr * 0.05, hr * 0.2, hr * 0.22, amber); ell(x + d * hr * 0.42, y - hr * 0.05, hr * (0.07 + 0.07 * (1 - o.age)), hr * 0.19, '#232836'); ell(x + d * hr * 0.42 - hr * 0.06, y - hr * 0.12, hr * 0.05, hr * 0.05, '#fff'); }); }
      tri(x - hr * 0.09, y + hr * 0.2, x + hr * 0.09, y + hr * 0.2, x, y + hr * 0.31, pink);
      curve([x, y + hr * 0.31, x - hr * 0.02, y + hr * 0.44, x - hr * 0.16, y + hr * 0.46, x - hr * 0.2, y + hr * 0.38], 1.6 * s * k, '#59627a');
      curve([x, y + hr * 0.31, x + hr * 0.02, y + hr * 0.44, x + hr * 0.16, y + hr * 0.46, x + hr * 0.2, y + hr * 0.38], 1.6 * s * k, '#59627a');
      [-1, 1].forEach(function (d) { [0.24, 0.36].forEach(function (yy, i) { curve([x + d * hr * 0.5, y + hr * yy, x + d * hr * 0.8, y + hr * (yy - 0.04 + i * 0.06), x + d * hr * 1.1, y + hr * (yy - 0.06 + i * 0.1), x + d * hr * 1.35, y + hr * (yy - 0.04 + i * 0.16)], 1.1 * s * k, 'rgba(255,255,255,.85)'); }); });
    }
    var u = s * k;
    if (o.pose === 'loaf') {
      curve([cx + 78 * u, base - 22 * u, cx + 120 * u, base - 16 * u, cx + 128 * u, base - 50 * u, cx + 104 * u, base - 58 * u], 15 * u, dark);
      ell(cx + 8 * u, base - 44 * u, 92 * u, 48 * u, fur); ell(cx - 30 * u, base - 14 * u, 26 * u, 11 * u, light); ell(cx + 16 * u, base - 14 * u, 26 * u, 11 * u, light);
      head(cx - 52 * u, base - 88 * u, o.n % 3 === 0);
    } else if (o.pose === 'sleep') {
      ell(cx, base - 40 * u, 100 * u, 46 * u, fur);
      curve([cx + 84 * u, base - 30 * u, cx + 60 * u, base + 6 * u, cx - 20 * u, base + 4 * u, cx - 50 * u, base - 12 * u], 16 * u, dark);
      head(cx - 58 * u, base - 46 * u, true);
    } else if (o.pose === 'stand') {
      curve([cx + 80 * u, base - 80 * u, cx + 120 * u, base - 110 * u, cx + 112 * u, base - 150 * u, cx + 128 * u, base - 168 * u], 13 * u, dark);
      [-58, -30, 40, 68].forEach(function (dx) { g.fillStyle = dx % 4 ? dark : fur; g.beginPath(); g.roundRect ? g.roundRect(cx + dx * u - 9 * u, base - 52 * u, 18 * u, 54 * u, 8 * u) : g.rect(cx + dx * u - 9 * u, base - 52 * u, 18 * u, 54 * u); g.fill(); });
      ell(cx + 6 * u, base - 74 * u, 88 * u, 40 * u, fur); ell(cx - 6 * u, base - 58 * u, 54 * u, 20 * u, light);
      head(cx - 78 * u, base - 112 * u, false);
    } else if (o.pose === 'box') {
      g.fillStyle = '#c69a6a'; g.fillRect(cx - 100 * u, base - 78 * u, 200 * u, 82 * u); g.fillStyle = '#b38655'; g.fillRect(cx - 108 * u, base - 90 * u, 216 * u, 16 * u);
      head(cx, base - 118 * u, false);
      ell(cx - 34 * u, base - 82 * u, 15 * u, 10 * u, light); ell(cx + 34 * u, base - 82 * u, 15 * u, 10 * u, light);
    } else {   // sit
      curve([cx + 48 * u, base - 14 * u, cx + 112 * u, base - 4 * u, cx + 118 * u, base - 60 * u, cx + 92 * u, base - 78 * u], 14 * u, dark);
      ell(cx, base - 62 * u, 60 * u, 66 * u, fur); ell(cx, base - 50 * u, 32 * u, 44 * u, light);
      ell(cx - 22 * u, base - 4 * u, 17 * u, 10 * u, light); ell(cx + 22 * u, base - 4 * u, 17 * u, 10 * u, light);
      head(cx, base - 142 * u, false);
    }
  }
  // 一张示例「纸」：疫苗本、手术记录
  function paper(g, W, H, kind) {
    var s = W / 300;
    g.fillStyle = '#c9ced8'; g.fillRect(0, 0, W, H);
    g.save(); g.translate(W / 2, H / 2); g.rotate(-0.03);
    g.fillStyle = '#fdfdfb'; g.fillRect(-W * 0.42, -H * 0.44, W * 0.84, H * 0.88);
    g.fillStyle = '#2a3140'; g.font = '600 ' + Math.round(17 * s) + 'px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText(kind === 'vax' ? '疫苗接种记录' : '手术记录', 0, -H * 0.36);
    g.font = Math.round(9 * s) + 'px system-ui, sans-serif'; g.fillStyle = '#7b8494'; g.fillText('示例文件 · 不是真实的记录', 0, -H * 0.32);
    g.strokeStyle = '#d5d9e0'; g.lineWidth = 1 * s;
    for (var i = 0; i < 8; i++) { var y = -H * 0.26 + i * H * 0.075; g.beginPath(); g.moveTo(-W * 0.36, y); g.lineTo(W * 0.36, y); g.stroke(); if (kind === 'vax' && i < 5) { g.fillStyle = ['#cfe0f7', '#f9d9cb', '#cdeedd'][i % 3]; g.fillRect(-W * 0.34, y - H * 0.058, W * 0.3, H * 0.046); g.fillStyle = '#9aa3b2'; g.fillRect(-W * 0.0, y - H * 0.04, W * 0.2, H * 0.012); } else { g.fillStyle = '#c4cad4'; g.fillRect(-W * 0.34, y - H * 0.04, W * (0.3 + (i * 37 % 30) / 100), H * 0.012); } }
    g.strokeStyle = 'rgba(196,50,60,.75)'; g.lineWidth = 2.2 * s; g.beginPath(); g.arc(W * 0.22, H * 0.3, 26 * s, 0, 6.2832); g.stroke();
    g.fillStyle = 'rgba(196,50,60,.8)'; g.font = '600 ' + Math.round(10 * s) + 'px system-ui, sans-serif'; g.fillText('示例', W * 0.22, H * 0.3 + 4 * s);
    g.restore();
  }
  // 一个最小的 PDF（只有几行英文），演示「文件」用
  function pdf(lines) {
    var text = 'BT /F1 16 Tf 48 540 Td 22 TL ' + lines.map(function (l) { return '(' + l.replace(/[()\\]/g, '') + ') Tj T*'; }).join(' ') + ' ET';
    var objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>',
      '<</Type/Page/Parent 2 0 R/MediaBox[0 0 420 595]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
      '<</Length ' + text.length + '>>\nstream\n' + text + '\nendstream', '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
    var out = '%PDF-1.4\n', offs = [];
    objs.forEach(function (o, i) { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    var x = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(function (n) { return ('0000000000' + n).slice(-10) + ' 00000 n \n'; }).join('') +
      'trailer\n<</Size ' + (objs.length + 1) + '/Root 1 0 R>>\nstartxref\n' + x + '\n%%EOF\n';
    return out;
  }

  /* ---- 示例数据：一只叫年糕的猫，日期都相对今天算，所以什么时候打开都像刚记过 ---- */
  // 1.1.0 加的示例：一份保单、两笔理赔，剪指甲定的是每月一次。
  // seed() 里用；旧版本留下来的演示数据也用它补一遍（见 topUp）
  function extras(add, today) {
    var day = function (k) { return CL.addDays(today, -k); }, polStart = CL.addMonths(today.slice(0, 8) + '01', -8);
    add('policies', { id: 'pol1', pet_id: 'demo1', company: '示例宠物保险', plan: '意外和疾病', policy_no: 'DEMO-0001', payer: 'a', premium: 38.5, currency: '$', limit_amt: 10000, deductible: 250, rate: 80,
      start: polStart, renew: CL.addMonths(polStart, 12), note: '在保险公司的 App 里拍账单提交，一般两周内到账' }, 'a', polStart);
    add('claims', { id: 'clm1', pet_id: 'demo1', policy_id: 'pol1', date: day(40), title: '拉稀就诊', bill: 286, paid: 28.8, ded: 250, status: 'paid', note: '扣掉自付额以后按 80% 赔' }, 'a', day(38));
    add('claims', { id: 'clm2', pet_id: 'demo1', policy_id: 'pol1', date: day(9), title: '牙龈检查', bill: 120, status: 'sent' }, 'b', day(8));
    add('settings', { id: CL.careKey('demo1', 'nail'), value: '30' });
  }
  // 旧版本留下的演示数据：示例猫还在、还没有保险的话，把上面这些补进去。已经有的行（比如自己定过的间隔）不覆盖
  function topUp() {
    if (!tables || !tables.pets.demo1 || tables.pets.demo1.deleted || CL.vals(tables.policies).length) return false;
    rev++;
    extras(function (t, row, by, date) {
      if (tables[t][row.id]) return;
      row.created_by = by || 'a'; row.created_at = (date || CL.today()) + 'T09:00:00.000Z'; row.updated_by = row.created_by; row.updated_at = row.created_at;
      var c = CL.fromWire(t, row);
      if (!c) return;
      var w = CL.toWire(t, c, 'kg'); w.rev = rev; w.updated_by = row.updated_by; w.updated_at = row.updated_at; w.deleted = false;
      tables[t][c.id] = w;
    }, CL.today());
    return true;
  }
  function seed() {
    var today = CL.today(), seedN = 20261113, n = 0;
    function rnd() { seedN |= 0; seedN = seedN + 0x6D2B79F5 | 0; var t = Math.imul(seedN ^ seedN >>> 15, 1 | seedN); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
    var day = function (k) { return CL.addDays(today, -k); };
    var birth = CL.addDays(CL.addMonths(today, -17), -3), home = CL.addDays(birth, 72), ageNow = CL.diffDays(birth, today);
    var T = CL.emptyTables();
    function add(t, row, by, date) {
      row.created_by = by || (n % 3 ? 'a' : 'b'); row.created_at = (date || row.date || today) + 'T' + ('0' + (8 + n % 12)).slice(-2) + ':' + ('0' + (n * 7 % 60)).slice(-2) + ':00.000Z';
      row.updated_by = row.created_by; row.updated_at = row.created_at; row.rev = 1; n++;
      var c = CL.fromWire(t, row);
      if (c) T[t][c.id] = c;
      return c;
    }
    function media(id, kind, name, mime, date) { add('media', { id: id, kind: kind, name: name, mime: mime, size: kind === 'img' ? 180000 + n * 913 : 2412, w: kind === 'img' ? 1200 : 0, h: kind === 'img' ? 900 : 0 }, 'a', date); return id; }
    function photo(pose, hue, date) { var pct = Math.round(100 * clamp(CL.diffDays(birth, date) / 330, 0.05, 1)); return media('dm_' + pose + '_' + hue + '_' + pct + '_' + n, 'img', 'IMG_' + (2000 + n) + '.jpg', 'image/jpeg', date); }
    function E(kind, date, data, extra) { return add('entries', Object.assign({ id: 'x' + n + kind, pet_id: 'demo1', kind: kind, date: date, time: ('0' + (7 + n % 14)).slice(-2) + ':' + ('0' + (n * 13 % 60)).slice(-2), data: data }, extra || {})); }

    add('members', { id: 'a', name: '阿树', color: '#2a78d6' }); add('members', { id: 'b', name: '小满', color: '#eb6834' });
    add('settings', { id: 'unit', value: 'kg' });

    // 照片和瞬间
    var shots = [
      [home, 'box', 28, '到家第一天，躲在纸箱里不肯出来', '到家第一天', true], [CL.addDays(home, 6), 'sit', 205, '敢出来巡视客厅了'], [CL.addDays(home, 20), 'sleep', 330, '在沙发缝里睡着'],
      [CL.addMonths(birth, 4), 'stand', 150, '自己爬上了猫爬架最高一层', '第一次上猫爬架', true], [CL.addMonths(birth, 5), 'loaf', 45, '揣手手'], [CL.addMonths(birth, 6), 'sit', 265, '半岁，脸开始圆了'],
      [CL.addMonths(birth, 7), 'sleep', 190, '绝育后恢复得不错，睡得很香'], [CL.addMonths(birth, 8), 'box', 12, '快递箱比快递重要'], [CL.addMonths(birth, 9), 'stand', 95, '学会了开抽屉'],
      [CL.addMonths(birth, 10), 'sit', 300, '窗边看鸟'], [CL.addMonths(birth, 11), 'loaf', 170, ''], [CL.addMonths(birth, 12), 'sit', 40, '一岁啦，加了一个罐头', '1 岁生日', true],
      [CL.addMonths(today, -12), 'sleep', 220, '第一次敢在人腿上睡'], [CL.addMonths(birth, 13), 'stand', 20, '巡逻'], [CL.addMonths(birth, 14), 'loaf', 285, '占了我的椅子'],
      [CL.addMonths(birth, 15), 'box', 135, ''], [CL.addMonths(birth, 16), 'sit', 60, '等开饭'], [day(24), 'sleep', 250, '晒太阳'], [day(11), 'stand', 180, '逗猫棒追了十分钟'], [day(2), 'loaf', 345, '今天特别粘人']
    ];
    var firstPhoto = '';
    shots.forEach(function (x) {
      if (x[0] > today || x[0] < home) return;
      var ids = [photo(x[1], x[2], x[0])];
      if (x[5] || x[0] === day(2)) ids.push(photo(x[1] === 'sit' ? 'loaf' : 'sit', (x[2] + 70) % 360, x[0]));
      if (x[0] === day(2)) firstPhoto = ids[0];
      E('moment', x[0], { title: x[4] || '', star: !!x[5] }, { note: x[3], media: ids });
    });

    // 体重：到家后两周一次，半岁以后一个月一次
    var d = home, wPhoto = false;
    while (d <= day(3)) {
      var age = CL.diffDays(birth, d), kg = 4.6 / (1 + Math.exp(-(age - 150) / 55)) + (rnd() - 0.5) * 0.07;
      E('weight', d, { kg: Math.round(kg * 100) / 100 }, age > 500 && !wPhoto ? { note: '体检时称的' } : {});
      if (age > 500) wPhoto = true;
      d = CL.addDays(d, age < 190 ? 14 : 30 + Math.floor(rnd() * 5));
    }
    E('weight', day(3), { kg: Math.round((4.6 / (1 + Math.exp(-(ageNow - 153) / 55)) + 0.03) * 100) / 100 });

    // 日常状态：最近 100 天，大多正常，夹着几段小状况
    for (var k = 100; k >= 1; k--) {
      if (rnd() < 0.07 && k > 8) continue;
      var dd = CL.normalDaily({}), note = '';
      if (rnd() < 0.16) dd.app = 4;
      if (rnd() < 0.2) dd.energy = 3;
      if (rnd() < 0.06) dd.poop = 0;
      if (k === 41) { dd.poop = 2; note = '换粮第二天，便便偏软'; }
      if (k === 40) { dd.poop = 3; dd.app = 2; note = '拉稀两次，去看了医生'; }
      if (k === 39) { dd.poop = 2; }
      if (k === 17) { dd.vomit = 1; note = '吐了一团毛球'; }
      if (k === 6) { dd.app = 2; dd.energy = 1; dd.flags = ['mouth']; note = '吃得少，有点流口水'; }
      if (k === 5) { dd.app = 2; }
      if (k === 4) { dd.flags = ['mouth']; }
      add('entries', { id: CL.dailyId('demo1', day(k)), pet_id: 'demo1', kind: 'daily', date: day(k), time: k % 2 ? '21:10' : '08:20', data: dd, note: note }, k % 2 ? 'a' : 'b');
    }

    // 饮食
    E('food', home, { type: 'dry', name: '幼猫粮（鸡肉）', amount: '每天 55 g', change: true }, { note: '先沿用猫舍的粮' });
    E('food', CL.addMonths(birth, 12), { type: 'dry', name: '成猫粮（鸡肉）', amount: '每天 60 g', change: true }, { note: '七天慢慢换' });
    E('food', day(42), { type: 'dry', name: '成猫粮（三文鱼）', amount: '每天 60 g', change: true }, { note: '想试试鱼味，换得有点急' });
    E('food', day(36), { type: 'dry', name: '成猫粮（鸡肉）', amount: '每天 60 g', change: true }, { note: '软便，换回鸡肉味' });
    [30, 23, 16, 9, 3].forEach(function (x) { E('food', day(x), { type: x % 2 ? 'wet' : 'freeze', name: x % 2 ? '主食罐（鸡肉南瓜）' : '鸡胸肉冻干', amount: x % 2 ? '半罐' : '3 块' }); });

    // 活动和护理
    [52, 45, 38, 31, 25, 18, 11, 4].forEach(function (x, i) { E('activity', day(x), { type: i % 3 === 2 ? 'zoom' : 'wand', mins: 10 + (i * 5) % 20 }); });
    [88, 58, 27].forEach(function (x) { E('activity', day(x), { type: 'nail' }); });
    E('activity', day(61), { type: 'bath' }, { note: '全程骂骂咧咧' });
    E('activity', day(13), { type: 'teeth' });

    // 健康事件
    E('health', CL.addDays(birth, 200), { type: 'surgery', title: '绝育手术', sev: 2, clinic: '示例动物医院', status: 'done' }, { note: '当天接回家，戴了十天头套', media: [media('dd_op_1', 'img', '手术记录.jpg', 'image/jpeg', CL.addDays(birth, 200))] });
    E('health', day(40), { type: 'vet', title: '拉稀', sev: 1, clinic: '示例动物医院', status: 'done' }, { note: '医生说是换粮太快，开了益生菌，三天后好转' });
    E('health', day(9), { type: 'symptom', title: '牙龈有点红', sev: 1, status: 'open', follow: CL.addDays(today, 5) }, { note: '先观察，约了下周复查' });

    // 疫苗和驱虫
    function shot(kind, code, name, date, next, extra) { add('shots', Object.assign({ id: 's' + n, pet_id: 'demo1', kind: kind, code: code, name: name, date: date, next_due: next }, extra || {}), 'a', date); }
    shot('vaccine', 'fvrcp', '猫三联', CL.addDays(birth, 56), CL.addDays(birth, 84), { dose: '第 1 针', note: '猫舍打的' });
    shot('vaccine', 'fvrcp', '猫三联', CL.addDays(birth, 86), CL.addDays(birth, 114), { dose: '第 2 针', clinic: '示例动物医院' });
    shot('vaccine', 'fvrcp', '猫三联', CL.addDays(birth, 115), CL.addDays(birth, 480), { dose: '第 3 针', clinic: '示例动物医院', lot: 'A1234' });
    shot('vaccine', 'fvrcp', '猫三联', CL.addDays(birth, 478), CL.addMonths(CL.addDays(birth, 478), 36), { dose: '加强', clinic: '示例动物医院', lot: 'B5678', media: [media('dd_vax_2', 'img', '疫苗本.jpg', 'image/jpeg', CL.addDays(birth, 478))] });
    shot('vaccine', 'rabies', '狂犬疫苗', CL.addDays(birth, 175), CL.addDays(today, 19), { dose: '首针', clinic: '示例动物医院', lot: 'R0091' });
    for (var m = 6; m >= 1; m--) shot('deworm', 'both', '内外同驱', day(m * 30 + 5), day(m * 30 - 25), { product: '示例滴剂' });

    // 文件
    add('docs', { id: 'doc1', pet_id: 'demo1', title: '疫苗本', category: 'vaccine', date: CL.addDays(birth, 478), media: ['dd_vax_2'] }, 'a');
    add('docs', { id: 'doc2', pet_id: 'demo1', title: '绝育手术记录', category: 'record', date: CL.addDays(birth, 200), media: ['dd_op_1'] }, 'b');
    add('docs', { id: 'doc3', pet_id: 'demo1', title: '年度体检报告', category: 'checkup', date: day(40), note: '血常规、生化都正常', media: [media('dp_report_3', 'file', '体检报告.pdf', 'application/pdf', day(40))] }, 'a');

    extras(add, today);

    add('pets', { id: 'demo1', name: '年糕', species: 'cat', sex: 'f', neutered: 'y', birthday: birth, home_date: home, breed: '英国短毛猫', coat: '蓝色', color: CL.PET_COLORS[0], avatar: firstPhoto, note: '怕吸尘器，喜欢纸箱' }, 'a', home);
    restore(T, 1);
  }

  return { call: call, restore: restore, topUp: topUp, seeded: function () { return !!tables; } };
})();

/* ---------- 40-views：各个页面 ---------- */
var TABS = [['home', '今天', 'home'], ['timeline', '时间轴', 'timeline'], ['growth', '成长', 'growth'], ['records', '档案', 'records']];
var FILTERS = [['all', '全部'], ['photo', '照片'], ['weight', '体重'], ['daily', '日常'], ['alert', '异常'], ['food', '饮食'], ['activity', '活动'], ['health', '健康'], ['shot', '疫苗驱虫']];
var SEGS = [['vaccine', '疫苗'], ['deworm', '驱虫'], ['care', '护理'], ['health', '健康'], ['insure', '保险'], ['docs', '文件']];
var WD1 = ['一', '二', '三', '四', '五', '六', '日'];
var WDS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function needsInit() { return !S.demo && !S.auth; }
function ageLine(p) { return CL.ageLabel(p.birthday, S.today); }
function whoDot(id) { return id ? '<i class="who" style="--mc:' + esc(member(id).color) + '"></i>' : ''; }
function avatar(p, size) {
  var has = p.avatar && S.T.media[p.avatar];
  return '<span class="av ' + (size || '') + '" style="--pc:' + esc(p.color) + '">' + (has ? '<img data-mid="' + esc(p.avatar) + '" alt="">' : ico(p.species === 'cat' ? 'home' : 'paw')) + '</span>';
}

function render() {
  if (!S.ready) return;
  S.today = CL.today();
  var p = pet(), view = $('#view'), bare = needsInit() || !p;
  if (p && S.ui.pet !== p.id) S.ui.pet = p.id;
  document.body.classList.toggle('bare', bare);
  paintHeader(p, bare);
  paintTabs(bare);
  var fn = { home: viewHome, timeline: viewTimeline, growth: viewGrowth, records: viewRecords, prefs: viewPrefs }[S.tab] || viewHome;
  var notice = S.sync.state === 'auth' && !needsInit() ? '<section class="card notice"><b>' + ico('alert') + '口令失效了</b><p>这部手机现在同步不了。让表格的主人重新生成初始化链接，再粘贴进来。这部手机上记的东西不会丢。</p><button type="button" class="btn pri" data-act="reinit">粘贴新的链接</button></section>' : '';
  view.innerHTML = notice + (needsInit() ? viewWelcome() : !p ? (S.tab === 'prefs' ? viewPrefs(null) : viewFirstPet()) : fn(p));
  view.setAttribute('data-tab', S.tab);
  hydrate(document);
  afterRender(p);
}

function paintHeader(p, bare) {
  var el = $('#hdr');
  el.hidden = bare && S.tab !== 'prefs';
  if (el.hidden) { el.innerHTML = ''; return; }
  var left = S.tab === 'prefs' ? '<button type="button" class="iconbtn" data-act="go" data-tab="home" aria-label="返回">' + ico('chevL') + '</button><b class="hdr-title">设置</b>'
    : S.tab === 'home' || !p ? '<span class="brand">CatLog</span>'
      : '<button type="button" class="petchip" data-act="pet-menu" aria-label="猫咪：' + esc(p.name) + '">' + avatar(p, 'sm') + '<span class="petchip-t"><b>' + esc(p.name) + '</b><small>' + esc(ageLine(p)) + '</small></span>' + (pets().length > 1 ? ico('chevD', 'sm') : '') + '</button>';
  el.innerHTML = left + '<span class="grow"></span><button type="button" class="syncpill" id="syncpill" data-act="go" data-tab="prefs"></button>' +
    (S.tab === 'prefs' ? '' : '<button type="button" class="iconbtn" data-act="go" data-tab="prefs" aria-label="设置">' + ico('prefs') + '</button>');
  paintSync();
}
function paintSync() {
  var el = $('#syncpill');
  if (!el) return;
  var st = S.sync.state, n = waiting(), cls = 'ok', text = '已同步', icon = 'check';
  if (S.demo) { cls = 'demo'; text = '演示数据'; icon = 'info'; }
  else if (st === 'auth') { cls = 'bad'; text = '需要重新初始化'; icon = 'alert'; }
  else if (st === 'offline') { cls = 'warn'; text = n ? '离线 · ' + n + ' 条待传' : '离线'; icon = 'cloudOff'; }
  else if (st === 'err') { cls = 'warn'; text = n ? '稍后重试 · ' + n + ' 条待传' : '稍后重试'; icon = 'alert'; }
  else if (S.sync.busy && (n || st !== 'ok')) { cls = 'busy'; text = n ? '同步中 · ' + n : '同步中'; icon = 'sync'; }
  else if (n && n === held()) { cls = 'warn'; text = n + ' 条等后端更新'; icon = 'alert'; }
  else if (n) { cls = 'busy'; text = n + ' 条待传'; icon = 'sync'; }
  el.className = 'syncpill ' + cls;
  el.innerHTML = ico(icon, 'sm') + '<span>' + text + '</span>';
  el.setAttribute('aria-label', '同步状态：' + text);
  var line = $('#sync-line');
  if (line) line.textContent = syncLine();
}
function paintTabs(bare) {
  var el = $('#tabs');
  el.hidden = bare;
  if (bare) { el.innerHTML = ''; return; }
  function tab(t) { return '<button type="button" class="tab' + (S.tab === t[0] ? ' on' : '') + '" data-act="go" data-tab="' + t[0] + '"' + (S.tab === t[0] ? ' aria-current="page"' : '') + '>' + ico(t[2]) + '<span>' + t[1] + '</span></button>'; }
  el.innerHTML = tab(TABS[0]) + tab(TABS[1]) + '<button type="button" class="fab" data-act="add-menu" aria-label="添加记录">' + ico('plus') + '</button>' + tab(TABS[2]) + tab(TABS[3]);
}

/* ---- 小零件 ---- */
function dailyChips(d, onlyIssues) {
  var out = [];
  CL.DAILY.forEach(function (f) {
    if (d[f.k] == null) return;
    var o = CL.dailyOpt(f.k, d[f.k]);
    if (!o || (onlyIssues && o.s < 2)) return;
    out.push('<span class="st s' + o.s + '">' + (o.s > 1 ? ico('alert', 'xs') : '') + esc(f.label) + ' <b>' + esc(o.l) + '</b></span>');
  });
  (d.flags || []).forEach(function (k) { out.push('<span class="st s2">' + ico('alert', 'xs') + '<b>' + esc(CL.label(CL.FLAGS, k)) + '</b></span>'); });
  return out.length ? '<div class="sts">' + out.join('') + '</div>' : '';
}
function photoGrid(row, max) {
  var imgs = CL.images(S.T, row);
  if (!imgs.length) return '';
  var show = imgs.slice(0, max || 4), more = imgs.length - show.length;
  return '<div class="ph-grid n' + show.length + '">' + show.map(function (id, i) {
    return '<button type="button" class="ph" data-act="view" data-ids="' + esc(imgs.join(',')) + '" data-i="' + i + '" aria-label="看大图"><img data-mid="' + esc(id) + '" alt="" loading="lazy">' +
      (S.pend[id] ? '<i class="ph-tag">待上传</i>' : '') + (more > 0 && i === show.length - 1 ? '<i class="ph-more">+' + more + '</i>' : '') + '</button>';
  }).join('') + '</div>';
}
function fileChips(row) {
  var fs = CL.files(S.T, row);
  if (!fs.length) return '';
  return '<div class="files">' + fs.map(function (id) {
    var m = S.T.media[id];
    return '<button type="button" class="filechip" data-act="file" data-id="' + esc(id) + '">' + ico('doc', 'sm') + '<span>' + esc(m.name || '文件') + '</span><small>' + fmtBytes(m.size) + (S.pend[id] ? ' · 待上传' : '') + '</small></button>';
  }).join('') + '</div>';
}
function sevPill(n) { return n ? '<span class="pill sev' + n + '">' + ['', '轻', '中', '重'][n] + '</span>' : ''; }
function weightDeltas(ws) { var m = CL.map(); for (var i = 1; i < ws.length; i++) m[ws[i].id] = ws[i].kg - ws[i - 1].kg; return m; }

// 时间轴上的一条
function tlItem(it, ctx) {
  if (it.t === 'mark') return '<div class="tl-mark ' + it.kind + '">' + ico(it.kind === 'birthday' ? 'cake' : 'house', 'sm') + '<span>' + esc(it.text) + '</span></div>';
  var r = it.row, kind = it.kind, title = '', sub = [], extra = '', u = unit(), d = r.data || {};
  if (it.t === 'shot') {
    title = esc(r.name) + (r.dose ? ' <small>' + esc(r.dose) + '</small>' : '');
    if (r.next_due) sub.push('下次 ' + CL.fmtDate(r.next_due, 'num'));
    if (r.product) sub.push(r.product);
    if (r.clinic) sub.push(r.clinic);
  } else if (kind === 'weight') {
    var dl = ctx && ctx.deltas[r.id];
    title = '<span class="num">' + CL.fmtWeight(d.kg, u) + '</span> ' + u + (dl != null ? ' <small class="delta">' + esc(CL.fmtDelta(dl, u)) + '</small>' : '');
  } else if (kind === 'daily') {
    var all = CL.dailyAllNormal(d);
    title = all ? '一切正常' : CL.dailyLevel(d) > 1 ? '有点状况' : '日常状态';
    if (!all) extra = dailyChips(d, CL.dailyLevel(d) > 1);
  } else if (kind === 'food') {
    title = esc(CL.label(CL.FOOD, d.type)) + (d.name ? ' · ' + esc(d.name) : '');
    if (d.amount) sub.push(d.amount);
    if (d.change) extra = '<div class="pills"><span class="pill tag">换粮</span></div>';
  } else if (kind === 'activity') {
    title = esc(CL.label(CL.ACT, d.type));
    if (d.mins) sub.push(d.mins + ' 分钟');
  } else if (kind === 'health') {
    title = esc(d.title || CL.label(CL.HEALTH, d.type));
    extra = '<div class="pills">' + (d.title ? '<span class="pill">' + esc(CL.label(CL.HEALTH, d.type)) + '</span>' : '') + sevPill(d.sev) +
      '<span class="pill ' + (d.status === 'open' ? 'warn' : 'ok') + '">' + (d.status === 'open' ? '进行中' : '已好转') + '</span></div>';
    if (d.clinic) sub.push(d.clinic);
    if (d.status === 'open' && d.follow) sub.push('复查 ' + CL.fmtDate(d.follow, 'num'));
  } else if (kind === 'moment') {
    title = (d.star ? ico('star', 'sm star') : '') + esc(d.title || '');
  }
  var by = r.created_by ? whoDot(r.created_by) + esc(whoName(r.created_by)) : '';
  return '<article class="tl-item" role="button" tabindex="0" data-act="open" data-t="' + it.t + '" data-id="' + esc(r.id) + '">' + kico(kind) + '<div class="tl-b">' +
    '<div class="tl-h">' + (title ? '<b class="tl-t">' + title + '</b>' : '<b class="tl-t dim">' + esc(KIND[kind].name) + '</b>') + '<span class="tl-meta">' + (r.time ? esc(r.time) + ' ' : '') + by + '</span></div>' +
    (sub.length ? '<p class="tl-sub">' + esc(sub.join(' · ')) + '</p>' : '') + extra +
    (r.note ? '<p class="tl-note">' + esc(r.note) + '</p>' : '') + photoGrid(r, 4) + fileChips(r) + '</div></article>';
}
function emptyBox(icon, title, text, btn) {
  return '<div class="empty">' + ico(icon, 'big') + '<b>' + esc(title) + '</b><p>' + esc(text) + '</p>' + (btn || '') + '</div>';
}

/* ---- 今天 ---- */
function viewHome(p) {
  var T = S.T, today = S.today, u = unit(), ws = CL.weights(T, p.id), st = CL.weightStats(ws), cnt = CL.counts(T, p, today), streak = CL.streak(T, p.id, today), h = '';
  var facts = [];
  if (p.breed) facts.push(esc(p.breed));
  if (cnt.home) facts.push('到家第 ' + cnt.home + ' 天');
  if (streak > 1) facts.push('连续记了 ' + streak + ' 天');
  h += '<section class="card hero"><button type="button" class="hero-av" data-act="pet-menu" aria-label="猫咪资料">' + avatar(p, 'lg') + '</button><div class="hero-main"><h1>' + esc(p.name) +
    (p.sex ? '<span class="sex">' + (p.sex === 'f' ? '妹妹' : '弟弟') + '</span>' : '') + '</h1><p class="hero-age">' + esc(ageLine(p) || '还没填生日') + '</p>' +
    (facts.length ? '<p class="hero-facts">' + facts.map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</p>' : '') + '</div>' +
    '<button type="button" class="hero-w" data-act="add" data-kind="weight" aria-label="记体重">' + (st ? '<small>体重</small><b class="num">' + CL.fmtWeight(st.last.kg, u) + '</b><i>' + u + (st.delta != null ? ' <em>' + esc(CL.fmtDelta(st.delta, u)) + '</em>' : '') + '</i>'
      : ico('weight') + '<i>记体重</i>') + '</button></section>';

  var rem = CL.reminders(T, p, today);
  if (rem.length) h += '<section class="card rem"><h2 class="card-t">提醒</h2>' + rem.map(function (r) {
    return '<button type="button" class="rem-row lv' + r.level + '" data-act="rem" data-go="' + esc(r.go) + '" data-kind="' + esc(r.kind || '') + '" data-id="' + esc(r.id || '') + '" data-type="' + esc(r.type || '') + '">' +
      ico(r.level === 3 ? 'alert' : r.go === 'care' ? 'activity' : r.go === 'insure' ? 'insure' : r.level === 2 ? 'calendar' : r.go === 'weight' ? 'weight' : 'cake') + '<span class="rem-t"><b>' + esc(r.text) + '</b><small>' + esc(r.sub) + '</small></span>' + (r.go ? ico('chevR', 'sm') : '') + '</button>';
  }).join('') + '</section>';

  var de = T.entries[CL.dailyId(p.id, today)], lv = de ? CL.dailyLevel(de.data) : 0;
  h += '<section class="card today"><div class="card-h"><h2 class="card-t">今天的状态</h2><span class="card-sub">' + CL.fmtDate(today) + ' ' + WDS[CL.weekday(today)] + '</span></div>';
  if (!lv) h += '<p class="today-q">' + esc(p.name) + '今天怎么样？</p><div class="btns"><button type="button" class="btn pri" data-act="day-ok">' + ico('check') + '一切正常</button><button type="button" class="btn" data-act="day" data-date="' + today + '">逐项记录</button></div>';
  else h += (CL.dailyAllNormal(de.data) ? '<p class="today-ok">' + ico('check') + '一切正常</p>' : dailyChips(de.data)) + (de.note ? '<p class="tl-note">' + esc(de.note) + '</p>' : '') +
    '<div class="today-foot"><span class="tl-meta">' + whoDot(de.updated_by || de.created_by) + esc(whoName(de.updated_by || de.created_by)) + (de.time ? ' ' + esc(de.time) : '') + '</span><button type="button" class="btn sm" data-act="day" data-date="' + today + '">修改</button></div>';
  h += '</section>';

  h += '<section class="quick" aria-label="快速添加">' + [['weight', '体重'], ['moment', '照片'], ['food', '饮食'], ['activity', '活动']].map(function (q) {
    return '<button type="button" class="qbtn" data-act="add" data-kind="' + q[0] + '">' + kico(q[0]) + '<span>' + q[1] + '</span></button>';
  }).join('') + '</section>';

  // 护理：剪指甲和刷牙总是在；别的几种记过或者定了间隔才出现
  var care = CL.careBoard(T, p, today).filter(function (c) { return c.last || c.every != null || CL.CARE_HOME.indexOf(c.type) >= 0; });
  if (care.length) h += '<section class="card caremini"><div class="card-h"><h2 class="card-t">护理</h2><button type="button" class="link" data-act="go-seg" data-seg="care">全部' + ico('chevR', 'xs') + '</button></div><div class="carechips">' + care.map(function (c) {
    return '<button type="button" class="carechip' + (c.state === 'due' ? ' due' : '') + '" data-act="care" data-type="' + c.type + '"><b>' + esc(c.label) + '</b><span>' + (c.state === 'due' ? ico('alert', 'xs') : '') + esc(c.last ? CL.daysAgo(c.days) : '还没记过') + '</span></button>';
  }).join('') + '</div></section>';

  var mem = CL.memory(T, p.id, today);
  if (mem) {
    var mi = CL.images(T, mem.entry)[0], wn = CL.weightNear(ws, mem.entry.date, 30), mt = mem.entry.kind === 'moment' ? (mem.entry.data.title || mem.entry.note) : '';
    h += '<section class="card memory" role="button" tabindex="0" data-act="open" data-t="entry" data-id="' + esc(mem.entry.id) + '"><div class="memory-ph"><img data-mid="' + esc(mi) + '" data-full alt=""></div><div class="memory-t"><small>' + esc(mem.label) + '</small>' +
      (mt ? '<b>' + esc(mt) + '</b>' : '') + '<span>' + esc([CL.fmtDate(mem.entry.date, 'ymd'), ageAt(p, mem.entry.date) ? '那时 ' + ageAt(p, mem.entry.date) : '', wn ? CL.fmtWeight(wn.kg, u) + ' ' + u : ''].filter(Boolean).join(' · ')) + '</span></div></section>';
  }

  // 最近的记录里不放「一切正常」的日常（它们在上面的卡片和日历里），只放有状况的
  var recent = CL.timeline(T, p.id, 'all').filter(function (x) { return x.kind !== 'daily' || (x.date !== today && CL.dailyLevel(x.row.data) > 1); }).slice(0, 5), ctx = { deltas: weightDeltas(ws) };
  if (recent.length) h += '<section class="card"><div class="card-h"><h2 class="card-t">最近的记录</h2><button type="button" class="link" data-act="go" data-tab="timeline">时间轴' + ico('chevR', 'xs') + '</button></div><div class="tl-list">' +
    recent.map(function (it) { return '<div class="tl-row"><span class="tl-when">' + esc(CL.relDay(it.date, today)) + '</span>' + tlItem(it, ctx) + '</div>'; }).join('') + '</div></section>';
  else h += '<section class="card">' + emptyBox('paw', '从第一条记录开始', '称一次体重、拍一张照片，或者记一下今天的状态。时间久了，这里就是' + p.name + '的成长记录。') + '</section>';
  return h;
}
function ageAt(p, date) { return CL.ageLabel(p.birthday, date); }

/* ---- 时间轴 ---- */
function viewTimeline(p) {
  var T = S.T, f = S.ui.filter, items = CL.timeline(T, p.id, f), ctx = { deltas: weightDeltas(CL.weights(T, p.id)) };
  var h = '<div class="chips scroll" role="tablist" aria-label="筛选">' + FILTERS.map(function (x) {
    return '<button type="button" role="tab" class="chip' + (f === x[0] ? ' on' : '') + '" aria-selected="' + (f === x[0]) + '" data-act="filter" data-v="' + x[0] + '">' + x[1] + '</button>';
  }).join('') + '</div>';
  if (!items.length) return h + '<section class="card">' + emptyBox('timeline', f === 'all' ? '时间轴还是空的' : '这一类还没有记录', f === 'all' ? '点下面的加号，记下第一条。' : '换一个筛选看看，或者点下面的加号添加。') + '</section>';
  if (f === 'all') {
    var from = items[items.length - 1].date;
    [p.birthday, p.home_date].forEach(function (d) { if (CL.isYmd(d) && d < from) from = d; });
    items = CL.sortDesc(items.concat(CL.marks(p, from, S.today)));
  }
  var total = items.length, shown = items.slice(0, S.ui.tlLimit);
  CL.groupByMonth(shown).forEach(function (g) {
    var end = CL.addDays(CL.addMonths(g.ym + '-01', 1), -1), age = ageAt(p, end > S.today ? S.today : end);
    h += '<section class="tl-month"><h2 class="tl-mh"><span>' + esc(CL.fmtDate(g.ym + '-01', 'ym')) + '</span>' + (age ? '<small>' + esc(age) + '</small>' : '') + '</h2>' +
      g.days.map(function (d) {
        return '<div class="tl-day"><div class="tl-date"><b class="num">' + (+d.date.slice(8)) + '</b><span>' + WDS[CL.weekday(d.date)] + '</span></div><div class="tl-items">' + d.items.map(function (it) { return tlItem(it, ctx); }).join('') + '</div></div>';
      }).join('') + '</section>';
  });
  if (total > shown.length) h += '<button type="button" class="btn wide" data-act="tl-more">更早的记录（还有 ' + (total - shown.length) + ' 条）</button>';
  return h;
}

/* ---- 成长 ---- */
function rangeFrom() { return S.ui.range === '3m' ? CL.addMonths(S.today, -3) : S.ui.range === '1y' ? CL.addMonths(S.today, -12) : ''; }
function viewGrowth(p) {
  var T = S.T, today = S.today, u = unit(), all = CL.weights(T, p.id), from = rangeFrom(), ws = from ? all.filter(function (w) { return w.date >= from; }) : all, st = CL.weightStats(all), h = '';
  h += '<section class="card wcard"><div class="card-h"><h2 class="card-t">体重</h2><div class="seg" role="tablist" aria-label="时间范围">' + [['3m', '3 个月'], ['1y', '1 年'], ['all', '全部']].map(function (x) {
    return '<button type="button" role="tab" aria-selected="' + (S.ui.range === x[0]) + '" class="' + (S.ui.range === x[0] ? 'on' : '') + '" data-act="range" data-v="' + x[0] + '">' + x[1] + '</button>';
  }).join('') + '</div></div>';
  if (!st) h += emptyBox('weight', '还没有体重记录', '定期称一称，这里会画出从小到大的曲线。', '<button type="button" class="btn pri" data-act="add" data-kind="weight">记一次体重</button>');
  else {
    h += '<div class="wnow"><b class="num">' + CL.fmtWeight(st.last.kg, u) + '</b><i>' + u + '</i><span class="wnow-s">' + esc(CL.relDay(st.last.date, today)) +
      (st.delta != null ? ' · 比上次 ' + esc(CL.fmtDelta(st.delta, u)) : '') + (st.refDelta != null ? ' · 比 ' + CL.diffDays(st.ref.date, st.last.date) + ' 天前 ' + esc(CL.fmtDelta(st.refDelta, u)) : '') + '</span></div>';
    h += ws.length ? '<div class="chart" id="wchart" aria-label="体重曲线"></div>' : '<p class="hint">这段时间里没有体重记录。</p>';
    h += '<div class="wstats"><span>最轻 <b class="num">' + CL.fmtWeight(st.min.kg, u) + '</b></span><span>最重 <b class="num">' + CL.fmtWeight(st.max.kg, u) + '</b></span><span>共 <b class="num">' + st.n + '</b> 次</span>' +
      '<button type="button" class="link" data-act="wlist" aria-expanded="' + !!S.ui.listW + '">' + (S.ui.listW ? '收起列表' : '看列表') + '</button></div>';
    if (S.ui.listW) {
      var dl = weightDeltas(all);
      h += '<table class="wtable"><thead><tr><th>日期</th><th>年龄</th><th class="r">体重（' + u + '）</th><th class="r">变化</th></tr></thead><tbody>' + all.slice().reverse().map(function (w) {
        return '<tr role="button" tabindex="0" data-act="open" data-t="entry" data-id="' + esc(w.id) + '"><td>' + esc(CL.fmtDate(w.date, 'num')) + '</td><td>' + esc(ageAt(p, w.date)) + '</td><td class="r num">' + CL.fmtWeight(w.kg, u) + '</td><td class="r num">' + (dl[w.id] != null ? esc(CL.fmtDelta(dl[w.id], u)) : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
  }
  h += '</section>';

  // 状态日历
  var ym = S.ui.calYm || today.slice(0, 7), g = CL.monthGrid(T, p.id, ym, today), rc = CL.recent(T, p.id, today, 30);
  h += '<section class="card cal"><div class="card-h"><h2 class="card-t">状态日历</h2><div class="cal-nav"><button type="button" class="iconbtn sm" data-act="cal" data-d="-1" aria-label="上个月">' + ico('chevL', 'sm') + '</button><b>' + esc(g.label) + '</b>' +
    '<button type="button" class="iconbtn sm" data-act="cal" data-d="1" aria-label="下个月"' + (ym >= today.slice(0, 7) ? ' disabled' : '') + '>' + ico('chevR', 'sm') + '</button></div></div>' +
    '<div class="cal-wd" aria-hidden="true">' + WD1.map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div><div class="cal-grid">' + g.cells.map(function (c) {
      if (!c) return '<span class="cal-x"></span>';
      var say = ['没记', '正常', '留意', '异常'][c.level];
      return '<button type="button" class="cal-c lv' + c.level + (c.today ? ' today' : '') + '"' + (c.future ? ' disabled' : '') + ' data-act="day" data-date="' + c.date + '" aria-label="' + esc(CL.fmtDate(c.date) + '：' + say) + '"><b>' + c.day + '</b>' +
        '<i class="cal-mk">' + (c.level === 3 ? '!!' : c.level === 2 ? '!' : c.level === 1 ? ico('check', 'xs') : '') + '</i>' +
        '<i class="cal-dots">' + (c.weight ? '<u class="k1"></u>' : '') + (c.health ? '<u class="k8"></u>' : '') + '</i></button>';
    }).join('') + '</div><div class="cal-legend"><span class="lgd lv1">' + ico('check', 'xs') + '正常</span><span class="lgd lv2">! 留意</span><span class="lgd lv3">!! 异常</span><span class="lgd dots"><u class="k1"></u>称了体重<u class="k8"></u>有健康事件</span></div>' +
    '<div class="tiles"><div class="tile"><b class="num">' + rc.logged + '</b><span>近 30 天记了几天</span></div><div class="tile"><b class="num">' + rc.warn + '</b><span>留意的天数</span></div><div class="tile"><b class="num">' + rc.bad + '</b><span>异常的天数</span></div><div class="tile"><b class="num">' + rc.vomit + '</b><span>呕吐次数</span></div></div></section>';

  // 相册和对比
  var al = CL.album(T, p), fl = CL.firstLast(T, p);
  if (fl) {
    var wa = CL.weightNear(all, fl.first.date, 30), wb = CL.weightNear(all, fl.last.date, 30);
    h += '<section class="card"><h2 class="card-t">从小到大</h2><div class="vs">' + [[fl.first, wa], [fl.last, wb]].map(function (x) {
      return '<button type="button" class="vs-i" data-act="view" data-ids="' + esc(x[0].mid) + '" data-i="0"><img data-mid="' + esc(x[0].mid) + '" data-full alt=""><span><b>' + esc(ageAt(p, x[0].date) || CL.fmtDate(x[0].date, 'ym')) + '</b>' +
        esc(CL.fmtDate(x[0].date, 'num')) + (x[1] ? ' · ' + CL.fmtWeight(x[1].kg, u) + ' ' + u : '') + '</span></button>';
    }).join('') + '</div></section>';
  }
  h += '<section class="card"><div class="card-h"><h2 class="card-t">' + (CL.isYmd(p.birthday) ? '月龄相册' : '相册') + '</h2><span class="card-sub">' + CL.counts(T, p, today).photos + ' 张</span></div>';
  if (!al.length) h += emptyBox('image', '还没有照片', '每个月拍一张，这里会排成一面从小到大的照片墙。', '<button type="button" class="btn pri" data-act="add" data-kind="moment">添加照片</button>');
  else h += '<div class="alb-grid">' + al.map(function (a) {
    return '<button type="button" class="alb" data-act="view" data-ids="' + esc(a.items.map(function (x) { return x.mid; }).join(',')) + '" data-i="' + Math.max(0, a.items.map(function (x) { return x.mid; }).indexOf(a.cover)) + '"><img data-mid="' + esc(a.cover) + '" alt="" loading="lazy"><span class="alb-l">' + (a.star ? ico('star', 'xs star') : '') + esc(a.label) + '</span>' + (a.items.length > 1 ? '<i class="alb-n">' + a.items.length + '</i>' : '') + '</button>';
  }).join('') + '</div>';
  return h + '</section>';
}

/* ---- 档案 ---- */
function stampSvg(state) {
  var t = { ok: '有效', soon: '快到期', over: '已过期', done: '已做', none: '未记录' }[state];
  return '<svg class="stamp st-' + state + '" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" class="o"/><circle cx="32" cy="32" r="23.5" class="in"/><text x="32" y="' + (t.length > 2 ? 36 : 38) + '" text-anchor="middle" style="font-size:' + (t.length > 2 ? 12 : 16) + 'px">' + t + '</text></svg>';
}
function shotRowHtml(s) {
  return '<button type="button" class="row" data-act="open" data-t="shot" data-id="' + esc(s.id) + '">' + kico(s.kind, 'sm') + '<span class="row-t"><b>' + esc(s.name) + (s.dose ? ' <small>' + esc(s.dose) + '</small>' : '') + '</b><small>' +
    esc([CL.fmtDate(s.date, 'num'), s.product, s.clinic, s.next_due ? '下次 ' + CL.fmtDate(s.next_due, 'num') : ''].filter(Boolean).join(' · ')) + '</small></span>' + (CL.images(S.T, s).length || CL.files(S.T, s).length ? ico('clip', 'sm dim') : '') + ico('chevR', 'sm dim') + '</button>';
}
function viewRecords(p) {
  var T = S.T, today = S.today, seg = S.ui.seg, h = '<div class="seg big" role="tablist" aria-label="档案">' + SEGS.map(function (x) {
    return '<button type="button" role="tab" aria-selected="' + (seg === x[0]) + '" class="' + (seg === x[0] ? 'on' : '') + '" data-act="seg" data-v="' + x[0] + '">' + x[1] + '</button>';
  }).join('') + '</div>';
  if (seg === 'vaccine' || seg === 'deworm') {
    var board = CL.shotBoard(T, p, seg, today), name = seg === 'vaccine' ? '疫苗' : '驱虫';
    var list = CL.vals(T.shots).filter(function (s) { return s.pet_id === p.id && s.kind === seg; }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.created_at < b.created_at ? 1 : -1); });
    h += '<section class="card board">';
    if (!board.length) h += emptyBox(seg, '还没有' + name + '记录', '记下每次的日期和下次的日子，快到期时首页会提醒。');
    else h += board.map(function (r) {
      var line1 = r.last ? '上次 ' + CL.fmtDate(r.last.date, 'num') + (r.last.dose ? ' · ' + r.last.dose : '') : '还没有记录';
      var line2 = r.state === 'none' ? '打过的话，补记一针' : r.state === 'done' ? '没有填下次的日期' : '下次 ' + CL.fmtDate(r.next, 'num') + ' · ' + CL.dueText(r.days);
      var pct = r.last && r.next ? clamp(Math.round(100 * CL.diffDays(r.last.date, today) / Math.max(1, CL.diffDays(r.last.date, r.next))), 0, 100) : 0;
      return '<button type="button" class="shot st-' + r.state + '" data-act="shot-key" data-kind="' + seg + '" data-key="' + esc(r.key) + '"><span class="shot-main"><b>' + esc(r.name) + (r.en ? ' <small>' + esc(r.en) + '</small>' : '') + '</b><span class="shot-l">' + esc(line1) + '</span><span class="shot-l next">' + esc(line2) + '</span>' +
        (r.last && r.next ? '<span class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span>' : '') + '</span>' + stampSvg(r.state) + '</button>';
    }).join('');
    h += '<button type="button" class="btn pri wide" data-act="add" data-kind="' + seg + '">' + ico('plus') + (seg === 'vaccine' ? '记一针疫苗' : '记一次驱虫') + '</button><p class="hint">下次的日期以医生给的为准，这里只帮你记着。</p></section>';
    if (list.length) h += '<section class="card"><div class="card-h"><h2 class="card-t">全部' + name + '记录</h2><span class="card-sub">' + list.length + ' 条</span></div><div class="rows">' + list.map(shotRowHtml).join('') + '</div></section>';
  } else if (seg === 'care') {
    h += '<section class="card board"><div class="card-h"><h2 class="card-t">护理</h2><span class="card-sub">上次是什么时候</span></div>' + CL.careBoard(T, p, today).map(careRow).join('') +
      '<p class="hint">点「做了」记成今天。点名字可以看以前的、补记，或者定一个「多久做一次」，到时间首页会提醒。</p></section>';
  } else if (seg === 'insure') {
    var pols = CL.policiesOf(T, p.id);
    if (!S.demo && S.backend && !CL.verGte(S.backend, CL.TABLE_SINCE.policies)) h += '<section class="card notice warn"><b>' + ico('alert') + '后端要先更新</b><p>表格那边的后端还是 v' + esc(S.backend) + '，不认识保险的数据。把 Code.gs 换成新的并发一个新版本（部署文档「升级」一节）。在那之前，这里记的东西先存在这部手机上，更新后会自动传上去。</p></section>';
    if (!pols.length) h += '<section class="card">' + emptyBox('insure', '还没有保险信息', '记下是哪家公司、谁在付、每月保费、额度和自付额、哪天续保。每次理赔记一笔，这里会算出已经用了多少、还剩多少。', '<button type="button" class="btn pri" data-act="policy-add">' + ico('plus') + '添加保险</button>') + '</section>';
    else h += pols.map(policyCard).join('') + '<button type="button" class="btn wide" data-act="policy-add">' + ico('plus') + '再加一份保险</button>';
  } else if (seg === 'health') {
    var hs = CL.entriesOf(T, p.id, 'health').sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }), open = hs.filter(function (e) { return e.data.status === 'open'; }), done = hs.filter(function (e) { return e.data.status !== 'open'; });
    var hrow = function (e) {
      return '<button type="button" class="row" data-act="open" data-t="entry" data-id="' + esc(e.id) + '">' + kico('health', 'sm') + '<span class="row-t"><b>' + esc(e.data.title || CL.label(CL.HEALTH, e.data.type)) + '</b><small>' +
        esc([CL.fmtDate(e.date, 'num'), CL.label(CL.HEALTH, e.data.type), e.data.clinic, e.data.status === 'open' && e.data.follow ? '复查 ' + CL.fmtDate(e.data.follow, 'num') : ''].filter(Boolean).join(' · ')) + '</small></span>' + sevPill(e.data.sev) + (e.media.length ? ico('clip', 'sm dim') : '') + ico('chevR', 'sm dim') + '</button>';
    };
    h += '<section class="card"><div class="card-h"><h2 class="card-t">进行中</h2><span class="card-sub">' + open.length + ' 件</span></div>' + (open.length ? '<div class="rows">' + open.map(hrow).join('') + '</div>' : '<p class="hint">现在没有在观察或治疗的事情。</p>') +
      '<button type="button" class="btn pri wide" data-act="add" data-kind="health">' + ico('plus') + '记一次健康事件</button></section>';
    if (done.length) h += '<section class="card"><div class="card-h"><h2 class="card-t">以前的</h2><span class="card-sub">' + done.length + ' 件</span></div><div class="rows">' + done.map(hrow).join('') + '</div></section>';
  } else {
    var docs = CL.vals(T.docs).filter(function (d) { return !d.pet_id || d.pet_id === p.id; }).sort(function (a, b) { return (b.date || '') < (a.date || '') ? -1 : (b.date || '') > (a.date || '') ? 1 : 0; });
    h += '<section class="card"><div class="card-h"><h2 class="card-t">文件</h2><span class="card-sub">两个人都能看</span></div>';
    if (!docs.length) h += emptyBox('doc', '还没有文件', '疫苗本、体检报告、化验单、领养或购买合同，拍照或选 PDF 传上来，以后在这里随时能找到。');
    else h += '<div class="rows">' + docs.map(function (d) {
      var im = CL.images(T, d)[0], n = d.media.filter(function (id) { return T.media[id]; }).length;
      return '<button type="button" class="row doc" data-act="doc" data-id="' + esc(d.id) + '">' + (im ? '<span class="doc-th"><img data-mid="' + esc(im) + '" alt=""></span>' : '<span class="doc-th">' + ico('doc') + '</span>') + '<span class="row-t"><b>' + esc(d.title) + '</b><small>' +
        esc([CL.label(CL.DOC_CATS, d.category), d.date ? CL.fmtDate(d.date, 'num') : '', n > 1 ? n + ' 个文件' : '', whoName(d.created_by)].filter(Boolean).join(' · ')) + '</small></span>' + ico('chevR', 'sm dim') + '</button>';
    }).join('') + '</div>';
    h += '<button type="button" class="btn pri wide" data-act="add" data-kind="doc">' + ico('plus') + '上传文件</button></section>';
  }
  return h;
}

/* ---- 护理和保险的零件 ---- */
function careLine(c) { return c.last ? '上次 ' + CL.daysAgo(c.days) + ' · ' + CL.fmtDate(c.last.date, c.last.date.slice(0, 4) === S.today.slice(0, 4) ? '' : 'ymd') : '还没记过'; }
function careNext(c) {
  if (c.every == null) return '';
  var every = CL.everyText(c.every) + '一次 · ';
  return every + (!c.last ? '该做了' : c.left > 0 ? '还有 ' + c.left + ' 天' : c.left === 0 ? '今天该做了' : '超了 ' + (-c.left) + ' 天');
}
function careRow(c) {
  return '<div class="care st-' + c.state + '" data-care="' + c.type + '"><button type="button" class="care-main" data-act="care" data-type="' + c.type + '"><b>' + esc(c.label) + '</b><span class="shot-l">' + esc(careLine(c)) + '</span>' +
    (c.every != null ? '<span class="shot-l next">' + (c.state === 'due' ? ico('alert', 'xs') : '') + esc(careNext(c)) + '</span>' : '') + '</button>' +
    (c.last && c.days === 0 ? '<span class="pill ok">' + ico('check', 'xs') + '今天做了</span>' : '<button type="button" class="btn sm" data-act="care-done" data-type="' + c.type + '" aria-label="' + esc(c.label) + '：今天做了">做了</button>') + '</div>';
}
// some：有数但不到 1% 的时候也画出一小截，不然看着像一点没用
function meter(pct, cls, some) { return '<span class="bar ' + cls + '" aria-hidden="true"><i style="width:' + clamp(pct || (some ? 1 : 0), 0, 100) + '%"></i></span>'; }
function claimRow(c, cur) {
  var parts = [CL.fmtDate(c.date, 'num'), c.bill !== '' ? '账单 ' + CL.fmtMoney(c.bill, cur) : '', c.status !== 'denied' && c.paid !== '' ? '赔了 ' + CL.fmtMoney(c.paid, cur) : '', c.status !== 'denied' && c.ded !== '' && c.ded > 0 ? '抵自付额 ' + CL.fmtMoney(c.ded, cur) : ''];
  return '<button type="button" class="row" data-act="claim-edit" data-id="' + esc(c.id) + '"><span class="row-t"><b>' + esc(c.title) + '</b><small>' + esc(parts.filter(Boolean).join(' · ')) + '</small></span>' +
    '<span class="pill ' + (c.status === 'paid' ? 'ok' : c.status === 'denied' ? 'sev3' : 'warn') + '">' + esc(CL.label(CL.CLAIM_STATUS, c.status)) + '</span>' + (c.media.length ? ico('clip', 'sm dim') : '') + ico('chevR', 'sm dim') + '</button>';
}
function policyCard(pol) {
  var v = CL.policyView(S.T, pol, S.today), m = function (n) { return CL.fmtMoney(n, pol.currency); };
  var payer = pol.payer === 'both' ? '两个人一起付' : pol.payer ? whoName(pol.payer) + '在付' : '';
  var h = '<section class="card pol"><div class="card-h"><h2 class="card-t">' + esc(pol.company) + (pol.plan ? ' <small>' + esc(pol.plan) + '</small>' : '') + '</h2><button type="button" class="link" data-act="policy-edit" data-id="' + esc(pol.id) + '">修改</button></div>';
  h += '<div class="tiles two"><div class="tile"><b class="num">' + (pol.premium !== '' ? esc(m(pol.premium)) : '—') + '</b><span>每月保费' + (payer ? ' · ' + esc(payer) : '') + '</span>' + (v.yearPremium !== '' ? '<span>一年 ' + esc(m(v.yearPremium)) + '</span>' : '') + '</div>' +
    '<div class="tile ' + (v.state === 'soon' || v.state === 'over' ? 'warn' : '') + '"><b class="num">' + (v.daysToRenew == null ? '—' : v.daysToRenew >= 0 ? v.daysToRenew + ' 天' : '过了 ' + (-v.daysToRenew) + ' 天') + '</b><span>' + (v.daysToRenew == null ? '没填续保日' : v.daysToRenew >= 0 ? '后续保' : '续保日已过') + '</span>' +
    (pol.renew ? '<span>' + esc(CL.fmtDate(pol.renew, 'ymd')) + '</span>' : '') + '</div></div>';
  if (v.state === 'over') h += '<button type="button" class="btn wide" data-act="policy-roll" data-id="' + esc(pol.id) + '">已经续保了，顺延一年</button>';
  h += '<div class="meter"><div class="meter-h"><b>年度额度</b><span>' + (pol.limit_amt !== '' ? '已用 ' + esc(m(v.used)) + ' / ' + esc(m(pol.limit_amt)) : '不限额 · 已赔 ' + esc(m(v.used))) + '</span></div>' +
    (v.usedPct != null ? meter(v.usedPct, v.usedPct >= 100 ? 'bad' : v.usedPct >= 80 ? 'warn' : 'b1', v.used > 0) + '<p class="meter-f">还剩 <b class="num">' + esc(m(v.left)) + '</b></p>' : '') + '</div>';
  if (pol.deductible !== '') h += '<div class="meter"><div class="meter-h"><b>自付额</b><span>已抵 ' + esc(m(v.dedMet)) + ' / ' + esc(m(pol.deductible)) + '</span></div>' + meter(v.dedPct == null ? 100 : v.dedPct, v.dedLeft > 0 ? 'b1' : 'ok', v.dedMet > 0) +
    '<p class="meter-f">' + (v.dedLeft > 0 ? '还差 <b class="num">' + esc(m(v.dedLeft)) + '</b> 抵满' : ico('check', 'xs') + '已经抵满') + '</p></div>';
  var facts = [];
  if (pol.rate !== '') facts.push(['赔付比例', pol.rate + '%']);
  if (v.from || v.to) facts.push(['本年度', (v.from ? CL.fmtDate(v.from, 'num') : '') + ' – ' + (v.to ? CL.fmtDate(CL.addDays(v.to, -1), 'num') : '')]);
  if (pol.policy_no) facts.push(['保单号', pol.policy_no]);
  if (facts.length) h += '<div class="kvs">' + facts.map(function (x) { return '<div class="kv"><span>' + x[0] + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('') + '</div>';
  if (pol.note) h += '<p class="tl-note">' + esc(pol.note) + '</p>';
  h += photoGrid(pol, 4) + fileChips(pol);
  h += '<div class="card-h wrap"><h3 class="card-t sm">本年度的理赔</h3><span class="card-sub">' + v.claims.length + ' 笔' + (v.billed ? ' · 账单合计 ' + esc(m(v.billed)) : '') + (v.pending ? ' · ' + v.pending + ' 笔还没赔下来' : '') + '</span></div>';
  h += v.claims.length ? '<div class="rows">' + v.claims.map(function (c) { return claimRow(c, pol.currency); }).join('') + '</div>' : '<p class="hint">这个年度还没有理赔。</p>';
  h += '<button type="button" class="btn pri wide" data-act="claim-add" data-id="' + esc(pol.id) + '">' + ico('plus') + '记一笔理赔</button>';
  if (v.older.length) h += '<details class="older"><summary>不在本年度的理赔（' + v.older.length + ' 笔）' + ico('chevD', 'sm dim') + '</summary><div class="rows">' + v.older.map(function (c) { return claimRow(c, pol.currency); }).join('') + '</div></details>';
  return h + '</section>';
}

/* ---- 设置 ---- */
function syncLine() {
  if (S.demo) return '演示模式：数据是编的，只存在这台设备上。';
  var st = S.sync.state, n = waiting();
  var s = st === 'auth' ? '口令失效了，需要重新初始化。' : st === 'offline' ? '现在没有网络。' : st === 'err' ? (S.sync.err || '刚才没同步上，稍后会自动重试。') : S.sync.busy ? '正在同步…' : S.sync.at ? '已同步（' + CL.hm(new Date(S.sync.at)) + '）' : '还没同步过';
  return s + (n ? ' 有 ' + n + ' 条改动在这部手机上等着发送。' : '');
}
function viewPrefs(p) {
  var h = '', list = pets(), me = member(S.me), other = member(S.me === 'a' ? 'b' : 'a');
  if (!needsInit() || S.demo) {
    h += '<section class="card"><div class="card-h"><h2 class="card-t">猫咪</h2></div><div class="rows">' + list.map(function (x) {
      return '<button type="button" class="row" data-act="pet-edit" data-id="' + esc(x.id) + '">' + avatar(x, 'sm') + '<span class="row-t"><b>' + esc(x.name) + '</b><small>' + esc([ageLine(x), x.breed].filter(Boolean).join(' · ') || '点开补充资料') + '</small></span>' + ico('chevR', 'sm dim') + '</button>';
    }).join('') + '</div><button type="button" class="btn wide" data-act="pet-add">' + ico('plus') + '再加一只</button></section>';
    h += '<section class="card"><h2 class="card-t">成员</h2><div class="rows"><button type="button" class="row" data-act="me-edit"><i class="who big" style="--mc:' + esc(me.color) + '"></i><span class="row-t"><b>' + esc(me.name) + '</b><small>这部手机 · 点开改名字和颜色</small></span>' + ico('chevR', 'sm dim') + '</button>' +
      '<div class="row static"><i class="who big" style="--mc:' + esc(other.color) + '"></i><span class="row-t"><b>' + esc(other.name) + '</b><small>另一部手机</small></span></div></div></section>';
    h += '<section class="card"><h2 class="card-t">体重单位</h2><div class="seg" role="tablist">' + CL.UNITS.map(function (x) { return '<button type="button" role="tab" aria-selected="' + (unit() === x) + '" class="' + (unit() === x ? 'on' : '') + '" data-act="unit" data-v="' + x + '">' + (x === 'kg' ? '公斤 kg' : '磅 lb') + '</button>'; }).join('') + '</div><p class="hint">两部手机一起换。表格里一律存公斤。</p></section>';
  }
  h += '<section class="card"><h2 class="card-t">外观</h2><div class="seg" role="tablist">' + [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(function (x) { return '<button type="button" role="tab" aria-selected="' + (S.ui.theme === x[0]) + '" class="' + (S.ui.theme === x[0] ? 'on' : '') + '" data-act="theme" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div></section>';
  h += '<section class="card"><h2 class="card-t">连接与数据</h2><p class="hint" id="sync-line">' + esc(syncLine()) + '</p>';
  if (S.demo) h += ENV.preview ? '<p class="hint">这是预览版，只能看演示。正式使用要按部署文档放到 GitHub Pages 上，再连上你自己的 Google 表格。</p><button type="button" class="btn wide" data-act="demo-reset">把演示数据恢复成最初的样子</button>'
    : '<div class="btns"><button type="button" class="btn" data-act="demo-reset">恢复演示数据</button><button type="button" class="btn pri" data-act="demo-off">退出演示</button></div>';
  else if (S.auth) h += '<div class="btns"><button type="button" class="btn" data-act="resync">重新同步全部数据</button><button type="button" class="btn" data-act="reinit">换一条初始化链接</button></div>' +
    '<p class="hint">记录在你们的 Google 表格里，照片和文件在 Google Drive 的「CatLog 猫咪日志」文件夹里，都可以直接打开看。在表格里手工改过内容后，点一下「重新同步全部数据」最保险。</p>';
  h += '</section><p class="about">CatLog 猫咪日志 v' + esc(VERSION) + (S.backend ? ' · 后端 v' + esc(S.backend) : '') + '</p>';
  return h;
}

/* ---- 还没初始化、还没有猫 ---- */
function viewWelcome() {
  var ios = /iPhone|iPad|iPod/.test(navigator.userAgent), alone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  return '<section class="welcome"><div class="logo">' + ico('home') + '</div><h1 class="brand big">CatLog</h1><p class="lead">猫咪日志：体重、日常状态、疫苗、照片和文件，两个人一起记、一起看。</p>' +
    '<div class="card"><h2 class="card-t">粘贴初始化链接</h2><p class="hint">链接由表格里的菜单「CatLog → 生成初始化链接」生成，每人一条。' + (ios && alone ? '主屏幕上的 App 和 Safari 不共用数据，所以这里要再粘贴一次。' : '') + '</p>' +
    '<textarea id="init-text" class="inp" rows="3" placeholder="https://…#init=…" autocapitalize="off" autocomplete="off" spellcheck="false" aria-label="初始化链接"></textarea><p class="err" id="init-err" role="alert"></p>' +
    '<button type="button" class="btn pri wide" data-act="init-paste">开始使用</button></div>' +
    '<button type="button" class="btn wide" data-act="demo-on">先看看演示</button>' +
    (ios && !alone ? '<p class="hint center">想像 App 一样用：点 Safari 底部的分享按钮，选「添加到主屏幕」。</p>' : '') + '<p class="about">v' + esc(VERSION) + '</p></section>';
}
function viewFirstPet() {
  return '<section class="welcome"><div class="logo">' + ico('home') + '</div><h1 class="brand big">CatLog</h1><p class="lead">' + (S.sync.state === 'ok' || S.demo ? '连上了。先添加你们的猫。' : esc(syncLine())) + '</p>' +
    '<button type="button" class="btn pri wide" data-act="pet-add">' + ico('plus') + '添加第一只猫</button><button type="button" class="btn wide" data-act="go" data-tab="prefs">设置</button></section>';
}

/* ---- 画完页面以后要做的事 ---- */
var chartApi = null;
function afterRender(p) {
  var host = $('#wchart');
  chartApi = null;
  if (host && p) {
    var from = rangeFrom(), ws = CL.weights(S.T, p.id);
    if (from) ws = ws.filter(function (w) { return w.date >= from; });
    chartApi = Charts.weight(host, ws, { CL: CL, unit: unit(), birthday: p.birthday });
  }
}

/* ---------- 50-sheets：从下面滑上来的面板、表单、看大图 ---------- */
var SHEET = null;
function openSheet(o) {
  // o: { title, body, save: 按钮文字（null 表示只有「关闭」）, onSave, onClose }
  SHEET = o;
  o.added = [];
  var root = $('#sheet-root');
  root.innerHTML = '<div class="sheet-bg" data-act="sheet-close"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '" tabindex="-1">' +
    '<div class="sheet-h"><button type="button" class="link" data-act="sheet-close">' + (o.save === null ? '关闭' : '取消') + '</button><b>' + esc(o.title) + '</b>' +
    (o.save === null ? '<span class="sheet-sp"></span>' : '<button type="button" class="link strong" data-act="sheet-save">' + esc(o.save || '保存') + '</button>') + '</div>' +
    '<div class="sheet-b" id="sheet-b"><p class="err" id="sheet-err" role="alert"></p>' + o.body + '</div></div>';
  document.body.classList.add('modal');
  hydrate(root);
  var sh = $('.sheet', root), af = $('[data-focus]', root);
  setTimeout(function () {
    if (SHEET !== o) return;
    var cur = document.activeElement;
    if (cur && root.contains(cur) && /^(INPUT|TEXTAREA)$/.test(cur.tagName)) return;      // 人已经点进别的格子了，就不抢
    if (af && !/iPhone|iPad|iPod/.test(navigator.userAgent)) af.focus(); else sh.focus();
  }, 30);
}
function closeSheet(saved) {
  var o = SHEET;
  SHEET = null;
  $('#sheet-root').innerHTML = '';
  document.body.classList.remove('modal');
  if (o && o.added.length) {       // 这次选的照片里，最后没用上的：还没传的不传了，已经传上去的删掉
    var keep = saved && o.keep ? o.keep : [], dropped = false;
    o.added.forEach(function (id) {
      if (keep.indexOf(id) >= 0) return;
      if (S.pend[id]) { dropPend(id); dropped = true; } else if (S.T.media[id] && !mediaUsedElsewhere(id, null)) del('media', id);
    });
    if (dropped) { rebuild(); paintSync(); }
  }
  if (o && o.onClose) o.onClose();
}
function formErr(msg) { var el = $('#sheet-err'); if (el) { el.textContent = msg; el.scrollIntoView({ block: 'nearest' }); } return false; }

/* ---- 表单的零件 ---- */
function fText(k, label, v, o) {
  o = o || {};
  return '<label class="f"><span class="f-l">' + esc(label) + '</span><input class="inp" id="f-' + k + '" data-k="' + k + '" type="text" value="' + esc(v == null ? '' : v) + '"' +
    (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + ' maxlength="' + (o.max || 60) + '"' + (o.mode ? ' inputmode="' + o.mode + '"' : '') + (o.focus ? ' data-focus' : '') + (o.list && o.list.length ? ' list="dl-' + k + '"' : '') + ' autocomplete="off">' +
    (o.list && o.list.length ? '<datalist id="dl-' + k + '">' + o.list.map(function (x) { return '<option value="' + esc(x) + '"></option>'; }).join('') + '</datalist>' : '') + (o.hint ? '<small class="f-h">' + esc(o.hint) + '</small>' : '') + '</label>';
}
function fArea(k, label, v, o) {
  o = o || {};
  return '<label class="f"><span class="f-l">' + esc(label) + '</span><textarea class="inp" id="f-' + k + '" data-k="' + k + '" rows="' + (o.rows || 2) + '" maxlength="' + (o.max || 2000) + '"' + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + '>' + esc(v == null ? '' : v) + '</textarea></label>';
}
function fDate(k, label, v, o) {
  o = o || {};
  return '<label class="f"><span class="f-l">' + esc(label) + '</span><input class="inp" id="f-' + k + '" data-k="' + k + '" type="date" value="' + esc(v || '') + '"' + (o.max ? ' max="' + o.max + '"' : '') + (o.min ? ' min="' + o.min + '"' : '') + '>' + (o.hint ? '<small class="f-h">' + esc(o.hint) + '</small>' : '') + '</label>';
}
// opts: [[值, 说法, 附加的样式]]；multi 多选；none 可以一个都不选
function fChips(k, label, opts, v, o) {
  o = o || {};
  var on = Array.isArray(v) ? v.map(String) : [String(v == null ? '' : v)];
  return '<div class="f"><span class="f-l" id="l-' + k + '">' + esc(label) + '</span><div class="chips" role="group" aria-labelledby="l-' + k + '" data-k="' + k + '"' + (o.multi ? ' data-multi' : '') + (o.none ? ' data-none' : '') + '>' + opts.map(function (x) {
    return '<button type="button" class="chip' + (x[2] ? ' ' + x[2] : '') + '" data-act="chip" data-v="' + esc(x[0]) + '" aria-pressed="' + (on.indexOf(String(x[0])) >= 0) + '">' + esc(x[1]) + '</button>';
  }).join('') + '</div>' + (o.hint ? '<small class="f-h">' + esc(o.hint) + '</small>' : '') + '</div>';
}
function fToggle(k, label, on, hint) {
  return '<label class="f tog"><span class="f-l">' + esc(label) + (hint ? '<small class="f-h">' + esc(hint) + '</small>' : '') + '</span><input type="checkbox" class="sw" id="f-' + k + '" data-k="' + k + '"' + (on ? ' checked' : '') + '></label>';
}
function mediaInner(ids, mode, max) {
  var h = ids.map(function (id) {
    var m = S.T.media[id];
    if (!m) return '';
    return m.kind === 'img'
      ? '<span class="me-i"><img data-mid="' + esc(id) + '" alt=""><button type="button" class="me-x" data-act="media-del" data-id="' + esc(id) + '" aria-label="去掉这张照片">' + ico('x', 'xs') + '</button></span>'
      : '<span class="me-f">' + ico('doc', 'sm') + '<em>' + esc(m.name) + '</em><button type="button" class="me-x" data-act="media-del" data-id="' + esc(id) + '" aria-label="去掉这个文件">' + ico('x', 'xs') + '</button></span>';
  }).join('');
  if (ids.length < (max || 12)) h += '<button type="button" class="me-add" data-act="media-add">' + ico(mode === 'photo' ? 'moment' : 'clip') + '<span>' + (mode === 'photo' ? (max === 1 ? '选照片' : '加照片') : '加照片或文件') + '</span></button>';
  return h;
}
function fMedia(k, label, ids, mode, max) {
  ids = (ids || []).filter(function (id) { return S.T.media[id]; });
  return '<div class="f"><span class="f-l">' + esc(label) + '</span><div class="media-edit" data-k="' + k + '" data-mode="' + mode + '" data-max="' + (max || 12) + '" data-ids="' + esc(ids.join(',')) + '">' + mediaInner(ids, mode, max) + '</div>' +
    (mode === 'doc' ? '<small class="f-h">拍照、相册里的图片或 PDF 都可以，单个文件不超过 12 MB。</small>' : '') + '</div>';
}
function fGet(k) {
  var el = $('#sheet-b [data-k="' + k + '"]');
  if (!el) return undefined;
  if (el.classList.contains('chips')) {
    var on = $$('[aria-pressed="true"]', el).map(function (b) { return b.getAttribute('data-v'); });
    return el.hasAttribute('data-multi') ? on : (on.length ? on[0] : '');
  }
  if (el.type === 'checkbox') return el.checked;
  if (el.classList.contains('media-edit')) return (el.getAttribute('data-ids') || '').split(',').filter(Boolean);
  return el.value;
}
function delBtn(text) { return '<button type="button" class="btn danger wide" data-act="form-del">' + ico('trash') + esc(text || '删除这条记录') + '</button>'; }
// 这个文件除了 row 以外还有没有别的地方在用
// 这个文件除了 row（或者 skip 里的那几行）以外，还有没有别的记录在用
function mediaUsedElsewhere(id, row, skip) {
  var used = false;
  ['entries', 'shots', 'docs', 'policies', 'claims'].forEach(function (t) { CL.vals(S.T[t]).forEach(function (r) { if (r.id !== (row && row.id) && !(skip && skip[r.id]) && r.media.indexOf(id) >= 0) used = true; }); });
  CL.vals(S.T.pets).forEach(function (p) { if (p.avatar === id && !(row && row.id === p.id)) used = true; });
  return used;
}
function dropUnused(oldIds, newIds, row) {
  (oldIds || []).forEach(function (id) { if (newIds.indexOf(id) < 0 && !mediaUsedElsewhere(id, row)) removeMedia(id); });
}
function pastValues(table, pick) {     // 以前填过的内容，给输入框做候选
  var seen = CL.map(), out = [];
  CL.vals(S.T[table]).sort(function (a, b) { return a.date < b.date ? 1 : -1; }).forEach(function (r) { var v = pick(r); if (v && !seen['$' + v] && out.length < 12) { seen['$' + v] = 1; out.push(v); } });
  return out;
}

/* ---- 各种记录的表单 ---- */
var FORM_TITLE = { weight: '体重', food: '饮食', activity: '活动和护理', health: '健康事件', moment: '照片和瞬间' };
function entryForm(kind, e, preset) {      // preset：新增时预先选好的内容（比如从护理板点进来，已经知道是剪指甲）
  var p = pet(), d = e ? e.data : (preset || {}), u = unit(), h = '';
  if (!p) return;
  if (kind === 'weight') {
    var ws = CL.weights(S.T, p.id), last = ws.length ? ws[ws.length - 1] : null;
    h += '<label class="f"><span class="f-l">体重（' + u + '）</span><input class="inp big num" id="f-kg" data-k="kg" type="text" inputmode="decimal" autocomplete="off" data-focus value="' + (e ? CL.fmtWeight(d.kg, u) : '') + '" placeholder="' + (last ? CL.fmtWeight(last.kg, u) : u === 'kg' ? '4.20' : '9.30') + '">' +
      (last && !e ? '<small class="f-h">上次 ' + CL.fmtWeight(last.kg, u) + ' ' + u + '（' + esc(CL.relDay(last.date, S.today)) + '）</small>' : '') + '</label>';
  } else if (kind === 'food') {
    h += fChips('type', '吃的是', CL.FOOD, e ? d.type : 'dry') + fText('name', '名字', d.name, { ph: '比如：鸡肉成猫粮', list: pastValues('entries', function (r) { return r.kind === 'food' && r.data.name; }) }) +
      fText('amount', '分量', d.amount, { ph: '比如：每天 60 g、半罐', max: 30 }) + fToggle('change', '这是一次换粮', d.change, '换粮会在时间轴上标出来，方便回头对照肠胃反应');
  } else if (kind === 'activity') {
    h += fChips('type', '做了什么', CL.ACT, d.type || 'wand') + fText('mins', '多久（分钟）', d.mins || '', { mode: 'numeric', max: 4, ph: '可以不填' });
  } else if (kind === 'health') {
    h += fChips('type', '类型', CL.HEALTH, e ? d.type : 'symptom') + fText('title', '什么事', d.title, { ph: '比如：软便、打喷嚏、年度体检', focus: !e }) +
      fChips('sev', '程度', CL.SEV, d.sev || '', { none: true }) + fChips('status', '现在', [['open', '还在观察或治疗'], ['done', '已经好了']], e ? d.status : 'open') +
      fText('clinic', '医院或医生', d.clinic, { ph: '可以不填', list: pastValues('entries', function (r) { return r.kind === 'health' && r.data.clinic; }) }) + fDate('follow', '复查日期', d.follow, { hint: '填了的话，快到时首页会提醒' });
  } else if (kind === 'moment') {
    h += fMedia('media', '照片', e ? e.media : [], 'photo') + fArea('note', '写点什么', e ? e.note : '', { ph: '今天发生了什么', rows: 3 }) +
      fToggle('star', '标成里程碑', d.star, '第一次洗澡、一岁生日这类值得记住的日子') + fText('title', '里程碑的名字', d.title, { ph: '比如：第一次上猫爬架', max: 40 });
  }
  h += fDate('date', '日期', e ? e.date : S.today, { max: S.today });
  if (kind !== 'moment') h += fArea('note', '备注', e ? e.note : '', { ph: '可以不填' }) + fMedia('media', kind === 'health' ? '照片和文件' : '照片', e ? e.media : [], kind === 'health' ? 'doc' : 'photo');
  if (e) h += delBtn();
  openSheet({ title: (e ? '修改' : '记') + FORM_TITLE[kind], body: h, onSave: function () { return saveEntry(kind, e); }, onDel: e ? function () { removeRow('entries', e); } : null });
}
function saveEntry(kind, e) {
  var p = pet(), date = fGet('date'), data = {}, media = fGet('media') || [], note = fGet('note');
  if (!CL.isYmd(date)) return formErr('请选一个日期。');
  if (date > S.today) return formErr('日期不能是将来。');
  if (kind === 'weight') {
    var kg = CL.parseWeight(fGet('kg'), unit());
    if (kg == null) return formErr('体重要填一个数字，比如 ' + (unit() === 'kg' ? '4.25' : '9.4') + '。');
    data.kg = kg;
  } else if (kind === 'food') data = { type: fGet('type'), name: fGet('name'), amount: fGet('amount'), change: fGet('change') };
  else if (kind === 'activity') {
    var mins = String(fGet('mins') || '').trim();
    if (mins && !/^\d{1,4}$/.test(mins)) return formErr('时间填分钟数，比如 15。');
    data = { type: fGet('type'), mins: mins ? +mins : null };
  } else if (kind === 'health') {
    data = { type: fGet('type'), title: fGet('title'), sev: fGet('sev') || null, clinic: fGet('clinic'), status: fGet('status') || 'open', follow: fGet('follow') };
    if (!String(data.title).trim()) return formErr('写一下是什么事。');
  } else if (kind === 'moment') {
    data = { title: fGet('title'), star: fGet('star') };
    if (!media.length && !String(note).trim() && !String(data.title).trim()) return formErr('加一张照片，或者写点什么。');
    if (data.star && !String(data.title).trim()) return formErr('给这个里程碑起个名字。');
  }
  var time = e ? (e.date === date ? e.time : '') : (date === S.today ? CL.hm() : '');      // 补记以前的日子：不知道是几点，就不写
  var row = CL.clean.entries({ id: e ? e.id : CL.newId(), pet_id: e ? e.pet_id : p.id, kind: kind, date: date, time: time, data: data, note: note, media: media,
    created_by: e ? e.created_by : S.me, created_at: e ? e.created_at : nowIso() });
  if (!row) return formErr('有内容填得不对，检查一下。');
  put('entries', row);
  if (e) dropUnused(e.media, row.media, row);
  SHEET.keep = row.media;
  closeSheet(true); render();
  toast(e ? '改好了' : '记下了', e ? {} : { undo: function () { del('entries', row.id); render(); } });
  return true;
}
// 删除一行，带撤销。它带的照片和文件（别处没在用的、已经传上去的）一起删，撤销时一起回来
function removeRow(table, row) {
  var gone = (row.media || []).filter(function (id) { return S.T.media[id] && !S.pend[id] && !mediaUsedElsewhere(id, row); }).map(function (id) { return S.T.media[id]; });
  del(table, row.id);
  gone.forEach(function (m) { del('media', m.id); });
  closeSheet(true); render();
  toast('删掉了', { undo: function () { gone.forEach(function (m) { undel('media', m); }); undel(table, row); render(); } });
}

/* ---- 某一天的日常状态 ---- */
function daySheet(date) {
  var p = pet();
  if (!p || !CL.isYmd(date) || date > S.today) return;
  var e = S.T.entries[CL.dailyId(p.id, date)], d = e ? e.data : {}, h = '';
  h += '<div class="btns"><button type="button" class="btn" data-act="day-fill">' + ico('check') + '没选的都算正常</button></div>';
  CL.DAILY.forEach(function (f) {
    h += fChips(f.k, f.label, f.opts.map(function (o) { return [o.v, o.l, 's' + o.s]; }), d[f.k] == null ? '' : d[f.k], { none: true });
  });
  h += fChips('flags', '其他状况', CL.FLAGS, d.flags || [], { multi: true, none: true }) + fArea('note', '备注', e ? e.note : '', { ph: '可以不填' });
  if (e) h += delBtn('删除这一天的记录');
  var others = CL.entriesOf(S.T, p.id).filter(function (x) { return x.date === date && x.kind !== 'daily'; });
  if (others.length) h += '<div class="f"><span class="f-l">这一天的其他记录</span><div class="tl-list">' + others.map(function (x) { return tlItem({ t: 'entry', kind: x.kind, id: x.id, row: x }, { deltas: {} }); }).join('') + '</div></div>';
  openSheet({ title: CL.fmtDate(date) + ' ' + WDS[CL.weekday(date)] + (date === S.today ? '（今天）' : ''), body: h, onSave: function () { return saveDay(date, e); }, onDel: e ? function () { removeRow('entries', e); } : null });
}
function saveDay(date, e) {
  var p = pet(), data = { flags: fGet('flags') || [] }, any = data.flags.length > 0, note = fGet('note');
  CL.DAILY.forEach(function (f) { var v = fGet(f.k); if (v !== '' && v != null) { data[f.k] = +v; any = true; } });
  if (!any && !String(note).trim()) { if (e) { removeRow('entries', e); return true; } closeSheet(true); return true; }
  if (!any) return formErr('至少选一项状态。只想写字的话，可以记成「照片和瞬间」。');
  putDaily(p, date, data, note, e);
  closeSheet(true); render();
  toast('记下了');
  return true;
}
function putDaily(p, date, data, note, e) {
  var row = CL.clean.entries({ id: CL.dailyId(p.id, date), pet_id: p.id, kind: 'daily', date: date, time: date === S.today ? CL.hm() : (e ? e.time : ''), data: data, note: note || '',
    media: e ? e.media : [], created_by: e ? e.created_by : S.me, created_at: e ? e.created_at : nowIso() });
  if (row) put('entries', row);
  return row;
}

/* ---- 疫苗和驱虫 ---- */
function shotForm(kind, s, presetCode) {
  var p = pet();
  if (!p) return;
  var presets = CL.presets(p.species, kind), pre = presets.filter(function (x) { return x.code === (s ? s.code : presetCode); })[0], isV = kind === 'vaccine', h = '';
  var name = s ? s.name : pre ? pre.name : '';
  h += '<div class="f"><span class="f-l">' + (isV ? '哪种疫苗' : '哪种驱虫') + '</span><div class="chips" data-presets>' + presets.map(function (x) {
    return '<button type="button" class="chip" data-act="preset" data-v="' + esc(x.name) + '" aria-pressed="' + (name === x.name) + '">' + esc(x.name) + (x.en ? ' <small>' + esc(x.en) + '</small>' : '') + '</button>';
  }).join('') + '</div><input class="inp" id="f-name" data-k="name" type="text" maxlength="40" value="' + esc(name) + '" placeholder="' + (isV ? '或者直接写名字' : '或者直接写名字，比如：体内驱虫') + '" autocomplete="off" aria-label="名称"></div>';
  h += fDate('date', isV ? '接种日期' : '驱虫日期', s ? s.date : S.today, { max: S.today });
  h += '<div class="f"><span class="f-l">下次</span><input class="inp" id="f-next_due" data-k="next_due" type="date" value="' + esc(s ? s.next_due : '') + '" aria-label="下次的日期"><div class="chips steps">' + CL.STEPS[kind].map(function (x) {
    return '<button type="button" class="chip" data-act="step" data-m="' + x[1] + '" data-d="' + x[2] + '">' + esc(x[0]) + '</button>';
  }).join('') + '<button type="button" class="chip" data-act="step" data-clear>不填</button></div><small class="f-h">点一下按' + (isV ? '接种' : '驱虫') + '日期往后推。以医生给的日期为准。</small></div>';
  if (isV) h += fText('dose', '第几针', s ? s.dose : '', { ph: '可以不填', max: 30, list: ['第 1 针', '第 2 针', '第 3 针', '加强'] });
  h += fText('product', isV ? '品牌' : '用的什么', s ? s.product : '', { ph: '可以不填', list: pastValues('shots', function (r) { return r.kind === kind && r.product; }) });
  if (isV) h += fText('lot', '批号', s ? s.lot : '', { ph: '疫苗本上的贴纸，可以不填', max: 40 });
  h += fText('clinic', '医院', s ? s.clinic : '', { ph: '可以不填', list: pastValues('shots', function (r) { return r.clinic; }) }) + fArea('note', '备注', s ? s.note : '', { ph: '比如：打完有点蔫，第二天恢复' }) +
    fMedia('media', isV ? '疫苗本或证明' : '照片和文件', s ? s.media : [], 'doc');
  if (s) h += delBtn();
  openSheet({ title: (s ? '修改' : '记') + (isV ? '疫苗' : '驱虫'), body: h, onSave: function () { return saveShot(kind, s); }, onDel: s ? function () { removeRow('shots', s); } : null });
}
function saveShot(kind, s) {
  var p = pet(), name = String(fGet('name') || '').trim(), date = fGet('date'), next = fGet('next_due');
  if (!name) return formErr('选一种，或者写上名字。');
  if (!CL.isYmd(date)) return formErr('请选日期。');
  if (date > S.today) return formErr('日期不能是将来。还没打的，等打完再记。');
  if (next && !CL.isYmd(next)) return formErr('下次的日期不对。');
  if (next && next <= date) return formErr('下次的日期要晚于这一次。');
  var pre = CL.presets(p.species, kind).filter(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })[0];
  var row = CL.clean.shots({ id: s ? s.id : CL.newId(), pet_id: s ? s.pet_id : p.id, kind: kind, name: pre ? pre.name : name, code: pre ? pre.code : '', date: date, next_due: next || '',
    dose: fGet('dose') || '', product: fGet('product'), lot: fGet('lot') || '', clinic: fGet('clinic'), note: fGet('note'), media: fGet('media') || [],
    created_by: s ? s.created_by : S.me, created_at: s ? s.created_at : nowIso() });
  if (!row) return formErr('有内容填得不对，检查一下。');
  put('shots', row);
  if (s) dropUnused(s.media, row.media, row);
  SHEET.keep = row.media;
  closeSheet(true); render();
  toast(s ? '改好了' : '记下了', s ? {} : { undo: function () { del('shots', row.id); render(); } });
  return true;
}
// 点状态板上的一行：看这种疫苗的历次记录
function shotKeySheet(kind, key) {
  var p = pet(), row = CL.shotBoard(S.T, p, kind, S.today).filter(function (r) { return r.key === key; })[0];
  if (!row) return;
  var h = '<div class="shot st-' + row.state + ' flat"><span class="shot-main"><b>' + esc(row.name) + (row.en ? ' <small>' + esc(row.en) + '</small>' : '') + '</b><span class="shot-l next">' +
    esc(row.state === 'none' ? '还没有记录' : row.state === 'done' ? '最近一次没有填下次的日期' : '下次 ' + CL.fmtDate(row.next, 'ymd') + ' · ' + CL.dueText(row.days)) + '</span></span>' + stampSvg(row.state) + '</div>';
  h += row.list.length ? '<div class="rows">' + row.list.map(shotRowHtml).join('') + '</div>' : '<p class="hint">打过的话，把以前的也补上，日期按疫苗本上的填。</p>';
  h += '<button type="button" class="btn pri wide" data-act="add" data-kind="' + kind + '" data-code="' + esc(row.code) + '" data-name="' + esc(row.code ? '' : row.name) + '">' + ico('plus') + (kind === 'vaccine' ? '记一针' : '记一次') + '</button>';
  openSheet({ title: row.name, body: h, save: null });
}

/* ---- 文件 ---- */
function docForm(d) {
  var p = pet(), h = '';
  h += fMedia('media', '文件', d ? d.media : [], 'doc') + fText('title', '叫什么', d ? d.title : '', { ph: '比如：疫苗本、2026 年体检报告' }) + fChips('category', '分类', CL.DOC_CATS, d ? d.category : 'vaccine') +
    fDate('date', '文件上的日期', d ? d.date : S.today, { max: S.today, hint: '可以不填' }) + fArea('note', '备注', d ? d.note : '', { ph: '可以不填' });
  if (pets().length > 1) h += fToggle('shared', '所有猫共用', d ? !d.pet_id : false, '比如领养合同、保险单');
  if (d) h += delBtn('删除这份文件');
  openSheet({ title: d ? '修改文件' : '上传文件', body: h, onSave: function () { return saveDoc(d, p); }, onDel: d ? function () { removeRow('docs', d); } : null });
}
function saveDoc(d, p) {
  var media = fGet('media') || [], title = String(fGet('title') || '').trim(), date = fGet('date');
  if (!media.length) return formErr('先选文件：拍照、相册里的图片或 PDF。');
  if (!title) { var m = S.T.media[media[0]]; title = m && m.kind === 'file' ? m.name.replace(/\.[^.]*$/, '') : ''; }
  if (!title) return formErr('给这份文件起个名字。');
  if (date && !CL.isYmd(date)) return formErr('日期不对。');
  var row = CL.clean.docs({ id: d ? d.id : CL.newId(), pet_id: fGet('shared') ? '' : (d && d.pet_id ? d.pet_id : p.id), title: title, category: fGet('category') || 'other', date: date || '', note: fGet('note'), media: media,
    created_by: d ? d.created_by : S.me, created_at: d ? d.created_at : nowIso() });
  if (!row) return formErr('有内容填得不对，检查一下。');
  put('docs', row);
  if (d) dropUnused(d.media, row.media, row);
  SHEET.keep = row.media;
  closeSheet(true);
  S.ui.seg = 'docs'; render();
  toast(d ? '改好了' : '传上去了' + (Object.keys(S.pend).length ? '，正在后台上传' : ''), d ? {} : { undo: function () { del('docs', row.id); render(); } });
  return true;
}
function metaLine(r) {
  var by = r.created_by ? whoDot(r.created_by) + esc(whoName(r.created_by)) + ' 记于 ' + esc((r.created_at || '').slice(0, 10).replace(/-/g, '/')) : '';
  if (r.updated_by && r.updated_at && r.updated_at !== r.created_at && r.updated_by !== r.created_by) by += ' · ' + esc(whoName(r.updated_by)) + ' 改过';
  return by ? '<p class="meta">' + by + '</p>' : '';
}
function bigMedia(row) {
  var imgs = CL.images(S.T, row);
  return (imgs.length ? '<div class="ph-big n' + Math.min(imgs.length, 3) + '">' + imgs.map(function (id, i) {
    return '<button type="button" class="ph" data-act="view" data-ids="' + esc(imgs.join(',')) + '" data-i="' + i + '" aria-label="看大图"><img data-mid="' + esc(id) + '"' + (imgs.length === 1 ? ' data-full' : '') + ' alt="">' + (S.pend[id] ? '<i class="ph-tag">待上传</i>' : '') + '</button>';
  }).join('') + '</div>' : '') + fileChips(row);
}
function docSheet(id) {
  var d = S.T.docs[id];
  if (!d) return;
  var h = '<div class="detail"><div class="pills"><span class="pill">' + esc(CL.label(CL.DOC_CATS, d.category)) + '</span>' + (d.date ? '<span class="pill">' + esc(CL.fmtDate(d.date, 'ymd')) + '</span>' : '') + (!d.pet_id ? '<span class="pill">所有猫共用</span>' : '') + '</div>' +
    bigMedia(d) + (d.note ? '<p class="tl-note">' + esc(d.note) + '</p>' : '') + metaLine(d) + '</div><div class="btns"><button type="button" class="btn" data-act="doc-edit" data-id="' + esc(d.id) + '">' + ico('edit') + '修改</button></div>';
  openSheet({ title: d.title, body: h, save: null });
}

/* ---- 点开一条记录：先看，再决定改不改 ---- */
function detailSheet(t, id) {
  var r = t === 'shot' ? S.T.shots[id] : S.T.entries[id], p = pet();
  if (!r) return;
  if (t === 'entry' && r.kind === 'daily') return daySheet(r.date);
  var u = unit(), d = r.data || {}, rows = [], title, h;
  function kv(k, v) { if (v) rows.push('<div class="kv"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>'); }
  if (t === 'shot') {
    title = r.name;
    var st = CL.shotStatus(r.next_due, S.today, r.date);
    kv(r.kind === 'vaccine' ? '接种日期' : '驱虫日期', CL.fmtDate(r.date, 'full')); kv('下次', r.next_due ? CL.fmtDate(r.next_due, 'ymd') + '（' + CL.dueText(st.days) + '）' : '');
    kv('第几针', r.dose); kv(r.kind === 'vaccine' ? '品牌' : '用的', r.product); kv('批号', r.lot); kv('医院', r.clinic);
  } else {
    title = FORM_TITLE[r.kind] || '';
    kv('日期', CL.fmtDate(r.date, 'full') + (r.time ? ' ' + r.time : '')); kv('那时', ageAt(p, r.date));
    if (r.kind === 'weight') kv('体重', CL.fmtWeight(d.kg, u) + ' ' + u + (u === 'kg' ? '' : '（' + d.kg.toFixed(2) + ' kg）'));
    if (r.kind === 'food') { kv('吃的是', CL.label(CL.FOOD, d.type) + (d.name ? ' · ' + d.name : '')); kv('分量', d.amount); kv('换粮', d.change ? '是' : ''); }
    if (r.kind === 'activity') { kv('做了什么', CL.label(CL.ACT, d.type)); kv('多久', d.mins ? d.mins + ' 分钟' : ''); }
    if (r.kind === 'health') { title = d.title || title; kv('类型', CL.label(CL.HEALTH, d.type)); kv('程度', d.sev ? CL.label(CL.SEV, d.sev) : ''); kv('现在', d.status === 'open' ? '还在观察或治疗' : '已经好了'); kv('医院或医生', d.clinic); kv('复查日期', d.follow ? CL.fmtDate(d.follow, 'ymd') : ''); }
    if (r.kind === 'moment') { title = d.title || title; kv('里程碑', d.star ? (d.title || '是') : ''); }
  }
  h = '<div class="detail">' + bigMedia(r) + (r.note ? '<p class="tl-note big">' + esc(r.note) + '</p>' : '') + '<div class="kvs">' + rows.join('') + '</div>' + metaLine(r) + '</div>' +
    '<div class="btns"><button type="button" class="btn" data-act="edit" data-t="' + t + '" data-id="' + esc(r.id) + '">' + ico('edit') + '修改</button>' +
    (t === 'entry' && r.kind === 'health' && d.status === 'open' ? '<button type="button" class="btn pri" data-act="health-done" data-id="' + esc(r.id) + '">' + ico('check') + '已经好了</button>' : '') + '</div>';
  openSheet({ title: title, body: h, save: null });
}

/* ---- 猫咪资料、成员 ---- */
function swatches(k, colors, v, banned) {
  return '<div class="f"><span class="f-l" id="l-' + k + '">代表色</span><div class="chips sws" role="group" aria-labelledby="l-' + k + '" data-k="' + k + '">' + colors.map(function (c, i) {
    return '<button type="button" class="sw-c" data-act="chip" data-v="' + c + '" aria-pressed="' + (v === c) + '" aria-label="颜色 ' + (i + 1) + '" style="--c:' + c + '"' + (banned === c ? ' disabled title="对方在用"' : '') + '></button>';
  }).join('') + '</div></div>';
}
function petForm(x) {
  var h = fText('name', '名字', x ? x.name : '', { max: 20, focus: !x, ph: '叫什么' }) + fMedia('avatar', '头像', x && x.avatar ? [x.avatar] : [], 'photo', 1) +
    fChips('species', '是', CL.SPECIES, x ? x.species : 'cat') + fChips('sex', '性别', CL.SEX, x ? x.sex : '', { none: true }) + fChips('neutered', '绝育', [['y', '已绝育'], ['n', '还没有']], x ? x.neutered : '', { none: true }) +
    fDate('birthday', '生日', x ? x.birthday : '', { max: S.today, hint: '不确定就填大概的日子。年龄和月龄相册都按它算' }) + fDate('home_date', '到家的日子', x ? x.home_date : '', { max: S.today }) +
    fText('breed', '品种', x ? x.breed : '', { max: 30, ph: '可以不填' }) + fText('coat', '毛色', x ? x.coat : '', { max: 30, ph: '可以不填' }) + fText('chip', '芯片号', x ? x.chip : '', { max: 40, mode: 'numeric', ph: '可以不填' }) +
    swatches('color', CL.PET_COLORS, x ? x.color : CL.PET_COLORS[pets().length % CL.PET_COLORS.length]) + fArea('note', '备注', x ? x.note : '', { ph: '过敏、习惯、怕什么', max: 500 });
  if (x) h += '<button type="button" class="btn danger wide" data-act="pet-del" data-id="' + esc(x.id) + '">' + ico('trash') + '删除这只猫的资料</button>';
  openSheet({ title: x ? '修改资料' : '添加猫咪', body: h, onSave: function () { return savePet(x); } });
}
function savePet(x) {
  var name = String(fGet('name') || '').trim(), b = fGet('birthday'), hd = fGet('home_date'), av = fGet('avatar') || [];
  if (!name) return formErr('先起个名字。');
  if (b && (!CL.isYmd(b) || b > S.today)) return formErr('生日不对。');
  if (hd && (!CL.isYmd(hd) || hd > S.today)) return formErr('到家的日子不对。');
  if (b && hd && hd < b) return formErr('到家的日子不能早于生日。');
  var row = CL.clean.pets({ id: x ? x.id : CL.newId(), name: name, species: fGet('species') || 'cat', sex: fGet('sex'), neutered: fGet('neutered'), birthday: b || '', home_date: hd || '', breed: fGet('breed'), coat: fGet('coat'),
    chip: fGet('chip'), color: fGet('color'), avatar: av[0] || '', note: fGet('note'), sort: x ? x.sort : pets().length, created_by: x ? x.created_by : S.me, created_at: x ? x.created_at : nowIso() });
  if (!row) return formErr('有内容填得不对，检查一下。');
  put('pets', row);
  if (x && x.avatar && x.avatar !== row.avatar && !mediaUsedElsewhere(x.avatar, row)) removeMedia(x.avatar);
  if (!x) { S.ui.pet = row.id; saveUi(); }
  SHEET.keep = row.avatar ? [row.avatar] : [];
  closeSheet(true);
  if (!x && S.tab === 'prefs') S.tab = 'home';
  render();
  toast(x ? '改好了' : name + '加进来了');
  return true;
}
function petMenu() {
  var list = pets(), cur = pet();
  var h = '<div class="rows">' + list.map(function (x) {
    return '<button type="button" class="row" data-act="pet-pick" data-id="' + esc(x.id) + '"' + (cur && cur.id === x.id ? ' aria-current="true"' : '') + '>' + avatar(x, 'sm') + '<span class="row-t"><b>' + esc(x.name) + '</b><small>' + esc([ageLine(x), x.breed].filter(Boolean).join(' · ')) + '</small></span>' + (cur && cur.id === x.id ? ico('check', 'sm') : '') + '</button>';
  }).join('') + '</div><div class="btns"><button type="button" class="btn" data-act="pet-edit" data-id="' + esc(cur.id) + '">' + ico('edit') + '修改' + esc(cur.name) + '的资料</button><button type="button" class="btn" data-act="pet-add">' + ico('plus') + '再加一只</button></div>';
  if (cur.chip || cur.coat || cur.note || cur.home_date) h += '<div class="kvs">' + [['到家', cur.home_date ? CL.fmtDate(cur.home_date, 'ymd') : ''], ['生日', cur.birthday ? CL.fmtDate(cur.birthday, 'ymd') : ''], ['毛色', cur.coat], ['绝育', cur.neutered === 'y' ? '已绝育' : cur.neutered === 'n' ? '还没有' : ''], ['芯片号', cur.chip], ['备注', cur.note]]
    .filter(function (x) { return x[1]; }).map(function (x) { return '<div class="kv"><span>' + x[0] + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('') + '</div>';
  openSheet({ title: '猫咪', body: h, save: null });
}
var MEMBER_SWATCH = ['#2a78d6', '#eb6834', '#1baf7a', '#6250d6', '#e87ba4', '#eda100'];
function meForm() {
  var me = member(S.me), other = member(S.me === 'a' ? 'b' : 'a');
  openSheet({ title: '我的名字和颜色', body: fText('name', '名字', me.name, { max: 16, focus: true }) + swatches('color', MEMBER_SWATCH, me.color, other.color) + '<p class="hint">名字和颜色用来标出每条记录是谁记的。只能改自己的。</p>', onSave: function () {
    var name = String(fGet('name') || '').trim(), color = fGet('color') || me.color;
    if (!name) return formErr('名字不能空着。');
    if (color === other.color) return formErr('这个颜色对方在用，换一个。');
    put('members', CL.clean.members({ id: S.me, name: name, color: color }));
    closeSheet(true); render(); toast('改好了');
    return true;
  } });
}
function addMenu() {
  var items = [['weight', '体重'], ['day', '今日状态'], ['moment', '照片和瞬间'], ['food', '饮食'], ['activity', '活动和护理'], ['health', '健康事件'], ['vaccine', '疫苗'], ['deworm', '驱虫'], ['doc', '文件']];
  openSheet({ title: '添加', save: null, body: '<div class="addgrid">' + items.map(function (x) {
    return '<button type="button" class="qbtn" data-act="' + (x[0] === 'day' ? 'day' : 'add') + '" data-kind="' + x[0] + '" data-date="' + S.today + '">' + kico(x[0] === 'day' ? 'daily' : x[0]) + '<span>' + x[1] + '</span></button>';
  }).join('') + '</div>' });
}

/* ---- 护理：某一种护理的记录和「多久做一次」 ---- */
function careSheet(type) {
  var p = pet();
  if (!p) return;
  var c = CL.careBoard(S.T, p, S.today).filter(function (x) { return x.type === type; })[0];
  if (!c) return;
  var hist = CL.careHistory(S.T, p.id, type), custom = c.every != null && CL.CARE_EVERY.indexOf(c.every) < 0;
  var opts = [['', '不提醒']].concat(CL.CARE_EVERY.map(function (d) { return [String(d), d === 1 ? '每天' : d === 7 ? '每周' : d === 14 ? '每两周' : d === 30 ? '每月' : d === 90 ? '每三个月' : '每 ' + d + ' 天']; }));
  if (custom) opts.push([String(c.every), '每 ' + c.every + ' 天']);
  var h = '<div class="care flat st-' + c.state + '"><span class="care-main"><span class="shot-l big">' + esc(careLine(c)) + '</span>' + (c.every != null ? '<span class="shot-l next">' + (c.state === 'due' ? ico('alert', 'xs') : '') + esc(careNext(c)) + '</span>' : '') + '</span></div>';
  h += '<div class="btns">' + (c.last && c.days === 0 ? '' : '<button type="button" class="btn pri" data-act="care-done" data-type="' + type + '">' + ico('check') + '今天做了</button>') +
    '<button type="button" class="btn" data-act="care-past" data-type="' + type + '">补记以前的一次</button></div>';
  h += '<div class="f"><span class="f-l" id="l-every">多久做一次</span><div class="chips" role="group" aria-labelledby="l-every">' + opts.map(function (x) {
    return '<button type="button" class="chip" data-act="care-every" data-type="' + type + '" data-v="' + x[0] + '" aria-pressed="' + ((c.every == null ? '' : String(c.every)) === x[0]) + '">' + x[1] + '</button>';
  }).join('') + '</div><small class="f-h">定了以后，到时间首页会提醒；不定就只是记着上次是哪天。</small></div>';
  h += '<div class="f"><span class="f-l">记过的' + (hist.length ? '（' + hist.length + ' 次）' : '') + '</span>' + (hist.length ? '<div class="rows">' + hist.slice(0, 30).map(function (e) {
    return '<button type="button" class="row" data-act="open" data-t="entry" data-id="' + esc(e.id) + '"><span class="row-t"><b>' + esc(CL.fmtDate(e.date, 'full')) + '</b><small>' + esc([CL.daysAgo(CL.diffDays(e.date, S.today)), whoName(e.created_by), e.note].filter(Boolean).join(' · ')) + '</small></span>' + ico('chevR', 'sm dim') + '</button>';
  }).join('') + '</div>' : '<p class="hint">还没有记过。</p>') + '</div>';
  openSheet({ title: c.label, body: h, save: null, care: type });
}
function careDone(type) {
  var p = pet();
  if (!p || CL.CARE.indexOf(type) < 0) return;
  var row = CL.clean.entries(stamp({ id: CL.newId(), pet_id: p.id, kind: 'activity', date: S.today, time: CL.hm(), data: { type: type }, note: '', media: [] }));
  put('entries', row);
  var again = SHEET && SHEET.care === type;
  render();
  if (again) careSheet(type);
  toast(CL.label(CL.ACT, type) + '：记成今天了', { undo: function () { del('entries', row.id); render(); if (SHEET && SHEET.care === type) careSheet(type); } });
}

/* ---- 保险 ---- */
function numStr(n) { return n === '' || n == null ? '' : String(n); }
function fMoney(k, label, v, hint, ph) { return fText(k, label, numStr(v), { mode: 'decimal', max: 14, hint: hint, ph: ph || '可以不填' }); }
function policyForm(pol) {
  var p = pet();
  if (!p) return;
  var h = fText('company', '保险公司', pol ? pol.company : '', { max: 40, focus: !pol, ph: '公司的名字' }) + fText('plan', '计划', pol ? pol.plan : '', { max: 40, ph: '比如：意外和疾病。可以不填' }) +
    fText('policy_no', '保单号', pol ? pol.policy_no : '', { max: 40, ph: '可以不填' }) +
    fChips('payer', '谁在付', [['a', member('a').name], ['b', member('b').name], ['both', '一起付']], pol ? pol.payer : '', { none: true }) +
    fMoney('premium', '每月保费', pol ? pol.premium : '') + fChips('currency', '货币', CL.CURRENCIES.map(function (c) { return [c, c]; }), pol ? pol.currency : '$') +
    fMoney('limit_amt', '年度额度', pol ? pol.limit_amt : '', '一年最多赔多少。不限额就空着', '不限额就空着') + fMoney('deductible', '自付额', pol ? pol.deductible : '', '每个保单年度里自己先付的那部分') +
    fText('rate', '赔付比例（%）', pol ? numStr(pol.rate) : '', { mode: 'numeric', max: 3, ph: '比如 80。可以不填' }) +
    fDate('start', '本年度从哪天开始', pol ? pol.start : '', { hint: '保单生效或者上次续保的日子' }) +
    '<div class="f"><span class="f-l">下次续保日</span><input class="inp" id="f-renew" data-k="renew" type="date" value="' + esc(pol ? pol.renew : '') + '" aria-label="下次续保日"><div class="chips steps"><button type="button" class="chip" data-act="renew-step">开始那天的一年后</button></div><small class="f-h">离续保不到 30 天时首页会提醒</small></div>' +
    fMoney('used0', '已经用掉的额度', pol ? pol.used0 : '', '这个年度保险已经赔了多少。每笔理赔都单独记的话，这里空着；不想一笔笔记，就直接填总数') +
    fMoney('ded0', '自付额已经抵掉的', pol ? pol.ded0 : '', '同上：每笔理赔都单独记的话空着') +
    fArea('note', '备注', pol ? pol.note : '', { ph: '比如：理赔怎么提交、客服电话', max: 1000 }) + fMedia('media', '保单文件', pol ? pol.media : [], 'doc');
  if (pol) h += delBtn('删除这份保险');
  openSheet({ title: pol ? '修改保险' : '添加保险', body: h, onSave: function () { return savePolicy(pol, p); }, onDel: pol ? function () { removePolicy(pol); } : null });
}
function savePolicy(pol, p) {
  var company = String(fGet('company') || '').trim(), o = {}, bad = '';
  if (!company) return formErr('写上保险公司的名字。');
  [['premium', '每月保费'], ['limit_amt', '年度额度'], ['deductible', '自付额'], ['used0', '已经用掉的额度'], ['ded0', '自付额已经抵掉的']].forEach(function (x) {
    var v = CL.parseMoney(fGet(x[0]));
    if (v === null && !bad) bad = x[1];
    o[x[0]] = v === null ? '' : v;
  });
  if (bad) return formErr('「' + bad + '」填数字，比如 250 或 38.50。');
  var rate = String(fGet('rate') || '').trim().replace(/%$/, '');
  if (rate && (!/^\d{1,3}$/.test(rate) || +rate > 100)) return formErr('赔付比例填 0 到 100 之间的整数，比如 80。');
  var start = fGet('start'), renew = fGet('renew');
  if (start && !CL.isYmd(start)) return formErr('开始的日期不对。');
  if (renew && !CL.isYmd(renew)) return formErr('续保日不对。');
  if (start && renew && renew <= start) return formErr('续保日要晚于开始的那天。');
  if (o.deductible !== '' && o.ded0 !== '' && o.ded0 > o.deductible) return formErr('已经抵掉的不能比自付额还多。');
  var row = CL.clean.policies(Object.assign(o, { id: pol ? pol.id : CL.newId(), pet_id: pol ? pol.pet_id : p.id, company: company, plan: fGet('plan'), policy_no: fGet('policy_no'), payer: fGet('payer'), currency: fGet('currency') || '$',
    rate: rate === '' ? '' : +rate, start: start || '', renew: renew || '', note: fGet('note'), media: fGet('media') || [], created_by: pol ? pol.created_by : S.me, created_at: pol ? pol.created_at : nowIso() }));
  if (!row) return formErr('有内容填得不对，检查一下。');
  put('policies', row);
  if (pol) dropUnused(pol.media, row.media, row);
  SHEET.keep = row.media;
  closeSheet(true);
  S.ui.seg = 'insure'; saveUi(); render();
  toast(pol ? '改好了' : '保险记下了', pol ? {} : { undo: function () { del('policies', row.id); render(); } });
  return true;
}
// 删保单：它名下的理赔、还有它们带的文件（别处没在用的）一起删，撤销时一起回来
function removePolicy(pol) {
  var cs = CL.vals(S.T.claims).filter(function (c) { return c.policy_id === pol.id; }), rows = [pol].concat(cs), skip = CL.map(), gone = [];
  rows.forEach(function (r) { skip[r.id] = 1; });
  rows.forEach(function (r) {
    r.media.forEach(function (id) { var m = S.T.media[id]; if (m && !S.pend[id] && gone.indexOf(m) < 0 && !mediaUsedElsewhere(id, null, skip)) gone.push(m); });
  });
  cs.forEach(function (c) { del('claims', c.id); });
  del('policies', pol.id);
  gone.forEach(function (m) { del('media', m.id); });
  closeSheet(true); render();
  toast('这份保险删掉了' + (cs.length ? '，连同 ' + cs.length + ' 笔理赔' : ''), { undo: function () { gone.forEach(function (m) { undel('media', m); }); undel('policies', pol); cs.forEach(function (c) { undel('claims', c); }); render(); }, ms: 9000 });
}
function claimForm(c, policyId) {
  var p = pet(), pol = S.T.policies[c ? c.policy_id : policyId];
  if (!p || !pol) return;
  var cur = pol.currency;
  var h = fText('title', '什么事', c ? c.title : '', { focus: !c, ph: '比如：拉稀就诊', list: pastValues('entries', function (r) { return r.kind === 'health' && r.pet_id === p.id && r.data.title; }) }) +
    fDate('date', '看病或账单的日期', c ? c.date : S.today, { max: S.today }) +
    fMoney('bill', '账单金额（' + cur + '）', c ? c.bill : '') + fMoney('paid', '保险赔了多少（' + cur + '）', c ? c.paid : '', '还没赔下来就空着') +
    fMoney('ded', '其中抵自付额的（' + cur + '）', c ? c.ded : '', '这笔账单里算进自付额的部分。不清楚就空着') +
    fChips('status', '现在', CL.CLAIM_STATUS, c ? c.status : 'sent') + fArea('note', '备注', c ? c.note : '', { ph: '可以不填', max: 1000 }) + fMedia('media', '账单和理赔单', c ? c.media : [], 'doc');
  if (c) h += delBtn('删除这笔理赔');
  openSheet({ title: c ? '修改理赔' : '记一笔理赔', body: h, onSave: function () { return saveClaim(c, pol); }, onDel: c ? function () { removeRow('claims', c); } : null });
}
function saveClaim(c, pol) {
  var title = String(fGet('title') || '').trim(), date = fGet('date'), o = {}, bad = '', status = fGet('status') || 'sent';
  if (!title) return formErr('写一下是什么事。');
  if (!CL.isYmd(date)) return formErr('请选日期。');
  if (date > S.today) return formErr('日期不能是将来。');
  [['bill', '账单金额'], ['paid', '保险赔了多少'], ['ded', '抵自付额的']].forEach(function (x) {
    var v = CL.parseMoney(fGet(x[0]));
    if (v === null && !bad) bad = x[1];
    o[x[0]] = v === null ? '' : v;
  });
  if (bad) return formErr('「' + bad + '」填数字，比如 286 或 28.80。');
  if (o.bill !== '' && o.paid !== '' && o.paid > o.bill) return formErr('赔的不会比账单还多，检查一下这两个数。');
  if (o.bill !== '' && o.ded !== '' && o.ded > o.bill) return formErr('抵自付额的不会比账单还多，检查一下。');
  if (status === 'sent' && o.paid !== '' && o.paid > 0) status = 'paid';     // 填了赔付金额，就当已经赔了
  var row = CL.clean.claims(Object.assign(o, { id: c ? c.id : CL.newId(), pet_id: pol.pet_id, policy_id: pol.id, date: date, title: title, status: status, note: fGet('note'), media: fGet('media') || [],
    created_by: c ? c.created_by : S.me, created_at: c ? c.created_at : nowIso() }));
  if (!row) return formErr('有内容填得不对，检查一下。');
  put('claims', row);
  if (c) dropUnused(c.media, row.media, row);
  SHEET.keep = row.media;
  closeSheet(true); render();
  toast(c ? '改好了' : '理赔记下了', c ? {} : { undo: function () { del('claims', row.id); render(); } });
  return true;
}

/* ---- 文件（不是图片的）：先取下来，再打开 ---- */
function fileSheet(id) {
  var m = S.T.media[id];
  if (!m) return;
  var h = '<div class="filebox">' + ico('doc', 'big') + '<b>' + esc(m.name || '文件') + '</b><small>' + esc([fmtBytes(m.size), m.mime === 'application/pdf' ? 'PDF' : '', whoName(m.created_by), (m.created_at || '').slice(0, 10).replace(/-/g, '/')].filter(Boolean).join(' · ')) + '</small></div>' +
    '<div id="file-act" class="btns col"><button type="button" class="btn pri wide" data-act="file-get" data-id="' + esc(id) + '">' + (S.pend[id] ? '打开（还在这部手机上，没传完）' : '取文件') + '</button></div>' +
    (m.drive_id && !S.demo ? '<a class="btn wide" target="_blank" rel="noopener noreferrer" href="https://drive.google.com/file/d/' + encodeURIComponent(m.drive_id) + '/view">' + ico('open') + '在 Google Drive 里打开</a><p class="hint">用 Drive 打开要登录有权限的 Google 账号（表格主人的，或者被共享了那个文件夹的）。</p>' : '') +
    '';
  openSheet({ title: '文件', body: h, save: null });
}
function fileReady(id) {
  var box = $('#file-act'), m = S.T.media[id], blob = MEDIA.blob.get(id), url = MEDIA.url.get(id);
  if (!box || !m || !blob) return;
  var name = m.name || 'file', file = null, h = '';
  /*<save>*/
  try { file = new File([blob], name, { type: blob.type }); } catch (e) { file = null; }
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) h += '<button type="button" class="btn pri wide" data-act="file-share" data-id="' + esc(id) + '">' + ico('open') + '打开或保存</button>';
  h += '<a class="btn ' + (h ? '' : 'pri ') + 'wide" id="file-open" target="_blank" rel="noopener" href="' + esc(url) + '">' + ico('open') + '在新页面打开</a><a class="btn wide" id="file-save" download="' + esc(name) + '" href="' + esc(url) + '">存到这台设备</a>';
  /*</save>*/
  box.innerHTML = h + '<p class="hint" id="file-done">文件已经取到这台设备上了（' + fmtBytes(blob.size) + '）。' + (ENV.preview ? '预览版到这一步为止；正式版这里有「打开」和「存到这台设备」。' : '') + '</p>';
}

/* ---- 看大图：左右滑换张，双指或双击放大，往下拉关掉 ---- */
var VIEW = null;
function ownerOf(mid) {
  var hit = null;
  ['entries', 'shots', 'docs', 'claims', 'policies'].forEach(function (t) { if (!hit) CL.vals(S.T[t]).forEach(function (r) { if (!hit && r.media.indexOf(mid) >= 0) hit = { t: t, r: r }; }); });
  return hit;
}
function openViewer(ids, i) {
  ids = ids.filter(function (id) { return S.T.media[id]; });
  if (!ids.length) return;
  VIEW = { ids: ids, i: clamp(i || 0, 0, ids.length - 1), s: 1, x: 0, y: 0, pts: {} };
  $('#viewer-root').innerHTML = '<div class="viewer" role="dialog" aria-modal="true" aria-label="看大图" tabindex="-1"><div class="vw-stage" id="vw-stage"><img id="vw-img" alt="" draggable="false"></div>' +
    '<div class="vw-top"><button type="button" class="iconbtn dark" data-act="vw-close" aria-label="关闭">' + ico('x') + '</button><span class="vw-n" id="vw-n"></span></div>' +
    '<button type="button" class="vw-nav prev" data-act="vw-step" data-d="-1" aria-label="上一张">' + ico('chevL') + '</button><button type="button" class="vw-nav next" data-act="vw-step" data-d="1" aria-label="下一张">' + ico('chevR') + '</button><div class="vw-cap" id="vw-cap"></div></div>';
  document.body.classList.add('modal');
  bindViewer();
  paintViewer();
  $('.viewer').focus();
}
function closeViewer() { VIEW = null; $('#viewer-root').innerHTML = ''; if (!SHEET) document.body.classList.remove('modal'); }
function paintViewer() {
  if (!VIEW) return;
  var id = VIEW.ids[VIEW.i], img = $('#vw-img'), p = pet(), own = ownerOf(id), cap = '';
  VIEW.s = 1; VIEW.x = 0; VIEW.y = 0; zoomApply();
  img.className = ''; img.removeAttribute('src'); img.setAttribute('data-mid', id); img.setAttribute('data-full', '');
  hydrate($('#viewer-root'));
  $('#vw-n').textContent = VIEW.ids.length > 1 ? (VIEW.i + 1) + ' / ' + VIEW.ids.length : '';
  $('.vw-nav.prev').hidden = VIEW.i === 0; $('.vw-nav.next').hidden = VIEW.i === VIEW.ids.length - 1;
  if (own) {
    var r = own.r, date = r.date || '';
    cap = '<b>' + esc(own.t === 'docs' || own.t === 'claims' ? r.title : own.t === 'shots' ? r.name : own.t === 'policies' ? r.company : (r.data.title || r.note || CL.summary(r, unit()))) + '</b><span>' + esc([date ? CL.fmtDate(date, 'ymd') : '', p && date ? ageAt(p, date) : ''].filter(Boolean).join(' · ')) + '</span>';
  }
  $('#vw-cap').innerHTML = cap;
}
function zoomApply() { var img = $('#vw-img'); if (img && VIEW) img.style.transform = 'translate(' + VIEW.x + 'px,' + VIEW.y + 'px) scale(' + VIEW.s + ')'; }
function viewStep(d) { if (!VIEW) return; var n = VIEW.i + d; if (n < 0 || n >= VIEW.ids.length) return; VIEW.i = n; paintViewer(); }
function bindViewer() {
  var st = $('#vw-stage'), start = null, lastTap = 0;
  function pts() { return Object.keys(VIEW.pts).map(function (k) { return VIEW.pts[k]; }); }
  function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }
  st.addEventListener('pointerdown', function (e) {
    if (!VIEW) return;
    VIEW.pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    try { st.setPointerCapture(e.pointerId); } catch (err) { /* 没关系 */ }
    var p = pts();
    start = p.length === 2 ? { d: dist(p[0], p[1]), s: VIEW.s, x: VIEW.x, y: VIEW.y, two: true } : { x0: e.clientX, y0: e.clientY, x: VIEW.x, y: VIEW.y, t: Date.now(), moved: false };
  });
  st.addEventListener('pointermove', function (e) {
    if (!VIEW || !VIEW.pts[e.pointerId] || !start) return;
    VIEW.pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    var p = pts();
    if (p.length === 2 && start.two) { VIEW.s = clamp(start.s * dist(p[0], p[1]) / Math.max(1, start.d), 1, 5); if (VIEW.s === 1) { VIEW.x = 0; VIEW.y = 0; } zoomApply(); return; }
    if (p.length !== 1 || start.two) return;
    var dx = e.clientX - start.x0, dy = e.clientY - start.y0;
    if (Math.abs(dx) + Math.abs(dy) > 8) start.moved = true;
    if (VIEW.s > 1) { VIEW.x = start.x + dx; VIEW.y = start.y + dy; } else { VIEW.x = dx; VIEW.y = Math.max(0, dy); }
    zoomApply();
  });
  function up(e) {
    if (!VIEW) return;
    delete VIEW.pts[e.pointerId];
    if (!start || pts().length) { if (!pts().length) start = null; return; }
    var s0 = start; start = null;
    if (s0.two) return;
    var dx = e.clientX - s0.x0, dy = e.clientY - s0.y0;
    if (VIEW.s > 1) { if (!s0.moved) tap(e); return; }
    VIEW.x = 0; VIEW.y = 0; zoomApply();
    if (dy > 90 && Math.abs(dx) < 80) return closeViewer();
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) return viewStep(dx < 0 ? 1 : -1);
    if (!s0.moved) tap(e);
  }
  function tap(e) {
    var now = Date.now();
    if (now - lastTap < 320) { lastTap = 0; if (VIEW.s > 1) { VIEW.s = 1; VIEW.x = 0; VIEW.y = 0; } else { var r = st.getBoundingClientRect(); VIEW.s = 2.5; VIEW.x = (r.left + r.width / 2 - e.clientX) * 1.5; VIEW.y = (r.top + r.height / 2 - e.clientY) * 1.5; } zoomApply(); }
    else lastTap = now;
  }
  st.addEventListener('pointerup', up);
  st.addEventListener('pointercancel', function (e) { if (VIEW) { delete VIEW.pts[e.pointerId]; start = null; if (VIEW.s === 1) { VIEW.x = 0; VIEW.y = 0; zoomApply(); } } });
}

/* ---------- 60-actions：点击和输入、启动 ---------- */
var ROUTES = ['home', 'timeline', 'growth', 'records', 'prefs'];
function go(tab) {
  if (ROUTES.indexOf(tab) < 0) tab = 'home';
  S.tab = tab;
  try { history.replaceState(null, '', '#' + tab); } catch (e) { try { location.hash = tab; } catch (e2) { /* 预览里改不了地址也能用 */ } }
  render();
  window.scrollTo(0, 0);
}
function hashTab() { var t = String(location.hash || '').replace(/^#/, ''); return ROUTES.indexOf(t) >= 0 ? t : ''; }

var pickBox = null;   // 正在等用户选文件的那个格子
function boxIds(box) { return (box.getAttribute('data-ids') || '').split(',').filter(Boolean); }
function setBoxIds(box, ids) {
  box.setAttribute('data-ids', ids.join(','));
  box.innerHTML = mediaInner(ids, box.getAttribute('data-mode'), +box.getAttribute('data-max') || 12);
  box.classList.remove('busy');
  hydrate(box);
}
function onPicked(input) {
  var box = pickBox, files = Array.prototype.slice.call(input.files || []);
  pickBox = null;
  if (!box || !box.isConnected || !files.length) { input.value = ''; return; }
  var mode = box.getAttribute('data-mode'), max = +box.getAttribute('data-max') || 12, cur = boxIds(box), room = max === 1 ? 1 : max - cur.length;
  if (files.length > room) { toast('这里最多放 ' + max + ' 个，多出来的没有加', { bad: true }); files = files.slice(0, room); }
  var dateEl = $('#sheet-b [data-k="date"]'), date = dateEl && CL.isYmd(dateEl.value) ? dateEl.value : S.today;
  box.classList.add('busy');
  addFiles(files, mode, date).then(function (ids) {
    input.value = '';
    if (!box.isConnected || !SHEET) { ids.forEach(function (id) { if (S.pend[id]) dropPend(id); }); rebuild(); paintSync(); return; }
    SHEET.added = SHEET.added.concat(ids);
    setBoxIds(box, max === 1 ? (ids.length ? ids.slice(0, 1) : cur) : cur.concat(ids));
    var title = $('#sheet-b #f-title'), m = ids.length && S.T.media[ids[0]];
    if (title && !title.value && m && m.kind === 'file' && box.getAttribute('data-k') === 'media' && $('#sheet-b [data-k="category"]')) title.value = m.name.replace(/\.[^.]*$/, '').slice(0, 60);
  }, function () { input.value = ''; box.classList.remove('busy'); toast('没能读取选的文件', { bad: true }); });
}

var ACT = {
  go: function (el) { go(el.getAttribute('data-tab')); },
  'add-menu': function () { addMenu(); },
  add: function (el) {
    var kind = el.getAttribute('data-kind');
    if (!pet()) return;
    if (kind === 'vaccine' || kind === 'deworm') {
      if (S.tab !== 'records' || S.ui.seg !== kind) { S.ui.seg = kind; saveUi(); }
      shotForm(kind, null, el.getAttribute('data-code') || '');
      var nm = el.getAttribute('data-name'), inp = $('#f-name');
      if (nm && inp) inp.value = nm;
    } else if (kind === 'doc') docForm(null);
    else if (FORM_TITLE[kind]) entryForm(kind, null);
  },
  open: function (el) { detailSheet(el.getAttribute('data-t'), el.getAttribute('data-id')); },
  edit: function (el) {
    var t = el.getAttribute('data-t'), id = el.getAttribute('data-id'), r = t === 'shot' ? S.T.shots[id] : S.T.entries[id];
    if (!r) return closeSheet();
    if (t === 'shot') shotForm(r.kind, r); else entryForm(r.kind, r);
  },
  'health-done': function (el) {
    var e = S.T.entries[el.getAttribute('data-id')];
    if (!e) return closeSheet();
    var row = CL.clean.entries(Object.assign({}, e, { data: Object.assign({}, e.data, { status: 'done' }) }));
    put('entries', row); closeSheet(true); render();
    toast('标成已经好了', { undo: function () { put('entries', e); render(); } });
  },
  view: function (el) { openViewer((el.getAttribute('data-ids') || '').split(',').filter(Boolean), +el.getAttribute('data-i') || 0); },
  file: function (el) { fileSheet(el.getAttribute('data-id')); },
  'file-get': function (el) {
    var id = el.getAttribute('data-id');
    el.disabled = true; el.textContent = '正在取文件…';
    fullUrl(id).then(function () { fileReady(id); }, function (e) {
      el.disabled = false; el.textContent = '再试一次';
      formErr(e && e.code === 'not_found' ? e.message : '没取到文件。检查一下网络，再试一次。');
    });
  },
  /*<save>*/
  'file-share': function (el) {
    var id = el.getAttribute('data-id'), m = S.T.media[id], blob = MEDIA.blob.get(id);
    if (!m || !blob) return;
    try { navigator.share({ files: [new File([blob], m.name || 'file', { type: blob.type })] }).catch(function () { /* 用户自己关掉的 */ }); } catch (e) { toast('这台设备不支持，用下面的「在新页面打开」', { bad: true }); }
  },
  /*</save>*/
  doc: function (el) { docSheet(el.getAttribute('data-id')); },
  'doc-edit': function (el) { var d = S.T.docs[el.getAttribute('data-id')]; if (d) docForm(d); else closeSheet(); },
  day: function (el) { daySheet(el.getAttribute('data-date') || S.today); },
  'day-ok': function () {
    var p = pet();
    if (!p) return;
    var id = CL.dailyId(p.id, S.today), old = S.T.entries[id];
    var row = putDaily(p, S.today, CL.normalDaily(old ? old.data : {}), old ? old.note : '', old);
    render();
    toast('记下了：一切正常', { undo: function () { if (old) put('entries', old); else if (row) del('entries', row.id); render(); } });
  },
  'day-fill': function () {
    CL.DAILY.forEach(function (f) {
      var box = $('#sheet-b [data-k="' + f.k + '"]');
      if (!box || $('.chip[aria-pressed="true"]', box)) return;
      var b = $('.chip[data-v="' + f.normal + '"]', box);
      if (b) b.setAttribute('aria-pressed', 'true');
    });
  },
  rem: function (el) {
    var g = el.getAttribute('data-go');
    if (g === 'care') careSheet(el.getAttribute('data-type'));
    else if (g === 'insure') { S.ui.seg = 'insure'; saveUi(); go('records'); }
    else if (g === 'shot') { S.ui.seg = el.getAttribute('data-kind') === 'deworm' ? 'deworm' : 'vaccine'; saveUi(); go('records'); }
    else if (g === 'entry') detailSheet('entry', el.getAttribute('data-id'));
    else if (g === 'weight') entryForm('weight', null);
  },
  filter: function (el) { S.ui.filter = el.getAttribute('data-v'); S.ui.tlLimit = 40; saveUi(); render(); },
  'tl-more': function () { S.ui.tlLimit += 60; render(); },
  range: function (el) { S.ui.range = el.getAttribute('data-v'); saveUi(); render(); },
  wlist: function () { S.ui.listW = !S.ui.listW; saveUi(); render(); },
  cal: function (el) {
    var ym = S.ui.calYm || S.today.slice(0, 7), next = CL.addMonths(ym + '-01', +el.getAttribute('data-d')).slice(0, 7);
    if (next > S.today.slice(0, 7)) return;
    S.ui.calYm = next === S.today.slice(0, 7) ? '' : next;
    render();
  },
  seg: function (el) { S.ui.seg = el.getAttribute('data-v'); saveUi(); render(); },
  'go-seg': function (el) { S.ui.seg = el.getAttribute('data-seg'); saveUi(); go('records'); },
  care: function (el) { careSheet(el.getAttribute('data-type')); },
  'care-done': function (el) { careDone(el.getAttribute('data-type')); },
  'care-past': function (el) { entryForm('activity', null, { type: el.getAttribute('data-type') }); },
  'care-every': function (el) {
    var p = pet(), type = el.getAttribute('data-type'), v = el.getAttribute('data-v');
    if (!p || CL.CARE.indexOf(type) < 0) return;
    put('settings', CL.clean.settings({ id: CL.careKey(p.id, type), value: /^\d{1,3}$/.test(v) ? v : '' }));
    render(); careSheet(type);
  },
  'policy-add': function () { policyForm(null); },
  'policy-edit': function (el) { var x = S.T.policies[el.getAttribute('data-id')]; if (x) policyForm(x); },
  'policy-roll': function (el) {
    var x = S.T.policies[el.getAttribute('data-id')], next = x && CL.clean.policies(CL.rollPolicy(x) || {});
    if (!next) return;
    put('policies', next); render();
    toast('顺延到 ' + CL.fmtDate(next.renew, 'ymd') + '，新年度的额度重新算', { undo: function () { put('policies', x); render(); }, ms: 9000 });
  },
  'claim-add': function (el) { claimForm(null, el.getAttribute('data-id')); },
  'claim-edit': function (el) { var c = S.T.claims[el.getAttribute('data-id')]; if (c) claimForm(c); },
  'renew-step': function () {
    var s = ($('#f-start') || {}).value, out = $('#f-renew');
    if (!out) return;
    if (!CL.isYmd(s)) return formErr('先填上面的「本年度从哪天开始」，再点这里。');
    out.value = CL.addMonths(s, 12);
  },
  'shot-key': function (el) { shotKeySheet(el.getAttribute('data-kind'), el.getAttribute('data-key')); },
  'pet-menu': function () { if (pet()) petMenu(); },
  'pet-pick': function (el) { S.ui.pet = el.getAttribute('data-id'); S.ui.calYm = ''; saveUi(); closeSheet(); render(); },
  'pet-edit': function (el) { var x = S.T.pets[el.getAttribute('data-id')]; if (x) petForm(x); },
  'pet-add': function () { petForm(null); },
  'pet-del': function (el) {
    var x = S.T.pets[el.getAttribute('data-id')];
    if (!x) return closeSheet();
    if (!el.hasAttribute('data-sure')) { el.setAttribute('data-sure', ''); el.lastChild.textContent = '再点一次，确认删除' + x.name + '的资料'; return; }
    del('pets', x.id);
    if (S.ui.pet === x.id) { S.ui.pet = ''; saveUi(); }
    closeSheet(true);
    if (!pet()) S.tab = 'home';
    render();
    toast(x.name + '的资料删掉了，记录还留在表格里', { undo: function () { undel('pets', x); S.ui.pet = x.id; render(); }, ms: 9000 });
  },
  'me-edit': function () { meForm(); },
  unit: function (el) { put('settings', CL.clean.settings({ id: 'unit', value: el.getAttribute('data-v') === 'lb' ? 'lb' : 'kg' })); render(); },
  theme: function (el) { var v = el.getAttribute('data-v'); S.ui.theme = v === 'light' || v === 'dark' ? v : 'auto'; saveUi(); applyTheme(); render(); },
  resync: function () { toast('正在重新同步…'); sync(true).then(function (ok) { toast(ok ? '同步好了' : '没同步上，稍后会自动重试', { bad: !ok }); }); },
  reinit: function () {
    openSheet({ title: '换一条初始化链接', save: '确定', body: '<p class="hint">口令重置过，或者换了一张表格时用。把新的链接粘贴在这里。这部手机上还没发出去的改动会留着，接着发。</p><textarea id="f-init" class="inp" rows="4" placeholder="https://…#init=…" autocapitalize="off" spellcheck="false" aria-label="初始化链接"></textarea>', onSave: function () {
      var a = CL.parseInit($('#f-init').value);
      if (!a) return formErr('这不像是初始化链接。它应该是一长串，里面有 #init=。');
      useAuth(a); closeSheet(true); render(); sync(true);
      return true;
    } });
  },
  'init-paste': function () {
    var a = CL.parseInit(($('#init-text') || {}).value || '');
    if (!a) { var e = $('#init-err'); if (e) e.textContent = '这不像是初始化链接。它应该是一长串，里面有 #init=。请整条复制过来。'; return; }
    useAuth(a); S.tab = 'home'; render(); sync(true);
  },
  'demo-on': function () { try { localStorage.setItem('catlog:v1:demo', '1'); } catch (e) { return toast('这个浏览器不让存东西，演示开不了', { bad: true }); } location.reload(); },
  'demo-off': function () { try { localStorage.removeItem('catlog:v1:demo'); } catch (e) { /* 没存上也就不用删 */ } try { history.replaceState(null, '', location.pathname); } catch (e2) { /* 没关系 */ } location.reload(); },
  'demo-reset': function () {
    lsDel('queue'); lsDel('uploads');
    Promise.all([DB.clear('kv'), DB.clear('up'), DB.clear('full'), DB.clear('thumb')]).then(function () { location.reload(); });
  },
  'toast-undo': function () { var fn = toast.undo; toast.undo = null; $('#toast-root').innerHTML = ''; if (fn) fn(); },
  'sheet-close': function () { closeSheet(); },
  'sheet-save': function () { if (SHEET && SHEET.onSave) SHEET.onSave(); },
  'form-del': function () { if (SHEET && SHEET.onDel) SHEET.onDel(); },
  chip: function (el) {
    var box = el.parentNode, on = el.getAttribute('aria-pressed') === 'true';
    if (box.hasAttribute('data-multi')) { el.setAttribute('aria-pressed', String(!on)); return; }
    if (on && !box.hasAttribute('data-none')) return;
    $$('.chip, .sw-c', box).forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    el.setAttribute('aria-pressed', String(!on));
  },
  preset: function (el) {
    var inp = $('#f-name');
    if (inp) inp.value = el.getAttribute('data-v');
    $$('.chip', el.parentNode).forEach(function (b) { b.setAttribute('aria-pressed', String(b === el)); });
  },
  step: function (el) {
    var out = $('#f-next_due'), base = ($('#f-date') || {}).value;
    if (!out) return;
    if (el.hasAttribute('data-clear')) { out.value = ''; return; }
    if (!CL.isYmd(base)) return formErr('先选好日期，再点这里往后推。');
    out.value = CL.addDays(CL.addMonths(base, +el.getAttribute('data-m') || 0), +el.getAttribute('data-d') || 0);
  },
  'media-add': function (el) {
    pickBox = el.parentNode;
    var input = $(pickBox.getAttribute('data-mode') === 'photo' ? '#pick-photo' : '#pick-file');
    input.multiple = (+pickBox.getAttribute('data-max') || 12) > 1;
    input.value = '';
    input.click();
  },
  'media-del': function (el) {
    var box = el.closest('.media-edit'), id = el.getAttribute('data-id');
    if (!box) return;
    setBoxIds(box, boxIds(box).filter(function (x) { return x !== id; }));      // 没用上的照片在关掉面板时统一清理
  },
  'vw-close': function () { closeViewer(); },
  'vw-step': function (el) { viewStep(+el.getAttribute('data-d')); }
};

function useAuth(a) {
  S.auth = { u: a.u, t: a.t, w: a.w || '' };
  lsSet('auth', S.auth);
  if (a.w) S.me = a.w;
  S.rev = 0; S.sync.state = 'idle'; S.sync.full = true;
}

document.addEventListener('click', function (ev) {
  var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
  if (!el || el.disabled) return;
  var fn = ACT[el.getAttribute('data-act')];
  if (fn) fn(el, ev);
});
document.addEventListener('keydown', function (ev) {
  if (VIEW) {
    if (ev.key === 'Escape') closeViewer(); else if (ev.key === 'ArrowLeft') viewStep(-1); else if (ev.key === 'ArrowRight') viewStep(1);
    return;
  }
  if (ev.key === 'Escape' && SHEET) { closeSheet(); return; }
  var t = ev.target;
  if ((ev.key === 'Enter' || ev.key === ' ') && t.matches && t.matches('[role="button"][data-act]')) { ev.preventDefault(); t.click(); return; }
  if (ev.key === 'Enter' && SHEET && SHEET.onSave && t.matches && t.matches('#sheet-b input.inp') && !ev.isComposing) { ev.preventDefault(); SHEET.onSave(); }
});
document.addEventListener('input', function (ev) {
  var t = ev.target;
  if (t && t.id === 'f-name') {            // 手写的疫苗名字和某个常见项一样时，把那个选项点亮
    var v = t.value.trim().toLowerCase();
    $$('#sheet-b [data-presets] .chip').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v').toLowerCase() === v)); });
  }
  if (t && (t.id === 'init-text')) { var e = $('#init-err'); if (e) e.textContent = ''; }
});

var DEMO_SEED = 2;          // 演示数据的示例是第几版：1 = 1.0.0，2 = 1.1.0（多了保险和护理的间隔）
function boot() {
  var saved = lsGet('ui', {}) || {};
  ['pet', 'theme', 'filter', 'seg', 'range'].forEach(function (k) { if (typeof saved[k] === 'string') S.ui[k] = saved[k]; });
  S.ui.listW = !!saved.listW;
  if (!FILTERS.some(function (f) { return f[0] === S.ui.filter; })) S.ui.filter = 'all';
  if (!SEGS.some(function (f) { return f[0] === S.ui.seg; })) S.ui.seg = 'vaccine';
  if (['3m', '1y', 'all'].indexOf(S.ui.range) < 0) S.ui.range = 'all';
  applyTheme();

  var fresh = null;
  if (!S.demo) {
    fresh = CL.parseInit(location.hash);      // 地址里带着初始化信息：存下来，并从地址栏清掉
    if (/init=/.test(location.hash)) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 清不掉也不影响 */ } }
    var a = fresh || lsGet('auth', null);
    S.auth = a && CL.okApi(a.u) && /^[A-Za-z0-9]{16,128}$/.test(String(a.t)) ? { u: a.u, t: String(a.t), w: a.w === 'b' ? 'b' : a.w === 'a' ? 'a' : '' } : null;
    if (S.auth && S.auth.w) S.me = S.auth.w;
    if (fresh) lsSet('auth', S.auth);
  }
  var q = lsGet('queue', []);
  S.queue = Array.isArray(q) ? q.filter(function (o) { return o && typeof o.id === 'string' && CL.TABLES.indexOf(o.table) >= 0 && o.row && typeof o.row.id === 'string' && (o.t === 'put' || o.t === 'del' || o.t === 'undel'); }) : [];
  loadPend();
  S.tab = hashTab() || 'home';

  (fresh ? DB.del('kv', 'snap') : Promise.resolve()).then(loadSnap).then(function (had) {
    if (fresh) { S.rev = 0; S.sync.full = true; }
    if (S.demo) {
      // 演示数据是哪一版的示例：旧版本留下的（没有这个记号）补上新加的示例，自己在演示里记的不动
      if (had) { Demo.restore(S.base, S.rev); if ((Number(lsGet('seed', 1)) || 1) < DEMO_SEED) Demo.topUp(); }
      lsSet('seed', DEMO_SEED);
    }
    rebuild();
    S.ready = true;
    render();
    if (S.demo || S.auth) sync();
  });

  document.addEventListener('visibilitychange', function () { if (!document.hidden) { if (CL.today() !== S.today && !SHEET && !VIEW) render(); sync(); } });
  window.addEventListener('online', function () { sync(); });
  window.addEventListener('offline', function () { if (!S.demo && S.auth && S.sync.state !== 'auth') setSync('offline'); });
  window.addEventListener('hashchange', function () { var t = hashTab(); if (t && t !== S.tab) { S.tab = t; render(); } });
  window.addEventListener('pageshow', function (e) { if (e.persisted) sync(); });
  // 键盘弹出来时，把面板抬到键盘上面，高度也跟着缩（--kb 是键盘占掉的高度，--vvh 是剩下能看见的高度）
  var vv = window.visualViewport;
  if (vv) {
    var onVV = function () {
      var kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop), st = document.documentElement.style;
      st.setProperty('--kb', (kb > 80 ? Math.round(kb) : 0) + 'px');
      st.setProperty('--vvh', Math.round(vv.height) + 'px');
    };
    vv.addEventListener('resize', onVV); vv.addEventListener('scroll', onVV); onVV();
  }
  var rz = null;
  window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if ($('#wchart')) afterRender(pet()); }, 150); });
  setInterval(function () { if (!document.hidden) { if (CL.today() !== S.today && !SHEET && !VIEW) render(); sync(); } }, 45000);
  $('#pick-photo').addEventListener('change', function () { onPicked(this); });
  $('#pick-file').addEventListener('change', function () { onPicked(this); });

  if (!ENV.preview && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* 装不上也能用，只是离线打不开 */ });
  }
}
boot();

})();
