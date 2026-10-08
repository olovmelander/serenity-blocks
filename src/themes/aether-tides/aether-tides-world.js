/**
 * Aether Tides — the world: owns the uniforms, the fluid, the picture and the choreography.
 * Shared with the playground effect, so what is iterated there ships.
 *
 * Everything that moves is keyed to the FLUID's clock (fixed steps plus the remainder the picture
 * extrapolates across), never to wall time. An event creates nothing: it writes numbers into the
 * event table (aether-tides-events.js) and into a few timers here, and the solver and the shaders
 * evaluate them in closed form. seek() plus a fixed-step replay therefore reproduces any frame.
 *
 * The event language:
 *   lock      the piece's own footprint appears beside its card, in its colour, as gas poured
 *             into the fluid; the tide takes it. A spark flies from it to a seat in the open sky
 *             and opens there as a star in that colour, dragging a wake through the nebula.
 *   hard drop the same, slammed down from above: more gas, a harder push, a wider front.
 *   clear     every cleared row fires a jet out of each side of the card; a blast front runs out
 *             from the board, shouldering the gas aside and leaving it glowing; and every star
 *             the board has lit goes nova as the front reaches it.
 *   combo     the maelstrom opens in the sky opposite the Tide Star and deepens with the chain:
 *             the gas spirals into it, the light behind it bends. When the chain breaks it lets
 *             go: a front, two jets, and the tide runs out again.
 *   four lines / perfect clear   the nebula holds its breath, then the Tide Star itself flares
 *             and everything fires at once, in starfire.
 *   T-spin    the whole tide turns about the board.
 *   level up  the nebula changes colours.
 */

import { texture } from 'three/tsl';

import {
    AETHER_PALETTES,
    GYRE_SLOTS,
    HUSH_HOLD,
    LOCK_POUR,
    PALETTE_KEYS,
    SIM_DT,
    SIM_MAX_STEPS,
    SPARK_FLIGHT,
    SPLAT_CELL,
    SPLAT_ROUND,
    STARFIRE,
    STAR_LIFE,
    STAR_SLOTS,
    TAU,
    WELL_OPEN,
    WELL_RELEASE,
    approach,
    bakeNoise,
    clamp01,
    createNoiseTexture,
    lerp,
    maelstromPosition,
    pieceColor,
    powerForCombo,
    ringPassTime,
    smooth,
    starSeat,
    tideStarPosition,
} from './aether-tides-tsl.js';
import { TideEvents } from './aether-tides-events.js';
import { TideFluid, createTideUniforms, supportsFloatTargets } from './aether-tides-fluid.js';
import { aimRiver, createField, createFieldUniforms } from './aether-tides-field.js';
import { createNebula, createPictureUniforms } from './aether-tides-nebula.js';
import { TideLight } from './aether-tides-light.js';
import { createStars } from './aether-tides-stars.js';
import { createFx } from './aether-tides-fx.js';
import { tierFor } from './aether-tides-quality.js';
import {
    BOARD_GRID,
    boardFor,
    cardFor,
    fallbackLayout,
    placeEcho,
    rectToTide,
} from './aether-tides-composition.js';

/** The camera is not used by the picture (it is drawn in clip space); kept for the post stack. */
export const REST_RIG = Object.freeze({ near: 0.1, far: 10, fov: 50 });

/** A lock's echo stands this long before the tide takes it, then is pushed for this long. */
const ECHO_HOLD = 0.2;
const ECHO_PUSH = 0.3;

/** Well slots. */
const WELL_MAELSTROM = 0;
const WELL_BOARD = 1;
const WELL_STAR_A = 2;
const WELL_STAR_B = 3;

const NEVER = -1e6;

const rect = () => ({
    x0: 0, y0: 0, x1: 0, y1: 0,
});

export class AetherTidesWorld {
    /**
     * @param {object} options
     * @param {THREE.Scene} options.scene
     * @param {THREE.WebGPURenderer} options.renderer
     * @param {string} [options.quality='High']
     * @param {boolean} [options.capture=false]   replaying: never drop simulated time
     * @param {boolean} [options.live]            false forces the no-solver fallback (the default
     *                                            asks the renderer whether it can draw to
     *                                            half-float targets)
     */
    constructor({
        scene, renderer, quality = 'High', capture = false, live,
    }) {
        this.scene = scene;
        this.renderer = renderer;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture;
        this.live = live ?? supportsFloatTargets(renderer);
        this.aspect = 16 / 9;
        this.reducedMotion = false;
        this.events = new TideEvents();
        this.tide = null;
        this.fieldUniforms = null;
        this.picture = null;
        this.fluid = null;
        this.light = null;
        this.nebula = null;
        this.stars = null;
        this.fx = null;
        this.noise = null;
        this.parts = {};
        this.pointer = { x: 0, y: 0 };

        /** Layout in screen fractions (the live rects, else the stylesheet's solo layout). */
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;

        // ── choreography state (all on the fluid's clock) ──
        this.combo = 0;
        this.level = 1;
        this.lockCount = 0;
        /** The colour of the last piece that locked (a chain feeds the maelstrom with it). */
        this.lastColor = [0.54, 0.36, 1.0];
        /** The maelstrom: how open it is (eased per fixed step), and when it last let go. */
        this.wellOpen = 0;
        this.wellAim = 0;
        this.releaseAt = NEVER;
        /** The spring behind the board a clear opens, and the turn a T-spin gives. */
        this.burst = {
            at: NEVER, x: 0, y: 0, strength: 0,
        };
        this.twist = {
            at: NEVER, x: 0, y: 0, strength: 0,
        };
        /** A four-line clear: the hush before it, and the Tide Star's flare. */
        this.hushAt = NEVER;
        this.flareAt = NEVER;
        this.starfireAt = NEVER;
        /** The post stack's flash and kick: when, and how hard. */
        this.flash = { at: NEVER, strength: 0 };
        this.kick = { at: NEVER, strength: 0 };
        /** Palette: what is shown, blending from one index to another. */
        this.paletteFrom = 0;
        this.paletteTo = 0;
        this.paletteAt = NEVER;
        this.palette = {};
        PALETTE_KEYS.forEach((key) => {
            this.palette[key] = [0, 0, 0];
        });

        this._p = { x: 0, y: 0 };
        this._seat = { x: 0, y: 0 };
        this._region = rect();
        this._box = rect();
        this._card = rect();
        this._board = rect();
        this._obstacles = [];
        this._obstaclePool = Array.from({ length: 6 }, rect);
        this._echo = {
            dx: 0, dy: 0, nx: 0, ny: 0, placed: false,
        };
        this._post = {
            flash: 0, kick: 0, bloomBoost: 0, exposure: 1,
        };
        this._prepare = (clock) => this.prepareStep(clock);
        this.cpuMs = 0;
        /** Set by the playground effect to hold uniforms at URL-given values (never by the theme). */
        this.tuning = null;
    }

