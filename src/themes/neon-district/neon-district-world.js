/**
 * Neon District — the world.
 *
 * Owns the plan, the shared uniforms, every scene part, the camera rig and the choreography.
 * Shared by the theme (neon-district-theme.js) and the playground effect
 * (src/playground/effects/neon-district.effect.js), so what is iterated there ships.
 *
 * The district is a circuit and the board is its power source:
 *
 *   lock     the piece lands in the street under the board: rings run out through the puddles in
 *            the piece's colour, bending the reflections, and a shell of light climbs the walls,
 *            switching dark windows on as it passes. A hard drop hits harder.
 *   clear    a wave bursts out of the vanishing point behind the board and rushes up the street
 *            at the viewer, one front per cleared line: every sign flares as a front reaches it,
 *            the windows it passes stay lit a moment, the canyon's rays flood.
 *   combo    the district charges: more windows lit, neon trim climbing the towers like level
 *            meters, the city flowing past faster, the palette warming from cyan and rose to gold.
 *   four     blackout — every light in the district drops to a ghost for a fifth of a second —
 *            then the wave comes back gold, the smog sheets with lightning, and the district
 *            stays in overdrive while it cools. The hotter play already runs, the shallower that
 *            breath: a quad mid-fever dims the district, it does not black it out.
 *
 * It BUILDS (src/themes/shared/gameplay-surge.js). Every answer adds to what is still lit
 * instead of restarting: kicks, flashes, arrivals, the storm and the rays' flood are swells;
 * clear waves and lock pulses take the slot with the least light left, so a cascade's waves
 * stack up the street (sharing its light, so the stack never paints the canyon); every wave of a
 * cascade burns more golden, with more fronts, sparks and lightning than the one before; a
 * back-to-back comes gilded, with the cinema flares stretched across the street. And the district
 * remembers how hot play runs: the charge holds between chains, the city flows faster, and play
 * that stays quick brings the storm in over the canyon — the drizzle thickens into a downpour
 * leaning in the wind, the puddles boil, the walls stream, sheet lightning walks through the
 * smog — until a perfect clear breaks it: the rain lets up, the glass wipes clear, the dragon
 * burns white-gold.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame. Speeds that change are
 * integrated (the rain's, the traffic's and the kerb chase's clocks), never multiplied into the
 * clock, so a change of pace never makes anything jump.
 *
 * Layers: 0 = everything the wet street mirrors; 1 = what only the camera sees (rain, effects).
 */

import * as THREE from 'three/webgpu';
import { texture, uniform } from 'three/tsl';
import {
    CLEAR_AFTERGLOW,
    CLEAR_DEPTH,
    CLEAR_FRONT_GAP,
    CLEAR_FRONT_WIDTH,
    CLEAR_SHAPE,
    CLEAR_SLOTS,
    CLEAR_TRAVEL,
    LOCK_SLOTS,
    STREET,
    approach,
    clamp01,
    createDistrictUniforms,
    createGlowTexture,
    createNoiseTexture,
    linRGB,
    smooth,
} from './neon-district-tsl.js';
import { GLOW_TEXELS, TEXT_WIDTH, buildLayout } from './neon-district-layout.js';
import { tierFor } from './neon-district-quality.js';
import { createFacades } from './neon-district-facades.js';
import { createSky } from './neon-district-sky.js';
import { createStreet } from './neon-district-street.js';
import {
    createGlyphTexture, createLogoTexture, createMarks, createPlaceholderTexture, createScreens, createSigns, logoBinding,
} from './neon-district-signs.js';
import { createPrints } from './neon-district-prints.js';
import { createGeneratedShops, createPaintedShops } from './neon-district-shops.js';
import { createTextTexture } from './neon-district-text.js';
import { BILLBOARD_ATLAS, SHOPFRONT_ATLAS } from './neon-district-atlas.js';
import { createRain, createSteam } from './neon-district-weather.js';
import {
    createBeacons, createCables, createHalos, createLamps, createLanterns, createTraffic,
} from './neon-district-lights.js';
import { createKit } from './neon-district-kit.js';
import {
    DRAGON_FLIGHT, DRAGON_LANE, DRAGON_OVERHEAD, createCounter, createDragon, createRowBeams, createSparks, kerbSparkDepth,
} from './neon-district-fx.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from './neon-district-composition.js';
import { applyCameraBreath, breathFill } from '../shared/camera-breath.js';
import { GameplaySurge, Swell } from '../shared/gameplay-surge.js';
import { readBreathSignal } from '../../core/breath-signal.js';
import { flashScale } from '../../utils/photosensitivity.js';

const DEG = Math.PI / 180;

