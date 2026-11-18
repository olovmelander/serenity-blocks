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
 * swells and pours its shafts, the ground trembles and the worm comes for the drummer. When the
 * hands rest the sand settles back to the still dusk over a few seconds.
 *
 * Every event has an effect of its own: the drum's ring (a lock), a gust front crossing the erg
 * (one line), geysers of sand (two and three), the worm (a Quad), a dust devil (a twist), fire
 * running along the crests (a back-to-back), far worms rising along the horizon (a perfect clear),
 * a wall of dust crossing the whole horizon (a level), and the hush when a run ends.
 *
 * And the erg never stands in one light for long: the hours of the evening walk from golden hour
 * through two sunsets to a night under the moons and back (shifting-sands-hours.js), the weather
 * turns on a clock of its own (shifting-sands-weather.js), and dust devils, falling stars and
 * gust fronts come by the clock whatever the hands do.
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { GameplaySurge, SURGE_WEIGHTS, Swell } from '../shared/gameplay-surge.js';
import { ComboTracker } from '../../core/combo-tracker.js';
import {
    MOONS, REST_RIG, SUNS, dirFromAzEl, windDirXZ,
} from './shifting-sands-composition.js';
import { createAtmosphere, createNoiseTexture } from './shifting-sands-tsl.js';
import {
    HOUR_COLOURS, HOUR_STOPS, hourLook, makeHourLook,
} from './shifting-sands-hours.js';
import {
    CREST_FIRE, DuneField, FIRE_SLOTS, FRONT_SLOTS, GROUND_PULSE_SLOTS, GUST_FRONT, createTerrainSteps,
} from './shifting-sands-terrain.js';
import { DEVIL, DEVIL_SLOTS, createDustDevils } from './shifting-sands-devils.js';
import { createSky } from './shifting-sands-sky.js';
import { createFormationsSteps } from './shifting-sands-rocks.js';
import {
    WORM_SLOTS, WORM_TIERS, WormDirector, createWorm,
} from './shifting-sands-worm.js';
import {
    BLOW_SLOTS, FX_TIERS, createDustGeysers, createGoldMotes, createSpindrift, createWormSand,
} from './shifting-sands-fx.js';
import {
    DEVIL_WALKS, GUST_FRONTS, METEORS, WALL, WEATHERS, WEATHER_HOLD, WEATHER_SECONDS, happeningIndex,
    happeningStart, hash01, makeWeather, meteorPath, wallLightning, weatherAt, weatherAtPhase, weatherIndex,
} from './shifting-sands-weather.js';
import { flashScale } from '../../utils/photosensitivity.js';
import { drainSteps } from '../shared/build-steps.js';
import {
    MOOD_HOLD, MOOD_SECONDS, moodDrift, pingPong,
} from '../shared/mood-clock.js';

const DEG = Math.PI / 180;

/** Content budgets per quality tier. */
export const WORLD_TIERS = Object.freeze({
    Minimal: {
        clouds: false, stars: false, rockDetail: 0.5, fineClouds: false,
    },
    Low: {
        clouds: true, stars: false, rockDetail: 0.65, fineClouds: false,
    },
    Medium: {
        clouds: true, stars: true, rockDetail: 0.8, fineClouds: false,
    },
    High: { clouds: true, stars: true },
    Ultra: { clouds: true, stars: true },
    Extreme: { clouds: true, stars: true },
});

/**
 * The dusk walks by the clock in every mode (shared/mood-clock.js), there and back through the
 * hours of the evening (shifting-sands-hours.js): golden hour, the ember's sunset, the second
 * sunset, the night under the moons, and home again the same way. Each of those stops rests for
 * `hold` of its `seconds` and then melts into the next, so a whole walk there and back takes
 * 2 · stops · seconds (ten minutes). `stops` is the stops a leg has (golden hour → night).
 */
export const DUSK_WALK = Object.freeze({ seconds: MOOD_SECONDS, hold: MOOD_HOLD, stops: HOUR_STOPS });
/** A level is a step along the same walk: level 15 has walked a whole leg on, into the night. */
export const DUSK_LEVEL_STEP = 1 / 14;

/**
 * How far the clock alone has walked the dusk by `time`, in legs: 0 golden hour, 1 deep dusk, 2
 * golden again (fold it with pingPong). Closed form, so a seek or a replay lands on the same light.
 * @param {number} time
 */
