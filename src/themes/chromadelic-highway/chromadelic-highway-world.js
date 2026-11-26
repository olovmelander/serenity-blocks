/**
 * Chromadelic Highway — the world: everything that is drawn, how it evolves, and how it answers play.
 *
 * Decoupled from BaseTheme so the exact same world mounts in both the real game and the playground.
 *
 * "The board is the sun": the card hides the vanishing point, and the key light sits behind it at
 * the highway core. Every lit limb faces the board; sculpted 3D gate pylons, neon arches, speed
 * chevrons, streaks and event light radiate out of it; the rainbow-banded gas giant, its moon,
 * the ringed ice giant and the blazing binary own the visible side windows.
 *
 * Two incommensurate clocks keep the scene shifting and evolving over time:
 *   1. The Spectrum (chromadelic-highway-spectrum.js): six ring-colour & form movements every ~90 s
 *      of travel, stepping +1 movement on every level-up.
 *   2. The Cosmic Voyage (chromadelic-highway-voyage.js): five distinct space sectors (Velvet Rift,
 *      Aurora Slipstream, Starlight Crossing, Ion Corridor, Nebula Heart) on an independent 73 s
 *      clock — 30 distinct visual atmospheres that keep evolving for ~45 minutes.
 *
 * Every gameplay event has its own unmistakable visual instrument (piece lock lane ripple, hard
 * drop compression chevron slam, 1/2/3-line escalating chases & twin meteors, Twist 3D chromatic
 * double-helix corkscrew, cascade chevrons, consecutive-clear chain links & comets, Back-to-Back liquid-gold sovereign
 * corona & gilded architecture, Quad 7-lane prism hyper-warp tunnel, Perfect Clear celestial prism
 * nova + twin golden comets + crown mandala, Level-Up dimensional octagonal warp gate, and Game
 * Over hyperspace coast-down that gently breathes back to life on its own).
 */

import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import { createSkyDome, createStarfield, rotateHue } from './chromadelic-highway-sky.js';
import { createPlanetImpostor, PLANET_PALETTE } from './chromadelic-highway-planets.js';
import { FRONT_SPEED, PlanetEvents } from './chromadelic-highway-planet-events.js';
import {
    LANE_COLORS_HEX, createRails, createRoad,
} from './chromadelic-highway-road.js';
import {
    createMeteors, createMotes, createRingAir, createSpeedStreaks, createTunnelRings, latticeRingCount,
} from './chromadelic-highway-fx.js';
import { createGatePylons, createRoadChevrons } from './chromadelic-highway-architecture.js';
import {
    createCosmicPortals, createTwistHelix, createWarpTunnelRibbons, PORTAL_KIND,
} from './chromadelic-highway-events-fx.js';
import {
    createCosmicNebulaTexture, createIceRingTexture, createRainbowGiantTexture,
} from './chromadelic-highway-bake.js';
import {
    SECTORS, sectorAt, sectorIndexByName, sectorPhase,
} from './chromadelic-highway-voyage.js';
import { ChromadelicComposition, REST_RIG, restVerticalFov } from './chromadelic-highway-composition.js';
import {
    RING_SPACING, TRAVEL_SPEED, TRAVEL_WRAP, TUNNEL_SPAN, TUNNEL_Z_NEAR, spectrumRGB, worldSpeedFactor,
} from './chromadelic-highway-tsl.js';
import {
    MOVEMENTS, RING_PHASE_WRAP, SPECTRUM_HOME, STEP_TRAVEL, hueOf, neonColor, ringStyle, skyTurnAt, spectrumSummary,
} from './chromadelic-highway-spectrum.js';
import { applyCameraBreath, easedMotion, prefersReducedMotion } from '../shared/camera-breath.js';
import { GameplaySurge, SURGE_WEIGHTS, Swell } from '../shared/gameplay-surge.js';
import { flashScale, prefersReducedFlashing } from '../../utils/photosensitivity.js';
import { loadTextureDecoded, uploadTextureNow } from '../shared/decoded-texture.js';

const tier = (o) => o;

/** Per-quality content. Every tier keeps the whole composition and every gameplay event. */
export const WORLD_TIERS = {
    Minimal: tier({
        stars: 600,
        skyTaps: 0,
        aurora: false,
        moon: false,
        secondary: false,
        witness: false,
        heroDetail: false,
        planetRelief: false,
        planetAurora: false,
        fill: false,
        rim: false,
        roadSegments: 30,
        dashes: false,
        sheen: false,
        glitter: false,
        railCurtain: false,
        pylons: false,
        chevrons: 0,
        rings: 3,
        ringSegments: 64,
        ringAir: false,
        warpRails: 0,
        streaks: 0,
        motes: 0,
        meteors: 1,
        waveSlots: 1,
        paceFov: false,
        spikes: false,
    }),
    Low: tier({
        stars: 1100,
        skyTaps: 1,
        aurora: false,
        moon: true,
        secondary: false,
        witness: false,
        heroDetail: false,
        planetRelief: false,
        planetAurora: true,
        fill: false,
        rim: true,
        roadSegments: 40,
        dashes: true,
        sheen: true,
        glitter: false,
        railCurtain: true,
        pylons: false,
        chevrons: 8,
        rings: 4,
        ringSegments: 64,
        ringAir: false,
        warpRails: 6,
        streaks: 56,
        motes: 0,
        meteors: 2,
        waveSlots: 2,
        paceFov: false,
        spikes: false,
    }),
    Medium: tier({
        stars: 2000,
        skyTaps: 2,
        aurora: true,
        moon: true,
        secondary: true,
        witness: false,
        heroDetail: false,
        planetRelief: true,
        planetAurora: true,
        fill: false,
        rim: true,
        roadSegments: 70,
        dashes: true,
        sheen: true,
        glitter: false,
        railCurtain: true,
        pylons: true,
        chevrons: 12,
        rings: 6,
        ringSegments: 80,
        ringAir: true,
        warpRails: 8,
        streaks: 140,
        motes: 0,
        meteors: 4,
        waveSlots: 3,
        paceFov: true,
        spikes: true,
    }),
    High: tier({
        stars: 3200,
        skyTaps: 2,
        aurora: true,
        moon: true,
        secondary: true,
        witness: false,
        heroDetail: true,
        planetRelief: true,
        planetAurora: true,
        fill: true,
        rim: true,
        roadSegments: 100,
        dashes: true,
        sheen: true,
        glitter: true,
        railCurtain: true,
        pylons: true,
        chevrons: 16,
        rings: 8,
        ringSegments: 96,
        ringAir: true,
        warpRails: 12,
        streaks: 260,
        motes: 140,
        meteors: 8,
        waveSlots: 4,
        paceFov: true,
        spikes: true,
    }),
    Ultra: tier({
        stars: 4600,
        skyTaps: 2,
        aurora: true,
        moon: true,
        secondary: true,
        witness: true,
        heroDetail: true,
        planetRelief: true,
        planetAurora: true,
        fill: true,
        rim: true,
        roadSegments: 150,
        dashes: true,
        sheen: true,
        glitter: true,
        railCurtain: true,
        pylons: true,
        chevrons: 20,
        rings: 10,
        ringSegments: 112,
        ringAir: true,
        warpRails: 12,
        streaks: 380,
        motes: 220,
        meteors: 10,
        waveSlots: 6,
        paceFov: true,
        spikes: true,
    }),
    Extreme: tier({
        stars: 6000,
        skyTaps: 2,
        aurora: true,
        moon: true,
        secondary: true,
        witness: true,
        heroDetail: true,
        planetRelief: true,
        planetAurora: true,
        fill: true,
        rim: true,
        roadSegments: 200,
        dashes: true,
        sheen: true,
        glitter: true,
        railCurtain: true,
        pylons: true,
        chevrons: 24,
        rings: 12,
        ringSegments: 112,
        ringAir: true,
        warpRails: 12,
        streaks: 500,
        motes: 320,
        meteors: 12,
        waveSlots: 6,
        paceFov: true,
        spikes: true,
    }),
};

/** Kept for existing imports: the rest pose of the rig. */
export const CAMERA_RIG = {
    fov: REST_RIG.fov,
    position: new THREE.Vector3(REST_RIG.position.x, REST_RIG.position.y, REST_RIG.position.z),
    lookAt: new THREE.Vector3(REST_RIG.focus.x, REST_RIG.focus.y, REST_RIG.focus.z),
};

export const KEY_LIGHT = new THREE.Vector3(0, 60, -4000);

const RING_SLOTS = 16;
const CAMERA_Z = 280;
const RING_PHASE_RATE = 0.7;
export const RING_PHASE_MAX_RATE = RING_PHASE_RATE + 1.4 + 2.2 + 2.4;
const DRIVE = { level: 0.28, fever: 0.42 };
const LOCK_BAND_GAP = 0.35;
const SLAM_GAP = 0.32;
const BAND_SPENT = 0.004;
const BAND_KEEP = 0.5;
const CHASE_FOLD_S = 0.85;
// Refined tighter ring air gain so obsidian deep space stays rich and crisp while flaring on events.
const AIR_GAIN = 0.068;
const AIR_SKY_HUE = 0.77;
const AIR_SKY_PRIOR = 0.35;
const PIECE_TO_LANE = Object.freeze({
    I: 0, O: 1, T: 2, S: 3, Z: 4, J: 5, L: 6,
});

// Game-over hyperspace coast-down holds for ~6.5 s then smoothly breathes back on its own (#1722).
const COAST_HOLD = 6.5;
const COAST_RECOVER = 5.0;

const _rgb = { r: 0, g: 0, b: 0 };
export function spectrumColor(t, out = new THREE.Color()) {
    const c = spectrumRGB(t, _rgb);
    return out.setRGB(c.r, c.g, c.b);
}

// Matches the sky's velvet horizon base so the distant highway dissolves seamlessly into space.
const HAZE_BASE = new THREE.Color('#0b051e');

const WAVE_PRESETS = {
    lock: {
        v0: 520, accel: 840, amp: 0.09, hue: 0.5, width: 15, white: 0.3, tau: 0.4,
    },
    combo: {
        v0: 680, accel: 1450, amp: 0.44, hue: 1 / 6, width: 22, white: 0.22, tau: 0.55,
    },
    clear: {
        v0: 660, accel: 1450, amp: 0.52, hue: 11 / 12, width: 24, white: 0.25, tau: 0.6,
    },
    quad: {
        v0: 720, accel: 1850, amp: 0.85, hue: -1, width: 26, white: 0.12, tau: 0.68,
    },
    levelUp: {
        v0: 540, accel: 680, amp: 0.75, hue: 0.25, width: 64, white: 0.55, tau: 0.95,
    },
};

const CHAIN_STEP = 0.05;
const GOLD = new THREE.Color(1.0, 0.84, 0.44);
const T_COLOR = new THREE.Color(1.0, 0.92, 0.0);
const CYAN_COLOR = new THREE.Color(0.22, 0.92, 1.0);
const PRISM_AFTERGLOW = new THREE.Color(0.78, 0.72, 1.0);
const STORM_RATE = Object.freeze({ clear: 1.5, heat: 0.85, fever: 3.4 });

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _look = new THREE.Vector3();
const _moonLocal = new THREE.Vector3();
const _losT = new THREE.Vector3();
const _losR = new THREE.Vector3();
const _losU = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const MOON_TILT = THREE.MathUtils.degToRad(14);
const _proj = new THREE.Vector3();
const _color = new THREE.Color();
const _rgb2 = { r: 0, g: 0, b: 0 };
const _camAhead = { x: 0, y: 0 };
const _camNear = { x: 0, y: 0 };
const _decay = (fx, key, tau, dt) => { fx[key] *= Math.exp(-dt / tau); };
const _spring = (state, target, omega, dt) => {
    const x = state.x - target;
    const e = Math.exp(-omega * dt);
    const nx = (x + (state.v + omega * x) * dt) * e;
    state.v = (state.v - omega * (state.v + omega * x) * dt) * e;
    state.x = target + nx;
};