/** The rest camera: on the street's centre line, a little above head height, looking up the canyon. */
export const REST_RIG = Object.freeze({
    height: 3.0,
    pitch: 8 * DEG,
    /** Horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 90,
    minFov: 50,
    maxFov: 84,
    near: 0.3,
    far: 1500,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/** Metres per second the city flows at rest, and what a full charge adds. */
export const CRUISE_SPEED = 0.85;
export const CRUISE_BOOST = 2.2;

/** The scroll is rebased by this many metres (a whole number of periods) when it grows past it. */
export const SCROLL_REBASE = STREET.period * 8;

/** The district's charge for a combo of n (0 at rest, → 1). */
export function powerForCombo(combo) {
    return combo > 0 ? 1 - Math.exp(-combo / 3.4) : 0;
}

/** Seconds a four-line clear holds the district dark before the wave returns. */
export const BLACKOUT_HOLD = 0.2;
/** Seconds the overdrive after a four-line clear takes to cool to 1/e. */
export const OVERDRIVE_COOL = 2.6;
/** Back-to-back quads (and the crown on a perfect clear) stack the overdrive up to here. */
export const OVERDRIVE_CAP = 1.8;
/** How bright a dragon may burn once quads and crowns have fed it in flight. */
const DRAGON_STRENGTH_CAP = 1.7;

/** A wave's kick lands as it reaches the camera (CLEAR_TRAVEL after it leaves). */
const ARRIVE_AT = CLEAR_TRAVEL * 0.93;
/**
 * The rays' flood as a wave fills the near street: an envelope that rises over FLOOD_ATTACK and
 * falls over FLOOD_RELEASE, hit FLOOD_LEAD before it should peak (CLEAR_TRAVEL × 0.8 after the
 * wave leaves).
 */
const FLOOD_ATTACK = 0.12;
const FLOOD_RELEASE = 0.25;
const FLOOD_PEAK = CLEAR_TRAVEL * 0.8;
const FLOOD_LEAD = Math.log(FLOOD_RELEASE / FLOOD_ATTACK) / (1 / FLOOD_ATTACK - 1 / FLOOD_RELEASE);
/** Sheet lightning in a fever: at most this many strokes a second (never a strobe). */
const STROKE_RATE = 0.45;

/**
 * District palettes, one per level (cycled): the two accents the sky and the waves use, and the
 * mist at street level / the smog above (all scene-linear).
 */
export const DISTRICT_PALETTES = Object.freeze([
    {
        name: 'signal', a: 0x22e4ff, b: 0xff2d86, low: [0.085, 0.028, 0.11], high: [0.012, 0.012, 0.036],
    },
    {
        name: 'harbour', a: 0x3b8bff, b: 0xffa53a, low: [0.03, 0.05, 0.13], high: [0.008, 0.014, 0.04],
    },
    {
        name: 'arcade', a: 0x4dffb0, b: 0x9b5cff, low: [0.022, 0.08, 0.09], high: [0.008, 0.018, 0.032],
    },
    {
        name: 'lantern', a: 0xff5a7a, b: 0xffc04a, low: [0.12, 0.032, 0.06], high: [0.022, 0.01, 0.03],
    },
    {
        name: 'ultraviolet', a: 0x9b5cff, b: 0x22e4ff, low: [0.06, 0.03, 0.14], high: [0.014, 0.01, 0.042],
    },
]);

const GOLD = Object.freeze([1.0, 0.72, 0.22]);
/** What the wave a perfect clear crowns burns toward. */
const WHITE_GOLD = Object.freeze([1.0, 0.88, 0.64]);
const HOT_MIST = Object.freeze([0.085, 0.036, 0.014]);

/** Blend `rgb` (in place) toward `target` by `k`. */
function mixInto(rgb, target, k) {
    for (let c = 0; c < 3; c++) rgb[c] += (target[c] - rgb[c]) * k;
    return rgb;
}

const PARTS = [
    'sky', 'mega', 'facades', 'street', 'shopfronts', 'shops', 'signs', 'marks', 'screens', 'prints', 'lamps', 'cables', 'lanterns',
    'halos', 'cones', 'beacons', 'traffic', 'sparks', 'counter', 'dragon', 'steam', 'rain', 'beams',
];

/** Seconds the shopfronts and screens take to power up once their atlas has arrived. */
const POWER_UP = 1.4;

/** A piece colour (CSS hex string or number) as a scene-linear, peak-normalised [r, g, b]. */
export function pieceColor(value, fallback = 0x22e4ff) {
    let hex = fallback;
    if (typeof value === 'number' && Number.isFinite(value)) hex = value;
    else if (typeof value === 'string') {
        const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
        if (m) hex = Number.parseInt(m[1], 16);
    }
    const rgb = linRGB(hex);
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
    // Keep a floor in every channel: a pure primary would vanish in one of the bloom's channels.
    return rgb.map((c) => (c / peak) * 0.94 + 0.06);
}

export class NeonDistrictWorld {
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
        this.plan = buildLayout(seed);
        this.root = new THREE.Group();
        this.root.name = 'NeonDistrict';
        this.parts = {};
        this.disposables = [];
        this.textures = [];
        this.u = null;
        this.reflection = null;
        this.atlases = null;
        this.atlasFade = [0, 0];
        this.atlasReady = [false, false];
        this.sparks = null;
        this.beams = null;
        this.counter = null;
        this.dragon = null;
        this.disposed = false;
        this.reducedMotion = false;
        this.aspect = 16 / 9;
        this.layout = fallbackLayout(1600, 900);
        this.layoutLive = false;
        this.heart = { x: 0.5, y: 0.62 };
        this._camera = null;
        this._look = new THREE.Vector3();
        this._ray = new THREE.Vector3();
        this._point = { x: 0.5, y: 0.5 };
        this._strike = { x: 0, z: -8 };
        this._palette = {
            a: linRGB(DISTRICT_PALETTES[0].a), b: linRGB(DISTRICT_PALETTES[0].b), low: [...DISTRICT_PALETTES[0].low], high: [...DISTRICT_PALETTES[0].high],
        };
        this._post = {
            heart: this.heart,
            flash: 0,
            kick: 0,
            rays: 0.3,
            streak: 1,
            bloomBoost: 0,
            exposure: 1,
            rainTime: 0,
            glassMist: 1,
        };
        this._rgb = [0, 0, 0];
        this._surgeClear = {
            lines: 1, cascade: 1, combo: 1, tspin: false, perfect: false, b2b: false,
        };
        this._lock = { hardDrop: false };

        // ── What accumulates (src/themes/shared/swell.js): every hit adds to what is still lit ──
        /** How hot play runs: level (0..1), fever (the slow tide), punch, and the act (0..3). */
        this.surge = new GameplaySurge();
        this.play = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        /** The camera's kick and the post flash, from locks, quads, level-ups. */
        this.kickHits = new Swell({ release: 0.16, ceiling: 1, knee: 0.6 });
        this.flashHits = new Swell({ release: 0.25, ceiling: 0.6, knee: 0.35 });
        /** ... and from every wave as it reaches the camera (scheduled, so they add up). */
        this.arriveKick = new Swell({ release: 0.16, ceiling: 1.2, knee: 0.8 });
        this.arriveFlash = new Swell({ release: 0.25, ceiling: 0.7, knee: 0.45 });
        /** The canyon's rays flooding as each wave fills the near street. */
        // A low ceiling, a pulse no wider than a wave's arrival: a fast chain's floods ride a
        // plateau, they must not stack into a veil (the rays drag the bloom over the frame).
        this.flood = new Swell({
            attack: FLOOD_ATTACK, release: FLOOD_RELEASE, ceiling: 1, knee: 0.6,
        });
        /** Sheet lightning a quad, a triple, a cascade or a level-up sets off in the smog. */
        this.stormHits = new Swell({ release: 0.9, ceiling: 1.2, knee: 0.85 });
        /** The fever's own strokes: soft-edged, a couple of seconds apart. */
        this.strokes = new Swell({
            attack: 0.04, release: 0.28, ceiling: 0.6, knee: 0.4,
        });
        /** A back-to-back stretches the cinema flares across the street. */
        this.flare = new Swell({ release: 0.9, ceiling: 1.2, knee: 0.8 });
        /** A T-spin turns the circuit over: the kerb lights race. */
        this.spinHits = new Swell({ release: 0.45, ceiling: 1.5, knee: 1 });
        /** A perfect clear's crown: the storm breaks, the rain lets up, the glass wipes clear. */
        this.crown = new Swell({
            attack: 0.3, release: 4.5, ceiling: 1, knee: 0.85,
        });
        this.resetState(0);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.scroll = (time * CRUISE_SPEED) % SCROLL_REBASE;
        this.combo = 0;
        this.power = 0;
        this.charge = 0;
        this.heat = 0;
        this.overdrive = 0;
        this.level = 1;
        this.paletteIndex = 0;
        this.flash = 0;
        this.kick = 0;
        this.glitch = 0;
        this.storm = 0;
        this.dip = 0;
        this.blackoutUntil = -1;
        this.blackoutDepth = 1;
        this.b2bChain = 0;
        this.lastWave = 0;
        this.clearGlow = 0;
        this.downpour = 0;
        this.thunderPhase = 0.5;
        // The integrated clocks start where the plain clock would have them.
        this.rainClock = time;
        this.trafficClock = time;
        this.chasePhase = (time * 0.22) % 1;
        this.counts = {
            locks: 0, clears: 0, quads: 0, perfects: 0, spins: 0,
        };
        this.lastAnchor = -100;
        this.counterShown = 0;
        this.counterPunch = 0;
        this.counterValue = 0;
        this.dragonUntil = -1;
        this.dragonNext = Infinity;
        this.surge.reset();
        this.play.punch = 0;
        this.play.level = 0;
        this.play.fever = 0;
        this.play.stage = 0;
        this.kickHits.reset();
        this.flashHits.reset();
        this.arriveKick.reset();
        this.arriveFlash.reset();
        this.flood.reset();
        this.stormHits.reset();
        this.strokes.reset();
        this.flare.reset();
        this.spinHits.reset();
        this.crown.reset();
        this.sparks?.reset();
        this.beams?.reset();
        this.dragon?.reset();
        if (this.u) {
            for (let i = 0; i < LOCK_SLOTS; i++) this.u.lockA[i].value.set(0, 0, -100, 0);
            for (let i = 0; i < CLEAR_SLOTS; i++) this.u.clearA[i].value.set(-100, 1, 0, 0);
        }
    }

    build() {
        const noise = createNoiseTexture();
        const glow = createGlowTexture(this.plan.glow, GLOW_TEXELS);
        this.textures.push(noise, glow);
        const u = createDistrictUniforms({ noise, glow });
        this.u = u;
        const { tier, plan } = this;

        this.addPart('sky', createSky(u));
        this.addPart('mega', createFacades(u, plan.megaBoxes, { scroll: false, rooms: false, name: 'NeonDistrictMegatowers' }));
        this.addPart('facades', createFacades(u, plan.boxes, { scroll: true, rooms: tier.rooms, name: 'NeonDistrictFacades' }));

        const street = createStreet(u, {
            reflectionScale: tier.reflection,
            reflectionTaps: tier.reflectionTaps,
            rainRings: tier.rainRings,
        });
        this.addPart('street', street);
        if (street.reflectorTarget) this.root.add(street.reflectorTarget);
        this.reflection = street.reflection;

        // ── Everything that advertises ──
        const glyphs = createGlyphTexture();
        const blank = createPlaceholderTexture();
        const lines = createTextTexture(plan.texts, TEXT_WIDTH);
        const logoTex = createLogoTexture();
        const logos = logoBinding(logoTex);
        this.textures.push(glyphs, blank, lines, logoTex);
        this.atlases = {
            shop: texture(blank), shopFade: uniform(0), ads: texture(blank), adsFade: uniform(0),
        };
        this.addPart('shopfronts', createPaintedShops(u, plan.shops.filter((s) => s.kind === 0), this.atlases.shop, this.atlases.shopFade));
        this.addPart('shops', createGeneratedShops(u, plan.shops.filter((s) => s.kind === 1), {
            glyphTex: glyphs, textTex: lines, textRows: plan.texts.length, rooms: tier.rooms, logos,
        }));
        this.addPart('signs', createSigns(u, plan.signs, glyphs));
        this.addPart('marks', createMarks(u, plan.marks, {
            glyphTex: glyphs, textTex: lines, textRows: plan.texts.length, logos,
        }));
        this.addPart('screens', createScreens(u, plan.screens, this.atlases.ads, this.atlases.adsFade, {
            glyphTex: glyphs, textTex: lines, textRows: plan.texts.length,
        }));
        this.addPart('prints', createPrints(u, plan.prints, this.atlases.ads, this.atlases.adsFade));

        // ── The street's hardware ──
        createKit(u, plan.kit).parts.forEach((part) => this.addPart(part.name, part));

        // ── What hangs between the buildings, and the small lights ──
        const lamps = createLamps(u, plan.lamps);
        this.addPart('lamps', lamps.posts);
        this.addPart('cables', createCables(u, plan.cables));
        this.addPart('lanterns', createLanterns(u, plan.lanterns));
        if (tier.halos) {
            this.addPart('halos', createHalos(u, plan));
            this.addPart('cones', lamps.cones, { reflected: false });
        } else {
            this.disposables.push(lamps.cones);
        }
        this.addPart('beacons', createBeacons(u, plan.beacons));
        this.addPart('traffic', createTraffic(u, tier.traffic));

        // ── Gameplay effects (pools, always drawn) ──
        this.sparks = createSparks(u, tier.sparks);
        this.addPart('sparks', this.sparks);
        this.counter = createCounter(u, glyphs);
        this.addPart('counter', this.counter);
        this.dragon = tier.drones > 0 ? createDragon(u, tier.drones) : null;
        if (this.dragon) this.addPart('dragon', this.dragon);

        // ── Weather and the row beams (the mirror does not render them) ──
        if (tier.steam > 0) this.addPart('steam', createSteam(u, plan.vents, tier.steam), { reflected: false });
        this.addPart('rain', createRain(u, tier.rain), { reflected: false });
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

    /**
     * Fetch the shopfront and billboard atlases. Never awaited by the first frame: the district
     * stands dark where they go and powers up when they arrive.
     * @returns {Promise<boolean>} true when both atlases are in
     */
    loadTextures() {
        const half = this.quality === 'Minimal' || this.quality === 'Low';
        const loader = new THREE.TextureLoader();
        const load = (url, slot, node) => new Promise((resolve) => {
            const arrived = (tex) => {
                if (this.disposed) {
                    tex.dispose();
                    resolve(false);
                    return;
                }
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.anisotropy = half ? 2 : 8;
                tex.generateMipmaps = true;
                tex.minFilter = THREE.LinearMipmapLinearFilter;
                tex.name = `neon-district-atlas-${slot}`;
                this.textures.push(tex);
                node.value = tex;
                this.atlasReady[slot] = true;
                resolve(true);
            };
            try {
                loader.load(url, arrived, undefined, () => resolve(false));
            } catch {
                resolve(false); // no image decoding here (a headless host): the atlas stays dark
            }
        });
        return Promise.all([
            load(half ? SHOPFRONT_ATLAS.halfUrl : SHOPFRONT_ATLAS.url, 0, this.atlases.shop),
            load(half ? BILLBOARD_ATLAS.halfUrl : BILLBOARD_ATLAS.url, 1, this.atlases.ads),
        ]).then((done) => done.every(Boolean));
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

    /** A new run: the district back at rest (the city keeps flowing). */
    resetSession() {
        const {
            time, scroll, rainClock, trafficClock, chasePhase,
        } = this;
        this.resetState(time);
        // The rain, the traffic and the kerb lights carry on where they were.
        this.scroll = scroll;
        this.rainClock = rainClock;
        this.trafficClock = trafficClock;
        this.chasePhase = chasePhase;
        this.applyPalette(1);
    }

    /**
     * The camera sees layer 1 (rain, effects); the street's mirror must not. Called once the
     * camera that will render the world is known.
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
        // The view leans into the street as play heats (about a degree and a half in a fever).
        const lean = (this.play.level * 0.9 + this.play.fever * 0.6) * calm;
        const fov = fovForAspect(this.aspect) - this.kick * 0.9 * calm - lean;
        if (Math.abs(camera.fov - fov) > 1e-3 || camera.near !== REST_RIG.near || camera.far !== REST_RIG.far) {
            camera.fov = fov;
            camera.near = REST_RIG.near;
            camera.far = REST_RIG.far;
            camera.updateProjectionMatrix();
        }
        // A slow handheld drift, plus the pointer leaning the view.
        const swayX = (Math.sin(t * 0.21) * 0.34 + Math.sin(t * 0.097 + 1.3) * 0.22) * calm;
        const swayY = (Math.sin(t * 0.33 + 0.7) * 0.05 + Math.sin(t * 0.151) * 0.04) * calm;
        const px = (sim.pointerX || 0) * calm;
        const py = (sim.pointerY || 0) * calm;
        camera.position.set(swayX + px * 0.7, REST_RIG.height + swayY - py * 0.22 - this.kick * 0.07 * calm, 0);
        const yaw = (Math.sin(t * 0.13 + 2.1) * 0.012 - px * 0.03) * calm;
        const pitch = REST_RIG.pitch + (Math.sin(t * 0.17) * 0.006 - py * 0.018) * calm;
        this._look.set(
            camera.position.x + Math.sin(yaw) * 10,
            camera.position.y + Math.tan(pitch) * 10,
            -10,
        );
        camera.up.set(Math.sin(t * 0.11) * 0.006 * calm, 1, 0);
        camera.lookAt(this._look);
        // The shared breath (shared/camera-breath.js) on top of the drift above, turning the
        // view only (an eye-level look down the street): off under reduced motion.
        applyCameraBreath(camera, t, { scale: this.reducedMotion ? 0 : 1 });
        camera.updateMatrixWorld();
        this._camera = camera;
        // The street's vanishing point on screen: where the rays and the waves come from.
        this._ray.set(camera.position.x, camera.position.y, -4000).project(camera);
        this.heart.x = clamp01(this._ray.x * 0.5 + 0.5);
        this.heart.y = clamp01(0.5 - this._ray.y * 0.5);
    }

    /**
     * Where a ray through a screen point (fractions, y down) meets the street. Points above the
     * horizon (or absurdly far) land `far` metres ahead instead.
     */
    screenToStreet(sx, sy, out = this._strike, far = 9) {
        const camera = this._camera;
        if (!camera) {
            out.x = 0;
            out.z = -far;
            return out;
        }
        this._ray.set(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(camera).sub(camera.position);
        const t = this._ray.y < -1e-4 ? -camera.position.y / this._ray.y : Infinity;
        const dist = Math.hypot(this._ray.x, this._ray.z) * t;
        if (!Number.isFinite(dist) || dist > 60) {
            const flat = Math.hypot(this._ray.x, this._ray.z) || 1;
            out.x = camera.position.x + (this._ray.x / flat) * far;
            out.z = camera.position.z + (this._ray.z / flat) * far;
            return out;
        }
        out.x = camera.position.x + this._ray.x * t;
        out.z = camera.position.z + this._ray.z * t;
        return out;
    }

    // ── Gameplay ────────────────────────────────────────────────────────────────

    /**
     * A piece locked. `u` = its column as a fraction of the board width, `color` = the piece's
     * colour; `screen` (fractions) replaces the board point. Wherever on the board it locked, it
     * lands in the street under the board's foot: that is where the street is.
     */
    onLock({
        u = 0.5, hardDrop = false, color = null, player = 0, screen = null,
    } = {}) {
        const { u: uniforms } = this;
        if (!uniforms) return;
        let sx = 0.5;
        let sy = 0.93;
        if (screen) {
            sx = screen.x;
            sy = Math.max(screen.y, this.heart.y + 0.12);
        } else {
            const board = boardFor(this.layout, player);
            if (board) {
                // The piece lands in the street under the foot of the board.
                boardPoint(board, u, 19, this._point);
                sx = this._point.x;
                sy = Math.max(board.y1, this.heart.y + 0.1);
            }
        }
        const strike = this.screenToStreet(sx, sy);
        const t = this.time;
        // How hot play runs as it lands: a quick hand's pieces land heavier, wider and brighter.
        const pace = this.surge.level.valueAt(t);
        const slot = this.pickLockSlot(t);
        const rgb = pieceColor(color, DISTRICT_PALETTES[this.paletteIndex].a);
        const strength = (hardDrop ? 1.3 : 0.8) * (1 + 0.2 * pace);
        uniforms.lockA[slot].value.set(strike.x, strike.z - this.scroll, t, strength);
        this.lastAnchor = t;
        uniforms.lockC[slot].value.set(rgb[0] * 1.5, rgb[1] * 1.5, rgb[2] * 1.5);
        // Every landing adds to the kick and the flash still running instead of restarting them.
        this.kickHits.hit(hardDrop ? 0.32 + 0.28 * pace : 0.12, t);
        this.flashHits.hit(hardDrop ? 0.1 : 0.03, t);
        this.refreshHits(t);
        this._lock.hardDrop = hardDrop === true;
        this.surge.lock(this._lock, t);
        // Sparks skid out across the wet street from where it landed.
        const share = (this.sparks.count / 512) * (1 + 0.6 * pace);
        this.sparks.emit({
            x: strike.x,
            z: strike.z,
            n: Math.round((hardDrop ? 40 : 20) * share),
            rgb,
            time: this.time,
            scroll: this.scroll,
            spread: hardDrop ? [5, 17] : [3.5, 11],
            up: hardDrop ? [1.5, 6] : [1, 3.6],
            life: hardDrop ? [0.6, 1.3] : [0.45, 0.95],
            size: hardDrop ? 0.045 : 0.034,
        });
        this.counts.locks += 1;
    }

    /**
     * Lines cleared. `lines` 1..4; `combo` = the true consecutive-clear combo; `cascade` = which
     * wave of its lock this is (1 = the first); `tspin`, `perfect`, `b2b`.
     */
    onClear({
        rows = null, lines = 1, combo = 1, cascade = 1, tspin = false, perfect = false, b2b = false, player = 0,
    } = {}) {
        const { u: uniforms } = this;
        if (!uniforms) return;
        const t = this.time;
        const n = Math.max(1, Math.min(4, Math.round(lines)));
        const quad = n >= 4 || perfect;
        // Waves past the first of one lock: each burns more golden and wider than the last.
        const deeper = Math.max(0, Math.min(4, Math.round(Number(cascade) || 1) - 1));
        const pace = this.surge.level.valueAt(t);
        // A back-to-back counts its links; a lock's first wave without one ends the run.
        if (deeper === 0) this.b2bChain = b2b ? this.b2bChain + 1 : 0;
        const link = Math.min(3, this.b2bChain);
        const palette = this._palette;
        const rgb = this._rgb;
        if (quad) {
            rgb[0] = 1.0;
            rgb[1] = 0.78;
            rgb[2] = 0.34;
        } else {
            // One line: the first accent. Two: the second. Three: both at once, nearly white.
            for (let c = 0; c < 3; c++) {
                if (n === 3) rgb[c] = palette.a[c] + palette.b[c] + 0.25;
                else rgb[c] = n === 1 ? palette.a[c] : palette.b[c];
            }
            const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
            for (let c = 0; c < 3; c++) rgb[c] = (rgb[c] / peak) * 0.92 + 0.08;
        }
        // Gold, not white: a cascade's light goes deeper in colour, it does not wash out.
        if (deeper > 0) mixInto(rgb, GOLD, Math.min(0.5, 0.15 * deeper));
        if (b2b) mixInto(rgb, GOLD, Math.min(0.75, 0.4 + 0.12 * link));
        // Waves still running up the street share its light: a far front is a wide band, and
        // three or four of them at once would paint the whole canyon. A cascade builds in its
        // colour, its fronts, its sparks, its kick and the smog's lightning, not in raw light.
        let inFlight = 0;
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            const A = uniforms.clearA[i].value;
            if (A.z > 0 && t - A.x < CLEAR_TRAVEL + CLEAR_FRONT_GAP * (A.y - 1)) inFlight += 1;
        }
        const strength = Math.min(
            1.9,
            0.6 + 0.12 * n + 0.04 * Math.min(8, combo) + (quad ? 0.25 : 0)
                + 0.06 * deeper + (b2b ? 0.15 : 0) + 0.06 * pace,
        ) / (1 + 0.2 * inFlight);
        const fronts = perfect ? 4 : Math.min(4, n + Math.floor(deeper / 2));
        const birth = quad ? t + BLACKOUT_HOLD : t;
        const slot = this.pickClearSlot(t);
        this.lastWave = slot;
        uniforms.clearA[slot].value.set(birth, fronts, strength, quad ? 1 : 0);
        uniforms.clearC[slot].value.set(rgb[0] * 1.3, rgb[1] * 1.3, rgb[2] * 1.3);
        this.lastAnchor = birth + CLEAR_TRAVEL;
        // Every wave hits the camera and floods the rays as it arrives; arrivals add up, so a
        // cascade's waves land one after another and a single after a quad cannot cut it short.
        const arrive = 0.3 + 0.14 * n + 0.06 * deeper;
        this.arriveKick.hit(arrive, birth + ARRIVE_AT);
        this.arriveFlash.hit(arrive * 0.55, birth + ARRIVE_AT);
        // The hotter play already runs, the more of a wave's light goes into the street (the
        // rain, the storm) and the less into the lens: a fast chain's floods must not stack into
        // a veil. (Sized as it lands, so a later wave never dims an earlier one's flood.)
        this.flood.hit((0.45 + 0.2 * n) * (1 + 0.15 * deeper) * (1 - 0.6 * pace), birth + FLOOD_PEAK - FLOOD_LEAD);
        if (quad) {
            this.blackoutUntil = t + BLACKOUT_HOLD;
            // From cold the district holds its breath in the dark; the hotter play already runs,
            // the shallower the breath (a quad mid-fever dims it by a third). Reduce flashing
            // keeps it soft.
            this.blackoutDepth = (1 - 0.65 * pace) * flashScale();
            // Back-to-back quads stack the overdrive instead of resetting it (soft-capped).
            const base = perfect ? 1.3 : 1;
            this.overdrive = Math.min(OVERDRIVE_CAP, Math.max(this.overdrive, base) + this.overdrive * 0.35);
            // The smog sheets with lightning as the lights come back.
            this.stormHits.hit(1, birth);
            this.glitch = Math.max(this.glitch, 0.8);
            this.counts.quads += 1;
        } else if (n === 3) this.stormHits.hit(0.55, t);
        // A cascade's later waves crack the smog a little harder each time.
        if (deeper > 0) this.stormHits.hit(0.12 * deeper, t);
        if (b2b) {
            // Back-to-back: the cinema flares stretch across the street, longer with every link.
            this.flare.hit(0.45 + 0.2 * link, t);
            this.stormHits.hit(0.3, t);
            this.counterPunch = 1;
        }
        if (tspin) {
            this.glitch = 1;
            this.spinHits.hit(1, t);
        }
        if (perfect) this.crown.hit(1, birth);
        this.refreshHits(t);
        const sc = this._surgeClear;
        sc.lines = n;
        sc.cascade = deeper + 1;
        sc.combo = combo;
        sc.tspin = tspin === true;
        sc.perfect = perfect === true;
        sc.b2b = b2b === true;
        this.surge.clear(sc, birth);
        this.counts.clears += 1;

        // The cleared rows fire out of the board.
        const board = boardFor(this.layout, player);
        const card = cardUnion(this.layout);
        if (board && card && this.layoutLive) {
            const list = Array.isArray(rows) && rows.length ? rows : Array.from({ length: n }, (_, i) => 19 - i);
            const ys = [];
            for (let i = 0; i < list.length && i < 4; i++) ys.push(boardPoint(board, 0.5, list[i], this._point).y);
            this.beams.fire(ys, card.x0, card.x1, rgb, t, Math.min(1.6, (0.7 + 0.18 * n) * (1 + 0.12 * deeper)));
        }
        // Each front kicks sparks off both kerbs as it passes (more as a cascade deepens).
        const perKerb = Math.round((quad ? 9 : 5) * (this.sparks.count / 512) * (1 + 0.25 * deeper));
        for (let k = 0; k < perKerb; k++) {
            const z = kerbSparkDepth(k, perKerb);
            const pass = CLEAR_TRAVEL * (1 - Math.min(1, -z / CLEAR_DEPTH) ** (1 / CLEAR_SHAPE));
            for (let s = -1; s <= 1; s += 2) {
                this.sparks.emit({
                    x: s * (STREET.halfRoad + 0.2),
                    z,
                    n: quad ? 5 : 3,
                    rgb,
                    time: birth + pass,
                    scroll: this.scroll,
                    spread: [1.5, 6],
                    up: [1.5, 5],
                    life: [0.4, 0.9],
                    size: 0.03,
                    arc: 2.4,
                    heading: s > 0 ? -Math.PI / 2 : Math.PI / 2,
                    y: 0.18,
                });
            }
        }
        if (quad) this.callDragon(birth + 0.1, perfect ? 0.35 : 0.25);
    }

    /**
     * A perfect clear that arrived after its clear (physics sends it once the last wave has
     * settled): the crown on the wave still running, never a second clear or a second blackout.
     * The district goes to full overdrive, the wave in the street burns white-gold, the dragon
     * flies (or the one in flight burns brighter), and the storm breaks: the rain lets up and
     * the glass wipes clear.
     */
    onPerfect({ combo = 1, b2b = false } = {}) {
        const { u: uniforms } = this;
        if (!uniforms) return;
        const t = this.time;
        this.crown.hit(1, t);
        this.overdrive = Math.min(OVERDRIVE_CAP, Math.max(this.overdrive, 1) + 0.45);
        this.stormHits.hit(0.5, t);
        this.flashHits.hit(0.22, t);
        this.counterPunch = 1;
        // The wave this crowns is the latest one, if it is still in the street.
        const A = uniforms.clearA[this.lastWave].value;
        if (A.z > 0 && t - A.x < CLEAR_TRAVEL + 0.8) {
            A.z = Math.min(2.1, A.z + 0.35);
            A.w = 1;
            const C = uniforms.clearC[this.lastWave].value;
            C.set(
                C.x + (WHITE_GOLD[0] * 1.3 - C.x) * 0.45,
                C.y + (WHITE_GOLD[1] * 1.3 - C.y) * 0.45,
                C.z + (WHITE_GOLD[2] * 1.3 - C.z) * 0.45,
            );
        }
        this.callDragon(t + 0.1, 0.35, false);
        this.refreshHits(t);
        const sc = this._surgeClear;
        sc.lines = 1;
        sc.cascade = 1;
        sc.combo = combo;
        sc.tspin = false;
        sc.perfect = true;
        sc.b2b = b2b === true;
        this.surge.clear(sc, t);
        this.counts.perfects += 1;
    }

    /** A T-spin that cleared nothing: the signs tear for a moment and the kerb lights race. */
    onSpin() {
        if (!this.u) return;
        const t = this.time;
        this.glitch = Math.max(this.glitch, 0.4);
        this.spinHits.hit(0.7, t);
        this.kickHits.hit(0.1, t);
        this.refreshHits(t);
        this.counts.spins += 1;
    }

    /**
     * The dragon out of the haze at `at`. One already in the street is never yanked back: it
     * burns brighter by `feed`, and (for a second quad, `follow`) another follows it once it
     * has passed over the camera. A crown only feeds the one in flight.
     */
    callDragon(at, feed, follow = true) {
        if (!this.dragon) return;
        const flight = this.dragon.uniforms.flight.value;
        if (this.time < this.dragonUntil && flight.y > 0) {
            flight.y = Math.min(DRAGON_STRENGTH_CAP, flight.y + feed);
            if (follow && this.dragonNext === Infinity) this.dragonNext = this.dragonUntil;
            return;
        }
        this.dragon.launch(at, 1, this.dragonLane());
        this.dragonUntil = at + DRAGON_FLIGHT;
    }

    /** The lock slot with the least light left in it (its comet fades slowest, e^(-1.3 age)). */
    pickLockSlot(t) {
        let best = 0;
        let bestEnergy = Infinity;
        let bestBirth = Infinity;
        for (let i = 0; i < LOCK_SLOTS; i++) {
            const A = this.u.lockA[i].value;
            const energy = A.w > 0 ? A.w * Math.exp(-1.3 * Math.max(0, t - A.z)) : 0;
            if (energy < bestEnergy - 1e-9 || (Math.abs(energy - bestEnergy) <= 1e-9 && A.z < bestBirth)) {
                best = i;
                bestEnergy = energy;
                bestBirth = A.z;
            }
        }
        return best;
    }

    /**
     * The clear slot with the least light left: never a wave still running up the street while
     * one has passed. What the old wave still glowed folds into the shared afterglow, so the
     * windows it lit fade out instead of going dark at once.
     */
    pickClearSlot(t) {
        let best = 0;
        let bestEnergy = Infinity;
        let bestBirth = Infinity;
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            const A = this.u.clearA[i].value;
            let energy = 0;
            if (A.z > 0) {
                const age = t - A.x;
                const passed = age - (CLEAR_TRAVEL + CLEAR_FRONT_GAP * (A.y - 1) + CLEAR_FRONT_WIDTH);
                energy = passed < 0 ? 1e3 - age : A.z * Math.exp(-passed / CLEAR_AFTERGLOW);
            }
            if (energy < bestEnergy - 1e-9 || (Math.abs(energy - bestEnergy) <= 1e-9 && A.x < bestBirth)) {
                best = i;
                bestEnergy = energy;
                bestBirth = A.x;
            }
        }
        const A = this.u.clearA[best].value;
        const age = t - A.x;
        if (A.z > 0 && age > 0) {
            // Its afterglow halfway up the street (nearer is brighter, further dimmer).
            const left = A.z * Math.exp(-Math.max(0, age - CLEAR_TRAVEL * 0.5) / CLEAR_AFTERGLOW);
            this.clearGlow = Math.min(0.6, this.clearGlow + left * 0.5);
        }
        return best;
    }

    /** The kick, flash and storm as of `t` (what the frame and the tests read). */
    refreshHits(t) {
        this.kick = this.kickHits.valueAt(t) + this.arriveKick.valueAt(t);
        this.flash = this.flashHits.valueAt(t) + this.arriveFlash.valueAt(t);
        this.storm = this.stormHits.valueAt(t);
    }

    /** The true combo changed (0 = the chain broke). */
    onCombo(combo) {
        const n = Math.max(0, Math.round(Number(combo) || 0));
        if (n === 0 && this.combo >= 2) {
            // The chain broke: a brown-out flicker as the charge drains.
            this.glitch = Math.max(this.glitch, 0.45);
            this.dip = Math.max(this.dip, 0.3);
        }
        if (n > this.combo && n >= 2) this.counterPunch = 1;
        if (n >= 2) this.counterValue = n;
        this.combo = n;
    }

    /** A new level: the district changes its colours. */
    levelUp(level, { silent = false } = {}) {
        this.level = Math.max(1, Math.round(Number(level) || 1));
        this.paletteIndex = (this.level - 1) % DISTRICT_PALETTES.length;
        if (silent) this.applyPalette(1);
        else {
            const t = this.time;
            this.stormHits.hit(0.7, t);
            this.flashHits.hit(0.18, t);
            this.refreshHits(t);
            this.surge.levelUp(t);
        }
    }

    /** Ease the live palette toward the level's (k = 1 snaps). */
    applyPalette(k) {
        const target = DISTRICT_PALETTES[this.paletteIndex];
        const p = this._palette;
        const a = linRGB(target.a);
        const b = linRGB(target.b);
        for (let c = 0; c < 3; c++) {
            p.a[c] += (a[c] - p.a[c]) * k;
            p.b[c] += (b[c] - p.b[c]) * k;
            p.low[c] += (target.low[c] - p.low[c]) * k;
            p.high[c] += (target.high[c] - p.high[c]) * k;
        }
    }

    // ── Frame ───────────────────────────────────────────────────────────────────

    update(sim, camera = this._camera) {
        const { u } = this;
        if (!u) return;
        const dt = Math.max(0, sim.delta || 0);
        this.time = sim.time;
        const t = this.time;

        // ── How hot play runs (shared/gameplay-surge.js), once a frame on the world's clock ──
        const surge = this.surge.sample(t);
        // The last thousandth of a swell's tail is rest: the district lands on its exact look.
        const level = surge.level > 1e-3 ? surge.level : 0;
        const fever = surge.fever > 1e-3 ? surge.fever : 0;
        this.play.punch = surge.punch;
        this.play.level = level;
        this.play.fever = fever;
        this.play.stage = surge.stage;

        // ── The charge ──
        const target = powerForCombo(this.combo);
        this.power += (target - this.power) * approach(target > this.power ? 2.6 : 0.85, dt);
        this.overdrive *= Math.exp(-dt / OVERDRIVE_COOL);
        // A dragon that followed another into the street.
        if (t >= this.dragonNext) {
            const at = this.dragonNext;
            this.dragonNext = Infinity;
            if (this.dragon) {
                this.dragon.launch(at, 1.15, this.dragonLane());
                this.dragonUntil = at + DRAGON_FLIGHT;
            }
        }
        // The district stays warm for as long as the dragon is in the street.
        if (t < this.dragonUntil) this.overdrive = Math.max(this.overdrive, 0.3);
        this.glitch *= Math.exp(-dt / 0.28);
        this.dip *= Math.exp(-dt / 0.2);
        this.clearGlow *= Math.exp(-dt / CLEAR_AFTERGLOW);
        this.refreshHits(t);
        // The district remembers how hot play runs: a quick hand keeps it charged between
        // chains, so a broken chain eases it down instead of draining it to nothing.
        const charge = Math.min(1, Math.max(this.power, level * 0.62 + fever * 0.25));
        this.charge = charge;
        // Reduced motion keeps every flash one soft swell: no blackout, no glitch steps and no
        // flicker in the lightning (12-14 Hz otherwise, a photosensitivity risk). Reduce
        // flashing (ADR-0021) holds the lightning steady and scales every flash, the blackout
        // and the sign tears by flashScale().
        const still = this.reducedMotion;
        const fs = flashScale();
        const steady = still || fs < 1;
        const blackout = !still && t < this.blackoutUntil ? this.blackoutDepth : 0;
        const heatTarget = clamp01(smooth(0.3, 1.0, charge) * 0.75 + this.overdrive);
        this.heat += (heatTarget - this.heat) * approach(3, dt);
        this.applyPalette(approach(0.9, dt));

        const speed = this.reducedMotion ? 0 : CRUISE_SPEED + CRUISE_BOOST * (charge + this.overdrive * 0.5);
        this.scroll += speed * dt;
        // Hours of play would grow the scroll past what a 32-bit float keeps to the millimetre.
        // Everything laid along the street repeats in one period, so drop whole periods — but only
        // while nothing is anchored to the scroll (lock rings and sparks ride it for a second or two).
        if (this.scroll > SCROLL_REBASE && t - this.lastAnchor > 4) this.scroll -= SCROLL_REBASE;

        // ── The storm over the canyon ──
        // Play that stays quick brings the rain on, the harder the longer it lasts; a perfect
        // clear's crown breaks it (the rain lets up while the crown burns, the glass wipes clear).
        const crown = this.crown.valueAt(t);
        const drive = clamp01(smooth(0.15, 0.75, level) * 0.55 + fever * 0.55) * (1 - crown);
        this.downpour += (drive - this.downpour) * approach(drive > this.downpour ? 1.1 : 0.55, dt);
        const pour = this.downpour;
        // Paces that change are integrated, never multiplied into the clock: nothing jumps.
        this.rainClock += dt * (1 + 0.6 * pour);
        this.trafficClock += dt * (1 + 0.5 * charge + 0.3 * fever);
        this.chasePhase = (this.chasePhase + dt * (0.22 + 1.5 * charge + 2.6 * this.spinHits.valueAt(t))) % 1;
        // In a fever, sheet lightning walks through the smog: a soft stroke every two seconds or
        // so (never a strobe), brighter the deeper the fever.
        this.thunderPhase += dt * smooth(0.2, 0.9, fever) * STROKE_RATE;
        if (this.thunderPhase >= 1) {
            this.thunderPhase -= Math.floor(this.thunderPhase);
            this.strokes.hit(0.2 + 0.2 * fever, t);
        }

        // Distant sheet lightning now and then, on the district's own clock.
        const beat = t % 31;
        const sheet = beat > 24 && beat < 24.7 ? (beat - 24) / 0.7 : -1;
        let ambient = 0;
        if (sheet >= 0) {
            ambient = steady
                ? Math.sin(Math.PI * sheet) * 0.16
                : Math.abs(Math.sin(beat * 37)) * (1 - sheet) * 0.4;
        }
        const flicker = steady ? 0.6 : 0.55 + 0.45 * Math.abs(Math.sin(t * 43));
        const storm = Math.max(this.storm * flicker, ambient, this.strokes.valueAt(t)) * fs;

        // ── Uniforms ──
        u.time.value = t;
        u.scroll.value = this.scroll;
        // Hale's adverts breathe with the guide when a session leads one, else on the game's breath.
        u.breath.value = readBreathSignal() ?? breathFill(t);
        u.power.value = charge;
        u.heat.value = this.heat;
        u.glitch.value = still ? 0 : Math.min(1, this.glitch + blackout * 0.5) * fs;
        u.storm.value = storm;
        // Every emitter burns a little hotter as play heats (the iris below keeps the colours).
        const lit = (1 + charge * 0.22 + this.overdrive * 0.4 + level * 0.04 + fever * 0.06) * (1 - this.dip);
        // The blackout takes the light down from wherever it is: a shallow one is an inhale.
        u.neon.value = lit * (1 - 0.95 * blackout);
        u.rain.value = (1 + 0.6 * pour) * (1 - 0.4 * crown);
        u.downpour.value = pour;
        u.rainClock.value = this.rainClock;
        u.traffic.value = this.trafficClock;
        u.chase.value = this.chasePhase;
        u.clearGlow.value = this.clearGlow;
        const p = this._palette;
        const h = this.heat;
        u.accentA.value.set(p.a[0] + (GOLD[0] - p.a[0]) * h * 0.8, p.a[1] + (GOLD[1] - p.a[1]) * h * 0.8, p.a[2] + (GOLD[2] - p.a[2]) * h * 0.8);
        u.accentB.value.set(p.b[0] + (GOLD[0] - p.b[0]) * h * 0.5, p.b[1] + (GOLD[1] - p.b[1]) * h * 0.5, p.b[2] + (GOLD[2] - p.b[2]) * h * 0.5);
        u.hazeLow.value.set(
            p.low[0] + (HOT_MIST[0] - p.low[0]) * h * 0.45,
            p.low[1] + (HOT_MIST[1] - p.low[1]) * h * 0.45,
            p.low[2] + (HOT_MIST[2] - p.low[2]) * h * 0.45,
        );
        u.hazeHigh.value.set(p.high[0], p.high[1], p.high[2]);

        // Atlases power up when they arrive (at once in a capture).
        const fades = [this.atlases.shopFade, this.atlases.adsFade];
        for (let i = 0; i < 2; i++) {
            if (this.atlasReady[i] && this.atlasFade[i] < 1) {
                this.atlasFade[i] = this.capture ? 1 : Math.min(1, this.atlasFade[i] + dt / POWER_UP);
                fades[i].value = this.atlasFade[i] * this.atlasFade[i];
            }
        }
        const sky = this.parts.sky?.mesh;
        if (sky && camera) sky.position.copy(camera.position);
        this.updateCounter(dt, camera);

        // ── Post ──
        // Every wave floods the rays as it fills the near street; the floods of a cascade add up.
        const flood = this.flood.valueAt(t);
        const post = this._post;
        // The drops on the glass keep the rain's clock (they run faster in a downpour), and hold
        // still under reduced motion.
        if (!this.reducedMotion) post.rainTime = this.rainClock;
        post.flash = this.flash;
        // The punch of play keeps a floor under the lens fringe while the pieces keep coming.
        post.kick = this.kick + surge.punch * 0.12;
        const rays = 0.2 + charge * 0.1 + this.overdrive * 0.12 + flood * 0.5;
        post.rays = rays * (1 - 0.9 * blackout);
        const streak = 1 + this.overdrive * 0.5 + charge * 0.2 + this.flare.valueAt(t);
        post.streak = streak + (0.2 - streak) * blackout;
        post.bloomBoost = (this.overdrive * 0.25 + flood * 0.12) * (1 - blackout);
        // The iris closes as the district flares and as play heats, so its colours survive the
        // surge and its darks stay dark.
        post.exposure = (1 / (1 + this.overdrive * 0.42 + flood * 0.3))
            * (1 - Math.max(0, level - 0.2) * 0.1 - fever * 0.08)
            * (1 - 0.3 * blackout); // a quad's breath dims the lens as well as the lights
        // The crown wipes the condensation off the glass; it mists back over as it fades.
        post.glassMist = 1 - 0.7 * crown;
    }

    /**
     * The free zones beside the gameplay cards (screen fractions): left of the leftmost card, and
     * right of the rightmost card or the stats bar.
     */
    freeZones() {
        const card = cardUnion(this.layout);
        if (!card) return { left: 0.38, rightEdge: 0.62, right: 0.38 };
        const { hud } = this.layout;
        const rightEdge = Math.max(card.x1, hud ? hud.x1 : 0);
        return { left: Math.max(0, card.x0), rightEdge, right: Math.max(0, 1 - rightEdge) };
    }

    /**
     * The dragon swims down the left wall when the camera can see that lane beside the card;
     * otherwise (a phone held upright) it passes over the top of the card.
     */
    dragonLane() {
        const camera = this._camera;
        if (!camera) return DRAGON_LANE;
        const { left } = this.freeZones();
        this._ray.set(DRAGON_LANE[0], DRAGON_LANE[1], -20).project(camera);
        const sx = this._ray.x * 0.5 + 0.5;
        return sx > 0.04 && sx < left - 0.03 ? DRAGON_LANE : DRAGON_OVERHEAD;
    }

    /**
     * The combo hologram hangs fifteen metres out in the free zone right of the cards (the
     * dragon takes the left), or left of them when the right has no room. With no room either
     * side — a phone held upright — it stays dark.
     */
    updateCounter(dt, camera) {
        const { counter } = this;
        if (!counter || !camera) return;
        const zones = this.freeZones();
        const useRight = zones.right >= 0.2;
        const room = useRight ? zones.right : zones.left;
        const want = this.combo >= 2 && room >= 0.2 ? 1 : 0;
        this.counterShown += (want - this.counterShown) * approach(want ? 9 : 4, dt);
        this.counterPunch *= Math.exp(-dt / 0.16);
        const sx = useRight ? zones.rightEdge + room * 0.5 : room * 0.5;
        this._ray.set(sx * 2 - 1, 1 - 0.27 * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        const reach = 15;
        // Three figures fit the zone: the card is 2.6 heights wide.
        const height = Math.max(1.5, Math.min(3.3, room * 9.4));
        counter.uniforms.place.value.set(
            camera.position.x + this._ray.x * reach,
            camera.position.y + this._ray.y * reach,
            camera.position.z + this._ray.z * reach,
            height,
        );
        counter.uniforms.state.value.set(this.counterValue, this.counterShown, this.counterPunch, 0);
    }

    /** What the post stack reads each frame (a reused object). */
    getPostState() {
        return this._post;
    }

    getState() {
        return {
            quality: this.quality,
            time: this.time,
            scroll: this.scroll,
            combo: this.combo,
            power: this.power,
            charge: this.charge,
            heat: this.heat,
            overdrive: this.overdrive,
            surge: { level: this.play.level, fever: this.play.fever, stage: this.play.stage },
            downpour: this.downpour,
            level: this.level,
            palette: DISTRICT_PALETTES[this.paletteIndex].name,
            counts: { ...this.counts },
            dragon: this.time < this.dragonUntil,
            drones: this.dragon ? this.dragon.count : 0,
            sparks: this.sparks ? this.sparks.count : 0,
            layoutLive: this.layoutLive,
            heart: { ...this.heart },
            boxes: this.plan.boxes.length,
            megaBoxes: this.plan.megaBoxes.length,
            signs: this.plan.signs.length,
            shopfronts: this.plan.shops.filter((s) => s.kind === 0).length,
            shops: this.plan.shops.length,
            kit: this.plan.kit.length,
            reflection: this.tier.reflection,
            period: STREET.period,
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
        this.textures.forEach((t) => t.dispose());
        this.disposables = [];
        this.textures = [];
        this.parts = {};
        this.reflection = null;
        this.atlases = null;
        this.sparks = null;
        this.beams = null;
        this.counter = null;
        this.dragon = null;
        this.u = null;
        this._camera = null;
    }
}

export { PARTS as NEON_DISTRICT_PARTS };
