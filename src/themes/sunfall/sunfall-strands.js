/**
 * Sunfall — the hanging garden either side of the card: lianas, their leaves, and the blossoms
 * of locks.
 *
 * Aerial roots and lianas hang from the vault near the eye, a few metres to tens of metres
 * away, on both sides of the card: woody ribbons turned to face the eye (each with a thin
 * tendril beside it), never thinner than about a pixel and a half, mossed, braided, catching the
 * sunfall's light on the side turned toward it, swaying in the cave's breath and kicked when a
 * piece locks (harder on a hard drop: the Snap) on their side. They carry sprays of drip-tipped
 * leaves of their own.
 *
 * Every lock opens four young leaves on the strand on its side, one at each cell's row height,
 * in the piece's own pigment (the Flush), and one blossom of that pigment among them. The leaves
 * mature over seconds (delayed greening: piece colour → bronze → emerald), at once when their row
 * is cleared (Ripening at the rows); a blossom whose row is cleared bursts (its petals are the
 * flora's, sunfall-flora.js), and one left alone wilts in its own time. Leaves and blossoms live
 * in rings of instance slots; the oldest are reused.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    fract,
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    pow,
    select,
    sin,
    smoothstep,
    uv,
    vec2,
    vec3,
    pow2, pow3,
} from 'three/tsl';
import {
    BACKLIT_LEAF_RGB, MATURE_LEAF_RGB, OCULUS_CENTER, clamp01, mulberry32,
} from './sunfall-core.js';
import { pieceSwatchNode, sfSunMask } from './sunfall-tsl.js';
import { BOARD_VIEWPORT, projectWorldToNdc } from './sunfall-composition.js';
import { flatVarying } from '../shared/flat-varying.js';

const BRONZE = [0.300, 0.110, 0.040];
const ROWS = 20;
/** A blossom left alone wilts after this long (seconds). */
export const BLOSSOM_LIFE = 46;

/** The strand's sway at `t` (0 at its top, 1 at its foot), shared by strands, leaves and blossoms. */
function swayAt(u, t, phase, side) {
    // Its rest shape: a lean away from the vault and two slow curves, from the phase.
    const lean = vec3(sin(phase.mul(3.1)).mul(2.2), 0.0, cos(phase.mul(2.3)).mul(1.4)).mul(t.mul(t));
    const curve = vec3(sin(t.mul(2.6).add(phase)).mul(0.9), 0.0, sin(t.mul(1.7).add(phase.mul(1.9))).mul(0.6)).mul(t);
    // The cave's breath, on a clock that quickens and a sway that widens as play heats.
    const wind = sin(u.windClock.mul(0.55).add(phase).add(t.mul(2.2))).mul(0.55)
        .add(sin(u.windClock.mul(1.3).add(phase.mul(1.7)).add(t.mul(5.0))).mul(0.12));
    const amp = t.mul(t).mul(1.5).mul(u.windGain);
    // Locks and Snaps kick the strands on their own side: a damped wave down the strand. Each
    // side keeps its own kick, so alternating locks sway both curtains (the lianas, side 0, none).
    const kick = select(side.lessThan(-0.5), u.kick.x, select(side.greaterThan(0.5), u.kick.y, float(0.0)));
    const wave = sin(t.mul(9.0).sub(u.time.mul(11.0))).mul(kick).mul(t);
    return vec3(amp.mul(wind).add(wave), 0.0, amp.mul(wind).mul(0.4).add(wave.mul(0.3))).add(lean).add(curve);
}

/** Which way the sunfall stands from a point near the eye (unit, in the horizontal plane). */
const TO_COLUMN = (() => {
    const len = Math.hypot(OCULUS_CENTER[0], OCULUS_CENTER[2]) || 1;
    return [OCULUS_CENTER[0] / len, OCULUS_CENTER[2] / len];
})();

