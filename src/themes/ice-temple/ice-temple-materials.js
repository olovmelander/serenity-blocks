/**
 * Ice Temple Theme - Material Factories
 * Dual render path: WebGPU TSL node materials + WebGL shader/material fallback.
 */

import * as THREE from 'three';
import {
    auroraVertexShader,
    auroraFragmentShader,
    snowVertexShader,
    snowFragmentShader,
    iceShardVertexShader,
    iceShardFragmentShader,
    shockwaveVertexShader,
    shockwaveFragmentShader,
} from './ice-temple-shaders.js';

const WEBGPU_MODULE_PATH = 'three/webgpu';
const TSL_MODULE_PATH = 'three/tsl';

let materialRuntime = null;
let materialRuntimePromise = null;

function setMaterialUniforms(material, uniforms = {}, extra = {}) {
    material.userData = {
        ...(material.userData || {}),
        uniforms,
        ...extra,
    };
    return { material, uniforms };
}

export async function initIceTempleMaterialRuntime() {
    if (materialRuntime) return materialRuntime;
    if (!materialRuntimePromise) {
        materialRuntimePromise = Promise.all([
            import(WEBGPU_MODULE_PATH),
            import(TSL_MODULE_PATH),
        ]).then(([WEBGPU, TSL]) => {
            materialRuntime = { WEBGPU, TSL };
            return materialRuntime;
        }).catch((error) => {
            materialRuntimePromise = null;
            throw error;
        });
    }
    return materialRuntimePromise;
}

function requireMaterialRuntime() {
    if (!materialRuntime) {
        throw new Error('IceTemple material runtime not initialized. Call initIceTempleMaterialRuntime() first.');
    }
    return materialRuntime;
}

export function createAuroraMaterialWebGL(params = {}) {
    const uniforms = {
        uTime: params.uTime ?? { value: 0 },
        uIntensity: params.uIntensity ?? { value: 0.8 },
        uColor1: { value: params.color1 ?? new THREE.Color(0x74b9ff) },
        uColor2: { value: params.color2 ?? new THREE.Color(0x55efc4) },
        uColor3: { value: params.color3 ?? new THREE.Color(0xa29bfe) },
    };

    const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: auroraVertexShader,
        fragmentShader: auroraFragmentShader,
        transparent: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    return setMaterialUniforms(material, uniforms, { emitsBloom: true, mrtRole: 'aurora' });
}

export function createAuroraMaterialWebGPU(params = {}) {
    const { WEBGPU, TSL } = requireMaterialRuntime();
    const {
        uniform,
        uv,
        positionLocal,
        vec3,
        sin,
        mix,
        smoothstep,
        clamp,
    } = TSL;

    const material = new WEBGPU.MeshBasicNodeMaterial();
    material.transparent = true;
    material.side = WEBGPU.DoubleSide;
    material.blending = WEBGPU.AdditiveBlending;
    material.depthWrite = false;

    const uTime = uniform(params.time ?? 0);
    const uIntensity = uniform(params.intensity ?? 0.8);
    const uColor1 = uniform(params.color1 ?? new THREE.Color(0x74b9ff));
    const uColor2 = uniform(params.color2 ?? new THREE.Color(0x55efc4));
    const uColor3 = uniform(params.color3 ?? new THREE.Color(0xa29bfe));

    const auroraUv = uv();
    const wave = sin(positionLocal.x.mul(0.5).add(uTime))
        .mul(sin(positionLocal.y.mul(0.3).add(uTime.mul(0.7))));
    const xOffset = sin(positionLocal.y.mul(0.2).add(uTime.mul(0.5))).mul(1.5);
    material.positionNode = vec3(
        positionLocal.x.add(xOffset),
        positionLocal.y,
        positionLocal.z.add(wave.mul(2.0)),
    );

    const flow = sin(auroraUv.x.mul(6.0).add(uTime.mul(0.45))).mul(0.5).add(0.5);
    const bands = sin(auroraUv.y.mul(10.0).add(flow.mul(3.0)).add(uTime)).mul(0.5).add(0.5);
    const gradient = mix(uColor1, uColor2, auroraUv.y);
    const color = mix(
        gradient,
        uColor3,
        sin(auroraUv.x.mul(3.14).add(uTime.mul(0.5))).mul(0.5).add(0.5),
    );
    const verticalFade = smoothstep(0.0, 0.2, auroraUv.y).mul(smoothstep(1.0, 0.8, auroraUv.y));
    const intensity = bands.mul(verticalFade).mul(uIntensity);

    material.colorNode = color.mul(intensity);
    material.opacityNode = clamp(intensity.mul(0.6), 0.0, 1.0);
    material.emissiveNode = color.mul(intensity.mul(1.1));

    return setMaterialUniforms(
        material,
        {
            uTime,
            uIntensity,
            uColor1,
            uColor2,
            uColor3,
        },
        { emitsBloom: true, mrtRole: 'aurora' },
    );
}

