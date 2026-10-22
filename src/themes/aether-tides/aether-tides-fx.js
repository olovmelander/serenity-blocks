/**
 * Aether Tides — stardust, row beams and the echo's outline.
 *
 * Three instanced draws of quads placed straight in clip space, all closed forms of the fluid's
 * clock and a small table of slots (one uniform buffer):
 *
 *   stardust   bursts of motes: a lock throws a handful in the piece's colour, a cleared row
 *              sprays them along its jets, the Tide Star scatters them when it flares. Each mote
 *              flies out, slows, drifts with the gas it is in (one velocity read per mote, in
 *              the vertex stage) and goes out.
 *   beams      a cleared row leaves the card as a blade of light, one from each side: a bright
 *              head runs to the edge of the screen and the blade fades behind it.
 *
 *   echoes     the instant a piece locks, its echo is drawn as ONE solid shape: the whole piece,
 *              fused (no line between its cells), a lit body inside one rounded outline, crisp
 *              for a third of a second while the gas poured under it is still gathering. Then
 *              the shape is gone and the gas is what remains. One quad per piece; the fragment
 *              takes the union of its cells, each cell's boxes stretched to its neighbours'
 *              centres so the inside has no seams, with a round web in each inner corner.
 *
 *   burst  r0 (x, y, t0, aim)        aim 0 = every way, 1 = along its direction
 *          r1 (r, g, b, speed)
 *          r2 (dirX, dirY, life, size)
 *   beam   r0 (x0, y, x1, t0)        from x0 (the card's edge) to x1 (past the screen's)
 *          r1 (r, g, b, thickness)
 *   echo   r0 (x, y, t0, half)       the middle of the piece's bounds, and a cell's half-size
 *          r1 (r, g, b, gain)
 *          r2 (hx, hy, count, 0)     the bounds' half-size, and how many cells
 *          r3 (pitchX, pitchY, 0, 0) from one cell's centre to the next
 *          r4…  (dx, dy, joins, corners)  each cell's centre from the middle; `joins` is a bit per
 *                                    side that meets another cell (1 left, 2 right, 4 up, 8 down);
 *                                    `corners` a bit per quadrant joined on both its sides (see
 *                                    ECHO_CORNER_FILL)
 *
 * A dormant slot draws zero-size quads.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    clamp,
    cos,
    exp,
    float,
    floor,
    instanceIndex,
    int,
    max,
    min,
    mix,
    mod,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uniformArray,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import { TAU, atHash22 } from './aether-tides-tsl.js';

export const BURST_SLOTS = 12;
export const BEAM_SLOTS = 8;
/** Echoes in flight at once (one per locking piece), and the most cells one echo holds. */
export const ECHO_SLOTS = 8;
export const ECHO_CELLS = 6;
export const BURST_ROWS = 3;
export const BEAM_ROWS = 2;
export const ECHO_ROWS = 4 + ECHO_CELLS;
export const ROW_BURST = 0;
export const ROW_BEAM = ROW_BURST + BURST_SLOTS * BURST_ROWS;
export const ROW_ECHO = ROW_BEAM + BEAM_SLOTS * BEAM_ROWS;
export const FX_ROWS = ROW_ECHO + ECHO_SLOTS * ECHO_ROWS;

/** Seconds a beam's head takes to cross, and the blade takes to fade. */
export const BEAM_RUN = 0.26;
export const BEAM_LIFE = 0.9;
/** Seconds an echo's shape shows. */
export const ECHO_LIFE = 0.5;

/** Echo joins: a bit per side of a cell that meets another cell of the same piece. */
export const JOIN_LEFT = 1;
export const JOIN_RIGHT = 2;
export const JOIN_UP = 4;
export const JOIN_DOWN = 8;

/**
 * Echo corners: a cell joined on two sides that meet (left or right, and up or down) has a
 * quadrant between them, numbered 0 up-left, 1 up-right, 2 down-left, 3 down-right. Bit 2^q: the
 * diagonal cell there is not the piece's (the bend of an L, a T, an S), so the inner corner is
 * rounded. Bit ECHO_CORNER_FILL · 2^q: it is (an O), so the gap between the four cells is filled.
 */
export const ECHO_CORNER_FILL = 16;

