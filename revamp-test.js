/* Third-wave hardening suite. Run with: node --test revamp-test.js
   Independently verifies Quine-McCluskey prime sets against maximal legal
   cube enumeration, exact cover cost against a subset-lattice DP oracle,
   Karnaugh torus adjacency, DAG and D-flip-flop simulation semantics,
   Verilog-2001 identifier sanitization, WCAG 2.1.4 shortcut shutoff and
   focus guards. */
'use strict';
var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var LG = require('./logic.js');
var boot = require('./dom-harness.js').boot;

var REPO = __dirname;

function pc(n) { var c = 0; while (n) { n &= n - 1; c += 1; } return c; }
function keyOf(mask, value) { return mask + ':' + value; }

/* Every legal cube of the on-dc union: covers no zero-care cell. Cubes that
   cover only dont-care cells count, matching classical Quine-McCluskey. */
function legalSopCubes(numVars, onSet, dcSet) {
  var size = 1 << numVars, on = new Set(onSet), dc = new Set(dcSet), out = [];
  for (var mask = 0; mask < size; mask += 1) {
    for (var value = 0; value < size; value += 1) {
      if (value & ~mask) continue;
      var ok = true;
      for (var m = 0; m < size; m += 1) {
        if ((m & mask) !== value) continue;
        if (!on.has(m) && !dc.has(m)) { ok = false; break; }
      }
      if (ok) out.push({ mask: mask, value: value });
    }
  }
  return out;
}

/* c2 subsumes c1 when every cell of c1 is inside c2 (c2 is at least as large). */
function subsumes(c2, c1) {
  return (c2.mask & ~c1.mask) === 0 && (c1.value & c2.mask) === c2.value;
}

/* Prime implicants are exactly the legal cubes no larger legal cube contains. */
function expectedPrimes(numVars, onSet, dcSet) {
  var legal = legalSopCubes(numVars, onSet, dcSet);
  return legal.filter(function (c1) {
    return !legal.some(function (c2) { return c2 !== c1 && subsumes(c2, c1); });
  });
}

function primeKeySet(list) {
  return list.map(function (p) { return keyOf(p.mask, p.value); }).sort();
}

/* Exact optimum on the subset lattice: relax covers in increasing mask order. */
function oracleCost(numVars, on, dc) {
  var size = 1 << numVars;
  if (!on.length) return [0, 0];
  var cubes = legalSopCubes(numVars, on, dc).map(function (c) {
    var bits = 0;
    on.forEach(function (m, i) { if ((m & c.mask) === c.value) bits |= 1 << i; });
    return { bits: bits, lit: pc(c.mask) };
  }).filter(function (c) { return c.bits !== 0; });
  var T = on.length, costs = new Array(1 << T).fill(null);
  costs[0] = [0, 0];
  for (var cov = 0; cov < costs.length; cov += 1) {
    var cur = costs[cov];
    if (!cur) continue;
    for (var i = 0; i < cubes.length; i += 1) {
      var nxt = cov | cubes[i].bits;
      var cand = [cur[0] + 1, cur[1] + cubes[i].lit];
      var old = costs[nxt];
      if (!old || cand[0] < old[0] || (cand[0] === old[0] && cand[1] < old[1])) costs[nxt] = cand;
    }
  }
  return costs[costs.length - 1];
}

/* ------------------------------------------------------------------ *
   Quine-McCluskey and Petrick cover vs independent oracles
 * ------------------------------------------------------------------ */

test('all-dont-care specifications minimize to unconstrained constants', function () {
  [2, 3, 4].forEach(function (n) {
    var dc = [];
    for (var m = 0; m < (1 << n); m += 1) dc.push(m);
    var r = LG.minimizeBoolean(n, [], dc);
    assert.equal(r.sop.expression, '0');
    assert.equal(r.pos.expression, '1');
    assert.equal(r.sop.gateCount.total, 0);
    assert.equal(r.pos.gateCount.total, 0);
    assert.equal(r.verification.dontCareAssignments.length, 1 << n);
    assert.ok(r.verification.sopMatchesCareInputs);
    assert.ok(r.verification.posMatchesCareInputs);
  });
});

test('fully covered care and dc unions still collapse to constant one', function () {
  var r = LG.minimizeBoolean(3, [0, 1, 2, 3], [4, 5, 6, 7]);
  assert.equal(r.sop.expression, '1');
  assert.equal(r.pos.expression, '1');
  assert.equal(r.sop.gateCount.total, 0);
  var partial = LG.minimizeBoolean(3, [0, 1], [2, 3, 4, 5, 6]);
  assert.equal(partial.sop.expression, '~A');
  assert.equal(partial.sop.termCount, 1);
});

test('prime set equals maximal legal cube set for all 81 two-variable specs', function () {
  for (var onM = 0; onM < 16; onM += 1) {
    var rem = ~onM & 15;
    for (var dcM = rem; ; dcM = (dcM - 1) & rem) {
      var on = [], dc = [];
      for (var m = 0; m < 4; m += 1) {
        if (onM & (1 << m)) on.push(m);
        else if (dcM & (1 << m)) dc.push(m);
      }
      var got = primeKeySet(LG.primeImplicants(2, on.concat(dc)));
      var want = primeKeySet(expectedPrimes(2, on, dc));
      assert.deepEqual(got, want, 'on=' + on + ' dc=' + dc);
      if (dcM === 0) break;
    }
  }
});

