/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Vesper Chrysalis — ASSEMBLED HERO SCENE (slice 4): the Dormant tableau.
 *
 * Composes the proven slices into one framed scene — twilight sky + silhouette
 * peaks + mirror lake (reflector) + the relic-heart (crystal shell + molten core
 * + growing cracks) + crystal shore shards — driven by ONE escalation scalar S.
 * This is the integration proof BEFORE porting into the real theme createScene().
 *
 * Preview raw (playground = NoToneMapping); the theme adds ACES + bloom + grade.
 *   ?effect=vesper-chrysalis&orbit=0&t=6            dormant
 *   ?effect=vesper-chrysalis&orbit=0&t=6&S=0.6       spill (waking)
 * Live sweep:  window.__VESPER__.setS(0.6)
 */
import * as THREE from 'three/webgpu';
import {
    float, vec2, vec3, uniform, positionLocal, normalLocal, normalWorld, positionWorld,
    cameraPosition, normalize, dot, clamp, smoothstep, abs, mix, sin, pow, fract, length,
    screenUV, uv, atan2, floor, pass, viewportUV, attribute, cos, texture,
    reflector, mx_noise_float, mx_fractal_noise_float,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export const meta = {
    id: 'vesper-chrysalis',
    title: 'Vesper Chrysalis (hero scene)',
    description: 'Assembled Dormant tableau: sky + peaks + mirror lake + relic-heart + shards, driven by S.',
};

const num = (p, k, d) => {
    const v = Number.parseFloat(p?.get?.(k));
    return Number.isFinite(v) ? v : d;
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function create({ scene, camera, renderer, sizes, params }) {
    const uTime = uniform(0);
    const uS = uniform(clamp01(num(params, 'S', 0)));
    const pulse = sin(uTime.mul(1.1)).mul(0.5).add(0.5);
    const disposables = [];
    const track = (o) => { disposables.push(o); return o; };
    const disposeTextures = []; // loaded textures (planets etc.) freed on dispose
    const uCosmos = uniform(0); // fades the planet ensemble in at the Cosmos beat (S≈0.85→1)

    // 6-tier quality presets (Minimal<Low<Medium<High<Ultra<Extreme). Audit-verified:
    // High/Ultra/Extreme stay VISUALLY IDENTICAL; the heavier cuts are scoped to Medium and below.
    const qName = (typeof window !== 'undefined' && window.settings?.graphicsQuality) || 'High';
    const tier = ({ Minimal: 0, Low: 1, Medium: 2, High: 3, Ultra: 4, Extreme: 5 })[qName] ?? 3;
    const reflScale = tier <= 1 ? 0.34 : (tier === 2 ? 0.5 : (tier === 3 ? 0.75 : 0.9)); // sharper mirror on High+
    const rippleBase = tier >= 3 ? 0.0009 : 0.0016; // de-smear the reflection on High+
    const useReflector = tier >= 1; // Minimal: skip the 2nd full-scene pass entirely
    const useTransmission = tier >= 2; // Minimal/Low: faux-glass (skips the transmission RT capture)
    const flowOctaves = tier <= 1 ? 0 : (tier <= 2 ? 2 : 3); // water bioluminescence fbm octaves
    const wantGlint = tier >= 2; // cyan water glint noise (off on the two weakest tiers)
    const caTaps = tier >= 3 ? 3 : 1; // chromatic aberration: 3 taps on High+, 1 below (imperceptible)
    const bloomStrength = tier >= 3 ? 0.72 : (tier >= 1 ? 0.58 : 0.5);
    const bloomDS = tier >= 3 ? 0.6 : 0.5; // cheaper bloom downsample below High
    const emberCountT = tier <= 1 ? 130 : (tier <= 2 ? 260 : (tier === 3 ? 360 : 420));
    const shardCountT = tier <= 1 ? 12 : (tier <= 2 ? 18 : 22);

    // ════ SKY DOME ════
    const skyMat = new THREE.MeshBasicNodeMaterial();
    {
        const dir = normalize(positionLocal);
        const y = dir.y;
        const up = smoothstep(0.0, 0.58, y);
        let s = mix(vec3(0.120, 0.062, 0.235), vec3(0.022, 0.014, 0.060), up);
        s = mix(s, vec3(0.022, 0.014, 0.060).mul(0.4), uS.mul(up).mul(0.85));
        const bandStrength = float(1.0).sub(uS.mul(0.72));
        const band = pow(smoothstep(0.24, 0.0, abs(y.add(0.01))), float(1.9));
        const front = smoothstep(-0.4, 0.7, dir.z.negate());
        s = s.add(vec3(0.95, 0.33, 0.60).mul(band).mul(float(0.55).add(front.mul(0.45))).mul(0.5).mul(bandStrength));
        // sparse stars
        const P = floor(vec2(atan2(dir.x, dir.z).mul(30.0), y.mul(48.0)));
        const seed = mx_noise_float(vec3(P.x, P.y, 1.0)).mul(0.5).add(0.5);
        s = s.add(vec3(0.86, 0.90, 1.0)
            .mul(pow(seed, float(40.0)))
            .mul(smoothstep(0.08, 0.32, y))
            .mul(float(0.9).add(uS.mul(1.1))));
        skyMat.colorNode = s;
        skyMat.side = THREE.BackSide;
        skyMat.depthWrite = false;
        skyMat.toneMapped = false;
        skyMat.fog = false; // the dome must NOT fade to fog (it IS the light source)
    }
    scene.add(track(new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), skyMat)));

    // ════ PLANETS — distant twilight worlds (repo textures, terminator-lit silhouettes) ════
    // Anchor-moon always present for depth; the full ensemble + saturn ring bloom in at the
    // Cosmos beat (uCosmos). Small, tinted-down, upper-sky, out of the center wedge; mirrored free.
    const planets = new THREE.Group();
    {
        const TEXBASE = `${(typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'}textures/`;
        const loader = new THREE.TextureLoader();
        const sun = normalize(vec3(0.4, -0.05, 1.0)); // lit from the horizon glow
        const makePlanet = (file, rad, x, y, z, tint, always) => {
            const map = loader.load(TEXBASE + file);
            map.colorSpace = THREE.SRGBColorSpace;
            disposeTextures.push(map);
            const mat = new THREE.MeshBasicNodeMaterial();
            const N = normalize(normalWorld);
            const Vv = normalize(cameraPosition.sub(positionWorld));
            const ndv = clamp(dot(N, Vv), 0.0, 1.0);
            const lit = clamp(dot(N, sun).mul(0.8).add(0.10), 0.05, 1.0); // crescent terminator (dark night side)
            const rim = pow(float(1.0).sub(ndv), float(3.5)); // thin warm limb
            mat.colorNode = texture(map).rgb.mul(vec3(tint[0], tint[1], tint[2])).mul(lit).mul(0.75)
                .add(vec3(1.0, 0.55, 0.4).mul(rim).mul(0.4)); // dim + tinted → distant twilight world, not a bright globe
            mat.toneMapped = false;
            mat.fog = false;
            mat.transparent = true;
            mat.opacityNode = always ? float(0.92) : uCosmos.mul(0.92);
            const mesh = new THREE.Mesh(new THREE.SphereGeometry(rad, 32, 24), mat);
            mesh.position.set(x, y, z);
            planets.add(mesh);
        };
        if (tier >= 1) {
            makePlanet('2k_moon.jpg', 12, -185, 235, -520, [0.42, 0.40, 0.56], true); // anchor moon
            if (tier >= 2) {
                makePlanet('2k_jupiter.jpg', 24, 255, 300, -650, [0.55, 0.34, 0.40], false);
                makePlanet('2k_neptune.jpg', 17, -330, 330, -700, [0.32, 0.40, 0.72], false);
            }
            if (tier >= 3) {
                makePlanet('2k_saturn.jpg', 20, 110, 285, -680, [0.60, 0.48, 0.36], false);
                // procedural banded ring (avoids the RingGeometry uv issue)
                const ringMat = new THREE.MeshBasicNodeMaterial();
                const rr = length(uv().sub(0.5)); // 0 centre → 0.5 edge (RingGeometry uv is a disc)
                const rn = smoothstep(0.30, 0.5, rr);
                const bands = sin(rn.mul(46.0)).mul(0.5).add(0.5);
                ringMat.colorNode = vec3(0.85, 0.7, 0.55).mul(float(0.55).add(bands.mul(0.45)));
                ringMat.opacityNode = smoothstep(0.30, 0.34, rr).mul(smoothstep(0.5, 0.46, rr)).mul(uCosmos).mul(0.75);
                ringMat.transparent = true; ringMat.side = THREE.DoubleSide;
                ringMat.toneMapped = false; ringMat.fog = false; ringMat.depthWrite = false;
                const ring = new THREE.Mesh(new THREE.RingGeometry(28, 46, 56), ringMat);
                ring.position.set(110, 285, -680);
                ring.rotation.set(Math.PI * 0.42, 0.3, 0);
                planets.add(ring);
            }
        }
    }
    scene.add(track(planets));

    // ════ MOUNTAIN RIDGES — jagged continuous silhouettes (CPU-baked ridge curtains) ════
    // A solid near-black curtain per range; the TOP edge is displaced by ridged noise into
    // organic jagged peaks (valleys submerge below the waterline → no seam). Fogged for depth.
    const peakMat = new THREE.MeshBasicNodeMaterial();
    peakMat.colorNode = vec3(0.010, 0.007, 0.020) // near-black body
        .add(vec3(0.85, 0.36, 0.52).mul(pow(attribute('aCrest', 'float'), float(7.0))).mul(0.17)); // warm horizon-catch rim on the crest
    peakMat.toneMapped = false; // fog stays ENABLED → distance-fade to haze (aerial perspective)
    const peaks = new THREE.Group();
    const makeRidge = (width, z, segs, seedOff, amp) => {
        const geo = new THREE.PlaneGeometry(width, 130, segs, 1);
        const pos = geo.attributes.position;
        const ridge1 = (x) => { // ridged multifractal (sharp alpine peaks)
            let v = 0; let a = 1; let f = 0.010; let s = seedOff;
            for (let o = 0; o < 5; o += 1) {
                v += (1 - Math.abs(Math.sin(x * f + s))) * a;
                a *= 0.5; f *= 2.12; s += 2.3;
            }
            return v; // ~0..1.94
        };
        for (let i = 0; i <= segs; i += 1) { // top row = first (segs+1) verts
            pos.setY(i, -4 + ridge1(pos.getX(i)) * amp); // valleys ~-4 (submerged), peaks tall
        }
        pos.needsUpdate = true;
        // crest attribute (1 at the jagged top edge, 0 at the submerged base) → horizon rim-light
        const crest = new Float32Array(pos.count);
        for (let i = 0; i < pos.count; i += 1) crest[i] = i <= segs ? 1 : 0;
        geo.setAttribute('aCrest', new THREE.Float32BufferAttribute(crest, 1));
        const m = new THREE.Mesh(geo, peakMat);
        m.position.set(0, 0, z);
        return m;
    };
    peaks.add(makeRidge(2200, -700, 150, 0.0, 62)); // far range (tallest, most fogged)
    peaks.add(makeRidge(1900, -500, 150, 11.0, 50)); // mid range
    peaks.add(makeRidge(1500, -330, 130, 23.0, 40)); // near range (sharpest, darkest)
    scene.add(track(peaks));

    // Aerial perspective + the mountain–lake SEAM FIX: fog tinted to a dusky violet haze so
    // ranges fade with distance, and the submerged bases never reveal a void behind them.
    scene.fog = new THREE.Fog(new THREE.Color(0.038, 0.022, 0.058), 260, 900);

    // ════ AERIAL-HAZE VEILS — thin additive bands between the ranges (receding-into-haze depth) ════
    if (tier >= 2) {
        const veilMat = new THREE.MeshBasicNodeMaterial();
        {
            const vv = uv();
            const band = smoothstep(0.42, 0.0, abs(vv.y.sub(0.40))); // thin horizon band
            const drift = sin(vv.x.mul(6.0).add(uTime.mul(0.08))).mul(0.15).add(0.85);
            veilMat.colorNode = vec3(0.62, 0.26, 0.46).mul(band).mul(drift).mul(0.14);
            veilMat.transparent = true;
            veilMat.blending = THREE.AdditiveBlending;
            veilMat.depthWrite = false;
            veilMat.toneMapped = false;
            veilMat.fog = false;
            veilMat.side = THREE.DoubleSide;
        }
        const veilZ = tier >= 4 ? [-410, -560, -700, -780] : [-430, -640];
        veilZ.forEach((vz) => {
            const v = new THREE.Mesh(new THREE.PlaneGeometry(2600, 130), veilMat);
            v.position.set(0, 42, vz);
            v.renderOrder = -1;
            scene.add(track(v));
        });
    }

    // ════ IBL — procedural twilight environment (PMREM, zero asset download) ════
    // Bakes a tiny twilight dome + a warm relic key light to a prefiltered radiance
    // map so PBR glass/crystals get real reflections & lighting. (lunara pattern.)
    let envTexture = null; // kept so dispose() can free it (in-game theme-switch hygiene)
    if (renderer) {
        try {
            const pmrem = new THREE.PMREMGenerator(renderer);
            const envScene = new THREE.Scene();
            const envDomeMat = new THREE.MeshBasicNodeMaterial();
            const ey = normalize(positionLocal).y;
            envDomeMat.colorNode = mix(vec3(0.20, 0.09, 0.30), vec3(0.02, 0.015, 0.06), smoothstep(-0.1, 0.7, ey))
                .add(vec3(0.95, 0.32, 0.58).mul(pow(smoothstep(0.20, 0.0, abs(ey.add(0.02))), float(2.4))).mul(0.9));
            envDomeMat.side = THREE.BackSide;
            envDomeMat.toneMapped = false;
            const envDome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), envDomeMat);
            envScene.add(envDome);
            // Bright points → give the glass + crystals SHARP highlights to reflect. The old bare-dome
            // bake had almost no angular detail, which IS why reflections read "low-resolution".
            const envDisposn = [];
            const addLight = (r, g, b, rad, x, y, z) => {
                const m = new THREE.MeshBasicNodeMaterial();
                m.colorNode = vec3(r, g, b); m.toneMapped = false;
                const s = new THREE.Mesh(new THREE.SphereGeometry(rad, 12, 8), m);
                s.position.set(x, y, z); envScene.add(s);
                envDisposn.push(s.geometry, m);
            };
            addLight(2.0, 0.85, 0.36, 5.0, 0, 4, -14); // warm ember key
            addLight(1.1, 0.42, 0.72, 3.2, -22, 2, 8); // magenta horizon spot
            addLight(0.5, 0.88, 1.05, 2.4, 20, 6, -6); // cyan crystal spot
            addLight(1.3, 1.3, 1.6, 1.0, -10, 18, 12); // star
            addLight(1.3, 1.3, 1.6, 0.8, 26, 14, -18); // star
            addLight(1.1, 1.2, 1.45, 0.7, 6, 22, 20); // star
            const rt = pmrem.fromScene(envScene, 0.04);
            if (rt?.texture) { envTexture = rt.texture; scene.environment = envTexture; }
            envDome.geometry.dispose(); envDomeMat.dispose();
            envDisposn.forEach((o) => o.dispose?.());
            pmrem.dispose?.();
        } catch (err) { /* IBL optional — egg falls back to fresnel-emissive */ }
    }

    // ── combo water rings: pool of vec4(x, z, ageSec, amp) (halcyon pattern) ──
    // Count tiers down → fewer per-pixel loop iterations in the water shader (near-identical).
    const RING_COUNT = tier <= 1 ? 5 : (tier <= 3 ? 8 : 12);
    const ringNodes = Array.from({ length: RING_COUNT }, () => uniform(new THREE.Vector4(0, 0, 999, 0)));
    const ringState = Array.from({ length: RING_COUNT }, () => ({ x: 0, z: 0, age: 999, amp: 0 }));
    const spawnRing = (x, z, amp) => {
        let idx = 0; let worst = -1;
        for (let i = 0; i < RING_COUNT; i += 1) {
            const s = ringState[i];
            const score = s.age - s.amp * 3;
            if (score > worst) { worst = score; idx = i; }
        }
        ringState[idx].x = x; ringState[idx].z = z; ringState[idx].age = 0; ringState[idx].amp = amp;
    };

    // ════ MIRROR LAKE (reflector — skipped on Minimal to save the 2nd full-scene pass) ════
    const reflection = useReflector ? reflector({ resolutionScale: reflScale }) : null;
    if (reflection) {
        reflection.target.rotateX(-Math.PI / 2);
        reflection.target.position.y = 0;
        scene.add(reflection.target);
    }
    {
        const rip = sin(positionWorld.x.mul(0.05).add(uTime.mul(0.7)))
            .add(sin(positionWorld.z.mul(0.062).sub(uTime.mul(0.5))))
            .add(sin(positionWorld.x.mul(0.017).add(positionWorld.z.mul(0.013)).add(uTime.mul(0.3))).mul(0.6));
        const rippleAmt = float(rippleBase).add(uS.mul(0.006));
        const reflUV = screenUV.flipX().add(vec2(rip.mul(rippleAmt), rip.mul(rippleAmt.mul(0.5))));
        const reflColor = reflection ? reflection.sample(reflUV).rgb : vec3(0.12, 0.07, 0.24);
        const V = normalize(cameraPosition.sub(positionWorld));
        const fres = pow(clamp(float(1.0).sub(abs(V.y)), 0.0, 1.0), float(2.2));
        const reflectivity = clamp(fres.mul(0.85).add(0.26), 0.0, 1.0);
        const bodyCol = mix(vec3(0.020, 0.014, 0.052), vec3(0.070, 0.038, 0.175),
            smoothstep(-400.0, -30.0, positionWorld.z).oneMinus());
        let water = mix(bodyCol, reflColor.mul(vec3(0.92, 0.90, 1.02)), reflectivity);
        if (wantGlint) {
            const glint = pow(mx_noise_float(positionWorld.mul(0.5).add(uTime.mul(0.15))).abs(), float(9.0));
            water = water.add(vec3(0.32, 0.82, 1.0).mul(glint).mul(0.5));
        }
        // Bioluminescent flow — drifting magenta blotches near the shore (the "living" water).
        if (flowOctaves > 0) {
            const flow = mx_fractal_noise_float(
                vec3(positionWorld.x.mul(0.012), positionWorld.z.mul(0.012).add(uTime.mul(0.04)), 0.0), flowOctaves,
            ).mul(0.5).add(0.5);
            const bio = pow(flow, float(3.0)).mul(smoothstep(-320.0, -10.0, positionWorld.z).oneMinus());
            water = water.add(vec3(0.55, 0.14, 0.62).mul(bio).mul(0.4));
        }
        // Expanding combo rings — bioluminescent bands that grow from the emit point (mirrored free).
        let ringGlow = float(0.0);
        ringNodes.forEach((rn) => {
            const dx = positionWorld.x.sub(rn.x);
            const dz = positionWorld.z.sub(rn.y);
            const dist = dx.mul(dx).add(dz.mul(dz)).sqrt();
            const radius = rn.z.mul(58.0);
            const band = smoothstep(float(9.0), float(0.0), abs(dist.sub(radius)));
            ringGlow = ringGlow.add(band.mul(rn.w));
        });
        water = water.add(vec3(0.60, 0.92, 1.0).mul(ringGlow).mul(2.4));
        const waterMat = new THREE.MeshBasicNodeMaterial();
        waterMat.colorNode = water;
        waterMat.toneMapped = false;
        waterMat.fog = false; // keep the mirror reflection clean (no haze band on the water)
        const lake = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), waterMat);
        lake.rotation.x = -Math.PI / 2;
        scene.add(track(lake));
    }

    // ════ RELIC-HEART (core + shell + cracks) ════
    const relic = new THREE.Group();
    relic.position.set(0, 19, -95); // floats higher & further (hatom composition — off the water, on the horizon)
    relic.scale.set(9.5, 11.7, 9.5); // egg proportion (base radius 1 → 9.5 wide, 11.7 tall)
    scene.add(track(relic));
    {
        // core
        const corePos = positionLocal.mul(2.8).add(vec3(0, uTime.mul(-0.28), 0));
        const churn = mx_fractal_noise_float(corePos, 4).mul(0.5).add(0.5);
        // Dark cracked-rock heart with molten amber veins → reads as a distinct object
        // inside the glass (NOT a uniform glowing ball), like the Hatom embryo core.
        const coreVeinField = mx_fractal_noise_float(positionLocal.mul(3.2), 4).mul(0.5).add(0.5);
        const coreCrack = smoothstep(float(0.09), float(0.0), abs(coreVeinField.sub(0.5)));
        const veinGlow = coreCrack.mul(float(0.5).add(uS.mul(1.3)).add(pulse.mul(uS.mul(0.5).add(0.12))));
        const coreVein = mix(vec3(1.0, 0.26, 0.02), vec3(1.0, 0.74, 0.30), churn);
        const coreMat = new THREE.MeshBasicNodeMaterial();
        coreMat.colorNode = vec3(0.045, 0.018, 0.030).add(coreVein.mul(veinGlow));
        coreMat.toneMapped = false;
        relic.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 4), coreMat));
        // shell — REAL transmission glass (MeshPhysicalNodeMaterial + IBL env)
        const N = normalize(normalWorld);
        const V = normalize(cameraPosition.sub(positionWorld));
        const fres = pow(clamp(float(1.0).sub(dot(N, V)), 0.0, 1.0), float(3.0));
        const crackField = mx_fractal_noise_float(positionLocal.mul(1.7), 4).mul(0.5).add(0.5);
        const crackW = float(0.010).add(uS.mul(0.055));
        const crackLine = smoothstep(crackW, float(0.0), abs(crackField.sub(0.5)));
        const crackGlow = crackLine.mul(uS).mul(pulse.mul(0.35).add(0.85));
        // High+ = real transmission glass; Minimal/Low = fresnel faux-glass (skips the per-frame
        // transmission viewport-mip capture entirely). Emissive rim + veins are shared below.
        const shellMat = useTransmission
            ? new THREE.MeshPhysicalNodeMaterial() : new THREE.MeshStandardNodeMaterial();
        shellMat.color = new THREE.Color(0.62, 0.74, 1.0);
        shellMat.metalness = 0.0;
        shellMat.roughness = useTransmission ? 0.05 : 0.15;
        if (useTransmission) {
            shellMat.transmission = 0.93;
            shellMat.ior = 1.44;
            shellMat.thickness = 2.0;
            shellMat.attenuationColor = new THREE.Color(0.58, 0.70, 1.0);
            shellMat.attenuationDistance = 18.0;
            shellMat.iridescence = 0.3;
            shellMat.iridescenceIOR = 1.25;
            shellMat.clearcoat = 1.0;
            shellMat.clearcoatRoughness = 0.12;
        } else {
            shellMat.opacityNode = clamp(float(0.30).add(fres.mul(0.55)), 0.0, 1.0);
        }
        shellMat.transparent = true;
        shellMat.side = THREE.FrontSide;
        // icy fresnel rim + molten crack veins (emissive → bloom)
        shellMat.emissiveNode = vec3(0.35, 0.75, 1.0).mul(fres).mul(0.7)
            .add(vec3(1.0, 0.48, 0.12).mul(crackGlow).mul(1.7));
        // geode surface bumps
        shellMat.positionNode = positionLocal.add(normalLocal.mul(mx_noise_float(positionLocal.mul(2.2)).mul(0.07)));
        relic.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 6), shellMat));
    }

    // ════ GOD-RAY SHAFT — soft warm light behind the relic (camera-facing billboard) ════
    const godMat = new THREE.MeshBasicNodeMaterial();
    {
        const vv = uv();
        const cx = abs(vv.x.sub(0.5)).mul(2.0); // 0 centre → 1 edge
        const shaftMask = pow(smoothstep(1.0, 0.0, cx), float(1.7)); // soft horizontal falloff
        const vFade = smoothstep(1.0, 0.06, vv.y).mul(smoothstep(0.0, 0.28, vv.y)); // fade top+bottom
        // Cheap layered-sine streak — audit-verified near-identical to the per-fragment 3D noise.
        const streak = sin(vv.y.mul(22.0).add(vv.x.mul(7.0)).sub(uTime.mul(0.6))).mul(0.5).add(0.5)
            .mul(sin(vv.y.mul(9.0).add(uTime.mul(0.4))).mul(0.4).add(0.6));
        const shaft = shaftMask.mul(vFade).mul(streak.mul(0.55).add(0.55));
        godMat.colorNode = vec3(1.0, 0.62, 0.32).mul(shaft).mul(float(0.05).add(uS.mul(0.30)));
        godMat.transparent = true;
        godMat.blending = THREE.AdditiveBlending;
        godMat.depthWrite = false;
        godMat.toneMapped = false;
        godMat.side = THREE.DoubleSide;
        godMat.fog = false;
    }
    const god = new THREE.Mesh(new THREE.PlaneGeometry(64, 165), godMat);
    god.position.set(0, 66, -104); // behind the (repositioned) relic
    scene.add(track(god));

    // ════ CRYSTAL CLUSTERS — rooted, varied clumps growing from the shore (hatom) ════
    // Faceted spires grouped into clusters in the LEFT/RIGHT shore zones (protected centre wedge
    // keeps the board readable), rooted below the waterline. One InstancedMesh = 1 draw (vs 22).
    const shardMat = new THREE.MeshStandardNodeMaterial();
    {
        const N = normalize(normalWorld);
        const V = normalize(cameraPosition.sub(positionWorld));
        const f = pow(clamp(float(1.0).sub(dot(N, V)), 0.0, 1.0), float(2.2));
        shardMat.color = new THREE.Color(0.05, 0.10, 0.20);
        shardMat.metalness = 0.12;
        shardMat.roughness = 0.08; // glassier → sharper reflection of the enriched env map
        shardMat.emissiveNode = vec3(0.40, 0.85, 1.0).mul(f).mul(0.9)
            .add(vec3(0.30, 0.70, 1.0).mul(uS).mul(0.3));
        shardMat.transparent = true;
        shardMat.opacityNode = clamp(float(0.55).add(f.mul(0.45)), 0.0, 1.0);
        shardMat.depthWrite = false;
    }
    const clusterCenters = [
        [-30, -55], [-52, -78], [-24, -40], [-66, -62], [-42, -100],
        [30, -55], [52, -78], [24, -40], [66, -62], [42, -100],
    ];
    const clusterN = tier <= 1 ? 5 : (tier <= 2 ? 7 : 10);
    const spiresPer = tier <= 1 ? 3 : (tier <= 2 ? 4 : 5);
    const crnd = (i) => { const s = Math.sin(i * 91.7 + 4.1) * 43758.5453; return s - Math.floor(s); };
    const crystalGeo = new THREE.ConeGeometry(1.1, 1, 6); // unit-height 6-facet spire, scaled per instance
    const crystals = new THREE.InstancedMesh(crystalGeo, shardMat, clusterN * spiresPer);
    {
        const _m = new THREE.Matrix4(); const _q = new THREE.Quaternion();
        const _e = new THREE.Euler(); const _s = new THREE.Vector3(); const _p = new THREE.Vector3();
        let idx = 0;
        for (let c = 0; c < clusterN; c += 1) {
            const [cx, cz] = clusterCenters[c];
            for (let sp = 0; sp < spiresPer; sp += 1) {
                const j = idx * 7 + 1;
                const dx = (crnd(j) - 0.5) * 9;
                const dz = (crnd(j + 1) - 0.5) * 9;
                const h = 6 + crnd(j + 2) * 16; // height 6..22
                const rad = 0.8 + crnd(j + 6) * 0.7;
                _e.set((crnd(j + 3) - 0.5) * 0.5, crnd(j + 4) * 6.28, (crnd(j + 5) - 0.5) * 0.5);
                _q.setFromEuler(_e);
                _s.set(rad, h, rad);
                _p.set(cx + dx, h * 0.5 - 2.0, cz + dz); // base sunk ~2u below the waterline (rooted)
                _m.compose(_p, _q, _s);
                crystals.setMatrixAt(idx, _m);
                idx += 1;
            }
        }
        crystals.instanceMatrix.needsUpdate = true;
    }
    crystals.frustumCulled = false;
    scene.add(track(crystals));

    // ════ FOREGROUND BOULDERS — near-black silhouettes at the frame edges (depth stack) ════
    const boulderCountT = tier <= 1 ? 4 : (tier <= 2 ? 7 : (tier === 3 ? 10 : 14));
    const bnoise = (x, y) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };
    const boulderMat = new THREE.MeshBasicNodeMaterial();
    {
        const N = normalize(normalWorld);
        const V = normalize(cameraPosition.sub(positionWorld));
        const f = pow(clamp(float(1.0).sub(dot(N, V)), 0.0, 1.0), float(2.6));
        boulderMat.colorNode = vec3(0.008, 0.006, 0.016).add(vec3(0.7, 0.28, 0.42).mul(f).mul(0.09)); // near-black + faint magenta rim
        boulderMat.toneMapped = false;
    }
    const boulderGeo = new THREE.IcosahedronGeometry(1, 2);
    {
        const p = boulderGeo.attributes.position; // jitter the shared shape into an irregular rock
        for (let i = 0; i < p.count; i += 1) {
            p.setXYZ(i,
                p.getX(i) + (bnoise(p.getX(i) * 3, p.getZ(i) * 3) - 0.5) * 0.4,
                p.getY(i) + (bnoise(p.getY(i) * 3 + 5, p.getX(i) * 3) - 0.5) * 0.4,
                p.getZ(i) + (bnoise(p.getZ(i) * 3 + 9, p.getY(i) * 3) - 0.5) * 0.4);
        }
        p.needsUpdate = true;
    }
    const boulders = new THREE.InstancedMesh(boulderGeo, boulderMat, boulderCountT);
    {
        const _m = new THREE.Matrix4(); const _q = new THREE.Quaternion();
        const _e = new THREE.Euler(); const _s = new THREE.Vector3(); const _p = new THREE.Vector3();
        for (let i = 0; i < boulderCountT; i += 1) {
            const side = i % 2 === 0 ? -1 : 1;
            const sc = 5 + bnoise(i, 3) * 13; // 5..18
            const x = side * (44 + bnoise(i, 1) * 62); // |x| 44..106 (frame edges, clear centre)
            const z = -8 - bnoise(i, 2) * 62; // z -8..-70 (foreground)
            _e.set(bnoise(i, 4) * 3, bnoise(i, 5) * 6, bnoise(i, 6) * 3);
            _q.setFromEuler(_e);
            _s.set(sc, sc * (0.55 + bnoise(i, 7) * 0.5), sc);
            _p.set(x, sc * -0.45, z); // base sunk below the waterline
            _m.compose(_p, _q, _s);
            boulders.setMatrixAt(i, _m);
        }
        boulders.instanceMatrix.needsUpdate = true;
    }
    boulders.frustumCulled = false;
    scene.add(track(boulders));

    // ════ BIOLUMINESCENT RIVERBED MOUND — dark rock + glowing magenta veins (off-centre) ════
    // The signature hatom "living terrain" element. Kept dim (sub-bloom) + off-centre so it never
    // backlights the board. Displaced plane → a low mound rising from the shore behind the crystals.
    if (tier >= 2) {
        const moundMat = new THREE.MeshBasicNodeMaterial();
        {
            const pl = positionLocal;
            const vf = mx_fractal_noise_float(vec3(pl.x.mul(0.06), pl.y.mul(0.06).add(uTime.mul(0.03)), 0.0), 3).mul(0.5).add(0.5);
            const vein = smoothstep(0.055, 0.0, abs(vf.sub(0.5))); // glowing vein isolines
            const speck = pow(mx_noise_float(pl.mul(0.55)).abs(), float(4.0)); // fine moss speckle
            const veinCol = vec3(0.9, 0.2, 0.6).mul(vein.mul(0.5).add(speck.mul(0.2)));
            moundMat.colorNode = vec3(0.02, 0.012, 0.03).add(veinCol.mul(float(0.45).add(uS.mul(0.55))));
            moundMat.toneMapped = false;
        }
        const moundGeo = new THREE.PlaneGeometry(95, 62, 48, 30);
        const mp = moundGeo.attributes.position;
        const mn = (x, y) => { const s = Math.sin(x * 12.9 + y * 78.2) * 43758.5; return s - Math.floor(s); };
        for (let i = 0; i < mp.count; i += 1) {
            const x = mp.getX(i); const y = mp.getY(i);
            const r = Math.sqrt(x * x + y * y) / 46;
            const dome = Math.max(0, 1 - r * r) * 11; // radial mound
            mp.setZ(i, dome + (mn(x * 0.3, y * 0.3) - 0.5) * 4.5); // + rocky roughness
        }
        mp.needsUpdate = true;
        const mound = new THREE.Mesh(moundGeo, moundMat);
        mound.rotation.x = -Math.PI / 2; // lay flat (displacement → +y)
        mound.position.set(-58, -1, -74); // off-centre-left, behind the crystals
        scene.add(track(mound));
    }

    // ════ GPU EMBERS — amber motes rising off the relic (vertex-animated points) ════
    const EMBER_COUNT = emberCountT;
    const emberPos = new Float32Array(EMBER_COUNT * 3);
    const emberSeed = new Float32Array(EMBER_COUNT * 2);
    for (let i = 0; i < EMBER_COUNT; i += 1) {
        const ang = Math.random() * Math.PI * 2;
        const rad = 2 + Math.random() * 15;
        emberPos[i * 3] = Math.cos(ang) * rad;
        emberPos[i * 3 + 1] = Math.random() * 6;
        emberPos[i * 3 + 2] = Math.sin(ang) * rad;
        emberSeed[i * 2] = Math.random();
        emberSeed[i * 2 + 1] = Math.random();
    }
    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute('position', new THREE.Float32BufferAttribute(emberPos, 3));
    emberGeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(emberSeed, 2));
    const emberMat = new THREE.PointsNodeMaterial();
    {
        const seed = attribute('aSeed', 'vec2');
        const life = fract(uTime.mul(0.09).add(seed.x)); // 0..1 loop, staggered
        const rise = life.mul(58.0);
        const sway = sin(uTime.mul(0.6).add(seed.y.mul(6.283))).mul(3.5);
        emberMat.positionNode = positionLocal.add(vec3(sway, rise, cos(uTime.mul(0.5).add(seed.x.mul(6.0))).mul(2.0)));
        const fade = smoothstep(0.0, 0.12, life).mul(smoothstep(1.0, 0.55, life));
        emberMat.colorNode = mix(vec3(1.0, 0.48, 0.14), vec3(1.0, 0.82, 0.40), seed.y);
        emberMat.opacityNode = fade.mul(uS.mul(0.7).add(0.22));
        emberMat.sizeNode = fade.mul(3.0).add(0.8).mul(uS.mul(0.5).add(0.7));
        emberMat.transparent = true;
        emberMat.blending = THREE.AdditiveBlending;
        emberMat.depthWrite = false;
        emberMat.toneMapped = false;
        emberMat.fog = false;
    }
    const embers = new THREE.Points(emberGeo, emberMat);
    embers.position.set(0, 2, -95); // under the (repositioned) relic
    embers.frustumCulled = false;
    scene.add(track(embers));

    // ════ FIREFLIES — slow-wandering, blinking motes scattered through the air ════
    const FIREFLY_COUNT = tier <= 1 ? 28 : (tier <= 2 ? 55 : (tier === 3 ? 72 : 90));
    const flyPos = new Float32Array(FIREFLY_COUNT * 3);
    const flySeed = new Float32Array(FIREFLY_COUNT * 3);
    for (let i = 0; i < FIREFLY_COUNT; i += 1) {
        flyPos[i * 3] = (Math.random() * 2 - 1) * 135; // x spread
        flyPos[i * 3 + 1] = 3 + Math.random() * 52; // y in the air
        flyPos[i * 3 + 2] = -18 - Math.random() * 150; // z depth
        flySeed[i * 3] = Math.random();
        flySeed[i * 3 + 1] = Math.random();
        flySeed[i * 3 + 2] = Math.random();
    }
    const flyGeo = new THREE.BufferGeometry();
    flyGeo.setAttribute('position', new THREE.Float32BufferAttribute(flyPos, 3));
    flyGeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(flySeed, 3));
    const flyMat = new THREE.PointsNodeMaterial();
    {
        const sd = attribute('aSeed', 'vec3');
        const wander = vec3(
            sin(uTime.mul(0.23).add(sd.x.mul(6.283))).mul(9.0),
            sin(uTime.mul(0.17).add(sd.y.mul(6.283))).mul(5.0),
            cos(uTime.mul(0.19).add(sd.z.mul(6.283))).mul(9.0),
        );
        flyMat.positionNode = positionLocal.add(wander);
        // sharp staggered blink; mostly warm lime-gold, some cyan (Hatom's green glint)
        const blink = pow(sin(uTime.mul(1.5).add(sd.x.mul(20.0))).mul(0.5).add(0.5), float(3.0));
        flyMat.colorNode = mix(vec3(0.78, 1.0, 0.38), vec3(0.35, 0.85, 1.0), pow(sd.z, float(2.0)));
        flyMat.opacityNode = blink.mul(0.9);
        flyMat.sizeNode = blink.mul(2.4).add(0.6);
        flyMat.transparent = true;
        flyMat.blending = THREE.AdditiveBlending;
        flyMat.depthWrite = false;
        flyMat.toneMapped = false;
        flyMat.fog = false;
    }
    const fireflies = new THREE.Points(flyGeo, flyMat);
    fireflies.frustumCulled = false;
    scene.add(track(fireflies));

    // ════ AMBIENT DUST — slow floating motes across the WHOLE view (full-screen atmosphere) ════
    const DUST_COUNT = tier <= 1 ? 130 : (tier <= 2 ? 280 : (tier === 3 ? 320 : 460));
    const dustPos = new Float32Array(DUST_COUNT * 3);
    const dustSeed = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < DUST_COUNT; i += 1) {
        dustPos[i * 3] = (Math.random() * 2 - 1) * 175; // wide x (fills the screen)
        dustPos[i * 3 + 1] = 1 + Math.random() * 95; // full height
        dustPos[i * 3 + 2] = -6 - Math.random() * 250; // full depth
        dustSeed[i * 3] = Math.random();
        dustSeed[i * 3 + 1] = Math.random();
        dustSeed[i * 3 + 2] = Math.random();
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(dustPos, 3));
    dustGeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(dustSeed, 3));
    const dustMat = new THREE.PointsNodeMaterial();
    {
        const sd = attribute('aSeed', 'vec3');
        // gentle bounded drift on all axes (stays in the volume → continuous ambient float)
        const drift = vec3(
            sin(uTime.mul(0.08).add(sd.x.mul(6.283))).mul(7.0),
            sin(uTime.mul(0.05).add(sd.y.mul(6.283))).mul(5.0),
            cos(uTime.mul(0.07).add(sd.z.mul(6.283))).mul(7.0),
        );
        dustMat.positionNode = positionLocal.add(drift);
        const tw = sin(uTime.mul(0.9).add(sd.x.mul(15.0))).mul(0.5).add(0.5); // faint twinkle
        dustMat.colorNode = mix(vec3(0.70, 0.76, 1.0), vec3(1.0, 0.85, 0.68), pow(sd.y, float(2.5))); // cool + a few warm
        dustMat.opacityNode = tw.mul(0.34).add(0.12).mul(0.85);
        dustMat.sizeNode = tw.mul(1.4).add(0.7);
        dustMat.transparent = true;
        dustMat.blending = THREE.AdditiveBlending;
        dustMat.depthWrite = false;
        dustMat.toneMapped = false;
        dustMat.fog = false;
    }
    const dust = new THREE.Points(dustGeo, dustMat);
    dust.frustumCulled = false;
    scene.add(track(dust));

    // ════ AURORA SPIRIT — the Ascension wing of light ════
    // Pure additive light (never geometry, never occludes the board): a broad
    // wing-arc of flowing feathers with an amber heart → magenta → cyan tips.
    // Unfurls only at high S (Ascension); reflected by the lake for free.
    const uAscend = uniform(0);
    const wingMat = new THREE.MeshBasicNodeMaterial();
    {
        const p = uv().sub(vec2(0.5, 0.34));
        const px = p.x;
        const py = p.y;
        // A radiant crown-arc whose tips sweep up-and-out at the sides (wing-like).
        const arch = px.mul(px).mul(2.3);
        const along = py.sub(arch);
        const membrane = smoothstep(0.12, 0.0, abs(along)).mul(smoothstep(0.55, 0.06, abs(px)));
        // Cheap feather streaks — layered sines across the span (no per-fragment 3D noise).
        const feather = sin(px.mul(70.0).add(uTime.mul(0.7))).mul(0.5).add(0.5)
            .mul(sin(px.mul(26.0).sub(uTime.mul(0.45))).mul(0.5).add(0.5));
        const streak = feather.mul(0.75).add(0.35);
        // Colour: warm centre → magenta → cyan tips.
        const t = clamp(abs(px).mul(2.1), 0.0, 1.0);
        const col = mix(
            mix(vec3(1.0, 0.62, 0.28), vec3(1.0, 0.32, 0.72), smoothstep(0.0, 0.5, t)),
            vec3(0.50, 0.88, 1.0),
            smoothstep(0.5, 1.0, t),
        );
        const body = col.mul(membrane).mul(streak);
        // Dim — the post bloom supplies the glow (keeps it from blowing out).
        wingMat.colorNode = body.mul(uAscend).mul(0.6);
        wingMat.transparent = true;
        wingMat.blending = THREE.AdditiveBlending;
        wingMat.depthWrite = false;
        wingMat.toneMapped = false;
        wingMat.side = THREE.FrontSide;
    }
    const wing = new THREE.Mesh(new THREE.PlaneGeometry(360, 130), wingMat);
    wing.position.set(0, 44, -128);
    scene.add(track(wing));

    // ════ POST: threshold bloom + violet-ember ACES grade + vignette + grain ════
    // Threshold bloom (non-MRT) — the scene is high-contrast (dark base + bright
    // emissives) so a threshold naturally isolates the core/cracks/band/sparkle.
    // Portable to the WebGL fallback. Model: stellar-drift-post.js.
    const wantPost = !(params?.has?.('nopost'));
    let post = null;
    if (wantPost && renderer) {
        const uExposure = uniform(1.18);
        const uSaturation = uniform(1.13);
        const uContrast = uniform(1.13);
        const uBlack = uniform(0.014); // black-crush point (near-black shadows)
        const uCA = uniform(0.0024); // chromatic aberration (edges only)
        const uGrain = uniform(0.018);
        const uGrainT = uniform(0);
        const uBloomBoost = uniform(0); // Ascension bloom surge (driven by S)

        const scenePass = pass(scene, camera);
        const sceneColor = scenePass.getTextureNode('output');
        const bloomNode = bloom(sceneColor, bloomStrength, 0.74, 0.40);
        const bloomDownsample = bloomDS;
        const origSetSize = bloomNode.setSize.bind(bloomNode);
        bloomNode.setSize = (w, h) => origSetSize(w * bloomDownsample, h * bloomDownsample);

        // Subtle chromatic aberration: sample R/B at an edge-scaled UV offset (lens cue).
        const uvp = viewportUV;
        const caDir = uvp.sub(0.5);
        const caAmt = caDir.length().mul(uCA);
        const baseCol = caTaps === 3
            ? vec3(
                sceneColor.sample(uvp.add(caDir.mul(caAmt))).r,
                sceneColor.sample(uvp).g,
                sceneColor.sample(uvp.sub(caDir.mul(caAmt))).b,
            )
            : sceneColor.sample(uvp).rgb;
        const exposed = baseCol.add(bloomNode.rgb.mul(float(1.0).add(uBloomBoost))).mul(uExposure);
        // ACES filmic (Narkowicz) — renderer is NoToneMapping, so tonemap here.
        const a = float(2.51); const b = float(0.03);
        const c = float(2.43); const d = float(0.59); const e = float(0.14);
        const acesNum = exposed.mul(exposed.mul(a).add(b));
        const acesDen = exposed.mul(exposed.mul(c).add(d)).add(e);
        let graded = clamp(acesNum.div(acesDen), 0.0, 1.0);
        // Crush blacks toward zero (the Hatom near-black shadow signature).
        graded = graded.sub(uBlack).div(float(1.0).sub(uBlack)).max(0.0);
        // Violet-shadow / warm-amber split-tone (violet = R+B up, G down — NOT blue).
        const luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        const shadowTint = vec3(0.94, 0.82, 1.16);
        const highTint = vec3(1.20, 0.99, 0.80);
        graded = graded.mul(mix(shadowTint, highTint, smoothstep(0.06, 0.80, luma)));
        // Saturation + filmic contrast.
        graded = mix(vec3(luma), graded, uSaturation);
        graded = graded.sub(0.5).mul(uContrast).add(0.5);
        // Vignette (focuses the eye on the hero).
        const vigD = length(uvp.sub(0.5)).mul(1.75);
        graded = graded.mul(mix(float(0.58), float(1.0), smoothstep(1.1, 0.2, vigD)));
        // Fine film grain (kills sky banding).
        const grain = fract(sin(dot(uvp.add(uGrainT), vec2(12.9898, 78.233))).mul(43758.5453))
            .sub(0.5).mul(uGrain);
        graded = clamp(graded.add(grain), 0.0, 1.0);

        const postProcessing = new THREE.PostProcessing(renderer);
        postProcessing.outputNode = graded;
        postProcessing.needsUpdate = true;

        post = {
            uGrainT,
            uBloomBoost,
            setSize(w, h) {
                scenePass.setSize(w, h);
                if (bloomNode?._separableBlurMaterials?.length) bloomNode.setSize(w, h);
            },
            render() { postProcessing.render(); },
            renderAsync() { postProcessing.render(); return Promise.resolve(); },
            dispose() {
                scenePass.dispose?.();
                bloomNode.dispose?.();
                postProcessing.dispose?.();
            },
        };
        post.setSize(sizes?.width || window.innerWidth, sizes?.height || window.innerHeight);
    }

    // ════ METAMORPHOSIS DIRECTOR (inline) ════
    // One eased scalar S = persistent baseline (level) + decaying combo boost +
    // transient flares (line clears / t-spins / …). Idle → decays to the baseline.
    let sBaseline = clamp01(num(params, 'S', 0));
    let sCombo = 0;
    let sFlare = 0;
    let sEased = sBaseline;
    let intensity = 1; // reactivity multiplier (0 = off; reduced-motion → ~0.45)
    let lastTime = null;

    const applyPulse = (kind, payload = {}) => {
        if (intensity <= 0) return;
        const k = intensity;
        const RX = 0; const RZ = -95; // rings emit under the relic on the water
        switch (kind) {
            case 'lineClear':
                sFlare = Math.min(1, sFlare + (0.14 + 0.06 * (payload.lines || 1)) * k);
                spawnRing(RX, RZ, Math.min(1.2, 0.55 + 0.16 * (payload.lines || 1)) * k);
                break;
            case 'combo':
                sCombo = Math.min(0.55, (payload.count || 0) * 0.06) * k;
                if ((payload.count || 0) > 1) spawnRing(RX, RZ, 0.5 * k);
                break;
            case 'tspin':
                sFlare = Math.min(1, sFlare + 0.32 * k);
                spawnRing(RX, RZ, 0.95 * k);
                break;
            case 'b2b': if (payload.active) sFlare = Math.min(1, sFlare + 0.16 * k); break;
            case 'perfectClear':
                sFlare = Math.min(1, sFlare + 0.5 * k);
                spawnRing(RX, RZ, 1.2 * k); spawnRing(RX, RZ, 0.85 * k);
                break;
            case 'levelUp': sBaseline = Math.min(0.85, sBaseline + 0.07 * k); break;
            case 'pieceLock': case 'hardDrop':
                sFlare = Math.min(1, sFlare + 0.03 * k);
                spawnRing(RX, RZ, 0.16 * k);
                break;
            default: break;
        }
    };

    window.__VESPER__ = {
        setS: (v) => { sBaseline = clamp01(v); },
        getS: () => sEased,
        pulse: applyPulse,
    };

    // ── camera: default "breathing" drift + cursor parallax (reduced-motion aware) ──
    const reduceMotion = typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const camMotion = reduceMotion ? 0.28 : 1.0;
    let mouseTX = 0; let mouseTY = 0; let mouseX = 0; let mouseY = 0;
    const onMouse = (e) => {
        mouseTX = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
        mouseTY = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
    };
    if (typeof window !== 'undefined') window.addEventListener('mousemove', onMouse, { passive: true });

    return {
        camera(time, cam) {
            // ease the cursor toward its target → smooth parallax
            mouseX += (mouseTX - mouseX) * 0.045;
            mouseY += (mouseTY - mouseY) * 0.045;
            // organic breathing: layered slow sines (no single obvious period)
            const bx = (Math.sin(time * 0.13) * 1.3 + Math.sin(time * 0.07 + 1.7) * 0.8) * camMotion;
            const by = (Math.sin(time * 0.11 + 1.3) * 0.8 + Math.sin(time * 0.05) * 0.5) * camMotion;
            const bz = Math.sin(time * 0.06) * 1.6 * camMotion;
            cam.position.set(
                bx + mouseX * 7.0 * camMotion,
                15.5 + by + mouseY * -3.0 * camMotion,
                44 + bz,
            );
            cam.lookAt(
                mouseX * 4.5 * camMotion + Math.sin(time * 0.04) * 2.0 * camMotion,
                14.5 + mouseY * -1.6 * camMotion,
                -95,
            );
            cam.fov = 58;
            cam.near = 0.1;
            cam.far = 9000;
            cam.updateProjectionMatrix();
        },
        update(time) {
            const dt = lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.1, time - lastTime));
            lastTime = time;
            sCombo *= Math.exp(-dt * 0.7); // sustained boost fades over a few seconds
            sFlare *= Math.exp(-dt * 1.4); // transient spikes fade fast
            const target = clamp01(sBaseline + sCombo + sFlare);
            sEased += (target - sEased) * Math.min(1, dt * 3.2);
            uS.value = sEased;
            uAscend.value = clamp01((sEased - 0.5) / 0.35); // wing unfurls from S≈0.5→0.85
            wing.visible = uAscend.value > 0.001; // skip the additive wing plane entirely while dormant
            uCosmos.value = clamp01((sEased - 0.85) / 0.15); // planet ensemble blooms in at the Cosmos crest
            uTime.value = time;
            relic.rotation.y = time * 0.08;
            relic.position.y = 19 + Math.sin(time * 0.5) * 1.2; // slow idle bob (floats on the horizon)
            // combo rings: expand + fade + upload
            for (let i = 0; i < RING_COUNT; i += 1) {
                const s = ringState[i];
                if (s.amp > 0.001) { s.age += dt; s.amp *= Math.exp(-dt / 1.9); }
                ringNodes[i].value.set(s.x, s.z, s.age, s.amp);
            }
            if (post) {
                post.uGrainT.value = time % 10; // animate grain (kept small for precision)
                post.uBloomBoost.value = sEased * 0.7; // Ascension bloom surge
            }
        },
        // Own the render so the scene goes through the post pipeline (bloom + grade).
        render() { if (post) post.render(); else renderer.render(scene, camera); },
        renderAsync() {
            if (post) return post.renderAsync();
            return renderer.renderAsync(scene, camera);
        },
        resize(w, h) { post?.setSize(w, h); },
        pulse: applyPulse,
        setIntensity: (m) => { intensity = Math.max(0, m); },
        dispose() {
            if (typeof window !== 'undefined') window.removeEventListener('mousemove', onMouse);
            if (window.__VESPER__) delete window.__VESPER__;
            post?.dispose();
            if (reflection) { scene.remove(reflection.target); reflection.dispose?.(); }
            disposables.forEach((o) => {
                scene.remove(o);
                o.traverse?.((c) => { c.geometry?.dispose?.(); c.material?.dispose?.(); });
                o.geometry?.dispose?.();
                o.material?.dispose?.();
            });
            skyMat.dispose(); peakMat.dispose(); shardMat.dispose();
            disposeTextures.forEach((t) => t.dispose?.());
            if (envTexture) { if (scene.environment === envTexture) scene.environment = null; envTexture.dispose?.(); }
        },
    };
}
