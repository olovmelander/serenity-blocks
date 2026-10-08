/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Koi Pond — the world.
 *
 * Owns the shared light, the water's simulation, every scene part, the koi, the camera rig and
 * the choreography. Shared by the theme (koi-pond-theme.js) and the playground effect
 * (src/playground/effects/koi-pond.effect.js), so what is iterated there ships.
 *
 * The board floats over a moonlit pond and everything it does falls into the water:
 *
 *   lock     the piece drops through the card into the pond: a train of rings spreads from
 *            under its column, carrying a band of the piece's own colour across the bed and
 *            the backs of the fish; spray leaves the card's edge beside it and the koi there
 *            dart away. A hard drop throws a crown of water and scatters the whole reach.
 *   clear    koi leap: one for a line, a pair for two, three with a turn in the air for
 *            three. A lily opens for every line and burns at its heart, the fireflies rise,
 *            a gold ring crosses the pond.
 *   combo    one fish after another leaves its lane to circle the board, the same way round,
 *            faster with every step, alight from inside and pouring gold into the water behind
 *            it; the lilies open one by one, a gauge of the chain. A long chain wakes the
 *            dragon in the basin under the board.
 *   four     the pond holds its breath — then the whole school goes over the water at once,
 *            and the dragon rears out of it.
 *
 * Time is a fixed-step simulation (sixty steps a second for the koi, the spray and the waves),
 * so seek(t) plus a replay reproduces any frame.
 */
import * as THREE from 'three/webgpu';
import {
    DEG, POND, approach, clamp, clamp01, hash2, pieceLight, waterDepth,
} from './koi-pond-core.js';
import { CHAIN_GOLD, PondLight } from './koi-pond-light.js';
import {
    PondSurface, SIM_STEP, WAKE_EXTRA, WAKE_STRIDE,
} from './koi-pond-surface.js';
import { createBed } from './koi-pond-bed.js';
import { createWater } from './koi-pond-water.js';
import { createKoi, writeKoiLook } from './koi-pond-koi.js';
import { KoiSchool } from './koi-pond-school.js';
import {
    createFloaters, createLilies, createPads, planFlora,
} from './koi-pond-flora.js';
import {
    createIris, createLanternGlow, createMaples, createStones, growMaples, planGarden,
} from './koi-pond-garden.js';
import { createFireflies, createLightPools, createMist } from './koi-pond-air.js';
import { DROP_GRAVITY, Spray } from './koi-pond-fx.js';
import { Dragon } from './koi-pond-dragon.js';
import { tierFor } from './koi-pond-quality.js';
import {
    REST_RIG, boardFor, boardPoint, cardUnion, distanceForAspect, fallbackLayout, fovForAspect, restEye,
} from './koi-pond-composition.js';

export { REST_RIG, fovForAspect };

/** Seconds the pond holds its breath before a four-line clear answers. */
export const HUSH_HOLD = 0.34;
/** Chain length at which the pond is fully charged. */
export const FULL_CHAIN = 9;
/** Chain length that wakes the dragon. */
export const DRAGON_CHAIN = 7;
/** Seconds the dragon stays after a four-line clear, and how long it rears. */
export const DRAGON_VISIT = 8;
export const DRAGON_REAR = 3.6;
/** Seconds a lily stays open after a clear opened it. */
const LILY_HOLD = 7;
/** Flashes of light on the water (splashes), beyond one pool per lily. */
const FLASH_POOLS = 8;
const ROSE = Object.freeze([1.0, 0.5, 0.36]);
const MOONWHITE = Object.freeze([0.7, 0.86, 1.0]);

/**
 * What of the pond a screen of this aspect shows, and so where the koi keep their loops: the
 * picture's half-width at the pond's middle and how it widens up the frame, its bottom edge,
 * and the reaches of water either side of the card that lie inside it.
 */
export function reachForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const fov = fovForAspect(a) * DEG;
    const distance = distanceForAspect(a);
    const pitch = REST_RIG.pitch * DEG;
    const tanH = Math.tan(fov / 2) * a;
    const eyeY = Math.sin(pitch) * distance;
    const eyeZ = Math.cos(pitch) * distance;
    const lower = pitch + fov / 2;
    const viewNear = lower >= 89 * DEG ? eyeZ : eyeZ - eyeY / Math.tan(lower);
    const viewHalf = tanH * distance;
    const outer = Math.min(6.5, viewHalf * 1.12 + 0.3);
    const inner = Math.min(1.95, outer * 0.32);
    return {
        inner,
        outer,
        far: -2.5,
        near: clamp(viewNear - 0.7, 2.6, POND.maxZ - 1.2),
        viewHalf,
        viewPerZ: tanH * Math.cos(pitch),
        viewNear: Math.min(viewNear, POND.maxZ - 0.6),
        card: Math.min(1.6, inner - 0.3),
    };
}

const PARTS = [
    'ground', 'stones', 'lantern', 'wood', 'leaves', 'iris', 'pads', 'lilies', 'floaters', 'koi', 'dragon', 'water', 'pools',
    'fireflyMirror', 'mist', 'fireflies', 'spray',
];

