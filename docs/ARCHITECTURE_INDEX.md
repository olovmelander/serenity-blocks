# Architecture Index

Status source of truth for planning documents. The umbrella roadmap is
[ARCHITECTURAL_REMEDIATION_PLAN.md](ARCHITECTURAL_REMEDIATION_PLAN.md); when another plan
conflicts with it, the umbrella wins unless it explicitly links out to that plan.

## Status Terms

| Status | Meaning |
|---|---|
| Active | Current marching orders. Work may be executed directly from this document. |
| Tactical | Current, but scoped below the umbrella plan. Use only inside the named scope. |
| Reference | Useful evidence, art direction, or historical context. Do not treat as a backlog unless harvested into the umbrella plan. |
| Superseded | Replaced by the umbrella plan or a newer tactical plan. Do not implement directly. |

## Active Governance

| Document | Status | Notes |
|---|---|---|
| [ARCHITECTURAL_REMEDIATION_PLAN.md](ARCHITECTURAL_REMEDIATION_PLAN.md) | Active | Umbrella roadmap and phase ordering. |
| [ONLINE_MP_CURRENT_STATE_FIX_PLAN_2026-06-23.md](ONLINE_MP_CURRENT_STATE_FIX_PLAN_2026-06-23.md) | Tactical | Multiplayer stabilization pre-phase referenced by the umbrella plan. |
| [WEBGPU_THREEJS_WORKFLOW.md](WEBGPU_THREEJS_WORKFLOW.md) | Active | Required workflow for WebGPU/TSL visual changes. |
| [SFX_GENERATION_WORKFLOW.md](SFX_GENERATION_WORKFLOW.md) | Active | Required workflow for local SFX generation. |
| [adr/README.md](adr/README.md) | Active | Accepted architecture decisions and enforcement links. |

## Current Root Docs

