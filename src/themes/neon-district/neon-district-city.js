import * as THREE from 'three/webgpu';
import {
    abs, atan, float, fract, length, mix, positionWorld, sin, smoothstep, uniform, uv, vec2, vec3,
} from 'three/tsl';

/** Authored skyline accents: a civic hologram, transit currents, and street steam. */
export class NeonDistrictCity {
    constructor(scene, { quality = 'High', reducedMotion = false } = {}) {
        this.group = new THREE.Group();
        this.group.name = 'neon-district-city';
        this.time = uniform(0);
        this.charge = uniform(0);
        this.reducedMotion = reducedMotion;
        this.geometries = new Set();
        this.materials = new Set();
        this.disposed = false;
        const low = quality === 'Low' || quality === 'Minimal';
        const minimal = quality === 'Minimal';

        // The halo sits behind the civic tower: opaque architecture occludes it.
        // Broken telemetry segments, rather than a solid disk, preserve the skyline.
        const haloGeometry = this.keepGeometry(new THREE.RingGeometry(675, 702, low ? 72 : 128));
        const p = uv().sub(0.5).mul(2);
        const angle = atan(p.y, p.x);
        const segments = fract(angle.mul(12 / Math.PI));
        const segmentMask = smoothstep(0.02, 0.09, segments)
            .mul(float(1).sub(smoothstep(0.68, 0.83, segments)));
        const current = sin(angle.mul(3).sub(this.time.mul(0.55))).mul(0.5).add(0.5).pow(5);
        const halo = this.keepMaterial(new THREE.MeshBasicNodeMaterial({
            side: THREE.DoubleSide,
            transparent: true,
            forceSinglePass: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
        }));
        halo.colorNode = mix(vec3(0.03, 0.65, 1), vec3(1, 0.12, 0.47), current)
            .mul(this.charge.mul(0.5).add(0.8));
        halo.emissiveNode = halo.colorNode;
        halo.opacityNode = segmentMask.mul(0.65);
        const crown = new THREE.Mesh(haloGeometry, halo);
        crown.position.set(260, 2460, -6120);
        crown.rotation.set(0.06, -0.12, 0.16);
        this.group.add(crown);

        if (!minimal) {
            const inner = new THREE.Mesh(this.keepGeometry(new THREE.RingGeometry(615, 620, 96)), halo);
            inner.position.copy(crown.position);
            inner.rotation.copy(crown.rotation);
            inner.rotation.z += 0.7;
            this.group.add(inner);
        }

        // Thin, elevated transit lanes reveal depth without adding moving lights.
        // Each ribbon is one draw with an analytic travelling head and long tail.
        const ribbonMaterial = this.keepMaterial(new THREE.MeshBasicNodeMaterial({
            side: THREE.DoubleSide,
            transparent: true,
            forceSinglePass: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
        }));
        const laneUV = uv();
        const distanceToHead = fract(laneUV.x.sub(this.time.mul(0.032)).add(1));
        const head = float(1).sub(smoothstep(0.0, 0.13, distanceToHead));
        const edge = float(1).sub(abs(laneUV.y.sub(0.5)).mul(2)).pow(1.5);
        ribbonMaterial.colorNode = mix(
            vec3(0.04, 0.65, 1.2),
            vec3(1.2, 0.08, 0.4),
            sin(positionWorld.x.mul(0.004)).mul(0.5).add(0.5),
        ).mul(head.mul(1.5).add(0.22));
        ribbonMaterial.emissiveNode = ribbonMaterial.colorNode;
        ribbonMaterial.opacityNode = edge.mul(head.mul(0.6).add(0.16));
        let laneCount = 3;
        if (quality === 'Medium') laneCount = 2;
        if (low) laneCount = 1;
        for (let lane = 0; lane < laneCount; lane += 1) {
            const points = [];
            for (let i = 0; i < 16; i += 1) {
                const x = -1600 + i * (3200 / 15);
                points.push(new THREE.Vector3(
                    x,
                    420 + lane * 170 + Math.sin(i * 0.32) * 80,
                    -1200 - lane * 1000 - Math.cos(i * 0.24) * 190,
                ));
            }
            const curve = new THREE.CatmullRomCurve3(points);
            const geometry = this.keepGeometry(new THREE.TubeGeometry(curve, low ? 32 : 72, 2.5, 3, false));
            this.group.add(new THREE.Mesh(geometry, ribbonMaterial));
        }

        if (!low) {
            const steamMaterial = this.keepMaterial(new THREE.MeshBasicNodeMaterial({
                side: THREE.DoubleSide,
                transparent: true,
                forceSinglePass: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            }));
            const steamUV = uv();
            const drift = sin(steamUV.y.mul(8).sub(this.time.mul(0.16))).mul(0.045);
            const blob = length(steamUV.sub(vec2(0.5, 0.4)).add(vec2(drift, 0)).mul(vec2(2.8, 1.6)));
            const edgeFade = smoothstep(0, 0.2, steamUV.y)
                .mul(float(1).sub(smoothstep(0.78, 1, steamUV.y)));
            const mask = float(1).sub(smoothstep(0.12, 0.85, blob)).mul(edgeFade);
            const wisps = sin(steamUV.x.mul(15).add(steamUV.y.mul(9)).sub(this.time.mul(0.22)))
                .mul(0.16).add(0.7);
            steamMaterial.colorNode = mix(
                vec3(0.018, 0.18, 0.26),
                vec3(0.28, 0.035, 0.17),
                smoothstep(-100, 100, positionWorld.x),
            );
            steamMaterial.opacityNode = mask.mul(wisps).mul(0.24);
            steamMaterial.emissiveNode = steamMaterial.colorNode.mul(0.6);
            const steamGeometry = this.keepGeometry(new THREE.PlaneGeometry(140, 110));
            const steamCount = quality === 'Medium' ? 2 : 4;
            for (let i = 0; i < steamCount; i += 1) {
                const steam = new THREE.Mesh(steamGeometry, steamMaterial);
                steam.position.set(i % 2 === 0 ? -95 : 95, 48, -150 - i * 190);
                steam.rotation.y = i % 2 === 0 ? 0.25 : -0.25;
                this.group.add(steam);
            }
        }
        scene.add(this.group);
    }

    keepGeometry(geometry) { this.geometries.add(geometry); return geometry; }

    keepMaterial(material) { this.materials.add(material); return material; }

    update(time, charge = 0) {
        if (this.disposed) return;
        this.time.value = this.reducedMotion ? 0 : time;
        this.charge.value = Math.min(2, Math.max(0, charge));
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.group.removeFromParent();
        this.group.children.forEach((mesh) => mesh.dispose());
        this.geometries.forEach((geometry) => geometry.dispose());
        this.materials.forEach((material) => material.dispose());
        this.geometries.clear();
        this.materials.clear();
    }
}
