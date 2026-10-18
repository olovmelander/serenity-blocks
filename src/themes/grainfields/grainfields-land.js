/**
 * Grainfields — the land (mesh + material).
 *
 * The mesh is a fan laid out for the one eye that looks at it: columns by bearing across the
 * widest frame any screen shows, rows by log-distance from two metres to sixty kilometres, so
 * every triangle covers about the same few pixels wherever it lies. Heights come from the plan's
 * analytic height function (grainfields-plan groundHeight); each post also carries the
 * shelterbelts' and the forest's cover.
 *
 * The material is unlit: it lights itself.
 *  - The patchwork: plots of ripe barley (lemon gold), wheat (deeper gold), oats (pale), a few
 *    late green plots and one cut to stubble, divided by thin tracks; the grain's colour breathes
 *    across each plot, and the wind's gusts roll across it as travelling bands of paler sheen
 *    (bent ears show their sides) with the sun's glow through the awns when it is ahead.
 *  - The path: a pale trodden track with a seam of white flowers along it (the polyline is read
 *    per pixel, so it is crisp at every distance).
 *  - The vale's meadow along the brook, the shelterbelts' dark floor (near trees are
 *    real), forest on the foothills as a canopy, the fort's knoll of grey stone.
 *  - Light: the sun through the deck's gaps (grainfields-light lightSurface), sky fill, gold
 *    bounce, then the air. A clear's trail of wind and a four-line flare are drawn into the grain.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    atan,
    attribute,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    max,
    min,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    select,
    sin,
    smoothstep,
    texture,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { DEG, EYE, PLACES } from './grainfields-core.js';
import {
    PLOT, beltAt, forestCover, groundHeight,
} from './grainfields-plan.js';
import { gfHash21, PATH_ROWS } from './grainfields-tsl.js';
import { aerial, lightSurface, sunGlow } from './grainfields-light.js';

/** The fan: half-width (degrees) of the bearings it covers, and its nearest and farthest rows. */
export const FAN = Object.freeze({ halfAngle: 54, near: 0.4, far: 60000 });

/** Linear albedos. */
export const SOIL = Object.freeze({
    barley: [0.52, 0.41, 0.064],
    wheat: [0.52, 0.34, 0.056],
    oats: [0.5, 0.43, 0.16],
    green: [0.15, 0.24, 0.045],
    stubble: [0.39, 0.3, 0.13],
    meadow: [0.11, 0.19, 0.05],
    heath: [0.06, 0.068, 0.03],
    track: [0.36, 0.31, 0.24],
    flower: [0.74, 0.74, 0.67],
    beltFloor: [0.03, 0.055, 0.025],
    canopy: [0.028, 0.058, 0.032],
    canopyLit: [0.075, 0.1, 0.04],
    rock: [0.21, 0.205, 0.19],
});

const c3 = (rgb) => vec3(rgb[0], rgb[1], rgb[2]);

/** The forest canopy's height over its ground (metres): tall stands and lower ones in patches. */
function canopyHeight(x, z) {
    const n = Math.sin(x * 0.019 + 0.3) * Math.cos(z * 0.023 - 1.1) + 0.5 * Math.sin(x * 0.061 - z * 0.047 + 2.2);
    return 17 + 5 * n;
}

/**
 * The mesh's posts as two Float32Arrays (positions xyz, cover: forest, belt, belt kind, unused),
 * `cols × rows` posts, built in slices: a generator that yields between slices.
 */