export class ChromadelicWorld {
    constructor({
        scene, quality = 'High', random = Math.random, textureBase = './textures/', capture = false, renderer = null,
    }) {
        this.scene = scene;
        this.renderer = renderer;
        this.quality = WORLD_TIERS[quality] ? quality : 'High';
        this.tier = WORLD_TIERS[this.quality];
        this.random = random;
        this.textureBase = textureBase;
        this.capture = capture;
        this.group = new THREE.Group();
        this.group.name = 'chromadelic-world';
        this.textures = [];
        this.parts = [];
        this.planets = [];
        this.time = 0;
        this.travel = 0;
        this.moteTravel = 0;
        this.speed = TRAVEL_SPEED * worldSpeedFactor(1);
        this.viewport = {
            width: 1920, height: 1080, cssHeight: 1080, dpr: 1,
        };
        this.aspect = 16 / 9;
        this.level = 1;
        this.pendingEvents = [];
        this.meteorTimer = 7;
        this.lastLockAt = -1e4;
        this.lastSlamAt = -1e4;
        this.laneSeq = 0;
        this.cometAt = -1e4;
        this.chainCometDone = false;
        this.trueCometDone = false;

        this.fx = {
            dip: 0,
            surge: 0,
            streakWarp: 0,
            warpRush: 0,
            flare: 0,
            storm: 0,
            railTick: 0,
            nebula: 0,
            combo: 0,
            ringPrism: 0,
            ringGold: 0,
            aurora: 0,
            goldGild: 0,
            nova: 0,
            coast: 0,
        };
        this.planetFx = new PlanetEvents();
        this.ringFlow = 0;
        this.dipEvent = 0;

        this.env = {
            lens: new Swell({ release: 0.55, ceiling: 1.6, knee: 1 }),
            warp: new Swell({ release: 0.5, ceiling: 1.6, knee: 1 }),
            warpRush: new Swell({
                attack: 0.05, release: 0.55, ceiling: 1.0, knee: 0.7,
            }),
            flare: new Swell({
                attack: 0.04, release: 0.5, ceiling: 1.8, knee: 1,
            }),
            nebula: new Swell({
                attack: 0.05, release: 0.65, ceiling: 1.6, knee: 1,
            }),
            storm: new Swell({ release: 0.45, ceiling: 0.95, knee: 0.7 }),
            ringPrism: new Swell({
                attack: 0.08, release: 1.2, ceiling: 1.2, knee: 0.8,
            }),
            ringGold: new Swell({
                attack: 0.06, release: 1.15, ceiling: 1.2, knee: 0.85,
            }),
            railTick: new Swell({ release: 0.09, ceiling: 1.6, knee: 1 }),
            roadPulse: new Swell({ release: 0.3, ceiling: 0.9, knee: 0.5 }),
            twist: new Swell({
                attack: 0.08, release: 0.9, ceiling: 1.4, knee: 0.9,
            }),
            aurora: new Swell({
                attack: 0.08, release: 1.1, ceiling: 1.4, knee: 0.9,
            }),
            goldGild: new Swell({
                attack: 0.06, release: 1.05, ceiling: 1.1, knee: 0.8,
            }),
            tripleRail: new Swell({
                attack: 0.06, release: 0.75, ceiling: 1.1, knee: 0.8,
            }),
            quadRail: new Swell({
                attack: 0.06, release: 1.15, ceiling: 1.2, knee: 0.85,
            }),
            perfectRail: new Swell({
                attack: 0.32, release: 1.65, ceiling: 1.3, knee: 0.9,
            }),
            nova: new Swell({
                attack: 0.08, release: 1.35, ceiling: 1.1, knee: 0.85,
            }),
        };

        this.surge = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        this.staged = {
            any: false, at: 0, lines: 0, cascade: 1, combo: 1, twist: false, b2b: false, perfect: false,
        };
        this.lockBand = null;
        this.hardDropPending = false;
        this.b2bRun = 0;
        this.chain = 0;
        this.twistSign = 1;
        this.gameOverAt = -1e4; // timestamp of last game-over coast-down (breathes back on its own)

        // Single-lane lock ripple, hard-drop slam wave, twist glass ripple, and bounded cosmic portal strokes.
        this.lanePulse = {
            lane: 3, birth: -1e4, amp: 0, z0: -200, hard: 0,
        };
        this.slamWave = {
            birth: -1e4, amp: 0, z0: -200,
        };
        this.twistGlass = {
            birth: -1e4, amp: 0, sign: 1,
        };
        this.portals = Array.from({ length: Object.keys(PORTAL_KIND).length }, (_, kind) => ({
            kind,
            birth: -1e4,
            duration: 1.2,
            startR: 0.16,
            endR: 1.15,
            width: 0.025,
            amp: 0,
            rgb: { r: 1, g: 1, b: 1 },
        }));

        // Two clocks: spectrum movements + independent cosmic voyage sectors.
        this.spectrum = {
            levelTarget: SPECTRUM_HOME, levelPlace: SPECTRUM_HOME, distance: 0, pinned: null, form: null,
        };
        this.voyage = {
            offsetTarget: 0, offset: 0, pinned: null, state: sectorAt(0),
        };
        this.ringPhase = 0;
        this.ringSlots = new Array(RING_SLOTS).fill(null);
        this.ringStyles = Array.from({ length: RING_SLOTS }, () => ({}));
        this.ringRepaint = new Array(RING_SLOTS).fill(0);
        this.repaint = null;
        this.prismEcho = 0;
        this.feverPrism = false;
        this.crownRings = 0;
        this.airGain = AIR_GAIN;
        this.leadSerial = null;
        this.air = new THREE.Color(0, 0, 0);
        this.airSeeded = false;
        this.boardActive = 0;
        this.cam = {
            lookX: { x: 0, v: 0 }, bank: { x: 0, v: 0 }, paceFov: 0,
        };
        this.composition = new ChromadelicComposition();
        this.anchors = null;
        this.cascades = Array.from({ length: 2 }, () => ({
            birth: -1e4, amp: 0, D0: 0, speed: 2400,
        }));
        this.chases = Array.from({ length: 2 }, () => ({
            birth: -1e4, duration: 0.6, fronts: 0, amp: 0,
        }));

        const slots = this.tier.waveSlots;
        this.shared = {
            uTime: uniform(0),
            uTravel: uniform(0),
            uMoteTravel: uniform(0),
            uPulse: uniform(0),
            uPace: uniform(1),
            uRingEnv: uniform(0),
            uRailTick: uniform(0),
            uMoteGain: uniform(1),
            uStreakLength: uniform(84),
            uStreakDensity: uniform(0.75),
            uGateFar: uniform(TUNNEL_Z_NEAR - this.tier.rings * RING_SPACING),
            uHaze: uniform(new THREE.Color().copy(HAZE_BASE)),
            uViewportH: uniform(1080),
            uProjScaleY: uniform(1.73),
            uPxScale: uniform(935),
            uViewportPx: uniform(new THREE.Vector2(1920, 1080)),
            uCardRectPx: uniform(new THREE.Vector4(780, 160, 1140, 920)),
            uCardRadiusPx: uniform(20),
            uHudRectPx: uniform(new THREE.Vector4(-1e4, -1e4, -1e4, -1e4)),
            uApron: uniform(new THREE.Vector4(960, 204, 920, 0)),
            uHeroPx: uniform(new THREE.Vector3(-1e4, -1e4, 1)),
            uDEmerge: uniform(1120),
            uBoardActive: uniform(0),
            uRoadSheen: uniform(1.0),
            uGoldGild: uniform(0.0),
            uFeverGlow: uniform(0.0),
            uLanePulse: uniform(new THREE.Vector4(3, 0, -500, 0)),
            uSlamWave: uniform(new THREE.Vector4(-5000, 0, 0, 0)),
            uTwistGlass: uniform(new THREE.Vector4(10, 0, 1, 0)),
            uTwistHelix: uniform(new THREE.Vector4(-1e4, 1.35, 1, 0)),
            uTwistMotion: uniform(1),
            uWarpRails: uniform(new THREE.Vector4(0, 0, 0, 0)),
            uPortalA: uniformArray(this.portals.map((p) => new THREE.Vector4(0.2, 0.02, 0, p.kind)), 'vec4'),
            uPortalB: uniformArray(this.portals.map(() => new THREE.Vector4(1, 1, 1, 0)), 'vec4'),
            uCascade: uniform(new THREE.Vector4(-1e4, 1120, 2400, 0)),
            uCascadeCol: uniform(new THREE.Vector4(1, 1, 1, 0)),
            uCascadePrism: uniform(0),
            uCascade2: uniform(new THREE.Vector4(-1e4, 1120, 2400, 0)),
            uCascadeCol2: uniform(new THREE.Vector4(1, 1, 1, 0)),
            uCascadePrism2: uniform(0),
            uChase: uniform(new THREE.Vector4(-1e4, 0.6, 0, 0)),
            uChase2: uniform(new THREE.Vector4(-1e4, 0.6, 0, 0)),
            uRingPhase: uniform(0),
            uAirGain: uniform(AIR_GAIN),
            uRingPalette: uniformArray(Array.from({ length: RING_SLOTS }, () => new THREE.Color()), 'color'),
            uRingGlow: uniformArray(Array.from({ length: RING_SLOTS }, () => new THREE.Vector4()), 'vec4'),
            uRingForm: uniformArray(Array.from({ length: RING_SLOTS }, () => new THREE.Vector4()), 'vec4'),
            waves: {
                count: slots,
                uA: uniformArray(Array.from({ length: slots }, () => new THREE.Vector4(0, 1, 0, 0)), 'vec4'),
                uB: uniformArray(Array.from({ length: slots }, () => new THREE.Vector4(1, 1, 1, 0)), 'vec4'),
            },
        };
        this.waveSlots = Array.from({ length: slots }, () => null);
        this.waveCursor = 0;
        this.ringCount = latticeRingCount(this.tier.rings);
        this.updateRingStyles();
    }

    loadTexture(path, { wrapT = THREE.ClampToEdgeWrapping } = {}) {
        const tex = loadTextureDecoded(`${this.textureBase}${path}`, {
            onImage: (landed) => uploadTextureNow(this.renderer, landed),
        });
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = wrapT;
        tex.anisotropy = 4;
        this.textures.push(tex);
        return tex;
    }

    registerTexture(tex) {
        this.textures.push(tex);
        return tex;
    }

    add(part) {
        this.parts.push(part);
        this.group.add(part.mesh);
        return part;
    }

    build() {
        const { tier: t, random, shared } = this;
        const res = this.composition.result;

        const nebulaMap = t.skyTaps > 0 ? this.registerTexture(createCosmicNebulaTexture(256)) : null;
        this.sky = this.add(createSkyDome({
            nebulaMap, taps: t.skyTaps, aurora: t.aurora, shared,
        }));
        this.stars = this.add(createStarfield({
            count: t.stars,
            random,
            bandNormal: res.sky.bandNormal,
            dustDirection: t.skyTaps > 0 ? this.sky.uniforms.uWarmDir : null,
            spikes: t.spikes,
        }));

        this.buildPlanets();

        const roadFeatures = { dashes: t.dashes, sheen: t.sheen, glitter: t.glitter };
        this.road = this.add(createRoad({ segments: t.roadSegments, shared, features: roadFeatures }));
        this.rails = this.add(createRails({
            segments: t.roadSegments, shared, features: { curtain: t.railCurtain },
        }));
        if (t.pylons) {
            this.pylons = this.add(createGatePylons({ count: t.rings, shared }));
        }
        if (t.chevrons > 0) {
            this.chevrons = this.add(createRoadChevrons({ count: t.chevrons, shared }));
        }
        this.rings = this.add(createTunnelRings({ count: t.rings, segments: t.ringSegments, shared }));
        if (t.ringAir) {
            this.ringAir = this.add(createRingAir({
                count: t.rings, segments: Math.round(t.ringSegments * 0.6), shared,
            }));
        }
        shared.uGateFar.value = TUNNEL_Z_NEAR - this.rings.count * RING_SPACING;

        // Distinct gameplay spectacle instruments (zero fill when dormant).
        this.twistHelix = this.add(createTwistHelix({
            segments: t.ringSegments >= 96 ? 88 : 56, shared,
        }));
        if (t.warpRails > 0) {
            this.warpRails = this.add(createWarpTunnelRibbons({
                rails: t.warpRails, segments: t.roadSegments >= 100 ? 64 : 40, shared,
            }));
        }
        this.cosmicPortals = this.add(createCosmicPortals({ shared }));

        if (t.streaks > 0) {
            const lane = (i) => new THREE.Color(LANE_COLORS_HEX[i]);
            this.streaks = this.add(createSpeedStreaks({
                count: t.streaks,
                random,
                shared,
                warmColors: [lane(0), lane(1), lane(2)],
                coolColors: [lane(4), lane(5), lane(6)],
            }));
        }
        if (t.motes > 0) this.motes = this.add(createMotes({ count: t.motes, random, shared }));
        this.meteors = this.add(createMeteors({ pool: t.meteors, shared }));

        this.scene.add(this.group);
        this.applyComposition(true);
        return this;
    }

