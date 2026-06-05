/**
 * @fileoverview Urban Dreams Environment - Chapter 8 Visual Theme (the encore)
 *
 * The electric coda: a neon megastructure rising over a procedurally-lit night
 * city, wet reflections, holographic signage, sky traffic and rain. Part of the
 * Odyssey AAA "Cosmic Ascent" overhaul (Phase 4 — chapter level-up); see
 * docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md §5/§6. This is the highest-contrast world.
 *
 * Layers (plan §3.2):
 *   0  Neon sky          — gradient + horizon light-pollution + drifting smog (FBM)
 *   1  Hero anchor       — neon megastructure spire with an energy-conduit core
 *   2  Mid environment   — city blocks with procedural lit-window facade shaders
 *   3  Atmosphere        — ground neon haze + light pools
 *   5/6 Near life        — holographic signs, wet reflections, rain streaks, traffic
 *
 * All glow is GLSL-procedural so create() never needs a `document`/canvas.
 */

import * as THREE from 'three';
import { getChapterPathRange } from '../path-utils.js';
import { ODYSSEY_NOISE_GLSL, ODYSSEY_HASH_GLSL } from './shared/odyssey-noise.js';

export const URBAN_DREAMS_CONFIG = {
    id: 8,
    name: 'urban-dreams',
    // Spline-derived chapter y-range (matches getChapterPathRange(8)); kept here so
    // ChapterEnvironmentManager.getChapterAtPosition() and the userData fallback work
    // even if the path layout lookup is unavailable.
    yStart: 875.9,
    yEnd: 960.0,
    colors: {
        primary: 0x0c0818,
        secondary: 0x201135,
        tertiary: 0x00f2ff,
        accent: 0xff3fb4,
        background: 0x060712,
    },
};

const CYAN = 0x00f2ff;
const MAGENTA = 0xff3fb4;

// ═══════════════════════════════════════════════════════════════════════════════
// GLSL Shaders
// ═══════════════════════════════════════════════════════════════════════════════

const skyVertexShader = /* glsl */ `
    varying vec3 vDir;
    void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const skyFragmentShader = /* glsl */ `
    uniform float uTime;
    uniform float uOpacity;
    uniform float uEnergy;
    varying vec3 vDir;

    ${ODYSSEY_NOISE_GLSL}

    void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y * 0.5 + 0.5;

        // Night sky: deep indigo up top, warmer light-pollution glow near horizon.
        vec3 top = vec3(0.02, 0.02, 0.07);
        vec3 horizon = vec3(0.10, 0.04, 0.13);
        vec3 base = mix(horizon, top, smoothstep(0.35, 0.85, h));

        // City light-pollution dome hugging the lower sky.
        float pollution = pow(1.0 - h, 2.2);
        base += mix(vec3(0.10, 0.02, 0.06), vec3(0.0, 0.10, 0.13), 0.5 + 0.5 * sin(dir.x * 2.0))
            * pollution * (0.6 + uEnergy * 0.5);

        // Drifting smog layer.
        vec2 uv = vec2(atan(dir.z, dir.x) * 1.6, dir.y * 2.2) + vec2(uTime * 0.02, 0.0);
        float smog = fbm2(uv) * smoothstep(0.7, 0.1, h);
        base += vec3(0.05, 0.04, 0.08) * smog;

        gl_FragColor = vec4(base, uOpacity);
    }
`;

// Procedural lit-window facade — the core "city, not cardboard" upgrade.
const facadeVertexShader = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
    }
`;

const facadeFragmentShader = /* glsl */ `
    uniform float uTime;
    uniform float uEnergy;
    uniform float uSeed;
    uniform vec2 uGrid;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;

    ${ODYSSEY_HASH_GLSL}

    void main() {
        vec2 g = vUv * uGrid;
        vec2 cell = floor(g);
        vec2 f = fract(g);

        // Window pane within mullions.
        float pane = step(0.14, f.x) * step(f.x, 0.86) * step(0.12, f.y) * step(f.y, 0.9);

        float r = od_hash21(cell + uSeed);
        float on = step(0.42, r); // some windows dark
        float flick = 0.72 + 0.28 * sin(uTime * (0.6 + r * 3.0) + r * 40.0);

        // Window colour: cyan/magenta with occasional warm interior.
        vec3 wcolor = mix(uColorA, uColorB, step(0.5, fract(r * 7.31)));
        wcolor = mix(wcolor, vec3(1.0, 0.82, 0.5), step(0.86, r));

        vec3 base = vec3(0.018, 0.022, 0.045);
        float fres = pow(1.0 - max(0.0, dot(normalize(vNormal), normalize(vView))), 3.0);

        vec3 color = base;
        color += wcolor * pane * on * (0.55 + flick * 0.6) * (1.0 + uEnergy * 0.5);
        color += mix(uColorA, uColorB, 0.5) * fres * 0.18; // edge sheen
        gl_FragColor = vec4(color, 1.0);
    }
`;

