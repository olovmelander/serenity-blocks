/**
 * Spring — the cumulus over the fells.
 *
 * Heaped spring cumulus standing over the valley's far end, their tops in the sun, their bases
 * flat and grey. A flat deck seen at a grazing angle is a row of dashes, so each bank on the
 * horizon is one camera-facing card, a heap of billows (sphere impostors along a flat base,
 * towers above it) united by their height above the card and eroded at the edges by the lattice
 * noise. Each billow carries its own normal, so a bank is lit like a solid: the sun's side
 * bright, the base and the shadowed side grey, a silver lining where the heap is thin and the sun
 * stands behind. Adapted from High Coast's banks (high-coast-cumulus.js).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cos,
    positionWorld,
    sin,
    clamp,
    dot,
    exp,
    float,
    floor,
    int,
    max,
    mix,
    normalize,
    smoothstep,
    sqrt,
    uniformArray,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { DEG, mulberry32 } from './spring-core.js';
import { EYE } from './spring-plan.js';
import { noise3 } from './spring-tsl.js';
import { skyColour } from './spring-light.js';

/** Billows per bank. */
const BILLOWS = 26;
/** The soft union's width (in bank widths): billows flow into each other instead of creasing. */
const SOFT = 0.018;

/** The banks: bearing (degrees right of the view axis), distance, base height, width, height. */
export function cumulusBanks(count = 9, seed = 0x5c0b) {
    const random = mulberry32(seed);
    const banks = [];
    // Spread round the horizon; one stands over the fells down the valley on the right.
    const bearings = [-27, -8, 12, 31, -46, 46, 2, -62, 60, -18, 22, 70].slice(0, count);
    for (let i = 0; i < bearings.length; i++) {
        banks.push({
            bearing: bearings[i] + (random() - 0.5) * 6,
            // Far and low, so they stand on the horizon as a bank of heaps (the far plane is 26 km).
            distance: 15000 + random() * 8000,
            base: 800 + random() * 350,
            width: 5500 + random() * 4500,
            height: 1500 + random() * 1700,
            seed: random(),
        });
    }
    return banks;
}

/**
 * The billows of a bank in its own frame (x across 0..1 of its width, y up in widths), every one
 * kept inside its card: a flat-bottomed base row, a middle mass, towers off-centre, and small
 * turrets crowning them (the cauliflower).
 */
function billowsFor(bank, random) {
    const out = [];
    const aspect = bank.height / bank.width;
    const inside = (x, y, r) => [
        Math.min(1 - r - 0.07, Math.max(r + 0.07, x)),
        Math.min(aspect - r - 0.06, Math.max(r * 0.55, y)),
        r,
    ];
    const baseCount = 8;
    for (let k = 0; k < baseCount; k++) {
        const r = 0.05 + random() * 0.035;
        out.push(inside(0.12 + (0.76 * k) / (baseCount - 1) + (random() - 0.5) * 0.05, r * 0.6, r));
    }
    const centre = 0.32 + random() * 0.36;
    const midCount = 8;
    for (let k = 0; k < midCount; k++) {
        const r = 0.05 + random() * 0.035;
        const across = centre + (k / (midCount - 1) - 0.5) * 0.5 + (random() - 0.5) * 0.08;
        out.push(inside(across, aspect * (0.22 + random() * 0.22), r));
    }
    const towers = 6;
    for (let k = 0; k < towers; k++) {
        const r = 0.04 + random() * 0.03;
        out.push(inside(centre + (random() - 0.5) * 0.3, aspect * (0.45 + 0.4 * ((k + random()) / towers)), r));
    }
    for (let k = out.length; k < BILLOWS; k++) {
        const r = 0.022 + random() * 0.02;
        out.push(inside(centre + (random() - 0.5) * 0.36, aspect * (0.35 + 0.6 * random()), r));
    }
    return out;
}

