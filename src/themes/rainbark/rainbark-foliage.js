/**
 * Rainbark — the foliage: leaves as leaves.
 *
 * The canopy was a picture on a plane, and nothing between the eye and the far crowns had a leaf
 * on it: a eucalyptus forest with no eucalyptus leaves. This hangs them (FOLIAGE in the core):
 *
 *   sprays  drooping eucalyptus sprays hanging into the top of the frame from boughs just out of
 *           it: an arching twig with its side twigs, the sickle leaves hanging from it like a
 *           fringe. They frame the view (the top corners, a few along the top edge, never over the
 *           card's middle), stand in front of the trunks, and give the camera's breath something
 *           near to slide against. Placed across the lens (the same share of any frame) and
 *           wrapped a storey at a time, so every storey of the Climb has its own without one ever
 *           jumping in view.
 *   boughs  the same spray on the trunks themselves (the world tells where they stand: stand):
 *           shoots sprouting from the boles at every height, so the grove behind the card is
 *           trunks in leaf and never a rank of bare poles (none on the Elder's and Sister One's
 *           painted faces), and tufts round every trunk's top, so from the Limb Storey up each
 *           trunk ends in its own crown of leaves in front of the painted canopy.
 *
 * One instanced draw of one spray (built on the CPU from a seed: sprayGeometry). A leaf is a
 * blade of five sections, pointed, curving as it hangs; each swings from its own stalk (its own
 * beat, more in a gust: u.gust) while the whole spray sways. Leaves are lit as leaves: the sun
 * where the canopy's gobo lets it through (rbFleck at the leaf), shining THROUGH a leaf that
 * stands between the eye and the sun (lime, the brightest thing a leaf does), the sky on its
 * upper side, the mist's warm bounce on its under side; old leaves deep green, young ones lime, a
 * few bronze. Opaque, among the solids: the air in front of a far bough veils it as it does a trunk.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    float,
    floor,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CANOPY_Y,
    CLIMB_BASE,
    FOLIAGE,
    STOREY,
    TAU,
    hexToLinear,
    mulberry32,
    rbAir,
    rbFleck,
    rbHash21,
    rbPart,
} from './rainbark-tsl.js';

/** The foliage stands among the solids, after the trunks. */
const FOLIAGE_ORDER = 13;
/** Floats per instance: (across | x, rise | y, depth, scale) and (yaw, tilt, phase, kind). */
export const SPRAY_STRIDE = 8;

const YOUNG = hexToLinear(FOLIAGE.young);
const BRONZE = hexToLinear(FOLIAGE.bronze);
const THROUGH = hexToLinear(FOLIAGE.through);

/**
 * One spray, in its own space (metres; it hangs from the origin, its twig arching out along +x
 * and drooping, its leaves hanging): { position, normal, leafA (stalk xyz, beat), leafB (along
 * 0 … 1, across −1 … 1, tone 0 … 1, 1 on a twig), index }. A pure function of the seed.
 */