const NEVER = -1e6;

/** The slots (CPU only): round-robin, so the oldest burst or beam gives way first. */
export class FxTable {
    constructor() {
        this.data = new Float32Array(FX_ROWS * 4);
        this.echoCursor = 0;
        this.reset();
    }

    reset() {
        this.data.fill(0);
        for (let i = 0; i < BURST_SLOTS; i += 1) this.data[(ROW_BURST + i * BURST_ROWS) * 4 + 2] = NEVER;
        for (let i = 0; i < BEAM_SLOTS; i += 1) this.data[(ROW_BEAM + i * BEAM_ROWS) * 4 + 3] = NEVER;
        for (let i = 0; i < ECHO_SLOTS; i += 1) this.data[(ROW_ECHO + i * ECHO_ROWS) * 4 + 2] = NEVER;
        this.echoCursor = 0;
    }

    /**
     * The slot to write next: one that is spent (or never used), else the one nearest its end, so
     * a busy sky gives up its faintest light rather than a front still in flight.
     * @param {number} row first row of the kind
     * @param {number} rows rows per slot
     * @param {number} slots slots of the kind
     * @param {number} atIndex the float holding the start time
     * @param {number} lifeIndex the float holding the life (-1: every slot lives `life`)
     * @param {number} life
     */
    endingFirst(row, rows, slots, atIndex, lifeIndex, life) {
        const d = this.data;
        let best = 0;
        let bestEnd = Infinity;
        for (let i = 0; i < slots; i += 1) {
            const o = (row + i * rows) * 4;
            const end = d[o + atIndex] + (lifeIndex >= 0 ? d[o + lifeIndex] : life);
            if (end < bestEnd) {
                bestEnd = end;
                best = i;
            }
        }
        return best;
    }

    /** @returns {number} the slot written */
    burst({
        x, y, at, color, speed = 0.5, dirX = 0, dirY = 0, aim = 0, life = 0.9, size = 1,
    }) {
        const slot = this.endingFirst(ROW_BURST, BURST_ROWS, BURST_SLOTS, 2, 10, 0);
        const o = (ROW_BURST + slot * BURST_ROWS) * 4;
        const d = this.data;
        const length = Math.hypot(dirX, dirY);
        d[o] = x;
        d[o + 1] = y;
        d[o + 2] = at;
        d[o + 3] = length > 1e-4 ? aim : 0;
        d[o + 4] = color[0];
        d[o + 5] = color[1];
        d[o + 6] = color[2];
        d[o + 7] = speed;
        d[o + 8] = length > 1e-4 ? dirX / length : 1;
        d[o + 9] = length > 1e-4 ? dirY / length : 0;
        d[o + 10] = life;
        d[o + 11] = size;
        return slot;
    }

    /** @returns {number} the slot written */
    beam({
        x0, y, x1, at, color, thickness,
    }) {
        const slot = this.endingFirst(ROW_BEAM, BEAM_ROWS, BEAM_SLOTS, 3, -1, BEAM_LIFE);
        const o = (ROW_BEAM + slot * BEAM_ROWS) * 4;
        const d = this.data;
        d[o] = x0;
        d[o + 1] = y;
        d[o + 2] = x1;
        d[o + 3] = at;
        d[o + 4] = color[0];
        d[o + 5] = color[1];
        d[o + 6] = color[2];
        d[o + 7] = thickness;
        return slot;
    }

