/* app-core.js — Nebula v9 共享内核
 * 统一：5 万字上限、分片处理、导出（改文件名 + 同名覆盖）、文件导入、草稿、计数器。
 * 依赖：lib-io.js（IO）、ui-kit.js（UK，可选）
 */
(function (global) {
  'use strict';

  var NB = {};
  var $ = function (id) { return document.getElementById(id); };

  NB.MAX_TEXT = 50000;          // 单页文本上限（字符）
  NB.MAX_ROWS = 50000;          // 行数上限
  NB.FILES_KEY = 'nb_files';
  NB.FILE_CAP = 200;

  NB.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };

  NB.fmtNum = function (n) { return Number(n || 0).toLocaleString('zh-CN'); };

  NB.toast = function (msg, tone) {
    if (global.UK && UK.toast) UK.toast(msg, tone);
    else if (global.IO && IO.toast) IO.toast(msg, tone);
  };

  NB.haptic = function (ms) {
    if (global.UK && UK.haptic) UK.haptic(ms);
  };

  /* ---------------- 上限守卫 ---------------- */
  NB.guard = function (text, max) {
    max = max || NB.MAX_TEXT;
    var s = String(text == null ? '' : text);
    if (s.length <= max) return { ok: true, text: s, over: 0 };
    return { ok: false, text: s.slice(0, max), over: s.length - max };
  };

  /* 给 textarea 挂字数条：显示 已用/上限，超限变红并截断 */
  NB.counter = function (input, out, max) {
    if (!input || !out) return null;
    max = max || NB.MAX_TEXT;
    var limitOn = true;
    function paint() {
      var len = input.value.length;
      out.textContent = NB.fmtNum(len) + ' / ' + NB.fmtNum(max) + ' 字';
      out.classList.toggle('over', len > max);
      out.classList.toggle('near', len > max * 0.9 && len <= max);
      if (limitOn && len > max) {
        var pos = input.selectionStart;
        input.value = input.value.slice(0, max);
        try { input.setSelectionRange(Math.min(pos, max), Math.min(pos, max)); } catch (e) { }
        NB.toast('已到上限 ' + NB.fmtNum(max) + ' 字，超出部分已截断');
        paint();
      }
    }
    input.addEventListener('input', paint);
    input.addEventListener('paste', function () { setTimeout(paint, 0); });
    paint();
    return { refresh: paint, setLimit: function (v) { limitOn = !!v; } };
  };

  /* ---------------- 分片处理 ---------------- */
  /* chunked(items, fn, {size, onProgress, signal}) -> Promise<results> */
  NB.chunked = function (items, fn, opts) {
    opts = opts || {};
    var n = items.length;
    var step = opts.size || 2000;
    var results = new Array(n);
    var i = 0;
    return new Promise(function (resolve, reject) {
      function tick() {
        if (opts.signal && opts.signal.cancelled) return reject(new Error('CANCELLED'));
        var end = Math.min(i + step, n);
        try {
          for (; i < end; i++) results[i] = fn(items[i], i);
        } catch (e) { return reject(e); }
        if (opts.onProgress) opts.onProgress(i, n);
        if (i < n) setTimeout(tick, 0);
        else resolve(results);
      }
      if (!n) return resolve(results);
      setTimeout(tick, 0);
    });
  };

  NB.canceller = function () {
    return {
      cancelled: false,
      cancel: function () { this.cancelled = true; }
    };
  };

  /* ---------------- 文件名 ---------------- */
  var KNOWN_EXTS = ['txt','csv','tsv','json','md','markdown','sql','log','zip','html','htm','xml','yaml','yml','js','css','dat','xls','xlsx'];

  NB.sanitizeName = function (name, fallback) {
    var s = String(name == null ? '' : name).trim();
    s = s.replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').replace(/^\.+/, '');
    if (!s) s = fallback || '未命名';
    if (s.length > 80) s = s.slice(0, 80);
    return s;
  };

  /* 只剥掉“看起来像扩展名”的尾巴，避免把「数据v1.2」误伤 */
  NB.stripExt = function (name) {
    var s = String(name == null ? '' : name).trim();
    var m = s.match(/\.([A-Za-z0-9]{1,8})$/);
    if (m && KNOWN_EXTS.indexOf(m[1].toLowerCase()) >= 0) return s.slice(0, -m[0].length);
    return s;
  };

  /* 统一解析最终文件名：输入 a / a.txt / a.txt.txt 都只会得到 a.txt */
  NB.resolveName = function (raw, ext) {
    ext = String(ext || 'txt').replace(/^\./, '').toLowerCase();
    var base = String(raw == null ? '' : raw).trim();
    var prev = null;
    while (base !== prev) { prev = base; base = NB.stripExt(base); }
    base = NB.sanitizeName(base, '导出');
    return { base: base, ext: '.' + ext, full: base + '.' + ext };
  };

  NB.stamp = function (d) {
    d = d || new Date();
    function p(x) { return x < 10 ? '0' + x : '' + x; }
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  };

  /* ---------------- 本地文件库（覆盖判定） ---------------- */
  NB.files = {
    all: function () {
      try {
        var a = JSON.parse(localStorage.getItem(NB.FILES_KEY) || '[]');
        return Array.isArray(a) ? a : [];
      } catch (e) { return []; }
    },
    find: function (name) {
      var list = NB.files.all();
      for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === name) return list[i];
      return null;
    },
    add: function (name, size) {
      try {
        var list = NB.files.all().filter(function (x) { return x && x.name !== name; });
        list.unshift({ name: name, size: size || 0, ts: Date.now() });
        if (list.length > NB.FILE_CAP) list.length = NB.FILE_CAP;
        localStorage.setItem(NB.FILES_KEY, JSON.stringify(list));
      } catch (e) { }
    },
    remove: function (name) {
      try {
        localStorage.setItem(NB.FILES_KEY, JSON.stringify(NB.files.all().filter(function (x) { return x && x.name !== name; })));
      } catch (e) { }
    },
    clear: function () {
      try { localStorage.removeItem(NB.FILES_KEY); } catch (e) { }
    }
  };

  /* ---------------- 文件句柄库（IndexedDB，可持久化覆盖权限） ----------------
   * 只有 Chrome / Edge 等支持 File System Access API 的环境才有句柄；
   * 没有句柄时自动退回“下载”，不会假装能静默覆盖磁盘。
   */
  var IDB_NAME = 'nebula_fs_v2', IDB_STORE = 'handles', idbPromise = null;
  function idb() {
    if (!global.indexedDB) return Promise.resolve(null);
    if (idbPromise) return idbPromise;
    idbPromise = new Promise(function (resolve) {
      try {
        var req = global.indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'key' });
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return idbPromise;
  }
  function idbRun(mode, fn) {
    return idb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IDB_STORE, mode);
          var store = tx.objectStore(IDB_STORE);
          var req = fn(store);
          tx.oncomplete = function () {
            resolve(req && req.result !== undefined ? req.result : true);
          };
          tx.onerror = function () { resolve(null); };
          tx.onabort = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }).catch(function () { return null; });
  }
  function hkey(name, kind) { return (kind || 'file') + ':' + name; }

  NB.fs = {
    supported: !!global.indexedDB,
    put: function (name, handle, kind) {
      return idbRun('readwrite', function (s) {
        return s.put({ key: hkey(name, kind), name: name, kind: kind || 'file', handle: handle, ts: Date.now() });
      });
    },
    get: function (name, kind) {
      return idbRun('readonly', function (s) { return s.get(hkey(name, kind)); }).then(function (r) {
        return r && r.handle ? r.handle : null;
      });
    },
    del: function (name, kind) {
      return idbRun('readwrite', function (s) { return s.delete(hkey(name, kind)); });
    },
    list: function (kind) {
      return idbRun('readonly', function (s) { return s.getAll(); }).then(function (list) {
        if (!Array.isArray(list)) return [];
        return list.filter(function (x) { return !kind || x.kind === kind; });
      });
    }
  };

  /* 申请写权限（必须在用户点击的调用链里） */
  NB.ensureWrite = function (handle) {
    if (!handle) return Promise.resolve(false);
    var opts = { mode: 'readwrite' };
    if (typeof handle.queryPermission !== 'function') return Promise.resolve(true);
    return handle.queryPermission(opts).then(function (p) {
      if (p === 'granted') return true;
      if (p === 'denied') return false;
      return handle.requestPermission(opts).then(function (r) { return r === 'granted'; });
    }).catch(function () { return false; });
  };

  NB.writeToHandle = function (handle, data, type) {
    return NB.ensureWrite(handle).then(function (ok) {
      if (!ok) {
        var err = new Error('NO_PERMISSION');
        err.code = 'NO_PERMISSION';
        throw err;
      }
      return handle.createWritable().then(function (w) {
        var blob = (typeof Blob !== 'undefined' && data instanceof Blob)
          ? data : new Blob([data], { type: type || 'text/plain;charset=utf-8' });
        return w.write(blob).then(function () { return w.close(); });
      });
    });
  };

  /* 记住最近一次导入：文件名 + 大小 + 句柄（有的话） */
  NB._lastSource = null;
  NB.rememberImport = function (name, handle, size) {
    var meta = { name: String(name || ''), size: size || 0, ts: Date.now() };
    try { localStorage.setItem('nb_last_import', JSON.stringify(meta)); } catch (e) { }
    NB._lastImport = meta;
    if (handle && meta.name) {
      NB._lastSource = { name: meta.name, handle: handle };
      NB.fs.put(meta.name, handle, 'file');
    }
  };
  NB.lastImport = function () {
    if (NB._lastImport) return NB._lastImport;
    try { return JSON.parse(localStorage.getItem('nb_last_import') || 'null'); } catch (e) { return null; }
  };
  NB.sourceFor = function (name) {
    if (NB._lastSource && NB._lastSource.name === name) return Promise.resolve(NB._lastSource.handle);
    return NB.fs.get(name, 'file');
  };

  /* ---------------- 导出弹窗 ---------------- */
  var dlg = null;

  function ensureDialog() {
    if (dlg && document.body.contains(dlg)) return dlg;
    dlg = document.createElement('div');
    dlg.className = 'nb-xdlg';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.innerHTML =
      '<div class="nb-xdlg-back"></div>' +
      '<div class="nb-xdlg-card">' +
        '<div class="nb-xdlg-head"><span class="nb-xdlg-ic">' +
          '<svg viewBox="0 0 24 24" class="ic"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>' +
        '</span><div class="nb-xdlg-title"><b>导出文件</b><small id="nbxDlgSub">确认文件名与保存方式</small></div>' +
        '<button type="button" class="nb-xdlg-x" aria-label="关闭">' +
          '<svg viewBox="0 0 24 24" class="ic"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>' +
        '<label class="nb-xdlg-field"><span>文件名</span>' +
          '<div class="nb-xdlg-name"><input type="text" id="nbxDlgName" maxlength="80" autocomplete="off" spellcheck="false"><i id="nbxDlgExt">.txt</i></div>' +
        '</label>' +
        '<div class="nb-xdlg-final" id="nbxDlgFinal"></div>' +
        '<div class="nb-xdlg-meta" id="nbxDlgMeta"></div>' +
        '<div class="nb-xdlg-src" id="nbxDlgSrc" hidden>' +
          '<span class="nb-xdlg-src-ic"><svg viewBox="0 0 24 24" class="ic"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg></span>' +
          '<div class="nb-xdlg-src-copy"><b>已找到导入的原文件</b><small id="nbxDlgSrcName"></small></div>' +
          '<label class="nb-xdlg-check"><input type="checkbox" id="nbxDlgOver"><span>覆盖原文件</span></label>' +
        '</div>' +
        '<div class="nb-xdlg-warn" id="nbxDlgWarn" hidden></div>' +
        '<div class="nb-xdlg-actions">' +
          '<button type="button" class="btn btn-ghost" id="nbxDlgCancel">取消</button>' +
          '<button type="button" class="btn btn-primary" id="nbxDlgOk">保存</button>' +
        '</div>' +
        '<div class="nb-xdlg-foot">' +
          '<label class="nb-xdlg-check" id="nbxDlgPickerWrap"><input type="checkbox" id="nbxDlgPicker"><span>使用系统保存面板（可选位置 / 同名覆盖）</span></label>' +
          '<button type="button" class="nb-xdlg-share" id="nbxDlgShare">分享…</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(dlg);

    dlg.querySelector('.nb-xdlg-back').addEventListener('click', function () { closeDlg(null); });
    dlg.querySelector('.nb-xdlg-x').addEventListener('click', function () { closeDlg(null); });
    dlg.querySelector('#nbxDlgCancel').addEventListener('click', function () { closeDlg(null); });
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeDlg(null); }
    });
    return dlg;
  }

  var dlgResolve = null;

  function closeDlg(val) {
    if (dlg) dlg.classList.remove('show');
    var r = dlgResolve; dlgResolve = null;
    if (r) r(val);
  }

  function defaultMime(ext) {
    ext = String(ext || 'txt').toLowerCase();
    if (ext === 'csv') return 'text/csv;charset=utf-8';
    if (ext === 'json') return 'application/json;charset=utf-8';
    if (ext === 'md' || ext === 'markdown') return 'text/markdown;charset=utf-8';
    if (ext === 'zip') return 'application/zip';
    if (ext === 'html' || ext === 'htm') return 'text/html;charset=utf-8';
    return 'text/plain;charset=utf-8';
  }

  function downloadBlob(blob, name, type) {
    if (IO.downloadBlob) return IO.downloadBlob(blob, name, type);
    return IO.exportText(String(blob), name, type, NB.toast);
  }

  /* exportDialog({text|blob|bytes, name, ext, mime, meta, picker, sourceName}) */
  NB.exportDialog = function (opts) {
    opts = opts || {};
    var text = String(opts.text == null ? '' : opts.text);
    var isBlob = typeof Blob !== 'undefined' && opts.blob instanceof Blob;
    var isBytes = !isBlob && opts.bytes && typeof opts.bytes.length === 'number';
    if (!isBlob && !isBytes && !text) { NB.toast('没有可导出的内容'); return Promise.resolve(null); }

    var ext = '.' + String(opts.ext || (isBlob ? 'zip' : 'txt')).replace(/^\./, '').toLowerCase();
    var extName = ext.slice(1);
    var type = opts.mime || defaultMime(extName);
    if (!isBlob && !isBytes && extName === 'csv' && text.charCodeAt(0) !== 0xFEFF) text = '\ufeff' + text;
    var blob = isBlob ? opts.blob : isBytes ? new Blob([opts.bytes], { type: type }) : new Blob([text], { type: type });
    var suggested = NB.sanitizeName(NB.stripExt(opts.name || '导出_' + NB.stamp()), '导出');
    var size = blob.size || text.length;

    var el = ensureDialog();
    var input = el.querySelector('#nbxDlgName');
    var warn = el.querySelector('#nbxDlgWarn');
    var meta = el.querySelector('#nbxDlgMeta');
    var finalEl = el.querySelector('#nbxDlgFinal');
    var okBtn = el.querySelector('#nbxDlgOk');
    var srcBox = el.querySelector('#nbxDlgSrc');
    var srcName = el.querySelector('#nbxDlgSrcName');
    var over = el.querySelector('#nbxDlgOver');
    var picker = el.querySelector('#nbxDlgPicker');
    var pickerWrap = el.querySelector('#nbxDlgPickerWrap');
    var shareBtn = el.querySelector('#nbxDlgShare');

    var pickerOk = typeof global.showSaveFilePicker === 'function';
    pickerWrap.hidden = !pickerOk;
    picker.checked = pickerOk;
    shareBtn.hidden = !(global.navigator && navigator.share && navigator.canShare);
    var foot = el.querySelector('.nb-xdlg-foot');
    if (foot) foot.hidden = pickerWrap.hidden && shareBtn.hidden;
    if (opts.meta) meta.textContent = opts.meta + ' · ' + NB.fmtNum(size) + ' 字节';
    else meta.textContent = NB.fmtNum(size) + ' 字节 · UTF-8 · 仅保存在本机';

    input.value = suggested;
    el.querySelector('#nbxDlgExt').textContent = ext;
    warn.hidden = true;
    srcBox.hidden = true;
    over.checked = false;
    el.classList.add('show');

    var handles = {};
    if (NB._lastSource) handles[NB._lastSource.name] = NB._lastSource.handle;
    var touchedOver = false;

    function fullName() { return NB.resolveName(input.value, extName).full; }

    function paint() {
      var full = fullName();
      finalEl.innerHTML = '最终文件名 <b>' + NB.esc(full) + '</b>';
      var h = handles[full];
      if (h) {
        srcBox.hidden = false;
        srcName.textContent = h.name || full;
        var isCurrent = !!(NB._lastSource && NB._lastSource.name === full);
        if (!touchedOver) over.checked = isCurrent;
      } else {
        srcBox.hidden = true;
        over.checked = false;
        touchedOver = false;
      }
      var f = NB.files.find(full);
      if (h && over.checked) {
        warn.hidden = false;
        warn.textContent = '将直接写回原文件，覆盖后不可撤销。';
      } else if (f) {
        warn.hidden = false;
        warn.textContent = '同名文件曾在 ' + new Date(f.ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' 导出（' + NB.fmtNum(f.size) + ' 字节）。没有句柄时浏览器可能生成 (1) 副本。';
      } else {
        warn.hidden = true;
      }
    }

    function refreshHandles() {
      return NB.fs.list('file').then(function (list) {
        (list || []).forEach(function (x) { if (x && x.name && x.handle) handles[x.name] = x.handle; });
        paint();
      }).catch(function () { });
    }

    function makeResult(full, mode) {
      return { name: full, mode: mode };
    }

    function record(full) {
      NB.files.add(full, blob.size);
    }

    function fallbackDownload(full) {
      return downloadBlob(blob, full, type).then(function () {
        record(full);
        NB.toast('已保存：' + full);
        NB.haptic(8);
        return makeResult(full, 'download');
      });
    }

    function saveAs(full) {
      if (pickerOk && picker.checked) {
        return global.showSaveFilePicker({
          suggestedName: full,
          types: [{ description: extName.toUpperCase() + ' 文件', accept: (function () {
            var o = {}; o[type.split(';')[0]] = [ext]; return o;
          })() }]
        }).then(function (handle) {
          return NB.writeToHandle(handle, blob, type).then(function () {
            var real = handle.name || full;
            NB.fs.put(real, handle, 'file');
            handles[real] = handle;
            record(real);
            NB.toast('已保存：' + real);
            NB.haptic(8);
            return makeResult(real, 'picker');
          });
        }).catch(function (err) {
          if (err && err.name === 'AbortError') return null;
          // 系统面板不可用 / 被策略拦截时退回下载
          return fallbackDownload(full);
        });
      }
      return fallbackDownload(full);
    }

    function doSave() {
      var full = fullName();
      var handle = handles[full];
      okBtn.disabled = true;
      var work;
      if (handle && over.checked) {
        work = NB.writeToHandle(handle, blob, type).then(function () {
          record(full);
          NB.toast('已覆盖原文件：' + full);
          NB.haptic(10);
          return makeResult(full, 'overwrite');
        }).catch(function (err) {
          if (err && err.code === 'NO_PERMISSION') {
            NB.toast('没有写入权限，改用另存');
            return saveAs(full);
          }
          throw err;
        });
      } else {
        work = saveAs(full);
      }
      work.then(function (res) {
        okBtn.disabled = false;
        if (res) closeDlg(res);
      }).catch(function (err) {
        okBtn.disabled = false;
        if (err && err.name === 'AbortError') return;
        NB.toast('保存失败：' + (err && err.message || err));
      });
    }

    if (input._nbPaint) input.removeEventListener('input', input._nbPaint);
    input._nbPaint = paint;
    input.addEventListener('input', paint);
    over.onchange = function () { touchedOver = true; paint(); };
    okBtn.onclick = doSave;
    shareBtn.onclick = function () {
      var full = fullName();
      if (IO.shareBlob) {
        IO.shareBlob(blob, full, type).then(function (ok) {
          NB.toast(ok ? '已打开系统分享' : '当前环境不支持分享');
        });
      }
    };

    paint();
    refreshHandles();
    setTimeout(function () { try { input.focus(); input.select(); } catch (e) { } }, 60);

    return new Promise(function (resolve) { dlgResolve = resolve; });
  };

  /* 直接保存（不弹窗） */
  NB.saveText = function (text, name, ext, mime) {
    ext = ext || 'txt';
    var r = NB.resolveName(name, ext);
    var type = mime || defaultMime(ext);
    var blob = new Blob([String(text)], { type: type });
    return downloadBlob(blob, r.full, type).then(function () {
      NB.files.add(r.full, blob.size);
      return r.full;
    });
  };

  /* ---------------- 文件夹导出（文档分类用） ---------------- */
  NB.dir = {
    supported: typeof global.showDirectoryPicker === 'function',
    last: function () { return NB.fs.get('__last_dir__', 'dir'); },
    pick: function () {
      if (!NB.dir.supported) return Promise.reject(new Error('NO_DIR_PICKER'));
      return global.showDirectoryPicker({ id: 'nebula-export', mode: 'readwrite' }).then(function (dir) {
        NB.fs.put('__last_dir__', dir, 'dir');
        return dir;
      });
    },
    write: function (dir, files, opts) {
      opts = opts || {};
      var list = (files || []).map(function (f) {
        return {
          name: NB.sanitizeName(f.name, '文件'),
          blob: f.blob instanceof Blob ? f.blob : new Blob([String(f.text == null ? '' : f.text)], { type: f.mime || 'text/plain;charset=utf-8' })
        };
      });
      var i = 0, names = [];
      function step() {
        if (i >= list.length) return Promise.resolve(names);
        var f = list[i++];
        return dir.getFileHandle(f.name, { create: true }).then(function (h) {
          return h.createWritable().then(function (w) {
            return w.write(f.blob).then(function () { return w.close(); });
          });
        }).then(function () {
          names.push(f.name);
          if (opts.onProgress) opts.onProgress(i, list.length);
          return step();
        });
      }
      return step();
    }
  };

  /* 文本输入弹窗（替代 window.prompt，避免 WebView 暴露地址） */
  NB.textInput = function (opts) {
    opts = opts || {};
    var old = document.querySelector('.nb-tin');
    if (old) old.remove();
    var wrap = document.createElement('div');
    wrap.className = 'nb-tin show';
    wrap.innerHTML =
      '<div class="nb-xdlg-back"></div>' +
      '<div class="nb-xdlg-card">' +
        '<div class="nb-xdlg-head"><span class="nb-xdlg-ic"><svg viewBox="0 0 24 24" class="ic"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></span>' +
        '<div class="nb-xdlg-title"><b>' + NB.esc(opts.title || '输入内容') + '</b><small>Ctrl / ⌘ + Enter 确认</small></div></div>' +
        '<textarea class="nb-tin-area" rows="7" placeholder="' + NB.esc(opts.placeholder || '') + '"></textarea>' +
        '<div class="nb-xdlg-actions"><button type="button" class="btn btn-ghost" data-c>取消</button>' +
        '<button type="button" class="btn btn-primary" data-ok>确定</button></div>' +
      '</div>';
    document.body.appendChild(wrap);
    var area = wrap.querySelector('textarea');
    function done(v) { wrap.remove(); resolve(v); }
    var resolve;
    return new Promise(function (res) {
      resolve = res;
      wrap.querySelector('[data-c]').onclick = function () { done(null); };
      wrap.querySelector('.nb-xdlg-back').onclick = function () { done(null); };
      wrap.querySelector('[data-ok]').onclick = function () { done(area.value); };
      area.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); done(area.value); }
        if (e.key === 'Escape') { e.preventDefault(); done(null); }
      });
      setTimeout(function () { area.focus(); }, 50);
    });
  };

  /* ---------------- 导入 ---------------- */
  /* upload({accept, onText(text, file, meta), onError}) — 优先系统文件面板（可拿句柄覆盖） */
  var pickerInput = null;

  function acceptTypes(accept) {
    var arr = String(accept || '').split(',').map(function (s) { return s.trim(); })
      .filter(function (s) { return /^\.[A-Za-z0-9]+$/.test(s); });
    var map = {};
    arr.forEach(function (ext) {
      var e = ext.toLowerCase();
      var mime = e === '.json' ? 'application/json'
        : e === '.csv' ? 'text/csv'
        : e === '.md' ? 'text/markdown'
        : e === '.html' ? 'text/html' : 'text/plain';
      (map[mime] = map[mime] || []).push(e);
    });
    if (!Object.keys(map).length) map['text/plain'] = ['.txt'];
    return map;
  }

  function inputUpload(opts) {
    if (!pickerInput) {
      pickerInput = document.createElement('input');
      pickerInput.type = 'file';
      pickerInput.style.display = 'none';
      document.body.appendChild(pickerInput);
    }
    pickerInput.accept = opts.accept || '.txt,.csv,.log,.tsv,text/plain';
    pickerInput.value = '';
    pickerInput.onchange = function () {
      var f = this.files && this.files[0];
      if (!f) return;
      if (f.size > 30 * 1024 * 1024) {
        NB.toast('文件超过 30MB，请先拆分');
        if (opts.onError) opts.onError(new Error('too-large'));
        return;
      }
      IO.readFile(f).then(function (text) {
        NB.rememberImport(f.name, null, f.size);
        if (opts.onText) opts.onText(text, f, { handle: null, file: f });
      }).catch(function (e) {
        NB.toast('读取失败：' + (e && e.message || e));
        if (opts.onError) opts.onError(e);
      });
    };
    pickerInput.click();
  }

  NB.upload = function (opts) {
    opts = opts || {};
    var accept = opts.accept || '.txt,.csv,.log,.tsv';
    if (!global.showOpenFilePicker || opts.picker === false) {
      inputUpload(opts);
      return Promise.resolve(null);
    }
    return global.showOpenFilePicker({
      multiple: false,
      types: [{ description: '文本 / 数据文件', accept: acceptTypes(accept) }]
    }).then(function (hs) {
      var h = hs && hs[0];
      if (!h) return null;
      return h.getFile().then(function (f) {
        if (f.size > 30 * 1024 * 1024) {
          NB.toast('文件超过 30MB，请先拆分');
          if (opts.onError) opts.onError(new Error('too-large'));
          return null;
        }
        return IO.readFile(f).then(function (text) {
          NB.rememberImport(f.name, h, f.size);
          if (opts.onText) opts.onText(text, f, { handle: h, file: f });
          return { name: f.name, size: f.size, handle: h, text: text };
        });
      });
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return null;
      if (e && e.message === 'too-large') return null;
      // 系统面板被策略拦截：尽量退回普通文件选择
      try { inputUpload(opts); } catch (e2) { }
      if (opts.onError) opts.onError(e);
      return null;
    });
  };

  /* 拖拽进来的文件：没有句柄，但至少记住文件名，便于覆盖提示 */
  NB.importFile = function (file, opts) {
    opts = opts || {};
    if (!file) return Promise.resolve(null);
    if (file.size > 30 * 1024 * 1024) {
      NB.toast('文件超过 30MB，请先拆分');
      if (opts.onError) opts.onError(new Error('too-large'));
      return Promise.resolve(null);
    }
    return IO.readFile(file).then(function (text) {
      NB.rememberImport(file.name, null, file.size);
      if (opts.onText) opts.onText(text, file, { handle: null, file: file });
      return { name: file.name, size: file.size, handle: null, text: text };
    }).catch(function (e) {
      NB.toast('读取失败：' + (e && e.message || e));
      if (opts.onError) opts.onError(e);
      return null;
    });
  };

  /* ---------------- 草稿 ---------------- */
  NB.draft = function (key, el, opts) {
    opts = opts || {};
    var k = 'nb_draft_' + key;
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { }
    if (saved && typeof saved.v === 'string' && !el.value) {
      el.value = saved.v;
      if (opts.onRestore) opts.onRestore(saved.v, saved.ts);
    }
    var write = function () {
      try {
        var v = el.value;
        if (v.length > 200 * 1024) { localStorage.removeItem(k); return; }
        localStorage.setItem(k, JSON.stringify({ v: v, ts: Date.now() }));
      } catch (e) { }
    };
    var t = null;
    el.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(write, 800);
    });
    window.addEventListener('pagehide', write);
    return {
      clear: function () { try { localStorage.removeItem(k); } catch (e) { } }
    };
  };

  /* ---------------- 其它 ---------------- */
  NB.uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };

  NB.debounce = function (fn, wait) {
    var t = null;
    return function () {
      var a = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, a); }, wait || 150);
    };
  };

  NB.download = function (text, name, mime) {
    var ext = 'txt';
    var m = String(name || '').match(/\.([A-Za-z0-9]{1,8})$/);
    if (m) ext = m[1];
    var r = NB.resolveName(name, ext);
    var type = mime || defaultMime(ext);
    var blob = new Blob([String(text)], { type: type });
    return downloadBlob(blob, r.full, type).then(function () {
      NB.files.add(r.full, blob.size);
      return r.full;
    });
  };

  /* ---------------- 统一页头 ---------------- */
  NB.sprite = function () {
    if (document.getElementById('nb-sprite')) return '';
    var sym = {
      'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
      'moon': '<path d="M20.5 14.2A8.7 8.7 0 0 1 9.8 3.5 8.7 8.7 0 1 0 20.5 14.2z"/>',
      'auto': '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M7 10h10"/>',
      'search': '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
      'upload': '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
      'download': '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
      'calendar': '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
      'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      'info': '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
      'list': '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
      'sliders': '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
      'note': '<path d="M5 3h14v18l-7-4-7 4z"/><path d="M9 8h6M9 12h4"/>',
      'code': '<path d="m9 7-5 5 5 5M15 7l5 5-5 5"/>',
      'play': '<path d="m8 5 11 7-11 7z"/>',
      'pause': '<path d="M8 5v14M16 5v14"/>',
      'file': '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
      'refresh': '<path d="M20 11a8 8 0 0 0-14.9-3M4 5v6h6M4 13a8 8 0 0 0 14.9 3M20 19v-6h-6"/>',
      'shield': '<path d="M12 3 20 6v5.5c0 5-3.4 8.2-8 9.5-4.6-1.3-8-4.5-8-9.5V6z"/><path d="m8.5 12 2.2 2.2 4.8-5"/>',
      'check': '<path d="M20 6 9 17l-5-5"/>',
      'x': '<path d="M6 6l12 12M18 6 6 18"/>',
      'copy': '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
      'trash': '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
      'sort': '<path d="M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3"/>',
      'shuffle': '<path d="M16 4h4v4M20 4l-6.5 6.5M4 20l6.5-6.5M16 20h4v-4M20 20l-6.5-6.5M4 4l3.5 3.5"/>',
      'diff': '<path d="M6 3v13M6 21v-1M18 3v1M18 21V8"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 12h6a4 4 0 0 1 4 4v-3"/>',
      'filter': '<path d="M3 5h18l-7 8.2V21l-4-2.4v-5.4z"/>',
      'dice': '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.1"/><circle cx="15.5" cy="8.5" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="8.5" cy="15.5" r="1.1"/><circle cx="15.5" cy="15.5" r="1.1"/>',
      'key': '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 4l3 3M14 6l3 3"/>',
      'folder': '<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
      'box': '<path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
      'ball': '<circle cx="12" cy="12" r="3.6"/><path d="M4.6 8.8c4.5 2.1 10.3 2.1 14.8 0M4.6 15.2c4.5-2.1 10.3-2.1 14.8 0"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(-24 12 12)"/>',
      'heart': '<path d="M12 20s-7-4.4-7-9.4A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.6c0 5-7 9.4-7 9.4z"/>',
      'gift': '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M3 12h18M12 8v13M12 8c-3 0-4-1-4-2.5S9 3 10 4s2 4 2 4zm0 0c3 0 4-1 4-2.5S15 3 14 4s-2 4-2 4z"/>',
      'spark': '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z"/>',
      'toolbox': '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M8 8V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V8M3 13h18"/>',
      'chart': '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
      'dedupe': '<rect x="4" y="7" width="12" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2"/><path d="m7.5 13 2 2 4-4"/>',
      'layers': '<path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
      'db': '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6M4 11.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
      'user': '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 21c0-3.8 3.4-6.4 7.5-6.4s7.5 2.6 7.5 6.4"/>',
      'arrow': '<path d="m9 5 7 7-7 7"/>'
    };
    var out = '<svg id="nb-sprite" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>';
    Object.keys(sym).forEach(function (k) {
      out += '<symbol id="i-' + k + '" viewBox="0 0 24 24">' + sym[k] + '</symbol>';
    });
    out += '<symbol id="nb-sun" viewBox="0 0 24 24">' + sym.sun + '</symbol>';
    out += '<symbol id="nb-moon" viewBox="0 0 24 24">' + sym.moon + '</symbol>';
    out += '<symbol id="nb-auto" viewBox="0 0 24 24">' + sym.auto + '</symbol>';
    out += '</defs></svg>';
    return out;
  };

  /* toolHead({icon: '<svg…>', kicker, title, sub, tags:[], actions: '<html>'}) */
  NB.toolHead = function (o) {
    o = o || {};
    var tags = (o.tags || []).map(function (t) { return '<span class="tag">' + NB.esc(t) + '</span>'; }).join('');
    return '<div class="tool-head-row">' +
      '<div class="tool-head-icon">' + (o.icon || '') + '</div>' +
      '<div class="tool-head">' +
        '<span class="kicker"><span class="dot"></span>' + NB.esc(o.kicker || 'TOOL') + '</span>' +
        '<h1>' + NB.esc(o.title || '工具') + '</h1>' +
        '<p>' + NB.esc(o.sub || '') + '</p>' +
        (tags ? '<div class="tool-head-tags">' + tags + '</div>' : '') +
      '</div>' +
      '<button type="button" class="nb-theme-btn" data-nb-theme aria-label="切换主题" title="切换主题">' +
        '<svg class="ic"><use href="#nb-sun"/></svg><span>主题</span></button>' +
      '</div>' + (o.actions || '');
  };

  NB.bindTheme = function (root) {
    var btns = (root || document).querySelectorAll('[data-nb-theme]');
    Array.prototype.forEach.call(btns, function (b) {
      if (b._nbBound) return;
      b._nbBound = true;
      b.addEventListener('click', function () {
        if (!global.UK) return;
        var res = UK.cycleTheme();
        var mode = res.mode;
        var use = b.querySelector('use');
        if (use) use.setAttribute('href', mode === 'dark' ? '#nb-moon' : mode === 'light' ? '#nb-sun' : '#nb-auto');
        b.querySelector('span').textContent = UK.THEME_LABEL[mode] || '主题';
        NB.toast('主题：' + (UK.THEME_LABEL[mode] || mode));
        NB.haptic(8);
      });
      var cur = (global.UK && UK.get('ui_theme', 'auto')) || 'auto';
      var u = b.querySelector('use');
      if (u) u.setAttribute('href', cur === 'dark' ? '#nb-moon' : cur === 'light' ? '#nb-sun' : '#nb-auto');
      b.querySelector('span').textContent = (global.UK && UK.THEME_LABEL[cur]) || '主题';
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { NB.bindTheme(); });
  } else { NB.bindTheme(); }

  global.NB = NB;
})(window);
