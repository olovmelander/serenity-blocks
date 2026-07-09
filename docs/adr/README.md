# Architecture Decision Records

MADR-lite records for decisions that constrain work in this repo. Each record states the
decision, why it was taken, and what enforces it — per the remediation-plan bar: *any
architecture rule that matters twice must become a type, test, fitness check, budget,
artifact, or release gate; markdown alone is not the control.*

Agent-assisted sessions: load this directory before proposing structural changes —
an agent will happily re-add a forbidden pattern unless the constraint is loadable.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-phaser-three-are-runtime-dependencies.md) | phaser and three are runtime `dependencies` | accepted |
| [0002](0002-lint-policy-decisions.md) | Lint policy: no-bitwise off, unresolved-import ignores, max-len warns | accepted |

Format per record: **Status / Date / Context / Decision / Consequences / Enforcement.**
New records: next number, kebab-case slug, add a row here.