export function sprayGeometry(seed = FOLIAGE.seed) {
    const rng = mulberry32(seed);
    const S = FOLIAGE.spray;
    const position = [];
    const normal = [];
    const leafA = [];
    const leafB = [];
    const index = [];
    const push = (p, n, stalk, beat, along, across, tone, twig) => {
        position.push(p[0], p[1], p[2]);
        normal.push(n[0], n[1], n[2]);
        leafA.push(stalk[0], stalk[1], stalk[2], beat);
        leafB.push(along, across, tone, twig);
        return position.length / 3 - 1;
    };
    const norm = (v) => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
    };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

    /** A leaf hanging from `stalk`, leaving it along `out` and turning down as it goes. */
    const leaf = (stalk, out, length, width, tone) => {
        const beat = rng();
        // (Its face turned any way round its own length: some seen flat, some edge on.)
        const spin = rng() * Math.PI * 2;
        const sickle = (rng() - 0.5) * 2 * S.sickle;
        const rows = S.leafProfile.length;
        let p = stalk.slice();
        let prev = null;
        for (let r = 0; r < rows; r++) {
            const s = r / (rows - 1);
            // Its direction: from its stalk's toward straight down, by gravity.
            const k = Math.min(1, s * S.hang + 0.25);
            const d = norm([out[0] * (1 - k) + sickle * s, out[1] * (1 - k) - k, out[2] * (1 - k)]);
            if (r > 0) {
                const step0 = length / (rows - 1);
                p = [p[0] + d[0] * step0, p[1] + d[1] * step0, p[2] + d[2] * step0];
            }
            // Across the blade: a horizontal turned by its spin, kept square to its length.
            const flat = [Math.cos(spin), 0, Math.sin(spin)];
            const side = norm(cross(d, cross(flat, d)));
            const n = norm(cross(side, d));
            const half = (width / 2) * S.leafProfile[r];
            const a = push([p[0] - side[0] * half, p[1] - side[1] * half, p[2] - side[2] * half], n, stalk, beat, s, -1, tone, 0);
            const b = push([p[0] + side[0] * half, p[1] + side[1] * half, p[2] + side[2] * half], n, stalk, beat, s, 1, tone, 0);
            if (prev) index.push(prev[0], prev[1], a, a, prev[1], b);
            prev = [a, b];
        }
    };

    /** A twig from `from` along `dir`, drooping, a ribbon `thick` wide, its leaves hanging from it. */
    const twig = (from, dir, length, leaves, thick, depth) => {
        const steps = S.twigSteps;
        let p = from.slice();
        let prev = null;
        const up = [0, 1, 0];
        for (let j = 0; j <= steps; j++) {
            const s = j / steps;
            const d = norm([dir[0], dir[1] - S.droop * s * s * 2, dir[2]]);
            if (j > 0) {
                const step0 = length / steps;
                p = [p[0] + d[0] * step0, p[1] + d[1] * step0, p[2] + d[2] * step0];
            }
            const side = norm(cross(d, up));
            const half = (thick / 2) * (1 - 0.6 * s);
            const n = norm(cross(side, d));
            const a = push([p[0] - side[0] * half, p[1] - side[1] * half, p[2] - side[2] * half], n, p, 0, s, -1, 0, 1);
            const b = push([p[0] + side[0] * half, p[1] + side[1] * half, p[2] + side[2] * half], n, p, 0, s, 1, 0, 1);
            if (prev) index.push(prev[0], prev[1], a, a, prev[1], b);
            prev = [a, b];
            // Leaves along it (none at its very root), alternately to either side.
            const want = Math.round(leaves * s) - Math.round(leaves * Math.max(0, (j - 1) / steps));
            for (let m = 0; m < want && j > 0; m++) {
                const turn = (rng() < 0.5 ? 1 : -1) * (0.6 + 0.8 * rng());
                const out = norm([d[0] * 0.5 + side[0] * turn, d[1] * 0.5 - 0.2 * rng(), d[2] * 0.5 + side[2] * turn]);
                // (Young leaves toward a twig's tip: lime, a few bronze.)
                const tone = Math.min(1, Math.max(0, s * 0.7 + (rng() - 0.35) * 0.6));
                leaf(p, out, S.leaf[0] + (S.leaf[1] - S.leaf[0]) * rng(), S.leafWidth[0] + (S.leafWidth[1] - S.leafWidth[0]) * rng(), tone);
            }
            // Side twigs off the main one.
            if (depth === 0 && j > 0 && j < steps && rng() < S.branch) {
                const turn = rng() < 0.5 ? 1 : -1;
                const out = norm([d[0] * 0.6 + side[0] * turn * 0.8, d[1] * 0.6 + 0.15, d[2] * 0.6 + side[2] * turn * 0.8]);
                twig(p, out, length * (0.35 + 0.3 * rng()), Math.round(leaves * 0.45), thick * 0.6, 1);
            }
        }
    };
    twig([0, 0, 0], norm([1, 0.12, 0]), S.length, S.leaves, S.thick, 0);
    return {
        position: new Float32Array(position),
        normal: new Float32Array(normal),
        leafA: new Float32Array(leafA),
        leafB: new Float32Array(leafB),
        index,
    };
}

/**
 * The instances for a tier: `near` sprays hanging into the top of the frame (across the lens, a
 * storey's own, wrapped), then `crown` bough slots (empty until the world stands them on the
 * trunks: writeBoughs). Seeded.
 */
