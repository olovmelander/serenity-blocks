/**
 * Painted Ages — the land (mesh + strata material).
 *
 * The mesh is a fan laid out for the one eye that looks at it: columns by bearing across the
 * widest frame any screen shows, rows by log-distance from eight metres to forty kilometres, so
 * every triangle covers about the same few pixels wherever it lies. Heights come from the baked
 * fields (bicubic), so a mesh finer than the near grid shows no facets.
 *
 * The material is unlit: it lights itself.
 *  - The surface normal is the fields' slope plus, near the eye, the badlands' FLUTES: an
 *    erosion filter (rills that run straight down every slope and branch, after Clay John's
 *    eroded-terrain noise) in two octaves, faded out by their own pixel footprint.
 *  - The colour is the strata column at the point's geological height, the flutes cutting the
 *    beds into chevrons; gentle slopes carry dust, gullies a darker wash, the valley floor sand
 *    and gravel, the peaks snow. The newest beds of the mineral record crown the hills.
 *  - The light: sun (soft terrain shadows from the shadow pass, cloud shadows), sky fill by the
 *    baked sky visibility, the warm bounce of red ground, then the air (aerial perspective).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    select,
    sin,
    smoothstep,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    DEG, EYE, FIELDS, RECORD_BED, RECORD_ROWS, RECORD_WIDTH,
} from './painted-ages-core.js';
import { groundHeight } from './painted-ages-field.js';
import {
    columnU, fieldUV, fieldWeight, landAt, paHash22, paLuma, paStrataG,
} from './painted-ages-tsl.js';
import { shadowAt } from './painted-ages-shadow.js';
import { aerial, cloudShadow, mistPatches } from './painted-ages-light.js';
import {
    rainbow, ribbonLight, riverWater, sparkle, waveLight,
} from './painted-ages-events.js';

/** The fan: half-width (degrees) of the bearings it covers, and its nearest and farthest rows. */
export const FAN = Object.freeze({ halfAngle: 46, near: 8, far: 42000 });

/**
 * The mesh's positions as a Float32Array (x, y, z per post), `cols × rows` posts, built in
 * slices: a generator that yields between slices and returns the array (drive it to the end
 * synchronously, or yield to the page between steps).
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
            // Wound so the faces look up (toward +y) as seen from above.
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

// ── The flutes ────────────────────────────────────────────────────────────────────

/**
 * Clay John's erosion noise in a 3 × 3 neighbourhood: cosine waves across `dir` (so their crests
 * and troughs run ALONG the slope), each from a jittered cell point, Gaussian-weighted. Returns
 * (height −1..1, d/dp.x, d/dp.y) in units of p.
 */
export const paRills = /* @__PURE__ */ Fn(([p, dir]) => {
    const ip = floor(p);
    const fp = fract(p);
    const acc = vec3(0.0).toVar();
    const wt = float(0.0).toVar();
    const TAU = 6.2831853;
    for (let j = -1; j <= 1; j += 1) {
        for (let i = -1; i <= 1; i += 1) {
            const o = vec2(i, j);
            const h = paHash22(ip.add(o)).sub(0.5).mul(0.7);
            const pp = fp.sub(o).sub(h).sub(0.5);
            const d = dot(pp, pp);
            const w = exp(d.mul(-2.2));
            const mag = dot(pp, dir).mul(TAU);
            acc.addAssign(vec3(cos(mag), sin(mag).negate().mul(dir.x).mul(TAU), sin(mag).negate().mul(dir.y).mul(TAU)).mul(w));
            wt.addAssign(w);
        }
    }
    return acc.div(max(wt, 1e-4));
}).setLayout({
    name: 'pa_rills', type: 'vec3', inputs: [{ name: 'p', type: 'vec2' }, { name: 'dir', type: 'vec2' }],
});

// ── The material ──────────────────────────────────────────────────────────────────

/**
 * @param {object} u        shared uniforms
 * @param {object} t        textures: fields { near, mid, far }, flow { near, mid }, shadow
 *                          { near, mid, far }, column, record, noise
 * @param {object} tier     quality tier (flutes: octaves 0..2)
 */
