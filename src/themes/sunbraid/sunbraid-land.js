/**
 * Sunbraid — the land: one fan of ground round the eye (rows crowd near the lens), white gypsum
 * with warm patches, polygon crusts, drifts of pale scrub and selenite glitter, lit by the three
 * suns and shadowed by every tower and glider.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, cross, dFdx, dFdy, dot, float, floor, fract, fwidth, length, max, mix, normalize, normalWorld,
    positionWorld, reflect, select, sign, smoothstep, step, texture, vec2, vec3, vec4,
} from 'three/tsl';
import { groundHeight } from './sunbraid-plan.js';
import {
    DEG, haze, mist, sbCells, sbHash21, sunLight, sunVisibility,
} from './sunbraid-tsl.js';

/** The fan's reach (metres) and bearing span (degrees either side of the view axis). */
export const FAN = Object.freeze({ near: 6, far: 18000, span: 100 });

/**
 * The salt crust: polygon cells `cell` metres across (centres jittered by `jitter`), their edge
 * ridges `ridge` cell units wide and `height` metres high; each cell's tone varies by ±`tone`/2;
 * the fine grain's relief (metres). Ridges and tones are drawn while a cell is wider than
 * 1/`fade[1]` pixels, fully from 1/`fade[0]`; the bump itself is gone by `far` metres.
 */
export const FLOOR_CRUST = Object.freeze({
    cell: 24,
    jitter: 0.85,
    ridge: 0.12,
    height: 0.22,
    tone: 0.07,
    bright: 0.09,
    grain: 0.03,
    fade: Object.freeze([0.1, 0.3]),
    relief: Object.freeze([0.025, 0.06]),
    near: 700,
    far: 3200,
});
/** The selenite: the share of the glitter's cells that hold a crystal, and how bright its glint is. */
export const SELENITE = Object.freeze({ share: 0.018, gain: 3.6 });

/** The fan's vertices, normals and indices (CPU). */
export function buildFan(cols, rows) {
    const count = cols * rows;
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const ratio = FAN.far / FAN.near;
    const e = 0.75;
    for (let j = 0; j < rows; j++) {
        const f = j / (rows - 1);
        const d = FAN.near * ratio ** f;
        for (let i = 0; i < cols; i++) {
            const bearing = (-FAN.span + (2 * FAN.span * i) / (cols - 1)) * DEG;
            const x = Math.sin(bearing) * d;
            const z = -Math.cos(bearing) * d;
            const y = groundHeight(x, z);
            const k = (j * cols + i) * 3;
            position[k] = x;
            position[k + 1] = y;
            position[k + 2] = z;
            // The slope from the height function itself (a step that grows with distance).
            const h = Math.max(e, d * 0.004);
            const dx = (groundHeight(x + h, z) - groundHeight(x - h, z)) / (2 * h);
            const dz = (groundHeight(x, z + h) - groundHeight(x, z - h)) / (2 * h);
            const len = Math.hypot(dx, 1, dz);
            normal[k] = -dx / len;
            normal[k + 1] = 1 / len;
            normal[k + 2] = -dz / len;
        }
    }
    const index = new Uint32Array((cols - 1) * (rows - 1) * 6);
    let n = 0;
    for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
            const a = j * cols + i;
            const b = a + 1;
            const c = a + cols;
            const d = c + 1;
            // Wound so the faces look up: (b − a) × (c − a) points along +y.
            index[n++] = a;
            index[n++] = b;
            index[n++] = c;
            index[n++] = b;
            index[n++] = d;
            index[n++] = c;
        }
    }
    return { position, normal, index };
}

