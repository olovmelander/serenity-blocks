/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Greenhouse — the plants' shading: the air that moves them, the leaves cut from their
 * strips, and the light through them.
 *
 * The geometry (moonlit-greenhouse-flora-geometry.js) lays every leaf as a strip along its spine
 * and hands each pixel its place on the leaf: how far along the spine, how far out from it, how
 * long the leaflets are there. The fragment cuts the leaf out of the strip:
 *   a pinnate frond (a palm, a fern) is a comb of lanceolate leaflets swept forward along the
 *   rachis, each its own length and tilt, the old fronds missing a few; a tree fern's pinnae are
 *   combs again (bipinnate lace). Where a comb's teeth shrink under a few pixels they fatten into
 *   the solid blade they average to, so a far crown reads as fronds, never as shimmer;
 *   a banana is a paddle torn along its veins, more the older it is, its margin drying brown;
 *   a monstera is a heart with its basal lobes parted round the petiole, slit from the margin
 *   between its lateral veins and holed in a row beside the midrib; an elephant ear is a darker,
 *   sharper heart whose pale veins stand out; an ivy leaf a small heart.
 * Every leaf is lit by mgSurface like the rest of the house, with translucency: the leaves are
 * dark against the night until the moon is behind them, and then the light comes through, most
 * at their thin margins and along the veins, least through a midrib. Each leaflet is tilted its
 * own way, so a crown breaks the moon into many small lights, and the glossy leaves catch the
 * moon (and the lanterns) in a sheen.
 *
 * Cut-outs are alpha-tested with depth written; on the MSAA tiers alpha-to-coverage softens the
 * edges. Derivatives are taken once at the top of the fragment (never inside a branch: WGSL wants
 * them in uniform control flow) and the per-kind shapes are branches on the leaf's kind.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, abs, attribute, cameraPosition, clamp, dot, float, floor, fract, frontFacing, fwidth, length, max, min,
    mix, mod, normalGeometry, normalWorldGeometry, normalize, positionGeometry, positionLocal, positionWorld, pow,
    reflect, select, sin, smoothstep, sqrt, texture, vec2, vec3, vec4,
} from 'three/tsl';
import { mgHash21, mgSurface } from './moonlit-greenhouse-tsl.js';
import { KIND } from './moonlit-greenhouse-flora-geometry.js';

/** The look's numbers for the plants (the playground can read them; the theme ships these). */
export const FLORA_LOOK = {
    // Sway at rest (share of each vertex's sway weight, metres), added per unit of gust.
    sway: 0.05,
    gustSway: 0.3,
    // The T-spin's swirl: metres per unit of sway weight at full strength.
    turn: 0.42,
    // Light through the leaves: overall, extra at the margins, extra along the veins.
    translucency: 0.24,
    edgeGlow: 6.0,
    // How tightly the light through the leaves gathers toward the moon's side of the view.
    focus: 0.85,
    // The moon's sheen on glossy leaves.
    sheen: 0.6,
};

/**
 * The greenhouse air on a plant: a slow sway of the whole plant (aSway.xy) and each leaf's own
 * nod (aSway.zw), two incommensurate waves drifting down the house; a gust pushes everything down
 * the nave beat by beat; the T-spin's turn swirls it about the vertical axis through
 * (turn.z, turn.w); the leaflets tremble along their normals, more toward their tips.
 * Computed from positionGeometry (the merged meshes are laid in world space).
 */
export function floraSway(U, { flutter = true } = {}) {
    return Fn(() => {
        const p = positionGeometry;
        const S = attribute('aSway', 'vec4');
        const t = U.time;
        const gust = U.gust;
        const drift = p.z.mul(0.19).add(p.x.mul(0.11));
        const air = (ph, k) => vec3(
            sin(t.mul(0.53 * k).add(ph).add(drift)).mul(0.7).add(sin(t.mul(0.87 * k).add(ph.mul(1.9))).mul(0.3)),
            sin(t.mul(0.71 * k).add(ph.mul(1.3))).mul(0.22),
            sin(t.mul(0.46 * k).add(ph.mul(0.7)).add(drift.mul(0.7))).mul(0.6)
                .add(sin(t.mul(0.97 * k).add(ph.mul(2.3))).mul(0.3)),
        );
        const w = S.x.add(S.z);
        const amp = float(FLORA_LOOK.sway).add(gust.mul(FLORA_LOOK.gustSway));
        const disp = air(S.y, 1.0).mul(S.x).add(air(S.w, 1.45).mul(S.z)).mul(amp).toVar();
        // A gust leans the garden down the house, beat by beat.
        const beat = sin(t.mul(2.2).add(S.y).add(drift.mul(2.0))).mul(0.35).add(0.65);
        disp.addAssign(vec3(0.35, -0.12, -0.9).mul(gust.mul(beat).mul(w).mul(0.18)));
        // The turn of the air: a swirl round the canal, the leaves lifting a little with it.
        const rel = p.xz.sub(U.turn.zw);
        const r = max(length(rel), 0.5);
        const spin = U.turn.y.mul(select(U.turn.x.lessThan(0.0), float(-1.0), float(1.0))).mul(w).mul(FLORA_LOOK.turn);
        disp.addAssign(vec3(rel.y.negate().div(r).mul(spin), U.turn.y.mul(S.z).mul(0.08), rel.x.div(r).mul(spin)));
        if (flutter) {
            const leaf = attribute('aLeaf', 'vec4');
            const tremble = sin(t.mul(5.3).add(S.w.mul(3.0)).add(leaf.y.mul(4.0)));
            disp.addAssign(normalGeometry.mul(abs(leaf.x).mul(S.z).mul(tremble).mul(float(0.02).add(gust.mul(0.06)))));
        }
        return positionLocal.add(disp);
    })();
}