test('prime set equals maximal legal cube set for all 256 three-variable functions', function () {
  for (var onM = 0; onM < 256; onM += 1) {
    var on = [];
    for (var m = 0; m < 8; m += 1) if (onM & (1 << m)) on.push(m);
    var got = primeKeySet(LG.primeImplicants(3, on));
    var want = primeKeySet(expectedPrimes(3, on, []));
    assert.deepEqual(got, want, 'on=' + on);
  }
});

test('essential primes are exactly the sole covers of care minterms', function () {
  var seed = 977;
  function rand() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
  for (var t = 0; t < 300; t += 1) {
    var on = [], dc = [];
    for (var m = 0; m < 8; m += 1) {
      var u = rand();
      if (u < 0.45) on.push(m); else if (u < 0.65) dc.push(m);
    }
    var primes = expectedPrimes(3, on, dc);
    var expected = {};
    on.forEach(function (m) {
      var covering = primes.filter(function (p) { return (m & p.mask) === p.value; });
      if (covering.length === 1) expected[keyOf(covering[0].mask, covering[0].value)] = true;
    });
    var r = LG.minimizeBoolean(3, on, dc);
    var got = primeKeySet(r.essentialPrimeImplicants);
    assert.deepEqual(got, Object.keys(expected).sort(), 'on=' + on + ' dc=' + dc);
  }
});

test('every three-variable care partition is equivalent and 730 sampled cases are optimal', function () {
  var checked = 0;
  for (var onM = 0; onM < 256; onM += 1) {
    var rem = ~onM & 255;
    for (var dcM = rem; ; dcM = (dcM - 1) & rem) {
      var on = [], dc = [];
      for (var m = 0; m < 8; m += 1) {
        if (onM & (1 << m)) on.push(m);
        else if (dcM & (1 << m)) dc.push(m);
      }
      var r = LG.minimizeBoolean(3, on, dc);
      for (var v = 0; v < 8; v += 1) {
        if (dc.indexOf(v) >= 0) continue;
        var want = on.indexOf(v) >= 0 ? 1 : 0;
        assert.equal(r.verification.sopOutputs[v], want, 'sop m' + v + ' on=' + on + ' dc=' + dc);
        assert.equal(r.verification.posOutputs[v], want, 'pos m' + v + ' on=' + on + ' dc=' + dc);
      }
      if ((onM + dcM * 5) % 9 === 0) {
        var opt = oracleCost(3, on, dc);
        assert.equal(r.sop.termCount, opt[0], 'terms on=' + on + ' dc=' + dc);
        assert.equal(r.sop.literalCount, opt[1], 'literals on=' + on + ' dc=' + dc);
        checked += 1;
      }
      if (dcM === 0) break;
    }
  }
  assert.ok(checked >= 700, 'sampled ' + checked + ' optimal checks');
});

test('five-variable covers match the subset-lattice oracle on 60 seeded specs', function () {
  var seed = 20260721;
  function rand() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
  for (var t = 0; t < 60; t += 1) {
    var target = 1 + Math.floor(rand() * 12);
    var on = [], dc = [];
    for (var m = 0; m < 32; m += 1) {
      var u = rand();
      if (u < 0.35) dc.push(m);
    }
    while (on.length < target) {
      var pick = Math.floor(rand() * 32);
      if (on.indexOf(pick) < 0 && dc.indexOf(pick) < 0) on.push(pick);
    }
    on.sort(function (a, b) { return a - b; });
    var r = LG.minimizeBoolean(5, on, dc);
    var opt = oracleCost(5, on, dc);
    assert.equal(r.sop.termCount, opt[0], 'terms on=' + on + ' dc=' + dc);
    assert.equal(r.sop.literalCount, opt[1], 'literals on=' + on + ' dc=' + dc);
    assert.ok(r.verification.sopMatchesCareInputs);
    assert.ok(r.verification.posMatchesCareInputs);
  }
});

test('five-variable boundary specs behave: full, empty, singleton and single dc', function () {
  var all = []; for (var m = 0; m < 32; m += 1) all.push(m);
  assert.equal(LG.minimizeBoolean(5, all, []).sop.expression, '1');
  assert.equal(LG.minimizeBoolean(5, [], []).sop.expression, '0');
  var one = LG.minimizeBoolean(5, [17], []);
  assert.equal(one.sop.termCount, 1);
  assert.equal(one.sop.literalCount, 5);
  var dcOne = LG.minimizeBoolean(5, [17], [16]);
  assert.equal(dcOne.sop.literalCount, 4);
  assert.deepEqual(dcOne.verification.dontCareAssignments, [{ minterm: 16, sop: 1, pos: 1 }]);
});

test('Petrick cyclic charts resolve to oracle-optimal covers', function () {
  var cases = [
    { n: 4, on: [0, 1, 2, 5, 6, 7], dc: [] },
    { n: 4, on: [0, 3, 5, 6, 9, 10, 12, 15], dc: [] },
    { n: 4, on: [1, 2, 3, 4, 5, 6], dc: [8, 11] },
    { n: 5, on: [1, 2, 3, 4, 5, 6, 17, 18, 19, 20, 21, 22], dc: [] }
  ];
  cases.forEach(function (c) {
    var r = LG.minimizeBoolean(c.n, c.on, c.dc);
    var opt = oracleCost(c.n, c.on, c.dc);
    assert.equal(r.sop.termCount, opt[0], 'terms ' + c.on.join(','));
    assert.equal(r.sop.literalCount, opt[1], 'literals ' + c.on.join(','));
    assert.ok(r.verification.sopMatchesCareInputs);
  });
});

/* ------------------------------------------------------------------ *
   Karnaugh map Gray-code torus
 * ------------------------------------------------------------------ */

