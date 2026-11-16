/**
 * CatLog 猫咪日志 —— 后端（Google Apps Script）
 *
 * 用法：在 Google 表格里点「扩展程序 → Apps Script」，把这个文件的全部内容粘贴进去（替换原来的内容），
 * 保存，运行一次 setup，再部署成「网页应用」。完整步骤见 README.md。
 *
 * 记录存在这张表格里；照片和文件存在你 Google Drive 的「CatLog 猫咪日志」文件夹里。
 * 这里没有任何口令：口令在 setup 时生成，存在「脚本属性」里。
 */
const VERSION = '1.0.0';

// 只有用 printInitLinks 这个备用办法时才需要填下面两行。平时用表格菜单「CatLog → 生成初始化链接」，不用改。
const FALLBACK_API_URL = '';   // 部署后得到的网页应用网址，以 /exec 结尾
const FALLBACK_PAGE_URL = '';  // GitHub Pages 上的页面地址，以 / 结尾

// 每张工作表的列。以后加列只往后面加；已有的表格会在同步时自动补上缺的列。
const TABLES = {
  members: ['id', 'name', 'color', 'updated_at', 'updated_by', 'rev', 'deleted'],
  pets: ['id', 'name', 'species', 'sex', 'neutered', 'birthday', 'home_date', 'breed', 'coat', 'chip', 'color', 'avatar', 'note', 'sort',
    'created_by', 'created_at', 'updated_at', 'updated_by', 'rev', 'deleted'],
  entries: ['id', 'pet_id', 'kind', 'date', 'time', 'summary', 'kg', 'data', 'note', 'media',
    'created_by', 'created_at', 'updated_at', 'updated_by', 'rev', 'deleted'],
  shots: ['id', 'pet_id', 'kind', 'name', 'code', 'date', 'next_due', 'dose', 'product', 'lot', 'clinic', 'note', 'media',
    'created_by', 'created_at', 'updated_at', 'updated_by', 'rev', 'deleted'],
  docs: ['id', 'pet_id', 'title', 'category', 'date', 'note', 'media', 'created_by', 'created_at', 'updated_at', 'updated_by', 'rev', 'deleted'],
  media: ['id', 'kind', 'name', 'mime', 'size', 'w', 'h', 'drive_id', 'created_by', 'created_at', 'updated_at', 'updated_by', 'rev', 'deleted'],
  settings: ['id', 'value', 'note', 'updated_at', 'updated_by', 'rev', 'deleted']
};
const THUMB_COLS = ['id', 'thumb'];
// 网页能改的列，其余的由后端填
const WRITABLE = {
  members: ['name', 'color'],
  pets: ['name', 'species', 'sex', 'neutered', 'birthday', 'home_date', 'breed', 'coat', 'chip', 'color', 'avatar', 'note', 'sort'],
  entries: ['pet_id', 'kind', 'date', 'time', 'summary', 'kg', 'data', 'note', 'media'],
  shots: ['pet_id', 'kind', 'name', 'code', 'date', 'next_due', 'dose', 'product', 'lot', 'clinic', 'note', 'media'],
  docs: ['pet_id', 'title', 'category', 'date', 'note', 'media'],
  media: [],
  settings: ['value']
};
const NUM_COLS = { rev: 1, size: 1, w: 1, h: 1, kg: 1, sort: 1 };
const BOOL_COLS = { deleted: 1 };
const LIMITS = { note: 5000, data: 20000, media: 2000, summary: 300, thumb: 45000 };
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_OPS = 300;
const RE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RE_THUMB = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/]+=*$/;
const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'application/pdf', 'text/plain'];
const ROOT_FOLDER = 'CatLog 猫咪日志';

/* ====================== 网页应用入口 ====================== */

function doGet() {
  return json_({ ok: true, app: 'catlog', v: VERSION, hint: 'CatLog 后端已经部署好了。回到表格，用菜单「CatLog → 生成初始化链接」。' });
}

