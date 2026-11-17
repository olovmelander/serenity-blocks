/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE NAVE — the fold's third place (orb 52: Voltage Storm).
 *
 * A pointed vault over a polished floor, bay after bay; in each bay a tall window with a storm
 * behind its glass, the windows of one side blazing and the other side's dim; slow arcs of light
 * crawling the vault's ribs.
 *
 * Met exactly. In cross-section the nave is convex: two walls, and above their springing a pointed
 * arch (each half an arc about a centre beyond the middle). A falling ray is unfolded through the
 * floor (the eye mirrored below it), so the floor's image is the same intersection.
 */
import {
    Loop, abs, atan, exp, float, floor, fract, int, length, max, min, mix, select, smoothstep, sqrt, step, vec2, vec3,
} from 'three/tsl';
import {
    N, frameRows, gauss, sq, stroke, turn,
} from './fold-tools.tsl.js';

export const NAVE = Object.freeze({
    frame: [-17, 9, 4],
    halfWidth: 3.3,
    floor: 1.5,
    spring: 2.1,
    /** The pointed arch: each half an arc about a centre this far beyond the middle. */
    offset: 1.5,
    bay: 4.4,
    /** Where the eye stands across the nave (toward the bright side) and above its own height. */
    eye: [0.6, 0],
    fog: 0.030,
    /** The window in each bay: half-width, sill and springing heights, its arcs' centres' offset. */
    window: Object.freeze({
        half: 0.56, sill: -0.6, spring: 0.9, offset: 0.5,
    }),
    /** The shafts of storm light from the bright side's windows: their way, and the samples a ray takes of them. */
    shaft: Object.freeze({ way: [-0.74, -0.58, 0.34], samples: 8 }),
});

const ROWS = frameRows(NAVE.frame);

/** How far inside a bay's window the point (`a` across, `b` above the sill) is: negative inside. */
function windowDistance(a, b) {
    const W = NAVE.window;
    const rise = W.spring - W.sill;
    return select(
        b.lessThan(rise),
        abs(a).sub(W.half),
        length(vec2(abs(a).add(W.offset), b.sub(rise))).sub(W.half + W.offset),
    );
}

