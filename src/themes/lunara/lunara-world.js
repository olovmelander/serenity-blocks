/**
 * Lunara — the world.
 *
 * Owns the plan, the shared uniforms, every scene part, the camera rig and the choreography.
 * Shared by the theme (lunara-theme.js) and the playground effect
 * (src/playground/effects/lunara.effect.js), so what is iterated there ships.
 *
 * The valley is an instrument of crystal under twin moons, and the board plays it:
 *
 *   lock     a wisp of the piece's colour leaves the card and flies into a spire, which flashes
 *            from root to point and keeps some of that light; a ring in the same colour runs out
 *            over the flats from under the board and wakes the veins in the bed. A hard drop
 *            sends three wisps and hits harder.
 *   clear    the cleared rows leave the card as blades of moonlight, and a wave runs out through
 *            the valley, one front per line: every spire answers as it passes and lets go of the
 *            colours it was holding, the flowers flare, the aurora surges.
 *   combo    the valley charges: a halo ring forms round the great moon for every step of the
 *            chain, veins of light open across its face, the curtains fold and climb, the motes
 *            rise faster, the companion quickens in its orbit.
 *   four     the valley holds its breath — every light sinks for a fifth of a second — then a
 *            pillar stands on every spire, a prismatic ring crosses the sky from the great moon,
 *            its veins fire, and meteors fall.
 *
 * And it builds with play (src/themes/shared/gameplay-surge.js): nothing restarts, every hit adds
 * to what is still lit. As the hands quicken the clears stop emptying the shores and start filling
 * them — each wave leaves some of its light in every spire it passes and the spires keep what
 * they hold — so a chain lights both banks (and their mirror) in the colours played; the bed's
 * veins wake, the curtains climb and quicken, the motes rise, the companion hurries round the
 * great moon. Hot, the moon's veins open and shooting stars come often; in a fever every halo
 * ring burns, the curtains stand at full, the stones and the moon warm toward moonfire and the
 * meteors fall like rain. A cascade's waves each run brighter and in the next colour; a
 * back-to-back is answered by the companion (it blazes rose and lurches on its orbit). A perfect
 * clear crowns it all — every spire gives up its light as a pillar — and the end of a chain lets
 * the shores go; then the valley breathes back to its night.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 *
 * Layers: 0 = everything the flats mirror; 1 = what only the camera sees (wisps, row beams).
 */

import * as THREE from 'three/webgpu';
import { texture, uniform } from 'three/tsl';
import {
    CLEAR_AFTERGLOW,
    CLEAR_SLOTS,
    CLEAR_TRAVEL,
    DEG,
    HUSH_HOLD,
    LOCK_SLOTS,
    LUNARA_PALETTES,
    MOONFIRE,
    NOISE_SIZE,
    PALETTE_KEYS,
    RING_FADE,
    TAU,
    WISP_FLIGHT,
    approach,
    bakeNoise,
    celestialAnchors,
    clamp01,
    createHeightTexture,
    createNoiseTexture,
    createPlaceholderTexture,
    createValleyUniforms,
    mulberry32,
    pieceColor,
    powerForCombo,
    smooth,
} from './lunara-tsl.js';
import { buildPlan, strikeTargets } from './lunara-layout.js';
import { tierFor } from './lunara-quality.js';
import { MAX_RINGS, createMeteors, createSky } from './lunara-sky.js';
import { MOON_DISTANCE, createMoon } from './lunara-moons.js';
import { createBanks, createRanges } from './lunara-terrain.js';
import { createCrystals } from './lunara-crystals.js';
import { createWater } from './lunara-water.js';
import { createFlowers, createMotes } from './lunara-flora.js';
import { createRowBeams, createShards, createWisps } from './lunara-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './lunara-composition.js';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, SURGE_WEIGHTS, Swell } from '../shared/gameplay-surge.js';
import { flashScale } from '../../utils/photosensitivity.js';

