# LogicGate: Make logic. Prove every state.

## Inspiration

A Boolean equation can look correct and still fail at the boundaries between a parser, a minimizer and a hardware exporter. LogicGate makes those boundaries visible. A builder should be able to move from an idea to a circuit and inspect why every state is correct.

## What it does

LogicGate is a zero-dependency browser workbench for exact digital logic synthesis. It builds minimal SOP and POS circuits, draws their Karnaugh groups, compares their gate costs, lets judges probe input vectors and checks exported Verilog against every care state.

Four one-click challenges show the engineering immediately: a cyclic cover that defeats simple greedy choices, a hidden static hazard, a BCD display function that benefits from don't cares and a lookahead carry network checked across all 512 vectors.

The exported module comes with an exhaustive Verilog-2001 testbench. A downloadable proof report includes the actual care set, both synthesized forms, their equivalence results and the static hazard analysis.

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
- Thirty actual Verilog modules and their exhaustive testbenches compile and run with `iverilog -g2001` and `vvp`.

## Verification numbers

Verified on Node v24.16.0 with:

```sh
node --test --test-reporter=spec test.js regression-test.js export-test.js ui-test.js
```

**126 passed, 0 failed, 0 skipped.**

| Check | Verified coverage |
| --- | --- |
| Engine and regression tests | 73 |
| Independent Verilog compiler/simulator checks | 30 |
| DOM interaction tests | 23 |
| Two-variable care specifications | All 81 disjoint on/don't-care combinations |
| Three-variable Boolean functions | All 256, with an independent term/literal oracle |
| Selected three-variable don't-care cases | 256 |
| Sampled four-variable don't-care cases | 96 |
| Lookahead network sweep | 512 input vectors |
| Large cyclic cover regression | 48 nonessential care columns |
| Captured DOM console/reference errors | 0 |

Logical equivalence uses binary inputs and the explicit care mask. The displayed timing model is illustrative; dynamic device timing and physical hardware are outside this verification.

## What's next

Sequential RTL export, editable gate netlists, technology-specific cost models and automatic hazard-free covers would extend the same inspectable workflow. A hardware implementation would connect exhaustive logical verification to measured device timing.

## Judge demo

Open [LogicGate](https://aariv.me/logicgate/), choose **Find the hidden hazard**, and probe m3 and m7. Choose **Verify all 512 vectors** to inspect the arithmetic oracle result. Download a module, testbench and proof JSON to take the experiment beyond the page.
