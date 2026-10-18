/**
 * Grainfields — Lapporten, the Lapland gate, on the horizon.
 *
 * Lapporten (Čuonjávággi, "the goose valley") near Abisko is a glacial trough cut clean through
 * the fells: Nissuntjårro (1738 m) on one side and Tjuonatjåkka (1554 m) on the other, 2.1 km
 * apart, the lake Čuonjájávri lying in the U between them at 950 m, the walls of Seve–Köli
 * amphibolite steep and cirqued. Seen down the trough from the low land in front of it, its
 * silhouette is the gate:
 *
 *  - the left fell rises from far off in one long gentle back to a broad, nearly level summit
 *    plateau, which ends at a sharp lip and drops in a cliffed wall into the U;
 *  - the U itself: a wide flat floor high above the plain, the sky through it;
 *  - the right fell climbs out of the U in a steep wall to a pointed shoulder, then runs on in a
 *    long ridge rising to a higher summit and falling away beyond it.
 *
 * The fells stand in the gate's own frame (across the trough, and along it toward the eye): the
 * cross-section is the silhouette at the gate; in front of it the faces fall away to the plain in
 * long concave skirts, with gullies down the fall line and cirques under the summits. One mesh of
 * that height field. Birch on the skirts, heath above, scree and rock on the steep faces, the last
 * snow lying in the cirques and gullies.
 *
 * Unlit, lit by the shared light: the deck's gaps throw shafts of sun onto the faces, the haze of
 * twelve kilometres of air lies over them, the high faces keep the afterglow after sunset.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    float,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    smoothstep,
    texture,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import { EYE, PLACES, smooth } from './grainfields-core.js';
import { aerial, lightSurface } from './grainfields-light.js';

const G = PLACES.gate;
/** The gate's frame: unit vectors toward the eye (along the trough) and to the eye's right. */
const AXIS = (() => {
    const dx = EYE.x - G.x;
    const dz = EYE.z - G.z;
    const d = Math.hypot(dx, dz);
    return Object.freeze({ toEye: [dx / d, dz / d], right: [dz / d, -dx / d] });
})();

/**
 * The gate drawn larger than life: the silhouette below is authored at Lapporten's own size (the
 * fells 1500–1750 m over the plain, the U's floor 640 m up and 2.1 km across between the lips), then
 * stretched by `across` and raised by `up`, so from twelve kilometres it fills the left of the
 * sky as the user asked: a bigger massif and a wider gap.
 */
export const SIZE = Object.freeze({ across: 1.3, up: 1.5 });

/**
 * The silhouette's numbers (model metres; heights over the plain). `floor` the U's floor and its
 * half-width; the left fell's wall top, plateau end and the far end of its back; the right fell's
 * wall top, shoulder, ridge summit and the far end of its fall.
 */
export const GATE = Object.freeze({
    floor: 640,
    floorHalf: 520,
    left: Object.freeze({
        top: 1700, wall: 1380, plateau: 3900, hump: 6200, back: 10800,
    }),
    right: Object.freeze({
        shoulder: 1500, wall: 1330, dip: 2500, summit: 1760, ridge: 7200, crest: 9800, fall: 20000,
    }),
    /** How far the faces run out toward the eye (to the plain), and behind the gate. */
    front: 5200,
    behind: 2600,
    /** The mesh's extent across (left, right) and along (behind, in front). */
    span: Object.freeze([-11500, 20500]),
    depth: Object.freeze([-6000, 6200]),
});

// ── Small numbers ──────────────────────────────────────────────────────────────────

function hash2(i, j) {
    let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ 0x51ed27;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1. */
function vnoise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy) + (hash2(ix + 1, iy) - hash2(ix, iy)) * sx;
    const b = hash2(ix, iy + 1) + (hash2(ix + 1, iy + 1) - hash2(ix, iy + 1)) * sx;
    return a + (b - a) * sy;
}

function fbm(x, y) {
    return 0.55 * vnoise(x, y) + 0.3 * vnoise(x * 2.03 + 7.1, y * 2.03 - 3.3) + 0.15 * vnoise(x * 4.1 - 1.7, y * 4.1 + 5.9);
}

// ── The silhouette and the faces ──────────────────────────────────────────────────

