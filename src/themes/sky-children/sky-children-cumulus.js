/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sky Children — Irisfall: the cumulus, in the world (one instanced draw).
 *
 * Every cloud is a heap of camera-facing puffs. Lighting follows the CLOUD's form first (outward
 * from its axis, domed toward its crown) and each puff's own sphere only second, so a cloud reads
 * as one billowing mass, not a stack of balls (the technique of Nimbus Veil's towers, turned for a
 * sun BEHIND the eye): the faces we see are lit full face, so the form comes from the shade under
 * every billow, the darker flat base, the luminous Deep's light thrown up under it, and at the
 * rose and pearl hours the Earth's shadow climbing the cloud until only its crown burns.
 *
 * The clouds are authored as frame anchors (placed from the solved frame, so a phone and an
 * ultrawide compose as well as the landscape): a congestus tower behind the Spring Isle on the
 * shower's bearing (its rain hangs in the dome under it), a low bank along the far right horizon
 * behind the Far Gate, and a few small cumulus in the free sky, never on the bow.
 *
 * Puffs are sorted back to front when the frame is placed (the eye only breathes, so the order
 * holds), and blended premultiplied.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, atan, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, dot, exp, float, length, max, mix,
    normalize, positionGeometry, pow, smoothstep, sqrt, texture, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { DEG, mulberry32 } from './sky-children-core.js';
import { unproject } from './sky-children-frame.js';
import {
    airColour, bowStrokes, optics, scWrap, scWrapPi, skyBase,
} from './sky-children-tsl.js';

/** Floats per puff in the instance buffer: centre + radius, tone, cloud. */
const STRIDE = 12;

/**
 * The clouds for a solved frame: [{ x, y, z (base centre), W (across), D (deep), H, kind, seed }].
 * kind 0 tower, 1 bank, 2 small.
 */
export function cumulusPlan(frame, showerBearing) {
    const { cam, horizon } = frame;
    const smile = frame.plan === 'smile';
    const dir = [0, 0, -1];
    const out = [];
    const atBearing = (bearing, dist, elevDeg, W, D, H, kind, seed) => {
        const y = Math.tan(elevDeg * DEG) * dist;
        out.push({
            x: Math.sin(bearing) * dist, y, z: -Math.cos(bearing) * dist, W, D, H, kind, seed,
        });
    };
    const bearingAt = (x, y = horizon) => {
        unproject(x, y, cam, dir);
        return Math.atan2(dir[0], -dir[2]);
    };
    // The tower: behind the Spring Isle, its rain on the bow's leg.
    atBearing(showerBearing - (smile ? 0 : 0.03), 17000, 1.6, smile ? 3400 : 5600, 2600, smile ? 3000 : 4800, 0, 11);
    // The bank along the far right horizon.
    const bank = smile ? [0.62, 0.9, 1.12] : [0.66, 0.78, 0.9, 1.0, 1.12];
    bank.forEach((x, i) => {
        const dist = 24000 + (i % 2) * 5000;
        atBearing(bearingAt(x), dist, 0.5, 2600 + (i % 3) * 900, 1800, 1100 + ((i * 7) % 3) * 450, 1, 30 + i);
    });
    // Small cumulus in the free sky (screen anchors), each kept off the bow.
    const small = smile
        ? [[0.2, 0.12, 7000], [0.8, 0.08, 8000]]
        : [[0.17, 0.16, 8000], [0.29, 0.07, 9500], [0.86, 0.3, 7500], [0.95, 0.17, 9000], [0.07, 0.3, 10000]];
    small.forEach(([x, y, dist], i) => {
        unproject(x, y, cam, dir);
        const bearing = Math.atan2(dir[0], -dir[2]);
        const elev = Math.asin(Math.max(-1, Math.min(1, dir[1]))) / DEG;
        // Off the primary by 7° at least: the bow keeps dark sky behind it.
        const theta = Math.acos(Math.max(-1, Math.min(1, dir[0] * frame.A[0] + dir[1] * frame.A[1] + dir[2] * frame.A[2])));
        if (Math.abs(theta - frame.R1) < 7 * DEG) return;
        atBearing(bearing, dist, elev, 1300 + (i % 3) * 450, 420, 480 + (i % 2) * 220, 2, 50 + i);
    });
    return out;
}

