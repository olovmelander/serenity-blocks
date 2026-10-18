/**
 * Grainfields — motes in the air over the field.
 *
 *  - Chaff and pollen drift over the barley round the eye all the time, carried along the wind
 *    and bobbing: dull in the deck's shade, they glint gold where the sun reaches them, and blaze
 *    when the sun is behind them. Closed form on the GPU (each mote's place is a function of its
 *    index and the clock), nothing written per frame.
 *  - The events' motes: a lock's beam lifts pigment dust of the piece's colour up through its
 *    light, a clear's trail throws chaff of the rows' colours along its lane. Spawned into a ring
 *    of records (where, which way, when, how long, what colour) the CPU writes when an event lands;
 *    the GPU flies each one from its record.
 *
 * Camera-facing quads, round soft sprites, never under about a pixel; additive and premultiplied
 * (the target's alpha is left alone), no depth write.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    cos,
    dot,
    exp,
    float,
    fract,
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
import { EYE } from './grainfields-core.js';

/** Where the ambient motes fly: metres from the eye, bearings, height over the ground. */
const AMBIENT = Object.freeze({
    near: 3, far: 70, bearing: 58, low: 0.3, high: 7.5, span: 90,
});

function spriteMaterial(name) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = name;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.fog = false;
    material.side = THREE.DoubleSide;
    return material;
}

/** A quad's corner offset for a sprite of `size` metres at `centre`, never under ~1.2 pixels. */
function billboard(u, centre, size) {
    const dist = length(centre.sub(u.eye));
    const s = max(size, dist.mul(u.pixelAngle).mul(1.2));
    const p = positionGeometry;
    return { at: centre.add(u.camRight.mul(p.x.mul(s))).add(u.camUp.mul(p.y.mul(s))), dist, s };
}

/** How a mote glints: the sun through the deck at it, more with the sun behind it. */
function glint(u, t, centre) {
    const sunlit = deckShadow(u, t.noise, centre).mul(u.sunUp);
    const V = centre.sub(u.eye).normalize();
    const ahead = clamp(dot(V, u.sunDir), 0.0, 1.0);
    const a2 = ahead.mul(ahead);
    return { sunlit, phase: a2.mul(a2).mul(2.2).add(a2.mul(0.5)).add(0.25) };
}

function ambientMaterial(u, t) {
    const material = spriteMaterial('GrainfieldsMotesAmbient');
    const vGlow = varying(vec4(0.0), 'gfMoteGlow');
    material.positionNode = Fn(() => {
        const i = float(instanceIndex);
        const h1 = gfHash21(vec2(i, 1.7));
        const h2 = gfHash21(vec2(i, 9.3));
        const h3 = gfHash21(vec2(i, 23.1));
        const h4 = gfHash21(vec2(i, 41.9));
        // A home in front of the eye (log-distance, so as many near as far on screen) that the
        // wind carries along and wraps round.
        const dist = exp(mix(float(Math.log(AMBIENT.near)), float(Math.log(AMBIENT.far)), h1));
        const bearing = h2.sub(0.5).mul((2 * AMBIENT.bearing * Math.PI) / 180);
        const home = vec2(sin(bearing).mul(dist).add(EYE.x), cos(bearing).mul(dist).negate().add(EYE.z));
        const speed = mix(float(1.2), float(3.4), h3).mul(u.windStrength.add(0.3));
        const run = fract(u.time.mul(speed).div(AMBIENT.span).add(h4)).sub(0.5).mul(AMBIENT.span);
        const across = vec2(u.windDir.y.negate(), u.windDir.x);
        const wobble = sin(u.time.mul(mix(float(0.7), float(1.6), h2)).add(h1.mul(40.0))).mul(1.2);
        const xz = home.add(u.windDir.mul(run)).add(across.mul(wobble));
        const height = mix(float(AMBIENT.low), float(AMBIENT.high), h3.mul(h3))
            .add(sin(u.time.mul(1.3).add(h4.mul(30.0))).mul(0.35));
        const centre = vec3(xz.x, float(EYE.y - 1.45).add(height), xz.y);
        const size = mix(float(0.004), float(0.012), h4);
        const sprite = billboard(u, centre, size);
        const light = glint(u, t, centre);
        // Fade in and out at the ends of the run, and with distance.
        const edge = smoothstep(0.5, 0.38, run.div(AMBIENT.span).abs());
        const fade = edge.mul(smoothstep(AMBIENT.far, AMBIENT.far * 0.6, sprite.dist));
        // Chaff gold, the odd seed of down white; brighter the smaller the true size (a glint).
        const tone = mix(vec3(1.0, 0.78, 0.42), vec3(1.0, 0.97, 0.9), smoothstep(0.82, 0.9, h1));
        const flicker = sin(u.time.mul(mix(float(4.0), float(9.0), h3)).add(h2.mul(60.0))).mul(0.35).add(0.65);
        const cover = size.div(sprite.s).mul(size.div(sprite.s));
        vGlow.assign(vec4(tone.mul(light.sunlit.mul(light.phase).add(0.04)).mul(fade).mul(flicker).mul(cover.mul(0.7).add(0.3)), 1.0));
        return sprite.at;
    })();
    const shape = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        return exp(dot(q, q).mul(-3.2));
    });
    material.colorNode = Fn(() => vec4(vGlow.xyz.mul(u.sun).mul(shape()).mul(0.32), 0.0))();
    material.outputNode = vec4(material.colorNode.xyz, 0.0);
    return material;
}

