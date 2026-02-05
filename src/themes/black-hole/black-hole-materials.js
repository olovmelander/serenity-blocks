import {
    AdditiveBlending,
    DoubleSide,
    MeshBasicNodeMaterial,
    NormalBlending,
    PointsNodeMaterial,
    Vector2,
} from 'three/webgpu';
import {
    Fn,
    atan,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    instanceIndex,
    length,
    max,
    min,
    mix,
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

    const eventHorizon = float(0.25).mul(uScale);
    const photonSphere = float(0.4).mul(uScale);
    const photonWidth = float(0.08);

    const black = smoothstep(eventHorizon.add(0.02), eventHorizon.sub(0.02), dist);

    const photonDist = dist.sub(photonSphere).div(photonWidth);
    const photonRing = exp(photonDist.mul(photonDist).negate()).mul(uIntensity);

    const shimmerCoord = uvCoord.mul(8.0).add(uTime.mul(0.5));
    const shimmer = tslFbm(shimmerCoord, 5).mul(0.3);
    const shimmerMask = smoothstep(float(0.5), float(0.3), dist).mul(float(1.0).sub(black));
    const photonRingWithShimmer = photonRing.add(shimmer.mul(shimmerMask));

    const orangeColor = vec3(1.0, 0.6, 0.2);
    const whiteColor = vec3(1.0, 1.0, 1.0);
    const blueColor = vec3(0.4, 0.6, 1.0);

    let photonColor = mix(orangeColor, whiteColor, photonRingWithShimmer);
    photonColor = mix(photonColor, blueColor, smoothstep(float(0.35), float(0.5), dist).mul(0.3));

    let color = photonColor.mul(photonRingWithShimmer).mul(uIntensity);
    color = mix(color, vec3(0.0, 0.0, 0.0), black);

    const alpha = photonRingWithShimmer.mul(float(1.0).sub(black)).add(black.mul(0.95));

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color;

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

export function createVolumetricAccretionDiskNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
    });

    const uTime = uniform(0);
    const uIntensity = uniform(0.35);
    const uRotationSpeed = uniform(1.0);
    const uCenter = uniform(new Vector2(0, 0));

    const worldPos = positionWorld;
    const viewDir = normalize(worldPos.sub(cameraPosition));
    const normal = normalize(normalWorld);

    const center = vec3(uCenter.x, uCenter.y, float(0.0));
    const baseToCenter = worldPos.sub(center);
    const baseHeight = dot(baseToCenter, normal);
    const baseRadial = baseToCenter.sub(normal.mul(baseHeight));
    const baseRadialDist = length(baseRadial);
    const baseAngle = atan(baseRadial.y, baseRadial.x);

    const innerRadius = float(140.0);
    const outerRadius = float(400.0);
    const thickness = float(50.0);
    const steps = 10;
    const stepSize = thickness.div(float(steps));

    let accum = float(0.0);
    for (let i = 0; i < steps; i += 1) {
        const offset = float(i).sub(float(steps - 1).mul(0.5)).mul(stepSize);
        const samplePos = worldPos.add(viewDir.mul(offset));
        const toCenter = samplePos.sub(center);
        const height = dot(toCenter, normal);
        const radialVec = toCenter.sub(normal.mul(height));
        const radial = length(radialVec);

        const radialMask = smoothstep(innerRadius, innerRadius.add(30.0), radial)
            .mul(float(1.0).sub(smoothstep(outerRadius.sub(40.0), outerRadius, radial)));
        const heightFalloff = exp(height.mul(height).negate().mul(0.02));
        const swirl = sin(atan(radialVec.y, radialVec.x).mul(6.0).add(uTime.mul(uRotationSpeed).mul(0.8)))
            .mul(0.4)
            .add(0.6);

        accum = accum.add(radialMask.mul(heightFalloff).mul(swirl));
    }

    const radialT = clamp(baseRadialDist.div(outerRadius), float(0.0), float(1.0));
    let baseColor = mix(vec3(1.0, 0.9, 0.7), vec3(0.8, 0.35, 0.1), radialT);
    const doppler = sin(baseAngle).mul(0.15);
    baseColor = mix(baseColor, vec3(0.6, 0.7, 1.0), max(float(0.0), doppler));
    baseColor = mix(baseColor, vec3(0.9, 0.2, 0.05), max(float(0.0), doppler.negate()));

    const intensity = accum.mul(uIntensity).mul(0.18);

    material.colorNode = baseColor.mul(intensity);
    material.opacityNode = intensity;
    material.emissiveNode = baseColor.mul(intensity);

    material.userData = { uTime, uIntensity, uRotationSpeed, uCenter };

    return material;
}