test('every K-map edge neighbor, including wrap-around, differs in exactly one bit', function () {
  [2, 3, 4].forEach(function (n) {
    var k = LG.karnaughMap(n, [], []);
    for (var r = 0; r < k.rows; r += 1) {
      for (var c = 0; c < k.cols; c += 1) {
        var cur = k.cells[r][c];
        var right = k.cells[r][(c + 1) % k.cols];
        var down = k.cells[(r + 1) % k.rows][c];
        assert.equal(pc(cur.minterm ^ right.minterm), 1, n + '-var wrap cols at ' + r + ',' + c);
        assert.equal(pc(cur.minterm ^ down.minterm), 1, n + '-var wrap rows at ' + r + ',' + c);
      }
    }
  });
});

test('K-map cell placement is a bijection over all minterms', function () {
  [2, 3, 4].forEach(function (n) {
    var k = LG.karnaughMap(n, [], []);
    var seen = [];
    k.cells.forEach(function (row) { row.forEach(function (cell) { seen.push(cell.minterm); }); });
    seen.sort(function (a, b) { return a - b; });
    assert.deepEqual(seen, Array.from({ length: 1 << n }, function (_, i) { return i; }));
  });
});

test('K-map cell values reflect on, off and dc states across the wrap edge', function () {
  var k = LG.karnaughMap(4, [0, 2, 8, 10], [5]);
  var byM = {};
  k.cells.forEach(function (row) { row.forEach(function (cell) { byM[cell.minterm] = cell; }); });
  assert.equal(byM[0].value, 1);
  assert.equal(byM[10].value, 1);
  assert.equal(byM[5].value, 'X');
  assert.equal(byM[15].value, 0);
  /* m0 and m8 are a wrap pair in the row axis; m0 and m2 in the column axis. */
  assert.notEqual(byM[0].row, byM[8].row);
  assert.equal(pc(byM[0].minterm ^ byM[8].minterm), 1);
});

/* ------------------------------------------------------------------ *
   Netlist DAG, DFF and cycle handling
 * ------------------------------------------------------------------ */

test('DAG evaluation is independent of node declaration order', function () {
  var net = {
    inputs: ['A', 'B', 'C'],
    outputs: [{ node: 'z', port: 'y', name: 'z' }],
    nodes: [{ id: 'z', type: 'AND' }, { id: 'x', type: 'OR' }, { id: 'w', type: 'NOT' }],
    edges: [
      { from: 'IN:A', to: 'w', toPort: 0 },
      { from: 'w', fromPort: 'y', to: 'x', toPort: 0 }, { from: 'IN:B', to: 'x', toPort: 1 },
      { from: 'x', fromPort: 'y', to: 'z', toPort: 0 }, { from: 'IN:C', to: 'z', toPort: 1 }
    ]
  };
  var r = LG.simulateNetlist(net, [0, 1, 2, 3, 4, 5, 6, 7]);
  r.cycles.forEach(function (c, v) {
    var A = (v >> 2) & 1, B = (v >> 1) & 1, C = v & 1;
    assert.equal(c.outputs.z, (B | (1 - A)) & C, 'vector ' + v);
  });
});

test('self-loop and three-node combinational rings are rejected', function () {
  var self = { inputs: [], nodes: [{ id: 's', type: 'BUF' }], edges: [{ from: 's', fromPort: 'y', to: 's', toPort: 0 }] };
  assert.ok(LG.detectCycles(self).hasCombinationalCycle);
  assert.throws(function () { LG.simulateNetlist(self, [{}]); }, /combinational/);
  var ring = {
    inputs: [], nodes: [{ id: 'a', type: 'NOT' }, { id: 'b', type: 'NOT' }, { id: 'c', type: 'NOT' }],
    edges: [
      { from: 'a', fromPort: 'y', to: 'b', toPort: 0 },
      { from: 'b', fromPort: 'y', to: 'c', toPort: 0 },
      { from: 'c', fromPort: 'y', to: 'a', toPort: 0 }
    ]
  };
  assert.ok(LG.detectCycles(ring).hasCombinationalCycle);
  assert.throws(function () { LG.simulateNetlist(ring, [{}]); }, /combinational/);
});

test('mixed sequential and combinational cycles are classified separately', function () {
  var net = {
    inputs: ['T'],
    nodes: [{ id: 'x', type: 'AND' }, { id: 'y', type: 'OR' }, { id: 'd', type: 'DFF' }, { id: 'e', type: 'NOT' }],
    outputs: [{ node: 'd', port: 'q', name: 'q' }],
    edges: [
      { from: 'y', fromPort: 'y', to: 'x', toPort: 0 }, { from: 'x', fromPort: 'y', to: 'y', toPort: 0 },
      { from: 'IN:T', to: 'x', toPort: 1 }, { from: 'IN:T', to: 'y', toPort: 1 },
      { from: 'e', fromPort: 'y', to: 'd', toPort: 0 }, { from: 'd', fromPort: 'q', to: 'e', toPort: 0 }
    ]
  };
  var info = LG.detectCycles(net);
  assert.equal(info.hasCycle, true);
  assert.equal(info.hasCombinationalCycle, true);
  assert.equal(info.isSequential, true);
  assert.throws(function () { LG.simulateNetlist(net, [0]); }, /combinational loop/);
});

