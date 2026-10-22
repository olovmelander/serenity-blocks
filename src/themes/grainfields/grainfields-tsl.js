/**
 * Grainfields — shared TSL: the uniforms every part reads, the baked noise, and the storm deck's
 * cover (one function the sky, the land's shadows, the fells and the light shafts all read, so
 * every shaft and every patch of sun on the fields belongs to a gap in the cloud overhead).
 *
 * One set of uniforms (createUniforms) is the scene's state on the GPU. The world writes it; the
 * materials read it. Readers that sample a texture or read a uniform are inline builders (a laid-
 * out Fn may not capture either); pure arithmetic helpers carry a layout.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    max,
    min,
    mix,
    smoothstep,
    texture,
    uniform,
    uniformArray,
    vec2,
    vec3,
} from 'three/tsl';
import {
    DECK, EYE, mulberry32,
} from './grainfields-core.js';
import { PATH_POINTS } from './grainfields-plan.js';

export * from './grainfields-core.js';

// ── Small helpers ─────────────────────────────────────────────────────────────────

/** vec2 → [0, 1) */
export const gfHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'gf_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec2 → vec2 in [0, 1) */
export const gfHash22 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.xx.add(p3.yz).mul(p3.zy));
}).setLayout({ name: 'gf_hash22', type: 'vec2', inputs: [{ name: 'pIn', type: 'vec2' }] });

export const gfLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));
export const gfMax3 = (c) => max(c.x, max(c.y, c.z));

// ── Baked noise ───────────────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * Tileable value-noise fBm, four independent fields (RGBA) at lattice periods 8, 16, 32 and 64
 * across the tile: broad, mid, fine and grain. A read at xz / D has features D / period wide.
 */
export function bakeNoise(size = NOISE_SIZE, seed = 0x6a1f) {
    const out = new Uint8Array(size * size * 4);
    const lattices = [8, 16, 32, 64].map((period, c) => {
        const random = mulberry32(seed + c * 977);
        const values = new Float32Array(period * period);
        for (let i = 0; i < values.length; i++) values[i] = random();
        return { period, values };
    });
    const fade = (t) => t * t * (3 - 2 * t);
    const valueAt = (lat, x, y) => {
        const { period, values } = lat;
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const tx = fade(x - xi);
        const ty = fade(y - yi);
        const at = (a, b) => values[(((b % period) + period) % period) * period + (((a % period) + period) % period)];
        const a = at(xi, yi);
        const b = at(xi + 1, yi);
        const c = at(xi, yi + 1);
        const d = at(xi + 1, yi + 1);
        return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    };
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            for (let c = 0; c < 4; c++) {
                let sum = 0;
                let amp = 0.5;
                let norm = 0;
                for (let o = 0; o < 4 && c + o < 4; o++) {
                    const lat = lattices[c + o];
                    sum += amp * valueAt(lat, (i / size) * lat.period, (j / size) * lat.period);
                    norm += amp;
                    amp *= 0.5;
                }
                if (c === 3) {
                    sum = valueAt(lattices[3], (i / size) * 64, (j / size) * 64);
                    norm = 1;
                }
                out[(j * size + i) * 4 + c] = Math.round((sum / norm) * 255);
            }
        }
    }
    return out;
}

/** The noise bake is deterministic: one copy per page, however many times the world is built. */
let cachedNoise = null;
export function noiseData() {
    if (!cachedNoise) cachedNoise = bakeNoise();
    return cachedNoise;
}

