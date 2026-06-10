/**
 * @fileoverview Odyssey AAA debug overlay (?odysseyAAA=1)
 *
 * Part of the Odyssey AAA "Cosmic Ascent" overhaul (Phase 0 — spine scaffolding).
 * See docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md §8 (P0 acceptance).
 *
 * A lightweight, dependency-free HUD that visualizes the live OdysseyDirector
 * state — ascentProgress, audio energy/beat, active/source/target chapter, seam
 * progress, act, and the blended camera framing — so the default cinematic spine
 * can be validated live. Gated behind ?odysseyAAA=1; throttled DOM writes so it
 * costs nothing meaningful.
 *
 * PERF INSTRUMENTATION (Batch 0, see docs/ODYSSEY_PERFORMANCE_OPTIMIZATION_PLAN.md
 * §6.1 / §7 Batch 0): when a renderer is supplied (via update(state, audio, renderer)
 * or setRenderer()), the overlay also surfaces the per-frame GPU cost so the lag/seam
 * problem can be measured before any fix is claimed:
 *   - renderer.info.render.{drawCalls, triangles, calls}
 *   - renderer.info.memory.{geometries, textures}
 *   - renderer.info.render.timestamp (GPU ms; only shown when populated, i.e. when
 *     the renderer was built with trackTimestamp:true and resolveTimestampsAsync()
 *     is being called each frame — wired by OdysseyBoardController, owned elsewhere)
 *   - a SEAM HITCH marker: the worst CPU frame time observed inside the small
 *     progress window around each chapter boundary, the user's "buggy at
 *     transitions" report made visible.
 * All instrumentation is text-only and stays inside the existing throttled DOM
 * write; the per-frame frame-time sample is a couple of arithmetic ops.
 */

import { getChapterProfile } from '../chapter-environments/shared/chapter-profile.js';

/**
 * @returns {boolean} whether the AAA debug overlay flag is set.
 */
export function isOdysseyAAADebugEnabled() {
    if (typeof window === 'undefined') return false;
    try {
        const search = new URLSearchParams(window.location?.search || '');
        return search.get('odysseyAAA') === '1';
    } catch {
        return false;
    }
}

const PANEL_ID = 'odyssey-aaa-debug-overlay';
const UPDATE_INTERVAL_MS = 100; // ~10 Hz text refresh

// Seam-hitch capture: how long to keep showing the worst frame time after a
// boundary has been crossed, and the smoothing for the rolling frame-time read.
const SEAM_HITCH_HOLD_MS = 4000; // keep the last seam's worst frame on screen briefly
const HITCH_WARN_MS = 33; // > ~2 frames @60 → flag it (plan §6.3 seam budget)

