import {
    AdditiveBlending,
    BackSide,
    DoubleSide,
    MeshBasicNodeMaterial,
    NormalBlending,
    PointsNodeMaterial,
    Vector2,
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
    floor,
    fract,
    Fn,
    If,
    instanceIndex,
    length,
    max,
    min,
    mix,
    modelViewMatrix,
    normalize,
    normalWorld,
    pow,
    positionWorld,
    positionLocal,
    sin,
    smoothstep,
    step,
    storage,
    texture,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

function tslHash(p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
}

function tslNoise(p) {
    const i = floor(p);
    const f = fract(p);
    const smoothF = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));

    const a = tslHash(i);
    const b = tslHash(i.add(vec2(1.0, 0.0)));
    const c = tslHash(i.add(vec2(0.0, 1.0)));
    const d = tslHash(i.add(vec2(1.0, 1.0)));

    return mix(mix(a, b, smoothF.x), mix(c, d, smoothF.x), smoothF.y);
}

function tslFbm(p, octaves = 5) {
    let v = float(0.0);
    let a = float(0.5);
    let coord = p;
    for (let i = 0; i < octaves; i += 1) {
        v = v.add(a.mul(tslNoise(coord)));
        coord = coord.mul(2.0);
        a = a.mul(0.5);
    }
    return v;
}

export function createBlackHoleCoreNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
        blending: AdditiveBlending,
    });

    const uTime = uniform(0);
    const uIntensity = uniform(1.0);
    const uScale = uniform(1.0);

    const uvCoord = uv().mul(2.0).sub(1.0);
    const dist = length(uvCoord);

    // Event Horizon scale - tight black circle
    const eventHorizon = float(0.22).mul(uScale);
    // Photon sphere is extremely narrow and bright
    const photonSphere = float(0.26).mul(uScale);
    const photonWidth = float(0.015);

    // Very sharp edge for the event horizon
    const black = smoothstep(eventHorizon.add(0.005), eventHorizon.sub(0.005), dist);

    // Intense, physically sharp exponential falloff for the photon ring
    const photonDist = clamp(dist.sub(photonSphere), float(0.0), float(1.0)).div(photonWidth);
    const photonRing = exp(photonDist.mul(photonDist).negate().mul(3.0)).mul(uIntensity).mul(2.5);

    const shimmerCoord = uvCoord.mul(12.0).add(uTime.mul(0.8));
    const shimmer = tslFbm(shimmerCoord, 5).mul(0.4);

    // Mask shimmer exactly to the photon ring
    const shimmerMask = smoothstep(float(0.4), float(0.22), dist).mul(float(1.0).sub(black));
    const photonRingWithShimmer = photonRing.add(shimmer.mul(shimmerMask).mul(uIntensity));

    const orangeColor = vec3(1.0, 0.6, 0.2);
    const whiteColor = vec3(1.4, 1.4, 1.4); // Overblown white hot
    const blueColor = vec3(0.5, 0.7, 1.0);

    let photonColor = mix(orangeColor, whiteColor, photonRingWithShimmer.mul(0.5));
    photonColor = mix(photonColor, blueColor, smoothstep(float(0.28), float(0.45), dist).mul(0.4));

    let color = photonColor.mul(photonRingWithShimmer);
    color = mix(color, vec3(0.0, 0.0, 0.0), black);

    const alpha = clamp(photonRingWithShimmer.mul(float(1.0).sub(black)).add(black), float(0.0), float(1.0));

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color; // Additive emissive

    material.userData = { uTime, uIntensity, uScale };

    return material;
}

