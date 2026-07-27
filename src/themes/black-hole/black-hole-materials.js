import {
    AdditiveBlending,
    BackSide,
    DoubleSide,
    MeshBasicNodeMaterial,
    NormalBlending,
    PointsNodeMaterial,
    Vector3,
} from 'three/webgpu';
import {
    abs,
    atan,
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    Fn,
    If,
    instanceIndex,
    length,
    max,
    min,
    mix,
    mx_fractal_noise_float as mxFractalNoiseFloat,
    mx_noise_float as mxNoiseFloat,
    modelViewMatrix,
    normalize,
    normalWorld,
    pow,
    positionWorld,
    positionLocal,
    sin,
    smoothstep,
    sqrt,
    step,
    storage,
    texture,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { DISK_COS_TILT, DISK_SIN_TILT } from './black-hole-disk-basis.js';

function tslFbm(p, octaves = 3) {
    // MaterialX noise is shared by the WebGPU and WebGL2 node backends and is
    // considerably more stable than the old hand-rolled sin/hash FBM.
    return mxFractalNoiseFloat(p, octaves, 2.0, 0.5, 1.0).mul(0.5).add(0.5);
}

export function createBlackHoleCoreNodeMaterial(params = {}) {
    const noiseOctaves = Math.max(1, Math.floor(params.noiseOctaves ?? 3));
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
        blending: NormalBlending,
    });
    material.forceSinglePass = true;

    const uTime = uniform(0);
    const uIntensity = uniform(1.0);
    const uScale = uniform(1.0);

    const uvCoord = uv().mul(2.0).sub(1.0);
    const dist = length(uvCoord);

    // The plane is 600 world units wide and the solid event-horizon sphere has
    // radius 120, so the shadow edge is 0.4 in this -1..1 UV domain.
    const eventHorizon = float(0.395).mul(uScale);
    const innerRim = float(0.414).mul(uScale);
    const black = float(1.0).sub(smoothstep(
        eventHorizon.sub(0.008),
        eventHorizon.add(0.008),
        dist,
    ));

    // A symmetric distance is essential here. The previous clamped distance
    // made every pixel *inside* the photon radius fully white.
    const rimDist = abs(dist.sub(innerRim)).div(0.012);
    const photonRing = exp(rimDist.mul(rimDist).negate().mul(2.4)).mul(uIntensity).mul(0.72);

    const shimmerCoord = uvCoord.mul(12.0).add(uTime.mul(0.8));
    const shimmer = tslFbm(shimmerCoord, noiseOctaves).mul(0.4);

    // Mask shimmer exactly to the photon ring
    const shimmerMask = float(1.0)
        .sub(smoothstep(float(0.37), float(0.49), dist))
        .mul(float(1.0).sub(black));
    const photonRingWithShimmer = photonRing.add(shimmer.mul(shimmerMask).mul(uIntensity));

    const orangeColor = vec3(1.0, 0.6, 0.2);
    const whiteColor = vec3(1.08, 1.02, 0.92);
    const blueColor = vec3(0.38, 0.62, 1.0);

    let photonColor = mix(orangeColor, whiteColor, photonRingWithShimmer.mul(0.5));
    photonColor = mix(photonColor, blueColor, smoothstep(float(0.405), float(0.46), dist).mul(0.32));

    let color = photonColor.mul(photonRingWithShimmer);
    color = mix(color, vec3(0.0, 0.0, 0.0), black);

    const alpha = clamp(photonRingWithShimmer.mul(float(1.0).sub(black)).add(black), float(0.0), float(1.0));

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color; // Additive emissive

    material.userData = { uTime, uIntensity, uScale };

    return material;
}

