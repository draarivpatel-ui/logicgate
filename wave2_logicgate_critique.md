# LogicGate Wave-2 audit (2026-11-20)

Scope: `app.js`, `logic.js`, `style.css`, `index.html`, plus `README.md` and `DEVPOST_UPGRADE.md` for claim honesty.
Baseline: `npm test` = **145 pass / 0 fail / 0 skip** (Node, `node --test` over the five suite files). Icarus Verilog is installed, so the 32 export consumer checks ran for real.

Method: full read of all four runtime files, targeted reproduction of every suspected defect in Node and in the repo's own `dom-harness.js`, and cross-checks of printed claims against the code that produces them.

## Verdict

The engine is in excellent shape: the Quine-McCluskey + branch-and-bound cover is oracle-verified exhaustively for small widths, the parser precedence is tested, sequential DFF timing has independent oracles, and the Verilog round-trip is checked by recompiling emitted RTL with real `iverilog -g2001`. The defects found are concentrated in honesty of displayed claims, one silent UI truncation, one dead-control a11y bug, and a small cluster of edge-case correctness warts.

**Pre-fix score: 9.0 / 10. Post-fix score: 9.5 / 10.**

## Resolution

All eight `[should]` findings were reproduced and fixed in this pass, each with a regression test where the suite structure allows one (5 new tests; suite now 150/150 green). Nits 9-10 were fixed; nits 11-15 are documented above with deferral reasons. Viewport verification post-fix: 1440x900 and 390x844 both report `consoleErrors: []`, `horizontalOverflow: false`, `externalRequests: []`.

## Findings

### [must]

None. No crash, wrong-circuit, or fabricated-metric defect reachable through the shipped UI flows.

### [should]

1. **Circular "Arithmetic oracle" for the ALU preset.** `runNetlist` prints `Arithmetic oracle: PASS` for every netlist preset without `expectedWave`. For `alu4BitSlice`, `presetTruthTable()` (logic.js:1622-1624) is implemented as `simulateNetlist(...)` on the same netlist and vectors, so the "oracle" compares the simulator to itself and can never fail. The claim is vacuous exactly where a reader would trust it. `carryLookahead4Bit` is genuinely independent (integer addition, logic.js:1609-1620) and `syncCounter` uses `expectedWave`, so only the ALU leg is circular. Reproduced: `presetTruthTable('alu4BitSlice')` deep-equals `simulateNetlist(p.netlist, 0..15)` outputs.
   Evidence: app.js:852-854, logic.js:1622-1624.

2. **Waveform silently drops `net:cout` for the ALU preset.** `renderWaveform` builds 4 spec inputs + 3 F channels + 6 netlist channels = 13 signals, then `signals.slice(0, maxSignals)` with `maxSignals = 12` (app.js:647-651). The carry-out, the most interesting ALU output, is never drawn and nothing says a signal was omitted. Reproduced via dom-harness: rendered labels end at `net:result`; `net:cout` absent while `netlistStatus` still reports "Outputs: result, cout".
   Evidence: app.js:647-651, 625-628.

3. **Netlist clock-edge hit rects are focusable dead buttons.** Every waveform column gets `tabindex="0" role="button"`; for indices past the spec vector range `data-vector` is removed (app.js:699-706) so pointer and keyboard activation do nothing, yet the elements remain in the tab order announced as buttons. Reproduced on `syncCounter`: 8 inert `role="button"` rects (edges 4-11).
   Evidence: app.js:698-707, 899-902, 921-924.

4. **`CONST` gate node reads `params.value: '0'` (string) as logic 1.** `simulateNetlist` computes `node.params.value ? 1 : 0` (logic.js:1117); the non-empty string `'0'` is truthy, so a constant-zero node drives 1. Reproduced: `simulateNetlist({nodes:[{id:'c',type:'CONST',params:{value:'0'}}]},[{}])` outputs `o = 1`.
   Evidence: logic.js:1117, GATE_DEFS CONST at logic.js:919.

5. **`exportVerilog({ expr })` with no `numVars`/`vars` throws on valid input.** `buildSpec` defaults `names` to the first two default variables (logic.js:1259) before evaluating the expression, so `exportVerilog({ expr: 'A ^ B ^ C' })` fails with `unknown variable "C"` instead of inferring three variables. Reproduced.
   Evidence: logic.js:1255-1268.

