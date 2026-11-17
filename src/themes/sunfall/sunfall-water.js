/**
 * Sunfall — water in the sunfall: the shower's rain, the four-line cataract with its spray and
 * the one rainbow, and the back-to-back flood threads.
 *
 * - **Rain** falls from the oculus rim and is seen only where the sun is on it: each streak's
 *   light is the sun mask at its own position, so a shower glitters inside the column and is
 *   invisible in the shade (never grey "rainy window" streaks).
 * - **The cataract** pours from a rim station chosen so its fall runs inside the column for
 *   its whole height: a ribbon of flow-streaked white water whose leading edge drops through
 *   the light, blazing where lit and slate-blue where the sun leaves it, thinning to threads.
 * - **The spray** at its foot is a soft shell, sunlit where the column reaches it, carrying
 *   `dlBowNode`: a full double bow with Alexander's dark band, placed by `solveBowSun`.
 * - **Flood threads**: one to three thin falls from fixed rim stations while a back-to-back
 *   chain lives (threads = level).
 * Every additive part writes `vec4(rgb, 0)` with premultiplied blending (the target's alpha is
 * left alone).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cross,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    select,
    sin,
    smoothstep,
    texture,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CANOPY_LEVEL, OCULUS_CENTER, OCULUS_RX, OCULUS_RZ, mulberry32,
} from './sunfall-core.js';
import { SUNFALL_LIGHT, pieceSwatchNode, sfSunMask } from './sunfall-tsl.js';

const FALL_TOP = OCULUS_CENTER[1] - 1.0;
const FALL_FOOT = CANOPY_LEVEL + 6.0;

/**
 * Rim stations in oculus coordinates: the cataract's, then three threads'. They hang from the
 * rim's left: seen from the ledge the sunfall leans away from them as it comes down, so the
 * water blazes where it leaves the rim inside the light and then falls beside the column,
 * silver against the dark wall. (White water inside the column's own glow was white on white:
 * the air's light is added over it, and the cataract was a few threads lost among the shafts.)
 */
export const SUNFALL_FALLS = Object.freeze([
    Object.freeze({ q: [-0.93, 0.05], width: 30 }),
    Object.freeze({ q: [-0.78, 0.52], width: 4.6 }),
    Object.freeze({ q: [-0.88, -0.36], width: 3.8 }),
    Object.freeze({ q: [-0.58, 0.76], width: 4.2 }),
]);

export function fallStation(i) {
    const f = SUNFALL_FALLS[i];
    return [OCULUS_CENTER[0] + f.q[0] * OCULUS_RX, OCULUS_CENTER[2] + f.q[1] * OCULUS_RZ];
}

const premultipliedAdditive = (material) => {
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    return material;
};

/** Rain streaks falling from the rim, lit only inside the sunfall. */
export function createRainMaterial(u) {
    const D = attribute('aDrop', 'vec4'); // q.x, q.y on the rim disc, phase, speed
    const fall = FALL_TOP - FALL_FOOT;
    const vertex = Fn(() => {
        const top = vec3(
            float(OCULUS_CENTER[0]).add(D.x.mul(OCULUS_RX * 0.95)),
            float(FALL_TOP),
            float(OCULUS_CENTER[2]).add(D.y.mul(OCULUS_RZ * 0.95)),
        );
        const s = fract(D.z.add(u.time.mul(D.w).div(fall)));
        const centre = top.sub(vec3(0.0, s.mul(fall), 0.0)).toVar();
        const intensity = u.showerPulse.add(u.cataractPulse.mul(0.8)).add(u.dripScale.mul(0.04))
            .add(u.rain.mul(0.55));
        const live = smoothstep(0.02, 0.08, intensity).mul(sfSunMask(u, centre));
        const toCam = cameraPosition.sub(centre);
        const dist = length(toCam);
        const side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
        const width = max(float(0.05), dist.mul(u.pixelAngle).mul(1.2)).mul(live);
        const len = D.w.mul(0.8).mul(live);
        return centre.add(side.mul(positionGeometry.x.mul(width))).add(vec3(0.0, positionGeometry.y.mul(len), 0.0));
    })();
    const color = Fn(() => {
        const across = abs(uv().x.sub(0.5)).mul(2.0);
        const along = abs(uv().y.sub(0.5)).mul(2.0);
        const core = clamp(float(1.0).sub(across), 0.0, 1.0).mul(clamp(float(1.0).sub(along.mul(along)), 0.0, 1.0));
        const intensity = clamp(
            u.showerPulse.add(u.cataractPulse.mul(0.8)).add(u.dripScale.mul(0.04)).add(u.rain.mul(0.55)),
            0.0,
            1.5,
        );
        // Sunlit drops glint in colour as play heats (each streak one piece's pigment).
        const pigment = pieceSwatchNode(floor(fract(D.z.mul(37.0)).mul(7.0))).mul(1.6);
        const light = mix(u.beamCore, pigment, u.prism.mul(0.8)).mul(core).mul(intensity)
            .mul(SUNFALL_LIGHT.sun * 0.05)
            .mul(u.sunGain);
        return vec4(light, 0.0);
    })();
    const material = premultipliedAdditive(new THREE.MeshBasicNodeMaterial());
    material.positionNode = vertex;
    material.colorNode = color;
    material.outputNode = color;
    material.side = THREE.DoubleSide;
    return material;
}