export function createAccretionDiskNodeMaterial(params = {}) {
    const noiseOctaves = Math.max(1, Math.floor(params.noiseOctaves ?? 3));
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
        blending: NormalBlending,
    });
    material.forceSinglePass = true;

    const uTime = uniform(0);
    const uIntensity = uniform(1.0);
    const uRotationSpeed = uniform(1.0);
    const uCenter = uniform(new Vector3(0, 0, 0));
    const uDopplerBoost = uniform(1.0);
    const uEventEnergy = uniform(0.0);
    const uCausticStrength = uniform(0.0);

    const pos = positionLocal;
    // RingGeometry is authored in local XY. The mesh is then rotated around X;
    // using XZ here collapsed the old disk into a striped two-lobed shape.
    const angle = atan(pos.y, pos.x);
    const radius = length(pos.xy);

    const innerRadius = float(140.0);
    const outerRadius = float(400.0);
    const normalizedRadius = clamp(radius.sub(innerRadius).div(outerRadius.sub(innerRadius)), float(0.0), float(1.0));

    // Approximate Keplerian shear: inner gas advances much faster than outer
    // gas, producing hot knots that stretch into lanes instead of a rigid disc.
    const orbitalRate = mix(float(1.15), float(0.22), pow(normalizedRadius, 0.62));
    const shear = uTime.mul(uRotationSpeed).mul(0.34).mul(orbitalRate);
    const rotatedAngle = angle.sub(shear);

    // Seam-free angular noise. atan(pos.y, pos.x) has a branch cut on the -X axis where the
    // angle jumps by 2*pi; feeding that scalar straight into the noise produced a hard
    // discontinuity — a visible line + sharp edge on one side of the disc. Instead sample the
    // noise on a CIRCLE (cos, sin), which is continuous and 2*pi-periodic, so the turbulence
    // wraps seamlessly all the way around. We rotate the unit direction by -shear so the
    // pattern still advects with the orbital flow — this is (cos(rotatedAngle), sin(rotatedAngle))
    // without ever forming the discontinuous scalar. The sin(N*rotatedAngle) spiral/knot terms
    // below keep using the scalar: they are integer multiples of the angle and so already
    // seamless across the cut. The circle radius (1.2 / 2.4) matches the old feature density.
    const safeRadius = max(radius, float(1.0));
    const cosA = pos.x.div(safeRadius);
    const sinA = pos.y.div(safeRadius);
    const cosShear = cos(shear);
    const sinShear = sin(shear);
    const rotDir = vec2(
        cosA.mul(cosShear).add(sinA.mul(sinShear)),
        sinA.mul(cosShear).sub(cosA.mul(sinShear)),
    );

    const warp = mxNoiseFloat(
        vec3(rotDir.mul(1.2), normalizedRadius.mul(5.0)).add(uTime.mul(0.035)),
        0.34,
    );
    const turbUv = vec3(
        rotDir.mul(2.4).add(warp),
        normalizedRadius.mul(9.0).sub(uTime.mul(0.08)),
    );
    const turb = tslFbm(turbUv, noiseOctaves);

    const spirals = sin(rotatedAngle.mul(4.0).add(normalizedRadius.mul(24.0)).add(turb.mul(4.2)));
    const lane = smoothstep(float(-0.28), float(0.82), spirals);
    const knot = pow(max(float(0.0), sin(rotatedAngle.mul(7.0)
        .sub(normalizedRadius.mul(31.0))
        .add(turb.mul(5.0)))), 5.0);
    const spiralFactor = float(0.36).add(lane.mul(0.48)).add(knot.mul(0.72));

    const temp = float(1.0).sub(pow(normalizedRadius, float(0.5)));

    const innerColor = vec3(1.18, 0.92, 0.66);
    const midColor = vec3(0.94, 0.34, 0.08);
    const outerColor = vec3(0.22, 0.025, 0.035);

    const lowMix = mix(outerColor, midColor, temp.mul(2.0));
    const highMix = mix(midColor, innerColor, temp.sub(0.5).mul(2.0));
    let baseColor = mix(lowMix, highMix, step(float(0.5), temp));

    baseColor = baseColor.mul(float(0.62).add(turb.mul(0.5)));

    const worldRadial = positionWorld.sub(uCenter);
    const tangent = normalize(cross(normalWorld, worldRadial));
    const viewDirection = normalize(cameraPosition.sub(positionWorld));
    const doppler = clamp(dot(tangent, viewDirection).mul(uDopplerBoost), -1.0, 1.0);
    // Relativistic beaming should create a clear blue-white leading edge, but
    // it must retain chroma after bloom instead of collapsing into a white
    // semicircle.
    const blueShift = vec3(0.38, 0.64, 1.08);
    const redShift = vec3(0.95, 0.105, 0.025);
    baseColor = mix(baseColor, blueShift, max(float(0.0), doppler).mul(0.38));
    baseColor = mix(baseColor, redShift, max(float(0.0), doppler.negate()).mul(0.31));
    const dopplerBrightness = clamp(float(1.0).add(doppler.mul(0.43)), 0.56, 1.46);

    const brightness = float(0.22)
        .add(spiralFactor.mul(0.54))
        .add(turb.mul(0.12))
        .add(uEventEnergy.mul(0.14))
        .add(knot.mul(uCausticStrength).mul(0.5))
        .mul(uIntensity)
        .mul(dopplerBrightness);

    const innerFade = smoothstep(float(0.0), float(0.12), normalizedRadius);
    const outerFade = float(1.0).sub(smoothstep(float(0.73), float(1.0), normalizedRadius));
    const edgeFade = innerFade.mul(outerFade);

    material.colorNode = baseColor.mul(brightness);
    material.opacityNode = edgeFade.mul(brightness).mul(0.82).clamp(0.0, 0.94);
    material.emissiveNode = baseColor.mul(brightness);

    material.userData = {
        uTime,
        uIntensity,
        uRotationSpeed,
        uCenter,
        uDopplerBoost,
        uEventEnergy,
        uCausticStrength,
    };

    return material;
}

/**
 * Analytic secondary image of the far side of the accretion disk. This is a
 * deliberately bounded game approximation: two warped ribbons communicate
 * gravitational lensing without a full-screen geodesic ray march.
 */