    build() {
        const { tier } = this;
        this.noise = createNoiseTexture(bakeNoise());
        this.tide = createTideUniforms();
        this.fieldUniforms = createFieldUniforms();
        this.picture = createPictureUniforms();
        const tNoise = texture(this.noise);
        const field = createField(this.fieldUniforms, tNoise);
        this.fluid = new TideFluid({
            uniforms: this.tide,
            tNoise,
            field,
            cells: tier.cells,
            dyeHeight: tier.dyeHeight,
            sweeps: tier.sweeps,
            live: this.live,
        });
        this.light = new TideLight({
            tide: this.tide, picture: this.picture, fluid: this.fluid, steps: tier.lightSteps,
        });
        this.nebula = createNebula({
            tide: this.tide, picture: this.picture, fluid: this.fluid, light: this.light, tier, field,
        });
        this.stars = createStars({
            tide: this.tide, picture: this.picture, fluid: this.fluid, tier,
        });
        this.fx = createFx({
            tide: this.tide, picture: this.picture, fluid: this.fluid, tier,
        });
        this.parts.nebula = this.nebula.mesh;
        this.parts.stars = this.stars.mesh;
        this.parts.beams = this.fx.beamMesh;
        this.parts.stardust = this.fx.dustMesh;
        this.parts.cells = this.fx.cellMesh;
        this.scene.add(this.nebula.mesh, this.stars.mesh, this.fx.beamMesh, this.fx.dustMesh, this.fx.cellMesh);
        this.paletteFrom = 0;
        this.paletteTo = 0;
        this.applyPalette(1);
        this.setViewport(1920, 1080, 16 / 9);
        // The event table must hold real numbers before the first pass reads it.
        this.prepareStep(0);
        return this;
    }

    bindCamera() {
        return this;
    }

    loadTextures() {
        return Promise.resolve(true);
    }

    // ── palette ─────────────────────────────────────────────────────────────────

    /** Write the palette at blend `k` between paletteFrom and paletteTo. */
    applyPalette(k) {
        const count = AETHER_PALETTES.length;
        const from = AETHER_PALETTES[((this.paletteFrom % count) + count) % count];
        const to = AETHER_PALETTES[((this.paletteTo % count) + count) % count];
        const pal = this.palette;
        for (let i = 0; i < PALETTE_KEYS.length; i += 1) {
            const key = PALETTE_KEYS[i];
            const a = from[key];
            const b = to[key];
            const o = pal[key];
            o[0] = lerp(a[0], b[0], k);
            o[1] = lerp(a[1], b[1], k);
            o[2] = lerp(a[2], b[2], k);
        }
        const F = this.fieldUniforms;
        const P = this.picture;
        F.gasA.value.setRGB(...pal.gasA);
        F.gasB.value.setRGB(...pal.gasB);
        F.gasC.value.setRGB(...pal.gasC);
        P.deep.value.setRGB(...pal.deep);
        P.dustTint.value.setRGB(...pal.dust);
        P.starColorA.value.setRGB(...pal.star);
        P.starColorB.value.setRGB(...pal.companion);
    }

    // ── size + layout ───────────────────────────────────────────────────────────

    setViewport(bufferWidth, bufferHeight, aspect) {
        if (!this.fluid) return;
        const a = Number.isFinite(aspect) && aspect > 0 ? aspect : bufferWidth / Math.max(1, bufferHeight);
        // A frame with no size (a window still opening) is not a frame.
        if (!(a > 0) || !Number.isFinite(a) || !(bufferHeight > 0)) return;
        this.aspect = a;
        this.picture.pixels.value = Math.max(1, bufferHeight) * 0.5;
        aimRiver(this.fieldUniforms, a);
        this.fluid.resize(a);
        this.light.resize(this.fluid.size.width, this.fluid.size.height);
        if (!this.layoutLive) this.layout = fallbackLayout(900 * a, 900);
        this.applyLayout();
    }

    /** The live card / board / HUD rects (screen fractions), or null when no board is on screen. */
    setLayout(rects, aspect) {
        if (!this.fluid) return;
        if (Number.isFinite(aspect) && aspect > 0 && Math.abs(aspect - this.aspect) > 1e-3) {
            this.setViewport(this.picture.pixels.value * 2 * aspect, this.picture.pixels.value * 2, aspect);
        }
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(900 * this.aspect, 900);
        this.applyLayout();
    }

    /** The gas thins behind the card (a solo card; several boards share the frame evenly). */
    applyLayout() {
        const F = this.fieldUniforms;
        const { cards } = this.layout;
        const solo = cards.length === 1;
        const card = rectToTide(cards[0], this.aspect, this._card);
        F.card.value.set(
            (card.x0 + card.x1) * 0.5,
            (card.y0 + card.y1) * 0.5,
            (card.x1 - card.x0) * 0.5,
            (card.y1 - card.y0) * 0.5,
        );
        F.cardVoid.value = solo ? 0.5 : 0;
    }

