/**
 * Stillwater — the old spruces.
 *
 * Trunks: every tree on the banks is built on the CPU and merged into ONE mesh — a column that
 * wanders a little as it rises, spreads into buttress roots where it meets the moss, and carries
 * a few dead stubs. The bark is drawn in the fragment stage: plates and fissures stretched up the
 * trunk, moss climbing from the foot, lichen higher up, the mist's own light on the flanks.
 *
 * Boughs: hanging spruce boughs (the long curtains of an old "hänggran"), each a spine with a
 * curtain of twigs below it and a fan to either side, cut out of ribbons in the fragment stage.
 * They hang into the top of the frame and stir with the air.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    dot,
    float,
    floor,
    fract,
    max,
    mix,
    normalWorld,
    normalize,
    positionLocal,
    positionWorld,
    sin,
    smoothstep,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    DEG, EYE, lerp, mulberry32,
} from './stillwater-core.js';
import { azimuthOf, rangeOf, valueNoise } from './stillwater-plan.js';
import {
    swFog, swFogAmount, swHash11, swHaze, swLight, swPart,
} from './stillwater-tsl.js';

// ── Trunks ──────────────────────────────────────────────────────────────────────

/** A trunk's radius at a height and an angle round it (metres). */
export function trunkRadius(t, y, angle) {
    const h = Math.max(0, y);
    const taper = 1 - 0.42 * Math.min(1, h / t.height) ** 0.8;
    // Buttress roots: a few lobes that spread where the trunk meets the ground.
    const lobes = 3 + Math.floor((t.seed * 7.3) % 3);
    const lobe = Math.max(0, Math.cos(angle * lobes + t.seed * 3.1)) ** 1.6;
    const flare = t.roots * Math.exp(-h / (t.radius * 1.5)) * (0.22 + 0.8 * lobe);
    const lump = (valueNoise(angle * 1.9 + t.seed * 5, h * 0.33 + t.seed) - 0.5) * 0.12;
    return t.radius * (taper * (1 + flare) + lump);
}

/** The trunk's centre line at a height (it leans, and wanders a little). */
export function trunkCentre(t, y, out = [0, 0, 0]) {
    const wander = Math.sin(y * 0.31 + t.seed) * 0.13 * t.radius + Math.sin(y * 0.11 + t.seed * 2.3) * 0.35 * t.radius;
    out[0] = t.x + t.lean[0] * y + wander;
    out[1] = t.y + y;
    out[2] = t.z + t.lean[1] * y + Math.cos(y * 0.27 + t.seed * 1.7) * 0.11 * t.radius;
    return out;
}

/**
 * All trunks as one geometry (stage space).
 * @param {Array} plan  planTrunks()
 */
