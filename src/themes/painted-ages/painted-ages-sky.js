/** Painted Ages — the clear Long Morning, standing lenticulars and distant weather. */
import * as THREE from 'three/webgpu';
import {
    Fn, If, Loop, abs, acos, clamp, cos, dot, exp, float, fract, int,
    length, max, min, mix, normalize, positionGeometry, screenUV, sin, smoothstep,
    sqrt, step, texture, vec2, vec3, vec4,
} from 'three/tsl';
import { paKeepOut, paViewRay } from './painted-ages-tsl.js';

const DEGREES = 180 / Math.PI;

/** Smooth periodic fBm baked once; clouds advect its texture through their standing shape. */
function bakeCloudNoise(size = 128) {
    const data = new Uint8Array(size * size * 4);
    const hash = (x, y, cells) => {
        const px = ((x % cells) + cells) % cells;
        const py = ((y % cells) + cells) % cells;
        const n = Math.sin(px * 127.1 + py * 311.7 + 3.83) * 43758.5453;
        return n - Math.floor(n);
    };
    const noise = (x, y, cells) => {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const fx = x - ix;
        const fy = y - iy;
        const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
        const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
        const a = hash(ix, iy, cells) * (1 - sx) + hash(ix + 1, iy, cells) * sx;
        const b = hash(ix, iy + 1, cells) * (1 - sx) + hash(ix + 1, iy + 1, cells) * sx;
        return a * (1 - sy) + b * sy;
    };
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let sum = 0;
            let weight = 0;
            for (let octave = 0; octave < 4; octave++) {
                const cells = 4 * 2 ** octave;
                const amplitude = 2 ** -octave;
                sum += noise((x / size) * cells, (y / size) * cells, cells) * amplitude;
                weight += amplitude;
            }
            const offset = (y * size + x) * 4;
            const value = Math.round((sum / weight) * 255);
            data.set([value, value, value, 255], offset);
        }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.name = 'PaintedAgesCloudNoise';
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
}

/** Ray thickness and entrance distance through an ellipsoid; all roots are bounded. */
const ellipsoid = Fn(([direction, eye, centre, radii]) => {
    const origin = eye.sub(centre).div(radii);
    const ray = direction.div(radii);
    const a = max(dot(ray, ray), 1e-12);
    const b = dot(origin, ray);
    const discriminant = b.mul(b).sub(a.mul(dot(origin, origin).sub(1)));
    const root = sqrt(max(discriminant, 0));
    const near = b.negate().sub(root).div(a);
    const far = b.negate().add(root).div(a);
    return vec2(root.mul(2).div(a).mul(step(0, discriminant)).mul(step(0, far)), max(near, 0));
}).setLayout({
    name: 'paSky_ellipsoid',
    type: 'vec2',
    inputs: [
        { name: 'direction', type: 'vec3' }, { name: 'eye', type: 'vec3' },
        { name: 'centre', type: 'vec3' }, { name: 'radii', type: 'vec3' },
    ],
});

/** The primary progresses from violet inside to red outside; the secondary reverses it. */
const spectrum = Fn(([t]) => {
    const x = clamp(t, 0, 1);
    const violet = vec3(0.32, 0.06, 0.72).mul(exp(x.sub(0.06).mul(x.sub(0.06)).mul(-90)));
    const blue = vec3(0.025, 0.2, 1).mul(exp(x.sub(0.25).mul(x.sub(0.25)).mul(-80)));
    const green = vec3(0.06, 0.76, 0.2).mul(exp(x.sub(0.47).mul(x.sub(0.47)).mul(-80)));
    const yellow = vec3(0.95, 0.66, 0.045).mul(exp(x.sub(0.68).mul(x.sub(0.68)).mul(-80)));
    const red = vec3(1, 0.085, 0.02).mul(exp(x.sub(0.92).mul(x.sub(0.92)).mul(-80)));
    return violet.add(blue).add(green).add(yellow).add(red);
}).setLayout({ name: 'paSky_spectrum', type: 'vec3', inputs: [{ name: 't', type: 'float' }] });

