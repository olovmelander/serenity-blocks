/**
 * Thermal Bloom — the geysers (iris-springs.md §1.2, §1.4, §3.6.2): the Chalice's sinter cone on
 * its hill, the eruption columns, their spray veils and the spray particles.
 *
 * The Chalice: one lathe — a broad sinter hill the Stair steps down from, a low mound, then the
 * cone with its lip and vent — cream at the lip, crusted with spicules (a fine relief in the
 * albedo and a raked bump), stained apricot and grey where runoff and age have marked it.
 *
 * The columns: one open lathe per eruption slot (the Chalice, the Consort, the Sleeper, the
 * spouters), drawn in one call; each reads its slot's two rows of the event table, which the
 * world writes from the closed-form schedules (x, z, base, height) and (radius, age, flare, kind).
 * The shape widens with height and flares at the crown where the water slows (r ∝ 1/√v), its
 * silhouette jittered ±15%; the density streaks upward with the water, a dense white core (the
 * thickness term from view·normal) inside a translucent rim; lit like the steam — Steam Pearl on
 * the lit side, blue-grey in shade — never emissive. A spray veil (the same lathe at 1.6× the
 * radius, thin and scrolling) carries the spray haze round every column. Dormant slots fold away.
 *
 * The spray: one pool of quads on closed-form ballistic paths from the live columns' vents
 * (p0 + v0·t + ½g·t²), killed at landing, floored at about a pixel.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    attribute,
    clamp,
    cos,
    dot,
    float,
    floor,
    fract,
    fwidth,
    int,
    length,
    max,
    mix,
    normalize,
    normalWorld,
    positionGeometry,
    positionLocal,
    positionWorld,
    sin,
    smoothstep,
    sqrt,
    step,
    texture,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CHALICE,
    EVENT_ROWS,
    EVENT_SLOTS,
    tbAerial,
    tbBounce,
    tbFxMaterial,
    tbHash21,
    tbHgMix,
    tbPart,
    tbSteamVeil,
} from './thermal-bloom-tsl.js';

const TAU = Math.PI * 2;
/** Gravity (m/s²) for the spray. */
const G = 9.81;
/** The Chalice's hill and cone, as (radius, height above the vent's base) from the hill's foot up. */
const CHALICE_PROFILE = Object.freeze([
    [50, -15], [42, -11.5], [34, -7.2], [27, -3.6], [20, -1.0], [13, 0.8], [9.5, 1.5],
    [CHALICE.radius + 0.6, 1.8], [6.6, 3.8], [5.6, 5.9], [4.4, 7.4], [3.0, CHALICE.height - 0.3],
    [2.2, CHALICE.height], [1.35, CHALICE.height - 0.4], [0.8, CHALICE.height - 3],
]);
/**
 * The Sleeper's broad dormant mound (§3.12): a low shield of old sinter round a shallow crater,
 * (radius, height above its crater's lip) from the foot up; its foot sinks into the far ground.
 */
const SLEEPER_PROFILE = Object.freeze([
    [95, -22], [80, -15], [64, -8.5], [48, -3.6], [32, -0.6], [18, 0.6], [9, 0.8], [6.5, 0.5],
    [4.6, -0.5], [2.8, -1.4], [0.01, -1.6],
]);
/** The Consort's low mound round its small pool (§3.5); the pool is the flat top inside 3.2 m. */
const CONSORT_PROFILE = Object.freeze([
    [17, -3], [13, -1.5], [9, -0.4], [5.5, 0.15], [3.6, 0.32], [3.2, 0.12], [0.01, 0.12],
]);
/** The Consort's pool radius (metres). */
const CONSORT_POOL = 3.2;

/** Column kinds (the slot's row 1, w). */
export const COLUMN_KIND = Object.freeze({ water: 0, spouter: 1 });

/**
 * A lathe of `profile` [(r, y)…] with `segments` round it, its outline made lumpy (a sinter mound
 * is never a turned bowl): the radius and height wander with the angle, more on the skirts.
 */