export function createLensedDiskArcNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
        blending: AdditiveBlending,
    });
    material.forceSinglePass = true;

    const uTime = uniform(0);
    const uIntensity = uniform(0.72);
    const uDopplerBoost = uniform(1.0);
    const uCausticStrength = uniform(0.0);

    const p = uv().mul(2.0).sub(1.0);
    const xNorm = clamp(p.x.div(0.91), -1.0, 1.0);
    const arch = float(0.19).add(sqrt(max(float(0.0), float(1.0).sub(xNorm.mul(xNorm)))).mul(0.24));
    const ribbonDistance = abs(abs(p.y).sub(arch));
    const primary = float(1.0).sub(smoothstep(0.018, 0.074, ribbonDistance));
    const echoDistance = abs(abs(p.y).sub(arch.add(0.072)));
    const echo = float(1.0).sub(smoothstep(0.012, 0.043, echoDistance)).mul(0.24);
    const horizontalFade = float(1.0).sub(smoothstep(0.73, 0.98, abs(p.x)));
    const centerMask = smoothstep(0.34, 0.47, length(p));
    const lowerImage = mix(0.58, 1.0, step(0.0, p.y));

    const flow = p.x.mul(8.0)
        .sub(uTime.mul(0.75))
        .add(mxNoiseFloat(vec2(p.x.mul(4.0), p.y.mul(9.0)).add(uTime.mul(0.045)), 1.1));
    const lanes = sin(flow).mul(0.5).add(0.5);
    const hotKnot = pow(max(float(0.0), sin(flow.mul(1.9).add(p.y.mul(7.0)))), 6.0);
    const doppler = clamp(p.x.mul(uDopplerBoost), -1.0, 1.0);

    const warm = vec3(1.12, 0.42, 0.055);
    const hot = vec3(1.18, 0.94, 0.72);
    const blue = vec3(0.48, 0.74, 1.18);
    const red = vec3(0.88, 0.055, 0.025);
    let ribbonColor = mix(warm, hot, lanes.mul(0.62).add(hotKnot.mul(0.38)));
    ribbonColor = mix(ribbonColor, blue, max(float(0.0), doppler).mul(0.58));
    ribbonColor = mix(ribbonColor, red, max(float(0.0), doppler.negate()).mul(0.42));

    const caustic = float(1.0).add(hotKnot.mul(uCausticStrength).mul(1.6));
    const alpha = primary.add(echo)
        .mul(horizontalFade)
        .mul(centerMask)
        .mul(lowerImage)
        .mul(uIntensity)
        .mul(caustic)
        .clamp(0.0, 0.92);

    material.colorNode = ribbonColor.mul(alpha);
    material.opacityNode = alpha;
    material.emissiveNode = ribbonColor.mul(alpha);
    material.userData = {
        uTime, uIntensity, uDopplerBoost, uCausticStrength,
    };

    return material;
}

export function createVolumetricAccretionDiskNodeMaterial(diskNormal, options = {}) {
    const steps = Math.max(4, Math.floor(options.steps ?? 14));
    const fbmOctaves = Math.max(1, Math.floor(options.fbmOctaves ?? 2));
    // Ray march is capped at steps*stepSize = maxMarch. Beyond that, further steps are no-ops.
    // maxMarchSq lets us cheaply short-circuit wasted iterations once the ray has drifted too far.
    // stepSize is configurable so step count can be lowered (cheaper) while keeping the same total
    // march reach (steps*stepSize) — preserves how far rays travel so the disk isn't clipped.
    const stepSizeValue = Math.max(8, Number(options.stepSize) || 32.0);
    const maxMarch = steps * stepSizeValue * 1.1;
    const maxMarchSq = maxMarch * maxMarch;

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: BackSide,
        blending: AdditiveBlending,
    });

    const uTime = uniform(0);
    const uIntensity = uniform(0.35);
    const uRotationSpeed = uniform(1.0);
    const uCenter = uniform(new Vector3(0, 0, 0));
    const uDiskNormal = uniform(diskNormal);
    const uDopplerBoost = uniform(1.0); // For reactive heating
    const uEventHorizon = uniform(110.0); // For gravitational ripples

    const worldPos = positionWorld;

    const baseColorFn = Fn(() => {
        const ro = cameraPosition.toVar();
        const rd = normalize(worldPos.sub(cameraPosition)).toVar();

        const stepSize = float(stepSizeValue);

        const accumColor = vec3(0.0).toVar();
        const activeRay = float(1.0).toVar();

        const gravStrength = float(2600.0);

        for (let i = 0; i < steps; i++) {
            const toCenter = uCenter.sub(ro);
            const distSq = dot(toCenter, toCenter);
            const dist = sqrt(distSq);

            If(dist.lessThan(uEventHorizon), () => {
                activeRay.assign(0.0);
                // break equivalent in TSL is handled by condition inside the loop but we can't easily break from a js for-loop emitting nodes.
                // We'll just stop accumulating by zeroing activeRay and using it as a multiplier.
            });

            // Skip remaining work when the ray is either absorbed or has drifted past any useful sampling range.
            If(activeRay.greaterThan(0.0).and(distSq.lessThan(maxMarchSq)), () => {
                const forceDist = max(distSq, uEventHorizon.mul(uEventHorizon));
                const gravityForce = toCenter.div(dist).mul(gravStrength.div(forceDist));
                rd.assign(normalize(rd.add(gravityForce.mul(stepSize))));

                ro.addAssign(rd.mul(stepSize));

                const height = dot(ro.sub(uCenter), uDiskNormal);
                const radialVec = ro.sub(uCenter).sub(uDiskNormal.mul(height));
                const radialDist = length(radialVec);

                If(radialDist.greaterThan(130.0)
                    .and(radialDist.lessThan(450.0))
                    .and(abs(height).lessThan(40.0)), () => {
                    const radialMask = smoothstep(130.0, 160.0, radialDist)
                        .mul(float(1.0).sub(smoothstep(380.0, 450.0, radialDist)));
                    const heightFalloff = exp(height.mul(height).negate().mul(0.003));

                    const angle = atan(radialVec.z, radialVec.x);
                    const rotatedAngle = angle.add(uTime.mul(uRotationSpeed).mul(0.12));
                    const normalizedRadius = clamp(radialDist.sub(130.0).div(320.0), 0.0, 1.0);

                    const turbUv = vec2(rotatedAngle.mul(2.0), normalizedRadius.mul(8.0));
                    const turb = tslFbm(turbUv.add(uTime.mul(0.1)), fbmOctaves);
                    const swirl = sin(rotatedAngle.mul(4.0).add(normalizedRadius.mul(12.0)).add(turb.mul(2.0)))
                        .mul(0.4).add(0.6);

                    // Add burst heating
                    const heating = uDopplerBoost.sub(1.0).mul(0.5);
                    const density = radialMask.mul(heightFalloff).mul(swirl.add(heating));

                    If(density.greaterThan(0.01), () => {
                        const temp = float(1.0).sub(pow(normalizedRadius, 0.6));
                        const innerColor = vec3(1.0, 0.8, 0.5);
                        const midColor = vec3(0.9, 0.35, 0.1);
                        const outerColor = vec3(0.4, 0.1, 0.05);

                        const lowMix = mix(outerColor, midColor, temp.mul(2.0));
                        const highMix = mix(midColor, innerColor, temp.sub(0.5).mul(2.0));
                        const color = mix(lowMix, highMix, step(0.5, temp)).toVar();

                        const tangent = normalize(cross(uDiskNormal, radialVec));
                        const dopplerFactor = dot(tangent, rd);

                        const blueShift = vec3(0.6, 0.7, 1.0);
                        const redShift = vec3(0.9, 0.2, 0.05);

                        // Scale the doppler color shift based on the boost
                        const appliedDoppler = dopplerFactor.mul(uDopplerBoost);
                        color.assign(mix(color, blueShift, max(0.0, appliedDoppler.mul(1.5))));
                        color.assign(mix(color, redShift, max(0.0, appliedDoppler.negate().mul(1.0))));

                        // Brighter white hot approaching side
                        const dopplerBright = float(1.0).add(appliedDoppler.mul(1.2));

                        accumColor.addAssign(color.mul(density).mul(dopplerBright).mul(0.05));
                    });
                });
            });
        }

        return vec4(accumColor, activeRay);
    });

    const result = baseColorFn();
    const accumColor = vec3(result.xyz);
    const activeRay = result.w;

    // Scale intensity
    const intensity = length(accumColor).mul(uIntensity);
    const finalColor = accumColor.mul(uIntensity);
    const finalAlpha = intensity.mul(activeRay);

    material.colorNode = finalColor;
    material.opacityNode = finalAlpha;
    material.emissiveNode = finalColor.mul(activeRay); // Kill emissive if absorbed

    material.userData = {
        uTime, uIntensity, uRotationSpeed, uCenter, uDiskNormal, uDopplerBoost, uEventHorizon,
    };

    return material;
}

