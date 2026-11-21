/* Original starter tones (not Roland factory data). */
(function (root) {
  'use strict';
  var J = root.Juno || (typeof require !== 'undefined' ? require('./juno.js') : null);
  var BASE = {
    range: 1, hpf: 1, cutoff: 80, vcaLevel: 110, vcfKey: 8, bend: 2, chorusRate: 50, lfoRate: 60,
    t1: 0, l1: 127, t2: 40, l2: 100, t3: 50, l3: 90, t4: 40
  };
  var DEFS = [
    ['Glass Pad',  { pulse: 2, saw: 1, pw: 60, pwmRate: 30, cutoff: 70, res: 20, vcfEnv: 40, chorus: 1, t1: 80, l1: 127, t2: 80, l2: 100, t3: 60, l3: 90, t4: 80, lfoDelay: 60, dcoLfo: 6, lfoRate: 50 }],
    ['Rave Hoov',  { pulse: 2, saw: 3, pw: 90, pwmRate: 70, range: 2, chorus: 1, chorusRate: 100, dcoEnvMode: 1, dcoEnv: 50, cutoff: 100, res: 10, t1: 10, l1: 127, t2: 60, l2: 80, t3: 40, l3: 90, t4: 60, bend: 12, dcoLfo: 10, lfoRate: 70 }],
    ['Sub Bass',   { pulse: 1, sub: 1, subLevel: 3, range: 2, cutoff: 35, res: 40, vcfEnv: 70, vcfEnvMode: 2, vcaEnvMode: 2, t1: 0, l1: 127, t2: 50, l2: 40, t3: 40, l3: 30, t4: 20 }],
    ['Acid Line',  { saw: 1, range: 2, cutoff: 25, res: 110, vcfEnv: 95, vcaEnvMode: 1, t1: 0, l1: 127, t2: 35, l2: 30, t3: 40, l3: 10, t4: 15 }],
    ['Brass Stab', { saw: 1, cutoff: 45, res: 15, vcfEnv: 85, vcfEnvMode: 2, chorus: 1, t1: 25, l1: 127, t2: 55, l2: 70, t3: 50, l3: 70, t4: 30 }],
    ['Warm Strng', { saw: 1, pulse: 2, pw: 50, pwmRate: 40, cutoff: 65, res: 10, vcfEnv: 25, chorus: 1, chorusRate: 60, t1: 85, l1: 110, t2: 70, l2: 127, t3: 60, l3: 110, t4: 75, dcoLfo: 5, lfoDelay: 70 }],
    ['Pluck Keys', { pulse: 1, saw: 1, cutoff: 40, res: 35, vcfEnv: 80, vcfEnvMode: 2, vcaEnvMode: 2, chorus: 1, t1: 0, l1: 127, t2: 45, l2: 40, t3: 55, l3: 0, t4: 45 }],
    ['Bell Tower', { pulse: 3, saw: 4, sub: 4, subLevel: 2, range: 0, cutoff: 110, res: 30, chorus: 1, chorusRate: 30, t1: 0, l1: 127, t2: 0, l2: 110, t3: 90, l3: 0, t4: 85 }],
    ['Noise Wind', { noise: 3, cutoff: 60, res: 90, vcfLfo: 70, lfoRate: 25, t1: 90, l1: 127, t2: 60, l2: 100, t3: 80, l3: 100, t4: 90 }],
    ['PWM Lead',   { pulse: 2, pw: 80, pwmRate: 75, cutoff: 85, res: 30, vcfEnv: 30, t1: 5, l1: 127, t2: 50, l2: 100, t3: 60, l3: 100, t4: 30, dcoLfo: 12, lfoDelay: 80, lfoRate: 75, dcoAfter: 6 }],
    ['Drawbars',   { pulse: 3, sub: 5, subLevel: 3, cutoff: 100, vcaEnvMode: 1, chorus: 1, chorusRate: 90 }],
    ['Sync Sweep', { saw: 5, pulse: 3, cutoff: 50, res: 60, vcfEnv: 60, vcfLfo: 30, lfoRate: 20, t1: 100, l1: 127, t2: 100, l2: 60, t3: 80, l3: 80, t4: 70 }],
    ['Dark Drone', { saw: 2, pulse: 2, sub: 3, subLevel: 2, range: 3, hpf: 0, cutoff: 30, res: 70, vcfLfo: 40, lfoRate: 10, chorus: 1, chorusRate: 20, t1: 110, l1: 127, t2: 110, l2: 127, t3: 110, l3: 127, t4: 110 }],
    ['Zap Perc',   { pulse: 1, dcoEnv: 100, cutoff: 90, t1: 0, l1: 127, t2: 20, l2: 0, t3: 20, l3: 0, t4: 20 }],
    ['Soft Choir', { pulse: 2, saw: 2, pw: 30, pwmRate: 20, hpf: 2, cutoff: 55, res: 45, chorus: 1, chorusRate: 70, t1: 75, l1: 127, t2: 0, l2: 127, t3: 0, l3: 127, t4: 70, dcoLfo: 4, lfoRate: 55, lfoDelay: 80 }],
    ['Funk Clav',  { pulse: 1, pw: 100, hpf: 2, cutoff: 50, res: 60, vcfEnv: 90, vcfEnvMode: 2, vcaEnvMode: 2, t1: 0, l1: 127, t2: 25, l2: 0, t3: 30, l3: 0, t4: 10 }]
  ];
  function build(over) {
    var p = new Array(36).fill(0);
    var all = Object.assign({}, BASE, over);
    Object.keys(all).forEach(function (k) { p[J.KEY[k]] = all[k]; });
    return p;
  }
  var STARTER = DEFS.map(function (d) { return { name: d[0], params: build(d[1]) }; });
  if (typeof module !== 'undefined' && module.exports) module.exports = STARTER;
  else root.STARTER_TONES = STARTER;
})(this);
