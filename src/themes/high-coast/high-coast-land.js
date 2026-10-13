/**
 * High Coast — the land (mesh + granite material).
 *
 * The mesh is a fan laid out for the one eye that looks at it: columns by bearing across the
 * widest frame any screen shows, rows by log-distance from a few metres to fifty kilometres, so
 * every triangle covers about the same few pixels wherever it lies. Heights come from the baked
 * fields (bicubic). Far forests are lifted by their canopy (near ones are real trees).
 *
 * The material is unlit: it lights itself.
 *  - Rapakivi granite: weathered grey-pink, grey crust lichen where the weather reaches, yellow-
 *    green map lichen in patches, salmon-red where a face is fresh. A heightfield cannot hold a
 *    vertical face (its triangles stretch down the cliff), so steep faces are textured in FACE
 *    space (along the face × height): sheeting ledges, vertical joints, block by block in tone,
 *    black ink streaks running down from the ledges.
 *  - Near the eye the rock's detail is scaled to the pixel: crust-lichen rosettes, crystals,
 *    cracks; reindeer lichen, crowberry and heather fill the hollows, never the polished crowns.
 *  - The shore's zones, keyed to the sea at rest: the black zone at the waterline, a thin, patchy
 *    orange Xanthoria band in the spray, grey lichen above.
 *  - The rising land: rock the sea has just given up is bare (an algae film near its foot), dark
 *    and wet, glints in the sun and runs with seawater after a lift; it dries from the top down.
 *  - Forest (floor under near trees, canopy far away), shingle fields (rounded grey cobbles).
 *  - Light: sun (soft terrain shadows from the shadow pass, cloud shadows), sky fill by the baked
 *    sky visibility, warm granite bounce, then the air.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    normalize,
    positionLocal,
    positionWorld,
    sin,
    smoothstep,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { DEG, EYE } from './high-coast-core.js';
import { groundHeight } from './high-coast-field.js';
import {
    fieldScalar, hcHash21, hcHash22, hcLuma, landAt,
} from './high-coast-tsl.js';
import { shadowAt } from './high-coast-shadow.js';
import { aerial, cloudShadow } from './high-coast-light.js';

/** The fan: half-width (degrees) of the bearings it covers, and its nearest and farthest rows. */
export const FAN = Object.freeze({ halfAngle: 48, near: 3, far: 48000 });
/** Beyond this distance a forest is drawn as a raised canopy (nearer, the trees are real). */
export const CANOPY = Object.freeze({ from: 2600, to: 3600, height: 13 });

/** Linear albedos. */
export const ROCK = Object.freeze({
    granite: [0.24, 0.2, 0.17],
    pink: [0.3, 0.19, 0.15],
    fresh: [0.4, 0.17, 0.11],
    grey: [0.27, 0.27, 0.26],
    pale: [0.46, 0.44, 0.4],
    mapLichen: [0.3, 0.36, 0.08],
    ink: [0.035, 0.03, 0.028],
    blackZone: [0.03, 0.028, 0.025],
    xanthoria: [0.5, 0.24, 0.04],
    bare: [0.2, 0.17, 0.15],
    algae: [0.07, 0.075, 0.035],
    shingle: [0.27, 0.27, 0.26],
    forestFloor: [0.03, 0.045, 0.022],
    canopy: [0.026, 0.055, 0.028],
    canopyLit: [0.065, 0.11, 0.04],
    heather: [0.13, 0.065, 0.085],
    crowberry: [0.032, 0.045, 0.022],
    reindeer: [0.5, 0.52, 0.44],
    blueberry: [0.05, 0.09, 0.03],
});

const c3 = (rgb) => vec3(rgb[0], rgb[1], rgb[2]);

/**
 * The mesh's positions as a Float32Array (x, y, z per post), `cols × rows` posts, built in
 * slices: a generator that yields between slices and returns the array.
 */
