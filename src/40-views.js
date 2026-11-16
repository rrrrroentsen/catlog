/* ---------- 40-views：各个页面 ---------- */
var TABS = [['home', '今天', 'home'], ['timeline', '时间轴', 'timeline'], ['growth', '成长', 'growth'], ['records', '档案', 'records']];
var FILTERS = [['all', '全部'], ['photo', '照片'], ['weight', '体重'], ['daily', '日常'], ['alert', '异常'], ['food', '饮食'], ['activity', '活动'], ['health', '健康'], ['shot', '疫苗驱虫']];
var SEGS = [['vaccine', '疫苗'], ['deworm', '驱虫'], ['care', '护理'], ['health', '健康'], ['insure', '保险'], ['docs', '文件']];
var WD1 = ['一', '二', '三', '四', '五', '六', '日'];
var WDS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function needsInit() { return !S.demo && !S.auth; }
function ageLine(p) { return CL.ageLabel(p.birthday, S.today); }
function whoDot(id) { return id ? '<i class="who" style="--mc:' + esc(member(id).color) + '"></i>' : ''; }
function avatar(p, size) {
  var has = p.avatar && S.T.media[p.avatar];
  return '<span class="av ' + (size || '') + '" style="--pc:' + esc(p.color) + '">' + (has ? '<img data-mid="' + esc(p.avatar) + '" alt="">' : ico(p.species === 'cat' ? 'home' : 'paw')) + '</span>';
}

function render() {
  if (!S.ready) return;
  S.today = CL.today();
  var p = pet(), view = $('#view'), bare = needsInit() || !p;
  if (p && S.ui.pet !== p.id) S.ui.pet = p.id;
  document.body.classList.toggle('bare', bare);
  paintHeader(p, bare);
  paintTabs(bare);
  var fn = { home: viewHome, timeline: viewTimeline, growth: viewGrowth, records: viewRecords, prefs: viewPrefs }[S.tab] || viewHome;
  var notice = S.sync.state === 'auth' && !needsInit() ? '<section class="card notice"><b>' + ico('alert') + '口令失效了</b><p>这部手机现在同步不了。让表格的主人重新生成初始化链接，再粘贴进来。这部手机上记的东西不会丢。</p><button type="button" class="btn pri" data-act="reinit">粘贴新的链接</button></section>' : '';
  view.innerHTML = notice + (needsInit() ? viewWelcome() : !p ? (S.tab === 'prefs' ? viewPrefs(null) : viewFirstPet()) : fn(p));
  view.setAttribute('data-tab', S.tab);
  hydrate(document);
  afterRender(p);
}

function paintHeader(p, bare) {
  var el = $('#hdr');
  el.hidden = bare && S.tab !== 'prefs';
  if (el.hidden) { el.innerHTML = ''; return; }
  var left = S.tab === 'prefs' ? '<button type="button" class="iconbtn" data-act="go" data-tab="home" aria-label="返回">' + ico('chevL') + '</button><b class="hdr-title">设置</b>'
    : S.tab === 'home' || !p ? '<span class="brand">CatLog</span>'
      : '<button type="button" class="petchip" data-act="pet-menu" aria-label="猫咪：' + esc(p.name) + '">' + avatar(p, 'sm') + '<span class="petchip-t"><b>' + esc(p.name) + '</b><small>' + esc(ageLine(p)) + '</small></span>' + (pets().length > 1 ? ico('chevD', 'sm') : '') + '</button>';
  el.innerHTML = left + '<span class="grow"></span><button type="button" class="syncpill" id="syncpill" data-act="go" data-tab="prefs"></button>' +
    (S.tab === 'prefs' ? '' : '<button type="button" class="iconbtn" data-act="go" data-tab="prefs" aria-label="设置">' + ico('prefs') + '</button>');
  paintSync();
}
function paintSync() {
  var el = $('#syncpill');
  if (!el) return;
  var st = S.sync.state, n = waiting(), cls = 'ok', text = '已同步', icon = 'check';
  if (S.demo) { cls = 'demo'; text = '演示数据'; icon = 'info'; }
  else if (st === 'auth') { cls = 'bad'; text = '需要重新初始化'; icon = 'alert'; }
  else if (st === 'offline') { cls = 'warn'; text = n ? '离线 · ' + n + ' 条待传' : '离线'; icon = 'cloudOff'; }
  else if (st === 'err') { cls = 'warn'; text = n ? '稍后重试 · ' + n + ' 条待传' : '稍后重试'; icon = 'alert'; }
  else if (S.sync.busy && (n || st !== 'ok')) { cls = 'busy'; text = n ? '同步中 · ' + n : '同步中'; icon = 'sync'; }
  else if (n && n === held()) { cls = 'warn'; text = n + ' 条等后端更新'; icon = 'alert'; }
  else if (n) { cls = 'busy'; text = n + ' 条待传'; icon = 'sync'; }
  el.className = 'syncpill ' + cls;
  el.innerHTML = ico(icon, 'sm') + '<span>' + text + '</span>';
  el.setAttribute('aria-label', '同步状态：' + text);
  var line = $('#sync-line');
  if (line) line.textContent = syncLine();
}
function paintTabs(bare) {
  var el = $('#tabs');
  el.hidden = bare;
  if (bare) { el.innerHTML = ''; return; }
  function tab(t) { return '<button type="button" class="tab' + (S.tab === t[0] ? ' on' : '') + '" data-act="go" data-tab="' + t[0] + '"' + (S.tab === t[0] ? ' aria-current="page"' : '') + '>' + ico(t[2]) + '<span>' + t[1] + '</span></button>'; }
  el.innerHTML = tab(TABS[0]) + tab(TABS[1]) + '<button type="button" class="fab" data-act="add-menu" aria-label="添加记录">' + ico('plus') + '</button>' + tab(TABS[2]) + tab(TABS[3]);
}

