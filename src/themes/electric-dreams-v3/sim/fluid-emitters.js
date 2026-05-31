/**
 * Electric Dreams V3 — Fluid Emitters
 *
 * Translates game events into fluid impulse forces. Subscribes to the same
 * event-bus contracts as the current Electric Dreams theme but emits FLUID
 * forces rather than particle bursts.
 *
 * Design principle: the fluid does what the bursts used to do, but ONE system.
 *
 * Event → impulse mapping (designed for distinct, readable visual responses):
 *   PIECE_LOCK          → small inward pulse at lock point (subtle "tap")
 *   HARD_DROP           → modest radial outward push at impact (visible shockwave)
 *   LINE_CLEAR (1)      → soft radial wave along the cleared line
 *   LINE_CLEAR (2-3)    → stronger radial + slight vortex bias
 *   LINE_CLEAR (4 tetris) → big radial detonation + secondary vortex
 *   COMBO 1-3           → small vortex (rotational swirl)
 *   COMBO 4-6           → vortex + radial combo
 *   COMBO 7+            → 3 simultaneous vortices (chaos peak)
 *   LEVEL_UP            → wide sweep — large gentle radial wave
 *   GAME_OVER           → attractor pulling everything inward (mass condenses)
 *
 * All strengths are tuned to feel proportional in scale to the existing
 * burst counts (e.g., the original 600-particle tetris burst lands as
 * an 8-unit radial impulse here — same emotional weight, different mechanism).
 */
import * as THREE from 'three';
import { eventBus, EVENTS } from '../../../events/event-bus.js';
import { IMPULSE_TYPE } from './fluid-particles.js';

// Reused scratch vectors — no allocation per event.
const _scratchPos = new THREE.Vector3();
const _scratchDir = new THREE.Vector3();

// Z-axis is the "up" for vortex rotation (camera looks down -Z, so vortex
// rotates in the screen plane → visually most striking).
const VORTEX_AXIS = { x: 0, y: 0, z: 1 };

export class FluidEmitters {
    constructor(sim, focalPoint) {
        this.sim = sim;
        this.focalPoint = focalPoint?.clone?.() || new THREE.Vector3(0, 0, 0);
        this._unsubs = [];
        this._enabled = true;
    }

    /** Subscribe to all game events. Returns unsub function. */
    attach() {
        this._unsubs.push(
            eventBus.on(EVENTS.PIECE_LOCK, (data) => this._onPieceLock(data)),
            eventBus.on(EVENTS.HARD_DROP, (data) => this._onHardDrop(data)),
            eventBus.on(EVENTS.LINE_CLEAR, (data) => this._onLineClear(data)),
            eventBus.on(EVENTS.COMBO, (data) => this._onCombo(data)),
            eventBus.on(EVENTS.LEVEL_UP, (data) => this._onLevelUp(data)),
            eventBus.on(EVENTS.GAME_OVER, (data) => this._onGameOver(data)),
        );
        return () => this.detach();
    }

    detach() {
        for (const unsub of this._unsubs) {
            try { unsub?.(); } catch (e) { /* ignore */ }
        }
        this._unsubs = [];
    }

    setEnabled(enabled) { this._enabled = !!enabled; }

    /**
     * Resolve event origin to a world-space point near the focal area.
     * Game events report screen-space board coords; we don't yet have a
     * proper mapping, so all events emanate from the focal point with a
     * small per-event jitter so consecutive events feel distinct.
     */
    _eventOrigin(data, jitter = 0.6) {
        // Future: project board coords to world ray + intersect focal plane.
        // For Phase 2, focal-point + jitter is enough — the fluid itself
        // provides the visual variety via its motion field.
        _scratchPos.copy(this.focalPoint);
        if (jitter > 0) {
            _scratchPos.x += (Math.random() - 0.5) * jitter;
            _scratchPos.y += (Math.random() - 0.5) * jitter;
            _scratchPos.z += (Math.random() - 0.5) * jitter * 0.5;
        }
        return _scratchPos;
    }

    _onPieceLock() {
        if (!this._enabled) return;
        // Radial "tap" — outward ripple visible as a bright pulse expanding
        // through the nearby fluid. Bumped from 1.0 to 3.0 (3×) so the wave
        // is unmistakably visible without dominating the frame.
        // Tiny origin jitter so repeated locks don't look mechanical.
        const origin = this._eventOrigin({}, 0.4);
        this.sim.pushImpulse(origin, 3.0, VORTEX_AXIS, IMPULSE_TYPE.RADIAL);
    }

