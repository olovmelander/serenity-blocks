/**
 * @fileoverview Odyssey gameplay-effect pipeline prewarm — the frame-tail spike fix.
 *
 * A real RTX 5080 capture (docs/GAMEPLAY_SMOOTHNESS_INVESTIGATION_2026-08.md) showed a light
 * scene (p50 GPU frame 4.7ms) but a recurring >33ms frame-tail sawtooth during play. Root cause:
 * the active theme's reaction/bloom gameplay-effect meshes are POOLED up front but start
 * `visible=false`, so their render pipelines — especially the selective-bloom / MRT variants,
 * which only compile on a REAL render, not `compileAsync` — build synchronously the first time
 * each effect appears during play (first lock, first line-clear, first combo tier…).
 *
 * This warms them under the level-load blackout instead: force every currently-invisible mesh
 * visible for a few of the theme's OWN masked render frames (the running loop drives its post
 * pipeline → compiles the variants), then restore exact visibility. Theme-agnostic — it only
 * touches `activeTheme.scene` + the theme's already-running render loop, so it needs no per-theme
 * code and no edits to any theme file (keeping clear of parallel theme work). Best-effort: every
 * step is guarded and the frame wait is timeout-bounded so it can never block or break level start.
 *
 * Extracted from OdysseyMode to keep that mode lean (architecture ratchet).
 */

/**
 * Opt-in flag `?odysseyEffectWarm=1` — default OFF until verified in-game (the fix is authored to
 * be byte-identical to today's behaviour unless enabled). Headless-guarded.
 * @returns {boolean}
 */
export function isEffectWarmEnabled() {
    if (typeof window === 'undefined') return false;
    try {
        return new URLSearchParams(window.location?.search || '').get('odysseyEffectWarm') === '1';
    } catch {
        return false;
    }
}

/**
 * Prewarm the active theme's gameplay-effect render pipelines under the level-load blackout.
 * @param {object} theme the active theme — expected to expose `.scene` with a running
 *   render loop. Anything missing → the pass no-ops.
 * @returns {Promise<void>} resolves once the warm frames have rendered + visibility is restored.
 */
export async function prewarmActiveThemeEffects(theme) {
    try {
        const scene = theme?.scene;
        if (!scene || typeof scene.traverse !== 'function') return;

        const hidden = [];
        scene.traverse((o) => {
            if ((o.isMesh || o.isInstancedMesh || o.isPoints) && o.visible === false) {
                hidden.push(o);
                o.visible = true;
            }
        });
        if (hidden.length === 0) return;

        // r185 removed the up-front compileAsync race this pass used to run: r185's compileAsync
        // defers node builds into a main-thread-yielding loop that reads live renderer state, so
        // under the theme's running loop it could poison the builder cache — and "racing" it with
        // a 250ms timeout only ABANDONED a build loop that kept mutating shared caches for
        // seconds. The masked render frames below were always the real warm (selective-bloom /
        // MRT variants only compile on a real render); they are the whole warm now.
        // Let the theme's own render loop draw a few masked frames so the selective-bloom / MRT
        // variant pipelines compile now. Timeout-bounded so a throttled
        // rAF (backgrounded tab) can never stall level prep.
        await new Promise((resolve) => {
            if (typeof requestAnimationFrame !== 'function') { resolve(); return; }
            let done = false;
            const finish = () => { if (!done) { done = true; resolve(); } };
            let n = 0;
            const step = () => { n += 1; if (n >= 4) finish(); else requestAnimationFrame(step); };
            requestAnimationFrame(step);
            setTimeout(finish, 250);
        });
        // Restore exact prior visibility so no stray effect shows on the first live frame.
        for (const o of hidden) o.visible = false;
        console.log(`[Odyssey] Prewarmed ${hidden.length} theme effect meshes under blackout`);
    } catch (err) {
        console.warn('[Odyssey] Effect prewarm skipped:', err?.message || err);
    }
}
