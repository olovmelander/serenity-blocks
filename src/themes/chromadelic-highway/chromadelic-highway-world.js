/**
 * Chromadelic Highway — the world: everything that is drawn, and how it moves.
 *
 * Decoupled from BaseTheme so the same content mounts in the game theme and in the playground
 * (src/playground/effects/chromadelic-highway.effect.js). The theme owns lifecycle, the
 * reactive envelope and the post stack; the world owns the scene content, the composition,
 * the camera rig and the event choreography.
 *
 * "The board is the sun" (docs/CHROMADELIC_HIGHWAY_VISUAL_OVERHAUL_2026-09.md): the card hides
 * the vanishing point, and the only key light sits behind it at the highway core. Every lit
 * limb faces the board; rings, streaks and event light radiate out of it; the planets own the
 * visible side zones (placed by the composition solver in screen anchors, so they stay clear of
 * the board at every aspect).
 *
 * Motion runs on ONE travel clock (see chromadelic-highway-tsl.js). Everything visible is a
 * closed-form function of (time, travel) plus the event schedule — seekable for captures.
 */

import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import { createSkyDome, createStarfield } from './chromadelic-highway-sky.js';
import { createPlanetImpostor, PLANET_PALETTE } from './chromadelic-highway-planets.js';
import {
    LANE_COLORS_HEX, createRails, createRoad,
} from './chromadelic-highway-road.js';
import {
    createMeteors, createMotes, createSpeedStreaks, createTunnelRings,
} from './chromadelic-highway-fx.js';
import { ChromadelicComposition, REST_RIG, restVerticalFov } from './chromadelic-highway-composition.js';
import {
    RING_SPACING, TRAVEL_SPEED, TRAVEL_WRAP, TUNNEL_SPAN, TUNNEL_Z_NEAR, spectrumRGB, worldSpeedFactor,
} from './chromadelic-highway-tsl.js';

const tier = (o) => o;

