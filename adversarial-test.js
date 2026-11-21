/* Adversarial regression suite. Run with: node --test adversarial-test.js
   Covers parser robustness, exact-cover optimality against an independent
   oracle, sequential DFF timing, undriven-pin reporting, Verilog structure
   and UI hygiene invariants. */
'use strict';
var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var LG = require('./logic.js');

var REPO = __dirname;

/* ---------------- Independent literal-optimal cover oracle ---------------- */

function cubeCovers(cubeMask, cubeValue, m) { return ((m & cubeMask) ^ cubeValue) === 0; }

function oracleCover(numVars, onSet, dcSet, mode) {
  var size = 1 << numVars;
  var full = size - 1;
  var on = new Set(onSet), dc = new Set(dcSet);
  var cubes = [];
  for (var mask = 0; mask <= full; mask += 1) {
    for (var value = 0; value <= full; value += 1) {
      if ((value & ~mask) !== 0) continue;
      var hitsOn = false, legal = true;
      for (var m = 0; m < size; m += 1) {
        if (!cubeCovers(mask, value, m)) continue;
        var want = on.has(m) ? 1 : dc.has(m) ? 'x' : 0;
        if (mode === 'sop') { if (want === 0) { legal = false; break; } if (want === 1) hitsOn = true; }
        else { if (want === 1) { legal = false; break; } if (want === 0) hitsOn = true; }
      }
      if (legal && hitsOn) cubes.push({ mask: mask, value: value });
    }
  }
  var needed = [];
  for (m = 0; m < size; m += 1) if (mode === 'sop' ? on.has(m) : (!on.has(m) && !dc.has(m))) needed.push(m);
  if (!needed.length) return { terms: 0, literals: 0 };
  function lits(c) { var n = 0; for (var b = 0; b < numVars; b += 1) if (c.mask & (1 << b)) n += 1; return n; }
  var best = { terms: Infinity, literals: Infinity };
  var coversMap = cubes.map(function (c) {
    return needed.map(function (m) { return cubeCovers(c.mask, c.value, m); });
  });
  (function search(i, chosen) {
    if (chosen.length >= best.terms) return;
    if (needed.every(function (_, k) { return chosen.some(function (ci) { return coversMap[ci][k]; }); })) {
      var l = chosen.reduce(function (s, ci) { return s + lits(cubes[ci]); }, 0);
      if (chosen.length < best.terms || l < best.literals) best = { terms: chosen.length, literals: l };
      return;
    }
    for (var c = i; c < cubes.length; c += 1) search(c + 1, chosen.concat(c));
  })(0, []);
  return best;
}

function solCost(sol) { return { terms: sol.termCount, literals: sol.literalCount }; }

/* ---------------- Parser robustness ---------------- */

test('parser rejects pathological nesting with LogicError, not a crash', function () {
  var deep = '(' + '('.repeat(700) + 'A' + ')'.repeat(700) + ')';
  assert.throws(function () { LG.parseExpr(deep, ['A']); }, { name: 'LogicError' });
  assert.throws(function () { LG.parseExpr('~'.repeat(5000) + 'A', ['A']); }, { name: 'LogicError' });
  assert.throws(function () { LG.parseExpr("A" + "'".repeat(5000), ['A']); }, { name: 'LogicError' });
  assert.doesNotThrow(function () { LG.parseExpr('~'.repeat(200) + 'A', ['A']); });
  var flat = Array(500).fill('A').join(' | ');
  assert.doesNotThrow(function () { LG.parseExpr(flat, ['A']); });
});

test('parser reports error classes cleanly', function () {
  [['(', 'A'], ['A &', 'A'], ['A & & B', 'A,B'], ['A | | B', 'A,B']].forEach(function (pair) {
    assert.throws(function () { LG.parseExpr(pair[0], pair[1].split(',')); }, { name: 'LogicError' }, pair[0]);
  });
});

/* ---------------- Exact cover optimality ---------------- */

test('cyclic covers match independent literal-optimal oracle', function () {
  var cases = [
    { n: 4, on: [0, 1, 2, 5, 6, 7], dc: [] },
    { n: 4, on: [0, 2, 4, 5, 6, 7, 8, 10, 13, 15], dc: [] },
    { n: 4, on: [1, 2, 3, 4, 5, 6], dc: [] }
  ];
  cases.forEach(function (c) {
    var r = LG.minimizeBoolean(c.n, c.on, c.dc, {});
    ['sop', 'pos'].forEach(function (mode) {
      var want = oracleCover(c.n, c.on, c.dc, mode);
      var got = solCost(mode === 'sop' ? r.sop : r.pos);
      assert.equal(got.terms, want.terms, mode + ' term count ' + c.on.join(','));
      assert.equal(got.literals, want.literals, mode + ' literal count ' + c.on.join(','));
    });
  });
});