// ── The leaves' shapes ──────────────────────────────────────────────────────────────────────
//
// Each shape reads the pixel's place on its leaf, q (see readLeaf), and writes into the shared
// outputs o: cover (0..1, the cut-out), vein (a vein's line), rib (the midrib / rachis), edge
// (near a margin), cell (a hash of the leaflet or the lobe the pixel is on), dry (a dead margin),
// and the kind's look: albedo, veinTint, gloss, transl, veinGlow.

const step01 = (edge, x) => smoothstep(edge.sub(1e-4), edge.add(1e-4), x);

/** A pinnate frond (palm: Kentia leaflets; ferns: small oblong pinnae). */
function pinnate(q, o, P) {
    const blade = smoothstep(q.stalk, q.stalk.add(0.03), q.s);
    const t = q.c.div(max(q.wEnv, 1e-3));
    const ph = q.along.sub(q.c.mul(P.sweep)).div(P.spacing);
    const dPh = q.dA.add(q.dC.mul(P.sweep)).div(P.spacing);
    const i = floor(ph.add(0.5));
    const f = ph.sub(i);
    const h = mgHash21(vec2(i.add(q.side.mul(331.0)), q.key));
    const h2 = fract(h.mul(17.31));
    const reach = mix(float(P.reach0), float(1.0), h);
    const x = clamp(t.div(reach), 0.0, 1.0);
    // Lanceolate: narrow where it leaves the rachis, widest a third out, an acute tip.
    const prof = sqrt(x).mul(float(1.0).sub(x)).mul(2.6);
    const hw = prof.mul(P.width);
    const solid = smoothstep(0.22, 0.55, dPh);
    const hwEff = mix(hw, sqrt(max(float(1.0).sub(x.mul(x)), 0.0)).mul(0.62), solid);
    const aa = dPh.mul(0.75).add(1e-4);
    const lost = step01(h2, q.age.mul(P.loss));
    const leaflet = float(1.0).sub(smoothstep(hwEff.sub(aa), hwEff.add(aa), abs(f))).mul(blade).mul(float(1.0).sub(lost))
        .mul(float(1.0).sub(step01(float(0.999), t.div(reach))));
    const rw = mix(float(P.rachis), float(P.rachis * 0.35), q.s);
    const aaC = q.dC.mul(0.75).add(1e-4);
    const rachis = float(1.0).sub(smoothstep(rw.sub(aaC), rw.add(aaC), q.c));
    const rel = abs(f).div(max(hwEff, 1e-3));
    return {
        leaflet, rachis, rel, h, x, f, dPh, solid,
        vein: float(1.0).sub(smoothstep(0.06, 0.2, rel)).mul(float(1.0).sub(solid)).mul(leaflet),
        edge: smoothstep(0.55, 1.0, rel).mul(leaflet),
    };
}

/** A tree fern's pinna cut again into pinnules. */
function pinnules(q, base, P) {
    const across = base.f.mul(P.spacing);
    const ph2 = q.c.sub(abs(across).mul(0.8)).div(P.spacing2);
    const dPh2 = q.dC.add(q.dA.mul(0.8)).div(P.spacing2);
    const i2 = floor(ph2.add(0.5));
    const f2 = ph2.sub(i2);
    const y2 = clamp(base.rel, 0.0, 1.0);
    const w2 = float(1.0).sub(y2.mul(y2)).mul(0.44).add(0.04);
    const aa2 = dPh2.mul(0.75).add(1e-4);
    const cut = float(1.0).sub(smoothstep(w2.sub(aa2), w2.add(aa2), abs(f2)));
    const keep = max(cut, float(1.0).sub(smoothstep(0.12, 0.2, y2))); // the pinna's midrib
    return mix(keep, float(1.0), smoothstep(0.25, 0.55, dPh2));
}

