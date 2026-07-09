/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Winter Landscape Playground Effect.
 * Combines low-poly terrain, snowy ground banks, a frozen lake with ice cracks,
 * snow-draped pine trees, low-poly sky clouds, a large glowing moon, and volumetric auroras.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, float, vec2, vec3, vec4, uniform,
    mix, clamp, abs, fract, sin, cos, smoothstep, max, pow, exp, dot,
    normalize, positionWorld, cameraPosition, normalWorld, uv,
} from 'three/tsl';

import {
    createWinterTreeFoliageNodeMaterial,
    createWinterLakeNodeMaterial,
    createWinterMountainNodeMaterial,
    createWinterGroundNodeMaterial,
    createWinterMoonNodeMaterial,
} from '../../themes/winter/winter-materials.js';

export const meta = {
    id: 'winter-landscape',
    title: 'Winter Landscape Upgrade',
    description: 'Upgraded winter environment with low-poly mountains, trees, frozen lake, and volumetric aurora.',
};

function createIceCracksTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, size, size);

    // Draw crack lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const points = [];
    const numNodes = 12;
    for (let i = 0; i < numNodes; i++) {
        points.push({
            x: Math.random() * size,
            y: Math.random() * size,
        });
    }

    for (let i = 0; i < numNodes; i++) {
        const p1 = points[i];
        const targets = points
            .map((p, idx) => ({ idx, dist: Math.hypot(p.x - p1.x, p.y - p1.y) }))
            .filter((t) => t.idx !== i)
            .sort((a, b) => a.dist - b.dist)
            .slice(0, 2);

        targets.forEach((t) => {
            const p2 = points[t.idx];
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            const steps = 3 + Math.floor(Math.random() * 2);
            for (let s = 1; s <= steps; s++) {
                const ratio = s / steps;
                const tx = p1.x + (p2.x - p1.x) * ratio + (Math.random() - 0.5) * 25;
                const ty = p1.y + (p2.y - p1.y) * ratio + (Math.random() - 0.5) * 25;
                ctx.lineTo(tx, ty);
            }
            ctx.stroke();
        });
    }

    // Minor cracks
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1.0;
    for (let i = 0; i < 15; i++) {
        const startNode = points[Math.floor(Math.random() * points.length)];
        ctx.beginPath();
        ctx.moveTo(startNode.x, startNode.y);
        const steps = 3;
        const angle = Math.random() * Math.PI * 2;
        const length = 40 + Math.random() * 50;
        for (let s = 1; s <= steps; s++) {
            const ratio = s / steps;
            const dist = length * ratio;
            const tx = startNode.x + Math.cos(angle + (Math.random() - 0.5) * 0.6) * dist;
            const ty = startNode.y + Math.sin(angle + (Math.random() - 0.5) * 0.6) * dist;
            ctx.lineTo(tx, ty);
        }
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 2);
    texture.needsUpdate = true;
    return texture;
}

function createPineTree(foliageMaterial, height = 80) {
    const group = new THREE.Group();

    // Trunk (Low-poly cylinder)
    const trunkHeight = height * 0.22;
    const trunkRadius = height * 0.045;
    const trunkGeo = new THREE.CylinderGeometry(trunkRadius * 0.8, trunkRadius, trunkHeight, 5);
    const trunkMat = new THREE.MeshBasicNodeMaterial();
    trunkMat.colorNode = vec3(0.16, 0.12, 0.09); // dark trunk
    const trunk = new THREE.Mesh(trunkGeo.toNonIndexed(), trunkMat);
    trunk.position.y = trunkHeight * 0.5;
    group.add(trunk);

    // Foliage layers (3 cones stacked)
    const coneCount = 3;
    const baseRadius = height * 0.28;
    const coneHeight = height * 0.36;

    for (let i = 0; i < coneCount; i++) {
        const radius = baseRadius * Math.pow(0.75, i);
        const cheight = coneHeight * Math.pow(0.85, i);
        const coneGeo = new THREE.ConeGeometry(radius, cheight, 5);

        const nonIndexedGeo = coneGeo.toNonIndexed();
        nonIndexedGeo.computeVertexNormals();

        const cone = new THREE.Mesh(nonIndexedGeo, foliageMaterial);
        const yPos = trunkHeight + (coneHeight * 0.42) * i;
        cone.position.y = yPos + cheight * 0.5;
        cone.rotation.y = Math.random() * Math.PI;
        group.add(cone);
    }

    return group;
}

