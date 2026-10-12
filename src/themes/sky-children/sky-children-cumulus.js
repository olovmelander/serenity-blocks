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
 * shower's bearing, the storm's sunlit crown over its dark body (the storm wall and its rain hang
 * in the dome behind and under it), and a couple of small fair-weather cumulus in the free sky,
 * never on the bow. (The far banks along the horizon are the dome's: hazed, they need no puffs.)
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
    airColour, bowStrokes, cloudLight, optics, scWrap, scWrapPi, skyBase,
} from './sky-children-tsl.js';

/** Floats per puff in the instance buffer: centre + radius, tone, cloud. */
const STRIDE = 12;

/**
 * The clouds for a solved frame: [{ x, y, z (base centre), W (across), D (deep), H, kind, seed }].
 * kind 0 tower, 1 bank, 2 small.
 */
export function cumulusPlan(frame, showerBearing) {
    const { cam } = frame;
    const smile = frame.plan === 'smile';
    const dir = [0, 0, -1];
    const out = [];
    const atBearing = (bearing, dist, elevDeg, W, D, H, kind, seed) => {
        const y = Math.tan(elevDeg * DEG) * dist;
        out.push({
            x: Math.sin(bearing) * dist, y, z: -Math.cos(bearing) * dist, W, D, H, kind, seed,
        });
    };
    // The tower: the storm's crown, its flat base on the storm wall's (the dome's shower base),
    // so the wall's rain hangs under both.
    atBearing(showerBearing - (smile ? 0 : 0.03), 17000, smile ? 2.6 : 3.3, smile ? 3400 : 4200, 2600, smile ? 3000 : 5600, 0, 11);
    // Small cumulus in the free sky (screen anchors), each kept off the bow.
    const small = smile
        ? [[0.2, 0.12, 7000], [0.8, 0.08, 8000]]
        : [];
    small.forEach(([x, y, dist], i) => {
        unproject(x, y, cam, dir);
        const bearing = Math.atan2(dir[0], -dir[2]);
        const elev = Math.asin(Math.max(-1, Math.min(1, dir[1]))) / DEG;
        // Off the primary by 7° at least: the bow keeps dark sky behind it.
        const theta = Math.acos(Math.max(-1, Math.min(1, dir[0] * frame.A[0] + dir[1] * frame.A[1] + dir[2] * frame.A[2])));
        if (Math.abs(theta - frame.R1) < 7 * DEG) return;
        atBearing(bearing, dist, elev, [1700, 1200][i % 2], 700, [640, 460][i % 2], 2, 50 + i);
    });
    return out;
}

/**
 * The puffs of one cloud (world space), appended to `puffs`. A cloud is drawn as its outline:
 * heads along its edge (big at the foot, smaller and more crowded up toward the crown, so the top
 * is cauliflower), a row along the flat base, and a few large ones behind to fill it. A tower
 * stands on steep sides that narrow as it climbs; a bank or a small cumulus is a low dome.
 */
