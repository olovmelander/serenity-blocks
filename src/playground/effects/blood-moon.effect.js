/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Blood Moon — crimson eclipse. One sky, one textured lunar body, one corona,
 * and bounded instanced star/dust/ejecta fields. No full-screen bloom chain.
 * The analytical emitter halos preserve small highlights without lifting space.
 * ?quality=High&board=1&event=tetris&eventAge=.45&t=8
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, abs, atan, attribute, cameraProjectionMatrix, cameraViewMatrix, clamp, cross, dot, exp, float,
    length, max, mix,
    normalize, normalLocal, positionGeometry, sin, smoothstep, texture,
    uniform, uniformArray, uv, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';
import { createAuthoredLunarSurface } from './blood-moon-surface.js';
import { BLOOD_MOON_TIERS, BloodMoonReactions, resolveBloodMoonLayout } from './blood-moon-state.js';
import { createBloodMoonMotionEnvelope, sampleBloodMoonMotion } from './blood-moon-motion.js';
import { createBloodMoonBursts } from './blood-moon-bursts.js';

export const meta = {
    id: 'blood-moon',
    title: 'Blood Moon — crimson eclipse',
    description: 'A blood-red eclipsed moon, wine-dark nebulae, crimson stars and floating lunar embers.',
};

function seededRandom(seed = 0xb100d) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function makeInstances(count, fields, random) {
    const geometry = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(2, 2);
    geometry.index = quad.index.clone();
    geometry.setAttribute('position', quad.attributes.position.clone());
    geometry.setAttribute('uv', quad.attributes.uv.clone());
    quad.dispose();
    for (const [name, size, fill] of fields) {
        const data = new Float32Array(count * size);
        for (let i = 0; i < count; i++) fill(data, i * size, random, i);
        geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, size));
    }
    geometry.instanceCount = count;
    return geometry;
}

function mesh(scene, geometry, material, name, order = 0) {
    const object = new THREE.Mesh(geometry, material);
    object.name = name;
    object.frustumCulled = false;
    object.renderOrder = order;
    scene.add(object);
    return object;
}

function transparentMaterial(name) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    material.name = name;
    return material;
}

function createSky(scene, shared, nebula) {
    const material = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false });
    material.name = 'blood-moon-nebula';
    material.vertexNode = vec4(positionGeometry.xy, 0.9999, 1);
    material.colorNode = Fn(() => {
        const p = uv().toVar();
        const drift = vec2(shared.time.mul(0.0018), shared.time.mul(-0.0009));
        const space = p.sub(0.5).mul(shared.skyScale).add(0.5).add(shared.skyOffset)
            .toVar();
        const flow = vec2(
            sin(space.y.mul(5).add(shared.time.mul(0.06))),
            sin(space.x.mul(4).sub(shared.time.mul(0.045))),
        ).mul(0.014);
        // Density only: the existing authored cloud texture is recoloured in linear light.
        const n = texture(nebula, space.mul(vec2(1.05, 0.76)).add(drift).add(flow)
            .add(vec2(0.04, 0.13))).rgb.toVar();
        const detail = texture(nebula, space.mul(vec2(1.54, 1.12)).sub(drift).sub(flow)
            .add(shared.skyOffset.mul(0.6))
            .add(vec2(0.28, 0.42))).rgb.toVar();
        const density = max(n.r, n.b.mul(0.8)).toVar();
        const fine = max(detail.r, detail.b).toVar();
        // A sweeping river above/right of the hero; black dust lanes cross the emission.
        const band = exp(p.y.sub(p.x.mul(0.5).add(0.22)).pow(2).mul(-14));
        const outer = smoothstep(0.51, 0.96, p.x);
        const gas = mix(vec3(0.64, 0.006, 0.023), vec3(0.3, 0.002, 0.015), outer);
        const clouds = gas.mul(density.pow(1.15)).mul(band.mul(0.95).add(0.2));
        const filaments = mix(vec3(1.1, 0.032, 0.052), vec3(0.7, 0.012, 0.035), outer)
            .mul(fine.pow(2.2)).mul(band).mul(0.38);
        const moonDistance = length(p.sub(shared.center).mul(vec2(shared.aspect, 1)));
        const atmosphere = exp(moonDistance.mul(moonDistance).mul(-8))
            .mul(vec3(0.055, 0.0007, 0.0025)).mul(shared.corona.mul(4).add(1));
        const quiet = float(1).sub(exp(p.x.sub(0.52).pow(2).mul(-100))
            .mul(exp(p.y.sub(0.42).pow(2).mul(-6))).mul(0.64));
        const vignette = float(1).sub(smoothstep(0.3, 0.85, length(p.sub(0.5))).mul(0.55));
        return vec3(0.003, 0.00015, 0.0006).add(clouds.add(filaments).mul(quiet)
            .mul(shared.corona.mul(0.35).add(1)))
            .add(atmosphere).mul(vignette);
    })();
    return mesh(scene, new THREE.PlaneGeometry(2, 2), material, 'blood-moon-sky', -10);
}

