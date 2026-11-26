# Pass 4 audit scripts, as run at e31421d3b

These measured the audit and both plans of docs/ODYSSEY_LEVEL_DESIGN_PASS4_2026-11.md (sections 1 to 5) before
anything was built. They set the rival up through the benchmark's `configureRival` hook on the code of
`e31421d3b`, where a live rival still played the older play under Odyssey's own duel rules.

On later commits the duel itself plays the versus play and rules, so `rival-run.mjs` no longer reproduces
those columns: its "classic" setting was the rival as shipped then. To repeat the audit, check out
`e31421d3b`, copy this folder to `artifacts/odyssey-level-design-audit-2026-11/scripts/pass4/` there (one
folder up, which is where the import paths point), and apply `prototype-bot-code.patch` for plan A's runs.

The scripts one folder up measure what was built.
