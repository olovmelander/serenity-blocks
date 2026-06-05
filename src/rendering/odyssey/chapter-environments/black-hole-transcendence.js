/**
 * @fileoverview Black Hole Transcendence Environment - Chapter 7 Visual Theme
 *
 * The journey's gravitational climax: a dominant event horizon ringed by a
 * shader-driven accretion disk and a gravitational-lensing shell, set against a
 * violent magenta/cyan nebula. Part of the Odyssey AAA "Cosmic Ascent" overhaul
 * (Phase 4 — chapter level-up); see docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md §5/§6.
 *
 * Layers (plan §3.2):
 *   0  Void nebula dome      — FBM filaments, deep magenta/indigo
 *   1  Hero anchor           — dominant event horizon: shader accretion disk
 *                              (swirling plasma + Doppler), photon ring, and a
 *                              fresnel lensing shell with an Einstein-ring band
 *   2  Mid environment       — coplanar accretion glow rings, lensed starfield
 *   6  Near life             — transcendence shards + matter infall streams
 *
 * All glow is GLSL-procedural so create() never needs a `document`/canvas.
 */

import * as THREE from 'three';
import { getChapterPathRange } from '../path-utils.js';
import { ODYSSEY_NOISE_GLSL } from './shared/odyssey-noise.js';

export const BLACK_HOLE_TRANSCENDENCE_CONFIG = {
    id: 7,
    name: 'black-hole-transcendence',
    // Spline-derived chapter y-range (matches getChapterPathRange(7)); kept here so
    // ChapterEnvironmentManager.getChapterAtPosition() and the userData fallback work
    // even if the path layout lookup is unavailable.
    yStart: 695.6,
    yEnd: 875.9,
    colors: {
        primary: 0x040208,
        secondary: 0x1b0f2d,
        tertiary: 0xff33cc,
        accent: 0x66e3ff,
        background: 0x000000,
    },
};

// ═══════════════════════════════════════════════════════════════════════════════
// GLSL Shaders
// ═══════════════════════════════════════════════════════════════════════════════

const domeVertexShader = /* glsl */ `
    varying vec3 vDir;
    void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const domeFragmentShader = /* glsl */ `
    uniform float uTime;
    uniform float uOpacity;
    uniform float uEnergy;
    varying vec3 vDir;

    ${ODYSSEY_NOISE_GLSL}

    void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y * 0.5 + 0.5;
        vec3 base = mix(vec3(0.0, 0.0, 0.0), vec3(0.05, 0.015, 0.09), h);

        vec3 q = dir * 3.4 + vec3(0.0, 0.0, uTime * 0.03);
        float dust = fbm3(q);
        float filaments = ridged3(q * 0.8 + 7.0);

        vec3 nebula = vec3(0.18, 0.03, 0.16) * filaments;
        nebula += vec3(0.06, 0.10, 0.20) * dust;
        vec3 color = base + nebula * (0.45 + uEnergy * 0.5);
        gl_FragColor = vec4(color, uOpacity);
    }
`;

const accretionVertexShader = /* glsl */ `
    varying float vRadius;
    varying float vAngle;
    varying vec2 vLocal;
    void main() {
        vLocal = position.xy;
        vRadius = length(position.xy);
        vAngle = atan(position.y, position.x);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const accretionFragmentShader = /* glsl */ `
    uniform float uTime;
    uniform float uEnergy;
    uniform float uInner;
    uniform float uOuter;
    uniform vec3 uHot;
    uniform vec3 uMid;
    uniform vec3 uCool;
    varying float vRadius;
    varying float vAngle;
    varying vec2 vLocal;

    ${ODYSSEY_NOISE_GLSL}

    void main() {
        float t = clamp((vRadius - uInner) / (uOuter - uInner), 0.0, 1.0);
        float swirl = vAngle + uTime * (0.7 + (1.0 - t) * 2.0);
        vec3 sp = vec3(cos(swirl), sin(swirl), 0.0) * (0.7 + t * 3.4);
        float turb = fbm3(sp * 1.8 + vec3(0.0, 0.0, uTime * 0.16));
        float streaks = 0.5 + 0.5 * sin(swirl * 4.0 + t * 18.0 - uTime * 1.4);
        float plasma = mix(turb, streaks, 0.45);

        float radial = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.45, 1.0, t));
        float doppler = 0.5 + 0.85 * smoothstep(-uOuter, uOuter, vLocal.x);

        float intensity = radial * (0.35 + plasma) * doppler;
        intensity *= 1.0 + uEnergy * 0.7;

        vec3 color = mix(uHot, uMid, smoothstep(0.0, 0.38, t));
        color = mix(color, uCool, smoothstep(0.38, 1.0, t));
        color += vec3(0.25, 0.10, 0.30) * doppler * radial;

        gl_FragColor = vec4(color * intensity, intensity);
    }
`;

// Gravitational-lensing shell: an Einstein-ring band that rings the horizon.
const lensVertexShader = /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
    }