function cloudPuffs(c, count, puffs) {
    const rand = mulberry32(c.seed * 977 + 13);
    const len = Math.hypot(c.x, c.z);
    // Across the view and along it (the cloud is wider than it is deep, as seen).
    const ax = -c.z / len;
    const az = c.x / len;
    const dx = c.x / len;
    const dz = c.z / len;
    const tower = c.kind === 0;
    const add = (u, v, h, r) => {
        const hf = Math.max(0, Math.min(1, h / c.H));
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
    // The outline: half-width at a height (a tower narrows and rounds over at the crown).
    const halfW = c.W * 0.5;
    const edge = (phi) => {
        // phi from -pi/2 (left foot) over the top (0) to +pi/2 (right foot)
        const t = Math.cos(phi) ** [0.28, 0.45, 0.7][c.kind];
        const w = Math.sin(phi) * halfW * (tower ? 1 - 0.42 * t : 1);
        return [w, t * c.H];
    };
    // A tower's crown is a few turrets at their own heights, the tallest a little off centre.
    const turrets = tower ? [[-0.34, 0.8, 0.36], [0.04, 1.0, 0.42], [0.38, 0.7, 0.3]] : [];
    const crownAt = (w) => turrets.reduce((top, [cx, ht, rw]) => {
        const d = (w / halfW - cx) / rw;
        return Math.max(top, d * d < 1 ? ht * c.H * (0.62 + 0.38 * Math.sqrt(1 - d * d)) : 0);
    }, 0);
    // A tower keeps its outline to a few dozen big heads (more would melt into one smooth edge)
    // and spends the rest on its face: heads standing out of it, each its own billow.
    const nBase = Math.max(2, Math.round(count * (tower ? 0.08 : 0.2)));
    const nEdge = tower ? Math.min(46, Math.max(16, Math.round(count * 0.24))) : Math.max(3, Math.round(count * 0.6));
    const nFace = tower ? Math.round(count * 0.34) : 0;
    const nFill = Math.max(1, count - nBase - nEdge - nFace);
    const size = (t) => c.H * (tower ? 0.2 - 0.09 * t : 0.5 - 0.16 * t);
    // Behind first (they are drawn first anyway: the sort is by distance), filling the body up
    // into the crown.
    for (let i = 0; i < nFill; i++) {
        const t = 0.15 + 0.8 * rand();
        const r = size(t) * (1.15 + rand() * 0.4);
        const w = (rand() - 0.5) * 1.1 * halfW * (1 - (tower ? 0.5 : 0.4) * t);
        add(w, c.D * (0.1 + rand() * 0.3), Math.max(r * 0.5, t * c.H * 0.86), r);
    }
    // The face: billows standing out of the tower's front, smaller up toward the crown.
    for (let i = 0; i < nFace; i++) {
        const t = Math.min(0.95, 0.08 + 0.92 * Math.sqrt(rand()));
        const span = halfW * (1 - 0.42 * t) * 0.8;
        const w = (rand() * 2 - 1) * span;
        const top = Math.min(c.H * t, crownAt(w) * 0.94);
        const r = size(top / c.H) * (0.7 + rand() * 0.5);
        add(w, -c.D * (0.2 + rand() * 0.25), Math.max(r * 0.5, top - r * 0.3), r);
    }
    // The flat base: a row of heads whose bottoms the shader cuts flat.
    for (let i = 0; i < nBase; i++) {
        const f = nBase > 1 ? i / (nBase - 1) : 0.5;
        const r = size(0) * (0.85 + rand() * 0.3);
        add((f - 0.5) * 2 * (halfW - r * 0.6), (rand() - 0.5) * c.D * 0.4, r * 0.55, r);
    }
    // The edge, the crown's heads crowding in smaller.
    for (let i = 0; i < nEdge; i++) {
        const s = (i + 0.5 + (rand() - 0.5) * 0.6) / nEdge;
        const phi = (s - 0.5) * Math.PI;
        const [w, h0] = edge(phi);
        // The tower's top follows its turrets.
        const h = tower && h0 > c.H * 0.6 ? Math.max(c.H * 0.6, Math.min(h0, crownAt(w))) : h0;
        const t = h / c.H;
        const r = size(t) * (tower ? 0.95 + rand() * 0.5 : 0.65 + rand() * 0.7);
        // In from the outline by most of a radius, so the heads' rims make the edge; the crown's
        // heads stand at their own heights (turrets), the sides' bulge out and in.
        const cx = 0;
        const cy = c.H * 0.42;
        const nx = cx - w;
        const ny = cy - h;
        const k = 1 / Math.max(1e-3, Math.hypot(nx, ny));
        const turret = t > 0.8 ? (rand() - 0.35) * r * (tower ? 0.9 : 0.5) : (rand() - 0.5) * r * 0.2;
        add(w + nx * k * r * 0.62, (rand() - 0.6) * c.D * 0.35, Math.max(r * 0.5, h + ny * k * r * 0.62 + turret), r);
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
        // The tower is the storm's crown; the others are fair-weather cumulus.
        const tower = max(float(1.0).sub(cloud.z), 0.0);
        // The cloud's form: outward from its axis, turning up toward the crown.
        const formN = normalize(vec3(tone.z.mul(2.2), hf.mul(1.6).sub(0.45), tone.w.mul(1.2)).add(camBack.mul(0.35)));
        const puffN = camRight.mul(local.x).add(camUp.mul(local.y)).add(camBack.mul(nz));
        const N = normalize(formN.add(puffN.mul(1.1))).toVar();
        // Lit full face by the sun behind the eye; each billow's underside in its own mass's
        // shade, the foot darker still, sky light on the tops.
        const lit = pow(scWrap(dot(N, U.key), float(0.35)), 1.2)
            .mul(float(1.0).sub(float(1.0).sub(smoothstep(-0.9, 0.3, local.y)).mul(0.4)))
            .mul(mix(float(0.6), float(1.0), smoothstep(0.0, 0.5, hf)));
        // The rose and pearl hours: the Earth's shadow climbs the cloud; only the crown burns.
        const line = cloud.x.add(cloud.y.mul(U.twilight.mul(0.7)));
        const inShadow = float(1.0).sub(smoothstep(line.sub(cloud.y.mul(0.06)), line.add(cloud.y.mul(0.06)), vWorld.y));
        const col = cloudLight(U, lit, max(N.y.negate(), 0.0).mul(0.8).add(0.1), inShadow, { gain: 0.5 }).toVar();
        col.addAssign(skyBase(vec3(0.0, 1.0, 0.0), U).mul(max(N.y, 0.0).mul(0.1)));
        // The tower's lower body is the storm itself: dark slate in its own rain and shade, the
        // billows still showing; only the crown stands in the sun.
        // (By the point's own height, so the dark climbs the tower smoothly across the puffs.)
        const rise = vWorld.y.sub(cloud.x).div(cloud.y);
        const storm = float(1.0).sub(smoothstep(0.26, 0.6, rise)).mul(tower).mul(smoothstep(0.15, 0.55, U.showerAmt));
        // Each billow of the storm's body shows by its lighter brow over a darker underside.
        const brow = smoothstep(-0.7, 0.75, local.y).mul(lit);
        const slate = light.shower.mul(mix(float(0.5), float(1.4), brow)).add(light.mistLit.mul(max(N.y.negate(), 0.0).mul(0.03)));
        col.assign(mix(col, slate, storm));
        // The air between: far clouds stand only a few shades off it.
        const rel = vWorld.sub(cameraPosition);
        const dist = length(rel);
        const V = rel.div(dist);
        // The shower's rain hangs in front of the tower: the bow is painted on it there.
        const bearing = scWrapPi(atan(V.x, V.z.negate()).sub(U.shower.x)).div(U.shower.y);
        const rain = exp(bearing.mul(bearing).mul(-1.2)).mul(U.showerAmt).mul(tower)
            .mul(float(1.0).sub(smoothstep(0.35, 0.9, hf)).mul(0.6).add(0.4));
        const opt = optics(V, U, tex, {
            rain, deep: false, deepMist: float(0.0), strokes: { masks: vStrokes, thread: vThread, thread2: vThread2 },
        });
        col.assign(col.mul(float(1.0).sub(opt.w)).add(opt.xyz));
        // (The air under the storm lies in its shadow: little airlight before its dark body.)
        const air = float(1.0).sub(exp(dist.div(-26000.0))).mul(float(1.0).sub(storm.mul(0.8)));
        col.assign(mix(col, airColour(V, U), air.mul(0.82)));
        // A torn, billowing edge (each puff its own noise): crisp on the crown, softer in the
        // storm's foot where the rain blurs it; and a flat base.
        const p = local.mul(0.3).add(vec2(tone.y.mul(0.137), tone.y.mul(0.071)))
            .add(vec2(U.mistClock.mul(0.0015), 0.0));
        const n = texture(tex.noise, p).g.mul(0.6).add(texture(tex.noise, p.mul(2.3).add(0.31)).a.mul(0.4));
        const edge = length(local).add(n.sub(0.5).mul(0.7));
        const soft = mix(float(0.62), float(0.4), storm);
        const flat = smoothstep(cloud.x.sub(cloud.y.mul(0.012)), cloud.x.add(cloud.y.mul(0.03)), vWorld.y);
        const alpha = float(1.0).sub(smoothstep(soft, 0.93, edge)).mul(flat).mul(0.97);
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
            const counts = clouds.map((c, i) => Math.max(c.kind === 2 ? 12 : 10, Math.floor((capacity * weight[i]) / total)));
            // Never more than the buffer holds (the sort below would drop the nearest).
            const over = counts.reduce((a, b) => a + b, 0) / capacity;
            const puffs = [];
            clouds.forEach((c, i) => cloudPuffs(c, over > 1 ? Math.floor(counts[i] / over) : counts[i], puffs));
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
