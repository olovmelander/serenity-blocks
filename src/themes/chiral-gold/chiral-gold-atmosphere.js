/**
 * Chiral Gold — the air of the hall.
 *
 *  - The dark the hall ends in: black, with a low band of warm air along the far waterline and a
 *    pool of amber standing behind each tower. It is what the water mirrors beyond the gold.
 *  - Shafts: one soft column of lit air falling on each tower from above, as a gallery lights a
 *    sculpture. Additive cones, streaked by the noise, breathing with the chain's heat.
 *  - Motes: gold dust hanging in the air, drifting slowly upward. Each mote's place is a function
 *    of the clock and its seed. The lens is focused on the towers, so near motes swell into soft
 *    discs of bokeh and far ones shrink to points; they glint as they turn.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    pow,
    sin,
    smoothstep,
    sqrt,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
    cameraPosition,
} from 'three/tsl';
import {
    STAGE,
    cgClip,
    cgFxMaterial,
    cgPart,
    cgQuadGeometry,
    mulberry32,
} from './chiral-gold-tsl.js';

/**
 * The dark of the hall in direction `dir` (normalised, world). Shared by the backdrop and by the
 * water's far edge, so the waterline never shows.
 */
export function hallSky(u, dir) {
    const up = dir.y;
    const flat = max(length(vec2(dir.x, dir.z)), 1e-3);
    const side = dir.x.div(flat);
    // Looking down the hall (−Z) the towers stand at about ±0.38 across.
    const back = float(1.0).sub(smoothstep(-0.5, 0.1, dir.z.div(flat)));
    const low = exp(abs(up).mul(-7.5));
    const haze = low.mul(back.mul(0.75).add(0.25));
    // The pools are kept narrow and low: wide and bright, they washed a third of the frame brown
    // and the gold had no dark to stand against.
    const poolL = exp(side.add(0.38).mul(side.add(0.38)).mul(-55.0));
    const poolR = exp(side.sub(0.38).mul(side.sub(0.38)).mul(-55.0));
    const rise = exp(max(up, 0.0).mul(-3.4));
    const pools = poolL.mul(u.flare.x.mul(0.6).add(1.0)).add(poolR.mul(u.flare.y.mul(0.6).add(1.0)))
        .mul(rise).mul(back);
    const warm = u.heat.mul(0.6).add(1.0);
    // A thin line of warm light along the far waterline: the floor reads as a plane going back
    // into the dark (the water mirrors it, so it is one line, not a seam).
    const line = exp(abs(up).mul(-48.0)).mul(back);
    return vec3(0.0006, 0.0005, 0.0005)
        .add(u.glow.mul(haze).mul(0.0065).mul(warm))
        .add(u.glow.mul(vec3(1.0, 0.8, 0.6)).mul(line).mul(0.007).mul(warm))
        .add(u.glow.mul(vec3(1.0, 0.72, 0.5)).mul(pools).mul(0.0085).mul(warm))
        .mul(u.emit.mul(0.8).add(0.2));
}

/** The backdrop: an inside-out sphere wearing hallSky. */
export function createBackdrop(u) {
    const geometry = new THREE.SphereGeometry(300, 32, 16);
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
    material.name = 'ChiralGoldBackdrop';
    material.fog = false;
    material.colorNode = hallSky(u, normalize(positionWorld.sub(cameraPosition)));
    return cgPart('ChiralGoldBackdrop', geometry, material, -30, true);
}

/**
 * The beams: a lamp high above each outer corner of the hall throws a beam down onto the foot of
 * its tower, the left one the mirror of the right. They follow the towers as the layout moves them.
 * Lamp and foot are in tower units: x out from the tower's axis (times its scale), y, z.
 */
export const BEAM = Object.freeze({
    lamp: Object.freeze([7.5, 20, -2.5]),
    /** Below the water: the opaque surface cuts the beam where it lands, as a floor does. */
    foot: Object.freeze([0, -2.2, 0.7]),
    /** Radius at the lamp and at the foot (metres, times the tower's scale). */
    rLamp: 0.55,
    rFoot: 3.1,
});

/**
 * A side's beam (−1 left, +1 right), built from the shared uniforms so every part that reads it
 * agrees: its foot, length, axis and a frame across it.
 */
export function beamFrame(u, side) {
    const sd = float(side);
    const foot = vec3(sd.mul(u.helixX.add(u.helixScale.mul(BEAM.foot[0]))), BEAM.foot[1], BEAM.foot[2]);
    const lamp = vec3(sd.mul(u.helixX.add(u.helixScale.mul(BEAM.lamp[0]))), BEAM.lamp[1], BEAM.lamp[2]);
    const span = lamp.sub(foot);
    const len = length(span);
    const axis = span.div(len);
    const across = normalize(cross(axis, vec3(0.0, 0.0, 1.0)));
    const depth = cross(axis, across);
    return {
        foot, len, axis, across, depth,
    };
}