    /**
     * A piece's echo, drawn as one fused shape.
     * @param {object} echo
     * @param {number[][]} echo.cells   the cells' centres, tide space (at most ECHO_CELLS are kept)
     * @param {number} echo.at          when it lands
     * @param {number} echo.half        a cell's half-size as drawn
     * @param {number} echo.pitchX      from one cell's centre to the next, across
     * @param {number} [echo.pitchY]    …and down (the same by default)
     * @param {number[]} echo.color
     * @param {number} [echo.gain=1]
     * @returns {number} the slot written (-1 for a piece with no cells)
     */
    echo({
        cells, at, half, pitchX, pitchY = pitchX, color, gain = 1,
    }) {
        const count = Math.min(ECHO_CELLS, Array.isArray(cells) ? cells.length : 0);
        if (count === 0) return -1;
        const slot = this.echoCursor;
        this.echoCursor = (slot + 1) % ECHO_SLOTS;
        const o = (ROW_ECHO + slot * ECHO_ROWS) * 4;
        const d = this.data;
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (let i = 0; i < count; i += 1) {
            x0 = Math.min(x0, cells[i][0]);
            x1 = Math.max(x1, cells[i][0]);
            y0 = Math.min(y0, cells[i][1]);
            y1 = Math.max(y1, cells[i][1]);
        }
        const cx = (x0 + x1) * 0.5;
        const cy = (y0 + y1) * 0.5;
        d.fill(0, o, o + ECHO_ROWS * 4);
        d[o] = cx;
        d[o + 1] = cy;
        d[o + 2] = at;
        d[o + 3] = half;
        d[o + 4] = color[0];
        d[o + 5] = color[1];
        d[o + 6] = color[2];
        d[o + 7] = gain;
        d[o + 8] = (x1 - x0) * 0.5 + half;
        d[o + 9] = (y1 - y0) * 0.5 + half;
        d[o + 10] = count;
        d[o + 12] = pitchX;
        d[o + 13] = pitchY;
        // Two cells meet when one sits a pitch from the other along one axis and level on the other.
        const near = (a, b, pitch) => Math.abs(a - b) < pitch * 0.3;
        const has = (x, y) => {
            for (let j = 0; j < count; j += 1) {
                if (near(cells[j][0], x, pitchX) && near(cells[j][1], y, pitchY)) return true;
            }
            return false;
        };
        for (let i = 0; i < count; i += 1) {
            const [x, y] = cells[i];
            let joins = 0;
            for (let j = 0; j < count; j += 1) {
                if (j === i) continue;
                const [nx, ny] = cells[j];
                if (near(ny, y, pitchY) && near(nx, x - pitchX, pitchX)) joins |= JOIN_LEFT;
                if (near(ny, y, pitchY) && near(nx, x + pitchX, pitchX)) joins |= JOIN_RIGHT;
                if (near(nx, x, pitchX) && near(ny, y - pitchY, pitchY)) joins |= JOIN_UP;
                if (near(nx, x, pitchX) && near(ny, y + pitchY, pitchY)) joins |= JOIN_DOWN;
            }
            let corners = 0;
            for (let q = 0; q < 4; q += 1) {
                const right = q % 2 === 1;
                const down = q >= 2;
                if ((joins & (right ? JOIN_RIGHT : JOIN_LEFT)) && (joins & (down ? JOIN_DOWN : JOIN_UP))) {
                    const diagonal = has(x + (right ? pitchX : -pitchX), y + (down ? pitchY : -pitchY));
                    corners |= diagonal ? ECHO_CORNER_FILL << q : 1 << q;
                }
            }
            const r = o + (4 + i) * 4;
            d[r] = x - cx;
            d[r + 1] = y - cy;
            d[r + 2] = joins;
            d[r + 3] = corners;
        }
        return slot;
    }
}

const additive = (name) => {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        // With a custom output of alpha zero, light is added and the target's alpha is left alone.
        premultipliedAlpha: true,
        fog: false,
    });
    material.name = name;
    // Tide space has y down: placing a quad in it mirrors its winding.
    material.side = THREE.DoubleSide;
    // Additive with no depth test, so both faces can go in one draw (three would otherwise
    // draw a transparent double-sided material twice, back faces first, with two pipelines).
    material.forceSinglePass = true;
    return material;
};

/**
 * @param {object} options
 * @param {object} options.tide       createTideUniforms()
 * @param {object} options.picture    createPictureUniforms()
 * @param {object} options.fluid      TideFluid (its texture nodes)
 * @param {object} options.tier       quality tier
 */