function createCloud(cloudMaterial, scale = 1.0) {
    const group = new THREE.Group();
    const sphereCount = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < sphereCount; i++) {
        const radius = (20 + Math.random() * 25) * scale;
        const geo = new THREE.SphereGeometry(radius, 8, 6);
        const mesh = new THREE.Mesh(geo.toNonIndexed(), cloudMaterial);

        mesh.position.set(
            (i - sphereCount * 0.5) * radius * 0.72 + (Math.random() - 0.5) * 12,
            (Math.random() - 0.5) * 8,
            (Math.random() - 0.5) * 12,
        );
        group.add(mesh);
    }
    return group;
}

function createFlatNodeMaterial(color, opacity = 1.0) {
    const material = new THREE.MeshBasicNodeMaterial();
    const c = new THREE.Color(color);
    material.colorNode = vec3(c.r, c.g, c.b);
    if (opacity < 1.0) {
        material.transparent = true;
        material.opacityNode = float(opacity);
        material.depthWrite = false;
    }
    return material;
}

function createMatteSnowBank(points, color, z, renderOrder) {
    const shape = new THREE.Shape();
    shape.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        shape.lineTo(points[i].x, points[i].y);
    }
    shape.closePath();

    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), createFlatNodeMaterial(color));
    mesh.position.z = z;
    mesh.renderOrder = renderOrder;
    return mesh;
}

function createReferenceAuroraCurtainMaterial(offset, strength = 1.0) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.toneMapped = false;

    const uTime = uniform(0);
    const uOffset = uniform(offset);
    const uStrength = uniform(strength);
    const vUv = uv();

    const lowerGlow = smoothstep(0.0, 0.16, vUv.y);
    const upperFade = float(1.0).sub(smoothstep(0.28, 0.88, vUv.y));
    const vertical = lowerGlow.mul(upperFade);
    const band = sin(vUv.x.mul(42.0).add(uOffset).add(uTime.mul(0.12))).mul(0.5).add(0.5);
    const broad = sin(vUv.x.mul(12.0).add(uOffset.mul(0.6))).mul(0.5).add(0.5);
    const fine = sin(vUv.x.mul(86.0).add(uOffset.mul(1.7)).sub(uTime.mul(0.08))).mul(0.5).add(0.5);
    const column = smoothstep(0.16, 0.94, broad).mul(0.45).add(smoothstep(0.42, 0.96, band).mul(0.42)).add(0.16);
    const raggedTop = float(1.0).sub(smoothstep(0.42, 0.86, vUv.y.add(band.mul(0.08)).add(fine.mul(0.04))));
    const alpha = vertical
        .mul(raggedTop)
        .mul(column)
        .mul(float(0.32).add(fine.mul(0.1)))
        .mul(uStrength);

    const base = vec3(0.02, 0.92, 0.72);
    const top = vec3(0.18, 0.62, 1.0);
    const color = mix(base, top, smoothstep(0.2, 0.9, vUv.y)).mul(float(1.2).add(band.mul(0.25)));

    material.colorNode = color.mul(1.08);
    material.opacityNode = clamp(alpha, 0.0, 0.72);
    material.emissiveNode = color.mul(alpha.mul(1.4));

    return { material, uniforms: { uTime } };
}

