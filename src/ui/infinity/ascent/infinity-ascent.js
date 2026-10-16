/**
 * Infinity's ascent: looking around the tower as a journey the body believes.
 *
 * The director of everything that happens while the player looks around Infinity's tower with the
 * wheel, a trackpad, the right stick or the tower map:
 *   - the motion (tower-flight.js): a pull that gives way before the game pauses, a glide with
 *     weight, soft edges, a detent at the player's own rows, the flight home;
 *   - the world: the theme sinks away as the view rises and lifts as it descends (parallax), its
 *     camera cranes with the view and its clock slows (the exploration signal every theme reads),
 *     and the sky between the theme and the board brings the night down from above and a haze up
 *     from below, with motes that stream past at three depths (ascent-sky-stage.js);
 *   - the board: it leans with the speed (BoardJuice), dips when the pull gives way and when it
 *     lands; the well shows the height, the milestones, the tower's memories and the way home
 *     (ascent-overlay.js, tower-memory.js);
 *   - the ears and hands: the music muffles and opens, air, ticks, bells, bumps (ascent-audio.js),
 *     gamepad rumble (ascent-haptics.js).
 *
 * InfinityMode owns the game: pausing, resuming and the session. It gives the director a `host`
 * of callbacks and calls start() / stop(); the director never pauses the game itself, it asks.
 * Reduced motion (Settings or the system): no parallax, crane, lean or streaks; the light, the
 * sounds and the slow clock stay.
 */

import { TowerFlight } from './tower-flight.js';
import {
    ASCENT, clamp, crossings, milestoneHeights, themeShift, viewMetrics,
} from './ascent-model.js';
import { TowerMemory } from './tower-memory.js';
import { AscentAudio } from './ascent-audio.js';
import { AscentHaptics } from './ascent-haptics.js';
import { AscentOverlay } from './ascent-overlay.js';
import { loadThemeTints } from './ascent-tints.js';
import { setExplorationSignal } from '../../../core/exploration-signal.js';
import { normalizeWheelDeltaToPixels, shouldCaptureWheelEvent } from '../../../utils/wheel-routing.js';
import { eventBus, EVENTS } from '../../../events/event-bus.js';

/** Wheel pixels per board row. */
const PIXELS_PER_ROW = 30;
/** The keys that are game actions: pressed while looking, the view goes home. */
const GAME_ACTIONS = ['moveLeft', 'moveRight', 'rotateLeft', 'rotateRight', 'softDrop', 'hardDrop', 'flip'];
/** How fast the layers fade in and out (s), and the themes' share in it. */
const PRESENCE_IN_S = 0.22;
const PRESENCE_OUT_S = 0.42;
const WEIGHT_IN_S = 0.5;
const WEIGHT_OUT_S = 0.75;
/** The world's clock while looking: a quarter of its pace. */
const SLOW_TIME = 0.25;
/** The how-to line shows for the first looks of a session. */
const FIRST_LOOKS = 2;

/** @param {number} current @param {number} target @param {number} seconds @param {number} dt */
const ease = (current, target, seconds, dt) => current
    + (target - current) * (1 - Math.exp(-dt / Math.max(1e-3, seconds)));

/** Is this wheel event a mouse wheel's notch (rather than a trackpad's fine stream)? */
export function isWheelNotch(event) {
    if (!event) return false;
    if (event.deltaMode === 1 || event.deltaMode === 2) return true;
    return Math.abs(event.deltaY) >= 40 && Math.abs(event.deltaX) < 1;
}

