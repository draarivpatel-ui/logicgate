# LogicGate

**Make logic. Prove every state.** A local hardware workbench that turns Boolean functions into exact circuits, explains their costs and checks the emitted Verilog against every care input.

[Open the workbench](https://aariv.me/logicgate/). The browser needs no install, build, account, external asset or network request. Open `index.html` from disk or publish this directory on a static host.

## A judge demo in seconds

1. Choose **Beat the greedy choice**. Six care states form a cyclic prime chart with zero essential primes; the solver finds a three-term, nine-literal cover.
2. Choose **Find the hidden hazard**. Inspect the A transition from m3 to m7 with B=C=1. The missing `B & C` consensus term is identified directly.
3. Choose **Verify all 512 vectors**. A true generate/propagate lookahead netlist is checked against integer addition across every input combination.
4. Download the RTL, exhaustive testbench or proof JSON. The live badges verify SOP, POS and the RTL text after parsing it back.

The carry scenario displays and exports a four-input upper slice with C2=1. Its separate nine-input lookahead netlist checks all 512 vectors. The exported slice name includes `upper_slice`.

## Engineering features

- Recursive-descent Boolean parsing with explicit precedence, implicit products and postfix prime complements.
- Quine-McCluskey prime generation and an exact branch-and-bound cover, minimizing terms first and literals second.
- BigInt coverage columns prevent 32-bit aliasing in large cyclic charts. A regression covers 48 nonessential care columns.
- Independently computed SOP and POS, Gray-code Karnaugh maps and split overlays for groups crossing an edge.
- Shared-inverter, balanced two-input gate counts and depth estimates. The optional 2 ns per level model is illustrative, before technology mapping.
- Static-1 and static-0 transition analysis for the selected cover. Dynamic glitches and real device delays are not simulated.
- Thirteen gate types, topological combinational evaluation, loop rejection and simultaneous clocked D-register updates.
- Verilog-2001 identifiers, collision-safe ports and testbench locals, don't-care masking and matched module/testbench filenames.
- Input toggles, map and waveform inspection, keyboard map navigation, persistent light/dark themes, labeled controls and visible validation failures.
- Invalid input disables stale exports until a valid specification is applied.

## Verification

Node.js 22 or newer:

```sh
npm test
```

The verified suite contains **219 tests**: 53 original engine checks, 21 regression and oracle checks, 48 Verilog consumer checks, 25 DOM interaction checks, 19 adversarial checks covering parser depth limits, sequential DFF timing oracles, undriven-pin reporting and UI hygiene invariants, and 53 revamp audit checks covering exhaustive prime-set oracles, exact-cover cost oracles, deep netlist recursion, typed input vectors, waveform naming collisions, the WCAG 2.1.4 keyboard-shortcut toggle and focus guards. The local run passed with **0 failures and 0 skipped tests**.

The original oracle suite covers all 81 disjoint care/don't-care specifications for two variables, every three-variable Boolean function, 256 three-variable functions with selected don't cares and 96 four-variable samples. A separate cube oracle checks both term and literal optimality for all 256 three-variable functions.

The Verilog consumer suite invokes installed `iverilog -g2001` and `vvp` for 48 SOP/POS modules and their exhaustive testbenches, including reserved words and collisions with testbench identifiers. These consumer checks are reported as skipped when Icarus Verilog is unavailable. The Node engine and DOM suites remain dependency free.

DOM tests compile and execute the actual scripts against the shipped HTML using a deterministic local adapter. They cover startup, every preset, editing, focus preservation, keyboard inspection, malformed inputs, exports, clipboard handling and theme state. This is a controller check, not a browser layout screenshot.

## Expression grammar

| Operation | Syntax |
| --- | --- |
| Complement | `!A`, `~A`, `NOT A`, `A'` |
| AND | `A & B`, `A * B`, `A AND B`, `AB` with explicit single-letter variables |
| XOR | `A ^ B`, `A XOR B` |
| OR | `A | B`, `A + B`, `A OR B` |
| Derived gates | `A NAND B`, `A NOR B`, `A XNOR B`, `A ~& B`, `A ~| B`, `A ~^ B` |
| Constants | `0`, `1`, `TRUE`, `FALSE` |

Precedence is complement, AND/NAND, XOR/XNOR, then OR/NOR. `A !B` means `A & !B`; only a prime is a postfix complement. Names are case insensitive and must be unique. Boolean operator words cannot be variable names.

The map supports two to four inputs. The engine supports one to sixteen inputs with explicit resource budgets of 2,000,000 prime merge checks, 200,000 cover search states and four seconds per cover. A cover chart that outgrows its budget returns a deterministic greedy cover instead of throwing; the result still matches every care input but flags the unproven cost as `sop.optimal` or `pos.optimal` set to `false`, so readers must check those flags before claiming a certified minimum. Prime-generation exhaustion still throws an actionable error. Fully specified sixteen-input constants use a direct fast path.

## Export and independent hardware simulation

```js
const L = require('./logic.js');
const spec = { numVars: 3, minterms: [3, 5, 6, 7], moduleName: 'majority3', outputName: 'vote' };
const bundle = L.exportVerilog(spec);
console.log(L.verifyVerilog(bundle)); // 8 care vectors checked
const report = L.exportVerificationJSON(spec);
```

After downloading a module and testbench:

```sh
iverilog -g2001 -o sim.vvp majority3.v majority3_tb.v
vvp sim.vvp
```

The testbench prints `ALL 8 VECTORS PASS` after exhaustive verification. Don't-care vectors are explicitly labeled and excluded from failures.

## Source map

| File | Responsibility |
| --- | --- |
| `logic.js` | Parser, exact synthesis, hazards, netlist simulation, Verilog and proof exporters |
| `app.js` | Specification editing, visualization, inspection and downloads |
| `index.html`, `style.css` | Accessible responsive workbench and themes |
| `test.js`, `regression-test.js` | Engine invariants and independent optimality oracles |
| `export-test.js` | Real Verilog-2001 compiler and simulation checks |
| `adversarial-test.js` | Depth limits, DFF timing oracles, undriven-pin warnings, UI fences |
| `ui-test.js`, `dom-harness.js` | Actual controller behavior with deterministic DOM and canvas adapters |
| `revamp-test.js` | Independent prime-set and cover-cost oracles, simulation and accessibility fences |

## Scope and next steps

Exports synthesize combinational functions. The netlist simulator supports registers, while sequential RTL export, device timing, technology mapping and automated consensus insertion are future work. Results prove logical equivalence under binary inputs and the supplied care mask.

MIT. See [LICENSE](LICENSE). Submission copy is in [DEVPOST_UPGRADE.md](DEVPOST_UPGRADE.md).
