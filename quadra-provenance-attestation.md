# Independent-Authorship Attestation — Scoring / Physics / Garbage Code

**Project:** Serenity Blocks
**Subject code:** the line-clear scoring, speed/gravity, level-progression, garbage/attack, and cascade logic in `src/core/` — notably `scoring.js`, `constants.js`, `physics.js`, `garbage.js`, `cascade-resolver.js`, and `game.js`.
**Prepared:** 2026-07-15
**Status:** **AFFIRMED by the repo owner (2026-07-15).** The owner confirms the statements below are accurate and that the Quadra source reviewed is the repository and commit pinned in the signature block.

## Declaration

I authored the code identified above myself. In writing it I referenced the open-source game **Quadra** (by **Ludus Design**, © 1998–2000; licensed under the **GNU LGPL v2.1-or-later**; source at <https://github.com/quadra-game/quadra>) **only to understand its observable behaviour, its mathematical formulas, its numeric game-balance constants, and its game rules.**

Specifically:

- I **did not** copy, paste, or mechanically translate any of Quadra's source code, and I did not copy its comments or its code structure.
- What I reused from Quadra is limited to **formulas, numeric constants, and game rules** — for example: the per-level speed curve (`4 + (level−1)·5` / `50 + (level−10)·3`), the 250 / 500 / 1000 / 2000 line-clear values, the `depth − 1` and `(1 + depth) / 2` attack formulas, the MSB-first hole-encoding convention, and the 15-lines-per-level progression rule. These are functional facts, formulas, and rules, which to my understanding are not protected by copyright (17 U.S.C. § 102(b)).
- The implementation is my own independent, idiomatic JavaScript.

I understand that reusing another program's rules, formulas, and numeric values is permitted, while copying its source code, comments, or expressive structure is not — and I affirm that I did the former and not the latter.

**Signed:** Olov Melander (repo owner)
**Affirmed:** ☑ yes — the owner confirms this attestation is accurate
**Upstream Quadra source compared:** `github.com/quadra-game/quadra`, branch `master` @ commit `d6c7226a25a251b484387af3c0e37c719459cd4f`
**Date:** 2026-07-15

---

*Context.* This attestation supports the derivative-work / LGPL analysis recorded for the Quadra subsystems, which independently compared this code against Quadra's actual source (`canvas.cc`, `player.cc`, `net_list.cc`, `random.cc`, at `github.com/quadra-game/quadra` `master` @ `d6c7226`, reviewed 2026-07-15) and found only formula/rule reuse — no copied lines, comments, or transliterated structure. The Quadra-derived identifier names that previously appeared in the code have since been renamed to neutral terms.

*This is the developer's own record for provenance purposes. It is not legal advice. Before commercial release, counsel may wish to confirm this attestation and retain it with the project's IP file (the exact upstream Quadra commit compared is pinned above).*