export function createStarfieldNodeMaterial(params = {}) {
    const { isWebGPU = false, starCompute = null } = params;
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: NormalBlending,
    });
    material.sizeAttenuation = false;

    const uBlackHolePos = uniform(new Vector3(0, 0, 0));

    const aSize = attribute('instanceSize');
    const aTwinkle = attribute('instanceTwinkle');
    const aColor = attribute('instanceColor');
    const aPosition = attribute('instancePosition');

    const useGPU = Boolean(
        isWebGPU
        && starCompute?.getPositionBuffer
        && Number.isFinite(starCompute?.count),
    );
    const positionBuffer = useGPU
        ? storage(starCompute.getPositionBuffer(), 'vec4', starCompute.count)
        : null;

    const basePosition = Fn(() => {
        if (useGPU) {
            return positionBuffer.element(instanceIndex).xyz;
        }
        return aPosition;
    })();

    const starLuma = clamp(aTwinkle, float(0.55), float(1.0));

    material.positionNode = basePosition;
    const viewPos = modelViewMatrix.mul(vec4(basePosition, float(1.0)));
    const depth = max(float(1.0), viewPos.z.negate());

    const toCenter = vec3(basePosition.x, basePosition.y, basePosition.z).sub(uBlackHolePos);
    // Project to 2D for stretch calculation to keep visual effect consistent
    const distToCenter = length(vec2(toCenter.x, toCenter.y));
    const stretchZone = float(1.0).sub(smoothstep(float(260.0), float(760.0), distToCenter));
    const stretchFactor = float(1.0).add(stretchZone.mul(0.55));
    // Apparent size tracks each star's magnitude (aSize) so distant stars VARY — most stay
    // crisp ~1.7px pinpoints and only the bright few bloom to several px — instead of every
    // far star clamping to one uniform ~3px blob (which read as generic "twinkle" sprites).
    // sizeAttenuation is off (screen-space px); the depth term only adds mild near/far spread.
    const depthScale = clamp(float(4200.0).div(depth), float(0.55), float(1.35));
    const starPixels = aSize.mul(float(0.82)).mul(depthScale)
        .mul(float(1.0).add(stretchZone.mul(0.12)));
    material.sizeNode = clamp(starPixels, float(1.7), float(15.0));

    const center = uv().sub(0.5);
    const dir2d = normalize(toCenter.xy.add(vec2(0.0001, 0.0001)));
    const perp = vec2(dir2d.y.negate(), dir2d.x);
    const along = dot(center, dir2d);
    const across = dot(center, perp);
    const stretched = vec2(along, across.div(stretchFactor));
    const dist = length(stretched);
    const radial = max(float(0.0), float(1.0).sub(dist.mul(2.0)));
    // Sharper profile: a solid bright core with only a tight glint of halo, so stars read as
    // crisp distant pinpoints rather than soft fuzzy sparkles. The ~2x brightness that lets
    // stars survive the Extreme post pipeline (exposure 0.96 + ACES + a 0.5 vignette) now
    // lives mostly in the core term instead of a broad glow.
    const halo = pow(radial, float(2.6));
    const core = float(1.0).sub(smoothstep(float(0.0), float(0.26), dist));
    const alpha = clamp(
        halo.mul(0.24).add(core.mul(0.92)).mul(starLuma),
        float(0.0),
        float(1.0),
    );
    const color = mix(aColor, vec3(1.0, 1.0, 1.0), core.mul(0.12));

    material.colorNode = color.mul(float(0.95).add(starLuma.mul(0.4)));
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha.mul(0.5));

    material.userData = { uBlackHolePos };

    return material;
}