/** The puffs of one cloud (world space), appended to `puffs`. */
function cloudPuffs(c, count, puffs) {
    const rand = mulberry32(c.seed * 977 + 13);
    const len = Math.hypot(c.x, c.z);
    // Across the view and along it (the cloud is wider than it is deep, as seen).
    const ax = -c.z / len;
    const az = c.x / len;
    const dx = c.x / len;
    const dz = c.z / len;
    const add = (u, v, h, r, hf) => {
        puffs.push({
            x: c.x + ax * u + dx * v,
            y: c.y + h,
            z: c.z + az * u + dz * v,
            r,
            hf,
            seed: rand() * 100,
            ox: u / (c.W * 0.5),
            oz: v / (c.D * 0.5),
            base: c.y,
            H: c.H,
            kind: c.kind,
        });
    };
    const body = Math.max(4, Math.round(count * 0.78));
    for (let i = 0; i < body; i++) {
        const t = (i / Math.max(1, body - 1)) ** (c.kind === 1 ? 1.4 : 0.9);
        // A tower narrows as it climbs; a bank stays wide and low.
        const narrow = c.kind === 1 ? 1 - t * 0.35 : 1 - t * 0.55;
        const big = [0.19 - t * 0.08, 0.3 - t * 0.12, 0.36 - t * 0.12][c.kind];
        const r = c.H * big * (0.7 + rand() * 0.55);
        const u = (rand() - 0.5) * (c.W - r) * narrow;
        const v = (rand() - 0.5) * c.D * narrow;
        add(u, v, r * 0.55 + t * c.H * 0.8, r, t);
    }
    // The cauliflower crown: smaller heads gathered round the top.
    const crown = count - body;
    for (let i = 0; i < crown; i++) {
        const a = rand() * Math.PI * 2;
        const spread = c.W * (c.kind === 1 ? 0.3 : 0.18) * Math.sqrt(rand());
        const r = c.H * (0.08 + rand() * 0.06);
        add(Math.cos(a) * spread, Math.sin(a) * spread * 0.5, c.H * (0.8 + rand() * 0.18), r, 1);
    }
}

/**
 * @param {object} p
 * @param {object} p.tier  the quality tier (cumulusPuffs)
 * @param {object} p.U     the world's uniforms
 * @param {object} p.tex   { noise }
 */
