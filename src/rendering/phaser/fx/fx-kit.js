/**
 * @fileoverview The board effects kit: soft light textures, the Keystone tones and a
 * few helpers for light sprites (src/rendering/phaser/shared-effects.js uses them).
 *
 * Board effects are light, never paint: additive sprites drawn from soft textures in
 * the piece's colour or the event's tone. The textures are drawn once per Phaser game
 * on a canvas (radial and linear gradients), so every effect is a handful of tinted
 * images instead of Graphics redrawn each frame. Where a scene cannot make canvas
 * textures (headless tests), `ensureFxTextures` returns false and callers skip the
 * light layers.
 */

/** Texture keys. */
export const FX = {
    GLOW: 'fx-glow', // round soft light
    EMBER: 'fx-ember', // a small hot mote
    BAND: 'fx-band', // a horizontal band of light with a bright core (stretched in x)
    SLAB: 'fx-slab', // a block of light, even across its middle 70%, soft above and below
    FLARE: 'fx-flare', // a thin horizontal flare, bright in the middle
    SMEAR: 'fx-smear', // speed: clear at the top, bright at the foot
    RING: 'fx-ring', // a soft ring
    RISE: 'fx-rise', // light rising from the floor: bright at the foot, gone at the top
    SHARD: 'fx-shard', // a rounded chunk of a block
};

/** Keystone tones (public/styles/keystone.css). */
export const TONE = {
    CREAM: 0xfff6e9,
    GOLD: 0xf3d28d,
    AQUA: 0x9ee8ed,
    LAVENDER: 0xb8a4ff,
    CORAL: 0xffac88,
    DANGER: 0xff9cab,
    NIGHT: 0x090818,
    SLATE: 0x4a5068,
};

/** CSS form of a tone, for text. */
export const toneCss = (int) => `#${(int >>> 0).toString(16).padStart(6, '0').slice(-6)}`;

