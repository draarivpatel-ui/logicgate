/* LogicGate test suite. Run with: node --test test.js */
'use strict';
var test = require('node:test');
var assert = require('node:assert/strict');
var LG = require('./logic.js');

function bruteBest(numVars, onSet, dcSet) {
  var size = 1 << numVars;
  var targets = Array.from({ length: size }, function (_, i) { return i; })
    .filter(function (m) { return onSet.indexOf(m) >= 0; });
  var candidates = [];
  var fullMask = size - 1;
  for (var mask = 0; mask <= fullMask; mask += 1) {
    for (var value = 0; value <= fullMask; value += 1) {
      if ((value & ~mask) !== 0) continue;
      var covers = [];
      var valid = true;
      for (var m = 0; m < size; m += 1) {
        if (((m & mask) ^ value) !== 0) continue;
        if (dcSet.indexOf(m) < 0 && onSet.indexOf(m) < 0) { valid = false; break; }
        covers.push(m);
      }
      if (!valid) continue;
      var hit = 0;
      targets.forEach(function (m, i) { if (covers.indexOf(m) >= 0) hit |= 1 << i; });
      if (hit) candidates.push({ bits: hit, literals: popcount(mask) });
    }
  }
  var best = Infinity;
  (function search(covered, terms, literals) {
    if (terms > best) return;
    if (covered === (1 << targets.length) - 1) {
      best = Math.min(best, terms);
      return;
    }
    var first = 0;
    while (covered & (1 << first)) first += 1;
    candidates.forEach(function (c) {
      if (!(c.bits & (1 << first))) return;
      search(covered | c.bits, terms + 1, literals + c.literals);
    });
  })(0, 0, 0);
  return best;
}
function popcount(n) { var c = 0; while (n) { n &= n - 1; c += 1; } return c; }

test('module exposes the public API', function () {
  assert.equal(LG.version, '1.0.0');
  ['parseExpr', 'evalTruthTable', 'minimizeBoolean', 'karnaughMap', 'simulateNetlist',
    'detectCycles', 'exportVerilog', 'getPreset', 'listPresets', 'presetTruthTable'].forEach(function (k) {
      assert.equal(typeof LG[k], 'function', k + ' should be a function');
    });
  assert.ok(LG.GATE_TYPES.indexOf('FULL_ADDER') >= 0);
});

test('parseExpr handles symbolic and word operators', function () {
  var a = LG.parseExpr('A & B', ['A', 'B']);
  var b = LG.parseExpr('A AND B', ['A', 'B']);
  var c = LG.parseExpr('A*B', ['A', 'B']);
  assert.deepEqual(a.evaluate({ A: 1, B: 1 }), 1);
  assert.deepEqual(b.evaluate({ A: 1, B: 0 }), 0);
  assert.deepEqual(c.evaluate({ A: 0, B: 1 }), 0);
});

test('parseExpr respects precedence and parentheses', function () {
  assert.equal(LG.parseExpr('A | B & C', ['A', 'B', 'C']).evaluate({ A: 0, B: 1, C: 0 }), 0);
  assert.equal(LG.parseExpr('(A | B) & C', ['A', 'B', 'C']).evaluate({ A: 1, B: 0, C: 1 }), 1);
});

test('parseExpr supports implicit AND and postfix complement', function () {
  var p = LG.parseExpr("AB' + C", ['A', 'B', 'C']);
  assert.equal(p.evaluate({ A: 1, B: 0, C: 0 }), 1);
  assert.equal(p.evaluate({ A: 1, B: 1, C: 0 }), 0);
});

test('parseExpr supports NAND, NOR, XNOR, and constants', function () {
  assert.equal(LG.parseExpr('A NAND B', ['A', 'B']).evaluate({ A: 1, B: 1 }), 0);
  assert.equal(LG.parseExpr('A ~| B', ['A', 'B']).evaluate({ A: 0, B: 0 }), 1);
  assert.equal(LG.parseExpr('A ~^ B', ['A', 'B']).evaluate({ A: 1, B: 1 }), 1);
  assert.equal(LG.parseExpr('1 | 0 & A', ['A']).evaluate({ A: 0 }), 1);
});

