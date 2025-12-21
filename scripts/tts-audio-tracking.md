# TTS Audio Generation Tracking

## Summary
- **95 total files** generated
- **52 files** with PRO model (gemini-2.5-pro-preview-tts)
- **43 files** with FLASH model (gemini-2.5-flash-preview-tts)

---

## PRO Model Files (Dec 21, 2024)

### Session Intros (4)
- session_intros/base_intro.wav
- session_intros/elixir_intro.wav
- session_intros/rest_intro.wav
- session_intros/flow_intro.wav

### Base Session (11)
- base/grounding_intro.wav, integration.wav
- base/r1_active.wav, r1_hold.wav, r1_recovery.wav
- base/r2_active.wav, r2_hold.wav, r2_recovery.wav
- base/r3_active.wav, r3_hold.wav, r3_recovery.wav

### Elixir Session (11)
- elixir/grounding_intro.wav, integration.wav
- elixir/r1_active.wav, r1_hold.wav, r1_recovery.wav
- elixir/r2_active.wav, r2_hold.wav, r2_recovery.wav
- elixir/r3_active.wav, r3_hold.wav, r3_recovery.wav

### Rest Session (8)
- rest/grounding_intro.wav, integration.wav
- rest/r1_active.wav, r1_hold.wav
- rest/r2_active.wav, r2_hold.wav
- rest/r3_active.wav, r3_hold.wav

### Flow Session (11)
- flow/grounding_intro.wav, integration.wav
- flow/r1_active.wav, r1_hold.wav, r1_recovery.wav
- flow/r2_active.wav, r2_hold.wav, r2_recovery.wav
- flow/r3_active.wav, r3_hold.wav, r3_recovery.wav

### Transitions (7)
- transitions/round1_start.wav, round2_start.wav, round3_start.wav
- transitions/hold_start.wav, recovery_start.wav
- transitions/integration_start.wav, prepare_next.wav

---

## FLASH Model Files

### Cues (12)
- cues/breathe_in.wav, breathe_out.wav
- cues/hold.wav, release.wav
- cues/in_power.wav, out_power.wav
- cues/deep_inhale.wav, slow_exhale.wav
- cues/hold_gently.wav, let_it_flow.wav
- cues/in_quick.wav, out_quick.wav

### Intentions - Base/Elixir (8)
- intentions/base_calm.wav, base_focus.wav, base_ground.wav, base_breathe.wav
- intentions/elixir_energy.wav, elixir_release.wav, elixir_transform.wav, elixir_power.wav

### Intentions - Rest/Flow/Universal (12)
- intentions/rest_sleep.wav, rest_peace.wav, rest_unwind.wav, rest_restore.wav
- intentions/flow_balance.wav, flow_presence.wav, flow_clarity.wav, flow_rhythm.wav
- intentions/universal_gratitude.wav, universal_heal.wav, universal_clarity.wav, universal_strength.wav

### Fillers (11)
- fillers/floating_vibrating.wav, observer_deep.wav, stay_here.wav
- fillers/you_are_safe.wav, nothing_to_do.wav
- fillers/body_scan.wav, waves_ocean.wav, let_go.wav
- fillers/inner_light.wav, trust_process.wav, complete_whole.wav

---

## Notes
- All files generated ✅
- To regenerate with PRO: `node scripts/generate-tts.js --overwrite` (after setting model to pro in tts-script.json)