function createRock(rockMaterial, scale = 1.0) {
    const group = new THREE.Group();
    const count = 3;
    for (let i = 0; i < count; i++) {
        const radius = (18 + Math.random() * 18) * scale;
        const geo = new THREE.DodecahedronGeometry(radius, 1);
        const mesh = new THREE.Mesh(geo.toNonIndexed(), rockMaterial);
        mesh.position.set(
            (i - count * 0.5) * radius * 0.45 + (Math.random() - 0.5) * 8,
            (Math.random() - 0.5) * 4,
            (Math.random() - 0.5) * 8,
        );
        mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        group.add(mesh);
    }
    return group;
}

function createTwig(scale = 1.0) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = vec3(0.09, 0.06, 0.04);

    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
        const height = (15 + Math.random() * 15) * scale;
        const geo = new THREE.CylinderGeometry(0.3, 0.8, height, 4);
        const branch = new THREE.Mesh(geo.toNonIndexed(), mat);
        branch.position.y = height * 0.5;
        branch.rotation.set(
            (Math.random() - 0.5) * 0.9,
            Math.random() * Math.PI,
            (Math.random() - 0.5) * 0.9,
        );
        group.add(branch);
    }
    return group;
}

function createBareSapling(scale = 1.0) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = vec3(0.025, 0.04, 0.08);

    const addBranch = (length, radius, x, y, rotZ, rotX = 0) => {
        const geo = new THREE.CylinderGeometry(radius * 0.5, radius, length, 5);
        const branch = new THREE.Mesh(geo.toNonIndexed(), mat);
        branch.position.set(x * scale, y * scale, 0);
        branch.rotation.set(rotX, 0, rotZ);
        group.add(branch);
    };

    addBranch(92, 1.6, 0, 42, -0.24, 0.1);
    addBranch(56, 1.0, -17, 72, 0.72, -0.15);
    addBranch(52, 0.9, 18, 62, -0.82, 0.08);
    addBranch(38, 0.75, -28, 50, 0.95, -0.12);
    addBranch(34, 0.7, 30, 42, -1.05, 0.16);

    return group;
}

