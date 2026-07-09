import * as THREE from 'three/webgpu';

export const meta = {
    id: 'lunara-composition',
    title: 'Lunara - Composition',
    description: 'Twin moons, S-curve valley stream, calm center lane, and side crystal framing.',
};

function seeded(seed) {
    let state = seed % 2147483647;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
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

function disposeObject(object) {
    object.traverse?.((child) => {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
        else child.material?.dispose?.();
    });
}

function ridgeGeometry(T, seed, width, z, baseY, peakY, count, valleyGap) {
    const rng = seeded(seed);
    const positions = [];
    const indices = [];
    for (let i = 0; i <= count; i++) {
        const t = i / count;
        const x = (t - 0.5) * width;
        const nx = Math.abs(t - 0.5) * 2;
        const gap = Math.max(0, 1 - Math.abs(x) / valleyGap);
        const spire = Math.sin(t * 28.0 + seed * 0.001) * 0.45
            + Math.sin(t * 53.0) * 0.22
            + rng() * 0.26;
        const y = baseY + peakY * (0.32 + nx * 0.68 + spire) - gap * peakY * 0.72;
        positions.push(x, y, z, x, baseY - 18, z + 10);
    }
    for (let i = 0; i < count; i++) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function streamGeometry(T) {
    const rows = 96;
    const cols = 6;
    const positions = [];
    const colors = [];
    const indices = [];
    const edge = new T.Color(0x231050);
    const violet = new T.Color(0x8a58ff);
    const cyan = new T.Color(0x65f4ff);
    for (let i = 0; i <= rows; i++) {
        const t = i / rows;
        const z = 28 - t * 280;
        const far = t;
        const centerX = Math.sin(t * 6.4 + 0.2) * (3.5 + far * 10.0)
            + Math.sin(t * 16.0) * 1.6;
        const width = 5.8 + far * 18.0 + Math.sin(t * 8.0) * 1.1;
        for (let j = 0; j < cols; j++) {
            const side = (j / (cols - 1)) * 2 - 1;
            const x = centerX + Math.sign(side) * (Math.abs(side) ** 1.25) * width;
            const y = -3.0 + Math.abs(side) ** 1.7 * 0.8 - far * 0.25;
            positions.push(x, y, z);
            const glow = 1 - Math.abs(side);
            const c = edge.clone().lerp(violet, 0.25 + glow * 0.45).lerp(cyan, glow * 0.28);
            colors.push(c.r, c.g, c.b);
        }
    }
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols - 1; j++) {
            const a = i * cols + j;
            indices.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
        }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
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
    scene.background = new T.Color(0x030214);
    scene.fog = new T.FogExp2(0x0b061f, 0.006);

    camera.fov = 52;
    camera.near = 0.1;
    camera.far = 2200;
    camera.position.set(0, 8.5, 58);
    camera.lookAt(0, 6, -150);
    camera.updateProjectionMatrix();

    add(new T.HemisphereLight(0x8d73ff, 0x150625, 0.65));
    const key = add(new T.DirectionalLight(0xd8bdff, 1.6));
    key.position.set(-0.3, 0.72, 0.55);

    const sky = add(new T.Mesh(
        new T.SphereGeometry(1200, 48, 24),
        nodeBasic(T, { color: new T.Color(0x08031c), side: T.BackSide }),
    ));

    const moonGeo = new T.CircleGeometry(1, 96);
    const haloGeo = new T.CircleGeometry(1, 96);
    const makeDisc = (position, radius, color, haloColor, haloScale, opacity) => {
        const halo = add(new T.Mesh(haloGeo.clone(), nodeBasic(T, {
            color: new T.Color(haloColor),
            transparent: true,
            opacity,
            depthWrite: false,
            blending: T.AdditiveBlending,
            side: T.DoubleSide,
        })));
        halo.position.copy(position);
        halo.scale.setScalar(radius * haloScale);
        const moon = add(new T.Mesh(moonGeo.clone(), nodeBasic(T, {
            color: new T.Color(color),
            side: T.DoubleSide,
        })));
        moon.position.copy(position);
        moon.scale.setScalar(radius);
        return { moon, halo };
    };
    const primary = makeDisc(new T.Vector3(-64, 82, -380), 42, 0x341071, 0x8e42ff, 2.45, 0.18);
    const companion = makeDisc(new T.Vector3(22, 73, -356), 18, 0xbd235a, 0xff5faa, 2.35, 0.15);

    [
        [151, 980, -340, -22, 38, 132, 92, 0x311557],
        [311, 820, -235, -18, 34, 118, 150, 0x251044],
        [811, 680, -138, -16, 28, 96, 220, 0x16092d],
    ].forEach(([seed, width, z, baseY, peakY, count, gap, color]) => {
        add(new T.Mesh(
            ridgeGeometry(T, seed, width, z, baseY, peakY, count, gap),
            nodeBasic(T, { color: new T.Color(color), side: T.DoubleSide }),
        ));
    });

    const ground = add(new T.Mesh(
        new T.PlaneGeometry(860, 760, 48, 48),
        nodeStandard(T, {
            color: new T.Color(0x211046),
            roughness: 0.88,
            metalness: 0.02,
        }),
    ));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -5.4, -120);

    const stream = add(new T.Mesh(
        streamGeometry(T),
        nodeBasic(T, {
            vertexColors: true,
            transparent: true,
            opacity: 0.74,
            side: T.DoubleSide,
            blending: T.AdditiveBlending,
            depthWrite: false,
        }),
    ));

    const crystalMat = nodeStandard(T, {
        color: new T.Color(0x875fe5),
        roughness: 0.18,
        metalness: 0.05,
        emissive: new T.Color(0x8feeff),
        emissiveIntensity: 0.36,
        transparent: true,
        opacity: 0.88,
    });
    const crystalGeo = new T.ConeGeometry(0.7, 5.4, 6, 1);
    const tmp = new T.Object3D();
    const crystalMesh = add(new T.InstancedMesh(crystalGeo, crystalMat, 72));
    const rng = seeded(55191);
    for (let i = 0; i < 72; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const z = 26 - rng() ** 1.45 * 220;
        const far = Math.min(1, Math.max(0, (-z - 4) / 220));
        const x = side * (28 + rng() * (42 + far * 82));
        const h = (2.5 + rng() * 8.0) * (1.1 - far * 0.42);
        tmp.position.set(x, -3.8 + h * 0.5, z);
        tmp.rotation.set((rng() - 0.5) * 0.34, rng() * Math.PI * 2, (rng() - 0.5) * 0.34);
        tmp.scale.set(0.9 + rng() * 1.9, h, 0.65 + rng() * 1.2);
        tmp.updateMatrix();
        crystalMesh.setMatrixAt(i, tmp.matrix);
    }
    crystalMesh.instanceMatrix.needsUpdate = true;

    const fogMat = nodeBasic(T, {
        color: new T.Color(0x8b61ff),
        transparent: true,
        opacity: 0.07,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.AdditiveBlending,
    });
    [-84, 86].forEach((x, i) => {
        const fog = add(new T.Mesh(new T.PlaneGeometry(260, 92), fogMat.clone()));
        fog.position.set(x, 3 + i * 1.2, -88 - i * 42);
    });

    return {
        cameraRadius: 100,
        update(time) {
            sky.rotation.y = time * 0.004;
            primary.halo.scale.setScalar(42 * (2.45 + Math.sin(time * 0.45) * 0.035));
            companion.halo.scale.setScalar(18 * (2.35 + Math.cos(time * 0.5) * 0.045));
        },
        camera(time, cam) {
            cam.position.set(Math.sin(time * 0.12) * 2.5, 8.5 + Math.sin(time * 0.16) * 0.7, 58);
            cam.lookAt(Math.sin(time * 0.08) * 4.0, 5.8, -150);
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
