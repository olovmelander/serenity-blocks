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
 *            stays in overdrive while it cools.
 *
 * Everything is a function of the world clock and event timestamps (nothing is created at event
 * time), so seek(t) plus a fixed-step replay reproduces any frame.
 *
 * Layers: 0 = everything the wet street mirrors; 1 = what only the camera sees (rain, effects).
 */

import * as THREE from 'three/webgpu';
import { texture, uniform } from 'three/tsl';
import {
    CLEAR_DEPTH,
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
import { GLOW_TEXELS, buildLayout } from './neon-district-layout.js';
import { tierFor } from './neon-district-quality.js';
import { createFacades } from './neon-district-facades.js';
import { createSky } from './neon-district-sky.js';
import { createStreet } from './neon-district-street.js';
import {
    createGlyphTexture, createPlaceholderTexture, createScreens, createShopfronts, createSigns,
} from './neon-district-signs.js';
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
const HOT_MIST = Object.freeze([0.085, 0.036, 0.014]);

const PARTS = [
    'sky', 'mega', 'facades', 'street', 'shopfronts', 'signs', 'screens', 'lamps', 'cables', 'lanterns',
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
            heart: this.heart, flash: 0, kick: 0, rays: 0.3, streak: 1, bloomBoost: 0, exposure: 1,
        };
        this.resetState(0);
    }

    /** Everything the choreography remembers. */
    resetState(time) {
        this.time = time;
        this.scroll = (time * CRUISE_SPEED) % SCROLL_REBASE;
        this.combo = 0;
        this.power = 0;
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
        this.lockCursor = 0;
        this.clearCursor = 0;
        this.lastClear = { time: -100, lines: 0 };
        this.pendingKick = { time: Infinity, amount: 0 };
        this.counts = { locks: 0, clears: 0, quads: 0 };
        this.lastAnchor = -100;
        this.counterShown = 0;
        this.counterPunch = 0;
        this.counterValue = 0;
        this.dragonUntil = -1;
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
        this.textures.push(glyphs, blank);
        this.atlases = {
            shop: texture(blank), shopFade: uniform(0), ads: texture(blank), adsFade: uniform(0),
        };
        this.addPart('shopfronts', createShopfronts(u, plan.shopfronts, this.atlases.shop, this.atlases.shopFade));
        this.addPart('signs', createSigns(u, plan.signs, glyphs));
        this.addPart('screens', createScreens(u, plan.screens, this.atlases.ads, this.atlases.adsFade));

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
        const { time, scroll } = this;
        this.resetState(time);
        this.scroll = scroll;
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
        const fov = fovForAspect(this.aspect) - this.kick * 0.9 * calm;
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
        const slot = this.lockCursor % LOCK_SLOTS;
        this.lockCursor += 1;
        const rgb = pieceColor(color, DISTRICT_PALETTES[this.paletteIndex].a);
        const strength = hardDrop ? 1.3 : 0.8;
        uniforms.lockA[slot].value.set(strike.x, strike.z - this.scroll, this.time, strength);
        this.lastAnchor = this.time;
        uniforms.lockC[slot].value.set(rgb[0] * 1.5, rgb[1] * 1.5, rgb[2] * 1.5);
        this.kick = Math.max(this.kick, hardDrop ? 0.55 : 0.14);
        this.flash = Math.max(this.flash, hardDrop ? 0.12 : 0.03);
        // Sparks skid out across the wet street from where it landed.
        const share = this.sparks.count / 512;
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
     * Lines cleared. `lines` 1..4; `combo` = the true consecutive-clear combo; `tspin`, `perfect`.
     */
    onClear({
        rows = null, lines = 1, combo = 1, tspin = false, perfect = false, player = 0,
    } = {}) {
        const { u: uniforms } = this;
        if (!uniforms) return;
        const n = Math.max(1, Math.min(4, Math.round(lines)));
        const quad = n >= 4 || perfect;
        const palette = this._palette;
        let rgb;
        if (quad) rgb = [1.0, 0.78, 0.34];
        else {
            // One line: the first accent. Two: the second. Three: both at once, nearly white.
            const src = n === 1 ? palette.a : palette.b;
            rgb = n === 3 ? [0, 1, 2].map((c) => palette.a[c] + palette.b[c] + 0.25) : [...src];
            const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
            rgb = rgb.map((c) => (c / peak) * 0.92 + 0.08);
        }
        const strength = Math.min(1.5, 0.6 + 0.12 * n + 0.04 * Math.min(8, combo) + (quad ? 0.25 : 0));
        const birth = quad ? this.time + BLACKOUT_HOLD : this.time;
        const slot = this.clearCursor % CLEAR_SLOTS;
        this.clearCursor += 1;
        uniforms.clearA[slot].value.set(birth, perfect ? 4 : n, strength, quad ? 1 : 0);
        uniforms.clearC[slot].value.set(rgb[0] * 1.3, rgb[1] * 1.3, rgb[2] * 1.3);
        this.lastClear = { time: birth, lines: n };
        this.lastAnchor = birth + CLEAR_TRAVEL;
        // The wave reaches the camera CLEAR_TRAVEL seconds after it leaves.
        this.pendingKick = { time: birth + CLEAR_TRAVEL * 0.93, amount: 0.3 + 0.14 * n };
        if (quad) {
            this.blackoutUntil = this.time + BLACKOUT_HOLD;
            this.overdrive = perfect ? 1.3 : 1;
            this.storm = 1;
            this.glitch = Math.max(this.glitch, 0.8);
            this.counts.quads += 1;
        } else if (n === 3) this.storm = Math.max(this.storm, 0.55);
        if (tspin) this.glitch = 1;
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
        // Each front kicks sparks off both kerbs as it passes.
        const perKerb = Math.round((quad ? 9 : 5) * (this.sparks.count / 512));
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
        if (quad && this.dragon) {
            const launch = birth + 0.1;
            this.dragon.launch(launch, 1, this.dragonLane());
            this.dragonUntil = launch + DRAGON_FLIGHT;
        }
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
            this.storm = Math.max(this.storm, 0.7);
            this.flash = Math.max(this.flash, 0.18);
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

        // ── The charge ──
        const target = powerForCombo(this.combo);
        this.power += (target - this.power) * approach(target > this.power ? 2.6 : 0.85, dt);
        this.overdrive *= Math.exp(-dt / OVERDRIVE_COOL);
        // The district stays warm for as long as the dragon is in the street.
        if (t < this.dragonUntil) this.overdrive = Math.max(this.overdrive, 0.3);
        this.glitch *= Math.exp(-dt / 0.28);
        this.dip *= Math.exp(-dt / 0.2);
        this.storm *= Math.exp(-dt / 0.9);
        this.flash *= Math.exp(-dt / 0.25);
        this.kick *= Math.exp(-dt / 0.16);
        if (t >= this.pendingKick.time) {
            this.kick = Math.max(this.kick, this.pendingKick.amount);
            this.flash = Math.max(this.flash, this.pendingKick.amount * 0.55);
            this.pendingKick.time = Infinity;
        }
        const blackout = t < this.blackoutUntil ? 1 : 0;
        const heatTarget = clamp01(smooth(0.3, 1.0, this.power) * 0.75 + this.overdrive);
        this.heat += (heatTarget - this.heat) * approach(3, dt);
        this.applyPalette(approach(0.9, dt));

        const speed = this.reducedMotion ? 0 : CRUISE_SPEED + CRUISE_BOOST * (this.power + this.overdrive * 0.5);
        this.scroll += speed * dt;
        // Hours of play would grow the scroll past what a 32-bit float keeps to the millimetre.
        // Everything laid along the street repeats in one period, so drop whole periods — but only
        // while nothing is anchored to the scroll (lock rings and sparks ride it for a second or two).
        if (this.scroll > SCROLL_REBASE && t - this.lastAnchor > 4) this.scroll -= SCROLL_REBASE;

        // Distant sheet lightning now and then, on the district's own clock.
        const beat = t % 31;
        const ambient = beat > 24 && beat < 24.7 ? Math.abs(Math.sin(beat * 37)) * (1 - (beat - 24) / 0.7) * 0.4 : 0;
        const storm = Math.max(this.storm * (0.55 + 0.45 * Math.abs(Math.sin(t * 43))), ambient);

        // ── Uniforms ──
        u.time.value = t;
        u.scroll.value = this.scroll;
        u.power.value = this.power;
        u.heat.value = this.heat;
        u.glitch.value = Math.min(1, this.glitch + blackout * 0.5);
        u.storm.value = storm;
        u.neon.value = blackout
            ? 0.05
            : (1 + this.power * 0.22 + this.overdrive * 0.4) * (1 - this.dip);
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
        const sinceClear = t - this.lastClear.time;
        const arrive = sinceClear >= 0
            ? Math.exp(-(((sinceClear - CLEAR_TRAVEL * 0.8) / 0.3) ** 2)) * (0.45 + 0.2 * this.lastClear.lines)
            : 0;
        const post = this._post;
        post.flash = this.flash;
        post.kick = this.kick;
        post.rays = blackout ? 0.04 : 0.2 + this.power * 0.1 + this.overdrive * 0.12 + arrive * 0.5;
        post.streak = blackout ? 0.2 : 1 + this.overdrive * 0.5 + this.power * 0.2;
        post.bloomBoost = this.overdrive * 0.25 + arrive * 0.2;
        // The iris closes as the district flares, so its colours survive the surge.
        post.exposure = 1 / (1 + this.overdrive * 0.42 + arrive * 0.3);
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
            heat: this.heat,
            overdrive: this.overdrive,
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
            shopfronts: this.plan.shopfronts.length,
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
