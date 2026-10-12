/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sky Children — Irisfall: every fall in ONE draw.
 *
 * A merged set of meshes, one per fall, each only as fine as its fall needs: the Mother Fall off
 * the Spring Isle's shoulder (the brightest white in the frame, and nearly all the triangles), the
 * broken span's fall off the Twin Isle's aqueduct, the Twin Isle's horsetails, hairlines on the far
 * isles, and the Far Gate's spillway. Each vertex carries (fall, s along it, u across it); the
 * vertex stage reads the fall's rows in `U.falls` and puts it on its ballistic curve
 * (x = v0·t, y = −½·g·t²), widening as it falls.
 *
 * A curtain (the Mother, the span, the spillway) hangs in the world, not toward the eye: across
 * its lip's tangent, its section an arc that bulges toward the eye with the flanks falling back
 * (turning to the eye only as it goes edge-on), so it has a face, a normal and form: lit white on
 * the side that turns to the sun behind us, the sky's blue in the flank that turns away. Over the
 * lip it is still glass (the pool's jade under the sky's reflection), then it breaks white with a
 * crest of foam. Its water runs in ropes, comets of water riding them that lengthen as they
 * accelerate (written in travel time), its edges peel into fingers, and its life is told on
 * screen: the world solves where the frame's lower edge cuts the fall and schedules the sheet's
 * break into horsetails, then into mist, against that, so every layout sees the whole story. A
 * thread (a horsetail, a hairline) faces the eye and never draws thinner than a pixel or so (its
 * coverage goes to alpha instead), its strands fanning apart as it falls and sway in the wind.
 *
 * Frayed water and threads carry the bow (the drops make it; the sheet does not just dim the sky's
 * bow behind it), the grotto's warmth glows through the curtain at night, and the coloured packets
 * a clear releases ride down as dye in the water, white-hot jets showing through.
 *
 * Premultiplied over, depth-tested, no depth write; drawn after the stone, before the sky.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, abs, cameraPosition, clamp, cos, cross, dot, exp, float, floor, fract, fwidth, int, length, max, min, mix,
    normalize, positionLocal, reflect, select, sin, smoothstep, texture, uniformArray, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { FALL_SWAY, G, WATER_WRAP } from './sky-children-core.js';
import {
    bowStrokes, horizonHaze, luma, optics, scHash21, scMax3, skyBase,
} from './sky-children-tsl.js';

/** The falls' slots: the Mother, the span, the Twin's three horsetails, four hairlines, the spillway. */
export const FALL_SLOT = Object.freeze({
    mother: 0, span: 1, horse: 2, hair: 5, spillway: 9,
});
/** The Twin Isle's horsetails, and the far isles' hairlines at most. */
export const HORSETAILS = 3;
export const HAIRLINES = 4;
export const FALL_SLOTS = 10;
/** Packets riding the falls at once (coloured release ribbons, surge fronts). */
export const PACKET_SLOTS = 48;
/** Kinds of fall (the shader's look). */
export const FALL_KIND = Object.freeze({
    sheet: 0, horsetail: 1, hairline: 2, pour: 3,
});

/**
 * Rows per fall in `falls`: three at slot·3,
 *   0  lip.xyz, kind
 *   1  dir.x, dir.z (unit, horizontal), v0 (m/s), width (m at the lip)
 *   2  spread (width growth per second), duration (s of fall drawn), flow (0..2), bornAt (water
 *      clock when it began; a sheet unrolls from its lip from then)
 * and after every slot's three, its life at FALL_SLOTS·3 + slot (seconds of fall):
 *   3  breakT (the sheet breaks into horsetails), mistT (they go to mist), lipT (glass over the
 *      lip before it aerates; 0 none), form (a curtain's arc, radians; 0 a thread facing the eye)
 */