export function createStrandMaterial(u) {
    const A = attribute('aStrandA', 'vec4'); // x, topY, z, length
    const B = attribute('aStrandB', 'vec4'); // width, phase, side, seed
    const vertex = Fn(() => {
        const t = clamp(float(0.5).sub(positionGeometry.y), 0.0, 1.0);
        const base = vec3(A.x, A.y.sub(t.mul(A.w)), A.z).add(swayAt(u, t, B.y, B.z)).toVar();
        const toCam = cameraPosition.sub(base);
        const dist = length(toCam);
        const side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
        // Tapers to a root tip; never under about a pixel and a half wide.
        const tip = float(1.0).sub(smoothstep(0.82, 1.0, t).mul(0.7));
        const width = max(B.x.mul(float(1.0).sub(t.mul(0.35))).mul(tip), dist.mul(u.pixelAngle).mul(1.4));
        return base.add(side.mul(positionGeometry.x.mul(width)));
    })();
    const color = Fn(() => {
        const across = clamp(uv().x, 0.0, 1.0).mul(2.0).sub(1.0);
        const t = clamp(float(1.0).sub(uv().y), 0.0, 1.0);
        const round = clamp(float(1.0).sub(across.mul(across)), 0.0, 1.0).sqrt();
        const seed = B.w;
        // Two stems wound round each other, mossed in patches, wet in places.
        const metres = t.mul(A.w);
        const braid = sin(metres.mul(5.2).add(across.mul(2.6)).add(seed.mul(40.0))).mul(0.5).add(0.5);
        const moss = smoothstep(0.42, 0.72, fract(sin(metres.mul(0.37).add(seed.mul(91.0))).mul(43758.5)));
        const bark = mix(vec3(0.085, 0.062, 0.04), vec3(0.04, 0.085, 0.03), moss.mul(0.75))
            .mul(mix(0.7, 1.1, braid));
        // The cave's cool light from all round, and the sunfall's on the side turned toward it
        // (the eye looks down -z: the column stands to the left of every strand but the far-left).
        const ambient = u.mistTint.mul(0.75).add(u.bounceVault.mul(0.3)).mul(round.mul(0.75).add(0.25));
        const toward = clamp(across.negate().mul(0.9).add(0.1), 0.0, 1.0);
        const rim = u.beamScatter.mul(toward.mul(toward).mul(0.85)).mul(u.sunGain);
        return bark.mul(ambient.add(rim));
    })();
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = vertex;
    material.colorNode = color;
    material.side = THREE.DoubleSide;
    return material;
}