function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e && e.postData && e.postData.contents || '');
    out = handle_(body);
  } catch (err) {
    out = { ok: false, error: err && err.code || 'server', message: String(err && err.message || err) };
  }
  return json_(out);
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail_(code, message) { var e = new Error(message); e.code = code; return e; }

function handle_(p) {
  if (!p || typeof p !== 'object') throw fail_('bad_request', '请求格式不对');
  var me = whoIs_(p.token);
  if (!me) throw fail_('auth', '口令不对。请重新打开初始化链接。');
  if (p.action === 'sync') return sync_(me, p);
  if (p.action === 'upload') return upload_(me, p);
  if (p.action === 'thumbs') return thumbs_(p);
  if (p.action === 'media') return media_(p);
  if (p.action === 'ping') return { ok: true, v: VERSION, me: me };
  throw fail_('bad_request', '不认识的操作');
}

function whoIs_(token) {
  token = String(token || '');
  if (token.length < 16) return '';
  var props = PropertiesService.getScriptProperties();
  if (token === props.getProperty('TOKEN_A')) return 'a';
  if (token === props.getProperty('TOKEN_B')) return 'b';
  return '';
}

/* ====================== 同步 ====================== */

// 网页发来一批操作（可以为空），后端写进表格，再把「上次同步之后变过的行」发回去。
// 每次有写入，全局版本号 REV 加一，写到的行都记上这个版本号；网页下次带着 since 来，只拿更新的行。
function sync_(me, p) {
  var props = PropertiesService.getScriptProperties();
  var ops = Array.isArray(p.ops) ? p.ops : [];
  if (ops.length > MAX_OPS) throw fail_('bad_request', '一次发来的操作太多');
  var since = Number(p.since);
  if (!isFinite(since) || since < 0) since = 0;
  var rev = Number(props.getProperty('REV') || 0);
  var acked = [];

  if (ops.length) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw fail_('busy', '表格正忙，稍后会自动重试');
    try {
      rev = Number(props.getProperty('REV') || 0);
      var cache = CacheService.getScriptCache();
      var good = ops.filter(validOp_);
      var seen = good.length ? (cache.getAll(good.map(function (o) { return 'op_' + o.id; })) || {}) : {};
      var fresh = good.filter(function (o) { return !seen['op_' + o.id]; });   // 重发的操作不再做第二遍
      if (fresh.length) {
        var touched = applyOps_(me, fresh, rev + 1);
        if (touched.length) {
          rev++;
          touched.forEach(function (t) { props.setProperty('REV_' + t, String(rev)); });
          props.setProperty('REV', String(rev));
        }
        var mark = {};
        fresh.forEach(function (o) { mark['op_' + o.id] = '1'; });
        try { cache.putAll(mark, 21600); } catch (err) { /* 缓存只是保险，写不进去不影响 */ }
      }
      ops.forEach(function (o) { if (o && o.id != null) acked.push(String(o.id)); });
    } finally {
      lock.releaseLock();
    }
  }

  var full = !!p.full || since === 0 || since > rev;   // 网页比表格还新，说明表格被换过或恢复过：整份重来
  if (!full && !ops.length && since === rev) return { ok: true, v: VERSION, me: me, rev: rev, unchanged: true };

  var changes = {};
  Object.keys(TABLES).forEach(function (t) {
    if (!full && Number(props.getProperty('REV_' + t) || 0) <= since) return;
    var rows = readRows_(t).filter(function (r) { return full ? !r.deleted : r.rev > since; });
    if (rows.length) changes[t] = rows.map(compact_);
  });
  return { ok: true, v: VERSION, me: me, rev: rev, reset: full, changes: changes, acked: acked };
}

function validOp_(o) {
  return !!o && typeof o === 'object' && RE_ID.test(String(o.id || '')) &&
    Object.prototype.hasOwnProperty.call(TABLES, o.table) &&
    (o.t === 'put' || o.t === 'del' || o.t === 'undel') &&
    !!o.row && typeof o.row === 'object' && RE_ID.test(String(o.row.id || ''));
}

