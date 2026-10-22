/**
 * Shifting Sands — the world: builds and animates every element, owns the camera rig and the
 * event choreography. Shared by the theme (shifting-sands-theme.js) and the playground effect
 * (src/playground/effects/shifting-sands.effect.js), so what is iterated there is what ships.
 *
 * Everything that moves is closed-form in the world clock (plus event timestamps), so motion is
 * frame-rate independent and `seek(t)` reproduces any frame exactly for captures. The one
 * exception is what play speeds up: the sand sheets, the spindrift and the dust banks run on a
 * phase the CPU integrates (speed · dt on top of their closed-form idle phase), so a gust or a
 * storm reads as the wind quickening, never as the pattern jumping.
 *
 * Play BUILDS here instead of popping (src/themes/shared/gameplay-surge.js): every flash, gust,
 * flare and glow is a Swell a new hit adds to, and the heat of play raises a sandstorm. Calm: the
 * dusk as it always was. Warm: the wind rises and the sand sheets stream thicker. Hot: the drum
 * beats louder, the crests burn, the motes thicken toward their blue fringe and the dust banks
 * start to drive across the far erg. Fever: the storm breaks — the crests smoke, the ember sun
 * swells and pours its shafts, the ground trembles and the worm comes for the drummer. A perfect
 * clear crowns it (geysers all round the erg, a sun flare that lingers); when the hands rest the
 * sand settles back to the still dusk over a few seconds.
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, SURGE_WEIGHTS, Swell } from '../shared/gameplay-surge.js';
import { ComboTracker } from '../../core/combo-tracker.js';
import {
    MOONS, REST_RIG, SUNS, dirFromAzEl, windDirXZ,
} from './shifting-sands-composition.js';
import {
    ATMOSPHERE_LOOK, createAtmosphere, createNoiseTexture,
} from './shifting-sands-tsl.js';
import { DuneField, createTerrain, GROUND_PULSE_SLOTS } from './shifting-sands-terrain.js';
import { createSky } from './shifting-sands-sky.js';
import { createFormations } from './shifting-sands-rocks.js';
import { WORM_SLOTS, WormDirector, createWorm } from './shifting-sands-worm.js';
import {
    BLOW_SLOTS, FX_TIERS, createDustGeysers, createGoldMotes, createSpindrift, createWormSand,
} from './shifting-sands-fx.js';
import { drainSteps } from '../shared/build-steps.js';

const DEG = Math.PI / 180;

/** Content budgets per quality tier. */
export const WORLD_TIERS = Object.freeze({
    Minimal: { clouds: false, stars: false, rockDetail: 0.5 },
    Low: { clouds: true, stars: false, rockDetail: 0.65 },
    Medium: { clouds: true, stars: true, rockDetail: 0.8 },
    High: { clouds: true, stars: true },
    Ultra: { clouds: true, stars: true },
    Extreme: { clouds: true, stars: true },
});

/** Degrees each sun sinks by full dusk. */
const DUSK_SINK = Object.freeze({ a: 2.2, b: 4.0 });

/** Where the drum stands: on the sand just beyond the foot of the board. */
const DRUM = Object.freeze({ x: 0, z: -150 });

/** Geyser sites, alternating between the side zones. */
const BLOW_SITES = Object.freeze([
    { az: -27, dist: 1050 },
    { az: 22, dist: 1250 },
    { az: -38, dist: 1500 },
    { az: 43, dist: 1100 },
    { az: -30, dist: 1900 },
    { az: 37, dist: 1700 },
]);

/** Frame-rate independent exponential approach: fraction of the gap closed in `dt`. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

/** The idle wind (closed form) and its integral, so the sand's idle phase is closed form too. */
export const idleWind = (t) => 0.55 + Math.sin(t * 0.11) * 0.15 + Math.sin(t * 0.37 + 1.2) * 0.08;
const idleWindPhase = (t) => 0.55 * t - Math.cos(t * 0.11) * (0.15 / 0.11) - Math.cos(t * 0.37 + 1.2) * (0.08 / 0.37);

/**
 * Speeds of the sand that wind and gusts drive (phase units a second): the sheets streaming over
 * the erg (noise UV · 1/0.018) and the spindrift off the crests. speed = wind·k + gust·g + base.
 */
export const SAND_FLOW = Object.freeze({
    sheets: Object.freeze({ wind: 26, gust: 40, base: 6 }),
    spindrift: Object.freeze({ wind: 1.2, gust: 2, base: 0.4 }),
});
/** Dust banks: noise cells drifted per second at rest, and how much faster a full storm drives them. */
const BANK_DRIFT = 0.006;
const BANK_STORM = 6;
/** The idle fog (distance density, height density, height falloff, max amount). */
const FOG = Object.freeze([0.62e-4, 3.6e-4, 1 / 48, 0.88]);