export function createAccretionDiskNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
        blending: NormalBlending,
    });

    const uTime = uniform(0);
    const uIntensity = uniform(1.0);
    const uRotationSpeed = uniform(1.0);

    const pos = positionLocal;
    const angle = atan(pos.z, pos.x);
    const radius = length(vec2(pos.x, pos.z));

    const innerRadius = float(120.0);
    const outerRadius = float(400.0);
    const normalizedRadius = clamp(radius.sub(innerRadius).div(outerRadius.sub(innerRadius)), float(0.0), float(1.0));

    const rotatedAngle = angle.add(uTime.mul(uRotationSpeed).mul(0.15));

    const turbUv = vec2(rotatedAngle.mul(2.0), normalizedRadius.mul(8.0));
    const turb = tslFbm(turbUv.add(uTime.mul(0.1)), 5);

    const spirals = sin(rotatedAngle.mul(3.0).add(normalizedRadius.mul(15.0)).add(turb.mul(3.0)));
    const spiralFactor = spirals.mul(0.3).add(0.7);

    const temp = float(1.0).sub(pow(normalizedRadius, float(0.5)));

    const innerColor = vec3(1.0, 0.7, 0.4);
    const midColor = vec3(0.9, 0.4, 0.15);
    const outerColor = vec3(0.5, 0.15, 0.08);

    const lowMix = mix(outerColor, midColor, temp.mul(2.0));
    const highMix = mix(midColor, innerColor, temp.sub(0.5).mul(2.0));
    let baseColor = mix(lowMix, highMix, step(float(0.5), temp));

    baseColor = baseColor.mul(float(0.8).add(turb.mul(0.4)));

    const doppler = sin(angle).mul(0.15);
    const blueShift = vec3(0.6, 0.7, 1.0);
    const redShift = vec3(0.9, 0.2, 0.05);
    baseColor = mix(baseColor, blueShift, max(float(0.0), doppler));
    baseColor = mix(baseColor, redShift, max(float(0.0), doppler.negate()));

    const brightness = float(0.4)
        .add(spiralFactor.mul(0.3))
        .add(turb.mul(0.2))
        .mul(uIntensity)
        .mul(0.6);

    const innerFade = smoothstep(float(0.0), float(0.25), normalizedRadius);
    const outerFade = smoothstep(float(1.0), float(0.7), normalizedRadius);
    const edgeFade = innerFade.mul(outerFade);

    material.colorNode = baseColor.mul(brightness);
    material.opacityNode = edgeFade.mul(brightness).mul(0.7);
    material.emissiveNode = baseColor.mul(brightness);

    material.userData = { uTime, uIntensity, uRotationSpeed };

    return material;
}

