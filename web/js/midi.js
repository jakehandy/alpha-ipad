/* MIDI transport: Web MIDI where the browser has it, or the native CoreMIDI
   bridge injected by the iOS wrapper app (window.__alphaNative). */
(function (root) {
  'use strict';
  var msgL = [], portL = [];
  var state = { mode: 'none', inputs: [], outputs: [], outId: null, inId: 'all', error: null };
  var access = null;

  function emitPorts() { portL.forEach(function (f) { f(state); }); }
  function emitMsg(bytes) { var a = Array.prototype.slice.call(bytes); msgL.forEach(function (f) { f(a); }); }
  function native() { return root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.alphapad; }
  function post(o) { var n = native(); if (n) n.postMessage(o); }

  function refreshWeb() {
    state.outputs = []; state.inputs = [];
    access.outputs.forEach(function (p) { state.outputs.push({ id: p.id, name: p.name }); });
    access.inputs.forEach(function (p) {
      state.inputs.push({ id: p.id, name: p.name });
      p.onmidimessage = function (e) { if (state.inId === 'all' || state.inId === p.id) emitMsg(e.data); };
    });
    autoPick(); emitPorts();
  }

  function autoPick() {
    if (state.outId && state.outputs.some(function (o) { return o.id === state.outId; })) return;
    var hit = state.outputs.filter(function (o) { return /juno|mks|roland|alpha/i.test(o.name); })[0];
    state.outId = hit ? hit.id : (state.outputs[0] ? state.outputs[0].id : null);
  }

  var Midi = {
    state: state,
    onMessage: function (f) { msgL.push(f); },
    onPorts: function (f) { portL.push(f); },
    init: function (prefs) {
      prefs = prefs || {};
      state.outId = prefs.outId || null; state.inId = prefs.inId || 'all';
      if (root.__alphaNative && native()) {
        state.mode = 'native';
        root.AlphaNative = root.AlphaNative || {};
        root.AlphaNative.ports = function (p) {
          state.inputs = p.inputs || []; state.outputs = p.outputs || []; autoPick(); emitPorts();
        };
        root.AlphaNative.midi = function (src, bytes) {
          if (state.inId === 'all' || state.inId === src) emitMsg(bytes);
        };
        post({ type: 'midiList' });
        return Promise.resolve(state);
      }
      if (!navigator.requestMIDIAccess) {
        state.mode = 'none';
        state.error = 'This browser has no Web MIDI. On iPad use the AlphaPad app (ios/) or a Web MIDI browser.';
        emitPorts();
        return Promise.resolve(state);
      }
      return navigator.requestMIDIAccess({ sysex: true }).then(function (a) {
        access = a; state.mode = 'web'; state.error = null;
        a.onstatechange = refreshWeb; refreshWeb(); return state;
      }, function (err) {
        state.mode = 'none'; state.error = 'MIDI access denied (' + (err && err.message || err) + ')';
        emitPorts(); return state;
      });
    },
    setOutput: function (id) { state.outId = id; emitPorts(); },
    setInput: function (id) { state.inId = id; emitPorts(); },
    ready: function () { return state.mode !== 'none' && !!state.outId; },
    send: function (bytes) {
      if (!state.outId) return false;
      if (state.mode === 'web') {
        var o = access.outputs.get(state.outId);
        if (!o) return false;
        try { o.send(bytes); } catch (e) { console.warn('MIDI send failed', e); return false; }
        return true;
      }
      if (state.mode === 'native') { post({ type: 'midiSend', dest: state.outId, data: Array.prototype.slice.call(bytes) }); return true; }
      return false;
    },
    // Send a list of messages with a gap between each (bulk dumps).
    sendPaced: function (msgs, gapMs, onProgress) {
      var self = this, i = 0;
      return new Promise(function (resolve, reject) {
        (function next() {
          if (i >= msgs.length) { resolve(); return; }
          if (!self.send(msgs[i])) { reject(new Error('No MIDI output')); return; }
          i++; if (onProgress) onProgress(i, msgs.length);
          setTimeout(next, gapMs);
        })();
      });
    }
  };
  root.Midi = Midi;
})(this);