export function createCumulus({ tier, U, tex }) {
    const capacity = tier.cumulusPuffs ?? 220;
    const base = new THREE.PlaneGeometry(2, 2);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute('position', base.getAttribute('position'));
    const data = new Float32Array(capacity * STRIDE);
    const buffer = new THREE.InstancedInterleavedBuffer(data, STRIDE);
    geometry.setAttribute('iPuff', new THREE.InterleavedBufferAttribute(buffer, 4, 0)); // xyz, radius
    geometry.setAttribute('iTone', new THREE.InterleavedBufferAttribute(buffer, 4, 4)); // heightFrac, seed, ox, oz
    geometry.setAttribute('iCloud', new THREE.InterleavedBufferAttribute(buffer, 4, 8)); // baseY, H, kind, -
    geometry.instanceCount = 0;

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        fog: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    material.name = 'sky-children-cumulus';
    const puff = attribute('iPuff', 'vec4');
    const tone = attribute('iTone', 'vec4');
    const cloud = attribute('iCloud', 'vec4');
    const vLocal = varying(vec2(0.0), 'vCuLocal');
    const vWorld = varying(vec3(0.0), 'vCuWorld');
    // The bow's strokes at each corner of a puff (the stroke loops run per vertex, as the spray's).
    const vStrokes = varying(vec4(0.0), 'vCuStrokes');
    const vThread = varying(vec3(0.0), 'vCuThread');
    const vThread2 = varying(vec3(0.0), 'vCuThread2');
    material.vertexNode = Fn(() => {
        const view = cameraViewMatrix.mul(vec4(puff.xyz, 1.0));
        const g = positionGeometry.xy;
        vLocal.assign(g);
        const at = view.xyz.add(vec3(g.mul(puff.w), 0.0));
        // The point's world position (the billboard turned back into the world).
        const world = puff.xyz.add(cameraViewMatrix.transpose().mul(vec4(g.mul(puff.w), 0.0, 0.0)).xyz).toVar();
        vWorld.assign(world);
        const thread = vec3(0.0).toVar();
        const thread2 = vec3(0.0).toVar();
        vStrokes.assign(bowStrokes(normalize(world.sub(cameraPosition)), U, thread, thread2));
        vThread.assign(thread);
        vThread2.assign(thread2);
        return cameraProjectionMatrix.mul(vec4(at, 1.0));
    })();
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.outputNode = Fn(() => {
        const { light } = U;
        const local = vLocal;
        const r2 = dot(local, local);
        const nz = sqrt(max(float(1.0).sub(r2), 0.0));
        const hf = tone.x;
        const inv = cameraViewMatrix.transpose();
        const camRight = inv.mul(vec4(1.0, 0.0, 0.0, 0.0)).xyz;
        const camUp = inv.mul(vec4(0.0, 1.0, 0.0, 0.0)).xyz;
        const camBack = inv.mul(vec4(0.0, 0.0, 1.0, 0.0)).xyz;
        // The cloud's form: outward from its axis, turning up toward the crown.
        const formN = normalize(vec3(tone.z.mul(2.2), hf.mul(1.6).sub(0.45), tone.w.mul(1.2)).add(camBack.mul(0.35)));
        const puffN = camRight.mul(local.x).add(camUp.mul(local.y)).add(camBack.mul(nz));
        const N = normalize(formN.add(puffN.mul(0.7))).toVar();
        // Lit full face by the sun behind the eye.
        const key = scWrap(dot(N, U.key), float(0.35));
        const lit = light.cloudLit.mul(U.keyGain.div(2.2).mul(0.55).add(0.5));
        // The shade is luminous (cloud scatters), lit from below by the Deep.
        const shade = mix(light.cloudShade, light.mistLit.mul(0.85), max(N.y.negate(), 0.0).mul(0.6).add(0.15));
        const col = mix(shade, lit, pow(key, 1.2)).toVar();
        // Each billow's underside lies in the shade of its own mass; the base darker still.
        col.mulAssign(float(1.0).sub(float(1.0).sub(smoothstep(-0.9, 0.2, local.y)).mul(0.2)));
        col.mulAssign(mix(float(0.74), float(1.0), smoothstep(0.0, 0.45, hf)));
        // Sky light on the tops.
        col.addAssign(skyBase(vec3(0.0, 1.0, 0.0), U).mul(max(N.y, 0.0).mul(0.12)));
        // The rose and pearl hours: the Earth's shadow climbs the cloud; only the crown burns.
        const line = cloud.x.add(cloud.y.mul(U.twilight.mul(0.7)));
        const inShadow = float(1.0).sub(smoothstep(line.sub(cloud.y.mul(0.06)), line.add(cloud.y.mul(0.06)), vWorld.y));
        col.assign(mix(col, light.earthShadow.mul(1.1).add(light.mistLit.mul(0.12)), inShadow.mul(U.twilight).mul(0.8)));
        // The air between: far clouds stand only a few shades off it.
        const rel = vWorld.sub(cameraPosition);
        const dist = length(rel);
        const V = rel.div(dist);
        // The shower's rain hangs in front of the tower: the bow is painted on it there.
        const bearing = scWrapPi(atan(V.x, V.z.negate()).sub(U.shower.x)).div(U.shower.y);
        const rain = exp(bearing.mul(bearing).mul(-1.2)).mul(U.showerAmt).mul(float(1.0).sub(cloud.z.min(1.0)))
            .mul(float(1.0).sub(smoothstep(0.35, 0.9, hf)).mul(0.6).add(0.4));
        const opt = optics(V, U, tex, {
            rain, deep: false, deepMist: float(0.0), strokes: { masks: vStrokes, thread: vThread, thread2: vThread2 },
        });
        col.assign(col.mul(float(1.0).sub(opt.w)).add(opt.xyz));
        const air = float(1.0).sub(exp(dist.div(-21000.0)));
        col.assign(mix(col, airColour(V, U), air.mul(0.85)));
        // A torn, billowing edge (each puff its own noise), and a flat base.
        const p = local.mul(0.42).add(vec2(tone.y.mul(0.137), tone.y.mul(0.071)))
            .add(vec2(U.mistClock.mul(0.0015), 0.0));
        const n = texture(tex.noise, p).g.mul(0.6).add(texture(tex.noise, p.mul(2.3).add(0.31)).a.mul(0.4));
        const edge = length(local).add(n.sub(0.5).mul(0.8));
        const flat = smoothstep(cloud.x.sub(cloud.y.mul(0.015)), cloud.x.add(cloud.y.mul(0.04)), vWorld.y);
        const alpha = float(1.0).sub(smoothstep(0.42, 0.95, edge)).mul(flat).mul(0.96);
        return vec4(col.mul(alpha), alpha);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'sky-children-cumulus';
    mesh.frustumCulled = false;
    mesh.renderOrder = 52;

    return {
        mesh,
        capacity,
        /** Lay the clouds out for a solved frame (sorted back to front from the eye). */
        place(frame, showerBearing) {
            const clouds = cumulusPlan(frame, showerBearing);
            // Puffs shared by size: the tower takes the most.
            const weight = clouds.map((c) => c.W * c.H * (c.kind === 0 ? 1.6 : 1));
            const total = weight.reduce((a, b) => a + b, 0) || 1;
            const puffs = [];
            clouds.forEach((c, i) => cloudPuffs(c, Math.max(c.kind === 2 ? 12 : 8, Math.floor((capacity * weight[i]) / total)), puffs));
            puffs.sort((a, b) => Math.hypot(b.x, b.y, b.z) - Math.hypot(a.x, a.y, a.z));
            const n = Math.min(capacity, puffs.length);
            for (let i = 0; i < n; i++) {
                const q = puffs[i];
                data.set([q.x, q.y, q.z, q.r, q.hf, q.seed, q.ox, q.oz, q.base, q.H, q.kind, 0], i * STRIDE);
            }
            geometry.instanceCount = n;
            buffer.needsUpdate = true;
            return n;
        },
        dispose() {
            base.dispose();
            geometry.dispose();
            material.dispose();
        },
    };
}
