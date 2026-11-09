# LogicGate

An offline digital logic synthesis and timing analyzer datasheet bench. LogicGate parses Boolean equations, constructs truth tables, computes exact two-level Sum of Products (SOP) and Product of Sums (POS) realizations via Quine-McCluskey and Petrick's method, renders Gray-coded Karnaugh maps with toroidal prime-cube overlays, simulates gate-level DAG and clocked D-register netlists, and exports synthesizable IEEE 1364-2001 Verilog modules with self-checking testbenches.

The repository has zero runtime dependencies and makes zero network requests. Open `index.html` directly from disk (`file://`) or serve the directory from any static host. The computation engine is a standalone UMD module (`require('./logic.js')` in Node.js or `window.LogicGate` in the browser).

**Live bench:** https://draarivpatel-ui.github.io/logicgate/

---

## Repository Contents

| File | Purpose |
| --- | --- |
| `logic.js` | UMD synthesis and simulation kernel: recursive-descent parser, Quine-McCluskey, Petrick exact cover, Gray-code Karnaugh map, DAG/DFF netlist simulator, Verilog-2001 exporter |
| `index.html` | IEEE Digital Logic & Hewlett-Packard state analyzer datasheet markup |
| `style.css` | IEEE datasheet paper (light) and HP 16500B CRT logic analyzer (dark) themes, print stylesheet |
| `app.js` | Browser controller: interactive Karnaugh map, toroidal wrap cube splitter, gate schematic, analyzer waveform, truth table, Verilog export |
| `test.js` | 52 `node:test` assertions including brute-force optimality oracles across 2, 3, and 4 variables |
| `.nojekyll` | Static GitHub Pages marker |
| `LICENSE` | MIT |

---

## Quick Start & Hardware Verification

Run the 52-test Node.js verification suite and syntax checks:

```sh
node --test test.js
node --check logic.js
node --check app.js
```

Export a Verilog-2001 module and self-checking testbench from the command line and verify with Icarus Verilog (`iverilog`):

```sh
node -e "const fs=require('fs'),L=require('./logic.js'); const v=L.exportVerilog({numVars:3,minterms:[3,5,6,7],form:'SOP',moduleName:'majority3',outputName:'vote'}); fs.writeFileSync(v.filename,v.module); fs.writeFileSync(v.testbenchFilename,v.testbench)"
iverilog -g2001 -o sim.vvp majority3.v majority3_tb.v
vvp sim.vvp
```

Output:

```
VCD info: dumpfile majority3.vcd opened for output.
ALL 8 VECTORS PASS
```

---

## Boolean Expression Grammar

Variables default to `A` through `P` or any explicit port identifier list passed to the engine. Adjacency between single-letter variables (`AB`) compiles to implicit `AND`.

| Operation | Accepted Syntax |
| --- | --- |
| Complement (NOT) | `!A`, `~A`, `NOT A`, postfix `A'` |
| Product (AND) | `A & B`, `A && B`, `A * B`, `A AND B`, implicit `AB` |
| Exclusive-OR (XOR) | `A ^ B`, `A XOR B` |
| Sum (OR) | `A | B`, `A || B`, `A + B`, `A OR B` |
| Derived Gates | `A ~& B` (`NAND`), `A ~| B` (`NOR`), `A ~^ B` (`XNOR`) |
| Constants & Comments | `0`, `1`, `TRUE`, `FALSE`, line `// ...`, block `/* ... */` |

Operator precedence from highest to lowest: postfix `A'`, prefix `NOT`, `AND`, `XOR`, `OR`.

---

## Quine-McCluskey & Petrick's Method on Cyclic Prime Implicant Tables

Two-level minimization seeks a cover of all required on-set minterms (`F = 1`) using the fewest prime implicants, and among ties, the fewest literals. Don't-care minterms (`F = X`) are included during prime generation so cubes can grow as large as possible, but don't-care columns are omitted from the covering chart so they are never forced to be covered.

### Phase 1: Prime Implicant Generation

Each implicant is represented as `{ mask, value, minterms }`, where `1` bits in `mask` mark cared variables and `0` bits mark eliminated (dashed) variables. Implicants are bucketed by the popcount of `value & mask`. Adjacent buckets are compared: two implicants merge whenever their masks are identical and `(v_1 ^ v_2) & mask` has popcount 1. The differing bit is cleared from `mask`, and any implicant that cannot merge further becomes a prime implicant.