/** The rest camera: standing in the flats, looking down the valley and a little up at the sky. */
export const REST_RIG = Object.freeze({
    height: 2.3,
    pitch: 5.2 * DEG,
    /** Horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 80,
    minFov: 44,
    maxFov: 74,
    near: 0.3,
    far: 16000,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/** The companion's orbit: radians per second at rest, and where it starts. */
export const ORBIT_RATE = TAU / 320;
export const ORBIT_START = -1.3;
/** Seconds the overdrive after a four-line clear takes to cool to 1/e. */
export const SURGE_COOL = 3.2;
/** The lowest tip (metres over the water) a wisp is sent to. */
export const MIN_TARGET_TIP = 1.2;
/** Seconds a ring / a clear wave stays in the valley (the shaders skip their loops after). */
const RING_LIVE = 5.5;
const CLEAR_LIVE = 8;
/**
 * Seconds a clear's wave takes to fade to 1/e once a newer wave has left after it: waves of a
 * cascade cross the water together, the newest brightest, the older ones handing over (summed at
 * full strength, four waves' fronts would light the whole range and veil the valley).
 */
const WAVE_HANDOFF = 0.45;
/** The brightest the curtains ever burn (at rest they sit at 0.3). */
export const AURORA_MAX = 1.45;
/** Seconds between the valley's own shooting stars. */
export const METEOR_BEAT = 19;
/** Where the moons' light comes from: off to the right, a little behind the viewer, so the great
 * moon stands gibbous with its terminator (and its relief) on the side away from the board. */
const SUN = new THREE.Vector3(0.95, 0.3, -0.15).normalize();
/** The moon map every moon in the fleet shares (Solar System Scope, CC BY 4.0: see CREDITS.md). */
export const MOON_MAP_URL = './textures/2k_moon.jpg';
/** Seconds the moons' faces take to fade in once the map has arrived. */
const MAP_FADE = 1.6;

const PARTS = [
    'sky', 'moon', 'companion', 'meteors', 'ranges', 'banks', 'water', 'crystals', 'glints', 'pillars',
    'flowers', 'motes', 'shards', 'wisps', 'beams',
];

export class LunaraWorld {
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
        this.noiseField = bakeNoise();
        this.plan = buildPlan(this.noiseField, NOISE_SIZE, seed);
        this.root = new THREE.Group();
        this.root.name = 'Lunara';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.reflection = null;
        this.moonMap = null;
        this.mapFade = null;
        this.mapReady = false;
        this.mapShown = 0;
        this.crystals = null;
        this.shards = null;
        this.wisps = null;
        this.beams = null;
        this.meteors = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        /** The great moon on screen (fractions, y down): where the post's shafts come from. */
        this.heart = { x: 0.24, y: 0.3 };
        this.targets = { left: [], right: [] };
        /** How near the middle the spires are drawn (1 in landscape; see the `squeeze` uniform). */
        this.squeeze = 1;
        this._camera = null;
        this._look = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._vec = new THREE.Vector3();
        this._e1 = new THREE.Vector3();
        this._e2 = new THREE.Vector3();
        this._moonDir = new THREE.Vector3(-0.3, 0.3, -0.9).normalize();
        this.moonAngle = 0.17;
        this._rest = new THREE.PerspectiveCamera(50, 16 / 9, REST_RIG.near, REST_RIG.far);
        this._point = { x: 0.5, y: 0.5 };
        this._strike = { x: 0, z: -12 };
        this._from = [0, 0, 0];
        this._tint = [0, 0, 0];
        this._tone = [0, 0, 0];
        this.waveStrength = new Float64Array(CLEAR_SLOTS);
        /** The spires a wave finds holding light (they throw dust as it passes). */
        this._holders = new Int32Array(14);
        this._palette = {};
        PALETTE_KEYS.forEach((key) => {
            this._palette[key] = [...LUNARA_PALETTES[0][key]];
        });
        this._post = {
            heart: this.heart, flash: 0, kick: 0, shafts: 0.25, bloomBoost: 0, exposure: 1,
        };
        /**
         * Envelopes that ACCUMULATE (src/themes/shared/swell.js): a hit adds to what is still lit
         * and never restarts it, so a weak event after a strong one can only lift the light.
         *   flash, kick  the post's lift and the lens's impact
         *   overdrive    a four-line clear's fire (it stacks: a quad after a perfect clear burns on)
         *   swell        a clear's flood of the moon's shafts and bloom
         *   twist        the curtains' turn on a T-spin
         *   companion    the rose moon answering a back-to-back
         */
        this.env = {
            flash: new Swell({ release: 0.25, ceiling: 0.6, knee: 0.35 }),
            kick: new Swell({ release: 0.16, ceiling: 1.1, knee: 0.6 }),
            overdrive: new Swell({
                release: SURGE_COOL, ceiling: 1.9, knee: 1.35, headroom: 1.3,
            }),
            swell: new Swell({ release: 0.7, ceiling: 1.1, knee: 0.75 }),
            twist: new Swell({ release: 0.6, ceiling: 1.6, knee: 1.05 }),
            companion: new Swell({
                attack: 0.08, release: 1.6, ceiling: 1.6, knee: 1,
            }),
        };
        /** How hot play runs, and its reading this frame (src/themes/shared/gameplay-surge.js). */
        this.play = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        this.resetState(0);
    }

    /** The lens's impact now. */
    get kick() {
        return this.env.kick.valueAt(this.time);
    }

    /** The post's event lift now. */
    get flash() {
        return this.env.flash.valueAt(this.time);
    }

    /** A four-line clear's overdrive now (0 at rest; a quad is 1, a perfect clear 1.3; they stack). */
    get surge() {
        return this.env.overdrive.valueAt(this.time);
    }

    /** How hard the curtains are turning from a T-spin now. */
    get twist() {
        return this.env.twist.valueAt(this.time);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.combo = 0;
        this.power = 0;
        this.storm = 0;
        this.level = 1;
        this.paletteIndex = 0;
        this.dip = 0;
        this.breath = 1;
        this.rings = 0;
        this.veins = 0;
        this.veinsFlare = 0;
        this.hushUntil = -1;
        /** How deep the hush of the last four-line clear went (1 from rest; shallow when hot). */
        this.hushDepth = 1;
        this.lockCursor = 0;
        this.clearCursor = 0;
        /** The clear slot written last, where the last clear's wave left from, and a quad's fire. */
        this.clearSlot = 0;
        this.heartX = 0;
        this.heartZ = -12;
        this.quadBirth = -100;
        /** When the last clear's front passes each spire (a view the waves' slots reuse). */
        this.passes = null;
        /** Each clear slot's strength as written (the uniform's own fades as newer waves take over). */
        this.waveStrength.fill(0);
        /** Shooting stars owed by hot play (one falls each time this passes 1). */
        this.meteorHeat = 0;
        Object.keys(this.env).forEach((key) => this.env[key].reset());
        this.play.reset();
        this.heat.punch = 0;
        this.heat.level = 0;
        this.heat.fever = 0;
        this.heat.stage = 0;
        this.counts = {
            locks: 0, clears: 0, quads: 0, wisps: 0,
        };
        // The slow clocks are functions of the world clock until gameplay bends them.
        const motion = this.reducedMotion ? 0.3 : 1;
        this.orbit = ORBIT_START + time * ORBIT_RATE;
        this.auroraDrift = time * 0.05 * motion;
        this.moteLift = time * motion;
        this.meteorBeat = Math.floor(time / METEOR_BEAT);
        this.crystals?.reset();
        this.shards?.reset();
        this.wisps?.reset();
        this.beams?.reset();
        this.meteors?.reset();
        if (this.u) {
            for (let i = 0; i < LOCK_SLOTS; i++) this.u.lockA[i].value.set(0, 0, -100, 0);
            for (let i = 0; i < CLEAR_SLOTS; i++) this.u.clearA[i].value.set(-100, 1, 0, 0);
            this.u.shock.value.set(-100, 0);
        }
    }

    build() {
        const noise = createNoiseTexture(this.noiseField, NOISE_SIZE);
        const heights = createHeightTexture(this.plan.heights);
        const blank = createPlaceholderTexture();
        this.textures.push(noise, heights, blank);
        const u = createValleyUniforms({ noise, heights });
        this.u = u;
        u.sunDir.value.copy(SUN);
        const { tier, plan } = this;

        this.addPart('sky', createSky(u, { curtains: tier.curtains, nebula: tier.nebula }));
        this.moonMap = texture(blank);
        this.mapFade = uniform(0);
        this.addPart('moon', createMoon(u, this.moonMap, this.mapFade, { relief: tier.relief }));
        this.addPart('companion', createMoon(u, this.moonMap, this.mapFade, { companion: true, relief: tier.relief }));
        this.meteors = createMeteors(u, tier.meteors);
        this.addPart('meteors', this.meteors);

        this.addPart('ranges', createRanges(u, plan));
        this.addPart('banks', createBanks(u, plan));
        const water = createWater(u, { reflectionScale: tier.reflection, glitter: tier.glitter });
        this.addPart('water', water);
        if (water.reflectorTarget) this.root.add(water.reflectorTarget);
        this.reflection = water.reflection;

        const stones = createCrystals(u, plan, { count: tier.crystals, dispersion: tier.dispersion });
        this.crystals = stones.crystals;
        this.addPart('crystals', stones.crystals);
        this.addPart('glints', stones.glints);
        if (stones.pillars) this.addPart('pillars', stones.pillars);

        if (tier.flowers > 0) this.addPart('flowers', createFlowers(u, plan, tier.flowers));
        if (tier.motes > 0) this.addPart('motes', createMotes(u, tier.motes));

        // ── Gameplay effects (pools, always drawn) ──
        this.shards = createShards(u, tier.shards);
        this.addPart('shards', this.shards);
        this.wisps = createWisps(u);
        this.addPart('wisps', this.wisps, { reflected: false });
        this.beams = createRowBeams(u);
        this.addPart('beams', this.beams, { reflected: false });

        this.applyPalette(1);
        this.composeSky();
        this.findTargets();
        this.scene.add(this.root);
        return this;
    }

    addPart(name, part, { reflected = true } = {}) {
        this.parts[name] = part;
        if (!reflected || part.reflected === false) part.mesh.layers.set(1);
        this.root.add(part.mesh);
        this.disposables.push(part);
    }

    /**
     * Fetch the moon map. Never awaited by the first frame: the moons stand as smooth lit
     * spheres until it arrives, then their faces fade in.
     * @returns {Promise<boolean>} true when the map is in
     */
    loadTextures() {
        return new Promise((resolve) => {
            const arrived = (tex) => {
                if (this.disposed) {
                    tex.dispose();
                    resolve(false);
                    return;
                }
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.ClampToEdgeWrapping;
                tex.anisotropy = 4;
                tex.generateMipmaps = true;
                tex.minFilter = THREE.LinearMipmapLinearFilter;
                tex.name = 'lunara-moon-map';
                this.textures.push(tex);
                this.moonMap.value = tex;
                this.mapReady = true;
                resolve(true);
            };
            try {
                new THREE.TextureLoader().load(MOON_MAP_URL, arrived, undefined, () => resolve(false));
            } catch {
                resolve(false); // no image decoding here (a headless host): the moons stay smooth
            }
        });
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
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            this.composeSky();
            this.findTargets();
        }
        if (!this.layoutLive) this.layout = fallbackLayout(this.aspect * 1000, 1000);
    }

    /**
     * The live board / card / HUD rects (screen fractions), or null when no board is on screen:
     * events then aim at where the solo board would be.
     */
    setLayout(rects, aspect) {
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) {
            this.aspect = aspect;
            this.composeSky();
        }
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(this.aspect * 1000, 1000);
        this.findTargets();
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Jump the clock (captures): drops every event in flight. */
    seek(time) {
        this.resetState(Math.max(0, time));
        this.applyPalette(1);
    }

    /** A new run: the valley back at rest (the sky keeps turning). */
    resetSession() {
        const {
            time, orbit, auroraDrift, moteLift, meteorBeat,
        } = this;
        this.resetState(time);
        Object.assign(this, {
            orbit, auroraDrift, moteLift, meteorBeat,
        });
        this.applyPalette(1);
    }

    /**
     * The camera sees layer 1 (wisps, row beams); the flats' mirror must not. Called once the
     * camera that will render the world is known.
     */
    bindCamera(camera) {
        camera.layers.enable(1);
        if (this.reflection) {
            const mirror = this.reflection.reflector.getVirtualCamera(camera);
            mirror.layers.set(0);
        }
    }

    // ── The sky's furniture ─────────────────────────────────────────────────────

    /** The rest camera for the current aspect (what the composition is measured in). */
    restCamera() {
        const cam = this._rest;
        cam.fov = fovForAspect(this.aspect);
        cam.aspect = this.aspect;
        cam.near = REST_RIG.near;
        cam.far = REST_RIG.far;
        cam.updateProjectionMatrix();
        cam.position.set(0, REST_RIG.height, 0);
        cam.up.set(0, 1, 0);
        cam.lookAt(0, REST_RIG.height + Math.tan(REST_RIG.pitch) * 10, -10);
        cam.updateMatrixWorld();
        return cam;
    }

    /** The unit direction a screen point (fractions, y down) looks along from the rest camera. */
    restDirection(sx, sy, out) {
        const cam = this.restCamera();
        return out.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(cam).sub(cam.position).normalize();
    }

    /**
     * Hang the great moon and the ringed world where the composition wants them for this aspect.
     */
    composeSky() {
        const { u } = this;
        if (!u) return;
        const anchors = celestialAnchors(this.aspect);
        this.squeeze = 0.5 + 0.5 * smooth(0.62, 1.25, this.aspect);
        u.squeeze.value = this.squeeze;
        const tanV = Math.tan((fovForAspect(this.aspect) * DEG) / 2);
        const moonDir = this.restDirection(anchors.moon.x, anchors.moon.y, this._moonDir);
        this.moonAngle = Math.atan(anchors.moon.radius * 2 * tanV);
        u.moonDir.value.copy(moonDir);
        this.parts.moon?.place(
            moonDir.x * MOON_DISTANCE,
            REST_RIG.height + moonDir.y * MOON_DISTANCE,
            moonDir.z * MOON_DISTANCE,
            MOON_DISTANCE * Math.sin(this.moonAngle),
        );
        this._e1.crossVectors(moonDir, this._vec.set(0, 1, 0)).normalize();
        this._e2.crossVectors(this._e1, moonDir).normalize();
        u.planetDir.value.copy(this.restDirection(anchors.planet.x, anchors.planet.y, this._vec));
        u.discs.value.set(this.moonAngle, this.moonAngle * 0.3, Math.atan(anchors.planet.radius * 2 * tanV), 0);
        this.placeCompanion();
    }

    /**
     * Move the companion along its orbit. The orbit is drawn in the sky's own plane; the
     * companion passes in front of the great moon on the lower half of its round and behind on
     * the upper (it changes shell while it stands clear beside it, which the eye cannot see).
     */
    placeCompanion() {
        const { u } = this;
        if (!u) return;
        const along = Math.cos(this.orbit) * 2.0 * this.moonAngle;
        const across = Math.sin(this.orbit) * 0.62 * this.moonAngle;
        // The orbit's long axis leans a little, up to the right (clear of the range).
        const lean = 0.35;
        const ox = along * Math.cos(lean) - across * Math.sin(lean);
        const oy = along * Math.sin(lean) + across * Math.cos(lean);
        const dir = this._vec.copy(this._moonDir).addScaledVector(this._e1, ox).addScaledVector(this._e2, oy).normalize();
        const shell = MOON_DISTANCE * (Math.sin(this.orbit) < 0 ? 0.7 : 1.3);
        u.companionDir.value.copy(dir);
        this.parts.companion?.place(
            dir.x * shell,
            REST_RIG.height + dir.y * shell,
            dir.z * shell,
            shell * Math.sin(this.moonAngle * 0.3),
        );
    }

    /**
     * Which spires a wisp can be sent to: the clustered ones the rest camera sees clear of the
     * card, split by the side of the card they stand on, nearest first.
     */
    findTargets() {
        const left = [];
        const right = [];
        if (this.crystals) {
            const cam = this.restCamera();
            const card = cardUnion(this.layout) || { x0: 0.4, x1: 0.6 };
            const centre = (card.x0 + card.x1) * 0.5;
            const n = strikeTargets(this.plan, this.crystals.count);
            for (let i = 0; i < n; i++) {
                const c = this.plan.crystals[i];
                this._vec.set(c.tip[0] - c.x * (1 - this.squeeze), c.tip[1], c.tip[2]).project(cam);
                // A wisp needs a spire that stands clear of the water.
                if (c.tip[1] < MIN_TARGET_TIP) continue;
                if (this._vec.z > 1 || Math.abs(this._vec.x) > 0.97 || this._vec.y > 0.97 || this._vec.y < -0.9) continue;
                const sx = this._vec.x * 0.5 + 0.5;
                if (sx > card.x0 - 0.01 && sx < card.x1 + 0.01) continue;
                const entry = { index: i, dist: Math.hypot(c.x, c.z) };
                (sx < centre ? left : right).push(entry);
            }
            const byDist = (a, b) => a.dist - b.dist;
            left.sort(byDist);
            right.sort(byDist);
        }
        this.targets = { left: left.map((e) => e.index), right: right.map((e) => e.index) };
    }

    // ── Camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        const calm = this.reducedMotion ? 0 : 1;
        // The lens dollies in on an impact (riding on the surge's punch under fast play) and leans
        // in a little, and stays leant in, the hotter play runs.
        const impact = this.env.kick.valueAt(t) + this.play.punch.valueAt(t) * 0.18;
        const lean = this.play.level.valueAt(t) * 0.7 + this.heat.fever * 0.5;
        const fov = fovForAspect(this.aspect) - (impact * 0.8 + lean) * calm;
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // A slow drift, as of someone standing in the water, plus the pointer leaning the view.
        const swayX = (Math.sin(t * 0.13) * 0.42 + Math.sin(t * 0.071 + 1.3) * 0.3) * calm;
        const swayY = (Math.sin(t * 0.19 + 0.7) * 0.05 + Math.sin(t * 0.083) * 0.04) * calm;
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        camera.position.set(swayX + px * 0.8, REST_RIG.height + swayY - py * 0.25 - impact * 0.05 * calm, 0);
        const yaw = (Math.sin(t * 0.09 + 2.1) * 0.01 - px * 0.028) * calm;
        const pitch = REST_RIG.pitch + (Math.sin(t * 0.11) * 0.005 - py * 0.016) * calm;
        this._look.set(
            camera.position.x + Math.sin(yaw) * 10,
            camera.position.y + Math.tan(pitch) * 10,
            -10,
        );
        camera.up.set(Math.sin(t * 0.07) * 0.004 * calm, 1, 0);
        camera.lookAt(this._look);
        // The shared breath (shared/camera-breath.js) on top of the drift above: the view only
        // turns (an eye in the water, looking out to the ranges), off under reduced motion.
        applyCameraBreath(camera, t, { scale: this.reducedMotion ? 0 : 1 });
        camera.updateMatrixWorld();
        this._camera = camera;
        // The great moon on screen: where the shafts come from.
        if (this.u) {
            this._ray.copy(this.u.moonDir.value).multiplyScalar(1000).add(camera.position).project(camera);
            this.heart.x = Math.max(-0.5, Math.min(1.5, this._ray.x * 0.5 + 0.5));
            this.heart.y = Math.max(-0.5, Math.min(1.5, 0.5 - this._ray.y * 0.5));
        }
    }

    /**
     * Where a ray through a screen point (fractions, y down) meets the flats. Points above the
     * horizon (or absurdly far) land `far` metres ahead instead.
     */
    screenToFlats(sx, sy, out = this._strike, far = 12) {
        const camera = this._camera;
        if (!camera) {
            out.x = 0;
            out.z = -far;
            return out;
        }
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position);
        const t = this._ray.y < -1e-4 ? -camera.position.y / this._ray.y : Infinity;
        const dist = Math.hypot(this._ray.x, this._ray.z) * t;
        if (!Number.isFinite(dist) || dist > 70) {
            const flat = Math.hypot(this._ray.x, this._ray.z) || 1;
            out.x = camera.position.x + (this._ray.x / flat) * far;
            out.z = camera.position.z + (this._ray.z / flat) * far;
            return out;
        }
        out.x = camera.position.x + this._ray.x * t;
        out.z = camera.position.z + this._ray.z * t;
        return out;
    }

    /** The world point `depth` metres along the ray through a screen point. */
    screenToWorld(sx, sy, depth, out = this._from) {
        const camera = this._camera;
        if (!camera) {
            out[0] = 0;
            out[1] = REST_RIG.height;
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

    /** Pick the spire a lock on `side` (−1 left, +1 right) strikes; nearer ones more often. */
    pickTarget(side, salt = 0) {
        let list = side < 0 ? this.targets.left : this.targets.right;
        if (!list.length) list = side < 0 ? this.targets.right : this.targets.left;
        if (!list.length) return -1;
        const rand = mulberry32(0x1f3d + (this.counts.locks + 1) * 2654435761 + salt * 97)();
        return list[Math.min(list.length - 1, Math.floor(rand ** 1.9 * list.length))];
    }

    /** Send one wisp from a world point into crystal `index`. Returns its arrival time. */
    sendWisp(index, from, rgb, amount, salt = 0) {
        const c = this.plan.crystals[index];
        if (!c || !this.wisps) return this.time;
        // It enters the stone somewhere in its upper half.
        const f = 0.55 + 0.35 * mulberry32(index * 31 + this.counts.wisps * 7 + salt)();
        const to = [c.x * this.squeeze + c.axis[0] * c.height * f, c.y + c.axis[1] * c.height * f, c.z + c.axis[2] * c.height * f];
        const dist = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
        const flight = this.reducedMotion ? 0.12 : WISP_FLIGHT * (0.75 + Math.min(1.4, dist / 34));
        const arrive = this.time + flight;
        this.wisps.launch({
            from,
            to,
            rgb,
            time: this.time,
            flight,
            lift: 0.6 + dist * 0.07,
            size: 0.22 + amount * 0.16,
            bow: (to[0] < from[0] ? -1 : 1) * dist * 0.05,
        });
        this.crystals.strike(index, rgb, arrive, amount);
        const share = this.shards.count / 512;
        this.shards.emit({
            x: to[0],
            y: to[1],
            z: to[2],
            n: Math.round((8 + 14 * amount) * share),
            rgb,
            time: arrive,
            out: [0.5, 2.2 + amount * 2.2],
            up: [0.2, 2.6 + amount * 1.6],
            size: 0.022 + c.height * 0.0022,
        });
        this.counts.wisps += 1;
        return arrive;
    }

    /**
     * Send a ring out over the flats from (x, z) at `time`; `reach` is a fraction of RING_REACH.
     * It takes the slot whose ring has faded most (the oldest of equals), so a quick hand's rings
     * fade out in turn instead of the newest wiping one still running.
     */
    ring(x, z, time, strength, rgb, reach = 1) {
        const { lockA, lockC } = this.u;
        let slot = 0;
        let weakest = Infinity;
        for (let i = 0; i < LOCK_SLOTS; i++) {
            const A = lockA[i].value;
            const age = this.time - A.z;
            // One still to come (or born this moment) is never the one to go.
            let left = A.w + 10;
            if (age > 0) left = age > RING_LIVE ? 0 : A.w * Math.exp(-age * RING_FADE);
            if (left < weakest - 1e-6 || (left <= weakest + 1e-6 && A.z < lockA[slot].value.z)) {
                weakest = Math.min(weakest, left);
                slot = i;
            }
        }
        this.lockCursor += 1;
        lockA[slot].value.set(x, z, time, strength);
        lockC[slot].value.set(rgb[0] * 1.4, rgb[1] * 1.4, rgb[2] * 1.4, reach);
    }

    /**
     * Ring the sky from the great moon. There is one ring: while it is still bright a new one adds
     * to it (it runs on, brighter) instead of starting over, so a T-spin or a new level right
     * after a four-line clear never swaps its ring for a smaller one.
     */
    shockRing(strength, at) {
        const shock = this.u?.shock.value;
        if (!shock || !(strength > 0)) return;
        const age = at - shock.x;
        const left = age > 0 ? shock.y * Math.exp(-1.3 * age) : shock.y;
        if (left > strength * 0.5 && age < 1.6) {
            const grow = age > 0 ? Math.exp(1.3 * age) : 1;
            shock.y = Math.min(1.4 * grow, shock.y + strength * 0.6 * grow);
        } else {
            shock.set(at, strength);
        }
    }

    /** Throw crystal dust off the points of the spires that held light as a wave reaches them. */
    dustOff(holders, count, passes, rgb, big) {
        const share = this.shards.count / 512;
        for (let k = 0; k < count; k++) {
            const i = holders[k];
            const c = this.plan.crystals[i];
            this.shards.emit({
                x: c.tip[0] - c.x * (1 - this.squeeze),
                y: c.tip[1],
                z: c.tip[2],
                n: Math.round((big ? 22 : 12) * share),
                rgb,
                time: passes[i],
                out: [0.6, 4.5],
                up: [1.2, 5.5],
                life: [1.0, 2.2],
                size: 0.024 + c.height * 0.0024,
            });
        }
    }

    /** Up to 14 spires holding light at `time` (into this._holders); returns how many. */
    findHolders(time) {
        const out = this._holders;
        let count = 0;
        for (let i = 0; i < this.crystals.count && count < out.length; i++) {
            if (this.crystals.heldAt(i, time) > 0.12) {
                out[count] = i;
                count += 1;
            }
        }
        return count;
    }

    /**
     * A piece locked. `u` = its column as a fraction of the board width, `rows` = the visible
     * rows it covers, `color` = the piece's colour; `screen` (fractions) replaces the board point.
     */
    onLock({
        u = 0.5, rows = null, hardDrop = false, color = null, player = 0, screen = null,
    } = {}) {
        const { u: uniforms } = this;
        if (!uniforms || !this.crystals) return;
        const rgb = pieceColor(color);
        // ── The ring: the piece lands in the flats under the foot of the board ──
        let fx = 0.5;
        let fy = 0.94;
        let wx = 0.5;
        let wy = 0.6;
        let side = u < 0.5 ? -1 : 1;
        if (Math.abs(u - 0.5) < 0.03) side = this.counts.locks % 2 ? 1 : -1;
        if (screen) {
            fx = screen.x;
            fy = Math.max(screen.y, 0.7);
            wx = screen.x;
            wy = screen.y;
            side = screen.x < 0.5 ? -1 : 1;
        } else {
            const board = boardFor(this.layout, player);
            const card = cardUnion(this.layout);
            if (board) {
                const row = Array.isArray(rows) && rows.length ? rows[Math.floor(rows.length / 2)] : 19;
                boardPoint(board, u, row, this._point);
                fx = this._point.x;
                fy = Math.max(board.y1, 0.72);
                // The wisp leaves the card's edge on the piece's side, at the piece's height.
                const edges = card || board;
                wx = side < 0 ? edges.x0 : edges.x1;
                wy = this._point.y;
            }
        }
        const strike = this.screenToFlats(fx, fy);
        this.ring(strike.x, strike.z, this.time, hardDrop ? 1.25 : 0.8, rgb, 1);

        // ── The wisp: the piece's light flies into a spire ──
        const from = this.screenToWorld(wx, wy, 6.5);
        const target = this.pickTarget(side);
        if (target >= 0) {
            const arrive = this.sendWisp(target, from, rgb, hardDrop ? 1.3 : 0.85);
            // The spire rings: a smaller ripple leaves its foot when the wisp arrives.
            const c = this.plan.crystals[target];
            this.ring(c.x * this.squeeze, c.z, arrive, hardDrop ? 0.95 : 0.65, rgb, 0.36);
            if (hardDrop) {
                // Two more into its neighbours.
                for (let k = 1; k <= 2; k++) {
                    const other = this.pickTarget(side, k);
                    if (other >= 0 && other !== target) this.sendWisp(other, from, rgb, 0.6, k);
                }
            }
        }
        this.env.kick.hit(hardDrop ? 0.5 : 0.1, this.time);
        this.env.flash.hit(hardDrop ? 0.1 : 0.02, this.time);
        this.play.lock({ hardDrop }, this.time);
        this.counts.locks += 1;
    }

    /**
     * Lines cleared. `lines` 1..4; `combo` = the true consecutive-clear combo; `cascade` = which
     * wave of the lock's cascade this is (1 = the first); `tspin`, `perfect`, `b2b`. A clear with
     * no lines of its own (`lines: 0`) is a perfect clear settled after the clear it crowns
     * (`crown` or `perfect`) or a T-spin that cleared nothing.
     */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, b2b = false, crown = false,
        cascade = 1, combo = 1, player = 0, screen = null,
    } = {}) {
        const { u: uniforms } = this;
        if (!uniforms || !this.crystals) return;
        const lineless = Number(lines) === 0 || crown === true;
        if (lineless && (perfect || crown)) {
            this.crownValley();
            return;
        }
        if (lineless && tspin) {
            this.turnSky();
            return;
        }
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        /** Waves of this lock's cascade before this one: each runs out brighter, in the next colour. */
        const depth = Math.max(0, Math.min(9, Math.round(Number(cascade) || 1) - 1));
        const p = this._palette;
        // How hot play ran before this clear (its own heat is added below).
        const level = this.play.level.valueAt(this.time);
        const { fever } = this.heat;
        // One line answers in the bed's light, two in the moon's glow, three in both at once; each
        // later wave of a cascade in the next of them (the companion's rose is kept for a
        // back-to-back).
        let rgb;
        const hue = (n - 1 + depth) % 3;
        if (quad) rgb = [...MOONFIRE];
        else if (hue === 0) rgb = [...p.bed];
        else if (hue === 1) rgb = [0, 1, 2].map((c) => p.glow[c] * 0.8 + p.moon[c] * 0.3);
        else rgb = [0, 1, 2].map((c) => p.auroraLow[c] * 0.6 + p.auroraHigh[c] * 0.6 + 0.2);
        // A back-to-back runs in the companion's colour: the rose moon answers the great one.
        if (b2b) rgb = rgb.map((c, k) => c * 0.5 + p.companion[k] * 0.65);
        const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
        rgb = rgb.map((c) => (c / peak) * 0.92 + 0.08);
        const strength = Math.min(1.9, (0.62 + 0.14 * n + (quad ? 0.25 : 0)) * (1 + 0.1 * depth));
        const birth = quad ? this.time + HUSH_HOLD : this.time;

        // ── The wave leaves the foot of the board ──
        const board = boardFor(this.layout, player);
        const card = cardUnion(this.layout);
        const heart = screen
            ? this.screenToFlats(screen.x, Math.max(screen.y, 0.7))
            : this.screenToFlats(board ? (board.x0 + board.x1) * 0.5 : 0.5, board ? Math.max(board.y1, 0.72) : 0.94);
        uniforms.heart.value.set(heart.x, heart.z);
        this.heartX = heart.x;
        this.heartZ = heart.z;
        // The slot whose wave has faded most (the oldest of equals): a cascade's waves cross the
        // water side by side, and none is wiped mid-valley by the one after it.
        let slot = 0;
        let weakest = Infinity;
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            const A = uniforms.clearA[i].value;
            const age = this.time - A.x;
            let left = A.z;
            if (age > 0) left = age > CLEAR_LIVE ? 0 : A.z * Math.exp(-age / (CLEAR_TRAVEL + CLEAR_AFTERGLOW));
            if (left < weakest - 1e-6 || (left <= weakest + 1e-6 && A.x < uniforms.clearA[slot].value.x)) {
                weakest = Math.min(weakest, left);
                slot = i;
            }
        }
        this.clearSlot = slot;
        this.clearCursor += 1;
        // A deep wave runs a longer train of fronts.
        const fronts = perfect ? 4 : Math.min(4, n + (depth >= 2 ? 1 : 0));
        uniforms.clearA[slot].value.set(birth, fronts, strength, quad ? 1 : 0);
        this.waveStrength[slot] = strength;
        uniforms.clearC[slot].value.set(rgb[0] * 1.25, rgb[1] * 1.25, rgb[2] * 1.25);
        this.env.swell.hit(0.3 + 0.12 * n + 0.06 * depth, birth);

        // ── Every spire answers as the wave passes it ──
        // It flares in what it holds. Cold, it then lets most of that go (as a clear always has) and
        // takes nothing of the wave; the hotter play runs and the deeper the cascade, the more it
        // keeps and the more of the wave's own light it takes, so a chain fills both banks with
        // the colours it plays.
        // What a spire takes of the wave is its colour at full saturation (pastel light, piled up,
        // would only wash the banks white), and only ever a glow: the stones keep their darks.
        const hot = smooth(0.12, 0.6, level);
        const keep = quad ? 0.15 + 0.6 * hot : Math.min(1, 0.3 + 0.7 * hot + 0.12 * depth);
        const lo = Math.min(rgb[0], rgb[1], rgb[2]) * 0.8;
        const span = Math.max(rgb[0], rgb[1], rgb[2]) - lo;
        for (let c = 0; c < 3; c++) this._tone[c] = (rgb[c] - lo) / Math.max(span, 1e-4);
        const holders = this.findHolders(birth);
        const { released, passes } = this.crystals.release(birth, heart.x, heart.z, this._tone, strength, {
            pillar: quad ? 1 : 0,
            squeeze: this.squeeze,
            keep,
            // The glow a spire keeps rises with the heat: every clear lets go of the light above it.
            hold: 0.2 + 0.3 * hot + 0.1 * fever,
            charge: (0.08 * hot + 0.02 * depth) * strength,
            cap: 0.05 + 0.15 * hot + 0.1 * fever + 0.02 * depth,
        });
        this.dustOff(this._holders, holders, passes, rgb, quad);
        this.passes = passes;
        const stir = 0.3 + 0.14 * n + released * 0.06 + (quad ? 0.4 : 0) + depth * 0.08;
        this.storm = Math.max(this.storm, Math.min(1.4, stir));
        // The lens takes the hit a beat later, on top of whatever is still ringing.
        const thump = 0.22 + 0.1 * n + 0.05 * depth;
        this.env.kick.hit(thump, birth + 0.12);
        this.env.flash.hit(thump * 0.5, birth + 0.12);

        // ── The cleared rows leave the card as blades of moonlight ──
        if (board && card && this.layoutLive && !screen) {
            const list = Array.isArray(rows) && rows.length ? rows : Array.from({ length: n }, (_, i) => 19 - i);
            const ys = [];
            for (let i = 0; i < list.length && i < 4; i++) ys.push(boardPoint(board, 0.5, list[i], this._point).y);
            this.beams.fire(ys, card.x0, card.x1, rgb, this.time, Math.min(1.4, (0.7 + 0.18 * n) * (1 + 0.1 * depth)));
        }

        if (quad) {
            // The valley holds its breath, then everything fires. As deep as play is cold: from
            // rest it all but goes out; in a fever it only inhales. (Reduce flashing keeps it
            // shallow: a frame-wide dark is a flash too, ADR-0021.)
            this.hushUntil = this.time + HUSH_HOLD;
            this.hushDepth = Math.max(0, 1 - 0.8 * level) * flashScale();
            this.env.overdrive.hit(perfect ? 1.3 : 1, this.time);
            this.veinsFlare = 1.5;
            this.shockRing(this.reducedMotion ? 0.5 : 1, birth);
            this.meteors?.emit({
                n: Math.round(this.meteors.count * 0.6), time: birth + 0.15, rgb: [1.0, 0.92, 0.8], stagger: 1.7, size: 2.6,
            });
            this.counts.quads += 1;
            this.quadBirth = birth;
        } else if (n === 3) {
            this.veinsFlare = Math.max(this.veinsFlare, 0.7);
            this.meteors?.emit({
                n: 3, time: birth + 0.2, rgb: p.moon, stagger: 0.6,
            });
        }
        if (depth > 0) {
            // Each wave of a cascade opens the moon's veins wider and, from the third, rings the sky.
            this.veinsFlare = Math.max(this.veinsFlare, Math.min(1.2, 0.3 + 0.2 * depth));
            if (depth >= 2) this.shockRing(Math.min(0.5, 0.12 * depth), birth);
        }
        if (tspin) {
            // The sky itself turns: a small ring from the moon, and the curtains twist.
            this.shockRing(0.42, this.time);
            this.storm = Math.max(this.storm, 0.85);
            this.env.twist.hit(1, this.time);
        }
        if (b2b) {
            // The companion answers: the rose moon blazes and lurches on round the great one, and
            // stars fall from it. A second back-to-back adds to the first: it blazes brighter.
            this.env.companion.hit(1, birth);
            this.shockRing(0.25, birth);
            const cd = uniforms.companionDir.value;
            this.meteors?.emit({
                n: 2, time: birth + 0.1, rgb: p.companion, stagger: 0.5, from: [cd.x, cd.y, cd.z],
            });
        }
        this.play.clear({
            lines: n, cascade: depth + 1, combo, tspin, perfect, b2b,
        }, birth);
        this.counts.clears += 1;
    }

    /**
     * A perfect clear, settled after the clear it crowns (physics sends it ~0.36 s after the last
     * wave, in a frame of its own). Not a second clear: no second hush, no second wave on the
     * water. The valley lets go of everything it holds — every spire that held light gives it up
     * as a pillar as a slow front reaches it (one still standing burns brighter) — the moonfire
     * still on the water flares, the moon burns hotter and its veins blaze, the sky's ring runs
     * on brighter and the rest of the meteors fall.
     */
    crownValley() {
        const { u } = this;
        // Land on the fire, never before it (a perfect clear inside the hush waits for the breath).
        const at = Math.max(this.time, this.quadBirth);
        let live = -1;
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            const A = u.clearA[i].value;
            if (A.w > 0.5 && this.time - A.x < CLEAR_LIVE && (live < 0 || A.x > u.clearA[live].value.x)) live = i;
        }
        if (live >= 0) {
            u.clearA[live].value.y = 4;
            this.waveStrength[live] = Math.min(1.9, this.waveStrength[live] * 1.35);
            u.clearA[live].value.z = this.waveStrength[live];
        }
        const holders = this.findHolders(at);
        const { passes } = this.crystals.release(at, this.heartX, this.heartZ, MOONFIRE, 1.2, {
            pillar: 1.2, every: true, squeeze: this.squeeze, keep: 0, flare: 2.6, slow: 1.25,
        });
        this.dustOff(this._holders, holders, passes, MOONFIRE, true);
        this.env.overdrive.hit(0.5, at);
        this.env.swell.hit(0.6, at);
        this.env.flash.hit(0.12, at);
        this.env.kick.hit(0.3, at);
        this.veinsFlare = 1.5;
        this.storm = Math.max(this.storm, 1.2);
        this.shockRing(this.reducedMotion ? 0.4 : 0.8, at);
        this.meteors?.emit({
            n: Math.round(this.meteors.count * 0.4), time: at + 0.1, rgb: [1.0, 0.92, 0.8], stagger: 1.4, size: 2.4,
        });
        this.play.clear({ lines: 1, perfect: true }, at);
    }

    /** A T-spin that cleared nothing: the sky turns a little — the curtains twist, a faint ring leaves the moon. */
    turnSky() {
        this.env.twist.hit(0.55, this.time);
        this.storm = Math.max(this.storm, 0.45);
        this.shockRing(0.2, this.time);
        this.play.punch.hit(SURGE_WEIGHTS.punch.tspin, this.time);
        this.play.level.hit(SURGE_WEIGHTS.heat.tspin * 0.5, this.time);
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        if (n === 0 && this.combo >= 2) {
            // The chain broke: the valley lets its breath go. Every spire gives up the light the
            // chain left in it, in a slow front out from the board (light rising off its point),
            // and a breath of dark follows — shallow the hotter play ran: the release is the light.
            this.dip = Math.max(this.dip, 0.28 * (1 - 0.6 * this.play.level.valueAt(this.time)));
            if (this.crystals && this.shards) {
                const holders = this.findHolders(this.time);
                const { passes } = this.crystals.release(this.time, this.heartX, this.heartZ, this._palette.moon, 0.5, {
                    squeeze: this.squeeze, keep: 0, flare: 2.4, slow: 1.6,
                });
                this.dustOff(this._holders, holders, passes, this._palette.moon, false);
            }
        }
        this.combo = n;
    }

    /** A new level: the valley changes its colours. */
    levelUp(level, { silent = false } = {}) {
        this.level = Math.max(1, Math.round(Number(level) || 1));
        this.paletteIndex = (this.level - 1) % LUNARA_PALETTES.length;
        if (silent) this.applyPalette(1);
        else {
            this.storm = Math.max(this.storm, 0.75);
            this.env.flash.hit(0.14, this.time);
            this.shockRing(0.36, this.time);
            this.meteors?.emit({
                n: 2, time: this.time + 0.3, rgb: LUNARA_PALETTES[this.paletteIndex].moon, stagger: 0.8,
            });
            this.play.levelUp(this.time);
        }
    }

    /** Ease the live palette toward the level's (k = 1 snaps). */
    applyPalette(k) {
        const target = LUNARA_PALETTES[this.paletteIndex];
        const p = this._palette;
        for (let i = 0; i < PALETTE_KEYS.length; i++) {
            const key = PALETTE_KEYS[i];
            for (let c = 0; c < 3; c++) p[key][c] += (target[key][c] - p[key][c]) * k;
        }
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;
        const motion = this.reducedMotion ? 0.3 : 1;
        // What has come due in the spires (strikes landing, waves passing), in time order.
        this.crystals?.advance(t);

        // ── The charge ──
        const target = powerForCombo(this.combo);
        this.power += (target - this.power) * approach(target > this.power ? 2.4 : 0.8, dt);
        // How hot play runs: the chain charges the valley, and so does the pace of the hands.
        const heat = this.play.sample(t);
        this.heat.punch = heat.punch;
        this.heat.level = heat.level;
        this.heat.fever = heat.fever;
        this.heat.stage = heat.stage;
        const { level, fever } = heat;
        const drive = Math.min(1.1, this.power + level * 0.35 + fever * 0.2);
        const { surge, twist } = this;
        const answer = this.env.companion.valueAt(t);
        this.storm *= Math.exp(-dt / 1.7);
        this.dip *= Math.exp(-dt / 0.35);
        this.veinsFlare *= Math.exp(-dt / 2.4);
        const hush = t < this.hushUntil ? this.hushDepth : 0;
        const breathTarget = hush > 0 ? 1 - 0.88 * hush : 1 - this.dip;
        this.breath += (breathTarget - this.breath) * approach(hush > 0 ? 40 : 14, dt);
        if (dt === 0) this.breath = breathTarget;

        // One halo ring for every step of the chain past the first (all of them in a fever);
        // veins from the third, wide open in a fever.
        const ringTarget = Math.max(0, Math.min(MAX_RINGS, Math.max(this.combo - 1, fever * MAX_RINGS)));
        this.rings += (ringTarget - this.rings) * approach(ringTarget > this.rings ? 5 : 1.4, dt);
        const veinTarget = smooth(0.35, 1.0, drive) * 0.8 + fever * 0.35;
        this.veins += (veinTarget - this.veins) * approach(1.6, dt);
        this.applyPalette(approach(0.8, dt));

        // ── The slow clocks ──
        // The companion quickens with the chain and the heat (and lurches on when it answers a
        // back-to-back); held still under reduced motion.
        const lean = this.reducedMotion ? 0 : 1;
        const hurry = this.power * 5 + surge * 10 + Math.max(0, level - 0.15) * 5 + fever * 8 + answer * 22;
        this.orbit += dt * ORBIT_RATE * (1 + hurry * lean);
        this.auroraDrift += dt * motion * (0.05 + this.power * 0.16 + this.storm * 0.38 + surge * 0.3 + twist * 1.6
            + level * 0.14 + fever * 0.3);
        this.moteLift += dt * motion * (1 + this.power * 4 + surge * 5 + this.storm * 2 + level * 3 + fever * 4);
        this.placeCompanion();

        // A shooting star now and then, on the valley's own clock.
        const beat = Math.floor(t / METEOR_BEAT);
        if (beat !== this.meteorBeat) {
            this.meteorBeat = beat;
            if (dt > 0 && this.meteors) {
                this.meteors.emit({
                    n: 1, time: t + 0.2 + (beat % 3) * 0.9, rgb: this._palette.moon, size: 2.0,
                });
            }
        }
        // And as play runs hot, more and more of them: in a fever they fall like rain.
        const shower = Math.max(0, level - 0.45) * 1.4 + fever * 2.6;
        if (dt > 0 && this.meteors && shower > 0) {
            this.meteorHeat = Math.min(3, this.meteorHeat + dt * shower * (this.reducedMotion ? 0.4 : 1));
            if (this.meteorHeat >= 1) {
                this.meteorHeat -= 1;
                const k = clamp01(fever);
                const m = this._palette.moon;
                this._tint[0] = m[0] + (MOONFIRE[0] - m[0]) * k;
                this._tint[1] = m[1] + (MOONFIRE[1] - m[1]) * k;
                this._tint[2] = m[2] + (MOONFIRE[2] - m[2]) * k;
                this.meteors.emit({
                    n: 1, time: t + 0.05, rgb: this._tint, size: 1.8 + fever * 0.8,
                });
            }
        }

        // ── Uniforms ──
        let ringsLive = 0;
        for (let i = 0; i < LOCK_SLOTS; i++) {
            if (t - u.lockA[i].value.z < RING_LIVE) ringsLive = 1;
        }
        let clearLive = 0;
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            const A = u.clearA[i].value;
            if (t - A.x < CLEAR_LIVE) clearLive = 1;
            // A wave hands over to the next one to leave after it: it runs on, fading.
            let next = Infinity;
            for (let k = 0; k < CLEAR_SLOTS; k++) {
                const born = u.clearA[k].value.x;
                if (k !== i && born > A.x && born < next) next = born;
            }
            A.z = this.waveStrength[i] * (t > next ? Math.exp(-(t - next) / WAVE_HANDOFF) : 1);
        }
        u.ringsLive.value = ringsLive;
        u.clearLive.value = clearLive;
        u.time.value = t;
        u.power.value = drive;
        // The stones and the bed burn with a four-line clear's fire, and with a fever's.
        u.surge.value = surge + fever * 0.2;
        u.breath.value = this.breath;
        // (Capped: a storm on top of a long chain must leave the sky its darks.)
        u.aurora.value = Math.min(AURORA_MAX, 0.3 + this.power * 0.6 + this.storm * 0.8 + surge * 0.35
            + level * 0.3 + fever * 0.5);
        u.auroraDrift.value = this.auroraDrift;
        u.moteLift.value = this.moteLift;
        u.rings.value = this.rings;
        u.veins.value = Math.max(this.veins, this.veinsFlare);
        const p = this._palette;
        // The great moon warms toward moonfire with a four-line clear, and in a fever.
        const fire = clamp01(surge * 0.55 + fever * 0.3);
        const warm = (key, node, gain = 1) => {
            const c = p[key];
            node.value.set(
                (c[0] + (MOONFIRE[0] - c[0]) * fire) * gain,
                (c[1] + (MOONFIRE[1] - c[1]) * fire) * gain,
                (c[2] + (MOONFIRE[2] - c[2]) * fire) * gain,
            );
        };
        warm('moon', u.moonCol);
        // The rose companion blazes when it answers a back-to-back.
        const rose = 1 + answer * 1.4 + fever * 0.15;
        u.companionCol.value.set(p.companion[0] * rose, p.companion[1] * rose, p.companion[2] * rose);
        u.zenith.value.set(p.zenith[0], p.zenith[1], p.zenith[2]);
        // (The haze lifts only a little with the heat: it is what every distance fades into.)
        const lift = 1 + this.power * 0.2 + this.storm * 0.1 + level * 0.04 + fever * 0.05;
        u.horizon.value.set(p.horizon[0] * lift, p.horizon[1] * lift, p.horizon[2] * lift);
        warm('glow', u.glow, lift);
        u.auroraLow.value.set(p.auroraLow[0], p.auroraLow[1], p.auroraLow[2]);
        // In a fever the curtains' crowns blush toward the companion's rose: the sky has opened.
        const blush = fever * 0.55;
        u.auroraHigh.value.set(
            p.auroraHigh[0] + (p.companion[0] - p.auroraHigh[0]) * blush,
            p.auroraHigh[1] + (p.companion[1] - p.auroraHigh[1]) * blush,
            p.auroraHigh[2] + (p.companion[2] - p.auroraHigh[2]) * blush,
        );
        u.bed.value.set(p.bed[0], p.bed[1], p.bed[2]);
        u.crystal.value.set(p.crystal[0], p.crystal[1], p.crystal[2]);

        // The moons' faces fade in when the map arrives (at once in a capture).
        if (this.mapReady && this.mapShown < 1) {
            this.mapShown = this.capture ? 1 : Math.min(1, this.mapShown + dt / MAP_FADE);
            this.mapFade.value = this.mapShown * this.mapShown * (3 - 2 * this.mapShown);
        }
        const sky = this.parts.sky?.mesh;
        if (sky && camera) {
            sky.position.copy(camera.position);
            sky.updateMatrix();
            sky.updateMatrixWorld(true);
        }

        // ── Post ──
        // (A clear's flood of light is frame-wide: Reduce flashing keeps it to a glimmer, ADR-0021.)
        const swell = this.env.swell.valueAt(t) * flashScale();
        const post = this._post;
        post.flash = this.flash;
        post.kick = this.kick + heat.punch * 0.18;
        // The moon's shafts stream harder with the charge and the heat; a hush draws them in.
        const shafts = 0.24 + drive * 0.12 + swell * 0.2 + level * 0.03 + fever * 0.08;
        const drawn = hush > 0 ? clamp01((1 - this.breath) / 0.88) : 0;
        post.shafts = shafts + (0.05 - shafts) * drawn;
        post.bloomBoost = surge * 0.1 + swell * 0.1 + level * 0.04 + fever * 0.08;
        // The iris closes a little as the valley flares and as play heats, so its colours stay
        // saturated; most of the build-up is let through, so the valley brightens with play.
        post.exposure = 1 / (1 + surge * 0.25 + swell * 0.2 + this.power * 0.14 + this.storm * 0.08
            + level * 0.06 + fever * 0.05);
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
            heat: { ...this.heat },
            rings: this.rings,
            veins: Math.max(this.veins, this.veinsFlare),
            level: this.level,
            palette: LUNARA_PALETTES[this.paletteIndex].name,
            counts: { ...this.counts },
            held: this.crystals ? this.crystals.totalHeld(this.time) : 0,
            crystals: this.crystals ? this.crystals.count : 0,
            targets: { left: this.targets.left.length, right: this.targets.right.length },
            flowers: this.parts.flowers ? this.parts.flowers.count : 0,
            motes: this.parts.motes ? this.parts.motes.count : 0,
            shards: this.shards ? this.shards.count : 0,
            reflection: this.tier.reflection,
            mapReady: this.mapReady,
            layoutLive: this.layoutLive,
            heart: { ...this.heart },
            orbit: this.orbit,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scene?.remove(this.root);
        this.disposables.forEach((part) => {
            part.geometry?.dispose?.();
            part.material?.dispose?.();
        });
        this.reflection?.dispose?.();
        this.textures.forEach((t) => t.dispose());
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.reflection = null;
        this.moonMap = null;
        this.mapFade = null;
        this.crystals = null;
        this.shards = null;
        this.wisps = null;
        this.beams = null;
        this.meteors = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as LUNARA_PARTS };