function createMoon(scene, shared, surface, detail) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'blood-moon-lunar-relief';
    // The moon is at astronomical distance: an orthographic disk keeps its limb
    // circular off-axis and exactly registered with the analytical corona.
    material.vertexNode = vec4(
        shared.center.mul(2).sub(1)
            .add(positionGeometry.xy.mul(shared.radius.mul(2)).div(vec2(shared.aspect, 1))),
        float(0.5).sub(positionGeometry.z.mul(0.1)),
        1,
    );
    material.colorNode = Fn(() => {
        const n = normalize(normalLocal).toVar();
        const tangent = normalize(vec3(n.z.add(0.00001), 0, n.x.negate())).toVar();
        const bitangent = cross(n, tangent);
        // The authored near-side geology is centered at u=.5, SphereGeometry at .25.
        const lunarUv = uv().add(vec2(shared.moonRotation.add(0.25), 0));
        const relief = texture(surface.normalTexture, lunarUv).xyz.mul(2).sub(1).toVar();
        const surfaceNormal = normalize(tangent.mul(relief.x.mul(1.05)).add(bitangent.mul(relief.y.mul(1.05)))
            .add(n.mul(relief.z))).toVar();
        const albedo = texture(surface.texture, lunarUv).r.toVar();
        const key = normalize(vec3(-0.68, 0.43, 0.59));
        // Broad eclipse lighting gives the body depth; relief only modulates it.
        const globeLight = max(dot(n, key), 0);
        const light = mix(globeLight, max(dot(surfaceNormal, key), 0), 0.32).toVar();
        const terminator = smoothstep(-0.16, 0.62, dot(n, normalize(vec3(-0.58, 0.36, 0.58))));
        const mineral = smoothstep(0.13, 0.76, albedo);
        const stone = mix(vec3(0.028, 0.0006, 0.0028), vec3(0.92, 0.007, 0.018), mineral);
        const shade = light.mul(0.75).add(0.17).mul(terminator.mul(0.8).add(0.2));
        const body = stone.mul(shade).toVar();
        // Refracted red light remains visible across the eclipse's umbra.
        body.addAssign(vec3(0.045, 0.0008, 0.003).mul(albedo).mul(float(1).sub(terminator)));
        const edge = float(1).sub(max(n.z, 0)).pow(5);
        const litLimb = smoothstep(-0.25, 0.75, dot(n, normalize(vec3(-0.55, 0.65, 0.05))));
        body.addAssign(vec3(0.78, 0.008, 0.023).mul(edge).mul(litLimb.mul(0.85).add(0.15))
            .mul(shared.corona.mul(1.5).add(0.25)));
        return body.mul(shared.pulse.mul(0.18).add(shared.lunarEnergy.mul(0.38)).add(1));
    })();
    return mesh(scene, new THREE.SphereGeometry(1, detail, detail / 2), material, 'blood-moon-body');
}

