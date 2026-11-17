/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE SEA OF CLOUDS — what gathers below the climb as chapter 5's day ends (the sky pass,
 * 2026-11-17; the evening itself is odyssey-evening.js).
 *
 * From the summit the world below was the noon island and its sea to a hazy horizon. As the
 * evening runs, cloud now gathers over the sea round the island, from the horizon inward, until
 * the mountain stands out of a floor of cloud: sunlit tops and violet troughs in the low sun, the
 * island's lee still open below the eye (the east, where the climb's last views look down on it),
 * the summit's own shadow lying across the tops toward the antisolar point, with a glory at its
 * tip.
 *
 * WHAT IT IS MADE OF. The world's clouds are sculpted hulls (odyssey-cloud-field.js): lobes
 * melted together, a flat base, two painted tones. A floor of cloud seen from above is the same
 * thing by the hundred, so this is the sculptor's grammar as a HEIGHT FIELD: masses of a few
 * primaries with a ring of rim lobes and crown scallops, smooth-max'd, baked once into a tiling
 * plate (height and slope). One ring mesh round the summit's axis is displaced by it, and every
 * pixel reads the plate again for its own normal and its own edge, so the outline of each mass is
 * the lobes' scallops, drawn per pixel, and its paint is the field's (lit where it is high and
 * turned to the sun, the sky's violet where it is low, turned away or in another top's shadow).
 * OPAQUE, like the field: a hard cut on the plate's contour, no blending, depth-tested against
 * the mountain and the sculpted masses it merges with.
 *
 * THE BED (round two, 2026-11-17). Seen from high above at the top of the climb the first cut read
 * as PACK ICE: white plates with crisp outlines on a dark sea, because the lanes between the
 * masses were cut-outs straight down to the ocean. A floor of cloud has no such holes: between
 * its tops lies thinner, lower cloud. So under the tops lies a second, soft layer (one flat,
 * blended sheet a little below the base, in the floor's own shade, its edges a slow fade in the
 * cover and never a contour), every top's foot melts into that bed's colour (no outline), and
 * the low sun's shadows are raked far across the deck (three reads toward the sun). The lanes are
 * hollows of violet haze now, and where the floor ends (toward the island, at its far shore) it
 * thins into mist: the tops only stand where the bed under them is whole (`topsCover`). From very
 * high the whole floor eases into one soft bright sheet with a ragged shore (`soften`), which is
 * the look of the round Earth's own weather where it takes the floor over.
 *
 * (The flat cloud sheet the owner retired in 2026-08 was a soft-alpha plane with no relief; a
 * veil painted on the ground was rejected in 2026-10 because it washed out the island. This is
 * neither: it has the sculpted masses' relief and outline, and it leaves the island open.)
 *
 * ALIVE. The plate drifts downwind, so the floor flows; the cover it is cut at is the world's
 * own (clear over the island's lee, the mountain and the rail), so masses thin as they drift into
 * the clear air and form again upwind; the cover breathes; and the low sun's shadows lie long
 * behind every top.
 *
 * COST. Two draws on one ring: the opaque tops (six plate fetches a pixel on High) and the
 * blended bed (two fetches). High ~55k triangles each; the lower tiers a third of that and no
 * cast shadows. Hidden (no draw) until the evening gathers it and once the round Earth covers
 * the world.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, abs, attribute, clamp, dot, exp, float, frontFacing, length, max, mix, normalize, positionLocal,
    select, sin, smoothstep, texture, uniform, varying, vec2, vec3,
} from 'three/tsl';
import { ODYSSEY_MASSIFS } from './odyssey-world-height.js';
import { ODYSSEY_WORLD_SUN } from '../chapter-environments/shared/chapter-profile.js';
import { ODYSSEY_EVENING_U, eveningCloudLitShare } from './odyssey-evening.js';

const HERO = ODYSSEY_MASSIFS.find((m) => m.id === 'hero');
const SUN_FLAT_LEN = Math.hypot(ODYSSEY_WORLD_SUN[0], ODYSSEY_WORLD_SUN[2]);
const SUN_FLAT = Object.freeze([ODYSSEY_WORLD_SUN[0] / SUN_FLAT_LEN, ODYSSEY_WORLD_SUN[2] / SUN_FLAT_LEN]);
/** The clear sky opposite the sun, ~25 deg up: the light the floor's shade is lit by. */
const MID_SKY = Object.freeze([-SUN_FLAT[0] * 0.906, 0.423, -SUN_FLAT[1] * 0.906]);

export const ODYSSEY_CLOUD_SEA = Object.freeze({
    /** The plate: its side in world units and in texels. */
    tile: 3600,
    res: 256,
    /** The floor's flat base (y) and how high its tallest top stands over it (u). */
    base: 540,
    amp: 380,
    /** Downwind (the summit's wind, toward west-north-west) and how fast the floor flows (u/s). */
    wind: Object.freeze([-0.928, -0.373]),
    speed: 6.5,
    /** The summit's axis: the mesh's centre and the centre of the clear air. */
    centre: Object.freeze({ x: HERO.x, z: HERO.z }),
    /**
     * THE CLEAR AIR. No cloud within `clear[0]` of the summit's axis (the mountain, and the rail
     * climbing its face, 580-650 u out), nor within `clear[1]` toward `open` (a unit bearing, x/z:
     * east-north-east, the island's lee, which the climb's last orbs look down on); the floor is
     * whole `ramp` beyond that.
     */
    clear: Object.freeze([900, 1500]),
    open: Object.freeze([0.94, -0.342]),
    ramp: 900,
    /** The mesh: rings from `inner` to `outer` (geometric), [segments round, rings] by tier. */
    inner: 700,
    outer: 11500,
    grid: Object.freeze({ high: Object.freeze([288, 96]), low: Object.freeze([176, 60]) }),
    /** It gathers from the horizon inward: the floor is whole beyond `gatherFar` first. */
    gatherFar: Object.freeze([1400, 7000]),
    /** The most of the plate the cover ever shows (the rest stays open lanes), and its breath. */
    cover: 0.97,
    breath: 0.05,
    breathPeriod: 47,
    /** The paint (the field's Witness grammar): how the light term is weighed and stepped. */
    paint: Object.freeze({
        // (Round two: more of the light term is the turn to the sun. Lit by height alone, a
        // top seen from above was one flat white plate; each head now has a sunlit side and a
        // shaded one, which is what makes it round.)
        height: 0.56,
        facing: 0.62,
        shadow: 0.50,
        fold: 0.34,
        bias: -0.07,
        /** The lit band's step, and the step from the deep tone to the shade under it. */
        tone: Object.freeze([0.38, 0.64]),
        deep: Object.freeze([0.10, 0.30]),
        shadeLift: 0.80,
        shadeSky: 0.50,
        deepLift: 0.55,
        deepSky: 0.72,
        litGain: 1.10,
    }),
    /** Cast shadows: the distances toward the sun the plate is read at (u), near to far. */
    shadowReach: Object.freeze([150, 420, 950]),
    /** THE BED: how far under the base it lies (u), its most cover, and over how much of a
     * top's own height (0..1) its foot melts into the bed's colour. */
    bed: Object.freeze({ drop: 26, alpha: 0.95, melt: 0.16 }),
    /**
     * FROM VERY HIGH (the top of the climb, where the world is shrunk under the eye): the floor
     * eases into one soft bright sheet, its tops and its bed drawn toward the same pale tone
     * across `soften` (the climb's factor, 1 = not climbing; ~2.5 at L34, ~7 where the Earth
     * takes over). Seen from tens of kilometres a deck of cloud is a soft white mass, which is
     * what the round Earth's own weather looks like where it takes this floor over.
     */
    soften: Object.freeze([1.5, 4.6]),
    softTops: 0.62,
    softBed: 0.80,
    /** THE GLORY: its rings round the antisolar point (degrees), their width, and its light. */
    glory: Object.freeze({
        rings: Object.freeze([3.4, 6.6]), width: 0.80, spread: 0.75, gain: 0.55,
    }),
    /** THE MOUNTAIN'S SHADOW on the floor: the summit's height and half-width at the floor. */
    summitY: HERO.footY + HERO.height,
    summitHalfWidth: 300,
});

/** Mulberry32: the bake's own generator (the layout is pinned by a test). */
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * The plate's lobes, in tile units (0..1 across the tile; heights 0..1 of the floor's relief):
 * the sculptor's grammar laid flat. Each mass: two or three wide low primaries, a golden-angle
 * ring of rim lobes that break its outline, and crown scallops on top.
 * @param {number} [seed]
 * @returns {Array<{x:number, z:number, r:number, top:number}>}
 */
