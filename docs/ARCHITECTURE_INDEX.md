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
| [SUMMER_MIDSUMMER_COMBO_LOCK_EFFECTS_PLAN_2026-07.md](SUMMER_MIDSUMMER_COMBO_LOCK_EFFECTS_PLAN_2026-07.md) | Reference | Research-backed combo/lock FX direction and playground-first execution plan; umbrella Phase 7 governs execution. |
| [SUMMER_MIDSUMMER_MASTERPIECE_PLAN.md](SUMMER_MIDSUMMER_MASTERPIECE_PLAN.md) | Reference | Theme plan. |
| [SUMMER_THEME_VEGETATION_PLAN.md](SUMMER_THEME_VEGETATION_PLAN.md) | Reference | Theme plan. |
| [tetromino-visual-upgrade-plan.md](tetromino-visual-upgrade-plan.md) | Reference | Visual feature plan. |
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
