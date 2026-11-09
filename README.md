# LogicGate

An offline digital logic workbench. LogicGate parses Boolean expressions, builds truth tables, minimizes functions with Quine-McCluskey and Petrick's exact minimum cover, draws Karnaugh maps and prime implicant groups, simulates gate level netlists with D flip flops, and exports synthesizable Verilog-2001 modules with self checking testbenches.

The repository has zero runtime dependencies and makes zero network requests. Open `index.html` directly from disk, or serve the folder with any static server. The engine is a UMD module: `require('./logic.js')`, AMD `define`, or the browser global `window.LogicGate`.

Live site: https://draarivpatel-ui.github.io/logicgate/

## Contents

| File | Purpose |
| --- | --- |
| `logic.js` | UMD engine. Parser, minimizer, Karnaugh maps, netlist simulator, presets, Verilog exporter. |
| `index.html` | Workbench markup. |
| `style.css` | Selected dark and light themes, responsive layout, print stylesheet. |
| `app.js` | Browser controller. Karnaugh map, grouping diagram, schematic, waveform, truth table, exports. |
| `test.js` | 52 `node:test` cases. |
| `.nojekyll` | Static GitHub Pages marker. |
| `LICENSE` | MIT license. |

## Quick start

```sh
node --test test.js
node --check logic.js
node --check app.js
iverilog -g2001 -o sim.vvp majority3.v majority3_tb.v
vvp sim.vvp
```

For the browser, no build step is needed:

```sh
open index.html          # macOS
xdg-open index.html      # Linux
python3 -m http.server 8000
```

The last command serves the folder at `http://localhost:8000/` if you prefer a local static server. The application itself never fetches anything.

## Expression syntax

Variables are single letters `A` through `P` by default, or any explicit names you pass. Matching is case insensitive against explicit names. Adjacent single letter variables imply AND, so `AB` means `A & B`.

| Operator | Accepted forms |
| --- | --- |
| NOT | `!A`, `~A`, `NOT A`, postfix `A'` |
| AND | `A & B`, `A && B`, `A * B`, `A AND B`, adjacency `AB` |
| OR | `A | B`, `A || B`, `A + B`, `A OR B` |
| XOR | `A ^ B`, `A XOR B` |
| NAND | `A ~& B`, `A NAND B` |
| NOR | `A ~| B`, `A NOR B` |
| XNOR | `A ~^ B`, `A XNOR B` |
| Constants | `0`, `1`, `TRUE`, `FALSE` |
| Groups | parentheses |
| Comments | `//` to end of line, or `/* ... */` |

Precedence from tightest to loosest: NOT, AND, XOR, OR. Postfix `A'` binds before any binary operator. Examples: `A & B | !C`, `AB' + C`, `!(A + B)`, `A ^ B ^ C`, `NAND(A, B)` is not used; write `A NAND B` instead.

## Quine-McCluskey walkthrough

The goal is a minimum two level implementation of a Boolean function. LogicGate computes both sum of products (SOP, an OR of AND terms) and product of sums (POS, an AND of OR terms), with don't cares used opportunistically.

Worked example: a three input majority voter, `F(A, B, C) = 1` for minterms 3, 5, 6, 7.

1. **List the on set.** Write each minterm as a binary string with `A` most significant: `3 = 011`, `5 = 101`, `6 = 110`, `7 = 111`. Add don't care minterms to this list if the function has any. They may be covered, but they never have to be.
2. **Group by popcount.** Count the ones: group 1 holds `011`, `101`, `110`; group 2 holds `111`.
3. **Combine adjacent groups.** Two implicants combine when they differ in exactly one bit. Mark that bit as a dash. `011` and `111` give `-11`; `101` and `111` give `1-1`; `110` and `111` give `11-`. All three original minterms are used, so none survive alone. Repeat combining: `-11`, `1-1`, and `11-` differ in two positions, so no further reduction is possible.
4. **Collect prime implicants.** The maximal implicants are `-11` (`BC`, covering 3 and 7), `1-1` (`AC`, covering 5 and 7), and `11-` (`AB`, covering 6 and 7). A dash means the variable is absent; a `0` bit means the variable appears complemented in SOP.
5. **Build the prime implicant chart.** Rows are primes, columns are required on minterms 3, 5, 6, 7. Each of 3, 5, and 6 is covered by exactly one prime, so all three primes are essential. There are no uncovered required minterms left, so the cover is already minimal.
6. **Solve the remaining cover.** When essential primes leave columns uncovered, LogicGate selects the fewest additional implicants that cover them. Petrick's method forms a product of sums, one sum per uncovered minterm listing the primes that cover it, then expands to a sum of products and keeps the smallest product. This implementation uses branch and bound over the same condition: separate the most constrained uncovered minterm, try each covering prime, prune any branch that cannot beat the best known solution, and prefer fewer terms then fewer literals. This is exact, not a greedy heuristic.
7. **Verify.** Evaluate both solutions against every care input. Don't care inputs are free to take either value and are reported in `verification.dontCareAssignments`.

