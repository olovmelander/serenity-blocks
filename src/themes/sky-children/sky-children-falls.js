/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sky Children — Irisfall: every fall in ONE draw.
 *
 * A merged set of ribbons, one per fall: the Mother Fall off the Spring Isle's shoulder (the
 * brightest white in the frame), the broken span's fall off the Twin Isle's aqueduct, the Twin
 * Isle's horsetails, hairlines on the far isles, and the dynamic sheets a clear pours off the card
 * and the overflow a hard drop spills. Each vertex carries (fall, s along it, u across it); the
 * vertex stage reads the fall's row in `U.falls` and puts the ribbon on its ballistic curve
 * (x = v0·t, y = −½·g·t²), facing the eye, widening as it falls. The fragment front-lights white
 * water from the sun behind the eye, runs streaks down it at the speed water really falls (by
 * travel time, so they accelerate), frays the sheet into horsetails and then spray, and carries
 * the coloured packets a clear releases, riding down at water speed.
 *
 * Premultiplied over, depth-tested, no depth write; drawn after the stone, before the sky.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, abs, cameraPosition, clamp, cross, dot, exp, float, int, length, max, min, mix, normalize, positionLocal, select, smoothstep, texture, uniformArray, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { G } from './sky-children-core.js';
import { horizonHaze, luma, skyBase } from './sky-children-tsl.js';

/** Fall slots: static falls first, then the clear's sheets and the overflow spills. */
export const FALL_SLOTS = 24;
/** Packets riding the falls at once (coloured release ribbons, surge fronts). */
export const PACKET_SLOTS = 32;
/** Kinds of fall (the shader's look). */
export const FALL_KIND = Object.freeze({
    sheet: 0, horsetail: 1, hairline: 2, pour: 3, spill: 4,
});

/**
 * Rows per fall in `falls` (3 vec4):
 *   0  lip.xyz, kind
 *   1  dir.x, dir.z (unit, horizontal), v0 (m/s), width (m at the lip)
 *   2  spread (width growth per second), duration (s of fall drawn), flow (0..2), bornAt (water
 *      clock when it began; a sheet unrolls from its lip from then)
 */
