# Bioluminescence Theme - Baseline Capture Protocol

## Objective
To establish a reproducible, deterministic visual baseline for the Bioluminescence theme before and during the WebGPU upgrade. This ensures that we can objectively measure "fallback parity" and "redesign delta".

---

## 1. Setup & Requirements

### Environment
- **Browser:** Chrome Stable (latest) or Electron (dev build).
- **Window Size:** 1920x1080 (Strict).
- **Pixel Ratio:** 1.0 (Force if necessary via DevTools).

### URL Parameters
Use these exact parameters for all baseline captures:
```
http://localhost:3000/?theme=bioluminescence&quality=High&bioluminescenceSeed=BASELINE_2026&bioluminescenceFixedDt=16.666&forceWebGL=0
```
- `theme=bioluminescence`: Selects the theme.
- `quality=High`: Standard reference quality.
- `bioluminescenceSeed=BASELINE_2026`: Locks random number generation for placement/particles.
- `bioluminescenceFixedDt=16.666`: Forces 60fps simulation steps regardless of actual render speed.
- `forceWebGL=0`: Set to `1` for WebGL fallback captures.

---

## 2. Capture List (The "Subnautica 5")

We define 5 key shots (A-E) that must be captured for every major release/phase.

### Shot A: Idle Cave Mood
- **Timestamp:** T = 5.0 seconds.
- **State:** No active gameplay inputs. Camera active.
- **Purpose:** Evaluate "Darkness Discipline" and initial layout.
- **Success Criteria:**
    - Mushroom placement matches baseline.
    - Lighting levels are within 5% luminance tolerance.

### Shot B: Line Clear Reaction
- **Timestamp:** T = 12.0 seconds.
- **Event:** A "Tetris" (4-line clear) triggered at T=11.5s.
- **Purpose:** Evaluate "Event Spectacle Restraint" and flash intensity.
- **Success Criteria:**
    - Bloom burst does not white-out the board.
    - Flash color matches `#CCFFFF` (White-Cyan).

### Shot C: Sustained Combo Stress
- **Timestamp:** T = 20.0 seconds.
- **Event:** 8-combo chain active.
- **Purpose:** Evaluate performance cost and visual clutter under load.
- **Success Criteria:**
    - Particle count matches budget (e.g., 2000 active).
    - Frame rate (if profiling) > 55fps.

### Shot D: The "Tetris" Pulse
- **Timestamp:** T = 25.0 seconds.
- **Event:** Single Tetris clear at T=24.5s.
- **Purpose:** Specific check for the "heartbeat" synchronization effect.

### Shot E: WebGL Fallback Parity
- **Timestamp:** T = 5.0 seconds (Same as Shot A).
- **Parameter:** `forceWebGL=1`.
- **Purpose:** Compare strict parity between WebGPU and WebGL paths.
- **Success Criteria:**
    - Visual difference < 5% (excluding specific inevitable shader differences like ray-traced shadows vs shadow maps).
    - Color grading matches exactly.

---

## 3. Automation Script (Snippet)

Use the following snippet in the DevTools console to auto-capture if the harness is loaded:

```javascript
async function captureBaseline() {
    const times = [5000, 12000, 20000, 25000];
    const labels = ['A_Idle', 'B_LineClear', 'C_Combo', 'D_Tetris'];
    
    for (let i = 0; i < times.length; i++) {
        // Seek/Wait implementation depends on harness
        await window.bioluminescenceBaseline.seek(times[i]);
        const dataUrl = window.bioluminescenceBaseline.capture();
        console.log(`Captured ${labels[i]}:`, dataUrl.substring(0, 50) + "...");
        // In a real harness, this would save to disk/server
    }
}
```

---

## 4. File Naming Convention

Format: `BIO_PHASE{N}_{BACKEND}_{SHOT}_{TIMESTAMP}.png`

Examples:
- `BIO_PHASE0_WEBGPU_SHOT_A_20260520.png`
- `BIO_PHASE0_WEBGL_SHOT_A_20260520.png`

---

## 5. Rubric Scoring (Manual Step)

For each shot, rate 1-5 on the **Bioluminescence Fidelity Rubric**:

1.  **Darkness Discipline:** (Is it dark enough?)
2.  **Organic Glow:** (Do things glow correctly?)
3.  **Cave Depth:** (Does it look 3D?)
4.  **Living Motion:** (Does it feel alive?)
5.  **Restraint:** (Is it readable?)

**Pass:** Average score > 4.4.