export function createFx({
    tide: U, picture: P, fluid, tier,
}) {
    const table = new FxTable();
    const rows = Array.from({ length: FX_ROWS }, () => new THREE.Vector4());
    const fx = uniformArray(rows, 'vec4');
    const now = U.time.add(U.ahead);
    const corner = positionGeometry.xy;
    const toClip = (q) => {
        const framed = q.sub(P.frame.xy).mul(P.frame.z);
        return vec4(framed.x.div(U.screen.x), framed.y.div(U.screen.y).negate(), 0.0, 1.0);
    };
    const geometry = new THREE.PlaneGeometry(2, 2);

    // ── stardust ──
    const perBurst = Math.max(4, Math.floor(tier.sparkles / BURST_SLOTS));
    const dust = additive('Aether Tides — stardust');
    {
        const index = float(instanceIndex);
        const slot = int(mod(index, BURST_SLOTS));
        const base = slot.mul(BURST_ROWS).add(ROW_BURST);
        const r0 = fx.element(base);
        const r1 = fx.element(base.add(1));
        const r2 = fx.element(base.add(2));
        const serial = floor(index.div(BURST_SLOTS));
        // Random per mote AND per burst (the burst's start time is in the seed).
        const h = atHash22(vec2(serial.add(float(slot).mul(17.0)), fract1(r0.z).mul(97.0).add(serial.mul(0.37))));
        const h2 = atHash22(vec2(serial.mul(1.7).add(3.1), float(slot).add(fract1(r0.z).mul(53.0))));
        const age = now.sub(r0.z);
        const life = r2.z.mul(h2.x.mul(0.55).add(0.45));
        const live = step(0.0, age).mul(step(age, life));
        const t = clamp(age.div(max(life, 1e-3)), 0.0, 1.0);
        const angle = h.x.mul(TAU);
        const any = vec2(cos(angle), sin(angle));
        const along = any.add(r2.xy.mul(r0.w.mul(2.2)));
        const dir = along.div(along.length().add(1e-4));
        const speed = r1.w.mul(h.y.mul(0.9).add(0.2));
        // Thrown, then slowed by the gas: distance = speed · (1 − e^(−k·age)) / k.
        const drag = float(2.8);
        const travel = speed.mul(float(1.0).sub(exp(age.max(0.0).mul(drag).negate()))).div(drag);
        const thrown = r0.xy.add(dir.mul(travel));
        // …and carried by the gas it ends up in.
        const flow = fluid.tVel.sample(thrown.div(U.half.mul(2.0)).add(0.5)).level(0).xy;
        const centre = thrown.add(flow.mul(age.max(0.0)).mul(0.55));
        const half = float(0.011).mul(h2.y.mul(0.9).add(0.45)).mul(r2.w)
            .mul(float(1.0).sub(t.mul(t)))
            .mul(live);
        const twinkle = float(0.65).add(sin(age.mul(h.y.mul(18.0).add(9.0)).add(h.x.mul(40.0))).mul(0.35));
        const tint = mix(vec3(1.0), r1.xyz, smoothstep(0.0, 0.22, t));
        const vColour = varying(tint.mul(twinkle).mul(float(1.0).sub(t)).mul(2.6).mul(float(1.0).sub(P.hush.mul(0.6))));
        const vCorner = varying(corner);
        dust.vertexNode = toClip(centre.add(corner.mul(half)));
        const r = vCorner.length();
        const core = exp(vCorner.dot(vCorner).mul(-9.0));
        const glint = exp(abs(vCorner.x).mul(-26.0)).mul(exp(abs(vCorner.y).mul(-3.5)))
            .add(exp(abs(vCorner.y).mul(-26.0)).mul(exp(abs(vCorner.x).mul(-3.5))));
        dust.outputNode = vec4(vColour.mul(core.add(glint.mul(0.5))).mul(float(1.0).sub(smoothstep(0.8, 1.0, r))), 0.0);
    }
    const dustMesh = new THREE.InstancedMesh(geometry, dust, perBurst * BURST_SLOTS);
    dustMesh.name = 'Aether Tides — stardust';
    dustMesh.frustumCulled = false;
    dustMesh.renderOrder = 12;

    // ── beams ──
    const beam = additive('Aether Tides — row beams');
    {
        const slot = int(instanceIndex);
        const base = slot.mul(BEAM_ROWS).add(ROW_BEAM);
        const r0 = fx.element(base);
        const r1 = fx.element(base.add(1));
        const age = now.sub(r0.w);
        const live = step(0.0, age).mul(step(age, BEAM_LIFE));
        const u = corner.x.mul(0.5).add(0.5);
        const x = mix(r0.x, r0.z, u);
        // The blade's glow is several times wider than its edge.
        const halfHeight = r1.w.mul(5.0).mul(live);
        beam.vertexNode = toClip(vec2(x, r0.y.add(corner.y.mul(halfHeight))));
        const vAlong = varying(u);
        const vAcross = varying(corner.y);
        const vAge = varying(age);
        const vColour = varying(r1.xyz.mul(live).mul(float(1.0).sub(P.hush.mul(0.6))));
        const head = vAge.div(BEAM_RUN);
        // Nothing ahead of the head; behind it the blade thins and fades.
        const ahead = exp(max(vAlong.sub(head), 0.0).mul(-60.0));
        const behind = exp(max(head.sub(vAlong), 0.0).mul(-1.6));
        const fade = exp(vAge.max(0.0).mul(-5.2));
        const edge = exp(abs(vAcross).mul(-34.0));
        const halo = exp(vAcross.mul(vAcross).mul(-7.0)).mul(0.16);
        const tip = exp(vAlong.sub(head).mul(vAlong.sub(head)).mul(-900.0)).mul(step(head, 1.15)).mul(1.4);
        const body = edge.add(halo).mul(ahead).mul(behind).mul(fade.mul(2.6).add(tip));
        // Its core burns white.
        const white = edge.mul(edge).mul(ahead).mul(fade.add(tip)).mul(1.5);
        beam.outputNode = vec4(vColour.mul(body).add(vec3(white).mul(max(vColour.x, max(vColour.y, vColour.z)))), 0.0);
    }
    const beamMesh = new THREE.InstancedMesh(geometry, beam, BEAM_SLOTS);
    beamMesh.name = 'Aether Tides — row beams';
    beamMesh.frustumCulled = false;
    beamMesh.renderOrder = 11;

    // ── echoes: each locking piece's footprint, drawn as one solid shape ──
    const echo = additive('Aether Tides — echoes');
    {
        const slot = int(instanceIndex);
        const base = slot.mul(ECHO_ROWS).add(ROW_ECHO);
        const r0 = fx.element(base);
        const r1 = fx.element(base.add(1));
        const r2 = fx.element(base.add(2));
        const age = now.sub(r0.z);
        const live = step(0.0, age).mul(step(age, ECHO_LIFE));
        // It lands a little large and settles; the quad reaches past the shape to hold its glow.
        const settle = float(1.0).add(exp(age.max(0.0).mul(-26.0)).mul(0.18));
        const reach = r2.xy.add(r0.w.mul(0.9)).mul(live);
        echo.vertexNode = toClip(r0.xy.add(corner.mul(reach).mul(settle)));
        // Where the fragment lies from the shape's middle, in tide units (before the settle).
        const vAt = varying(corner.mul(reach));
        const vSlot = varying(float(slot));
        const vAge = varying(age);
        const vColour = varying(r1.xyz.mul(r1.w).mul(live).mul(float(1.0).sub(P.hush.mul(0.6))));
        echo.outputNode = Fn(() => {
            // A slot read in the fragment comes in as a varying: round it back to a whole slot.
            const at = int(floor(vSlot.add(0.5))).mul(ECHO_ROWS).add(ROW_ECHO).toVar();
            const half = fx.element(at).w.toVar();
            const count = fx.element(at.add(2)).z.toVar();
            const pitch = fx.element(at.add(3)).xy.toVar();
            // A side that meets another cell stretches to that cell's centre, so the union has no
            // inside edges: one outline, round the whole piece. Each cell is two boxes, one
            // stretched across and one up and down (one box stretched both ways would fill the
            // bend of an L or a T), and the union is a hard one, so straight sides stay straight.
            const toNext = pitch.sub(half).toVar();
            const round = half.mul(0.36);
            const fillet = half.mul(0.24);
            const d = float(1e3).toVar();
            const bit = (word, value) => mod(floor(word.div(value)), 2.0);
            // Signed distance to the box lo..hi, its corners rounded by r.
            const box = (lo, hi, r) => {
                const q = abs(vAt.sub(lo.add(hi).mul(0.5))).sub(hi.sub(lo).mul(0.5)).add(r);
                return max(q, vec2(0.0)).length().add(min(max(q.x, q.y), 0.0)).sub(r);
            };
            for (let i = 0; i < ECHO_CELLS; i += 1) {
                If(float(i).lessThan(count), () => {
                    const cell = fx.element(at.add(4 + i));
                    const c = cell.xy;
                    const joins = cell.z;
                    const across = box(
                        c.sub(vec2(half.add(bit(joins, JOIN_LEFT).mul(toNext.x)), half)),
                        c.add(vec2(half.add(bit(joins, JOIN_RIGHT).mul(toNext.x)), half)),
                        round,
                    );
                    const upDown = box(
                        c.sub(vec2(half, half.add(bit(joins, JOIN_UP).mul(toNext.y)))),
                        c.add(vec2(half, half.add(bit(joins, JOIN_DOWN).mul(toNext.y)))),
                        round,
                    );
                    d.assign(min(d, min(across, upDown)));
                    const corners = cell.w;
                    If(corners.greaterThan(0.5), () => {
                        for (let q = 0; q < 4; q += 1) {
                            const s = vec2(q % 2 === 1 ? 1 : -1, q >= 2 ? 1 : -1);
                            // The diagonal cell is the piece's too (an O): the whole block of four,
                            // so the gap between them is filled and the body is as deep as the I's.
                            If(bit(corners, ECHO_CORNER_FILL * 2 ** q).greaterThan(0.5), () => {
                                const near = c.sub(s.mul(half));
                                const far = c.add(pitch.mul(s)).add(s.mul(half));
                                d.assign(min(d, box(min(near, far), max(near, far), round)));
                            });
                            // It is not (the bend of an L, a T, an S): a round web in the inner
                            // corner, the square there less the circle that touches both sides.
                            If(bit(corners, 2 ** q).greaterThan(0.5), () => {
                                const inner = c.add(s.mul(half));
                                const middle = inner.add(s.mul(fillet));
                                const web = max(
                                    box(min(inner, middle), max(inner, middle), float(0.0)),
                                    fillet.sub(vAt.sub(middle).length()),
                                );
                                d.assign(min(d, web));
                            });
                        }
                    });
                });
            }
            // In cell half-sizes from the outline (negative inside).
            const e = d.div(half).toVar();
            const line = exp(abs(e).mul(-14.0));
            // A solid body that covers what lies behind it, lit a little more toward its edges.
            const inside = float(1.0).sub(smoothstep(-0.06, 0.03, e)).toVar();
            const body = inside.mul(mix(0.62, 0.9, smoothstep(-0.9, 0.0, e)));
            const glowOut = exp(max(e, 0.0).mul(-5.0)).mul(0.16);
            // White as it lands, then the piece's colour; gone in a third of a second.
            const fade = float(1.0).sub(smoothstep(0.14, ECHO_LIFE, vAge)).toVar();
            const flash = exp(vAge.max(0.0).mul(-14.0));
            const peak = max(vColour.x, max(vColour.y, vColour.z));
            const colour = mix(vColour, vec3(peak), flash.mul(0.8));
            const shape = line.mul(1.3).add(body).add(glowOut);
            // Premultiplied: the light is added, and the body takes most of what is behind it away.
            return vec4(colour.mul(shape).mul(fade).mul(flash.mul(1.2).add(1.0)), inside.mul(0.78).mul(fade));
        })();
        // Premultiplied "over" (One, OneMinusSrcAlpha): where the alpha is 0 (the glow, and the
        // outline outside the body) it adds light like every other sprite here.
        echo.blending = THREE.NormalBlending;
    }
    const echoMesh = new THREE.InstancedMesh(geometry, echo, ECHO_SLOTS);
    echoMesh.name = 'Aether Tides — echoes';
    echoMesh.frustumCulled = false;
    echoMesh.renderOrder = 13;

    return {
        table,
        dustMesh,
        beamMesh,
        echoMesh,
        /** Copy the table into the uniform rows (once a frame). */
        sync() {
            const { data } = table;
            for (let i = 0; i < rows.length; i += 1) rows[i].fromArray(data, i * 4);
        },
        dispose() {
            geometry.dispose();
            dust.dispose();
            beam.dispose();
            echo.dispose();
        },
    };
}

/** The fraction of a (possibly large) clock value, as a small exactly-representable seed. */
function fract1(value) {
    return value.sub(floor(value));
}