### Phase 2: Resolving Cyclic Prime Charts with Petrick's Method

After building the prime implicant chart (rows = prime implicants `P_i`, columns = care minterms `m_j`), any column covered by a single prime identifies an **essential prime implicant**. However, many Boolean functions produce a **cyclic prime implicant table** in which every care minterm is covered by at least two prime implicants, leaving **zero essential primes**.

Consider the 4-variable function `F(A, B, C, D) = Sigma m(1, 2, 3, 4, 5, 6)`:

| Prime Implicant | Binary Cube | Covered Minterms |
| --- | --- | --- |
| `P_1 = ~A~B D` | `00-1` | `m_1, m_3` |
| `P_2 = ~A~B C` | `001-` | `m_2, m_3` |
| `P_3 = ~A~C D` | `0-01` | `m_1, m_5` |
| `P_4 = ~A C~D` | `0-10` | `m_2, m_6` |
| `P_5 = ~A B~D` | `01-0` | `m_4, m_6` |
| `P_6 = ~A B~C` | `010-` | `m_4, m_5` |

Every minterm in `{1, 2, 3, 4, 5, 6}` is covered by exactly two primes (`m_1` by `P_1, P_3`; `m_2` by `P_2, P_4`; `m_3` by `P_1, P_2`; `m_4` by `P_5, P_6`; `m_5` by `P_3, P_6`; `m_6` by `P_4, P_5`), forming a 6-cycle on the Karnaugh map. Zero primes are essential, and a naive greedy heuristic that picks the first prime covering `m_1` and `m_3` (`P_1`) plus `P_6` (`m_4, m_5`) leaves `m_2` and `m_6` uncovered and can easily pick a 4-term cover.

Petrick's method writes a conjunctive normal form (POS) Boolean condition over the prime selector variables `P_1 .. P_6`, requiring every uncovered minterm column to be satisfied:

```
Phi = (P_1 + P_3)(P_2 + P_4)(P_1 + P_2)(P_5 + P_6)(P_3 + P_6)(P_4 + P_5) = 1
```

In `logic.js`, Petrick's condition is solved exactly using branch-and-bound over the uncovered columns:
1. At each recursion node, select the uncovered minterm column with the fewest covering primes (most constrained variable first) to minimize branching factor.
2. Branch on each prime covering that minterm, bitmask-OR its covered minterms into the state, and accumulate `(termCount, literalCount)`.
3. Prune any branch whose `termCount` already exceeds the best complete cover found so far, or equals `bestTerms` with `literalCount >= bestLiterals`.

On `Sigma m(1, 2, 3, 4, 5, 6)`, the solver immediately finds the two exact minimum covers of size 3 (`P_1 + P_4 + P_6 = ~A~BD + ~AC~D + ~AB~C` or `P_2 + P_3 + P_5 = ~A~BC + ~A~CD + ~AB~D`, 3 terms and 9 literals). In `test.js`, this exact solver is verified against a brute-force cube oracle across all 256 3-variable functions (with and without don't cares) and 96 pseudo-random 4-variable functions with don't cares.

---

## Topological DAG Gate Simulator & Clocked D Flip-Flops

`simulateNetlist(netlist, vectors)` evaluates 13 primitive and composite gate types:
`AND`, `OR`, `NOT`, `XOR`, `NAND`, `NOR`, `XNOR`, `BUF`, `MUX2`, `HALF_ADDER`, `FULL_ADDER`, `DFF`, and `CONST`.

- **Combinational Loop Detection:** `detectCycles(netlist)` runs a depth-first search over the combinational subgraph (treating `DFF` outputs as state sources rather than combinational edges). Any combinational feedback loop throws a `LogicError`, while feedback through a `DFF` register is classified as legal sequential logic (`isSequential: true, hasCombinationalCycle: false`).
- **Non-Blocking Register Commit:** For each input vector, combinational nodes settle in topological order first; `DFF` inputs (`D`) are sampled from the settled combinational state and committed to `Q` at the vector boundary.

---

## License

MIT. See `LICENSE`.