export function* fanSteps(cols, rows) {
    const positions = new Float32Array(cols * rows * 3);
    const cover = new Float32Array(cols * rows * 4);
    const half = FAN.halfAngle * DEG;
    const lnNear = Math.log(FAN.near);
    const lnFar = Math.log(FAN.far);
    for (let r = 0; r < rows; r++) {
        const dist = Math.exp(lnNear + (lnFar - lnNear) * (r / (rows - 1)));
        for (let c = 0; c < cols; c++) {
            const a = -half + (2 * half * c) / (cols - 1);
            const x = EYE.x + Math.sin(a) * dist;
            const z = EYE.z - Math.cos(a) * dist;
            const h = groundHeight(x, z);
            const forest = forestCover(x, z, h);
            const o = (r * cols + c) * 3;
            positions[o] = x;
            // The forest stands as a canopy over its ground: the ridges' skylines are crowns.
            positions[o + 1] = h + forest * canopyHeight(x, z);
            positions[o + 2] = z;
            const belt = dist < 9000 ? beltAt(x, z) : { cover: 0, kind: 0 };
            const q = (r * cols + c) * 4;
            cover[q] = forest;
            cover[q + 1] = belt.cover;
            cover[q + 2] = belt.kind;
            cover[q + 3] = 0;
        }
        if (r % 24 === 23) yield r;
    }
    return { positions, cover };
}

export function createFanGeometry({ positions, cover }, cols, rows) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aCover', new THREE.BufferAttribute(cover, 4));
    const index = new Uint32Array((cols - 1) * (rows - 1) * 6);
    let k = 0;
    for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
            const a = r * cols + c;
            const b = a + 1;
            const d = a + cols;
            const e = d + 1;
            // Counter-clockwise seen from above (rows run away from the eye, columns left to right).
            index[k++] = a;
            index[k++] = b;
            index[k++] = d;
            index[k++] = b;
            index[k++] = e;
            index[k++] = d;
        }
    }
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.boundingSphere.radius = FAN.far * 1.2;
    return geometry;
}

/** The path's distance (metres) and its flowers' half-width at a ground point (one loop). */
function pathAt(u, xz) {
    const best = float(1e6).toVar();
    const width = float(4.0).toVar();
    Loop({
        start: int(0), end: int(PATH_ROWS - 1), type: 'int', condition: '<', name: 'seg',
    }, ({ seg }) => {
        const a = u.path.element(seg);
        const b = u.path.element(seg.add(1));
        const v = b.xy.sub(a.xy);
        const tt = clamp(dot(xz.sub(a.xy), v).div(max(dot(v, v), 1e-3)), 0.0, 1.0);
        const d = length(xz.sub(a.xy.add(v.mul(tt))));
        const closer = d.lessThan(best);
        width.assign(select(closer, mix(a.w, b.w, tt), width));
        best.assign(min(best, d));
    });
    return { distance: best, width };
}

/**
 * The clears' trails of wind at a ground point: how strongly the grain is laid over there now
 * (0..1), the cleared rows' colour carried along (the chaff), and which way the lane's wind pushes
 * the stalks (xz).
 */
export function trailsAt(u, xz) {
    const lay = float(0.0).toVar();
    const tint = vec3(0.0).toVar();
    const push = vec2(0.0).toVar();
    Loop({
        start: int(0), end: u.trailCount, type: 'int', condition: '<', name: 'tr',
    }, ({ tr }) => {
        const a = u.trails.element(tr.mul(3));
        const b = u.trails.element(tr.mul(3).add(1));
        const c = u.trails.element(tr.mul(3).add(2));
        const age = u.time.sub(a.z);
        // The trail's centre line: out along its heading, curling as it goes (a slow arc).
        const rel = xz.sub(a.xy);
        const along = dot(rel, b.xy);
        const across0 = rel.x.mul(b.y).sub(rel.y.mul(b.x));
        const curl = along.mul(along).mul(b.z);
        const wave = sin(along.mul(0.011).add(a.w.mul(3.0))).mul(along.mul(0.06));
        const across = across0.sub(curl).sub(wave);
        // The head runs out fast, slowing; the lane behind it settles over a few seconds.
        const head = float(1.0).sub(exp(age.mul(-0.55))).mul(2600.0);
        const behind = head.sub(along);
        const inLane = smoothstep(-40.0, 0.0, behind).mul(exp(max(behind, 0.0).div(-420.0)));
        const widthM = b.w.mul(along.mul(0.0025).add(1.0));
        const lane = exp(across.mul(across).div(widthM.mul(widthM)).negate()).mul(smoothstep(0.0, 30.0, along));
        const live = smoothstep(0.0, 0.25, age).mul(float(1.0).sub(smoothstep(4.0, 7.5, age)));
        const k = lane.mul(inLane).mul(live).mul(a.w);
        lay.addAssign(k);
        tint.addAssign(c.xyz.mul(k));
        // The lane's wind runs out along its heading: the stalks lie over away from the eye.
        push.addAssign(b.xy.mul(k));
    });
    return { lay: clamp(lay, 0.0, 1.0), tint, push };
}

