import * as THREE from 'three/webgpu';
import {
    attribute, float, fwidth, mix, normalWorld, positionGeometry, sin, smoothstep,
    texture, uniform, uniformArray, uv, vec2, vec3, length, exp, max, dot,
    atan, clamp,
} from 'three/tsl';
import { resolveWolfhourComposition } from './wolfhour-composition.js';

/** `value` within 0..`top` (0 when it is not a number). */
const clampTo = (value, top) => Math.max(0, Math.min(top, Number.isFinite(value) ? value : 0));

export function wolfhourRandom(seed = 73013) {
    let value = seed >>> 0;
    return () => {
        value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
        return value / 4294967296;
    };
}

// A small tile carries the expensive noise work. Two filtered taps replace
// repeated fragment FBM across the entire sky and the valley mist.
export function makeWolfhourNoiseTexture() {
    const size = 128;
    const random = wolfhourRandom(1979);
    const lattice = new Float32Array(size * size);
    for (let i = 0; i < lattice.length; i++) lattice[i] = random();
    const sample = (x, y, period = 128) => {
        const ix = Math.floor(x); const iy = Math.floor(y);
        const fx = x - ix; const fy = y - iy;
        const sx = fx * fx * (3 - 2 * fx); const sy = fy * fy * (3 - 2 * fy);
        const at = (a, b) => lattice[((b & (period - 1)) * size) + (a & (period - 1))];
        return THREE.MathUtils.lerp(
            THREE.MathUtils.lerp(at(ix, iy), at(ix + 1, iy), sx),
            THREE.MathUtils.lerp(at(ix, iy + 1), at(ix + 1, iy + 1), sx),
            sy,
        );
    };
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let n = 0;
            for (let octave = 0; octave < 5; octave++) {
                const f = 2 ** octave / 8;
                n += sample(x * f, y * f, Math.min(128, 16 * 2 ** octave)) * 0.5 ** (octave + 1);
            }
            const i = (y * size + x) * 4;
            pixels[i] = Math.round(n * 255);
            pixels[i + 1] = Math.round(sample(x / 2, y / 2, 64) * 255);
            pixels[i + 2] = 0; pixels[i + 3] = 255;
        }
    }
    const map = new THREE.DataTexture(pixels, size, size);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearFilter;
    map.needsUpdate = true;
    return map;
}

/**
 * The halo plane reaches HALO_SPAN times the corona's old reach, so the lunar halo ring fits on it;
 * the corona is computed in the same units as before (identical at rest).
 */
const HALO_SPAN = 1.7;
/** The lunar halo ring (in corona radius units: the moon's disc is ~0.38): radius and width. */
const HALO_RING = Object.freeze({ radius: 0.92, width: 0.06 });

/**
 * The moon's atmosphere. `uWake` (0 at rest) is how far play has woken the moon: its corona
 * glows wider and brighter. `uHalo` (0 at rest) draws the halo of a cold night, a ring of light
 * round the moon in the ice of high cirrus with two brighter moon dogs on it either side: hot
 * play brings it out faintly, a fever or a perfect clear in full.
 */
