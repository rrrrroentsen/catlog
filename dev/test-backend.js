// 后端 Code.gs 的测试：在模拟的 Apps Script 环境里跑真实的 Code.gs。node dev/test-backend.js
'use strict';
const path = require('path');
const assert = require('assert');
const APP = process.env.CATLOG_APP || path.join(__dirname, '..', 'app');
const CL = require(path.join(APP, 'core.js'));
const { createEnv } = require('./gas-mock.js');
const CODE = process.env.CATLOG_CODE || path.join(APP, 'Code.gs');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('FAIL  ' + name + '\n      ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n      ')); }
}
const eq = assert.deepStrictEqual;

function boot() { const env = createEnv({ code: CODE }); env.call('setup'); return env; }
let opSeq = 0;
function op(table, t, row) { return { id: 'op' + (++opSeq) + 'x' + CL.newId(), table, t, row }; }
function sync(env, who, since, ops, extra) { return env.post(Object.assign({ v: 1, token: env.token(who), action: 'sync', since, ops: ops || [] }, extra || {})); }
function entry(id, kind, date, data, extra) {
  const r = CL.clean.entries(Object.assign({ id, pet_id: 'pet1', kind, date, data }, extra || {}));
  assert.ok(r, '造不出记录');
  return CL.toWire('entries', r, 'kg');
}
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
const THUMB = 'data:image/jpeg;base64,' + JPEG.toString('base64');
function upload(env, who, id, extra) {
  return env.post(Object.assign({ v: 1, token: env.token(who), action: 'upload', id, kind: 'img', name: 'IMG_0001.jpg', mime: 'image/jpeg', w: 1600, h: 1200, thumb: THUMB, data: JPEG.toString('base64'), date: '2026-11-13' }, extra || {}));
}

console.log('Code.gs（模拟环境）');