/** The beam's radius at `h` along it (0 foot, 1 lamp). */
export const beamRadius = (u, h) => mix(float(BEAM.rFoot), float(BEAM.rLamp), h).mul(u.helixScale);

/**
 * Seen through haze a beam is brightest where the eye's path through it is longest, so each
 * pixel's light is worked out from the line it looks along: how close that line passes the beam's
 * axis against the beam's radius there gives the chord through it (even across the body, falling
 * away only at the very edge, as a real beam does), and where along the axis it passes gives how
 * near the lamp. Dust hangs in it in threads along its length, drifting down. The cone mesh only
 * covers the beam; its far faces are drawn (one fragment a pixel) and the light is computed.
 */
export function createShafts(u) {
    const unit = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(unit.getIndex());
    geometry.setAttribute('position', unit.getAttribute('position'));
    geometry.setAttribute('normal', unit.getAttribute('normal'));
    geometry.setAttribute('uv', unit.getAttribute('uv'));
    geometry.setAttribute('aSide', new THREE.InstancedBufferAttribute(new Float32Array([-1, 1]), 1));
    geometry.instanceCount = 2;

    const side = attribute('aSide', 'float');
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    });
    material.name = 'ChiralGoldShafts';
    material.fog = false;
    const frame = (sd) => beamFrame(u, sd);
    const radiusAt = (h) => beamRadius(u, h);
    material.positionNode = Fn(() => {
        const f = frame(side);
        const h = positionGeometry.y.add(0.5);
        const r = radiusAt(h).mul(1.08);
        return f.foot.add(f.axis.mul(h.mul(f.len)))
            .add(f.across.mul(positionGeometry.x.mul(r)))
            .add(f.depth.mul(positionGeometry.z.mul(r)));
    })();
    const vSide = varying(side, 'cgShaftSide');
    material.colorNode = Fn(() => {
        const f = frame(vSide);
        const C = cameraPosition;
        const D = normalize(positionWorld.sub(C));
        // Closest approach of the eye's line to the beam's axis.
        const w = C.sub(f.foot);
        const b = dot(D, f.axis);
        const dD = dot(D, w);
        const e = dot(f.axis, w);
        const denom = max(float(1.0).sub(b.mul(b)), 1e-4);
        const sRay = b.mul(e).sub(dD).div(denom);
        const tAxis = clamp(e.sub(b.mul(dD)).div(denom), 0.0, f.len);
        const gap = C.add(D.mul(sRay)).sub(f.foot.add(f.axis.mul(tAxis)));
        const h = tAxis.div(f.len);
        const R = radiusAt(h);
        const x = dot(gap, f.across).div(R);
        const q = clamp(length(gap).div(R), 0.0, 1.0);
        const chord = sqrt(float(1.0).sub(q.mul(q)));
        // Threads of dust along it, drifting down, and slow billows of haze through them.
        const threads = u.noise(vec2(x.mul(1.9).add(vSide.mul(0.37)), h.mul(1.3).add(u.time.mul(0.008)))).r;
        const fine = u.noise(vec2(x.mul(4.3).add(vSide.mul(0.71)), h.mul(2.6).add(u.time.mul(0.013)))).b;
        // (Kept faint: strong, they drew the beam as a curtain of rain.)
        const lines = smoothstep(0.3, 0.85, threads).mul(0.32).add(smoothstep(0.5, 0.9, fine).mul(0.14));
        const haze = u.noise(vec2(x.mul(0.6).add(u.time.mul(0.004)), h.mul(3.0).add(u.time.mul(0.017)))).g;
        // Brighter toward the lamp.
        const along = mix(float(0.35), float(1.0), h);
        const flare = mix(u.flare.x, u.flare.y, smoothstep(-0.5, 0.5, vSide));
        // (Held to a little of the heat: the beams fill the frame's sides, and a chain that
        // doubled them hazed the hall's dark.)
        const power = u.heat.mul(0.2).add(0.5).add(flare.mul(0.2));
        const tint = mix(u.glow, vec3(1.0, 0.9, 0.76), 0.55);
        return tint.mul(chord.pow(0.85)).mul(lines.add(0.5))
            .mul(haze.mul(0.9).add(0.35))
            .mul(along)
            .mul(power)
            .mul(0.045)
            .mul(u.emit);
    })();
    const part = cgPart('ChiralGoldShafts', geometry, material, 24, false);
    part.dispose = () => unit.dispose();
    return part;
}