test('parseExpr rejects unknown variables, bad syntax, and duplicate names', function () {
  assert.throws(function () { LG.parseExpr('A & Z', ['A', 'B']); }, /unknown variable/);
  assert.throws(function () { LG.parseExpr('A &', ['A', 'B']); }, /unexpected end/);
  assert.throws(function () { LG.parseExpr('(A', ['A', 'B']); }, /missing closing/);
  assert.throws(function () { LG.parseExpr('A', ['A', 'A']); }, /duplicate/);
});

test('parseExpr resolves explicit variable names case insensitively', function () {
  var p = LG.parseExpr('ALPHA & beta', ['Alpha', 'Beta']);
  assert.deepEqual(p.vars, ['Alpha', 'Beta']);
  assert.equal(p.evaluate({ Alpha: 1, Beta: 1 }), 1);
  assert.equal(p.evaluate({ Alpha: 1, Beta: 0 }), 0);
});

test('parseExpr ignores comments', function () {
  assert.equal(LG.parseExpr('A /* comment */ & B // trailing', ['A', 'B']).evaluate({ A: 1, B: 1 }), 1);
});

test('evalTruthTable matches AND and XOR', function () {
  assert.deepEqual(LG.evalTruthTable('A & B', ['A', 'B']).outputs, [0, 0, 0, 1]);
  assert.deepEqual(LG.evalTruthTable('A ^ B', ['A', 'B']).minterms, [1, 2]);
});

test('evalTruthTable accepts a parsed expression', function () {
  var parsed = LG.parseExpr('A | B', ['A', 'B']);
  assert.deepEqual(LG.evalTruthTable(parsed).outputs, [0, 1, 1, 1]);
});

test('evalTruthTable infers and orders variables', function () {
  var r = LG.evalTruthTable('C | A');
  assert.deepEqual(r.vars, ['A', 'C']);
  assert.deepEqual(r.minterms, [1, 2, 3]);
});

test('truthTableFromExpression is an alias of evalTruthTable', function () {
  assert.deepEqual(LG.truthTableFromExpression('A ^ B', ['A', 'B']).outputs, [0, 1, 1, 0]);
});

test('parseMintermList accepts arrays, strings, and skips X tokens', function () {
  assert.deepEqual(LG.parseMintermList([3, 1, 3], 3), [1, 3]);
  assert.deepEqual(LG.parseMintermList('0, 2 x - 7', 3), [0, 2, 7]);
  assert.throws(function () { LG.parseMintermList([8], 3); }, /out of range/);
});

test('fromMinterms builds the truth table and care mask', function () {
  var r = LG.fromMinterms(2, [1, 2], [3]);
  assert.deepEqual(r.outputs, [0, 1, 1, 0]);
  assert.deepEqual(r.care, [1, 1, 1, 0]);
  assert.throws(function () { LG.fromMinterms(2, [3], [3]); }, /also listed/);
});

test('primeImplicants merges adjacent minterms into cubes', function () {
  var primes = LG.primeImplicants(2, [0, 1, 2, 3]);
  assert.equal(primes.length, 1);
  assert.equal(primes[0].mask, 0);
  assert.deepEqual(primes[0].minterms, [0, 1, 2, 3]);
});

test('minimizeBoolean computes minimal SOP for XOR', function () {
  var r = LG.minimizeBoolean(2, [1, 2], []);
  assert.deepEqual(r.sop.terms, ['~AB', 'A~B']);
  assert.equal(r.sop.termCount, 2);
  assert.equal(r.sop.literalCount, 4);
  assert.ok(r.verification.sopMatchesCareInputs);
  assert.ok(r.verification.posMatchesCareInputs);
});

test('minimizeBoolean computes minimal POS for XOR', function () {
  var r = LG.minimizeBoolean(2, [1, 2], []);
  assert.deepEqual(r.pos.terms, ['(A + B)', '(~A + ~B)']);
  assert.deepEqual(r.verification.posOutputs, [0, 1, 1, 0]);
});

