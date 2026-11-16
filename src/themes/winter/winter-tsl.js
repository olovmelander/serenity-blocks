/**
 * Winter — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once and reads no uniform or texture carries
 *    `setLayout`, so it is emitted ONCE as a real shader function instead of being inlined;
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): noise
 *    is ONE tileable half-float texture baked on the CPU (value, its gradient, a second value),
 *    hashes are hash-without-sine;
 *  - nothing is lit by a light: every surface shades itself (MeshBasicNodeMaterial) from the
 *    shared uniforms below — the moon, the twilight along the horizon, the sky they hang in and
 *    the fires that burn in it;
 *  - everything is scene-linear and unbounded (HDR): the post stack owns the tone map.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    log,
    max,
    min,
    mix,
    sin,
    smoothstep,
    sqrt,
    step,
    texture,
    uniform,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    GUST_SLOTS,
    GUST_SPEED,
    HOURS,
    ICE_Y,
    RING_FADE,
    RING_REACH,
    RING_SLOTS,
    RING_TAU,
    SKY_HOLD,
    SKY_LET_GO,
    SKY_SLOTS,
    STRUM_FADE,
    STRUM_SLOTS,
    TAU,
    glowDirection,
    moonDirection,
    mulberry32,
} from './winter-core.js';

export * from './winter-core.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const wHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'w_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const wHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'w_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec2 → vec3 in [0,1) */
export const wHash23 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yzz).mul(p3.zyx));
}).setLayout({ name: 'w_hash23', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec2' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const wLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const wMax3 = (c) => max(c.x, max(c.y, c.z));

/** (1 − |x|)² inside |x| < 1, else 0: a cheap bell with compact support. */
export const wBell = (x) => {
    const k = max(float(1.0).sub(abs(x)), 0.0);
    return k.mul(k);
};

/** x², x⁴, x⁸ as products (pow() of a base a hair under zero is NaN). */
export const wSq = (x) => x.mul(x);
export const wPow4 = (x) => wSq(wSq(x));
export const wPow8 = (x) => wSq(wPow4(x));

// ── The noise texture ───────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * Periodic fBm gradient noise: (value in 0..1, its gradient per texture width ×2, a second,
 * unrelated value in 0..1).
 * @returns {Float32Array} size × size × 4
 */
export function bakeNoise(seed = 0x7ac0, size = NOISE_SIZE) {
    const n = size;
    const rand = mulberry32(seed);
    const out = new Float32Array(n * n * 4);
    const field = new Float32Array(n * n);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    for (let pass = 0; pass < 2; pass++) {
        field.fill(0);
        let amp = 1;
        for (let o = 0; o < 5; o++) {
            const period = 4 << o;
            const gx = new Float32Array(period * period);
            const gy = new Float32Array(period * period);
            for (let i = 0; i < gx.length; i++) {
                const a = rand() * TAU;
                gx[i] = Math.cos(a);
                gy[i] = Math.sin(a);
            }
            const scale = period / n;
            for (let y = 0; y < n; y++) {
                const fy = y * scale;
                const y0 = Math.floor(fy);
                const ty = fy - y0;
                const y1 = (y0 + 1) % period;
                const sy = fade(ty);
                for (let x = 0; x < n; x++) {
                    const fx = x * scale;
                    const x0 = Math.floor(fx);
                    const tx = fx - x0;
                    const x1 = (x0 + 1) % period;
                    const sx = fade(tx);
                    const i00 = y0 * period + x0;
                    const i10 = y0 * period + x1;
                    const i01 = y1 * period + x0;
                    const i11 = y1 * period + x1;
                    const d00 = gx[i00] * tx + gy[i00] * ty;
                    const d10 = gx[i10] * (tx - 1) + gy[i10] * ty;
                    const d01 = gx[i01] * tx + gy[i01] * (ty - 1);
                    const d11 = gx[i11] * (tx - 1) + gy[i11] * (ty - 1);
                    const top = d00 + (d10 - d00) * sx;
                    const bottom = d01 + (d11 - d01) * sx;
                    field[y * n + x] += (top + (bottom - top) * sy) * amp;
                }
            }
            amp *= 0.55;
        }
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < field.length; i++) {
            if (field[i] < lo) lo = field[i];
            if (field[i] > hi) hi = field[i];
        }
        const inv = 1 / Math.max(1e-6, hi - lo);
        for (let i = 0; i < field.length; i++) field[i] = (field[i] - lo) * inv;
        if (pass === 0) {
            for (let y = 0; y < n; y++) {
                for (let x = 0; x < n; x++) {
                    const o = (y * n + x) * 4;
                    const l = field[y * n + ((x + n - 1) % n)];
                    const r = field[y * n + ((x + 1) % n)];
                    const d = field[((y + n - 1) % n) * n + x];
                    const u = field[((y + 1) % n) * n + x];
                    out[o] = field[y * n + x];
                    // Slope across one texture width, scaled so it sits in about −1..1.
                    out[o + 1] = (r - l) * n * 0.5 * 0.05;
                    out[o + 2] = (u - d) * n * 0.5 * 0.05;
                }
            }
        } else {
            for (let i = 0; i < field.length; i++) out[i * 4 + 3] = field[i];
        }
    }
    return out;
}