/* ---- 小零件 ---- */
function dailyChips(d, onlyIssues) {
  var out = [];
  CL.DAILY.forEach(function (f) {
    if (d[f.k] == null) return;
    var o = CL.dailyOpt(f.k, d[f.k]);
    if (!o || (onlyIssues && o.s < 2)) return;
    out.push('<span class="st s' + o.s + '">' + (o.s > 1 ? ico('alert', 'xs') : '') + esc(f.label) + ' <b>' + esc(o.l) + '</b></span>');
  });
  (d.flags || []).forEach(function (k) { out.push('<span class="st s2">' + ico('alert', 'xs') + '<b>' + esc(CL.label(CL.FLAGS, k)) + '</b></span>'); });
  return out.length ? '<div class="sts">' + out.join('') + '</div>' : '';
}
function photoGrid(row, max) {
  var imgs = CL.images(S.T, row);
  if (!imgs.length) return '';
  var show = imgs.slice(0, max || 4), more = imgs.length - show.length;
  return '<div class="ph-grid n' + show.length + '">' + show.map(function (id, i) {
    return '<button type="button" class="ph" data-act="view" data-ids="' + esc(imgs.join(',')) + '" data-i="' + i + '" aria-label="看大图"><img data-mid="' + esc(id) + '" alt="" loading="lazy">' +
      (S.pend[id] ? '<i class="ph-tag">待上传</i>' : '') + (more > 0 && i === show.length - 1 ? '<i class="ph-more">+' + more + '</i>' : '') + '</button>';
  }).join('') + '</div>';
}
function fileChips(row) {
  var fs = CL.files(S.T, row);
  if (!fs.length) return '';
  return '<div class="files">' + fs.map(function (id) {
    var m = S.T.media[id];
    return '<button type="button" class="filechip" data-act="file" data-id="' + esc(id) + '">' + ico('doc', 'sm') + '<span>' + esc(m.name || '文件') + '</span><small>' + fmtBytes(m.size) + (S.pend[id] ? ' · 待上传' : '') + '</small></button>';
  }).join('') + '</div>';
}
function sevPill(n) { return n ? '<span class="pill sev' + n + '">' + ['', '轻', '中', '重'][n] + '</span>' : ''; }
function weightDeltas(ws) { var m = CL.map(); for (var i = 1; i < ws.length; i++) m[ws[i].id] = ws[i].kg - ws[i - 1].kg; return m; }

// 时间轴上的一条
function tlItem(it, ctx) {
  if (it.t === 'mark') return '<div class="tl-mark ' + it.kind + '">' + ico(it.kind === 'birthday' ? 'cake' : 'house', 'sm') + '<span>' + esc(it.text) + '</span></div>';
  var r = it.row, kind = it.kind, title = '', sub = [], extra = '', u = unit(), d = r.data || {};
  if (it.t === 'shot') {
    title = esc(r.name) + (r.dose ? ' <small>' + esc(r.dose) + '</small>' : '');
    if (r.next_due) sub.push('下次 ' + CL.fmtDate(r.next_due, 'num'));
    if (r.product) sub.push(r.product);
    if (r.clinic) sub.push(r.clinic);
  } else if (kind === 'weight') {
    var dl = ctx && ctx.deltas[r.id];
    title = '<span class="num">' + CL.fmtWeight(d.kg, u) + '</span> ' + u + (dl != null ? ' <small class="delta">' + esc(CL.fmtDelta(dl, u)) + '</small>' : '');
  } else if (kind === 'daily') {
    var all = CL.dailyAllNormal(d);
    title = all ? '一切正常' : CL.dailyLevel(d) > 1 ? '有点状况' : '日常状态';
    if (!all) extra = dailyChips(d, CL.dailyLevel(d) > 1);
  } else if (kind === 'food') {
    title = esc(CL.label(CL.FOOD, d.type)) + (d.name ? ' · ' + esc(d.name) : '');
    if (d.amount) sub.push(d.amount);
    if (d.change) extra = '<div class="pills"><span class="pill tag">换粮</span></div>';
  } else if (kind === 'activity') {
    title = esc(CL.label(CL.ACT, d.type));
    if (d.mins) sub.push(d.mins + ' 分钟');
  } else if (kind === 'health') {
    title = esc(d.title || CL.label(CL.HEALTH, d.type));
    extra = '<div class="pills">' + (d.title ? '<span class="pill">' + esc(CL.label(CL.HEALTH, d.type)) + '</span>' : '') + sevPill(d.sev) +
      '<span class="pill ' + (d.status === 'open' ? 'warn' : 'ok') + '">' + (d.status === 'open' ? '进行中' : '已好转') + '</span></div>';
    if (d.clinic) sub.push(d.clinic);
    if (d.status === 'open' && d.follow) sub.push('复查 ' + CL.fmtDate(d.follow, 'num'));
  } else if (kind === 'moment') {
    title = (d.star ? ico('star', 'sm star') : '') + esc(d.title || '');
  }
  var by = r.created_by ? whoDot(r.created_by) + esc(whoName(r.created_by)) : '';
  return '<article class="tl-item" role="button" tabindex="0" data-act="open" data-t="' + it.t + '" data-id="' + esc(r.id) + '">' + kico(kind) + '<div class="tl-b">' +
    '<div class="tl-h">' + (title ? '<b class="tl-t">' + title + '</b>' : '<b class="tl-t dim">' + esc(KIND[kind].name) + '</b>') + '<span class="tl-meta">' + (r.time ? esc(r.time) + ' ' : '') + by + '</span></div>' +
    (sub.length ? '<p class="tl-sub">' + esc(sub.join(' · ')) + '</p>' : '') + extra +
    (r.note ? '<p class="tl-note">' + esc(r.note) + '</p>' : '') + photoGrid(r, 4) + fileChips(r) + '</div></article>';
}
function emptyBox(icon, title, text, btn) {
  return '<div class="empty">' + ico(icon, 'big') + '<b>' + esc(title) + '</b><p>' + esc(text) + '</p>' + (btn || '') + '</div>';
}

