/**
 * Ice Temple — the architecture: every column, rib, icicle and crystal, as ONE merged,
 * flat-shaded geometry and one material.
 *
 * The geometry is faceted on purpose (a hexagonal prism with bevelled corners is the temple's
 * module, as it is the ice crystal's): each face carries its own normal, so each face mirrors its
 * own piece of sky. Next to the face normal every vertex carries a smooth normal (radial from
 * the piece's axis), which gives the shader the chord a view ray travels through the body.
 *
 * The ice is not lit by a light. It is shaded as what ice is: a body that absorbs red and lets
 * blue through (Beer–Lambert over the chord), that scatters the Great Crystal's light forward
 * when the crystal stands behind it, that carries fracture veils inside (three parallax layers
 * of the baked noise, shifted along the refracted view ray), that mirrors the sky on its faces
 * (Fresnel), and that is frosted white at its foot and snow-capped on every ledge. Gameplay
 * lights the fractures from within.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraPosition,
    cross,
    dot,
    exp,
    float,
    floor,
    length,
    max,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    pow,
    reflect,
    refract,
    sin,
    smoothstep,
    step,
    vec2,
    vec3,
} from 'three/tsl';
import {
    MOON,
    REST_RIG,
    TAU,
    itAtmosphere,
    itClearLight,
    itHash21,
    itHeartLight,
    itLobes,
    itLockLight,
    itMax3,
    itMoonDir,
    itMoonShadow,
    itPart,
    itResonance,
    itSaturate,
    itSky,
    mulberry32,
} from './ice-temple-tsl.js';

const KIND = Object.freeze({
    structure: 0, shard: 1, heart: 2, icicle: 3,
});

/** Angles of the temple's module: a hexagon with bevelled corners (twelve faces). */
const BEVEL = (21 * Math.PI) / 180;
const HEX_PROFILE = (() => {
    const out = [];
    for (let i = 0; i < 6; i++) {
        out.push((i * TAU) / 6 - BEVEL, (i * TAU) / 6 + BEVEL);
    }
    return out;
})();
const polygon = (n) => Array.from({ length: n }, (_, i) => (i * TAU) / n);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossV = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dotV = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Collects flat-shaded triangles with the per-vertex data the ice material reads:
 * `aSmooth` (radial normal), `aInfo` (chord radius, seed, kind, 0) and `aSt` (metres round the
 * piece and along it; the seam of `s` faces away from the camera).
 */
class IceBuilder {
    constructor() {
        this.position = [];
        this.normal = [];
        this.smooth = [];
        this.info = [];
        this.st = [];
        this.triangles = 0;
    }

    tri(a, b, c, piece) {
        let n = crossV(sub(b.p, a.p), sub(c.p, a.p));
        const area = Math.hypot(n[0], n[1], n[2]);
        if (area < 1e-9) return;
        n = [n[0] / area, n[1] / area, n[2] / area];
        const out = [a.n[0] + b.n[0] + c.n[0], a.n[1] + b.n[1] + c.n[1], a.n[2] + b.n[2] + c.n[2]];
        let order = [a, b, c];
        if (dotV(n, out) < 0) {
            order = [a, c, b];
            n = [-n[0], -n[1], -n[2]];
        }
        for (let i = 0; i < 3; i++) {
            const v = order[i];
            this.position.push(v.p[0], v.p[1], v.p[2]);
            this.normal.push(n[0], n[1], n[2]);
            this.smooth.push(v.n[0], v.n[1], v.n[2]);
            this.info.push(piece.radius, piece.seed, piece.kind, 0);
            this.st.push(v.s, v.t);
        }
        this.triangles += 1;
    }

    quad(a, b, c, d, piece) {
        this.tri(a, b, c, piece);
        this.tri(a, c, d, piece);
    }

