/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * The ascent's sky: what lies between the theme and the board while the player looks around
 * Infinity's tower. One full-screen pass, drawn into a transparent canvas laid over the theme:
 *
 *   - a hush: the world dims a little while you look;
 *   - the depths: below the rows you play in, a haze in the theme's own ground colour rises from
 *     the bottom of the screen as you descend the tower;
 *   - the night: above them, a sky comes down from the top as you rise, from the theme's own
 *     horizon colour at its edge to night at its zenith, and its stars come out;
 *   - the air: three layers of motes at different depths drift past as the view moves (the
 *     parallax that makes the body believe it is moving), drawn out into streaks with the speed;
 *   - a vignette that closes a little as the view speeds up.
 *
 * Authored in display space (the stage writes the fragment untouched: no tone mapping, no output
 * conversion) and premultiplied, so it composites over the theme the way CSS would. The same
 * class draws the playground effect (`?effect=infinity-ascent`) and the game's layer.
 */

import * as THREE from 'three/webgpu';
import {
    Fn, abs, clamp, cos, exp, float, floor, fract, hash, length, max, min, mix, positionGeometry,
    screenCoordinate, sin, smoothstep, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';

/** Per tier: mote layers and star layers drawn, and the canvas's pixel-ratio cap. */
export const SKY_TIERS = Object.freeze({
    High: { motes: 3, stars: 2, pixelRatio: 1.25 },
    Medium: { motes: 3, stars: 2, pixelRatio: 1 },
    Low: { motes: 2, stars: 1, pixelRatio: 0.85 },
});

/**
 * The air: each layer's share of the board's speed (parallax: the far layers move least), its
 * cell (screen heights), mote radius (screen heights), light and how many cells hold a mote.
 * At rest they are a faint soft dust (they must not read as stars); moving, they draw out into
 * streaks and brighten (MOTE_SPEED_GAIN), so the speed is seen in the periphery.
 */
const MOTE_LAYERS = [
    {
        k: 0.3, cell: 0.1, radius: 0.0028, light: 0.1, density: 0.34, seed: 11,
    },
    {
        k: 0.48, cell: 0.14, radius: 0.0042, light: 0.13, density: 0.28, seed: 23,
    },
    {
        k: 0.72, cell: 0.2, radius: 0.0062, light: 0.17, density: 0.22, seed: 37,
    },
];
const MOTE_SPEED_GAIN = 2.2;
/** How much of a streak's light its length spreads (1 = all of it, 0 = none). */
const MOTE_SPREAD = 0.45;

/** The night's stars: cell (screen heights), radius (pixels), how many cells hold one. */
const STAR_LAYERS = [
    {
        cell: 0.024, radius: 0.9, density: 0.2, seed: 53,
    },
    {
        cell: 0.055, radius: 1.5, density: 0.26, seed: 71,
    },
];

/** sRGB 0..255 → a THREE.Color holding the display values as they are (no conversion). */
const displayColor = (r, g, b) => new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.LinearSRGBColorSpace);

/** The look when no theme has lent its colours (a dusk over a violet night). */
export const DEFAULT_TINTS = Object.freeze({
    glow: [104, 116, 168],
    night: [8, 9, 24],
    ground: [26, 22, 44],
    mote: [214, 224, 255],
});

/** What setState() takes. */
const STATE_KEYS = Object.freeze([
    'presence', 'sky', 'deep', 'dim', 'gapTop', 'gapBottom', 'scroll', 'speed', 'flow', 'time', 'motion',
]);

/** Integer cell → a hash seed that is exact in float32 (cells may be negative). */
const cellSeed = (cell, seed) => cell.x.add(512).add(cell.y.add(4096).mul(1024)).add(seed);

export class AscentSkyWorld {
    /**
     * @param {{quality?: 'High'|'Medium'|'Low', over?: boolean}} [options] over: composite onto
     *   what is already drawn (premultiplied "over"; the playground's stand-in theme) instead of
     *   writing the canvas's pixels as they are (the game's own transparent canvas)
     */
    constructor({ quality = 'High', over = false } = {}) {
        this.tierName = SKY_TIERS[quality] ? quality : 'High';
        this.tier = SKY_TIERS[this.tierName];
        this.over = Boolean(over);
        this.u = {
            time: uniform(0),
            aspect: uniform(16 / 9),
            pixel: uniform(1 / 1080),
            presence: uniform(0),
            dim: uniform(0.12),
            sky: uniform(0),
            deep: uniform(0),
            gapTop: uniform(0),
            gapBottom: uniform(0),
            scroll: uniform(0),
            speed: uniform(0),
            flow: uniform(0),
            exposure: uniform(0.08),
            motion: uniform(1),
            glow: uniform(displayColor(...DEFAULT_TINTS.glow)),
            night: uniform(displayColor(...DEFAULT_TINTS.night)),
            ground: uniform(displayColor(...DEFAULT_TINTS.ground)),
            mote: uniform(displayColor(...DEFAULT_TINTS.mote)),
        };
        this.mesh = null;
        this.material = null;
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    }