export class InfinityAscent {
    /**
     * @param {object} host InfinityMode's callbacks:
     *   getBoardScene, getGameState, getMinimap, getBoardJuice, isRunning, isExternallyPaused,
     *   isExploring, beginExploration (→ Promise<boolean>), endExploration({reason}),
     *   homeTop, summitRow, updateMinimapView(top), settings, soundManager, themeManager,
     *   gamepadController
     */
    constructor(host) {
        this.host = host;
        this.flight = new TowerFlight();
        this.memory = new TowerMemory({ getBoardLength: () => this.host.getGameState?.()?.board?.length || 0 });
        this.audio = new AscentAudio(host.soundManager);
        this.haptics = new AscentHaptics();
        this.overlay = null;
        this.stage = null;
        this.stagePromise = null;
        this.running = false;
        this.frameId = null;
        this.lastFrame = null;
        this.committing = false;
        this.pendingDragTop = null;
        this.reducedMotion = false;
        this.presence = 0;
        this.weight = 0;
        this.rise = 0;
        this.speed = 0;
        this.prevPhase = 'idle';
        this.prevHeight = NaN;
        this.looks = 0;
        this.themeLayer = null;
        this.themeLayerTransform = '';
        this.themeShiftPx = 0;
        this.coveredTheme = false;
        this.tints = null;
        this.tintThemeId = null;
        this.viewport = { width: 1600, height: 900 };
        /** The signal the themes read (exploration-signal.js). */
        this.signal = {
            weight: 0, rise: 0, speed: 0, timeScale: 1,
        };
        this.cleanups = [];
        this._frame = (now) => this._tick(now);
        this._onWheel = (event) => this.handleWheel(event);
        this._onKey = (event) => this._handleKey(event);
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    /** Begin a session: listen for the player, remember the climb, prepare the sky. */
    start() {
        if (this.running) return;
        this.running = true;
        this.flight.reset();
        // A new climb remembers nothing yet.
        this.memory.clear();
        this.memory.start();
        this.looks = 0;
        this.prevPhase = 'idle';
        this.prevHeight = NaN;
        this.viewport = { width: window.innerWidth || 1600, height: window.innerHeight || 900 };
        document.addEventListener('wheel', this._onWheel, { passive: false });
        document.addEventListener('keydown', this._onKey);
        this.cleanups.push(() => {
            document.removeEventListener('wheel', this._onWheel, { passive: false });
            document.removeEventListener('keydown', this._onKey);
        });
        this.cleanups.push(eventBus.on(EVENTS.VIEWPORT_RESIZED, (size) => {
            this.viewport = {
                width: size?.width || window.innerWidth || this.viewport.width,
                height: size?.height || window.innerHeight || this.viewport.height,
            };
        }));
        this.cleanups.push(eventBus.on(EVENTS.THEME_CHANGED, (payload) => this._loadTints(payload?.themeName)));
        this.cleanups.push(this.memory.onChange((marks) => this.host.getMinimap?.()?.setMarks?.(marks)));
        this._attachMinimap();
        this._attachGamepad();
        const section = document.querySelector('#single-player-card .player-board-section');
        this.overlay = new AscentOverlay(/** @type {HTMLElement|null} */ (section));
        this.themeLayer = /** @type {HTMLElement|null} */ (document.querySelector('.background-container'));
        setExplorationSignal(() => (this.signal.weight > 0 ? this.signal : null));
        this._loadTints(this.host.themeManager?.activeThemeName);
        // Build the sky once the mode has settled (its one pipeline compiles while hidden).
        const timer = setTimeout(() => this._ensureStage(), 1200);
        this.cleanups.push(() => clearTimeout(timer));
    }

    /** End the session: everything back as it was. */
    stop() {
        if (!this.running) return;
        this.running = false;
        this._cancelFrame();
        this.cleanups.splice(0).forEach((fn) => { try { fn?.(); } catch { /* already gone */ } });
        this.memory.stop();
        this.audio.release();
        this.flight.reset();
        this.host.getBoardScene?.()?.setViewOffsetRows?.(0);
        this.host.getBoardJuice?.()?.setFlight?.(0, 0);
        this._applyThemeShift(0);
        this._setThemeCovered(false);
        this.presence = 0;
        this.weight = 0;
        this.signal.weight = 0;
        this.signal.timeScale = 1;
        setExplorationSignal(null);
        this.overlay?.dispose();
        this.overlay = null;
        this.stage?.draw({ presence: 0 });
    }

    dispose() {
        this.stop();
        this.memory.dispose();
        this.audio.dispose();
        this.stage?.dispose();
        this.stage = null;
        this.stagePromise = null;
    }

    // ─── What the mode tells us ──────────────────────────────────────────────

    /** The mode ended the look without us (a menu, an outside resume, the session's end). */
    onExplorationEnded() {
        if (this.flight.phase === 'idle' || this.flight.phase === 'pull') return;
        this.flight.reset();
        this.audio.release();
        this._ensureLoop();
    }

    // ─── Input ───────────────────────────────────────────────────────────────

    /** @param {WheelEvent} event */
    handleWheel(event) {
        if (!this.running || !this.host.isRunning?.()) return;
        if (!shouldCaptureWheelEvent({ event })) return;
        // A menu over the game keeps its own scrolling.
        if (this.host.isExternallyPaused?.() && !this.host.isExploring?.()) return;
        event.preventDefault();
        const pixels = normalizeWheelDeltaToPixels(event, { lineHeight: 20, pageHeight: 400, clampPx: null });
        if (!Number.isFinite(pixels) || pixels === 0) return;
        this.haptics.useGamepad(false);
        this._beginInput();
        this.flight.wheel(pixels / PIXELS_PER_ROW, isWheelNotch(event) ? 'notch' : 'fine', performance.now());
        this._ensureLoop();
    }

    /**
     * The right stick, every poll. @param {number} value -1..1 (+ down the tower)
     * @param {{held?: boolean, index?: number}} [options] held: R3 pressed in (look at once)
     */
    handleStick(value, { held = false, index = 0 } = {}) {
        if (!this.running || !this.host.isRunning?.()) return;
        const moving = Math.abs(value) > 0.22 || held;
        if (!moving && this.flight.stickValue === 0) return;
        if (this.host.isExternallyPaused?.() && !this.host.isExploring?.()) return;
        if (moving) {
            this.haptics.useGamepad(true, index);
            this._beginInput();
        }
        this.flight.stick(value, performance.now(), held);
        this._ensureLoop();
    }

    /** A game key or button while looking: home at once, and play. */
    handleGameInput() {
        const { phase } = this.flight;
        if (phase === 'pull') {
            this.flight.cancelPull();
            return;
        }
        if (phase !== 'free' && phase !== 'landing') return;
        this._endLook('key');
    }

    /** @param {KeyboardEvent} event */
    _handleKey(event) {
        if (this.flight.phase === 'idle') return;
        const key = event.key === ' ' ? 'Space' : event.key;
        const bindings = window.settings?.keyBindings || {};
        const action = Object.keys(bindings).find((name) => bindings[name] === key);
        if (action && GAME_ACTIONS.includes(action)) this.handleGameInput();
    }

    _attachMinimap() {
        const minimap = this.host.getMinimap?.();
        const container = minimap?.container;
        if (!container) return;
        const onStart = () => {
            if (!this.running || !this.host.isRunning?.()) return;
            this.haptics.useGamepad(false);
            this._beginInput();
            this.flight.requestCommit();
            this.flight.hold(true, performance.now());
            this._ensureLoop();
        };
        const onJump = (event) => {
            const scene = this.host.getBoardScene?.();
            const rows = scene?.cameraSettings?.visibleRows || 20;
            const centre = Number(event?.detail?.targetRow);
            if (!Number.isFinite(centre)) return;
            const top = centre - Math.floor(rows / 2);
            if (this.flight.phase === 'free') this.flight.dragTo(top, performance.now());
            else this.pendingDragTop = top;
            this._ensureLoop();
        };
        const onEnd = () => this.flight.hold(false, performance.now());
        container.addEventListener('minimap-exploration-start', onStart);
        container.addEventListener('minimap-jump', onJump);
        container.addEventListener('minimap-exploration-end', onEnd);
        this.cleanups.push(() => {
            container.removeEventListener('minimap-exploration-start', onStart);
            container.removeEventListener('minimap-jump', onJump);
            container.removeEventListener('minimap-exploration-end', onEnd);
        });
        minimap.setMarks?.(this.memory.marks);
    }

    _attachGamepad() {
        const pad = this.host.gamepadController;
        if (!pad?.enableExplorationMode) return;
        pad.enableExplorationMode({
            onStick: (value, options) => this.handleStick(value, options),
            onGameInput: () => this.handleGameInput(),
            isExploring: () => this.flight.phase === 'free' || this.flight.phase === 'landing',
        });
        this.cleanups.push(() => pad.disableExplorationMode?.());
    }

    /**
     * Tell the flight where the tower and the camera are (before input as well as every frame:
     * the first wheel notch arrives before any frame of a look has run).
     * @returns {{scene: any, state: any, rows: number, home: number} | null}
     */
    _syncFlight() {
        const scene = this.host.getBoardScene?.();
        const state = this.host.getGameState?.();
        const settings = scene?.cameraSettings;
        if (!settings || !state?.board?.length) return null;
        const rows = settings.visibleRows || 20;
        this.flight.setBounds(0, Math.max(0, state.board.length - rows));
        this.flight.setFollowTop(settings.currentTopRow || 0);
        const home = this.host.homeTop?.() ?? settings.currentTopRow ?? 0;
        this.flight.setHome(home);
        return {
            scene, state, rows, home,
        };
    }

    /** The first touch of a look: read the settings it depends on. */
    _beginInput() {
        this._syncFlight();
        if (this.flight.phase !== 'idle') return;
        const settings = this.host.settings?.() || {};
        this.reducedMotion = Boolean(settings.reducedMotion
            || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
        this.flight.setReducedMotion(this.reducedMotion);
        // Bring the music into Web Audio now, so the muffle can follow the lift-off.
        this.host.soundManager?.getAnalyzer?.(true);
    }

    // ─── The look ────────────────────────────────────────────────────────────

    async _commit() {
        if (this.committing) return;
        this.committing = true;
        let began = false;
        try {
            began = await this.host.beginExploration?.();
        } catch (error) {
            console.warn('[InfinityAscent] could not begin exploring:', error);
        }
        this.committing = false;
        const scene = this.host.getBoardScene?.();
        if (!began || !this.running || !scene?.cameraSettings || this.flight.phase !== 'pull') {
            this.flight.cancelPull();
            return;
        }
        const offset = scene.cameraSettings.viewOffsetRows || 0;
        const start = (scene.cameraSettings.currentTopRow || 0) + offset;
        scene.setViewOffsetRows?.(0);
        scene.updateCameraPosition(start, true);
        this.flight.commit(start);
        this.looks += 1;
        if (this.pendingDragTop !== null) {
            this.flight.dragTo(this.pendingDragTop, performance.now());
            this.pendingDragTop = null;
        }
        this._ensureStage();
        this._ensureLoop();
    }

    /** @param {'landed'|'key'} reason */
    _endLook(reason) {
        const { phase } = this.flight;
        this.flight.reset();
        this.pendingDragTop = null;
        if (phase === 'free' || phase === 'landing' || phase === 'landed') {
            if (reason === 'key') this.audio.land();
            this.host.endExploration?.({ reason });
        }
        this._ensureLoop();
    }

    // ─── The frame ───────────────────────────────────────────────────────────

    _ensureLoop() {
        if (this.frameId === null && this.running && typeof requestAnimationFrame === 'function') {
            this.lastFrame = null;
            this.frameId = requestAnimationFrame(this._frame);
        }
    }

    _cancelFrame() {
        if (this.frameId !== null) cancelAnimationFrame(this.frameId);
        this.frameId = null;
    }

    /** @param {number} now */
    _tick(now) {
        this.frameId = null;
        if (!this.running) return;
        const dt = this.lastFrame === null ? 1 / 60 : clamp((now - this.lastFrame) / 1000, 0, 0.1);
        this.lastFrame = now;
        const keepGoing = this.step(dt, now);
        if (keepGoing) this.frameId = requestAnimationFrame(this._frame);
    }

    /**
     * One frame of the look (public for tests and captures).
     * @param {number} dt seconds @param {number} now ms
     * @returns {boolean} whether anything is still moving or fading
     */
    step(dt, now) {
        const synced = this._syncFlight();
        if (!synced) return false;
        const {
            scene, state, rows, home,
        } = synced;
        const boardLength = state.board.length;
        const { flight } = this;
        const frame = flight.step(dt, now);

        // Apply the motion to the board's camera.
        if (frame.phase === 'pull') {
            scene.setViewOffsetRows?.(frame.offset);
            if (frame.wantCommit && !this.committing) this._commit();
        } else if (frame.phase === 'idle') {
            if (this.prevPhase === 'pull') scene.setViewOffsetRows?.(0);
        } else {
            scene.updateCameraPosition(frame.top, true);
            if (frame.wantLand === 'idle') flight.beginLanding(now, home);
            else if (frame.wantLand === 'home') flight.beginLanding(now, home, { quick: true });
        }
        const looking = frame.phase === 'free' || frame.phase === 'landing' || frame.phase === 'landed';

        // Where the view is, and what it passes.
        const summitRow = this.host.summitRow?.() ?? boardLength;
        const m = viewMetrics({
            top: frame.top, home, visibleRows: rows, boardLength, summitRow,
        });
        this._events(frame.events);
        if (looking && Number.isFinite(this.prevHeight)) this._passing(this.prevHeight, m);
        this.prevHeight = looking ? m.height : NaN;
        if (frame.phase === 'landed') this._endLook('landed');
        this.prevPhase = frame.phase;

        // How present the look is: the peek shows a little of it, looking all of it.
        const pullShare = frame.phase === 'pull' ? clamp(Math.abs(frame.offset) / 2.4, 0, 1) * 0.45 : 0;
        const wanted = looking ? 1 : pullShare;
        this.presence = ease(this.presence, wanted, wanted > this.presence ? PRESENCE_IN_S : PRESENCE_OUT_S, dt);
        if (wanted === 0 && this.presence < 0.002) this.presence = 0;
        this.weight = ease(this.weight, looking ? 1 : 0, looking ? WEIGHT_IN_S : WEIGHT_OUT_S, dt);
        // Under 1 % the crane is under a pixel and the clock within 1 % of its pace: let go.
        if (!looking && this.weight < 0.01) this.weight = 0;
        const speed = clamp(-frame.velocity / ASCENT.SPEED_ROWS, -1, 1);
        this.speed = ease(this.speed, speed, 0.12, dt);
        this.rise = ease(this.rise, m.rise, 0.15, dt);
        const motion = this.reducedMotion ? 0 : 1;
        this.signal.weight = this.weight;
        this.signal.rise = this.rise * motion;
        this.signal.speed = this.speed * motion;
        this.signal.timeScale = 1 - (1 - SLOW_TIME) * this.weight;

        // The world: the theme sinks or lifts (parallax), the sky between it and the board.
        const boardHeight = this.overlay?.height || this.viewport.height * 0.8;
        const rowPx = boardHeight / rows;
        const vh = this.viewport.height || 900;
        const shift = motion * this.presence * themeShift(m.riseRows, rowPx, vh);
        this._applyThemeShift(shift);
        const rowScreen = rowPx / vh;
        const sky = m.sky * this.presence;
        this.stage?.draw({
            presence: this.presence,
            sky: m.sky,
            deep: m.deep,
            dim: 0.12,
            gapTop: shift > 0 ? shift / vh : 0,
            gapBottom: shift < 0 ? -shift / vh : 0,
            scroll: frame.top * rowScreen,
            speed: this.speed,
            flow: frame.velocity * rowScreen,
            time: now / 1000,
            motion,
        });
        // Only a drawn sky covers the world completely (the CSS veil lets a little through).
        const opaqueSky = Boolean(this.stage?.ready) && this.stage.backend !== 'css';
        this._setThemeCovered(opaqueSky && sky > 0.985);

        // The board leans with the speed and stretches a hair along it.
        this.host.getBoardJuice?.()?.setFlight?.(
            motion * this.presence * this.speed * 2.2,
            motion * this.presence * Math.abs(this.speed) * 0.012,
        );

        // The air, the well's marks and the tower map.
        this.audio.motion(Math.abs(this.speed) * (looking ? 1 : 0), m.sky);
        const { marks } = this.memory;
        const near = looking ? this.memory.nearest(m.height) : null;
        this.overlay?.render({
            presence: this.presence,
            top: frame.top,
            visibleRows: rows,
            boardLength,
            home,
            summitHeight: m.summitHeight,
            maxRows: state.maxRows || 1000,
            ring: frame.ring,
            marks,
            caption: near ? this.memory.caption(near) : null,
            captionHeight: near ? near.height : null,
            firstLook: looking && this.looks <= FIRST_LOOKS,
        });
        if (looking) this.host.updateMinimapView?.(frame.top);

        return flight.phase !== 'idle' || this.presence > 0 || this.weight > 0 || this.committing;
    }

    /** @param {import('./tower-flight.js').FlightEvent[]} events */
    _events(events) {
        const juice = this.host.getBoardJuice?.();
        for (const event of events) {
            switch (event.type) {
            case 'give':
                this.audio.liftOff();
                this.haptics.pulse('give');
                juice?.dip?.(2.5);
                juice?.bounce?.();
                break;
            case 'dock':
                this.audio.dock();
                this.haptics.pulse('dock');
                break;
            case 'floor':
                this.audio.bump(event.strength);
                this.haptics.pulse('bump', event.strength);
                juice?.dip?.(1.5 + 2.5 * (event.strength || 0));
                break;
            case 'ceiling':
                this.audio.bump((event.strength || 0) * 0.5);
                this.haptics.pulse('bump', (event.strength || 0) * 0.5);
                break;
            case 'floor-nudge':
                juice?.dip?.(1.2);
                break;
            case 'land':
                this.audio.land();
                this.haptics.pulse('land');
                juice?.dip?.(3.5);
                juice?.bounce?.();
                break;
            default:
                break;
            }
        }
    }

    /**
     * Ticks every ten rows, bells at the milestones, a shimmer past the summit.
     * @param {number} from height last frame @param {import('./ascent-model.js').ViewMetrics} m
     */
    _passing(from, m) {
        const lines = crossings(from, m.height, ASCENT.TICK_ROWS);
        if (!lines.length && !(from < m.summitHeight && m.height >= m.summitHeight)) return;
        const state = this.host.getGameState?.();
        const milestones = milestoneHeights(state?.maxRows || 1000);
        for (const h of lines) {
            if (milestones.includes(h)) {
                this.audio.chime(m.summitHeight >= h);
                this.haptics.pulse('milestone');
            } else {
                this.audio.tick(h);
                this.haptics.pulse('tick');
            }
        }
        if (m.summitHeight > 0 && from < m.summitHeight && m.height >= m.summitHeight) this.audio.shimmer();
    }

    // ─── The world ───────────────────────────────────────────────────────────

    /** @param {number} px */
    _applyThemeShift(px) {
        const layer = this.themeLayer;
        if (!layer) return;
        const value = Math.abs(px) < 0.25 ? 0 : px;
        if (value === this.themeShiftPx) return;
        if (this.themeShiftPx === 0 && value !== 0) {
            this.themeLayerTransform = layer.style.transform || '';
            layer.style.willChange = 'transform';
        }
        this.themeShiftPx = value;
        if (value === 0) {
            layer.style.transform = this.themeLayerTransform;
            layer.style.willChange = '';
        } else {
            layer.style.transform = `translate3d(0, ${value.toFixed(1)}px, 0)`;
        }
    }

    /** The sky covers the whole world: the theme need not draw. @param {boolean} covered */
    _setThemeCovered(covered) {
        if (covered === this.coveredTheme) return;
        if (covered && window.isThemeCovered) return;
        this.coveredTheme = covered;
        window.isThemeCovered = covered;
    }

    _ensureStage() {
        if (this.stagePromise || !this.running) return;
        const quality = this.host.settings?.()?.graphicsQuality || 'High';
        this.stagePromise = import('./ascent-sky-stage.js')
            .then(({ AscentSkyStage }) => {
                if (!this.running) return null;
                const stage = new AscentSkyStage({ quality });
                this.stage = stage;
                if (this.tints) stage.setTints(this.tints);
                return stage.init();
            })
            .catch((error) => {
                console.warn('[InfinityAscent] the sky is unavailable:', error?.message || error);
                return null;
            });
    }

    /** The sky borrows the theme's colours (from its icon). @param {string|undefined} themeId */
    async _loadTints(themeId) {
        if (!themeId || themeId === this.tintThemeId) return;
        this.tintThemeId = themeId;
        const tints = await loadThemeTints(themeId);
        if (!tints || this.tintThemeId !== themeId) return;
        this.tints = tints;
        this.stage?.setTints(tints);
    }

    getDiagnostics() {
        return {
            phase: this.flight.phase,
            presence: this.presence,
            weight: this.weight,
            signal: { ...this.signal },
            themeShiftPx: this.themeShiftPx,
            coveredTheme: this.coveredTheme,
            looks: this.looks,
            marks: this.memory.marks.length,
            tints: this.tints,
            sky: this.stage?.getDiagnostics?.() || null,
        };
    }
}