    setReducedMotion(reduce) {
        this.reducedMotion = reduce === true;
    }

    showOnlyParts(names) {
        const keep = new Set(names);
        Object.keys(this.parts).forEach((key) => {
            this.parts[key].visible = keep.has(key);
        });
    }

    // ── clock ───────────────────────────────────────────────────────────────────

    /** The instant the picture shows: the fluid's last whole step plus what it has not stepped. */
    get now() {
        return this.fluid.clock + this.fluid.debt;
    }

    /** Still gas at `time`, nothing in flight. */
    seek(time) {
        if (!this.fluid) return;
        this.events.reset();
        this.fx.table.reset();
        this.clearChoreography();
        this.fluid.clock = time;
        this.fluid.debt = 0;
        this.prepareStep(time);
        this.fluid.reset(this.renderer, time);
        this.light.forget();
    }

    clearChoreography() {
        this.combo = 0;
        this.lockCount = 0;
        this.wellOpen = 0;
        this.wellAim = 0;
        this.releaseAt = NEVER;
        this.burst.at = NEVER;
        this.twist.at = NEVER;
        this.hushAt = NEVER;
        this.flareAt = NEVER;
        this.starfireAt = NEVER;
        this.flash.at = NEVER;
        this.kick.at = NEVER;
    }

    /** Before each fluid step: place what moves by itself, then write the event table. */
    prepareStep(clock) {
        const {
            events, aspect, tide: U,
        } = this;
        const calm = this.reducedMotion ? 0.5 : 1;
        const power = powerForCombo(this.combo);

        // Three slow gyres: the tide. They wander, and their strengths breathe out of step.
        for (let g = 0; g < GYRE_SLOTS; g += 1) {
            const phase = clock * 0.021 + g * (TAU / GYRE_SLOTS);
            const sign = g % 2 === 0 ? 1 : -1;
            events.setGyre(g, {
                x: Math.cos(phase) * aspect * 0.62,
                y: Math.sin(phase * 1.3 + g) * 0.55,
                strength: sign * (0.085 + 0.045 * Math.sin(clock * 0.05 + g * 2.1)),
                radius: 0.95,
            });
        }
        U.tide.value = calm * (1 + power * 0.9);
        U.gust.value = 0.16 * calm * (1 + power * 0.6);
        U.gustScroll.value.set(clock * 0.004, clock * -0.0027);
        this.fieldUniforms.drift.value.set(clock * 0.0009, clock * 0.0006);

        // ── the maelstrom ──
        const rate = this.wellAim > this.wellOpen ? 1 / WELL_OPEN : 1 / WELL_RELEASE;
        this.wellOpen += (this.wellAim - this.wellOpen) * approach(rate * 2.2, SIM_DT);
        if (this.wellOpen < 1e-3 && this.wellAim === 0) this.wellOpen = 0;
        const open = this.wellOpen;
        const well = maelstromPosition(clock, aspect, this._p);
        events.setWell(WELL_MAELSTROM, {
            x: well.x,
            y: well.y,
            flow: -open * 4 * calm,
            radius: 0.09 + 0.06 * open,
            // A steady push settles at swirl / drag: about a unit and a half a second at full depth.
            swirl: open * 0.5 * calm,
            drain: open * 2.2,
            heat: open * 1.6,
            swirlRadius: 0.3 + 0.16 * open,
        });

        // ── the spring behind the board, and a T-spin's turn ──
        const burstAge = clock - this.burst.at;
        const twistAge = clock - this.twist.at;
        const burstLater = this.burst.at > this.twist.at;
        events.setWell(WELL_BOARD, {
            x: burstLater ? this.burst.x : this.twist.x,
            y: burstLater ? this.burst.y : this.twist.y,
            flow: burstAge >= 0 && burstAge < 1.2 ? this.burst.strength * Math.exp(-burstAge * 7) * calm : 0,
            radius: 0.3,
            swirl: twistAge >= 0 && twistAge < 2.5 ? this.twist.strength * Math.exp(-twistAge * 2.6) * calm : 0,
            drain: 0,
            heat: 0,
            swirlRadius: 0.7,
        });

        // ── the two great stars: each blows a little hollow in the gas round itself ──
        const flare = this.flareStrength(clock);
        const a = tideStarPosition(0, clock, aspect, this._p);
        events.setWell(WELL_STAR_A, {
            x: a.x,
            y: a.y,
            flow: 0.4 + flare * 5,
            radius: 0.1,
            swirl: 0.035,
            drain: 0.5,
            heat: 0.12 + flare * 3,
            swirlRadius: 0.32,
        });
        const b = tideStarPosition(1, clock, aspect, this._p);
        events.setWell(WELL_STAR_B, {
            x: b.x, y: b.y, flow: 0.28, radius: 0.085, swirl: -0.028, drain: 0.4, heat: 0.08, swirlRadius: 0.26,
        });

        // ── palette ──
        if (this.paletteFrom !== this.paletteTo) {
            const blend = smooth(0, 2.6, clock - this.paletteAt);
            this.applyPalette(blend);
            if (blend >= 1) this.paletteFrom = this.paletteTo;
        }
        // While the colours turn the nebula heals faster, so the new palette takes hold.
        const turning = clock - this.paletteAt;
        U.heal.value = 0.045 + (turning >= 0 && turning < 9 ? 0.32 * (1 - turning / 9) : 0);

        // The playground's tuning hook: overrides land after the choreography has written its own.
        this.tuning?.();

        const data = events.pack(clock);
        const { rows } = U;
        for (let i = 0; i < rows.length; i += 1) rows[i].fromArray(data, i * 4);
        U.splatCount.value = events.splatCount;
        U.ringCount.value = events.ringCount;
    }