export class KoiPondWorld {
    /**
     * @param {object} params
     * @param {THREE.Scene} params.scene
     * @param {string} [params.quality='High']
     * @param {THREE.WebGPURenderer} [params.renderer]
     * @param {boolean} [params.capture=false]  deterministic captures: replay without limits
     * @param {number} [params.seed]
     */
    constructor({
        scene, quality = 'High', renderer = null, capture = false, seed = 7411,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.renderer = renderer;
        this.capture = capture;
        this.seed = seed;
        this.root = new THREE.Group();
        this.root.name = 'KoiPond';
        this.parts = {};
        this.disposables = [];
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        this.light = null;
        this.surface = null;
        this.school = null;
        this.koi = null;
        this.lilies = null;
        this.pools = null;
        this.spray = null;
        this.dragon = null;
        this.fireflies = null;
        this.mist = null;
        this.maples = null;
        this.floaters = null;
        this.iris = null;
        this.lantern = null;
        /** Rocks standing in the water: the waves and the koi go round them. */
        this.rocks = [];
        this.queue = [];
        this.lily = null;
        this.flash = null;
        this._camera = null;
        this._rest = new THREE.PerspectiveCamera(40, 16 / 9, REST_RIG.near, REST_RIG.far);
        this._look = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._eye = { x: 0, y: 0, z: 0 };
        this._hit = { x: 0, z: 0 };
        this._hit2 = { x: 0, z: 0 };
        this._point = { x: 0.5, y: 0.5 };
        this._rgb = [1, 1, 1];
        this._p = [0, 0, 0];
        this._wakes = new Float32Array((this.tier.koi + WAKE_EXTRA) * WAKE_STRIDE);
        this._post = {
            flash: 0, bloomBoost: 0, exposure: 1, warm: 0,
        };
        this.resetState(0);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.accumulator = 0;
        this.combo = 0;
        this.power = 0;
        this.glow = 0;
        this.flashLight = 0;
        this.kick = 0;
        this.breath = 1;
        this.gust = 0;
        this.stir = 0;
        this.hushUntil = -1;
        this.dragonUntil = -1;
        this.rearUntil = -1;
        this.level = 1;
        this.queue.length = 0;
        this.counts = {
            locks: 0, clears: 0, quads: 0, leaps: 0, steps: 0, splashes: 0,
        };
        this.school?.reset(time);
        this.light?.resetRings();
        this.surface?.reset(this.renderer, time);
        this.spray?.reset();
        this.dragon?.reset();
        if (this.lily) {
            const { lily } = this;
            for (let i = 0; i < lily.count; i += 1) {
                lily.open[i] = lily.rest[i];
                lily.heart[i] = 0;
                lily.until[i] = -1;
            }
            lily.cursor = 0;
        }
        if (this.flash) {
            this.flash.strength.fill(0);
            this.flash.cursor = 0;
        }
    }

    build() {
        const { tier } = this;
        const light = new PondLight({ tier });
        this.light = light;
        light.addTo(this.root);
        this.composeMoon();

        this.addPart('ground', createBed(light, tier));

        // ── The garden round the water ──
        const garden = planGarden();
        this.garden = garden;
        this.rocks = garden.standing;
        this.addPart('stones', createStones(light, garden));
        this.lantern = createLanternGlow(light, garden);
        this.addPart('lantern', this.lantern);
        this.maples = createMaples(light, growMaples(tier.leaves));
        this.addPart('wood', this.maples.wood);
        this.addPart('leaves', this.maples.leaves);
        this.iris = createIris(light, garden);
        this.addPart('iris', this.iris);

        // ── What floats ──
        const flora = planFlora({ pads: tier.pads, lotus: tier.lotus, rocks: garden.standing });
        this.flora = flora;
        this.addPart('pads', createPads(light, flora));
        this.lilies = createLilies(light, flora);
        this.addPart('lilies', this.lilies);
        this.floaters = createFloaters(light, tier.floaters);
        this.addPart('floaters', this.floaters);
        const lilyCount = flora.lilies.length;
        this.lily = {
            count: lilyCount,
            rest: Float32Array.from({ length: lilyCount }, (_, i) => 0.3 + hash2(i, 91) * 0.2),
            open: new Float32Array(lilyCount),
            heart: new Float32Array(lilyCount),
            until: new Float32Array(lilyCount).fill(-1),
            cursor: 0,
        };

        // ── The koi, and what a long chain wakes ──
        this.school = new KoiSchool({
            count: tier.koi, seed: this.seed, rocks: this.rocks, reach: reachForAspect(this.aspect),
        });
        this.koi = createKoi(light, tier.koi);
        for (let i = 0; i < tier.koi; i += 1) writeKoiLook(this.koi.look, i, this.school.fish[i]);
        this.koi.commitLook();
        this.addPart('koi', this.koi);
        if (tier.dragon > 0) {
            this.dragon = new Dragon(light, tier.dragon);
            this.addPart('dragon', this.dragon);
        }

        this.addPart('water', createWater(light, tier));

        // ── Light on the water, and what hangs in the air ──
        this.pools = createLightPools(light, lilyCount + FLASH_POOLS);
        this.addPart('pools', this.pools);
        this.flash = {
            x: new Float32Array(FLASH_POOLS),
            z: new Float32Array(FLASH_POOLS),
            radius: new Float32Array(FLASH_POOLS),
            strength: new Float32Array(FLASH_POOLS),
            rgb: new Float32Array(FLASH_POOLS * 3),
            cursor: 0,
        };
        if (tier.fireflies > 0) {
            this.fireflies = createFireflies(light, tier.fireflies);
            this.addPart('fireflyMirror', this.fireflies.mirror);
            this.addPart('fireflies', this.fireflies.air);
        }
        if (tier.mist > 0) {
            this.mist = createMist(light, tier.mist);
            this.addPart('mist', this.mist);
        }
        this.spray = new Spray(light, tier.droplets);
        this.addPart('spray', this.spray);

        if (this.renderer) {
            this.surface = new PondSurface({ light, tier, rocks: this.rocks });
            this.surface.reset(this.renderer, this.time);
            if (light.moon) {
                this.renderer.shadowMap.enabled = true;
                this.renderer.shadowMap.type = THREE.PCFShadowMap;
            }
        }
        const { flame } = garden.lantern;
        light.u.lantern.value.set(flame[0], flame[1], flame[2], 5.5);
        this.resetState(this.time);
        this.school.writeLive(this.koi.live);
        this.koi.commit();
        this.writeLilies(0, true);
        this.scene.add(this.root);
        return this;
    }

    addPart(name, part) {
        this.parts[name] = part;
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
        if (this.light && bufferWidth > 0 && bufferHeight > 0) this.light.u.viewport.value.set(bufferWidth, bufferHeight);
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) this.reframe(aspect);
        if (!this.layoutLive) this.layout = fallbackLayout(this.aspect * 1000, 1000);
    }

