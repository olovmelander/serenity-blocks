/**
 * Pyrestorm — the eruption column as a volume.
 *
 * A closed tube round the column's curved axis (crater → anvil) is the proxy: each of its front
 * faces starts a ray that marches through the ash. The ash's density is the column's own shape (a
 * round body as wide as `columnWidth`) whose surface billow noise heaves into cauliflower lobes. The
 * noise lives in the column's own frame (across the axis in widths, along it in widths travelled),
 * advected up the axis, so the lobes climb with the column, grow as it widens and never shear.
 *
 * Light at a sample: the crater's fire from below (reddening and fading with height, shadowed by
 * one tap of density toward the crater, so lobes turned to the fire burn and the folds between them
 * go dark), the night sky from above (one tap upward), the lava's wide glow and the lightning (once
 * per ray), the blast's front passing through, and the incandescent ejecta in the column's foot.
 * Front to back, premultiplied; the march stops once the ash is opaque. The density is pinned where
 * it is made, so each of its three uses (the sample, a tap toward the fire, a tap up) is emitted
 * once. One loop only: a tap loop nested inside the march drew a broken column on WebGL2 through
 * ANGLE's D3D11 translation.
 */
import * as THREE from 'three/webgpu';
import {
    Break,
    Fn,
    If,
    Loop,
    abs,
    cameraPosition,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    int,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    pow,
    screenCoordinate,
    sin,
    smoothstep,
    vec3,
    vec4,
} from 'three/tsl';
import {
    COLUMN, CRATER, TAU, columnPoint, columnWidth,
} from './pyrestorm-core.js';
import {
    aerial, lightningAt, noise3, pyBlackbody, pyHash21, wideGlowAt,
} from './pyrestorm-tsl.js';

/** The axis' foot (m) — `columnPoint(0)`'s height. */
const Y0 = CRATER.y + 80;
/** Lobes per column width (the first octave). */
const LOBES = 2.2;
/** How fast the ash climbs, in widths per second at the foot (it slows as the column widens). */
const CLIMB = 0.05;
/** The proxy's radius as a share of the column's width (the densest lobe reaches 0.75). */
const PROXY = 0.8;

/**
 * The column's length in its own widths from the foot to s: ∫ |C'(s)| / w(s) ds, fitted once as
 * a·s + b·s² + c·s³ (least squares over 128 samples) so the shader reads it in closed form.
 */
export const ALONG = (() => {
    const n = 128;
    const p = [0, 0, 0];
    const q = [0, 0, 0];
    let acc = 0;
    const samples = [];
    for (let i = 0; i <= n; i++) {
        const s = i / n;
        if (i > 0) {
            const s0 = (i - 1) / n;
            columnPoint(s0, p);
            columnPoint(s, q);
            const seg = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
            acc += seg / columnWidth((s0 + s) / 2);
        }
        samples.push([s, acc]);
    }
    // Normal equations for the basis (s, s², s³).
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const r = [0, 0, 0];
    for (const [s, b] of samples) {
        const f = [s, s * s, s * s * s];
        for (let a = 0; a < 3; a++) {
            r[a] += f[a] * b;
            for (let c = 0; c < 3; c++) M[a][c] += f[a] * f[c];
        }
    }
    // Gaussian elimination (3 × 3, well conditioned on [0, 1]).
    for (let a = 0; a < 3; a++) {
        for (let c = a + 1; c < 3; c++) {
            const k = M[c][a] / M[a][a];
            for (let d = a; d < 3; d++) M[c][d] -= k * M[a][d];
            r[c] -= k * r[a];
        }
    }
    const x = [0, 0, 0];
    for (let a = 2; a >= 0; a--) {
        let v = r[a];
        for (let c = a + 1; c < 3; c++) v -= M[a][c] * x[c];
        x[a] = v / M[a][a];
    }
    return Object.freeze({
        a: x[0], b: x[1], c: x[2], total: acc,
    });
})();

/** How far the tube reaches below the vent (m): the foot rounds off down in the crater. */
const FOOT = 700;

