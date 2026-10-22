/**
 * Ice Temple — the world.
 *
 * Owns the plan, the shared uniforms, every scene part, the camera rig and the choreography.
 * Shared by the theme (ice-temple-theme.js) and the playground effect
 * (src/playground/effects/ice-temple.effect.js), so what is iterated there ships.
 *
 * The temple is an instrument of ice and the board plays it:
 *
 *   lock     the piece strikes the lake under the board. A star fracture opens in the ice and
 *            heals; chips fly; a ring of light runs out through the cracks; and a shell of light
 *            climbs the columns, lighting the fracture veils inside them as it passes. A hard
 *            drop also raises a crown of ice spikes round the blow.
 *   clear    the cleared rows fire out of the card as blades of light. Then the Great Crystal at
 *            the far end answers: it flares, and a wave runs down the nave toward the viewer, one
 *            front per line — every column and rib rings as a front passes, the cracks under it
 *            burn, the aurora swells.
 *   combo    the temple resonates, in the aurora's own colours: its border, then its body, then
 *            its fringe. A standing glow climbs the columns two metres for every link of the
 *            chain (the colonnade is the counter) and at nine it reaches the ribs; the
 *            cracks stay lit further and further out from the board; the aurora doubles; diamond
 *            dust thickens; rime creeps over the lens; the snow slows, hangs, and at five rises.
 *   four     the temple holds its breath — a quarter of a second of dark, the snow still in the
 *            air — then the Great Crystal answers in diamond white with four fronts and the
 *            Great Snowflake grows round the board, holds, and shatters.
 *   T-spin   the air turns: the snow winds round the nave's axis (a T-spin that clears nothing
 *            gives it a small turn).
 *   B2B      the Great Crystal answers twice: an echo wave follows the first, in the fringe colour.
 *   perfect  (it comes ~360 ms after its clear) the crown on the answer still playing: the snow
 *            stands still in the air, the snowflake takes a halo, a diamond wave follows the last.
 *   level    the aurora changes its colours.
 *
 * And the temple builds with play (src/themes/shared/gameplay-surge.js): every answer ADDS to
 * what is still lit (Swells), and the heat of play is spent on the temple's own voice. Warm: the
 * Great Crystal's beat quickens, the aurora brightens, the diamond dust thickens. Hot: the light
 * holds in the columns and in the cracks far over the lake even between links, and the aurora
 * starts to dance. Fever: the aurora blazes and ripples fast, the colonnade burns in the aurora's
 * colours, swaying between its fringe and its body with the Great Crystal's beat, the dust is a
 * storm of glints and the rising snow turns slowly round the nave. The heat is spent on colour,
 * never on white (the crystal's light falls on every surface, so it only quickens). A quad in a
 * fever only inhales (the hush is as deep as play is cold); when the hands rest the temple
 * breathes back to its calm over a few seconds.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 *
 * Layers: 0 = everything the ice mirrors; 1 = what only the camera sees (snow, dust, mist,
 * chips, row beams).
 */

import * as THREE from 'three/webgpu';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell, softCeiling } from '../shared/gameplay-surge.js';
import {
    AURORA_PALETTES,
    CLEAR_AFTERGLOW,
    CLEAR_FRONT_GAP,
    CLEAR_SLOTS,
    CLEAR_TRAVEL,
    FLAKE_GROW,
    FLAKE_HOLD,
    FLAKE_LIFE,
    HUSH_HOLD,
    LOCK_FADE,
    LOCK_REACH,
    LOCK_SCAR,
    LOCK_SLOTS,
    NAVE,
    OVERDRIVE_COOL,
    REST_RIG,
    approach,
    clamp01,
    createNoiseTexture,
    createTempleUniforms,
    fovForAspect,
    linRGB,
    lockShellArrival,
    pieceColor,
    resonanceForCombo,
    smooth,
} from './ice-temple-tsl.js';
import { buildPlan } from './ice-temple-plan.js';
import { tierFor } from './ice-temple-quality.js';
import { createArchitecture } from './ice-temple-architecture.js';
import { createFloor } from './ice-temple-floor.js';
import { createAurora, createMountains, createSky } from './ice-temple-sky.js';
import { createDust, createMist, createSnow } from './ice-temple-atmosphere.js';
import {
    createChips, createCrown, createRowBeams, createSnowflake,
} from './ice-temple-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './ice-temple-composition.js';

export { REST_RIG, fovForAspect };

const DEG = Math.PI / 180;

/** Metres the standing glow climbs a column for every link of the chain. */
export const RESONANCE_STEP = 2.4;
/** Metres per second the snow falls at rest. */
export const SNOW_FALL = 0.85;
/** The combo at which the snow stops falling and starts to rise. */
export const SNOW_TURN = 5;
/** How far ahead of the camera the Great Snowflake stands (metres). */
export const FLAKE_DISTANCE = 13;
/** Pairs of columns, counted from the camera, that shed frost when a lock's shell reaches them. */
export const RING_PAIRS = 3;
/** The widest a hard drop's crown of spikes may stand (metres). */
export const CROWN_RADIUS_MAX = 4.6;

/** The highest the snow's lift goes: past 1 (SNOW_TURN) it rises, at most 0.7 x SNOW_FALL. */
const SNOW_LIFT_MAX = 1.7;
/**
 * How fast the snow follows the chain (per second, up / down): it slows, hangs and rises as one
 * gesture, and after a break it settles back to its fall over about two seconds.
 */
const LIFT_RISE = 1.6;
const LIFT_FALL = 0.75;
/** Radians a second the air turns round the nave in a full fever: the rising snow's vortex. */
export const FEVER_SWIRL = 0.16;
/** The Great Crystal's resting beat (radians a second of its sin^2 pulse). */
const BEAT_RATE = 2.3;
/** A back-to-back's echo leaves the Great Crystal this long after the first wave. */
export const ECHO_DELAY = 0.34;
/** A perfect clear's crowning wave leaves this long after the crown (behind the quad's fronts). */
export const CROWN_DELAY = 0.3;
/** Seconds a perfect clear's halo takes to crystallise round a snowflake already standing. */
const HALO_FADE = 0.7;
/** The arrival swell peaks ~0.26 s after its hit: hit it this long after the wave leaves. */
const ARRIVE_LEAD = CLEAR_TRAVEL * 0.85 - 0.26;

