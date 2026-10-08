/**
 * Halcyon Apex — the lagoon.
 *
 * Clear water over pale sand. Looking down, you see the bed: ripple marks, meadows of sea
 * grass, and the net of light the sun throws through the surface — which goes out where the
 * pyramid's shadow lies. Looking out, the water turns from the sand's turquoise to the deep's
 * blue-green as the path through it lengthens, then to a mirror: on the showcase tiers a planar
 * reflector() renders the sanctuary from the mirrored camera and the water reads it through its
 * own slopes; lower tiers mirror the sky function and the sun instead.
 *
 * The lagoon knows where the masonry stands (a few signed distances), so it shelves toward it,
 * pales over the shelf and breaks in a thin line of foam on every footing.
 *
 * Gameplay writes onto it: a lock's ring is a real ripple (it bends the mirror and the bed) and
 * carries the piece's colour through the net of light; a clear's swell floods the bed.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    length,
    max,
    min,
    mix,
    mod,
    normalize,
    positionWorld,
    reflect,
    reflector,
    screenUV,
    sin,
    smoothstep,
    step,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CLEAR_REACH,
    CLEAR_SHAPE,
    CLEAR_SLOTS,
    CLEAR_TRAVEL,
    LEY_A,
    LOCK_SLOTS,
    RING_FADE,
    RING_REACH,
    RING_TAU,
    SITE,
    haAtmosphere,
    haBell,
    haClearLight,
    haFresnel,
    haLuma,
    haPart,
    haSkyBase,
    haSkyLight,
    haSunDisc,
} from './halcyon-apex-tsl.js';

/** Signed distance to an axis-aligned box of half-extents `h` centred on the origin (2D). */
const boxSdf = (q, hx, hz) => {
    const d = vec2(abs(q.x).sub(hx), abs(q.y).sub(hz));
    return length(max(d, vec2(0.0))).add(min(max(d.x, d.y), 0.0));
};

/**
 * Distance (metres) from a point of the lagoon to the nearest masonry at the waterline.
 * @param {object} u
 * @param {*} st  world xz
 */
export const shoreDistance = (u, st) => {
    const p = SITE.pyramid;
    const c = SITE.causeway;
    const rel = st.sub(vec2(p.x, p.z));
    const site = vec2(
        rel.x.mul(SITE.right[0]).add(rel.y.mul(SITE.right[1])),
        rel.x.mul(SITE.front[0]).add(rel.y.mul(SITE.front[1])),
    );
    const plinth = boxSdf(site, p.half + 3.8, p.half + 3.8);
    const landing = boxSdf(site.sub(vec2(0.0, (p.half + 3 + c.near) / 2)), 13.3, (c.near - p.half - 3) / 2 + 0.2);
    // The piers repeat along the causeway.
    const cell = mod(site.y.sub(LEY_A.head).add(c.pitch * 0.5), c.pitch).sub(c.pitch * 0.5);
    const onDeck = step(c.near - 2, site.y).mul(step(site.y, LEY_A.head + c.pitch + 2));
    const piers = mix(float(1e3), boxSdf(vec2(site.x, cell), c.half + 1.6, 1.2), onDeck);
    const obelisks = min(
        boxSdf(vec2(abs(site.x).sub(19.5), site.y.sub(c.near - 6)), 3.4, 3.4),
        boxSdf(vec2(abs(site.x).sub(41.0), site.y.sub(c.near - 3)), 2.8, 2.8),
    );
    const rim = abs(length(st.sub(u.halcyonPos.xz)).sub(SITE.dial.radius)).sub(0.9);
    return min(min(min(plinth, landing), min(piers, obelisks)), rim);
};

/**
 * @param {object} u  shared sanctuary uniforms
 * @param {object} [opts]
 * @param {number} [opts.reflectionScale=0]  reflector resolution scale (0 = mirror the sky function)
 * @param {boolean} [opts.glitter=true]      the sun's sparkle on the surface
 * @param {boolean} [opts.bedDetail=true]    ripple marks and sea grass on the bed
 * @param {number[][]} [opts.islets]         the islets' outlines at the waterline: [x, z, radius]
 */