test('minimizeBoolean uses don\'t cares to enlarge cubes', function () {
  var r = LG.minimizeBoolean(2, [3], [0, 1, 2]);
  assert.deepEqual(r.sop.terms, ['1']);
  assert.equal(r.sop.gateCount.total, 0);
  assert.equal(r.sop.expression, '1');
});

test('minimizeBoolean handles constant zero and one', function () {
  var z = LG.minimizeBoolean(2, [], []);
  assert.equal(z.sop.expression, '0');
  assert.equal(z.sop.termCount, 0);
  assert.deepEqual(z.verification.sopOutputs, [0, 0, 0, 0]);
  assert.deepEqual(z.verification.posOutputs, [0, 0, 0, 0]);
  var o = LG.minimizeBoolean(2, [0, 1, 2, 3], []);
  assert.equal(o.sop.expression, '1');
  assert.equal(o.pos.expression, '1');
  assert.deepEqual(o.verification.sopOutputs, [1, 1, 1, 1]);
  assert.deepEqual(o.verification.posOutputs, [1, 1, 1, 1]);
});

test('minimizeBoolean exposes essential primes and metrics', function () {
  var r = LG.minimizeBoolean(3, [0, 1, 7], []);
  assert.ok(r.essentialPrimeImplicants.length >= 1);
  assert.equal(typeof r.metrics.gateCount.total, 'number');
  assert.equal(r.metrics.propagationDelayUnits, 'ns');
  assert.equal(r.metrics.sopVsPos.recommended === 'SOP' || r.metrics.sopVsPos.recommended === 'POS', true);
});

test('minimizeBoolean reports don\'t care assignments', function () {
  var r = LG.minimizeBoolean(2, [0], [3]);
  assert.deepEqual(r.dontCares, [3]);
  assert.equal(r.verification.dontCareAssignments.length, 1);
});

test('minimizeBoolean rejects overlapping minterm and don\'t care lists', function () {
  assert.throws(function () { LG.minimizeBoolean(2, [1], [1]); }, /also listed/);
});

test('minimizeBoolean rejects invalid variable counts', function () {
  assert.throws(function () { LG.minimizeBoolean(0, [], []); }, /between 1/);
  assert.throws(function () { LG.minimizeBoolean(17, [], []); }, /between 1/);
});

test('solvePetrick is an alias of minimizeBoolean', function () {
  var a = LG.solvePetrick(3, [1, 3, 5], []);
  var b = LG.minimizeBoolean(3, [1, 3, 5], []);
  assert.deepEqual(a.sop.terms, b.sop.terms);
});

test('karnaughMap uses Gray coded adjacency', function () {
  var k = LG.karnaughMap(4, [0], []);
  assert.equal(k.rows, 4);
  assert.equal(k.cols, 4);
  assert.deepEqual(k.grayOrder.rows, [0, 1, 3, 2]);
  assert.deepEqual(k.grayOrder.cols, [0, 1, 3, 2]);
  assert.equal(k.cells[0][0].minterm, 0);
  assert.equal(k.cells[1][0].minterm, 4);
  assert.equal(k.cells[3][0].minterm, 8);
});

test('karnaughMap marks ones and don\'t cares', function () {
  var k = LG.karnaughMap(2, [0, 3], [1]);
  assert.equal(k.cells[0][0].value, 1);
  assert.equal(k.cells[0][1].value, 'X');
  assert.equal(k.cells[1][0].value, 0);
  assert.equal(k.cells[1][1].value, 1);
});

test('karnaughMap supports two and three variables', function () {
  assert.equal(LG.karnaughMap(2, [], []).size, 4);
  assert.equal(LG.karnaughMap(3, [], []).size, 8);
  assert.throws(function () { LG.karnaughMap(5, [], []); }, /2 to 4/);
});

