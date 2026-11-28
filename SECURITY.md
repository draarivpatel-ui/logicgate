# Security policy

## Reporting a vulnerability

Use the private GitHub Security Advisory form at [Report a vulnerability](https://github.com/draarivpatel-ui/logicgate/security/advisories/new). Do not open a public issue, pull request or discussion with exploit details.

Never include a live secret, token, cookie, private key, victim hostname or proprietary payload in a report. Use synthetic values and redacted transcripts.

## Supported versions

| Version | Status |
| --- | --- |
| latest `main` | Supported |

Security fixes are applied to the latest state of the default branch.

## Scope

This policy covers the static LogicGate browser workbench and its Node tests, including Boolean expression parsing, exact-cover solving, netlist evaluation, timing and hazard analysis, Verilog export, proof reports, bookmark links, imported state and generated CSV, JSON or Markdown output.

In scope:

- A cross-site scripting or HTML injection path through expression text, variable names, benchmark labels, bookmark state, verification output or rendered report content.
- A parser, netlist decoder, bookmark codec or validation flaw that bypasses documented resource bounds or executes attacker-controlled code.
- A Verilog, CSV, JSON, Markdown or proof export flaw that makes generated output execute a formula, script or unexpected hardware-tool command when opened.
- A checksum, digest or verification bypass that makes altered output validate as untampered.
- A resource-limit bypass that turns a small malicious input into persistent corruption of shared application state rather than a bounded local failure.

Out of scope:

- Browser vulnerabilities, operating system compromise or physical access to the machine.
- Damage caused by modified copies of the static application that do not come from this repository.
- Circuit correctness, timing accuracy or engineering use without a security impact.
- Denial of service that only affects the attacker's own browser tab.

## Coordinated disclosure

- Acknowledgment: within 3 business days.
- Initial triage: within 14 calendar days.
- Fix or mitigation target: within 90 calendar days for confirmed reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.