export function createTrunkGeometry(plan) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const seeds = [];
    const index = [];
    const c = [0, 0, 0];
    const addTube = (rings, sides, pointAt, uvAt, seed) => {
        const base = positions.length / 3;
        const grid = [];
        for (let k = 0; k <= rings; k++) {
            for (let a = 0; a <= sides; a++) {
                const p = pointAt(k, a % sides);
                grid.push(p);
                positions.push(p[0], p[1], p[2]);
                const st = uvAt(k, a);
                uvs.push(st[0], st[1]);
                seeds.push(seed);
            }
        }
        const at = (k, a) => grid[Math.max(0, Math.min(rings, k)) * (sides + 1) + (((a % sides) + sides) % sides)];
        for (let k = 0; k <= rings; k++) {
            for (let a = 0; a <= sides; a++) {
                const u1 = at(k, a + 1);
                const u0 = at(k, a - 1);
                const v1 = at(k + 1, a);
                const v0 = at(k - 1, a);
                const ux = u1[0] - u0[0];
                const uy = u1[1] - u0[1];
                const uz = u1[2] - u0[2];
                const vx = v1[0] - v0[0];
                const vy = v1[1] - v0[1];
                const vz = v1[2] - v0[2];
                // (round the trunk) × (up the trunk) points outward for a ring that runs anticlockwise from above.
                let nx = uy * vz - uz * vy;
                let ny = uz * vx - ux * vz;
                let nz = ux * vy - uy * vx;
                const l = Math.hypot(nx, ny, nz) || 1;
                nx /= l;
                ny /= l;
                nz /= l;
                normals.push(nx, ny, nz);
            }
        }
        for (let k = 0; k < rings; k++) {
            for (let a = 0; a < sides; a++) {
                const i0 = base + k * (sides + 1) + a;
                const i1 = i0 + 1;
                const i2 = i0 + sides + 1;
                const i3 = i2 + 1;
                index.push(i0, i1, i2, i1, i3, i2);
            }
        }
    };

    plan.forEach((t) => {
        const near = t.hero || rangeOf(t.x, t.z) < 26;
        // Detail by how closely it will be looked at: the giants, the near ranks, the rest.
        const detail = (t.hero && 2) || (near && 1) || 0;
        const sides = [8, 12, 20][detail];
        const rings = [9, 16, 26][detail];
        // Rings crowd toward the foot, where the roots are.
        const heightAt = (k) => -0.5 + (t.height + 0.5) * (k / rings) ** 2.1;
        addTube(rings, sides, (k, a) => {
            const y = heightAt(k);
            // Anticlockwise seen from above: +x toward −z.
            const angle = (a / sides) * Math.PI * 2;
            const r = trunkRadius(t, y, angle);
            trunkCentre(t, y, c);
            return [c[0] + Math.cos(angle) * r, c[1], c[2] - Math.sin(angle) * r];
        }, (k, a) => [a / sides, heightAt(k)], t.seed);

        // Dead stubs: what is left of the lower branches.
        const rand = mulberry32(Math.round(t.seed * 1000) + 77);
        const stubs = near ? 3 + Math.floor(rand() * 5) : 1 + Math.floor(rand() * 2);
        for (let s = 0; s < stubs; s++) {
            const y0 = lerp(1.6, Math.min(13, t.height * 0.5), rand());
            const yaw = rand() * Math.PI * 2;
            const len = lerp(0.4, 2.1, rand() * rand()) * (0.7 + t.radius);
            const thick = lerp(0.03, 0.075, rand()) * (0.6 + t.radius);
            const droop = lerp(0.05, 0.5, rand());
            trunkCentre(t, y0, c);
            const from = [c[0], c[1], c[2]];
            const dir = [Math.cos(yaw), 0, -Math.sin(yaw)];
            const start = trunkRadius(t, y0, yaw) * 0.7;
            // A frame across the stub: up × `dir` = `side`, so the ring runs the right way round.
            const side = [dir[2], 0, -dir[0]];
            addTube(3, 5, (k, a) => {
                const f = k / 3;
                const along = start + len * f;
                const r = thick * (1 - f * 0.85);
                const angle = (a / 5) * Math.PI * 2;
                const cx = from[0] + dir[0] * along;
                const cy = from[1] - droop * f * f * len + Math.sin(f * 2.2) * 0.06;
                const cz = from[2] + dir[2] * along;
                return [
                    cx + side[0] * Math.cos(angle) * r,
                    cy + Math.sin(angle) * r,
                    cz + side[2] * Math.cos(angle) * r,
                ];
            }, (k, a) => [a / 5, y0 + k * 0.3], t.seed + s);
        }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(seeds), 1));
    geometry.setIndex(index);
    return geometry;
}

export function createTrunks(u, plan) {
    const geometry = createTrunkGeometry(plan);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'StillwaterTrunks';
    material.fog = false;
    material.toneMapped = false;
    material.fragmentNode = Fn(() => {
        const P = positionWorld;
        const st = uv().toVar();
        const seed = attribute('aSeed', 'float').toVar();
        const N0 = normalize(normalWorld).toVar();
        // Plates and fissures, drawn out up the trunk.
        const around = st.x.mul(3.1);
        const plates = u.noise(vec2(around.add(seed.mul(0.37)), st.y.mul(0.085).add(seed.mul(0.11)))).toVar();
        const fissures = u.noise(vec2(around.mul(2.7).add(seed), st.y.mul(0.33))).toVar();
        const grain = u.noise(vec2(around.mul(7.0), st.y.mul(1.7))).toVar();
        const ridge = float(1.0).sub(abs(plates.r.mul(2.0).sub(1.0)));
        const crack = smoothstep(0.62, 0.96, ridge.mul(0.55).add(float(1.0).sub(abs(fissures.g.mul(2.0).sub(1.0))).mul(0.45)));
        const bark = u.bark.mul(plates.b.mul(0.7).add(0.62)).mul(float(1.0).sub(crack.mul(0.62)))
            .mul(grain.r.mul(0.3).add(0.85)).toVar();
        // Lichen pales the bark in patches higher up.
        const lichen = smoothstep(0.58, 0.8, plates.a).mul(smoothstep(1.5, 5.0, st.y)).mul(0.5);
        bark.assign(mix(bark, u.stone.mul(1.25).mul(grain.g.mul(0.4).add(0.8)), lichen));
        // Moss climbs from the foot, further on some sides than others.
        const reach = plates.g.mul(2.6).add(fissures.r.mul(0.9)).add(0.35);
        const mossy = float(1.0).sub(smoothstep(reach.mul(0.45), reach, st.y)).toVar();
        const albedo = mix(bark, u.moss.mul(grain.b.mul(0.5).add(0.72)), mossy.mul(0.9)).toVar();
        const N = normalize(N0.add(vec3(fissures.r.sub(0.5), 0.0, fissures.b.sub(0.5))
            .mul(float(0.5).sub(mossy.mul(0.3))))).toVar();
        const lit = swLight(u, albedo, N, P, { wrap: 0.22 }).toVar();
        // The mist's own light lies on a trunk's flanks: its edges are soft, never drawn.
        const V = normalize(P.sub(cameraPosition));
        const flank = float(1.0).sub(abs(dot(N0, V)));
        const f2 = flank.mul(flank);
        lit.addAssign(swHaze(u, V).mul(f2.mul(flank)).mul(swFogAmount(u, P).mul(0.6).add(0.34)).mul(0.38));
        // Looking toward the moon, a trunk's edge takes a thread of its light.
        const toMoon = smoothstep(0.55, 0.98, dot(V, u.moonDir));
        // (A trunk drawn in on a narrow frame is all edge: the thread thins with it.)
        const thread = u.squeeze.mul(u.squeeze).mul(0.5);
        lit.addAssign(u.moonLight.mul(f2.mul(f2)).mul(toMoon).mul(thread).mul(u.breath.mul(0.5).add(0.5)));
        return vec4(swFog(u, lit, P), 1.0);
    })();
    const part = swPart('StillwaterTrunks', geometry, material, 4);
    part.count = plan.length;
    return part;
}