    buildPlanets() {
        const { tier: t } = this;
        const res = this.composition.result;
        // Deterministic baked iridescent gas giant with turbulent jet shear, Great Chromatic Vortex & cloud relief!
        const heroMap = this.registerTexture(createRainbowGiantTexture(512, 256));
        this.hero = createPlanetImpostor({
            name: 'chromadelic-hero-planet',
            map: heroMap,
            radius: res.hero.radius,
            quad: 1.32,
            albedo: 0.78,
            rimPeak: t.rim ? 1.25 : 0,
            envRimColor: PLANET_PALETTE.heroEnvRim,
            haloGain: t.rim ? 0.14 : 0,
            axialTilt: THREE.MathUtils.degToRad(22),
            axialRoll: THREE.MathUtils.degToRad(-10),
            spinSpeed: 0.012,
            night: 0.24,
            equalize: true,
            features: {
                fill: t.fill,
                detail: t.heroDetail,
                relief: t.planetRelief,
                aurora: t.planetAurora,
                polarHood: t.heroDetail,
                zonal: t.heroDetail,
                lightning: t.rim,
                moonShadow: t.heroDetail && t.moon,
            },
            renderOrder: -65,
        });
        this.add(this.hero);
        this.planets.push(this.hero);

        if (t.moon) {
            const moonMap = this.loadTexture('2k_moon.jpg');
            this.moon = createPlanetImpostor({
                name: 'chromadelic-moon',
                map: moonMap,
                radius: res.moon.radius,
                quad: 1.22,
                albedo: 0.96,
                rimPeak: 0.65,
                envRimColor: PLANET_PALETTE.heroEnvRim,
                envRim: 0.38,
                grade: {
                    low: new THREE.Color('#342a56'), mid: new THREE.Color('#9888c8'), high: new THREE.Color('#ebe4ff'), amount: 1,
                },
                axialTilt: 0.2,
                spinSpeed: 0.02,
                features: { eclipse: t.heroDetail, relief: t.planetRelief },
                renderOrder: -70,
            });
            this.add(this.moon);
            this.planets.push(this.moon);
        }

        if (t.secondary) {
            const iceMap = this.loadTexture('2k_neptune.jpg');
            const ringMap = this.registerTexture(createIceRingTexture(512));
            this.secondary = createPlanetImpostor({
                name: 'chromadelic-ice-giant',
                map: iceMap,
                radius: res.secondary.radius,
                quad: 2.3,
                albedo: 0.62,
                rimPeak: 0.92,
                envRimColor: PLANET_PALETTE.secondaryEnvRim,
                veil: 0.06,
                haloGain: 0.12,
                grade: {
                    low: new THREE.Color(0.03, 0.08, 0.22),
                    mid: new THREE.Color(0.14, 0.62, 0.88),
                    high: new THREE.Color(0.82, 0.98, 1.0),
                    amount: 0.85,
                    gain: 2.25,
                },
                axialTilt: THREE.MathUtils.degToRad(43),
                axialRoll: THREE.MathUtils.degToRad(-15),
                spinSpeed: (Math.PI * 2) / 420,
                features: {
                    fill: t.fill, ringShadows: t.fill, transmission: t.fill, detail: t.heroDetail,
                },
                ring: {
                    map: ringMap,
                    inner: 1.32,
                    outer: 2.25,
                    tilt: THREE.MathUtils.degToRad(43),
                    roll: THREE.MathUtils.degToRad(-15),
                },
                renderOrder: -75,
            });
            this.add(this.secondary);
            this.planets.push(this.secondary);
        }

        if (t.witness) {
            const emberMap = this.loadTexture('2k_mars.jpg');
            this.witness = createPlanetImpostor({
                name: 'chromadelic-witness',
                map: emberMap,
                radius: 40,
                quad: 1.25,
                albedo: 0.36,
                rimPeak: 0.72,
                envRimColor: PLANET_PALETTE.heroEnvRim,
                veil: 0.1,
                grade: {
                    low: new THREE.Color(0.08, 0.01, 0.06), mid: new THREE.Color(0.9, 0.24, 0.36), high: new THREE.Color(1.0, 0.82, 0.48), amount: 0.7,
                },
                axialTilt: 0.1,
                spinSpeed: 0.03,
                renderOrder: -80,
            });
            this.add(this.witness);
            this.planets.push(this.witness);
        }
    }

    // ── Composition & Board Calm-Zone Control ────────────────────────────────

    /** Smoothly engage (1) or release (0) the board-card calm zone (no ghost box without a board). */
    setBoardActive(amount) {
        this.boardActive = THREE.MathUtils.clamp(Number(amount) || 0, 0, 1);
        this.shared.uBoardActive.value = this.boardActive;
    }

    setLayout(aspect, layout = this.composition.layout, viewportCss = null) {
        this.aspect = aspect;
        this.composition.solve({
            aspect, level: this.level, layout, viewport: viewportCss,
        });
        this.applyComposition(false);
        return this.composition.result;
    }

    applyComposition(snap) {
        const res = this.composition.result;
        if (!this.anchors) {
            this.anchors = {
                hero: res.hero.position.clone(),
                heroR: res.hero.radius,
                secondary: res.secondary.position.clone(),
                secondaryR: res.secondary.radius,
            };
        }
        if (snap) {
            this.anchors.hero.copy(res.hero.position);
            this.anchors.heroR = res.hero.radius;
            this.anchors.secondary.copy(res.secondary.position);
            this.anchors.secondaryR = res.secondary.radius;
        }
        this.sky?.setDirections(res.sky);
        if (this.stars) this.stars.uniforms.uBinaryDir.value.copy(res.binary.direction);
        if (this.secondary) {
            this.secondary.mesh.visible = res.secondary.visible && (!this.partsFilter || this.partsFilter.has('planets'));
        }
        this.shared.uDEmerge.value = res.dEmerge;
        this.writeLayoutUniforms();
    }

    writeLayoutUniforms() {
        const res = this.composition.result;
        const { width: W, height: H, dpr } = this.viewport;
        this.shared.uViewportPx.value.set(W, H);
        const c = res.rects.card;
        if (c) {
            this.shared.uCardRectPx.value.set(c.x0 * W, c.y0 * H, c.x1 * W, c.y1 * H);
            const bottomPx = c.y1 * H;
            const apronOn = H - bottomPx > 8 ? 1 : 0;
            this.shared.uApron.value.set(((c.x0 + c.x1) / 2) * W, ((c.x1 - c.x0) / 2) * W + 24 * dpr, bottomPx, apronOn);
        }
        this.shared.uCardRadiusPx.value = 20 * dpr;
        const { hud } = res.veil;
        if (hud) this.shared.uHudRectPx.value.set(hud.x0 * W, hud.y0 * H, hud.x1 * W, hud.y1 * H);
        else this.shared.uHudRectPx.value.set(-1e4, -1e4, -1e4, -1e4);
    }

    setViewport(heightPx, camera, widthPx = heightPx * (camera?.aspect || 16 / 9), cssHeight = heightPx) {
        const H = Math.max(1, heightPx);
        const W = Math.max(1, widthPx);
        const vp = this.viewport;
        vp.width = W;
        vp.height = H;
        vp.cssHeight = cssHeight;
        vp.dpr = H / Math.max(1, cssHeight);
        const projScaleY = camera.projectionMatrix.elements[5];
        this.shared.uViewportH.value = H;
        this.shared.uProjScaleY.value = projScaleY;
        this.shared.uPxScale.value = 0.5 * H * projScaleY;
        this.stars?.setProjection(H, projScaleY);
        this.writeLayoutUniforms();
    }

    setLevel(level, { step = true } = {}) {
        const next = Math.max(1, Math.floor(level || 1));
        if (next === this.level) return;
        const gained = this.levelsGained(next);
        this.level = next;
        if (step && gained > 0) this.stepSpectrum(gained);
        this.composition.solve({ aspect: this.aspect, level: this.level, layout: this.composition.layout });
        this.applyComposition(false);
    }

    levelsGained(next) {
        if (next === this.level) return 0;
        return next > this.level ? Math.min(next - this.level, 3) : Math.min(next - 1, 1);
    }

    // ── Spectrum & Cosmic Voyage Clocks ──────────────────────────────────────

    ringPlace(distance = this.spectrum.distance) {
        const sp = this.spectrum;
        return (sp.pinned ?? sp.levelTarget) + distance / STEP_TRAVEL;
    }

    skyPlace() {
        const sp = this.spectrum;
        return (sp.pinned ?? sp.levelPlace) + sp.distance / STEP_TRAVEL;
    }

    stepSpectrum(steps) {
        this.spectrum.levelTarget += steps;
        this.voyage.offsetTarget += steps * 0.35;
        this.unlockHiddenRings();
    }

    resetProgress(level = 1, place = SPECTRUM_HOME) {
        this.level = Math.max(1, Math.floor(level));
        this.spectrum.levelTarget = place;
        this.spectrum.levelPlace = place;
        this.voyage.offsetTarget = 0;
        this.voyage.offset = 0;
        this.composition.solve({ aspect: this.aspect, level: this.level, layout: this.composition.layout });
        this.applyComposition(true);
    }

    pinSpectrum(place, { form = null } = {}) {
        this.spectrum.pinned = Number.isFinite(place) ? place : null;
        this.spectrum.form = form;
        this.ringSlots.fill(null);
        this.updateRingStyles();
    }

    /** Debug/captures: pin one of the five cosmic sectors by index (0..4) or name, or null to unpin. */
    pinSector(sectorOrNull) {
        if (sectorOrNull === null || sectorOrNull === undefined || sectorOrNull === '') {
            this.voyage.pinned = null;
            return;
        }
        if (typeof sectorOrNull === 'number' && Number.isFinite(sectorOrNull)) {
            this.voyage.pinned = ((Math.floor(sectorOrNull) % SECTORS.length) + SECTORS.length) % SECTORS.length;
            return;
        }
        const idx = sectorIndexByName(String(sectorOrNull));
        this.voyage.pinned = idx >= 0 ? idx : null;
    }

    ringLockDepth() {
        return this.shared.uDEmerge.value + 420 + RING_SPACING;
    }

    ringLockDistance(serial) {
        return serial * RING_SPACING + (CAMERA_Z - TUNNEL_Z_NEAR) - this.ringLockDepth();
    }

    unlockHiddenRings() {
        const shownDepth = this.shared.uDEmerge.value + 420;
        const d = this.spectrum.distance;
        for (let s = 0; s < RING_SLOTS; s++) {
            const serial = this.ringSlots[s];
            if (serial === null) continue;
            const depth = CAMERA_Z - (TUNNEL_Z_NEAR + d - serial * RING_SPACING);
            if (depth > shownDepth) this.ringSlots[s] = null;
        }
        this.updateRingStyles();
    }

    updateRingStyles() {
        const n = this.ringCount;
        const d = this.spectrum.distance;
        const lockDepth = this.ringLockDepth();
        const shownDepth = this.shared.uDEmerge.value + 420;
        const first = Math.floor(d / RING_SPACING) + 1;
        const rp = this.repaint;
        let frontDepth = -Infinity;
        if (rp) {
            frontDepth = rp.D0 - rp.speed * Math.max(0, this.time - rp.birth);
            if (frontDepth < 100) this.repaint = null;
        }
        let lead = null;
        for (let serial = first; serial < first + n; serial++) {
            const depth = CAMERA_Z - (TUNNEL_Z_NEAR + d - serial * RING_SPACING);
            if (depth > lockDepth) continue;
            if (depth <= shownDepth && (lead === null || serial > lead)) lead = serial;
            const slot = ((serial % RING_SLOTS) + RING_SLOTS) % RING_SLOTS;
            const repaint = rp && this.ringRepaint[slot] !== rp.id && depth >= frontDepth;
            if (this.ringSlots[slot] === serial && !repaint) continue;
            this.lockRing(serial, slot, d);
            this.ringRepaint[slot] = rp ? rp.id : 0;
        }
        this.leadSerial = lead;
    }

    lockRing(serial, slot, d) {
        const { uRingPalette, uRingGlow, uRingForm } = this.shared;
        const place = this.ringPlace(Math.min(d, Math.max(0, this.ringLockDistance(serial))));
        let echo = this.prismEcho > 0;
        if (echo) this.prismEcho -= 1;
        let { form } = this.spectrum;
        const crown = this.crownRings > 0;
        if (crown) this.crownRings -= 1;
        if (crown || (this.feverPrism && serial % 2 === 0)) {
            form = form || 'prism';
            echo = true;
        }
        const override = form || echo ? { form, prism: echo } : null;
        const st = ringStyle(serial, place, this.ringStyles[slot], override);
        uRingPalette.array[slot].setRGB(st.core.r, st.core.g, st.core.b);
        uRingGlow.array[slot].set(st.glow.r, st.glow.g, st.glow.b, st.prism ? 1 + st.prismHue : 0);
        uRingForm.array[slot].set(st.shape, st.pattern, st.count, st.spin);
        this.ringSlots[slot] = serial;
    }

    leadStyle() {
        if (this.leadSerial === null) return null;
        const slot = this.leadSerial % RING_SLOTS;
        return this.ringSlots[slot] === this.leadSerial ? this.ringStyles[slot] : null;
    }