export function sprayRecords(near, crown, seed = FOLIAGE.seed) {
    const n = Math.max(0, Math.round(near) || 0);
    const c = Math.max(0, Math.round(crown) || 0);
    const data = new Float32Array((n + c) * SPRAY_STRIDE);
    const rng = mulberry32((seed * 31 + 7) >>> 0);
    const N = FOLIAGE.near;
    for (let i = 0; i < n; i++) {
        // Two clumps, one in either top corner (every prefix frames the view); none over the card
        // (a spray sliding down behind it as the walkway climbs would cross the board).
        const corner = true;
        const leftSide = i % 2 === 0;
        // (Gathered toward a clump's heart: a bough's sprays, never an even fringe.)
        const f = (rng() + rng()) / 2;
        const across = corner
            ? (leftSide ? -1 : 1) * (N.corner[0] + (N.corner[1] - N.corner[0]) * f)
            : (rng() * 2 - 1) * N.edge;
        const depth = N.depth[0] + (N.depth[1] - N.depth[0]) * rng() * rng();
        const rise = (corner ? N.rise[0] + (N.rise[1] - N.rise[0]) * rng() : N.riseEdge) + 0.03 * rng();
        const scale = N.scale[0] + (N.scale[1] - N.scale[0]) * rng();
        // (Its twig comes down into the frame, pointing in toward its middle, a little toward or
        // away from the eye.)
        const yaw = (across > 0 ? Math.PI : 0) + (rng() - 0.5) * 1.7;
        const tilt = -(N.tilt[0] + (N.tilt[1] - N.tilt[0]) * rng());
        // (The last of them hang only up in the crowns: kind 0.5.)
        const kind = i >= Math.round(n * (1 - N.high)) ? 0.5 : 0;
        data.set([across, rise, depth, scale, yaw, tilt, rng() * TAU, kind], i * SPRAY_STRIDE);
    }
    return { data, near: n, crown: c };
}

/**
 * Stand the boughs on the trunks that stand, written into `data` after its `near` sprays. The
 * first FOLIAGE.shoots share of them are shoots on the boles: leafy sprays sprouting from the
 * trunks at every height, so no trunk in the grove is a bare pole; the rest are the crowns: tufts
 * round every trunk's top under the canopy's plane.
 *
 * `trunks` is [{ depth, hero }] (metres in front of the eye; `hero` on the Elder and Sister One,
 * whose painted faces stay clear: no shoots on them), `axisAt(i, y, out)` writes trunk i's axis
 * (x, z, radius) at a height. A shoot keeps its place on its trunk and is wrapped up or down by a
 * whole number of its trunk's periods to stand near the eye's height `camY`; a period is taller
 * than the lens sees at that depth (SHOOT.period), so no shoot ever wraps in view. A pure function
 * of its arguments and the seed; with no trunks every bough is collapsed (scale 0).
 */