export function createFallTable() {
    return uniformArray(Array.from({ length: FALL_SLOTS * 3 }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4');
}

/** Packets (2 vec4): (fall, bornWater, width (s of travel), strength) (r, g, b, kind 0 colour/1 surge). */
export function createPacketTable() {
    return uniformArray(Array.from({ length: PACKET_SLOTS * 2 }, () => new THREE.Vector4(-1, 0, 0, 0)), 'vec4');
}

/** The merged ribbons: `rows` along each fall, `cols` across; every slot gets one. */
export function buildFallsGeometry(rows, cols) {
    const pos = [];
    const index = [];
    let base = 0;
    for (let f = 0; f < FALL_SLOTS; f++) {
        for (let r = 0; r < rows; r++) {
            const s = r / (rows - 1);
            for (let c = 0; c < cols; c++) {
                const u = (c / (cols - 1)) * 2 - 1;
                pos.push(f, s, u);
            }
        }
        for (let r = 0; r < rows - 1; r++) {
            for (let c = 0; c < cols - 1; c++) {
                const a = base + r * cols + c;
                const b = a + 1;
                const d = a + cols;
                const e = d + 1;
                index.push(a, d, b, b, d, e);
            }
        }
        base += rows * cols;
    }
    const g = new THREE.BufferGeometry();
    // position carries (fall, s, u); the vertex stage builds the real place.
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(index);
    return g;
}

/**
 * @param {object} p
 * @param {object} p.tier
 * @param {object} p.U       the world's uniforms (U.falls, U.packets, U.waterClock, …)
 * @param {object} p.tex     { noise }
 */
export function createFalls({ tier, U, tex }) {
    const rows = tier.fallRows;
    const cols = tier.fallCols + 1;
    const geometry = buildFallsGeometry(rows, cols);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        fog: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    material.forceSinglePass = true;

    const vS = varying(float(0.0), 'vFallS');
    const vU = varying(float(0.0), 'vFallU');
    const vTau = varying(float(0.0), 'vFallTau');
    const vFall = varying(float(0.0), 'vFallId');
    const vKind = varying(float(0.0), 'vFallKind');
    const vFlow = varying(float(0.0), 'vFallFlow');
    const vWorld = varying(vec3(0.0), 'vFallWorld');
    const vReveal = varying(float(0.0), 'vFallReveal');

    material.positionNode = Fn(() => {
        const g = positionLocal;
        const id = int(g.x);
        const s = g.y;
        const u = g.z;
        const r0 = U.falls.element(id.mul(3));
        const r1 = U.falls.element(id.mul(3).add(1));
        const r2 = U.falls.element(id.mul(3).add(2));
        const dur = r2.y;
        // Unrolling: a sheet that began recently has fallen only so far.
        const age = max(U.waterClock.sub(r2.w), 0.0);
        const drawn = min(dur, age);
        const t = s.mul(drawn).toVar();
        const dir = vec3(r1.x, 0.0, r1.y);
        const v0 = r1.z;
        const P = r0.xyz.add(dir.mul(v0.mul(t))).add(vec3(0.0, float(-0.5 * G).mul(t).mul(t), 0.0)).toVar();
        const vel = dir.mul(v0).add(vec3(0.0, float(-G).mul(t), 0.0));
        const toCam = normalize(cameraPosition.sub(P));
        const across = normalize(cross(normalize(vel.add(vec3(0.0, -1e-3, 0.0))), toCam));
        // The hush and the pour change the flow; width follows it.
        const flow = r2.z.mul(U.flow.y);
        const width = r1.w.add(r2.x.mul(t)).mul(flow.mul(0.5).add(0.5));
        // The T-spin wrings the sheet: a half-turn travelling down at water speed.
        const wring = U.wring.y.mul(exp(t.sub(U.waterClock.sub(U.wring.x)).div(0.6).pow2().negate())).mul(3.1416);
        const side = across.mul(wring.cos());
        const live = smoothstep(0.0, 0.05, dur).mul(smoothstep(0.0, 0.02, flow));
        P.addAssign(side.mul(u.mul(width).mul(0.5)).mul(live));
        // Dormant slots collapse onto their lip (drawn from frame 0, zero area).
        vS.assign(s);
        vU.assign(u);
        vTau.assign(t);
        vFall.assign(g.x);
        vKind.assign(r0.w);
        vFlow.assign(flow.mul(live));
        vWorld.assign(P);
        vReveal.assign(drawn.div(max(dur, 1e-3)));
        return P;
    })();

    material.colorNode = Fn(() => {
        const { light } = U;
        const s = vS;
        const u = vU;
        const tau = vTau;
        const kind = vKind;
        const P = vWorld;
        const toEye = cameraPosition.sub(P);
        const dist = length(toEye);
        const V = toEye.div(dist);
        // Streaks run down at the water's own speed: the pattern is written in travel time.
        const stream = tau.sub(U.waterClock).toVar();
        // Horsetails and hairlines are threads: streaky from their lips, never a solid bar.
        const thread = smoothstep(0.4, 0.6, kind).toVar();
        // Streaks drawn out along the flow (about 15:1): water falls in ropes, not blotches.
        const along = vec2(u.mul(mix(float(3.0), float(1.2), thread)).add(vFall.mul(0.37)), stream.mul(0.4));
        const n1 = texture(tex.noise, along.mul(vec2(1.0, 1.0))).r;
        const n2 = texture(tex.noise, along.mul(vec2(2.7, 1.9)).add(0.31)).a;
        const n3 = texture(tex.noise, vec2(u.mul(0.35).add(vFall.mul(0.13)), stream.mul(0.12))).g;
        const streak = n1.mul(0.6).add(n2.mul(0.4)).toVar();
        // The sheet frays: edges first, then (a third of the way down) into horsetails, then into
        // a skirt of mist that is mostly air by two thirds of the way.
        const edge = float(1.0).sub(smoothstep(0.35, 1.0, abs(u).add(n3.sub(0.5).mul(0.4))));
        const breakAt = mix(float(0.3), float(0.12), smoothstep(0.5, 2.5, kind));
        const fray = smoothstep(breakAt, 0.9, s).toVar();
        const strands = smoothstep(fray.mul(0.7).add(0.2), fray.mul(0.7).add(0.46), streak);
        const tail = float(1.0).sub(smoothstep(0.55, 1.0, s));
        const head = smoothstep(0.0, 0.02, s);
        const threads = mix(float(1.0), smoothstep(0.32, 0.64, streak.add(n3.mul(0.3))), thread);
        // Threads are gone by 60 % of the way; a sheet thins to a veil of spray.
        const fade = mix(float(1.0).sub(smoothstep(0.3, 0.95, s).mul(0.8)), float(1.0).sub(smoothstep(0.2, 0.6, s)), thread);
        const density = edge.mul(mix(float(1.0), strands, fray)).mul(threads).mul(tail).mul(head)
            .mul(fade)
            .mul(vFlow)
            .toVar();
        const sheetAlpha = clamp(density.mul(mix(float(0.95), float(0.5), fray)).mul(mix(float(1.0), float(0.55), thread)), 0.0, 1.0).toVar();

        // Front-lit white water: the key from behind the eye (water whitens it), the sky as ambient,
        // a white core down the middle of the sheet.
        const keyLight = mix(vec3(luma(light.key)), light.key, 0.5).mul(U.keyGain).mul(0.6);
        const ambient = skyBase(vec3(0.0, 1.0, 0.0), U).mul(0.5);
        const core = exp(u.mul(u).mul(-5.0)).mul(float(0.45).sub(fray.mul(0.35))).add(0.85);
        // Streaks: bright ropes of water and darker, thinner water between them.
        const ropes = smoothstep(0.45, 0.7, streak);
        const white = keyLight.mul(ropes.mul(0.75).add(0.45)).mul(core).add(ambient.mul(ropes.mul(0.4).add(0.6))).toVar();
        // The surge fronts and the coloured release ribbons ride down at water speed.
        const tint = vec3(0.0).toVar();
        const tintAmt = float(0.0).toVar();
        const best = float(0.0).toVar();
        const lift = float(0.0).toVar();
        Loop({
            start: int(0), end: int(U.counts.x), type: 'int', condition: '<',
        }, ({ i }) => {
            const a = U.packets.element(i.mul(2));
            const b = U.packets.element(i.mul(2).add(1));
            const mine = float(1.0).sub(smoothstep(0.0, 0.5, abs(a.x.sub(vFall))));
            // Where the packet's middle is now, in travel time from the lip.
            const at = U.waterClock.sub(a.y);
            // It comes over the lip rather than appearing at it.
            const band = exp(tau.sub(at).div(max(a.z, 0.05)).pow2().negate()).mul(mine).mul(a.w)
                .mul(smoothstep(0.0, max(a.z, 0.05), at));
            const isSurge = b.w;
            const colourBand = band.mul(float(1.0).sub(isSurge));
            // Each stretch of water carries ONE colour, the strongest there (never an average).
            tint.assign(select(colourBand.greaterThan(best), b.xyz, tint));
            best.assign(max(best, colourBand));
            tintAmt.addAssign(colourBand);
            lift.addAssign(band.mul(isSurge));
        });
        const ribbon = clamp(tintAmt, 0.0, 1.0);
        // The colour rides the water: its ropes stay, lit in the colour.
        const colour = mix(white, white.dot(vec3(0.2126, 0.7152, 0.0722)).mul(tint).mul(1.8), ribbon.mul(0.75)).toVar();
        colour.mulAssign(float(1.0).add(lift.mul(0.8)));
        // A little of the air between, as the stone has.
        const air = float(1.0).sub(exp(dist.div(-2600.0)));
        colour.assign(mix(colour, horizonHaze(V.negate(), U), min(air, 0.9)));
        const alpha = clamp(sheetAlpha.add(ribbon.mul(0.3).mul(density)), 0.0, 1.0);
        return vec4(colour.mul(alpha), alpha);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'sky-children-falls';
    mesh.frustumCulled = false;
    mesh.renderOrder = 55;
    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

/**
 * Write a fall's rows into the table (the world calls this when a layout places the isles, and
 * for the dynamic sheets as they are poured).
 */
export function writeFall(table, slot, {
    lip, dir, v0 = 3, width = 10, spread = 0.6, duration = 9, flow = 1, kind = FALL_KIND.sheet, bornAt = -1e4,
}) {
    const rows = table.array;
    const l = Math.hypot(dir[0], dir[1]) || 1;
    rows[slot * 3].set(lip[0], lip[1], lip[2], kind);
    rows[slot * 3 + 1].set(dir[0] / l, dir[1] / l, v0, width);
    rows[slot * 3 + 2].set(spread, duration, flow, bornAt);
}

/** Collapse a slot (dormant: zero duration). */
export function clearFall(table, slot) {
    const rows = table.array;
    rows[slot * 3].set(0, -1e5, 0, 0);
    rows[slot * 3 + 1].set(0, 1, 0, 0);
    rows[slot * 3 + 2].set(0, 0, 0, -1e4);
}

export { dot };
