import * as THREE from 'three/webgpu';
import {
    createLunaraCrystalMaterialWebGPU,
    createLunaraGroundMaterialWebGPU,
} from '../../themes/lunara/lunara-materials.js';
import {
    createLunaraDetailTextureSet,
    disposeLunaraDetailTextureSet,
    loadLunaraHdriEnvironment,
} from '../../themes/lunara/lunara-assets.js';

export const meta = {
    id: 'lunara-crystal-material',
    title: 'Lunara - Crystal Material',
    description: 'Hero crystal shading, subtle caustic pool, HDRI response, and ground texture tooth.',
};

function disposeObject(object) {
    object.traverse?.((child) => {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
        else child.material?.dispose?.();
    });
}

function makeCrystalGeometry(T, {
    sides = 7,
    height = 5.2,
    baseRadius = 0.78,
    shoulderRadius = 0.58,
    neckRadius = 0.28,
    skew = 0.16,
} = {}) {
    const positions = [];
    const indices = [];
    const rings = [];
    const ys = [-0.48, -0.08, 0.28].map((v) => v * height);
    const radii = [baseRadius, shoulderRadius, neckRadius];
    for (let r = 0; r < ys.length; r++) {
        const ring = [];
        for (let i = 0; i < sides; i++) {
            const a = (i / sides) * Math.PI * 2 + r * 0.18;
            positions.push(
                Math.cos(a) * radii[r] + Math.sin(i * 1.7 + r) * skew,
                ys[r],
                Math.sin(a) * radii[r] * 0.78 + Math.cos(i * 1.4 + r) * skew,
            );
            ring.push(positions.length / 3 - 1);
        }
        rings.push(ring);
    }
    positions.push(skew * 0.5, height * 0.52, -skew * 0.25);
    const apex = positions.length / 3 - 1;
    positions.push(0, -height * 0.53, 0);
    const base = positions.length / 3 - 1;

    for (let r = 0; r < rings.length - 1; r++) {
        for (let i = 0; i < sides; i++) {
            const n = (i + 1) % sides;
            indices.push(rings[r][i], rings[r + 1][i], rings[r][n]);
            indices.push(rings[r][n], rings[r + 1][i], rings[r + 1][n]);
        }
    }
    const top = rings[rings.length - 1];
    const bottom = rings[0];
    for (let i = 0; i < sides; i++) {
        const n = (i + 1) % sides;
        indices.push(top[i], apex, top[n]);
        indices.push(base, bottom[n], bottom[i]);
    }

    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const faceted = geometry.toNonIndexed();
    faceted.computeVertexNormals();
    geometry.dispose();
    return faceted;
}