test('paired DFFs exchange state non-blockingly on each clock edge', function () {
  var r = LG.simulateNetlist({
    inputs: [],
    nodes: [{ id: 'a', type: 'DFF', init: 1 }, { id: 'b', type: 'DFF', init: 0 }],
    edges: [{ from: 'a', fromPort: 'q', to: 'b', toPort: 0 }, { from: 'b', fromPort: 'q', to: 'a', toPort: 0 }],
    outputs: [{ node: 'a', port: 'q', name: 'qa' }, { node: 'b', port: 'q', name: 'qb' }]
  }, [{}, {}, {}, {}]);
  assert.deepEqual(r.cycles.map(function (c) { return [c.outputs.qa, c.outputs.qb]; }),
    [[1, 0], [0, 1], [1, 0], [0, 1]]);
});

test('three-stage Johnson counter matches its independent oracle for eight edges', function () {
  var net = {
    inputs: [],
    nodes: [{ id: 'n0', type: 'NOT' }, { id: 'q0', type: 'DFF' }, { id: 'q1', type: 'DFF' }, { id: 'q2', type: 'DFF' }],
    edges: [
      { from: 'q2', fromPort: 'q', to: 'n0', toPort: 0 }, { from: 'n0', fromPort: 'y', to: 'q0', toPort: 0 },
      { from: 'q0', fromPort: 'q', to: 'q1', toPort: 0 }, { from: 'q1', fromPort: 'q', to: 'q2', toPort: 0 }
    ],
    outputs: [{ node: 'q0', port: 'q', name: 'b0' }, { node: 'q1', port: 'q', name: 'b1' }, { node: 'q2', port: 'q', name: 'b2' }]
  };
  var expected = ['000', '100', '110', '111', '011', '001', '000', '100'];
  var r = LG.simulateNetlist(net, [{}, {}, {}, {}, {}, {}, {}, {}]);
  assert.deepEqual(r.cycles.map(function (c) { return '' + c.outputs.b0 + c.outputs.b1 + c.outputs.b2; }), expected);
});

test('undriven DFF reads 0 after the first edge and reports it honestly', function () {
  var r = LG.simulateNetlist({
    inputs: [], nodes: [{ id: 'd', type: 'DFF', init: 1 }],
    outputs: [{ node: 'd', port: 'q', name: 'q' }]
  }, [{}, {}]);
  assert.deepEqual(r.cycles.map(function (c) { return c.outputs.q; }), [1, 0]);
  var hazard = r.hazards.filter(function (h) { return h.type === 'undriven-input' && h.node === 'd'; });
  assert.equal(hazard.length, 1);
  assert.match(hazard[0].message, /reads 0/);
  assert.doesNotMatch(hazard[0].message, /holds/);
});

test('numeric, array and object input vectors produce identical outputs', function () {
  var net = {
    inputs: ['A', 'B'],
    nodes: [{ id: 'g', type: 'AND' }],
    outputs: [{ node: 'g', port: 'y', name: 'y' }],
    edges: [{ from: 'IN:A', to: 'g', toPort: 0 }, { from: 'IN:B', to: 'g', toPort: 1 }]
  };
  var numeric = LG.simulateNetlist(net, [0, 1, 2, 3]).cycles.map(function (c) { return c.outputs.y; });
  var array = LG.simulateNetlist(net, [[0, 0], [0, 1], [1, 0], [1, 1]]).cycles.map(function (c) { return c.outputs.y; });
  var object = LG.simulateNetlist(net, [{ A: 0, B: 0 }, { A: 0, B: 1 }, { A: 1, B: 0 }, { A: 1, B: 1 }]).cycles.map(function (c) { return c.outputs.y; });
  assert.deepEqual(numeric, [0, 0, 0, 1]);
  assert.deepEqual(array, numeric);
  assert.deepEqual(object, numeric);
});

test('two-bit ripple adder equals integer addition on all 32 vectors', function () {
  var net = {
    inputs: ['A1', 'A0', 'B1', 'B0', 'CIN'],
    nodes: [{ id: 'f0', type: 'FULL_ADDER' }, { id: 'f1', type: 'FULL_ADDER' }],
    edges: [
      { from: 'IN:A0', to: 'f0', toPort: 0 }, { from: 'IN:B0', to: 'f0', toPort: 1 }, { from: 'IN:CIN', to: 'f0', toPort: 2 },
      { from: 'IN:A1', to: 'f1', toPort: 0 }, { from: 'IN:B1', to: 'f1', toPort: 1 }, { from: 'f0', fromPort: 'carry', to: 'f1', toPort: 2 }
    ],
    outputs: [{ node: 'f0', port: 'sum', name: 's0' }, { node: 'f1', port: 'sum', name: 's1' }, { node: 'f1', port: 'carry', name: 'c2' }]
  };
  var r = LG.simulateNetlist(net, Array.from({ length: 32 }, function (_, i) { return i; }));
  r.cycles.forEach(function (c, v) {
    var a = ((v >> 4) & 1) * 2 + ((v >> 3) & 1);
    var b = ((v >> 2) & 1) * 2 + ((v >> 1) & 1);
    var sum = a + b + (v & 1);
    assert.equal(c.outputs.s0 + 2 * c.outputs.s1 + 4 * c.outputs.c2, sum, 'vector ' + v);
  });
});

test('duplicate output names and missing output ports are rejected', function () {
  var base = {
    inputs: ['A'], nodes: [{ id: 'g', type: 'NOT' }],
    edges: [{ from: 'IN:A', to: 'g', toPort: 0 }]
  };
  assert.throws(function () {
    LG.simulateNetlist(Object.assign({}, base, {
      outputs: [{ node: 'g', port: 'y', name: 'o' }, { node: 'g', port: 'y', name: 'o' }]
    }), [0]);
  }, /duplicate output name/);
  assert.throws(function () {
    LG.simulateNetlist(Object.assign({}, base, {
      outputs: [{ node: 'g', port: 'zzz', name: 'o' }]
    }), [0]);
  }, /missing node or port/);
});