/** The noise field as a tileable half-float texture with a CPU-built mip chain. */
export function createNoiseTexture(field, size = NOISE_SIZE) {
    const mipmaps = [];
    let level = field;
    let w = size;
    for (;;) {
        const half = new Uint16Array(level.length);
        for (let i = 0; i < level.length; i++) half[i] = THREE.DataUtils.toHalfFloat(level[i]);
        mipmaps.push({ data: half, width: w, height: w });
        if (w === 1) break;
        const nw = w >> 1;
        const next = new Float32Array(nw * nw * 4);
        for (let y = 0; y < nw; y++) {
            for (let x = 0; x < nw; x++) {
                const a = (y * 2 * w + x * 2) * 4;
                const b2 = a + 4;
                const c2 = a + w * 4;
                const d2 = c2 + 4;
                const o = (y * nw + x) * 4;
                for (let c = 0; c < 4; c++) {
                    next[o + c] = (level[a + c] + level[b2 + c] + level[c2 + c] + level[d2 + c]) * 0.25;
                }
            }
        }
        level = next;
        w = nw;
    }
    const tex = new THREE.DataTexture(mipmaps[0].data, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.mipmaps = mipmaps;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = false;
    // The snow reads it at a grazing angle: without this its drifts blur to nothing.
    tex.anisotropy = 8;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'winter-noise';
    tex.needsUpdate = true;
    return tex;
}

/** The trees' moon shadows as a texture over the snowfield: 1 = in the light, 0 = shadowed. */
export function createShadowTexture(data, size) {
    const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'winter-moon-shadows';
    tex.needsUpdate = true;
    return tex;
}

// ── The look's numbers ──────────────────────────────────────────────────────────

/**
 * The look's numbers, read when the materials are built. The playground overrides any of them
 * from the URL (`P.<name>=<value>`) before the world is built; the theme ships these.
 */
export const LOOK = {
    // The aurora's sheet, along its height `a` above its foot (km): it switches on sharply between
    // footFrom and footTo (a real curtain's lower border is crisp), then decays over
    // `tall` = ray² · tallRay + tallBase. Rays a hundred kilometres tall ran every sheet off the
    // top of the frame as a comb.
    auroraFootFrom: -1.2,
    auroraFootTo: 1.2,
    auroraTallRay: 60.0,
    auroraTallBase: 15.0,
    // The hem: the curtain is brightest just above its foot (its strength, and how fast it falls
    // off, km), so the folds read as a bright ribbon with the rays rising from it.
    auroraHem: 2.2,
    auroraHemFall: 6.0,
    // The rays: how much of the sheet's light is in them (bright = ray · gain + base: the sheet
    // glows between them, so they are not on/off strands), and how fast a ray's strength changes
    // up its length (noise units per km), so a ray fades in and out instead of standing as a line.
    auroraRayGain: 0.8,
    auroraRayBase: 0.4,
    auroraRayAlong: 0.003,
    auroraRayFrom: 0.24,
    auroraRayTo: 0.8,
    // How much of its light a sheet keeps between its rays as a smooth arc (form.rays = 0) and as a
    // comb of rays (form.rays = 1): [rays' share, the glow between them].
    auroraArcGain: 0.15,
    auroraArcBase: 0.85,
    // An energetic sheet fills in between its rays (their heights even out, a glow rises under
    // them): four sheets of on/off rays stacked on one another read as a bar code over the sky.
    auroraFill: 0.62,
    // Its top turns the deep red of the highest aurora when it burns hard (0 = never).
    auroraRedTop: 0.55,
    // The corona: how bright the rays that converge overhead are, and how fast they fall off
    // from the point they converge on (per unit of tangent).
    coronaGain: 1.5,
    coronaFall: 1.1,
    // The high thin cloud: how bright the moon makes it round itself, and how much of what is
    // behind it shows through where it is thickest.
    veilSilver: 1.5,
    veilThrough: 0.42,
    // The band of the galaxy over the left of the sky (0 = none).
    milkyWay: 1.0,
    // The far range behind the fells: where its crests stand (the sine of their elevation: the
    // lowest saddle, and what the highest summit adds), how much of it is lost to the air, and
    // how dark its rock is against its snow.
    rangeBase: 0.12,
    rangeRise: 0.125,
    // The fells' own relief: gullies and shoulders the moon rakes across (the slope two reads
    // of the noise give the far ground; 0 = the smooth backs the plan's heights alone draw).
    fellRelief: 0.5,
    rangeAir: 0.56,
    rangeRock: 0.7,
    // The moon's face: its brightness (scene-linear, × the hour's moon colour) and its seas'
    // albedo against the highlands' 1.
    moonGain: 1.6,
    moonSea: 0.4,
    // Where the seas' field turns to sea (higher: fewer, smaller seas).
    moonSeaFrom: 0.56,
    // The snow's surface: broad swells (their slope, and the noise tiles per metre) and the long
    // ripple's share of its old strength.
    snowSwell: 0.8,
    snowSwellScale: 0.011,
    snowRipple: 0.3,
    // The moon's path on the snow: a sharp lobe (16th power) and a broad one (4th). Snow scatters
    // light; a sharp mirror lobe on its bumps drew water's highlights. The sparkle carries the path.
    snowSheen: 0.1,
    snowSheenBroad: 0.1,
    // How bright each of the fox of light's veils is where it faces the eye.
    spiritVeil: 0.35,
    // The snow ghosts' boughs under their pillows: how far noise breaks up where the needles show
    // (in the bough mask's units), how much of the sky's light reaches them, and how much rime
    // frosts the needles.
    treeNeedleBreak: 0.4,
    treeBoughSky: 0.3,
    treeRime: 0.45,
    // The polar bear's coat: a cream a shade warmer than the snow (its albedo), and how strongly
    // its outline is lit through the hair against the moon.
    bearCoatR: 0.94,
    bearCoatG: 0.9,
    bearCoatB: 0.8,
    bearRim: 1.0,
    // Its shadow on the ice: how dark at its heart; and the shade under its body.
    bearShadow: 0.5,
    bearContact: 0.5,
    // Its mirror image in the bare ice: how much of the ice's mirror it takes.
    bearMirror: 0.85,
};

/** Apply overrides ({ name: number }) to LOOK; unknown names and non-numbers are ignored. */
export function tuneLook(overrides) {
    if (!overrides) return;
    Object.keys(overrides).forEach((key) => {
        const v = Number(overrides[key]);
        if (key in LOOK && Number.isFinite(v)) LOOK[key] = v;
    });
}

// ── The aurora's sheets ─────────────────────────────────────────────────────────

/** The height of the aurora's foot, in the units its sheets are laid out in ("km"). */
export const AURORA_FOOT = 100;

/**
 * The sheets of the aurora, nearest the horizon first. Each hangs over a line on the ground
 * `reach` away, turned by `turn` about the vertical; it folds sideways by `fold` over waves of
 * `wave` per unit along it; its rays stand `rays` per unit apart.
 */
export const CURTAINS = Object.freeze([
    {
        reach: 400, turn: 0.3, fold: 58, wave: 0.0082, rays: 0.019, gain: 1,
    },
    {
        reach: 262, turn: -0.2, fold: 44, wave: 0.0115, rays: 0.026, gain: 0.9,
    },
    {
        reach: 600, turn: -0.52, fold: 76, wave: 0.0058, rays: 0.015, gain: 0.75,
    },
    {
        reach: 196, turn: 0.58, fold: 34, wave: 0.0145, rays: 0.032, gain: 0.8,
    },
]);

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const v3 = (a) => uniform(new THREE.Vector3(a[0], a[1], a[2]));

/** A sky colour's "let go at" while it is held (far past any run's clock; finite for the GPU). */
export const HELD = 1e7;

/**
 * Every uniform the world's materials share. The world owns the values; materials only read.
 * @param {{ noise: THREE.Texture, shadow: THREE.Texture }} textures
 */
export function createWinterUniforms(textures) {
    const hour = HOURS[0].calm;
    const moon = moonDirection(16 / 9);
    const glow = glowDirection(16 / 9);
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Pixels one metre covers at one metre from the eye. */
        pxScale: uniform(1000),
        /** 0..1: how brightly the fires burn (combo). */
        power: uniform(0),
        /** 0..1.4: the overdrive after a four-line clear. */
        surge: uniform(0),
        /** Gain on every light: a four-line clear holds the night's breath (→ 0.12). */
        breath: uniform(1),
        /** Unit vector toward the moon, and the bearing the twilight glows from (unit, xz). */
        moonDir: uniform(new THREE.Vector3(moon[0], moon[1], moon[2])),
        glowDir: uniform(new THREE.Vector2(glow[0], glow[1])),
        // The hour (scene-linear), eased by the world between levels and by the charge.
        zenith: v3(hour.zenith),
        band: v3(hour.band),
        glow: v3(hour.glow),
        haze: v3(hour.haze),
        moonCol: v3(hour.moon),
        shade: v3(hour.shade),
        fire: v3(hour.fire),
        crown: v3(hour.crown),
        stars: uniform(hour.stars),
        /** Cells of sparkle across one unit of the snow's screen-even grid (set on resize). */
        glintGrid: uniform(170),
        /** The ring of ice-light round the moon (0..1). */
        halo: uniform(0.12),
        /** How bright each sheet of the aurora burns. */
        curtains: uniform(new THREE.Vector4(0.3, 0, 0, 0)),
        /** How far the aurora's rays have run (they run faster as the fires rise). */
        auroraRun: uniform(0),
        /** Clears strum the sky: per slot (birth time, strength, half width, speed), STRUM_SLOTS. */
        strums: [],
        /**
         * The form the aurora takes (winter-weather.js): (rays: how much of a sheet's light is in
         * its rays, folds: how deeply the sheets fold, tall: how tall the rays stand, hem: how bright
         * the lower border is), each against the planned sheet; and (corona: rays that converge on
         * a point overhead, pulse: how far the light gathers into patches that pulse, red: how far
         * the tops burn red, spare).
         */
        form: uniform(new THREE.Vector4(0.6, 1, 1, 1)),
        form2: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** The point the corona's rays converge on (a unit vector), and its own right and up. */
        coronaDir: uniform(new THREE.Vector3(0, 0.56, -0.83)),
        coronaRight: uniform(new THREE.Vector3(1, 0, 0)),
        coronaUp: uniform(new THREE.Vector3(0, 0.83, 0.56)),
        /**
         * The weather (winter-weather.js): (snow: the share of the snowfall's pool in the air, veil:
         * high thin cloud over the sky, mist: how thick it lies on the lake, dust: diamond dust).
         */
        weather: uniform(new THREE.Vector4(1 / 1.6, 0.3, 0.35, 0)),
        /** (how large the flakes are, how far the high cloud has drifted in its own plane: x, z, spare). */
        weather2: uniform(new THREE.Vector4(1, 0, 0, 0)),
        /** The air's own thickness: (the mist on the lake, the haze everywhere), per metre. */
        air: uniform(new THREE.Vector2(1 / 1500, 1 / 6500)),
        /**
         * Pillars of light over the far land: (how bright the fires' own stand, how far they have
         * risen 0..1.5, how bright the moon's pale ones stand in the ice haze, spare).
         */
        pillars: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** A twist winds the fires into a spiral: (bearing as tan, elevation as tan, birth time, strength) + colour. */
        swirlA: uniform(new THREE.Vector4(0, 0.3, -100, 0)),
        swirlC: uniform(new THREE.Vector3(0.3, 1, 0.6)),
        /**
         * How hot play runs (src/themes/shared/gameplay-surge.js), as the world spends it on the
         * snow, the air and the ice: (glitter: how much of the snow and the air's diamond dust is
         * alight, fever: how far they take the fires' colours, crown: a perfect clear's flash
         * through all of them, pillar: the column of light that stands over the moon).
         */
        heat: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** How far the wind has carried things (metres, xz) and how hard it blows now. */
        windRun: uniform(new THREE.Vector2(0, 0)),
        gale: uniform(0.2),
        /** The fox: where it is, and how brightly it burns. */
        foxPos: uniform(new THREE.Vector3(0, 0, -9)),
        foxGlow: uniform(0),
        /** How far its eyes are shut (0 open .. 1 shut: a blink, or asleep). */
        foxEyes: uniform(0),
        /**
         * The polar bear's shadow on the ice: (x, z of its middle, half its length along the
         * moon's bearing, half its width across it).
         */
        bearShadow: uniform(new THREE.Vector4(0, -900, 1, 1)),
        /** ...and the shade its body leaves on the ice under it: (x, z of its middle, its heading's sin, cos). */
        bearContact: uniform(new THREE.Vector4(0, -900, 0, 1)),
        /** How much of the lake's ice is under it (0 on a spit's snow .. 1): its mirror image needs ice. */
        bearIce: uniform(1),
        /** The fox of light in the sky: (bearing as tan, elevation as tan, strength, spare). */
        spirit: uniform(new THREE.Vector4(0, 0.3, 0, 0)),
        /** The moon shadows' map covers (x0, z0, 1/width, 1/depth). */
        shadowRect: uniform(new THREE.Vector4(-64, -118, 1 / 128, 1 / 128)),
        /** Powder rings on the snow: (x, z, birth time, strength) + (colour, reach fraction). */
        ringA: [],
        ringC: [],
        /** Gusts over the snow: (x, z, birth time, strength). */
        gustA: [],
        /** Colours the sky holds: (bearing as tan, arrival time, strength, let go at) + colour. */
        skyA: [],
        skyC: [],
        noiseTex: textures.noise,
        shadowTex: textures.shadow,
    };
    for (let i = 0; i < RING_SLOTS; i++) {
        u.ringA.push(uniform(new THREE.Vector4(0, 0, -100, 0)));
        u.ringC.push(uniform(new THREE.Vector4(1, 1, 1, 1)));
    }
    for (let i = 0; i < GUST_SLOTS; i++) {
        u.gustA.push(uniform(new THREE.Vector4(0, 0, -100, 0)));
    }
    for (let i = 0; i < SKY_SLOTS; i++) {
        u.skyA.push(uniform(new THREE.Vector4(0, -100, 0, HELD)));
        u.skyC.push(uniform(new THREE.Vector3(1, 1, 1)));
    }
    for (let i = 0; i < STRUM_SLOTS; i++) {
        u.strums.push(uniform(new THREE.Vector4(-100, 0, 0.34, 1.5)));
    }
    u.noise = (st) => texture(u.noiseTex, st);
    return u;
}