/** Drum rings: closer together than this, a beat joins the ring still rolling out. */
const DRUM_JOIN = 0.12;
const DRUM_MAX = 2.6;
/** A ground pulse's light falls as exp(−age·k) (terrain.js ring fade). */
const PULSE_FADE = 1.15;
/** A geyser column is gone by this age (fx.js: life ≤ 5.8 s). */
const BLOW_LIFE = 6;
/** Local boards that keep a combo of their own (the bus carries `player`). */
const TRACKED_PLAYERS = 4;

function setLook(color, [hex, k]) {
    return color.setHex(hex, THREE.SRGBColorSpace).multiplyScalar(k);
}

export class ShiftingSandsWorld {
    /**
     * @param {object} opts
     * @param {THREE.Scene} opts.scene
     * @param {string} [opts.quality]
     * @param {boolean} [opts.capture] deterministic capture mode (no wall-clock randomness)
     */
    constructor({ scene, quality = 'High', capture = false } = {}) {
        this.scene = scene;
        this.quality = WORLD_TIERS[quality] ? quality : 'High';
        this.tier = WORLD_TIERS[this.quality];
        this.capture = capture;
        this.group = new THREE.Group();
        this.group.name = 'shifting-sands-world';
        this.time = 0;
        this.dusk = 0; // 0 golden hour → 1 deep dusk (level progression)
        this.duskTarget = 0;
        this.restPosition = new THREE.Vector3();
        this.restPitch = REST_RIG.pitchDeg * DEG;
        this.pointer = { x: 0, y: 0 };
        this.reducedMotion = false;
        this.parts = null;
        this.keepOut = []; // screen-x spans (fractions) covered by the gameplay boards and the HUD
        this.viewHalfAz = 0;
        this._tmpV = new THREE.Vector3();
        this._sunScreen = { x: 0.25, y: 0.3, visible: 1 };
        this._groundScratch = {
            h: 0, u: 0, amp: 0, base: 0, rust: 0,
        };

        // ── Reactions: every one a Swell, so a new hit adds to what is still lit ──
        /** The wind's gusts (sheets and spindrift race, then ease back). */
        this.gustSwell = new Swell({
            attack: 0.18, release: 1 / 0.7, ceiling: 1.05, knee: 0.75,
        });
        /** The post's warm lift (frame-wide: the post scales it by flashScale()). */
        this.flashSwell = new Swell({ release: 1 / 2.5, ceiling: 0.75, knee: 0.5 });
        /** Both suns flare. */
        this.flareSwell = new Swell({
            attack: 0.1, release: 1 / 1.5, ceiling: 0.6, knee: 0.4,
        });
        /** Gold dust glitters brighter (and toward its blue fringe). */
        this.glowSwell = new Swell({
            attack: 0.15, release: 2, ceiling: 1.4, knee: 0.9,
        });
        /** A perfect clear's crown: the suns' flare that lingers. */
        this.crownSwell = new Swell({
            attack: 0.35, release: 3.2, ceiling: 1, knee: 0.8,
        });
        /** How hot play runs (shared/gameplay-surge.js): what raises the sandstorm. */
        this.surge = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0, storm: 0, crown: 0,
        };
        /** The true combo per local board (the bus's COMBO is the cascade depth). */
        this.trackers = Array.from({ length: TRACKED_PLAYERS }, () => new ComboTracker());
        this.chain = 0; // the combo the last clear reached
        this.depth = 1; // the cascade wave the current lock has reached
        this.pendingHard = false;
        /** Integrated phase on top of the closed-form idle one (sheets, spindrift, dust banks). */
        this.flowExtra = { sheets: 0, spindrift: 0, banks: 0 };
        this.drum = { slot: -1, at: -Infinity };
        this.feverWormAt = -Infinity;
        this.lastStage = 0;
        this.spinTurn = 0;
        /** What the post reads: the warm lift, the bloom's swell and the iris. */
        this.flash = 0;
        this.bloomBoost = 0;
        this.exposure = 1;
    }

    build() {
        drainSteps(this.buildSteps());
        return this;
    }

    /**
     * The build as steps, the heavy parts a step each (the formations' lathes, the terrain's bake):
     * run at once by build(), or with a breath between steps while the theme comes in
     * (shared/build-steps.js). The same parts in the same order.
     */
    * buildSteps() {
        const wind = windDirXZ();
        const sunA = dirFromAzEl(SUNS.a.az, SUNS.a.el);
        const sunB = dirFromAzEl(SUNS.b.az, SUNS.b.el);
        this.sunDirA = sunA;
        this.sunDirB = sunB;

        const look = ATMOSPHERE_LOOK.day;
        this.noiseTex = createNoiseTexture();
        const s = {
            uTime: uniform(0),
            uSunA: uniform(sunA.clone()),
            uSunB: uniform(sunB.clone()),
            uSunLightA: uniform(setLook(new THREE.Color(), look.sunLightA)),
            uSunLightB: uniform(setLook(new THREE.Color(), look.sunLightB)),
            uZenith: uniform(setLook(new THREE.Color(), look.zenith)),
            uUpper: uniform(setLook(new THREE.Color(), look.upper)),
            uHorizonWarm: uniform(setLook(new THREE.Color(), look.horizonWarm)),
            uHorizonCool: uniform(setLook(new THREE.Color(), look.horizonCool)),
            uFog: uniform(new THREE.Vector4(...FOG)),
            uDusk: uniform(0),
            uSunFlare: uniform(0),
            uWind: uniform(0.5),
            uGust: uniform(0),
            uGoldGlow: uniform(0),
            // The heat of play: x level, y fever, z storm (what the wind and dust spend), w burn
            // (what the crests and the suns' rays spend).
            uHeat: uniform(new THREE.Vector4()),
            // Integrated phases: x the sand sheets, y the spindrift (see SAND_FLOW).
            uFlow: uniform(new THREE.Vector2()),
            // The dust banks' drift, in noise cells (integrated: a storm drives them faster).
            uBankDrift: uniform(0),
            uPxScale: uniform(1080 / (2 * Math.tan(25 * DEG))),
            uWindDir: uniform(new THREE.Vector2(wind.x, wind.z)),
            noiseTex: this.noiseTex,
        };
        s.atmosphere = createAtmosphere(s);
        this.shared = s;
        // Day/dusk endpoints of every atmosphere colour; applyDusk() lerps between them.
        this.lookPairs = ['sunLightA', 'sunLightB', 'zenith', 'upper', 'horizonWarm', 'horizonCool'].map((key) => ({
            target: s[`u${key[0].toUpperCase()}${key.slice(1)}`].value,
            day: setLook(new THREE.Color(), ATMOSPHERE_LOOK.day[key]),
            dusk: setLook(new THREE.Color(), ATMOSPHERE_LOOK.dusk[key]),
        }));
        this.appliedDusk = -1;
        this.applyDusk(0);
        yield 'atmosphere';

        // ── The erg ──
        this.field = new DuneField({ wind, offset: { x: 1830, z: -420 } });
        // Formations first: their solids join the shadow march.
        this.rocks = createFormations({ field: this.field, shared: s, detail: this.tier.rockDetail ?? 1 });
        this.field.extraHeight = this.rocks.heightAt;
        this.group.add(this.rocks.mesh);
        yield 'formations';
        const mid = sunA.clone().add(sunB).multiplyScalar(0.5).normalize();
        this.terrain = createTerrain({
            field: this.field, shared: s, tierName: this.quality, shadowDir: mid,
        });
        this.group.add(this.terrain.mesh);
        yield 'terrain';

        // ── Sky ──
        this.sky = createSky(s, {
            clouds: this.tier.clouds,
            stars: this.tier.stars,
            uMoonA: uniform(dirFromAzEl(MOONS.a.az, MOONS.a.el)),
            uMoonB: uniform(dirFromAzEl(MOONS.b.az, MOONS.b.el)),
            moonRadA: MOONS.a.radiusDeg * DEG,
            moonRadB: MOONS.b.radiusDeg * DEG,
            sunRadA: SUNS.a.radiusDeg * DEG,
            sunRadB: SUNS.b.radiusDeg * DEG,
        });
        this.group.add(this.sky.mesh);

        // ── The worm ──
        this.worm = createWorm(s, this.tier.worm || {});
        this.group.add(this.worm.mesh);
        // Captures replay the reference sequence of sites; in play every session draws its own.
        this.director = new WormDirector((x, z) => this.field.sample(x, z, this._groundScratch).h, {
            obstacles: this.rocks.obstacles,
            capture: this.capture,
            salt: this.capture ? 0 : Math.floor(Math.random() * 0xffffffff),
        });
        this.flash = 0;
        this.rumble = 0;
        yield 'sky and worm';

        // ── Sand, glitter and dust ──
        const fx = FX_TIERS[this.quality] || FX_TIERS.High;
        this.fxTier = fx;
        this.wormSand = createWormSand(s, this.worm, fx.wormSand);
        this.motes = createGoldMotes(s, fx.motes);
        this.spindrift = createSpindrift(s, this.field, fx.spindrift);
        this.blows = createDustGeysers(s, fx.blowPerSlot);
        this.wormSand.mesh.visible = fx.wormSand > 0;
        this.spindrift.mesh.visible = this.spindrift.count > 0;
        this.group.add(this.wormSand.mesh, this.motes.mesh, this.spindrift.mesh, this.blows.mesh);

        // ── Rest camera: stand on the sand with the authored clearance ──
        let ground = -Infinity;
        for (let i = 0; i < 9; i++) {
            const a = (i / 9) * Math.PI * 2;
            ground = Math.max(ground, this.field.height(Math.cos(a) * 12, Math.sin(a) * 12));
        }
        ground = Math.max(ground, this.field.height(0, 0));
        this.restPosition.set(0, ground + REST_RIG.clearance, 0);
        this.director.eye = this.restPosition;
        // Draw the first site now, while the build is the frame that stutters: the picker runs
        // cold here, warm on every later cycle.
        this.director.idleBreach(0);

        this.scene.add(this.group);
    }

    /** Debug/perf: draw only these parts (dunes, sky, rocks, worm, fx). */
    showOnlyParts(parts) {
        this.parts = new Set(parts);
        const show = (obj, name) => { if (obj) obj.visible = this.parts.has(name); };
        show(this.terrain?.mesh, 'dunes');
        show(this.sky?.mesh, 'sky');
        show(this.rocks?.mesh, 'rocks');
        show(this.worm?.mesh, 'worm');
        ['wormSand', 'motes', 'spindrift', 'blows'].forEach((k) => show(this[k]?.mesh, 'fx'));
    }

    /**
     * The deepening dusk: every atmosphere colour slides toward its dusk value and both suns
     * sink (the bake stores horizon TANGENTS, so lower suns cast longer shadows for free).
     */
    applyDusk(d) {
        const k = Math.min(1, Math.max(0, d));
        if (Math.abs(k - this.appliedDusk) < 1e-4) return;
        this.appliedDusk = k;
        for (let i = 0; i < this.lookPairs.length; i++) {
            const p = this.lookPairs[i];
            p.target.copy(p.day).lerp(p.dusk, k);
        }
        dirFromAzEl(SUNS.a.az, SUNS.a.el - DUSK_SINK.a * k, this.sunDirA);
        dirFromAzEl(SUNS.b.az, SUNS.b.el - DUSK_SINK.b * k, this.sunDirB);
        this.shared.uSunA.value.copy(this.sunDirA);
        this.shared.uSunB.value.copy(this.sunDirB);
        this.shared.uDusk.value = k;
    }

    // ── Camera rig ────────────────────────────────────────────────────────────────

    /**
     * The rig breathes around the rest pose (slow, closed-form drift) and leans with the pointer.
     * @param {THREE.PerspectiveCamera} camera
     * @param {{time:number, pointerX?:number, pointerY?:number}} sim
     */
    updateCamera(camera, sim) {
        const t = sim.time ?? this.time;
        const px = sim.pointerX ?? 0;
        const py = sim.pointerY ?? 0;
        const p = this.restPosition;
        const m = this.reducedMotion ? 0 : 1;
        const bx = (Math.sin(t * 0.071) * 6 + Math.sin(t * 0.173 + 1.3) * 2.2) * m;
        const by = (Math.sin(t * 0.097 + 0.7) * 1.6 + Math.sin(t * 0.21) * 0.6) * m;
        const bz = Math.sin(t * 0.053 + 2.1) * 5 * m;
        // The ground trembles while the worm is near (a fine, decaying tremor; never a shake).
        const r = this.reducedMotion ? 0 : this.rumble;
        const tx = r * (Math.sin(t * 37.0) * 0.35 + Math.sin(t * 23.0 + 1.1) * 0.25);
        const ty = r * (Math.sin(t * 41.0 + 0.4) * 0.3);
        camera.position.set(p.x + bx + px * 14 + tx, p.y + by - py * 5 + ty, p.z + bz);
        const yaw = (Math.sin(t * 0.043) * 0.9 * m + px * 1.6) * DEG;
        const pitch = this.restPitch + (Math.sin(t * 0.061 + 0.4) * 0.35 * m - py * 0.9) * DEG;
        camera.rotation.order = 'YXZ';
        camera.rotation.set(pitch, -yaw, Math.sin(t * 0.05) * 0.12 * DEG * m);
        // The shared breath (shared/camera-breath.js) on top of the rig's own: off under reduced motion.
        applyCameraBreath(camera, t, { scale: m });
        camera.updateMatrixWorld();
    }

    // ── Simulation ────────────────────────────────────────────────────────────────

    seek(t) {
        this.time = Math.max(0, t);
        this.director?.reset();
        this.flash = 0;
        this.rumble = 0;
        // A seek is a fresh, repeatable state: nothing lit, no storm, the sand on its idle phase.
        this.gustSwell.reset();
        this.flashSwell.reset();
        this.flareSwell.reset();
        this.glowSwell.reset();
        this.crownSwell.reset();
        this.surge.reset();
        this.flowExtra.sheets = 0;
        this.flowExtra.spindrift = 0;
        this.flowExtra.banks = 0;
        this.drum.slot = -1;
        this.drum.at = -Infinity;
        this.feverWormAt = -Infinity;
        this.lastStage = 0;
    }

    /** Reduced motion: the rig holds still (no breathing, no tremor); events stay. */
    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /**
     * Game over / new game: the dusk returns to golden hour. A worm that has been called still
     * runs its course — forgetting it here would cut it out of the air in a single frame.
     */
    resetSession() {
        this.duskTarget = 0;
        // A new run starts a new chain (the storm itself settles on its own).
        for (let i = 0; i < this.trackers.length; i++) this.trackers[i].reset();
        this.chain = 0;
        this.depth = 1;
        this.pendingHard = false;
    }

    // ── Events (pure state writes; nothing is created at event time) ─────────────
    //
    // Every answer ADDS to what is still lit (Swells) and feeds the surge, so rapid play builds
    // instead of restarting. `react: false` keeps the bookkeeping (the true combo, the cascade
    // depth) while background reactions are off.

    /** The true combo of one local board (`player` from the bus; one board otherwise). */
    trackerFor(player) {
        const i = Number.isInteger(player) && player >= 0 ? player % TRACKED_PLAYERS : 0;
        return this.trackers[i];
    }

    /** The lock about to come was a hard drop (the bus sends HARD_DROP just before PIECE_LOCK). */
    onHardDrop() {
        this.pendingHard = true;
    }

    /**
     * A drum beat: a ring of lifted sand runs out across the erg from below the board, louder the
     * longer the chain and the hotter play runs.
     * @param {{ react?: boolean, ring?: boolean, player?: number }} [opts]
     */
    onPieceLock({ react = true, ring = true, player } = {}) {
        const carried = this.trackerFor(player).notePieceLocked();
        const broke = carried === 0 && this.chain >= 3;
        if (carried === 0) this.chain = 0;
        this.depth = 1;
        const hard = this.pendingHard;
        this.pendingHard = false;
        if (!react) return;
        const t = this.time;
        this.surge.lock({ hardDrop: hard }, t);
        // A long chain that ends is felt as a release: the suns breathe out a last glow.
        if (broke) {
            this.flareSwell.hit(0.18, t);
            this.glowSwell.hit(0.25, t);
        }
        if (!ring) return;
        const level = this.surge.level.valueAt(t);
        this.drumBeat(Math.min(DRUM_MAX, 1 + Math.min(carried, 8) * 0.12 + level * 0.7 + (hard ? 0.2 : 0)), t);
    }

    /**
     * The cascade depth (the physics COMBO: the waves of one lock). Each deeper wave lifts more
     * gold into the air and blows harder.
     * @param {number} combo
     * @param {{ react?: boolean }} [opts]
     */
    onCombo(combo, { react = true } = {}) {
        const c = Number.isFinite(combo) ? combo : 0;
        if (c < 2) return;
        this.depth = Math.max(this.depth, Math.min(12, c));
        if (!react) return;
        this.glowSwell.hit(Math.min(1.1, 0.25 + c * 0.1), this.time);
        this.gustSwell.hit(Math.min(0.6, 0.12 + c * 0.06), this.time);
    }

    /**
     * Lines cleared: geysers of dust, a gust, the suns flare. A cascade's later waves build on
     * the first (harder, brighter, a drum beat each, louder each time); a Tetris calls the worm.
     * @param {number} lines
     * @param {{ cascade?: number, react?: boolean, player?: number }} [opts] cascade: which wave
     *   of its lock this clear is (1: the lock's own); the last COMBO's depth when absent
     */
    onLineClear(lines, { cascade, react = true, player } = {}) {
        const n = Math.max(1, Math.min(4, lines | 0));
        const depth = Number.isFinite(cascade) && cascade >= 1 ? Math.min(12, cascade | 0) : this.depth;
        this.depth = Math.max(this.depth, depth);
        const combo = this.trackerFor(player).noteLineClear();
        this.chain = combo;
        if (!react) return;
        const t = this.time;
        const deep = Math.min(6, depth - 1);
        if (deep === 0) {
            this.surge.clear({ lines: n, combo }, t);
        } else {
            const W = SURGE_WEIGHTS;
            this.surge.punch.hit(W.punch.wave + W.punch.lines[n] * 0.4, t);
            this.surge.level.hit(W.heat.wave + W.heat.lines[n] * 0.25, t);
        }
        const build = 1 + deep * 0.18;
        this.gustSwell.hit((0.45 + n * 0.14) * build, t);
        this.flashSwell.hit((0.25 + n * 0.12) * build, t);
        this.flareSwell.hit((0.15 + n * 0.08) * build, t);
        // The chain stokes the gold dust; every wave past the first beats the drum again.
        if (combo >= 2) this.glowSwell.hit(0.1 + Math.min(combo, 10) * 0.05, t);
        if (deep > 0) this.drumBeat(Math.min(DRUM_MAX, 1.1 + deep * 0.3), t);
        if (n >= 4) {
            // A Tetris calls the worm: one great blow where it will break the surface. If the
            // last one it called is still above the sand, the geysers answer instead.
            if (this.director.summon(t)) {
                this.heraldWorm();
            } else {
                for (let i = 0; i < 3; i++) this.spawnGeyser(t + i * 0.22, 1.3);
            }
            this.glowSwell.hit(1.2, t);
        } else {
            for (let i = 0; i < n; i++) this.spawnGeyser(t + i * 0.22, 0.8 + n * 0.12 + deep * 0.1);
        }
    }

    /**
     * A T-spin: the drum turns — beats round it one after another (a third of a turn for one
     * that cleared nothing), a twist of wind and a glint of gold.
     * @param {number} [lineCount]
     * @param {{ react?: boolean }} [opts]
     */
    onTSpin(lineCount, { react = true } = {}) {
        if (!react) return;
        const t = this.time;
        const cleared = !Number.isFinite(lineCount) || lineCount > 0;
        const W = SURGE_WEIGHTS;
        if (cleared) {
            this.surge.punch.hit(W.punch.tspin, t);
            this.surge.level.hit(W.heat.tspin, t);
        } else {
            this.surge.spin(t);
        }
        this.spinTurn = (this.spinTurn + 1) % 6;
        const beats = cleared ? 3 : 1;
        for (let i = 0; i < beats; i++) {
            const a = (i / 3 + this.spinTurn / 6) * Math.PI * 2;
            const x = DRUM.x + Math.cos(a) * 110;
            const z = DRUM.z + Math.sin(a) * 110;
            this.pushGroundPulse(x, z, cleared ? 1.4 : 0.8, t + i * 0.11);
        }
        this.gustSwell.hit(cleared ? 0.35 : 0.18, t);
        this.glowSwell.hit(cleared ? 0.35 : 0.15, t);
    }

    /**
     * Back-to-back: the drum answers twice (the beat and its echo) and the gold dust glints
     * toward its blue fringe.
     * @param {{ react?: boolean }} [opts]
     */
    onBackToBack({ react = true } = {}) {
        if (!react) return;
        const t = this.time;
        const W = SURGE_WEIGHTS;
        this.surge.punch.hit(W.punch.b2b, t);
        this.surge.level.hit(W.heat.b2b, t);
        this.drumBeat(1.8, t);
        this.pushGroundPulse(DRUM.x, DRUM.z, 1.6, t + 0.32);
        this.glowSwell.hit(0.6, t);
        this.flareSwell.hit(0.2, t);
    }

    /**
     * A perfect clear (physics sends it ~360 ms after the clear's last wave): the crown on the
     * clear still playing, never a second one — geysers all round the erg one after another, the
     * drum's greatest beat, and a flare of both suns that lingers.
     * @param {{ react?: boolean }} [opts]
     */
    onPerfectClear({ react = true } = {}) {
        if (!react) return;
        const t = this.time;
        this.surge.crown(t);
        this.crownSwell.hit(1, t);
        this.glowSwell.hit(0.8, t);
        this.pushGroundPulse(DRUM.x, DRUM.z, DRUM_MAX, t);
        for (let i = 0; i < BLOW_SITES.length; i++) {
            const site = BLOW_SITES[i];
            const az = site.az * DEG;
            // Every other column rings the sand (the pool keeps the drum's own ring alive).
            this.spawnGeyserAt(Math.sin(az) * site.dist, -Math.cos(az) * site.dist, t + i * 0.12, 1.25, i % 2 === 0);
        }
    }

    /** The geyser that heralds a summoned worm, where it will break the surface. */
    heraldWorm() {
        const em = this.director.summonedEmergence();
        this.spawnGeyserAt(em.x, em.z, this.director.summoned.t0 - 0.7, 1.5);
    }

    /** One drum beat; beats closer than DRUM_JOIN roll out as one louder ring. */
    drumBeat(strength, t = this.time) {
        const pulses = this.terrain.uniforms.uPulses.array;
        const d = this.drum;
        if (d.slot >= 0 && t - d.at < DRUM_JOIN && t >= d.at && pulses[d.slot].z === d.at) {
            const p = pulses[d.slot];
            p.w = Math.min(DRUM_MAX, p.w + strength * 0.5);
            return;
        }
        d.slot = this.pushGroundPulse(DRUM.x, DRUM.z, strength, t);
        d.at = t;
    }

    /**
     * A ground pulse into the slot whose ring has the least light left (one still to come keeps
     * its slot), so a weak beat never cuts a strong ring short.
     * @returns {number} the slot
     */
    pushGroundPulse(x, z, strength, t0 = this.time) {
        const pulses = this.terrain.uniforms.uPulses.array;
        const now = this.time;
        let slot = 0;
        let weakest = Infinity;
        for (let i = 0; i < GROUND_PULSE_SLOTS; i++) {
            const p = pulses[i];
            const age = now - p.z;
            const left = age < 0 ? p.w + 10 : p.w * Math.exp(-age * PULSE_FADE);
            if (left < weakest) {
                weakest = left;
                slot = i;
            }
        }
        pulses[slot].set(x, z, t0, strength);
        return slot;
    }

    /** Place a dust geyser in a side zone (alternating), seated on the sand. */
    spawnGeyser(t0, strength) {
        this.blowCount = (this.blowCount || 0) + 1;
        const site = BLOW_SITES[this.blowCount % BLOW_SITES.length];
        const az = site.az * DEG;
        this.spawnGeyserAt(Math.sin(az) * site.dist, -Math.cos(az) * site.dist, t0, strength);
    }

    /**
     * A geyser into the slot with the least column left (one still to rise — a worm's herald —
     * keeps its slot), so a new clear never yanks a rising column to a new site.
     */
    spawnGeyserAt(x, z, t0, strength, ring = true) {
        const blows = this.blows.uBlows.array;
        const pows = this.blows.uBlowPow.array;
        const now = this.time;
        let slot = 0;
        let weakest = Infinity;
        for (let i = 0; i < BLOW_SLOTS; i++) {
            const age = now - blows[i].w;
            const s = pows[i].x;
            const left = age < 0 ? s + 10 : s * Math.max(0, 1 - age / BLOW_LIFE);
            if (left < weakest) {
                weakest = left;
                slot = i;
            }
        }
        const y = this.field.sample(x, z, this._groundScratch).h;
        blows[slot].set(x, y, z, t0);
        pows[slot].set(strength, 0, 0, 0);
        if (ring) this.pushGroundPulse(x, z, 1.6 * strength, Math.max(now, t0));
    }

    /**
     * @param {number} level
     * @param {{ react?: boolean }} [opts]
     */
    onLevelUp(level, { react = true } = {}) {
        const n = Number.isFinite(level) ? level : 1;
        this.duskTarget = Math.min(1, Math.max(0, (n - 1) / 14));
        if (!react) return;
        this.surge.levelUp(this.time);
        this.flareSwell.hit(0.25, this.time);
    }

    /** Where play stands this frame (sampled once a frame, on the world clock). */
    sampleHeat(t) {
        const h = this.surge.sample(t);
        const out = this.heat;
        out.punch = h.punch;
        out.level = h.level;
        out.fever = h.fever;
        out.stage = h.stage;
        out.crown = this.crownSwell.valueAt(t);
        // The sandstorm: a quick hand raises it, a fever breaks it.
        out.storm = Math.min(1, h.level * 0.7 + h.fever * 0.45);
        return out;
    }

    /**
     * The storm the heat of play raises, spent on the world's own systems: the wind and its
     * gusts (sheets, spindrift and dust banks on integrated phases), the dust in the air, the
     * gold motes, the suns, and the post's bloom and iris.
     */
    applyStorm(t, dt, heat) {
        const s = this.shared;
        const {
            level, fever, storm, crown,
        } = heat;
        const motion = this.reducedMotion ? 0.4 : 1;
        // ── Wind: the idle breath, raised by the storm, with the gusts on top ──
        const windExtra = storm * 0.6;
        const gust = this.gustSwell.valueAt(t);
        s.uWind.value = idleWind(t) + windExtra;
        s.uGust.value = gust;
        const F = SAND_FLOW;
        const fx = this.flowExtra;
        fx.sheets += dt * (windExtra * F.sheets.wind + gust * F.sheets.gust) * motion;
        fx.spindrift += dt * (windExtra * F.spindrift.wind + gust * F.spindrift.gust) * motion;
        fx.banks += dt * BANK_DRIFT * BANK_STORM * storm * motion;
        const w = idleWindPhase(t);
        s.uFlow.value.set(
            w * F.sheets.wind + t * F.sheets.base + fx.sheets,
            w * F.spindrift.wind + t * F.spindrift.base + fx.spindrift,
        );
        s.uBankDrift.value = t * BANK_DRIFT + fx.banks;
        // ── The air thickens: the far erg veils in drifting dust ──
        s.uFog.value.set(FOG[0] * (1 + storm * 0.3), FOG[1] * (1 + storm * 0.7), FOG[2], FOG[3]);
        // ── Light: gold dust, both suns, the burning crests ──
        s.uGoldGlow.value = Math.min(1.8, this.glowSwell.valueAt(t) + level * 0.3 + fever * 0.45 + crown * 0.6);
        const flare = this.flareSwell.valueAt(t) + level * 0.05 + fever * 0.12 + crown * 0.45;
        s.uSunFlare.value = flare;
        s.uHeat.value.set(level, fever, storm, Math.min(1, level * 0.35 + fever * 0.5 + crown * 0.4));
        // ── Post: the warm lift, the bloom's swell, and an iris that closes a little as the heat
        // adds light, so the dusk keeps its darks and its colour ──
        this.flash = this.flashSwell.valueAt(t) + crown * 0.12;
        this.bloomBoost = flare * 0.5 + level * 0.2 + fever * 0.5;
        this.exposure = 1 - Math.max(0, level - 0.2) * 0.08 - fever * 0.03;
    }

    /**
     * @param {{time:number, delta:number}} sim
     * @param {THREE.Camera} camera
     */
    update(sim, camera) {
        this.time = sim.time;
        const t = this.time;
        const dt = Math.max(0, sim.delta || 0);
        const s = this.shared;
        s.uTime.value = t;
        this.dusk += (this.duskTarget - this.dusk) * approach(0.6, dt);
        this.applyDusk(this.dusk);
        const heat = this.sampleHeat(t);
        // The storm breaks: the worm comes for the drummer (once a fever, never over a summons).
        if (heat.stage === 3 && this.lastStage !== 3 && t - this.feverWormAt > 45) {
            this.feverWormAt = t;
            if (this.director.summon(t)) this.heraldWorm();
        }
        this.lastStage = heat.stage;
        // ── Worms: each slot writes its body, its sand and its marks on the erg ──
        const ws = this.director.update(t);
        this.worm.apply(ws.slots);
        this.wormSand.apply(ws.slots);
        const tu = this.terrain.uniforms;
        for (let i = 0; i < WORM_SLOTS; i++) {
            const st = ws.slots[i];
            tu.uSigns.array[i].set(st.sign.x, st.sign.z, st.sign.wake, st.sign.strength);
            tu.uSignDirs.array[i].set(st.sign.dx, st.sign.dz, 0, 0);
            tu.uPulses.array[GROUND_PULSE_SLOTS + i].set(st.ring.x, st.ring.z, st.ring.t0, st.ring.strength);
            for (let j = 0; j < 2; j++) {
                const well = st.wells[j];
                tu.uWells.array[i * 2 + j].set(well.x, well.z, well.radius, well.width);
                tu.uWellH.array[i * 2 + j].set(well.rim, well.bulge, well.crater, well.scar);
            }
        }
        const blowArr = this.blows.uBlows.array;
        let blowLive = false;
        for (let i = 0; i < blowArr.length; i++) {
            const age = t - blowArr[i].w;
            if (age > -1.5 && age < 6.5) blowLive = true;
        }
        this.blows.setActive(blowLive);
        // The ground trembles while the worm is near, and under a fever (a fine tremor, never a
        // shake; the rig ignores it under reduced motion).
        const rumble = Math.max(ws.rumble, heat.fever * 0.22 + heat.punch * 0.25);
        this.rumble += (rumble - this.rumble) * approach(rumble > this.rumble ? 6 : 1.5, dt);
        this.applyStorm(t, dt, heat);

        if (camera) this.updateSunScreen(camera);
    }

    /** Project the primary sun into screen UV (y down) for the post's shafts and flare. */
    updateSunScreen(camera) {
        const v = this._tmpV.copy(this.sunDirA).multiplyScalar(10000).add(camera.position);
        v.project(camera);
        const inFront = v.z < 1 ? 1 : 0;
        this._sunScreen.x = v.x * 0.5 + 0.5;
        this._sunScreen.y = 0.5 - v.y * 0.5;
        const edgeFade = (c) => Math.max(0, 1 - Math.max(0, Math.abs(c) - 1) * 4);
        const onScreen = edgeFade(v.x) * edgeFade(v.y);
        this._sunScreen.visible = inFront * onScreen;
        // Far horizon line in screen UV (for the heat haze band).
        const h = this._tmpV.set(0, camera.position.y - 6, -12000).project(camera);
        this._sunScreen.horizonY = 0.5 - h.y * 0.5;
        return this._sunScreen;
    }

    getSunScreen() {
        return this._sunScreen;
    }

    /** Pixel-sized content follows the drawing buffer; the worm's range follows the lens. */
    setViewport(bufferHeight, camera) {
        const fov = (camera?.fov ?? REST_RIG.fov) * DEG;
        this.shared.uPxScale.value = Math.max(1, bufferHeight) / (2 * Math.tan(fov / 2));
        this.viewHalfAz = Math.atan(Math.tan(fov / 2) * (camera?.aspect ?? 16 / 9)) / DEG;
        this.syncWormView();
    }

    /**
     * The gameplay boards and the HUD (screen fractions, as the post's calm zones read them):
     * the worm keeps clear of what they cover.
     */
    setKeepOutRects(rects) {
        this.keepOut = (rects || []).filter(Boolean).map((r) => [r.x0, r.x1]);
        this.syncWormView();
    }

    syncWormView() {
        if (!this.director || !(this.viewHalfAz > 0)) return;
        const edge = Math.tan(this.viewHalfAz * DEG);
        const azOf = (x) => Math.atan((x * 2 - 1) * edge) / DEG;
        this.director.setView({
            halfAz: this.viewHalfAz,
            bands: this.keepOut.map(([x0, x1]) => [azOf(x0), azOf(x1)]),
        });
    }

    dispose() {
        this.scene.remove(this.group);
        this.terrain?.dispose();
        this.sky?.dispose();
        this.rocks?.dispose();
        this.rocks = null;
        this.worm?.dispose();
        this.worm = null;
        ['wormSand', 'motes', 'spindrift', 'blows'].forEach((k) => { this[k]?.dispose(); this[k] = null; });
        this.noiseTex?.dispose();
        this.terrain = null;
        this.sky = null;
        this.noiseTex = null;
    }
}
