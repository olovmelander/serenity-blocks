/**
 * Starlight — the world: a dark-sky night over a mirror, and the board that writes the sky.
 *
 * Builds the parts (the sky and its mirror, the stars, the figures, the streaks), owns the
 * scene's state and writes it to the shared uniforms once a frame. The gameplay arrives already
 * resolved by the director:
 *
 *   onLock   a mote in the piece's colour leaves the card's edge at the piece's height and
 *            eases up to the constellation that is being drawn, where it settles as a STAR of
 *            that colour; under the piece's column a ring of the same colour runs out over
 *            the lake. A hard drop is brighter and wider and jolts the lens.
 *   onClear  the figure's LINES are drawn, two for every row, and one shooting star per row
 *            crosses the sky. Four lines or a perfect clear finish the figure at once and send
 *            a fireball over the whole sky: it lights the air and the lake and leaves a train.
 *            A T-spin whirls the sky. A finished figure flares, stays, and turns with the sky.
 *   onCombo  the chain is the exposure: the shutter opens, every star draws a trail round the
 *            pole (circles, with the mirror), the sky turns faster and the shower thickens. It
 *            closes slowly when the chain breaks.
 *   levelUp  an hour passes in a breath: the sky swings HOUR_SWING round the pole and the light
 *            turns one step (it also turns by itself, one hour every HOUR_SECONDS: deep night →
 *            airglow → first light → afterglow → zodiacal → blue hour → round again).
 *
 * Every answer adds to what is still in the sky; none restarts it. Two fireballs can be up at
 * once, each with its own light on the air and the lake, and each lands (a third great clear
 * swells the one in flight). A cascade's waves each sweep the pole further and ring the lake
 * wider than the last; a back-to-back sends a pair of amber shooting stars side by side; a
 * T-spin that cleared nothing gives the sky a small turn; the late perfect clear is the CROWN on
 * the clear still playing (a storm from the radiant in the colours played, every figure flaring,
 * the fireball in flight swelling), never a clear of its own.
 *
 * And the night builds with play (src/themes/shared/gameplay-surge.js), in its own terms:
 *   calm   as it always was.
 *   warm   the pace itself opens the exposure a little, the shower quickens, the motes run
 *          brighter and the rings ring harder, the kept figures glow.
 *   hot    the trails turn to their stars' own colours (embers, golds, blues) and stretch, the
 *          figures' lines take the colours of the pieces that lit their stars.
 *   fever  the mirror of the night: the trails sweep long arcs round the pole while the faint
 *          dust gives way to the bright (the sky stays dark between them), the lake goes glassy
 *          and doubles them, the constellations blaze in the colours of play and a storm falls
 *          from the radiant in those colours; a fireball burns as a green bolide, not a white
 *          blot. When the hands rest it all breathes back over a few seconds.
 *
 * Everything is a function of the night's clock and the events' start times, so a seek() that
 * replays the same events gives the same frame.
 */
import * as THREE from 'three/webgpu';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import {
    DEG,
    EXPOSURE_MAX,
    FIGURES,
    FIGURES_KEPT,
    FIGURE_LINES,
    FIGURE_STARS,
    HOUR_SECONDS,
    HOUR_SWING,
    LINES_PER_ROW,
    PALETTES,
    PALETTE_KEYS,
    PALETTE_SCALARS,
    SKY_RATE,
    SKY_START,
    STREAK,
    TAU,
    TSPIN_SWING,
    WORLD,
    approach,
    bakeNoise,
    clamp,
    clamp01,
    figureOrder,
    generateCatalog,
    hexToLinear,
    horizontal,
    mulberry32,
    paletteAt,
    poleFrame,
    shutterFor,
    skyToWorld,
    slerp,
    smooth01,
    worldToSky,
} from './starlight-core.js';
import { tierFor } from './starlight-quality.js';
import {
    RINGS, STREAKS, createNoiseTexture, createUniforms,
} from './starlight-tsl.js';
import { createSky } from './starlight-sky.js';
import { createStars } from './starlight-stars.js';
import { TRAIN_LIFE, createFx } from './starlight-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './starlight-composition.js';
import { flashScale } from '../../utils/photosensitivity.js';

export const REST_RIG = Object.freeze({
    near: 1,
    far: 12000,
    fov: 50,
    /** The lens looks up: the horizon sits in the lower third, the lake below it. */
    pitch: 0.2,
});

/** Vertical field of view: 50° on a wide screen, opened up on a tall one so the sky still fits. */
export function fovForAspect(aspect) {
    const wide = Math.tan((REST_RIG.fov * Math.PI) / 360);
    const need = Math.tan(27 * DEG) / Math.max(0.3, aspect || 1);
    return Math.min(76, (Math.atan(Math.max(wide, need)) * 360) / Math.PI);
}

const PARTS = ['sky', 'stars', 'figures', 'streaks'];

/** The frame height every pixel size in the scene is authored for. */
export const DESIGN_LINES = 1080;

const DEFAULT_SPARK = Object.freeze([1.0, 0.9, 0.7]);
/** Seconds a mote takes to reach its star. */
const MOTE_FLIGHT = 0.8;
const MOTE_FLIGHT_HARD = 0.58;
/** How far out on the lake a lock's ring opens, metres. */
const RING_RANGE = 24;
/** A figure's half-size on the sky, radians. */
const FIGURE_SPAN = 0.105;
/** Seconds a figure takes to fade once it leaves. */
const FIGURE_LEAVE = 2.6;
/** Screen columns a shooting star may start in (the card and the HUD rule some out). */
const METEOR_COLUMNS = Object.freeze([0.05, 0.11, 0.18, 0.25, 0.32, 0.38, 0.62, 0.69, 0.76, 0.83, 0.9, 0.96]);
/** Fireballs up at once (a great clear on the heels of another); a third swells the latest. */
const FIREBALLS = 2;
/** Seconds a fireball takes to cross, and its light lingers after it lands. */
const FIREBALL_FLIGHT = 1.45;
const FIREBALL_AFTER = 2.4;
/** Seconds the light a fireball is fed takes to swell in. */
const FIREBALL_FEED = 0.35;
/** The colours of the pieces last played: a fever's shooting stars fall in them. */
const PLAYED = 6;
/** A back-to-back's answer: a pair of amber shooting stars side by side. */
const TWIN_RGB = Object.freeze([1.0, 0.62, 0.2]);
/** How far apart the pair runs, radians. */
const TWIN_GAP = 0.014;
/** Each cascade wave past the first whirls the sky this much further than the last. */
const CASCADE_SWING = 3 * DEG;