function createCorona(scene, shared, nebula) {
    const material = transparentMaterial('blood-moon-corona');
    material.depthTest = false;
    material.vertexNode = vec4(shared.center.mul(2).sub(1).add(positionGeometry.xy.mul(shared.radius.mul(4.8))
        .div(vec2(shared.aspect, 1))), 0.998, 1);
    material.colorNode = Fn(() => {
        const p = uv().sub(0.5).mul(4.8).toVar();
        const r = length(p).toVar();
        const outside = smoothstep(0.993, 1.018, r);
        const d = max(r.sub(1), 0).toVar();
        const direction = p.x.mul(-0.55).add(p.y.mul(0.65)).div(max(r, 0.01));
        const lit = smoothstep(-0.4, 0.85, direction);
        const angle = atan(p.y, p.x.add(0.00001)).toVar();
        const tongues = sin(angle.mul(19).sub(shared.time.mul(1.6)))
            .mul(sin(angle.mul(31).add(shared.time.mul(0.9)))).mul(0.5).add(0.5);
        const rim = exp(d.mul(-85)).mul(shared.corona.mul(2.8).add(0.1))
            .mul(lit.mul(0.6).add(0.4));
        const halo = exp(d.mul(-6)).mul(shared.corona.mul(0.65).add(0.05))
            .add(exp(d.mul(-3.2)).mul(shared.corona.mul(0.14).add(0.019)));
        const fire = exp(d.mul(float(-16).add(tongues.mul(8))))
            .mul(tongues.pow(3)).mul(shared.corona).mul(0.9);
        const hotRim = vec3(1.7, 0.24, 0.31).mul(exp(d.mul(-145)))
            .mul(shared.corona).mul(0.7);
        const reaction = vec3(0).toVar();
        // Match the current Wolfhour sky's diffuse, broken lunar wave. Fold it
        // into the existing corona draw; the idle path skips its texture tap.
        If(shared.lunarActive.greaterThan(0), () => {
            const radius = r.div(335 / 126).toVar();
            const mist = texture(nebula, p.mul(vec2(0.48, 0.56)).add(0.5)
                .add(vec2(shared.time.mul(0.006), shared.time.mul(-0.004)))).r.toVar();
            const rings = float(0).toVar();
            const tint = float(0).toVar();
            for (let i = 0; i < shared.lunarPulseValues.length; i++) {
                const pulse = shared.lunarPulses.element(i);
                const progress = clamp(pulse.x.mul(pulse.y), 0, 1).toVar();
                const envelope = sin(progress.mul(Math.PI)).pow2().mul(pulse.z).toVar();
                const phase = progress.mul(0.35).add(i * 1.63);
                const arc = sin(angle.mul(3).add(phase))
                    .add(sin(angle.mul(7).sub(phase)).mul(0.45));
                const broken = smoothstep(-0.05, 0.8, arc).mul(mist.mul(0.6).add(0.4));
                const front = progress.mul(0.46).add(0.4).add(mist.sub(0.5).mul(0.14));
                const width = progress.mul(0.038).add(0.035);
                const softArc = exp(radius.sub(front).div(width).pow2().mul(-1.8));
                rings.addAssign(softArc.mul(envelope).mul(broken).div(progress.mul(2.2).add(1)));
                tint.addAssign(envelope.mul(pulse.w));
            }
            reaction.assign(mix(vec3(2.1, 0.006, 0.025), vec3(2.8, 0.018, 0.05), clamp(tint, 0, 1))
                .mul(rings.mul(0.55)));
        });
        return vec3(1.6, 0.012, 0.035).mul(rim.add(halo).add(fire)).add(hotRim).add(reaction)
            .mul(outside)
            .mul(float(1).sub(smoothstep(2.1, 2.4, r)));
    })();
    material.opacityNode = float(1);
    return mesh(scene, new THREE.PlaneGeometry(2, 2), material, 'blood-moon-corona', 2);
}