// 把操作写进表格。返回写到了哪些表。
function applyOps_(me, ops, rev) {
  var now = new Date().toISOString();
  var groups = {};
  ops.forEach(function (o) { (groups[o.table] = groups[o.table] || []).push(o); });
  var touched = [];
  Object.keys(groups).forEach(function (t) {
    var sh = ensureSheet_(t), head = header_(sh), width = head.length, col = colIndex_(head);
    var lastRow = sh.getLastRow(), rowOf = {};
    if (lastRow > 1) {
      sh.getRange(2, col.id + 1, lastRow - 1, 1).getValues().forEach(function (r, i) {
        var id = text_(r[0], 'id');
        if (id && !rowOf['$' + id]) rowOf['$' + id] = i + 2;
      });
    }
    var fresh = [], freshAt = {}, changed = false;
    groups[t].forEach(function (o) {
      var id = String(o.row.id), key = '$' + id;
      if (t === 'members' && id !== me) return;            // 名字和颜色只能改自己的
      var rowNo = rowOf[key], arr, isNew = false;
      if (rowNo) arr = sh.getRange(rowNo, 1, 1, width).getValues()[0];
      else if (Object.prototype.hasOwnProperty.call(freshAt, key)) arr = fresh[freshAt[key]];
      else {
        if (o.t !== 'put' || t === 'media') return;         // 没有的行删不了；图片和文件只能通过上传新增
        if (t === 'members' && id !== 'a' && id !== 'b') return;
        arr = []; for (var i = 0; i < width; i++) arr.push('');
        isNew = true;
        set_(arr, col, 'id', id);
        set_(arr, col, 'created_by', me);
        set_(arr, col, 'created_at', isoOr_(o.row.created_at, now));
      }
      if (o.t === 'put') {
        if (t === 'media') return;
        WRITABLE[t].forEach(function (c) { if (Object.prototype.hasOwnProperty.call(o.row, c)) set_(arr, col, c, o.row[c]); });
        set_(arr, col, 'deleted', false);
      } else {
        set_(arr, col, 'deleted', o.t === 'del');
        if (t === 'media' && col.drive_id != null) trash_(text_(arr[col.drive_id], 'drive_id'), o.t === 'del');
      }
      set_(arr, col, 'updated_at', now);
      set_(arr, col, 'updated_by', me);
      set_(arr, col, 'rev', rev);
      if (rowNo) sh.getRange(rowNo, 1, 1, width).setValues([arr.map(guard_)]);
      else if (isNew) { freshAt[key] = fresh.length; fresh.push(arr); }
      changed = true;
    });
    if (fresh.length) appendRows_(sh, head, fresh);
    if (changed) touched.push(t);
  });
  return touched;
}

/* ====================== 照片和文件 ====================== */