/** The cataract (instance 0) and the flood threads (1..3): ribbons of falling water. */
export function createFallMaterial(u, textures) {
    const R = attribute('aFall', 'vec4'); // x, z, width, index
    const fall = FALL_TOP - FALL_FOOT;
    const vertex = Fn(() => {
        const v = clamp(float(0.5).sub(positionGeometry.y), 0.0, 1.0);
        const y = float(FALL_TOP).sub(v.mul(fall));
        // The cataract sways out a little as it falls; threads hang straight.
        const isCataract = float(1.0).sub(clamp(R.w, 0.0, 1.0));
        const wobble = sin(v.mul(5.0).add(u.time.mul(0.9)).add(R.w)).mul(v).mul(mix(0.6, 4.0, isCataract));
        const base = vec3(R.x.add(wobble), y, R.y).toVar();
        const toCam = cameraPosition.sub(base);
        const side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
        const spread = mix(1.0, float(1.0).add(v.mul(0.6)), isCataract);
        return base.add(side.mul(positionGeometry.x.mul(R.z).mul(spread)));
    })();
    const shade = Fn(() => {
        const st = uv();
        const v = clamp(float(1.0).sub(st.y), 0.0, 1.0);
        const P = positionWorld;
        const isCataract = float(1.0).sub(clamp(R.w, 0.0, 1.0));
        // How much water: the cataract's envelope with its leading edge, a thread's B2B level.
        const age = u.cataractAge.sub(0.35);
        const edge = clamp(age.mul(1.0 / 1.2), 0.0, 1.0);
        const front = smoothstep(edge.add(0.02), edge.sub(0.04), v);
        // A new pour's front falls over the curtain already standing (never wipes it away).
        const cat = max(
            front.mul(clamp(u.cataractPulse.mul(1.6), 0.0, 1.0)).mul(smoothstep(-0.1, 0.0, age)),
            u.cataractHold,
        );
        const thread = smoothstep(R.w.sub(1.0).add(0.15), R.w.sub(1.0).add(0.6), u.floodThreads.mul(3.0))
            .add(cat.mul(0.4));
        const amount = select(R.w.lessThan(0.5), cat, clamp(thread, 0.0, 1.0));
        // Flow streaks stretched along the fall, fraying at the edges.
        const across = st.x.sub(0.5).mul(2.0);
        const flow = texture(textures.fbm, vec2(
            st.x.mul(mix(0.9, 1.7, isCataract)).add(R.w.mul(0.37)),
            P.y.div(140.0).add(u.time.mul(0.45)),
        )).level(2).x;
        const streakUv = vec2(st.x.mul(mix(1.9, 5.3, isCataract)).add(0.13), P.y.div(55.0).add(u.time.mul(1.1)));
        const streak = texture(textures.fbm, streakUv).level(1).y;
        const body = smoothstep(1.0, mix(0.35, 0.55, flow), abs(across));
        // The cataract is strands of water with gaps of air between them, not one sheet.
        const strands = mix(float(1.0), smoothstep(0.28, 0.6, streak), isCataract.mul(0.85));
        const water = body.mul(mix(0.45, 1.1, streak)).mul(strands).mul(amount).toVar();
        // The water stays lit a little way past the column's edge (its own spray carries the
        // light), so the fall does not go out half-way down.
        const lit = max(sfSunMask(u, P), mix(0.24, 0.34, isCataract));
        // White water outshines the air it falls through: threads of glare along the strands.
        const glare = smoothstep(0.55, 0.85, streak).mul(3.2).add(1.0);
        const sunlit = u.beamCore.mul(SUNFALL_LIGHT.sun * 0.8).mul(glare).mul(u.sunGain).mul(lit);
        const slate = vec3(0.07, 0.1, 0.13).mul(u.skyGain);
        const col = mix(slate, sunlit, clamp(lit.mul(1.4), 0.0, 1.0)).add(u.mistTint.mul(0.05));
        const foam = smoothstep(0.86, 1.0, v).mul(0.6).add(1.0);
        return vec4(col.mul(foam).mul(water), water.mul(0.85));
    });
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = vertex;
    const out = shade();
    material.colorNode = out;
    material.outputNode = out;
    material.transparent = true;
    material.premultipliedAlpha = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    return material;
}

export function buildWater(world) {
    const { u, textures, preset } = world;
    const group = new THREE.Group();
    group.name = 'sunfall-water';
    const disposables = [];
    const rng = mulberry32(world.seed ^ 0x3a73);

    // Rain.
    const drops = Math.max(60, preset.showerDrops || 300);
    const rainGeo = new THREE.PlaneGeometry(1, 1);
    rainGeo.deleteAttribute('normal');
    const dd = new Float32Array(drops * 4);
    for (let i = 0; i < drops; i += 1) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng());
        dd.set([Math.cos(a) * r, Math.sin(a) * r, rng(), 9 + rng() * 6], i * 4);
    }
    rainGeo.setAttribute('aDrop', new THREE.InstancedBufferAttribute(dd, 4));
    const rainMat = createRainMaterial(u);
    const rain = new THREE.InstancedMesh(rainGeo, rainMat, drops);
    rain.frustumCulled = false;
    rain.renderOrder = 40;
    group.add(rain);
    disposables.push(rainGeo, rainMat);

    // The cataract and the threads.
    const fallGeo = new THREE.PlaneGeometry(1, 1, 1, 64);
    fallGeo.deleteAttribute('normal');
    const fd = new Float32Array(SUNFALL_FALLS.length * 4);
    SUNFALL_FALLS.forEach((f, i) => {
        const [x, z] = fallStation(i);
        fd.set([x, z, f.width, i], i * 4);
    });
    fallGeo.setAttribute('aFall', new THREE.InstancedBufferAttribute(fd, 4));
    const fallMat = createFallMaterial(u, textures);
    const falls = new THREE.InstancedMesh(fallGeo, fallMat, SUNFALL_FALLS.length);
    falls.frustumCulled = false;
    falls.renderOrder = 41;
    group.add(falls);
    disposables.push(fallGeo, fallMat);

    return {
        group,
        update() {},
        dispose() {
            disposables.forEach((d) => d.dispose());
        },
    };
}