export function createHawkingRadiationNodeMaterial() {
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
    });

    const uTime = uniform(0);
    const uIntensity = uniform(1.0);

    const aSize = attribute('instanceSize');
    const aLifetime = attribute('instanceLifetime');
    const aColor = attribute('instanceColor');
    const aPosition = attribute('instancePosition');

    material.positionNode = aPosition;
    material.sizeNode = aSize;

    const center = uv().sub(0.5);
    const dist = length(center);
    const life = clamp(aLifetime, float(0.0), float(1.0));
    const flicker = sin(uTime.mul(3.0).add(life.mul(6.283))).mul(0.3).add(0.7);
    const alpha = max(float(0.0), float(1.0).sub(dist.mul(2.0))).mul(life).mul(flicker).mul(uIntensity);

    const colorBoost = float(1.0).add(float(1.0).sub(life).mul(0.6));
    material.colorNode = aColor.mul(colorBoost).mul(uIntensity);
    material.opacityNode = alpha.mul(0.85);
    material.emissiveNode = aColor.mul(colorBoost).mul(uIntensity);

    material.userData = { uTime, uIntensity };

    return material;
}

export function createPhotonSphereNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
    });
    material.forceSinglePass = true;

    const uTime = uniform(0);
    const uIntensity = uniform(1.0);
    const uEchoStrength = uniform(0.34);
    const uCausticStrength = uniform(0.0);

    // This material is used on a 620x620 billboard. Radius 120 therefore maps
    // to ~0.387 in the -1..1 UV domain; the primary photon orbit sits just
    // outside it, followed by progressively thinner/fainter echo images.
    const centered = uv().mul(2.0).sub(1.0);
    const radial = length(centered);
    const angle = atan(centered.y, centered.x);
    const causticWarp = sin(angle.mul(3.0).sub(uTime.mul(0.18))).mul(0.0018);
    const ringDistance = abs(radial.sub(float(0.435).add(causticWarp))).div(0.0085);
    const echoDistanceA = abs(radial.sub(float(0.476).sub(causticWarp.mul(0.7)))).div(0.0056);
    const echoDistanceB = abs(radial.sub(float(0.509).add(causticWarp.mul(0.45)))).div(0.0038);
    const primary = exp(ringDistance.mul(ringDistance).negate().mul(2.2));
    const echoA = exp(echoDistanceA.mul(echoDistanceA).negate().mul(2.1)).mul(uEchoStrength);
    const echoB = exp(echoDistanceB.mul(echoDistanceB).negate().mul(2.0)).mul(uEchoStrength).mul(0.38);
    // The core material owns the dominant critical curve. This billboard only
    // contributes the fainter higher-order images, so it must never read as a
    // stack of bright HUD circles.
    const ring = primary.mul(0.42).add(echoA.mul(0.75)).add(echoB);

    const shimmer = sin(angle.mul(19.0).sub(uTime.mul(1.8)))
        .mul(0.025)
        .add(0.975)
        .add(uCausticStrength.mul(pow(max(float(0.0), sin(angle.mul(3.0).add(uTime))), 8.0)).mul(0.55));

    const warm = vec3(1.16, 0.82, 0.48);
    const cool = vec3(0.52, 0.76, 1.18);
    const color = mix(warm, cool, smoothstep(float(0.43), float(0.515), radial));

    const intensity = ring.mul(shimmer).mul(uIntensity).clamp(0.0, 1.35);

    material.colorNode = color.mul(intensity);
    material.opacityNode = intensity;
    material.emissiveNode = color.mul(intensity);

    material.userData = {
        uTime, uIntensity, uEchoStrength, uCausticStrength,
    };

    return material;
}