    /** The screen changed shape: the moon moves to where it can be seen, the koi to where they can. */
    reframe(aspect) {
        this.aspect = aspect;
        this.composeMoon();
        this.school?.setReach(reachForAspect(aspect));
    }

    /**
     * The live board / card / HUD rects (screen fractions), or null when no board is on screen:
     * events then aim at where the solo board would be.
     */
    setLayout(rects, aspect) {
        if (Number.isFinite(aspect) && aspect > 0 && aspect !== this.aspect) this.reframe(aspect);
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(this.aspect * 1000, 1000);
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Jump the clock (captures): drops every event in flight and stills the water. */
    seek(time) {
        this.resetState(Math.max(0, time));
    }

    /** A new run: the chain is gone and nothing is pending (the fish keep swimming where they are). */
    resetSession() {
        this.combo = 0;
        this.school?.setChain(0);
        this.queue.length = 0;
        this.hushUntil = -1;
        this.dragonUntil = -1;
        this.rearUntil = -1;
    }

    bindCamera(camera) {
        this._camera = camera;
    }

    // ── Composition ─────────────────────────────────────────────────────────────────────────

    /** The rest camera for the current aspect (what the composition is measured in). */
    restCamera() {
        const cam = this._rest;
        cam.fov = fovForAspect(this.aspect);
        cam.aspect = this.aspect;
        cam.near = REST_RIG.near;
        cam.far = REST_RIG.far;
        cam.updateProjectionMatrix();
        const eye = restEye(this.aspect, this._eye);
        cam.position.set(eye.x, eye.y, eye.z);
        cam.up.set(0, 1, 0);
        cam.lookAt(0, 0, 0);
        cam.updateMatrixWorld();
        return cam;
    }

    /**
     * Hang the moon where its image in the water lands in the left reach (landscape) or above
     * the card (a tall screen): the direction that mirrors the rest camera's ray to that point.
     */
    composeMoon() {
        if (!this.light) return;
        // (On a tall screen the card leaves open water only at the foot of the picture.)
        const tall = clamp01((1.25 - this.aspect) / 0.6);
        const sx = 0.2 + (0.5 - 0.2) * tall;
        const sy = 0.5 + (0.885 - 0.5) * tall;
        const cam = this.restCamera();
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(cam).sub(cam.position).normalize();
        this._ray.y = -this._ray.y;
        this.light.setMoon(this._ray);
    }

    // ── Camera ──────────────────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        const calm = this.reducedMotion ? 0 : 1;
        const fov = fovForAspect(this.aspect) - this.kick * 0.5 * calm;
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        const eye = restEye(this.aspect, this._eye);
        // A slow drift, as of someone leaning over the water, plus the pointer leaning the view.
        const swayX = (Math.sin(t * 0.11) * 0.22 + Math.sin(t * 0.063 + 1.3) * 0.16) * calm;
        const swayZ = (Math.sin(t * 0.09 + 0.7) * 0.14 + Math.sin(t * 0.047) * 0.1) * calm;
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        camera.position.set(eye.x + swayX + px * 0.55, eye.y - this.kick * 0.06 * calm, eye.z + swayZ + py * 0.3);
        this._look.set(swayX * 0.4 + px * 0.16, 0, swayZ * 0.4 + py * 0.1);
        camera.up.set(Math.sin(t * 0.07) * 0.004 * calm, 1, 0);
        camera.lookAt(this._look);
        camera.updateMatrixWorld();
        this._camera = camera;
    }

