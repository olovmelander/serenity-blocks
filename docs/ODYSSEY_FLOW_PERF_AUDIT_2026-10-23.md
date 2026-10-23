# Odyssey flow and performance audit (2026-10-23)

**A record.** An audit of Odyssey's flow, performance, transitions, bugs and stutter, ranked,
then fixed from the top down. It builds on the 2026-10-19 smoothness pass
([ODYSSEY_SMOOTHNESS_PASS_2026-10.md](ODYSSEY_SMOOTHNESS_PASS_2026-10.md)), whose probe and
report tools did the measuring here.

## 1. How it was measured

- **Machine.** RTX 5080 laptop GPU, 2560×1600 panel at 1.5× (the map at pixel ratio 1.5),
  presenting at about 180 Hz. The Radeon 610M iGPU was not used: CLAUDE.md records full WebGPU
  captures crashing it.
- **Runs.** `scripts/odyssey-feel-probe.mjs` at Extreme, cap 144, on a frozen `origin/main`
  worktree:
  - a cold shader cache;
  - two warm runs;
  - a rush along the whole path 1.5 s after the reveal;
  - Chromium traces of the start, an orb entry and an orb exit;
  - CPU profiles of three orb entries (Geode, Fall, Stellar Drift) and one exit.
- **Code audit.** Four read-only agents (frame loop, chapter environments, transitions and
  flow, render pipeline). I checked their main claims against the code; the list below marks
  how each item is known.
- **Gate checks.** A worker draws the portal gate now, which the probe's canvas hook cannot see.
  The gate was checked with scratch scripts: a trace of its own draw cadence against
  `Display::DrawAndSwap` and the GPU process's long tasks, worker against `?portalGateWorker=0`.
  Camera moves were checked with a per-frame recorder of camera position and view direction.

**Steady state was not the problem.**

| Measure | Value |
|---|---|
| Main thread per frame | ~1.1 ms |
| GPU per frame | ≤ 1.5 ms (heaviest chapter 1, ~1.3 ms) |
| 30 s trip along the whole path | 0–2 frames over 20 ms |
| Synchronous pipeline builds on a live frame | none |

The cold run and a rush were as clean.

**What players feel are moments of change:**
- orb entries, where the theme's build stalls the main thread for 140–210 ms;
- the GPU process rasterising page content;
- a few camera cuts;
- some state bugs.

## 2. The ranked list, and what was done

Each item is marked **fixed**, **partly fixed** or **open**.

### Tier 1: what players feel, and bugs that break the flow

1. **Orb entry stalls freeze the gate.**
   - *Measured.* The level theme's construction runs on the main thread during the gate's
     hold: Geode 151 + 119 ms, Stellar Drift 214 ms, Fall 176 + 209 ms (profiled). The gate
     was drawn by main-thread rAF, so its passage froze for each stall.
   - **Fixed:** the gate draws in a module Worker on a transferred OffscreenCanvas.
     - `portal-gate-worker-core.js`, `portal-gate.worker.js`, `portal-gate-remote.js`.
     - The page posts each frame's description of the gate. The worker owns the passage's clock
       and travel, and keeps drawing on its own when the page goes quiet for more than 24 ms.
     - Without a Worker, an OffscreenCanvas or `transferControlToOffscreen` (and under
       `?portalGateWorker=0`) the gate draws on the page as before.
     - Entries and returns both use it; the worker starts and bakes its sprites on the idle
       map.
   - *Measured result.* Where only the main thread was busy, the gate now draws through it: a
     134 ms page gap became a 53 ms gate gap, and on a second entry the gate's worst gap was
     41 ms while the page stalled for 85 ms.
   - **Open:**
     - One ~80–100 ms freeze per session remains on the **first** entry: the GPU process
       rasterising the level's DOM for the first time (`RenderWorker` → Skia flush), which
       freezes the whole display. A second entry has none. It needs a raster warm-up of the
       gameplay UI.
     - The themes' own builds (`createScene` bakes, first-frame node builds) are still long;
       they are theme work.
2. **The map froze after a quick return.**
   - *Checked in code.* The entry pauses the board at its blackout and parks it 1.2 s after
     GO. A return inside that window revealed a paused board: no frames, no chapter music, the
     wheel ignored.
   - **Fixed:** `_revealOdysseyBoard` always resumes (it is idempotent). Test:
     `odyssey-board-reveal-resume.test.js`.
3. **A hard cut at the start of every cross-chapter glide.**
   - *Measured.* `travelToPosition` put the camera on the rail frame on its first frame: a
     20.5 u jump and a 68° turn in one frame from an orb close-up.
   - **Fixed:** a trip eases out of the pose it starts in over `TRAVEL_BLEND_IN_MS` (450 ms, at
     most 45 % of the trip). Position is lerped, the view direction slerped (lerping the look
     point turned the view 7° a frame early on), and up is lerped.
   - *Measured result:* the first frame moves 0.07 u, and the turn peaks at 3.6° a frame
     mid-blend.
