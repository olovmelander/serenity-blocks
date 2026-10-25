/**
 * Grainfields — what the herd kicks up.
 *
 *  - Dust: each hoof that strikes the ground at a trot or faster throws a puff of the field's dry
 *    soil up through the barley. It bursts out, slows in the air, swells, rises a little on its
 *    own warmth and drifts away on the wind: a running band leaves a haze hanging behind it that
 *    blazes when the sun is low beyond it.
 *  - Chaff: a cantering or galloping horse breasts the ripe ears and throws husks and awns ahead of
 *    and beside its chest; a grazing horse that tears a mouthful away scatters a few. Flakes that
 *    tumble (glinting as they turn) and flutter down.
 *
 * One instanced quad per record in a ring the CPU writes when a kick happens (where, which way,
 * when, how long, how big, which kind); the vertex stage flies each from its record in closed
 * form, so nothing is written per frame and a seek simply empties the ring. Camera-facing, soft,
 * additive and premultiplied (the target's alpha is left alone), no depth write.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    dot,
    exp,
    float,
    instanceIndex,
    length,
    max,
    mix,
    positionGeometry,
    select,
    sin,
    smoothstep,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { deckShadow, gfHash21 } from './grainfields-tsl.js';

/** The kinds a record may be. */
export const DUST = 0;
export const CHAFF = 1;

/**
 * How each kind flies (per second): `drag` slows its throw, `rise` lifts it (dust's warmth; chaff
 * falls), `drift` how much of the wind carries it.
 */
const FLIGHT = Object.freeze({
    [DUST]: Object.freeze({ drag: 2.4, rise: 0.22, drift: 0.55 }),
    [CHAFF]: Object.freeze({ drag: 1.1, rise: -0.32, drift: 0.9 }),
});

function dustMaterial(u, t) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'GrainfieldsHerdDust';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.fog = false;
    material.side = THREE.DoubleSide;
    const aFrom = attribute('aFrom', 'vec4'); // spawn xyz, birth time
    const aGo = attribute('aGo', 'vec4'); // velocity xyz, life (s)
    const aLook = attribute('aLook', 'vec4'); // size at birth, size grown, kind, seed
    const vGlow = varying(vec4(0.0), 'gfHerdDustGlow'); // rgb, softness
    material.positionNode = Fn(() => {
        const age = u.time.sub(aFrom.w).toVar();
        const life = max(aGo.w, 0.1);
        const k = clamp(age.div(life), 0.0, 1.0);
        const chaff = aLook.z.greaterThan(0.5);
        const drag = select(chaff, float(FLIGHT[CHAFF].drag), float(FLIGHT[DUST].drag));
        const rise = select(chaff, float(FLIGHT[CHAFF].rise), float(FLIGHT[DUST].rise));
        const drift = select(chaff, float(FLIGHT[CHAFF].drift), float(FLIGHT[DUST].drift));
        const a = max(age, 0.0);
        // The throw slowing in the air, the rise (or the fall), the wind, a flake's flutter.
        const thrown = aGo.xyz.mul(float(1.0).sub(exp(a.mul(drag).negate())).div(drag));
        const wind = vec3(u.windDir.x, 0.0, u.windDir.y).mul(u.windStrength.add(0.25).mul(drift).mul(a));
        const h = gfHash21(vec2(float(instanceIndex), aLook.w.mul(97.0)));
        const flutter = vec3(sin(a.mul(5.3).add(h.mul(40.0))), 0.0, sin(a.mul(4.1).add(h.mul(23.0))))
            .mul(select(chaff, float(0.12), float(0.0)));
        const centre = aFrom.xyz.add(thrown).add(wind).add(vec3(0.0, rise.mul(a), 0.0)).add(flutter)
            .toVar();
        // A puff swells as it slows; a flake keeps its size.
        const size = mix(aLook.x, aLook.y, float(1.0).sub(exp(a.mul(-2.2)))).toVar();
        const dist = length(centre.sub(u.eye));
        const s = max(size, dist.mul(u.pixelAngle).mul(1.2));
        const p = positionGeometry;
        const at = centre.add(u.camRight.mul(p.x.mul(s))).add(u.camUp.mul(p.y.mul(s)));
        // Born quickly, gone over its last half; nothing before its birth.
        const live = smoothstep(0.0, 0.06, k).mul(float(1.0).sub(smoothstep(0.45, 1.0, k)))
            .mul(select(age.greaterThan(0.0), float(1.0), float(0.0)));
        // Lit by the sun through the deck, far more with the sun beyond it (dust scatters forward),
        // a little by the sky.
        const sunlit = deckShadow(u, t.noise, centre).mul(u.sunUp);
        const V = centre.sub(u.eye).normalize();
        const ahead = clamp(dot(V, u.sunDir), 0.0, 1.0);
        const a2 = ahead.mul(ahead);
        const phase = a2.mul(a2).mul(1.6).add(a2.mul(0.5)).add(0.2);
        // Barley dust is the field's gold; a husk glints as it turns.
        const turn = sin(a.mul(mix(float(7.0), float(15.0), h)).add(h.mul(60.0))).mul(0.45).add(0.55);
        const cover = size.div(s).mul(size.div(s));
        const tone = select(chaff, vec3(1.0, 0.8, 0.46).mul(turn).mul(cover.mul(0.7).add(0.3)), vec3(0.55, 0.44, 0.28));
        const strength = select(chaff, float(0.9), float(0.07)).mul(live);
        const light = u.sun.mul(sunlit.mul(phase)).add(u.fill.mul(0.9));
        vGlow.assign(vec4(tone.mul(light).mul(strength), select(chaff, float(5.0), float(2.2))));
        // A dead record's quad collapses onto its spawn point at no size.
        return mix(aFrom.xyz, at, select(live.greaterThan(0.0), float(1.0), float(0.0)));
    })();
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        return vec4(vGlow.xyz.mul(exp(dot(q, q).mul(vGlow.w.negate()))).mul(0.3), 0.0);
    })();
    material.outputNode = vec4(material.colorNode.xyz, 0.0);
    return material;
}

