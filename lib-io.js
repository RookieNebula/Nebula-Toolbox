/* lib-io.js — 通用输入输出与本地存储工具（v7 新增，不改动任何已有页面逻辑）
 * 提供：文件导入解码（UTF-8 / UTF-16 / GB18030 兜底）、导出（系统分享 → 下载 → 复制兜底）、
 *      复制、Toast、带 TTL 的 localStorage 读写、格式化与安全转义工具。
 */
(function (global) {
  'use strict';

  var IO = {};

  /* ---------------- 文本解码 ---------------- */
  function safeDecode(bytes, enc) {
    try { return new TextDecoder(enc).decode(bytes); } catch (e) { return new TextDecoder('utf-8').decode(bytes); }
  }

  IO.decodeBuffer = function (buf) {
    var bytes = new Uint8Array(buf), len = bytes.length;
    if (len >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return safeDecode(bytes.subarray(3), 'utf-8');
    if (len >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return safeDecode(bytes.subarray(2), 'utf-16le');
    if (len >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return safeDecode(bytes.subarray(2), 'utf-16be');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { }
    try { return new TextDecoder('gb18030').decode(bytes); } catch (e2) { }
    return new TextDecoder('utf-8').decode(bytes);
  };

  /* 读取 File → Promise<string>，自动识别常见编码 */
  IO.readFile = function (file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('没有选择文件'));
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var res = ev.target.result;
          var text = typeof res === 'string' ? res : IO.decodeBuffer(res);
          if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
          resolve(text);
        } catch (err) { reject(err); }
      };
      reader.onerror = function () { reject(new Error('文件读取失败')); };
      if (typeof TextDecoder === 'undefined') reader.readAsText(file, 'UTF-8');
      else reader.readAsArrayBuffer(file);
    });
  };

  /* ---------------- 导出 ---------------- */
  IO.stamp = function (d) {
    d = d || new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  };

  IO.makeName = function (prefix, ext) {
    return (prefix || '导出') + '_' + IO.stamp() + '.' + (ext || 'txt');
  };

  /* 导出文本：默认直接下载（文件名严格按设置），失败再分享，最后复制兜底。
     注意：不再默认走 navigator.share —— 部分系统分享会改写文件名，导致“设置的名字和导出的不一样”。 */
  IO.exportText = function (text, filename, mime, onMsg) {
    var say = function (m) { if (typeof onMsg === 'function') onMsg(m); };
    if (!text) { say('没有可导出的内容'); return Promise.resolve(false); }
    var name = filename || IO.makeName('导出');
    var type = mime || 'text/plain';
    var blob = new Blob([text], { type: type + (String(type).indexOf('charset') >= 0 ? '' : ';charset=utf-8') });
    return IO.downloadBlob(blob, name, type).then(function (ok) {
      if (ok) { say('已导出：' + name); return true; }
      return IO.shareBlob(blob, name, type).then(function (shared) {
        if (shared) return true;
        return IO.copy(text).then(function (copied) {
          say(copied ? '当前环境不支持保存，已复制到剪贴板' : '导出失败，请手动复制');
          return false;
        });
      });
    });
  };

  /* 下载 Blob：使用 a[download]，文件名不做任何改写 */
  IO.downloadBlob = function (blob, name, type) {
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = String(name || '导出.txt');
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return Promise.resolve(true);
    } catch (e) {
      return Promise.resolve(false);
    }
  };

  /* 系统分享：仅在用户明确点“分享…”时使用 */
  IO.shareBlob = function (blob, name, type) {
    try {
      var file = new File([blob], String(name || '导出.txt'), { type: type || blob.type || 'text/plain' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: String(name || '导出文件') })
          .then(function () { return true; })
          .catch(function () { return false; });
      }
    } catch (e) { }
    return Promise.resolve(false);
  };

  /* ---------------- 复制 ---------------- */
  IO.copy = function (text) {
    text = String(text == null ? '' : text);
    if (!text) return Promise.resolve(false);
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () {
        return Promise.resolve(fallbackCopy(text));
      });
    }
    return Promise.resolve(fallbackCopy(text));
  };

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  /* ---------------- Toast ---------------- */
  IO.toast = function (msg, tone) {
    var el = document.getElementById('io-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'io-toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:84px;transform:translate(-50%,14px);' +
        'background:rgba(17,24,39,.94);color:#fff;padding:11px 18px;border-radius:14px;font-size:13px;' +
        'font-weight:600;z-index:99999;opacity:0;pointer-events:none;transition:.24s;max-width:86vw;' +
        'text-align:center;box-shadow:0 10px 26px rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.12);';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    if (tone === 'err') el.style.background = 'rgba(190,48,48,.95)';
    else if (tone === 'ok') el.style.background = 'rgba(16,140,96,.95)';
    else el.style.background = 'rgba(17,24,39,.94)';
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%,0)';
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translate(-50%,14px)';
    }, 2200);
  };

  /* ---------------- 带 TTL 的存储 ---------------- */
  IO.set = function (key, value) {
    try {
      localStorage.setItem(key, JSON.stringify({ ts: Date.now(), v: value }));
      return true;
    } catch (e) { return false; }
  };

  IO.get = function (key, def) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return def;
      var box = JSON.parse(raw);
      if (box && typeof box === 'object' && 'v' in box && 'ts' in box) return box.v;
      return box;
    } catch (e) { return def; }
  };

  IO.ts = function (key) {
    try {
      var box = JSON.parse(localStorage.getItem(key) || 'null');
      return box && box.ts ? box.ts : 0;
    } catch (e) { return 0; }
  };

  IO.del = function (key) {
    try { localStorage.removeItem(key); } catch (e) { }
  };

  /* 清理某前缀下超过 ttlMs 的键；返回清理条数 */
  IO.purge = function (prefix, ttlMs) {
    var now = Date.now(), n = 0, keys = [];
    try { for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); } catch (e) { return 0; }
    keys.forEach(function (k) {
      if (!k || k.indexOf(prefix) !== 0) return;
      var ts = IO.ts(k);
      if (!ts || now - ts > ttlMs) { IO.del(k); n++; }
    });
    return n;
  };

  IO.clearPrefix = function (prefix) {
    var n = 0, keys = [];
    try { for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); } catch (e) { return 0; }
    keys.forEach(function (k) {
      if (k && k.indexOf(prefix) === 0) { IO.del(k); n++; }
    });
    return n;
  };

  IO.bytesUsed = function () {
    var total = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        var v = localStorage.getItem(k) || '';
        total += (k.length + v.length) * 2;
      }
    } catch (e) { }
    return total;
  };

  /* ---------------- 格式化与安全 ---------------- */
  IO.fmtBytes = function (b) {
    if (!b || b < 0) return '0 B';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  };

  IO.fmtNum = function (n) {
    return Number(n || 0).toLocaleString('zh-CN');
  };

  IO.escape = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };

  IO.debounce = function (fn, wait) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait || 200);
    };
  };

  IO.uid = function () {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };

  IO.clamp = function (n, min, max) { return Math.min(max, Math.max(min, n)); };

  /* ---------------- 清空成功动效 ---------------- */
  /* 不调用原生 confirm / alert，避免 WebView 暴露网址。 */
  IO.clearFx = function (message, sub) {
    var old = document.querySelector('.io-clear-fx');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var wrap = document.createElement('div');
    wrap.className = 'io-clear-fx';
    wrap.setAttribute('aria-live', 'polite');
    wrap.innerHTML =
      '<span class="iocf-ring"></span>' +
      '<span class="iocf-ring r2"></span>' +
      '<div class="iocf-card">' +
        '<span class="iocf-check"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span>' +
        '<span class="iocf-copy"><b></b><small></small></span>' +
      '</div>';
    wrap.querySelector('.iocf-copy b').textContent = message || '清空成功';
    wrap.querySelector('.iocf-copy small').textContent = sub || '内容已移除';
    document.body.appendChild(wrap);
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { } }
    var raf = window.requestAnimationFrame || function (fn) { setTimeout(fn, 16); };
    raf(function () { wrap.classList.add('show'); });
    setTimeout(function () {
      wrap.classList.add('leaving');
      setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 260);
    }, 1450);
  };

  /* ---------------- 主题内确认框 ---------------- */
  IO.confirm = function (opts) {
    opts = opts || {};
    var old = document.querySelector('.io-confirm');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var wrap = document.createElement('div');
    wrap.className = 'io-confirm';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML =
      '<div class="ioc-backdrop"></div>' +
      '<div class="ioc-sheet" role="document">' +
        '<div class="ioc-badge' + (opts.danger ? ' danger' : '') + '">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 21 20H3L12 3Z"/><path d="M12 9v5M12 17.5v.01"/></svg>' +
        '</div>' +
        '<h3 class="ioc-title"></h3>' +
        '<p class="ioc-text"></p>' +
        '<div class="ioc-actions">' +
          '<button type="button" class="ioc-cancel"></button>' +
          '<button type="button" class="ioc-ok' + (opts.danger ? ' danger' : '') + '"></button>' +
        '</div>' +
      '</div>';
    wrap.querySelector('.ioc-title').textContent = opts.title || '确认操作';
    wrap.querySelector('.ioc-text').textContent = opts.text || '';
    wrap.querySelector('.ioc-cancel').textContent = opts.cancelText || '取消';
    wrap.querySelector('.ioc-ok').textContent = opts.okText || '确定';
    document.body.appendChild(wrap);
    var cancel = wrap.querySelector('.ioc-cancel');
    var ok = wrap.querySelector('.ioc-ok');
    var closed = false;
    function close(run) {
      if (closed) return;
      closed = true;
      wrap.classList.remove('show');
      setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 200);
      if (run && typeof opts.onOk === 'function') opts.onOk();
      else if (!run && typeof opts.onCancel === 'function') opts.onCancel();
    }
    cancel.addEventListener('click', function () { close(false); });
    ok.addEventListener('click', function () { close(true); });
    wrap.querySelector('.ioc-backdrop').addEventListener('click', function () { close(false); });
    wrap.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      if (e.key === 'Tab') {
        e.preventDefault();
        (document.activeElement === cancel ? ok : cancel).focus();
      }
    });
    var raf = window.requestAnimationFrame || function (fn) { setTimeout(fn, 16); };
    raf(function () {
      wrap.classList.add('show');
      cancel.focus();
    });
  };

  global.IO = IO;
})(window);