export function createVolumetricAccretionDiskNodeMaterial(diskNormal) {
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

        const steps = 36;
        const stepSize = float(18.0);

        const accumColor = vec3(0.0).toVar();
        const activeRay = float(1.0).toVar();

        const gravStrength = float(2600.0);

        for (let i = 0; i < steps; i++) {
            const toCenter = uCenter.sub(ro);
            const distSq = dot(toCenter, toCenter);
            const dist = pow(distSq, 0.5);

            If(dist.lessThan(uEventHorizon), () => {
                activeRay.assign(0.0);
                // break equivalent in TSL is handled by condition inside the loop but we can't easily break from a js for-loop emitting nodes.
                // We'll just stop accumulating by zeroing activeRay and using it as a multiplier.
            });

            // Only accumulate if we haven't hit the event horizon
            If(activeRay.greaterThan(0.0), () => {
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
                        const turb = tslFbm(turbUv.add(uTime.mul(0.1)), 5);
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

    material.userData = { uTime, uIntensity, uRotationSpeed, uCenter, uDiskNormal, uDopplerBoost, uEventHorizon };

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

    const starLuma = clamp(aTwinkle, float(0.4), float(0.9));

    material.positionNode = basePosition;
    const viewPos = modelViewMatrix.mul(vec4(basePosition, float(1.0)));
    const depth = max(float(1.0), viewPos.z.negate());

    const toCenter = vec3(basePosition.x, basePosition.y, basePosition.z).sub(uBlackHolePos);
    // Project to 2D for stretch calculation to keep visual effect consistent
    const distToCenter = length(vec2(toCenter.x, toCenter.y));
    const stretchZone = smoothstep(float(760.0), float(260.0), distToCenter);
    const stretchFactor = float(1.0).add(stretchZone.mul(0.55));
    material.sizeNode = min(
        float(15.0),
        max(
            float(2.6),
            aSize.mul(float(1200.0)).div(depth).mul(float(1.0).add(stretchZone.mul(0.12))),
        ),
    );

    const center = uv().sub(0.5);
    const dir2d = normalize(toCenter.add(vec2(0.0001, 0.0001)));
    const perp = vec2(dir2d.y.negate(), dir2d.x);
    const along = dot(center, dir2d);
    const across = dot(center, perp);
    const stretched = vec2(along, across.div(stretchFactor));
    const dist = length(stretched);
    const radial = max(float(0.0), float(1.0).sub(dist.mul(2.0)));
    const halo = pow(radial, float(1.9));
    const core = smoothstep(float(0.2), float(0.0), dist);
    const alpha = halo.mul(0.26).add(core.mul(0.42)).mul(starLuma);
    const color = mix(aColor, vec3(1.0, 1.0, 1.0), core.mul(0.08));

    material.colorNode = color.mul(float(0.68).add(starLuma.mul(0.22)));
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha.mul(0.28));

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

    const uTime = uniform(0);
    const uIntensity = uniform(1.0);

    const centered = uv().sub(0.5);
    const radial = length(centered);
    const ringCenter = float(0.42);
    const ringWidth = float(0.06);
    const ringDist = radial.sub(ringCenter).div(ringWidth);
    const ring = exp(ringDist.mul(ringDist).negate());

    const shimmer = sin(uTime.mul(2.0).add(centered.x.mul(12.0)).add(centered.y.mul(7.0)))
        .mul(0.2)
        .add(0.85);

    const warm = vec3(1.0, 0.85, 0.6);
    const cool = vec3(0.6, 0.75, 1.0);
    const color = mix(warm, cool, smoothstep(float(0.35), float(0.55), radial));

    const intensity = ring.mul(shimmer).mul(uIntensity);

    material.colorNode = color.mul(intensity);
    material.opacityNode = intensity;
    material.emissiveNode = color.mul(intensity);

    material.userData = { uTime, uIntensity };

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
    const cosTilt = float(0.2486898871648548); // cos(-Math.PI * 0.42)
    const sinTilt = float(-0.9685831611286311); // sin(-Math.PI * 0.42)
    const localY = rel.y.mul(cosTilt).add(rel.z.mul(sinTilt));
    const localZ = rel.z.mul(cosTilt).sub(rel.y.mul(sinTilt));
    const torusRadius = length(vec2(rel.x, localZ));
    const planeOffset = max(localY, localY.negate());
    const radialMask = smoothstep(float(130.0), float(230.0), torusRadius)
        .mul(float(1.0).sub(smoothstep(float(780.0), float(1040.0), torusRadius)));
    const planeMask = float(1.0).sub(smoothstep(float(45.0), float(150.0), planeOffset));
    const torusMask = radialMask.mul(planeMask);
    const comboBypass = smoothstep(float(7.8), float(10.5), sizeValue);
    const visibility = mix(max(float(0.28), torusMask), float(1.0), comboBypass);

    const colorBoost = float(0.82).add(life.mul(0.18));
    const emissiveScale = float(0.28).add(life.mul(0.52));
    material.colorNode = colorValue.mul(colorBoost);
    material.opacityNode = alpha.mul(0.58).mul(visibility);
    material.emissiveNode = colorValue.mul(glow).mul(emissiveScale).mul(visibility);

    material.userData = { uBlackHolePos };

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

    const texNode = map ? texture(map) : null;
    const sample = texNode ? texNode.sample(uv()) : vec4(1.0, 1.0, 1.0, 1.0);
    const instanceColor = useInstanceColor ? attribute('instanceColor') : null;
    const colorValue = useInstanceColor ? sample.rgb.mul(instanceColor) : sample.rgb;

    material.colorNode = colorValue;
    material.opacityNode = sample.a;
    material.emissiveNode = colorValue.mul(sample.a);

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

    const stagger = useGPU ? null : aRandom.mul(3.0);
    const localTime = useGPU ? null : uPulseTimer.sub(stagger);
    const active = useGPU ? null : step(float(0.0), localTime).mul(step(float(-50.0), uPulseTimer));

    const life = useGPU ? null : clamp(localTime.div(120.0), float(0.0), float(1.0));
    const explosionProgress = useGPU ? null : clamp(life.div(float(0.4)), float(0.0), float(1.0));
    const floatProgress = useGPU ? null : clamp(life.sub(float(0.4)).div(float(0.6)), float(0.0), float(1.0));
    const easeOut = useGPU ? null : float(1.0).sub(pow(float(1.0).sub(explosionProgress), float(2.5)));
    const startRadius = float(120.0);
    const maxRadius = useGPU ? null : float(900.0).add(aRandom.mul(700.0));
    const explosionRadius = useGPU ? null : startRadius.add(maxRadius.sub(startRadius).mul(easeOut));

    const spiralAngle = useGPU ? null : aTheta.add(life.mul(1.5).mul(aRandom.sub(0.5)));
    const driftAmt = useGPU ? null : maxRadius.mul(0.12);
    const driftX = useGPU ? null : cos(aRandom.mul(float(6.2832)).add(life.mul(float(2.5)))).mul(driftAmt).mul(floatProgress);
    const driftY = useGPU ? null : sin(aRandom.mul(float(9.4248)).add(life.mul(float(1.8)))).mul(driftAmt).mul(floatProgress);

    const hidden = vec3(0.0, 0.0, -9999.0);

    const positionNode = Fn(() => {
        if (useGPU) {
            const activeNode = angleBuffer.element(instanceIndex).w;
            const pos = positionBuffer.element(instanceIndex).xyz;
            return mix(hidden, pos, activeNode);
        }
        const x = explosionRadius.mul(cos(spiralAngle)).add(driftX).add(uBlackHolePos.x);
        const y = explosionRadius.mul(sin(spiralAngle)).add(driftY).add(uBlackHolePos.y);
        const z = explosionRadius.mul(aPhi.sub(float(1.5708)).mul(float(0.04))).add(uBlackHolePos.z);
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
        return float(5.0).add(aRandom.mul(8.0));
    })();

    const sizeLife = float(1.0).sub(lifeValue.mul(0.6));
    material.sizeNode = baseSize.mul(sizeLife);

    const center = uv().sub(0.5);
    const dist = length(center);
    let glow = max(float(0.0), float(1.0).sub(dist.mul(2.0)));
    glow = pow(glow, float(1.3));

    const core = smoothstep(float(0.3), float(0.0), dist);
    const baseColor = Fn(() => {
        if (useGPU) {
            return lifeBuffer.element(instanceIndex).yzw;
        }
        return aColor;
    })();
    const coreColor = mix(baseColor, vec3(1.0, 1.0, 0.95), core.mul(0.5));

    const activeValue = Fn(() => {
        if (useGPU) {
            return angleBuffer.element(instanceIndex).w;
        }
        return active;
    })();

    // Hold full brightness through float phase, fade only in last 20%
    const fadeCurve = float(1.0).sub(smoothstep(float(0.8), float(1.0), lifeValue));
    const alpha = glow
        .mul(fadeCurve)
        .mul(float(0.9).add(randomValue.mul(0.1)))
        .mul(activeValue);

    material.colorNode = coreColor.mul(glow);
    material.opacityNode = alpha;
    material.emissiveNode = coreColor.mul(alpha);

    material.userData = { uPulseTimer, uBlackHolePos };

    return material;
}
