# LogicGate: Make logic. Prove every state.

## Inspiration

A Boolean equation can look correct and still fail at the boundaries between a parser, a minimizer and a hardware exporter. LogicGate makes those boundaries visible. A builder should be able to move from an idea to a circuit and inspect why every state is correct.

## What it does

LogicGate is a zero-dependency browser workbench for exact digital logic synthesis. It builds minimal SOP and POS circuits, draws their Karnaugh groups, compares their gate costs, lets judges probe input vectors and checks exported Verilog against every care state.

Five one-click challenges show the engineering immediately: a cyclic cover that defeats simple greedy choices, a hidden static hazard, a BCD display function that benefits from don't cares, a lookahead carry network checked across all 512 vectors and a clocked two-bit counter whose D registers hold state across twelve edges.

The exported module comes with an exhaustive Verilog-2001 testbench. A downloadable proof report includes the actual care set, both synthesized forms, their equivalence results and the static hazard analysis.

A timing and hazard lab adds five gate-level benchmark circuits: a full adder, a 4:1 mux, a 2-bit magnitude comparator, a 4-bit parity tree and a consensus-term glitch demo. Each runs an exhaustive truth-table equivalence check, a gate-level critical-path propagation delay with `f_max = 1 / t_pd`, a transport-delay simulation that draws the exact glitch interval on an interactive SVG waveform, and a structural Verilog export of real `not`/`and`/`or`/`xor` primitive instantiations with a self-checking testbench. Every delay is a nominal transport delay labeled as illustrative, not a device measurement.

Verification exports carry a FIPS 180-4 SHA-256 tamper-detection digest computed in pure JavaScript, honestly labeled as unkeyed integrity protection rather than a signature. CSV cells are escaped against spreadsheet formula injection. A strict `#lg=` URL hash bookmarks the full specification, benchmark and chosen transition, and an in-page self-test panel re-proves the engine against itself in the visitor's own browser.

## How we built it

The standalone JavaScript kernel runs unchanged in the browser and Node. A recursive-descent parser feeds truth tables. Quine-McCluskey creates prime cubes, and a memoized branch-and-bound cover solver chooses the fewest terms and then the fewest literals. BigInt coverage columns preserve every required state in large charts.

The UI uses local SVG and HTML. Keyboard and pointer inspection share one vector, so the map, gates and readout agree. The export pipeline parses its own emitted continuous assignment back into the Boolean engine before certifying it. An independent compiler suite also runs Icarus Verilog in strict 2001 mode.

## Challenges

Several errors hid behind plausible demonstrations. Prefix complement after a variable could attach to the wrong operand. Derived gate precedence was inconsistent. Thirty-two-bit cover columns could alias in large cyclic charts. POS gate counts and timing depth could disagree with the represented circuit.

The carry example needed a genuine parallel generate/propagate network and correct bit ordering for its displayed upper slice. Its UI sweep had stopped at 256 vectors despite promising 512. Verilog ports also needed full keyword handling and collision-safe testbench locals.

Invalid input could silently drop a minterm or leave a previous circuit downloadable. The upgraded workbench validates care sets strictly and blocks stale exports. It also keeps map focus through redraws and clears netlist traces when a preset is edited.

## Accomplishments

- Exact covers are checked against independent cube oracles, including literal-cost ties.
- A seven-input cyclic regression preserves all 48 nonessential care columns and returns the correct three-term, nine-literal cover.
- Static hazard inspection identifies the missing consensus for the A transition with B=C=1.
- True four-bit lookahead carry is checked against addition for all 512 vectors.
- Every export is parsed back and compared with its care states before the interface reports a pass.
- Thirty-two actual Verilog modules and their exhaustive testbenches compile and run with `iverilog -g2001` and `vvp`.
- Five structural benchmark netlists additionally compile and simulate every input vector under Icarus, emitted as real gate primitives rather than continuous assignments.
- The consensus demo's transport-delay model reproduces the exact 2 ns glitch window the missing consensus cube predicts, then proves the repaired cone clean.
- The browser self-test panel runs 16 checks including three published SHA-256 known-answer vectors, De Morgan equivalences, an XOR built purely from NAND gates, Quine-McCluskey agreement on every minterm and a live tamper-detection replay.

## Verification numbers

Verified on Node v26.8.1 with:

```sh
npm test
```

**623 passed, 0 failed, 0 skipped.**

| Check | Verified coverage |
| --- | --- |
| Engine and regression tests | 74 |
| Adversarial depth, sequential and UI-fence checks | 19 |
| Independent Verilog compiler/simulator checks | 48 |
| DOM interaction tests | 25 |
| Revamp oracle and accessibility checks | 54 |
| Timing, hazard, structural and integrity lab checks | 403 |
| Two-variable care specifications | All 81 disjoint on/don't-care combinations |
| Three-variable Boolean functions | All 256, with an independent term/literal oracle |
| Lab two-variable functions | All 16 |
| Lab three-variable functions | All 256 |
| Selected three-variable don't-care cases | 256 |
| Sampled four-variable cases | 96 engine + 32 lab |
| Lookahead network sweep | 512 input vectors |
| Large cyclic cover regression | 48 nonessential care columns |
| SHA-256 known-answer vectors | NIST 0/1/56/112-byte messages plus crypto-oracle cross-checks |
| Benchmark transitions scanned | All single-input transitions per circuit (24 to 64 vectors each) |
| Captured DOM console/reference errors | 0 |

Logical equivalence uses binary inputs and the explicit care mask. The displayed timing model is illustrative; dynamic device timing and physical hardware are outside this verification.

## What's next

Sequential RTL export, editable gate netlists, technology-specific cost models and automatic hazard-free covers would extend the same inspectable workflow. A hardware implementation would connect exhaustive logical verification to measured device timing.

## Judge demo

Open [LogicGate](https://aariv.me/logicgate/), choose **Find the hidden hazard**, and probe m3 and m7. In the timing lab, pick the Consensus demo and watch the A: m7 to m3 transition draw the red 6-8 ns glitch band while the repaired output stays clean. Choose **Verify all 512 vectors** to inspect the arithmetic oracle result, run the self-test panel, then download a structural module, testbench and checksummed report to take the experiment beyond the page.
