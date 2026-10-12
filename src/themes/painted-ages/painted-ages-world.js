/** Painted Ages — one shared world, a persistent mineral record and bounded geological events. */
import * as THREE from 'three/webgpu';
import {
    DEG, TAU, TIMING, EVENT_ROWS, FORMATIONS, PIECE_COLORS, StrataRecord, clamp, clampInt,
    hexToLinear, smooth, sunAt, mulberry32,
} from './painted-ages-core.js';
import { createPaintedAgesUniforms, createRecordTexture } from './painted-ages-tsl.js';
import { tierFor } from './painted-ages-quality.js';
import { bakeTerrain, bakeTerrainAsync } from './painted-ages-bake.js';
import { createSky } from './painted-ages-sky.js';
import { createLand } from './painted-ages-land.js';
import { createAir, createSteam } from './painted-ages-air.js';
import { createWater } from './painted-ages-water.js';
import { createHoodoos } from './painted-ages-hoodoo.js';
import {
    fallbackLayout, outsideKeepOut, pickChute, solveSunAzimuth, bowCamera,
} from './painted-ages-composition.js';

export const REST_RIG = Object.freeze({
    near: 0.5, far: 25000, minFov: 28, maxFov: 78,
});
export const PAINTED_AGES_PARTS = Object.freeze(['sky', 'land', 'water', 'air', 'steam', 'hoodoo']);
export const fovForAspect = (aspect) => bowCamera(Number.isFinite(aspect) ? aspect : 16 / 9).fov;
const QUEUE_SIZE = 32;
const SNAPSHOT_FIELDS = Object.freeze([
    'time', 'level', 'combo', 'peak', 'b2b', 'fold', 'foldFrom', 'foldAt', 'tilt', 'tiltFrom', 'tiltAt', 'tiltTarget',
    'wetZones', 'wetFrom', 'weatherAt', 'wetTarget', 'wetGlobal', 'wetAt', 'wetStrength',
    'releaseAt', 'releasePeak', 'perfectAt', 'floodAt', 'gameOverAt', 'gameOverTarget', 'gameOverFrom',
    'lowLight', 'datum', 'depositAt', 'lastLockAt', 'frontCursor', 'droppedDeposits', 'depositCursor', 'sessionEnded', 'depositedLines',
]);
const COUNTERS = ['locks', 'hardDrops', 'clears', 'lines', 'quads', 'tspins', 'perfects', 'chainSteps', 'releases', 'b2bSteps', 'levelUps', 'gameOvers', 'mornings'];
const emptyCounts = () => Object.fromEntries(COUNTERS.map((k) => [k, 0]));

export class PaintedAgesWorld {
    static prepareBake(quality = 'High', { signal, seed = 0x5ed1 } = {}) {
        const tier = tierFor(quality);
        return bakeTerrainAsync({ seed, vertices: tier.terrainVertices, bakeSize: tier.bakeSize }, { signal });
    }

