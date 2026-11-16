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