/**
 * One physical bow for sky and rain in front of land. This builder is deliberately inline:
 * its uniforms belong to each caller. `coverage` is the rain slab between eye and surface.
 */
export function paRainbow(u, direction, coverage = 1, tier = {}) {
    const angle = acos(clamp(dot(direction, u.sunDir.negate()), -1, 1)).mul(DEGREES).toVar();
    const strength = u.bow.mul(step(4.5, u.releasePeak)).mul(coverage);
    const primaryT = angle.sub(40.4).div(1.9);
    const primaryMask = smoothstep(40.22, 40.5, angle).mul(float(1).sub(smoothstep(42.22, 42.5, angle)));
    const secondaryT = float(1).sub(angle.sub(50.4).div(3));
    const secondaryMask = smoothstep(50.18, 50.55, angle)
        .mul(float(1).sub(smoothstep(53.2, 53.6, angle))).mul(step(5.5, u.releasePeak));
    const colour = spectrum(primaryT).mul(primaryMask).add(spectrum(secondaryT).mul(secondaryMask).mul(0.43)).toVar();
    if (tier.supernumeraries) {
        const fringe = cos(angle.sub(40.4).mul(16)).toVar();
        const envelope = smoothstep(37.7, 38.5, angle).mul(float(1).sub(smoothstep(40.1, 40.4, angle)));
        colour.addAssign(vec3(0.2, 0.3, 0.36).mul(fringe.mul(fringe)).mul(envelope)
            .mul(step(7.5, u.releasePeak))
            .mul(0.2));
    }
    return colour.mul(strength).mul(0.58).mul(paKeepOut(u));
}

/** Soft cloud shadow shared with the land: one standing stack over the far face. */
export function paLenticularShadow(u, worldPosition) {
    const x = worldPosition.x.sub(550).sub(sin(u.time.mul(0.011)).mul(45)).div(1550);
    const z = worldPosition.z.add(9400).div(1700);
    return float(1).sub(exp(max(x.mul(x).add(z.mul(z)), 0).mul(-1.8)).mul(0.16));
}

