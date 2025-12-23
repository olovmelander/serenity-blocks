# TTS Audio Generation Tracking

**Last Updated:** December 23, 2024

## Summary
- **95 total files** generated
- **95 files** with PRO model (gemini-2.5-pro-preview-tts) ✅
- **0 files** with FLASH model

---

## PRO Model Files

### Session Intros (4)
- [x] session_intros/base_intro.wav
- [x] session_intros/elixir_intro.wav
- [x] session_intros/rest_intro.wav
- [x] session_intros/flow_intro.wav

### Base Session (11)
- [x] base/grounding_intro.wav
- [x] base/integration.wav
- [x] base/r1_active.wav, r1_hold.wav, r1_recovery.wav
- [x] base/r2_active.wav, r2_hold.wav, r2_recovery.wav
- [x] base/r3_active.wav, r3_hold.wav, r3_recovery.wav

### Elixir Session (11)
- [x] elixir/grounding_intro.wav
- [x] elixir/integration.wav
- [x] elixir/r1_active.wav, r1_hold.wav, r1_recovery.wav
- [x] elixir/r2_active.wav, r2_hold.wav, r2_recovery.wav
- [x] elixir/r3_active.wav, r3_hold.wav, r3_recovery.wav

### Rest Session (8)
- [x] rest/grounding_intro.wav
- [x] rest/integration.wav
- [x] rest/r1_active.wav, r1_hold.wav
- [x] rest/r2_active.wav, r2_hold.wav
- [x] rest/r3_active.wav, r3_hold.wav

### Flow Session (11)
- [x] flow/grounding_intro.wav
- [x] flow/integration.wav
- [x] flow/r1_active.wav, r1_hold.wav, r1_recovery.wav
- [x] flow/r2_active.wav, r2_hold.wav, r2_recovery.wav
- [x] flow/r3_active.wav, r3_hold.wav, r3_recovery.wav

### Transitions (7)
- [x] transitions/round1_start.wav
- [x] transitions/round2_start.wav
- [x] transitions/round3_start.wav
- [x] transitions/hold_start.wav
- [x] transitions/recovery_start.wav
- [x] transitions/integration_start.wav
- [x] transitions/prepare_next.wav

### Cues (12)
- [x] cues/breathe_in.wav
- [x] cues/breathe_out.wav
- [x] cues/hold.wav
- [x] cues/release.wav
- [x] cues/in_power.wav
- [x] cues/out_power.wav
- [x] cues/deep_inhale.wav
- [x] cues/slow_exhale.wav
- [x] cues/hold_gently.wav
- [x] cues/let_it_flow.wav
- [x] cues/in_quick.wav
- [x] cues/out_quick.wav

### Intentions (20)
- [x] intentions/base_calm.wav
- [x] intentions/base_focus.wav
- [x] intentions/base_ground.wav
- [x] intentions/base_breathe.wav
- [x] intentions/elixir_energy.wav
- [x] intentions/elixir_release.wav
- [x] intentions/elixir_transform.wav
- [x] intentions/elixir_power.wav
- [x] intentions/rest_sleep.wav
- [x] intentions/rest_peace.wav
- [x] intentions/rest_unwind.wav
- [x] intentions/rest_restore.wav
- [x] intentions/flow_balance.wav
- [x] intentions/flow_presence.wav
- [x] intentions/flow_clarity.wav
- [x] intentions/flow_rhythm.wav
- [x] intentions/universal_gratitude.wav
- [x] intentions/universal_heal.wav
- [x] intentions/universal_clarity.wav
- [x] intentions/universal_strength.wav

### Fillers (11)
- [x] fillers/floating_vibrating.wav
- [x] fillers/observer_deep.wav
- [x] fillers/stay_here.wav
- [x] fillers/you_are_safe.wav
- [x] fillers/nothing_to_do.wav
- [x] fillers/body_scan.wav
- [x] fillers/waves_ocean.wav
- [x] fillers/let_go.wav
- [x] fillers/inner_light.wav
- [x] fillers/trust_process.wav
- [x] fillers/complete_whole.wav

---

## Notes
- All 95 files now generated with PRO ✅
- To regenerate specific files: `node scripts/generate-tts.js --only=file1.wav,file2.wav --overwrite`
- To regenerate all: `node scripts/generate-tts.js --overwrite`
- Generation log: `scripts/tts-pro-generated.log`