/**
 * The pulses of wind at a ground point: which way the grain is pushed and how hard (a vector in
 * xz), and how far it is laid over (0..1.2). A ring runs outward from its centre (a hard drop's
 * downdraft; a level-up's wave is a wide, fast one); a whirl wheels round its centre in spiral
 * arms (a T-spin).
 */
export function pulsesAt(u, xz) {
    const push = vec2(0.0).toVar();
    const lay = float(0.0).toVar();
    Loop({
        start: int(0), end: u.pulseCount, type: 'int', condition: '<', name: 'pu',
    }, ({ pu }) => {
        const a = u.pulses.element(pu.mul(2));
        const b = u.pulses.element(pu.mul(2).add(1));
        const age = u.time.sub(a.z);
        const rel = xz.sub(a.xy);
        const r = max(length(rel), 0.01);
        const dir = rel.div(r);
        const off = r.sub(age.mul(b.y));
        const band = exp(off.mul(off).div(b.z.mul(b.z)).negate())
            .mul(smoothstep(0.0, 0.15, age)).mul(float(1.0).sub(smoothstep(2.5, 6.0, age)));
        const angle = atan(dir.y, dir.x);
        const arms = sin(angle.mul(3.0).sub(age.mul(4.5)).add(r.mul(0.22))).mul(0.4).add(0.6);
        const whirl = exp(r.mul(r).div(b.z.mul(b.z)).negate()).mul(arms)
            .mul(smoothstep(0.0, 0.6, age)).mul(float(1.0).sub(smoothstep(3.5, 7.0, age)));
        const isWhirl = b.x.greaterThan(0.5).and(b.x.lessThan(1.5));
        const k = select(isWhirl, whirl, band).mul(a.w).toVar();
        const tangent = normalize(vec2(dir.y.negate(), dir.x).add(dir.mul(-0.3)));
        push.addAssign(select(isWhirl, tangent, dir).mul(k));
        lay.addAssign(k);
    });
    return { push, lay: clamp(lay, 0.0, 1.2) };
}

/**
 * The wind's gusts at a ground point (0 still … ~1.4 a strong gust): two reads of the noise
 * running along the wind (the gust's phase is integrated on the CPU), banded. The land reads it
 * per pixel; the barley in its vertex stage (`vertex`: an explicit mip, no derivatives there).
 */
export function gustAt(u, noise, xz, vertex = false) {
    const along = dot(xz, u.windDir);
    const across = xz.x.mul(u.windDir.y).sub(xz.y.mul(u.windDir.x));
    const read = (st) => (vertex ? texture(noise, st).level(1) : texture(noise, st));
    const g1 = read(vec2(along.sub(u.gust).div(700.0), across.div(1600.0))).r;
    const g2 = read(vec2(along.sub(u.gust.mul(1.35)).div(260.0), across.div(620.0)).add(0.37)).g;
    return smoothstep(0.4, 0.78, g1.mul(0.55).add(g2.mul(0.45))).mul(u.windStrength.min(1.4));
}

const PLOT_COS = Math.cos(PLOT.angle * DEG);
const PLOT_SIN = Math.sin(PLOT.angle * DEG);

/**
 * The patchwork at a ground point: the plot's id (0..1) and how close the point is to the plot's
 * edge (metres). The land and the barley round the eye read the same, so a plant takes its plot's
 * crop. Inline (it calls a laid-out hash only).
 */
