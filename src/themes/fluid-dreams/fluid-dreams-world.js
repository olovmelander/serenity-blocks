/**
 * Fluid Dreams — the world: the dreaming sea, assembled.
 *
 * Shared by the theme (fluid-dreams-theme.js) and the playground effect
 * (src/playground/effects/fluid-dreams.effect.js), so what is iterated there ships.
 *
 * Three drawables: the liquid (one material tracing every view ray through the sea, the Great
 * Drop, its kin and every droplet in flight — fluid-dreams-liquid.js), the spray and the motes
 * (fluid-dreams-spray.js). The choreography (fluid-dreams-choreography.js) says where every body
 * of liquid is; this class stands the picture up for the screen's shape, aims the board's events
 * through the live camera (a lock's droplet leaves the card where the piece locked and lands in
 * the sea beside it), eases the level palettes, and hands the post stack its numbers.
 */
import * as THREE from 'three/webgpu';

import { applyCameraBreath } from '../shared/camera-breath.js';
import {
    DEG, DREAMFIRE, FLUID_PALETTES, HERO, PALETTE_KEYS, SMOOTH_K, approach, clamp01, lerp, mulberry32, pieceColor,
    sceneAnchors,
} from './fluid-dreams-core.js';
import { bakeNoise, createNoiseTexture } from './fluid-dreams-tsl.js';
import { createLiquidMaterial, createLiquidMesh, createLiquidUniforms } from './fluid-dreams-liquid.js';
import { createMotes, createSpray } from './fluid-dreams-spray.js';
import { FluidChoreography } from './fluid-dreams-choreography.js';
import {
    BOARD_GRID, boardFor, boardPoint, cardUnion, fallbackLayout,
} from './fluid-dreams-composition.js';
import { tierFor } from './fluid-dreams-quality.js';
import { flashScale } from '../../utils/photosensitivity.js';

/** The rest camera: standing a little above the sea, looking out and slightly up. */
export const REST_RIG = Object.freeze({
    near: 0.1,
    far: 3000,
    height: 2.3,
    pitch: 6.2 * DEG,
    fov: 50,
});

/** Vertical field of view for an aspect ratio: a narrow screen keeps some width of sea. */
export function fovForAspect(aspect) {
    const a = Math.max(0.3, Number.isFinite(aspect) ? aspect : 16 / 9);
    const wanted = (2 * Math.atan(Math.tan(31 * DEG) / a)) / DEG;
    return Math.max(REST_RIG.fov, Math.min(82, wanted));
}

/**
 * The rest camera's view ray through a screen point (fractions, y down), as a unit [x, y, z].
 * The picture is stood up along these, so it does not swim when the pointer leans the view.
 */
export function restRay(sx, sy, aspect, out = [0, 0, -1]) {
    const tanV = Math.tan((fovForAspect(aspect) * DEG) / 2);
    const x = (sx * 2 - 1) * tanV * aspect;
    const y = (1 - sy * 2) * tanV;
    const c = Math.cos(REST_RIG.pitch);
    const s = Math.sin(REST_RIG.pitch);
    const wy = y * c + s;
    const wz = y * s - c;
    const inv = 1 / Math.hypot(x, wy, wz);
    out[0] = x * inv;
    out[1] = wy * inv;
    out[2] = wz * inv;
    return out;
}

/**
 * Where a world point stands for the rest camera: [x, y] screen fractions (y down) and its depth
 * along the view axis (metres). The inverse of restRay.
 */
export function restProject(px, py, pz, aspect, out = [0, 0, 0]) {
    const tanV = Math.tan((fovForAspect(aspect) * DEG) / 2);
    const c = Math.cos(REST_RIG.pitch);
    const s = Math.sin(REST_RIG.pitch);
    const vy = py - REST_RIG.height;
    const up = vy * c + pz * s;
    const depth = vy * s - pz * c;
    const d = Math.max(depth, 1e-6);
    out[0] = (px / d / (tanV * aspect) + 1) / 2;
    out[1] = (1 - up / d / tanV) / 2;
    out[2] = depth;
    return out;
}