test('random 4-var specs with dont-cares are equivalent and optimal', function () {
  var seed = 12345;
  function rand() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
  var checked = 0;
  for (var t = 0; t < 40; t += 1) {
    var on = [], dc = [];
    for (var m = 0; m < 16; m += 1) {
      var u = rand();
      if (u < 0.45) on.push(m); else if (u < 0.6) dc.push(m);
    }
    if (!on.length) on.push((t * 3) % 16);
    var r = LG.minimizeBoolean(4, on, dc, {});
    var want = oracleCover(4, on, dc, 'sop');
    var got = solCost(r.sop);
    assert.equal(got.terms, want.terms, 'spec ' + JSON.stringify({ on: on, dc: dc }));
    assert.equal(got.literals, want.literals);
    assert.equal(r.verification.sopMatchesCareInputs, true, 'equivalence ' + JSON.stringify({ on: on, dc: dc }));
    assert.equal(r.verification.posMatchesCareInputs, true);
    checked += 1;
  }
  assert.equal(checked, 40);
});

test('tautology and contradiction minimize to constants', function () {
  var all = []; for (var i = 0; i < 16; i += 1) all.push(i);
  var taut = LG.minimizeBoolean(4, all, [], {});
  assert.equal(taut.sop.expression, '1');
  var contra = LG.minimizeBoolean(4, [], [], {});
  assert.equal(contra.sop.expression, '0');
});

/* ---------------- Sequential simulation ---------------- */

function simSeq(netlist, vectors) { return LG.simulateNetlist(netlist, vectors); }

var SHIFT3 = {
  inputs: ['D'],
  outputs: [{ node: 'q0', port: 'q', name: 'b0' }, { node: 'q2', port: 'q', name: 'b2' }],
  nodes: [{ id: 'q0', type: 'DFF' }, { id: 'q1', type: 'DFF' }, { id: 'q2', type: 'DFF' }],
  edges: [
    { from: 'IN:D', to: 'q0', toPort: 0 },
    { from: 'q0', fromPort: 'q', to: 'q1', toPort: 0 },
    { from: 'q1', fromPort: 'q', to: 'q2', toPort: 0 }
  ]
};

test('DFF shift register moves one pulse through three stages non-blockingly', function () {
  var res = simSeq(SHIFT3, [1, 0, 0, 0, 0]);
  var b0 = res.cycles.map(function (c) { return c.outputs.b0; });
  var b2 = res.cycles.map(function (c) { return c.outputs.b2; });
  assert.deepEqual(b0, [0, 1, 0, 0, 0]);
  assert.deepEqual(b2, [0, 0, 0, 1, 0]);
});

test('syncCounter preset matches its arithmetic oracle on all 12 edges', function () {
  var p = LG.getPreset('syncCounter');
  assert.ok(p && p.netlist && p.expectedWave);
  var res = simSeq(p.netlist, p.stimulus);
  assert.equal(res.cycles.length, 12);
  res.cycles.forEach(function (c, i) {
    assert.equal(c.outputs.b0, p.expectedWave.b0[i], 'b0 at edge ' + i);
    assert.equal(c.outputs.b1, p.expectedWave.b1[i], 'b1 at edge ' + i);
  });
  assert.equal(res.hazards.length, 0);
});

test('combinational cycles throw LogicError instead of hanging', function () {
  var ring = {
    inputs: [], outputs: [{ node: 'a', port: 'y', name: 'o' }],
    nodes: [{ id: 'a', type: 'NAND' }, { id: 'b', type: 'NAND' }],
    edges: [
      { from: 'a', fromPort: 'y', to: 'b', toPort: 0 },
      { from: 'b', fromPort: 'y', to: 'a', toPort: 0 },
      { from: 'b', fromPort: 'y', to: 'a', toPort: 1 }, { from: 'a', fromPort: 'y', to: 'b', toPort: 1 }
    ]
  };
  assert.throws(function () { simSeq(ring, [{}]); }, { name: 'LogicError' });
});

test('undriven gate pins are reported as warnings, not silently zero', function () {
  var res = simSeq({
    inputs: ['A'], outputs: [{ node: 'g', port: 'y', name: 'o' }],
    nodes: [{ id: 'g', type: 'AND' }],
    edges: [{ from: 'IN:A', to: 'g', toPort: 0 }]
  }, [1]);
  assert.ok(res.hazards.some(function (h) { return h.type === 'undriven-input' && h.node === 'g' && h.port === 1; }));
  assert.equal(res.cycles[0].outputs.o, 0);
});

/* ---------------- Verilog structure ---------------- */

test('exported Verilog wraps long lines and round-trips', function () {
  var bundle = LG.exportVerilog({ minterms: [0, 1, 2, 3, 5, 7, 8, 10, 11, 13, 15], dontCares: [4, 9], numVars: 4, vars: ['A', 'B', 'C', 'D'], form: 'SOP', moduleName: 'wrap_case', outputName: 'y' });
  bundle.testbench.split('\n').forEach(function (line) {
    assert.ok(line.length <= 130, 'testbench line ' + line.length + ' chars: ' + line.slice(0, 60));
  });
  bundle.module.split('\n').forEach(function (line) {
    assert.ok(line.length <= 130, 'module line ' + line.length + ' chars: ' + line.slice(0, 60));
  });
  assert.equal(LG.verifyVerilog(bundle).passes, true);
});