    /** The Tide Star's flare after a four-line clear: a hard rise, a slow fall. */
    flareStrength(clock) {
        const age = clock - this.flareAt;
        if (age < 0 || age > 5) return 0;
        return Math.min(1, age / 0.08) * Math.exp(-age * 1.15);
    }

    updateCamera() {}

    update(sim) {
        if (!this.fluid) return;
        const delta = Math.max(0, sim?.delta || 0);
        const started = performance.now();
        const steps = this.fluid.advance(this.renderer, delta, this._prepare, this.capture ? 4096 : SIM_MAX_STEPS);
        const { now, aspect } = this;
        const P = this.picture;
        P.time.value = now;
        const k = approach(2.5, Math.max(delta, 1 / 240));
        this.pointer.x += ((sim?.pointerX || 0) - this.pointer.x) * k;
        this.pointer.y += ((sim?.pointerY || 0) - this.pointer.y) * k;
        const drift = this.reducedMotion ? 0 : 1;
        P.view.value.set(
            this.pointer.x * 0.5 + Math.sin(now * 0.05) * 0.35 * drift,
            this.pointer.y * 0.35 + Math.cos(now * 0.037) * 0.25 * drift,
        );

        const power = powerForCombo(this.combo);
        const flare = this.flareStrength(now);
        const a = tideStarPosition(0, now, aspect, this._p);
        P.starA.value.set(a.x, a.y);
        const b = tideStarPosition(1, now, aspect, this._p);
        P.starB.value.set(b.x, b.y);
        P.starFlux.value.set(1 + power * 0.35 + flare * 1.7, 0.62 + power * 0.2 + flare * 0.3);

        const w = maelstromPosition(now, aspect, this._p);
        const open = this.wellOpen;
        P.well.value.set(w.x, w.y, 0.05 + 0.075 * open, open);

        // The hush: everything sinks, then lets go as the starfire fires.
        const hushAge = now - this.hushAt;
        P.hush.value = hushAge >= 0 && hushAge < HUSH_HOLD + 0.4
            ? smooth(0, 0.07, hushAge) * (1 - smooth(HUSH_HOLD - 0.02, HUSH_HOLD + 0.1, hushAge))
            : 0;
        // A four-line clear burns in starfire for a few seconds, then the palette's own colour.
        const fire = now - this.starfireAt;
        const burning = fire >= 0 && fire < 4 ? 1 - smooth(1.6, 4, fire) : 0;
        const { shock } = this.palette;
        P.shock.value.setRGB(
            lerp(shock[0], STARFIRE[0], burning),
            lerp(shock[1], STARFIRE[1], burning),
            lerp(shock[2], STARFIRE[2], burning),
        );
        P.hot.value = 1 + burning * 0.2;
        P.glow.value = 1 + power * 0.25;

        this.fx.sync();
        this.tuning?.();
        this.light.render(this.renderer);
        // What the solver and the light cost the main thread this frame (a diagnostic).
        if (steps <= SIM_MAX_STEPS) this.cpuMs += (performance.now() - started - this.cpuMs) * 0.05;
    }

    // ── gameplay ────────────────────────────────────────────────────────────────

    /** The clock an event starts on: the fluid's next step. */
    get eventClock() {
        return this.fluid.clock;
    }

    /** Board, card and obstacles for a player, in tide space. */
    stage(player) {
        const { layout, aspect } = this;
        const boardRect = boardFor(layout, player) || fallbackLayout(900 * aspect, 900).boards[0];
        const cardRect = cardFor(layout, boardRect) || boardRect;
        const board = rectToTide(boardRect, aspect, this._board);
        const card = rectToTide(cardRect, aspect, this._card);
        const obstacles = this._obstacles;
        obstacles.length = 0;
        let used = 0;
        const push = (r) => {
            if (!r || r === cardRect || used >= this._obstaclePool.length) return;
            obstacles.push(rectToTide(r, aspect, this._obstaclePool[used]));
            used += 1;
        };
        for (let i = 0; i < layout.cards.length; i += 1) push(layout.cards[i]);
        push(layout.hud);
        return { board, card, obstacles };
    }

    /**
     * A seat for the next star: in the open sky on the echo's side of the card, clear of whatever
     * else hides the sky. `near` > 0 seats it within that distance of the echo instead (a click
     * in the meditation mode has no card).
     */
    seatFor(echo, card, obstacles, near) {
        const { aspect } = this;
        const region = this._region;
        const seat = this._seat;
        region.x0 = -aspect * 0.94;
        region.x1 = aspect * 0.94;
        region.y0 = -0.9;
        region.y1 = 0.9;
        if (near > 0) {
            const cx = (this._box.x0 + this._box.x1) * 0.5;
            const cy = (this._box.y0 + this._box.y1) * 0.5;
            region.x0 = Math.max(region.x0, cx - near);
            region.x1 = Math.min(region.x1, cx + near);
            region.y0 = Math.max(region.y0, cy - near);
            region.y1 = Math.min(region.y1, cy + near);
        } else if (echo.placed && echo.nx < 0 && card.x0 - 0.12 - region.x0 > 0.1) region.x1 = card.x0 - 0.12;
        else if (echo.placed && echo.nx > 0 && region.x1 - card.x1 - 0.12 > 0.1) region.x0 = card.x1 + 0.12;
        else if (echo.placed && echo.ny < 0 && card.y0 - 0.1 - region.y0 > 0.06) region.y1 = card.y0 - 0.1;
        else if (echo.placed && echo.ny > 0 && region.y1 - card.y1 - 0.1 > 0.06) region.y0 = card.y1 + 0.1;
        // How deep a seat sits behind a rect (0 = clear of it).
        const depth = (r) => Math.max(0, Math.min(
            seat.x - (r.x0 - 0.05),
            (r.x1 + 0.05) - seat.x,
            seat.y - (r.y0 - 0.05),
            (r.y1 + 0.05) - seat.y,
        ));
        let best = Infinity;
        let bestX = 0;
        let bestY = 0;
        for (let attempt = 0; attempt < 8; attempt += 1) {
            starSeat(this.lockCount + attempt * 11, region, seat);
            let hidden = depth(card);
            for (let i = 0; i < obstacles.length; i += 1) hidden = Math.max(hidden, depth(obstacles[i]));
            if (hidden < best) {
                best = hidden;
                bestX = seat.x;
                bestY = seat.y;
            }
            if (hidden === 0) break;
        }
        // No try was clear (boards across the whole frame): the least hidden one.
        seat.x = bestX;
        seat.y = bestY;
        return seat;
    }