export function createLand(u, t, tier) {
    const fan = buildFan(tier.fan.cols, tier.fan.rows);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(fan.position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(fan.normal, 3));
    geometry.setIndex(new THREE.BufferAttribute(fan.index, 1));
    geometry.computeBoundingSphere();

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const N = normalize(normalWorld).toVar();
        // White gypsum, crusted into great polygons whose raised rims catch the light, with drifts
        // of pale scrub: the suns give the colour.
        const patch = texture(t.noise, P.xz.div(2600.0)).g;
        const fine = texture(t.noise, P.xz.div(70.0)).b;
        const grain = texture(t.noise, P.xz.div(9.0)).a;
        const crustA = texture(t.noise, P.xz.div(1400.0).add(vec2(0.13, 0.71))).b;
        const crustB = texture(t.noise, P.xz.div(610.0).add(vec2(0.57, 0.29))).b;
        const rimA = float(1.0).sub(abs(crustA.mul(2.0).sub(1.0)));
        const rimB = float(1.0).sub(abs(crustB.mul(2.0).sub(1.0)));
        const rims = smoothstep(0.9, 0.985, rimA).max(smoothstep(0.9, 0.98, rimB).mul(0.7));
        const gypsum = vec3(0.95, 0.94, 0.91);
        const warm = vec3(0.95, 0.9, 0.84);
        const scrub = vec3(0.72, 0.76, 0.7);
        const ground = mix(gypsum, warm, smoothstep(0.35, 0.75, patch).mul(0.6));
        const scrubby = smoothstep(0.55, 0.75, patch.add(fine.sub(0.5).mul(0.5))).mul(smoothstep(0.45, 0.7, grain));
        // The salt crust: polygons a couple of dozen metres across whose edges stand up in ridges a
        // hand's breadth high. With the suns this low a ridge's face toward them catches the light and
        // its back falls into shade, so the polygons tile away to the horizon; each polygon is its own
        // shade of white. Ridges and tones fade to their mean where a cell shrinks toward a pixel.
        const C = FLOOR_CRUST;
        const cp = P.xz.div(C.cell).toVar();
        const cells = sbCells(cp, float(C.jitter)).toVar();
        const toEdge = cells.y.sub(cells.x).toVar();
        const cellPx = fwidth(cp).length().toVar();
        const crustSeen = float(1.0).sub(smoothstep(C.fade[0], C.fade[1], cellPx)).toVar();
        // A ridge never narrower than about a pixel and a half: farther out it widens and fades by as
        // much (a thinner one broke into dotted lines).
        const width = max(float(C.ridge), cellPx.mul(1.6)).toVar();
        const ridge = smoothstep(width, 0.0, toEdge).mul(float(C.ridge).div(width)).mul(crustSeen).toVar();
        const cellTone = cells.z.sub(0.5).mul(C.tone).mul(crustSeen);
        // The salt heaps up white along the ridges.
        const shade = float(0.94).add(grain.mul(0.08)).sub(rims.mul(0.035)).add(cellTone)
            .add(ridge.mul(C.bright));
        const albedo = mix(ground, scrub, scrubby.mul(0.7)).mul(shade).toVar();
        // The relief only where a ridge is a few pixels wide: its normal comes from screen
        // derivatives, which turn to stair steps (dotted lines) on a ridge a pixel or two across.
        const reliefSeen = float(1.0).sub(smoothstep(C.relief[0], C.relief[1], cellPx));
        const bumpH = ridge.mul(ridge).mul(float(3.0).sub(ridge.mul(2.0))).mul(C.height).mul(reliefSeen)
            .add(grain.mul(C.grain))
            .toVar();
        const dpdx = dFdx(P);
        const dpdy = dFdy(P);
        const r1 = cross(dpdy, N);
        const r2 = cross(N, dpdx);
        const det = dot(dpdx, r1);
        const grad = r1.mul(dFdx(bumpH)).add(r2.mul(dFdy(bumpH))).mul(sign(det));
        const near = smoothstep(C.far, C.near, length(P.sub(u.eye)));
        const bumped = N.mul(abs(det)).sub(grad.mul(near));
        const Nb = select(length(bumped).greaterThan(1e-9), normalize(bumped), N).toVar();
        const vis = sunVisibility(u, P, t.noise);
        const lit = sunLight(u, Nb, vis);
        const ambient = mix(u.horizon, u.zenith, 0.55).mul(N.y.mul(0.35).add(0.65)).mul(0.07);
        // Selenite: a crystal now and then, each turned its own way, catching a sun's glint (the
        // glints of a sun hidden by a shadow go out with it, so the fans show in the sparkle too).
        // Cells are laid out in the coordinates the eye projects along (a few pixels at any range).
        const rel = P.xz.sub(u.eye.xz);
        const dist = length(rel).toVar();
        const lift = u.eye.y.sub(u.groundY);
        const gridUv = vec2(rel.x.div(max(dist, 1.0)), lift.div(max(dist, 1.0))).mul(vec2(720.0, 900.0));
        const cell = floor(gridUv);
        const f = fract(gridUv).sub(0.5);
        const h1 = sbHash21(cell);
        const h2 = sbHash21(cell.add(vec2(17.3, 41.7)));
        // (Sparse and bright: a crystal in seven cells read as static over the whole floor.)
        const crystal = smoothstep(0.42, 0.08, length(f)).mul(step(h1, SELENITE.share));
        const tilt = vec3(h1.sub(SELENITE.share * 0.5).mul(9.0 * (0.07 / SELENITE.share)), 1.0, h2.sub(0.5).mul(0.7));
        const facet = normalize(tilt);
        const view = normalize(P.sub(u.eye));
        const mirror = reflect(view, facet);
        const glintOf = (S) => {
            const m = max(dot(mirror, S), 0.0);
            const m2 = m.mul(m);
            const m4 = m2.mul(m2);
            const m8 = m4.mul(m4);
            return m8.mul(m8).mul(m8);
        };
        const glint = u.col0.mul(glintOf(u.sun0).mul(vis.x))
            .add(u.col1.mul(glintOf(u.sun1).mul(vis.y)))
            .add(u.col2.mul(glintOf(u.sun2).mul(vis.z)))
            .mul(crystal.mul(SELENITE.gain).mul(smoothstep(3000.0, 700.0, dist)));
        const colour = albedo.mul(lit.add(ambient)).add(glint);
        return vec4(haze(u, mist(u, colour, P, vis), P), 1.0);
    })();
    material.fog = false;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Sunbraid land';
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    return {
        mesh,
        material,
        geometry,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
