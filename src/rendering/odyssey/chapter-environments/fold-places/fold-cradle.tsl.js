/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE CRADLE — the fold's second place (orb 50: Nebula Flow, the star cradle).
 *
 * Towering pillars of dark dust rise out of the depths against a glowing nebula, their edges lit
 * by the light behind them, young stars burning at some of their tips; nearer pillars stand
 * huge and black, farther ones sink into the nebula's rose and gold. A place where stars are made.
 *
 * Walked plane by plane, nearest first, as the paint is: on each plane across the way ahead a
 * row of pillars (each a column narrowing to a rounded tip, its edges eaten by a slow field), dust
 * hiding what is behind it, so the walk carries how much still shows through and stops when
 * nothing does. Behind them all, the nebula, from the ray's direction.
 */
import {
    Break, If, Loop, abs, clamp, dot, exp, float, floor, int, max, min, mix, normalize, sign, sin, smoothstep, sqrt,
    step, vec2, vec3,
} from 'three/tsl';
import { hash21 } from '../shared/odyssey-tsl-noise.js';
import {
    N, frameRows, glowAt, sq, stroke, turn,
} from './fold-tools.tsl.js';

export const CRADLE = Object.freeze({
    frame: [-10, 13, 3],
    /** The planes' spacing along the way, the pillars' spacing on a plane (world units). */
    layer: 3.4,
    apart: 10.5,
    /** A pillar's half-width at its foot (world units, before its own scale). */
    width: 1.35,
    /** How far below its tip a pillar reaches its full width. */
    taper: 4.5,
    /** Nearer than this a pillar is not drawn (it would fill the frame). */
    near: 3.6,
    /** The nebula's haze the farther pillars sink into (per unit). */
    haze: 0.028,
    /** Where the light behind the pillars comes from (the room's frame). */
    light: [0.42, 0.55, 0.72],
});

const ROWS = frameRows(CRADLE.frame);

