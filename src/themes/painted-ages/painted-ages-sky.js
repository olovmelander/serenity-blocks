/** Painted Ages — the clear Long Morning, standing lenticulars and distant weather. */
import * as THREE from 'three/webgpu';
import {
    Fn, If, Loop, abs, acos, clamp, cos, dot, exp, float, fract, int,
    max, min, mix, normalize, positionGeometry, screenUV, sin, smoothstep,
    sqrt, step, texture, vec2, vec3, vec4,
} from 'three/tsl';
import { paKeepOut, paViewRay } from './painted-ages-tsl.js';
import { createCloudNoise, paRainCloud } from './painted-ages-clouds.js';

const DEGREES = 180 / Math.PI;

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

/** Sun distance from an interior cloud point; a pure analytic bound, no raymarch. */
const cloudSunExit = Fn(([point, sun, centre, radii]) => {
    const origin = point.sub(centre).div(radii);
    const ray = sun.div(radii);
    const a = max(dot(ray, ray), 1e-12);
    const b = dot(origin, ray);
    const discriminant = max(b.mul(b).sub(a.mul(dot(origin, origin).sub(1))), 0);
    return max(b.negate().add(sqrt(discriminant)).div(a), 0);
}).setLayout({
    name: 'paSky_cloudSunExit',
    type: 'float',
    inputs: [
        { name: 'point', type: 'vec3' }, { name: 'sun', type: 'vec3' },
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
    const cloudNoise = createCloudNoise();
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
        const rainCloud = paRainCloud(u, d, cloudNoise, tier).toVar();
        sky.assign(mix(sky, rainCloud.rgb, rainCloud.a));
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
                        .add(index.mul(36)).add(sin(index.mul(1.47)).mul(145)),
                    float(1070).add(index.mul(108)).add(sin(index.mul(1.8)).mul(12)),
                    -10000,
                ).toVar();
                const rimBreath = sin(u.time.mul((Math.PI * 2) / 90).mul(motion).add(index.mul(0.37)))
                    .mul(0.035).add(1);
                const radii = vec3(
                    float(1230).sub(index.mul(70)).add(sin(index.mul(1.63)).mul(160)).mul(rimBreath),
                    float(72).add(sin(index.mul(1.89)).mul(17)),
                    float(620).add(cos(index.mul(1.1)).mul(65)),
                ).toVar();
                const bound = ellipsoid(d, u.eye, centre, radii.mul(vec3(1.1, 1.8, 1.1))).toVar();
                // Texture reads only occur on a lens. The broad field displaces its outline;
                // its stored analytic slopes bend the light continuously across texel edges.
                If(bound.x.greaterThan(0.01), () => {
                    const planeT = centre.z.sub(u.eye.z).div(min(d.z, -0.08));
                    const planePoint = u.eye.add(d.mul(planeT));
                    const noiseUV = planePoint.xy.mul(vec2(0.00037, 0.0011))
                        .add(vec2(u.time.mul(0.0012).mul(motion).add(index.mul(0.13)), index.mul(0.27)));
                    const cloudField = texture(cloudNoise, noiseUV).level(1).toVar();
                    const sculptedCentre = centre.add(vec3(0, cloudField.r.sub(0.5).mul(100), 0));
                    const sculptedRadii = radii.mul(vec3(
                        cloudField.r.sub(0.5).mul(0.12).add(1),
                        cloudField.r.sub(0.5).mul(0.8).add(1),
                        1,
                    ));
                    const hit = ellipsoid(d, u.eye, sculptedCentre, sculptedRadii).toVar();
                    const front = u.eye.add(d.mul(hit.y)).toVar();
                    const interior = front.add(d.mul(hit.x.mul(0.28))).toVar();
                    const bodyDensity = cloudField.r.mul(1.45).add(0.17).toVar();
                    const erosion = cloudField.a.toVar();
                    if (tier.detailOctaves >= 2) {
                        const detail = texture(cloudNoise, noiseUV.mul(vec2(2.1, 1.35)).add(vec2(0.37, 0.19))).level(1);
                        bodyDensity.mulAssign(detail.r.mul(0.22).add(0.89));
                        erosion.assign(mix(erosion, detail.a, 0.4));
                    }
                    const opticalDepth = max(hit.x, 0).mul(bodyDensity).mul(0.006).toVar();
                    const edgeErosion = smoothstep(0, 90, hit.x.add(erosion.sub(0.5).mul(120)));
                    const bodyAlpha = float(1).sub(exp(opticalDepth.negate())).mul(edgeErosion);
                    const fringeDensity = bound.x.mul(0.0005).mul(smoothstep(0.3, 0.7, erosion))
                        .mul(float(1).sub(smoothstep(0, 220, hit.x)));
                    const wispAlpha = float(1).sub(exp(fringeDensity.negate())).mul(0.32);
                    const tip = abs(planePoint.x.sub(sculptedCentre.x).div(sculptedRadii.x));
                    const tipFeather = float(1).sub(smoothstep(0.83, 1.04, tip));
                    const opacity = bodyAlpha.add(float(1).sub(bodyAlpha).mul(wispAlpha)).mul(tipFeather).mul(live);
                    const slopes = cloudField.gb.mul(2).sub(1).mul(4);
                    const normal = normalize(front.sub(sculptedCentre).div(sculptedRadii.mul(sculptedRadii)));
                    const cloudNormal = normalize(normal.add(vec3(slopes.x.mul(-0.85), slopes.y.mul(-0.25), 0)));
                    const sunDepth = cloudSunExit(interior, u.sunDir, sculptedCentre, sculptedRadii)
                        .mul(bodyDensity).mul(0.008);
                    // An upper lens casts a soft internal shadow onto the layer below.
                    const upper = index.add(1);
                    const upperCentre = vec3(
                        float(550).add(sin(u.time.mul(0.011).mul(motion)).mul(45))
                            .add(upper.mul(36)).add(sin(upper.mul(1.47)).mul(145)),
                        float(1070).add(upper.mul(108)).add(sin(upper.mul(1.8)).mul(12)),
                        -10000,
                    );
                    const upperRadii = vec3(
                        float(1230).sub(upper.mul(70)).add(sin(upper.mul(1.63)).mul(160)),
                        float(54).add(sin(upper.mul(1.89)).mul(9)),
                        float(620).add(cos(upper.mul(1.1)).mul(65)),
                    );
                    const upperDissolve = float(10).add(float(8).sub(upper).mul(6 / 9));
                    const upperPerfect = float(1)
                        .sub(smoothstep(upperDissolve, upperDissolve.add(6 / 9), u.perfectAge))
                        .mul(smoothstep(0, 0.3, u.perfect));
                    const upperLive = max(float(1).sub(step(normalPlates - 0.5, upper)), upperPerfect)
                        .mul(float(1).sub(step(8.5, upper)));
                    const upperShadow = ellipsoid(u.sunDir, interior, upperCentre, upperRadii).x
                        .mul(upperLive).mul(0.0025);
                    const sunLight = exp(max(sunDepth.add(upperShadow), 0).negate());
                    const wrappedLight = clamp(dot(cloudNormal, u.sunDir).mul(0.65).add(0.35), 0, 1);
                    const top = clamp(front.y.sub(sculptedCentre.y).div(sculptedRadii.y).mul(0.5).add(0.5), 0, 1);
                    const illumination = sunLight.mul(0.6).add(wrappedLight.mul(0.26)).add(top.mul(0.14));
                    // Cobalt skylight fills the curved underside; sunlight stays cream-white.
                    const plateColour = vec3(0.15, 0.225, 0.37)
                        .add(vec3(0.9, 0.83, 0.71).mul(illumination)).toVar();
                    if (recordTexture) {
                        const age = float(8).sub(index);
                        const row = fract(u.recordHead.sub(age).add(512.5).div(512));
                        const recordColour = texture(recordTexture, vec2(10.5 / 16, row)).level(0).rgb;
                        const mineralBody = recordColour.mul(illumination.mul(0.95).add(0.4))
                            .add(vec3(0.07, 0.085, 0.12));
                        plateColour.assign(mix(plateColour, mineralBody, u.perfect.mul(0.86)));
                    }
                    const rim = exp(opticalDepth.mul(-0.7)).mul(smoothstep(0, 80, hit.x))
                        .mul(float(1).sub(smoothstep(0.72, 0.98, tip)));
                    const rimColour = mix(vec3(0.2, 0.17, 0.115), vec3(0.44, 0.19, 0.13), max(u.perfect, dusk));
                    plateColour.addAssign(rimColour.mul(rim).mul(wrappedLight.mul(0.7).add(0.3)));
                    sky.assign(mix(sky, plateColour, opacity));
                });
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
