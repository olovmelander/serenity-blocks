/**
 * Spring — the valley's ground.
 *
 * One mesh over the baked heights (spring-terrain): a fan of rows round the eye, dense under
 * it and thinning toward the fells, its far vertices dropped by the earth's curvature and its
 * distant forests lifted by their canopy so the ridges carry trees against the sky. One material
 * shades all of it:
 *
 *   meadow   a Norrland spring meadow: last year's straw-pale grass with the new green coming
 *            through it, greener toward the water, starred with wood anemones, marsh marigolds,
 *            wood cranesbill and hepatica (dots that fade to their mean colour where a pixel can
 *            no longer hold them)
 *   granite  where the ground is steep or the knoll's dome breaks through: pink-grey rock with
 *            pale lichen, dark and glistening below the flood's wet line
 *   forest   seen from above, a canopy of crowns: dark spruce, and birches in first leaf, a haze
 *            of yellow-green
 *   fells    heath above the treeline, the winter's snow lying in the hollows and on the heights
 *
 * Lit by the hour's sun (dimmed where the cloud deck's shadows drift over) and sky, and seen
 * through the air (spring-light aerial).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    dot,
    float,
    floor,
    fract,
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    smoothstep,
    texture,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { DEG, smooth } from './spring-core.js';
import { aerial, sunShare } from './spring-light.js';
import { spHash21 } from './spring-tsl.js';
import {
    EYE, PLACES, S_POOL, courseAt,
} from './spring-plan.js';
import {
    KNOLL, birchShare, forestCover, groundHeight, groundNormal, waterEdge,
} from './spring-terrain.js';

/** Where the curtain meets the pool (its spray soaks the rock round it). */
const FALL_FOOT = courseAt(S_POOL, {});

/** Earth's curvature drops a far point by d² / 2R (with the usual refraction allowance). */
export const EARTH_DROP = 0.87 / (2 * 6371000);

/** The fan the ground mesh covers: bearings (degrees) and distances (m). */
export const FAN = Object.freeze({
    from: -64, to: 58, near: 0.6, far: 28000,
});

/** How high a forest's canopy stands over its ground (m), and where the lifted canopy begins. */
export const CANOPY = Object.freeze({ height: 14, from: 1500, full: 2600 });

// Linear albedos.
const STRAW = [0.2, 0.155, 0.085];
const NEW_GREEN = [0.075, 0.155, 0.04];
const MOSS = [0.045, 0.1, 0.028];
const GRANITE = [0.25, 0.23, 0.215];
const LICHEN = [0.36, 0.38, 0.31];
const WET_ROCK = [0.05, 0.047, 0.043];
const SCHIST = [0.062, 0.064, 0.07];
const SCHIST_WARM = [0.085, 0.075, 0.066];
const SPRUCE = [0.02, 0.048, 0.026];
const BIRCH = [0.2, 0.31, 0.07];
const BIRCH_FAR = [0.11, 0.16, 0.05];
const HEATH = [0.12, 0.1, 0.075];
const HEATH_DARK = [0.06, 0.06, 0.035];
const HEATH_PALE = [0.21, 0.2, 0.15];
const SNOW = [0.86, 0.89, 0.93];

/**
 * Build the ground mesh from the bake. `tier.landCols` columns across the fan, rows spaced
 * `tier.landRow` × distance apart (never closer than `tier.landMinRow` metres).
 */