test('SOP and POS outputs agree with every care input for all 2 variable functions', function () {
  for (var mask = 0; mask < 16; mask += 1) {
    for (var dcMask = 0; dcMask < 16; dcMask += 1) {
      if (mask & dcMask) continue;
      var on = [], dc = [];
      for (var m = 0; m < 4; m += 1) {
        if (mask & (1 << m)) on.push(m);
        if (dcMask & (1 << m)) dc.push(m);
      }
      var r = LG.minimizeBoolean(2, on, dc);
      assert.ok(r.verification.sopMatchesCareInputs, 'SOP ' + mask + '/' + dcMask);
      assert.ok(r.verification.posMatchesCareInputs, 'POS ' + mask + '/' + dcMask);
      var expectedTerms = bruteBest(2, on, dc);
      assert.equal(r.sop.termCount, expectedTerms, 'optimal SOP ' + mask + '/' + dcMask);
      var zeros = [0, 1, 2, 3].filter(function (x) { return on.indexOf(x) < 0 && dc.indexOf(x) < 0; });
      assert.equal(r.pos.termCount, bruteBest(2, zeros, dc), 'optimal POS ' + mask + '/' + dcMask);
    }
  }
});

test('SOP and POS outputs agree with every care input for all 3 variable functions', function () {
  for (var mask = 0; mask < 256; mask += 1) {
    var on = [], dc = [];
    for (var m = 0; m < 8; m += 1) if (mask & (1 << m)) on.push(m);
    var r = LG.minimizeBoolean(3, on, dc);
    assert.ok(r.verification.sopMatchesCareInputs, 'SOP ' + mask);
    assert.ok(r.verification.posMatchesCareInputs, 'POS ' + mask);
    assert.equal(r.sop.termCount, bruteBest(3, on, dc), 'optimal SOP ' + mask);
  }
});

test('SOP is optimal across 3 variable functions with don\'t cares', function () {
  var checked = 0;
  for (var mask = 0; mask < 256; mask += 1) {
    var dcMask = (mask * 7 + 13) & 255;
    var on = [], dc = [];
    for (var m = 0; m < 8; m += 1) {
      if (mask & (1 << m)) on.push(m);
      else if (dcMask & (1 << m)) dc.push(m);
    }
    var r = LG.minimizeBoolean(3, on, dc);
    assert.ok(r.verification.sopMatchesCareInputs, 'SOP ' + mask + '/' + dcMask);
    assert.equal(r.sop.termCount, bruteBest(3, on, dc), 'optimal SOP ' + mask + '/' + dcMask);
    checked += 1;
  }
  assert.equal(checked, 256);
});

test('SOP is optimal across sampled 4 variable functions with don\'t cares', function () {
  var checked = 0;
  for (var seed = 0; seed < 96; seed += 1) {
    var x = (seed * 2654435761 + 1013904223) >>> 0;
    var on = [], dc = [];
    for (var m = 0; m < 16; m += 1) {
      var bit = (x >>> m) & 1;
      var d = (x >>> (16 + (m % 8))) & 1;
      if (bit) on.push(m); else if (d) dc.push(m);
    }
    var r = LG.minimizeBoolean(4, on, dc);
    assert.ok(r.verification.sopMatchesCareInputs, 'SOP seed ' + seed);
    assert.ok(r.verification.posMatchesCareInputs, 'POS seed ' + seed);
    assert.equal(r.sop.termCount, bruteBest(4, on, dc), 'optimal SOP seed ' + seed);
    checked += 1;
  }
  assert.equal(checked, 96);
});

test('simulateNetlist runs XOR and NOT', function () {
  var r = LG.simulateNetlist({
    inputs: ['A', 'B'],
    outputs: [{ node: 'x', port: 'y', name: 'y' }, { node: 'n', port: 'y', name: 'ny' }],
    nodes: [{ id: 'x', type: 'XOR' }, { id: 'n', type: 'NOT' }],
    edges: [
      { from: 'IN:A', to: 'x', toPort: 0 }, { from: 'IN:B', to: 'x', toPort: 1 },
      { from: 'x', fromPort: 'y', to: 'n', toPort: 0 }
    ]
  }, [0, 1, 2, 3]);
  assert.deepEqual(r.cycles.map(function (c) { return c.outputs.y; }), [0, 1, 1, 0]);
  assert.deepEqual(r.cycles.map(function (c) { return c.outputs.ny; }), [1, 0, 0, 1]);
});