export function writeBoughs(data, near, boughs, trunks, camY, axisAt, seed = FOLIAGE.seed) {
    const C = FOLIAGE.crown;
    const S = FOLIAGE.shoot;
    const count = trunks.length;
    const shoots = Math.round(boughs * FOLIAGE.shoots);
    const axis = [0, 0, 0];
    // (The trunks that carry shoots: every one but the heroes with painted faces.)
    let plain = 0;
    for (let i = 0; i < count; i++) if (!trunks[i].hero) plain += 1;
    for (let i = 0; i < boughs; i++) {
        const o = (near + i) * SPRAY_STRIDE;
        const isShoot = i < shoots;
        if (!count || (isShoot && !plain)) {
            data.fill(0, o, o + SPRAY_STRIDE);
            data[o + 7] = 1;
            continue;
        }
        const rng = mulberry32((seed * 131 + i * 2654435761) >>> 0);
        let pick = i % (isShoot ? plain : count);
        let at = 0;
        if (isShoot) {
            for (at = 0; at < count; at++) {
                if (trunks[at].hero) continue;
                if (pick === 0) break;
                pick -= 1;
            }
        } else at = pick;
        const trunk = trunks[at];
        const angleSeed = rng();
        let y;
        let out;
        let scale;
        let tilt;
        if (isShoot) {
            // Its own place in its trunk's period, wrapped to stand near the eye's height.
            const period = Math.max(S.period[0], trunk.depth * S.period[1] + S.period[2]);
            const base = rng() * period;
            y = base + period * Math.round((camY - base) / period);
            out = S.out[0] + (S.out[1] - S.out[0]) * rng();
            // (Larger far off: a spray must read as leaves from a hundred metres.)
            scale = (S.scale[0] + (S.scale[1] - S.scale[0]) * rng()) * Math.min(S.far[1], 1 + trunk.depth / S.far[0]);
            tilt = -(S.tilt[0] + (S.tilt[1] - S.tilt[0]) * rng());
            // (Never up in the crowns' own storey, where the tufts are.)
            if (y > CANOPY_Y - 6) scale = 0;
        } else {
            const high = rng();
            y = CANOPY_Y - (C.under[0] + (C.under[1] - C.under[0]) * high * high);
            // (The crown is widest a little under its top.)
            out = C.out[0] + (C.out[1] - C.out[0]) * rng() * (1 - 0.5 * high);
            scale = C.scale[0] + (C.scale[1] - C.scale[0]) * rng();
            tilt = -(C.tilt[0] + (C.tilt[1] - C.tilt[0]) * rng());
        }
        axisAt(at, y, axis);
        // Round the side of the bole the eye sees (a shoot behind its trunk is leaves nobody sees).
        const toEye = Math.atan2(-axis[1], -axis[0]);
        const angle = toEye + (angleSeed - 0.5) * 2 * (isShoot ? S.arc : Math.PI);
        const r = axis[2] + out;
        data[o] = axis[0] + Math.cos(angle) * r;
        data[o + 1] = y;
        data[o + 2] = -(axis[1] + Math.sin(angle) * r);
        data[o + 3] = scale;
        // (The spray's twig runs along its own +x: turned to point away from the bole.)
        data[o + 4] = -angle + (rng() - 0.5) * 1.2;
        data[o + 5] = tilt;
        data[o + 6] = rng() * TAU;
        data[o + 7] = 1;
    }
}

/**
 * The foliage's draw.
 * @param {object} u     the shared uniforms (with textures)
 * @param {object} tier  the content tier (sprays, boughs)
 */