function eventMaterial(u, t) {
    const material = spriteMaterial('GrainfieldsMotesEvents');
    const aFrom = attribute('aFrom', 'vec4'); // spawn xyz, birth time
    const aGo = attribute('aGo', 'vec4'); // velocity xyz, life (s)
    const aTint = attribute('aTint', 'vec4'); // colour rgb, size (m)
    const vGlow = varying(vec4(0.0), 'gfEventMoteGlow');
    material.positionNode = Fn(() => {
        const age = u.time.sub(aFrom.w);
        const life = max(aGo.w, 0.1);
        const k = clamp(age.div(life), 0.0, 1.0);
        // Up through the beam (or out along the lane), carried by the wind and spiralling.
        const i = float(instanceIndex);
        const h = gfHash21(vec2(i, 3.3));
        const spin = age.mul(mix(float(1.5), float(3.0), h)).add(h.mul(30.0));
        const swirl = vec3(sin(spin), 0.0, cos(spin)).mul(age.mul(0.25).min(1.2));
        const wind = vec3(u.windDir.x, 0.0, u.windDir.y).mul(age.mul(age).mul(0.35).mul(u.windStrength.add(0.3)));
        const centre = aFrom.xyz.add(aGo.xyz.mul(age)).add(wind).add(swirl);
        const sprite = billboard(u, centre, aTint.w);
        const light = glint(u, t, centre);
        const live = smoothstep(0.0, 0.08, k).mul(float(1.0).sub(smoothstep(0.55, 1.0, k)))
            .mul(select(age.greaterThan(0.0), float(1.0), float(0.0)));
        const sparkle = sin(age.mul(mix(float(6.0), float(13.0), h)).add(h.mul(50.0))).mul(0.4).add(0.6);
        const cover = aTint.w.div(sprite.s).mul(aTint.w.div(sprite.s));
        // Pigment dust glows of its own colour in the light, and a little in the shade.
        const tone = aTint.xyz.mul(1.4).add(vec3(0.12, 0.1, 0.06));
        vGlow.assign(vec4(tone.mul(light.sunlit.mul(light.phase).add(0.18)).mul(live).mul(sparkle).mul(cover.mul(0.6).add(0.4)), 1.0));
        // A dead record's sprite collapses onto its spawn point at no size.
        return mix(aFrom.xyz, sprite.at, select(live.greaterThan(0.0), float(1.0), float(0.0)));
    })();
    const shape = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        return exp(dot(q, q).mul(-3.0));
    });
    material.colorNode = Fn(() => vec4(vGlow.xyz.mul(u.sun).mul(shape()).mul(0.3), 0.0))();
    material.outputNode = vec4(material.colorNode.xyz, 0.0);
    return material;
}