export function placeNave({
    rd, tm, zEye, pix, mood, event, eventAge, flash, jitter,
}) {
    const V = NAVE;
    const W = V.window;
    const r = turn(rd, ROWS).toVar();
    const down = float(1).sub(step(0.0, r.y)).toVar();
    const ex = float(V.eye[0]);
    // The eye, or its mirror image under the floor for a falling ray.
    const oy = mix(float(V.eye[1]), float((-2 * V.floor) - V.eye[1]), down).toVar();
    const dy = abs(r.y).toVar();
    const dx = r.x.toVar();
    const sx = select(dx.greaterThan(0.0), float(1), float(-1)).toVar();
    const adx = max(abs(dx), 1e-4).toVar();
    // The wall on the ray's side.
    const tWall = float(V.halfWidth).sub(ex.mul(sx)).div(adx).toVar();
    const yWall = oy.add(dy.mul(tWall)).toVar();
    // The arch: the far root of each circle (the eye is inside both); the nearer of the two is the vault.
    const R = V.halfWidth + V.offset;
    const a2 = max(dx.mul(dx).add(dy.mul(dy)), 1e-6).toVar();
    const arc = (cx) => {
        const fx = ex.sub(cx);
        const fy = oy.sub(V.spring);
        const b = fx.mul(dx).add(fy.mul(dy));
        const c = fx.mul(fx).add(fy.mul(fy)).sub(R * R);
        return b.negate().add(sqrt(max(b.mul(b).sub(a2.mul(c)), 0.0))).div(a2);
    };
    const tVault = min(arc(-V.offset), arc(V.offset)).toVar();
    const onVault = step(V.spring, yWall).toVar();
    const tHit = mix(tWall, tVault, onVault).toVar();
    const hx = ex.add(dx.mul(tHit)).toVar();
    const hyUnfolded = oy.add(dy.mul(tHit)).toVar();
    // Fold the mirror image back: the real height, and whether this is seen in the floor.
    const hy = abs(hyUnfolded.add(V.floor)).sub(V.floor).toVar();
    const inFloor = down.mul(step(-V.floor, hyUnfolded)).toVar();
    const hz = r.z.mul(tHit).add(zEye).toVar();
    const bay = floor(hz.div(V.bay).add(0.5)).toVar();
    const zl = hz.div(V.bay).sub(bay).toVar();
    const aa = tHit.mul(pix).mul(1.6).toVar();
    const right = sx.mul(0.5).add(0.5).toVar();
    // ── the walls: clustered shafts at the bays' joints, a tall pointed window in each bay ──
    const wA = zl.mul(V.bay).toVar();
    const wB = hy.sub(W.sill).toVar();
    const rise = W.spring - W.sill;
    const inWin = windowDistance(wA, wB).toVar();
    const sill = step(0.0, wB).toVar();
    const glass = stroke(inWin, -0.05, aa).mul(sill).toVar();
    // Its tracery: a mullion up the middle, a bar at the springing, and a rim of lit stone.
    const bars = max(stroke(abs(wA), 0.022, aa), stroke(abs(wB.sub(rise)), 0.022, aa)).mul(glass);
    const rim = stroke(abs(inWin.add(0.02)), 0.03, aa).mul(sill);
    // The storm beyond the glass: cloud light climbing the window, swelling slowly; the
    // happening sends a slow swell of it down the bright side, bay after bay.
    const storm = N(vec3(wA.mul(0.9).add(bay.mul(3.7)), wB.mul(0.6).add(tm.mul(0.05)), tm.mul(0.04).add(bay))).toVar();
    // ...and threads of lightning crawling through it, as in a globe of plasma.
    const veinAt = vec3(wA.mul(2.3).add(bay.mul(1.3)), wB.mul(1.5).sub(tm.mul(0.2)), tm.mul(0.1).add(bay.mul(2.0)));
    const vein = N(veinAt).toVar();
    const crawlers = sq(sq(sq(sq(float(1).sub(abs(vein.mul(2).sub(1))))))).toVar();
    const swellAt = gauss(bay.mul(V.bay).sub(zEye).sub(eventAge.mul(7.0)).add(10.0)
        .div(9.0)).mul(event).mul(flash);
    const windowGain = mix(float(0.42), float(1.0), right).mul(swellAt.mul(1.1).add(1.0)).toVar();
    // (The bright side's storm is blue-white; the far side's a dim violet, as if another storm.)
    const stormLow = mix(vec3(0.060, 0.010, 0.20), vec3(0.012, 0.035, 0.26), right);
    const stormHigh = mix(vec3(0.50, 0.14, 0.90), vec3(0.20, 0.38, 0.98), right);
    const windowCol = mix(stormLow, stormHigh, smoothstep(0.3, 0.8, storm))
        .mul(storm.mul(0.8).add(0.3))
        .add(mix(vec3(0.90, 0.56, 1.0), vec3(0.80, 0.94, 1.0), right).mul(crawlers).mul(0.6))
        .mul(windowGain);
    // Light spilling from each window onto the stone round it.
    const spill = exp(max(inWin, 0).mul(-2.6)).mul(float(1).sub(glass)).mul(windowGain).mul(0.07);
    const joint = float(0.5).sub(abs(zl)).mul(V.bay).toVar();
    const shafts = max(stroke(joint, 0.035, aa), stroke(abs(joint.sub(0.16)), 0.022, aa)).toVar();
    // The stone: dark, lighter up the wall, and washed by the windows of the bright side (the
    // wall facing them more than their own).
    const washed = mix(float(1.0), float(0.45), right).mul(smoothstep(2.2, -1.2, hy).mul(0.6).add(0.4));
    const stone = vec3(0.0035, 0.0055, 0.016)
        .add(vec3(0.010, 0.022, 0.070).mul(washed));
    const wallCol = stone
        .add(windowCol.mul(glass).mul(float(1).sub(bars.mul(0.8))))
        .add(mix(vec3(0.50, 0.20, 1.0), vec3(0.26, 0.42, 1.0), right).mul(spill))
        .add(mix(vec3(0.62, 0.30, 1.0), vec3(0.34, 0.54, 1.0), right).mul(rim)
            .mul(mix(float(0.22), float(0.42), right)))
        .add(vec3(0.20, 0.34, 0.90).mul(shafts).mul(0.20));
    // ── the vault: ribs across at the joints, ribs crossing each bay, a ridge rib ──
    const cxSide = sx.mul(-V.offset);
    const phi = atan(hy.sub(V.spring), abs(hx.sub(cxSide))).toVar();
    const phiTop = Math.atan2(Math.sqrt((R * R) - (V.offset * V.offset)), V.offset);
    const climb = max(min(phi.div(phiTop), 1.0), 0.0).toVar();
    const span = R * phiTop;
    const ribAcross = stroke(joint, 0.07, aa);
    const ribCross = stroke(abs(climb.sub(float(1).sub(abs(zl).mul(2)))).mul(span * 0.7), 0.05, aa);
    const ribRidge = stroke(float(1).sub(climb).mul(span), 0.07, aa).toVar();
    // (The ribs across are the faintest: lit alike, they ring the far end like a target.)
    const ribs = max(max(ribAcross.mul(0.14), ribCross), ribRidge).toVar();
    // Arcs of light crawling the ribs, slow; the happening sends one bright one down the ridge.
    const crawl = N(vec3(hz.mul(0.7).sub(tm.mul(0.6)), climb.mul(5.0), bay.mul(1.7))).toVar();
    const arcs = smoothstep(0.64, 0.92, crawl).mul(ribs).toVar();
    const bolt = gauss(hz.sub(zEye).sub(float(60).sub(eventAge.mul(9.0))).div(5.0)).mul(event).mul(flash).mul(ribRidge);
    const web = N(vec3(climb.mul(3.0).add(sx.mul(2.0)), hz.mul(0.4), tm.mul(0.03))).toVar();
    const vaultCol = vec3(0.004, 0.006, 0.020)
        .add(vec3(0.008, 0.020, 0.070).mul(web.mul(0.8).add(0.2)).mul(mix(float(0.35), float(1.0), right))
            .mul(float(1).sub(climb.mul(0.6))))
        .add(vec3(0.20, 0.34, 0.90).mul(ribs).mul(0.30))
        .add(vec3(0.70, 0.86, 1.0).mul(arcs).mul(0.9))
        .add(vec3(0.85, 0.94, 1.0).mul(bolt).mul(1.5));
    const fog = exp(tHit.mul(-V.fog)).toVar();
    const mist = mix(vec3(0.006, 0.014, 0.050), vec3(0.030, 0.018, 0.075), mood.x);
    // ── the shafts: storm light falling across the nave from the bright side's windows ──
    // A few samples along the ray, each asked whether the light's way back from it passes
    // through a window (the same window shape): their mean is the light in the air.
    const S = V.shaft;
    const wayLen = Math.hypot(...S.way);
    const way = S.way.map((c) => c / wayLen);
    const lit = float(0).toVar();
    Loop({
        start: int(0), end: int(S.samples), type: 'int', condition: '<', name: 'naveShaft',
    }, ({ naveShaft }) => {
        const ts = tHit.mul(float(naveShaft).add(jitter).div(S.samples)).toVar();
        const px = ex.add(dx.mul(ts));
        const py = abs(oy.add(dy.mul(ts)).add(V.floor)).sub(V.floor);
        const pz = r.z.mul(ts).add(zEye);
        const back = float(V.halfWidth).sub(px).div(-way[0]).toVar();
        const zw = pz.sub(back.mul(way[2])).toVar();
        const yw = py.sub(back.mul(way[1])).sub(W.sill).toVar();
        const za = zw.sub(floor(zw.div(V.bay).add(0.5)).mul(V.bay));
        const through = float(1).sub(smoothstep(-0.12, 0.04, windowDistance(za, yw))).mul(step(0.0, yw));
        lit.addAssign(through.mul(exp(back.mul(-0.16))).mul(exp(ts.mul(-V.fog))));
    });
    const shaftLight = lit.div(S.samples).mul(min(tHit, 40.0)).mul(windowGain.mul(0.4).add(0.6)).toVar();
    const seen = mix(wallCol, vaultCol, onVault).mul(fog).add(mist.mul(float(1).sub(fog)))
        .add(vec3(0.050, 0.10, 0.42).mul(shaftLight).mul(0.10))
        .toVar();
    // The floor: what stands above it, dimmer and bluer, under a faint inlay of squares.
    const tFloor = float(V.floor + V.eye[1]).div(max(dy, 1e-3)).toVar();
    const fz = r.z.mul(tFloor).add(zEye);
    const fx = ex.add(dx.mul(tFloor));
    const fa = tFloor.mul(pix).div(max(dy, 0.02)).mul(1.3);
    const tile = V.bay / 4;
    const inlay = max(
        stroke(abs(fract(fz.div(tile)).sub(0.5)).mul(tile), 0.02, fa),
        stroke(abs(fract(fx.div(tile).add(0.5)).sub(0.5)).mul(tile), 0.02, fa),
    ).mul(exp(tFloor.mul(-0.10)));
    // Pools of window light lying across it from the bright side, one for each bay.
    const poolAt = fz.div(V.bay).sub(floor(fz.div(V.bay).add(0.5))).mul(V.bay)
        .add(float(V.halfWidth).sub(fx).mul(0.35));
    const pool = stroke(abs(poolAt), W.half * 0.9, float(0.35))
        .mul(smoothstep(-V.halfWidth, V.halfWidth * 0.2, fx)).mul(smoothstep(V.halfWidth, V.halfWidth - 1.6, fx))
        .mul(exp(tFloor.mul(-0.05)));
    const floorCol = seen.mul(vec3(0.40, 0.50, 0.74)).add(vec3(0.10, 0.18, 0.5).mul(inlay).mul(0.12))
        .add(vec3(0.060, 0.11, 0.40).mul(pool).mul(0.5));
    return mix(seen, floorCol, inFloor);
}
