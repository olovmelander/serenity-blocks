# Local Multiplayer — Unified Team Colors + Team UX Plan (corrected)

> **Status:** ✅ IMPLEMENTED (research-backed, code-verified via multi-agent verification). All 333 unit tests pass. Manual in-app verification (Phaser board) is the remaining user step.
>
> **Goal (user's model):** In the Local Multiplayer setup menu each player defaults to their **own team** — P1=A, P2=B, P3=C, P4=D. Putting two players on the **same team gives them the same color**, and that color must be the **exact** one the game uses at runtime — board/canvas border, the HUD, and the garbage they send. The config card must **live-preview** the runtime color. **Drop the redundant "Play in Teams" toggle**: the per-player Team selector becomes the single mechanism (all-distinct teams = today's FFA; any shared = allies).

---

## 1. Verified investigation — how colors flow today

### 1a. The three palettes (only one is local-MP truth)
- **`src/core/multi-player-state.js:22-47`** — `PLAYER_COLORS` = objects `{primary, light, glow, name}`: **[0] Blue `#3B82F6` (P1), [1] Red `#EF4444` (P2), [2] Green `#10B981` (P3), [3] Amber `#F59E0B` (P4)**. This is the **local-MP source of truth**; `LocalMultiplayerMode` imports it (`LocalMultiplayerMode.js:5`).
- **`src/core/constants.js:46-55`** — a DIFFERENT `PLAYER_COLORS` (plain hex strings, index 0 = RED, different values/order). Consumed **only** by online P2P FFA (`ffa-p2p-game-state.js:23,277`). **Out of scope**; do NOT merge it with the object palette (orders/values disagree).
- **`src/ui/local-match-config-modal.js:21`** — `SLOT_ACCENTS = ['#f87171','#60a5fa','#fbbf24','#34d399']`, a THIRD palette used only for the setup card accent (`--slot-accent`). These are the Tailwind **light** shades and are in **P1=red/P2=blue/P3=yellow/P4=green** order — the order is swapped vs the in-game palette (P1 Blue/P2 Red) and the shade is wrong (light vs `.primary`). **This is the visible setup-vs-game mismatch.**

### 1b. Runtime color funnels through one function
Everything in-game derives from `MultiPlayerState.getPlayerColor(i)` → `this.playerColors[i]` (assigned by `_assignPlayerColors`, `multi-player-state.js:460-476`), surfaced per-element by `LocalMultiplayerMode._getPlayerColorScheme(i)` (`LocalMultiplayerMode.js:2633-2645`, which **prefers** `getPlayerColor`, always truthy via the `|| PLAYER_COLORS[0]` fallback).

- **Board / canvas border + glow** — `_applyPlayerColors()` (`LocalMultiplayerMode.js:2772-2837`, called once at `2578`) reads `scheme = _getPlayerColorScheme(i-1)` and sets `#p{i}-border.borderColor = primary` and `#p{i}-phaser-container.border = 2px solid primary`. **Auto-aligns** when `getPlayerColor` becomes team-driven.
- **HUD standings color dot** — `_initStandingsHUD` (`LocalMultiplayerMode.js:1247-1262`) sets `.player-color-dot` background = `_getPlayerColorScheme(i).primary`. **Auto-aligns**, set **only at init** (`_updateStandingsHUD` never re-touches the dot) — fine since teams are fixed pre-match.
- **Garbage blocks** — `multi-player-state.js:657` `attackerColor = getPlayerColor(playerIndex)`; `:666` `context.color = attackerColor.primary`; stamped onto each line entry (`garbage.js:195,220`), the garbage piece (`garbage.js:682`), the board cell (`board.js:28-48`).
- **Attack targeting / friendly fire** — `_getAttackTargets` (`multi-player-state.js:756-771`) compares **raw** `playerTeams` and already skips same-team targets; fully N-team general today. Gated on `isTeamMode`.

### 1c. Garbage render reality (verified — not a blind "auto")
The live local-MP renderer is **Phaser** (`board-panel.js` extends `BaseBoardScene`; no override of `drawBoardFromGrid`). In `base-board-scene.js`:
- `resolveColor` (**826-840**): for a garbage cell with a custom color (`isCustomColor = cell.color && cell.color !== '#808080'`), theming is **SKIPPED**, so the attacker hex is used verbatim and the cell is filled **matte**. `drawAnimatedPieces` (991-997) does the same for rising garbage.
- **Verdict: garbage already renders in the attacker's color on the victim board for LOCAL MP — NO new render code required.** Depends on the custom-color bypass at `836/994`; do not regress it.