export function create({
    THREE: T = THREE, scene, camera, renderer,
}) {
    const objects = [];
    const add = (object) => {
        scene.add(object);
        objects.push(object);
        return object;
    };
    const previousBackground = scene.background;
    const previousEnvironment = scene.environment;
    const detailTextures = createLunaraDetailTextureSet();
    const cancelHdri = loadLunaraHdriEnvironment(renderer, scene);

    scene.background = new T.Color(0x040318);
    scene.fog = new T.FogExp2(0x0b061f, 0.01);

    camera.fov = 48;
    camera.near = 0.1;
    camera.far = 900;
    camera.position.set(0, 5.5, 21);
    camera.lookAt(0, 3.0, -4);
    camera.updateProjectionMatrix();

    add(new T.HemisphereLight(0x9b82ff, 0x12081d, 0.65));
    const key = add(new T.DirectionalLight(0xe4ccff, 2.1));
    key.position.set(-6, 12, 8);
    const rim = add(new T.PointLight(0x5ffff0, 1.8, 34, 2));
    rim.position.set(-5, 3.8, 2.5);

    const ground = createLunaraGroundMaterialWebGPU({
        color: new T.Color(0x221049),
        veinColor: new T.Color(0xa98cff),
        veinStrength: 0.22,
        detailMap: detailTextures.ground.detail,
        normalMap: detailTextures.ground.normal,
        roughnessMap: detailTextures.ground.roughness,
        detailScale: 0.13,
        detailStrength: 0.22,
    });
    const groundMesh = add(new T.Mesh(new T.PlaneGeometry(44, 44, 72, 72), ground.material));
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = -0.08;

    const causticMat = new T.MeshBasicNodeMaterial();
    causticMat.color = new T.Color(0x78f7ff);
    causticMat.transparent = true;
    causticMat.opacity = 0.18;
    causticMat.depthWrite = false;
    causticMat.blending = T.AdditiveBlending;
    const caustic = add(new T.Mesh(new T.CircleGeometry(5.2, 72), causticMat));
    caustic.rotation.x = -Math.PI / 2;
    caustic.position.set(0, 0.045, -2.3);

    const heroMaterial = createLunaraCrystalMaterialWebGPU({
        color: new T.Color(0xa88aff),
        emissive: new T.Color(0xdcc5ff),
        emissiveStrength: 1.05,
        opacity: 0.86,
        roughness: 0.07,
        metalness: 0.04,
        useTransmission: false,
        envMapIntensity: 1.55,
    });
    const shardMaterial = createLunaraCrystalMaterialWebGPU({
        color: new T.Color(0x66dfff),
        emissive: new T.Color(0x89f7ff),
        emissiveStrength: 0.68,
        opacity: 0.72,
        roughness: 0.11,
        metalness: 0.03,
        envMapIntensity: 1.2,
    });

    const heroGeo = makeCrystalGeometry(T, {
        sides: 7, height: 6.4, baseRadius: 0.9, skew: 0.18,
    });
    const shardGeo = makeCrystalGeometry(T, {
        sides: 5, height: 3.8, baseRadius: 0.55, skew: 0.26,
    });
    const hero = add(new T.Mesh(heroGeo, heroMaterial.material));
    hero.position.set(-0.4, 3.2, -2.6);
    hero.rotation.set(-0.08, 0.25, 0.08);
    hero.scale.set(1.15, 1.22, 1.05);

    [-3.1, 2.7, -1.9, 2.0, 4.2].forEach((x, i) => {
        const shard = add(new T.Mesh(shardGeo.clone(), shardMaterial.material));
        shard.position.set(x, 1.5 + (i % 2) * 0.25, -1.6 - i * 0.75);
        shard.rotation.set((i - 2) * 0.12, i * 0.86, (i % 2 === 0 ? 1 : -1) * 0.18);
        const s = 0.68 + i * 0.08;
        shard.scale.set(s, s * (1.0 + i * 0.09), s);
    });

    return {
        cameraRadius: 24,
        update(time) {
            for (const material of [heroMaterial.material, shardMaterial.material, ground.material]) {
                const u = material.userData?.uniforms?.uTime;
                if (u) u.value = time;
            }
            const heroGlow = heroMaterial.material.userData?.uniforms?.uEmissiveStrength;
            if (heroGlow) heroGlow.value = 1.05 + Math.sin(time * 1.2) * 0.08;
            caustic.scale.setScalar(1.0 + Math.sin(time * 0.8) * 0.045);
            caustic.material.opacity = 0.15 + Math.sin(time * 1.1) * 0.035;
            hero.rotation.y = 0.25 + Math.sin(time * 0.18) * 0.08;
        },
        camera(time, cam) {
            cam.position.set(Math.sin(time * 0.18) * 1.8, 5.4 + Math.sin(time * 0.12) * 0.4, 21);
            cam.lookAt(0, 3.0, -3.6);
        },
        dispose() {
            cancelHdri?.();
            disposeLunaraDetailTextureSet(detailTextures);
            shardGeo.dispose();
            objects.forEach((object) => {
                scene.remove(object);
                disposeObject(object);
            });
            scene.background = previousBackground;
            scene.environment = previousEnvironment;
            scene.fog = null;
        },
    };
}