    /** Build into `scene`. */
    build(scene) {
        const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
        if (this.over) {
            material.transparent = true;
            material.blending = THREE.CustomBlending;
            material.blendSrc = THREE.OneFactor;
            material.blendDst = THREE.OneMinusSrcAlphaFactor;
            material.blendSrcAlpha = THREE.OneFactor;
            material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
        } else {
            material.blending = THREE.NoBlending;
        }
        material.vertexNode = vec4(positionGeometry.xy.mul(2), 0.5, 1);
        material.fragmentNode = this._fragment();
        this.material = material;
        this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 10;
        scene.add(this.mesh);
        return this;
    }

    /** @param {number} width @param {number} height CSS px */
    setViewport(width, height) {
        if (!(width > 0 && height > 0)) return;
        this.u.aspect.value = width / height;
        this.u.pixel.value = 1 / height;
    }

    /**
     * The look of the moment.
     * @param {{presence?: number, sky?: number, deep?: number, dim?: number, gapTop?: number,
     *   gapBottom?: number, scroll?: number, speed?: number, flow?: number, time?: number,
     *   motion?: number}} state scroll: the board's position in screen heights (+ down the tower);
     *   speed: -1..1 (+ rising); flow: the board's speed in screen heights a second (+ down)
     */
    setState(state) {
        const { u } = this;
        for (const key of STATE_KEYS) {
            const value = state[key];
            if (Number.isFinite(value)) u[key].value = value;
        }
    }