/** Linear mix of two 0xRRGGBB colours. */
export function mixColor(a, b, t) {
    const k = Math.min(1, Math.max(0, t));
    const ch = (shift) => {
        const x = (a >> shift) & 255;
        const y = (b >> shift) & 255;
        return Math.round(x + (y - x) * k);
    };
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** '#rrggbb' (or a number) → 0xRRGGBB. */
export function toColorInt(value, fallback = TONE.CREAM) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const int = parseInt(String(value || '').replace('#', ''), 16);
    return Number.isFinite(int) ? int : fallback;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Paints each texture (white, so tint gives the colour) onto a 2D context. */
const PAINTERS = {
    [FX.GLOW]: [64, 64, (ctx, w, h) => {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        [[0, 1], [0.18, 0.78], [0.4, 0.36], [0.68, 0.1], [1, 0]].forEach(([s, a]) => g.addColorStop(s, `rgba(255,255,255,${a})`));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    }],
    [FX.EMBER]: [16, 16, (ctx, w, h) => {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        [[0, 1], [0.28, 0.95], [0.55, 0.32], [1, 0]].forEach(([s, a]) => g.addColorStop(s, `rgba(255,255,255,${a})`));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    }],
    [FX.BAND]: [8, 64, (ctx, w, h) => {
        // A broad plateau with soft shoulders: a row lights evenly, its edges glow.
        const g = ctx.createLinearGradient(0, 0, 0, h);
        [[0, 0], [0.16, 0.04], [0.27, 0.35], [0.34, 0.9], [0.5, 1], [0.66, 0.9], [0.73, 0.35], [0.84, 0.04], [1, 0]]
            .forEach(([s, a]) => g.addColorStop(s, `rgba(255,255,255,${a})`));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    }],
    [FX.SLAB]: [8, 64, (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        [[0, 0], [0.05, 0.12], [0.11, 0.62], [0.15, 0.95], [0.5, 1], [0.85, 0.95], [0.89, 0.62], [0.95, 0.12], [1, 0]]
            .forEach(([s, a]) => g.addColorStop(s, `rgba(255,255,255,${a})`));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    }],
    [FX.FLARE]: [128, 16, (ctx, w, h) => {
        const img = ctx.createImageData(w, h);
        for (let y = 0; y < h; y++) {
            const dy = (y + 0.5 - h / 2) / (h / 2);
            const vy = Math.exp(-dy * dy * 9);
            for (let x = 0; x < w; x++) {
                const dx = (x + 0.5 - w / 2) / (w / 2);
                const vx = (1 - dx * dx) ** 2;
                const i = (y * w + x) * 4;
                img.data[i] = 255;
                img.data[i + 1] = 255;
                img.data[i + 2] = 255;
                img.data[i + 3] = Math.round(255 * clamp01(vx * vy));
            }
        }
        ctx.putImageData(img, 0, 0);
    }],
    [FX.SMEAR]: [32, 64, (ctx, w, h) => {
        const img = ctx.createImageData(w, h);
        for (let y = 0; y < h; y++) {
            // Clear at the top, bright at the foot; the last rows fade out so a
            // wrapping sampler can never carry the bright foot to the top edge.
            const vy = y >= h - 2 ? 0 : ((y + 0.5) / (h - 2)) ** 2.2;
            for (let x = 0; x < w; x++) {
                const dx = (x + 0.5 - w / 2) / (w / 2);
                const vx = 1 - dx ** 6; // soft sides, so neighbouring columns merge
                const i = (y * w + x) * 4;
                img.data[i] = 255;
                img.data[i + 1] = 255;
                img.data[i + 2] = 255;
                img.data[i + 3] = Math.round(255 * clamp01(vx * vy));
            }
        }
        ctx.putImageData(img, 0, 0);
    }],
    [FX.RING]: [128, 128, (ctx, w, h) => {
        const img = ctx.createImageData(w, h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const dx = (x + 0.5 - w / 2) / (w / 2);
                const dy = (y + 0.5 - h / 2) / (h / 2);
                const r = Math.sqrt(dx * dx + dy * dy);
                const d = (r - 0.84) / 0.07;
                const a = r > 1 ? 0 : Math.exp(-d * d) + 0.06 * clamp01(1 - r);
                const i = (y * w + x) * 4;
                img.data[i] = 255;
                img.data[i + 1] = 255;
                img.data[i + 2] = 255;
                img.data[i + 3] = Math.round(255 * clamp01(a));
            }
        }
        ctx.putImageData(img, 0, 0);
    }],
    [FX.RISE]: [8, 64, (ctx, w, h) => {
        // Bright at the foot, gone at the top; the last rows stay clear (see SMEAR).
        const g = ctx.createLinearGradient(0, h - 2, 0, 0);
        [[0, 1], [0.12, 0.7], [0.35, 0.3], [0.65, 0.08], [1, 0]].forEach(([s, a]) => g.addColorStop(s, `rgba(255,255,255,${a})`));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h - 2);
    }],
    [FX.SHARD]: [14, 14, (ctx, w, h) => {
        const r = 3;
        ctx.fillStyle = 'rgba(255,255,255,1)';
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.lineTo(w - r, 0);
        ctx.quadraticCurveTo(w, 0, w, r);
        ctx.lineTo(w, h - r);
        ctx.quadraticCurveTo(w, h, w - r, h);
        ctx.lineTo(r, h);
        ctx.quadraticCurveTo(0, h, 0, h - r);
        ctx.lineTo(0, r);
        ctx.quadraticCurveTo(0, 0, r, 0);
        ctx.fill();
    }],
};

/**
 * Makes the kit's textures for this scene's game (once). False when the scene cannot
 * make canvas textures.
 * @param {Phaser.Scene} scene
 * @returns {boolean}
 */
