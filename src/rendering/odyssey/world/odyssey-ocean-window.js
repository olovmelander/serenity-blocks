/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE SURFACE FROM BELOW (Odyssey masterpiece pass, 2026-11-17) — Snell's window, with the world
 * in it.
 *
 * The climb's last third stares at the underside of the sea, and the audit found it "nearly empty
 * blue with a caustic ceiling": the window was one flat sky colour and the mirror outside it one
 * flat water colour. Seen from under water the whole sky, and everything standing on the sea, is
 * folded into a cone 48.6 degrees wide over the eye: this module puts it there.
 *
 *   INSIDE THE WINDOW the view ray is refracted out through the rippled surface (water to air),
 *   and what it meets is drawn: the sky's own gradient with its pale horizon squeezed against the
 *   rim, drifting cloud, the island's shore, forest and massif standing in a band along the rim on
 *   the side they really lie (the land march the sea's mirror already uses, along the refracted
 *   ray instead of the reflected one), and the sun's glare, shattered by the ripples it comes
 *   through.
 *
 *   OUTSIDE IT the surface is a mirror of the water below (total internal reflection): the
 *   reflected ray's own dip picks the plate it shows, so every swell and ripple facet turns a
 *   different depth of water toward the eye and the mirror moves as the sea does.
 *
 * Built from the caller's own nodes (the world's sky, its land march, its plates), so the window
 * can never show a different world from the one the breach arrives in. Gated twice: by the tier
 * in JavaScript (the caller passes no `march` and the land is not built) and by a uniform the CPU
 * writes (`snellWindowGate`): deeper than `reach` the water between has taken the picture and the
 * window is the flat glow it always was, at no cost.
 */
import {
    If, atan, clamp, dot, exp, float, length, max, min, mix, normalize, reflect, refract, select, smoothstep, sqrt,
    texture, vec2, vec3,
} from 'three/tsl';

export const SNELL_WINDOW = Object.freeze({
    /** Water's refractive index against air. */
    eta: 1.333,
    /** The eye's depth (u) the world shows in the window within; the picture fades over `fade`. */
    reach: 92,
    fade: 40,
    /** The land march along the refracted ray: steps that grow with range, out to ~3.3 km. */
    march: Object.freeze({
        steps: 14, firstStep: 12, stepGrowth: 1.45, soft: 7, ceiling: 1400,
    }),
    /** The cloud the window shows: a drifting layer this far over the sea, puffs this size. */
    cloud: Object.freeze({
        height: 380, scale: 0.0013, drift: Object.freeze([0.0021, 0.0013]), edge: Object.freeze([0.50, 0.78]),
    }),
    /** The sun through the surface: a glare lobe and a core, in units of the sun's colour. */
    // (glare 0.55 -> 0.8, 2026-11-21: the window is the light source of the water under it.)
    sun: Object.freeze({ glare: 0.8, core: 3.2 }),
    /**
     * THE WINDOW IS THE LIGHT (2026-11-21 sea audit, item 4). Near the surface the window (the sky
     * seen through the water) was darker than the water round it (r132: ~132 against ~169), so
     * the surface read as a dim lens in a bright fog. The window now stands `overWater` times the
     * level water's light (a lift between `min`, the sky's n^2 gain entering water, and `max`),
     * fading to none from the window's reach down; clouds take at most `cloudLift`.
     */
    light: Object.freeze({
        overWater: 1.6, min: 1.5, max: 2.4, cloudLift: 1.4,
    }),
    /**
     * A STEADY WINDOW (2026-11-21 sea audit, item 5). The window was cut, and its picture aimed,
     * by the full swell's normal: faces tens of metres wide tilted 10-22 degrees pushed whole
     * patches across the critical angle, so its outline jumped by a third of the frame between
     * frames and the island and clouds in it changed every frame. It is now cut through a normal
     * of its own, a level sea tipped by `swellShare` of the swell and `rippleShare` of the ripple,
     * the tilt capped at `tiltCap` (the rim moves at most ~3.4 degrees); the picture is a level
     * sea's refraction moved at most `imageWobble` by the crinkled one.
     */
    surface: Object.freeze({
        swellShare: 0.10, rippleShare: 0.6, tiltCap: 0.06, imageWobble: 0.03,
    }),
});

