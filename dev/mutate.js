// 「故意改坏再跑测试」：每次把代码改坏一处，看有没有测试报错。没有测试报错的，说明那一处没人看着。
// node dev/mutate.js            全部
// node dev/mutate.js 3 7        只跑第 3、第 7 条
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const APP = process.env.CATLOG_APP || path.join(ROOT, 'app');

// [文件, 原来的写法, 改坏成什么, 用哪个测试来抓（core / backend / e2e:名字里的字）, 说明]
const M = [
  ['core.js', "pad2(Math.min(d, last))", "pad2(d)", 'core', '月末加一个月不再收到当月最后一天'],
  ['core.js', "if (CL.addMonths(birth, n) > at) n--;", "", 'core', '年龄多算一个月'],
  ['core.js', "if (d.flags && d.flags.length) lv = Math.max(lv, 2);", "", 'core', '「其他状况」不算留意'],
  ['core.js', "state: days < 0 ? 'over'", "state: days <= 0 ? 'over'", 'core', '到期当天就算过期'],
  ['core.js', "CL.diffDays(date, nextDue) * 0.25", "CL.diffDays(date, nextDue) * 1", 'core', '刚做完就说快到期'],
  ['core.js', "if (bool(w.deleted)) { delete T[t][id]; return; }", "", 'core', '删掉的记录还留在手机上'],
  ['core.js', "if (!isFinite(v) || v < 0.03 || v > 60) return null;", "if (!isFinite(v)) return null;", 'core', '体重不查范围'],
  ['core.js', "data:image\\/(jpeg|png|webp);base64", "data:image\\/(jpeg|png|webp|svg\\+xml);base64", 'core', '缩略图放行 SVG'],
  ['core.js', "var RE_API = /^https:", "var RE_API = /https:", 'core', '接口地址不从头匹配'],
  ['core.js', "var kg = unit === 'lb' ? Number(s) * CL.KG_PER_LB : Number(s);", "var kg = Number(s);", 'core', '磅不换算成公斤'],
  ['core.js', "function map() { return Object.create(null); }", "function map() { return {}; }", 'core', '表用普通对象，怪名字会出事'],
  ['core.js', "if (c >= 0xD800 && c <= 0xDBFF) v = v.slice(0, -1);", "", 'core', '截断时把表情切成两半'],
  ['core.js', "lead = (CL.weekday(first) + 6) % 7", "lead = CL.weekday(first)", 'core', '日历按周日开头排'],
  ['core.js', "var d = has[today] ? today : CL.addDays(today, -1), n = 0;", "var d = today, n = 0;", 'core', '今天没记就说连续 0 天'],
  ['core.js', "if (ta !== tb) return ta < tb ? 1 : -1;", "", 'core', '同一天的不按时间排'],
  ['core.js', "if (!G.cover || (star && !G.star)) { G.cover = imgs[0]; G.star = !!star; }", "if (!G.cover) { G.cover = imgs[0]; G.star = !!star; }", 'core', '相册封面不优先用里程碑'],

  // ---- 1.1.0：护理和保险 ----
  ['core.js', "if (CL.CARE.indexOf(t) < 0 || e.date > today) return;", "if (CL.CARE.indexOf(t) < 0) return;", 'core', '日期填在将来的护理也算成「上次」'],
  ['core.js', "< 0) last[t] = e;", "> 0) last[t] = e;", 'core', '「上次」拿成了最早的一次'],
  ['core.js', "every != null && left <= 0 ? 'due' : 'ok'", "every != null && left < 0 ? 'due' : 'ok'", 'core', '到了该做的那天还不提醒'],
  ['core.js', "if (c.status === 'denied') return;", "", 'core', '被拒的理赔也算进已用额度'],
  ['core.js', "(to && c.date >= to)", "(to && c.date > to)", 'core', '续保日当天的理赔算进上一年度'],
  ['core.js', "dedMet: hasDed ? r2(Math.min(pol.deductible, ded)) : r2(ded)", "dedMet: r2(ded)", 'core', '自付额「已抵」超过自付额本身'],
  ['core.js', "left: hasLimit ? r2(Math.max(0, pol.limit_amt - used)) : null", "left: hasLimit ? r2(pol.limit_amt - used) : null", 'core', '剩余额度出现负数'],
  ['core.js', "if (from && to && from >= to) from = CL.addMonths(to, -12);", "", 'core', '开始日期晚于续保日时年度算乱'],
  ['core.js', "days <= CL.SOON_DAYS ? 'soon' : 'ok'", "days < CL.SOON_DAYS ? 'soon' : 'ok'", 'core', '离续保正好 30 天时不提醒'],
  ['core.js', "o.renew = CL.addMonths(pol.renew, 12); o.used0 = ''; o.ded0 = '';", "o.renew = CL.addMonths(pol.renew, 12);", 'core', '顺延一年后手填的「已用」不清零'],
  ['core.js', "    s = s.replace(/[,，]/g, '');\n", "", 'core', '带千分位逗号的金额读不懂'],
  ['core.js', "    if (/^\\d+[,，]\\d{1,2}$/.test(s)) s = s.replace(/[,，]/, '.');\n", "", 'core', '逗号当小数点的「38,5」读成 385'],
  ['core.js', "var p = parseInt(x[i], 10) || 0, q = parseInt(y[i], 10) || 0; if (p !== q) return p > q;", "var p = x[i] || '0', q = y[i] || '0'; if (p !== q) return p > q;", 'core', '版本号按文字比（1.10 比 1.9 小）'],
  ['core.js', "return isFinite(v) && v >= 0 && v <= 1e8 ? Math.round(v * 100) / 100 : '';", "return isFinite(v) && v <= 1e8 ? Math.round(v * 100) / 100 : '';", 'core', '负数的金额也收'],
  ['core.js', "currency: oneOf(r.currency, CL.CURRENCIES, '$')", "currency: line(r.currency, 3) || '$'", 'core', '货币符号不查'],
  ['core.js', "if (c.state !== 'due' || c.every == null) return;", "if (c.every == null) return;", 'core', '没到时间也提醒「该剪指甲了」'],

  ['Code.gs', "function guard_(v) { return typeof v === 'string' && /^[=']/.test(v) ? \"'\" + v : v; }", "function guard_(v) { return v; }", 'backend', '等号开头的文字变成公式'],
  ['Code.gs', "if (t === 'members' && id !== me) return;            // 名字和颜色只能改自己的", "", 'backend', '能改对方的名字'],
  ['Code.gs', "var fresh = good.filter(function (o) { return !seen['op_' + o.id]; });   // 重发的操作不再做第二遍", "var fresh = good;", 'backend', '重发的操作做第二遍'],
  ['Code.gs', "if (old && old.drive_id) return { ok: true, v: VERSION, me: me, row: compact_(old), dup: true };   // 重发：已经存过了", "", 'backend', '重发的文件存两份'],
  ['Code.gs', "if (token === props.getProperty('TOKEN_B')) return 'b';", "if (token === props.getProperty('TOKEN_B')) return 'a';", 'backend', '把 B 认成 A'],
  ['Code.gs', "        if (t === 'media') return;\n        WRITABLE[t]", "        WRITABLE[t]", 'backend', '图片记录能凭操作修改'],
  ['Code.gs', "  range.setNumberFormats(rows.map(function () { return one; }));\n", "", 'backend', '新加的行不设纯文本格式'],
  ['Code.gs', "var full = !!p.full || since === 0 || since > rev;", "var full = !!p.full || since === 0;", 'backend', '表格被换过时不整份重来'],
  ['Code.gs', "trash_(text_(arr[col.drive_id], 'drive_id'), o.t === 'del');", "trash_(text_(arr[col.drive_id], 'drive_id'), false);", 'backend', '删照片时 Drive 里的文件不进回收站'],
  ['Code.gs', "const MAX_FILE_BYTES = 12 * 1024 * 1024;", "const MAX_FILE_BYTES = 1200 * 1024 * 1024;", 'backend', '不限制文件大小'],
  ['Code.gs', "if (thumb && thumb.length <= LIMITS.thumb && RE_THUMB.test(thumb)) {", "if (thumb) {", 'backend', '缩略图不检查就存'],
  ['Code.gs', "    } finally {\n      lock.releaseLock();\n    }\n  }\n\n  var full", "    } finally {\n    }\n  }\n\n  var full", 'backend', '同步完不放锁'],
  ['Code.gs', "      props.setProperty('REV_' + t, String(rev));\n      props.setProperty('REV', String(rev));\n    } finally {", "      props.setProperty('REV_' + t, String(rev));\n    } finally {", 'backend', '手工改表格后不更新版本号'],
  ['Code.gs', "function put(id, v) { v = String(v || ''); if (RE_THUMB.test(v)) out[id] = v; }", "function put(id, v) { v = String(v || ''); out[id] = v; }", 'backend', '缩略图不检查就发给手机'],
  ['Code.gs', "var row = readRows_('media').filter(function (r) { return r.id === id && !r.deleted; })[0];", "var row = readRows_('media').filter(function (r) { return r.id === id; })[0];", 'backend', '删掉的文件还能取'],
  ['Code.gs', "set_(arr, col, 'created_by', me);", "set_(arr, col, 'created_by', o.row.created_by);", 'backend', '「谁建的」听网页的'],

  ['Code.gs', "used0: 1, ded0: 1, bill: 1, paid: 1, ded: 1 };", "used0: 1, ded0: 1 };", 'backend', '理赔的金额存成文字'],
  ['Code.gs', "claims: ['pet_id', 'policy_id', 'date', 'title', 'bill', 'paid', 'ded', 'status', 'note', 'media']", "claims: ['pet_id', 'policy_id', 'date', 'title', 'bill', 'paid', 'ded', 'note', 'media']", 'backend', '理赔的状态存不进表格'],
  ['Code.gs', "const INT_COLS = { rev: 1, size: 1, w: 1, h: 1, sort: 1, rate: 1 };", "const INT_COLS = {};", 'backend', '整数列显示成带小数'],
  ['Code.gs', "(INT_COLS[h] ? '0' : h === 'kg' ? '0.00#' : '0.00')", "'0.###'", 'backend', '数字列用回「0.###」（整数后面多一个点）'],
  ['Code.gs', "    formatCols_(sh, header_(sh), TABLES[t].filter(function (c) { return NUM_COLS[c]; }));\n", "", 'backend', '重新运行 setup 不刷新旧表的显示格式'],
  ['Code.gs', "formatCols_(sh, header_(sh), missing);", "format_(sh, header_(sh));", 'backend', '补列时把别人自己加的列也改了格式'],

  ['app.js', "return String(s == null ? '' : s).replace(/[&<>\"'`]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });", "return String(s == null ? '' : s);", 'e2e:不可信', '文字不转义'],
  ['app.js', "'Content-Type': 'text/plain;charset=utf-8'", "'Content-Type': 'application/json'", 'e2e:初始化', '请求会触发预检'],
  ['app.js', "function saveQueue() { lsSet('queue', S.queue); }", "function saveQueue() { }", 'e2e:离线：照常', '没发出去的操作不存'],
  ['app.js', "var KEY = DEMO ? 'catlog:v1:demo:' : 'catlog:v1:';", "var KEY = DEMO ? 'v1:demo:' : 'v1:';", 'e2e:别的工具', '存储的键不带前缀'],
  ['sw.js', "const CACHE = 'catlog-cache-v1';", "const CACHE = 'cache-v1';", 'e2e:别的工具', '缓存名不带前缀'],
  ['sw.js', "if (url.origin !== SCOPE.origin || url.pathname.indexOf(SCOPE.pathname) !== 0) return;", "if (url.origin !== SCOPE.origin) return;", 'e2e:别的工具', '离线缓存管到别的文件夹'],
  ['app.js', "return OPENABLE.indexOf(m) >= 0 ? m : 'application/octet-stream';", "return m || 'application/octet-stream';", 'e2e:文件：PDF', '网页类型的文件照样在页面里打开'],
  ['app.js', "if (newIds.indexOf(id) < 0 && !mediaUsedElsewhere(id, row)) removeMedia(id);", "if (newIds.indexOf(id) < 0) removeMedia(id);", 'e2e:疫苗表单', '别处还在用的文件也删'],
  ['app.js', "toast('删掉了', { undo: function () { gone.forEach(function (m) { undel('media', m); }); undel(table, row); render(); } });", "toast('删掉了', { undo: function () { render(); } });", 'e2e:演示：一键', '撤销删除不管用'],
  ['app.js', "setInterval(function () { if (!document.hidden) { if (CL.today() !== S.today && !SHEET && !VIEW) render(); sync(); } }, 45000);", "setInterval(function () { if (!document.hidden) { sync(); } }, 45000);", 'e2e:日期', '过了半夜不换日子'],
  ['app.js', "(date === S.today ? CL.hm() : '')", "CL.hm()", 'e2e:演示：补记', '补记的也写上现在几点'],
  ['app.js', "try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 清不掉也不影响 */ }", "", 'e2e:初始化', '口令留在地址栏'],
  ['app.js', "if (S.pend[id]) { dropPend(id); dropped = true; } else if (S.T.media[id] && !mediaUsedElsewhere(id, null)) del('media', id);", "", 'e2e:照片：离线', '选了又取消的照片照样上传'],
  ['app.js', "var max = mode === 'doc' ? 2200 : 1600,", "var max = mode === 'doc' ? 2200 : 16000,", 'e2e:演示：加照片', '照片不缩小'],
  ['app.js', "S.queue = S.queue.filter(function (o) { return !acked[o.id]; });", "", 'e2e:离线：照常', '确认过的操作不从队列里拿掉'],
  ['app.js', "if (!res.unchanged) CL.merge(S.base, res.changes || {}, !!res.reset);", "if (!res.unchanged) CL.merge(S.base, res.changes || {}, false);", 'e2e:有人直接改', '整份同步时不清掉旧的'],
  ['app.js', "if (code === 'auth') { setSync('auth', e.message); render(); return false; }", "if (code === 'auth') { setSync('err', e.message); return false; }", 'e2e:口令失效', '口令失效不提示'],
  ['app.js', "var row = CL.clean.entries({ id: CL.dailyId(p.id, date),", "var row = CL.clean.entries({ id: CL.newId(),", 'e2e:两部手机：同一天', '同一天的日常记成两行'],
  ['app.js', "redirect: 'follow', credentials: 'omit'", "redirect: 'follow', credentials: 'include'", 'e2e:初始化', '请求带上 cookie'],
  ['app.js', "'<small>体重</small><b class=\"num\">' + CL.fmtWeight(st.last.kg, u)", "'<small>体重</small><b class=\"num\">' + CL.fmtWeight(st.last.kg, 'kg')", 'e2e:体重曲线', '换成磅以后首页的数字没换'],
  ['charts.js', "function y(v) { return mT + (H - mT - mB) * (1 - (v - Y.min) / (Y.max - Y.min)); }", "function y(v) { return mT + (H - mT - mB) * ((v - Y.min) / (Y.max - Y.min)); }", 'e2e:体重曲线', '曲线上下颠倒'],
  ['app.js', "function sendable(op) { var need = CL.TABLE_SINCE[op.table]; return !need || S.demo || (!!S.backend && CL.verGte(S.backend, need)); }", "function sendable(op) { return true; }", 'e2e:后端还是 1.0.0', '后端还是旧的也照发，保险的改动就丢了'],
  ['app.js', "if (ok && (again || S.queue.some(sendable) || Object.keys(S.pend).length))", "if (ok && (again || S.queue.length || Object.keys(S.pend).length))", 'e2e:后端还是 1.0.0', '等后端更新的时候一直空转发请求'],
  ['app.js', "if (status === 'sent' && o.paid !== '' && o.paid > 0) status = 'paid';", "", 'e2e:演示：保险', '填了赔付金额还显示「已提交」'],
  ['app.js', "if (o.bill !== '' && o.paid !== '' && o.paid > o.bill) return formErr('赔的不会比账单还多，检查一下这两个数。');", "", 'e2e:演示：保险', '赔的比账单还多也收'],
  ['app.js', "if (rate && (!/^\\d{1,3}$/.test(rate) || +rate > 100)) return formErr('赔付比例填 0 到 100 之间的整数，比如 80。');", "", 'e2e:演示：保险', '赔付比例填 120 也收'],
  ['app.js', "  cs.forEach(function (c) { del('claims', c.id); });\n  del('policies', pol.id);", "  del('policies', pol.id);", 'e2e:两部手机：保险', '删保单时理赔留在表格里'],
  ['app.js', "  del('policies', pol.id);\n  gone.forEach(function (m) { del('media', m.id); });", "  del('policies', pol.id);", 'e2e:两部手机：保险', '删保单时文件留在 Drive 里'],
  ['app.js', "undo: function () { gone.forEach(function (m) { undel('media', m); }); undel('policies', pol); cs.forEach(function (c) { undel('claims', c); }); render(); }", "undo: function () { undel('policies', pol); render(); }", 'e2e:两部手机：保险', '撤销删保单时理赔和文件不回来'],
  ['app.js', "['entries', 'shots', 'docs', 'policies', 'claims'].forEach(function (t) { CL.vals(S.T[t]).forEach(function (r) { if (r.id !== (row && row.id) && !(skip && skip[r.id]) && r.media.indexOf(id) >= 0) used = true; }); });", "['entries', 'shots', 'docs'].forEach(function (t) { CL.vals(S.T[t]).forEach(function (r) { if (r.id !== (row && row.id) && r.media.indexOf(id) >= 0) used = true; }); });", 'e2e:两部手机：保险', '保单还在用的文件被当成没人用，删掉了'],
  ['app.js', "put('settings', CL.clean.settings({ id: CL.careKey(p.id, type), value: /^\\d{1,3}$/.test(v) ? v : '' }));", "put('settings', CL.clean.settings({ id: 'care_all_' + type, value: /^\\d{1,3}$/.test(v) ? v : '' }));", 'e2e:护理板', '护理的间隔没按猫分开存'],
  ['app.js', "var row = CL.clean.entries(stamp({ id: CL.newId(), pet_id: p.id, kind: 'activity', date: S.today, time: CL.hm(), data: { type: type }, note: '', media: [] }));", "var row = CL.clean.entries(stamp({ id: CL.newId(), pet_id: p.id, kind: 'activity', date: S.today, time: CL.hm(), data: { type: 'other' }, note: '', media: [] }));", 'e2e:护理板', '点「做了」记成了别的活动'],
  ['app.js', "var care = CL.careBoard(T, p, today).filter(function (c) { return c.last || c.every != null || CL.CARE_HOME.indexOf(c.type) >= 0; });", "var care = CL.careBoard(T, p, today).filter(function (c) { return c.last; });", 'e2e:多只猫', '首页的护理卡片上没有还没记过的剪指甲和刷牙'],
  ['app.js', "if (!S.demo && S.backend && !CL.verGte(S.backend, CL.TABLE_SINCE.policies))", "if (false)", 'e2e:后端还是 1.0.0', '后端太旧时不提示'],
  ['app.js', "function meter(pct, cls, some) { return '<span class=\"bar ' + cls + '\" aria-hidden=\"true\"><i style=\"width:' + clamp(pct || (some ? 1 : 0), 0, 100) + '%\"></i></span>'; }", "function meter(pct, cls, some) { return '<span class=\"bar ' + cls + '\" aria-hidden=\"true\"><i style=\"width:' + clamp(100 - pct, 0, 100) + '%\"></i></span>'; }", 'e2e:演示：保险', '额度条画反了'],
  ['styles.css', ".seg.big button { flex: 1 1 0; min-width: 0; padding: 0 2px;", ".seg.big button { flex: 1; padding: 0 12px;", 'e2e:排版', '档案页的六个分栏在窄屏上超宽'],
  ['app.js', "if (MIXED) return;", "", 'e2e:更新到一半', '新旧文件混在一起也照样往下跑'],
  ['app.js', "if (!tried) { refresh(); return true; }", "if (!tried) { return true; }", 'e2e:更新到一半', '版本对不上时不自己重新取文件'],
  ['app.js', "tried = sessionStorage.getItem(FLAG) === mark;", "tried = false;", 'e2e:更新到一半', '版本一直对不上时不停地重新加载'],
  ['app.js', "if ((Number(lsGet('seed', 1)) || 1) < DEMO_SEED) Demo.topUp();", "", 'e2e:演示数据升级', '旧的演示数据里看不到保险的示例'],
  ['app.js', "      lsSet('seed', DEMO_SEED);\n", "", 'e2e:演示数据升级', '删掉的示例保单每次重开又补回来'],
  ['app.js', "S.base = base; S.rev = Number(s.rev) || 0; S.backend = String(s.backend || '');", "S.base = base; S.rev = Number(s.rev) || 0; S.backend = VERSION;", 'e2e:从 1.0.0 升级网页', '刚升级网页时把后端也当成新的，保险的改动发给旧后端就丢了'],
  ['app.js', "return !need || S.demo || (!!S.backend && CL.verGte(S.backend, need));", "return !need || S.demo || !S.backend || CL.verGte(S.backend, need);", 'e2e:后端还是 1.0.0', '还不知道后端是哪一版就把保险的改动发出去'],
];

