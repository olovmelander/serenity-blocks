/**
 * Serenity Warp — what passes the lens.
 *
 *  - The near stars: suns that stand round the gate's axis between us and it. We drift toward
 *    the gate, so they come toward us, slide past and are left behind, each wrapped back to the
 *    far end of its own depth. A chain warps the sky: they draw out into trails as long as the
 *    ground they cover in a shutter's time, and run faster.
 *  - The dust of the current: motes close to the lens that swirl round the axis and run on
 *    toward the throat, lit by the gate. At rest they hang and drift; in a chain they are the
 *    lines that show the current pulling.
 *
 * Both are one draw of instanced quads, strung between where a point is now and where it was a
 * shutter ago. Nothing is simulated: a point's place is a function of how far it has come.
 * They test depth, so the glass stands in front of them.
 */

import {
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    exp,
    float,
    length,
    max,
    min,
    mix,
    mod,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    TAU, mulberry32, swFxMaterial, swPart, swQuadGeometry,
} from './serenity-warp-tsl.js';

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

/** The near stars' depth (warp units from the far end of their run to the camera) and what is kept behind it. */
export const STAR_DEPTH = 90;
export const STAR_BEHIND = 6;
/** The dust's run: from just in front of the lens to deep in the current. */
export const MOTE_DEPTH = 14;
export const MOTE_BEHIND = 0.5;

/**
 * @param {object} u
 * @param {object} options
 * @param {number} options.count
 * @param {'stars'|'motes'} options.kind
 * @param {number} [options.seed]
 */