/** The cross-section at the gate (metres over the plain) at `c` metres across (right +). */
export function gateProfile(c) {
    const { floor, floorHalf } = GATE;
    const base = floor + 40;
    if (c <= 0) {
        const L = GATE.left;
        const s = -c;
        if (s <= floorHalf) return floor + 40 * (s / floorHalf) ** 2;
        if (s <= L.wall) {
            // The U's wall: easing up off the floor, near vertical under the lip.
            return base + (L.top - base) * ((s - floorHalf) / (L.wall - floorHalf)) ** 2.5;
        }
        if (s <= L.plateau) {
            // The plateau: a sharp lip, then nearly level, settling a little toward the back.
            const k = (s - L.wall) / (L.plateau - L.wall);
            // The lip rises off the wall's top (no step at the joint), then the plateau settles.
            const lip = 22 * (1 - Math.exp(-(s - L.wall) / 45)) * Math.exp(-(((s - L.wall) / 170) ** 2));
            return L.top + lip + 26 * Math.sin(Math.PI * k) - 70 * k;
        }
        // The long back: a hump, then down to the plain in one long concave sweep.
        const atPlateau = L.top - 70;
        const k = Math.min(1, (s - L.plateau) / (L.back - L.plateau));
        const hump = 110 * Math.exp(-(((s - L.hump) / 900) ** 2));
        return Math.max(0, atPlateau * (1 - k) ** 1.45 + hump * (1 - k));
    }
    const R = GATE.right;
    const s = c;
    if (s <= floorHalf) return floor + 40 * (s / floorHalf) ** 2;
    if (s <= R.wall) return base + (R.shoulder - base) * ((s - floorHalf) / (R.wall - floorHalf)) ** 2.1;
    if (s <= R.dip) {
        // The shoulder: a point over the wall, then a saddle behind it.
        const k = (s - R.wall) / (R.dip - R.wall);
        const point = 30 * (1 - Math.exp(-(s - R.wall) / 45)) * Math.exp(-(((s - R.wall - 110) / 160) ** 2));
        return R.shoulder + point - 90 * Math.sin(Math.PI * 0.5 * k) ** 2;
    }
    if (s <= R.ridge) {
        // The ridge climbs from the saddle to the summit in a long convex sweep, with a step in it.
        const k = (s - R.dip) / (R.ridge - R.dip);
        const climb = 1 - (1 - k) ** 1.7;
        return R.shoulder - 90 + (R.summit - R.shoulder + 90) * climb + 40 * Math.exp(-(((k - 0.45) / 0.08) ** 2));
    }
    if (s <= R.crest) return R.summit - 50 * ((s - R.ridge) / (R.crest - R.ridge)) ** 2;
    const k = Math.min(1, (s - R.crest) / (R.fall - R.crest));
    return Math.max(0, (R.summit - 50) * (1 - k) ** 1.35);
}

/** A point's place in the gate's frame: metres across (right +) and along toward the eye. */
export function gateFrame(x, z) {
    const dx = x - G.x;
    const dz = z - G.z;
    return {
        c: dx * AXIS.right[0] + dz * AXIS.right[1],
        a: dx * AXIS.toEye[0] + dz * AXIS.toEye[1],
    };
}

/** How the faces fall away in front of the gate (and settle behind it): 1 at the gate. */
function reach(a) {
    if (a >= 0) {
        const t = Math.min(1, a / GATE.front);
        return (1 - t) ** 2;
    }
    const t = Math.min(1, Math.max(0, (-a - GATE.behind) / 3200));
    return 1 - t * t * (3 - 2 * t);
}

/**
 * The fells' height (metres over the plain) at a world point, with its relief: `relief` is the
 * gully term alone (− in a gully, + on a rib), `face` how much of a steep face the point is on.
 */
export function gateSample(x, z) {
    const frame = gateFrame(x, z);
    const c = frame.c / SIZE.across;
    const a = frame.a / SIZE.across;
    const top = gateProfile(c);
    const r = reach(a);
    let h = top * r;
    // Gullies down the fall line of the front faces, ribs between them; cirques under the summits.
    const face = smooth(0.08, 0.35, 1 - r) * smooth(0.0, 0.25, r) * smooth(300, 900, top);
    const gully = (fbm(c / 210, a / 900) - 0.5) * 2;
    const relief = gully * face;
    h += relief * 85;
    const cirqueA = Math.exp(-(((c + 2600) / 650) ** 2 + ((a - 900) / 600) ** 2));
    const cirqueB = Math.exp(-(((c - 4800) / 700) ** 2 + ((a - 800) / 550) ** 2));
    const cirqueC = Math.exp(-(((c - 2000) / 450) ** 2 + ((a - 700) / 500) ** 2));
    const cirque = cirqueA * 160 + cirqueB * 150 + cirqueC * 110;
    h -= cirque * smooth(500, 1200, top);
    // A rough skin: blocks and ledges on the steep ground, a broken edge to the skyline.
    h += (fbm(c / 70, a / 70) - 0.5) * 30 * smooth(200, 900, h);
    return {
        h: h * SIZE.up, relief, face, cirque: cirque / 210,
    };
}