export function createLandMaterial(u, t, tier) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PaintedAgesLand';
    material.fog = false;

    material.colorNode = Fn(() => {
        const P = positionWorld;
        const { xz } = P;
        const land = landAt(t.fields, xz).toVar();
        const V = P.sub(u.eye);
        const dist = length(V).toVar();
        const footprint = dist.mul(u.pixelAngle).toVar();
        const grad = land.yz.toVar();
        const slope = length(grad).toVar();

        // ── Flutes: rills straight down every steep face, near the eye ──
        const detailH = float(0.0).toVar();
        const detailG = vec2(0.0).toVar();
        if (tier.flutes > 0) {
            const steep = smoothstep(0.18, 0.75, slope);
            // Room: a rill set is drawn only where its spacing spans a few pixels.
            const room1 = float(1.0).sub(smoothstep(0.55, 1.6, footprint.div(3.2)));
            If(steep.mul(room1).greaterThan(0.01), () => {
                const down = grad.div(max(slope, 1e-4));
                const across = vec2(down.y, down.x.negate());
                const e1 = paRills(xz.div(3.2), across);
                const a1 = steep.mul(room1).mul(0.2);
                detailH.addAssign(e1.x.mul(a1));
                detailG.addAssign(e1.yz.mul(a1.div(3.2)));
                if (tier.flutes > 1) {
                    const room2 = float(1.0).sub(smoothstep(0.55, 1.6, footprint.div(1.1)));
                    If(room2.greaterThan(0.01), () => {
                        // The finer set branches off the first: its direction leans with the first's slope.
                        const bent = normalize(across.add(vec2(e1.z, e1.y.negate()).mul(0.12)));
                        const e2 = paRills(xz.div(1.1).add(vec2(17.3, 4.1)), bent);
                        const a2 = steep.mul(room2).mul(0.07);
                        detailH.addAssign(e2.x.mul(a2));
                        detailG.addAssign(e2.yz.mul(a2.div(1.1)));
                    });
                }
            });
        }
        const n = normalize(vec3(grad.x.add(detailG.x).negate(), 1.0, grad.y.add(detailG.y).negate())).toVar();
        const nMacro = normalize(vec3(grad.x.negate(), 1.0, grad.y.negate()));

        // ── The strata ──
        const warp = texture(t.noise, xz.div(310.0)).b.sub(0.5).mul(1.6);
        // The beds follow the land a little smoothed (the mid field's 8 m surface for most of
        // it): a gully bends a bed into a soft V, the comb of fine rain-cut gullies does not saw it.
        const fm = FIELDS.mid;
        const hMid = texture(t.fields.mid, fieldUV(fm, xz)).level(0).x.mul(fm.hi - fm.lo).add(fm.lo);
        const ySmooth = mix(P.y, hMid, fieldWeight(fm, xz).mul(0.8));
        const g = paStrataG(vec3(P.x, ySmooth, P.z)).add(detailH.mul(0.25)).add(warp).toVar();
        const gw = fwidth(g).toVar();
        const cu = columnU(g);
        const bed = texture(t.column, vec2(cu, 0.5)).toVar();
        const albedo = bed.rgb.toVar();
        // The local mean (the colluvium that dusts the gentle slopes and fills the washes).
        const mean = texture(t.column, vec2(cu, 0.5)).level(8.0).rgb;
        // Far ranges: the bands soften into their mean as the air takes them (kept sharp, a
        // range ten kilometres off reads as contour lines rather than rock).
        albedo.assign(mix(albedo, mean, smoothstep(2400.0, 11000.0, dist).mul(0.68)));
        const upslope = texture(t.column, vec2(columnU(g.add(9.0)), 0.5)).level(6.0).rgb;

        // The mineral record crowns the hills: its beds stack down from recordTop.
        const recordGlow = vec3(0.0).toVar();
        If(u.recordCount.greaterThan(0.5), () => {
            // A new row slides the stack down one bed (settle 1 → 0).
            const depth = u.recordTop.sub(g).div(RECORD_BED).add(u.settle);
            const live = smoothstep(-0.2, 0.2, depth).mul(float(1.0).sub(smoothstep(u.recordCount.sub(0.5), u.recordCount.add(0.5), depth)));
            If(live.greaterThan(0.01), () => {
                const row = floor(depth);
                const along = fract(xz.x.mul(0.0011).add(xz.y.mul(0.0007))).mul(10.0);
                const v = u.recordHead.sub(row).add(RECORD_ROWS * 4).mod(RECORD_ROWS).add(0.5)
                    .div(RECORD_ROWS);
                const cell = texture(t.record, vec2(floor(along).add(0.5).div(RECORD_WIDTH), v)).level(0);
                const rmean = texture(t.record, vec2(10.5 / RECORD_WIDTH, v)).level(0).rgb;
                // Far away a bed is its mean; near, its ten cells run along it.
                const near = float(1.0).sub(smoothstep(4.0, 30.0, footprint));
                const rec = mix(rmean, cell.rgb, near);
                albedo.assign(mix(albedo, rec, live.mul(select(cell.a.greaterThan(0.5), float(0.92), float(0.0)))));
                // The newest beds glow in their pigments as they are laid down (a chain's beds
                // share the glow, so the crown lights bed by bed while it lasts).
                const raw = texture(t.record, vec2(11.5 / RECORD_WIDTH, v)).level(0).rgb;
                // (older beds of the run cooler than the newest)
                const glowing = float(1.0).sub(smoothstep(u.freshRows.sub(1.0), u.freshRows, row))
                    .mul(exp(row.mul(-0.4)));
                recordGlow.assign(raw.mul(u.fresh).mul(live).mul(glowing).mul(1.6));
            });
        });

        const flowN = texture(t.flow.near, fieldUV(FIELDS.near, xz)).r;
        const flowM = texture(t.flow.mid, fieldUV(FIELDS.mid, xz)).r;
        const flow = mix(flowM, flowN, fieldWeight(FIELDS.near, xz)).mul(fieldWeight(FIELDS.mid, xz)).toVar();
        // Dust on the gentle slopes (the mean, a little paler and pinker).
        const dusty = smoothstep(0.86, 0.985, nMacro.y);
        const dust = mean.mul(0.92).add(vec3(0.05, 0.035, 0.03));
        albedo.assign(mix(albedo, dust, dusty.mul(0.55)));
        // Gullies: the colour of the beds above washed down, a little darker.
        const wash = smoothstep(0.5, 0.72, flow);
        albedo.assign(mix(albedo, mix(albedo, upslope, 0.5).mul(0.86), wash.mul(0.6)));
        // Crests catch more weather: a touch paler where the whole sky is seen.
        albedo.mulAssign(mix(float(0.94), float(1.05), smoothstep(0.75, 0.97, land.w)));
        // The valley floor: sand and gravel in the river's braid, and on every low flat the
        // alluvium the washes spread (no bedrock stripes on a plain).
        const floorY = float(2.0).add(max(P.z.negate().sub(300.0), 0.0).mul(0.011)).add(max(P.z.negate().sub(4000.0), 0.0).mul(0.012));
        const above = P.y.sub(floorY);
        const onFloor = float(1.0).sub(smoothstep(1.5, 6.0, above)).mul(smoothstep(0.92, 0.99, nMacro.y));
        // Where the alluvium gives way to rock wanders (a fixed height would draw a ruler line).
        const edgeNoise = texture(t.noise, xz.div(420.0)).r.sub(0.5).mul(70.0).add(texture(t.noise, xz.div(95.0)).g.sub(0.5).mul(22.0));
        const plain = float(1.0).sub(smoothstep(15.0, 85.0, above.add(edgeNoise))).mul(smoothstep(0.86, 0.975, nMacro.y)).mul(float(1.0).sub(smoothstep(2500.0, 6000.0, dist)));
        const gravel = texture(t.noise, xz.div(9.0)).a;
        const patch = texture(t.noise, xz.div(60.0)).g;
        const sand = mix(vec3(0.34, 0.28, 0.23), vec3(0.47, 0.41, 0.35), gravel).mul(mix(float(0.82), float(1.0), patch));
        // Alluvium keeps a memory of the beds it came from: fans of their colour washed out from
        // the hills, darker where water ran (the drainage lines), patchy where it dried.
        const fan = smoothstep(0.42, 0.7, texture(t.noise, xz.div(240.0)).b);
        const silt = mix(sand, mean.mul(0.92), patch.mul(0.35).add(0.12).add(fan.mul(0.3)))
            .mul(float(1.0).sub(smoothstep(0.38, 0.62, flow).mul(0.22)));
        albedo.assign(mix(albedo, silt, plain.mul(0.82)));
        albedo.assign(mix(albedo, sand, onFloor.mul(0.85)));
        // The summit under the eye: gravel and dry soil (the beds would be metres-wide stripes here).
        const summit = float(1.0).sub(smoothstep(16.0, 38.0, dist));
        const pebble = texture(t.noise, xz.mul(1.7)).a;
        const soil = mix(vec3(0.36, 0.27, 0.2), vec3(0.52, 0.42, 0.33), pebble).mul(texture(t.noise, xz.mul(0.31)).g.mul(0.35).add(0.75));
        albedo.assign(mix(albedo, mix(soil, mean, 0.25), summit.mul(0.88)));
        // Scrub: dark grey-green tufts on the floor and the gentle footslopes.
        const scrubCell = texture(t.noise, xz.div(14.0)).a;
        const scrub = smoothstep(0.6, 0.68, scrubCell).mul(smoothstep(0.9, 0.98, nMacro.y)).mul(float(1.0).sub(smoothstep(30.0, 90.0, above)));
        albedo.assign(mix(albedo, vec3(0.06, 0.08, 0.045), scrub.mul(0.7)));
        // Snow on the far peaks.
        const snowLine = float(2350.0).add(texture(t.noise, xz.div(4000.0)).r.sub(0.5).mul(500.0));
        const snowy = smoothstep(snowLine, snowLine.add(260.0), P.y).mul(smoothstep(0.42, 0.7, nMacro.y));
        albedo.assign(mix(albedo, vec3(0.86, 0.88, 0.92), snowy));
        // Rain brings the colours out: wet rock is darker and its pigment deeper. The shower walks
        // in from the horizon: the land is wet beyond its front.
        const wet = u.wet.mul(float(1.0).sub(snowy)).mul(smoothstep(u.showerFront.sub(450.0), u.showerFront.add(150.0), dist)).toVar();
        const lum = paLuma(albedo);
        albedo.assign(mix(albedo, mix(vec3(lum), albedo, 1.35).mul(0.68), wet));

        // ── Light ──
        const L = u.sunDir;
        const ndl = clamp(dot(n, L).add(0.06).div(1.06), 0.0, 1.0);
        const shadow = shadowAt(t.shadow, xz);
        const clouds = cloudShadow(u, t.noise, P);
        const sunLight = u.sun.mul(ndl).mul(shadow).mul(clouds).mul(u.sunUp);
        // Alpenglow: the snow takes the hour's own colour.
        const direct = mix(sunLight, sunLight.mul(u.snow).mul(0.45), snowy);
        const sky = land.w.mul(0.75).add(0.25);
        const skyLight = u.fill.mul(n.y.mul(0.45).add(0.55)).mul(sky);
        // The red ground throws its light back up into the shadowed faces.
        const bounce = u.bounce.mul(float(1.0).sub(n.y).mul(0.6).add(0.15)).mul(sky);
        const lit = albedo.mul(direct.add(skyLight).add(bounce)).toVar();
        // Wet rock glints toward the sun.
        If(wet.greaterThan(0.01), () => {
            const view = V.div(max(dist, 1e-3)).negate();
            const hv = normalize(view.add(L));
            const spec = dot(n, hv).clamp(0.0, 1.0);
            const s2 = spec.mul(spec);
            const s8 = s2.mul(s2).mul(s2).mul(s2);
            lit.addAssign(u.sun.mul(s8.mul(s8).mul(0.35)).mul(wet).mul(shadow).mul(clouds));
        });
        // Back-to-back: mica glints where the sun reaches.
        lit.addAssign(sparkle(u, xz, dist, u.sun.mul(ndl).mul(shadow).mul(clouds).mul(u.sunUp)));
        // The water in the valley (and the flood).
        // (Its height over the bed is read per pixel off the field: the mesh's rows lie tens of
        // metres apart out there, and its interpolated height would dash a shallow channel.)
        const water = riverWater(u, t.noise, texture, xz, land.x.sub(floorY), dist, V);
        lit.assign(mix(lit, water.xyz, water.w));
        // What gameplay lights: the ribbons along their beds, the waves through the strata, the record.
        // (Strata light belongs to the rock: the alluvium on the flats takes little of it.)
        // A band in geological height covers a whole flat at once: only a slope shows it as a bed.
        const rock = float(1.0).sub(plain.mul(0.85)).sub(onFloor.mul(0.1)).max(0.0)
            .mul(smoothstep(0.06, 0.32, slope));
        // The heat of play: the beds glow in their own pigment, a slow tide of colour climbing
        // them, and the beds between its crests sink into shadow, so the land keeps its darks
        // (strataGlow is 0 at rest and under casual play).
        const tide = sin(g.mul(0.045).sub(u.time.mul(1.2))).mul(0.5).add(0.5);
        const crest = tide.mul(tide).mul(tide.mul(tide));
        lit.mulAssign(float(1.0).sub(u.strataGlow.mul(0.55).mul(float(1.0).sub(tide)).mul(rock)));
        const kindled = albedo.mul(u.strataGlow).mul(crest.mul(1.25));
        lit.addAssign(ribbonLight(u, xz, g, gw).add(waveLight(u, g, gw)).add(kindled).mul(rock)
            .add(recordGlow));
        const col = aerial(u, P, lit, mistPatches(u, t.noise, xz)).toVar();
        // The bow stands in the air in front of the far hills; rain veils hang beyond the front.
        col.addAssign(rainbow(u, V.div(dist)).mul(smoothstep(500.0, 2600.0, dist)).mul(0.55));
        const veil = u.showerPower.mul(smoothstep(u.showerFront.sub(150.0), u.showerFront.add(900.0), dist))
            .mul(texture(t.noise, vec2(xz.x.mul(0.002).add(u.time.mul(0.01)), 0.3)).g.mul(0.6).add(0.4));
        col.assign(mix(col, u.haze.mul(0.75).add(u.fill.mul(0.3)), veil.mul(0.42)));
        return vec4(col, 1.0);
    })();
    return material;
}

/** Fan density per tier. */
export function fanSize(tier) {
    return { cols: tier.fanCols, rows: tier.fanRows };
}