/** The proxy: a closed tube round the axis, its faces outward (front faces start the rays). */
export function plumeGeometry(rings = 72, segs = 28) {
    const positions = [];
    const index = [];
    const p = [0, 0, 0];
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    const centres = [];
    // Ring 0 sits FOOT metres down the axis' tangent below the vent; rings 1… run s 0 → 1.
    for (let i = 0; i <= rings + 1; i++) {
        const s = Math.max(0, (i - 1) / rings);
        columnPoint(s, p);
        columnPoint(Math.max(0, s - 0.002), a);
        columnPoint(Math.min(1, s + 0.002), b);
        const T = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
        if (i === 0) {
            p[0] -= T.x * FOOT;
            p[1] -= T.y * FOOT;
            p[2] -= T.z * FOOT;
        }
        const B1 = new THREE.Vector3().crossVectors(T, new THREE.Vector3(0, 0, 1)).normalize();
        const B2 = new THREE.Vector3().crossVectors(T, B1);
        const R = columnWidth(s) * PROXY;
        centres.push([p[0], p[1], p[2]]);
        for (let j = 0; j < segs; j++) {
            const th = (j / segs) * TAU;
            const c = Math.cos(th) * R;
            const sn = Math.sin(th) * R;
            positions.push(p[0] + B1.x * c + B2.x * sn, p[1] + B1.y * c + B2.y * sn, p[2] + B1.z * c + B2.z * sn);
        }
    }
    for (let i = 0; i <= rings; i++) {
        for (let j = 0; j < segs; j++) {
            const ia = i * segs + j;
            const ib = (i + 1) * segs + j;
            const ic = i * segs + ((j + 1) % segs);
            const id = (i + 1) * segs + ((j + 1) % segs);
            index.push(ia, ic, ib, ic, id, ib);
        }
    }
    // Caps: the foot faces back down the axis, the head on along it.
    const foot = positions.length / 3;
    positions.push(...centres[0]);
    const head = foot + 1;
    positions.push(...centres[rings + 1]);
    const last = (rings + 1) * segs;
    for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % segs;
        index.push(foot, j1, j);
        index.push(head, last + j, last + j1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    return geometry;
}

// ── The axis in TSL (twins of columnPoint / columnWidth) ──────────────────────────────

const axisAt = (k) => {
    const lean = pow(max(k, 1e-5), COLUMN.lean);
    return vec3(
        lean.mul(COLUMN.drift[0]).add(sin(k.mul(4.1)).mul(180.0)).add(CRATER.x),
        float(1.0).sub(pow(max(float(1.0).sub(k), 1e-5), 1.25)).mul(COLUMN.rise).add(Y0),
        lean.mul(COLUMN.drift[1]).add(CRATER.z),
    );
};
const axisSlope = (k) => {
    const lean = pow(max(k, 1e-5), COLUMN.lean - 1).mul(COLUMN.lean);
    return vec3(
        lean.mul(COLUMN.drift[0]).add(cos(k.mul(4.1)).mul(180.0 * 4.1)),
        pow(max(float(1.0).sub(k), 1e-5), 0.25).mul(1.25 * COLUMN.rise),
        lean.mul(COLUMN.drift[1]),
    );
};
const widthAt = (k) => mix(float(COLUMN.baseWidth), float(COLUMN.topWidth), pow(max(k, 1e-5), 1.15));
const alongAt = (k) => k.mul(ALONG.a).add(k.mul(k).mul(ALONG.b)).add(k.mul(k).mul(k).mul(ALONG.c));

/** The axis parameter nearest a world point: from its height, then two Gauss-Newton steps. */
const nearestK = (P) => {
    const yy = clamp(P.y.sub(Y0).div(COLUMN.rise), 0.0, 0.999);
    const k = float(1.0).sub(pow(float(1.0).sub(yy), 0.8)).toVar();
    for (let n = 0; n < 2; n++) {
        const C = axisAt(k);
        const D = axisSlope(k);
        k.assign(clamp(k.sub(dot(C.sub(P), D).div(dot(D, D))), 0.0, 1.0));
    }
    return k;
};

/** Billow noise: round humps parted by sharp creases (a cauliflower's surface). */
const billow = (n) => abs(n.mul(2.0).sub(1.0));

export function createPlume(u, t, tier) {
    const steps = tier.plumeSteps;
    const geometry = plumeGeometry();
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PyrestormPlume';
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.FrontSide;
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    material.fog = false;
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);

    /** The ash's density at P (0 … 1) and the axis parameter nearest P. */
    const densityAt = (P) => {
        const k = nearestK(P);
        const C = axisAt(k);
        const T = normalize(axisSlope(k));
        const B1 = normalize(cross(T, vec3(0.0, 0.0, 1.0)));
        const B2 = cross(T, B1);
        const w = widthAt(k);
        const d = P.sub(C);
        const rho = length(d).div(w.mul(0.5));
        // The column's frame: across in widths, along in widths travelled; turning slowly as it climbs.
        const along = alongAt(k);
        const turn = along.mul(0.45).add(u.time.mul(0.015));
        const x = dot(d, B1).div(w);
        const y = dot(d, B2).div(w);
        const q = vec3(x.mul(cos(turn)).sub(y.mul(sin(turn))), x.mul(sin(turn)).add(y.mul(cos(turn))), along)
            .mul(LOBES)
            .sub(vec3(0.0, 0.0, u.time.mul(CLIMB * LOBES)));
        // Lobes on lobes: each octave rolls at its own pace (the smaller ones churn faster).
        let f = billow(noise3(t.lattice, q).x).mul(0.55);
        f = f.add(billow(noise3(t.lattice, q.mul(2.3).add(vec3(5.2, 1.3, u.time.mul(-0.07)))).y).mul(0.3));
        f = f.add(billow(noise3(t.lattice, q.mul(5.1).add(vec3(2.7, 8.1, u.time.mul(-0.16)))).x).mul(0.15));
        const raw = float(1.0).sub(rho).mul(1.3).add(f.sub(0.42).mul(1.25));
        // Rounded off below the vent (the distance to the axis' foot), gone into the anvil's head.
        // Pinned: read in several branches, it must be computed once.
        return { den: smoothstep(-0.04, 0.34, raw).mul(float(1.0).sub(smoothstep(0.92, 1.0, k))).toVar(), k: k.toVar() };
    };

    material.outputNode = Fn(() => {
        // Everything once per ray is pinned here, before the march (never first built in its branch).
        const P0 = positionWorld.toVar();
        const V = normalize(P0.sub(cameraPosition)).toVar();
        const k0 = nearestK(P0);
        const w0 = widthAt(k0).toVar();
        const T0 = normalize(axisSlope(k0));
        // Through the tube: its diameter, longer as the ray runs along the axis.
        const across = max(length(cross(V, T0)), 0.35);
        const span = w0.mul(PROXY * 2.0).div(across);
        const dt = span.div(steps).toVar();
        // Each pixel starts a random fraction of a step in (no banding; a hash, so the residue is
        // grain like the post's, never the diagonal hatching interleaved gradient noise leaves).
        const jitter = pyHash21(screenCoordinate.xy.floor()).toVar();
        const sigma = float(26.0).div(w0).toVar();
        const mid = P0.add(V.mul(w0.mul(0.4))).toVar();
        // Once per ray: the lava's wide glow from below and the lightning inside the cloud.
        const aboveMid = max(mid.y.sub(CRATER.y), 0.0);
        const lavaBelow = u.fireColour.mul(vec3(1.0, 0.7, 0.55)).mul(wideGlowAt(t, mid.xz).mul(0.12).add(0.025))
            .mul(exp(aboveMid.div(-4200.0))).mul(u.activity)
            .mul(0.6)
            .toVar();
        const bolts = lightningAt(u, mid, vec3(0.0, -1.0, 0.0), 1).mul(0.55).toVar();
        const coolSky = mix(u.ambient, vec3(0.022, 0.026, 0.04), 0.5).toVar();
        const fireAt = vec3(CRATER.x, CRATER.y + 150.0, CRATER.z);
        const acc = vec3(0.0).toVar();
        const keep = float(1.0).toVar();
        Loop({
            start: int(0), end: int(steps), type: 'int', condition: '<', name: 'pi',
        }, ({ pi }) => {
            const P = P0.add(V.mul(float(pi).add(jitter).mul(dt))).toVar();
            const sample = densityAt(P);
            const { den } = sample;
            If(den.greaterThan(0.003), () => {
                const { k } = sample;
                const w = widthAt(k);
                const above = max(P.y.sub(CRATER.y), 0.0);
                // The fire: it reaches the column's lower third, reddening through the ash it crosses.
                const reach = exp(above.div(-900.0));
                const deep = mix(vec3(1.0, 0.45, 0.3), vec3(1.0, 1.0, 1.0), reach);
                const burn = u.fountain.mul(u.activity).mul(reach.mul(0.95).add(0.05));
                // Each light by the density's slope toward it (a lobe's face turned to it is lit,
                // round and soft) and by what lies between (the folds between lobes go dark): a tap
                // a step toward the fire and a step up, the step a share of the column's width.
                const toFire = normalize(fireAt.sub(P));
                const denF = densityAt(P.add(toFire.mul(w.mul(0.07)))).den;
                const denS = densityAt(P.add(vec3(0.0, 1.0, 0.0).mul(w.mul(0.07)))).den;
                const shadeF = clamp(den.sub(denF).mul(1.6).add(0.5), 0.0, 1.0).mul(exp(denF.mul(-1.4)).mul(0.6).add(0.4));
                const shadeS = clamp(den.sub(denS).mul(1.6).add(0.5), 0.0, 1.0).mul(exp(denS.mul(-1.4)).mul(0.6).add(0.4));
                const fire = u.fireColour.mul(deep).mul(burn).mul(shadeF.mul(0.85).add(0.15)).mul(4.0);
                const sky = coolSky.mul(shadeS.mul(0.8).add(0.2)).mul(1.8);
                // The blast's front: the ash flashes pale where it passes (condensation).
                const dShock = length(P.sub(fireAt)).sub(u.shock.x);
                const shock = exp(dShock.div(260.0).mul(dShock.div(260.0)).negate()).mul(u.shock.y);
                const light = fire.add(lavaBelow).add(sky).add(bolts).add(vec3(0.7, 0.68, 0.74).mul(shock));
                // Incandescent ejecta in the column's foot.
                const hot = float(1.0).sub(smoothstep(0.0, 0.06, k)).mul(u.activity).mul(u.fountain.mul(0.3).add(0.7));
                const col = u.ash.mul(light).add(pyBlackbody(hot.mul(0.45).add(0.12)).mul(hot).mul(0.1));
                const a = float(1.0).sub(exp(den.mul(sigma).mul(dt).negate()));
                acc.addAssign(col.mul(a).mul(keep));
                keep.mulAssign(float(1.0).sub(a));
            });
            If(keep.lessThan(0.02), () => {
                Break();
            });
        });
        const alpha = float(1.0).sub(keep);
        const seen = aerial(u, t, mid, acc.div(max(alpha, 1e-4)));
        return vec4(seen.mul(alpha), alpha);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'PyrestormPlume';
    mesh.frustumCulled = false;
    mesh.renderOrder = 21;
    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
