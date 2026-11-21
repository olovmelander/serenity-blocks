/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Koi Pond — what floats: lily pads, water lilies, fallen maple leaves and petals, and the soft
 * pools of light the open flowers lay on the water.
 *
 * Everything here rides the simulated surface: each floating thing reads the water's slope
 * under its own middle and tilts with it, so a ring from a locked piece visibly passes under
 * the pads. The lilies open and close per flower (a clear opens them one by one); an open
 * flower glows from its heart.
 *
 * Where each thing floats, how it is turned, rocked, dipped and how wet it is are written every
 * frame by the drift (koi-pond-drift.js): the rings, the koi, the chain's current and the breeze
 * move them. Each part takes those numbers in one dynamic instance buffer (the lilies, a few per
 * flower, in one uniform array) and keeps what never changes in another.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, clamp, cos, dot, float, floor, fract, mix, normalize, positionGeometry,
    positionWorld, pow, sin, smoothstep, uniformArray, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import {
    TAU, hash2, mulberry32, shoreDistance, waterDepth,
} from './koi-pond-core.js';

/** Height of a floating thing's skin over the water plane (it must win the depth test). */
const FLOAT_Y = 0.012;
/**
 * Floats per pad and per fallen leaf in the drift's dynamic buffer: x, z, turn, dip (m), then
 * the rock (a slope added to the water's) across x and z, wetness, and a spare.
 */
export const PAD_LIVE_STRIDE = 8;
export const FLOATER_LIVE_STRIDE = 8;
/** Rows of the lilies' motion array per flower: (dx, dz, turn, dip), (rock x, rock z, wet, 0). */
export const LILY_MOTION_ROWS = 2;

const rotateY = (v, angle) => vec3(
    v.x.mul(cos(angle)).sub(v.z.mul(sin(angle))),
    v.y,
    v.x.mul(sin(angle)).add(v.z.mul(cos(angle))),
);

// ── Geometry ────────────────────────────────────────────────────────────────────────────────