/**
 * How much of the world the window shows for an eye `depthU` under the surface: 1 near it, 0 from
 * `reach` down (the CPU's gate and the picture's own fade, so it never pops).
 * @param {number} depthU
 * @returns {number} 0..1
 */
export function snellWindowPresence(depthU, spec = SNELL_WINDOW) {
    if (!Number.isFinite(depthU)) return 0;
    const t = Math.max(0, Math.min(1, (spec.reach - depthU) / spec.fade));
    return t * t * (3 - (2 * t));
}

/**
 * The cosine (to the surface's normal) inside which a ray from under water leaves it: the
 * window's rim. cos(asin(1 / eta)).
 * @returns {number}
 */
export function snellWindowRimCos(spec = SNELL_WINDOW) {
    return Math.sqrt(1 - (1 / (spec.eta * spec.eta)));
}

/**
 * The window's lift (SNELL_WINDOW.light): how much brighter than the sky's own zenith it is drawn
 * so it stands `overWater` times the water a level look ends in (`hazeY`, its luma), clamped, and
 * none deeper than the window's reach (the deep is unchanged).
 * @param {number} hazeY luma of the level water's colour (linear)
 * @param {number} zenithY luma of the sky's zenith (linear)
 * @param {number} depthU the eye's depth (u)
 * @returns {number} >= 1
 */
export function snellWindowLift(hazeY, zenithY, depthU, spec = SNELL_WINDOW) {
    const L = spec.light;
    const want = (L.overWater * Math.max(hazeY, 0)) / Math.max(zenithY, 1e-3);
    const lift = Math.min(Math.max(Number.isFinite(want) ? want : L.min, L.min), L.max);
    return 1 + ((lift - 1) * snellWindowPresence(depthU, spec));
}

/**
 * The window's picture for one fragment of the sea's underside.
 * @param {object} ctx TSL nodes and builders from the world's renderer
 * @param {*} ctx.incident unit vec3, from the eye to the surface
 * @param {*} ctx.normal unit vec3, the surface's normal (up)
 * @param {*} ctx.at vec3, the fragment's world position
 * @param {*} ctx.flat vec3, the flat window colour (what shows where the world does not)
 * @param {*} ctx.presence float uniform, `snellWindowPresence`
 * @param {*} ctx.time float uniform
 * @param {*} ctx.sunDir unit vec3 uniform
 * @param {*} ctx.sunColour vec3 uniform
 * @param {(dir: *) => *} ctx.skyAt the world's air in a direction
 * @param {*} ctx.noiseTex the world's tiling detail texture (b = value noise)
 * @param {((P: *, R: *) => {tLand: *, landW: *})|null} [ctx.march] the land march (null: no land)
 * @param {((H: *, t: *, air: *) => *)|null} [ctx.landLit] the land's colour where the march lands
 * @returns {*} vec3 node (a var; built at the caller's Fn root)
 */
