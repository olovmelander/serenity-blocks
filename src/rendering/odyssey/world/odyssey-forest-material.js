import * as THREE from 'three/webgpu';
import {
    Fn, If, atan, attribute, clamp, cos, cross, dot, exp, float, floor, fract, fwidth, int, ivec2, length, max, mix, mod,
    normalize, positionGeometry, select, sin, smoothstep, sqrt, texture, textureLoad, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';
import { FOREST_ATLAS, FOREST_FAR, FOREST_PULL_WIDTH } from './odyssey-forest-models-decode.js';

/**
 * THE FOREST'S MATERIALS (2026-11-24). Two, for the whole island:
 *
 *   near  the hero and middle trees: a tree's shape is PULLED from a texture (odyssey-forest-models-
 *         decode.js), so one draw holds every kind and age that stands in its grove;
 *   far   one picture a tree: the view of it nearest the eye's direction, of sixteen photographed in
 *         Blender, lit like the near ones.
 *
 * Every instance carries the same seven vec4s in one interleaved buffer (WebGPU allows eight vertex
 * buffers, and this is one):
 *   aFoot   the foot xyz, the turn about up
 *   aForm   scale across, scale up, lean x, lean z
 *   aPull   near: (first card texel, cards, first bark texel, bark vertices)
 *           far:  (first view tile, half width, middle and half height at the low view)
 *   aCrown  the crown's lit colour, the tree's own phase
 *   aShade  the crown's shade colour, near: the cards' size (1, or more when a tier draws fewer)
 *                                     far: the middle's height at the high view
 *   aTrunk  the bark's colour; near: its atlas tile, far: the half height at the high view
 *   aLight  the terrain's sun visibility; how high up the tree its neighbours shade it from the sun
 *           (a share of its height, below 0 when nothing does); the sky its foot sees; its height
 *
 * THE LIGHT IS A GROVE'S, not a ball's. Four things make a wood read as deep, and each is here:
 *   - the masses: a card takes the normal of the foliage mass it belongs to, with the photographed
 *     leaves' own facing on top, so limbs of foliage are lit as limbs;
 *   - the crown's own shade: how far the sun travels through the crown to reach a card;
 *   - the sky each card sees through the others, ray cast in Blender;
 *   - the neighbours: the sun reaches only the part of a tree that stands above their shade, and
 *     under the canopy the sky closes too.
 */

/**
 * The look. Every number is a share or a scale, judged in the game's own grade (2026-11-24).
 *   wrap                how far the sun wraps round a form
 *   massN leafN faceN upN   what a leaf's normal is made of: its mass, the photograph, the eye, up
 *   path, pathFloor     how fast the crown stops the sun (per crown radius), and the least that gets through
 *   groveSoft, groveFloor   how soft the neighbours' shade line is, and the least that gets under it
 *   rampLo, rampHi      where the sun's share of a leaf begins and is full
 *   step                how much of that ramp is drawn in steps (a painter's masses)
 *   canopyFloor, skyFloor, toneFloor   the least sky under a canopy, in a crown's heart, in a spray's
 *   skySun              a leaf hidden from the sky keeps at least this of the sun's breadth
 *   litLift, shadeLift  the species' two colours, as drawn
 *   ambient, bounce, sun    the sky's light, the ground's, the sun's
 *   toneLo, toneHi, toneGain    a leaf's own light in the sun, and the contrast between leaves
 *   hue                 how far a card's own random moves its value and warmth
 *   cap                 the warm lift on leaves turned to the sun at the crown's top
 *   glow                leaves against the light
 *   detail              range (u) over which the photographed facing fades to the mass's
 *   flower              a white flower's colour
 */
export const FOREST_LOOK = Object.freeze({
    wrap: 0.5,
    massN: 0.86,
    leafN: 0.80,
    faceN: 0.22,
    upN: 0.10,
    path: 1.15,
    pathFloor: 0.28,
    groveSoft: 0.22,
    groveFloor: 0.30,
    rampLo: 0.05,
    rampHi: 0.72,
    step: 0.35,
    canopyFloor: 0.55,
    skyFloor: 0.38,
    toneFloor: 0.50,
    skySun: 0.70,
    litLift: 1.24,
    shadeLift: 1.60,
    ambient: 1.15,
    bounce: 0.20,
    sun: 1.06,
    toneLo: 0.46,
    toneHi: 1.22,
    toneGain: 1.45,
    hue: 0.36,
    cap: 0.42,
    glow: 0.62,
    detail: Object.freeze([260, 900]),
    flower: Object.freeze([0.80, 0.78, 0.70]),
});

/** The instance layout: name -> offset in floats, in the one interleaved buffer. */
export const FOREST_INSTANCE = Object.freeze({
    stride: 28,
    layout: Object.freeze([
        Object.freeze(['aFoot', 0]), Object.freeze(['aForm', 4]), Object.freeze(['aPull', 8]), Object.freeze(['aCrown', 12]),
        Object.freeze(['aShade', 16]), Object.freeze(['aTrunk', 20]), Object.freeze(['aLight', 24]),
    ]),
});

/**
 * A near tree's geometry: its slots, cards first (4 corners a card, `card * 8 + corner`), then bark
 * (-1 - vertex), and the index that joins a card's corners into two triangles.
 */
export function buildForestSlots(cards, barkVerts) {
    const slots = new Float32Array(((cards * 4) + barkVerts) * 3);
    const index = new Uint32Array((cards * 6) + barkVerts);
    let o = 0;
    let i = 0;
    for (let c = 0; c < cards; c += 1) {
        const at = c * 4;
        for (let k = 0; k < 4; k += 1) { slots[o] = (c * 8) + k; o += 3; }
        index.set([at, at + 1, at + 2, at, at + 2, at + 3], i);
        i += 6;
    }
    for (let v = 0; v < barkVerts; v += 1) {
        slots[o] = -1 - v;
        o += 3;
        index[i] = (cards * 4) + v;
        i += 1;
    }
    return { slots, index };
}

/** A card's corner 0..3, counter-clockwise from the lower left. */
function cornerOf(k) {
    return vec2(
        select(k.greaterThan(0.5).and(k.lessThan(2.5)), float(1), float(-1)),
        select(k.greaterThan(1.5), float(1), float(-1)),
    );
}

/**
 * The light on foliage, shared by both materials.
 *
 * @param {object} ctx the world's shared nodes (see createForestMaterials)
 * @param {object} s
 * @param {Node} s.N        the surface's normal
 * @param {Node} s.crownDir where in the crown it sits (length 1 at the skin)
 * @param {Node} s.sky      the sky it sees through its own crown
 * @param {Node} s.tone     the leaf's own light, 0..1 (its tone and the shade within its spray)
 * @param {Node} s.wood     how much of it is wood
 * @param {Node} s.flower   how much of it is white flower
 * @param {Node} s.random   the card's own random
 * @param {Node} s.hRel     its height in the tree, 0..1
 * @param {Node} s.leafy    1 on foliage, 0 on the wood's own triangles
 * @param {Node} s.P        its place in the world
 * @param {Node} s.turn     the day's turn there
 * @param {Node} s.cloud    the drifting clouds' light there
 * @param {Node} s.far      0 near .. 1 where a tree is drawn in one tone
 */
function forestLight(ctx, s) {
    const L = FOREST_LOOK;
    const aCrown = attribute('aCrown', 'vec4');
    const aShade = attribute('aShade', 'vec4');
    const aTrunk = attribute('aTrunk', 'vec4');
    const aLight = attribute('aLight', 'vec4');
    const sunDir = ctx.uSunDir;
    const sun = ctx.landSunOf(s.turn).toVar();
    const E = normalize(ctx.cameraPosition.sub(s.P)).toVar();

    const facing = dot(s.N, sunDir);
    const wrap = clamp(facing.add(L.wrap).div(float(L.wrap).add(1)), 0, 1).toVar();
    // The sun's way through the crown (a ball in crown radii) to where this leaf sits.
    const b = dot(s.crownDir, sunDir).toVar();
    const path = max(sqrt(max(b.mul(b).sub(dot(s.crownDir, s.crownDir)).add(1), 0)).sub(b), 0).toVar();
    const through = mix(float(1), mix(float(L.pathFloor), float(1), exp(path.mul(L.path).negate())), s.leafy).toVar();
    // Above the neighbours' shade or under it; under it some light still comes down through the leaves.
    const grove = mix(
        float(L.groveFloor),
        float(1),
        smoothstep(aLight.y.sub(L.groveSoft), aLight.y.add(L.groveSoft), s.hRel),
    ).toVar();
    const lit = wrap.mul(through).mul(grove).mul(mix(float(0.35), float(1), aLight.x)).mul(s.cloud)
        .mul(mix(float(0.62), float(1.06), s.tone))
        .toVar();
    const smooth = smoothstep(float(L.rampLo), float(L.rampHi), lit).toVar();
    // A painter's masses: part of the ramp in three soft steps.
    const steps = smooth.mul(3).toVar();
    const stepped = floor(steps).add(smoothstep(float(0.35), float(0.65), fract(steps))).div(3);
    // (Leaves the crown hides from the sky hide from the sun's breadth too.)
    const sunShare = mix(smooth, clamp(stepped, 0, 1), L.step).mul(mix(float(1), mix(float(L.skySun), float(1), s.sky), s.leafy)).toVar();

    // The sky under the canopy closes toward the ground, and inside the crown.
    const canopy = mix(mix(float(L.canopyFloor), float(1), aLight.z), float(1), smoothstep(float(0.05), float(0.85), s.hRel));
    const open = mix(float(L.skyFloor), float(1), s.sky).mul(canopy).mul(mix(float(L.toneFloor), float(1), s.tone)).toVar();

    // The colours: this tree's lit and shade, each card a little its own.
    const own = s.random.sub(0.5);
    const lift = own.mul(L.hue).add(1);
    const warm = vec3(own.mul(0.10).add(1), float(1), own.mul(-0.16).add(1));
    const crown = aCrown.xyz.mul(lift).mul(warm).mul(L.litLift).toVar();
    const shade = aShade.xyz.mul(mix(float(1), lift, 0.5)).mul(L.shadeLift).toVar();
    const bark = aTrunk.xyz.toVar();
    const leafLit = mix(crown, vec3(...L.flower), s.flower).toVar();
    const leafShade = mix(shade, vec3(...L.flower).mul(vec3(0.50, 0.56, 0.66)), s.flower);
    const grain = mix(float(0.42), float(1.12), s.tone);
    const albedoLit = mix(bark.mul(grain), mix(leafLit, bark.mul(0.75), s.wood), s.leafy);
    const albedoShade = mix(bark.mul(grain).mul(vec3(0.66, 0.66, 0.74)), mix(leafShade, bark.mul(0.42), s.wood), s.leafy);

    // The warm cap: leaves up in the light, turned to it.
    const cap = smoothstep(float(0.45), float(1.0), s.N.y.mul(0.62).add(dot(s.N.xz, normalize(sunDir.xz)).mul(0.52)).add(s.tone.mul(0.25)))
        .mul(sunShare).mul(s.leafy).mul(float(1).sub(s.far))
        .mul(L.cap);
    const gold = clamp(ctx.landHourOf(s.turn).z.mul(ctx.hourGold.gain), 0, 1);
    const capTint = mix(vec3(1.20, 1.12, 0.78), vec3(...ctx.hourGold.tint), gold);

    const skyUp = s.N.y.mul(0.5).add(0.5);
    const skyLight = mix(sun.mul(0.72), ctx.uSkyHorizon, float(0.66).add(s.turn.x.mul(ctx.silver)))
        .mul(mix(float(0.62), float(1), skyUp));
    const bounce = vec3(0.30, 0.36, 0.14).mul(float(1).sub(skyUp)).mul(L.bounce).mul(sun);
    const ambient = skyLight.mul(L.ambient).add(bounce).mul(open);

    let col = albedoShade.mul(ambient)
        .add(albedoLit.mul(sun).mul(L.sun).mul(sunShare).mul(mix(float(1), mix(float(L.toneLo), float(L.toneHi), s.tone), s.leafy)))
        .add(albedoLit.mul(ambient).mul(sunShare).mul(0.16));
    col = col.mul(mix(vec3(1, 1, 1), capTint, cap));
    // Against the light: a leaf with little crown between it and the sun lets it through, in its own colour.
    const into = clamp(dot(E, sunDir).mul(-1), 0, 1).toVar();
    const thin = exp(path.mul(-1.5)).mul(grove).mul(s.leafy).mul(float(1).sub(s.wood));
    col = col.add(leafLit.mul(sun).mul(into.mul(into).mul(thin).mul(L.glow)).mul(mix(float(0.5), float(1), s.tone))
        .mul(mix(float(0.35), float(1), aLight.x))
        .mul(s.cloud));
    return col;
}

/**
 * Both materials.
 * @param {object} ctx
 *   pullTex, leafTex, farTex   the textures (far may be null: no far material)
 *   uOn   0 until the photographs have landed, then 1
 *   edgeCut   where a leaf's edge is cut: 0.5 with no MSAA to soften it by coverage, else just above nothing
 *   cameraPosition, positionWorld   in the world's own frame (the climb's)
 *   uTime, uSunDir, uSkyHorizon, landSunOf, landHourOf, dayTurnOf, gustFront, cloudLight ((xz, turn) -> light)
 *   reachSink (() -> y offset: how far a tree has sunk out of the draw distance)
 *   hourGold {gain, tint}, silver   the hour's looks
 *   finish (colour, position) -> output   the world's air and grade
 */
export function createForestMaterials(ctx) {
    return { near: createNear(ctx), far: ctx.farTex ? createFar(ctx) : null };
}

function createNear(ctx) {
    const L = FOREST_LOOK;
    const aFoot = attribute('aFoot', 'vec4');
    const aForm = attribute('aForm', 'vec4');
    const aPull = attribute('aPull', 'vec4');
    const aCrown = attribute('aCrown', 'vec4');
    const aShade = attribute('aShade', 'vec4');
    const aTrunk = attribute('aTrunk', 'vec4');
    const aLight = attribute('aLight', 'vec4');
    const vUv = varyingProperty('vec4', 'vForestUv'); // atlas uv, the sky it sees, its random
    const vRight = varyingProperty('vec4', 'vForestRight'); // the card's right, 1 on a card
    const vUp = varyingProperty('vec4', 'vForestUp'); // the card's up, its height in the tree
    const vNormal = varyingProperty('vec3', 'vForestNormal'); // the mass's normal (a card), the wood's own
    const vDir = varyingProperty('vec3', 'vForestDir'); // where in the crown
    // The clouds' light and the day's turn, read once a vertex (a crown is several cards deep on screen).
    const vAir = varyingProperty('vec3', 'vForestAir');
    const texel = (i) => textureLoad(ctx.pullTex, ivec2(i.bitAnd(int(FOREST_PULL_WIDTH - 1)), i.shiftRight(int(Math.log2(FOREST_PULL_WIDTH)))), int(0));

    const mat = new THREE.MeshBasicNodeMaterial();
    // (The trees carry the world's own air: the scene's fog is not theirs.)
    mat.fog = false;
    mat.positionNode = Fn(() => {
        const slot = positionGeometry.x.toVar();
        const pos = aFoot.xyz.toVar();
        const right = vec3(1, 0, 0).toVar();
        const up = vec3(0, 1, 0).toVar();
        const normal = vec3(0, 1, 0).toVar();
        const dir = vec3(0, 0, 0).toVar();
        const uvSky = vec4(0, 0, 1, 0.5).toVar();
        const onCard = float(0).toVar();
        const hRel = float(0).toVar();
        const air = vec3(1, 0, 0).toVar();
        // A slot past the tree's own count stays at its foot: it rasterises nothing, and costs next to nothing.
        const onCards = slot.greaterThan(-0.5).toVar();
        const number = select(onCards, floor(slot.div(8)), slot.mul(-1).sub(1)).toVar();
        If(number.lessThan(select(onCards, aPull.y, aPull.w).sub(0.5)), () => {
            const c = cos(aFoot.w).toVar();
            const s = sin(aFoot.w).toVar();
            const turn = (p) => vec3(p.x.mul(c).add(p.z.mul(s)), p.y, p.z.mul(c).sub(p.x.mul(s)));
            const place = (p) => {
                const q = turn(p.mul(vec3(aForm.x, aForm.y, aForm.x)));
                return vec3(q.x.add(aForm.z.mul(q.y)), q.y, q.z.add(aForm.w.mul(q.y))).add(aFoot.xyz);
            };
            // The one wind: the gust front, and each tree's own sway, more the higher.
            const gust = ctx.gustFront(aFoot.xz).mul(0.62).add(sin(ctx.uTime.mul(1.3).add(aCrown.w)).mul(0.38)).toVar();
            If(onCards, () => {
                const card = number;
                const at = int(aPull.x.add(card.mul(4)).add(0.5)).toVar();
                const t0 = texel(at).toVar();
                const t1 = texel(at.add(1)).toVar();
                const t2 = texel(at.add(2)).toVar();
                const t3 = texel(at.add(3)).toVar();
                const centre = place(t0.xyz).toVar();
                const axis = normalize(turn(t1.xyz)).toVar();
                const h = clamp(centre.y.sub(aFoot.y).div(aLight.w), 0, 1).toVar();
                // Boughs sway after the stem, each a little out of step.
                const rnd = fract(t2.w).mul(2).toVar();
                const tile = floor(t2.w).toVar();
                const bend = h.mul(h).mul(0.10);
                const bough = sin(ctx.uTime.mul(1.9).add(rnd.mul(9.1)).add(aCrown.w)).mul(0.030).mul(h)
                    .mul(gust.mul(0.5).add(0.7));
                centre.addAssign(vec3(gust.mul(bend).add(bough), bough.mul(-0.4), gust.mul(bend).mul(0.55).add(bough.mul(0.5))).mul(aForm.y));
                const eye = ctx.cameraPosition.sub(centre).toVar();
                const eyeDist = length(eye).toVar();
                const E = eye.div(max(eyeDist, 0.001)).toVar();
                // The twig's own direction, as the eye sees it: cards are turned to the eye, rolled
                // to the way they grow, and foreshortened when they grow toward it.
                const along = dot(axis, E).toVar();
                const flat = axis.sub(E.mul(along)).toVar();
                const flatLen = length(flat).toVar();
                const rise = vec3(0, 1, 0).sub(E.mul(E.y));
                const u = normalize(flat.add(rise.mul(float(1).sub(smoothstep(float(0.10), float(0.55), flatLen)).mul(0.8)))
                    .add(vec3(0.0007, 0.0013, 0.0011))).toVar();
                const r = normalize(cross(u, E)).toVar();
                // ...and leaned a little to its own mass, so a crown keeps its depth.
                const k = slot.sub(card.mul(8)).toVar();
                const corner = cornerOf(k).toVar();
                const flip = select(rnd.greaterThan(0.5), float(-1), float(1)).toVar();
                const scale = aForm.x.add(aForm.y).mul(0.5).mul(aShade.w);
                const hl = t0.w.mul(scale).mul(mix(float(0.66), float(1), flatLen));
                const hw = t1.w.mul(scale);
                // The leaves' own shake, near only.
                const near = float(1).sub(smoothstep(float(90), float(300), eyeDist));
                const shake = vec2(
                    sin(ctx.uTime.mul(2.7).add(rnd.mul(21)).add(centre.x.mul(0.7))),
                    sin(ctx.uTime.mul(2.2).add(rnd.mul(33)).add(centre.z.mul(0.7))),
                ).mul(0.035).mul(near).mul(gust.mul(0.4).add(0.8));
                pos.assign(centre.add(r.mul(corner.x.add(shake.x)).mul(hw)).add(u.mul(corner.y.add(shake.y)).mul(hl)));
                const mass = turn(t2.xyz);
                pos.addAssign(E.mul(hw.mul(0.12)).add(mass.mul(corner.y).mul(hl).mul(0.14)));
                right.assign(r.mul(flip));
                up.assign(u);
                normal.assign(mass);
                dir.assign(turn(t3.xyz));
                const col = mod(tile, float(FOREST_ATLAS.cols));
                const row = floor(tile.div(FOREST_ATLAS.cols));
                const inset = 0.5 - (0.6 / FOREST_ATLAS.tile);
                const uv = vec2(
                    col.add(0.5).add(corner.x.mul(flip).mul(inset)).div(FOREST_ATLAS.cols),
                    float(1).sub(row.add(0.5).add(corner.y.mul(inset)).div(FOREST_ATLAS.rows)),
                );
                uvSky.assign(vec4(uv, t3.w, rnd));
                onCard.assign(1);
                hRel.assign(clamp(pos.y.sub(aFoot.y).div(aLight.w), 0, 1));
            }).Else(() => {
                const vert = number;
                const at = int(aPull.z.add(vert.mul(2)).add(0.5)).toVar();
                const b0 = texel(at).toVar();
                const b1 = texel(at.add(1)).toVar();
                pos.assign(place(b0.xyz));
                const h = clamp(pos.y.sub(aFoot.y).div(aLight.w), 0, 1).toVar();
                const bend = h.mul(h).mul(0.10);
                pos.addAssign(vec3(gust.mul(bend), 0, gust.mul(bend).mul(0.55)).mul(aForm.y));
                normal.assign(turn(b1.xyz));
                // Its place on the bark's tile: round the stem and up it.
                const up31 = floor(b1.w.div(32)).toVar();
                const col = mod(aTrunk.w, float(FOREST_ATLAS.cols));
                const row = floor(aTrunk.w.div(FOREST_ATLAS.cols));
                const barkInset = 1 - (1.6 / FOREST_ATLAS.tile);
                uvSky.assign(vec4(
                    col.add(0.5).add(b1.w.sub(up31.mul(32)).div(31).sub(0.5).mul(barkInset)).div(FOREST_ATLAS.cols),
                    float(1).sub(row.add(0.5).add(up31.div(31).sub(0.5).mul(barkInset)).div(FOREST_ATLAS.rows)),
                    b0.w,
                    0.5,
                ));
                hRel.assign(h);
            });
            const airAt = aFoot.xz.add(pos.xz).mul(0.5).toVar();
            const t = ctx.dayTurnOf(airAt).toVar();
            air.assign(vec3(ctx.cloudLight(airAt, t), t.x, t.y));
        });
        vUv.assign(uvSky);
        vRight.assign(vec4(right, onCard));
        vUp.assign(vec4(up, hRel));
        vNormal.assign(normal);
        vDir.assign(dir);
        vAir.assign(air);
        // Until the photographs land every vertex stays at its tree's foot.
        return mix(aFoot.xyz, pos, ctx.uOn).add(vec3(0, ctx.reachSink(aFoot.xz), 0));
    })();

    const P = ctx.positionWorld;
    const leaf = texture(ctx.leafTex, vUv.xy);
    const isCard = vRight.w.greaterThan(0.5);
    // The tile's own border: past it a mip has the neighbour's leaves in it.
    const inTile = fract(vec2(vUv.x.mul(FOREST_ATLAS.cols), vUv.y.mul(FOREST_ATLAS.rows))).sub(0.5);
    const border = float(1).sub(smoothstep(float(0.470), float(0.494), max(inTile.x.abs(), inTile.y.abs())));
    const alpha = clamp(leaf.r.sub(0.5).div(max(fwidth(leaf.r), 0.03)).add(0.5), 0, 1).mul(border);
    const coverage = select(isCard, alpha, float(1));
    mat.opacityNode = coverage;
    mat.maskNode = isCard.not().or(alpha.greaterThan(ctx.edgeCut ?? 0.02));
    mat.alphaToCoverage = true;

    mat.colorNode = Fn(() => {
        const tex = vec4(leaf).toVar();
        // A discarded fragment runs on to the end of the shader (WGSL demotes it): most of a card is sky, so
        // it is not shaded.
        const shown = isCard.not().or(alpha.greaterThan(ctx.edgeCut ?? 0.02)).toVar();
        const out = vec3(0, 0, 0).toVar();
        If(shown, () => {
            const turn = vec2(vAir.y, vAir.z).toVar();
            const dist = length(ctx.cameraPosition.sub(P)).toVar();
            const far = smoothstep(float(L.detail[0]), float(L.detail[1]), dist).toVar();
            const leafy = vRight.w.toVar();
            const E = normalize(ctx.cameraPosition.sub(P)).toVar();
            const mass = normalize(vNormal.add(vec3(0, 0.0001, 0))).toVar();
            const face = tex.yz.mul(2).sub(1).mul(mix(float(L.leafN), float(L.leafN).mul(0.35), far)).toVar();
            const leafNormal = mass.mul(L.massN).add(vRight.xyz.mul(face.x)).add(vUp.xyz.mul(face.y)).add(E.mul(L.faceN))
                .add(vec3(0, L.upN, 0));
            const N = normalize(mix(mass, leafNormal, leafy)).toVar();
            const value = tex.w.toVar();
            const wood = float(1).sub(smoothstep(float(0.17), float(0.23), value)).mul(leafy);
            const flower = smoothstep(float(0.865), float(0.905), value).mul(leafy);
            // (The bark's tile is light all the way: its fissures and plates are its tone.)
            // (A spray's own contrast, kept up where the mips average it away.)
            const leafTone = clamp(value.sub(0.22).div(0.64).sub(0.5).mul(float(L.toneGain).add(far.mul(0.6)))
                .add(0.5), 0, 1);
            const tone = mix(value, leafTone, leafy);
            out.assign(vec3(ctx.finish(forestLight(ctx, {
                N,
                crownDir: vDir,
                sky: vUv.z,
                tone: tone.toVar(),
                wood: wood.toVar(),
                flower: flower.toVar(),
                random: vUv.w,
                hRel: vUp.w,
                leafy,
                P,
                turn,
                cloud: vAir.x,
                far,
            }), P)));
        });
        return out;
    })();
    return mat;
}

function createFar(ctx) {
    const F = FOREST_FAR;
    const L = FOREST_LOOK;
    const aFoot = attribute('aFoot', 'vec4');
    const aForm = attribute('aForm', 'vec4');
    const aPull = attribute('aPull', 'vec4');
    const aShade = attribute('aShade', 'vec4');
    const aTrunk = attribute('aTrunk', 'vec4');
    const aLight = attribute('aLight', 'vec4');
    const vTileA = varyingProperty('vec4', 'vForestTileA');
    const vTileB = varyingProperty('vec4', 'vForestTileB');
    const vBlend = varyingProperty('vec4', 'vForestBlend'); // azimuth, elevation, the corner
    const vRight = varyingProperty('vec3', 'vForestFarRight');
    const vUp = varyingProperty('vec4', 'vForestFarUp');
    const vAir = varyingProperty('vec3', 'vForestFarAir');
    const elLo = Math.tan((F.elevations[0] + 6) * (Math.PI / 180));
    const elHi = Math.tan((F.elevations[1] - 8) * (Math.PI / 180));
    const mat = new THREE.MeshBasicNodeMaterial();
    // (The trees carry the world's own air: the scene's fog is not theirs.)
    mat.fog = false;
    mat.positionNode = Fn(() => {
        const k = positionGeometry.x.toVar();
        const corner = cornerOf(k).toVar();
        const eye = ctx.cameraPosition.sub(aFoot.xyz).toVar();
        const flat = max(length(eye.xz), 0.01).toVar();
        const c = cos(aFoot.w).toVar();
        const s = sin(aFoot.w).toVar();
        // The eye round the tree, in the tree's own turn (the photographs' azimuths).
        const lx = eye.x.mul(c).sub(eye.z.mul(s));
        const lz = eye.x.mul(s).add(eye.z.mul(c));
        const turns = fract(atan(lz.mul(-1), lx).div(Math.PI * 2).add(1)).mul(F.azimuths).toVar();
        const i0 = floor(turns).toVar();
        const w = smoothstep(float(0.25), float(0.75), turns.sub(i0)).toVar();
        const a0 = mod(i0, float(F.azimuths)).toVar();
        const a1 = mod(i0.add(1), float(F.azimuths)).toVar();
        const el = smoothstep(float(elLo), float(elHi), eye.y.sub(aLight.w.mul(0.5)).div(flat)).toVar();
        const r = normalize(vec3(eye.z, 0, eye.x.mul(-1))).toVar();
        const E = normalize(eye).toVar();
        const u = cross(E, r).toVar();
        const mid = mix(aPull.z, aShade.w, el).mul(aForm.y);
        const half = mix(aPull.w, aTrunk.w, el).mul(aForm.y).toVar();
        const wide = aPull.y.mul(aForm.x);
        const pos = aFoot.xyz.add(u.mul(mid.add(corner.y.mul(half)))).add(r.mul(corner.x.mul(wide)))
            .add(vec3(aForm.z, 0, aForm.w).mul(corner.y.add(1).mul(half)))
            .toVar();
        const inset = 0.5 - (0.6 / F.tile);
        const uvOf = (view) => {
            const tile = aPull.x.add(view);
            const col = mod(tile, float(F.cols));
            const row = floor(tile.div(F.cols));
            return vec2(
                col.add(0.5).add(corner.x.mul(inset)).div(F.cols),
                float(1).sub(row.add(0.5).add(corner.y.mul(inset)).div(F.rows)),
            );
        };
        vTileA.assign(vec4(uvOf(a0), uvOf(a1)));
        vTileB.assign(vec4(uvOf(a0.add(F.azimuths)), uvOf(a1.add(F.azimuths))));
        vBlend.assign(vec4(w, el, corner));
        vRight.assign(r);
        vUp.assign(vec4(u, clamp(pos.y.sub(aFoot.y).div(aLight.w), 0, 1)));
        const t = ctx.dayTurnOf(aFoot.xz).toVar();
        vAir.assign(vec3(ctx.cloudLight(aFoot.xz, t), t.x, t.y));
        return mix(aFoot.xyz, pos, ctx.uOn).add(vec3(0, ctx.reachSink(aFoot.xz), 0));
    })();

    const P = ctx.positionWorld;
    const low = mix(texture(ctx.farTex, vTileA.xy), texture(ctx.farTex, vTileA.zw), vBlend.x);
    const high = mix(texture(ctx.farTex, vTileB.xy), texture(ctx.farTex, vTileB.zw), vBlend.x);
    const view = mix(low, high, vBlend.y);
    // The picture stands inside its tile (far_fit's margin); past it a mip has its neighbour in it.
    const border = float(1).sub(smoothstep(float(0.945), float(0.985), max(vBlend.z.abs(), vBlend.w.abs())));
    const alpha = clamp(view.r.sub(0.48).div(max(fwidth(view.r), 0.06)).add(0.5), 0, 1).mul(border);
    mat.opacityNode = alpha;
    mat.maskNode = alpha.greaterThan(ctx.edgeCut ?? 0.02);
    mat.alphaToCoverage = true;
    mat.colorNode = Fn(() => {
        const tex = vec4(view).toVar();
        // A discarded fragment runs on to the end of the shader (WGSL demotes it): most of a card is sky, so
        // it is not shaded.
        const shown = alpha.greaterThan(ctx.edgeCut ?? 0.02).toVar();
        const out = vec3(0, 0, 0).toVar();
        If(shown, () => {
            const turn = vec2(vAir.y, vAir.z).toVar();
            const E = normalize(ctx.cameraPosition.sub(P)).toVar();
            const face = tex.yz.mul(2).sub(1).toVar();
            const toward = sqrt(clamp(float(1).sub(dot(face, face)), 0.05, 1));
            const N = normalize(vRight.mul(face.x).add(vUp.xyz.mul(face.y.add(0.10))).add(E.mul(toward).mul(0.8))).toVar();
            const value = tex.w.toVar();
            const wood = float(1).sub(smoothstep(float(0.17), float(0.23), value));
            const flower = smoothstep(float(0.865), float(0.905), value);
            const tone = clamp(value.sub(0.22).div(0.64).sub(0.40)
                .mul(L.toneGain)
                .add(0.56), 0, 1).toVar();
            // Where in the crown: the picture's own place, bulged toward the eye.
            const cx = vBlend.z;
            const cy = vBlend.w.sub(0.15);
            const bulge = sqrt(clamp(float(1).sub(cx.mul(cx)).sub(cy.mul(cy)), 0, 1));
            const dir = vRight.mul(cx.mul(0.9)).add(vUp.xyz.mul(cy.mul(0.9))).add(E.mul(bulge.mul(0.75)));
            out.assign(vec3(ctx.finish(forestLight(ctx, {
                N,
                crownDir: dir.toVar(),
                // (Its occlusion is already in its tone.)
                sky: mix(float(0.82), float(1), tone),
                tone,
                wood: wood.toVar(),
                flower: flower.toVar(),
                random: float(0.5),
                hRel: vUp.w,
                leafy: float(1),
                P,
                turn,
                cloud: vAir.x,
                far: float(1),
            }), P)));
        });
        return out;
    })();
    return mat;
}