export function createLeafMaterial(u) {
    const A = attribute('aLeafA', 'vec4'); // x, y, z at rest, scale
    const B = attribute('aLeafB', 'vec4'); // t on strand, strand phase, side, yaw
    const C = attribute('aLeafC', 'vec4'); // code (-1 a mature leaf of the strand), birth, tau, ripenAt
    const outward = Fn(() => {
        const yaw = B.w.add(sin(u.time.mul(2.7).add(B.w.mul(9.0))).mul(0.12));
        return vec3(cos(yaw), 0.0, sin(yaw));
    });
    const vertex = Fn(() => {
        const age = u.time.sub(C.y);
        const k = clamp(age.div(0.45), 0.0, 1.0);
        // Ease out with overshoot: the bud snaps open.
        const c1 = 1.70158;
        const back = float(1.0).add(pow3(k.sub(1.0)).mul(c1 + 1)).add(pow2(k.sub(1.0)).mul(c1));
        const open = select(C.x.lessThan(-0.5), float(1.0), clamp(back, 0.0, 1.2));
        const size = A.w.mul(open);
        const out = outward().toVar();
        const along = normalize(out.mul(0.6).add(vec3(0.0, -0.8, 0.0)));
        const across = vec3(out.z.negate(), 0.0, out.x);
        const attach = vec3(A.x, A.y, A.z).add(swayAt(u, B.x, B.y, B.z));
        const lx = positionGeometry.x;
        const ly = positionGeometry.y.negate();
        // The blade arches: it leaves the strand outward and droops toward its tip.
        const droop = ly.mul(ly).mul(size).mul(0.28);
        return attach.add(along.mul(ly.mul(size))).add(across.mul(lx.mul(size).mul(0.62)))
            .add(out.mul(ly.mul(size).mul(0.22))).add(vec3(0.0, droop.negate(), 0.0));
    })();
    const shape = Fn(() => {
        const st = uv();
        const along = clamp(float(1.0).sub(st.y), 0.0, 1.0);
        // A heart of a leaf: widest a third of the way down, drawn out to a drip tip.
        const half = sin(pow(along, 0.62).mul(Math.PI)).mul(0.48).mul(float(1.0).sub(pow(along, 5.0).mul(0.55)));
        const x = abs(st.x.sub(0.5));
        const aa = max(fwidth(st.x), 1e-4);
        return smoothstep(half.add(aa), half.sub(aa), x);
    });
    // The sun on the leaf and how it faces the column, read once at its stem (flat).
    const sunOn = flatVarying(sfSunMask(u, vec3(A.x, A.y, A.z)), 'sfLeafSun');
    const facing = flatVarying(dot(outward().xz, vec2(TO_COLUMN[0], TO_COLUMN[1])), 'sfLeafFacing');
    const color = Fn(() => {
        const st = uv();
        const code = C.x;
        const along = clamp(float(1.0).sub(st.y), 0.0, 1.0);
        const age = max(u.time.sub(C.y), 0.0);
        const g = max(float(1.0).sub(exp(age.div(max(C.z, 1.0)).negate())), smoothstep(C.w, C.w.add(1.2), u.time));
        const young = pieceSwatchNode(max(code, 0.0));
        const toBronze = mix(young, vec3(...BRONZE), smoothstep(0.3, 0.65, g).mul(0.6));
        const piece = mix(toBronze, vec3(...MATURE_LEAF_RGB), smoothstep(0.45, 1.0, g));
        const own = vec3(...MATURE_LEAF_RGB).mul(mix(0.55, 1.1, fract(B.w.mul(17.0))));
        const albedo = select(code.lessThan(-0.5), own, piece).toVar();
        // A midrib, side veins, a paler tip, a gloss band across the blade's shoulder.
        const off = abs(st.x.sub(0.5));
        const midrib = smoothstep(0.035, 0.0, off).mul(0.3);
        const veins = smoothstep(0.75, 1.0, sin(along.mul(26.0).sub(off.mul(34.0)))).mul(0.1);
        const form = mix(0.72, 1.12, along).mul(float(1.0).sub(midrib).sub(veins));
        const gloss = smoothstep(0.16, 0.0, abs(along.sub(0.32))).mul(smoothstep(0.02, 0.2, off)).mul(0.5);
        // The cave's light from all round; the sunfall's on leaves turned toward it, and through
        // the ones turned away (backlit, bright yellow-green); the sun itself where it reaches.
        const ambient = u.mistTint.mul(0.95).add(u.bounceVault.mul(0.45)).mul(u.skyGain.mul(0.5).add(0.5));
        const toward = clamp(facing.mul(0.5).add(0.5), 0.0, 1.0);
        const column = u.beamScatter.mul(mix(0.25, 1.0, toward).mul(0.9)).mul(u.sunGain);
        const through = vec3(...BACKLIT_LEAF_RGB).mul(float(1.0).sub(toward).mul(0.3).add(sunOn.mul(0.6)))
            .mul(u.sunGain);
        return albedo.mul(form).mul(ambient.add(column).add(u.beamCore.mul(sunOn.mul(1.6))))
            .add(through.mul(form))
            .add(u.skyZenith.mul(gloss).mul(0.22));
    })();
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = vertex;
    material.colorNode = color;
    material.opacityNode = shape();
    material.alphaTest = 0.5;
    material.side = THREE.DoubleSide;
    return material;
}