    updateAir(delta) {
        const d = this.spectrum.distance;
        const shownDepth = this.shared.uDEmerge.value + 420;
        let x = 0;
        let y = 0;
        let wSum = 0;
        for (let s = 0; s < RING_SLOTS; s++) {
            const serial = this.ringSlots[s];
            if (serial === null) continue;
            const depth = CAMERA_Z - (TUNNEL_Z_NEAR + d - serial * RING_SPACING);
            if (depth > shownDepth || depth < 150) continue;
            const emerge = THREE.MathUtils.smoothstep(shownDepth - depth, 0, 260);
            let w = emerge * THREE.MathUtils.smoothstep(depth, 150, 400);
            const st = this.ringStyles[s];
            const hue = st.prism ? st.prismHue + 0.42 : hueOf(st.glow);
            if (st.prism) w *= 0.4;
            x += Math.cos(hue * Math.PI * 2) * w;
            y += Math.sin(hue * Math.PI * 2) * w;
            wSum += w;
        }
        const tx = wSum > 1e-4 ? x / wSum : 0;
        const ty = wSum > 1e-4 ? y / wSum : 0;
        const vec = this.airVec || (this.airVec = { x: 0, y: 0 });
        if (!this.airSeeded || delta <= 0) {
            vec.x = tx;
            vec.y = ty;
            this.airSeeded = true;
        } else {
            const k = 1 - Math.exp(-delta / 2.5);
            vec.x += (tx - vec.x) * k;
            vec.y += (ty - vec.y) * k;
        }
        const skyHue = (AIR_SKY_HUE + skyTurnAt(this.skyPlace())) * Math.PI * 2;
        const hue = Math.atan2(vec.y + AIR_SKY_PRIOR * Math.sin(skyHue), vec.x + AIR_SKY_PRIOR * Math.cos(skyHue))
            / (Math.PI * 2);
        neonColor(hue, 0.42, _rgb2);
        this.air.setRGB(_rgb2.r, _rgb2.g, _rgb2.b);
        this.sky?.setAir(this.air);

        // Seamless horizon haze matching the sky dome's exact vanishing-point colour (no cardboard road cut-off).
        const haze = this.shared.uHaze.value;
        const sec = this.voyage.state;
        rotateHue(HAZE_BASE, skyTurnAt(this.skyPlace()), haze);
        haze.r = Math.max(0.002, haze.r + sec.skyShift[0] + this.air.r * 0.062 + sec.coreWarmth * 0.045);
        haze.g = Math.max(0.001, haze.g + sec.skyShift[1] + this.air.g * 0.062 + sec.coreWarmth * 0.015);
        haze.b = Math.max(0.004, haze.b + sec.skyShift[2] + this.air.b * 0.062 + sec.coreWarmth * 0.055);
    }

    getSpectrumDiagnostics() {
        const d = this.spectrum.distance;
        const shownDepth = this.shared.uDEmerge.value + 420;
        const rings = [];
        for (let s = 0; s < RING_SLOTS; s++) {
            const serial = this.ringSlots[s];
            if (serial === null) continue;
            const depth = CAMERA_Z - (TUNNEL_Z_NEAR + d - serial * RING_SPACING);
            if (depth > shownDepth || depth < 150) continue;
            const st = this.ringStyles[s];
            rings.push({
                serial,
                depth: Math.round(depth),
                movement: MOVEMENTS[st.movement]?.name,
                hue: Math.round(st.hue * 360),
                form: st.form,
                prism: st.prism,
            });
        }
        rings.sort((a, b) => a.depth - b.depth);
        return {
            level: this.level,
            ring: spectrumSummary(this.ringPlace()),
            sky: spectrumSummary(this.skyPlace()),
            sector: this.voyage.state.name,
            distance: Math.round(d),
            rings,
            air: `#${this.air.getHexString()}`,
        };
    }

    getSpectrumState() {
        return { level: this.level, place: this.ringPlace(), voyageOffset: this.voyage.offsetTarget };
    }

    restoreSpectrumState(state) {
        if (!state || !Number.isFinite(state.place)) return;
        this.level = Math.max(1, Math.floor(state.level || 1));
        this.spectrum.levelTarget = state.place - this.spectrum.distance / STEP_TRAVEL;
        this.spectrum.levelPlace = this.spectrum.levelTarget;
        if (Number.isFinite(state.voyageOffset)) {
            this.voyage.offsetTarget = state.voyageOffset;
            this.voyage.offset = state.voyageOffset;
        }
        this.ringSlots.fill(null);
        this.updateRingStyles();
        this.composition.solve({ aspect: this.aspect, level: this.level, layout: this.composition.layout });
        this.applyComposition(true);
    }

    showOnlyParts(names) {
        const keep = new Set(names);
        this.partsFilter = keep;
        const byPart = {
            sky: [this.sky],
            stars: [this.stars],
            planets: this.planets,
            road: [this.road],
            rails: [this.rails],
            pylons: [this.pylons, this.chevrons],
            rings: [this.rings],
            air: [this.ringAir],
            events: [this.twistHelix, this.warpRails, this.cosmicPortals],
            streaks: [this.streaks],
            motes: [this.motes],
            meteors: [this.meteors],
        };
        Object.entries(byPart).forEach(([key, list]) => {
            list.forEach((part) => { if (part) part.mesh.visible = keep.has(key); });
        });
    }

    setEffectScale(scale) {
        this.stars?.setDensity(0.6 + 0.4 * scale);
        this.streaks?.setDensityScale(scale);
        this.motes?.setDensityScale(scale);
    }

    sampleRoadCurve(z, out = { x: 0, y: 0 }) {
        const t = Math.max(0, (200 - z) / 2700);
        const s = t * t;
        const ts = this.time * 0.075;
        out.x = (Math.sin(t * 2.5 + ts) * 260 + Math.sin(t * 1.2 + ts * 0.5) * 160
            + Math.cos(t * 1.8 + ts * 0.75) * 100) * s;
        out.y = Math.sin(t * 1.5 + ts * 0.33) * 30 * s;
        return out;
    }

    seek(t) {
        this.time = t;
        this.speed = TRAVEL_SPEED * worldSpeedFactor(1);
        this.travel = (t * this.speed) % TRAVEL_WRAP;
        this.moteTravel = (t * this.speed) % (TUNNEL_SPAN * 30);
        this.spectrum.distance = t * this.speed;
        this.spectrum.levelPlace = this.spectrum.levelTarget;
        this.voyage.offset = this.voyage.offsetTarget;
        this.ringPhase = (t * RING_PHASE_RATE) % RING_PHASE_WRAP;
        this.prismEcho = 0;
        this.feverPrism = false;
        this.crownRings = 0;
        this.ringSlots.fill(null);
        this.ringRepaint.fill(0);
        this.repaint = null;
        this.shared.uChase.value.set(-1e4, 0.6, 0, 0);
        this.shared.uChase2.value.set(-1e4, 0.6, 0, 0);
        this.shared.uCascadePrism.value = 0;
        this.shared.uCascadePrism2.value = 0;
        this.shared.uTwistHelix.value.set(-1e4, 1.35, 1, 0);
        this.shared.uWarpRails.value.set(0, 0, 0, 0);
        this.shared.uLanePulse.value.set(3, 0, -500, 0);
        this.shared.uSlamWave.value.set(-5000, 0, 0, 0);
        this.shared.uTwistGlass.value.set(10, 0, 1, 0);
        this.shared.uGoldGild.value = 0;
        this.shared.uFeverGlow.value = 0;
        this.lanePulse.birth = -1e4;
        this.lanePulse.amp = 0;
        this.slamWave.birth = -1e4;
        this.slamWave.amp = 0;
        this.twistGlass.birth = -1e4;
        this.twistGlass.amp = 0;
        this.portals.forEach((p, idx) => {
            p.birth = -1e4;
            p.amp = 0;
            this.shared.uPortalA.array[idx].set(0.2, 0.02, 0, idx);
        });
        this.chases.forEach((c) => {
            c.birth = -1e4;
            c.fronts = 0;
            c.amp = 0;
        });
        this.planets.forEach((p) => p.setSpinForTime(t));
        this.planetFx.reset();
        this.ringFlow = 0;
        this.meteors?.clear();
        this.meteorTimer = 7;
        this.waveSlots.fill(null);
        this.pendingEvents.length = 0;
        this.waveCursor = 0;
        this.lastLockAt = -1e4;
        this.twistSign = 1;
        this.laneSeq = 0;
        this.lastSlamAt = -1e4;
        this.cometAt = -1e4;
        this.gameOverAt = -1e4;
        this.chainCometDone = false;
        this.trueCometDone = false;
        this.cascades.forEach((c) => {
            c.birth = -1e4;
            c.amp = 0;
        });
        Object.keys(this.fx).forEach((k) => { this.fx[k] = 0; });
        this.dipEvent = 0;
        Object.values(this.env).forEach((s) => s.reset());
        this.surge.reset();
        Object.keys(this.heat).forEach((k) => { this.heat[k] = 0; });
        this.staged.any = false;
        this.lockBand = null;
        this.hardDropPending = false;
        this.b2bRun = 0;
        this.chain = 0;
        this.cam.lookX.x = 0;
        this.cam.lookX.v = 0;
        this.cam.bank.x = 0;
        this.cam.bank.v = 0;
        this.cam.paceFov = 0;
        this.applyComposition(true);
        this.updateRingStyles();
        const phase = this.voyage.pinned !== null
            ? this.voyage.pinned + 0.1
            : sectorPhase(t, this.voyage.offset);
        sectorAt(phase, this.voyage.state);
        this.airSeeded = false;
        this.updateAir(0);
        this.stars?.triggerWave(-100, this.composition.result.sky.vpDir, 0);
    }

    // ── Event Choreography: One Unmistakable Instrument Per Event ────────────

    launchWave(preset, overrides = {}, delay = 0) {
        const p = { ...WAVE_PRESETS[preset], ...overrides };
        this.schedule(delay, () => this.writeWave(p, this.time));
    }

    schedule(delay, fn) {
        if (delay <= 0) fn();
        else this.pendingEvents.push({ at: this.time + delay, fn });
    }

    /** Each scoring gesture has its own slot so simultaneous events can finish independently. */
    launchPortal(slot, {
        duration = 1.2, startR = 0.14, endR = 1.15, width = 0.025, amp = 1.0, rgb = GOLD,
    } = {}) {
        const p = this.portals[slot];
        if (!p) return;
        p.birth = this.time;
        p.duration = duration;
        p.startR = startR;
        p.endR = endR;
        p.width = width;
        p.amp = amp;
        p.rgb = { r: rgb.r, g: rgb.g, b: rgb.b };
    }

    bandEnergy(w, t = this.time) {
        const age = t - w.birth;
        if (age < 0.04) return w.amp;
        if (age > w.tau * 8) return 0;
        return w.amp * Math.exp(-age / w.tau);
    }

    writeWave(p, birth) {
        const slots = this.waveSlots;
        let free = -1;
        let weakest = -1;
        let weakestE = Infinity;
        let youngest = -1;
        for (let i = 0; i < slots.length; i++) {
            const w = slots[i];
            const e = w ? this.bandEnergy(w, birth) : 0;
            if (!w || e < BAND_SPENT) {
                if (free < 0) free = i;
                continue;
            }
            if (e < weakestE) {
                weakestE = e;
                weakest = i;
            }
            if (youngest < 0 || w.birth > slots[youngest].birth) youngest = i;
        }
        let i = free;
        if (i < 0 && weakestE < BAND_KEEP * p.amp) i = weakest;
        if (i < 0) return this.foldBand(slots[youngest], p, birth);
        slots[i] = { ...p, z0: this.composition.result.zEntry - 40, birth };
        return slots[i];
    }

    foldBand(w, p, t) {
        const e = this.bandEnergy(w, t);
        const env = w.amp > 0 ? e / w.amp : 1;
        w.amp += p.amp / Math.max(env, 0.3);
        if (p.amp > e) {
            w.rgb = p.rgb;
            w.hue = p.hue;
            w.white = p.white;
        } else if (p.rgb && w.rgb) {
            w.rgb = w.rgb.clone().lerp(p.rgb, p.amp / (e + p.amp));
        }
        w.width = Math.max(w.width, p.width);
        return w;
    }

    cascadeSlot() {
        let best = 0;
        let bestE = Infinity;
        for (let i = 0; i < this.cascades.length; i++) {
            const c = this.cascades[i];
            const age = this.time - c.birth;
            const front = c.D0 - c.speed * Math.max(0, age);
            const e = front < 100 || age > 3 ? 0 : c.amp * Math.exp(-age / 0.8);
            if (e < bestE) {
                bestE = e;
                best = i;
            }
        }
        return best;
    }