/** A banana or bird-of-paradise paddle: midrib, parallel veins, torn along them. */
function paddle(q, o) {
    const blade = step01(q.stalk, q.s);
    const t = clamp(q.c.div(max(q.wGeom, 1e-3)), 0.0, 1.0);
    const b = clamp(q.s.sub(q.stalk).div(max(float(1.0).sub(q.stalk), 1e-3)), 0.0, 1.0);
    const aaC = q.dC.mul(0.75).add(1e-4);
    const rw = mix(float(0.02), float(0.008), b);
    const core = float(1.0).sub(smoothstep(rw.sub(aaC), rw.add(aaC), q.c));
    // The lateral veins run out from the midrib, a little forward; the tears follow them.
    const every = 0.065;
    const psi = q.along.add(q.c.mul(0.28));
    const dPsi = q.dA.add(q.dC.mul(0.28));
    const slot = psi.div(every);
    const k = floor(slot);
    const h = mgHash21(vec2(k.add(q.side.mul(517.0)), q.key));
    const h2 = fract(h.mul(23.17));
    const h3 = fract(h.mul(71.3));
    const chance = mix(float(0.12), float(0.62), q.age).mul(select(q.kind.greaterThan(KIND.strelitzia - 0.5), float(0.25), float(1.0)));
    const torn = float(1.0).sub(step01(chance, h));
    const depth = mix(float(0.25), float(1.0), h2.mul(h2));
    const into = smoothstep(float(1.0).sub(depth), float(1.0).sub(depth).add(0.05), t);
    const centre = h3.sub(0.5).mul(0.5).add(0.5);
    const dist = abs(fract(slot).sub(centre)).mul(every);
    const gap = mix(float(0.0012), float(0.006), smoothstep(float(1.0).sub(depth), float(1.0), t));
    const cut = torn.mul(into).mul(float(1.0).sub(smoothstep(gap.sub(dPsi.mul(0.5)), gap.add(dPsi.mul(0.5)), dist)));
    o.cover.assign(max(blade.mul(float(1.0).sub(cut)), core));
    const striation = abs(fract(psi.div(0.011)).sub(0.5)).mul(2.0);
    o.vein.assign(smoothstep(0.55, 0.95, striation).mul(float(1.0).sub(smoothstep(0.25, 0.7, dPsi.div(0.011)))).mul(0.6));
    o.rib.assign(core);
    const tearEdge = torn.mul(into).mul(float(1.0).sub(smoothstep(gap, gap.add(0.012), dist)));
    o.edge.assign(max(smoothstep(0.86, 1.0, t), tearEdge));
    o.cell.assign(h);
    o.dry.assign(smoothstep(0.7, 1.0, t.add(q.mottle.sub(0.5).mul(0.35))).mul(q.age.mul(q.age)).add(tearEdge.mul(q.age).mul(0.5)));
}

/**
 * A heart: basal lobes parted round the petiole (the sinus), widest a third up, an acute tip.
 * `holes` slits a monstera from the margin between its lateral veins and holes it by the midrib.
 */