test('every gate type computes its documented truth table', function () {
  function one(type, edges, vectors, params, init) {
    var nodes = [{ id: 'g', type: type }];
    if (params) nodes[0].params = params;
    if (init != null) nodes[0].init = init;
    var r = LG.simulateNetlist({
      inputs: ['A', 'B', 'C'], nodes: nodes,
      edges: edges, outputs: [{ node: 'g', port: type === 'DFF' ? 'q' : 'y', name: 'y' }]
    }, vectors);
    return r.cycles.map(function (c) { return c.outputs.y; });
  }
  function dual(type) { return [{ from: 'IN:A', to: 'g', toPort: 0 }, { from: 'IN:B', to: 'g', toPort: 1 }]; }
  /* inputs are A,B,C so vectors [0,2,4,6] sweep A,B as 00,01,10,11. */
  var ab = [0, 2, 4, 6];
  assert.deepEqual(one('AND', dual(), ab), [0, 0, 0, 1]);
  assert.deepEqual(one('OR', dual(), ab), [0, 1, 1, 1]);
  assert.deepEqual(one('XOR', dual(), ab), [0, 1, 1, 0]);
  assert.deepEqual(one('NAND', dual(), ab), [1, 1, 1, 0]);
  assert.deepEqual(one('NOR', dual(), ab), [1, 0, 0, 0]);
  assert.deepEqual(one('XNOR', dual(), ab), [1, 0, 0, 1]);
  assert.deepEqual(one('NOT', [{ from: 'IN:A', to: 'g', toPort: 0 }], ab), [1, 1, 0, 0]);
  assert.deepEqual(one('BUF', [{ from: 'IN:A', to: 'g', toPort: 0 }], ab), [0, 0, 1, 1]);
  assert.deepEqual(one('MUX2', [
    { from: 'IN:A', to: 'g', toPort: 0 }, { from: 'IN:B', to: 'g', toPort: 1 }, { from: 'IN:C', to: 'g', toPort: 2 }
  ], [0, 1, 2, 3, 4, 5, 6, 7]), [0, 0, 0, 1, 1, 0, 1, 1]);
  assert.deepEqual(one('CONST', [], [0], { value: 1 }), [1]);
  assert.deepEqual(one('DFF', [{ from: 'IN:A', to: 'g', toPort: 0 }], ab, null, 1), [1, 0, 0, 1]);
});

/* ------------------------------------------------------------------ *
   Verilog-2001 identifier sanitization and structural validity
 * ------------------------------------------------------------------ */

test('identifier sanitization covers keywords, leading digits, punctuation and unicode', function () {
  var b1 = LG.exportVerilog({ numVars: 2, vars: ['A', 'B'], minterms: [1], moduleName: 'a-b', outputName: 'o-o' });
  assert.match(b1.module, /module a_b /);
  assert.match(b1.module, /output wire o_o/);
  var b2 = LG.exportVerilog({ numVars: 2, minterms: [1], moduleName: '9lives', outputName: '4out' });
  assert.match(b2.moduleName, /^[A-Za-z_]/);
  assert.match(b2.module, /module lg_module_9lives /);
  assert.match(b2.module, /output wire lg_out_4out/);
  var b3 = LG.exportVerilog({ numVars: 2, minterms: [1], moduleName: 'endmodule', outputName: 'wire' });
  assert.equal(b3.moduleName, 'lg_endmodule');
  assert.equal(b3.outputName, 'lg_wire');
  var b4 = LG.exportVerilog({ numVars: 2, minterms: [1], moduleName: 'mødüle', outputName: 'y' });
  assert.match(b4.moduleName, /^[A-Za-z_][A-Za-z0-9_]*$/);
  assert.equal(b4.moduleName, 'm_d_le');
});

test('Verilog keyword variables are renamed and round-trip verified', function () {
  var bundle = LG.exportVerilog({ numVars: 2, vars: ['wire', 'always'], minterms: [1, 2], moduleName: 'kw_vars' });
  assert.deepEqual(bundle.inputNames, ['lg_wire', 'lg_always']);
  assert.equal(LG.verifyVerilog(bundle).passes, true);
  assert.match(bundle.module, /input\s+wire\s+lg_wire/);
});

test('sanitized collisions keep every identifier unique', function () {
  var bundle = LG.exportVerilog({ numVars: 2, vars: ['lg_wire', 'wire'], minterms: [0, 1], moduleName: 'dup_san' });
  assert.equal(new Set(bundle.inputNames).size, 2);
  assert.equal(LG.verifyVerilog(bundle).passes, true);
  var collide = LG.exportVerilog({ numVars: 2, vars: ['A', 'B'], minterms: [1, 2], outputName: 'A' });
  assert.equal(collide.outputName, 'A_1');
  assert.match(collide.module, /output wire A_1/);
  assert.equal(LG.verifyVerilog(collide).passes, true);
});

test('testbench locals never collide with reserved local names', function () {
  ['stimulus', 'errors', 'i', 'expected', 'is_dont_care', 'dut'].forEach(function (name) {
    var bundle = LG.exportVerilog({ numVars: 2, vars: ['A', 'B'], minterms: [1, 2], outputName: name, moduleName: 'collision_' + name });
    var decls = bundle.testbench.match(/\b(reg|wire|integer)\s+(\[[^\]]+\]\s+)?[A-Za-z_][A-Za-z0-9_]*/g) || [];
    var seen = new Set();
    decls.forEach(function (d) {
      var id = d.match(/[A-Za-z_][A-Za-z0-9_]*$/)[0];
      assert.ok(!seen.has(id), 'duplicate local ' + id + ' for output ' + name);
      seen.add(id);
    });
    assert.equal(LG.verifyVerilog(bundle).passes, true, name);
  });
});