    /**
     * A ring of vertices round `centre` in the plane of e1/e2.
     * @param {number[]} centre
     * @param {number[]} e1
     * @param {number[]} e2
     * @param {number} radius
     * @param {number[]} profile   angles
     * @param {number} twist       added to every angle
     * @param {number} t           metres along the piece
     * @param {number} seamAngle   the angle (in the ring's own frame) that faces the camera
     * @param {number} [slope=0]   tilt of the smooth normal along the axis (for tapers)
     * @param {number[]} [axis]
     */
    ring(centre, e1, e2, radius, profile, twist, t, seamAngle, slope = 0, axis = null) {
        const verts = [];
        for (let i = 0; i < profile.length; i++) {
            const a = profile[i] + twist;
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            const radial = [e1[0] * ca + e2[0] * sa, e1[1] * ca + e2[1] * sa, e1[2] * ca + e2[2] * sa];
            let s = a - seamAngle;
            s -= TAU * Math.round(s / TAU);
            const n = axis
                ? norm([radial[0] + axis[0] * slope, radial[1] + axis[1] * slope, radial[2] + axis[2] * slope])
                : radial;
            verts.push({
                p: [centre[0] + radial[0] * radius, centre[1] + radial[1] * radius, centre[2] + radial[2] * radius],
                n,
                s: s * Math.max(radius, 0.15),
                t,
            });
        }
        return verts;
    }

    /** Join consecutive rings with quads. */
    sweep(rings, piece) {
        for (let j = 0; j + 1 < rings.length; j++) {
            const lo = rings[j];
            const hi = rings[j + 1];
            for (let i = 0; i < lo.length; i++) {
                const k = (i + 1) % lo.length;
                this.quad(lo[i], lo[k], hi[k], hi[i], piece);
            }
        }
    }

    /** Close a ring to a point. */
    cone(ring, apex, piece) {
        for (let i = 0; i < ring.length; i++) {
            const k = (i + 1) % ring.length;
            this.tri(ring[i], ring[k], apex, piece);
        }
    }

    build() {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
        geometry.setAttribute('aSmooth', new THREE.Float32BufferAttribute(this.smooth, 3));
        geometry.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 4));
        geometry.setAttribute('aSt', new THREE.Float32BufferAttribute(this.st, 2));
        return geometry;
    }
}

const UP = [0, 1, 0];
const X = [1, 0, 0];
const Z = [0, 0, 1];

/** The angle, in the x/z frame, of the direction from (x, z) to the rest camera. */
const seamToward = (x, z) => Math.atan2(REST_RIG.z - z, REST_RIG.x - x);

/** A vertical column: plinth, shaft with a little entasis, capital. Broken ones end in a snag. */
function addColumn(builder, column, rand) {
    const {
        x, z, radius: r, height: h, twist, broken,
    } = column;
    const piece = { radius: r, seed: column.seed, kind: KIND.structure };
    const seam = seamToward(x, z);
    const at = (y, radius, spin = 0, slope = 0) => builder.ring([x, y, z], X, Z, radius, HEX_PROFILE, twist + spin, y, seam, slope, UP);
    const rings = [
        at(-0.4, r * 1.52),
        at(0.55, r * 1.52),
        at(0.95, r * 1.2, 0, 0.6),
        at(1.5, r * 1.06, 0, 0.2),
    ];
    if (broken) {
        rings.push(at(h * 0.6, r * 0.99));
        builder.sweep(rings, piece);
        // The snag: the break is a slope with splinters standing on it.
        const top = rings[rings.length - 1];
        const lean = rand() * TAU;
        const snag = top.map((v) => {
            const rise = (Math.cos(Math.atan2(v.p[2] - z, v.p[0] - x) - lean) * 0.5 + 0.5) * h * 0.4;
            return {
                p: [x + (v.p[0] - x) * 0.82, h * 0.6 + rise, z + (v.p[2] - z) * 0.82], n: v.n, s: v.s, t: h * 0.6 + rise,
            };
        });
        builder.sweep([top, snag], piece);
        builder.cone(snag, {
            p: [x + Math.cos(lean) * r * 0.3, h * 0.82, z + Math.sin(lean) * r * 0.3], n: UP, s: 0, t: h,
        }, piece);
        return;
    }
    const cap = column.kind === 'aisle' ? 1.0 : 1.8;
    rings.push(
        at(h * 0.45, r * 1.0),
        at(h - cap - 0.5, r * 0.94),
        at(h - cap, r * 0.98, 0, -0.3),
        at(h - cap * 0.55, r * 1.32, 0.12, -0.7),
        at(h - cap * 0.2, r * 1.5, 0.12, -0.2),
        at(h + 0.15, r * 1.5, 0.12),
        at(h + 0.6, r * 1.08, 0.12, 0.8),
    );
    builder.sweep(rings, piece);
    builder.cone(rings[rings.length - 1], {
        p: [x, h + 1.0, z], n: UP, s: 0, t: h + 1,
    }, piece);
}

