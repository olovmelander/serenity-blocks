/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE HALL — the fold's last place: the way out.
 *
 * It opens as a round tube whose lines still sway, and straightens as the eye goes down it into
 * a hall with a floor, two walls and a roof, with the city's neon grid on it: cyan along the
 * way, magenta round the turn, a few squares lit like the windows of the towers it runs out
 * into. The mouth opens in its far end, and the city's light pours in along the walls.
 *
 * Met exactly. The eye is on the hall's own line (the mouth's middle), so the wall is met at its
 * distance in the ray's direction round that line, whatever shape the cross-section has.
 */
import {
    abs, atan, exp, float, floor, fract, length, max, min, mix, select, smoothstep, step, vec2, vec3,
} from 'three/tsl';
import { hash21 } from '../shared/odyssey-tsl-noise.js';
import { N, gauss, stroke } from './fold-tools.tsl.js';

export const HALL = Object.freeze({
    halfWidth: 3.1,
    ceiling: 2.6,
    floor: 1.7,
    /** The tube's radius before it straightens. */
    round: 3.0,
    grid: 1.0,
    fog: 0.05,
});

export function placeHall({
    rd, tm, zEye, pix, straight, event, eventAge, pour,
}) {
    const V = HALL;
    const sinT = max(length(rd.xy), 1e-4).toVar();
    const cx = rd.x.div(sinT).toVar();
    const cy = rd.y.div(sinT).toVar();
    const toWall = float(V.halfWidth).div(max(abs(cx), 1e-3)).toVar();
    const height = select(cy.greaterThan(0.0), float(V.ceiling), float(V.floor)).toVar();
    const toFlat = height.div(max(abs(cy), 1e-3)).toVar();
    const rho = mix(float(V.round), min(toWall, toFlat), straight).toVar();
    const t = rho.div(sinT).toVar();
    const hx = cx.mul(rho).toVar();
    const hy = cy.mul(rho).toVar();
    const hz = rd.z.mul(t).add(zEye).toVar();
    // Which face: the floor or roof (lines by x) or a wall (lines by y), eased round the corner.
    const flat = smoothstep(-0.25, 0.25, toWall.sub(toFlat)).toVar();
    // While it straightens the lines still sway.
    const sway = N(vec3(hx.mul(0.3), hy.mul(0.3), hz.mul(0.12).add(tm.mul(0.05)))).sub(0.5)
        .mul(float(1).sub(straight)).mul(1.6)
        .toVar();
    const acrossAt = mix(hy, hx, flat).add(sway).div(V.grid).toVar();
    const alongAt = hz.add(sway.mul(1.3)).div(V.grid).toVar();
    const aa = t.mul(pix).div(max(sinT, 0.05)).mul(1.2).toVar();
    const ac = abs(acrossAt.sub(floor(acrossAt.add(0.5)))).mul(V.grid).toVar();
    const al = abs(alongAt.sub(floor(alongAt.add(0.5)))).mul(V.grid).toVar();
    const lineWay = stroke(ac, 0.018, aa.mul(0.6)).toVar();
    const lineTurn = stroke(al, 0.018, aa).toVar();
    // Where the squares shrink under a few pixels the lines give way to their mean.
    const small = smoothstep(0.25, 0.8, aa.div(V.grid)).toVar();
    const cellId = vec2(floor(acrossAt).add(64.0), floor(alongAt)).toVar();
    const wh = hash21(cellId.add(vec2(flat.mul(31.0), 3.0))).toVar();
    const inset = max(abs(fract(acrossAt).sub(0.5)), abs(fract(alongAt).sub(0.5)));
    // The lit squares: on the walls and the roof, never the floor.
    const pane = stroke(inset, 0.30, aa.div(V.grid).add(0.02)).mul(smoothstep(0.82, 0.95, wh))
        .mul(float(1).sub(flat.mul(step(hy, 0.0)))).mul(straight)
        .mul(float(1).sub(small))
        .toVar();
    const paneCol = mix(vec3(1.0, 0.56, 0.16), vec3(0.14, 0.80, 1.0), step(0.5, fract(wh.mul(17.0))));
    // A pulse of light running down the lines toward the way out; the happening sends a bright one.
    const run = gauss(fract(alongAt.mul(0.035).sub(tm.mul(0.11))).sub(0.5).mul(9.0));
    const rush = gauss(hz.sub(zEye).sub(eventAge.mul(8.0)).add(4.0).div(4.0)).mul(event);
    const fog = exp(t.mul(-V.fog)).toVar();
    const cyan = vec3(0.10, 0.78, 1.0);
    const magenta = vec3(1.0, 0.12, 0.66);
    const lines = cyan.mul(lineWay).mul(run.mul(0.7).add(0.34).add(rush.mul(1.2)))
        .add(magenta.mul(lineTurn).mul(0.32))
        .mul(float(1).sub(small))
        .add(mix(cyan, magenta, 0.5).mul(small).mul(0.035));
    // The city's light pouring in through the mouth (`pour`: the mouth's angle), strongest on the
    // walls beside it and reaching out along them in soft rays.
    const fromMouth = max(atan(sinT, max(rd.z, 1e-3)).sub(pour), 0.0);
    const rays = N(vec3(cx.mul(2.6), cy.mul(2.6), tm.mul(0.06))).mul(0.6).add(0.4);
    const spill = exp(fromMouth.mul(-2.4)).mul(rays).mul(smoothstep(0.0, 0.12, pour));
    const wall = vec3(0.004, 0.002, 0.012)
        .add(vec3(0.014, 0.003, 0.026).mul(float(1).sub(flat).mul(0.6).add(0.2)))
        .add(vec3(1.0, 0.40, 0.40).mul(spill).mul(0.10));
    return wall.add(lines.mul(0.8)).add(paneCol.mul(pane).mul(0.30)).mul(fog)
        .add(vec3(0.014, 0.003, 0.028).mul(float(1).sub(fog)));
}