    /** A source that moves from a to b: rates are scaled so each point on the way gets `deposit`. */
    streak({
        ax, ay, bx, by, at, duration, radius, color, deposit = 0, push = 0, heat = 0, bend = 0, ease = 0, dust = 0,
    }) {
        const length = Math.hypot(bx - ax, by - ay);
        const speed = length / Math.max(1e-3, duration);
        // A point on the path sits under the moving footprint for about radius·√π / speed seconds.
        const dwell = Math.max(SIM_DT, (radius * 1.77) / Math.max(1e-3, speed));
        const dx = length > 1e-4 ? (bx - ax) / length : 0;
        const dy = length > 1e-4 ? (by - ay) / length : 0;
        this.events.addSplat({
            ax,
            ay,
            bx,
            by,
            t0: at,
            duration,
            radius,
            kind: SPLAT_ROUND,
            r: (color[0] * deposit) / dwell,
            g: (color[1] * deposit) / dwell,
            b: (color[2] * deposit) / dwell,
            dust: dust / dwell,
            fx: (dx * push) / dwell,
            fy: (dy * push) / dwell,
            heat: heat / dwell,
            bend,
            ease,
        }, this.eventClock);
    }

    /**
     * A piece has locked.
     * @param {{ player?: number, cells?: number[][], rows?: number[], u?: number, hardDrop?: boolean,
     *           color?: string|number, screen?: {x:number,y:number} }} c
     */
    onLock(c) {
        if (!c || !this.fluid) return;
        const at = this.eventClock;
        const { aspect, events } = this;
        const hard = c.hardDrop === true;
        const calm = this.reducedMotion ? 0.45 : 1;
        const color = pieceColor(c.color);
        this.lastColor = color;
        const { board, card, obstacles } = this.stage(c.player || 0);
        const cw = (board.x1 - board.x0) / BOARD_GRID.columns;
        const ch = (board.y1 - board.y0) / BOARD_GRID.rows;

        // The piece's cells on the board (tide space).
        const cells = [];
        if (c.screen) {
            cells.push([(c.screen.x - 0.5) * 2 * aspect, (c.screen.y - 0.5) * 2]);
        } else if (Array.isArray(c.cells) && c.cells.length) {
            for (let i = 0; i < c.cells.length && i < 6; i += 1) {
                cells.push([board.x0 + (c.cells[i][0] + 0.5) * cw, board.y0 + (c.cells[i][1] + 0.5) * ch]);
            }
        } else {
            const rows = Array.isArray(c.rows) && c.rows.length ? c.rows : [BOARD_GRID.rows - 1];
            const u = Number.isFinite(c.u) ? c.u : 0.5;
            const column = Math.max(0, Math.min(BOARD_GRID.columns - 1, Math.floor(u * BOARD_GRID.columns)));
            for (let i = 0; i < rows.length && i < 4; i += 1) {
                cells.push([board.x0 + (column + 0.5) * cw, board.y0 + (rows[i] + 0.5) * ch]);
            }
        }
        const box = this._box;
        box.x0 = Infinity;
        box.y0 = Infinity;
        box.x1 = -Infinity;
        box.y1 = -Infinity;
        let cx = 0;
        let cy = 0;
        for (let i = 0; i < cells.length; i += 1) {
            box.x0 = Math.min(box.x0, cells[i][0] - cw * 0.5);
            box.x1 = Math.max(box.x1, cells[i][0] + cw * 0.5);
            box.y0 = Math.min(box.y0, cells[i][1] - ch * 0.5);
            box.y1 = Math.max(box.y1, cells[i][1] + ch * 0.5);
            cx += cells[i][0] / cells.length;
            cy += cells[i][1] / cells.length;
        }

        // Where the echo goes: straight out of the card on the piece's own side.
        const middle = (board.x0 + board.x1) * 0.5;
        let prefer = cx < middle ? -1 : 1;
        if (Math.abs(cx - middle) < cw * 0.26) prefer = this.lockCount % 2 === 0 ? -1 : 1;
        const echo = this._echo;
        if (c.screen) {
            echo.dx = 0;
            echo.dy = 0;
            echo.nx = 0;
            echo.ny = -1;
            echo.placed = true;
        } else {
            placeEcho({
                box, card, obstacles, aspect, gap: cw * 0.7, prefer,
            }, echo);
        }
        const ex = cx + echo.dx;
        const ey = cy + echo.dy;

        // ── the echo: the piece's footprint, poured into the fluid ──
        const pour = (hard ? 2.6 : 1.9) / LOCK_POUR;
        for (let i = 0; i < cells.length; i += 1) {
            events.addSplat({
                ax: cells[i][0] + echo.dx,
                ay: cells[i][1] + echo.dy,
                t0: at,
                duration: LOCK_POUR,
                radius: cw * 0.44,
                kind: SPLAT_CELL,
                r: color[0] * pour,
                g: color[1] * pour,
                b: color[2] * pour,
                heat: hard ? 5 : 3,
            }, this.eventClock);
            // …and its outline, crisp, while the gas gathers.
            this.fx.table.cell({
                x: cells[i][0] + echo.dx,
                y: cells[i][1] + echo.dy,
                at,
                half: cw * 0.46,
                color,
                gain: hard ? 2.6 : 2,
            });
        }
        // The echo stands for a breath, then one even push carries it off whole (a push per cell
        // would shear it apart at once). A slight lean, different for every lock.
        const shove = ((hard ? 0.7 : 0.42) * calm) / ECHO_PUSH;
        const lean = (((this.lockCount * 0.618) % 1) - 0.5) * 0.7;
        const slam = hard ? (0.9 * calm) / ECHO_PUSH : 0;
        events.addSplat({
            ax: ex,
            ay: ey,
            t0: at + (hard ? 0.02 : ECHO_HOLD),
            duration: ECHO_PUSH,
            radius: Math.max(box.x1 - box.x0, box.y1 - box.y0) * 0.75,
            kind: SPLAT_ROUND,
            fx: (echo.nx - echo.ny * lean) * shove,
            fy: (echo.ny + echo.nx * lean) * shove + slam,
        }, this.eventClock);
        // Behind the glass, the piece itself breathes its colour toward the echo.
        if (echo.placed && !c.screen) {
            events.addSplat({
                ax: cx,
                ay: cy,
                t0: at,
                duration: LOCK_POUR,
                radius: cw * 1.5,
                kind: SPLAT_ROUND,
                r: color[0] * pour * 0.5,
                g: color[1] * pour * 0.5,
                b: color[2] * pour * 0.5,
                fx: (echo.nx * 0.8 * calm) / LOCK_POUR,
                fy: (echo.ny * 0.8 * calm) / LOCK_POUR,
                heat: 0.6,
            }, this.eventClock);
        }
        // A hard drop comes down from above: a streak of the piece's colour slammed into the echo.
        if (hard) {
            this.streak({
                ax: ex,
                ay: ey - 0.62,
                bx: ex,
                by: ey,
                at,
                duration: 0.13,
                radius: cw * 1.05,
                color,
                deposit: 0.5,
                push: 0.8 * calm,
                heat: 1.2,
            });
        }

        // ── the front ──
        events.addRing({
            x: ex,
            y: ey,
            t0: at,
            reach: hard ? 0.78 : 0.42,
            push: (hard ? 0.55 : 0.22) * calm,
            width: hard ? 0.04 : 0.03,
            heat: hard ? 3.2 : 1.7,
            rough: (hard ? 1.2 : 0.5) * calm,
        }, this.eventClock);

        // ── the spark, and the star it becomes ──
        const seat = this.seatFor(echo, card, obstacles, c.screen ? 0.3 : 0);
        const sx = seat.x;
        const sy = seat.y;
        const left = at + 0.07;
        const born = left + SPARK_FLIGHT;
        const bend = (this.lockCount % 2 === 0 ? 1 : -1) * 0.16;
        events.addStar({
            x: sx,
            y: sy,
            born,
            dies: born + STAR_LIFE,
            r: color[0],
            g: color[1],
            b: color[2],
            flux: hard ? 1.5 : 1,
            fromX: ex,
            fromY: ey,
            left,
            bend,
        });
        this.streak({
            ax: ex,
            ay: ey,
            bx: sx,
            by: sy,
            at: left,
            duration: SPARK_FLIGHT,
            radius: 0.028,
            color,
            deposit: 0.5,
            push: 0.3 * calm,
            heat: 1.6,
            bend,
            ease: 1,
        });

        // ── stardust ──
        this.fx.table.burst({
            x: ex,
            y: ey,
            at,
            color,
            speed: (hard ? 1.25 : 0.75) * calm,
            dirX: echo.nx,
            dirY: echo.ny + (hard ? 0.6 : 0),
            aim: 0.35,
            life: hard ? 1.25 : 0.95,
            size: hard ? 1.25 : 1,
        });

        if (hard) this.strike(0.12, 0.5, at);
        this.lockCount += 1;
    }