    launchCascade({
        amp = 1.0, speed = 2400, color = null, hueMix = 0, prism = false,
    } = {}) {
        const i = this.cascadeSlot();
        const slot = this.cascades[i];
        const a = amp * (prefersReducedFlashing() ? 0.6 : 1);
        slot.birth = this.time;
        slot.amp = a;
        slot.D0 = this.composition.result.dEmerge;
        slot.speed = speed;
        const { shared } = this;
        (i === 0 ? shared.uCascade : shared.uCascade2).value.set(this.time, slot.D0, speed, a);
        const col = (i === 0 ? shared.uCascadeCol : shared.uCascadeCol2).value;
        if (color) col.set(color.r, color.g, color.b, hueMix);
        else col.set(1, 1, 1, 0);
        (i === 0 ? shared.uCascadePrism : shared.uCascadePrism2).value = prism ? 1 : 0;
        return i;
    }

    launchChase({ fronts = 1, duration = 0.6, amp = 1.0 } = {}) {
        const a = amp * (prefersReducedFlashing() ? 0.6 : 1);
        const { chases } = this;
        let climbing = -1;
        let free = -1;
        let oldest = 0;
        for (let i = 0; i < chases.length; i++) {
            const c = chases[i];
            const s = (this.time - c.birth) / c.duration;
            const last = (this.time - c.birth - (c.fronts - 1) * 0.12) / c.duration;
            const newer = climbing < 0 || c.birth > chases[climbing].birth;
            if (c.fronts > 0 && s >= 0 && s < CHASE_FOLD_S && newer) climbing = i;
            if ((c.fronts === 0 || last > 1.6) && free < 0) free = i;
            if (c.birth < chases[oldest].birth) oldest = i;
        }
        let i = climbing;
        if (i >= 0) {
            const c = chases[i];
            if (this.time - c.birth < 0.06) {
                c.fronts = Math.max(c.fronts, Math.max(1, Math.min(3, fronts)));
                c.duration = Math.max(c.duration, duration);
                c.amp = Math.min(Math.max(c.amp, a) + 0.3 * Math.min(c.amp, a), 1.6);
            } else {
                c.amp = Math.min(c.amp + a * 0.6, 1.6);
            }
        } else {
            i = free >= 0 ? free : oldest;
            const c = chases[i];
            c.birth = this.time;
            c.duration = duration;
            c.fronts = Math.max(1, Math.min(3, fronts));
            c.amp = Math.min(a, 1.6);
        }
        const c = chases[i];
        (i === 0 ? this.shared.uChase : this.shared.uChase2).value.set(c.birth, c.duration, c.fronts, c.amp);
    }

    leadColor(out, { shift = 0, target = 0.5 } = {}) {
        const st = this.leadStyle();
        let hue = 0.83;
        if (st) hue = st.prism ? st.prismHue + 0.42 : st.hue;
        const c = neonColor(hue + shift, target, _rgb2);
        return out.setRGB(c.r, c.g, c.b);
    }

    starWave(boost, color = null) {
        this.stars?.triggerWave(this.time, this.composition.result.sky.vpDir, boost, color);
    }

    planetFront(opts, delay = 0) {
        this.schedule(delay, () => this.planetFx.front(opts, this.time));
    }

    lightning(count, { amp = 0.9, delay = 0.14, gap = 0.12 } = {}) {
        for (let i = 0; i < count; i++) this.schedule(delay + gap * i, () => this.planetFx.strike(this.time, { amp }));
    }

    stage(at) {
        const s = this.staged;
        if (!s.any) {
            s.any = true;
            s.at = at;
            s.lines = 0;
            s.cascade = 1;
            s.combo = 1;
            s.twist = false;
            s.b2b = false;
            s.perfect = false;
        }
        return s;
    }

    flushStaged() {
        const s = this.staged;
        if (!s.any) return;
        s.any = false;
        if (s.lines > 0) {
            this.surge.clear(s, s.at);
            if (s.lines < 4 && !s.twist && !s.b2b) this.b2bRun = 0;
            return;
        }
        const W = SURGE_WEIGHTS;
        const worth = (w) => (s.perfect ? w.perfect : 0) + (s.twist ? w.twist * 0.5 : 0) + (s.b2b ? w.b2b : 0);
        const punch = worth(W.punch);
        const heat = worth(W.heat);
        this.surge.punch.hit(punch, s.at);
        this.surge.level.hit(heat, s.at);
    }

    /** Any active play wakes the highway immediately from a game-over coast-down. */
    rekindle() {
        if (this.gameOverAt > -1e3) this.gameOverAt = -1e4;
    }

    onSessionStart() {
        this.rekindle();
        this.launchWave('lock', {
            amp: 0.42, rgb: this.leadColor(new THREE.Color()), white: 0.45, width: 32,
        });
    }

    /** Game Over: graceful hyperspace coast-down that holds ~6.5 s then breathes back by itself (#1722). */
    onGameOver() {
        this.gameOverAt = this.time;
        this.surge.reset();
        this.chain = 0;
        this.b2bRun = 0;
        this.prismEcho = 0;
        this.crownRings = 0;
    }

    onHardDrop() {
        this.rekindle();
        this.hardDropPending = true;
    }

    /**
     * Piece Lock & Hard Drop:
     *   - Plain lock: crisp single-lane stained-glass ignition ripple + subtle rail/chevron tick.
     *   - Hard drop: unmistakable V-chevron shock slam snapping down the highway glass + sharp
     *     curb & pylon flash (gracefully rate-limited so rapid slamming never strobes!).
     */
    onPieceLock(data = null) {
        this.rekindle();
        const hard = this.hardDropPending;
        this.hardDropPending = false;
        const { level } = this.heat;
        this.env.railTick.hit(hard ? 1.5 : 1.0, this.time);
        this.env.roadPulse.hit((hard ? 0.34 : 0.2) * (1 + level), this.time);
        this.surge.lock({ hardDrop: hard }, this.time);

        // Pick the exact matching tetromino lane if known, else walk rhythmically across the 7 lanes.
        const typeKey = data?.piece?.type || data?.pieceType || data?.type;
        const lane = typeof typeKey === 'string' && PIECE_TO_LANE[typeKey] !== undefined
            ? PIECE_TO_LANE[typeKey]
            : (this.laneSeq++ % 7);
        this.lanePulse.lane = lane;
        this.lanePulse.birth = this.time;
        this.lanePulse.amp = hard ? 1.45 : 1.05;
        // Start in the open foreground glass directly beneath the board so every lock glows visibly!
        this.lanePulse.z0 = 155;
        this.lanePulse.hard = hard ? 1 : 0;

        // Hard drop compression V-chevron slam bursting out beneath the board across all 7 rainbow lanes!
        if (hard && this.time - this.lastSlamAt >= SLAM_GAP) {
            this.lastSlamAt = this.time;
            this.slamWave.birth = this.time;
            this.slamWave.amp = 1.25 * (0.55 + 0.45 * flashScale());
            this.slamWave.z0 = 135;
        }

        const base = WAVE_PRESETS.lock;
        const p = {
            ...base,
            amp: base.amp * (1 + 1.6 * level) * (hard ? 1.65 : 1),
            rgb: this.leadColor(new THREE.Color()),
            white: hard ? 0.58 : base.white,
            v0: hard ? 720 : base.v0,
            accel: hard ? 1350 : base.accel,
        };
        const live = this.lockBand && this.waveSlots.includes(this.lockBand) ? this.lockBand : null;
        if (live && this.time - this.lastLockAt < LOCK_BAND_GAP) {
            this.foldBand(live, p, this.time);
        } else {
            this.lastLockAt = this.time;
            this.lockBand = this.writeWave(p, this.time);
        }
        if (this.heat.stage >= 2) this.launchChase({ fronts: 1, duration: 0.5, amp: 0.25 + 0.35 * level });
    }

    /**
     * Cascade depth: climbing hue bands and chevrons in both wings, with meteors every
     * third wave and a grazing comet at depth five.
     */
    onCombo(combo) {
        this.rekindle();
        const c = Math.max(1, combo);
        const deep = Math.min(c - 1, 8);
        const rgb = this.leadColor(new THREE.Color(), { shift: 0.07 * deep });
        const quick = 1 + 0.08 * deep;
        const band = {
            amp: Math.min(0.32 + 0.08 * c, 0.92),
            rgb,
            width: 20 + 3 * deep,
            white: 0.22 + 0.04 * deep,
            v0: 660 * quick,
            accel: 1450 * quick,
        };
        this.launchWave('combo', band);
        // Keep falling waves from this piece distinct from consecutive scoring locks.
        if (c >= 2) {
            this.launchPortal(PORTAL_KIND.cascade, {
                duration: 0.85,
                startR: 0.16,
                endR: 0.72 + Math.min(deep * 0.06, 0.36),
                width: 0.013,
                amp: Math.min(0.5 + 0.1 * c, 1.15),
                rgb,
            });
            this.env.aurora.hit(Math.min(0.2 + 0.08 * c, 0.75), this.time);
        }
        if (c >= 4) {
            this.launchWave('combo', band, 0.09);
            this.launchCascade({
                amp: Math.min(0.28 + 0.08 * c, 0.88), speed: 2200 + 120 * deep, color: rgb, hueMix: 0.8,
            });
        }
        if (c >= 3) this.planetFront({ rgb, amp: Math.min(0.35 + 0.1 * c, 1.05), width: 0.08 + 0.01 * deep });
        this.fx.combo = Math.max(this.fx.combo, Math.min(1, (c - 1) / 5));
        if (c >= 3 && c % 3 === 0) {
            const count = 2 + (this.random() > 0.5 ? 1 : 0);
            for (let i = 0; i < count; i++) this.schedule(0.12 * i, () => this.spawnMeteor());
        }
        if (c >= 5 && !this.chainCometDone && this.time - this.cometAt > 20) {
            this.chainCometDone = true;
            this.cometAt = this.time;
            this.spawnComet();
        }
        if (c < 5) this.chainCometDone = false;
    }

    /** True consecutive-clear chain (ComboTracker). */
    onChain(combo) {
        const c = Math.max(0, Math.floor(Number(combo) || 0));
        this.chain = c;
        if (c < 2) {
            if (c === 0) this.trueCometDone = false;
            return;
        }
        this.spectrum.levelTarget += CHAIN_STEP;
        if (c >= 4) this.prismEcho = Math.min(this.prismEcho + 1, this.ringCount + 4);
        this.unlockHiddenRings();
        this.fx.combo = Math.max(this.fx.combo, Math.min(1, (c - 1) / 6));
        const rgb = this.leadColor(new THREE.Color(), { shift: 0.05 * c });
        this.launchPortal(PORTAL_KIND.chain, {
            duration: 0.85,
            startR: 0.16,
            endR: 0.78 + Math.min(c * 0.05, 0.35),
            width: 0.018,
            amp: Math.min(0.45 + 0.08 * c, 1.05),
            rgb,
        });
        if (c >= 6 && c % 2 === 0) {
            const count = 2 + (c >= 10 ? 1 : 0);
            for (let i = 0; i < count; i++) this.schedule(0.1 + 0.12 * i, () => this.spawnMeteor());
        }
        if (c >= 5 && !this.trueCometDone && this.time - this.cometAt > 20) {
            this.trueCometDone = true;
            this.cometAt = this.time;
            this.spawnComet();
        }
    }

