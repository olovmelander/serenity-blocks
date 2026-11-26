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
 *   through     the sky behind the roof and the lip, bent by the ripples, dimmed and coloured
 *               by the thickness of water it crossed; the water's own scattered colour where
 *               it is thick, brighter looking toward the sun. Sky and water are the hour's
 *               (U.light): emerald at golden hour, sapphire under the moon;
 *   bars        the long soft bars of light the moving roof lets through onto the face;
 *   heat        hot play (U.heat, 0 at rest): the bands of light come down a little brighter and
 *               may add up further where they overlap (one multiply, one clamp);
 *   ribbons     each locked piece's colour, a comet the flow draws up and over;
 *   foam        the lace drawn up the face; the lip's white edge, torn into fingers where it
 *               falls and whole where it has landed (a curtain of white water standing on the
 *               sea); the carpet of white water on the sea along the line it lands on. The white
 *               water that stands in the air there is waves-whitewater.js.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, Loop, abs, cameraPosition, clamp, cos, cross, dot, exp, float, int, length, max, min, mix,
    normalize,
    positionGeometry, positionWorld, reflect, sin, smoothstep, texture, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { FLOW, WAVE } from './waves-core.js';
import {
    DEEP, FLOW_ACROSS, FLOW_ALONG, flowCoords, sheetThickness, skyBehind, transmit, tubeEnvironment, tubeTrace,
    wavesSky,
} from './waves-tsl.js';

/**
 * Clear sweeps alive at once (each a band of light running down the tube): enough that a cascade
 * or a quick chain never takes one still on its way (a new band takes the one furthest down).
 */
export const BAND_SLOTS = 8;
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
 * The lip lands over this much of its arc (radians short of where it has closed), and a landed
 * lip keeps this share of its tears closed: the rain that leaves its edge reads the same two.
 */