    /**
     * Lines have cleared.
     * @param {{ player?: number, rows?: number[], lines?: number, combo?: number, tspin?: boolean,
     *           perfect?: boolean, b2b?: boolean, screen?: {x:number,y:number} }} c
     */
    onClear(c) {
        if (!c || !this.fluid) return;
        const { aspect, events } = this;
        const lines = Math.max(1, Math.min(4, Math.round(c.lines || (c.rows?.length ?? 1))));
        const grand = lines >= 4 || c.perfect === true;
        const calm = this.reducedMotion ? 0.45 : 1;
        // A four-line clear holds its breath first.
        const at = this.eventClock + (grand ? HUSH_HOLD : 0);
        if (grand) {
            this.hushAt = this.eventClock;
            this.flareAt = at;
            this.starfireAt = at;
        }
        const { board, card } = this.stage(c.player || 0);
        const ch = (board.y1 - board.y0) / BOARD_GRID.rows;
        const rows = Array.isArray(c.rows) && c.rows.length
            ? c.rows.slice(0, 4)
            : Array.from({ length: lines }, (_, i) => BOARD_GRID.rows - 1 - i);
        let heartX = (board.x0 + board.x1) * 0.5;
        let heartY = 0;
        for (let i = 0; i < rows.length; i += 1) heartY += (board.y0 + (rows[i] + 0.5) * ch) / rows.length;
        if (c.screen) {
            heartX = (c.screen.x - 0.5) * 2 * aspect;
            heartY = (c.screen.y - 0.5) * 2;
        }
        const { shock } = this.palette;
        const fire = grand ? STARFIRE : shock;
        const span = Math.hypot(aspect, 1);

        // ── the rows leave the card as jets, one from each side ──
        if (!c.screen) {
            for (let i = 0; i < rows.length; i += 1) {
                const y = board.y0 + (rows[i] + 0.5) * ch;
                const fan = (i - (rows.length - 1) * 0.5) * 0.09;
                const lag = i * 0.035;
                for (let side = -1; side <= 1; side += 2) {
                    const from = side < 0 ? card.x0 : card.x1;
                    const to = side * (aspect + 0.25);
                    this.streak({
                        ax: from,
                        ay: y,
                        bx: to,
                        by: y + fan * Math.abs(to - from),
                        at: at + lag,
                        duration: 0.42 + 0.05 * i,
                        radius: ch * 0.62,
                        color: fire,
                        deposit: grand ? 0.75 : 0.55,
                        push: (grand ? 1.5 : 1.1) * calm,
                        heat: grand ? 4.5 : 3,
                    });
                    this.fx.table.beam({
                        x0: from, y, x1: to, at: at + lag, color: fire, thickness: ch * 0.2,
                    });
                }
            }
            // Stardust sprays out of both sides, at the middle of what was cleared.
            for (let side = -1; side <= 1; side += 2) {
                this.fx.table.burst({
                    x: side < 0 ? card.x0 : card.x1,
                    y: heartY,
                    at,
                    color: fire,
                    speed: (1.5 + 0.35 * lines) * calm,
                    dirX: side,
                    dirY: 0,
                    aim: 0.8,
                    life: 0.9 + 0.15 * lines,
                    size: 1 + 0.12 * lines,
                });
            }
        }

        // ── the front ──
        const reach = span * 1.22;
        events.addRing({
            x: heartX,
            y: heartY,
            t0: at,
            reach,
            push: (0.5 + 0.2 * lines + (grand ? 0.5 : 0)) * calm,
            width: 0.055 + 0.008 * lines,
            heat: 2.6 + 0.9 * lines + (grand ? 1.5 : 0),
            rough: (1.1 + 0.5 * lines) * calm,
        }, this.eventClock);
        if (lines >= 3) {
            events.addRing({
                x: heartX,
                y: heartY,
                t0: at + 0.16,
                reach: reach * 0.8,
                push: 0.5 * calm,
                width: 0.05,
                heat: 2.4,
                rough: 1.4 * calm,
            }, this.eventClock);
        }
        // The gas behind the board wells up and out.
        this.burst.at = at;
        this.burst.x = heartX;
        this.burst.y = heartY;
        this.burst.strength = (3.2 + 1.5 * lines) * (c.perfect ? 2.4 : 1);

        // ── every star the board has lit goes nova as the front reaches it ──
        for (let i = 0; i < STAR_SLOTS; i += 1) {
            const s = events.stars[i];
            if (s.born <= NEVER * 0.5 || s.dies <= at) continue;
            const pass = at + ringPassTime(Math.hypot(s.x - heartX, s.y - heartY), reach);
            // A star still in flight opens first, then goes.
            const when = Math.max(pass, s.born + 0.25);
            if (when < s.dies) s.dies = when;
        }

        // ── a four-line clear: the Tide Star answers ──
        if (grand) {
            const star = tideStarPosition(0, at, aspect, this._p);
            this.fx.table.burst({
                x: star.x, y: star.y, at: at + 0.05, color: STARFIRE, speed: 2.1 * calm, life: 1.9, size: 1.5,
            });
            events.addRing({
                x: star.x,
                y: star.y,
                t0: at + 0.05,
                reach: span * 1.5,
                push: 1.1 * calm,
                width: 0.075,
                heat: 4.2,
                rough: 2.2 * calm,
            }, this.eventClock);
        }
        if (c.tspin) {
            this.twist.at = at;
            this.twist.x = heartX;
            this.twist.y = heartY;
            this.twist.strength = (this.lockCount % 2 === 0 ? 1 : -1) * 4;
        }
        this.strike(0.2 + 0.12 * lines + (grand ? 0.35 : 0), 0.3 + 0.15 * lines + (grand ? 0.4 : 0), at);
    }

