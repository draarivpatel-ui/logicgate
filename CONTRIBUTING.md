# Contributing to LogicGate

Thanks for your interest in LogicGate. This project is an offline digital logic
synthesis and timing analyzer datasheet bench: Boolean equation parsing, truth
tables, exact SOP and POS realisation via Quine-McCluskey and Petrick's method,
Gray-coded Karnaugh maps, gate-level and clocked netlist simulation, and
Verilog export.

## Ground rules

- Be respectful and constructive. This project follows the Contributor
  Covenant, found in `CODE_OF_CONDUCT.md`.
- Keep the project dependency free. No `node_modules`, build steps, or runtime
  libraries. Node builtins and the `node:test` runner are fine.
- Keep the bench offline. No network requests, no CDN assets, no analytics.
- Minimality must be provable. When you change the minimiser, compare against a
  brute-force search over all prime implicant covers for the same on-set and
  dc-set, and keep that comparison in the tests.

## Development setup

Requirements:

- Node.js 22 or newer (the test runner is `node --test`)
- A modern browser for manual verification
- Optional: `iverilog` to confirm exported Verilog compiles

```sh
git clone https://github.com/draarivpatel-ui/logicgate.git
cd logicgate
node --test
```

Open `index.html` directly from disk, or serve the directory from any static
host:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

## How the code is organised

| File | Role |
| --- | --- |
| `logic.js` | The engine: parser, truth tables, Quine-McCluskey, Petrick's method, K-maps, gate and register simulation, and Verilog export (UMD) |
| `app.js` | UI wiring: equation editor, table and map views, netlist editor, and datasheet |
| `index.html`, `style.css` | The bench shell and its styling |
| `test.js` | The test suite |

`logic.js` is a UMD module, so `require('./logic.js')` works in Node and
`window.LogicGate` is available in the browser. Match that pattern in new
modules.

## Coding standards

- Use 2-space indentation and `var` only where the existing file does, matching
  the surrounding style. Prefer `const`, and use `let` when reassignment is
  required.
- Keep functions small and single purpose. Name them after what they do.
- No comments that restate the code. Comment the reason, the algorithm
  reference, or the non-obvious trade-off.
- Treat em-dashes and en-dashes as a defect in prose and identifiers. Use
  commas, parentheses, or a plain hyphen instead.
- Never swallow errors silently. Fail loudly with an actionable message.
- Keep the engine free of DOM access. The bench renders; the engine computes.
- Represent state with plain numbers and bitmasks in the engine, not strings, so
  simulation stays fast and testable.

## Testing the synthesis pipeline

Parser fixes need truth-table tests for the accepted grammar and rejection
tests for malformed input. Minimiser changes need brute-force cross checks at
the variable counts the test suite already covers, plus a saturation case with
many don't-care terms. Simulation changes need a testbench in the suite that
pins the state sequence across several clocks.

## Opening a pull request

1. Fork the repository and create a branch from `main`.
2. Make your change with tests. Every bug fix should include a regression test
  that fails before your fix.
3. Run the full suite locally: `node --test`.
4. Update documentation where behaviour, syntax, or a default changed.
5. Open the PR against `main` with:
   - a short summary of what changed and why,
   - the commands you ran and their result,
   - screenshots for UI changes,
   - confirmation of the tool and standard you validated exported Verilog
     against.
6. Keep the PR small enough to review in one sitting, and respond to review
   promptly.

Commit messages: use a short imperative subject line under 72 characters. Put
the reasoning in the body, not the subject.

## Reporting bugs

Open an issue with the smallest reproduction you can manage: the equation or
truth table, the steps you ran, what you expected, and what happened instead.
For a minimisation discrepancy, state the on-set and dc-set so the expected
minimal cover can be derived independently. Security issues follow `SECURITY.md`
instead.