// ── Light ───────────────────────────────────────────────────────────────────────

/**
 * The sky a direction ends in, without its stars, its moon or its fires: the gradient from the
 * horizon's haze through the pale band to the zenith, the last light where it lies along the
 * horizon, and the moon's aureole. Every material uses it as the colour of distance.
 */
export const wSky = (u, dir) => {
    const up = clamp(dir.y, 0.0, 1.0);
    const flat = dir.xz.div(max(length(dir.xz), 1e-3));
    const toward = dot(flat, u.glowDir).mul(0.5).add(0.5);
    const lobe = toward.mul(toward).mul(toward);
    const foot = mix(u.haze, u.glow, lobe);
    const grad = mix(mix(foot, u.band, smoothstep(0.0, 0.2, up)), u.zenith, smoothstep(0.07, 0.72, up));
    // The last light is brightest on the horizon itself.
    const arch = u.glow.mul(exp(up.mul(-11.0))).mul(lobe).mul(0.5);
    const cs = max(dot(dir, u.moonDir), 0.0);
    const cs8 = wPow8(cs);
    const aureole = u.moonCol.mul(wPow8(cs8).mul(0.2).add(cs8.mul(0.03)));
    return grad.add(arch).add(aureole).mul(u.breath.mul(0.65).add(0.35));
};