export function snellWindowWorld(ctx, spec = SNELL_WINDOW) {
    const lift = ctx.lift ?? float(1);
    const flatLit = vec3(ctx.flat).mul(lift);
    const out = vec3(flatLit).toVar('wSnellWorld');
    If(ctx.presence.greaterThan(0.001), () => {
        // THE PICTURE, ANCHORED (SNELL_WINDOW.surface, 2026-11-21): where a LEVEL sea refracts the
        // ray (past the rim it lies on the horizon, never zero), moved by the crinkled surface's
        // own refraction at most `ctx.wobble`: near the rim the refracted ray swings far faster
        // than the surface tilts, and a few degrees of swell threw the picture 10-20 degrees.
        const rimCos = snellWindowRimCos(spec);
        const I = ctx.incident;
        const horiz = max(length(I.xz), float(1e-5)).toVar();
        const sinT = min(horiz.mul(spec.eta), float(0.9995)).toVar();
        const levelDir = vec3(
            I.x.div(horiz).mul(sinT),
            sqrt(float(1).sub(sinT.mul(sinT))),
            I.z.div(horiz).mul(sinT),
        ).toVar();
        const refr = refract(I, ctx.normal.negate(), float(spec.eta)).toVar();
        const dv = select(dot(refr, refr).greaterThan(0.5), refr.sub(levelDir), vec3(0, 0, 0)).toVar();
        const wobble = ctx.wobble ?? float(spec.surface.imageWobble);
        const wob = dv.mul(min(float(1), wobble.div(max(length(dv), float(1e-5)))));
        const airDir = normalize(vec3(
            levelDir.x.add(wob.x),
            max(levelDir.y.add(wob.y), float(0.012)),
            levelDir.z.add(wob.z),
        )).toVar();
        // A soft rim edge on the window's own normal (not a switch on |refr|^2).
        const through = smoothstep(float(rimCos - 0.002), float(rimCos + 0.006), dot(I, ctx.normal));
        const skyRaw = ctx.skyAt(airDir).toVar();
        const sky = skyRaw.mul(lift).toVar();
        // Cloud: one drifting layer, read where the refracted ray meets it. Two scales of the
        // tile's value noise, so the puffs have lobes; lit from above, cool beneath.
        const cl = spec.cloud;
        // (By the level ray's height: the wobble then shifts a cloud ~60 u, not swaps it.)
        const reachXZ = airDir.xz.div(max(levelDir.y, float(0.06))).mul(cl.height);
        const cUv = ctx.at.xz.add(reachXZ).mul(cl.scale)
            .add(vec2(ctx.time.mul(cl.drift[0]), ctx.time.mul(cl.drift[1])));
        // THREE octaves, each on its own turned lattice. The tile's value noise has square cells:
        // read on one grid (or with one octave carrying the shape) a cloud came out as a rounded
        // square with the finer octave speckled inside it, which read as a texture tile on the
        // window. No two of these lattices share an axis, and none carries the outline alone.
        const turned = (uvIn, c, sn, k, ox, oy) => vec2(
            uvIn.x.mul(c).sub(uvIn.y.mul(sn)),
            uvIn.x.mul(sn).add(uvIn.y.mul(c)),
        ).mul(k).add(vec2(ox, oy));
        const cN = texture(ctx.noiseTex, turned(cUv, 0.956, 0.292, 1, 0, 0)).b.mul(0.40)
            .add(texture(ctx.noiseTex, turned(cUv, 0.755, -0.656, 1.43, 0.37, 0.11)).b.mul(0.36))
            .add(texture(ctx.noiseTex, turned(cUv, 0.292, 0.956, 2.9, 0.71, 0.53)).b.mul(0.24));
        // (Softer with depth: the water between blurs a cloud into a paler patch of sky.)
        const cover = smoothstep(float(cl.edge[0]), float(cl.edge[1]), cN)
            .mul(smoothstep(float(0.03), float(0.16), levelDir.y))
            .mul(ctx.presence.mul(0.75).add(0.25));
        const cloudLit = mix(
            vec3(0.80, 0.86, 0.95),
            mix(ctx.sunColour, vec3(1, 1, 1), 0.5).mul(1.06),
            smoothstep(float(cl.edge[0]), float(cl.edge[1] + 0.16), cN),
        );
        const world = mix(sky, cloudLit.mul(min(lift, float(spec.light.cloudLift))), cover.mul(0.9)).toVar();
        if (ctx.march && ctx.landLit) {
            // The island, where the refracted ray runs into it: a band along the rim on its side.
            // Only where a level sea would let the ray out: a lone facet tilted into the window
            // far outside it shows sky (a glint), never a dark piece of land (a stain on the lid).
            const { tLand, landW } = ctx.march(ctx.at, airDir);
            const H = ctx.at.add(airDir.mul(tLand));
            // (The level picture puts the island in the window's outer ~2 degrees: full weight across
            // the rim and the crinkle's reach.)
            const inWindow = smoothstep(float(rimCos - 0.045), float(rimCos - 0.01), ctx.incident.y);
            world.assign(mix(world, ctx.landLit(H, tLand, skyRaw).mul(lift), landW.mul(inWindow)));
        }
        // The sun: its glare on the side of the window it stands, a hot core where a facet lines
        // the ray up with it (the ripples shatter it and it dances).
        const toSun = clamp(dot(airDir, ctx.sunDir), 0, 1);
        const s2 = toSun.mul(toSun);
        const s8 = s2.mul(s2).mul(s2.mul(s2));
        const s32 = s8.mul(s8).mul(s8.mul(s8));
        const s256 = s32.mul(s32).mul(s32.mul(s32));
        world.addAssign(ctx.sunColour.mul(s8.mul(spec.sun.glare).add(s256.mul(s256).mul(spec.sun.core))));
        out.assign(mix(flatLit, world, through.mul(ctx.presence)));
    });
    return out;
}

