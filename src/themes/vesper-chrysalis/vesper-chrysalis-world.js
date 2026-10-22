/**
 * Vesper Chrysalis — the world.
 *
 * Owns the plan, the shared uniforms, every scene part, the camera rig and the choreography.
 * Shared by the theme (vesper-chrysalis-theme.js) and the playground effect
 * (src/playground/effects/vesper-chrysalis.effect.js), so what is iterated there ships.
 *
 * A still lake at dusk. Seventy metres out a chrysalis of crystal hangs over the water from
 * threads of silk; lantern lilies float to either side; a ringed world stands in the sky. The
 * board wakes the chrysalis:
 *
 *   lock     a moth of the piece's colour leaves the card and flutters out over the lake to a
 *            lily, which opens and keeps that light; a ring runs out over the water from it.
 *            A hard drop sends three moths, strikes the lake under the chrysalis and sends
 *            light down the silk.
 *   clear    the cleared rows leave the card as blades of light and a swell crosses the lake
 *            from under the chrysalis, one front per line; every lily it passes lets its light
 *            go, and the light streams back to the chrysalis.
 *   combo    the chrysalis HATCHES: for every step of the chain its wings of light unfurl
 *            further to either side of the board — veins first, then the bands, then the eyes
 *            open — and the aurora rises. When the chain breaks the wings MOULT: they fold
 *            back from the margin over seconds, fraying, shedding scales, and a new chain
 *            catches them wherever they stand and lifts them again.
 *   four     the lake holds its breath (as deep as play is cold: mid-fever it only inhales),
 *            then the wings beat once: a ring crosses the sky and the water, the aurora
 *            blazes, every lily flares.
 *   cascade  every wave of one lock is a deeper swell than the last: more fronts, hotter,
 *            nearer vesperfire, with a ring under the chrysalis that reaches further each wave.
 *   b2b      the second difficult clear gilds the wings' veins and rings the silk in gold.
 *   perfect  a perfect clear that comes after its clear is a crown on it, not a second clear:
 *            every lily relit in vesperfire from the chrysalis outward, the wings gilded and
 *            beating, the evening star flaring. No second hush.
 *   level    the evening moves on an hour.
 *
 * And the evening builds with the pace of play (src/themes/shared/gameplay-surge.js): calm play
 * looks as it always has; a quick hand warms it (the chrysalis glows like a lantern, the stars
 * come out, the lilies keep more of their light through a clear); hot play brings the aurora up
 * in the wings' own colours, quickens the clouds and the water and pours shafts from the
 * chrysalis; and a fever makes the wings beat, great slow strokes as if to take off, drawn in
 * burning lines over a thinning veil, the evening star flaring and the aurora blazing. When the
 * hands rest it breathes back to dusk.
 *
 * The evening also moves on by itself, whatever the level: an hour every two minutes of the
 * world clock, so the colours of sky, lake and wings are never quite the same twice.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 */

import * as THREE from 'three/webgpu';
import {
    BLOOM_KEEP,
    DEG,
    EYE,
    EYE_COMBO,
    HEART,
    HUSH_HOLD,
    MOTH_DEPTH,
    MOTH_FLIGHT,
    NOISE_SIZE,
    PALETTE_KEYS,
    RING_FADE,
    RING_LIVE,
    RING_SLOTS,
    SURGE_COOL,
    SWELL_LIVE,
    SWELL_SLOTS,
    TAU,
    THREAD_PULSES,
    VESPERFIRE,
    VESPER_PALETTES,
    WING_FALL,
    WING_STEPS,
    approach,
    bakeNoise,
    clamp01,
    createNoiseTexture,
    createVesperUniforms,
    fovForAspect,
    hourAt,
    mulberry32,
    paletteAt,
    pieceColor,
    planBlooms,
    planSpires,
    powerForCombo,
    smooth,
    spireTip,
    swellPassTime,
    wingForCombo,
    wingPoint,
} from './vesper-chrysalis-tsl.js';
import { tierFor } from './vesper-chrysalis-quality.js';
import { createSky } from './vesper-chrysalis-sky.js';
import { createLake } from './vesper-chrysalis-lake.js';
import { createChrysalis, createThreads, planThreads } from './vesper-chrysalis-relic.js';
import { createReeds, createSpires } from './vesper-chrysalis-shore.js';
import { createWings } from './vesper-chrysalis-wings.js';
import { createBlooms } from './vesper-chrysalis-blooms.js';
import {
    DUST_HOME, createBlades, createDust, createFireflies, createMoths,
} from './vesper-chrysalis-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './vesper-chrysalis-composition.js';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';

/** The rest camera's lens (the theme builds its camera from it). */
export const REST_RIG = Object.freeze({
    hFov: EYE.hFov,
    minFov: EYE.minFov,
    maxFov: EYE.maxFov,
    near: EYE.near,
    far: EYE.far,
});

export { fovForAspect };

/** What stands in the scene is drawn on this camera layer: the mirror pass renders only it. */
export const HERO_LAYER = 1;

const PARTS = [
    'sky', 'lake', 'spires', 'reeds', 'chrysalis', 'threads', 'wings', 'blooms', 'moths', 'dust',
    'fireflies', 'blades',
];

/** The gold a back-to-back lays in the wings and the silk. */
const GILT = Object.freeze([1.0, 0.74, 0.36]);
/** The share of its light a lily keeps through a clear's swell once play runs hot (BLOOM_KEEP when calm). */
const HOT_KEEP = 0.6;
/** The wings' slow wingbeat in a fever (strokes a second), and how far it swings (radians). */
const FEVER_STROKE = 0.42;
const FEVER_SWING = 0.26;
/** The share of the span between two showers of scales as the wings fold back. */
const SHED_STEP = 0.035;
/** Seconds a new link of a chain holds folding wings where they are: it catches them. */
const CATCH_HOLD = 0.45;
/** Seconds a pulse on the silk is counted as running (its light is gone well before). */
const PULSE_LIFE = 3;
/** The ring through the frame: seconds it crosses, and seconds its light takes to fall to 1/e. */
const PRISM_LIVE = 2.2;
const PRISM_FADE = 0.75;

