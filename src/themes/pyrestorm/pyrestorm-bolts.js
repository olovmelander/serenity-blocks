/**
 * Pyrestorm — volcanic lightning.
 *
 * A bolt is a slot of three uniform rows (its cloud end and birth; its far end and power; its
 * colour, kind and seed) and a handful of instanced ribbons (its channel and its branches) whose
 * jagged paths are built in the vertex stage from the seed: a sum of three piecewise-linear noise
 * octaves across the channel, tapered at the ends, so the same bolt is the same shape in every
 * frame and every replay. Ribbons face the eye and are a few pixels wide at any range, with a
 * soft halo.
 *
 * Kinds: 0 a cloud-to-ground stroke (its leader steps down in TIMING.leader, then ONE return
 * stroke that decays: never a strobe), 1 "spider" lightning crawling along the anvil's underside
 * (grows over half a second, a soft glow, no flash), 2 the discharge (a great branched stroke).
 * The world mirrors the same envelope on the CPU to light the cloud and the land (boltEnvelope).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cross,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    uniformArray,
    vec2,
    vec3,
    vec4,
    varying,
} from 'three/tsl';
import { TIMING, mulberry32 } from './pyrestorm-core.js';
import { pyHash21 } from './pyrestorm-tsl.js';

export const BOLT_SLOTS = 8;
export const BOLT = Object.freeze({ ground: 0, spider: 1, discharge: 2 });
/** Seconds a bolt of each kind lives. */
export const BOLT_LIFE = Object.freeze([1.4, 2.6, 2.2]);
const SEGMENTS = 30;

/**
 * A bolt's brightness at an age (the same curve the shader draws): the leader's faint growth,
 * then one return stroke with an afterglow; a spider swells and fades. 0..~1.3.
 */
export function boltEnvelope(kind, age) {
    if (!(age >= 0)) return 0;
    if (kind === BOLT.spider) {
        return Math.min(1, age / 0.18) * Math.exp(-age / 0.85) * 0.55;
    }
    const leader = TIMING.leader * (kind === BOLT.discharge ? 1.6 : 1);
    if (age < leader) return 0.18 * (age / leader);
    const a = age - leader;
    return Math.exp(-a / 0.075) + 0.32 * Math.exp(-a / (kind === BOLT.discharge ? 0.7 : 0.42));
}

/**
 * The light a bolt throws on the cloud and the land: a swell and a slow fade (no spike), so a run
 * of bolts lights the storm as one sustained glow, never a strobe (photosensitivity: the thin
 * channel keeps its sharp stroke, the large lit area does not flicker).
 */
export function boltLightEnvelope(kind, age) {
    if (!(age >= 0)) return 0;
    if (kind === BOLT.spider) return Math.min(1, age / 0.25) * Math.exp(-age / 0.9) * 0.5;
    const leader = TIMING.leader * (kind === BOLT.discharge ? 1.6 : 1);
    const a = Math.max(0, age - leader * 0.5);
    return Math.min(1, a / 0.12) * Math.exp(-a / (kind === BOLT.discharge ? 0.75 : 0.5)) * 0.8;
}

/** How far a bolt's channel has grown (0..1). */
export function boltGrowth(kind, age) {
    if (kind === BOLT.spider) return Math.min(1, Math.max(0, age / 0.55));
    const leader = TIMING.leader * (kind === BOLT.discharge ? 1.6 : 1);
    return Math.min(1, Math.max(0, age / leader));
}