/**
 * The colour the sky's fires have at a bearing (tan of it): their own, or what a piece gave
 * them. vec4(rgb, how much brighter than usual).
 */
export const wSkyTint = (u, q, base) => {
    let weight = float(0.0);
    let tint = vec3(0.0);
    let flash = float(0.0);
    for (let i = 0; i < SKY_SLOTS; i++) {
        const A = u.skyA[i];
        const age = u.time.sub(A.y);
        const near = exp(wSq(q.sub(A.x).div(0.3)).negate());
        // (A colour whose slot is wanted for a new one lets go over SKY_LET_GO, never at once.)
        const letGo = clamp(float(1.0).sub(u.time.sub(A.w).div(SKY_LET_GO)), 0.0, 1.0);
        const w = near.mul(A.z).mul(exp(max(age, 0.0).div(-SKY_HOLD))).mul(step(0.0, age)).mul(letGo);
        weight = weight.add(w);
        tint = tint.add(u.skyC[i].mul(w));
        flash = flash.add(w.mul(exp(max(age, 0.0).div(-0.7))));
    }
    const held = tint.div(max(weight, 1e-3));
    return vec4(mix(base, held, clamp(weight, 0.0, 1.0).mul(0.9)), flash);
};

/**
 * The aurora along a direction. A sheet hangs over a line on the ground and folds sideways; the
 * view ray is met with it by a fixed-point walk (three steps hold for these folds), which gives
 * the true perspective for nothing: sheets arch toward the horizon at their ends, folds
 * foreshorten, rays converge overhead. `count` sheets; `fine` = false drops the rays (mirrors).
 */