// Energy-conduit core for the spire.
const conduitVertexShader = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
    }
`;

const conduitFragmentShader = /* glsl */ `
    uniform float uTime;
    uniform float uEnergy;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
        // Vertical energy pulses travelling up the structure.
        float pulse = sin(vUv.y * 26.0 - uTime * 3.0) * 0.5 + 0.5;
        pulse = pow(pulse, 3.0);
        float seams = step(0.92, fract(vUv.x * 8.0));
        float fres = pow(1.0 - max(0.0, dot(normalize(vNormal), normalize(vView))), 2.0);
        vec3 color = mix(uColorA, uColorB, vUv.y);
        float glow = (pulse * 0.7 + seams * 0.5 + fres * 0.8) * (0.7 + uEnergy * 0.8);
        gl_FragColor = vec4(color * glow, clamp(glow, 0.0, 1.0));
    }
`;

// Holographic sign (scanlines + scroll + flicker).
const signVertexShader = /* glsl */ `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const signFragmentShader = /* glsl */ `
    uniform float uTime;
    uniform float uEnergy;
    uniform vec3 uColor;
    varying vec2 vUv;

    ${ODYSSEY_HASH_GLSL}

    void main() {
        float scan = 0.5 + 0.5 * sin((vUv.y + uTime * 0.12) * 60.0);
        float scroll = step(0.5, fract(vUv.x * 6.0 - uTime * 0.35));
        float glyphs = od_hash21(floor(vUv * vec2(18.0, 5.0)) + floor(uTime * 1.2));
        float body = (0.35 + scan * 0.4) * (0.5 + scroll * 0.5) * (0.6 + glyphs * 0.6);
        float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x)
            * smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.88, vUv.y);
        float a = body * edge * (0.45 + uEnergy * 0.4);
        gl_FragColor = vec4(uColor * (0.8 + body), a);
    }
`;

// Wet reflection plane (puddle ripples reflecting neon).
const reflectionVertexShader = /* glsl */ `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const reflectionFragmentShader = /* glsl */ `
    uniform float uTime;
    uniform float uEnergy;
    varying vec2 vUv;

    ${ODYSSEY_NOISE_GLSL}

    void main() {
        // Vertical neon smears, broken up by puddle ripple distortion.
        vec2 p = vUv;
        float ripple = fbm2(p * vec2(6.0, 2.0) + vec2(0.0, uTime * 0.4));
        float lanes = pow(abs(sin((p.x + ripple * 0.05) * 40.0)), 16.0);
        float shimmer = 0.5 + 0.5 * sin(p.y * 26.0 + uTime * 1.6 + ripple * 6.0);

        vec3 cyan = vec3(0.0, 0.85, 1.0);
        vec3 magenta = vec3(1.0, 0.18, 0.68);
        vec3 color = mix(cyan, magenta, p.x + ripple * 0.1) * (lanes * 0.5 + shimmer * 0.08);
        float fade = smoothstep(1.0, 0.05, p.y); // brightest near the buildings
        gl_FragColor = vec4(color * (1.0 + uEnergy * 0.5), fade * 0.3);
    }
`;

// Ground neon haze (light pool).
const hazeVertexShader = /* glsl */ `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const hazeFragmentShader = /* glsl */ `
    uniform float uTime;
    uniform float uEnergy;
    varying vec2 vUv;

    ${ODYSSEY_NOISE_GLSL}

    void main() {
        vec2 c = vUv - 0.5;
        float fog = fbm2(vUv * 5.0 + vec2(uTime * 0.05, 0.0));
        float radial = smoothstep(0.55, 0.0, length(c));
        vec3 color = mix(vec3(0.0, 0.5, 0.65), vec3(0.6, 0.1, 0.45), vUv.x);
        float a = radial * (0.18 + fog * 0.18) * (0.7 + uEnergy * 0.5);
        gl_FragColor = vec4(color, a);
    }
`;