export function planCloudSeaLobes(seed = 20261117) {
    const rnd = rng(seed);
    const lobes = [];
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    // THE FLOOR: wide low pillows that overlap into one rolling sheet, a cell in eight left open
    // (the lanes the island's sea shows through). The masses below stand on it.
    const F = 5;
    for (let i = 0; i < F; i += 1) {
        for (let j = 0; j < F; j += 1) {
            const open = rnd() < 0.13;
            const x = (i + 0.5 + ((rnd() - 0.5) * 0.6)) / F;
            const z = (j + 0.5 + ((rnd() - 0.5) * 0.6)) / F;
            const r = (0.66 + (rnd() * 0.22)) / F;
            const top = 0.24 + (rnd() * 0.18);
            if (!open) {
                lobes.push({
                    x, z, r, top,
                });
            }
        }
    }
    const N = 7;
    for (let i = 0; i < N; i += 1) {
        for (let j = 0; j < N; j += 1) {
            const cx = (i + 0.5 + ((rnd() - 0.5) * 0.7)) / N;
            const cz = (j + 0.5 + ((rnd() - 0.5) * 0.7)) / N;
            // Half-width of the mass, in tile units; a few are wide banks, a few small.
            const size = 0.60 + (rnd() * rnd() * 0.75);
            const halfW = (0.5 / N) * size * 1.30;
            // A few stand tall (the towers of the floor), most are low.
            const tall = 0.50 + (rnd() * rnd() * 0.50);
            const yaw = rnd() * Math.PI;
            const cosY = Math.cos(yaw);
            const sinY = Math.sin(yaw);
            const prim = [];
            const nPrim = 2 + Math.floor(rnd() * 2);
            for (let k = 0; k < nPrim; k += 1) {
                const lx = k === 0 ? 0 : (rnd() - 0.5) * halfW * 1.25;
                const lz = k === 0 ? 0 : (rnd() - 0.5) * halfW * 0.62;
                const r = halfW * (0.60 + (rnd() * 0.22));
                const top = tall * (k === 0 ? 1 : 0.70 + (rnd() * 0.25)) * 0.90;
                const x = cx + ((lx * cosY) - (lz * sinY));
                const z = cz + ((lx * sinY) + (lz * cosY));
                prim.push({
                    x, z, r, top,
                });
                lobes.push({
                    x, z, r, top,
                });
            }
            const nSec = 7 + Math.floor(rnd() * 4);
            for (let k = 0; k < nSec; k += 1) {
                const host = prim[k % nPrim];
                const a = (k * GOLDEN) + (rnd() * 0.35);
                const seat = host.r * (0.70 + (rnd() * 0.26));
                lobes.push({
                    x: host.x + (Math.cos(a) * seat),
                    z: host.z + (Math.sin(a) * seat * 0.8),
                    r: halfW * (0.30 + (rnd() * 0.12)),
                    top: host.top * (0.62 + (rnd() * 0.30)),
                });
            }
            const nTer = 4 + Math.floor(rnd() * 4);
            for (let k = 0; k < nTer; k += 1) {
                const host = prim[k % nPrim];
                const a = (k * GOLDEN * 1.7) + (rnd() * 0.4);
                const seat = host.r * (0.15 + (rnd() * 0.45));
                lobes.push({
                    x: host.x + (Math.cos(a) * seat),
                    z: host.z + (Math.sin(a) * seat * 0.8),
                    r: halfW * (0.20 + (rnd() * 0.09)),
                    top: host.top * (0.98 + (rnd() * 0.22)),
                });
            }
        }
    }
    return lobes;
}

