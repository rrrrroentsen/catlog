// 在 Node 里模拟 Apps Script 的运行环境，直接运行真实的 Code.gs。
// 模拟的东西：表格（含「按用户输入的方式」自动转换格子内容、纯文本格式、单格 5 万字上限、公式）、
// 脚本属性、锁、缓存、Drive 文件夹和文件、Utilities、ContentService、HtmlService、界面菜单。
// 这是模拟，不是真的 Google：细节以真实环境为准。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const CELL_LIMIT = 50000;

function isEmpty(v) { return v === '' || v == null; }

// 「用户输入」语义：往一个格子里写值时表格会怎么理解
function convert(v, fmt) {
  if (v == null) return '';
  if (typeof v === 'string') {
    if (v.length > CELL_LIMIT) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
    if (v[0] === "'") return v.slice(1);                     // 开头的单引号：后面的内容当文字
    if (v[0] === '=') return { formula: v };                  // 公式（纯文本格式也拦不住脚本写进来的公式）
    if (fmt === '@') return v;
    if (/^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
    if (/^(true|false)$/i.test(v.trim())) return /^true$/i.test(v.trim());
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v.trim());
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const tm = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
    if (tm) return new Date(1899, 11, 30, +tm[1], +tm[2]);
    return v;
  }
  if (typeof v === 'number' && fmt === '@') return String(v);
  return v;
}
function readBack(v) { return v && typeof v === 'object' && v.formula ? '#NAME?' : (v == null ? '' : v); }

class Range {
  constructor(sheet, row, col, nr, nc) {
    if (!(row >= 1 && col >= 1 && nr >= 1 && nc >= 1)) throw new Error('The starting row/column of the range is too small.');
    if (row + nr - 1 > sheet.maxRows || col + nc - 1 > sheet.maxCols) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    Object.assign(this, { sheet, row, col, nr, nc });
  }
  getSheet() { return this.sheet; }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
  getLastRow() { return this.row + this.nr - 1; }
  getValues() {
    this.sheet.env.stats.reads++;
    const out = [];
    for (let r = 0; r < this.nr; r++) { const line = []; for (let c = 0; c < this.nc; c++) line.push(readBack(this.sheet.cell(this.row + r, this.col + c))); out.push(line); }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(grid) {
    this.sheet.env.stats.writes++;
    if (!Array.isArray(grid) || grid.length !== this.nr || grid.some((r) => !Array.isArray(r) || r.length !== this.nc)) {
      throw new Error('The number of rows or columns in the data does not match the range. The data has ' + (grid && grid.length) + ' but the range has ' + this.nr + '.');
    }
    for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) this.sheet.put(this.row + r, this.col + c, grid[r][c]);
    return this;
  }
  setValue(v) { const g = []; for (let r = 0; r < this.nr; r++) { const l = []; for (let c = 0; c < this.nc; c++) l.push(v); g.push(l); } return this.setValues(g); }
  setNumberFormats(grid) {
    if (!Array.isArray(grid) || grid.length !== this.nr || grid.some((r) => r.length !== this.nc)) throw new Error('The number of rows or columns in the formats does not match the range.');
    for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) {
      if (typeof grid[r][c] !== 'string' || !grid[r][c]) throw new Error('Invalid number format');
      this.sheet.fmt(this.row + r, this.col + c, grid[r][c]);
    }
    return this;
  }
  setNumberFormat(f) { const g = []; for (let r = 0; r < this.nr; r++) { const l = []; for (let c = 0; c < this.nc; c++) l.push(f); g.push(l); } return this.setNumberFormats(g); }
  setFontWeight() { return this; }
}