export const gateHeight = (x, z) => gateSample(x, z).h;

// ── The mesh ───────────────────────────────────────────────────────────────────────

/** The fells' mesh: a grid in the gate's frame, its columns crowded where the silhouette turns. */
export function createGateGeometry(cols = 420, rows = 150) {
    const positions = new Float32Array(cols * rows * 3);
    const shape = new Float32Array(cols * rows * 3);
    const c0 = GATE.span[0] * SIZE.across;
    const c1 = GATE.span[1] * SIZE.across;
    const a0 = GATE.depth[0] * SIZE.across;
    const a1 = GATE.depth[1] * SIZE.across;
    for (let j = 0; j < rows; j++) {
        // Rows crowd toward the gate's line, where the faces are steepest.
        const v = j / (rows - 1);
        const a = a0 + (a1 - a0) * (v < 0.4 ? 0.4 * (v / 0.4) ** 1.3 : 0.4 + 0.6 * ((v - 0.4) / 0.6) ** 1.6);
        for (let i = 0; i < cols; i++) {
            // Columns crowd round the U (the gate's walls want the finest steps).
            const w = (i / (cols - 1)) * 2 - 1;
            const bend = Math.sign(w) * Math.abs(w) ** 1.5;
            const c = bend < 0 ? -c0 * bend : c1 * bend;
            const x = G.x + c * AXIS.right[0] + a * AXIS.toEye[0];
            const z = G.z + c * AXIS.right[1] + a * AXIS.toEye[1];
            const s = gateSample(x, z);
            const o = (j * cols + i) * 3;
            positions[o] = x;
            positions[o + 1] = Math.max(-60, s.h - 25);
            positions[o + 2] = z;
            shape[o] = s.relief;
            shape[o + 1] = s.face;
            shape[o + 2] = s.cirque;
        }
    }
    const index = new Uint32Array((cols - 1) * (rows - 1) * 6);
    let k = 0;
    for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
            const p = j * cols + i;
            const q = p + cols;
            index[k++] = p;
            index[k++] = q;
            index[k++] = p + 1;
            index[k++] = p + 1;
            index[k++] = q;
            index[k++] = q + 1;
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aShape', new THREE.BufferAttribute(shape, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeVertexNormals();
    // Up-facing normals throughout (the grid's winding follows the frame's handedness).
    const n = geometry.attributes.normal;
    let flip = 0;
    for (let i = 0; i < n.count; i += 97) flip += n.getY(i);
    if (flip < 0) {
        for (let i = 0; i < index.length; i += 3) {
            const t = index[i + 1];
            index[i + 1] = index[i + 2];
            index[i + 2] = t;
        }
        geometry.index.needsUpdate = true;
        geometry.computeVertexNormals();
    }
    geometry.computeBoundingSphere();
    return geometry;
}

/** Linear albedos up the fells. */
const COLOURS = Object.freeze({
    birch: [0.032, 0.05, 0.022],
    birchTurned: [0.11, 0.07, 0.02],
    heath: [0.075, 0.068, 0.032],
    heathRed: [0.1, 0.05, 0.026],
    scree: [0.13, 0.12, 0.11],
    rock: [0.06, 0.062, 0.06],
    snow: [0.84, 0.86, 0.9],
});
const c3 = (rgb) => vec3(rgb[0], rgb[1], rgb[2]);