/** Polynomial smooth max of two heights (the melt between lobes). */
function smax(a, b, k) {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.max(a, b) + (h * h * k * 0.25);
}

/**
 * Bake the plate: RGBA8, R the height (0..1 of the relief), G and B its slope along x and z
 * (0.5 = level; +-1 = `SLOPE_RANGE` in relief-per-tile units), A a wide blur of the height (the
 * cover's regional field and the cast shadows' occluder). Tiles exactly (every distance wraps).
 * Pure: same bytes for the same arguments.
 * @param {number} [res]
 * @param {number} [seed]
 * @returns {{data: Uint8Array, res: number, cover: number}} `cover`: the share of texels with cloud
 */
export const CLOUD_SEA_SLOPE_RANGE = 14;
export function bakeCloudSeaField(res = ODYSSEY_CLOUD_SEA.res, seed = 20261117) {
    const lobes = planCloudSeaLobes(seed);
    // Lobes binned on a coarse grid (with wrap), so a texel only visits the lobes that can reach it.
    const B = 12;
    const bins = Array.from({ length: B * B }, () => []);
    lobes.forEach((l) => {
        const binLoX = Math.floor((l.x - l.r) * B);
        const binHiX = Math.floor((l.x + l.r) * B);
        const binLoZ = Math.floor((l.z - l.r) * B);
        const binHiZ = Math.floor((l.z + l.r) * B);
        for (let i = binLoX; i <= binHiX; i += 1) {
            for (let j = binLoZ; j <= binHiZ; j += 1) {
                bins[((((j % B) + B) % B) * B) + (((i % B) + B) % B)].push(l);
            }
        }
    });
    const height = new Float32Array(res * res);
    let covered = 0;
    for (let j = 0; j < res; j += 1) {
        for (let i = 0; i < res; i += 1) {
            const x = (i + 0.5) / res;
            const z = (j + 0.5) / res;
            const bin = bins[(Math.min(Math.floor(z * B), B - 1) * B) + Math.min(Math.floor(x * B), B - 1)];
            let h = 0;
            for (let n = 0; n < bin.length; n += 1) {
                const l = bin[n];
                let dx = Math.abs(x - l.x);
                let dz = Math.abs(z - l.z);
                dx = Math.min(dx, Math.abs(dx - 1), Math.abs(dx + 1));
                dz = Math.min(dz, Math.abs(dz - 1), Math.abs(dz + 1));
                // (a lobe whose centre lies outside 0..1 wraps the other way too)
                const ddx = Math.min(dx, 1 - Math.min(dx, 1));
                const ddz = Math.min(dz, 1 - Math.min(dz, 1));
                const q = ((ddx * ddx) + (ddz * ddz)) / (l.r * l.r);
                if (q < 1) {
                    // A cumulus head, not a hill: a broad round top and a steep flank (a cone's
                    // straight flanks read as snowy peaks from above, the first cut's fault).
                    const dome = l.top * Math.sqrt(1 - (q * q));
                    h = h === 0 ? dome : smax(h, dome, 0.055);
                }
            }
            height[(j * res) + i] = Math.min(h, 1);
            if (h > 0.02) covered += 1;
        }
    }
    // The wide blur (a separable box, wrapped): what the cover's regions and the shadows read.
    const R = Math.max(2, Math.round(res / 28));
    const tmp = new Float32Array(res * res);
    const blur = new Float32Array(res * res);
    const wrap = (v) => ((v % res) + res) % res;
    for (let j = 0; j < res; j += 1) {
        for (let i = 0; i < res; i += 1) {
            let s = 0;
            for (let k = -R; k <= R; k += 1) s += height[(j * res) + wrap(i + k)];
            tmp[(j * res) + i] = s / ((2 * R) + 1);
        }
    }
    for (let j = 0; j < res; j += 1) {
        for (let i = 0; i < res; i += 1) {
            let s = 0;
            for (let k = -R; k <= R; k += 1) s += tmp[(wrap(j + k) * res) + i];
            blur[(j * res) + i] = s / ((2 * R) + 1);
        }
    }
    const data = new Uint8Array(res * res * 4);
    const to8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
    for (let j = 0; j < res; j += 1) {
        for (let i = 0; i < res; i += 1) {
            const at = (ii, jj) => height[(wrap(jj) * res) + wrap(ii)];
            // Central differences, in relief per tile.
            const gx = (at(i + 1, j) - at(i - 1, j)) * res * 0.5;
            const gz = (at(i, j + 1) - at(i, j - 1)) * res * 0.5;
            const o = ((j * res) + i) * 4;
            data[o] = to8(height[(j * res) + i]);
            data[o + 1] = to8(0.5 + (0.5 * Math.max(-1, Math.min(1, gx / CLOUD_SEA_SLOPE_RANGE))));
            data[o + 2] = to8(0.5 + (0.5 * Math.max(-1, Math.min(1, gz / CLOUD_SEA_SLOPE_RANGE))));
            data[o + 3] = to8(blur[(j * res) + i]);
        }
    }
    return { data, res, cover: covered / (res * res) };
}