4. **Chapter music only followed forward crossings.**
   - *Checked in code.* The seam bridge always went to the seam's far side, and nothing else
     changed the track.
   - **Fixed:**
     - The bridge goes to the chapter the camera is heading into.
     - The music follows the active chapter on every flip, and on leaving a seam on the side it
       was entered from (`_syncChapterMusic`, not before the board's own first chapter music).
   - Test: `odyssey-chapter-music-follow.test.js`.
5. **The automatic journey crossed the black hole's plunge in a fixed 2.2 s.**
   - *Checked in code.* The journey's fixed durations overrode `computeTravelDuration`.
   - **Fixed:** `travelToLevel` takes `minTravelDuration` as a floor under the computed trip,
     and the journey passes its 1500 / 2200 ms as floors.
6. **A ~57 ms frame on every return to the map.**
   - *Measured.* No script ran in it; the cause was GPU-process raster from the page-drawn
     return gate and the map's overlay repainting.
   - **Partly fixed by item 1.** With the gate in the worker, the return's GPU task over 40 ms
     is gone and its worst frame is 44–55 ms (it was 74–85 ms).
7. **Hitches in the first seconds after the reveal.**
   - *Measured.* With a warm cache: 7–14 frames over 20 ms and 2 over 50 ms.
   - The audit's first lead ("the background loading delay is cancelled") was tried and
     **reverted**: measured, it changed nothing. On a second reading the reveal's no-delay call
     may well be the intended trigger.
   - The long frames carry no script. A trace puts them on the GPU process rasterising the
     chapter-arrival card (see item 9). **Open:** the card's first raster.

### Tier 2: smoothness, and behaviour that depends on refresh rate

8. **Audio-reactive visuals ran at a speed set by the display.**
   - *Checked in code.* The analyser ran every 33 ms but was handed one frame's delta: its clock
     ran at ~17 % of real time at 180 Hz and ~50 % at 60 Hz. Its constants are real-time rates
     (attack 14/s, release 7/s, beat cooldown 150 ms).
   - **Fixed:** it gets the time since it last ran, capped at 250 ms. Callers: Odyssey's audio
     reactor, the intro and Chiral Gold, whose beat-reactive feel is now the same on every
     display.
9. **The chapter-arrival card repainted the whole page every frame.**
   - *Measured.* `chapter-breath.js` writes `--breath` per frame, and it drives
     transforms/opacity on unpromoted spans: 760 full-document paints and 25–70 ms of GPU
     raster a second.
   - **Fixed:** `will-change` on the breathing layers, and no write when the level has not
     changed.
   - *Measured result.* While the card is up, paints went from 1,526 to 4 and raster from
     25–70 ms/s to 0. The card looks the same (before/after crop).
10. **Two clocks ran slow or drifted.**
    - *Checked in code.*
      - The corridor field's clock only ticked on the settled camera's throttled frames.
      - Chapters capped their delta at 33 ms while the board capped at 50 ms.
    - **Fixed:**
      - The corridor gets the accumulated time of every frame.
      - Chapters cap at 50 ms.
    - Tests: `odyssey-corridor-clock.test.js`, `ChapterEnvironmentManager.test.js`.
11. **The orbs' bob stepped or froze, and the marker loop allocated per orb per frame.**
    - **Fixed:**
      - The drawn orbs bob every frame, a light pass over their glass matrices and window/halo
        centres.
      - The dirty-only gate dates from a 5,760-instance sparkle buffer that no longer exists.
      - The marker pairs are built once.
12. **Camera and input polish** (from the transitions audit; each checked in code).
    - **Chapter 7 roll snap.** Selecting an orb jumped the fall's roll and FOV by up to 14° in
      one frame. **Fixed:** in a focus move, the fall's terms ease from what was applied over
      0.8 s.
    - **Esc during an entry.** Before the gate covered the screen, the camera snapped to the
      rail and then swung back to the orb. **Fixed:** `onAbort` gets `covered`, and the camera
      snaps only under the cover. Otherwise the focus glides from where it is.
    - **Esc during a return** opened Settings over the passage, and a second "Back to map"
      restarted the closing. **Fixed:** a plain return owns Escape (capture phase). The pause
      sheet refuses Retry and Map while a return is under way.
    - **Navigator Play** entered after an interrupted glide. **Fixed:** it stops, with the
      navigator open and Play ready again.

### Tier 3: weaker machines

13. **The adaptive-quality ladder.**
    - **Partly fixed:** a rung that sheds nothing (bloom already at the quarter that tier 1 asks
      for) is stepped over instead of costing a cooldown each way.
    - **Open** (they need the iGPU lane):
      - the first resolution step below 0.95 rebuilds every scene pipeline (the sharpen pass);
      - there is no MSAA rung;
      - CPU-bound machines get no relief.
14. **The charm-icon stage.**
    - **Partly fixed:** slots are sized from a ResizeObserver, not a layout read per slot on
      every drawn frame.
    - **Open:** it is still a second WebGPU device on the map. Sharing the board's device needs
      care with r186's renderer-dispose leak on a shared device.
15. **Chapter builds.**
    - **Fixed:** concurrent `createChapterEnvironment` calls share one build (they could build a
      chapter twice and orphan a group with its lights).
    - **Fixed:** chapter 5 asks for chapter 6 at 0.10 before the boundary. At 0.06 it asked after
      chapter 6 could be seen.
    - **Open:** chapter builds are still one synchronous task.
16. **Per-frame CPU on the map.**
    - **Partly fixed:** the async-pipeline build-budget wrapper no longer copies its session set
      on every draw.
    - **Open** (unmeasured, small on this machine):
      - bloom's eight render calls;
      - matrix updates walking hidden chapters;
      - GPU timestamps on every pass;
      - small allocations.

### Tier 4: memory and small fixes

17. **Memory.**
    - **Fixed:** chapter 8's glow map and glyph atlas are registered in `ownedTextures`.
    - **Open:**
      - the paused map keeps ~80 MB of scene render targets during play;
      - chapters 6 and 7 bake the same sky twice;
      - Earth Core's R32F noise and its per-visit shaft build.
18. **Small fixes.** All **fixed**:
    - the grain's hash clock wraps at 64 s, on the CPU (a `mod` in the shader cost the map
      ~110 ms to open; see §3);
    - the debug hitch logger tests the raw frame gap;
    - the entry pulse is drawn through the node manager, as one swell, and actually shows;
    - a stretch with no frames (a hidden window) no longer counts against the entry hold.