export const LANDING_ARC = 0.5;
export const LANDED_WHOLE = 0.88;

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
 * @param {THREE.Texture} p.lace     the field of foam cells (waves-tsl.js createFoamLace)
 * @param {object} p.U        shared uniforms (time, sun, warm, glow, ..., light: the hour's colours)
 * @param {object} p.shape    createWaveShape()
 * @param {object} p.rows     { rings, ribbons, bands } uniform arrays; U.counts holds how many
 *                            rings (x) and ribbons (y) are alive
 */
export function createWater({
    tier, noise, lace: cells, U, shape, rows,
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
        const {
            time, sun, warm, light,
        } = U;
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

        // ── The water's noise, read once for everything below ──
        // The flow draws the wall's ripples out into ribs, but only three or four to one: drawn
        // out further (8:1, and tilted only across the flow) every rib became a hairline and the
        // face read as a long exposure, not as glass. From High up a fine chop near the eye gives
        // the glass its glitter (one read more on a full-screen material: the tiers below skip it).
        const glass = tier.noise >= 512;
        const rib = texture(noise, vec2(fc.x.mul(0.4), fc.y.mul(0.11))).toVar();
        const fine = texture(noise, vec2(fc.x.mul(1.9).add(0.37), fc.y.mul(0.7).add(time.mul(0.03)))).toVar();
        const broad = texture(noise, fc.mul(0.085).add(vec2(0.5, time.mul(0.01)))).toVar();
        const chop = glass
            ? texture(noise, vec2(fc.x.mul(4.6).add(0.13), fc.y.mul(2.9).sub(time.mul(0.05)))).toVar()
            : null;

        // ── The lip's torn edge ──
        // Lobes and tongues a hand to an arm long (not icicles: the tears are drawn out along the
        // flow only about three to one), frayed finer at their tips.
        const lace = texture(noise, vec2(fc.x.mul(0.62), fc.y.mul(0.2))).a.toVar();
        const torn = smoothstep(WAVE.lipCrest + 0.25, WAVE.lipClosed - 0.4, lip);
        // Where the lip has come down it is a curtain that stands on the sea: the tears close as
        // it lands (torn all the way down, everything the eye sees of the lip on its left was
        // inside the tears: scraps of water hanging in the air over a flat sea).
        const landed = smoothstep(WAVE.lipClosed - LANDING_ARC, WAVE.lipClosed - 0.04, lip).toVar();
        const reach = mix(float(0.12), float(1.6), torn).mul(U.tear.mul(0.9).add(1.0))
            .mul(float(1.0).sub(landed.mul(LANDED_WHOLE)))
            .toVar();
        const frayed = texture(noise, vec2(fc.x.mul(2.3).add(0.21), fc.y.mul(0.8))).b;
        const cut = edge.sub(lace.mul(lace).mul(reach)).sub(frayed.sub(0.5).mul(reach).mul(0.3)).toVar();
        // The very edge is spray, not a line: a fine lace of holes and drops (a grain of the
        // noise, not of the screen, so it stays on the water as it moves), and the last of it is
        // cut by coverage, not by a pixel's yes or no (alphaToCoverage under MSAA).
        const spray = glass ? chop.a : fine.a;
        const edgeAlpha = smoothstep(0.0, reach.mul(0.14).add(0.03), cut.sub(spray.sub(0.35).mul(reach).mul(0.16)))
            .toVar();

        // ── Ripples: the slope of the surface in (u, z) ──
        const g1 = rib.rg.sub(0.5);
        const g2 = fine.rg.sub(0.5);
        const g3 = broad.rg.sub(0.5);
        const slope = across.mul(g1.x.mul(0.8).add(g2.x.mul(0.42)).add(g3.x.mul(0.6)))
            .add(along.mul(g1.y.mul(0.34).add(g2.y.mul(0.26)).add(g3.y.mul(0.6))))
            .toVar();
        if (glass) {
            const g4 = chop.rg.sub(0.5).mul(float(1.0).sub(smoothstep(8.0, 34.0, dist)));
            slope.addAssign(across.mul(g4.x.mul(0.3)).add(along.mul(g4.y.mul(0.24))));
        }
        slope.mulAssign(U.ripple);

        // Past the end of the tube, crossing swells lift broad patches of capillary water into
        // and out of the reflection. Their directions and periods are independent of the ribs.
        const openSea = smoothstep(3.5, 12, sU.negate()).mul(smoothstep(8, 28, dist)).toVar();
        const swellFace = float(0).toVar();
        If(openSea.greaterThan(0.001), () => {
            const rise = sin(dot(surface, vec2(0.17, 0.69)).add(time.mul(0.54)).add(broad.b.mul(1.4)));
            const crossSea = sin(dot(surface, vec2(-0.54, 0.21)).sub(time.mul(0.37)).add(broad.a));
            const resolved = float(1).sub(smoothstep(56, 200, dist));
            swellFace.assign(rise.mul(0.7).add(crossSea.mul(0.3)).mul(resolved));
            const amplitude = U.sea.z.mul(0.058).add(U.sea.w.mul(0.023)).add(0.034);
            slope.addAssign(vec2(crossSea.mul(0.62), rise).mul(openSea).mul(amplitude).mul(resolved));
        });

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
        // The trough and the sea lie flat: a ripple that tips a ray under the horizon would only
        // meet the next ripple, so their mirror always looks up (a ray let through drew the sea in
        // hard dark dashes a texel wide where it lies at a grazing angle).
        const level = smoothstep(0.8, 0.97, N0.y);
        const R0 = reflect(V.negate(), N);
        const R = normalize(mix(R0, vec3(R0.x, abs(R0.y).add(0.03), R0.z), level)).toVar();

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
            mirror.assign(tubeEnvironment(hit, R, sun, sharp, warm, light));
        } else {
            mirror.assign(wavesSky(normalize(vec3(R.x, abs(R.y).add(0.02), R.z)), sun, sharp, warm, light)
                .mul(mix(0.35, 1.0, smoothstep(-0.2, 0.5, R.y.sub(R.x.mul(0.6))))));
        }

        // ── Light on the water: the bars of light the moving roof lets through, and a sweep of
        //    light when lines clear ──
        const net = float(0.0).toVar();
        /** The refracted sun projected through two moving folds overhead. */
        const veins = float(0.0).toVar();
        if (tier.caustics) {
            // Project the receiving point back toward the light. A shaft stays coherent
            // across the roof and wall while the skin of the wave slides through it.
            const depth = float(2 * WAVE.b).sub(P.y);
            const roof = P.xz.add(sun.xz.mul(depth).mul(0.95));
            const aperture = vec2(
                roof.y.mul(0.062).add(roof.x.mul(0.11)),
                roof.x.mul(0.074).sub(roof.y.mul(0.018)),
            ).add(vec2(time.mul(-0.022), time.mul(0.008)));
            const shutter = texture(noise, aperture).ba.toVar();
            const warp = shutter.sub(0.5).mul(0.32);
            const lens = texture(noise, vec2(fc.x.mul(0.15), fc.y.mul(0.049)).add(warp)).ba.toVar();
            const shaft = smoothstep(0.34, 0.76, shutter.x.add(shutter.y.sub(0.5).mul(0.42))).toVar();
            net.assign(shaft.mul(shaft).mul(lens.y.mul(0.8).add(1.65)));
            // Two curved, converging wavefronts. Their meeting lights up briefly as a
            // cusp, while the lee side falls back into the body colour of the water.
            const folds = abs(lens.sub(vec2(0.51, 0.59)).add(warp.mul(0.4)));
            const threads = float(1.0).sub(smoothstep(0.018, 0.17, min(folds.x, folds.y)));
            veins.assign(threads.mul(threads).mul(shaft.mul(1.6).add(0.13)));
        }
        const sweep = float(0.0).toVar();
        Loop({
            start: int(0), end: int(U.counts.z), type: 'int', condition: '<', name: 'bandIndex',
        }, ({ bandIndex }) => {
            const row = rows.bands.element(bandIndex);
            const age = time.sub(row.x);
            // A band is a ring round the tube; twisted (a twist), it is a screw of light.
            const x = sZ.add(BAND_START).sub(age.mul(BAND_SPEED)).add(phi.mul(row.w)).div(max(row.z, 0.3));
            sweep.addAssign(exp(x.mul(x).negate()).mul(row.y).mul(smoothstep(0.0, 0.08, age)));
        });
        // Hot play lets the bands that overlap add up further (1 at rest: as they always were).
        sweep.assign(min(sweep, U.heat.mul(0.15).add(1.0)));
        const sunFacing = clamp(dot(N0, sun).mul(0.55).add(0.45), 0.0, 1.0);
        // Water scatters what enters it: the lip throws no hard shadow into its body.
        const lightIn = vec3(0.8).mul(sunFacing).mul(net.mul(1.1).add(0.55))
            .add(vec3(0.9, 0.9, 0.7).mul(sweep).mul(net.mul(0.9).add(0.3)))
            .mul(light.sunTint)
            .toVar();

        // ── Through the water ──
        const thin = skyBehind(phi).toVar();
        // A sheet seen at a slant is crossed on a longer path than it is thick: the lip and the roof
        // curving away from the eye are greener and darker than where they face it (seen square,
        // a thin lip passed almost the whole sky and read as pale milk).
        const slant = max(facing, 0.28);
        // Streaming sheets overlap, leaving clear jade windows between thicker folds.
        // The same thickness filters the sky and controls the scattered light inside it.
        const opticalDepth = broad.b.mul(0.85).add(rib.a.mul(0.35)).add(0.56);
        const tau = mix(float(DEEP), sheetThickness(cut).mul(1.65).mul(opticalDepth).div(slant), thin);
        const through = transmit(tau, light.absorb).toVar();
        const bend = normalize(V.negate().add(N.sub(N0).mul(0.8)));
        const behind = wavesSky(bend, sun, float(0.6), warm, light);
        const forward = clamp(dot(V.negate(), sun), 0.0, 1.0);
        const f2 = forward.mul(forward);
        const f6 = f2.mul(f2).mul(f2);
        // Under the roof there is less water overhead and more light in it; out in front of
        // the wave the sea lies open to the whole sky.
        const outside = float(1.0).sub(smoothstep(-5.0, -0.6, sU));
        const lift = max(smoothstep(0.3, 2.6, phi).mul(0.75).add(0.25), outside.mul(0.85));
        const ambient = vec3(0.3, 0.4, 0.5).mul(light.skyTint).mul(lift);
        // The water is not one thickness of one stuff: it is drawn out in bands along the flow
        // (gently: strong bands striped the face like a brushed sheet).
        const bands = rib.b.mul(0.36).add(broad.b.mul(0.64)).add(0.49);
        // The wall is thick at its foot and thin toward the roof: deep and blue low down, a
        // luminous jade higher up, where the light has less water to cross.
        const height = smoothstep(0.15, 2.5, phi);
        const depthTone = mix(vec3(0.56, 0.72, 1.13), vec3(1.68, 1.46, 0.9), height);
        const own = light.scatter.mul(ambient.add(lightIn.mul(f6.mul(2.4).add(0.95))))
            .mul(bands)
            .mul(depthTone)
            .mul(U.glow.mul(0.6).add(1.0))
            .toVar();
        // The caustic net: threads of light inside the glass, brightest on the wall under the
        // roof, fainter in the trough at its foot.
        const netZone = smoothstep(0.2, 1.05, phi).mul(float(1.0).sub(thin.mul(0.78)))
            .add(smoothstep(-7.0, -0.5, sU).mul(float(1.0).sub(smoothstep(0.0, 0.05, phi))).mul(0.3));
        own.addAssign(light.scatter.mul(light.sunTint).mul(vec3(2.3, 1.8, 0.96))
            .mul(veins.mul(netZone))
            .mul(sunFacing.mul(0.7).add(0.5))
            .mul(U.glow.mul(0.5).add(1.0)));
        const body = through.mul(behind).mul(thin).add(vec3(1.0).sub(through).mul(own)).toVar();
        // A thin sheet is not empty glass: the light crossing it is scattered on the way, so the
        // roof and the lip glow in the water's own colour, most where the sun stands behind them
        // (without it a thin roof only passed the sky's grey-violet and read as milk, not water).
        const sheet = float(1.0).sub(exp(tau.mul(-0.9))).mul(thin);
        body.addAssign(light.scatter.mul(light.sunTint).mul(sheet)
            .mul(f2.mul(2.6).add(sunFacing.mul(0.75)).add(0.28))
            .mul(bands)
            .mul(U.glow.mul(0.4).add(1.0)));
        // Looking up through the arch, folds of denser water eclipse the light.
        // One side of each fold catches the refracted sun. They curl with the
        // sheet and fade into the whitewater before the lip hits the trough.
        const arch = smoothstep(1.4, 2.75, phi).mul(float(1).sub(smoothstep(4.85, 5.78, phi)));
        const flutes = sin(sU.mul(1.18).sub(sZ.mul(0.65)).sub(time.mul(0.48))
            .add(broad.a.mul(2.2))
            .add(rib.b.mul(0.68))).toVar();
        const glassShadow = smoothstep(-0.45, 0.80, flutes).mul(arch).mul(0.40);
        body.mulAssign(vec3(1).sub(vec3(0.96, 0.67, 0.48).mul(glassShadow)));
        const litFold = float(1).sub(smoothstep(0.07, 0.44, abs(flutes.sub(0.18))));
        body.addAssign(mix(light.scatter.mul(vec3(2.0, 2.5, 1.35)), light.aureole.mul(0.58), f6.mul(0.73))
            .mul(arch).mul(litFold).mul(broad.b.mul(0.7).add(0.28))
            .mul(light.sunTint));
        // The falling lip is full of air: milky, and lit from behind.
        const milk = float(1.0).sub(smoothstep(0.0, 5.0, cut)).mul(torn).mul(lace.mul(0.5).add(0.45));
        const falling = texture(noise, vec2(fc.x.mul(1.1).add(0.4), fc.y.mul(0.045))).a.mul(0.9).add(0.4);
        const milky = vec3(0.3, 0.74, 0.7).mul(light.waterTint)
            .mul(ambient.mul(0.9).add(behind.mul(0.2)).add(lightIn.mul(0.3)))
            .mul(falling);
        body.assign(mix(body, milky, milk.mul(0.28)));

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
        // What the last wave's white water left on the sea, drawn up the face as lace: rings of
        // foam that open and stretch as they climb, in patches, and never a sheet (as long
        // hairlines they read as scratches on the glass beside the eye).
        const laceAt = vec2(fc.x.mul(0.42), fc.y.mul(0.13)).add(g3.mul(0.22)).add(g1.mul(0.05));
        const cell = texture(cells, laceAt).toVar();
        // A wall between two cells is a thread of foam; some cells have lost theirs, and the
        // finer cells fill the rafts where the lace is still thick.
        const whole = smoothstep(0.22, 0.42, cell.b);
        const wall = float(1.0).sub(smoothstep(0.015, 0.065, cell.r)).mul(whole);
        const fineWall = float(1.0).sub(smoothstep(0.03, 0.1, cell.g));
        const patches = smoothstep(0.5, 0.74, broad.a);
        const tornFilm = smoothstep(0.26, 0.67, rib.a.add(fine.b.sub(0.5).mul(0.53)));
        const lines = wall.mul(0.56).add(fineWall.mul(patches).mul(0.34)).add(cell.a.mul(patches).mul(0.28))
            .mul(patches.mul(0.9).add(0.10))
            .mul(tornFilm);
        // On the lower face, and on the trough near its foot: not out on the open sea.
        const low = float(1.0).sub(smoothstep(0.3, 1.9, phi)).mul(smoothstep(-11.0, -1.5, sU));
        // ── White water: where the lip comes down on the trough ──
        // A carpet of it on the sea along the line the lip lands on: whole and white at the line,
        // opening into bubbles and then into threads as the flow carries it across the floor of
        // the tube to the foot of the face (where the lace above takes it up the wall), and thrown
        // a little further out in front of the wave. It comes in surges, as the lip does.
        const fromLine = sU.sub(sin(lip).mul(WAVE.a)).toVar();
        const span = fromLine.greaterThan(0.0).select(float(1.3), float(2.1));
        const fromHeap = fromLine.div(span);
        const touched = smoothstep(WAVE.lipClosed - 0.3, WAVE.lipClosed - 0.03, lip);
        const surge = texture(noise, vec2(sZ.mul(0.06).add(time.mul(0.045)), time.mul(0.019))).b;
        const heap = exp(fromHeap.mul(fromHeap).negate()).mul(touched)
            .mul(float(1.0).sub(smoothstep(0.1, 0.6, phi)))
            .mul(surge.mul(0.55).add(0.72))
            .mul(U.sea.z.mul(0.3).add(0.85).add(U.heave.mul(0.3)))
            .mul(1.7)
            .add(broad.b.sub(0.5).mul(0.6))
            .add(rib.b.sub(0.5).mul(0.3))
            .toVar();
        // (Finer than the lace, and not drawn out so far: it is churned, not combed.)
        // (And bent by the water's heights at every scale: straight walls of even width read as
        // flagstones.)
        // (Cells a hand across, not a forearm: near the eye the larger ones read as cracked ice.)
        const frothAt = vec2(fc.x.mul(1.7), fc.y.mul(0.85)).add(g3.mul(0.34))
            .add(vec2(rib.b, rib.a).sub(0.5).mul(0.3))
            .add(vec2(fine.b, fine.a).sub(0.5).mul(0.08));
        const froth = texture(cells, frothAt).toVar();
        // And bubbles inside the bubbles: a field of cells three times finer again, so the holes
        // between the walls are lace, not open water cut out with scissors.
        const fizz = texture(cells, frothAt.mul(2.9).add(vec2(0.31, 0.57))).toVar();
        // The walls between its bubbles thicken until they meet: a sheet where it is heaped. No
        // two are one width, no hole is a polygon (its edge is eaten by the water's own noise),
        // and here and there a whole cell is still full of foam.
        const thick = clamp(heap.mul(0.3).add(0.03), 0.0, 0.55).mul(fine.a.mul(1.1).add(0.4));
        const ragged = fine.b.sub(0.5).mul(0.09).add(fizz.g.sub(0.25).mul(0.07));
        const raft = smoothstep(0.55, 0.76, froth.b).mul(smoothstep(0.4, 1.0, heap));
        const lacy = smoothstep(0.15, 0.7, heap).mul(smoothstep(0.35, 0.65, broad.a.add(fine.b.mul(0.3))));
        const bubbled = float(1.0).sub(smoothstep(thick.mul(0.35), thick, froth.r.add(ragged)))
            .add(float(1.0).sub(smoothstep(thick.mul(0.3), thick.mul(0.85), froth.g)).mul(0.45))
            .add(float(1.0).sub(smoothstep(0.03, 0.12, fizz.g)).mul(lacy).mul(0.75))
            .add(froth.a.mul(0.25))
            .add(raft.mul(fine.b.mul(0.5).add(0.5)));
        // Where it is heaped it is a sheet with pinholes, not a flat white.
        const pinholes = smoothstep(0.55, 0.9, fizz.a).mul(0.55);
        const carpet = max(
            smoothstep(0.85, 1.25, heap).mul(float(1.0).sub(pinholes)),
            smoothstep(0.3, 0.8, heap).mul(clamp(bubbled, 0.0, 1.0)),
        ).toVar();
        // The landed lip is a fall of water full of air: white in the long streaks of the fall,
        // whole and white where it stands on the sea.
        const fallen = float(1.0).sub(smoothstep(0.0, 2.6, edge)).mul(landed);
        const strand = texture(noise, vec2(fc.x.mul(6.5).add(0.4), fc.y.mul(0.24)));
        const streaks = smoothstep(0.22, 0.8, strand.a.mul(0.45).add(strand.b.mul(0.3)).add(fine.b.mul(0.25)));
        // (Streaked, never striped: the white between two strands is thinner, not gone.)
        const pour = fallen.mul(fallen).mul(streaks.mul(0.5).add(0.42))
            .add(float(1.0).sub(smoothstep(0.0, 0.4, edge)).mul(landed).mul(streaks.mul(0.3).add(0.5)));
        const white = float(1.0).sub(smoothstep(0.0, reach.mul(0.16).add(0.12), cut)).mul(0.4);
        // (How much lace the sea carries, and how hard its landing boils, are the sea's own state.)
        const churned = clamp(carpet.add(pour.mul(thin)), 0.0, 1.0).toVar();
        const foam = clamp(
            lines.mul(low).mul(U.sea.x.mul(0.4).add(0.22))
                .add(churned)
                .add(white.mul(thin)),
            0.0,
            1.0,
        ).toVar();
        const foamLight = ambient.mul(0.9).add(vec3(0.16, 0.2, 0.24).mul(light.skyTint))
            .add(min(lightIn, vec3(1.4)).mul(vec3(0.95, 0.92, 0.8)).mul(0.7))
            .add(through.mul(behind).mul(thin).mul(0.3));
        // White water is white: it stands at the tube's open side under the whole sky, and the
        // low sun comes through what the lip pours (a fall of it glows where the sun is behind).
        const openSky = clamp(fromLine.mul(-0.4).add(0.7), 0.35, 1.0);
        const whiteLight = vec3(0.4, 0.47, 0.54).mul(light.skyTint).mul(openSky)
            .add(light.sunTint.mul(vec3(0.5, 0.42, 0.32)).mul(f2.mul(0.9).add(0.35)).mul(openSky))
            .add(behind.mul(thin).mul(0.3));
        // (Heaped foam is not one flat white: it has hollows.)
        const hollows = fine.b.mul(0.44).add(froth.r.mul(0.26)).add(0.48);
        const foamDepth = smoothstep(0.25, 0.86, heap.add(fine.a.sub(0.5).mul(0.6)));
        const foamColour = mix(vec3(0.55, 0.8, 0.83), vec3(0.94, 0.98, 0.95), foamDepth)
            .mul(foamLight.add(whiteLight.mul(churned).mul(hollows)));

        // ── Compose ──
        const colour = body.mul(float(1.0).sub(fresnel)).add(mirror.mul(fresnel)).toVar();
        // Every ripple has a side turned to the sun and a side turned away.
        const relief = clamp(dot(N.sub(N0), sun).mul(2.6), -1.0, 1.0);
        colour.mulAssign(float(1.0).sub(max(relief.negate(), 0.0).mul(0.42)));
        colour.addAssign(vec3(1.0, 0.66, 0.34).mul(light.fireTint).mul(max(relief, 0.0)).mul(0.085)
            .mul(lift.mul(0.6).add(0.4)));
        colour.assign(mix(colour, foamColour, foam));
        // In the impact zone air and water churn together. Sample that volume in
        // world space on both pieces of the sheet so the falling curtain and the
        // trough meet in a rolling boil with continuous lighting at their seam.
        const contact = landed.mul(float(1).sub(smoothstep(0.10, 0.81, P.y)))
            .mul(max(smoothstep(4.86, 5.65, phi), float(1).sub(smoothstep(0.12, 0.84, abs(fromLine)))));
        If(contact.greaterThan(0.002), () => {
            const at = vec2(P.x.add(P.y.mul(0.58)), P.z).mul(0.79)
                .add(vec2(time.mul(-0.115), time.mul(-0.095)));
            const boil = texture(noise, at).level(1).toVar();
            const frothy = smoothstep(0.21, 0.78, boil.b.mul(0.66).add(boil.a.mul(0.34)));
            const shade = vec3(0.26, 0.48, 0.52).mul(light.skyTint);
            const head = vec3(1.12, 1.17, 1.15).mul(light.skyTint)
                .add(vec3(0.43, 0.34, 0.22).mul(light.sunTint));
            colour.assign(mix(colour, mix(shade, head, frothy), contact));
        });
        // Entrained air gleams in pockets behind the glass curtain. The tiny
        // bubbles use the existing foam mip chain so they fade cleanly in the distance.
        const aeration = smoothstep(0.43, 0.8, broad.a).mul(smoothstep(0.35, 0.68, rib.a));
        const pearls = smoothstep(0.32, 0.85, fizz.a).mul(aeration).mul(thin)
            .mul(float(1).sub(fresnel))
            .mul(float(1).sub(smoothstep(4, 22, dist)));
        colour.addAssign(mix(light.scatter, light.sunTint, 0.38).mul(pearls).mul(0.42));
        // The sea's own light, when the hour is dark: what is stirred burns cold for a moment. The
        // lace on the face, the boil under the lip, every ring a piece lays.
        const stirred = lines.mul(low).mul(0.5).add(carpet.mul(0.8)).add(ringGleam.mul(0.35))
            .add(cell.a.mul(low).mul(0.25));
        colour.addAssign(vec3(0.05, 0.5, 0.95).mul(U.glowing).mul(stirred).mul(0.55));
        // At moonrise, individual plankton light in the shear behind a breaking
        // crest. A passing clear wakes another patch and the current carries it on.
        if (tier.caustics) {
            If(U.glowing.greaterThan(0.02), () => {
                const colony = smoothstep(0.52, 0.76, broad.b.add(rib.a.sub(0.5).mul(0.35)));
                const wake = low.mul(0.22).add(smoothstep(0.12, 0.9, heap).mul(0.51))
                    .add(sweep.mul(0.78)).add(net.mul(0.16));
                const sparks = smoothstep(0.36, 0.82, fizz.a).add(smoothstep(0.63, 0.93, froth.a).mul(0.6));
                colour.addAssign(vec3(0.018, 1.8, 2.6).mul(sparks).mul(colony).mul(wake)
                    .mul(U.glowing));
            });
        }
        // The low sun through the lip's thin torn edge: a fringe of its own light along every lobe,
        // strongest looking toward it, a little of it all along the lip (the water scatters it).
        // (Not where the lip stands on the sea: its foot is white water, not a burning edge.)
        const fringe = float(1.0).sub(smoothstep(0.0, reach.mul(0.22).add(0.16), cut)).mul(torn).mul(thin)
            .mul(float(1.0).sub(landed.mul(0.85)));
        const toSun = forward.mul(forward);
        colour.addAssign(light.bloom.mul(light.fireTint).mul(fringe)
            .mul(toSun.mul(toSun).mul(2.2).add(toSun.mul(0.5)).add(0.08))
            .mul(through.y.mul(0.6).add(0.4)));
        colour.addAssign(ribbon.mul(threads).mul(thin.mul(0.7).add(0.7)).mul(1.5));
        colour.addAssign(vec3(0.72, 1.0, 0.94).mul(light.waterTint).mul(ringGleam).mul(0.075));
        // A clear's band of light, caught on every rib of the wall: the sun's colour where the
        // water is thin and the sky comes through it, the sea's own where it is deep.
        // Hot play: a little brighter.
        const sweepDeep = vec3(0.5, 0.95, 0.8).mul(light.waterTint);
        const sweepThin = vec3(1.0, 0.8, 0.46).mul(light.fireTint);
        colour.addAssign(mix(sweepDeep, sweepThin, thin).mul(sweep)
            .mul(net.mul(0.5).add(rib.b.mul(0.3)).add(0.1))
            .mul(thin.mul(0.7).add(0.55))
            .mul(U.heat.mul(0.15).add(0.5)));
        If(openSea.greaterThan(0.001), () => {
            // The lee of a swell holds a cool reflection while the high facets catch the disc.
            colour.mulAssign(float(1).sub(max(swellFace.negate(), 0).mul(openSea).mul(0.17)));
            const glint = smoothstep(0.993, 0.9997, dot(R, sun));
            const fleck = smoothstep(0.4, 0.78, fine.b.mul(0.6).add(rib.a.mul(0.4)));
            colour.addAssign(light.disc.mul(glint).mul(fleck).mul(openSea)
                .mul(U.sea.w.mul(0.8).add(0.7)));
        });
        // The far water goes into the haze of the hour.
        const haze = wavesSky(normalize(vec3(V.x.negate(), 0.012, V.z.negate())), sun, float(0.0), warm, light);
        colour.assign(mix(colour, haze, float(1.0).sub(exp(dist.mul(-1 / 420)))));
        return vec4(colour, edgeAlpha);
    })();
    // The torn edge is cut at half its alpha: by coverage under MSAA, by a plain test without it.
    material.alphaTest = 0.5;
    material.alphaToCoverage = true;

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