export function createSky({ u, tier, recordTexture }) {
    const cloudNoise = bakeCloudNoise();
    const normalPlates = tier.lenticularPlates ?? 5;
    const light = Fn(() => {
        const d = normalize(paViewRay(u, screenUV)).toVar();
        const altitude = max(d.y, 0).toVar();
        // The landscape lens only shows about fourteen degrees above the horizon. Finish
        // the pale horizon's transition before ten degrees so cobalt owns the upper sky.
        const sky = mix(vec3(0.64, 0.79, 0.83), vec3(0.025, 0.095, 0.485), smoothstep(0, 0.175, altitude)).toVar();
        const lowHaze = exp(altitude.mul(-15));
        sky.addAssign(vec3(0.07, 0.025, 0.005).mul(lowHaze).mul(smoothstep(0.0, 0.7, d.x.negate())));

        // Earth shadow and the rose atmospheric belt occur only in the game-over low light.
        const dusk = max(u.gameOver, float(1).sub(smoothstep(1, 6, u.sunElevation))).toVar();
        const earthShadow = float(1).sub(smoothstep(0.012, 0.07, altitude));
        const belt = exp(altitude.sub(0.073).mul(altitude.sub(0.073)).mul(-650));
        sky.assign(mix(sky, vec3(0.11, 0.16, 0.32), earthShadow.mul(dusk).mul(0.68)));
        sky.assign(mix(sky, vec3(0.69, 0.34, 0.43), belt.mul(dusk).mul(0.62)));

        // A confined far shower walks beyond R4. Its complete silhouette covers less than a
        // fifth of the sky: even the largest combo leaves the cobalt majority untouched.
        const motion = mix(float(1), float(0.4), u.reducedMotion);
        const showerX = sin(u.time.mul(0.008).mul(motion)).mul(0.19).add(0.28);
        const showerPoint = vec2(d.x.div(max(d.z.negate(), 0.08)).sub(showerX), d.y.div(max(d.z.negate(), 0.08)));
        const showerWidth = mix(float(0.075), float(0.12), clamp(u.wetZones.div(7), 0, 1));
        const deckBase = length(vec2(showerPoint.x.div(showerWidth.mul(1.18)), showerPoint.y.sub(0.134).div(0.012)));
        const deckLeft = length(vec2(
            showerPoint.x.add(showerWidth.mul(0.45)).div(showerWidth.mul(0.56)),
            showerPoint.y.sub(0.146).div(0.018),
        ));
        const deckCrown = length(vec2(
            showerPoint.x.sub(showerWidth.mul(0.02)).div(showerWidth.mul(0.44)),
            showerPoint.y.sub(0.152).div(0.021),
        ));
        const deckRight = length(vec2(
            showerPoint.x.sub(showerWidth.mul(0.52)).div(showerWidth.mul(0.5)),
            showerPoint.y.sub(0.141).div(0.014),
        ));
        const tailShape = length(vec2(
            showerPoint.x.sub(showerWidth.mul(0.9)).div(showerWidth.mul(0.92)),
            showerPoint.y.sub(0.134).div(0.009),
        ));
        const deckShape = min(min(deckBase, deckLeft), min(deckCrown, deckRight));
        const deckUV = showerPoint.mul(vec2(3, 10)).add(vec2(u.time.mul(0.001).mul(motion), 0));
        const deckNoise = texture(cloudNoise, deckUV).level(2).r;
        const deck = float(1).sub(smoothstep(0.69, 1.11, deckShape.add(deckNoise.sub(0.5).mul(0.3))));
        const tail = float(1).sub(smoothstep(0.35, 1.2, tailShape)).mul(0.42);
        const deckTop = smoothstep(0.129, 0.175, showerPoint.y);
        const deckLight = clamp(deckTop.mul(0.75).add(deckNoise.sub(0.35).mul(0.55)), 0, 1);
        const deckColour = mix(vec3(0.18, 0.25, 0.38), vec3(0.78, 0.82, 0.88), deckLight);
        sky.assign(mix(sky, deckColour, max(deck, tail).mul(0.8)));
        const rainUV = showerPoint.mul(vec2(18, 2)).add(vec2(0, u.time.mul(0.007).mul(motion)));
        const falling = texture(cloudNoise, rainUV).level(1).r;
        const rainLean = showerPoint.x.add(showerPoint.y.sub(0.134).mul(0.18));
        const rain = float(1).sub(smoothstep(showerWidth.mul(0.45), showerWidth, abs(rainLean)))
            .mul(smoothstep(0.025, 0.065, showerPoint.y)).mul(float(1).sub(smoothstep(0.118, 0.138, showerPoint.y)))
            .mul(mix(float(0.13), float(0.4), falling));
        sky.assign(mix(sky, vec3(0.34, 0.32, 0.46), rain));

        // Standing lenses. The loop also reserves all nine perfect-clear plates on every
        // tier, so the sky remembers the newest nine record beds even on a phone.
        Loop({
            start: int(0), end: int(9), type: 'int', condition: '<', name: 'plate',
        }, ({ plate }) => {
            const index = float(plate).toVar();
            const dissolveAt = float(10).add(float(8).sub(index).mul(6 / 9));
            const perfectPlate = float(1).sub(smoothstep(dissolveAt, dissolveAt.add(6 / 9), u.perfectAge))
                .mul(smoothstep(0, 0.3, u.perfect));
            const live = max(float(1).sub(step(normalPlates - 0.5, index)), perfectPlate);
            If(live.greaterThan(0.001), () => {
                const centre = vec3(
                    float(550).add(sin(u.time.mul(0.011).mul(motion)).mul(45))
                        .add(index.mul(21)).add(sin(index.mul(1.47)).mul(62)),
                    float(1070).add(index.mul(108)).add(sin(index.mul(1.8)).mul(12)),
                    -10000,
                );
                const rimBreath = sin(u.time.mul((Math.PI * 2) / 90).mul(motion).add(index.mul(0.37))).mul(0.04).add(1);
                const rimWave = sin(d.x.mul(39).add(index.mul(1.31))).mul(5)
                    .add(sin(index.mul(1.89)).mul(7));
                const radii = vec3(
                    float(1230).sub(index.mul(66)).add(sin(index.mul(1.63)).mul(78)).mul(rimBreath),
                    float(44).add(rimWave),
                    float(620).add(cos(index.mul(1.1)).mul(65)),
                );
                const hit = ellipsoid(d, u.eye, centre, radii).toVar();
                const p = u.eye.add(d.mul(hit.y)).toVar();
                const noiseUV = p.xz.mul(0.00065).add(vec2(u.time.mul(0.0018).mul(motion), index.mul(0.17)));
                const n = texture(cloudNoise, noiseUV).level(2).r;
                const billowUV = noiseUV.mul(vec2(2.3, 1.8)).add(vec2(index.mul(0.13), 0.37));
                const billow = texture(cloudNoise, billowUV).level(1).r;
                const density = hit.x.mul(n.mul(0.7).add(billow.mul(0.36)).add(0.36)).mul(0.0055).toVar();
                const opacity = float(1).sub(exp(max(density, 0).negate())).mul(live);
                const cloudNormal = normalize(p.sub(centre).div(radii.mul(radii)));
                const top = clamp(p.y.sub(centre.y).div(radii.y.mul(2)).add(0.5), 0, 1);
                const sunFacing = max(dot(cloudNormal, u.sunDir), 0);
                const diffuse = clamp(top.mul(0.46).add(sunFacing.mul(0.68)).add(billow.sub(0.5).mul(0.16)), 0, 1);
                const selfShadow = exp(max(density, 0).mul(-0.36)).mul(0.2).add(0.8);
                const plateColour = mix(vec3(0.23, 0.31, 0.47), vec3(0.93, 0.96, 1.02), diffuse)
                    .mul(selfShadow).toVar();
                if (recordTexture) {
                    const age = float(8).sub(index);
                    const row = fract(u.recordHead.sub(age).add(512.5).div(512));
                    const recordColour = texture(recordTexture, vec2(10.5 / 16, row)).level(0).rgb;
                    plateColour.assign(mix(plateColour, recordColour.mul(1.25).add(0.13), u.perfect.mul(0.86)));
                }
                const rim = exp(max(hit.x, 0).mul(-0.012)).mul(smoothstep(0, 65, hit.x));
                const rimColour = mix(vec3(0.22, 0.22, 0.2), vec3(0.45, 0.21, 0.17), max(u.perfect, dusk));
                plateColour.addAssign(rimColour.mul(rim).mul(sunFacing.mul(0.7).add(0.3)));
                sky.assign(mix(sky, plateColour, opacity));
            });
        });

        const bowAngle = acos(clamp(dot(d, u.sunDir.negate()), -1, 1)).mul(DEGREES);
        const bowWet = u.bow.mul(step(4.5, u.releasePeak));
        const alexander = smoothstep(42.4, 43.2, bowAngle).mul(float(1).sub(smoothstep(49.8, 50.4, bowAngle)))
            .mul(step(5.5, u.releasePeak)).mul(bowWet);
        sky.mulAssign(float(1).sub(alexander.mul(0.15)));
        sky.addAssign(vec3(0.055, 0.059, 0.06).mul(float(1).sub(smoothstep(39.7, 40.5, bowAngle))).mul(bowWet));
        sky.addAssign(paRainbow(u, d, 1, tier));
        return vec4(max(sky, vec3(0)), 1);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: true, depthWrite: false });
    material.name = 'PaintedAgesSky';
    material.fog = false;
    material.depthFunc = THREE.LessEqualDepth;
    material.vertexNode = vec4(positionGeometry.xy, 1, 1);
    material.fragmentNode = light();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'PaintedAgesSky';
    mesh.frustumCulled = false;
    mesh.renderOrder = 50;
    return {
        mesh,
        geometry,
        material,
        dispose() {
            geometry.dispose();
            material.dispose();
            cloudNoise.dispose();
        },
    };
}