/** The volume the motes hang in (metres): |x| < spanX, 0 < y < spanY, zNear > z > zFar. */
export const MOTES = Object.freeze({
    spanX: 15, spanY: 11, zNear: 10, zFar: -12,
});

/**
 * @param {object} u
 * @param {number} count
 */
export function createMotes(u, count) {
    const seed = new Float32Array(count * 4);
    const rand = mulberry32(0x60d1);
    for (let i = 0; i < count * 4; i++) seed[i] = rand();
    const geometry = cgQuadGeometry(count, { aSeed: [seed, 4] });
    const a = attribute('aSeed', 'vec4');

    const material = cgFxMaterial('ChiralGoldMotes');
    const t = u.time;
    // Half the motes keep to the towers, where the light is.
    const loose = a.x.sub(0.5).mul(2.0 * MOTES.spanX);
    const near = a.x.sub(0.5).sign().mul(u.helixX).add(a.x.mul(37.0).fract().sub(0.5).mul(7.0));
    const x0 = mix(loose, near, smoothstep(0.45, 0.55, a.w.mul(13.0).fract()));
    const rise = a.w.mul(0.11).add(0.035);
    const yy = fract(a.y.add(t.mul(rise).div(MOTES.spanY)));
    const centre = vec3(
        x0.add(sin(t.mul(0.13).add(a.w.mul(40.0))).mul(0.45)).add(sin(t.mul(0.071).add(a.y.mul(20.0))).mul(0.35)),
        yy.mul(MOTES.spanY).add(0.05),
        mix(float(MOTES.zFar), float(MOTES.zNear), a.z).add(cos(t.mul(0.11).add(a.x.mul(30.0))).mul(0.5)),
    );
    const clip = cgClip(centre);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(u.lens).div(max(clip.w, 0.4));
    const sharp = a.w.mul(a.w).mul(0.026).add(0.008).mul(pxPerMetre);
    // The lens is focused on the towers: away from that plane a mote opens into a disc.
    const blur = min(
        abs(clip.w.sub(STAGE.camera.z)).div(max(clip.w, 0.8)).mul(u.viewport.y.mul(0.0105)),
        u.viewport.y.mul(0.024),
    );
    const radius = max(sharp, 0.9).add(blur);
    const spread = sharp.mul(sharp).div(radius.mul(radius)).mul(1.0).add(0.015);
    const visible = smoothstep(0.0, 0.05, yy).mul(float(1.0).sub(smoothstep(0.9, 1.0, yy)));
    material.vertexNode = vec4(
        clip.xy.add(positionGeometry.xy.mul(2.0).mul(radius).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );
    // It glints as it turns; the towers light the dust around them.
    const glint = pow(sin(t.mul(a.w.mul(1.7).add(0.5)).add(a.x.mul(50.0))).mul(0.5).add(0.5), 7.0);
    const toTower = abs(abs(centre.x).sub(u.helixX));
    // (The dust fills the whole frame: it takes only a little of the heat, or a long chain would
    // lift the hall's dark to a haze.)
    const lit = exp(toTower.mul(toTower).mul(-0.07)).mul(1.5).add(0.22)
        .mul(u.heat.mul(0.3).add(1.0).add(u.flare.x.add(u.flare.y).mul(0.1)));
    const tint = mix(u.glow, vec3(1.0, 0.86, 0.6), a.z.mul(7.0).fract().mul(0.6));
    const vLight = varying(
        tint.mul(glint.mul(3.2).add(0.3)).mul(lit).mul(spread).mul(visible)
            .mul(u.emit)
            .mul(u.audio.z.mul(0.6).add(1.0)),
        'cgMote',
    );
    const vSoft = varying(min(blur.div(max(sharp, 0.9)), 6.0), 'cgMoteSoft');
    material.colorNode = Fn(() => {
        const r = length(uv().sub(0.5)).mul(2.0);
        // In focus: a soft point. Out of focus: a flat disc with a brighter rim.
        const point = exp(r.mul(r).mul(-3.5));
        const disc = float(1.0).sub(smoothstep(0.82, 1.0, r)).mul(smoothstep(0.35, 0.95, r).mul(0.45).add(0.75));
        const shape = mix(point, disc, smoothstep(0.6, 2.2, vSoft));
        return vec4(vLight.mul(shape), 0.0);
    })();
    const part = cgPart('ChiralGoldMotes', geometry, material, 40, false);
    part.count = count;
    return part;
}
