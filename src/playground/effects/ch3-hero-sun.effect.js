/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// Batch-1 prototype for the Odyssey Chapter 3 composition pass: a golden-hour HERO
// SUN placed LOW and to the LEFT of a mountain ridge, over a warm sky dome, with a
// god-ray fan. Goal: judge sun colour/size/placement + warmth BEFORE porting the
// tuned values into surface-world.tsl.js (createSunDiscTSL / createSkyBackgroundTSL /
// createSunRaysTSL). Self-contained: no project shared modules.
import * as THREE from 'three/webgpu';
import {
    uniform, mix, vec3, float, uv, length, smoothstep, oneMinus, sin, pow,
    positionLocal, normalize, clamp, abs,
} from 'three/tsl';

export const meta = {
    id: 'ch3-hero-sun',
    title: 'Ch3 Hero Sun (golden hour)',
    description: 'Warm sun low-left of a mountain ridge + god rays + warm sky. Batch-1 composition probe.',
};

// Sun direction: LEFT (-x), low (small +y), far forward (-z). This is the value to
// port into surface-world.tsl.js (today it is (0.40, 0.16, -0.90) — front-RIGHT).
const SUN_DIR = new THREE.Vector3(-0.46, 0.17, -0.86).normalize();
const SUN_DIST = 900;