function createStars(scene, shared, count, random) {
    const geometry = makeInstances(count, [
        ['aStar', 4, (a, o, rand, i) => {
            a[o] = rand() * 1.16 - 0.08; a[o + 1] = rand() * 1.16 - 0.08;
            // Blood-red pinpoints with a few pale rose navigation stars.
            a[o + 2] = i % Math.max(32, Math.floor(count / 14)) === 0
                ? 3.2 + rand() * 2 : 0.35 + rand() ** 4 * 1.6;
            a[o + 3] = rand() * Math.PI * 2;
        }],
        ['aDepth', 1, (a, o, rand) => { a[o] = rand(); }],
        ['aTint', 3, (a, o, rand) => {
            const c = rand();
            a[o] = 1;
            if (c < 0.86) {
                a[o + 1] = 0.004 + rand() * 0.018;
                a[o + 2] = 0.016 + rand() * 0.035;
            } else {
                a[o + 1] = c < 0.97 ? 0.13 : 0.52;
                a[o + 2] = c < 0.97 ? 0.2 : 0.6;
            }
        }],
    ], random);
    const material = transparentMaterial('blood-moon-stellar-points');
    const star = attribute('aStar', 'vec4');
    const screenCenter = varyingProperty('vec2', 'vBloodStarCenter');
    material.vertexNode = Fn(() => {
        const distance = attribute('aDepth', 'float').mul(66).add(24);
        const world = vec3(star.xy.sub(0.5).mul(distance.mul(0.828427))
            .mul(vec2(shared.aspect, 1)), float(12).sub(distance));
        const projected = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1)).toVar();
        screenCenter.assign(projected.xy.div(projected.w).mul(0.5).add(0.5));
        return vec4(projected.xy.add(positionGeometry.xy.mul(star.z.mul(5).add(2))
            .div(shared.viewport).mul(projected.w)), projected.zw);
    })();
    material.colorNode = Fn(() => {
        const p = uv().sub(0.5).mul(2).toVar();
        const r2 = dot(p, p).toVar();
        const core = exp(r2.mul(mix(float(-16), float(-38), smoothstep(0.35, 2, star.z)))).mul(1.9);
        const halo = exp(r2.mul(-6)).mul(0.24);
        const bright = smoothstep(2, 3.5, star.z);
        const spikes = exp(abs(p.x).mul(-150)).mul(exp(abs(p.y).mul(-5)))
            .add(exp(abs(p.y).mul(-150)).mul(exp(abs(p.x).mul(-5)))).mul(bright)
            .mul(0.2);
        const twinkle = sin(shared.time.mul(0.5).add(star.w)).mul(0.13).add(0.87);
        const quiet = float(1).sub(exp(screenCenter.x.sub(0.52).pow(2).mul(-140)).mul(0.5));
        return attribute('aTint', 'vec3').mul(core.add(halo).add(spikes))
            .mul(star.z.mul(0.9)).mul(twinkle)
            .mul(quiet)
            .mul(shared.starBoost.mul(bright.mul(0.8).add(0.65)).add(1));
    })();
    material.opacityNode = float(1);
    return mesh(scene, geometry, material, 'blood-moon-stars', -2);
}

function createMotes(scene, shared, count, random) {
    const geometry = makeInstances(count, [
        ['aMote', 4, (a, o, rand) => {
            a[o] = rand(); a[o + 1] = rand(); a[o + 2] = rand(); a[o + 3] = rand() * 6.28;
        }],
    ], random);
    const material = transparentMaterial('blood-moon-ember-dust');
    material.depthTest = false;
    const mote = attribute('aMote', 'vec4');
    const drift = vec2(
        sin(shared.time.mul(0.12).add(mote.w)).mul(0.045),
        shared.time.mul(mote.z.mul(0.004).add(0.0015)),
    );
    const center = varyingProperty('vec2', 'vBloodDustCenter');
    material.vertexNode = Fn(() => {
        const distance = mote.z.mul(18).add(8);
        const world = vec3(mote.xy.add(drift).fract().mul(1.3).sub(0.65)
            .mul(distance.mul(0.828427))
            .mul(vec2(shared.aspect, 1)), float(12).sub(distance));
        const projected = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1)).toVar();
        center.assign(projected.xy.div(projected.w).mul(0.5).add(0.5));
        return vec4(projected.xy.add(positionGeometry.xy.mul(mote.z.pow(3).mul(13).add(2.5))
            .div(shared.viewport).mul(projected.w)), projected.zw);
    })();
    material.colorNode = Fn(() => {
        const p = uv().sub(0.5).mul(2);
        const glow = exp(dot(p, p).mul(-7));
        const flicker = sin(shared.time.mul(0.6).add(mote.w)).mul(0.22).add(0.64);
        const moonMask = smoothstep(
            shared.radius.mul(1.06),
            shared.radius.mul(1.28).add(0.001),
            length(center.sub(shared.center).mul(vec2(shared.aspect, 1))),
        );
        return mix(vec3(1.2, 0.004, 0.018), vec3(3, 0.025, 0.065), mote.z)
            .mul(glow).mul(flicker).mul(moonMask)
            .mul(shared.starBoost.mul(0.7).add(0.85));
    })();
    material.opacityNode = float(1);
    return mesh(scene, geometry, material, 'blood-moon-dust', 3);
}

