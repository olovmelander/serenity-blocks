/**
 * Shifting Sands — the formations: one merged mesh, one material, one draw.
 *
 *  - The Sentinel: a monumental sandstone butte in the right zone — talus apron, a vertical cliff
 *    banded with strata and ledges, fluted by rain grooves, a caprock lip and a flat crown. The
 *    low sun rakes its left flank; its front face sits in violet shade.
 *  - Two companion spires beside it and a few small outcrops in the left zone (dark silhouettes
 *    against the sun-side haze).
 *  - The Shield Wall: a long crenellated escarpment on the far horizon that the suns set toward,
 *    almost dissolved in haze — the last depth layer before the sky.
 *
 * Every formation is a deformed lathe (rings × segments) with analytic, closed-form radius, so
 * its normals are computed from the parametric partials and the shadow march can treat it as a
 * solid (`heightAt`). Shading: strata bands warped by noise, desert-varnish streaks down the
 * cliffs, sand caught on ledges and the apron, the twin-sun light, violet sky fill, a backlit
 * rim and the shared aerial perspective.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraPosition,
    clamp,
    dot,
    float,
    fract,
    max,
    mix,
    normalize,
    positionWorld,
    pow,
    smoothstep,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { groundPointAt, SENTINEL } from './shifting-sands-composition.js';
import { mulberry32, ssTexNoise } from './shifting-sands-tsl.js';

const TAU = Math.PI * 2;

/** Smooth periodic footprint noise: a few random harmonics. */
function makeFootprint(rand, {
    lobes = 5, amp = 0.16, elong = 0, elongAngle = 0, clefts = 0, cleftDepth = 0.16,
} = {}) {
    const harm = [];
    for (let k = 2; k < 2 + lobes; k++) {
        harm.push({ k, a: (amp / (k - 1)) * (0.6 + rand() * 0.8), ph: rand() * TAU });
    }
    const cuts = [];
    for (let i = 0; i < clefts; i++) {
        cuts.push({ th: rand() * TAU, w: 0.05 + rand() * 0.07, d: cleftDepth * (0.6 + rand() * 0.6) });
    }
    return (th) => {
        let r = 1;
        for (let i = 0; i < harm.length; i++) r += harm[i].a * Math.sin(harm[i].k * th + harm[i].ph);
        r *= 1 + elong * Math.cos(2 * (th - elongAngle));
        for (let i = 0; i < cuts.length; i++) {
            let d = Math.abs(th - cuts[i].th) % TAU;
            if (d > Math.PI) d = TAU - d;
            r -= cuts[i].d * Math.max(0, 1 - d / cuts[i].w) ** 1.5;
        }
        return r;
    };
}

/**
 * Vertical profile of a butte: radius multiplier at normalised height s ∈ [0, 1].
 * apron (s < sA): concave flare; cliff: near-vertical with a slight taper; lip: caprock.
 */
function butteProfile(s, {
    apron = 0.2, flare = 0.55, taper = 0.08, lip = 0.05,
} = {}) {
    if (s < apron) {
        // Concave talus cone: steepening toward the cliff foot.
        const t = s / apron;
        return 1 + flare * (1 - t) ** 1.7 + 0.04 * Math.sin(t * Math.PI);
    }
    const c = (s - apron) / (1 - apron);
    let r = 1 - taper * c;
    if (c > 0.9) r += lip * Math.sin(((c - 0.9) / 0.1) * Math.PI) ** 0.6;
    return r;
}

/** Spire profile: wide base, waisted neck, a hat of harder rock. */
function spireProfile(s) {
    if (s < 0.3) return 1.0 + 1.3 * (1 - s / 0.3) ** 1.8;
    const c = (s - 0.3) / 0.7;
    // Tapering column of harder and softer beds; a blunt hard cap.
    const beds = 0.07 * Math.sin(c * 19.0) + 0.04 * Math.sin(c * 47.0 + 1.3);
    let r = (1 - 0.42 * c ** 1.3) * (1 + beds);
    if (c > 0.86) r *= 1 + 0.12 * Math.sin(((c - 0.86) / 0.14) * Math.PI) ** 0.7;
    return r;
}

