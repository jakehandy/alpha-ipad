/* AlphaPad: touch controller + librarian for the Roland Alpha Juno 1/2 and MKS-50. */
(function () {
  'use strict';
  var J = window.Juno, V = window.Viz, M = window.Midi, S = window.Store;
  var $ = function (s) { return document.querySelector(s); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function uid() { return Math.random().toString(36).slice(2, 10); }

  // ---------------------------------------------------------------- state
  var saved = S.load() || {};
  var settings = Object.assign({ channel: 0, liveSend: true, sendOnLoad: true, rxEdits: true, bulkGap: 80, octave: 3, velocity: 100, outId: null, inId: 'all', program: 0 }, saved.settings || {});
  var library = saved.library || {
    collections: [{ id: uid(), name: 'Starter tones', tones: window.STARTER_TONES.map(function (t) { return { id: uid(), name: t.name, params: t.params.slice() }; }) }]
  };
  var current = { name: 'INIT', params: J.initParams(), baseline: null, ref: null };
  var activeColl = saved.activeColl && library.collections.some(function (c) { return c.id === saved.activeColl; }) ? saved.activeColl : library.collections[0].id;

  if (saved.current && Array.isArray(saved.current.params) && saved.current.params.length === 36) {
    current.name = saved.current.name; current.params = saved.current.params.slice(); current.ref = saved.current.ref || null;
  } else {
    var first = library.collections[0].tones[0];
    if (first) { current.name = first.name; current.params = first.params.slice(); current.ref = { c: library.collections[0].id, t: first.id }; }
  }
  current.baseline = { name: current.name, params: current.params.slice() };

  function persist() {
    S.save({ settings: settings, library: library, activeColl: activeColl, current: { name: current.name, params: current.params, ref: current.ref } });
  }
  function coll(id) { return library.collections.filter(function (c) { return c.id === (id || activeColl); })[0]; }

  // ---------------------------------------------------------------- toast/modal
  var toastTimer;
  function toast(msg, ms) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2200);
  }
  // modal({title, html|node, buttons:[{label, value, primary}]}) -> Promise(value)
  function modal(o) {
    return new Promise(function (resolve) {
      var m = $('#modal'), body = $('#modalBody'), btns = $('#modalBtns');
      body.innerHTML = ''; btns.innerHTML = '';
      if (o.title) body.appendChild(el('h3', null, o.title));
      if (o.html) { var d = el('div'); d.innerHTML = o.html; body.appendChild(d); }
      if (o.node) body.appendChild(o.node);
      function close(v) { m.hidden = true; resolve(v); }
      (o.buttons || [{ label: 'OK', value: true, primary: true }]).forEach(function (b) {
        var x = el('button', b.primary ? 'primary' : '', b.label);
        x.onclick = function () { close(typeof b.value === 'function' ? b.value() : b.value); };
        btns.appendChild(x);
      });
      m.onclick = function (e) { if (e.target === m) close(null); };
      m.hidden = false;
      var inp = body.querySelector('input:not([type=checkbox]),select'); if (inp && o.focus !== false) setTimeout(function () { inp.focus(); }, 30);
      m._close = close;
    });
  }
  function promptName(title, value) {
    var wrap = el('div'), inp = el('input'); inp.maxLength = 10; inp.value = value || ''; inp.spellcheck = false;
    wrap.appendChild(el('p', null, 'Up to 10 characters: A-Z a-z 0-9 space and -'));
    wrap.appendChild(inp);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#modal')._close(J.sanitizeName(inp.value)); });
    return modal({ title: title, node: wrap, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, value: function () { return J.sanitizeName(inp.value); } }] });
  }
  function promptText(title, value) {
    var inp = el('input'); inp.value = value || '';
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#modal')._close(inp.value.trim()); });
    return modal({ title: title, node: inp, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, value: function () { return inp.value.trim(); } }] });
  }
  function confirmBox(title, text, okLabel) {
    return modal({ title: title, html: '<p>' + text + '</p>', buttons: [{ label: 'Cancel', value: false }, { label: okLabel || 'OK', value: true, primary: true }] });
  }

  // ---------------------------------------------------------------- MIDI out
  var pending = {}, flushTimer = null;
  function queueParam(id, v) {
    if (!settings.liveSend || !M.ready()) return;
    pending[id] = v;
    if (!flushTimer) flushTimer = setTimeout(flush, 16);
  }
  function flush() {
    flushTimer = null;
    Object.keys(pending).forEach(function (id) { M.send(J.ipr(settings.channel, +id, pending[id])); });
    pending = {}; blink();
  }
  function sendTone(quiet) {
    if (!M.ready()) { if (!quiet) toast('No MIDI output selected'); return false; }
    M.send(J.apr(settings.channel, current.params, current.name)); blink();
    if (!quiet) toast('Sent “' + current.name + '” to the edit buffer');
    return true;
  }
  var blinkT;
  function blink() { var d = $('#midiDot'); d.classList.add('flash'); clearTimeout(blinkT); blinkT = setTimeout(function () { d.classList.remove('flash'); }, 70); }

  // ---------------------------------------------------------------- params
  var bindings = {}; // id -> [fn(value)]
  var vizDirty = { wave: false, filter: false, env: false, lfo: false };
  var VIZ_OF = function (id) {
    var out = [];
    if ([3, 4, 5, 7, 8, 14].indexOf(id) >= 0) out.push('wave');
    if ([1, 9, 16, 17, 18, 19, 27].indexOf(id) >= 0) out.push('filter');
    if (id >= 26 && id <= 32) out.push('env');
    if (id === 24 || id === 25) out.push('lfo');
    return out;
  };
  function bind(id, fn) { (bindings[id] = bindings[id] || []).push(fn); }
  function setParam(id, v, from) {
    v = Math.max(0, Math.min(J.PARAMS[id].max, v | 0));
    var changed = current.params[id] !== v;
    current.params[id] = v;
    (bindings[id] || []).forEach(function (f) { f(v); });
    VIZ_OF(id).forEach(function (k) { vizDirty[k] = true; });
    scheduleViz();
    if (changed && from === 'ui') queueParam(id, v);
    if (changed && from !== 'load') markDirty();
  }
  function refreshAll() {
    for (var i = 0; i < 36; i++) (bindings[i] || []).forEach(function (f) { f(current.params[i]); });
    $('#toneName').value = current.name;
    Object.keys(vizDirty).forEach(function (k) { vizDirty[k] = true; });
    scheduleViz(); markDirty();
  }
  function markDirty() {
    var b = current.baseline, d = b && (b.name !== current.name || b.params.some(function (v, i) { return v !== current.params[i]; }));
    $('#dirty').hidden = !d;
    persistSoon();
  }
  var persistT; function persistSoon() { clearTimeout(persistT); persistT = setTimeout(persist, 400); }

  function loadTone(tone, ref, opts) {
    opts = opts || {};
    current.name = tone.name; current.params = tone.params.slice(); current.ref = ref || null;
    current.baseline = { name: current.name, params: current.params.slice() };
    refreshAll(); renderList();
    if (opts.send !== false && settings.sendOnLoad && M.ready()) sendTone(true);
  }

  // ---------------------------------------------------------------- viz
  var canv = {}, envActive = null, vizRaf = null;
  function scheduleViz() { if (!vizRaf) vizRaf = requestAnimationFrame(drawViz); }
  function drawViz() {
    vizRaf = null;
    if (vizDirty.wave && canv.wave) V.drawWave(canv.wave, current.params);
    if (vizDirty.filter && canv.filter) V.drawFilter(canv.filter, current.params);
    if (vizDirty.env && canv.env) V.drawEnv(canv.env, current.params, envActive);
    if (vizDirty.lfo && canv.lfo) V.drawLfo(canv.lfo, current.params);
    vizDirty = { wave: false, filter: false, env: false, lfo: false };
  }

  // ---------------------------------------------------------------- controls
  function slider(id, label, fmt) {
    var p = J.PARAMS[id], root = el('div', 'slider'), val = el('div', 'val'), track = el('div', 'track'), fill = el('div', 'fill'), cap = el('div', 'cap'), lbl = el('div', 'lbl', label || p.name);
    root.dataset.param = id;
    if (p.max <= 15) { var tk = el('div', 'ticks'); for (var i = 0; i <= p.max; i++) tk.appendChild(el('i')); track.appendChild(tk); }
    track.appendChild(fill); track.appendChild(cap);
    root.appendChild(val); root.appendChild(track); root.appendChild(lbl);
    var CAP = 22;
    function show(v) {
      var f = v / p.max;
      cap.style.bottom = 'calc(' + f + ' * (100% - ' + CAP + 'px))';
      fill.style.height = 'calc(' + f + ' * (100% - ' + CAP + 'px) + ' + CAP / 2 + 'px)';
      val.textContent = fmt ? fmt(v) : v;
    }
    bind(id, show);
    var grab = 0, lastTap = 0, pid = null;
    function valueAt(clientY) {
      var r = track.getBoundingClientRect(), usable = r.height - CAP;
      var y = clientY - grab - r.top - CAP / 2;
      return Math.round((1 - y / usable) * p.max);
    }
    track.addEventListener('pointerdown', function (e) {
      if (pid !== null) return;
      e.preventDefault(); pid = e.pointerId; track.setPointerCapture(pid); root.classList.add('active');
      var now = Date.now();
      if (now - lastTap < 300 && current.baseline) { setParam(id, current.baseline.params[id], 'ui'); lastTap = 0; return; }
      lastTap = now;
      var cr = cap.getBoundingClientRect();
      grab = (e.clientY >= cr.top - 6 && e.clientY <= cr.bottom + 6) ? e.clientY - (cr.top + cr.height / 2) : 0;
      setParam(id, valueAt(e.clientY), 'ui');
    });
    track.addEventListener('pointermove', function (e) { if (e.pointerId === pid) setParam(id, valueAt(e.clientY), 'ui'); });
    function up(e) { if (e.pointerId === pid) { pid = null; root.classList.remove('active'); } }
    track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up);
    return root;
  }

  function seg(id, label, opts, cls) {
    var root = el('div', 'seg' + (cls ? ' ' + cls : '')), row = el('div', 'opts'), btns = [];
    if (label) root.appendChild(el('div', 'lbl', label));
    opts.forEach(function (o, i) {
      var b = el('button', null, typeof o === 'string' ? o : null);
      if (o && o.icon) { var c = el('canvas'); b.appendChild(c); b._icon = function () { V.waveIcon(c, o.icon, i); }; b.title = o.title || ''; }
      b.onclick = function () { setParam(id, i, 'ui'); };
      row.appendChild(b); btns.push(b);
    });
    root.appendChild(row);
    bind(id, function (v) { btns.forEach(function (b, i) { b.classList.toggle('on', i === v); if (b._icon) b._icon(); }); });
    return root;
  }
  function toggle(id, label) {
    var b = el('button', 'toggle', label);
    b.onclick = function () { setParam(id, current.params[id] ? 0 : 1, 'ui'); };
    bind(id, function (v) { b.setAttribute('aria-pressed', v ? 'true' : 'false'); b.textContent = label + (v ? ' ON' : ' OFF'); });
    return b;
  }

  function section(cls, title, sub) {
    var s = el('section', 'section ' + cls), h = el('h2', null, title);
    if (sub) { var sm = el('small', null, sub); h.appendChild(sm); s._sub = sm; }
    s.appendChild(h); return s;
  }
  function vizCanvas(key, tall) { var c = el('canvas', 'viz' + (tall ? ' tall' : '')); canv[key] = c; return c; }
  function row(children, cls) { var r = el('div', 'row' + (cls ? ' ' + cls : '')); children.forEach(function (c) { r.appendChild(c); }); return r; }
  function col(children) { var r = el('div', 'col'); children.forEach(function (c) { r.appendChild(c); }); return r; }
  function divider() { return el('div', 'divider'); }

  var ENV_MODES = ['Env', 'Inv', 'Env+D', 'Inv+D'];
  var VCA_MODES = ['Env', 'Gate', 'Env+D', 'Gate+D'];
  var wave = function (kind, n, names) { var a = []; for (var i = 0; i <= n; i++) a.push({ icon: kind, title: names[i] }); return a; };

  function buildPanel() {
    var panel = $('#panel');

    var lfo = section('sec-lfo', 'LFO');
    lfo.appendChild(vizCanvas('lfo'));
    lfo.appendChild(row([slider(24, 'Rate'), slider(25, 'Delay')]));

    var dco = section('sec-dco', 'DCO', 'waveform mix');
    dco.appendChild(vizCanvas('wave'));
    dco.appendChild(row([
      col([
        seg(3, 'Pulse', wave('pulse', 3, ['Off', 'Square', 'PWM pulse', 'Pulse + saw']), 'waves inline'),
        seg(4, 'Saw', wave('saw', 5, ['Off', 'Saw', 'Chopped saw', 'Double saw', 'Stepped saw', 'Saw + octave']), 'waves inline'),
        seg(5, 'Sub', wave('sub', 5, ['Off', 'Square -1 oct', 'Pulse -1 oct', 'Square -2 oct', 'Pulse -2 oct', 'Mixed -1/-2 oct']), 'waves inline'),
        seg(6, 'Range', ["4'", "8'", "16'", "32'"], 'inline'),
        seg(0, 'Env', ENV_MODES, 'inline')
      ]),
      divider(),
      slider(7, 'Sub'), slider(8, 'Noise'), slider(14, 'PW'), slider(15, 'PWM rt'),
      slider(11, 'LFO'), slider(12, 'Env'), slider(13, 'After')
    ], 'top'));

    var vcf = section('sec-vcf', 'HPF · VCF', 'response');
    vcf.appendChild(vizCanvas('filter'));
    vcf.appendChild(row([
      col([seg(9, 'HPF', ['Boost', 'Flat', 'Cut 1', 'Cut 2'], 'stack'), seg(1, 'Env mode', ENV_MODES, 'stack')]),
      divider(),
      slider(16, 'Cutoff'), slider(17, 'Reso'), slider(19, 'Env'), slider(18, 'LFO'), slider(20, 'Key'), slider(21, 'After')
    ], 'top'));

    var env = section('sec-env', 'ENVELOPE', 'drag the points');
    env.appendChild(vizCanvas('env'));
    env.appendChild(row([
      slider(26, 'T1'), slider(27, 'L1'), slider(28, 'T2'), slider(29, 'L2'), slider(30, 'T3'), slider(31, 'L3'), slider(32, 'T4'),
      divider(), slider(33, 'Key')
    ]));

    var vca = section('sec-vca', 'VCA');
    vca.appendChild(seg(2, 'Mode', VCA_MODES, 'stack'));
    vca.appendChild(row([slider(22, 'Level'), slider(23, 'After')]));

    var fx = section('sec-fx', 'CHORUS');
    fx.appendChild(toggle(10, 'Chorus'));
    fx.appendChild(row([slider(34, 'Rate'), slider(35, 'Bend', function (v) { return '±' + v; })]));

    [lfo, dco, fx, vcf, env, vca].forEach(function (s) { panel.appendChild(s); });
    bindEnvDrag();
    if (window.ResizeObserver) new ResizeObserver(function () { Object.keys(vizDirty).forEach(function (k) { vizDirty[k] = true; }); scheduleViz(); }).observe(panel);
  }

  function bindEnvDrag() {
    var c = canv.env, pid = null;
    function pos(e) { var r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    c.addEventListener('pointerdown', function (e) {
      var xy = pos(e), h = V.envHit(c, current.params, xy[0], xy[1]);
      if (!h) return;
      e.preventDefault(); pid = e.pointerId; c.setPointerCapture(pid); envActive = h; vizDirty.env = true; scheduleViz();
    });
    c.addEventListener('pointermove', function (e) {
      if (e.pointerId !== pid) return;
      var xy = pos(e);
      V.envDrag(c, current.params, envActive, xy[0], xy[1]).forEach(function (ch) { setParam(ch[0], ch[1], 'ui'); });
    });
    function up(e) { if (e.pointerId === pid) { pid = null; envActive = null; vizDirty.env = true; scheduleViz(); } }
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  }

  // ---------------------------------------------------------------- keyboard
  var held = {}, holdMode = false, extDown = {};
  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function buildKeys() {
    var bed = $('#keybed'); bed.innerHTML = '';
    var w = bed.clientWidth || 600, whiteW = w > 900 ? 44 : 38, nWhite = Math.max(8, Math.floor(w / whiteW)), kw = w / nWhite;
    var base = 12 * (settings.octave + 1), wi = 0, note = base;
    $('#octLabel').textContent = 'C' + settings.octave;
    while (wi < nWhite) {
      var pc = note % 12, black = [1, 3, 6, 8, 10].indexOf(pc) >= 0, k = el('div', 'key ' + (black ? 'b' : 'w'));
      k.dataset.note = note;
      if (black) { k.style.left = (wi * kw - kw * 0.32) + 'px'; k.style.width = (kw * 0.64) + 'px'; }
      else { k.style.left = (wi * kw) + 'px'; k.style.width = (kw - 1) + 'px'; wi++; }
      if (held[note]) k.classList.add('down');
      if (extDown[note]) k.classList.add('ext');
      bed.appendChild(k); note++;
    }
  }
  function noteOn(n) { if (held[n]) return; held[n] = true; keyEl(n, 'down', true); if (M.ready()) { M.send([0x90 | settings.channel, n, settings.velocity]); blink(); } }
  function noteOff(n) { if (!held[n]) return; delete held[n]; keyEl(n, 'down', false); if (M.ready()) M.send([0x80 | settings.channel, n, 0]); }
  function keyEl(n, cls, on) { var k = document.querySelector('.key[data-note="' + n + '"]'); if (k) k.classList.toggle(cls, on); }
  function bindKeys() {
    var bed = $('#keybed'), touches = {};
    function noteAt(x, y) {
      var hit = document.elementFromPoint(x, y);
      return hit && hit.dataset && hit.dataset.note ? +hit.dataset.note : null;
    }
    bed.addEventListener('pointerdown', function (e) {
      e.preventDefault(); bed.setPointerCapture(e.pointerId);
      var n = noteAt(e.clientX, e.clientY); if (n == null) return;
      if (holdMode && held[n]) { noteOff(n); touches[e.pointerId] = null; return; }
      touches[e.pointerId] = n; noteOn(n);
    });
    bed.addEventListener('pointermove', function (e) {
      if (!(e.pointerId in touches) || touches[e.pointerId] == null || holdMode) return;
      var n = noteAt(e.clientX, e.clientY);
      if (n != null && n !== touches[e.pointerId]) { noteOff(touches[e.pointerId]); touches[e.pointerId] = n; noteOn(n); }
    });
    function up(e) { var n = touches[e.pointerId]; delete touches[e.pointerId]; if (n != null && !holdMode) noteOff(n); }
    bed.addEventListener('pointerup', up); bed.addEventListener('pointercancel', up);
    $('#octDown').onclick = function () { settings.octave = Math.max(0, settings.octave - 1); buildKeys(); persistSoon(); };
    $('#octUp').onclick = function () { settings.octave = Math.min(7, settings.octave + 1); buildKeys(); persistSoon(); };
    $('#btnHold').onclick = function () {
      holdMode = !holdMode; this.setAttribute('aria-pressed', holdMode);
      if (!holdMode) Object.keys(held).forEach(function (n) { noteOff(+n); });
    };
    $('#btnPanic').onclick = function () {
      Object.keys(held).forEach(function (n) { noteOff(+n); });
      if (M.ready()) { M.send([0xB0 | settings.channel, 123, 0]); for (var n = 0; n < 128; n++) M.send([0x80 | settings.channel, n, 0]); }
      toast('All notes off');
    };
    window.addEventListener('resize', function () { buildKeys(); measureChrome(); });
    $('#btnKeys').onclick = function () {
      settings.showKeys = !settings.showKeys; applyKeysVisible(); persistSoon();
    };
  }
  function applyKeysVisible() {
    $('#keys').hidden = settings.showKeys === false;
    $('#btnKeys').setAttribute('aria-pressed', settings.showKeys === false ? 'false' : 'true');
    measureChrome(); if (settings.showKeys !== false) buildKeys();
  }
  function measureChrome() {
    var r = document.documentElement.style;
    r.setProperty('--top-h', document.querySelector('.topbar').offsetHeight + 'px');
    r.setProperty('--keys-h', ($('#keys').hidden ? 0 : $('#keys').offsetHeight) + 'px');
  }

  // ---------------------------------------------------------------- MIDI in
  var rxBank = null, rxTimer = null;
  function onMidi(m) {
    var st = m[0];
    if (st === 0xF0) {
      if (m[1] !== 0x41 || m[4] !== 0x23) return;
      if ((m[3] & 0x0F) !== settings.channel && m[2] !== 0x37) return;
      var op = m[2];
      if (op === 0x36 && settings.rxEdits) { var p = J.parseIPR(m); if (p) setParam(p.param, p.value, 'synth'); return; }
      if (op === 0x35) {
        var t = J.parseAPR(m);
        if (t) { current.name = t.name; current.params = t.params; current.ref = null; current.baseline = { name: t.name, params: t.params.slice() }; refreshAll(); renderList(); toast('Received “' + t.name + '” from synth'); }
        return;
      }
      if (op === 0x37) {
        rxBank = (rxBank || []).concat(J.parseSyx(m));
        clearTimeout(rxTimer);
        toast('Receiving bank… ' + rxBank.length + ' tones', 1500);
        rxTimer = setTimeout(finishRxBank, 1200);
      }
      return;
    }
    var type = st & 0xF0, ch = st & 0x0F;
    if (ch !== settings.channel) return;
    if (type === 0x90 && m[2] > 0) { extDown[m[1]] = true; keyEl(m[1], 'ext', true); }
    else if (type === 0x80 || (type === 0x90 && m[2] === 0)) { delete extDown[m[1]]; keyEl(m[1], 'ext', false); }
  }
  function finishRxBank() {
    var tones = rxBank || []; rxBank = null;
    if (!tones.length) return;
    var c = { id: uid(), name: 'From synth ' + new Date().toLocaleString(), tones: tones.map(function (t) { return { id: uid(), name: t.name, params: t.params }; }) };
    library.collections.push(c); activeColl = c.id; persist(); renderColls(); renderList();
    toast('Imported ' + tones.length + ' tones from synth');
  }

  function updateMidiPill() {
    var st = M.state, out = st.outputs.filter(function (o) { return o.id === st.outId; })[0];
    $('#midiDot').classList.toggle('on', !!out);
    $('#midiLabel').textContent = out ? out.name.slice(0, 18) + ' · ch ' + (settings.channel + 1) : (st.mode === 'none' ? 'No MIDI' : 'No output');
  }

  function openMidiSettings() {
    var st = M.state, w = el('div');
    if (st.error) w.appendChild(el('p', null, st.error));
    function sel(label, list, value, extra) {
      w.appendChild(el('label', null, label));
      var s = el('select');
      (extra || []).concat(list).forEach(function (o) { var op = el('option', null, o.name); op.value = o.id; if (o.id === value) op.selected = true; s.appendChild(op); });
      if (!list.length && !(extra || []).length) { var op = el('option', null, 'none found'); op.value = ''; s.appendChild(op); }
      w.appendChild(s); return s;
    }
    var outS = sel('Output (to synth MIDI IN)', st.outputs, st.outId);
    var inS = sel('Input (from synth MIDI OUT)', st.inputs, st.inId, [{ id: 'all', name: 'All inputs' }]);
    w.appendChild(el('label', null, 'Synth MIDI channel'));
    var chS = el('select'); for (var i = 0; i < 16; i++) { var o = el('option', null, 'Channel ' + (i + 1)); o.value = i; if (i === settings.channel) o.selected = true; chS.appendChild(o); }
    w.appendChild(chS);
    function check(label, key) { var l = el('label', 'check'), c = el('input'); c.type = 'checkbox'; c.checked = !!settings[key]; l.appendChild(c); l.appendChild(document.createTextNode(label)); w.appendChild(l); return c; }
    var live = check('Send slider moves live (IPR)', 'liveSend');
    var onLoad = check('Send tone when picked from library', 'sendOnLoad');
    var rx = check('Follow edits made on the synth', 'rxEdits');
    w.appendChild(el('label', null, 'Synth program (sends Program Change; with Exclusive on, the synth replies with its tone)'));
    var pr = el('div', 'row'), minus = el('button', 'icon', '−'), num = el('input'), plus = el('button', 'icon', '+'), go = el('button', null, 'Select');
    num.value = settings.program + 1; num.style.width = '6ch'; num.inputMode = 'numeric';
    minus.onclick = function () { num.value = Math.max(1, (+num.value || 1) - 1); pc(); };
    plus.onclick = function () { num.value = Math.min(128, (+num.value || 1) + 1); pc(); };
    go.onclick = pc;
    function pc() { settings.program = Math.max(0, Math.min(127, (+num.value || 1) - 1)); if (M.ready()) { M.send([0xC0 | settings.channel, settings.program]); blink(); } persistSoon(); }
    [minus, num, plus, go].forEach(function (x) { pr.appendChild(x); }); w.appendChild(pr);
    var help = el('p'); help.style.marginTop = '14px';
    help.innerHTML = 'On the synth: set <b>MIDI Exclusive ON</b> and match the channel. Edits go to the edit buffer; press <b>WRITE</b> on the synth to keep one.';
    w.appendChild(help);
    modal({ title: 'MIDI', node: w, focus: false, buttons: [{ label: 'Done', primary: true, value: true }] }).then(function () {
      if (outS.value) M.setOutput(outS.value);
      M.setInput(inS.value || 'all');
      settings.outId = M.state.outId; settings.inId = M.state.inId;
      settings.channel = +chS.value; settings.liveSend = live.checked; settings.sendOnLoad = onLoad.checked; settings.rxEdits = rx.checked;
      persist(); updateMidiPill();
    });
  }

  // ---------------------------------------------------------------- library
  function renderColls() {
    var s = $('#collSel'); s.innerHTML = '';
    library.collections.forEach(function (c) { var o = el('option', null, c.name + ' (' + c.tones.length + ')'); o.value = c.id; if (c.id === activeColl) o.selected = true; s.appendChild(o); });
  }
  function renderList() {
    var list = $('#toneList'), c = coll(), q = $('#search').value.trim().toLowerCase();
    list.innerHTML = '';
    if (!c) return;
    var shown = 0;
    c.tones.forEach(function (t, i) {
      if (q && t.name.toLowerCase().indexOf(q) < 0) return;
      shown++;
      var li = el('li'), num = el('span', 'num', i + 1), nm = el('span', 'nm', t.name), cv = el('canvas'), more = el('button', 'icon', '⋯');
      if (current.ref && current.ref.t === t.id) li.classList.add('current');
      li.appendChild(num); li.appendChild(nm); li.appendChild(cv); li.appendChild(more);
      li.onclick = function (e) { if (e.target === more) return; loadTone(t, { c: c.id, t: t.id }); };
      more.onclick = function () { toneMenu(c, t); };
      list.appendChild(li);
      requestAnimationFrame(function () { V.drawEnv(cv, t.params, null, true); });
    });
    if (!shown) list.appendChild(el('li', 'empty', c.tones.length ? 'No matches' : 'Empty. Save the current tone here, or import a .syx file.'));
  }
  function toneMenu(c, t) {
    var w = el('div', 'menu-list');
    function item(label, fn, danger) { var b = el('button', danger ? 'danger' : '', label); b.onclick = function () { $('#modal')._close(null); fn(); }; w.appendChild(b); }
    item('Rename', function () { promptName('Rename tone', t.name).then(function (n) { if (n) { t.name = n; if (current.ref && current.ref.t === t.id) { current.name = n; current.baseline.name = n; $('#toneName').value = n; } persist(); renderList(); } }); });
    item('Duplicate', function () { var i = c.tones.indexOf(t); c.tones.splice(i + 1, 0, { id: uid(), name: t.name, params: t.params.slice() }); persist(); renderList(); renderColls(); });
    item('Move up', function () { var i = c.tones.indexOf(t); if (i > 0) { c.tones.splice(i, 1); c.tones.splice(i - 1, 0, t); persist(); renderList(); } });
    item('Move down', function () { var i = c.tones.indexOf(t); if (i < c.tones.length - 1) { c.tones.splice(i, 1); c.tones.splice(i + 1, 0, t); persist(); renderList(); } });
    item('Copy to collection…', function () { pickCollection('Copy “' + t.name + '” to').then(function (dst) { if (dst) { dst.tones.push({ id: uid(), name: t.name, params: t.params.slice() }); persist(); renderColls(); toast('Copied'); } }); });
    item('Export as .syx', function () { S.exportFile(t.name.replace(/\s+/g, '_') + '.syx', J.apr(settings.channel, t.params, t.name)); });
    item('Delete', function () { confirmBox('Delete “' + t.name + '”?', 'This cannot be undone.', 'Delete').then(function (ok) { if (ok) { c.tones.splice(c.tones.indexOf(t), 1); persist(); renderList(); renderColls(); } }); }, true);
    modal({ title: t.name, node: w, buttons: [{ label: 'Close', value: null }] });
  }
  function pickCollection(title) {
    var s = el('select');
    library.collections.forEach(function (c) { var o = el('option', null, c.name); o.value = c.id; s.appendChild(o); });
    return modal({ title: title, node: s, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, value: function () { return coll(s.value); } }] });
  }
  function collMenu() {
    var c = coll(), w = el('div', 'menu-list');
    function item(label, fn, danger) { var b = el('button', danger ? 'danger' : '', label); b.onclick = function () { $('#modal')._close(null); fn(); }; w.appendChild(b); }
    item('Send bank to synth (bulk load)…', function () { sendBank(c); });
    item('Export bank as .syx', function () { S.exportFile(c.name.replace(/[^\w-]+/g, '_') + '.syx', [].concat.apply([], J.bankBLD(settings.channel, c.tones.slice(0, 64)))); if (c.tones.length > 64) toast('Bank files hold 64 tones; exported the first 64'); });
    item('Rename collection', function () { promptText('Rename collection', c.name).then(function (n) { if (n) { c.name = n; persist(); renderColls(); } }); });
    item('Delete collection', function () {
      if (library.collections.length < 2) { toast('Keep at least one collection'); return; }
      confirmBox('Delete “' + c.name + '”?', c.tones.length + ' tones will be removed from the library.', 'Delete').then(function (ok) {
        if (!ok) return; library.collections.splice(library.collections.indexOf(c), 1); activeColl = library.collections[0].id; persist(); renderColls(); renderList();
      });
    }, true);
    modal({ title: c.name, node: w, buttons: [{ label: 'Close', value: null }] });
  }
  function sendBank(c) {
    if (!M.ready()) { toast('No MIDI output selected'); return; }
    var n = Math.min(64, c.tones.length);
    confirmBox('Send bank to synth', 'This overwrites <b>all 64 memory tones</b> on the synth with “' + c.name + '” (' + n + ' tones' + (n < 64 ? ', the rest filled with INIT' : '') + ').<br><br>' +
      'On the synth: <b>Memory Protect OFF</b>, <b>MIDI Exclusive ON</b>, channel ' + (settings.channel + 1) + ', then start <b>Bulk Load</b> (MIDI) so it waits for data. Check your manual for the exact button sequence.<br><br>Back up the synth first by doing a Bulk Dump into this app.', 'Send 64 tones').then(function (ok) {
      if (!ok) return;
      var bar = el('div', 'progress'), fill = el('i'); bar.appendChild(fill);
      var msgs = J.bankBLD(settings.channel, c.tones.slice(0, 64));
      modal({ title: 'Sending…', node: bar, buttons: [] });
      M.sendPaced(msgs, settings.bulkGap, function (i, total) { fill.style.width = (i / total * 100) + '%'; blink(); }).then(function () {
        $('#modal')._close(true); toast('Bank sent. The synth should show the transfer as complete.', 3500);
      }, function (err) { $('#modal')._close(false); toast('Send failed: ' + err.message); });
    });
  }

  function importFiles(files) {
    var list = Array.prototype.slice.call(files), total = 0;
    var next = function () {
      var f = list.shift();
      if (!f) { persist(); renderColls(); renderList(); toast(total ? 'Imported ' + total + ' tones' : 'No Alpha Juno / MKS-50 tones found in that file', 3000); return; }
      var r = new FileReader();
      r.onload = function () {
        var tones = J.parseSyx(Array.prototype.slice.call(new Uint8Array(r.result)));
        if (tones.length) {
          var c = { id: uid(), name: f.name.replace(/\.(syx|mid)$/i, ''), tones: tones.map(function (t) { return { id: uid(), name: t.name, params: t.params }; }) };
          library.collections.push(c); activeColl = c.id; total += tones.length;
        }
        next();
      };
      r.readAsArrayBuffer(f);
    };
    next();
  }

  function saveCurrent() {
    current.name = J.sanitizeName($('#toneName').value) || 'NEW TONE';
    var ref = current.ref, c = ref && coll(ref.c), t = c && c.tones.filter(function (x) { return x.id === ref.t; })[0];
    var buttons = [{ label: 'Cancel', value: null }, { label: 'Save as new', value: 'new', primary: !t }];
    if (t) buttons.push({ label: 'Overwrite “' + t.name + '”', value: 'over', primary: true });
    modal({ title: 'Save “' + current.name + '”', html: '<p>Saves into the library on this device' + (t ? ' (collection “' + c.name + '”)' : ' (collection “' + coll().name + '”)') + '. To store it inside the synth, send it and press WRITE on the synth.</p>', buttons: buttons }).then(function (v) {
      if (!v) return;
      if (v === 'over') { t.name = current.name; t.params = current.params.slice(); }
      else {
        var dst = coll(); var nt = { id: uid(), name: current.name, params: current.params.slice() };
        dst.tones.push(nt); current.ref = { c: dst.id, t: nt.id };
      }
      current.baseline = { name: current.name, params: current.params.slice() };
      persist(); markDirty(); renderColls(); renderList(); toast('Saved');
    });
  }

  function step(dir) {
    var c = current.ref ? coll(current.ref.c) : coll();
    if (!c || !c.tones.length) return;
    var i = current.ref ? c.tones.findIndex(function (t) { return t.id === current.ref.t; }) : -1;
    i = (i + dir + c.tones.length) % c.tones.length;
    loadTone(c.tones[i], { c: c.id, t: c.tones[i].id });
  }

  function openDrawer(open) {
    $('#drawer').classList.toggle('open', open); $('#scrim').classList.toggle('open', open);
    $('#drawer').setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) { renderColls(); renderList(); }
  }

  // ---------------------------------------------------------------- compare
  function bindCompare() {
    var b = $('#btnCompare'), saved = null;
    function down(e) {
      e.preventDefault();
      if (saved || !current.baseline) return;
      saved = { name: current.name, params: current.params.slice() };
      current.params = current.baseline.params.slice(); current.name = current.baseline.name;
      refreshAll(); b.classList.add('primary'); if (M.ready()) sendTone(true);
    }
    function up() {
      if (!saved) return;
      current.params = saved.params; current.name = saved.name; saved = null;
      refreshAll(); b.classList.remove('primary'); if (M.ready()) sendTone(true);
    }
    b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    buildPanel(); buildKeys(); bindKeys(); bindCompare(); applyKeysVisible();
    $('#toneName').addEventListener('change', function () { current.name = J.sanitizeName(this.value); this.value = current.name; markDirty(); });
    $('#toneName').addEventListener('keydown', function (e) { if (e.key === 'Enter') this.blur(); });
    $('#btnSend').onclick = function () { sendTone(false); };
    $('#btnSave').onclick = saveCurrent;
    $('#btnLibrary').onclick = function () { openDrawer(true); };
    $('#drawerClose').onclick = $('#scrim').onclick = function () { openDrawer(false); };
    $('#btnMidi').onclick = openMidiSettings;
    $('#prevTone').onclick = function () { step(-1); };
    $('#nextTone').onclick = function () { step(1); };
    $('#collSel').onchange = function () { activeColl = this.value; persist(); renderList(); };
    $('#collMenu').onclick = collMenu;
    $('#search').oninput = renderList;
    $('#fileIn').onchange = function () { importFiles(this.files); this.value = ''; };
    $('#btnNewColl').onclick = function () { promptText('New collection', 'My tones').then(function (n) { if (n) { var c = { id: uid(), name: n, tones: [] }; library.collections.push(c); activeColl = c.id; persist(); renderColls(); renderList(); } }); };
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

    M.onPorts(updateMidiPill);
    M.onMessage(onMidi);
    M.init({ outId: settings.outId, inId: settings.inId }).then(function (st) {
      updateMidiPill();
      if (st.mode === 'none') toast(st.error || 'No MIDI available', 4000);
    });
    refreshAll(); current.baseline = { name: current.name, params: current.params.slice() }; markDirty();
  }
  // Exposed for automated tests.
  window.AlphaPad = { get current() { return current; }, get library() { return library; }, setParam: setParam, settings: settings };
  boot();
})();