export function createStarfieldNodeMaterial(params = {}) {
    const { isWebGPU = false, starCompute = null } = params;
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
    });

    const uTime = uniform(0);
    const uFlashIntensity = uniform(0);
    const uBlackHolePos = uniform(new Vector2(0, 0));

    const aSize = attribute('instanceSize');
    const aPhase = attribute('instancePhase');
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

    const twinkle = sin(uTime.mul(2.0).add(aPhase)).mul(0.3).add(0.7);
    const flash = float(1.0).add(uFlashIntensity);

    material.positionNode = basePosition;
    const toCenter = vec2(basePosition.x, basePosition.y).sub(uBlackHolePos);
    const distToCenter = length(toCenter);
    const stretchZone = smoothstep(float(600.0), float(180.0), distToCenter);
    const stretchFactor = float(1.0).add(stretchZone.mul(1.2));
    material.sizeNode = aSize.mul(float(1.0).add(stretchZone.mul(0.6)));

    const center = uv().sub(0.5);
    const dir2d = normalize(toCenter.add(vec2(0.0001, 0.0001)));
    const perp = vec2(dir2d.y.negate(), dir2d.x);
    const along = dot(center, dir2d);
    const across = dot(center, perp);
    const stretched = vec2(along, across.div(stretchFactor));
    const dist = length(stretched);
    const alpha = max(float(0.0), float(1.0).sub(dist.mul(2.0))).mul(twinkle).mul(flash);

    material.colorNode = aColor.mul(flash);
    material.opacityNode = alpha;
    material.emissiveNode = aColor.mul(flash);

    material.userData = { uTime, uFlashIntensity, uBlackHolePos };

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

    material.positionNode = basePos;
    material.sizeNode = sizeValue;

    const center = uv().sub(0.5);
    const dist = length(center);
    const life = min(float(1.0), lifeValue);
    const alpha = max(float(0.0), float(1.0).sub(dist.mul(2.0))).mul(life);

    const colorBoost = float(1.0).add(float(1.0).sub(life).mul(0.5));
    material.colorNode = colorValue.mul(colorBoost);
    material.opacityNode = alpha.mul(0.8);
    material.emissiveNode = colorValue.mul(colorBoost);

    material.userData = {};

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
    const uBlackHolePos = uniform(new Vector2(0, 0));

    const aTheta = useGPU ? null : attribute('instanceTheta');
    const aPhi = useGPU ? null : attribute('instancePhi');
    const aRandom = useGPU ? null : attribute('instanceRandom');
    const aColor = useGPU ? null : attribute('instanceColor');

    const stagger = useGPU ? null : aRandom.mul(3.0);
    const localTime = useGPU ? null : uPulseTimer.sub(stagger);
    const active = useGPU ? null : step(float(0.0), localTime).mul(step(float(-50.0), uPulseTimer));

    const life = useGPU ? null : clamp(localTime.div(45.0), float(0.0), float(1.0));
    const easeOut = useGPU ? null : float(1.0).sub(pow(float(1.0).sub(life), float(3.0)));
    const startRadius = float(120.0);
    const maxRadius = useGPU ? null : float(900.0).add(aRandom.mul(500.0));
    const radius = useGPU ? null : startRadius.add(maxRadius.sub(startRadius).mul(easeOut));

    const sinPhi = useGPU ? null : sin(aPhi);
    const spiralAngle = useGPU ? null : aTheta.add(life.mul(3.0).mul(aRandom.sub(0.5)));

    const hidden = vec3(0.0, 0.0, -9999.0);

    const positionNode = Fn(() => {
        if (useGPU) {
            const activeNode = angleBuffer.element(instanceIndex).w;
            const pos = positionBuffer.element(instanceIndex).xyz;
            return mix(hidden, pos, activeNode);
        }
        const x = radius.mul(sinPhi).mul(cos(spiralAngle)).add(uBlackHolePos.x);
        const y = radius.mul(sinPhi).mul(sin(spiralAngle)).add(uBlackHolePos.y);
        const z = radius.mul(cos(aPhi));
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

    const alpha = glow
        .mul(float(1.0).sub(lifeValue.mul(lifeValue)))
        .mul(float(0.9).add(randomValue.mul(0.1)))
        .mul(activeValue);

    material.colorNode = coreColor.mul(glow);
    material.opacityNode = alpha;
    material.emissiveNode = coreColor.mul(alpha);

    material.userData = { uPulseTimer, uBlackHolePos };

    return material;
}