**Boundaries (state, don't assume away):**
- **Online only:** `binary-encoding.js:455-480` `_encodeGarbageEntry` does NOT serialize `color` → network garbage falls back to gray. Out of scope.
- **Latent canvas path:** `draw.js:243-248` forces rising garbage gray — NOT the live MP path.
- **Dead code:** the attacker-colored incoming-garbage sliver `drawGarbageIndicator` (`multi-player-canvas-layout.js:1928-1992`) is unused; the live indicator is uncolored `GARBAGE <n>` text (`board-panel.js:240-249`).

### 1d. The 2-team hardcaps (there are eight, across files)
1. `_assignPlayerColors` **team branch** (`multi-player-state.js:462-468`): `teamColors = [PLAYER_COLORS[0], PLAYER_COLORS[1]]`. (FFA branch `473-475` already uses all 4 colors.)
2. `_getResolvedTeamId` (`LocalMultiplayerMode.js:2620-2626`): returns teamId only if 0/1 else `playerIndex%2`. **Central resolver.**
3. `_getTeamColorScheme` (`2628-2631`): `teamId===1?1:0`.
4. `_getTeamLabel` (`2647-2649`): only `'Team A'/'Team B'`.
5. In-game team **marker** (`332-335`): inline `teamId===0?'TEAM A':'TEAM B'`.
6. `_recordTeamRoundWin` (`2705-2710`): re-clamps `teamId===1?1:0`.
7. `_handleTeamRoundEnd` (`2962-2964`) + `_showMatchEnd` (`3253-3255`): re-clamp the (already-resolved) winner id.
8. `endMatchByTeam` (`multi-player-state.js:938-942`): `winner = \`Team ${teamId===0?'A':'B'}\``.
   Plus `teamRoundWins = {0:0,1:0}` fixed init in THREE places (`LocalMultiplayerMode.js:86,429,3641`); and the **inline garbage team-stamp** `%2` (`multi-player-state.js:661-663`) — color at `666` is fine, only the `team` field is wrong.

**Already N-team general (do NOT rewrite):** `_getTeamRoundOutcome` (`2668-2692`, last-team-standing over a Map); `checkWinCondition` team aggregation (`multi-player-state.js:839-870,886-894`, raw `playerTeams`); board team-frag "TF" total (`1187-1196`, raw `playerTeams`). **Caveat:** TF total uses RAW `playerTeams` while standings/color use CLAMPED `_getResolvedTeamId` — once the resolver is fixed both agree.

### 1e. Config modal (verified)
- Path `src/ui/local-match-config-modal.js`; exports pure `buildLocalMatchConfig(values)` + `LocalMatchConfigModal`; sibling test `local-match-config-modal.test.js`. Accent CSS in `public/styles/match-config-styles.css`.
- Per-card Team `<select>` is **always rendered** with two options (`0` Team A, `1` Team B); visibility is **CSS-gated** by `.teams-on` on `#player-slot-cards` (`match-config-styles.css:677-687`), toggled from `#team-mode` "Play in Teams" checkbox.
- Default team split = `i <= numPlayers/2` (`371-373`) — **not** per-player own-team.
- `buildLocalMatchConfig`: `isTeamMode = get('teamMode') === 'on'`; `playerTeams` init `[]` and **only populated when `isTeamMode`**.
- Test asserts current contract: `playerTeams).toEqual([])` (`test:31`), `isTeamMode).toBe(false)` (`test:30`); Infinity LMS test sends no team fields.

### 1f. Color spots NOT reachable by the propagation premise (NEW work)
- **Next-piece previews (`draw.js:313-354`)** — `drawNextPieces(nextCanvases, nextPieces)` has **no color/playerIndex param**; glyph fill from `styleManager.getStyleForPiece`/`COLORS[nextKey]`. Call sites `LocalMultiplayerMode.js:511,543,3183,3204`. The highlighted-slot border `.player-next-piece.highlight` (`main.css:20918-20925`) DOES read `--player-primary` (auto); the **glyph** does not.
- **Latent index-keyed CSS** (`main.css` `20659-20729, 20837-20879, 21353-21391`) duplicates the palette by `data-player` index; masked by inline `_applyPlayerColors` today.

---

## 2. The fix

### 2a. Single team-color palette (4 teams)
Add `export const TEAM_COLORS = PLAYER_COLORS;` in `multi-player-state.js` (A=Blue, B=Red, C=Green, D=Amber). The config modal imports the same objects and uses **`.primary`** (board color), not `.light`.

### 2b. Make `getPlayerColor` team-driven (one unconditional branch)
Replace BOTH branches of `_assignPlayerColors` with:
```
this.playerColors = this.players.map((_, index) => {
    const teamId = this.matchConfig?.playerTeams?.[index] ?? index;
    return TEAM_COLORS[teamId % TEAM_COLORS.length] || TEAM_COLORS[0];
});
```
Default `playerTeams=[0,1,2,3]` → Blue/Red/Green/Amber = today's FFA, zero regression. Border + garbage auto-align.

### 2c. Generalize ALL the team helpers/sinks to N teams (eight fixes)
- `_getResolvedTeamId(i)` → `clamp(playerTeams?.[i] ?? i, 0, numTeams-1)` (NO `%2`).
- `_getTeamColorScheme(teamId)` → `TEAM_COLORS[teamId % len] || TEAM_COLORS[0]`.
- `_getTeamLabel(teamId)` → `\`Team ${String.fromCharCode(65+teamId)}\``.
- Team marker (`332-335`) → use the helpers (drop inline binary).
- `_recordTeamRoundWin`, `_handleTeamRoundEnd`, `_showMatchEnd` → pass real `teamId`, delete `===1?1:0`.
- `endMatchByTeam` → `\`Team ${String.fromCharCode(65+teamId)}\``.
- `teamRoundWins` init → seed `0..numTeams-1` (reads already default via `|| 0`).
- Garbage team stamp (`661-663`) → `context.team = isTeamMode ? playerTeams[playerIndex] : null`.
- **Leave `_getTeamRoundOutcome` + `checkWinCondition` aggregation UNCHANGED**; route TF total + standings through the fixed resolver.

### 2d. Friendly fire + derived `isTeamMode` (drop the toggle)
- `_getAttackTargets` already skips same-team via raw `playerTeams`; keep the `isTeamMode` gate (now derived).
- **Derivation:** `isTeamMode = new Set(playerTeams.slice(0, numPlayers)).size < numPlayers` (any sharing ⇒ team mode; all-distinct ⇒ FFA).
- **Single-team guard (BLOCKER):** a config with only ONE distinct team present → `_getAttackTargets` returns `[]` + `_getTeamRoundOutcome` returns null → match HANGS. Block at setup (require ≥2 distinct teams when sharing) and/or fall back to FFA in round-end paths (`1776-1779` standard, `1710-1746` Infinity LMS).

### 2e. Config menu — Team selector drives the card color (live preview)
In `local-match-config-modal.js`:
- Delete `SLOT_ACCENTS`; import `TEAM_COLORS`. Accent = `TEAM_COLORS[selectedTeam].primary`.
- Remove `#team-mode` toggle + its listener + the `teams-on` CSS gate. Team `<select>` always visible.
- Options A–D capped at `numPlayers`. Default **P_i → Team i**.
- Reactive recolor: on `change`, update card `--slot-accent` to the new team's `.primary`. Same team on two cards → identical accent.
- `buildLocalMatchConfig`: always emit `playerTeams` (default `[0,1,..]`); remove `teamMode` read; `isTeamMode = Set(playerTeams).size < numPlayers`.

### 2f. Next-piece previews (NEW)
Minimal/recommended: tint the **slot frame** via the existing `--player-primary` CSS var in `_applyPlayerColors` (highlight border already reads it). Glyph fill via threading `drawNextPieces` is out of scope unless requested.

### 2g. Latent CSS cleanup (optional)
Convert index-keyed `main.css` rules to `var(--player-*)` or delete; remove dead `.player-board-label`.

---

## 3. Contract + test changes (UPDATE existing)
- `playerTeams` always populated (default `[0,1,..]`); `isTeamMode` derived; `teamMode` form field gone.
- FFA default test (`:30-31`): now `playerTeams=[0,1]`, `isTeamMode=false`.
- Infinity LMS test (`:57-76`): now `playerTeams=[0,1,2]`, `isTeamMode=false`.
- Add shared-team case (`player1Team:'0', player2Team:'0'`): `isTeamMode=true`, `playerTeams=[0,0]`.

## 4. Risks / edge cases
- **2 players same team:** BLOCKER (hang) — guard (see 2d).
- **4 distinct = FFA parity:** only once `isTeamMode=false` for all-distinct AND resolver no longer `%2`.
- **`numTeams` cap:** palette has 4 entries; cap teams at `numPlayers`.
- **Garbage color** depends on Phaser custom-color bypass — don't regress.
- **Online MP unaffected**; network garbage color-loss is a known out-of-scope boundary.

## 5. Implementation phases
1. Palette: `export const TEAM_COLORS`.
2. Config: drop toggle/gate/SLOT_ACCENTS; always-on Team select A–D capped, default P_i→i; reactive accent from `.primary`; `buildLocalMatchConfig` always emits `playerTeams` + derived `isTeamMode`; single-team guard. Update CSS.
3. Engine color: rewrite `_assignPlayerColors`.
4. Engine team generalization: the eight clamps; route TF total + standings through fixed resolver.
5. Friendly fire / derivation: single-team fallback in standard + Infinity LMS round-end.
6. Next-piece preview slot-frame tint.
7. Optional CSS cleanup.
8. Tests: update `local-match-config-modal.test.js`; run vitest.
9. In-app verification (manual; WebGPU/Phaser can't be headless-screenshotted).

## 6. Open question
- Game Mode (FFA / Infinity LMS) stays separate from teams (teams control color + ally behavior; Game Mode controls win conditions). Removing "Play in Teams" only removes the redundant toggle.