function lathe(profile, segments) {
    const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
    const geometry = new THREE.LatheGeometry(pts, segments);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const r = Math.hypot(x, z);
        if (r < 1e-3) continue;
        const a = Math.atan2(z, x);
        const skirt = Math.min(1, Math.max(0, (r - 6) / 30));
        const wobble = 0.1 * Math.sin(3 * a + 0.7) + 0.07 * Math.sin(5 * a + 2.1 + r * 0.05)
            + 0.04 * Math.sin(11 * a + r * 0.2);
        const k = 1 + wobble * skirt;
        pos.setXYZ(i, x * k, pos.getY(i) + wobble * 6 * skirt * (1 - skirt), z * k);
    }
    geometry.computeVertexNormals();
    return geometry;
}

/**
 * The Chalice: its hill, mound and cone, standing on its vent's base (world y of the base).
 * @param {object} u    the shared uniforms
 * @param {object} tier the quality tier
 * @param {object} tex  the world's baked textures
 */
export function createChalice(u, tier, tex) {
    const geometry = lathe(CHALICE_PROFILE, tier.columnMesh[0] * 4);
    const chaliceFn = Fn(() => {
        const P = positionWorld.toVar();
        const toCam = u.camPos.sub(P);
        const dist = length(toCam).toVar();
        const V = toCam.div(max(dist, 1e-3)).toVar();
        const rel = P.sub(u.chalice).toVar();
        const r = length(rel.xz).toVar();
        const h = rel.y;
        const az = atan(rel.x, rel.z);
        // Sinter: cream at the cone and its lip, old grey on the hill's skirts, stained apricot
        // and brown down the fall lines of the runoff (streaks by angle, long downhill).
        const fresh = smoothstep(14.0, 5.0, r);
        const streak = texture(tex.noise, vec2(az.mul(1.6), r.div(90.0))).x;
        const stain = smoothstep(0.62, 0.78, streak).mul(smoothstep(4.0, 16.0, r))
            .mul(float(1.0).sub(smoothstep(24.0, 40.0, r)));
        const old = mix(vec3(0.5, 0.47, 0.41), vec3(0.62, 0.59, 0.52), texture(tex.noise, P.xz.div(60.0)).y);
        const cream = vec3(0.86, 0.83, 0.74);
        const runoff = mix(vec3(0.7, 0.4, 0.2), vec3(0.42, 0.24, 0.13), streak);
        const albedo = mix(mix(old, cream, fresh), runoff, stain.mul(0.45)).toVar();
        // Crags on the cone: castle-like knobs and ledges of old grey sinter between fresh crusts.
        const crag = texture(tex.noise, vec2(az.mul(3.2), h.div(4.5))).x;
        const cone = smoothstep(CHALICE.radius + 1.0, CHALICE.radius - 1.0, r);
        albedo.assign(mix(albedo, albedo.mul(vec3(0.72, 0.7, 0.66)), smoothstep(0.45, 0.7, crag).mul(cone).mul(0.8)));
        // The hill's skirts settle into the apron's own colour, so its foot never shows an edge.
        albedo.assign(mix(albedo, vec3(0.52, 0.5, 0.45), smoothstep(26.0, 44.0, r)));
        // Old sinter is never one flat tone: blotches of paler crust and grey-brown weathering.
        const mottA = texture(tex.noise, P.xz.div(26.0)).z;
        const mottB = texture(tex.noise, P.xz.div(9.0)).w;
        const mott = mottA.mul(0.6).add(mottB.mul(0.4));
        const hill = smoothstep(CHALICE.radius + 1.0, CHALICE.radius + 4.0, r);
        albedo.mulAssign(float(1.0).add(mott.sub(0.5).mul(0.42).mul(hill)));
        // Sinter terracettes: low concentric ledges wandering round the mound, a pale lip with a
        // shadowed step below it, fading to their mean under a pixel.
        const ringN = texture(tex.noise, P.xz.div(38.0)).x;
        const ringU = r.div(2.6).add(ringN.mul(1.4)).toVar();
        const ringPx = max(fwidth(ringU), 1e-4);
        const ringF = fract(ringU);
        const shadowBand = smoothstep(0.06, ringPx.add(0.14), ringF).mul(smoothstep(ringPx.add(0.4), 0.2, ringF));
        const step01 = smoothstep(ringPx.add(0.08), 0.0, ringF).sub(shadowBand.mul(0.5));
        const ledge = step01.mul(float(1.0).sub(smoothstep(0.15, 0.5, ringPx))).mul(hill)
            .mul(smoothstep(46.0, 30.0, r));
        albedo.mulAssign(float(1.0).add(ledge.mul(0.15)));
        // The seasons: rime on the old crust in First Frost; in Deep Cold snow lies on the cold
        // skirts in drifts, never on the warm cone and its splash zone.
        const drift = smoothstep(0.35, 0.65, mottA.add(ringN.sub(0.5).mul(0.4)));
        const coldGround = smoothstep(11.0, 18.0, r).mul(hill);
        albedo.assign(mix(albedo, vec3(0.8, 0.82, 0.84), u.frost.mul(coldGround).mul(drift).mul(0.35)));
        albedo.assign(mix(albedo, vec3(0.78, 0.81, 0.86), u.snow.mul(coldGround).mul(drift.mul(0.5).add(0.45))));
        // Spicules: a knobbly crust on the cone and its splash zone (fades by the pixel's size).
        const spic = texture(tex.noise, vec2(az.mul(24.0), h.div(1.4))).w;
        const foot = dist.mul(u.pixelAngle);
        albedo.mulAssign(float(1.0).add(spic.sub(0.5).mul(0.35).mul(smoothstep(12.0, 3.0, r))
            .mul(float(1.0).sub(smoothstep(0.08, 0.4, foot)))));
        // Wet near the vent: darker, faintly glossy.
        const wet = smoothstep(3.2, 1.6, r).mul(step(CHALICE.height - 1.0, h));
        albedo.mulAssign(float(1.0).sub(wet.mul(0.3)));
        // The vent's throat is dark.
        albedo.mulAssign(float(1.0).sub(smoothstep(1.6, 0.9, r).mul(0.75)));
        // The lathe's own normals (its lumps included) carry the mound's form; the cone's crags
        // tilt them further, and the hill's knobs roughen them a little.
        const radial = vec3(rel.x, 0.0, rel.z).div(max(r, 1e-3));
        const rough = mott.sub(0.5).mul(0.5).mul(hill).add(crag.sub(0.5).mul(cone).mul(1.2));
        const N = normalize(normalize(normalWorld).add(radial.mul(rough))).toVar();
        const lit = clamp(dot(N, u.sunDir).add(0.12).div(1.12), 0.0, 1.0);
        const sky = mix(u.haze, u.zenith, 0.6).mul(N.y.mul(0.2).add(0.25)).add(tbBounce(u, N));
        const col = albedo.mul(u.sunColor.mul(lit.mul(1.05)).add(sky));
        const out = tbAerial(u, tbSteamVeil(u, col, P), dist, V.negate());
        return vec4(max(out, vec3(0.0)), 1.0);
    });
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: true, depthWrite: true });
    material.name = 'ThermalBloomChalice';
    material.fog = false;
    material.colorNode = chaliceFn();
    const part = tbPart('ThermalBloomChalice', geometry, material, 9);
    part.place = (x, y, z) => {
        part.mesh.position.set(x, y, z);
        part.mesh.updateMatrix();
        part.mesh.updateMatrixWorld(true);
    };
    return part;
}

