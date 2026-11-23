/* LogicGate lab suite. Run with: node --test lab-test.js
   Independent oracles for the timing and verification lab: FIPS 180-4 SHA-256
   known-answer tests plus crypto cross-checks, exhaustive equivalence on all
   benchmark outputs, Quine-McCluskey wrapper over every 2- and 3-variable
   function plus strided 4-variable samples, hand-computed critical paths,
   transport-delay glitch intervals on constructed hazard circuits, structural
   Verilog compiled and simulated by iverilog when installed, CSV injection
   safety, strict bookmark codecs, and DOM-controller checks via the
   deterministic harness. */
'use strict';
var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var cp = require('node:child_process');
var crypto = require('node:crypto');
var LG = require('./logic.js');
var LL = require('./logic-lab.js');
var boot = require('./dom-harness.js').boot;

var REPO = __dirname;
var iverilog = cp.spawnSync('iverilog', ['-V'], { encoding: 'utf8' }).status === 0;
var BENCHES = LL.benchmarks();
function bench(id) { return BENCHES.filter(function (b) { return b.id === id; })[0]; }
function refSha(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }

/* ---------------- SHA-256 ---------------- */

var SHA_KATS = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ['abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu', 'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1'],
  ['The quick brown fox jumps over the lazy dog', 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'],
  ['The quick brown fox jumps over the lazy dog.', 'ef537f25c895bfa782526529a9b63d97aa631564d5d789c2b765448c8635fb6c']
];
SHA_KATS.forEach(function (pair, i) {
  test('SHA-256 known-answer vector ' + i + ' (' + (pair[0].length <= 20 ? JSON.stringify(pair[0]) : pair[0].length + ' bytes') + ')', function () {
    assert.equal(LL.sha256(pair[0]), pair[1]);
  });
});