test('simulateNetlist accepts bare input names as edge sources', function () {
  var r = LG.simulateNetlist({
    inputs: ['A', 'B'],
    nodes: [{ id: 'g', type: 'AND' }],
    outputs: [{ node: 'g', port: 'y', name: 'y' }],
    edges: [{ from: 'A', to: 'g', toPort: 0 }, { from: 'B', to: 'g', toPort: 1 }]
  }, [0, 1, 2, 3]);
  assert.deepEqual(r.cycles.map(function (c) { return c.outputs.y; }), [0, 0, 0, 1]);
});

test('simulateNetlist computes half adder and full adder', function () {
  var ha = LG.simulateNetlist({
    inputs: ['A', 'B'],
    nodes: [{ id: 'ha', type: 'HALF_ADDER' }],
    outputs: [{ node: 'ha', port: 'sum', name: 's' }, { node: 'ha', port: 'carry', name: 'c' }],
    edges: [{ from: 'IN:A', to: 'ha', toPort: 0 }, { from: 'IN:B', to: 'ha', toPort: 1 }]
  }, [0, 1, 2, 3]);
  assert.deepEqual(ha.cycles.map(function (c) { return [c.outputs.s, c.outputs.c]; }),
    [[0, 0], [1, 0], [1, 0], [0, 1]]);
  var fa = LG.simulateNetlist({
    inputs: ['A', 'B', 'CIN'],
    nodes: [{ id: 'fa', type: 'FULL_ADDER' }],
    outputs: [{ node: 'fa', port: 'sum', name: 's' }, { node: 'fa', port: 'carry', name: 'c' }],
    edges: [{ from: 'IN:A', to: 'fa', toPort: 0 }, { from: 'IN:B', to: 'fa', toPort: 1 },
      { from: 'IN:CIN', to: 'fa', toPort: 2 }]
  }, [1, 2, 3, 4, 7]);
  assert.deepEqual(fa.cycles.map(function (c) { return [c.outputs.s, c.outputs.c]; }),
    [[1, 0], [1, 0], [0, 1], [1, 0], [1, 1]]);
});

test('simulateNetlist computes MUX2 and DFF state', function () {
  var mux = LG.simulateNetlist({
    inputs: ['D0', 'D1', 'S'],
    nodes: [{ id: 'm', type: 'MUX2' }],
    outputs: [{ node: 'm', port: 'y', name: 'y' }],
    edges: [{ from: 'IN:D0', to: 'm', toPort: 0 }, { from: 'IN:D1', to: 'm', toPort: 1 },
      { from: 'IN:S', to: 'm', toPort: 2 }]
  }, [{ D0: 1, D1: 0, S: 0 }, { D0: 1, D1: 0, S: 1 }]);
  assert.deepEqual(mux.cycles.map(function (c) { return c.outputs.y; }), [1, 0]);
  var dff = LG.simulateNetlist({
    inputs: ['D'],
    nodes: [{ id: 'd', type: 'DFF', init: 0 }],
    outputs: [{ node: 'd', port: 'q', name: 'q' }],
    edges: [{ from: 'IN:D', to: 'd', toPort: 0 }]
  }, [1, 0, 1, 0]);
  assert.deepEqual(dff.cycles.map(function (c) { return c.outputs.q; }), [0, 1, 0, 1]);
  assert.equal(dff.finalState['d:q'], 0);
});

test('simulateNetlist allows a DFF feedback loop and detects sequential logic', function () {
  var netlist = {
    inputs: ['T'],
    outputs: [{ node: 'd', port: 'q', name: 'q' }],
    nodes: [{ id: 'x', type: 'XOR' }, { id: 'd', type: 'DFF', init: 0 }],
    edges: [
      { from: 'IN:T', to: 'x', toPort: 0 }, { from: 'd', fromPort: 'q', to: 'x', toPort: 1 },
      { from: 'x', fromPort: 'y', to: 'd', toPort: 0 }
    ]
  };
  var info = LG.detectCycles(netlist);
  assert.equal(info.hasCycle, true);
  assert.equal(info.isSequential, true);
  assert.equal(info.hasCombinationalCycle, false);
  var r = LG.simulateNetlist(netlist, [1, 1, 1, 1, 1]);
  assert.deepEqual(r.cycles.map(function (c) { return c.outputs.q; }), [0, 1, 0, 1, 0]);
  assert.equal(r.hazards.length, 0);
});