export function createLandGeometry(baked, tier) {
    const cols = Math.max(32, tier.landCols | 0);
    const rel = tier.landRow ?? 0.012;
    const minRow = tier.landMinRow ?? 0.3;
    const distances = [];
    for (let d = FAN.near; d < FAN.far; d += Math.max(minRow, d * rel)) distances.push(d);
    distances.push(FAN.far);
    const rows = distances.length;
    const count = rows * (cols + 1);
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const land = new Float32Array(count * 4);
    const canopy = new Float32Array(count);
    const n = [0, 1, 0];
    const w = {};
    for (let r = 0; r < rows; r++) {
        const d = distances[r];
        const spacing = r + 1 < rows ? distances[r + 1] - d : d * rel;
        for (let c = 0; c <= cols; c++) {
            const b = (FAN.from + ((FAN.to - FAN.from) * c) / cols) * DEG;
            const x = EYE.x + Math.sin(b) * d;
            const z = EYE.z - Math.cos(b) * d;
            const h = groundHeight(baked, x, z);
            groundNormal(baked, x, z, n, Math.min(60, Math.max(0.7, spacing * 0.8)));
            waterEdge(baked, x, z, w);
            const forest = forestCover(x, z, w.edge, h, PLACES.barn);
            // Far off, the canopy is read without the woods' clearings (the material breaks it
            // with bogs at its own scale).
            const far = forestCover(x, z, w.edge, h, PLACES.barn, { clearings: false });
            const birch = birchShare(x, z, w.edge, h);
            // Distant forests: the canopy stands over the ground and carries the ridges' crowns.
            const lift = far * CANOPY.height * smooth(CANOPY.from, CANOPY.full, d) * (0.85 + 0.3 * birch);
            const k = r * (cols + 1) + c;
            canopy[k] = far;
            position[k * 3] = x;
            position[k * 3 + 1] = h + lift - d * d * EARTH_DROP;
            position[k * 3 + 2] = z;
            normal.set(n, k * 3);
            land[k * 4] = forest;
            land[k * 4 + 1] = birch;
            land[k * 4 + 2] = w.edge;
            land[k * 4 + 3] = w.level;
        }
    }
    const index = new Uint32Array((rows - 1) * cols * 6);
    let o = 0;
    for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols; c++) {
            const a = r * (cols + 1) + c;
            const bb = a + 1;
            const cc = a + cols + 1;
            const dd = cc + 1;
            index[o++] = a;
            index[o++] = bb;
            index[o++] = dd;
            index[o++] = a;
            index[o++] = dd;
            index[o++] = cc;
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('aLand', new THREE.BufferAttribute(land, 4));
    geometry.setAttribute('aCanopy', new THREE.BufferAttribute(canopy, 1));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeBoundingSphere();
    return { geometry, vertices: count, triangles: index.length / 3 };
}

/** Flower dots on a meadow: cells `size` m wide, a dot in each `density` share of them. */
function flowerDots(xz, size, density, radius, seed) {
    const cell = xz.div(size);
    const id = floor(cell);
    const f = fract(cell).sub(0.5);
    const h = spHash21(id.add(seed));
    const h2 = spHash21(id.add(seed + 17.0));
    const at = vec2(h.sub(0.5), h2.sub(0.5)).mul(0.6);
    const r = length(f.sub(at));
    // The cell's footprint on screen: below ~2 px a dot fades to its share of the cell.
    const fw = fwidth(cell.x).max(1e-4);
    const sharp = smoothstep(radius.add(fw), radius.sub(fw).max(0.0), r);
    const mean = radius.mul(radius).mul(3.14);
    const dot1 = mix(sharp, mean, smoothstep(0.25, 0.7, fw));
    return dot1.mul(h.lessThan(density).select(1.0, 0.0));
}