export function createParticleNodeMaterial(params = {}) {
    const { isWebGPU = false, particleCompute = null } = params;
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
    });

    const aLifetime = attribute('instanceLifetime');
    const aSize = attribute('instanceSize');
    const aColor = attribute('instanceColor');
    const aPosition = attribute('instancePosition');
    const uBlackHolePos = uniform(new Vector3(0, 0, 0));
    const uEventBoost = uniform(1.0);

    const useGPU = Boolean(
        isWebGPU
        && particleCompute?.getPositionBuffer
        && particleCompute?.getLifeBuffer
        && particleCompute?.getMiscBuffer,
    );
    const positionBuffer = useGPU
        ? storage(particleCompute.getPositionBuffer(), 'vec4', particleCompute.count)
        : null;
    const lifeBuffer = useGPU
        ? storage(particleCompute.getLifeBuffer(), 'vec4', particleCompute.count)
        : null;
    const miscBuffer = useGPU
        ? storage(particleCompute.getMiscBuffer(), 'vec4', particleCompute.count)
        : null;

    const basePos = Fn(() => {
        if (useGPU) {
            return positionBuffer.element(instanceIndex).xyz;
        }
        return aPosition;
    })();

    const lifeValue = Fn(() => {
        if (useGPU) {
            return lifeBuffer.element(instanceIndex).x;
        }
        return aLifetime;
    })();

    const colorValue = Fn(() => {
        if (useGPU) {
            return lifeBuffer.element(instanceIndex).yzw;
        }
        return aColor;
    })();

    const sizeValue = Fn(() => {
        if (useGPU) {
            return miscBuffer.element(instanceIndex).x;
        }
        return aSize;
    })();

    material.positionNode = basePos.add(uBlackHolePos);
    material.sizeNode = sizeValue;

    const center = uv().sub(0.5);
    const dist = length(center);
    const life = min(float(1.0), lifeValue);
    const radial = max(float(0.0), float(1.0).sub(dist.mul(2.0)));
    const alpha = radial.mul(life);
    const glow = pow(radial, float(1.35));

    // Keep ambient particles concentrated around the tilted accretion torus while
    // allowing larger combo bursts to remain bright and readable.
    const rel = basePos;
    const cosTilt = float(DISK_COS_TILT);
    const sinTilt = float(DISK_SIN_TILT);
    const diskV = rel.y.mul(cosTilt).sub(rel.z.mul(sinTilt));
    const diskHeight = rel.y.mul(sinTilt).add(rel.z.mul(cosTilt));
    const torusRadius = length(vec2(rel.x, diskV));
    const planeOffset = abs(diskHeight);
    const radialMask = smoothstep(float(130.0), float(230.0), torusRadius)
        .mul(float(1.0).sub(smoothstep(float(780.0), float(1040.0), torusRadius)));
    const planeMask = float(1.0).sub(smoothstep(float(45.0), float(150.0), planeOffset));
    const torusMask = radialMask.mul(planeMask);
    const comboBypass = smoothstep(float(7.8), float(10.5), sizeValue);
    const visibility = mix(max(float(0.28), torusMask), float(1.0), comboBypass);

    const colorBoost = float(0.82).add(life.mul(0.18));
    const emissiveScale = float(0.28).add(life.mul(0.52));
    material.colorNode = colorValue.mul(colorBoost).mul(uEventBoost);
    material.opacityNode = alpha.mul(0.58).mul(visibility);
    material.emissiveNode = colorValue.mul(glow).mul(emissiveScale).mul(visibility).mul(uEventBoost);

    material.userData = { uBlackHolePos, uEventBoost };

    return material;
}

export function createNebulaCloudNodeMaterial(map, params = {}) {
    const { useInstanceColor = false } = params;
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
    });
    material.forceSinglePass = true;

    const texNode = map ? texture(map) : null;
    const sample = texNode ? texNode.sample(uv()) : vec4(1.0, 1.0, 1.0, 1.0);
    // NodeMaterial automatically multiplies colorNode by an InstancedMesh's
    // instanceColor. Explicitly requesting attribute('instanceColor') looked on
    // the base geometry, emitted a warning, and multiplied the tint twice.
    const colorValue = sample.rgb;

    material.colorNode = colorValue;
    // Nudged up for more presence: opacity 0.24->0.40, emissive 0.38->0.60 on the instanced
    // (theme) path. Additive, so both stack — a soft, visible backdrop haze, not a wash.
    const cloudOpacity = sample.a.mul(useInstanceColor ? 0.4 : 0.55);
    material.opacityNode = cloudOpacity;
    material.emissiveNode = colorValue.mul(cloudOpacity).mul(0.6);

    return material;
}

export function createLockRippleNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
    });
    material.forceSinglePass = true;

    const uProgress = uniform(1.0);
    const uIntensity = uniform(0.0);
    const uCompression = uniform(0.0);
    const centered = uv().sub(0.5);
    const dist = length(centered);
    const radius = mix(0.055, 0.46, pow(clamp(uProgress, 0.0, 1.0), 0.72));
    const width = mix(0.065, 0.012, uProgress);
    const ringDistance = abs(dist.sub(radius));
    const ring = float(1.0).sub(smoothstep(width, width.mul(2.2), ringDistance));
    const echoDistance = abs(dist.sub(radius.mul(0.76)));
    const echo = float(1.0).sub(smoothstep(width.mul(0.7), width.mul(1.8), echoDistance)).mul(0.34);
    const compression = exp(dist.mul(dist).mul(-38.0)).mul(uCompression);
    const fade = float(1.0).sub(smoothstep(0.68, 1.0, uProgress));
    const caustic = ring.add(echo).add(compression).mul(fade).mul(uIntensity);
    const color = mix(vec3(0.32, 0.68, 1.2), vec3(1.16, 0.72, 0.28), uProgress);

    material.colorNode = color.mul(caustic);
    material.opacityNode = caustic.clamp(0.0, 0.86);
    material.emissiveNode = color.mul(caustic);
    material.userData = { uProgress, uIntensity, uCompression };
    return material;
}