export function createFoliage(u, tier = {}) {
    const records = sprayRecords(tier.sprays, tier.boughs);
    const spray = sprayGeometry();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(spray.position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(spray.normal, 3));
    geometry.setAttribute('aLeafA', new THREE.BufferAttribute(spray.leafA, 4));
    geometry.setAttribute('aLeafB', new THREE.BufferAttribute(spray.leafB, 4));
    geometry.setIndex(spray.index);
    const buffer = new THREE.InstancedInterleavedBuffer(records.data, SPRAY_STRIDE, 1);
    buffer.setUsage(THREE.DynamicDrawUsage);
    writeBoughs(records.data, records.near, records.crown, [], 0, null);
    geometry.setAttribute('aSprayA', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geometry.setAttribute('aSprayB', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    geometry.instanceCount = records.near + records.crown;

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'RainbarkFoliage';
    material.fog = false;
    const aLeafA = attribute('aLeafA', 'vec4');
    const aLeafB = attribute('aLeafB', 'vec4');
    const aNormal = attribute('normal', 'vec3');
    const aA = attribute('aSprayA', 'vec4');
    const aB = attribute('aSprayB', 'vec4');
    const vWorld = varying(vec3(0.0), 'rbLeafWorld');
    const vLeaf = varying(vec4(0.0), 'rbLeafAt');
    const vSun = varying(vec3(0.0), 'rbLeafSun');
    const vSky = varying(vec3(0.0), 'rbLeafSky');
    const F = FOLIAGE;

    material.positionNode = Fn(() => {
        const crown = step(0.75, aB.w).toVar();
        // (A spray of the crowns' storeys grows in as the walkway climbs into them.)
        const highK = step(0.25, aB.w).mul(float(1.0).sub(crown));
        const grown = mix(float(1.0), smoothstep(F.near.highFrom[0], F.near.highFrom[1], u.camY), highK);
        const scale = aA.w.mul(grown);
        const twigK = aLeafB.w;
        const along = aLeafB.x;
        // A leaf swings from its stalk on its own beat (more in a gust), across its own face.
        const beat = aLeafA.w;
        const rate = mix(float(F.swing.rate[0]), float(F.swing.rate[1]), beat);
        const swing = sin(u.time.mul(rate).add(beat.mul(41.0)).add(aB.z))
            .mul(float(F.swing.amp).mul(u.gust.mul(F.swing.gust).add(1.0)))
            .mul(float(1.0).sub(twigK));
        const reach = positionGeometry.sub(aLeafA.xyz);
        const local = positionGeometry.add(aNormal.mul(swing.mul(along)).mul(dot(reach, reach).sqrt())).toVar();
        // The whole spray sways from where it hangs (its tip most).
        const sway = sin(u.time.mul(F.sway.rate).add(aB.z)).mul(F.sway.amp).mul(u.gust.mul(F.sway.gust).add(1.0));
        local.z.addAssign(sway.mul(local.x.mul(local.x)));
        local.y.addAssign(sway.mul(0.4).mul(local.x.abs()));
        // A storey's spray is hung by the lens (u.lens: the frame's top and foot edges as slopes):
        // from the same share of the frame's height on any frame, and at a depth where the frame
        // is no taller than on the reference lens, so an upright phone's taller view never sees
        // more of a storey than a wide one's.
        const W = F.near.wrap;
        const band = u.lens.x.add(u.lens.y);
        const depth = aA.z.mul(float(W.lens[0] + W.lens[1]).div(band)).toVar();
        const rise = aA.y.mul(u.lens.x.div(W.lens[0])).toVar();
        // (It goes up to the next storey only once the walkway has climbed far enough past it that
        // it hangs under the frame's foot, and by then its next place is still over the frame's
        // top: FOLIAGE.near.wrap. It never jumps in view.)
        const wrapAt = clamp(rise.add(u.lens.y).mul(depth).add(aA.w.mul(W.hang)), W.range[0], W.range[1]);
        const storeyN = floor(u.camY.sub(CLIMB_BASE).sub(wrapAt).div(STOREY)).add(1.0).toVar();
        const storey = storeyN.mul(STOREY).add(CLIMB_BASE);
        // Every storey hangs them its own way (hashed from the storey and the spray: FOLIAGE.near.vary).
        const { vary } = F.near;
        const sprayId = floor(aB.z.mul(1000.0));
        const h1 = rbHash21(vec2(sprayId, storeyN.add(64.0)));
        const h2 = rbHash21(vec2(sprayId.add(37.0), storeyN.add(64.0)));
        const own = float(1.0).sub(crown);
        const side = aA.x.sign();
        const across = side.mul(clamp(aA.x.abs().add(h1.sub(0.5).mul(vary.across)), F.near.corner[0], F.near.corner[1] + 0.06));
        const yaw = aB.x.add(h2.sub(0.5).mul(vary.yaw).mul(own));
        const tilt = aB.y.add(h1.sub(0.5).mul(vary.tilt).mul(own));
        // Tilted (about its own z: the twig lifted or dropped), then turned about the vertical.
        const ct = cos(tilt);
        const st = sin(tilt);
        const cy = cos(yaw);
        const sy = sin(yaw);
        const turn = (v) => {
            const tx = v.x.mul(ct).sub(v.y.mul(st));
            const ty = v.x.mul(st).add(v.y.mul(ct));
            return vec3(tx.mul(cy).add(v.z.mul(sy)), ty, v.z.mul(cy).sub(tx.mul(sy)));
        };
        // Where it hangs: a storey's own spray across the lens (wrapped a storey at a time), or a
        // bough's place under the canopy.
        const nearAt = vec3(across.mul(depth).mul(u.tanHalf.x), storey.add(rise.mul(depth)), depth.negate());
        const crownAt = vec3(aA.x, aA.y, aA.z.negate());
        const origin = mix(nearAt, crownAt, crown).toVar();
        const P = origin.add(turn(local).mul(scale)).toVar();
        const N = normalize(turn(aNormal)).toVar();
        // Its light, per vertex. The sun where the canopy lets it through, on whichever face it
        // meets; through the blade when the eye is on its other side (the lime of a backlit leaf).
        const V = normalize(cameraPosition.sub(P));
        const nl = dot(N, u.sunDir).toVar();
        const nv = dot(N, V).toVar();
        const fl = rbFleck(u, P, { lod: 'fixed' }).mul(u.fleckLight);
        // (Dappled: a leaf in a fleck is lit, one beside it stands in the crowns' shade.)
        const sunK = mix(u.fleckMean.mul(u.fleckLight), fl, F.light.dapple).toVar();
        const sameSide = step(0.0, nl.mul(nv));
        const front = abs(nl).mul(sameSide).mul(F.light.front);
        const through = abs(nl).mul(0.6).add(0.4).mul(float(1.0).sub(sameSide))
            .mul(F.light.through);
        vSun.assign(vec3(front.mul(sunK), through.mul(sunK), 0.0));
        // The sky on what faces up, the mist's warm glow on what faces down (the face the eye sees).
        const facing = N.y.mul(mix(float(-1.0), float(1.0), step(0.0, nv))).toVar();
        vSky.assign(u.col.sky.mul(facing.mul(0.5).add(0.5).mul(F.light.sky))
            .add(u.col.underglow.mul(facing.negate().mul(0.5).add(0.5).mul(F.light.glow))));
        vWorld.assign(P);
        vLeaf.assign(aLeafB);
        return P;
    })();

    material.colorNode = Fn(() => {
        const across = clamp(vLeaf.y, -1.0, 1.0);
        const tone = clamp(vLeaf.z, 0.0, 1.0);
        const twigK = step(0.5, vLeaf.w);
        const along = clamp(vLeaf.x, 0.0, 1.0);
        // Old leaves deep green (the zone's crown colour, lifted), young ones lime, a few bronze.
        const old = u.col.crown.mul(F.albedo);
        const young = vec3(...YOUNG);
        const leaf = mix(mix(old, young, smoothstep(0.4, 0.85, tone)), vec3(...BRONZE), smoothstep(0.95, 0.99, tone)).toVar();
        // A blade, never a flat chip: a darker midrib, its two halves a step apart in tone (it is
        // folded a little along the rib), darker toward its stalk, a satin streak of sky beside
        // the rib.
        const B = F.blade;
        const rib = float(1.0).sub(float(1.0).sub(smoothstep(0.0, 0.22, abs(across))).mul(F.rib));
        const fold = step(0.0, across).mul(B.fold * 2).add(1.0 - B.fold);
        const stalk = mix(float(1.0 - B.base), float(1.0), smoothstep(0.0, 0.7, along));
        const blade = rib.mul(fold).mul(stalk);
        const albedo = mix(leaf.mul(blade), vec3(...hexToLinear(F.twig)), twigK).toVar();
        const sun = u.sunCol.mul(vSun.x);
        // (Through the blade the sun comes out the leaf's own lime, brighter than any lit face.)
        const through = u.sunCol.mul(vec3(...THROUGH)).mul(vSun.y).mul(float(1.0).sub(twigK)).mul(blade);
        const streak = float(1.0).sub(smoothstep(0.0, 0.2, abs(across.sub(0.38)))).mul(B.sheen).mul(float(1.0).sub(twigK));
        const lit = albedo.mul(sun.add(vSky)).add(leaf.mul(through)).add(vSky.mul(streak));
        return vec4(max(rbAir(u, lit, vWorld, null, { billows: 0 }), vec3(0.0)), 1.0);
    })();

    const part = rbPart('RainbarkFoliage', geometry, material, FOLIAGE_ORDER);
    part.near = records.near;
    part.crown = records.crown;
    part.data = records.data;
    /** Stand the boughs on the trunks that stand, for an eye at `camY` (writeBoughs). */
    part.stand = (trunks, camY, axisAt) => {
        if (!records.crown) return;
        writeBoughs(records.data, records.near, records.crown, trunks, camY, axisAt);
        buffer.needsUpdate = true;
    };
    return part;
}
