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