    /**
     * Borrow a theme's colours (sRGB 0..255 triplets). Missing ones keep the default.
     * @param {{glow?: number[], night?: number[], ground?: number[], mote?: number[]}} tints
     */
    setTints(tints = {}) {
        for (const key of ['glow', 'night', 'ground', 'mote']) {
            const rgb = tints[key] || DEFAULT_TINTS[key];
            this.u[key].value.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.LinearSRGBColorSpace);
        }
    }

    _fragment() {
        const { u, tier } = this;
        return Fn(() => {
            const p = uv();
            const down = float(1).sub(p.y);
            const x = p.x.sub(0.5).mul(u.aspect);
            const C = vec3(0).toVar();
            const A = float(0).toVar();
            const over = (colour, alpha) => {
                const a = clamp(alpha, 0, 1);
                C.assign(colour.mul(a).add(C.mul(float(1).sub(a))));
                A.assign(a.add(A.mul(float(1).sub(a))));
            };

            // The hush.
            over(vec3(0), u.presence.mul(u.dim));

            // The depths: a haze in the ground's colour rising from below as the view descends,
            // darker the lower it lies, and over whatever the theme's lift has bared at the bottom
            // of the screen (a wide feather, so it reads as the near ground in shadow, not a band).
            const hazeTop = float(1).sub(u.deep.mul(0.8));
            const haze = smoothstep(hazeTop.sub(0.3), hazeTop.add(0.45), down).mul(u.deep);
            const bottomEdge = float(1).sub(u.gapBottom);
            const bared = smoothstep(bottomEdge.sub(0.16), bottomEdge.add(0.006), down)
                .mul(smoothstep(0, 0.004, u.gapBottom));
            const deeper = smoothstep(hazeTop.sub(0.1), 1.1, down);
            over(mix(u.ground.mul(0.85), u.ground.mul(0.3), deeper), max(haze, bared).mul(u.presence));

            // The night: from the theme's horizon colour at its edge to night above, coming down
            // as the view rises; and whatever the theme's sinking has bared at the top.
            const edge = u.sky.mul(1.65).sub(0.2);
            const inside = edge.sub(down);
            const topEdge = u.gapTop;
            const baredTop = float(1).sub(smoothstep(topEdge.sub(0.004), topEdge.add(0.03), down))
                .mul(smoothstep(0, 0.004, u.gapTop));
            const veil = max(smoothstep(-0.05, 0.35, inside), baredTop).mul(u.presence).toVar();
            // Low on the screen a little of the glow stays even in the full night: the world's
            // light, far below.
            const nightness = smoothstep(0.02, 0.62, inside.add(baredTop.mul(0.4)))
                .mul(float(1).sub(smoothstep(0.5, 1.05, down).mul(0.32))).toVar();
            over(mix(u.glow, u.night, nightness), veil);

            // Its stars, fixed at infinity (a hair of parallax), twinkling.
            const starsShown = veil.mul(smoothstep(0.12, 0.55, nightness));
            STAR_LAYERS.slice(0, tier.stars).forEach((layer) => {
                const q = vec2(x, down.add(u.scroll.mul(0.03))).div(layer.cell);
                const cell = floor(q);
                const f = fract(q);
                const h1 = hash(cellSeed(cell, layer.seed));
                const h2 = hash(h1.mul(65536));
                const h3 = hash(h2.mul(65536));
                const centre = vec2(h1, h2).mul(0.6).add(0.2);
                const distance = length(f.sub(centre)).mul(layer.cell).div(u.pixel);
                const radius = float(layer.radius).mul(float(0.7).add(h3.mul(h3).mul(1.1)));
                const present = smoothstep(1 - layer.density, 1 - layer.density + 0.02, h3);
                const wave = sin(u.time.mul(h1.mul(2.2).add(1.1)).add(h2.mul(40))).mul(0.5).add(0.5);
                const twinkle = float(1).sub(u.motion.mul(0.3).mul(wave));
                const light = exp(distance.div(radius).mul(distance.div(radius)).negate());
                const brightness = float(0.3).add(h2.mul(h2).mul(h2).mul(0.7));
                over(vec3(1, 0.97, 0.9), light.mul(present).mul(brightness).mul(twinkle).mul(starsShown));
            });

            // The air: motes at three depths drift past with the view, streaking with the speed.
            // Fewer show in the night, where the stars are.
            const motes = float(0).toVar();
            const moteGain = float(1).add(abs(u.speed).mul(MOTE_SPEED_GAIN).mul(u.motion))
                .mul(float(1).sub(veil.mul(0.6)));
            MOTE_LAYERS.slice(0, tier.motes).forEach((layer) => {
                const q = vec2(x, down.add(u.scroll.mul(layer.k))).div(layer.cell);
                const cell = floor(q);
                const f = fract(q);
                // The streak's half length, in cells (the light spreads along it).
                const speedOfLayer = abs(u.flow.mul(layer.k)).mul(u.exposure).mul(u.motion);
                const half = min(speedOfLayer.div(layer.cell).mul(0.5), 0.9);
                [-1, 0, 1].forEach((dy) => {
                    const at = cell.add(vec2(0, dy));
                    const h1 = hash(cellSeed(at, layer.seed));
                    const h2 = hash(h1.mul(65536));
                    const h3 = hash(h2.mul(65536));
                    const sway = vec2(
                        sin(u.time.mul(0.31).add(h1.mul(6.283))).mul(0.08),
                        cos(u.time.mul(0.23).add(h2.mul(6.283))).mul(0.08),
                    ).mul(u.motion);
                    const centre = vec2(h1, h2).mul(0.7).add(0.15)
                        .add(vec2(0, dy))
                        .add(sway);
                    const rel = f.sub(centre);
                    // Each mote's own streak length (its depth in the layer), fading at both ends.
                    const own = min(half.mul(float(0.55).add(h2.mul(0.9))), 0.95);
                    const along = clamp(rel.y, own.negate(), own);
                    const distance = length(vec2(rel.x, rel.y.sub(along))).mul(layer.cell);
                    const radius = float(layer.radius).mul(float(0.6).add(h3.mul(0.8)));
                    // A streak spreads its light along its length, but not all of it: a strict
                    // conservation leaves the fastest streaks too faint to see.
                    const spread = radius.div(radius.add(own.mul(layer.cell))).pow(MOTE_SPREAD);
                    const taper = float(1).sub(smoothstep(0.35, 1.0, abs(along).div(max(own, 1e-4))).mul(0.85));
                    const present = smoothstep(1 - layer.density, 1 - layer.density + 0.03, h3);
                    const light = exp(distance.div(radius).mul(distance.div(radius)).negate());
                    motes.addAssign(light.mul(spread).mul(taper).mul(present).mul(layer.light));
                });
            });
            over(u.mote, motes.mul(moteGain).mul(u.presence));

            // The vignette closes a little with the speed.
            const r = length(vec2(x.div(u.aspect.mul(0.5)), down.sub(0.5).mul(2)));
            over(vec3(0), smoothstep(0.55, 1.3, r).mul(float(0.16).add(abs(u.speed).mul(0.34))).mul(u.presence));

            // A dither against banding in the dark gradients.
            const grain = hash(screenCoordinate.x.add(screenCoordinate.y.mul(4096)).floor()).sub(0.5).mul(1.5 / 255);
            return vec4(C.add(grain.mul(A)), A);
        })();
    }

    dispose() {
        this.mesh?.removeFromParent();
        this.mesh?.geometry.dispose();
        this.material?.dispose();
        this.mesh = null;
        this.material = null;
    }
}
