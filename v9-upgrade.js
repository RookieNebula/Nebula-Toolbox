/* v9-upgrade.js — 给旧工具页补三件事，不改原有逻辑：
   1. 50000 字上限 + 字数条
   2. 「导出…（可改名）」按钮，走统一导出弹窗
   3. 主题切换按钮（明亮 / 暗黑 / 跟随），并与主界面双向同步
   依赖：lib-io.js（已有）；app-core.js 由本文件按需注入。
*/
(function () {
  'use strict';

  function file() {
    try { return decodeURIComponent((location.pathname.split('/').pop() || '')); }
    catch (e) { return location.pathname.split('/').pop() || ''; }
  }

  var CONF = {
    '打乱模块.html': { input: '#editor', out: '#editor', name: '打乱结果' },
    '智能筛选模块工具.html': { input: '#input', out: '#output', name: '筛选结果' },
    'text-diff.html': { input: '#taA', out: '#diff', name: '文本对比报告' },
    'tools.html': { input: '#dedupe-in', out: '#card-0.show textarea[id$="-out"], #codec-out', name: '去重结果' },
    'dev-toolbox.html': { input: '#codecIn', out: '#codecOut', name: '编码结果' },
    'diary.html': { input: '#entryText', out: null, name: '日志' },
    'sort-tool.html': { input: '#editor', out: null, name: '排序结果' },
    'bob-query.html': { input: '#batchInput', out: null, name: '球球查询' }
  };

  var cfg = CONF[file()] || {};
  var $ = function (s) { return s ? document.querySelector(s) : null; };
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
  };

  function toast(m) {
    if (window.NB) return NB.toast(m);
    if (window.IO) return IO.toast(m);
  }

  /* 注入 app-core.js */
  function ensureCore() {
    if (window.NB) { boot(); return; }
    var s = document.createElement('script');
    s.src = 'app-core.js';
    s.onload = boot;
    s.onerror = function () { };
    document.head.appendChild(s);
  }

  /* 取值：textarea 取 value，其它取 innerText */
  function readOut() {
    var el = $(cfg.out);
    if (!el) return '';
    if ('value' in el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) return el.value;
    return (el.innerText || el.textContent || '').trim();
  }

  function makeBar() {
    var main = document.querySelector('.ts-head') || document.querySelector('main') || document.body;
    var bar = document.createElement('div');
    bar.className = 'v9-bar';
    bar.innerHTML =
      '<button type="button" class="v9-btn v9-theme" aria-label="切换主题">' +
        '<svg class="ic" viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18 2 2 0 0 0 0-4 2 2 0 0 1 0-4h4a5 5 0 0 0 0-10z"/></svg>' +
        '<span>主题</span></button>' +
      '<span class="v9-sp"></span>' +
      '<span class="v9-count" data-v9-count>0 / 50,000 字</span>' +
      '<button type="button" class="v9-btn v9-save" aria-label="导出并改名">' +
        '<svg class="ic" viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>导出…</button>';
    if (main && main.classList && main.classList.contains('ts-head')) {
      main.parentNode.insertBefore(bar, main.nextSibling);
    } else {
      main.insertBefore(bar, main.firstChild);
    }
    return bar;
  }

  function bindCounter(bar) {
    var input = $(cfg.input);
    if (!input || !window.NB) return;
    input.setAttribute('maxlength', '50000');
    var out = bar.querySelector('[data-v9-count]');
    var c = NB.counter(input, out, NB.MAX_TEXT);
    // 记录初始内容，便于「覆盖」提示
    input._v9Init = input.value;
    void c;
  }

  var THEME_LABEL = { light: '明亮', dark: '暗黑', auto: '跟随' };

  function paintTheme(btn) {
    var cur = LS.get('ui_theme', 'auto');
    var span = btn.querySelector('span');
    if (span) span.textContent = THEME_LABEL[cur] || '主题';
  }

  function applyTheme(mode) {
    var accent = LS.get('ui_accent', 'indigo');
    LS.set('ui_theme', mode);
    // tool-skin.js 监听 dsh-theme 消息，这里直接复用它
    try { window.postMessage({ type: 'dsh-theme', theme: mode, accent: accent }, '*'); } catch (e) { }
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'nb-theme-set', theme: mode, accent: accent }, '*');
      }
    } catch (e) { }
  }

  function bindTheme(bar) {
    var btn = bar.querySelector('.v9-theme');
    paintTheme(btn);
    btn.addEventListener('click', function () {
      var order = ['light', 'dark', 'auto'];
      var cur = LS.get('ui_theme', 'auto');
      var next = order[(order.indexOf(cur) + 1) % order.length];
      applyTheme(next);
      paintTheme(btn);
      toast('主题：' + (THEME_LABEL[next] || next));
    });
  }

  function bindExport(bar) {
    var btn = bar.querySelector('.v9-save');
    if (!cfg.out) { btn.hidden = true; return; }
    btn.addEventListener('click', function () {
      var text = readOut();
      if (!text) { toast('还没有可导出的内容'); return; }
      NB.exportDialog({
        text: text,
        name: (function () {
          var last = NB.lastImport && NB.lastImport();
          return last && last.name ? NB.stripExt(last.name) : (cfg.name || '导出');
        })(),
        ext: 'txt',
        meta: NB.fmtNum(text.length) + ' 字符'
      });
    });
  }

  function injectStyle() {
    if (document.getElementById('v9-style')) return;
    var st = document.createElement('style');
    st.id = 'v9-style';
    st.textContent =
      '.v9-bar{position:sticky;top:0;z-index:25;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px;padding:8px 10px;' +
      'border-radius:14px;background:rgba(255,255,255,.8);border:1px solid rgba(0,0,0,.06);' +
      'box-shadow:0 10px 24px -20px rgba(0,0,0,.5),0 1px 0 rgba(255,255,255,.7) inset;' +
      '-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);}' +
      'html[data-theme="dark"] .v9-bar{background:rgba(24,27,38,.7);border-color:rgba(255,255,255,.08);}' +
      '.v9-btn{display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 11px;border-radius:9px;' +
      'border:1px solid rgba(0,0,0,.08);background:rgba(255,255,255,.7);font-size:10px;font-weight:800;color:#4b5563;cursor:pointer;}' +
      'html[data-theme="dark"] .v9-btn{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.1);color:#cbd5e1;}' +
      '.v9-btn:active{transform:scale(.95);}' +
      '.v9-btn .ic{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}' +
      '.v9-btn.v9-save{margin-left:auto;color:#5b5bd6;background:rgba(91,91,214,.1);border-color:transparent;}' +
      'html[data-theme="dark"] .v9-btn.v9-save{color:#a5b4fc;}' +
      '.v9-sp{flex:1;}' +
      '.v9-count{font-size:9px;font-weight:800;color:#9aa1af;font-variant-numeric:tabular-nums;}' +
      '.v9-count.near{color:#d98600;}.v9-count.over{color:#e24848;}';
    document.head.appendChild(st);
  }

  function boot() {
    if (document.getElementById('v9-bar')) return;
    injectStyle();
    var bar = makeBar();
    bar.id = 'v9-bar';
    bindCounter(bar);
    bindTheme(bar);
    bindExport(bar);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureCore);
  else ensureCore();
})();