// Rain streak points.
const rainVertexShader = /* glsl */ `
    uniform float uTime;
    attribute float aSize;
    varying float vAlpha;
    void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * (340.0 / -mv.z);
        gl_PointSize = clamp(gl_PointSize, 1.0, 9.0);
        vAlpha = 0.5;
    }
`;

const rainFragmentShader = /* glsl */ `
    varying float vAlpha;
    void main() {
        vec2 c = gl_PointCoord - 0.5;
        // Narrow in x, tall in y -> a falling streak inside each point sprite.
        float streak = smoothstep(0.5, 0.0, abs(c.x) * 7.0) * smoothstep(0.5, 0.0, abs(c.y));
        gl_FragColor = vec4(vec3(0.72, 0.95, 1.0), streak * vAlpha);
    }
`;

// ═══════════════════════════════════════════════════════════════════════════════
// Environment Creation
// ═══════════════════════════════════════════════════════════════════════════════

function createSkyGradient(uniforms) {
    return new THREE.Mesh(
        new THREE.SphereGeometry(440, 40, 28),
        new THREE.ShaderMaterial({
            uniforms: {
                uTime: uniforms.uTime,
                uEnergy: uniforms.uEnergy,
                uOpacity: { value: 1 },
            },
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
            vertexShader: skyVertexShader,
            fragmentShader: skyFragmentShader,
        }),
    );
}

function createCityBlocks(uniforms) {
    const group = new THREE.Group();
    group.name = 'city-blocks';

    for (let index = 0; index < 22; index += 1) {
        const width = 12 + (Math.random() * 10);
        const height = 20 + (Math.random() * 56);
        const depth = 10 + (Math.random() * 14);
        const rows = Math.max(6, Math.round(height / 4));
        const cols = Math.max(3, Math.round(width / 4));

        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(width, height, depth),
            new THREE.ShaderMaterial({
                uniforms: {
                    uTime: uniforms.uTime,
                    uEnergy: uniforms.uEnergy,
                    uSeed: { value: Math.random() * 100 },
                    uGrid: { value: new THREE.Vector2(cols, rows) },
                    uColorA: { value: new THREE.Color(CYAN) },
                    uColorB: { value: new THREE.Color(MAGENTA) },
                },
                vertexShader: facadeVertexShader,
                fragmentShader: facadeFragmentShader,
            }),
        );
        mesh.position.set(
            -130 + (index * 12.5) + (Math.random() - 0.5) * 6,
            height * 0.5 - 20,
            -640 - (Math.random() * 150),
        );
        group.add(mesh);
    }

    return group;
}

