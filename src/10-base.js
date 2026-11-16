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
