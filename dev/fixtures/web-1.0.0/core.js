/* CatLog 猫咪日志 —— 计算和数据规则。不碰界面，Node 里可以直接 require。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CL = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var CL = { VERSION: '1.0.0' };

  // ---------- 小工具 ----------
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function map() { return Object.create(null); }
  function vals(m) { var out = []; for (var k in m) out.push(m[k]); return out; }
  CL.vals = vals;
  CL.map = map;

  // ---------- 日期（全部按「YYYY-MM-DD」字符串处理，天数差按 UTC 算，夏令时不会多一天少一天）----------
  var RE_YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
  CL.ymd = function (d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
  CL.today = function (now) { return CL.ymd(now || new Date()); };
  CL.hm = function (d) { d = d || new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
  CL.isYmd = function (s) {
    var m = RE_YMD.exec(String(s == null ? '' : s)); if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false;
    return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
  };
  CL.utc = function (s) { var m = RE_YMD.exec(s); return Date.UTC(+m[1], +m[2] - 1, +m[3]); };
  CL.fromUtc = function (ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); };
  CL.diffDays = function (a, b) { return Math.round((CL.utc(b) - CL.utc(a)) / 86400000); };
  CL.addDays = function (s, n) { return CL.fromUtc(CL.utc(s) + n * 86400000); };
  CL.addMonths = function (s, n) {
    var m = RE_YMD.exec(s), y = +m[1], mo = +m[2] - 1 + n, d = +m[3];
    y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
    var last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    return y + '-' + pad2(mo + 1) + '-' + pad2(Math.min(d, last));
  };
  CL.weekday = function (s) { return new Date(CL.utc(s)).getUTCDay(); };
  var WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  CL.fmtDate = function (s, style) {
    var m = RE_YMD.exec(String(s || '')); if (!m) return '';
    var y = +m[1], mo = +m[2], d = +m[3];
    if (style === 'ymd') return y + ' 年 ' + mo + ' 月 ' + d + ' 日';
    if (style === 'full') return y + ' 年 ' + mo + ' 月 ' + d + ' 日 ' + WD[CL.weekday(s)];
    if (style === 'ym') return y + ' 年 ' + mo + ' 月';
    if (style === 'dw') return d + ' 日 ' + WD[CL.weekday(s)];
    if (style === 'num') return y + '/' + mo + '/' + d;
    return mo + ' 月 ' + d + ' 日';
  };
  // 相对今天的说法；远了就给日期
  CL.relDay = function (s, today) {
    var n = CL.diffDays(s, today);
    if (n === 0) return '今天'; if (n === 1) return '昨天'; if (n === 2) return '前天';
    if (n === -1) return '明天'; if (n === -2) return '后天';
    if (n > 2 && n < 31) return n + ' 天前';
    if (n < -2 && n > -31) return (-n) + ' 天后';
    return s.slice(0, 4) === today.slice(0, 4) ? CL.fmtDate(s) : CL.fmtDate(s, 'ymd');
  };
  CL.dueText = function (days) { return days < 0 ? '已过期 ' + (-days) + ' 天' : days === 0 ? '今天到期' : '还有 ' + days + ' 天'; };

  // ---------- 年龄 ----------
  CL.age = function (birth, at) {
    if (!CL.isYmd(birth) || !CL.isYmd(at)) return null;
    var days = CL.diffDays(birth, at); if (days < 0) return null;
    var b = RE_YMD.exec(birth), a = RE_YMD.exec(at);
    var n = (+a[1] - +b[1]) * 12 + (+a[2] - +b[2]);
    if (CL.addMonths(birth, n) > at) n--;
    return { y: Math.floor(n / 12), m: n % 12, d: CL.diffDays(CL.addMonths(birth, n), at), months: n, days: days };
  };
  CL.ageLabel = function (birth, at) {
    var g = CL.age(birth, at); if (!g) return '';
    if (g.days < 14) return g.days + ' 天';
    if (g.days < 56) return Math.floor(g.days / 7) + ' 周';
    if (g.months < 12) return g.months + ' 个月';
    return g.y + ' 岁' + (g.m ? ' ' + g.m + ' 个月' : '');
  };
  // 月龄的说法（相册分组用）
  CL.monthsLabel = function (n) {
    if (n < 1) return '不满 1 个月';
    if (n < 12) return n + ' 个月';
    return Math.floor(n / 12) + ' 岁' + (n % 12 ? ' ' + (n % 12) + ' 个月' : '');
  };

  // ---------- 体重（表里一律存 kg）----------
  CL.KG_PER_LB = 0.45359237;
  CL.UNITS = ['kg', 'lb'];
  CL.toUnit = function (kg, unit) { return unit === 'lb' ? kg / CL.KG_PER_LB : kg; };
  CL.fmtWeight = function (kg, unit) { return CL.toUnit(kg, unit).toFixed(2); };
  CL.fmtDelta = function (dkg, unit) { var v = CL.toUnit(dkg, unit); return (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(2); };
  CL.parseWeight = function (text, unit) {
    var s = String(text == null ? '' : text).trim()
      .replace(/[０-９]/g, function (c) { return String(c.charCodeAt(0) - 65296); })
      .replace(/[，,]/g, '.').replace(/[．。]/g, '.').replace(/\s*(kg|公斤|千克|lb|lbs|磅)$/i, '');
    if (!/^\d{1,3}(\.\d{1,3})?$/.test(s)) return null;
    var kg = unit === 'lb' ? Number(s) * CL.KG_PER_LB : Number(s);
    kg = Math.round(kg * 1000) / 1000;
    return kg >= 0.03 && kg <= 60 ? kg : null;
  };

  // ---------- 各种选项 ----------
  CL.KIND_LIST = ['weight', 'daily', 'food', 'activity', 'health', 'moment'];
  CL.KINDS = {
    weight: { label: '体重' }, daily: { label: '日常' }, food: { label: '饮食' },
    activity: { label: '活动' }, health: { label: '健康' }, moment: { label: '瞬间' },
    vaccine: { label: '疫苗' }, deworm: { label: '驱虫' }
  };
  // 日常状态：s 是程度，1 正常、2 留意、3 异常
  CL.DAILY = [
    { k: 'app', label: '食欲', normal: 3, opts: [{ v: 1, l: '不吃', s: 3 }, { v: 2, l: '偏少', s: 2 }, { v: 3, l: '正常', s: 1 }, { v: 4, l: '很好', s: 1 }] },
    { k: 'water', label: '饮水', normal: 2, opts: [{ v: 1, l: '偏少', s: 2 }, { v: 2, l: '正常', s: 1 }, { v: 3, l: '偏多', s: 2 }] },
    { k: 'energy', label: '精神', normal: 2, opts: [{ v: 1, l: '没精神', s: 3 }, { v: 2, l: '正常', s: 1 }, { v: 3, l: '很活跃', s: 1 }] },
    { k: 'poop', label: '大便', normal: 1, opts: [{ v: 0, l: '没拉', s: 1 }, { v: 1, l: '正常', s: 1 }, { v: 2, l: '偏软', s: 2 }, { v: 3, l: '拉稀', s: 3 }, { v: 4, l: '偏干', s: 2 }] },
    { k: 'pee', label: '小便', normal: 1, opts: [{ v: 1, l: '正常', s: 1 }, { v: 2, l: '偏少', s: 2 }, { v: 3, l: '偏多', s: 2 }] },
    { k: 'vomit', label: '呕吐', normal: 0, opts: [{ v: 0, l: '没有', s: 1 }, { v: 1, l: '1 次', s: 2 }, { v: 2, l: '2 次', s: 3 }, { v: 3, l: '3 次以上', s: 3 }] }
  ];
  CL.FLAGS = [['sneeze', '打喷嚏'], ['cough', '咳嗽'], ['eye', '流泪眼屎'], ['ear', '挠耳朵'], ['itch', '抓挠掉毛'],
    ['lick', '过度舔毛'], ['limp', '走路不对劲'], ['hide', '躲起来'], ['peeout', '乱尿'], ['mouth', '口臭流口水']];
  CL.FOOD = [['dry', '干粮'], ['wet', '罐头湿粮'], ['freeze', '冻干'], ['treat', '零食'], ['raw', '生食自制'], ['supp', '营养品'], ['other', '其他']];
  CL.ACT = [['play', '玩耍'], ['wand', '逗猫棒'], ['zoom', '跑酷'], ['sun', '晒太阳'], ['out', '外出'], ['train', '训练'],
    ['bath', '洗澡'], ['nail', '剪指甲'], ['brush', '梳毛'], ['teeth', '刷牙'], ['ear', '清耳朵'], ['other', '其他']];
  CL.ACT_CARE_FROM = 6; // 从这一项起算「护理」
  CL.HEALTH = [['symptom', '不舒服'], ['vet', '看医生'], ['med', '用药'], ['surgery', '手术'], ['checkup', '体检'], ['injury', '受伤'], ['other', '其他']];
  CL.SEV = [[1, '轻'], [2, '中'], [3, '重']];
  CL.DOC_CATS = [['vaccine', '疫苗证明'], ['checkup', '体检报告'], ['lab', '化验单'], ['record', '病历'], ['receipt', '收据账单'],
    ['id', '证件芯片'], ['insure', '保险'], ['adopt', '领养购买'], ['other', '其他']];
  CL.SPECIES = [['cat', '猫'], ['dog', '狗'], ['other', '其他']];
  CL.SEX = [['f', '妹妹'], ['m', '弟弟']];
  CL.PET_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#6250d6', '#e87ba4', '#eda100'];
  CL.MEMBER_COLORS = { a: '#2a78d6', b: '#eb6834' };
  function label(list, v) { for (var i = 0; i < list.length; i++) if (list[i][0] === v) return list[i][1]; return ''; }
  function keys(list) { return list.map(function (x) { return x[0]; }); }
  CL.label = label;

  // 疫苗和驱虫的常见项。core 是「即使还没记录也在状态板上列出来」的
  var DEWORM = [{ code: 'both', name: '内外同驱' }, { code: 'inner', name: '体内驱虫' }, { code: 'outer', name: '体外驱虫' }];
  CL.PRESETS = {
    cat: { vaccine: [{ code: 'fvrcp', name: '猫三联', en: 'FVRCP', core: true }, { code: 'rabies', name: '狂犬疫苗', en: 'Rabies', core: true }, { code: 'felv', name: '猫白血病', en: 'FeLV' }], deworm: DEWORM },
    dog: { vaccine: [{ code: 'dhpp', name: '犬联苗', en: 'DHPP', core: true }, { code: 'rabies', name: '狂犬疫苗', en: 'Rabies', core: true }, { code: 'bord', name: '犬窝咳', en: 'Bordetella' }, { code: 'lepto', name: '钩端螺旋体', en: 'Lepto' }], deworm: DEWORM },
    other: { vaccine: [{ code: 'rabies', name: '狂犬疫苗', en: 'Rabies' }], deworm: DEWORM }
  };
  CL.presets = function (species, kind) { return (CL.PRESETS[species] || CL.PRESETS.cat)[kind === 'deworm' ? 'deworm' : 'vaccine']; };
  // 「下次」的快捷间隔：[说法, 月数, 天数]
  CL.STEPS = { vaccine: [['3 周后', 0, 21], ['4 周后', 0, 28], ['1 年后', 12, 0], ['3 年后', 36, 0]], deworm: [['1 个月后', 1, 0], ['3 个月后', 3, 0], ['6 个月后', 6, 0]] };
  CL.SOON_DAYS = 30;

  // ---------- 清洗（所有进来的数据都先过这里：表格、本机缓存、表单）----------
  var CTRL = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(8) + String.fromCharCode(11) + String.fromCharCode(12) + String.fromCharCode(14) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']', 'g');
  function str(v, max) {
    if (v == null) return '';
    v = String(v).replace(CTRL, '');
    if (v.length > max) {
      v = v.slice(0, max);
      var c = v.charCodeAt(v.length - 1);
      if (c >= 0xD800 && c <= 0xDBFF) v = v.slice(0, -1); // 不把一个表情切成两半
    }
    return v;
  }
  function line(v, max) { return str(v, max).replace(/[\r\n\t]+/g, ' ').trim(); }
  function ymdOr(v) { return CL.isYmd(v) ? String(v) : ''; }
  function oneOf(v, list, dflt) { return list.indexOf(v) >= 0 ? v : dflt; }
  function int(v, lo, hi, dflt) { if (v === '' || v == null || typeof v === 'boolean') return dflt; v = Number(v); if (!isFinite(v)) return dflt; v = Math.round(v); return v < lo || v > hi ? dflt : v; }
  var RE_ID = /^[A-Za-z0-9_-]{1,64}$/;
  function idOr(v) { v = String(v == null ? '' : v); return RE_ID.test(v) ? v : ''; }
  function idList(v) {
    var arr = Array.isArray(v) ? v : String(v == null ? '' : v).split(','), out = [], seen = map();
    for (var i = 0; i < arr.length && out.length < 24; i++) { var id = idOr(String(arr[i]).trim()); if (id && !seen[id]) { seen[id] = 1; out.push(id); } }
    return out;
  }
  function iso(v) { v = String(v == null ? '' : v); return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) ? v : ''; }
  function hmOr(v) { v = String(v == null ? '' : v); return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : ''; }
  function color(v) { v = String(v == null ? '' : v).toLowerCase(); return /^#[0-9a-f]{6}$/.test(v) ? v : ''; }
  function bool(v) { return v === true || v === 1 || /^(true|1|y|yes)$/i.test(String(v)); }
  function who(v) { return oneOf(String(v == null ? '' : v), ['a', 'b'], ''); }
  function meta(r, o) { o.created_by = who(r.created_by); o.created_at = iso(r.created_at); o.updated_by = who(r.updated_by); o.updated_at = iso(r.updated_at); o.rev = int(r.rev, 0, 1e15, 0); return o; }
  CL.util = { str: str, line: line, idOr: idOr, idList: idList, color: color, bool: bool, int: int, iso: iso };

  function cleanData(kind, d) {
    d = d && typeof d === 'object' ? d : {};
    var o = {}, i, v;
    if (kind === 'weight') {
      v = Number(d.kg); if (!isFinite(v) || v < 0.03 || v > 60) return null;
      o.kg = Math.round(v * 1000) / 1000;
    } else if (kind === 'daily') {
      for (i = 0; i < CL.DAILY.length; i++) {
        var f = CL.DAILY[i]; v = int(d[f.k], 0, 9, null);
        if (v !== null && f.opts.some(function (x) { return x.v === v; })) o[f.k] = v;
      }
      var fl = Array.isArray(d.flags) ? d.flags : [], known = keys(CL.FLAGS);
      o.flags = known.filter(function (k) { return fl.indexOf(k) >= 0; });
    } else if (kind === 'food') {
      o.type = oneOf(d.type, keys(CL.FOOD), 'other'); o.name = line(d.name, 60); o.amount = line(d.amount, 30); o.change = bool(d.change);
    } else if (kind === 'activity') {
      o.type = oneOf(d.type, keys(CL.ACT), 'other'); o.mins = int(d.mins, 1, 1440, null);
    } else if (kind === 'health') {
      o.type = oneOf(d.type, keys(CL.HEALTH), 'other'); o.title = line(d.title, 60); o.sev = int(d.sev, 1, 3, null);
      o.clinic = line(d.clinic, 60); o.status = oneOf(d.status, ['open', 'done'], 'done'); o.follow = ymdOr(d.follow);
    } else if (kind === 'moment') {
      o.title = line(d.title, 40); o.star = bool(d.star);
    } else return null;
    return o;
  }

  CL.clean = {
    members: function (r) {
      var id = who(r.id); if (!id) return null;
      return { id: id, name: line(r.name, 16) || (id === 'a' ? '成员 A' : '成员 B'), color: color(r.color) || CL.MEMBER_COLORS[id], rev: int(r.rev, 0, 1e15, 0) };
    },
    pets: function (r) {
      var id = idOr(r.id), name = line(r.name, 20); if (!id || !name) return null;
      return meta(r, {
        id: id, name: name, species: oneOf(r.species, keys(CL.SPECIES), 'cat'), sex: oneOf(r.sex, ['f', 'm'], ''),
        neutered: oneOf(r.neutered, ['y', 'n'], ''), birthday: ymdOr(r.birthday), home_date: ymdOr(r.home_date),
        breed: line(r.breed, 30), coat: line(r.coat, 30), chip: line(r.chip, 40), color: color(r.color) || CL.PET_COLORS[0],
        avatar: idOr(r.avatar), note: str(r.note, 500), sort: int(r.sort, 0, 9999, 0)
      });
    },
    entries: function (r) {
      var id = idOr(r.id), pet = idOr(r.pet_id), kind = oneOf(r.kind, CL.KIND_LIST, ''), date = ymdOr(r.date);
      if (!id || !pet || !kind || !date) return null;
      var d = r.data;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
      d = cleanData(kind, d); if (!d) return null;
      return meta(r, { id: id, pet_id: pet, kind: kind, date: date, time: hmOr(r.time), data: d, note: str(r.note, 2000), media: idList(r.media) });
    },
    shots: function (r) {
      var id = idOr(r.id), pet = idOr(r.pet_id), date = ymdOr(r.date), name = line(r.name, 40);
      if (!id || !pet || !date || !name) return null;
      return meta(r, {
        id: id, pet_id: pet, kind: oneOf(r.kind, ['vaccine', 'deworm'], 'vaccine'), name: name, code: line(r.code, 20).toLowerCase(),
        date: date, next_due: ymdOr(r.next_due), dose: line(r.dose, 30), product: line(r.product, 60), lot: line(r.lot, 40),
        clinic: line(r.clinic, 60), note: str(r.note, 1000), media: idList(r.media)
      });
    },
    docs: function (r) {
      var id = idOr(r.id), title = line(r.title, 60); if (!id || !title) return null;
      return meta(r, { id: id, pet_id: idOr(r.pet_id), title: title, category: oneOf(r.category, keys(CL.DOC_CATS), 'other'), date: ymdOr(r.date), note: str(r.note, 1000), media: idList(r.media) });
    },
    media: function (r) {
      var id = idOr(r.id); if (!id) return null;
      return meta(r, {
        id: id, kind: oneOf(r.kind, ['img', 'file'], 'file'), name: line(r.name, 120), mime: line(r.mime, 80).toLowerCase(),
        size: int(r.size, 0, 1e9, 0), w: int(r.w, 0, 20000, 0), h: int(r.h, 0, 20000, 0), drive_id: /^[A-Za-z0-9_-]{10,100}$/.test(String(r.drive_id || '')) ? String(r.drive_id) : ''
      });
    },
    settings: function (r) {
      var id = idOr(r.id); if (!id) return null;
      return { id: id, value: line(r.value, 200), rev: int(r.rev, 0, 1e15, 0) };
    }
  };
  CL.TABLES = ['members', 'pets', 'entries', 'shots', 'docs', 'media', 'settings'];
  CL.cleanData = cleanData;

  // 缩略图只认内嵌的 jpeg/png/webp，别的一律不显示
  CL.okThumb = function (s) { return typeof s === 'string' && s.length <= 60000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(s); };

  // 网页里的一行 → 发给表格的一行（全是字符串、数字、布尔）
  CL.toWire = function (table, row, unit) {
    var o = {}, k;
    for (k in row) { if (k === 'rev' || k === 'updated_at' || k === 'updated_by' || k === 'drive_id') continue; o[k] = row[k]; }
    if (table === 'entries') { o.summary = CL.summary(row, unit || 'kg'); o.kg = row.kind === 'weight' ? row.data.kg : ''; o.data = JSON.stringify(row.data); }
    if (Array.isArray(o.media)) o.media = o.media.join(',');
    return o;
  };
  CL.fromWire = function (table, w) { var f = CL.clean[table]; return f && w && typeof w === 'object' ? f(w) : null; };
  // 把一次同步带回来的变化并进本机的表里；reset 表示整份替换
  CL.merge = function (T, changes, reset) {
    CL.TABLES.forEach(function (t) {
      if (reset || !T[t]) T[t] = map();
      var rows = changes && changes[t]; if (!Array.isArray(rows)) return;
      rows.forEach(function (w) {
        if (!w || typeof w !== 'object') return;
        var id = idOr(w.id); if (!id) return;
        if (bool(w.deleted)) { delete T[t][id]; return; }
        var r = CL.fromWire(t, w); if (r) T[t][id] = r; else delete T[t][id];
      });
    });
    return T;
  };
  CL.emptyTables = function () { var T = {}; CL.TABLES.forEach(function (t) { T[t] = map(); }); return T; };

  var ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
  CL.newId = function () {
    var out = '', i, buf;
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) { buf = new Uint8Array(12); crypto.getRandomValues(buf); for (i = 0; i < 12; i++) out += ID_CHARS[buf[i] % 36]; }
    else for (i = 0; i < 12; i++) out += ID_CHARS[Math.floor(Math.random() * 36)];
    return out;
  };
  CL.dailyId = function (petId, date) { return 'd_' + petId + '_' + date.replace(/-/g, ''); };

  // ---------- 日常状态 ----------
  function optOf(f, v) { for (var i = 0; i < f.opts.length; i++) if (f.opts[i].v === v) return f.opts[i]; return null; }
  CL.dailyOpt = function (k, v) { for (var i = 0; i < CL.DAILY.length; i++) if (CL.DAILY[i].k === k) return optOf(CL.DAILY[i], v); return null; };
  // 0 没记，1 正常，2 留意，3 异常
  CL.dailyLevel = function (d) {
    if (!d) return 0;
    var lv = 0;
    CL.DAILY.forEach(function (f) { if (d[f.k] != null) { var o = optOf(f, d[f.k]); if (o) lv = Math.max(lv, o.s); } });
    if (d.flags && d.flags.length) lv = Math.max(lv, 2);
    return lv;
  };
  CL.dailyAllNormal = function (d) {
    if (!d || (d.flags && d.flags.length)) return false;
    return CL.DAILY.every(function (f) { return d[f.k] === f.normal; });
  };
  // 需要留意的几项：[{label, text, s}]
  CL.dailyIssues = function (d) {
    var out = [];
    if (!d) return out;
    CL.DAILY.forEach(function (f) { var o = d[f.k] != null && optOf(f, d[f.k]); if (o && o.s > 1) out.push({ k: f.k, label: f.label, text: f.k === 'vomit' ? '呕吐 ' + o.l : f.label + o.l, s: o.s }); });
    (d.flags || []).forEach(function (k) { out.push({ k: k, label: '', text: label(CL.FLAGS, k), s: 2 }); });
    return out;
  };
  CL.dailySummary = function (d) {
    var lv = CL.dailyLevel(d);
    if (!lv) return '还没记';
    var issues = CL.dailyIssues(d);
    if (issues.length) return issues.map(function (x) { return x.text; }).join('、');
    if (CL.dailyAllNormal(d)) return '一切正常';
    var parts = [];
    CL.DAILY.forEach(function (f) { var o = d[f.k] != null && optOf(f, d[f.k]); if (o) parts.push(f.k === 'vomit' ? (o.v ? '呕吐 ' + o.l : '没吐') : f.label + o.l); });
    return parts.join('、');
  };
  CL.normalDaily = function (d) {
    var o = {}; d = d || {};
    CL.DAILY.forEach(function (f) { o[f.k] = d[f.k] != null ? d[f.k] : f.normal; });
    o.flags = (d.flags || []).slice();
    return o;
  };

  // ---------- 一句话说明（时间轴的标题，也写进表格的 summary 列，方便直接看表格）----------
  CL.summary = function (e, unit) {
    var d = e.data || {}, s;
    if (e.kind === 'weight') return '体重 ' + CL.fmtWeight(d.kg, unit) + ' ' + unit;
    if (e.kind === 'daily') return '日常：' + CL.dailySummary(d);
    if (e.kind === 'food') { s = label(CL.FOOD, d.type) + (d.name ? ' ' + d.name : '') + (d.amount ? ' ' + d.amount : ''); return (d.change ? '换粮：' : '饮食：') + s; }
    if (e.kind === 'activity') return (keys(CL.ACT).indexOf(d.type) >= CL.ACT_CARE_FROM ? '护理：' : '活动：') + label(CL.ACT, d.type) + (d.mins ? ' ' + d.mins + ' 分钟' : '');
    if (e.kind === 'health') return '健康：' + (d.title || label(CL.HEALTH, d.type)) + (d.title ? '（' + label(CL.HEALTH, d.type) + '）' : '');
    if (e.kind === 'moment') { s = d.title || line(e.note, 24) || ((e.media || []).length ? (e.media.length + ' 张照片') : '瞬间'); return (d.star ? '里程碑：' : '瞬间：') + s; }
    return '';
  };

  // ---------- 排序 ----------
  function cmpDesc(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    var ta = a.time || '', tb = b.time || '';
    if (ta !== tb) return ta < tb ? 1 : -1;
    var ca = a.at || '', cb = b.at || '';
    if (ca !== cb) return ca < cb ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  }
  CL.entriesOf = function (T, petId, kind) {
    return vals(T.entries).filter(function (e) { return e.pet_id === petId && (!kind || e.kind === kind); });
  };
  function isImg(T, id) { var m = T.media[id]; return !!m && m.kind === 'img'; }
  CL.images = function (T, row) { return (row.media || []).filter(function (id) { return isImg(T, id); }); };
  CL.files = function (T, row) { return (row.media || []).filter(function (id) { return T.media[id] && !isImg(T, id); }); };

  // ---------- 时间轴 ----------
  // filter: all / photo / weight / daily / food / activity / health / shot / alert
  CL.timeline = function (T, petId, filter) {
    filter = filter || 'all';
    var items = [];
    vals(T.entries).forEach(function (e) {
      if (e.pet_id !== petId) return;
      var ok = filter === 'all' || filter === e.kind ||
        (filter === 'photo' && CL.images(T, e).length > 0) ||
        (filter === 'alert' && (e.kind === 'health' || (e.kind === 'daily' && CL.dailyLevel(e.data) >= 2)));
      if (ok) items.push({ t: 'entry', kind: e.kind, id: e.id, date: e.date, time: e.time, at: e.created_at, row: e });
    });
    if (filter === 'all' || filter === 'shot' || filter === 'photo') vals(T.shots).forEach(function (s) {
      if (s.pet_id !== petId) return;
      if (filter === 'photo' && !CL.images(T, s).length) return;
      items.push({ t: 'shot', kind: s.kind, id: s.id, date: s.date, time: '', at: s.created_at, row: s });
    });
    return items.sort(cmpDesc);
  };
  // 生日、到家纪念日这些「标记」，夹在时间轴里
  CL.marks = function (pet, from, to) {
    var out = [], i, d;
    if (!pet || !from || !to) return out;
    if (CL.isYmd(pet.birthday)) for (i = 0; i <= 40; i++) {
      d = CL.addMonths(pet.birthday, i * 12); if (d > to) break;
      if (d >= from) out.push({ t: 'mark', kind: 'birthday', id: 'mk_b' + i, date: d, time: '99', at: '', text: i ? i + ' 岁生日' : '出生', n: i });
    }
    if (CL.isYmd(pet.home_date)) for (i = 0; i <= 40; i++) {
      d = CL.addMonths(pet.home_date, i * 12); if (d > to) break;
      if (d >= from) out.push({ t: 'mark', kind: 'home', id: 'mk_h' + i, date: d, time: '98', at: '', text: i ? '到家 ' + i + ' 周年' : '到家第一天', n: i });
    }
    return out;
  };
  CL.sortDesc = function (items) { return items.sort(cmpDesc); };
  CL.groupByMonth = function (items) {
    var out = [], cur = null, day = null;
    items.forEach(function (it) {
      var ym = it.date.slice(0, 7);
      if (!cur || cur.ym !== ym) { cur = { ym: ym, days: [] }; out.push(cur); day = null; }
      if (!day || day.date !== it.date) { day = { date: it.date, items: [] }; cur.days.push(day); }
      day.items.push(it);
    });
    return out;
  };

  // ---------- 体重 ----------
  CL.weights = function (T, petId) {
    return CL.entriesOf(T, petId, 'weight').map(function (e) { return { id: e.id, date: e.date, time: e.time, at: e.created_at, kg: e.data.kg }; }).sort(function (a, b) { return -cmpDesc(a, b); });
  };
  CL.weightStats = function (list) {
    if (!list.length) return null;
    var last = list[list.length - 1], prev = list.length > 1 ? list[list.length - 2] : null, ref = null, min = last, max = last, i;
    for (i = 0; i < list.length; i++) { if (list[i].kg < min.kg) min = list[i]; if (list[i].kg >= max.kg) max = list[i]; }
    // 大约 30 天前的那一次：离「最近一次的 30 天前」最近的记录，至少早 14 天
    for (i = list.length - 2; i >= 0; i--) {
      var gap = CL.diffDays(list[i].date, last.date);
      if (gap < 14) continue;
      if (!ref || Math.abs(gap - 30) < Math.abs(CL.diffDays(ref.date, last.date) - 30)) ref = list[i];
      if (gap > 60) break;
    }
    return { last: last, prev: prev, delta: prev ? Math.round((last.kg - prev.kg) * 1000) / 1000 : null, ref: ref, refDelta: ref ? Math.round((last.kg - ref.kg) * 1000) / 1000 : null, min: min, max: max, n: list.length };
  };
  CL.weightNear = function (list, date, maxDays) {
    var best = null, bd = Infinity;
    list.forEach(function (w) { var g = Math.abs(CL.diffDays(w.date, date)); if (g < bd) { bd = g; best = w; } });
    return best && bd <= (maxDays == null ? 45 : maxDays) ? best : null;
  };

  // ---------- 疫苗和驱虫 ----------
  // 「快到期」的提前量跟着间隔走：间隔的四分之一，最少 3 天，最多 30 天。
  // 一年一针的提前 30 天提醒；一个月一次的驱虫提前 8 天，不会刚做完就又说快到期。
  CL.soonWindow = function (date, nextDue) {
    if (!CL.isYmd(date) || !CL.isYmd(nextDue)) return CL.SOON_DAYS;
    return Math.max(3, Math.min(CL.SOON_DAYS, Math.round(CL.diffDays(date, nextDue) * 0.25)));
  };
  CL.shotStatus = function (nextDue, today, date) {
    if (!CL.isYmd(nextDue)) return { state: 'done', days: null };
    var days = CL.diffDays(today, nextDue);
    return { state: days < 0 ? 'over' : days <= CL.soonWindow(date, nextDue) ? 'soon' : 'ok', days: days };
  };
  CL.shotKey = function (s) { return s.code ? 'c:' + s.code : 'n:' + s.name.toLowerCase().replace(/\s+/g, ''); };
  // 状态板：每种疫苗（或驱虫）一行，看最近一次和下次
  CL.shotBoard = function (T, pet, kind, today) {
    var rows = map(), order = [], presets = CL.presets(pet.species, kind);
    presets.forEach(function (p) { if (p.core) { rows['c:' + p.code] = { key: 'c:' + p.code, code: p.code, name: p.name, en: p.en || '', core: true, list: [] }; order.push('c:' + p.code); } });
    vals(T.shots).forEach(function (s) {
      if (s.pet_id !== pet.id || s.kind !== kind) return;
      var key = CL.shotKey(s);
      if (!rows[key]) { var p = presets.filter(function (x) { return x.code === s.code; })[0]; rows[key] = { key: key, code: s.code, name: p ? p.name : s.name, en: p ? p.en || '' : '', core: !!(p && p.core), list: [] }; order.push(key); }
      rows[key].list.push(s);
    });
    var rank = { over: 0, soon: 1, none: 2, ok: 3, done: 4 };
    return order.map(function (k) {
      var r = rows[k];
      r.list.sort(function (a, b) { return cmpDesc({ date: a.date, time: '', at: a.created_at, id: a.id }, { date: b.date, time: '', at: b.created_at, id: b.id }); });
      r.last = r.list[0] || null;
      var st = r.last ? CL.shotStatus(r.last.next_due, today, r.last.date) : { state: 'none', days: null };
      r.state = st.state; r.days = st.days; r.next = r.last ? r.last.next_due : '';
      return r;
    }).sort(function (a, b) { return rank[a.state] - rank[b.state] || (a.days == null ? 0 : a.days) - (b.days == null ? 0 : b.days); });
  };

  // ---------- 首页提醒 ----------
  CL.reminders = function (T, pet, today) {
    var out = [];
    ['vaccine', 'deworm'].forEach(function (kind) {
      CL.shotBoard(T, pet, kind, today).forEach(function (r) {
        if (r.state === 'over') out.push({ level: 3, days: r.days, text: r.name + CL.dueText(r.days), sub: '上次 ' + CL.fmtDate(r.last.date, 'num'), go: 'shot', kind: kind, key: r.key });
        else if (r.state === 'soon') out.push({ level: 2, days: r.days, text: r.name + (r.days === 0 ? '今天到期' : ' ' + CL.dueText(r.days)), sub: '到期日 ' + CL.fmtDate(r.next, 'num'), go: 'shot', kind: kind, key: r.key });
      });
    });
    CL.entriesOf(T, pet.id, 'health').forEach(function (e) {
      if (e.data.status !== 'open' || !e.data.follow) return;
      var n = CL.diffDays(today, e.data.follow);
      if (n <= 7) out.push({ level: n < 0 ? 3 : 2, days: n, text: '复查：' + (e.data.title || label(CL.HEALTH, e.data.type)), sub: n < 0 ? '原定 ' + CL.fmtDate(e.data.follow, 'num') + '，已过 ' + (-n) + ' 天' : CL.relDay(e.data.follow, today), go: 'entry', id: e.id });
    });
    [['birthday', '岁生日'], ['home_date', '周年']].forEach(function (p) {
      var base = pet[p[0]]; if (!CL.isYmd(base)) return;
      var n = Math.max(0, (+today.slice(0, 4)) - (+base.slice(0, 4))), d = CL.addMonths(base, n * 12);
      if (d < today) { n++; d = CL.addMonths(base, n * 12); }
      var left = CL.diffDays(today, d);
      if (n > 0 && left <= 7) out.push({ level: 1, days: left, text: (p[0] === 'birthday' ? n + ' ' + p[1] : '到家 ' + n + ' ' + p[1]) + (left ? '还有 ' + left + ' 天' : '就是今天'), sub: CL.fmtDate(d), go: '' });
    });
    var ws = CL.weights(T, pet.id);
    if (ws.length) { var gap = CL.diffDays(ws[ws.length - 1].date, today); if (gap >= 35) out.push({ level: 1, days: gap, text: '有 ' + gap + ' 天没称体重了', sub: '上次 ' + CL.fmtDate(ws[ws.length - 1].date, 'num'), go: 'weight' }); }
    return out.sort(function (a, b) { return b.level - a.level || a.days - b.days; });
  };

  // ---------- 成长 ----------
  // 相册：有生日就按月龄分，没有就按年月分。每格一个封面（标了里程碑的优先）
  CL.album = function (T, pet) {
    var groups = map(), order = [], hasB = CL.isYmd(pet.birthday);
    var list = CL.entriesOf(T, pet.id).filter(function (e) { return CL.images(T, e).length; })
      .sort(function (a, b) { return -cmpDesc({ date: a.date, time: a.time, at: a.created_at, id: a.id }, { date: b.date, time: b.time, at: b.created_at, id: b.id }); });
    list.forEach(function (e) {
      var g = hasB ? CL.age(pet.birthday, e.date) : null, key, lab;
      if (g) { key = 'a' + g.months; lab = CL.monthsLabel(g.months); } else { key = e.date.slice(0, 7); lab = CL.fmtDate(e.date, 'ym'); }
      if (!groups[key]) { groups[key] = { key: key, label: lab, ym: e.date.slice(0, 7), first: e.date, cover: '', star: false, items: [] }; order.push(key); }
      var G = groups[key], imgs = CL.images(T, e);
      imgs.forEach(function (mid) { G.items.push({ mid: mid, id: e.id, date: e.date }); });
      var star = e.kind === 'moment' && e.data.star;
      if (!G.cover || (star && !G.star)) { G.cover = imgs[0]; G.star = !!star; }
    });
    return order.map(function (k) { return groups[k]; }).sort(function (a, b) { return a.first < b.first ? -1 : a.first > b.first ? 1 : 0; });
  };
  // 某个月的状态日历（周一开头）
  CL.monthGrid = function (T, petId, ym, today) {
    var first = ym + '-01', lead = (CL.weekday(first) + 6) % 7, n = CL.diffDays(first, CL.addMonths(first, 1)), by = map();
    CL.entriesOf(T, petId).forEach(function (e) {
      if (e.date.slice(0, 7) !== ym) return;
      var c = by[e.date] || (by[e.date] = { level: 0, weight: false, health: false, photo: false, n: 0 });
      c.n++;
      if (e.kind === 'daily') c.level = Math.max(c.level, CL.dailyLevel(e.data));
      if (e.kind === 'weight') c.weight = true;
      if (e.kind === 'health') c.health = true;
      if (CL.images(T, e).length) c.photo = true;
    });
    var cells = [], i;
    for (i = 0; i < lead; i++) cells.push(null);
    for (i = 1; i <= n; i++) { var d = ym + '-' + pad2(i), c = by[d] || { level: 0, weight: false, health: false, photo: false, n: 0 }; c.date = d; c.day = i; c.future = d > today; c.today = d === today; cells.push(c); }
    while (cells.length % 7) cells.push(null);
    return { ym: ym, label: CL.fmtDate(first, 'ym'), cells: cells };
  };
  // 连续记了多少天日常（今天还没记的话，从昨天往前数）
  CL.streak = function (T, petId, today) {
    var has = map();
    CL.entriesOf(T, petId, 'daily').forEach(function (e) { if (CL.dailyLevel(e.data)) has[e.date] = 1; });
    var d = has[today] ? today : CL.addDays(today, -1), n = 0;
    while (has[d]) { n++; d = CL.addDays(d, -1); }
    return n;
  };
  // 近 N 天的小结
  CL.recent = function (T, petId, today, days) {
    var from = CL.addDays(today, -(days - 1)), o = { days: days, logged: 0, warn: 0, bad: 0, vomit: 0 };
    CL.entriesOf(T, petId, 'daily').forEach(function (e) {
      if (e.date < from || e.date > today) return;
      var lv = CL.dailyLevel(e.data); if (!lv) return;
      o.logged++; if (lv === 2) o.warn++; if (lv === 3) o.bad++;
      if (e.data.vomit) o.vomit += e.data.vomit;
    });
    return o;
  };
  // 「那年今日」：往年同一天（差三天以内也算）带照片的记录；没有的话找 6、3、1 个月前
  CL.memory = function (T, petId, today) {
    var list = CL.entriesOf(T, petId).filter(function (e) { return CL.images(T, e).length && e.date < today; }), best = null;
    if (!list.length) return null;
    var earliest = list.reduce(function (m, e) { return e.date < m ? e.date : m; }, today);
    function near(target, lab) {
      var hit = null, hd = 4;
      list.forEach(function (e) { var g = Math.abs(CL.diffDays(e.date, target)); if (g < hd || (g === hd && hit && e.kind === 'moment' && hit.kind !== 'moment')) { hd = g; hit = e; } });
      return hit ? { entry: hit, label: hd === 0 ? lab + '的今天' : lab + '的这几天' } : null;
    }
    for (var y = 1; y <= 30 && !best; y++) { var t = CL.addMonths(today, -12 * y); if (CL.addDays(t, 3) < earliest) break; best = near(t, y + ' 年前'); }
    [6, 3, 1].forEach(function (m) { if (!best) best = near(CL.addMonths(today, -m), m === 6 ? '半年前' : m + ' 个月前'); });
    return best;
  };
  // 第一张和最近一张照片
  CL.firstLast = function (T, pet) {
    var al = CL.album(T, pet), all = [];
    al.forEach(function (g) { g.items.forEach(function (x) { all.push(x); }); });
    if (all.length < 2 || all[0].date === all[all.length - 1].date) return null;
    return { first: all[0], last: all[all.length - 1], n: all.length };
  };
  CL.counts = function (T, pet, today) {
    var es = CL.entriesOf(T, pet.id), photos = 0, days = map();
    es.forEach(function (e) { photos += CL.images(T, e).length; days[e.date] = 1; });
    return { entries: es.length, photos: photos, days: Object.keys(days).length, weights: es.filter(function (e) { return e.kind === 'weight'; }).length,
      home: CL.isYmd(pet.home_date) && pet.home_date <= today ? CL.diffDays(pet.home_date, today) + 1 : null };
  };

  // 初始化链接：页面地址#init=base64url({v,u,t})
  CL.b64uEncode = function (s) {
    var b = typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(s)));
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  CL.b64uDecode = function (s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    return typeof Buffer !== 'undefined' ? Buffer.from(s, 'base64').toString('utf8') : decodeURIComponent(escape(atob(s)));
  };
  var RE_API = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/;
  var RE_LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}\/[A-Za-z0-9_\/.-]*$/;
  CL.okApi = function (u) { return typeof u === 'string' && (RE_API.test(u) || RE_LOCAL.test(u)); };
  // 从一段粘贴的文字里找出初始化信息；找不到返回 null
  CL.parseInit = function (text) {
    var m = /init=([A-Za-z0-9_-]{20,4000})/.exec(String(text || '')); if (!m) return null;
    try {
      var o = JSON.parse(CL.b64uDecode(m[1]));
      if (!o || o.v !== 1 || !CL.okApi(o.u) || !/^[A-Za-z0-9]{16,128}$/.test(String(o.t))) return null;
      return { u: o.u, t: String(o.t), w: o.w === 'b' ? 'b' : o.w === 'a' ? 'a' : '' };
    } catch (e) { return null; }
  };
  CL.makeInit = function (pageUrl, apiUrl, token, who) { return pageUrl.replace(/#.*$/, '') + '#init=' + CL.b64uEncode(JSON.stringify({ v: 1, u: apiUrl, t: token, w: who || '' })); };

  return CL;
});
