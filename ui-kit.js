/* ==========================================================================
   Nebula UI Kit v8 — 主题 / 复制 / Toast / 动效开关
   与主界面共用 localStorage：ui_theme / ui_accent / ui_motion / ui_fx / ui_haptic
   ========================================================================== */
(function (global) {
  'use strict';

  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
  };
  var mq = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;
  var ACCENTS = ['indigo', 'mint', 'sunset', 'sakura', 'graphite'];
  var toastTimer = null;

  function eff(mode) {
    if (mode === 'dark' || mode === 'light') return mode;
    return (mq && mq.matches) ? 'dark' : 'light';
  }

  var UK = {};

  UK.get = function (k, d) { return LS.get(k, d); };
  UK.set = function (k, v) { LS.set(k, v); };

  UK.applyTheme = function () {
    var mode = LS.get('ui_theme', 'auto');
    var accent = LS.get('ui_accent', 'indigo');
    if (ACCENTS.indexOf(accent) < 0) accent = 'indigo';
    var motion = LS.get('ui_motion', '1') !== '0';
    var fx = LS.get('ui_fx', '1') !== '0';
    var root = document.documentElement;
    root.setAttribute('data-theme', eff(mode));
    root.setAttribute('data-accent', accent);
    root.setAttribute('data-motion', motion ? 'on' : 'off');
    root.setAttribute('data-fx', fx ? 'on' : 'off');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', eff(mode) === 'dark' ? '#080a10' : '#f3f4f7');
    return { mode: mode, effective: eff(mode), accent: accent, motion: motion, fx: fx };
  };

  UK.setTheme = function (mode) {
    LS.set('ui_theme', mode);
    return UK.applyTheme();
  };
  UK.setAccent = function (accent) {
    LS.set('ui_accent', accent);
    return UK.applyTheme();
  };
  UK.toggleTheme = function () {
    var cur = eff(LS.get('ui_theme', 'auto'));
    return UK.setTheme(cur === 'dark' ? 'light' : 'dark');
  };

  /* 循环：明亮 → 暗黑 → 跟随系统；并通知父页（iframe 场景） */
  UK.cycleTheme = function () {
    var order = ['light', 'dark', 'auto'];
    var cur = LS.get('ui_theme', 'auto');
    var next = order[(order.indexOf(cur) + 1) % order.length];
    var res = UK.setTheme(next);
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'nb-theme-set', theme: next, accent: res.accent }, '*');
      }
    } catch (e) { }
    return res;
  };
  UK.THEME_LABEL = { light: '明亮', dark: '暗黑', auto: '跟随系统' };
  UK.setMotion = function (on) {
    LS.set('ui_motion', on ? '1' : '0');
    return UK.applyTheme();
  };
  UK.setFx = function (on) {
    LS.set('ui_fx', on ? '1' : '0');
    return UK.applyTheme();
  };

  UK.haptic = function (ms) {
    if (LS.get('ui_haptic', '1') === '0') return;
    try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) { }
  };

  UK.escape = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };

  UK.debounce = function (fn, wait) {
    var timer = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait || 180);
    };
  };

  UK.fmtNum = function (n) { return Number(n || 0).toLocaleString('zh-CN'); };

  UK.toast = function (msg) {
    var el = document.getElementById('ukToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ukToast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.innerHTML = '<svg class="ic" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg><span></span>';
    el.querySelector('span').textContent = msg || '';
    clearTimeout(toastTimer);
    requestAnimationFrame(function () {
      el.classList.add('show');
      toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2100);
    });
  };

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { }
    document.body.removeChild(ta);
    return ok;
  }

  UK.copy = function (text) {
    text = String(text == null ? '' : text);
    if (!text) return Promise.resolve(false);
    if (navigator.clipboard && global.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () {
        return Promise.resolve(fallbackCopy(text));
      });
    }
    return Promise.resolve(fallbackCopy(text));
  };

  UK.copyAndToast = function (text, okMsg) {
    return UK.copy(text).then(function (ok) {
      UK.haptic(8);
      UK.toast(ok ? (okMsg || '已复制') : '复制失败，请长按选择');
      return ok;
    });
  };

  UK.download = function (text, filename, mime) {
    var name = filename || ('导出_' + Date.now() + '.txt');
    var type = mime || 'text/plain';
    try {
      if (global.IO && IO.exportText) { IO.exportText(text, name, type, UK.toast); return; }
    } catch (e) { }
    try {
      var blob = new Blob([text], { type: type + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      UK.toast('已开始导出');
    } catch (e2) {
      UK.copyAndToast(text, '已复制，可手动保存');
    }
  };

  UK.stamp = function () {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  };

  UK.applyTheme();

  global.addEventListener('message', function (ev) {
    var d = ev && ev.data;
    if (!d || d.type !== 'dsh-theme') return;
    if (d.theme) LS.set('ui_theme', d.theme);
    if (d.accent) LS.set('ui_accent', d.accent);
    UK.applyTheme();
  });
  global.addEventListener('storage', function (ev) {
    if (ev.key === 'ui_theme' || ev.key === 'ui_accent' || ev.key === 'ui_motion' || ev.key === 'ui_fx' || ev.key === 'ui_haptic') UK.applyTheme();
  });
  if (mq) {
    var onSys = function () { if (LS.get('ui_theme', 'auto') === 'auto') UK.applyTheme(); };
    if (mq.addEventListener) mq.addEventListener('change', onSys);
    else if (mq.addListener) mq.addListener(onSys);
  }

  global.UK = UK;
})(window);
