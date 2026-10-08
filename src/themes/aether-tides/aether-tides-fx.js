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
 *   cells      the instant a piece locks, each cell of its echo is drawn as a lit outline: the
 *              piece's shape, crisp, for a third of a second, while the gas poured under it is
 *              still gathering. Then the outline is gone and the gas is what remains.
 *
 *   burst  r0 (x, y, t0, aim)        aim 0 = every way, 1 = along its direction
 *          r1 (r, g, b, speed)
 *          r2 (dirX, dirY, life, size)
 *   beam   r0 (x0, y, x1, t0)        from x0 (the card's edge) to x1 (past the screen's)
 *          r1 (r, g, b, thickness)
 *   cell   r0 (x, y, t0, half)       a cell's centre and half-size
 *          r1 (r, g, b, gain)
 *
 * A dormant slot draws zero-size quads.
 */

import * as THREE from 'three/webgpu';
import {
    abs,
    clamp,
    cos,
    exp,
    float,
    floor,
    instanceIndex,
    int,
    max,
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
export const CELL_SLOTS = 24;
export const BURST_ROWS = 3;
export const BEAM_ROWS = 2;
export const CELL_ROWS = 2;
export const ROW_BURST = 0;
export const ROW_BEAM = ROW_BURST + BURST_SLOTS * BURST_ROWS;
export const ROW_CELL = ROW_BEAM + BEAM_SLOTS * BEAM_ROWS;
export const FX_ROWS = ROW_CELL + CELL_SLOTS * CELL_ROWS;

/** Seconds a beam's head takes to cross, and the blade takes to fade. */
export const BEAM_RUN = 0.26;
export const BEAM_LIFE = 0.9;
/** Seconds a cell's outline shows. */
export const CELL_LIFE = 0.5;

const NEVER = -1e6;

/** The slots (CPU only): round-robin, so the oldest burst or beam gives way first. */
export class FxTable {
    constructor() {
        this.data = new Float32Array(FX_ROWS * 4);
        this.burstCursor = 0;
        this.beamCursor = 0;
        this.cellCursor = 0;
        this.reset();
    }

    reset() {
        this.data.fill(0);
        for (let i = 0; i < BURST_SLOTS; i += 1) this.data[(ROW_BURST + i * BURST_ROWS) * 4 + 2] = NEVER;
        for (let i = 0; i < BEAM_SLOTS; i += 1) this.data[(ROW_BEAM + i * BEAM_ROWS) * 4 + 3] = NEVER;
        for (let i = 0; i < CELL_SLOTS; i += 1) this.data[(ROW_CELL + i * CELL_ROWS) * 4 + 2] = NEVER;
        this.burstCursor = 0;
        this.beamCursor = 0;
        this.cellCursor = 0;
    }

    /** @returns {number} the slot written */
    burst({
        x, y, at, color, speed = 0.5, dirX = 0, dirY = 0, aim = 0, life = 0.9, size = 1,
    }) {
        const slot = this.burstCursor;
        this.burstCursor = (slot + 1) % BURST_SLOTS;
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
        const slot = this.beamCursor;
        this.beamCursor = (slot + 1) % BEAM_SLOTS;
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

    /** @returns {number} the slot written */
    cell({
        x, y, at, half, color, gain = 1,
    }) {
        const slot = this.cellCursor;
        this.cellCursor = (slot + 1) % CELL_SLOTS;
        const o = (ROW_CELL + slot * CELL_ROWS) * 4;
        const d = this.data;
        d[o] = x;
        d[o + 1] = y;
        d[o + 2] = at;
        d[o + 3] = half;
        d[o + 4] = color[0];
        d[o + 5] = color[1];
        d[o + 6] = color[2];
        d[o + 7] = gain;
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

    // ── the echo's cells ──
    const cell = additive('Aether Tides — echo cells');
    {
        const slot = int(instanceIndex);
        const base = slot.mul(CELL_ROWS).add(ROW_CELL);
        const r0 = fx.element(base);
        const r1 = fx.element(base.add(1));
        const age = now.sub(r0.z);
        const live = step(0.0, age).mul(step(age, CELL_LIFE));
        // It lands a little large and settles; the quad is wider than the cell to hold its glow.
        const settle = float(1.0).add(exp(age.max(0.0).mul(-26.0)).mul(0.35));
        const half = r0.w.mul(1.6).mul(settle).mul(live);
        cell.vertexNode = toClip(r0.xy.add(corner.mul(half)));
        const vAt = varying(corner.mul(1.6));
        const vAge = varying(age);
        const vColour = varying(r1.xyz.mul(r1.w).mul(live).mul(float(1.0).sub(P.hush.mul(0.6))));
        // A rounded square of half-size 1: distance to its edge (negative inside).
        const round = float(0.2);
        const p = abs(vAt).sub(float(1.0).sub(round));
        const outside = max(p, vec2(0.0)).length();
        const inside = max(p.x, p.y).min(0.0);
        const edgeDist = outside.add(inside).sub(round);
        const line = exp(abs(edgeDist).mul(-16.0));
        const fill = float(1.0).sub(smoothstep(-0.05, 0.02, edgeDist)).mul(0.22);
        const glowOut = exp(max(edgeDist, 0.0).mul(-5.5)).mul(0.14);
        // White as it lands, then the piece's colour; gone in a third of a second.
        const fade = float(1.0).sub(smoothstep(0.14, CELL_LIFE, vAge));
        const flash = exp(vAge.max(0.0).mul(-14.0));
        const peak = max(vColour.x, max(vColour.y, vColour.z));
        const colour = mix(vColour, vec3(peak), flash.mul(0.8));
        const shape = line.mul(1.9).add(fill).add(glowOut);
        cell.outputNode = vec4(colour.mul(shape).mul(fade).mul(flash.mul(1.2).add(1.0)), 0.0);
    }
    const cellMesh = new THREE.InstancedMesh(geometry, cell, CELL_SLOTS);
    cellMesh.name = 'Aether Tides — echo cells';
    cellMesh.frustumCulled = false;
    cellMesh.renderOrder = 13;

    return {
        table,
        dustMesh,
        beamMesh,
        cellMesh,
        /** Copy the table into the uniform rows (once a frame). */
        sync() {
            const { data } = table;
            for (let i = 0; i < rows.length; i += 1) rows[i].fromArray(data, i * 4);
        },
        dispose() {
            geometry.dispose();
            dust.dispose();
            beam.dispose();
            cell.dispose();
        },
    };
}

/** The fraction of a (possibly large) clock value, as a small exactly-representable seed. */
function fract1(value) {
    return value.sub(floor(value));
}