/** A lily pad, radius 1: a disc with the notch every Nymphaea leaf has, its rim a little raised. */
export function buildPadGeometry(segments = 30, rings = 4) {
    const notch = 0.3;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let j = 0; j <= rings; j += 1) {
        const r = j / rings;
        for (let i = 0; i <= segments; i += 1) {
            const f = i / segments;
            const theta = notch * 0.5 + f * (TAU - notch);
            // The rim is scalloped and curls up; the notch's lips curl most.
            const lip = Math.exp(-Math.min(f, 1 - f) * 14);
            const ripple = Math.sin(theta * 5 + 0.45) * 0.027 + Math.sin(theta * 9 - 0.5) * 0.014;
            const radius = r * (1 + ripple * r);
            positions.push(Math.cos(theta) * radius, (0.046 + 0.025 * Math.sin(theta * 4)) * r ** 3
                + 0.05 * lip * r * r, Math.sin(theta) * radius * 0.91);
            uvs.push(r, f);
        }
    }
    for (let j = 0; j < rings; j += 1) {
        for (let i = 0; i < segments; i += 1) {
            const a = j * (segments + 1) + i;
            const b = a + segments + 1;
            // (Wound so that the computed normals point up, out of the water.)
            indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

/** A water-lily petal, one unit long along +x: pointed, cupped across its width. uv = along, across. */
export function buildPetalGeometry(along = 9, across = 5) {
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let j = 0; j <= along; j += 1) {
        const t = j / along;
        // Broad shoulders near the lip, where the petal rolls gently over the outer whorl.
        const half = 0.244 * Math.sin(Math.PI * t ** 1.13) ** 0.54 + 0.014 * (1 - t);
        for (let i = 0; i <= across; i += 1) {
            const s = (i / across) * 2 - 1;
            positions.push(t, 0.059 * s * s * (half / 0.244) + 0.05 * Math.sin(t * Math.PI), s * half);
            uvs.push(t, s);
        }
    }
    for (let j = 0; j < along; j += 1) {
        for (let i = 0; i < across; i += 1) {
            const a = j * (across + 1) + i;
            const b = a + across + 1;
            indices.push(a, a + 1, b, b, a + 1, b + 1);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

/**
 * A Japanese maple leaf lying in the x/z plane, stem at the origin, about one unit to the tip:
 * seven pointed lobes round a hub. uv.x = distance from the hub (0..1), uv.y = which lobe.
 */
export function buildMapleLeafGeometry() {
    const lobes = [[-104, 0.36], [-66, 0.64], [-32, 0.88], [0, 1.0], [32, 0.88], [66, 0.64], [104, 0.36]];
    const hub = [0.26, 0];
    const positions = [0.26, 0.02, 0];
    const uvs = [0, 0.5];
    const outline = [];
    const rad = Math.PI / 180;
    // The stem end.
    outline.push([0, 0, 0.5, 0]);
    lobes.forEach(([deg, len], i) => {
        const a = deg * rad;
        if (i > 0) {
            const prev = lobes[i - 1];
            const mid = ((prev[0] + deg) / 2) * rad;
            const inner = 0.3 * Math.min(prev[1], len) + 0.06;
            outline.push([hub[0] + Math.cos(mid) * inner, hub[1] + Math.sin(mid) * inner, 0.35, i / lobes.length]);
        } else {
            outline.push([hub[0] + Math.cos(a - 0.5) * 0.12, hub[1] + Math.sin(a - 0.5) * 0.12, 0.3, 0]);
        }
        outline.push([hub[0] + Math.cos(a) * len * 0.76, hub[1] + Math.sin(a) * len * 0.76, 1, (i + 0.5) / lobes.length]);
    });
    const last = lobes[lobes.length - 1][0] * rad;
    outline.push([hub[0] + Math.cos(last + 0.5) * 0.12, hub[1] + Math.sin(last + 0.5) * 0.12, 0.3, 1]);
    outline.forEach(([x, z, edge, lobe]) => {
        // Folded a little along the midrib, tips lifted.
        positions.push(x, 0.02 - Math.abs(z) * 0.1 + edge * edge * 0.05, z);
        uvs.push(edge, lobe);
    });
    const indices = [];
    for (let i = 1; i < outline.length; i += 1) indices.push(0, i + 1, i);
    indices.push(0, 1, outline.length);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

// ── Where things float ──────────────────────────────────────────────────────────────────────

/**
 * Lay out the pads and lilies: rafts of pads in the two side reaches and along the far shelf,
 * never under the board card's path and never where the koi leap from.
 * @returns {{ pads: Array, lilies: Array }}
 */
export function planFlora({
    pads, lotus, seed = 311, rocks = [],
} = {}) {
    const rand = mulberry32(seed);
    // Rafts: centre, spread, share of the pads.
    const rafts = [
        {
            x: -5.6, z: -1.5, spread: 1.25, share: 0.24,
        },
        {
            x: -2.9, z: -2.75, spread: 0.85, share: 0.13,
        },
        {
            x: -6.3, z: 1.5, spread: 1.1, share: 0.13,
        },
        {
            x: 5.2, z: 0.1, spread: 1.3, share: 0.22,
        },
        {
            x: 3.1, z: -2.55, spread: 0.8, share: 0.12,
        },
        {
            x: 6.6, z: 2.2, spread: 1.0, share: 0.1,
        },
        {
            x: -3.3, z: 2.6, spread: 0.7, share: 0.06,
        },
        // (Near water a wide screen never shows: the foot of a tall one.)
        {
            x: -2.7, z: 4.5, spread: 0.7, share: 0.05,
        },
        {
            x: 2.9, z: 4.9, spread: 0.7, share: 0.05,
        },
    ];
    const out = [];
    const fits = (x, z, r) => {
        if (shoreDistance(x, z) < r + 0.045 || waterDepth(x, z) < 0.12) return false;
        if (Math.abs(x) < 1.75 + r) return false;
        for (let i = 0; i < rocks.length; i += 1) {
            if (Math.hypot(rocks[i].x - x, rocks[i].z - z) < rocks[i].radius + r * 0.8) return false;
        }
        for (let i = 0; i < out.length; i += 1) {
            const d = Math.hypot(out[i].x - x, out[i].z - z);
            if (d < (out[i].radius + r) * 0.9) return false;
        }
        return true;
    };
    const totalShare = rafts.reduce((sum, raft) => sum + raft.share, 0);
    let share = 0;
    const minimum = pads >= rafts.length ? 1 : 0;
    rafts.forEach((raft, index) => {
        // Apportion cumulative shares so the far rafts cannot consume the foreground's budget.
        share += raft.share;
        const room = pads - out.length - minimum * (rafts.length - index - 1);
        const want = Math.min(room, Math.max(minimum, Math.round(pads * (share / totalShare)) - out.length));
        let placed = 0;
        for (let tries = 0; tries < want * 30 && placed < want; tries += 1) {
            const a = rand() * TAU;
            const d = Math.sqrt(rand()) * raft.spread;
            const radius = 0.2 + rand() ** 1.6 * 0.3;
            const x = raft.x + Math.cos(a) * d * 1.25;
            const z = raft.z + Math.sin(a) * d;
            if (fits(x, z, radius)) {
                out.push({
                    x, z, radius, turn: rand() * TAU, tone: rand(), age: rand() ** 2.4, raft,
                });
                placed += 1;
            }
        }
    });
    // Each reach has a flower, including the near shelves that frame a tall screen.
    const lilies = [];
    const focal = [[4.55, 0.7], [-3.15, 2.5], [3.1, -2.5], [-2.65, 4.45], [-5.1, -1.5], [3.0, 4.8]];
    const hosts = [];
    for (const [x, z] of focal) {
        let host = null;
        let best = Infinity;
        for (const pad of out) {
            const score = Math.hypot(pad.x - x, pad.z - z) - 1.4 * pad.radius;
            if (score < best && !hosts.includes(pad)) { best = score; host = pad; }
        }
        if (host) hosts.push(host);
    }
    hosts.push(...out.filter((p) => !hosts.includes(p)).sort((a, b) => b.radius - a.radius));
    for (let i = 0; i < hosts.length && lilies.length < lotus; i += 1) {
        const pad = hosts[i];
        const a = rand() * TAU;
        const x = pad.x + Math.cos(a) * pad.radius * 0.95;
        const z = pad.z + Math.sin(a) * pad.radius * 0.95;
        const crowded = lilies.some((l) => Math.hypot(l.x - x, l.z - z) < 1.15);
        if (!crowded && waterDepth(x, z) > 0.14 && Math.abs(x) > 2) {
            // (`pad`: the pad it stands on, which carries it wherever the water takes the pad.)
            lilies.push({
                x, z, scale: 0.35 + pad.radius * 0.35 + rand() * 0.05, turn: rand() * TAU, pink: rand(), pad: out.indexOf(pad),
            });
        }
    }
    return { pads: out, lilies };
}

/**
 * Where the fallen leaves and petals lie when the water is still: more under the maple (left,
 * toward the far bank), a scatter everywhere, none on a pad. `size` is a leaf's length from its
 * stem; `rate` and `phase` set the slow loop each one wanders.
 * @returns {Array<{x:number, z:number, size:number, turn:number, tone:number, petal:number, phase:number, rate:number}>}
 */
export function planFloaters(count, {
    seed = 5021, pads = [], canopy, rocks = [],
} = {}) {
    const rand = mulberry32(seed);
    const out = [];
    for (let tries = 0; tries < count * 40 && out.length < count; tries += 1) {
        const under = rand() < 0.62;
        const x = under ? -7.5 + rand() * 6.2 : -9 + rand() * 18;
        const z = under ? -4 + rand() * 4.6 : -4.4 + rand() * 8.4;
        if (waterDepth(x, z) < 0.05 || (Math.abs(x) < 1.5 && rand() < 0.7)) continue;
        const petal = rand() < 0.3 ? 1 : 0;
        const leaf = {
            x,
            z,
            size: petal ? 0.035 + rand() * 0.02 : 0.085 + rand() * 0.07,
            turn: rand() * TAU,
            tone: rand(),
            petal,
            phase: rand() * TAU,
            rate: 0.4 + rand() * 0.9,
        };
        if (pads.some((pad) => Math.hypot(pad.x - x, pad.z - z) < pad.radius + leaf.size * 0.5)) continue;
        out.push(leaf);
    }
    // Give a few of the existing leaf slots a journey from an actual twig to open water.
    const falling = Math.min(out.length, Math.max(2, Math.round(count / 15)));
    for (let slot = 0, tries = 0; canopy?.count && slot < falling && tries < falling * 80; tries += 1) {
        const o = Math.floor(rand() * canopy.count) * 8;
        const [startX, height, startZ] = canopy.leaves.subarray(o, o + 3);
        const x = startX - Math.sign(startX) * (0.5 + rand() * 1.2);
        const z = startZ + 0.55 + rand() * 1.35;
        if (Math.abs(x) < 1.8 || Math.abs(x) > 5.2 || waterDepth(x, z) < 0.25) continue;
        if (pads.some((pad) => Math.hypot(pad.x - x, pad.z - z) < pad.radius + 0.15)
            || rocks.some((rock) => Math.hypot(rock.x - x, rock.z - z) < rock.radius + 0.2)) continue;
        const period = 13 + rand() * 8;
        Object.assign(out[out.length - 1 - slot], {
            x,
            z,
            petal: 0,
            size: 0.13 + rand() * 0.045,
            fall: {
                startX, startZ, height, period, duration: 3.3 + rand() * 1.55, offset: (slot + rand() * 0.6) * (period / falling),
            },
        });
        slot += 1;
    }
    return out;
}

/** A dynamic instance buffer of `stride` floats per instance, written each frame by the drift. */
function liveBuffer(data, stride) {
    const buffer = new THREE.InstancedInterleavedBuffer(data, stride);
    buffer.setUsage(THREE.DynamicDrawUsage);
    return buffer;
}

// ── Pads ────────────────────────────────────────────────────────────────────────────────────

export function createPads(light, plan) {
    const { u } = light;
    const count = plan.pads.length;
    const base = buildPadGeometry();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(base.getIndex());
    ['position', 'normal', 'uv'].forEach((name) => geometry.setAttribute(name, base.getAttribute(name)));
    geometry.instanceCount = count;
    // What never changes: tone, age, radius. What the drift writes each frame: where the pad
    // floats, how it is turned and dipped; how it is rocked and how wet it is.
    const look = new Float32Array(Math.max(1, count) * 4);
    const live = new Float32Array(Math.max(1, count) * PAD_LIVE_STRIDE);
    plan.pads.forEach((pad, i) => {
        look.set([pad.tone, pad.age, pad.radius, 0], i * 4);
        live.set([pad.x, pad.z, pad.turn, 0, 0, 0, 0, 0], i * PAD_LIVE_STRIDE);
    });
    const lookBuffer = new THREE.InstancedInterleavedBuffer(look, 4);
    const moving = liveBuffer(live, PAD_LIVE_STRIDE);
    geometry.setAttribute('aPadLook', new THREE.InterleavedBufferAttribute(lookBuffer, 4, 0));
    geometry.setAttribute('aPadLive', new THREE.InterleavedBufferAttribute(moving, 4, 0));
    geometry.setAttribute('aPadRock', new THREE.InterleavedBufferAttribute(moving, 4, 4));
    const aLook = attribute('aPadLook', 'vec4');
    const aLive = attribute('aPadLive', 'vec4');
    const aRock = attribute('aPadRock', 'vec4');

    /** The slope the pad lies on: the water's under its middle, and the rock the drift gives it. */
    const padSlope = () => light.surfaceAt(aLive.xy).xy.mul(0.9).add(aRock.xy);
    const place = Fn(() => {
        const local = rotateY(positionGeometry.mul(aLook.z), aLive.z);
        // The pad rides the water: it tilts with the slope under its middle.
        const slope = padSlope();
        const lift = slope.x.mul(local.x).add(slope.y.mul(local.z));
        return vec3(aLive.x.add(local.x), local.y.add(lift).add(FLOAT_Y).add(aLive.w), aLive.y.add(local.z));
    })();
    const vNormal = varying(Fn(() => {
        const slope = padSlope();
        const n = rotateY(attribute('normal', 'vec3'), aLive.z);
        return normalize(vec3(n.x.sub(slope.x), n.y, n.z.sub(slope.y)));
    })(), 'vPadNormal');

    const paint = Fn(() => {
        const point = positionWorld.toVar();
        const r = uv().x;
        const f = uv().y;
        const normal = normalize(vNormal).toVar();
        const view = normalize(cameraPosition.sub(point)).toVar();
        // Veins fan out from where the stalk joins, opposite the notch.
        const fan = f.mul(Math.PI * 10.0).add(sin(r.mul(5).add(f.mul(8))).mul(0.32));
        const veins = pow(abs(cos(fan)), 19.0).mul(smoothstep(0.03, 0.35, r)).mul(smoothstep(0.79, 1.0, r).oneMinus());
        const fresh = mix(vec3(0.018, 0.104, 0.072), vec3(0.1, 0.22, 0.064), aLook.x);
        const old = vec3(0.16, 0.13, 0.035);
        const grain = light.noise.sample(point.xz.mul(0.9)).b;
        const leaf = mix(fresh, old, aLook.y.mul(smoothstep(0.35, 1.0, r.add(grain.mul(0.35))))).toVar();
        leaf.mulAssign(veins.mul(0.75).add(0.8).add(grain.mul(0.35)));
        // The rim is a shade redder and catches the light.
        leaf.assign(mix(leaf, vec3(0.13, 0.07, 0.04), smoothstep(0.9, 1.0, r).mul(0.6)));
        // A pad a splash or a koi has just wetted is darker, and glossy with a film of water.
        const wet = clamp(aRock.z, 0.0, 1.0).toVar();
        leaf.mulAssign(float(1.0).sub(wet.mul(0.22)));
        const lit = light.moonlight().toVar();
        const ndl = clamp(dot(normal, u.moonDir), 0.0, 1.0);
        const half = normalize(u.moonDir.add(view));
        const facing = clamp(dot(normal, half), 0.0, 1.0).toVar();
        // Waxed: a broad sheen, and beads of water that hold a point of moon each.
        // (A pad that mirrors the moon must glint, not turn white: a small sharp lobe.)
        const sheen = pow(facing, 20.0).mul(wet.mul(2.5).add(1.0).mul(0.035)).add(pow(facing, 400.0).mul(0.2))
            .add(pow(facing, 60.0).mul(wet.mul(0.12)));
        // Dew stays on the leaf as it rotates and drifts.
        const theta = f.mul(TAU - 0.3).add(0.15);
        const cell = vec2(cos(theta), sin(theta)).mul(r.mul(aLook.z).mul(30)).add(aLook.x.mul(23)).add(64);
        const bead = smoothstep(0.955, 1.0, fract(sin(dot(floor(cell), vec2(12.9898, 78.233))).mul(43758.5453)))
            .mul(float(1.0).sub(smoothstep(0.1, 0.34, fract(cell).sub(0.5).length())));
        const beads = bead.mul(pow(facing, 6.0)).mul(wet.mul(1.5).add(1.5));
        const band = light.ringLight(point.xz).mul(0.5);
        const colour = leaf.mul(u.moonColor.mul(ndl.mul(lit)).mul(0.8).mul(u.breath.mul(0.8).add(0.2)).add(u.skyAmbient.mul(1.3))
            .add(light.lantern(point, normal).mul(1.5))
            .add(band))
            .add(u.moonColor.mul(sheen.add(beads)).mul(lit).mul(u.breath));
        return vec4(colour, 1.0);
    });

    const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
    material.name = 'Koi Pond — lily pads';
    material.positionNode = place;
    material.fragmentNode = paint();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Koi Pond — lily pads';
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return {
        mesh,
        geometry,
        material,
        count,
        live,
        commit() {
            moving.needsUpdate = true;
        },
        dispose: () => base.dispose(),
    };
}

// ── Water lilies ────────────────────────────────────────────────────────────────────────────

/** Petals per flower: three whorls, then the stamens at the heart. */
const WHORLS = [
    // count, open elevation (rad), closed, length, base radius, kind (0 petal, 1 stamen)
    [12, 0.32, 1.20, 0.89, 0.088, 0],
    [10, 0.63, 1.38, 0.76, 0.066, 0],
    [7, 0.96, 1.46, 0.57, 0.045, 0],
    [13, 1.09, 1.37, 0.44, 0.061, 1],
    [7, 1.45, 1.51, 0.47, 0.016, 1],
];
export const PETALS_PER_LILY = WHORLS.reduce((sum, w) => sum + w[0], 0);

export function createLilies(light, plan) {
    const { u } = light;
    const flowers = plan.lilies.length;
    const count = Math.max(1, flowers * PETALS_PER_LILY);
    const base = light.tier?.shadows ? buildPetalGeometry() : buildPetalGeometry(7, 4);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(base.getIndex());
    ['position', 'normal', 'uv'].forEach((name) => geometry.setAttribute(name, base.getAttribute(name)));
    geometry.instanceCount = flowers * PETALS_PER_LILY;
    const data = new Float32Array(count * 12);
    let at = 0;
    plan.lilies.forEach((lily, flower) => {
        WHORLS.forEach(([n, open, closed, length, ring, kind], whorl) => {
            for (let k = 0; k < n; k += 1) {
                const angle = lily.turn + ((k + (whorl % 2) * 0.5) / n) * TAU + (hash2(flower * 31 + whorl, k) - 0.5) * 0.16;
                data.set([
                    lily.x, lily.z, lily.scale, angle,
                    open + (hash2(k, flower * 7 + whorl) - 0.5) * 0.14, closed, length, ring,
                    flower, kind, lily.pink, whorl / 4,
                ], at * 12);
                at += 1;
            }
        });
    });
    const buffer = new THREE.InstancedInterleavedBuffer(data, 12);
    geometry.setAttribute('aLily', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geometry.setAttribute('aWhorl', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    geometry.setAttribute('aKind', new THREE.InterleavedBufferAttribute(buffer, 4, 8));
    const aLily = attribute('aLily', 'vec4');
    const aWhorl = attribute('aWhorl', 'vec4');
    const aKind = attribute('aKind', 'vec4');

    /** How open each flower is (0 a bud, 1 full), and how brightly its heart burns. */
    const openness = Array.from({ length: Math.max(1, flowers) }, () => 0.2);
    const heart = Array.from({ length: Math.max(1, flowers) }, () => 0);
    const openNode = uniformArray(openness, 'float');
    const heartNode = uniformArray(heart, 'float');
    /**
     * How the drift has moved each flower with its pad (LILY_MOTION_ROWS rows a flower): how far
     * from where it was planted and how far turned, how deep dipped; how rocked, how wet. One
     * array, so the material binds one buffer for all of it.
     */
    const motion = Array.from({ length: Math.max(1, flowers) * LILY_MOTION_ROWS }, () => new THREE.Vector4());
    const motionNode = uniformArray(motion, 'vec4');
    const flowerIndex = floor(aKind.x.add(0.5)).toInt();

    const pose = (wantNormal) => Fn(() => {
        const open = openNode.element(flowerIndex);
        const moved = motionNode.element(flowerIndex.mul(LILY_MOTION_ROWS));
        const turn = aLily.w.add(moved.z);
        const elevation = mix(aWhorl.y, aWhorl.x, open);
        const grow = aLily.z.mul(open.mul(0.42).add(0.58)).mul(aWhorl.z);
        const src = wantNormal ? attribute('normal', 'vec3') : positionGeometry;
        // A petal curls back toward its tip as the flower opens.
        const t = uv().x;
        const curl = elevation.sub(t.mul(t).mul(open).mul(0.31));
        const lifted = vec3(
            src.x.mul(cos(curl)).sub(src.y.mul(sin(curl))),
            src.x.mul(sin(curl)).add(src.y.mul(cos(curl))),
            src.z,
        );
        if (wantNormal) return normalize(rotateY(lifted, turn));
        const rock = motionNode.element(flowerIndex.mul(LILY_MOTION_ROWS).add(1));
        const centre = aLily.xy.add(moved.xy);
        // (The flower nods with its pad: the water's slope under it and the rock its pad is given.)
        const slope = light.surfaceAt(centre).xy.mul(0.9).add(rock.xy);
        const out = rotateY(lifted.mul(grow).add(vec3(aWhorl.w.mul(aLily.z), 0.0, 0.0)), turn);
        const lift = slope.x.mul(out.x).add(slope.y.mul(out.z));
        return vec3(centre.x.add(out.x), out.y.add(lift).add(moved.w).add(FLOAT_Y + 0.018), centre.y.add(out.z));
    })();
    const vNormal = varying(pose(true), 'vLilyNormal');

    const paint = Fn(() => {
        const point = positionWorld.toVar();
        const t = uv().x;
        const across = uv().y;
        const open = openNode.element(flowerIndex);
        const burn = heartNode.element(flowerIndex);
        const stamen = aKind.y;
        // White at the base, the night's colour toward the tip (rose on the jade night); the
        // inner whorls are the deepest.
        const rose = mix(u.petal, u.petalPale, aKind.z.mul(0.63));
        const pigment = rose.mul(mix(vec3(1.0, 0.5, 0.72), vec3(1.0, 0.79, 0.88), aKind.z));
        const lip = smoothstep(0.42, 1, abs(across));
        const mantle = aKind.w.mul(0.48).add(0.64);
        const petal = mix(vec3(0.99, 0.87, 0.73), pigment, smoothstep(0.18, 0.88, t).mul(mantle).add(lip.mul(0.16)));
        const striae = cos(across.mul(13.0).add(t.mul(2.3))).mul(0.045).mul(smoothstep(0.03, 0.5, t));
        const rib = float(1.0).sub(abs(across).mul(0.18)).add(striae);
        const pollen = mix(vec3(0.92, 0.42, 0.035), vec3(1.0, 0.78, 0.18), smoothstep(0.48, 0.84, t));
        const skin = mix(petal.mul(rib), pollen, stamen).toVar();
        const normal = normalize(vNormal);
        const ndl = dot(normal, u.moonDir);
        // Thin petals pass the light: lit from either face.
        const through = abs(ndl).mul(0.6).add(0.4);
        const lit = light.moonlight();
        const moon = u.moonColor.mul(through).mul(lit).mul(1.1).mul(u.breath.mul(0.8).add(0.2));
        // The heart's own light: gold at the stamens, rose up the insides of the petals.
        const inner = float(1.0).sub(smoothstep(0.0, 0.75, t));
        const glow = vec3(1.0, 0.5, 0.3).mul(inner.mul(0.5).add(stamen.mul(1.6)))
            .mul(burn.mul(1.5).add(open.mul(0.16)).add(u.glow.mul(0.25))).mul(u.breath);
        const colour = skin.mul(moon.add(u.skyAmbient.mul(1.6)).add(light.lantern(point, normal).mul(1.4))
            .add(light.ringLight(point.xz).mul(0.5))).add(skin.mul(glow)).add(pollen.mul(stamen).mul(0.46).mul(u.breath));
        return vec4(colour, 1.0);
    });

    const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
    material.name = 'Koi Pond — water lilies';
    material.positionNode = pose(false);
    material.fragmentNode = paint();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Koi Pond — water lilies';
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return {
        mesh, geometry, material, flowers, openness, heart, motion, dispose: () => base.dispose(),
    };
}

// ── Fallen leaves and petals ────────────────────────────────────────────────────────────────

/** The middle of a maple leaf, as a share of its length from the stem: it turns about this. */
export const LEAF_MIDDLE = 0.45;

/** The fallen leaves and petals of `leaves` (planFloaters), each where the drift writes it. */
export function createFloaters(light, leaves) {
    const { u } = light;
    const count = leaves.length;
    const base = buildMapleLeafGeometry();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(base.getIndex());
    ['position', 'normal', 'uv'].forEach((name) => geometry.setAttribute(name, base.getAttribute(name)));
    // Reuse the fan's triangles for fallen petals, rounding the maple's notched outline.
    const shape = base.getAttribute('position');
    const petal = new Float32Array(shape.count * 3);
    for (let i = 0; i < shape.count; i += 1) {
        const a = Math.atan2(shape.getZ(i), shape.getX(i) - 0.26);
        const s = Math.sin(a);
        const c = Math.cos(a);
        petal.set(i ? [0.49 + c * 0.49, s * s * 0.095, s * (0.26 + c * 0.055)] : [0.48, 0.01, 0], i * 3);
    }
    geometry.setAttribute('aPetalShape', new THREE.BufferAttribute(petal, 3));
    geometry.instanceCount = count;
    // What never changes: tone, petal or leaf, its own moment in the maple's turn, its size.
    // What the drift writes each frame: where it floats, how it is turned, rocked and dipped.
    const look = new Float32Array(Math.max(1, count) * 4);
    const live = new Float32Array(Math.max(1, count) * FLOATER_LIVE_STRIDE);
    leaves.forEach((leaf, i) => {
        look.set([leaf.tone, leaf.petal, leaf.phase, leaf.size], i * 4);
        live.set([leaf.x, leaf.z, leaf.turn, 0, 0, 0, 0, 0], i * FLOATER_LIVE_STRIDE);
    });
    const lookBuffer = new THREE.InstancedInterleavedBuffer(look, 4);
    const moving = liveBuffer(live, FLOATER_LIVE_STRIDE);
    geometry.setAttribute('aFloatLook', new THREE.InterleavedBufferAttribute(lookBuffer, 4, 0));
    geometry.setAttribute('aFloatLive', new THREE.InterleavedBufferAttribute(moving, 4, 0));
    geometry.setAttribute('aFloatRock', new THREE.InterleavedBufferAttribute(moving, 4, 4));
    const aLook = attribute('aFloatLook', 'vec4');
    const aLive = attribute('aFloatLive', 'vec4');
    const aRock = attribute('aFloatRock', 'vec4');
    // A fallen leaf changes colour with the tree it fell from, in its own time.
    const vTurned = varying(light.leafTurned(fract(aLook.z.mul(3.7))), 'vFloatTurned');

    const place = Fn(() => {
        // (Turned about its middle, not its stem: a leaf set spinning spins in place.)
        const shapeAt = mix(positionGeometry, attribute('aPetalShape', 'vec3'), aLook.y)
            .sub(vec3(LEAF_MIDDLE, 0.0, 0.0)).mul(aLook.w).mul(smoothstep(-0.48, -0.18, aLive.w));
        // The last drift value carries the bank angle of a tumbling leaf.
        const rolled = vec3(
            shapeAt.x,
            shapeAt.y.mul(cos(aRock.w)).sub(shapeAt.z.mul(sin(aRock.w))),
            shapeAt.z.mul(cos(aRock.w)).add(shapeAt.y.mul(sin(aRock.w))),
        );
        const local = rotateY(rolled, aLive.z);
        const slope = light.surfaceAt(aLive.xy).xy.add(aRock.xy);
        const lift = slope.x.mul(local.x).add(slope.y.mul(local.z));
        // `w`: how far it is pushed under (a splash on it, a koi mouthing it) or lifted.
        const y = local.y.add(lift).add(FLOAT_Y * 0.7).add(aLive.w);
        return vec3(aLive.x.add(local.x), y, aLive.y.add(local.z));
    })();

    const paint = Fn(() => {
        const point = positionWorld.toVar();
        const edge = uv().x;
        const soaked = clamp(aRock.z, 0.0, 1.0).toVar();
        // Leaves in the maple's colours (on the jade night: crimson through orange to old gold),
        // petals in the lilies'. A wetted one is darker and glossier.
        const maple = mix(
            light.leafColour(0, aLook.x.mul(0.55).add(0.45), vTurned),
            light.leafColour(1, float(1.0), vTurned),
            pow(aLook.x, 4.0),
        );
        const backlight = abs(sin(aRock.w));
        const skin = mix(maple.mul(edge.mul(0.3).add(0.75)).mul(backlight.mul(0.65).add(1)), mix(u.petal, u.petalPale, 0.5).mul(0.76), aLook.y)
            .mul(float(1.0).sub(soaked.mul(0.18)));
        const lit = light.moonlight();
        const normal = normalize(vec3(light.surfaceAt(point.xz).xy.add(aRock.xy).negate(), 1.0).xzy);
        const ndl = clamp(dot(normal, u.moonDir), 0.0, 1.0);
        const view = normalize(cameraPosition.sub(point));
        const wet = pow(clamp(dot(normal, normalize(u.moonDir.add(view))), 0.0, 1.0), 30.0)
            .mul(soaked.mul(2.5).add(1.0).mul(0.16));
        const key = mix(u.moonColor, vec3(1.0, 0.86, 0.8), 0.6);
        const colour = skin.mul(key.mul(ndl.mul(lit)).mul(0.9).mul(u.breath.mul(0.8).add(0.2)).add(u.skyAmbient.mul(1.5))
            .add(light.lantern(point, normal).mul(1.6))
            .add(light.ringLight(point.xz).mul(0.6)))
            .add(u.moonColor.mul(wet).mul(lit));
        return vec4(colour, 1.0);
    });

    const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
    material.name = 'Koi Pond — fallen leaves';
    material.positionNode = place;
    material.fragmentNode = paint();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Koi Pond — fallen leaves';
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return {
        mesh,
        geometry,
        material,
        count,
        live,
        commit() {
            moving.needsUpdate = true;
        },
        dispose: () => base.dispose(),
    };
}