export const duskWalk = (time) => moodDrift(time, DUSK_WALK.seconds, DUSK_WALK.hold) / DUSK_WALK.stops;

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

/** A level calls the front across the whole horizon: seconds it takes, and how tall it stands then. */
export const FRONT_RUN = Object.freeze({
    seconds: 7.5, height: 1.45, from: 64, to: -66,
});

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth01 = (a, b, x) => {
    const k = clamp01((x - a) / (b - a));
    return k * k * (3 - 2 * k);
};

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
/**
 * A twist's dust devil: how tall it stands, how wide its foot, how long it lives and how fast it
 * walks (a twist that cleared, and one that cleared nothing). The clock's own walks far off.
 */
export const DEVILS = Object.freeze({
    twist: Object.freeze({
        height: 210, radius: 8.5, life: 9.5, speed: 30, dist: [900, 1250],
    }),
    spin: Object.freeze({
        height: 130, radius: 6, life: 6.5, speed: 24, dist: [800, 1050],
    }),
    walk: Object.freeze({
        height: 330, radius: 14, life: DEVIL_WALKS.life, speed: 38, dist: [1700, 2700],
    }),
});
/** The run is over: seconds the hush takes to fall, and to lift when a new run begins. */
export const HUSH = Object.freeze({ fall: 3.2, lift: 2.4, dusk: 0.42 });

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
        this.dusk = 0; // 0 golden hour → 1 night: the clock's walk plus the level's steps
        /** The look of the hour the dusk stands at (shifting-sands-hours.js), rewritten in place. */
        this.hour = makeHourLook();
        /** The level's steps along the walk (in legs), eased toward duskTarget. */
        this.duskSteps = 0;
        this.duskTarget = 0;
        /** Whole walks there and back the steps had made when the last session ended (see resetSession). */
        this.duskBase = 0;
        /** A dusk held still (the playground's ?dusk=); null lets the clock walk it. */
        this.duskHold = null;
        /** The weather of the air this frame (shifting-sands-weather.js), rewritten in place. */
        this.weather = makeWeather();
        /** A weather held still (a phase round the wheel: the playground's ?weather=); null lets the clock turn it. */
        this.weatherHold = null;
        /** The front held at an azimuth (degrees: the playground's ?wallAz=). */
        this.wallHold = null;
        /** When a level last called the front across the horizon. */
        this.frontRunAt = -Infinity;
        this._bolt = { glow: 0, at: 0 };
        this.meteorSeen = -2;
        /** The dust devils standing (each walks a line over the dunes; see updateDevils). */
        this.devilList = Array.from({ length: DEVIL_SLOTS }, () => ({
            t0: -Infinity, life: 0, x0: 0, z0: 0, dx: 0, dz: 0, speed: 0, height: 0, radius: 0, strength: 0, seed: 0,
        }));
        this.devilSeen = -2;
        this.devilTurn = 0;
        this.gustSeen = -2;
        /** The hush after a run: when it ended, when the next began, and how deep it was then. */
        this.hush = {
            ended: -Infinity, woke: -Infinity, from: 0, level: 0,
        };
        /** How bright each falling star's slot is at its best (the stars' own light gates it). */
        this.meteorBright = [];
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
     * The build as steps, the heavy parts in slices of their own (the formations' lathes, the
     * terrain's bake): run at once by build(), or with a breath between steps while the theme comes
     * in (shared/build-steps.js). The same parts in the same order.
     */
    * buildSteps() {
        const wind = windDirXZ();
        const sunA = dirFromAzEl(SUNS.a.az, SUNS.a.el);
        const sunB = dirFromAzEl(SUNS.b.az, SUNS.b.el);
        this.sunDirA = sunA;
        this.sunDirB = sunB;

        this.noiseTex = createNoiseTexture();
        const moon = dirFromAzEl(MOONS.a.az, MOONS.a.el);
        this.moonDir = moon;
        const s = {
            uTime: uniform(0),
            uSunA: uniform(sunA.clone()),
            uSunB: uniform(sunB.clone()),
            // What each sun does to the land...
            uSunLightA: uniform(new THREE.Color()),
            uSunLightB: uniform(new THREE.Color()),
            // ...and to the air (the aureole, the rays, the clouds' undersides: it outlasts the sunset).
            uGlowA: uniform(new THREE.Color()),
            uGlowB: uniform(new THREE.Color()),
            uZenith: uniform(new THREE.Color()),
            uUpper: uniform(new THREE.Color()),
            uHorizonWarm: uniform(new THREE.Color()),
            uHorizonCool: uniform(new THREE.Color()),
            // The moons' light on the land (from the greater moon, over the Sentinel).
            uMoonDir: uniform(moon.clone()),
            uMoonLight: uniform(new THREE.Color()),
            uFog: uniform(new THREE.Vector4(...FOG)),
            // How much of a red ember the primary has become (0 golden hour → 1 from its sunset on).
            uDusk: uniform(0),
            // How far the stars have come out, and how bright the moons' discs stand.
            uNight: uniform(0),
            uMoonGain: uniform(1),
            // The weather: x cirrus, y streets, z the ribbed deck, w the haze.
            uWeather: uniform(new THREE.Vector4(WEATHERS[0].cirrus, 0, 0, 0)),
            // The wall of dust on the horizon: x how tall it stands (0 none), y its azimuth
            // (radians), z the lightning in its body, w where along it (-1..1).
            uWall: uniform(new THREE.Vector4()),
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
        // Every colour of the hour, in HOUR_COLOURS order; applyDusk() writes the melted look into them.
        this.hourTargets = HOUR_COLOURS.map((key) => s[`u${key[0].toUpperCase()}${key.slice(1)}`].value);
        this.hourExposure = 1;
        this.appliedDusk = -1;
        this.applyDusk(0);
        yield 'atmosphere';

        // ── The erg ──
        this.field = new DuneField({ wind, offset: { x: 1830, z: -420 } });
        // Formations first: their solids join the shadow march.
        this.rocks = yield* createFormationsSteps({ field: this.field, shared: s, detail: this.tier.rockDetail ?? 1 });
        this.field.extraHeight = this.rocks.heightAt;
        this.group.add(this.rocks.mesh);
        yield 'formations';
        const mid = sunA.clone().add(sunB).multiplyScalar(0.5).normalize();
        this.terrain = yield* createTerrainSteps({
            field: this.field, shared: s, tierName: this.quality, shadowDir: mid, moonDir: moon,
        });
        this.group.add(this.terrain.mesh);
        yield 'terrain';

        // ── Sky ──
        this.sky = createSky(s, {
            clouds: this.tier.clouds,
            stars: this.tier.stars,
            fineClouds: this.tier.fineClouds !== false,
            uMoonA: uniform(dirFromAzEl(MOONS.a.az, MOONS.a.el)),
            uMoonB: uniform(dirFromAzEl(MOONS.b.az, MOONS.b.el)),
            moonRadA: MOONS.a.radiusDeg * DEG,
            moonRadB: MOONS.b.radiusDeg * DEG,
            sunRadA: SUNS.a.radiusDeg * DEG,
            sunRadB: SUNS.b.radiusDeg * DEG,
        });
        this.group.add(this.sky.mesh);

        // ── The worm ──
        this.worm = createWorm(s, WORM_TIERS[this.quality] || WORM_TIERS.High);
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
        this.devils = createDustDevils(s);
        this.wormSand.mesh.visible = fx.wormSand > 0;
        this.spindrift.mesh.visible = this.spindrift.count > 0;
        this.group.add(this.wormSand.mesh, this.motes.mesh, this.spindrift.mesh, this.blows.mesh, this.devils.mesh);

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
        ['wormSand', 'motes', 'spindrift', 'blows', 'devils'].forEach((k) => show(this[k]?.mesh, 'fx'));
    }

    /**
     * Where the dusk stands at `time` (0 golden hour → 1 night): the clock's walk there and
     * back plus the level's steps along it, folded, so it never comes to rest at either end.
     * @param {number} time
     */
    duskAt(time) {
        return pingPong(this.duskSteps + duskWalk(time));
    }

    /**
     * The hour the dusk stands at: every colour of the air and the light melts between the two
     * stations it is walking between, and both suns sink (the bake stores horizon TANGENTS, so
     * lower suns cast longer shadows for free, and a sun that has set lights nothing).
     */
    applyDusk(d) {
        const k = Math.min(1, Math.max(0, d));
        if (Math.abs(k - this.appliedDusk) < 1e-5) return;
        this.appliedDusk = k;
        const L = hourLook(k, this.hour);
        for (let i = 0; i < HOUR_COLOURS.length; i++) {
            const rgb = L[HOUR_COLOURS[i]];
            const target = this.hourTargets[i];
            target.r = rgb[0];
            target.g = rgb[1];
            target.b = rgb[2];
        }
        dirFromAzEl(SUNS.a.az, L.elA, this.sunDirA);
        dirFromAzEl(SUNS.b.az, L.elB, this.sunDirB);
        const s = this.shared;
        s.uSunA.value.copy(this.sunDirA);
        s.uSunB.value.copy(this.sunDirB);
        s.uDusk.value = L.ember;
        s.uNight.value = L.stars;
        s.uMoonGain.value = L.moonGain;
        this.hourExposure = L.exposure;
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
        this.frontRunAt = -Infinity;
        this.meteorSeen = -2;
        this.devilSeen = -2;
        this.gustSeen = -2;
        for (let i = 0; i < this.devilList.length; i++) this.devilList[i].t0 = -Infinity;
        this.hush.ended = -Infinity;
        this.hush.woke = -Infinity;
        this.hush.from = 0;
        this.hush.level = 0;
    }

    /** Reduced motion: the rig holds still (no breathing, no tremor); events stay. */
    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /**
     * Game over / new game: the level's steps walk back to golden hour, so the light returns to
     * where the clock alone has it (by the nearest way: a run long enough to have walked there
     * and back keeps its whole walks). A worm that has been called still runs its course —
     * forgetting it here would cut it out of the air in a single frame.
     */
    resetSession() {
        this.duskBase = 2 * Math.round(this.duskSteps / 2);
        this.duskTarget = this.duskBase;
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
     * the first (harder, brighter, a drum beat each, louder each time); a Quad calls the worm.
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
            // A Quad calls the worm: one great blow where it will break the surface. If the
            // last one it called is still above the sand, the geysers answer instead.
            if (this.director.summon(t)) {
                this.heraldWorm();
            } else {
                for (let i = 0; i < 3; i++) this.spawnGeyser(t + i * 0.22, 1.3);
            }
            this.glowSwell.hit(1.2, t);
        } else if (n === 1) {
            // One line: the wind answers. A front of driven sand crosses the erg from behind the
            // eye to the far dunes.
            this.pushGustFront(1 + deep * 0.15, t);
        } else {
            // Two and three: geysers of sand, one a line, in the side zones (three also burst the suns).
            for (let i = 0; i < n; i++) this.spawnGeyser(t + i * 0.22, 0.8 + n * 0.12 + deep * 0.1);
            if (n === 3) this.flareSwell.hit(0.22, t);
        }
    }

    /**
     * A twist: the drum turns — beats round it one after another (a third of a turn for one
     * that cleared nothing), a twist of wind and a glint of gold.
     * @param {number} [lineCount]
     * @param {{ react?: boolean }} [opts]
     */
    onTwist(lineCount, { react = true } = {}) {
        if (!react) return;
        const t = this.time;
        const cleared = !Number.isFinite(lineCount) || lineCount > 0;
        const W = SURGE_WEIGHTS;
        if (cleared) {
            this.surge.punch.hit(W.punch.twist, t);
            this.surge.level.hit(W.heat.twist, t);
        } else {
            this.surge.spin(t);
        }
        this.spinTurn = (this.spinTurn + 1) % 6;
        // The twist of the piece is a twist of the air: a dust devil rises beside the board and
        // walks off over the dunes, a ring of sand thrown from its foot.
        const devil = this.raiseDevil(cleared ? DEVILS.twist : DEVILS.spin, t, this.spinTurn);
        this.pushGroundPulse(devil.x0, devil.z0, cleared ? 1.4 : 0.8, t + 0.15);
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
        // ...and the crests take fire: a cold light leaps from ridge to ridge out to the horizon.
        this.pushCrestFire(1, t + 0.1);
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
        // The deep erg answers: far worms rise along the horizon one after another, a geyser of
        // sand where each breaks the surface and where it strikes, and the crests take fire.
        const chorus = this.director.summonChorus(t);
        for (let i = 0; i < chorus.length; i++) {
            const br = chorus[i];
            this.spawnGeyserAt(br.up.x, br.up.z, br.t0 - 0.3, 3.4, false);
        }
        this.chorusStrikes = chorus.map((br) => ({ at: br.t0 + br.tDown - 0.2, x: br.down.x, z: br.down.z }));
        this.pushCrestFire(1.3, t + 0.2);
    }

    /** A gust front into the slot with the least of its run left. */
    pushGustFront(strength, t0 = this.time) {
        const rows = this.terrain.uniforms.uFronts.array;
        let slot = 0;
        let weakest = Infinity;
        for (let i = 0; i < FRONT_SLOTS; i++) {
            const age = this.time - rows[i].y;
            const left = age < 0 ? rows[i].z + 10 : rows[i].z * Math.max(0, 1 - age / GUST_FRONT.life);
            if (left < weakest) {
                weakest = left;
                slot = i;
            }
        }
        rows[slot].set(GUST_FRONT.from, t0, strength, GUST_FRONT.speed * (0.92 + 0.12 * Math.min(2, strength)));
        return slot;
    }

    /** Crest fire from the drum, into the slot with the least of its run left. */
    pushCrestFire(strength, t0 = this.time) {
        const rows = this.terrain.uniforms.uFires.array;
        let slot = 0;
        let weakest = Infinity;
        for (let i = 0; i < FIRE_SLOTS; i++) {
            const age = this.time - rows[i].z;
            const left = age < 0 ? rows[i].w + 10 : rows[i].w * Math.max(0, 1 - age / CREST_FIRE.life);
            if (left < weakest) {
                weakest = left;
                slot = i;
            }
        }
        rows[slot].set(DRUM.x, DRUM.z, t0, strength);
        return slot;
    }

    /**
     * Raise a dust devil of a kind (DEVILS) into the slot with the least life left. It stands in
     * a stretch of view the boards and the HUD leave open (`turn` picks which, and where in it),
     * and walks off across the wind.
     * @returns the devil's record (where it starts)
     */
    raiseDevil(kind, t0 = this.time, turn = this.devilTurn) {
        this.devilTurn = turn + 1;
        let slot = 0;
        let weakest = Infinity;
        for (let i = 0; i < this.devilList.length; i++) {
            const d = this.devilList[i];
            const left = Math.max(0, d.t0 + d.life - this.time);
            if (left < weakest) {
                weakest = left;
                slot = i;
            }
        }
        const zones = this.director.freeZones();
        const zone = zones[turn % zones.length];
        const u = 0.3 + 0.4 * hash01(turn * 3.3 + 1.7);
        let azDeg = zone[0] + (zone[1] - zone[0]) * u;
        // Never in front of a sun: its streaks cross-hatch a bright disc. It steps aside, to
        // whichever side of the suns' bearing its zone has more room on.
        if (azDeg > SUNS.a.az - 5 && azDeg < SUNS.b.az + 3.5) {
            const left = SUNS.a.az - 5 - zone[0];
            const right = zone[1] - (SUNS.b.az + 3.5);
            azDeg = right >= left
                ? SUNS.b.az + 3.5 + Math.max(0, right) * 0.45
                : SUNS.a.az - 5 - Math.max(0, left) * 0.45;
        }
        const az = azDeg * DEG;
        const dist = kind.dist[0] + (kind.dist[1] - kind.dist[0]) * hash01(turn * 5.9 + 0.2);
        // It walks across the wind, away from the middle of the view.
        const wind = this.shared.uWindDir.value;
        const out = Math.sin(az) >= 0 ? 1 : -1;
        const d = this.devilList[slot];
        d.t0 = t0;
        d.life = kind.life;
        d.x0 = Math.sin(az) * dist;
        d.z0 = -Math.cos(az) * dist;
        d.dx = -wind.y * out * 0.9 + wind.x * 0.43;
        d.dz = wind.x * out * 0.9 + wind.y * 0.43;
        d.speed = kind.speed;
        d.height = kind.height;
        d.radius = kind.radius;
        d.strength = 1;
        d.seed = hash01(turn * 7.1 + 3.9);
        return d;
    }

    /** Seat every standing devil on the sand it has walked to, and write it. */
    updateDevils(t) {
        let live = false;
        const rows = this.devils.uDevils.array;
        const shapes = this.devils.uDevilShape.array;
        for (let i = 0; i < this.devilList.length; i++) {
            const d = this.devilList[i];
            const age = t - d.t0;
            if (!(age > 0 && age < d.life)) {
                rows[i].set(0, -1000, 0, 0);
                continue;
            }
            live = true;
            const x = d.x0 + d.dx * d.speed * age;
            const z = d.z0 + d.dz * d.speed * age;
            const y = this.field.sample(x, z, this._groundScratch).h;
            const amount = smooth01(0, 0.7, age) * (1 - smooth01(d.life - DEVIL.fade, d.life, age)) * d.strength;
            // It rises from its foot, and thins away from the top at its end.
            const risen = smooth01(0, DEVIL.rise, age) * (1 - 0.35 * smooth01(d.life - DEVIL.fade, d.life, age));
            rows[i].set(x, y - 2, z, amount);
            shapes[i].set(d.height, d.radius, risen, d.seed);
        }
        this.devils.setActive(live);
    }

    /**
     * The run is over: the wind dies, the dust hangs, the light sinks a little and the stars come
     * nearer; one last slow ring rolls out from the drum. (The theme calls this on game over.)
     */
    endRun() {
        const h = this.hush;
        if (h.ended > h.woke) return;
        h.from = h.level;
        h.ended = this.time;
        this.pushGroundPulse(DRUM.x, DRUM.z, 2.2, this.time + 0.2);
    }

    /** A new run begins: the hush lifts and the wind comes back with a front of sand. */
    onSessionStart() {
        const h = this.hush;
        if (h.woke >= h.ended) return;
        h.from = h.level;
        h.woke = this.time;
        if (h.from > 0.3) {
            this.gustSwell.hit(0.5, this.time);
            this.pushGustFront(0.9, this.time + 0.3);
        }
    }

    /** How deep the hush is at `t` (0 none … 1 the run is over and the erg has gone still). */
    hushAt(t) {
        const h = this.hush;
        if (h.ended > h.woke) return h.from + (1 - h.from) * smooth01(0, HUSH.fall, t - h.ended);
        return h.from * (1 - smooth01(0, HUSH.lift, t - h.woke));
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
        // A step along the dusk's walk (eased in update()), on top of the clock's own walk.
        this.duskTarget = this.duskBase + Math.max(0, n - 1) * DUSK_LEVEL_STEP;
        if (!react) return;
        this.surge.levelUp(this.time);
        this.flareSwell.hit(0.25, this.time);
        // The front crosses the whole horizon, lightning in its body, and the hour has moved on
        // behind it.
        this.frontRunAt = this.time;
        this.gustSwell.hit(0.4, this.time);
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
        const air = this.weather;
        // What drives the sand and the dust: the storm play raises, or the weather's own wind.
        const blow = 1 - (1 - storm) * (1 - air.wind * 0.55);
        // ── Wind: the idle breath, raised by the storm and the weather, with the gusts on top ──
        const windExtra = storm * 0.6 + air.wind * 0.45;
        const gust = this.gustSwell.valueAt(t);
        // After a run the erg goes still: the wind dies back and the light sinks a little.
        const hush = this.hushAt(t);
        this.hush.level = hush;
        s.uWind.value = (idleWind(t) + windExtra) * (1 - 0.6 * hush);
        s.uGust.value = gust;
        const F = SAND_FLOW;
        const fx = this.flowExtra;
        fx.sheets += dt * (windExtra * F.sheets.wind + gust * F.sheets.gust) * motion;
        fx.spindrift += dt * (windExtra * F.spindrift.wind + gust * F.spindrift.gust) * motion;
        fx.banks += dt * BANK_DRIFT * BANK_STORM * blow * motion;
        const w = idleWindPhase(t);
        s.uFlow.value.set(
            w * F.sheets.wind + t * F.sheets.base + fx.sheets,
            w * F.spindrift.wind + t * F.spindrift.base + fx.spindrift,
        );
        s.uBankDrift.value = t * BANK_DRIFT + fx.banks;
        // ── The air thickens: the far erg veils in drifting dust (a storm, or the weather's haze) ──
        s.uFog.value.set(
            FOG[0] * (1 + storm * 0.3 + air.haze * 1.1),
            FOG[1] * (1 + storm * 0.7 + air.haze * 1.3 + air.wind * 0.35),
            FOG[2],
            Math.min(0.95, FOG[3] + air.haze * 0.05),
        );
        // ── Light: gold dust, both suns, the burning crests ──
        // (in the hush the gold dust hangs in the still air and glows, and the stars come nearer)
        const gold = this.glowSwell.valueAt(t) + level * 0.3 + fever * 0.45 + crown * 0.6 + hush * 0.4;
        s.uGoldGlow.value = Math.min(1.8, gold);
        s.uNight.value = Math.min(1, this.hour.stars + hush * 0.3);
        const flare = this.flareSwell.valueAt(t) + level * 0.05 + fever * 0.12 + crown * 0.45;
        s.uSunFlare.value = flare;
        // (the rays lengthen with the heat of play, and a little in hanging dust)
        s.uHeat.value.set(level, fever, blow, Math.min(1, level * 0.35 + fever * 0.5 + crown * 0.4 + air.haze * 0.18));
        // ── Post: the warm lift, the bloom's swell, and an iris that closes a little as the heat
        // adds light, so the dusk keeps its darks and its colour ──
        this.flash = this.flashSwell.valueAt(t) + crown * 0.12;
        this.bloomBoost = flare * 0.5 + level * 0.2 + fever * 0.5;
        this.exposure = this.hourExposure * (1 - Math.max(0, level - 0.2) * 0.08 - fever * 0.03) * (1 - 0.15 * hush);
    }

    /**
     * What comes by the clock whatever the hands do: a dust devil walking the far erg, a gust front
     * when it blows; and what a perfect clear's far worms still owe (the sand where each strikes).
     */
    runHappenings(t) {
        const walk = happeningIndex(DEVIL_WALKS, t);
        if (walk !== this.devilSeen) {
            const first = this.devilSeen === -2;
            this.devilSeen = walk;
            // (a seek lands between walks: only one that begins now is raised)
            if (walk >= 0 && !first) this.raiseDevil(DEVILS.walk, happeningStart(DEVIL_WALKS, walk), 100 + walk);
            else if (walk >= 0 && t - happeningStart(DEVIL_WALKS, walk) < DEVIL_WALKS.life) {
                this.raiseDevil(DEVILS.walk, happeningStart(DEVIL_WALKS, walk), 100 + walk);
            }
        }
        const gusts = happeningIndex(GUST_FRONTS, t);
        if (gusts !== this.gustSeen) {
            const first = this.gustSeen === -2;
            this.gustSeen = gusts;
            if (gusts >= 0 && !first && this.weather.wind >= GUST_FRONTS.minWind) {
                this.pushGustFront(0.5 + 0.4 * this.weather.wind, t);
                this.gustSwell.hit(0.22 * this.weather.wind, t);
            }
        }
        const strikes = this.chorusStrikes;
        if (strikes) {
            for (let i = strikes.length - 1; i >= 0; i--) {
                if (t >= strikes[i].at - 1) {
                    this.spawnGeyserAt(strikes[i].x, strikes[i].z, strikes[i].at, 3.0, false);
                    strikes.splice(i, 1);
                }
            }
        }
    }

    /**
     * The weather of this frame and what stands in the sky because of it: the cloud, the haze,
     * the front on the horizon with its lightning, the falling stars.
     */
    applyAir(t) {
        const s = this.shared;
        const held = Number.isFinite(this.weatherHold);
        const w = held ? weatherAtPhase(this.weatherHold, this.weather) : weatherAt(t, this.weather);
        s.uWeather.value.set(w.cirrus, w.streets, w.deck, w.haze);

        // ── The front: it comes in from the right while the weather before it melts away, and
        // travels the horizon toward the suns' bearing until its own has melted in turn ──
        const front = weatherIndex('front');
        const cycle = WEATHERS.length * WEATHER_SECONDS;
        const begins = (front - 1 + WEATHER_HOLD) * WEATHER_SECONDS;
        const ends = (front + 1) * WEATHER_SECONDS;
        const local = t - Math.floor(t / cycle) * cycle;
        const through = held ? 0.5 : clamp01((local - begins) / (ends - begins));
        let az = Number.isFinite(this.wallHold) ? this.wallHold : WALL.from + WALL.travel * through;
        let tall = w.wall;
        let quick = 1;
        // A level calls it across the whole horizon in a few seconds, taller than it ever stands.
        const run = (t - this.frontRunAt) / FRONT_RUN.seconds;
        if (run > 0 && run < 1) {
            const up = smooth01(0, 0.16, run) * (1 - smooth01(0.74, 1, run));
            const azRun = FRONT_RUN.from + (FRONT_RUN.to - FRONT_RUN.from) * smooth01(0.02, 0.98, run);
            // (it takes the wall from wherever the weather has it, by how much taller it stands;
            // with no wall of the weather's own, the run's place is its place from the first)
            const mine = FRONT_RUN.height * up;
            az += (azRun - az) * (mine / (mine + w.wall + 1e-6));
            tall = Math.max(tall, mine);
            quick = 1 + 1.6 * up;
        }
        const bolt = wallLightning(t * quick, this._bolt);
        s.uWall.value.set(tall, az * DEG, bolt.glow * Math.min(1, tall * 1.4) * flashScale(), bolt.at);

        // ── Falling stars, once the stars are out ──
        const n = happeningIndex(METEORS, t);
        if (n !== this.meteorSeen && this.sky?.uMeteorFrom) {
            this.meteorSeen = n;
            const slots = this.sky.uMeteorFrom.array.length;
            if (n >= 0) {
                const path = meteorPath(n);
                const from = dirFromAzEl(path.az, path.el, this._tmpV);
                const slot = n % slots;
                const at = happeningStart(METEORS, n) + hash01(n * 9.7 + 0.4) * (METEORS.every - METEORS.life - 1);
                this.sky.uMeteorFrom.array[slot].set(from.x, from.y, from.z, at);
                const slant = path.slant * DEG;
                const elTo = Math.max(1.5, path.el - path.run * Math.cos(slant));
                const azTo = path.az + (path.run * Math.sin(slant)) / Math.cos(path.el * DEG);
                const to = dirFromAzEl(azTo, elTo, this._tmpV);
                this.sky.uMeteorTo.array[slot].set(to.x, to.y, to.z, 0);
                this.meteorBright[slot] = path.bright;
            }
        }
        // (their light follows the stars': none by golden hour, however the slots stand)
        if (this.sky?.uMeteorTo) {
            const out = smooth01(METEORS.minStars - 0.15, METEORS.minStars + 0.2, this.hour.stars);
            const rows = this.sky.uMeteorTo.array;
            for (let i = 0; i < rows.length; i++) rows[i].w = (this.meteorBright[i] || 0) * out;
        }
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
        this.duskSteps += (this.duskTarget - this.duskSteps) * approach(0.6, dt);
        if (Math.abs(this.duskTarget - this.duskSteps) < 1e-4) this.duskSteps = this.duskTarget;
        this.dusk = Number.isFinite(this.duskHold) ? this.duskHold : this.duskAt(t);
        // Over a finished run the evening moves on (nearly half of what is left of it), and comes
        // back when the next begins.
        this.applyDusk(this.dusk + (1 - this.dusk) * HUSH.dusk * this.hushAt(t));
        const heat = this.sampleHeat(t);
        this.applyAir(t);
        // The storm breaks: the worm comes for the drummer (once a fever, never over a summons).
        if (heat.stage === 3 && this.lastStage !== 3 && t - this.feverWormAt > 45) {
            this.feverWormAt = t;
            if (this.director.summon(t)) this.heraldWorm();
        }
        this.lastStage = heat.stage;
        // ── Worms: each slot writes its body, its sand and its marks on the erg ──
        this.runHappenings(t);
        const ws = this.director.update(t);
        this.worm.apply(ws.slots, ws.far);
        this.updateDevils(t);
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
        // A sun that has set pours no shafts and throws no flare.
        const up = Math.min(1, Math.max(0, (this.sunDirA.y + 0.012) / 0.03));
        this._sunScreen.visible = inFront * onScreen * up * up * (3 - 2 * up);
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
        ['wormSand', 'motes', 'spindrift', 'blows', 'devils'].forEach((k) => { this[k]?.dispose(); this[k] = null; });
        this.noiseTex?.dispose();
        this.terrain = null;
        this.sky = null;
        this.noiseTex = null;
    }
}
