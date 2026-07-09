/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Vesper Chrysalis — the Mirror Lake (slice 3): a still twilight lake that
 * reflects the sky + the glowing relic, with gentle ripple distortion and
 * bioluminescent sparkle. Uses a real WebGPU planar reflector() (the halcyon-apex
 * pattern). Ripples grow with S (line-clear/combo impulses ripple the surface).
 *
 * Isolated harness: a compact twilight sky dome + an emissive relic PROXY + a
 * dark far-shore ridge give the reflector something to mirror.
 *
 * Preview raw (playground = NoToneMapping). Port target:
 *   src/themes/vesper-chrysalis/rendering/mirror-lake.js
 *
 *   ?effect=vesper-lake&orbit=0&t=6
 *   ?effect=vesper-lake&orbit=0&t=6&S=0.6      choppier (waking)
 * Live sweep:  window.__VESPER_LAKE__.setS(0.6)
 */
import * as THREE from 'three/webgpu';
import {
    float, vec2, vec3, uniform, positionLocal, positionWorld, cameraPosition,
    normalize, clamp, smoothstep, abs, mix, sin, pow, screenUV,
    reflector, mx_noise_float,
} from 'three/tsl';

export const meta = {
    id: 'vesper-lake',
    title: 'Vesper Mirror Lake (reflector)',
    description: 'Still twilight lake — planar reflection of sky + relic, ripple distortion, bio sparkle.',
};

const num = (p, k, d) => {
    const v = Number.parseFloat(p?.get?.(k));
    return Number.isFinite(v) ? v : d;
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function create({ scene, params }) {
    const uTime = uniform(0);
    const uS = uniform(clamp01(num(params, 'S', 0)));

    // ── compact twilight sky dome (so the lake has a sky to reflect) ──
    const skyMat = new THREE.MeshBasicNodeMaterial();
    {
        const dir = normalize(positionLocal);
        const y = dir.y;
        const up = smoothstep(0.0, 0.58, y);
        const body = mix(vec3(0.120, 0.062, 0.235), vec3(0.022, 0.014, 0.060), up);
        const band = pow(smoothstep(0.24, 0.0, abs(y.add(0.01))), float(1.9));
        skyMat.colorNode = body.add(vec3(0.95, 0.33, 0.60).mul(band).mul(0.5));
        skyMat.side = THREE.BackSide;
        skyMat.depthWrite = false;
        skyMat.toneMapped = false;
    }
    const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), skyMat);
    sky.frustumCulled = false;
    scene.add(sky);

    // ── dark far-shore ridge (reflection interest at the skyline) ──
    const ridge = new THREE.Group();
    [[-180, 34], [-70, 52], [40, 44], [150, 60], [250, 40]].forEach(([x, h]) => {
        const m = new THREE.Mesh(
            new THREE.ConeGeometry(70, h, 5),
            new THREE.MeshBasicMaterial({ color: 0x0a0718 }),
        );
        m.position.set(x, h * 0.5, -520);
        ridge.add(m);
    });
    scene.add(ridge);

    // ── relic PROXY: emissive amber sphere hovering above the water ──
    const relicMat = new THREE.MeshBasicNodeMaterial();
    const churn = mx_noise_float(positionLocal.mul(2.4).add(vec3(0, uTime.mul(-0.3), 0))).mul(0.5).add(0.5);
    relicMat.colorNode = mix(vec3(1.0, 0.30, 0.05), vec3(1.0, 0.80, 0.38), churn)
        .mul(float(0.45).add(uS.mul(0.6)));
    relicMat.toneMapped = false;
    const relic = new THREE.Mesh(new THREE.IcosahedronGeometry(11, 4), relicMat);
    relic.position.set(0, 20, -70);
    relic.scale.set(1, 1.24, 1);
    scene.add(relic);

    // ── the mirror lake ──
    const reflection = reflector({ resolutionScale: 0.5 });
    reflection.target.rotateX(-Math.PI / 2); // mirror plane normal points up
    reflection.target.position.y = 0;
    scene.add(reflection.target);

    const cWaterDeep = vec3(0.020, 0.014, 0.052); // near-void body
    const cWaterGlow = vec3(0.075, 0.040, 0.185); // bioluminescent violet

    // Ripple field (world xz). Amplitude grows with S → distorts the reflection UV.
    const rip = sin(positionWorld.x.mul(0.05).add(uTime.mul(0.7)))
        .add(sin(positionWorld.z.mul(0.062).sub(uTime.mul(0.5))))
        .add(sin(positionWorld.x.mul(0.017).add(positionWorld.z.mul(0.013)).add(uTime.mul(0.3))).mul(0.6));
    const rippleAmt = float(0.0018).add(uS.mul(0.006));
    const reflUV = screenUV.flipX().add(vec2(rip.mul(rippleAmt), rip.mul(rippleAmt.mul(0.5))));
    const reflColor = reflection.sample(reflUV).rgb;

    // Fresnel: reflection dominates at grazing (far), water body shows near camera.
    const V = normalize(cameraPosition.sub(positionWorld));
    const fres = pow(clamp(float(1.0).sub(abs(V.y)), 0.0, 1.0), float(2.2));
    const reflectivity = clamp(fres.mul(0.85).add(0.28), 0.0, 1.0);

    const body = mix(cWaterDeep, cWaterGlow, smoothstep(-400.0, -40.0, positionWorld.z).oneMinus());
    let water = mix(body, reflColor.mul(vec3(0.92, 0.90, 1.02)), reflectivity);

    // Bioluminescent cyan sparkle — sparse high-freq glints on the surface.
    const glint = pow(mx_noise_float(positionWorld.mul(0.5).add(uTime.mul(0.15))).abs(), float(9.0));
    water = water.add(vec3(0.35, 0.85, 1.0).mul(glint).mul(0.6));

    const waterMat = new THREE.MeshBasicNodeMaterial();
    waterMat.colorNode = water;
    waterMat.toneMapped = false;
    const lake = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), waterMat);
    lake.rotation.x = -Math.PI / 2;
    lake.position.y = 0;
    scene.add(lake);

    window.__VESPER_LAKE__ = {
        setS: (v) => { uS.value = clamp01(v); },
        getS: () => uS.value,
    };

    return {
        camera(time, cam) {
            cam.position.set(0, 15, 60);
            const yaw = Math.sin(time * 0.02) * 0.05;
            cam.lookAt(Math.sin(yaw) * 12, 12, -80);
            cam.fov = 60;
            cam.near = 0.1;
            cam.far = 9000;
            cam.updateProjectionMatrix();
        },
        update(time) {
            uTime.value = time;
            relic.rotation.y = time * 0.1;
        },
        dispose() {
            if (window.__VESPER_LAKE__) delete window.__VESPER_LAKE__;
            scene.remove(sky, ridge, relic, lake, reflection.target);
            sky.geometry.dispose(); skyMat.dispose();
            ridge.traverse((c) => { c.geometry?.dispose?.(); c.material?.dispose?.(); });
            relic.geometry.dispose(); relicMat.dispose();
            lake.geometry.dispose(); waterMat.dispose();
            reflection.dispose?.();
        },
    };
}