function heart(q, o, P) {
    const y = q.s.sub(q.stalk).div(max(float(1.0).sub(q.stalk), 1e-3));
    const x = q.c.div(max(q.wEnv, 1e-3));
    const aaX = q.dC.div(max(q.wEnv, 1e-3)).mul(0.75).add(1e-4);
    const tt = clamp(y.add(P.lobe).div(P.lobe.add(1.0)), 1e-4, 1.0);
    const w = sin(pow(tt, 0.62).mul(Math.PI));
    const inside = float(1.0).sub(smoothstep(w.sub(aaX), w.add(aaX), x));
    const notchEdge = max(P.notch.sub(y), 0.0).mul(P.notchSlope);
    const notched = smoothstep(notchEdge.sub(aaX), notchEdge.add(aaX), x).mul(step01(P.lobe.negate(), y));
    const aaC = q.dC.mul(0.75).add(1e-4);
    const pw = P.petiole;
    const petiole = float(1.0).sub(smoothstep(pw.sub(aaC), pw.add(aaC), q.c)).mul(float(1.0).sub(step01(float(0.04), y)));
    // Lateral veins sweep toward the tip as they run out to the margin.
    const phi = y.sub(x.mul(0.3)).sub(x.mul(x).mul(0.12)).mul(P.veins);
    const vk = floor(phi);
    const vf = fract(phi);
    const dPhi = q.dA.div(max(q.L, 1e-3)).add(aaX).mul(P.veins);
    const vLine = float(1.0).sub(smoothstep(0.0, dPhi.add(0.05), abs(vf.sub(0.5)).mul(2.0).oneMinus()));
    const h = mgHash21(vec2(vk.add(q.side.mul(193.0)), q.key));
    let cut = float(0.0);
    if (P.holes) {
        // Slits from the margin inward, between two veins; a mature leaf has more and deeper.
        const h2 = fract(h.mul(19.7));
        const slit = float(1.0).sub(step01(P.fenestrate, h)).mul(step01(float(0.08), y)).mul(float(1.0).sub(step01(float(0.9), y)));
        const from = w.mul(float(1.0).sub(mix(float(0.3), float(0.72), h2)));
        const sw = smoothstep(from, from.add(0.12), x).mul(0.13);
        const slitCut = slit.mul(float(1.0).sub(smoothstep(sw.sub(dPhi), sw.add(dPhi), abs(vf.sub(0.5)))));
        // Holes in a row beside the midrib.
        const h3 = fract(h.mul(53.1));
        const hole = float(1.0).sub(step01(P.fenestrate.mul(0.8), h3)).mul(step01(float(0.12), y)).mul(float(1.0).sub(step01(float(0.82), y)));
        const d = length(vec2(x.sub(w.mul(0.32)).div(0.085), vf.sub(0.5).div(0.2)));
        const holeCut = hole.mul(float(1.0).sub(smoothstep(float(1.0).sub(dPhi.mul(4.0)), float(1.0).add(dPhi.mul(4.0)), d)));
        cut = max(slitCut, holeCut);
        o.edge.assign(max(slit.mul(float(1.0).sub(smoothstep(sw, sw.add(0.06), abs(vf.sub(0.5))))), hole.mul(smoothstep(1.6, 1.0, d))));
    }
    const leafCover = inside.mul(notched).mul(float(1.0).sub(cut));
    o.cover.assign(max(leafCover, petiole));
    const rw = float(0.006).add(float(0.012).mul(float(1.0).sub(clamp(y, 0.0, 1.0)))).mul(P.ribScale);
    o.rib.assign(float(1.0).sub(smoothstep(rw.sub(aaC), rw.add(aaC), q.c)).mul(step01(float(-0.02), y)).max(petiole));
    o.vein.assign(vLine.mul(leafCover));
    o.edge.assign(max(o.edge, smoothstep(0.82, 1.0, x.div(max(w, 1e-3))).mul(leafCover)));
    o.cell.assign(h);
}

/**
 * Read the pixel's place on its leaf. Everything here is computed before any branch (the
 * derivatives and the noise's implicit mip need uniform control flow) and pinned with toVar.
 */
function readLeaf(noise) {
    const leaf = attribute('aLeaf', 'vec4');
    const info = attribute('aInfo', 'vec4');
    const u = clamp(leaf.x, -1.0, 1.0).toVar();
    const along = max(leaf.y, 0.0).toVar();
    const wGeom = leaf.z.toVar();
    const wEnv = leaf.w.toVar();
    const L = max(info.x, 1e-3).toVar();
    const id = floor(info.y.add(0.5)).toVar();
    const age = clamp(info.z, 0.0, 1.0).toVar();
    const kind = floor(info.w.add(0.05)).toVar();
    const stalk = clamp(info.w.sub(kind).div(0.9), 0.0, 1.0).toVar();
    const plant = floor(id.div(64.0).add(0.01)).toVar();
    const leafK = id.sub(plant.mul(64.0)).toVar();
    const c = abs(u).mul(wGeom).toVar();
    const q = {
        u,
        side: select(u.lessThan(0.0), float(-1.0), float(1.0)).toVar(),
        along,
        wGeom,
        wEnv,
        L,
        s: clamp(along.div(L), 0.0, 1.0).toVar(),
        c,
        id,
        plant,
        leafK,
        key: mod(plant, 211.0).mul(13.0).add(leafK).toVar(),
        age,
        kind,
        stalk,
        dA: fwidth(along).toVar(),
        dC: fwidth(c).toVar(),
    };
    q.mottle = texture(noise, vec2(along.mul(0.55).add(plant.mul(0.137)), c.mul(0.9).add(leafK.mul(0.071)))).x.toVar();
    return q;
}

