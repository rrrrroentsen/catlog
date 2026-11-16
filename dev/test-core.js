// core.js 的单元测试：node dev/test-core.js
'use strict';
const path = require('path');
const assert = require('assert');
const APP = process.env.CATLOG_APP || path.join(__dirname, '..', 'app');
const CL = require(path.join(APP, 'core.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('FAIL  ' + name + '\n      ' + String(e && e.message || e).split('\n').join('\n      ')); }
}
const eq = assert.deepStrictEqual;

// 造数据的小帮手
let seq = 0;
function mk() {
  const T = CL.emptyTables();
  T.pets.p1 = CL.clean.pets({ id: 'p1', name: '年糕', birthday: '2025-06-10', home_date: '2025-08-20' });
  return T;
}
function add(T, kind, date, data, extra) {
  const id = (extra && extra.id) || ('e' + (++seq));
  const r = CL.clean.entries(Object.assign({ id, pet_id: 'p1', kind, date, data, created_at: '2026-01-01T00:00:' + String(seq % 60).padStart(2, '0') + 'Z' }, extra || {}));
  assert.ok(r, '造不出记录 ' + kind);
  T.entries[r.id] = r; return r;
}
function img(T, id) { T.media[id] = CL.clean.media({ id, kind: 'img', name: id + '.jpg', mime: 'image/jpeg' }); return id; }
function shot(T, o) { const r = CL.clean.shots(Object.assign({ id: 's' + (++seq), pet_id: 'p1', kind: 'vaccine' }, o)); assert.ok(r); T.shots[r.id] = r; return r; }

console.log('core.js ' + CL.VERSION);

t('日期：合法性', () => {
  eq(CL.isYmd('2026-11-13'), true); eq(CL.isYmd('2026-02-29'), false); eq(CL.isYmd('2024-02-29'), true);
  eq(CL.isYmd('2026-13-01'), false); eq(CL.isYmd('2026-1-1'), false); eq(CL.isYmd(null), false); eq(CL.isYmd('1899-01-01'), false);
});
t('日期：加减和夏令时', () => {
  eq(CL.addDays('2026-03-07', 2), '2026-03-09');           // 美国 3 月 8 日换夏令时
  eq(CL.diffDays('2026-03-07', '2026-03-09'), 2);
  eq(CL.diffDays('2026-10-31', '2026-11-02'), 2);          // 11 月 1 日换回来
  eq(CL.addMonths('2026-01-31', 1), '2026-02-28'); eq(CL.addMonths('2024-01-31', 1), '2024-02-29');
  eq(CL.addMonths('2026-11-30', 3), '2027-02-28'); eq(CL.addMonths('2026-03-15', -4), '2025-11-15');
  eq(CL.weekday('2026-11-13'), 5);
});
t('日期：说法', () => {
  eq(CL.fmtDate('2026-11-03'), '11 月 3 日'); eq(CL.fmtDate('2026-11-13', 'full'), '2026 年 11 月 13 日 周五'); eq(CL.fmtDate('x'), '');
  eq(CL.relDay('2026-11-13', '2026-11-13'), '今天'); eq(CL.relDay('2026-11-12', '2026-11-13'), '昨天'); eq(CL.relDay('2026-11-03', '2026-11-13'), '10 天前');
  eq(CL.relDay('2026-11-14', '2026-11-13'), '明天'); eq(CL.relDay('2025-03-01', '2026-11-13'), '2025 年 3 月 1 日');
  eq(CL.dueText(-3), '已过期 3 天'); eq(CL.dueText(0), '今天到期'); eq(CL.dueText(12), '还有 12 天');
});
t('年龄：月份借位和闰日', () => {
  eq(CL.age('2026-01-31', '2026-03-01'), { y: 0, m: 1, d: 1, months: 1, days: 29 });
  eq(CL.age('2024-02-29', '2025-02-28').y, 1); eq(CL.age('2024-02-29', '2025-02-27').y, 0);
  eq(CL.age('2025-06-10', '2025-06-09'), null); eq(CL.age('', '2025-06-09'), null);
  eq(CL.age('2025-06-10', '2026-11-13').months, 17);
});
t('年龄：说法的分界', () => {
  eq(CL.ageLabel('2026-11-01', '2026-11-13'), '12 天'); eq(CL.ageLabel('2026-10-30', '2026-11-13'), '2 周');
  eq(CL.ageLabel('2026-09-01', '2026-11-13'), '2 个月'); eq(CL.ageLabel('2025-11-13', '2026-11-13'), '1 岁');
  eq(CL.ageLabel('2024-08-01', '2026-11-13'), '2 岁 3 个月'); eq(CL.ageLabel('2027-01-01', '2026-11-13'), '');
  eq(CL.monthsLabel(0), '不满 1 个月'); eq(CL.monthsLabel(5), '5 个月'); eq(CL.monthsLabel(12), '1 岁'); eq(CL.monthsLabel(27), '2 岁 3 个月');
});
t('体重：读数和换算', () => {
  eq(CL.parseWeight('4.5', 'kg'), 4.5); eq(CL.parseWeight(' 4,52 ', 'kg'), 4.52); eq(CL.parseWeight('４．５', 'kg'), 4.5);
  eq(CL.parseWeight('4.5kg', 'kg'), 4.5); eq(CL.parseWeight('10', 'lb'), 4.536); eq(CL.parseWeight('9.9 lb', 'lb'), 4.491);
  eq(CL.parseWeight('abc', 'kg'), null); eq(CL.parseWeight('', 'kg'), null); eq(CL.parseWeight('0', 'kg'), null); eq(CL.parseWeight('80', 'kg'), null);
  eq(CL.parseWeight('1e3', 'kg'), null); eq(CL.parseWeight('-4', 'kg'), null);
  eq(CL.fmtWeight(4.5, 'kg'), '4.50'); eq(CL.fmtWeight(4.536, 'lb'), '10.00');
  eq(CL.fmtDelta(0.08, 'kg'), '+0.08'); eq(CL.fmtDelta(-0.1, 'kg'), '−0.10'); eq(CL.fmtDelta(0, 'kg'), '±0.00');
});
t('日常：程度和小结', () => {
  eq(CL.dailyLevel(null), 0); eq(CL.dailyLevel({ flags: [] }), 0);
  eq(CL.dailyLevel({ app: 3 }), 1); eq(CL.dailyLevel({ app: 2 }), 2); eq(CL.dailyLevel({ app: 1 }), 3);
  eq(CL.dailyLevel({ app: 3, vomit: 1 }), 2); eq(CL.dailyLevel({ app: 3, vomit: 2 }), 3); eq(CL.dailyLevel({ poop: 0 }), 1);
  eq(CL.dailyLevel({ app: 3, flags: ['sneeze'] }), 2);
  const n = CL.normalDaily({});
  eq(CL.dailyAllNormal(n), true); eq(CL.dailySummary(n), '一切正常');
  eq(CL.dailySummary({ app: 2, vomit: 1, flags: ['eye'] }), '食欲偏少、呕吐 1 次、流泪眼屎');
  eq(CL.dailySummary({ app: 3 }), '食欲正常'); eq(CL.dailySummary({}), '还没记');
  eq(CL.normalDaily({ app: 2, flags: ['ear'] }), { app: 2, water: 2, energy: 2, poop: 1, pee: 1, vomit: 0, flags: ['ear'] });
  eq(CL.dailyIssues({ poop: 3, pee: 1 }).map((x) => x.text), ['大便拉稀']);
});
t('清洗：记录', () => {
  eq(CL.clean.entries({ id: 'a', pet_id: 'p', kind: 'weight', date: '2026-01-01', data: { kg: 80 } }), null);
  eq(CL.clean.entries({ id: 'a', pet_id: 'p', kind: 'weight', date: '2026-01-01', data: '{"kg":"4.2"}' }).data, { kg: 4.2 });
  eq(CL.clean.entries({ id: 'a', pet_id: 'p', kind: 'weight', date: '2026-01-01', data: '{oops' }), null);
  eq(CL.clean.entries({ id: 'a', pet_id: 'p', kind: 'nope', date: '2026-01-01', data: {} }), null);
  eq(CL.clean.entries({ id: 'a b', pet_id: 'p', kind: 'moment', date: '2026-01-01', data: {} }), null);
  eq(CL.clean.entries({ id: 'a', pet_id: 'p', kind: 'moment', date: '2026-02-30', data: {} }), null);
  const d = CL.clean.entries({ id: 'a', pet_id: 'p', kind: 'daily', date: '2026-01-01', data: { app: 9, water: '2', poop: 0, vomit: true, flags: ['eye', 'x', 'eye'], evil: 1 } });
  eq(d.data, { water: 2, poop: 0, flags: ['eye'] });
  const m = CL.clean.entries({ id: 'a', pet_id: 'p', kind: 'moment', date: '2026-01-01', time: '25:00', data: { star: 'TRUE', title: 'x'.repeat(99) }, media: 'm1, m2,m1,,bad id', created_by: 'z' });
  eq(m.media, ['m1', 'm2']); eq(m.time, ''); eq(m.data.star, true); eq(m.data.title.length, 40); eq(m.created_by, '');
  eq(CL.clean.entries({ id: 'a', pet_id: 'p', kind: 'health', date: '2026-01-01', data: { type: 'zzz', sev: 7, status: 'x', follow: 'soon' } }).data,
    { type: 'other', title: '', sev: null, clinic: '', status: 'done', follow: '' });
});
t('清洗：文字', () => {
  const p = CL.clean.pets({ id: 'p', name: '  年' + String.fromCharCode(7) + '糕\n ', chip: 900123456789012, color: 'red', note: 'a'.repeat(999) });
  eq(p.name, '年糕'); eq(p.chip, '900123456789012'); eq(p.color, CL.PET_COLORS[0]); eq(p.note.length, 500);
  eq(CL.clean.pets({ id: 'p', name: '   ' }), null);
  const cut = CL.util.str('ab' + String.fromCodePoint(0x1F431), 3);   // 第 3 个位置正好是表情的前一半
  eq(cut, 'ab');
  eq(CL.util.line('a\nb\tc', 20), 'a b c');
  eq(CL.clean.members({ id: 'c', name: 'x' }), null); eq(CL.clean.members({ id: 'a', name: '' }).name, '成员 A');
  eq(CL.clean.media({ id: 'm', kind: 'img', drive_id: '../etc' }).drive_id, '');
  eq(CL.okThumb('data:image/jpeg;base64,AAAA'), true); eq(CL.okThumb('data:image/svg+xml;base64,AAAA'), false);
  eq(CL.okThumb('data:image/png;base64,AA"onerror="x'), false); eq(CL.okThumb('javascript:alert(1)'), false);
});
t('合并：新增、修改、删除、整份替换、怪名字', () => {
  const T = CL.emptyTables();
  CL.merge(T, { pets: [{ id: 'p1', name: '年糕' }, { id: '__proto__', name: '怪名' }, { id: 'constructor', name: '构造' }], nope: [{ id: 'x' }] });
  eq(Object.keys(T.pets).sort(), ['__proto__', 'constructor', 'p1']); eq(T.pets.p1.name, '年糕'); eq({}.name, undefined);
  CL.merge(T, { pets: [{ id: 'p1', name: '年糕糕', rev: 5 }, { id: 'constructor', name: '构造', deleted: 'TRUE' }, { id: '__proto__', name: '怪名', deleted: true }, null, { id: 'bad id' }] });
  eq(T.pets.p1.name, '年糕糕'); eq(T.pets.p1.rev, 5); eq('constructor' in T.pets, false); eq(Object.keys(T.pets), ['p1']);   // 删掉的行带着完整内容来，也要拿掉
  CL.merge(T, { pets: [{ id: 'p1', name: '' }] });               // 变成不合格的 → 当作没有
  eq('p1' in T.pets, false);
  CL.merge(T, { pets: [{ id: 'p9', name: '新' }] }, true);
  eq(Object.keys(T.pets), ['p9']);
});
t('往返：网页的一行 ↔ 表格的一行', () => {
  const T = mk();
  const e = add(T, 'weight', '2026-11-01', { kg: 4.25 }, { note: '早上空腹', media: ['m1', 'm2'], time: '08:30' });
  const w = CL.toWire('entries', e, 'kg');
  eq(w.summary, '体重 4.25 kg'); eq(w.kg, 4.25); eq(w.data, '{"kg":4.25}'); eq(w.media, 'm1,m2'); eq('rev' in w, false);
  eq(CL.fromWire('entries', w), e);
  const s = shot(T, { name: '猫三联', code: 'FVRCP', date: '2026-01-02', next_due: '2027-01-02', lot: 'A123' });
  eq(s.code, 'fvrcp'); eq(CL.fromWire('shots', CL.toWire('shots', s)), s);
  eq(CL.fromWire('nope', {}), null); eq(CL.fromWire('pets', null), null);
});
t('一句话说明', () => {
  const T = mk();
  eq(CL.summary(add(T, 'food', '2026-11-01', { type: 'wet', name: '鸡肉罐头', amount: '半罐', change: true }), 'kg'), '换粮：罐头湿粮 鸡肉罐头 半罐');
  eq(CL.summary(add(T, 'activity', '2026-11-01', { type: 'wand', mins: 15 }), 'kg'), '活动：逗猫棒 15 分钟');
  eq(CL.summary(add(T, 'activity', '2026-11-01', { type: 'nail' }), 'kg'), '护理：剪指甲');
  eq(CL.summary(add(T, 'health', '2026-11-01', { type: 'vet', title: '软便' }), 'kg'), '健康：软便（看医生）');
  eq(CL.summary(add(T, 'moment', '2026-11-01', { star: true, title: '第一次上猫爬架' }), 'kg'), '里程碑：第一次上猫爬架');
  eq(CL.summary(add(T, 'moment', '2026-11-01', {}, { media: ['m1', 'm2'] }), 'kg'), '瞬间：2 张照片');
  eq(CL.summary(add(T, 'weight', '2026-11-01', { kg: 4.536 }), 'lb'), '体重 10.00 lb');
});
t('时间轴：顺序和筛选', () => {
  const T = mk(); img(T, 'm1'); T.media.f1 = CL.clean.media({ id: 'f1', kind: 'file', name: 'a.pdf' });
  const a = add(T, 'weight', '2026-11-01', { kg: 4 }, { time: '08:00' });
  const b = add(T, 'moment', '2026-11-01', {}, { time: '21:00', media: ['m1'] });
  const c = add(T, 'daily', '2026-11-03', { app: 2 });
  const d = add(T, 'daily', '2026-11-02', CL.normalDaily({}));
  const h = add(T, 'health', '2026-10-20', { type: 'vet' }, { media: ['f1'] });
  const s = shot(T, { name: '猫三联', code: 'fvrcp', date: '2026-11-02' });
  add(T, 'weight', '2026-11-05', { kg: 9 }, { pet_id: 'other' });
  eq(CL.timeline(T, 'p1').map((x) => x.id), [c.id, d.id, s.id, b.id, a.id, h.id]);   // 同一天、都没写时间的，后建的在前
  eq(CL.timeline(T, 'p1', 'photo').map((x) => x.id), [b.id]);
  eq(CL.timeline(T, 'p1', 'alert').map((x) => x.id), [c.id, h.id]);
  eq(CL.timeline(T, 'p1', 'shot').map((x) => x.id), [s.id]);
  eq(CL.timeline(T, 'p1', 'weight').map((x) => x.id), [a.id]);
  // 同一天里按几点排，不按先后录入的顺序
  const late = add(T, 'food', '2026-09-09', { type: 'dry' }, { time: '22:00' }), early = add(T, 'food', '2026-09-09', { type: 'wet' }, { time: '07:00' });
  eq(CL.timeline(T, 'p1', 'food').map((x) => x.id), [late.id, early.id]);
  T.entries = CL.map(); [c, d, b, a, h].forEach((x) => { T.entries[x.id] = x; });
  const g = CL.groupByMonth(CL.timeline(T, 'p1'));
  eq(g.map((x) => x.ym), ['2026-11', '2026-10']); eq(g[0].days.map((x) => x.date), ['2026-11-03', '2026-11-02', '2026-11-01']);
});
t('时间轴：生日和到家纪念日', () => {
  const T = mk();
  const m = CL.marks(T.pets.p1, '2025-06-01', '2026-11-13');
  eq(m.map((x) => x.date + x.text).sort(), ['2025-06-10出生', '2025-08-20到家第一天', '2026-06-101 岁生日', '2026-08-20到家 1 周年']);
  eq(CL.marks(T.pets.p1, '2026-07-01', '2026-07-31'), []);
  eq(CL.marks(CL.clean.pets({ id: 'x', name: 'x' }), '2020-01-01', '2026-01-01'), []);
});
t('疫苗：单条的状态', () => {
  eq(CL.shotStatus('', '2026-11-13'), { state: 'done', days: null });
  eq(CL.shotStatus('2026-11-12', '2026-11-13'), { state: 'over', days: -1 });
  eq(CL.shotStatus('2026-11-13', '2026-11-13'), { state: 'soon', days: 0 });
  eq(CL.shotStatus('2026-12-13', '2026-11-13'), { state: 'soon', days: 30 });
  eq(CL.shotStatus('2026-12-14', '2026-11-13'), { state: 'ok', days: 31 });
  // 提前量跟着间隔走
  eq(CL.soonWindow('2025-12-01', '2026-12-01'), 30); eq(CL.soonWindow('2026-11-01', '2026-12-01'), 8); eq(CL.soonWindow('2026-11-01', '2026-11-08'), 3); eq(CL.soonWindow('', '2026-12-01'), 30);
  eq(CL.shotStatus('2026-12-13', '2026-11-13', '2026-11-13').state, 'ok');       // 一个月一次的：刚做完不算快到期
  eq(CL.shotStatus('2026-11-21', '2026-11-13', '2026-10-21').state, 'soon');     // 还有 8 天
  eq(CL.shotStatus('2026-11-22', '2026-11-13', '2026-10-22').state, 'ok');       // 还有 9 天
  eq(CL.shotStatus('2026-12-13', '2026-11-13', '2025-12-13').state, 'soon');     // 一年一针的：提前 30 天
});
t('疫苗：状态板', () => {
  const T = mk(), today = '2026-11-13';
  let b = CL.shotBoard(T, T.pets.p1, 'vaccine', today);
  eq(b.map((r) => [r.code, r.state]), [['fvrcp', 'none'], ['rabies', 'none']]);
  shot(T, { name: '猫三联', code: 'fvrcp', date: '2025-08-01', next_due: '2025-08-29' });
  shot(T, { name: '猫三联', code: 'fvrcp', date: '2025-08-29', next_due: '2026-08-29' });   // 最近一次，已过期
  shot(T, { name: '狂犬疫苗', code: 'rabies', date: '2025-12-01', next_due: '2026-12-01' });
  shot(T, { name: 'FIP 疫苗', date: '2026-01-01' });
  shot(T, { name: ' fip  疫苗', date: '2026-03-01', next_due: '2027-03-01' });               // 同一个名字（忽略大小写和空格）
  shot(T, { name: '体内驱虫', code: 'inner', kind: 'deworm', date: '2026-10-20', next_due: '2026-11-20' });   // 还有 7 天，间隔一个月
  b = CL.shotBoard(T, T.pets.p1, 'vaccine', today);
  eq(b.map((r) => [r.name, r.state, r.days, r.list.length]), [['猫三联', 'over', -76, 2], ['狂犬疫苗', 'soon', 18, 1], ['FIP 疫苗', 'ok', 108, 2]]);
  eq(b[0].last.date, '2025-08-29');
  eq(CL.shotBoard(T, T.pets.p1, 'deworm', today).map((r) => [r.name, r.state]), [['体内驱虫', 'soon']]);
  eq(CL.shotBoard(T, CL.clean.pets({ id: 'dog', name: '狗', species: 'dog' }), 'vaccine', today).map((r) => r.code), ['dhpp', 'rabies']);
});
t('首页提醒', () => {
  const T = mk(), today = '2026-06-05';
  shot(T, { name: '猫三联', code: 'fvrcp', date: '2025-05-01', next_due: '2026-05-01' });
  shot(T, { name: '狂犬疫苗', code: 'rabies', date: '2025-06-20', next_due: '2026-06-20' });
  add(T, 'health', '2026-05-20', { type: 'vet', title: '牙龈红', status: 'open', follow: '2026-06-08' });
  add(T, 'health', '2026-05-21', { type: 'vet', title: '好了的', status: 'done', follow: '2026-06-06' });
  add(T, 'weight', '2026-04-20', { kg: 4 });
  const r = CL.reminders(T, T.pets.p1, today);
  eq(r.map((x) => x.text), ['猫三联已过期 35 天', '复查：牙龈红', '狂犬疫苗 还有 15 天', '1 岁生日还有 5 天', '有 46 天没称体重了']);
  eq(r.map((x) => x.level), [3, 2, 2, 1, 1]);
  eq(CL.reminders(mk(), T.pets.p1, '2026-01-01'), []);
});
t('体重：趋势', () => {
  const T = mk();
  eq(CL.weightStats(CL.weights(T, 'p1')), null);
  add(T, 'weight', '2026-09-01', { kg: 4.0 }); add(T, 'weight', '2026-10-10', { kg: 4.3 }); add(T, 'weight', '2026-11-01', { kg: 4.25 }); add(T, 'weight', '2026-11-10', { kg: 4.4 });
  const s = CL.weightStats(CL.weights(T, 'p1'));
  eq([s.last.kg, s.prev.kg, s.delta, s.ref.date, s.refDelta, s.min.kg, s.max.kg, s.n], [4.4, 4.25, 0.15, '2026-10-10', 0.1, 4.0, 4.4, 4]);
  eq(CL.weightNear(CL.weights(T, 'p1'), '2026-10-01').kg, 4.3); eq(CL.weightNear(CL.weights(T, 'p1'), '2025-01-01'), null);
});
t('相册：按月龄分，里程碑当封面', () => {
  const T = mk(); ['a', 'b', 'c', 'd'].forEach((x) => img(T, x));
  add(T, 'moment', '2025-08-21', {}, { media: ['a'] });
  add(T, 'moment', '2025-08-25', { star: true }, { media: ['b'] });
  add(T, 'weight', '2026-11-12', { kg: 4.4 }, { media: ['c'] });
  add(T, 'moment', '2026-11-12', {}, { media: ['zzz'] });      // 不认识的图片不算
  let al = CL.album(T, T.pets.p1);
  eq(al.map((g) => [g.label, g.cover, g.items.length]), [['2 个月', 'b', 2], ['1 岁 5 个月', 'c', 1]]);
  eq(CL.firstLast(T, T.pets.p1).first.mid, 'a'); eq(CL.firstLast(T, T.pets.p1).last.mid, 'c');
  T.pets.p1.birthday = '';
  al = CL.album(T, T.pets.p1);
  eq(al.map((g) => g.label), ['2025 年 8 月', '2026 年 11 月']);
  eq(CL.counts(T, T.pets.p1, '2026-11-13'), { entries: 4, photos: 3, days: 3, weights: 1, home: 451 });
});
t('状态日历', () => {
  const T = mk(); img(T, 'm1');
  add(T, 'daily', '2026-11-02', { app: 1 }); add(T, 'daily', '2026-11-03', CL.normalDaily({})); add(T, 'weight', '2026-11-03', { kg: 4 }, { media: ['m1'] });
  const g = CL.monthGrid(T, 'p1', '2026-11', '2026-11-13');
  eq(g.label, '2026 年 11 月'); eq(g.cells.length, 42); eq(g.cells.slice(0, 6), [null, null, null, null, null, null]);   // 11 月 1 日是周日，周一开头要空六格
  eq(g.cells[6].day, 1); eq(g.cells[7].level, 3); eq([g.cells[8].level, g.cells[8].weight, g.cells[8].photo], [1, true, true]);
  eq(g.cells[18].today, true); eq(g.cells[19].future, true);
  eq(CL.monthGrid(T, 'p1', '2026-02', '2026-11-13').cells.filter(Boolean).length, 28);
});
t('连续记录和近 30 天', () => {
  const T = mk();
  ['2026-11-12', '2026-11-11', '2026-11-10', '2026-11-08'].forEach((d) => add(T, 'daily', d, CL.normalDaily({})));
  eq(CL.streak(T, 'p1', '2026-11-13'), 3);
  add(T, 'daily', '2026-11-13', { vomit: 2 });
  eq(CL.streak(T, 'p1', '2026-11-13'), 4);
  add(T, 'daily', '2026-11-09', { flags: [] });                 // 空的不算
  eq(CL.streak(T, 'p1', '2026-11-13'), 4);
  eq(CL.recent(T, 'p1', '2026-11-13', 30), { days: 30, logged: 5, warn: 0, bad: 1, vomit: 2 });
});
t('那年今日', () => {
  const T = mk(); ['a', 'b', 'c'].forEach((x) => img(T, x));
  eq(CL.memory(T, 'p1', '2026-11-13'), null);
  const x = add(T, 'moment', '2025-11-15', {}, { media: ['a'] });
  eq(CL.memory(T, 'p1', '2026-11-13').entry.id, x.id); eq(CL.memory(T, 'p1', '2026-11-13').label, '1 年前的这几天');
  const y = add(T, 'moment', '2025-11-13', {}, { media: ['b'] });
  eq(CL.memory(T, 'p1', '2026-11-13').entry.id, y.id); eq(CL.memory(T, 'p1', '2026-11-13').label, '1 年前的今天');
  const T2 = mk(); img(T2, 'c'); const z = add(T2, 'moment', '2026-08-12', {}, { media: ['c'] });
  eq(CL.memory(T2, 'p1', '2026-11-13').entry.id, z.id); eq(CL.memory(T2, 'p1', '2026-11-13').label, '3 个月前的这几天');
  eq(CL.memory(T2, 'p1', '2026-09-30'), null);
});
t('护理：每种上次是什么时候，定了间隔的到时间算「该做了」', () => {
  const T = mk(), today = '2026-11-13', P = T.pets.p1;
  eq(CL.careBoard(T, P, today).map((c) => [c.type, c.state, c.days, c.count]), [['nail', 'none', null, 0], ['teeth', 'none', null, 0], ['brush', 'none', null, 0], ['bath', 'none', null, 0], ['ear', 'none', null, 0]]);
  add(T, 'activity', '2026-10-17', { type: 'nail' }); add(T, 'activity', '2026-09-16', { type: 'nail' });
  const late = add(T, 'activity', '2026-10-31', { type: 'teeth' }, { time: '21:00' }); add(T, 'activity', '2026-10-31', { type: 'teeth' }, { time: '08:00' });
  add(T, 'activity', '2026-11-12', { type: 'wand', mins: 10 });                     // 玩耍不算护理
  add(T, 'activity', '2026-11-20', { type: 'bath' });                               // 日期在将来的不算
  add(T, 'activity', '2026-11-13', { type: 'ear' }, { pet_id: 'other' });           // 别的猫的不算
  let b = CL.careBoard(T, P, today), by = (t) => b.filter((c) => c.type === t)[0];
  eq([by('nail').days, by('nail').count, by('nail').last.date, by('nail').state, by('nail').every, by('nail').left], [27, 2, '2026-10-17', 'ok', null, null]);
  eq([by('teeth').days, by('teeth').last.id, by('bath').state, by('ear').state], [13, late.id, 'none', 'none']);
  // 定间隔：设置表里的 care_猫_类型
  const set = (type, v) => { T.settings[CL.careKey('p1', type)] = CL.clean.settings({ id: CL.careKey('p1', type), value: v }); };
  set('nail', '30'); set('teeth', '13'); set('brush', '7'); set('bath', 'abc'); set('ear', '0');
  b = CL.careBoard(T, P, today);
  eq(b.map((c) => [c.type, c.every, c.left, c.state]), [['nail', 30, 3, 'ok'], ['teeth', 13, 0, 'due'], ['brush', 7, null, 'due'], ['bath', null, null, 'none'], ['ear', null, null, 'none']]);
  eq(CL.reminders(T, P, today).map((r) => r.text), ['该刷牙了', '该梳毛了']);         // 剪指甲定了每 30 天、还有 3 天：不提醒
  set('nail', '21');
  eq(by.call(null, 'nail') && CL.careBoard(T, P, today)[0].left, -6);
  eq(CL.careHistory(T, 'p1', 'nail').map((e) => e.date), ['2026-10-17', '2026-09-16']);
  eq(CL.reminders(T, P, today).map((r) => [r.text, r.sub, r.go, r.type]), [['该剪指甲了', '上次 27 天前，定的是每 21 天', 'care', 'nail'], ['该刷牙了', '上次 13 天前，定的是每 13 天', 'care', 'teeth'], ['该梳毛了', '还没记过', 'care', 'brush']]);
  eq([CL.daysAgo(0), CL.daysAgo(1), CL.daysAgo(2), CL.daysAgo(27)], ['今天', '昨天', '前天', '27 天前']);
  // 每天一次：今天做了不算该做，昨天做的今天就该做了
  set('teeth', '1'); add(T, 'activity', '2026-11-13', { type: 'ear' }); set('ear', '1'); set('nail', ''); set('brush', '');
  b = CL.careBoard(T, P, today);
  eq([by('teeth').state, by('ear').state, by('ear').left, by('nail').every], ['due', 'ok', 1, null]);
  eq(CL.reminders(T, P, today).map((r) => [r.text, r.sub]), [['该刷牙了', '上次 13 天前，定的是每天']]);
  eq(CL.careBoard(T, P, '2026-11-14').filter((c) => c.type === 'ear').map((c) => [c.state, c.left]), [['due', 0]]);
  eq([CL.everyText(1), CL.everyText(14)], ['每天', '每 14 天']);
  eq(CL.careKey('p1', 'nail'), 'care_p1_nail');
});
t('金额：读数和写法', () => {
  eq([CL.parseMoney('250'), CL.parseMoney(' $1,240.50 '), CL.parseMoney('￥３８．５'), CL.parseMoney('38.5元'), CL.parseMoney(''), CL.parseMoney('  ')], [250, 1240.5, 38.5, 38.5, '', '']);
  eq([CL.parseMoney('abc'), CL.parseMoney('12.345'), CL.parseMoney('-5'), CL.parseMoney('1e3'), CL.parseMoney('1.2.3')], [null, null, null, null, null]);
  // 小数点是逗号的键盘：38,5 是 38.5，不是 385；千分位照旧
  eq([CL.parseMoney('38,5'), CL.parseMoney('12,34'), CL.parseMoney('€ 9,90'), CL.parseMoney('1,240'), CL.parseMoney('12,345,678'), CL.parseMoney('1,240.5'), CL.parseMoney('1.240,50'), CL.parseMoney(','), CL.parseMoney('5,')],
    [38.5, 12.34, 9.9, 1240, 12345678, 1240.5, null, '', 5]);
  eq([CL.fmtMoney(1240.5, '$'), CL.fmtMoney(42, '$'), CL.fmtMoney(0, '$'), CL.fmtMoney(9971.2), CL.fmtMoney(1234567.891, '¥'), CL.fmtMoney('', '$'), CL.fmtMoney(999.999, '€')], ['$1,240.50', '$42', '$0', '$9,971.20', '¥1,234,567.89', '', '€1,000']);
  eq([CL.verGte('1.1.0', '1.1.0'), CL.verGte('1.0.9', '1.1.0'), CL.verGte('1.10.0', '1.9.0'), CL.verGte('2.0.0', '1.9.9'), CL.verGte('', '1.1.0'), CL.verGte('1.1', '1.1.0')], [true, false, true, true, false, true]);
});
t('保险：清洗', () => {
  eq(CL.clean.policies({ id: 'p', pet_id: 'x', company: '  ' }), null); eq(CL.clean.policies({ id: 'p', company: '某某' }), null);
  const p = CL.clean.policies({ id: 'p', pet_id: 'x', company: '某某保险', payer: 'c', premium: '38.456', currency: '￥', limit_amt: '', deductible: -5, rate: 150, start: '2026-02-30', renew: '2027-03-01', used0: '12', ded0: 'abc', media: 'm1,m1' });
  eq([p.payer, p.premium, p.currency, p.limit_amt, p.deductible, p.rate, p.start, p.renew, p.used0, p.ded0, p.media], ['', 38.46, '$', '', '', '', '', '2027-03-01', 12, '', ['m1']]);
  eq(CL.clean.policies({ id: 'p', pet_id: 'x', company: 'c', rate: 0, limit_amt: 0 }).rate, 0);
  eq(CL.clean.claims({ id: 'c', pet_id: 'x', date: '2026-01-01', title: '' }), null); eq(CL.clean.claims({ id: 'c', pet_id: 'x', date: 'soon', title: 't' }), null);
  const c = CL.clean.claims({ id: 'c', pet_id: 'x', policy_id: 'bad id', date: '2026-01-01', title: '看牙', bill: '120', paid: '', ded: true, status: 'zzz' });
  eq([c.policy_id, c.bill, c.paid, c.ded, c.status], ['', 120, '', '', 'sent']);
  eq(CL.fromWire('claims', CL.toWire('claims', c)), c);
  eq(CL.TABLES.indexOf('policies') >= 0 && CL.TABLES.indexOf('claims') >= 0, true); eq(CL.TABLE_SINCE, { policies: '1.1.0', claims: '1.1.0' });
});
t('保险：已用、还剩、自付额、续保', () => {
  const T = mk(), today = '2026-11-13';
  const pol = (o) => { const r = CL.clean.policies(Object.assign({ id: 'pol1', pet_id: 'p1', company: '某某保险', premium: 38.5, limit_amt: 10000, deductible: 250, rate: 80, start: '2026-03-01', renew: '2027-03-01' }, o || {})); T.policies[r.id] = r; return r; };
  const claim = (id, date, o) => { const r = CL.clean.claims(Object.assign({ id, pet_id: 'p1', policy_id: 'pol1', date, title: '事 ' + id }, o)); T.claims[id] = r; return r; };
  let v = CL.policyView(T, pol(), today);
  eq([v.used, v.left, v.usedPct, v.dedMet, v.dedLeft, v.dedPct, v.yearPremium, v.daysToRenew, v.state, v.from, v.to, v.claims.length], [0, 10000, 0, 0, 250, 0, 462, 108, 'ok', '2026-03-01', '2027-03-01', 0]);
  claim('c1', '2026-10-04', { bill: 286, paid: 28.8, ded: 250, status: 'paid' });
  claim('c2', '2026-11-05', { bill: 120, status: 'sent' });
  claim('c3', '2026-06-01', { bill: 900, paid: 720, ded: 100, status: 'denied' });         // 被拒的不算已用，也不抵自付额
  claim('c4', '2026-02-28', { bill: 50, paid: 40, status: 'paid' });                      // 上一个年度的
  claim('c5', '2027-03-01', { bill: 60, paid: 48, status: 'paid' });                      // 续保日当天算下一个年度
  claim('c6', '2026-03-01', { bill: 10.1, paid: 0.1, ded: 10, status: 'paid' });          // 年度的第一天算本年度
  claim('zz', '2026-10-01', { bill: 999, paid: 999, policy_id: 'other', status: 'paid' });
  v = CL.policyView(T, T.policies.pol1, today);
  eq([v.used, v.left, v.usedPct, v.dedMet, v.dedLeft, v.dedPct, v.billed, v.pending], [28.9, 9971.1, 0, 250, 0, 100, 1316.1, 1]);
  eq([v.claims.map((c) => c.id), v.older.map((c) => c.id)], [['c2', 'c1', 'c3', 'c6'], ['c5', 'c4']]);
  // 手填的起始数加在前面；自付额最多抵到自付额那么多
  v = CL.policyView(T, pol({ used0: 1000, ded0: 100 }), today);
  eq([v.used, v.left, v.usedPct, v.dedMet, v.dedLeft], [1028.9, 8971.1, 10, 250, 0]);
  v = CL.policyView(T, pol({ limit_amt: '', deductible: '' }), today);
  eq([v.left, v.usedPct, v.dedLeft, v.dedPct, v.dedMet], [null, null, null, null, 260]);
  v = CL.policyView(T, pol({ limit_amt: 20 }), today); eq([v.left, v.usedPct], [0, 100]);
  // 没填开始日：按续保日往前一年；开始日不在续保日之前也一样
  eq(CL.policyView(T, pol({ start: '' }), today).from, '2026-03-01'); eq(CL.policyView(T, pol({ start: '2027-06-01' }), today).from, '2026-03-01');
  // 没填续保日：不分年度，全算
  v = CL.policyView(T, pol({ start: '', renew: '' }), today); eq([v.state, v.daysToRenew, v.older.length, v.claims.length], ['none', null, 0, 6]);
  // 快续保、过了续保日
  eq([CL.policyView(T, pol({ start: '2025-12-13', renew: '2026-12-13' }), today).state, CL.policyView(T, pol({ start: '2025-12-14', renew: '2026-12-14' }), today).state], ['soon', 'ok']);
  v = CL.policyView(T, pol({ start: '2025-11-01', renew: '2026-11-01' }), today); eq([v.state, v.daysToRenew], ['over', -12]);
  eq(CL.reminders(T, T.pets.p1, today).map((r) => [r.text, r.go]), [['保险的续保日过了 12 天', 'insure']]);
  pol({ start: '2025-12-01', renew: '2026-12-01' });
  eq(CL.reminders(T, T.pets.p1, today).map((r) => [r.text, r.sub]), [['保险还有 18 天续保', '某某保险 · 2026/12/1']]);
  // 顺延一年
  const rolled = CL.rollPolicy(pol({ start: '2025-11-01', renew: '2026-11-01', used0: 500, ded0: 100 }));
  eq([rolled.start, rolled.renew, rolled.used0, rolled.ded0, rolled.company, rolled.id], ['2026-11-01', '2027-11-01', '', '', '某某保险', 'pol1']);
  eq(CL.rollPolicy(pol({ renew: '' })), null);
  eq(CL.policiesOf(T, 'p1').length, 1); eq(CL.policiesOf(T, 'nobody'), []); eq(CL.policiesOf({}, 'p1'), []);
});
t('初始化链接', () => {
  const api = 'https://script.google.com/macros/s/' + 'A'.repeat(40) + '/exec', tok = 'a'.repeat(64);
  const link = CL.makeInit('https://x.github.io/catlog/#old', api, tok);
  eq(link.indexOf('https://x.github.io/catlog/#init='), 0);
  eq(CL.parseInit(link), { u: api, t: tok, w: '' }); eq(CL.parseInit('点这个 ' + link + ' 就行'), { u: api, t: tok, w: '' });
  eq(CL.parseInit(CL.makeInit('https://x.github.io/catlog/', api, tok, 'b')).w, 'b');
  eq(CL.parseInit('#init=' + CL.b64uEncode(JSON.stringify({ v: 1, u: api, t: tok, w: '<script>' }))).w, '');
  eq(CL.parseInit('#init=' + CL.b64uEncode(JSON.stringify({ v: 1, u: 'https://evil.example/exec', t: tok }))), null);
  eq(CL.parseInit('#init=' + CL.b64uEncode(JSON.stringify({ v: 1, u: api, t: 'short' }))), null);
  eq(CL.parseInit('#init=' + CL.b64uEncode(JSON.stringify({ v: 2, u: api, t: tok }))), null);
  eq(CL.parseInit('nothing'), null); eq(CL.parseInit('#init=' + 'x'.repeat(30)), null);
  eq(CL.okApi('http://127.0.0.1:8123/macros/s/TEST/exec'), true); eq(CL.okApi('http://127.0.0.1.evil.com/x'), false);
  eq(CL.okApi('https://script.google.com.evil.com/macros/s/' + 'A'.repeat(40) + '/exec'), false);
  eq(CL.okApi('https://evil.example/?x=https://script.google.com/macros/s/' + 'A'.repeat(40) + '/exec'), false);
  eq(CL.okApi('https://script.google.com/macros/s/' + 'A'.repeat(40) + '/exec?x=1'), false); eq(CL.okApi('http://script.google.com/macros/s/' + 'A'.repeat(40) + '/exec'), false);
  eq(CL.b64uDecode(CL.b64uEncode('年糕 🐱 a+b/c')), '年糕 🐱 a+b/c');
});
t('编号', () => {
  const seen = new Set(); for (let i = 0; i < 2000; i++) seen.add(CL.newId());
  eq(seen.size, 2000); eq(/^[0-9a-z]{12}$/.test(CL.newId()), true);
  eq(CL.dailyId('p1', '2026-11-13'), 'd_p1_20261113');
});

console.log('\n' + pass + ' 项通过' + (fail ? '，' + fail + ' 项失败' : ''));
process.exit(fail ? 1 : 0);
