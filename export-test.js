'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const L = require('./logic.js');
const available = cp.spawnSync('iverilog', ['-V'], { encoding: 'utf8' }).status === 0;
const cases = [
  ...L.listPresets().filter(p => p.numVars <= 4).map(p => L.getPreset(p.id)),
  { numVars: 2, vars: ['reg', 'lg_reg'], minterms: [1, 2], outputName: 'reg', moduleName: 'automatic' },
  ...['stimulus', 'errors', 'i', 'expected', 'is_dont_care', 'dut'].map(outputName => ({ numVars: 2, vars: ['A', 'B'], minterms: [1, 2], outputName, moduleName: 'collision_' + outputName })),
  { numVars: 2, minterms: [], moduleName: 'constant_zero' },
  { numVars: 2, minterms: [0, 1, 2, 3], moduleName: 'constant_one' },
  { numVars: 2, vars: ['stimulus', 'B'], minterms: [1, 2], moduleName: 'port_shadow' },
  { numVars: 2, vars: ['wire', 'always'], minterms: [1, 2], moduleName: 'kw_vars' },
  { numVars: 2, vars: ['reg', 'dut'], minterms: [1, 3], dontCares: [2], moduleName: 'tb_shadow', outputName: 'expected' },
  { numVars: 2, minterms: [3], moduleName: 'a-b-c', outputName: '9lives' },
  { numVars: 2, vars: ['lg_wire', 'wire'], minterms: [0, 1], moduleName: 'dup_san' },
  { numVars: 1, vars: ['s'], minterms: [1], moduleName: 'one_bit' },
  { numVars: 2, vars: ['is_dont_care', 'i'], minterms: [1, 3], dontCares: [0], moduleName: 'fn_clash' },
  { numVars: 2, minterms: [1, 2], moduleName: 'endmodule', outputName: 'wire' }
];
for (const spec of cases) for (const form of ['SOP', 'POS']) test('Icarus Verilog-2001 compiles and exhaustively runs ' + (spec.moduleName || spec.id) + ' ' + form, { skip: !available }, () => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.verilog-check-'));
  try {
    const bundle = L.exportVerilog({ ...spec, form });
    fs.writeFileSync(path.join(directory, bundle.filename), bundle.module);
    fs.writeFileSync(path.join(directory, bundle.testbenchFilename), bundle.testbench);
    const build = cp.spawnSync('iverilog', ['-g2001', '-s', bundle.testbenchName, '-o', 'run.vvp', bundle.filename, bundle.testbenchFilename], { cwd: directory, encoding: 'utf8', timeout: 10000 });
    assert.equal(build.status, 0, build.stderr);
    const run = cp.spawnSync('vvp', ['run.vvp'], { cwd: directory, encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, 0, run.stderr);
    assert.doesNotMatch(run.stdout, /FAIL|VECTORS FAILED/);
    assert.match(run.stdout, new RegExp('ALL ' + bundle.vectorCount + ' VECTORS PASS'));
    assert.equal(L.verifyVerilog(bundle).passes, true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