export function createMatterStreamNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
    });
    material.forceSinglePass = true;

    const uProgress = uniform(1.0);
    const uIntensity = uniform(0.0);
    const coord = uv();
    const across = abs(coord.y.sub(0.5));
    const width = mix(0.095, 0.018, coord.x);
    const filament = float(1.0).sub(smoothstep(width, width.mul(2.4), across));
    const headDistance = abs(coord.x.sub(clamp(uProgress, 0.0, 1.0)));
    const head = exp(headDistance.mul(headDistance).mul(-190.0));
    const tail = smoothstep(0.0, 0.15, coord.x)
        .mul(float(1.0).sub(smoothstep(uProgress, uProgress.add(0.22), coord.x)));
    const turbulence = mxNoiseFloat(
        vec2(coord.x.mul(13.0).sub(uProgress.mul(4.0)), coord.y.mul(8.0)),
        0.5,
        0.5,
    );
    const energy = filament
        .mul(head.mul(1.2).add(tail.mul(0.42)))
        .mul(float(0.72).add(turbulence.mul(0.28)))
        .mul(uIntensity);
    const color = mix(vec3(0.25, 0.62, 1.18), vec3(1.16, 0.82, 0.42), coord.x);

    material.colorNode = color.mul(energy);
    material.opacityNode = energy.clamp(0.0, 0.78);
    material.emissiveNode = color.mul(energy);
    material.userData = { uProgress, uIntensity };
    return material;
}

export function createPolarJetNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
    });
    material.forceSinglePass = true;

    const uTime = uniform(0);
    const uIntensity = uniform(0.0);
    const coord = uv().mul(2.0).sub(1.0);
    const axial = abs(coord.y);
    const taper = mix(0.026, 0.19, pow(axial, 0.72));
    const bendNoise = mxNoiseFloat(
        vec2(coord.y.mul(5.0), uTime.mul(0.11)),
        0.62,
    ).sub(0.5).mul(axial).mul(0.09);
    const lateral = abs(coord.x.sub(bendNoise));
    const core = exp(lateral.div(taper).mul(lateral.div(taper)).mul(-2.6));
    const launchFade = smoothstep(0.075, 0.22, axial);
    const lengthFade = launchFade.mul(float(1.0).sub(smoothstep(0.54, 0.98, axial)));
    const pulse = sin(axial.mul(21.0).sub(uTime.mul(4.2))).mul(0.11).add(0.89);
    const knots = mxNoiseFloat(
        vec2(coord.x.mul(5.0), coord.y.mul(8.0).sub(uTime.mul(0.18))),
        0.48,
    ).mul(0.28).add(0.72);
    const energy = core.mul(lengthFade).mul(pulse).mul(knots).mul(uIntensity);
    const color = mix(vec3(0.92, 0.34, 0.12), vec3(0.28, 0.57, 1.06), step(0.0, coord.y));

    material.colorNode = color.mul(energy);
    material.opacityNode = energy.mul(0.58).clamp(0.0, 0.62);
    material.emissiveNode = color.mul(energy);
    material.userData = { uTime, uIntensity };
    return material;
}

export function createEventHorizonNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        transparent: false,
    });

    const black = vec3(0.0, 0.0, 0.0);
    material.colorNode = black;
    material.emissiveNode = black;

    return material;
}