/**
 * The screen box a sphere fills for the rest camera, [x0, y0, x1, y1] in fractions (y down),
 * or null when the eye is inside it or it is not in front. Exact for a sphere's outline: each
 * edge is the tangent from the eye, so a sphere off to the side is drawn wider, as it is.
 */
export function restBounds(px, py, pz, radius, aspect, out = [0, 0, 1, 1]) {
    const tanV = Math.tan((fovForAspect(aspect) * DEG) / 2);
    const c = Math.cos(REST_RIG.pitch);
    const s = Math.sin(REST_RIG.pitch);
    const vy = py - REST_RIG.height;
    const up = vy * c + pz * s;
    const depth = vy * s - pz * c;
    const across = Math.hypot(px, depth);
    const tall = Math.hypot(up, depth);
    if (!(depth > 0) || radius >= across || radius >= tall) return null;
    const ax = Math.asin(radius / across);
    const ay = Math.asin(radius / tall);
    const tx = Math.atan2(px, depth);
    const ty = Math.atan2(up, depth);
    const edge = Math.PI / 2 - 1e-3;
    if (Math.abs(tx) + ax >= edge || Math.abs(ty) + ay >= edge) return null;
    out[0] = (Math.tan(tx - ax) / (tanV * aspect) + 1) / 2;
    out[2] = (Math.tan(tx + ax) / (tanV * aspect) + 1) / 2;
    out[1] = (1 - Math.tan(ty + ay) / tanV) / 2;
    out[3] = (1 - Math.tan(ty - ay) / tanV) / 2;
    return out;
}

/** Screen height (fraction, y down) of the sea line for the rest camera. */
export function horizonY(aspect) {
    const tanV = Math.tan((fovForAspect(aspect) * DEG) / 2);
    return 0.5 + Math.tan(REST_RIG.pitch) / (2 * tanV);
}

/** How far out a lock's droplet lands (metres): near enough to read, never at the viewer's feet. */
const LANDING = Object.freeze({ near: 9, far: 19 });

/**
 * Where a four-line clear may carry the Great Drop: a screen point (fractions, y down) for its
 * centre, in the open sea beside the cards and the stats bar, and a distance from the eye, drawn
 * at random until the Drop's silhouette (`footprint` radii, lobes and all) clears every card, the
 * stats bar and the frame by `margin` (screen heights), and it travels at least `move` radii.
 * Half the time the first half of the draws look only on the far side of the board from where it
 * hangs, so it does not keep to one side.
 */
export const SITE = Object.freeze({
    tries: 96,
    y: [0.2, 0.44],
    near: 23,
    far: 40,
    footprint: 1.4,
    margin: 0.02,
    move: 2.4,
});

const PARTS = Object.freeze(['liquid', 'motes', 'spray']);

