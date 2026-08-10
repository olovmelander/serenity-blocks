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
 *   ?effect=vesper-chrysalis&orbit=0&t=6&quality=Low low-tier composition check
 * Live sweep:  window.__VESPER__.setS(0.6)
 */
import * as THREE from 'three/webgpu';
import {
    float, vec2, vec3, vec4, uniform, positionLocal, normalLocal, normalWorld, positionWorld,
    cameraPosition, normalize, dot, clamp, smoothstep, abs, mix, sin, pow, fract, length,
    screenUV, uv, atan, floor, pass, viewportUV, attribute, cos, texture, texture3D,
    reflector, mx_noise_float, mx_fractal_noise_float, positionGeometry,
    Fn, cameraProjectionMatrix, cameraViewMatrix,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js';
import { disposeBloomNodeDeep } from '../../themes/shared/bloom-dispose.js';
import {
    waveSlotsForTier,
    resolveComboProgress,
    accumulateComboBoost,
    comboMilestonesCrossed,
    pickExpiringSlotIndex,
} from './vesper-chrysalis-director.js';

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

// Five separated rock islands replace the former 95×62 left-side mound. Their
// footprints preserve a clear centre wedge while giving both crystal banks a
// readable base and deliberate water gaps between depth planes.
const SHORE_ISLANDS = [
    {
        x: -55, z: -58, rx: 18.5, rz: 11.5, crown: 5.0, rotation: -0.10, seed: 1207,
    },
    {
        x: -78, z: -88, rx: 12.5, rz: 7.5, crown: 3.4, rotation: 0.18, seed: 2333,
    },
    {
        x: -49, z: -113, rx: 9, rz: 5.5, crown: 2.7, rotation: -0.22, seed: 3469,
    },
    {
        x: 47, z: -64, rx: 16.5, rz: 9.5, crown: 4.0, rotation: 0.14, seed: 4591,
    },
    {
        x: 85, z: -101, rx: 11.5, rz: 7.2, crown: 3.2, rotation: -0.20, seed: 5717,
    },
];
const ISLAND_SEQUENCE = [0, 3, 1, 4, 0, 3, 2, 0, 4, 1, 3];
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const makeRng = (seed) => {
    let state = seed % 2147483647;
    if (state <= 0) state += 2147483646;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
};

const sampleIslandSurface = (island, localX, localZ) => {
    const r = Math.min(1, Math.hypot(localX / island.rx, localZ / island.rz));
    if (r <= 0.38) return THREE.MathUtils.lerp(island.crown, island.crown * 0.82, r / 0.38);
    if (r <= 0.72) return THREE.MathUtils.lerp(island.crown * 0.82, island.crown * 0.42, (r - 0.38) / 0.34);
    return THREE.MathUtils.lerp(island.crown * 0.42, 1.15, (r - 0.72) / 0.28);
};

const islandLocalToWorld = (island, localX, localZ) => {
    const c = Math.cos(island.rotation);
    const s = Math.sin(island.rotation);
    return {
        x: island.x + localX * c + localZ * s,
        z: island.z - localX * s + localZ * c,
    };
};

const buildIslandGeometry = (island) => {
    const segments = 14;
    const rng = makeRng(island.seed);
    const edgeScale = Array.from({ length: segments }, () => 0.90 + rng() * 0.20);
    const angleJitter = Array.from({ length: segments }, () => (rng() - 0.5) * 0.08);
    const heightJitter = Array.from({ length: segments }, () => (rng() - 0.5) * 0.34);
    const rings = [
        { radius: 0.38, height: island.crown * 0.82, irregularity: 0.35 },
        { radius: 0.72, height: island.crown * 0.42, irregularity: 0.65 },
        { radius: 1.00, height: 1.15, irregularity: 1.00 },
        { radius: 1.08, height: -1.10, irregularity: 1.00 },
        { radius: 0.74, height: -3.2 - island.crown * 0.12, irregularity: 0.80 },
    ];
    const positions = [0, island.crown, 0];
    rings.forEach((ring, ringIndex) => {
        for (let i = 0; i < segments; i += 1) {
            const angle = (i / segments) * Math.PI * 2 + angleJitter[i];
            const radial = ring.radius * THREE.MathUtils.lerp(1, edgeScale[i], ring.irregularity);
            const jitter = heightJitter[i] * (ringIndex < 2 ? 0.45 : 1.0);
            positions.push(
                Math.cos(angle) * island.rx * radial,
                ring.height + jitter,
                Math.sin(angle) * island.rz * radial,
            );
        }
    });
    const bottomIndex = positions.length / 3;
    positions.push(0, -3.5 - island.crown * 0.12, 0);
    const index = [];
    const at = (ring, segment) => 1 + ring * segments + (segment % segments);
    for (let i = 0; i < segments; i += 1) index.push(0, at(0, i + 1), at(0, i));
    for (let ring = 0; ring < rings.length - 1; ring += 1) {
        for (let i = 0; i < segments; i += 1) {
            const a0 = at(ring, i); const a1 = at(ring, i + 1);
            const b0 = at(ring + 1, i); const b1 = at(ring + 1, i + 1);
            index.push(a0, a1, b0, a1, b1, b0);
        }
    }
    for (let i = 0; i < segments; i += 1) {
        index.push(at(rings.length - 1, i), at(rings.length - 1, i + 1), bottomIndex);
    }
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    indexed.setIndex(index);
    const geometry = indexed.toNonIndexed();
    indexed.dispose();
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
};

export function create({
    scene, camera, renderer, sizes, params,
}) {
    const uTime = uniform(0);
    const uS = uniform(clamp01(num(params, 'S', 0)));
    // Crystal combo-resonance surge — mirrors uComboGlow (declared much later); hoisted here so
    // the crystal materials can read it without a temporal-dead-zone ReferenceError.
    const uCombo = uniform(0);
    // Desynced multi-rate throb (V4 1.4): the hero breathes instead of blinking as one LED.
    const pulseBody = sin(uTime.mul(0.70)).mul(0.5).add(0.5); // slow body swell
    const pulseVein = sin(uTime.mul(1.55).add(1.3)).mul(0.5).add(0.5); // faster vein flicker (phase-offset)
    const pulseCrack = sin(uTime.mul(1.05).add(3.0)).mul(0.5).add(0.5); // mid crack pulse (phase-offset)
    const disposables = [];
    const track = (o) => { disposables.push(o); return o; };
    const disposeTextures = []; // loaded textures (planets etc.) freed on dispose
    const uCosmos = uniform(0); // fades the planet ensemble in at the Cosmos beat (S≈0.85→1)

    // 6-tier quality presets (Minimal<Low<Medium<High<Ultra<Extreme). Audit-verified:
    // High/Ultra/Extreme stay VISUALLY IDENTICAL; the heavier cuts are scoped to Medium and below.
    const qName = params?.get?.('quality')
        || (typeof window !== 'undefined' && window.settings?.graphicsQuality)
        || 'High';
    const tier = ({
        Minimal: 0, Low: 1, Medium: 2, High: 3, Ultra: 4, Extreme: 5,
    })[qName] ?? 3;
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
    const reflTaps = tier <= 1 ? 1 : (tier <= 3 ? 3 : 5); // wet-mirror soft-reflection kernel taps (V4 1.3)
    const wantNebula = tier >= 2; // sky nebula lobe (V4 2.7)
    const nebOct = tier <= 2 ? 2 : (tier === 3 ? 3 : 4); // nebula fbm octaves by tier
    const nebWarp = tier >= 4; // domain-warp the nebula only on Ultra/Extreme (TDR caution)

    // ════ SKY DOME ════
    const skyMat = new THREE.MeshBasicNodeMaterial();
    {
        const dir = normalize(positionLocal);
        const { y } = dir;
        // 2.7 three-stop vertical gradient: deep-plum near-horizon → violet mid → indigo zenith
        const up = smoothstep(0.0, 0.62, y);
        const upHi = smoothstep(0.28, 0.92, y);
        let s = mix(vec3(0.135, 0.055, 0.150), vec3(0.055, 0.030, 0.120), up);
        s = mix(s, vec3(0.020, 0.014, 0.055), upHi);
        s = mix(s, s.mul(0.4), uS.mul(up).mul(0.85)); // darken as it wakes
        const bandStrength = float(1.0).sub(uS.mul(0.72));
        const band = pow(smoothstep(0.24, 0.0, abs(y.add(0.01))), float(1.9));
        const front = smoothstep(-0.4, 0.7, dir.z.negate());
        s = s.add(vec3(0.95, 0.33, 0.60).mul(band).mul(float(0.55).add(front.mul(0.45))).mul(0.5)
            .mul(bandStrength));
        // 2.7 low-key nebula lobe in the upper-side sky (noise paid over the whole dome ×2 → tier-gated)
        if (wantNebula) {
            const sideMask = smoothstep(0.05, 0.5, y).mul(smoothstep(0.98, 0.35, y)).mul(smoothstep(0.10, 0.55, abs(dir.x)));
            let np = dir.mul(2.2);
            if (nebWarp) {
                const warp = mx_fractal_noise_float(dir.mul(1.5).add(uTime.mul(0.01)), 2).mul(0.35);
                np = np.add(vec3(warp, warp.mul(0.7), warp.mul(1.2)));
            }
            const neb = pow(mx_fractal_noise_float(np, nebOct).mul(0.5).add(0.5), float(2.4));
            s = s.add(mix(vec3(0.34, 0.10, 0.42), vec3(0.12, 0.20, 0.5), neb).mul(neb).mul(sideMask).mul(0.11));
        }
        // 2.7 two-layer stars with twinkle + slight colour temperature (coarse bloom-eligible + fine dim)
        const P = floor(vec2(atan(dir.x, dir.z).mul(30.0), y.mul(48.0)));
        const seed = mx_noise_float(vec3(P.x, P.y, 1.0)).mul(0.5).add(0.5);
        const twk = sin(uTime.mul(2.3).add(seed.mul(40.0))).mul(0.5).add(0.5).mul(0.6)
            .add(0.4);
        const starTemp = mix(vec3(0.86, 0.90, 1.0), vec3(1.0, 0.86, 0.72), pow(fract(seed.mul(7.0)), float(2.0)));
        s = s.add(starTemp
            .mul(pow(seed, float(40.0)))
            .mul(smoothstep(0.08, 0.32, y))
            .mul(twk)
            .mul(float(0.9).add(uS.mul(1.1))));
        const P2 = floor(vec2(atan(dir.x, dir.z).mul(72.0), y.mul(110.0)));
        const seed2 = mx_noise_float(vec3(P2.x, P2.y, 5.0)).mul(0.5).add(0.5);
        const twk2 = sin(uTime.mul(3.1).add(seed2.mul(55.0))).mul(0.5).add(0.5);
        s = s.add(vec3(0.70, 0.78, 1.0).mul(pow(seed2, float(70.0))).mul(smoothstep(0.06, 0.30, y)).mul(twk2)
            .mul(0.5));
        skyMat.colorNode = s;
        skyMat.side = THREE.BackSide;
        skyMat.depthWrite = false;
        skyMat.toneMapped = false;
        skyMat.fog = false; // the dome must NOT fade to fog (it IS the light source)
    }
    scene.add(track(new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), skyMat)));

    // ════ PLANETS — HUGE backlit worlds (hatom phase-5): crescent rims + atmospheric halos ════
    // The worlds are ALWAYS in the sky (calm crescents while dormant, mirrored in the lake free);
    // their crescents + halos INTENSIFY at the Cosmos beat (uCosmos), when the light-wisp streaks
    // join as the climax flourish.
    const planets = new THREE.Group();
    const cosmosGroup = new THREE.Group(); // the giant worlds (always visible)
    planets.add(cosmosGroup);
    const streakGroup = new THREE.Group(); // light-wisp streaks — Cosmos-only, visibility-gated in update()
    streakGroup.visible = false;
    planets.add(streakGroup);
    const haloSprites = []; // additive atmosphere billboards, camera-billboarded each frame
    {
        const TEXBASE = `${(typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'}textures/`;
        const loader = new THREE.TextureLoader();
        const beamAim = new THREE.Vector3(0, 220, -1500); // BACKLIT: the light axis sits far behind the worlds
        const makePlanet = (file, rad, x, y, z, tint, opts) => {
            const map = loader.load(TEXBASE + file);
            map.colorSpace = THREE.SRGBColorSpace;
            disposeTextures.push(map);
            const parent = opts.always ? planets : cosmosGroup;
            // Cosmos worlds are BACKLIT (thin crescents); the always-visible anchor moon keeps a
            // front horizon-glow light so it reads as a softly-lit terminator moon while dormant.
            const sunJs = opts.always
                ? new THREE.Vector3(0.4, -0.05, 1.0).normalize()
                : beamAim.clone().sub(new THREE.Vector3(x, y, z)).normalize();
            const sunV = vec3(sunJs.x, sunJs.y, sunJs.z);
            const mat = new THREE.MeshBasicNodeMaterial();
            const N = normalize(normalWorld);
            const Vv = normalize(cameraPosition.sub(positionWorld));
            const ndv = clamp(dot(N, Vv), 0.0, 1.0);
            const lit = clamp(dot(N, sunV).mul(0.9).add(0.06), 0.05, 1.0); // hard crescent terminator
            const limb = pow(float(1.0).sub(ndv), float(7.0)); // THIN grazing-limb mask
            const litSide = pow(smoothstep(0.12, 0.75, dot(N, sunV)), float(1.5));
            // faintly-textured body (cloud bands stay readable in shadow) + the hatom signature:
            // a thin INTENSE warm crescent arc on the sunward limb + a whisper of cool dark-limb air.
            // The crescent sits at 55% while dormant and surges to full at the Cosmos crest.
            const cGain = uCosmos.mul(0.45).add(0.55);
            mat.colorNode = texture(map).rgb.mul(vec3(tint[0], tint[1], tint[2])).mul(lit.mul(0.6).add(0.12)).mul(0.85)
                .add(vec3(1.9, 1.42, 1.05).mul(limb).mul(litSide).mul(opts.crescent)
                    .mul(cGain))
                .add(vec3(0.55, 0.62, 0.95).mul(limb).mul(0.10));
            mat.toneMapped = false;
            mat.fog = false;
            mat.transparent = true;
            mat.opacityNode = float(0.92);
            const mesh = new THREE.Mesh(new THREE.SphereGeometry(rad, 48, 32), mat);
            mesh.position.set(x, y, z);
            parent.add(mesh);
            if (opts.halo > 0) {
                // atmospheric halo — a thin additive arc hugging the disc, STRONGLY biased to the
                // lit side (a partial crescent glow, not a donut); drawn BEFORE the body so the
                // disc silhouette occludes its inner edge.
                const hm = new THREE.MeshBasicNodeMaterial();
                const hd = uv().sub(0.5).mul(2.0);
                const hl = length(hd); // 0 centre → 1 quad edge; the disc edge sits at ~0.72
                const ring = smoothstep(0.64, 0.72, hl).mul(smoothstep(0.84, 0.73, hl));
                const glow = smoothstep(0.60, 0.74, hl).mul(smoothstep(1.0, 0.75, hl)).mul(0.30);
                const bias = pow(clamp(dot(hd, vec2(sunJs.x, sunJs.y)), 0.0, 1.0), float(2.0)).mul(0.95).add(0.10);
                hm.colorNode = vec3(1.55, 1.15, 0.9).mul(ring.mul(0.6).add(glow)).mul(bias).mul(opts.halo);
                hm.transparent = true;
                hm.blending = THREE.AdditiveBlending;
                hm.depthWrite = false;
                hm.depthTest = false; // halo reads beyond/over the silhouette
                hm.toneMapped = false;
                hm.fog = false;
                hm.opacityNode = opts.always ? float(0.5) : uCosmos.mul(0.5).add(0.5);
                const halo = new THREE.Mesh(new THREE.PlaneGeometry(rad * 2.7, rad * 2.7), hm);
                halo.position.set(x, y, z);
                halo.renderOrder = 1; // before the body (body renderOrder 2 occludes the halo centre)
                mesh.renderOrder = 2;
                parent.add(halo);
                haloSprites.push(halo);
            }
        };
        if (tier >= 1) {
            makePlanet('2k_moon.jpg', 14, -185, 235, -520, [0.42, 0.40, 0.56], {
                always: true, crescent: 0.55, halo: 0.35,
            });
            if (tier >= 2) {
                makePlanet('2k_jupiter.jpg', 85, -315, 300, -710, [0.55, 0.36, 0.42], {
                    always: false, crescent: 2.3, halo: 1.0,
                });
                makePlanet('2k_neptune.jpg', 66, 335, 335, -735, [0.34, 0.42, 0.74], {
                    always: false, crescent: 2.1, halo: 1.0,
                });
            }
            if (tier >= 3) {
                makePlanet('2k_saturn.jpg', 46, 150, 252, -655, [0.62, 0.50, 0.38], {
                    always: false, crescent: 1.7, halo: 0.8,
                });
                // procedural banded ring (avoids the RingGeometry uv issue)
                const ringMat = new THREE.MeshBasicNodeMaterial();
                const rr = length(uv().sub(0.5)); // 0 centre → 0.5 edge (RingGeometry uv is a disc)
                const rn = smoothstep(0.30, 0.5, rr);
                const bands = sin(rn.mul(46.0)).mul(0.5).add(0.5);
                ringMat.colorNode = vec3(0.85, 0.7, 0.55).mul(float(0.55).add(bands.mul(0.45))).mul(0.55);
                ringMat.opacityNode = smoothstep(0.30, 0.34, rr).mul(smoothstep(0.5, 0.46, rr))
                    .mul(uCosmos.mul(0.5).add(0.5)).mul(0.42);
                ringMat.transparent = true; ringMat.side = THREE.DoubleSide;
                ringMat.toneMapped = false; ringMat.fog = false; ringMat.depthWrite = false;
                const ring = new THREE.Mesh(new THREE.RingGeometry(64, 104, 64), ringMat);
                ring.position.set(150, 252, -655);
                ring.rotation.set(Math.PI * 0.42, 0.3, 0);
                cosmosGroup.add(ring);
                // light-wisp streaks — soft horizontal luminous bands crossing between the worlds
                for (let si = 0; si < 2; si += 1) {
                    const sm2 = new THREE.MeshBasicNodeMaterial();
                    const su = uv();
                    const sband = pow(smoothstep(0.5, 0.0, abs(su.y.sub(0.5))), float(2.0));
                    const sn = mx_fractal_noise_float(vec3(su.x.mul(7.0).sub(uTime.mul(0.015 + si * 0.008)), su.y.mul(3.0), 2.0 + si * 5.0), 2).mul(0.5).add(0.5);
                    sm2.colorNode = mix(vec3(0.75, 0.62, 1.0), vec3(1.0, 0.78, 0.62), su.x)
                        .mul(sband).mul(pow(sn, float(2.2))).mul(uCosmos)
                        .mul(0.24);
                    sm2.transparent = true;
                    sm2.blending = THREE.AdditiveBlending;
                    sm2.depthWrite = false;
                    sm2.toneMapped = false;
                    sm2.fog = false;
                    const streak = new THREE.Mesh(new THREE.PlaneGeometry(1900, 110), sm2);
                    streak.position.set(-60 + si * 160, 268 + si * 42, -640 - si * 60);
                    streak.renderOrder = 2;
                    streakGroup.add(streak);
                }
            }
        }
    }
    scene.add(track(planets));

    // ════ TWILIGHT FILL RIG (V4 1.1) — colored bounce so darks read as plum/indigo, not grey-black ════
    // The hero relic is a practical light: a warm amber radial bounce onto the terrain, escalation-gated so
    // the Dormant tableau barely changes and the fill blooms in as the world wakes (Spill→Ascension). Plus a
    // hemispheric colored ambient (cool indigo above → warm plum below) + a soft magenta key toward the band.
    const uRelicPos = uniform(new THREE.Vector3(0, 19, -95)); // egg world pos, updated each frame
    const uEggCol = uniform(new THREE.Color(1.0, 0.52, 0.16)); // warm amber
    const eggBounceNode = (Nrm) => {
        const toEgg = uRelicPos.sub(positionWorld);
        const d2 = dot(toEgg, toEgg);
        const dir = toEgg.div(d2.sqrt().max(0.001));
        const falloff = float(1.0).div(d2.mul(0.0016).add(1.0));
        const facing = clamp(dot(Nrm, dir), 0.0, 1.0).mul(0.7).add(0.3);
        return uEggCol.mul(falloff).mul(facing).mul(uS.mul(0.9).add(0.08)).mul(pulseBody.mul(0.25).add(0.85));
    };
    const hemiFillNode = (Nrm) => {
        const upf = Nrm.y.mul(0.5).add(0.5); // 0 down → 1 up
        const hemi = mix(vec3(0.075, 0.030, 0.060), vec3(0.040, 0.034, 0.090), upf); // plum below → indigo above
        const key = clamp(Nrm.z.negate(), 0.0, 1.0).mul(0.22); // faces the horizon band (−z)
        return hemi.add(vec3(0.46, 0.16, 0.26).mul(key));
    };

    // ════ MOUNTAIN RIDGES — jagged continuous silhouettes (CPU-baked ridge curtains) ════
    // A solid near-black curtain per range; the TOP edge is displaced by ridged noise into
    // organic jagged peaks (valleys submerge below the waterline → no seam). Fogged for depth.
    const peakMat = new THREE.MeshBasicNodeMaterial();
    {
        const Pw = positionWorld;
        const Nrm = normalize(normalWorld);
        const crest = pow(attribute('aCrest', 'float'), float(7.0));
        // near-black body + warm horizon-catch crest rim (existing look)
        let peakCol = vec3(0.010, 0.007, 0.020)
            .add(vec3(0.85, 0.36, 0.52).mul(crest).mul(0.17));
        // 1.1 vertical duotone: plum at the waterline → faint indigo up-ridge (subtle colored near-black)
        const hgt = smoothstep(-2.0, 46.0, Pw.y);
        peakCol = peakCol.add(mix(vec3(0.026, 0.012, 0.030), vec3(0.014, 0.013, 0.038), hgt).mul(0.5));
        // 1.1 egg practical-light bounce (negligible at ridge distance, but consistent)
        peakCol = peakCol.add(eggBounceNode(Nrm));
        // 1.2 aerial-perspective height fog: bases melt into magenta haze, crests stay silhouette
        const dist = length(Pw.sub(cameraPosition));
        const distF = smoothstep(160.0, 820.0, dist);
        const heightF = clamp(Pw.y.mul(-0.045).exp(), 0.0, 1.0); // dense at the waterline, thin at the crest
        const fogAmt = clamp(distF.mul(heightF), 0.0, 0.92);
        const fogCol = mix(vec3(0.055, 0.030, 0.075), vec3(0.28, 0.085, 0.150), heightF); // crest→mid-plum, base→magenta pole
        peakCol = mix(peakCol, fogCol, fogAmt);
        peakMat.colorNode = peakCol;
    }
    peakMat.toneMapped = false;
    peakMat.fog = false; // 1.2: per-material analytic height fog replaces THREE.Fog on the peaks
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

    // ════ AERIAL-HAZE VEILS + valley mist — receding-into-haze depth + mountain–lake seam softener ════
    if (tier >= 2) {
        const veilZ = tier >= 4 ? [-410, -560, -700, -780] : [-430, -640];
        veilZ.forEach((vz, i) => {
            const depth = i / Math.max(1, veilZ.length - 1); // 0 near → 1 far
            const veilMat = new THREE.MeshBasicNodeMaterial();
            const vv = uv();
            const band = smoothstep(0.42, 0.0, abs(vv.y.sub(0.40)));
            const pool = smoothstep(0.9, 0.1, vv.y).mul(0.5).add(0.6); // bottom-heavy pooling
            const drift = sin(vv.x.mul(6.0).add(uTime.mul(0.06 + i * 0.02)).add(i * 1.7)).mul(0.15).add(0.85); // desynced
            const col = mix(vec3(0.42, 0.24, 0.52), vec3(0.72, 0.24, 0.40), depth); // near cool violet → far warm magenta
            const dens = 0.10 + depth * 0.06; // far veils denser
            veilMat.colorNode = col.mul(band).mul(pool).mul(drift).mul(dens);
            veilMat.transparent = true;
            veilMat.blending = THREE.AdditiveBlending;
            veilMat.depthWrite = false;
            veilMat.toneMapped = false;
            veilMat.fog = false;
            veilMat.side = THREE.DoubleSide;
            const v = new THREE.Mesh(new THREE.PlaneGeometry(2600, 130), veilMat);
            v.position.set(0, 42, vz);
            v.renderOrder = -1;
            scene.add(track(v));
        });
        // ONE wide low mist band hugging the waterline (softens the seam; the reflector doubles it free).
        const mistMat = new THREE.MeshBasicNodeMaterial();
        {
            const mv = uv();
            const mband = smoothstep(0.55, 0.0, abs(mv.y.sub(0.30))); // low band near the waterline
            const xtaper = smoothstep(0.0, 0.06, abs(mv.x.sub(0.5))); // ZERO dead-centre (board wedge), full beyond ±6%
            const mdrift = sin(mv.x.mul(4.0).sub(uTime.mul(0.05))).mul(0.2).add(0.8);
            const moct = tier >= 3 ? 2 : 1;
            const mn = mx_fractal_noise_float(vec3(mv.x.mul(5.0), mv.y.mul(2.0).add(uTime.mul(0.02)), 0.0), moct).mul(0.5).add(0.5);
            mistMat.colorNode = vec3(0.40, 0.26, 0.46).mul(mband).mul(xtaper).mul(mdrift)
                .mul(mn.mul(0.5).add(0.5))
                .mul(0.08);
            mistMat.transparent = true;
            mistMat.blending = THREE.AdditiveBlending;
            mistMat.depthWrite = false;
            mistMat.toneMapped = false;
            mistMat.fog = false;
            mistMat.side = THREE.DoubleSide;
        }
        const mist = new THREE.Mesh(new THREE.PlaneGeometry(2400, 90), mistMat);
        mist.position.set(0, 8, -300); // waterline in front of the near range
        mist.renderOrder = -1;
        scene.add(track(mist));
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
            // 2.1 env matches the real sky (3-stop gradient + band) so glass/crystals reflect THIS world, not a generic blur
            let envc = mix(vec3(0.135, 0.055, 0.150), vec3(0.045, 0.026, 0.110), smoothstep(-0.05, 0.55, ey)); // plum → violet
            envc = mix(envc, vec3(0.018, 0.013, 0.050), smoothstep(0.30, 0.95, ey)); // → indigo zenith
            envc = envc.add(vec3(0.95, 0.32, 0.58).mul(pow(smoothstep(0.18, 0.0, abs(ey.add(0.02))), float(2.4))).mul(0.95)); // magenta band
            envDomeMat.colorNode = envc;
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
            // 2.1 near-black jagged ridge-ring at the horizon → reflections break on mountain shapes (not a clean gradient)
            if (tier >= 2) {
                const ridgeMat = new THREE.MeshBasicNodeMaterial();
                ridgeMat.colorNode = vec3(0.006, 0.004, 0.012);
                ridgeMat.toneMapped = false; ridgeMat.side = THREE.BackSide;
                const ridgeGeo = new THREE.CylinderGeometry(40, 40, 20, 64, 1, true);
                const rp = ridgeGeo.attributes.position;
                for (let i = 0; i < rp.count; i += 1) {
                    if (rp.getY(i) > 0) { // jag the top ring into peaks
                        const ang = Math.atan2(rp.getZ(i), rp.getX(i));
                        const jag = (1 - Math.abs(Math.sin(ang * 7.3))) + (1 - Math.abs(Math.sin(ang * 13.1 + 1.3))) * 0.5;
                        rp.setY(i, rp.getY(i) + jag * 6);
                    }
                }
                rp.needsUpdate = true;
                const ridgeRing = new THREE.Mesh(ridgeGeo, ridgeMat);
                ridgeRing.position.y = -6; // top edge sits near the env horizon
                envScene.add(ridgeRing);
                envDisposn.push(ridgeGeo, ridgeMat);
            }
            const rt = pmrem.fromScene(envScene, 0.02); // sharper prefilter (was 0.04) → crisper reflections
            if (rt?.texture) { envTexture = rt.texture; scene.environment = envTexture; }
            envDome.geometry.dispose(); envDomeMat.dispose();
            envDisposn.forEach((o) => o.dispose?.());
            pmrem.dispose?.();
        } catch (err) { console.warn('[vesper] IBL bake failed — egg falls back to fresnel-emissive:', err); }
    }

    // ════ HERO LIGHTS (V4 2.6) — real soft lights; ONLY the PBR heroes (crystals + egg) respond ════
    // MeshBasic peaks/boulders/mound/water/sky ignore lights, so the cost is confined to 2 materials.
    let heroHemi = null; let heroKey = null;
    if (tier >= 2) {
        heroHemi = new THREE.HemisphereLight(new THREE.Color(0.34, 0.22, 0.58), new THREE.Color(0.30, 0.12, 0.20), 0.40);
        scene.add(heroHemi);
        if (tier >= 3) {
            heroKey = new THREE.DirectionalLight(new THREE.Color(1.0, 0.62, 0.30), 0.40);
            heroKey.position.set(-42, 60, -60); // warm key from the upper-left band
            heroKey.target.position.set(0, 19, -95); // aim at the relic
            heroKey.castShadow = false;
            scene.add(heroKey); scene.add(heroKey.target);
        }
    }

    // ── combo water rings: pool of vec4(x, z, ageSec, amp) (halcyon pattern) ──
    // Count tiers down → fewer per-pixel loop iterations in the water shader (near-identical).
    const RING_COUNT = tier <= 1 ? 5 : (tier <= 3 ? 8 : 12);
    const ringNodes = Array.from({ length: RING_COUNT }, () => uniform(new THREE.Vector4(0, 0, 999, 0)));
    const ringState = Array.from({ length: RING_COUNT }, () => ({
        x: 0, z: 0, age: 999, amp: 0,
    }));
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
        // 2.5 directional 2-axis flow ripple: distinct x/z displacement → anisotropic liquid (High+ noise, else sines)
        const rippleAmt = float(rippleBase).add(uS.mul(0.006));
        let ripX; let ripZ;
        if (tier >= 3) {
            const fp = vec3(positionWorld.x.mul(0.03), positionWorld.z.mul(0.03), uTime.mul(0.05));
            ripX = mx_noise_float(fp);
            ripZ = mx_noise_float(fp.add(vec3(4.2, 1.3, 2.0)));
        } else {
            const ripS = sin(positionWorld.x.mul(0.05).add(uTime.mul(0.7)))
                .add(sin(positionWorld.z.mul(0.062).sub(uTime.mul(0.5))));
            ripX = ripS; ripZ = ripS.mul(0.6);
        }
        const reflUV = screenUV.flipX().add(vec2(ripX.mul(rippleAmt.mul(3.0)), ripZ.mul(rippleAmt.mul(1.8))));
        const V = normalize(cameraPosition.sub(positionWorld));
        // 1.3 wet-mirror: centerMask keeps the board strip flat/dark; a downward-smear kernel
        // (energy-preserving weights sum to 1) whose spread grows at grazing softens the mirror.
        const centerMask = smoothstep(16.0, 44.0, abs(positionWorld.x)); // 0 board strip → 1 flanks
        const graze = smoothstep(0.55, 0.0, abs(V.y)); // 1 at grazing horizon → 0 straight down
        let reflColor;
        if (reflection) {
            const spread = graze.mul(0.006).add(0.0015);
            if (reflTaps >= 5) {
                reflColor = reflection.sample(reflUV).rgb.mul(0.34)
                    .add(reflection.sample(reflUV.add(vec2(0.0, spread))).rgb.mul(0.22))
                    .add(reflection.sample(reflUV.sub(vec2(0.0, spread))).rgb.mul(0.22))
                    .add(reflection.sample(reflUV.add(vec2(0.0, spread.mul(2.0)))).rgb.mul(0.11))
                    .add(reflection.sample(reflUV.sub(vec2(0.0, spread.mul(2.0)))).rgb.mul(0.11));
            } else if (reflTaps >= 3) {
                reflColor = reflection.sample(reflUV).rgb.mul(0.5)
                    .add(reflection.sample(reflUV.add(vec2(0.0, spread))).rgb.mul(0.25))
                    .add(reflection.sample(reflUV.sub(vec2(0.0, spread))).rgb.mul(0.25));
            } else {
                reflColor = reflection.sample(reflUV).rgb;
            }
        } else {
            reflColor = vec3(0.12, 0.07, 0.24);
        }
        const fres = pow(clamp(float(1.0).sub(abs(V.y)), 0.0, 1.0), float(2.6));
        const reflectivity = clamp(fres.mul(0.9).add(float(0.08).mul(centerMask)), 0.0, 1.0);
        let bodyCol = mix(
            vec3(0.020, 0.014, 0.052),
            vec3(0.070, 0.038, 0.175),
            smoothstep(-400.0, -30.0, positionWorld.z).oneMinus(),
        );
        if (tier >= 3) {
            // Wave 3: procedural caustics on the near-shore lakebed (injected into the BODY, below the reflection).
            const cp = vec2(positionWorld.x.mul(0.06), positionWorld.z.mul(0.06));
            const c1 = mx_noise_float(vec3(cp.x, cp.y.add(uTime.mul(0.08)), 0.0));
            const c2 = mx_noise_float(vec3(cp.x.sub(uTime.mul(0.05)), cp.y, 3.0));
            const caus = pow(clamp(c1.add(c2).mul(0.5).add(0.5), 0.0, 1.0), float(4.0)); // clamp BEFORE pow (no NaN/overshoot)
            const nearShore = smoothstep(-260.0, -20.0, positionWorld.z).oneMinus();
            bodyCol = bodyCol.add(vec3(0.12, 0.34, 0.42).mul(caus).mul(nearShore).mul(centerMask)
                .mul(0.25)); // cap ≤0.25, off-centre
        }
        let water = mix(bodyCol, reflColor.mul(vec3(0.92, 0.90, 1.02)), reflectivity);
        if (wantGlint) {
            const glint = pow(mx_noise_float(positionWorld.mul(0.5).add(uTime.mul(0.15))).abs(), float(9.0));
            water = water.add(vec3(0.32, 0.82, 1.0).mul(glint).mul(0.5));
        }
        // Bioluminescent flow — drifting magenta blotches near the shore (the "living" water).
        if (flowOctaves > 0) {
            // 2.5 constant advection dir + a domain-warp (High+) so the glow churns organically, not as a conveyor scroll.
            const flowDir = vec2(0.10, -0.55); // constant (NOT per-pixel time×noise → no unbounded long-session shear)
            const base = vec2(positionWorld.x.mul(0.012), positionWorld.z.mul(0.012)).add(flowDir.mul(uTime.mul(0.06)));
            let fpv = base;
            if (tier >= 3) {
                const warp = mx_noise_float(vec3(base.x.mul(1.7), base.y.mul(1.7), uTime.mul(0.03))).mul(0.25);
                fpv = base.add(warp);
            }
            const flow = mx_fractal_noise_float(vec3(fpv.x, fpv.y, 0.0), flowOctaves).mul(0.5).add(0.5);
            const bio = pow(flow, float(3.0)).mul(smoothstep(-320.0, -10.0, positionWorld.z).oneMinus());
            water = water.add(vec3(0.55, 0.14, 0.62).mul(bio).mul(0.4));
        }
        // Granular shoreline glints trace the separate island footprints. The old single 56u
        // ring advertised the oversized mound; these narrow elliptical bands reinforce the
        // new archipelago and leave the protected centre wedge dark.
        if (tier >= 2) {
            let pathBand = float(0.0);
            SHORE_ISLANDS.forEach((island) => {
                const dx = positionWorld.x.sub(island.x);
                const dz = positionWorld.z.sub(island.z);
                const c = Math.cos(island.rotation);
                const s = Math.sin(island.rotation);
                const lx = dx.mul(c).sub(dz.mul(s));
                const lz = dx.mul(s).add(dz.mul(c));
                const ellipse = lx.div(island.rx).pow(2.0).add(lz.div(island.rz).pow(2.0)).sqrt();
                const band = smoothstep(0.035, 0.14, abs(ellipse.sub(1.04))).oneMinus();
                pathBand = pathBand.add(band);
            });
            const spark = pow(mx_noise_float(positionWorld.mul(0.7).add(uTime.mul(0.12))).abs(), float(5.0));
            const pathGlow = clamp(pathBand, 0.0, 1.0).mul(spark.mul(0.9).add(0.22));
            water = water.add(vec3(0.85, 0.25, 0.60).mul(pathGlow).mul(uS.mul(0.5).add(0.5)).mul(0.30));
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
        // Wave 3: roiling molten core — a domain-warp (once) on the churn field so it churns, not just scrolls.
        const coreWarp = mx_noise_float(positionLocal.mul(2.0).add(uTime.mul(0.10))).mul(0.3);
        const corePos = positionLocal.mul(2.8).add(vec3(coreWarp, uTime.mul(-0.28), coreWarp));
        const churn = mx_fractal_noise_float(corePos, 4).mul(0.5).add(0.5);
        // Dark cracked-rock heart with molten amber veins → reads as a distinct object
        // inside the glass (NOT a uniform glowing ball), like the Hatom embryo core.
        const coreVeinField = mx_fractal_noise_float(positionLocal.mul(3.2), 4).mul(0.5).add(0.5);
        const coreCrack = smoothstep(float(0.09), float(0.0), abs(coreVeinField.sub(0.5)));
        const veinGlow = coreCrack.mul(float(0.5).add(uS.mul(1.3)).add(pulseVein.mul(uS.mul(0.5).add(0.12))));
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
        // Wave 3: traveling crack-energy wave — light pulses run ALONG the cracks (not a uniform blink).
        const crackTravel = sin(crackField.mul(18.0).sub(uTime.mul(1.6))).mul(0.5).add(0.5);
        const crackGlow = crackLine.mul(uS).mul(pulseCrack.mul(0.35).add(0.85)).mul(crackTravel.mul(0.5).add(0.6));
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
            // Wave 3: subtle roughness breakup → panel-line reflections (glassier facets, not a uniform mirror)
            shellMat.roughnessNode = float(0.05).add(mx_noise_float(positionLocal.mul(4.0)).abs().mul(0.05));
        } else {
            shellMat.opacityNode = clamp(float(0.30).add(fres.mul(0.55)), 0.0, 1.0);
        }
        shellMat.transparent = true;
        shellMat.side = THREE.FrontSide;
        // icy fresnel rim + molten crack veins (emissive → bloom)
        shellMat.emissiveNode = vec3(0.35, 0.75, 1.0).mul(fres).mul(0.7)
            .add(vec3(1.0, 0.48, 0.12).mul(crackGlow).mul(1.7));
        // geode surface bumps
        // Wave 3: static geode bumps + a SMALL animated surface ripple (amp ~0.02 — larger would
        // visibly "swim" since normals aren't recomputed). The ripple grows as the relic wakes.
        const geode = mx_noise_float(positionLocal.mul(2.2)).mul(0.05);
        const surf = mx_noise_float(positionLocal.mul(3.0).add(uTime.mul(0.15))).mul(0.02).mul(uS.mul(0.6).add(0.4));
        shellMat.positionNode = positionLocal.add(normalLocal.mul(geode.add(surf)));
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

    // ════ CRYSTAL CLUSTERS — Lunara-quality faceted glass spires along the shore ════
    // Cut-crystal facets (flat normals) + PBR glass (hero transmission on tier≥2, like the egg) +
    // a living emissive interior (fresnel rim + tip-ramp + internal fracture + spine + band),
    // per-instance "twilight relic-shard" colour, meticulously composed L/R receding clusters with a
    // protected centre wedge + warm heroes flanking the relic. Field = 1 draw, heroes = 1 draw.
    const crystalRich = tier >= 3; // High/Ultra/Extreme: internal fracture + DoubleSide + sharp env
    const heroCountByTier = [0, 0, 3, 4, 5, 6];
    const fieldCountByTier = [12, 17, 23, 30, 34, 38];
    const heroCount = useTransmission ? (heroCountByTier[tier] ?? 4) : 0; // glass heroes only on tier≥2
    const fieldCount = fieldCountByTier[tier] ?? 50;

    // Faceted tapered ELLIPTICAL spire, UNIT height so positionGeometry.y stays ≈[-0.53,0.52]
    // regardless of per-instance scale (keeps the tip/spine ramps scale-invariant). Flat per-face
    // normals (toNonIndexed + computeVertexNormals) = cut-crystal glint. Winding is verified outward.
    const buildFacetedCrystalGeometry = (sides, radii, skew, seed) => {
        let s = seed % 2147483647; if (s <= 0) s += 2147483646;
        const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
        const ringY = [-0.48, -0.08, 0.28];
        const ringTwist = [0.0, 0.17, -0.08];
        const pos = [];
        for (let r = 0; r < 3; r += 1) {
            for (let i = 0; i < sides; i += 1) {
                const a = (i / sides) * Math.PI * 2 + ringTwist[r];
                const rad = radii[r] * (0.86 + rnd() * 0.25); // per-vertex chip jitter
                const zSquash = 0.72 + rnd() * 0.06; // elliptical cross-section (Lunara signature)
                pos.push(
                    Math.cos(a) * rad + Math.sin(i * 1.7 + r) * skew,
                    ringY[r],
                    Math.sin(a) * rad * zSquash + Math.cos(i * 1.4 + r) * skew,
                );
            }
        }
        const apexIdx = pos.length / 3;
        pos.push(skew * 0.5, 0.52, skew * -0.25); // apex
        const baseIdx = apexIdx + 1;
        pos.push(0, -0.53, 0); // base centre
        const idx = [];
        const ring = (r, i) => r * sides + (i % sides);
        for (let r = 0; r < 2; r += 1) { // stitch ring bands (outward winding)
            for (let i = 0; i < sides; i += 1) {
                const a0 = ring(r, i); const a1 = ring(r, i + 1);
                const b0 = ring(r + 1, i); const b1 = ring(r + 1, i + 1);
                idx.push(a0, b0, a1, a1, b0, b1);
            }
        }
        for (let i = 0; i < sides; i += 1) idx.push(ring(2, i), apexIdx, ring(2, i + 1)); // apex fan
        for (let i = 0; i < sides; i += 1) idx.push(ring(0, i + 1), baseIdx, ring(0, i)); // base fan
        const indexed = new THREE.BufferGeometry();
        indexed.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        indexed.setIndex(idx);
        const faceted = indexed.toNonIndexed();
        indexed.dispose();
        faceted.computeVertexNormals();
        faceted.computeBoundingSphere();
        return faceted;
    };

    // Shared emissive/position/opacity node graph so field + hero read identical. All crystal-LOCAL
    // masks use positionGeometry (NOT positionLocal — InstanceNode instance-transforms positionLocal
    // first, which would make tip/spine ramps read world-space Y and saturate).
    const makeCrystalNodes = (emissiveColorVec, withFracture) => {
        const N = normalize(normalWorld);
        const V = normalize(cameraPosition.sub(positionWorld));
        const fres = pow(clamp(float(1.0).sub(dot(N, V)), 0.0, 1.0), float(2.4)); // grazing-edge rim
        const gY = positionGeometry.y;
        const tipRamp = pow(clamp(gY.mul(0.95).add(0.5), 0.0, 1.0), float(2.0)); // tips glow brightest
        const spineD = clamp(abs(positionGeometry.x.add(positionGeometry.z)).mul(1.4), 0.0, 1.0);
        const spine = pow(spineD.oneMinus(), float(3.0)); // internal core light-pipe
        const band = sin(gY.mul(4.0).add(uTime.mul(0.4))).mul(0.5).add(0.5); // animated vertical band
        let fracture = float(0.0);
        if (withFracture) {
            // Internal fracture planes — REUSE the egg's crack-isoline idiom (not Lunara's voronoi3),
            // slowly drifting in Y so the interior facets shimmer. Heaviest term → tier≥3 only.
            const fField = mx_fractal_noise_float(positionGeometry.mul(1.6).add(vec3(0.0, uTime.mul(0.04), 0.0)), 3).mul(0.5).add(0.5);
            fracture = smoothstep(float(0.12), float(0.0), abs(fField.sub(0.5)));
        }
        const aPhase = attribute('aPhase', 'float');
        const aRate = attribute('aRate', 'float');
        const aTint = attribute('aTint', 'vec3'); // per-instance full-bright glow hue
        const breath = sin(uTime.mul(aRate).add(aPhase.mul(6.283))).mul(0.5).add(0.5)
            .mul(0.35)
            .add(0.82); // 0.82..1.17 desynced breathing glow
        const interior = mix(emissiveColorVec, aTint, float(0.6)).mul(band.mul(0.35).add(0.65));
        const wake = float(0.30).add(uS.mul(1.10)).add(uCombo.mul(0.50)); // dormant→awake + combo surge
        const emissiveFactor = fres.mul(0.42)
            .add(tipRamp.mul(0.42)).add(fracture.mul(0.32)).add(spine.mul(0.38))
            .add(0.12);
        const emissiveNode = interior.mul(emissiveFactor).mul(wake).mul(breath);
        // top-sway (same idiom as the old shard: positionGeometry mask, positionLocal base)
        const swayMask = positionGeometry.y.add(0.5).clamp(0.0, 1.0);
        const sway = sin(uTime.mul(aRate.mul(0.6)).add(aPhase.mul(6.283))).mul(swayMask).mul(0.05);
        const positionNode = positionLocal.add(vec3(sway, 0.0, sway.mul(0.5)));
        const opacityNode = clamp(float(0.62).add(fres.mul(0.36)), 0.0, 1.0); // glassy edge fade
        return { emissiveNode, positionNode, opacityNode };
    };

    // Field material — rich MeshStandardNode; instanceColor is the (dark) albedo, aTint the glow.
    const fieldMat = new THREE.MeshStandardNodeMaterial();
    fieldMat.color = new THREE.Color(1, 1, 1);
    fieldMat.vertexColors = true; // InstancedMesh instanceColor → albedo (repo-proven, lunara)
    fieldMat.metalness = 0.0;
    fieldMat.roughness = crystalRich ? 0.08 : 0.16;
    fieldMat.envMapIntensity = crystalRich ? 1.3 : 0.9; // reflects the procedural PMREM env
    fieldMat.side = crystalRich ? THREE.DoubleSide : THREE.FrontSide;
    fieldMat.transparent = true;
    fieldMat.depthWrite = true; // crisp self-occluding facets (was false for the faux-glass cones)
    {
        const nodes = makeCrystalNodes(vec3(0.75, 0.63, 1.0), crystalRich);
        fieldMat.emissiveNode = nodes.emissiveNode;
        fieldMat.positionNode = nodes.positionNode;
        fieldMat.opacityNode = nodes.opacityNode;
    }

    // Hero material — true-glass transmission (built only on tier≥2, piggybacks the egg's RT).
    let heroMat = null;
    if (heroCount > 0) {
        heroMat = new THREE.MeshPhysicalNodeMaterial();
        heroMat.color = new THREE.Color(1, 1, 1);
        heroMat.vertexColors = true;
        heroMat.metalness = 0.0;
        heroMat.roughness = 0.06;
        heroMat.envMapIntensity = 1.3;
        heroMat.side = THREE.FrontSide; // matches the proven egg glass; thickness fakes the volume
        heroMat.transparent = true;
        heroMat.depthWrite = true;
        heroMat.clearcoat = 0.55;
        heroMat.clearcoatRoughness = 0.18;
        heroMat.transmission = 0.92;
        heroMat.ior = 1.8;
        heroMat.thickness = 2.6;
        heroMat.attenuationColor = new THREE.Color(1.0, 0.55, 0.30); // warm molten-relic interior
        heroMat.attenuationDistance = 7.0;
        const hn = makeCrystalNodes(vec3(1.0, 0.72, 0.42), crystalRich); // warm-biased emissive base
        heroMat.emissiveNode = hn.emissiveNode;
        heroMat.positionNode = hn.positionNode;
    }

    // Curated hero anchors live in normalized island-local coordinates. Field crystals use a
    // balanced golden-angle sequence across the same five islands, creating discrete clumps with
    // visible rock and water between them instead of one continuous left-side silhouette.
    const HERO_ANCHORS = [
        {
            island: 0, ux: 0.46, uz: -0.05, warm: true,
        },
        {
            island: 3, ux: -0.40, uz: 0.02, warm: true,
        },
        {
            island: 1, ux: 0.24, uz: -0.02, warm: false,
        },
        {
            island: 4, ux: -0.20, uz: -0.04, warm: false,
        },
        {
            island: 2, ux: 0.10, uz: 0.02, warm: true,
        },
        {
            island: 0, ux: -0.34, uz: 0.16, warm: false,
        },
    ];
    const RELIC = { x: 0, z: -95 };
    const twilightSink = new THREE.Color(0x1a0e30); // deep near-black violet for far depth-sink
    const pickHue = (rng, x, z, forceWarm) => {
        const c = new THREE.Color();
        if (forceWarm || (Math.hypot(x - RELIC.x, z - RELIC.z) < 42 && rng() < 0.35)) {
            c.set(rng() < 0.5 ? 0xffb060 : 0xff7d9e); // amber / rose — relic-heart echo
        } else {
            const r = rng();
            if (r < 0.16) c.set(0x76dfff); // icy cyan
            else if (r < 0.32) c.set(0xff72d1); // magenta
            else if (r < 0.46) c.set(0xd486ff); // purple
            else c.set(0x8b61e8); // violet base
        }
        const far = Math.min(1, Math.max(0, (-z - 18) / 178));
        return c.lerp(twilightSink, far * 0.45);
    };

    const buildCrystalMesh = (geo, mat, count, opts) => {
        const mesh = new THREE.InstancedMesh(geo, mat, count);
        let s = opts.seed % 2147483647; if (s <= 0) s += 2147483646;
        const rng = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
        const _m = new THREE.Matrix4(); const _q = new THREE.Quaternion();
        const _e = new THREE.Euler(); const _s = new THREE.Vector3(); const _p = new THREE.Vector3();
        const aPhaseArr = new Float32Array(count);
        const aRateArr = new Float32Array(count);
        const aTintArr = new Float32Array(count * 3);
        const islandOrdinals = new Array(SHORE_ISLANDS.length).fill(0);
        for (let i = 0; i < count; i += 1) {
            // low tiers have no hero mesh → the first few field crystals stand in as pseudo-heroes.
            const asHero = opts.hero || (opts.foldHeroes && i < opts.foldHeroes);
            let islandIndex; let localX; let localZ; let forceWarm = false;
            if (asHero) {
                const anchor = HERO_ANCHORS[i % HERO_ANCHORS.length];
                islandIndex = anchor.island;
                const island = SHORE_ISLANDS[islandIndex];
                localX = anchor.ux * island.rx;
                localZ = anchor.uz * island.rz;
                forceWarm = anchor.warm;
            } else {
                const fieldIndex = Math.max(0, i - (opts.foldHeroes || 0));
                islandIndex = ISLAND_SEQUENCE[fieldIndex % ISLAND_SEQUENCE.length];
                const island = SHORE_ISLANDS[islandIndex];
                const ordinal = islandOrdinals[islandIndex];
                islandOrdinals[islandIndex] += 1;
                const angle = ordinal * GOLDEN_ANGLE + island.seed * 0.013 + (rng() - 0.5) * 0.34;
                const radius = 0.22 + Math.sqrt(rng()) * 0.46;
                localX = Math.cos(angle) * island.rx * radius;
                localZ = Math.sin(angle) * island.rz * radius;
            }
            const island = SHORE_ISLANDS[islandIndex];
            const world = islandLocalToWorld(island, localX, localZ);
            const { x, z } = world;
            const depthScale = Math.max(0.65, Math.min(1, (z + 125) / 72));
            const isStub = !asHero && rng() < 0.34;
            let sy;
            if (asHero) sy = (8.8 + rng() * 3.6) * depthScale;
            else if (isStub) sy = (2.6 + rng() * 2.2) * depthScale;
            else sy = (4.6 + rng() * 4.3) * depthScale;
            // Chunky gem proportions (aspect ≈3-6:1, not needle-thin); heroes stay broad landmarks.
            let widthBase;
            if (asHero) widthBase = 2.45;
            else if (isStub) widthBase = 1.9;
            else widthBase = 1.5;
            const sxW = widthBase * (0.86 + rng() * 0.28);
            const szW = sxW * (0.82 + rng() * 0.36);
            let lean = 0.20;
            if (asHero) lean = 0.12;
            else if (isStub) lean = 0.26;
            const surfaceY = sampleIslandSurface(island, localX, localZ);
            const sink = sy * (asHero ? 0.12 : 0.16) + 0.18;
            _e.set((rng() - 0.5) * lean, rng() * Math.PI * 2, (rng() - 0.5) * lean);
            _q.setFromEuler(_e);
            _s.set(sxW, sy, szW);
            _p.set(x, surfaceY + 0.53 * sy - sink, z);
            _m.compose(_p, _q, _s);
            mesh.setMatrixAt(i, _m);
            const hue = pickHue(rng, x, z, forceWarm);
            mesh.setColorAt(i, hue.clone().multiplyScalar(0.42)); // dark body with enough lift for faceted read
            aTintArr[i * 3] = hue.r; aTintArr[i * 3 + 1] = hue.g; aTintArr[i * 3 + 2] = hue.b;
            aPhaseArr[i] = rng();
            aRateArr[i] = 0.5 + rng() * 0.7; // desynced breath rate
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aPhaseArr, 1));
        geo.setAttribute('aRate', new THREE.InstancedBufferAttribute(aRateArr, 1));
        geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(aTintArr, 3));
        mesh.frustumCulled = false;
        mesh.renderOrder = 0; // explicit — sorts between background veils (−1) and additive FX (1-3)
        return mesh;
    };

    const fieldGeo = buildFacetedCrystalGeometry(crystalRich ? 6 : 5, [0.72, 0.56, 0.30], 0.16, 91713);
    const fieldMesh = buildCrystalMesh(fieldGeo, fieldMat, fieldCount, {
        seed: 91713, foldHeroes: tier <= 1 ? 4 : 0,
    });
    scene.add(track(fieldMesh));
    let heroMesh = null;
    if (heroCount > 0) {
        const heroGeo = buildFacetedCrystalGeometry(6, [0.84, 0.70, 0.48], 0.10, 20477); // fatter neck, less twist → solid majestic heroes
        heroMesh = buildCrystalMesh(heroGeo, heroMat, heroCount, { seed: 20477, hero: true });
        scene.add(track(heroMesh));
    }

    // ════ FOREGROUND BOULDERS — near-black silhouettes at the frame edges (depth stack) ════
    let boulderCountT = 8;
    if (tier <= 1) boulderCountT = 4;
    else if (tier <= 2) boulderCountT = 5;
    else if (tier === 3) boulderCountT = 6;
    const bnoise = (x, y) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };
    const boulderMat = new THREE.MeshBasicNodeMaterial();
    {
        const N = normalize(normalWorld);
        const V = normalize(cameraPosition.sub(positionWorld));
        const f = pow(clamp(float(1.0).sub(dot(N, V)), 0.0, 1.0), float(2.6));
        // Wave 3: rock micro-grain — world-space fbm modulates the lit terms so surfaces read as
        // textured stone in the rim/fill light (base silhouette stays untouched). High+ only.
        let gMod = float(1.0);
        if (tier >= 3) {
            gMod = mx_fractal_noise_float(positionWorld.mul(0.33), 3).mul(0.5).add(0.5).mul(0.6)
                .add(0.7);
        }
        boulderMat.colorNode = vec3(0.008, 0.006, 0.016)
            .add(vec3(0.7, 0.28, 0.42).mul(f).mul(0.09).mul(gMod)) // faint magenta rim, grained
            .add(hemiFillNode(N).mul(0.5).mul(gMod)) // 1.1 colored ambient (plum/indigo, capped)
            .add(eggBounceNode(N).mul(0.7).mul(gMod)); // 1.1 warm egg bounce
        boulderMat.toneMapped = false;
    }
    const boulderGeo = new THREE.IcosahedronGeometry(1, 2);
    {
        const p = boulderGeo.attributes.position; // jitter the shared shape into an irregular rock
        for (let i = 0; i < p.count; i += 1) {
            p.setXYZ(
                i,
                p.getX(i) + (bnoise(p.getX(i) * 3, p.getZ(i) * 3) - 0.5) * 0.4,
                p.getY(i) + (bnoise(p.getY(i) * 3 + 5, p.getX(i) * 3) - 0.5) * 0.4,
                p.getZ(i) + (bnoise(p.getZ(i) * 3 + 9, p.getY(i) * 3) - 0.5) * 0.4,
            );
        }
        p.needsUpdate = true;
    }
    const boulders = new THREE.InstancedMesh(boulderGeo, boulderMat, boulderCountT);
    {
        const _m = new THREE.Matrix4(); const _q = new THREE.Quaternion();
        const _e = new THREE.Euler(); const _s = new THREE.Vector3(); const _p = new THREE.Vector3();
        // Wave 3: parallax corner anchors — the first two instances become near-foreground rocks
        // pinned to the lower frame corners (x from the per-aspect horizontal frustum half-width;
        // z capped ≤ +16 so they stay ≥~18u from the lens even at the full Cosmos dolly-in).
        const aspect = (sizes?.width || 1280) / (sizes?.height || 720);
        const cornerX = 36 * Math.tan((58 / 2) * (Math.PI / 180)) * aspect * 0.85;
        const overlapsIsland = (worldX, worldZ, scale) => SHORE_ISLANDS.some((island) => {
            const dx = worldX - island.x;
            const dz = worldZ - island.z;
            const c = Math.cos(island.rotation);
            const s = Math.sin(island.rotation);
            const localX = dx * c - dz * s;
            const localZ = dx * s + dz * c;
            return Math.hypot(
                localX / (island.rx + scale * 0.45),
                localZ / (island.rz + scale * 0.35),
            ) < 1;
        });
        for (let i = 0; i < boulderCountT; i += 1) {
            const side = i % 2 === 0 ? -1 : 1;
            let sc = 5 + bnoise(i, 3) * 13; // 5..18
            let x = side * (44 + bnoise(i, 1) * 62); // |x| 44..106 (frame edges, clear centre)
            let z = -8 - bnoise(i, 2) * 62; // z -8..-70 (foreground)
            if (i < 2 && boulderCountT > 4) { // corner anchors (skip on the sparse low tiers)
                sc = 11 + i * 3;
                x = side * cornerX;
                z = 6 + i * 5; // +6 / +11 (≤ +16 cap)
            }
            if (i >= 2 && overlapsIsland(x, z, sc)) {
                x = side * (96 + bnoise(i, 8) * 28);
                z = -18 - bnoise(i, 9) * 60;
                sc *= 0.75;
            }
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

    // ════ CRYSTAL ISLANDS — five separated low-poly rock crowns with visible wet skirts ════
    // The old displaced plane formed one 95×62 near-black canopy and buried lake-rooted crystals.
    // These compact, asymmetric islands expose water gaps, carry the crystals at sampled surface Y,
    // and use a narrow shoreline lift so their silhouettes survive the LUT/vignette black crush.
    const islandMat = new THREE.MeshBasicNodeMaterial();
    {
        const N = normalize(normalWorld);
        const P = positionWorld;
        const top = smoothstep(0.58, 0.90, N.y);
        const key = clamp(dot(N, normalize(vec3(-0.35, 0.78, 0.52))), 0.0, 1.0);
        const waterline = smoothstep(0.22, 1.35, abs(P.y.sub(0.10))).oneMinus()
            .mul(smoothstep(0.30, 0.72, N.y).oneMinus());
        const crown = smoothstep(0.5, 4.5, P.y).mul(top);
        const fillMask = top.mul(0.55).add(0.35);
        let livingDetail = vec3(0.0);
        if (tier >= 2) {
            const field = mx_fractal_noise_float(P.mul(0.18).add(vec3(0.0, uTime.mul(0.012), 0.0)), tier >= 3 ? 3 : 2)
                .mul(0.5).add(0.5);
            const fineVein = smoothstep(0.025, 0.075, abs(field.sub(0.5))).oneMinus().mul(top);
            const speck = pow(mx_noise_float(P.mul(0.62)).abs(), float(5.0)).mul(top);
            const twinkle = sin(uTime.mul(1.4).add(mx_noise_float(P.mul(0.9)).mul(18.0))).mul(0.18).add(0.82);
            livingDetail = vec3(0.62, 0.13, 0.42).mul(fineVein).mul(0.075)
                .add(vec3(0.36, 0.18, 0.52).mul(speck).mul(twinkle).mul(0.055));
        }
        islandMat.colorNode = mix(vec3(0.014, 0.008, 0.032), vec3(0.090, 0.028, 0.125), top)
            .add(vec3(0.20, 0.08, 0.27).mul(key).mul(0.40).mul(fillMask))
            .add(hemiFillNode(N).mul(0.62).mul(fillMask))
            .add(eggBounceNode(N).mul(0.62))
            .add(vec3(0.50, 0.12, 0.38).mul(waterline).mul(0.25))
            .add(vec3(0.13, 0.06, 0.23).mul(crown).mul(0.20))
            .add(livingDetail.mul(float(0.45).add(uS.mul(0.55))));
        islandMat.toneMapped = false;
    }
    const islands = new THREE.Group();
    SHORE_ISLANDS.forEach((island) => {
        const mesh = new THREE.Mesh(buildIslandGeometry(island), islandMat);
        mesh.position.set(island.x, 0, island.z);
        mesh.rotation.y = island.rotation;
        mesh.renderOrder = 0;
        islands.add(mesh);
    });
    scene.add(track(islands));

    // 2.5 cheap curl-ish swirl velocity from a 2D noise field (ONE call per point → 2 noise/vert, reused for x/z)
    const curlDrift = (px, pz, t, amp) => vec2(
        mx_noise_float(vec3(px.mul(0.08), pz.mul(0.08), t)),
        mx_noise_float(vec3(px.mul(0.08).add(11.3), pz.mul(0.08).add(5.1), t)),
    ).mul(amp);

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
        // 2.5 curl-noise wander (High+) — organic swirl instead of bounded sines; y stays a gentle bob
        let wander;
        if (tier >= 3) {
            const cv = curlDrift(positionLocal.x.add(sd.x.mul(50.0)), positionLocal.z.add(sd.z.mul(50.0)), uTime.mul(0.05), 9.0);
            wander = vec3(cv.x, sin(uTime.mul(0.17).add(sd.y.mul(6.283))).mul(5.0), cv.y);
        } else {
            wander = vec3(
                sin(uTime.mul(0.23).add(sd.x.mul(6.283))).mul(9.0),
                sin(uTime.mul(0.17).add(sd.y.mul(6.283))).mul(5.0),
                cos(uTime.mul(0.19).add(sd.z.mul(6.283))).mul(9.0),
            );
        }
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
        // 2.5 curl-noise drift (High+) — slow organic swirl across the whole view; y stays a gentle bob
        let drift;
        if (tier >= 3) {
            const cx = positionLocal.x.add(sd.y.mul(60.0));
            const cz = positionLocal.z.add(sd.x.mul(60.0));
            const cv = curlDrift(cx, cz, uTime.mul(0.035), 7.0);
            drift = vec3(cv.x, sin(uTime.mul(0.05).add(sd.y.mul(6.283))).mul(5.0), cv.y);
        } else {
            drift = vec3(
                sin(uTime.mul(0.08).add(sd.x.mul(6.283))).mul(7.0),
                sin(uTime.mul(0.05).add(sd.y.mul(6.283))).mul(5.0),
                cos(uTime.mul(0.07).add(sd.z.mul(6.283))).mul(7.0),
            );
        }
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

    // ════ RELIC BURSTS (FX) — the heart exhales: pooled one-shot spore bursts, pure GPU vertex math ════
    // One Points pool partitioned across BURST_SLOTS slots; applyPulse writes a slot's uniforms
    // (emitter / colour+density / shape) and the burst plays out entirely in the vertex shader —
    // radial shoot with exponential decel, then a slow ambient float across the scene, then fade.
    // Zero per-frame uploads; the ringNodes uniform-pool pattern extended to particles (WebGL-safe).
    const BURST_SLOTS = 5;
    let BURST_POOL;
    if (tier <= 1) BURST_POOL = 240; else if (tier <= 2) BURST_POOL = 400; else BURST_POOL = 600;
    // Per-slot params as PLAIN SCALAR uniforms (the uS/uTime pattern — the only uniform form this
    // stack reliably reads in the Points VERTEX stage; vec4-uniform arithmetic there mis-builds).
    const mkSlots = (v) => Array.from({ length: BURST_SLOTS }, () => uniform(v));
    const bPX = mkSlots(0); const bPY = mkSlots(0); const bPZ = mkSlots(0); const bT0 = mkSlots(-1e3);
    const bCR = mkSlots(1); const bCG = mkSlots(1); const bCB = mkSlots(1); const bDen = mkSlots(0);
    const bRad = mkSlots(20); const bLif = mkSlots(3); const bSwl = mkSlots(0); const bUp = mkSlots(0.3);
    // Spawns are QUEUED and stamped inside update(time) — t0 must come from the exact same clock
    // update() writes into uTime. (Stamping from uTime.value at pulse time skews across playground
    // HMR remount epochs: bursts are born "in the past", age past life instantly, and never show.)
    // The slot is chosen at STAMP time (in update, on the authoritative clock) so a fresh burst
    // takes the slot NEAREST death — in-flight spore bursts keep playing instead of being
    // round-robined out. This is the "pooled effects stay alive / accumulate" behavior.
    const burstState = Array.from({ length: BURST_SLOTS }, () => ({ t0: -1e3, life: 0 }));
    const burstQueue = [];
    const spawnBurst = (px, py, pz, col, density, maxR, life, swirl, upBias) => {
        burstQueue.push({
            px, py, pz, col, density, maxR, life, swirl, upBias,
        });
        if (burstQueue.length > BURST_SLOTS) burstQueue.shift(); // never backlog beyond the pool
    };
    // ONE camera-facing BILLBOARD-QUAD InstancedMesh PER SLOT — the snow-renderer pattern.
    // ROOT CAUSE of the invisible bursts: WebGPU Points rasterize at 1px and sizeNode is
    // IGNORED, so sparse spore bursts vanish. Quads can be sized/soft-masked. 5 draws.
    const PER_SLOT = Math.floor(BURST_POOL / BURST_SLOTS);
    const burstQuad = new THREE.PlaneGeometry(1, 1);
    for (let slot = 0; slot < BURST_SLOTS; slot += 1) {
        const mat = new THREE.MeshBasicNodeMaterial();
        const sdB = attribute('aSeed', 'vec3'); // per-INSTANCE seed (InstancedBufferAttribute)
        // per-particle scatter dir + tangent derived from the seed (normalized-cube random)
        const dirA = normalize(vec3(sdB.x.sub(0.5), sdB.y.sub(0.5), sdB.z.mul(0.9).sub(0.45)));
        const tanA = normalize(vec3(dirA.z.negate(), float(0.0), dirA.x));
        const n = clamp(uTime.sub(bT0[slot]).div(bLif[slot]), 0.0, 1.0); // idle: t0=-1e3 → n=1 → dead
        const age = n.mul(bLif[slot]);
        const dl = bDen[slot];
        const aliveB = float(1.0).sub(smoothstep(dl.sub(0.002), dl, sdB.x)); // density gates fired count
        const shoot = age.div(age.add(0.55)); // rational decel toward the max radius
        const rr = bRad[slot].mul(shoot).mul(sdB.y.mul(0.55).add(0.55));
        const fl = smoothstep(0.4, 1.6, age); // ambient float ramps in as the shoot settles
        const driftB = vec3(
            sin(uTime.mul(0.45).add(sdB.z.mul(21.0))),
            sin(uTime.mul(0.34).add(sdB.x.mul(17.0))).mul(0.6).add(0.25),
            cos(uTime.mul(0.40).add(sdB.y.mul(23.0))),
        ).mul(fl).mul(n.mul(7.0).add(2.0));
        const spiral = tanA.mul(bSwl[slot]).mul(rr).mul(sin(age.mul(2.2).add(sdB.z.mul(6.28))).mul(0.55));
        const emit = vec3(1.0, 0.0, 0.0).mul(bPX[slot])
            .add(vec3(0.0, 1.0, 0.0).mul(bPY[slot]))
            .add(vec3(0.0, 0.0, 1.0).mul(bPZ[slot]));
        const upLift = vec3(0.0, 1.0, 0.0).mul(bUp[slot]).mul(rr).mul(0.8);
        const fadeB = smoothstep(0.0, 0.05, n)
            .mul(float(1.0).sub(smoothstep(0.55, 1.0, n)))
            .mul(aliveB);
        // world-unit mote size (~0.5..1.9u → chunky glowing grains at the egg's distance)
        const msize = sdB.z.mul(0.9).add(0.55).mul(n.mul(0.4).add(0.85)).mul(fadeB.mul(0.5).add(0.5));
        mat.vertexNode = Fn(() => {
            const center = emit.add(dirA.mul(rr)).add(upLift).add(spiral).add(driftB);
            const viewPos = cameraViewMatrix.mul(vec4(center, 1.0))
                .add(vec4(positionLocal.x.mul(msize), positionLocal.y.mul(msize), 0.0, 0.0));
            return cameraProjectionMatrix.mul(viewPos);
        })();
        const colr = vec3(1.0, 0.0, 0.0).mul(bCR[slot])
            .add(vec3(0.0, 1.0, 0.0).mul(bCG[slot]))
            .add(vec3(0.0, 0.0, 1.0).mul(bCB[slot]));
        mat.colorNode = colr.mul(float(1.0).sub(n.mul(0.35)));
        // soft round sprite mask (gaussian-ish falloff from the quad centre)
        const dq = length(uv().sub(0.5)).mul(2.0);
        mat.opacityNode = fadeB.mul(pow(clamp(float(1.0).sub(dq), 0.0, 1.0), float(1.6)));
        mat.transparent = true;
        mat.blending = THREE.AdditiveBlending;
        mat.depthWrite = false;
        mat.depthTest = true;
        mat.side = THREE.DoubleSide;
        mat.toneMapped = false;
        mat.fog = false;
        const im = new THREE.InstancedMesh(burstQuad, mat, PER_SLOT);
        const seeds = new Float32Array(PER_SLOT * 3);
        for (let i = 0; i < PER_SLOT * 3; i += 1) seeds[i] = Math.random();
        im.geometry = burstQuad.clone(); // own geometry per slot (distinct instanced attributes)
        im.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
        im.frustumCulled = false;
        scene.add(track(im));
    }

    // ════ RESONANCE ORBIT — combo heartbeat: wisps circling the relic while a chain is alive ════
    const uComboGlow = uniform(0);
    let ORBIT_COUNT;
    if (tier <= 1) ORBIT_COUNT = 40; else if (tier <= 2) ORBIT_COUNT = 64; else ORBIT_COUNT = 96;
    const orbitMat = new THREE.PointsNodeMaterial();
    {
        const oSd = attribute('aSeed', 'vec3');
        const oAng = uTime.mul(oSd.x.mul(0.5).add(0.35)).add(oSd.y.mul(6.283));
        const oRad = oSd.z.mul(7.0).add(13.0); // just outside the glass shell
        const oy = sin(uTime.mul(0.8).add(oSd.x.mul(9.0))).mul(3.5).add(oSd.y.sub(0.5).mul(7.0));
        orbitMat.positionNode = vec3(cos(oAng).mul(oRad), oy, sin(oAng).mul(oRad)).add(uRelicPos);
        const oBlink = sin(uTime.mul(2.4).add(oSd.z.mul(30.0))).mul(0.5).add(0.5).mul(0.5)
            .add(0.5);
        orbitMat.colorNode = mix(vec3(0.95, 0.33, 0.60), vec3(0.40, 0.85, 1.0), oSd.x);
        orbitMat.opacityNode = uComboGlow.mul(oBlink).mul(0.85);
        orbitMat.sizeNode = oSd.y.mul(1.6).add(1.2).mul(uComboGlow.mul(0.6).add(0.4));
        orbitMat.transparent = true;
        orbitMat.blending = THREE.AdditiveBlending;
        orbitMat.depthWrite = false;
        orbitMat.toneMapped = false;
        orbitMat.fog = false;
    }
    const orbitGeo = new THREE.BufferGeometry();
    {
        const oPos = new Float32Array(ORBIT_COUNT * 3);
        const oSeed = new Float32Array(ORBIT_COUNT * 3);
        for (let i = 0; i < ORBIT_COUNT * 3; i += 1) oSeed[i] = Math.random();
        orbitGeo.setAttribute('position', new THREE.Float32BufferAttribute(oPos, 3));
        orbitGeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(oSeed, 3));
    }
    const orbit = new THREE.Points(orbitGeo, orbitMat);
    orbit.frustumCulled = false;
    orbit.visible = false; // gated by combo glow in update()
    scene.add(track(orbit));

    // ════ HEART SHOCKWAVE POOL — the big beats STACK as independent expanding rings (never reset) ════
    // Galaxy-style: 2–6 concurrent slots by quality tier. Each slot advances from its OWN t0, so a
    // fresh perfect-clear can't rewind a tetris ring already in flight. Summed in ONE fragment → the
    // whole pool stays a single billboarded draw call (the ringNodes uniform-pool pattern reused).
    const WAVE_SLOTS = waveSlotsForTier(tier);
    const WAVE_AMP_CAP = 1.2; // safe cap so stacked rings never blow past the additive budget
    const waveNodes = Array.from(
        { length: WAVE_SLOTS },
        () => uniform(new THREE.Vector4(-1e3, 1.4, 0, 0)),
    ); // per slot: (t0, duration, amp, _)
    const waveColNodes = Array.from(
        { length: WAVE_SLOTS },
        () => uniform(new THREE.Color(1.0, 0.75, 0.45)),
    );
    const waveState = Array.from({ length: WAVE_SLOTS }, () => ({ t0: -1e3, life: 1.4, amp: 0 }));
    const waveMat = new THREE.MeshBasicNodeMaterial();
    {
        const wq = uv().sub(0.5).mul(2.0);
        const wr = length(wq);
        let waveSum = vec3(0.0);
        waveNodes.forEach((wn, i) => {
            const wProg = clamp(uTime.sub(wn.x).div(wn.y.max(0.001)), 0.0, 1.0);
            const wRing = smoothstep(0.045, 0.0, abs(wr.sub(wProg.mul(0.92))))
                .mul(float(1.0).sub(wProg)).mul(wn.z);
            waveSum = waveSum.add(waveColNodes[i].mul(wRing));
        });
        // kept WELL below bloom — each ring reads as a passing pressure-front, not a flash-bang
        // (additive + billboarded, and the reflector doubles it free)
        waveMat.colorNode = waveSum.mul(0.28);
        waveMat.transparent = true;
        waveMat.blending = THREE.AdditiveBlending;
        waveMat.depthWrite = false;
        waveMat.toneMapped = false;
        waveMat.fog = false;
    }
    const wave = new THREE.Mesh(new THREE.PlaneGeometry(130, 130), waveMat);
    wave.position.set(0, 19, -95);
    wave.renderOrder = 3;
    wave.visible = false;
    haloSprites.push(wave); // camera-billboarded with the planet halos
    scene.add(track(wave));
    // Queued like the bursts — the slot is picked + stamped with update()'s clock (see the burst-queue
    // clock note); big beats queued in one frame each take their own slot instead of overwriting.
    const waveQueue = [];
    const triggerWave = (col, amp, dur) => {
        waveQueue.push({ col, amp, dur });
        if (waveQueue.length > WAVE_SLOTS) waveQueue.shift(); // never backlog beyond the pool
    };

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

    // ════ 3D-LUT GRADE (V4 2.2) — bake the hatom film-grade to a Data3DTexture (behind ?gradeV2) ════
    // Non-linear per-region shaping the inline linear split-tone can't do: crushed-but-COLORED violet
    // blacks → magenta mids (→ #F76CFE) → amber highs (#ff8a3c) → cyan held off clip. Applied AFTER ACES.
    // A/B favoured the baked LUT (deeper colored blacks, more hatom-like) → default ON; ?gradeV1 reverts
    // to the inline linear split-tone. Minimal keeps the inline grade (skips the 3D-texture bake).
    const useLutV2 = tier >= 1 && !(params?.has?.('gradeV1'));
    const lutN = tier >= 3 ? 33 : 16;
    let lutTex = null;
    if (useLutV2) {
        const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
        const lp = (a, b, t) => a + (b - a) * t;
        const gradeSample = (r0, g0, b0) => {
            let r = Math.max(0, (r0 - 0.02) / 0.98); // deeper violet black-crush
            let g = Math.max(0, (g0 - 0.02) / 0.98);
            let b = Math.max(0, (b0 - 0.02) / 0.98);
            let luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const t = sm(0.06, 0.80, luma); // violet shadows → amber highs
            r *= lp(0.90, 1.22, t); g *= lp(0.80, 1.00, t); b *= lp(1.20, 0.80, t);
            const midW = sm(0.12, 0.38, luma) * sm(0.72, 0.40, luma) * 0.22; // magenta mid push (#F76CFE)
            r = lp(r, luma * 0.97, midW); g = lp(g, luma * 0.42, midW); b = lp(b, luma * 1.00, midW);
            const hiW = sm(0.72, 1.0, luma) * 0.12; // cyan held off clip in the highs
            r = lp(r, r * 0.86, hiW); b = lp(b, b * 1.05, hiW);
            luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            r = lp(luma, r, 1.16); g = lp(luma, g, 1.16); b = lp(luma, b, 1.16); // saturation
            r = (r - 0.5) * 1.14 + 0.5; g = (g - 0.5) * 1.14 + 0.5; b = (b - 0.5) * 1.14 + 0.5; // contrast
            return [Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b))];
        };
        const data = new Uint8Array(lutN * lutN * lutN * 4);
        let pi = 0;
        for (let bi = 0; bi < lutN; bi += 1) {
            for (let gi = 0; gi < lutN; gi += 1) {
                for (let ri = 0; ri < lutN; ri += 1) {
                    const o = gradeSample(ri / (lutN - 1), gi / (lutN - 1), bi / (lutN - 1));
                    data[pi] = Math.round(o[0] * 255); data[pi + 1] = Math.round(o[1] * 255);
                    data[pi + 2] = Math.round(o[2] * 255); data[pi + 3] = 255; pi += 4;
                }
            }
        }
        lutTex = new THREE.Data3DTexture(data, lutN, lutN, lutN);
        lutTex.format = THREE.RGBAFormat;
        lutTex.type = THREE.UnsignedByteType;
        lutTex.minFilter = THREE.LinearFilter;
        lutTex.magFilter = THREE.LinearFilter;
        lutTex.wrapS = THREE.ClampToEdgeWrapping;
        lutTex.wrapT = THREE.ClampToEdgeWrapping;
        lutTex.wrapR = THREE.ClampToEdgeWrapping;
        lutTex.needsUpdate = true;
    }

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
        if (useLutV2 && lutTex) {
            // 2.2 baked hatom film-grade (carries crush + duotone + magenta-mid + cyan-hold + sat/contrast)
            const uLutMix = uniform(0.95);
            graded = lut3D(vec4(graded, 1.0), texture3D(lutTex), lutN, uLutMix).rgb;
        } else {
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
        }
        // Vignette (focuses the eye on the hero).
        const vigD = length(uvp.sub(0.5)).mul(1.75);
        graded = graded.mul(mix(float(0.58), float(1.0), smoothstep(1.1, 0.2, vigD)));
        // 2.4 lower-centre board-wedge dead-zone: a feathered ~12% luminance knock so the egg's
        // lake reflection never competes with the playfield UI (viewportUV is y-up on both backends).
        const dzV = smoothstep(0.60, 0.0, uvp.y); // 1 at the bottom → 0 by 60% up (protects the upper-third egg)
        const dzH = smoothstep(0.32, 0.0, abs(uvp.x.sub(0.5))); // 1 at horizontal centre → 0 at the flanks
        graded = graded.mul(float(1.0).sub(dzV.mul(dzH).mul(0.12)));
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
                disposeBloomNodeDeep(bloomNode);
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
    let prevCamTime = null; // Wave 3: dt source for frame-rate-independent camera/cursor easing
    const COMBO_BOOST_CAP = 0.55; // sCombo ceiling — combo energy holds/accumulates, never rewinds
    // Per-player combo progress so one player's chain break can't reset another's milestone gating
    // (single-player collapses to the 'local' key). The emit origin stays the shared hero relic.
    const comboProgressByPlayer = new Map();

    const applyPulse = (kind, payload = {}) => {
        if (intensity <= 0) return;
        const k = intensity;
        const RX = 0; const RZ = -95; // rings emit under the relic on the water
        switch (kind) {
        case 'lineClear': {
            const lines = payload.lines || 1;
            const tetris = lines >= 4;
            sFlare = Math.min(1, sFlare + (0.14 + 0.06 * lines) * k);
            spawnRing(RX, RZ, Math.min(1.2, 0.55 + 0.16 * lines) * k);
            // "Lumen Spores" — the heart exhales golden seeds that scatter and float over the lake
            const ep = uRelicPos.value;
            if (tetris) {
                spawnBurst(ep.x, ep.y, ep.z, [1.3, 1.05, 0.7], 0.9 * k, 140, 6.0, 0, 0.28);
                triggerWave([1.0, 0.75, 0.45], 0.6 * k, 1.6);
            } else {
                spawnBurst(ep.x, ep.y, ep.z, [1.15, 0.72, 0.30], (0.30 + 0.12 * lines) * k, 52 + 18 * lines, 4.2, 0, 0.30);
            }
            break;
        }
        case 'combo': {
            const pkey = String(payload.player ?? 'local');
            const { prev, count } = resolveComboProgress(comboProgressByPlayer.get(pkey) || 0, payload.count);
            if (count <= prev) { // no new links crossed (dedup / stale repeat) — never re-spawn
                comboProgressByPlayer.set(pkey, count);
                break;
            }
            comboProgressByPlayer.set(pkey, count);
            // Combo energy ACCUMULATES to a safe cap and never rewinds mid-decay (Math.max hold).
            sCombo = accumulateComboBoost(sCombo, count, 0.06 * k, COMBO_BOOST_CAP * k);
            if (count > 1) spawnRing(RX, RZ, 0.5 * k);
            // "Resonance" — wisps orbit the heart (passive, via uComboGlow); every 3rd NEWLY-crossed
            // link sheds one magenta pulse. Milestone-gated (capped per event) so a repeated or jumped
            // combo event can't spam bursts / spike FPS.
            const ep = uRelicPos.value;
            comboMilestonesCrossed(prev, count).forEach((m) => {
                spawnBurst(ep.x, ep.y, ep.z, [0.95, 0.35, 0.65], (0.25 + 0.03 * m) * k, 40 + 5 * m, 3.5, 0.5, 0.35);
            });
            break;
        }
        case 'tspin': {
            sFlare = Math.min(1, sFlare + 0.32 * k);
            spawnRing(RX, RZ, 0.95 * k);
            // "Chrysalis Twist" — a cyan helix corkscrews out of the heart
            const ep = uRelicPos.value;
            spawnBurst(ep.x, ep.y, ep.z, [0.50, 0.92, 1.15], 0.55 * k, 85, 4.5, 1.0, 0.25);
            triggerWave([0.5, 0.9, 1.1], 0.45 * k, 1.3);
            break;
        }
        case 'b2b': if (payload.active) sFlare = Math.min(1, sFlare + 0.16 * k); break;
        case 'perfectClear': {
            sFlare = Math.min(1, sFlare + 0.5 * k);
            spawnRing(RX, RZ, 1.2 * k); spawnRing(RX, RZ, 0.85 * k);
            // "Ascension Bloom" — the heart releases everything: a violet-white sky-filling bloom
            // (far shell) inside a warm inner burst, with the biggest shockwave
            const ep = uRelicPos.value;
            spawnBurst(ep.x, ep.y, ep.z, [0.95, 0.80, 1.25], 1.0 * k, 210, 7.0, 0.25, 0.20);
            spawnBurst(ep.x, ep.y, ep.z, [1.25, 0.90, 0.50], 0.8 * k, 110, 5.0, 0, 0.45);
            triggerWave([0.9, 0.8, 1.2], 0.95 * k, 2.2);
            break;
        }
        case 'levelUp': {
            sBaseline = Math.min(0.85, sBaseline + 0.07 * k);
            // "The Waking Deepens" — a slow golden updraft as the world stirs another degree
            const ep = uRelicPos.value;
            spawnBurst(ep.x, ep.y, ep.z, [1.1, 0.85, 0.40], 0.5 * k, 95, 6.0, 0.2, 0.55);
            break;
        }
        case 'pieceLock': case 'hardDrop': {
            sFlare = Math.min(1, sFlare + 0.03 * k);
            spawnRing(RX, RZ, 0.16 * k);
            // "Heartbeat" — a faint, dim exhale of embers off the shell (fires every few seconds —
            // deliberately sparse + sub-bloom so a 30-minute session never tires the eye)
            const ep = uRelicPos.value;
            const hard = kind === 'hardDrop';
            const dens = hard ? 0.20 : 0.13;
            const reach = hard ? 21 : 15;
            spawnBurst(ep.x, ep.y, ep.z, [0.62, 0.38, 0.16], dens * k, reach, 1.9, 0, 0.5);
            break;
        }
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
            // Wave 3: frame-rate-independent cursor ease (dt via a prevCamTime closure → same feel at any fps)
            const cdt = prevCamTime === null ? 1 / 60 : Math.max(0.001, Math.min(0.1, time - prevCamTime));
            prevCamTime = time;
            const cursorEase = 1 - Math.exp(-3.0 * cdt);
            mouseX += (mouseTX - mouseX) * cursorEase;
            mouseY += (mouseTY - mouseY) * cursorEase;
            const S = sEased; // 2.4 the escalation scalar drives a narrative reframe
            const sMot = Math.max(camMotion, 0.6); // keep the slow reframe legible even in reduced-motion
            // organic breathing: layered slow sines (no single obvious period)
            const bx = (Math.sin(time * 0.13) * 1.3 + Math.sin(time * 0.07 + 1.7) * 0.8) * camMotion;
            const by = (Math.sin(time * 0.11 + 1.3) * 0.8 + Math.sin(time * 0.05) * 0.5) * camMotion;
            const bz = Math.sin(time * 0.06) * 1.6 * camMotion;
            // 2.4 very-slow lateral orbit (shears the depth planes) + counter-rotated lookAt
            const orbit = Math.sin(time * 0.045) * 3.0 * camMotion;
            // 2.4 S-driven dolly-in + crane-up + rising gaze (44→~34 z, 15.5→~20 y, 14.5→~22 lookY)
            const baseZ = 44 - S * 10 * sMot;
            const baseY = 15.5 + S * 4.5 * sMot;
            const lookY = 14.5 + S * 7.5 * sMot;
            cam.position.set(
                bx + orbit + mouseX * 7.0 * camMotion,
                baseY + by + mouseY * -3.0 * camMotion,
                baseZ + bz,
            );
            cam.lookAt(
                orbit * -0.4 + mouseX * 4.5 * camMotion + Math.sin(time * 0.04) * 2.0 * camMotion, // x pinned ≈0, counter-rotated
                lookY + mouseY * -1.6 * camMotion,
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
            // Cosmos climax: the worlds are always in the sky — only the light-wisp streaks are
            // gated; billboard the atmo halos.
            const ce = uCosmos.value;
            streakGroup.visible = ce > 0.001;
            // FX: stamp queued bursts/waves with THIS clock (the one uTime carries — see spawn note);
            // combo orbit follows the live combo boost; shockwave + orbit are visibility-gated.
            while (burstQueue.length) {
                const b = burstQueue.shift();
                const bi = pickExpiringSlotIndex(burstState, time); // stack: never clobber a livelier burst
                burstState[bi].t0 = time; burstState[bi].life = b.life;
                bPX[bi].value = b.px; bPY[bi].value = b.py; bPZ[bi].value = b.pz; bT0[bi].value = time;
                bCR[bi].value = b.col[0]; bCG[bi].value = b.col[1]; bCB[bi].value = b.col[2];
                bDen[bi].value = Math.min(1, b.density);
                bRad[bi].value = b.maxR; bLif[bi].value = b.life; bSwl[bi].value = b.swirl; bUp[bi].value = b.upBias;
            }
            while (waveQueue.length) {
                const w = waveQueue.shift();
                // pick the slot nearest death (bias toward weak) so a fresh beat stacks alongside
                // live rings instead of clobbering the strongest one.
                const wi = pickExpiringSlotIndex(waveState, time, 0.35);
                const st = waveState[wi];
                st.t0 = time; st.life = w.dur; st.amp = Math.min(WAVE_AMP_CAP, w.amp);
                waveNodes[wi].value.set(time, st.life, st.amp, 0);
                waveColNodes[wi].value.setRGB(w.col[0], w.col[1], w.col[2]);
            }
            uComboGlow.value = Math.min(1, sCombo * 2.4);
            uCombo.value = uComboGlow.value; // shore crystals resonate with the combo chain
            orbit.visible = uComboGlow.value > 0.02;
            let anyWaveAlive = false;
            for (let i = 0; i < WAVE_SLOTS; i += 1) {
                if ((time - waveState[i].t0) < waveState[i].life) { anyWaveAlive = true; break; }
            }
            wave.visible = anyWaveAlive;
            if (camera) {
                for (let i = 0; i < haloSprites.length; i += 1) {
                    haloSprites[i].quaternion.copy(camera.quaternion);
                }
            }
            uTime.value = time;
            relic.rotation.y = time * 0.08;
            relic.position.y = 19 + Math.sin(time * 0.5) * 1.2; // slow idle bob (floats on the horizon)
            uRelicPos.value.copy(relic.position); // 1.1 egg-as-practical-light follows the bob
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
            comboProgressByPlayer.clear();
            post?.dispose();
            if (reflection) { scene.remove(reflection.target); reflection.dispose?.(); }
            if (heroHemi) { scene.remove(heroHemi); heroHemi.dispose?.(); }
            if (heroKey) { scene.remove(heroKey); scene.remove(heroKey.target); heroKey.dispose?.(); } // 2.6
            disposables.forEach((o) => {
                scene.remove(o);
                o.traverse?.((c) => { c.geometry?.dispose?.(); c.material?.dispose?.(); });
                o.geometry?.dispose?.();
                o.material?.dispose?.();
            });
            skyMat.dispose(); peakMat.dispose(); fieldMat.dispose(); if (heroMat) heroMat.dispose();
            disposeTextures.forEach((t) => t.dispose?.());
            if (envTexture) { if (scene.environment === envTexture) scene.environment = null; envTexture.dispose?.(); }
            lutTex?.dispose?.(); // 2.2
        },
    };
}