export function createStreakField(u, { count, kind = 'stars', seed = 0x51a7 } = {}) {
    const stars = kind === 'stars';
    const depthSpan = stars ? STAR_DEPTH : MOTE_DEPTH;
    const behind = stars ? STAR_BEHIND : MOTE_BEHIND;
    const rand = mulberry32(seed);
    const aPlace = new Float32Array(count * 4);
    const aLook = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        const a = rand() * TAU;
        // Stars stand all round the axis; the dust thickens toward it (the current narrows).
        const r = stars ? 1.6 + rand() ** 1.6 * 40 : 0.35 + rand() ** 1.4 * 4.2;
        aPlace.set([Math.cos(a) * r, Math.sin(a) * r, rand() * depthSpan, rand()], i * 4);
        // (brightness: a few bright, most faint; size; warmth; twinkle phase)
        aLook.set([rand() ** (stars ? 7 : 2.4), 0.6 + rand() * 0.8, rand(), rand() * TAU], i * 4);
    }
    const geometry = swQuadGeometry(count, { aPlace: [aPlace, 4], aLook: [aLook, 4] });
    const place = attribute('aPlace', 'vec4');
    const look = attribute('aLook', 'vec4');
    const uniforms = {
        /** Seconds of travel a trail shows. */
        shutter: uniform(stars ? 0.3 : 0.12),
        /** The whole field's gain. */
        gain: uniform(1),
    };
    const travel = stars ? u.starTravel : u.moteTravel;

    /** A point of the field `lead` warp units further along its run than it is now. */
    const at = (lead) => {
        // Stars come toward us; the dust runs away from us, into the current.
        const ahead = stars
            ? mod(place.z.sub(travel).add(lead), depthSpan).sub(behind)
            : mod(place.z.add(travel).sub(lead), depthSpan).add(behind);
        // The dust swirls round the axis faster the deeper it has gone in; a T-spin winds both.
        const turn = stars
            ? u.twist.mul(0.4)
            : u.spin.mul(1.6).add(ahead.mul(0.09)).add(u.twist.mul(1.2)).add(place.w.mul(TAU));
        const c = cos(turn);
        const s = sin(turn);
        // The current narrows toward the throat.
        const narrow = stars ? float(1.0) : float(1.0).div(float(1.0).add(ahead.mul(0.05)));
        const rel = vec3(
            place.x.mul(c).sub(place.y.mul(s)).mul(narrow),
            place.x.mul(s).add(place.y.mul(c)).mul(narrow),
            ahead.negate(),
        ).sub(u.camPos);
        return { rel, ahead };
    };
    const now = at(float(0.0));
    const was = at(u.speed.mul(uniforms.shutter).mul(stars ? 1.0 : 2.2));
    const c1 = viewProjection(now.rel.add(u.camPos));
    const c0 = viewProjection(was.rel.add(u.camPos));
    const range = max(length(now.rel), 1e-3);

    const half = u.viewport.mul(0.5);
    const s0 = c0.xy.div(max(c0.w, 1e-3)).mul(half);
    const s1 = c1.xy.div(max(c1.w, 1e-3)).mul(half);
    const trail = s1.sub(s0);
    const trailLen = length(trail);
    const dirS = trail.add(vec2(1e-4, 0.0)).div(max(trailLen, 1e-4));
    const nrm = vec2(dirS.y.negate(), dirS.x);
    const along = positionGeometry.x.add(0.5);
    const clip = mix(c0, c1, along);

    // In front of the lens, and not at the seam where its run wraps.
    const farFade = stars
        ? float(1.0).sub(smoothstep(depthSpan * 0.72 - behind, depthSpan - behind - 0.5, now.ahead))
        : float(1.0).sub(smoothstep(depthSpan * 0.6, depthSpan + behind - 0.3, now.ahead));
    const nearFade = stars ? smoothstep(0.3, 2.5, range) : smoothstep(0.25, 1.2, range).mul(smoothstep(behind, behind + 1.2, now.ahead));
    const front = step(0.02, min(c0.w, c1.w));
    // Nothing stands in front of the throat: the stars that would are let go (the dust is near).
    const offAxis = length(now.rel.xy.add(u.camPos.xy)).div(max(now.ahead, 0.1));
    const clearOfGate = stars ? smoothstep(u.gateRadius.mul(0.95), u.gateRadius.mul(1.6), offAxis) : float(1.0);
    const alive = farFade.mul(nearFade).mul(front).mul(clearOfGate);

    // A star a unit away is a few pixels wide; far ones are held at a pixel and dimmed instead.
    const world = stars ? look.y.mul(0.012) : look.y.mul(0.006);
    const wantPx = world.div(range.mul(u.pixelAngle));
    const widthPx = clamp(wantPx, 1.15, stars ? 5.0 : 3.2).mul(step(1e-3, alive));
    const lead = dirS.mul(along.sub(0.5).mul(2.0)).mul(widthPx);
    const material = swFxMaterial(stars ? 'SerenityWarpStars' : 'SerenityWarpMotes', { depthTest: true });
    material.vertexNode = vec4(
        clip.xy.add(nrm.mul(positionGeometry.y.mul(2.0).mul(widthPx)).add(lead).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );

    // ── Light (decided per point, in the vertex stage) ──
    const own = stars
        ? mix(vec3(1.0, 0.82, 0.66), vec3(0.72, 0.85, 1.0), look.z).mul(u.starTint)
        : mix(u.gateCol, u.glow.mul(1.8), look.z.mul(0.7));
    // What a pixel-wide point would have been, had it been drawn its true size.
    const shrink = min(float(1.0), wantPx.div(1.15));
    const twinkle = sin(u.time.mul(look.y.mul(1.7).add(0.6)).add(look.w)).mul(0.14).add(0.86);
    const near = stars
        ? float(1.0).div(float(1.0).add(range.mul(range).mul(0.006)))
        : float(0.35).add(float(0.65).mul(float(1.0).sub(smoothstep(2.0, depthSpan, now.ahead))));
    // A trail spreads one point's light along its length.
    const spread = float(1.0).div(float(1.0).add(trailLen.div(max(widthPx.mul(2.0), 1.0)).mul(stars ? 0.22 : 0.3)));
    const base = stars ? look.x.mul(5.0).add(0.08) : look.x.mul(0.4).add(0.05);
    // In a chain the stars that do not draw a trail are only noise: the far, faint ones give way.
    const streaks = smoothstep(1.5, 10.0, trailLen);
    const atSpeed = mix(float(1.0), streaks.mul(2.0).add(0.15), smoothstep(0.05, 0.5, u.warp));
    // The dust glows as the gate's light catches it, and brightens with the current.
    const lit = stars ? float(1.0) : u.gateGain.mul(0.5).add(0.5).mul(u.warp.mul(2.4).add(1.0));
    const vLight = varying(
        own.mul(base).mul(shrink).mul(twinkle).mul(near)
            .mul(spread)
            .mul(alive)
            .mul(atSpeed)
            .mul(uniforms.gain)
            .mul(u.breath)
            .mul(lit),
        stars ? 'swStarLight' : 'swMoteLight',
    );
    const vTrail = varying(trailLen.div(max(widthPx, 1.0)), stars ? 'swStarTrail' : 'swMoteTrail');

    // The quad is a capsule: round across, round at both ends, even along its trail.
    const q = uv().sub(0.5).mul(2.0);
    const stretch = vTrail.mul(0.5).add(1.0);
    const endX = max(q.x.abs().mul(stretch).sub(stretch.sub(1.0)), 0.0);
    const r2 = endX.mul(endX).add(q.y.mul(q.y));
    const body = exp(r2.mul(-3.6)).mul(float(1.0).sub(smoothstep(0.7, 1.0, r2)));
    // Brighter at the head: a trail fades back along where the point has been.
    const head = mix(float(0.35), float(1.0), smoothstep(-1.0, 1.0, q.x));
    material.colorNode = vec4(vLight.mul(body).mul(mix(float(1.0), head, smoothstep(0.5, 3.0, vTrail))), 0.0);

    const part = swPart(material.name, geometry, material, stars ? 60 : 70);
    part.uniforms = uniforms;
    part.count = count;
    return part;
}
