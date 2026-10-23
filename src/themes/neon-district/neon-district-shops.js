/**
 * Neon District — the shops at the foot of every wall.
 *
 * A shop is one flat quad on the wall, and the shader builds the depth behind it: the window and
 * door are set back into the wall (the view ray is traced into the recess, so its jambs, soffit
 * and threshold slide past in true parallax and catch the shop's light), wet glass stands at the
 * back of the recess (it mirrors the far wall's neon at a glancing look, rain beads and runs down
 * it, and bends what is behind), and behind the glass is the shop itself, interior-mapped like
 * the rooms upstairs but furnished by trade: a noodle counter under pendant lamps, a laundromat's
 * wall of turning drums, a mart's fridge wall and aisles, an arcade's cabinets, a bar's backlit
 * bottles, a gym, a service counter, a calm room of round lamps.
 *
 * Two kinds, two materials:
 *  - painted: the district's painted shopfronts. The sign and walls stay flush; the painting's
 *    windows and door (neon-district-openings.js) are set back behind wet glass.
 *  - generated: a fascia that spells the shop's name in tube neon, a lit box or channel letters
 *    (with its tube logo when it has one), tiled piers, a framed glazing with a door and a hanging
 *    window sign, the room behind, and on some trade shops a roller shutter part or all the way
 *    down — corrugated, tagged, with the light leaking out under it.
 *
 * Nothing here is lit by a light: the glow map, the haze and the gameplay pulses light the
 * outside, each shop's own colour lights its inside.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    atan,
    attribute,
    cameraPosition,
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
    min,
    mix,
    mod,
    normalize,
    positionGeometry,
    positionWorld,
    pow,
    select,
    sin,
    smoothstep,
    step,
    texture,
    uv,
    vec2,
    vec3,
} from 'three/tsl';
import {
    STREET,
    ndAtmosphere,
    ndBoxAA,
    ndClearLight,
    ndGlow,
    ndHash11,
    ndHash21,
    ndHash22,
    ndLockLight,
    ndMax3,
    ndQuadGeometry,
    ndWrapZ,
} from './neon-district-tsl.js';
import { SHOPFRONT_CELLS } from './neon-district-atlas.js';
import { TEXT_WIDTH } from './neon-district-layout.js';
import { ndTextDistance } from './neon-district-text.js';
import { ndLogoFrames, ndSpellOut } from './neon-district-signs.js';

const finish = (name, geometry, material) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    return { mesh, material, geometry };
};

const safe = (v) => v.add(select(v.greaterThanEqual(0.0), float(1e-4), float(-1e-4)));

/** The quad on the wall, and the frame every shop shader works in. */
function shopFrame(u, pos, dim) {
    const zc = ndWrapZ(pos.z.add(u.scroll));
    // positionGeometry.x runs along the street so the image reads left to right from the street.
    const world = vec3(
        pos.x,
        pos.y.add(positionGeometry.y.mul(dim.y)),
        zc.add(positionGeometry.x.mul(dim.x).mul(dim.z)),
    );
    return world;
}

/**
 * The view ray in the shop's frame and the trace into the recess. Everything in metres:
 * u along the wall (image left to right), v up from the quad's foot, depth into the wall.
 */
function traceRecess(ctx, open, depth) {
    const {
        uM, vM, rd, w, h,
    } = ctx;
    const o0 = vec2(open.x.mul(w), open.y.mul(h)).toVar();
    const o1 = vec2(open.z.mul(w), open.w.mul(h)).toVar();
    const rdz = max(rd.z, 0.02);
    const tg = depth.div(rdz).toVar();
    const tx = max(select(rd.x.greaterThan(0.0), o1.x.sub(uM), o0.x.sub(uM)).div(safe(rd.x)), 0.0);
    const ty = max(select(rd.y.greaterThan(0.0), o1.y.sub(vM), o0.y.sub(vM)).div(safe(rd.y)), 0.0);
    const tSide = min(tx, ty);
    const glass = step(tg, tSide);
    const t = min(tg, tSide);
    return {
        o0,
        o1,
        rdz,
        glass,
        /** Where the ray meets the glazing plane. */
        g: vec2(uM.add(rd.x.mul(tg)), vM.add(rd.y.mul(tg))).toVar(),
        /** How deep into the recess the ray met a reveal (0 at the face, 1 at the glass). */
        revealDepth: clamp(rd.z.mul(t).div(max(depth, 0.01)), 0.0, 1.0),
        jamb: step(tx, ty),
        floorHit: float(1.0).sub(step(tx, ty)).mul(float(1.0).sub(step(0.0, rd.y))),
    };
}

/** The reveal's surfaces: dark render, lit by the street at the face and the shop at the glass. */
function revealColor(ctx, rec, inside) {
    const spill = rec.revealDepth.mul(rec.revealDepth).mul(mix(float(0.7), float(1.6), rec.floorHit));
    const base = vec3(0.022, 0.023, 0.028).mul(ctx.glow.mul(0.7).add(ctx.sky).add(ctx.pulse.mul(2.0)));
    return base.add(inside.mul(spill).mul(0.09));
}

/**
 * Wet glass at the back of the recess. Returns { offset, add, transmit }: a refraction offset
 * (metres) for what is behind, the light the glass adds (mirrored neon, lit beads), and how much
 * of what is behind comes through.
 */
function wetGlass(u, ctx, g, seed) {
    // Beads and runners show only where they are several pixels wide; farther off, the glass is
    // simply wet (a bead smaller than a pixel only sparkles).
    const near = float(1.0).sub(smoothstep(0.004, 0.011, max(ctx.fwU, ctx.fwV)));
    // Beads: one per 7 cm cell, most cells empty.
    const cellA = g.div(0.07);
    const idA = floor(cellA);
    const hA = ndHash22(idA.add(vec2(seed, seed.mul(0.37))));
    const lA = fract(cellA).sub(hA.mul(0.5).add(0.25));
    const rA = hA.x.mul(0.14).add(0.08);
    const beadA = smoothstep(rA, rA.mul(0.5), length(lA.mul(vec2(1.0, 1.25)))).mul(step(0.78, hA.y));
    // Runners: a drop sliding down a 14 cm column now and then, a wet trail above it.
    const col = floor(g.x.div(0.14));
    const hc = ndHash21(vec2(col, seed.add(5.0)));
    const live = step(0.8, hc);
    const fall = fract(u.time.mul(hc.mul(0.12).add(0.05)).add(hc.mul(9.0)));
    const head = float(4.2).sub(fall.mul(5.0));
    const cx = fract(g.x.div(0.14)).sub(0.5);
    const dy = g.y.sub(head);
    const runner = smoothstep(0.14, 0.05, length(vec2(cx, dy.div(0.14).mul(0.8)))).mul(live);
    const trail = smoothstep(0.06, 0.015, abs(cx)).mul(step(0.0, dy)).mul(exp(dy.mul(-2.2))).mul(live)
        .mul(near)
        .mul(0.4);
    const bead = max(beadA, runner).mul(near);
    const offset = lA.mul(beadA).mul(0.05).add(vec2(cx.mul(runner).mul(0.08), 0.0)).mul(near);
    // The far wall's neon, mirrored: follow the reflected ray across the street.
    const N = vec3(ctx.side.negate(), 0.0, 0.0);
    const R = ctx.V.sub(N.mul(dot(ctx.V, N).mul(2.0)));
    const across = abs(ctx.pW.x).add(STREET.halfStreet).div(max(abs(R.x), 0.08));
    const far = ctx.pW.add(R.mul(across));
    const mirrored = ndGlow(u, far).mul(smoothstep(-2.0, 2.0, far.y).mul(float(1.0).sub(smoothstep(14.0, 40.0, far.y))))
        .mul(0.55)
        .add(u.hazeLow.mul(0.9))
        .add(u.hazeHigh.mul(step(0.0, R.y)).mul(2.0));
    const fres = pow(float(1.0).sub(ctx.ndv), 5.0).mul(0.92).add(0.05);
    const add = mirrored.mul(fres).add(mirrored.mul(bead.mul(0.6).add(trail)))
        .add(ctx.glow.mul(bead).mul(0.05));
    return { offset: offset.mul(ctx.detail).toVar(), add, transmit: float(1.0).sub(fres).mul(float(1.0).sub(bead.mul(0.25))) };
}