export function* fanPositionSteps(fields, cols, rows) {
    const positions = new Float32Array(cols * rows * 3);
    const half = FAN.halfAngle * DEG;
    const lnNear = Math.log(FAN.near);
    const lnFar = Math.log(FAN.far);
    for (let r = 0; r < rows; r++) {
        const dist = Math.exp(lnNear + (lnFar - lnNear) * (r / (rows - 1)));
        for (let c = 0; c < cols; c++) {
            const a = -half + (2 * half * c) / (cols - 1);
            const x = EYE.x + Math.sin(a) * dist;
            const z = EYE.z - Math.cos(a) * dist;
            const o = (r * cols + c) * 3;
            positions[o] = x;
            positions[o + 1] = groundHeight(fields, x, z, dist < 3000);
            positions[o + 2] = z;
        }
        if (r % 48 === 47) yield r;
    }
    return positions;
}

export function createFanGeometry(positions, cols, rows) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const index = new Uint32Array((cols - 1) * (rows - 1) * 6);
    let k = 0;
    for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
            const a = r * cols + c;
            const b = a + 1;
            const d = a + cols;
            const e = d + 1;
            index[k++] = a;
            index[k++] = b;
            index[k++] = d;
            index[k++] = b;
            index[k++] = e;
            index[k++] = d;
        }
    }
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeBoundingSphere();
    geometry.boundingSphere.radius = FAN.far * 1.2;
    return geometry;
}

/**
 * Voronoi cells at a point (scaled): (distance to the nearest centre, to the second, cell id).
 * Laid out, so its body is emitted once however many times the land calls it.
 */
export const hcCells = /* @__PURE__ */ Fn(([p]) => {
    const ip = floor(p);
    const fp = fract(p);
    const d1 = float(8.0).toVar();
    const d2 = float(8.0).toVar();
    const id = float(0.0).toVar();
    for (let j = -1; j <= 1; j += 1) {
        for (let i = -1; i <= 1; i += 1) {
            const o = vec2(i, j);
            const h = hcHash22(ip.add(o));
            const d = length(o.add(h).sub(fp));
            If(d.lessThan(d1), () => {
                d2.assign(d1);
                d1.assign(d);
                id.assign(h.x);
            }).ElseIf(d.lessThan(d2), () => {
                d2.assign(d);
            });
        }
    }
    return vec3(d1, d2, id);
}).setLayout({ name: 'hc_cells', type: 'vec3', inputs: [{ name: 'p', type: 'vec2' }] });

/** Within this distance of the eye the summit's rock has relief of its own (metres). */
export const OUTCROP = Object.freeze({ near: 48, far: 78, floor: 118 });

/**
 * The noise tile packs lattices of period 8 (r), 16 (g), 32 (b) and 64 (a): a read at xz / D has
 * features D / period metres wide. The summit's reads are sized by that.
 */
const SWELL = 28.0; // r: 3.5 m swells of glacier-polished rock

/** The summit's swells (0..1, smooth enough for the mesh: the finest octave blurred away). */
function swellAt(t, xz) {
    return texture(t.noise, xz.div(SWELL)).level(2).r;
}

/** Where soil gathers on the summit (0..1): in the swells' dips, in metre-wide patches. Smooth. */
export function nearHollow(t, xz) {
    const dip = float(1.0).sub(smoothstep(0.38, 0.48, swellAt(t, xz)));
    const patch = smoothstep(0.38, 0.52, texture(t.noise, xz.div(16.0).add(vec2(0.11, 0.53))).level(1).g);
    return dip.mul(patch);
}

/**
 * The summit's own relief near the eye (metres to add): glacier-polished humps and low cushions
 * of crowberry and heather in the hollows. Smooth on purpose: the fan's rows are ~0.4 m apart
 * here, so anything finer than a couple of metres would alias into spikes in the vertex stage
 * (the joints' grooves and the shrubs' tufts are the fragment's: `outcropDetail`). Zero beyond
 * OUTCROP.far and below OUTCROP.floor (only the summit has it). Explicit lod: the vertex stage
 * reads it too.
 */
export function outcropRelief(u, t, xz, y) {
    const d = length(xz.sub(u.eye.xz));
    const fade = float(1.0).sub(smoothstep(OUTCROP.near, OUTCROP.far, d)).mul(smoothstep(OUTCROP.floor, OUTCROP.floor + 8.0, y));
    const swell = swellAt(t, xz).sub(0.5).mul(1.1);
    const cushion = nearHollow(t, xz).mul(0.14);
    return swell.add(cushion).mul(fade);
}