// 上传一个文件：内容存进 Drive，表格的 media 表里记一行，缩略图记在 thumbs 表里。
function upload_(me, p) {
  var id = String(p.id || '');
  if (!RE_ID.test(id)) throw fail_('bad_request', '文件编号不对');
  var data = String(p.data || '');
  if (!data) throw fail_('bad_request', '没有文件内容');
  if (data.length > MAX_FILE_BYTES * 1.4) throw fail_('too_large', '文件太大，上限 12 MB');
  var mime = MIMES.indexOf(String(p.mime || '').toLowerCase()) >= 0 ? String(p.mime).toLowerCase() : 'application/octet-stream';
  var kind = p.kind === 'img' && /^image\/(jpeg|png|webp)$/.test(mime) ? 'img' : 'file';
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw fail_('busy', '表格正忙，稍后会自动重试');
  try {
    var old = readRows_('media').filter(function (r) { return r.id === id; })[0];
    if (old && old.drive_id) return { ok: true, v: VERSION, me: me, row: compact_(old), dup: true };   // 重发：已经存过了
    var bytes;
    try { bytes = Utilities.base64Decode(data); } catch (err) { throw fail_('bad_request', '文件内容读不出来'); }
    if (bytes.length > MAX_FILE_BYTES) throw fail_('too_large', '文件太大，上限 12 MB');
    var date = /^\d{4}-\d{2}-\d{2}$/.test(String(p.date || '')) ? String(p.date) : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var shown = cleanName_(p.name) || (kind === 'img' ? id + '.jpg' : id);
    var file = folder_(kind === 'img' ? 'FOLDER_PHOTOS' : 'FOLDER_FILES').createFile(Utilities.newBlob(bytes, mime, date + '_' + (kind === 'img' ? id + ext_(mime) : shown)));
    var now = new Date().toISOString();
    var rev = Number(props.getProperty('REV') || 0) + 1;
    var row = { id: id, kind: kind, name: shown, mime: mime, size: bytes.length, w: p.w, h: p.h, drive_id: file.getId(),
      created_by: me, created_at: now, updated_at: now, updated_by: me, rev: rev, deleted: false };
    var sh = ensureSheet_('media'), head = header_(sh), col = colIndex_(head), arr = [];
    for (var i = 0; i < head.length; i++) arr.push('');
    Object.keys(row).forEach(function (c) { set_(arr, col, c, row[c]); });
    appendRows_(sh, head, [arr]);
    var thumb = String(p.thumb || '');
    if (thumb && thumb.length <= LIMITS.thumb && RE_THUMB.test(thumb)) {
      var ts = ensureSheet_('thumbs');
      appendRows_(ts, header_(ts), [[id, thumb]]);
    }
    props.setProperty('REV_media', String(rev));
    props.setProperty('REV', String(rev));
    return { ok: true, v: VERSION, me: me, row: compact_(readShape_('media', arr, col)) };
  } finally {
    lock.releaseLock();
  }
}

// 一次取一批缩略图
function thumbs_(p) {
  var want = (Array.isArray(p.ids) ? p.ids : []).map(String).filter(function (x) { return RE_ID.test(x); }).slice(0, 40);
  var out = {};
  if (!want.length) return { ok: true, thumbs: out };
  var sh = ensureSheet_('thumbs'), lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, thumbs: out };
  var need = {}; want.forEach(function (x) { need['$' + x] = 1; });
  var rows = [];
  sh.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function (r, i) { var id = text_(r[0], 'id'); if (need['$' + id]) rows.push([id, i + 2]); });
  if (!rows.length) return { ok: true, thumbs: out };
  var lo = rows[0][1], hi = rows[rows.length - 1][1];
  if (hi - lo < 80) {                                       // 挨得近：一次读出来
    var block = sh.getRange(lo, 2, hi - lo + 1, 1).getValues();
    rows.forEach(function (x) { put(x[0], block[x[1] - lo][0]); });
  } else rows.forEach(function (x) { put(x[0], sh.getRange(x[1], 2).getValue()); });
  function put(id, v) { v = String(v || ''); if (RE_THUMB.test(v)) out[id] = v; }
  return { ok: true, thumbs: out };
}

// 取一个文件的内容
function media_(p) {
  var id = String(p.id || '');
  if (!RE_ID.test(id)) throw fail_('bad_request', '文件编号不对');
  var row = readRows_('media').filter(function (r) { return r.id === id && !r.deleted; })[0];
  if (!row || !row.drive_id) throw fail_('not_found', '找不到这个文件');
  var blob;
  try { blob = DriveApp.getFileById(row.drive_id).getBlob(); }
  catch (err) { throw fail_('not_found', '这个文件在 Drive 里找不到了，可能被删掉或移走了'); }
  var bytes = blob.getBytes();
  if (bytes.length > MAX_FILE_BYTES * 1.5) throw fail_('too_large', '文件太大，请在 Google Drive 里打开');
  return { ok: true, id: id, mime: row.mime, name: row.name, data: Utilities.base64Encode(bytes) };
}

function trash_(driveId, yes) {
  if (!driveId) return;
  try { DriveApp.getFileById(driveId).setTrashed(yes); } catch (err) { /* 文件已经不在了，不影响记录 */ }
}

function folder_(key) {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty(key);
  if (id) {
    try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (err) { /* 文件夹被删了，重建 */ }
  }
  ensureFolders_();
  return DriveApp.getFolderById(props.getProperty(key));
}