/** A crystal: a bevelled hexagonal prism along `dir`, cut to a point. */
function addCrystal(builder, crystal, rand) {
    const {
        base, dir, length: len, radius: r,
    } = crystal;
    const axis = norm(dir);
    const ref = Math.abs(axis[1]) > 0.9 ? X : UP;
    const e1 = norm(crossV(ref, axis));
    const e2 = crossV(axis, e1);
    const piece = { radius: r, seed: crystal.seed, kind: crystal.kind === 'heart' ? KIND.heart : KIND.shard };
    const twist = rand() * TAU;
    // The seam faces away from the camera, measured in the crystal's own frame.
    const toCam = norm([REST_RIG.x - base[0], REST_RIG.height - base[1], REST_RIG.z - base[2]]);
    const seam = Math.atan2(dotV(toCam, e2), dotV(toCam, e1)) - twist;
    const at = (d, radius, slope = 0) => builder.ring(
        [base[0] + axis[0] * d, base[1] + axis[1] * d, base[2] + axis[2] * d],
        e1,
        e2,
        radius,
        HEX_PROFILE,
        twist,
        d,
        seam + twist,
        slope,
        axis,
    );
    const shoulder = len * (0.74 + rand() * 0.12);
    const rings = [at(0, r * 1.04), at(len * 0.4, r), at(shoulder, r * 0.93)];
    builder.sweep(rings, piece);
    // The termination: six faces to an off-centre point, as a real crystal's is.
    const off = r * 0.22;
    const a = rand() * TAU;
    builder.cone(rings[rings.length - 1], {
        p: [
            base[0] + axis[0] * len + (e1[0] * Math.cos(a) + e2[0] * Math.sin(a)) * off,
            base[1] + axis[1] * len + (e1[1] * Math.cos(a) + e2[1] * Math.sin(a)) * off,
            base[2] + axis[2] * len + (e1[2] * Math.cos(a) + e2[2] * Math.sin(a)) * off,
        ],
        n: axis,
        s: 0,
        t: len,
    }, piece);
}

/** A rib: a six-sided section swept along a polyline. */
function addRib(builder, rib) {
    const { points, radius: r } = rib;
    const piece = { radius: r, seed: rib.seed, kind: KIND.structure };
    const profile = polygon(6);
    const planeNormal = norm(rib.normal);
    const rings = [];
    let run = 0;
    for (let i = 0; i < points.length; i++) {
        const prev = points[Math.max(0, i - 1)];
        const next = points[Math.min(points.length - 1, i + 1)];
        const tangent = norm(sub(next, prev));
        if (i > 0) run += Math.hypot(...sub(points[i], points[i - 1]));
        // e1 lies in the arch's plane, across the rib; e2 is the plane's normal.
        const e1 = norm(crossV(planeNormal, tangent));
        const e2 = crossV(tangent, e1);
        // The seam goes on top, out of sight from below.
        const up = Math.atan2(dotV(UP, e2), dotV(UP, e1));
        rings.push(builder.ring(points[i], e1, e2, r, profile, Math.PI / 6, run, up + Math.PI));
    }
    builder.sweep(rings, piece);
}