/** The fine detail the vertex stage cannot carry: the joints' grooves and the shrubs' tufts. */
export function outcropDetail(t, xz) {
    const sheets = hcCells(xz.div(3.4));
    const groove = float(1.0).sub(smoothstep(0.0, 0.1, sheets.y.sub(sheets.x))).mul(0.12);
    const hollow = nearHollow(t, xz);
    const tuft = texture(t.noise, xz.div(6.0).add(vec2(0.5, 0.17))).b.mul(0.07);
    return hollow.mul(tuft).sub(groove.mul(float(1.0).sub(hollow)));
}

/**
 * Face-space rock on a steep face: (shade multiplier, ink, block tone) from where a point lies
 * along the face and how high. Sheeting ledges every ~9 m (a lit lip, a dark undercut), vertical
 * joints every ~14 m, each block its own tone, ink streaks hanging below the ledges.
 */
export function cliffFace(t, faceU, faceV) {
    const wob = texture(t.noise, vec2(faceU.div(70.0), faceV.div(50.0))).r.sub(0.5);
    const lv = faceV.div(9.0).add(wob.mul(0.8)).toVar();
    const ju = faceU.div(14.0).add(texture(t.noise, vec2(faceV.div(40.0), faceU.div(90.0))).g.sub(0.5).mul(0.6)).toVar();
    const fv = fract(lv);
    const fu = fract(ju);
    const lip = smoothstep(0.86, 0.97, fv).mul(float(1.0).sub(smoothstep(0.97, 1.0, fv)));
    const undercut = float(1.0).sub(smoothstep(0.0, 0.14, fv));
    const joint = float(1.0).sub(smoothstep(0.0, 0.045, min(fu, float(1.0).sub(fu))));
    const block = hcHash21(vec2(floor(lv), floor(ju)));
    const shade = float(1.0).add(lip.mul(0.38)).sub(undercut.mul(0.42)).sub(joint.mul(0.5))
        .mul(block.mul(0.22).add(0.89));
    // Ink: streaks of dark crust running down from each ledge, thinning toward the next.
    const streak = smoothstep(0.58, 0.82, texture(t.noise, vec2(faceU.div(3.2), faceV.div(60.0))).g)
        .mul(fv.mul(0.6).add(0.4));
    return vec3(shade, streak, block);
}

/**
 * The land's albedo at a point. Returns vec4(albedo, wetness 0..1).
 */