export function createNoiseTexture(data = noiseData()) {
    const tex = new THREE.DataTexture(data, NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'grainfields-noise';
    tex.needsUpdate = true;
    return tex;
}

// ── The scene's state ─────────────────────────────────────────────────────────────

/**
 * Gaps the locks tear in the deck at once (each two rows in `gaps`): twelve standing, the rest
 * room for those fading out (grainfields-reactions.js LIVE, FADE). The loops read only the count.
 */
export const GAPS = 16;
/** Trails of wind the clears send across the fields at once (each three rows in `trails`): six, and three fading. */
export const TRAILS = 9;
/** Pulses of wind in the grain at once (a hard drop's ring, a T-spin's whirl, a level's wave): six, and three fading. */
export const PULSES = 9;
/** Gaps whose shafts stand in the air in front of the fells at the storm break. */
export const RAYS = 4;
/** Points of the path's centre line the shaders read. */
export const PATH_ROWS = PATH_POINTS.length;

const rows = (count) => Array.from({ length: count }, () => new THREE.Vector4(0, 0, 0, 0));
const colour = (r, g, b) => uniform(new THREE.Vector3(r, g, b));

export function createUniforms() {
    const tables = {
        // per gap: (deck x, deck z, radius m, strength 0..1) + (piece rgb linear, open time)
        gaps: rows(GAPS * 2),
        // per trail: (start x, start z, start time, power) + (heading x, heading z, curl, width)
        //          + (cleared rows' colour rgb, side)
        trails: rows(TRAILS * 3),
        // the path's centre line: (x, z, along 0..1, flower half-width)
        path: rows(PATH_ROWS),
        // per fell shaft's gap: (world x, world z, radius m, strength 0..1)
        rays: rows(RAYS),
        // per pulse: (centre x, centre z, start time, power) + (kind, speed m/s, width m, unused)
        pulses: rows(PULSES * 2),
    };
    return {
        tables,
        gaps: uniformArray(tables.gaps, 'vec4'),
        trails: uniformArray(tables.trails, 'vec4'),
        path: uniformArray(tables.path, 'vec4'),
        rays: uniformArray(tables.rays, 'vec4'),
        pulses: uniformArray(tables.pulses, 'vec4'),
        pulseCount: uniform(0, 'int'),
        gapCount: uniform(0, 'int'),
        trailCount: uniform(0, 'int'),

        time: uniform(0),
        /** The deck's drift (metres, integrated on the CPU): a deck point p is noise point p + wind. */
        drift: uniform(new THREE.Vector2(0, 0)),
        /** The gusts in the grain: their phase (metres along the wind, integrated) and the wind's heading. */
        gust: uniform(0),
        windDir: uniform(new THREE.Vector2(0.82, 0.57)),
        /** The wind's strength in the grain (0 still … ~1.6 a chain's gale). */
        windStrength: uniform(1),

        eye: uniform(new THREE.Vector3(EYE.x, EYE.y, EYE.z)),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        camFwd: uniform(new THREE.Vector3(0, 0, -1)),
        tanHalfFov: uniform(0.4),
        aspect: uniform(16 / 9),
        /** Radians per pixel of the buffer drawn. */
        pixelAngle: uniform(0.0007),

        sunDir: uniform(new THREE.Vector3(-0.42, 0.38, -0.82)),
        /** How much of the disc stands clear of the far hills: the direct light's last gate. */
        sunUp: uniform(1),
        /** How far the sky is in daylight (0 the twilight, 1 day). */
        day: uniform(1),
        sun: colour(3.7, 3.1, 2.3),
        fill: colour(0.085, 0.11, 0.19),
        bounce: colour(0.15, 0.11, 0.035),
        zenith: colour(0.03, 0.075, 0.22),
        horizon: colour(0.7, 0.78, 0.9),
        glow: colour(1.35, 1.15, 0.85),
        haze: colour(0.38, 0.44, 0.55),
        mist: colour(0.66, 0.71, 0.78),
        cloudLit: colour(1.55, 1.48, 1.38),
        cloudShade: colour(0.055, 0.068, 0.092),
        hazeDensity: uniform(1),
        mistDensity: uniform(0.5),
        stars: uniform(0),
        /** Game over: the light falls (0..1). */
        dusk: uniform(0),

        // ── The storm deck ──
        /** The hour's cover (0 clear … 1 overcast), after the chain's break and a perfect clear. */
        cover: uniform(0.8),
        /** The gap the sun shines through at the storm break: (world x, world z, radius, strength). */
        sunGap: uniform(new THREE.Vector4(0, 0, 900, 1)),
        /** The storm's core, where the deck is heaviest: (world x, world z, radius, strength). */
        stormCore: uniform(new THREE.Vector4(0, -12000, 9000, 0)),
        /** The deck field's thresholds: (the hour's cover, the core's cover), from deckThreshold. */
        deckLo: uniform(new THREE.Vector2(0.39, 0.33)),
        /** Four lines: the tear over the gate: (deck x, deck z, radius, strength). */
        tear: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** The deck's march: samples along a ray (a uniform, so no compiler unrolls the loop). */
        cloudSteps: uniform(18, 'int'),
        /** 1 when the post marches the shafts (the land then leaves the sunlit air to it). */
        airMarch: uniform(1),
        /** Rain hanging under the storm's core (0 none … 1 the storm break's heaviest). */
        rain: uniform(0),

        // ── Gameplay ──
        /** The storm breaking with a chain (0..1): cover thins, the light lifts, the wind rises. */
        breaking: uniform(0),
        /** Perfect clear: the sky clear (0..1) and the wind's stillness (0..1). */
        clearSky: uniform(0),
        still: uniform(0),
        /** A level-up: when the skein of geese lifted off the field to fly out through the gate. */
        skein: uniform(-1e6),
        /** A four-line clear's flare on the field (0..1) and the front of its light (metres from the gate). */
        flare: uniform(0),
        flareFront: uniform(0),
    };
}

// ── The deck ──────────────────────────────────────────────────────────────────────

/**
 * Voronoi cells at a point (in cell units): (distance to the nearest centre, to the second). The
 * deck's underside is a field of rounded cells (stratocumulus seen from below): a cell's heart is
 * thick and dark, its seams thin and pale. Laid out, so its body is emitted once per stage.
 */
export const gfCells = /* @__PURE__ */ Fn(([p]) => {
    const ip = floor(p);
    const fp = fract(p);
    const d1 = float(8.0).toVar();
    const d2 = float(8.0).toVar();
    for (let j = -1; j <= 1; j += 1) {
        for (let i = -1; i <= 1; i += 1) {
            const o = vec2(i, j);
            const h = gfHash22(ip.add(o));
            const d = length(o.add(h).sub(fp));
            d2.assign(min(d2, max(d1, d)));
            d1.assign(min(d1, d));
        }
    }
    return vec2(d1, d2);
}).setLayout({ name: 'gf_cells', type: 'vec2', inputs: [{ name: 'p', type: 'vec2' }] });

/** The deck's noise point for a world xz: drifted with the wind aloft and gently warped. */
export function deckPoint(u, noise, xz) {
    const p = xz.add(u.drift);
    const warp = texture(noise, p.div(52000.0)).rg.sub(0.5).mul(520.0);
    return p.add(warp);
}

/**
 * The storm's core: where the deck is heaviest. At the storm break it lies out along the sun's
 * bearing (the fells and the middle distance stand in its shade while the sun looks through
 * its own gap); `stormCore` = (centre x, centre z, radius, strength), set by the world.
 */
export function coreCover(u, xz) {
    const d = xz.sub(u.stormCore.xy);
    const r = max(u.stormCore.z, 1.0);
    return exp(dot(d, d).div(r.mul(r)).negate()).mul(u.stormCore.w);
}

/**
 * The deck's own cloud at a point of the deck plane (world xz): the stratocumulus field before
 * any gap is torn in it (0 clear … 1 thick). Two broad reads (r: 8 cells a tile, ~4 km; g: 16
 * cells, ~1 km). The threshold follows the fBm's own spread (mean 0.5, sd ≈ 0.12), so the cover
 * is close to the share of the sky that is cloud; inside the storm's core the cover rises toward
 * 0.95. Inline (texture reads).
 */
export function deckField(u, noise, xz, liftIn = 0, edge = 1) {
    const lift = float(liftIn);
    const q = deckPoint(u, noise, xz);
    const broad = texture(noise, q.div(34000.0)).r;
    const mid = texture(noise, q.div(17000.0).add(vec2(0.31, 0.77))).g;
    // Round a torn gap the cloud frays: finer billows break its edge (only there, so the deck's
    // own cover keeps the measured quantiles).
    const torn = lift.mul(3.333);
    const fray = clamp(torn.mul(float(1.0).sub(torn)).mul(4.0), 0.0, 1.0);
    const detail = texture(noise, q.div(5200.0).add(vec2(0.53, 0.19))).a.mul(0.6)
        .add(texture(noise, q.div(2400.0).add(vec2(0.11, 0.67))).b.mul(0.4));
    const base = broad.mul(0.68).add(mid.mul(0.32)).add(detail.sub(0.5).mul(0.16).mul(fray));
    // The threshold for the hour's cover and for the core's, read off the field's own quantiles
    // on the CPU (deckThreshold), so `cover` is the share of the deck that is cloud.
    // A gap raises the threshold where it is torn: its edge follows the billows (ragged, not round).
    const lo = mix(u.deckLo.x, u.deckLo.y, coreCover(u, xz)).add(lift);
    // (`edge` widens the cloud's margin: the marched volume wants a soft one.)
    return smoothstep(lo.sub(0.022 * edge), lo.add(0.055 * edge), base);
}

/**
 * The deck field's quantiles: DECK_QUANTILES[k] is the field's value below which a share k / 20
 * of the deck lies (measured over 200 000 points of the baked noise, seed 0x6a1f; mean 0.501,
 * sd 0.093). The cloud is where the field stands above the threshold.
 */
export const DECK_QUANTILES = Object.freeze([
    0.2, 0.348, 0.38, 0.401, 0.419, 0.435, 0.449, 0.463, 0.477, 0.49, 0.503,
    0.515, 0.528, 0.541, 0.554, 0.568, 0.583, 0.6, 0.62, 0.651, 0.8,
]);

/** The field's threshold for a cover (0 clear … 1 overcast): the (1 − cover) quantile. */
export function deckThreshold(cover) {
    const k = Math.max(0, Math.min(1, 1 - cover)) * 20;
    const i = Math.min(19, Math.floor(k));
    return DECK_QUANTILES[i] + (DECK_QUANTILES[i + 1] - DECK_QUANTILES[i]) * (k - i);
}

/**
 * How much cloud stands at a deck point once the gaps are torn: the field, the sun's gap, every
 * lock's gap (they ride with the deck), the four-line tear, the far edge of the storm (the deck
 * ends tens of kilometres out, so the horizon is bright under it), a chain's break and a
 * perfect clear. 0 open sky … 1 thick cloud.
 */
export function deckCover(u, noise, xz, { locks = true, edge = 1 } = {}) {
    // Every gap as a hole's depth (0..1): the sun's own (held on the sun's line from the eye), the
    // shafts before the fells, the four-line tear, the locks' (deck-fixed: they drift with the cloud they
    // were torn in).
    const gauss = (d, r) => exp(dot(d, d).div(r.mul(r)).negate());
    const hole = gauss(xz.sub(u.sunGap.xy), max(u.sunGap.z, 1.0)).mul(u.sunGap.w).toVar();
    for (let k = 0; k < RAYS; k += 1) {
        const row = u.rays.element(k);
        hole.assign(max(hole, gauss(xz.sub(row.xy), max(row.z, 1.0)).mul(row.w)));
    }
    hole.assign(max(hole, gauss(xz.add(u.drift).sub(u.tear.xy), max(u.tear.z, 1.0)).mul(u.tear.w)));
    // The locks' gaps are metres wide: the march of the light in the air leaves them out (its steps
    // are far longer; their beams are drawn as beams), everything else reads them.
    if (locks) {
        Loop({
            start: int(0), end: u.gapCount, type: 'int', condition: '<', name: 'gap',
        }, ({ gap }) => {
            const row = u.gaps.element(gap.mul(2));
            hole.assign(max(hole, gauss(xz.add(u.drift).sub(row.xy), max(row.z, 1.0)).mul(row.w)));
        });
    }
    // The hole tears the field open along its own billows, and its heart is clear.
    const dens = deckField(u, noise, xz, hole.mul(0.3), edge).toVar();
    dens.mulAssign(float(1.0).sub(smoothstep(0.72, 1.0, hole).mul(0.97)));
    // The storm's far edge, and its thinning with a chain or a perfect clear.
    const far = length(xz.sub(u.eye.xz));
    dens.mulAssign(float(1.0).sub(smoothstep(30000.0, 62000.0, far)));
    dens.mulAssign(float(1.0).sub(u.breaking.mul(0.1)));
    dens.mulAssign(float(1.0).sub(u.clearSky));
    return dens;
}

/** Where the sun's ray through a point meets the deck's base (world xz). */
export function deckPointAbove(u, P) {
    const lift = max(float(DECK.base).sub(P.y), 0.0).div(max(u.sunDir.y, 0.035));
    return P.xz.add(u.sunDir.xz.mul(lift));
}

/**
 * The deck's shadow at a world point: 1 in the sun, ~0.12 under the thick deck (some light
 * always comes through a stratocumulus deck).
 */
export function deckShadow(u, noise, P) {
    const cover = deckCover(u, noise, deckPointAbove(u, P));
    return float(1.0).sub(cover.mul(0.88));
}
