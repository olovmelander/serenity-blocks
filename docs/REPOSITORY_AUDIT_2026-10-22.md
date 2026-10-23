# Repository audit, 2026-10-22: what was fixed, what is still open

A six-area audit of the whole repository (core simulation, multiplayer/Steam/Electron, rendering
and themes, UI shell and audio, dead code and repository weight, dependencies/CI/tests/bundle),
run as parallel read-only agents at `82f07a56`, with the top findings re-checked by hand. Items
the [remediation plan](ARCHITECTURAL_REMEDIATION_PLAN.md) or the
[2026-10-13 audit](REPOSITORY_AUDIT_2026-10-13.md) already tracked are not repeated here unless
they changed. This is a record and a queue, not a plan: harvest the open items into the umbrella
plan before executing them.

## Fixed the same day

| Merge | What changed |
|---|---|
| `e1ed148c` | `wireV2` re-dated to 2026-11-30 (ADR-0013 amendment), so CI does not go red on 1 November. Steam Cloud: a new device no longer overwrites another device's settings and keybinds before it has read the cloud; unsent uploads survive a restart (offline scores, stats and Odyssey progress now reach the cloud). Online: peer colours must be hex (a `url()` colour made every viewer fetch an address), names lose bidi and zero-width characters, rejected-packet counts are bounded, rejoins, repeated rematch votes and ready toggles no longer flood the lobby, `maxPlayers` and the roster are capped at 8. Board effects follow Reduce motion in every mode and Reduce flashing in Odyssey. |
| `6df8eeb0` | Electron 38.8.6 → 44.9.3, exact pin ([ELECTRON_44_UPGRADE_2026-10.md](ELECTRON_44_UPGRADE_2026-10.md)). Placeholder themes play Blood Moon's one file under their own URLs (−255 MB per deploy and installer). Production builds leave out the console test helpers and drop `debugger` / `console.debug` (the `build.esbuild` option was ignored). Every `// @ts-check` file is type-checked (14 were not). 13 vulnerable transitive packages patched (`npm audit fix` itself downgraded electron-builder and tar, and was not used). |
| `710f5124` | Local versus judges the match on match totals: a 3-4 player match no longer freezes when a kill reaches the frag goal with players alive; points, lines and time end the match when reached and go to the leader; a pause during the countdown holds; the match clock and the Hot Potato stop while paused; the lock bonus measures hold time; the results card shows the match's frags. |
| `feature/odyssey-fixes` | Tide is refused when the falling piece would sit inside the settled stack. Finish mid-cascade waits for the cascade. Retry clears the showcase banner and keys. A throwing orb ending returns to the map. An Odyssey visit no longer leaves ~80 MB of VRAM behind (three hooks every renderer to the shared device's `lost` promise; kept textures held their renderers): measured 1635 → 2041 MB over six visits before, flat after. |

## Still open, most important first

**Security and dependencies**
1. ~~Vite 5 → 7 and Vitest 3 → 4 together~~ **done 2026-10-23** (`feature/vite7-vitest4`):
   `npm audit` is clean; the dev server listens on 127.0.0.1 (`npm run dev -- --host` for the
   LAN). Same chunks, boot closure and build time; Vite 7 strips license comments from the
   bundle, so `build.license` now writes `dist/THIRD_PARTY_LICENSES.md` and the Pages artifact
   check requires it. Still open: Vite 8 / Rolldown + Vitest 5 as their own project, gated by
   `check-boot-closure.mjs` (Rolldown replaces the `manualChunks` rules this build relies on).
2. Electron hardening. **Part 1 done 2026-10-23** (`feature/electron-hardening`), measured in a
   packaged build: permissions are denied by default (the game page gets fullscreen, clipboard
   writing and the wake lock; camera, microphone, location, notifications, clipboard reading,
   MIDI, HID and Bluetooth picks are refused); every IPC handler, Steam's included, answers only
   the game's page (a `data:` page in the game window is refused); release builds refuse DevTools
   and show neither the DevTools row nor the URL-parameters tab (both return with
   `SERENITY_ENABLE_DIAGNOSTICS=1` and in dev); the CSP has no remote origins left. The header
   CSP was measured to apply to the packaged `file://` load (eval and injected inline scripts are
   blocked), so no meta CSP is needed for the desktop. Still open: fuses (they change the exe, and
   Smart App Control blocks a new unsigned exe on the dev laptop: needs signing or another
   machine) and `app://` (owner decision; must precede any public build).
3. Close Dependabot PR #315 (TypeScript 7 removes the compiler API two CI gates use); give majors
   their own PRs; ignore `three` (ADR-0018) and TypeScript majors; merge #297 and #348.
4. ESLint 8 (end of life) → 9 via FlatCompat, then 10 with vendored airbnb rules and
   `eslint-plugin-import-x`; decide Prettier (it disagrees with the lint rules on 1,746 files);
   lint `electron/`.

**Bugs** (5, 7, 8, 10, 11 and the first of 9 fixed 2026-10-23 on `fix/player-bugs`; the rest open)
5. ~~Sunfall: a failed build is swallowed into a blank theme with no Forest fallback; it ignores
   render scale, drops a quality change made while parked, never resets on game over, and `||`
   turns Minimal's 0 into more effects than Low.~~ Fixed: game over closes the cloud deck and a
   new run opens it (checked in the packaged app).
6. Steam: a renderer crash or reload leaves the player as a ghost lobby owner; `currentLobby` is
   replaced without `leave()`; accepting an invite mid-match tears the match down halfway, and one
   to your own lobby demotes the host; rich presence is not cleared while reconnecting;
   leaderboard details are never sent and `FFAWinRate` uses KeepBest; `setStat('odyssey_stars')`
   can lower the stat; lobby `status` can inject CSS classes.
7. ~~Serenity mode `onStart` has no liveness check after its awaits: leaving mid-start keeps the
   wake lock, theme drift and media keys on the menu.~~ Fixed (a start generation, as local versus).
8. ~~The Random-theme timer runs on the menu and while hidden, disposing the parked warm theme; two
   handlers disagree about starting it.~~ Fixed: one owner (`themes/random-theme-rotation.js`),
   only in a running game on a visible page, never in Serenity or Odyssey.
9. Web build: ~~`pagehide` tears the app down even for the back/forward cache (a dead menu on
   Back)~~ (fixed: a restored page reloads); still open: the high-score IndexedDB (and
   DemoManager) open a connection per concurrent caller with no `onversionchange`/`onblocked`,
   so the next `DB_VERSION` bump can hang the results screen while an old tab is open; a startup
   that loses to the 45 s watchdog never adopts the late app, so Steam, the quit flush and the
   deferred services never start (needs the post-app wiring in `main.js` made re-runnable).
10. ~~A knock-out right after a zoom punch leaves the board camera zoomed and blocks later punches;
    two Phaser cleanup checks test fields Phaser 4 does not have (`hasFinished`, `emitter.on`).~~
    Fixed.
11. ~~The chapter 7 warp reads only the OS reduced-motion setting, every frame.~~ Fixed (the shared
    `prefersReducedMotion()`).

**Performance and VRAM**
12. The Odyssey charm-icon stage: its own WebGPU device, ~14 synchronous pipelines on the first
    HUD tray, never released, a layout read every frame.
13. Spring's impostor atlas keeps ~100 MB (High) to ~226 MB (Extreme) of unused MSAA buffers.
14. Parked effects nothing warms (Grainfields beams, Sunfall's exhale cloud): synchronous
    compiles on the first lock; the theme manager still never reads `getWarmupRoots()`.
15. Hot CPU paths: Rainbow Terraces' per-frame spray sort, Grainfields' 77 KB trample upload every
    frame and its 260-280 ms herd replay per rebuild; a new Phaser emitter or Graphics per clear.
16. One canvas-context wrapper per Odyssey visit is still retained (its GPU memory is freed).

**Size, structure and hygiene**
17. Three is one 1.61 MB chunk including the 354 KB WebGL build; `levels.js` and the Stillfall
    puzzle bank load eagerly; 37 CSS files ship unminified and unhashed. Add a dist-size budget.
18. Theme adapters are copy-pasted (Grainfields and Sunbraid differ in 7 code lines): extract
    the shared adapter (T11) before there are more copies.
19. Dead code: ~2.5k lines of render code (`WarpTransitionRenderer`, Wolfhour's overlay dust,
    Phaser board leftovers), ~1.5k lines of unused modules, ~600 in `main.js` and the sound
    manager, 142 unused exports; nine drifted `escapeHtml` copies; `preload.mjs` duplicates
    `preload.cjs`. A shrink-only unused-exports ratchet would hold the line.
20. Repository weight: git grows 0.5-0.8 GB a month from screenshots and evidence zips (code is
    2% of history); 64 merged worktrees use ~140 GB; 80 files in `public/playground-refs`
    (100 MB) are referenced by nothing; CI checks out `docs/` and `reports/` twice per push.
21. CI: the full-audit lane always reports success; tests are not sharded and the build waits for
    them; `gpu-validation.yml` has failed since August; no Windows/Electron packaging job.

## Notes for whoever picks this up

- New unsigned packaged builds are blocked on this laptop by Windows Smart App Control. Measure
  with an already-allowed exe and swap `resources/app.asar`, or sign the builds.
- The stored GitHub token has no `workflow` scope: a push that changes `.github/workflows/*` is
  rejected (`gh auth refresh -s workflow`).
- The main checkout's `node_modules` still holds Electron 38 until someone runs `npm ci` there
  (then `node node_modules/electron/install.js`; npm 11 blocks Electron's download script).