test('detectCycles rejects a combinational loop', function () {
  var netlist = {
    inputs: ['A'],
    nodes: [{ id: 'x', type: 'AND' }, { id: 'y', type: 'OR' }],
    outputs: [{ node: 'y', port: 'y', name: 'y' }],
    edges: [
      { from: 'IN:A', to: 'x', toPort: 0 }, { from: 'y', fromPort: 'y', to: 'x', toPort: 1 },
      { from: 'x', fromPort: 'y', to: 'y', toPort: 0 }, { from: 'IN:A', to: 'y', toPort: 1 }
    ]
  };
  assert.ok(LG.detectCycles(netlist).hasCombinationalCycle);
  assert.throws(function () { LG.simulateNetlist(netlist, [0, 1]); }, /combinational loop/);
});

test('buildGraph validation rejects unknown types and double driven inputs', function () {
  assert.throws(function () {
    LG.simulateNetlist({ inputs: ['A'], nodes: [{ id: 'g', type: 'MYSTERY' }], edges: [] }, [0]);
  }, /unknown node type/);
  assert.throws(function () {
    LG.simulateNetlist({
      inputs: ['A'], nodes: [{ id: 'g', type: 'AND' }],
      edges: [{ from: 'IN:A', to: 'g', toPort: 0 }, { from: 'IN:A', to: 'g', toPort: 0 }]
    }, [0]);
  }, /driven more than once/);
});

test('listPresets returns metadata for every built-in preset', function () {
  var list = LG.listPresets();
  assert.ok(list.length >= 5);
  list.forEach(function (p) {
    assert.equal(typeof p.id, 'string');
    assert.equal(typeof p.label, 'string');
    assert.equal(typeof p.description, 'string');
    assert.ok(p.numVars >= 2);
  });
});

test('getPreset returns an independent copy', function () {
  var p = LG.getPreset('sevenSegmentDecoder');
  p.minterms.push(99);
  assert.equal(LG.getPreset('sevenSegmentDecoder').minterms.indexOf(99), -1);
  assert.throws(function () { LG.getPreset('missing'); }, /unknown preset/);
});

test('seven segment preset minimizes segment a with don\'t cares', function () {
  var p = LG.getPreset('sevenSegmentDecoder');
  var r = LG.minimizeBoolean(p.numVars, p.minterms, p.dontCares, { vars: p.vars });
  assert.ok(r.verification.sopMatchesCareInputs);
  assert.ok(r.sop.termCount <= 4);
  assert.deepEqual(LG.presetTruthTable('sevenSegmentDecoder').slice(0, 10), [1, 0, 1, 1, 0, 1, 1, 1, 1, 1]);
});

test('majority voter preset expression equals its minterm list', function () {
  var p = LG.getPreset('majorityVoter');
  assert.deepEqual(LG.evalTruthTable(p.expr, p.vars).minterms, p.minterms);
  assert.deepEqual(LG.presetTruthTable('majorityVoter'), [0, 0, 0, 1, 0, 1, 1, 1]);
});

test('gray code converter preset expression equals its minterm list', function () {
  var p = LG.getPreset('grayCodeConverter');
  assert.deepEqual(LG.evalTruthTable(p.expr, p.vars).minterms, p.minterms);
});

test('ALU slice preset netlist matches the full adder result vectors', function () {
  var r = LG.simulateNetlist(LG.getPreset('alu4BitSlice').netlist,
    Array.from({ length: 16 }, function (_, i) { return i; }));
  var bad = 0;
  r.cycles.forEach(function (c, v) {
    var A = (v >> 3) & 1, B = (v >> 2) & 1, CIN = (v >> 1) & 1, OP = v & 1;
    var sum = (A ^ OP) ^ B ^ CIN;
    var carry = ((A ^ OP) & B) | (CIN & ((A ^ OP) ^ B));
    if (c.outputs.result !== sum || c.outputs.cout !== carry) bad += 1;
  });
  assert.equal(bad, 0);
  assert.equal(r.hazards.length, 0);
});

