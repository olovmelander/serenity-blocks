/* eslint-disable import/no-unresolved */
import * as THREE from 'three/webgpu';
import {
    abs, atan, clamp, cos, exp, length, mix, pow, screenUV,
    sin, smoothstep, texture, uniform, uv, vec2, vec3,
} from 'three/tsl';

const TAU = Math.PI * 2;

// The same authored arc families survive a narrow viewport; only their horizontal
// span changes. Keep the loom above the board and the silk at its sides.
export function getAstralWeaveLayout(aspect) {
    return { span: Math.min(1, Math.max(0.26, aspect / 1.5)), nexusScale: aspect < 0.8 ? 0.74 : 1 };
}

export function buildAstralRibbonCurve(index, total, origin = new THREE.Vector3(4, 21, -24)) {
    const side = index % 2 === 0 ? -1 : 1;
    const lane = Math.floor(index / 2);
    const families = Math.max(1, Math.ceil(total / 2));
    const fan = (lane / families - 0.4) * 9;
    const depth = Math.sin(lane * 1.8) * 5;
    return new THREE.CatmullRomCurve3([
        origin.clone().add(new THREE.Vector3(side * 0.6, lane * 0.12, lane * -0.3)),
        new THREE.Vector3(side * (16 + fan), 26 + Math.sin(lane * 0.8) * 3, -30 + depth),
        new THREE.Vector3(side * (24 + fan), 10 + Math.cos(lane) * 4, -25 - depth),
        new THREE.Vector3(side * (26 + fan), -12 + Math.sin(lane * 1.3) * 5, -30 + depth),
        new THREE.Vector3(side * (43 + fan), -32, -22 - depth),
    ], false, 'catmullrom', 0.4);
}