t('setup：建表、默认成员、口令、文件夹，重复运行不动数据', () => {
  const env = boot();
  eq(env.sheets.map((s) => s.name).sort(), ['claims', 'docs', 'entries', 'media', 'members', 'pets', 'policies', 'settings', 'shots', 'thumbs']);
  eq(env.rows('members').map((r) => [r.id, r.name, r.color]), [['a', '成员 A', '#2a78d6'], ['b', '成员 B', '#eb6834']]);
  eq(env.rows('settings').map((r) => [r.id, r.value]), [['unit', 'kg']]);
  eq(env.sheet('thumbs').hidden, true); eq(env.sheet('entries').frozen, 1);
  const ta = env.token('a'), tb = env.token('b');
  eq(/^[0-9a-f]{64}$/.test(ta), true); eq(ta === tb, false);
  eq([...env.folders.values()].map((f) => f.name).sort(), ['CatLog 猫咪日志', '文件', '照片']);
  eq(env.alerts.length, 0); eq(env.toasts.length, 1); eq(/部署/.test(env.toasts[0][1]), true);   // 只冒一条小提示，不弹窗（弹窗会让编辑器里的运行一直等着）
  eq(env.logs.some((l) => /准备好了/.test(l) && /drive\.google\.com/.test(l)), true);
  sync(env, 'a', 0, [op('entries', 'put', entry('e1', 'weight', '2026-11-13', { kg: 4.2 }))]);
  env.call('setup');
  eq(env.token('a'), ta); eq(env.rows('members').length, 2); eq(env.rows('entries').length, 1); eq(env.folders.size, 3);
  eq(env.stats.locks, env.stats.unlocks);
});
t('setup：在编辑器里运行（没有界面）也能完成', () => {
  const env = createEnv({ code: CODE, ui: false });
  env.call('setup');
  eq(env.rows('members').length, 2); eq(env.logs.some((l) => /准备好了/.test(l)), true);
});
t('口令：不对、没带、格式坏了都被拒绝', () => {
  const env = boot();
  eq(env.post({ action: 'sync', token: 'x'.repeat(64), since: 0 }).error, 'auth');
  eq(env.post({ action: 'sync', since: 0 }).error, 'auth');
  eq(env.post({ action: 'sync', token: '', since: 0 }).error, 'auth');
  eq(JSON.parse(env.postRaw('not json')).ok, false);
  eq(JSON.parse(env.postRaw('null')).error, 'bad_request');
  eq(env.post({ action: 'nope', token: env.token('a') }).error, 'bad_request');
  eq(env.post({ action: 'ping', token: env.token('b') }), { ok: true, v: CL.VERSION, me: 'b' });
  eq(env.get().app, 'catlog');
  const blank = createEnv({ code: CODE });                       // 还没 setup：没有口令，谁也进不来
  eq(blank.post({ action: 'sync', token: 'undefined', since: 0 }).error, 'auth');
  eq(blank.post({ action: 'sync', token: 'null', since: 0 }).error, 'auth');
});
t('同步：新增一条，另一部手机按版本号拿到', () => {
  const env = boot();
  const first = sync(env, 'a', 0);
  eq(first.reset, true); eq(first.me, 'a'); eq(first.changes.members.length, 2); eq(first.rev, 1);
  const o = op('entries', 'put', entry('e1', 'weight', '2026-11-13', { kg: 4.25 }, { time: '08:30', note: '早上空腹' }));
  const r = sync(env, 'a', first.rev, [o]);
  eq(r.rev, 2); eq(r.acked, [o.id]); eq(r.changes.entries.length, 1);
  const row = env.rows('entries')[0];
  eq([row.id, row.pet_id, row.kind, row.date, row.time, row.summary, row.kg, row.data, row.note, row.created_by, row.updated_by, row.rev, row.deleted],
    ['e1', 'pet1', 'weight', '2026-11-13', '08:30', '体重 4.25 kg', 4.25, '{"kg":4.25}', '早上空腹', 'a', 'a', 2, '']);
  const b = sync(env, 'b', 1);
  eq(b.reset, false); eq(Object.keys(b.changes), ['entries']);
  eq(CL.fromWire('entries', b.changes.entries[0]).data, { kg: 4.25 });
  eq(sync(env, 'b', 2), { ok: true, v: CL.VERSION, me: 'b', rev: 2, unchanged: true });
});
t('同步：没变化的表不去读', () => {
  const env = boot();
  sync(env, 'a', 1, [op('entries', 'put', entry('e1', 'weight', '2026-11-13', { kg: 4 }))]);
  const before = env.stats.reads;
  sync(env, 'b', 2);                                             // 没变化：一张表都不读
  eq(env.stats.reads, before);
  sync(env, 'b', 1);                                             // 只有 entries 变过：读表头和内容各一次
  eq(env.stats.reads - before, 2);
});
t('同步：网页的版本号比表格还新（表格被换过）→ 整份重来', () => {
  const env = boot();
  const r = sync(env, 'a', 999);
  eq(r.reset, true); eq(r.changes.members.length, 2);
  eq(sync(env, 'a', -5).reset, true); eq(sync(env, 'a', 'abc').reset, true);
});
t('文字原样保存：日期、时间、长数字、等号开头、单引号开头', () => {
  const env = boot();
  const pet = CL.toWire('pets', CL.clean.pets({ id: 'pet1', name: '=年糕', chip: '900123456789012345', birthday: '2025-06-10', note: "'引号开头\n第二行", breed: '00123', coat: 'TRUE' }));
  sync(env, 'a', 1, [op('pets', 'put', pet), op('entries', 'put', entry('e1', 'moment', '2026-01-02', { title: '+1' }, { time: '07:05', note: '=SUM(A1:A9)' }))]);
  const row = env.rows('pets')[0];
  eq([row.name, row.chip, row.birthday, row.note, row.breed, row.coat], ['=年糕', '900123456789012345', '2025-06-10', "'引号开头\n第二行", '00123', 'TRUE']);
  eq(typeof row.chip, 'string'); eq(typeof row.birthday, 'string');
  const back = sync(env, 'b', 1).changes;
  eq(CL.fromWire('pets', back.pets[0]).chip, '900123456789012345');
  eq(back.entries[0].note, '=SUM(A1:A9)'); eq(back.entries[0].time, '07:05'); eq(back.entries[0].date, '2026-01-02');
  // 再改一次这一行（走「读出来、改、写回去」那条路），等号开头的文字还是文字
  sync(env, 'b', 2, [op('pets', 'put', { id: 'pet1', coat: '蓝' })]);
  eq(env.rows('pets')[0].name, '=年糕'); eq(env.rows('pets')[0].note, "'引号开头\n第二行"); eq(env.rows('pets')[0].coat, '蓝');
});
t('修改：只动网页能改的列，谁建的不变，多出来的列不受影响', () => {
  const env = boot();
  sync(env, 'a', 1, [op('entries', 'put', entry('e1', 'weight', '2026-11-13', { kg: 4 }, { created_at: '2026-11-13T14:00:00.000Z' }))]);
  const sh = env.sheet('entries');
  sh.put(1, 17, '我加的列'); sh.put(2, 17, '手写备注');            // 有人在表格右边自己加了一列
  const evil = Object.assign(entry('e1', 'weight', '2026-11-13', { kg: 4.1 }), { created_by: 'b', rev: 99, updated_by: 'zz', id: 'e1', deleted: true, 我加的列: 'x' });
  const r = sync(env, 'b', 2, [op('entries', 'put', evil)]);
  const row = env.rows('entries')[0];
  eq([row.kg, row.created_by, row.created_at, row.updated_by, row.rev, row.deleted, row['我加的列']], [4.1, 'a', '2026-11-13T14:00:00.000Z', 'b', 3, '', '手写备注']);
  eq(r.changes.entries[0].updated_by, 'b');
  // 只带了一部分列的修改：没带的列保持原样
  sync(env, 'a', 3, [op('entries', 'put', { id: 'e1', note: '补一句' })]);
  eq([env.rows('entries')[0].note, env.rows('entries')[0].kg, env.rows('entries')[0].kind], ['补一句', 4.1, 'weight']);
});
t('表格里的列被人挪了顺序，照样读写', () => {
  const env = boot();
  const sh = env.sheet('entries'), head = sh.rows[0].slice();
  const swapped = head.slice(); swapped[0] = head[3]; swapped[3] = head[0];   // id 和 date 换位置
  sh.rows[0] = swapped; sh.formats = [];
  sync(env, 'a', 1, [op('entries', 'put', entry('e1', 'weight', '2026-11-13', { kg: 4 }))]);
  eq([sh.rows[1][0], sh.rows[1][3]], ['2026-11-13', 'e1']);      // 按表头找列，不按位置；新行的格式也跟着表头走
  const back = sync(env, 'b', 1).changes.entries[0];
  eq([back.id, back.date], ['e1', '2026-11-13']);
});
t('删除和恢复：软删除，增量同步带删除标记，整份同步不带已删的', () => {
  const env = boot();
  sync(env, 'a', 1, [op('entries', 'put', entry('e1', 'weight', '2026-11-13', { kg: 4 })), op('entries', 'put', entry('e2', 'weight', '2026-11-12', { kg: 4 }))]);
  const d = sync(env, 'a', 2, [op('entries', 'del', { id: 'e1' })]);
  eq(d.changes.entries.map((r) => [r.id, r.deleted]), [['e1', true]]);
  eq(env.rows('entries').map((r) => r.deleted), [true, '']);
  eq(sync(env, 'b', 0).changes.entries.map((r) => r.id), ['e2']);
  const u = sync(env, 'b', 3, [op('entries', 'undel', { id: 'e1' })]);
  eq(u.changes.entries.map((r) => [r.id, !!r.deleted, r.updated_by]), [['e1', false, 'b']]);
  const before = env.rows('entries').length;
  const none = sync(env, 'a', 4, [op('entries', 'del', { id: 'nothere' })]);        // 删一个不存在的：什么也不发生
  eq([none.rev, env.rows('entries').length], [4, before]);
  // 删掉以后又写同一个编号（比如某天的日常状态删了又重新记）：这一行活过来
  sync(env, 'a', 4, [op('entries', 'del', { id: 'e2' })]);
  sync(env, 'a', 5, [op('entries', 'put', entry('e2', 'weight', '2026-11-12', { kg: 4.3 }))]);
  eq(env.rows('entries').filter((r) => r.id === 'e2').map((r) => [r.deleted, r.kg]), [['', 4.3]]);
});
t('重发：同一个操作只做一遍', () => {
  const env = boot();
  const o = op('entries', 'put', entry('e1', 'weight', '2026-11-13', { kg: 4 }));
  const r1 = sync(env, 'a', 1, [o]), r2 = sync(env, 'a', 1, [o]);
  eq([r1.rev, r2.rev, r2.acked], [2, 2, [o.id]]); eq(env.rows('entries').length, 1);
  // 回应丢了 → 对方在这期间改了同一条 → 这边重发旧操作：对方的修改不能被盖掉
  sync(env, 'b', 2, [op('entries', 'put', entry('e1', 'weight', '2026-11-13', { kg: 4.5 }))]);
  sync(env, 'a', 1, [o]);
  eq(env.rows('entries')[0].kg, 4.5);
  // 同一批里对同一条新记录先建后改
  const p1 = op('entries', 'put', entry('e9', 'weight', '2026-11-10', { kg: 3 })), p2 = op('entries', 'put', entry('e9', 'weight', '2026-11-10', { kg: 3.1 }));
  sync(env, 'a', 3, [p1, p2, op('entries', 'del', { id: 'e9' }), op('entries', 'undel', { id: 'e9' })]);
  eq(env.rows('entries').filter((r) => r.id === 'e9').map((r) => [r.kg, r.deleted]), [[3.1, '']]);
});
t('缓存坏了也不影响同步', () => {
  const env = boot(); env.cacheBroken = true;
  const o = op('entries', 'put', entry('e1', 'weight', '2026-11-13', { kg: 4 }));
  eq(sync(env, 'a', 1, [o]).ok, true); eq(sync(env, 'a', 1, [o]).ok, true);
  eq(env.rows('entries').length, 1); eq(env.stats.locks, env.stats.unlocks);
});
t('不合格的操作：确认收到但不执行；太多就整批拒绝', () => {
  const env = boot();
  const bad = [{ id: 'o1', table: 'nope', t: 'put', row: { id: 'x' } }, { id: 'o2', table: 'entries', t: 'zap', row: { id: 'x' } },
    { id: 'o3', table: 'entries', t: 'put', row: { id: 'bad id' } }, { id: 'o4', table: 'constructor', t: 'put', row: { id: 'x' } }, { id: 'o5', table: 'entries', t: 'put' }, null];
  const r = sync(env, 'a', 1, bad);
  eq(r.ok, true); eq(r.acked, ['o1', 'o2', 'o3', 'o4', 'o5']); eq(r.rev, 1); eq(env.rows('entries').length, 0);
  const many = []; for (let i = 0; i < 301; i++) many.push(op('entries', 'put', entry('m' + i, 'weight', '2026-01-01', { kg: 4 })));
  eq(sync(env, 'a', 1, many).error, 'bad_request'); eq(env.rows('entries').length, 0);
});
t('成员：名字和颜色只能改自己的', () => {
  const env = boot();
  sync(env, 'a', 1, [op('members', 'put', { id: 'a', name: '阿树', color: '#1baf7a' }), op('members', 'put', { id: 'b', name: '被改了' }), op('members', 'put', { id: 'c', name: '多出来的' }), op('members', 'del', { id: 'b' })]);
  eq(env.rows('members').map((r) => [r.id, r.name, r.color, r.deleted]), [['a', '阿树', '#1baf7a', ''], ['b', '成员 B', '#eb6834', '']]);
});
t('设置：新建和修改', () => {
  const env = boot();
  sync(env, 'b', 1, [op('settings', 'put', { id: 'unit', value: 'lb' }), op('settings', 'put', { id: 'soon_days', value: '21' })]);
  eq(env.rows('settings').map((r) => [r.id, r.value]), [['unit', 'lb'], ['soon_days', '21']]);
  eq(env.rows('settings')[0].note, '体重单位：kg 或 lb');
});
t('上传照片：存进 Drive，记一行，缩略图单独放', () => {
  const env = boot();
  const r = upload(env, 'a', 'm1');
  eq(r.ok, true); eq([r.row.id, r.row.kind, r.row.mime, r.row.size, r.row.w, r.row.h, r.row.created_by, r.row.rev], ['m1', 'img', 'image/jpeg', JPEG.length, 1600, 1200, 'a', 2]);
  const file = env.files.get(r.row.drive_id);
  eq([file.name, file.mime, file.parent.name, Buffer.from(file.bytes.map((b) => (b < 0 ? b + 256 : b))).equals(JPEG)], ['2026-11-13_m1.jpg', 'image/jpeg', '照片', true]);
  eq(env.rows('thumbs'), [{ id: 'm1', thumb: THUMB }]);
  eq('thumb' in env.rows('media')[0], false);
  const s = sync(env, 'b', 1);
  eq(s.changes.media.map((m) => [m.id, m.drive_id === r.row.drive_id, 'thumb' in m]), [['m1', true, false]]);
  // 重发同一个文件：不会多存一份
  const again = upload(env, 'a', 'm1');
  eq([again.dup, again.row.drive_id, env.files.size, env.rows('media').length, env.rows('thumbs').length], [true, r.row.drive_id, 1, 1, 1]);
  eq(env.stats.locks, env.stats.unlocks);
});
t('上传文件：PDF 放进「文件」文件夹，文件名里的怪字符被换掉', () => {
  const env = boot();
  const pdf = Buffer.from('%PDF-1.4 fake');
  const r = upload(env, 'b', 'f1', { kind: 'file', mime: 'application/pdf', name: '../体检/报告:2026?.pdf', data: pdf.toString('base64'), thumb: '', w: '', h: '' });
  eq([r.row.kind, r.row.name, r.row.mime, r.row.size, 'w' in r.row], ['file', '_体检_报告_2026_.pdf', 'application/pdf', pdf.length, false]);
  const file = env.files.get(r.row.drive_id);
  eq([file.parent.name, file.name], ['文件', '2026-11-13__体检_报告_2026_.pdf']);
  eq(env.rows('thumbs').length, 0);
  // 说是图片但类型不是图片 → 当普通文件；不认识的类型 → 通用类型
  eq(upload(env, 'a', 'f2', { kind: 'img', mime: 'application/pdf' }).row.kind, 'file');
  eq(upload(env, 'a', 'f3', { kind: 'file', mime: 'text/html', name: 'x.html' }).row.mime, 'application/octet-stream');
});
t('上传：坏的内容、太大的文件、不合格的缩略图', () => {
  const env = boot();
  eq(upload(env, 'a', 'bad id').error, 'bad_request');
  eq(upload(env, 'a', 'm1', { data: '' }).error, 'bad_request');
  eq(upload(env, 'a', 'm1', { data: '***not base64***' }).error, 'bad_request');
  eq(upload(env, 'a', 'm1', { data: 'A'.repeat(17 * 1024 * 1024) }).error, 'too_large');
  eq(env.files.size, 0); eq(env.rows('media').length, 0);
  upload(env, 'a', 'm2', { thumb: 'data:image/svg+xml;base64,AAAA' });
  upload(env, 'a', 'm3', { thumb: 'data:image/jpeg;base64,' + 'A'.repeat(46000) });
  upload(env, 'a', 'm4', { thumb: 'javascript:alert(1)' });
  eq(env.rows('media').length, 3); eq(env.rows('thumbs').length, 0);
  eq(env.stats.locks, env.stats.unlocks);
});
t('取缩略图：挨着的一次读，隔得远的分开读，不认识的不给', () => {
  const env = boot();
  for (let i = 1; i <= 100; i++) upload(env, 'a', 'm' + i, { thumb: 'data:image/jpeg;base64,' + Buffer.from('thumb-' + i).toString('base64') });
  const r = env.post({ token: env.token('b'), action: 'thumbs', ids: ['m3', 'm5', 'nope', 'bad id', 'm4'] });
  eq(Object.keys(r.thumbs).sort(), ['m3', 'm4', 'm5']);
  eq(Buffer.from(r.thumbs.m5.split(',')[1], 'base64').toString(), 'thumb-5');
  const far = env.post({ token: env.token('b'), action: 'thumbs', ids: ['m1', 'm100'] });
  eq(Buffer.from(far.thumbs.m100.split(',')[1], 'base64').toString(), 'thumb-100'); eq(Object.keys(far.thumbs).length, 2);
  eq(env.post({ token: env.token('b'), action: 'thumbs', ids: [] }).thumbs, {});
  eq(env.post({ token: env.token('b'), action: 'thumbs' }).thumbs, {});
  env.sheet('thumbs').put(3, 2, '<img src=x onerror=alert(1)>');   // 表格里的缩略图被人改成了别的东西
  eq(Object.keys(env.post({ token: env.token('b'), action: 'thumbs', ids: ['m1', 'm2', 'm3'] }).thumbs), ['m1', 'm3']);
});
t('取文件内容；删掉后进 Drive 回收站，恢复后回来', () => {
  const env = boot();
  const up = upload(env, 'a', 'm1');
  const got = env.post({ token: env.token('b'), action: 'media', id: 'm1' });
  eq([got.mime, got.name, Buffer.from(got.data, 'base64').equals(JPEG)], ['image/jpeg', 'IMG_0001.jpg', true]);
  eq(env.post({ token: env.token('b'), action: 'media', id: 'zzz' }).error, 'not_found');
  sync(env, 'b', 2, [op('media', 'put', { id: 'm1', name: '改名.jpg', drive_id: 'x' }), op('media', 'put', { id: 'm9', name: '凭空造的' })]);
  eq(env.rows('media').map((r) => [r.id, r.name, r.drive_id === up.row.drive_id]), [['m1', 'IMG_0001.jpg', true]]);   // 图片记录不能凭操作新增或修改
  sync(env, 'b', 2, [op('media', 'del', { id: 'm1' })]);
  eq(env.files.get(up.row.drive_id).trashed, true);
  sync(env, 'b', 3, [op('media', 'put', { id: 'm1', name: '想靠修改把它弄回来' })]);
  eq(env.rows('media')[0].deleted, true);                         // 删掉的图片记录只能用「恢复」弄回来
  eq(env.post({ token: env.token('a'), action: 'media', id: 'm1' }).error, 'not_found');
  sync(env, 'b', 3, [op('media', 'undel', { id: 'm1' })]);
  eq(env.files.get(up.row.drive_id).trashed, false);
  eq(env.post({ token: env.token('a'), action: 'media', id: 'm1' }).ok, true);
  env.files.delete(up.row.drive_id);                              // 有人在 Drive 里把文件彻底删了
  const gone = env.post({ token: env.token('a'), action: 'media', id: 'm1' });
  eq(gone.error, 'not_found'); eq(/Drive/.test(gone.message), true);
  eq(sync(env, 'a', 4, [op('media', 'del', { id: 'm1' })]).ok, true);   // 这时候再删记录也不出错
});
t('Drive 文件夹被删了：下次上传时重建', () => {
  const env = boot();
  const photos = [...env.folders.values()].find((f) => f.name === '照片');
  photos.trashed = true;
  const r = upload(env, 'a', 'm1');
  eq(r.ok, true); eq(env.files.get(r.row.drive_id).parent.trashed, false); eq(env.files.get(r.row.drive_id).parent.name, '照片');
  env.folders.clear();
  eq(upload(env, 'a', 'm2').ok, true);
});
t('表格正忙：告诉网页稍后重试，不留半截数据', () => {
  const env = boot(); env.lockBusy = true;
  eq(sync(env, 'a', 1, [op('entries', 'put', entry('e1', 'weight', '2026-11-13', { kg: 4 }))]).error, 'busy');
  eq(upload(env, 'a', 'm1').error, 'busy');
  eq(sync(env, 'a', 1).ok, true);                                 // 只读的同步不需要锁
  eq(env.rows('entries').length, 0); eq(env.files.size, 0);
});
t('出错时锁也会放掉', () => {
  const env = boot();
  const sh = env.sheet('entries'); const orig = sh.getRange.bind(sh); let n = 0;
  sh.getRange = function () { if (++n === 3) throw new Error('表格临时出错'); return orig.apply(null, arguments); };
  const r = sync(env, 'a', 1, [op('entries', 'put', entry('e1', 'weight', '2026-11-13', { kg: 4 }))]);
  eq([r.ok, r.error], [false, 'server']); eq(env.stats.locks, env.stats.unlocks);
});
t('旧表格：缺的列和缺的工作表自动补上', () => {
  const env = boot();
  const sh = env.sheet('shots'); sh.rows[0] = sh.rows[0].filter((h) => h !== 'lot' && h !== 'clinic');   // 假装是没有这两列的旧版本
  sh.rows[0].push('自己加的'); sh.formats = []; sh.fmt(5, sh.rows[0].length, 'yyyy-mm-dd');                  // 有人自己加了一列，下面的格子设了日期格式
  env.sheets.splice(env.sheets.findIndex((s) => s.name === 'docs'), 1);
  const s = CL.toWire('shots', CL.clean.shots({ id: 's1', pet_id: 'pet1', name: '猫三联', code: 'fvrcp', date: '2026-01-02', next_due: '2027-01-02', lot: 'A123', clinic: '某某医院' }));
  const d = CL.toWire('docs', CL.clean.docs({ id: 'd1', title: '体检报告', category: 'checkup', date: '2026-01-02', media: ['f1'] }));
  eq(sync(env, 'a', 1, [op('shots', 'put', s), op('docs', 'put', d)]).ok, true);
  eq(sh.rows[0].slice(-3), ['自己加的', 'lot', 'clinic']);
  const at = (h) => sh.format(5, sh.rows[0].indexOf(h) + 1);
  eq([at('自己加的'), at('lot'), at('clinic')], ['yyyy-mm-dd', '@', '@']);            // 只给新补的列设格式，别人加的列不碰
  eq([env.rows('shots')[0].lot, env.rows('shots')[0].clinic, env.rows('shots')[0].next_due], ['A123', '某某医院', '2027-01-02']);
  eq(env.rows('docs')[0].title, '体检报告');
});
t('超过一千行：自动加行，新加的行也是纯文本格式', () => {
  const env = boot();
  let rev = 1;
  for (let k = 0; k < 6; k++) {
    const ops = []; for (let i = 0; i < 200; i++) ops.push(op('entries', 'put', entry('e' + k + '_' + i, 'weight', '2026-11-13', { kg: 4 }, { time: '08:05' })));
    const r = sync(env, 'a', rev, ops); eq(r.ok, true); rev = r.rev;
  }
  const rows = env.rows('entries');
  eq(rows.length, 1200); eq(env.sheet('entries').maxRows >= 1201, true);
  eq(rows.every((r) => r.date === '2026-11-13' && r.time === '08:05' && typeof r.rev === 'number'), true);
  const sh = env.sheet('entries'), at = (h) => sh.format(1150, sh.rows[0].indexOf(h) + 1);
  eq([at('date'), at('time'), at('kg'), at('rev'), at('deleted')], ['@', '@', '0.00#', '0', 'General']);
  eq(sync(env, 'b', 0).changes.entries.length, 1200);
});
t('太长的文字被截断，不会撑破单格上限', () => {
  const env = boot();
  const r = sync(env, 'a', 1, [op('entries', 'put', { id: 'e1', pet_id: 'pet1', kind: 'moment', date: '2026-11-13', data: '{}', note: '长'.repeat(60000), summary: 's'.repeat(999) })]);
  eq(r.ok, true); eq([env.rows('entries')[0].note.length, env.rows('entries')[0].summary.length], [5000, 300]);
});
t('有人直接在表格里改：手机下次同步能看到；手工加的行自动补编号', () => {
  const env = boot();
  sync(env, 'a', 1, [op('entries', 'put', entry('e1', 'weight', '2026-11-13', { kg: 4 }))]);
  const sh = env.sheet('entries'), head = sh.rows[0];
  env.edit('entries', 2, head.indexOf('note') + 1, '在表格里补的备注');
  const r = sync(env, 'b', 2);
  eq(r.changes.entries.map((x) => [x.id, x.note, x.rev]), [['e1', '在表格里补的备注', 3]]);
  env.edit('entries', 3, head.indexOf('note') + 1, '手工加的一行');
  const id = env.rows('entries')[1].id;
  eq(/^[0-9a-f]{16}$/.test(id), true);
  eq(sync(env, 'b', 3).changes.entries.map((x) => x.id), [id]);
  const before = env.props.get('REV');
  env.edit('thumbs', 2, 1, 'x'); env.edit('entries', 1, 1, 'id');                    // 改缩略图表、改表头：不算
  eq(env.props.get('REV'), before);
  env.call('onEdit', {});                                         // 触发器给的参数不对也不出错
  eq(env.stats.locks, env.stats.unlocks);
});
t('手工改过的格子：日期格式、数字、大小写的 TRUE', () => {
  const env = boot();
  sync(env, 'a', 1, [op('entries', 'put', entry('e1', 'weight', '2026-11-13', { kg: 4 })), op('entries', 'put', entry('e2', 'weight', '2026-11-12', { kg: 4 }))]);
  const sh = env.sheet('entries'), head = sh.rows[0], c = (n) => head.indexOf(n);
  sh.rows[1][c('date')] = new Date(2026, 10, 1);                  // 被改成了日期格式的格子
  sh.rows[1][c('time')] = new Date(1899, 11, 30, 9, 5);
  sh.rows[1][c('pet_id')] = 12345;
  sh.rows[2][c('deleted')] = 'true';
  sh.rows[3] = []; sh.rows[4] = ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']; // 空行
  sh.rows[5] = sh.rows[1].slice(); sh.rows[5][c('id')] = '  e3 ';
  const rows = sync(env, 'b', 0).changes.entries;
  eq(rows.map((r) => r.id), ['e1', 'e3']);
  eq([rows[0].date, rows[0].time, rows[0].pet_id], ['2026-11-01', '09:05', '12345']);
});
t('初始化链接：两条链接能被网页认出来；地址不对会说清楚', () => {
  const env = boot();
  const api = 'https://script.google.com/macros/s/' + 'AKfycb' + 'x'.repeat(40) + '/exec';
  const r = env.call('makeLinks', ' ' + api + ' ', 'https://someone.github.io/catlog#old');
  eq(r.a.link.indexOf('https://someone.github.io/catlog/#init='), 0); eq(r.a.name, '成员 A');
  eq(CL.parseInit(r.a.link), { u: api, t: env.token('a'), w: 'a' }); eq(CL.parseInit(r.b.link), { u: api, t: env.token('b'), w: 'b' });
  assert.throws(() => env.call('makeLinks', 'https://script.google.com/macros/s/abc/dev', 'https://x.github.io/catlog/'), /接口地址/);
  assert.throws(() => env.call('makeLinks', api, 'http://x.github.io/catlog/'), /页面地址/);
  assert.throws(() => env.call('makeLinks', api, ''), /页面地址/);
  env.call('showInitLinks');
  eq(env.dialogs.length, 1); eq(env.dialogs[0].html.includes('value="' + api + '"'), true); eq(env.dialogs[0].html.includes(env.token('a')), false);
  env.call('printInitLinks');
  eq(env.logs.some((l) => l.includes(r.a.link) && l.includes(r.b.link)), true);
  const blank = boot(); blank.call('printInitLinks');
  eq(blank.logs.some((l) => /FALLBACK_API_URL/.test(l)), true);
});
t('重置口令：旧链接作废', () => {
  const env = boot(); const old = env.token('a');
  env.call('resetTokens');
  eq(env.token('a') === old, false);
  eq(env.post({ action: 'sync', token: old, since: 0 }).error, 'auth'); eq(sync(env, 'a', 0).ok, true);
});
t('保险：保单和理赔的金额存成数字，空着的还是空着', () => {
  const env = boot();
  const pol = CL.toWire('policies', CL.clean.policies({ id: 'pol1', pet_id: 'pet1', company: '=某某保险', plan: '意外和疾病', policy_no: '00123456', payer: 'both', premium: 38.5, currency: '$',
    limit_amt: 10000, deductible: 250, rate: 80, start: '2026-03-01', renew: '2027-03-01', used0: '', ded0: '', media: ['f1'] }));
  const c1 = CL.toWire('claims', CL.clean.claims({ id: 'c1', pet_id: 'pet1', policy_id: 'pol1', date: '2026-10-04', title: '拉稀就诊', bill: 286, paid: 28.8, ded: 250, status: 'paid' }));
  const c2 = CL.toWire('claims', CL.clean.claims({ id: 'c2', pet_id: 'pet1', policy_id: 'pol1', date: '2026-11-05', title: '牙龈检查', bill: 120, paid: '', ded: '', status: 'sent' }));
  const r = sync(env, 'a', 1, [op('policies', 'put', pol), op('claims', 'put', c1), op('claims', 'put', c2)]);
  eq(r.ok, true);
  const p = env.rows('policies')[0];
  eq([p.company, p.policy_no, p.payer, p.premium, p.currency, p.limit_amt, p.deductible, p.rate, p.start, p.renew, p.used0, p.ded0, p.media, p.created_by],
    ['=某某保险', '00123456', 'both', 38.5, '$', 10000, 250, 80, '2026-03-01', '2027-03-01', '', '', 'f1', 'a']);
  eq(env.rows('claims').map((c) => [c.title, c.bill, c.paid, c.ded, c.status, c.date]), [['拉稀就诊', 286, 28.8, 250, 'paid', '2026-10-04'], ['牙龈检查', 120, '', '', 'sent', '2026-11-05']]);
  const back = sync(env, 'b', 1).changes;
  eq(CL.fromWire('policies', back.policies[0]), Object.assign(CL.clean.policies(pol), { created_by: 'a', created_at: back.policies[0].created_at, updated_by: 'a', updated_at: back.policies[0].updated_at, rev: 2 }));
  eq(CL.fromWire('claims', back.claims[1]).paid, '');
  const T = CL.merge(CL.emptyTables(), back);
  const v = CL.policyView(T, T.policies.pol1, '2026-11-13');
  eq([v.used, v.left, v.dedMet, v.dedLeft, v.pending, v.daysToRenew], [28.8, 9971.2, 250, 0, 1, 108]);
  // 把额度改成不限额（空着）
  sync(env, 'b', 2, [op('policies', 'put', Object.assign({}, pol, { limit_amt: '' }))]);
  eq(env.rows('policies')[0].limit_amt, '');
});
t('显示格式：文字列是纯文本，整数不带小数点，体重两到三位小数，金额两位小数', () => {
  const env = boot();
  const f = (name, cols) => { const sh = env.sheet(name); return cols.map((c) => sh.format(2, sh.rows[0].indexOf(c) + 1)); };
  eq(f('entries', ['id', 'date', 'time', 'summary', 'kg', 'data', 'rev', 'deleted']), ['@', '@', '@', '@', '0.00#', '@', '0', 'General']);
  eq(f('policies', ['company', 'policy_no', 'premium', 'currency', 'limit_amt', 'deductible', 'rate', 'start', 'renew', 'used0', 'ded0', 'rev']), ['@', '@', '0.00', '@', '0.00', '0.00', '0', '@', '@', '0.00', '0.00', '0']);
  eq(f('claims', ['date', 'title', 'bill', 'paid', 'ded', 'status']), ['@', '@', '0.00', '0.00', '0.00', '@']);
  eq([f('media', ['size', 'w', 'h', 'mime']), f('pets', ['sort', 'birthday']), f('settings', ['value'])], [['0', '0', '0', '@'], ['0', '@'], ['@']]);
  // 没有哪个数字列用了「0.###」这种写法：那样整数会显示成「12.」
  env.sheets.forEach((sh) => sh.rows[0].forEach((h, i) => eq(/\.#/.test(sh.format(2, i + 1)), false, sh.name + '.' + h)));
});
t('从 1.0.0 升级：换上新的 Code.gs 以后，旧数据照样在，新的两张表自动建出来', () => {
  const old = createEnv({ code: path.join(__dirname, 'fixtures', 'Code-1.0.0.gs') });
  old.call('setup');
  eq(old.post({ action: 'ping', token: old.token('a') }).v, '1.0.0');
  old.post({ v: 1, token: old.token('a'), action: 'sync', since: 1, ops: [op('entries', 'put', entry('e1', 'weight', '2026-11-13', { kg: 4.2 }))] });
  // 旧后端收到保险的操作：确认收到但不执行（所以网页在后端升级之前不会把它们发出去）
  const lost = old.post({ v: 1, token: old.token('a'), action: 'sync', since: 2, ops: [op('policies', 'put', { id: 'pol1', pet_id: 'pet1', company: 'x' })] });
  eq([lost.ok, lost.acked.length, old.sheet('policies')], [true, 1, null]);
  // 同一张表格，换成新代码（真实环境里就是粘贴新的 Code.gs、发新版本，不用重新 setup）
  const env = createEnv({ code: CODE });
  env.sheets = old.sheets; env.props = old.props; env.folders = old.folders; env.files = old.files;
  env.sheets.forEach((s) => { s.env = env; });
  const r = sync(env, 'a', 0);
  eq([r.v, r.changes.entries.length, r.changes.members.length], [CL.VERSION, 1, 2]);
  eq(env.sheets.map((s) => s.name).filter((n) => n === 'policies' || n === 'claims').sort(), ['claims', 'policies']);
  const ok = sync(env, 'a', r.rev, [op('policies', 'put', { id: 'pol1', pet_id: 'pet1', company: '某某保险', premium: 40 })]);
  eq([ok.ok, env.rows('policies').map((p) => [p.company, p.premium, p.created_by])], [true, [['某某保险', 40, 'a']]]);
  eq(sync(env, 'b', r.rev).changes.policies.length, 1);
  // 再运行一次 setup（可选）：旧表里数字列的显示格式换成新的；内容、口令、别人自己加的列都不动
  const es = env.sheet('entries'), at = (h) => es.format(2, es.rows[0].indexOf(h) + 1), ta = env.token('a');
  es.rows[0].push('自己加的'); es.fmt(2, es.rows[0].length, 'yyyy-mm-dd');
  eq([at('kg'), at('rev'), at('date')], ['0.###', '0.###', '@']);
  env.call('setup');
  eq([at('kg'), at('rev'), at('date'), at('自己加的'), es.format(900, es.rows[0].indexOf('rev') + 1)], ['0.00#', '0', '@', 'yyyy-mm-dd', '0']);
  eq([env.token('a') === ta, env.rows('entries').map((e) => [e.id, e.kg]), env.rows('policies').length, env.rows('members').length], [true, [['e1', 4.2]], 1, 2]);
});
t('菜单', () => {
  const env = boot(); env.call('onOpen');
  eq(env.menus[0].name, 'CatLog'); eq(env.menus[0].items.map((x) => x[1]), ['setup', 'showInitLinks', 'resetTokens']);
});

console.log('\n' + pass + ' 项通过' + (fail ? '，' + fail + ' 项失败' : ''));
process.exit(fail ? 1 : 0);
