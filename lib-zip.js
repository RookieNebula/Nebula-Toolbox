/* lib-zip.js — 零依赖 ZIP 写入器（store 存储，无压缩）
 * 用途：替换自动分类里的 CDN JSZip，离线可用。
 * 特性：UTF-8 文件名（通用标志位 0x0800）、CRC32 查表、中央目录、EOCD。
 * 限制：单文件与总大小需 < 4GB；不支持 Zip64（超出会抛错而不是写出坏包）。
 */
(function (global) {
  'use strict';

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  var enc = new TextEncoder();

  function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
  function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }

  function dosTime(d) {
    var time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() / 2) & 0x1F);
    var date = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F);
    return { time: time, date: date };
  }

  /* files: [{ name, text }] -> Uint8Array（整包） */
  function build(files, opts) {
    opts = opts || {};
    var now = new Date();
    var dt = dosTime(now);
    var chunks = [];
    var central = [];
    var offset = 0;
    var total = 0;

    files.forEach(function (f) {
      var nameBytes = enc.encode(String(f.name || 'file.txt'));
      var dataBytes = typeof f.text === 'string' ? enc.encode(f.text) : (f.text || new Uint8Array(0));
      var crc = crc32(dataBytes);
      var size = dataBytes.length;

      // 本地文件头
      var head = [].concat(
        u32(0x04034b50), u16(20), u16(0x0800), u16(0),
        u16(dt.time), u16(dt.date), u32(crc), u32(size), u32(size),
        u16(nameBytes.length), u16(0)
      );
      var headBytes = new Uint8Array(head);
      chunks.push(headBytes, nameBytes, dataBytes);

      // 中央目录项
      central.push({
        name: nameBytes, crc: crc, size: size, offset: offset
      });

      offset += headBytes.length + nameBytes.length + size;
      total += size;
      if (offset > 0xFFFFFFFF) throw new Error('ZIP 超过 4GB，请分批导出');
    });

    var cdStart = offset;
    var cdSize = 0;
    central.forEach(function (c) {
      var rec = [].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0),
        u16(dt.time), u16(dt.date), u32(c.crc), u32(c.size), u32(c.size),
        u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset)
      );
      var recBytes = new Uint8Array(rec);
      chunks.push(recBytes, c.name);
      cdSize += recBytes.length + c.name.length;
    });

    // EOCD
    var eocd = new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
      u32(cdSize), u32(cdStart), u16(0)
    ));
    chunks.push(eocd);

    var outLen = offset + cdSize + eocd.length;
    var out = new Uint8Array(outLen);
    var p = 0;
    chunks.forEach(function (c) {
      out.set(c, p);
      p += c.length;
    });
    void total;
    return out;
  }

  var ZIP = {
    build: build,
    crc32: crc32,
    /* 打包并触发下载 */
    download: function (files, filename) {
      var bytes = build(files);
      var blob = new Blob([bytes], { type: 'application/zip' });
      var name = filename || ('打包_' + Date.now() + '.zip');
      try {
        var f = new File([blob], name, { type: 'application/zip' });
        if (navigator.canShare && navigator.canShare({ files: [f] })) {
          navigator.share({ files: [f], title: name }).catch(function () { });
          return { blob: blob, name: name, shared: true };
        }
      } catch (e) { }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return { blob: blob, name: name, shared: false };
    }
  };

  global.NBZIP = ZIP;
})(window);