export class StarlightWorld {
    /**
     * @param {object} options
     * @param {THREE.Scene} options.scene
     * @param {string} [options.quality='High']
     * @param {boolean} [options.capture=false] a frozen or stepped clock: nothing eases in
     */
    constructor({ scene, quality = 'High', capture = false } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture;
        this.u = createUniforms();
        this.root = new THREE.Group();
        this.root.name = 'starlight-world';
        this.parts = new Map();
        this.noiseData = null;
        this.noise = null;
        this.sky = null;
        this.stars = null;
        this.fx = null;
        this.reduced = false;
        this.aspect = 16 / 9;
        this.bufferHeight = 1080;
        this.layout = null;
        this._camera = null;
        this._pos = new THREE.Vector3(0, WORLD.eye, 0);
        this._right = new THREE.Vector3(1, 0, 0);
        this._up = new THREE.Vector3(0, 1, 0);
        this._fwd = new THREE.Vector3(0, 0, -1);
        this._point = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._rgb = [1, 1, 1];
        this._dir = [0, 0, 0];
        this._dirB = [0, 0, 0];
        this._sky = [0, 0];
        this._screen = { x: 0.5, y: 0.5, front: true };
        this._palette = {};
        this._post = {
            flash: 0,
            kick: 0,
            bloomBoost: 0,
            exposure: 1,
            ripple: {
                x: 0.5, y: 0.4, radius: 0, strength: 0,
            },
        };
        this.frame = poleFrame(0, WORLD.poleAlt);
        this.poleAz = 0;
        this.poleAzTarget = 0;
        this.poleScreenX = WORLD.poleScreenX;
        this.poleBeside = true;
        this.composed = false;
        /** How hot play runs, and what it read this frame (copied: the surge reuses its sample). */
        this.gameplay = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        /** The Milky Way's swell on a clear: every clear adds to what is still lit. */
        this.surgeSwell = new Swell({
            release: 1.7, ceiling: 1, knee: 0.55, headroom: 1.4,
        });
        this.fireballs = Array.from({ length: FIREBALLS }, () => ({
            on: false,
            from: [0, 0, 0],
            to: [0, 0, 0],
            t0: 0,
            duration: FIREBALL_FLIGHT,
            power: 0,
            boostFrom: 0,
            boostTo: 0,
            boostAt: 0,
            streak: -1,
            streakEnd: 0,
            landed: false,
        }));
        this._flashes = [this.u.flash.value, this.u.flashB.value];
        this.played = new Float32Array(PLAYED * 3);
        this.playedCount = 0;
        this._bolide = [0.7, 1.0, 0.9];
        this._spark = [0, 0, 0];
        this._lineRgb = [0, 0, 0];
        this._landing = { x: 0.5, y: 0.5, front: true };
        this.resetState(0);
    }

    /** The live fireball that flew last, or null (both lights are in `fireballs`). */
    get fireball() {
        let last = null;
        for (let i = 0; i < FIREBALLS; i += 1) {
            const ball = this.fireballs[i];
            if (ball.on && (!last || ball.t0 > last.t0)) last = ball;
        }
        return last;
    }

    /** The night at rest at `time`: the shutter closed, no figure begun, nothing in the air. */
    resetState(time) {
        this.time = time;
        this.rand = mulberry32(20261011);
        this.combo = 0;
        this.shutter = 0;
        this.shutterTarget = 0;
        this.level = 1;
        this.hourShift = 0;
        this.skyAngle = SKY_START + time * SKY_RATE;
        this.turnDebt = 0;
        this.spin = 0;
        this.surge = 0;
        this.surgeSwell.reset();
        this.gameplay.reset();
        this.heat.punch = 0;
        this.heat.level = 0;
        this.heat.fever = 0;
        this.heat.stage = 0;
        /** How far the long exposure is open: the chain's shutter, or the pace of play's own. */
        this.open = 0;
        this.blaze = 0;
        this.tint = 0;
        this.shake = 0;
        this.kick = 0;
        this.lensFlash = 0;
        this.fireballs.forEach((ball) => {
            ball.on = false;
            ball.power = 0;
            ball.boostFrom = 0;
            ball.boostTo = 0;
            ball.streak = -1;
            ball.landed = false;
        });
        this.playedCount = 0;
        this.nextMeteor = time + 9;
        this.scheduled = [];
        this.order = figureOrder(20261011);
        this.orderCursor = 0;
        this.current = null;
        this.figureCount = 0;
        this.figures = Array.from({ length: FIGURES_KEPT }, (_, slot) => ({
            slot,
            on: false,
            name: '',
            lines: [],
            stars: [],
            drawn: 0,
            revisit: 0,
            serial: 0,
            done: -1,
            leaving: -1,
            light: 0,
            flare: 0,
            rho: 0,
            theta: 0,
        }));
        this.rings = Array.from({ length: RINGS }, () => ({
            on: false, t0: 0, x: 0, z: 0, speed: 4, life: 1, rgb: [1, 1, 1], strength: 0, width: 0.3,
        }));
        this.streakEnds = new Float64Array(STREAKS).fill(-1000);
        this.cursor = { ring: 0, streak: 0 };
        const { u } = this;
        u.tables.streaks.forEach((row, i) => row.set(0, i % 4 < 2 ? 1 : 0, 0, i % 4 === 0 ? -1000 : 0));
        u.tables.rings.forEach((row) => row.set(0, 0, 0, 0));
        u.tables.figures.forEach((row) => row.set(0, 0, 0, 0));
        // The last row is the catalogue's own glints: always lit, never flared.
        u.tables.figures[FIGURES_KEPT].set(1, 0, 0, 0);
        u.flash.value.set(0, 1, 0, 0);
        u.flashB.value.set(0, 1, 0, 0);
        if (this.stars) {
            for (let slot = 0; slot < FIGURES_KEPT; slot += 1) this.clearFigure(slot);
        }
    }

    build() {
        const { u, tier } = this;
        this.noiseData = bakeNoise(1610);
        this.noise = createNoiseTexture(this.noiseData);
        this.catalog = generateCatalog(tier.stars, this.noiseData);
        this.sky = createSky({ u, noise: this.noise, tier });
        this.stars = createStars({
            u, noise: this.noise, tier, catalog: this.catalog,
        });
        this.fx = createFx({ u, noise: this.noise, tier });
        this.addPart('sky', this.sky.object);
        this.addPart('stars', this.stars.stars);
        this.addPart('figures', this.stars.figures);
        this.addPart('streaks', this.fx.streaks);
        this.scene.add(this.root);
        this.compose();
        this.applyPalette();
        return this;
    }

    addPart(name, object) {
        this.parts.set(name, object);
        this.root.add(object);
    }

    /** Debug: draw only the named parts. */
    showOnlyParts(names) {
        const wanted = new Set(names);
        this.parts.forEach((object, name) => {
            object.visible = wanted.has(name);
        });
    }

    setViewport(bufferWidth, bufferHeight, aspect) {
        if (bufferHeight > 0) this.bufferHeight = bufferHeight;
        if (aspect > 0) this.aspect = aspect;
        this.updatePixelAngle();
        this.compose();
    }

    /** The live card/board/HUD rects (screen fractions), or null when no board is on screen. */
    setLayout(rects, aspect) {
        this.layout = rects || null;
        if (aspect > 0) this.aspect = aspect;
        this.compose();
    }

    setReducedMotion(reduced) {
        this.reduced = reduced === true;
    }

    seek(time) {
        this.resetState(time);
        this.applyPalette();
        this.writeTables();
        this.writeSky();
    }

    /** A new run: the figures fade, the shutter closes, the light eases back to deep night. */
    resetSession() {
        this.combo = 0;
        this.shutterTarget = 0;
        this.level = 1;
        this.turnDebt = 0;
        this.scheduled.length = 0;
        this.current = null;
        this.figures.forEach((figure) => {
            if (figure.on && figure.leaving < 0) figure.leaving = this.time;
        });
    }

    bindCamera(camera) {
        this._camera = camera;
        this.updatePixelAngle();
    }

    fov() {
        return fovForAspect(this.aspect);
    }

    updatePixelAngle() {
        const fov = this._camera?.fov ?? this.fov();
        const span = 2 * Math.tan((fov * Math.PI) / 360);
        this.u.design.value = span / DESIGN_LINES;
        this.u.texel.value = span / Math.max(1, this.bufferHeight);
    }

    /** The layout the picture is composed for: the live one, else the stylesheet's solo layout. */
    layoutNow() {
        if (this.layout) return this.layout;
        const win = typeof window !== 'undefined' ? window : null;
        const height = win?.innerHeight || 1080;
        const width = win?.innerWidth || height * this.aspect;
        return fallbackLayout(width, height);
    }

    /** Screen x (0..1) → the azimuth of that column at rest (radians, + = right of the lens). */
    azimuthOf(sx) {
        const tan = Math.tan((this.fov() * Math.PI) / 360);
        return Math.atan((sx * 2 - 1) * tan * this.aspect);
    }