export function ensureFxTextures(scene) {
    const textures = scene?.textures;
    if (!textures || typeof textures.exists !== 'function') return false;
    if (textures.exists(FX.SHARD) && textures.exists(FX.GLOW)) return true;
    if (typeof textures.createCanvas !== 'function') return false;
    try {
        Object.entries(PAINTERS).forEach(([key, [w, h, paint]]) => {
            if (textures.exists(key)) return;
            const tex = textures.createCanvas(key, w, h);
            const ctx = tex?.getContext?.();
            if (!ctx) return;
            paint(ctx, w, h);
            tex.refresh?.();
        });
    } catch (e) {
        return false;
    }
    return textures.exists(FX.SHARD) && textures.exists(FX.GLOW);
}

// Light blend per renderer: true additive, [ONE, ONE] on colour and alpha.
const LIGHT_BLEND = new WeakMap();

/**
 * The blend mode for light (sprites, emitters, Graphics fallbacks).
 *
 * Phaser's ADD is [ONE, DST_ALPHA], which is additive only on an opaque canvas. The
 * board canvas is transparent (the well shows through), so there ADD scales whatever
 * is already drawn by its alpha: a light laid over another light darkens it across
 * the whole quad (dark bands beside a clear's blade, a dark square behind a ring).
 * [ONE, ONE] adds premultiplied light and its coverage, which is the same on an
 * opaque canvas and right on a transparent one. Registered once per renderer;
 * Phaser's own ADD where there is no WebGL renderer (canvas, headless).
 * @param {Phaser.Scene} scene
 * @returns {number|string}
 */
export function lightBlend(scene) {
    const renderer = scene?.sys?.renderer ?? scene?.renderer ?? scene?.game?.renderer;
    const gl = renderer?.gl;
    if (!gl || typeof renderer.addBlendMode !== 'function' || !Array.isArray(renderer.blendModes)) {
        return (typeof window !== 'undefined' ? window.Phaser?.BlendModes?.ADD : undefined) ?? 'ADD';
    }
    let mode = LIGHT_BLEND.get(renderer);
    if (mode === undefined) {
        renderer.addBlendMode([gl.ONE, gl.ONE], gl.FUNC_ADD);
        // Phaser 4.2's addBlendMode returns the index before the new one: read it back.
        mode = renderer.blendModes.length - 1;
        LIGHT_BLEND.set(renderer, mode);
    }
    return mode;
}

/**
 * An additive light sprite, or null when the scene has no images.
 * @param {Phaser.Scene} scene
 * @param {string} key one of FX
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts]
 * @param {number} [opts.tint]
 * @param {number} [opts.alpha]
 * @param {number} [opts.width] display width
 * @param {number} [opts.height] display height
 * @param {number} [opts.depth]
 * @param {number} [opts.scroll] scroll factor (0 = screen space; 1 = Infinity's world)
 * @param {number} [opts.originX]
 * @param {number} [opts.originY]
 * @param {boolean} [opts.normal] normal blend instead of additive
 * @returns {Phaser.GameObjects.Image|null}
 */
export function addLight(scene, key, x, y, opts = {}) {
    if (typeof scene?.add?.image !== 'function' || !scene.textures?.exists?.(key)) return null;
    const img = scene.add.image(x, y, key);
    if (!img) return null;
    img.setOrigin?.(opts.originX ?? 0.5, opts.originY ?? 0.5);
    if (opts.width !== undefined || opts.height !== undefined) {
        img.setDisplaySize?.(opts.width ?? img.width, opts.height ?? img.height);
    }
    if (opts.tint !== undefined) img.setTint?.(opts.tint);
    img.setAlpha?.(opts.alpha ?? 1);
    img.setDepth?.(opts.depth ?? 8);
    img.setScrollFactor?.(opts.scroll ?? 0);
    img.setBlendMode?.(opts.normal ? 0 : lightBlend(scene));
    return img;
}

/** Destroys an object once a tween is done with it. */
export const destroyOnComplete = (obj) => () => obj?.destroy?.();
