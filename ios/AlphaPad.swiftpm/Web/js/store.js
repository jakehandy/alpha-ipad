/* Persistence: native wrapper writes a JSON file in Documents; browsers use localStorage. */
(function (root) {
  'use strict';
  var KEY = 'alphapad.v1', timer = null;
  function nativeHandler() { return root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.alphapad; }
  root.Store = {
    load: function () {
      var raw = null;
      if (root.__alphaNative && typeof root.__alphaStore === 'string') raw = root.__alphaStore;
      else { try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; } }
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (e) { return null; }
    },
    save: function (data) {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var raw = JSON.stringify(data);
        if (root.__alphaNative && nativeHandler()) nativeHandler().postMessage({ type: 'store', json: raw });
        else { try { localStorage.setItem(KEY, raw); } catch (e) { console.warn('save failed', e); } }
      }, 250);
    },
    // Save a binary file: share sheet in the native app, download in browsers.
    exportFile: function (filename, bytes) {
      var u8 = new Uint8Array(bytes);
      if (root.__alphaNative && nativeHandler()) {
        var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
        nativeHandler().postMessage({ type: 'export', filename: filename, base64: btoa(s) });
        return;
      }
      var blob = new Blob([u8], { type: 'application/octet-stream' });
      var file = null;
      try { file = new File([blob], filename, { type: 'application/octet-stream' }); } catch (e) { file = null; }
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && /iPad|iPhone/.test(navigator.userAgent)) {
        navigator.share({ files: [file] }).catch(function () {});
        return;
      }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    }
  };
})(this);