/**
 * One lathe formation.
 * @param {object} f  { x, z, base, height, radius, rings, segs, profile, footprint, flutes, strata, seed }
 * @returns {{ positions:number[], normals:number[], params:number[], indices:number[] }}
 */
function buildLathe(f, out, vertexOffset) {
    const rand = mulberry32(f.seed);
    const fluteK = 6 + Math.floor(rand() * 6);
    const flutePh = rand() * TAU;
    const R = (th, s) => {
        let r = f.radius * f.footprint(th) * f.profile(s);
        // Strata ledges: a small step every band.
        const yb = (s * f.height) / f.strata;
        const band = Math.floor(yb);
        const fr = yb - band;
        const bandAmp = (((Math.sin(band * 12.9898 + f.seed) * 43758.5453) % 1) + 1) % 1;
        if (s > 0.3) r *= 1 + 0.006 * bandAmp * (fr < 0.85 ? fr / 0.85 : (1 - fr) / 0.15);
        // Rain flutes on the cliff band.
        if (s > 0.18 && s < 0.97) {
            const g = Math.abs(Math.sin(th * fluteK + flutePh + Math.sin(th * 3 + s * 4) * 0.8));
            const g2 = Math.abs(Math.sin(th * fluteK * 2.7 + flutePh * 1.7 + s * 2));
            r *= 1 - f.flutes * (g ** 6 + 0.4 * g2 ** 10) * (0.5 + 0.5 * Math.min(1, (s - 0.18) * 3));
        }
        return r;
    };
    const twist = (rand() - 0.5) * 0.35;
    const P = (th, s, target) => {
        const r = R(th + twist * s * s, s);
        target[0] = f.x + Math.cos(th) * r;
        target[1] = f.base + s * f.height;
        target[2] = f.z + Math.sin(th) * r;
        return target;
    };
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    const c = [0, 0, 0];
    const d = [0, 0, 0];
    const { rings } = f;
    const { segs } = f;
    const eps = 1e-3;
    for (let i = 0; i <= rings; i++) {
        const s = i / rings;
        for (let j = 0; j < segs; j++) {
            const th = (j / segs) * TAU;
            P(th, s, a);
            P(th + eps, s, b);
            P(th - eps, s, c);
            const ds = Math.min(eps, s, 1 - s) || eps;
            P(th, Math.min(1, s + ds), d);
            const tx = b[0] - c[0];
            const ty = b[1] - c[1];
            const tz = b[2] - c[2];
            const P2 = P(th, Math.max(0, s - ds), [0, 0, 0]);
            const ux = d[0] - P2[0];
            const uy = d[1] - P2[1];
            const uz = d[2] - P2[2];
            // n = dP/ds × dP/dθ (outward).
            let nx = uy * tz - uz * ty;
            let ny = uz * tx - ux * tz;
            let nz = ux * ty - uy * tx;
            const nl = Math.hypot(nx, ny, nz) || 1;
            nx /= nl; ny /= nl; nz /= nl;
            out.positions.push(a[0], a[1], a[2]);
            out.normals.push(nx, ny, nz);
            out.params.push(s, f.height, f.kind, f.seed % 97);
        }
    }
    for (let i = 0; i < rings; i++) {
        for (let j = 0; j < segs; j++) {
            const j1 = (j + 1) % segs;
            const v00 = vertexOffset + i * segs + j;
            const v01 = vertexOffset + i * segs + j1;
            const v10 = vertexOffset + (i + 1) * segs + j;
            const v11 = vertexOffset + (i + 1) * segs + j1;
            out.indices.push(v00, v10, v01, v01, v10, v11);
        }
    }
    // Crown: a shallow dome fan.
    const top = vertexOffset + (rings + 1) * segs;
    const cx = f.x;
    const cz = f.z;
    out.positions.push(cx, f.base + f.height * 1.012, cz);
    out.normals.push(0, 1, 0);
    out.params.push(1.02, f.height, f.kind, f.seed % 97);
    const lastRing = vertexOffset + rings * segs;
    for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % segs;
        out.indices.push(lastRing + j, top, lastRing + j1);
    }
    return (rings + 1) * segs + 1;
}

