/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Waves — the water: one sheet, from the sea in front of the wave across the trough, up the
 * face, over the roof and down the falling lip to its torn edge.
 *
 * The vertex stage folds a flat grid into the wave (waves-tsl.js `createWaveShape`), so the
 * barrel can open and close and a set wave can run through it without rebuilding anything.
 * The fragment stage shades it as glass:
 *
 *   ripples     three scales of the noise field's slope, carried along the flow (up the face
 *               and back toward the eye), drawn out along it into the long ribs a tube has;
 *   rings       each locked piece's refracting rings, added to the same slope;
 *   mirror      Fresnel reflection, traced once inside the tube: the face mirrors the eye of the
 *               barrel and the burning lip, the trough mirrors the roof;
 *   through     the sky behind the roof and the lip, bent by the ripples, dimmed and turned
 *               emerald by the thickness of water it crossed; the water's own scattered green
 *               where it is thick, brighter looking toward the sun;
 *   bars        the long soft bars of light the moving roof lets through onto the face;
 *   ribbons     each locked piece's colour, a comet the flow draws up and over;
 *   foam        the streaks drawn up the face, the boil where the lip comes down, the lip's
 *               white edge, torn into fingers.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, abs, cameraPosition, clamp, cos, cross, dot, exp, float, floor, fract, int, length, max, min, mix,
    normalize,
    positionGeometry, positionWorld, reflect, screenCoordinate, sin, smoothstep, texture, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { FLOW, WAVE } from './waves-core.js';
import {
    DEEP, FLOW_ACROSS, FLOW_ALONG, SCATTER, flowCoords, sheetThickness, skyBehind, transmit,
    tubeEnvironment, tubeTrace, wavesSky,
} from './waves-tsl.js';

/** Clear sweeps alive at once (each a band of light running down the tube). */
export const BAND_SLOTS = 4;
/**
 * A ribbon's light runs round the tube (u, metres of surface a second) far faster than the
 * water, and comes toward the eye (z) more slowly: a stroke over the roof, not a streak past it.
 */
export const RIBBON_VELOCITY = Object.freeze({ u: 2.5, z: 0.55 });
const RIBBON_PACE = Math.hypot(RIBBON_VELOCITY.u, RIBBON_VELOCITY.z);
/** How fast a ring's front spreads over the surface (metres a second). */
export const RING_SPEED = 1.25;
/** A band of light comes down the tube at this speed (metres a second), from this far ahead. */
export const BAND_SPEED = 11;
export const BAND_START = 24;

/**
 * The grid the vertex stage folds: x holds the row parameter (−1..0 the trough, 0..1 the wave),
 * z the world z of the column. Columns stand close near the eye and widen with distance.
 */
export function buildWaveGrid(tier) {
    const rows = [];
    for (let i = 0; i < tier.floorRows; i += 1) rows.push(-1 + i / tier.floorRows);
    for (let i = 0; i <= tier.arcRows; i += 1) rows.push(i / tier.arcRows);
    const columns = [];
    let d = -WAVE.backReach;
    let step = tier.nearStep;
    while (d < WAVE.aheadReach) {
        columns.push(-d);
        if (d > 24) step *= 1.075;
        d += step;
    }
    columns.push(-WAVE.aheadReach);
    const nr = rows.length;
    const nc = columns.length;
    const positions = new Float32Array(nr * nc * 3);
    for (let j = 0; j < nc; j += 1) {
        for (let i = 0; i < nr; i += 1) {
            const at = (j * nr + i) * 3;
            positions[at] = rows[i];
            positions[at + 1] = 0;
            positions[at + 2] = columns[j];
        }
    }
    const indices = new Uint32Array((nr - 1) * (nc - 1) * 6);
    let k = 0;
    for (let j = 0; j < nc - 1; j += 1) {
        for (let i = 0; i < nr - 1; i += 1) {
            const a = j * nr + i;
            const b = a + nr; // the next column: farther ahead
            const c = a + 1; // the next row: farther round the wave
            const e = b + 1;
            // Wound so the side the rider sees is the front.
            indices[k++] = a;
            indices[k++] = c;
            indices[k++] = b;
            indices[k++] = b;
            indices[k++] = c;
            indices[k++] = e;
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), WAVE.aheadReach * 1.5);
    return {
        geometry, rows, columns,
    };
}

