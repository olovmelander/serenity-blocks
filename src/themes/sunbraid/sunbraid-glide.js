/**
 * Sunbraid — the gliders' flight (three-free, closed form in the clock).
 *
 * The valley's life: broad, thin-winged gliders that ride the warm air over the white floor in
 * slow figure-of-eight loops, banking into their turns. Each is a pure function of the clock (a
 * seek lands every glider exactly where it would be), so the shadows they throw (three, one per
 * sun) sweep across the floor in step with the bodies drawn above them.
 */
import { DEG, TAU, mulberry32 } from './sunbraid-core.js';

/** Most gliders any tier flies (rows are allocated for this many). */
export const MAX_GLIDERS = 8;

/**
 * Each glider's loop: centre (bearing degrees from the view axis, distance metres), the loop's
 * half-widths across and along the valley (metres), its height above the floor (metres) and how
 * much it rises and sinks, the period of one loop (seconds), a phase, and its wingspan (metres).
 */
export const GLIDER_LOOPS = Object.freeze((() => {
    const random = mulberry32(0x91de);
    const r = () => random();
    const out = [];
    const add = (bearing, distance, across, along, height, period, span) => out.push(Object.freeze({
        bearing,
        distance,
        across,
        along,
        height,
        rise: 6 + r() * 10,
        period,
        phase: r() * TAU,
        span,
        turn: (r() - 0.5) * 1.2,
    }));
    add(-30, 700, 260, 180, 150, 96, 34);
    add(26, 820, 300, 210, 190, 112, 38);
    add(-14, 1300, 420, 260, 240, 131, 46);
    add(38, 1500, 380, 240, 210, 124, 44);
    add(-44, 1900, 460, 300, 300, 147, 52);
    add(14, 2300, 520, 280, 270, 158, 56);
    add(-22, 2900, 560, 320, 330, 171, 60);
    add(30, 3400, 600, 340, 310, 183, 62);
    return out;
})());

/**
 * Where glider `k` is at clock `time`: position (world, the floor height added by the caller),
 * heading (unit vector of travel, xz), bank (radians, into the turn) and how far into its wingbeat.
 * `out` = { x, y, z, hx, hz, bank, beat, span }.
 */
export function gliderAt(k, time, out = {
    x: 0, y: 0, z: 0, hx: 0, hz: -1, bank: 0, beat: 0, span: 20,
}) {
    const L = GLIDER_LOOPS[k];
    const w = TAU / L.period;
    const a = w * time + L.phase;
    // A figure of eight: once across, twice along, turned a little off the valley's axis.
    const lx = L.across * Math.sin(a);
    const lz = L.along * Math.sin(2 * a);
    const vx = L.across * w * Math.cos(a);
    const vz = 2 * L.along * w * Math.cos(2 * a);
    const ax = -L.across * w * w * Math.sin(a);
    const az = -4 * L.along * w * w * Math.sin(2 * a);
    const c = Math.cos(L.turn);
    const s = Math.sin(L.turn);
    const cb = L.bearing * DEG;
    const cx = Math.sin(cb) * L.distance;
    const cz = -Math.cos(cb) * L.distance;
    out.x = cx + lx * c - lz * s;
    out.z = cz + lx * s + lz * c;
    out.y = L.height + L.rise * Math.sin(3 * a + 0.7);
    const wx = vx * c - vz * s;
    const wz = vx * s + vz * c;
    const speed = Math.hypot(wx, wz) || 1;
    out.hx = wx / speed;
    out.hz = wz / speed;
    // Bank into the turn: the sideways pull over gravity, softened.
    const sideways = ((ax * c - az * s) * -out.hz + (ax * s + az * c) * out.hx);
    out.bank = Math.atan(sideways / 9.81) * 0.8;
    out.beat = (time / 2.6 + k * 0.37) % 1;
    out.span = L.span;
    return out;
}