export const wAurora = (u, dir, { count = 3, fine = true, tint = null } = {}) => {
    const q = dir.x.div(max(dir.z.negate(), 0.2));
    // A clear strums every sheet outward from the board; a cascade's waves follow one another
    // out like plucked strings, each deeper one wider and faster.
    let strum = float(0.0);
    for (let i = 0; i < STRUM_SLOTS; i++) {
        const S = u.strums[i];
        const strumAge = u.time.sub(S.x);
        strum = strum.add(exp(wSq(abs(q).sub(strumAge.mul(S.w)).div(S.z)).negate())
            .mul(S.y).mul(exp(max(strumAge, 0.0).div(-STRUM_FADE))).mul(step(0.0, strumAge)));
    }
    // (The sky hands in the colour it has already worked out for this bearing; a mirror works its own.)
    const tinted = tint || wSkyTint(u, q, u.fire);
    // (The fox of light brightens the sky it runs under.)
    const underSpirit = exp(wSq(q.sub(u.spirit.x).div(0.5)).negate()).mul(u.spirit.z);
    // (Strums that overlap ride up together under a soft ceiling: they pluck the fires, never
    // blow the whole sky out.)
    const plucked = strum.div(strum.mul(0.45).add(1.0));
    const lift = float(1.0).add(tinted.w.mul(1.5)).add(plucked.mul(1.6)).add(underSpirit.mul(1.0));
    let sum = vec3(0.0);
    const energies = [u.curtains.x, u.curtains.y, u.curtains.z, u.curtains.w];
    // The form the night has given it (winter-weather.js): a smooth arc, a comb of rays, deep
    // folds, patches that pulse.
    const rayed = u.form.x;
    const folded = u.form.y;
    const height = u.form.z;
    const hemmed = u.form.w;
    const pulsing = u.form2.y;
    for (let i = 0; i < Math.min(count, CURTAINS.length); i++) {
        const c = CURTAINS[i];
        const E = energies[i];
        const cs = Math.cos(c.turn);
        const sn = Math.sin(c.turn);
        const dx = dir.x.mul(cs).sub(dir.z.mul(sn));
        const dz = dir.x.mul(sn).add(dir.z.mul(cs));
        const fwd = max(dz.negate(), 0.07);
        const phase = i * 2.4 + 0.7;
        const run = u.auroraRun.mul(0.21 + i * 0.05);
        const fold = (x) => sin(x.mul(c.wave).add(phase).add(run)).mul(c.fold)
            .add(sin(x.mul(c.wave * 2.7).sub(phase * 1.7).add(run.mul(1.6))).mul(c.fold * 0.4))
            .mul(folded);
        let t = float(c.reach).div(fwd);
        t = float(c.reach).add(fold(dx.mul(t))).div(fwd);
        t = float(c.reach).add(fold(dx.mul(t))).div(fwd);
        const x = dx.mul(t);
        const a = dir.y.mul(t).sub(AURORA_FOOT);
        // Seen edge on, a fold is brighter: the ray runs along the sheet.
        const slope = cos(x.mul(c.wave).add(phase).add(run)).mul(c.fold * c.wave)
            .add(cos(x.mul(c.wave * 2.7).sub(phase * 1.7).add(run.mul(1.6))).mul(c.fold * 0.4 * c.wave * 2.7))
            .mul(folded);
        const flatLength = length(vec2(dx, dz));
        const edgeOn = min(sqrt(float(1.0).add(wSq(slope))).mul(flatLength)
            .div(max(abs(dz.add(dx.mul(slope))), flatLength.mul(0.36))), 2.6);
        const broad = u.noise(vec2(x.mul(c.rays * 0.16).add(run.mul(0.06)), i * 0.31 + 0.11));
        const patch = smoothstep(0.28, 0.72, broad.r);
        // An energetic sheet fills in between its rays.
        const filled = smoothstep(0.75, 1.6, E).mul(LOOK.auroraFill);
        let ray = float(0.5);
        let hair = float(1.0);
        if (fine) {
            // (The rays are spaced by the broad pattern too: evenly spaced, they read as a comb.)
            const along = x.mul(c.rays).add(broad.a.mul(2.6)).sub(run.mul(0.5));
            const strands = u.noise(vec2(along, a.mul(LOOK.auroraRayAlong).add(i * 0.17 + 0.63)));
            ray = smoothstep(LOOK.auroraRayFrom, LOOK.auroraRayTo, strands.r);
            // Fine rays ride on the broad ones, and are never all one width.
            hair = u.noise(vec2(x.mul(c.rays * 2.3).add(run.mul(0.8)), i * 0.23 + 0.37)).a.mul(0.7).add(0.65);
            hair = mix(float(1.0), hair, rayed.mul(0.7).add(0.3));
        }
        // How tall this ray stands, and how tall the sheet stands about it: the colour climbs with
        // the sheet's height, not with each ray's, so a ray is green at its foot and violet at its
        // top instead of every other ray being one colour from foot to top.
        const span = E.mul(0.5).add(0.65).mul(height);
        const rise = mix(ray.mul(ray), float(0.3), filled).mul(mix(float(0.25), float(1.0), rayed));
        const tall = rise.mul(LOOK.auroraTallRay).add(LOOK.auroraTallBase).mul(span);
        const sheetTall = mix(float(0.075), float(0.3), rayed).mul(LOOK.auroraTallRay).add(LOOK.auroraTallBase)
            .mul(span);
        let body = smoothstep(LOOK.auroraFootFrom, LOOK.auroraFootTo, a).mul(exp(max(a, 0.0).div(tall).negate()));
        if (LOOK.auroraHem > 0) {
            body = body.mul(float(1.0).add(exp(max(a, 0.0).div(-LOOK.auroraHemFall)).mul(hemmed.mul(LOOK.auroraHem))));
        }
        const inRays = mix(float(LOOK.auroraArcGain), float(LOOK.auroraRayGain), rayed);
        const between = mix(float(LOOK.auroraArcBase), float(LOOK.auroraRayBase), rayed).add(filled.mul(0.5));
        // Patches that pulse: each brightens and sinks at its own beat, a few seconds to a breath.
        const beat = sin(u.time.mul(1.25 + i * 0.31).add(broad.a.mul(21.0)).add(i * 2.1)).mul(0.5).add(0.5);
        const patches = mix(float(1.0), wSq(beat).mul(patch).mul(1.9).add(0.12), pulsing);
        const bright = patch.mul(1.5).add(0.1).mul(ray.mul(inRays).add(between)).mul(hair)
            .mul(patches);
        // The foot of an energetic sheet burns rose.
        const hem = exp(wSq(a.sub(1.5).div(6.0)).negate()).mul(smoothstep(0.7, 1.6, E));
        const climbed = max(a, 0.0).div(sheetTall);
        // ...and its top the deep red of the highest air, when it burns hard.
        const red = smoothstep(1.3, 3.2, climbed).mul(smoothstep(0.6, 1.5, E)).mul(u.form2.z);
        const colour = mix(mix(tinted.rgb, u.crown, smoothstep(0.12, 1.15, climbed)), vec3(1.0, 0.1, 0.2), red)
            .add(vec3(1.0, 0.3, 0.62).mul(hem.mul(0.9)));
        // It sinks into the haze at its ends and is lost behind the fells.
        const fade = smoothstep(0.012, 0.085, dir.y).mul(exp(t.mul(-1 / 1700)));
        sum = sum.add(colour.mul(body.mul(bright).mul(E).mul(c.gain).mul(fade)
            .mul(edgeOn)));
    }
    // The brightest folds saturate toward their own colour, never to white.
    const lit = sum.mul(lift);
    return lit.div(wMax3(lit).div(3.4).add(1.0)).mul(u.breath);
};