    /**
     * Line Clears (1, 2, 3, and Quad = 4): clearly distinct, escalating spectacle!
     */
    onLineClear(lines, { cascade = 1, combo = 1, chainStep = false } = {}) {
        this.rekindle();
        const n = Math.max(1, Math.min(4, lines));
        const wave = Math.max(1, Math.floor(Number(cascade) || 1));
        const s = this.stage(this.time);
        s.lines = Math.max(s.lines, n);
        s.cascade = Math.max(s.cascade, wave);
        s.combo = Math.max(s.combo, Math.max(1, Math.floor(Number(combo) || 1)));
        if (chainStep) this.onChain(combo);
        const { level } = this.heat;

        if (n >= 4) {
            // QUAD: Hyper-Warp Prism Tunnel Ignition!
            for (let i = 0; i < 4; i++) this.launchWave('quad', { white: 0.1 + i * 0.13 }, i * 0.05);
            this.schedule(0.12, () => {
                this.launchCascade({ amp: 1.08, speed: 2400, prism: true });
                this.env.quadRail.hit(1.15, this.time);
            });
            this.schedule(0.24, () => {
                this.env.warp.hit(1.15, this.time);
                this.env.warpRush.hit(0.95, this.time);
            });
            this.prismEcho = Math.min(this.prismEcho + 3, this.ringCount + 4);
            this.unlockHiddenRings();
            this.planetFront({
                rgb: PRISM_AFTERGLOW, prism: 1, amp: 2.1 + 0.4 * level, width: 0.14, tau: 0.95,
            }, 0.15);
            this.schedule(0.42, () => this.env.ringPrism.hit(1.05, this.time));
            this.lightning(3, { amp: 1.15, delay: 0.28, gap: 0.14 });
            this.env.storm.hit(0.65, this.time);
            this.env.aurora.hit(1.05, this.time);
            this.env.lens.hit(1.1, this.time);
            this.dipEvent = Math.max(this.dipEvent, 0.12 * (1 - 0.6 * level));
            this.starWave(0.8 + 0.3 * level, CYAN_COLOR);
            return;
        }

        // 1, 2, and 3 lines each step up in visual richness and form:
        const rgb = this.leadColor(new THREE.Color(), { shift: n === 3 ? 0.5 : 0.04 * n, target: 0.55 });
        const amp = Math.min(0.42 + 0.12 * n + 0.2 * level, 0.96);
        for (let i = 0; i < n; i++) this.launchWave('clear', { amp, rgb }, i * 0.08);
        const quick = 1 - 0.25 * level;
        this.launchChase({
            fronts: n + (wave >= 3 ? 1 : 0),
            duration: (0.55 + 0.05 * n) * quick,
            amp: 0.85 + 0.12 * n + 0.3 * level + 0.06 * (wave - 1),
        });
        this.starWave(0.32 + 0.12 * n + 0.3 * level, rgb);
        this.planetFront({ rgb, amp: Math.min(0.95 + 0.22 * n + 0.4 * level, 1.85), width: 0.08 + 0.012 * n });
        this.lightning(n, { amp: 0.78 + 0.1 * n + 0.2 * level });
        this.env.storm.hit(Math.min(0.35 + 0.15 * n, 0.8), this.time);

        if (n === 2) {
            // 2-Line signature: dual synchronized meteors grazing both outer sky corridors + soft aurora pulse!
            this.spawnMeteor({ side: -1, color: rgb });
            this.schedule(0.08, () => this.spawnMeteor({ side: 1, color: rgb }));
            this.env.aurora.hit(0.35, this.time);
        } else if (n === 3) {
            // 3-Line signature: outer flank hyper-warp rails + strong aurora surge + complementary flash!
            this.env.tripleRail.hit(1.0, this.time);
            this.env.aurora.hit(0.75, this.time);
            this.env.nebula.hit(0.55, this.time);
            this.spawnMeteor({ side: -1, color: rgb });
            this.schedule(0.07, () => this.spawnMeteor({ side: 1, color: rgb }));
        }
    }

    /**
     * TWIST: Unmistakable counter-rotating 3D Chromatic Double-Helix Corkscrew Vortex spiraling
     * down the tunnel around the board card, diagonal glass shear-wave, camera bank, and T-lemon
     * road/planet pulse!
     */
    onTwist(lines = 0) {
        this.rekindle();
        const n = Math.max(0, Math.min(3, Math.floor(Number(lines) || 0)));
        this.stage(this.time).twist = true;
        const sign = this.twistSign;
        this.twistSign = -this.twistSign;

        this.env.twist.hit(n > 0 ? 0.7 + 0.2 * n : 0.45, this.time);
        this.env.aurora.hit(n > 0 ? 0.55 + 0.15 * n : 0.3, this.time);
        const motion = this.motion ?? 1;
        this.cam.bank.v += sign * (n > 0 ? 0.055 + 0.014 * n : 0.035) * motion;

        // Launch the unmistakable 3D Chromatic Double-Helix Corkscrew!
        const helixAmp = (n > 0 ? 1.0 + 0.18 * n : 0.72) * (prefersReducedFlashing() ? 0.65 : 1.0);
        const helixDur = n > 0 ? 1.4 : 1.05;
        this.shared.uTwistHelix.value.set(this.time, helixDur, sign, helixAmp);

        // Diagonal shear wave across the stained-glass highway!
        this.twistGlass.birth = this.time;
        this.twistGlass.amp = n > 0 ? 0.95 : 0.6;
        this.twistGlass.sign = sign;

        this.launchWave('clear', {
            amp: n > 0 ? 0.34 + 0.1 * n : 0.2, rgb: T_COLOR, white: 0.35, width: 18,
        });
        this.planetFront({ rgb: T_COLOR, amp: n > 0 ? 0.9 + 0.15 * n : 0.55, width: 0.095 });
        if (n === 0) this.starWave(0.28, T_COLOR);
    }

    /**
     * BACK-TO-BACK: Sovereign Liquid-Gold Echo — gilded curbs/pylons/arches, molten-gold crown
     * warp-rails, expanding Liquid-Gold Double Corona (Portal slot 1), golden binary starburst,
     * and gold-gilded ice-giant rings!
     */
    onB2B() {
        this.rekindle();
        this.b2bRun = Math.min(this.b2bRun + 1, 5);
        this.stage(this.time).b2b = true;
        const amp = Math.min(0.75 + 0.12 * this.b2bRun, 1.25);

        this.env.goldGild.hit(Math.min(0.85 + 0.1 * this.b2bRun, 1.15), this.time);
        this.env.ringGold.hit(1.0, this.time);
        this.launchPortal(PORTAL_KIND.backToBack, {
            duration: 1.25,
            startR: 0.18,
            endR: 1.06,
            width: 0.014,
            amp: Math.min(0.9 + 0.1 * this.b2bRun, 1.3),
            rgb: GOLD,
        });
        this.schedule(0.42, () => this.launchCascade({
            amp, speed: 2600, color: GOLD, hueMix: 0.88,
        }));
        this.planetFront({ rgb: GOLD, amp: Math.min(1.25 + 0.15 * this.b2bRun, 1.95), width: 0.125 }, 0.42);
        this.lightning(2, { amp: 1.05, delay: 0.55, gap: 0.16 });
        this.launchChase({ fronts: 3, duration: 0.55, amp: 1.25 });
        this.prismEcho = Math.min(this.prismEcho + 2, this.ringCount + 4);
        this.unlockHiddenRings();
        this.env.flare.hit(1.0, this.time);
        this.env.lens.hit(0.55, this.time);
        this.starWave(0.55, GOLD);
    }

    /**
     * PERFECT CLEAR — THE GRAND MASTERPIECE FINALE!
     * Celestial Prism Fan behind the board, Celestial Crown Mandala (Portal slot 3), all 12
     * rainbow-gold warp rails, full-tunnel prism arches, twin symmetric golden-diamond comets,
     * blazing polar aurora & rainbow rings across both planets, and golden binary starburst!
     */
    onPerfectClear() {
        this.rekindle();
        this.stage(this.time).perfect = true;
        this.launchCascade({ amp: 1.25, speed: 2000, prism: true });
        this.crownRings = this.ringCount;
        this.unlockHiddenRings();
        this.launchWave('levelUp', { rgb: GOLD, amp: 0.88, white: 0.55 });
        this.launchChase({ fronts: 3, duration: 0.95, amp: 0.95 });

        this.env.perfectRail.hit(1.3, this.time);
        this.env.goldGild.hit(0.50, this.time);
        this.env.nova.hit(0.92, this.time);
        this.env.lens.hit(0.75, this.time);
        this.env.warpRush.hit(1.0, this.time);
        this.starWave(1.15, GOLD);

        this.launchPortal(PORTAL_KIND.perfect, {
            duration: 1.65,
            startR: 0.16,
            endR: 1.28,
            width: 0.019,
            amp: 1.32,
            rgb: GOLD,
        });

        // First the crown opens. The aurora gathers behind it, then the comets
        // carry the two ends of the spectrum away as its facets leave the frame.
        this.schedule(0.26, () => {
            this.env.aurora.hit(0.98, this.time);
            this.env.nebula.hit(0.72, this.time);
            this.env.flare.hit(1.15, this.time);
        });
        this.schedule(0.49, () => this.spawnComet({ side: -1, color: GOLD }));
        this.schedule(0.66, () => this.spawnComet({ side: 1, color: CYAN_COLOR }));

        this.planetFront({
            rgb: PRISM_AFTERGLOW, prism: 1, amp: 2.3, width: 0.18, sweep: 1.2, tau: 1.3,
        });
        this.schedule(0.3, () => this.env.ringPrism.hit(1.25, this.time));
        this.lightning(4, { amp: 1.25, delay: 0.22, gap: 0.11 });
    }

    /**
     * LEVEL UP: Dimensional Octagonal Warp Gate (Portal slot 0) expanding in the new movement's
     * color, repainting every arch and 3D pylon behind its front, advancing BOTH the spectrum
     * movement AND the cosmic sector voyage, flaring the binary star, and dawning across both planets!
     */
    onLevelUp(level) {
        this.rekindle();
        this.launchWave('levelUp');
        const next = Number.isFinite(level) ? level : this.level + 1;
        const gained = this.levelsGained(next);
        if (gained > 0) this.stepSpectrum(gained);
        const preview = ringStyle(Math.floor(this.spectrum.distance / RING_SPACING) + this.ringCount, this.ringPlace(), {});
        const speed = 2000;
        const gateCol = _color.setRGB(preview.glow.r, preview.glow.g, preview.glow.b);

        this.launchCascade({
            amp: 0.88, speed, color: gateCol, hueMix: 0.78,
        });
        // Unmistakable Dimensional Octagonal Warp Gate sweeping across the cosmos!
        this.launchPortal(PORTAL_KIND.level, {
            duration: 1.45,
            startR: 0.14,
            endR: 1.24,
            width: 0.016,
            amp: 1.22,
            rgb: preview.glow,
        });

        neonColor(hueOf(preview.glow), 0.55, _rgb2);
        this.planetFront({
            rgb: { r: _rgb2.r, g: _rgb2.g, b: _rgb2.b }, amp: 1.65, width: 0.2, sweep: 1.1, tau: 1.3,
        });
        this.repaintSeq = (this.repaintSeq || 0) + 1;
        this.repaint = {
            id: this.repaintSeq, birth: this.time, D0: this.composition.result.dEmerge, speed,
        };
        this.env.flare.hit(1.15, this.time);
        this.env.nebula.hit(1.1, this.time);
        this.env.aurora.hit(0.75, this.time);
        this.env.warpRush.hit(0.7, this.time);
        this.dipEvent = Math.max(this.dipEvent, 0.08 * (1 - 0.6 * this.heat.level));
        this.starWave(0.65, gateCol);
        this.surge.levelUp(this.time);
        this.schedule(0.5, () => this.setLevel(next, { step: false }));
    }

    // ── Meteors & Twin Celebratory Comets ────────────────────────────────────

    pathIsClear(points) {
        const comp = this.composition;
        const res = comp.result;
        const card = comp.layout?.card || {
            u0: -0.201, u1: 0.201, v0: -0.451, v1: 0.433,
        };
        const hud = comp.layout?.hud;
        const pad = 0.025;
        const hero = res.hero.anchor;
        const heroR = res.hero.radius / (2 * comp.tanHalf * 3600) + 0.05;
        const sec = res.secondary.anchor;
        const secR = (res.secondary.radius / (2 * comp.tanHalf * 5200)) * 2.2 + 0.03;
        const inRect = (r, u, v) => r && u > r.u0 - pad && u < r.u1 + pad && v > r.v0 - pad && v < r.v1 + pad;
        return points.every(([u, v]) => !inRect(card, u, v) && !inRect(hud, u, v)
            && Math.hypot(u - hero.u, v - hero.v) > heroR
            && (!res.secondary.visible || Math.hypot(u - sec.u, v - sec.v) > secR));
    }

    spawnMeteor({ side: forceSide = 0, color = null } = {}) {
        if (!this.meteors) return;
        const r = this.random;
        const comp = this.composition;
        const a = this.aspect;
        for (let attempt = 0; attempt < 6; attempt++) {
            let left = r() < 0.5;
            if (forceSide < 0) left = true;
            else if (forceSide > 0) left = false;
            const u = left ? -a / 2 + 0.05 + r() * Math.max(0.01, a / 2 - 0.35) : 0.47 + r() * Math.max(0.01, a / 2 - 0.52);
            const v = left ? 0.05 + r() * 0.4 : 0.28 + r() * 0.18;
            const d = 1400 + r() * 1400;
            const life = 0.38 + r() * 0.26;
            const pxPerSec = 920 + r() * 520;
            const travelH = (pxPerSec * life) / 1080;
            let ang = Math.atan2(v - 0.042, u) + (r() * 2 - 1) * THREE.MathUtils.degToRad(24);
            ang += (u < 0 ? 1 : -1) * THREE.MathUtils.degToRad(10 + r() * 15);
            const u2 = u + Math.cos(ang) * travelH;
            const v2 = v + Math.sin(ang) * travelH;
            if (!this.pathIsClear([[u, v], [(u + u2) / 2, (v + v2) / 2], [u2, v2]])) continue;
            comp.anchorToWorld(u, v, d, _v1);
            comp.anchorToWorld(u2, v2, d * (1 - 0.15 - r() * 0.15), _v2);
            _v3.subVectors(_v2, _v1).divideScalar(life);
            this.meteors.spawn({
                start: _v1,
                velocity: _v3,
                life,
                widthPx: 2.2 + r() * 1.1,
                value: 2.1 + r() * 0.9,
                time: this.time,
                color,
            });
            return;
        }
        // Guaranteed clear flank fallback when a gameplay event requests a directional twin meteor!
        if (forceSide !== 0) {
            const left = forceSide < 0;
            const u = left ? -Math.min(a * 0.44, 0.72) : Math.min(a * 0.44, 0.72);
            const v = left ? 0.38 : 0.42;
            const u2 = left ? -Math.min(a * 0.47, 0.80) : Math.min(a * 0.47, 0.80);
            const v2 = left ? -0.14 : -0.10;
            const d = 1750;
            const life = 0.62;
            comp.anchorToWorld(u, v, d, _v1);
            comp.anchorToWorld(u2, v2, d * 0.84, _v2);
            _v3.subVectors(_v2, _v1).divideScalar(life);
            this.meteors.spawn({
                start: _v1,
                velocity: _v3,
                life,
                widthPx: 2.6,
                value: 2.6,
                time: this.time,
                color,
            });
        }
    }