/** An icicle: a five-sided spike hanging from a point. */
function addIcicle(builder, icicle) {
    const piece = { radius: icicle.radius, seed: icicle.seed, kind: KIND.icicle };
    const profile = polygon(5);
    const spin = icicle.seed * TAU;
    const top = builder.ring([icicle.x, icicle.y + 0.15, icicle.z], X, Z, icicle.radius, profile, spin, 0, 0);
    const mid = builder.ring([icicle.x, icicle.y - icicle.length * 0.35, icicle.z], X, Z, icicle.radius * 0.62, profile, spin, icicle.length * 0.35, 0);
    builder.sweep([mid, top], piece);
    builder.cone(mid, {
        p: [icicle.x, icicle.y - icicle.length, icicle.z], n: [0, -1, 0], s: 0, t: icicle.length,
    }, piece);
}

/**
 * @param {object} u       shared temple uniforms
 * @param {object} plan    buildPlan()
 * @param {object} [opts]
 * @param {number} [opts.veils=3]  parallax layers of fracture veils inside the ice (1..3)
 */
export function createArchitecture(u, plan, opts = {}) {
    const veils = Math.max(1, Math.min(3, opts.veils ?? 3));
    const builder = new IceBuilder();
    const rand = mulberry32(0x1ce7e);
    plan.columns.forEach((column) => addColumn(builder, column, rand));
    plan.ribs.forEach((rib) => addRib(builder, rib));
    plan.crystals.forEach((crystal) => addCrystal(builder, crystal, rand));
    plan.icicles.forEach((icicle) => addIcicle(builder, icicle));
    const geometry = builder.build();

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'IceTempleArchitecture';
    material.fog = false;

    material.colorNode = Fn(() => {
        const p = positionWorld;
        const N = normalize(normalWorld).toVar();
        const Ns = normalize(attribute('aSmooth', 'vec3')).toVar();
        const info = attribute('aInfo', 'vec4');
        const st = attribute('aSt', 'vec2');
        const kind = info.z;
        const isHeart = step(1.5, kind).mul(step(kind, 2.5));
        const isIcicle = step(2.5, kind);

        const rel = p.sub(cameraPosition);
        const dist = length(rel);
        const Vd = rel.div(max(dist, 1e-3)).toVar();
        const ndv = itSaturate(dot(N, Vd.negate()));
        const ndvS = itSaturate(dot(Ns, Vd.negate())).toVar();

        // ── The body: how far the ray travels through it, and what survives ──
        const thick = info.x.mul(ndvS.mul(1.65).add(0.35));
        const absorb = exp(thick.mul(vec3(-0.62, -0.16, -0.05)));
        const Rf = normalize(refract(Vd, N, 0.763).add(Vd.mul(0.001))).toVar();
        const behind = itSky(u, Rf, 0.1).add(itLobes(u, p, Rf).mul(0.8));

        // ── The light that reaches it ──
        const toHeart = u.heartPos.sub(p);
        const heartDir = toHeart.div(max(length(toHeart), 1.0)).toVar();
        const heart = itHeartLight(u, p).toVar();
        // Ice throws light forward: it burns when the Great Crystal stands behind it.
        const through = pow(itSaturate(dot(Vd, heartDir)), 5.0);
        const wrap = itSaturate(dot(Ns, heartDir).mul(0.5).add(0.5));
        const moonDir = itMoonDir();
        const shadow = itMoonShadow(p).toVar();
        const moon = u.moonColor.mul(u.ambient).mul(shadow).toVar();
        const sky = u.skyHorizon.mul(u.ambient)
            .add(u.auroraA.mul(u.auroraGain).mul(Ns.y.mul(0.5).add(0.5)).mul(0.012))
            .toVar();
        // The lake carries the heart's light: it wells up into whatever stands on it.
        const well = u.heartColor.mul(u.ambient).mul(exp(max(p.y, 0.0).mul(-0.085))).mul(0.085);

        // ── Gameplay ──
        const lock = itLockLight(u, p);
        const clear = itClearLight(u, p.z).toVar();
        const fill = float(1.0).sub(smoothstep(u.resLevel.sub(3.0), u.resLevel.add(0.5), p.y));
        const pulse = lock.mul(1.2)
            .add(clear.rgb.mul(1.3))
            .add(u.heartColor.mul(clear.w).mul(0.1))
            .add(itResonance(u, p).mul(fill).mul(0.62))
            .toVar();
        // Four fronts arriving together must light the ice, not white it out.
        pulse.assign(pulse.div(itMax3(pulse).mul(0.3).add(1.0)));

        // ── Inside. Gauzy fracture sheets at three depths along the refracted ray; a milky core
        // where the eye looks through the thick middle; the faint strata of ice laid down in
        // layers. All of it the baked noise read along the piece. ──
        const Ts = normalize(cross(vec3(0.0, 1.0, 0.0), Ns).add(vec3(1e-3, 0.0, 0.0)));
        const slide = vec2(dot(Rf, Ts), Rf.y);
        const c0 = st.add(vec2(info.y.mul(37.0), info.y.mul(11.0)));
        const veil = float(0.0).toVar();
        const depths = [[0.15, 0.5], [0.5, 0.32], [1.0, 0.2]];
        for (let i = 0; i < veils; i++) {
            const [d, w] = depths[i];
            const q = c0.add(slide.mul(info.x.mul(d))).mul(vec2(0.56 - i * 0.08, 0.021)).add(d * 0.37);
            const n = u.noise(q);
            const sheet = float(1.0).sub(smoothstep(0.0, 0.075, n.r.sub(0.5).abs()))
                .mul(smoothstep(0.5, 0.74, n.g));
            veil.addAssign(sheet.mul(w));
        }
        const grainIn = u.noise(c0.add(slide.mul(info.x.mul(0.4))).mul(vec2(3.3, 0.28))).toVar();
        veil.mulAssign(grainIn.b.mul(0.9).add(0.5));
        const wisp = u.noise(c0.add(slide.mul(info.x.mul(0.7))).mul(vec2(0.47, 0.04)).add(3.1)).toVar();
        const cloud = smoothstep(0.36, 0.82, wisp.a).mul(ndvS.mul(ndvS));
        const strata = smoothstep(0.9, 1.0, sin(st.y.mul(2.3).add(wisp.b.mul(5.0)).add(info.y.mul(40.0)))).mul(0.12);
        const inner = veil.mul(0.75).add(cloud.mul(0.55)).add(strata).toVar();

        // ── Compose the ice ──
        const tint = vec3(0.34, 0.72, 1.0);
        const milky = float(1.0).sub(exp(thick.mul(-0.4))).mul(wisp.b.mul(0.7).add(0.4));
        const scatter = heart.mul(through.mul(2.4).add(wrap.mul(0.16)))
            .add(moon.mul(itSaturate(dot(Ns, moonDir).mul(0.7).add(0.3))).mul(0.2))
            .add(sky.mul(0.8))
            .add(well)
            .mul(tint)
            .mul(milky);
        // Thin ice at the silhouette lets the most through.
        const rim = pow(float(1.0).sub(ndvS), 3.0);
        const edge = heart.mul(through.mul(1.6).add(0.1))
            .add(moon.mul(itSaturate(dot(Ns, moonDir).mul(0.5).add(0.5))).mul(0.42))
            .add(sky.mul(1.6))
            .add(well.mul(1.4))
            .mul(tint)
            .mul(rim);
        const body = behind.mul(absorb).add(scatter).add(edge);
        const lit = body.add(scatter.mul(1.6).add(well.mul(tint).mul(1.5)).add(sky.mul(0.8)).mul(inner))
            // The pulses light the ice from within: the fracture sheets most of all.
            .add(pulse.mul(inner.mul(2.4).add(rim.mul(0.9)).add(milky.mul(0.25)).add(0.08))
                .mul(vec3(0.75, 0.92, 1.0)))
            .toVar();

        // ── The faces: a mirror for the aurora (Fresnel, pushed a little past what ice gives,
        // so every facet carries a moving sheen), and the long glints a prism's faces throw —
        // a face lights from top to bottom when it turns the moon or the heart to the eye ──
        const Rl = reflect(Vd, N).toVar();
        const fres = float(0.05).add(float(0.95).mul(pow(float(1.0).sub(ndv), 4.0)));
        const mirror = itSky(u, Rl, 0.34).add(itLobes(u, p, Rl));
        const flatR = Rl.xz.div(max(length(Rl.xz), 1e-3));
        const upright = float(1.0).sub(N.y.abs());
        const moonGlint = pow(itSaturate(dot(flatR, vec2(MOON.flat[0], MOON.flat[1]))), 90.0)
            .mul(itSaturate(Rl.y.add(0.35)));
        const heartFlat = heartDir.xz.div(max(length(heartDir.xz), 1e-3));
        const heartGlint = pow(itSaturate(dot(flatR, heartFlat)), 60.0);
        const glint = moon.mul(moonGlint).mul(1.5)
            .add(heart.mul(heartGlint).mul(0.9))
            .mul(upright);
        const col = lit.mul(float(1.0).sub(fres))
            .add(mirror.mul(fres))
            .add(glint.mul(fres.mul(4.0).add(0.2)))
            .toVar();

        // ── Frost at the foot, snow on every ledge ──
        const grain = u.noise(p.xz.mul(0.29).add(vec2(p.y.mul(0.17), p.y.mul(0.11)))).toVar();
        const cap = smoothstep(0.46, 0.8, N.y.add(grain.r.mul(0.3)).sub(0.12));
        const foot = float(1.0).sub(smoothstep(0.1, grain.g.mul(2.6).add(1.3), p.y)).mul(0.7);
        const frost = max(cap, foot).mul(float(1.0).sub(isHeart)).mul(float(1.0).sub(isIcicle.mul(0.7)));
        const frostLight = moon.mul(itSaturate(dot(N, moonDir).mul(0.8).add(0.2))).mul(0.6)
            .add(heart.mul(itSaturate(dot(N, heartDir).mul(0.7).add(0.3))).mul(0.55))
            .add(sky.mul(1.6))
            .add(well.mul(0.8))
            .add(pulse.mul(0.9));
        // Frost sparkles: a crystal face here and there turns to the eye.
        const cell = floor(p.mul(42.0));
        const spark = step(0.988, itHash21(cell.xz.add(cell.y.mul(7.13))))
            .mul(pow(sin(dot(Vd, vec3(41.0, 23.0, 37.0)).add(itHash21(cell.xy)).mul(6.283)).mul(0.5).add(0.5), 6.0));
        col.assign(mix(col, frostLight.mul(vec3(0.82, 0.92, 1.0)).mul(spark.mul(6.0).add(0.85)), frost));

        // ── The Great Crystal burns from within ──
        const core = u.heartColor.mul(u.heartPower).mul(ndvS.mul(ndvS).mul(1.3).add(inner.mul(1.8)).add(0.28));
        col.addAssign(core.mul(isHeart).mul(clear.w.mul(0.35).add(1.0)));

        return itAtmosphere(u, col, p);
    })();

    const part = itPart('IceTempleArchitecture', geometry, material, 0, true);
    part.triangles = builder.triangles;
    return part;
}