export function createLapporten(u, t, tier) {
    const geometry = createGateGeometry(tier.fells.cols, tier.fells.rows);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'GrainfieldsLapporten';
    material.fog = false;
    const vShape = varying(attribute('aShape', 'vec3'), 'gfGateShape');
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const N = normalize(normalWorld).toVar();
        // Heights in the silhouette's own metres (the zones are Lapporten's).
        const h = P.y.div(SIZE.up);
        const relief = vShape.x;
        const face = vShape.y;
        const cirque = vShape.z;
        const steep = smoothstep(0.55, 0.85, float(1.0).sub(N.y));
        const grain = texture(t.noise, P.xz.div(5200.0)).g;
        const fine = texture(t.noise, P.xz.div(900.0)).b;
        const crowns = texture(t.noise, P.xz.div(240.0)).a;
        // Birch on the skirts (its upper edge ragged, higher up the gullies), turning here and
        // there; heath above, rusty in patches; scree and rock on the steep faces.
        const birchLine = float(430.0).add(grain.sub(0.5).mul(220.0)).sub(relief.mul(90.0));
        const birch = mix(c3(COLOURS.birch), c3(COLOURS.birchTurned), smoothstep(0.55, 0.85, fine).mul(0.6))
            .mul(crowns.mul(0.6).add(0.7));
        const heath = mix(c3(COLOURS.heath), c3(COLOURS.heathRed), smoothstep(0.4, 0.75, fine));
        const albedo = mix(birch, heath, smoothstep(birchLine.sub(80.0), birchLine.add(80.0), h)).toVar();
        const bare = mix(c3(COLOURS.scree), c3(COLOURS.rock), smoothstep(0.3, 0.7, fine).mul(0.6).add(relief.max(0.0).mul(0.4)));
        const rockShare = smoothstep(800.0, 1150.0, h.add(fine.mul(220.0))).mul(0.55).add(steep.mul(0.75));
        albedo.assign(mix(albedo, bare, clamp(rockShare, 0.0, 1.0)));
        // The last snow: in the cirques and the gullies' heads, on the shaded high ground.
        const snowLine = float(1320.0).sub(cirque.mul(200.0)).add(grain.sub(0.5).mul(200.0));
        const streak = smoothstep(0.62, 0.8, relief.negate().mul(0.9).add(fine.mul(0.45)));
        const snow = smoothstep(snowLine.sub(40.0), snowLine.add(40.0), h)
            .mul(streak.max(smoothstep(0.75, 0.95, cirque).mul(smoothstep(0.55, 0.8, fine))))
            .mul(float(1.0).sub(steep.mul(0.7)));
        albedo.assign(mix(albedo, c3(COLOURS.snow), clamp(snow, 0.0, 1.0)));
        const lit = lightSurface(u, t.noise, P, N, albedo);
        const col = lit.colour.toVar();
        // The relief's own shade: the gullies and cirques hold the dark, the ribs catch the light
        // that comes in under the deck from the bright band round the horizon.
        const open = clamp(relief.mul(0.5).add(0.6).sub(cirque.mul(0.25)), 0.0, 1.0);
        col.mulAssign(open.mul(0.85).add(0.4).mul(float(1.0).sub(face.mul(0.1))));
        // Ledges, the plateau and the shoulders face the bright overcast; the steep faces turn from
        // it: the relief reads even when the sun is behind the fells.
        col.mulAssign(mix(float(0.55), float(1.35), N.y.mul(N.y)));
        const toEye = normalize(vec3(u.eye.x.sub(P.x), 0.0, u.eye.z.sub(P.z)));
        const band = clamp(N.dot(toEye), 0.0, 1.0).mul(open);
        col.addAssign(albedo.mul(u.horizon).mul(band).mul(0.14));
        // Afterglow: after the sun has gone the high faces keep its light a while (alpenglow).
        const afterglow = u.day.oneMinus().mul(smoothstep(-0.25, 0.25, u.sunDir.y.add(0.12)))
            .mul(smoothstep(450.0, 1300.0, h));
        col.addAssign(u.glow.mul(albedo.add(0.07)).mul(afterglow).mul(1.05));
        return vec4(aerial(u, P, col), 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'GrainfieldsLapporten';
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    return {
        mesh,
        meshes: [mesh],
        update() {},
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

/** The gate's U at the ridge line, as a world point (the middle of the floor). */
export function gateCentre(out = [0, 0, 0]) {
    out[0] = G.x;
    out[1] = GATE.floor * SIZE.up;
    out[2] = G.z;
    return out;
}

/** A world point `c` metres across the gate's line (right +) and `a` metres toward the eye. */
export function gatePoint(c, a, out = [0, 0]) {
    out[0] = G.x + c * AXIS.right[0] + a * AXIS.toEye[0];
    out[1] = G.z + c * AXIS.right[1] + a * AXIS.toEye[1];
    return out;
}

/** The silhouette's summits (for tests and the world's aims): the left plateau, the right shoulder. */
export const GATE_SUMMITS = Object.freeze({
    left: -(GATE.left.wall + GATE.left.plateau) / 2,
    shoulder: GATE.right.wall + 110,
    right: (GATE.right.ridge + GATE.right.crest) / 2,
});
