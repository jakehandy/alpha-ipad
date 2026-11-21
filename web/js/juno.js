/* Alpha Juno 1/2 + MKS-50 SysEx protocol. Classic script (no modules) so it
   loads from file:// inside the iOS WKWebView wrapper. Also exported for Node tests. */
(function (root) {
  'use strict';

  var ROLAND = 0x41, MODEL = 0x23;
  var OP_APR = 0x35, OP_IPR = 0x36, OP_BLD = 0x37;
  var LEVEL = 0x20, GROUP = 0x01;
  var NAME_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -';

  // id = parameter number (IPR) = index in the 36-byte APR tone block.
  var PARAMS = [
    { id: 0,  key: 'dcoEnvMode',  name: 'DCO Env Mode',  max: 3 },
    { id: 1,  key: 'vcfEnvMode',  name: 'VCF Env Mode',  max: 3 },
    { id: 2,  key: 'vcaEnvMode',  name: 'VCA Env Mode',  max: 3 },
    { id: 3,  key: 'pulse',       name: 'Pulse Wave',    max: 3 },
    { id: 4,  key: 'saw',         name: 'Saw Wave',      max: 5 },
    { id: 5,  key: 'sub',         name: 'Sub Wave',      max: 5 },
    { id: 6,  key: 'range',       name: 'Range',         max: 3 },
    { id: 7,  key: 'subLevel',    name: 'Sub Level',     max: 3 },
    { id: 8,  key: 'noise',       name: 'Noise',         max: 3 },
    { id: 9,  key: 'hpf',         name: 'HPF',           max: 3 },
    { id: 10, key: 'chorus',      name: 'Chorus',        max: 1 },
    { id: 11, key: 'dcoLfo',      name: 'DCO LFO',       max: 127 },
    { id: 12, key: 'dcoEnv',      name: 'DCO Env',       max: 127 },
    { id: 13, key: 'dcoAfter',    name: 'DCO After',     max: 15 },
    { id: 14, key: 'pw',          name: 'PW/PWM',        max: 127 },
    { id: 15, key: 'pwmRate',     name: 'PWM Rate',      max: 127 },
    { id: 16, key: 'cutoff',      name: 'Cutoff',        max: 127 },
    { id: 17, key: 'res',         name: 'Resonance',     max: 127 },
    { id: 18, key: 'vcfLfo',      name: 'VCF LFO',       max: 127 },
    { id: 19, key: 'vcfEnv',      name: 'VCF Env',       max: 127 },
    { id: 20, key: 'vcfKey',      name: 'Key Follow',    max: 15 },
    { id: 21, key: 'vcfAfter',    name: 'VCF After',     max: 15 },
    { id: 22, key: 'vcaLevel',    name: 'VCA Level',     max: 127 },
    { id: 23, key: 'vcaAfter',    name: 'VCA After',     max: 15 },
    { id: 24, key: 'lfoRate',     name: 'LFO Rate',      max: 127 },
    { id: 25, key: 'lfoDelay',    name: 'LFO Delay',     max: 127 },
    { id: 26, key: 't1',          name: 'T1',            max: 127 },
    { id: 27, key: 'l1',          name: 'L1',            max: 127 },
    { id: 28, key: 't2',          name: 'T2',            max: 127 },
    { id: 29, key: 'l2',          name: 'L2',            max: 127 },
    { id: 30, key: 't3',          name: 'T3',            max: 127 },
    { id: 31, key: 'l3',          name: 'L3',            max: 127 },
    { id: 32, key: 't4',          name: 'T4',            max: 127 },
    { id: 33, key: 'envKey',      name: 'Env Key Follow',max: 15 },
    { id: 34, key: 'chorusRate',  name: 'Chorus Rate',   max: 127 },
    { id: 35, key: 'bend',        name: 'Bend Range',    max: 12 }
  ];
  var KEY = {};
  PARAMS.forEach(function (p) { KEY[p.key] = p.id; });

  // Packed 32-byte tone layout used by bulk dumps:
  // [packedByte, lsb, bitCount, aprIndex, aprBit]. Verified against a factory bank.
  var PACK = [
    [0,0,4,20,0],[0,4,4,13,0],[1,0,4,23,0],[1,4,4,21,0],[2,0,4,35,0],[2,4,4,33,0],
    [3,0,7,11,0],[4,0,7,12,0],[5,0,7,14,0],[6,0,7,15,0],[7,0,7,16,0],[8,0,7,17,0],
    [9,0,7,19,0],[10,0,7,18,0],[11,0,7,22,0],[12,0,7,24,0],[13,0,7,25,0],[14,0,7,26,0],
    [15,0,7,27,0],[16,0,7,28,0],[17,0,7,29,0],[18,0,7,30,0],[19,0,7,31,0],[20,0,7,32,0],
    [4,7,1,10,0],[5,7,1,0,1],[6,7,1,0,0],[7,7,1,1,1],[8,7,1,1,0],[9,7,1,2,1],[10,7,1,2,0],
    [11,7,1,5,2],[12,7,1,5,1],[13,7,1,5,0],[14,7,1,4,2],[15,7,1,4,1],[16,7,1,4,0],
    [17,7,1,3,1],[18,7,1,3,0],[19,7,1,9,1],[20,7,1,9,0],[21,7,1,6,1],[22,7,1,6,0],
    [23,7,1,7,1],[24,7,1,7,0],[25,7,1,8,1],[26,7,1,8,0],
    [27,6,2,34,0],[28,6,2,34,2],[29,6,2,34,4],[30,6,2,34,6]
  ];

  function clamp(v, max) { v = v | 0; return v < 0 ? 0 : v > max ? max : v; }

  function nameToBytes(name) {
    var out = [];
    name = (name || '').slice(0, 10);
    for (var i = 0; i < 10; i++) {
      var c = i < name.length ? NAME_CHARS.indexOf(name[i]) : 62;
      out.push(c < 0 ? 62 : c);
    }
    return out;
  }
  function bytesToName(b) {
    var s = '';
    for (var i = 0; i < b.length; i++) s += NAME_CHARS[b[i] & 0x3f] || ' ';
    return s.replace(/\s+$/, '');
  }
  function sanitizeName(name) {
    return bytesToName(nameToBytes(name));
  }

  function initParams() {
    var p = new Array(36).fill(0);
    p[2] = 0; p[3] = 1; p[4] = 0; p[5] = 0; p[6] = 1; p[9] = 1;
    p[14] = 0; p[16] = 127; p[22] = 100; p[24] = 60;
    p[26] = 0; p[27] = 127; p[28] = 40; p[29] = 100; p[30] = 60; p[31] = 90; p[32] = 30;
    p[34] = 40; p[35] = 2;
    return p;
  }

  function isOwn(m) {
    return m && m.length >= 6 && m[0] === 0xF0 && m[1] === ROLAND && m[4] === MODEL;
  }

  function ipr(channel, param, value) {
    return [0xF0, ROLAND, OP_IPR, channel & 0x0F, MODEL, LEVEL, GROUP, param & 0x7F, value & 0x7F, 0xF7];
  }

  function apr(channel, params, name) {
    var m = [0xF0, ROLAND, OP_APR, channel & 0x0F, MODEL, LEVEL, GROUP];
    for (var i = 0; i < 36; i++) m.push(clamp(params[i], PARAMS[i].max));
    m = m.concat(nameToBytes(name));
    m.push(0xF7);
    return m;
  }

  function parseAPR(m) {
    if (!isOwn(m) || m[2] !== OP_APR || m[5] !== LEVEL || m.length < 54) return null;
    var params = [];
    for (var i = 0; i < 36; i++) params.push(clamp(m[7 + i], PARAMS[i].max));
    return { name: bytesToName(m.slice(43, 53)), params: params, channel: m[3] & 0x0F };
  }

  function parseIPR(m) {
    if (!isOwn(m) || m[2] !== OP_IPR || m[5] !== LEVEL || m.length < 10) return null;
    var id = m[7];
    if (id > 35) return null;
    return { channel: m[3] & 0x0F, param: id, value: clamp(m[8], PARAMS[id].max) };
  }

  function unpackTone(packed) {
    var p = new Array(36).fill(0);
    PACK.forEach(function (f) {
      var v = (packed[f[0]] >> f[1]) & ((1 << f[2]) - 1);
      p[f[3]] |= v << f[4];
    });
    for (var i = 0; i < 36; i++) p[i] = clamp(p[i], PARAMS[i].max);
    var nb = [];
    for (var j = 21; j < 31; j++) nb.push(packed[j] & 0x3f);
    return { name: bytesToName(nb), params: p };
  }

  function packTone(params, name) {
    var packed = new Array(32).fill(0);
    PACK.forEach(function (f) {
      var v = (clamp(params[f[3]], PARAMS[f[3]].max) >> f[4]) & ((1 << f[2]) - 1);
      packed[f[0]] |= v << f[1];
    });
    var nb = nameToBytes(name);
    for (var i = 0; i < 10; i++) packed[21 + i] = (packed[21 + i] & 0xC0) | nb[i];
    return packed;
  }

  // Unpack the 4 tones carried in a BLD (start=9) or DAT (start=5) block.
  function tonesFromBlock(m, start) {
    var out = [];
    for (var t = 0; t < 4; t++) {
      var packed = [], off = start + t * 64;
      if (off + 64 > m.length) break;
      for (var i = 0; i < 64; i += 2) packed.push((m[off + i] & 0x0F) | ((m[off + i + 1] & 0x0F) << 4));
      out.push(unpackTone(packed));
    }
    return out;
  }

  // Build the 16 BLD messages for a 64-tone bank. Missing slots are init tones.
  function bankBLD(channel, tones) {
    var msgs = [];
    for (var b = 0; b < 16; b++) {
      var m = [0xF0, ROLAND, OP_BLD, channel & 0x0F, MODEL, LEVEL, GROUP, 0x00, b * 4];
      for (var t = 0; t < 4; t++) {
        var tone = tones[b * 4 + t] || { name: 'INIT', params: initParams() };
        packTone(tone.params, tone.name).forEach(function (byte) { m.push(byte & 0x0F, (byte >> 4) & 0x0F); });
      }
      m.push(0xF7);
      msgs.push(m);
    }
    return msgs;
  }

  function splitSysex(bytes) {
    var out = [], cur = null;
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (b === 0xF0) cur = [b];
      else if (cur) { cur.push(b); if (b === 0xF7) { out.push(cur); cur = null; } }
    }
    return out;
  }

  // Parse any .syx byte stream into a list of tones {name, params}.
  function parseSyx(bytes) {
    var tones = [];
    splitSysex(bytes).forEach(function (m) {
      if (!isOwn(m)) return;
      if (m[2] === OP_APR) { var t = parseAPR(m); if (t) tones.push({ name: t.name, params: t.params }); }
      else if (m[2] === OP_BLD && m[5] === LEVEL && m.length >= 266) tones.push.apply(tones, tonesFromBlock(m, 9));
      else if (m[2] === 0x42 && m.length === 263) tones.push.apply(tones, tonesFromBlock(m, 5));
    });
    return tones;
  }

  var api = {
    PARAMS: PARAMS, KEY: KEY, NAME_CHARS: NAME_CHARS,
    ipr: ipr, apr: apr, parseAPR: parseAPR, parseIPR: parseIPR,
    packTone: packTone, unpackTone: unpackTone, bankBLD: bankBLD,
    parseSyx: parseSyx, splitSysex: splitSysex, initParams: initParams,
    sanitizeName: sanitizeName, nameToBytes: nameToBytes, bytesToName: bytesToName
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Juno = api;
})(this);