function ensureFolders_() {
  var props = PropertiesService.getScriptProperties();
  function alive(id) { if (!id) return null; try { var f = DriveApp.getFolderById(id); return f.isTrashed() ? null : f; } catch (err) { return null; } }
  var root = alive(props.getProperty('FOLDER_ROOT'));
  if (!root) { root = DriveApp.createFolder(ROOT_FOLDER); props.setProperty('FOLDER_ROOT', root.getId()); }
  [['FOLDER_PHOTOS', '照片'], ['FOLDER_FILES', '文件']].forEach(function (x) {
    if (!alive(props.getProperty(x[0]))) props.setProperty(x[0], root.createFolder(x[1]).getId());
  });
  return root;
}

function cleanName_(s) {
  return String(s == null ? '' : s).replace(/[\\\/:*?"<>|]/g, '_').replace(/[\r\n\t]+/g, ' ').replace(/^\.+/, '').trim().slice(0, 120);
}
function ext_(mime) { return mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg'; }

/* ====================== 读写表格的小工具 ====================== */

var SHEETS_ = {};
var HEADS_ = {};

function ensureSheet_(name) {
  if (SHEETS_[name]) return SHEETS_[name];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cols = name === 'thumbs' ? THUMB_COLS : TABLES[name];
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    format_(sh, cols);
    if (name === 'thumbs') { try { sh.hideSheet(); } catch (err) { /* 藏不起来也没关系 */ } }
  } else {
    var head = header_(sh);
    var missing = cols.filter(function (c) { return head.indexOf(c) < 0; });
    if (missing.length) {                                  // 旧表格缺列：补在最右边
      if (head.length + missing.length > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), head.length + missing.length - sh.getMaxColumns());
      sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
      delete HEADS_[name];
      format_(sh, header_(sh));
    }
  }
  SHEETS_[name] = sh;
  return sh;
}

// 表头（每次执行只读一遍）
function header_(sh) {
  var name = sh.getName();
  if (HEADS_[name]) return HEADS_[name];
  var n = sh.getLastColumn();
  var head = n ? sh.getRange(1, 1, 1, n).getValues()[0].map(function (h) { return String(h).trim().toLowerCase(); }) : [];
  if (head.length) HEADS_[name] = head;
  return head;
}
function colIndex_(head) { var col = {}; head.forEach(function (h, i) { if (h && col[h] == null) col[h] = i; }); return col; }
function fmt_(h) { return NUM_COLS[h] ? '0.###' : BOOL_COLS[h] ? 'General' : '@'; }

// 文字列设成「纯文本」：日期、编号、芯片号不会被表格自动改成别的样子
function format_(sh, head) {
  var rows = sh.getMaxRows() - 1;
  if (rows < 1) return;
  var one = head.map(fmt_), grid = [];
  for (var i = 0; i < rows; i++) grid.push(one);
  sh.getRange(2, 1, rows, head.length).setNumberFormats(grid);
  sh.setFrozenRows(1);
  try { sh.getRange(1, 1, 1, head.length).setFontWeight('bold'); } catch (err) { /* 只是好看 */ }
}

function appendRows_(sh, head, rows) {
  var start = sh.getLastRow() + 1, need = start + rows.length - 1;
  if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 200);
  var one = head.map(fmt_);
  var range = sh.getRange(start, 1, rows.length, head.length);
  range.setNumberFormats(rows.map(function () { return one; }));
  range.setValues(rows.map(function (r) { return r.map(guard_); }));
}