function quad() {
    const plane = new THREE.PlaneGeometry(2, 2);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.attributes.position);
    geometry.setAttribute('uv', plane.attributes.uv);
    return { geometry, plane };
}

/**
 * The motes: `count` in all (tier.motes), most of them ambient, the rest the events' ring.
 * `burst({ x, y, z, count, spread, up, out, rgb, life, size, time })` spawns event motes.
 */
export function createMotes(u, t, count) {
    const ambientCount = Math.max(64, Math.round(count * 0.6));
    const ring = Math.max(128, Math.round(count * 0.4));
    const ambient = quad();
    ambient.geometry.instanceCount = ambientCount;
    const ambientMesh = new THREE.Mesh(ambient.geometry, ambientMaterial(u, t));
    ambientMesh.name = 'GrainfieldsMotesAmbient';
    ambientMesh.frustumCulled = false;
    ambientMesh.renderOrder = 26;

    const events = quad();
    const from = new Float32Array(ring * 4).fill(-1e6);
    const go = new Float32Array(ring * 4);
    const tint = new Float32Array(ring * 4);
    for (let i = 0; i < ring; i++) from[i * 4 + 3] = -1e6;
    const aFrom = new THREE.InstancedBufferAttribute(from, 4);
    const aGo = new THREE.InstancedBufferAttribute(go, 4);
    const aTint = new THREE.InstancedBufferAttribute(tint, 4);
    [aFrom, aGo, aTint].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    events.geometry.setAttribute('aFrom', aFrom);
    events.geometry.setAttribute('aGo', aGo);
    events.geometry.setAttribute('aTint', aTint);
    events.geometry.instanceCount = ring;
    const eventMesh = new THREE.Mesh(events.geometry, eventMaterial(u, t));
    eventMesh.name = 'GrainfieldsMotesEvents';
    eventMesh.frustumCulled = false;
    eventMesh.renderOrder = 27;
    let next = 0;
    let dirty = false;
    let random = 0x9e3779b9;
    const rand = () => {
        random = (random + 0x6d2b79f5) >>> 0;
        let z = random;
        z = Math.imul(z ^ (z >>> 15), z | 1);
        z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
        return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };

    return {
        mesh: ambientMesh,
        meshes: [ambientMesh, eventMesh],
        counts: { ambient: ambientCount, ring },
        burst({
            x, y, z, count: n = 24, spread = 2, up = 1, out = 0.4, rgb = [1, 0.85, 0.5], life = 6, size = 0.012, time = 0,
        }) {
            for (let k = 0; k < n; k++) {
                const o = next * 4;
                const a = rand() * Math.PI * 2;
                const r = Math.sqrt(rand()) * spread;
                from[o] = x + Math.cos(a) * r;
                from[o + 1] = y + rand() * 0.8;
                from[o + 2] = z + Math.sin(a) * r;
                from[o + 3] = time + rand() * 0.6;
                go[o] = Math.cos(a) * out * (0.5 + rand());
                go[o + 1] = up * (0.5 + rand());
                go[o + 2] = Math.sin(a) * out * (0.5 + rand());
                go[o + 3] = life * (0.7 + rand() * 0.6);
                tint[o] = rgb[0];
                tint[o + 1] = rgb[1];
                tint[o + 2] = rgb[2];
                tint[o + 3] = size * (0.6 + rand() * 0.8);
                next = (next + 1) % ring;
            }
            dirty = true;
        },
        update() {
            if (!dirty) return;
            aFrom.needsUpdate = true;
            aGo.needsUpdate = true;
            aTint.needsUpdate = true;
            dirty = false;
        },
        reset() {
            random = 0x9e3779b9;
            next = 0;
            from.fill(0);
            for (let i = 0; i < ring; i++) from[i * 4 + 3] = -1e6;
            dirty = true;
        },
        dispose() {
            [ambient, events].forEach(({ geometry, plane }) => {
                geometry.dispose();
                plane.dispose();
            });
            ambientMesh.material.dispose();
            eventMesh.material.dispose();
        },
    };
}
