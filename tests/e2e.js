// Headless check with a fake MIDI port. Run: node tests/e2e.js [outDir] [bank.syx]
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || '.';
const bank = process.argv[3];
const MOCK = `
  window.__sent = [];
  const listeners = [];
  const output = { id: 'o1', name: 'USB MIDI to Alpha Juno', send: d => window.__sent.push(Array.from(d)) };
  const input = { id: 'i1', name: 'USB MIDI from Alpha Juno', onmidimessage: null };
  window.__rx = bytes => input.onmidimessage && input.onmidimessage({ data: new Uint8Array(bytes) });
  navigator.requestMIDIAccess = () => Promise.resolve({
    outputs: new Map([['o1', output]]), inputs: new Map([['i1', input]]), onstatechange: null });
`;
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(MOCK);
  await page.goto('file://' + path.resolve(__dirname, '../web/index.html'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + '/panel.png' });

  // Drag the cutoff slider down
  const tr = await page.locator('.slider[data-param="16"] .track').boundingBox();
  await page.mouse.move(tr.x + tr.width / 2, tr.y + 20); await page.mouse.down();
  await page.mouse.move(tr.x + tr.width / 2, tr.y + tr.height * 0.7, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(100);
  const sent = await page.evaluate(() => window.__sent);
  const iprs = sent.filter(m => m[2] === 0x36 && m[7] === 16);
  console.log('cutoff IPRs sent:', iprs.length, 'last:', iprs.at(-1) && iprs.at(-1).map(x => x.toString(16)).join(' '));
  if (!iprs.length) throw new Error('no IPR sent');

  // Drag envelope point 1 to the right and down
  const env = await page.locator('.sec-env canvas.viz').boundingBox();
  const p1 = await page.evaluate(() => { const c = document.querySelector('.sec-env canvas.viz'); return Viz.envPoints(AlphaPad.current.params, c.clientWidth, c.clientHeight).pts[1]; });
  const before = await page.evaluate(() => AlphaPad.current.params.slice(26, 28));
  await page.mouse.move(env.x + p1[0], env.y + p1[1]); await page.mouse.down();
  await page.mouse.move(env.x + p1[0] + 25, env.y + p1[1] + 20, { steps: 5 }); await page.mouse.up();
  const after = await page.evaluate(() => AlphaPad.current.params.slice(26, 28));
  console.log('env T1/L1 before', before, 'after', after);
  if (after[0] <= before[0] || after[1] >= before[1]) throw new Error('env drag did not edit T1/L1');

  const fit = await page.evaluate(() => { const p = document.querySelector('#panel'); return [p.scrollHeight, p.clientHeight]; });
  console.log('panel scrollHeight/clientHeight at 1180x820:', fit);

  // Synth sends an IPR -> UI follows
  await page.evaluate(() => window.__rx([0xF0,0x41,0x36,0x00,0x23,0x20,0x01,17,99,0xF7]));
  console.log('reso after rx IPR:', await page.evaluate(() => window.AlphaPad.current.params[17]));

  // Send button -> APR
  await page.click('#btnSend');
  const apr = (await page.evaluate(() => window.__sent)).filter(m => m[2] === 0x35).at(-1);
  console.log('APR length', apr.length);

  // Library
  await page.click('#btnLibrary'); await page.waitForTimeout(300);
  await page.screenshot({ path: out + '/library.png' });
  await page.click('#toneList li:nth-child(2)'); await page.waitForTimeout(200);
  console.log('loaded:', await page.evaluate(() => window.AlphaPad.current.name));
  if (bank) {
    await page.setInputFiles('#fileIn', bank); await page.waitForTimeout(400);
    console.log('collections:', await page.evaluate(() => window.AlphaPad.library.collections.map(c => c.name + ':' + c.tones.length).join(', ')));
    await page.screenshot({ path: out + '/imported.png' });
  }
  await page.click('#drawerClose'); await page.waitForTimeout(300);
  await page.click('#btnMidi'); await page.waitForTimeout(200);
  await page.screenshot({ path: out + '/midi.png' });
  await page.click('#modalBtns button');

  // Portrait + phone
  await page.setViewportSize({ width: 820, height: 1180 }); await page.waitForTimeout(300);
  await page.screenshot({ path: out + '/portrait.png' });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  console.log('phone horizontal overflow:', overflow);
  await page.screenshot({ path: out + '/phone.png' });

  // Native bridge path (what the iOS app injects instead of Web MIDI)
  const np = await b.newPage({ viewport: { width: 1180, height: 820 } });
  np.on('pageerror', e => errors.push('native: ' + e.message));
  await np.addInitScript(() => {
    window.__posted = [];
    window.__alphaNative = true;
    window.__alphaStore = JSON.stringify({ settings: { channel: 2 }, library: { collections: [{ id: 'x', name: 'Saved', tones: [{ id: 't', name: 'FromDisk', params: new Array(36).fill(5) }] }] } });
    window.webkit = { messageHandlers: { alphapad: { postMessage: m => window.__posted.push(m) } } };
  });
  await np.goto('file://' + path.resolve(__dirname, '../web/index.html'));
  await np.waitForTimeout(300);
  await np.evaluate(() => AlphaNative.ports({ inputs: [{ id: '11', name: 'UM-ONE' }], outputs: [{ id: '22', name: 'UM-ONE' }] }));
  await np.evaluate(() => AlphaNative.midi('11', [0xF0,0x41,0x36,0x02,0x23,0x20,0x01,16,7,0xF7]));
  await np.click('#btnSend'); await np.waitForTimeout(1000);
  const nat = await np.evaluate(() => ({ posted: window.__posted.map(m => m.type + (m.dest ? ':' + m.dest : '') + (m.data ? ':' + m.data.length : '')), cutoff: AlphaPad.current.params[16], name: AlphaPad.current.name }));
  console.log('native bridge:', JSON.stringify(nat));
  if (!nat.posted.includes('midiSend:22:54') || nat.cutoff !== 7 || !nat.posted.includes('store')) throw new Error('native bridge path broken');

  console.log('errors:', errors.length ? errors : 'none');
  await b.close();
  if (errors.length) process.exit(1);
})();