export class FluidDreamsWorld {
    /**
     * @param {object} options
     * @param {THREE.Scene} options.scene
     * @param {string} [options.quality='High']
     * @param {boolean} [options.capture=false] deterministic captures (no wall-clock anywhere)
     * @param {THREE.WebGPURenderer} [options.renderer]
     * @param {object} [options.tune] tier fields to override (the playground's A/B switch)
     */
    constructor({
        scene, quality = 'High', capture = false, renderer = null, tune = null,
    }) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tune ? { ...tierFor(quality), ...tune } : tierFor(quality);
        this.capture = capture;
        this.renderer = renderer;
        this.aspect = 16 / 9;
        this.viewport = { width: 1920, height: 1080 };
        this.layout = fallbackLayout(1778, 1000);
        this.layoutLive = false;
        this.reducedMotion = false;
        this.level = 1;
        this.paletteIndex = 0;
        this.palette = {};
        PALETTE_KEYS.forEach((key) => {
            this.palette[key] = FLUID_PALETTES[0][key].slice();
        });
        this.heart = { x: 0.7, y: 0.56 };
        this._post = {
            heart: this.heart, flash: 0, kick: 0, bloomBoost: 0, exposure: 1, shafts: 0.35,
        };
        this._camera = null;
        this._ray = new THREE.Vector3();
        this._look = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._tmp = [0, 0, 0];
        this._from = [0, 0, 0];
        this._to = [0, 0];
        this._pt = { x: 0.5, y: 0.5 };
        this._lockCount = 0;
        this.random = mulberry32(0xd4ea);
        /** Where the Great Drop hangs once a four-line clear has moved it ({ x, y, d }), else null. */
        this.site = null;
        this.siteRandom = mulberry32(0x5173);
        this._site = [0, 0, 0];
        this._seen = [0, 0, 0];
        this._box = [0, 0, 1, 1];
        this.parts = {};
        this.group = null;
        this.u = null;
        this.choreo = null;
    }

    build() {
        const { tier } = this;
        this.choreo = new FluidChoreography({
            satellites: tier.satellites,
            lobes: tier.lobes,
            crown: tier.crown,
            crownSpokes: tier.crownSpokes,
            emit: (burst) => this.parts.spray?.emit({ ...burst, time: this.choreo.time }),
        });
        this.noise = createNoiseTexture(bakeNoise());
        const u = createLiquidUniforms(this.choreo.tables, this.noise);
        this.u = u;
        this.group = new THREE.Group();
        this.group.name = 'FluidDreamsWorld';

        const liquidMaterial = createLiquidMaterial({
            uniforms: u,
            steps: tier.steps,
            bounceSteps: tier.bounceSteps,
            bounces: tier.bounces,
            stars: tier.stars,
            warp: tier.warp,
            dispersion: tier.dispersion,
            farDrops: tier.farDrops,
            mirrorExtras: tier.mirrorExtras,
        });
        const liquid = createLiquidMesh(liquidMaterial);
        this.parts.liquid = { mesh: liquid, material: liquidMaterial, geometry: liquid.geometry };
        this.parts.motes = createMotes(u, tier.motes);
        this.parts.spray = createSpray(u, tier.spray);
        PARTS.forEach((name) => this.group.add(this.parts[name].mesh));
        this.scene.add(this.group);
        this.compose();
        return this;
    }

    bindCamera(camera) {
        this._camera = camera;
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
        this.choreo?.setReducedMotion(this.reducedMotion);
    }

    showOnlyParts(names) {
        const wanted = new Set(names);
        PARTS.forEach((name) => {
            if (this.parts[name]) this.parts[name].mesh.visible = wanted.has(name);
        });
    }

    /** Drawing-buffer size (pixels) and the window's aspect ratio. */
    setViewport(bufferWidth, bufferHeight, aspect) {
        this.viewport.width = Math.max(1, bufferWidth);
        this.viewport.height = Math.max(1, bufferHeight);
        this.u?.viewport.value.set(this.viewport.width, this.viewport.height);
        if (Number.isFinite(aspect) && aspect > 0 && Math.abs(aspect - this.aspect) > 1e-4) {
            this.aspect = aspect;
            this.compose();
        }
    }

    /** The live card / board / HUD rects (screen fractions), or null when no board is on screen. */
    setLayout(rects, aspect) {
        if (Number.isFinite(aspect) && aspect > 0 && Math.abs(aspect - this.aspect) > 1e-4) {
            this.aspect = aspect;
        }
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(this.aspect * 1000, 1000);
        this.compose();
    }

    /** Stand the picture up for this screen: the Great Drop, its kin, the sun, the board's foot. */
    compose() {
        if (!this.choreo) return;
        const { aspect } = this;
        const anchors = sceneAnchors(aspect);
        const sc = this.choreo.scene;
        const eyeY = REST_RIG.height;
        sc.heroScale = anchors.heroScale;
        // the Great Drop: where a four-line clear carried it, while that still fits the frame
        if (this.site && !this.siteFits(this.site)) this.site = null;
        this.sitePoint(this.site || this.homeSite(), sc.hero);
        // its kin keep to the other side of the board from it
        const card = cardUnion(this.layout);
        const middle = card ? (card.x0 + card.x1) * 0.5 : 0.5;
        const crowded = this.site && (this.site.x < middle) === (anchors.kin.x < middle);
        const kin = restRay(crowded ? 1 - anchors.kin.x : anchors.kin.x, anchors.kin.y, aspect, this._tmp);
        sc.kin[0] = kin[0] * 38;
        sc.kin[1] = Math.max(eyeY + kin[1] * 38, 4.2);
        sc.kin[2] = kin[2] * 38;
        const sun = restRay(anchors.sun.x, anchors.sun.y, aspect, this._tmp);
        const sunY = Math.max(sun[1], 0.03);
        const inv = 1 / Math.hypot(sun[0], sunY, sun[2]);
        this.u.sunDir.value.set(sun[0] * inv, sunY * inv, sun[2] * inv);
        // the sea point under the solo board (or the cards' union): where a clear's packet leaves
        const foot = this.footOf(boardFor(this.layout, 0) || cardUnion(this.layout));
        sc.foot[0] = foot[0];
        sc.foot[1] = foot[1];
    }

    /** Where the composition stands the Great Drop before anything has moved it. */
    homeSite() {
        const { hero } = sceneAnchors(this.aspect);
        return { x: hero.x, y: hero.y, d: HERO.distance };
    }

    /** A site's place in the world, [x, y, z]: along the rest camera's ray, `d` metres out. */
    sitePoint(site, out = [0, 0, 0]) {
        const ray = restRay(site.x, site.y, this.aspect, this._tmp);
        const scale = sceneAnchors(this.aspect).heroScale;
        out[0] = ray[0] * site.d;
        // never so low that the thread has no room
        out[1] = Math.max(REST_RIG.height + ray[1] * site.d, HERO.radius * scale * 1.25 + 2.6);
        out[2] = ray[2] * site.d;
        return out;
    }

    /**
     * True when the Great Drop hung at this site stays clear of every card, the stats bar and the
     * frame's edges, its thread included (rest camera, the current layout).
     */
    siteFits(site) {
        const { aspect } = this;
        const p = this.sitePoint(site, this._site);
        const r = SITE.footprint * HERO.radius * sceneAnchors(aspect).heroScale;
        const box = restBounds(p[0], p[1], p[2], r, aspect, this._box);
        if (!box) return false;
        // in screen heights from here on, so a margin is the same both ways
        const m = SITE.margin;
        const [x0, y0, x1, y1] = [box[0] * aspect, box[1], box[2] * aspect, box[3]];
        if (y0 < m || x0 < m || aspect - x1 < m) return false;
        const mid = (x0 + x1) / 2;
        const sea = horizonY(aspect);
        const rects = this.layout.hud ? [...this.layout.cards, this.layout.hud] : this.layout.cards;
        for (let i = 0; i < rects.length; i += 1) {
            const b = rects[i];
            const dx = Math.max(b.x0 * aspect - x1, x0 - b.x1 * aspect, 0);
            const dy = Math.max(b.y0 - y1, y0 - b.y1, 0);
            if (Math.hypot(dx, dy) < m) return false;
            // its thread runs straight down to the sea
            if (mid > b.x0 * aspect - m && mid < b.x1 * aspect + m && b.y1 > y1 && b.y0 < sea) return false;
        }
        return true;
    }

    /**
     * A new home for the Great Drop, drawn at random (seeded: a seek replays it), or null when
     * the frame has no room for one (a phone, a row of boards).
     */
    pickSite() {
        const rand = this.siteRandom;
        const now = this.sitePoint(this.site || this.homeSite(), [0, 0, 0]);
        const nowX = restProject(now[0], now[1], now[2], this.aspect, this._seen)[0];
        const card = cardUnion(this.layout);
        const middle = card ? (card.x0 + card.x1) * 0.5 : 0.5;
        // the open sea beside the cards and the stats bar, as spans of screen x
        const rects = this.layout.hud ? [...this.layout.cards, this.layout.hud] : this.layout.cards;
        const blocked = rects.map((r) => [r.x0, r.x1]).sort((a, b) => a[0] - b[0]);
        const open = [];
        let edge = 0;
        for (let i = 0; i < blocked.length; i += 1) {
            if (blocked[i][0] > edge + 0.02) open.push([edge, blocked[i][0]]);
            edge = Math.max(edge, blocked[i][1]);
        }
        if (edge < 0.98) open.push([edge, 1]);
        if (!open.length) return null;
        const far = open.filter(([a, b]) => ((a + b) * 0.5 < middle) !== (nowX < middle));
        // half the time it looks first on the other side of the board
        const across = far.length > 0 && rand() < 0.5;
        const least = SITE.move * HERO.radius * sceneAnchors(this.aspect).heroScale;
        for (let i = 0; i < SITE.tries; i += 1) {
            const spans = across && i < SITE.tries / 2 ? far : open;
            // a span by its width, then a place in it
            let pick = rand() * spans.reduce((sum, [a, b]) => sum + b - a, 0);
            let span = spans[spans.length - 1];
            for (let j = 0; j < spans.length; j += 1) {
                pick -= spans[j][1] - spans[j][0];
                if (pick <= 0) {
                    span = spans[j];
                    break;
                }
            }
            const site = {
                x: lerp(span[0], span[1], rand()),
                y: lerp(SITE.y[0], SITE.y[1], rand()),
                d: lerp(SITE.near, SITE.far, rand()),
            };
            if (!this.siteFits(site)) continue;
            const p = this.sitePoint(site, this._site);
            if (Math.hypot(p[0] - now[0], p[1] - now[1], p[2] - now[2]) < least) continue;
            return site;
        }
        return null;
    }

    /** The sea point just under a board (rest camera), as [x, z]. */
    footOf(board, out = [0, -11]) {
        if (!board) return out;
        const sy = Math.min(0.975, Math.max(board.y1 + 0.02, horizonY(this.aspect) + 0.07));
        return this.seaPoint((board.x0 + board.x1) * 0.5, sy, out);
    }

    /** Where the rest camera's ray through a screen point meets the sea, as [x, z]. */
    seaPoint(sx, sy, out = [0, 0]) {
        const ray = restRay(sx, sy, this.aspect, this._tmp);
        const down = Math.min(ray[1], -0.035);
        const t = Math.min(REST_RIG.height / -down, 70);
        out[0] = ray[0] * t;
        out[1] = ray[2] * t;
        return out;
    }

    resetSession() {
        if (!this.choreo) return;
        this.choreo.reset();
        this.parts.spray?.reset();
        this._lockCount = 0;
        // a new run starts on the first level's colours (eased, not cut)
        this.level = 1;
        this.paletteIndex = 0;
    }

    get combo() {
        return this.choreo?.combo ?? 0;
    }

    // ── camera ──────────────────────────────────────────────────────────────────

    updateCamera(camera, sim) {
        const t = sim.time;
        const calm = this.reducedMotion ? 0 : 1;
        const kick = this.choreo?.kick ?? 0;
        const fov = fovForAspect(this.aspect) - kick * 0.7 * calm;
        if (camera.fov !== fov || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // The slow drift of someone afloat, plus the pointer leaning the view.
        const swayX = (Math.sin(t * 0.13) * 0.34 + Math.sin(t * 0.071 + 1.3) * 0.22) * calm;
        const swayY = (Math.sin(t * 0.19 + 0.7) * 0.06 + Math.sin(t * 0.083) * 0.04) * calm;
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        camera.position.set(swayX + px * 0.85, REST_RIG.height + swayY - py * 0.3 - kick * 0.06 * calm, 0);
        const yaw = (Math.sin(t * 0.09 + 2.1) * 0.008 - px * 0.03) * calm;
        const pitch = REST_RIG.pitch + (Math.sin(t * 0.11) * 0.004 - py * 0.018) * calm;
        this._look.set(
            camera.position.x + Math.sin(yaw) * 10,
            camera.position.y + Math.tan(pitch) * 10,
            -10,
        );
        camera.up.set(Math.sin(t * 0.07) * 0.004 * calm, 1, 0);
        camera.lookAt(this._look);
        // The shared breath (shared/camera-breath.js) on top of the drift above: off under reduced motion.
        applyCameraBreath(camera, t, { scale: calm });
        camera.updateMatrixWorld();
        this._camera = camera;
        // The dream sun on screen: where the shafts come from.
        if (this.u) {
            this._ray.copy(this.u.sunDir.value).multiplyScalar(1000).add(camera.position).project(camera);
            this.heart.x = Math.max(-0.5, Math.min(1.5, this._ray.x * 0.5 + 0.5));
            this.heart.y = Math.max(-0.5, Math.min(1.5, 0.5 - this._ray.y * 0.5));
        }
    }

    /** The live camera's unit view ray through a screen point (fractions, y down). */
    liveRay(sx, sy) {
        const cam = this._camera;
        return this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(cam).sub(cam.position).normalize();
    }

    // ── gameplay ────────────────────────────────────────────────────────────────

    /** @param {{ player?: number, rows: number[], u: number, hardDrop?: boolean, color?: string, screen?: object }} lock */
    onLock(lock) {
        const cam = this._camera;
        if (!cam || !this.choreo) return;
        const board = boardFor(this.layout, lock.player ?? 0);
        if (!board) return;
        const rows = lock.rows?.length ? lock.rows : [BOARD_GRID.rows - 1];
        let row = 0;
        for (let i = 0; i < rows.length; i += 1) row += rows[i];
        row /= rows.length;
        const u = clamp01(Number.isFinite(lock.u) ? lock.u : 0.5);
        const start = lock.screen || boardPoint(board, u, row, this._pt);

        // where it lands: in the sea beside the card, on the side the piece locked
        this._lockCount += 1;
        const h1 = this.random();
        const h2 = this.random();
        let side = u < 0.5 ? -1 : 1;
        if (Math.abs(u - 0.5) < 0.06) side = this._lockCount % 2 ? -1 : 1;
        const card = cardUnion(this.layout) || board;
        const sea = horizonY(this.aspect);
        const room = side < 0 ? card.x0 : 1 - card.x1;
        let sx;
        let sy;
        let dist;
        if (room > 0.09 && this.layout.cards.length <= 1) {
            const edge = side < 0 ? card.x0 : card.x1;
            sx = edge + side * (0.03 + (room - 0.05) * h1 ** 0.8);
            sy = sea + 0.1;
            dist = lerp(LANDING.near, LANDING.far, h2);
        } else {
            // no sea beside the card (a phone, a row of boards): under it
            sx = clamp01(lerp(board.x0, board.x1, u * 1.5 - 0.25) + (h1 - 0.5) * 0.1);
            sy = lerp(Math.max(sea + 0.06, Math.min(card.y1 + 0.012, 0.93)), 0.985, h2);
            dist = 0;
        }
        const land = this.liveRay(sx, sy);
        if (dist > 0) {
            // along the ray's bearing, at a chosen distance over the sea
            const flat = Math.hypot(land.x, land.z) || 1;
            this._to[0] = cam.position.x + (land.x / flat) * dist;
            this._to[1] = cam.position.z + (land.z / flat) * dist;
        } else {
            const down = Math.min(land.y, -0.03);
            dist = Math.min(cam.position.y / -down, 60);
            this._to[0] = cam.position.x + land.x * dist;
            this._to[1] = cam.position.z + land.z * dist;
        }

        // where it leaves the card: on the lock's own ray, about as deep as it will land
        const out = this.liveRay(start.x, start.y);
        const depth = Math.max(5, Math.min(15, dist * 0.82));
        this._from[0] = cam.position.x + out.x * depth;
        this._from[1] = Math.max(0.4, cam.position.y + out.y * depth);
        this._from[2] = cam.position.z + out.z * depth;

        this.choreo.lock({
            from: this._from,
            to: this._to,
            color: pieceColor(lock.color),
            hardDrop: lock.hardDrop === true,
        });
    }

    /** @param {{ player?: number, rows: number[], lines: number, tspin?: boolean, perfect?: boolean }} clear */
    onClear(clear) {
        const cam = this._camera;
        if (!cam || !this.choreo) return;
        const board = boardFor(this.layout, clear.player ?? 0);
        const lines = Math.max(1, Math.min(4, Math.round(clear.lines || 1)));
        let origin = this.choreo.scene.foot;
        if (clear.screen && Number.isFinite(clear.screen.x) && Number.isFinite(clear.screen.y)) {
            // a click with no board (the meditation mode): the packet leaves the sea under it
            const sy = Math.min(0.975, Math.max(clear.screen.y, horizonY(this.aspect) + 0.07));
            origin = this.seaPoint(clamp01(clear.screen.x), sy, this._to);
        } else if (board) {
            origin = this.footOf(board, this._to);
        }
        // four lines carry the Great Drop somewhere new: it dives in there and hangs there after
        // (not under reduced motion: a leap across the frame is the motion that asks to be spared)
        const site = lines >= 4 && !this.reducedMotion ? this.pickSite() : null;
        const plunged = this.choreo.clear({
            origin,
            lines,
            tspin: clear.tspin === true,
            perfect: clear.perfect === true,
            site: site ? this.sitePoint(site, this._site) : null,
        });
        if (plunged && site) {
            this.site = site;
            this.compose(); // its kin may have to make room
        }
        // rows pour only out of a card that is really on screen
        if (!board || !this.layoutLive || clear.screen) return;
        // the cleared rows pour out of the two sides of the card that holds this board
        const midX = (board.x0 + board.x1) * 0.5;
        const midY = (board.y0 + board.y1) * 0.5;
        const card = this.layout.cards.find((c) => midX >= c.x0 && midX <= c.x1 && midY >= c.y0 && midY <= c.y1)
            || cardUnion(this.layout) || board;
        const rows = clear.rows?.length ? clear.rows : [BOARD_GRID.rows - 1];
        const reach = Math.hypot(origin[0] - cam.position.x, origin[1] - cam.position.z);
        const depth = Math.max(5, Math.min(14, reach * 0.9));
        this._right.setFromMatrixColumn(cam.matrixWorld, 0);
        const color = lines >= 4 ? DREAMFIRE : this.palette.horizon;
        for (let i = 0; i < rows.length && i < 4; i += 1) {
            const { y } = boardPoint(board, 0.5, rows[i], this._pt);
            for (let side = -1; side <= 1; side += 2) {
                const ray = this.liveRay(side < 0 ? card.x0 : card.x1, y);
                this.parts.spray.emit({
                    kind: 'pour',
                    x: cam.position.x + ray.x * depth,
                    y: Math.max(0.3, cam.position.y + ray.y * depth),
                    z: cam.position.z + ray.z * depth,
                    color,
                    power: 0.8 + lines * 0.2,
                    time: this.choreo.time,
                    dir: [this._right.x * side, this._right.z * side],
                });
            }
        }
    }

    /** The longest chain any board is holding (0 = broken). */
    onCombo(combo) {
        this.choreo?.setCombo(combo);
    }

    levelUp(level, { silent = false } = {}) {
        const n = Math.max(1, Math.round(Number(level) || 1));
        this.level = n;
        this.paletteIndex = (n - 1) % FLUID_PALETTES.length;
        if (silent) {
            PALETTE_KEYS.forEach((key) => {
                const target = FLUID_PALETTES[this.paletteIndex][key];
                for (let c = 0; c < 3; c += 1) this.palette[key][c] = target[c];
            });
        } else {
            this.choreo?.levelUp();
        }
    }

    // ── per frame ───────────────────────────────────────────────────────────────

    /** Jump the clock (captures): everything in flight is dropped. */
    seek(time) {
        if (!this.choreo) return;
        this.choreo.seek(time);
        this.parts.spray?.reset();
        this.random = mulberry32(0xd4ea);
        this._lockCount = 0;
        // the Drop goes back to where the composition stands it, and its travels start over
        this.site = null;
        this.siteRandom = mulberry32(0x5173);
        this.compose();
        this.levelUp(1, { silent: true });
    }

    /**
     * @param {{ time: number, delta: number }} sim
     * @param {THREE.Camera} camera
     */
    update(sim, camera) {
        const { u, choreo } = this;
        if (!u || !choreo) return;
        const dt = sim.delta;

        // the level's palette, eased
        const target = FLUID_PALETTES[this.paletteIndex];
        const k = approach(2.2, dt);
        PALETTE_KEYS.forEach((key) => {
            const cur = this.palette[key];
            const to = target[key];
            cur[0] += (to[0] - cur[0]) * k;
            cur[1] += (to[1] - cur[1]) * k;
            cur[2] += (to[2] - cur[2]) * k;
            u[key].value.set(cur[0], cur[1], cur[2]);
        });

        choreo.update(sim.time, dt, this.palette);

        u.time.value = sim.time;
        u.counts.value.set(choreo.counts.rings, choreo.counts.dye, choreo.counts.waves, 0);
        const {
            stem, beads, vortex, hero, prism,
        } = choreo;
        u.stem.value.set(stem.x, stem.z, stem.flare, stem.cap);
        u.stemShape.value.set(stem.waist, stem.foot, stem.top, stem.off);
        u.stemBeads.value.set(beads[0].y, beads[0].amp, beads[1].y, beads[1].amp);
        u.stemTint.value.set(choreo.heroTint[0], choreo.heroTint[1], choreo.heroTint[2], stem.glow);
        u.vortex.value.set(vortex.x, vortex.z, vortex.depth, vortex.radius);
        u.vortexSpin.value.set(vortex.phase, vortex.arms, 0, 0);
        u.hero.value.set(hero.x, hero.y, hero.z, hero.r);
        u.heroBlend.value.set(hero.blend, hero.blend / SMOOTH_K, hero.bias, hero.glow);
        u.swell.value = choreo.swell;
        u.charge.value = choreo.charge;
        u.surge.value = choreo.surge;
        u.prism.value.set(prism.radius, prism.strength, prism.width, 0);
        u.film.value.set(1, choreo.filmShift, 0, 0);
        u.skyFlash.value = choreo.skyFlash * flashScale();

        if (camera) {
            this.parts.liquid.mesh.position.copy(camera.position);
            this.parts.liquid.mesh.updateMatrixWorld();
            u.pixelAngle.value = (2 * Math.tan((camera.fov * DEG) / 2)) / this.viewport.height;
            // the ring of split light opens from where the Great Drop hangs at rest
            const rest = choreo.scene.hero;
            const eye = camera.position;
            u.heroDir.value.set(rest[0] - eye.x, rest[1] - eye.y, rest[2] - eye.z).normalize();
        }

        const post = this._post;
        // reduced motion: no lens jump, and a flash is a breath of light, not a strobe
        post.flash = choreo.flash * (this.reducedMotion ? 0.3 : 1);
        post.kick = this.reducedMotion ? 0 : choreo.kick;
        post.bloomBoost = choreo.charge * 0.5 + choreo.surge * 0.8;
        post.exposure = 1 - choreo.hush * 0.2;
        post.shafts = 0.35 + choreo.charge * 0.35 + choreo.surge * 0.6;
    }

    getPostState() {
        return this._post;
    }

    getState() {
        const c = this.choreo;
        return {
            quality: this.quality,
            level: this.level,
            palette: FLUID_PALETTES[this.paletteIndex].name,
            combo: c?.combo ?? 0,
            charge: c ? Number(c.charge.toFixed(3)) : 0,
            balls: c ? Array.from(c.live) : [],
            rings: c?.counts.rings ?? 0,
            stains: c?.counts.dye ?? 0,
            waves: c?.counts.waves ?? 0,
            layoutLive: this.layoutLive,
            // where a four-line clear carried the Great Drop: [x, y] on screen and metres out
            site: this.site ? [this.site.x, this.site.y, this.site.d] : null,
        };
    }

    dispose() {
        if (this.group) {
            this.scene.remove(this.group);
            PARTS.forEach((name) => {
                const part = this.parts[name];
                part?.geometry?.dispose();
                part?.material?.dispose();
            });
        }
        this.noise?.dispose();
        this.noise = null;
        this.parts = {};
        this.group = null;
        this.u = null;
        this.choreo = null;
        this._camera = null;
    }
}
