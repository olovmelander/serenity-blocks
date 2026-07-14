/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Serenity Warp — Tunnel Surge (Wave 2 prototype, REAL intro renderer).
 *
 * Mounts the actual `IntroWebGPUVisual` (the GPU-compute warp tunnel the theme uses) on
 * its own overlay canvas and drives the new opt-in `setReactionState({surge,bloom,chroma})`
 * levers so the whole tunnel surges on combo. Proves both that the surge reads and that
 * surge=0 is identical to the untouched intro.
 *
 * Drive it live (no reload) from the console / agent:
 *   window.__swSurge.set(0.6)   // surge the tunnel
 *   window.__swSurge.set(0)     // identity
 * Or via URL: ?effect=serenity-warp-tunnel-surge&surge=0.6
 */
import { INTRO_PHASES } from '../../ui/intro-visual-config.js';

export const meta = {
    id: 'serenity-warp-tunnel-surge',
    title: 'Serenity Warp — Tunnel Surge (real renderer)',
    description: 'Wave 2: the real intro tunnel reacting to the combo surge lever.',
};

function num(value, fallback) {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
}

export function create({ params }) {
    const canvas = document.createElement('canvas');
    canvas.id = 'sw-tunnel-surge-canvas';
    Object.assign(canvas.style, {
        position: 'fixed',
        inset: '0',
        width: '100%',
        height: '100%',
        zIndex: '1',
        pointerEvents: 'none',
    });
    document.body.appendChild(canvas);

    let surge = Math.max(0, Math.min(1, num(params.get('surge'), 0)));
    let scatter = 0;
    const state = { visual: null, ready: false, error: null };

    // Live hook so the surge can be A/B'd without re-navigating (avoids re-wedging the MCP).
    window.__swSurge = {
        set: (value) => { surge = Math.max(0, Math.min(1, num(value, 0))); return surge; },
        get: () => surge,
        ready: () => state.ready,
        // Fire a particle burst at a normalized screen position (default centre-ish).
        burst: (nx = 0.62, ny = 0.5, strength = 1.4) => {
            state.visual?.pulseReactionAt?.(nx, ny, strength);
            return true;
        },
        // Fan the apex burst across the tunnel (combo-10 spread).
        apex: (nx = 0.5, ny = 0.45) => {
            state.visual?.pulseReactionSpread?.(nx, ny, 5, 1.6);
            return true;
        },
        // Set the warp-scatter "fly away" amount (0..1) directly for A/B capture.
        scatter: (value) => { scatter = Math.max(0, Math.min(1, num(value, 0))); return scatter; },
    };

    (async () => {
        try {
            const { default: IntroWebGPUVisual } = await import('../../ui/threejs-intro-renderer-webgpu.js');
            const visual = new IntroWebGPUVisual(canvas);
            const ok = await visual.init();
            if (!ok) {
                state.error = 'init-failed';
                return;
            }
            visual.setPerformanceBudget('HIGH');
            visual.setBackgroundMode(false);
            visual.setTitleEffectsEnabled(false);
            visual.setTetrominoTitleAvoidanceEnabled(false);
            visual.setPhase(INTRO_PHASES.IDLE, true);
            state.visual = visual;
            state.ready = true;
        } catch (err) {
            state.error = String(err?.message || err);
        }
    })();

    return {
        update() {
            const { visual } = state;
            if (!visual) return;
            // surge rides the warp machinery; glow brightens the tetrominos + particles;
            // bloom/chroma mirror the director's mapping.
            visual.setReactionState({
                surge,
                bloom: surge * 0.9,
                chroma: surge * 0.55,
                glow: surge,
                spin: surge * 0.4, // synchronized field twist
                vertigo: surge, // dolly-zoom "everything got bigger"
                scatter, // warp "fly away"
            });
            visual.update();
        },
        // Own the frame: IntroWebGPUVisual.update() already rendered to its canvas, so the
        // playground must NOT also render its (empty) scene over the top.
        render() {},
        renderAsync() { return Promise.resolve(); },
        getDiagnostics() {
            return {
                ready: state.ready,
                error: state.error,
                surge,
                bloom: surge * 0.9,
                chroma: surge * 0.55,
            };
        },
        dispose() {
            try { state.visual?.destroy?.(); } catch { /* ignore */ }
            if (window.__swSurge) delete window.__swSurge;
            canvas.remove();
        },
    };
}