export function createBolts(u, tier) {
    const strands = Math.max(3, Math.floor(tier.bolts / BOLT_SLOTS));
    const count = BOLT_SLOTS * strands;
    const random = mulberry32(0xb017);
    // Per strand: (slot, strand, branch start along the channel, branch length share).
    const data = new Float32Array(count * 4);
    for (let s = 0; s < BOLT_SLOTS; s++) {
        for (let k = 0; k < strands; k++) {
            const i = (s * strands + k) * 4;
            data[i] = s;
            data[i + 1] = k;
            data[i + 2] = k === 0 ? 0 : 0.12 + random() * 0.62;
            data[i + 3] = k === 0 ? 1 : 0.14 + random() * 0.3;
        }
    }
    const tables = Array.from({ length: BOLT_SLOTS * 3 }, () => new THREE.Vector4(0, 0, 0, 0));
    const rows = uniformArray(tables, 'vec4');
    const geometry = new THREE.PlaneGeometry(1, 1, 1, SEGMENTS);
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
    geometry.setAttribute('aStrand', new THREE.InstancedBufferAttribute(data, 4));
    const strand = attribute('aStrand', 'vec4');
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PyrestormBolts';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    // vec4(rgb, 0) adds rgb only with premultiplied alpha (else the blend multiplies by alpha 0).
    material.premultipliedAlpha = true;
    // A jagged ribbon folds where its channel doubles back on screen: both faces must draw.
    material.side = THREE.DoubleSide;
    material.fog = false;
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);

    /** Piecewise-linear noise in [−1, 1] along x. */
    const jag = (x, sd) => {
        const i = floor(x);
        const f = fract(x);
        const a = pyHash21(vec2(i, sd)).mul(2.0).sub(1.0);
        const b = pyHash21(vec2(i.add(1.0), sd)).mul(2.0).sub(1.0);
        return mix(a, b, f);
    };
    const slotRows = () => {
        const base = int(floor(strand.x.add(0.5))).mul(3);
        const r0 = rows.element(base);
        const r1 = rows.element(base.add(1));
        const r2 = rows.element(base.add(2));
        return {
            A: r0.xyz, birth: r0.w, B: r1.xyz, power: r1.w, rgb: r2.xyz, kind: floor(r2.w), seed: fract(r2.w).mul(97.0),
        };
    };
    /**
     * The channel (or a branch) at s. The jag is three octaves of piecewise-linear noise whose
     * slopes stay under ~0.6 (kinks of tens of degrees, never right angles), tapered at the ends;
     * a branch forks off the channel at its own fraction and runs onward and aside, jagged less.
     */
    const pathAt = (b, s) => {
        const AB = b.B.sub(b.A);
        const L = length(AB).max(1.0);
        const T = AB.div(L);
        const e1 = normalize(cross(T, u.camFwd).add(vec3(1e-4, 0.0, 0.0)));
        const e2 = cross(T, e1);
        const isBranch = strand.y.greaterThan(0.5);
        const sd = b.seed.add(strand.y.mul(13.7));
        const mainAt = (x) => {
            const tp = sin(clamp(x, 0.0, 1.0).mul(Math.PI)).max(0.0).sqrt();
            const jj = jag(x.mul(5.0), b.seed).mul(0.06).add(jag(x.mul(12.0), b.seed.add(1.0)).mul(0.022))
                .add(jag(x.mul(26.0), b.seed.add(2.0)).mul(0.008));
            const kk = jag(x.mul(6.0), b.seed.add(3.0)).mul(0.03);
            return b.A.add(AB.mul(x)).add(e1.mul(jj.mul(L).mul(tp))).add(e2.mul(kk.mul(L).mul(tp)));
        };
        const main = mainAt(s);
        // A branch: leaves the channel at s0 and forks off onward and aside.
        const s0 = strand.z;
        const start = mainAt(s0);
        const side = pyHash21(vec2(sd, 4.1)).greaterThan(0.5).select(float(1.0), float(-1.0));
        const dir = normalize(T.mul(0.9).add(e1.mul(side.mul(0.5))).add(e2.mul(pyHash21(vec2(sd, 7.7)).sub(0.5).mul(0.3))));
        const bl = L.mul(strand.w);
        const btaper = sin(clamp(s, 0.0, 1.0).mul(Math.PI * 0.5)).max(0.0).sqrt();
        const bj = jag(s.mul(6.0), sd).mul(0.07).add(jag(s.mul(15.0), sd.add(1.0)).mul(0.02));
        const branch = start.add(dir.mul(bl.mul(s))).add(e1.mul(bj.mul(bl).mul(btaper)));
        return isBranch.select(branch, main);
    };
    const growthOf = (kind, age) => {
        const leader = kind.equal(2.0).select(float(TIMING.leader * 1.6), float(TIMING.leader));
        return kind.equal(1.0).select(clamp(age.div(0.55), 0.0, 1.0), clamp(age.div(leader), 0.0, 1.0));
    };
    const envelopeOf = (kind, age) => {
        const leader = kind.equal(2.0).select(float(TIMING.leader * 1.6), float(TIMING.leader));
        const a = age.sub(leader).max(0.0);
        const after = kind.equal(2.0).select(float(0.7), float(0.42));
        const stroke = age.lessThan(leader).select(age.div(leader).mul(0.18), exp(a.div(-0.075)).add(exp(a.div(after).negate()).mul(0.32)));
        const spider = clamp(age.div(0.18), 0.0, 1.0).mul(exp(age.div(-0.85))).mul(0.55);
        return kind.equal(1.0).select(spider, stroke);
    };
    const vS = varying(float(0.0), 'vPyBoltS');
    material.vertexNode = Fn(() => {
        const b = slotRows();
        const s = positionGeometry.y.add(0.5);
        const p = pathAt(b, s);
        const p2 = pathAt(b, s.add(0.012));
        const viewP = cameraViewMatrix.mul(vec4(p, 1.0));
        const view2 = cameraViewMatrix.mul(vec4(p2, 1.0));
        const t = view2.xy.sub(viewP.xy);
        const tl = length(t);
        const across0 = tl.greaterThan(1e-5).select(vec2(t.y.negate(), t.x).div(tl.max(1e-5)), vec2(1.0, 0.0));
        // Keep the ribbon's sides consistent along the stroke (no twist where a tooth turns back):
        // orient each vertex's "across" with the stroke's overall screen direction.
        const vA = cameraViewMatrix.mul(vec4(b.A, 1.0)).xy;
        const vB = cameraViewMatrix.mul(vec4(b.B, 1.0)).xy;
        const main2 = vB.sub(vA);
        const mainAcross = vec2(main2.y.negate(), main2.x);
        const across = across0.dot(mainAcross).lessThan(0.0).select(across0.negate(), across0);
        const depth = viewP.z.negate().max(1.0);
        // Twenty pixels of halo at any range (the core is drawn inside it).
        const width = u.pixelAngle.mul(depth).mul(20.0);
        vS.assign(s);
        const live = b.power.greaterThan(0.0).and(u.time.sub(b.birth).greaterThanEqual(0.0));
        const clip = cameraProjectionMatrix.mul(viewP.add(vec4(across.mul(positionGeometry.x.mul(width)), 0.0, 0.0)));
        return live.select(clip, vec4(0.0, 0.0, -2.0, 1.0));
    })();
    const vX = varying(positionGeometry.x, 'vPyBoltX');
    material.outputNode = Fn(() => {
        const b = slotRows();
        const age = u.time.sub(b.birth);
        const { kind } = b;
        const isBranch = strand.y.greaterThan(0.5);
        // The channel shows as far as the leader has grown; a branch once the leader passes its fork.
        const grow = growthOf(kind, age);
        const reach = isBranch.select(grow.sub(strand.z).div(strand.w.max(0.05)), grow);
        const shown = float(1.0).sub(smoothstep(reach.sub(0.03), reach, vS));
        const env = envelopeOf(kind, age);
        const x = vX.mul(2.0);
        // Core (a couple of pixels) inside a halo.
        const core = exp(x.mul(x).mul(-650.0));
        const halo = exp(x.mul(x).mul(-26.0)).mul(0.18).add(exp(x.mul(x).mul(-5.0)).mul(0.05));
        const profile = core.mul(2.4).add(halo);
        const tipFade = float(1.0).sub(vS).max(0.0);
        const branchDim = isBranch.select(tipFade.mul(tipFade).mul(0.55), float(1.0));
        // The core whitens only while the stroke is bright; a fading channel keeps the storm's hue.
        const white = mix(b.rgb, vec3(1.6, 1.6, 1.7).mul(max(b.rgb.x, max(b.rgb.y, b.rgb.z)).mul(0.6)), core.mul(0.6).mul(smoothstep(0.08, 0.5, env)));
        const rgb = white.mul(profile).mul(env).mul(b.power).mul(branchDim)
            .mul(shown);
        return vec4(rgb, 0.0);
    })();
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'PyrestormBolts';
    mesh.frustumCulled = false;
    mesh.renderOrder = 26;
    return {
        mesh,
        meshes: [mesh],
        tables,
        rows,
        strands,
        dispose() {
            geometry.dispose();
            material.dispose();
            mesh.dispose?.();
        },
    };
}