/** The per-fragment context both shop materials start from. */
function shopContext(u, pos, dim) {
    const st = uv();
    const w = dim.x;
    const h = dim.y;
    const side = dim.z;
    const uM = st.x.mul(w).toVar();
    const vM = st.y.mul(h).toVar();
    // Derivatives first, in uniform control flow.
    const fwU = fwidth(uM);
    const fwV = fwidth(vM);
    const pW = positionWorld;
    const V = normalize(pW.sub(cameraPosition)).toVar();
    const N = vec3(side.negate(), 0.0, 0.0);
    const ndv = clamp(dot(V.negate(), N), 0.02, 1.0);
    const clear = ndClearLight(u, pW.z);
    return {
        st,
        w,
        h,
        side,
        uM,
        vM,
        fwU,
        fwV,
        pW,
        V,
        ndv,
        // along the wall, up, into the wall
        rd: vec3(V.z.mul(side), V.y, V.x.mul(side)).toVar(),
        seed: floor(pos.w.add(0.5)).toVar(),
        detail: float(1.0).sub(smoothstep(0.035, 0.16, max(fwU, fwV))),
        glow: ndGlow(u, pW),
        pulse: ndLockLight(u, pW).add(clear.rgb),
        after: clear.w,
        sky: u.hazeHigh.mul(0.5).add(u.hazeLow.mul(0.12)),
    };
}

// ── Painted shopfronts ──────────────────────────────────────────────────────────

/**
 * @param {object} u
 * @param {object[]} shops   plan.shops of kind 0
 * @param {object} atlas     TextureNode over the shopfront atlas (value swapped when loaded)
 * @param {object} fade      uniform 0..1: the paintings power up once the atlas has arrived
 */
export function createPaintedShops(u, shops, atlas, fade) {
    const count = Math.max(1, shops.length);
    const aPos = new Float32Array(count * 4);
    const aDim = new Float32Array(count * 4);
    const aRect = new Float32Array(count * 4);
    const aOpen = new Float32Array(count * 4);
    const aLook = new Float32Array(count * 4);
    shops.forEach((s, i) => {
        aPos.set([s.side * (STREET.halfStreet - 0.03), 0.12 + s.h / 2, s.z, s.seed], i * 4);
        aDim.set([s.w, s.h, s.side, 0], i * 4);
        aRect.set(SHOPFRONT_CELLS[s.cell].rect, i * 4);
        aOpen.set(s.open, i * 4);
        aLook.set([s.rgb[0], s.rgb[1], s.rgb[2], s.recess], i * 4);
    });
    const geometry = ndQuadGeometry(shops.length, {
        aPos: [aPos, 4], aDim: [aDim, 4], aRect: [aRect, 4], aOpen: [aOpen, 4], aLook: [aLook, 4],
    }, { interleave: true });
    const pos = attribute('aPos', 'vec4');
    const dim = attribute('aDim', 'vec4');
    const rect = attribute('aRect', 'vec4');
    const open = attribute('aOpen', 'vec4');
    const look = attribute('aLook', 'vec4');

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'NeonDistrictShopfronts';
    material.fog = false;
    material.positionNode = shopFrame(u, pos, dim);

    material.colorNode = Fn(() => {
        const ctx = shopContext(u, pos, dim);
        const rec = traceRecess(ctx, open, look.w);
        const inOpen = ndBoxAA(vec2(ctx.uM, ctx.vM), rec.o0, rec.o1, vec2(ctx.fwU, ctx.fwV).mul(0.8).add(0.002));
        const glass = wetGlass(u, ctx, rec.g, ctx.seed);
        // Atlas rect is (u0, v0, u1, v1) with v down from the top of the image.
        const atlasAt = (p) => atlas.sample(vec2(
            mix(rect.x, rect.z, clamp(p.x, 0.0, 1.0)),
            float(1.0).sub(mix(rect.w, rect.y, clamp(p.y, 0.0, 1.0))),
        )).rgb;
        const flushT = atlasAt(ctx.st);
        const backT = atlasAt(rec.g.add(glass.offset).div(vec2(ctx.w, ctx.h)));
        // A shop in ten has a failing transformer.
        const buzz = step(0.9, ndHash21(vec2(ctx.seed, 3.0)))
            .mul(step(0.62, ndHash21(vec2(floor(u.time.mul(11.0)), ctx.seed))));
        const power = u.neon.mul(0.93).add(0.07).mul(float(1.0).sub(buzz.mul(0.45))).mul(fade);
        // The paintings are already lit: lift their neon into HDR, leave the brickwork dark.
        const lift = (t) => {
            const peak = ndMax3(t);
            return t.mul(peak.mul(peak).mul(3.1).add(0.42)).mul(power)
                .add(ctx.pulse.mul(peak.mul(1.4).add(0.1)))
                .add(t.mul(ctx.after.mul(0.2)));
        };
        const flush = lift(flushT);
        const behind = lift(backT).mul(glass.transmit).add(glass.add);
        const reveal = revealColor(ctx, rec, look.rgb.mul(power));
        const recessed = mix(reveal, behind, rec.glass);
        return ndAtmosphere(u, mix(flush, recessed, inOpen), ctx.pW);
    })();
    return finish('NeonDistrictShopfronts', geometry, material);
}

// ── Generated shops ─────────────────────────────────────────────────────────────

/** Signed distance to a capsule from a to b, radius r (2D). */
const ndSdCapsule = /* @__PURE__ */ Fn(([q, a, b, r]) => {
    const pa = q.sub(a);
    const ba = b.sub(a);
    const h = clamp(dot(pa, ba).div(dot(ba, ba)), 0.0, 1.0);
    return length(pa.sub(ba.mul(h))).sub(r);
}).setLayout({
    name: 'nd_sdCapsule',
    type: 'float',
    inputs: [{ name: 'q', type: 'vec2' }, { name: 'a', type: 'vec2' }, { name: 'b', type: 'vec2' }, { name: 'r', type: 'float' }],
});

/** Signed distance to a box of half-size b with corners rounded by r (2D). */
const ndSdRoundBox = /* @__PURE__ */ Fn(([q, b, r]) => {
    const d = abs(q).sub(b).add(r);
    return length(max(d, 0.0)).add(min(max(d.x, d.y), 0.0)).sub(r);
}).setLayout({
    name: 'nd_sdRoundBox',
    type: 'float',
    inputs: [{ name: 'q', type: 'vec2' }, { name: 'b', type: 'vec2' }, { name: 'r', type: 'float' }],
});

/**
 * A person's silhouette, in a frame where the person is 1.75 m tall and stands on y = 0: head,
 * body, arms and legs that swing with `swing` (−1..1), or sitting cross-legged (`seated` 1).
 */
const ndFigure = /* @__PURE__ */ Fn(([q, swing, seated]) => {
    const head = length(q.sub(vec2(0.0, 1.6))).sub(0.125);
    const torso = ndSdRoundBox(q.sub(vec2(0.0, 1.17)), vec2(0.23, 0.31), 0.11);
    const armL = ndSdCapsule(q, vec2(-0.23, 1.38), vec2(swing.mul(-0.08).sub(0.27), 0.9), 0.06);
    const armR = ndSdCapsule(q, vec2(0.23, 1.38), vec2(swing.mul(0.08).add(0.27), 0.9), 0.06);
    const legL = ndSdCapsule(q, vec2(-0.1, 0.9), vec2(swing.mul(0.18).sub(0.1), 0.04), 0.085);
    const legR = ndSdCapsule(q, vec2(0.1, 0.9), vec2(swing.mul(-0.18).add(0.1), 0.04), 0.085);
    const stand = min(min(head, torso), min(min(armL, armR), min(legL, legR)));
    const sHead = length(q.sub(vec2(0.0, 0.98))).sub(0.115);
    const sTorso = ndSdRoundBox(q.sub(vec2(0.0, 0.62)), vec2(0.18, 0.26), 0.09);
    const sLegs = ndSdRoundBox(q.sub(vec2(0.0, 0.14)), vec2(0.36, 0.1), 0.09);
    const seat = min(sHead, min(sTorso, sLegs));
    return mix(stand, seat, seated);
}).setLayout({
    name: 'nd_figure',
    type: 'float',
    inputs: [{ name: 'q', type: 'vec2' }, { name: 'swing', type: 'float' }, { name: 'seated', type: 'float' }],
});