    /** A slow grazing comet (dust + ion tail) on the hero side (default) or right sky window. */
    spawnComet({ side = -1, color = null } = {}) {
        if (!this.meteors) return;
        const comp = this.composition;
        const hero = comp.result.hero.anchor;
        const heroRH = comp.result.hero.radius / (2 * comp.tanHalf * 3600);
        let u;
        let v;
        let u2;
        let v2;
        let tailSide;
        if (side > 0) {
            // Right sky celebratory arc sweeping cleanly past the ice giant!
            const a = this.aspect;
            u = Math.min(a * 0.44, 0.72);
            v = 0.44;
            u2 = Math.min(a * 0.46, 0.8);
            v2 = -0.14;
            tailSide = 1;
        } else {
            tailSide = hero.u < 0 ? 1 : -1;
            u = hero.u + tailSide * heroRH * 1.55;
            v = hero.v + heroRH * 1.8;
            u2 = hero.u + tailSide * heroRH * 1.12;
            v2 = hero.v - heroRH * 1.5;
        }
        const life = 2.5;
        comp.anchorToWorld(u, v, 3000, _v1);
        comp.anchorToWorld(u2, v2, 2900, _v2);
        _v3.subVectors(_v2, _v1).divideScalar(life);
        this.meteors.spawn({
            start: _v1, velocity: _v3, life, widthPx: 5.5, value: 2.4, time: this.time, evict: true, color,
        });
        if ((this.meteors.capacity ?? 2) < 2) return;
        comp.anchorToWorld(u2 + tailSide * 0.05, v2 - 0.02, 2900, _v2);
        _v3.subVectors(_v2, _v1).divideScalar(life);
        this.meteors.spawn({
            start: _v1, velocity: _v3, life, widthPx: 1.8, value: 3.4, time: this.time, evict: true, color,
        });
    }

    // ── Per-frame update ─────────────────────────────────────────────────────

    updateWaves(sim, flash = flashScale()) {
        const { uA, uB } = this.shared.waves;
        let E = 0;
        for (let i = 0; i < this.waveSlots.length; i++) {
            const w = this.waveSlots[i];
            if (!w) continue;
            const age = this.time - w.birth;
            if (age > w.tau * 8) {
                this.waveSlots[i] = null;
                continue;
            }
            const env = age < 0 ? 0 : Math.min(1, age / 0.04) * Math.exp(-age / w.tau);
            w.energy = w.amp * env;
            w.zFront = w.z0 + w.v0 * Math.max(0, age) + 0.5 * w.accel * Math.max(0, age) ** 2;
            E += w.energy;
        }
        E += 0.5 * (sim.ring ?? 0) + 0.3 * (sim.pulse ?? 0);
        const govern = E > 3 ? 3 / E : 1;
        this.governor = govern;
        const col = this._waveCol || (this._waveCol = { r: 0, g: 0, b: 0 });
        for (let i = 0; i < this.waveSlots.length; i++) {
            const w = this.waveSlots[i];
            if (!w) {
                uA.array[i].set(0, 1, 0, 0);
                continue;
            }
            if (w.rgb) {
                col.r = w.rgb.r;
                col.g = w.rgb.g;
                col.b = w.rgb.b;
            } else {
                spectrumRGB(Math.max(0, w.hue), col);
            }
            uA.array[i].set(w.zFront, 1 / Math.max(1, w.width), w.energy * govern * flash, w.hue < 0 && !w.rgb ? 1 : 0);
            uB.array[i].set(col.r, col.g, col.b, w.white);
        }
        for (let i = 0; i < this.cascades.length; i++) {
            const c = this.cascades[i];
            const cAge = this.time - c.birth;
            (i === 0 ? this.shared.uCascade : this.shared.uCascade2).value.w = cAge >= 0 && cAge < 3
                ? c.amp * Math.exp(-cAge / 0.8) * flash
                : 0;
        }
        this.shared.uChase.value.w = this.chases[0].amp * flash;
        this.shared.uChase2.value.w = this.chases[1].amp * flash;
        return govern;
    }

    /** Resolve the bounded cosmic portal strokes + road tactile ripples on the CPU each frame. */
    updateSpectacles() {
        const t = this.time;
        const {
            uPortalA, uPortalB, uLanePulse, uSlamWave, uTwistGlass,
        } = this.shared;
        const motion = this.motion ?? 1;
        const flash = flashScale();
        this.shared.uTwistMotion.value = motion;
        let first = this.portals.length;
        let last = -1;
        for (let i = 0; i < this.portals.length; i++) {
            const p = this.portals[i];
            const age = t - p.birth;
            if (p.amp <= 0 || age < 0 || age > p.duration) {
                uPortalA.array[i].set(0.2, 0.02, 0, p.kind);
                continue;
            }
            const u = age / p.duration;
            // Fast punchy launch easing smoothly outward across the sky!
            const ease = 1 - (1 - u) * (1 - u) * (1 - u);
            // Reduced motion holds the emblem at the shoulder of the road.
            const r = p.startR + (p.endR - p.startR) * (0.32 + (ease - 0.32) * motion);
            const env = Math.min(1, u / 0.08) * (1 - u) ** 1.35;
            uPortalA.array[i].set(r, p.width * (1 + ease * 0.9), p.amp * env * flash, p.kind);
            uPortalB.array[i].set(p.rgb.r, p.rgb.g, p.rgb.b, u * motion);
            if (uPortalA.array[i].z >= 0.004) {
                first = Math.min(first, i);
                last = i;
            }
        }
        this.cosmicPortals?.setActiveRange(first, last);

        // Piece lock single-lane glass ripple racing FORWARD down -Z along the rainbow highway!
        const lAge = t - this.lanePulse.birth;
        if (this.lanePulse.amp > 0 && lAge >= 0 && lAge < 1.1) {
            const zL = this.lanePulse.z0 - lAge * 760 - 0.5 * 1150 * lAge * lAge;
            const eL = this.lanePulse.amp * Math.exp(-lAge / 0.42);
            uLanePulse.value.set(this.lanePulse.lane, eL, zL, this.lanePulse.hard);
        } else {
            uLanePulse.value.y = 0;
        }

        // Hard drop compression V-chevron shockwave roaring FORWARD down -Z across all 7 lanes!
        const sAge = t - this.slamWave.birth;
        if (this.slamWave.amp > 0 && sAge >= 0 && sAge < 0.95) {
            const zS = this.slamWave.z0 - sAge * 920 - 0.5 * 1650 * sAge * sAge;
            const eS = this.slamWave.amp * Math.exp(-sAge / 0.34);
            uSlamWave.value.set(zS, eS, 0, 0);
        } else {
            uSlamWave.value.y = 0;
        }

        // Twist diagonal stained-glass shear ripple
        const tAge = t - this.twistGlass.birth;
        if (this.twistGlass.amp > 0 && tAge >= 0 && tAge < 1.4) {
            const eT = this.twistGlass.amp * Math.min(1, tAge / 0.08) * Math.exp(-tAge / 0.45);
            uTwistGlass.value.set(tAge, eT, this.twistGlass.sign, 0);
        } else {
            uTwistGlass.value.y = 0;
        }
    }

    /** Closed-form Game Over hyperspace coast-down factor (0 = full cruise, 1 = coasted ember). */
    coastFactorAt(t) {
        if (this.gameOverAt <= -1e3) return 0;
        const age = t - this.gameOverAt;
        if (age < 0) return 0;
        if (age < 1.4) return THREE.MathUtils.smoothstep(age, 0, 1.4);
        if (age < COAST_HOLD) return 1;
        const rec = (age - COAST_HOLD) / COAST_RECOVER;
        if (rec >= 1) return 0;
        return 1 - (rec * rec * (3 - 2 * rec));
    }