// A real two-dimensional strip, with a slowly twisting cross-section. UV.x runs
// from the loom to the edge, UV.y crosses the fabric. No per-frame geometry work.
export function buildAstralSilkGeometry(curve, segments, width, phase = 0) {
    const crossSegments = 6;
    const positions = [];
    const uvs = [];
    const indices = [];
    const frames = curve.computeFrenetFrames(segments, false);
    for (let i = 0; i <= segments; i += 1) {
        const u = i / segments;
        const center = curve.getPointAt(u);
        const twist = Math.sin(u * TAU * 1.3 + phase) * 0.72;
        const axis = frames.normals[i].clone().multiplyScalar(Math.cos(twist))
            .addScaledVector(frames.binormals[i], Math.sin(twist));
        const taper = 0.14 + Math.sin(u * Math.PI) ** 0.7 * 0.86;
        for (let j = 0; j <= crossSegments; j += 1) {
            const v = j / crossSegments;
            const fold = Math.sin(v * Math.PI) * Math.sin(u * 12 + phase) * width * 0.12;
            const point = center.clone().addScaledVector(axis, (v - 0.5) * width * taper)
                .addScaledVector(frames.binormals[i], fold);
            positions.push(point.x, point.y, point.z);
            uvs.push(u, v);
            if (i < segments && j < crossSegments) {
                const a = i * (crossSegments + 1) + j;
                const b = a + crossSegments + 1;
                indices.push(a, b, a + 1, b, b + 1, a + 1);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

// Periodic baked cloud detail keeps both backends on a small texture graph instead
// of compiling an expensive, repeated fragment noise function.
export function bakeAstralCloudTexture(size = 128) {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const u = (x / size) * TAU;
            const v = (y / size) * TAU;
            for (let c = 0; c < 3; c += 1) {
                const p = c * 2.17;
                let value = 0;
                let weight = 0;
                for (let octave = 0; octave < 5; octave += 1) {
                    const f = 2 ** octave;
                    const amplitude = 0.5 ** octave;
                    value += (Math.sin(u * f + Math.cos(v * f) * 1.2 + p)
                        * Math.cos(v * f - Math.sin(u * f) * 0.8 - p)) * amplitude;
                    weight += amplitude;
                }
                data[(y * size + x) * 4 + c] = Math.round((0.5 + (value / weight) * 0.5) * 255);
            }
            data[(y * size + x) * 4 + 3] = 255;
        }
    }
    const result = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    result.wrapS = THREE.RepeatWrapping;
    result.wrapT = THREE.RepeatWrapping;
    result.minFilter = THREE.LinearFilter;
    result.magFilter = THREE.LinearFilter;
    result.generateMipmaps = false;
    result.needsUpdate = true;
    return result;
}

export class AstralWeaveWorld {
    constructor(scene, root, origin) {
        this.scene = scene;
        this.root = root;
        this.origin = origin.clone();
        this.objects = [];
        this.cloudTexture = bakeAstralCloudTexture();
        this.uniforms = {
            time: uniform(0),
            aspect: uniform(1),
            charge: uniform(0),
            crown: uniform(0),
            line: uniform(0),
            hue: uniform(0),
        };
    }

    build() {
        const u = this.uniforms;
        const q = screenUV.sub(0.5).mul(vec2(u.aspect, 1));
        const drift = vec2(u.time.mul(0.0025), u.time.mul(-0.0015));
        const broad = texture(this.cloudTexture, q.mul(0.55).add(drift).add(0.37)).rgb;
        const detail = texture(this.cloudTexture, q.mul(1.7).sub(drift.mul(1.8))).rgb;
        const warp = broad.r.sub(0.5).mul(0.18);
        const bandA = exp(pow(abs(q.y.sub(q.x.mul(0.28)).sub(0.18).add(warp)), 2).mul(-36));
        const bandB = exp(pow(abs(q.y.add(q.x.mul(0.32)).add(0.24).sub(warp)), 2).mul(-24));
        const clouds = smoothstep(0.25, 0.72, broad.g.mul(0.7).add(detail.r.mul(0.3)));
        const boardQuiet = smoothstep(0.12, 0.48, abs(q.x)).mul(0.65).add(0.35);
        const cyan = vec3(0.045, 0.34, 0.42);
        const violet = vec3(0.21, 0.065, 0.39);
        const rose = vec3(0.39, 0.08, 0.22);
        const skyColor = vec3(0.004, 0.009, 0.023)
            .add(mix(violet, cyan, broad.b).mul(bandA).mul(clouds).mul(0.38))
            .add(mix(violet, rose, detail.b).mul(bandB).mul(clouds).mul(0.28))
            .mul(boardQuiet)
            .mul(u.charge.mul(0.6).add(1));
        const skyMaterial = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false });
        skyMaterial.colorNode = skyColor;
        skyMaterial.fog = false;
        const sky = new THREE.Mesh(new THREE.PlaneGeometry(1000, 700), skyMaterial);
        sky.position.z = -220;
        sky.renderOrder = -100;
        sky.frustumCulled = false;
        sky.name = 'astral-woven-nebula';
        this.scene.add(sky);
        this.objects.push(sky);

        const p = uv().sub(0.5).mul(2);
        const radius = length(p);
        const angle = atan(p.y, p.x);
        const petal = sin(angle.mul(9).add(u.time.mul(0.12))).mul(0.017);
        const ring = exp(pow(abs(radius.sub(0.54).add(petal)), 2).mul(-1800));
        const innerRing = exp(pow(abs(radius.sub(0.35).sub(petal.mul(0.5))), 2).mul(-2300));
        const corona = exp(radius.mul(-4.8)).mul(0.11);
        const sweep = pow(sin(angle.mul(3).sub(u.time.mul(0.24))).mul(0.5).add(0.5), 12);
        const rays = pow(abs(cos(angle.mul(18).add(u.time.mul(0.08)))), 28)
            .mul(exp(pow(abs(radius.sub(0.6)), 2).mul(-42))).mul(u.crown);
        const color = mix(vec3(0.22, 0.65, 0.85), vec3(1, 0.63, 0.24), u.hue.mul(0.85))
            .add(vec3(0.26, 0.12, 0.38).mul(sin(angle.mul(2)).mul(0.5).add(0.5)));
        const haloMaterial = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const energy = ring.mul(sweep.mul(0.4).add(0.25)).add(innerRing.mul(0.22))
            .add(corona).add(rays.mul(0.8))
            .mul(u.crown.mul(0.65).add(u.line.mul(0.12)).add(0.65));
        haloMaterial.colorNode = color.mul(energy.mul(1.5));
        haloMaterial.emissiveNode = color.mul(energy);
        haloMaterial.opacityNode = clamp(energy.mul(1.5), 0, 0.8);
        haloMaterial.fog = false;
        haloMaterial.forceSinglePass = true;
        const halo = new THREE.Mesh(new THREE.PlaneGeometry(25, 25), haloMaterial);
        halo.position.copy(this.origin).add(new THREE.Vector3(0, 0, -2));
        halo.name = 'astral-loom-corona';
        halo.renderOrder = 4;
        this.root.add(halo);
        this.objects.push(halo);
        this.halo = halo;

        const starUV = uv().sub(0.5);
        const starRadius = length(starUV);
        const starCore = exp(starRadius.mul(-24));
        const cross = exp(abs(starUV.x).mul(-110)).mul(exp(abs(starUV.y).mul(-14)))
            .add(exp(abs(starUV.y).mul(-110)).mul(exp(abs(starUV.x).mul(-14))));
        const starMaterial = new THREE.MeshBasicNodeMaterial({
            transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        });
        starMaterial.colorNode = vec3(0.68, 0.85, 1).mul(1.8);
        starMaterial.emissiveNode = vec3(0.35, 0.65, 1).mul(starCore);
        starMaterial.opacityNode = clamp(starCore.add(cross.mul(0.28))
            .mul(u.crown.mul(0.8).add(0.7)), 0, 1);
        starMaterial.fog = false;
        const anchors = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), starMaterial, 96);
        const dummy = new THREE.Object3D();
        for (let i = 0; i < anchors.count; i += 1) {
            const hash = (n) => { const a = Math.sin(n * 127.1 + 311.7) * 43758.5453; return a - Math.floor(a); };
            dummy.position.set((hash(i + 1) - 0.5) * 240, (hash(i + 101) - 0.5) * 140, -110 - hash(i + 201) * 55);
            dummy.scale.setScalar(i % 9 === 0 ? 1.65 : 0.4 + hash(i + 301) * 0.8);
            dummy.updateMatrix();
            anchors.setMatrixAt(i, dummy.matrix);
        }
        anchors.instanceMatrix.needsUpdate = true;
        anchors.frustumCulled = false;
        anchors.name = 'astral-constellation-jewels';
        this.scene.add(anchors);
        this.objects.push(anchors);
        return this;
    }

    resize(aspect) {
        this.uniforms.aspect.value = aspect;
        const layout = getAstralWeaveLayout(aspect);
        this.halo.scale.set(layout.nexusScale / layout.span, layout.nexusScale, layout.nexusScale);
    }

    update(time, signals = {}, camera = null) {
        const u = this.uniforms;
        u.time.value = time;
        u.charge.value = signals.weaveCharge || 0;
        u.crown.value = signals.crownPulse || 0;
        u.line.value = signals.linePulse || 0;
        u.hue.value = signals.eventHue || 0;
        if (camera) this.halo.quaternion.copy(camera.quaternion);
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.objects.forEach((object) => {
            object.removeFromParent();
            object.dispose?.();
            object.geometry.dispose();
            object.material.dispose();
        });
        this.cloudTexture.dispose();
        this.objects = [];
    }
}