export function createWater(u, opts = {}) {
    const reflectionScale = opts.reflectionScale ?? 0;
    const glitter = opts.glitter !== false;
    const bedDetail = opts.bedDetail !== false;
    const islets = opts.islets || [];
    const reflection = reflectionScale > 0
        ? reflector({ resolutionScale: reflectionScale, bounces: false, generateMipmaps: true })
        : null;
    if (reflection) {
        reflection.target.rotateX(-Math.PI / 2);
        reflection.target.name = 'HalcyonApexReflectorTarget';
    }

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HalcyonApexWater';
    material.fog = false;

    material.colorNode = Fn(() => {
        const p = positionWorld;
        const rel = p.sub(cameraPosition).toVar();
        const dist = length(rel).toVar();
        const V = rel.div(dist).toVar();
        const st = p.xz.toVar();
        const lit = u.sunLit.toVar();

        // ── The surface's slope: a calm lagoon, a breath of wind ──
        const w1 = u.noise(st.mul(0.031).add(vec2(u.time.mul(0.0052), u.time.mul(0.0031)))).toVar();
        const w2 = u.noise(st.mul(0.13).sub(vec2(u.time.mul(0.0125), u.time.mul(-0.0074)))).toVar();
        const w3 = u.noise(st.mul(0.53).add(vec2(u.time.mul(0.027), u.time.mul(0.019)))).toVar();
        const wind = u.power.mul(0.7).add(1.0);
        const slope = w1.rg.sub(0.5).mul(0.6).add(w2.ba.sub(0.5).mul(0.26)).add(w3.rg.sub(0.5).mul(0.1))
            .mul(wind)
            .mul(0.062)
            .toVar();

        // ── Lock rings: a crisp front with a soft wake, and the slope they give the surface ──
        const ring = vec3(0.0).toVar();
        const wake = float(0.0).toVar();
        If(u.ringsLive.greaterThan(0.5), () => {
            for (let i = 0; i < LOCK_SLOTS; i++) {
                const A = u.lockA[i];
                const age = u.time.sub(A.z);
                const radius = u.lockC[i].w.mul(RING_REACH).mul(float(1.0).sub(exp(age.div(-RING_TAU))));
                const o = st.sub(A.xy);
                const d = length(o);
                const x = d.sub(radius);
                const env = exp(age.mul(-RING_FADE)).mul(step(0.0, age)).mul(A.w);
                const front = haBell(x.div(0.9)).add(haBell(x.add(2.6).div(1.2)).mul(0.3)).add(haBell(x.add(2.2).div(4.4)).mul(0.2));
                ring.addAssign(u.lockC[i].rgb.mul(front.mul(env)));
                wake.addAssign(haBell(x.add(1.6).div(5.5)).mul(env));
                const wave = sin(x.mul(1.9)).mul(exp(x.mul(x).mul(-0.085))).mul(env);
                slope.addAssign(o.div(max(d, 1e-3)).mul(wave).mul(0.5));
            }
        });
        // ── The clear's swell ──
        const clear = vec4(0.0).toVar();
        If(u.clearLive.greaterThan(0.5), () => {
            clear.assign(haClearLight(u, p));
            for (let i = 0; i < CLEAR_SLOTS; i++) {
                const A = u.clearA[i];
                const fromHeart = st.sub(u.clearH[i]);
                const heartDist = length(fromHeart);
                const far = clamp(heartDist.div(CLEAR_REACH), 0.0, 1.0);
                const pass = float(CLEAR_TRAVEL).mul(far.pow(1 / CLEAR_SHAPE));
                const since = u.time.sub(A.x).sub(pass);
                const swell = sin(since.mul(20.0)).mul(exp(since.mul(since).mul(-30.0))).mul(A.z);
                slope.addAssign(fromHeart.div(max(heartDist, 1e-3)).mul(swell).mul(0.36));
            }
        });

        // ── Under the Halcyon the lagoon is drawn inward and up: rings that close on its foot ──
        const toFoot = st.sub(u.halcyonPos.xz);
        const footDist = length(toFoot).toVar();
        const draw = sin(footDist.mul(1.25).add(u.time.mul(2.4))).mul(exp(footDist.mul(-0.085))).mul(u.power.mul(0.6).add(1.0));
        slope.addAssign(toFoot.div(max(footDist, 1e-3)).mul(draw).mul(0.11));

        // ── The shore, and the depth of the bed under this point ──
        const shore = shoreDistance(u, st).toVar();
        const bars = u.noise(st.mul(0.0047).add(vec2(0.31, 0.77))).b;
        const open = mix(float(1.5), float(6.5), smoothstep(0.34, 0.66, bars));
        // The islets stand on shelves of their own (their true outline is the land's to draw).
        let bank = float(1e3);
        islets.forEach(([ix, iz, ir]) => {
            bank = min(bank, length(st.sub(vec2(ix, iz))).sub(ir));
        });
        const depth = mix(float(0.45), open, smoothstep(0.0, 34.0, min(shore, max(bank, 0.0)))).toVar();

        // ── The mirror ──
        const Nw = normalize(vec3(slope.x.mul(-2.6), 1.0, slope.y.mul(-2.6))).toVar();
        const cosT = clamp(dot(V, Nw).negate(), 0.0, 1.0);
        const fres = haFresnel(cosT, 0.02).toVar();
        const mirror = vec3(0.0).toVar();
        const Rw = reflect(V, Nw).toVar();
        if (reflection) {
            // Far water is seen edge-on: its slopes shift the mirror less on screen.
            const reach = float(1.0).div(dist.mul(0.03).add(1.0));
            const ruv = screenUV.flipX().add(vec2(slope.x, slope.y.mul(1.8)).mul(reach).mul(0.62));
            mirror.assign(reflection.sample(ruv).level(reach.mul(1.4)).rgb);
        } else {
            // No second render: the water returns the sky and the sun along its own mirror ray.
            const Rs = reflect(V, normalize(vec3(slope.x.mul(-0.6), 1.0, slope.y.mul(-1.2))));
            const Rup = vec3(Rs.x, abs(Rs.y).add(0.004), Rs.z);
            mirror.assign(haSkyBase(u, Rup).add(haSunDisc(u, Rup).mul(0.4)));
        }

        // ── Under the surface: the bed, the net of light on it, and the water in between ──
        const down = max(V.y.negate(), 0.16);
        const path = depth.div(down).toVar();
        const bedP = st.add(V.xz.div(down).mul(depth).mul(0.75)).add(slope.mul(depth).mul(3.0)).toVar();
        const sand = vec3(0.86, 0.78, 0.6).toVar();
        if (bedDetail) {
            const grain = u.noise(bedP.mul(0.083)).toVar();
            // Ripple marks, combed by the tide.
            const marks = sin(bedP.x.mul(1.9).add(bedP.y.mul(1.1)).add(grain.r.mul(15.0))).mul(0.5).add(0.5);
            sand.mulAssign(float(0.84).add(marks.mul(0.2)).add(grain.g.sub(0.5).mul(0.3)));
            // Meadows of sea grass, away from the shelves.
            const meadow = smoothstep(0.56, 0.7, u.noise(bedP.mul(0.019).add(vec2(0.6, 0.1))).a).mul(smoothstep(6.0, 22.0, shore));
            sand.assign(mix(sand, vec3(0.09, 0.2, 0.13), meadow.mul(0.78)));
        }
        // The net of light: two families of bright lines from the same two fetches; where they
        // cross the light pools, between crossings it thins to a thread.
        const n1 = u.noise(bedP.mul(0.31).add(vec2(u.time.mul(0.017), u.time.mul(0.011)))).toVar();
        const n2 = u.noise(bedP.mul(0.43).sub(vec2(u.time.mul(0.013), u.time.mul(0.021)))).toVar();
        const warp = haBell(n1.r.sub(n2.g).mul(8.0));
        const weft = haBell(n1.b.sub(n2.a).mul(8.0));
        const net = warp.mul(weft).mul(2.6).add(warp.add(weft).mul(0.16)).toVar();
        const shallowK = exp(depth.mul(-0.32));
        const sunOnBed = mix(u.sun, vec3(haLuma(u.sun)), 0.45).mul(lit).mul(net.mul(1.5).add(0.42)).mul(shallowK.mul(0.75).add(0.25))
            .mul(0.31);
        // A ring is the piece's colour running through the net of light; a clear floods it.
        const eventBed = ring.mul(net.mul(2.6).add(0.5)).add(clear.rgb.mul(net.mul(1.2).add(0.4)))
            .add(u.ley.mul(wake.mul(0.3).add(clear.w.mul(0.3))).mul(net.add(0.2)));
        const bed = sand.mul(sunOnBed.add(haSkyLight(u, vec3(0.0, 1.0, 0.0)).mul(0.55))).add(sand.mul(eventBed).mul(1.3));
        // What the water takes from the light on its way, and what it gives back.
        const absorb = exp(vec3(-0.42, -0.085, -0.11).mul(path));
        const body = mix(u.shallow, u.deep, float(1.0).sub(exp(path.mul(-0.2)))).mul(lit.mul(0.62).add(0.38))
            .mul(haSkyLight(u, vec3(0.0, 1.0, 0.0)).g.mul(1.5).add(0.25));
        const murk = float(1.0).sub(exp(path.mul(-0.26)));
        const under = mix(bed.mul(absorb).mul(mix(vec3(1.0), u.shallow.mul(1.5).add(0.25), 0.5)), body, murk)
            .mul(exp(dist.mul(-0.0016)).mul(0.5).add(0.5));

        const col = mix(under, mirror, fres).toVar();

        // ── The sun on the surface: a road of sparks toward it ──
        if (glitter) {
            const g = u.noise(st.mul(0.83).add(vec2(u.time.mul(0.031), u.time.mul(0.022)))).a;
            const rs = max(dot(Rw, u.sunDir), 0.0);
            const rs4 = rs.mul(rs).mul(rs).mul(rs);
            const rs16 = rs4.mul(rs4).mul(rs4).mul(rs4);
            const rs64 = rs16.mul(rs16).mul(rs16).mul(rs16);
            const road = rs64.mul(rs64).mul(rs64);
            const spark = smoothstep(0.62, 0.88, g).mul(road).mul(3.2).add(road.mul(road).mul(road).mul(road).mul(1.6));
            col.addAssign(u.sun.mul(spark).mul(lit).mul(u.breath));
        }

        // ── Where the lagoon meets the masonry: a pale shelf and a thin line of foam ──
        const lap = sin(u.time.mul(0.9).add(w2.r.mul(12.0))).mul(0.18);
        const foam = haBell(shore.sub(0.18).sub(lap).div(0.34)).mul(w3.b.mul(0.8).add(0.35));
        col.assign(mix(col, haSkyLight(u, vec3(0.0, 1.0, 0.0)).mul(0.9).add(u.sun.mul(lit).mul(0.1)), clamp(foam, 0.0, 0.85)));

        // ── Gameplay light riding the water itself ──
        col.addAssign(ring.mul(2.0));
        col.addAssign(clear.rgb.mul(0.8));
        return haAtmosphere(u, col, p);
    })();

    const geometry = new THREE.PlaneGeometry(14000, 14000, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, -3200);
    const part = haPart('HalcyonApexWater', geometry, material, -26);
    part.reflection = reflection;
    part.reflectorTarget = reflection ? reflection.target : null;
    return part;
}