/** The kinds' looks (linear albedo, the vein's tint, gloss, translucency, how veins pass light). */
const LOOKS = {
    palm: {
        albedo: [0.045, 0.075, 0.032], veinTint: [0.085, 0.11, 0.05], gloss: 0.35, transl: 0.8, veinGlow: 0.35,
    },
    treeFern: {
        albedo: [0.04, 0.085, 0.028], veinTint: [0.06, 0.1, 0.04], gloss: 0.12, transl: 1.0, veinGlow: 0.2,
    },
    fern: {
        albedo: [0.042, 0.082, 0.03], veinTint: [0.07, 0.1, 0.045], gloss: 0.15, transl: 0.9, veinGlow: 0.2,
    },
    banana: {
        albedo: [0.05, 0.095, 0.03], veinTint: [0.12, 0.14, 0.07], gloss: 0.5, transl: 0.85, veinGlow: 0.3,
    },
    strelitzia: {
        albedo: [0.035, 0.07, 0.05], veinTint: [0.1, 0.12, 0.09], gloss: 0.55, transl: 0.6, veinGlow: 0.2,
    },
    monstera: {
        albedo: [0.025, 0.06, 0.025], veinTint: [0.05, 0.09, 0.04], gloss: 0.7, transl: 0.7, veinGlow: 0.35,
    },
    philodendron: {
        albedo: [0.028, 0.055, 0.03], veinTint: [0.055, 0.085, 0.045], gloss: 0.8, transl: 0.6, veinGlow: 0.3,
    },
    alocasia: {
        albedo: [0.018, 0.035, 0.026], veinTint: [0.26, 0.32, 0.27], gloss: 0.75, transl: 0.55, veinGlow: 1.6,
    },
    ivy: {
        albedo: [0.03, 0.06, 0.028], veinTint: [0.07, 0.1, 0.05], gloss: 0.5, transl: 0.8, veinGlow: 0.5,
    },
    strand: {
        albedo: [0.05, 0.045, 0.03], veinTint: [0.05, 0.045, 0.03], gloss: 0.1, transl: 0.3, veinGlow: 0,
    },
    crosier: {
        albedo: [0.07, 0.048, 0.024], veinTint: [0.07, 0.048, 0.024], gloss: 0.05, transl: 0.3, veinGlow: 0,
    },
};

function assignLook(o, look) {
    o.albedo.assign(vec3(...look.albedo));
    o.veinTint.assign(vec3(...look.veinTint));
    o.gloss.assign(look.gloss);
    o.transl.assign(look.transl);
    o.veinGlow.assign(look.veinGlow);
}

/** The shapes a material can hold, each with the kinds it serves. */
const SHAPES = {
    palm: {
        kinds: [KIND.palm],
        run(q, o) {
            const r = pinnate(q, o, {
                spacing: 0.072, sweep: 0.95, width: 0.36, reach0: 0.78, rachis: 0.016, loss: 0.22,
            });
            o.cover.assign(max(r.leaflet, r.rachis));
            o.vein.assign(r.vein);
            o.rib.assign(r.rachis);
            o.edge.assign(r.edge);
            o.cell.assign(r.h);
            // The oldest fronds yellow and brown from their leaflets' tips.
            o.dry.assign(smoothstep(0.55, 1.0, r.x.add(q.mottle.sub(0.5).mul(0.5))).mul(q.age.mul(q.age)).mul(r.leaflet));
            assignLook(o, LOOKS.palm);
        },
    },
    treeFern: {
        kinds: [KIND.treeFern],
        run(q, o) {
            const P = {
                spacing: 0.11, sweep: 0.42, width: 0.46, reach0: 0.85, rachis: 0.012, loss: 0.08, spacing2: 0.022,
            };
            const r = pinnate(q, o, P);
            const lace = pinnules(q, r, P);
            o.cover.assign(max(r.leaflet.mul(lace), r.rachis));
            o.vein.assign(float(1.0).sub(smoothstep(0.08, 0.18, r.rel)).mul(r.leaflet).mul(float(1.0).sub(r.solid)));
            o.rib.assign(r.rachis);
            o.edge.assign(r.edge.mul(0.6));
            o.cell.assign(r.h);
            o.dry.assign(q.age.mul(q.age).mul(0.25).mul(smoothstep(0.6, 1.0, r.x)));
            assignLook(o, LOOKS.treeFern);
        },
    },
    fern: {
        kinds: [KIND.groundFern, KIND.swordFern],
        run(q, o) {
            const r = pinnate(q, o, {
                spacing: 0.024, sweep: 0.35, width: 0.4, reach0: 0.8, rachis: 0.004, loss: 0.1,
            });
            o.cover.assign(max(r.leaflet, r.rachis));
            o.vein.assign(r.vein.mul(0.5));
            o.rib.assign(r.rachis);
            o.edge.assign(r.edge);
            o.cell.assign(r.h);
            o.dry.assign(q.age.mul(q.age).mul(0.3).mul(smoothstep(0.7, 1.0, r.x)));
            assignLook(o, LOOKS.fern);
        },
    },
    paddle: {
        kinds: [KIND.banana, KIND.strelitzia],
        run(q, o) {
            paddle(q, o);
            If(q.kind.lessThan(KIND.strelitzia - 0.5), () => assignLook(o, LOOKS.banana))
                .Else(() => assignLook(o, LOOKS.strelitzia));
        },
    },
    heart: {
        kinds: [KIND.monstera, KIND.philodendron, KIND.alocasia, KIND.ivy],
        run(q, o) {
            const isMonstera = q.kind.lessThan(KIND.monstera + 0.5);
            const isAlocasia = q.kind.greaterThan(KIND.alocasia - 0.5).and(q.kind.lessThan(KIND.alocasia + 0.5));
            const isIvy = q.kind.greaterThan(KIND.ivy - 0.5);
            // A mature monstera (the larger, older leaves) is the most cut.
            const maturity = clamp(q.wEnv.sub(0.12).div(0.16), 0.0, 1.0);
            heart(q, o, {
                lobe: select(isAlocasia, float(0.26), select(isIvy, float(0.12), float(0.14))),
                notch: select(isAlocasia, float(0.06), float(0.03)),
                notchSlope: select(isAlocasia, float(2.6), float(1.4)),
                petiole: select(isIvy, float(0.0025), float(0.011)),
                veins: select(isAlocasia, float(6.0), select(isIvy, float(4.0), float(7.0))),
                ribScale: select(isIvy, float(0.35), select(isAlocasia, float(1.3), float(1.0))),
                holes: true,
                fenestrate: select(isMonstera, maturity.mul(0.75).add(0.1), float(0.0)),
            });
            If(isMonstera, () => assignLook(o, LOOKS.monstera))
                .ElseIf(q.kind.lessThan(KIND.philodendron + 0.5), () => assignLook(o, LOOKS.philodendron))
                .ElseIf(isAlocasia, () => assignLook(o, LOOKS.alocasia))
                .Else(() => assignLook(o, LOOKS.ivy));
        },
    },
    solid: {
        kinds: [KIND.strand, KIND.crosier],
        run(q, o) {
            o.cover.assign(1.0);
            o.vein.assign(0.0);
            o.rib.assign(1.0);
            o.edge.assign(0.0);
            o.cell.assign(0.5);
            o.dry.assign(0.0);
            If(q.kind.lessThan(KIND.strand + 0.5), () => assignLook(o, LOOKS.strand))
                .Else(() => assignLook(o, LOOKS.crosier));
        },
    },
};