/** The blossom a lock opens: five petals of the piece's pigment round a pale heart. */
export function createBlossomMaterial(u) {
    const A = attribute('aBloomA', 'vec4'); // x, y, z at rest, scale
    const B = attribute('aBloomB', 'vec4'); // t on strand, strand phase, side, seed
    const C = attribute('aBloomC', 'vec4'); // code, birth, end (it bursts or wilts from here), _
    const vertex = Fn(() => {
        const age = u.time.sub(C.y);
        const k = clamp(age.div(0.55), 0.0, 1.0);
        const c1 = 1.70158;
        const back = float(1.0).add(pow3(k.sub(1.0)).mul(c1 + 1)).add(pow2(k.sub(1.0)).mul(c1));
        // It opens with a snap and closes quickly when its time comes.
        const open = clamp(back, 0.0, 1.25).mul(float(1.0).sub(smoothstep(C.z, C.z.add(0.5), u.time)));
        const size = A.w.mul(open);
        const attach = vec3(A.x, A.y, A.z).add(swayAt(u, B.x, B.y, B.z)).toVar();
        const toCam = normalize(cameraPosition.sub(attach));
        const right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
        const up = cross(toCam, right);
        // It nods on its stalk, and turns a little as the strand sways.
        const nod = sin(u.time.mul(1.3).add(B.w.mul(40.0))).mul(0.16).add(B.w.sub(0.5).mul(1.4));
        const rx = right.mul(cos(nod)).add(up.mul(sin(nod)));
        // Turned a little away from the eye, each by its own amount: an oval, never a disc.
        const ry = up.mul(cos(nod)).sub(right.mul(sin(nod))).mul(mix(0.62, 0.95, fract(B.w.mul(7.0))));
        // On a short stalk, off the strand on the side away from the card.
        const off = right.mul(select(B.z.lessThan(0.0), float(-1.0), float(1.0)).mul(A.w).mul(0.45));
        return attach.add(off).add(rx.mul(positionGeometry.x.mul(size))).add(ry.mul(positionGeometry.y.mul(size)));
    })();
    const polar = Fn(() => {
        const p = uv().sub(0.5).mul(2.0);
        const r = length(p);
        const a = atan(p.y, p.x).add(B.w.mul(6.283));
        // Five petals: broad rounded lobes with a notch between them, no two the same length.
        const lobe = abs(cos(a.mul(2.5)));
        const uneven = sin(a.mul(5.0).add(B.w.mul(50.0))).mul(0.045);
        return vec3(r, lobe, float(0.46).add(pow(lobe, 0.42).mul(0.48)).add(uneven));
    });
    const sunOn = flatVarying(sfSunMask(u, vec3(A.x, A.y, A.z)), 'sfBloomSun');
    const color = Fn(() => {
        const pr = polar().toVar();
        const r = pr.x;
        const pigment = pieceSwatchNode(max(C.x, 0.0)).toVar();
        // Petals: a deep throat, the full pigment at mid-length, a paler rim; each one shaded
        // into the notch beside it (they overlap), with fine veins running out from the throat.
        const p = uv().sub(0.5).mul(2.0);
        const depth = smoothstep(0.06, 0.62, r);
        const veins = sin(atan(p.y, p.x).mul(34.0)).mul(0.5).add(0.5).mul(smoothstep(0.2, 0.7, r))
            .mul(0.12);
        const petal = pigment.mul(mix(0.3, 1.0, depth)).add(vec3(0.16).mul(smoothstep(0.62, 1.0, r)))
            .mul(mix(0.6, 1.04, smoothstep(0.0, 0.55, pr.y)))
            .mul(float(1.0).sub(veins));
        // A small gold heart with a pale star of stamens.
        const heart = mix(vec3(1.0, 0.78, 0.2), vec3(1.0, 0.95, 0.74), smoothstep(0.03, 0.1, r));
        const albedo = mix(heart, petal, smoothstep(0.09, 0.15, r));
        // Lit like the leaves beside it (the cave from all round, the sunfall from its side:
        // the petals toward the light brighter), and a little by itself: a fresh blossom shows
        // its colour in the cave's shade (it is the mark of a piece, read at a glance).
        const side = clamp(p.x.negate().mul(0.35).add(p.y.mul(0.25)).add(0.75), 0.0, 1.0);
        const ambient = u.mistTint.mul(0.85).add(u.bounceVault.mul(0.45)).add(vec3(0.3));
        const light = ambient.add(u.beamScatter.mul(side.mul(0.75)).mul(u.sunGain)).add(u.beamCore.mul(sunOn.mul(1.4)));
        return albedo.mul(light);
    })();
    const shape = Fn(() => {
        const pr = polar();
        const aa = max(fwidth(pr.x), 1e-4);
        return smoothstep(pr.z.add(aa), pr.z.sub(aa), pr.x);
    });
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = vertex;
    material.colorNode = color;
    material.opacityNode = shape();
    material.alphaTest = 0.5;
    material.side = THREE.DoubleSide;
    return material;
}

/**
 * Build the strands, their leaves and blossoms. Returns `{ group, update(snap), anchorAt, dispose() }`.
 * `strands` comes from the plan (`planDoline().curtains`), `leafSlots` and `blossomSlots` from the
 * quality tier.
 */