export function createCumulus(u, t, tier, count = 9) {
    const banks = cumulusBanks(count);
    const random = mulberry32(0xb111);
    const rows = [];
    const positions = [];
    const uvs = [];
    const cards = [];
    const index = [];
    banks.forEach((bank, b) => {
        const a = bank.bearing * DEG;
        // Each billow row carries its bank's bearing (the bank's frame for lighting).
        for (const [x, y, r] of billowsFor(bank, random)) rows.push(new THREE.Vector4(x, y, r, a));
        const cx = EYE.x + Math.sin(a) * bank.distance;
        const cz = EYE.z - Math.cos(a) * bank.distance;
        // The card faces the eye: its right is the horizontal tangent of the bearing.
        const rx = Math.cos(a);
        const rz = Math.sin(a);
        const w = bank.width;
        const h = bank.height;
        const base = positions.length / 3;
        const corners = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]];
        for (const [sx, sy] of corners) {
            positions.push(cx + rx * w * sx, bank.base + h * sy, cz + rz * w * sx);
            uvs.push(sx + 0.5, sy);
            cards.push(b, w, h, bank.seed);
        }
        index.push(base, base + 2, base + 1, base, base + 3, base + 2);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('aCard', new THREE.Float32BufferAttribute(cards, 4));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();

    const billows = uniformArray(rows, 'vec4');
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SpringCumulus';
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.fog = false;
    const card = attribute('aCard', 'vec4');
    const st = attribute('uv', 'vec2');
    material.colorNode = Fn(() => {
        const id = int(floor(card.x.add(0.5)));
        const w = card.y;
        const h = card.z;
        const aspect = h.div(w);
        // The bank's frame: x across 0..1, y up in widths.
        const p = vec2(st.x, st.y.mul(aspect));
        // The billows' soft union: a log-sum-exp of their heights over the card, and the normal
        // as the same weights' blend of each billow's own (a sphere's) normal.
        const sum = float(0.0).toVar();
        const nrmSum = vec3(0.0).toVar();
        // How far inside the nearest billow (widths; negative outside): the lumps that reach out
        // past the union die off with it, so no cloud grows where no billow is.
        const reach = float(-1.0).toVar();
        for (let k = 0; k < BILLOWS; k++) {
            const b = billows.element(id.mul(BILLOWS).add(k));
            const d = p.sub(b.xy);
            const r2 = b.z.mul(b.z);
            const z = sqrt(max(r2.sub(dot(d, d)), 0.0));
            reach.assign(max(reach, b.z.sub(d.length())));
            const weight = exp(z.div(SOFT).min(40.0)).mul(z.greaterThan(0.0).select(1.0, 0.0));
            sum.addAssign(weight);
            nrmSum.addAssign(vec3(d, z.max(0.004)).div(b.z).mul(weight));
        }
        const top = sum.max(1e-6).log().mul(SOFT).max(0.0)
            .mul(sum.greaterThan(1e-6).select(1.0, 0.0))
            .toVar();
        const nrm = normalize(nrmSum.add(vec3(0.0, 0.0, 1e-4))).toVar();
        // Flat base: the heap is cut a little above its row's centres.
        const floorCut = smoothstep(0.035, 0.07, p.y);
        // Edges eroded by three octaves of the lattice (billowing, drifting slowly).
        const q = vec3(p.mul(16.0), card.w.mul(37.0).add(u.time.mul(0.012)));
        const n = noise3(t.lattice, q);
        const n2 = noise3(t.lattice, q.mul(2.7).add(5.3));
        const n3 = noise3(t.lattice, q.mul(7.1).add(11.9));
        // Lumps both ways round the outline, finer toward the crown; and in the light, the noise's
        // slope bends the normal into cauliflower lobes.
        const crownward = smoothstep(0.1, 0.6, p.y.div(aspect));
        // Billowy erosion (the noise folded about its middle): rounded lumps, never a circle.
        const b1 = n.x.sub(0.5).abs().mul(2.0);
        const b2 = n2.y.sub(0.5).abs().mul(2.0);
        const edge = top.add(b1.sub(0.45).mul(0.05)).add(b2.sub(0.45).mul(0.028))
            .add(n3.x.sub(0.5).mul(crownward.mul(0.016).add(0.006)))
            .add(reach.min(0.0).mul(1.5));
        const alpha = smoothstep(0.0, 0.035, edge).mul(floorCut).toVar();
        const nx = noise3(t.lattice, q.add(vec3(0.3, 0.0, 0.0))).x.sub(n.x);
        const ny = noise3(t.lattice, q.add(vec3(0.0, 0.3, 0.0))).x.sub(n.x);
        const nx2 = noise3(t.lattice, q.mul(2.7).add(vec3(5.6, 5.3, 5.3))).y.sub(n2.y);
        const ny2 = noise3(t.lattice, q.mul(2.7).add(vec3(5.3, 5.6, 5.3))).y.sub(n2.y);
        nrm.assign(normalize(nrm.add(vec3(nx, ny, 0.0).mul(-1.5)).add(vec3(nx2, ny2, 0.0).mul(-0.9))));
        // Lighting in the bank's frame: right, up, and out toward the eye.
        const bearing = billows.element(id.mul(BILLOWS)).w;
        const right = vec3(cos(bearing), 0.0, sin(bearing));
        const out = vec3(sin(bearing).negate(), 0.0, cos(bearing));
        const sunCard = vec3(dot(u.sunDir, right), u.sunDir.y, dot(u.sunDir, out));
        // Cloud is lit softly through itself: a wide wrap, the heap's form more than each lump's.
        const lambert = clamp(dot(nrm, sunCard).mul(0.5).add(0.5), 0.0, 1.0);
        const height = clamp(p.y.div(aspect), 0.0, 1.0);
        // The base is flat and darker; the sides take the sky's blue.
        const shade = mix(
            u.cloudShade.mul(0.85),
            u.cloudShade.mul(1.35).add(u.fill.mul(0.6)),
            smoothstep(0.0, 0.5, height),
        );
        // The banks stand high over the valley: they keep the sun as long as the sky does.
        const lit = u.cloudLit.mul(lambert).mul(u.day.mul(0.85).add(0.15));
        // The crowns catch the most light (they stand in the sun above the others' shadow).
        const crown = smoothstep(0.35, 1.0, height).mul(0.35).add(0.8);
        const body = mix(shade, lit.mul(crown), smoothstep(0.18, 0.92, lambert)).toVar();
        // Silver lining: thin edges glow when the sun stands behind the bank.
        const behind = clamp(sunCard.z.negate(), 0.0, 1.0);
        const thin = exp(top.mul(-28.0));
        body.addAssign(u.glow.mul(thin).mul(behind).mul(1.6));
        // The air: tens of kilometres of it, taking the sky's own colour along this line.
        const along = normalize(positionWorld.sub(u.eye));
        const air = skyColour(u, along, { withSun: false });
        const col = mix(body, air, float(0.24).sub(height.mul(0.1)));
        return vec4(col, alpha.mul(0.97));
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'SpringCumulus';
    mesh.frustumCulled = false;
    mesh.renderOrder = 11;
    return {
        mesh,
        meshes: [mesh],
        banks,
        update() {},
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