/**
 * The mirror outside the window: the water below, by the reflected ray's dip. A facet that
 * throws the ray steeply down shows the deep plate; one that skims it shows the lit water near
 * the surface.
 * @param {object} ctx
 * @param {*} ctx.incident unit vec3, from the eye to the surface
 * @param {*} ctx.normal unit vec3, the surface's normal (up)
 * @param {*} ctx.near vec3, the water just under the surface (lit)
 * @param {*} ctx.mid vec3
 * @param {*} ctx.deep vec3
 * @returns {*} vec3 node
 */
export function snellMirror(ctx) {
    const down = clamp(reflect(ctx.incident, ctx.normal.negate()).y.negate(), 0, 1);
    return mix(
        mix(ctx.near, ctx.mid, smoothstep(float(0.03), float(0.42), down)),
        ctx.deep,
        smoothstep(float(0.42), float(0.95), down).mul(0.6),
    );
}

/**
 * THE SUN'S LIGHT IN THE WATER, SEEN FROM NEAR THE SURFACE (2026-11-25).
 *
 * Arriving at the top of the chapter the eye lies a few units under the surface and looks up at
 * its underside: a frame of lid and nothing else, one even turquoise. What such a frame holds in
 * a real sea is the sun's own light in the water between: a glow on the side the sun stands, and
 * shafts that fan out of it. Every shaft runs along the refracted sun, so seen from anywhere they
 * converge on one point of the sky of directions (the sun's place under water), and the picture
 * is a function of the view's direction alone: a broad `lobe` toward that point and `rays`
 * streaking out of it (two turns of the detail tile round the sun's axis, at counts that share
 * no period). It builds along the view path (`path` per u) and belongs to the top of the column:
 * whole to `depth[0]` u down, gone by `depth[1]` (the CPU's gate: deeper, no fragment runs it), and
 * a view turned from the sun (every orb's close-up) branches past the two fetches.
 *
 * Soft and slow on purpose (the owner's rule for water: nothing that sparkles or strobes): the
 * streaks are wide, their brightness drifts by a cell in ~20 s, and nothing here is a point.
 */
export const OCEAN_SUN_RAYS = Object.freeze({
    depth: Object.freeze([12, 96]),
    lobe: 0.24,
    rays: 0.40,
    /** The streaks are only read where the view turns this far toward the sun (the cosine): from there in. */
    from: Object.freeze([0.24, 0.46]),
    counts: Object.freeze([3, 5]),
    drift: 0.0045,
    path: 0.028,
    /** How much of the sun's own colour the light keeps (the rest is the water's luminous plate). */
    warm: 0.35,
});

/**
 * How much of the sun's light in the water an eye `depthU` down sees: 1 near the surface, 0 from
 * `depth[1]` (the CPU's gate; smooth, so it never pops).
 * @param {number} depthU
 * @returns {number} 0..1
 */