export function createBurstSparkNodeMaterial(params = {}) {
    const { isWebGPU = false, burstCompute = null } = params;
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        alphaTest: 0.015,
    });

    const useGPU = Boolean(
        isWebGPU
        && burstCompute?.getPositionBuffer
        && burstCompute?.getAngleBuffer
        && burstCompute?.getLifeBuffer
        && burstCompute?.getMiscBuffer,
    );

    const positionBuffer = useGPU
        ? storage(burstCompute.getPositionBuffer(), 'vec4', burstCompute.count)
        : null;
    const angleBuffer = useGPU
        ? storage(burstCompute.getAngleBuffer(), 'vec4', burstCompute.count)
        : null;
    const lifeBuffer = useGPU
        ? storage(burstCompute.getLifeBuffer(), 'vec4', burstCompute.count)
        : null;
    const miscBuffer = useGPU
        ? storage(burstCompute.getMiscBuffer(), 'vec4', burstCompute.count)
        : null;

    const uPulseTimer = uniform(-100.0);
    const uBlackHolePos = uniform(new Vector3(0, 0, 0));

    const aTheta = useGPU ? null : attribute('instanceTheta');
    const aPhi = useGPU ? null : attribute('instancePhi');
    const aRandom = useGPU ? null : attribute('instanceRandom');
    const aColor = useGPU ? null : attribute('instanceColor');

    // The shipping path is a compact analytic wave: every spark derives its
    // trajectory from static attributes and one clock uniform. This preserves
    // the explosive silhouette without a per-frame storage-buffer dispatch.
    const stagger = useGPU ? null : aRandom.mul(0.14);
    const localTime = useGPU ? null : uPulseTimer.sub(stagger);
    const active = useGPU ? null : step(float(0.0), localTime).mul(step(float(-50.0), uPulseTimer));

    const life = useGPU ? null : clamp(localTime.div(1.35), float(0.0), float(1.0));
    const explosionProgress = useGPU ? null : clamp(life.div(float(0.62)), float(0.0), float(1.0));
    const floatProgress = useGPU ? null : clamp(life.sub(float(0.5)).div(float(0.5)), float(0.0), float(1.0));
    const easeOut = useGPU ? null : float(1.0).sub(pow(float(1.0).sub(explosionProgress), float(2.2)));
    const startRadius = float(105.0);
    const maxRadius = useGPU ? null : float(720.0).add(aRandom.mul(480.0));
    const explosionRadius = useGPU ? null : startRadius.add(maxRadius.sub(startRadius).mul(easeOut));

    const spiralAngle = useGPU ? null : aTheta.add(life.mul(1.5).mul(aRandom.sub(0.5)));
    const driftAmt = useGPU ? null : maxRadius.mul(0.08);
    const driftDiskX = useGPU ? null : cos(aRandom.mul(float(6.2832)).add(life.mul(float(2.1))))
        .mul(driftAmt).mul(floatProgress);
    const driftDiskY = useGPU ? null : sin(aRandom.mul(float(9.4248)).add(life.mul(float(1.8))))
        .mul(driftAmt).mul(floatProgress);
    // Disk tilt constants — rotate disk-local XZ positions to world space
    const burstCosTilt = float(DISK_COS_TILT);
    const burstSinTilt = float(DISK_SIN_TILT);

    const hidden = vec3(0.0, 0.0, -9999.0);

    const positionNode = Fn(() => {
        if (useGPU) {
            const activeNode = positionBuffer.element(instanceIndex).w;
            const pos = positionBuffer.element(instanceIndex).xyz;
            const worldPos = pos.add(uBlackHolePos);
            return mix(hidden, worldPos, activeNode);
        }
        // Burst expands in the disk plane (disk lies in XZ before rotation)
        const diskX = explosionRadius.mul(cos(spiralAngle)).add(driftDiskX);
        const diskY = explosionRadius.mul(sin(spiralAngle)).add(driftDiskY);
        const diskH = explosionRadius.mul(aPhi.sub(float(1.5708)).mul(float(0.04)));
        // Rotate by disk tilt (-PI * 0.42 around X) to match accretion disk
        const x = diskX.add(uBlackHolePos.x);
        const y = diskY.mul(burstCosTilt).add(diskH.mul(burstSinTilt)).add(uBlackHolePos.y);
        const z = diskY.mul(burstSinTilt).negate().add(diskH.mul(burstCosTilt)).add(uBlackHolePos.z);
        const position = vec3(x, y, z);
        return mix(hidden, position, active);
    })();

    material.positionNode = positionNode;

    const lifeValue = Fn(() => {
        if (useGPU) {
            return lifeBuffer.element(instanceIndex).x;
        }
        return life;
    })();

    const randomValue = Fn(() => {
        if (useGPU) {
            return angleBuffer.element(instanceIndex).z;
        }
        return aRandom;
    })();

    const baseSize = Fn(() => {
        if (useGPU) {
            return miscBuffer.element(instanceIndex).x;
        }
        return float(3.0).add(aRandom.mul(4.0));
    })();

    const sizeLife = float(1.0).sub(lifeValue.mul(0.6));
    // Cosmic-noir-style depth attenuation. sizeAttenuation is off, so sizeNode is in raw pixels;
    // dividing by view-space depth shrinks the far half of the explosion (a real fill saving now the
    // buffer is an order of magnitude larger) and adds a genuine depth cue, while the clamp bounds the
    // near field so a spark passing close to the camera can't balloon into a fill spike. K≈1045 keeps a
    // spark at the black hole's ~1045-unit camera distance at its former pixel size, so the overall
    // scale reads the same — only the depth spread is new. Inactive sparks are alpha-0 regardless.
    const burstViewPos = modelViewMatrix.mul(vec4(positionNode, float(1.0)));
    const burstDepth = max(float(1.0), burstViewPos.z.negate());
    material.sizeNode = clamp(
        baseSize.mul(sizeLife).mul(float(1045.0)).div(burstDepth),
        float(2.0),
        float(20.0),
    );

    const center = uv().sub(0.5);
    const dist = length(center);
    let glow = max(float(0.0), float(1.0).sub(dist.mul(2.0)));
    glow = pow(glow, float(1.3));

    const core = float(1.0).sub(smoothstep(float(0.0), float(0.3), dist));
    const baseColor = Fn(() => {
        if (useGPU) {
            return lifeBuffer.element(instanceIndex).yzw;
        }
        return aColor;
    })();
    const coreColor = mix(baseColor, vec3(1.0, 1.0, 0.95), core.mul(0.5));

    const activeValue = Fn(() => {
        if (useGPU) {
            return positionBuffer.element(instanceIndex).w;
        }
        return active;
    })();

    const fadeCurve = float(1.0).sub(smoothstep(float(0.58), float(1.0), lifeValue));
    const alpha = glow
        .mul(fadeCurve)
        .mul(float(0.66).add(randomValue.mul(0.16)))
        .mul(activeValue);

    material.colorNode = coreColor.mul(glow);
    material.opacityNode = alpha;
    material.emissiveNode = coreColor.mul(alpha);

    material.userData = { uPulseTimer, uBlackHolePos };

    return material;
}