/**
 * A leaf material for the shapes named (each a key of SHAPES). `canopy` false leaves out the
 * palm crowns' shadow (the crowns themselves). `coverage` turns on alpha-to-coverage (MSAA tiers).
 */
export function createLeafMaterial({
    U, noise, name, shapes, canopy = true, coverage = false,
}) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
    material.name = name;
    material.positionNode = floraSway(U);
    material.alphaTest = 0.5;
    material.alphaToCoverage = coverage;
    const list = shapes.map((key) => SHAPES[key]);
    const { night } = U;

    material.colorNode = Fn(() => {
        const p = positionWorld.toVar();
        const q = readLeaf(noise);
        const foot = max(fwidth(p.x), max(fwidth(p.y), fwidth(p.z))).toVar();
        const nGeo = normalize(normalWorldGeometry).toVar();
        const facing = frontFacing.toVar();
        const o = {
            cover: float(0.0).toVar(),
            vein: float(0.0).toVar(),
            rib: float(0.0).toVar(),
            edge: float(0.0).toVar(),
            cell: float(0.5).toVar(),
            dry: float(0.0).toVar(),
            albedo: vec3(0.04, 0.07, 0.03).toVar(),
            veinTint: vec3(0.07, 0.1, 0.05).toVar(),
            gloss: float(0.3).toVar(),
            transl: float(0.8).toVar(),
            veinGlow: float(0.3).toVar(),
        };
        // Cut the leaf: one branch per shape this material holds.
        if (list.length === 1) {
            list[0].run(q, o);
        } else {
            const test = (shape) => {
                const lo = Math.min(...shape.kinds) - 0.5;
                const hi = Math.max(...shape.kinds) + 0.5;
                return q.kind.greaterThan(lo).and(q.kind.lessThan(hi));
            };
            let chain = If(test(list[0]), () => list[0].run(q, o));
            for (let i = 1; i < list.length - 1; i += 1) chain = chain.ElseIf(test(list[i]), () => list[i].run(q, o));
            chain.Else(() => list[list.length - 1].run(q, o));
        }
        // ── The leaf's colour: its kind, the plant's own tone, each leaflet a little different,
        // the old yellowing, the veins and midrib paler, a mottle through it all.
        const tone = mgHash21(vec2(q.plant.mul(0.731), 3.7));
        const hueShift = vec3(tone.sub(0.5).mul(0.25).add(1.0), 1.0, float(0.5).sub(tone).mul(0.3).add(1.0));
        const yellowed = vec3(0.1, 0.085, 0.035);
        const dead = vec3(0.075, 0.05, 0.026);
        let albedo = o.albedo.mul(hueShift).mul(o.cell.mul(0.4).add(0.8));
        albedo = mix(albedo, yellowed, q.age.mul(q.age).mul(0.35));
        albedo = mix(albedo, o.veinTint, clamp(o.vein.mul(0.6).add(o.rib.mul(0.75)), 0.0, 1.0));
        albedo = mix(albedo, dead, clamp(o.dry, 0.0, 1.0));
        albedo = albedo.mul(q.mottle.mul(0.4).add(0.8));
        // The underside is paler and duller.
        albedo = select(facing, albedo, albedo.mul(vec3(1.15, 1.2, 1.1)));
        // ── The normal: the strip's, turned toward the eye's side, each leaflet tilted its own way.
        const nFace = select(facing, nGeo, nGeo.negate());
        const jitter = vec3(o.cell.sub(0.5), fract(o.cell.mul(7.31)).sub(0.5), fract(o.cell.mul(13.7)).sub(0.5)).mul(0.7);
        const n = normalize(nFace.add(jitter)).toVar();
        const v = normalize(p.sub(cameraPosition)).toVar();
        // ── The moon's sheen on a glossy leaf (and the lanterns', through the same albedo).
        const r = clamp(dot(reflect(v, n), U.moon), 0.0, 1.0);
        const r2 = r.mul(r);
        const r4 = r2.mul(r2);
        const r16 = r4.mul(r4).mul(r4.mul(r4));
        const gloss = o.gloss.mul(select(facing, float(1.0), float(0.35)));
        albedo = albedo.add(vec3(0.45, 0.5, 0.55).mul(r16.mul(gloss).mul(FLORA_LOOK.sheen)));
        // ── Light through the leaf: most at the margins and along the veins, least through a rib.
        const grazing = float(1.0).sub(abs(dot(n, v)));
        const g3 = grazing.mul(grazing).mul(grazing);
        const toward = clamp(dot(v, U.moon), 0.0, 1.0);
        const focus = toward.mul(toward).mul(toward).mul(FLORA_LOOK.focus).add(1.0 - FLORA_LOOK.focus);
        const transl = o.transl.mul(FLORA_LOOK.translucency).mul(focus)
            .mul(o.edge.mul(FLORA_LOOK.edgeGlow).add(1.0))
            .mul(float(1.0).sub(o.rib.mul(0.45)))
            .mul(o.vein.mul(o.veinGlow).add(1.0))
            .mul(g3.mul(0.8).add(1.0))
            .mul(q.mottle.mul(0.5).add(0.75))
            .mul(float(1.0).sub(o.dry.mul(0.6)));
        const lit = mgSurface(p, n, albedo, U, {
            translucency: transl, soft: foot, canopy, view: v,
        });
        // A little of the night's leaf-light caught along the margins even out of the moon.
        const rim = night.leafLit.mul(o.edge.mul(g3).mul(0.004));
        return vec4(lit.add(rim), clamp(o.cover, 0.0, 1.0));
    })();
    return material;
}