/* ---- 今天 ---- */
function viewHome(p) {
  var T = S.T, today = S.today, u = unit(), ws = CL.weights(T, p.id), st = CL.weightStats(ws), cnt = CL.counts(T, p, today), streak = CL.streak(T, p.id, today), h = '';
  var facts = [];
  if (p.breed) facts.push(esc(p.breed));
  if (cnt.home) facts.push('到家第 ' + cnt.home + ' 天');
  if (streak > 1) facts.push('连续记了 ' + streak + ' 天');
  h += '<section class="card hero"><button type="button" class="hero-av" data-act="pet-menu" aria-label="猫咪资料">' + avatar(p, 'lg') + '</button><div class="hero-main"><h1>' + esc(p.name) +
    (p.sex ? '<span class="sex">' + (p.sex === 'f' ? '妹妹' : '弟弟') + '</span>' : '') + '</h1><p class="hero-age">' + esc(ageLine(p) || '还没填生日') + '</p>' +
    (facts.length ? '<p class="hero-facts">' + facts.map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</p>' : '') + '</div>' +
    '<button type="button" class="hero-w" data-act="add" data-kind="weight" aria-label="记体重">' + (st ? '<small>体重</small><b class="num">' + CL.fmtWeight(st.last.kg, u) + '</b><i>' + u + (st.delta != null ? ' <em>' + esc(CL.fmtDelta(st.delta, u)) + '</em>' : '') + '</i>'
      : ico('weight') + '<i>记体重</i>') + '</button></section>';

  var rem = CL.reminders(T, p, today);
  if (rem.length) h += '<section class="card rem"><h2 class="card-t">提醒</h2>' + rem.map(function (r) {
    return '<button type="button" class="rem-row lv' + r.level + '" data-act="rem" data-go="' + esc(r.go) + '" data-kind="' + esc(r.kind || '') + '" data-id="' + esc(r.id || '') + '" data-type="' + esc(r.type || '') + '">' +
      ico(r.level === 3 ? 'alert' : r.go === 'care' ? 'activity' : r.go === 'insure' ? 'insure' : r.level === 2 ? 'calendar' : r.go === 'weight' ? 'weight' : 'cake') + '<span class="rem-t"><b>' + esc(r.text) + '</b><small>' + esc(r.sub) + '</small></span>' + (r.go ? ico('chevR', 'sm') : '') + '</button>';
  }).join('') + '</section>';

  var de = T.entries[CL.dailyId(p.id, today)], lv = de ? CL.dailyLevel(de.data) : 0;
  h += '<section class="card today"><div class="card-h"><h2 class="card-t">今天的状态</h2><span class="card-sub">' + CL.fmtDate(today) + ' ' + WDS[CL.weekday(today)] + '</span></div>';
  if (!lv) h += '<p class="today-q">' + esc(p.name) + '今天怎么样？</p><div class="btns"><button type="button" class="btn pri" data-act="day-ok">' + ico('check') + '一切正常</button><button type="button" class="btn" data-act="day" data-date="' + today + '">逐项记录</button></div>';
  else h += (CL.dailyAllNormal(de.data) ? '<p class="today-ok">' + ico('check') + '一切正常</p>' : dailyChips(de.data)) + (de.note ? '<p class="tl-note">' + esc(de.note) + '</p>' : '') +
    '<div class="today-foot"><span class="tl-meta">' + whoDot(de.updated_by || de.created_by) + esc(whoName(de.updated_by || de.created_by)) + (de.time ? ' ' + esc(de.time) : '') + '</span><button type="button" class="btn sm" data-act="day" data-date="' + today + '">修改</button></div>';
  h += '</section>';

  h += '<section class="quick" aria-label="快速添加">' + [['weight', '体重'], ['moment', '照片'], ['food', '饮食'], ['activity', '活动']].map(function (q) {
    return '<button type="button" class="qbtn" data-act="add" data-kind="' + q[0] + '">' + kico(q[0]) + '<span>' + q[1] + '</span></button>';
  }).join('') + '</section>';

  // 护理：剪指甲和刷牙总是在；别的几种记过或者定了间隔才出现
  var care = CL.careBoard(T, p, today).filter(function (c) { return c.last || c.every != null || CL.CARE_HOME.indexOf(c.type) >= 0; });
  if (care.length) h += '<section class="card caremini"><div class="card-h"><h2 class="card-t">护理</h2><button type="button" class="link" data-act="go-seg" data-seg="care">全部' + ico('chevR', 'xs') + '</button></div><div class="carechips">' + care.map(function (c) {
    return '<button type="button" class="carechip' + (c.state === 'due' ? ' due' : '') + '" data-act="care" data-type="' + c.type + '"><b>' + esc(c.label) + '</b><span>' + (c.state === 'due' ? ico('alert', 'xs') : '') + esc(c.last ? CL.daysAgo(c.days) : '还没记过') + '</span></button>';
  }).join('') + '</div></section>';

  var mem = CL.memory(T, p.id, today);
  if (mem) {
    var mi = CL.images(T, mem.entry)[0], wn = CL.weightNear(ws, mem.entry.date, 30), mt = mem.entry.kind === 'moment' ? (mem.entry.data.title || mem.entry.note) : '';
    h += '<section class="card memory" role="button" tabindex="0" data-act="open" data-t="entry" data-id="' + esc(mem.entry.id) + '"><div class="memory-ph"><img data-mid="' + esc(mi) + '" data-full alt=""></div><div class="memory-t"><small>' + esc(mem.label) + '</small>' +
      (mt ? '<b>' + esc(mt) + '</b>' : '') + '<span>' + esc([CL.fmtDate(mem.entry.date, 'ymd'), ageAt(p, mem.entry.date) ? '那时 ' + ageAt(p, mem.entry.date) : '', wn ? CL.fmtWeight(wn.kg, u) + ' ' + u : ''].filter(Boolean).join(' · ')) + '</span></div></section>';
  }

  // 最近的记录里不放「一切正常」的日常（它们在上面的卡片和日历里），只放有状况的
  var recent = CL.timeline(T, p.id, 'all').filter(function (x) { return x.kind !== 'daily' || (x.date !== today && CL.dailyLevel(x.row.data) > 1); }).slice(0, 5), ctx = { deltas: weightDeltas(ws) };
  if (recent.length) h += '<section class="card"><div class="card-h"><h2 class="card-t">最近的记录</h2><button type="button" class="link" data-act="go" data-tab="timeline">时间轴' + ico('chevR', 'xs') + '</button></div><div class="tl-list">' +
    recent.map(function (it) { return '<div class="tl-row"><span class="tl-when">' + esc(CL.relDay(it.date, today)) + '</span>' + tlItem(it, ctx) + '</div>'; }).join('') + '</div></section>';
  else h += '<section class="card">' + emptyBox('paw', '从第一条记录开始', '称一次体重、拍一张照片，或者记一下今天的状态。时间久了，这里就是' + p.name + '的成长记录。') + '</section>';
  return h;
}
function ageAt(p, date) { return CL.ageLabel(p.birthday, date); }

/* ---- 时间轴 ---- */
function viewTimeline(p) {
  var T = S.T, f = S.ui.filter, items = CL.timeline(T, p.id, f), ctx = { deltas: weightDeltas(CL.weights(T, p.id)) };
  var h = '<div class="chips scroll" role="tablist" aria-label="筛选">' + FILTERS.map(function (x) {
    return '<button type="button" role="tab" class="chip' + (f === x[0] ? ' on' : '') + '" aria-selected="' + (f === x[0]) + '" data-act="filter" data-v="' + x[0] + '">' + x[1] + '</button>';
  }).join('') + '</div>';
  if (!items.length) return h + '<section class="card">' + emptyBox('timeline', f === 'all' ? '时间轴还是空的' : '这一类还没有记录', f === 'all' ? '点下面的加号，记下第一条。' : '换一个筛选看看，或者点下面的加号添加。') + '</section>';
  if (f === 'all') {
    var from = items[items.length - 1].date;
    [p.birthday, p.home_date].forEach(function (d) { if (CL.isYmd(d) && d < from) from = d; });
    items = CL.sortDesc(items.concat(CL.marks(p, from, S.today)));
  }
  var total = items.length, shown = items.slice(0, S.ui.tlLimit);
  CL.groupByMonth(shown).forEach(function (g) {
    var end = CL.addDays(CL.addMonths(g.ym + '-01', 1), -1), age = ageAt(p, end > S.today ? S.today : end);
    h += '<section class="tl-month"><h2 class="tl-mh"><span>' + esc(CL.fmtDate(g.ym + '-01', 'ym')) + '</span>' + (age ? '<small>' + esc(age) + '</small>' : '') + '</h2>' +
      g.days.map(function (d) {
        return '<div class="tl-day"><div class="tl-date"><b class="num">' + (+d.date.slice(8)) + '</b><span>' + WDS[CL.weekday(d.date)] + '</span></div><div class="tl-items">' + d.items.map(function (it) { return tlItem(it, ctx); }).join('') + '</div></div>';
      }).join('') + '</section>';
  });
  if (total > shown.length) h += '<button type="button" class="btn wide" data-act="tl-more">更早的记录（还有 ' + (total - shown.length) + ' 条）</button>';
  return h;
}

/* ---- 成长 ---- */
function rangeFrom() { return S.ui.range === '3m' ? CL.addMonths(S.today, -3) : S.ui.range === '1y' ? CL.addMonths(S.today, -12) : ''; }
function viewGrowth(p) {
  var T = S.T, today = S.today, u = unit(), all = CL.weights(T, p.id), from = rangeFrom(), ws = from ? all.filter(function (w) { return w.date >= from; }) : all, st = CL.weightStats(all), h = '';
  h += '<section class="card wcard"><div class="card-h"><h2 class="card-t">体重</h2><div class="seg" role="tablist" aria-label="时间范围">' + [['3m', '3 个月'], ['1y', '1 年'], ['all', '全部']].map(function (x) {
    return '<button type="button" role="tab" aria-selected="' + (S.ui.range === x[0]) + '" class="' + (S.ui.range === x[0] ? 'on' : '') + '" data-act="range" data-v="' + x[0] + '">' + x[1] + '</button>';
  }).join('') + '</div></div>';
  if (!st) h += emptyBox('weight', '还没有体重记录', '定期称一称，这里会画出从小到大的曲线。', '<button type="button" class="btn pri" data-act="add" data-kind="weight">记一次体重</button>');
  else {
    h += '<div class="wnow"><b class="num">' + CL.fmtWeight(st.last.kg, u) + '</b><i>' + u + '</i><span class="wnow-s">' + esc(CL.relDay(st.last.date, today)) +
      (st.delta != null ? ' · 比上次 ' + esc(CL.fmtDelta(st.delta, u)) : '') + (st.refDelta != null ? ' · 比 ' + CL.diffDays(st.ref.date, st.last.date) + ' 天前 ' + esc(CL.fmtDelta(st.refDelta, u)) : '') + '</span></div>';
    h += ws.length ? '<div class="chart" id="wchart" aria-label="体重曲线"></div>' : '<p class="hint">这段时间里没有体重记录。</p>';
    h += '<div class="wstats"><span>最轻 <b class="num">' + CL.fmtWeight(st.min.kg, u) + '</b></span><span>最重 <b class="num">' + CL.fmtWeight(st.max.kg, u) + '</b></span><span>共 <b class="num">' + st.n + '</b> 次</span>' +
      '<button type="button" class="link" data-act="wlist" aria-expanded="' + !!S.ui.listW + '">' + (S.ui.listW ? '收起列表' : '看列表') + '</button></div>';
    if (S.ui.listW) {
      var dl = weightDeltas(all);
      h += '<table class="wtable"><thead><tr><th>日期</th><th>年龄</th><th class="r">体重（' + u + '）</th><th class="r">变化</th></tr></thead><tbody>' + all.slice().reverse().map(function (w) {
        return '<tr role="button" tabindex="0" data-act="open" data-t="entry" data-id="' + esc(w.id) + '"><td>' + esc(CL.fmtDate(w.date, 'num')) + '</td><td>' + esc(ageAt(p, w.date)) + '</td><td class="r num">' + CL.fmtWeight(w.kg, u) + '</td><td class="r num">' + (dl[w.id] != null ? esc(CL.fmtDelta(dl[w.id], u)) : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
  }
  h += '</section>';

  // 状态日历
  var ym = S.ui.calYm || today.slice(0, 7), g = CL.monthGrid(T, p.id, ym, today), rc = CL.recent(T, p.id, today, 30);
  h += '<section class="card cal"><div class="card-h"><h2 class="card-t">状态日历</h2><div class="cal-nav"><button type="button" class="iconbtn sm" data-act="cal" data-d="-1" aria-label="上个月">' + ico('chevL', 'sm') + '</button><b>' + esc(g.label) + '</b>' +
    '<button type="button" class="iconbtn sm" data-act="cal" data-d="1" aria-label="下个月"' + (ym >= today.slice(0, 7) ? ' disabled' : '') + '>' + ico('chevR', 'sm') + '</button></div></div>' +
    '<div class="cal-wd" aria-hidden="true">' + WD1.map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div><div class="cal-grid">' + g.cells.map(function (c) {
      if (!c) return '<span class="cal-x"></span>';
      var say = ['没记', '正常', '留意', '异常'][c.level];
      return '<button type="button" class="cal-c lv' + c.level + (c.today ? ' today' : '') + '"' + (c.future ? ' disabled' : '') + ' data-act="day" data-date="' + c.date + '" aria-label="' + esc(CL.fmtDate(c.date) + '：' + say) + '"><b>' + c.day + '</b>' +
        '<i class="cal-mk">' + (c.level === 3 ? '!!' : c.level === 2 ? '!' : c.level === 1 ? ico('check', 'xs') : '') + '</i>' +
        '<i class="cal-dots">' + (c.weight ? '<u class="k1"></u>' : '') + (c.health ? '<u class="k8"></u>' : '') + '</i></button>';
    }).join('') + '</div><div class="cal-legend"><span class="lgd lv1">' + ico('check', 'xs') + '正常</span><span class="lgd lv2">! 留意</span><span class="lgd lv3">!! 异常</span><span class="lgd dots"><u class="k1"></u>称了体重<u class="k8"></u>有健康事件</span></div>' +
    '<div class="tiles"><div class="tile"><b class="num">' + rc.logged + '</b><span>近 30 天记了几天</span></div><div class="tile"><b class="num">' + rc.warn + '</b><span>留意的天数</span></div><div class="tile"><b class="num">' + rc.bad + '</b><span>异常的天数</span></div><div class="tile"><b class="num">' + rc.vomit + '</b><span>呕吐次数</span></div></div></section>';

  // 相册和对比
  var al = CL.album(T, p), fl = CL.firstLast(T, p);
  if (fl) {
    var wa = CL.weightNear(all, fl.first.date, 30), wb = CL.weightNear(all, fl.last.date, 30);
    h += '<section class="card"><h2 class="card-t">从小到大</h2><div class="vs">' + [[fl.first, wa], [fl.last, wb]].map(function (x) {
      return '<button type="button" class="vs-i" data-act="view" data-ids="' + esc(x[0].mid) + '" data-i="0"><img data-mid="' + esc(x[0].mid) + '" data-full alt=""><span><b>' + esc(ageAt(p, x[0].date) || CL.fmtDate(x[0].date, 'ym')) + '</b>' +
        esc(CL.fmtDate(x[0].date, 'num')) + (x[1] ? ' · ' + CL.fmtWeight(x[1].kg, u) + ' ' + u : '') + '</span></button>';
    }).join('') + '</div></section>';
  }
  h += '<section class="card"><div class="card-h"><h2 class="card-t">' + (CL.isYmd(p.birthday) ? '月龄相册' : '相册') + '</h2><span class="card-sub">' + CL.counts(T, p, today).photos + ' 张</span></div>';
  if (!al.length) h += emptyBox('image', '还没有照片', '每个月拍一张，这里会排成一面从小到大的照片墙。', '<button type="button" class="btn pri" data-act="add" data-kind="moment">添加照片</button>');
  else h += '<div class="alb-grid">' + al.map(function (a) {
    return '<button type="button" class="alb" data-act="view" data-ids="' + esc(a.items.map(function (x) { return x.mid; }).join(',')) + '" data-i="' + Math.max(0, a.items.map(function (x) { return x.mid; }).indexOf(a.cover)) + '"><img data-mid="' + esc(a.cover) + '" alt="" loading="lazy"><span class="alb-l">' + (a.star ? ico('star', 'xs star') : '') + esc(a.label) + '</span>' + (a.items.length > 1 ? '<i class="alb-n">' + a.items.length + '</i>' : '') + '</button>';
  }).join('') + '</div>';
  return h + '</section>';
}

/* ---- 档案 ---- */
function stampSvg(state) {
  var t = { ok: '有效', soon: '快到期', over: '已过期', done: '已做', none: '未记录' }[state];
  return '<svg class="stamp st-' + state + '" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" class="o"/><circle cx="32" cy="32" r="23.5" class="in"/><text x="32" y="' + (t.length > 2 ? 36 : 38) + '" text-anchor="middle" style="font-size:' + (t.length > 2 ? 12 : 16) + 'px">' + t + '</text></svg>';
}
function shotRowHtml(s) {
  return '<button type="button" class="row" data-act="open" data-t="shot" data-id="' + esc(s.id) + '">' + kico(s.kind, 'sm') + '<span class="row-t"><b>' + esc(s.name) + (s.dose ? ' <small>' + esc(s.dose) + '</small>' : '') + '</b><small>' +
    esc([CL.fmtDate(s.date, 'num'), s.product, s.clinic, s.next_due ? '下次 ' + CL.fmtDate(s.next_due, 'num') : ''].filter(Boolean).join(' · ')) + '</small></span>' + (CL.images(S.T, s).length || CL.files(S.T, s).length ? ico('clip', 'sm dim') : '') + ico('chevR', 'sm dim') + '</button>';
}
function viewRecords(p) {
  var T = S.T, today = S.today, seg = S.ui.seg, h = '<div class="seg big" role="tablist" aria-label="档案">' + SEGS.map(function (x) {
    return '<button type="button" role="tab" aria-selected="' + (seg === x[0]) + '" class="' + (seg === x[0] ? 'on' : '') + '" data-act="seg" data-v="' + x[0] + '">' + x[1] + '</button>';
  }).join('') + '</div>';
  if (seg === 'vaccine' || seg === 'deworm') {
    var board = CL.shotBoard(T, p, seg, today), name = seg === 'vaccine' ? '疫苗' : '驱虫';
    var list = CL.vals(T.shots).filter(function (s) { return s.pet_id === p.id && s.kind === seg; }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.created_at < b.created_at ? 1 : -1); });
    h += '<section class="card board">';
    if (!board.length) h += emptyBox(seg, '还没有' + name + '记录', '记下每次的日期和下次的日子，快到期时首页会提醒。');
    else h += board.map(function (r) {
      var line1 = r.last ? '上次 ' + CL.fmtDate(r.last.date, 'num') + (r.last.dose ? ' · ' + r.last.dose : '') : '还没有记录';
      var line2 = r.state === 'none' ? '打过的话，补记一针' : r.state === 'done' ? '没有填下次的日期' : '下次 ' + CL.fmtDate(r.next, 'num') + ' · ' + CL.dueText(r.days);
      var pct = r.last && r.next ? clamp(Math.round(100 * CL.diffDays(r.last.date, today) / Math.max(1, CL.diffDays(r.last.date, r.next))), 0, 100) : 0;
      return '<button type="button" class="shot st-' + r.state + '" data-act="shot-key" data-kind="' + seg + '" data-key="' + esc(r.key) + '"><span class="shot-main"><b>' + esc(r.name) + (r.en ? ' <small>' + esc(r.en) + '</small>' : '') + '</b><span class="shot-l">' + esc(line1) + '</span><span class="shot-l next">' + esc(line2) + '</span>' +
        (r.last && r.next ? '<span class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span>' : '') + '</span>' + stampSvg(r.state) + '</button>';
    }).join('');
    h += '<button type="button" class="btn pri wide" data-act="add" data-kind="' + seg + '">' + ico('plus') + (seg === 'vaccine' ? '记一针疫苗' : '记一次驱虫') + '</button><p class="hint">下次的日期以医生给的为准，这里只帮你记着。</p></section>';
    if (list.length) h += '<section class="card"><div class="card-h"><h2 class="card-t">全部' + name + '记录</h2><span class="card-sub">' + list.length + ' 条</span></div><div class="rows">' + list.map(shotRowHtml).join('') + '</div></section>';
  } else if (seg === 'care') {
    h += '<section class="card board"><div class="card-h"><h2 class="card-t">护理</h2><span class="card-sub">上次是什么时候</span></div>' + CL.careBoard(T, p, today).map(careRow).join('') +
      '<p class="hint">点「做了」记成今天。点名字可以看以前的、补记，或者定一个「多久做一次」，到时间首页会提醒。</p></section>';
  } else if (seg === 'insure') {
    var pols = CL.policiesOf(T, p.id);
    if (!S.demo && S.backend && !CL.verGte(S.backend, CL.TABLE_SINCE.policies)) h += '<section class="card notice warn"><b>' + ico('alert') + '后端要先更新</b><p>表格那边的后端还是 v' + esc(S.backend) + '，不认识保险的数据。把 Code.gs 换成新的并发一个新版本（部署文档「升级」一节）。在那之前，这里记的东西先存在这部手机上，更新后会自动传上去。</p></section>';
    if (!pols.length) h += '<section class="card">' + emptyBox('insure', '还没有保险信息', '记下是哪家公司、谁在付、每月保费、额度和自付额、哪天续保。每次理赔记一笔，这里会算出已经用了多少、还剩多少。', '<button type="button" class="btn pri" data-act="policy-add">' + ico('plus') + '添加保险</button>') + '</section>';
    else h += pols.map(policyCard).join('') + '<button type="button" class="btn wide" data-act="policy-add">' + ico('plus') + '再加一份保险</button>';
  } else if (seg === 'health') {
    var hs = CL.entriesOf(T, p.id, 'health').sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }), open = hs.filter(function (e) { return e.data.status === 'open'; }), done = hs.filter(function (e) { return e.data.status !== 'open'; });
    var hrow = function (e) {
      return '<button type="button" class="row" data-act="open" data-t="entry" data-id="' + esc(e.id) + '">' + kico('health', 'sm') + '<span class="row-t"><b>' + esc(e.data.title || CL.label(CL.HEALTH, e.data.type)) + '</b><small>' +
        esc([CL.fmtDate(e.date, 'num'), CL.label(CL.HEALTH, e.data.type), e.data.clinic, e.data.status === 'open' && e.data.follow ? '复查 ' + CL.fmtDate(e.data.follow, 'num') : ''].filter(Boolean).join(' · ')) + '</small></span>' + sevPill(e.data.sev) + (e.media.length ? ico('clip', 'sm dim') : '') + ico('chevR', 'sm dim') + '</button>';
    };
    h += '<section class="card"><div class="card-h"><h2 class="card-t">进行中</h2><span class="card-sub">' + open.length + ' 件</span></div>' + (open.length ? '<div class="rows">' + open.map(hrow).join('') + '</div>' : '<p class="hint">现在没有在观察或治疗的事情。</p>') +
      '<button type="button" class="btn pri wide" data-act="add" data-kind="health">' + ico('plus') + '记一次健康事件</button></section>';
    if (done.length) h += '<section class="card"><div class="card-h"><h2 class="card-t">以前的</h2><span class="card-sub">' + done.length + ' 件</span></div><div class="rows">' + done.map(hrow).join('') + '</div></section>';
  } else {
    var docs = CL.vals(T.docs).filter(function (d) { return !d.pet_id || d.pet_id === p.id; }).sort(function (a, b) { return (b.date || '') < (a.date || '') ? -1 : (b.date || '') > (a.date || '') ? 1 : 0; });
    h += '<section class="card"><div class="card-h"><h2 class="card-t">文件</h2><span class="card-sub">两个人都能看</span></div>';
    if (!docs.length) h += emptyBox('doc', '还没有文件', '疫苗本、体检报告、化验单、领养或购买合同，拍照或选 PDF 传上来，以后在这里随时能找到。');
    else h += '<div class="rows">' + docs.map(function (d) {
      var im = CL.images(T, d)[0], n = d.media.filter(function (id) { return T.media[id]; }).length;
      return '<button type="button" class="row doc" data-act="doc" data-id="' + esc(d.id) + '">' + (im ? '<span class="doc-th"><img data-mid="' + esc(im) + '" alt=""></span>' : '<span class="doc-th">' + ico('doc') + '</span>') + '<span class="row-t"><b>' + esc(d.title) + '</b><small>' +
        esc([CL.label(CL.DOC_CATS, d.category), d.date ? CL.fmtDate(d.date, 'num') : '', n > 1 ? n + ' 个文件' : '', whoName(d.created_by)].filter(Boolean).join(' · ')) + '</small></span>' + ico('chevR', 'sm dim') + '</button>';
    }).join('') + '</div>';
    h += '<button type="button" class="btn pri wide" data-act="add" data-kind="doc">' + ico('plus') + '上传文件</button></section>';
  }
  return h;
}