    /** The true combo (0 = the chain broke). */
    onCombo(n) {
        if (!this.fluid) return;
        const next = Math.max(0, Math.round(n || 0));
        const before = this.combo;
        this.combo = next;
        // One clear is not a chain: the maelstrom opens on the second.
        this.wellAim = next >= 2 ? clamp01(0.3 + 0.7 * powerForCombo(next - 1)) : 0;
        if (before >= 2 && next < 2 && this.wellOpen > 0.08) this.releaseMaelstrom();
        else if (next >= 2 && next > before) this.feedMaelstrom(next);
    }

    /** Another step of the chain: two arms of gas are drawn in from far off, and the well deepens. */
    feedMaelstrom(step) {
        const at = this.eventClock;
        const { aspect, events } = this;
        const calm = this.reducedMotion ? 0.45 : 1;
        const w = maelstromPosition(at, aspect, this._p);
        const wx = w.x;
        const wy = w.y;
        const { gasA, gasB, gasC } = this.palette;
        const arms = [this.lastColor, step % 2 === 0 ? gasB : gasC, gasA];
        const count = step >= 5 ? 3 : 2;
        for (let k = 0; k < count; k += 1) {
            const angle = step * 2.4 + k * (TAU / count) + 0.5;
            const from = 0.95 + 0.08 * k;
            this.streak({
                ax: wx + Math.cos(angle) * from,
                ay: wy + Math.sin(angle) * from,
                bx: wx,
                by: wy,
                at: at + k * 0.05,
                duration: 0.62,
                radius: 0.042,
                color: arms[k],
                deposit: 0.85,
                push: 0.45 * calm,
                heat: 1.4,
                // Bowed the way the well turns, so the arm arrives already winding.
                bend: 0.42,
            });
        }
        // The well's own pull is felt as a front running INWARD: gas is drawn a step closer.
        events.addRing({
            x: wx, y: wy, t0: at, reach: 0.55, push: -0.3 * calm, width: 0.045, heat: 1.6, rough: 0.6 * calm,
        }, this.eventClock);
        this.fx.table.burst({
            x: wx, y: wy, at, color: this.lastColor, speed: 0.9 * calm, life: 0.9, size: 0.9,
        });
        this.strike(0.06 + 0.02 * Math.min(step, 8), 0.2, at);
    }