**Investigate:** shader names built from three's global node counter could make shader text
depend on the order things were built in. The common path hits the cache (5 compiles at start,
4 at an orb entry with a warm profile), but a different orb-visit order was not tested. A related
oddity: the composite with the grain's `mod` missed the shader cache on every run, not only the
first, as if its text changed between runs. Main's composite hits.

## 3. Final comparison

The fixed tree against `origin/main` (`17612d53`): same machine and probe, warm shader cache,
runs interleaved.

| Measure | main | fixed |
|---|---|---|
| Map open: click to built board (`odyssey:mode:board-init`, median of 5) | 1,455 ms | 1,467 ms |
| Map open: board visible (median of 5) | 2,318 ms | 2,330 ms |
| Start, board frames over 20 / over 50 ms (5 runs each) | 9–11 / 2–3 | 9–11 / 0–3 |
| Orb entry, worst gap in the gate's drawing during a 134 ms page stall | 134 ms | 53 ms |
| Second orb entry, worst gate gap (page stalled 85 ms) | — | 41 ms |
| Return to the map, worst frame | 74–85 ms | 44–55 ms |
| Arrival card up: full-document paints / GPU raster | 1,526 / 25–70 ms/s | 4 / 0 |
| First frame of a cross-chapter glide from an orb close-up | 20.5 u, 68° | 0.07 u (turn ≤ 3.6° a frame) |

- **Probe frame numbers.** The probe times the page's own frames and the board canvas. They
  match main within run-to-run noise on every phase: the start, the reveal tail, three orb
  entries, play and exits. The gate's frames are drawn in the worker, where the probe cannot
  see them; the gate rows come from the gate checks in §1.
- **A regression the comparison caught.** With the grain's 64 s wrap written in the shader
  (`mod(uTime, 64)`), the map opened ~110 ms later on every run. A bisect over file groups
  narrowed it to that one line. The composite's pipeline took ~90 ms to create before the
  reveal, against 15–20 ms on main: its new text missed the shader cache on every run. The wrap
  is now on the CPU, where `uTime` is written (it feeds only the grain), and the composite's
  shader text is main's again. Test: `odyssey-tsl-pipeline-grain-clock.test.js`.
- **Gates.** Typecheck, the TypeScript and lint ratchets, the fitness check and the dependency
  boundaries pass. The full suite passes 22,420 tests. Four files fail on this machine whatever the
  branch (three number formats under the sv-SE locale, and the TTS recorder's symlink in a
  worktree). They fail the same way on main.

## 4. Switches

`?portalGateWorker=0` draws the portal gate on the page instead of in a worker.