export function plotOf(xz) {
    const pu = xz.x.mul(PLOT_COS).sub(xz.y.mul(PLOT_SIN));
    const pv = xz.x.mul(PLOT_SIN).add(xz.y.mul(PLOT_COS));
    const row = floor(pv.div(PLOT.along));
    const shift = gfHash21(vec2(row, 7.0)).mul(PLOT.across);
    const width = gfHash21(vec2(row, 11.0)).mul(0.6).add(0.7).mul(PLOT.across);
    const plotCol = floor(pu.add(shift).div(width));
    const fu = fract(pu.add(shift).div(width));
    const fv = fract(pv.div(PLOT.along));
    const edge = min(min(fu, float(1.0).sub(fu)).mul(width), min(fv, float(1.0).sub(fv)).mul(PLOT.along));
    const id = gfHash21(vec2(plotCol, row.add(31.0)));
    return { id, edge };
}

/** The grain's albedo for a plot id (0..1): mostly barley, then wheat, oats, green, stubble. */
export function cropColour(id) {
    const barley = c3(SOIL.barley);
    const crop = barley.toVar();
    crop.assign(mix(crop, c3(SOIL.wheat), smoothstep(0.5, 0.51, id).mul(float(1.0).sub(smoothstep(0.7, 0.71, id)))));
    crop.assign(mix(crop, c3(SOIL.oats), smoothstep(0.7, 0.71, id).mul(float(1.0).sub(smoothstep(0.82, 0.83, id)))));
    crop.assign(mix(crop, c3(SOIL.green), smoothstep(0.88, 0.89, id).mul(float(1.0).sub(smoothstep(0.95, 0.96, id)))));
    crop.assign(mix(crop, c3(SOIL.stubble), smoothstep(0.96, 0.97, id)));
    return crop;
}