export function landAlbedo(u, t, P, n, slope, forest, footprint, { detail = true } = {}) {
    const { xz } = P;
    const N1 = texture(t.noise, xz.div(57.0));
    const N2 = texture(t.noise, xz.div(13.0).add(vec2(0.31, 0.77)));
    // ── Granite: weathered grey-pink, pinker in patches, greyer where long in the weather ──
    const steep = smoothstep(0.75, 1.5, slope).toVar();
    const weather = smoothstep(0.3, 0.75, N1.r.add(n.y.mul(0.3)).sub(steep.mul(0.45)));
    const albedo = mix(c3(ROCK.pink), c3(ROCK.granite), smoothstep(0.35, 0.65, N2.g)).toVar();
    albedo.assign(mix(albedo, c3(ROCK.grey), weather.mul(0.55)));
    albedo.assign(mix(albedo, c3(ROCK.fresh), steep.mul(smoothstep(0.4, 0.7, N1.b)).mul(0.55)));
    // Map lichen: yellow-green islands on the weathered slabs.
    const lichen = smoothstep(0.64, 0.72, N2.b).mul(weather).mul(float(1.0).sub(steep));
    albedo.assign(mix(albedo, c3(ROCK.mapLichen), lichen.mul(0.5)));
    // ── The shore's zones, keyed to the sea at rest (thin: metres, not tens of metres) ──
    const above = P.y;
    const black = float(1.0).sub(smoothstep(0.35, 1.0, above)).mul(smoothstep(-0.5, 0.1, above));
    const orange = smoothstep(0.7, 1.2, above).mul(float(1.0).sub(smoothstep(1.6, 2.6, above.add(N2.r.mul(0.8)))))
        .mul(smoothstep(0.5, 0.66, N2.a));
    albedo.assign(mix(albedo, c3(ROCK.xanthoria), orange.mul(0.55)));
    albedo.assign(mix(albedo, c3(ROCK.blackZone), black.mul(0.8)));
    // ── The rising land: below the old waterline the rock is bare, an algae film at its foot ──
    const risen = float(1.0).sub(smoothstep(-0.7, -0.05, above));
    const algae = smoothstep(u.sea.add(2.5), u.sea, above);
    const bare = mix(c3(ROCK.bare).mul(N1.g.mul(0.6).add(0.6)).mul(N2.r.mul(0.4).add(0.8)), c3(ROCK.algae), algae.mul(0.75));
    albedo.assign(mix(albedo, bare, risen.mul(0.9)));

    // ── Near the eye: the rock's own detail, scaled to the pixel ──
    const room = float(1.0).sub(smoothstep(0.03, 0.22, footprint)).toVar();
    const nearVeg = float(0.0).toVar();
    if (detail) {
        If(room.greaterThan(0.01), () => {
            const M1 = texture(t.noise, xz.div(12.0).add(vec2(0.11, 0.53)));
            const M2 = texture(t.noise, xz.div(4.0).add(vec2(0.67, 0.23)));
            albedo.assign(mix(albedo, mix(vec3(0.25, 0.235, 0.215), vec3(0.3, 0.24, 0.2), M1.g), room.mul(0.65)));
            const crust = smoothstep(0.6, 0.64, texture(t.noise, xz.div(8.0).add(vec2(0.77, 0.12))).b.add(M2.a.mul(0.12)));
            albedo.assign(mix(albedo, vec3(0.4, 0.42, 0.37), crust.mul(room).mul(0.45)));
            const sooty = smoothstep(0.62, 0.68, texture(t.noise, xz.div(3.0).add(vec2(0.31, 0.66))).r);
            albedo.assign(mix(albedo, vec3(0.06, 0.06, 0.055), sooty.mul(room).mul(0.55)));
            // Joints and cracks: dark lines along the edges of the rock's sheets.
            const sheets = hcCells(xz.div(3.2));
            const open = smoothstep(0.45, 0.6, texture(t.noise, xz.div(12.0).add(vec2(0.3, 0.9))).r);
            const crack = float(1.0).sub(smoothstep(0.0, 0.035, sheets.y.sub(sheets.x))).mul(open).mul(float(1.0).sub(smoothstep(0.03, 0.12, footprint)));
            albedo.mulAssign(float(1.0).sub(crack.mul(0.65).mul(room)));
            // Crystals: rapakivi's big feldspar ovoids, pink in a darker matrix.
            const crystals = hcCells(xz.div(0.045));
            const ovoid = smoothstep(0.2, 0.05, crystals.x).mul(0.12).mul(float(1.0).sub(smoothstep(0.008, 0.025, footprint)));
            albedo.mulAssign(float(1.0).add(ovoid.mul(room)));
            // Crust-lichen rosettes: grey-white and yellow-green dots, centimetres to a hand across.
            const rosettes = hcCells(xz.div(0.22));
            const dot1 = smoothstep(0.32, 0.18, rosettes.x).mul(smoothstep(0.55, 0.75, rosettes.z))
                .mul(float(1.0).sub(smoothstep(0.04, 0.12, footprint)));
            const tone = mix(c3(ROCK.pale), c3(ROCK.mapLichen).mul(1.4), smoothstep(0.82, 0.9, rosettes.z));
            albedo.assign(mix(albedo, tone, dot1.mul(room).mul(0.4).mul(float(1.0).sub(steep))));
            // Hollows: where soil gathers, reindeer lichen, crowberry and heather; the crowns bare.
            const tuft = texture(t.noise, xz.div(6.0).add(vec2(0.5, 0.17))).b;
            const hollow = smoothstep(0.25, 0.7, nearHollow(t, xz).add(tuft.sub(0.5).mul(0.3)));
            // One mass that drifts from crowberry to heather over metres, lit and shaded tuft by tuft.
            const veg = mix(c3(ROCK.crowberry), c3(ROCK.heather), smoothstep(0.3, 0.7, M1.r)).toVar();
            veg.assign(mix(veg, c3(ROCK.blueberry), smoothstep(0.62, 0.75, M1.b).mul(0.4)));
            veg.mulAssign(tuft.mul(0.7).add(0.65));
            // Reindeer lichen: a pale fringe where the cushion meets the bare rock.
            const rim = hollow.mul(float(1.0).sub(hollow)).mul(4.0);
            veg.assign(mix(veg, c3(ROCK.reindeer).mul(0.8), rim.mul(smoothstep(0.45, 0.6, M2.b)).mul(0.6)));
            nearVeg.assign(hollow.mul(room).mul(float(1.0).sub(steep)).mul(smoothstep(4.0, 8.0, above)));
            albedo.assign(mix(albedo, veg, nearVeg));
        });
    } else {
        // The lowest tiers: the cushions alone (two reads), no crusts, cracks or crystals.
        nearVeg.assign(smoothstep(0.25, 0.7, nearHollow(t, xz)).mul(room).mul(float(1.0).sub(steep)).mul(smoothstep(4.0, 8.0, above)));
        albedo.assign(mix(albedo, mix(c3(ROCK.crowberry), c3(ROCK.heather), 0.45), nearVeg));
    }
    // ── Far cover ──
    const gentle = float(1.0).sub(smoothstep(0.45, 0.9, slope));
    const heathMask = smoothstep(2.5, 8.0, above).mul(gentle).mul(float(1.0).sub(forest)).mul(float(1.0).sub(room));
    const heath = mix(c3(ROCK.heather), c3(ROCK.crowberry), smoothstep(0.35, 0.65, N2.r)).toVar();
    heath.assign(mix(heath, c3(ROCK.reindeer), smoothstep(0.66, 0.74, N2.b.add(N1.a.mul(0.2))).mul(0.7)));
    albedo.assign(mix(albedo, heath, heathMask.mul(smoothstep(0.42, 0.62, N1.a.add(n.y.mul(0.2)))).mul(0.6)));
    // Forest: the floor under the near trees, the canopy's own colour far away.
    const far = smoothstep(800.0, 2600.0, length(P.sub(u.eye)));
    const canopyTone = mix(c3(ROCK.canopy), c3(ROCK.canopyLit), smoothstep(0.4, 0.7, texture(t.noise, xz.div(9.0)).a));
    albedo.assign(mix(albedo, mix(c3(ROCK.forestFloor), canopyTone, far), smoothstep(0.15, 0.55, forest)));
    // The hamlet's yard: a summer meadow, green with buttercups and clover.
    const yard = float(1.0).sub(smoothstep(40.0, 78.0, length(xz.sub(vec2(178.0, -512.0))))).mul(smoothstep(1.8, 3.2, above)).mul(gentle);
    const meadow = mix(vec3(0.07, 0.11, 0.03), vec3(0.13, 0.17, 0.04), N2.g).add(vec3(0.12, 0.1, 0.0).mul(smoothstep(0.78, 0.86, N2.b)));
    albedo.assign(mix(albedo, meadow, yard.mul(0.9)));
    // Shingle fields: rounded grey cobbles in beach ridges.
    const shingle = shingleMaskNode(xz, above);
    If(shingle.greaterThan(0.01), () => {
        let stones = float(0.5);
        if (detail) {
            const cells = hcCells(xz.div(0.42));
            const near = float(1.0).sub(smoothstep(0.05, 0.25, footprint));
            stones = mix(float(0.55), smoothstep(0.02, 0.18, cells.y.sub(cells.x)).mul(cells.z.mul(0.5).add(0.6)), near);
        }
        albedo.assign(mix(albedo, c3(ROCK.shingle).mul(stones.mul(0.6).add(0.55)), shingle));
    });
    // Wetness: the band the sea has just left, drying from the top down.
    const band = clamp(u.wetLine.sub(u.sea), 0.001, 40.0);
    const wet = float(1.0).sub(smoothstep(u.sea.sub(0.05), u.wetLine.add(band.mul(0.08)), P.y))
        .mul(smoothstep(u.sea.sub(0.6), u.sea.add(0.02), P.y));
    return vec4(albedo, wet);
}

