/* ---------- 00-guard：先对一下几个文件是不是同一版 ---------- */
// 更新的时候，新旧文件有可能混在一起：这个文件已经是新的，core.js 还是手机缓存里的旧文件（或者仓库里只传了一部分）。
// 混着跑会出各种怪错，所以在做任何事之前先对版本：
//   对不上 → 绕过缓存把几个文件重新取一遍，自动重新加载一次；
//   还对不上 → 停在一页说明上，不往下跑。记过的东西都在，不会动。
var MIXED = (function () {
  var core = window.CL && typeof window.CL.VERSION === 'string' ? window.CL.VERSION : '', FLAG = 'catlog:v1:reloaded', mark = BUILD + '/' + core;
  if (core === BUILD) { try { sessionStorage.removeItem(FLAG); } catch (e) { /* 用不了就算了 */ } return false; }
  var tried = true;
  try { tried = sessionStorage.getItem(FLAG) === mark; if (!tried) sessionStorage.setItem(FLAG, mark); } catch (e) { tried = true; }
  function refresh() {
    var done = false, again = function () { if (!done) { done = true; location.reload(); } };
    try {
      Promise.all(['./', 'core.js', 'charts.js', 'app.js', 'styles.css'].map(function (f) {
        return fetch(f, { cache: 'reload' }).then(function (r) { return r.text(); }).catch(function () { return null; });
      })).then(again, again);
    } catch (e) { again(); }
    setTimeout(again, 8000);
  }
  if (!tried) { refresh(); return true; }
  var view = document.getElementById('view');
  if (view) {
    view.innerHTML = '<section class="card notice warn" id="mixed" style="margin:24px 16px"><b>正在更新，还没装完整</b>' +
      '<p>这个页面的几个文件不是同一个版本：界面是 v' + BUILD + '，计算规则是 ' + (core ? 'v' + core.replace(/[^0-9A-Za-z.]/g, '').slice(0, 12) : '没加载到') + '。多半是刚更新，手机上还留着一部分旧文件。</p>' +
      '<p>联网以后点「再试一次」。一直这样的话，看看 GitHub 仓库里是不是把新版本的文件全部传上去了。记过的东西都还在。</p>' +
      '<button type="button" class="btn pri wide" id="mixed-retry">再试一次</button></section>';
    document.getElementById('mixed-retry').addEventListener('click', function () { this.disabled = true; this.textContent = '正在重新加载…'; refresh(); });
  }
  return true;
})();
if (MIXED) return;