    constructor({
        scene, quality = 'High', capture = false, seed = 0x5ed1, bake = null,
    } = {}) {
        this.scene = scene;
        this.quality = quality;
        this.tier = tierFor(quality);
        this.capture = capture;
        this.seed = seed;
        this.preparedBake = bake;
        this.root = new THREE.Group();
        this.root.name = 'Painted Ages';
        this.parts = {};
        this.partList = [];
        this.record = new StrataRecord(seed);
        this.u = createPaintedAgesUniforms();
        this.recordTexture = createRecordTexture(this.record);
        this._recordVersion = -1;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1920, 1080);
        this.layoutLive = false;
        this.cameraRig = bowCamera(this.aspect);
        this.reducedMotion = false;
        this.disposed = false;
        this._camera = null;
        this._rest = new THREE.PerspectiveCamera(42, this.aspect, REST_RIG.near, REST_RIG.far);
        this._point = new THREE.Vector3();
        this._sun = {};
        this._rgb = [0, 0, 0];
        this._colours = Array.from({ length: 10 }, () => [0, 0, 0]);
        this._floodColours = Array.from({ length: 4 }, () => [0, 0, 0]);
        this.queue = Array.from({ length: QUEUE_SIZE }, () => ({
            live: false, time: 0, front: 0, formation: 0, thickness: 1, synthetic: true, codes: new Uint8Array(10),
        }));
        this.depositTimes = new Float64Array(16);
        this.depositCursor = 0;
        this._projectedPoint = { x: 0, y: 0 };
        this._lockArgs = {
            chute: null, time: 0, color: this._rgb, hardDrop: false, distance: 0, reduceMotion: false,
        };
        this._slurryArgs = {
            chute: null, time: 0, colors: this._colours, front: 0,
        };
        this._buryArgs = { front: 0, time: 0 };
        this._hoodooArgs = {
            time: 0, side: 0, u: 0.3, lines: 1, chute: null,
        };
        this._floodArgs = { time: 0, colors: this._floodColours };
        this._partState = {
            time: 0, wetGlobal: 0, wetZones: 0, curtainEdge: 0, reducedMotion: false,
        };
        this._post = {
            exposure: 1, iris: 1, sat: 1.06, bloomBoost: 0, gradeShadow: [0.025, 0.018, 0.045], gradeLight: [1.015, 1, 0.975],
        };
        this.overrides = {
            wet: null, sun: null, formation: null, view: 'full',
        };
        this.sunAzimuth = solveSunAzimuth(this.layout, this.aspect);
        this.resetState(0);
    }

    resetState(time) {
        this.time = time;
        this.level = 1;
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.fold = 0;
        this.foldFrom = 0;
        this.foldAt = -1e6;
        this.tilt = 0;
        this.tiltFrom = 0;
        this.tiltAt = -1e6;
        this.tiltTarget = 0;
        this.wetZones = 0;
        this.wetFrom = 0;
        this.weatherAt = -1e6;
        this.wetTarget = 0;
        this.wetGlobal = 0;
        this.wetAt = -1e6;
        this.wetStrength = 0;
        this.releaseAt = -1e6;
        this.releasePeak = 0;
        this.perfectAt = -1e6;
        this.floodAt = -1e6;
        this.gameOverAt = -1e6;
        this.gameOverTarget = 0;
        this.gameOverFrom = 0;
        this.lowLight = 0;
        this.datum = 0;
        this.depositAt = -1e6;
        this.lastLockAt = -1e6;
        this.frontCursor = 0;
        this.depositCursor = 0;
        this.depositTimes.fill(-1e6);
        this.sessionEnded = false;
        this.depositedLines = 0;
        this.counts = emptyCounts();
        this.lastLock = {
            at: -1e6, player: 0, u: 0.5, hardDrop: false, distance: 0,
        };
        this.lastClear = {
            at: -1e6, lines: 0, rowCodes: [], rows: [],
        };
        this.droppedDeposits = 0;
        for (const slot of this.queue) slot.live = false;
        for (const part of this.partList) part.reset?.();
    }

    build() {
        if (this.root.parent) return this;
        const started = performance.now();
        this.bake = this.preparedBake || bakeTerrain({ seed: this.seed, vertices: this.tier.terrainVertices, bakeSize: this.tier.bakeSize });
        this.preparedBake = null;
        this.bakeMs = this.bake.diagnostics?.bakeMs ?? performance.now() - started;
        const params = {
            u: this.u, tier: this.tier, bake: this.bake, recordTexture: this.recordTexture,
        };
        this.addPart('sky', createSky(params));
        this.addPart('land', createLand(params));
        this.addPart('water', createWater(params));
        this.addPart('air', createAir(params));
        this.addPart('steam', createSteam(params));
        this.addPart('hoodoo', createHoodoos(params));
        this.scene.add(this.root);
        return this;
    }

    addPart(name, part) {
        this.parts[name] = part;
        this.partList.push(part);
        const meshes = part.meshes || [part.mesh];
        for (const mesh of meshes) if (mesh) this.root.add(mesh);
    }

    showOnlyParts(names) {
        const keep = new Set(names);
        for (const name of PAINTED_AGES_PARTS) {
            const part = this.parts[name];
            if (part) for (const mesh of part.meshes || [part.mesh]) if (mesh) mesh.visible = keep.has(name);
        }
    }

    bindCamera(camera) { this._camera = camera; }

    setReducedMotion(value) { this.reducedMotion = value === true; }

    setCaptureOverrides(overrides) { Object.assign(this.overrides, overrides); }

    setViewport(width, height, aspect) {
        this.u.resolution.value.set(Math.max(1, width), Math.max(1, height));
        this.u.viewport.value.copy(this.u.resolution.value);
        if (aspect > 0) this.aspect = aspect;
        this.u.aspect.value = this.aspect;
        if (!this.layoutLive) this.setLayout(null, this.aspect);
    }

    setLayout(rects, aspect) {
        if (aspect > 0) this.aspect = aspect;
        this.cameraRig = bowCamera(this.aspect);
        this.layoutLive = Boolean(rects);
        this.layout = rects || fallbackLayout(this.u.viewport.value.x, this.u.viewport.value.y);
        this.sunAzimuth = solveSunAzimuth(this.layout, this.aspect);
        const card = this.layout.cards[0];
        if (card) this.u.boardCalm.value.set(card.x0, card.y0, card.x1, card.y1);
        this.u.boardLive.value = this.layoutLive ? 1 : 0;
        let count = 0;
        if (this.layoutLive) {
            for (const rect of [...this.layout.cards, this.layout.hud]) {
                if (!rect || count >= 5) continue;
                this.u.eventRows[EVENT_ROWS.calm + count].set(rect.x0, rect.y0, rect.x1, rect.y1);
                count++;
            }
        }
        this.u.calmCount.value = count;
    }

    pose(camera, time, pointerX = 0, pointerY = 0) {
        const rig = this.cameraRig;
        camera.aspect = this.aspect;
        camera.fov = rig.fov;
        camera.near = REST_RIG.near;
        camera.far = REST_RIG.far;
        camera.position.set(0, 140, 200);
        const move = this.reducedMotion ? 0 : 1;
        const drift = this.layoutLive ? 0 : Math.sin((TAU * time) / 80) * 4;
        const yaw = rig.yaw + move * (drift + Math.sin((TAU * time) / 23) * 0.25 + clamp(pointerX, -1, 1) * 1.2);
        const pitch = rig.pitch + move * (Math.sin((TAU * time) / 31) * 0.15 + clamp(pointerY, -1, 1) * 0.3);
        camera.rotation.set(pitch * DEG, -yaw * DEG, 0, 'YXZ');
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
    }

    updateCamera(camera, sim) {
        this.time = Number.isFinite(sim.time) ? sim.time : this.time;
        this.pose(camera, this.time, sim.pointerX || 0, sim.pointerY || 0);
        this._camera = camera;
    }

    restCamera() {
        this.pose(this._rest, this.time, 0, 0);
        return this._rest;
    }

    /** Pick an actual downhill chute with its whole run outside all live card/HUD keep-outs. */
    chooseChute(context = {}, preferredFront = null) {
        if (!this.bake?.chutes?.length) return null;
        if (this.aspect < 0.62 && this.bake.portraitChutes?.length) {
            const index = clampInt((context.u ?? 0.5) * 9, 0, 9);
            return this.bake.portraitChutes[index];
        }
        const aim = pickChute(this.layout, context.player || 0, context.u ?? 0.5, context.rows || [19]);
        const camera = this._camera || this.restCamera();
        let best = null;
        let score = Infinity;
        for (const chute of this.bake.chutes) {
            if (preferredFront !== null && chute.front !== preferredFront) continue;
            const { points } = chute;
            let safe = true;
            let distance = 0;
            for (let i = 0; i < points.length; i += 3) {
                this._point.set(points[i], points[i + 1], points[i + 2]).project(camera);
                const x = this._point.x * 0.5 + 0.5;
                const y = 0.5 - this._point.y * 0.5;
                if (x < 0.025 || x > 0.975 || y < 0.08 || y > 0.99 || this._point.z > 1
                    || !outsideKeepOut(this.layout, Object.assign(this._projectedPoint, { x, y }), 0.015)) safe = false;
                if (i === 0) distance = (x - aim.head.x) ** 2 + (y - aim.head.y) ** 2;
            }
            if (safe && distance < score) { best = chute; score = distance; }
        }
        // A narrow multiplayer view may hide all runs. Keep the event on a world front;
        // the post still protects every live card, and the mineral record always advances.
        if (!best) {
            const front = preferredFront ?? aim.front ?? 0;
            const candidates = this.bake.chutes.filter((c) => c.front === front);
            best = candidates[clampInt((context.u ?? 0.5) * (candidates.length - 1), 0, candidates.length - 1)]
                || this.bake.chutes[0];
        }
        return best;
    }

    onLock(context = {}) {
        if (this.disposed) return;
        const chute = this.chooseChute(context);
        if (!chute) return;
        this.lastLockAt = this.time;
        Object.assign(this.lastLock, {
            at: this.time,
            player: context.player || 0,
            u: context.u ?? 0.5,
            hardDrop: Boolean(context.hardDrop),
            distance: context.distance || 0,
            chute: chute.id,
        });
        this.counts.locks++;
        if (context.hardDrop) this.counts.hardDrops++;
        hexToLinear(context.color || PIECE_COLORS[0], this._rgb);
        Object.assign(this._lockArgs, {
            chute,
            time: this.time,
            hardDrop: Boolean(context.hardDrop),
            distance: context.distance || 0,
            reduceMotion: this.reducedMotion,
        });
        this.parts.air.fire(this._lockArgs);
        if (this.gameOverTarget > 0) this.onSessionStart();
    }

    onClear(context = {}) {
        if (this.disposed) return;
        if (context.perfect) {
            this.perfectAt = this.time;
            this.counts.perfects++;
            return;
        }
        const lines = clampInt(context.lines || 1, 1, 4);
        this.counts.clears++;
        this.counts.lines += lines;
        Object.assign(this.lastClear, {
            at: this.time,
            lines,
            rows: Array.from(context.rows || []),
            rowCodes: Array.from(context.rowCodes || []),
        });
        for (let row = 0; row < lines; row++) {
            const slot = this.queue.find((s) => !s.live);
            if (!slot) { this.droppedDeposits++; continue; }
            slot.live = true;
            slot.time = this.time + row * TIMING.rowStagger;
            slot.front = this.frontCursor++ % 2;
            slot.formation = clampInt(this.overrides.formation ? this.overrides.formation - 1 : (this.level - 1) % 6, 0, 5);
            slot.thickness = lines === 4 ? 2 : 1;
            slot.synthetic = !context.rowCodes || context.rowCodes.length < (row + 1) * 10;
            if (!slot.synthetic) for (let c = 0; c < 10; c++) slot.codes[c] = context.rowCodes[row * 10 + c];
        }
        if (lines === 4) {
            this.counts.quads++;
            this.floodAt = this.time + TIMING.floodDelay;
            this.wetAt = this.time;
            this.wetStrength = 0.8;
            for (let r = 0; r < 4; r++) {
                this._floodColours[r].fill(0);
                for (let c = 0; c < 10; c++) {
                    const code = context.rowCodes?.[r * 10 + c] ?? r;
                    hexToLinear(PIECE_COLORS[clampInt(code, 0, 7)], this._rgb);
                    for (let k = 0; k < 3; k++) this._floodColours[r][k] += this._rgb[k] * 0.1;
                }
            }
            this._floodArgs.time = this.floodAt;
            this.parts.water.setFlood(this._floodArgs);
            this.parts.air.spray?.({ chute: this.chooseChute({}, 0), time: this.floodAt });
            this.parts.air.spray?.({ chute: this.chooseChute({}, 1), time: this.floodAt });
        }
        if (context.tspin) {
            this.counts.tspins++;
            const column = context.u ?? ((context.player || 0) === this.lastLock.player ? this.lastLock.u : 0.5);
            Object.assign(this._hoodooArgs, {
                time: this.time,
                side: column < 0.5 ? -1 : 1,
                u: column,
                lines,
                chute: this.chooseChute({ ...context, u: column }, column < 0.5 ? 0 : 1),
            });
            this.parts.hoodoo.fire(this._hoodooArgs);
        }
        if (context.combo > this.combo) this.onCombo(context.combo);
    }

    deposit(slot) {
        this.record.deposit(slot.synthetic ? null : slot.codes, {
            time: slot.time, formation: slot.formation, thickness: slot.thickness,
        });
        this.depositedLines++;
        for (let c = 0; c < 10; c++) this.record.read(0, c, this._colours[c]);
        this._slurryArgs.chute = this.chooseChute({}, slot.front);
        this._slurryArgs.time = slot.time;
        this._slurryArgs.front = slot.front;
        this.parts.air.slurry(this._slurryArgs);
        this._buryArgs.front = slot.front;
        this._buryArgs.time = slot.time;
        this.parts.air.bury(this._buryArgs);
        this.datum += 1;
        this.depositTimes[this.depositCursor++ % this.depositTimes.length] = slot.time;
        this.depositAt = slot.time;
        slot.live = false;
        const recordLevel = Math.floor(this.depositedLines / TIMING.formationLines) + 1;
        if (recordLevel > this.level) this.levelUp(recordLevel, { time: slot.time });
    }

    onCombo(value) {
        const n = clampInt(value, 0, 1000);
        if (n === this.combo) return;
        if (n > this.combo && n >= 2) this.counts.chainSteps++;
        if (n === 0 && this.peak >= 2) {
            this.releaseAt = this.time;
            this.releasePeak = this.peak;
            this.counts.releases++;
            this.wetAt = this.time;
            this.wetStrength = Math.min(0.8, (this.peak - 1) * 0.13);
        }
        this.wetFrom = this.wetZones;
        this.weatherAt = this.time;
        this.wetTarget = n > 1 ? Math.min(n - 1, 7) : 0;
        this.combo = n;
        this.peak = n === 0 ? 0 : Math.max(this.peak, n);
    }

    onB2B(value) {
        const n = clampInt(value, 0, 4);
        if (n === this.b2b) return;
        if (n > this.b2b) this.counts.b2bSteps++;
        this.foldFrom = this.fold;
        this.foldAt = this.time;
        this.b2b = n;
    }

    levelUp(level, { silent = false, time = this.time } = {}) {
        const n = Math.max(1, Math.round(Number(level) || 1));
        if (n === this.level) return;
        this.tiltFrom = this.tilt;
        this.tiltTarget = (n - 1) * 6;
        this.tiltAt = silent ? time - TIMING.tilt : time;
        this.level = n;
        if (silent || this.reducedMotion) this.tilt = this.tiltTarget;
        if (!silent) {
            this.counts.levelUps++;
            this.appendTuff(time);
        }
    }

    appendTuff(time = this.time) {
        this.record.deposit(null, {
            time, formation: (this.level - 1) % 6, thickness: 0.65, tuff: true,
        });
        this.datum++;
        this.depositTimes[this.depositCursor++ % this.depositTimes.length] = time;
        this.depositAt = time;
    }

    onGameOver() {
        if (this.sessionEnded) return;
        this.sessionEnded = true;
        const pending = this.queue.filter((slot) => slot.live).sort((a, b) => a.time - b.time);
        for (const slot of pending) {
            slot.time = this.time;
            this.deposit(slot);
        }
        this.appendTuff();
        this.gameOverFrom = this.lowLight;
        this.gameOverTarget = 1;
        this.gameOverAt = this.time;
        this.counts.gameOvers++;
        this.parts.air.ash?.({ time: this.time });
    }

    onSessionStart() {
        this.sessionEnded = false;
        this.gameOverFrom = this.lowLight;
        this.gameOverTarget = 0;
        this.gameOverAt = this.time;
        this.counts.mornings++;
    }

    resetSession() {
        this.combo = 0;
        this.peak = 0;
        this.b2b = 0;
        this.wetTarget = 0;
        for (const slot of this.queue) slot.live = false;
        // New play buries the sealed game. Only an explicit capture seek rebuilds deep time.
    }

    clearHistory() { this.record.prefill(); }

    seek(time) {
        this.resetState(Math.max(0, Number(time) || 0));
        this.record.seek(this.time);
        this.datum = this.record.total;
    }

    prefillDeposits(count, seed = this.seed) {
        const random = mulberry32(seed);
        const codes = new Uint8Array(10);
        for (let i = 0; i < clampInt(count, 0, 512); i++) {
            for (let c = 0; c < 10; c++) codes[c] = Math.floor(random() * 7);
            this.record.deposit(codes, { time: this.time });
        }
        this.datum = this.record.total;
    }

    update(sim, camera = this._camera) {
        if (this.disposed) return;
        this.time = Number.isFinite(sim.time) ? sim.time : this.time;
        // Reused low slots can hold newer rows: drain by due time, without allocating a sort buffer.
        for (let count = 0; count < QUEUE_SIZE; count++) {
            let next = null;
            for (let i = 0; i < QUEUE_SIZE; i++) {
                const slot = this.queue[i];
                if (slot.live && slot.time <= this.time && (!next || slot.time < next.time)) next = slot;
            }
            if (!next) break;
            this.deposit(next);
        }
        const { time } = this;
        const { u } = this;
        this.wetZones = this.wetFrom + (this.wetTarget - this.wetFrom)
            * smooth(0, this.wetTarget ? TIMING.weatherStep : TIMING.retreat, time - this.weatherAt);
        this.wetGlobal = this.wetStrength * Math.exp(-Math.max(0, time - this.wetAt) / 52);
        if (time - Math.max(this.lastLockAt, this.wetAt) > TIMING.idleDry && this.combo === 0) this.wetGlobal = 0;
        this.fold = this.foldFrom + (this.b2b - this.foldFrom)
            * smooth(0, this.b2b ? TIMING.foldRise : TIMING.foldRelease, time - this.foldAt);
        this.tilt = this.reducedMotion ? this.tiltTarget
            : this.tiltFrom + (this.tiltTarget - this.tiltFrom) * smooth(0, TIMING.tilt, time - this.tiltAt);
        this.lowLight = this.gameOverFrom + (this.gameOverTarget - this.gameOverFrom)
            * smooth(0, this.gameOverTarget ? TIMING.sunset : TIMING.morning, time - this.gameOverAt);
        sunAt(time, this.sunAzimuth, this.reducedMotion, this._sun);
        const elevation = this.overrides.sun ?? (this._sun.elevation * (1 - this.lowLight) + this.lowLight);
        const e = elevation * DEG;
        const a = this._sun.azimuth * DEG;
        u.sunDir.value.set(-Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
        u.sunElevation.value = elevation;
        u.sunAzimuth.value = this._sun.azimuth;
        u.time.value = time;
        u.ambientTime.value = time % 4096;
        u.aspect.value = this.aspect;
        u.wetGlobal.value = this.overrides.wet ?? this.wetGlobal;
        u.wetAge.value = Math.max(0, time - this.wetAt);
        u.wetOverride.value = this.overrides.wet ?? -1;
        u.wetZones.value = this.wetZones;
        u.curtainEdge.value = this.wetZones;
        u.reducedMotion.value = this.reducedMotion ? 1 : 0;
        u.fold.value = this.fold;
        u.tilt.value = this.tilt;
        u.tiltPrevious.value = this.tiltFrom;
        u.tiltBlend.value = this.reducedMotion ? smooth(0, 0.3, time - this.tiltAt) : 1;
        u.gameOver.value = this.lowLight;
        u.tuff.value = this.lowLight;
        u.formation.value = this.overrides.formation ? this.overrides.formation - 1 : (this.level - 1) % FORMATIONS.length;
        u.view.value = 0;
        if (this.overrides.view === 'shade') u.view.value = 1;
        if (this.overrides.view === 'strata') u.view.value = 2;
        const age = time - this.depositAt;
        const progress = smooth(0, this.reducedMotion ? 0.3 : TIMING.nearStep, age);
        let uncompleted = 0;
        let farUncompleted = 0;
        for (const started of this.depositTimes) {
            const q = clamp((time - started) / TIMING.nearStep, 0, 1) - 1;
            const eased = 1 + 1.9012172824206395 * q ** 3 + 0.9012172824206395 * q ** 2;
            uncompleted += 1 - eased;
            farUncompleted += 1 - smooth(0, TIMING.farStep, time - started);
        }
        // head advances at deposition; only its unfinished fraction offsets the material.
        // A cumulative offset would cancel head and hide every new player-written bed.
        u.datum.value = uncompleted;
        u.depositBlend.value = farUncompleted;
        u.depositAge.value = age;
        u.depositStep.value = progress;
        u.recordHead.value = this.record.head;
        u.perfectAge.value = time - this.perfectAt;
        u.perfect.value = (1 - smooth(TIMING.perfectHold, TIMING.perfectHold + TIMING.perfectFade, u.perfectAge.value))
            * smooth(0, 1.4, u.perfectAge.value);
        const releaseAge = time - this.releaseAt;
        u.releasePeak.value = this.releasePeak;
        u.bow.value = this.releasePeak >= 5 ? smooth(0.6, 2.5, releaseAge) * (1 - smooth(12, 18, releaseAge)) : 0;
        u.flood.value = smooth(0, TIMING.floodTravel, time - this.floodAt)
            * (1 - smooth(4, TIMING.floodDrain, time - this.floodAt));
        if (camera) {
            camera.updateMatrixWorld();
            u.eye.value.copy(camera.position);
            u.camRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
            u.camUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
            u.camForward.value.setFromMatrixColumn(camera.matrixWorld, 2).negate();
            u.tanHalfFov.value = Math.tan(camera.fov * DEG * 0.5);
            u.pixelAngle.value = (2 * u.tanHalfFov.value) / Math.max(1, u.viewport.value.y);
        }
        if (this._recordVersion !== this.record.version) {
            this.recordTexture.needsUpdate = true;
            this._recordVersion = this.record.version;
        }
        Object.assign(this._partState, {
            time,
            wetGlobal: u.wetGlobal.value,
            wetZones: this.wetZones,
            curtainEdge: this.wetZones,
            reducedMotion: this.reducedMotion,
        });
        for (const part of this.partList) part.update?.(this._partState);
    }

    getPostState() { return this._post; }

    getState() {
        return {
            quality: this.quality,
            time: this.time,
            level: this.level,
            formation: this.u.formation.value + 1,
            counts: { ...this.counts },
            combo: this.combo,
            peak: this.peak,
            b2b: this.b2b,
            fold: this.fold,
            tilt: this.tilt,
            wetZones: this.wetZones,
            wetGlobal: this.u.wetGlobal.value,
            bow: this.u.bow.value,
            lowLight: this.lowLight,
            recordRows: this.record.total,
            recordHead: this.record.head,
            pendingDeposits: this.queue.filter((s) => s.live).length,
            droppedDeposits: this.droppedDeposits,
            reducedMotion: this.reducedMotion,
            sceneChildren: this.root.children.length,
            bakeMs: this.bakeMs,
            parts: Object.keys(this.parts),
        };
    }

    exportSessionState() {
        const scalars = {};
        for (const key of SNAPSHOT_FIELDS) scalars[key] = this[key];
        return {
            scalars,
            total: this.record.total,
            head: this.record.head,
            data: this.record.data.slice(),
            baseline: this.record.baseline.slice(),
            baselineHead: this.record.baselineHead,
            baselineTotal: this.record.baselineTotal,
            journal: this.record.journal.map((event) => ({ ...event, codes: event.codes?.slice() || null, bytes: event.bytes.slice() })),
            counts: { ...this.counts },
            lastLock: { ...this.lastLock },
            depositTimes: this.depositTimes.slice(),
            queue: this.queue.map((slot) => ({ ...slot, codes: slot.codes.slice() })),
            floodColours: this._floodColours.map((rgb) => rgb.slice()),
            parts: Object.fromEntries(Object.entries(this.parts).filter(([, part]) => part.exportState)
                .map(([name, part]) => [name, part.exportState()])),
        };
    }

    importSessionState(state) {
        if (!state?.data || state.data.length !== this.record.data.length) return;
        for (const key of SNAPSHOT_FIELDS) if (state.scalars[key] !== undefined) this[key] = state.scalars[key];
        this.record.data.set(state.data);
        this.record.baseline.set(state.baseline);
        this.record.head = state.head;
        this.record.total = state.total;
        this.record.baselineHead = state.baselineHead;
        this.record.baselineTotal = state.baselineTotal;
        this.record.journal = state.journal;
        this.record.version++;
        for (const [name, snapshot] of Object.entries(state.parts || {})) this.parts[name]?.importState?.(snapshot);
        this.counts = { ...state.counts };
        if (state.lastLock) Object.assign(this.lastLock, state.lastLock);
        this.depositTimes.set(state.depositTimes);
        for (let i = 0; i < this.queue.length; i++) {
            const { codes, ...values } = state.queue[i];
            Object.assign(this.queue[i], values);
            this.queue[i].codes.set(codes);
        }
        for (let i = 0; i < 4; i++) this._floodColours[i].splice(0, 3, ...state.floodColours[i]);
        if (this.time - this.floodAt < TIMING.floodDrain) {
            this._floodArgs.time = this.floodAt;
            this.parts.water.setFlood(this._floodArgs);
        }
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.root.removeFromParent();
        for (const part of this.partList) part.dispose();
        this.recordTexture.dispose();
        this.root.clear();
        this.partList.length = 0;
    }
}