function createWave(scene, shared) {
    const material = transparentMaterial('blood-moon-eclipse-wave');
    material.depthTest = false;
    material.vertexNode = vec4(positionGeometry.xy, 0.8, 1);
    material.colorNode = Fn(() => {
        const p = uv().sub(shared.center).mul(vec2(shared.aspect, 1));
        const r = length(p);
        const age = shared.waveAge;
        const front = shared.radius.add(age.mul(0.13));
        const edge = exp(abs(r.sub(front)).mul(-480));
        const wake = exp(abs(r.sub(front.sub(0.009))).mul(-130)).mul(0.12);
        const broken = sin(p.x.mul(78).add(p.y.mul(29))).mul(0.18).add(0.82);
        const fade = exp(age.mul(-1.5)).mul(smoothstep(0, 0.09, age));
        const outside = smoothstep(shared.radius, shared.radius.add(0.008), r);
        return vec3(0.85, 0.028, 0.052).mul(edge.add(wake)).mul(broken)
            .mul(fade)
            .mul(shared.waveStrength)
            .mul(outside);
    })();
    material.opacityNode = float(1);
    return mesh(scene, new THREE.PlaneGeometry(2, 2), material, 'blood-moon-wave', 4);
}

function boardOverlay() {
    const root = document.createElement('div');
    root.className = 'blood-moon-preview-board';
    root.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);'
        + 'width:min(25vw,280px);height:min(70vh,560px);border:1px solid #89718466;'
        + 'border-radius:16px;background:linear-gradient(#0b0c18d9,#090a14e8);'
        + 'pointer-events:none;z-index:3;box-shadow:0 16px 60px #0008';
    document.body.appendChild(root);
    return root;
}

