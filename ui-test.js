'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./dom-harness.js');
const LG = require('./logic.js');
function bench(options) { const h = boot(__dirname, options); assert.deepEqual(h.errors, []); return h; }
function preset(h, id) { h.get('presetSelect').value = id; h.event(h.get('presetSelect'), 'change'); }
function change(h, id, value) { h.get(id).value = value; h.event(h.get(id), 'change'); }
function cell(h, m) { return h.get('kmapWrap').querySelector('[data-minterm="' + m + '"]'); }

test('index scripts compile and boot with every real DOM binding present', () => {
  const h = bench();
  assert.match(h.get('verificationBadges').textContent, /RTL round trip: PASS/);
  assert.match(h.get('verificationBadges').textContent, /10 \/ 16 care states/);
  assert.equal(h.get('kmapWrap').querySelectorAll('.kmap-cell').length, 16);
  assert.equal(h.get('presetSelect').value, 'sevenSegmentDecoder');
  assert.equal(h.get('downloadModule').disabled, false);
  h.dispose();
});
test('startup also works with DOMContentLoaded and unavailable storage', () => {
  const h = bench({ storageBlocked: true, beforeBoot: ({ document }) => { document.readyState = 'loading'; } });
  assert.match(h.get('moduleCode').textContent, /module seg7_a/); h.dispose();
});
test('each showcase button loads a fully verified function in one click', () => {
  const h = bench();
  for (const button of h.document.querySelectorAll('[data-preset]')) {
    button.click();
    assert.match(h.get('verificationBadges').textContent, /RTL round trip: PASS/);
    assert.equal(h.get('exprStatus').className.includes('is-error'), false);
  }
  assert.deepEqual(h.errors, []); h.dispose();
});
test('all engine presets load through the real select handler', () => {
  const h = bench();
  for (const item of LG.listPresets()) { preset(h, item.id); assert.equal(h.get('downloadModule').disabled, false, item.id); }
  h.dispose();
});
test('map cell cycles 0, 1, X, 0 and keeps keyboard focus after redraw', () => {
  const h = bench();
  for (const value of ['1', 'X', '0']) { cell(h, 1).click(); assert.match(cell(h, 1).getAttribute('aria-label'), new RegExp('value ' + value)); assert.equal(h.document.activeElement, cell(h, 1)); }
  h.dispose();
});
test('map arrow keys traverse the Gray-code torus without modifying its function', () => {
  const h = bench(); const before = h.get('mintermInput').value;
  cell(h, 0).focus(); h.key(cell(h, 0), 'ArrowLeft'); assert.equal(h.document.activeElement, cell(h, 2));
  h.key(cell(h, 2), 'ArrowUp'); assert.equal(h.document.activeElement, cell(h, 10));
  assert.equal(h.get('mintermInput').value, before); h.dispose();
});
test('native Enter activation changes exactly one map state', () => {
  const h = bench(); cell(h, 1).focus(); h.key(cell(h, 1), 'Enter');
  assert.match(cell(h, 1).getAttribute('aria-label'), /value 1/); h.dispose();
});
test('signal toggles and waveform inspection update the same live vector', () => {
  const h = bench(); h.get('probeInputs').querySelector('[data-input="0"]').click();
  assert.match(h.get('probeVector').textContent, /Vector 8/);
  const hit = h.get('waveformSvg').querySelector('[data-vector="3"]'); hit.focus();
  assert.match(h.get('probeVector').textContent, /Vector 3/);
  assert.match(h.get('probeReadout').textContent, /exported RTL = 1/); h.dispose();
});
test('hazard showcase explains the missing consensus term', () => {
  const h = bench(); preset(h, 'staticHazard');
  assert.match(h.get('hazardReadout').textContent, /static-1/);
  assert.match(h.get('hazardReadout').textContent, /B & C/);
  assert.match(h.get('hazardReadout').textContent, /m3 to m7/); h.dispose();
});
test('carry showcase sweeps all 512 inputs and exports the correctly wired upper slice', () => {
  const h = bench(); preset(h, 'carryLookahead4Bit');
  assert.match(h.get('netlistStatus').textContent, /512 vectors/);
  assert.match(h.get('netlistStatus').textContent, /Arithmetic oracle: PASS/);
  assert.match(h.get('moduleFilename').textContent, /upper_slice/);
  const expected = [];
  for (let m = 0; m < 16; m++) { const a = ((m >> 3) & 1) * 2 + ((m >> 1) & 1); const b = ((m >> 2) & 1) * 2 + (m & 1); if (a + b + 1 >= 4) expected.push(m); }
  assert.deepEqual(LG.parseMintermList(h.get('mintermInput').value, 4), expected); h.dispose();
});
test('editing an ALU preset removes all stale netlist waveform channels', () => {
  const h = bench(); preset(h, 'alu4BitSlice');
  assert.match(h.get('waveformSvg').textContent, /net:/); cell(h, 0).click();
  assert.doesNotMatch(h.get('waveformSvg').textContent, /net:/);
  assert.equal(h.get('presetNetlist').hidden, true); h.dispose();
});
test('invalid minterms produce a visible error and disable stale exports', () => {
  const h = bench(); change(h, 'mintermInput', '1, 999');
  assert.equal(h.get('mintermInput').getAttribute('aria-invalid'), 'true');
  assert.equal(h.get('downloadModule').disabled, true);
  assert.match(h.get('exprStatus').textContent, /out of range/);
  change(h, 'formSelect', 'POS'); assert.equal(h.get('downloadModule').disabled, true);
  h.get('clearAll').click(); assert.equal(h.get('downloadModule').disabled, false); h.dispose();
});
test('overlapping care sets are rejected without silently dropping states', () => {
  const h = bench(); const before = h.get('moduleCode').textContent;
  change(h, 'dontCareInput', '0'); assert.equal(h.get('downloadTb').disabled, true);
  assert.match(h.get('exprStatus').textContent, /cannot also/);
  assert.equal(h.get('moduleCode').textContent, before); h.dispose();
});
test('malformed and case-duplicate input names are caught by UI validation', () => {
  const h = bench();
  for (const names of ['A,B', 'A,a,C,D', 'A,B,C,9x']) { change(h, 'varNames', names); assert.equal(h.get('downloadModule').disabled, true); }
  change(h, 'varNames', 'P,Q,R,S'); assert.equal(h.get('downloadModule').disabled, false); h.dispose();
});
test('expression submission uses prefix NOT correctly and clears stale preset state', () => {
  const h = bench(); h.get('exprInput').value = 'A !B'; h.key(h.get('exprInput'), 'Enter');
  assert.deepEqual(LG.parseMintermList(h.get('mintermInput').value, 4), [8, 9, 10, 11]);
  assert.equal(h.get('dontCareInput').value, ''); h.dispose();
});
test('invalid expressions cannot be downloaded as the previous valid circuit', () => {
  const h = bench(); h.get('exprInput').value = 'A &'; h.get('exprApply').click();
  assert.equal(h.get('downloadProof').disabled, true); assert.equal(h.get('exprInput').getAttribute('aria-invalid'), 'true');
  preset(h, 'majorityVoter'); assert.equal(h.get('downloadProof').disabled, false); h.dispose();
});
test('SOP and POS changes produce checked, distinct Verilog exports', () => {
  const h = bench(); preset(h, 'grayCodeConverter'); const sop = h.get('moduleCode').textContent;
  change(h, 'formSelect', 'POS'); assert.notEqual(h.get('moduleCode').textContent, sop);
  assert.match(h.get('verificationBadges').textContent, /RTL round trip: PASS/); h.dispose();
});
test('theme and reference buttons maintain their accessibility states', () => {
  const h = bench(); assert.equal(h.document.documentElement.getAttribute('data-theme'), 'dark');
  h.get('themeToggle').click(); assert.equal(h.document.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(h.get('themeToggle').getAttribute('aria-pressed'), 'false');
  h.get('helpToggle').click(); assert.equal(h.get('helpPanel').hidden, false); assert.equal(h.get('helpToggle').getAttribute('aria-expanded'), 'true'); h.dispose();
});
test('download handlers emit the actual module, testbench and parseable proof JSON', async () => {
  const h = bench(); h.get('downloadModule').click(); h.get('downloadTb').click(); h.get('downloadProof').click();
  assert.equal(h.document.downloads.length, 3);
  const files = await Promise.all(h.document.downloads.map(async item => ({ name: item.filename, text: await h.blobs.get(item.href).text() })));
  assert.match(files[0].text, /module seg7_a/); assert.match(files[1].text, /ALL 16 VECTORS PASS/);
  const proof = JSON.parse(files[2].text); assert.equal(proof.format, 'logicgate-verification'); assert.equal(proof.verification.rtl.passes, true);
  h.flushTimers(); assert.equal(h.blobs.size, 0); h.dispose();
});
test('copy handlers use the generated source and support a local fallback', async () => {
  const h = bench(); h.get('copyModule').click(); await Promise.resolve(); assert.equal(h.copied[0], h.get('moduleCode').textContent);
  h.sandbox.navigator.clipboard = undefined; h.get('copyTb').click(); assert.match(h.get('toast').textContent, /copied/); h.dispose();
});

test('growing a custom input set keeps default names unique', () => {
  const h=bench(); change(h,'varCount','2'); change(h,'varNames','C,D'); change(h,'varCount','4');
  assert.equal(h.get('downloadModule').disabled,false); assert.equal(new Set(h.get('varNames').value.split(', ')).size,4); h.dispose();
});
test('direct-wire and constant schematics agree with zero-gate metrics', () => {
  const h=bench(); h.get('clearAll').click(); assert.match(h.get('schematicSvg').textContent,/Constant function/);
  h.get('exprInput').value='A'; h.get('exprApply').click(); assert.match(h.get('schematicSvg').textContent,/Direct wire, zero logic gates/); h.dispose();
});