/**
 * The herd's dust and chaff: a ring of `count` records. `kick({ x, y, z, vx, vy, vz, life, size,
 * grow, kind, time })` throws one; `reset()` empties the ring.
 */
export function createHerdDust(u, t, count = 384) {
    const ring = Math.max(32, Math.round(count));
    const plane = new THREE.PlaneGeometry(2, 2);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.attributes.position);
    geometry.setAttribute('uv', plane.attributes.uv);
    const from = new Float32Array(ring * 4);
    const go = new Float32Array(ring * 4);
    const look = new Float32Array(ring * 4);
    const empty = () => {
        from.fill(0);
        go.fill(0);
        look.fill(0);
        for (let i = 0; i < ring; i++) from[i * 4 + 3] = -1e6;
    };
    empty();
    const aFrom = new THREE.InstancedBufferAttribute(from, 4);
    const aGo = new THREE.InstancedBufferAttribute(go, 4);
    const aLook = new THREE.InstancedBufferAttribute(look, 4);
    [aFrom, aGo, aLook].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aFrom', aFrom);
    geometry.setAttribute('aGo', aGo);
    geometry.setAttribute('aLook', aLook);
    geometry.instanceCount = ring;
    const material = dustMaterial(u, t);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'GrainfieldsHerdDust';
    mesh.frustumCulled = false;
    mesh.renderOrder = 25;
    let next = 0;
    let dirty = false;
    let thrown = 0;

    return {
        mesh,
        ring,
        get thrown() { return thrown; },
        kick({
            x, y, z, vx = 0, vy = 1, vz = 0, life = 3, size = 0.25, grow = size, kind = DUST, time = 0, seed = Math.random(),
        }) {
            const o = next * 4;
            from[o] = x;
            from[o + 1] = y;
            from[o + 2] = z;
            from[o + 3] = time;
            go[o] = vx;
            go[o + 1] = vy;
            go[o + 2] = vz;
            go[o + 3] = life;
            look[o] = size;
            look[o + 1] = grow;
            look[o + 2] = kind;
            look[o + 3] = seed;
            next = (next + 1) % ring;
            thrown += 1;
            dirty = true;
        },
        update() {
            if (!dirty) return;
            aFrom.needsUpdate = true;
            aGo.needsUpdate = true;
            aLook.needsUpdate = true;
            dirty = false;
        },
        reset() {
            empty();
            next = 0;
            dirty = true;
        },
        dispose() {
            geometry.dispose();
            plane.dispose();
            material.dispose();
        },
    };
}