/**
 * The trunks and stems: a Kentia's ringed grey trunk (leaf scars every hand's breadth, a shelf
 * the moon catches on each, greener near the crown); a tree fern's dark fibrous column, rusty
 * with hairs at the crown; a banana's green pseudostem streaked brown. Opaque, lit by mgSurface.
 */
export function createTrunkMaterial({ U, noise, name, canopy = true }) {
    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = name;
    material.positionNode = floraSway(U, { flutter: false });
    material.colorNode = Fn(() => {
        const p = positionWorld.toVar();
        const leaf = attribute('aLeaf', 'vec4');
        const info = attribute('aInfo', 'vec4');
        const around = leaf.x;
        const along = leaf.y;
        const sigma = clamp(leaf.w, 0.0, 1.0);
        const id = floor(info.y.add(0.5));
        const kind = floor(info.w.add(0.05));
        const plant = mod(floor(id.div(64.0).add(0.01)), 97.0);
        const foot = max(fwidth(p.x), max(fwidth(p.y), fwidth(p.z)));
        const n0 = normalize(normalWorldGeometry);
        const grain = texture(noise, vec2(around.mul(2.0).add(plant.mul(0.137)), along.mul(0.3)));
        const fibre = texture(noise, vec2(around.mul(5.0).add(plant.mul(0.31)), along.mul(0.09))).w;
        // Palm: the leaf scars' rings, each a little shelf.
        const ringPh = along.div(0.105).add(grain.x.mul(0.9));
        const dRing = fwidth(ringPh);
        const rf = fract(ringPh);
        const resolved = float(1.0).sub(smoothstep(0.3, 0.8, dRing));
        const groove = float(1.0).sub(smoothstep(0.0, dRing.add(0.1), min(rf, float(1.0).sub(rf)))).mul(resolved);
        const shelf = rf.sub(0.5).mul(resolved);
        const isPalm = kind.lessThan(KIND.palmTrunk + 0.5);
        const isFern = kind.greaterThan(KIND.fernTrunk - 0.5).and(kind.lessThan(KIND.fernTrunk + 0.5));
        const palmAlbedo = mix(vec3(0.085, 0.079, 0.066), vec3(0.05, 0.068, 0.04), smoothstep(0.86, 1.0, sigma))
            .mul(grain.z.mul(0.5).add(0.75)).mul(float(1.0).sub(groove.mul(0.55)))
            .mul(mix(float(0.55), float(1.0), smoothstep(0.0, 0.05, sigma)));
        const fernAlbedo = mix(vec3(0.03, 0.021, 0.015), vec3(0.085, 0.048, 0.022), smoothstep(0.8, 0.97, sigma))
            .mul(fibre.mul(0.9).add(0.55));
        const stemAlbedo = mix(vec3(0.055, 0.08, 0.038), vec3(0.07, 0.055, 0.035), smoothstep(0.55, 0.8, fibre))
            .mul(grain.x.mul(0.4).add(0.8));
        const albedo = select(isPalm, palmAlbedo, select(isFern, fernAlbedo, stemAlbedo));
        // The rings tilt the surface up or down; the fern's fibres roughen it.
        const bump = select(isPalm, shelf.mul(0.55), select(isFern, fibre.sub(0.5).mul(0.6), float(0.0)));
        const n = normalize(n0.add(vec3(0.0, bump, 0.0)));
        const lit = mgSurface(p, n, albedo, U, { soft: foot, canopy, ao: mix(float(0.6), float(1.0), sigma) });
        return vec4(lit, 1.0);
    })();
    return material;
}