export function createShockwaveMaterialWebGL(params = {}) {
    const uniforms = {
        uTime: params.uTime ?? { value: 0 },
        uOpacity: params.uOpacity ?? { value: 1.0 },
        uColor: { value: params.color ?? new THREE.Color(0x74b9ff) },
    };

    const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: shockwaveVertexShader,
        fragmentShader: shockwaveFragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
    });

    return setMaterialUniforms(material, uniforms, { emitsBloom: true, mrtRole: 'shockwave' });
}

export function createShockwaveMaterialWebGPU(params = {}) {
    const { WEBGPU, TSL } = requireMaterialRuntime();
    const {
        uniform,
        float,
        abs,
        pow,
        normalView,
        clamp,
    } = TSL;

    const material = new WEBGPU.MeshBasicNodeMaterial();
    material.transparent = true;
    material.side = WEBGPU.DoubleSide;
    material.depthWrite = false;
    material.blending = WEBGPU.AdditiveBlending;

    const uTime = uniform(params.time ?? 0);
    const uOpacity = uniform(params.opacity ?? 1.0);
    const uColor = uniform(params.color ?? new THREE.Color(0x74b9ff));

    const fresnel = pow(float(1.0).sub(abs(normalView.z)), float(2.0));
    const intensity = float(0.4).add(fresnel.mul(0.6));
    const color = uColor.mul(intensity);

    material.colorNode = color;
    material.opacityNode = clamp(uOpacity.mul(intensity), 0.0, 1.0);
    material.emissiveNode = color.mul(1.1);

    return setMaterialUniforms(material, { uTime, uOpacity, uColor }, { emitsBloom: true, mrtRole: 'shockwave' });
}

export function createSnowMaterialWebGL(params = {}) {
    const uniforms = {
        uTime: params.uTime ?? { value: 0 },
        uSize: params.uSize ?? { value: 3.0 },
        uColor: { value: params.color ?? new THREE.Color(0xe8fcff) },
    };

    const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: snowVertexShader,
        fragmentShader: snowFragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    return setMaterialUniforms(material, uniforms, { emitsBloom: false, mrtRole: 'snow' });
}

