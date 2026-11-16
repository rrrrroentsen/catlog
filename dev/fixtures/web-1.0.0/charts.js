/* CatLog 猫咪日志 —— 体重曲线（手写 SVG，不依赖任何库） */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  // 好看的刻度间隔：1、2、2.5、5 乘以 10 的若干次方
  function niceStep(span, count) {
    var raw = span / Math.max(1, count), mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }
  function yTicks(lo, hi) {
    if (hi - lo < 0.2) { lo -= 0.1; hi += 0.1; }
    var pad = (hi - lo) * 0.12, step = niceStep(hi - lo + pad * 2, 3);
    var a = Math.max(0, Math.floor((lo - pad) / step) * step), b = Math.ceil((hi + pad) / step) * step, out = [];
    for (var v = a; v <= b + step / 1000; v += step) out.push(Math.round(v * 1000) / 1000);
    return { min: a, max: b, ticks: out, step: step };
  }
  // 横轴刻度：跨度短按周、中等按月、长了按季度或年，最多 5 个
  function xTicks(CL, from, to, max) {
    var span = CL.diffDays(from, to), out = [], d, lab;
    if (span <= 1) return [];
    if (span <= 100) {
      var stepD = Math.max(7, Math.ceil(span / max / 7) * 7);
      for (d = CL.addDays(to, -Math.floor(span / stepD) * stepD); d <= to; d = CL.addDays(d, stepD)) if (d >= from) out.push({ date: d, label: (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) });
      return out;
    }
    var months = Math.ceil(span / 30.4), stepM = months <= max ? 1 : months <= max * 2 ? 2 : months <= max * 3 ? 3 : months <= max * 6 ? 6 : 12 * Math.ceil(months / 12 / max);
    d = from.slice(0, 7) + '-01';
    if (d < from) d = CL.addMonths(d, 1);
    while ((+d.slice(5, 7) - 1) % stepM !== 0) d = CL.addMonths(d, 1);
    for (; d <= to; d = CL.addMonths(d, stepM)) {
      lab = stepM >= 12 || +d.slice(5, 7) === 1 ? d.slice(0, 4) + ' 年' : (+d.slice(5, 7)) + ' 月';
      out.push({ date: d, label: lab });
    }
    return out;
  }

  /**
   * 画体重曲线。
   * host：放图的元素；pts：[{date, kg, id}]（按日期从早到晚）；
   * opt：{ CL, unit, birthday, onPick(pt) }
   */
  function weight(host, pts, opt) {
    var CL = opt.CL, unit = opt.unit || 'kg';
    host.textContent = '';
    if (!pts.length) return null;
    var W = Math.max(220, Math.round(host.clientWidth || 340)), H = 210, mL = 38, mR = 16, mT = 22, mB = opt.birthday ? 40 : 26;
    var vals = pts.map(function (p) { return CL.toUnit(p.kg, unit); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), Y = yTicks(lo, hi);
    var from = pts[0].date, to = pts[pts.length - 1].date, span = Math.max(1, CL.diffDays(from, to));
    var single = pts.length === 1;
    function x(date) { return single ? mL + (W - mL - mR) / 2 : mL + (W - mL - mR) * CL.diffDays(from, date) / span; }
    function y(v) { return mT + (H - mT - mB) * (1 - (v - Y.min) / (Y.max - Y.min)); }

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': '体重曲线，从 ' + CL.fmtDate(from, 'num') + ' 到 ' + CL.fmtDate(to, 'num') + '，最近一次 ' + vals[vals.length - 1].toFixed(2) + ' ' + unit, class: 'wsvg' }, host);
    // 网格和纵轴刻度
    Y.ticks.forEach(function (t) {
      el('line', { x1: mL, x2: W - mR, y1: y(t), y2: y(t), class: 'grid' }, svg);
      var tx = el('text', { x: mL - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'tick' }, svg);
      tx.textContent = (Y.step < 1 ? t.toFixed(Y.step < 0.1 ? 2 : 1) : String(t));
    });
    // 横轴刻度：日期一行，下面一行是那时候的年龄
    xTicks(CL, from, to, W < 300 ? 4 : 5).forEach(function (t) {
      var px = x(t.date);
      if (px < mL + 14 || px > W - mR - 10) return;
      el('line', { x1: px, x2: px, y1: H - mB, y2: H - mB + 4, class: 'axis' }, svg);
      var tx = el('text', { x: px, y: H - mB + 16, 'text-anchor': 'middle', class: 'tick' }, svg);
      tx.textContent = t.label;
      if (opt.birthday) { var ag = CL.ageLabel(opt.birthday, t.date); if (ag) { var t2 = el('text', { x: px, y: H - mB + 30, 'text-anchor': 'middle', class: 'tick sub' }, svg); t2.textContent = ag; } }
    });
    el('line', { x1: mL, x2: W - mR, y1: H - mB, y2: H - mB, class: 'axis' }, svg);
    // 面和线
    var d = '', i;
    for (i = 0; i < pts.length; i++) d += (i ? 'L' : 'M') + x(pts[i].date).toFixed(1) + ' ' + y(vals[i]).toFixed(1);
    if (!single) {
      el('path', { d: d + 'L' + x(to).toFixed(1) + ' ' + (H - mB) + 'L' + x(from).toFixed(1) + ' ' + (H - mB) + 'Z', class: 'area' }, svg);
      el('path', { d: d, class: 'line' }, svg);
    }
    if (pts.length <= 60) for (i = 0; i < pts.length - 1; i++) el('circle', { cx: x(pts[i].date), cy: y(vals[i]), r: 2.4, class: 'dot' }, svg);
    // 最近一次：大一点的圆点和直接标出的数字
    var lx = x(to), ly = y(vals[vals.length - 1]);
    el('circle', { cx: lx, cy: ly, r: 5, class: 'end' }, svg);
    var endLabel = el('text', { x: Math.min(lx, W - mR - 2), y: Math.max(12, ly - 11), 'text-anchor': single ? 'middle' : 'end', class: 'endlabel' }, svg);
    endLabel.textContent = vals[vals.length - 1].toFixed(2) + ' ' + unit;
    // 十字线和提示
    var cross = el('line', { x1: 0, x2: 0, y1: mT - 6, y2: H - mB, class: 'cross', visibility: 'hidden' }, svg);
    var focus = el('circle', { cx: 0, cy: 0, r: 5, class: 'focus', visibility: 'hidden' }, svg);
    var tip = document.createElement('div');
    tip.className = 'wtip'; tip.hidden = true;
    host.appendChild(tip);
    var cur = -1;
    function show(idx) {
      if (idx < 0 || idx >= pts.length) return hide();
      cur = idx;
      var p = pts[idx], px = x(p.date), py = y(vals[idx]);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      focus.setAttribute('cx', px); focus.setAttribute('cy', py); focus.setAttribute('visibility', 'visible');
      tip.textContent = '';
      var b = document.createElement('b'); b.textContent = vals[idx].toFixed(2) + ' ' + unit; tip.appendChild(b);
      if (idx > 0) { var dl = document.createElement('i'); dl.textContent = CL.fmtDelta(p.kg - pts[idx - 1].kg, unit); tip.appendChild(dl); }
      var s = document.createElement('span'); s.textContent = CL.fmtDate(p.date, 'num') + (opt.birthday && CL.ageLabel(opt.birthday, p.date) ? ' · ' + CL.ageLabel(opt.birthday, p.date) : ''); tip.appendChild(s);
      tip.hidden = false;
      var tw = tip.offsetWidth || 120, left = clamp(px - tw / 2, 2, W - tw - 2);
      tip.style.left = left + 'px'; tip.style.top = Math.max(0, py - 62) + 'px';
      if (py < 70) tip.style.top = (py + 14) + 'px';
      if (opt.onPick) opt.onPick(p);
    }
    function hide() { cur = -1; cross.setAttribute('visibility', 'hidden'); focus.setAttribute('visibility', 'hidden'); tip.hidden = true; }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function nearest(clientX) {
      var r = svg.getBoundingClientRect(), px = (clientX - r.left) * (W / r.width), best = 0, bd = Infinity;
      for (var k = 0; k < pts.length; k++) { var g = Math.abs(x(pts[k].date) - px); if (g < bd) { bd = g; best = k; } }
      return best;
    }
    svg.addEventListener('pointermove', function (e) { show(nearest(e.clientX)); });
    svg.addEventListener('pointerdown', function (e) { show(nearest(e.clientX)); });
    svg.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(); });
    host.setAttribute('tabindex', '0');
    host.onkeydown = function (e) {
      if (e.key === 'ArrowLeft') { show(cur < 0 ? pts.length - 1 : Math.max(0, cur - 1)); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { show(cur < 0 ? pts.length - 1 : Math.min(pts.length - 1, cur + 1)); e.preventDefault(); }
      else if (e.key === 'Home') { show(0); e.preventDefault(); }
      else if (e.key === 'End') { show(pts.length - 1); e.preventDefault(); }
      else if (e.key === 'Escape') hide();
    };
    host.onblur = hide;
    return { show: show, hide: hide, x: x, y: y, width: W };
  }

  root.Charts = { weight: weight, yTicks: yTicks, xTicks: xTicks, niceStep: niceStep };
})(typeof self !== 'undefined' ? self : this);