export function createLandMaterial(u, t) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'GrainfieldsLand';
    material.fog = false;
    const vCover = varying(attribute('aCover', 'vec4'), 'gfLandCover');
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const xz = P.xz.toVar();
        const V = P.sub(u.eye).toVar();
        const dist = length(V).toVar();
        const view = V.div(dist).toVar();
        // Normal: the mesh's own (the posts carry the land's slope).
        const Nm = normalize(normalWorld).toVar();

        const forest = vCover.x.toVar();
        const belt = vCover.y.toVar();

        // ── The patchwork ──
        const plot = plotOf(xz);
        const edge = plot.edge.toVar();
        const crop = cropColour(plot.id.toVar()).toVar();
        // The grain breathes across a plot (ripeness, a damp hollow), finer grain on top.
        const broad = texture(t.noise, xz.div(2600.0)).g;
        const fine = texture(t.noise, xz.div(96.0)).a;
        crop.mulAssign(broad.mul(0.32).add(0.82).mul(fine.mul(0.14).add(0.93)));
        // Under the barley round the eye the carpet is the stand's shaded floor (the plants stand
        // on it); out where they end it becomes the canopy itself.
        crop.mulAssign(mix(float(0.5), float(1.0), smoothstep(70.0, 150.0, dist)));
        // Thin tracks between the plots (darker, greener).
        const trackW = dist.mul(0.0012).add(1.1);
        const track = float(1.0).sub(smoothstep(trackW.mul(0.5), trackW, edge));
        const albedo = mix(crop, c3(SOIL.meadow).mul(1.1), track.mul(0.75)).toVar();

        // ── The wind's gusts: travelling bands of paler sheen ──
        const gust = gustAt(u, t.noise, xz).toVar();
        const trails = trailsAt(u, xz);
        const pulses = pulsesAt(u, xz);
        const laid = clamp(gust.add(trails.lay).add(pulses.lay), 0.0, 1.5).toVar();
        // Grain laid over shows its paler sides.
        const isGrain = float(1.0).sub(track).mul(float(1.0).sub(belt)).mul(float(1.0).sub(forest))
            .toVar();
        albedo.assign(mix(albedo, albedo.mul(1.32).add(vec3(0.05, 0.045, 0.03)), laid.mul(0.42).mul(isGrain)));

        // ── The vale's meadow along the brook ──
        const valeMeadow = smoothstep(3.6, 1.8, P.y).mul(isGrain);
        albedo.assign(mix(albedo, c3(SOIL.meadow).mul(fine.mul(0.3).add(0.85)), valeMeadow));

        // ── The path: the trodden track and its seam of white flowers ──
        const path = pathAt(u, xz);
        const flowerW = path.width;
        const pixel = dist.mul(u.pixelAngle).mul(1.5);
        const onTrack = float(1.0).sub(smoothstep(1.0, max(1.25, float(1.0).add(pixel)), path.distance));
        const flowerEdge = flowerW.mul(fine.mul(0.5).add(0.75));
        const onFlowers = float(1.0).sub(smoothstep(flowerEdge.mul(0.7), flowerEdge.add(pixel), path.distance));
        const speck = smoothstep(0.35, 0.7, texture(t.noise, xz.div(7.0)).a);
        const flowers = mix(c3(SOIL.meadow), c3(SOIL.flower), speck.mul(0.55).add(0.45));
        albedo.assign(mix(albedo, flowers, onFlowers.mul(float(1.0).sub(belt))));
        albedo.assign(mix(albedo, c3(SOIL.track), onTrack));

        // ── Shelterbelts' floor, the forest's canopy far away ──
        albedo.assign(mix(albedo, c3(SOIL.beltFloor), belt));
        // Crowns: light and dark tens of metres across, a stand's tone over hundreds.
        const canopyTone = texture(t.noise, xz.div(1400.0)).b;
        const crowns = texture(t.noise, xz.div(260.0)).a;
        const canopy = mix(c3(SOIL.canopy), c3(SOIL.canopyLit), canopyTone.mul(0.45).add(crowns.mul(0.45))).toVar();
        canopy.mulAssign(smoothstep(0.2, 0.75, crowns).mul(0.6).add(0.55));
        albedo.assign(mix(albedo, canopy, forest));

        // ── The fort's knoll: grey stone on its steep sides ──
        const F = PLACES.fort;
        const toFort = length(xz.sub(vec2(F.x, F.z)));
        const steep = float(1.0).sub(Nm.y).mul(4.0).clamp(0.0, 1.0);
        const knoll = float(1.0).sub(smoothstep(F.radius * 0.9, F.radius * 1.25, toFort));
        albedo.assign(mix(albedo, c3(SOIL.rock).mul(fine.mul(0.4).add(0.8)), knoll.mul(steep.mul(0.85).add(0.15))));
        albedo.assign(mix(albedo, c3(SOIL.heath).mul(fine.mul(0.35).add(0.8)), knoll.mul(float(1.0).sub(steep)).mul(0.8)));

        // ── Light ──
        const lit = lightSurface(u, t.noise, P, Nm, albedo);
        const col = lit.colour.toVar();
        // The sun ahead lights the field through the awns: a glow that follows the sun's gaps.
        const ahead = sunGlow(dot(view, u.sunDir)).mul(2.2).add(clamp(dot(view, u.sunDir), 0.0, 1.0).mul(0.25));
        col.addAssign(albedo.mul(u.sun).mul(ahead).mul(lit.sunlit).mul(isGrain)
            .mul(0.42));
        // A gust's sheen catches the sky a little.
        col.addAssign(u.fill.mul(laid).mul(isGrain).mul(0.1));
        // A clear's trail carries its rows' colour as chaff glinting in the lane.
        col.addAssign(trails.tint.mul(0.55).mul(lit.sunlit.mul(0.7).add(0.3)).mul(isGrain));
        // Four lines: the light's front runs out of the gate over the fields toward the eye.
        const fromGate = length(xz.sub(vec2(PLACES.gate.x, PLACES.gate.z)));
        const fd = fromGate.sub(u.flareFront).div(900.0);
        const front = exp(fd.mul(fd).negate()).mul(u.flare);
        col.addAssign(u.sun.mul(albedo).mul(front).mul(0.9));
        return vec4(aerial(u, P, col), 1.0);
    })();
    return material;
}

export function createLand(u, t, tier, prepared) {
    const { cols, rows } = tier.fan;
    const geometry = createFanGeometry(prepared.fan, cols, rows);
    const material = createLandMaterial(u, t);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'GrainfieldsLand';
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
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
