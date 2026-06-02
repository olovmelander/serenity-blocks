/**
 * @fileoverview Odyssey AAA debug overlay (?odysseyAAA=1)
 *
 * Part of the Odyssey AAA "Cosmic Ascent" overhaul (Phase 0 — spine scaffolding).
 * See docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md §8 (P0 acceptance).
 *
 * A lightweight, dependency-free HUD that visualizes the live OdysseyDirector
 * state — ascentProgress, audio energy/beat, active/source/target chapter, seam
 * progress, act, and the blended camera framing — so the spine can be validated
 * before any visual change lands. Gated behind ?odysseyAAA=1; throttled DOM
 * writes so it costs nothing meaningful.
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

export class OdysseyDebugOverlay {
    constructor() {
        this.el = null;
        this.lastUpdateMs = 0;
        this._build();
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
     * @param {object} directorState - OdysseyDirector.getState()
     * @param {object} [audioState] - OdysseyAudioReactor state
     */
    update(directorState, audioState = null) {
        if (!this.el || !directorState) return;
        const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (nowMs - this.lastUpdateMs < UPDATE_INTERVAL_MS) return;
        this.lastUpdateMs = nowMs;

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

        this.el.textContent = [
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
        ].join('\n');
    }

    dispose() {
        if (this.el && this.el.parentNode) {
            this.el.parentNode.removeChild(this.el);
        }
        this.el = null;
    }
}

function clamp01(v) {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
}

export default OdysseyDebugOverlay;