test('carry lookahead preset netlist computes C4 for all 512 vectors', function () {
  var table = LG.presetTruthTable('carryLookahead4Bit');
  var r = LG.simulateNetlist(LG.getPreset('carryLookahead4Bit').netlist,
    Array.from({ length: 512 }, function (_, i) { return i; }));
  assert.equal(r.cycles.length, 512);
  r.cycles.forEach(function (c, v) {
    assert.equal(c.outputs.C4, table[v], 'vector ' + v);
  });
});

test('exportVerilog produces a timescaled Verilog-2001 SOP module', function () {
  var v = LG.exportVerilog({ numVars: 2, vars: ['A', 'B'], minterms: [1, 2], dontCares: [], form: 'SOP', moduleName: 'xor2' });
  assert.match(v.module, /^`timescale 1ns\/1ps/);
  assert.match(v.module, /module xor2 \(/);
  assert.match(v.module, /input  wire A/);
  assert.match(v.module, /output wire y/);
  assert.match(v.module, /assign y = \(~A & B\) \| \(A & ~B\);/);
  assert.match(v.module, /`default_nettype none/);
  assert.equal(v.filename, 'xor2.v');
  assert.equal(v.testbenchFilename, 'xor2_tb.v');
  assert.equal(v.vectorCount, 4);
});

test('exportVerilog produces POS products', function () {
  var v = LG.exportVerilog({ numVars: 2, vars: ['A', 'B'], minterms: [1, 2], dontCares: [], form: 'POS', moduleName: 'xor2_pos' });
  assert.match(v.module, /assign y = \(A \| B\) & \(~A \| ~B\);/);
  assert.equal(v.form, 'POS');
});

test('exportVerilog emits constants correctly in both forms', function () {
  assert.match(LG.exportVerilog({ numVars: 2, minterms: [], form: 'SOP' }).module, /assign y = 1'b0;/);
  assert.match(LG.exportVerilog({ numVars: 2, minterms: [0, 1, 2, 3], form: 'SOP' }).module, /assign y = 1'b1;/);
  assert.match(LG.exportVerilog({ numVars: 2, minterms: [], form: 'POS' }).module, /assign y = 1'b0;/);
  assert.match(LG.exportVerilog({ numVars: 2, minterms: [0, 1, 2, 3], form: 'POS' }).module, /assign y = 1'b1;/);
});

test('exportVerilog sanitizes names and resolves expressions', function () {
  var v = LG.exportVerilog({ expr: 'p ^ q', vars: ['p', 'q'], moduleName: 'bad-name', outputName: 'module' });
  assert.match(v.module, /module bad_name \(/);
  assert.match(v.module, /output wire lg_module/);
  assert.match(v.module, /assign lg_module = /);
  assert.equal(v.vectorCount, 4);
  assert.deepEqual(v.spec.minterms, [1, 2]);
});

test('exportVerilog testbench includes don\'t care handling and self checks', function () {
  var v = LG.exportVerilog({ numVars: 2, vars: ['A', 'B'], minterms: [0], dontCares: [3], moduleName: 'dc' });
  assert.match(v.testbench, /function is_dont_care/);
  assert.match(v.testbench, /\$display\("DONT CARE/);
  assert.match(v.testbench, /ALL 4 VECTORS PASS/);
  assert.match(v.testbench, /\.A\(stimulus\[1\]\)/);
  assert.match(v.testbench, /`default_nettype none/);
});

test('exportVerilog testbench honors custom output names', function () {
  var v = LG.exportVerilog({ numVars: 3, minterms: [3, 5, 6, 7], moduleName: 'majority3', outputName: 'vote' });
  assert.match(v.module, /output wire vote/);
  assert.match(v.testbench, /\.vote\(vote\)/);
  assert.equal(v.vectorCount, 8);
});

test('exportVerilog rejects a mismatched variable count', function () {
  assert.throws(function () {
    LG.exportVerilog({ numVars: 3, vars: ['A', 'B'], minterms: [1] });
  }, /must equal vars.length/);
});