`;

const lensFragmentShader = /* glsl */ `
    uniform float uTime;
    uniform float uEnergy;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
        float fres = pow(1.0 - max(0.0, dot(vNormal, vView)), 2.0);
        // Band brightest at mid-grazing angle -> reads as a lensed Einstein ring.
        float band = smoothstep(0.2, 0.5, fres) * (1.0 - smoothstep(0.72, 1.0, fres));
        float shimmer = 0.8 + 0.2 * sin(uTime * 1.6 + fres * 18.0);
        vec3 color = mix(uColorA, uColorB, fres) * band * shimmer;
        float alpha = band * (0.55 + uEnergy * 0.4);
        gl_FragColor = vec4(color, alpha);
    }
`;

// Twinkling point shader (shards + lensed stars).
const twinkleVertexShader = /* glsl */ `
    uniform float uTime;
    attribute float aSize;
    attribute float aTwinkle;
    attribute vec3 aColor;
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 0.5 + 0.5 * sin(uTime * 2.2 + aTwinkle);
        gl_PointSize = aSize * tw * (260.0 / -mv.z);
        gl_PointSize = clamp(gl_PointSize, 0.6, 6.0);
        vAlpha = tw;
        vColor = aColor;
    }
`;

const twinkleFragmentShader = /* glsl */ `
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float glow = pow(1.0 - d * 2.0, 1.6);
        gl_FragColor = vec4(vColor, glow * vAlpha);
    }