export function createSnowMaterialWebGPU(params = {}) {
    const { WEBGPU, TSL } = requireMaterialRuntime();
    const {
        uniform,
        attribute,
        storage,
        vertexIndex,
        positionLocal,
        positionView,
        pointUV,
        vec3,
        float,
        sin,
        cos,
        fract,
        length,
        smoothstep,
    } = TSL;

    const material = new WEBGPU.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = WEBGPU.AdditiveBlending;

    const uTime = uniform(params.time ?? 0);
    const uSize = uniform(params.size ?? 3.0);
    const uColor = uniform(params.color ?? new THREE.Color(0xe8fcff));
    const snowCompute = params.snowCompute ?? null;
    const useCompute = Boolean(
        snowCompute?.getPositionBuffer
        && snowCompute?.getRandomBuffer,
    );

    const aRandom = useCompute ? null : attribute('aRandom');
    const aSpeed = useCompute ? null : attribute('aSpeed');

    const positionStorage = useCompute
        ? storage(snowCompute.getPositionBuffer(), 'vec4', snowCompute.count)
        : null;
    const randomStorage = useCompute
        ? storage(snowCompute.getRandomBuffer(), 'vec4', snowCompute.count)
        : null;
    const positionStorageAttr = useCompute && typeof positionStorage.toAttribute === 'function'
        ? positionStorage.toAttribute()
        : null;
    const randomStorageAttr = useCompute && typeof randomStorage.toAttribute === 'function'
        ? randomStorage.toAttribute()
        : null;

    let randomValue = aRandom;
    let speedValue = aSpeed;
    let basePosition = positionLocal;
    let fallDistance = float(0.0);

    if (useCompute) {
        if (randomStorageAttr) {
            randomValue = randomStorageAttr.x;
            speedValue = randomStorageAttr.y;
        } else {
            randomValue = randomStorage.element(vertexIndex).x;
            speedValue = randomStorage.element(vertexIndex).y;
        }
        basePosition = positionStorageAttr
            ? positionStorageAttr.xyz
            : positionStorage.element(vertexIndex).xyz;
        fallDistance = float(0.0);
    } else {
        fallDistance = fract(uTime.mul(speedValue).mul(0.05).add(randomValue)).mul(40.0);
    }

    const pos = vec3(
        basePosition.x.add(sin(uTime.mul(0.5).add(randomValue.mul(6.28))).mul(0.25)),
        basePosition.y.sub(fallDistance),
        basePosition.z.add(cos(uTime.mul(0.3).add(randomValue.mul(6.28))).mul(0.2)),
    );

    const center = pointUV.sub(0.5);
    const dist = length(center);
    const alpha = smoothstep(0.5, 0.2, dist).mul(float(0.6).add(randomValue.mul(0.4)));
    const sparkle = float(1.0).add(sin(randomValue.mul(100.0)).mul(0.2));

    material.positionNode = pos;
    material.sizeNode = uSize
        .mul(float(1.0).add(randomValue.mul(0.5)))
        .mul(float(20.0).div(positionView.z.negate()));
    material.colorNode = uColor.mul(sparkle);
    material.opacityNode = alpha;
    material.emissiveNode = vec3(0.0);

    return setMaterialUniforms(material, { uTime, uSize, uColor }, {
        emitsBloom: false,
        mrtRole: 'snow',
        usesCompute: useCompute,
    });
}

export function createIceShardMaterialWebGL(params = {}) {
    const uniforms = {
        uTime: params.uTime ?? { value: 0 },
        uSize: params.uSize ?? { value: 8.0 },
        uColor: { value: params.color ?? new THREE.Color(0x96d7ff) },
    };

    const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: iceShardVertexShader,
        fragmentShader: iceShardFragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    return setMaterialUniforms(material, uniforms, { emitsBloom: true, mrtRole: 'ice-shard' });
}