export function create({ scene, camera }) {
    const uTime = uniform(0);
    const disposables = [];
    const track = (obj) => { disposables.push(obj); return obj; };

    // ── 1. Warm golden-hour sky dome ──────────────────────────────────────────
    const dir = normalize(positionLocal);
    const h = clamp(dir.y.mul(0.5).add(0.5), 0.0, 1.0);
    const zenith = vec3(0.12, 0.37, 0.66); // deep azure
    const midSky = vec3(0.30, 0.58, 0.82); // azure
    const horizon = vec3(0.96, 0.78, 0.50); // warm gold haze
    let sky = mix(horizon, midSky, smoothstep(0.0, 0.28, h));
    sky = mix(sky, zenith, smoothstep(0.30, 0.85, h));
    // In-dome warm glow lobe toward the sun direction (cheap "scattering").
    const sunDot = clamp(dir.dot(vec3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z)), 0.0, 1.0);
    const glow = pow(sunDot, 6.0).mul(0.7).add(pow(sunDot, 60.0).mul(0.8));
    sky = sky.add(vec3(1.0, 0.72, 0.38).mul(glow));

    const skyMat = new THREE.MeshBasicNodeMaterial();
    skyMat.colorNode = sky;
    skyMat.side = THREE.BackSide;
    skyMat.depthWrite = false;
    skyMat.fog = false;
    skyMat.toneMapped = false;
    const skyGeo = new THREE.SphereGeometry(4000, 48, 24);
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    skyMesh.frustumCulled = false;
    scene.add(skyMesh);
    track(skyGeo); track(skyMat); track(skyMesh);

    // ── 2. Mountain ridge silhouette (stand-in for the canonical range) ───────
    // Dark slate range with a peaky top edge + a little snow, biased to frame-right
    // so the sun reads clearly to its LEFT. Aerial-perspective lighten toward base.
    const ruv = uv();
    const peak = float(0.46)
        .add(sin(ruv.x.mul(6.3)).mul(0.16))
        .add(sin(ruv.x.mul(15.7).add(1.3)).mul(0.09))
        .add(sin(ruv.x.mul(33.0).add(2.1)).mul(0.05));
    const ridgeAlpha = oneMinus(smoothstep(peak.sub(0.006), peak.add(0.006), ruv.y));
    const slate = vec3(0.16, 0.22, 0.34);
    const haze = vec3(0.55, 0.66, 0.78);
    const aerial = smoothstep(peak, 0.0, ruv.y).mul(0.5); // lighter near base
    let ridgeCol = mix(slate, haze, aerial);
    // Snow near the crest line.
    const snow = smoothstep(peak.sub(0.05), peak.sub(0.005), ruv.y).mul(smoothstep(0.5, 0.66, peak));
    ridgeCol = mix(ridgeCol, vec3(0.92, 0.95, 1.0), snow.mul(0.85));

    const ridgeMat = new THREE.MeshBasicNodeMaterial();
    ridgeMat.colorNode = ridgeCol;
    ridgeMat.opacityNode = ridgeAlpha;
    ridgeMat.transparent = true;
    ridgeMat.depthWrite = false;
    ridgeMat.fog = false;
    ridgeMat.toneMapped = false;
    ridgeMat.side = THREE.DoubleSide;
    const ridgeGeo = new THREE.PlaneGeometry(1700, 520);
    const ridgeMesh = new THREE.Mesh(ridgeGeo, ridgeMat);
    ridgeMesh.position.set(120, 150, -560); // biased right + behind, base near horizon
    ridgeMesh.renderOrder = -50;
    ridgeMesh.frustumCulled = false;
    scene.add(ridgeMesh);
    track(ridgeGeo); track(ridgeMat); track(ridgeMesh);

    // ── 3. The HERO sun disc (warm, additive, bloom-eligible) ─────────────────
    const sunWorld = new THREE.Vector3(SUN_DIR.x * SUN_DIST, SUN_DIR.y * SUN_DIST, SUN_DIR.z * SUN_DIST);
    const centered = uv().sub(0.5);
    const d = length(centered);
    const core = oneMinus(smoothstep(0.0, 0.17, d));
    const corona = oneMinus(smoothstep(0.10, 0.36, d));
    const halo = oneMinus(smoothstep(0.20, 0.5, d));
    const uCore = vec3(1.0, 0.95, 0.80);
    const uCorona = vec3(1.0, 0.76, 0.40);
    const uHalo = vec3(1.0, 0.55, 0.22);
    const surface = mix(uCore, uCorona, smoothstep(0.0, 0.34, d));
    let sunCol = surface.mul(core.mul(1.0).add(corona.mul(0.5)));
    sunCol = sunCol.add(uHalo.mul(pow(halo, 2.0)).mul(0.35));
    const pulse = sin(uTime.mul(0.5)).mul(0.04).add(1.0);
    sunCol = sunCol.mul(pulse);
    const sunAlpha = oneMinus(smoothstep(0.06, 0.5, d)).mul(0.95);

    const sunMat = new THREE.MeshBasicNodeMaterial();
    sunMat.colorNode = sunCol;
    sunMat.opacityNode = sunAlpha;
    sunMat.transparent = true;
    sunMat.depthWrite = false;
    sunMat.depthTest = false;
    sunMat.fog = false;
    sunMat.toneMapped = false;
    sunMat.side = THREE.DoubleSide;
    sunMat.blending = THREE.AdditiveBlending;
    sunMat.userData.emitsBloom = true;
    const sunGeo = new THREE.PlaneGeometry(190, 190);
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.position.copy(sunWorld);
    sunMesh.renderOrder = -40;
    sunMesh.frustumCulled = false;
    scene.add(sunMesh);
    track(sunGeo); track(sunMat); track(sunMesh);

    // ── 4. God-ray fan from the sun (additive warm beams) ─────────────────────
    const rayGroup = new THREE.Group();
    rayGroup.position.copy(sunWorld);
    const ruv2 = uv();
    const along = abs(ruv2.y.sub(0.5)).mul(2.0); // 0 at centre line → 1 at tip
    const across = abs(ruv2.x.sub(0.5)).mul(2.0);
    const beamShape = oneMinus(smoothstep(0.0, 1.0, along))
        .mul(oneMinus(smoothstep(0.0, 0.85, across)));
    const beamCol = vec3(1.0, 0.80, 0.46).mul(beamShape).mul(0.5);
    const beamMat = new THREE.MeshBasicNodeMaterial();
    beamMat.colorNode = beamCol;
    beamMat.opacityNode = beamShape.mul(0.5);
    beamMat.transparent = true;
    beamMat.depthWrite = false;
    beamMat.depthTest = false;
    beamMat.fog = false;
    beamMat.toneMapped = false;
    beamMat.side = THREE.DoubleSide;
    beamMat.blending = THREE.AdditiveBlending;
    track(beamMat);
    const beamGeo = new THREE.PlaneGeometry(34, 520);
    track(beamGeo);
    for (let i = 0; i < 7; i++) {
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.y = 230;
        beam.rotation.z = (i - 3) * 0.16 + 0.02;
        // pivot beams from the sun centre: nest in a rotator
        const rot = new THREE.Group();
        rot.rotation.z = (i - 3) * 0.22;
        rot.add(beam);
        rayGroup.add(rot);
    }
    rayGroup.renderOrder = -41;
    scene.add(rayGroup);
    disposables.push({ dispose: () => scene.remove(rayGroup) });

    // Orient the camera-facing planes (sun, ridge, rays) toward the static camera.
    const faceCamera = () => {
        sunMesh.lookAt(camera.position);
        rayGroup.lookAt(camera.position);
    };

    return {
        // Static chapter-like vantage: low eye, looking forward + slightly up across
        // the valley toward the ridge/sun. orbit=0 recommended in the URL.
        camera(time, cam) {
            cam.position.set(0, 10, 70);
            cam.lookAt(-30, 26, -400);
            faceCamera();
        },
        update(time) {
            uTime.value = time;
        },
        dispose() {
            disposables.forEach((o) => { if (o.dispose) o.dispose(); });
            scene.remove(skyMesh, ridgeMesh, sunMesh, rayGroup);
        },
    };
}
