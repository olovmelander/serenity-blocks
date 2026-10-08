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

/** Screen height (fraction, y down) of the sea line for the rest camera. */
export function horizonY(aspect) {
    const tanV = Math.tan((fovForAspect(aspect) * DEG) / 2);
    return 0.5 + Math.tan(REST_RIG.pitch) / (2 * tanV);
}

/** How far out a lock's droplet lands (metres): near enough to read, never at the viewer's feet. */
const LANDING = Object.freeze({ near: 9, far: 19 });

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
        const scale = anchors.heroScale;
        const ray = restRay(anchors.hero.x, anchors.hero.y, aspect, this._tmp);
        const reach = HERO.distance;
        sc.heroScale = scale;
        sc.hero[0] = ray[0] * reach;
        // never so low that the thread has no room
        sc.hero[1] = Math.max(eyeY + ray[1] * reach, HERO.radius * scale * 1.25 + 2.6);
        sc.hero[2] = ray[2] * reach;
        const kin = restRay(anchors.kin.x, anchors.kin.y, aspect, this._tmp);
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
        this.choreo.clear({
            origin, lines, tspin: clear.tspin === true, perfect: clear.perfect === true,
        });
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
        u.skyFlash.value = choreo.skyFlash;

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