export class VesperWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {THREE.WebGPURenderer} [params.renderer]
     * @param {boolean} [params.capture=false]  deterministic captures: no wall-clock anywhere
     */
    constructor({
        scene, quality = 'High', renderer = null, capture = false, mirrorSamples = 0,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        /** The lake's mirror pass samples as the scene pass does (see createLake). */
        this.mirrorSamples = mirrorSamples;
        this.tier = tierFor(quality);
        this.renderer = renderer;
        this.capture = capture;
        this.noiseField = bakeNoise();
        this.root = new THREE.Group();
        this.root.name = 'VesperChrysalis';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.lake = null;
        this.blooms = null;
        this.moths = null;
        this.dust = null;
        this.blades = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        /** The chrysalis on screen (fractions, y down): where the post's shafts come from. */
        this.heart = { x: 0.5, y: 0.42 };
        this._camera = null;
        this._look = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._point = { x: 0.5, y: 0.5 };
        this._from = [0, 0, 0];
        this._clear = null;
        this._palette = {};
        PALETTE_KEYS.forEach((key) => {
            this._palette[key] = [...VESPER_PALETTES[0][key]];
        });
        this._night = VESPER_PALETTES[0].night;
        /** The evening moves on by itself (captures of one hour hold it still). */
        this.hourDrift = true;
        this._target = paletteAt(0);
        this._post = {
            heart: this.heart,
            flash: 0,
            kick: 0,
            shafts: 0.2,
            bloomBoost: 0,
            exposure: 1,
            prism: { radius: 0, strength: 0 },
        };
        /**
         * How hot play runs (src/themes/shared/gameplay-surge.js), fed from the same events and
         * clock as everything else; `heat` is its reading as of the last frame that moved.
         */
        this.gameplay = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        /** The gold a back-to-back lays in the wings' veins: a streak of them deepens it. */
        this.gild = new Swell({
            attack: 0.08, release: 2.4, ceiling: 1.2, knee: 0.9,
        });
        /** The evening star's flare (a back-to-back, a perfect clear). */
        this.starFlare = new Swell({
            attack: 0.12, release: 1.8, ceiling: 2, knee: 1.4,
        });
        this.resetState(0);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.power = 0;
        this.surge = 0;
        this.storm = 0;
        this.level = 1;
        this.paletteIndex = 0;
        this.flash = 0;
        this.kick = 0;
        this.dip = 0;
        this.breath = 1;
        this.wing = 0;
        this.wingFlash = 0;
        /** When the wings last began to moult, and how far open they stood then. */
        this.fallStart = -100;
        this.fallFrom = 0;
        /** The wings are folding back (a chain broke) until they reach the chain's step or are caught. */
        this.moulting = false;
        /** How hard the folding front frays (u.wing.z), eased in and out. */
        this.fray = 0;
        /** Span folded away since the last shower of scales. */
        this.shed = 0;
        /** A new link holds folding wings until then. */
        this.caughtUntil = -100;
        this.beat = 0;
        this.beatKick = 0;
        this.eyeHind = 0;
        this.eyeFore = 0;
        this.eyeFlash = 0;
        this.crack = 0;
        this.fed = 0;
        this.hushUntil = -1;
        /** The breath a four-line clear holds the evening at: deep when play is cold, shallow when hot. */
        this.hushFloor = 0.14;
        this.ringCursor = 0;
        this.swellCursor = 0;
        this.pulseCursor = 0;
        this.shock = { time: -100, strength: 0 };
        this.lastClear = { time: -100, lines: 0 };
        this.pendingKick = { time: Infinity, amount: 0 };
        this.pendingFed = { time: Infinity, amount: 0, rgb: [1, 0.7, 0.4] };
        this.blooms?.reset();
        this.moths?.reset();
        this.dust?.reset();
        this.blades?.reset();
        this.gameplay?.reset();
        if (this.heat) {
            this.heat.punch = 0;
            this.heat.level = 0;
            this.heat.fever = 0;
            this.heat.stage = 0;
        }
        this.gild?.reset();
        this.starFlare?.reset();
        this.counts = {
            locks: 0, clears: 0, quads: 0, moths: 0, falls: 0,
        };
        // The slow clock is a function of the world clock until gameplay bends it.
        this.drift = time * (this.reducedMotion ? 0.3 : 1);
        if (this.u) {
            for (let i = 0; i < RING_SLOTS; i++) this.u.ringA[i].value.set(0, 0, -100, 0);
            for (let i = 0; i < SWELL_SLOTS; i++) this.u.swellA[i].value.set(-100, 1, 0, 0);
            for (let i = 0; i < THREAD_PULSES; i++) this.u.pulseA[i].value.set(-100, 0, 0, 0);
            this.u.fed.value.set(1, 0.7, 0.4, 0);
            this.u.heat.value.set(0, 0, 0, 0);
        }
    }

    build() {
        const noise = createNoiseTexture(this.noiseField, NOISE_SIZE);
        this.textures.push(noise);
        const u = createVesperUniforms({ noise });
        this.u = u;
        const { tier } = this;

        // The mirror pass composites over the mirrored sky by alpha: it must clear to nothing.
        if (this.renderer?.getClearColor) {
            this._clear = {
                color: this.renderer.getClearColor(new THREE.Color()).clone(),
                alpha: this.renderer.getClearAlpha(),
            };
            this.renderer.setClearColor(0x000000, 0);
        }

        this.lake = createLake(u, {
            mirrorScale: tier.mirror, lite: tier.lite, glitter: tier.glitter, samples: this.mirrorSamples,
        });
        this.addPart('lake', this.lake);
        if (this.lake.reflectorTarget) this.root.add(this.lake.reflectorTarget);
        this.addPart('sky', createSky(u, { lite: tier.lite }));

        // ── What stands in the scene (mirrored by the lake's pass) ──
        this.spires = planSpires(tier.spires);
        this.addPart('spires', createSpires(u, this.spires), true);
        if (tier.reeds > 0) this.addPart('reeds', createReeds(u, tier.reeds), true);
        this.addPart('chrysalis', createChrysalis(u), true);
        // The long threads are made fast to the two tallest crystals of each stand.
        const anchors = [];
        [-1, 1].forEach((side) => {
            const stand = this.spires.filter((c) => c.side === side).sort((a, b) => b.height - a.height);
            stand.slice(0, 2).forEach((c) => anchors.push([...spireTip(c), side]));
        });
        this.threads = planThreads(tier.threads, anchors);
        this.addPart('threads', createThreads(u, this.threads), true);
        this.addPart('wings', createWings(u, { detail: tier.wingDetail }), true);
        this.blooms = createBlooms(u, planBlooms(tier.blooms), { whorls: tier.whorls });
        this.addPart('blooms', this.blooms, true);
        if (tier.fireflies > 0) this.addPart('fireflies', createFireflies(u, tier.fireflies), true);

        // ── Gameplay effects (pools, always drawn) ──
        this.moths = createMoths(u);
        this.addPart('moths', this.moths, true);
        this.dust = createDust(u, tier.dust);
        this.addPart('dust', this.dust, true);
        this.blades = createBlades(u);
        this.addPart('blades', this.blades);

        this.applyPalette(1);
        this.scene.add(this.root);
        return this;
    }

    /** Add a part. `hero` parts stand in the scene and are mirrored by the lake's pass. */
    addPart(name, part, hero = false) {
        this.parts[name] = part;
        if (hero) part.mesh.traverse((o) => o.layers.set(HERO_LAYER));
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
        if (this.u && bufferWidth > 0 && bufferHeight > 0) {
            this.u.viewport.value.set(bufferWidth, bufferHeight);
        }
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            // With no board on screen the events aim at where the solo board would be in THIS frame.
            if (!this.layoutLive) this.layout = fallbackLayout(this.aspect * 1000, 1000);
        }
        this.syncPixelAngle();
    }

    /** Radians one pixel subtends: the sky function draws its own edges with it. */
    syncPixelAngle() {
        if (!this.u) return;
        const h = Math.max(1, this.u.viewport.value.y);
        this.u.pixelAngle.value = (2 * Math.tan((fovForAspect(this.aspect) * DEG) / 2)) / h;
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

    /** Let the evening move on by itself (the default), or hold it at the level's own hour. */
    setHourDrift(drifting) {
        this.hourDrift = drifting !== false;
    }

    /** The hour of the evening now: the level's, plus how far time has moved it on. */
    hourNow() {
        return hourAt(this.level, this.time, this.hourDrift);
    }

    /** Jump the clock (captures): drops every event in flight. */
    seek(time) {
        this.resetState(Math.max(0, time));
        this.applyPalette(1);
    }

    /**
     * A new run. The evening goes back to rest the way it would by itself: a chain still
     * standing breaks (the wings fall), every lily lets its light go, and nothing still on its
     * way lands. What is already in the air — scales, moths, rings on the water — runs out;
     * the hour of the evening stays.
     */
    resetSession() {
        if (this.combo > 0) this.onCombo(0);
        this.combo = 0;
        this.hushUntil = -1;
        this.pendingKick.time = Infinity;
        this.pendingFed.time = Infinity;
        this.blooms?.letGo(this.time);
        this.counts = {
            locks: 0, clears: 0, quads: 0, moths: 0, falls: 0,
        };
    }

    /** The run ended: the wings fall, the chrysalis sleeps. */
    onGameOver() {
        if (this.combo > 0) this.onCombo(0);
    }

    /** The camera that will render the world: it sees the scene's layer, the mirror only that. */
    bindCamera(camera) {
        this._camera = camera;
        if (!camera) return;
        camera.layers.enable(HERO_LAYER);
        const reflection = this.lake?.reflection;
        if (reflection?.reflector?.getVirtualCamera) {
            reflection.reflector.getVirtualCamera(camera).layers.set(HERO_LAYER);
        }
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        const calm = this.reducedMotion ? 0 : 1;
        // Every event's punch rides under the kicks, so a quick hand leans the view in a little.
        const kick = this.kick + this.heat.punch * 0.22;
        const fov = fovForAspect(this.aspect) - kick * 0.7 * calm;
        if (camera.fov !== fov || camera.near !== EYE.near || camera.far !== EYE.far) {
            camera.fov = fov;
            camera.near = EYE.near;
            camera.far = EYE.far;
            camera.updateProjectionMatrix();
        }
        // The viewer stands in a boat that is all but still, and the pointer leans the view.
        const swayX = (Math.sin(t * 0.11) * 0.55 + Math.sin(t * 0.067 + 1.3) * 0.35) * calm;
        const swayY = (Math.sin(t * 0.19 + 0.7) * 0.07 + Math.sin(t * 0.083) * 0.05) * calm;
        const swayZ = Math.sin(t * 0.052 + 2.2) * 0.6 * calm;
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        camera.position.set(
            EYE.x + swayX + px * 1.5,
            EYE.y + swayY - py * 0.4,
            EYE.z + swayZ + kick * 0.35 * calm,
        );
        const yaw = (Math.sin(t * 0.083 + 2.1) * 0.006 + px * 0.018) * calm;
        const pitch = EYE.pitch + (Math.sin(t * 0.097) * 0.003 - py * 0.012) * calm;
        this._look.set(
            camera.position.x + Math.sin(yaw) * 100,
            camera.position.y + Math.tan(pitch) * 100,
            camera.position.z - Math.cos(yaw) * 100,
        );
        camera.up.set(0, 1, 0);
        camera.lookAt(this._look);
        // The shared breath (shared/camera-breath.js) on top of the sway above, turning the
        // view only (an eye-level look out over the lake): off under reduced motion.
        applyCameraBreath(camera, t, { scale: this.reducedMotion ? 0 : 1 });
        camera.updateMatrixWorld();
        this._camera = camera;
        // The chrysalis on screen: where the shafts come from.
        this._ray.set(HEART[0], HEART[1], HEART[2]).project(camera);
        this.heart.x = Math.max(-0.5, Math.min(1.5, this._ray.x * 0.5 + 0.5));
        this.heart.y = Math.max(-0.5, Math.min(1.5, 0.5 - this._ray.y * 0.5));
    }

    /** The world point `depth` metres along the ray through a screen point (fractions, y down). */
    screenToWorld(sx, sy, depth, out = this._from) {
        const camera = this._camera;
        if (!camera) {
            out[0] = 0;
            out[1] = EYE.y;
            out[2] = -depth;
            return out;
        }
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        out[0] = camera.position.x + this._ray.x * depth;
        out[1] = camera.position.y + this._ray.y * depth;
        out[2] = camera.position.z + this._ray.z * depth;
        return out;
    }

    // ── Gameplay ────────────────────────────────────────────────────────────────

    /**
     * The ring slot with least left to give now (a ring still to begin counts in full): under fast
     * play the faintest ring makes way, never one still spreading while a spent one is there.
     */
    ringSlot() {
        let slot = 0;
        let least = Infinity;
        for (let i = 0; i < RING_SLOTS; i++) {
            const A = this.u.ringA[i].value;
            const age = this.time - A.z;
            let left = 0;
            if (age < 0) left = A.w;
            else if (age < RING_LIVE) left = A.w * Math.exp(-age * RING_FADE);
            if (left < least) {
                least = left;
                slot = i;
            }
        }
        return slot;
    }

    /** Start a ring on the lake at (x, z) at `time`. */
    ring(x, z, time, strength, rgb, reach = 1) {
        const slot = this.ringSlot();
        this.ringCursor += 1;
        this.u.ringA[slot].value.set(x, z, time, strength);
        this.u.ringC[slot].value.set(rgb[0], rgb[1], rgb[2], reach);
    }

    /** Send light down the silk. side −1 left, +1 right, 0 both. The faintest pulse makes way. */
    threadPulse(time, side, strength, rgb) {
        let slot = 0;
        let least = Infinity;
        for (let i = 0; i < THREAD_PULSES; i++) {
            const A = this.u.pulseA[i].value;
            const age = this.time - A.x;
            let left = 0;
            if (age < 0) left = A.z;
            else if (age < PULSE_LIFE) left = A.z * (1 - age / PULSE_LIFE);
            if (left < least) {
                least = left;
                slot = i;
            }
        }
        this.pulseCursor += 1;
        this.u.pulseA[slot].value.set(time, side, strength, 0);
        this.u.pulseC[slot].value.set(rgb[0], rgb[1], rgb[2]);
    }

    /**
     * The swell slot with least left to give now: a spent one first, else the faintest (under a
     * chain or a cascade, the oldest), never a swell still crossing while a spent one is free.
     */
    swellSlot() {
        let slot = 0;
        let least = Infinity;
        for (let i = 0; i < SWELL_SLOTS; i++) {
            const A = this.u.swellA[i].value;
            const age = this.time - A.x;
            let left = 0;
            if (age < 0) left = A.z;
            else if (age < SWELL_LIVE) left = A.z * Math.exp(-age * 0.42);
            if (left < least) {
                least = left;
                slot = i;
            }
        }
        return slot;
    }

    /** A kick and a flash a beat after a clear. One already waiting takes this one with it. */
    queueKick(time, amount) {
        const k = this.pendingKick;
        if (k.time === Infinity) {
            k.time = time;
            k.amount = amount;
            return;
        }
        k.amount = Math.min(1.2, Math.max(k.amount, amount) + 0.25 * Math.min(k.amount, amount));
        k.time = Math.min(k.time, time);
    }

    /**
     * The light the lilies let go reaches the chrysalis at `time`. A feed still on its way takes
     * this one with it (their colours blended by how much each brings): no clear's light is lost.
     */
    queueFed(time, amount, rgb) {
        const f = this.pendingFed;
        if (f.time === Infinity) {
            f.time = time;
            f.amount = amount;
            f.rgb = rgb;
            return;
        }
        const w = amount / (f.amount + amount);
        for (let c = 0; c < 3; c++) f.rgb[c] += (rgb[c] - f.rgb[c]) * w;
        f.amount = Math.min(1, Math.max(f.amount, amount) + 0.35 * Math.min(f.amount, amount));
        f.time = Math.min(f.time, time);
    }

    /**
     * A ring through the frame (the post's prism) from `time`. A fainter one than the ring still
     * crossing joins it (lifting it a little) instead of starting it over from the chrysalis.
     */
    strikeRing(time, strength) {
        const s = this.shock;
        const age = time - s.time;
        let live = 0;
        if (age < 0) live = s.strength;
        else if (age < PRISM_LIVE) live = s.strength * Math.exp(-age / PRISM_FADE);
        if (strength >= live) {
            this.shock = { time, strength };
            return;
        }
        const lifted = Math.min(1, live + strength * 0.5);
        s.strength = age > 0 ? lifted * Math.exp(age / PRISM_FADE) : lifted;
    }

    /**
     * A piece locked. `u` = its column as a fraction of the board width, `rows` = the visible
     * rows it covers, `color` = the piece's colour; `screen` (fractions) replaces the board point.
     */
    onLock({
        u = 0.5, rows = null, hardDrop = false, color = null, player = 0, screen = null,
    } = {}) {
        if (!this.u) return;
        const rgb = pieceColor(color);
        let wx = 0.5;
        let wy = 0.6;
        let side = u < 0.5 ? -1 : 1;
        if (Math.abs(u - 0.5) < 0.03) side = this.counts.locks % 2 ? 1 : -1;
        if (screen) {
            wx = screen.x;
            wy = screen.y;
            side = screen.x < 0.5 ? -1 : 1;
        } else {
            const board = boardFor(this.layout, player);
            const card = cardUnion(this.layout);
            if (board) {
                const middle = Array.isArray(rows) && rows.length ? rows[Math.floor(rows.length / 2)] : 19;
                boardPoint(board, Number.isFinite(u) ? u : 0.5, Number.isFinite(middle) ? middle : 19, this._point);
                // The moth leaves the card's edge on the piece's side, at the piece's height.
                const edges = card || board;
                wx = side < 0 ? edges.x0 : edges.x1;
                wy = this._point.y;
            }
        }
        this.lockAt(wx, wy, side, rgb, hardDrop);
        this.kick = Math.max(this.kick, hardDrop ? 0.45 : 0.08);
        this.flash = Math.max(this.flash, hardDrop ? 0.08 : 0.015);
        this.gameplay.lock({ hardDrop }, this.time);
        this.counts.locks += 1;
    }

    /**
     * The lily a lock on `side` (−1 left, +1 right) sends its moth to: one that holds little
     * light, the nearer rows first. `skip` lists lilies already chosen for this lock.
     */
    pickBloom(side, skip = []) {
        const { blooms } = this;
        if (!blooms || !blooms.count) return -1;
        const rand = mulberry32(0x2f6b + (this.counts.moths + 1) * 2654435761);
        let best = -1;
        let bestScore = Infinity;
        for (let pass = 0; pass < 2 && best < 0; pass++) {
            for (let i = 0; i < blooms.count; i++) {
                // First the piece's own side; if every lily there is taken, the other.
                if ((blooms.plan[i].side === side) !== (pass === 0) || skip.includes(i)) continue;
                const score = blooms.wanted(i, this.time) * 1.1 + i * 0.035 + rand() * 0.45;
                if (score < bestScore) {
                    bestScore = score;
                    best = i;
                }
            }
        }
        return best;
    }

    /**
     * Send one moth from a world point to lily `index`. Returns when it lands. `ringToo` = the
     * lily it lands on sends a ring out over the water.
     */
    sendMoth(index, from, rgb, amount, ringToo = true) {
        const { blooms, moths } = this;
        const b = blooms?.plan[index];
        if (!b || !moths) return this.time;
        const to = [b.x, b.size * 0.5 + 0.3, b.z];
        const dist = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
        if (!Number.isFinite(dist)) return this.time;
        const flight = this.reducedMotion ? 0.15 : MOTH_FLIGHT * (0.7 + Math.min(0.9, dist / 70));
        const arrive = this.time + flight;
        // The path bows up and out over the water.
        moths.launch({
            from,
            to,
            bow: [b.side * dist * 0.05, dist * 0.09 + 1.2, 0],
            rgb,
            time: this.time,
            flight,
            size: 0.46 + amount * 0.14,
        });
        blooms.strike(index, rgb, arrive, amount);
        // The lily it lands on sends a ring out over the water and a puff of scales up.
        if (ringToo) this.ring(b.x, b.z, arrive, 0.45 + amount * 0.3, rgb, 0.4 + amount * 0.14);
        this.dust?.emit({
            at: to,
            n: Math.round((5 + 7 * amount) * this.dustShare()),
            rgb,
            time: arrive,
            vel: [0, 2.4, 0],
            spread: 1.7,
            life: [0.8, 1.7],
            size: 0.17,
        });
        this.counts.moths += 1;
        return arrive;
    }

    /** How full the dust pool is against the tier it was tuned on (High). */
    dustShare() {
        return this.dust ? Math.min(1.6, this.dust.count / 768) : 0;
    }

    /** What a lock does to the scene. (wx, wy) = where on screen the piece's light leaves the card. */
    lockAt(wx, wy, side, rgb, hardDrop) {
        const from = this.screenToWorld(wx, wy, MOTH_DEPTH, [0, 0, 0]);
        const first = this.pickBloom(side);
        if (first >= 0) this.sendMoth(first, from, rgb, hardDrop ? 1.25 : 0.9);
        if (hardDrop) {
            // Two more moths, to two more lilies…
            const second = this.pickBloom(side, [first]);
            if (second >= 0) this.sendMoth(second, [...from], rgb, 0.6, false);
            const third = this.pickBloom(-side, [first, second]);
            if (third >= 0) this.sendMoth(third, [...from], rgb, 0.6, false);
            // …the board strikes the lake under the chrysalis, and the silk rings with it.
            this.ring(HEART[0], HEART[2] + 6, this.time, 1.0, rgb, 2.4);
            this.threadPulse(this.time, 0, 1, rgb);
        } else {
            this.threadPulse(this.time, side, 0.55, rgb);
        }
    }

    /** Throw scales from random points of the wings between two fronts (v0..v1 of their length). */
    emitWingDust(v0, v1, total, opts = {}) {
        const { dust } = this;
        if (!dust || total <= 0) return;
        const rand = mulberry32(0x51ed + (this.counts.falls * 131 + this.combo * 17 + Math.round(v1 * 1000)));
        const groups = Math.max(1, Math.min(48, Math.round(total / 4)));
        const each = Math.max(1, Math.round(total / groups));
        const p = [0, 0, 0];
        const pal = this._palette;
        for (let g = 0; g < groups; g++) {
            const kind = rand() < 0.62 ? 0 : 1;
            const side = g % 2 === 0 ? -1 : 1;
            const v = v0 + (v1 - v0) * rand();
            wingPoint(kind, side, rand(), v, Math.max(this.wing, v1), this.beat, p);
            if (p[1] < 0.4) continue;
            // The scales carry the wing's own colour at that distance from the root.
            const k = Math.min(1, v * 1.15);
            const a = k < 0.5 ? pal.wingRoot : pal.wingMid;
            const b2 = k < 0.5 ? pal.wingMid : pal.wingEdge;
            const f = k < 0.5 ? k * 2 : k * 2 - 1;
            dust.emit({
                at: p,
                n: each,
                rgb: [a[0] + (b2[0] - a[0]) * f, a[1] + (b2[1] - a[1]) * f, a[2] + (b2[2] - a[2]) * f],
                time: this.time + (opts.delay ?? 0) + rand() * (opts.stagger ?? 0.4),
                vel: opts.vel ?? [side * 1.2, 0.6, 1.5],
                spread: opts.spread ?? 1.8,
                scatter: opts.scatter ?? 1.6,
                life: opts.life ?? [1.3, 2.6],
                size: opts.size ?? 0.2,
            });
        }
    }

    /**
     * Lines cleared. `lines` 1..4; `tspin`, `perfect`; `cascade` the wave of one lock's cascade
     * this is (2.. for the waves after the first: each builds on the last), `b2b` a back-to-back,
     * `combo` the chain it belongs to.
     */
    onClear({
        rows = null, lines = 1, perfect = false, tspin = false, player = 0, screen = null,
        cascade = 1, combo = 0, b2b = false,
    } = {}) {
        const { u: uniforms } = this;
        if (!uniforms) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        // The waves of a cascade after the first: each one deeper, hotter and wider than the last.
        const deeper = Math.max(0, Math.min(6, Math.round(Number(cascade) || 1) - 1));
        const { level } = this.heat;
        const p = this._palette;
        let rgb;
        if (quad) rgb = [...VESPERFIRE];
        else if (n === 1) rgb = [...p.wingMid];
        else if (n === 2) rgb = [0, 1, 2].map((c) => p.glow[c] * 0.8 + p.wingRoot[c] * 0.4);
        else rgb = [0, 1, 2].map((c) => p.wingEdge[c] * 0.8 + p.wingMid[c] * 0.3);
        if (deeper > 0) {
            const k = Math.min(0.6, deeper * 0.2);
            rgb = rgb.map((c, i) => c + (VESPERFIRE[i] - c) * k);
        }
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
        rgb = rgb.map((c) => (c / peak) * 0.92 + 0.08);
        const strength = Math.min(1.9, 0.6 + 0.15 * n + (quad ? 0.3 : 0) + 0.15 * deeper);
        let birth = quad ? this.time + HUSH_HOLD : this.time;
        // No two swells share a birth: it is what their releases are known by (two boards can
        // clear in one frame).
        for (let i = 0; i < SWELL_SLOTS; i++) {
            if (uniforms.swellA[i].value.x === birth) {
                birth += 1e-6;
                i = -1;
            }
        }

        const slot = this.swellSlot();
        this.swellCursor += 1;
        // A swell the lake stops drawing takes the releases it had still to make with it.
        const replaced = uniforms.swellA[slot].value.x;
        if (this.time - replaced < SWELL_LIVE) this.blooms?.cancel(replaced);
        // A cascade's later waves carry more fronts: the train grows wider wave by wave.
        uniforms.swellA[slot].value.set(birth, (perfect ? 4 : n) + Math.min(3, deeper), strength, quad ? 1 : 0);
        uniforms.swellC[slot].value.set(rgb[0], rgb[1], rgb[2]);
        this.lastClear = { time: birth, lines: n };
        this.storm = Math.max(this.storm, Math.min(1.4, 0.3 + 0.16 * n + (quad ? 0.4 : 0) + 0.1 * deeper));
        this.queueKick(birth + 0.1, 0.2 + 0.1 * n + 0.05 * deeper);
        this.wingFlash = Math.max(this.wingFlash, 0.35 + 0.15 * n + 0.1 * deeper);
        // The pace of play (a four-line clear's lands as its hush lets go).
        this.gameplay.clear({
            lines: n, cascade: deeper + 1, combo, tspin, perfect, b2b,
        }, birth);
        // The hotter play runs, the more of its light a lily keeps through the swell: a chain
        // fills the lake with lanterns instead of emptying it at every clear.
        const keep = BLOOM_KEEP + (HOT_KEEP - BLOOM_KEEP) * smooth(0.2, 0.85, level);
        const gives = (1 - keep) / (1 - BLOOM_KEEP);

        // ── Every lit lily lets its light go as the swell passes, and the light goes home ──
        const { blooms, dust } = this;
        if (blooms) {
            let released = 0;
            let latest = 0;
            const sum = [0, 0, 0];
            for (let i = 0; i < blooms.count; i++) {
                const b = blooms.plan[i];
                const pass = birth + swellPassTime(b.x, b.z);
                // What it will hold when the front reaches it: a moth still in the air has lit nothing.
                const held = blooms.heldAt(i, pass);
                if (held < 0.12) continue;
                const tint = blooms.colourAt(i, pass);
                blooms.release(i, pass, birth, keep);
                const given = held * gives;
                dust?.emit({
                    at: [b.x, b.size * 0.6 + 0.3, b.z],
                    n: Math.round((4 + given * 5) * this.dustShare()),
                    rgb: tint,
                    time: pass,
                    life: [0.9, 1.5],
                    size: 0.22,
                    scatter: 0.5,
                    stagger: 0.3,
                    home: DUST_HOME,
                });
                released += given;
                latest = Math.max(latest, pass);
                for (let c = 0; c < 3; c++) sum[c] += tint[c] * given;
            }
            if (released > 0) {
                // The chrysalis takes it in: it glows in what the lake gave back.
                this.queueFed(
                    (birth + latest) * 0.5 + 1.1,
                    Math.min(1, 0.35 + released * 0.14),
                    sum.map((c) => c / released),
                );
            }
            if (perfect) {
                // A perfect clear relights the whole lake at once.
                for (let i = 0; i < blooms.count; i++) {
                    const b = blooms.plan[i];
                    blooms.strike(i, VESPERFIRE, birth + swellPassTime(b.x, b.z) + 0.45, 1.3);
                }
            }
        }

        // ── The cleared rows leave the card as blades of light ──
        const board = boardFor(this.layout, player);
        const card = cardUnion(this.layout);
        if (this.blades && board && card && this.layoutLive && !screen) {
            const list = Array.isArray(rows) && rows.length ? rows : Array.from({ length: n }, (_, i) => 19 - i);
            const ys = [];
            for (let i = 0; i < list.length && i < 4; i++) ys.push(boardPoint(board, 0.5, list[i], this._point).y);
            const blade = Math.min(1.8, (0.7 + 0.18 * n) * (1 + 0.2 * deeper));
            this.blades.fire(ys, card.x0, card.x1, rgb, this.time, blade);
            // Where a blade ends it comes apart into scales.
            const at = [0, 0, 0];
            ys.forEach((y, i) => {
                [-1, 1].forEach((side) => {
                    const sx = (side < 0 ? card.x0 : card.x1) + side * 0.2;
                    this.screenToWorld(sx, y, 40, at);
                    dust?.emit({
                        at,
                        n: Math.round(7 * this.dustShare()),
                        rgb,
                        time: this.time + 0.16 + i * 0.035,
                        vel: [side * 5, 0.5, 0],
                        spread: 1.6,
                        scatter: 2.4,
                        life: [1.1, 2.2],
                        size: 0.24,
                        stagger: 0.2,
                    });
                });
            });
        }

        if (quad) {
            this.hushUntil = this.time + HUSH_HOLD;
            // As deep as play is cold: from rest the lake holds its breath; in a fever it inhales.
            this.hushFloor = 0.14 + 0.72 * clamp01(level);
            // The overdrive builds on what is left of the last one: it is never cut back.
            const overdrive = perfect ? 1.3 : 1;
            this.surge = Math.min(1.6, Math.max(this.surge + overdrive * 0.35, overdrive));
            this.strikeRing(birth, this.reducedMotion ? 0.5 : 1);
            this.ring(HEART[0], HEART[2] + 6, birth, 1.3, rgb, 3.2);
            this.eyeFlash = 1;
            this.beatKick = Math.max(this.beatKick, 1);
            // The beat shakes scales out of whatever wings there are.
            if (this.wing > 0.1) {
                this.emitWingDust(0.1, this.wing, 90 * this.dustShare(), {
                    delay: HUSH_HOLD, stagger: 0.5, vel: [0, 1.5, 6], spread: 3.2, life: [1.6, 3.2],
                });
            }
            this.counts.quads += 1;
        }
        if (deeper > 0) {
            // Each wave strikes the water under the chrysalis further out, and the silk rings.
            this.ring(HEART[0], HEART[2] + 6, birth, 0.6 + 0.15 * deeper, rgb, 1.3 + 0.45 * deeper);
            this.threadPulse(birth, 0, 0.6 + 0.12 * deeper, rgb);
            this.beatKick = Math.max(this.beatKick, 0.3 + 0.15 * deeper);
        }
        if (tspin) {
            this.storm = Math.max(this.storm, 0.85);
            this.beatKick = Math.max(this.beatKick, 0.6);
            if (!quad) this.strikeRing(this.time, 0.4);
        }
        if (b2b) this.backToBack(birth);
        if (perfect) {
            this.gild.hit(0.6, birth);
            this.starFlare.hit(1.2, birth);
        }
        this.counts.clears += 1;
    }

    /**
     * A back-to-back: the second difficult clear lays gold in the wings' veins and bands, rings
     * the silk in gold and makes the evening star flare. A streak of them deepens the gold.
     */
    backToBack(at) {
        this.gild.hit(1, at);
        this.starFlare.hit(0.7, at);
        this.threadPulse(at, 0, 1.2, GILT);
        this.beatKick = Math.max(this.beatKick, 0.5);
    }

    /**
     * A perfect clear that came after its clear (physics settles it ~360 ms after the last wave):
     * the crown on the clear still playing, never a second clear. No hush, no second swell: every
     * lily is relit in vesperfire from the chrysalis outward, the wings gild and beat, the evening
     * star flares, the aurora blazes, and the ring still crossing the frame takes its light.
     */
    onCrown() {
        if (!this.u) return;
        const t = this.time;
        this.gameplay.crown(t);
        const { blooms } = this;
        if (blooms) {
            for (let i = 0; i < blooms.count; i++) {
                const b = blooms.plan[i];
                blooms.strike(i, VESPERFIRE, t + swellPassTime(b.x, b.z) + 0.45, 1.3);
            }
        }
        this.surge = Math.min(1.6, Math.max(this.surge + 0.45, 1.3));
        this.storm = Math.max(this.storm, 1);
        this.eyeFlash = 1;
        this.wingFlash = Math.max(this.wingFlash, 1.2);
        this.beatKick = Math.max(this.beatKick, 0.8);
        this.gild.hit(0.9, t);
        this.starFlare.hit(1.4, t);
        this.ring(HEART[0], HEART[2] + 6, t, 1.2, VESPERFIRE, 3.6);
        this.threadPulse(t, 0, 1.3, VESPERFIRE);
        this.strikeRing(t, this.reducedMotion ? 0.3 : 0.6);
    }

    /** A T-spin that cleared nothing: the wings stroke once and the silk rings, softly. */
    onSpin() {
        if (!this.u) return;
        const t = this.time;
        this.gameplay.spin(t);
        this.storm = Math.max(this.storm, 0.45);
        this.beatKick = Math.max(this.beatKick, 0.4);
        this.wingFlash = Math.max(this.wingFlash, 0.35);
        this.threadPulse(t, 0, 0.7, this._palette.wingRoot);
        this.ring(HEART[0], HEART[2] + 6, t, 0.6, this._palette.wingMid, 1.3);
    }

    /**
     * The true combo changed. A lower number means the chain broke (0), or broke and a new one
     * has already begun (the game reports a break only with the next lock): either way the wings
     * that stood begin to MOULT, folding back from the margin over seconds toward the new
     * chain's step. A link of a new chain catches them wherever they stand (it holds them a
     * moment), and a step that reaches past them lifts them again: under fast play the wings
     * breathe with the play instead of vanishing on one piece that cleared nothing.
     */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        if (!this.u) {
            this.combo = n;
            return;
        }
        if (n < this.combo && this.wing > 0.05 && !this.moulting) {
            // The chain broke: the wings begin to moult.
            this.moulting = true;
            this.fallStart = this.time;
            this.fallFrom = this.wing;
            this.shed = 0;
            this.dip = Math.max(this.dip, 0.25);
            this.counts.falls += 1;
            // A shudder runs through them as the chain lets go: a first fall of scales from the margin.
            this.emitWingDust(this.wing * 0.6, this.wing, 70 * this.dustShare() * (0.4 + this.wing * 0.6), {
                stagger: 0.6, vel: [0, -0.3, 0.8], spread: 1.1, scatter: 2.2, life: [2.0, 3.8], size: 0.22,
            });
        } else if (n > this.combo) {
            this.threadPulse(this.time, 0, 0.8, this._palette.wingRoot);
            this.wingFlash = Math.max(this.wingFlash, 1);
            this.beatKick = Math.max(this.beatKick, 0.35);
            // A link catches folding wings: they hold where they stand a moment.
            if (this.moulting) this.caughtUntil = this.time + CATCH_HOLD;
            // Scales fly where the new band of wing is being written.
            const was = Math.max(0, this.wing);
            const next = wingForCombo(n);
            if (next > was + 0.01) {
                this.emitWingDust(was, next, 46 * this.dustShare(), { stagger: 0.55, life: [1.1, 2.2] });
            }
        }
        this.combo = n;
    }

    /** A new level: the evening moves on an hour. */
    levelUp(level, { silent = false } = {}) {
        const n = Number(level);
        this.level = Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1;
        this.paletteIndex = (this.level - 1) % VESPER_PALETTES.length;
        if (silent) this.applyPalette(1);
        else {
            this.storm = Math.max(this.storm, 0.8);
            this.flash = Math.max(this.flash, 0.12);
            this.strikeRing(this.time, 0.5);
            this.gameplay.levelUp(this.time);
        }
    }

    /** Ease the live palette toward the hour's (k = 1 snaps). */
    applyPalette(k) {
        const target = paletteAt(this.hourNow(), this._target);
        const p = this._palette;
        for (let i = 0; i < PALETTE_KEYS.length; i++) {
            const key = PALETTE_KEYS[i];
            for (let c = 0; c < 3; c++) p[key][c] += (target[key][c] - p[key][c]) * k;
        }
        this._night += (target.night - this._night) * k;
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    update(sim) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;
        const motion = this.reducedMotion ? 0.3 : 1;

        // ── The charge ──
        const target = powerForCombo(this.combo);
        this.power += (target - this.power) * approach(target > this.power ? 2.4 : 0.8, dt);
        this.surge *= Math.exp(-dt / SURGE_COOL);
        this.storm *= Math.exp(-dt / 1.7);
        this.flash *= Math.exp(-dt / 0.25);
        this.kick *= Math.exp(-dt / 0.16);
        // How hot play runs. (A frame of no time moves nothing: the reading stays as it was.)
        if (dt > 0) {
            const s = this.gameplay.sample(t);
            this.heat.punch = s.punch;
            this.heat.level = s.level;
            this.heat.fever = s.fever;
            this.heat.stage = s.stage;
        }
        const { level, fever } = this.heat;
        // Nothing under casual play: the evening only leans in once the hands are quick.
        const warm = smooth(0.18, 0.8, level);
        this.dip *= Math.exp(-dt / 0.35);
        this.wingFlash *= Math.exp(-dt / 0.45);
        this.eyeFlash *= Math.exp(-dt / 1.4);
        this.beatKick *= Math.exp(-dt / 0.5);
        this.fed *= Math.exp(-dt / 1.6);
        if (t >= this.pendingKick.time) {
            this.kick = Math.max(this.kick, this.pendingKick.amount);
            this.flash = Math.max(this.flash, this.pendingKick.amount * 0.45);
            this.pendingKick.time = Infinity;
        }
        if (t >= this.pendingFed.time) {
            const f = this.pendingFed;
            // It joins whatever glow is left: the colour turns toward the new light, it never jumps.
            const w = this.fed > 0 ? f.amount / (this.fed + f.amount) : 1;
            const rgb = u.fed.value;
            rgb.x += (f.rgb[0] - rgb.x) * w;
            rgb.y += (f.rgb[1] - rgb.y) * w;
            rgb.z += (f.rgb[2] - rgb.z) * w;
            this.fed = Math.min(1, Math.max(this.fed, f.amount) + 0.35 * Math.min(this.fed, f.amount));
            f.time = Infinity;
        }
        this.blooms?.tick(t);
        const hush = t < this.hushUntil ? 1 : 0;
        const breathTarget = hush ? this.hushFloor : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hush ? 40 : 14, dt);

        // ── The wings: they unfurl a step for every clear of the chain, and moult when it breaks ──
        const wingTarget = wingForCombo(this.combo);
        let folding = false;
        if (this.moulting) {
            // They fold back at an even pace from the margin, unless a new link is holding them.
            if (this.wing > wingTarget && t >= this.caughtUntil && dt > 0) {
                const was = this.wing;
                this.wing = Math.max(wingTarget, this.wing - dt / WING_FALL);
                this.shed += was - this.wing;
                folding = true;
            }
            // Folded down to the chain's step, or met by a new chain on its way up: done.
            if (this.wing <= wingTarget) this.moulting = false;
        }
        if (!this.moulting) {
            this.wing += (wingTarget - this.wing) * approach(wingTarget > this.wing ? 3.0 : 6, dt);
            if (Math.abs(wingTarget - this.wing) < 1e-3 && dt > 0) this.wing = wingTarget;
        }
        // The folding front sheds its scales as it goes.
        if (this.shed >= SHED_STEP || (this.shed > 0 && !folding)) {
            const v0 = Math.min(1, this.wing * 1.07);
            const v1 = Math.min(1, (this.wing + this.shed) * 1.07);
            this.emitWingDust(v0, v1, 200 * this.dustShare() * this.shed, {
                stagger: 0.25, vel: [0, -0.3, 0.8], spread: 1.1, scatter: 1.4, life: [1.8, 3.4], size: 0.22,
            });
            this.shed = 0;
        }
        // The front frays while it folds, and knits again when it stops (or is caught).
        const frayTarget = folding ? 1 : 0;
        this.fray += (frayTarget - this.fray) * approach(frayTarget > this.fray ? 4 : 2.2, dt);
        if (frayTarget === 0 && this.fray < 1e-3 && dt > 0) this.fray = 0;
        // Eyes on wings still standing that wide stay open while they fold; then they close.
        const standing = this.moulting ? this.wing : 0;
        const hindOpen = this.combo >= EYE_COMBO.hind || standing >= WING_STEPS[EYE_COMBO.hind]
            || this.eyeFlash > 0.3 ? 1 : 0;
        const foreOpen = this.combo >= EYE_COMBO.fore || standing >= WING_STEPS[EYE_COMBO.fore]
            || this.eyeFlash > 0.3 ? 1 : 0;
        this.eyeHind += (hindOpen - this.eyeHind) * approach(hindOpen ? 3.2 : 2.5, dt);
        this.eyeFore += (foreOpen - this.eyeFore) * approach(foreOpen ? 3.2 : 2.5, dt);
        const crackTarget = clamp01(this.combo / 6);
        this.crack += (crackTarget - this.crack) * approach(crackTarget > this.crack ? 2.4 : 0.9, dt);
        this.applyPalette(approach(0.7, dt));

        // ── The slow clock: the clouds, the water and the wings quicken as play heats ──
        this.drift += dt * motion
            * (1 + this.power * 1.6 + this.surge * 3 + this.storm * 1.2 + warm * 0.6 + fever * 0.7);
        // A slow stroke, as of something drying its wings; a clear makes them beat; in a fever
        // they beat by themselves, great slow strokes, as if to take off.
        // (It only ever swings AWAY from the viewer, so the tips never grow past the frame.)
        const slow = Math.sin(this.drift * 0.62) * 0.11 + Math.sin(this.drift * 0.23 + 1.1) * 0.05;
        const stroke = this.beatKick * (1 - Math.cos((1 - this.beatKick) * 7)) * 0.16;
        const flap = fever * FEVER_SWING * (0.5 - 0.5 * Math.cos(t * TAU * FEVER_STROKE));
        this.beat = -((0.16 + slow) + stroke + flap) * motion;

        // ── Uniforms ──
        let ringsLive = 0;
        for (let i = 0; i < RING_SLOTS; i++) {
            const age = t - u.ringA[i].value.z;
            if (age > -1 && age < RING_LIVE) ringsLive = 1;
        }
        let swellLive = 0;
        for (let i = 0; i < SWELL_SLOTS; i++) {
            const age = t - u.swellA[i].value.x;
            if (age > -1 && age < SWELL_LIVE) swellLive = 1;
        }
        let pulsesLive = 0;
        for (let i = 0; i < THREAD_PULSES; i++) {
            const age = t - u.pulseA[i].value.x;
            if (age > -1 && age < 3) pulsesLive = 1;
        }
        u.ringsLive.value = ringsLive;
        u.swellLive.value = swellLive;
        u.pulsesLive.value = pulsesLive;
        u.time.value = t;
        u.power.value = this.power;
        u.surge.value = this.surge;
        u.breath.value = this.breath;
        u.drift.value = this.drift;
        u.cloudDrift.value = this.drift * 0.0011;
        u.combo.value = this.combo;
        u.crack.value = this.crack;
        // A quick hand wakes the chrysalis into a lantern; a fever burns it.
        u.wake.value = clamp01(0.15 + this.power * 0.6 + this.fed * 0.3 + this.surge * 0.3 + this.storm * 0.12
            + warm * 0.18 + fever * 0.22);
        // The evening deepens with the pace: more stars, then the aurora.
        u.night.value = Math.min(1, this._night + warm * 0.22 + fever * 0.28);
        const restAurora = Math.max(0, this._night - 0.7) * 1.4;
        u.aurora.value = restAurora + Math.max(0, this.power - 0.45) * 1.3 + this.surge * 1.1 + this.storm * 0.12
            + warm * 0.3 + fever * 0.6;
        u.wing.value.set(this.wing, this.beat, this.fray, this.wingFlash + this.surge * 0.6);
        u.eyes.value.set(this.eyeHind, this.eyeFore, clamp01((this.combo - 8) / 6), this.eyeFlash);
        u.fed.value.w = this.fed;
        u.heat.value.set(warm, fever, this.gild.valueAt(t), this.starFlare.valueAt(t) + fever * 0.6);
        const p = this._palette;
        PALETTE_KEYS.forEach((key) => {
            u[key].value.set(p[key][0], p[key][1], p[key][2]);
        });
        if (fever > 0) {
            // In a fever the aurora takes the wings' own colours.
            const k = fever * 0.45;
            const a = p.auroraA;
            const b = p.auroraB;
            const m = p.wingMid;
            const e = p.wingEdge;
            u.auroraA.value.set(a[0] + (m[0] - a[0]) * k, a[1] + (m[1] - a[1]) * k, a[2] + (m[2] - a[2]) * k);
            u.auroraB.value.set(b[0] + (e[0] - b[0]) * k, b[1] + (e[1] - b[1]) * k, b[2] + (e[2] - b[2]) * k);
        }

        // ── Post ──
        const sinceClear = t - this.lastClear.time;
        const swell = sinceClear >= 0 ? Math.exp(-sinceClear / 0.7) * (0.3 + 0.12 * this.lastClear.lines) : 0;
        const post = this._post;
        // Every event's punch rides under the flash and the kick, so a quick hand never lets them drop.
        post.flash = this.flash + this.heat.punch * 0.04;
        post.kick = this.kick + this.heat.punch * 0.22;
        const shafts = 0.16 + this.power * 0.5 + swell * 0.3 + this.fed * 0.2 + this.surge * 0.3
            + warm * 0.2 + fever * 0.3;
        // The hush darkens the shafts as deeply as it holds the breath.
        post.shafts = hush ? 0.04 + (shafts - 0.04) * ((this.hushFloor - 0.14) / 0.86) : shafts;
        post.bloomBoost = this.surge * 0.1 + swell * 0.1;
        // The iris closes as the evening flares and as play heats, so its colours survive the surge.
        post.exposure = 1 / (1 + this.surge * 0.9 + swell * 0.3 + this.power * 0.2 + this.storm * 0.12
            + warm * 0.1 + fever * 0.22);
        const ringAge = t - this.shock.time;
        const ringOn = ringAge >= 0 && ringAge < PRISM_LIVE;
        post.prism.radius = ringOn ? ringAge * 1.25 + 0.02 : 0;
        post.prism.strength = ringOn ? Math.min(1, this.shock.strength * Math.exp(-ringAge / PRISM_FADE)) : 0;
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
            power: this.power,
            surge: this.surge,
            storm: this.storm,
            breath: this.breath,
            wing: this.wing,
            eyes: [this.eyeHind, this.eyeFore],
            level: this.level,
            palette: VESPER_PALETTES[this.paletteIndex].name,
            hour: this.hourNow(),
            counts: { ...this.counts },
            blooms: this.blooms ? this.blooms.count : 0,
            held: this.blooms ? this.blooms.totalHeld(this.time) : 0,
            dust: this.dust ? this.dust.count : 0,
            spires: this.parts.spires ? this.parts.spires.count : 0,
            threads: this.parts.threads ? this.parts.threads.count : 0,
            fireflies: this.parts.fireflies ? this.parts.fireflies.count : 0,
            mirror: Boolean(this.lake?.reflection),
            layoutLive: this.layoutLive,
            heart: { ...this.heart },
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scene?.remove(this.root);
        this.disposables.forEach((part) => {
            part.dispose?.();
            part.geometry?.dispose?.();
            part.material?.dispose?.();
        });
        this.lake?.reflection?.dispose?.();
        this.textures.forEach((t) => t.dispose());
        if (this._clear && this.renderer?.setClearColor) {
            this.renderer.setClearColor(this._clear.color, this._clear.alpha);
        }
        this._camera?.layers?.disable?.(HERO_LAYER);
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.lake = null;
        this.blooms = null;
        this.moths = null;
        this.dust = null;
        this.blades = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as VESPER_PARTS };
