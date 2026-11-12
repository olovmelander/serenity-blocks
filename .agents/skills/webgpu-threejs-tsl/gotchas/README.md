# Gotchas: how this folder works

Every fault that cost a session a round, written down so it costs the next one nothing. The
files are split by what you are doing when you need them; `SKILL.md` lists what each covers.

## Reading

- **One gotcha is one line**: `| #id | symptom | cause | fix |`, 600 to 1,600 characters long.
  A search tool that clips long lines shows nothing of it, so search with the script, which
  prints each hit whole as symptom, cause and fix:
  `node .claude/skills/webgpu-threejs-tsl/scripts/gotcha.mjs <number | words… | --list [file]>`.
- **A symptom cell that starts "Need …"** is a recipe, not a fault: a way to get an effect that is
  known to work on both backends, with the file that does it.
- **The fix names its precedent**: a function and a file in `src/`. Read that code before writing
  your own version; the row is the summary, the file is the detail.
- A `look-` file is worth reading whole before you build that kind of thing. An engine file
  (`tsl-`, `numerics`, `materials-`, `geometry-`, `post-`, `textures-`, `performance-`,
  `backends-`) is worth reading whole once, and searching after that.

## The numbers

A row's number is permanent: docs, plans and code comments cite rows as "gotcha #94".

- **#63 to #188** are the numbers the theme concept docs and the theme playbook already use
  (`docs/theme-concepts/`): each was the row's line number in `SKILL.md` in October 2026, when the
  whole table lived there.
- **#200 to #274** are the rows added between then and the split into this folder.
- **From 300 up, each file owns a block of a hundred**, named at the top of its table. A new row
  takes the next free number in its file's block. Two sessions adding rows at the same time then
  either write to different files (different blocks, no clash) or to the same file, where git
  reports the conflict at the end of the table and whoever resolves it gives the second row the
  next number.

| File | Block |
|---|---|
| `tsl-emission.md` | 300–399 |
| `tsl-functions-loops.md` | 400–499 |
| `numerics.md` | 500–599 |
| `materials-draw-order.md` | 600–699 |
| `geometry-instancing.md` | 700–799 |
| `light-shadows.md` | 800–899 |
| `post-color.md` | 900–999 |
| `textures-noise-targets.md` | 1000–1099 |
| `performance-tiers.md` | 1100–1199 |
| `backends-capture.md` | 1200–1299 |
| `look-water.md` | 1300–1399 |
| `look-sky-space.md` | 1400–1499 |
| `look-clouds-volumes.md` | 1500–1599 |
| `look-terrain.md` | 1600–1699 |
| `look-events-particles.md` | 1700–1799 |

## Adding a row

1. Pick the file by where the next person will look: by the kind of code for an engine fault,
   by the kind of thing being built for a look. One row lives in one file; add its number to
   another file's "See also" line when it belongs to two.
2. Append it to the END of that file's table, with the next free number in the file's block.
3. Write the three cells so each stands alone:
   - **Symptom**: what is seen or the exact error text, in the words someone would search for,
     and when it shows (which backend, tier, aspect, after how long).
   - **Cause**: the mechanism, specific enough that the reader could have predicted the symptom.
   - **Fix**: what to do, then the precedent as a function and a full path
     (`` `name` in `src/themes/<id>/<file>.js` ``) and the date. Name the file even when it is
     the same one as the row above: rows are read out of order.
4. Keep the row on one line, and escape a pipe inside a cell as `\|`.
5. Copy the file to the mirror at `.agents/skills/webgpu-threejs-tsl/gotchas/` (same bytes) and
   run `npx vitest run tests/unit/agent-skill-mirror.test.js tests/unit/agent-skill-contract.test.js`.

If a row turns out to be wrong, correct it in place and say so in the row (what was believed,
what is true, how it was shown), as the reversed-edge `smoothstep` note in `tsl-emission.md`
does. A wrong rule that vanishes without a word gets rediscovered and written down again.

If a rule now holds for every shader in the repo, it also earns one line in `SKILL.md`'s
"Rules that hold in every shader", with its number. Nothing else about a gotcha goes in
`SKILL.md`: that page is loaded whole every time the skill is used, and the contract test holds
it to a size.

## Merging a branch that still has the old table

Until 2026-11 every row lived in one table in `SKILL.md`, and branches cut before the split
append rows there. When such a branch meets `main`, `SKILL.md` conflicts. Take `main`'s
`SKILL.md` whole, then move each row the branch added into its topic file here (steps 1 to 5
above). The contract test fails while `SKILL.md` still holds a gotcha row (any table row longer
than 400 characters) or has outgrown its size budget.
