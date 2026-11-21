// Run: node tests/juno.test.js [path/to/bank.syx]
const assert = require('assert');
const J = require('../web/js/juno.js');
const fs = require('fs');

// IPR format
assert.deepStrictEqual(J.ipr(2, 16, 99), [0xF0,0x41,0x36,0x02,0x23,0x20,0x01,16,99,0xF7]);
assert.deepStrictEqual(J.parseIPR(J.ipr(2, 16, 99)), { channel: 2, param: 16, value: 99 });

// APR round trip
const p = J.initParams(); p[16] = 42; p[35] = 7;
const m = J.apr(0, p, 'Test-Tone1');
assert.strictEqual(m.length, 54);
const back = J.parseAPR(m);
assert.strictEqual(back.name, 'Test-Tone1');
assert.deepStrictEqual(back.params, p);

// Pack round trip with random legal values
for (let n = 0; n < 500; n++) {
  const r = J.PARAMS.map(q => Math.floor(Math.random() * (q.max + 1)));
  const t = J.unpackTone(J.packTone(r, 'Rnd ' + n));
  assert.deepStrictEqual(t.params, r);
  assert.strictEqual(t.name, 'Rnd ' + n);
}

// Bank round trip
const tones = Array.from({ length: 64 }, (_, i) => ({ name: 'P' + i, params: J.PARAMS.map(q => (i * 7 + q.id) % (q.max + 1)) }));
const bank = J.bankBLD(0, tones);
assert.strictEqual(bank.length, 16);
bank.forEach(b => assert.strictEqual(b.length, 266));
const parsed = J.parseSyx(bank.flat());
assert.strictEqual(parsed.length, 64);
parsed.forEach((t, i) => { assert.strictEqual(t.name, tones[i].name); assert.deepStrictEqual(t.params, tones[i].params); });

// Optional: real bank file must re-encode byte for byte
const file = process.argv[2];
if (file) {
  const bytes = [...fs.readFileSync(file)];
  const t = J.parseSyx(bytes);
  assert.strictEqual(t.length, 64);
  const ch = bytes[3] & 0x0f;
  assert.deepStrictEqual(J.bankBLD(ch, t).flat(), bytes, 'bank re-encode differs');
  console.log('real bank re-encodes byte-exact:', t.slice(0, 4).map(x => x.name).join(', '), '...');
}
console.log('all juno tests passed');