/**
 * The light the Great Crystal throws on the nave eases toward this ceiling past the knee: it
 * falls on every surface, and past here a flare only whitens the temple.
 */
const HEART_KNEE = 1.9;
const HEART_CEILING = 2.4;
/** The crystal's own glow may blaze much further (it lights nothing but itself and its images). */
const CORE_KNEE = 3.0;
const CORE_CEILING = 4.5;

/** Diamond white: what four lines, and the heart in overdrive, burn with. */
const DIAMOND = Object.freeze([0.86, 0.95, 1.0]);

const lerp = (a, b, k) => a + (b - a) * k;

const PARTS = [
    'sky', 'mountains', 'aurora', 'architecture', 'floor', 'crown', 'flake', 'mist', 'snow', 'dust', 'chips', 'beams',
];

const paletteRGB = (palette) => ({
    a: linRGB(palette.a), b: linRGB(palette.b), c: linRGB(palette.c), heart: linRGB(palette.heart),
});

export class IceTempleWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {THREE.WebGPURenderer} [params.renderer]
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     * @param {number} [params.seed]
     */
    constructor({
        scene, quality = 'High', renderer = null, capture = false, seed,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.renderer = renderer;
        this.capture = capture;
        this.plan = buildPlan(seed);
        this.root = new THREE.Group();
        this.root.name = 'IceTemple';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.noise = null;
        this.reflection = null;
        this.chips = null;
        this.crown = null;
        this.beams = null;
        this.flake = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        this.heart = { x: 0.5, y: 0.5 };
        this._camera = null;
        this._look = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._point = { x: 0.5, y: 0.5 };
        this._strike = { x: 0, z: -7 };
        this._edgeA = { x: 0, z: 0 };
        this._edgeB = { x: 0, z: 0 };
        this._ring = { x: 0, z: 0, radius: 2.4 };
        this._palette = paletteRGB(AURORA_PALETTES[0]);
        this._res = [0, 1, 0.6];
        this._post = {
            heart: this.heart, flash: 0, kick: 0, rays: 0.35, streak: 1, bloomBoost: 0, exposure: 1, frost: 0, frostTint: [0.7, 0.9, 1.0],
        };
        this._echo = [1, 1, 1];
        this._crown = [1, 1, 1];
        /**
         * Envelopes that ACCUMULATE (src/themes/shared/swell.js): every hit adds to what is still
         * lit, so a single after a quad, or a hard drop every 300 ms, lifts the light instead of
         * restarting it. A hit may be scheduled ahead (a wave reaching the camera).
         */
        this.flashSwell = new Swell({ release: 0.25, ceiling: 0.6, knee: 0.35 });
        this.kickSwell = new Swell({ release: 0.16, ceiling: 1.2, knee: 0.7 });
        /** The Great Crystal's flare as a wave leaves it. */
        this.flareSwell = new Swell({ release: 0.55, ceiling: 1.8, knee: 1.2 });
        /** A wave reaching the camera: the aurora, the dust and the rays swell as it arrives. */
        this.arriveSwell = new Swell({
            attack: 0.22, release: 0.32, ceiling: 1.6, knee: 1.0,
        });
        /** Four lines' overdrive: a second quad, or the crown, adds headroom instead of resetting it. */
        this.overdriveSwell = new Swell({
            attack: 0.08, release: OVERDRIVE_COOL, ceiling: 1.6, knee: 1.1,
        });
        /** The chain broke: the aurora sighs (never the whole temple). */
        this.exhaleSwell = new Swell({
            attack: 0.2, release: 1.1, ceiling: 1, knee: 0.8,
        });
        /** A perfect clear: the snow stands still in the air for a breath, then falls again. */
        this.stillSwell = new Swell({
            attack: 0.12, release: 1.4, ceiling: 1, knee: 0.85,
        });
        /** How hot play runs, and where it stood at the last frame. */
        this.surge = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        this.resetState(0);
    }

    /** The post flash, the camera's kick, the Great Crystal's flare and the aurora's sigh, now. */
    get flash() {
        return this.flashSwell.valueAt(this.time);
    }

    get kick() {
        return this.kickSwell.valueAt(this.time);
    }

    get flare() {
        return this.flareSwell.valueAt(this.time);
    }

    get exhale() {
        return this.exhaleSwell.valueAt(this.time);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.resonance = 0;
        this.resLevel = 0;
        this.resRadius = 0;
        this.overdrive = 0;
        this.level = 1;
        this.paletteIndex = 0;
        this.frost = 0;
        this.swirlRate = 0;
        this.swirl = 0;
        /** The snow's lift, eased: 0 falls, 1 hangs (SNOW_TURN), beyond rises. */
        this.lift = 0;
        // The snow has been falling since before the clock started.
        this.snowFall = time * SNOW_FALL;
        this.snowDrift = time * 0.42;
        /** The aurora's clock and the Great Crystal's beat: they run faster as play heats. */
        this.auroraClock = time;
        this.beatPhase = time * BEAT_RATE;
        this.hushAt = -100;
        this.hushUntil = -1;
        this.hushDepth = 1;
        this.lockCursor = 0;
        this.clearCursor = 0;
        this.lastClearSlot = 0;
        this.counts = {
            locks: 0, clears: 0, quads: 0, crowns: 0,
        };
        this.flakeBirth = -100;
        this.flakeHold = 0;
        this.flakeUntil = -1;
        this.haloOn = false;
        this.haloAt = -Infinity;
        this.flashSwell.reset();
        this.kickSwell.reset();
        this.flareSwell.reset();
        this.arriveSwell.reset();
        this.overdriveSwell.reset();
        this.exhaleSwell.reset();
        this.stillSwell.reset();
        this.surge.reset();
        this.heat.punch = 0;
        this.heat.level = 0;
        this.heat.fever = 0;
        this.heat.stage = 0;
        this.chips?.reset();
        this.crown?.reset();
        this.beams?.reset();
        this.flake?.reset();
        if (this.u) {
            for (let i = 0; i < LOCK_SLOTS; i++) this.u.lockA[i].value.set(0, 0, -100, 0);
            for (let i = 0; i < CLEAR_SLOTS; i++) this.u.clearA[i].value.set(-100, 1, 0, 0);
        }
    }

    build() {
        const noise = createNoiseTexture();
        this.noise = noise;
        this.textures.push(noise);
        const u = createTempleUniforms({ noise });
        this.u = u;
        const { tier, plan } = this;

        this.addPart('sky', createSky(u));
        this.addPart('mountains', createMountains(u));
        this.addPart('aurora', createAurora(u, tier.curtains));
        this.addPart('architecture', createArchitecture(u, plan, { veils: tier.veils }));

        const floor = createFloor(u, {
            reflectionScale: tier.reflection,
            fineCracks: tier.fineCracks,
            bubbles: tier.bubbles,
        });
        this.addPart('floor', floor);
        if (floor.reflectorTarget) this.root.add(floor.reflectorTarget);
        this.reflection = floor.reflection;

        // ── Gameplay effects (pools, always drawn) ──
        if (tier.crown) {
            this.crown = createCrown(u);
            this.addPart('crown', this.crown);
        }
        this.flake = createSnowflake(u);
        this.addPart('flake', this.flake);

        // ── The air, and what the mirror must not show ──
        if (tier.mist > 0) this.addPart('mist', createMist(u, tier.mist), { reflected: false });
        this.addPart('snow', createSnow(u, tier.snow), { reflected: false });
        this.addPart('dust', createDust(u, tier.dust), { reflected: false });
        this.chips = createChips(u, tier.shards);
        this.addPart('chips', this.chips, { reflected: false });
        this.beams = createRowBeams(u);
        this.addPart('beams', this.beams, { reflected: false });

        this.applyPalette(1);
        this.scene.add(this.root);
        return this;
    }

    addPart(name, part, { reflected = true } = {}) {
        this.parts[name] = part;
        if (!reflected || part.reflected === false) part.mesh.layers.set(1);
        this.root.add(part.mesh);
        this.disposables.push(part);
    }

    /** Draw only the named parts (captures, bisecting a look). */
    showOnlyParts(names) {
        const keep = new Set(names);
        Object.keys(this.parts).forEach((name) => {
            this.parts[name].mesh.visible = keep.has(name);
        });
    }

    setViewport(bufferWidth, bufferHeight, aspect) {
        if (this.u && bufferWidth > 0 && bufferHeight > 0) this.u.viewport.value.set(bufferWidth, bufferHeight);
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
        if (!this.layoutLive) this.layout = fallbackLayout(this.aspect * 1000, 1000);
    }

    /**
     * The live board / card / HUD rects (screen fractions), or null when no board is on screen:
     * events then aim at where the solo board would be.
     */
    setLayout(rects, aspect) {
        if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(this.aspect * 1000, 1000);
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Jump the clock (captures): drops every event in flight. */
    seek(time) {
        this.resetState(Math.max(0, time));
        this.applyPalette(1);
    }

    /**
     * A new run: the temple back at rest (the snow keeps falling where it was and eases back to
     * its fall; the aurora and the Great Crystal keep their phase).
     */
    resetSession() {
        const {
            time, snowFall, snowDrift, swirl, lift, auroraClock, beatPhase,
        } = this;
        this.resetState(time);
        this.snowFall = snowFall;
        this.snowDrift = snowDrift;
        this.swirl = swirl;
        this.lift = lift;
        this.auroraClock = auroraClock;
        this.beatPhase = beatPhase;
        this.applyPalette(1);
    }

    /**
     * The camera sees layer 1 (snow, effects); the ice's mirror must not. Called once the camera
     * that will render the world is known.
     */
    bindCamera(camera) {
        camera.layers.enable(1);
        if (this.reflection) {
            const mirror = this.reflection.reflector.getVirtualCamera(camera);
            mirror.layers.set(0);
        }
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        const calm = this.reducedMotion ? 0 : 1;
        const fov = fovForAspect(this.aspect) - this.kick * 0.8 * calm;
        if (Math.abs(camera.fov - fov) > 1e-3 || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // A slow walk on the spot: the near columns slide against the far ones.
        const swayX = (Math.sin(t * 0.071) * 0.85 + Math.sin(t * 0.033 + 1.3) * 0.45) * calm;
        const swayZ = (Math.sin(t * 0.047 + 2.0) * 1.5 + Math.sin(t * 0.021) * 0.7) * calm;
        const swayY = (Math.sin(t * 0.093 + 0.7) * 0.1 + Math.sin(t * 0.051) * 0.06) * calm;
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        camera.position.set(
            REST_RIG.x + swayX + px * 0.8,
            REST_RIG.height + swayY - py * 0.25 - this.kick * 0.06 * calm,
            REST_RIG.z + swayZ,
        );
        // It keeps looking up the nave, so the Great Crystal stays behind the board.
        const yaw = (-swayX * 0.006 - px * 0.03) * calm;
        const pitch = REST_RIG.pitch + (Math.sin(t * 0.061) * 0.005 - py * 0.02) * calm;
        this._look.set(
            camera.position.x + Math.sin(yaw) * 10,
            camera.position.y + Math.tan(pitch) * 10,
            camera.position.z - 10,
        );
        camera.up.set(Math.sin(t * 0.043) * 0.004 * calm, 1, 0);
        camera.lookAt(this._look);
        // The shared breath (shared/camera-breath.js) on top of the walk above: the view is
        // aimed up the nave, not at a point, so it only turns. Off under reduced motion.
        applyCameraBreath(camera, t, { scale: this.reducedMotion ? 0 : 1 });
        camera.updateMatrixWorld();
        this._camera = camera;
        if (this.u) this.u.projScale.value = 0.5 / Math.tan((camera.fov * DEG) / 2);
        // The Great Crystal on screen: where the rays come from.
        this._ray.set(0, NAVE.heartY + 3, NAVE.heartZ).project(camera);
        this.heart.x = clamp01(this._ray.x * 0.5 + 0.5);
        this.heart.y = clamp01(0.5 - this._ray.y * 0.5);
    }

    /**
     * Where a ray through a screen point (fractions, y down) meets the ice. Points above the
     * horizon (or absurdly far) land `far` metres ahead instead.
     */
    screenToIce(sx, sy, out = this._strike, far = 9) {
        const camera = this._camera;
        if (!camera) {
            out.x = 0;
            out.z = REST_RIG.z - far;
            return out;
        }
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position);
        const t = this._ray.y < -1e-4 ? -camera.position.y / this._ray.y : Infinity;
        const dist = Math.hypot(this._ray.x, this._ray.z) * t;
        if (!Number.isFinite(dist) || dist > 45) {
            const flat = Math.hypot(this._ray.x, this._ray.z) || 1;
            out.x = camera.position.x + (this._ray.x / flat) * far;
            out.z = camera.position.z + (this._ray.z / flat) * far;
            return out;
        }
        out.x = camera.position.x + this._ray.x * t;
        out.z = camera.position.z + this._ray.z * t;
        return out;
    }

    /** The horizon on screen (fraction from the top). */
    horizonY() {
        const camera = this._camera;
        if (!camera) return 0.6;
        this._ray.set(camera.position.x, 0, camera.position.z - 4000).project(camera);
        return clamp01(0.5 - this._ray.y * 0.5);
    }

    // ── Gameplay ────────────────────────────────────────────────────────────────

    /**
     * A piece locked. `u` = its column as a fraction of the board width, `color` = the piece's
     * colour; `screen` (fractions) replaces the board point. Wherever on the board it locked, it
     * strikes the ice under the board's foot: that is where the lake is.
     */
    onLock({
        u = 0.5, hardDrop = false, color = null, player = 0, screen = null,
    } = {}) {
        const { u: uniforms } = this;
        if (!uniforms) return;
        const horizon = this.horizonY();
        let sx = 0.5;
        let sy = 0.93;
        if (screen) {
            sx = screen.x;
            sy = Math.max(screen.y, horizon + 0.1);
        } else {
            const board = boardFor(this.layout, player);
            if (board) {
                boardPoint(board, u, 19, this._point);
                sx = this._point.x;
                sy = Math.max(board.y1, horizon + 0.08);
            }
        }
        const strike = this.screenToIce(sx, sy);
        const slot = this.lockSlot();
        this.lockCursor += 1;
        const rgb = pieceColor(color, AURORA_PALETTES[this.paletteIndex].b);
        const strength = hardDrop ? 1.3 : 0.8;
        uniforms.lockA[slot].value.set(strike.x, strike.z, this.time, strength);
        uniforms.lockC[slot].value.set(rgb[0] * 1.5, rgb[1] * 1.5, rgb[2] * 1.5);
        this.kickSwell.hit(hardDrop ? 0.55 : 0.14, this.time);
        // Frame-wide: under a quick hand a lock's flash folds into the glow the heat holds.
        this.flashSwell.hit((hardDrop ? 0.12 : 0.03) * (1 - 0.6 * this.heat.level), this.time);
        this.surge.lock({ hardDrop }, this.time);
        // Chips of ice jump out of the blow.
        const share = this.chips.count / 384;
        this.chips.emit({
            x: strike.x,
            z: strike.z,
            n: Math.round((hardDrop ? 34 : 16) * share),
            rgb,
            time: this.time,
            spread: hardDrop ? [5, 15] : [3.5, 11],
            up: hardDrop ? [2, 7.5] : [1.4, 4.8],
            life: hardDrop ? [0.9, 1.7] : [0.7, 1.3],
            size: hardDrop ? 0.05 : 0.04,
        });
        this.ringColumns(strike, rgb, hardDrop, share);
        if (hardDrop && this.crown) {
            const ring = this.crownRing(strike, sy);
            this.crown.raise(ring.x, ring.z, rgb, this.time, ring.radius);
            this.counts.crowns += 1;
        }
        this.counts.locks += 1;
    }

    /**
     * The lock slot with the least light left in it (its ring, its fracture and its frost):
     * an empty one first, never a fracture still healing while one has healed.
     */
    lockSlot() {
        const t = this.time;
        let best = 0;
        let least = Infinity;
        for (let i = 0; i < LOCK_SLOTS; i++) {
            const A = this.u.lockA[i].value;
            const age = Math.max(0, t - A.z);
            const left = A.w > 0
                ? A.w * (Math.exp(-age * LOCK_FADE) + Math.exp(-age * 0.75) + 0.42 * Math.exp((-age * 3) / LOCK_SCAR))
                : 0;
            if (left < least) {
                least = left;
                best = i;
            }
        }
        return best;
    }

    /**
     * The clear slot with the least light left: a spent one first; of the waves still running
     * down the nave, the oldest; of the spent ones, the faintest afterglow.
     */
    clearSlot() {
        const t = this.time;
        let best = 0;
        let least = Infinity;
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            const A = this.u.clearA[i].value;
            const age = t - A.x;
            let left = 0;
            if (A.z > 0) {
                left = age < CLEAR_TRAVEL + CLEAR_FRONT_GAP * 4
                    ? A.z * (10 + CLEAR_TRAVEL - age)
                    : A.z * Math.exp(-(age - CLEAR_TRAVEL) / CLEAR_AFTERGLOW);
            }
            if (left < least) {
                least = left;
                best = i;
            }
        }
        return best;
    }

    /** A wave down the nave from the Great Crystal, born at `birth`, in the freest slot. */
    sendWave(birth, fronts, strength, rgb, diamond) {
        const slot = this.clearSlot();
        this.lastClearSlot = slot;
        this.u.clearA[slot].value.set(birth, fronts, strength, diamond);
        this.u.clearC[slot].value.set(rgb[0] * 1.3, rgb[1] * 1.3, rgb[2] * 1.3);
        return slot;
    }

    /**
     * The nearest columns ring as the lock's shell reaches them: each sheds a little frost at
     * its foot, at the moment the shell arrives (the chips are staged with their birth in the
     * future).
     */
    ringColumns(strike, rgb, hardDrop, share) {
        const per = Math.max(1, Math.round((hardDrop ? 6 : 3) * share));
        for (let k = 0; k < RING_PAIRS; k++) {
            const z = NAVE.firstZ - k * NAVE.bay;
            for (let side = -1; side <= 1; side += 2) {
                const x = side * NAVE.halfWidth;
                const reach = Math.hypot(x - strike.x, z - strike.z);
                if (reach >= LOCK_REACH * 0.9) continue;
                this.chips.emit({
                    x: x - side * NAVE.columnRadius * 1.5,
                    z,
                    n: per,
                    rgb,
                    time: this.time + lockShellArrival(reach),
                    spread: [0.8, 3.6],
                    up: [1.6, 5],
                    life: [0.7, 1.4],
                    size: 0.04,
                    y: 0.6,
                });
            }
        }
    }

    /**
     * Where a hard drop's crown stands: a ring round the foot of the card (anything raised
     * under the card itself would be hidden by it), drawn toward the blow so the side the
     * piece fell on shows more of it.
     */
    crownRing(strike, sy) {
        const ring = this._ring;
        const card = cardUnion(this.layout);
        if (!card || !this._camera) {
            ring.x = strike.x;
            ring.z = strike.z;
            ring.radius = 2.4;
            return ring;
        }
        const left = this.screenToIce(card.x0, sy, this._edgeA);
        const right = this.screenToIce(card.x1, sy, this._edgeB);
        const cx = (left.x + right.x) / 2;
        const cz = (left.z + right.z) / 2;
        ring.radius = Math.max(1.7, Math.min(CROWN_RADIUS_MAX, Math.hypot(right.x - left.x, right.z - left.z) * 0.61));
        ring.x = cx + (strike.x - cx) * 0.5;
        ring.z = cz + (strike.z - cz) * 0.5;
        return ring;
    }

    /**
     * Lines cleared. `lines` 1..4, `rows` = the visible rows that went, `tspin`, `perfect`,
     * `b2b`, `cascade` (this wave's depth), `combo`. The wave is a little stronger the longer the
     * chain the temple is already holding, and a cascade's waves build on each other: each deeper
     * wave burns whiter and brighter, rings with one more front and flares the crystal harder.
     */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, b2b = false, cascade = 1, combo = 0, player = 0,
    } = {}) {
        const { u: uniforms } = this;
        if (!uniforms) return;
        const n = Math.max(1, Math.min(4, Math.round(lines)));
        const quad = n >= 4 || perfect;
        const depth = Math.max(1, Math.min(10, Math.round(Number(cascade) || 1)));
        const deeper = depth - 1;
        const palette = this._palette;
        let rgb;
        if (quad) {
            // Diamond white; in a fever the wave carries the aurora's colours down the nave too
            // (the crystal itself blazes white: the light it sends keeps the temple coloured).
            const tint = 0.5 * this.heat.fever;
            rgb = DIAMOND.map((c, k) => c + (this._res[k] - c) * tint);
        } else {
            // One line: the aurora's border. Two: its body. Three: both at once, nearly white.
            const src = n === 1 ? palette.a : palette.b;
            rgb = n === 3 ? [0, 1, 2].map((c) => palette.a[c] + palette.b[c] + 0.3) : [...src];
            const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
            rgb = rgb.map((c) => (c / peak) * 0.88 + 0.12);
            if (deeper > 0) {
                const white = Math.min(0.6, 0.17 * deeper);
                rgb = rgb.map((c, k) => c + (DIAMOND[k] - c) * white);
            }
        }
        const strength = Math.min(
            1.7,
            0.62 + 0.12 * n + 0.04 * Math.min(8, this.combo) + (quad ? 0.25 : 0) + 0.09 * Math.min(4, deeper),
        );
        const birth = quad ? this.time + HUSH_HOLD : this.time;
        const fronts = perfect ? 4 : Math.min(4, n + Math.max(0, depth - 2));
        this.sendWave(birth, fronts, strength, rgb, quad ? 1 : 0);
        this.clearCursor += 1;
        // The Great Crystal flares as the wave leaves it; the wave reaches the camera
        // CLEAR_TRAVEL seconds later. Every hit adds to what is still lit.
        this.flareSwell.hit(Math.min(1.3, 0.7 + 0.2 * n) + 0.12 * Math.min(4, deeper), birth);
        const kick = 0.28 + 0.13 * n + 0.05 * Math.min(4, deeper);
        this.kickSwell.hit(kick, birth + CLEAR_TRAVEL * 0.93);
        this.flashSwell.hit(kick * 0.5 * (1 - 0.5 * this.heat.level), birth + CLEAR_TRAVEL * 0.93);
        this.arriveSwell.hit(0.45 + 0.2 * n + 0.1 * Math.min(4, deeper), birth + ARRIVE_LEAD);
        if (b2b) this.echo(birth, fronts, strength, n);
        if (quad) {
            // The temple holds its breath: fully from cold; the hotter play already runs, the
            // shallower, so a quad in a fever inhales instead of going dark.
            this.hushAt = this.time;
            this.hushUntil = this.time + HUSH_HOLD;
            this.hushDepth = 1 - 0.8 * this.heat.level;
            this.overdriveSwell.hit(perfect ? 1.3 : 1, birth);
            this.counts.quads += 1;
            // The Great Snowflake grows round the board (with its halo for a perfect clear).
            this.callFlake(birth + 0.05, perfect);
        }
        if (tspin && !this.reducedMotion) this.swirlRate = Math.max(this.swirlRate, 2.6);
        this.surge.clear({
            lines: n, cascade: depth, combo, tspin, perfect, b2b,
        }, birth);
        this.counts.clears += 1;

        // The cleared rows fire out of the board.
        const board = boardFor(this.layout, player);
        const card = cardUnion(this.layout);
        if (board && card && this.layoutLive) {
            const list = Array.isArray(rows) && rows.length ? rows : Array.from({ length: n }, (_, i) => 19 - i);
            const ys = [];
            for (let i = 0; i < list.length && i < 4; i++) ys.push(boardPoint(board, 0.5, list[i], this._point).y);
            this.beams.fire(ys, card.x0, card.x1, rgb, this.time, Math.min(1.4, 0.7 + 0.18 * n));
        }
    }

    /**
     * Back-to-back: the Great Crystal answers twice. An echo of the wave follows it down the
     * nave in the aurora's fringe colour, and the crystal flares again as the echo leaves.
     */
    echo(birth, fronts, strength, n) {
        const { c } = this._palette;
        const peak = Math.max(c[0], c[1], c[2], 1e-4);
        const rgb = this._echo;
        for (let k = 0; k < 3; k++) rgb[k] = (c[k] / peak) * 0.8 + 0.2;
        const at = birth + ECHO_DELAY;
        this.sendWave(at, fronts, Math.min(1.5, strength * 0.9), rgb, 0);
        this.flareSwell.hit(0.55, at);
        this.kickSwell.hit(0.2 + 0.08 * n, at + CLEAR_TRAVEL * 0.93);
        this.arriveSwell.hit(0.35 + 0.12 * n, at + ARRIVE_LEAD);
    }

    /**
     * The Great Snowflake, called at `at`. One already standing is never restarted: another
     * four-line clear holds it up longer, a perfect clear's halo crystallises round it. Only a
     * flake that has begun to break, or none, is called anew.
     */
    callFlake(at, crowned) {
        const age = at - this.flakeBirth;
        if (age >= 0 && age < FLAKE_GROW + FLAKE_HOLD + this.flakeHold) {
            // Standing: keep most of a hold ahead of it.
            const hold = age + FLAKE_HOLD * 0.8 - FLAKE_GROW - FLAKE_HOLD;
            this.flakeHold = Math.min(FLAKE_HOLD * 3, Math.max(this.flakeHold, hold));
            this.flake.setHold(this.flakeHold);
            if (crowned && !this.haloOn) {
                this.haloOn = true;
                this.haloAt = at;
            }
        } else {
            this.flakeBirth = at;
            this.flakeHold = 0;
            this.haloOn = crowned;
            this.haloAt = -Infinity;
            this.flake.launch(at, 1, crowned ? 2 : 1);
        }
        this.flakeUntil = this.flakeBirth + FLAKE_LIFE + this.flakeHold;
    }

    /**
     * A perfect clear settled after its clear (physics sends it ~360 ms after the last wave):
     * the crown on the answer still playing, never a second hush or a second quad. The snow
     * stands still in the air for a breath; the Great Snowflake takes its halo (or is called,
     * haloed, if none stands); a diamond wave follows the last down the nave; the Great Crystal
     * flares and the overdrive gains headroom.
     */
    onCrown() {
        if (!this.u) return;
        const at = this.time;
        const leaves = at + CROWN_DELAY;
        this.stillSwell.hit(1, at);
        this.callFlake(at + 0.05, true);
        // The crowning wave rings in the aurora's colours, lit toward diamond.
        const rgb = this._crown;
        for (let k = 0; k < 3; k++) rgb[k] = this._res[k] + (DIAMOND[k] - this._res[k]) * 0.3;
        this.sendWave(leaves, 4, 1.15, rgb, 1);
        this.flareSwell.hit(0.9, leaves);
        this.overdriveSwell.hit(0.45, at);
        this.kickSwell.hit(0.5, leaves + CLEAR_TRAVEL * 0.93);
        this.flashSwell.hit(0.22, leaves + CLEAR_TRAVEL * 0.93);
        this.arriveSwell.hit(0.45, leaves + ARRIVE_LEAD);
        this.surge.crown(at);
    }

    /** A T-spin that cleared nothing: the air gives a small turn and the Great Crystal glints. */
    onSpin() {
        if (!this.u) return;
        if (!this.reducedMotion) this.swirlRate = Math.max(this.swirlRate, 1.1);
        this.flareSwell.hit(0.3, this.time);
        this.kickSwell.hit(0.12, this.time);
        this.surge.spin(this.time);
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        // The chain broke: the aurora lets its breath go (a sigh, never a blackout; the hotter
        // play ran, the lighter it is, as the light drains from the columns with the heat).
        if (n === 0 && this.combo >= 2) {
            this.exhaleSwell.hit(Math.min(1, this.combo / 6) * (1 - 0.75 * this.heat.level), this.time);
        }
        this.combo = n;
    }

    /** A new level: the aurora changes its colours. */
    levelUp(level, { silent = false } = {}) {
        this.level = Math.max(1, Math.round(Number(level) || 1));
        this.paletteIndex = (this.level - 1) % AURORA_PALETTES.length;
        if (silent) this.applyPalette(1);
        else {
            this.flareSwell.hit(0.7, this.time);
            this.flashSwell.hit(0.16, this.time);
            this.surge.levelUp(this.time);
        }
    }

    /** Ease the live palette toward the level's (k = 1 snaps). */
    applyPalette(k) {
        const target = paletteRGB(AURORA_PALETTES[this.paletteIndex]);
        const p = this._palette;
        for (let c = 0; c < 3; c++) {
            p.a[c] += (target.a[c] - p.a[c]) * k;
            p.b[c] += (target.b[c] - p.b[c]) * k;
            p.c[c] += (target.c[c] - p.c[c]) * k;
            p.heart[c] += (target.heart[c] - p.heart[c]) * k;
        }
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;
        const calm = this.reducedMotion ? 0 : 1;

        // ── How hot play runs: the acts the temple stages ──
        const heat = this.surge.sample(t);
        this.heat.punch = heat.punch;
        this.heat.level = heat.level;
        this.heat.fever = heat.fever;
        this.heat.stage = heat.stage;
        const F = heat.fever;
        // The temple takes notice (warm), plays with the player (hot), sings (fever = F).
        const warm = smooth(0.15, 0.5, heat.level);
        const hot = smooth(0.45, 0.85, heat.level);

        // ── The resonance (the chain), over a floor the heat holds: after a break in hot play
        // the light drains from the columns and the cracks with the heat, not in a second ──
        const target = Math.max(resonanceForCombo(this.combo), hot * 0.5 + F * 0.3);
        this.resonance += (target - this.resonance) * approach(target > this.resonance ? 2.6 : 0.9, dt);
        const levelTarget = Math.max(Math.min(this.combo, 12) * RESONANCE_STEP, hot * 12 + F * 14);
        this.resLevel += (levelTarget - this.resLevel) * approach(levelTarget > this.resLevel ? 3.2 : 1.1, dt);
        const chainRadius = this.combo > 0 ? Math.min(70, 6 + this.combo * 6) : 0;
        const radiusTarget = Math.max(chainRadius, warm * 8 + hot * 22 + F * 36);
        this.resRadius += (radiusTarget - this.resRadius) * approach(radiusTarget > this.resRadius ? 2.4 : 1.0, dt);

        // ── Envelopes (Swells: every hit added to what is still lit) ──
        // The temple stays lit for as long as the snowflake stands.
        const flakeUp = t >= this.flakeBirth && t < this.flakeUntil - 1.2;
        this.overdrive = Math.max(this.overdriveSwell.valueAt(t), flakeUp ? 0.3 : 0);
        const { flare, exhale } = this;
        const arrive = this.arriveSwell.valueAt(t);
        const still = Math.min(1, this.stillSwell.valueAt(t));
        // The hush: in over a breath, held, let go; as deep as play was cold when the quad came.
        const hushAge = t - this.hushAt;
        const hush = hushAge >= 0 && hushAge < HUSH_HOLD + 0.1
            ? smooth(0, 0.04, hushAge) * (1 - smooth(HUSH_HOLD - 0.02, HUSH_HOLD + 0.08, hushAge)) * this.hushDepth
            : 0;
        this.applyPalette(approach(0.9, dt));

        // ── The snow ──
        // It slows as the chain builds, hangs at SNOW_TURN, and rises beyond it, following an
        // eased lift (never the raw combo: a chain that breaks lets it settle back over a couple
        // of seconds); a hush, or a perfect clear, holds it still in the air.
        const liftTarget = Math.min(SNOW_LIFT_MAX, this.combo / SNOW_TURN + this.overdrive * 0.9);
        const liftRate = liftTarget > this.lift ? LIFT_RISE : LIFT_FALL;
        const eased = approach(liftRate, dt);
        // The lift's mean over this frame (exact for the approach), so any frame rate falls alike.
        const meanLift = dt > 0 ? liftTarget + (this.lift - liftTarget) * (eased / (liftRate * dt)) : this.lift;
        this.lift += (liftTarget - this.lift) * eased;
        const held = (1 - hush) * (1 - still);
        const fall = this.reducedMotion ? SNOW_FALL : SNOW_FALL * (1 - meanLift) * held;
        this.snowFall += fall * dt;
        this.snowDrift += (0.42 + this.overdrive * 0.5 + F * 0.25 * calm) * held * dt;
        // A T-spin turns the air; in a fever it turns slowly round the nave on its own, and the
        // rising snow becomes a vortex.
        this.swirlRate *= Math.exp(-dt / 1.1);
        this.swirl += Math.max(this.swirlRate, F * FEVER_SWIRL * calm) * (1 - still) * dt;

        // ── The aurora dances faster, and the Great Crystal beats faster, as play heats ──
        this.auroraClock += dt * (1 + (warm * 0.25 + hot * 0.45 + F * 1.3) * (this.reducedMotion ? 0.3 : 1));
        this.beatPhase += dt * (BEAT_RATE + warm * 0.6 + hot * 0.7 + F * 1.0);
        const beat = (this.resonance * 0.22 + F * 0.12) * Math.sin(this.beatPhase) ** 2;

        // ── Uniforms ──
        u.time.value = t;
        u.auroraClock.value = this.auroraClock;
        u.ambient.value = 1 - hush * 0.84;
        // The heat is spent on colour, not on white: the aurora blazes, the colonnade's standing
        // glow burns in its colours. The Great Crystal is two things: its own glow (the crystal,
        // and its image in the facets and the lake), which may blaze diamond white; and the light
        // it throws on every surface and into the mist, which only quickens, eases under a
        // ceiling and keeps the aurora's colours, so a blazing crystal stands in a coloured
        // temple with real darks instead of whitening it.
        u.auroraGain.value = (1 + this.resonance * 0.95 + warm * 0.25 + hot * 0.6 + F * 2.4
            + this.overdrive * 0.9 + arrive * 0.6) * (1 - exhale * 0.35) * (1 - hush * 0.88);
        // (Under a quick hand each clear's flare is a smaller share: the held glow carries it.)
        u.heartPower.value = lerp(
            softCeiling(
                1 + this.resonance * 0.6 + warm * 0.15 + hot * 0.3 + F * 0.6 + this.overdrive * 1.4
                    + flare * (1 - 0.3 * heat.level) + beat,
                CORE_KNEE,
                CORE_CEILING,
            ),
            0.06,
            hush,
        );
        // (While the crystal blazes in overdrive it throws no more light than before: less of
        // each flare reaches the nave, which keeps its darks.)
        u.lightPower.value = lerp(
            softCeiling(
                1 + this.resonance * 0.6 + warm * 0.08 + hot * 0.1 + F * 0.15
                    + flare * (1 - 0.4 * heat.level) * (1 - 0.5 * Math.min(1, this.overdrive)) + beat,
                HEART_KNEE,
                HEART_CEILING,
            ),
            0.06,
            hush,
        );
        // (The overdrive's diamond takes over from the fever's colour: never both at full.)
        const voice = 1 + (hot * 0.3 + F * 0.9) * (1 - 0.8 * Math.min(1, this.overdrive));
        u.resonance.value = this.resonance * voice * (1 - hush);
        u.resLevel.value = this.resLevel;
        u.resRadius.value = this.resRadius;
        u.snowFall.value = this.snowFall;
        u.snowDrift.value = this.snowDrift;
        u.swirl.value = this.swirl;
        // The diamond dust thickens to a storm of glints, never to a fog.
        u.dustGain.value = softCeiling(
            1 + this.resonance * 1.9 + warm * 0.5 + hot * 0.8 + F * 2.4 + this.overdrive * 1.0 + arrive * 2.2,
            4.5,
            6.5,
        ) * (1 - hush * 0.8);
        const p = this._palette;
        u.auroraA.value.set(p.a[0], p.a[1], p.a[2]);
        u.auroraB.value.set(p.b[0], p.b[1], p.b[2]);
        u.auroraC.value.set(p.c[0], p.c[1], p.c[2]);
        // In overdrive the crystal burns white: diamond light, the colour of nothing but ice; in
        // a fever it is already on its way there.
        const white = clamp01(this.overdrive * 0.75);
        const diamond = clamp01(white + F * 0.35);
        const heartPeak = Math.max(p.heart[0], p.heart[1], p.heart[2], 1e-4);
        u.heartColor.value.set(
            (p.heart[0] / heartPeak) * (1 - diamond) + DIAMOND[0] * diamond,
            (p.heart[1] / heartPeak) * (1 - diamond) + DIAMOND[1] * diamond,
            (p.heart[2] / heartPeak) * (1 - diamond) + DIAMOND[2] * diamond,
        );
        // The resonance climbs the aurora's own spectrum: its border colour, then its body, then
        // the fringe high above. (A warm light inside blue ice mixes to grey: these stay ice.) In
        // a fever it sways between the fringe and the body with the Great Crystal's beat: the
        // colonnade sings in the aurora's colours.
        const k1 = smooth(0.22, 0.6, this.resonance);
        const sway = F * 0.5 * (0.5 + 0.5 * Math.sin(this.beatPhase * 0.37));
        const k2 = smooth(0.64, 0.93, this.resonance) * (1 - sway);
        for (let c = 0; c < 3; c++) {
            const mid = p.a[c] + (p.b[c] - p.a[c]) * k1;
            const top = mid + (p.c[c] - mid) * k2;
            this._res[c] = top + (DIAMOND[c] - top) * white * 0.15;
        }
        // Keep the resonance as bright as its brightest channel was: the fringe is a dark violet.
        const resPeak = Math.max(this._res[0], this._res[1], this._res[2], 1e-4);
        for (let c = 0; c < 3; c++) this._res[c] = (this._res[c] / resPeak) * 0.94 + 0.06;
        u.resColor.value.set(this._res[0], this._res[1], this._res[2]);
        // The light the crystal throws: its resting colour at rest; as play heats, and above all
        // while it blazes in overdrive, it carries the resonance (the aurora's colours) instead.
        const carry = clamp01(hot * 0.15 + F * 0.35 + Math.min(1, this.overdrive) * 0.6);
        u.lightColor.value.set(
            lerp(p.heart[0] / heartPeak, this._res[0], carry),
            lerp(p.heart[1] / heartPeak, this._res[1], carry),
            lerp(p.heart[2] / heartPeak, this._res[2], carry),
        );

        // A perfect clear's halo crystallises round a snowflake already standing.
        this.flake.setLayers(1 + (this.haloOn ? clamp01((t - this.haloAt) / HALO_FADE) : 0));

        // Where the board stands on the ice, and where the snowflake hangs.
        if (camera) {
            const board = boardFor(this.layout, 0);
            const horizon = this.horizonY();
            const fx = board ? (board.x0 + board.x1) / 2 : 0.5;
            const foot = this.screenToIce(fx, Math.max(board ? board.y1 : 0.93, horizon + 0.08));
            u.focus.value.set(foot.x, foot.z);
            this.placeFlake(camera);
        }

        // ── Post ──
        // Rime creeps over the lens as the chain holds; it frames the view, it never veils it.
        const frostTarget = smooth(0.35, 1.0, this.resonance) * 0.6 + Math.min(1, this.overdrive) * 0.08;
        this.frost += (Math.min(1, frostTarget) - this.frost) * approach(frostTarget > this.frost ? 1.6 : 0.7, dt);
        const post = this._post;
        post.flash = this.flash;
        // The punch of play rides under the kick (the lens fringe): rapid hits hold it up.
        post.kick = this.kick + heat.punch * 0.12 * (this.reducedMotion ? 0.3 : 1);
        // The rays are a veil over the whole frame: a flare may thicken them, never white it out.
        // (Thinner while the crystal blazes: the rays drag its bloom over the whole frame.)
        post.rays = lerp(
            Math.min(0.7, 0.3 + this.resonance * 0.16 + F * 0.04 + flare * 0.16 + arrive * 0.3)
                * (1 - 0.35 * Math.min(1, this.overdrive)),
            0.03,
            hush,
        );
        post.streak = lerp(1 + this.overdrive * 0.45 + this.resonance * 0.2 + F * 0.1, 0.2, hush);
        post.bloomBoost = this.overdrive * 0.04 + arrive * 0.12 + flare * 0.05 + F * 0.04;
        // The iris closes as the temple flares and as play heats, so its colours survive the
        // surge and the night between the columns stays deep.
        post.exposure = 1 / (1 + this.overdrive * 0.8 + arrive * 0.3 + this.resonance * 0.22 + flare * 0.2
            + warm * 0.04 + hot * 0.08 + F * 0.14);
        post.frost = this.reducedMotion ? 0 : this.frost;
        post.frostTint[0] = 0.62 + this._res[0] * 0.2;
        post.frostTint[1] = 0.82 + this._res[1] * 0.1;
        post.frostTint[2] = 0.94 + this._res[2] * 0.06;
    }

    /**
     * The Great Snowflake hangs FLAKE_DISTANCE metres out, centred on the board, tall enough for
     * its arms to reach well past the card on every side.
     */
    placeFlake(camera) {
        const card = cardUnion(this.layout);
        const cx = card ? (card.x0 + card.x1) / 2 : 0.5;
        const cy = card ? (card.y0 + card.y1) / 2 : 0.5;
        this._ray.set(cx * 2 - 1, 1 - cy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        const halfHeight = FLAKE_DISTANCE * Math.tan((camera.fov * DEG) / 2);
        const radius = halfHeight * Math.min(1.5, Math.max(0.9, this.aspect * 0.95));
        this.flake.uniforms.place.value.set(
            camera.position.x + this._ray.x * FLAKE_DISTANCE,
            camera.position.y + this._ray.y * FLAKE_DISTANCE,
            camera.position.z + this._ray.z * FLAKE_DISTANCE,
            radius,
        );
        const r = this._res;
        const tint = this.flake.uniforms.tint.value;
        tint.set(0.62 + r[0] * 0.3, 0.86 + r[1] * 0.1, 0.96 + r[2] * 0.04);
    }

    /** What the post stack reads each frame (a reused object). */
    getPostState() {
        return this._post;
    }

    getState() {
        return {
            quality: this.quality,
            time: this.time,
            combo: this.combo,
            resonance: this.resonance,
            resLevel: this.resLevel,
            resRadius: this.resRadius,
            overdrive: this.overdrive,
            heat: { ...this.heat },
            lift: this.lift,
            level: this.level,
            palette: AURORA_PALETTES[this.paletteIndex].name,
            counts: { ...this.counts },
            hush: this.time < this.hushUntil,
            flake: this.time < this.flakeUntil,
            snowFall: this.snowFall,
            swirl: this.swirl,
            frost: this.frost,
            layoutLive: this.layoutLive,
            heart: { ...this.heart },
            columns: this.plan.columns.length,
            ribs: this.plan.ribs.length,
            icicles: this.plan.icicles.length,
            crystals: this.plan.crystals.length,
            triangles: this.parts.architecture?.triangles ?? 0,
            reflection: this.tier.reflection,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scene?.remove(this.root);
        this.disposables.forEach((part) => {
            part.geometry?.dispose?.();
            part.material?.dispose?.();
            part.dispose?.();
        });
        this.reflection?.dispose?.();
        this.textures.forEach((tex) => tex.dispose());
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.reflection = null;
        this.chips = null;
        this.crown = null;
        this.beams = null;
        this.flake = null;
        this.noise = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as ICE_TEMPLE_PARTS };