/**
 * The corona: when the aurora breaks up overhead its rays, which all run along the same lines,
 * are seen from below and converge on one point of the sky. Here that point stands just over the
 * top of the frame above the board, so the rays fan down either side of it: a crown over the
 * board. `u.form2.x` is how bright it burns; `tinted` is the colour the fires have at this bearing
 * (wSkyTint). Two noise reads; the caller skips it when it is out.
 */
export const wCorona = (u, dir, tinted) => {
    const facing = max(dot(dir, u.coronaDir), 0.12);
    const p = vec2(dot(dir, u.coronaRight), dot(dir, u.coronaUp)).div(facing);
    const r = length(p);
    // Rays are read along their own bearing round the point and nothing else: a read that also
    // varies with the distance out turns rays to smoke. A whole number of tiles of noise goes
    // once round, so the bearing's own seam (−π meets π) is no seam in the texture.
    const turn = atan(p.y, p.x).mul(5 / TAU);
    const bundles = u.noise(vec2(turn.add(u.auroraRun.mul(0.0035)), 0.37)).r;
    const fineRays = u.noise(vec2(turn.mul(4.0).sub(u.auroraRun.mul(0.009)), min(r, 0.7).mul(0.03).add(0.71))).a;
    const ray = smoothstep(0.34, 0.66, bundles).mul(wSq(fineRays).mul(2.0).add(0.16));
    // Dark at the point itself, brightest a little way out, gone by the horizon.
    const reach = smoothstep(0.05, 0.32, r).mul(exp(r.mul(-LOOK.coronaFall)));
    // Light runs out along the rays.
    const shimmer = sin(r.mul(8.0).sub(u.time.mul(2.6)).add(bundles.mul(14.0))).mul(0.22).add(0.78);
    const colour = mix(tinted.rgb, u.crown, smoothstep(0.3, 1.5, r))
        .add(vec3(1.0, 0.3, 0.62).mul(exp(r.mul(-4.5)).mul(0.6)));
    const lit = colour.mul(ray.mul(reach).mul(shimmer).mul(u.form2.x).mul(LOOK.coronaGain)
        .mul(smoothstep(0.012, 0.085, dir.y)));
    return lit.div(wMax3(lit).div(3.4).add(1.0)).mul(u.breath);
};

/**
 * A twist winds the fires into a spiral: two arms that open from a point in the sky, turn as
 * they spread and are gone in a few seconds, in the piece's colour at the heart and the hour's
 * crown at the rim. One noise read; the caller skips it when there is none.
 */
export const wSwirl = (u, dir) => {
    const fwd = max(dir.z.negate(), 0.2);
    const p = vec2(dir.x.div(fwd).sub(u.swirlA.x), dir.y.div(fwd).sub(u.swirlA.y));
    const r = max(length(p), 1e-3);
    const age = max(u.time.sub(u.swirlA.z), 0.0);
    const opened = float(1.0).sub(exp(age.div(-0.7)));
    const size = opened.mul(0.42).add(0.05);
    const bearing = atan(p.y, p.x);
    const wound = bearing.mul(2.0).sub(log(r.div(size)).mul(3.4)).sub(age.mul(2.6));
    const arms = wPow4(sin(wound).mul(0.5).add(0.5));
    // (Threads along the arms: read along the spiral's own winding, slowly across it.)
    const threads = u.noise(vec2(wound.mul(1 / TAU), r.div(size).mul(0.35).add(0.19))).r.mul(0.9).add(0.4);
    const body = arms.mul(threads).mul(exp(wSq(r.div(size)).mul(-1.2))).mul(smoothstep(0.0, 0.25, r.div(size)));
    const heart = exp(wSq(r.div(size.mul(0.22))).negate()).mul(0.7);
    const env = smoothstep(0.0, 0.18, age).mul(exp(age.div(-1.9))).mul(u.swirlA.w)
        .mul(step(0.0, u.time.sub(u.swirlA.z)));
    const colour = mix(u.swirlC, u.crown, smoothstep(0.35, 1.2, r.div(size)));
    const lit = colour.mul(body.add(heart)).mul(env).mul(2.6).mul(smoothstep(0.012, 0.085, dir.y));
    return lit.div(wMax3(lit).div(3.4).add(1.0)).mul(u.breath);
};

/**
 * Pillars of light standing over the far land, in the fires' colours: a perfect clear stands
 * them up one after another along the whole horizon. No noise: a pillar is a hash of the
 * bearing's cell.
 */
export const wPillars = (u, dir) => {
    const q = dir.x.div(max(dir.z.negate(), 0.2));
    const cells = q.mul(5.2).add(64.0);
    const cell = floor(cells);
    const h = wHash23(vec2(cell, 7.0));
    const off = cells.sub(cell).sub(0.5).sub(h.x.sub(0.5).mul(0.56));
    const wide = h.y.mul(0.07).add(0.05);
    const shaft = exp(wSq(off.div(wide)).negate());
    const top = h.z.mul(0.2).add(0.16);
    const up = max(dir.y, 0.0);
    // Each stands up at its own moment as the row rises.
    const risen = smoothstep(h.z.mul(0.6), h.z.mul(0.6).add(0.4), u.pillars.y);
    const lifted = top.mul(risen.mul(0.75).add(0.25));
    const flicker = sin(u.time.mul(h.x.mul(2.0).add(1.4)).add(up.mul(36.0)).add(h.y.mul(40.0))).mul(0.14).add(0.86);
    const cool = mix(u.fire, vec3(0.5, 0.85, 1.0), step(0.5, h.x));
    const warm = mix(u.crown, vec3(1.0, 0.45, 0.75), step(0.75, h.y));
    const hue = mix(cool, warm, step(0.5, h.y));
    const fires = hue.mul(risen).mul(u.pillars.x).mul(exp(wSq(up.div(lifted)).mul(-1.4)));
    return fires.mul(shaft).mul(smoothstep(0.0, 0.03, up)).mul(flicker).mul(u.breath);
};

/** The far range's crests stand under this (the sine of an elevation): above it there is only sky. */
export const RANGE_TOP = 0.26;
/** Its rows of summits: [how far apart they stand (radians of bearing), how tall against the look's rise, seed]. */
const RANGE_ROWS = Object.freeze([[0.21, 1, 11], [0.083, 0.5, 29]]);