class Sheet {
  constructor(env, name) { this.env = env; this.name = name; this.rows = []; this.formats = []; this.maxRows = 1000; this.maxCols = 26; this.frozen = 0; this.hidden = false; }
  getName() { return this.name; }
  cell(r, c) { const row = this.rows[r - 1]; return row ? row[c - 1] : ''; }
  format(r, c) { const row = this.formats[r - 1]; return (row && row[c - 1]) || 'General'; }
  fmt(r, c, f) { (this.formats[r - 1] = this.formats[r - 1] || [])[c - 1] = f; }
  put(r, c, v) { (this.rows[r - 1] = this.rows[r - 1] || [])[c - 1] = convert(v, this.format(r, c)); }
  // 用户在界面上直接改格子（测试 onEdit 用）
  typeIn(r, c, v) { this.put(r, c, v); return { range: new Range(this, r, c, 1, 1) }; }
  getLastRow() { for (let r = this.rows.length; r >= 1; r--) { const row = this.rows[r - 1]; if (row && row.some((v) => !isEmpty(v))) return r; } return 0; }
  getLastColumn() { let n = 0; this.rows.forEach((row) => { if (row) for (let c = row.length; c > n; c--) if (!isEmpty(row[c - 1])) { n = c; break; } }); return n; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(after, n) { if (after !== this.maxRows) throw new Error('模拟环境只支持在最后面加行'); this.maxRows += n; return this; }
  insertColumnsAfter(after, n) { if (after !== this.maxCols) throw new Error('模拟环境只支持在最后面加列'); this.maxCols += n; return this; }
  getRange(row, col, nr, nc) { return new Range(this, row, col, nr == null ? 1 : nr, nc == null ? 1 : nc); }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  setFrozenRows(n) { this.frozen = n; return this; }
  hideSheet() { this.hidden = true; return this; }
  appendRow(arr) { const r = this.getLastRow() + 1; if (r > this.maxRows) this.maxRows = r; arr.forEach((v, i) => this.put(r, i + 1, v)); return this; }
  // 测试里看内容用：把一张表读成对象数组
  objects() {
    const last = this.getLastRow(); if (last < 1) return [];
    const head = (this.rows[0] || []).map((h) => String(h == null ? '' : h));
    const out = [];
    for (let r = 2; r <= last; r++) { const o = {}; head.forEach((h, i) => { if (h) o[h] = readBack(this.cell(r, i + 1)); }); out.push(o); }
    return out;
  }
}

function toSigned(buf) { const out = new Array(buf.length); for (let i = 0; i < buf.length; i++) out[i] = buf[i] > 127 ? buf[i] - 256 : buf[i]; return out; }
function toBuffer(bytes) { return Buffer.from(Array.from(bytes, (b) => (b < 0 ? b + 256 : b))); }

function createEnv(opts) {
  opts = opts || {};
  const codePath = opts.code || path.join(__dirname, '..', 'app', 'Code.gs');
  let script = new vm.Script(fs.readFileSync(codePath, 'utf8'), { filename: path.basename(codePath) });
  const env = {
    sheets: [], props: new Map(), cache: new Map(), folders: new Map(), files: new Map(), logs: [], alerts: [], toasts: [], menus: [], dialogs: [],
    stats: { reads: 0, writes: 0, locks: 0, unlocks: 0, driveReads: 0 },
    lockBusy: false, cacheBroken: false, ui: opts.ui !== false, serviceUrl: opts.serviceUrl || '', tz: 'America/Chicago', seq: 0,
  };
  const newId = (p) => p + crypto.randomBytes(14).toString('base64url');

  function mkFolder(name) {
    const f = { id: newId('fo_'), name, trashed: false, children: [],
      getId() { return f.id; }, getName() { return f.name; }, getUrl() { return 'https://drive.google.com/drive/folders/' + f.id; },
      isTrashed() { return f.trashed; }, setTrashed(b) { f.trashed = !!b; return f; },
      createFolder(n) { const c = mkFolder(n); f.children.push(c); return c; },
      createFile(blob) { const x = mkFile(blob, f); f.children.push(x); return x; } };
    env.folders.set(f.id, f);
    return f;
  }
  function mkFile(blob, parent) {
    const x = { id: newId('fi_'), name: blob.getName(), mime: blob.getContentType(), bytes: blob.getBytes().slice(), trashed: false, parent,
      getId() { return x.id; }, getName() { return x.name; }, getSize() { return x.bytes.length; }, getUrl() { return 'https://drive.google.com/file/d/' + x.id + '/view'; },
      isTrashed() { return x.trashed; }, setTrashed(b) { x.trashed = !!b; return x; },
      getBlob() { env.stats.driveReads++; return mkBlob(x.bytes, x.mime, x.name); } };
    env.files.set(x.id, x);
    return x;
  }
  function mkBlob(bytes, mime, name) { return { getBytes() { return bytes; }, getContentType() { return mime; }, getName() { return name; } }; }

  const ss = {
    getSheetByName(n) { return env.sheets.find((s) => s.name === n) || null; },
    insertSheet(n) { if (ss.getSheetByName(n)) throw new Error('A sheet with the name "' + n + '" already exists.'); const s = new Sheet(env, n); env.sheets.push(s); return s; },
    getSheets() { return env.sheets.slice(); },
    getName() { return 'CatLog'; },
    toast(msg, title) { env.toasts.push([title || '', msg]); },
  };
  const ui = {
    ButtonSet: { OK: 'OK' },
    alert() { env.alerts.push(Array.from(arguments)); },
    showModalDialog(out, title) { env.dialogs.push({ title, html: out.content }); },
    createMenu(name) { const m = { name, items: [], addItem(l, f) { m.items.push([l, f]); return m; }, addSeparator() { return m; }, addToUi() { env.menus.push(m); } }; return m; },
  };

  const services = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getActive: () => ss, getUi() { if (!env.ui) throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); return ui; } },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (env.props.has(k) ? env.props.get(k) : null),
      setProperty(k, v) { env.props.set(k, String(v)); return this; },
      deleteProperty(k) { env.props.delete(k); return this; },
      getProperties: () => Object.fromEntries(env.props),
    }) },
    LockService: { getScriptLock: () => ({
      tryLock() { if (env.lockBusy) return false; env.stats.locks++; return true; },
      waitLock() { if (env.lockBusy) throw new Error('Lock timeout'); env.stats.locks++; },
      releaseLock() { env.stats.unlocks++; },
      hasLock: () => true,
    }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => (env.cache.has(k) ? env.cache.get(k) : null),
      put(k, v) { if (env.cacheBroken) throw new Error('cache down'); env.cache.set(k, String(v)); },
      getAll(keys) { if (env.cacheBroken) return {}; const o = {}; keys.forEach((k) => { if (env.cache.has(k)) o[k] = env.cache.get(k); }); return o; },
      putAll(obj) { if (env.cacheBroken) throw new Error('cache down'); Object.keys(obj).forEach((k) => env.cache.set(k, String(obj[k]))); },
      remove(k) { env.cache.delete(k); },
    }) },
    DriveApp: {
      createFolder: (n) => mkFolder(n),
      getFolderById(id) { const f = env.folders.get(id); if (!f) throw new Error('No item with the given ID could be found.'); return f; },
      getFileById(id) { const f = env.files.get(id); if (!f) throw new Error('No item with the given ID could be found.'); return f; },
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      base64Decode(s) { if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 === 1) throw new Error('Could not decode string.'); return toSigned(Buffer.from(s, 'base64')); },
      base64Encode(b) { return (typeof b === 'string' ? Buffer.from(b, 'utf8') : toBuffer(b)).toString('base64'); },
      base64EncodeWebSafe(b) { return (typeof b === 'string' ? Buffer.from(b, 'utf8') : toBuffer(b)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'); },
      newBlob(data, mime, name) { return mkBlob(typeof data === 'string' ? toSigned(Buffer.from(data, 'utf8')) : data, mime || 'application/octet-stream', name || ''); },
      formatDate(d, tz, f) {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]));
        if (f === 'yyyy-MM-dd') return parts.year + '-' + parts.month + '-' + parts.day;
        if (f === 'HH:mm') return parts.hour + ':' + parts.minute;
        throw new Error('模拟环境不认识这个日期格式：' + f);
      },
      sleep() {},
    },
    Session: { getScriptTimeZone: () => env.tz },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput(s) { const o = { content: s, mime: '', setMimeType(m) { o.mime = m; return o; }, getContent() { return o.content; } }; return o; } },
    HtmlService: { createHtmlOutput(html) { const o = { content: html, setWidth() { return o; }, setHeight() { return o; } }; return o; } },
    ScriptApp: { getService: () => ({ getUrl: () => env.serviceUrl }) },
    Logger: { log(m) { env.logs.push(String(m)); } },
    console: { log() {}, error() {}, warn() {} },
  };

  // 真实环境里每次请求都是全新的全局状态，这里也每次重新跑一遍脚本
  function fresh() { const ctx = vm.createContext(Object.assign({}, services)); script.runInContext(ctx); return ctx; }
  env.call = function (name) { const ctx = fresh(); if (typeof ctx[name] !== 'function') throw new Error('Code.gs 里没有函数 ' + name); return ctx[name].apply(null, Array.prototype.slice.call(arguments, 1)); };
  env.postRaw = function (text) { const out = env.call('doPost', { postData: { contents: text } }); return out.getContent(); };
  env.post = function (obj) { return JSON.parse(env.postRaw(JSON.stringify(obj))); };
  env.get = function () { return JSON.parse(env.call('doGet', {}).getContent()); };
  // 换一份后端代码（模拟「粘贴新的 Code.gs、发新版本」），表格、口令、文件都不动
  env.setCode = function (file) { script = new vm.Script(fs.readFileSync(file, 'utf8'), { filename: path.basename(file) }); };
  env.sheet = (n) => ss.getSheetByName(n);
  env.rows = (n) => (ss.getSheetByName(n) ? ss.getSheetByName(n).objects() : []);
  env.token = (who) => env.props.get(who === 'b' ? 'TOKEN_B' : 'TOKEN_A');
  env.edit = function (sheetName, r, c, v) { const e = ss.getSheetByName(sheetName).typeIn(r, c, v); env.call('onEdit', e); };
  return env;
}

module.exports = { createEnv, Sheet, toSigned, toBuffer };