function createCorona(maxPulses, noiseMap, uWake, uHalo) {
    const uTime = uniform(0);
    const pulseValues = Array.from({ length: maxPulses }, () => new THREE.Vector4());
    const pulseData = uniformArray(pulseValues, 'vec4');
    const p = uv().sub(0.5).mul(HALO_SPAN);
    const radius = length(p).mul(2);
    const angle = atan(p.y, p.x.add(0.00001));
    const mist = texture(noiseMap, p.mul(vec2(2.4, 2.8)).add(0.5)
        .add(vec2(uTime.mul(0.006), uTime.mul(-0.004)))).r;
    const breathing = sin(uTime.mul(0.31)).mul(0.08).add(0.92);
    // The corona widens and brightens as the moon wakes.
    const corona = exp(max(radius.sub(0.36), 0).mul(uWake.mul(4.2).sub(9.5))).mul(0.026)
        .mul(mist.mul(0.6).add(0.65)).mul(breathing)
        .mul(uWake.mul(2.4).add(1));
    let rings = float(0);
    let tint = float(0);
    for (let i = 0; i < maxPulses; i++) {
        const pulse = pulseData.element(i);
        const age = clamp(uTime.sub(pulse.x).mul(pulse.y), 0, 1);
        const envelope = sin(age.mul(Math.PI)).pow2().mul(pulse.z);
        const phase = age.mul(0.35).add(i * 1.63);
        const arc = sin(angle.mul(3).add(phase)).add(sin(angle.mul(7).sub(phase)).mul(0.45));
        const brokenArc = smoothstep(-0.05, 0.8, arc).mul(mist.mul(0.6).add(0.4));
        const ringRadius = age.mul(0.46).add(0.4).add(mist.sub(0.5).mul(0.14));
        const width = age.mul(0.038).add(0.035);
        const softArc = exp(radius.sub(ringRadius).div(width).pow2().mul(-1.8));
        // One diffuse, irregular wave replaces the pair of unbroken circles.
        // It thins into the sky as it expands instead of leaving a neon outline.
        rings = rings.add(softArc.mul(envelope).mul(brokenArc).div(age.mul(2.2).add(1)));
        tint = tint.add(envelope.mul(pulse.w));
    }
    const haloColor = mix(vec3(0.46, 0.57, 0.80), vec3(0.78, 0.85, 0.98), clamp(tint, 0, 1));
    const alpha = clamp(corona.add(rings.mul(0.14)), 0, uWake.mul(0.14).add(0.18))
        .mul(float(1).sub(smoothstep(0.83, 1, radius)));
    // The halo ring: a sharp inner edge, a soft outer one, broken a little by the ice it shines
    // in; the moon dogs left and right of the moon brighter, faintly red inside and blue outside.
    const d = radius.sub(HALO_RING.radius).div(HALO_RING.width);
    const inside = d.min(0);
    const outside = d.max(0);
    const ring = exp(inside.mul(inside).mul(-3).sub(outside.mul(outside).mul(0.45)));
    const across = sin(angle);
    const dogs = exp(across.mul(across).mul(-40)).mul(3).add(1);
    // Squared: hot play shows a ghost of it, a fever the full ring.
    const ringAlpha = ring.mul(dogs).mul(mist.mul(0.7).add(0.45)).mul(uHalo.mul(uHalo)).mul(0.085)
        .mul(float(1).sub(smoothstep(1.35, 1.65, radius)));
    const ringColor = mix(vec3(0.98, 0.8, 0.66), vec3(0.62, 0.74, 1.0), smoothstep(-1.2, 1.6, d));
    const total = alpha.add(ringAlpha);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    material.colorNode = haloColor.mul(alpha).add(ringColor.mul(ringAlpha)).div(max(total, 0.0001));
    material.opacityNode = total;
    material.emissiveNode = haloColor.mul(alpha).mul(0.2).add(ringColor.mul(ringAlpha).mul(0.35));
    return {
        material, uniforms: { uTime }, pulseValues, pulseData, maxPulses,
    };
}