/**
 * The far range: sharp summits behind the round fells, pale in the air. vec4(colour, how much of
 * the sky it hides). It is a painted skyline, not ground: a row of hashed summits gives the
 * crest and which way each face is turned, and one noise read lays ribs of rock and chutes of
 * snow down the faces. `air` is the colour of the sky behind it, which it pales toward.
 *
 * The moon stands ahead and to the right, so faces turned right are moonlit and faces turned
 * left are in shade, where the last light on the horizon reaches them: two tones, as on the
 * drifts at the viewer's feet.
 */
export const wRange = (u, dir, air) => {
    const straight = atan(dir.x, dir.z.negate());
    // (No mountain's flank is a ruled line: the bearing is bent by a slow read before the summits
    // are laid on it, and the same read notches the crest.)
    const rough = u.noise(vec2(straight.mul(1.7).add(0.21), dir.y.mul(2.2).add(0.47)));
    const bearing = straight.add(rough.r.sub(0.5).mul(0.085));
    // The skyline is the highest of a row of summits, each a peak with straight flanks: where it
    // stands, how tall and how steep are hashed from its place in the row, so the skyline is
    // sharp at any size and costs no read. Two rows: the great summits and the lesser ones
    // between them. (`over`: this summit's height over the pixel's bearing; `from`: how far the
    // pixel is to the right of its top; `top`: how tall it is.)
    let over = float(0.0);
    let from = float(0.0);
    let top = float(1.0);
    RANGE_ROWS.forEach(([width, gain, seed]) => {
        const place = bearing.div(width).add(64.0);
        for (let k = -1; k <= 1; k++) {
            const cell = floor(place).add(k);
            const h = wHash23(vec2(cell, seed));
            const centre = cell.sub(64.0).add(0.5).add(h.x.sub(0.5).mul(0.7)).mul(width);
            const tall = wSq(h.y).mul(0.85).add(0.15).mul(gain * LOOK.rangeRise);
            const d = bearing.sub(centre);
            const here = tall.sub(abs(d).mul(h.z.mul(0.5).add(0.5)));
            const wins = step(over, here);
            over = mix(over, here, wins);
            from = mix(from, d, wins);
            top = mix(top, tall, wins);
        }
    });
    const crest = over.add(rough.a.sub(0.5).mul(0.022)).add(LOOK.rangeBase);
    // +1: this side of the summit falls away to the right (it is turned to the moon); −1: to the left.
    const side = clamp(from.mul(70.0), -1.0, 1.0);
    const below = max(crest.sub(dir.y), 0.0);
    // Ribs of rock and chutes of snow run down from the top: the read is along the bearing about
    // the summit as seen from it, so its streaks fan out from the top down each face.
    const fan = from.div(max(top.add(LOOK.rangeBase).sub(dir.y), 0.004));
    const ribs = u.noise(vec2(fan.mul(0.55).add(top.mul(31.0)), below.mul(1.5).add(0.61))).r;
    const moonLit = smoothstep(-0.2, 0.6, side).mul(0.8).add(0.06);
    const flat = dir.xz.div(max(length(dir.xz), 1e-3));
    const toward = dot(flat, u.glowDir).mul(0.5).add(0.5);
    const snow = vec3(0.9, 0.93, 1.0).mul(
        u.moonCol.mul(moonLit).add(u.shade.mul(0.85)).add(u.zenith.mul(0.25))
            .add(u.glow.mul(max(side.negate(), 0.0).mul(0.5).add(0.12)).mul(wSq(toward))),
    );
    // Rock shows on the steep faces under the crest, in ribs; lower down the snow lies unbroken.
    const steep = abs(side).mul(smoothstep(0.09, 0.0, below));
    const rock = smoothstep(0.5, 0.64, ribs).mul(steep).mul(LOOK.rangeRock);
    const burning = u.curtains.x.add(u.curtains.y).add(u.curtains.z).add(u.curtains.w);
    const face = mix(snow, vec3(0.05, 0.06, 0.09).add(u.shade.mul(0.3)), rock)
        .add(mix(u.fire, u.crown, 0.25).mul(burning.mul(0.02)))
        .mul(u.breath.mul(0.65).add(0.35));
    // (About a pixel of soft edge at 1080p: the skyline is drawn, not sampled.)
    const hides = smoothstep(crest.add(0.0012), crest.sub(0.0012), dir.y);
    return vec4(mix(face, air, LOOK.rangeAir), hides);
};

/**
 * The high thin cloud that drifts over on some nights: vec4(its own light, how much of the sky
 * behind it is hidden). Long fibres run with the wind (one noise read stretched eight to one,
 * its domain bent by a slow warp at a much lower frequency), thicker in lumps; the moon lights it
 * silver round itself, the last light warms it on the horizon, and the fires put a little of
 * their colour under it. `u.weather.y` is how much of it there is.
 */
export const wVeil = (u, dir, { lumps = true } = {}) => {
    const up = max(dir.y, 0.0);
    const q = dir.xz.div(up.add(0.17));
    const drift = u.weather2.yz;
    const warp = u.noise(q.mul(0.043).add(drift.mul(0.3)));
    const at = vec2(q.x.mul(0.05), q.y.mul(0.4)).add(warp.gb.mul(0.05)).add(drift);
    let field = u.noise(at).r;
    if (lumps) field = field.mul(0.62).add(u.noise(q.mul(0.12).add(drift.mul(1.9)).add(vec2(0.5, 0.2))).a.mul(0.38));
    const cover = u.weather.y;
    const from = mix(float(0.74), float(0.2), cover);
    const dense = smoothstep(from, from.add(0.34), field).mul(smoothstep(0.0, 0.08, cover));
    // Thin toward the zenith, where one looks straight through it; gone into the haze at the horizon.
    const hidden = dense.mul(1 - LOOK.veilThrough).mul(smoothstep(0.0, 0.06, up)).mul(float(1.0).sub(up.mul(0.45)));
    const cs = max(dot(dir, u.moonDir), 0.0);
    const cs4 = wPow4(cs);
    const cs16 = wPow4(cs4);
    const silver = u.moonCol.mul(wPow4(cs16).mul(1.1).add(cs16.mul(0.5)).add(cs4.mul(0.16))
        .add(0.1)
        .mul(LOOK.veilSilver));
    const flat = dir.xz.div(max(length(dir.xz), 1e-3));
    const toward = dot(flat, u.glowDir).mul(0.5).add(0.5);
    const warm = u.glow.mul(wSq(toward).mul(toward).mul(exp(up.mul(-7.0))).mul(0.85));
    const burning = u.curtains.x.add(u.curtains.y).add(u.curtains.z).add(u.curtains.w);
    const under = mix(u.fire, u.crown, 0.3).mul(burning.mul(0.035));
    const own = u.shade.mul(0.85).add(u.band.mul(0.3)).add(silver).add(warm)
        .add(under);
    return vec4(own.mul(u.breath.mul(0.65).add(0.35)), hidden);
};