export function create({
    scene, camera, renderer, params = new URLSearchParams(), sizes,
}) {
    const quality = params.get('quality') || 'High';
    const tier = BLOOD_MOON_TIERS[quality] || BLOOD_MOON_TIERS.High;
    const random = seededRandom(Number(params.get('seed') || 724461));
    const saved = {
        tone: renderer.toneMapping,
        exposure: renderer.toneMappingExposure,
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
    };
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    camera.fov = 45; camera.near = 0.1; camera.far = 120;
    camera.position.set(0, 0, 12); camera.lookAt(0, 0, 0);
    const shared = {
        time: uniform(0),
        aspect: uniform(1),
        viewport: uniform(new THREE.Vector2(1280, 800)),
        center: uniform(new THREE.Vector2(0.235, 0.62)),
        radius: uniform(0.23),
        moonRotation: uniform(0),
        skyOffset: uniform(new THREE.Vector2()),
        skyScale: uniform(1),
        pulse: uniform(0),
        lunarEnergy: uniform(0),
        lunarActive: uniform(0),
        lunarPulseValues: Array.from({ length: 4 }, () => new THREE.Vector4()),
        corona: uniform(0),
        starBoost: uniform(0),
        waveAge: uniform(100),
        waveStrength: uniform(0),
    };
    shared.lunarPulses = uniformArray(shared.lunarPulseValues, 'vec4');
    const surface = createAuthoredLunarSurface(THREE, tier.surfaceSize);
    let loaded = false;
    let resolveNebula;
    const nebulaReady = new Promise((resolve) => { resolveNebula = resolve; });
    const nebula = new THREE.TextureLoader().load('./textures/blood-moon/nebula-red-1.png', () => {
        loaded = true;
        resolveNebula();
    }, undefined, () => {
        loaded = true;
        resolveNebula();
    });
    nebula.colorSpace = THREE.NoColorSpace;
    nebula.wrapS = THREE.RepeatWrapping;
    nebula.wrapT = THREE.RepeatWrapping;
    const sky = createSky(scene, shared, nebula);
    const moon = createMoon(scene, shared, surface, quality === 'Minimal' ? 48 : 96);
    const corona = createCorona(scene, shared, nebula);
    const stars = createStars(scene, shared, tier.stars, random);
    const motes = createMotes(scene, shared, tier.motes, random);
    const wave = createWave(scene, shared);
    const bursts = createBloodMoonBursts({
        scene, shared, count: tier.sparks, random,
    });
    const objects = [sky, moon, corona, stars, motes, wave];
    let disposed = false;
    let preparing = null;
    const prepare = () => {
        if (!preparing) {
            preparing = (async () => {
                await Promise.all([nebulaReady, surface.ready]);
                if (disposed) return;
                // Compile dormant event materials before gameplay can fire them.
                const eventObjects = [wave, ...bursts.objects];
                const visibility = eventObjects.map((object) => object.visible);
                eventObjects.forEach((object) => { object.visible = true; });
                try { await renderer.compileAsync(scene, camera); } finally {
                    eventObjects.forEach((object, i) => { object.visible = visibility[i]; });
                }
            })();
        }
        return preparing;
    };
    const reactions = new BloodMoonReactions();
    const overlay = params.get('board') === '1' ? boardOverlay() : null;
    let width = sizes?.width || window.innerWidth;
    let height = sizes?.height || window.innerHeight;
    let rects = [];
    let layout;
    let motionEnvelope;
    const moonPose = {};
    let reducedMotion = false;
    let enabled = true;
    let now = 0;
    const pointer = new THREE.Vector2();
    const pointerTarget = new THREE.Vector2();
    const distantAnchor = new THREE.Vector3();
    const onPointer = (event) => {
        pointerTarget.set(
            Math.max(-1, Math.min(1, (event.clientX / width) * 2 - 1)),
            Math.max(-1, Math.min(1, 1 - (event.clientY / height) * 2)),
        );
    };
    const clearPointer = () => pointerTarget.set(0, 0);
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('blur', clearPointer);
    const moveCamera = (time = now) => {
        const t = reducedMotion ? 0 : time;
        const px = reducedMotion ? 0 : pointer.x;
        const py = reducedMotion ? 0 : pointer.y;
        const impact = reducedMotion ? 0 : reactions.impact;
        camera.position.set(
            Math.sin(t * 0.11) * 0.95 + Math.sin(t * 0.23) * 0.15 + px * 0.35
                + Math.sin(t * 83) * impact * 0.09,
            Math.sin(t * 0.13) * 0.55 + py * 0.25 + Math.cos(t * 71) * impact * 0.05,
            12 + Math.sin(t * 0.15) * 0.65,
        );
        camera.lookAt(Math.sin(t * 0.09) * 0.18, Math.sin(t * 0.12) * 0.12, 0);
        camera.updateMatrixWorld();
        // Distant gas follows camera orientation; nearby dust responds more strongly.
        distantAnchor.set(0, 0, -70).project(camera);
        shared.skyOffset.value.set(-distantAnchor.x * 0.5, -distantAnchor.y * 0.5);
        shared.skyScale.value = 1 + (camera.position.z - 12) * 0.018;
    };
    const resize = (w = width, h = height) => {
        width = Math.max(1, w); height = Math.max(1, h);
        const preview = overlay?.getBoundingClientRect();
        const obstacles = preview ? [preview] : rects;
        layout = resolveBloodMoonLayout(width, height, obstacles);
        motionEnvelope = createBloodMoonMotionEnvelope(layout, width, height, obstacles);
        shared.aspect.value = width / height;
        // NDC sprite sizes are expressed in CSS pixels; DPI changes affect sharpness only.
        shared.viewport.value.set(width, height);
        const densityScale = Math.min(1, Math.max(0.3, (width * height) / (1280 * 800)));
        stars.geometry.instanceCount = Math.round(tier.stars * densityScale);
        motes.geometry.instanceCount = Math.round(tier.motes * densityScale);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    };
    const update = (time, dt = 0) => {
        now = time;
        const delta = Math.max(0, Math.min(dt, 0.05));
        reactions.update(delta);
        pointer.lerp(pointerTarget, 1 - Math.exp(-delta * 4));
        const t = reducedMotion ? 0 : time;
        shared.time.value = t;
        sampleBloodMoonMotion(motionEnvelope, t, pointer.x, pointer.y, reducedMotion, moonPose);
        moonPose.radius = Math.min(motionEnvelope.maxRadius / height, moonPose.radius * (1 + reactions.impact * 0.018));
        shared.center.value.set(moonPose.x, moonPose.y);
        shared.radius.value = moonPose.radius;
        shared.moonRotation.value = (t * 0.0028) % 1;
        moveCamera(t);
        shared.pulse.value = reactions.pulse;
        shared.lunarEnergy.value = reactions.lunarEnergy;
        shared.lunarActive.value = 0;
        for (let i = 0; i < shared.lunarPulseValues.length; i++) {
            const pulse = reactions.lunarPulses[i];
            if (pulse.strength > 0 && Number.isFinite(pulse.age)) {
                shared.lunarPulseValues[i].set(pulse.age, 1 / pulse.duration, pulse.strength, pulse.combo);
                shared.lunarActive.value = 1;
            } else shared.lunarPulseValues[i].set(0, 0, 0, 0);
        }
        shared.corona.value = reactions.corona;
        shared.starBoost.value = reactions.starBoost;
        shared.waveAge.value = Number.isFinite(reactions.waveAge) ? reactions.waveAge : 100;
        shared.waveStrength.value = reactions.waveStrength;
        wave.visible = enabled && !reducedMotion && reactions.waveAge < 3.5;
        bursts.update(delta);
    };
    const cue = (kind, data) => {
        if (!enabled) return;
        const burstStrength = reactions.cue(kind, data);
        if (!reducedMotion && burstStrength > 0) {
            bursts.trigger(burstStrength);
        }
    };
    resize(); update(0);
    return {
        cameraRadius: 12,
        camera: moveCamera,
        update,
        resize,
        prepare,
        setLayout(next) { rects = next || []; resize(); },
        setReducedMotion(value) {
            reducedMotion = !!value;
            reactions.reducedMotion = reducedMotion;
            if (reducedMotion) bursts.reset();
        },
        setEffectsEnabled(value) {
            enabled = !!value;
            if (!enabled) { reactions.reset(); bursts.reset(); }
        },
        cue,
        seek(time) {
            pointer.set(0, 0);
            pointerTarget.set(0, 0);
            reactions.reset();
            bursts.reset();
            if (enabled && params.has('event')) {
                const age = Math.max(0, Math.min(8, Number(params.get('eventAge') || 0.45)));
                update(Math.max(0, time - age), 0);
                reactions.cue(params.get('event'), {
                    lineCount: Number(params.get('lines') || 4),
                    comboCount: Number(params.get('combo') || 4),
                });
                if (!reducedMotion && reactions.burst > 0) bursts.seek(age, reactions.burst);
                for (let t = 0; t < age; t += 1 / 60) reactions.update(Math.min(1 / 60, age - t));
            }
            update(time, 0);
        },
        render() { renderer.render(scene, camera); },
        getRendererCounters() {
            return { drawCalls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles };
        },
        getCaptureMeta() { return { quality, seed: Number(params.get('seed') || 724461) }; },
        getActiveParticleCount() {
            return stars.geometry.instanceCount + motes.geometry.instanceCount
                + bursts.objects.reduce((total, object) => total + (object.visible ? tier.sparks : 0), 0);
        },
        async renderAsync() {
            await prepare();
            if (!disposed) renderer.render(scene, camera);
        },
        getDiagnostics() {
            return {
                quality,
                loaded,
                lunarSurface: surface.source,
                time: now,
                layout,
                moon: { ...moonPose, rotation: shared.moonRotation.value },
                camera: camera.position.toArray(),
                reaction: {
                    pulse: reactions.pulse,
                    corona: reactions.corona,
                    starBoost: reactions.starBoost,
                    impact: reactions.impact,
                    lunarEnergy: reactions.lunarEnergy,
                    lunarPulses: reactions.lunarPulses.map((pulse) => ({ ...pulse })),
                },
                stars: stars.geometry.instanceCount,
                motes: motes.geometry.instanceCount,
                sparks: tier.sparks,
                activeWave: wave.visible,
                activeEjecta: bursts.objects.some((object) => object.visible),
                bursts: bursts.getDiagnostics(),
            };
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            window.removeEventListener('pointermove', onPointer);
            window.removeEventListener('blur', clearPointer);
            overlay?.remove();
            for (const object of objects) scene.remove(object);
            for (const object of bursts.objects) scene.remove(object);
            const release = () => {
                for (const object of objects) { object.geometry.dispose(); object.material.dispose(); }
                bursts.dispose();
                surface.dispose(); nebula.dispose();
            };
            if (preparing) preparing.then(release, release);
            else release();
            renderer.toneMapping = saved.tone; renderer.toneMappingExposure = saved.exposure;
            camera.fov = saved.fov; camera.near = saved.near; camera.far = saved.far;
            camera.updateProjectionMatrix();
        },
    };
}