export function createIceShardMaterialWebGPU(params = {}) {
    const { WEBGPU, TSL } = requireMaterialRuntime();
    const {
        uniform,
        attribute,
        storage,
        vertexIndex,
        positionLocal,
        positionView,
        pointUV,
        vec3,
        float,
        sin,
        cos,
        atan,
        length,
        smoothstep,
        mix,
    } = TSL;

    const material = new WEBGPU.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = WEBGPU.AdditiveBlending;

    const uTime = uniform(params.time ?? 0);
    const uSize = uniform(params.size ?? 8.0);
    const uColor = uniform(params.color ?? new THREE.Color(0x96d7ff));
    const shardCompute = params.shardCompute ?? null;
    const useCompute = Boolean(
        shardCompute?.getPositionBuffer
        && shardCompute?.getLifeBuffer
        && shardCompute?.getMiscBuffer,
    );

    const aVelocity = useCompute ? null : attribute('aVelocity');
    const aLife = useCompute ? null : attribute('aLife');
    const aRandom = useCompute ? null : attribute('aRandom');

    const positionStorage = useCompute
        ? storage(shardCompute.getPositionBuffer(), 'vec4', shardCompute.count)
        : null;
    const lifeStorage = useCompute
        ? storage(shardCompute.getLifeBuffer(), 'vec4', shardCompute.count)
        : null;
    const miscStorage = useCompute
        ? storage(shardCompute.getMiscBuffer(), 'vec4', shardCompute.count)
        : null;
    const positionStorageAttr = useCompute && typeof positionStorage.toAttribute === 'function'
        ? positionStorage.toAttribute()
        : null;
    const lifeStorageAttr = useCompute && typeof lifeStorage.toAttribute === 'function'
        ? lifeStorage.toAttribute()
        : null;
    const miscStorageAttr = useCompute && typeof miscStorage.toAttribute === 'function'
        ? miscStorage.toAttribute()
        : null;

    let basePosition = positionLocal;
    let lifeValue = aLife;
    let randomValue = aRandom;
    let sizeScale = float(1.0);
    let activeValue = float(1.0);

    if (useCompute) {
        basePosition = positionStorageAttr
            ? positionStorageAttr.xyz
            : positionStorage.element(vertexIndex).xyz;
        if (lifeStorageAttr) {
            lifeValue = lifeStorageAttr.x;
        } else {
            lifeValue = lifeStorage.element(vertexIndex).x;
        }
        if (miscStorageAttr) {
            randomValue = miscStorageAttr.z;
            sizeScale = miscStorageAttr.x;
            activeValue = miscStorageAttr.y;
        } else {
            randomValue = miscStorage.element(vertexIndex).z;
            sizeScale = miscStorage.element(vertexIndex).x;
            activeValue = miscStorage.element(vertexIndex).y;
        }
    }

    const pos = vec3(
        useCompute ? basePosition.x : basePosition.x.add(aVelocity.x.mul(uTime)),
        useCompute ? basePosition.y : basePosition.y.add(aVelocity.y.mul(uTime)).sub(uTime.mul(uTime).mul(2.0)),
        useCompute ? basePosition.z : basePosition.z.add(aVelocity.z.mul(uTime)),
    );

    const center = pointUV.sub(0.5);
    const dist = length(center);
    const angle = atan(center.y, center.x);
    const hex = cos(angle.mul(6.0)).mul(0.1);
    const shape = smoothstep(0.5, float(0.3).add(hex), dist);
    const alpha = shape.mul(lifeValue).mul(activeValue);
    const sparkle = float(1.0).add(sin(randomValue.mul(50.0).add(lifeValue.mul(10.0))).mul(0.3));
    const color = uColor.mul(sparkle);
    const hidden = vec3(0.0, 0.0, -9999.0);

    material.positionNode = useCompute ? mix(hidden, pos, activeValue) : pos;
    material.sizeNode = uSize
        .mul(sizeScale)
        .mul(lifeValue)
        .mul(float(0.8).add(randomValue.mul(0.4)))
        .mul(float(25.0).div(positionView.z.negate()));
    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha);

    return setMaterialUniforms(material, { uTime, uSize, uColor }, {
        emitsBloom: true,
        mrtRole: 'ice-shard',
        usesCompute: useCompute,
    });
}

export function createStarfieldMaterialWebGL() {
    const material = new THREE.PointsMaterial({
        size: 0.8,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
    });

    return setMaterialUniforms(material, {}, { emitsBloom: false, mrtRole: 'starfield' });
}

export function createStarfieldMaterialWebGPU(params = {}) {
    const { WEBGPU, TSL } = requireMaterialRuntime();
    const {
        uniform,
        attribute,
        positionLocal,
        positionView,
        pointUV,
        vec3,
        float,
        sin,
        length,
        smoothstep,
    } = TSL;

    const material = new WEBGPU.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = WEBGPU.AdditiveBlending;

    const uTime = uniform(params.time ?? 0);
    const aColor = attribute('color');
    const aSize = attribute('size');

    const twinkle = sin(
        uTime.mul(1.2)
            .add(positionLocal.x.mul(0.04))
            .add(positionLocal.y.mul(0.02))
            .add(positionLocal.z.mul(0.03)),
    ).mul(0.5).add(0.5);

    const center = pointUV.sub(0.5);
    const dist = length(center);
    const disc = smoothstep(0.5, 0.2, dist);
    const alpha = disc.mul(float(0.35).add(twinkle.mul(0.45)));

    material.sizeNode = aSize.mul(float(20.0).div(positionView.z.negate()));
    material.colorNode = aColor;
    material.opacityNode = alpha;
    material.emissiveNode = vec3(0.0);

    return setMaterialUniforms(material, { uTime }, { emitsBloom: false, mrtRole: 'starfield' });
}