/**
 * A dormant sinter mound (the Sleeper's, the Consort's): one lumpy lathe of old grey-brown
 * sinter, blotched and weathered, paler toward its top, settling into the apron's colour at its
 * foot; a dark crater (`crater` m) or a small still pool (`pool` m) at its top.
 */
function createMound(u, tier, tex, {
    name, profile, crater = 0, pool = 0, order = 9,
}) {
    const geometry = lathe(profile, tier.columnMesh[0] * 3);
    const outer = profile[0][0];
    const moundFn = Fn(() => {
        const P = positionWorld.toVar();
        const toCam = u.camPos.sub(P);
        const dist = length(toCam).toVar();
        const V = toCam.div(max(dist, 1e-3)).toVar();
        const rel = positionLocal;
        const r = length(rel.xz).toVar();
        const mottA = texture(tex.noise, P.xz.div(30.0)).z;
        const mottB = texture(tex.noise, P.xz.div(11.0)).w;
        const mott = mottA.mul(0.6).add(mottB.mul(0.4)).toVar();
        const top = smoothstep(outer * 0.5, outer * 0.12, r);
        const albedo = mix(vec3(0.48, 0.45, 0.4), vec3(0.66, 0.63, 0.56), top.mul(0.6).add(mott.mul(0.4))).toVar();
        albedo.mulAssign(float(1.0).add(mott.sub(0.5).mul(0.4)));
        albedo.assign(mix(albedo, vec3(0.52, 0.5, 0.45), smoothstep(outer * 0.55, outer * 0.9, r)));
        if (crater > 0) albedo.mulAssign(float(1.0).sub(smoothstep(crater, crater * 0.45, r).mul(0.55)));
        // Snow in Deep Cold (patchy), rime in First Frost; a warm pool keeps its own rim clear.
        const warmRim = pool > 0 ? smoothstep(pool + 1.5, pool + 4.0, r) : float(1.0);
        const patches = smoothstep(0.3, 0.6, mott);
        albedo.assign(mix(albedo, vec3(0.8, 0.82, 0.84), u.frost.mul(patches).mul(warmRim).mul(0.3)));
        albedo.assign(mix(albedo, vec3(0.78, 0.81, 0.86), u.snow.mul(warmRim).mul(patches.mul(0.4).add(0.5))));
        const radial = vec3(rel.x, 0.0, rel.z).div(max(r, 1e-3));
        const N = normalize(normalize(normalWorld).add(radial.mul(mott.sub(0.5).mul(0.4)))).toVar();
        const lit = clamp(dot(N, u.sunDir).add(0.12).div(1.12), 0.0, 1.0);
        const sky = mix(u.haze, u.zenith, 0.6).mul(N.y.mul(0.2).add(0.25));
        const col = albedo.mul(u.sunColor.mul(lit.mul(1.05)).add(sky)).toVar();
        if (pool > 0) {
            // A small still pool, milky turquoise, a wet cream rim round it.
            const pfw = max(fwidth(r), 1e-3);
            const inside = smoothstep(pfw.add(pool), float(pool).sub(pfw), r);
            const rim = smoothstep(pool + 1.2, pool, r).mul(float(1.0).sub(inside));
            col.assign(mix(col, vec3(0.86, 0.83, 0.74).mul(u.sunColor.mul(lit).add(sky)), rim.mul(0.6)));
            const water = vec3(0.12, 0.42, 0.48).mul(u.sunColor.mul(0.7).add(u.zenith.mul(0.3)));
            col.assign(mix(col, water, inside));
        }
        const out = tbAerial(u, tbSteamVeil(u, col, P), dist, V.negate());
        return vec4(max(out, vec3(0.0)), 1.0);
    });
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: true, depthWrite: true });
    material.name = name;
    material.fog = false;
    material.colorNode = moundFn();
    const part = tbPart(name, geometry, material, order);
    part.place = (x, y, z) => {
        part.mesh.position.set(x, y, z);
        part.mesh.updateMatrix();
        part.mesh.updateMatrixWorld(true);
    };
    return part;
}

