/* tool-skin.js — 把旧功能页接到 Nebula 主界面的外观系统
   只做三件事：同步主题、插入统一页头、补一组线性图标。
   不改任何原有函数、DOM id、事件和数据处理逻辑。 */
(function () {
  'use strict';

  var META = {
    '智能筛选模块工具.html': { icon: 'filter', kicker: 'SMART FILTER', title: '智能筛选', sub: '自然语言规则 → 自动编译匹配 → 命中保留或打码，其他列原样输出。', tag: '规则清洗' },
    '打乱模块.html': { icon: 'shuffle', kicker: 'ROW SHUFFLER', title: '行列打乱', sub: '按行或按列随机重排，保留每一行的完整内容；支持正则过滤。', tag: '随机重排' },
    'text-diff.html': { icon: 'diff', kicker: 'TEXT DIFF', title: '文本对比', sub: '逐行 diff · 左右原版 / 新版 · 全部在本地计算。', tag: '逐行差异' },
    'tools.html': { icon: 'dedupe', kicker: 'DOC DEDUPE', title: '去重文档工坊', sub: '文档逐行去重、空行清理与编码解析，两个独立功能区，数据不离开本机。', tag: '去重 · 解析' },
    'dev-toolbox.html': { icon: 'code', kicker: 'CODEC LAB', title: '编码实验室', sub: 'Base64、URL、Hex、哈希、JWT 与时间戳，逐层还原。', tag: '编解码' },
    'diary.html': { icon: 'book', kicker: 'DAILY LOG', title: '动态日志', sub: '记录情绪与文字，查看连续天数、趋势和时间轴。', tag: '本地记录' },
    'sort-tool.html': { icon: 'sort', kicker: 'TEXT SORTER', title: '文本排序', sub: '按列排序，整行原样保留。', tag: '按列排序' },
    'random-tool.html': { icon: 'dice', kicker: 'RANDOM GENERATOR', title: '批量随机', sub: '每行生成 1–2 组 16 / 24 进制密码。', tag: '批量生成' }
  };

  var SPRITE = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
    '<symbol id="ts-filter" viewBox="0 0 24 24"><path d="M3 5h18l-7 8v5l-4 2v-7z"/></symbol>' +
    '<symbol id="ts-shuffle" viewBox="0 0 24 24"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></symbol>' +
    '<symbol id="ts-diff" viewBox="0 0 24 24"><path d="M8 3v18M16 3v18M3 8h5M3 16h5M16 8h5M16 16h5"/></symbol>' +
    '<symbol id="ts-toolbox" viewBox="0 0 24 24"><path d="M3 8h18v11H3zM8 8V5h8v3M3 12h18M10 12v2h4v-2"/></symbol>' +
    '<symbol id="ts-dedupe" viewBox="0 0 24 24"><rect x="4" y="7" width="12" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2"/><path d="m7.5 13 2 2 4-4"/></symbol>' +
    '<symbol id="ts-code" viewBox="0 0 24 24"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 4l-4 16"/></symbol>' +
    '<symbol id="ts-book" viewBox="0 0 24 24"><path d="M4 4h7a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4zM20 4h-3a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h3z"/></symbol>' +
    '<symbol id="ts-note" viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></symbol>' +
    '<symbol id="ts-wheel" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l7 5M12 12 5 17"/></symbol>' +
    '<symbol id="ts-sort" viewBox="0 0 24 24"><path d="M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3"/></symbol>' +
    '<symbol id="ts-dice" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.1"/><circle cx="15.5" cy="8.5" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="8.5" cy="15.5" r="1.1"/><circle cx="15.5" cy="15.5" r="1.1"/></symbol>' +
    '</defs></svg>';

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
  function effective(mode) {
    if (mode === 'dark' || mode === 'light') return mode;
    try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
    catch (e) { return 'light'; }
  }
  function applyTheme() {
    var theme = effective(lsGet('ui_theme', 'auto'));
    var accent = lsGet('ui_accent', 'indigo');
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-accent', accent);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#080a10' : '#f3f4f7');
  }

  applyTheme();
  window.addEventListener('message', function (ev) {
    var d = ev && ev.data;
    if (!d || d.type !== 'dsh-theme') return;
    if (d.theme) lsSet('ui_theme', d.theme);
    if (d.accent) lsSet('ui_accent', d.accent);
    applyTheme();
  });
  window.addEventListener('storage', function (ev) {
    if (ev.key === 'ui_theme' || ev.key === 'ui_accent') applyTheme();
  });
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onSys = function () { if (lsGet('ui_theme', 'auto') === 'auto') applyTheme(); };
    if (mq.addEventListener) mq.addEventListener('change', onSys);
    else if (mq.addListener) mq.addListener(onSys);
  }

  function fileKey() {
    var p = '';
    try { p = decodeURIComponent(location.pathname.split('/').pop() || ''); } catch (e) { p = location.pathname.split('/').pop() || ''; }
    return p;
  }

  function headerHTML(meta) {
    return '<div class="ts-head">' +
      '<div class="tool-head-row">' +
      '<div class="tool-head-icon"><svg class="ic"><use href="#ts-' + meta.icon + '"/></svg></div>' +
      '<div class="tool-head">' +
      '<span class="kicker"><span class="dot"></span>' + meta.kicker + '</span>' +
      '<h1>' + meta.title + '</h1>' +
      '<p>' + meta.sub + '</p>' +
      '<div class="ts-tags"><span class="tag accent">本地处理</span><span class="tag">' + meta.tag + '</span></div>' +
      '</div></div></div>';
  }

  function init() {
    document.body.classList.add('legacy-tool');
    if (fileKey() === 'diary.html') document.body.classList.add('has-fab');
    if (!document.getElementById('ts-sprite')) {
      var holder = document.createElement('div');
      holder.id = 'ts-sprite';
      holder.setAttribute('aria-hidden', 'true');
      holder.innerHTML = SPRITE;
      document.body.insertBefore(holder, document.body.firstChild);
    }
    var meta = META[fileKey()];
    if (!meta) return;

    var existing = document.querySelector('.ts-head');
    if (existing) existing.remove();

    var oldHero = document.querySelector('.hero');
    var oldH1 = document.querySelector('body > h1') || document.querySelector('.wrap > h1');
    var oldSub = document.querySelector('body > .sub') || document.querySelector('.wrap > .sub');
    var firstCard = document.querySelector('body > .card') || document.querySelector('.wrap > .card');
    var firstTabs = document.querySelector('body > .tabs') || document.querySelector('body > .segmented-control');
    var wrap = document.querySelector('.wrap');

    if (oldHero) {
      oldHero.insertAdjacentHTML('beforebegin', headerHTML(meta));
      oldHero.style.display = 'none';
    } else if (fileKey() === 'diary.html') {
      document.body.insertAdjacentHTML('afterbegin', headerHTML(meta));
    } else if (oldH1) {
      oldH1.insertAdjacentHTML('beforebegin', headerHTML(meta));
      oldH1.style.display = 'none';
      if (oldSub) oldSub.style.display = 'none';
    } else if (firstTabs) {
      firstTabs.insertAdjacentHTML('beforebegin', headerHTML(meta));
    } else if (firstCard) {
      firstCard.insertAdjacentHTML('beforebegin', headerHTML(meta));
    } else if (wrap) {
      wrap.insertAdjacentHTML('afterbegin', headerHTML(meta));
    } else {
      document.body.insertAdjacentHTML('afterbegin', headerHTML(meta));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