    /**
     * Stand the pole in the free space left of the card (above and behind it when the screen is
     * too narrow to have any): the whole sky turns round that point.
     */
    compose() {
        const card = cardUnion(this.layoutNow());
        const free = card ? card.x0 : 0.3;
        this.poleBeside = free > 0.15;
        this.poleScreenX = this.poleBeside ? clamp(free * 0.52, 0.1, 0.3) : 0.5;
        this.poleAzTarget = this.azimuthOf(this.poleScreenX);
        if (!this.composed || this.capture) {
            this.poleAz = this.poleAzTarget;
            this.composed = true;
        }
        this.writeSky();
    }

    /** The pole's frame and the sky's angle, to the uniforms. */
    writeSky() {
        const { u, frame } = this;
        poleFrame(this.poleAz, WORLD.poleAlt, frame);
        u.pole.value.set(frame.p[0], frame.p[1], frame.p[2]);
        u.poleUp.value.set(frame.e1[0], frame.e1[1], frame.e1[2]);
        u.poleWest.value.set(frame.e2[0], frame.e2[1], frame.e2[2]);
        // Wrapped, so a long session keeps its precision; every star's angle is taken mod 2π.
        u.skyAngle.value = this.skyAngle % TAU;
    }

    // ── camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        const still = this.reduced;
        let yaw = 0;
        let { pitch } = REST_RIG;
        let x = 0;
        let y = WORLD.eye;
        if (!still) {
            yaw = Math.sin(t * 0.043) * 0.012 + Math.sin(t * 0.017 + 1.3) * 0.007 - (sim.pointerX || 0) * 0.016;
            pitch += Math.sin(t * 0.031 + 0.7) * 0.005 - (sim.pointerY || 0) * 0.01;
            x = Math.sin(t * 0.027) * 0.25;
            y += Math.sin(t * 0.039) * 0.04;
            if (this.shake > 1e-4) {
                yaw += this.shake * Math.sin(t * 57.3) * Math.cos(t * 21.1);
                pitch += this.shake * Math.sin(t * 43.9 + 1.0);
            }
        }
        const fov = this.fov();
        if (camera.fov !== fov) {
            camera.fov = fov;
            camera.updateProjectionMatrix();
            this.updatePixelAngle();
        }
        camera.position.set(x, y, 0);
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
        // The shared breath (shared/camera-breath.js) on top of the drift above: off under reduced motion.
        applyCameraBreath(camera, t, { scale: still ? 0 : 1 });
        camera.updateMatrixWorld();
        const e = camera.matrixWorld.elements;
        this._pos.copy(camera.position);
        this._right.set(e[0], e[1], e[2]);
        this._up.set(e[4], e[5], e[6]);
        this._fwd.set(-e[8], -e[9], -e[10]);
        this.u.camRight.value.copy(this._right);
        this.u.camUp.value.copy(this._up);
    }

    /** A screen point (fractions, y down) → the ray through it, in `out` (unit). */
    screenRay(sx, sy, out = this._point) {
        const tan = Math.tan((this.fov() * Math.PI) / 360);
        const nx = (sx * 2 - 1) * tan * this.aspect;
        const ny = (1 - sy * 2) * tan;
        return out.copy(this._fwd).addScaledVector(this._right, nx).addScaledVector(this._up, ny).normalize();
    }

    /** A world direction (three numbers) → where it is on screen, in `out` ({ x, y, front }). */
    screenOf(d, out = this._screen) {
        const f = d[0] * this._fwd.x + d[1] * this._fwd.y + d[2] * this._fwd.z;
        const tan = Math.tan((this.fov() * Math.PI) / 360);
        const safe = Math.max(f, 1e-3);
        out.front = f > 0.02;
        const across = d[0] * this._right.x + d[1] * this._right.y + d[2] * this._right.z;
        const upward = d[0] * this._up.x + d[1] * this._up.y + d[2] * this._up.z;
        out.x = 0.5 + across / safe / (2 * tan * this.aspect);
        out.y = 0.5 - upward / safe / (2 * tan);
        return out;
    }

    /** A screen point → where its ray meets the lake (at most `reach` metres out), in `out`. */
    screenToWater(sx, sy, reach, out = this._point) {
        this.screenRay(sx, sy, out);
        const along = out.y < -0.02 ? Math.min(reach, -this._pos.y / out.y) : reach;
        out.multiplyScalar(along).add(this._pos);
        out.y = 0;
        return out;
    }

    /** The world direction of a sky place (ρ, θ) as the sky stands now, into `out`. */
    skyNow(rho, theta, out = this._dir) {
        return skyToWorld(this.frame, rho, theta + this.skyAngle, out);
    }

    // ── events ──────────────────────────────────────────────────────────────────

    schedule(time, run) {
        this.scheduled.push({ time, run });
    }

    colourOf(hex) {
        const rgb = this._rgb;
        if (!hexToLinear(hex, rgb)) {
            rgb[0] = DEFAULT_SPARK[0];
            rgb[1] = DEFAULT_SPARK[1];
            rgb[2] = DEFAULT_SPARK[2];
        }
        // Lift a dark colour so every piece's light reads against the night.
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-3);
        const gain = Math.max(1, 0.85 / peak);
        rgb[0] = Math.min(1.4, rgb[0] * gain);
        rgb[1] = Math.min(1.4, rgb[1] * gain);
        rgb[2] = Math.min(1.4, rgb[2] * gain);
        return rgb;
    }

    ring(x, z, rgb, {
        speed = 4.5, life = 2.6, strength = 0.9, width = 0.3,
    } = {}) {
        // A ring that has run out if there is one; else the one with the least light left, so
        // rapid locks never wipe a ring off the lake mid-spread.
        let slot = null;
        let least = Infinity;
        for (let i = 0; i < RINGS; i += 1) {
            const r = this.rings[(this.cursor.ring + i) % RINGS];
            const age = this.time - r.t0;
            if (!r.on || age >= r.life) {
                slot = r;
                break;
            }
            const left = 1 - Math.max(0, age) / r.life;
            const energy = r.strength * left * left;
            if (energy < least) {
                least = energy;
                slot = r;
            }
        }
        this.cursor.ring += 1;
        slot.on = true;
        slot.t0 = this.time;
        slot.x = x;
        slot.z = z;
        slot.speed = speed;
        slot.life = life;
        slot.strength = strength;
        slot.width = width;
        slot.rgb[0] = rgb[0];
        slot.rgb[1] = rgb[1];
        slot.rgb[2] = rgb[2];
    }

    /** A streak from one world direction to another (unit, three numbers each). */
    streak(from, to, {
        kind = STREAK.meteor, start = this.time, duration = 0.5, rgb = DEFAULT_SPARK, power = 1,
        tail = 0.5, width = 2.4, bow = 0, life = 0.3,
    } = {}) {
        // A dark slot after the cursor; when every one is in the air, the one nearest its end
        // (never one that has just set off: a lock's mote always reaches its star).
        let index = this.cursor.streak % STREAKS;
        let soonest = Infinity;
        for (let i = 0; i < STREAKS; i += 1) {
            const candidate = (this.cursor.streak + i) % STREAKS;
            const end = this.streakEnds[candidate];
            if (end <= this.time) {
                index = candidate;
                break;
            }
            if (end < soonest) {
                soonest = end;
                index = candidate;
            }
        }
        this.cursor.streak = index + 1;
        this.streakEnds[index] = start + duration + life;
        const { streaks } = this.u.tables;
        streaks[index * 4].set(from[0], from[1], from[2], start);
        streaks[index * 4 + 1].set(to[0], to[1], to[2], duration);
        streaks[index * 4 + 2].set(rgb[0], rgb[1], rgb[2], power);
        streaks[index * 4 + 3].set(kind, tail, width, bow);
        return index;
    }

    /**
     * A shooting star through free sky, away from the shower's radiant: in the hour's meteor
     * colour unless given one, `pace` times as fast, and with a `twin` running beside it that far
     * apart (radians) when asked.
     */
    meteor(power = 1, { rgb = null, pace = 1, twin = 0 } = {}) {
        const layout = this.layoutNow();
        const card = cardUnion(layout);
        const { hud } = layout;
        const open = METEOR_COLUMNS.filter((sx) => !(card && sx > card.x0 - 0.025 && sx < card.x1 + 0.025)
            && !(hud && sx > hud.x0 - 0.02 && sx < hud.x1 + 0.02));
        const pool = open.length ? open : METEOR_COLUMNS;
        const sx = pool[Math.floor(this.rand() * pool.length) % pool.length];
        const sy = 0.05 + this.rand() * 0.3;
        const from = this._dir;
        const ray = this.screenRay(sx, sy, this._ray);
        from[0] = ray.x;
        from[1] = ray.y;
        from[2] = ray.z;
        // Along the great circle from the radiant through the start, onward.
        const radiant = horizontal(WORLD.radiantAz + this.poleAz, WORLD.radiantAlt, this._dirB);
        const dot = from[0] * radiant[0] + from[1] * radiant[1] + from[2] * radiant[2];
        let tx = from[0] * dot - radiant[0];
        let ty = from[1] * dot - radiant[1];
        let tz = from[2] * dot - radiant[2];
        const tn = Math.hypot(tx, ty, tz) || 1;
        tx /= tn;
        ty /= tn;
        tz /= tn;
        // A meteor far from the radiant runs long; one near it is short.
        let run = (0.2 + this.rand() * 0.2) * (0.45 + 0.75 * Math.sqrt(Math.max(0, 1 - dot * dot)));
        const to = [0, 0, 0];
        for (let tries = 0; tries < 5; tries += 1) {
            const c = Math.cos(run);
            const s = Math.sin(run);
            to[0] = from[0] * c + tx * s;
            to[1] = from[1] * c + ty * s;
            to[2] = from[2] * c + tz * s;
            if (to[1] > 0.07) break;
            run *= 0.65;
        }
        const colour = rgb || this._palette.meteor || DEFAULT_SPARK;
        const shape = {
            kind: STREAK.meteor,
            duration: (0.45 + this.rand() * 0.35) / Math.max(0.5, pace),
            rgb: colour,
            power: (1.0 + this.rand() * 0.7) * power,
            tail: 0.55,
            width: 3.0 + this.rand() * 1.5,
            life: 0.3,
        };
        this.streak(from, to, shape);
        if (twin > 0) {
            // Its twin: the same path moved across it, side by side all the way.
            let nx = from[1] * to[2] - from[2] * to[1];
            let ny = from[2] * to[0] - from[0] * to[2];
            let nz = from[0] * to[1] - from[1] * to[0];
            const nn = Math.hypot(nx, ny, nz) || 1;
            nx = (nx / nn) * twin;
            ny = (ny / nn) * twin;
            nz = (nz / nn) * twin;
            const shift = (d) => {
                const out = [d[0] + nx, d[1] + ny, d[2] + nz];
                const n = Math.hypot(out[0], out[1], out[2]);
                return [out[0] / n, out[1] / n, out[2] / n];
            };
            this.streak(shift(from), shift(to), shape);
        }
    }

    /** Remember a played piece's colour (the fever's shooting stars fall in them). */
    notePlayed(rgb) {
        const at = (this.playedCount % PLAYED) * 3;
        this.played[at] = rgb[0];
        this.played[at + 1] = rgb[1];
        this.played[at + 2] = rgb[2];
        this.playedCount += 1;
    }

    /** The colour of the piece played `back` pieces ago (cycling), else the hour's meteor. */
    playedColour(back = 0) {
        const kept = Math.min(this.playedCount, PLAYED);
        if (kept === 0) return this._palette.meteor || DEFAULT_SPARK;
        const i = (((this.playedCount - 1 - back) % kept) + kept) % kept;
        const out = this._spark;
        out[0] = this.played[i * 3];
        out[1] = this.played[i * 3 + 1];
        out[2] = this.played[i * 3 + 2];
        return out;
    }

    /** A fireball's strength at `time`: its own, and what it has been fed, swelling in. */
    ballPower(ball, time) {
        const fed = ball.boostFrom + (ball.boostTo - ball.boostFrom) * smooth01((time - ball.boostAt) / FIREBALL_FEED);
        return ball.power + fed;
    }

    /** The light a fireball throws at `time`: rising as it comes in, dying where it landed. */
    ballLight(ball, time) {
        const age = time - ball.t0;
        if (!ball.on || age < 0) return 0;
        const flown = clamp01(age / ball.duration);
        const landed = Math.max(0, age - ball.duration);
        const rise = Math.sin(Math.min(1, flown * 1.4) * Math.PI * 0.5);
        return rise * Math.exp(-landed / 0.5) * this.ballPower(ball, time);
    }

    /**
     * Feed the fireball still in the air that flew last: it swells (over FIREBALL_FEED) and lands
     * the harder. False when none is in the air.
     */
    feedFireball(amount, at = this.time) {
        let young = null;
        for (let i = 0; i < FIREBALLS; i += 1) {
            const ball = this.fireballs[i];
            if (ball.on && at - ball.t0 < ball.duration && (!young || ball.t0 > young.t0)) young = ball;
        }
        if (!young) return false;
        const now = this.ballPower(young, at) - young.power;
        young.boostFrom = now;
        young.boostTo = Math.min(1.6, now + amount);
        young.boostAt = at;
        return true;
    }

    /**
     * The fireball of a great clear: across the whole sky, and the train it leaves. It takes a
     * free slot (or one whose light is all but spent); with both still bright it feeds the one in
     * the air instead, so no fireball's light is ever cut off and every one lands.
     */
    fireballAcross(power = 1) {
        let ball = null;
        let spent = null;
        for (let i = 0; i < FIREBALLS; i += 1) {
            const candidate = this.fireballs[i];
            if (!candidate.on) {
                ball = candidate;
                break;
            }
            if (!spent || this.ballLight(candidate, this.time) < this.ballLight(spent, this.time)) spent = candidate;
        }
        if (!ball) {
            if (this.ballLight(spent, this.time) < 0.1 && this.time - spent.t0 > spent.duration) ball = spent;
            else if (this.feedFireball(0.5 * power)) return;
            else ball = spent;
        }
        const leftward = this.rand() < 0.5;
        const a = this.screenRay(leftward ? 0.97 : 0.03, 0.05, this._ray);
        const from = [a.x, a.y, a.z];
        const b = this.screenRay(leftward ? 0.06 : 0.94, 0.5, this._ray);
        const to = [b.x, Math.max(b.y, 0.09), b.z];
        const n = Math.hypot(to[0], to[1], to[2]);
        to[0] /= n;
        to[1] /= n;
        to[2] /= n;
        // The hour's meteor colour, deepening toward a green bolide as play heats.
        const colour = this._bolide;
        const duration = FIREBALL_FLIGHT;
        const index = this.streak(from, to, {
            kind: STREAK.fireball, duration, rgb: colour, power: 5.6 * power, tail: 0.2, width: 16, life: 0.3,
        });
        ball.streak = index;
        ball.streakEnd = this.streakEnds[index];
        // It sheds pieces: three small ones on almost its own path, each dying sooner.
        for (let i = 0; i < 3; i += 1) {
            const part = [0, 0, 0];
            const reach = 0.5 + i * 0.16 + this.rand() * 0.08;
            slerp(from, to, reach, part);
            part[1] -= 0.012 + this.rand() * 0.016;
            const pn = Math.hypot(part[0], part[1], part[2]);
            part[0] /= pn;
            part[1] /= pn;
            part[2] /= pn;
            this.streak(from, part, {
                kind: STREAK.meteor,
                start: this.time + 0.05 + i * 0.04,
                duration: duration * reach * 1.04,
                rgb: colour,
                power: 1.3,
                tail: 0.16,
                width: 3.4,
                life: 0.3,
            });
        }
        this.streak(from, to, {
            kind: 3, duration, rgb: colour, power: 1.1 * power, tail: 1, width: 5.5, life: TRAIN_LIFE,
        });
        ball.on = true;
        for (let k = 0; k < 3; k += 1) {
            ball.from[k] = from[k];
            ball.to[k] = to[k];
        }
        ball.t0 = this.time;
        ball.duration = duration;
        ball.power = power;
        ball.boostFrom = 0;
        ball.boostTo = 0;
        ball.boostAt = this.time;
        ball.landed = false;
    }

    /** A free slot for a new figure (the oldest finished one makes room if there is none). */
    freeSlot() {
        let kept = 0;
        let free = null;
        let oldest = null;
        this.figures.forEach((figure) => {
            if (!figure.on) {
                if (!free) free = figure;
                return;
            }
            if (figure.leaving >= 0) return;
            kept += 1;
            if (figure !== this.current && (!oldest || figure.serial < oldest.serial)) oldest = figure;
        });
        // One slot is always kept back for the next figure.
        if (oldest && (kept >= FIGURES_KEPT - 1 || !free)) oldest.leaving = this.time;
        if (free) return free;
        // Every slot is still on: put out the one furthest gone, a figure already leaving before
        // any that is still kept.
        let faintest = null;
        this.figures.forEach((figure) => {
            if (figure === this.current) return;
            const leaving = figure.leaving >= 0;
            const was = faintest && faintest.leaving >= 0;
            if (!faintest || (leaving && !was) || (leaving === was && figure.light < faintest.light)) faintest = figure;
        });
        faintest = faintest || this.figures[0];
        this.clearFigure(faintest.slot);
        return faintest;
    }

    clearFigure(slot) {
        const figure = this.figures[slot];
        figure.on = false;
        figure.light = 0;
        figure.flare = 0;
        figure.leaving = -1;
        figure.done = -1;
        figure.stars = [];
        figure.lines = [];
        figure.drawn = 0;
        if (!this.stars) return;
        for (let i = 0; i < FIGURE_STARS; i += 1) {
            this.stars.setGlint(slot * FIGURE_STARS + i, 1, 0, 0, 0, DEFAULT_SPARK, slot);
        }
        for (let i = 0; i < FIGURE_LINES; i += 1) this.stars.clearLine(slot * FIGURE_LINES + i);
    }

    /**
     * Where the next figure goes: a place in the sky that is in the frame now, clear of the
     * card, the HUD, the pole and the figures already there, and well above the hills.
     */
    placeFigure() {
        const layout = this.layoutNow();
        const card = cardUnion(layout);
        const { hud } = layout;
        const tan = Math.tan((this.fov() * Math.PI) / 360);
        const span = FIGURE_SPAN * clamp(this.aspect / 1.2, 0.62, 1);
        const ry = span / (2 * tan) + 0.015;
        const rx = ry / this.aspect;
        const blocked = (r, sx, sy) => r && sx > r.x0 - rx && sx < r.x1 + rx && sy > r.y0 - ry && sy < r.y1 + ry;
        const others = [];
        this.figures.forEach((figure) => {
            if (figure.on && figure.leaving < 0) others.push(this.skyNow(figure.rho, figure.theta, [0, 0, 0]));
        });
        const pole = this.frame.p;
        let best = null;
        let bestScore = -Infinity;
        for (let iy = 0; iy < 7; iy += 1) {
            for (let ix = 0; ix < 15; ix += 1) {
                const sx = 0.06 + (ix / 14) * 0.88;
                const sy = 0.1 + (iy / 6) * 0.5;
                if (blocked(card, sx, sy) || blocked(hud, sx, sy)) continue;
                const d = this.screenRay(sx, sy, this._ray);
                if (d.y < 0.14 + span) continue;
                let room = Math.acos(clamp(d.x * pole[0] + d.y * pole[1] + d.z * pole[2], -1, 1)) * 1.6;
                for (let k = 0; k < others.length; k += 1) {
                    const o = others[k];
                    room = Math.min(room, Math.acos(clamp(d.x * o[0] + d.y * o[1] + d.z * o[2], -1, 1)));
                }
                if (room < span * 1.9) continue;
                const score = Math.min(room, 0.6) + this.rand() * 0.12 - Math.abs(sy - 0.3) * 0.2;
                if (score > bestScore) {
                    bestScore = score;
                    best = [d.x, d.y, d.z];
                }
            }
        }
        if (!best) {
            // No room in the frame (a narrow screen full of card): above the card, mid-sky.
            const d = this.screenRay(this.poleBeside ? 0.8 : 0.5, 0.12, this._ray);
            best = [d.x, Math.max(d.y, 0.3), d.z];
            const n = Math.hypot(best[0], best[1], best[2]);
            best[0] /= n;
            best[1] /= n;
            best[2] /= n;
        }
        return { centre: best, span };
    }

    /** Begin the next figure: its stars and lines are placed, none of them lit. */
    beginFigure() {
        const def = FIGURES[this.order[this.orderCursor % this.order.length]];
        this.orderCursor += 1;
        const figure = this.freeSlot();
        const { centre, span } = this.placeFigure();
        // The figure stands upright on the horizon where it is placed.
        let rx = -centre[2];
        let rz = centre[0];
        const rn = Math.hypot(rx, rz) || 1;
        rx /= rn;
        rz /= rn;
        const ux = -rz * centre[1];
        const uy = rz * centre[0] - rx * centre[2];
        const uz = rx * centre[1];
        const sky = this._sky;
        const d = [0, 0, 0];
        figure.on = true;
        figure.name = def.name;
        figure.serial = this.figureCount;
        this.figureCount += 1;
        figure.done = -1;
        figure.leaving = -1;
        figure.light = 0;
        figure.flare = 0;
        figure.drawn = 0;
        figure.revisit = 0;
        worldToSky(this.frame, centre, sky);
        figure.rho = sky[0];
        figure.theta = sky[1] - this.skyAngle;
        figure.stars = def.stars.map(([x, y, weight]) => {
            d[0] = centre[0] + (rx * x + ux * y) * span;
            d[1] = centre[1] + uy * y * span;
            d[2] = centre[2] + (rz * x + uz * y) * span;
            const n = Math.hypot(d[0], d[1], d[2]);
            d[0] /= n;
            d[1] /= n;
            d[2] /= n;
            worldToSky(this.frame, d, sky);
            return {
                rho: sky[0], theta: sky[1] - this.skyAngle, weight, at: Infinity, rgb: [1, 1, 1],
            };
        });
        figure.lines = def.lines.map(([a, b]) => ({ a, b, when: 0 }));
        this.current = figure;
        return figure;
    }

    /** Light star `index` of a figure at `at`, in `rgb`. */
    kindle(figure, index, at, rgb, gain = 1) {
        const star = figure.stars[index];
        star.at = Math.min(star.at, at);
        star.rgb[0] = rgb[0];
        star.rgb[1] = rgb[1];
        star.rgb[2] = rgb[2];
        const weight = clamp((0.34 + 0.44 * star.weight) * gain, 0.05, 0.96);
        this.stars?.setGlint(
            figure.slot * FIGURE_STARS + index,
            Math.cos(star.rho),
            Math.sin(star.rho),
            star.theta,
            at,
            rgb,
            figure.slot + weight,
        );
    }

    /** Line `k` of a figure to the stars' table, in the colours of the two stars it joins. */
    writeLine(figure, k) {
        const line = figure.lines[k];
        const a = figure.stars[line.a];
        const b = figure.stars[line.b];
        this.stars?.setLine(figure.slot * FIGURE_LINES + k, a, b, line.when, figure.slot, a.rgb, b.rgb);
    }

    /** Draw the figure's next `count` lines from `at` on (their stars are lit if they are not). */
    drawLines(figure, count, at) {
        // A star a line lights takes the hour's line colour; as play heats, the colours played.
        const hour = this._palette.line || DEFAULT_SPARK;
        let light = hour;
        if (this.tint > 0) {
            const played = this.playedColour(0);
            light = this._lineRgb;
            for (let c = 0; c < 3; c += 1) light[c] = hour[c] + (played[c] - hour[c]) * this.tint;
        }
        let drawn = 0;
        while (drawn < count && figure.drawn < figure.lines.length) {
            const line = figure.lines[figure.drawn];
            const when = at + drawn * 0.14;
            if (figure.stars[line.a].at === Infinity) this.kindle(figure, line.a, when - 0.05, light);
            if (figure.stars[line.b].at === Infinity) this.kindle(figure, line.b, when + 0.4, light);
            line.when = when;
            this.writeLine(figure, figure.drawn);
            figure.drawn += 1;
            drawn += 1;
        }
        if (figure.drawn >= figure.lines.length && figure.done < 0) {
            // Finished: it flares, stays in the sky and turns with it; the next lock begins another.
            figure.done = at + drawn * 0.14 + 0.5;
            const finished = figure;
            const { serial } = figure;
            this.schedule(figure.done, () => {
                if (finished.serial !== serial || !finished.on) return;
                finished.flare = Math.max(finished.flare, 1);
                this.surgeSwell.hit(0.3, this.time);
            });
            if (this.current === figure) this.current = null;
        }
        return drawn;
    }

    onLock(c = {}) {
        const layout = this.layoutNow();
        const board = boardFor(layout, c.player) || layout.cards[0];
        const card = cardUnion(layout) || board;
        const rows = c.rows?.length ? c.rows : [19];
        let row = 0;
        for (let i = 0; i < rows.length; i += 1) row += rows[i];
        const at = boardPoint(board, c.u ?? 0.5, row / rows.length);
        const rgb = this.colourOf(c.color).slice();
        const hard = c.hardDrop === true;
        const figure = this.current || this.beginFigure();
        this.gameplay.lock(c, this.time);
        this.notePlayed(rgb);
        // The quicker the hand, the brighter the river of motes and the harder the lake rings.
        const pace = this.heat.level;

        // The star this piece becomes: the figure's next, or one already lit that takes its colour.
        let index = figure.stars.findIndex((star) => star.at === Infinity);
        const revisit = index < 0;
        if (revisit) {
            index = figure.revisit % figure.stars.length;
            figure.revisit += 1;
        }
        const star = figure.stars[index];
        const flight = hard ? MOTE_FLIGHT_HARD : MOTE_FLIGHT;
        const to = this.skyNow(star.rho, star.theta, [0, 0, 0]);

        // The mote leaves the card's edge on the star's side, at the piece's own height (from
        // the card's top when the star stands over the card).
        const where = this.screenOf(to);
        let sx = where.x < (card.x0 + card.x1) * 0.5 ? card.x0 : card.x1;
        let sy = at.y;
        if (where.front && where.x > card.x0 && where.x < card.x1) {
            sx = at.x;
            sy = card.y0;
        }
        if (c.screen) {
            sx = c.screen.x;
            sy = c.screen.y;
        }
        const ray = this.screenRay(sx, sy, this._ray);
        const from = [ray.x, ray.y, ray.z];
        this.streak(from, to, {
            kind: STREAK.mote,
            duration: flight,
            rgb,
            power: (hard ? 1.5 : 1.05) * (1 + 0.5 * pace),
            tail: 0.26,
            width: (hard ? 4.4 : 3.4) * (1 + 0.25 * pace),
            bow: (where.x < sx ? 1 : -1) * 0.045,
            life: 0.05,
        });
        const arrival = this.time + flight;
        const gain = hard ? 1.12 : 1;
        if (revisit) {
            // A star already lit keeps shining in its old colour until the mote arrives, then
            // flares up in the new one (its lines take the colour with it): it never goes dark.
            const { serial } = figure;
            this.schedule(arrival, () => {
                if (figure.serial !== serial || !figure.on) return;
                this.kindle(figure, index, arrival, rgb, gain);
                for (let k = 0; k < figure.drawn; k += 1) {
                    const line = figure.lines[k];
                    if (line.a === index || line.b === index) this.writeLine(figure, k);
                }
            });
        } else {
            this.kindle(figure, index, arrival, rgb, gain);
        }

        // A ring on the lake under the piece's column, out where the water meets the card's
        // foot: it opens behind the card and its arcs run out on both sides of it.
        const az = this.azimuthOf(c.screen ? sx : at.x);
        const footX = this._pos.x + Math.sin(az) * RING_RANGE;
        const footZ = this._pos.z - Math.cos(az) * RING_RANGE;
        const ring = 1 + 0.6 * pace;
        this.ring(footX, footZ, rgb, hard
            ? {
                speed: 4.6, life: 3.0, strength: 1.3 * ring, width: 1.0 * (1 + 0.3 * pace),
            }
            : {
                speed: 3.2, life: 2.6, strength: 0.85 * ring, width: 0.7 * (1 + 0.3 * pace),
            });
        if (hard) {
            this.shake = Math.max(this.shake, 0.0028);
            this.kick = Math.max(this.kick, 0.45);
        }
    }

    onClear(c = {}) {
        const at = this.time;
        const lines = clamp(Math.round(c.lines || 1), 1, 4);
        const perfect = c.perfect === true;
        const big = lines >= 4 || perfect;
        // How deep in a cascade this wave is (0: its first): each wave builds on the last.
        const depth = clamp(Math.round(c.cascade || 1), 1, 10) - 1;
        this.gameplay.clear(c, at);
        const figure = this.current || this.beginFigure();
        this.drawLines(figure, big ? FIGURE_LINES : lines * LINES_PER_ROW, at + 0.05);

        if (big) {
            this.schedule(at + 0.12, () => this.fireballAcross(perfect ? 1.25 : 1));
            this.surgeSwell.hit(0.85, at);
            this.shake = Math.max(this.shake, 0.004);
            // A perfect clear in the same frame as its lines: the crown rides on this clear.
            if (perfect) this.crown(at, { fireball: false });
        } else {
            // A shooting star for every row, and one more for every wave past the first: each
            // wave's brighter and quicker than the last.
            const count = Math.min(6, lines + depth);
            const power = 1 + 0.22 * depth;
            const pace = 1 + 0.15 * depth;
            const gap = 0.15 / (1 + 0.25 * depth);
            for (let i = 0; i < count; i += 1) this.schedule(at + 0.08 + i * gap, () => this.meteor(power, { pace }));
            this.surgeSwell.hit(0.08 * lines + 0.05 * depth, at);
        }
        if (depth > 0) {
            // A cascade sweeps the pole: each wave whirls the sky further than the last (the
            // whirl draws its own trails), and the lake rings wider under the board.
            this.turnDebt += CASCADE_SWING * depth;
            this.waveRing(c, depth);
        }
        if (c.b2b) this.twin(at);
        if (c.tspin) this.turnDebt += TSPIN_SWING;
        this.kick = Math.max(this.kick, 0.25 + lines * 0.14 + 0.06 * depth);
    }

    /** A cascade wave's ring on the lake under the board: wider, stronger and quicker the deeper. */
    waveRing(c, depth) {
        const layout = this.layoutNow();
        const board = boardFor(layout, c.player) || layout.cards[0];
        const sx = c.screen ? c.screen.x : (board.x0 + board.x1) * 0.5;
        const az = this.azimuthOf(sx);
        this.ring(
            this._pos.x + Math.sin(az) * RING_RANGE,
            this._pos.z - Math.cos(az) * RING_RANGE,
            this._palette.line || DEFAULT_SPARK,
            {
                speed: 4.2 + 0.8 * depth, life: 2.8, strength: 0.7 + 0.25 * depth, width: 0.9 + 0.35 * depth,
            },
        );
    }

    /**
     * Back-to-back: a pair of amber shooting stars side by side from the radiant, and the figure
     * being drawn (or the last one finished) flares again.
     */
    twin(at) {
        this.schedule(at + 0.1, () => this.meteor(1.35, { rgb: TWIN_RGB, twin: TWIN_GAP }));
        let figure = this.current;
        if (!figure) {
            this.figures.forEach((kept) => {
                if (kept.on && kept.leaving < 0 && (!figure || kept.serial > figure.serial)) figure = kept;
            });
        }
        if (figure) figure.flare = Math.max(figure.flare, 0.7);
    }

    /**
     * The crown of a perfect clear: a storm from the radiant in the colours played, every figure
     * in the sky flaring, and (`fireball`) the fireball still in the air swelling, or one sent if
     * none is up.
     */
    crown(at, { fireball = true } = {}) {
        for (let i = 0; i < 9; i += 1) {
            this.schedule(at + 0.3 + i * 0.16, () => this.meteor(1.15, { rgb: this.playedColour(i) }));
        }
        this.figures.forEach((kept) => {
            if (!kept.on) return;
            const { serial } = kept;
            this.schedule(at + 0.5, () => {
                if (kept.serial === serial && kept.on) kept.flare = Math.max(kept.flare, 1);
            });
        });
        if (fireball && !this.feedFireball(0.35, at)) this.schedule(at + 0.12, () => this.fireballAcross(1.15));
        this.surgeSwell.hit(0.35, at);
        this.kick = Math.max(this.kick, 0.6);
    }

    /** The late perfect clear (alone in its frame): the crown on the clear still playing. */
    onCrown() {
        this.gameplay.crown(this.time);
        this.crown(this.time, { fireball: true });
    }

    /** A T-spin that cleared nothing: the sky gives a small turn and the figure twinkles. */
    onSpin() {
        this.gameplay.spin(this.time);
        this.turnDebt += TSPIN_SWING * 0.4;
        if (this.current) this.current.flare = Math.max(this.current.flare, 0.35);
        this.kick = Math.max(this.kick, 0.18);
    }

    /** The true combo (0 = the chain broke). */
    onCombo(combo) {
        this.combo = Math.max(0, Math.round(combo || 0));
        this.shutterTarget = shutterFor(this.combo);
    }

    levelUp(level, { silent = false } = {}) {
        const next = Math.max(1, Math.round(level || 1));
        if (silent) {
            // As if every level before it had already swung the sky.
            this.skyAngle += (next - this.level) * HOUR_SWING;
            this.level = next;
            this.hourShift = next - 1;
            this.applyPalette();
            this.writeSky();
            return;
        }
        this.level = next;
        this.turnDebt += HOUR_SWING;
        this.schedule(this.time + 0.1, () => this.meteor(1.3));
        this.surgeSwell.hit(0.45, this.time);
        this.gameplay.levelUp(this.time);
    }

    // ── frame ───────────────────────────────────────────────────────────────────

    wheel() {
        return this.time / HOUR_SECONDS + this.hourShift;
    }

    applyPalette() {
        const p = paletteAt(this.wheel(), this._palette);
        const { u } = this;
        for (let i = 0; i < PALETTE_KEYS.length; i += 1) {
            const key = PALETTE_KEYS[i];
            u[key].value.set(p[key][0], p[key][1], p[key][2]);
        }
        for (let i = 0; i < PALETTE_SCALARS.length; i += 1) {
            const key = PALETTE_SCALARS[i];
            u[key].value = p[key];
        }
        return p;
    }

    /** The event tables, as they stand at this.time. */
    writeTables() {
        const { time, u } = this;
        const { tables } = u;
        for (let i = 0; i < RINGS; i += 1) {
            const r = this.rings[i];
            const shape = tables.rings[i * 2];
            const age = time - r.t0;
            if (!r.on || age < 0 || age > r.life) {
                r.on = r.on && age < r.life;
                shape.set(0, 0, 0, 0);
                continue;
            }
            const left = 1 - age / r.life;
            // The ring starts a little way out, so it never opens as a blot under the card.
            shape.set(r.x, r.z, 0.6 + r.speed * age, r.strength * left * left * Math.min(1, age / 0.12));
            tables.rings[i * 2 + 1].set(r.rgb[0], r.rgb[1], r.rgb[2], r.width + age * 0.2);
        }
        // Kept figures glow with play: in a fever they blaze, each breathing on its own beat.
        const beat = this.reduced ? 0.1 : 0.3;
        for (let i = 0; i < FIGURES_KEPT; i += 1) {
            const figure = this.figures[i];
            const blaze = this.blaze * (1 + beat * Math.sin(time * 1.9 + i * 1.7));
            tables.figures[i].set(figure.on ? figure.light : 0, figure.flare + blaze, 0, 0);
        }
    }

    update(sim, camera = this._camera) {
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const { u } = this;
        const { time } = this;

        // Staged events whose moment has come.
        if (this.scheduled.length) {
            const due = this.scheduled.filter((s) => s.time <= time);
            if (due.length) {
                this.scheduled = this.scheduled.filter((s) => s.time > time);
                due.sort((a, b) => a.time - b.time).forEach((s) => s.run());
            }
        }

        // How hot play runs (copied: the surge reuses its sample object).
        const sample = this.gameplay.sample(time);
        const { heat } = this;
        heat.punch = sample.punch;
        heat.level = sample.level;
        heat.fever = sample.fever;
        heat.stage = sample.stage;
        const { level, fever } = heat;

        // The chain opens the shutter quickly and lets it close slowly; a quick hand opens the
        // exposure a little by itself (nothing under casual play), so the pace draws trails too.
        const opening = this.shutterTarget > this.shutter;
        this.shutter += (this.shutterTarget - this.shutter) * approach(opening ? 1.4 : 0.42, dt);
        this.open = Math.max(this.shutter, 0.45 * smooth01((level - 0.22) / 0.63));
        const { open } = this;
        this.hourShift += ((this.level - 1) - this.hourShift) * approach(0.35, dt);
        this.surge = this.surgeSwell.valueAt(time);
        this.shake *= Math.exp(-dt / 0.35);
        this.kick *= Math.exp(-dt / 0.3);
        this.lensFlash *= Math.exp(-dt / 0.3);

        // The sky turns: by itself, faster in a chain, and by the swings it owes (a level's
        // hour, a T-spin's whirl). All of it accumulates, so no change of pace ever jumps.
        const step = this.turnDebt * approach(1.5, dt);
        this.turnDebt -= step;
        if (dt > 0) this.spin = step / dt;
        this.skyAngle += dt * SKY_RATE * (1 + open * 3) + step;
        const k = this.capture ? 1 : approach(1.2, dt);
        this.poleAz += (this.poleAzTarget - this.poleAz) * k;
        this.writeSky();
        const calm = this.reduced ? 0.35 : 1;
        u.time.value = time;
        u.shutter.value = open;
        // Heat stretches the trails past the chain's longest: a fever sweeps long arcs round the pole.
        // (Less on a tier with few segments a trail: a long arc there would show its corners.)
        const stretch = 1 + 0.3 * level + 0.8 * Math.min(1, this.tier.segments / 14) * fever;
        u.exposure.value = (EXPOSURE_MAX * open * stretch + Math.min(0.3, Math.abs(this.spin) * 0.8)) * calm;
        // The Milky Way swells on a clear, less in a fever: the arcs and the figures carry its light.
        u.surge.value = this.surge * (1 - 0.6 * fever);
        u.heat.value = level;
        u.fever.value = fever;
        // The lines take the colours of the stars they join as play heats; a fever stills the lake.
        this.tint = clamp01(smooth01((level - 0.25) / 0.45) * 0.65 + fever * 0.35);
        u.tint.value = this.tint;
        u.still.value = 1 - 0.7 * fever;
        // The kept figures glow warm, then blaze in a fever (writeTables breathes it per figure).
        this.blaze = 0.12 * smooth01((level - 0.22) / 0.5) + 0.6 * fever;
        // A star is one quad until it has a trail to draw.
        this.stars?.setTrailing(u.exposure.value > 1e-4);

        // The figures: lit while they are kept, flaring when finished, fading when they leave.
        for (let i = 0; i < FIGURES_KEPT; i += 1) {
            const figure = this.figures[i];
            if (!figure.on) continue;
            if (figure.leaving < 0 && figure.done >= 0 && figure !== this.current) {
                // A finished figure that has set behind the hills is let go.
                const d = this.skyNow(figure.rho, figure.theta);
                if (d[1] < 0.03) figure.leaving = time;
            }
            if (figure.leaving >= 0) {
                figure.light = this.capture
                    ? clamp01(1 - (time - figure.leaving) / FIGURE_LEAVE)
                    : Math.min(figure.light, clamp01(1 - (time - figure.leaving) / FIGURE_LEAVE));
                if (figure.light <= 0.004) this.clearFigure(i);
            } else {
                figure.light += (1 - figure.light) * approach(2.2, dt);
                if (this.capture) figure.light = 1;
            }
            figure.flare *= Math.exp(-dt / 1.3);
        }

        // The shower: a sporadic meteor now and then, many while the exposure is open, and in a
        // fever a storm from the radiant in the colours played.
        if (time >= this.nextMeteor) {
            const storm = fever * (this.reduced ? 0.4 : 1);
            const coloured = this.playedCount > 0 && storm + level > 0.05
                && this.rand() < storm * 0.85 + level * 0.15;
            this.meteor(1 + 0.5 * storm, coloured
                ? { rgb: this.playedColour(Math.floor(this.rand() * PLAYED)) } : undefined);
            const rate = (1 / 24) * (1 + open * 13) * (1 + level * 1.5 + storm * 6);
            this.nextMeteor = time + Math.max(0.35 - 0.22 * storm, -Math.log(1 - this.rand() * 0.999) / rate);
        }

        // The fireball's colour: the hour's meteor, a deeper green the hotter play runs.
        const meteorRgb = this._palette.meteor || DEFAULT_SPARK;
        const grey = meteorRgb[0] * 0.2126 + meteorRgb[1] * 0.7152 + meteorRgb[2] * 0.0722;
        const vivid = 1 + 1.1 * level;
        for (let c = 0; c < 3; c += 1) this._bolide[c] = Math.max(0, grey + (meteorRgb[c] - grey) * vivid);
        u.bolide.value.set(this._bolide[0], this._bolide[1], this._bolide[2]);

        // Each fireball's light follows its head, then dies where it landed; every one lands.
        const post = this._post;
        let lens = 0;
        let first = null;
        let ripple = 0;
        for (let i = 0; i < FIREBALLS; i += 1) {
            const ball = this.fireballs[i];
            const out = this._flashes[i];
            if (!ball.on) {
                out.w = 0;
                continue;
            }
            const age = time - ball.t0;
            const head = slerp(ball.from, ball.to, clamp01(age / ball.duration), this._dir);
            const landed = Math.max(0, age - ball.duration);
            const power = this.ballLight(ball, time);
            const strength = this.ballPower(ball, time);
            out.set(head[0], head[1], head[2], power * flashScale());
            lens += power;
            // The ball itself swells with what it has been fed (its slot, if still its own).
            if (ball.streak >= 0 && this.streakEnds[ball.streak] === ball.streakEnd) {
                u.tables.streaks[ball.streak * 4 + 2].w = 5.6 * strength;
            }
            if (landed > 0 && !ball.landed) {
                ball.landed = true;
                this.shake = Math.max(this.shake, 0.006);
            }
            const at = this.screenOf(ball.to, this._landing);
            if (landed > 0 && landed < 2.2 && at.front) {
                // One lens breath: a second landing feeds the ring already running.
                ripple += this.reduced ? 0 : (1 - landed / 2.2) ** 1.5 * strength;
                if (!first || ball.t0 < first.t0) {
                    first = ball;
                    post.ripple.x = at.x;
                    post.ripple.y = at.y;
                    post.ripple.radius = landed * 0.6;
                }
            }
            if (landed > FIREBALL_AFTER) {
                ball.on = false;
                ball.streak = -1;
                out.w = 0;
            }
        }
        this.lensFlash = Math.max(this.lensFlash, Math.min(1, lens * 0.22));
        post.ripple.strength = first ? Math.min(1.6, ripple) : 0;

        this.applyPalette();
        this.writeTables();
        if (camera) this.sky?.update(camera);

        post.flash = this.lensFlash;
        // Every event's punch rides on a floor under rapid play: the lens fringe never flickers out.
        post.kick = Math.max(this.kick, heat.punch * 0.3);
        post.bloomBoost = this.surge * 0.3 * (1 - 0.5 * fever) + open * 0.15;
        // The iris closes a little as play heats, so the colours stay saturated and the night dark.
        post.exposure = 1 - 0.18 * clamp01(this.lensFlash) - 0.05 * level - 0.14 * fever;
    }

    getPostState() {
        return this._post;
    }

    getState() {
        const hour = PALETTES[this._palette.index ?? 0]?.name ?? null;
        let kept = 0;
        for (let i = 0; i < this.figures.length; i += 1) {
            if (this.figures[i].on && this.figures[i].leaving < 0) kept += 1;
        }
        const figure = this.current;
        let lit = 0;
        if (figure) {
            for (let i = 0; i < figure.stars.length; i += 1) {
                if (figure.stars[i].at !== Infinity) lit += 1;
            }
        }
        let streaks = 0;
        for (let i = 0; i < STREAKS; i += 1) {
            if (this.streakEnds[i] > this.time) streaks += 1;
        }
        return {
            time: this.time,
            quality: this.quality,
            combo: this.combo,
            shutter: this.shutter,
            exposureDeg: this.u.exposure.value / DEG,
            skyAngleDeg: this.skyAngle / DEG,
            level: this.level,
            hour,
            hourTurn: this._palette.turn ?? 0,
            figure: figure ? figure.name : null,
            figureStars: figure ? figure.stars.length : 0,
            figureLit: lit,
            figureLines: figure ? figure.lines.length : 0,
            figureDrawn: figure ? figure.drawn : 0,
            figuresKept: kept,
            figuresDone: this.figureCount - (figure ? 1 : 0),
            streaks,
            stars: this.catalog?.count ?? 0,
            poleScreenX: this.poleScreenX,
            poleBeside: this.poleBeside,
            heat: this.heat.level,
            fever: this.heat.fever,
            stage: this.heat.stage,
            open: this.open,
            fireballs: this.fireballs.filter((ball) => ball.on).length,
        };
    }

    dispose() {
        this.scene?.remove(this.root);
        this.sky?.dispose();
        this.stars?.dispose();
        this.fx?.dispose();
        this.noise?.dispose();
        this.root.clear();
        this.parts.clear();
        this.sky = null;
        this.stars = null;
        this.fx = null;
        this.noise = null;
        this.catalog = null;
    }
}

export { PARTS as STARLIGHT_PARTS };
