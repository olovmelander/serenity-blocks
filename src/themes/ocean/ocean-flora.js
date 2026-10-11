/**
 * Ocean — what grows and bends: kelp on the shoulders, seagrass along the channel.
 *
 * A stand of kelp is one curve from the rock toward the surface, leaning with the current and
 * swaying on its own; its stipe is a ribbon along that curve and its blades hang off it, every
 * one riding the same curve at its own height, trailing downstream. A clear's current is a
 * front crossing the canyon: each stand and each tuft of grass leans as it passes and comes
 * back, so the eye sees the current go by.
 *
 * Kelp is thin: seen against the light it glows. That is most of what it is for.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    dot,
    float,
    max,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    pow,
    sin,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    mulberry32, ocFog, ocLight, ocPart, ocRings, ocSway,
} from './ocean-tsl.js';

/** Metres a kelp stand's top is carried sideways per unit of lean, as a share of its height. */
const KELP_FLEX = 0.2;

/**
 * Where a stand's curve is at a share `f` of its height: the offset from straight up (x, z).
 * `bend` = ocSway() for the stand, `height` its height, `seed` its own number.
 */
const kelpOffset = (u, bend, height, f, seed) => {
    const reach = pow(max(f, 0.0), 1.7).mul(height).mul(KELP_FLEX);
    // A slow wave climbs every stand, so it is never a stiff pole.
    const wave = sin(u.sway.mul(1.25).sub(f.mul(5.0)).add(seed.mul(20.0))).mul(f).mul(0.16);
    return vec2(bend.x.mul(reach).add(wave), bend.y.mul(reach).add(wave.mul(0.6)));
};

/** The light on something thin and green: the sea's own light, and the sun coming through it. */
const leafLight = (u, hue, N, P, lit) => {
    const light = ocLight(u, { N, P, wrap: 0.85 });
    const toward = clamp(dot(normalize(P.sub(cameraPosition)), u.sunDir), 0.0, 1.0);
    const through = toward.mul(toward).mul(toward);
    return hue.mul(light).add(hue.mul(u.sun).mul(through).mul(lit).mul(0.9)
        .mul(u.breath));
};

/**
 * Kelp: stipes and blades.
 * @param {object} u
 * @param {Array<{x:number,y:number,z:number,height:number,seed:number,lean:number}>} stands
 * @param {number} bladesPerStand
 */
