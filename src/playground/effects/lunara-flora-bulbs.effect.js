import * as THREE from 'three/webgpu';

export const meta = {
    id: 'lunara-flora-bulbs',
    title: 'Lunara - Flora Bulbs',
    description: 'Cave-bulb inspired silhouettes, emissive pulse, and side-biased density test.',
};

function seeded(seed) {
    let state = seed % 2147483647;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
}

function disposeObject(object) {
    object.traverse?.((child) => {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
        else child.material?.dispose?.();
    });
}

function nodeBasic(T, params = {}) {
    const material = new T.MeshBasicNodeMaterial();
    Object.assign(material, params);
    return material;
}

function nodeStandard(T, params = {}) {
    const material = new T.MeshStandardNodeMaterial();
    Object.assign(material, params);
    return material;
}

export function create({
    THREE: T = THREE, scene, camera,
}) {
    const objects = [];
    const add = (object) => {
        scene.add(object);
        objects.push(object);
        return object;
    };
    const previousBackground = scene.background;
    scene.background = new T.Color(0x040318);
    scene.fog = new T.FogExp2(0x0b061f, 0.012);

    camera.fov = 50;
    camera.near = 0.1;
    camera.far = 1000;
    camera.position.set(0, 5.4, 28);
    camera.lookAt(0, 2.5, -18);
    camera.updateProjectionMatrix();

    add(new T.HemisphereLight(0x8b78ff, 0x13081e, 0.58));
    const moonKey = add(new T.DirectionalLight(0xdcc4ff, 1.4));
    moonKey.position.set(-5, 10, 8);
    const cyanGlow = add(new T.PointLight(0x58ffe4, 2.2, 38, 2));
    cyanGlow.position.set(-4.5, 2.6, -2.5);
    const roseGlow = add(new T.PointLight(0xff63cf, 1.5, 34, 2));
    roseGlow.position.set(5.5, 2.2, -7.5);

    const moonMat = nodeBasic(T, {
        color: new T.Color(0x7e4dff),
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.AdditiveBlending,
    });
    const moon = add(new T.Mesh(new T.CircleGeometry(12, 72), moonMat));
    moon.position.set(-24, 34, -140);

    const ground = add(new T.Mesh(
        new T.PlaneGeometry(90, 96, 28, 28),
        nodeStandard(T, {
            color: new T.Color(0x1d0f3b),
            roughness: 0.88,
            metalness: 0.03,
        }),
    ));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.2, -18);

    const stemMaterial = nodeStandard(T, {
        color: new T.Color(0x143846),
        roughness: 0.86,
        metalness: 0.02,
        vertexColors: true,
        emissive: new T.Color(0x153b50),
        emissiveIntensity: 0.18,
    });
    const bulbMaterial = nodeStandard(T, {
        color: new T.Color(0x74ffe2),
        roughness: 0.22,
        metalness: 0.04,
        vertexColors: true,
        transparent: true,
        opacity: 0.94,
        emissive: new T.Color(0x6fffe2),
        emissiveIntensity: 0.86,
    });

    const count = 64;
    const stemMesh = add(new T.InstancedMesh(new T.CylinderGeometry(0.045, 0.075, 1, 6), stemMaterial, count));
    const bulbMesh = add(new T.InstancedMesh(new T.SphereGeometry(0.34, 14, 10), bulbMaterial, count));
    stemMesh.frustumCulled = false;
    bulbMesh.frustumCulled = false;

    const tmp = new T.Object3D();
    const color = new T.Color();
    const rng = seeded(91917);
    for (let i = 0; i < count; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const z = 5 - rng() ** 1.25 * 60;
        const far = Math.min(1, Math.max(0, (-z + 2) / 62));
        const x = side * (8 + rng() * (16 + far * 24));
        const y = -0.05 + Math.sin(x * 0.16 + z * 0.11) * 0.22;
        const height = (0.9 + rng() * 2.45) * (1.08 - far * 0.34);
        const yaw = rng() * Math.PI * 2;
        const lean = (rng() - 0.5) * 0.46;

        tmp.position.set(x, y + height * 0.5, z);
        tmp.rotation.set(lean * 0.18, yaw, lean);
        tmp.scale.set(1, height, 1);
        tmp.updateMatrix();
        stemMesh.setMatrixAt(i, tmp.matrix);

        const bulbScale = (0.7 + rng() * 0.88) * (1.08 - far * 0.32);
        tmp.position.set(
            x + Math.sin(yaw) * height * 0.15,
            y + height + 0.12,
            z + Math.cos(yaw) * height * 0.15,
        );
        tmp.rotation.set(lean * 0.34, yaw, -lean * 0.22);
        tmp.scale.set(bulbScale * 0.78, bulbScale * 1.34, bulbScale * 0.72);
        tmp.updateMatrix();
        bulbMesh.setMatrixAt(i, tmp.matrix);

        color.set(i % 5 === 0 ? 0xff72d4 : 0x74ffe2);
        color.lerp(new T.Color(0x9b73ff), rng() * 0.25 + far * 0.1);
        bulbMesh.setColorAt(i, color);
        stemMesh.setColorAt(i, new T.Color(0x143846).lerp(color, 0.14));
    }
    stemMesh.instanceMatrix.needsUpdate = true;
    bulbMesh.instanceMatrix.needsUpdate = true;
    if (stemMesh.instanceColor) stemMesh.instanceColor.needsUpdate = true;
    if (bulbMesh.instanceColor) bulbMesh.instanceColor.needsUpdate = true;

    const hazeMaterial = nodeBasic(T, {
        color: new T.Color(0x7d65ff),
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
        blending: T.AdditiveBlending,
        side: T.DoubleSide,
    });
    [-1, 1].forEach((side) => {
        const haze = add(new T.Mesh(new T.PlaneGeometry(34, 12), hazeMaterial.clone()));
        haze.position.set(side * 18, 4.6, -28);
    });

    return {
        cameraRadius: 34,
        update(time) {
            const pulse = 1 + Math.sin(time * 1.2) * 0.09;
            bulbMaterial.emissiveIntensity = 0.86 * pulse;
            stemMaterial.emissiveIntensity = 0.18 * (0.9 + pulse * 0.1);
            cyanGlow.intensity = 2.1 + Math.sin(time * 0.8) * 0.18;
            roseGlow.intensity = 1.4 + Math.cos(time * 0.75) * 0.16;
            moon.scale.setScalar(1 + Math.sin(time * 0.35) * 0.025);
        },
        camera(time, cam) {
            cam.position.set(Math.sin(time * 0.14) * 2.2, 5.4 + Math.sin(time * 0.18) * 0.35, 28);
            cam.lookAt(Math.sin(time * 0.1) * 2.0, 2.5, -18);
        },
        dispose() {
            objects.forEach((object) => {
                scene.remove(object);
                disposeObject(object);
            });
            scene.background = previousBackground;
            scene.fog = null;
        },
    };
}