/**
 * How far the wind has swept the lake's ice bare at world point `p` (0 under snow .. 1 bare ice),
 * most of all along the moon's bearing, so its path lies on ice. `driftR` is the snow's drift
 * noise there (the ground's `u.noise(vec2(p.x·0.043, p.z·0.17)).r`): the ground and the bear's
 * mirror image read the same ice.
 */
export const wIceSwept = (u, p, driftR) => {
    const swept = u.noise(vec2(p.x.mul(0.0052), p.z.mul(0.015)).add(vec2(0.3, 0.7))).r;
    const moonPath = exp(wSq(p.x.sub(p.z.negate().mul(u.moonDir.x.div(u.moonDir.z.negate()))).div(46.0)).negate());
    return smoothstep(0.36, 0.5, swept.add(driftR.sub(0.5).mul(0.22)).add(moonPath.mul(0.16)));
};

/** The trees' moon shadow at a point on the snow: 0 in shadow, 1 in the moon's light. */
export const wMoonShadow = (u, xz) => {
    const st = xz.sub(u.shadowRect.xy).mul(u.shadowRect.zw);
    return texture(u.shadowTex, clamp(st, 0.0, 1.0)).r;
};

/**
 * Apply the air to a shaded colour at world point `p`: a thin ice haze, and a mist that lies
 * over the lake. What is lost is replaced by the sky that stands behind.
 */
export const wAir = (u, col, p, gain = 1) => {
    const rel = p.sub(cameraPosition);
    const dist = length(rel);
    const dir = rel.div(max(dist, 1e-3));
    const low = exp(max(p.y.add(cameraPosition.y).mul(0.5).sub(ICE_Y), 0.0).div(-16.0));
    // (How thick the mist lies and how hazy the air is are the weather's: u.air.)
    const depth = dist.mul(low.mul(u.air.x).add(u.air.y)).mul(u.gale.mul(0.5).add(0.9));
    const lost = float(1.0).sub(exp(depth.mul(gain).negate()));
    // (A hand above the horizon, not on it: the last light is brightest on the horizon itself,
    // and air thick with snow or ice took its rose and laid it over the fells.)
    const flat = vec3(dir.x, max(dir.y, 0.0).mul(0.5).add(0.045), dir.z);
    return mix(col, wSky(u, flat.div(length(flat))), lost);
};

/** Light of the powder rings at world point `p`: vec4(colour, how much of a ring is here). */
export const wRingLight = (u, p) => {
    let sum = vec3(0.0);
    let amount = float(0.0);
    for (let i = 0; i < RING_SLOTS; i++) {
        const A = u.ringA[i];
        const age = u.time.sub(A.z);
        const radius = u.ringC[i].w.mul(RING_REACH).mul(float(1.0).sub(exp(max(age, 0.0).div(-RING_TAU))));
        const d = length(p.xz.sub(A.xy));
        const shell = wBell(d.sub(radius).div(u.ringC[i].w.mul(0.75).add(0.55)));
        const env = exp(max(age, 0.0).mul(-RING_FADE)).mul(step(0.0, age)).mul(A.w);
        sum = sum.add(u.ringC[i].rgb.mul(shell.mul(env)));
        amount = amount.add(shell.mul(env));
    }
    return vec4(sum, amount);
};

/**
 * The gusts at world point `p`: vec3(push.x, push.z, how hard it blows here now). A gust is a
 * front that leaves from under the board and crosses the snow, with a tail of moving air.
 */
export const wGust = (u, p) => {
    let push = vec2(0.0);
    let blow = float(0.0);
    for (let i = 0; i < GUST_SLOTS; i++) {
        const A = u.gustA[i];
        const age = u.time.sub(A.z);
        const rel = p.xz.sub(A.xy);
        const d = length(rel);
        const behind = age.mul(GUST_SPEED).sub(d);
        const env = smoothstep(-2.5, 1.0, behind).mul(exp(max(behind, 0.0).div(-14.0)))
            .mul(exp(max(age, 0.0).div(-3.2))).mul(step(0.0, age))
            .mul(A.w);
        push = push.add(rel.div(max(d, 0.5)).mul(env));
        blow = blow.add(env);
    }
    return vec3(push, blow);
};

// ── Materials and geometry ──────────────────────────────────────────────────────

/** Clip position of a world point (for parts that build their own vertex position). */
export const wClip = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

/** An opaque self-shaded material. */
export function wSolidMaterial(name) {
    const m = new THREE.MeshBasicNodeMaterial();
    m.name = name;
    m.fog = false;
    return m;
}

/** A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes. */
export function wFxMaterial(name, { depthTest = true } = {}) {
    const m = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest,
        side: THREE.DoubleSide,
    });
    m.name = name;
    m.fog = false;
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    m.forceSinglePass = true;
    return m;
}

/**
 * A unit quad (xy in −0.5..0.5, uv 0..1) for `count` instances.
 * @param {number} count
 * @param {Record<string, [Float32Array, number]>} attributes  name → [data, itemSize]
 */
export function wQuadGeometry(count, attributes = {}) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    Object.keys(attributes).forEach((name) => {
        const [data, itemSize] = attributes[name];
        geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, itemSize));
    });
    geometry.instanceCount = count;
    return geometry;
}

/** The mesh wrapper every part returns. */
export function wPart(name, geometry, material, renderOrder = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, material, geometry };
}