export function createKelp(u, stands, bladesPerStand) {
    const group = new THREE.Group();
    const rand = mulberry32(6203);
    const count = Math.max(1, stands.length);

    // ── Stipes: a ribbon up each stand, turned to the viewer ──
    const SEGMENTS = 14;
    const stripPos = [];
    const stripUv = [];
    const stripIndex = [];
    for (let s = 0; s <= SEGMENTS; s++) {
        const f = s / SEGMENTS;
        stripPos.push(-1, f, 0, 1, f, 0);
        stripUv.push(0, f, 1, f);
        if (s < SEGMENTS) {
            const a = s * 2;
            stripIndex.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
        }
    }
    const stipeGeometry = new THREE.InstancedBufferGeometry();
    stipeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(stripPos, 3));
    stipeGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(stripUv, 2));
    stipeGeometry.setIndex(stripIndex);
    const standData = new Float32Array(count * 4);
    const standMore = new Float32Array(count * 4);
    stands.forEach((k, i) => {
        standData.set([k.x, k.y, k.z, k.height], i * 4);
        standMore.set([k.seed, k.lean, 0, 0], i * 4);
    });
    if (!stands.length) standData.set([0, -50, 0, 0], 0);
    stipeGeometry.setAttribute('aStand', new THREE.InstancedBufferAttribute(standData, 4));
    stipeGeometry.setAttribute('aMore', new THREE.InstancedBufferAttribute(standMore, 4));
    stipeGeometry.instanceCount = count;

    const stipeMaterial = new THREE.MeshBasicNodeMaterial();
    stipeMaterial.name = 'OceanKelpStipes';
    stipeMaterial.side = THREE.DoubleSide;
    stipeMaterial.fog = false;
    stipeMaterial.toneMapped = false;
    {
        const aStand = attribute('aStand', 'vec4');
        const aMore = attribute('aMore', 'vec4');
        stipeMaterial.positionNode = Fn(() => {
            const f = positionGeometry.y;
            const bend = ocSway(u, aStand.x, aMore.x).mul(aMore.y);
            const off = kelpOffset(u, bend, aStand.w, f, aMore.x);
            const spine = vec3(aStand.x.add(off.x), aStand.y.add(f.mul(aStand.w)), aStand.z.add(off.y)).toVar();
            // Turned to the eye (in stage space: the squeeze only narrows it).
            const eye = vec3(cameraPosition.x.div(u.squeeze), cameraPosition.y, cameraPosition.z);
            const side = normalize(cross(vec3(0.0, 1.0, 0.0), eye.sub(spine)));
            const width = mix(float(0.055), float(0.022), f);
            return spine.add(side.mul(positionGeometry.x).mul(width));
        })();
        stipeMaterial.colorNode = Fn(() => {
            const P = positionWorld;
            const N = normalize(vec3(0.0, 0.35, 1.0));
            const round = float(1.0).sub(uv().x.mul(2.0).sub(1.0).abs().mul(0.5));
            const col = leafLight(u, vec3(0.16, 0.09, 0.025).mul(round), N, P, float(0.3));
            return vec4(ocFog(u, col, P), 1.0);
        })();
    }
    const stipes = new THREE.Mesh(stipeGeometry, stipeMaterial);
    stipes.name = 'OceanKelpStipes';
    stipes.frustumCulled = false;
    stipes.renderOrder = 6;
    group.add(stipes);

    // ── Blades: a long leaf, many to a stand ──
    const BLADE_SEGMENTS = 6;
    const bladePos = [];
    const bladeUv = [];
    const bladeIndex = [];
    for (let s = 0; s <= BLADE_SEGMENTS; s++) {
        const f = s / BLADE_SEGMENTS;
        // Broadest a third of the way out, pointed at the end.
        const half = 0.5 * Math.sin(Math.min(1, f * 1.5 + 0.12) * Math.PI * 0.5) * (1 - f ** 3) + 0.02;
        bladePos.push(f, 0, -half, f, 0, half);
        bladeUv.push(f, 0, f, 1);
        if (s < BLADE_SEGMENTS) {
            const a = s * 2;
            bladeIndex.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
        }
    }
    const blades = Math.max(1, stands.length * bladesPerStand);
    const bladeGeometry = new THREE.InstancedBufferGeometry();
    bladeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bladePos, 3));
    bladeGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(bladeUv, 2));
    bladeGeometry.setIndex(bladeIndex);
    const bStand = new Float32Array(blades * 4);
    const bMore = new Float32Array(blades * 4);
    const bBlade = new Float32Array(blades * 4);
    stands.forEach((k, i) => {
        for (let b = 0; b < bladesPerStand; b++) {
            const o = (i * bladesPerStand + b) * 4;
            bStand.set([k.x, k.y, k.z, k.height], o);
            bMore.set([k.seed, k.lean, 0, 0], o);
            // Up the whole stipe, a blade on a float every hand's breadth, turning round it:
            // (share of the height, bearing, length, seed).
            const f = 0.06 + 0.94 * ((b + rand() * 0.6) / bladesPerStand);
            bBlade.set([f, b * 2.39996 + rand() * 0.5, (0.85 + rand() * 0.75) * (1 - 0.35 * f), rand()], o);
        }
    });
    if (!stands.length) bStand.set([0, -50, 0, 0], 0);
    bladeGeometry.setAttribute('aStand', new THREE.InstancedBufferAttribute(bStand, 4));
    bladeGeometry.setAttribute('aMore', new THREE.InstancedBufferAttribute(bMore, 4));
    bladeGeometry.setAttribute('aBlade', new THREE.InstancedBufferAttribute(bBlade, 4));
    bladeGeometry.instanceCount = blades;

    const bladeMaterial = new THREE.MeshBasicNodeMaterial();
    bladeMaterial.name = 'OceanKelpBlades';
    bladeMaterial.side = THREE.DoubleSide;
    bladeMaterial.fog = false;
    bladeMaterial.toneMapped = false;
    {
        const aStand = attribute('aStand', 'vec4');
        const aMore = attribute('aMore', 'vec4');
        const aBlade = attribute('aBlade', 'vec4');
        const vAlong = varying(positionGeometry.x, 'vKelpAlong');
        const vHigh = varying(aBlade.x, 'vKelpHigh');
        const vSeed = varying(aBlade.w, 'vKelpSeed');
        const vRing = varying(Fn(() => ocRings(u, vec2(aStand.x.mul(u.squeeze), aStand.z)))(), 'vKelpRing');
        bladeMaterial.positionNode = Fn(() => {
            const along = positionGeometry.x;
            const across = positionGeometry.z;
            const bend = ocSway(u, aStand.x, aMore.x).mul(aMore.y).toVar();
            const off = kelpOffset(u, bend, aStand.w, aBlade.x, aMore.x);
            const root = vec3(aStand.x.add(off.x), aStand.y.add(aBlade.x.mul(aStand.w)), aStand.z.add(off.y));
            // A blade leaves the stipe on its own bearing, but the water streams it downstream, and
            // its float holds it up: it rises a little as it trails.
            const heading = normalize(vec2(cos(aBlade.y), sin(aBlade.y)).mul(0.55).add(vec2(bend.x.mul(2.2).add(0.6), bend.y)));
            const side = vec2(heading.y.negate(), heading.x);
            const length = aBlade.z;
            const t = u.sway;
            const flutter = sin(t.mul(2.4).add(aBlade.w.mul(30.0)).sub(along.mul(5.0))).mul(along).mul(0.11);
            const rise = along.mul(0.32).sub(along.mul(along).mul(0.12)).add(flutter);
            // Wide and ruffled: a kelp blade is a crinkled ribbon, not a leaf.
            const width = float(0.42);
            const ruffle = sin(along.mul(26.0).add(aBlade.w.mul(9.0))).mul(across.abs()).mul(0.05);
            const twist = sin(t.mul(1.1).add(aBlade.w.mul(17.0)).add(along.mul(2.5))).mul(0.65);
            const flat = heading.mul(along.mul(length)).add(side.mul(across.mul(width).mul(cos(twist))));
            return root.add(vec3(flat.x, rise.mul(length).add(across.mul(width).mul(sin(twist))).add(ruffle), flat.y));
        })();
        bladeMaterial.colorNode = Fn(() => {
            const P = positionWorld;
            // Brown at the stipe, amber toward the end and the higher it hangs.
            const young = clamp(vAlong.mul(0.6).add(vHigh.mul(0.5)), 0.0, 1.0);
            const hue = mix(vec3(0.14, 0.075, 0.02), vec3(0.62, 0.36, 0.06), young)
                .mul(vSeed.mul(0.4).add(0.8));
            // A rib down the middle, crinkles across, a darker edge.
            const across = uv().y.mul(2.0).sub(1.0).abs();
            const crinkle = sin(vAlong.mul(70.0).add(across.mul(6.0))).mul(0.08).add(0.92);
            const rib = float(1.0).sub(across);
            const N = normalize(vec3(0.0, 1.0, 0.3));
            const col = leafLight(u, hue.mul(rib.mul(0.3).add(0.72)).mul(crinkle), N, P, young.mul(0.9).add(0.5)).toVar();
            col.addAssign(hue.mul(vRing).mul(1.4).mul(u.breath));
            return vec4(ocFog(u, col, P), 1.0);
        })();
    }
    const leaves = new THREE.Mesh(bladeGeometry, bladeMaterial);
    leaves.name = 'OceanKelpBlades';
    leaves.frustumCulled = false;
    leaves.renderOrder = 6;
    group.add(leaves);

    const part = ocPart('OceanKelp', null, null, 0, { mesh: group });
    part.count = stands.length;
    part.blades = stands.length * bladesPerStand;
    part.dispose = () => {
        stipeGeometry.dispose();
        stipeMaterial.dispose();
        bladeGeometry.dispose();
        bladeMaterial.dispose();
    };
    return part;
}