export function createLandMaterial(u, tex) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SpringLand';
    material.fog = false;
    const vLand = varying(attribute('aLand', 'vec4'), 'spLandInfo');
    const vCanopy = varying(attribute('aCanopy', 'float'), 'spLandCanopy');
    const vN = varying(normalize(attribute('normal', 'vec3')), 'spLandN');
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const { xz } = P;
        const toEye = u.eye.sub(P);
        const dist = max(length(toEye), 0.05).toVar();
        const L = u.sunDir;
        const N = normalize(vN).toVar();
        const forest = vLand.x;
        const birch = vLand.y;
        const edge = vLand.z;
        const level = vLand.w;

        // ── Noise reads (each channel's period: r 8, g 16, b 32, a 64 cells of the tile) ──
        const n1 = texture(tex.noise, xz.div(96.0)).toVar();
        const n2 = texture(tex.noise, xz.div(12.0)).toVar();
        const n3 = texture(tex.noise, xz.div(2.2)).toVar();
        // The far country's own scales: its ridges and gullies are finer than its mesh's rows, so
        // far off the slope's light is roughened by them.
        const f1 = texture(tex.noise, xz.div(2600.0)).toVar();
        const f2 = texture(tex.noise, xz.div(700.0)).toVar();
        const farShape = smoothstep(800.0, 2500.0, dist);
        N.assign(normalize(N.add(vec3(f2.a.sub(0.5), 0.0, f2.b.sub(0.5)).mul(farShape.mul(1.1)))));
        const slope = float(1.0).sub(N.y).toVar();

        // ── Light ──
        // The valley loses the sun behind the skyline first; the fells keep it longest.
        const sunLight = u.sun.mul(sunShare(u, P)).toVar();
        // Soft shadows of the deck's clouds drifting over the valley.
        const lift = float(1500.0).div(max(L.y, 0.08));
        const shadowAt = xz.add(L.xz.mul(lift)).add(u.wind);
        const deck = texture(tex.noise, shadowAt.div(9000.0)).r.mul(0.62)
            .add(texture(tex.noise, shadowAt.div(3400.0).add(vec2(0.37, 0.61))).g.mul(0.38));
        const lo = float(0.82).sub(u.cloudCover.mul(0.6));
        sunLight.mulAssign(float(1.0).sub(smoothstep(lo.sub(0.08), lo.add(0.3), deck).mul(0.42)));
        const diffuse = max(dot(N, L), 0.0);
        const sky = u.fill.mul(N.y.mul(0.35).add(0.65)).add(u.bounce.mul(float(0.5).sub(N.y.mul(0.5))));

        // ── The meadow ──
        const greenness = clamp(n1.g.mul(0.8).sub(0.2).add(smoothstep(40.0, 2.0, edge).mul(0.4)), 0.0, 1.0);
        const grass = mix(vec3(...STRAW), vec3(...NEW_GREEN), greenness).mul(n2.b.mul(0.35).add(0.8)).toVar();
        grass.assign(mix(grass, vec3(...MOSS), smoothstep(0.55, 0.85, n2.a).mul(0.35)));
        // Flowers in the meadow: white anemones everywhere, marigolds by the water, cranesbill
        // and hepatica in drifts.
        const bloomZone = smoothstep(0.0, 4.0, edge).mul(float(1.0).sub(forest)).mul(smoothstep(0.32, 0.12, slope));
        const fA = flowerDots(xz, float(0.32), smoothstep(0.55, 0.9, n1.r).mul(0.3).add(0.015), float(0.15), 3.0);
        const fB = flowerDots(xz.add(11.3), float(0.41), smoothstep(10.0, 1.0, edge).mul(0.3), float(0.18), 7.0);
        const fC = flowerDots(xz.add(5.7), float(0.47), smoothstep(0.6, 0.85, n1.b).mul(0.22), float(0.14), 13.0);
        const fD = flowerDots(xz.add(23.1), float(0.37), smoothstep(0.65, 0.9, n1.a).mul(0.2), float(0.12), 19.0);
        grass.assign(mix(grass, vec3(0.82, 0.84, 0.8), fA.mul(bloomZone)));
        grass.assign(mix(grass, vec3(0.86, 0.6, 0.02), fB.mul(bloomZone)));
        grass.assign(mix(grass, vec3(0.36, 0.16, 0.5), fC.mul(bloomZone)));
        grass.assign(mix(grass, vec3(0.12, 0.16, 0.62), fD.mul(bloomZone)));

        // ── Granite ──
        const near = smoothstep(18.0, 3.0, dist);
        const n4 = texture(tex.noise, xz.div(0.55)).toVar();
        // Round the fall the slopes are rockier and their turf is dark moss and spruce litter.
        const fallSide = smoothstep(150.0, 70.0, length(xz.sub(vec2(FALL_FOOT.x, FALL_FOOT.z)))).toVar();
        grass.assign(mix(grass, vec3(...MOSS).mul(n2.g.mul(0.5).add(0.8)), fallSide.mul(0.6)));
        const rockMask = smoothstep(float(0.28).sub(fallSide.mul(0.1)), 0.42, slope.add(n2.r.sub(0.5).mul(0.24)))
            .toVar();
        // The knoll's shoulder breaks through its turf in slabs; its top is meadow.
        const knollR = length(xz.sub(vec2(EYE.x, EYE.z + KNOLL.back)).div(vec2(KNOLL.rx, KNOLL.rz)));
        const shoulder = smoothstep(0.62, 0.9, knollR).mul(smoothstep(1.7, 1.2, knollR));
        const slabs = smoothstep(0.38, 0.55, n2.g.add(n3.r.mul(0.3)).add(n4.r.mul(0.15).mul(near)));
        rockMask.assign(max(rockMask, shoulder.mul(slabs)));
        const pale = smoothstep(0.45, 0.75, n3.g.add(n4.g.sub(0.5).mul(0.3).mul(near))).mul(0.55);
        const granite = mix(vec3(...GRANITE), vec3(...LICHEN), pale)
            .mul(n2.a.mul(0.3).add(0.82)).mul(n3.b.mul(0.25).add(0.85)).toVar();
        // Joints: dark cracks in the rock, more of them on the steep faces.
        const joints = smoothstep(0.035, 0.0, abs(n3.r.sub(0.5))).mul(0.8)
            .add(smoothstep(0.02, 0.0, abs(n2.g.sub(0.5))).mul(smoothstep(0.35, 0.6, slope)));
        granite.mulAssign(float(1.0).sub(clamp(joints, 0.0, 1.0).mul(0.55)));
        // Black streaks where seepage runs down the faces, and rust-orange lichen in spots.
        const seepage = smoothstep(0.62, 0.8, texture(tex.noise, vec2(xz.x.add(xz.y).div(7.0), P.y.div(40.0))).g);
        granite.mulAssign(float(1.0).sub(seepage.mul(smoothstep(0.4, 0.7, slope)).mul(0.5)));
        granite.assign(mix(granite, vec3(0.42, 0.2, 0.06), smoothstep(0.82, 0.9, n3.a).mul(0.45)));
        // Near the eye the grain shows: crystals and small pits.
        granite.mulAssign(n4.b.sub(0.5).mul(0.35).mul(near).add(1.0));

        // ── Rock faces: on the steep the rock is the step's own dark schist, in layers that wave
        // a little along the slope (read by height, never projected along the face, which swirls
        // on a curved slope); near the fall the spray keeps it dark and wet ──
        const steep = smoothstep(0.42, 0.72, slope).toVar();
        const layered = P.y.add(n1.g.sub(0.5).mul(7.0));
        const bands = texture(tex.noise, vec2(layered.div(15.0), xz.x.add(xz.y).div(400.0))).toVar();
        const patchy = texture(tex.noise, xz.div(10.0).add(vec2(P.y.div(10.0), 0.0))).toVar();
        const face = mix(vec3(...SCHIST), vec3(...SCHIST_WARM), smoothstep(0.35, 0.7, patchy.r))
            .mul(bands.g.mul(0.35).add(0.8)).mul(patchy.g.mul(0.2).add(0.9)).toVar();
        // The partings between the layers.
        const parting = smoothstep(0.045, 0.0, abs(bands.b.sub(0.5))).mul(0.5);
        face.mulAssign(float(1.0).sub(parting));
        // Seepage: black streaks running down the face.
        const seep = smoothstep(0.6, 0.78, texture(tex.noise, vec2(xz.x.sub(xz.y).div(9.0), P.y.div(55.0))).g);
        face.mulAssign(float(1.0).sub(seep.mul(0.45)));
        // Pale lichen in patches; moss and turf on the ledges where the face lies back.
        const lichen = smoothstep(0.6, 0.76, patchy.b.add(n2.r.mul(0.3))).mul(0.35);
        face.assign(mix(face, vec3(...LICHEN).mul(0.75), lichen));
        const ledgeMoss = smoothstep(0.8, 0.5, slope).mul(smoothstep(0.4, 0.6, bands.r.add(patchy.a.mul(0.3))));
        face.assign(mix(face, vec3(...MOSS), ledgeMoss.mul(0.8)));
        // The fall's spray soaks the rock round its foot.
        const spray = smoothstep(60.0, 14.0, length(xz.sub(vec2(FALL_FOOT.x, FALL_FOOT.z)))).mul(steep).toVar();
        face.assign(mix(face, vec3(...WET_ROCK).mul(patchy.a.mul(0.5).add(0.8)), spray.mul(0.75)));
        // Round the fall all the bare rock is the step's schist, steep or not.
        granite.assign(mix(granite, face, max(steep, fallSide.mul(0.9))));

        // ── The water's wet line (it rises with the flood) ──
        const above = P.y.sub(level.add(u.flood));
        const wet = smoothstep(1.4, 0.0, above).mul(smoothstep(8.0, 0.0, edge));
        const groundCol = mix(grass, granite, rockMask).toVar();
        groundCol.assign(mix(groundCol, vec3(...WET_ROCK).mul(n2.r.mul(0.5).add(0.75)), wet.mul(0.85)));

        // ── The forest's canopy ──
        // Far off, a canopy's texture and its edge are read at the far country's own scale (the
        // metre-scale reads are a single mean colour there): tongues and islands of forest fraying
        // into the heath, darker and lighter stands, the birches' belt at the treeline.
        const seenAsCanopy = smoothstep(1500.0, 2400.0, dist).toVar();
        const crown = texture(tex.noise, xz.div(5.5)).toVar();
        const isBirch = smoothstep(0.42, 0.58, birch.add(mix(crown.a, f2.b, seenAsCanopy).sub(0.5).mul(0.5)));
        const birchFar = mix(vec3(...BIRCH), vec3(...BIRCH_FAR), seenAsCanopy);
        const canopyAlb = mix(vec3(...SPRUCE), birchFar, isBirch)
            .mul(mix(crown.b.mul(0.7).add(0.55), f2.g.mul(0.45).add(0.7), seenAsCanopy));
        // Gaps between crowns are deep shade.
        const gaps = mix(smoothstep(0.3, 0.55, crown.r), f2.a.mul(0.3).add(0.6), seenAsCanopy);
        const canopyCol = canopyAlb.mul(gaps.mul(0.75).add(0.25));
        // (Far off, the per-vertex cover is smooth over the rows' tens of metres: there the canopy
        // is read without the woods' clearings, broken instead by bogs at the far scale, its edge
        // frayed by the noise.)
        const bog = smoothstep(0.63, 0.71, f2.g.add(f1.b.sub(0.5).mul(0.7))).mul(0.85);
        const cover = mix(forest, vCanopy.mul(float(1.0).sub(bog)), seenAsCanopy);
        const fray = mix(n2.b.sub(0.5).mul(0.3), f2.r.sub(0.5).mul(0.8).add(f1.g.sub(0.5).mul(0.5)), seenAsCanopy);
        const inForest = smoothstep(0.25, 0.6, cover.add(fray)).toVar();
        // Out to the woods' reach the trees are real (spring-woods.js); under them lies the forest
        // floor: moss, needles, shade. Beyond, the land carries the canopy.
        const floorCol = mix(vec3(0.028, 0.045, 0.022), vec3(0.06, 0.05, 0.03), n2.g).mul(n3.b.mul(0.4).add(0.7));
        const forestCol = mix(floorCol, canopyCol, seenAsCanopy);
        groundCol.assign(mix(groundCol, forestCol, inForest.mul(float(1.0).sub(rockMask.mul(0.7)))));

        // ── The fells: heath above the treeline (pale with lichen on the wind-blown ridges, dark
        // with crowberry and dwarf birch in the shelter), scree where it is steep; at the end of May
        // the snow still lies on the tops and runs down the gullies in long fingers ──
        const fell = smoothstep(360.0, 520.0, P.y.add(f1.r.sub(0.5).mul(140.0)).add(n1.r.mul(40.0)));
        const heath = mix(vec3(...HEATH_DARK), vec3(...HEATH), smoothstep(0.3, 0.6, f2.g))
            .mul(f2.b.mul(0.3).add(0.85)).toVar();
        // (Soft-edged drifts: hard ones read as camouflage from the knoll.)
        const lichenHeath = smoothstep(0.42, 0.88, f2.r.add(f1.b.sub(0.5).mul(0.4)).add(n1.r.sub(0.5).mul(0.2)))
            .mul(0.5);
        heath.assign(mix(heath, vec3(...HEATH_PALE), lichenHeath));
        const scree = smoothstep(0.3, 0.55, slope.add(f2.a.sub(0.5).mul(0.3)));
        const fellCol = mix(heath, vec3(...GRANITE).mul(f2.a.mul(0.3).add(0.55)), scree);
        groundCol.assign(mix(groundCol, fellCol, fell.mul(float(1.0).sub(inForest))));
        // Gullies run down the fall line: the snow is read in a frame drawn out along it.
        const down = normalize(N.xz.add(vec2(1e-4, 0.0)));
        const along = vec2(dot(xz, vec2(down.y.negate(), down.x)).div(900.0), dot(xz, down).div(5200.0));
        const gully = texture(tex.noise, along).g.add(f2.b.sub(0.5).mul(0.22));
        const snowLine = float(650.0).add(f1.r.sub(0.5).mul(280.0));
        const lifted = P.y.add(f2.g.sub(0.5).mul(90.0));
        const tops = smoothstep(snowLine, snowLine.add(110.0), lifted);
        const fingers = smoothstep(0.6, 0.7, gully).mul(smoothstep(snowLine.sub(300.0), snowLine.sub(80.0), lifted));
        const snow = max(tops, fingers).mul(smoothstep(0.72, 0.42, slope)).mul(float(1.0).sub(inForest.mul(0.8)));
        groundCol.assign(mix(groundCol, vec3(...SNOW), snow));

        // ── Shade ──
        // Crowns face the sun more than the slope they stand on; snow and meadow follow the slope.
        const canopyLight = max(dot(normalize(N.add(vec3(0.0, 0.6, 0.0))), L), 0.0);
        // Far off the air softens the fells' light and shade: a slope turned from the sun is
        // still lit by the bright air between.
        const lambert = mix(mix(diffuse, canopyLight, inForest), diffuse.mul(0.55).add(0.32), farShape.mul(0.7));
        const col = groundCol.mul(sunLight.mul(lambert).add(sky)).toVar();
        // A wet sheen toward the sun.
        const V = toEye.div(dist).negate();
        const R = V.sub(N.mul(dot(V, N).mul(2.0)));
        const glint = max(dot(R, L), 0.0);
        const g2 = glint.mul(glint);
        const g8 = g2.mul(g2).mul(g2).mul(g2);
        col.addAssign(sunLight.mul(g2.mul(g2).mul(g2).mul(wet).mul(0.6)
            .add(g8.mul(g8).mul(g8).mul(spray).mul(0.25))));
        return vec4(aerial(u, P, col), 1.0);
    })();
    return material;
}

export function createLand(u, tex, tier, baked) {
    const { geometry, triangles } = createLandGeometry(baked, tier);
    const material = createLandMaterial(u, tex);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'SpringLand';
    mesh.frustumCulled = false;
    // The ground is the heaviest opaque material and lies under everything else: it is drawn after
    // the stones, the trees, the meadow and the river (and before the sky), so it is shaded only
    // where it shows. Drawn after the river it must still lose to it where the depth buffer cannot
    // tell them apart (a kilometre off its steps are half a metre: the far river over its bed and
    // its shallow banks), as it did when the river was drawn over it: a strict test.
    mesh.renderOrder = 5;
    material.depthFunc = THREE.LessDepth;
    return {
        mesh,
        meshes: [mesh],
        triangles,
        update() {},
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