export function sunRaysPresence(depthU, spec = OCEAN_SUN_RAYS) {
    if (!Number.isFinite(depthU)) return 0;
    const t = Math.max(0, Math.min(1, (spec.depth[1] - depthU) / (spec.depth[1] - spec.depth[0])));
    return t * t * (3 - (2 * t));
}

/**
 * The light scattered toward the eye along a view direction: a float, 0 away from the sun and
 * about `lobe + rays` at its strongest.
 * @param {object} ctx
 * @param {*} ctx.dir unit vec3, from the eye
 * @param {number[]} ctx.sun unit vector toward the refracted sun (`sunUnderWater`)
 * @param {*} ctx.time float uniform
 * @param {*|null} ctx.noiseTex the world's tiling detail texture (b = value noise); null: the
 *   lobe alone (the low tier builds no fetch)
 * @returns {*} float node
 */
export function sunRayScatter(ctx, spec = OCEAN_SUN_RAYS) {
    const { sun: S } = ctx;
    // A frame round the sun's axis (constants: the sun does not move under water).
    const ref = Math.abs(S[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const e1 = [
        (S[1] * ref[2]) - (S[2] * ref[1]), (S[2] * ref[0]) - (S[0] * ref[2]), (S[0] * ref[1]) - (S[1] * ref[0]),
    ];
    const l1 = Math.hypot(e1[0], e1[1], e1[2]) || 1;
    e1[0] /= l1; e1[1] /= l1; e1[2] /= l1;
    const e2 = [(S[1] * e1[2]) - (S[2] * e1[1]), (S[2] * e1[0]) - (S[0] * e1[2]), (S[0] * e1[1]) - (S[1] * e1[0])];
    const toSun = clamp(dot(ctx.dir, vec3(S[0], S[1], S[2])), 0, 1).toVar();
    const s2 = toSun.mul(toSun).toVar();
    const light = s2.mul(toSun).mul(spec.lobe).toVar();
    if (!ctx.noiseTex) return light;
    If(toSun.greaterThan(spec.from[0]), () => {
        // The angle round the axis, in turns (the tile repeats a whole number of times round it,
        // so the atan's seam lands on a repeat; `level(0)`: its derivative there would pick the
        // last mip, and a fetch inside a branch may not take one).
        const px = dot(ctx.dir, vec3(e1[0], e1[1], e1[2]));
        const py = dot(ctx.dir, vec3(e2[0], e2[1], e2[2]));
        const turn = atan(py, px.add(1e-5)).div(Math.PI * 2).toVar();
        const out = float(1).sub(toSun);
        const wide = texture(ctx.noiseTex, vec2(turn.mul(spec.counts[0]), out.mul(0.22).add(ctx.time.mul(spec.drift))))
            .level(0).b;
        const fine = texture(
            ctx.noiseTex,
            vec2(turn.mul(spec.counts[1]).add(0.37), out.mul(0.13).sub(ctx.time.mul(spec.drift * 0.7))),
        ).level(0).b;
        const streak = smoothstep(float(0.36), float(0.70), wide.mul(0.58).add(fine.mul(0.42)));
        // Out of the sun's place and fading away from it; at the very point the streaks crowd
        // into less than a pixel, so the lobe alone carries it there.
        const s8 = s2.mul(s2).mul(s2.mul(s2));
        const reach = s2.mul(float(1).sub(s8.mul(s8))).mul(smoothstep(float(spec.from[0]), float(spec.from[1]), toSun));
        light.addAssign(streak.mul(reach).mul(spec.rays));
    });
    return light;
}

/**
 * The light the water over the eye lets through along a path of `dist` u: the surface dims with
 * the water between (so from the abyss the window is a far, soft well, brightest straight up).
 * @param {*} dist float node
 * @param {*} absorb float uniform, per u
 * @returns {*} float node
 */
export function snellDepthLight(dist, absorb) {
    return exp(dist.mul(absorb).negate());
}