6. **Solution cards mislabel gate count as "two-input gates".** `metricsFor` totals NOT (unary) + AND/OR gates into `gateCount.total` (logic.js:659-665), and the card prints `N two-input gates` (app.js:309). For `!A` the UI claims "1 two-input gates" for what is a single inverter. Reproduced via dom-harness.
   Evidence: app.js:308-309, logic.js:640-665.

7. **Stat tile "On / Don't-Care" shows on-count over total states.** Value renders `8 / 16` (on-minterms / 2^n) under a label that reads as on/don't-care; the don't-care count only appears in the detail line. Reproduced on the default preset.
   Evidence: app.js:212.

8. **Missing favicon produces a console 404 on every visit.** `index.html` had no `rel="icon"` link and no icon file, so browsers request `/favicon.ico` and log a network error. Caught by the viewport check (`consoleErrors` contained the 404). Fixed with a local `favicon.svg` AND-gate glyph and a `rel="icon"` link; re-verified clean.
   Evidence: index.html:7-9 (pre-fix), python http.server access log.

### [nit]

9. `contiguousRuns` hardcodes literal `3` where `maxCount - 1` belongs (app.js:356-359). Correct today because K-map axes cap at 4, but fragile. Fixed.
10. `renderSchematic` sizes `h` from the unsliced implicant count, so a >8-cube cover would leave dead space at the bottom (app.js:521 vs 544). No 4-var function exceeding 8 chosen cubes was found in 3000 seeded samples; defensive only. Fixed by clamping to `MAX_GROUPS`.
11. `simulateNetlist`'s multi-step settle loop can never iterate past step 0: combinational nodes are evaluated once in topological order, so `settled` is always true at `step === 0` and the `glitch`/`oscillation` hazard branches (logic.js:1129-1134) are unreachable. `undriven-input` reporting works. Dead defensive code, not a wrong result. Deferred: harmless, and removing it would shrink the hazard-reporting surface the docs describe.
12. `gateCount.nand` (logic.js:668) is the uniform-gate count (`terms + 1`) and is correct for both NAND-NAND (SOP) and NOR-NOR (POS), but the field name is SOP-centric inside exported proof JSON. Internal metric, not displayed in the UI; renaming would break the JSON shape for no user-facing gain. Deferred.
13. `exprInput` keeps stale invalid text (with `aria-invalid` cleared by `syncInputs`) after an unrelated field is edited successfully. It is a command input, not state, so this is acceptable; noted for completeness. Deferred.
14. `buildWaveform` would let an output name shadow an input name of the same string (logic.js:1199-1201); unreachable through the UI, which only loads built-in presets. Deferred.
15. Waveform hit strips are narrow tap targets on mobile (~12-26 px wide); the probe panel covers the same function, so this is an enhancement-path nit. Deferred.

## Checks that came back clean

- Truth tables, minterm/don't-care parsing, care-mask handling, SOP/POS equivalence: oracle-verified, including all 256 three-variable functions and exhaustive care-set combinations at two variables.
- Expression precedence (implicit AND, postfix prime, NAND/NOR/XNOR derived gates, comments, depth caps): tested, including adversarial nesting.
- Sequential simulation: non-blocking DFF updates verified against an independent mod-4 oracle on all 12 counter edges; combinational loops rejected; the carry-lookahead netlist equations match textbook CLA (verified by hand against logic.js:1566-1593).
- Verilog-2001 export: keyword/collision handling exercised by 32 real `iverilog -g2001` + `vvp` runs (0 skipped), plus `verifyVerilog` re-parse of every care vector. `numVars=1` export additionally compiled and passed by hand during this audit.
- Zero runtime network access: no `fetch`, XHR, external URLs, or CDN references in `app.js`, `logic.js`, `index.html`, `style.css`.
- Accessibility: skip link, labeled controls, `aria-pressed`/`aria-expanded` state, live regions on status readouts, keyboard map navigation, focus restoration after K-map redraw, `forced-colors` and print styles.
- Mobile layout: single-column collapse at 900 px, 2-column stats at 560 px, scrollable K-map wrap; verified again by viewport check post-fix.
- Printed claims audited: "exact synthesis" (QM + exact cover, true), "every care state checked" (verifyVerilog + care mask, true), "zero dependencies / offline" (true), hazard scope honestly limited to static care-pair transitions with "dynamic timing is not simulated" (honest).