/**
 * The far escarpment: a ribbon along an arc around the camera, crenellated into mesas.
 */
function buildEscarpment(rand, out, vertexOffset, { dist = 8200, base = -40, segs = 360 } = {}) {
    const az0 = (-72 * Math.PI) / 180;
    const az1 = (72 * Math.PI) / 180;
    const rows = 5;
    const ph = [rand() * TAU, rand() * TAU, rand() * TAU, rand() * TAU];
    const heightAt = (t) => {
        // Mesa blocks: a quantised low-frequency signal with eroded steps.
        const n = Math.sin(t * 7.1 + ph[0]) * 0.5 + Math.sin(t * 17.3 + ph[1]) * 0.3 + Math.sin(t * 41 + ph[2]) * 0.12;
        const block = Math.round(n * 3) / 3;
        const mixT = 0.7;
        const v = block * mixT + n * (1 - mixT);
        return 300 + v * 190 + Math.sin(t * 97 + ph[3]) * 12;
    };
    for (let j = 0; j <= segs; j++) {
        const t = j / segs;
        const az = az0 + (az1 - az0) * t;
        const h = Math.max(120, heightAt(t));
        const d0 = dist + Math.sin(t * 13 + ph[1]) * 600;
        for (let r = 0; r < rows; r++) {
            const s = r / (rows - 1);
            // Talus at the foot, cliff above, slightly set back toward the crown.
            const back = s < 0.3 ? (0.3 - s) * -900 : (s - 0.3) * 160;
            const dd = d0 + back;
            const x = Math.sin(az) * dd;
            const z = -Math.cos(az) * dd;
            const y = base + (s < 0.3 ? (s / 0.3) * 0.25 : 0.25 + ((s - 0.3) / 0.7) * 0.75) * (h - base);
            out.positions.push(x, y, z);
            // Facing the camera, tilted up on the talus.
            const nx = -Math.sin(az);
            const nz = Math.cos(az);
            const tilt = s < 0.3 ? 0.55 : 0.12;
            const nl = Math.hypot(nx, tilt, nz);
            out.normals.push(nx / nl, tilt / nl, nz / nl);
            out.params.push(s, h - base, 2, 41);
        }
    }
    for (let j = 0; j < segs; j++) {
        for (let r = 0; r < rows - 1; r++) {
            const a = vertexOffset + j * rows + r;
            const b = vertexOffset + (j + 1) * rows + r;
            out.indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }
    return (segs + 1) * rows;
}

/**
 * Build every formation.
 * @param {import('./shifting-sands-terrain.js').DuneField} field  (for base heights)
 * @param {object} [opts] { tier }
 */
export function buildFormations(field, { detail = 1 } = {}) {
    const rand = mulberry32(777);
    const list = [];
    const s = SENTINEL;
    const sp = groundPointAt(s.az, s.dist);
    const groundAt = (x, z) => field.sample(x, z, field.scratch).h;
    // kind: 0 = butte, 1 = spire / outcrop, 2 = escarpment
    list.push({
        kind: 0,
        x: sp.x,
        z: sp.z,
        height: s.height,
        radius: s.radius,
        rings: Math.round(170 * detail),
        segs: Math.round(128 * detail),
        profile: (t) => butteProfile(t, {
            apron: 0.36, flare: 1.25, taper: 0.07, lip: 0.035,
        }),
        footprint: makeFootprint(rand, {
            lobes: 7, amp: 0.24, elong: 0.24, elongAngle: 0.35, clefts: 4, cleftDepth: 0.2,
        }),
        flutes: 0.05,
        strata: 52,
        seed: 1201,
    });
    const spires = [
        {
            az: 38.5, dist: 1880, h: 220, r: 42,
        },
        {
            az: 23.5, dist: 3050, h: 290, r: 56,
        },
        {
            az: -41, dist: 1500, h: 74, r: 64, low: true,
        },
        {
            az: -48, dist: 2300, h: 118, r: 105, low: true,
        },
        {
            az: -15.5, dist: 3100, h: 96, r: 120, low: true,
        },
    ];
    spires.forEach((e, i) => {
        const p = groundPointAt(e.az, e.dist);
        list.push({
            kind: 1,
            x: p.x,
            z: p.z,
            height: e.h,
            radius: e.r,
            rings: Math.round((e.low ? 40 : 84) * detail),
            segs: Math.round((e.low ? 40 : 56) * detail),
            profile: e.low ? (t) => butteProfile(t, {
                apron: 0.32, flare: 0.8, taper: 0.22, lip: 0.02,
            }) : spireProfile,
            footprint: makeFootprint(rand, {
                lobes: 4, amp: e.low ? 0.28 : 0.18, clefts: e.low ? 1 : 2, cleftDepth: 0.15,
            }),
            flutes: e.low ? 0.02 : 0.05,
            strata: e.low ? 15 : 18,
            seed: 1300 + i * 17,
        });
    });

    // Seat each formation in the sand (the apron is buried a little).
    list.forEach((f) => {
        let g = Infinity;
        for (let k = 0; k < 8; k++) {
            const a = (k / 8) * TAU;
            g = Math.min(g, groundAt(f.x + Math.cos(a) * f.radius * 1.2, f.z + Math.sin(a) * f.radius * 1.2));
        }
        f.base = Math.min(g, groundAt(f.x, f.z)) - 14;
    });

    const out = {
        positions: [], normals: [], params: [], indices: [],
    };
    let offset = 0;
    list.forEach((f) => { offset += buildLathe(f, out, offset); });
    offset += buildEscarpment(rand, out, offset);

    const geometry = new THREE.BufferGeometry();
    const IndexAttr = offset > 65535 ? THREE.Uint32BufferAttribute : THREE.Uint16BufferAttribute;
    geometry.setIndex(new IndexAttr(out.indices, 1));
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(out.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(out.normals, 3));
    geometry.setAttribute('aRock', new THREE.Float32BufferAttribute(out.params, 4));
    geometry.computeBoundingSphere();

    /** Solid height for the shadow march (formations as cylinders). */
    const solids = list.map((f) => ({
        x: f.x, z: f.z, r2: (f.radius * 0.95) ** 2, top: f.base + f.height,
    }));
    const heightAt = (x, z) => {
        let h = -Infinity;
        for (let i = 0; i < solids.length; i++) {
            const o = solids[i];
            const dx = x - o.x;
            const dz = z - o.z;
            if (dx * dx + dz * dz < o.r2 && o.top > h) h = o.top;
        }
        return h;
    };
    return {
        geometry, heightAt, list, vertexCount: offset,
    };
}

/**
 * The rock material (one for every formation).
 * aRock = (s: normalised height, H: formation height, kind, seed)
 */
export function createRockMaterial(shared) {
    const {
        uSunA, uSunB, uSunLightA, uSunLightB, uUpper, uZenith, uHorizonCool, atmosphere, noiseTex,
    } = shared;
    const aRock = attribute('aRock', 'vec4');
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'shifting-sands-rock';
    material.fog = false;
    const nAttr = attribute('normal', 'vec3');

    material.colorNode = Fn(() => {
        const wp = positionWorld;
        const N = normalize(nAttr).toVar();
        const V = normalize(cameraPosition.sub(wp));
        const s = aRock.x;
        const kind = aRock.z;
        const escarp = smoothstep(1.5, 2.0, kind);

        // ── Strata: bands by height, warped by noise, slightly dipping ──
        const nw = ssTexNoise(noiseTex, vec2(wp.x.add(wp.z).mul(0.004), wp.y.mul(0.006)));
        // Formation-relative height: a darker shale base, the red cliff sandstone with thin pale
        // beds, a pale caprock.
        const band = fract(wp.y.add(nw.x.mul(5.0)).div(mix(34.0, 52.0, nw.y)));
        const red = vec3(0.52, 0.2, 0.09);
        const orange = vec3(0.64, 0.31, 0.14);
        const buff = vec3(0.76, 0.56, 0.38);
        const shale = vec3(0.36, 0.17, 0.11);
        const albedo = mix(red, orange, smoothstep(0.2, 0.6, band).mul(0.7).add(nw.z.mul(0.3))).toVar();
        const paleBed = smoothstep(0.8, 0.86, band).mul(float(1.0).sub(smoothstep(0.92, 0.97, band)));
        albedo.assign(mix(albedo, buff, paleBed.mul(0.55)));
        albedo.assign(mix(shale, albedo, smoothstep(0.3, 0.42, s)));
        const caprock = smoothstep(0.9, 0.95, s).mul(float(1.0).sub(smoothstep(1.5, 2.0, kind)));
        albedo.assign(mix(albedo, buff.mul(0.95), caprock));
        // Desert varnish: dark streaks running down the cliffs from the crown.
        const vn = ssTexNoise(noiseTex, vec2(wp.x.add(wp.z.mul(0.7)).mul(0.07), wp.y.mul(0.004)));
        const varnish = smoothstep(0.55, 0.85, vn.z).mul(smoothstep(0.25, 0.9, s)).mul(float(1.0).sub(escarp));
        albedo.assign(mix(albedo, vec3(0.16, 0.08, 0.05), varnish.mul(0.75)));
        // Sand on ledges, the crown and the apron.
        const sandy = smoothstep(0.55, 0.85, N.y).add(float(1.0).sub(smoothstep(0.06, 0.22, s)).mul(0.8));
        albedo.assign(mix(albedo, vec3(0.8, 0.45, 0.21), clamp(sandy, 0.0, 1.0)));

        // ── Light ──
        const nlA = dot(N, uSunA);
        const nlB = dot(N, uSunB);
        const direct = uSunLightA.mul(clamp(nlA.mul(1.6), 0.0, 1.0)).add(uSunLightB.mul(clamp(nlB.mul(1.5), 0.0, 1.0)));
        const ao = mix(0.55, 1.0, smoothstep(0.0, 0.35, s)).mul(mix(0.75, 1.0, vn.w));
        const skyFill = mix(uHorizonCool.mul(0.45), uUpper.mul(0.9).add(uZenith.mul(0.7)), N.y.mul(0.5).add(0.5));
        const col = albedo.mul(direct.add(skyFill.mul(ao))).toVar();
        // Backlit rim: silhouette edges facing the suns glow.
        const rim = pow(float(1.0).sub(clamp(dot(N, V), 0.0, 1.0)), 3.0)
            .mul(pow(clamp(dot(V.negate(), uSunA).mul(0.5).add(0.5), 0.0, 1.0), 3.0));
        col.addAssign(uSunLightA.mul(rim.mul(0.35)).mul(albedo.add(0.25)));
        // The escarpment is mostly silhouette: flatten its light.
        col.assign(mix(col, albedo.mul(skyFill.mul(0.8).add(uSunLightA.mul(0.06))), escarp.mul(0.6)));
        return vec4(atmosphere.applyAerial(col, wp, max(float(1.0), escarp.mul(1.15))), 1.0);
    })();

    return material;
}

export function createFormations({ field, shared, detail = 1 }) {
    const built = buildFormations(field, { detail });
    const material = createRockMaterial(shared);
    const mesh = new THREE.Mesh(built.geometry, material);
    mesh.name = 'shifting-sands-rocks';
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return {
        mesh,
        material,
        heightAt: built.heightAt,
        list: built.list,
        /** Footprints for the worm director: r = the apron on the sand, solid = the standing rock. */
        obstacles: built.list.map((f) => ({
            x: f.x, z: f.z, r: f.radius * f.profile(0) * 1.05, solid: f.radius, h: f.height,
        })),
        dispose() {
            built.geometry.dispose();
            material.dispose();
        },
    };
}