const pick = process.argv.slice(2).map(Number).filter(Boolean);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catlog-mutate-'));
let caught = 0; const missed = [];
M.forEach((m, i) => {
  if (pick.length && pick.indexOf(i + 1) < 0) return;
  const [file, from, to, how, what] = m;
  const dir = path.join(tmp, 'm' + (i + 1));
  fs.cpSync(APP, dir, { recursive: true });
  const src = fs.readFileSync(path.join(dir, file), 'utf8');
  const n = src.split(from).length - 1;
  if (n !== 1) { console.log('  ??  ' + (i + 1) + ' ' + what + '：要改的那句在 ' + file + ' 里出现了 ' + n + ' 次，没法改'); missed.push(i + 1); return; }
  fs.writeFileSync(path.join(dir, file), src.replace(from, to));
  const env = Object.assign({}, process.env, { CATLOG_APP: dir, CATLOG_CODE: path.join(dir, 'Code.gs') });
  const args = how === 'core' ? ['dev/test-core.js'] : how === 'backend' ? ['dev/test-backend.js'] : ['dev/test-e2e.js', how.slice(4)];
  const r = spawnSync('node', args, { cwd: ROOT, env, encoding: 'utf8', timeout: 240000 });
  const failed = r.status !== 0;
  if (failed) { caught++; console.log('  抓到  ' + (i + 1) + ' ' + what); }
  else { missed.push(i + 1); console.log('  漏了  ' + (i + 1) + ' ' + what + '  （' + args.join(' ') + '）'); }
  fs.rmSync(dir, { recursive: true, force: true });
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n改坏 ' + (caught + missed.length) + ' 处，测试抓到 ' + caught + ' 处' + (missed.length ? '，漏了：' + missed.join('、') : ''));
process.exit(missed.length ? 1 : 0);