`;

// ═══════════════════════════════════════════════════════════════════════════════
// Environment Creation
// ═══════════════════════════════════════════════════════════════════════════════

function createVoidDome(uniforms) {
    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(520, 48, 32),
        new THREE.ShaderMaterial({
            uniforms: {
                uTime: uniforms.uTime,
                uEnergy: uniforms.uEnergy,
                uOpacity: { value: 1 },
            },
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
            vertexShader: domeVertexShader,
            fragmentShader: domeFragmentShader,
        }),
    );
    mesh.renderOrder = -100;
    return mesh;
}

function createEventHorizon(uniforms) {
    const group = new THREE.Group();
    group.name = 'dominant-event-horizon-anchor';
    group.position.set(0, 0, -780);
    group.rotation.x = -1.05;

    // Dominant dark horizon.
    const horizon = new THREE.Mesh(
        new THREE.SphereGeometry(38, 64, 48),
        new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    horizon.scale.set(1, 1, 0.9);
    group.add(horizon);

    // Shader accretion disk — the visual core.
    const disk = new THREE.Mesh(
        new THREE.RingGeometry(42, 132, 280, 6),
        new THREE.ShaderMaterial({
            uniforms: {
                uTime: uniforms.uTime,
                uEnergy: uniforms.uEnergy,
                uInner: { value: 42 },
                uOuter: { value: 132 },
                uHot: { value: new THREE.Color(0xfff1c4) },
                uMid: { value: new THREE.Color(0xff48b0) },
                uCool: { value: new THREE.Color(0x4fb6ff) },
            },
            vertexShader: accretionVertexShader,
            fragmentShader: accretionFragmentShader,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        }),
    );
    disk.name = 'accretion-disk';
    group.add(disk);
    group.userData.disk = disk;

    // Photon ring hugging the horizon.
    const photonRing = new THREE.Mesh(
        new THREE.RingGeometry(39, 43, 192, 1),
        new THREE.MeshBasicMaterial({
            color: 0xffe9b0,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        }),
    );
    group.add(photonRing);

    // Gravitational-lensing shell (Einstein-ring band). The band is a view-space
    // fresnel effect on a sphere, so it is rotation-invariant — the parent disk
    // tilt does not skew it; it always rings the horizon facing the camera.
    const lensShell = new THREE.Mesh(
        new THREE.SphereGeometry(50, 48, 32),
        new THREE.ShaderMaterial({
            uniforms: {
                uTime: uniforms.uTime,
                uEnergy: uniforms.uEnergy,
                uColorA: { value: new THREE.Color(0x66e3ff) },
                uColorB: { value: new THREE.Color(0xff66d8) },
            },
            vertexShader: lensVertexShader,
            fragmentShader: lensFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.FrontSide,
        }),
    );
    lensShell.name = 'lensing-shell';
    group.add(lensShell);

    return group;
}

function createAccretionGlowRings() {
    const group = new THREE.Group();
    group.name = 'accretion-glow-rings';
    group.position.set(0, 0, -780);
    group.rotation.x = -1.05;
    const ringColors = [0xff33cc, 0x66e3ff, 0xffb347];

    ringColors.forEach((color, index) => {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(140 + index * 22, 168 + index * 30, 128, 1),
            new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0.1 - index * 0.025,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        group.add(ring);
    });

    return group;
}

function createTranscendenceShards(uniforms) {
    const count = 220;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const twinkles = new Float32Array(count);

    const palette = [
        new THREE.Color(0xff66d8),
        new THREE.Color(0x66e3ff),
        new THREE.Color(0xffd28a),
    ];

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        const angle = Math.random() * Math.PI * 2;
        const radius = 30 + (Math.random() * 110);
        positions[stride] = Math.cos(angle) * radius;
        positions[stride + 1] = (Math.random() - 0.5) * 130;
        positions[stride + 2] = -760 - (Math.random() * 130);

        const color = palette[index % palette.length];
        colors[stride] = color.r;
        colors[stride + 1] = color.g;
        colors[stride + 2] = color.b;
        sizes[index] = 1.6 + Math.random() * 2.4;
        twinkles[index] = Math.random() * Math.PI * 2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 1));

    const points = new THREE.Points(
        geometry,
        new THREE.ShaderMaterial({
            uniforms: { uTime: uniforms.uTime },
            vertexShader: twinkleVertexShader,
            fragmentShader: twinkleFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }),
    );
    points.name = 'transcendence-shards';
    return points;
}

function createLensingStarfield(uniforms) {
    const count = 1100;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const twinkles = new Float32Array(count);

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        const angle = Math.random() * Math.PI * 2;
        const radius = 58 + Math.random() * 190;
        // Tangential stretch near the horizon -> stars smear into lensed arcs.
        const bend = 1 + Math.sin(angle * 3.0) * 0.22;
        positions[stride] = Math.cos(angle) * radius * bend;
        positions[stride + 1] = Math.sin(angle) * radius * 0.42;
        positions[stride + 2] = -790 - Math.random() * 200;

        const hot = index % 4 === 0;
        colors[stride] = hot ? 1.0 : 0.6;
        colors[stride + 1] = hot ? 0.66 : 0.8;
        colors[stride + 2] = 1.0;
        sizes[index] = 1.2 + Math.random() * 1.8;
        twinkles[index] = Math.random() * Math.PI * 2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 1));

    const points = new THREE.Points(
        geometry,
        new THREE.ShaderMaterial({
            uniforms: { uTime: uniforms.uTime },
            vertexShader: twinkleVertexShader,
            fragmentShader: twinkleFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }),
    );
    points.name = 'lensing-starfield';
    return points;
}

function createInfallStreams() {
    const group = new THREE.Group();
    group.name = 'infall-streams';
    const colors = [0xff33cc, 0x66e3ff, 0xffb347];

    for (let index = 0; index < 9; index += 1) {
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(-160 + index * 40, 85 - index * 11, -650 - index * 12),
            new THREE.Vector3(-72 + index * 18, 30 - index * 5, -720),
            new THREE.Vector3(-18 + index * 4, 5 - index * 2, -775),
        ]);
        const mesh = new THREE.Mesh(
            new THREE.TubeGeometry(curve, 48, 0.7, 8, false),
            new THREE.MeshBasicMaterial({
                color: colors[index % colors.length],
                transparent: true,
                opacity: 0.26,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        mesh.userData.spin = (index % 2 === 0 ? 1 : -1) * (0.015 + index * 0.002);
        group.add(mesh);
    }

    return group;
}

export function createBlackHoleTranscendenceEnvironment() {
    const group = new THREE.Group();
    group.name = 'black-hole-transcendence-environment';
    group.userData.chapterId = 7;

    const uniforms = {
        uTime: { value: 0 },
        uEnergy: { value: 0.4 },
    };
    group.userData.uniforms = uniforms;

    const chapterRange = getChapterPathRange(7);
    const chapterCenterY = chapterRange?.center.y
        ?? (BLACK_HOLE_TRANSCENDENCE_CONFIG.yStart + BLACK_HOLE_TRANSCENDENCE_CONFIG.yEnd) / 2;

    // Always set the chapter bounds so downstream consumers (getChapterAtPosition,
    // opacity blending) never see undefined, even if the path lookup fails.
    group.userData.yStart = chapterRange?.start.y ?? BLACK_HOLE_TRANSCENDENCE_CONFIG.yStart;
    group.userData.yEnd = chapterRange?.end.y ?? BLACK_HOLE_TRANSCENDENCE_CONFIG.yEnd;

    const voidDome = createVoidDome(uniforms);
    voidDome.position.z = -740;
    group.add(voidDome);
    group.userData.voidDome = voidDome;

    const eventHorizon = createEventHorizon(uniforms);
    group.add(eventHorizon);
    group.userData.eventHorizon = eventHorizon;

    const accretionGlowRings = createAccretionGlowRings();
    group.add(accretionGlowRings);
    group.userData.accretionGlowRings = accretionGlowRings;

    const shards = createTranscendenceShards(uniforms);
    group.add(shards);
    group.userData.shards = shards;

    const lensingStarfield = createLensingStarfield(uniforms);
    group.add(lensingStarfield);
    group.userData.lensingStarfield = lensingStarfield;

    const infallStreams = createInfallStreams();
    group.add(infallStreams);
    group.userData.infallStreams = infallStreams;

    group.position.y = chapterCenterY;
    return group;
}

export function updateBlackHoleTranscendenceEnvironment(group, delta, time, camera, ...updateArgs) {
    const [, directorState = null] = updateArgs;
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }
    if (uniforms?.uEnergy) {
        const audioEnergy = directorState
            ? THREE.MathUtils.clamp((directorState.energy || 0) * 0.62 + (directorState.bass || 0) * 0.38, 0, 1)
            : null;
        uniforms.uEnergy.value = audioEnergy === null
            ? 0.4 + Math.sin(time * 0.45) * 0.2
            : 0.3 + audioEnergy * 0.7 + (directorState.beatPulse || 0) * 0.1;
    }

    const { voidDome } = group.userData;
    if (voidDome) {
        voidDome.rotation.y += delta * 0.015;
    }

    const { accretionGlowRings } = group.userData;
    if (accretionGlowRings?.children) {
        accretionGlowRings.children.forEach((ring, index) => {
            ring.rotation.z += delta * (0.12 + index * 0.05) * (index % 2 === 0 ? 1 : -1);
        });
    }

    const { eventHorizon } = group.userData;
    if (eventHorizon) {
        eventHorizon.rotation.z -= delta * 0.06;
    }

    const { shards } = group.userData;
    if (shards?.geometry?.attributes?.position) {
        const { array } = shards.geometry.attributes.position;
        const cameraY = camera?.position?.y ?? group.position.y;
        for (let index = 0; index < array.length; index += 3) {
            array[index + 1] += Math.sin(time * 0.6 + index * 0.1 + cameraY * 0.002) * 0.0025;
        }
        shards.geometry.attributes.position.needsUpdate = true;
    }

    const { lensingStarfield, infallStreams } = group.userData;
    if (lensingStarfield) {
        lensingStarfield.rotation.z += delta * 0.012;
    }
    if (infallStreams?.children) {
        infallStreams.children.forEach((stream) => {
            stream.rotation.z += delta * stream.userData.spin;
        });
    }
}

export default {
    config: BLACK_HOLE_TRANSCENDENCE_CONFIG,
    create: createBlackHoleTranscendenceEnvironment,
    update: updateBlackHoleTranscendenceEnvironment,
};