export function placeCradle({
    rd, tm, zEye, pix, mood, event, eventAge, steps, flash,
}) {
    const V = CRADLE;
    const r = turn(rd, ROWS).toVar();
    const fz = max(r.z, 0.08).toVar();
    const slope = r.xy.div(fz).toVar();
    const along = float(1).div(fz).toVar();
    const base = floor(zEye.div(V.layer)).toVar();
    const off = zEye.div(V.layer).sub(base).toVar();
    const acc = vec3(0).toVar();
    const through = float(1).toVar();
    const layers = Math.max(6, Math.round(steps * 0.42));
    // The light behind the pillars swings slowly with the mood.
    const lightLen = Math.hypot(...V.light);
    const lightDir = normalize(vec3(V.light[0] / lightLen, V.light[1] / lightLen, V.light[2] / lightLen)
        .add(vec3(mood.y.sub(0.5).mul(0.4), 0, 0))).toVar();
    const toLight = clamp(dot(r, lightDir), 0.0, 1.0).toVar();
    // The nebula's own colours: rose to gold, teal in its folds; the mood leans it.
    const rose = mix(vec3(0.95, 0.30, 0.42), vec3(0.85, 0.24, 0.62), mood.x).toVar();
    const gold = vec3(1.0, 0.66, 0.32);
    const teal = vec3(0.10, 0.52, 0.62);
    // A star igniting at the tips: the happening's swell (local light; still through flashScale).
    const ignite = sin(clamp(eventAge.div(15.0), 0.0, 1.0).mul(Math.PI)).mul(event).mul(flash).toVar();
    Loop({
        start: int(0), end: int(layers), type: 'int', condition: '<', name: 'cradleLayer',
    }, ({ cradleLayer }) => {
        const zk = float(cradleLayer).add(1).sub(off).mul(V.layer)
            .toVar();
        const layerId = base.add(float(cradleLayer)).add(1).toVar();
        const lh = hash21(vec2(layerId, 2.7)).toVar();
        const hit = slope.mul(zk).toVar();
        const colAt = hit.x.div(V.apart).add(lh.mul(7.0)).toVar();
        const col = floor(colAt).toVar();
        const ch = hash21(vec2(col.add(40.0), layerId.add(11.0))).toVar();
        const ch2 = hash21(vec2(layerId.add(5.0), col.add(23.0))).toVar();
        // Some places in a row stand empty: the nebula shines through between the pillars.
        const stands = step(0.56, ch).toVar();
        const xl = colAt.sub(col).sub(0.5).sub(ch2.sub(0.5).mul(0.35)).mul(V.apart)
            .toVar();
        // Its tip, at a height that keeps its place in the frame whatever the plane's depth.
        // (Mostly low, a few towering: the hash squared.)
        const top = zk.mul(sq(ch2).mul(0.62).sub(0.36)).toVar();
        const scale = ch.sub(0.56).mul(3.4).add(0.55);
        const below = max(top.sub(hit.y), 0.0).toVar();
        const taper = sqrt(min(below.div(V.taper), 1.0));
        // Dust eats the edges, more so toward the tip.
        const erode = N(vec3(xl.mul(0.55).add(col.mul(3.7)), hit.y.mul(0.45), layerId.mul(1.9).add(tm.mul(0.015))))
            .sub(0.5).toVar();
        // Great lumps and shoulders down its length, and a lean.
        const lump = N(vec3(col.mul(5.3).add(layerId), hit.y.mul(0.16), 3.3)).sub(0.5);
        const lean = hit.y.sub(top).mul(ch2.sub(0.5).mul(0.35));
        // (The dust's bite fades with the width toward the tip, so the tip is round, not cut.)
        const hw = taper.mul(V.width).mul(scale.mul(lump.mul(1.1).add(1.0)).add(erode.mul(0.9))).toVar();
        xl.subAssign(lean);
        const d = abs(xl).sub(hw).toVar();
        const t = zk.mul(along).toVar();
        const aa = t.mul(pix).mul(1.6).add(0.01).toVar();
        const nearFade = smoothstep(V.near, V.near + 3.0, zk);
        // (No sliver where the pillar has narrowed to nothing: a width under a pixel shows nothing.)
        const cover = stroke(d, 0.0, aa).mul(smoothstep(0.0, aa, hw)).mul(stands).mul(nearFade)
            .toVar();
        // Lit at its edge from behind, on the side toward the light, and most at its tip.
        const rimIn = float(1).sub(clamp(d.negate().div(V.width * 0.28), 0.0, 1.0));
        const side = clamp(xl.mul(sign(lightDir.x)).div(max(hw, 0.2)).mul(0.6).add(0.4), 0.0, 1.0);
        const nearTip = exp(below.mul(-0.55));
        const rim = sq(sq(rimIn)).mul(side.mul(0.8).add(0.2)).mul(nearTip.mul(1.6).add(0.3));
        // Dust: near black, warmer where it thins, a breath of the nebula's light through it.
        const dust = mix(vec3(0.0035, 0.0018, 0.0016), vec3(0.010, 0.005, 0.005), erode.add(0.5))
            .add(rose.mul(0.006).mul(nearTip));
        const lit = dust.add(mix(gold, vec3(1.0, 0.92, 0.80), nearTip).mul(rim).mul(0.55)
            .mul(toLight.mul(0.6).add(0.4)));
        // Farther pillars sink into the nebula's glow.
        const haze = float(1).sub(exp(t.mul(-V.haze)));
        const seen = mix(lit, rose.mul(0.035).add(teal.mul(0.012)), haze);
        acc.addAssign(seen.mul(cover).mul(through));
        // A young star at some tips: a point of light just above the tip, in the open.
        const star = step(0.45, ch2).mul(stands).mul(nearFade);
        const starAt = vec2(xl, hit.y.sub(top.add(0.35)));
        const twinkle = sin(tm.mul(0.7).add(ch.mul(40.0))).mul(0.2).add(0.8);
        const starGlow = glowAt(length2(starAt).sub(0.08), t, 5000.0).mul(star).mul(twinkle)
            .mul(ignite.mul(2.4).add(1.0))
            .mul(exp(t.mul(-0.03)));
        acc.addAssign(mix(vec3(1.0, 0.86, 0.66), vec3(0.80, 0.90, 1.0), ch).mul(starGlow).mul(through).mul(0.9));
        through.mulAssign(float(1).sub(cover));
        If(through.lessThan(0.02), () => {
            Break();
        });
    });
    // The nebula: churning gas lit from within, brightest toward the light behind the pillars.
    const q = r.mul(2.1).add(vec3(0.0, 0.0, tm.mul(0.012))).toVar();
    const gas = N(q).mul(0.62).add(N(q.mul(2.3).add(vec3(4.1, 1.7, 2.9))).mul(0.38)).toVar();
    const fold = N(q.mul(4.6).add(vec3(9.3, 2.2, 6.1))).toVar();
    const warmth = smoothstep(0.35, 0.8, gas).toVar();
    const body = mix(teal.mul(0.30), mix(rose, gold, sq(toLight)), warmth);
    // Dark lanes of dust across the glow.
    const lanes = smoothstep(0.55, 0.8, N(q.mul(1.3).add(vec3(2.2, 8.1, 5.5)))).mul(0.75);
    const bright = smoothstep(0.3, 0.85, gas).mul(sq(toLight).mul(0.75).add(0.25)).mul(float(1).sub(lanes));
    const seams = sq(sq(float(1).sub(abs(fold.mul(2).sub(1))))).mul(warmth).mul(0.5).mul(float(1).sub(lanes));
    // Cool where the light does not reach (teal in the shadowed folds), warm toward it.
    const cool = teal.mul(smoothstep(0.45, 0.75, fold)).mul(float(1).sub(toLight)).mul(0.10);
    const nebula = vec3(0.012, 0.006, 0.018)
        .add(cool)
        .add(body.mul(bright).mul(0.34))
        .add(gold.mul(seams).mul(0.18))
        .add(vec3(1.0, 0.78, 0.56).mul(sq(sq(toLight))).mul(0.10));
    // Far stars through the gaps: small points, few.
    const sky = r.xy.div(max(r.z.add(1.2), 0.2)).mul(110.0).toVar();
    const cell = floor(sky).toVar();
    const sh = hash21(cell.add(vec2(13.0, 29.0))).toVar();
    const inCell = sky.sub(cell).sub(vec2(hash21(cell.add(3.1)), hash21(cell.add(7.7))).mul(0.6).add(0.2));
    const far = step(0.975, sh).mul(exp(dot(inCell, inCell).mul(-160.0))).mul(sh.sub(0.975).mul(30.0));
    return acc.add(nebula.add(vec3(0.9, 0.85, 1.0).mul(far).mul(0.5)).mul(through));
}

/** The length of a vec2 node. */
function length2(v) {
    return sqrt(dot(v, v));
}

export default placeCradle;
