import * as THREE from 'three/webgpu';

// The composition is authored first; quality only thins its supporting formations.
// Linear vertex colors are deliberately modulated per face rather than smoothed.
const GEM_PALETTE = [0x36efdc, 0xa36dff, 0x3979ff, 0xef76bc, 0xf8bd65, 0x5cecff];

function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function createCrystalGeometry() {
    const positions = [];
    const colors = [];
    const uvs = [];
    const rings = [
        { y: 0, radius: 0.72, lean: 0 },
        { y: 0.13, radius: 1, lean: 0.015 },
        { y: 0.75, radius: 0.88, lean: 0.045 },
    ];
    const sides = 12;
    const radial = [0.96, 0.84, 1.08, 0.93, 1.02, 0.86];
    const corners = radial.map((radius, index) => {
        const angle = (index / 6) * Math.PI * 2;
        return new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius);
    });
    const outline = [];
    corners.forEach((corner, index) => {
        // Two close vertices replace each sharp hexagon corner: the narrow face
        // catches a crisp edge glint while the six broad shaft faces stay quiet.
        outline.push(corner.clone().lerp(corners[(index + 5) % 6], 0.065));
        outline.push(corner.clone().lerp(corners[(index + 1) % 6], 0.065));
    });
    const vertex = (ring, side) => {
        const point = outline[side % sides];
        const angle = Math.atan2(point.y, point.x);
        return [
            point.x * ring.radius + ring.lean,
            ring.y + (ring.y > 0.6 ? Math.sin(angle + 0.7) * 0.035 : 0),
            point.y * ring.radius,
        ];
    };
    const triangle = (a, b, c, shade) => {
        [a, b, c].forEach((point) => {
            positions.push(...point);
            const height = 0.53 + point[1] * 0.45;
            colors.push(shade * height, shade * height, shade * height);
            uvs.push((Math.atan2(point[2], point[0]) / (Math.PI * 2) + 1) % 1, point[1]);
        });
    };
    for (let side = 0; side < sides; side++) {
        const faceShade = side % 2 === 0 ? 1.04 : [0.85, 0.64, 1.0, 0.76, 0.95, 0.72][Math.floor(side / 2)];
        for (let level = 0; level < rings.length - 1; level++) {
            const a = vertex(rings[level], side);
            const b = vertex(rings[level], side + 1);
            const c = vertex(rings[level + 1], side + 1);
            const d = vertex(rings[level + 1], side);
            triangle(a, d, b, faceShade);
            triangle(b, d, c, faceShade);
        }
        triangle(vertex(rings[2], side), [0.2, 1, -0.08], vertex(rings[2], side + 1), faceShade * 1.04);
        triangle([0, 0, 0], vertex(rings[0], side), vertex(rings[0], side + 1), faceShade * 0.45);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function createArchGeometry(radiusX, radiusY, depth, seed) {
    const random = seededRandom(seed);
    const segments = 23;
    const positions = [];
    const uvs = [];
    const inner = [];
    const lip = [];
    const outer = [];
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI;
        const uneven = 1 + Math.sin(angle * 4.4 + seed) * 0.12 + (random() - 0.5) * 0.09;
        const lean = Math.sin(angle) * (Math.sin(seed * 0.27) * 5.5);
        const x = Math.cos(angle) * radiusX * uneven + lean;
        const y = Math.sin(angle) * radiusY * uneven - 7 + Math.sin(angle * 2.1 + seed) * 1.5;
        inner.push([x, y, -0.4 - random() * 1.8]);
        lip.push([x + Math.cos(angle) * 1.7, y + Math.sin(angle) * 1.7, 0.5 + random() * 1.6]);
        outer.push([
            Math.cos(angle) * (radiusX + 12 + random() * 5),
            Math.sin(angle) * (radiusY + 14) - 11,
            1.2 + random() * 2,
        ]);
    }
    const quad = (a, b, c, d) => {
        [a, b, d, b, c, d].forEach((point) => {
            positions.push(...point);
            uvs.push(point[0] * 0.03, point[1] * 0.03);
        });
    };
    const back = (point) => [point[0], point[1], point[2] - depth];
    for (let i = 0; i < segments; i++) {
        quad(inner[i], lip[i], lip[i + 1], inner[i + 1]);
        quad(lip[i], outer[i], outer[i + 1], lip[i + 1]);
        quad(back(inner[i + 1]), back(outer[i + 1]), back(outer[i]), back(inner[i]));
        quad(inner[i + 1], back(inner[i + 1]), back(inner[i]), inner[i]);
        quad(outer[i], back(outer[i]), back(outer[i + 1]), outer[i + 1]);
    }
    quad(inner[0], back(inner[0]), back(outer[0]), outer[0]);
    quad(outer[segments], back(outer[segments]), back(inner[segments]), inner[segments]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
}

function createSculptedRockGeometry(seed) {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const positions = geometry.getAttribute('position');
    const point = new THREE.Vector3();
    for (let index = 0; index < positions.count; index++) {
        point.fromBufferAttribute(positions, index);
        const relief = 1 + Math.sin(point.x * 6.3 + point.y * 4.2 + seed) * 0.09
            + Math.sin(point.z * 7.1 - point.y * 3.6 + seed * 0.3) * 0.07;
        point.multiplyScalar(relief);
        point.x += Math.sin(point.y * 3 + seed) * 0.055;
        point.z += Math.cos(point.x * 4 + seed) * 0.06;
        positions.setXYZ(index, point.x, point.y, point.z);
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

/**
 * Builds a complete deterministic grotto without owning any supplied material.
 * Crystals use ordinary instance matrices (also supported by WebGL2 node rendering).
 * @returns {{group: THREE.Group, anchors: THREE.Vector3[], crystalCount: number, dispose: Function}}
 */
export function createCrystalCaveScene({ scene, materials, quality = {} }) {
    const group = new THREE.Group();
    group.name = 'Crystal cathedral';
    scene.add(group);
    const geometries = new Set();
    const own = (geometry) => {
        geometries.add(geometry);
        return geometry;
    };
    const random = seededRandom(0xca7e);
    const formations = [];
    const rocks = [];
    const anchors = [];
    const crystal = (x, y, z, height, radius, palette, tilt = 0, twist = 0, anchor = false) => {
        formations.push({
            x, y, z, height, radius, palette, tilt, twist, anchor,
        });
    };
    const rock = (x, y, z, sx, sy, sz, angle = 0) => {
        rocks.push({
            x, y, z, sx, sy, sz, angle,
        });
    };

    // A turquoise fan on the left answers a rose/amethyst geode on the right.
    // Every tier retains these distinct silhouettes, including the ceiling pendants.
    const heroes = [
        [-17.1, -6.65, -2, 21.5, 2.8, 0, -0.1, 0.12],
        [-21.1, -6.6, -1.8, 13.2, 2.5, 5, 0.21, 0.56],
        [-13.7, -6.6, -1.3, 12.8, 1.65, 2, -0.34, 0.78],
        [-18.8, -6.55, 1.6, 8.7, 1.9, 0, 0.43, 1.5],
        [-22.8, -6.55, -5.8, 17.2, 2.05, 1, 0.11, 0.25],
        [16.1, -6.6, -5.7, 18.8, 2.65, 1, 0.12, 0.4],
        [20.2, -6.6, -3.8, 11.9, 2.15, 3, -0.23, 1.3],
        [12.8, -6.6, -4.7, 11.4, 1.65, 3, 0.4, 0.6],
        [18.5, -6.5, -0.8, 8.1, 1.75, 4, -0.42, 0.08],
        [24.1, -6.6, -9, 15.5, 2.2, 2, -0.08, 1.2],
        [-13.8, -6.8, -22, 14.2, 1.8, 1, 0.16, 0.34],
        [12.6, -6.8, -25, 15.1, 1.9, 5, -0.16, 1.25],
        [-29, -7.1, -30, 18.5, 3, 2, 0.15, 0.8],
        [27.5, -7.1, -32, 17.1, 2.5, 0, -0.13, 1.3],
        [-6.5, 22.5, -17, 10.6, 1.5, 1, Math.PI - 0.15, 0.5],
        [9.5, 25.5, -27, 12.4, 1.7, 2, Math.PI + 0.19, 1.5],
        [-24.5, 19.4, -9, 7.9, 1.35, 5, Math.PI + 0.2, 0.8],
        [24.3, 20.2, -20, 8.8, 1.1, 3, Math.PI - 0.13, 0.3],
    ];
    heroes.forEach((formation, index) => crystal(...formation, index < 14));

    // Mineral beds at the heroes' feet keep the tall spires grounded in the shoreline.
    [-1, 1].forEach((side) => {
        for (let i = 0; i < 12; i++) {
            const x = side * (11.8 + random() * 15);
            const basePalette = side < 0 ? 0 : 3;
            const accentPalette = side < 0 ? 1 : 4;
            crystal(
                x,
                -6.6,
                3 - random() * 18,
                1.3 + random() * 4.8,
                0.35 + random() * 0.75,
                i % 3 === 0 ? accentPalette : basePalette,
                side * (random() - 0.3) * 0.75,
                random() * Math.PI,
            );
        }
    });

    const supportingClusters = Math.max(4, Math.round(quality.crystalClusters ?? 24));
    for (let i = 0; i < supportingClusters; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const z = -28 - random() * 59;
        const x = side * (16 + random() * 20);
        const height = 5.5 + random() * 9.5;
        const palette = i % GEM_PALETTE.length;
        crystal(
            x,
            -7,
            z,
            height,
            0.7 + random() * 1.05,
            palette,
            side * (random() - 0.5) * 0.4,
            random() * Math.PI,
            i % 3 === 0,
        );
        crystal(
            x + side * 1.6,
            -7,
            z + 0.9,
            height * 0.58,
            0.65 + random() * 0.5,
            palette,
            -side * 0.34,
            random() * Math.PI,
        );
        if (supportingClusters >= 14) {
            crystal(
                x - side * 1.3,
                -7,
                z + 0.5,
                height * 0.39,
                0.45 + random() * 0.35,
                (palette + 1) % GEM_PALETTE.length,
                side * 0.44,
                random() * Math.PI,
            );
        }
    }
    // The distant sanctuary is restrained behind the playfield, with two amber sparks.
    crystal(-7.5, -7, -80, 13.7, 1.45, 4, -0.1, 0.3, true);
    crystal(6.8, -7, -77, 11.8, 1.4, 0, 0.16, 1.3, true);
    crystal(-1.1, -7, -97, 17.5, 1.35, 5, -0.02, 0.8);

    const crystalGeometry = own(createCrystalGeometry());
    const crystalMesh = new THREE.InstancedMesh(crystalGeometry, materials.crystal, formations.length);
    crystalMesh.name = 'Faceted mineral spires';
    const dummy = new THREE.Object3D();
    const tip = new THREE.Vector3(0.2, 1, -0.08);
    formations.forEach((formation, index) => {
        dummy.position.set(formation.x, formation.y, formation.z);
        dummy.rotation.set(0, formation.twist, formation.tilt);
        dummy.scale.set(formation.radius, formation.height, formation.radius * 0.88);
        dummy.updateMatrix();
        crystalMesh.setMatrixAt(index, dummy.matrix);
        crystalMesh.setColorAt(index, new THREE.Color(GEM_PALETTE[formation.palette]));
        if (formation.anchor) anchors.push(tip.clone().applyMatrix4(dummy.matrix));
    });
    crystalMesh.instanceMatrix.needsUpdate = true;
    crystalMesh.instanceColor.needsUpdate = true;
    crystalMesh.computeBoundingSphere();
    group.add(crystalMesh);

    // Four deep, irregular openings create a cavern rather than isolated rock props.
    [
        {
            z: 6, x: 35, y: 34, depth: 8, offset: 0.6,
        },
        {
            z: -24, x: 32, y: 33, depth: 6, offset: -1.4,
        },
        {
            z: -52, x: 29, y: 30, depth: 5, offset: 1.5,
        },
        {
            z: -81, x: 24, y: 26, depth: 4, offset: -0.8,
        },
    ].forEach((arch, index) => {
        const geometry = own(createArchGeometry(arch.x, arch.y, arch.depth, 127 + index * 17));
        const mesh = new THREE.Mesh(geometry, materials.rock);
        mesh.position.set(arch.offset, 0, arch.z);
        mesh.name = `Receding grotto arch ${index + 1}`;
        group.add(mesh);
        for (let j = 0; j < 10; j++) {
            const angle = ((j + (random() - 0.5) * 0.42) / 9) * Math.PI;
            const x = Math.cos(angle) * arch.x + arch.offset;
            const y = Math.sin(angle) * arch.y - 7;
            rock(
                x,
                y,
                arch.z - 0.8 + random() * 2,
                1.8 + random() * 3.4,
                1.7 + random() * 5.8,
                2.2 + random() * 3.5,
                angle - Math.PI / 2,
            );
        }
    });

    // Low banks frame the water; their irregular edge avoids a perfectly planar floor.
    [-1, 1].forEach((side) => {
        rock(side * 22, -9, -2, 15, 3.3, 17, side * 0.07);
        rock(side * 32, -10, -32, 17, 4.4, 24, -side * 0.09);
        for (let i = 0; i < 18; i++) {
            const z = 9 - i * 5.2;
            rock(
                side * (10.3 + random() * 8),
                -7.25 - random() * 0.65,
                z,
                1.5 + random() * 3.2,
                0.55 + random() * 0.85,
                1.4 + random() * 3.7,
                (random() - 0.5) * 0.8,
            );
        }
    });
    for (let variant = 0; variant < 3; variant++) {
        const stoneFormations = rocks.filter((formation, index) => index % 3 === variant);
        const rockGeometry = own(createSculptedRockGeometry(173 + variant * 37));
        const rockMesh = new THREE.InstancedMesh(rockGeometry, materials.rock, stoneFormations.length);
        rockMesh.name = `Broken cavern and shore stone ${variant + 1}`;
        stoneFormations.forEach((formation, index) => {
            dummy.position.set(formation.x, formation.y, formation.z);
            dummy.rotation.set(formation.angle * 0.24, index * 0.73, formation.angle);
            dummy.scale.set(formation.sx, formation.sy, formation.sz);
            dummy.updateMatrix();
            rockMesh.setMatrixAt(index, dummy.matrix);
        });
        rockMesh.instanceMatrix.needsUpdate = true;
        rockMesh.computeBoundingSphere();
        group.add(rockMesh);
    }

    const waterSegments = supportingClusters >= 20 ? 64 : 32;
    const water = new THREE.Mesh(own(new THREE.PlaneGeometry(110, 200, waterSegments, waterSegments)), materials.water);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -7, 10);
    water.name = 'Luminous subterranean pool';
    group.add(water);

    const backdrop = new THREE.Mesh(own(new THREE.PlaneGeometry(240, 150)), materials.backdrop);
    backdrop.position.set(0, 15, -114);
    backdrop.name = 'Sanctuary atmosphere';
    group.add(backdrop);

    if (materials.mist) {
        const mistGeometry = own(new THREE.PlaneGeometry(104, 18));
        [-25, -48, -74, -100].forEach((z, index) => {
            const mist = new THREE.Mesh(mistGeometry, materials.mist);
            mist.position.set(index % 2 ? 6 : -5, -3.2 + index * 0.6, z);
            mist.scale.set(1 + index * 0.16, 0.7 + index * 0.12, 1);
            mist.name = `Pool mist layer ${index + 1}`;
            mist.renderOrder = index;
            group.add(mist);
        });
    }
    if (materials.shaft) {
        const shaftGeometry = own(new THREE.PlaneGeometry(1, 1));
        [[-21, 11, -32, 5.2, 37, -0.3], [24, 13, -48, 6.1, 42, 0.26], [-4, 20, -88, 5.8, 34, -0.1]]
            .forEach(([x, y, z, width, height, angle], index) => {
                const shaft = new THREE.Mesh(shaftGeometry, materials.shaft);
                shaft.position.set(x, y, z);
                shaft.scale.set(width, height, 1);
                shaft.rotation.z = angle;
                shaft.name = `Mineral light shaft ${index + 1}`;
                group.add(shaft);
            });
    }

    // Sparse, authored seams connect the minerals to their surrounding cave stone.
    if (materials.vein) {
        const veinGeometry = own(new THREE.CylinderGeometry(1, 1, 1, 3, 1, true));
        const seams = [];
        const seamRandom = seededRandom(8145);
        [-1, 1].forEach((side) => {
            for (let i = 0; i < 5; i++) {
                let start = new THREE.Vector3(side * (24 + i * 2.1), -5 + i * 3.8, -12 - i * 9);
                for (let j = 0; j < 4; j++) {
                    const direction = new THREE.Vector3(
                        side * (0.2 + seamRandom() * 1.8),
                        1.3 + seamRandom() * 2.6,
                        -0.4 - seamRandom() * 1.2,
                    );
                    const end = start.clone().add(direction);
                    seams.push({ start, end, side });
                    start = end;
                }
            }
        });
        const veinMesh = new THREE.InstancedMesh(veinGeometry, materials.vein, seams.length);
        const up = new THREE.Vector3(0, 1, 0);
        seams.forEach(({ start, end, side }, index) => {
            const direction = end.clone().sub(start);
            dummy.position.copy(start).add(end).multiplyScalar(0.5);
            dummy.quaternion.setFromUnitVectors(up, direction.clone().normalize());
            dummy.scale.set(0.027, direction.length(), 0.027);
            dummy.updateMatrix();
            veinMesh.setMatrixAt(index, dummy.matrix);
            veinMesh.setColorAt(index, new THREE.Color(side < 0 ? GEM_PALETTE[0] : GEM_PALETTE[1]));
        });
        veinMesh.instanceMatrix.needsUpdate = true;
        veinMesh.instanceColor.needsUpdate = true;
        veinMesh.computeBoundingSphere();
        veinMesh.name = 'Bioluminescent mineral seams';
        group.add(veinMesh);
    }

    let disposed = false;
    return {
        group,
        anchors,
        crystalCount: formations.length,
        dispose() {
            if (disposed) return;
            disposed = true;
            group.removeFromParent();
            group.traverse((object) => {
                if (object.isInstancedMesh) object.dispose();
            });
            geometries.forEach((geometry) => geometry.dispose());
            geometries.clear();
            group.clear();
        },
    };
}
