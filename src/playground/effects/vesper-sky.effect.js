/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Vesper Chrysalis — Twilight Sky dome (slice 1 of the theme).
 *
 * A BackSide gradient dome: magenta horizon band → mid-violet → deep-indigo
 * zenith, a sparse procedural star field that fades in up high, and a faint
 * cool aurora hint low on the sky. Driven by the escalation scalar `S`
 * (0 = Dormant twilight, 1 = Cosmos): the pink horizon recedes, the zenith
 * deepens toward the void, and the stars brighten.
 *
 * Preview raw (playground has NoToneMapping); the theme applies ACES + grade later.
 *   ?effect=vesper-sky&orbit=0&t=6           dormant twilight
 *   ?effect=vesper-sky&orbit=0&t=6&S=1        cosmos
 * Live sweep from one page load:  window.__VESPER_SKY__.setS(0.7)
 *
 * Port target: src/themes/vesper-chrysalis/rendering/twilight-sky.js
 */
import * as THREE from 'three/webgpu';
import {
    Fn, float, vec2, vec3, uniform, normalize, positionLocal,
    clamp, smoothstep, abs, mix, sin, floor, fract, dot, atan, pow, max, length,
} from 'three/tsl';

export const meta = {
    id: 'vesper-sky',
    title: 'Vesper Sky (twilight dome)',
    description: 'Twilight gradient dome: magenta horizon → indigo zenith + stars, driven by escalation S.',
};

const num = (p, k, d) => {
    const v = Number.parseFloat(p?.get?.(k));
    return Number.isFinite(v) ? v : d;
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function create({ scene, params }) {
    const uTime = uniform(0);
    const uS = uniform(clamp01(num(params, 'S', 0)));

    // ── palette (dark & saturated twilight; tune against Hatom refs) ──
    const cZenith = vec3(0.022, 0.014, 0.060); // near-void deep indigo
    const cHorizon = vec3(0.120, 0.062, 0.235); // #1f1040 deep violet body
    const cPink = vec3(0.95, 0.33, 0.60); // rose-magenta glow (not white)
    const cWarm = vec3(1.00, 0.62, 0.42); // warm core inside the band
    const cUnder = vec3(0.34, 0.13, 0.26); // underglow below skyline
    const cStar = vec3(0.86, 0.90, 1.00);
    const cAurora = vec3(0.28, 0.80, 0.85); // faint cool hint

    const dir = normalize(positionLocal);
    const y = dir.y;

    // Vertical gradient: deep violet body near horizon → near-void zenith.
    const up = smoothstep(0.0, 0.58, y);
    let sky = mix(cHorizon, cZenith, up);
    // Deepen further toward the void as S → Cosmos.
    sky = mix(sky, cZenith.mul(0.4), uS.mul(up).mul(0.85));

    // Rose-magenta band hugging the skyline: soft & wide, warm ONLY dead-centre (hue
    // shift, never additive → stays saturated magenta instead of clipping to white),
    // brighter toward the front (−z, where the camera looks) so it isn't a flat bar.
    const bandStrength = float(1.0).sub(uS.mul(0.72));
    const band = smoothstep(0.24, 0.0, abs(y.add(0.01)));
    const bandShape = pow(band, float(1.9));
    const bandHue = mix(cPink, cWarm, smoothstep(0.04, 0.0, abs(y)).mul(0.22));
    const front = smoothstep(-0.4, 0.7, dir.z.negate());
    const azFall = float(0.55).add(front.mul(0.45));
    const glow = bandHue.mul(bandShape).mul(azFall).mul(0.5);
    sky = sky.add(glow.mul(bandStrength));

    // Warm underglow just below the horizon line.
    const under = smoothstep(0.0, -0.22, y);
    sky = sky.add(cUnder.mul(under).mul(0.30).mul(bandStrength));

    // Faint cool aurora smear sitting just above the horizon band.
    const auroraBand = smoothstep(0.02, 0.13, y).mul(smoothstep(0.44, 0.11, y));
    const auroraWave = sin(atan(dir.x, dir.z).mul(7.0).add(uTime.mul(0.15))).mul(0.5).add(0.5);
    sky = sky.add(cAurora.mul(auroraBand).mul(auroraWave).mul(0.07));

    // ── procedural stars — round points via sub-cell distance falloff ──
    const hash21 = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
    const hash22 = Fn(([p]) => fract(
        sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))).mul(43758.5453),
    ));
    const lon = atan(dir.x, dir.z);
    // Star-field cell coords (denser vertically so cells read roughly square on-screen).
    const P = vec2(lon.mul(30.0), y.mul(48.0));
    const id = floor(P);
    const gv = fract(P).sub(0.5);
    const seed = hash21(id);
    const jitter = hash22(id).sub(0.5).mul(0.72);
    const d = length(gv.sub(jitter));
    const twinkle = sin(uTime.mul(1.7).add(seed.mul(28.0))).mul(0.35).add(0.65);
    const sparse = pow(seed, float(42.0)); // only the rare near-1 cells host a star
    const star = smoothstep(0.055, 0.0, d).mul(sparse).mul(twinkle);
    const starMask = smoothstep(0.06, 0.30, y);
    const starBright = float(0.9).add(uS.mul(1.1));
    sky = sky.add(cStar.mul(star).mul(starMask).mul(starBright));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = max(sky, vec3(0.0));
    // What the theme's MRT bloom would catch: the band + stars, not the base sky.
    material.emissiveNode = glow.mul(bandStrength).mul(0.45)
        .add(cStar.mul(star).mul(starMask).mul(0.9));
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.fog = false;
    material.toneMapped = false;

    const geometry = new THREE.SphereGeometry(4000, 64, 32);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);

    window.__VESPER_SKY__ = {
        setS: (v) => { uS.value = clamp01(v); },
        getS: () => uS.value,
    };

    return {
        camera(time, cam) {
            // Forward horizon framing (not orbit): skyline near mid-frame, gentle yaw.
            cam.position.set(0, 2.0, 0);
            const yaw = Math.sin(time * 0.025) * 0.14;
            cam.lookAt(Math.sin(yaw) * 10, 2.15, -Math.cos(yaw) * 10);
            cam.fov = 62;
            cam.near = 0.1;
            cam.far = 9000;
            cam.updateProjectionMatrix();
        },
        update(time) {
            uTime.value = time;
        },
        dispose() {
            if (window.__VESPER_SKY__) delete window.__VESPER_SKY__;
            scene.remove(mesh);
            geometry.dispose();
            material.dispose();
        },
    };
}