| Document | Status | Notes |
|---|---|---|
| [ARCHITECTURAL_REVIEW.md](ARCHITECTURAL_REVIEW.md) | Reference | Source review feeding the umbrella plan. |
| [architectural-review-prompt.md](architectural-review-prompt.md) | Reference | Historical prompt/source material. |
| [ASSET_PIPELINE_BLACKWELL.md](ASSET_PIPELINE_BLACKWELL.md) | Reference | Asset-pipeline context; harvest before execution. |
| [blind-mode-plan.md](blind-mode-plan.md) | Reference | Feature plan; not part of current Movement A scope. |
| [BREATHING_INDICATOR_GUIDE.md](BREATHING_INDICATOR_GUIDE.md) | Reference | Feature guide. |
| [cascade-bot-payload-planning-plan.md](cascade-bot-payload-planning-plan.md) | Reference | Bot/payload planning notes. |
| [CHROMADELIC_HIGHWAY_ART_DIRECTION.md](CHROMADELIC_HIGHWAY_ART_DIRECTION.md) | Reference | Theme art direction. |
| [CHROMADELIC_HIGHWAY_BASELINE_CAPTURE_PROTOCOL.md](CHROMADELIC_HIGHWAY_BASELINE_CAPTURE_PROTOCOL.md) | Reference | Theme validation context. |
| [CHROMADELIC_HIGHWAY_RELEASE_QA_CHECKLIST.md](CHROMADELIC_HIGHWAY_RELEASE_QA_CHECKLIST.md) | Reference | Theme QA context. |
| [CHROMADELIC_HIGHWAY_WEBGPU_UPGRADE_PLAN.md](CHROMADELIC_HIGHWAY_WEBGPU_UPGRADE_PLAN.md) | Reference | Theme plan; use WebGPU workflow before acting. |
| [COSMIC_NOIR_PERF_AUDIT_2026-06-30.md](COSMIC_NOIR_PERF_AUDIT_2026-06-30.md) | Reference | Theme performance evidence. |
| [cosmic-cursor-global-fix-plan.md](cosmic-cursor-global-fix-plan.md) | Reference | UI fix plan. |
| [gameplay-effects-plan.md](gameplay-effects-plan.md) | Reference | Gameplay effects plan. |
| [HALCYON_APEX_COMBO_LOCK_PLAN.md](HALCYON_APEX_COMBO_LOCK_PLAN.md) | Reference | Theme/gameplay effect plan. |
| [infinity-mode-implementation-plan.md](infinity-mode-implementation-plan.md) | Reference | Mode plan; harvest into umbrella before new execution. |
| [local-mp-team-colors-plan.md](local-mp-team-colors-plan.md) | Reference | Local multiplayer feature plan. |
| [local-multiplayer-bot-ai-plan.md](local-multiplayer-bot-ai-plan.md) | Reference | Local multiplayer feature plan. |
| [local-multiplayer-config-ux-plan.md](local-multiplayer-config-ux-plan.md) | Reference | Local multiplayer UX plan. |
| [MULTIPLAYER_BEST_IN_CLASS_PLAN.md](MULTIPLAYER_BEST_IN_CLASS_PLAN.md) | Superseded | Replaced by the umbrella plan's multiplayer phases. |
| [MULTIPLAYER_ROOT_CAUSE_FIXES.md](MULTIPLAYER_ROOT_CAUSE_FIXES.md) | Reference | Multiplayer bug evidence. |
| [ODYSSEY_AAA_MASTER_PLAN.md](ODYSSEY_AAA_MASTER_PLAN.md) | Reference | Odyssey source plan; umbrella governs sequencing. |
| [ODYSSEY_AAA_VISUAL_EXPERIENCE_REVIEW.md](ODYSSEY_AAA_VISUAL_EXPERIENCE_REVIEW.md) | Reference | Odyssey review evidence. |
| [ODYSSEY_BEST_IN_CLASS_MASTERPLAN_2026-07.md](ODYSSEY_BEST_IN_CLASS_MASTERPLAN_2026-07.md) | Reference | Odyssey source plan; harvest before execution. |
| [ODYSSEY_CH3_CH4_SEAM_PLAN.md](ODYSSEY_CH3_CH4_SEAM_PLAN.md) | Reference | Odyssey chapter plan. |
| [ODYSSEY_CH3_COMPOSITION_PLAN.md](ODYSSEY_CH3_COMPOSITION_PLAN.md) | Reference | Odyssey chapter plan. |
| [ODYSSEY_CH5_SKY_DRIFT_COMPOSITION_PLAN.md](ODYSSEY_CH5_SKY_DRIFT_COMPOSITION_PLAN.md) | Reference | Odyssey chapter plan. |
| [ODYSSEY_CHAPTER_BY_CHAPTER_IMPROVEMENT_PLAN.md](ODYSSEY_CHAPTER_BY_CHAPTER_IMPROVEMENT_PLAN.md) | Reference | Odyssey source plan. |
| [ODYSSEY_CHAPTER_MASTERPIECE_PLAN.md](ODYSSEY_CHAPTER_MASTERPIECE_PLAN.md) | Reference | Odyssey source plan. |
| [ODYSSEY_CHAPTER_PERF_PLAN.md](ODYSSEY_CHAPTER_PERF_PLAN.md) | Reference | Odyssey performance context. |
| [ODYSSEY_ONE_WORLD_PLAN_2026-08.md](ODYSSEY_ONE_WORLD_PLAN_2026-08.md) | Reference | **CLOSED 2026-08-12 — a record, not a backlog.** Odyssey Act II world-cohesion rebuild: SHIPPED and default (chapters 2–5 are one continuous world; Lane A 0.393 ms vs the dioramas' 1.966 ms, 50 draws vs 132). Waves 0–6 done or closed-as-rescoped; Wave 7's headline answered. Read §0 for the outcome and §0.3 for the four load-bearing numbers measurement refuted — that half is the reusable part. Two follow-ups outlived it (§7): a Lane B measurement needing the Radeon machine, and the ch5→ch6 cloud bank needing a look call. Decisions that escaped into governance: ADR-0015 (keep the escape hatch), ADR-0016 (perf claims need a verified instrument). |
| [ODYSSEY_CINEMATIC_JOURNEY_PLAN.md](ODYSSEY_CINEMATIC_JOURNEY_PLAN.md) | Reference | Odyssey source plan. |
| [ODYSSEY_CREATIVE_DIRECTOR_IMPLEMENTATION_PROMPT.md](ODYSSEY_CREATIVE_DIRECTOR_IMPLEMENTATION_PROMPT.md) | Reference | Prompt/source material. |
| [ODYSSEY_DEEP_OCEAN_VIBRANCY_PLAN.md](ODYSSEY_DEEP_OCEAN_VIBRANCY_PLAN.md) | Reference | Odyssey chapter/theme plan. |
| [ODYSSEY_EARTH_CORE_AAA_PLAN.md](ODYSSEY_EARTH_CORE_AAA_PLAN.md) | Reference | Odyssey chapter plan. |
| [ODYSSEY_JOURNEY_CREATIVE_IMPLEMENTATION_PLAN.md](ODYSSEY_JOURNEY_CREATIVE_IMPLEMENTATION_PLAN.md) | Reference | Odyssey source plan. |
| [ODYSSEY_LOADING_OPTIMIZATION_PLAN.md](ODYSSEY_LOADING_OPTIMIZATION_PLAN.md) | Reference | Odyssey loading evidence; umbrella Phase 4.7 governs boot work. |
| [ODYSSEY_PERFORMANCE_MASTERPLAN_2026-06.md](ODYSSEY_PERFORMANCE_MASTERPLAN_2026-06.md) | Superseded | Older Odyssey performance plan. |
| [ODYSSEY_PERFORMANCE_MASTERPLAN_2026-06-22.md](ODYSSEY_PERFORMANCE_MASTERPLAN_2026-06-22.md) | Reference | Later Odyssey performance source plan. |
| [ODYSSEY_PERFORMANCE_OPTIMIZATION_PLAN.md](ODYSSEY_PERFORMANCE_OPTIMIZATION_PLAN.md) | Reference | Odyssey performance source plan. |
| [ODYSSEY_VISUAL_COHESION_MASTER_PLAN.md](ODYSSEY_VISUAL_COHESION_MASTER_PLAN.md) | Reference | Odyssey visual source plan. |
| [ODYSSEY_VISUAL_UPGRADE_PLAN.md](ODYSSEY_VISUAL_UPGRADE_PLAN.md) | Reference | Odyssey visual source plan. |
| [ODYSSEY_WAVE_V_CAPTURE_REPORT.md](ODYSSEY_WAVE_V_CAPTURE_REPORT.md) | Reference | Capture evidence. |
| [ONLINE_MP_LAYOUT_OVERHAUL_QUADRA_2026-06-24.md](ONLINE_MP_LAYOUT_OVERHAUL_QUADRA_2026-06-24.md) | Reference | Multiplayer source plan. |
| [ONLINE_MP_LOCAL_PIECE_OWNERSHIP_FIX_2026-06-23.md](ONLINE_MP_LOCAL_PIECE_OWNERSHIP_FIX_2026-06-23.md) | Reference | Multiplayer evidence/source plan. |
| [ONLINE_MP_NEVER_PAUSE_PLAN_2026-06-24.md](ONLINE_MP_NEVER_PAUSE_PLAN_2026-06-24.md) | Reference | Multiplayer source plan. |
| [ONLINE_MP_QUADRA_EXPERIENCE_NEXTLEVEL_PLAN_2026-06-24.md](ONLINE_MP_QUADRA_EXPERIENCE_NEXTLEVEL_PLAN_2026-06-24.md) | Reference | Multiplayer source plan. |
| [ONLINE_MP_PERFORMANCE_REVIEW_2026-07-18.md](ONLINE_MP_PERFORMANCE_REVIEW_2026-07-18.md) | Reference | Verified evidence for why online MP feels less smooth than SP at default flags; harvest its P0/P1 items into the umbrella plan before execution. |
| [ONLINE_MP_QUADRA_PARITY_PLAN_2026-06-24.md](ONLINE_MP_QUADRA_PARITY_PLAN_2026-06-24.md) | Reference | Multiplayer source plan. |
| [ONLINE_MULTIPLAYER_IMPROVEMENT_PLAN.md](ONLINE_MULTIPLAYER_IMPROVEMENT_PLAN.md) | Superseded | Replaced by current MP tactical plan and umbrella phases. |
| [ONLINE_MULTIPLAYER_NETCODE_RESEARCH_AUDIT_PLAN_2026-06-23.md](ONLINE_MULTIPLAYER_NETCODE_RESEARCH_AUDIT_PLAN_2026-06-23.md) | Reference | Multiplayer research evidence. |
| [quadra-adoption-plan.md](quadra-adoption-plan.md) | Reference | Source material for the umbrella plan's Quadra imports. |
| [quadra-cascade-bot-tactics-plan.md](quadra-cascade-bot-tactics-plan.md) | Reference | Bot/tactics source plan. |
| [repository-cleanup-plan.md](repository-cleanup-plan.md) | Superseded | Cleanup decisions have been absorbed or archived. |
| [repository-review-plan.md](repository-review-plan.md) | Superseded | Review output is superseded by the umbrella plan. |
| [SERENITY_PERFORMANCE_AUDIT_2026-06.md](SERENITY_PERFORMANCE_AUDIT_2026-06.md) | Reference | Performance evidence. |
| [STARLIGHT_COMBO_LOCK_EFFECTS_PLAN.md](STARLIGHT_COMBO_LOCK_EFFECTS_PLAN.md) | Superseded | Historical theme/gameplay direction; consolidated by the 2026-07 review. |
| [STARLIGHT_MASTERPIECE_REVIEW_AND_PLAN_2026-07.md](STARLIGHT_MASTERPIECE_REVIEW_AND_PLAN_2026-07.md) | Reference | Consolidated evidence, art direction, FX, and performance plan; umbrella Phase 7 governs execution. |
| [STARLIGHT_WEBGPU_MASTERPIECE_PLAN.md](STARLIGHT_WEBGPU_MASTERPIECE_PLAN.md) | Superseded | Historical theme direction; consolidated by the 2026-07 review. |
| [STILLWATER_MASTERPIECE_PLAN_2026-07.md](STILLWATER_MASTERPIECE_PLAN_2026-07.md) | Reference | Implemented Stillwater art direction and Waves 0–8 plan. Current immutable v6 WebGPU production acceptance passes under fingerprint `267e6556…`; the broader v5 hardware/lifecycle matrix under `6c91dad8…` is retained as historical evidence only. |
| [STILLWATER_PRODUCTION_RENDERER_DECISION_2026-07.md](STILLWATER_PRODUCTION_RENDERER_DECISION_2026-07.md) | Reference | Accepted Stillwater-only WebGPU-primary architecture opt-in with one TSL graph on native WebGPU and `WebGPURenderer`'s forced-WebGL2 compatibility backend. Phaser Canvas board fallback is a separate unsupported surface, not that compatibility path. |
| [STILLWATER_RENDERER_DECISION_2026-07.md](STILLWATER_RENDERER_DECISION_2026-07.md) | Reference | Historical Waves 1–3 provisional renderer/capture checkpoint; superseded for the integrated implementation by the production renderer decision. |
| [STILLWATER_WAVE3_RESPONSE_EVIDENCE_2026-07.md](STILLWATER_WAVE3_RESPONSE_EVIDENCE_2026-07.md) | Reference | Historical isolated Wave 3 fixed-slot lock/Tetris/T-spin visual, resource, and bounded performance evidence; not current production-budget authority. |
| [STILLWATER_WAVES_4_8_EVIDENCE_2026-07.md](STILLWATER_WAVES_4_8_EVIDENCE_2026-07.md) | Reference | Integrated Waves 4–8 evidence dossier. Current authority is immutable v6 (`immutable-build-final-20260726-1800-v6`, fingerprint `267e6556…`) with comprehensive WebGPU and direct Page Visibility passes; the v5 matrix remains a frozen historical baseline. |
| [SUMMER_MIDSUMMER_COMBO_LOCK_EFFECTS_PLAN_2026-07.md](SUMMER_MIDSUMMER_COMBO_LOCK_EFFECTS_PLAN_2026-07.md) | Reference | Research-backed combo/lock FX direction and playground-first execution plan; umbrella Phase 7 governs execution. |
| [SUMMER_MIDSUMMER_MASTERPIECE_PLAN.md](SUMMER_MIDSUMMER_MASTERPIECE_PLAN.md) | Reference | Theme plan. |
| [SUMMER_THEME_VEGETATION_PLAN.md](SUMMER_THEME_VEGETATION_PLAN.md) | Reference | Theme plan. |
| [tetromino-visual-upgrade-plan.md](tetromino-visual-upgrade-plan.md) | Reference | Visual feature plan. |
| [THREE_UPGRADE_RESEARCH_R181_TO_R185_2026-08.md](THREE_UPGRADE_RESEARCH_R181_TO_R185_2026-08.md) | Reference | **CLOSED 2026-08-21 — a record, not a backlog.** three.js r181 → 0.185.1 upgrade: SHIPPED on the feature branch in full (portability sweep, exact-pin bump, warm-up + MRT reworks, RenderPipeline rename, 61/61 Electron matrix + WebGL-fallback lane, perf re-baseline on the 82JU, moonshafts unblock, SharpenNode + Info.memory gate, r186 pre-positioning). Four bugs found and fixed (one upstream r185 defect drafted in `UPSTREAM_THREE_R185_ISSUES_READY_TO_FILE.md`; the other "upstream" one was the repo's own inverted `compileAsync` argument order — corrected 2026-08-21, see the successor plan). Read the header for the outcome and §12's status block for the log. Decisions that escaped into governance: ADR-0018 (exact pin + upgrade protocol), ADR-0019 (gate on renderer kind, not backend). Open, none engineering: file the upstream issues, close the Dependabot branch, merge, the r186 delta (§13). |
| [R185_FAST_AND_BEAUTIFUL_PLAN_2026-08.md](R185_FAST_AND_BEAUTIFUL_PLAN_2026-08.md) | Plan | **ACTIVE — successor to the r185 upgrade.** Why r185 startup was *slower* and what it took to make it faster than r181: one Earth Core shader (the lava lake) compiled in **7.2 s** because three's MaterialX Perlin (`mx_noise_float`, integer hash) is a DXC compile pathology; layout-less TSL `Fn`s inline at every call; the prewarm's `compileAsync` arguments were inverted. Phase 1 landed (calibrated Ashima simplex `snoise3`, `setLayout` everywhere, `compileAsync(group, camera, scene)`): board visible 12.6 → 7.0 s in-browser. Phases 2–6 are the ranked ladder from seven research reports: startup structure, theme switch, run-fast (Lane B recovery, GPU classifier), look-better (r185 shadows/godrays/dispersion/GTAO, classic-lane bloom parity), debt (winter ADR-0019, Clock→Timer, Electron EOL). |
| [ODYSSEY_EARTH_CORE_LAVA_LAKE_REMAKE_2026-08.md](ODYSSEY_EARTH_CORE_LAVA_LAKE_REMAKE_2026-08.md) | Plan | **Stage 1 SHIPPED 2026-08-21 (default on, `?earthCoreLakeBake=0` escape); Stage 2 pending.** Measured: lake pipeline 1,602 → 234 ms cold, lake fill −56 % on the Vega 8 / −75 % on the RTX, tier masks within ±3 pts. Remake of the Earth Core lava lake (the 7 s → 2 s compile pole): Stage 1 bakes the *calibrated simplex itself* into a periodic 128³ half-float 3D texture (lattice wrap + post-interpolation quantile map so the statistics are the shipped primitive's by construction) and threads it through the existing `fbm(p, octaves, sn)` seam — same thresholds/palette/basins/seam byte-for-byte, 19 fetches instead of 19 noise bodies, compile ≤ 0.4 s target; Stage 2 adds three doc-requested look deltas (flow from the fall, blackbody LUT ladder, crust rising at the rim), each its own session. Synthesised from two designs + adversarial critiques; §6 lists the look ideas that were refuted as specified (Worley nets, ridge windows, body desaturation, 2D mips). Sessions and ADR-0016 gates in §4. |
| [ODYSSEY_BACKGROUND_COMPILE_2026-08.md](ODYSSEY_BACKGROUND_COMPILE_2026-08.md) | Design | **LANDED 2026-08-21** (plan item 2.11). How background chapters compile UNDER the live rAF loop on three r185: the scene-pass binding is applied only for `compileAsync`'s synchronous prologue and the drained builds' target/MRT reads are answered by instance accessors on `_renderTarget`/`_mrt`, suspended for every synchronous render/clear/resize and the drain's own update hooks. Hazard table (18 rows with three file:line evidence), the r185 reads contract, measurement protocol, rollback flag `?odysseyLiveCompile=0`. Read before touching `warmup/post-target-compile.js` or the post-reveal drain. |
| [UPSTREAM_THREE_R185_ISSUES_READY_TO_FILE.md](UPSTREAM_THREE_R185_ISSUES_READY_TO_FILE.md) | Reference | Copy-paste-ready three.js issue bodies for the r185 `WebGPURenderer` defects found during the upgrade and the Phase-2 prewarm work: Issue 2 (dispose-time timestamp race), 3 (`compileAsync` deferred drain loses two-pass `material.side`), 4 (compile context depth ≠ post scene pass), 5 (deferred builds read the live target/MRT). Status: drafted, not yet filed (Issue 1 withdrawn). |
| [VESPER_CHRYSALIS_MASTERPIECE_UPGRADE_2026-07.md](VESPER_CHRYSALIS_MASTERPIECE_UPGRADE_2026-07.md) | Reference | Theme plan. |
| [VESPER_CHRYSALIS_THEME_MASTERPLAN_2026-07.md](VESPER_CHRYSALIS_THEME_MASTERPLAN_2026-07.md) | Reference | Theme source plan. |
| [VESPER_CHRYSALIS_VISUAL_UPGRADE_V3_2026-07.md](VESPER_CHRYSALIS_VISUAL_UPGRADE_V3_2026-07.md) | Reference | Theme source plan. |
| [VESPER_CHRYSALIS_VISUAL_UPGRADE_V4_2026-07.md](VESPER_CHRYSALIS_VISUAL_UPGRADE_V4_2026-07.md) | Reference | Newer theme source plan. |
| [WINTER_AAA_REVIEW_2026-06.md](WINTER_AAA_REVIEW_2026-06.md) | Reference | Theme review evidence. |
| [WINTER_BLIZZARD_COMBO_PLAN.md](WINTER_BLIZZARD_COMBO_PLAN.md) | Reference | Theme/effects plan. |
| [WINTER_DISTANT_TREES_PLAN.md](WINTER_DISTANT_TREES_PLAN.md) | Reference | Theme plan. |
| [WINTER_FLUFFY_SNOW_PLAN.md](WINTER_FLUFFY_SNOW_PLAN.md) | Reference | Theme plan. |
| [WINTER_FOX_PAW_TRAILS_PLAN.md](WINTER_FOX_PAW_TRAILS_PLAN.md) | Reference | Theme plan. |
| [WINTER_ICE_IMPRESSIVE_PLAN.md](WINTER_ICE_IMPRESSIVE_PLAN.md) | Reference | Theme plan. |
| [WINTER_SNOW_MASTERPIECE_PLAN.md](WINTER_SNOW_MASTERPIECE_PLAN.md) | Reference | Theme plan. |

## Archived Material

Documents under [archive/](archive/) are historical reference only. Do not execute archived
plans directly; harvest still-relevant requirements into the umbrella roadmap or a new ADR.