    /** The chain broke: the maelstrom lets go of what it took. */
    releaseMaelstrom() {
        const at = this.eventClock;
        const { aspect, events } = this;
        const calm = this.reducedMotion ? 0.45 : 1;
        const open = this.wellOpen;
        const w = maelstromPosition(at, aspect, this._p);
        const wx = w.x;
        const wy = w.y;
        this.releaseAt = at;
        events.addRing({
            x: wx,
            y: wy,
            t0: at,
            reach: 1.1 + 0.7 * open,
            push: (0.6 + 0.6 * open) * calm,
            width: 0.05,
            heat: 3 + 3 * open,
            rough: 1.6 * calm,
        }, this.eventClock);
        // Two jets along its axis, in the colours it swallowed.
        const { gasB, gasC } = this.palette;
        const axis = 0.9 + at * 0.13;
        const reach = 0.7 + 0.8 * open;
        for (let side = -1; side <= 1; side += 2) {
            this.streak({
                ax: wx,
                ay: wy,
                bx: wx + Math.cos(axis) * reach * side,
                by: wy + Math.sin(axis) * reach * side,
                at,
                duration: 0.5,
                radius: 0.035,
                color: side < 0 ? gasB : gasC,
                deposit: 0.9 * open,
                push: 1.3 * open * calm,
                heat: 4,
            });
        }
        this.fx.table.burst({
            x: wx, y: wy, at, color: gasB, speed: (1.1 + 0.8 * open) * calm, life: 1.3, size: 1.2,
        });
        this.strike(0.15 + 0.25 * open, 0.3 + 0.3 * open, at);
    }

    /** The nebula changes colours. */
    levelUp(level, options) {
        if (!this.fluid) return;
        const next = Math.max(1, Math.round(level || 1));
        this.level = next;
        const index = next - 1;
        if (options?.silent) {
            this.paletteFrom = index;
            this.paletteTo = index;
            this.paletteAt = NEVER;
            this.applyPalette(1);
            return;
        }
        if (index === this.paletteTo) return;
        // If a blend is under way it restarts from what is on screen now (close enough: it eases).
        this.paletteFrom = this.paletteTo;
        this.paletteTo = index;
        this.paletteAt = this.eventClock;
        const { board } = this.stage(0);
        this.events.addRing({
            x: (board.x0 + board.x1) * 0.5,
            y: (board.y0 + board.y1) * 0.5,
            t0: this.eventClock,
            reach: Math.hypot(this.aspect, 1) * 1.2,
            push: 0.3,
            width: 0.09,
            heat: 2.2,
            rough: 0.8,
        }, this.eventClock);
        this.strike(0.2, 0.15, this.eventClock);
    }

    /** A flash and a kick for the post stack, starting at `at`. */
    strike(flash, kick, at) {
        const calm = this.reducedMotion ? 0.3 : 1;
        this.flash.at = at;
        this.flash.strength = flash * calm;
        this.kick.at = at;
        this.kick.strength = kick * calm;
    }

    /** A new run: no chain, nothing held; the nebula keeps flowing. */
    resetSession() {
        this.combo = 0;
        this.wellAim = 0;
        this.hushAt = NEVER;
    }

    getPostState() {
        const out = this._post;
        if (!this.fluid) return out;
        const { now } = this;
        const flashAge = now - this.flash.at;
        const kickAge = now - this.kick.at;
        const flare = this.flareStrength(now);
        out.flash = (flashAge >= 0 ? this.flash.strength * Math.exp(-flashAge * 3.2) : 0) + flare * 0.5;
        out.kick = kickAge >= 0 ? this.kick.strength * Math.exp(-kickAge * 5) : 0;
        out.bloomBoost = flare * 0.8 + this.wellOpen * 0.25;
        // An iris: it closes a little as the nebula flares, so the colours survive the surge.
        out.exposure = 1 - Math.min(0.42, out.flash * 0.42) - this.picture.hush.value * 0.12;
        return out;
    }

    getState() {
        if (!this.fluid) return { quality: this.quality, disposed: true };
        let stars = 0;
        const { now } = this;
        for (let i = 0; i < STAR_SLOTS; i += 1) if (this.events.starAlive(i, now)) stars += 1;
        const count = AETHER_PALETTES.length;
        return {
            quality: this.quality,
            palette: AETHER_PALETTES[((this.paletteTo % count) + count) % count].name,
            combo: this.combo,
            well: Number(this.wellOpen.toFixed(3)),
            locks: this.lockCount,
            stars,
            splats: this.events.splatCount,
            rings: this.events.ringCount,
            stolen: this.events.stolen,
            cpuMs: Number(this.cpuMs.toFixed(2)),
            fluid: this.fluid?.getState() ?? null,
        };
    }

    dispose() {
        if (this.nebula) {
            this.scene.remove(this.nebula.mesh);
            this.nebula.dispose();
        }
        if (this.stars) {
            this.scene.remove(this.stars.mesh);
            this.stars.dispose();
        }
        if (this.fx) {
            this.scene.remove(this.fx.beamMesh, this.fx.dustMesh, this.fx.cellMesh);
            this.fx.dispose();
        }
        this.light?.dispose();
        this.fluid?.dispose();
        this.noise?.dispose();
        this.nebula = null;
        this.stars = null;
        this.fx = null;
        this.light = null;
        this.fluid = null;
        this.noise = null;
    }
}