export function createWolfhourSky({ scene, quality = 'High', aspect = 16 / 9 }) {
    const group = new THREE.Group();
    group.name = 'Wolfhour celestial sky';
    scene.add(group);
    const uTime = uniform(0);
    const uPulse = uniform(0);
    // How hard play runs (all 0 at rest, see setSurge): the moon wakes and lights more of the
    // sky, the halo comes out, the sky opens (the cloud thins, the star band shows) and the stars
    // burn brighter and twinkle harder.
    const uWake = uniform(0);
    const uHalo = uniform(0);
    const uOpen = uniform(0);
    const uStarGain = uniform(0);
    const uMoonSky = uniform(new THREE.Vector2(-500, 225));
    const uMoonStars = uniform(new THREE.Vector2(-500, 225));
    const uMoonRadius = uniform(55);
    const noiseMap = makeWolfhourNoiseTexture();
    // Procedural detail belongs to the sky plane. Translating it for parallax
    // must not make the cloud/noise pattern slide over the surface.
    const p = positionGeometry.xy;
    const horizon = smoothstep(-380, 580, p.y);
    // Night blue: a deep indigo zenith over a slate-blue horizon glow.
    const skyBase = mix(vec3(0.0062, 0.0095, 0.021), vec3(0.0006, 0.0009, 0.0026), horizon);
    const n = texture(noiseMap, p.mul(vec2(0.00065, 0.0011)).add(vec2(uTime.mul(0.00045), 0))).r;
    const fine = texture(noiseMap, p.mul(vec2(0.002, 0.0035))).r;
    const bandDistance = p.y.sub(p.x.mul(0.39)).sub(320).add(n.sub(0.5).mul(170));
    const band = exp(bandDistance.div(135).pow2().negate());
    const dust = smoothstep(0.28, 0.74, n).mul(fine.mul(0.5).add(0.5));
    const rMoon = length(p.sub(uMoonSky));
    const moonScatter = exp(rMoon.div(uMoonRadius.mul(1.9)).pow2().negate());
    // A wide, faint aureole: the moon lights the whole upper-left of the sky a little.
    const moonGlow = exp(rMoon.div(uMoonRadius.mul(7.5)).negate());
    const cirrus = smoothstep(0.53, 0.78, n.add(fine.mul(0.13)))
        .mul(exp(p.y.sub(45).div(230).pow2().negate()));
    const skyColor = skyBase
        .add(vec3(0.0028, 0.0034, 0.0052).mul(band).mul(dust).mul(uOpen.mul(1.3).add(1)))
        .add(vec3(0.0052, 0.0068, 0.0115).mul(moonScatter).mul(uWake.mul(0.9).add(1)))
        .add(vec3(0.0045, 0.0062, 0.0105).mul(moonGlow).mul(uWake.mul(1.5).add(1)))
        .add(vec3(0.008, 0.0092, 0.0125).mul(cirrus).mul(float(0.1).add(uPulse.mul(0.04))));
    const skyMaterial = new THREE.MeshBasicNodeMaterial({ depthWrite: false });
    skyMaterial.colorNode = skyColor;
    skyMaterial.emissiveNode = vec3(0);
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(6200, 2300), skyMaterial);
    sky.name = 'Wolfhour sky plane';
    sky.position.z = -6500;
    sky.renderOrder = -6500;
    group.add(sky);

    // Fixed world-space quads give subpixel stars and occasional bright anchors
    // without a compute pass, per-frame uploads, or r186's one-pixel Points limit.
    const count = {
        Minimal: 1200, Low: 2000, Medium: 3800, High: 6000, Ultra: 7600, Extreme: 9200,
    }[quality] || 6000;
    const random = wolfhourRandom();
    const geometry = new THREE.PlaneGeometry(1, 1);
    const starsMaterial = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const phases = new Float32Array(count * 4);
    const centers = new Float32Array(count * 2);
    const starP = uv().sub(0.5).mul(2);
    const radiusSquared = dot(starP, starP);
    const a = attribute('aStar', 'vec4');
    const center = attribute('aCenter', 'vec2');
    const twinkle = sin(uTime.mul(a.y).add(a.x)).mul(mix(0.1, 0.055, a.w)).mul(uStarGain.mul(1.6).add(1))
        .add(0.9);
    const moonSuppression = smoothstep(uMoonRadius.mul(1.05), uMoonRadius.mul(2.6), length(center.sub(uMoonStars)));
    // Widen subpixel cores by their pixel footprint, conserving integrated light.
    // This keeps faint stars from blinking out as the camera crosses a pixel.
    const footprint = fwidth(starP);
    const coreWidth = float(0.09).add(dot(footprint, footprint).mul(0.07));
    const starCore = exp(radiusSquared.div(coreWidth).negate()).mul(float(0.09).div(coreWidth));
    const rayX = float(1).sub(smoothstep(0.025, 0.15, starP.x.abs()))
        .mul(float(1).sub(smoothstep(0.1, 1, starP.y.abs())));
    const rayY = float(1).sub(smoothstep(0.025, 0.15, starP.y.abs()))
        .mul(float(1).sub(smoothstep(0.1, 1, starP.x.abs())));
    const starShape = starCore.add(rayX.add(rayY).mul(a.w).mul(0.085));
    const starTint = mix(vec3(0.74, 0.82, 1.0), vec3(1, 0.94, 0.86), smoothstep(0.85, 1, a.x.div(6.283)));
    starsMaterial.colorNode = starTint.mul(a.z);
    starsMaterial.opacityNode = clamp(starShape.mul(twinkle).mul(moonSuppression)
        .mul(float(0.94).add(uPulse.mul(0.06)).add(uStarGain.mul(0.4))), 0, 1);
    starsMaterial.emissiveNode = starTint.mul(starShape).mul(a.z).mul(twinkle).mul(moonSuppression)
        .mul(uStarGain.mul(0.1).add(0.14));
    const stars = new THREE.InstancedMesh(geometry, starsMaterial, count);
    stars.name = 'Wolfhour stars';
    stars.frustumCulled = false;
    const transform = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
        const x = (random() - 0.5) * 4000;
        const bandStar = i % 4 === 0;
        const y = bandStar
            ? x * 0.16 + 220 + (random() + random() + random() - 1.5) * 190
            : random() * 1000 - 240;
        const bright = random();
        const anchor = !bandStar && bright > 0.996;
        const prominent = !bandStar && bright > 0.97;
        let size = 1.7 + random() * 2.4;
        let flux = 0.22 + bright ** 2.8 * 1.55;
        if (bandStar) {
            size = 1.4 + random() * 1.7;
            flux = 0.22 + bright * 0.5;
        } else if (anchor) {
            size = 8 + random() * 4;
            flux = 2.4 + random() * 1.1;
        } else if (prominent) {
            size = 4.2 + random() * 1.8;
            flux = 1.65 + random() * 0.4;
        }
        transform.makeScale(size, size, 1);
        transform.setPosition(x, y, -5800);
        stars.setMatrixAt(i, transform);
        centers[i * 2] = x; centers[i * 2 + 1] = y;
        phases[i * 4] = random() * Math.PI * 2;
        phases[i * 4 + 1] = 0.28 + random() * 0.62;
        phases[i * 4 + 2] = flux;
        phases[i * 4 + 3] = anchor ? 1 : 0;
    }
    geometry.setAttribute('aStar', new THREE.InstancedBufferAttribute(phases, 4));
    geometry.setAttribute('aCenter', new THREE.InstancedBufferAttribute(centers, 2));
    group.add(stars);

    const moonTexture = new THREE.TextureLoader().load('./textures/2k_moon.jpg');
    moonTexture.colorSpace = THREE.SRGBColorSpace;
    const moonPulse = uniform(0);
    const moonLight = uniform(new THREE.Vector3(-0.72, 0.3, 0.98).normalize());
    const moonIllumination = uniform(0.955);
    const moonSample = max(texture(moonTexture).rgb, vec3(0)).pow(1.08);
    const incidence = dot(normalWorld, moonLight);
    const lightCos = max(incidence, 0);
    const viewCos = max(normalWorld.z, 0);
    // A lunar scattering response keeps the illuminated disk flatter than a
    // Lambert sphere while retaining a directional terminator and dark maria.
    const lunarLight = clamp(lightCos.div(lightCos.add(viewCos).add(0.06)).mul(1.8), 0, 1)
        .mul(smoothstep(-0.035, 0.085, incidence));
    const lunarColor = moonSample.mul(mix(vec3(0.034, 0.044, 0.068), vec3(0.93, 0.955, 1.0), lunarLight))
        .mul(moonIllumination.add(moonPulse.mul(0.085)));
    const moonMaterial = new THREE.MeshBasicNodeMaterial();
    moonMaterial.colorNode = lunarColor;
    moonMaterial.emissiveNode = lunarColor.mul(0.06);
    const lowTier = quality === 'Minimal' || quality === 'Low';
    const moon = new THREE.Mesh(new THREE.SphereGeometry(126, lowTier ? 24 : 48, lowTier ? 16 : 28), moonMaterial);
    moon.name = 'Wolfhour moon';
    moon.position.set(-500, 225, -2600);
    moon.rotation.y = -0.34;
    group.add(moon);
    const haloData = createCorona({
        Minimal: 2, Low: 2, Medium: 3, High: 4, Ultra: 6, Extreme: 6,
    }[quality] || 4, noiseMap, uWake, uHalo);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(670 * HALO_SPAN, 670 * HALO_SPAN), haloData.material);
    halo.name = 'Wolfhour lunar atmosphere';
    halo.position.set(-500, 225, -2740);
    group.add(halo);

    // Moonlit clouds: a thin, broken layer drifting east between the moon and the mountains.
    // Lit by the moon by how close they pass to it; their thin edges near it take a silver
    // lining, and now and then one veils the moon itself. Slow: never a flash.
    const uMoonClouds = uniform(new THREE.Vector2(-500, 225));
    let clouds = null;
    if (quality !== 'Minimal') {
        const cp = positionGeometry.xy;
        const drift = vec2(cp.x.add(uTime.mul(5.5)), cp.y);
        const broad = texture(noiseMap, drift.mul(vec2(0.00034, 0.0011)).add(vec2(0.21, 0.63))).r;
        const detail = texture(noiseMap, drift.mul(vec2(0.0011, 0.0034))
            .add(vec2(uTime.mul(0.0007).add(0.57), 0.12))).r;
        // Cloud gathers in a band across the upper sky (world y 140..520) and thins toward the
        // ridges and the top of the frame.
        const deck = smoothstep(-200, -60, cp.y).mul(float(1).sub(smoothstep(160, 320, cp.y)));
        const cover = smoothstep(0.47, 0.72, broad.mul(0.68).add(detail.mul(0.32)).add(deck.sub(1).mul(0.24)));
        const toMoon = cp.sub(uMoonClouds);
        const near = exp(length(toMoon).div(uMoonRadius).mul(-0.5));
        const thin = float(1).sub(smoothstep(0.45, 0.95, cover));
        const lit = mix(vec3(0.026, 0.034, 0.058), vec3(0.13, 0.155, 0.21), near.mul(0.7).add(0.1));
        const silver = vec3(0.55, 0.6, 0.72).mul(near.mul(near)).mul(thin).mul(cover)
            .mul(uWake.mul(0.9).add(1.6));
        const cloudMaterial = new THREE.MeshBasicNodeMaterial({
            name: 'Wolfhour moonlit clouds', transparent: true, depthWrite: false,
        });
        cloudMaterial.colorNode = lit.add(silver);
        // The sky opens as play runs hot: the cloud thins away.
        cloudMaterial.opacityNode = cover.mul(float(0.8).sub(uOpen.mul(0.42)));
        clouds = new THREE.Mesh(new THREE.PlaneGeometry(6200, 1300), cloudMaterial);
        clouds.name = 'Wolfhour moonlit clouds';
        clouds.position.set(0, 300, -2300);
        group.add(clouds);
    }

    let moonBaseX = 0;
    let moonBaseY = 0;
    let cameraX = 0;
    let cameraY = 0;
    const placeLayers = () => {
        sky.position.x = cameraX * 0.975;
        sky.position.y = cameraY * 0.975;
        stars.position.x = cameraX * 0.955;
        stars.position.y = cameraY * 0.955;
        moon.position.x = moonBaseX + cameraX * 0.915;
        moon.position.y = moonBaseY + cameraY * 0.915;
        halo.position.x = moon.position.x;
        halo.position.y = moon.position.y;
        if (clouds) {
            clouds.position.x = cameraX * 0.93;
            clouds.position.y = 300 + cameraY * 0.93;
            uMoonClouds.value.set(moon.position.x - clouds.position.x, moon.position.y - clouds.position.y);
        }
        // The glow and star attenuation use the moon in each layer's own space.
        uMoonSky.value.set(moon.position.x - sky.position.x, moon.position.y - sky.position.y);
        uMoonStars.value.set(moon.position.x - stars.position.x, moon.position.y - stars.position.y);
    };
    const applyParallax = (camera) => {
        cameraX = Number.isFinite(camera?.position?.x) ? camera.position.x : 0;
        cameraY = Number.isFinite(camera?.position?.y) ? camera.position.y : 0;
        placeLayers();
    };
    // `composition` overrides where the moon rests (the playground's icon lens uses it).
    const resize = (nextAspect, composition = null) => {
        const { moonX, moonY, moonScale } = composition ?? resolveWolfhourComposition(nextAspect);
        moonBaseX = moonX;
        moonBaseY = moonY;
        moon.scale.setScalar(moonScale); halo.scale.setScalar(moonScale);
        uMoonRadius.value = 126 * moonScale;
        placeLayers();
    };
    resize(aspect);
    return {
        group,
        starCount: count,
        moon,
        halo,
        moonTexture,
        noiseMap,
        moonNodeData: { material: moonMaterial, uniforms: { uPulse: moonPulse } },
        moonHaloNodeData: haloData,
        update(time, state = {}) {
            uTime.value = time;
            uPulse.value = Math.min(1.5, state.nebulaDefinition || 0);
            haloData.uniforms.uTime.value = time;
            // Absolute-time libration reveals the maria slowly and remains stable
            // when seeking, resizing or returning from a backgrounded tab.
            moon.rotation.set(
                Math.sin(time * 0.09) * 0.035,
                -0.34 + Math.sin(time * 0.06) * 0.17 + Math.sin(time * 0.17) * 0.035,
                -0.07 + Math.sin(time * 0.055) * 0.008,
            );
            moonLight.value.set(
                -0.72 + Math.sin(time * 0.105) * 0.13,
                0.3 + Math.sin(time * 0.07) * 0.04,
                0.98,
            ).normalize();
            moonIllumination.value = 0.955 + Math.sin(time * 0.2) * 0.018 + Math.sin(time * 0.071) * 0.007;
        },
        /**
         * How hard play runs: `wake` (the moon's corona and its light on the sky), `halo` (the
         * lunar halo and its moon dogs), `open` (the cloud thins, the star band shows) and `stars`
         * (brighter, harder twinkling). All 0 at rest: the night as it always was.
         */
        setSurge({
            wake = 0, halo: ring = 0, open = 0, stars: starGain = 0,
        } = {}) {
            uWake.value = clampTo(wake, 1.4);
            uHalo.value = clampTo(ring, 1.6);
            uOpen.value = clampTo(open, 1);
            uStarGain.value = clampTo(starGain, 1.4);
        },
        applyParallax,
        resize,
        dispose() {
            group.removeFromParent();
            group.traverse((o) => {
                o.geometry?.dispose();
                o.material?.dispose();
                o.dispose?.();
            });
            noiseMap.dispose(); moonTexture.dispose();
            group.clear();
        },
    };
}
