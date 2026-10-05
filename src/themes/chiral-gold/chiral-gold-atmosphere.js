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
    cos,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    min,
    mix,
    normalView,
    normalize,
    positionGeometry,
    positionViewDirection,
    positionWorld,
    pow,
    sin,
    smoothstep,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
    cameraPosition,
} from 'three/tsl';
import {
    HELIX,
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
    const poolL = exp(side.add(0.38).mul(side.add(0.38)).mul(-26.0));
    const poolR = exp(side.sub(0.38).mul(side.sub(0.38)).mul(-26.0));
    const rise = exp(max(up, 0.0).mul(-2.6));
    const pools = poolL.mul(u.flare.x.mul(0.6).add(1.0)).add(poolR.mul(u.flare.y.mul(0.6).add(1.0)))
        .mul(rise).mul(back);
    const warm = u.heat.mul(0.5).add(1.0);
    return vec3(0.0011, 0.0009, 0.0008)
        .add(u.glow.mul(haze).mul(0.011).mul(warm))
        .add(u.glow.mul(vec3(1.0, 0.72, 0.5)).mul(pools).mul(0.02).mul(warm))
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

/** One cone of lit air over each tower. */
export function createShafts(u) {
    const height = HELIX.top + 3;
    const cone = new THREE.CylinderGeometry(0.9, 3.4, height, 28, 1, true);
    cone.translate(0, height / 2 - 0.2, 0);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(cone.getIndex());
    geometry.setAttribute('position', cone.getAttribute('position'));
    geometry.setAttribute('normal', cone.getAttribute('normal'));
    geometry.setAttribute('uv', cone.getAttribute('uv'));
    geometry.setAttribute('aSide', new THREE.InstancedBufferAttribute(new Float32Array([-1, 1]), 1));
    geometry.instanceCount = 2;

    const side = attribute('aSide', 'float');
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    material.name = 'ChiralGoldShafts';
    material.fog = false;
    material.positionNode = vec3(
        positionGeometry.x.mul(u.helixScale).add(u.helixX.mul(side)),
        positionGeometry.y,
        positionGeometry.z.mul(u.helixScale),
    );
    const vSide = varying(side, 'cgShaftSide');
    material.colorNode = Fn(() => {
        const st = uv();
        // Seen through its thickness: bright where the eye passes through the middle of the cone.
        const through = pow(abs(dot(normalView, positionViewDirection)), 2.2);
        const streaks = u.noise(vec2(st.x.mul(2.0).add(vSide.mul(0.37)), st.y.mul(0.16).sub(u.time.mul(0.008)))).r;
        const drift = u.noise(vec2(st.x.mul(0.7).add(u.time.mul(0.004)), st.y.mul(0.4).add(u.time.mul(0.012)))).g;
        const fall = smoothstep(0.0, 0.12, st.y).mul(float(1.0).sub(smoothstep(0.55, 1.0, st.y)).mul(0.75).add(0.25));
        const flare = mix(u.flare.x, u.flare.y, smoothstep(-0.5, 0.5, vSide));
        const power = u.heat.mul(0.35).add(0.55).add(flare.mul(0.35));
        return u.glow.mul(vec3(1.0, 0.9, 0.74)).mul(through).mul(streaks.mul(0.9).add(0.25))
            .mul(drift.mul(0.7).add(0.5))
            .mul(fall)
            .mul(power)
            .mul(0.03)
            .mul(u.emit);
    })();
    const part = cgPart('ChiralGoldShafts', geometry, material, 24, false);
    part.dispose = () => cone.dispose();
    return part;
}

/** The volume the motes hang in (metres): |x| < spanX, 0 < y < spanY, zNear > z > zFar. */
export const MOTES = Object.freeze({
    spanX: 15, spanY: 11, zNear: 12.5, zFar: -12,
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
        u.viewport.y.mul(0.034),
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
    const lit = exp(toTower.mul(toTower).mul(-0.07)).mul(1.5).add(0.22)
        .mul(u.heat.mul(0.5).add(1.0).add(u.flare.x.add(u.flare.y).mul(0.2)));
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