// ── Boughs ──────────────────────────────────────────────────────────────────────

/**
 * Which boughs hang where. Each: { x, y, z (the foot, stage space), yaw, length, curtain, rise,
 * seed, fringe }. They are hung where they will show: along the top of the frame, clear of the
 * moon. `fringe` marks the boughs of the two giants beside the viewer.
 */
export function planBoughs(trunks, count = 46, seed = 1907) {
    const rand = mulberry32(seed);
    const out = [];
    const c = [0, 0, 0];
    const hang = (t, elevation, reach, bias) => {
        const range = rangeOf(t.x, t.z);
        const height = Math.max(2.2, EYE.y + range * Math.tan(elevation) - t.y);
        if (height > t.height * 0.8) return;
        // Nothing hangs across the moon.
        const taz = azimuthOf(t.x, t.z) / DEG;
        const moonSide = taz < -8 && taz > -40;
        if (moonSide && elevation / DEG < 17.5 && Math.abs(taz + 19.5) < 9) return;
        // The giants' boughs reach out over the water; the rest grow as they will, mostly across the view.
        const inward = (t.x < 0 ? 1 : -1) * (range < 9 || rand() < 0.5 ? 1 : -1);
        const a = lerp(-0.75, 0.55, rand()) + bias;
        const yaw = Math.atan2(-Math.sin(a), inward * Math.cos(a));
        trunkCentre(t, height, c);
        out.push({
            x: c[0],
            y: c[1],
            z: c[2],
            yaw,
            length: reach * lerp(0.8, 1.15, rand()),
            // (A bough close to the eye is kept short: it fringes the picture, it does not hang across it.)
            curtain: lerp(0.7, 1.3, rand()) * Math.min(1.2, 0.3 + range * 0.05),
            rise: lerp(0.05, 0.3, rand()),
            seed: rand() * 100,
            // The giants' own: the fringe along the top of a wide frame (a narrow one leaves it out).
            fringe: t.hero && range < 9,
        });
    };
    // The two giants that frame the view: their low boughs fringe the top of the picture.
    trunks.filter((t) => t.hero && rangeOf(t.x, t.z) < 9).forEach((t) => {
        [18.5, 20, 21.5, 19, 17.6, 22.5].forEach((e, i) => hang(t, e * DEG, lerp(2.6, 4.4, rand()), (i - 2.5) * 0.26));
    });
    const rest = trunks.filter((t) => !(t.hero && rangeOf(t.x, t.z) < 9) && rangeOf(t.x, t.z) < 40
        && Math.abs(azimuthOf(t.x, t.z)) < 44 * DEG)
        .sort((a, b) => rangeOf(a.x, a.z) - rangeOf(b.x, b.z));
    let round = 0;
    while (out.length < count && round < 5) {
        for (let i = 0; i < rest.length && out.length < count; i++) {
            const t = rest[i];
            const range = rangeOf(t.x, t.z);
            const e = lerp(7, 24, rand()) * DEG;
            hang(t, e, lerp(1.4, 3.0, rand()) * (range > 22 ? 1.2 : 1), 0);
        }
        round += 1;
    }
    return out.slice(0, count);
}

const BOUGH_SEGMENTS = 8;