test('verifyVerilog rejects missing, extra or mismatched assigns', function () {
  var bundle = LG.exportVerilog({ numVars: 2, minterms: [1, 2] });
  var noAssign = Object.assign({}, bundle, { module: bundle.module.replace(/assign[^;]+;/, '') });
  assert.throws(function () { LG.verifyVerilog(noAssign); }, /unsupported|malformed/);
  var twoAssign = Object.assign({}, bundle, { module: bundle.module.replace('endmodule', 'assign y = 1\'b0;\nendmodule') });
  assert.throws(function () { LG.verifyVerilog(twoAssign); }, /unsupported|malformed/);
  var wrongNet = Object.assign({}, bundle, { module: bundle.module.replace(/assign y/, 'assign zzz') });
  assert.throws(function () { LG.verifyVerilog(wrongNet); }, /unsupported|malformed/);
});

test('export form is case insensitive and always normalized', function () {
  var pos = LG.exportVerilog({ numVars: 2, minterms: [1, 2], form: 'pos' });
  var sop = LG.exportVerilog({ numVars: 2, minterms: [1, 2], form: 'sop' });
  assert.equal(pos.form, 'POS');
  assert.equal(sop.form, 'SOP');
  assert.notEqual(pos.module, sop.module);
});

test('single-variable exports emit legal vector widths', function () {
  var bundle = LG.exportVerilog({ numVars: 1, vars: ['A'], minterms: [1], moduleName: 'one_bit' });
  assert.match(bundle.testbench, /reg\s+\[0:0\]\s+stimulus/);
  assert.match(bundle.testbench, /input \[0:0\] s/);
  assert.equal(LG.verifyVerilog(bundle).passes, true);
});

test('module and testbench filenames track the sanitized module name', function () {
  var bundle = LG.exportVerilog({ numVars: 2, minterms: [1], moduleName: 'my-mod' });
  assert.equal(bundle.filename, 'my_mod.v');
  assert.equal(bundle.testbenchFilename, 'my_mod_tb.v');
  assert.match(bundle.testbench, /module my_mod_tb/);
});

test('dont-care vectors produce labeled testbench branches and a passing check', function () {
  var bundle = LG.exportVerilog({ numVars: 2, vars: ['A', 'B'], minterms: [3], dontCares: [1, 2], moduleName: 'dc_case' });
  assert.match(bundle.testbench, /DONT CARE %0d/);
  var check = LG.verifyVerilog(bundle);
  assert.equal(check.passes, true);
  assert.equal(check.checked, 2);
  assert.equal(check.total, 4);
});

test('expression-only export with dont-cares honors the supplied spec', function () {
  var bundle = LG.exportVerilog({ expr: 'A ^ B', dontCares: [0], moduleName: 'expr_dc' });
  assert.equal(bundle.spec.numVars, 2);
  assert.deepEqual(bundle.spec.dontCares, [0]);
  assert.equal(LG.verifyVerilog(bundle).checked, 3);
});

test('proof JSON echoes the real spec, hazards and round-trip result', function () {
  var proof = JSON.parse(LG.exportVerificationJSON({
    numVars: 3, vars: ['A', 'B', 'C'], minterms: [1, 3, 6, 7], moduleName: 'haz'
  }));
  assert.equal(proof.format, 'logicgate-verification');
  assert.equal(proof.specification.numVars, 3);
  assert.equal(proof.verification.rtl.passes, true);
  assert.equal(proof.staticHazards.sop.length, 1);
});

/* ------------------------------------------------------------------ *
   WCAG 2.1.4 shortcut toggle and focus guards (real DOM controller)
 * ------------------------------------------------------------------ */

function bench(options) {
  var h = boot(REPO, options);
  assert.deepEqual(h.errors, []);
  return h;
}
function cell(h, m) { return h.get('kmapWrap').querySelector('[data-minterm="' + m + '"]'); }

test('keyboard shortcut toggle exists, is on by default and has an accessible name', function () {
  var h = bench();
  var box = h.get('keyShortcuts');
  assert.equal(box.localName, 'input');
  assert.equal(box.type, 'checkbox');
  assert.equal(box.checked, true);
  assert.match(box.parentElement.textContent, /Keyboard shortcuts/);
  h.dispose();
});

test('turning shortcuts off disables map arrow navigation without touching the function', function () {
  var h = bench();
  h.get('keyShortcuts').click();
  var before = h.get('mintermInput').value;
  cell(h, 0).focus();
  h.key(cell(h, 0), 'ArrowLeft');
  assert.equal(h.document.activeElement, cell(h, 0));
  h.key(cell(h, 0), 'Home');
  assert.equal(h.document.activeElement, cell(h, 0));
  assert.equal(h.get('mintermInput').value, before);
  h.get('keyShortcuts').click();
  h.key(cell(h, 0), 'ArrowLeft');
  assert.equal(h.document.activeElement, cell(h, 2));
  h.dispose();
});

test('wave rects lose keyboard reachability when shortcuts are off but keep pointer inspection', function () {
  var h = bench();
  var hits = h.get('waveformSvg').querySelectorAll('.wave-hit');
  assert.ok(hits.length > 0);
  h.get('keyShortcuts').click();
  var rects = h.get('waveformSvg').querySelectorAll('[data-vector]');
  assert.ok(rects.length > 0);
  rects.forEach(function (r) {
    assert.equal(r.getAttribute('tabindex'), null);
    assert.equal(r.getAttribute('role'), null);
  });
  assert.equal(h.get('waveformSvg').querySelectorAll('.wave-hit').length, 0);
  h.event(rects[0], 'pointerover');
  assert.match(h.get('probeVector').textContent, /Vector \d+/);
  h.dispose();
});