    /** Where a ray through a screen point (fractions, y down) meets the water. */
    screenToWater(sx, sy, out = this._hit) {
        const camera = this._camera || this.restCamera();
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position);
        const t = this._ray.y < -1e-4 ? -camera.position.y / this._ray.y : 12;
        out.x = clamp(camera.position.x + this._ray.x * t, POND.minX + 0.5, POND.maxX - 0.5);
        out.z = clamp(camera.position.z + this._ray.z * t, POND.minZ + 0.4, POND.maxZ - 0.6);
        return out;
    }

    // ── Gameplay ────────────────────────────────────────────────────────────────────────────

    /** Run `fn` when the simulation clock reaches `time`. */
    at(time, fn) {
        // (A frozen capture never drains the queue: it must not grow without end.)
        if (this.queue.length >= 96) this.queue.shift();
        this.queue.push({ time, fn });
    }

    /** A flash of light on the water at (x, z). */
    flashAt(x, z, radius, strength, rgb) {
        const { flash } = this;
        if (!flash) return;
        const i = flash.cursor % FLASH_POOLS;
        flash.cursor += 1;
        flash.x[i] = x;
        flash.z[i] = z;
        flash.radius[i] = radius;
        flash.strength[i] = strength;
        flash.rgb.set(rgb, i * 3);
    }

    /**
     * A piece locked. `u` = its column as a fraction of the board width, `rows` = the visible
     * rows it covers, `color` = the piece's colour; `screen` (fractions) replaces the board point.
     */
    onLock({
        u = 0.5, rows = null, hardDrop = false, color = null, player = 0, screen = null,
    } = {}) {
        const { light, surface, school } = this;
        if (!light) return;
        const rgb = pieceLight(color, this._rgb);
        let px = 0.5;
        let py = 0.6;
        let ex = 0.5;
        let side = u < 0.5 ? -1 : 1;
        if (Math.abs(u - 0.5) < 0.03) side = this.counts.locks % 2 ? 1 : -1;
        if (screen) {
            px = screen.x;
            py = screen.y;
            ex = screen.x;
            side = screen.x < 0.5 ? -1 : 1;
        } else {
            const board = boardFor(this.layout, player);
            const card = cardUnion(this.layout);
            if (board) {
                const row = Array.isArray(rows) && rows.length ? rows[Math.floor(rows.length / 2)] : 19;
                boardPoint(board, u, row, this._point);
                px = this._point.x;
                py = this._point.y;
                const edges = card || board;
                ex = side < 0 ? edges.x0 - 0.014 : edges.x1 + 0.014;
                // The stats bar stands beside the card: where it covers this row, the pebble
                // leaves from the bar's far edge instead, where it can be seen.
                const { hud } = this.layout;
                if (hud && py > hud.y0 - 0.02 && py < hud.y1 + 0.02) {
                    if (side > 0 && hud.x0 >= edges.x1 - 0.02 && hud.x0 < edges.x1 + 0.12) ex = hud.x1 + 0.012;
                    if (side < 0 && hud.x1 <= edges.x0 + 0.02 && hud.x1 > edges.x0 - 0.12) ex = hud.x0 - 0.012;
                }
            }
        }
        // ── The piece falls through the card into the pond under it ──
        const under = this.screenToWater(px, py, this._hit);
        surface?.plunge(under.x, under.z, {
            amp: hardDrop ? 0.085 : 0.045, radius: hardDrop ? 0.34 : 0.26, rate: hardDrop ? 8 : 9.5, foam: hardDrop ? 0.9 : 0.3,
        });
        const lit = [rgb[0] * 1.7, rgb[1] * 1.7, rgb[2] * 1.7];
        light.ring(under.x, under.z, this.time, hardDrop ? 0.6 : 0.4, lit, hardDrop ? 12 : 8);
        // ── ...and throws a pebble of its own light out of the card's edge beside it ──
        const edge = this.screenToWater(ex, py, this._hit2);
        const edgeX = edge.x;
        const edgeZ = edge.z;
        const tint = [0.45 + rgb[0] * 0.55, 0.5 + rgb[1] * 0.5, 0.6 + rgb[2] * 0.4];
        const share = this.spray ? this.spray.count / 640 : 0;
        this.spray?.emit({
            x: edgeX,
            z: edgeZ,
            n: Math.round((hardDrop ? 16 : 6) * share),
            out: [0.2, 0.9],
            up: [0.8, 2.0],
            dirX: side,
            dirZ: 0,
            lean: 0.7,
            size: 0.06,
            rgb: tint,
        });
        const pebbles = hardDrop ? 3 : 1;
        const lift = 0.22;
        for (let k = 0; k < pebbles; k += 1) {
            // A hard drop fans three of them; each flies a little further than the last.
            const swing = (k - (pebbles - 1) / 2) * 0.62 + (((this.counts.locks * 7 + k * 3) % 5) - 2) * 0.07;
            const dirX = side * Math.cos(swing);
            const dirZ = Math.sin(swing);
            const out = (hardDrop ? 1.75 : 1.45) + k * 0.2;
            const up = (hardDrop ? 3.3 : 2.7) + k * 0.15;
            const flight = this.reducedMotion ? 0.05 : (up + Math.sqrt(up * up + 2 * DROP_GRAVITY * lift)) / DROP_GRAVITY;
            let landX = edgeX + dirX * out * flight;
            let landZ = edgeZ + dirZ * out * flight;
            // It must come down in the water.
            for (let tries = 0; tries < 6 && waterDepth(landX, landZ) < 0.12; tries += 1) {
                landX = edgeX + (landX - edgeX) * 0.7;
                landZ = edgeZ + (landZ - edgeZ) * 0.7 + 0.25;
            }
            const travel = Math.hypot(landX - edgeX, landZ - edgeZ) / Math.max(flight, 0.05);
            if (!this.reducedMotion) {
                this.spray?.emit({
                    x: edgeX,
                    z: edgeZ,
                    y: lift,
                    n: 1,
                    out: [travel, travel],
                    up: [up, up],
                    dirX: landX - edgeX,
                    dirZ: landZ - edgeZ,
                    lean: 1,
                    fan: 0,
                    size: 0.27,
                    radius: 0,
                    rgb: [lit[0] * 1.5, lit[1] * 1.5, lit[2] * 1.5],
                    life: [flight + 0.05, flight + 0.05],
                });
                // Its tail: a few sparks that fall short along the same arc.
                this.spray?.emit({
                    x: edgeX,
                    z: edgeZ,
                    y: lift,
                    n: Math.round(9 * share),
                    out: [travel * 0.5, travel * 0.95],
                    up: [up * 0.55, up * 0.95],
                    dirX: landX - edgeX,
                    dirZ: landZ - edgeZ,
                    lean: 1,
                    fan: 0.07,
                    size: 0.075,
                    radius: 0.02,
                    rgb: lit,
                    life: [0.35, flight],
                });
            }
            const strength = hardDrop ? 0.62 : 0.72;
            this.at(this.time + flight, () => {
                surface?.plunge(landX, landZ, {
                    amp: hardDrop ? 0.07 : 0.05, radius: hardDrop ? 0.22 : 0.19, rate: 10.5, foam: hardDrop ? 0.5 : 0.3,
                });
                light.ring(landX, landZ, this.time, strength, lit, hardDrop ? 14 : 10);
                this.flashAt(landX, landZ, hardDrop ? 0.9 : 0.75, hardDrop ? 0.5 : 0.45, lit);
                this.spray?.emit({
                    x: landX,
                    z: landZ,
                    n: Math.round((hardDrop ? 22 : 10) * share),
                    out: [0.3, hardDrop ? 1.9 : 1.2],
                    up: [1.2, hardDrop ? 3.6 : 2.4],
                    size: 0.075,
                    rgb: tint,
                });
                school?.startle(landX, landZ, hardDrop ? 1.25 : 0.75, hardDrop ? 3.4 : 2.2);
            });
        }
        this.kick = Math.max(this.kick, hardDrop ? 0.45 : 0.08);
        this.flashLight = Math.max(this.flashLight, hardDrop ? 0.08 : 0.015);
        if (hardDrop) this.gust = Math.max(this.gust, 0.6);
        this.counts.locks += 1;
    }

    /** Open the next `n` lilies and set their hearts burning. */
    wakeLilies(n, burn = 1.3) {
        const { lily } = this;
        if (!lily || lily.count === 0) return;
        for (let k = 0; k < n; k += 1) {
            const i = lily.cursor % lily.count;
            lily.cursor += 1;
            lily.until[i] = this.time + LILY_HOLD;
            lily.heart[i] = Math.max(lily.heart[i], burn);
        }
    }

    /**
     * Lines cleared. `lines` 1..4; `tspin`, `perfect`.
     */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, player = 0, screen = null,
    } = {}) {
        const { light, surface, school } = this;
        if (!light) return;
        const n = Math.max(1, Math.min(4, Math.round(Number(lines) || 1)));
        const quad = n >= 4 || perfect;
        const board = boardFor(this.layout, player);
        let hx = 0.5;
        let hy = 0.6;
        if (screen) {
            hx = screen.x;
            hy = screen.y;
        } else if (board) {
            const list = Array.isArray(rows) && rows.length ? rows : [19];
            boardPoint(board, 0.5, list[Math.floor(list.length / 2)], this._point);
            hx = this._point.x;
            hy = this._point.y;
        }
        const heart = this.screenToWater(hx, hy, this._hit);
        const hx0 = heart.x;
        const hz0 = heart.z;
        const birth = quad ? this.time + HUSH_HOLD : this.time;
        const strength = Math.min(1.8, 0.8 + 0.18 * n + (quad ? 0.35 : 0));
        const gold = [CHAIN_GOLD[0] * 1.6, CHAIN_GOLD[1] * 1.6, CHAIN_GOLD[2] * 1.6];
        this.at(birth, () => {
            surface?.plunge(hx0, hz0, {
                amp: 0.06 + 0.02 * n, radius: 0.5 + 0.06 * n, rate: 7, foam: 0.4,
            });
            light.ring(hx0, hz0, this.time, strength, gold, 18);
            this.glow = Math.max(this.glow, 0.35 + 0.2 * n + (quad ? 0.4 : 0));
            this.flashLight = Math.max(this.flashLight, 0.06 + 0.04 * n);
            this.kick = Math.max(this.kick, 0.16 + 0.07 * n);
            this.stir = Math.max(this.stir, Math.min(1, 0.35 + 0.2 * n));
            this.gust = Math.max(this.gust, 0.4 + 0.2 * n);
            this.wakeLilies(quad ? this.lily.count : n, quad ? 1.6 : 1.3);
        });

        // ── The koi go over the water ──
        const first = this.counts.clears % 2 ? 1 : -1;
        if (quad) {
            this.hushUntil = this.time + HUSH_HOLD;
            school?.holdBreath(HUSH_HOLD);
            const flights = perfect ? 8 : 6;
            for (let k = 0; k < flights; k += 1) {
                this.at(birth + 0.05 + k * 0.13, () => this.sendLeap(k % 2 ? first : -first, 1.25 + (k % 3) * 0.22, k % 3 === 2));
            }
            // The dragon comes up for it, and rears.
            this.dragonUntil = birth + DRAGON_VISIT;
            this.rearUntil = birth + DRAGON_REAR;
            // The card itself throws water from both its sides, and every koi takes fire.
            const card = cardUnion(this.layout) || { x0: 0.4, x1: 0.6 };
            this.at(birth, () => {
                const share = this.spray ? this.spray.count / 640 : 0;
                [-1, 1].forEach((side) => {
                    for (let k = 0; k < 3; k += 1) {
                        const at = this.screenToWater(side < 0 ? card.x0 - 0.02 : card.x1 + 0.02, 0.3 + k * 0.2, this._hit2);
                        this.spray?.emit({
                            x: at.x,
                            z: at.z,
                            n: Math.round(26 * share),
                            out: [0.6, 3.0],
                            up: [2.0, 5.2],
                            dirX: side,
                            dirZ: 0,
                            lean: 0.55,
                            size: 0.09,
                            rgb: [1.0, 0.86, 0.55],
                        });
                        surface?.plunge(at.x, at.z, {
                            amp: 0.05, radius: 0.3, rate: 9, foam: 0.8,
                        });
                    }
                });
                school?.shine(1.2);
                light.ring(hx0, hz0, this.time + 0.22, strength * 0.7, [1.5, 1.3, 1.0], 20);
            });
            this.counts.quads += 1;
        } else {
            this.sendLeap(first, 0.9 + 0.12 * n, tspin);
            if (n >= 2) this.at(this.time + 0.16, () => this.sendLeap(-first, 1.0 + 0.1 * n, false));
            if (n >= 3) this.at(this.time + 0.36, () => this.sendLeap(first, 1.35, true));
        }
        this.counts.clears += 1;
    }

    sendLeap(side, power, twist) {
        const index = this.school?.leap({ side, power, twist }) ?? -1;
        if (index < 0 && side !== 0) return this.sendLeap(0, power, twist);
        if (index >= 0) this.counts.leaps += 1;
        return index;
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        this.combo = n;
        this.school?.setChain(n);
    }

    /** A new level: every lily opens, the fireflies rise. */
    levelUp(level, { silent = false } = {}) {
        this.level = Math.max(1, Math.round(Number(level) || 1));
        if (silent) return;
        this.glow = Math.max(this.glow, 0.5);
        this.flashLight = Math.max(this.flashLight, 0.1);
        this.stir = 1;
        this.gust = Math.max(this.gust, 0.8);
        if (this.lily) this.wakeLilies(this.lily.count, 1.1);
        // The lantern flares, and its light crosses the pond.
        const flame = this.garden?.lantern.flame;
        if (flame && this.light) {
            this.light.ring(flame[0], flame[2] + 0.6, this.time, 1.3, [1.6, 0.9, 0.34], 20);
            this.flashAt(flame[0], flame[2] + 0.7, 2.2, 1.6, [1.0, 0.56, 0.2]);
        }
    }

    // ── Frame ───────────────────────────────────────────────────────────────────────────────

    /** One fixed step: the koi, the dragon, the spray, what they did to the water, the waves. */
    stepSimulation() {
        const {
            school, surface, dragon, spray,
        } = this;
        const now = (surface ? surface.simTime : this.time) + 1e-6;
        if (this.queue.length) {
            for (let i = 0; i < this.queue.length; i += 1) {
                const item = this.queue[i];
                if (item.time <= now) {
                    this.queue.splice(i, 1);
                    i -= 1;
                    item.fn();
                }
            }
        }
        let wakes = 0;
        if (school) {
            school.step(SIM_STEP);
            for (let i = 0; i < school.events.length; i += 1) this.onSchoolEvent(school.events[i]);
            wakes = school.writeWakes(this._wakes, SIM_STEP, WAKE_STRIDE);
        }
        if (dragon) {
            const wanted = this.combo >= DRAGON_CHAIN || now < this.dragonUntil ? 1 : 0;
            const rear = now < this.rearUntil ? 1 : 0;
            dragon.step(SIM_STEP, now, wanted, this.power, rear);
            if (dragon.presence > 0.05) wakes = this.writeDragonWakes(wakes);
        }
        spray?.step(SIM_STEP);
        if (surface) {
            surface.setWakes(this._wakes, wakes);
            surface.stepOnce(this.renderer);
        }
        this.counts.steps += 1;
    }

    /** The dragon presses on the water where its back comes up, and leaves light all along. */
    writeDragonWakes(start) {
        const { dragon } = this;
        const out = this._wakes;
        let n = start;
        const stride = Math.max(1, Math.floor(dragon.segments / WAKE_EXTRA));
        for (let k = 0; k < WAKE_EXTRA && n < this.tier.koi + WAKE_EXTRA; k += 1) {
            const p = dragon.point(k * stride, this._p);
            const near = clamp01(1 - (-p[1] - 0.02) / 0.45);
            const o = n * WAKE_STRIDE;
            out[o] = p[0];
            out[o + 1] = p[2];
            out[o + 2] = near * near * 0.0011 * dragon.presence;
            out[o + 3] = 0.24;
            out[o + 4] = (k === 0 ? 0.028 : 0.01) * dragon.presence;
            out[o + 5] = k === 0 ? 0.2 : 0.15;
            n += 1;
            // Where an arch breaks the surface it throws a little spray.
            if (p[1] > -0.08 && this.spray && (this.counts.steps + k * 7) % 9 === 0) {
                this.spray.emit({
                    x: p[0], z: p[2], n: 2, out: [0.2, 0.9], up: [0.8, 2.0 + dragon.arch * 2], size: 0.065, rgb: [1.0, 0.86, 0.55],
                });
            }
        }
        return n;
    }

    /** A koi broke the surface, fell back into it, or came up to kiss it. */
    onSchoolEvent(event) {
        const { surface } = this;
        if (event.type === 'kiss') {
            surface?.plunge(event.x, event.z, {
                amp: 0.0035, radius: 0.07, rate: 15,
            });
            return;
        }
        const big = event.type === 'splash';
        surface?.plunge(event.x, event.z, {
            amp: (big ? 0.075 : 0.04) * event.power, radius: 0.24 + 0.14 * event.power, rate: big ? 7.5 : 10, foam: big ? 0.6 : 0.4,
        });
        this.light.ring(event.x, event.z, this.time, big ? 0.7 : 0.4, [
            CHAIN_GOLD[0] * 1.3, CHAIN_GOLD[1] * 1.3, CHAIN_GOLD[2] * 1.3,
        ], 5);
        const share = this.spray ? this.spray.count / 640 : 0;
        const heading = this.school.heading[event.index] || 0;
        this.spray?.emit({
            x: event.x,
            z: event.z,
            n: Math.round((big ? 34 : 22) * event.power * share),
            out: big ? [0.4, 2.2] : [0.3, 1.4],
            up: big ? [1.4, 3.6] : [1.6, 3.4],
            dirX: Math.cos(heading),
            dirZ: Math.sin(heading),
            lean: big ? 0.2 : 0.45,
            size: 0.08,
            radius: 0.16,
        });
        this.flashAt(event.x, event.z, 0.7 + 0.25 * event.power, big ? 0.3 : 0.2, MOONWHITE);
        this.counts.splashes += 1;
    }

    /** Ease the lilies toward what the chain and the last clears ask, and light their pools. */
    writeLilies(dt, snap = false) {
        const {
            lily, lilies, pools, flora,
        } = this;
        if (!lily || !lilies) return;
        // A chain opens them one by one: a gauge of how long it has run.
        const chainLit = this.combo >= 2 ? Math.min(lily.count, Math.ceil(((this.combo - 1) / (FULL_CHAIN - 1)) * lily.count)) : 0;
        for (let i = 0; i < lily.count; i += 1) {
            const awake = this.time < lily.until[i] || i < chainLit;
            const target = awake ? 1 : lily.rest[i];
            lily.open[i] += (target - lily.open[i]) * (snap ? 1 : approach(target > lily.open[i] ? 2.4 : 0.5, dt));
            const floor = i < chainLit ? 0.5 + this.power * 0.4 : 0;
            lily.heart[i] = Math.max(floor, lily.heart[i] * Math.exp(-dt / 2.4));
            lilies.openness[i] = lily.open[i];
            lilies.heart[i] = lily.heart[i];
            const at = flora.lilies[i];
            pools?.set(i, at.x, at.z, 0.8 + lily.heart[i] * 0.2, lily.open[i] * 0.03 + lily.heart[i] * 0.26, ROSE);
        }
    }

    update(sim, camera = this._camera) {
        const { light } = this;
        if (!light) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        if (camera) this._camera = camera;
        const { renderer } = this;

        // ── The fixed-step simulation ──
        const previous = renderer ? renderer.getRenderTarget() : null;
        this.accumulator += dt;
        const limit = this.capture ? Infinity : 5;
        let steps = 0;
        while (this.accumulator >= SIM_STEP - 1e-7 && steps < limit) {
            this.stepSimulation();
            this.accumulator -= SIM_STEP;
            steps += 1;
        }
        if (steps >= limit) this.accumulator = 0;

        // ── The charge ──
        const target = clamp01(this.combo / FULL_CHAIN);
        this.power += (target - this.power) * approach(target > this.power ? 2.2 : 0.8, dt);
        this.glow *= Math.exp(-dt / 1.6);
        this.flashLight *= Math.exp(-dt / 0.25);
        this.kick *= Math.exp(-dt / 0.18);
        this.gust *= Math.exp(-dt / 1.4);
        this.stir *= Math.exp(-dt / 2.6);
        const hush = this.time < this.hushUntil ? 1 : 0;
        const breathTarget = hush ? 0.14 : 1;
        this.breath += (breathTarget - this.breath) * approach(hush ? 40 : 12, dt);
        if (dt === 0) this.breath = breathTarget;

        const { u } = light;
        light.update(this.time);
        u.power.value = this.power;
        u.glow.value = this.glow;
        u.breath.value = this.breath;
        const motion = this.reducedMotion ? 0.35 : 1;
        if (this.maples) this.maples.gust.value = (1 + this.gust * 2.4 + this.power * 0.6) * motion;
        if (this.iris) this.iris.gust.value = (1 + this.gust * 2.2) * motion;
        if (this.floaters) this.floaters.stir.value = 1 + this.gust * 3;
        if (this.fireflies) this.fireflies.stir.value = Math.min(1, this.stir + this.power * 0.3);
        if (this.mist) this.mist.density.value = 1 - hush * 0.6 + this.glow * 0.2;
        if (this.lantern) {
            // The flame gutters a little, and leaps with the pond.
            const flicker = 1 + Math.sin(this.time * 11.3) * 0.035 + Math.sin(this.time * 4.7 + 1.3) * 0.05 + this.glow * 0.25;
            this.lantern.flicker.value = flicker;
            u.lanternColor.value.set(1.0 * flicker, 0.56 * flicker, 0.2 * flicker);
        }
        this.writeLilies(dt);
        if (this.flash && this.pools) {
            const { flash, lily } = this;
            for (let i = 0; i < FLASH_POOLS; i += 1) {
                flash.strength[i] *= Math.exp(-dt / 0.3);
                this.pools.set(lily.count + i, flash.x[i], flash.z[i], flash.radius[i], flash.strength[i], [
                    flash.rgb[i * 3], flash.rgb[i * 3 + 1], flash.rgb[i * 3 + 2],
                ]);
            }
        }
        this.pools?.commit();
        this.spray?.commit();
        if (this.surface) {
            this.surface.u.still.value = hush;
            this.surface.u.gust.value = 1 + this.gust * 0.8;
            this.surface.derive(renderer, this.time);
        }
        if (renderer) renderer.setRenderTarget(previous);
        if (this.school && this.koi) {
            this.school.writeLive(this.koi.live);
            this.koi.commit();
        }

        const post = this._post;
        post.flash = this.flashLight;
        post.bloomBoost = this.glow * 0.25 + this.power * 0.15;
        post.exposure = 1 / (1 + this.glow * 0.22 + this.power * 0.1);
        post.warm = clamp01(this.power * 0.6 + this.glow * 0.15);
    }

    /** What the post stack reads each frame (a reused object). */
    getPostState() {
        return this._post;
    }

    getState() {
        const { school, lily } = this;
        let airborne = 0;
        let joined = 0;
        if (school) {
            for (let i = 0; i < school.count; i += 1) {
                if (school.airborne(i)) airborne += 1;
                if (school.joined[i] > 0.5) joined += 1;
            }
        }
        let open = 0;
        if (lily) for (let i = 0; i < lily.count; i += 1) if (lily.open[i] > 0.8) open += 1;
        return {
            quality: this.quality,
            time: this.time,
            combo: this.combo,
            power: this.power,
            glow: this.glow,
            breath: this.breath,
            level: this.level,
            counts: { ...this.counts },
            koi: school ? school.count : 0,
            airborne,
            joined,
            liliesOpen: open,
            lilies: lily ? lily.count : 0,
            dragon: this.dragon ? this.dragon.presence : 0,
            drops: this.spray ? this.spray.alive : 0,
            waveSteps: this.surface ? this.surface.steps : 0,
            layoutLive: this.layoutLive,
            moon: this.light ? this.light.moonDirection.toArray().map((v) => Math.round(v * 1000) / 1000) : null,
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
        this.surface?.dispose();
        this.light?.dispose();
        this.disposables = [];
        this.parts = {};
        this.surface = null;
        this.light = null;
        this.school = null;
        this.koi = null;
        this.lilies = null;
        this.pools = null;
        this.spray = null;
        this.dragon = null;
        this.fireflies = null;
        this.mist = null;
        this.maples = null;
        this.floaters = null;
        this.iris = null;
        this.lantern = null;
        this._camera = null;
    }
}

export { PARTS as KOI_POND_PARTS, DEG };