export function createFallTable() {
    return uniformArray(Array.from({ length: FALL_SLOTS * 4 }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4');
}

/** Packets (2 vec4): (fall, bornWater, width (s of travel), strength) (r, g, b, kind 0 colour/1 surge). */
export function createPacketTable() {
    return uniformArray(Array.from({ length: PACKET_SLOTS * 2 }, () => new THREE.Vector4(-1, 0, 0, 0)), 'vec4');
}

/**
 * Each slot's mesh on a tier: rows down it and columns across. The hero takes the columns (a
 * curved, lit curtain needs them); the span is sheet-lite; a thread needs two (its strands are
 * drawn in the shader), a far hairline fewer rows; slots the tier does not draw have none.
 */
export function fallMeshes(tier) {
    const R = tier.fallRows;
    const hair = Math.max(0, Math.min(HAIRLINES, tier.hairlineFalls ?? HAIRLINES));
    return Array.from({ length: FALL_SLOTS }, (_, f) => {
        if (f === FALL_SLOT.mother) return { rows: R, cols: tier.fallCols };
        if (f === FALL_SLOT.span) return { rows: Math.round(R * 0.6), cols: 3 };
        if (f < FALL_SLOT.hair) return { rows: Math.round(R * 0.5), cols: 2 };
        if (f < FALL_SLOT.spillway) return f - FALL_SLOT.hair < hair ? { rows: Math.round(R * 0.4), cols: 2 } : { rows: 0, cols: 0 };
        return { rows: Math.round(R * 0.75), cols: 6 };
    });
}

/** The merged meshes: (fall, s, u) per vertex; rows bunch a little toward the lip, where it turns. */
export function buildFallsGeometry(meshes) {
    const pos = [];
    const index = [];
    let base = 0;
    meshes.forEach(({ rows, cols }, f) => {
        if (rows < 2 || cols < 1) return;
        const across = cols + 1;
        for (let r = 0; r < rows; r++) {
            const s = (r / (rows - 1)) ** 1.2;
            for (let c = 0; c < across; c++) pos.push(f, s, (c / cols) * 2 - 1);
        }
        for (let r = 0; r < rows - 1; r++) {
            for (let c = 0; c < cols; c++) {
                const a = base + r * across + c;
                const b = a + 1;
                const d = a + across;
                const e = d + 1;
                index.push(a, d, b, b, d, e);
            }
        }
        base += rows * across;
    });
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
 * @param {object} p.tex     { noise, lut }
 */
export function createFalls({ tier, U, tex }) {
    const geometry = buildFallsGeometry(fallMeshes(tier));
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
    const vCover = varying(float(1.0), 'vFallCover');
    const vWorld = varying(vec3(0.0), 'vFallWorld');
    const vN = varying(vec3(0.0, 0.0, 1.0), 'vFallN');
    /** breakT, mistT, lipT, duration. */
    const vLife = varying(vec4(1.0), 'vFallLife');
    /** The sky the face reflects, and the sky overhead (the ambient), both per vertex. */
    const vSkyR = varying(vec3(0.0), 'vFallSkyR');
    const vAmb = varying(vec3(0.0), 'vFallAmb');
    // The bow's strokes where each vertex is seen (the stroke loops run per vertex, as the spray's).
    const vStrokes = varying(vec4(0.0), 'vFallStrokes');
    const vThread = varying(vec3(0.0), 'vFallThread');
    const vThread2 = varying(vec3(0.0), 'vFallThread2');

    material.positionNode = Fn(() => {
        const g = positionLocal;
        const id = int(g.x);
        const s = g.y;
        const u = g.z;
        const r0 = U.falls.element(id.mul(3));
        const r1 = U.falls.element(id.mul(3).add(1));
        const r2 = U.falls.element(id.mul(3).add(2));
        const r3 = U.falls.element(id.add(FALL_SLOTS * 3));
        const kind = r0.w;
        const dur = r2.y;
        // Unrolling: a sheet that began recently has fallen only so far.
        const age = max(U.waterClock.sub(r2.w), 0.0);
        const drawn = min(dur, age);
        const t = s.mul(drawn).toVar();
        const D = vec3(r1.x, 0.0, r1.y);
        const v0 = r1.z;
        // The lip's tangent, left of the heading (as fallSway() in the core counts it).
        const Wf = vec3(r1.y, 0.0, r1.x.negate());
        const wc = U.waterClock.mod(WATER_WRAP);
        // A horsetail sways in the wind; a curtain meanders, its lobes riding down at water speed
        // (the CPU's fallPoint() strays the same, so the spray stays seated on it).
        const isThread = float(1.0).sub(smoothstep(0.0, 0.5, abs(kind.sub(1.0))));
        const isSheet = float(1.0).sub(smoothstep(0.0, 0.5, kind));
        const ph = g.x.mul(1.7);
        const lobeX = t.sub(wc);
        const ramp = smoothstep(0.0, 1.5, t);
        const baseWidth = r1.w.add(r2.x.mul(t));
        const wave = sin(lobeX.mul(FALL_SWAY.lobes[0]).add(ph)).mul(0.6).add(sin(lobeX.mul(FALL_SWAY.lobes[1]).add(ph.mul(2.1))).mul(0.4));
        const sway = t.mul(t).mul(FALL_SWAY.thread).mul(sin(wc.mul(FALL_SWAY.rate).add(ph))).mul(isThread)
            .add(baseWidth.mul(FALL_SWAY.sheet).mul(ramp).mul(wave).mul(isSheet));
        const P = r0.xyz.add(D.mul(v0.mul(t))).add(vec3(0.0, float(-0.5 * G).mul(t).mul(t), 0.0)).add(Wf.mul(sway)).toVar();
        // (A dormant slot falls straight down under the eye: the cross products vanish there, so a
        // hair of x and of fall keep the normalise finite — a NaN times its zero width is still NaN.)
        const along = normalize(D.mul(v0).add(vec3(0.0, float(-G).mul(t).sub(1e-3), 0.0)));
        const toCam = normalize(cameraPosition.sub(P));
        const Wb = normalize(cross(along, toCam).add(vec3(1e-5, 0.0, 0.0)));
        // A curtain hangs across its lip, turning its width to the eye only as it goes edge-on (a
        // sheet seen side-on stays a sheet, never a line); a thread faces the eye.
        const form = r3.w;
        const curtain = smoothstep(0.0, 0.02, form);
        const Wa = select(dot(Wb, Wf).lessThan(0.0), Wb.negate(), Wb);
        const edgeOn = smoothstep(0.75, 0.95, abs(dot(Wf, toCam)));
        const W = normalize(mix(Wb, normalize(mix(Wf, Wa, edgeOn)), curtain)).toVar();
        // The sheet's face: up where it leaves the lip, outward once it falls.
        const N0 = normalize(cross(along, W).add(vec3(0.0, 1e-5, 0.0))).toVar();
        // The T-spin wrings the sheet: a half-turn about its own fall line travelling down at water
        // speed, so the curtain goes edge-on and turns its shade side to us.
        const wring = U.wring.y.mul(exp(t.sub(U.waterClock.sub(U.wring.x)).div(0.6).pow2().negate())).mul(3.1416);
        const cw = cos(wring);
        const swr = sin(wring);
        const Wr = W.mul(cw).add(N0.mul(swr));
        const Nr = N0.mul(cw).sub(W.mul(swr));
        // The hush and the pour change the flow; width follows it, and a curtain's lobes swell it.
        const flow = r2.z.mul(U.flow.y);
        const lobes = sin(lobeX.mul(FALL_SWAY.lobes[1] * 0.79).add(ph.mul(1.3))).mul(0.075).mul(ramp).mul(isSheet);
        const width = baseWidth.mul(flow.mul(0.5).add(0.5)).mul(lobes.add(1.0));
        const hw = width.mul(0.5);
        // Never thinner than a pixel or so: a thread stays whole, its true coverage carried in alpha.
        const half = max(hw, length(cameraPosition.sub(P)).mul(U.pixelAngle).mul(0.8));
        // The section: an arc (flatter over the lip, where it follows the rim's curve), its middle
        // toward the eye and its flanks falling back.
        const arc = max(form.mul(smoothstep(0.0, 1.2, t).mul(0.55).add(0.45)), 0.02);
        const phi = u.mul(arc);
        const k = half.div(sin(arc));
        // Dormant slots collapse onto their lip (drawn from frame 0, zero area).
        const live = smoothstep(0.0, 0.05, dur).mul(smoothstep(0.0, 0.02, flow));
        P.addAssign(Wr.mul(sin(phi).mul(k)).add(Nr.mul(cos(phi).sub(1.0).mul(k))).mul(live));
        const N = normalize(Nr.mul(cos(phi)).add(Wr.mul(sin(phi)))).toVar();
        const V = normalize(cameraPosition.sub(P));
        const Nv = select(dot(N, V).lessThan(0.0), N.negate(), N);
        vS.assign(s);
        vU.assign(u);
        vTau.assign(t);
        vFall.assign(g.x);
        vKind.assign(kind);
        vFlow.assign(flow.mul(live));
        vCover.assign(hw.div(max(half, 1e-4)));
        vWorld.assign(P);
        vN.assign(N);
        vLife.assign(vec4(r3.x, r3.y, r3.z, dur));
        vSkyR.assign(skyBase(reflect(V.negate(), Nv), U));
        vAmb.assign(skyBase(vec3(0.0, 1.0, 0.0), U));
        const thread = vec3(0.0).toVar();
        const thread2 = vec3(0.0).toVar();
        vStrokes.assign(bowStrokes(V.negate(), U, thread, thread2));
        vThread.assign(thread);
        vThread2.assign(thread2);
        return P;
    })();

    material.colorNode = Fn(() => {
        const { light } = U;
        const u = vU;
        const tau = vTau;
        const kind = vKind;
        const P = vWorld;
        const toEye = cameraPosition.sub(P);
        const dist = length(toEye);
        const V = toEye.div(dist);
        const breakT = max(vLife.x, 0.05);
        const mistT = max(vLife.y, breakT.add(0.05));
        const lipT = vLife.z;
        const dur = max(vLife.w, mistT.add(0.05));
        // Everything is written in travel time against the water clock wrapped at 50 s (every rate
        // and texture scale below is a whole number of turns or tiles in it): no precision lost
        // over a long sitting, nothing jumps at the wrap.
        const stream = tau.sub(U.waterClock.mod(WATER_WRAP)).toVar();
        // Horsetails and hairlines are threads (kinds 1 and 2); the rest are curtains.
        const thread = smoothstep(0.5, 0.7, kind).mul(float(1.0).sub(smoothstep(2.3, 2.5, kind))).toVar();
        const n3 = texture(tex.noise, vec2(u.mul(0.35).add(vFall.mul(0.13)), stream.mul(0.12))).g;
        const ne = texture(tex.noise, vec2(u.mul(1.5).add(vFall.mul(0.29)), stream.mul(0.6))).r;

        // The life, told in travel time: glass over the lip, a white sheet, horsetails, mist.
        const grow = clamp(tau.div(breakT), 0.0, 1.5);
        const fray = smoothstep(breakT.mul(0.8), mistT, tau.add(n3.sub(0.5).mul(breakT).mul(0.3))).toVar();
        const mist = smoothstep(mistT.mul(0.92), dur, tau).toVar();
        // Fingers peel off the edges as it falls: the flanks stretch apart, and the edge, nearly
        // straight over the lip, tears deeper the further it has fallen.
        const ue = u.div(float(1.0).add(smoothstep(0.55, 1.0, abs(u)).mul(0.45).mul(grow.mul(grow)))).toVar();
        const edgeAmp = mix(float(0.12), float(0.6), smoothstep(0.0, 1.0, grow));
        const edge = float(1.0).sub(smoothstep(mix(float(0.6), float(0.45), thread), 1.0, abs(ue).add(ne.sub(0.5).mul(edgeAmp)))).toVar();

        // Ropes: tubes of water across the sheet (three strands in a thread), each its own width
        // and brightness, wandering a little; darker, thinner water between them.
        const ropeN = mix(float(9.0), float(3.0), thread);
        const x = ue.mul(0.5).add(0.5).mul(ropeN).add(n3.sub(0.5).mul(0.8)).toVar();
        const rid = floor(x);
        const h1 = scHash21(vec2(rid, vFall));
        const h2 = scHash21(vec2(rid.add(7.31), vFall.add(2.0)));
        const h3 = scHash21(vec2(rid.mul(3.1).add(1.7), vFall.add(4.0)));
        const w = h1.mul(0.3).add(0.22);
        const tube = float(1.0).sub(smoothstep(w.mul(0.3), w, abs(fract(x).sub(0.5))));
        // Jets: comets of water riding each rope, the bright head downstream and the tail up the
        // fall. Written in travel time, they lengthen as the water accelerates (the still's cue
        // of speed and weight); each rope's rate is a whole number of turns per wrap.
        const rate = floor(h2.mul(0.4).add(0.9).mul(WATER_WRAP).add(0.5)).div(WATER_WRAP);
        const q = float(1.0).sub(fract(stream.mul(rate).add(h3)));
        const jet = smoothstep(0.0, 0.04, q).mul(exp(q.mul(-4.0)));
        // Seen too small to resolve (a thread a few pixels wide), a rope gives way to its mean.
        const resolve = float(1.0).sub(smoothstep(0.35, 0.9, fwidth(x)));
        const hot = tube.mul(jet).mul(resolve).toVar();
        const rope = mix(float(0.55), tube.mul(h2.mul(0.5).add(0.7)).mul(jet.mul(0.8).add(0.6)), resolve).toVar();
        // A finer weave between the ropes, for the close look (gone where it would alias).
        const x2 = ue.mul(0.5).add(0.5).mul(ropeN.mul(3.0)).add(n3.mul(2.3));
        const weave = float(1.0).sub(smoothstep(0.08, 0.42, abs(fract(x2).sub(0.5)).add(scHash21(vec2(floor(x2), vFall.add(9.0))).mul(0.12))));
        const fine = mix(float(0.5), weave, float(1.0).sub(smoothstep(0.3, 0.7, fwidth(x2))));
        const ropes = rope.mul(0.8).add(fine.mul(0.3)).toVar();

        // How much water: a whole sheet with thinner water between its ropes; breaking, the gaps
        // open and the ropes thin to horsetails; a thread is its strands; what is left goes to a
        // soft veil of mist that is mostly air, and fades with no hard end.
        const sheetD = mix(float(0.8), float(1.0), smoothstep(0.3, 0.9, ropes));
        const strandD = smoothstep(mix(float(0.3), float(0.55), fray), mix(float(0.7), float(0.95), fray), ropes);
        const waterD = mix(mix(sheetD, strandD, fray), smoothstep(0.25, 0.65, ropes), thread);
        const veilN = texture(tex.noise, vec2(u.mul(0.6).add(vFall.mul(0.41)), stream.mul(0.2))).b;
        const veil = smoothstep(0.15, 0.8, veilN).mul(0.5);
        const tail = float(1.0).sub(smoothstep(mistT, dur, tau));
        const head = smoothstep(0.0, 0.02, vS);
        const density = edge.mul(mix(waterD, veil, mist)).mul(tail).mul(head).mul(vFlow).toVar();
        // A curtain's flanks turn away from us: thinner there, as water seen at a slant is.
        const flank = mix(cos(u.mul(0.9)).mul(0.55).add(0.45), float(1.0), thread);
        const sheetAlpha = clamp(density.mul(mix(float(0.95), float(0.55), fray)).mul(mix(float(1.0), float(0.6), thread)).mul(flank), 0.0, 1.0).toVar();

        // Light: the key from behind the eye, wrapped round the curtain's form, white on the face
        // that turns to it; the flank that turns away takes the sky it reflects and the mist's
        // glow (blue, never grey); the ropes catch the most.
        const Nraw = normalize(vN);
        const N = select(dot(Nraw, V).lessThan(0.0), Nraw.negate(), Nraw).toVar();
        const wrapL = clamp(dot(N, U.key).mul(0.6).add(0.4), 0.0, 1.0);
        const keyLight = mix(vec3(luma(light.key)), light.key, 0.5).mul(U.keyGain).mul(0.6);
        const shade = mix(vSkyR, light.mistLit, 0.3).mul(0.8);
        const lit = keyLight.mul(wrapL).mul(ropes.mul(0.75).add(0.6));
        const dark = shade.mul(float(1.0).sub(wrapL).mul(0.85).add(0.15)).mul(ropes.mul(0.25).add(0.75));
        const white = lit.add(dark).add(vAmb.mul(0.3)).toVar();
        // The crest of foam where the glass breaks: the brightest white of the fall.
        const lipS = max(lipT, 0.05);
        const speck = texture(tex.noise, vec2(u.mul(6.0).add(vFall), stream.mul(1.5))).a;
        const crest = exp(tau.div(lipS).sub(1.2).div(0.3).pow2().negate()).mul(smoothstep(0.35, 0.75, speck).mul(0.7).add(0.3))
            .mul(smoothstep(0.0, 0.05, lipT));
        white.addAssign(keyLight.mul(crest).mul(0.4));
        // Over the lip the water is still glass: the pool's jade body under the sky it reflects
        // (more of the sky the flatter we see it), long smooth highlights along its ropes; it
        // aerates unevenly across the width.
        const fres = float(1.0).sub(max(dot(N, V), 0.0)).pow(5.0).mul(0.9).add(0.1);
        const body = light.water.mul(keyLight.mul(0.3).add(vAmb.mul(0.35)));
        const gloss = smoothstep(0.6, 0.95, rope).mul(keyLight).mul(0.3);
        const glass = mix(body, vSkyR, fres).add(gloss);
        const aer = smoothstep(0.5, 1.0, tau.div(lipS).add(n3.sub(0.5).mul(0.7))).toVar();
        const colour = mix(glass, white, aer).toVar();

        // The surge fronts and the coloured release ribbons ride down at water speed.
        const tintSum = vec3(0.0).toVar();
        const tintW = float(0.0).toVar();
        const dye = float(0.0).toVar();
        const lift = float(0.0).toVar();
        // Each rope carries the colour a moment early or late, the middle ahead of the edges: a
        // ragged chevron front, never a ruled line (and never so much that two stripes merge).
        const shift = n3.sub(0.5).mul(0.12).add(u.mul(u).mul(0.08));
        Loop({
            start: int(0), end: int(U.counts.x), type: 'int', condition: '<',
        }, ({ i }) => {
            const a = U.packets.element(i.mul(2));
            const b = U.packets.element(i.mul(2).add(1));
            const mine = float(1.0).sub(smoothstep(0.0, 0.5, abs(a.x.sub(vFall))));
            // Where the packet's middle is now, in travel time from the lip.
            const at = U.waterClock.sub(a.y);
            const wd = max(a.z, 0.05);
            const xx = tau.add(shift).sub(at).div(wd);
            // A sharp head downstream and a long tail behind it, as dye poured into running water.
            const band = exp(xx.mul(xx).mul(select(xx.greaterThan(0.0), float(-1.0), float(-0.16)))).mul(mine).mul(a.w)
                .mul(smoothstep(0.0, wd, at));
            const isSurge = b.w;
            const colourBand = band.mul(float(1.0).sub(isSurge));
            // Neighbours blend only at their seams: each stretch still shows one colour.
            const wgt = colourBand.mul(colourBand).mul(colourBand.mul(colourBand));
            tintSum.addAssign(b.xyz.mul(wgt));
            tintW.addAssign(wgt);
            dye.assign(max(dye, colourBand));
            lift.addAssign(band.mul(isSurge));
        });
        const ribbon = clamp(dye, 0.0, 1.0);
        const tint = tintSum.div(max(tintW, 1e-6));
        // Dye, not paint: the colour filters the water (the jets' heads stay white-hot) and glows
        // in the thinner water between the ropes.
        const hue = tint.div(max(scMax3(tint), 1e-3));
        const lum = luma(colour);
        colour.assign(colour.mul(mix(vec3(1.0), hue, ribbon.mul(float(0.85).sub(hot.mul(0.45))))));
        colour.addAssign(hue.mul(lum).mul(ribbon).mul(float(1.0).sub(rope.mul(0.6))).mul(0.45));
        colour.mulAssign(float(1.0).add(lift.mul(0.8)));
        // At night the grotto behind the Mother Fall's head glows through the thinner water.
        const m0 = U.falls.element(0);
        const m1 = U.falls.element(1);
        const grotto = m0.xyz.add(vec3(m1.x, 0.0, m1.y).mul(3.0)).sub(vec3(0.0, 12.0, 0.0));
        const gd = length(P.sub(grotto)).div(22.0);
        colour.addAssign(light.hearth.mul(U.hearth).mul(exp(gd.mul(gd).negate())).mul(float(1.0).sub(sheetAlpha.mul(0.6))).mul(0.9));
        // A little of the air between, as the stone has (water stays the brightest thing on a far isle).
        const air = float(1.0).sub(exp(dist.div(-2600.0)));
        colour.assign(mix(colour, horizonHaze(V.negate(), U), min(air, 0.75)));
        const alpha = clamp(sheetAlpha.add(ribbon.mul(0.3).mul(density)), 0.0, 1.0).mul(vCover).toVar();
        // The bow stands in the falling drops: the frayed water, the threads and the mist carry it
        // (the painted strokes, and at rest a promise of it), where the sheet would only dim the
        // sky's bow behind it.
        const drops = clamp(fray.mul(float(1.0).sub(sheetAlpha.mul(0.5))).add(thread.mul(0.5)).add(mist.mul(0.6)), 0.0, 1.0);
        const opt = optics(V.negate(), U, tex, {
            rain: float(1.0),
            deep: false,
            deepMist: float(0.0),
            rest: float(0.3),
            strokes: { masks: vStrokes, thread: vThread, thread2: vThread2 },
        }).xyz;
        return vec4(colour.mul(alpha).add(opt.mul(drops).mul(alpha).mul(1.4)), alpha);
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
 * for the spillway as it pours). `breakAt`/`mistAt` (s) schedule its life, `lipT` (s) the glass
 * over its lip, `form` (rad) a curtain's arc (0: a thread facing the eye).
 */
export function writeFall(table, slot, {
    lip, dir, v0 = 3, width = 10, spread = 0.6, duration = 9, flow = 1, kind = FALL_KIND.sheet, bornAt = -1e4,
    breakAt = duration * 0.45, mistAt = duration * 0.75, lipT = 0, form = 0,
}) {
    const rows = table.array;
    const l = Math.hypot(dir[0], dir[1]) || 1;
    rows[slot * 3].set(lip[0], lip[1], lip[2], kind);
    rows[slot * 3 + 1].set(dir[0] / l, dir[1] / l, v0, width);
    rows[slot * 3 + 2].set(spread, duration, flow, bornAt);
    rows[FALL_SLOTS * 3 + slot].set(breakAt, mistAt, lipT, form);
}

/** Collapse a slot (dormant: zero duration). */
export function clearFall(table, slot) {
    const rows = table.array;
    rows[slot * 3].set(0, -1e5, 0, 0);
    rows[slot * 3 + 1].set(0, 1, 0, 0);
    rows[slot * 3 + 2].set(0, 0, 0, -1e4);
    rows[FALL_SLOTS * 3 + slot].set(0, 0, 0, 0);
}