/** The Sleeper's dormant mound on the far rim. */
export function createSleeper(u, tier, tex) {
    return createMound(u, tier, tex, { name: 'ThermalBloomSleeper', profile: SLEEPER_PROFILE, crater: 6 });
}

/** The Consort's quiet mound and its small pool on the far apron. */
export function createConsort(u, tier, tex) {
    return createMound(u, tier, tex, { name: 'ThermalBloomConsort', profile: CONSORT_PROFILE, pool: CONSORT_POOL });
}

/**
 * The eruption columns and their spray veils: `EVENT_SLOTS.eruptions` lathes in one geometry
 * (twice: the column, then the veil at 1.6× the radius).
 */
export function createColumns(u, tier, tex) {
    const [segs, rings] = tier.columnMesh;
    const slots = EVENT_SLOTS.eruptions;
    const positions = [];
    const meta = [];
    const index = [];
    for (let layer = 0; layer < 2; layer++) {
        for (let s = 0; s < slots; s++) {
            const first = positions.length / 3;
            for (let j = 0; j <= rings; j++) {
                for (let i = 0; i <= segs; i++) {
                    positions.push(i / segs, j / rings, 0);
                    meta.push(s, layer);
                }
            }
            for (let j = 0; j < rings; j++) {
                for (let i = 0; i < segs; i++) {
                    const a = first + j * (segs + 1) + i;
                    const b = a + segs + 1;
                    index.push(a, b, a + 1, a + 1, b, b + 1);
                }
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aColumn', new THREE.Float32BufferAttribute(meta, 2));
    geometry.setIndex(index);

    const aColumn = attribute('aColumn', 'vec2');
    const vSlot = varying(aColumn.x, 'vColumnSlot');
    const vVeil = varying(aColumn.y, 'vColumnVeil');
    const vTheta = varying(positionGeometry.x, 'vColumnTheta');
    const vH = varying(positionGeometry.y, 'vColumnH');
    const rowA = (slot) => u.events.element(int(slot.add(0.5)).mul(2).add(EVENT_ROWS.eruptions));
    const rowB = (slot) => u.events.element(int(slot.add(0.5)).mul(2).add(EVENT_ROWS.eruptions + 1));
    /** The column's radius at a fraction of its height: widening, flaring at the crown, jittered. */
    const radiusAt = (B, A, h01, theta, t) => {
        const jitter = sin(theta.mul(TAU * 3.0).add(h01.mul(9.0)).sub(t.mul(4.0))).mul(0.08)
            .add(sin(theta.mul(TAU * 7.0).sub(h01.mul(13.0)).add(t.mul(6.0))).mul(0.07));
        const crown = smoothstep(0.6, 1.0, h01).mul(B.z);
        return B.x.mul(float(1.0).add(h01.mul(0.9)).add(crown.mul(1.6))).mul(float(1.0).add(jitter));
    };

    // Front faces only: the core's thickness term already stands for the column's depth (drawing
    // the far wall too doubled the alpha along every ring's edge).
    const material = tbFxMaterial('ThermalBloomColumns', { side: THREE.FrontSide });
    material.positionNode = Fn(() => {
        const slot = aColumn.x;
        const A = rowA(slot);
        const B = rowB(slot);
        const live = step(0.05, A.w);
        const theta = positionGeometry.x;
        const h01 = positionGeometry.y;
        const veil = aColumn.y;
        const r = radiusAt(B, A, h01, theta, u.time).mul(mix(float(1.0), float(1.6), veil));
        const ang = theta.mul(TAU);
        const p = vec3(
            A.x.add(cos(ang).mul(r)),
            A.z.add(h01.mul(A.w).mul(mix(float(1.0), float(1.08), veil))),
            A.y.add(sin(ang).mul(r)),
        );
        return mix(vec3(0.0, -1e5, 0.0), p, live);
    })();
    const columnFn = Fn(() => {
        const A = rowA(vSlot);
        const P = positionWorld.toVar();
        const toCam = u.camPos.sub(P);
        const dist = length(toCam).toVar();
        const V = toCam.div(max(dist, 1e-3)).toVar();
        const h01 = clamp(vH, 0.0, 1.0);
        const t = u.time;
        // Streaks running up with the water: noise stretched along the column, scrolled upward.
        const speed = sqrt(max(A.w, 1.0).mul(2.0 * G)).mul(0.5);
        const sv = vec2(vTheta.mul(4.0), P.y.sub(t.mul(speed)).div(12.0));
        const streak = texture(tex.noise, sv.div(4.0)).x;
        // The core is thick (looking through the middle), the rim translucent.
        const n = normalize(vec3(P.x.sub(A.x), 0.0, P.z.sub(A.y)));
        const facing = abs(dot(n, vec3(V.x, 0.0, V.z)).div(max(length(V.xz), 1e-3)));
        const core = mix(facing.mul(facing), facing, 0.4);
        // The top frays into spray; the base is fed from the vent.
        const top = float(1.0).sub(smoothstep(0.82, 1.0, h01));
        const isVeil = vVeil;
        const water = core.mul(0.5).add(0.5).mul(smoothstep(0.2, 0.7, streak).mul(0.45).add(0.55)).mul(top);
        const haze = smoothstep(0.35, 0.8, streak).mul(top).mul(smoothstep(0.05, 0.3, h01)).mul(0.3);
        const alpha = clamp(mix(water, haze, isVeil), 0.0, 1.0).mul(smoothstep(0.0, 0.03, A.w.div(40.0)).max(0.0))
            .toVar();
        // Light: Steam Pearl on the lit side, blue-grey in shade; a little backscatter.
        const lit = clamp(dot(n, u.sunDir).add(0.4).div(1.4), 0.0, 1.0);
        const back = tbHgMix(dot(V, u.sunDir), float(0.3));
        const col = u.sunColor.mul(lit.mul(0.9).add(0.2)).mul(float(0.85).add(back.mul(0.3)))
            .add(mix(u.haze, u.zenith, 0.6).mul(0.35));
        const out = tbAerial(u, col, dist, V.negate());
        return vec4(out.mul(alpha), alpha);
    });
    material.colorNode = columnFn();
    const part = tbPart('ThermalBloomColumns', geometry, material, 62);
    part.slots = slots;
    return part;
}

/**
 * The spray: `tier.spray` quads on ballistic paths from the live columns' vents, each on its own
 * hashed cycle, killed at landing.
 */
export function createSpray(u, tier) {
    const count = tier.spray;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const positions = new Float32Array(count * 4 * 3);
    const seeds = new Float32Array(count * 4 * 2);
    const index = new Uint32Array(count * 6);
    for (let i = 0; i < count; i++) {
        corners.forEach(([x, y], c) => {
            positions.set([x, y, 0], (i * 4 + c) * 3);
            seeds.set([i, (i * 0.618034) % 1], (i * 4 + c) * 2);
        });
        index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSpray', new THREE.BufferAttribute(seeds, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    const aSpray = attribute('aSpray', 'vec2');
    const vCorner = varying(positionGeometry.xy, 'vSprayCorner');
    const slots = EVENT_SLOTS.eruptions;
    // Each drop's cycle: launched up its column to about the column's height, then out and down.
    const id = aSpray.x;
    const slot = id.mod(slots);
    const A = u.events.element(int(slot).mul(2).add(EVENT_ROWS.eruptions));
    const B = u.events.element(int(slot).mul(2).add(EVENT_ROWS.eruptions + 1));
    const h1 = tbHash21(vec2(id, 1.7));
    const h2 = tbHash21(vec2(id, 5.3));
    const h3 = tbHash21(vec2(id, 9.1));
    const vUp = sqrt(max(A.w, 0.0).mul(2.0 * G)).mul(h1.mul(0.35).add(0.7));
    const period = max(vUp.mul(2.0 / G).add(0.4), 0.6);
    const age = fract(u.time.div(period).add(aSpray.y)).mul(period);
    // Most drops fall close round the column (a mist hugging it); a few fly wide.
    const reach = h2.mul(h2).mul(2.6).add(0.4).add(B.x.mul(0.35));
    const ang = h3.mul(TAU);
    const drop = vec3(
        A.x.add(cos(ang).mul(reach).mul(age)),
        A.z.add(vUp.mul(age)).sub(age.mul(age).mul(0.5 * G)),
        A.y.add(sin(ang).mul(reach).mul(age)),
    );
    const alive = step(A.z, drop.y).mul(step(0.5, A.w)).mul(step(slot.add(0.5), float(u.eruptionCount)));
    // Drops thin as they fall (they evaporate and spread into the veil): a haze, never snow.
    const vSprayId = varying(id, 'vSprayId');
    const vLife = varying(alive.mul(float(1.0).sub(smoothstep(0.45, 1.0, age.div(period)))), 'vSprayLife');

    const material = tbFxMaterial('ThermalBloomSpray');
    material.positionNode = Fn(() => {
        // Camera-facing, at least about a pixel across.
        const toCam = u.camPos.sub(drop);
        const d = length(toCam);
        const right = normalize(vec3(toCam.z.negate(), 0.0, toCam.x));
        const size = max(float(0.06).add(h2.mul(0.08)), d.mul(u.pixelAngle).mul(0.65));
        const corner = right.mul(positionGeometry.x).add(vec3(0.0, 1.0, 0.0).mul(positionGeometry.y)).mul(size);
        return mix(vec3(0.0, -1e5, 0.0), drop.add(corner), alive);
    })();
    const sprayFn = Fn(() => {
        const r = length(vCorner);
        // A few drops at a time send the sun back to the eye (it stands behind us): glints.
        const flash = step(0.93, tbHash21(vec2(vSprayId, floor(u.time.mul(5.0)))));
        const a = smoothstep(1.0, 0.2, r).mul(vLife).mul(float(0.3).add(flash.mul(0.5)));
        const col = u.sunColor.mul(float(0.95).add(flash.mul(5.0))).add(mix(u.haze, u.zenith, 0.5).mul(0.25));
        return vec4(col.mul(a), a);
    });
    material.colorNode = sprayFn();
    return tbPart('ThermalBloomSpray', geometry, material, 63);
}

/** The geysers' rows from a world's schedules (written by the world each frame). */
export const COLUMN_SLOT = Object.freeze({
    chalice: 0, consort: 1, sleeper: 2, spouter0: 3,
});