export function createBoughs(u, plan, name = 'StillwaterBoughs') {
    const positions = [];
    const uvs = [];
    const sways = [];
    const seeds = [];
    const index = [];
    plan.forEach((b) => {
        const dir = [Math.cos(b.yaw), 0, Math.sin(b.yaw)];
        const side = [-dir[2], 0, dir[0]];
        const spine = (s, o) => {
            // Out, up a little, then down under its own weight.
            const y = b.y + b.length * (b.rise * s - 0.17 * s * s);
            o[0] = b.x + dir[0] * b.length * s;
            o[1] = y;
            o[2] = b.z + dir[2] * b.length * s;
            return o;
        };
        const ribbon = (across, drop, twist) => {
            const base = positions.length / 3;
            const p = [0, 0, 0];
            for (let k = 0; k <= BOUGH_SEGMENTS; k++) {
                const s = k / BOUGH_SEGMENTS;
                spine(s, p);
                // The curtain is longest in the bough's middle.
                const len = b.curtain * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, s * 1.08)) ** 0.7);
                positions.push(p[0], p[1] + 0.03, p[2]);
                positions.push(
                    p[0] + side[0] * across * len,
                    p[1] - drop * len,
                    p[2] + side[2] * across * len,
                );
                uvs.push(s * b.length, 0, s * b.length, 1);
                // The free edge stirs; the spine hardly does.
                sways.push(side[0] * 0.02, 0.01, side[2] * 0.02, s * 6.3 + b.seed);
                sways.push(side[0] * twist + dir[0] * 0.05, 0.02, side[2] * twist + dir[2] * 0.05, s * 6.3 + b.seed + 1.1);
                seeds.push(b.seed, b.seed);
            }
            for (let k = 0; k < BOUGH_SEGMENTS; k++) {
                const i0 = base + k * 2;
                index.push(i0, i0 + 1, i0 + 2, i0 + 2, i0 + 1, i0 + 3);
            }
        };
        ribbon(0.0, 1.0, 0.16); // the curtain
        ribbon(0.62, 0.42, 0.1); // a fan to one side…
        ribbon(-0.62, 0.42, 0.1); // …and to the other
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geometry.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(sways), 4));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(seeds), 1));
    geometry.setIndex(index);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = name;
    material.side = THREE.DoubleSide;
    material.fog = false;
    material.toneMapped = false;
    const sway = attribute('aSway', 'vec4');
    material.positionNode = Fn(() => {
        const phase = sway.w;
        const stir = sin(u.sway.mul(0.9).add(phase)).mul(0.6).add(sin(u.sway.mul(0.37).add(phase.mul(1.7))).mul(0.4));
        return positionLocal.add(sway.xyz.mul(stir).mul(u.wind.mul(2.2).add(0.45)));
    })();
    material.fragmentNode = Fn(() => {
        const st = uv().toVar();
        const seed = attribute('aSeed', 'float').toVar();
        // Twigs: strands hanging off the spine, each its own length, tapering to a point.
        const x = st.x.mul(9.0).add(seed.mul(3.7));
        const id = floor(x);
        const f = fract(x);
        const len = swHash11(id.add(seed.mul(13.0))).mul(0.62).add(0.38);
        const along = clamp(st.y.div(len), 0.0, 1.0);
        // The needles make the strand's edge uneven (a soft unevenness: it is a twig, not a string of beads).
        const ragged = u.noise(vec2(id.mul(0.137).add(seed.mul(0.31)), st.y.mul(1.9))).r.sub(0.5).mul(0.3);
        const half = float(0.4).mul(float(1.0).sub(along.mul(along).mul(0.92))).add(ragged.mul(float(1.0).sub(along)));
        const strand = smoothstep(0.0, 0.05, half.sub(abs(f.sub(0.5)))).mul(float(1.0).sub(smoothstep(0.92, 1.0, st.y.div(len))));
        const branch = float(1.0).sub(smoothstep(0.03, 0.055, st.y));
        max(strand, branch).lessThan(0.5).discard();
        const P = positionWorld;
        // Needles: near black-green; the upper side takes what light there is.
        const tone = swHash11(id.mul(2.3).add(seed)).mul(0.5).add(0.7);
        const albedo = mix(u.needle.mul(tone), u.bark.mul(0.8), branch);
        const upper = float(1.0).sub(smoothstep(0.0, 0.5, st.y));
        const col = swLight(u, albedo, normalize(vec3(0.0, upper.mul(0.6).add(0.1), 0.25)), P, { wrap: 0.8, shade: float(0.3) });
        return vec4(swFog(u, col, P), 1.0);
    })();
    const part = swPart(name, geometry, material, 5);
    part.count = plan.length;
    return part;
}