const smooth01 = (a, b, x) => {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * (3 - (2 * t));
};

/**
 * The cover (0..1: how much of the plate's relief shows) at a world place, for a gathering
 * `gather` (0..1). Pure; the CPU twin of the material's own cover, less its breath and its
 * regional drift (tests and placement read this).
 * @param {number} x @param {number} z world
 * @param {number} gather 0..1 (the evening's `sea`)
 */
export function cloudSeaCover(x, z, gather) {
    const S = ODYSSEY_CLOUD_SEA;
    const dx = x - S.centre.x;
    const dz = z - S.centre.z;
    const r = Math.hypot(dx, dz);
    const toward = r > 1e-6 ? ((dx * S.open[0]) + (dz * S.open[1])) / r : 0;
    const clear = S.clear[0] + ((S.clear[1] - S.clear[0]) * smooth01(-0.45, 0.9, toward));
    const ring = smooth01(clear, clear + S.ramp, r);
    const rim = 1 - smooth01(S.outer * 0.84, S.outer * 0.98, r);
    const near = 1 - smooth01(S.gatherFar[0], S.gatherFar[1], r);
    const g = Math.min(Math.max(Number.isFinite(gather) ? gather : 0, 0), 1);
    const gathered = smooth01(0, 1, (g * 2) - near);
    return ring * rim * gathered * S.cover;
}