/** A per-archetype value (SHOP_ARCHETYPES order) as a select chain on `arch`. */
const byArch = (arch, values) => values.slice(0, -1).reduceRight(
    (rest, v, i) => select(arch.lessThan(i + 0.5), float(v), rest),
    float(values[values.length - 1]),
);

/**
 * The room behind a generated shop's glass, by archetype (SHOP_ARCHETYPES order). `p` is where
 * the ray crossed the glazing (metres in the shop frame), `rd` the ray, `o0`/`o1` the opening.
 * Returns the room's colour (HDR), lit by `light` and accented by `accent`.
 */
function shopInterior(u, {
    p, rd, o0, o1, depth, arch, light, accent, seed, lit,
}) {
    // Everything the archetype branches read is made a variable HERE, before the If chain: a node
    // first emitted inside a branch is assigned only on that branch's path.
    const roomX0 = o0.x.sub(0.45);
    const roomX1 = o1.x.add(0.45);
    const floorY = o0.y.sub(0.02);
    const ceilY = o1.y.add(0.5);
    const rdz = max(rd.z, 0.02);
    const tz = depth.div(rdz);
    const tx = max(select(rd.x.greaterThan(0.0), roomX1.sub(p.x), roomX0.sub(p.x)).div(safe(rd.x)), 0.0);
    const ty = max(select(rd.y.greaterThan(0.0), ceilY.sub(p.y), floorY.sub(p.y)).div(safe(rd.y)), 0.0);
    const t = min(tz, min(tx, ty));
    const hit = vec3(p.x.add(rd.x.mul(t)), p.y.add(rd.y.mul(t)), rd.z.mul(t)).toVar();
    const isBack = step(tz, min(tx, ty));
    const isY = float(1.0).sub(isBack).mul(step(ty, tx));
    const isCeil = isY.mul(step(0.0, rd.y));
    const isFloor = isY.sub(isCeil);
    const bx = hit.x.sub(roomX0).toVar();
    const by = hit.y.sub(floorY).toVar();
    const bz = hit.z.div(depth).toVar();
    // The mid layer: a counter, aisles, cabinets, at 42 % of the room's depth.
    const tm = depth.mul(0.42).div(rdz);
    const midFront = step(tm, t).toVar();
    const mx = p.x.add(rd.x.mul(tm)).sub(roomX0).toVar();
    const my = p.y.add(rd.y.mul(tm)).sub(floorY).toVar();
    const roomH = ceilY.sub(floorY).toVar();
    const roomW = roomX1.sub(roomX0).toVar();

    const L = light.mul(lit).toVar();
    const back = vec3(0.0).toVar();
    const midMask = float(0.0).toVar();
    const mid = vec3(0.0).toVar();
    const ceil = vec3(0.0).toVar();
    const flo = vec3(0.0).toVar();
    const dim = float(1.0).toVar();
    // Light hanging in the room's air (a noodle counter's steam), added over everything behind it.
    const haze = vec3(0.0).toVar();
    const h1 = (a, b) => ndHash21(vec2(a, b.add(seed)));
    // A television high on the back wall (diner, bar), changing picture now and then.
    const tvX = bx.sub(roomW.mul(0.74)).toVar();
    const tvY = by.sub(2.1).toVar();
    const tvIn = step(abs(tvX), 0.42).mul(step(abs(tvY), 0.24)).toVar();
    const tvCell = floor(vec2(tvX.add(0.42).div(0.21), tvY.add(0.24).div(0.16)));
    const tvHash = ndHash22(tvCell.add(vec2(floor(u.time.mul(1.3)), seed)));
    const tvPic = mix(vec3(0.15, 0.3, 0.9), vec3(1.0, 0.5, 0.2), tvHash.x).mul(tvHash.y.mul(0.8).add(0.4))
        .mul(sin(by.mul(300.0)).mul(0.1).add(0.9))
        .toVar();
    const tvFrame = step(abs(tvX), 0.47).mul(step(abs(tvY), 0.29)).sub(tvIn).toVar();
    const tvSpill = exp(length(vec2(tvX, tvY)).mul(-2.2)).mul(0.12).toVar();
    const withTv = (col) => mix(col, tvPic.mul(1.4), tvIn).mul(float(1.0).sub(tvFrame.mul(0.9))).add(tvPic.mul(tvSpill).mul(lit));
    // A ceiling fan turning slowly over the room (diner, bar).
    const fanC = vec2(bx.sub(roomW.mul(0.5)), hit.z.sub(depth.mul(0.45)));
    const fanA = atan(fanC.y, fanC.x).add(u.time.mul(2.4));
    const fanR = length(fanC);
    const fanShade = clamp(step(fanR, 0.62).mul(smoothstep(0.72, 0.92, abs(sin(fanA.mul(2.0))))).add(step(fanR, 0.09)), 0.0, 1.0)
        .mul(0.85)
        .toVar();

    If(arch.lessThan(0.5), () => {
        // diner: menu boards over the back counter, a counter with pendant lamps over it
        const board = step(1.85, by).mul(step(by, 2.45)).mul(step(0.1, fract(bx.div(1.3)))).mul(step(fract(bx.div(1.3)), 0.9));
        const lines = step(0.45, fract(by.mul(9.0))).mul(0.35).add(0.65);
        back.assign(withTv(vec3(0.16, 0.09, 0.05).mul(L).mul(mix(float(0.5), float(1.0), step(1.0, by)))
            .add(L.mul(board).mul(lines).mul(1.6).mul(float(1.0).sub(tvIn)))));
        // Steam off the bowls on the counter, curling up into the lamplight.
        const wisp = u.noise(vec2(mx.mul(0.7).add(seed.mul(0.1)), my.mul(0.5).sub(u.time.mul(0.22)))).r;
        const bowls = smoothstep(0.32, 0.12, abs(fract(mx.div(1.6)).sub(0.5)));
        // Steam is pale: the lamplight, washed toward white.
        haze.assign(mix(L, vec3(0.9), 0.55).mul(smoothstep(0.45, 0.85, wisp).mul(bowls).mul(smoothstep(1.05, 1.35, my)).mul(smoothstep(2.4, 1.5, my)))
            .mul(0.22)
            .mul(midFront));
        const pend = vec2(fract(mx.div(1.4)).sub(0.5).mul(1.4), my.sub(roomH.sub(0.8)));
        const bulb = smoothstep(0.14, 0.1, length(pend));
        const cord = smoothstep(0.012, 0.004, abs(pend.x)).mul(step(0.0, pend.y));
        const counter = step(my, 1.05);
        midMask.assign(max(max(counter, bulb), cord));
        mid.assign(mix(
            vec3(0.09, 0.05, 0.03).mul(L).mul(smoothstep(0.0, 1.05, my).mul(0.6).add(0.4))
                .add(L.mul(smoothstep(0.96, 1.04, my)).mul(0.5))
                .add(accent.mul(smoothstep(0.16, 0.1, abs(my.sub(0.12)))).mul(0.6)),
            L.mul(3.2).add(vec3(0.6, 0.35, 0.15)).mul(bulb.mul(float(1.0).sub(counter))),
            bulb.mul(float(1.0).sub(counter)),
        ).mul(float(1.0).sub(cord.mul(0.9).mul(float(1.0).sub(counter)))));
        ceil.assign(L.mul(0.12).mul(float(1.0).sub(fanShade)));
        flo.assign(L.mul(mix(float(0.05), float(0.16), step(0.5, fract(floor(hit.x.div(0.3)).add(floor(hit.z.div(0.3))).mul(0.5))))));
    }).ElseIf(arch.lessThan(1.5), () => {
        // laundry: two rows of washer doors, their drums turning
        const cellX = floor(bx.div(0.72));
        const local = vec2(fract(bx.div(0.72)).sub(0.5).mul(0.72), by.sub(select(by.lessThan(0.86), float(0.5), float(1.22))));
        const rr = length(local);
        const running = step(0.35, h1(cellX, step(0.86, by)));
        const ang = atan(local.y, local.x).add(u.time.mul(h1(cellX, float(3.0)).mul(5.0).add(4.0)).mul(running));
        const swirl = sin(ang.mul(3.0).add(rr.mul(30.0))).mul(0.25).add(0.75);
        const spin = u.time.mul(h1(cellX, float(3.0)).mul(5.0).add(4.0)).mul(running);
        const turned = vec2(local.x.mul(cos(spin)).sub(local.y.mul(sin(spin))), local.x.mul(sin(spin)).add(local.y.mul(cos(spin))));
        const cloth = u.noise(turned.mul(2.6).add(vec2(cellX.mul(0.37), seed.mul(0.1)))).r;
        const clothHue = h1(cellX, float(8.0));
        const clothCol = mix(mix(vec3(0.9, 0.25, 0.35), vec3(0.25, 0.5, 1.0), step(0.33, clothHue)), vec3(0.95, 0.85, 0.3), step(0.66, clothHue));
        const door = smoothstep(0.26, 0.245, rr).mul(step(by, 1.55));
        const rim = smoothstep(0.31, 0.295, rr).mul(float(1.0).sub(door)).mul(step(by, 1.55));
        const tiles = step(0.06, fract(bx.div(0.2))).mul(step(0.06, fract(by.div(0.2)))).mul(0.15).add(0.45);
        back.assign(L.mul(tiles).mul(0.22).mul(float(1.0).sub(rim).mul(float(1.0).sub(door)))
            .add(L.mul(rim).mul(0.9))
            .add(mix(vec3(0.06, 0.08, 0.14), mix(
                accent.mul(0.5).add(vec3(0.25, 0.4, 0.9)).mul(swirl),
                clothCol.mul(0.8),
                smoothstep(0.48, 0.62, cloth).mul(step(rr, 0.2)),
            ), running).mul(door)));
        const table = step(my, 0.92).mul(step(fract(mx.div(3.4)), 0.5));
        midMask.assign(table);
        mid.assign(L.mul(0.3).mul(smoothstep(0.0, 0.92, my).mul(0.5).add(0.3)).add(L.mul(smoothstep(0.86, 0.92, my)).mul(0.6)));
        ceil.assign(L.mul(mix(float(0.25), float(2.2), step(abs(fract(hit.z.div(1.4)).sub(0.5)), 0.08))));
        flo.assign(L.mul(0.18));
    }).ElseIf(arch.lessThan(2.5), () => {
        // mart: a fridge wall of bright doors and products, aisles of shelves
        const doorX = fract(bx.div(0.75));
        const frame = max(float(1.0).sub(step(0.06, doorX).mul(step(doorX, 0.94))), step(2.2, by));
        const shelf = floor(by.div(0.32));
        const item = floor(bx.div(0.12));
        const hue = h1(item, shelf);
        const product = step(fract(by.div(0.32)), 0.7).mul(step(0.15, fract(bx.div(0.12))));
        const productCol = mix(mix(vec3(1.0, 0.25, 0.2), vec3(0.2, 0.7, 1.0), step(0.4, hue)), vec3(1.0, 0.85, 0.2), step(0.75, hue));
        const doorIdx = floor(bx.div(0.75));
        const failing = step(0.9, h1(doorIdx, float(9.0)));
        const fridge = mix(float(1.0), step(0.25, ndHash21(vec2(floor(u.time.mul(14.0)), doorIdx.add(seed)))).mul(0.7).add(0.3), failing);
        back.assign(mix(L.mul(1.3).mul(fridge).add(productCol.mul(product).mul(0.9)), vec3(0.04).mul(L), frame));
        const aisle = step(fract(mx.div(2.4)), 0.46).mul(step(my, 1.7));
        const aShelf = floor(my.div(0.36));
        const aItem = floor(mx.div(0.1));
        const aHue = h1(aItem, aShelf.add(11.0));
        const aCol = mix(mix(vec3(1.0, 0.3, 0.5), vec3(0.3, 1.0, 0.5), step(0.33, aHue)), vec3(0.3, 0.6, 1.0), step(0.66, aHue));
        midMask.assign(aisle);
        mid.assign(L.mul(0.55).mul(mix(float(0.2), float(1.0), step(fract(my.div(0.36)), 0.78))).mul(aCol.mul(0.6).add(0.4)));
        ceil.assign(L.mul(mix(float(0.6), float(2.6), step(0.12, fract(hit.x.div(1.2))).mul(step(0.2, fract(hit.z.div(1.0)))))));
        flo.assign(L.mul(0.25));
    }).ElseIf(arch.lessThan(3.5), () => {
        // arcade: a dark room of glowing cabinets
        dim.assign(0.35);
        const cab = floor(bx.div(0.8));
        const cx = fract(bx.div(0.8));
        const body = step(0.08, cx).mul(step(cx, 0.92)).mul(step(by, 2.0));
        const hue = fract(h1(cab, float(2.0)).add(u.time.mul(0.03)));
        const scr = mix(mix(vec3(0.2, 0.6, 1.0), vec3(1.0, 0.2, 0.7), step(0.33, hue)), vec3(0.3, 1.0, 0.4), step(0.66, hue));
        const screen = step(0.2, cx).mul(step(cx, 0.8)).mul(step(1.15, by)).mul(step(by, 1.6));
        const scan = sin(by.mul(220.0)).mul(0.12).add(0.88).mul(ndHash21(vec2(floor(u.time.mul(8.0)), cab)).mul(0.25).add(0.75));
        const marquee = step(0.12, cx).mul(step(cx, 0.88)).mul(step(1.74, by)).mul(step(by, 1.94));
        // Attract mode: bars rolling down, a ball bouncing across.
        const sx = cx.sub(0.2).div(0.6);
        const sy = by.sub(1.15).div(0.45);
        const bars = step(0.5, fract(sy.mul(6.0).add(u.time.mul(1.5)).add(cab.mul(0.31)))).mul(0.35).add(0.65);
        const ballP = vec2(abs(fract(u.time.mul(0.35).add(cab.mul(0.17))).mul(2.0).sub(1.0)), abs(sin(u.time.mul(2.2).add(cab))));
        const ball = smoothstep(0.09, 0.05, length(vec2(sx, sy).sub(ballP).mul(vec2(1.0, 1.4))));
        back.assign(vec3(0.012).mul(body).add(scr.mul(screen).mul(scan).mul(bars.add(ball.mul(1.5))).mul(1.8))
            .add(scr.yzx.mul(marquee).mul(1.4))
            .add(L.mul(0.04)));
        const mCab = step(fract(mx.div(2.6)), 0.3).mul(step(my, 1.9));
        const edge = smoothstep(0.24, 0.3, fract(mx.div(2.6)));
        midMask.assign(mCab);
        mid.assign(vec3(0.01).add(accent.mul(edge).mul(0.8)).add(scr.zxy.mul(step(1.75, my)).mul(1.2)));
        ceil.assign(accent.mul(step(abs(fract(hit.x.div(1.6)).sub(0.5)), 0.03)).mul(1.5).add(L.mul(0.03)));
        const speck = step(0.8, ndHash22(floor(hit.xz.div(0.08))).x);
        flo.assign(mix(vec3(0.015, 0.01, 0.03), accent.mul(0.25), speck));
    })
        .ElseIf(arch.lessThan(4.5), () => {
        // boutique: lit cubbies under spotlights, a display table
            const cu = fract(bx.div(0.55));
            const cv = fract(by.div(0.45));
            const cubby = step(0.07, cu).mul(step(cu, 0.93)).mul(step(0.08, cv)).mul(step(cv, 0.92))
                .mul(step(0.4, by))
                .mul(step(by, 2.4));
            const itemOn = step(abs(cu.sub(0.5)), 0.18).mul(step(0.12, cv)).mul(step(cv, 0.55));
            const spot = exp(abs(fract(bx.div(1.1)).sub(0.5)).mul(-6.0)).mul(smoothstep(0.6, 2.6, by));
            back.assign(L.mul(0.12).add(L.mul(cubby).mul(0.55)).add(accent.mul(itemOn).mul(cubby).mul(1.3)).add(L.mul(spot).mul(0.4)));
            const table = step(my, 0.86).mul(step(abs(mx.sub(roomW.mul(0.5))), 1.1));
            const goods = step(0.86, my).mul(step(my, 0.98)).mul(step(abs(mx.sub(roomW.mul(0.5))), 0.9))
                .mul(step(0.5, fract(mx.div(0.3))));
            midMask.assign(max(table, goods));
            mid.assign(L.mul(0.22).add(L.mul(smoothstep(0.8, 0.86, my)).mul(0.9)).add(accent.mul(goods).mul(1.2)));
            ceil.assign(L.mul(0.08).add(L.mul(smoothstep(0.12, 0.06, length(vec2(fract(hit.x.div(1.1)).sub(0.5), fract(hit.z.div(1.5)).sub(0.5))))).mul(4.0)));
            flo.assign(L.mul(0.12));
        })
        .ElseIf(arch.lessThan(5.5), () => {
        // bar: backlit bottles on three shelves, a bar counter with a brass rail
            dim.assign(0.4);
            const row = clamp(floor(by.sub(1.05).div(0.4)), 0.0, 2.0);
            const rowY = row.mul(0.4).add(1.25);
            const strip = smoothstep(0.05, 0.0, abs(by.sub(rowY))).mul(step(1.05, by)).mul(step(by, 2.3));
            const bot = floor(bx.div(0.11));
            const bh = h1(bot, row).mul(0.1).add(0.22);
            const bottle = step(0.25, fract(bx.div(0.11))).mul(step(fract(bx.div(0.11)), 0.8))
                .mul(step(rowY, by)).mul(step(by, rowY.add(bh)))
                .mul(step(1.05, by))
                .mul(step(by, 2.3));
            const glassCol = mix(vec3(1.0, 0.55, 0.15), vec3(0.4, 1.0, 0.5), step(0.7, h1(bot, row.add(4.0))));
            back.assign(withTv(vec3(0.01).add(L.mul(strip).mul(2.2)).add(glassCol.mul(bottle).mul(L.x.add(0.3)).mul(0.9))
                .add(accent.mul(smoothstep(0.03, 0.0, abs(by.sub(2.5)))).mul(1.6))));
            const counter = step(my, 1.1);
            midMask.assign(counter);
            mid.assign(vec3(0.03, 0.015, 0.008).mul(L.add(0.2)).add(L.mul(smoothstep(1.02, 1.1, my)).mul(0.8))
                .add(vec3(1.0, 0.7, 0.3).mul(smoothstep(0.02, 0.0, abs(my.sub(0.25)))).mul(0.6)));
            ceil.assign(L.mul(0.05).mul(float(1.0).sub(fanShade)));
            flo.assign(L.mul(0.04));
        })
        .ElseIf(arch.lessThan(6.5), () => {
        // gym: a mirror wall and a weight rack, machines on the floor
            const mirror = step(0.3, by).mul(step(by, 2.4)).mul(step(0.04, fract(bx.div(1.2))));
            back.assign(L.mul(mix(float(0.35), float(0.12), mirror)).add(L.mul(mirror).mul(smoothstep(2.4, 0.3, by)).mul(0.25))
                .add(accent.mul(smoothstep(0.03, 0.0, abs(by.sub(2.6)))).mul(1.5)));
            const mxl = fract(mx.div(2.1));
            const deck = step(0.1, mxl).mul(step(mxl, 0.7)).mul(step(my, mxl.mul(0.25).add(0.12)));
            const post = step(abs(mxl.sub(0.66)), 0.03).mul(step(my, 1.3));
            const bar = step(abs(my.sub(1.15)), 0.035).mul(step(0.5, mxl)).mul(step(mxl, 0.7));
            midMask.assign(max(deck, max(post, bar)));
            mid.assign(vec3(0.02).add(accent.mul(0.3).mul(post.add(bar))));
            ceil.assign(L.mul(mix(float(0.2), float(2.0), step(abs(fract(hit.x.div(1.5)).sub(0.5)), 0.05))));
            flo.assign(L.mul(0.14));
        })
        .ElseIf(arch.lessThan(7.5), () => {
        // office: shelving of parcels behind a service counter with screens
            const shelfRow = floor(by.div(0.5));
            const box = floor(bx.div(0.32).add(h1(shelfRow, float(6.0))));
            const boxH = h1(box, shelfRow).mul(0.2).add(0.18);
            const parcel = step(fract(by.div(0.5)), boxH.div(0.5)).mul(step(0.08, fract(bx.div(0.32)))).mul(step(by, 2.0));
            back.assign(L.mul(0.12).add(vec3(0.35, 0.22, 0.12).mul(L).mul(parcel).mul(0.8))
                .add(accent.mul(step(2.15, by).mul(step(by, 2.4))).mul(1.4)));
            const counter = step(my, 1.05);
            const scr = step(1.1, my).mul(step(my, 1.42)).mul(step(abs(fract(mx.div(1.5)).sub(0.5)), 0.17));
            midMask.assign(max(counter, scr));
            const rows = step(0.5, fract(my.mul(28.0).sub(u.time.mul(0.6)))).mul(0.4).add(0.6);
            mid.assign(L.mul(0.18).add(L.mul(smoothstep(0.98, 1.05, my)).mul(0.5)).add(vec3(0.4, 0.7, 1.0).mul(scr).mul(rows).mul(1.6)));
            ceil.assign(L.mul(mix(float(0.3), float(1.8), step(0.15, fract(hit.x.div(1.2))).mul(step(0.3, fract(hit.z.div(1.2)))))));
            flo.assign(L.mul(0.15));
        })
        .Else(() => {
        // calm: round lamps on wood slats, mats on an open floor
            const slats = sin(bx.mul(36.0)).mul(0.08).add(0.92);
            const lamp = vec2(fract(bx.div(2.2)).sub(0.5).mul(2.2), by.sub(1.55));
            const disc = smoothstep(0.46, 0.38, length(lamp));
            const haloL = exp(length(lamp).mul(-2.2)).mul(0.5);
            const breathe = u.breath.mul(0.75).add(0.45);
            back.assign(vec3(0.2, 0.13, 0.08).mul(L).mul(slats).mul(0.6)
                .add(accent.mul(disc.mul(1.6).add(haloL)).mul(breathe)));
            ceil.assign(L.mul(0.1).add(accent.mul(smoothstep(0.6, 1.0, bz)).mul(0.25)));
            const mat = step(0.15, fract(hit.x.div(1.6))).mul(step(fract(hit.x.div(1.6)), 0.75)).mul(step(0.2, bz)).mul(step(bz, 0.8));
            flo.assign(vec3(0.16, 0.1, 0.06).mul(L).mul(0.5).add(accent.mul(mat).mul(0.12)));
        });

    const side = vec3(0.6).mul(L).mul(0.12).mul(dim);
    const shell = back.mul(isBack).add(ceil.mul(isCeil)).add(flo.mul(isFloor))
        .add(side.mul(float(1.0).sub(isBack).sub(isY)));
    const fall = exp(t.mul(-0.2));
    const room = shell.mul(fall).toVar();

    // ── People: staff behind the counter, customers crossing the window ──
    // A figure stands on a plane at a fraction of the room's depth; the ray meets it there, and it
    // hides what is behind when it is nearer than the surface the ray hit. Backlit by the room, so
    // a dark silhouette with a rim of the room's light.
    const crowd = step(0.3, lit);
    const backN = byArch(arch, [1, 0, 0, 2, 0, 1, 2, 1, 1]).mul(crowd);
    const frontN = byArch(arch, [1, 1, 2, 1, 1, 1, 0, 1, 0]).mul(crowd);
    const backAt = byArch(arch, [0.62, 0.6, 0.6, 0.86, 0.6, 0.62, 0.44, 0.62, 0.7]);
    const backMode = byArch(arch, [0, 0, 0, 3, 0, 0, 1, 0, 2]);
    const person = (at, x, height, swing, bob, seated, dress) => {
        const tp = depth.mul(at).div(rdz);
        const px = p.x.add(rd.x.mul(tp)).sub(roomX0).sub(x);
        const py = p.y.add(rd.y.mul(tp)).sub(floorY).sub(bob);
        const s = height.div(1.75);
        const d = ndFigure(vec2(px, py).div(s), swing, seated).mul(s);
        const mask = smoothstep(0.012, -0.004, d).mul(step(tp, t));
        // Dark clothes in the room's light, a thin edge of light round them.
        const rim = smoothstep(-0.016, 0.0, d);
        const clothes = mix(vec3(0.07, 0.07, 0.09), mix(vec3(0.5, 0.18, 0.2), vec3(0.15, 0.3, 0.5), dress), 0.45);
        return { mask, col: clothes.mul(L).mul(0.18).add(L.mul(rim).mul(0.25)) };
    };
    for (let k = 0; k < 2; k++) {
        const hk = h1(float(31 + k), float(2.0));
        const on = step(k + 0.5, backN).mul(step(hk, 0.92));
        // Staff work a spot on the counter, then walk briskly to another and work that; gym-goers
        // run in place; arcade players sway and bounce at their cabinet; Hale's visitor sits still
        // and breathes.
        const runner = step(abs(backMode.sub(1.0)), 0.5);
        const seated = step(abs(backMode.sub(2.0)), 0.5);
        const player = step(abs(backMode.sub(3.0)), 0.5);
        const staff = float(1.0).sub(runner).sub(seated).sub(player);
        const shift = fract(u.time.mul(hk.mul(0.03).add(0.05)).add(hk.mul(5.0)).add(k * 0.5));
        const over = smoothstep(0.1, 0.3, shift).sub(smoothstep(0.6, 0.8, shift));
        const walking = step(0.1, shift).mul(step(shift, 0.3)).add(step(0.6, shift).mul(step(shift, 0.8)));
        const spotA = roomW.mul(hk.mul(0.3).add(0.2));
        const spotB = spotA.add(roomW.mul(0.35).add(0.4).mul(select(hk.greaterThan(0.5), float(-1.0), float(1.0))));
        const staffX = mix(spotA, clamp(spotB, 0.5, roomW.sub(0.5)), over).add(sin(u.time.mul(0.7).add(hk.mul(9.0))).mul(0.03));
        const home = mix(staffX, float(k).add(0.35).mul(2.1), runner);
        const cabinet = floor(hk.mul(roomW).div(0.8)).add(0.5).mul(0.8)
            .add(sin(u.time.mul(1.3).add(k * 2.0)).mul(0.05));
        const x = mix(mix(home, cabinet, player), roomW.mul(0.5), seated);
        const run = sin(u.time.mul(9.0).add(k * 2.1)).mul(runner);
        const step7 = sin(staffX.mul(7.5)).mul(walking).mul(staff);
        const sway = sin(u.time.mul(1.3).add(k * 2.0)).mul(0.2).mul(player);
        const bob = abs(run).mul(0.05).add(abs(step7).mul(0.025))
            .add(abs(sin(u.time.mul(2.6).add(k))).mul(0.015).mul(player))
            .add(u.breath.mul(0.015).mul(seated));
        If(on.greaterThan(0.5), () => {
            const fig = person(backAt, x, hk.mul(0.2).add(1.65), run.add(step7).add(sway), bob, seated, fract(hk.mul(7.3)));
            room.assign(mix(room, fig.col, fig.mask));
        });
    }
    room.assign(mix(room, mid, midMask.mul(midFront)));
    for (let k = 0; k < 2; k++) {
        const hk = h1(float(41 + k), float(5.0));
        const on = step(k + 0.5, frontN).mul(step(hk, 0.88));
        // A walk across the room and back, with a pause at each end.
        const phase = fract(u.time.mul(hk.mul(0.035).add(0.045)).add(hk.mul(13.0)).add(k * 0.37));
        const there = smoothstep(0.05, 0.45, phase).sub(smoothstep(0.55, 0.95, phase));
        const moving = step(0.05, phase).mul(step(phase, 0.45)).add(step(0.55, phase).mul(step(phase, 0.95)));
        const x = mix(float(0.35), roomW.sub(0.35), there);
        const stride = sin(x.mul(7.0)).mul(moving);
        If(on.greaterThan(0.5), () => {
            const fig = person(float(0.18 + k * 0.08), x, hk.mul(0.25).add(1.6), stride, abs(stride).mul(0.025), float(0.0), fract(hk.mul(5.1)));
            room.assign(mix(room, fig.col, fig.mask));
        });
    }
    return room.add(haze);
}