/**
 * @param {object} p
 * @param {object} p.tier     quality tier
 * @param {THREE.Texture} p.noise
 * @param {object} p.U        shared uniforms (time, sun, warm, glow, ...)
 * @param {object} p.shape    createWaveShape()
 * @param {object} p.rows     { rings, ribbons, bands } uniform arrays; U.counts holds how many
 *                            rings (x) and ribbons (y) are alive
 */
export function createWater({
    tier, noise, U, shape, rows,
}) {
    const { geometry } = buildWaveGrid(tier);
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide, fog: false });
    material.name = 'waves-water';

    // ── Vertex: fold the grid into the wave ──
    const r = positionGeometry.x;
    const { z } = positionGeometry;
    const here = shape.point(r, z);
    // The trough rows look backward for their tangent, so the seam at the foot stays clean.
    const step = r.lessThan(0.0).select(float(-0.004), float(0.004));
    const beside = shape.point(r.add(step), z).position;
    const ahead = shape.point(r, z.add(0.06)).position;
    const tangentU = normalize(beside.sub(here.position).mul(step.sign()));
    const tangentZ = normalize(ahead.sub(here.position));
    const normal = normalize(cross(tangentZ, tangentU));
    material.positionNode = here.position;

    const vNormal = varying(normal, 'vWaveNormal');
    const vTangent = varying(tangentU, 'vWaveTangent');
    /** u (metres from the foot of the face), z, metres from the lip's edge, the lip's angle. */
    const vSurface = varying(vec4(here.u, z, here.lip.mul(WAVE.rho).sub(here.u), here.lip), 'vWaveSurface');

    // ── Fragment ──
    material.colorNode = Fn(() => {
        const sU = vSurface.x;
        const sZ = vSurface.y;
        const edge = vSurface.z;
        const lip = vSurface.w;
        const { time, sun, warm } = U;
        const phi = max(sU, 0.0).div(WAVE.rho).toVar();
        const P = positionWorld;
        const toEye = cameraPosition.sub(P).toVar();
        const dist = length(toEye).toVar();
        const V = toEye.div(dist).toVar();
        const N0 = normalize(vNormal).toVar();
        const TU = normalize(vTangent).toVar();
        const surface = vec2(sU, sZ).toVar();
        const across = vec2(...FLOW_ACROSS);
        const along = vec2(...FLOW_ALONG);
        const flowing = vec2(FLOW.u, FLOW.z);
        /** x across the flow, y along it: what the noise is read at. */
        const fc = flowCoords(surface, time).toVar();

        // ── The lip's torn edge ──
        const lace = texture(noise, vec2(fc.x.mul(0.62), fc.y.mul(0.085))).a.toVar();
        const torn = smoothstep(WAVE.lipCrest + 0.25, WAVE.lipClosed - 0.4, lip);
        const reach = mix(float(0.12), float(1.6), torn).mul(U.tear.mul(0.9).add(1.0));
        const frayed = texture(noise, vec2(fc.x.mul(2.3).add(0.21), fc.y.mul(0.31))).b;
        const cut = edge.sub(lace.mul(lace).mul(reach)).sub(frayed.sub(0.5).mul(reach).mul(0.22)).toVar();
        // The very edge is spray, not a line: it thins out grain by grain.
        const grain = fract(sin(dot(floor(screenCoordinate.xy), vec2(12.9898, 78.233))).mul(43758.5453));
        cut.lessThan(grain.mul(reach).mul(0.14)).discard();

        // ── Ripples: the slope of the surface in (u, z) ──
        const rib = texture(noise, vec2(fc.x.mul(0.4), fc.y.mul(0.052))).toVar();
        const fine = texture(noise, vec2(fc.x.mul(1.7).add(0.37), fc.y.mul(0.42).add(time.mul(0.03)))).toVar();
        const broad = texture(noise, fc.mul(0.085).add(vec2(0.5, time.mul(0.01)))).toVar();
        const g1 = rib.rg.sub(0.5);
        const g2 = fine.rg.sub(0.5);
        const g3 = broad.rg.sub(0.5);
        const slope = across.mul(g1.x.mul(0.95).add(g2.x.mul(0.4)).add(g3.x.mul(0.6)))
            .add(along.mul(g1.y.mul(0.13).add(g2.y.mul(0.1)).add(g3.y.mul(0.6))))
            .mul(U.ripple)
            .toVar();

        // ── Rings: a locked piece's refracting rings ──
        const ringGleam = float(0.0).toVar();
        Loop({
            start: int(0), end: int(U.counts.x), type: 'int', condition: '<', name: 'ring',
        }, ({ ring }) => {
            const row = rows.rings.element(ring);
            const age = time.sub(row.z);
            const centre = vec2(row.x, row.y).add(flowing.mul(age).mul(0.6));
            const away = surface.sub(centre);
            const radius = length(away).add(1e-3);
            const x = radius.sub(age.mul(RING_SPEED).add(0.1));
            const width = age.mul(0.3).add(0.24);
            const k = float(26.0).div(age.mul(0.5).add(1.0));
            const s = x.div(width);
            const envelope = exp(s.mul(s).negate()).mul(row.w)
                .mul(smoothstep(0.0, 0.06, age))
                .mul(exp(age.mul(-0.95)));
            slope.addAssign(away.div(radius).mul(envelope.mul(sin(x.mul(k))).mul(0.45)));
            // Each crest of the train is a thin line of light.
            const crest = max(cos(x.mul(k)), 0.0);
            const c2 = crest.mul(crest);
            ringGleam.addAssign(envelope.mul(c2.mul(c2)));
        });

        const N = normalize(N0.sub(TU.mul(slope.x)).sub(vec3(0.0, 0.0, 1.0).mul(slope.y))).toVar();
        const facing = clamp(dot(N, V), 0.0, 1.0);
        const m = float(1.0).sub(facing);
        const m2 = m.mul(m);
        // Moving water is a little rough: it mirrors more, and sooner, than still glass.
        const fresnel = m2.mul(m2).mul(0.965).add(0.035).toVar();
        const R = reflect(V.negate(), N).toVar();

        // ── The mirror ──
        const sharp = mix(float(0.5), float(0.04), smoothstep(14.0, 420.0, dist));
        const mirror = vec3(0.0).toVar();
        if (tier.trace >= 1) {
            // The ray starts inside the pipe the trace knows. The wall itself swells, bowls and
            // relaxes into the shoulder, so its own points can lie outside that pipe, where the
            // trace would take them for the sea in front of the curtain: a point of the wall is
            // drawn in toward the pipe's middle first.
            const off = vec2(P.x.div(WAVE.a), P.y.sub(WAVE.b).div(WAVE.b));
            const inward = min(float(1.0), float(0.965).div(max(length(off), 1e-3)));
            const pull = mix(float(1.0), inward, smoothstep(0.0, 0.25, phi));
            const from = vec3(P.x.mul(pull), P.y.sub(WAVE.b).mul(pull).add(WAVE.b), P.z);
            const hit = tubeTrace(from, R, shape.crest);
            mirror.assign(tubeEnvironment(hit, R, sun, sharp, warm));
        } else {
            mirror.assign(wavesSky(normalize(vec3(R.x, abs(R.y).add(0.02), R.z)), sun, sharp, warm)
                .mul(mix(0.35, 1.0, smoothstep(-0.2, 0.5, R.y.sub(R.x.mul(0.6))))));
        }

        // ── Light on the water: the bars of light the moving roof lets through, and a sweep of
        //    light when lines clear ──
        const net = float(0.0).toVar();
        if (tier.caustics) {
            // Light that came through the moving roof lands in long soft bars, drawn out along
            // the flow like everything else on the wall.
            const c1 = texture(noise, vec2(fc.x.mul(0.21).add(0.13), fc.y.mul(0.03).add(time.mul(0.012)))).b;
            const c2 = texture(noise, vec2(fc.x.mul(0.55), fc.y.mul(0.07).sub(time.mul(0.02)))).a;
            net.assign(smoothstep(0.42, 0.8, c1).mul(smoothstep(0.3, 0.75, c2)).mul(2.2));
        }
        const sweep = float(0.0).toVar();
        for (let i = 0; i < BAND_SLOTS; i += 1) {
            const row = rows.bands.element(i);
            const age = time.sub(row.x);
            // A band is a ring round the tube; twisted (a T-spin), it is a screw of light.
            const x = sZ.add(BAND_START).sub(age.mul(BAND_SPEED)).add(phi.mul(row.w)).div(max(row.z, 0.3));
            sweep.addAssign(exp(x.mul(x).negate()).mul(row.y).mul(smoothstep(0.0, 0.08, age)));
        }
        sweep.assign(min(sweep, 1.0));
        const sunFacing = clamp(dot(N0, sun).mul(0.55).add(0.45), 0.0, 1.0);
        // Water scatters what enters it: the lip throws no hard shadow into its body.
        const lightIn = vec3(0.8).mul(sunFacing).mul(net.mul(1.1).add(0.55))
            .add(vec3(0.9, 0.9, 0.7).mul(sweep).mul(net.mul(0.9).add(0.3)))
            .toVar();

        // ── Through the water ──
        const thin = skyBehind(phi).toVar();
        const tau = mix(float(DEEP), sheetThickness(cut), thin);
        const through = transmit(tau).toVar();
        const bend = normalize(V.negate().add(N.sub(N0).mul(0.8)));
        const behind = wavesSky(bend, sun, float(0.6), warm);
        const forward = clamp(dot(V.negate(), sun), 0.0, 1.0);
        const f2 = forward.mul(forward);
        const f6 = f2.mul(f2).mul(f2);
        // Under the roof there is less water overhead and more light in it; out in front of
        // the wave the sea lies open to the whole sky.
        const outside = float(1.0).sub(smoothstep(-5.0, -0.6, sU));
        const lift = max(smoothstep(0.3, 2.6, phi).mul(0.75).add(0.25), outside.mul(0.85));
        const ambient = vec3(0.3, 0.4, 0.5).mul(lift);
        // The water is not one thickness of one stuff: it is drawn out in bands along the flow.
        const bands = rib.b.mul(0.85).add(broad.b.mul(0.5)).add(0.38);
        const own = vec3(...SCATTER).mul(ambient.add(lightIn.mul(f6.mul(2.4).add(0.95))))
            .mul(bands)
            .mul(U.glow.mul(0.6).add(1.0));
        const body = through.mul(behind).mul(thin).add(vec3(1.0).sub(through).mul(own)).toVar();
        // The falling lip is full of air: milky, and lit from behind.
        const milk = float(1.0).sub(smoothstep(0.0, 5.0, cut)).mul(torn).mul(lace.mul(0.5).add(0.45));
        const falling = texture(noise, vec2(fc.x.mul(1.1).add(0.4), fc.y.mul(0.045))).a.mul(0.9).add(0.4);
        const milky = vec3(0.3, 0.74, 0.7).mul(ambient.mul(0.9).add(behind.mul(0.2)).add(lightIn.mul(0.3)))
            .mul(falling);
        body.assign(mix(body, milky, milk.mul(0.5)));

        // ── Ribbons: a locked piece's colour, drawn up and over by the flow ──
        const ribbon = vec3(0.0).toVar();
        Loop({
            start: int(0), end: int(U.counts.y), type: 'int', condition: '<', name: 'comet',
        }, ({ comet }) => {
            const head = rows.ribbons.element(comet.mul(2));
            const tint = rows.ribbons.element(comet.mul(2).add(1));
            const age = time.sub(head.z);
            const at = vec2(head.x, head.y).add(vec2(RIBBON_VELOCITY.u, RIBBON_VELOCITY.z).mul(age));
            const rel = surface.sub(at);
            const a = dot(rel, vec2(RIBBON_VELOCITY.u / RIBBON_PACE, RIBBON_VELOCITY.z / RIBBON_PACE));
            const c = dot(rel, vec2(-RIBBON_VELOCITY.z / RIBBON_PACE, RIBBON_VELOCITY.u / RIBBON_PACE));
            // A sharp nose, a long tail back toward where the piece went in.
            // As broad on screen far down the tube as beside the eye.
            const scale = dist.mul(0.085).add(0.2);
            const nose = a.div(scale.mul(0.5));
            const tail = a.div(tint.w.add(age.mul(2.2)));
            const body1 = exp(mix(tail.mul(tail), nose.mul(nose), smoothstep(-0.05, 0.05, a)).negate());
            const w = c.div(age.mul(0.05).add(0.1).mul(scale));
            const life = smoothstep(0.0, 0.1, age).mul(exp(age.mul(-0.36))).mul(head.w);
            const stroke = body1.mul(exp(w.mul(w).negate()));
            // Its heart burns toward white.
            ribbon.addAssign(tint.rgb.mul(stroke).add(vec3(stroke.mul(stroke).mul(stroke).mul(0.2))).mul(life));
        });
        const threads = rib.b.mul(0.9).add(lace.mul(0.6)).add(0.35);

        // ── Foam ──
        // Threads of foam drawn up the face: fine, and never a sheet.
        const streak = texture(noise, vec2(fc.x.mul(3.6), fc.y.mul(0.045))).b;
        const thread = texture(noise, vec2(fc.x.mul(7.5).add(0.7), fc.y.mul(0.06))).a;
        // Each thread starts and ends, and they come in loose skeins, not as a comb.
        const dash = texture(noise, vec2(fc.x.mul(0.8).add(0.3), fc.y.mul(0.19))).b;
        const skein = smoothstep(0.5, 0.72, broad.a).mul(smoothstep(0.38, 0.62, dash));
        const lines = smoothstep(0.7, 0.84, streak).mul(0.6).add(smoothstep(0.72, 0.84, thread).mul(0.45)).mul(skein);
        const low = float(1.0).sub(smoothstep(0.9, 3.3, phi));
        // Where the lip comes down on the trough.
        const down = smoothstep(4.7, 5.7, lip);
        const fromLanding = sU.sub(sin(lip).mul(WAVE.a)).div(1.5);
        const boil = exp(fromLanding.mul(fromLanding).negate()).mul(down)
            .mul(float(1.0).sub(smoothstep(0.0, 0.5, phi)))
            .mul(broad.b.mul(0.9).add(0.45));
        const white = float(1.0).sub(smoothstep(0.0, reach.mul(0.3).add(0.2), cut)).mul(0.5);
        const foam = clamp(lines.mul(low).mul(0.75).add(boil).add(white.mul(thin)), 0.0, 1.0).toVar();
        const foamLight = ambient.mul(0.9).add(vec3(0.16, 0.2, 0.24))
            .add(min(lightIn, vec3(1.4)).mul(vec3(0.95, 0.92, 0.8)).mul(0.7))
            .add(through.mul(behind).mul(thin).mul(0.3));
        const foamColour = vec3(0.8, 0.93, 0.91).mul(foamLight);

        // ── Compose ──
        const colour = body.mul(float(1.0).sub(fresnel)).add(mirror.mul(fresnel)).toVar();
        // Every ripple has a side turned to the evening and a side turned away.
        const relief = clamp(dot(N.sub(N0), sun).mul(2.6), -1.0, 1.0);
        colour.mulAssign(float(1.0).sub(max(relief.negate(), 0.0).mul(0.42)));
        colour.addAssign(vec3(1.0, 0.66, 0.34).mul(max(relief, 0.0)).mul(0.085)
            .mul(lift.mul(0.6).add(0.4)));
        colour.assign(mix(colour, foamColour, foam));
        colour.addAssign(ribbon.mul(threads).mul(thin.mul(0.7).add(0.7)).mul(1.5));
        colour.addAssign(vec3(0.72, 1.0, 0.94).mul(ringGleam).mul(0.075));
        // A clear's band of light, caught on every rib of the wall: gold where the water is thin
        // and the evening comes through it, the sea's own green where it is deep.
        colour.addAssign(mix(vec3(0.5, 0.95, 0.8), vec3(1.0, 0.8, 0.46), thin).mul(sweep)
            .mul(net.mul(0.5).add(rib.b.mul(0.3)).add(0.1))
            .mul(thin.mul(0.7).add(0.55))
            .mul(0.5));
        // The far water goes into the evening haze.
        const haze = wavesSky(normalize(vec3(V.x.negate(), 0.012, V.z.negate())), sun, float(0.0), warm);
        colour.assign(mix(colour, haze, float(1.0).sub(exp(dist.mul(-1 / 420)))));
        return vec4(colour, 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'waves-water';
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    return {
        mesh,
        material,
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