test('Enter on a wave rect inspects only while shortcuts are on', function () {
  var h = bench();
  var rect = h.get('waveformSvg').querySelector('[data-vector="3"]');
  h.key(rect, 'Enter');
  assert.match(h.get('probeVector').textContent, /Vector 3/);
  h.get('keyShortcuts').click();
  var rect2 = h.get('waveformSvg').querySelector('[data-vector="5"]');
  h.key(rect2, 'Enter');
  assert.doesNotMatch(h.get('probeVector').textContent, /Vector 5/);
  h.dispose();
});

test('the shortcut preference persists across sessions through storage', function () {
  var h = bench({ beforeBoot: function (ctx) { ctx.sandbox.localStorage.setItem('logicgate-mapkeys', '0'); } });
  assert.equal(h.get('keyShortcuts').checked, false);
  cell(h, 0).focus();
  h.key(cell(h, 0), 'ArrowLeft');
  assert.equal(h.document.activeElement, cell(h, 0));
  h.get('keyShortcuts').click();
  h.key(cell(h, 0), 'ArrowLeft');
  assert.equal(h.document.activeElement, cell(h, 2));
  h.dispose();
});

test('K-map redraws restore focus to the same minterm cell', function () {
  var h = bench();
  cell(h, 5).focus();
  h.get('showGroups').click();
  assert.equal(h.document.activeElement, cell(h, 5));
  h.get('showTexture').click();
  assert.equal(h.document.activeElement, cell(h, 5));
  h.dispose();
});

test('theme re-renders keep focus on the same wave vector and probe toggle', function () {
  var h = bench();
  var rect = h.get('waveformSvg').querySelector('[data-vector="3"]');
  rect.focus();
  h.get('themeToggle').click();
  var after = h.document.activeElement;
  assert.equal(after && after.getAttribute('data-vector'), '3');
  h.get('themeToggle').click();
  var btn = h.get('probeInputs').querySelector('[data-input="1"]');
  btn.focus();
  h.get('themeToggle').click();
  var after2 = h.document.activeElement;
  assert.equal(after2 && after2.getAttribute('data-input'), '1');
  h.dispose();
});

test('focus outside a re-rendered host is never stolen', function () {
  var h = bench();
  cell(h, 0).focus();
  h.get('exprInput').focus();
  h.get('showGroups').click();
  assert.equal(h.document.activeElement, h.get('exprInput'));
  h.dispose();
});

/* ------------------------------------------------------------------ *
   Hygiene and suite wiring
 * ------------------------------------------------------------------ */

test('shipped files carry no model, vendor or assistant mentions', function () {
  ['index.html', 'app.js', 'logic.js', 'style.css', 'README.md', 'DEVPOST_UPGRADE.md', 'CITATION.cff'].forEach(function (f) {
    var text = fs.readFileSync(path.join(REPO, f), 'utf8');
    [/\bAI\b/i, /artificial intelligence/i, /ChatGPT/i, /Claude\b/i, /Copilot/i, /Gemini\b/i, /\bGPT-?[0-9.]*/i, /\bLLM\b/i, /OpenAI/i, /Anthropic/i, /Devin\b/i].forEach(function (re) {
      assert.ok(!re.test(text), f + ' matched ' + re);
    });
  });
});

test('shipped files stay free of em and en dashes and smooth scrolling', function () {
  ['index.html', 'app.js', 'logic.js', 'style.css', 'README.md', 'DEVPOST_UPGRADE.md'].forEach(function (f) {
    var text = fs.readFileSync(path.join(REPO, f), 'utf8');
    ['—', '–', '‑', '‒', '―'].forEach(function (d) {
      assert.ok(!text.includes(d), f + ' contains U+' + d.codePointAt(0).toString(16));
    });
    assert.ok(!/scroll-behavior/.test(text), f + ' sets scroll-behavior');
  });
});

test('runtime files make no network requests and use no external assets', function () {
  ['index.html', 'app.js', 'logic.js', 'style.css'].forEach(function (f) {
    var text = fs.readFileSync(path.join(REPO, f), 'utf8');
    ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'import(',
      'src="http', 'href="http', 'url(http', '@import'].forEach(function (needle) {
      assert.ok(!text.includes(needle), f + ' references ' + needle);
    });
  });
});

test('package test script and CI both run every suite file', function () {
  var pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  var suites = ['test.js', 'regression-test.js', 'export-test.js', 'ui-test.js', 'adversarial-test.js', 'revamp-test.js'];
  suites.forEach(function (f) {
    assert.ok(pkg.scripts.test.includes(f), 'package.json test script misses ' + f);
  });
  var ci = fs.readFileSync(path.join(REPO, '.github/workflows/ci.yml'), 'utf8');
  assert.ok(/npm test|revamp-test\.js/.test(ci), 'CI does not run the full suite');
});

/* ------------------------------------------------------------------ *
   Pass 2 adversarial-audit regressions
 * ------------------------------------------------------------------ */