    update(sim, camera) {
        const delta = sim.delta ?? 0;
        this.time = sim.time;
        const motion = this.motion ?? 1;
        this.flushStaged();
        const heat = this.surge.sample(this.time);
        this.heat.punch = heat.punch;
        this.heat.level = heat.level;
        this.heat.fever = heat.fever;
        this.heat.stage = heat.stage;
        const { level, fever } = this.heat;
        this.feverPrism = heat.stage === 3;

        // Game-over coast-down factor (0 at play, 1 while hushed, recovers smoothly by itself).
        const coast = this.coastFactorAt(this.time);
        this.fx.coast = coast;

        const drive = (1 + (DRIVE.level * level + DRIVE.fever * fever) * motion) * (1 - 0.78 * coast);
        const targetSpeed = TRAVEL_SPEED * worldSpeedFactor(sim.pace ?? 1) * drive;
        this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-delta / 1.1));
        const travelRate = 0.25 + 0.75 * motion;
        this.travel = (this.travel + delta * this.speed * travelRate) % TRAVEL_WRAP;
        this.spectrum.distance += delta * this.speed * travelRate;
        this.moteTravel = (this.moteTravel + delta * this.speed * travelRate * (1 + 0.5 * (sim.ambient ?? 0)))
            % (TUNNEL_SPAN * 30);

        if (this.pendingEvents.length) {
            for (let i = this.pendingEvents.length - 1; i >= 0; i--) {
                const e = this.pendingEvents[i];
                if (this.time >= e.at) {
                    this.pendingEvents.splice(i, 1);
                    const saved = this.time;
                    this.time = e.at;
                    e.fn();
                    this.time = saved;
                }
            }
        }

        // Cosmic Voyage clock (independent 73 s sector evolution + eased level-up nudges).
        const v = this.voyage;
        v.offset += (v.offsetTarget - v.offset) * (delta > 0 ? 1 - Math.exp(-delta / 1.8) : 1);
        const secPhase = v.pinned !== null ? v.pinned + 0.1 : sectorPhase(this.time, v.offset);
        const sec = sectorAt(secPhase, v.state);

        // Event envelopes (all swells accumulate cleanly!).
        const { fx, env } = this;
        const now = this.time;
        const flash = flashScale();
        fx.surge = env.lens.valueAt(now);
        fx.streakWarp = env.warp.valueAt(now);
        fx.warpRush = Math.min(1, (env.warpRush.valueAt(now) + 0.55 * fever) * motion * (1 - coast));
        fx.flare = env.flare.valueAt(now) + 0.45 * fever;
        fx.nebula = env.nebula.valueAt(now) * flash;
        fx.railTick = env.railTick.valueAt(now);
        fx.aurora = env.aurora.valueAt(now) * flash + 0.35 * fever;
        fx.goldGild = env.goldGild.valueAt(now);
        fx.nova = env.nova.valueAt(now) * flash;
        fx.storm = Math.min(1, env.storm.valueAt(now) + 0.3 * Math.max(0, level - 0.4) + 0.3 * fever);
        this.planetFx.calm = prefersReducedFlashing();
        if (this.tier.rim) {
            // Ion Corridor sector adds gentle ambient distant planetary storm flickers!
            const ionAmb = sec.name === 'ion-corridor' ? 0.35 : 0;
            const rumble = STORM_RATE.clear * env.storm.valueAt(now)
                + STORM_RATE.heat * Math.max(0, level - 0.35) + STORM_RATE.fever * fever + ionAmb;
            this.planetFx.rumble(rumble, delta, now);
        }
        fx.ringPrism = Math.min(1, env.ringPrism.valueAt(now) + 1.6 * fever);
        fx.ringGold = Math.min(1, env.ringGold.valueAt(now));
        this.ringFlow = (this.ringFlow + delta * (0.08 + 0.3 * fx.ringPrism) * (0.25 + 0.75 * motion)) % 1;
        this.dipEvent *= Math.exp(-delta / 0.3);
        fx.dip = this.dipEvent * flash + 0.03 * level + 0.05 * fever;
        _decay(fx, 'combo', 2.5, delta);

        // Spectrum + ring phase
        this.updateRingStyles();
        const sp = this.spectrum;
        sp.levelPlace += (sp.levelTarget - sp.levelPlace) * (1 - Math.exp(-delta / 1.0));
        if (Math.abs(sp.levelTarget - sp.levelPlace) < 1e-4) sp.levelPlace = sp.levelTarget;
        const twist = env.twist.valueAt(now);
        const phaseRate = Math.min(
            RING_PHASE_MAX_RATE,
            (RING_PHASE_RATE + (1.4 * fx.combo + 1.0 * level + 1.2 * fever + 3 * twist) * motion) * (1 - 0.65 * coast),
        );
        this.ringPhase = (this.ringPhase + delta * phaseRate) % RING_PHASE_WRAP;
        this.shared.uRingPhase.value = this.ringPhase;
        this.updateAir(delta);
        this.updateSpectacles();

        const govern = this.updateWaves(sim, flash) * flash;
        const { shared } = this;
        const liveGain = 1 - 0.56 * coast;
        shared.uTime.value = this.time;
        shared.uTravel.value = this.travel;
        shared.uMoteTravel.value = this.moteTravel;
        shared.uPulse.value = ((sim.pulse ?? 0) + env.roadPulse.valueAt(now) + 0.25 * level + 0.22 * fever) * govern * liveGain;
        shared.uPace.value = sim.pace ?? 1;
        shared.uRingEnv.value = ((sim.ring ?? 0) + 0.45 * level + 0.52 * fever) * govern * liveGain;
        shared.uRailTick.value = fx.railTick;
        shared.uMoteGain.value = 1 + 0.55 * (sim.ambient ?? 0) + 0.45 * sec.coreWarmth;
        shared.uAirGain.value = this.airGain * (1 + 0.85 * level + 1.05 * fever) * liveGain;
        shared.uRoadSheen.value = sec.roadSheen;
        shared.uGoldGild.value = fx.goldGild;
        shared.uFeverGlow.value = Math.min(1, fever * 1.15 + env.quadRail.valueAt(now) * 0.55);
        shared.uWarpRails.value.set(
            env.tripleRail.valueAt(now),
            Math.min(1.25, env.quadRail.valueAt(now) + fever * 0.72),
            fx.goldGild,
            env.perfectRail.valueAt(now),
        ).multiplyScalar(flash);

        const pace = sim.pace ?? 1;
        // Sleek exhilarating base streaks (84 u at cruise -> relativistic light-rails up to 360 u in warp!).
        shared.uStreakLength.value = (84 + 90 * Math.max(pace - 1, 0)) * (1 + 0.75 * (sim.particle ?? 0))
            * (1 + 1.8 * fx.streakWarp * motion) * (1 + (1.15 * level + 2.0 * fever) * motion) * (1 - 0.72 * coast);
        shared.uStreakDensity.value = Math.min(1, (0.76 + 0.24 * Math.min(1, sim.particle ?? 0) + 0.2 * (level + fever)) * (1 - 0.65 * coast));

        // Coast-down ember dimming on arches, pylons, rails & road
        if (this.rings) this.rings.uniforms.uIntensity.value = liveGain;
        if (this.pylons) this.pylons.uniforms.uIntensity.value = liveGain;
        if (this.chevrons) this.chevrons.uniforms.uIntensity.value = liveGain;
        if (this.rails) this.rails.uniforms.uIntensity.value = liveGain;
        if (this.road) this.road.uniforms.uBrightness.value = 1 - 0.42 * coast;

        // Sky + stars: driven by cosmic voyage sector + spectrum movement + events!
        this.sky.uniforms.uTime.value = this.time;
        this.sky.uniforms.uNebBreath.value = 0.1 * (sim.ambient ?? 0) + 0.22 * fx.nebula + 0.16 * level + 0.26 * fever;
        this.sky.setHueShift(skyTurnAt(this.skyPlace()));
        this.sky.setSector?.(sec, {
            auroraBoost: fx.aurora * 0.85,
            skyPulse: fx.nebula * 0.45,
            nova: fx.nova,
        });
        this.stars.uniforms.uTime.value = this.time;
        this.stars.uniforms.uBinaryFlare.value = fx.flare;
        if (this.stars.uniforms.uBinaryGold) this.stars.uniforms.uBinaryGold.value = Math.min(1, fx.goldGild + fx.nova);
        if (this.stars.uniforms.uStarBoost) this.stars.uniforms.uStarBoost.value = sec.starBoost;

        this.updateBodies(camera, delta);

        // Ambient meteors + Fever showers
        const alive = this.meteors.update(this.time);
        this.meteorTimer -= delta * (1 + 3.2 * fever);
        if (this.meteorTimer <= 0) {
            if (alive < 2 + Math.round(3 * fever) && !prefersReducedMotion()) this.spawnMeteor();
            this.meteorTimer = 4.5 + this.random() * 5;
        }
        this.hardDropPending = false;
    }

    updateBodies(camera, delta) {
        const res = this.composition.result;
        const k = delta > 0 ? THREE.MathUtils.clamp(delta * 2.1, 0.03, 0.16) : 1;
        const A = this.anchors;
        A.hero.lerp(res.hero.position, k);
        A.heroR += (res.hero.radius - A.heroR) * k;
        A.secondary.lerp(res.secondary.position, k);
        A.secondaryR += (res.secondary.radius - A.secondaryR) * k;
        const t = this.time;
        const comp = this.composition;
        const Hs = 2 * comp.tanHalf;

        const { hero } = this;
        hero.mesh.position.set(
            A.hero.x + Math.sin((t * Math.PI * 2) / 240) * 0.025 * res.hero.scale * Hs * 3600,
            A.hero.y + Math.sin((t * Math.PI * 2) / 170 + 1.3) * 0.015 * res.hero.scale * Hs * 3600,
            A.hero.z,
        );
        hero.setRadius(A.heroR);
        hero.uniforms.uTime.value = t;
        // Polar auroral ovals breathe gently with the cosmic sector and blaze on gameplay events!
        const secAur = this.voyage.state.aurora;
        hero.setAurora?.(0.32 + secAur * 0.55 + this.fx.aurora * 1.15);

        const fill = this._binaryFar || (this._binaryFar = new THREE.Vector3());
        fill.copy(res.binary.direction).multiplyScalar(1e7);

        if (this.moon) {
            const r = A.heroR * 1.185;
            const phi = ((t - 40) / 96) * Math.PI * 2 + Math.PI / 2;
            _losT.subVectors(comp.restCamera.position, hero.mesh.position).normalize();
            _losR.crossVectors(_worldUp, _losT).normalize();
            _losU.crossVectors(_losT, _losR);
            _moonLocal.copy(_losR).multiplyScalar(r * Math.cos(phi))
                .addScaledVector(_losU, r * Math.sin(phi) * Math.sin(MOON_TILT))
                .addScaledVector(_losT, r * Math.sin(phi) * Math.cos(MOON_TILT));
            this.moon.mesh.position.copy(hero.mesh.position).add(_moonLocal);
            this.moon.setRadius(res.moon.radius * (A.heroR / Math.max(1, res.hero.radius)));
            const dm = this.moon.mesh.position.distanceTo(camera.position);
            const dh = hero.mesh.position.distanceTo(camera.position);
            if (this.moon.mesh.renderOrder < hero.mesh.renderOrder && dm < dh - 50) this.moon.mesh.renderOrder = -60;
            else if (this.moon.mesh.renderOrder > hero.mesh.renderOrder && dm > dh + 50) this.moon.mesh.renderOrder = -70;
            const hr = hero.radius;
            hero.uniforms.uMoon.value.set(_moonLocal.x / hr, _moonLocal.y / hr, _moonLocal.z / hr, this.moon.radius / hr);
            const mr = Math.max(1, this.moon.radius);
            this.moon.uniforms.uEclipse.value.set(-_moonLocal.x / mr, -_moonLocal.y / mr, -_moonLocal.z / mr, hr / mr);
        }

        if (this.secondary) {
            this.secondary.mesh.position.set(
                A.secondary.x + Math.sin((t * Math.PI * 2) / 300) * 0.01 * Hs * 5200,
                A.secondary.y + Math.cos((t * Math.PI * 2) / 300) * 0.006 * Hs * 5200,
                A.secondary.z,
            );
            this.secondary.setRadius(A.secondaryR);
            this.secondary.uniforms.uTime.value = t;
        }

        if (this.witness) {
            const w = comp.witnessAt(t, this._witness || (this._witness = {}));
            if (w) {
                comp.anchorToWorld(w.u, w.v, 4500, this.witness.mesh.position);
                this.witness.setRadius((w.diameterH / 2) * Hs * 4500);
                this.witness.uniforms.uOpacity.value = Math.min(1, Math.min(w.progress, 1 - w.progress) * 12);
            } else {
                this.witness.uniforms.uOpacity.value = 0;
            }
        }

        let heroPx = 0;
        const pfx = this.planetFx;
        for (const planet of this.planets) {
            planet.setSpinForTime(t);
            const rPx = planet.update(camera, KEY_LIGHT, fill, this.viewport.height);
            if (planet === hero) heroPx = rPx;
            const delay = planet.mesh.position.distanceTo(KEY_LIGHT) / FRONT_SPEED;
            pfx.writeFronts(t, delay, planet.extent, planet.frontValues);
        }
        if (hero.hasLightning) {
            const flicker = prefersReducedFlashing() ? 0 : 1;
            hero.setCells(pfx.resolveCells(t, flicker, (rand) => hero.pickSite(rand)));
        }
        this.secondary?.setRingPrism(this.fx.ringPrism, this.ringFlow, this.fx.ringGold);

        _proj.copy(hero.mesh.position).project(camera);
        const { width: W, height: H } = this.viewport;
        this.shared.uHeroPx.value.set((_proj.x * 0.5 + 0.5) * W, (0.5 - _proj.y * 0.5) * H, heroPx);
    }

    updateCamera(camera, sim) {
        const t = sim.time;
        const dt = sim.delta ?? 0;
        this.time = t;
        this.motionState ??= {};
        const motion = easedMotion(this.motionState, dt);
        this.motion = motion;
        const rest = REST_RIG.position;
        const pointer = this.capture ? 0 : motion;
        const px = (sim.pointerX ?? 0) * 9.7 * pointer;
        const py = -(sim.pointerY ?? 0) * 5.5 * pointer;
        const lurch = 2.8 * this.heat.punch;
        camera.position.set(
            rest.x + (Math.sin(t * 0.13) * 2.2 + Math.sin(t * 0.41) * 0.5) * motion + px,
            rest.y + (Math.sin(t * 0.17) * 1.5 + Math.sin(t * 0.53) * 0.4) * motion + py,
            rest.z + (Math.sin(t * 0.09) * 2.5 - lurch) * motion,
        );
        const ahead = this.sampleRoadCurve(-1500, _camAhead);
        const near = this.sampleRoadCurve(-800, _camNear);
        const slope = (ahead.x - near.x) / 700;
        const lookTarget = 0.2 * ahead.x * motion;
        const bankTarget = THREE.MathUtils.clamp(slope * 0.18, -0.021, 0.021) * motion;
        if (dt > 0) {
            _spring(this.cam.lookX, lookTarget, 1.6, dt);
            _spring(this.cam.bank, bankTarget, 1.2, dt);
        } else if (this.capture || this.cam.lookX.x === 0) {
            this.cam.lookX.x = lookTarget;
            this.cam.bank.x = bankTarget;
        }
        const { focus } = REST_RIG;
        _look.set(focus.x + this.cam.lookX.x + px * 0.3, focus.y + 0.3 * ahead.y + py * 0.3, focus.z);
        camera.up.set(0, 1, 0);
        camera.lookAt(_look);
        camera.rotateZ(this.cam.bank.x);

        let fov = restVerticalFov(camera.aspect || this.aspect);
        if (this.tier.paceFov) {
            const paceTarget = 2.5 * THREE.MathUtils.smoothstep(sim.pace ?? 1, 1.0, 2.2) * motion;
            this.cam.paceFov += (paceTarget - this.cam.paceFov) * (dt > 0 ? 1 - Math.exp(-dt / 1.5) : 1);
            const drive = Math.min(1.25 * this.heat.level + 1.8 * this.heat.fever, 2.8);
            fov += this.cam.paceFov + (1.75 * this.fx.surge + drive) * motion;
        }
        if (Math.abs(fov - camera.fov) > 0.01) {
            camera.fov = fov;
            camera.updateProjectionMatrix();
            this.setViewport(this.viewport.height, camera, this.viewport.width, this.viewport.cssHeight);
        }
        applyCameraBreath(camera, t, { scale: motion });
        camera.updateMatrixWorld();
    }

    dispose() {
        this.parts.forEach((p) => p.dispose?.());
        this.parts = [];
        this.planets = [];
        this.textures.forEach((t) => t.dispose());
        this.textures = [];
        this.group.removeFromParent();
    }
}
