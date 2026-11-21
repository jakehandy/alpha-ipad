/* Canvas drawings for waveforms, filter response, envelope and LFO.
   Waveform shapes are visual sketches of the Alpha Juno wave options, not
   sample-accurate captures. */
(function (root) {
  'use strict';
  var P = function (id) { return id; };

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function setup(canvas) {
    var dpr = root.devicePixelRatio || 1;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function grid(ctx, w, h, cols, rows) {
    ctx.strokeStyle = css('--viz-grid'); ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 1; i < cols; i++) { var x = Math.round(w * i / cols) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (var j = 1; j < rows; j++) { var y = Math.round(h * j / rows) + 0.5; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  }

  // ---- waveforms -------------------------------------------------------
  function frac(x) { return x - Math.floor(x); }
  function duty(pw) { return 0.5 - (pw / 127) * 0.44; }

  function pulseWave(idx, t, pw) {
    var ph = frac(t);
    if (idx === 1) return ph < 0.5 ? 1 : -1;
    if (idx === 2) return ph < duty(pw) ? 1 : -1;
    if (idx === 3) return 0.55 * (ph < duty(pw) ? 1 : -1) + 0.45 * (1 - 2 * ph);
    return 0;
  }
  function sawWave(idx, t, pw) {
    var ph = frac(t), s = 1 - 2 * ph;
    if (idx === 1) return s;
    if (idx === 2) return ph < duty(pw) * 2 ? s : -1 + 2 * duty(pw) * 2;
    if (idx === 3) { var p2 = frac(2 * ph); return (1 - 2 * p2) * (ph < 0.5 ? 1 : 0.5); }
    if (idx === 4) return (s - (ph < 0.5 ? 0.5 : -0.5)) / 1.5 * 2 / 1.33;
    if (idx === 5) return (s + 0.6 * (1 - 2 * frac(2 * ph))) / 1.6;
    return 0;
  }
  function subWave(idx, t) {
    var a = frac(t / 2), b = frac(t / 4);
    if (idx === 1) return a < 0.5 ? 1 : -1;
    if (idx === 2) return a < 0.25 ? 1 : -1;
    if (idx === 3) return b < 0.5 ? 1 : -1;
    if (idx === 4) return b < 0.25 ? 1 : -1;
    if (idx === 5) return ((a < 0.5 ? 1 : -1) + (b < 0.5 ? 1 : -1)) / 2;
    return 0;
  }

  function drawWave(canvas, p) {
    var s = setup(canvas), ctx = s.ctx, w = s.w, h = s.h;
    grid(ctx, w, h, 4, 2);
    var cycles = 4, N = Math.max(200, Math.floor(w * 1.5));
    var parts = [
      { on: p[3] > 0, f: function (t) { return pulseWave(p[3], t, p[14]); }, wgt: 1, col: css('--c-dco') },
      { on: p[4] > 0, f: function (t) { return sawWave(p[4], t, p[14]); }, wgt: 1, col: css('--c-vcf') },
      { on: p[5] > 0 && p[7] > 0, f: function (t) { return subWave(p[5], t); }, wgt: p[7] / 3, col: css('--c-env') },
      { on: p[8] > 0, f: function () { return Math.random() * 2 - 1; }, wgt: p[8] / 3 * 0.8, col: css('--fg-dim') }
    ];
    var total = parts.reduce(function (a, q) { return a + (q.on ? q.wgt : 0); }, 0);
    var mid = h / 2, amp = h * 0.4;
    // components, faint
    parts.forEach(function (q) {
      if (!q.on || q === parts[3]) return;
      ctx.globalAlpha = 0.28; ctx.strokeStyle = q.col; ctx.lineWidth = 1.2; ctx.beginPath();
      for (var i = 0; i <= N; i++) { var t = i / N * cycles, y = mid - q.f(t) * amp * 0.9; i ? ctx.lineTo(i / N * w, y) : ctx.moveTo(0, y); }
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    if (!total) { label(ctx, w, h, 'no oscillator'); return; }
    ctx.strokeStyle = css('--fg'); ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
    for (var i = 0; i <= N; i++) {
      var t = i / N * cycles, v = 0;
      parts.forEach(function (q) { if (q.on) v += q.f(t) * q.wgt; });
      var y = mid - (v / total) * amp;
      i ? ctx.lineTo(i / N * w, y) : ctx.moveTo(0, y);
    }
    ctx.stroke();
  }

  function waveIcon(canvas, kind, idx) {
    var s = setup(canvas), ctx = s.ctx, w = s.w, h = s.h;
    ctx.strokeStyle = 'currentColor';
    ctx.strokeStyle = getComputedStyle(canvas).color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    if (idx === 0) { ctx.beginPath(); ctx.moveTo(w * 0.3, h * 0.3); ctx.lineTo(w * 0.7, h * 0.7); ctx.moveTo(w * 0.7, h * 0.3); ctx.lineTo(w * 0.3, h * 0.7); ctx.stroke(); return; }
    var f = kind === 'pulse' ? function (t) { return pulseWave(idx, t, 70); }
      : kind === 'saw' ? function (t) { return sawWave(idx, t, 70); }
      : function (t) { return subWave(idx, t); };
    var cycles = kind === 'sub' ? 4 : 2, N = 120;
    ctx.beginPath();
    for (var i = 0; i <= N; i++) { var y = h / 2 - f(i / N * cycles + 0.0001) * h * 0.34; i ? ctx.lineTo(3 + i / N * (w - 6), y) : ctx.moveTo(3, y); }
    ctx.stroke();
  }

  function label(ctx, w, h, text) {
    ctx.fillStyle = css('--fg-dim'); ctx.font = '12px ' + css('--font-ui');
    ctx.textAlign = 'center'; ctx.fillText(text, w / 2, h / 2 + 4); ctx.textAlign = 'left';
  }

  // ---- filter ----------------------------------------------------------
  var FMIN = 20, FMAX = 20000;
  function cutoffHz(v) { return 16 * Math.pow(2, Math.max(0, Math.min(127, v)) / 127 * 10.3); }
  function lpMag(f, fc, res) {
    var k = res / 127 * 3.85, w = f / fc, re = 1, im = 0;
    for (var i = 0; i < 4; i++) { var r = re - im * w; im = im + re * w; re = r; }
    re += k;
    return (1 + k * 0.55) / Math.sqrt(re * re + im * im);
  }
  function hpMag(f, mode) {
    if (mode === 0) return 1 + 0.9 / (1 + Math.pow(f / 90, 2));
    if (mode === 1) return 1;
    var fc = mode === 2 ? 240 : 800, w = f / fc;
    return w / Math.sqrt(1 + w * w);
  }
  function filterPath(ctx, w, h, cutV, res, hpf) {
    ctx.beginPath();
    for (var i = 0; i <= w; i += 2) {
      var f = FMIN * Math.pow(FMAX / FMIN, i / w);
      var db = 20 * Math.log10(Math.max(1e-6, lpMag(f, cutoffHz(cutV), res) * hpMag(f, hpf)));
      var y = dbY(db, h);
      i ? ctx.lineTo(i, y) : ctx.moveTo(i, y);
    }
  }
  function dbY(db, h) { var top = 18, bot = -48; db = Math.max(bot, Math.min(top, db)); return (top - db) / (top - bot) * h; }

  function drawFilter(canvas, p) {
    var s = setup(canvas), ctx = s.ctx, w = s.w, h = s.h;
    grid(ctx, w, h, 3, 4);
    var cut = p[16], res = p[17], hpf = p[9];
    var inv = p[1] === 1 || p[1] === 3;
    var envTo = Math.max(0, Math.min(127, cut + (inv ? -1 : 1) * p[19] * (p[27] / 127) * 0.85));
    var lfo = p[18] * 0.35;
    // LFO sweep band
    if (lfo > 0.5) {
      ctx.fillStyle = css('--c-lfo'); ctx.globalAlpha = 0.14;
      for (var d = -lfo; d <= lfo; d += Math.max(1, lfo / 6)) { filterPath(ctx, w, h, cut + d, res, hpf); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    // envelope target
    if (p[19] > 0 && Math.abs(envTo - cut) > 0.5) {
      ctx.setLineDash([5, 4]); ctx.strokeStyle = css('--c-env'); ctx.lineWidth = 1.5;
      filterPath(ctx, w, h, envTo, res, hpf); ctx.stroke(); ctx.setLineDash([]);
    }
    // main curve + fill
    var col = css('--c-vcf');
    filterPath(ctx, w, h, cut, res, hpf); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    var g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, col + '55'); g.addColorStop(1, col + '05');
    ctx.fillStyle = g; ctx.fill();
    filterPath(ctx, w, h, cut, res, hpf); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    // 0 dB line + labels
    ctx.strokeStyle = css('--viz-grid-strong'); ctx.beginPath(); var y0 = dbY(0, h); ctx.moveTo(0, y0); ctx.lineTo(w, y0); ctx.stroke();
    ctx.fillStyle = css('--fg-dim'); ctx.font = '10px ' + css('--font-mono');
    [100, 1000, 10000].forEach(function (f) { var x = Math.log(f / FMIN) / Math.log(FMAX / FMIN) * w; ctx.fillText(f >= 1000 ? f / 1000 + 'k' : f, x + 3, h - 4); });
    var hz = cutoffHz(cut);
    ctx.fillStyle = css('--fg'); ctx.textAlign = 'right';
    ctx.fillText('fc ' + (hz >= 1000 ? (hz / 1000).toFixed(1) + 'kHz' : Math.round(hz) + 'Hz'), w - 6, 13);
    ctx.textAlign = 'left';
  }

  // ---- envelope --------------------------------------------------------
  var SEG = 1.0, SUS = 0.55, TOTAL = 4 * SEG + SUS;
  function segW(T) { return 0.03 + Math.pow(T / 127, 1.6) * (SEG - 0.03); }
  function segT(wu) { var x = (Math.max(0.03, Math.min(SEG, wu)) - 0.03) / (SEG - 0.03); return Math.round(Math.pow(x, 1 / 1.6) * 127); }
  var PAD = 10;
  function envPoints(p, w, h, pad) {
    var PAD = pad == null ? 10 : pad;
    var sx = (w - PAD * 2) / TOTAL, ih = h - PAD * 2;
    var Y = function (L) { return PAD + ih * (1 - L / 127); };
    var x0 = PAD, x1 = x0 + segW(p[26]) * sx, x2 = x1 + segW(p[28]) * sx, x3 = x2 + segW(p[30]) * sx, x3b = x3 + SUS * sx, x4 = x3b + segW(p[32]) * sx;
    return { sx: sx, Y: Y, ih: ih, pts: [[x0, Y(0)], [x1, Y(p[27])], [x2, Y(p[29])], [x3, Y(p[31])], [x3b, Y(p[31])], [x4, Y(0)]] };
  }
  function drawEnv(canvas, p, active, mini) {
    var s = setup(canvas), ctx = s.ctx, w = s.w, h = s.h;
    if (!mini) grid(ctx, w, h, 9, 4);
    var e = envPoints(p, w, h, mini ? 3 : PAD), pts = e.pts, col = css('--c-env');
    if (mini) {
      ctx.beginPath(); pts.forEach(function (q, i) { i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
      return;
    }
    // key-off marker
    ctx.strokeStyle = css('--viz-grid-strong'); ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(pts[4][0], PAD); ctx.lineTo(pts[4][0], h - PAD); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = css('--fg-dim'); ctx.font = '10px ' + css('--font-mono'); ctx.fillText('key off', pts[4][0] + 4, PAD + 10);
    ctx.beginPath(); pts.forEach(function (q, i) { i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
    var g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, col + '50'); g.addColorStop(1, col + '05');
    ctx.lineTo(pts[5][0], h - PAD); ctx.lineTo(pts[0][0], h - PAD); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); pts.forEach(function (q, i) { i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    var names = [null, '1', '2', '3', null, '4'];
    [1, 2, 3, 5].forEach(function (i) {
      var q = pts[i];
      ctx.beginPath(); ctx.arc(q[0], q[1], active === i ? 9 : 6.5, 0, Math.PI * 2);
      ctx.fillStyle = active === i ? col : css('--panel'); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke();
      ctx.fillStyle = active === i ? css('--panel') : css('--fg'); ctx.font = 'bold 9px ' + css('--font-mono'); ctx.textAlign = 'center';
      ctx.fillText(names[i], q[0], q[1] + 3); ctx.textAlign = 'left';
    });
  }
  // Pointer -> envelope edit. Returns {handle, changes:[[paramId,value],...]}
  function envHit(canvas, p, x, y) {
    var e = envPoints(p, canvas.clientWidth, canvas.clientHeight), best = null, bd = 30 * 30;
    [1, 2, 3, 5].forEach(function (i) { var dx = e.pts[i][0] - x, dy = e.pts[i][1] - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function envDrag(canvas, p, handle, x, y) {
    var e = envPoints(p, canvas.clientWidth, canvas.clientHeight);
    var L = Math.round(Math.max(0, Math.min(127, (1 - (y - PAD) / e.ih) * 127)));
    var prev = handle === 5 ? e.pts[4][0] : e.pts[handle - 1][0];
    var T = segT((x - prev) / e.sx);
    if (handle === 1) return [[26, T], [27, L]];
    if (handle === 2) return [[28, T], [29, L]];
    if (handle === 3) return [[30, T], [31, L]];
    return [[32, T]];
  }

  // ---- LFO -------------------------------------------------------------
  function drawLfo(canvas, p) {
    var s = setup(canvas), ctx = s.ctx, w = s.w, h = s.h;
    grid(ctx, w, h, 4, 2);
    var cycles = 1.2 + Math.pow(p[24] / 127, 1.5) * 14, delay = p[25] / 127 * 0.75, mid = h / 2, amp = h * 0.38;
    if (delay > 0.01) {
      ctx.fillStyle = css('--c-lfo'); ctx.globalAlpha = 0.12; ctx.fillRect(0, 0, delay * w, h); ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = css('--c-lfo'); ctx.lineWidth = 2; ctx.beginPath();
    for (var i = 0; i <= w; i++) {
      var t = i / w, a = delay > 0.01 ? Math.min(1, t / delay) : 1;
      var ph = frac(t * cycles), tri = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
      var y = mid - tri * amp * a;
      i ? ctx.lineTo(i, y) : ctx.moveTo(i, y);
    }
    ctx.stroke();
  }

  root.Viz = { envPoints: envPoints, drawWave: drawWave, waveIcon: waveIcon, drawFilter: drawFilter, drawEnv: drawEnv, envHit: envHit, envDrag: envDrag, drawLfo: drawLfo, cutoffHz: cutoffHz };
})(this);