// 以「=」开头的文字会被表格当成公式，前面加一个单引号让它保持文字（单引号不算在内容里）
function guard_(v) { return typeof v === 'string' && /^[=']/.test(v) ? "'" + v : v; }

function set_(arr, col, name, v) {
  if (col[name] == null) return;
  if (NUM_COLS[name]) { arr[col[name]] = v === '' || v == null || !isFinite(Number(v)) ? '' : Number(v); return; }
  if (BOOL_COLS[name]) { arr[col[name]] = v === true || /^true$/i.test(String(v)) ? true : ''; return; }
  arr[col[name]] = String(v == null ? '' : v).slice(0, LIMITS[name] || 300);
}

function text_(v, colName) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {   // 有人在表格里把格子改成了日期格式
    if (/_at$/.test(colName || '')) return v.toISOString();
    return Utilities.formatDate(v, Session.getScriptTimeZone(), colName === 'time' ? 'HH:mm' : 'yyyy-MM-dd');
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v).trim();
}
function num_(v) { if (v === '' || v == null || typeof v === 'boolean') return ''; var n = Number(v); return isFinite(n) ? n : ''; }
function bool_(v) { return v === true || /^true$/i.test(String(v).trim()); }
function isoOr_(v, dflt) { v = String(v || ''); return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) ? v : dflt; }

function readShape_(t, r, col) {
  var o = {};
  TABLES[t].forEach(function (c) {
    var v = col[c] == null ? '' : r[col[c]];
    o[c] = NUM_COLS[c] ? num_(v) : BOOL_COLS[c] ? bool_(v) : text_(v, c);
  });
  if (o.rev === '') o.rev = 0;
  return o;
}

// 读一张表的全部行。容忍空行、多出来的列、手工改过的格子。
function readRows_(t) {
  var sh = ensureSheet_(t), lastRow = sh.getLastRow(), head = header_(sh);
  if (lastRow < 2 || !head.length) return [];
  var col = colIndex_(head), out = [];
  sh.getRange(2, 1, lastRow - 1, head.length).getValues().forEach(function (r) {
    var o = readShape_(t, r, col);
    if (o.id && RE_ID.test(o.id)) out.push(o);
  });
  return out;
}

// 发给网页前去掉空的项，省流量
function compact_(o) {
  var out = {};
  Object.keys(o).forEach(function (k) { if (o[k] !== '' && o[k] !== false && o[k] != null) out[k] = o[k]; });
  return out;
}

/* ====================== 在表格里手工改了内容 ====================== */

// 有人直接在表格里改了某一行：给那一行记上新的版本号，手机下次同步就能看到。没有编号的新行补一个编号。
function onEdit(e) {
  try {
    var sh = e.range.getSheet(), t = sh.getName();
    if (!Object.prototype.hasOwnProperty.call(TABLES, t)) return;
    var first = Math.max(2, e.range.getRow()), last = Math.min(e.range.getLastRow(), first + 199);
    if (last < first) return;
    var head = header_(sh), col = colIndex_(head);
    if (col.rev == null || col.id == null) return;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return;
    try {
      var props = PropertiesService.getScriptProperties();
      var rev = Number(props.getProperty('REV') || 0) + 1, n = last - first + 1;
      var block = sh.getRange(first, 1, n, head.length).getValues(), ids = [], revs = [], any = false;
      block.forEach(function (r) {
        var filled = r.some(function (v, i) { return i !== col.rev && i !== col.id && v !== ''; });
        var id = text_(r[col.id], 'id');
        if (filled && !id) id = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
        ids.push([id]);
        revs.push([filled || id ? rev : r[col.rev]]);
        if (filled || id) any = true;
      });
      if (!any) return;
      sh.getRange(first, col.id + 1, n, 1).setValues(ids);
      sh.getRange(first, col.rev + 1, n, 1).setValues(revs);
      props.setProperty('REV_' + t, String(rev));
      props.setProperty('REV', String(rev));
    } finally {
      lock.releaseLock();
    }
  } catch (err) { /* 手工编辑的补记只是锦上添花，出错不打扰人 */ }
}