/**
 * @param {object} u
 * @param {object[]} shops   plan.shops of kind 1
 * @param {object} opts
 * @param {THREE.Texture} opts.glyphTex  the sign alphabet
 * @param {THREE.Texture} opts.textTex   the plan's lines (neon-district-text.js)
 * @param {number} opts.textRows         lines in the text texture
 * @param {boolean} [opts.rooms=true]    interior-mapped shops (else a flat lit room)
 * @param {object} [opts.logos]          { texture, grid, range, anim: number[], period: number[] }
 */
export function createGeneratedShops(u, shops, opts) {
    const rooms = opts.rooms !== false;
    const logos = opts.logos || null;
    const count = Math.max(1, shops.length);
    const aPos = new Float32Array(count * 4);
    const aDim = new Float32Array(count * 4);
    const aOpen = new Float32Array(count * 4);
    const aText = new Float32Array(count * 4);
    const aShop = new Float32Array(count * 4);
    const aCol = new Float32Array(count * 4);
    const aCol2 = new Float32Array(count * 4);
    const aLight = new Float32Array(count * 4);
    const aLogo = new Float32Array(count * 4);
    shops.forEach((s, i) => {
        aPos.set([s.side * (STREET.halfStreet - 0.03), 0.12 + s.h / 2, s.z, s.seed], i * 4);
        aDim.set([s.w, s.h, s.side, 1], i * 4);
        aOpen.set(s.open, i * 4);
        aText.set([s.nameRow, s.name.length, s.signRow, s.sign.length], i * 4);
        aShop.set([s.archetype, s.style, s.shutter, s.door], i * 4);
        aCol.set([s.rgb[0], s.rgb[1], s.rgb[2], s.fascia], i * 4);
        aCol2.set([s.rgb2[0], s.rgb2[1], s.rgb2[2], s.recess], i * 4);
        aLight.set([s.light[0], s.light[1], s.light[2], 4.2 + (s.seed % 7) * 0.4], i * 4);
        const logo = logos && s.logo >= 0 ? s.logo : -1;
        aLogo.set([logo, logo >= 0 ? logos.anim[logo] : 0, logo >= 0 ? logos.period[logo] : 1, 0], i * 4);
    });
    const geometry = ndQuadGeometry(shops.length, {
        aPos: [aPos, 4],
        aDim: [aDim, 4],
        aOpen: [aOpen, 4],
        aText: [aText, 4],
        aShop: [aShop, 4],
        aCol: [aCol, 4],
        aCol2: [aCol2, 4],
        aLight: [aLight, 4],
        aLogo: [aLogo, 4],
    }, { interleave: true });
    const pos = attribute('aPos', 'vec4');
    const dim = attribute('aDim', 'vec4');
    const open = attribute('aOpen', 'vec4');
    const text = attribute('aText', 'vec4');
    const shop = attribute('aShop', 'vec4');
    const col = attribute('aCol', 'vec4');
    const col2 = attribute('aCol2', 'vec4');
    const light = attribute('aLight', 'vec4');
    const logo = attribute('aLogo', 'vec4');
    const { glyphTex, textTex } = opts;
    const textRows = Math.max(1, opts.textRows || 1);

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'NeonDistrictShops';
    material.fog = false;
    material.positionNode = shopFrame(u, pos, dim);

    material.colorNode = Fn(() => {
        const ctx = shopContext(u, pos, dim);
        const {
            uM, vM, w, h, seed,
        } = ctx;
        const arch = floor(shop.x.add(0.5)).toVar();
        const style = floor(shop.y.add(0.5));
        const shutter = shop.z;
        const accent = col.rgb;
        const second = col2.rgb;
        const rec = traceRecess(ctx, open, col2.w);
        const { o0, o1 } = rec;
        const aa = vec2(ctx.fwU, ctx.fwV).mul(0.8).add(0.002);
        const inOpen = ndBoxAA(vec2(uM, vM), o0, o1, aa);

        // ── Life: the shop's power, a failing tube now and then ──
        const hum = sin(u.time.mul(37.0).add(seed)).mul(0.03).add(0.97);
        const buzzing = step(0.88, ndHash11(seed.mul(0.71).add(2.0)));
        const buzz = mix(float(1.0), step(0.3, ndHash21(vec2(floor(u.time.mul(13.0)), seed))).mul(0.6).add(0.4), buzzing);
        const mains = u.neon.mul(0.94).add(0.06);
        const open01 = float(1.0).sub(step(0.999, shutter));
        const lit = mains.mul(open01.mul(0.85).add(0.15)).toVar();
        const inside = light.rgb.mul(lit).toVar();
        const tint = mix(accent, vec3(1.0, 0.72, 0.26), u.heat.mul(0.6)).toVar();

        // ── Fascia: the shop's name ──
        const fy0 = h.mul(float(1.0).sub(col.w));
        const b0 = vec2(0.1, fy0.add(0.07));
        const b1 = vec2(w.sub(0.1), h.sub(0.05));
        const inBoard = ndBoxAA(vec2(uM, vM), b0, b1, aa);
        const boardH = b1.y.sub(b0.y);
        const hasLogo = step(-0.5, logo.x);
        const logoSize = boardH.mul(0.9);
        const textX0 = b0.x.add(hasLogo.mul(logoSize.add(0.12))).add(0.14);
        const textX1 = b1.x.sub(0.14);
        const n = max(text.y, 1.0);
        const th = min(boardH.mul(0.62), textX1.sub(textX0).div(n.mul(0.8)));
        const cw = th.mul(0.8);
        const tStart = textX0.add(textX1).mul(0.5).sub(n.mul(cw).mul(0.5));
        const tY0 = b0.y.add(b1.y).mul(0.5).sub(th.mul(0.5));
        const run = uM.sub(tStart).div(cw);
        const idx = clamp(floor(run), 0.0, n.sub(1.0));
        const cellY = vM.sub(tY0).div(th);
        const inLine = step(0.0, run).mul(step(run, n)).mul(step(-0.1, cellY)).mul(step(cellY, 1.1));
        const dName = ndTextDistance(textTex, glyphTex, textRows, TEXT_WIDTH, text.x, idx, vec2(fract(run), cellY))
            .add(float(1.0).sub(inLine));
        const daa = fwidth(dName).mul(0.9).add(0.003);
        const core = float(1.0).sub(smoothstep(float(0.03).sub(daa), float(0.03).add(daa), dName));
        const halo = exp(dName.mul(-17.0)).mul(0.62).add(exp(dName.mul(-6.0)).mul(0.05));
        const fill = float(1.0).sub(smoothstep(float(0.055).sub(daa), float(0.055).add(daa), dName));
        const inset = min(min(uM.sub(b0.x), b1.x.sub(uM)), min(vM.sub(b0.y), b1.y.sub(vM)));
        const frameD = abs(inset.sub(0.07));
        const frameTube = float(1.0).sub(smoothstep(0.012, 0.032, frameD));
        const white = mix(tint, vec3(1.0), 0.72);
        const tubeLive = buzz.mul(hum).mul(mains);
        // Now and then the fascia switches itself back on: letter by letter, a lit box all at once.
        const spell = select(
            style.lessThan(0.5).or(style.greaterThan(1.5)),
            ndSpellOut(u.time, seed, idx, n),
            ndSpellOut(u.time, seed, float(0.0), float(1.0)),
        );
        // 0: tubes on a dark board, a tube frame in the second colour.
        const styleTubes = vec3(0.004, 0.005, 0.008).add(white.mul(core.mul(3.4)).add(tint.mul(halo.mul(1.5))).mul(tubeLive).mul(spell))
            .add(second.mul(frameTube.mul(1.6).add(exp(frameD.mul(-22.0)).mul(0.25))).mul(mains));
        // 1: a lit box, dark letters.
        const bands = sin(vM.mul(5.2)).mul(0.14).add(0.86);
        const styleBox = tint.mul(0.55).mul(bands).mul(float(1.0).sub(fill.mul(0.92))).mul(smoothstep(0.0, 0.06, inset))
            .mul(tubeLive)
            .mul(spell)
            .add(vec3(0.006));
        // 2: channel letters lit from inside, on dark metal.
        const styleLetters = vec3(0.012, 0.013, 0.016).mul(ctx.glow.add(0.3))
            .add(tint.mul(fill.mul(1.9).add(exp(dName.mul(-9.0)).mul(0.18))).mul(tubeLive).mul(spell));
        const signFace = select(style.lessThan(0.5), styleTubes, select(style.lessThan(1.5), styleBox, styleLetters)).toVar();
        if (logos) {
            const lc = vec2(uM.sub(b0.x.add(0.12)), vM.sub(b0.y.add(boardH.mul(0.05)))).div(logoSize);
            const inLogo = step(0.0, lc.x).mul(step(lc.x, 1.0)).mul(step(0.0, lc.y)).mul(step(lc.y, 1.0))
                .mul(hasLogo);
            const li = floor(max(logo.x, 0.0).add(0.5)); // rounded: read interpolated
            const lgc = vec2(mod(li, logos.grid), floor(li.div(logos.grid)));
            const lt = texture(logos.texture, lgc.add(clamp(lc, 0.01, 0.99)).div(logos.grid));
            const frames = ndLogoFrames(logo.y, logo.z, u.time, seed, u.breath);
            const dl = vec3(1.0).sub(lt.gba).mul(logos.range);
            const dr = float(1.0).sub(lt.r).mul(logos.range);
            const tube = (d) => float(1.0).sub(smoothstep(0.012, 0.022, d)).mul(3.0).add(exp(d.mul(-40.0)).mul(0.7));
            const lightL = tube(dr).add(tube(dl.x).mul(frames.x)).add(tube(dl.y).mul(frames.y)).add(tube(dl.z).mul(frames.z));
            signFace.addAssign(mix(tint, white, 0.4).mul(lightL).mul(inLogo).mul(tubeLive));
        }
        const fascia = mix(vec3(0.01, 0.011, 0.014).mul(ctx.glow.add(0.2)), signFace, inBoard)
            .add(ctx.pulse.mul(core.add(fill).add(halo.mul(0.5)).mul(1.6)))
            .mul(ctx.after.mul(0.35).add(1.0));
        const inFascia = step(fy0, vM);

        // ── Piers and the wall round the opening ──
        const tileKind = mod(seed, 3.0);
        const tileSize = mix(float(0.15), float(0.6), step(0.5, tileKind));
        const tu = fract(uM.div(tileSize));
        const tv = fract(vM.div(tileSize.mul(mix(float(1.0), float(2.2), step(1.5, tileKind)))));
        const joint = float(1.0).sub(smoothstep(0.0, 0.06, min(min(tu, float(1.0).sub(tu)), min(tv, float(1.0).sub(tv)))));
        const tileAlb = mix(vec3(0.03, 0.032, 0.04), vec3(0.045, 0.04, 0.036), ndHash21(floor(vec2(uM, vM).div(tileSize)).add(seed))).mul(float(1.0).sub(joint.mul(0.5).mul(ctx.detail)));
        const toOpen = max(max(o0.x.sub(uM), uM.sub(o1.x)), max(o0.y.sub(vM), vM.sub(o1.y)));
        const spillOut = exp(max(toOpen, 0.0).mul(-3.2)).mul(0.6);
        const sheen = pow(float(1.0).sub(ctx.ndv), 3.0).mul(u.rain).mul(0.5);
        const pier = tileAlb.mul(vec3(0.03, 0.038, 0.06).add(ctx.glow.mul(0.9)).add(ctx.sky.mul(3.0)).add(ctx.pulse.mul(3.0)))
            .add(inside.mul(spillOut).mul(0.06))
            .add(ctx.glow.mul(0.06).add(u.hazeLow.mul(0.2)).mul(sheen));

        // ── The roller shutter ──
        const openH = o1.y.sub(o0.y);
        const shutterFoot = o1.y.sub(shutter.mul(openH));
        const inShutter = step(shutterFoot, vM).mul(step(0.001, shutter));
        const ribs = sin(vM.mul(69.8)).mul(0.22).add(0.8);
        const tagN = u.noise(vec2(uM.mul(0.21).add(seed.mul(0.13)), vM.mul(0.27).add(seed.mul(0.07)))).r;
        const tagN2 = u.noise(vec2(uM.mul(0.9).add(seed.mul(0.3)), vM.mul(1.1))).g;
        // Tags within reach: a scribble of strokes over a thin wash of the same paint.
        const tag = smoothstep(0.64, 0.68, tagN).mul(step(vM, o0.y.add(2.3)));
        const scribble = smoothstep(0.1, 0.0, abs(fract(tagN2.mul(5.0)).sub(0.5)));
        const tagHue = ndHash21(floor(vec2(uM, vM).div(1.7)).add(seed));
        const paint = mix(mix(vec3(1.0, 0.2, 0.6), vec3(0.2, 0.9, 1.0), step(0.4, tagHue)), vec3(1.0, 0.85, 0.2), step(0.75, tagHue));
        const metal = vec3(0.04, 0.045, 0.052).mul(ribs);
        const sAlb = mix(metal, paint.mul(0.3), tag.mul(scribble.mul(0.75).add(0.2)).mul(ctx.detail));
        const sEdge = smoothstep(0.06, 0.0, abs(vM.sub(shutterFoot)));
        const leak = exp(max(shutterFoot.sub(vM), 0.0).mul(-9.0)).mul(step(vM, shutterFoot)).mul(open01).mul(step(0.001, shutter));
        const shutterCol = sAlb.mul(vec3(0.03, 0.038, 0.06).add(ctx.glow.mul(1.1)).add(ctx.sky.mul(3.0)).add(ctx.pulse.mul(3.0)))
            .mul(float(1.0).sub(sEdge.mul(0.6)))
            .add(ctx.glow.mul(0.05).add(u.hazeLow.mul(0.2)).mul(sheen));

        // ── The glazing at the back of the recess ──
        const glass = wetGlass(u, ctx, rec.g, seed);
        const { g } = rec;
        const openW = o1.x.sub(o0.x);
        const doorC = o0.x.add(shop.w.mul(openW));
        const headY = o0.y.add(min(2.45, openH.sub(0.25)));
        const kick = step(g.y, o0.y.add(0.32));
        const transom = step(abs(g.y.sub(headY)), 0.04);
        const doorJamb = step(abs(abs(g.x.sub(doorC)).sub(0.52)), 0.035).mul(step(g.y, headY));
        // Window mullions: the opening in equal panes, none across the door.
        const paneW = openW.div(max(floor(openW.div(1.9)), 1.0));
        const paneF = fract(g.x.sub(o0.x).div(paneW));
        const mull = step(min(paneF, float(1.0).sub(paneF)).mul(paneW), 0.03).mul(step(0.62, abs(g.x.sub(doorC))));
        const edgeD = min(min(g.x.sub(o0.x), o1.x.sub(g.x)), min(g.y.sub(o0.y), o1.y.sub(g.y)));
        const frameEdge = step(edgeD, 0.06);
        const pushBar = step(abs(g.y.sub(o0.y.add(1.05))), 0.022).mul(step(abs(g.x.sub(doorC)), 0.38));
        const frameMask = clamp(kick.add(transom).add(doorJamb).add(mull).add(frameEdge)
            .add(pushBar), 0.0, 1.0);
        const frameCol = vec3(0.03, 0.032, 0.036).mul(ctx.glow.mul(0.6).add(inside.mul(0.5)).add(0.05))
            .add(inside.mul(pushBar).mul(0.3));
        // A sign hung in the window away from the door.
        const signN = max(text.w, 1.0);
        const sth = float(0.26);
        const scw = sth.mul(0.8);
        const signC = select(shop.w.lessThan(0.5), o0.x.add(openW.mul(0.7)), o0.x.add(openW.mul(0.3)));
        const sRun = g.x.sub(signC.sub(signN.mul(scw).mul(0.5))).div(scw);
        const sY = g.y.sub(o0.y.add(1.75)).div(sth);
        const sIn = step(0.0, sRun).mul(step(sRun, signN)).mul(step(-0.1, sY)).mul(step(sY, 1.1))
            .mul(step(-0.5, text.z));
        const dSign = ndTextDistance(textTex, glyphTex, textRows, TEXT_WIDTH, max(text.z, 0.0), clamp(floor(sRun), 0.0, signN.sub(1.0)), vec2(fract(sRun), sY))
            .add(float(1.0).sub(sIn));
        const sCore = float(1.0).sub(smoothstep(0.025, 0.045, dSign));
        const sHalo = exp(dSign.mul(-14.0)).mul(0.5);
        const signRed = mix(vec3(1.0, 0.16, 0.12), second, step(0.6, ndHash11(seed.add(9.0))));
        // Some window signs blink.
        const blinker = step(0.7, ndHash11(seed.add(17.0)));
        const blink = mix(float(1.0), step(0.35, fract(u.time.mul(0.9).add(ndHash11(seed.add(18.0))))), blinker);
        const windowSign = mix(signRed, vec3(1.0), 0.6).mul(sCore.mul(2.8)).add(signRed.mul(sHalo)).mul(tubeLive)
            .mul(open01)
            .mul(blink);

        let room;
        if (rooms) {
            // The room is the costliest thing a shop draws: trace it only where it can be seen —
            // through the glass (not the fascia, piers, reveal or a shutter), and near enough for
            // its detail to show. Everything it reads is already a variable out here.
            const seen = inOpen.greaterThan(0.001).and(rec.glass.greaterThan(0.5)).and(inShutter.lessThan(0.999))
                .and(ctx.detail.greaterThan(0.01));
            const traced = vec3(0.0).toVar();
            If(seen, () => {
                traced.assign(shopInterior(u, {
                    p: g.add(glass.offset),
                    rd: ctx.rd,
                    o0,
                    o1,
                    depth: light.w,
                    arch,
                    light: light.rgb,
                    accent: tint,
                    seed,
                    lit,
                }));
            });
            // Far away the room is smaller than a pixel: its average.
            room = mix(inside.mul(0.45), traced, ctx.detail);
        } else {
            // The low tiers' room, flat on the glass: brighter toward the ceiling, a dark counter
            // or shelf line across it, a strip light along the top and dim corners.
            const by = g.y.sub(o0.y);
            const across = g.x.sub(o0.x).div(max(o1.x.sub(o0.x), 0.1));
            const corners = smoothstep(0.0, 0.18, across).mul(smoothstep(1.0, 0.82, across)).mul(0.45).add(0.55);
            const counter = step(by, 1.0).mul(0.55);
            const strip = smoothstep(0.2, 0.0, abs(by.sub(o1.y.sub(o0.y).sub(0.25))));
            room = inside.mul(smoothstep(0.0, 2.6, by).mul(0.35).add(0.25)).mul(float(1.0).sub(counter)).mul(corners)
                .add(inside.mul(strip).mul(0.9))
                .add(tint.mul(0.25).mul(step(1.8, by)).mul(step(by, 2.3)).mul(lit));
        }
        const behind = mix(room.mul(glass.transmit), frameCol, frameMask).add(glass.add.mul(float(1.0).sub(frameMask.mul(0.7))))
            .add(windowSign.mul(float(1.0).sub(frameMask)));
        const reveal = revealColor(ctx, rec, inside);
        const recessed = mix(reveal, behind, rec.glass);
        const opening = mix(recessed.add(inside.mul(leak).mul(0.5)), shutterCol, inShutter);
        const outside = mix(pier, fascia, inFascia);
        return ndAtmosphere(u, mix(outside, opening, inOpen), ctx.pW);
    })();
    return finish('NeonDistrictShops', geometry, material);
}
