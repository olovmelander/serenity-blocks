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
 *   T-spin   the air turns: the snow winds round the nave's axis.
 *   level    the aurora changes its colours.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 *
 * Layers: 0 = everything the ice mirrors; 1 = what only the camera sees (snow, dust, mist,
 * chips, row beams).
 */

import * as THREE from 'three/webgpu';
import {
    AURORA_PALETTES,
    CLEAR_SLOTS,
    CLEAR_TRAVEL,
    FLAKE_LIFE,
    HUSH_HOLD,
    LOCK_REACH,
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

/** Diamond white: what four lines, and the heart in overdrive, burn with. */
const DIAMOND = Object.freeze([0.86, 0.95, 1.0]);

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
        this.resetState(0);
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
        this.flash = 0;
        this.kick = 0;
        this.flare = 0;
        this.exhale = 0;
        this.frost = 0;
        this.swirlRate = 0;
        this.swirl = 0;
        // The snow has been falling since before the clock started.
        this.snowFall = time * SNOW_FALL;
        this.snowDrift = time * 0.42;
        this.hushUntil = -1;
        this.lockCursor = 0;
        this.clearCursor = 0;
        this.lastClear = { time: -100, lines: 0 };
        this.pendingFlare = { time: Infinity, amount: 0 };
        this.pendingKick = { time: Infinity, amount: 0 };
        this.counts = {
            locks: 0, clears: 0, quads: 0, crowns: 0,
        };
        this.flakeUntil = -1;
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

    /** A new run: the temple back at rest (the snow keeps falling where it was). */
    resetSession() {
        const {
            time, snowFall, snowDrift, swirl,
        } = this;
        this.resetState(time);
        this.snowFall = snowFall;
        this.snowDrift = snowDrift;
        this.swirl = swirl;
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
        const slot = this.lockCursor % LOCK_SLOTS;
        this.lockCursor += 1;
        const rgb = pieceColor(color, AURORA_PALETTES[this.paletteIndex].b);
        const strength = hardDrop ? 1.3 : 0.8;
        uniforms.lockA[slot].value.set(strike.x, strike.z, this.time, strength);
        uniforms.lockC[slot].value.set(rgb[0] * 1.5, rgb[1] * 1.5, rgb[2] * 1.5);
        this.kick = Math.max(this.kick, hardDrop ? 0.55 : 0.14);
        this.flash = Math.max(this.flash, hardDrop ? 0.12 : 0.03);
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
     * Lines cleared. `lines` 1..4, `rows` = the visible rows that went, `tspin`, `perfect`. The
     * wave is a little stronger the longer the chain the temple is already holding.
     */
    onClear({
        rows = null, lines = 1, tspin = false, perfect = false, player = 0,
    } = {}) {
        const { u: uniforms } = this;
        if (!uniforms) return;
        const n = Math.max(1, Math.min(4, Math.round(lines)));
        const quad = n >= 4 || perfect;
        const palette = this._palette;
        let rgb;
        if (quad) rgb = [...DIAMOND];
        else {
            // One line: the aurora's border. Two: its body. Three: both at once, nearly white.
            const src = n === 1 ? palette.a : palette.b;
            rgb = n === 3 ? [0, 1, 2].map((c) => palette.a[c] + palette.b[c] + 0.3) : [...src];
            const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
            rgb = rgb.map((c) => (c / peak) * 0.88 + 0.12);
        }
        const strength = Math.min(1.5, 0.62 + 0.12 * n + 0.04 * Math.min(8, this.combo) + (quad ? 0.25 : 0));
        const birth = quad ? this.time + HUSH_HOLD : this.time;
        const slot = this.clearCursor % CLEAR_SLOTS;
        this.clearCursor += 1;
        uniforms.clearA[slot].value.set(birth, perfect ? 4 : n, strength, quad ? 1 : 0);
        uniforms.clearC[slot].value.set(rgb[0] * 1.3, rgb[1] * 1.3, rgb[2] * 1.3);
        this.lastClear = { time: birth, lines: n };
        // The Great Crystal flares as the wave leaves it; the wave reaches the camera
        // CLEAR_TRAVEL seconds later.
        this.pendingFlare = { time: birth, amount: Math.min(1.3, 0.7 + 0.2 * n) };
        this.pendingKick = { time: birth + CLEAR_TRAVEL * 0.93, amount: 0.28 + 0.13 * n };
        if (quad) {
            this.hushUntil = this.time + HUSH_HOLD;
            this.overdrive = perfect ? 1.3 : 1;
            this.counts.quads += 1;
            // The Great Snowflake grows round the board (two of them for a perfect clear).
            this.flake.launch(birth + 0.05, 1, perfect ? 2 : 1);
            this.flakeUntil = birth + 0.05 + FLAKE_LIFE;
        }
        if (tspin && !this.reducedMotion) this.swirlRate = Math.max(this.swirlRate, 2.6);
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

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        // The chain broke: the temple lets its breath go.
        if (n === 0 && this.combo >= 2) this.exhale = Math.max(this.exhale, Math.min(1, this.combo / 6));
        this.combo = n;
    }

    /** A new level: the aurora changes its colours. */
    levelUp(level, { silent = false } = {}) {
        this.level = Math.max(1, Math.round(Number(level) || 1));
        this.paletteIndex = (this.level - 1) % AURORA_PALETTES.length;
        if (silent) this.applyPalette(1);
        else {
            this.flare = Math.max(this.flare, 0.7);
            this.flash = Math.max(this.flash, 0.16);
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

        // ── The resonance ──
        const target = resonanceForCombo(this.combo);
        this.resonance += (target - this.resonance) * approach(target > this.resonance ? 2.6 : 0.9, dt);
        const levelTarget = Math.min(this.combo, 12) * RESONANCE_STEP;
        this.resLevel += (levelTarget - this.resLevel) * approach(levelTarget > this.resLevel ? 3.2 : 1.1, dt);
        const radiusTarget = this.combo > 0 ? Math.min(70, 6 + this.combo * 6) : 0;
        this.resRadius += (radiusTarget - this.resRadius) * approach(radiusTarget > this.resRadius ? 2.4 : 1.0, dt);
        this.overdrive *= Math.exp(-dt / OVERDRIVE_COOL);
        // The temple stays lit for as long as the snowflake stands.
        if (t < this.flakeUntil - 1.2) this.overdrive = Math.max(this.overdrive, 0.3);
        this.flash *= Math.exp(-dt / 0.25);
        this.kick *= Math.exp(-dt / 0.16);
        this.flare *= Math.exp(-dt / 0.55);
        this.exhale *= Math.exp(-dt / 0.9);
        if (t >= this.pendingFlare.time) {
            this.flare = Math.max(this.flare, this.pendingFlare.amount);
            this.pendingFlare.time = Infinity;
        }
        if (t >= this.pendingKick.time) {
            this.kick = Math.max(this.kick, this.pendingKick.amount);
            this.flash = Math.max(this.flash, this.pendingKick.amount * 0.5);
            this.pendingKick.time = Infinity;
        }
        const hush = t < this.hushUntil ? 1 : 0;
        this.applyPalette(approach(0.9, dt));

        // ── The snow ──
        // It slows as the chain builds, hangs at SNOW_TURN, and rises beyond it; a hush stops it.
        const lift = this.combo / SNOW_TURN + this.overdrive * 0.9;
        const fall = this.reducedMotion ? SNOW_FALL : SNOW_FALL * (1 - Math.min(1.7, lift)) * (1 - hush);
        this.snowFall += fall * dt;
        this.snowDrift += (0.42 + this.overdrive * 0.5) * (1 - hush) * dt;
        this.swirlRate *= Math.exp(-dt / 1.1);
        this.swirl += this.swirlRate * dt;

        // ── Arrival: the clear wave reaching the camera ──
        const sinceClear = t - this.lastClear.time;
        const arrive = sinceClear >= 0
            ? Math.exp(-(((sinceClear - CLEAR_TRAVEL * 0.85) / 0.3) ** 2)) * (0.45 + 0.2 * this.lastClear.lines)
            : 0;

        // ── Uniforms ──
        const beat = this.resonance * 0.22 * Math.sin(t * 2.3) ** 2;
        u.time.value = t;
        u.ambient.value = hush ? 0.16 : 1 - this.exhale * 0.25;
        u.auroraGain.value = hush
            ? 0.12
            : (1 + this.resonance * 1.1 + this.overdrive * 1.2 + arrive * 0.6) * (1 - this.exhale * 0.35);
        u.heartPower.value = hush
            ? 0.06
            : 1 + this.resonance * 0.7 + this.overdrive * 1.0 + this.flare * 1.0 + beat;
        u.resonance.value = this.resonance * (1 - hush);
        u.resLevel.value = this.resLevel;
        u.resRadius.value = this.resRadius;
        u.snowFall.value = this.snowFall;
        u.snowDrift.value = this.snowDrift;
        u.swirl.value = this.swirl;
        u.dustGain.value = (1 + this.resonance * 2.2 + this.overdrive * 2.6 + arrive * 2.2) * (1 - hush * 0.8);
        const p = this._palette;
        u.auroraA.value.set(p.a[0], p.a[1], p.a[2]);
        u.auroraB.value.set(p.b[0], p.b[1], p.b[2]);
        u.auroraC.value.set(p.c[0], p.c[1], p.c[2]);
        // In overdrive the heart burns white: diamond light, the colour of nothing but ice.
        const white = clamp01(this.overdrive * 0.75);
        const heartPeak = Math.max(p.heart[0], p.heart[1], p.heart[2], 1e-4);
        u.heartColor.value.set(
            (p.heart[0] / heartPeak) * (1 - white) + DIAMOND[0] * white,
            (p.heart[1] / heartPeak) * (1 - white) + DIAMOND[1] * white,
            (p.heart[2] / heartPeak) * (1 - white) + DIAMOND[2] * white,
        );
        // The resonance climbs the aurora's own spectrum: its border colour, then its body, then
        // the fringe high above. (A warm light inside blue ice mixes to grey; these stay ice.)
        const k1 = smooth(0.22, 0.6, this.resonance);
        const k2 = smooth(0.64, 0.93, this.resonance);
        for (let c = 0; c < 3; c++) {
            const mid = p.a[c] + (p.b[c] - p.a[c]) * k1;
            const top = mid + (p.c[c] - mid) * k2;
            this._res[c] = top + (DIAMOND[c] - top) * white * 0.7;
        }
        // Keep the resonance as bright as its brightest channel was: the fringe is a dark violet.
        const resPeak = Math.max(this._res[0], this._res[1], this._res[2], 1e-4);
        for (let c = 0; c < 3; c++) this._res[c] = (this._res[c] / resPeak) * 0.94 + 0.06;
        u.resColor.value.set(this._res[0], this._res[1], this._res[2]);

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
        const frostTarget = smooth(0.35, 1.0, this.resonance) * 0.8 + Math.min(1, this.overdrive) * 0.3;
        this.frost += (Math.min(1, frostTarget) - this.frost) * approach(frostTarget > this.frost ? 1.6 : 0.7, dt);
        const post = this._post;
        post.flash = this.flash;
        post.kick = this.kick;
        // The rays are a veil over the whole frame: a flare may thicken them, never white it out.
        post.rays = hush
            ? 0.03
            : Math.min(0.85, 0.3 + this.resonance * 0.18 + this.overdrive * 0.18 + this.flare * 0.16 + arrive * 0.3);
        post.streak = hush ? 0.2 : 1 + this.overdrive * 0.5 + this.resonance * 0.2;
        post.bloomBoost = this.overdrive * 0.1 + arrive * 0.12 + this.flare * 0.05;
        // The iris closes as the temple flares, so its colours survive the surge.
        post.exposure = 1 / (1 + this.overdrive * 0.55 + arrive * 0.3 + this.resonance * 0.22 + this.flare * 0.2);
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