test('SHA-256 million-a NIST vector', function () {
  assert.equal(LL.sha256('a'.repeat(1000000)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('SHA-256 matches node crypto on UTF-8 and boundary lengths', function () {
  var samples = ['héllo wörld ✓ λ', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'w'.repeat(119), 'q'.repeat(128), 'multi\nline\tfields', 'a'.repeat(10000)];
  samples.forEach(function (s) {
    assert.equal(LL.sha256(s), refSha(s), 'digest drift on length ' + s.length);
  });
});

/* ---------------- Exhaustive equivalence ---------------- */

BENCHES.forEach(function (b) {
  b.outputNames.forEach(function (name) {
    test('equivalence: ' + b.id + ' output ' + name + ' matches spec minterms on all ' + (1 << b.numVars) + ' vectors', function () {
      var r = LL.equivalenceCheck(
        { netlist: b.netlist },
        { numVars: b.numVars, vars: b.inputs, minterms: b.spec[name].minterms, outputName: name }
      );
      assert.equal(r.pass, true, JSON.stringify(r.mismatches.slice(0, 4)));
      assert.equal(r.mismatchCount, 0);
      assert.equal(r.vectors, 1 << b.numVars);
      assert.equal(r.alignedByName, true);
    });
  });
});

test('equivalence: expression vs expression equal and different', function () {
  assert.equal(LL.equivalenceCheck({ expr: 'A & B | !A & C' }, { expr: 'C | A & B' }).pass, false);
  assert.equal(LL.equivalenceCheck({ expr: 'A & B | !A & C | B & C' }, { expr: 'A & B | !A & C' }).pass, true);
});

test('equivalence: NAND-only network vs XOR expression', function () {
  var nand = {
    inputs: ['A', 'B'], outputs: [{ node: 'y', port: 'y', name: 'Y' }],
    nodes: [{ id: 'n0', type: 'NAND' }, { id: 'n1', type: 'NAND' }, { id: 'n2', type: 'NAND' }, { id: 'y', type: 'NAND' }],
    edges: [
      { from: 'IN:A', to: 'n0', toPort: 0 }, { from: 'IN:B', to: 'n0', toPort: 1 },
      { from: 'IN:A', to: 'n1', toPort: 0 }, { from: 'n0', fromPort: 'y', to: 'n1', toPort: 1 },
      { from: 'n0', fromPort: 'y', to: 'n2', toPort: 0 }, { from: 'IN:B', to: 'n2', toPort: 1 },
      { from: 'n1', fromPort: 'y', to: 'y', toPort: 0 }, { from: 'n2', fromPort: 'y', to: 'y', toPort: 1 }
    ]
  };
  var r = LL.equivalenceCheck({ netlist: nand }, { expr: 'A ^ B', outputName: 'Y' });
  assert.equal(r.pass, true);
});

test('equivalence: permuted input names align by name, not position', function () {
  var a = { expr: 'A & B', vars: ['A', 'B'] };
  var b = { numVars: 2, vars: ['B', 'A'], minterms: [3] };
  /* With vars [B,A] the AND function is also m3; a positional compare would
     falsely flag it only if the function were asymmetric. Use XOR-free but
     asymmetric F = A & !B to prove name alignment: vars [B,A] m1 is the same
     physical function A&!B. */
  var r = LL.equivalenceCheck({ expr: 'A & !B', vars: ['A', 'B'] }, { numVars: 2, vars: ['B', 'A'], minterms: [1] });
  assert.equal(r.alignedByName, true);
  assert.equal(r.pass, true, JSON.stringify(r.mismatches));
});

test('equivalence: different name sets align positionally when counts match', function () {
  var r = LL.equivalenceCheck({ expr: 'A & B' }, { numVars: 2, vars: ['X', 'Y'], minterms: [3] });
  assert.equal(r.alignedByName, false);
  assert.equal(r.pass, true);
});

test('equivalence: mismatched output names only compare name matches', function () {
  var b = bench('fullAdder');
  var r = LL.equivalenceCheck({ netlist: b.netlist }, { numVars: 3, vars: b.inputs, minterms: b.spec.COUT.minterms, outputName: 'COUT' });
  assert.equal(r.pass, true);
  assert.deepEqual(r.comparedOutputs, ['COUT']);
});

test('equivalence: mismatch report carries vector, inputs and both values', function () {
  var r = LL.equivalenceCheck({ expr: 'A & B' }, { expr: 'A | B' });
  assert.equal(r.pass, false);
  assert.equal(r.mismatchCount, 2);
  assert.equal(r.mismatches[0].vector, 1);
  assert.equal(r.mismatches[0].inputs, 'A=0,B=1');
  assert.equal(r.mismatches[0].a, 0);
  assert.equal(r.mismatches[0].b, 1);
});

test('equivalence: don\'t cares are masked, not counted as mismatches', function () {
  var r = LL.equivalenceCheck(
    { expr: 'A & B' },
    { numVars: 2, vars: ['A', 'B'], minterms: [3], dontCares: [0, 1] }
  );
  assert.equal(r.maskedDontCares, 2);
  assert.equal(r.pass, true);
});

test('equivalence: don\'t care on the wrong side still fails', function () {
  var r = LL.equivalenceCheck(
    { expr: 'A | B' },
    { numVars: 2, vars: ['A', 'B'], minterms: [3], dontCares: [0, 1] }
  );
  assert.equal(r.pass, false);
  assert.equal(r.mismatchCount, 1);
});

test('equivalence: input count mismatch throws', function () {
  assert.throws(function () { LL.equivalenceCheck({ expr: 'A & B' }, { numVars: 3, minterms: [7] }); }, /input counts differ/);
});

test('equivalence: more than 6 inputs is rejected', function () {
  assert.throws(function () { LL.equivalenceCheck({ expr: 'A&B&C&D&E&F&G' }, { expr: 'A&B&C&D&E&F&G' }); }, /at most 6/);
});

test('equivalence: malformed descriptors throw', function () {
  assert.throws(function () { LL.equivalenceCheck({}, { expr: 'A' }); }, /descriptor/);
  assert.throws(function () { LL.equivalenceCheck(null, { expr: 'A' }); }, /descriptor/);
});

/* ---------------- minimizeSOP wrapper ---------------- */

for (var fn2 = 0; fn2 < 16; fn2 += 1) {
  (function (fn) {
    test('minimizeSOP: 2-variable function ' + fn + ' matches all care states', function () {
      var mins = [];
      for (var m = 0; m < 4; m += 1) if ((fn >> m) & 1) mins.push(m);
      var r = LL.minimizeSOP(2, mins, []);
      assert.equal(r.matchesAllCareStates, true);
      var rebuilt = new Array(4).fill(0);
      mins.forEach(function (m) { rebuilt[m] = 1; });
      assert.equal(r.outputs.join(','), rebuilt.join(','));
    });
  })(fn2);
}

for (var fn3 = 0; fn3 < 256; fn3 += 1) {
  (function (fn) {
    test('minimizeSOP: 3-variable function ' + fn + ' matches all 8 minterms', function () {
      var mins = [];
      for (var m = 0; m < 8; m += 1) if ((fn >> m) & 1) mins.push(m);
      var r = LL.minimizeSOP(3, mins, []);
      assert.equal(r.matchesAllCareStates, true, 'SOP diverged on function ' + fn);
      /* Independent re-check: evaluate each product term against the table. */
      var rebuilt = new Array(8).fill(0);
      mins.forEach(function (m) { rebuilt[m] = 1; });
      assert.equal(r.outputs.join(','), rebuilt.join(','));
    });
  })(fn3);
}

for (var s4 = 0; s4 < 32; s4 += 1) {
  (function (sample) {
    var fn = (sample * 2053 + 977) % 65536;
    test('minimizeSOP: 4-variable sampled function ' + fn + ' matches all 16 minterms', function () {
      var mins = [];
      for (var m = 0; m < 16; m += 1) if ((fn >> m) & 1) mins.push(m);
      var r = LL.minimizeSOP(4, mins, []);
      assert.equal(r.matchesAllCareStates, true);
      assert.equal(r.optimal, true);
    });
  })(s4);
}

test('minimizeSOP: don\'t cares participate without breaking care states', function () {
  var r = LL.minimizeSOP(4, [0, 2, 3, 5, 6, 7, 8, 9], [10, 11, 12, 13, 14, 15]);
  assert.equal(r.matchesAllCareStates, true);
  assert.equal(r.outputs[10] !== undefined, true);
});

test('minimizeSOP: variable bounds enforced', function () {
  assert.throws(function () { LL.minimizeSOP(0, [0], []); }, /1 to 4/);
  assert.throws(function () { LL.minimizeSOP(5, [0], []); }, /1 to 4/);
  assert.throws(function () { LL.minimizeSOP(4.5, [0], []); }, /1 to 4/);
});

test('minimizeSOP: constant functions produce constant expressions', function () {
  assert.equal(LL.minimizeSOP(3, [], []).expression, '0');
  assert.equal(LL.minimizeSOP(3, [0, 1, 2, 3, 4, 5, 6, 7], []).expression, '1');
});

/* ---------------- Critical path ---------------- */

test('criticalPath: full adder t_pd = 10 ns through the carry network', function () {
  var cp = LL.criticalPath(bench('fullAdder').netlist);
  assert.equal(cp.delayNs, 10);
  assert.equal(cp.longestOutput, 'COUT');
  assert.equal(cp.fMaxMHz, 100);
});

test('criticalPath: 4:1 mux t_pd = 14 ns through select decode', function () {
  var cp = LL.criticalPath(bench('mux4to1').netlist);
  assert.equal(cp.delayNs, 14);
});

test('criticalPath: comparator t_pd = 11 ns', function () {
  var cp = LL.criticalPath(bench('comparator2').netlist);
  assert.equal(cp.delayNs, 11);
});

test('criticalPath: parity tree t_pd = 8 ns, balanced', function () {
  var cp = LL.criticalPath(bench('parity4').netlist);
  assert.equal(cp.delayNs, 8);
  assert.equal(cp.fMaxMHz, 125);
});

test('criticalPath: consensus demo t_pd = 11 ns on the fixed cone', function () {
  var cp = LL.criticalPath(bench('consensusDemo').netlist);
  assert.equal(cp.delayNs, 11);
});

test('criticalPath: path starts at an input and ends at the longest output', function () {
  var cp = LL.criticalPath(bench('fullAdder').netlist);
  assert.match(cp.path[0], /^IN:/);
  assert.match(cp.path[cp.path.length - 1], /cy:y|s:y/);
  assert.equal(cp.levels, cp.path.length - 1);
});

test('criticalPath: delay equals the summed gate delays along the path', function () {
  var b = bench('comparator2');
  var cp = LL.criticalPath(b.netlist);
  var g = LL.buildNetlist(b.netlist);
  var sum = 0;
  cp.path.forEach(function (sig) {
    var id = sig.slice(0, sig.lastIndexOf(':'));
    var node = g.byName.get(id);
    if (node && !node.virtual) sum += LL.GATE_DELAYS[node.type][sig.slice(sig.lastIndexOf(':') + 1)] || LL.GATE_DELAYS[node.type];
  });
  assert.equal(sum, cp.delayNs);
});

test('criticalPath: per-node and per-type delay overrides apply', function () {
  var net = {
    inputs: ['A'], outputs: [{ node: 'g', port: 'y', name: 'Y' }],
    nodes: [{ id: 'g', type: 'AND', params: { delay: 9 } }],
    edges: [{ from: 'IN:A', to: 'g', toPort: 0 }]
  };
  assert.equal(LL.criticalPath(net).delayNs, 9);
  assert.equal(LL.criticalPath(net, { delays: { AND: 7 } }).delayNs, 9, 'node param wins over type override');
  var net2 = {
    inputs: ['A'], outputs: [{ node: 'g', port: 'y', name: 'Y' }],
    nodes: [{ id: 'g', type: 'AND' }],
    edges: [{ from: 'IN:A', to: 'g', toPort: 0 }]
  };
  assert.equal(LL.criticalPath(net2, { delays: { AND: 7 } }).delayNs, 7);
});

test('criticalPath: undriven pin contributes zero arrival', function () {
  var net = {
    inputs: ['A'], outputs: [{ node: 'g', port: 'y', name: 'Y' }],
    nodes: [{ id: 'g', type: 'AND' }],
    edges: [{ from: 'IN:A', to: 'g', toPort: 0 }]
  };
  assert.equal(LL.criticalPath(net).delayNs, 3);
});

test('criticalPath: wire-only netlist reports unbounded f_max', function () {
  var net = { inputs: ['A'], outputs: [{ node: 'A', port: 'y', name: 'Y' }], nodes: [], edges: [] };
  /* An output wired to an input node id that does not exist: use a BUF-free
     empty circuit instead (no gates at all). */
  net = { inputs: ['A'], outputs: [], nodes: [], edges: [] };
  var cp = LL.criticalPath(net);
  assert.equal(cp.delayNs, 0);
  assert.equal(cp.fMaxMHz, null);
});

test('criticalPath: sequential and cyclic netlists are rejected', function () {
  var dff = {
    inputs: ['A'], outputs: [{ node: 'q', port: 'q', name: 'Q' }],
    nodes: [{ id: 'q', type: 'DFF' }],
    edges: [{ from: 'IN:A', to: 'q', toPort: 0 }]
  };
  assert.throws(function () { LL.criticalPath(dff); }, /register|combinational/);
  var cyc = {
    inputs: [], outputs: [{ node: 'g1', port: 'y', name: 'Y' }],
    nodes: [{ id: 'g1', type: 'NOT' }, { id: 'g2', type: 'NOT' }],
    edges: [
      { from: 'g1', fromPort: 'y', to: 'g2', toPort: 0 },
      { from: 'g2', fromPort: 'y', to: 'g1', toPort: 0 }
    ]
  };
  assert.throws(function () { LL.criticalPath(cyc); }, /cycle/);
});

/* ---------------- Transition sim + hazard scan ---------------- */

test('transitionSim: consensus demo glitches F at t=6-8 ns on A:7->3', function () {
  var sim = LL.transitionSim(bench('consensusDemo').netlist, 7, 'A');
  var f = sim.outputs.filter(function (o) { return o.output === 'F'; })[0];
  assert.equal(f.hazard, 'static-1');
  assert.equal(f.glitch.startNs, 6);
  assert.equal(f.glitch.endNs, 8);
  assert.equal(f.glitch.widthNs, 2);
  var fix = sim.outputs.filter(function (o) { return o.output === 'F_FIXED'; })[0];
  assert.equal(fix.hazard, null);
});

test('transitionSim: the reverse A:3->7 transition is clean', function () {
  var sim = LL.transitionSim(bench('consensusDemo').netlist, 3, 'A');
  sim.outputs.forEach(function (o) { assert.equal(o.hazard, null); });
});

test('transitionSim: unknown input name is rejected', function () {
  assert.throws(function () { LL.transitionSim(bench('parity4').netlist, 0, 'NOPE'); }, /unknown toggled input/);
});

test('transitionSim: every signal timeline starts committed at t<0', function () {
  var sim = LL.transitionSim(bench('fullAdder').netlist, 3, 'CIN');
  sim.signals.forEach(function (s) {
    var line = sim.timelines.get(s);
    assert.equal(line[0].t, -1);
  });
});

test('detectHazards: consensus demo flags exactly the A:7->3 F glitch', function () {
  var scan = LL.detectHazards(bench('consensusDemo').netlist);
  assert.equal(scan.hazards.length, 1);
  assert.equal(scan.hazards[0].input, 'A');
  assert.equal(scan.hazards[0].fromVector, 7);
  assert.equal(scan.hazards[0].toVector, 3);
  assert.equal(scan.hazards[0].output, 'F');
  assert.equal(scan.hazards[0].type, 'static-1');
  assert.equal(scan.checkedTransitions, 24);
});

test('detectHazards: parity tree is hazard-free on all 64 transitions', function () {
  var scan = LL.detectHazards(bench('parity4').netlist);
  assert.equal(scan.hazards.length, 0);
  assert.equal(scan.checkedTransitions, 64);
});

test('detectHazards: full adder carry network glitches on A and B edges', function () {
  var scan = LL.detectHazards(bench('fullAdder').netlist);
  assert.equal(scan.hazards.length, 2);
  scan.hazards.forEach(function (h) {
    assert.equal(h.output, 'COUT');
    assert.equal(h.type, 'static-1');
  });
});

test('detectHazards: comparator flags select-cone glitches', function () {
  var scan = LL.detectHazards(bench('comparator2').netlist);
  assert.ok(scan.hazards.length >= 1);
  scan.hazards.forEach(function (h) { assert.ok(['static-0', 'static-1', 'dynamic'].indexOf(h.type) >= 0); });
});

test('detectHazards: mux select transitions expose glitches', function () {
  var scan = LL.detectHazards(bench('mux4to1').netlist);
  assert.ok(scan.hazards.length >= 1);
  assert.ok(scan.hazards.every(function (h) { return h.output === 'Y'; }));
});

test('detectHazards: constructed static-0 POS-style glitch', function () {
  /* F = (A & B) ^ (A & ~C): with B=1, C=0 and A 1->0 the two AND cones
     fall simultaneously and the XOR output pulses high. */
  var net = {
    inputs: ['A', 'B', 'C'], outputs: [{ node: 'y', port: 'y', name: 'Y' }],
    nodes: [{ id: 'nc', type: 'NOT' }, { id: 'x', type: 'AND' }, { id: 'z', type: 'AND' }, { id: 'y', type: 'XOR' }],
    edges: [
      { from: 'IN:C', to: 'nc', toPort: 0 },
      { from: 'IN:A', to: 'x', toPort: 0 }, { from: 'IN:B', to: 'x', toPort: 1 },
      { from: 'IN:A', to: 'z', toPort: 0 }, { from: 'nc', fromPort: 'y', to: 'z', toPort: 1 },
      { from: 'x', fromPort: 'y', to: 'y', toPort: 0 }, { from: 'z', fromPort: 'y', to: 'y', toPort: 1 }
    ]
  };
  var scan = LL.detectHazards(net);
  var h = scan.hazards.filter(function (h2) { return h2.fromVector === 6 && h2.input === 'A'; })[0];
  assert.ok(h, 'expected hazard on A:6->2');
  assert.equal(h.type, 'static-0');
  assert.equal(h.glitchStartNs, 7);
  assert.equal(h.glitchEndNs, 7);
});

test('detectHazards: constructed dynamic hazard on a reconverged XOR', function () {
  /* y = A ^ z, z = (~A & B) | (A & C): on A 1->0 with B=C=1 the OR output
     itself dips before recovering, pushing a bounce into the final 0->1. */
  var net = {
    inputs: ['A', 'B', 'C'], outputs: [{ node: 'y', port: 'y', name: 'Y' }],
    nodes: [{ id: 'na', type: 'NOT' }, { id: 'a1', type: 'AND' }, { id: 'a2', type: 'AND' }, { id: 'z', type: 'OR' }, { id: 'y', type: 'XOR' }],
    edges: [
      { from: 'IN:A', to: 'na', toPort: 0 },
      { from: 'na', fromPort: 'y', to: 'a1', toPort: 0 }, { from: 'IN:B', to: 'a1', toPort: 1 },
      { from: 'IN:A', to: 'a2', toPort: 0 }, { from: 'IN:C', to: 'a2', toPort: 1 },
      { from: 'a1', fromPort: 'y', to: 'z', toPort: 0 }, { from: 'a2', fromPort: 'y', to: 'z', toPort: 1 },
      { from: 'IN:A', to: 'y', toPort: 0 }, { from: 'z', fromPort: 'y', to: 'y', toPort: 1 }
    ]
  };
  var sim = LL.transitionSim(net, 7, 'A');
  var out = sim.outputs[0];
  assert.equal(out.from, 0);
  assert.equal(out.to, 1);
  assert.equal(out.hazard, 'dynamic');
});

test('detectHazards: input count cap is enforced', function () {
  var nodes = [], edges = [];
  for (var i = 0; i < 13; i += 1) {
    nodes.push({ id: 'g' + i, type: 'BUF' });
    edges.push({ from: 'IN:X' + i, to: 'g' + i, toPort: 0 });
  }
  var net = { inputs: Array.from({ length: 13 }, function (_, i) { return 'X' + i; }), outputs: [{ node: 'g0', port: 'y', name: 'Y' }], nodes: nodes, edges: edges };
  assert.throws(function () { LL.detectHazards(net); }, /at most/);
});

/* ---------------- Structural Verilog ---------------- */

BENCHES.forEach(function (b) {
  test('structural Verilog: ' + b.id + ' compiles and passes every vector under iverilog', { skip: !iverilog }, function () {
    var expected = {};
    b.outputNames.forEach(function (name) { expected[name] = b.spec[name].minterms; });
    var sv = LL.exportStructuralVerilog(b.netlist, { moduleName: b.id, spec: { expected: expected } });
    var dir = fs.mkdtempSync(path.join(REPO, '.struct-check-'));
    try {
      fs.writeFileSync(path.join(dir, sv.filename), sv.module);
      fs.writeFileSync(path.join(dir, sv.testbenchFilename), sv.testbench);
      var build = cp.spawnSync('iverilog', ['-g2001', '-s', sv.moduleName + '_tb', '-o', 'run.vvp', sv.filename, sv.testbenchFilename], { cwd: dir, encoding: 'utf8', timeout: 10000 });
      assert.equal(build.status, 0, build.stderr);
      var run = cp.spawnSync('vvp', ['run.vvp'], { cwd: dir, encoding: 'utf8', timeout: 10000 });
      assert.equal(run.status, 0, run.stderr);
      assert.doesNotMatch(run.stdout, /FAIL|VECTORS FAILED/);
      assert.match(run.stdout, new RegExp('ALL ' + (1 << b.numVars) + ' VECTORS PASS'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('structural Verilog: module shape, ports and provenance comments', function () {
  var sv = LL.exportStructuralVerilog(bench('parity4').netlist, { moduleName: 'parity4' });
  assert.match(sv.module, /module parity4 \(/);
  assert.match(sv.module, /endmodule/);
  assert.match(sv.module, /`default_nettype none/);
  assert.match(sv.module, /input  wire A0/);
  assert.match(sv.module, /output wire P/);
  assert.match(sv.module, /xor x01 /);
  assert.equal(sv.primitiveCount, 3);
  assert.equal(sv.filename, 'parity4.v');
});

test('structural Verilog: reserved words and collisions are sanitized', function () {
  var net = {
    inputs: ['wire', 'always'], outputs: [{ node: 'module', port: 'y', name: 'output' }],
    nodes: [{ id: 'module', type: 'AND' }],
    edges: [{ from: 'IN:wire', to: 'module', toPort: 0 }, { from: 'IN:always', to: 'module', toPort: 1 }]
  };
  var sv = LL.exportStructuralVerilog(net, { moduleName: 'kw' });
  assert.match(sv.module, /input  wire lg_wire/);
  assert.match(sv.module, /input  wire lg_always/);
  assert.match(sv.module, /and lg_module \(/);
});

test('structural Verilog: MUX2 expands to not/and/and/or', function () {
  var net = {
    inputs: ['A', 'B', 'S'], outputs: [{ node: 'm', port: 'y', name: 'Y' }],
    nodes: [{ id: 'm', type: 'MUX2' }],
    edges: [
      { from: 'IN:A', to: 'm', toPort: 0 }, { from: 'IN:B', to: 'm', toPort: 1 }, { from: 'IN:S', to: 'm', toPort: 2 }
    ]
  };
  var sv = LL.exportStructuralVerilog(net, { moduleName: 'mx' });
  assert.match(sv.module, /not m_inv/);
  assert.match(sv.module, /and m_lo/);
  assert.match(sv.module, /and m_hi/);
  assert.match(sv.module, /or m_out/);
  assert.equal(sv.primitiveCount, 4);
});

test('structural Verilog: CONST emits an assign of a literal', function () {
  var net = {
    inputs: [], outputs: [{ node: 'c', port: 'y', name: 'Y' }],
    nodes: [{ id: 'c', type: 'CONST', params: { value: 1 } }],
    edges: []
  };
  var sv = LL.exportStructuralVerilog(net, { moduleName: 'konst' });
  assert.match(sv.module, /assign n_c_y = 1'b1;/);
  assert.match(sv.module, /assign Y = n_c_y;/);
});

test('structural Verilog: an output tapped directly from an input compiles', function () {
  var net = {
    inputs: ['A'], outputs: [{ node: 'IN:A', port: 'y', name: 'PASSTHRU' }],
    nodes: [], edges: []
  };
  var sv = LL.exportStructuralVerilog(net, { moduleName: 'passthrough' });
  assert.match(sv.module, /assign PASSTHRU = A;/);
  assert.doesNotMatch(sv.module, /undefined/);
});

test('structural Verilog: DFF and unknown nodes are rejected', function () {
  var dff = { inputs: ['A'], outputs: [{ node: 'q', port: 'q', name: 'Q' }], nodes: [{ id: 'q', type: 'DFF' }], edges: [{ from: 'IN:A', to: 'q', toPort: 0 }] };
  assert.throws(function () { LL.exportStructuralVerilog(dff); }, /register|combinational/);
  var bad = { inputs: ['A'], outputs: [], nodes: [{ id: 'x', type: 'MAGIC' }], edges: [] };
  assert.throws(function () { LL.exportStructuralVerilog(bad); }, /unknown node type/);
});

/* ---------------- Reports, CSV, digest ---------------- */

test('report: canonical stringify sorts keys recursively', function () {
  var s = LL.stableStringify({ b: 1, a: { d: 2, c: 3 } });
  assert.equal(s, '{"a":{"c":3,"d":2},"b":1}');
  assert.equal(LL.stableStringify({ a: { c: 3, d: 2 }, b: 1 }), s);
});

test('report: digest equals SHA-256 of the canonical payload', function () {
  var r = LL.buildReport({ circuit: { id: 'x', label: 'demo', inputs: ['A'] }, checks: [{ check: 'c', result: true, detail: 'd' }] });
  assert.equal(r.sha256, LL.sha256(r.canonical));
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
});

test('report: exported JSON verifies, mutated payload fails', function () {
  var r = LL.buildReport({ circuit: { id: 'x' }, checks: [{ check: 'c', result: true, detail: 'd' }] });
  var json = LL.exportReportJSON(r);
  assert.equal(LL.verifyReport(json).pass, true);
  var tampered = JSON.parse(json);
  tampered.report.checks[0].result = 'fail';
  assert.equal(LL.verifyReport(tampered).pass, false);
});

test('report: reordering keys of identical content still verifies', function () {
  var r = LL.buildReport({ checks: [{ check: 'c', result: true }] });
  var reordered = { sha256: r.sha256, report: { checks: r.payload.checks, version: r.payload.version, format: r.payload.format, tool: r.payload.tool, circuit: r.payload.circuit, generated: r.payload.generated, delayModel: r.payload.delayModel, digestNote: r.payload.digestNote } };
  assert.equal(LL.verifyReport(reordered).pass, true);
});

test('report: digest note disclaims signing honestly', function () {
  var r = LL.buildReport({ checks: [] });
  assert.match(r.payload.digestNote, /not a signature/i);
});

test('report: malformed reports throw', function () {
  assert.throws(function () { LL.verifyReport({}); }, /report and sha256/);
  assert.throws(function () { LL.verifyReport({ report: {}, sha256: 'xyz' }); }, /64-hex/);
});

test('CSV: formula-leading characters get the apostrophe guard', function () {
  assert.equal(LL.csvField('=1+1'), "'=1+1");
  assert.equal(LL.csvField('+1'), "'+1");
  assert.equal(LL.csvField('-2'), "'-2");
  assert.equal(LL.csvField('@x'), "'@x");
  assert.equal(LL.csvField('\tx'), "'\tx");
  assert.equal(LL.csvField('plain'), 'plain');
});

test('CSV: quoting doubles inner quotes and wraps special fields', function () {
  assert.equal(LL.csvField('a,b'), '"a,b"');
  assert.equal(LL.csvField('say "hi"'), '"say ""hi"""');
  assert.equal(LL.csvField('line\nbreak'), '"line\nbreak"');
  assert.equal(LL.csvField('cr\ret'), '"cr\ret"');
  assert.equal(LL.csvField(42), '42');
  assert.equal(LL.csvField(null), '');
});

test('CSV: report rows include circuit, checks and the digest', function () {
  var r = LL.buildReport({ circuit: { id: 'parity4', label: 'Parity', inputs: ['A0', 'A1', 'A2', 'A3'] }, checks: [{ check: 'equivalence P', result: true, detail: '16 vectors' }] });
  var csv = LL.reportCSV(r);
  assert.match(csv, /section,key,value/);
  assert.match(csv, /circuit,id,parity4/);
  assert.match(csv, /sha256,[0-9a-f]{64}/);
  assert.match(csv, /\r\n/);
});

test('Markdown report renders a check table with the digest', function () {
  var r = LL.buildReport({ circuit: { id: 'x', label: 'demo', inputs: ['A'] }, checks: [{ check: 'c', result: true, detail: 'a|b' }] });
  var md = LL.reportMarkdown(r);
  assert.match(md, /\| Check \| Result \| Detail \|/);
  assert.match(md, /\| c \| PASS \| a\\\|b \|/);
  assert.match(md, /`[0-9a-f]{64}`/);
});

/* ---------------- Bookmarks ---------------- */

test('bookmark: default state round trips exactly', function () {
  var st = { numVars: 4, vars: ['A', 'B', 'C', 'D'], minterms: [1, 5, 9], dontCares: [15], form: 'SOP', moduleName: 'demo', bench: 'parity4', transition: { input: 'A0', vector: 3 } };
  var h = LL.encodeBookmark(st);
  assert.match(h, /^#lg=[A-Za-z0-9_-]+$/);
  var back = LL.decodeBookmark(h);
  assert.deepEqual(back.minterms, [1, 5, 9]);
  assert.deepEqual(back.dontCares, [15]);
  assert.equal(back.form, 'SOP');
  assert.equal(back.bench, 'parity4');
  assert.deepEqual(back.transition, { input: 'A0', vector: 3 });
});

test('bookmark: POS form and empty fields survive', function () {
  var back = LL.decodeBookmark(LL.encodeBookmark({ numVars: 2, vars: ['X', 'Y'], minterms: [], dontCares: [], form: 'POS' }));
  assert.equal(back.form, 'POS');
  assert.equal(back.moduleName, 'logicgate_module');
  assert.equal(back.bench, null);
});

test('bookmark: encoding is deterministic', function () {
  var st = { numVars: 3, vars: ['A', 'B', 'C'], minterms: [1], dontCares: [], form: 'SOP' };
  assert.equal(LL.encodeBookmark(st), LL.encodeBookmark(st));
});

['#xx=AAAA', '#lg=', '#lg=%%%', '#lg=AAAA', '#lg=eyJ2IjoyfQ'].forEach(function (h) {
  test('bookmark: malformed hash rejected: ' + h, function () {
    assert.throws(function () { LL.decodeBookmark(h); });
  });
});

test('bookmark: unsupported version rejected', function () {
  var bad = '#lg=' + Buffer.from(JSON.stringify({ v: 9, numVars: 3, vars: ['A', 'B', 'C'], minterms: [] })).toString('base64url');
  assert.throws(function () { LL.decodeBookmark(bad); }, /version/);
});

test('bookmark: out-of-range values rejected', function () {
  function b64(obj) { return '#lg=' + Buffer.from(JSON.stringify(obj)).toString('base64url'); }
  assert.throws(function () { LL.decodeBookmark(b64({ v: 1, numVars: 5, vars: ['A', 'B', 'C', 'D', 'E'], minterms: [] })); }, /numVars/);
  assert.throws(function () { LL.decodeBookmark(b64({ v: 1, numVars: 3, vars: ['A', 'B'], minterms: [] })); }, /vars/);
  assert.throws(function () { LL.decodeBookmark(b64({ v: 1, numVars: 3, vars: ['A', 'B', 'C'], minterms: [8] })); }, /range/);
  assert.throws(function () { LL.decodeBookmark(b64({ v: 1, numVars: 3, vars: ['A', 'B', 'C'], minterms: [1.5] })); }, /range/);
  assert.throws(function () { LL.decodeBookmark(b64({ v: 1, numVars: 3, vars: ['A', 'B', 'C'], minterms: [3], dontCares: [3] })); }, /overlap/);
  assert.throws(function () { LL.decodeBookmark(b64({ v: 1, numVars: 3, vars: ['A', 'B', '0bad'], minterms: [] })); }, /vars|identifiers/);
});

/* ---------------- Self tests ---------------- */

test('selfTests: every in-page check passes', function () {
  var st = LL.runSelfTests();
  assert.equal(st.pass, true, JSON.stringify(st.results.filter(function (r) { return !r.pass; })));
  assert.equal(st.total, st.results.length);
  assert.ok(st.total >= 15);
  var cats = {};
  st.results.forEach(function (r) { cats[r.category] = true; });
  ['digest', 'equivalence', 'minimization', 'timing', 'hazards', 'reports', 'bookmarks'].forEach(function (c) { assert.ok(cats[c], 'missing category ' + c); });
});

test('selfTests: deterministic across runs', function () {
  var a = LL.runSelfTests().results.map(function (r) { return r.id + ':' + r.pass; }).join('|');
  var b = LL.runSelfTests().results.map(function (r) { return r.id + ':' + r.pass; }).join('|');
  assert.equal(a, b);
});

/* ---------------- DOM controller checks ---------------- */

test('ui: lab panel boots populated with benchmarks and stats', function () {
  var app = boot(REPO);
  try {
    assert.deepEqual(app.errors, []);
    assert.equal(app.get('benchSelect').querySelectorAll('option').length, 5);
    assert.equal(app.get('labStats').querySelectorAll('.stat-tile').length, 6);
    assert.match(app.get('benchDescription').textContent, /consensus|glitch|consensus cube/i);
  } finally { app.dispose(); }
});

test('ui: consensus demo shows the hazard row and exact glitch interval', function () {
  var app = boot(REPO);
  try {
    var rows = app.get('labHazard').querySelectorAll('.prime-row');
    assert.equal(rows.length, 1);
    assert.match(rows[0].querySelector('.term').textContent, /A: m7.*m3/);
    assert.match(rows[0].querySelector('.term').textContent, /static-1/);
    assert.match(rows[0].querySelector('.term').textContent, /t=6.*8 ns/);
    assert.match(app.get('labStatus').textContent, /F static-1 glitch t=6.8 ns/);
  } finally { app.dispose(); }
});

test('ui: timing SVG draws signals, grid lines and a glitch band', function () {
  var app = boot(REPO);
  try {
    var host = app.get('timingSvg');
    var root = host.querySelector('svg');
    assert.ok(root, 'svg rendered');
    var texts = root.querySelectorAll('text').map(function (t) { return t.textContent; });
    assert.ok(texts.some(function (t) { return /committed events/.test(t); }));
    assert.ok(texts.some(function (t) { return /glitch/.test(t); }), 'glitch label present');
    assert.ok(root.querySelectorAll('rect[fill-opacity]').length >= 1, 'glitch band drawn');
    assert.ok(root.querySelectorAll('path').length >= 4, 'waveform paths drawn');
  } finally { app.dispose(); }
});

test('ui: switching benchmarks re-runs analysis and repopulates transitions', function () {
  var app = boot(REPO);
  try {
    var select = app.get('benchSelect');
    select.value = 'parity4';
    app.event(select, 'change');
    assert.match(app.get('labStatus').textContent, /monotonically|no glitch/i);
    assert.equal(app.get('labHazard').querySelectorAll('.prime-row').length, 0);
    assert.match(app.get('labStats').querySelectorAll('.stat-tile')[1].querySelector('.value').textContent, /8 ns/);
    select.value = 'fullAdder';
    app.event(select, 'change');
    assert.equal(app.get('labHazard').querySelectorAll('.prime-row').length, 2);
  } finally { app.dispose(); }
});

test('ui: changing the transition re-runs the sim', function () {
  var app = boot(REPO);
  try {
    var select = app.get('transitionSelect');
    var clean = Array.from(select.querySelectorAll('option')).filter(function (o) { return /m3/.test(o.textContent) && !/glitch|static|default/.test(o.textContent); })[0];
    if (clean) {
      select.value = clean.value;
      app.event(select, 'change');
      assert.match(app.get('labStatus').textContent, /monotonically|glitch/i);
    }
    select.value = 'A|7';
    app.event(select, 'change');
    assert.match(app.get('labStatus').textContent, /static-1/);
  } finally { app.dispose(); }
});

test('ui: structural downloads emit module and testbench files', function () {
  var app = boot(REPO);
  try {
    app.get('labVerilog').click();
    app.get('labVerilogTb').click();
    var names = app.document.downloads.map(function (d) { return d.filename; });
    assert.ok(names.some(function (n) { return n === 'consensusDemo.v'; }));
    assert.ok(names.some(function (n) { return /consensusDemo_tb\.v$/.test(n); }));
    assert.match(app.get('toast').textContent, /Downloaded/);
  } finally { app.dispose(); }
});

test('ui: report downloads carry a verifiable digest and safe CSV', function () {
  var app = boot(REPO);
  try {
    app.get('labReportJson').click();
    app.get('labReportCsv').click();
    app.get('labReportMd').click();
    var names = app.document.downloads.map(function (d) { return d.filename; });
    assert.ok(names.some(function (n) { return /verification\.json$/.test(n); }));
    assert.ok(names.some(function (n) { return /verification\.csv$/.test(n); }));
    assert.ok(names.some(function (n) { return /verification\.md$/.test(n); }));
  } finally { app.dispose(); }
});

test('ui: self-test panel runs and renders pass rows', function () {
  var app = boot(REPO);
  try {
    app.get('runSelfTests').click();
    app.flushTimers();
    assert.match(app.get('selfTestSummary').textContent, /16 \/ 16 self-tests pass/);
    var rows = app.get('selfTestList').querySelectorAll('.prime-row');
    assert.equal(rows.length, 16);
    assert.ok(rows.every(function (r) { return /PASS/.test(r.querySelector('.tag').textContent); }));
  } finally { app.dispose(); }
});

test('ui: bookmark copy produces a decodable #lg= link', function () {
  var app = boot(REPO);
  try {
    app.get('bookmarkCopy').click();
    assert.equal(app.copied.length, 1);
    var link = app.copied[0];
    var hash = link.slice(link.indexOf('#'));
    assert.match(hash, /^#lg=/);
    var decoded = LL.decodeBookmark(hash);
    assert.equal(decoded.numVars, 4);
    assert.equal(decoded.bench, 'consensusDemo');
    assert.deepEqual(decoded.transition, { input: 'A', vector: 7 });
  } finally { app.dispose(); }
});

test('ui: bookmark in location.hash applies on boot', function () {
  var hash = LL.encodeBookmark({ numVars: 3, vars: ['A', 'B', 'C'], minterms: [1, 3, 6, 7], dontCares: [], form: 'SOP', moduleName: 'bookmark_spec', bench: 'parity4', transition: { input: 'A0', vector: 0 } });
  var app = boot(REPO, {
    beforeBoot: function (ctx) { ctx.sandbox.location = { hash: hash, href: 'https://aariv.me/logicgate/' + hash }; }
  });
  try {
    assert.equal(app.get('mintermInput').value, '1, 3, 6, 7');
    assert.equal(app.get('varNames').value, 'A, B, C');
    assert.equal(app.get('moduleNameInput').value, 'bookmark_spec');
    assert.match(app.get('exprStatus').textContent, /Applied bookmarked specification/);
  } finally { app.dispose(); }
});

test('ui: malformed bookmark falls back to the default preset', function () {
  var app = boot(REPO, {
    beforeBoot: function (ctx) { ctx.sandbox.location = { hash: '#lg=%%%garbage', href: 'https://aariv.me/logicgate/#lg=%%%garbage' }; }
  });
  try {
    assert.match(app.get('exprStatus').textContent, /Bookmark ignored/);
    assert.match(app.get('mintermInput').value, /0, 2, 3, 5/);
  } finally { app.dispose(); }
});

test('ui: missing logic-lab degrades to hidden lab panels without errors', function () {
  var app = boot(REPO, {
    beforeBoot: function (ctx) {
      ctx.document.querySelectorAll('script').forEach(function (s) {
        if (s.getAttribute('src') === 'logic-lab.js') s.remove();
      });
    }
  });
  try {
    assert.deepEqual(app.errors, []);
    assert.equal(app.get('labPanel').hasAttribute('hidden'), true);
    assert.equal(app.get('selfTestPanel').hasAttribute('hidden'), true);
    assert.match(app.get('exprStatus').textContent, /Loaded|seven|Evaluated|segment/i);
  } finally { app.dispose(); }
});