export function create({ scene, camera }) {
    const group = new THREE.Group();
    scene.add(group);

    const uTime = uniform(0);
    const uIntensity = uniform(1.0);
    const uScale = uniform(1.0);
    const uFlare = uniform(0.0);
    const uAccent = uniform(new THREE.Color(0x13cad6));
    const uMoonDir = uniform(new THREE.Vector3(870, 565, -1180).normalize());

    // --- Starfield ---
    const starCount = 1000;
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
        const i3 = i * 3;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 2500 + Math.random() * 500;
        starPos[i3] = r * Math.sin(phi) * Math.cos(theta);
        starPos[i3 + 1] = Math.abs(r * Math.sin(phi) * Math.sin(theta));
        starPos[i3 + 2] = r * Math.cos(phi);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsNodeMaterial();
    starMat.sizeNode = float(1.8);
    starMat.colorNode = vec3(0.9, 0.96, 1.0);
    starMat.opacityNode = float(0.28).add(sin(uTime.mul(2.0)).mul(0.12));
    starMat.transparent = true;
    starMat.blending = THREE.AdditiveBlending;
    const starPoints = new THREE.Points(starGeo, starMat);
    group.add(starPoints);

    // --- Raymarched Volumetric Aurora Dome ---
    const STEPS = 32;
    const driftSpeed = float(0.35);
    const rot = Fn(([p, a]) => {
        const c = cos(a);
        const s = sin(a);
        return vec2(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)));
    });
    const tri = Fn(([x]) => clamp(abs(fract(x).sub(0.5)), 0.01, 0.49));
    const triNoise2d = Fn(([pIn, spd]) => {
        const t = uTime.mul(spd);
        const p = pIn.toVar();
        p.assign(rot(p, p.x.mul(0.06)));
        const bp = p.toVar();
        const z = float(1.8).toVar();
        const z2 = float(2.5).toVar();
        const rz = float(0.0).toVar();
        Loop(5, () => {
            const b2 = bp.mul(2.0);
            const dg = rot(
                vec2(tri(b2.x).add(tri(b2.y)), tri(b2.y.add(tri(b2.x)))).mul(0.8),
                t,
            ).toVar();
            p.subAssign(dg.div(z2));
            bp.mulAssign(1.6);
            z2.mulAssign(0.6);
            z.mulAssign(1.8);
            p.mulAssign(1.2);
            rz.addAssign(tri(p.x.add(tri(p.y))).div(z));
        });
        return rz;
    });

    const aurora = Fn(([rd]) => {
        const col = vec4(0.0).toVar();
        const avgCol = vec4(0.0).toVar();
        const ry = max(rd.y, 0.012);
        Loop(STEPS, ({ i }) => {
            const fi = float(i);
            const pt = float(0.8).add(pow(fi, 1.4).mul(0.0045)).div(ry.mul(2.0).add(0.4));
            const bpos = rd.mul(pt);
            const drift = vec2(uTime.mul(driftSpeed), uTime.mul(driftSpeed.mul(0.25)));
            const samplePos = bpos.zx.mul(3.5).add(drift); // slightly wider columns (3.5 instead of 4.5)
            const raw = triNoise2d(samplePos, 0.14);
            const rzt = pow(clamp(raw.sub(0.12).mul(1.4), 0.0, 1.0), float(3.0)); // sharper power 3.0
            const rgbBase = vec3(2.15, -0.5, 1.2).negate().add(1.0).add(fi.mul(0.043))
                .sin()
                .mul(0.5)
                .add(0.5);
            const col2 = vec4(rgbBase.mul(rzt), rzt);
            avgCol.assign(mix(avgCol, col2, 0.5));
            const fade = exp(fi.mul(-0.06).sub(1.5)).mul(smoothstep(0.0, 2.0, fi));
            col.addAssign(avgCol.mul(fade));
        });
        col.mulAssign(clamp(rd.y.mul(18.0).add(0.1), 0.0, 1.0));
        return col.mul(0.48);
    });

    const rd = normalize(positionWorld.sub(cameraPosition));
    const nightTop = vec3(0.001, 0.006, 0.04); // Saturated moonlit midnight blue
    const nightHorizon = vec3(0.004, 0.03, 0.09); // Dark cyan-blue horizon glow
    const sky = mix(nightHorizon, nightTop, clamp(rd.y, 0.0, 1.0));

    const moonCos = clamp(dot(rd, normalize(uMoonDir)), 0.0, 1.0);
    const moonGlow = vec3(0.24, 0.38, 0.62).mul(pow(moonCos, float(72.0)).mul(0.5))
        .add(vec3(0.08, 0.13, 0.24).mul(pow(moonCos, float(10.0)).mul(0.12)));

    const auro = aurora(rd);
    const auLuma = dot(auro.rgb, vec3(0.299, 0.587, 0.114));
    const saturated = mix(vec3(auLuma), auro.rgb, 1.25);
    const greenBias = saturated.mul(vec3(0.55, 1.0, 0.88)); // Beautiful vibrant cyan/green bias
    const flared = mix(greenBias, vec3(uAccent).mul(auro.a), clamp(uFlare.mul(0.5), 0.0, 0.8));
    const auroraRGB = clamp(flared.mul(0.52), 0.0, 5.0);

    const glowBand = smoothstep(0.0, 0.1, rd.y).mul(smoothstep(0.46, 0.08, rd.y));
    const baseGlow = vec3(0.08, 0.5, 0.44).mul(glowBand).mul(0.32);

    const skyColor = clamp(sky.add(moonGlow).add(auroraRGB).add(baseGlow), 0.0, 5.0);
    const skyMat = new THREE.MeshBasicNodeMaterial();
    skyMat.colorNode = skyColor;
    skyMat.side = THREE.BackSide;
    skyMat.depthWrite = false;
    skyMat.toneMapped = false;

    const skyGeo = new THREE.SphereGeometry(3000, 64, 32);
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    skyMesh.frustumCulled = false;
    group.add(skyMesh);

    // --- Reference-style vertical aurora columns ---
    const auroraCurtains = [];
    const curtainSpecs = [
        {
            x: 0, w: 4700, h: 1040, y: 185, z: -1760, s: 1.05,
        },
    ];
    curtainSpecs.forEach((spec, i) => {
        const { material, uniforms } = createReferenceAuroraCurtainMaterial(i * 1.73, spec.s);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spec.w, spec.h, 1, 1), material);
        mesh.position.set(spec.x, spec.y, spec.z);
        mesh.renderOrder = -900;
        group.add(mesh);
        auroraCurtains.push({ mesh, material, uniforms });
    });

    // --- Large Glowing Moon ---
    const moonGeo = new THREE.SphereGeometry(128, 32, 32);
    const { material: moonMat } = createWinterMoonNodeMaterial({ color: new THREE.Color(0xe8f2ff) });
    const moonMesh = new THREE.Mesh(moonGeo.toNonIndexed(), moonMat);
    moonMesh.position.set(870, 565, -1180);
    group.add(moonMesh);

    // --- Clouds around Moon ---
    const cloudMat = new THREE.MeshBasicNodeMaterial({
        colorNode: vec3(0.72, 0.82, 0.95), // Beautiful opaque sky-blue-white clouds
        opacityNode: float(0.92),
        transparent: true,
        depthWrite: false,
    });
    const clouds = [];
    const cloud1 = createCloud(cloudMat, 1.25);
    cloud1.position.set(720, 570, -1110);
    group.add(cloud1);
    clouds.push({ mesh: cloud1, offset: 0 });

    const cloud2 = createCloud(cloudMat, 0.85);
    cloud2.position.set(1040, 500, -1110);
    group.add(cloud2);
    clouds.push({ mesh: cloud2, offset: 3.14 });

    const cloud3 = createCloud(cloudMat, 1.4);
    cloud3.position.set(510, 650, -1160);
    group.add(cloud3);
    clouds.push({ mesh: cloud3, offset: 1.57 });

    // --- Low-Poly Mountains ---
    const ranges = [
        // Rich blue/indigo colors matching the reference photo
        {
            z: -2800, color: 0x0b315f, rockHi: 0x2874ad, height: 1080, width: 11000, snowStart: -260, snowRange: 500, fog: 0x125b82, density: 0.0001, index: 0,
        },
        {
            z: -2000, color: 0x0b3b73, rockHi: 0x2c80bd, height: 760, width: 8000, snowStart: -280, snowRange: 390, fog: 0x0d446d, density: 0.00006, index: 1,
        },
    ];

    ranges.forEach((range) => {
        const segs = 48; // lower segments for a beautiful low-poly look
        const geometry = new THREE.PlaneGeometry(range.width, range.height, segs, segs / 2);
        const posAttr = geometry.attributes.position;
        for (let i = 0; i < posAttr.count; i++) {
            const x = posAttr.getX(i);
            const y = posAttr.getY(i);
            const v = (y / range.height) + 0.5;

            let profile = 0;
            if (range.index === 0) { // Far range (z = -2800)
                const peaks = [
                    { x: -3500, h: 1000, w: 1400 },
                    { x: -1800, h: 800, w: 1000 },
                    { x: -600, h: 650, w: 900 },
                    { x: 250, h: 700, w: 1000 },
                    { x: 1200, h: 650, w: 900 },
                    { x: 2200, h: 800, w: 1100 },
                    { x: 3500, h: 1000, w: 1300 },
                ];
                peaks.forEach((p) => {
                    const dx = (x - p.x) / p.w;
                    profile += p.h * Math.exp(-dx * dx);
                });
            } else { // Close range (z = -2000)
                const peaks = [
                    { x: -2500, h: 650, w: 1000 },
                    { x: -1200, h: 500, w: 700 },
                    { x: -280, h: 900, w: 550 }, // Prominent center-left peak
                    { x: 450, h: 550, w: 600 },
                    { x: 1100, h: 420, w: 600 },
                    { x: 1900, h: 650, w: 900 },
                ];
                peaks.forEach((p) => {
                    const dx = (x - p.x) / p.w;
                    profile += p.h * Math.exp(-dx * dx);
                });
            }

            let noise = Math.sin(x * 0.008) * 35 + Math.sin(x * 0.025) * 12;
            let totalHeight = (profile * (range.index === 0 ? 0.48 : 0.56) + noise) * Math.pow(v, 1.25);

            if (v > 0.05) {
                posAttr.setY(i, y + totalHeight);
            }
        }

        let geoNonIndexed = geometry.toNonIndexed();
        geoNonIndexed.computeVertexNormals();

        const { material: mountainMaterial } = createWinterMountainNodeMaterial({
            baseColor: new THREE.Color(range.color),
            rockHi: new THREE.Color(range.rockHi),
            snowColor: new THREE.Color(0x94c3f4),
            snowStart: range.snowStart,
            snowRange: range.snowRange,
            fogColor: new THREE.Color(range.fog),
            fogDensity: range.density,
            rimColor: new THREE.Color(0x13c2db),
            rimStrength: 0.32,
        });

        const mesh = new THREE.Mesh(geoNonIndexed, mountainMaterial);
        mesh.position.set(0, range.index === 0 ? -760 : -745, range.z);
        group.add(mesh);
    });

    // --- Low-Poly Ground & Valley Shoreline ---
    const groundGeo = new THREE.PlaneGeometry(7000, 3200, 64, 32);
    const groundPos = groundGeo.attributes.position;
    for (let i = 0; i < groundPos.count; i++) {
        const x = groundPos.getX(i);
        const y = groundPos.getY(i); // pre-rotation depth

        const wx = x;
        const wz = -650 + y;

        // Define Lake boundaries
        const dx = Math.max(0, Math.abs(wx) - 1200);
        const dz = Math.max(0, Math.abs(wz - (-700)) - 400);
        const distToLake = Math.sqrt(dx * dx + dz * dz);

        let disp = -18;
        if (distToLake > 0) {
            disp += Math.min(220, distToLake * 0.16); // steeper slopes outside lake
        }

        // Low-poly hills undulations
        const noise = Math.sin(x * 0.004) * 35 + Math.sin(y * 0.006 + 1.2) * 22;
        if (distToLake > 60) {
            disp += noise * Math.min(1.0, (distToLake - 60) * 0.004);
        }

        groundPos.setZ(i, disp);
    }

    let groundGeoNonIndexed = groundGeo.toNonIndexed();
    groundGeoNonIndexed.computeVertexNormals();

    const { material: groundMat } = createWinterGroundNodeMaterial({
        baseColor: new THREE.Color(0x164271), // Deep blue-navy base
        snowColor: new THREE.Color(0xa9cef2), // Moonlit blue snow
        aurora: new THREE.Color(0x13cad6),
        fogColor: new THREE.Color(0x060e1b),
    });

    const groundMesh = new THREE.Mesh(groundGeoNonIndexed, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.set(0, -280, -650);
    group.add(groundMesh);

    // --- Frozen Lake with Cracks ---
    const lakeGeo = new THREE.PlaneGeometry(2500, 800, 8, 8);
    const cracksTex = createIceCracksTexture();
    cracksTex.repeat.set(1.2, 1.2); // Make cracks larger and less dense
    const { material: lakeMat } = createWinterLakeNodeMaterial({
        baseColor: new THREE.Color(0x06405a), // Deep turquoise depths
        lakeColor: new THREE.Color(0x21d9e7), // Vibrant turquoise center
        aurora: new THREE.Color(0x13cad6),
        fogColor: new THREE.Color(0x060e1b),
        map: cracksTex,
    });

    const lakeMesh = new THREE.Mesh(lakeGeo.toNonIndexed(), lakeMat);
    lakeMesh.rotation.x = -Math.PI / 2;
    // Flat ice plane sitting just above ground valley floor
    lakeMesh.position.set(0, -277, -700);
    group.add(lakeMesh);

    const lakeGlowMat = createFlatNodeMaterial(0x20f1df, 0.18);
    lakeGlowMat.blending = THREE.AdditiveBlending;
    const lakeGlow = new THREE.Mesh(new THREE.PlaneGeometry(2200, 480, 1, 1), lakeGlowMat);
    lakeGlow.rotation.x = -Math.PI / 2;
    lakeGlow.position.set(40, -274.5, -760);
    group.add(lakeGlow);

    const farSnowBank = createMatteSnowBank([
        { x: -2400, y: -220 },
        { x: -1600, y: -175 },
        { x: -900, y: -205 },
        { x: -220, y: -160 },
        { x: 520, y: -190 },
        { x: 1420, y: -150 },
        { x: 2400, y: -205 },
        { x: 2400, y: -650 },
        { x: -2400, y: -650 },
    ], 0x3d84b8, -185, 18);
    group.add(farSnowBank);

    const nearSnowBank = createMatteSnowBank([
        { x: -2400, y: -330 },
        { x: -1550, y: -295 },
        { x: -870, y: -350 },
        { x: -230, y: -310 },
        { x: 620, y: -355 },
        { x: 1520, y: -300 },
        { x: 2400, y: -340 },
        { x: 2400, y: -780 },
        { x: -2400, y: -780 },
    ], 0xb7d5f2, 210, 34);
    group.add(nearSnowBank);

    const frontSnowBank = createMatteSnowBank([
        { x: -2400, y: -500 },
        { x: -1750, y: -430 },
        { x: -1180, y: -475 },
        { x: -420, y: -430 },
        { x: 280, y: -470 },
        { x: 1040, y: -415 },
        { x: 2400, y: -470 },
        { x: 2400, y: -820 },
        { x: -2400, y: -820 },
    ], 0xd0e3f8, 450, 46);
    group.add(frontSnowBank);

    // --- Rock material ---
    const rockMat = createWinterMountainNodeMaterial({
        baseColor: new THREE.Color(0x091c36),
        rockHi: new THREE.Color(0x18355c),
        snowColor: new THREE.Color(0xcae0fd),
        snowStart: -276,
        snowRange: 30,
        fogColor: new THREE.Color(0x060e1b),
        fogDensity: 0.0008,
        rimColor: new THREE.Color(0x13c2db),
        rimStrength: 0.35,
    }).material;

    // Create rock outcrop in right foreground
    const rockOutcrop = createRock(rockMat, 2.35);
    rockOutcrop.position.set(780, -245, 105);
    group.add(rockOutcrop);

    // Create twigs
    const twig1 = createTwig(1.4);
    twig1.position.set(-250, -255, -230);
    group.add(twig1);

    const twig2 = createTwig(1.7);
    twig2.position.set(260, -260, -240);
    group.add(twig2);

    const rightSapling = createBareSapling(3.2);
    rightSapling.position.set(1160, -225, 35);
    rightSapling.rotation.y = -0.22;
    group.add(rightSapling);

    const centerSapling = createBareSapling(1.35);
    centerSapling.position.set(-170, -258, -215);
    centerSapling.rotation.y = 0.28;
    group.add(centerSapling);

    // --- Low-Poly Trees ---
    const foliageMat = createWinterTreeFoliageNodeMaterial({
        snowColor: new THREE.Color(0x9bc5f4), // Clean blue-white snow caps
        greenColor: new THREE.Color(0x03152d), // Deep cool blue-green foliage base
        fogColor: new THREE.Color(0x060e1b),
        fogDensity: 0.0008,
        moonDir: new THREE.Vector3(470, 330, -1050),
    }).material;
    const shoreFoliageMat = createFlatNodeMaterial(0x061b38, 0.98);

    // 1. Foreground groups (Left & Right) - Much larger and placed dramatically closer
    const fgTrees = [
        // Left foreground towering trees: off-axis frame like the reference.
        { x: -1180, z: 230, scale: 5.3 },
        { x: -980, z: 105, scale: 4.1 },
        { x: -760, z: -70, scale: 2.8 },
        // Right side support trees, smaller and pushed to the edge.
        { x: 1260, z: 175, scale: 4.4 },
        { x: 1010, z: -20, scale: 3.0 },
        { x: 760, z: -170, scale: 1.7 },
    ];
    fgTrees.forEach((t) => {
        const tree = createPineTree(foliageMat, 85 * t.scale);

        // Find ground height:
        const dx = Math.max(0, Math.abs(t.x) - 1200);
        const dz = Math.max(0, Math.abs(t.z - (-700)) - 400);
        const dist = Math.sqrt(dx * dx + dz * dz);
        let groundY = -280 - 18;
        if (dist > 0) {
            groundY += Math.min(220, dist * 0.16);
        }

        tree.position.set(t.x, groundY, t.z);
        group.add(tree);
    });

    // 2. Shoreline forest along the lake shore - medium/small size background trees
    const treeCount = 128;
    for (let i = 0; i < treeCount; i++) {
        const tree = createPineTree(shoreFoliageMat, 42 + Math.random() * 92);

        let tx = 0;
        let tz = 0;

        if (i < 78) {
            // Back shore (behind the lake)
            tx = -1950 + (i / 77) * 3900 + (Math.random() - 0.5) * 80;
            tz = -1135 + (Math.random() - 0.5) * 110;
        } else if (i < 102) {
            // Left shore
            tx = -1450 + (Math.random() - 0.5) * 110;
            tz = -1080 + ((i - 78) / 23) * 920;
        } else {
            // Right shore
            tx = 1450 + (Math.random() - 0.5) * 110;
            tz = -1080 + ((i - 102) / 25) * 920;
        }

        // Find ground height:
        const dx = Math.max(0, Math.abs(tx) - 1200);
        const dz = Math.max(0, Math.abs(tz - (-700)) - 400);
        const dist = Math.sqrt(dx * dx + dz * dz);
        let groundY = -280 - 18;
        if (dist > 0) {
            groundY += Math.min(220, dist * 0.16);
        }

        tree.position.set(tx, groundY, tz);
        group.add(tree);
    }

    camera.near = 0.5;
    camera.far = 10000;
    camera.updateProjectionMatrix();

    return {
        cameraRadius: 980,
        camera(time, cam) {
            // Cinematic wide view: shore foreground, lake mid-frame, aurora and
            // moon in the upper sky like the reference painting.
            const t = time * 0.05;
            cam.position.set(Math.sin(t) * 30, 48 + Math.sin(t * 0.7) * 9, 860);
            cam.lookAt(0, -74, -920);
        },
        update(time) {
            uTime.value = time;
            auroraCurtains.forEach((curtain) => {
                curtain.uniforms.uTime.value = time;
            });

            // Slow drift for clouds
            clouds.forEach((c) => {
                c.mesh.position.x += Math.sin(time * 0.05 + c.offset) * 0.06;
            });
        },
        dispose() {
            scene.remove(group);
            skyGeo.dispose();
            skyMat.dispose();
            moonGeo.dispose();
            moonMat.dispose();
            cloudMat.dispose();
            foliageMat.dispose();
            groundGeoNonIndexed.dispose();
            groundMat.dispose();
            lakeGeo.toNonIndexed().dispose();
            lakeMat.dispose();
            lakeGlow.geometry.dispose();
            lakeGlowMat.dispose();
            cracksTex.dispose();
            starGeo.dispose();
            starMat.dispose();
            auroraCurtains.forEach((curtain) => {
                curtain.mesh.geometry.dispose();
                curtain.material.dispose();
            });
        },
    };
}