/* ---- 护理和保险的零件 ---- */
function careLine(c) { return c.last ? '上次 ' + CL.daysAgo(c.days) + ' · ' + CL.fmtDate(c.last.date, c.last.date.slice(0, 4) === S.today.slice(0, 4) ? '' : 'ymd') : '还没记过'; }
function careNext(c) {
  if (c.every == null) return '';
  var every = CL.everyText(c.every) + '一次 · ';
  return every + (!c.last ? '该做了' : c.left > 0 ? '还有 ' + c.left + ' 天' : c.left === 0 ? '今天该做了' : '超了 ' + (-c.left) + ' 天');
}
function careRow(c) {
  return '<div class="care st-' + c.state + '" data-care="' + c.type + '"><button type="button" class="care-main" data-act="care" data-type="' + c.type + '"><b>' + esc(c.label) + '</b><span class="shot-l">' + esc(careLine(c)) + '</span>' +
    (c.every != null ? '<span class="shot-l next">' + (c.state === 'due' ? ico('alert', 'xs') : '') + esc(careNext(c)) + '</span>' : '') + '</button>' +
    (c.last && c.days === 0 ? '<span class="pill ok">' + ico('check', 'xs') + '今天做了</span>' : '<button type="button" class="btn sm" data-act="care-done" data-type="' + c.type + '" aria-label="' + esc(c.label) + '：今天做了">做了</button>') + '</div>';
}
// some：有数但不到 1% 的时候也画出一小截，不然看着像一点没用
function meter(pct, cls, some) { return '<span class="bar ' + cls + '" aria-hidden="true"><i style="width:' + clamp(pct || (some ? 1 : 0), 0, 100) + '%"></i></span>'; }
function claimRow(c, cur) {
  var parts = [CL.fmtDate(c.date, 'num'), c.bill !== '' ? '账单 ' + CL.fmtMoney(c.bill, cur) : '', c.status !== 'denied' && c.paid !== '' ? '赔了 ' + CL.fmtMoney(c.paid, cur) : '', c.status !== 'denied' && c.ded !== '' && c.ded > 0 ? '抵自付额 ' + CL.fmtMoney(c.ded, cur) : ''];
  return '<button type="button" class="row" data-act="claim-edit" data-id="' + esc(c.id) + '"><span class="row-t"><b>' + esc(c.title) + '</b><small>' + esc(parts.filter(Boolean).join(' · ')) + '</small></span>' +
    '<span class="pill ' + (c.status === 'paid' ? 'ok' : c.status === 'denied' ? 'sev3' : 'warn') + '">' + esc(CL.label(CL.CLAIM_STATUS, c.status)) + '</span>' + (c.media.length ? ico('clip', 'sm dim') : '') + ico('chevR', 'sm dim') + '</button>';
}
function policyCard(pol) {
  var v = CL.policyView(S.T, pol, S.today), m = function (n) { return CL.fmtMoney(n, pol.currency); };
  var payer = pol.payer === 'both' ? '两个人一起付' : pol.payer ? whoName(pol.payer) + '在付' : '';
  var h = '<section class="card pol"><div class="card-h"><h2 class="card-t">' + esc(pol.company) + (pol.plan ? ' <small>' + esc(pol.plan) + '</small>' : '') + '</h2><button type="button" class="link" data-act="policy-edit" data-id="' + esc(pol.id) + '">修改</button></div>';
  h += '<div class="tiles two"><div class="tile"><b class="num">' + (pol.premium !== '' ? esc(m(pol.premium)) : '—') + '</b><span>每月保费' + (payer ? ' · ' + esc(payer) : '') + '</span>' + (v.yearPremium !== '' ? '<span>一年 ' + esc(m(v.yearPremium)) + '</span>' : '') + '</div>' +
    '<div class="tile ' + (v.state === 'soon' || v.state === 'over' ? 'warn' : '') + '"><b class="num">' + (v.daysToRenew == null ? '—' : v.daysToRenew >= 0 ? v.daysToRenew + ' 天' : '过了 ' + (-v.daysToRenew) + ' 天') + '</b><span>' + (v.daysToRenew == null ? '没填续保日' : v.daysToRenew >= 0 ? '后续保' : '续保日已过') + '</span>' +
    (pol.renew ? '<span>' + esc(CL.fmtDate(pol.renew, 'ymd')) + '</span>' : '') + '</div></div>';
  if (v.state === 'over') h += '<button type="button" class="btn wide" data-act="policy-roll" data-id="' + esc(pol.id) + '">已经续保了，顺延一年</button>';
  h += '<div class="meter"><div class="meter-h"><b>年度额度</b><span>' + (pol.limit_amt !== '' ? '已用 ' + esc(m(v.used)) + ' / ' + esc(m(pol.limit_amt)) : '不限额 · 已赔 ' + esc(m(v.used))) + '</span></div>' +
    (v.usedPct != null ? meter(v.usedPct, v.usedPct >= 100 ? 'bad' : v.usedPct >= 80 ? 'warn' : 'b1', v.used > 0) + '<p class="meter-f">还剩 <b class="num">' + esc(m(v.left)) + '</b></p>' : '') + '</div>';
  if (pol.deductible !== '') h += '<div class="meter"><div class="meter-h"><b>自付额</b><span>已抵 ' + esc(m(v.dedMet)) + ' / ' + esc(m(pol.deductible)) + '</span></div>' + meter(v.dedPct == null ? 100 : v.dedPct, v.dedLeft > 0 ? 'b1' : 'ok', v.dedMet > 0) +
    '<p class="meter-f">' + (v.dedLeft > 0 ? '还差 <b class="num">' + esc(m(v.dedLeft)) + '</b> 抵满' : ico('check', 'xs') + '已经抵满') + '</p></div>';
  var facts = [];
  if (pol.rate !== '') facts.push(['赔付比例', pol.rate + '%']);
  if (v.from || v.to) facts.push(['本年度', (v.from ? CL.fmtDate(v.from, 'num') : '') + ' – ' + (v.to ? CL.fmtDate(CL.addDays(v.to, -1), 'num') : '')]);
  if (pol.policy_no) facts.push(['保单号', pol.policy_no]);
  if (facts.length) h += '<div class="kvs">' + facts.map(function (x) { return '<div class="kv"><span>' + x[0] + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('') + '</div>';
  if (pol.note) h += '<p class="tl-note">' + esc(pol.note) + '</p>';
  h += photoGrid(pol, 4) + fileChips(pol);
  h += '<div class="card-h wrap"><h3 class="card-t sm">本年度的理赔</h3><span class="card-sub">' + v.claims.length + ' 笔' + (v.billed ? ' · 账单合计 ' + esc(m(v.billed)) : '') + (v.pending ? ' · ' + v.pending + ' 笔还没赔下来' : '') + '</span></div>';
  h += v.claims.length ? '<div class="rows">' + v.claims.map(function (c) { return claimRow(c, pol.currency); }).join('') + '</div>' : '<p class="hint">这个年度还没有理赔。</p>';
  h += '<button type="button" class="btn pri wide" data-act="claim-add" data-id="' + esc(pol.id) + '">' + ico('plus') + '记一笔理赔</button>';
  if (v.older.length) h += '<details class="older"><summary>不在本年度的理赔（' + v.older.length + ' 笔）' + ico('chevD', 'sm dim') + '</summary><div class="rows">' + v.older.map(function (c) { return claimRow(c, pol.currency); }).join('') + '</div></details>';
  return h + '</section>';
}

/* ---- 设置 ---- */
function syncLine() {
  if (S.demo) return '演示模式：数据是编的，只存在这台设备上。';
  var st = S.sync.state, n = waiting();
  var s = st === 'auth' ? '口令失效了，需要重新初始化。' : st === 'offline' ? '现在没有网络。' : st === 'err' ? (S.sync.err || '刚才没同步上，稍后会自动重试。') : S.sync.busy ? '正在同步…' : S.sync.at ? '已同步（' + CL.hm(new Date(S.sync.at)) + '）' : '还没同步过';
  return s + (n ? ' 有 ' + n + ' 条改动在这部手机上等着发送。' : '');
}
function viewPrefs(p) {
  var h = '', list = pets(), me = member(S.me), other = member(S.me === 'a' ? 'b' : 'a');
  if (!needsInit() || S.demo) {
    h += '<section class="card"><div class="card-h"><h2 class="card-t">猫咪</h2></div><div class="rows">' + list.map(function (x) {
      return '<button type="button" class="row" data-act="pet-edit" data-id="' + esc(x.id) + '">' + avatar(x, 'sm') + '<span class="row-t"><b>' + esc(x.name) + '</b><small>' + esc([ageLine(x), x.breed].filter(Boolean).join(' · ') || '点开补充资料') + '</small></span>' + ico('chevR', 'sm dim') + '</button>';
    }).join('') + '</div><button type="button" class="btn wide" data-act="pet-add">' + ico('plus') + '再加一只</button></section>';
    h += '<section class="card"><h2 class="card-t">成员</h2><div class="rows"><button type="button" class="row" data-act="me-edit"><i class="who big" style="--mc:' + esc(me.color) + '"></i><span class="row-t"><b>' + esc(me.name) + '</b><small>这部手机 · 点开改名字和颜色</small></span>' + ico('chevR', 'sm dim') + '</button>' +
      '<div class="row static"><i class="who big" style="--mc:' + esc(other.color) + '"></i><span class="row-t"><b>' + esc(other.name) + '</b><small>另一部手机</small></span></div></div></section>';
    h += '<section class="card"><h2 class="card-t">体重单位</h2><div class="seg" role="tablist">' + CL.UNITS.map(function (x) { return '<button type="button" role="tab" aria-selected="' + (unit() === x) + '" class="' + (unit() === x ? 'on' : '') + '" data-act="unit" data-v="' + x + '">' + (x === 'kg' ? '公斤 kg' : '磅 lb') + '</button>'; }).join('') + '</div><p class="hint">两部手机一起换。表格里一律存公斤。</p></section>';
  }
  h += '<section class="card"><h2 class="card-t">外观</h2><div class="seg" role="tablist">' + [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(function (x) { return '<button type="button" role="tab" aria-selected="' + (S.ui.theme === x[0]) + '" class="' + (S.ui.theme === x[0] ? 'on' : '') + '" data-act="theme" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div></section>';
  h += '<section class="card"><h2 class="card-t">连接与数据</h2><p class="hint" id="sync-line">' + esc(syncLine()) + '</p>';
  if (S.demo) h += ENV.preview ? '<p class="hint">这是预览版，只能看演示。正式使用要按部署文档放到 GitHub Pages 上，再连上你自己的 Google 表格。</p><button type="button" class="btn wide" data-act="demo-reset">把演示数据恢复成最初的样子</button>'
    : '<div class="btns"><button type="button" class="btn" data-act="demo-reset">恢复演示数据</button><button type="button" class="btn pri" data-act="demo-off">退出演示</button></div>';
  else if (S.auth) h += '<div class="btns"><button type="button" class="btn" data-act="resync">重新同步全部数据</button><button type="button" class="btn" data-act="reinit">换一条初始化链接</button></div>' +
    '<p class="hint">记录在你们的 Google 表格里，照片和文件在 Google Drive 的「CatLog 猫咪日志」文件夹里，都可以直接打开看。在表格里手工改过内容后，点一下「重新同步全部数据」最保险。</p>';
  h += '</section><p class="about">CatLog 猫咪日志 v' + esc(VERSION) + (S.backend ? ' · 后端 v' + esc(S.backend) : '') + '</p>';
  return h;
}

/* ---- 还没初始化、还没有猫 ---- */
function viewWelcome() {
  var ios = /iPhone|iPad|iPod/.test(navigator.userAgent), alone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  return '<section class="welcome"><div class="logo">' + ico('home') + '</div><h1 class="brand big">CatLog</h1><p class="lead">猫咪日志：体重、日常状态、疫苗、照片和文件，两个人一起记、一起看。</p>' +
    '<div class="card"><h2 class="card-t">粘贴初始化链接</h2><p class="hint">链接由表格里的菜单「CatLog → 生成初始化链接」生成，每人一条。' + (ios && alone ? '主屏幕上的 App 和 Safari 不共用数据，所以这里要再粘贴一次。' : '') + '</p>' +
    '<textarea id="init-text" class="inp" rows="3" placeholder="https://…#init=…" autocapitalize="off" autocomplete="off" spellcheck="false" aria-label="初始化链接"></textarea><p class="err" id="init-err" role="alert"></p>' +
    '<button type="button" class="btn pri wide" data-act="init-paste">开始使用</button></div>' +
    '<button type="button" class="btn wide" data-act="demo-on">先看看演示</button>' +
    (ios && !alone ? '<p class="hint center">想像 App 一样用：点 Safari 底部的分享按钮，选「添加到主屏幕」。</p>' : '') + '<p class="about">v' + esc(VERSION) + '</p></section>';
}
function viewFirstPet() {
  return '<section class="welcome"><div class="logo">' + ico('home') + '</div><h1 class="brand big">CatLog</h1><p class="lead">' + (S.sync.state === 'ok' || S.demo ? '连上了。先添加你们的猫。' : esc(syncLine())) + '</p>' +
    '<button type="button" class="btn pri wide" data-act="pet-add">' + ico('plus') + '添加第一只猫</button><button type="button" class="btn wide" data-act="go" data-tab="prefs">设置</button></section>';
}

/* ---- 画完页面以后要做的事 ---- */
var chartApi = null;
function afterRender(p) {
  var host = $('#wchart');
  chartApi = null;
  if (host && p) {
    var from = rangeFrom(), ws = CL.weights(S.T, p.id);
    if (from) ws = ws.filter(function (w) { return w.date >= from; });
    chartApi = Charts.weight(host, ws, { CL: CL, unit: unit(), birthday: p.birthday });
  }
}