/* ====================== 初始化和菜单（在表格里或编辑器里运行）====================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('CatLog')
    .addItem('初始化 / 检查表格', 'setup')
    .addItem('生成初始化链接', 'showInitLinks')
    .addSeparator()
    .addItem('重置口令（两部手机都要重新初始化）', 'resetTokens')
    .addToUi();
}

// 第一次运行：建好工作表、默认成员、口令、Drive 文件夹。重复运行不会动已有的数据。
function setup() {
  var props = PropertiesService.getScriptProperties();
  Object.keys(TABLES).concat(['thumbs']).forEach(function (t) { ensureSheet_(t); });
  var members = readRows_('members'), now = new Date().toISOString();
  var ms = ensureSheet_('members'), mh = header_(ms), mc = colIndex_(mh), add = [];
  [['a', '成员 A', '#2a78d6'], ['b', '成员 B', '#eb6834']].forEach(function (m) {
    if (members.some(function (r) { return r.id === m[0]; })) return;
    var arr = []; for (var i = 0; i < mh.length; i++) arr.push('');
    set_(arr, mc, 'id', m[0]); set_(arr, mc, 'name', m[1]); set_(arr, mc, 'color', m[2]); set_(arr, mc, 'updated_at', now); set_(arr, mc, 'rev', 1);
    add.push(arr);
  });
  if (add.length) appendRows_(ms, mh, add);
  var settings = readRows_('settings');
  if (!settings.some(function (r) { return r.id === 'unit'; })) {
    var ss = ensureSheet_('settings'), sh = header_(ss), sc = colIndex_(sh), arr = [];
    for (var i = 0; i < sh.length; i++) arr.push('');
    set_(arr, sc, 'id', 'unit'); set_(arr, sc, 'value', 'kg'); set_(arr, sc, 'note', '体重单位：kg 或 lb'); set_(arr, sc, 'updated_at', now); set_(arr, sc, 'rev', 1);
    appendRows_(ss, sh, [arr]);
  }
  if (!Number(props.getProperty('REV') || 0)) {
    props.setProperty('REV', '1');
    Object.keys(TABLES).forEach(function (t) { props.setProperty('REV_' + t, '1'); });
  }
  ensureTokens_(props);
  var root = ensureFolders_();
  var msg = '准备好了。\n\n· 工作表：' + Object.keys(TABLES).join('、') + '\n· Drive 文件夹：「' + ROOT_FOLDER + '」\n  ' + root.getUrl() +
    '\n\n下一步：右上角「部署 → 新建部署 → 网页应用」，然后回到表格用菜单「CatLog → 生成初始化链接」。';
  Logger.log(msg);
  // 用右下角的小提示，不用弹窗：从编辑器里运行时，弹窗会让脚本一直等着有人去表格里点「确定」
  try { SpreadsheetApp.getActiveSpreadsheet().toast('工作表、口令、Drive 文件夹都准备好了。下一步：部署成网页应用。', 'CatLog 准备好了', 20); } catch (err) { /* 提示出不来就看执行日志 */ }
}

function ensureTokens_(props) {
  ['TOKEN_A', 'TOKEN_B'].forEach(function (k) { if (!props.getProperty(k)) props.setProperty(k, newToken_()); });
}
function newToken_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }

function resetTokens() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('TOKEN_A', newToken_());
  props.setProperty('TOKEN_B', newToken_());
  var msg = '口令已经换成新的。原来的初始化链接全部作废，请重新「生成初始化链接」，两部手机各打开一次。';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert('CatLog', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (err) { /* 看执行日志 */ }
}

function okApi_(u) { return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/.test(String(u || '')); }
function okPage_(u) { return /^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9._~\/-]*$/.test(String(u || '')); }
function initLink_(page, api, token, who) {
  var code = Utilities.base64EncodeWebSafe(JSON.stringify({ v: 1, u: api, t: token, w: who })).replace(/=+$/, '');
  return page + '#init=' + code;
}

