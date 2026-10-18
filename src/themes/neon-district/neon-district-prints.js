/**
 * Neon District — printed campaigns.
 *
 * The district's campaigns are not only on its screens: every rooftop scaffold carries a printed
 * board under three floodlights, and hoardings and pulled-down shutters are fly-posted, two to
 * five of one poster side by side, then the next. Unlike the screens, prints make no light of
 * their own: the street lights them (the glow map, the haze, the gameplay pulses) and a roof
 * board its floodlights from above. The paper is wet — darker, with a sheen at a glancing look —
 * and some posters are torn, showing the paper of older ones under them.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    dot,
    exp,
    float,
    floor,
    max,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    pow,
    smoothstep,
    step,
    uv,
    vec2,
    vec3,
    cameraPosition,
} from 'three/tsl';
import {
    ndAtmosphere,
    ndClearLight,
    ndGlow,
    ndHash21,
    ndLockLight,
    ndQuadGeometry,
    ndWrapZ,
} from './neon-district-tsl.js';
import { BILLBOARD_CELLS } from './neon-district-atlas.js';

/**
 * @param {object} u
 * @param {object[]} prints  plan.prints: { side, x, y, z, w, h, cell, flood, tear, seed }
 * @param {object} atlas     TextureNode over the billboard atlas (value swapped when loaded)
 * @param {object} fade      uniform 0..1: the prints come up once the atlas has arrived
 */
export function createPrints(u, prints, atlas, fade) {
    const count = Math.max(1, prints.length);
    const aPos = new Float32Array(count * 4);
    const aDim = new Float32Array(count * 4);
    const aRect = new Float32Array(count * 4);
    const aLook = new Float32Array(count * 4);
    prints.forEach((p, i) => {
        aPos.set([p.x, p.y, p.z, p.seed], i * 4);
        aDim.set([p.w, p.h, p.side, p.flood], i * 4);
        aRect.set(BILLBOARD_CELLS[p.cell].rect, i * 4);
        aLook.set([p.tear, 0, 0, 0], i * 4);
    });
    const geometry = ndQuadGeometry(prints.length, {
        aPos: [aPos, 4], aDim: [aDim, 4], aRect: [aRect, 4], aLook: [aLook, 4],
    }, { interleave: true });
    const pos = attribute('aPos', 'vec4');
    const dim = attribute('aDim', 'vec4');
    const rect = attribute('aRect', 'vec4');
    const look = attribute('aLook', 'vec4');

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'NeonDistrictPrints';
    material.fog = false;
    // On the wall plane, reading left to right from the street (as the shops do).
    material.positionNode = vec3(
        pos.x,
        pos.y.add(positionGeometry.y.mul(dim.y)),
        ndWrapZ(pos.z.add(u.scroll)).add(positionGeometry.x.mul(dim.x).mul(dim.z)),
    );

    material.colorNode = Fn(() => {
        const st = uv();
        const pW = positionWorld;
        const seed = floor(pos.w.add(0.5));
        const V = normalize(pW.sub(cameraPosition));
        const ndv = clamp(dot(V.negate(), vec3(dim.z.negate(), 0.0, 0.0)), 0.02, 1.0);
        const metres = st.mul(vec2(dim.x, dim.y));

        // ── The paper and what is printed on it ──
        const printed = atlas.sample(vec2(mix(rect.x, rect.z, st.x), float(1.0).sub(mix(rect.w, rect.y, st.y)))).rgb;
        const grain = u.noise(metres.mul(0.9).add(seed.mul(0.31))).r;
        const paper = vec3(0.3, 0.29, 0.27).mul(grain.mul(0.3).add(0.8));
        // Torn: mostly from the edges and the foot, where hands and weather reach.
        const n = u.noise(metres.mul(0.55).add(vec2(seed.mul(0.17), seed.mul(0.05)))).g;
        const edge = max(abs(st.x.sub(0.5)).mul(0.6), float(1.0).sub(st.y).mul(0.45));
        const torn = step(float(1.0).sub(look.x), n.mul(0.6).add(edge)).mul(step(0.01, look.x));
        const under = mix(vec3(0.22, 0.21, 0.2), vec3(0.32, 0.12, 0.1), step(0.6, ndHash21(vec2(floor(metres.y.mul(3.0)), seed))));
        const albedo = mix(mix(paper, printed, fade), under, torn).mul(0.82).mul(grain.mul(0.16).add(0.92));

        // ── Light: the street, the gameplay, and a roof board's floodlights ──
        const clear = ndClearLight(u, pW.z);
        const pulse = ndLockLight(u, pW).add(clear.rgb);
        const glow = ndGlow(u, pW).mul(exp(max(pW.y.sub(3.0), 0.0).mul(-0.06)));
        const sky = u.hazeHigh.mul(1.6).add(u.hazeLow.mul(0.35));
        const lamps = exp(abs(st.x.sub(0.13)).mul(-9.0)).add(exp(abs(st.x.sub(0.5)).mul(-9.0)))
            .add(exp(abs(st.x.sub(0.87)).mul(-9.0)));
        const fromTop = exp(float(1.0).sub(st.y).mul(-1.4));
        const flood = vec3(1.0, 0.9, 0.76).mul(fromTop.mul(lamps.mul(0.9).add(0.55))).mul(dim.w).mul(u.neon.mul(0.9).add(0.1))
            .mul(2.2);
        const light = vec3(0.03, 0.038, 0.06).add(glow.mul(1.15)).add(sky.mul(3.0)).add(pulse.mul(3.0))
            .add(flood)
            .mul(clear.w.mul(0.3).add(1.0));
        // Wet paper: a sheen of the street's light at a glancing look.
        const sheen = pow(float(1.0).sub(ndv), 3.0).mul(u.rain).mul(glow.mul(0.08).add(u.hazeLow.mul(0.25)));
        const lit = albedo.mul(light).add(sheen).add(flood.mul(albedo).mul(smoothstep(0.85, 1.0, st.y)).mul(0.3));
        return ndAtmosphere(u, lit, pW);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'NeonDistrictPrints';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    return { mesh, material, geometry };
}