/**
 * The hanging baskets' iron and moss: the wire bowl (meridians and hoops, alpha-tested), the
 * chains (links face-on and edge-on in turn), and the moss lining behind the wire.
 */
export function createBasketMaterial({ U, noise, name, coverage = false }) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
    material.name = name;
    material.positionNode = floraSway(U, { flutter: false });
    material.alphaTest = 0.5;
    material.alphaToCoverage = coverage;
    material.colorNode = Fn(() => {
        const p = positionWorld.toVar();
        const leaf = attribute('aLeaf', 'vec4');
        const info = attribute('aInfo', 'vec4');
        const kind = floor(info.w.add(0.05)).toVar();
        const foot = max(fwidth(p.x), max(fwidth(p.y), fwidth(p.z))).toVar();
        const nGeo = normalize(normalWorldGeometry);
        const n = select(frontFacing, nGeo, nGeo.negate()).toVar();
        // Wire: 14 meridians and 6 hoops.
        const mer = leaf.x.mul(14.0);
        const hoop = leaf.y.mul(6.0);
        const dm = fwidth(mer).toVar();
        const dh = fwidth(hoop).toVar();
        const lineM = float(1.0).sub(smoothstep(float(0.06).sub(dm), float(0.06).add(dm), abs(fract(mer.add(0.5)).sub(0.5))));
        const lineH = float(1.0).sub(smoothstep(float(0.08).sub(dh), float(0.08).add(dh), abs(fract(hoop.add(0.5)).sub(0.5))));
        const rimBand = float(1.0).sub(step01(float(0.06), leaf.y));
        const wire = max(max(lineM, lineH), rimBand);
        // Chain: links along, each an oval ring; far away a plain line.
        const ph = leaf.y.div(0.032);
        const dph = fwidth(ph).toVar();
        const across = abs(leaf.x).toVar();
        const lf = fract(ph).sub(0.5).mul(2.0);
        const ring = abs(length(vec2(lf, across.mul(1.2))).sub(0.72));
        const link = float(1.0).sub(smoothstep(float(0.28).sub(dph), float(0.28).add(dph), ring));
        const chain = mix(link, float(1.0).sub(smoothstep(0.55, 0.75, across)), smoothstep(0.3, 0.7, dph));
        const moss = texture(noise, vec2(leaf.x.mul(3.0), leaf.y.mul(1.5))).x.toVar();
        const isWire = kind.lessThan(KIND.wire + 0.5);
        const isChain = kind.greaterThan(KIND.chain - 0.5).and(kind.lessThan(KIND.chain + 0.5));
        const cover = select(isWire, wire, select(isChain, chain, float(1.0)));
        const iron = vec3(0.03, 0.03, 0.033);
        const mossAlbedo = vec3(0.03, 0.05, 0.022).mul(moss.mul(0.8).add(0.6));
        const albedo = select(isWire.or(isChain), iron, mossAlbedo);
        const lit = mgSurface(p, n, albedo, U, { soft: foot, translucency: 0 });
        // Iron catches a cold line of the moon where it turns toward it.
        const v = normalize(p.sub(cameraPosition));
        const glint = clamp(dot(reflect(v, n), U.moon), 0.0, 1.0);
        const g2 = glint.mul(glint);
        const shine = U.night.moonlight.mul(g2.mul(g2).mul(0.02)).mul(select(isWire.or(isChain), float(1.0), float(0.0)));
        return vec4(lit.add(shine), clamp(cover, 0.0, 1.0));
    })();
    return material;
}