/** The ring mesh: `segments` round, `rings` out, radii geometric from `inner` to `outer`. */
function buildSeaGeometry(segments, rings) {
    const S = ODYSSEY_CLOUD_SEA;
    const count = (rings + 1) * segments;
    const position = new Float32Array(count * 3);
    const spacing = new Float32Array(count);
    const ratio = (S.outer / S.inner) ** (1 / rings);
    for (let i = 0; i <= rings; i += 1) {
        const r = S.inner * (ratio ** i);
        for (let j = 0; j < segments; j += 1) {
            // Every other ring is turned half a segment: triangles near equilateral, no spokes.
            const a = ((j + ((i % 2) * 0.5)) / segments) * Math.PI * 2;
            const o = ((i * segments) + j) * 3;
            position[o] = S.centre.x + (Math.cos(a) * r);
            position[o + 1] = S.base;
            position[o + 2] = S.centre.z + (Math.sin(a) * r);
            // The mesh's own spacing here: the displacement reads a mip no finer than this.
            spacing[(i * segments) + j] = Math.max(r * (ratio - 1), (2 * Math.PI * r) / segments);
        }
    }
    const index = new Uint32Array(rings * segments * 6);
    let k = 0;
    for (let i = 0; i < rings; i += 1) {
        for (let j = 0; j < segments; j += 1) {
            const a = (i * segments) + j;
            const b = (i * segments) + ((j + 1) % segments);
            const c = ((i + 1) * segments) + j;
            const d = ((i + 1) * segments) + ((j + 1) % segments);
            // Wound so the front faces up (the floor's tops); odd rings stand half a segment on.
            if (i % 2 === 0) {
                index.set([a, b, c, b, d, c], k);
            } else {
                index.set([a, d, c, a, b, d], k);
            }
            k += 6;
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aSpacing', new THREE.BufferAttribute(spacing, 1));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(S.centre.x, S.base, S.centre.z),
        S.outer + S.amp,
    );
    return { geometry, triangles: rings * segments * 2 };
}

/**
 * @param {object} kit the world's own nodes and paint, handed in by the world renderer
 * @param {object} kit.cameraPosition vec3 node: the eye, in the world group's own frame
 * @param {(dir: object) => object} kit.skyAirAt the world's air for a view direction
 * @param {(colour: object) => object} kit.toCloudOutput the world's output for a cloud
 *   (its grade, the departure's fade, the melt into the round Earth)
 * @param {object} kit.sunColour vec3 node
 * @param {object} kit.cloudWhite vec3 node: the world's cloud white (the evening's)
 * @param {object} kit.aerialK float node: the air's density
 * @param {object} [kit.climb] float node: 1 / the world group's scale (the climb's frame)
 * @param {((xz: object) => object)|null} [kit.cloudShadowLight] the world's drifting cloud shadows
 *   (1 = open sun) at a world place: the shadows of the cumulus above cross the floor too
 * @param {'high'|'low'} [kit.quality]
 * @returns {{mesh: THREE.Group, tops: THREE.Mesh, bed: THREE.Mesh, triangles: number,
 *   update: (time: number, gather: number, shown: boolean) => void, dispose: () => void}}
 */
export function createOdysseyCloudSea({
    cameraPosition, skyAirAt, toCloudOutput, sunColour, cloudWhite, aerialK, climb = float(1),
    cloudShadowLight = null, quality = 'high',
}) {
    const S = ODYSSEY_CLOUD_SEA;
    const P = S.paint;
    const E = ODYSSEY_EVENING_U;
    const lean = quality !== 'high';
    const baked = bakeCloudSeaField(S.res);
    const plate = new THREE.DataTexture(baked.data, baked.res, baked.res, THREE.RGBAFormat, THREE.UnsignedByteType);
    plate.wrapS = THREE.RepeatWrapping;
    plate.wrapT = THREE.RepeatWrapping;
    plate.magFilter = THREE.LinearFilter;
    plate.minFilter = THREE.LinearMipmapLinearFilter;
    plate.generateMipmaps = true;
    plate.colorSpace = THREE.NoColorSpace;
    plate.needsUpdate = true;

    const [segments, rings] = lean ? S.grid.low : S.grid.high;
    const { geometry, triangles } = buildSeaGeometry(segments, rings);

    const uGather = uniform(0);
    // The plate's drift (tile units, wrapped on the CPU) and the breath's clock.
    const uDrift = uniform(new THREE.Vector2(0, 0));
    const uBreath = uniform(0);

    /** The cover at world `xz` (the TSL twin of `cloudSeaCover`, with its regions and breath). */
    /** How far the eye has climbed out over the floor (0..1): see `soften`. */
    const fromHigh = smoothstep(float(S.soften[0]), float(S.soften[1]), climb);
    /** The soft bright sheet the floor becomes from very high: mostly its lit tone. */
    const softSheet = (slateIn, litIn) => mix(slateIn, litIn, float(0.72));

    // (The helpers' parameters carry names of their own, `place`, `regionIn`, ...: the world's
    // source lint follows a positionNode's identifiers through same-file consts by NAME, and a
    // parameter called `xz` would lead it into the fragment stage's unpinned texture reads.)
    const coverAt = (place, regionIn) => {
        const rel = place.sub(vec2(S.centre.x, S.centre.z));
        const r = length(rel);
        const toward = dot(rel, vec2(...S.open)).div(max(r, float(1)));
        const clear = float(S.clear[0])
            .add(smoothstep(float(-0.45), float(0.9), toward).mul(S.clear[1] - S.clear[0]));
        const ring = smoothstep(clear, clear.add(S.ramp), r);
        // The far edge: gone before the mesh's own rim; and seen from very high, where the whole
        // floor is in view, its edge is no circle but the regions' own ragged shore (a round
        // sheet of cloud on the planet below would read as a disc of ice).
        const rimWhole = float(1).sub(smoothstep(float(S.outer * 0.84), float(S.outer * 0.98), r));
        const shore = r.div(S.outer).add(float(0.36).sub(regionIn).mul(2.4));
        const ragged = float(1).sub(smoothstep(float(0.42), float(0.86), shore));
        const rim = rimWhole.mul(mix(float(1), ragged, fromHigh));
        const near = float(1).sub(smoothstep(float(S.gatherFar[0]), float(S.gatherFar[1]), r));
        const gathered = smoothstep(float(0), float(1), uGather.mul(2).sub(near));
        // Regions: the plate's own wide blur read far larger and turned, so which masses stand
        // where never repeats with the plate; and the breath, a slow wave across the floor.
        const breath = sin(uBreath.add(place.x.mul(0.0011)).add(place.y.mul(0.0007))).mul(S.breath);
        const whole = float(S.cover).mul(regionIn.mul(0.30).add(0.84)).add(breath);
        return ring.mul(rim).mul(gathered).mul(whole).clamp(0, 1);
    };
    const plateUv = (place) => place.div(S.tile).add(uDrift);
    const regionUv = (place) => vec2(
        place.x.mul(0.8).sub(place.y.mul(0.6)),
        place.x.mul(0.6).add(place.y.mul(0.8)),
    ).div(S.tile * 3.7).add(uDrift.mul(0.31));
    /**
     * The cover the TOPS stand by: none until the bed under them is whole, then rising with it.
     * So wherever the floor ends (toward the island's clear air, at its far shore, where it is
     * still gathering) it ends as haze thinning away, and the tops come up out of that haze
     * further in: never a plate with a cut edge standing over open sea.
     */
    const topsCover = (coverIn) => coverIn.mul(smoothstep(float(0.38), float(0.72), coverIn));
    /** The relief (0..1) left standing above the cover's cut. */
    const standing = (hIn, coverIn) => max(hIn.sub(float(1).sub(coverIn)), 0).div(max(coverIn, float(0.05)));

    /**
     * The bed's colour: the floor's deep and shade tones, turning slowly with the plate's wide
     * blur read large (`regionIn`), so the haze between the tops has soft light and dark of its own.
     */
    const bedColour = (regionIn, skyMidIn) => mix(
        mix(cloudWhite.mul(P.deepLift), skyMidIn, float(P.deepSky)),
        mix(cloudWhite.mul(P.shadeLift), skyMidIn, float(P.shadeSky)),
        smoothstep(float(0.22), float(0.50), regionIn).mul(0.75),
    );

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OdysseyCloudSea';
    material.fog = false;
    material.side = THREE.DoubleSide;

    // ── The mesh: displaced by the plate, read no finer than the mesh can carry ──
    const aSpacing = attribute('aSpacing', 'float');
    const texel = S.tile / S.res;
    const vertXZ = positionLocal.xz;
    const vertMip = aSpacing.div(texel).mul(1.2).max(1).log2()
        .clamp(0, 6);
    const vertRegion = texture(plate, regionUv(vertXZ)).level(2).a;
    const vertCover = topsCover(coverAt(vertXZ, vertRegion));
    const vertH = standing(texture(plate, plateUv(vertXZ)).level(vertMip).r, vertCover);
    // (Two plain copies of one expression, never a shared var: three builds `positionNode` before
    // the varyings, and a var first built in one is unassigned in the other; the field's lesson.)
    const lifted = () => vec3(positionLocal.x, float(S.base).add(vertH.mul(vertCover).mul(S.amp)), positionLocal.z);
    material.positionNode = lifted();
    const vWorld = varying(lifted(), 'seaWorld');

    // ── The paint, per pixel ──
    const shade = Fn(() => {
        const wp = vWorld.toVar();
        const xz = wp.xz.toVar();
        const uv = plateUv(xz).toVar();
        const tex = texture(plate, uv).toVar();
        const region = texture(plate, regionUv(xz)).a.toVar();
        const cover = topsCover(coverAt(xz, region)).toVar();
        const h = standing(tex.r, cover).toVar();
        // The slope of the standing relief, in the world: relief-per-tile -> u per u.
        const slopeK = (CLOUD_SEA_SLOPE_RANGE * 2 * S.amp) / S.tile;
        const slope = tex.yz.sub(0.5).mul(slopeK).toVar();
        const nrm = normalize(vec3(slope.x.negate(), 1.0, slope.y.negate())).toVar();
        const to = wp.sub(cameraPosition).toVar();
        const dist = length(to).toVar();
        const dir = to.div(max(dist, float(0.001))).toVar();
        const { sunDir } = E;
        // Cast shadows: is a higher top standing between this place and the low sun?
        const shadow = float(0).toVar();
        if (!lean) {
            const tanSun = sunDir.y.div(max(length(sunDir.xz), float(0.05)));
            const here = h.mul(cover).mul(S.amp).toVar();
            S.shadowReach.forEach((reach, i) => {
                const at = xz.add(vec2(...SUN_FLAT).mul(reach));
                const there = standing(texture(plate, plateUv(at)).level(i + 1).r, cover).mul(cover).mul(S.amp);
                const over = there.sub(here).sub(tanSun.mul(reach));
                // (softer and a little weaker with reach: a long shadow's edge is wide)
                shadow.assign(max(shadow, smoothstep(float(0), float(26 + (i * 30)), over).mul(1 - (i * 0.14))));
            });
        }
        // The mountain's shadow: a wedge from the summit's axis toward the antisolar point, as
        // long as the summit stands over the floor at this sun, narrowing to its tip.
        const fromSummit = xz.sub(vec2(S.centre.x, S.centre.z)).toVar();
        const away = vec2(-SUN_FLAT[0], -SUN_FLAT[1]);
        const along = dot(fromSummit, away).toVar();
        const across = abs(fromSummit.x.mul(away.y).sub(fromSummit.y.mul(away.x)));
        const tanE = sunDir.y.div(max(length(sunDir.xz), float(0.05))).max(0.03);
        const reachM = float(S.summitY).sub(wp.y).div(tanE);
        const halfW = float(S.summitHalfWidth).mul(float(1).sub(along.div(max(reachM, float(1)))));
        const soft = along.mul(0.03).add(30);
        const wedge = smoothstep(float(0), float(200), along)
            .mul(float(1).sub(smoothstep(halfW.sub(soft), halfW.add(soft), across)))
            .mul(float(1).sub(smoothstep(reachM.mul(0.94), reachM.mul(1.04), along)))
            .mul(E.dusk.mul(4).clamp(0, 1));
        // The light term, stepped into the two tones (the field's Witness paint).
        // (A low sun lights what stands up into it and what is turned to it; the level floor
        // between the tops it only grazes.)
        // ...and the shadows of the cumulus that stand over the floor drift across it (the
        // world's own field of them, the one that crosses the island).
        if (cloudShadowLight && !lean) {
            shadow.assign(max(shadow, float(1).sub(cloudShadowLight(xz)).mul(1.6).clamp(0, 1)));
        }
        const facing = clamp(dot(nrm, sunDir).mul(1.5).add(0.10), 0, 1);
        // A fold: a place lower than the floor round it (the plate's wide blur against itself).
        const fold = smoothstep(float(0.02), float(0.16), tex.a.sub(tex.r));
        const lightT = clamp(
            h.mul(P.height)
                .add(facing.mul(P.facing))
                .sub(max(shadow, wedge).mul(P.shadow))
                .sub(fold.mul(P.fold))
                .add(P.bias),
            0,
            1,
        ).toVar();
        const tone = smoothstep(float(P.tone[0]), float(P.tone[1]), lightT).toVar();
        // Three painted tones: the sun's on what stands up into it, the sky's own blue (the
        // clear sky opposite the sun, a third of the way up) on the level floor, and a deeper
        // step of it in the folds and the cast shadows.
        const skyMid = skyAirAt(vec3(...MID_SKY)).toVar();
        const slate = mix(cloudWhite.mul(P.shadeLift), skyMid, float(P.shadeSky));
        const deep = mix(cloudWhite.mul(P.deepLift), skyMid, float(P.deepSky));
        const lit = mix(sunColour, cloudWhite, eveningCloudLitShare(0.70)).mul(P.litGain);
        const painted = mix(
            mix(deep, slate, smoothstep(float(P.deep[0]), float(P.deep[1]), lightT)),
            lit,
            tone,
        );
        // A top's foot melts into the bed it stands in (the bed's own colour here), so no top
        // has an outline: from above the floor is tops rising out of haze, not plates.
        const footed = mix(bedColour(region, skyMid), painted, smoothstep(float(0.0), float(S.bed.melt), h));
        const body = mix(footed, softSheet(slate, lit), fromHigh.mul(S.softTops)).toVar();
        // Seen from below (the floor's base, from the lower climb): the flat base in the sky's
        // shade, warmed where the low sun reaches under it.
        const under = mix(slate.mul(0.90), lit, E.dusk.mul(0.35));
        const col = select(frontFacing, body, under).toVar();
        // THE GLORY: rings round the antisolar point, on sunlit cloud, red outermost.
        If(E.glory.greaterThan(0.001), () => {
            const G = S.glory;
            const theta = dot(dir, E.antiDir).clamp(-1, 1).acos().mul(57.29578)
                .toVar();
            const ringAt = (deg, off) => {
                const d = theta.sub(deg + off).div(G.width);
                return exp(d.mul(d).negate());
            };
            const first = vec3(ringAt(G.rings[0], G.spread), ringAt(G.rings[0], 0), ringAt(G.rings[0], -G.spread));
            const second = vec3(
                ringAt(G.rings[1], G.spread * 1.3),
                ringAt(G.rings[1], 0),
                ringAt(G.rings[1], -G.spread * 1.3),
            ).mul(0.45);
            const core = exp(theta.mul(theta).div(3.4).negate()).mul(0.6);
            // A tint more than a light: each ring lifts its own colour and takes a little of the
            // others away, so it reads as colour on cloud that is already bright.
            const bands = first.add(second).toVar();
            const tint = bands.sub(dot(bands, vec3(0.3333)).mul(0.55)).add(core);
            col.mulAssign(vec3(1).add(tint.mul(E.glory.mul(G.gain))));
        });
        // The air: the world's, to the horizon it melts into well inside the far plane.
        // (the field's own share of the haze, so far tops stay cloud; `climb` takes the far fade
        // back to the scene's distances while the world is shrunk under the climbing eye)
        const hazeW = clamp(float(1).sub(exp(dist.mul(aerialK).negate())), 0, 0.82).mul(0.34);
        const farW = smoothstep(float(5200), float(8600), dist.div(climb));
        return mix(col, skyAirAt(dir), max(hazeW, farW));
    })();
    material.colorNode = toCloudOutput(shade);
    // The cut: the plate's own contour at this pixel (and nothing while nothing has gathered).
    const cutCover = topsCover(coverAt(vWorld.xz, texture(plate, regionUv(vWorld.xz)).a));
    const cutH = standing(texture(plate, plateUv(vWorld.xz)).r, cutCover);
    material.opacityNode = smoothstep(float(0.0), float(0.012), cutH.mul(cutCover));
    material.alphaTest = 0.5;

    const tops = new THREE.Mesh(geometry, material);
    tops.name = 'odyssey-world-cloud-sea-tops';
    tops.frustumCulled = false;
    tops.matrixAutoUpdate = false;
    tops.updateMatrix();

    // ── THE BED: the thinner cloud between the tops (see the header) ──
    const bedMaterial = new THREE.MeshBasicNodeMaterial();
    bedMaterial.name = 'OdysseyCloudSeaBed';
    bedMaterial.fog = false;
    bedMaterial.side = THREE.DoubleSide;
    bedMaterial.transparent = true;
    bedMaterial.depthWrite = false;
    const bedAt = () => vec3(positionLocal.x, float(S.base - S.bed.drop), positionLocal.z);
    bedMaterial.positionNode = bedAt();
    const vBed = varying(bedAt(), 'seaBed');
    const bedShade = Fn(() => {
        const wp = vBed.toVar();
        const to = wp.sub(cameraPosition).toVar();
        const dist = length(to).toVar();
        const dir = to.div(max(dist, float(0.001))).toVar();
        const regionB = texture(plate, regionUv(wp.xz)).a.toVar();
        const skyMid = skyAirAt(vec3(...MID_SKY)).toVar();
        // The low sun grazes the bed where it stands a little higher (the plate's blur, read at
        // its own scale): a faint warm bloom, so the haze is lit, not flat.
        const swell = texture(plate, plateUv(wp.xz)).a.toVar();
        const lit = mix(sunColour, cloudWhite, eveningCloudLitShare(0.70)).mul(P.litGain);
        const slateB = mix(cloudWhite.mul(P.shadeLift), skyMid, float(P.shadeSky));
        const col = mix(
            mix(bedColour(regionB, skyMid), lit, smoothstep(float(0.34), float(0.58), swell).mul(0.16)),
            softSheet(slateB, lit),
            fromHigh.mul(S.softBed),
        ).toVar();
        const hazeW = clamp(float(1).sub(exp(dist.mul(aerialK).negate())), 0, 0.82).mul(0.34);
        const farW = smoothstep(float(5200), float(8600), dist.div(climb));
        return mix(col, skyAirAt(dir), max(hazeW, farW));
    })();
    bedMaterial.colorNode = toCloudOutput(bedShade);
    // Its cover: the floor's own, eased, and a little thinner where the plate's blur is low
    // (the lanes are hollows of haze). A slow fade everywhere, never a contour.
    const bedRegion = texture(plate, regionUv(vBed.xz)).a;
    const bedSwell = texture(plate, plateUv(vBed.xz)).a;
    // (the lanes hold a little less haze from near; from very high the sheet is whole)
    const laneFloor = mix(float(0.84), float(1.0), fromHigh);
    bedMaterial.opacityNode = smoothstep(float(0.03), float(0.42), coverAt(vBed.xz, bedRegion))
        .mul(mix(laneFloor, float(1.0), smoothstep(float(0.10), float(0.36), bedSwell)))
        .mul(S.bed.alpha);
    bedMaterial.alphaTest = 0.004;
    const bed = new THREE.Mesh(geometry, bedMaterial);
    bed.name = 'odyssey-world-cloud-sea-bed';
    bed.frustumCulled = false;
    bed.matrixAutoUpdate = false;
    bed.updateMatrix();
    // AFTER THE SEA (render order 1), by order and not by a sort tie. At the sea's own order the
    // two tie on depth and the water drew over the bed from high in the climb (captured at
    // p 0.71: the bed gone, the tops left as plates on dark water). The orbs' halo (also 1) is
    // then under it where the floor lies behind an orb; its ring still reads (orb close-ups
    // L31-L34 checked), as it does over the sea.
    bed.renderOrder = 2;

    const mesh = new THREE.Group();
    mesh.name = 'odyssey-world-cloud-sea';
    mesh.add(bed);
    mesh.add(tops);
    mesh.visible = false;

    return {
        mesh,
        tops,
        bed,
        /** Triangles drawn: the tops and the bed share one ring. */
        triangles: triangles * 2,
        uniforms: { uGather, uDrift, uBreath },
        /**
         * @param {number} time seconds
         * @param {number} gather 0..1 (the evening's `sea`)
         * @param {boolean} shown whether the world lets it draw (not under water, not under the Earth)
         */
        update(time, gather, shown) {
            const t = Number.isFinite(time) ? time : 0;
            const g = Math.min(Math.max(Number.isFinite(gather) ? gather : 0, 0), 1);
            uGather.value = g;
            // The plate moves downwind: its uv runs the other way. Wrapped to one tile.
            const run = (t * S.speed) / S.tile;
            uDrift.value.set(-(S.wind[0] * run) % 1, -(S.wind[1] * run) % 1);
            uBreath.value = ((t * 2 * Math.PI) / S.breathPeriod) % (2 * Math.PI);
            mesh.visible = !!shown && g > 0.001;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
            bedMaterial.dispose();
            plate.dispose();
            mesh.removeFromParent();
        },
    };
}