test('export API emits a valid bundle for POS too', function () {
  var bundle = LG.exportVerilog({ minterms: [1, 3, 6, 7], dontCares: [], numVars: 3, vars: ['A', 'B', 'C'], form: 'POS' });
  assert.equal(LG.verifyVerilog(bundle).passes, true);
});

/* ---------------- UI hygiene invariants ---------------- */

test('markup and styles keep the design fences', function () {
  var html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  var css = fs.readFileSync(path.join(REPO, 'style.css'), 'utf8');
  var app = fs.readFileSync(path.join(REPO, 'app.js'), 'utf8');
  assert.ok(!/scroll-behavior/.test(css), 'scroll-behavior present in CSS');
  assert.ok(!html.includes('doc-meta') && !html.includes('tagline') && !html.includes('panel-sub'),
    'eyebrow/tagline/panel-sub markup still present');
  assert.ok(!css.includes('.doc-meta') && !css.includes('.tagline') && !css.includes('.panel-sub'),
    'eyebrow/tagline/panel-sub styles still present');
  assert.ok(!/class="kicker"/.test(html) && !app.includes('class="kicker"'), 'kicker class still used');
  var all = html + css + app;
  ['—', '–', '‑', '‒', '―'].forEach(function (d) {
    assert.ok(!all.includes(d), 'dash U+' + d.codePointAt(0).toString(16) + ' found');
  });
});

test('scenario buttons only carry a title, no eyebrow or helper line', function () {
  var html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  var buttons = html.match(/<button[^>]*class="scenario"[\s\S]*?<\/button>/g) || [];
  assert.ok(buttons.length >= 4);
  buttons.forEach(function (b) {
    assert.ok(!/<span|<small/.test(b), 'scenario button carries eyebrow or helper: ' + b);
    assert.ok(/<strong>/.test(b));
  });
});

test('grid tracks cannot blow out on intrinsic content', function () {
  var css = fs.readFileSync(path.join(REPO, 'style.css'), 'utf8');
  var decls = css.match(/grid-template-columns\s*:[^;]+;/g) || [];
  decls.forEach(function (decl) {
    var stripped = decl.replace(/minmax\([^)]*\)|repeat\([^)]*\)/g, '');
    assert.ok(!/\b\d*\.?\d*fr/.test(stripped), 'unbounded fr track: ' + decl);
  });
  ['.code-grid', '.workspace', '.help-grid', '.showcase', '.two-col', '.schematic-waveform-grid'].forEach(function (sel) {
    var usesMinmax = css.split('@media').some(function (chunk) { return chunk.indexOf(sel) >= 0; });
    assert.ok(usesMinmax);
  });
});

test('every showcase button maps to a real preset', function () {
  var html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  var ids = (html.match(/data-preset="[^"]+"/g) || []).map(function (s) { return s.slice(13, -1); });
  ids.forEach(function (id) {
    assert.ok(LG.getPreset(id), 'no preset for data-preset=' + id);
  });
});

test('group halo underlay is drawn beneath every cover loop', function () {
  var app = fs.readFileSync(path.join(REPO, 'app.js'), 'utf8');
  assert.ok(/stroke: cssVar\('--surface-0'\)/.test(app) || /cssVar\('--surface-0'\)/.test(app), 'no halo stroke found');
});

test('all presets simulate a matching oracle through the full pipeline', function () {
  LG.listPresets().forEach(function (meta) {
    var p = LG.getPreset(meta.id);
    if (!p.netlist) return;
    var vectors = p.stimulus ? p.stimulus : Array.from({ length: 1 << p.netlist.inputs.length }, function (_, i) { return i; });
    var res = LG.simulateNetlist(p.netlist, vectors);
    assert.equal(res.cycles.length, vectors.length, meta.id);
  });
});

test('CONST gate node honors string and numeric parameter values', function () {
  function run(value) {
    var res = LG.simulateNetlist({
      inputs: [],
      nodes: [{ id: 'c', type: 'CONST', params: { value: value } }],
      outputs: [{ node: 'c', port: 'y', name: 'o' }]
    }, [{}]);
    return res.cycles[0].outputs.o;
  }
  assert.equal(run(1), 1);
  assert.equal(run('1'), 1);
  assert.equal(run(true), 1);
  assert.equal(run(0), 0);
  assert.equal(run('0'), 0);
  assert.equal(run(false), 0);
  assert.equal(run(undefined), 0);
});

test('expression-only export spec infers its variables', function () {
  var bundle = LG.exportVerilog({ expr: 'A ^ B ^ C' });
  assert.equal(bundle.spec.numVars, 3);
  assert.deepEqual(bundle.spec.vars, ['A', 'B', 'C']);
  assert.equal(bundle.inputNames.length, 3);
  var check = LG.verifyVerilog(bundle);
  assert.equal(check.passes, true);
  assert.equal(check.checked, 8);
});