/**
 * Seagrass: tufts of three blades.
 * @param {object} u
 * @param {Array<{x:number,y:number,z:number,yaw:number,scale:number,seed:number}>} tufts
 */
export function createGrass(u, tufts) {
    const BLADES = 3;
    const SEGMENTS = 4;
    const pos = [];
    const uvs = [];
    const index = [];
    for (let b = 0; b < BLADES; b++) {
        const a = (b / BLADES) * Math.PI * 2 + 0.4;
        const out = [Math.cos(a), Math.sin(a)];
        const base = pos.length / 3;
        for (let s = 0; s <= SEGMENTS; s++) {
            const f = s / SEGMENTS;
            const half = 0.03 * (1 - f * 0.75);
            // Each blade leans out of the tuft a little as it rises.
            const lean = f * f * 0.22;
            pos.push(out[0] * lean - out[1] * half, f, out[1] * lean + out[0] * half);
            pos.push(out[0] * lean + out[1] * half, f, out[1] * lean - out[0] * half);
            uvs.push(b / BLADES, f, b / BLADES, f);
        }
        for (let s = 0; s < SEGMENTS; s++) {
            const i0 = base + s * 2;
            index.push(i0, i0 + 1, i0 + 2, i0 + 2, i0 + 1, i0 + 3);
        }
    }
    const count = Math.max(1, tufts.length);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    const place = new Float32Array(count * 4);
    const more = new Float32Array(count * 4);
    tufts.forEach((g, i) => {
        place.set([g.x, g.y, g.z, g.yaw], i * 4);
        more.set([g.scale, g.seed, 0, 0], i * 4);
    });
    geometry.setAttribute('aPlace', new THREE.InstancedBufferAttribute(place, 4));
    geometry.setAttribute('aMore', new THREE.InstancedBufferAttribute(more, 4));
    geometry.instanceCount = count;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OceanGrass';
    material.side = THREE.DoubleSide;
    material.fog = false;
    material.toneMapped = false;
    const aPlace = attribute('aPlace', 'vec4');
    const aMore = attribute('aMore', 'vec4');
    const vUp = varying(positionGeometry.y, 'vGrassUp');
    const vSeed = varying(aMore.y, 'vGrassSeed');
    const vRing = varying(Fn(() => ocRings(u, vec2(aPlace.x.mul(u.squeeze), aPlace.z)))(), 'vGrassRing');
    material.positionNode = Fn(() => {
        const up = positionGeometry.y;
        const s = sin(aPlace.w);
        const c = cos(aPlace.w);
        const height = aMore.x.mul(0.62);
        const local = vec3(
            positionGeometry.x.mul(c).add(positionGeometry.z.mul(s)),
            up,
            positionGeometry.z.mul(c).sub(positionGeometry.x.mul(s)),
        );
        const bend = ocSway(u, aPlace.x, aMore.y);
        const flex = up.mul(up).mul(height).mul(0.85);
        // Bent over, a blade is no taller than it was long.
        const dip = dot(bend, bend).mul(flex).mul(0.3);
        return vec3(
            aPlace.x.add(local.x.mul(height)).add(bend.x.mul(flex)),
            aPlace.y.add(local.y.mul(height)).sub(dip),
            aPlace.z.add(local.z.mul(height)).add(bend.y.mul(flex)),
        );
    })();
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const hue = mix(vec3(0.03, 0.14, 0.07), vec3(0.3, 0.62, 0.2), vUp.mul(vUp)).mul(vSeed.mul(0.5).add(0.75));
        const N = normalize(vec3(0.0, 1.0, 0.35));
        const col = leafLight(u, hue, N, P, vUp).mul(vUp.mul(0.6).add(0.4)).toVar();
        col.addAssign(hue.mul(vRing).mul(1.6).mul(u.breath));
        return vec4(ocFog(u, col, P), 1.0);
    })();
    const part = ocPart('OceanGrass', geometry, material, 6);
    part.count = tufts.length;
    return part;
}