function createNeonRails() {
    const group = new THREE.Group();
    group.name = 'neon-rails';

    for (let index = 0; index < 6; index += 1) {
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(26 + index * 10, 0.4, 8, 96),
            new THREE.MeshBasicMaterial({
                color: index % 2 === 0 ? CYAN : MAGENTA,
                transparent: true,
                opacity: 0.4,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        ring.rotation.x = Math.PI * 0.5;
        ring.position.set(0, -12 + index * 10, -620 - index * 14);
        group.add(ring);
    }

    return group;
}

function createRainCurtain(uniforms) {
    const count = 480;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        positions[stride] = (Math.random() - 0.5) * 300;
        positions[stride + 1] = Math.random() * 180 - 40;
        positions[stride + 2] = -540 - Math.random() * 170;
        sizes[index] = 2.5 + Math.random() * 3.5;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const points = new THREE.Points(
        geometry,
        new THREE.ShaderMaterial({
            uniforms: { uTime: uniforms.uTime },
            vertexShader: rainVertexShader,
            fragmentShader: rainFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }),
    );
    points.name = 'rain-streak-curtain';
    return points;
}

function createNeonCitySpire(uniforms) {
    const group = new THREE.Group();
    group.name = 'neon-megastructure-spire';
    group.position.set(0, 14, -680);

    const tiers = [
        { height: 110, width: 18, y: 10 },
        { height: 72, width: 30, y: -24 },
        { height: 44, width: 46, y: -52 },
    ];

    tiers.forEach(({ height, width, y }, index) => {
        // Energy-conduit core.
        const core = new THREE.Mesh(
            new THREE.BoxGeometry(width, height, width * 0.55),
            new THREE.ShaderMaterial({
                uniforms: {
                    uTime: uniforms.uTime,
                    uEnergy: uniforms.uEnergy,
                    uColorA: { value: new THREE.Color(index % 2 === 0 ? CYAN : MAGENTA) },
                    uColorB: { value: new THREE.Color(index % 2 === 0 ? MAGENTA : CYAN) },
                },
                vertexShader: conduitVertexShader,
                fragmentShader: conduitFragmentShader,
                transparent: true,
                depthWrite: true,
                blending: THREE.AdditiveBlending,
            }),
        );
        core.position.y = y;
        group.add(core);

        const frame = new THREE.Mesh(
            new THREE.TorusGeometry(width * 0.72, 0.8, 8, 72),
            new THREE.MeshBasicMaterial({
                color: index % 2 === 0 ? CYAN : MAGENTA,
                transparent: true,
                opacity: 0.42,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        frame.rotation.x = Math.PI * 0.5;
        frame.position.y = y + height * 0.42;
        group.add(frame);
    });

    const crown = new THREE.Mesh(
        new THREE.ConeGeometry(20, 46, 6),
        new THREE.MeshBasicMaterial({
            color: MAGENTA,
            transparent: true,
            opacity: 0.55,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }),
    );
    crown.position.y = 82;
    group.add(crown);

    // Beacon light atop the spire.
    const beacon = new THREE.PointLight(0xff66c4, 0.8, 320);
    beacon.position.set(0, 92, 0);
    group.add(beacon);
    group.userData.beacon = beacon;

    return group;
}

function createHologramSigns(uniforms) {
    const group = new THREE.Group();
    group.name = 'hologram-sign-stack';
    const configs = [
        {
            x: -92, y: 42, z: -615, w: 42, h: 14, color: CYAN,
        },
        {
            x: 88, y: 22, z: -640, w: 50, h: 16, color: MAGENTA,
        },
        {
            x: -52, y: -6, z: -585, w: 36, h: 12, color: 0xa66cff,
        },
        {
            x: 42, y: 62, z: -700, w: 58, h: 15, color: 0x00ffae,
        },
    ];

    configs.forEach((config, index) => {
        const sign = new THREE.Mesh(
            new THREE.PlaneGeometry(config.w, config.h),
            new THREE.ShaderMaterial({
                uniforms: {
                    uTime: uniforms.uTime,
                    uEnergy: uniforms.uEnergy,
                    uColor: { value: new THREE.Color(config.color) },
                },
                vertexShader: signVertexShader,
                fragmentShader: signFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
            }),
        );
        sign.position.set(config.x, config.y, config.z);
        sign.rotation.y = (index % 2 === 0 ? 1 : -1) * 0.18;
        group.add(sign);
    });

    return group;
}

function createWetReflectionPlane(uniforms) {
    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(380, 200, 1, 1),
        new THREE.ShaderMaterial({
            uniforms: {
                uTime: uniforms.uTime,
                uEnergy: uniforms.uEnergy,
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            vertexShader: reflectionVertexShader,
            fragmentShader: reflectionFragmentShader,
        }),
    );
    plane.name = 'wet-neon-reflection-plane';
    plane.position.set(0, -58, -620);
    plane.rotation.x = -Math.PI * 0.48;
    return plane;
}

function createGroundHaze(uniforms) {
    const group = new THREE.Group();
    group.name = 'ground-neon-haze';

    for (let index = 0; index < 3; index += 1) {
        const haze = new THREE.Mesh(
            new THREE.PlaneGeometry(260, 160),
            new THREE.ShaderMaterial({
                uniforms: {
                    uTime: uniforms.uTime,
                    uEnergy: uniforms.uEnergy,
                },
                vertexShader: hazeVertexShader,
                fragmentShader: hazeFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
            }),
        );
        haze.position.set((index - 1) * 80, -46 + index * 4, -600 - index * 30);
        haze.rotation.x = -Math.PI * 0.46;
        group.add(haze);
    }

    return group;
}

function createSkyTraffic() {
    const group = new THREE.Group();
    group.name = 'sky-traffic-light-trails';
    const colors = [CYAN, MAGENTA, 0xffd36f];

    for (let index = 0; index < 12; index += 1) {
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(-170, 65 - index * 7, -700 - index * 8),
            new THREE.Vector3(-30, 82 - index * 5, -650 - index * 5),
            new THREE.Vector3(170, 48 - index * 6, -710 - index * 9),
        ]);
        const trail = new THREE.Mesh(
            new THREE.TubeGeometry(curve, 32, 0.35, 6, false),
            new THREE.MeshBasicMaterial({
                color: colors[index % colors.length],
                transparent: true,
                opacity: 0.2,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        trail.userData.speed = 0.12 + index * 0.016;
        group.add(trail);
    }

    return group;
}

export function createUrbanDreamsEnvironment() {
    const group = new THREE.Group();
    group.name = 'urban-dreams-environment';
    group.userData.chapterId = 8;

    const uniforms = {
        uTime: { value: 0 },
        uEnergy: { value: 0.45 },
    };
    group.userData.uniforms = uniforms;

    const chapterRange = getChapterPathRange(8);
    const chapterCenterY = chapterRange?.center.y
        ?? (URBAN_DREAMS_CONFIG.yStart + URBAN_DREAMS_CONFIG.yEnd) / 2;

    // Always set the chapter bounds so downstream consumers (getChapterAtPosition,
    // opacity blending) never see undefined, even if the path lookup fails.
    group.userData.yStart = chapterRange?.start.y ?? URBAN_DREAMS_CONFIG.yStart;
    group.userData.yEnd = chapterRange?.end.y ?? URBAN_DREAMS_CONFIG.yEnd;

    const sky = createSkyGradient(uniforms);
    sky.renderOrder = -100;
    group.add(sky);

    group.add(createCityBlocks(uniforms));

    const rails = createNeonRails();
    group.add(rails);
    group.userData.rails = rails;

    const haze = createGroundHaze(uniforms);
    group.add(haze);

    const rain = createRainCurtain(uniforms);
    group.add(rain);
    group.userData.rain = rain;

    const spire = createNeonCitySpire(uniforms);
    group.add(spire);
    group.userData.spire = spire;

    const signs = createHologramSigns(uniforms);
    group.add(signs);
    group.userData.signs = signs;

    const reflectionPlane = createWetReflectionPlane(uniforms);
    group.add(reflectionPlane);
    group.userData.reflectionPlane = reflectionPlane;

    const traffic = createSkyTraffic();
    group.add(traffic);
    group.userData.traffic = traffic;

    // Subtle ambient so the additive neon reads against true black.
    group.add(new THREE.AmbientLight(0x141025, 0.4));

    group.position.y = chapterCenterY;
    return group;
}

export function updateUrbanDreamsEnvironment(group, delta, time, camera, ...updateArgs) {
    const [, directorState = null] = updateArgs;
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }
    // The encore grooves hardest — autonomous breath until Phase 6 drives audio.
    if (uniforms?.uEnergy) {
        const audioEnergy = directorState
            ? THREE.MathUtils.clamp(
                (directorState.energy || 0) * 0.58
                    + (directorState.mid || 0) * 0.22
                    + (directorState.treble || 0) * 0.2,
                0,
                1,
            )
            : null;
        uniforms.uEnergy.value = audioEnergy === null
            ? 0.45 + Math.sin(time * 0.8) * 0.28
            : 0.34 + audioEnergy * 0.72 + (directorState.beatPulse || 0) * 0.12;
    }
    const energy = uniforms?.uEnergy?.value ?? 0.45;

    const { rails } = group.userData;
    if (rails?.children) {
        rails.children.forEach((ring, index) => {
            ring.rotation.z += delta * (0.18 + index * 0.05);
        });
    }

    const { rain } = group.userData;
    if (rain?.geometry?.attributes?.position) {
        const { array } = rain.geometry.attributes.position;
        const cameraY = camera?.position?.y ?? group.position.y;
        for (let index = 0; index < array.length; index += 3) {
            array[index + 1] -= 1.6 + (index % 5) * 0.08;
            if (array[index + 1] < -60) {
                array[index + 1] = 140 + ((cameraY - group.position.y) * 0.02);
            }
        }
        rain.geometry.attributes.position.needsUpdate = true;
    }

    const { spire } = group.userData;
    if (spire) {
        spire.rotation.y = Math.sin(time * 0.18) * 0.06;
        if (spire.userData.beacon) {
            spire.userData.beacon.intensity = 0.7 + Math.sin(time * 3.0) * 0.3 + energy * 0.4;
        }
    }

    const { traffic } = group.userData;
    if (traffic?.children) {
        traffic.children.forEach((trail, index) => {
            trail.position.x = Math.sin(time * trail.userData.speed + index) * 20;
        });
    }
}

export default {
    config: URBAN_DREAMS_CONFIG,
    create: createUrbanDreamsEnvironment,
    update: updateUrbanDreamsEnvironment,
};