/** Per-quality content. Every tier keeps the same composition; tiers trade detail. */
export const WORLD_TIERS = {
    Minimal: tier({
        stars: 600,
        skyTaps: 0,
        moon: false,
        secondary: false,
        witness: false,
        heroDetail: false,
        fill: false,
        rim: false,
        roadSegments: 30,
        dashes: false,
        sheen: false,
        glitter: false,
        railCurtain: false,
        rings: 3,
        ringSegments: 64,
        streaks: 0,
        motes: 0,
        meteors: 1,
        waveSlots: 1,
        paceFov: false,
        spikes: false,
    }),
    Low: tier({
        stars: 1000,
        skyTaps: 1,
        moon: true,
        secondary: false,
        witness: false,
        heroDetail: false,
        fill: false,
        rim: true,
        roadSegments: 40,
        dashes: true,
        sheen: true,
        glitter: false,
        railCurtain: true,
        rings: 4,
        ringSegments: 64,
        streaks: 48,
        motes: 0,
        meteors: 2,
        waveSlots: 2,
        paceFov: false,
        spikes: false,
    }),
    Medium: tier({
        stars: 1800,
        skyTaps: 2,
        moon: true,
        secondary: true,
        witness: false,
        heroDetail: false,
        fill: false,
        rim: true,
        roadSegments: 70,
        dashes: true,
        sheen: true,
        glitter: false,
        railCurtain: true,
        rings: 6,
        ringSegments: 80,
        streaks: 120,
        motes: 0,
        meteors: 4,
        waveSlots: 3,
        paceFov: true,
        spikes: true,
    }),
    High: tier({
        stars: 3000,
        skyTaps: 2,
        moon: true,
        secondary: true,
        witness: false,
        heroDetail: true,
        fill: true,
        rim: true,
        roadSegments: 100,
        dashes: true,
        sheen: true,
        glitter: true,
        railCurtain: true,
        rings: 8,
        ringSegments: 96,
        streaks: 240,
        motes: 120,
        meteors: 8,
        waveSlots: 4,
        paceFov: true,
        spikes: true,
    }),
    Ultra: tier({
        stars: 4500,
        skyTaps: 2,
        moon: true,
        secondary: true,
        witness: true,
        heroDetail: true,
        fill: true,
        rim: true,
        roadSegments: 150,
        dashes: true,
        sheen: true,
        glitter: true,
        railCurtain: true,
        rings: 10,
        ringSegments: 112,
        streaks: 360,
        motes: 200,
        meteors: 10,
        waveSlots: 6,
        paceFov: true,
        spikes: true,
    }),
    Extreme: tier({
        stars: 6000,
        skyTaps: 2,
        moon: true,
        secondary: true,
        witness: true,
        heroDetail: true,
        fill: true,
        rim: true,
        roadSegments: 200,
        dashes: true,
        sheen: true,
        glitter: true,
        railCurtain: true,
        rings: 12,
        ringSegments: 112,
        streaks: 480,
        motes: 300,
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

/**
 * The key light: a point at the highway core, far behind the board. At z −4000 the hero is
 * gibbous (62–68 % lit, a curved terminator that reads as a sphere) with its lit limb toward the
 * card and a night crescent set against the warm nebula.
 */
export const KEY_LIGHT = new THREE.Vector3(0, 60, -4000);

/** Ring phrase: cyan, violet, azure, then the magenta downbeat (chdSpectrum hues). */
const RING_PHRASE = [0.5, 0.25, 5 / 12, 1 / 6];
/** Four phrases per palette cycle, each walked by a few degrees. */
const PHRASE_WALK = [0, 1 / 18, 0, -1 / 18];
const RING_PALETTE_SIZE = 16;

const _rgb = { r: 0, g: 0, b: 0 };

/** chdSpectrum() on the CPU as a THREE.Color. */
export function spectrumColor(t, out = new THREE.Color()) {
    const c = spectrumRGB(t, _rgb);
    return out.setRGB(c.r, c.g, c.b);
}

/** Soft luminance normalisation: lum → target with exponent 0.7 (blue/violet stay bright). */
function normaliseLuma(color, target) {
    const l = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
    return color.multiplyScalar((target / Math.max(l, 0.12)) ** 0.7);
}

/**
 * Event waves. Every wave launches just behind where the road slides under the card
 * (zEntry − 40, from the solver) and runs TOWARD the player, so its energy lands in the
 * visible wedges. `tau` is the energy decay of each event.
 */
const WAVE_PRESETS = {
    lock: {
        v0: 500, accel: 800, amp: 0.08, hue: 0.5, width: 14, white: 0.3, tau: 0.4,
    },
    combo: {
        v0: 650, accel: 1400, amp: 0.4, hue: 1 / 6, width: 20, white: 0.2, tau: 0.55,
    },
    clear: {
        v0: 650, accel: 1400, amp: 0.5, hue: 11 / 12, width: 22, white: 0.25, tau: 0.6,
    },
    tetris: {
        v0: 700, accel: 1800, amp: 0.8, hue: -1, width: 24, white: 0.1, tau: 0.65,
    },
    levelUp: {
        v0: 500, accel: 600, amp: 0.7, hue: 0.25, width: 60, white: 0.6, tau: 0.9,
    },
};

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
const _camAhead = { x: 0, y: 0 };
const _camNear = { x: 0, y: 0 };
/** Exponential decay of one event envelope. */
const _decay = (fx, key, tau, dt) => { fx[key] *= Math.exp(-dt / tau); };
const _spring = (state, target, omega, dt) => {
    // Critically damped spring (exact for a constant target over dt).
    const x = state.x - target;
    const e = Math.exp(-omega * dt);
    const nx = (x + (state.v + omega * x) * dt) * e;
    state.v = (state.v - omega * (state.v + omega * x) * dt) * e;
    state.x = target + nx;
};

export class ChromadelicWorld {
    /**
     * @param {object} opts
     * @param {THREE.Scene} opts.scene
     * @param {string} [opts.quality='High']
     * @param {() => number} [opts.random]
     * @param {string} [opts.textureBase='./textures/']
     * @param {boolean} [opts.capture=false]  deterministic capture mode (no pointer parallax)
     */
    constructor({
        scene, quality = 'High', random = Math.random, textureBase = './textures/', capture = false,
    }) {
        this.scene = scene;
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
        this.travel = 0; // double precision on the CPU, wrapped at TRAVEL_WRAP
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
        this.cometAt = -1e4;
        this.chainCometDone = false;
        this.fx = {
            dip: 0, surge: 0, streakWarp: 0, flare: 0, storm: 0, railTick: 0, nebula: 0,
        };
        this.palette = {
            ring: 0, ringTarget: 0, neb: 0, nebTarget: 0,
        };
        this.cam = {
            lookX: { x: 0, v: 0 }, bank: { x: 0, v: 0 }, paceFov: 0,
        };
        this.composition = new ChromadelicComposition();
        this.anchors = null; // eased body targets
        this.cascade = { birth: -1e4, amp: 0 };

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
            uStreakLength: uniform(40),
            uStreakDensity: uniform(0.6),
            uGateFar: uniform(TUNNEL_Z_NEAR - this.tier.rings * RING_SPACING),
            uHaze: uniform(new THREE.Color(0.03, 0.01, 0.06)),
            uViewportH: uniform(1080),
            uProjScaleY: uniform(1.73),
            uPxScale: uniform(935),
            // Screen-space layout (drawing-buffer px, top-left origin).
            uViewportPx: uniform(new THREE.Vector2(1920, 1080)),
            uCardRectPx: uniform(new THREE.Vector4(780, 160, 1140, 920)),
            uCardRadiusPx: uniform(20),
            uApron: uniform(new THREE.Vector4(960, 204, 920, 0)),
            uHeroPx: uniform(new THREE.Vector3(-1e4, -1e4, 1)),
            uDEmerge: uniform(1120),
            // Ring cascade: (birth, D0, speed, amp) and (rgb, hue mix).
            uCascade: uniform(new THREE.Vector4(-1e4, 1120, 2400, 0)),
            uCascadeCol: uniform(new THREE.Vector4(1, 1, 1, 0)),
            uRingPalette: uniformArray(Array.from({ length: RING_PALETTE_SIZE }, () => new THREE.Color()), 'color'),
            waves: {
                count: slots,
                uA: uniformArray(Array.from({ length: slots }, () => new THREE.Vector4(0, 1, 0, 0)), 'vec4'),
                uB: uniformArray(Array.from({ length: slots }, () => new THREE.Vector4(1, 1, 1, 0)), 'vec4'),
            },
        };
        this.waveSlots = Array.from({ length: slots }, () => null);
        this.waveCursor = 0;
        this.writeRingPalette();
    }

    loadTexture(path, { wrapT = THREE.ClampToEdgeWrapping } = {}) {
        const tex = new THREE.TextureLoader().load(`${this.textureBase}${path}`);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = wrapT;
        tex.anisotropy = 4;
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

        const nebulaMap = t.skyTaps > 0 ? this.loadTexture('rainbow-nebula.png', { wrapT: THREE.RepeatWrapping }) : null;
        this.sky = this.add(createSkyDome({ nebulaMap, taps: t.skyTaps, shared }));
        this.stars = this.add(createStarfield({
            count: t.stars,
            random,
            bandNormal: res.sky.bandNormal,
            spikes: t.spikes,
        }));

        this.buildPlanets();

        const roadFeatures = { dashes: t.dashes, sheen: t.sheen, glitter: t.glitter };
        this.road = this.add(createRoad({ segments: t.roadSegments, shared, features: roadFeatures }));
        this.rails = this.add(createRails({
            segments: t.roadSegments, shared, features: { curtain: t.railCurtain },
        }));
        this.rings = this.add(createTunnelRings({ count: t.rings, segments: t.ringSegments, shared }));
        shared.uGateFar.value = TUNNEL_Z_NEAR - this.rings.count * RING_SPACING;
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
        const heroMap = this.loadTexture('chromadelic-highway/rainbow-planet-2k.jpg');
        // Hero: the pastel-rainbow giant, left zone, lit limb toward the board.
        this.hero = createPlanetImpostor({
            name: 'chromadelic-hero-planet',
            map: heroMap,
            radius: res.hero.radius,
            quad: 1.3,
            albedo: 0.68,
            rimPeak: t.rim ? 1.1 : 0,
            envRimColor: PLANET_PALETTE.heroEnvRim,
            haloGain: t.rim ? 0.1 : 0,
            axialTilt: THREE.MathUtils.degToRad(22),
            axialRoll: THREE.MathUtils.degToRad(-10),
            spinSpeed: 0.012,
            night: 0.2,
            equalize: true,
            features: {
                fill: t.fill,
                detail: t.heroDetail,
                polarHood: t.heroDetail,
                zonal: t.heroDetail,
                storms: t.heroDetail,
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
                quad: 1.2,
                albedo: 0.9, // its lit side must read against the hero's bands when it transits
                rimPeak: 0.5,
                envRimColor: PLANET_PALETTE.heroEnvRim,
                envRim: 0.3,
                grade: {
                    low: new THREE.Color('#3a3158'), mid: new THREE.Color('#8e80b8'), high: new THREE.Color('#d9d0f2'), amount: 1,
                },
                axialTilt: 0.2,
                spinSpeed: 0.02,
                features: { eclipse: t.heroDetail },
                renderOrder: -70,
            });
            this.add(this.moon);
            this.planets.push(this.moon);
        }

        if (t.secondary) {
            const iceMap = this.loadTexture('2k_neptune.jpg');
            const ringMap = this.loadTexture('2k_saturn_ring_alpha.png');
            ringMap.wrapS = THREE.ClampToEdgeWrapping;
            this.secondary = createPlanetImpostor({
                name: 'chromadelic-ice-giant',
                map: iceMap,
                radius: res.secondary.radius,
                quad: 2.25,
                albedo: 0.42,
                rimPeak: 0.7,
                envRimColor: PLANET_PALETTE.secondaryEnvRim,
                veil: 0.15,
                haloGain: 0.08,
                grade: {
                    low: new THREE.Color(0.02, 0.06, 0.1),
                    mid: new THREE.Color(0.1, 0.55, 0.7),
                    high: new THREE.Color(0.75, 1.0, 1.0),
                    amount: 0.85,
                    gain: 2.2,
                },
                axialTilt: THREE.MathUtils.degToRad(18),
                axialRoll: THREE.MathUtils.degToRad(-14),
                spinSpeed: (Math.PI * 2) / 420,
                features: {
                    fill: t.fill, ringShadows: t.fill, transmission: t.fill,
                },
                ring: {
                    map: ringMap,
                    inner: 1.3,
                    outer: 2.2,
                    tilt: THREE.MathUtils.degToRad(18),
                    roll: THREE.MathUtils.degToRad(-14),
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
                albedo: 0.3,
                rimPeak: 0.6,
                envRimColor: PLANET_PALETTE.heroEnvRim,
                veil: 0.15,
                grade: {
                    low: new THREE.Color(0.08, 0.01, 0.06), mid: new THREE.Color(0.85, 0.22, 0.32), high: new THREE.Color(1.0, 0.78, 0.45), amount: 0.7,
                },
                axialTilt: 0.1,
                spinSpeed: 0.03,
                renderOrder: -80,
            });
            this.add(this.witness);
            this.planets.push(this.witness);
        }
    }

    // ── Composition ──────────────────────────────────────────────────────────

    /**
     * Re-solve the composition (on resize, layout change or level-up; never per frame).
     * @param {number} aspect
     * @param {object|null} layout  readLayoutRects() result
     * @param {{width:number, height:number}} [viewportCss]  CSS px (for the CSS fallback)
     */
    setLayout(aspect, layout = this.composition.layout, viewportCss = null) {
        this.aspect = aspect;
        this.composition.solve({
            aspect, level: this.level, layout, viewport: viewportCss,
        });
        this.applyComposition(false);
        return this.composition.result;
    }

    /** Push the solved composition to the scene (snap = no easing). */
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

    /** Card/apron rects in drawing-buffer px for the screen-space masks. */
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
    }

    /**
     * Drawing-buffer size + projection scale for pixel-sized billboards, ring strips and the
     * screen-space masks. `cssHeight` gives the device-pixel ratio for CSS-px constants.
     */
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

    /** Level progression: the hero grows a little and the palette steps around the wheel. */
    setLevel(level) {
        const next = Math.max(1, Math.floor(level || 1));
        if (next === this.level) return;
        // A lower level is a new game (the theme only hears LEVEL_UP): snap the palette rather
        // than sweeping it back through the levels of the previous game.
        const newGame = next < this.level;
        this.level = next;
        this.palette.ringTarget = (next - 1) / 12;
        this.palette.nebTarget = (20 / 360) * Math.sin((2 * Math.PI * (next - 1)) / 6);
        if (newGame) {
            this.palette.ring = this.palette.ringTarget;
            this.writeRingPalette();
        }
        this.composition.solve({ aspect: this.aspect, level: this.level, layout: this.composition.layout });
        this.applyComposition(false);
    }

    /** Debug/perf: draw only the named parts (see the playground's `parts=`). */
    showOnlyParts(names) {
        const keep = new Set(names);
        this.partsFilter = keep; // applyComposition() re-shows the secondary and must respect this
        const byPart = {
            sky: [this.sky],
            stars: [this.stars],
            planets: this.planets,
            road: [this.road],
            rails: [this.rails],
            rings: [this.rings],
            streaks: [this.streaks],
            motes: [this.motes],
            meteors: [this.meteors],
        };
        Object.entries(byPart).forEach(([key, list]) => {
            list.forEach((part) => { if (part) part.mesh.visible = keep.has(key); });
        });
    }

    /** Scale the instance counts of the dense layers (adaptive effect scale). */
    setEffectScale(scale) {
        this.stars?.setDensity(0.6 + 0.4 * scale);
        this.streaks?.setDensityScale(scale);
        this.motes?.setDensityScale(scale);
    }

    /** 16-entry ring palette: the 4-beat phrase × 4 walked phrases, shifted by level. */
    writeRingPalette() {
        const pal = this.shared.uRingPalette.array;
        for (let i = 0; i < RING_PALETTE_SIZE; i++) {
            const beat = i % 4;
            const phrase = Math.floor(i / 4);
            spectrumColor(RING_PHRASE[beat] + PHRASE_WALK[phrase] + this.palette.ring, pal[i]);
            normaliseLuma(pal[i], beat === 3 ? 0.62 : 0.55);
        }
    }

    /** Sample the shared road curve (CPU twin of chdRoadCurve). */
    sampleRoadCurve(z, out = { x: 0, y: 0 }) {
        const t = Math.max(0, (200 - z) / 2700);
        const s = t * t;
        const ts = this.time * 0.075;
        out.x = (Math.sin(t * 2.5 + ts) * 260 + Math.sin(t * 1.2 + ts * 0.5) * 160
            + Math.cos(t * 1.8 + ts * 0.75) * 100) * s;
        out.y = Math.sin(t * 1.5 + ts * 0.33) * 30 * s;
        return out;
    }

    /** Seek every closed-form system to time t (pace 1, no events). Used by captures. */
    seek(t) {
        this.time = t;
        this.speed = TRAVEL_SPEED * worldSpeedFactor(1);
        this.travel = (t * this.speed) % TRAVEL_WRAP;
        this.moteTravel = (t * this.speed) % (TUNNEL_SPAN * 30);
        this.planets.forEach((p) => p.setSpinForTime(t));
        this.meteors?.clear();
        this.meteorTimer = 7;
        this.waveSlots.fill(null);
        this.pendingEvents.length = 0;
        this.waveCursor = 0;
        this.lastLockAt = -1e4;
        this.cometAt = -1e4;
        this.chainCometDone = false;
        this.cascade.birth = -1e4;
        this.cascade.amp = 0;
        Object.keys(this.fx).forEach((k) => { this.fx[k] = 0; });
        this.palette.ring = this.palette.ringTarget;
        this.palette.neb = this.palette.nebTarget;
        this.writeRingPalette();
        this.cam.lookX.x = 0;
        this.cam.lookX.v = 0;
        this.cam.bank.x = 0;
        this.cam.bank.v = 0;
        this.cam.paceFov = 0;
        this.applyComposition(true);
        this.stars?.triggerWave(-100, this.composition.result.sky.vpDir, 0);
    }

    // ── Event language: light bursting out of the board ──────────────────────

    /** Launch one wave `delay` seconds from now (closed form: it keeps its scheduled birth). */
    launchWave(preset, overrides = {}, delay = 0) {
        const p = { ...WAVE_PRESETS[preset], ...overrides };
        this.schedule(delay, () => this.writeWave(p, this.time));
    }

    schedule(delay, fn) {
        if (delay <= 0) fn();
        else this.pendingEvents.push({ at: this.time + delay, fn });
    }

    writeWave(p, birth) {
        const i = this.waveCursor;
        this.waveCursor = (this.waveCursor + 1) % this.waveSlots.length;
        this.waveSlots[i] = { ...p, z0: this.composition.result.zEntry - 40, birth };
    }

    /** A front sweeping the rings from where they emerge down to the lens. */
    launchCascade({
        amp = 1.0, speed = 2400, color = null, hueMix = 0,
    } = {}) {
        this.cascade.birth = this.time;
        this.cascade.amp = amp;
        const c = this.shared.uCascade.value;
        c.set(this.time, this.composition.result.dEmerge, speed, amp);
        const col = this.shared.uCascadeCol.value;
        if (color) col.set(color.r, color.g, color.b, hueMix);
        else col.set(1, 1, 1, 0);
    }

    onPieceLock() {
        if (this.time - this.lastLockAt < 0.35) return;
        this.lastLockAt = this.time;
        this.launchWave('lock');
        this.fx.railTick = 1;
    }

    /** Combo bands climb magenta → violet → blue → azure, one step per combo. */
    onCombo(combo) {
        const c = Math.max(1, combo);
        const hue = 1 / 6 + (1 / 4) * (Math.min(c - 1, 6) / 6);
        const amp = Math.min(0.3 + 0.06 * c, 0.7);
        this.launchWave('combo', { amp, hue });
        if (c >= 5) this.launchWave('combo', { amp, hue }, 0.09);
        if (c >= 3 && c % 3 === 0) {
            const count = 2 + (this.random() > 0.5 ? 1 : 0);
            for (let i = 0; i < count; i++) this.schedule(0.12 * i, () => this.spawnMeteor());
        }
        if (c >= 5 && !this.chainCometDone && this.time - this.cometAt > 20) {
            this.chainCometDone = true;
            this.cometAt = this.time;
            this.spawnComet();
        }
        // Every emitter restarts a chain at depth 2, so re-arm below the comet threshold.
        if (c < 5) this.chainCometDone = false;
    }

    onLineClear(lines) {
        const n = Math.max(1, Math.min(4, lines));
        if (n >= 4) {
            // Three staggered beats: bands out of the card, the ring cascade, the streak warp.
            for (let i = 0; i < 4; i++) this.launchWave('tetris', { white: 0.1 + i * 0.13 }, i * 0.05);
            this.schedule(0.15, () => this.launchCascade({ amp: 1.0, speed: 2400 }));
            this.schedule(0.3, () => { this.fx.streakWarp = 1; });
            this.fx.surge = 1;
            this.fx.dip = Math.max(this.fx.dip, 0.12);
            this.stars?.triggerWave(this.time, this.composition.result.sky.vpDir, 0.7);
            return;
        }
        for (let i = 0; i < n; i++) this.launchWave('clear', { amp: 0.4 + 0.1 * n }, i * 0.08);
        this.stars?.triggerWave(this.time, this.composition.result.sky.vpDir, 0.3 + 0.1 * n);
        this.fx.storm = Math.max(this.fx.storm, Math.min(0.35 + 0.15 * n, 0.8));
    }

    onLevelUp(level) {
        this.launchWave('levelUp');
        this.launchCascade({
            amp: 0.8, speed: 2000, color: spectrumColor(0.25, _color), hueMix: 0.7,
        });
        this.fx.flare = 1;
        this.fx.nebula = 1;
        this.fx.dip = Math.max(this.fx.dip, 0.08);
        this.stars?.triggerWave(this.time, this.composition.result.sky.vpDir, 0.5);
        const next = Number.isFinite(level) ? level : this.level + 1;
        this.schedule(0.5, () => this.setLevel(next));
    }

    // ── Meteors: rare, outward from behind the board, never across the planets ──

    /** Screen path check: clear of the card/HUD (+pad) and the planets. */
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

    spawnMeteor() {
        if (!this.meteors) return;
        const r = this.random;
        const comp = this.composition;
        const a = this.aspect;
        for (let attempt = 0; attempt < 6; attempt++) {
            const left = r() < 0.5;
            const u = left ? -a / 2 + 0.05 + r() * Math.max(0.01, a / 2 - 0.35) : 0.47 + r() * Math.max(0.01, a / 2 - 0.52);
            const v = left ? 0.05 + r() * 0.4 : 0.28 + r() * 0.18;
            const d = 1400 + r() * 1400;
            const life = 0.35 + r() * 0.25;
            const pxPerSec = 900 + r() * 500;
            const travelH = (pxPerSec * life) / 1080;
            // Radially outward from the vanishing point, ±25°, biased 10–25° downward.
            let ang = Math.atan2(v - 0.042, u) + (r() * 2 - 1) * THREE.MathUtils.degToRad(25);
            ang += (u < 0 ? 1 : -1) * THREE.MathUtils.degToRad(10 + r() * 15);
            const u2 = u + Math.cos(ang) * travelH;
            const v2 = v + Math.sin(ang) * travelH;
            if (!this.pathIsClear([[u, v], [(u + u2) / 2, (v + v2) / 2], [u2, v2]])) continue;
            comp.anchorToWorld(u, v, d, _v1);
            comp.anchorToWorld(u2, v2, d * (1 - 0.15 - r() * 0.15), _v2);
            _v3.subVectors(_v2, _v1).divideScalar(life);
            this.meteors.spawn({
                start: _v1, velocity: _v3, life, widthPx: 1.6 + r() * 0.8, value: 1.6 + r() * 0.9, time: this.time,
            });
            return;
        }
    }

    /** A slow comet grazing OUTSIDE the hero's lit limb, on the card side (dust + ion tail). */
    spawnComet() {
        if (!this.meteors) return;
        const comp = this.composition;
        const hero = comp.result.hero.anchor;
        const heroRH = comp.result.hero.radius / (2 * comp.tanHalf * 3600);
        const side = hero.u < 0 ? 1 : -1; // the lit limb faces the board
        const u = hero.u + side * heroRH * 1.55;
        const v = hero.v + heroRH * 1.8;
        const u2 = hero.u + side * heroRH * 1.12;
        const v2 = hero.v - heroRH * 1.5;
        const life = 2.5;
        comp.anchorToWorld(u, v, 3000, _v1);
        comp.anchorToWorld(u2, v2, 2900, _v2);
        _v3.subVectors(_v2, _v1).divideScalar(life);
        this.meteors.spawn({
            start: _v1, velocity: _v3, life, widthPx: 5, value: 2.2, time: this.time,
        });
        comp.anchorToWorld(u2 + side * 0.05, v2 - 0.02, 2900, _v2);
        _v3.subVectors(_v2, _v1).divideScalar(life);
        this.meteors.spawn({
            start: _v1, velocity: _v3, life, widthPx: 1.6, value: 3.2, time: this.time,
        });
    }

    // ── Per-frame update ─────────────────────────────────────────────────────

    /** Resolve the wave slots on the CPU (+ governor) into the per-fragment uniforms. */
    updateWaves(sim) {
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
        // Governor: bands are local (they never lift the whole frame), so only a pile-up of
        // simultaneous events is scaled back.
        E += 0.5 * (sim.ring ?? 0) + 0.3 * (sim.pulse ?? 0);
        const govern = E > 3 ? 3 / E : 1;
        const cAge = this.time - this.cascade.birth;
        this.governor = govern;
        const col = this._waveCol || (this._waveCol = { r: 0, g: 0, b: 0 });
        for (let i = 0; i < this.waveSlots.length; i++) {
            const w = this.waveSlots[i];
            if (!w) {
                uA.array[i].set(0, 1, 0, 0);
                continue;
            }
            spectrumRGB(Math.max(0, w.hue), col);
            uA.array[i].set(w.zFront, 1 / Math.max(1, w.width), w.energy * govern, w.hue < 0 ? 1 : 0);
            uB.array[i].set(col.r, col.g, col.b, w.white);
        }
        this.shared.uCascade.value.w = cAge >= 0 && cAge < 3 ? this.cascade.amp * Math.exp(-cAge / 0.8) : 0;
        return govern;
    }

    /**
     * Per-frame update. Call AFTER updateCamera() (planets read the camera matrices).
     * @param {object} sim  { time, delta, pace, pulse, ring, particle, ambient }
     * @param {THREE.Camera} camera
     */
    update(sim, camera) {
        const delta = sim.delta ?? 0;
        this.time = sim.time;
        // One world speed, eased (τ 1.2 s).
        const targetSpeed = TRAVEL_SPEED * worldSpeedFactor(sim.pace ?? 1);
        this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-delta / 1.2));
        this.travel = (this.travel + delta * this.speed) % TRAVEL_WRAP;
        // Motes ride their own clock: the ambient envelope scales their SPEED, never a phase.
        this.moteTravel = (this.moteTravel + delta * this.speed * (1 + 0.5 * (sim.ambient ?? 0))) % (TUNNEL_SPAN * 30);

        if (this.pendingEvents.length) {
            for (let i = this.pendingEvents.length - 1; i >= 0; i--) {
                const e = this.pendingEvents[i];
                if (this.time >= e.at) {
                    this.pendingEvents.splice(i, 1);
                    const saved = this.time;
                    this.time = e.at; // keep the scheduled birth (closed form)
                    e.fn();
                    this.time = saved;
                }
            }
        }

        // Event envelopes (exponential decays).
        const { fx } = this;
        _decay(fx, 'dip', 0.3, delta);
        _decay(fx, 'surge', 0.55, delta);
        _decay(fx, 'flare', 0.4, delta);
        _decay(fx, 'storm', 0.45, delta);
        _decay(fx, 'railTick', 0.08, delta);
        _decay(fx, 'nebula', 0.5, delta);
        if (fx.streakWarp > 0) fx.streakWarp = Math.max(0, fx.streakWarp - delta / 0.8);

        // Level palette eases over ~3 s, the short way round the colour wheel.
        const ease = 1 - Math.exp(-delta / 1.0);
        let dRing = this.palette.ringTarget - this.palette.ring;
        dRing -= Math.round(dRing);
        if (Math.abs(dRing) > 1e-4) {
            this.palette.ring += dRing * ease;
            this.palette.ring -= Math.floor(this.palette.ring);
            this.writeRingPalette();
        }
        this.palette.neb += (this.palette.nebTarget - this.palette.neb) * ease;

        const govern = this.updateWaves(sim);
        const { shared } = this;
        shared.uTime.value = this.time;
        shared.uTravel.value = this.travel;
        shared.uMoteTravel.value = this.moteTravel;
        shared.uPulse.value = (sim.pulse ?? 0) * govern;
        shared.uPace.value = sim.pace ?? 1;
        shared.uRingEnv.value = (sim.ring ?? 0) * govern;
        shared.uRailTick.value = fx.railTick;
        shared.uMoteGain.value = 1 + 0.5 * (sim.ambient ?? 0);
        const pace = sim.pace ?? 1;
        shared.uStreakLength.value = (40 + 60 * Math.max(pace - 1, 0)) * (1 + 0.8 * (sim.particle ?? 0))
            * (1 + 2 * fx.streakWarp);
        shared.uStreakDensity.value = 0.6 + 0.4 * Math.min(1, sim.particle ?? 0);

        // Sky + stars.
        this.sky.uniforms.uTime.value = this.time;
        this.sky.uniforms.uNebBreath.value = 0.1 * (sim.ambient ?? 0) + 0.2 * fx.nebula;
        this.sky.setHueShift(this.palette.neb);
        this.stars.uniforms.uTime.value = this.time;
        this.stars.uniforms.uBinaryFlare.value = fx.flare;

        this.updateBodies(camera, delta);

        // Meteors: an idle one every 5–10 s, at most 2 alive.
        const alive = this.meteors.update(this.time);
        this.meteorTimer -= delta;
        if (this.meteorTimer <= 0) {
            if (alive < 2) this.spawnMeteor();
            this.meteorTimer = 5 + this.random() * 5;
        }
    }

    /** Ease the solved anchors, then place and light every body. */
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
        const Hs = 2 * comp.tanHalf; // world units per H at unit depth

        // Hero: slow drift (±0.025 H in u over 240 s, ±0.015 H in v over 170 s).
        const { hero } = this;
        hero.mesh.position.set(
            A.hero.x + Math.sin((t * Math.PI * 2) / 240) * 0.025 * Hs * 3600,
            A.hero.y + Math.sin((t * Math.PI * 2) / 170 + 1.3) * 0.015 * Hs * 3600,
            A.hero.z,
        );
        hero.setRadius(A.heroR);
        hero.uniforms.uTime.value = t;
        hero.uniforms.uFlash.value = this.fx.storm * (Math.sin(t * 37.0) * Math.sin(t * 23.0) > 0.35 ? 1 : 0.15);
        // The binary is a distant star: its light arrives as a direction (L2), the same for
        // every body.
        const fill = this._binaryFar || (this._binaryFar = new THREE.Vector3());
        fill.copy(res.binary.direction).multiplyScalar(1e7);

        if (this.moon) {
            // Closed-form orbit, a circle tilted 14 deg, in the hero's line-of-sight frame (T from the
            // hero toward the rest eye): depth only changes the moon's size, never its screen
            // position, so the transit at t = 40, 136, ... crosses the disc; |offset| = 1.185 R
            // keeps the moon outside the hero.
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
            // Draw order by depth, with ±50 u of hysteresis.
            const dm = this.moon.mesh.position.distanceTo(camera.position);
            const dh = hero.mesh.position.distanceTo(camera.position);
            if (this.moon.mesh.renderOrder < hero.mesh.renderOrder && dm < dh - 50) this.moon.mesh.renderOrder = -60;
            else if (this.moon.mesh.renderOrder > hero.mesh.renderOrder && dm > dh + 50) this.moon.mesh.renderOrder = -70;
            // Transit shadow on the hero and the eclipse on the moon (in body radii).
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
        for (const planet of this.planets) {
            planet.setSpinForTime(t); // closed form in the world clock, live and seeked alike
            const rPx = planet.update(camera, KEY_LIGHT, fill, this.viewport.height);
            if (planet === hero) heroPx = rPx;
        }

        // The hero's screen circle (drawing-buffer px) for the rings'/streaks' hero mask.
        _proj.copy(hero.mesh.position).project(camera);
        const { width: W, height: H } = this.viewport;
        this.shared.uHeroPx.value.set((_proj.x * 0.5 + 0.5) * W, (0.5 - _proj.y * 0.5) * H, heroPx);
    }

    /**
     * Camera rig: the rest pose (60° Hor+ lens), a slow closed-form float, pointer parallax,
     * a damped look-ahead into the road curve and a gentle bank. FOV widens with pace (Medium+)
     * and surges on a Tetris. Refreshes the pixel-scale uniforms when the FOV changes.
     * @param {THREE.PerspectiveCamera} camera
     * @param {{ time: number, delta?: number, pace?: number, pointerX?: number, pointerY?: number }} sim
     */
    updateCamera(camera, sim) {
        const t = sim.time;
        const dt = sim.delta ?? 0;
        this.time = t;
        const rest = REST_RIG.position;
        const pointer = this.capture ? 0 : 1;
        const px = (sim.pointerX ?? 0) * 9.7 * pointer;
        const py = -(sim.pointerY ?? 0) * 5.5 * pointer;
        camera.position.set(
            rest.x + Math.sin(t * 0.13) * 2.2 + Math.sin(t * 0.41) * 0.5 + px,
            rest.y + Math.sin(t * 0.17) * 1.5 + Math.sin(t * 0.53) * 0.4 + py,
            rest.z + Math.sin(t * 0.09) * 2.5,
        );
        const ahead = this.sampleRoadCurve(-1500, _camAhead);
        const near = this.sampleRoadCurve(-800, _camNear);
        const slope = (ahead.x - near.x) / 700;
        const lookTarget = 0.2 * ahead.x;
        const bankTarget = THREE.MathUtils.clamp(slope * 0.18, -0.021, 0.021);
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

        // Lens: Hor+ base + pace widening (Medium+) + the Tetris surge.
        let fov = restVerticalFov(camera.aspect || this.aspect);
        if (this.tier.paceFov) {
            const paceTarget = 2.5 * THREE.MathUtils.smoothstep(sim.pace ?? 1, 1.0, 2.2);
            this.cam.paceFov += (paceTarget - this.cam.paceFov) * (dt > 0 ? 1 - Math.exp(-dt / 1.5) : 1);
            fov += this.cam.paceFov + 1.6 * this.fx.surge;
        }
        if (Math.abs(fov - camera.fov) > 0.01) {
            camera.fov = fov;
            camera.updateProjectionMatrix();
            this.setViewport(this.viewport.height, camera, this.viewport.width, this.viewport.cssHeight);
        }
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