function nowMs() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export class OdysseyDebugOverlay {
    constructor() {
        this.el = null;
        this.lastUpdateMs = 0;

        // Perf instrumentation state.
        this.renderer = null; // optional; set via setRenderer() or passed to update()
        this._lastFrameMarkMs = 0; // timestamp of the previous update() call
        this._frameMs = 0; // smoothed wall-clock frame time (CPU+present)

        // Seam-hitch tracking. While inside a boundary window we accumulate the
        // worst frame time; once the seam ends we keep the result on screen for a
        // short hold so a transient hitch is actually readable.
        this._seamActive = false;
        this._seamBoundaryId = null;
        this._seamWorstMs = 0; // worst frame time in the current seam window
        this._lastSeam = null; // { boundaryId, worstMs, atMs } — last completed seam

        this._build();
    }

    /**
     * Register the WebGPU renderer so the overlay can read renderer.info each
     * frame. Optional hook for the board; update() also accepts a renderer arg.
     * @param {object|null} renderer - the three.js WebGPURenderer (or null to clear)
     */
    setRenderer(renderer) {
        this.renderer = renderer || null;
    }

    _build() {
        if (typeof document === 'undefined') return;
        let el = document.getElementById(PANEL_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = PANEL_ID;
            el.style.cssText = [
                'position:fixed',
                'top:12px',
                'left:12px',
                'z-index:99999',
                'padding:10px 12px',
                'font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
                'color:#bfe9ff',
                'background:rgba(6,10,22,0.78)',
                'border:1px solid rgba(120,200,255,0.35)',
                'border-radius:8px',
                'box-shadow:0 4px 24px rgba(0,0,0,0.5)',
                'pointer-events:none',
                'white-space:pre',
                'letter-spacing:0.02em',
                'backdrop-filter:blur(6px)',
                'min-width:230px',
            ].join(';');
            document.body.appendChild(el);
        }
        this.el = el;
    }

    /**
     * Sample wall-clock frame time and fold it into the seam-hitch tracker. Runs
     * every frame (cheap arithmetic, no DOM); the worst frame time observed while
     * the camera is inside a chapter-boundary window is what the overlay reports.
     * @param {object} s - director state (for inSeam / boundaryId)
     * @param {number} tNow - performance.now() for this frame
     * @private
     */
    _trackFrame(s, tNow) {
        // Wall-clock delta between successive update() calls ≈ the realized frame
        // time. Skip the first sample (no baseline) and any huge gap (tab was
        // backgrounded / overlay was just enabled) so we don't log a fake hitch.
        if (this._lastFrameMarkMs > 0) {
            const dt = tNow - this._lastFrameMarkMs;
            if (dt > 0 && dt < 2000) {
                this._frameMs = this._frameMs > 0 ? this._frameMs + (dt - this._frameMs) * 0.2 : dt;

                const inSeam = !!s?.inSeam;
                const boundaryId = s?.boundaryId ?? null;
                if (inSeam) {
                    if (!this._seamActive || boundaryId !== this._seamBoundaryId) {
                        // New seam window — start fresh.
                        this._seamActive = true;
                        this._seamBoundaryId = boundaryId;
                        this._seamWorstMs = dt;
                    } else if (dt > this._seamWorstMs) {
                        this._seamWorstMs = dt;
                    }
                } else if (this._seamActive) {
                    // Seam just ended — latch the result for the hold window.
                    this._lastSeam = {
                        boundaryId: this._seamBoundaryId,
                        worstMs: this._seamWorstMs,
                        atMs: tNow,
                    };
                    this._seamActive = false;
                    this._seamBoundaryId = null;
                    this._seamWorstMs = 0;
                }
            }
        }
        this._lastFrameMarkMs = tNow;
    }

    /**
     * Build the renderer.info instrumentation lines. Returns [] when no renderer
     * is available so the overlay degrades to the plain director HUD.
     * @param {object|null} renderer
     * @returns {string[]}
     * @private
     */
    _rendererLines(renderer) {
        const info = renderer?.info;
        if (!info) return [];
        const r = info.render || {};
        const mem = info.memory || {};
        const drawCalls = toInt(r.drawCalls);
        const tris = toInt(r.triangles);
        const calls = toInt(r.calls);
        const geoms = toInt(mem.geometries);
        const texes = toInt(mem.textures);
        // render.timestamp is GPU ms; only populated when the renderer was built
        // with trackTimestamp:true AND resolveTimestampsAsync() is called/frame.
        const gpuMs = Number.isFinite(r.timestamp) ? r.timestamp : 0;
        const gpuTag = gpuMs > 0 ? `${gpuMs.toFixed(2)}ms` : 'n/a';

        const lines = [
            '──────────────────────────',
            `frame     ${this._frameMs > 0 ? `${this._frameMs.toFixed(1)}ms` : '—'}  gpu ${gpuTag}`,
            `draws     ${formatCount(drawCalls)}  tris ${formatCount(tris)}`,
            `calls     ${formatCount(calls)}`,
            `mem       geo ${formatCount(geoms)}  tex ${formatCount(texes)}`,
        ];
        return lines;
    }

    /**
     * Build the seam-hitch marker line. Shows the worst frame time observed in the
     * active boundary window, or the last completed seam during the hold period.
     * @param {object} s - director state
     * @param {number} tNow
     * @returns {string}
     * @private
     */
    _seamHitchLine(s, tNow) {
        if (this._seamActive) {
            const id = this._seamBoundaryId || '—';
            const worst = this._seamWorstMs;
            return `seam hitch ${fmtMs(worst)} @${id} ${worst >= HITCH_WARN_MS ? '⚠' : '·'}`;
        }
        if (this._lastSeam && tNow - this._lastSeam.atMs < SEAM_HITCH_HOLD_MS) {
            const { boundaryId, worstMs } = this._lastSeam;
            return `seam hitch ${fmtMs(worstMs)} @${boundaryId || '—'} ${worstMs >= HITCH_WARN_MS ? '⚠' : '·'}`;
        }
        return 'seam hitch —';
    }

    /**
     * @param {object} directorState - OdysseyDirector.getState()
     * @param {object} [audioState] - OdysseyAudioReactor state
     * @param {object} [renderer] - optional WebGPURenderer for renderer.info (falls
     *   back to one registered via setRenderer()); preserves the prior 2-arg API.
     */
    update(directorState, audioState = null, renderer = null) {
        if (!this.el || !directorState) return;
        const tNow = nowMs();

        // Per-frame: sample frame time + maintain the seam-hitch marker. Cheap and
        // must run every frame to actually catch the boundary hitch — so it lives
        // before the DOM-write throttle.
        this._trackFrame(directorState, tNow);

        if (renderer) this.renderer = renderer;

        if (tNow - this.lastUpdateMs < UPDATE_INTERVAL_MS) return;
        this.lastUpdateMs = tNow;

        const s = directorState;
        const activeProfile = getChapterProfile(s.activeChapter);
        const bar = (v, n = 14) => {
            const filled = Math.round(clamp01(v) * n);
            return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, n - filled))}`;
        };
        const pct = (v) => `${(clamp01(v) * 100).toFixed(0)}%`.padStart(4);
        let audioTag = 'none';
        if (s.audioAvailable) {
            audioTag = audioState?.available ? 'live' : 'idle';
        }

        const lines = [
            'ODYSSEY · AAA SPINE',
            '──────────────────────────',
            `progress  ${bar(s.ascentProgress)} ${pct(s.ascentProgress)}`,
            `chapter   ${s.activeChapter} ${activeProfile.name}`,
            `act       ${s.act}`,
            s.inSeam
                ? `seam      ${s.boundaryId}  ${bar(s.seamProgress, 10)} ${pct(s.seamProgress)}`
                : 'seam      —',
            '──────────────────────────',
            `audio     ${audioTag}`,
            `energy    ${bar(s.energy)} ${pct(s.energy)}`,
            `bass      ${bar(s.bass)} ${pct(s.bass)}`,
            `beat      ${s.beat ? '◉ HIT' : '·'}   pulse ${pct(s.beatPulse)}`,
            '──────────────────────────',
            `camera    dist ${s.camera.followDistance.toFixed(1)}  fov ${s.camera.fovBase.toFixed(0)}`,
            `post      bloom ${s.post.bloom.toFixed(2)}  grade ${pct(s.post.grade)}`,
            `path      flow ${s.path.flowSpeed.toFixed(2)}  glow ${s.path.headGlow.toFixed(2)}`,
        ];

        // PERF block: renderer.info + seam-hitch marker (Batch 0 instrumentation).
        const rendererLines = this._rendererLines(this.renderer);
        for (let i = 0; i < rendererLines.length; i++) lines.push(rendererLines[i]);
        lines.push(this._seamHitchLine(s, tNow));

        this.el.textContent = lines.join('\n');
    }

    dispose() {
        if (this.el && this.el.parentNode) {
            this.el.parentNode.removeChild(this.el);
        }
        this.el = null;
        this.renderer = null;
    }
}

function clamp01(v) {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
}

/** Coerce a possibly-undefined renderer.info metric to a finite integer. */
function toInt(v) {
    return Number.isFinite(v) ? Math.trunc(v) : 0;
}

/** Compact integer formatter: 1234567 → "1.23M", 12345 → "12.3k". */
function formatCount(n) {
    if (!Number.isFinite(n)) return '0';
    const abs = Math.abs(n);
    if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (abs >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
    return `${n}`;
}

/** Frame-time formatter for the seam marker. */
function fmtMs(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    return `${ms.toFixed(1)}ms`;
}

export default OdysseyDebugOverlay;