test('typed-array and array-like vectors feed real values, not silent zeros', function () {
  var net = {
    inputs: ['A', 'B'], nodes: [{ id: 'a', type: 'AND' }],
    edges: [{ from: 'IN:A', to: 'a', toPort: 0 }, { from: 'IN:B', to: 'a', toPort: 1 }],
    outputs: [{ node: 'a', port: 'y' }]
  };
  var r = LG.simulateNetlist(net, [new Uint8Array([1, 1]), new Uint8Array([1, 0]), new Int32Array([0, 1])]);
  assert.deepEqual(r.cycles.map(function (c) { return c.outputs.a_y; }), [1, 0, 0]);
  var named = LG.simulateNetlist({
    inputs: ['length', 'A'], nodes: [{ id: 'a', type: 'AND' }],
    edges: [{ from: 'IN:length', to: 'a', toPort: 0 }, { from: 'IN:A', to: 'a', toPort: 1 }],
    outputs: [{ node: 'a', port: 'y' }]
  }, [{ length: 1, A: 1 }]);
  assert.equal(named.cycles[0].outputs.a_y, 1);
});

test('deep netlists in any node order evaluate without stack overflow', function () {
  var N = 8000, i, nodes = [], edges = [{ from: 'IN:A', to: 'g0', toPort: 0 }];
  for (i = 0; i < N; i += 1) {
    nodes.push({ id: 'g' + i, type: 'BUF' });
    if (i > 0) edges.push({ from: 'g' + (i - 1), to: 'g' + i, toPort: 0 });
  }
  var net = { inputs: ['A'], nodes: nodes, edges: edges, outputs: [{ node: 'g' + (N - 1), port: 'y' }] };
  var fwd = LG.simulateNetlist(net, [0, 1]);
  assert.deepEqual(fwd.cycles.map(function (c) { return c.outputs['g' + (N - 1) + '_y']; }), [0, 1]);
  var rev = LG.simulateNetlist({ inputs: net.inputs, nodes: nodes.slice().reverse(), edges: edges, outputs: net.outputs }, [0, 1]);
  assert.deepEqual(rev.cycles.map(function (c) { return c.outputs['g' + (N - 1) + '_y']; }), [0, 1]);
  assert.equal(LG.detectCycles({ inputs: net.inputs, nodes: nodes.slice().reverse(), edges: edges, outputs: net.outputs }).hasCycle, false);
});

test('a wave output row that shares an input name shows output data', function () {
  var r = LG.simulateNetlist({
    inputs: ['A'], nodes: [{ id: 'n', type: 'NOT' }],
    edges: [{ from: 'IN:A', to: 'n', toPort: 0 }],
    outputs: [{ node: 'n', port: 'y', name: 'A' }]
  }, [0, 1]);
  assert.equal(r.waveform.signals.length, 2);
  assert.deepEqual(r.waveform.signals[0].values, [0, 1]);
  assert.deepEqual(r.waveform.signals[1].values, [1, 0]);
});

test('switching shortcuts off rescues focus from a wave-hit rect', function () {
  var h = bench();
  var rect = h.get('waveformSvg').querySelector('[data-vector="3"]');
  rect.focus();
  assert.equal(h.document.activeElement, rect);
  h.get('keyShortcuts').click();
  assert.equal(h.get('keyShortcuts').checked, false);
  assert.equal(h.document.activeElement, h.get('keyShortcuts'));
  h.dispose();
});

test('the waveform svg keeps its interactive descendants accessible', function () {
  var h = bench();
  var svg = h.get('waveformSvg').querySelector('svg');
  assert.equal(svg.getAttribute('role'), 'group');
  assert.ok(svg.querySelector('[role="button"]'), 'wave-hit rects are reachable buttons inside the group');
  h.dispose();
});

test('large-variable specs return honest results instead of budget errors', function () {
  var r9 = LG.minimizeBoolean(9, [256], []);
  assert.equal(r9.sop.termCount, 1);
  assert.equal(r9.sop.optimal, true);
  assert.equal(r9.pos.optimal, true);
  assert.equal(r9.verification.sopMatchesCareInputs, true);
  assert.equal(r9.verification.posMatchesCareInputs, true);

  var dc = [];
  for (var i = 0; i < 4096; i += 2) dc.push(i);
  var r12 = LG.minimizeBoolean(12, [], dc);
  assert.equal(r12.sop.expression, '0');
  assert.equal(r12.pos.expression, '0');
  assert.equal(r12.sop.optimal, true);

  var r10 = LG.minimizeBoolean(10, [0, 1, 512, 1023, 259], []);
  assert.equal(typeof r10.sop.optimal, 'boolean');
  assert.equal(typeof r10.pos.optimal, 'boolean');
  assert.equal(r10.verification.sopMatchesCareInputs, true);
  assert.equal(r10.verification.posMatchesCareInputs, true);
});

test('an eight-variable random spec completes with verified equivalence', function () {
  var rng = 42, on = [], dc = [];
  for (var m = 0; m < 256; m += 1) {
    rng = (rng * 1103515245 + 12345) >>> 0;
    var pick = (rng >>> 16) % 3;
    if (pick === 0) on.push(m);
    else if (pick === 1) dc.push(m);
  }
  var r = LG.minimizeBoolean(8, on, dc);
  assert.equal(r.verification.sopMatchesCareInputs, true);
  assert.equal(r.verification.posMatchesCareInputs, true);
  assert.equal(typeof r.sop.optimal, 'boolean');
});

test('sop expressions stay unambiguous when variable names prefix-collide', function () {
  var r = LG.minimizeBoolean(3, [6], [], { vars: ['A', 'B', 'AB'] });
  assert.equal(r.sop.expression, 'A & B & ~AB');
  assert.deepEqual(LG.evalTruthTable(r.sop.expression, ['A', 'B', 'AB']).minterms, [6]);
  var single = LG.minimizeBoolean(2, [3], []);
  assert.equal(single.sop.expression, 'AB');
});
