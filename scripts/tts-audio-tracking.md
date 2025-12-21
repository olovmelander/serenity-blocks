# TTS Audio Generation Tracking

## Voice Configuration
- **Current Model:** gemini-2.5-flash-preview-tts
- **Voice:** Algieba
- **Target Model:** gemini-2.5-pro-preview-tts (when quota available)

---

## Files Generated with FLASH Model

### Intentions (8 files)
- [x] intentions/base_breathe.wav
- [x] intentions/base_calm.wav
- [x] intentions/base_focus.wav
- [x] intentions/base_ground.wav
- [x] intentions/elixir_energy.wav
- [x] intentions/elixir_power.wav
- [x] intentions/elixir_release.wav
- [x] intentions/elixir_transform.wav

### Cues (6 files)
- [x] cues/breathe_in.wav
- [x] cues/breathe_out.wav
- [x] cues/hold.wav
- [x] cues/release.wav
- [x] cues/in_power.wav
- [x] cues/out_power.wav

### Session Intros (1 of 4)
- [x] session_intros/base_intro.wav

---

## Files Generated with PRO Model
*(None yet - quota limit reached)*

---

## Files Still Needed (Flash or Pro)

### Session Intros (3 remaining)
- [ ] session_intros/elixir_intro.wav
- [ ] session_intros/rest_intro.wav
- [ ] session_intros/flow_intro.wav

### Quick Cues (2 new)
- [ ] cues/in_quick.wav
- [ ] cues/out_quick.wav

### New Cues (4)
- [ ] cues/deep_inhale.wav
- [ ] cues/slow_exhale.wav
- [ ] cues/hold_gently.wav
- [ ] cues/let_it_flow.wav

### Rest/Flow Intentions (8)
- [ ] intentions/rest_sleep.wav
- [ ] intentions/rest_peace.wav
- [ ] intentions/rest_unwind.wav
- [ ] intentions/rest_restore.wav
- [ ] intentions/flow_balance.wav
- [ ] intentions/flow_presence.wav
- [ ] intentions/flow_clarity.wav
- [ ] intentions/flow_rhythm.wav

### Universal Intentions (4)
- [ ] intentions/universal_gratitude.wav
- [ ] intentions/universal_heal.wav
- [ ] intentions/universal_clarity.wav
- [ ] intentions/universal_strength.wav

### Fillers (6)
- [ ] fillers/body_scan.wav
- [ ] fillers/waves_ocean.wav
- [ ] fillers/let_go.wav
- [ ] fillers/inner_light.wav
- [ ] fillers/trust_process.wav
- [ ] fillers/complete_whole.wav

---

## Notes
- API quota resets at **9:00 AM CET** (midnight Pacific Time)
- Run `node scripts/generate-tts.js` to generate missing files
- Script skips existing files automatically