export function buildStrands(world, {
    strands, leafSlots = 256, blossomSlots = 40, leaves = true, width = [0.07, 0.3], name = 'sunfall-strands',
}) {
    const { u } = world;
    const group = new THREE.Group();
    group.name = name;
    const rng = mulberry32(world.seed ^ 0x5157);
    const disposables = [];

    // ── Strands: each with a thin tendril beside it (the leafless rim lianas hang single) ──
    const tendrils = leaves ? strands.map((s) => ({
        ...s,
        x: s.x + (rng() - 0.5) * 0.9,
        z: s.z + (rng() - 0.5) * 0.9,
        topY: s.topY + 2,
        length: s.length * (0.55 + rng() * 0.4),
        swayPhase: s.swayPhase + 0.6 + rng(),
        thin: true,
    })) : [];
    const drawn = [...strands, ...tendrils];
    const count = Math.max(0, drawn.length);
    const strandGeo = new THREE.PlaneGeometry(1, 1, 1, 80);
    strandGeo.deleteAttribute('normal');
    const sa = new Float32Array(count * 4);
    const sb = new Float32Array(count * 4);
    drawn.forEach((s, i) => {
        sa.set([s.x, s.topY, s.z, s.length], i * 4);
        const w = s.thin ? 0.025 + rng() * 0.04 : width[0] + rng() * rng() * (width[1] - width[0]);
        sb.set([w, s.swayPhase, s.side, rng()], i * 4);
    });
    strandGeo.setAttribute('aStrandA', new THREE.InstancedBufferAttribute(sa, 4));
    strandGeo.setAttribute('aStrandB', new THREE.InstancedBufferAttribute(sb, 4));
    const strandMat = createStrandMaterial(u);
    const strandMesh = new THREE.InstancedMesh(strandGeo, strandMat, Math.max(1, count));
    strandMesh.count = count;
    strandMesh.frustumCulled = false;
    strandMesh.renderOrder = 1;
    group.add(strandMesh);
    disposables.push(strandGeo, strandMat);

    if (!leaves) {
        return {
            group,
            update() {},
            anchorAt: () => null,
            strandMesh,
            dispose() {
                disposables.forEach((d) => d.dispose());
            },
        };
    }

    // ── Leaves ──
    const slots = Math.max(16, leafSlots);
    const leafGeo = new THREE.PlaneGeometry(1, 1, 2, 4);
    leafGeo.translate(0, -0.5, 0);
    leafGeo.deleteAttribute('normal');
    const la = new Float32Array(slots * 4);
    const lb = new Float32Array(slots * 4);
    const lc = new Float32Array(slots * 4);
    const attrA = new THREE.InstancedBufferAttribute(la, 4).setUsage(THREE.DynamicDrawUsage);
    const attrB = new THREE.InstancedBufferAttribute(lb, 4).setUsage(THREE.DynamicDrawUsage);
    const attrC = new THREE.InstancedBufferAttribute(lc, 4).setUsage(THREE.DynamicDrawUsage);
    leafGeo.setAttribute('aLeafA', attrA);
    leafGeo.setAttribute('aLeafB', attrB);
    leafGeo.setAttribute('aLeafC', attrC);
    const leafMat = createLeafMaterial(u);
    const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, slots);
    leafMesh.frustumCulled = false;
    leafMesh.renderOrder = 2;
    group.add(leafMesh);
    disposables.push(leafGeo, leafMat);

    const slotRows = new Float32Array(slots).fill(-1);
    let cursor = 0;
    let ambientCount = 0;
    const writeLeaf = (slot, strandIndex, t, {
        code = -1, birth = -100, tau = 18, scale = 0.6, row = -1, yaw = null,
    }) => {
        const s = strands[strandIndex];
        const y = s.topY - t * s.length;
        const turn = yaw ?? (s.side < 0 ? 0 : Math.PI) + (rng() - 0.5) * 2.4;
        la.set([s.x, y, s.z, scale], slot * 4);
        lb.set([t, s.swayPhase, s.side, turn], slot * 4);
        lc.set([code, birth, tau, 1e6], slot * 4);
        slotRows[slot] = row;
    };
    const markDirty = () => {
        attrA.needsUpdate = true;
        attrB.needsUpdate = true;
        attrC.needsUpdate = true;
    };

    // The strands' own mature leaves: sprays of two to four at a node, all round the stem.
    const seedAmbient = () => {
        ambientCount = strands.length > 0 ? Math.floor(slots * 0.6) : 0;
        let k = 0;
        while (k < ambientCount) {
            const si = Math.floor(rng() * strands.length);
            const t = 0.12 + rng() * 0.84;
            const spray = Math.min(ambientCount - k, 2 + Math.floor(rng() * 3));
            const around = rng() * Math.PI * 2;
            for (let j = 0; j < spray; j += 1) {
                writeLeaf(k, si, clamp01(t + j * 0.006), {
                    code: -1,
                    scale: 0.42 + rng() * 0.62,
                    yaw: around + j * 2.1 + (rng() - 0.5) * 0.8,
                });
                k += 1;
            }
        }
        for (let i = ambientCount; i < slots; i += 1) {
            la.set([0, -1000, 0, 0], i * 4);
            lc.set([0, -100, 18, 1e6], i * 4);
            slotRows[i] = -1;
        }
        // Locks write into the slots past the strands' own leaves, never over them.
        cursor = ambientCount;
        markDirty();
    };
    const nextSlot = () => {
        const slot = cursor;
        cursor += 1;
        if (cursor >= slots) cursor = ambientCount;
        return slot;
    };

    // ── Blossoms ──
    const blooms = Math.max(4, blossomSlots);
    const bloomGeo = new THREE.PlaneGeometry(1, 1);
    bloomGeo.deleteAttribute('normal');
    const ba = new Float32Array(blooms * 4);
    const bb = new Float32Array(blooms * 4);
    const bc = new Float32Array(blooms * 4);
    const bloomA = new THREE.InstancedBufferAttribute(ba, 4).setUsage(THREE.DynamicDrawUsage);
    const bloomB = new THREE.InstancedBufferAttribute(bb, 4).setUsage(THREE.DynamicDrawUsage);
    const bloomC = new THREE.InstancedBufferAttribute(bc, 4).setUsage(THREE.DynamicDrawUsage);
    bloomGeo.setAttribute('aBloomA', bloomA);
    bloomGeo.setAttribute('aBloomB', bloomB);
    bloomGeo.setAttribute('aBloomC', bloomC);
    const bloomMat = createBlossomMaterial(u);
    const bloomMesh = new THREE.InstancedMesh(bloomGeo, bloomMat, blooms);
    bloomMesh.frustumCulled = false;
    bloomMesh.renderOrder = 2;
    group.add(bloomMesh);
    disposables.push(bloomGeo, bloomMat);
    const bloomRows = new Float32Array(blooms).fill(-1);
    let bloomCursor = 0;
    const clearBlooms = () => {
        for (let i = 0; i < blooms; i += 1) {
            ba.set([0, -1000, 0, 0], i * 4);
            bc.set([0, -100, -90, 0], i * 4);
            bloomRows[i] = -1;
        }
        bloomCursor = 0;
        bloomA.needsUpdate = true;
        bloomB.needsUpdate = true;
        bloomC.needsUpdate = true;
    };
    clearBlooms();
    seedAmbient();

    // Which strands a side's leaves go to: the two nearest the card, alternately.
    const sideStrands = { [-1]: [], 1: [] };
    strands.forEach((s, i) => sideStrands[s.side < 0 ? -1 : 1].push(i));
    const nearCard = (i) => Math.abs(projectWorldToNdc([strands[i].x, 0, strands[i].z], world.rig, world.aspect).x);
    Object.values(sideStrands).forEach((list) => list.sort((a, b) => nearCard(a) - nearCard(b)));
    const sideTurn = { [-1]: 0, 1: 0 };

    /** World height on strand `i` whose projection lands at board row `row`. */
    const heightForRow = (i, row) => {
        const s = strands[i];
        const vp = world.boardViewport || BOARD_VIEWPORT;
        // The playfield fills the card's lower part (its header holds the next piece and score).
        const top = vp.ndcTop - (vp.ndcTop - vp.ndcBottom) * 0.16;
        const bottom = vp.ndcBottom + (vp.ndcTop - vp.ndcBottom) * 0.03;
        const target = top - ((row + 0.5) / ROWS) * (top - bottom);
        let lo = s.topY - s.length;
        let hi = s.topY;
        for (let it = 0; it < 26; it += 1) {
            const mid = (lo + hi) * 0.5;
            const ndc = projectWorldToNdc([s.x, mid, s.z], world.rig, world.aspect).y;
            if (ndc > target) hi = mid; else lo = mid;
        }
        return clamp01((s.topY - (lo + hi) * 0.5) / s.length);
    };

    /**
     * Where a side's strand hangs at a board row: `[x, y, z]` at rest (the flora sheds its petals
     * and beads from here), or null when that side has no strand.
     */
    const anchorAt = (side, row) => {
        const list = sideStrands[side < 0 ? -1 : 1];
        if (!list.length) return null;
        const pick = list[Math.abs(Math.round(row)) % Math.min(2, list.length)];
        const s = strands[pick];
        const t = heightForRow(pick, Math.max(0, Math.min(ROWS - 1, row)));
        return [s.x, s.topY - t * s.length, s.z];
    };

    let session = -1;
    let lastLock = 0;
    let lastClear = 0;
    const update = (snap) => {
        if (!snap) return;
        if (snap.sessionSerial !== session) {
            session = snap.sessionSerial;
            lastLock = 0;
            lastClear = 0;
            seedAmbient();
            clearBlooms();
        }
        let dirty = false;
        let bloomDirty = false;
        for (const ev of snap.lockEvents || []) {
            if (ev.serial <= lastLock) continue;
            lastLock = ev.serial;
            const side = ev.u < 0.5 ? -1 : 1;
            const list = sideStrands[side].length ? sideStrands[side] : sideStrands[-side];
            if (!list.length) continue;
            const pick = list[(sideTurn[side] += 1) % Math.min(2, list.length)];
            const code = Math.max(0, ['I', 'O', 'T', 'S', 'Z', 'J', 'L'].indexOf(ev.code));
            let rowSum = 0;
            for (let j = 0; j < ev.cells.length; j += 1) {
                const cell = ev.cells[j];
                rowSum += cell.row;
                const t = heightForRow(pick, cell.row);
                writeLeaf(nextSlot(), pick, t, {
                    code,
                    birth: ev.time + j * (ev.hard ? 0.02 : 0.05),
                    tau: 16 + rng() * 6,
                    scale: (ev.hard ? 1.05 : 0.95) + rng() * 0.25,
                    row: cell.row,
                });
            }
            dirty = true;
            // One blossom of the piece's pigment among its leaves, at the middle of its rows.
            const row = ev.cells.length ? rowSum / ev.cells.length : 12;
            const s = strands[pick];
            const t = heightForRow(pick, row);
            const slot = bloomCursor;
            bloomCursor = (bloomCursor + 1) % blooms;
            ba.set([s.x, s.topY - t * s.length, s.z, 0.82 + rng() * 0.3], slot * 4);
            bb.set([t, s.swayPhase, s.side, rng()], slot * 4);
            bc.set([code, ev.time + 0.08, ev.time + BLOSSOM_LIFE, 0], slot * 4);
            bloomRows[slot] = row;
            bloomDirty = true;
        }
        for (const ev of snap.clearEvents || []) {
            if (ev.serial <= lastClear) continue;
            lastClear = ev.serial;
            const rows = new Set(ev.rows.map((r) => Math.round(r)));
            for (let k = 0; k < slots; k += 1) {
                if (slotRows[k] >= 0 && rows.has(Math.round(slotRows[k]))) lc[k * 4 + 3] = ev.time;
            }
            dirty = true;
            // A blossom on a cleared row bursts (four lines take every blossom there is).
            for (let k = 0; k < blooms; k += 1) {
                const at = bloomRows[k];
                if (at < 0) continue;
                const hit = ev.lines >= 4 || [...rows].some((r) => Math.abs(r - at) <= 0.75);
                if (hit && bc[k * 4 + 2] > ev.time) {
                    bc[k * 4 + 2] = ev.time;
                    bloomDirty = true;
                }
            }
        }
        if (dirty) markDirty();
        if (bloomDirty) {
            bloomA.needsUpdate = true;
            bloomB.needsUpdate = true;
            bloomC.needsUpdate = true;
        }
    };

    return {
        group,
        update,
        anchorAt,
        leafMesh,
        bloomMesh,
        strandMesh,
        dispose() {
            disposables.forEach((d) => d.dispose());
        },
    };
}