Result for the voter: `BC + AC + AB`. LogicGate also minimizes the dual function (the zeros, plus don't cares) to produce the POS form `(A + B)(A + C)(B + C)`. Both are minimum for their form.

The engine reports prime implicants, essential primes, literal counts, gate counts, a two level gate delay estimate at 2 ns per level, and full verification arrays. Karnaugh maps for 2, 3, and 4 variables use Gray coded row and column order, so adjacent cells always differ by one bit and prime implicants appear as rectangles that wrap around the edges.

## Node API

```js
const LG = require('./logic.js');

// Truth table from an expression.
const tt = LG.evalTruthTable('A & B | !C', ['A', 'B', 'C']);
console.log(tt.minterms);            // [0, 2, 4, 6, 7]
console.log(tt.outputs);            // one entry per input combination

// Minimize a function with don't cares.
const r = LG.minimizeBoolean(4, [0, 2, 3, 5, 6, 7, 8, 9], [10, 11, 12, 13, 14, 15], {
  vars: ['A', 'B', 'C', 'D']
});
console.log(r.sop.expression);
console.log(r.pos.expression);
console.log(r.primeImplicants.map(p => p.text));
console.log(r.essentialPrimeImplicants.map(p => p.text));
console.log(r.verification.sopMatchesCareInputs);   // true

// Karnaugh map layout.
const k = LG.karnaughMap(3, [3, 5, 6, 7], []);
console.log(k.grayOrder, k.cells);

// Prime implicants alone, and the exact cover alias.
console.log(LG.primeImplicants(3, [3, 5, 6, 7]));
console.log(LG.solvePetrick(3, [3, 5, 6, 7]).sop.expression);

// Verilog module and self checking testbench.
const v = LG.exportVerilog({
  numVars: 3, vars: ['A', 'B', 'C'], minterms: [3, 5, 6, 7],
  dontCares: [], form: 'SOP', moduleName: 'majority3', outputName: 'vote'
});
console.log(v.filename, v.testbenchFilename, v.vectorCount);
console.log(v.module);
console.log(v.testbench);
```

`exportVerilog` also accepts `expr` in place of `minterms`, generates a `timescale` directive and `default_nettype none`, sanitizes identifiers, emits constants correctly in both forms, and writes a testbench that checks every care vector, prints `DONT CARE` for don't care vectors, reports `ALL N VECTORS PASS`, and dumps a VCD file.

### Netlist simulation

A netlist declares external `inputs`, gate `nodes`, and `edges` that wire an output port to an input port. `IN:<name>` and a bare input name both refer to an external input. Gate types are `AND`, `OR`, `NOT`, `XOR`, `NAND`, `NOR`, `XNOR`, `BUF`, `MUX2`, `HALF_ADDER`, `FULL_ADDER`, `DFF`, and `CONST`.

```js
const netlist = {
  inputs: ['A', 'B', 'CIN'],
  outputs: [
    { node: 'fa', port: 'sum', name: 's' },
    { node: 'fa', port: 'carry', name: 'cout' }
  ],
  nodes: [{ id: 'fa', type: 'FULL_ADDER' }],
  edges: [
    { from: 'IN:A', to: 'fa', toPort: 0 },
    { from: 'B', to: 'fa', toPort: 1 },
    { from: 'IN:CIN', to: 'fa', toPort: 2 }
  ]
};
const sim = LG.simulateNetlist(netlist, [0, 1, 2, 3, 4, 5, 6, 7]);
console.log(sim.cycles.map(c => c.outputs));   // eight s and cout pairs
console.log(sim.waveform.signals);             // per signal value history
console.log(LG.detectCycles(netlist));         // cycle and sequential report
```

Combinational logic is evaluated in topological order each vector. A combinational cycle throws a `LogicError`. `DFF` nodes are sequential: their `D` input is sampled from the settled values of the current vector and their `q` state updates non blocking at the vector boundary, so feedback through a DFF is legal. `init` sets the starting state. The simulator also reports input hazards and captures a waveform.

### Presets

`LG.listPresets()` returns ids and descriptions. `LG.getPreset(id)` returns a full preset, and `LG.presetTruthTable(id)` returns its output vector. Built in presets are a seven segment decoder segment, a four bit ALU slice with a netlist, a four bit carry lookahead carry chain with a netlist, a majority voter, and a Gray code converter.

## CLI examples

All examples run from the repository folder. The engine has no executable wrapper, so the CLI is plain Node with `node -e` or a small script.

```sh
# Print a minimized expression.
node -e "const L=require('./logic.js'); console.log(L.minimizeBoolean(3,[3,5,6,7]).sop.expression)"

# Evaluate an expression and list its minterms.
node -e "const L=require('./logic.js'); console.log(L.evalTruthTable('A ^ B ^ C',['A','B','C']).minterms.join(','))"

# Show the Karnaugh map grid for a BCD segment.
node -e "const L=require('./logic.js'); console.table(L.karnaughMap(4,[0,2,3,5,6,7,8,9],[10,11,12,13,14,15]).cells)"

# Write a Verilog module and testbench, then simulate them.
node -e "const fs=require('fs'),L=require('./logic.js'); const v=L.exportVerilog({numVars:3,minterms:[3,5,6,7],form:'SOP',moduleName:'majority3',outputName:'vote'}); fs.writeFileSync(v.filename,v.module); fs.writeFileSync(v.testbenchFilename,v.testbench)"
iverilog -g2001 -o sim.vvp majority3.v majority3_tb.v
vvp sim.vvp

# Simulate a built in preset netlist over every input vector.
node -e "const L=require('./logic.js'); const p=L.getPreset('carryLookahead4Bit'); console.log(L.simulateNetlist(p.netlist,[...Array(512).keys()]).outputs)"

# Run the full test suite.
node --test test.js
```

Expected output for the first command is `BC + AC + AB`. Expected final line from the testbench simulation is `ALL 8 VECTORS PASS`.

## Workbench

Opening `index.html` gives you a Karnaugh map for 2, 3, or 4 variables. Click any cell to cycle `0` to `1` to `X` (don't care) to `0`. You can also type minterm lists, don't care lists, custom variable names, or a Boolean expression, or load a preset. Every change recomputes the solution, primes, grouping diagram, truth table, gate level schematic, timing waveform, stat tiles, and Verilog files.

The grouping diagram, schematic, and waveform are inline SVGs with hover tooltips and table views. A legend maps each group number to its color and term. The truth table toggle switches between highlighted rows and plain rows. The theme toggle switches between selected dark and light palettes, and an optional pattern fill adds texture for color vision deficiency or print. Copy or download the module and testbench with one click.

## Verification

- `node --test test.js`: 52 tests, all pass. Coverage includes parsing, truth table equivalence, exhaustive 2 and 3 variable optimality against a brute force oracle, sampled 4 variable optimality with don't cares, netlist simulation and cycle detection, presets, and Verilog syntax.
- Generated Verilog was compiled with `iverilog -g2001` and simulated with `vvp` for SOP, POS, constant zero, constant one, don't care, and expression derived cases. Every case printed `ALL N VECTORS PASS`.
- `node --check` passes on all three JavaScript files.
- Palette validation passed for both themes. The light theme contrast warning is relieved by direct labels, legends, and table views.
- No network requests, no external fonts, no CDN scripts, and no runtime dependencies.

## License

MIT. See `LICENSE`.