// 弹窗里点「生成」时调用
function makeLinks(api, page) {
  api = String(api || '').trim(); page = String(page || '').trim().replace(/#.*$/, '');
  if (!okApi_(api)) throw new Error('接口地址不对。应该是部署时复制的网页应用网址：以 https://script.google.com/macros/s/ 开头，以 /exec 结尾。');
  if (page && !/\/$/.test(page) && !/\.html$/.test(page)) page += '/';
  if (!okPage_(page)) throw new Error('页面地址不对。应该是 GitHub Pages 的地址，比如 https://你的用户名.github.io/catlog/');
  var props = PropertiesService.getScriptProperties();
  ensureTokens_(props);
  props.setProperty('API_URL', api);
  props.setProperty('PAGE_URL', page);
  var names = {};
  readRows_('members').forEach(function (r) { names[r.id] = r.name; });
  return {
    a: { name: names.a || '成员 A', link: initLink_(page, api, props.getProperty('TOKEN_A'), 'a') },
    b: { name: names.b || '成员 B', link: initLink_(page, api, props.getProperty('TOKEN_B'), 'b') }
  };
}

function showInitLinks() {
  var props = PropertiesService.getScriptProperties();
  var api = props.getProperty('API_URL') || FALLBACK_API_URL;
  var page = props.getProperty('PAGE_URL') || FALLBACK_PAGE_URL;
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var html = '<!doctype html><html><head><base target="_blank"><meta charset="utf-8"><style>' +
    'body{font:14px/1.5 system-ui,sans-serif;margin:16px;color:#1f2530}label{display:block;margin:12px 0 4px;font-weight:600}' +
    'input,textarea{width:100%;box-sizing:border-box;font:13px/1.4 ui-monospace,monospace;padding:8px;border:1px solid #c5cad3;border-radius:6px}' +
    'textarea{height:74px}button{font:inherit;padding:8px 14px;border-radius:6px;border:1px solid #1f2530;background:#1f2530;color:#fff;cursor:pointer;margin-top:12px}' +
    'button.s{background:#fff;color:#1f2530;margin:6px 0 0}.err{color:#b3261e;margin-top:10px;white-space:pre-wrap}.hint{color:#5e6675;font-size:12px}' +
    '</style></head><body>' +
    '<label for="api">接口地址（部署时复制的网页应用网址）</label><input id="api" value="' + esc(api) + '" placeholder="https://script.google.com/macros/s/…/exec">' +
    '<label for="page">页面地址（GitHub Pages）</label><input id="page" value="' + esc(page) + '" placeholder="https://你的用户名.github.io/catlog/">' +
    '<button id="go">生成两条链接</button><div class="err" id="err"></div><div id="out"></div>' +
    '<p class="hint">每人一条，在自己的 iPhone 上用 Safari 打开一次。链接里带着口令，不要发到公开的地方。</p>' +
    '<script>' +
    'function $(i){return document.getElementById(i)}' +
    'function row(who,o){var d=document.createElement("div");var l=document.createElement("label");l.textContent=o.name+" 的链接";var t=document.createElement("textarea");t.readOnly=true;t.value=o.link;' +
    'var b=document.createElement("button");b.className="s";b.textContent="复制";b.onclick=function(){t.select();try{document.execCommand("copy");b.textContent="已复制"}catch(e){b.textContent="请手动复制"}};' +
    'd.appendChild(l);d.appendChild(t);d.appendChild(b);return d}' +
    '$("go").onclick=function(){$("err").textContent="";$("out").textContent="正在生成…";' +
    'google.script.run.withSuccessHandler(function(r){$("out").textContent="";$("out").appendChild(row("a",r.a));$("out").appendChild(row("b",r.b))})' +
    '.withFailureHandler(function(e){$("out").textContent="";$("err").textContent=e.message||String(e)}).makeLinks($("api").value,$("page").value)};' +
    '</script></body></html>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(560).setHeight(560), '生成初始化链接');
}

// 备用办法：弹窗打不开时（比如同时登录了几个 Google 账号），在编辑器里运行这个函数，到「执行日志」里看链接。
function printInitLinks() {
  var props = PropertiesService.getScriptProperties();
  var api = FALLBACK_API_URL || props.getProperty('API_URL');
  var page = FALLBACK_PAGE_URL || props.getProperty('PAGE_URL');
  if (!api || !page) { Logger.log('请先在文件最上面填好 FALLBACK_API_URL 和 FALLBACK_PAGE_URL，保存后再运行一次。'); return; }
  var r = makeLinks(api, page);
  Logger.log(r.a.name + ' 的链接：\n' + r.a.link + '\n\n' + r.b.name + ' 的链接：\n' + r.b.link);
}
