'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./logic.js');
function oracle(n, on, dc) {
  const targets = on, size = 1 << n, allowed = new Set(on.concat(dc));
  const candidates = [];
  for (let mask = 0; mask < size; mask++) for (let value = 0; value < size; value++) {
    if (value & ~mask) continue;
    let bits = 0, valid = true;
    for (let m = 0; m < size; m++) if ((m & mask) === value) { if (!allowed.has(m)) { valid = false; break; } const index = targets.indexOf(m); if (index >= 0) bits |= 1 << index; }
    if (valid && bits) candidates.push([bits, mask.toString(2).replace(/0/g, '').length]);
  }
  const costs = Array.from({ length: 1 << targets.length }, () => [Infinity, Infinity]); costs[0] = [0, 0];
  for (let covered = 0; covered < costs.length; covered++) for (const [bits, literals] of candidates) {
    const next = covered | bits, cost = [costs[covered][0] + 1, costs[covered][1] + literals];
    if (cost[0] < costs[next][0] || (cost[0] === costs[next][0] && cost[1] < costs[next][1])) costs[next] = cost;
  }
  return costs.at(-1);
}

test('prefix complement after a primary belongs to the following variable', () => {
  for (const expr of ['A !B', 'A ~B', 'A NOT B']) assert.deepEqual(L.evalTruthTable(expr, ['A', 'B']).outputs, [0, 0, 1, 0]);
  assert.deepEqual(L.evalTruthTable("A'B", ['A', 'B']).outputs, [0, 1, 0, 0]);
  assert.throws(() => L.parseExpr('A!'), /unexpected end/);
});
test('XNOR and NOR have the same precedence as their base gates', () => {
  const names = ['A', 'B', 'C'];
  assert.deepEqual(L.evalTruthTable('A ~^ B & C', names).outputs, L.evalTruthTable('A XNOR (B & C)', names).outputs);
  assert.deepEqual(L.evalTruthTable('A ~| B & C', names).outputs, L.evalTruthTable('A NOR (B & C)', names).outputs);
});
test('case-insensitive input identities are unique and inferred consistently', () => {
  assert.throws(() => L.parseExpr('A', ['A', 'a']), /duplicate/);
  assert.deepEqual(L.evalTruthTable('a ^ A').outputs, [0, 0]);
  assert.deepEqual(L.evalTruthTable('a ^ A').vars, ['a']);
});
test('reserved Boolean words and malformed minterm coercions are rejected', () => {
  assert.throws(() => L.minimizeBoolean(2, [], [], { vars: ['AND', 'B'] }), /reserved/);
  for (const value of [[null], [false], [[]], [''], ['0x1'], ['1e0'], ['2.0']]) assert.throws(() => L.parseMintermList(value, 2), /invalid|range/);
  for (const n of [0, 17, NaN, 2.5]) assert.throws(() => L.fromMinterms(n, [0]), /between 1/);
});
test('variable count mismatch and noninteger Karnaugh layouts are rejected', () => {
  assert.throws(() => L.minimizeBoolean(3, [1], [], { vars: ['A', 'B'] }), /equal/);
  assert.throws(() => L.karnaughMap(2.5, [], []), /2 to 4/);
  assert.throws(() => L.karnaughMap(2, [1], [1]), /also listed/);
});
test('BigInt cover handles a cyclic chart with 48 remaining care columns', () => {
  const on = []; for (let band = 0; band < 8; band++) for (const m of [1, 2, 3, 4, 5, 6]) on.push(16 * band + m);
  const result = L.minimizeBoolean(7, on, []);
  assert.equal(result.essentialPrimeImplicants.length, 0); assert.equal(on.length, 48);
  assert.equal(result.sop.termCount, 3); assert.equal(result.sop.literalCount, 9);
  assert.equal(result.verification.sopMatchesCareInputs, true); assert.equal(result.verification.posMatchesCareInputs, true);
});
test('fully specified 16-input constants bypass exponential prime generation', () => {
  const result = L.minimizeBoolean(16, [], []);
  assert.equal(result.sop.expression, '0'); assert.equal(result.pos.expression, '0');
  assert.equal(result.verification.posOutputs.length, 65536);
});
test('literal tie breaking agrees with an independent cube oracle for all 256 functions', () => {
  for (let mask = 0; mask < 256; mask++) {
    const on = [], zeros = []; for (let m = 0; m < 8; m++) (mask & (1 << m) ? on : zeros).push(m);
    const result = L.minimizeBoolean(3, on, []);
    assert.deepEqual([result.sop.termCount, result.sop.literalCount], oracle(3, on, []), 'SOP ' + mask);
    assert.deepEqual([result.pos.termCount, result.pos.literalCount], oracle(3, zeros, []), 'POS ' + mask);
  }
});
test('gate counts distinguish OR terms from AND combination in POS', () => {
  const result = L.minimizeBoolean(3, [1, 2, 3, 4, 5, 6, 7], []);
  assert.equal(result.pos.gateCount.or, 2); assert.equal(result.pos.gateCount.and, 0);
});
test('balanced gate timing gives zero levels for a direct wire and one for an inverter', () => {
  assert.equal(L.minimizeBoolean(2, [2, 3]).sop.propagationDelay.levels, 0);
  assert.equal(L.minimizeBoolean(2, [0, 1]).sop.propagationDelay.levels, 1);
  assert.equal(L.minimizeBoolean(2, [3]).sop.propagationDelay.levels, 1);
});
test('hazard analysis finds the missing consensus without adding a simulated pulse', () => {
  const p = L.getPreset('staticHazard'); const r = L.minimizeBoolean(p.numVars, p.minterms, p.dontCares, { vars: p.vars });
  assert.deepEqual(r.hazards.sop, [{ from: 3, to: 7, variable: 'A', type: 'static-1', consensus: 'B & C' }]);
  assert.deepEqual(L.minimizeBoolean(3, [3, 5, 6, 7]).hazards.sop, []);
});
test('lookahead preset uses parallel generate and propagate gates', () => {
  const net = L.getPreset('carryLookahead4Bit').netlist;
  assert.equal(net.nodes.some(node => node.type === 'FULL_ADDER'), false);
  assert.equal(net.nodes.filter(node => /^p\d$/.test(node.id)).length, 4);
  assert.equal(L.simulateNetlist(net, [511], { maxSteps: 1 }).cycles[0].outputs.C4, 1);
});
test('string zero input is binary zero and single-pass DAG evaluation settles', () => {
  const net = { inputs: ['A'], nodes: [{ id: 'n', type: 'NOT' }], edges: [{ from: 'A', to: 'n' }], outputs: [{ node: 'n', port: 'y', name: 'Y' }] };
  const result = L.simulateNetlist(net, [{ A: '0' }, { A: '1' }], { maxSteps: 1 });
  assert.deepEqual(result.cycles.map(cycle => cycle.outputs.Y), [1, 0]); assert.equal(result.hazards.length, 0);
  for (const steps of [0, -1, 0.5, Infinity]) assert.throws(() => L.simulateNetlist(net, [0], { maxSteps: steps }), /maxSteps/);
});
test('netlist graph validation rejects missing outputs and duplicate external inputs', () => {
  assert.throws(() => L.simulateNetlist({ inputs: ['A', 'A'], nodes: [] }, [0]), /duplicate input/);
  assert.throws(() => L.simulateNetlist({ inputs: [], nodes: [], outputs: [{ node: 'missing', port: 'q' }] }), /missing node/);
  assert.throws(() => L.simulateNetlist(null), /must be an object/);
});
test('prototype-shaped signal names remain ordinary input data', () => {
  assert.deepEqual(L.evalTruthTable('__proto__ ^ B', ['__proto__', 'B']).outputs, [0, 1, 1, 0]);
  const bundle = L.exportVerilog({ numVars: 2, vars: ['__proto__', 'B'], minterms: [1, 2] }); assert.equal(L.verifyVerilog(bundle).passes, true);
});
test('Verilog round-trip checks every preset in both forms and detects corruption', () => {
  for (const p of L.listPresets().filter(p => p.numVars <= 4)) for (const form of ['SOP', 'POS']) {
    const spec = L.getPreset(p.id); spec.form = form; const bundle = L.exportVerilog(spec); const check = L.verifyVerilog(bundle);
    assert.equal(check.passes, true, p.id + '/' + form); assert.equal(check.checked, (1 << spec.numVars) - spec.dontCares.length);
  }
  const bundle = L.exportVerilog({ numVars: 2, minterms: [1, 2] }); bundle.module = bundle.module.replace(/assign y = [^;]+;/, "assign y = 1'b0;");
  assert.equal(L.verifyVerilog(bundle).passes, false); assert.equal(L.verifyVerilog(bundle).failures.length, 2);
});
test('verification JSON carries the real care set, hazard report and round-trip result', () => {
  const result = JSON.parse(L.exportVerificationJSON(L.getPreset('staticHazard')));
  assert.equal(result.format, 'logicgate-verification'); assert.equal(result.verification.rtl.passes, true); assert.equal(result.staticHazards.sop[0].consensus, 'B & C');
});
test('unsupported export forms and explicit zero widths fail', () => {
  assert.throws(() => L.exportVerilog({ numVars: 0, minterms: [] }), /between 1/);
  assert.throws(() => L.exportVerilog({ numVars: 2, minterms: [], form: 'FUTURE' }), /form/);
});

test('preset lookup rejects inherited names', () => {
  for(const name of ['__proto__','constructor','toString']) assert.throws(()=>L.getPreset(name),/unknown preset/);
});
test('numeric netlist vectors and external widths are validated before shifting', () => {
  const net={inputs:['A'],nodes:[{id:'n',type:'NOT'}],edges:[{from:'A',to:'n'}]};
  for(const vector of [-1,2,NaN,Infinity,0.5]) assert.throws(()=>L.simulateNetlist(net,[vector]),/input width/);
  assert.throws(()=>L.simulateNetlist({inputs:Array.from({length:17},(_,i)=>'I'+i),nodes:[]},[0]),/at most 16/);
});
test('virtual input values cannot be overwritten by a same-named gate', () => {
  const net={inputs:['A'],nodes:[{id:'A',type:'NOT'},{id:'copy',type:'BUF'}],edges:[{from:'IN:A',to:'A'},{from:'IN:A',to:'copy'}],outputs:[{node:'A',port:'y',name:'inverted'},{node:'copy',port:'y',name:'original'}]};
  const result=L.simulateNetlist(net,[0,1]);
  assert.deepEqual(result.cycles.map(c=>[c.outputs.original,c.outputs.inverted]),[[0,1],[1,0]]);
});
