/* ---------- 30-demo：演示模式。「后端」就在浏览器里，数据是编的，照片是画出来的 ---------- */
var Demo = (function () {
  var tables = null, rev = 1, userThumbs = new Map(), userData = new Map();

  function call(action, p) {
    return new Promise(function (res, rej) {
      setTimeout(function () {
        try { res(handle(action, p || {})); }
        catch (e) { rej(e instanceof ApiError ? e : new ApiError('server', String(e && e.message || e))); }
      }, ENV.demoDelay == null ? 90 : ENV.demoDelay);
    });
  }
  function handle(action, p) {
    if (!tables) seed();
    if (action === 'sync') return doSync(p);
    if (action === 'upload') return doUpload(p);
    if (action === 'thumbs') return doThumbs(p);
    if (action === 'media') return doMedia(p);
    throw new ApiError('bad_request', '不认识的操作');
  }
  // 重新打开页面时，用本机的快照把「后端」恢复成上次的样子
  function restore(base, r) {
    tables = {};
    CL.TABLES.forEach(function (t) {
      tables[t] = CL.map();
      CL.vals(base[t]).forEach(function (row) { var w = CL.toWire(t, row, 'kg'); w.rev = row.rev || 1; w.updated_by = row.updated_by || ''; w.updated_at = row.updated_at || ''; tables[t][row.id] = w; });
    });
    rev = r || 1;
  }

  function doSync(p) {
    var ops = Array.isArray(p.ops) ? p.ops : [], acked = [], next = rev + 1, touched = false, now = nowIso();
    ops.forEach(function (o) {
      acked.push(o.id);
      var tb = tables[o.table];
      if (!tb || !o.row || !o.row.id) return;
      var id = o.row.id, cur = tb[id];
      if (o.table === 'members' && id !== 'a') return;
      if (o.t === 'put') {
        if (o.table === 'media') return;
        var row = Object.assign({}, cur || { created_by: 'a', created_at: o.row.created_at || now }, o.row);
        if (cur) { row.created_by = cur.created_by; row.created_at = cur.created_at; }
        row.deleted = false; row.rev = next; row.updated_by = 'a'; row.updated_at = now;
        tb[id] = row; touched = true;
      } else if (cur) { cur.deleted = o.t === 'del'; cur.rev = next; cur.updated_by = 'a'; cur.updated_at = now; touched = true; }
    });
    if (touched) rev = next;
    var since = Number(p.since) || 0, full = !!p.full || since === 0 || since > rev;
    if (!full && !ops.length && since === rev) return { ok: true, v: VERSION, me: 'a', rev: rev, unchanged: true };
    var changes = {};
    CL.TABLES.forEach(function (t) {
      var rows = CL.vals(tables[t]).filter(function (r) { return full ? !r.deleted : r.rev > since; });
      if (rows.length) changes[t] = rows.map(function (r) { return Object.assign({}, r); });
    });
    return { ok: true, v: VERSION, me: 'a', rev: rev, reset: full, changes: changes, acked: acked };
  }
  function doUpload(p) {
    var old = tables.media[p.id];
    if (old) return { ok: true, row: Object.assign({}, old), dup: true };
    var data = String(p.data || '');
    if (data.length > MAX_FILE * 1.4) throw new ApiError('too_large', '文件太大，上限 12 MB');
    var now = nowIso();
    rev++;
    var row = { id: p.id, kind: p.kind === 'img' ? 'img' : 'file', name: p.name, mime: p.mime, size: Math.floor(data.length * 3 / 4), w: p.w, h: p.h,
      created_by: 'a', created_at: now, updated_by: 'a', updated_at: now, rev: rev, deleted: false };
    tables.media[p.id] = row;
    if (CL.okThumb(p.thumb)) userThumbs.set(p.id, p.thumb);
    userData.set(p.id, data);
    return { ok: true, row: Object.assign({}, row) };
  }
  function doThumbs(p) {
    var out = {};
    (p.ids || []).forEach(function (id) {
      if (/^dm_/.test(id) || /^dd_/.test(id)) out[id] = paint(id, 240).toDataURL('image/jpeg', 0.7);
      else if (userThumbs.has(id)) out[id] = userThumbs.get(id);
    });
    return { ok: true, thumbs: out };
  }
  function doMedia(p) {
    var id = p.id, row = tables.media[id];
    if (!row || row.deleted) throw new ApiError('not_found', '找不到这个文件');
    if (/^dm_/.test(id) || /^dd_/.test(id)) return { ok: true, id: id, mime: 'image/jpeg', name: row.name, data: paint(id, 900).toDataURL('image/jpeg', 0.85).split(',')[1] };
    if (/^dp_/.test(id)) return { ok: true, id: id, mime: 'application/pdf', name: row.name, data: btoa(pdf(['CatLog demo', 'Annual checkup report (sample file)', 'Weight 4.52 kg   Temp 38.6 C   Heart 168 bpm', 'This PDF is generated in the browser.'])) };
    if (userData.has(id)) return { ok: true, id: id, mime: row.mime, name: row.name, data: userData.get(id) };
    throw new ApiError('not_found', '演示模式里，重新打开页面以后自己加的文件就不在了');
  }

  /* ---- 画出来的示例照片。编号里带着画法：dm_姿势_色相_年龄百分比_序号 ---- */
  function paint(id, short) {
    var parts = id.split('_'), c = document.createElement('canvas');
    if (parts[0] === 'dd') { c.width = Math.round(short * 0.75); c.height = short; paper(c.getContext('2d'), c.width, c.height, parts[1]); return c; }
    c.width = Math.round(short * 4 / 3); c.height = short;
    cat(c.getContext('2d'), c.width, c.height, { pose: parts[1], hue: +parts[2] || 210, age: clamp((+parts[3] || 100) / 100, 0, 1), n: +parts[4] || 0 });
    return c;
  }
  function cat(g, W, H, o) {
    var s = W / 400, k = 0.6 + 0.4 * o.age, fur = '#8d98aa', dark = '#75819a', light = '#d9dee6', pink = '#eaa0b0', amber = '#e3a23a';
    var cx = W * 0.5, base = H * 0.8;
    function ell(x, y, rx, ry, c, rot) { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot || 0, 0, 6.2832); g.fill(); }
    function tri(a, b, c2, d, e, f, c) { g.fillStyle = c; g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.lineTo(e, f); g.closePath(); g.fill(); }
    function curve(pts, w, c) { g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(pts[0], pts[1]); g.bezierCurveTo(pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]); g.stroke(); }
    // 背景：墙、地面、一件小东西
    g.fillStyle = 'hsl(' + o.hue + ',42%,87%)'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'hsl(' + o.hue + ',30%,76%)'; g.fillRect(0, H * 0.7, W, H * 0.3);
    var prop = o.n % 4;
    if (prop === 0) { g.fillStyle = 'hsl(' + o.hue + ',55%,94%)'; g.fillRect(W * 0.08, H * 0.1, W * 0.26, H * 0.38); g.fillStyle = 'hsl(' + o.hue + ',42%,87%)'; g.fillRect(W * 0.205, H * 0.1, W * 0.01, H * 0.38); g.fillRect(W * 0.08, H * 0.285, W * 0.26, H * 0.012); }
    if (prop === 1) { ell(W * 0.85, H * 0.82, 20 * s, 20 * s, 'hsl(' + ((o.hue + 150) % 360) + ',55%,62%)'); curve([W * 0.83, H * 0.79, W * 0.85, H * 0.8, W * 0.87, H * 0.83, W * 0.86, H * 0.86], 2 * s, 'rgba(255,255,255,.7)'); }
    if (prop === 2) { g.fillStyle = 'hsl(' + ((o.hue + 180) % 360) + ',30%,58%)'; g.fillRect(W * 0.8, H * 0.6, W * 0.1, H * 0.12); ell(W * 0.85, H * 0.5, 26 * s, 34 * s, 'hsl(140,32%,52%)'); ell(W * 0.81, H * 0.56, 16 * s, 22 * s, 'hsl(140,32%,46%)', -0.5); }
    if (prop === 3) ell(cx, base + 6 * s, 150 * s * k, 26 * s * k, 'hsl(' + ((o.hue + 40) % 360) + ',40%,66%)');
    ell(cx, base + 6 * s * k, 96 * s * k, 11 * s * k, 'rgba(30,40,60,.16)');
    var hr = (40 + 12 * (1 - o.age)) * s * k;            // 小猫的头相对大一些
    function head(x, y, asleep) {
      tri(x - hr * 0.95, y - hr * 0.35, x - hr * 0.72, y - hr * 1.28, x - hr * 0.12, y - hr * 0.8, fur);
      tri(x + hr * 0.95, y - hr * 0.35, x + hr * 0.72, y - hr * 1.28, x + hr * 0.12, y - hr * 0.8, fur);
      tri(x - hr * 0.78, y - hr * 0.55, x - hr * 0.68, y - hr * 1.05, x - hr * 0.34, y - hr * 0.78, pink);
      tri(x + hr * 0.78, y - hr * 0.55, x + hr * 0.68, y - hr * 1.05, x + hr * 0.34, y - hr * 0.78, pink);
      ell(x, y, hr * 1.1, hr * 0.96, fur);
      ell(x, y + hr * 0.36, hr * 0.56, hr * 0.38, light);
      if (asleep) { curve([x - hr * 0.6, y - hr * 0.02, x - hr * 0.5, y + hr * 0.12, x - hr * 0.3, y + hr * 0.12, x - hr * 0.2, y - hr * 0.02], 2.4 * s * k, '#3a4254'); curve([x + hr * 0.2, y - hr * 0.02, x + hr * 0.3, y + hr * 0.12, x + hr * 0.5, y + hr * 0.12, x + hr * 0.6, y - hr * 0.02], 2.4 * s * k, '#3a4254'); }
      else { [-1, 1].forEach(function (d) { ell(x + d * hr * 0.42, y - hr * 0.05, hr * 0.2, hr * 0.22, amber); ell(x + d * hr * 0.42, y - hr * 0.05, hr * (0.07 + 0.07 * (1 - o.age)), hr * 0.19, '#232836'); ell(x + d * hr * 0.42 - hr * 0.06, y - hr * 0.12, hr * 0.05, hr * 0.05, '#fff'); }); }
      tri(x - hr * 0.09, y + hr * 0.2, x + hr * 0.09, y + hr * 0.2, x, y + hr * 0.31, pink);
      curve([x, y + hr * 0.31, x - hr * 0.02, y + hr * 0.44, x - hr * 0.16, y + hr * 0.46, x - hr * 0.2, y + hr * 0.38], 1.6 * s * k, '#59627a');
      curve([x, y + hr * 0.31, x + hr * 0.02, y + hr * 0.44, x + hr * 0.16, y + hr * 0.46, x + hr * 0.2, y + hr * 0.38], 1.6 * s * k, '#59627a');
      [-1, 1].forEach(function (d) { [0.24, 0.36].forEach(function (yy, i) { curve([x + d * hr * 0.5, y + hr * yy, x + d * hr * 0.8, y + hr * (yy - 0.04 + i * 0.06), x + d * hr * 1.1, y + hr * (yy - 0.06 + i * 0.1), x + d * hr * 1.35, y + hr * (yy - 0.04 + i * 0.16)], 1.1 * s * k, 'rgba(255,255,255,.85)'); }); });
    }
    var u = s * k;
    if (o.pose === 'loaf') {
      curve([cx + 78 * u, base - 22 * u, cx + 120 * u, base - 16 * u, cx + 128 * u, base - 50 * u, cx + 104 * u, base - 58 * u], 15 * u, dark);
      ell(cx + 8 * u, base - 44 * u, 92 * u, 48 * u, fur); ell(cx - 30 * u, base - 14 * u, 26 * u, 11 * u, light); ell(cx + 16 * u, base - 14 * u, 26 * u, 11 * u, light);
      head(cx - 52 * u, base - 88 * u, o.n % 3 === 0);
    } else if (o.pose === 'sleep') {
      ell(cx, base - 40 * u, 100 * u, 46 * u, fur);
      curve([cx + 84 * u, base - 30 * u, cx + 60 * u, base + 6 * u, cx - 20 * u, base + 4 * u, cx - 50 * u, base - 12 * u], 16 * u, dark);
      head(cx - 58 * u, base - 46 * u, true);
    } else if (o.pose === 'stand') {
      curve([cx + 80 * u, base - 80 * u, cx + 120 * u, base - 110 * u, cx + 112 * u, base - 150 * u, cx + 128 * u, base - 168 * u], 13 * u, dark);
      [-58, -30, 40, 68].forEach(function (dx) { g.fillStyle = dx % 4 ? dark : fur; g.beginPath(); g.roundRect ? g.roundRect(cx + dx * u - 9 * u, base - 52 * u, 18 * u, 54 * u, 8 * u) : g.rect(cx + dx * u - 9 * u, base - 52 * u, 18 * u, 54 * u); g.fill(); });
      ell(cx + 6 * u, base - 74 * u, 88 * u, 40 * u, fur); ell(cx - 6 * u, base - 58 * u, 54 * u, 20 * u, light);
      head(cx - 78 * u, base - 112 * u, false);
    } else if (o.pose === 'box') {
      g.fillStyle = '#c69a6a'; g.fillRect(cx - 100 * u, base - 78 * u, 200 * u, 82 * u); g.fillStyle = '#b38655'; g.fillRect(cx - 108 * u, base - 90 * u, 216 * u, 16 * u);
      head(cx, base - 118 * u, false);
      ell(cx - 34 * u, base - 82 * u, 15 * u, 10 * u, light); ell(cx + 34 * u, base - 82 * u, 15 * u, 10 * u, light);
    } else {   // sit
      curve([cx + 48 * u, base - 14 * u, cx + 112 * u, base - 4 * u, cx + 118 * u, base - 60 * u, cx + 92 * u, base - 78 * u], 14 * u, dark);
      ell(cx, base - 62 * u, 60 * u, 66 * u, fur); ell(cx, base - 50 * u, 32 * u, 44 * u, light);
      ell(cx - 22 * u, base - 4 * u, 17 * u, 10 * u, light); ell(cx + 22 * u, base - 4 * u, 17 * u, 10 * u, light);
      head(cx, base - 142 * u, false);
    }
  }
  // 一张示例「纸」：疫苗本、手术记录
  function paper(g, W, H, kind) {
    var s = W / 300;
    g.fillStyle = '#c9ced8'; g.fillRect(0, 0, W, H);
    g.save(); g.translate(W / 2, H / 2); g.rotate(-0.03);
    g.fillStyle = '#fdfdfb'; g.fillRect(-W * 0.42, -H * 0.44, W * 0.84, H * 0.88);
    g.fillStyle = '#2a3140'; g.font = '600 ' + Math.round(17 * s) + 'px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText(kind === 'vax' ? '疫苗接种记录' : '手术记录', 0, -H * 0.36);
    g.font = Math.round(9 * s) + 'px system-ui, sans-serif'; g.fillStyle = '#7b8494'; g.fillText('示例文件 · 不是真实的记录', 0, -H * 0.32);
    g.strokeStyle = '#d5d9e0'; g.lineWidth = 1 * s;
    for (var i = 0; i < 8; i++) { var y = -H * 0.26 + i * H * 0.075; g.beginPath(); g.moveTo(-W * 0.36, y); g.lineTo(W * 0.36, y); g.stroke(); if (kind === 'vax' && i < 5) { g.fillStyle = ['#cfe0f7', '#f9d9cb', '#cdeedd'][i % 3]; g.fillRect(-W * 0.34, y - H * 0.058, W * 0.3, H * 0.046); g.fillStyle = '#9aa3b2'; g.fillRect(-W * 0.0, y - H * 0.04, W * 0.2, H * 0.012); } else { g.fillStyle = '#c4cad4'; g.fillRect(-W * 0.34, y - H * 0.04, W * (0.3 + (i * 37 % 30) / 100), H * 0.012); } }
    g.strokeStyle = 'rgba(196,50,60,.75)'; g.lineWidth = 2.2 * s; g.beginPath(); g.arc(W * 0.22, H * 0.3, 26 * s, 0, 6.2832); g.stroke();
    g.fillStyle = 'rgba(196,50,60,.8)'; g.font = '600 ' + Math.round(10 * s) + 'px system-ui, sans-serif'; g.fillText('示例', W * 0.22, H * 0.3 + 4 * s);
    g.restore();
  }
  // 一个最小的 PDF（只有几行英文），演示「文件」用
  function pdf(lines) {
    var text = 'BT /F1 16 Tf 48 540 Td 22 TL ' + lines.map(function (l) { return '(' + l.replace(/[()\\]/g, '') + ') Tj T*'; }).join(' ') + ' ET';
    var objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>',
      '<</Type/Page/Parent 2 0 R/MediaBox[0 0 420 595]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
      '<</Length ' + text.length + '>>\nstream\n' + text + '\nendstream', '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
    var out = '%PDF-1.4\n', offs = [];
    objs.forEach(function (o, i) { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    var x = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(function (n) { return ('0000000000' + n).slice(-10) + ' 00000 n \n'; }).join('') +
      'trailer\n<</Size ' + (objs.length + 1) + '/Root 1 0 R>>\nstartxref\n' + x + '\n%%EOF\n';
    return out;
  }

  /* ---- 示例数据：一只叫年糕的猫，日期都相对今天算，所以什么时候打开都像刚记过 ---- */
  // 1.1.0 加的示例：一份保单、两笔理赔，剪指甲定的是每月一次。
  // seed() 里用；旧版本留下来的演示数据也用它补一遍（见 topUp）
  function extras(add, today) {
    var day = function (k) { return CL.addDays(today, -k); }, polStart = CL.addMonths(today.slice(0, 8) + '01', -8);
    add('policies', { id: 'pol1', pet_id: 'demo1', company: '示例宠物保险', plan: '意外和疾病', policy_no: 'DEMO-0001', payer: 'a', premium: 38.5, currency: '$', limit_amt: 10000, deductible: 250, rate: 80,
      start: polStart, renew: CL.addMonths(polStart, 12), note: '在保险公司的 App 里拍账单提交，一般两周内到账' }, 'a', polStart);
    add('claims', { id: 'clm1', pet_id: 'demo1', policy_id: 'pol1', date: day(40), title: '拉稀就诊', bill: 286, paid: 28.8, ded: 250, status: 'paid', note: '扣掉自付额以后按 80% 赔' }, 'a', day(38));
    add('claims', { id: 'clm2', pet_id: 'demo1', policy_id: 'pol1', date: day(9), title: '牙龈检查', bill: 120, status: 'sent' }, 'b', day(8));
    add('settings', { id: CL.careKey('demo1', 'nail'), value: '30' });
  }
  // 旧版本留下的演示数据：示例猫还在、还没有保险的话，把上面这些补进去。已经有的行（比如自己定过的间隔）不覆盖
  function topUp() {
    if (!tables || !tables.pets.demo1 || tables.pets.demo1.deleted || CL.vals(tables.policies).length) return false;
    rev++;
    extras(function (t, row, by, date) {
      if (tables[t][row.id]) return;
      row.created_by = by || 'a'; row.created_at = (date || CL.today()) + 'T09:00:00.000Z'; row.updated_by = row.created_by; row.updated_at = row.created_at;
      var c = CL.fromWire(t, row);
      if (!c) return;
      var w = CL.toWire(t, c, 'kg'); w.rev = rev; w.updated_by = row.updated_by; w.updated_at = row.updated_at; w.deleted = false;
      tables[t][c.id] = w;
    }, CL.today());
    return true;
  }
  function seed() {
    var today = CL.today(), seedN = 20261113, n = 0;
    function rnd() { seedN |= 0; seedN = seedN + 0x6D2B79F5 | 0; var t = Math.imul(seedN ^ seedN >>> 15, 1 | seedN); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
    var day = function (k) { return CL.addDays(today, -k); };
    var birth = CL.addDays(CL.addMonths(today, -17), -3), home = CL.addDays(birth, 72), ageNow = CL.diffDays(birth, today);
    var T = CL.emptyTables();
    function add(t, row, by, date) {
      row.created_by = by || (n % 3 ? 'a' : 'b'); row.created_at = (date || row.date || today) + 'T' + ('0' + (8 + n % 12)).slice(-2) + ':' + ('0' + (n * 7 % 60)).slice(-2) + ':00.000Z';
      row.updated_by = row.created_by; row.updated_at = row.created_at; row.rev = 1; n++;
      var c = CL.fromWire(t, row);
      if (c) T[t][c.id] = c;
      return c;
    }
    function media(id, kind, name, mime, date) { add('media', { id: id, kind: kind, name: name, mime: mime, size: kind === 'img' ? 180000 + n * 913 : 2412, w: kind === 'img' ? 1200 : 0, h: kind === 'img' ? 900 : 0 }, 'a', date); return id; }
    function photo(pose, hue, date) { var pct = Math.round(100 * clamp(CL.diffDays(birth, date) / 330, 0.05, 1)); return media('dm_' + pose + '_' + hue + '_' + pct + '_' + n, 'img', 'IMG_' + (2000 + n) + '.jpg', 'image/jpeg', date); }
    function E(kind, date, data, extra) { return add('entries', Object.assign({ id: 'x' + n + kind, pet_id: 'demo1', kind: kind, date: date, time: ('0' + (7 + n % 14)).slice(-2) + ':' + ('0' + (n * 13 % 60)).slice(-2), data: data }, extra || {})); }

    add('members', { id: 'a', name: '阿树', color: '#2a78d6' }); add('members', { id: 'b', name: '小满', color: '#eb6834' });
    add('settings', { id: 'unit', value: 'kg' });

    // 照片和瞬间
    var shots = [
      [home, 'box', 28, '到家第一天，躲在纸箱里不肯出来', '到家第一天', true], [CL.addDays(home, 6), 'sit', 205, '敢出来巡视客厅了'], [CL.addDays(home, 20), 'sleep', 330, '在沙发缝里睡着'],
      [CL.addMonths(birth, 4), 'stand', 150, '自己爬上了猫爬架最高一层', '第一次上猫爬架', true], [CL.addMonths(birth, 5), 'loaf', 45, '揣手手'], [CL.addMonths(birth, 6), 'sit', 265, '半岁，脸开始圆了'],
      [CL.addMonths(birth, 7), 'sleep', 190, '绝育后恢复得不错，睡得很香'], [CL.addMonths(birth, 8), 'box', 12, '快递箱比快递重要'], [CL.addMonths(birth, 9), 'stand', 95, '学会了开抽屉'],
      [CL.addMonths(birth, 10), 'sit', 300, '窗边看鸟'], [CL.addMonths(birth, 11), 'loaf', 170, ''], [CL.addMonths(birth, 12), 'sit', 40, '一岁啦，加了一个罐头', '1 岁生日', true],
      [CL.addMonths(today, -12), 'sleep', 220, '第一次敢在人腿上睡'], [CL.addMonths(birth, 13), 'stand', 20, '巡逻'], [CL.addMonths(birth, 14), 'loaf', 285, '占了我的椅子'],
      [CL.addMonths(birth, 15), 'box', 135, ''], [CL.addMonths(birth, 16), 'sit', 60, '等开饭'], [day(24), 'sleep', 250, '晒太阳'], [day(11), 'stand', 180, '逗猫棒追了十分钟'], [day(2), 'loaf', 345, '今天特别粘人']
    ];
    var firstPhoto = '';
    shots.forEach(function (x) {
      if (x[0] > today || x[0] < home) return;
      var ids = [photo(x[1], x[2], x[0])];
      if (x[5] || x[0] === day(2)) ids.push(photo(x[1] === 'sit' ? 'loaf' : 'sit', (x[2] + 70) % 360, x[0]));
      if (x[0] === day(2)) firstPhoto = ids[0];
      E('moment', x[0], { title: x[4] || '', star: !!x[5] }, { note: x[3], media: ids });
    });

    // 体重：到家后两周一次，半岁以后一个月一次
    var d = home, wPhoto = false;
    while (d <= day(3)) {
      var age = CL.diffDays(birth, d), kg = 4.6 / (1 + Math.exp(-(age - 150) / 55)) + (rnd() - 0.5) * 0.07;
      E('weight', d, { kg: Math.round(kg * 100) / 100 }, age > 500 && !wPhoto ? { note: '体检时称的' } : {});
      if (age > 500) wPhoto = true;
      d = CL.addDays(d, age < 190 ? 14 : 30 + Math.floor(rnd() * 5));
    }
    E('weight', day(3), { kg: Math.round((4.6 / (1 + Math.exp(-(ageNow - 153) / 55)) + 0.03) * 100) / 100 });

    // 日常状态：最近 100 天，大多正常，夹着几段小状况
    for (var k = 100; k >= 1; k--) {
      if (rnd() < 0.07 && k > 8) continue;
      var dd = CL.normalDaily({}), note = '';
      if (rnd() < 0.16) dd.app = 4;
      if (rnd() < 0.2) dd.energy = 3;
      if (rnd() < 0.06) dd.poop = 0;
      if (k === 41) { dd.poop = 2; note = '换粮第二天，便便偏软'; }
      if (k === 40) { dd.poop = 3; dd.app = 2; note = '拉稀两次，去看了医生'; }
      if (k === 39) { dd.poop = 2; }
      if (k === 17) { dd.vomit = 1; note = '吐了一团毛球'; }
      if (k === 6) { dd.app = 2; dd.energy = 1; dd.flags = ['mouth']; note = '吃得少，有点流口水'; }
      if (k === 5) { dd.app = 2; }
      if (k === 4) { dd.flags = ['mouth']; }
      add('entries', { id: CL.dailyId('demo1', day(k)), pet_id: 'demo1', kind: 'daily', date: day(k), time: k % 2 ? '21:10' : '08:20', data: dd, note: note }, k % 2 ? 'a' : 'b');
    }

    // 饮食
    E('food', home, { type: 'dry', name: '幼猫粮（鸡肉）', amount: '每天 55 g', change: true }, { note: '先沿用猫舍的粮' });
    E('food', CL.addMonths(birth, 12), { type: 'dry', name: '成猫粮（鸡肉）', amount: '每天 60 g', change: true }, { note: '七天慢慢换' });
    E('food', day(42), { type: 'dry', name: '成猫粮（三文鱼）', amount: '每天 60 g', change: true }, { note: '想试试鱼味，换得有点急' });
    E('food', day(36), { type: 'dry', name: '成猫粮（鸡肉）', amount: '每天 60 g', change: true }, { note: '软便，换回鸡肉味' });
    [30, 23, 16, 9, 3].forEach(function (x) { E('food', day(x), { type: x % 2 ? 'wet' : 'freeze', name: x % 2 ? '主食罐（鸡肉南瓜）' : '鸡胸肉冻干', amount: x % 2 ? '半罐' : '3 块' }); });

    // 活动和护理
    [52, 45, 38, 31, 25, 18, 11, 4].forEach(function (x, i) { E('activity', day(x), { type: i % 3 === 2 ? 'zoom' : 'wand', mins: 10 + (i * 5) % 20 }); });
    [88, 58, 27].forEach(function (x) { E('activity', day(x), { type: 'nail' }); });
    E('activity', day(61), { type: 'bath' }, { note: '全程骂骂咧咧' });
    E('activity', day(13), { type: 'teeth' });

    // 健康事件
    E('health', CL.addDays(birth, 200), { type: 'surgery', title: '绝育手术', sev: 2, clinic: '示例动物医院', status: 'done' }, { note: '当天接回家，戴了十天头套', media: [media('dd_op_1', 'img', '手术记录.jpg', 'image/jpeg', CL.addDays(birth, 200))] });
    E('health', day(40), { type: 'vet', title: '拉稀', sev: 1, clinic: '示例动物医院', status: 'done' }, { note: '医生说是换粮太快，开了益生菌，三天后好转' });
    E('health', day(9), { type: 'symptom', title: '牙龈有点红', sev: 1, status: 'open', follow: CL.addDays(today, 5) }, { note: '先观察，约了下周复查' });

    // 疫苗和驱虫
    function shot(kind, code, name, date, next, extra) { add('shots', Object.assign({ id: 's' + n, pet_id: 'demo1', kind: kind, code: code, name: name, date: date, next_due: next }, extra || {}), 'a', date); }
    shot('vaccine', 'fvrcp', '猫三联', CL.addDays(birth, 56), CL.addDays(birth, 84), { dose: '第 1 针', note: '猫舍打的' });
    shot('vaccine', 'fvrcp', '猫三联', CL.addDays(birth, 86), CL.addDays(birth, 114), { dose: '第 2 针', clinic: '示例动物医院' });
    shot('vaccine', 'fvrcp', '猫三联', CL.addDays(birth, 115), CL.addDays(birth, 480), { dose: '第 3 针', clinic: '示例动物医院', lot: 'A1234' });
    shot('vaccine', 'fvrcp', '猫三联', CL.addDays(birth, 478), CL.addMonths(CL.addDays(birth, 478), 36), { dose: '加强', clinic: '示例动物医院', lot: 'B5678', media: [media('dd_vax_2', 'img', '疫苗本.jpg', 'image/jpeg', CL.addDays(birth, 478))] });
    shot('vaccine', 'rabies', '狂犬疫苗', CL.addDays(birth, 175), CL.addDays(today, 19), { dose: '首针', clinic: '示例动物医院', lot: 'R0091' });
    for (var m = 6; m >= 1; m--) shot('deworm', 'both', '内外同驱', day(m * 30 + 5), day(m * 30 - 25), { product: '示例滴剂' });

    // 文件
    add('docs', { id: 'doc1', pet_id: 'demo1', title: '疫苗本', category: 'vaccine', date: CL.addDays(birth, 478), media: ['dd_vax_2'] }, 'a');
    add('docs', { id: 'doc2', pet_id: 'demo1', title: '绝育手术记录', category: 'record', date: CL.addDays(birth, 200), media: ['dd_op_1'] }, 'b');
    add('docs', { id: 'doc3', pet_id: 'demo1', title: '年度体检报告', category: 'checkup', date: day(40), note: '血常规、生化都正常', media: [media('dp_report_3', 'file', '体检报告.pdf', 'application/pdf', day(40))] }, 'a');

    extras(add, today);

    add('pets', { id: 'demo1', name: '年糕', species: 'cat', sex: 'f', neutered: 'y', birthday: birth, home_date: home, breed: '英国短毛猫', coat: '蓝色', color: CL.PET_COLORS[0], avatar: firstPhoto, note: '怕吸尘器，喜欢纸箱' }, 'a', home);
    restore(T, 1);
  }

  return { call: call, restore: restore, topUp: topUp, seeded: function () { return !!tables; } };
})();
