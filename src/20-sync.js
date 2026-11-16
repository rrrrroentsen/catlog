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