    _onHardDrop() {
        if (!this._enabled) return;
        // Hard drops are weightier — bigger initial push, wider visible ring.
        const origin = this._eventOrigin({}, 0.5);
        this.sim.pushImpulse(origin, 5.5, VORTEX_AXIS, IMPULSE_TYPE.RADIAL);
    }

    _onLineClear(data = {}) {
        if (!this._enabled) return;
        const lineCount = Math.max(1, data?.lineCount || 1);

        const origin = this._eventOrigin(data, 0.6);
        if (lineCount === 1) {
            this.sim.pushImpulse(origin, 1.6, VORTEX_AXIS, IMPULSE_TYPE.RADIAL);
        } else if (lineCount === 4) {
            // Tetris: dramatic detonation + a secondary vortex 80ms later.
            this.sim.pushImpulse(origin, 6.5, VORTEX_AXIS, IMPULSE_TYPE.RADIAL);
            setTimeout(() => {
                if (!this._enabled || !this.sim) return;
                const v = this._eventOrigin(data, 0.3);
                _scratchDir.set(0, 0, 1).normalize();
                this.sim.pushImpulse(v, 3.5, _scratchDir, IMPULSE_TYPE.VORTEX);
            }, 80);
        } else {
            // 2-3 line clears
            this.sim.pushImpulse(origin, 2.6 + lineCount * 0.4, VORTEX_AXIS, IMPULSE_TYPE.RADIAL);
        }
    }

    _onCombo(data = {}) {
        if (!this._enabled) return;
        const c = Math.max(1, data?.comboCount || 1);

        if (c <= 3) {
            const origin = this._eventOrigin(data, 0.5);
            _scratchDir.set(0, 0, 1).normalize();
            this.sim.pushImpulse(origin, 1.5 + c * 0.3, _scratchDir, IMPULSE_TYPE.VORTEX);
        } else if (c <= 6) {
            const origin = this._eventOrigin(data, 0.7);
            // Combo + radial pop for emphasis
            _scratchDir.set(0, 0, 1).normalize();
            this.sim.pushImpulse(origin, 3.0 + c * 0.2, _scratchDir, IMPULSE_TYPE.VORTEX);
            this.sim.pushImpulse(origin, 2.0, VORTEX_AXIS, IMPULSE_TYPE.RADIAL);
        } else {
            // Combo 7+: triple vortex chaos. Three impulses at 120° around focal.
            for (let i = 0; i < 3; i += 1) {
                const angle = (i / 3) * Math.PI * 2;
                _scratchPos.copy(this.focalPoint);
                _scratchPos.x += Math.cos(angle) * 1.6;
                _scratchPos.y += Math.sin(angle) * 1.6;
                // Alternate vortex direction per impulse for "swirling chaos"
                _scratchDir.set(0, 0, i % 2 === 0 ? 1 : -1);
                this.sim.pushImpulse(_scratchPos, 3.5 + c * 0.15, _scratchDir, IMPULSE_TYPE.VORTEX);
            }
            // Central radial detonation for combo 7+ to "explode" the swirl
            const center = this._eventOrigin(data, 0.2);
            this.sim.pushImpulse(center, 5.0, VORTEX_AXIS, IMPULSE_TYPE.RADIAL);
        }
    }

    _onLevelUp() {
        if (!this._enabled) return;
        // Gentle wide sweep — a soft horizontal radial wave.
        const origin = this._eventOrigin({}, 0.3);
        this.sim.pushImpulse(origin, 2.0, VORTEX_AXIS, IMPULSE_TYPE.RADIAL);
    }

    _onGameOver() {
        if (!this._enabled) return;
        // Strong attractor — mass condenses inward. Held for ~2s by re-emitting
        // every 150ms (decay rate is ~170ms half-life, so 150ms keeps it sustained).
        const origin = this._eventOrigin({}, 0);
        let pulses = 0;
        const repeat = () => {
            if (pulses >= 12 || !this._enabled || !this.sim) return;
            this.sim.pushImpulse(origin, 1.8, VORTEX_AXIS, IMPULSE_TYPE.ATTRACTOR);
            pulses += 1;
            setTimeout(repeat, 150);
        };
        repeat();
    }
}