/** The plan's shingle mask (high-coast-plan.js shingleMask), the same numbers on the GPU. */
export function shingleMaskNode(xz, h) {
    // Squares by multiplication: pow() of a negative base is undefined in WGSL.
    const sq = (v) => v.mul(v);
    const a = exp(sq(xz.x.add(700.0).div(170.0)).add(sq(xz.y.add(560.0).div(150.0))).negate());
    const b = exp(sq(xz.x.add(560.0).div(120.0)).add(sq(xz.y.add(860.0).div(110.0))).negate()).mul(0.8);
    const band = smoothstep(18.0, 34.0, h).mul(float(1.0).sub(smoothstep(120.0, 150.0, h)));
    return clamp(a.add(b).mul(band).mul(1.6).sub(0.15), 0.0, 1.0);
}

/**
 * @param {object} u        shared uniforms
 * @param {object} t        textures: fields { near, mid, far }, cover { near, mid, far }, shadow
 *                          { near, mid, far }, noise
 * @param {object} tier     quality tier (detail: 0..2)
 */
export function createLandMaterial(u, t, tier) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HighCoastLand';
    material.fog = false;

    // Far forests stand up by their canopy (the near ones are real trees).
    material.positionNode = Fn(() => {
        const p = positionLocal;
        const d = length(p.xz.sub(u.eye.xz));
        const forest = fieldScalar(t.cover, p.xz, 0.0);
        const lift = forest.mul(smoothstep(CANOPY.from, CANOPY.to, d)).mul(CANOPY.height);
        const relief = outcropRelief(u, t, p.xz, p.y);
        return p.add(vec3(0.0, lift.add(relief), 0.0));
    })();

    material.colorNode = Fn(() => {
        const P = positionWorld;
        const { xz } = P;
        const land = landAt(t.fields, xz).toVar();
        const V = P.sub(u.eye);
        const dist = length(V).toVar();
        const footprint = dist.mul(u.pixelAngle).toVar();
        const grad = land.yz.toVar();
        const slope = length(grad).toVar();
        const forest = fieldScalar(t.cover, xz, 0.0).toVar();

        // ── Detail near the eye: crystals, knobbles and cracks bend the normal ──
        const detailG = vec2(0.0).toVar();
        if (tier.detail > 0) {
            const room = float(1.0).sub(smoothstep(0.06, 0.45, footprint));
            If(room.greaterThan(0.01), () => {
                const e = 0.3;
                const h0 = texture(t.noise, xz.div(2.6)).r;
                const hx = texture(t.noise, xz.add(vec2(e, 0.0)).div(2.6)).r;
                const hz = texture(t.noise, xz.add(vec2(0.0, e)).div(2.6)).r;
                detailG.addAssign(vec2(hx.sub(h0), hz.sub(h0)).mul(room).mul(0.6));
                if (tier.detail > 1) {
                    const g0 = texture(t.noise, xz.div(3.2)).a;
                    const gx = texture(t.noise, xz.add(vec2(0.02, 0.0)).div(3.2)).a;
                    const gz = texture(t.noise, xz.add(vec2(0.0, 0.02)).div(3.2)).a;
                    detailG.addAssign(vec2(gx.sub(g0), gz.sub(g0)).mul(room).mul(0.35));
                }
            });
        }
        If(dist.lessThan(OUTCROP.far).and(P.y.greaterThan(OUTCROP.floor)), () => {
            const e = 0.1;
            // The fine detail fades by its own pixel size (no shimmer as it shrinks).
            const nearRoom = float(1.0).sub(smoothstep(0.02, 0.08, footprint));
            const at = (q) => (tier.detail > 0
                ? outcropRelief(u, t, q, P.y).add(outcropDetail(t, q).mul(nearRoom))
                : outcropRelief(u, t, q, P.y));
            const r0 = at(xz);
            const rx = at(xz.add(vec2(e, 0.0)));
            const rz = at(xz.add(vec2(0.0, e)));
            detailG.addAssign(vec2(rx.sub(r0), rz.sub(r0)).div(e));
        });
        const n = normalize(vec3(grad.x.add(detailG.x).negate(), 1.0, grad.y.add(detailG.y).negate())).toVar();

        const surface = landAlbedo(u, t, P, n, slope, forest, footprint, { detail: tier.detail > 0 }).toVar();
        const albedo = surface.rgb.toVar();
        const wet = surface.w.toVar();

        // ── Steep faces in face space: ledges, joints, blocks, ink ──
        const faceShade = float(1.0).toVar();
        const cliffy = smoothstep(0.85, 1.6, slope).toVar();
        If(cliffy.greaterThan(0.01), () => {
            const along = normalize(vec2(grad.y.negate(), grad.x).add(vec2(1e-5, 0.0)));
            const faceU = dot(xz, along);
            const face = cliffFace(t, faceU, P.y);
            faceShade.assign(mix(float(1.0), face.x, cliffy));
            albedo.assign(mix(albedo, albedo.mul(face.z.mul(0.3).add(0.85)), cliffy));
            albedo.assign(mix(albedo, c3(ROCK.ink), face.y.mul(cliffy).mul(0.7).mul(smoothstep(4.0, 12.0, P.y))));
        });
        // Wet rock is darker and its colour deeper.
        albedo.assign(mix(albedo, mix(vec3(hcLuma(albedo)), albedo, 1.25).mul(0.6), wet.mul(0.8)));

        // ── Light ──
        const L = u.sunDir;
        const ndl = clamp(dot(n, L).add(0.05).div(1.05), 0.0, 1.0);
        const shadow = shadowAt(t.shadow, xz);
        const clouds = cloudShadow(u, t.noise, P);
        const sunLight = u.sun.mul(ndl).mul(shadow).mul(clouds).mul(u.sunUp)
            .mul(faceShade);
        const sky = land.w.mul(0.75).add(0.25);
        const skyLight = u.fill.mul(n.y.mul(0.45).add(0.55)).mul(sky).mul(faceShade.mul(0.5).add(0.5));
        const bounce = u.bounce.mul(float(1.0).sub(n.y).mul(0.6).add(0.15)).mul(sky);
        const lit = albedo.mul(sunLight.add(skyLight).add(bounce)).toVar();
        // Wet rock glints toward the sun (the risen band shines gold; a four-line rebound flares).
        If(wet.greaterThan(0.01), () => {
            const view = V.div(max(dist, 1e-3)).negate();
            const hv = normalize(view.add(L));
            const spec = dot(n, hv).clamp(0.0, 1.0);
            const s2 = spec.mul(spec);
            const s8 = s2.mul(s2).mul(s2).mul(s2);
            const glint = s8.mul(s8).mul(1.4).add(s8.mul(0.18)).add(s2.mul(0.02));
            lit.addAssign(u.sun.mul(glint).mul(wet).mul(shadow).mul(clouds)
                .mul(u.sunUp)
                .mul(u.rebound.mul(1.5).add(1.0))
                .mul(float(1.0).sub(cliffy.mul(0.8))));
            // The film of water mirrors the sky (and, fresh from the sea, gleams a while).
            const film = float(1.0).sub(dot(view, n).clamp(0.0, 1.0)).pow(3.0).mul(0.22)
                .add(0.02)
                .add(u.drain.mul(0.18));
            // Water stands in the rock's hollows and runs off its crowns: the film is patchy.
            const pools = smoothstep(0.4, 0.62, texture(t.noise, xz.div(40.0).add(vec2(0.37, 0.19))).r);
            lit.addAssign(u.horizon.mul(0.35).add(u.glow.mul(0.25)).mul(film).mul(wet)
                .mul(pools.mul(0.75).add(0.25)));
            // Seawater running off the risen rock: white threads down the steeper faces.
            If(u.drain.greaterThan(0.01), () => {
                const across = dot(xz, vec2(0.83, 0.56)).mul(1.7);
                const run = texture(t.noise, vec2(across, P.y.mul(0.35).add(u.time.mul(1.6)))).g;
                const threads = smoothstep(0.6, 0.8, run).mul(smoothstep(0.3, 0.9, slope));
                lit.addAssign(u.fill.mul(2.2).add(u.sun.mul(0.25).mul(u.sunUp)).mul(threads).mul(wet)
                    .mul(u.drain));
            });
        });
        const col = aerial(u, P, lit);
        return vec4(col, 1.0);
    })();
    return material;
}

export { abs, sin };
