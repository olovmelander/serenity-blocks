/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Local orbital celebrations. All four draws reuse fixed instance/uniform pools;
 * the same node graphs render on WebGPU and the WebGL2 node backend.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cos, cross, exp, float, length, mix, normalize, pow,
    positionGeometry, screenUV, sin, smoothstep, uniform, uniformArray, uv,
    varying, vec2, vec3,
} from 'three/tsl';
import {
    STELLAR_DRIFT_COMET_CONTACT, STELLAR_DRIFT_REACTION_LIMITS, stellarDriftEventEnvelope,
} from './stellar-drift-reactions.js';

const TAU = Math.PI * 2;
const KIND = Object.freeze({ lock: 0, clear: 1, combo: 2 });
const clamp01 = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

function pooledGeometry(count, segments = 1) {
    const base = new THREE.PlaneGeometry(1, 1, segments, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.attributes = base.attributes;
    const slots = Float32Array.from({ length: count }, (_, index) => index);
    geometry.setAttribute('aEventSlot', new THREE.InstancedBufferAttribute(slots, 1));
    geometry.instanceCount = count;
    base.dispose();
    return geometry;
}

function effectMaterial(name) {
    const material = new THREE.MeshBasicNodeMaterial({
        fog: false,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    material.name = `stellar-drift-${name}`;
    material.emissiveNode = vec3(0);
    return material;
}

export class StellarDriftEventEffects {
    constructor({
        parent, orbitalParent = parent, camera, radius = 12.8, quality = 'High',
    }) {
        this.parent = parent;
        this.orbitalParent = orbitalParent;
        this.camera = camera;
        this.radius = Number.isFinite(radius) && radius > 0 ? radius : 12.8;
        this.quality = quality;
        const limits = STELLAR_DRIFT_REACTION_LIMITS[quality] || STELLAR_DRIFT_REACTION_LIMITS.High;
        this.maxArcs = limits.arcs;
        this.maxComets = limits.comets;
        this.group = new THREE.Group();
        this.group.name = 'stellar-drift-event-comets';
        this.orbitGroup = new THREE.Group();
        this.orbitGroup.name = 'stellar-drift-event-orbits';
        this.arcData = Array.from({ length: this.maxArcs }, () => new THREE.Vector4());
        this.arcMetadata = Array.from({ length: this.maxArcs }, () => new THREE.Vector4());
        this.cometData = Array.from({ length: this.maxComets }, () => new THREE.Vector4());
        this.impactData = Array.from({ length: this.maxComets }, () => new THREE.Vector4());
        this.cometTargetVectors = Array.from({ length: this.maxComets }, () => new THREE.Vector3());
        this.cometRadialVectors = Array.from({ length: this.maxComets }, () => new THREE.Vector3());
        this.cometTangentVectors = Array.from({ length: this.maxComets }, () => new THREE.Vector3());
        this.arcUniforms = uniformArray(this.arcData, 'vec4');
        this.arcMetadataUniforms = uniformArray(this.arcMetadata, 'vec4');
        this.cometUniforms = uniformArray(this.cometData, 'vec4');
        this.impactUniforms = uniformArray(this.impactData, 'vec4');
        this.targetUniforms = uniformArray(this.cometTargetVectors, 'vec3');
        this.radialUniforms = uniformArray(this.cometRadialVectors, 'vec3');
        this.tangentUniforms = uniformArray(this.cometTangentVectors, 'vec3');
        this.contactNormal = new THREE.Vector3(0, 0, 1);
        this.contactNormalNode = uniform(this.contactNormal);
        this.contactU = new THREE.Vector3(1, 0, 0);
        this.contactV = new THREE.Vector3(0, 1, 0);
        this.contactUNode = uniform(this.contactU);
        this.contactVNode = uniform(this.contactV);
        this.localCamera = new THREE.Vector3();
        this.boardBounds = uniform(new THREE.Vector4(2, 2, 3, 3));
        this.built = false;
        this.disposed = false;
    }

    build() {
        if (this.built || this.disposed) return this;
        this.built = true;
        this.createOrbitalArcs();
        this.createCometRibbons();
        this.createCometHeads();
        this.createContactCoronas();
        this.parent.add(this.group);
        this.orbitalParent.add(this.orbitGroup);
        this.update(0, 0, {});
        return this;
    }

    boardMask() {
        const p = screenUV;
        const safe = this.boardBounds;
        const insideX = smoothstep(safe.x.sub(0.018), safe.x.add(0.012), p.x)
            .mul(float(1).sub(smoothstep(safe.z.sub(0.012), safe.z.add(0.018), p.x)));
        const insideY = smoothstep(safe.y.sub(0.018), safe.y.add(0.012), p.y)
            .mul(float(1).sub(smoothstep(safe.w.sub(0.012), safe.w.add(0.018), p.y)));
        return float(1).sub(insideX.mul(insideY).mul(0.92));
    }

    createOrbitalArcs() {
        const slot = attribute('aEventSlot', 'float').toInt();
        const arc = this.arcUniforms.element(slot);
        const info = this.arcMetadataUniforms.element(slot);
        const arcFlat = varying(arc, 'vDriftOrbitalArc').setInterpolation('flat');
        const infoFlat = varying(info, 'vDriftOrbitalArcInfo').setInterpolation('flat');
        const material = effectMaterial('orbital-shock-ribbons');
        material.positionNode = Fn(() => {
            const q = uv().toVar();
            const span = info.y.mul(0.25).add(info.z.mul(0.72)).add(0.42).toVar();
            const theta = arc.z.add(arc.x.mul(2.2).mul(arc.w))
                .add(q.x.sub(0.88).mul(span).mul(arc.w)).toVar();
            const width = info.y.mul(0.2).add(info.z.mul(0.9)).add(0.28).toVar();
            const radial = float(this.radius * 1.37).add(info.x.mul(2.0))
                .add(arc.x.mul(info.y.mul(0.35).add(1.7)))
                .add(q.y.sub(0.5).mul(width))
                .toVar();
            return vec3(
                cos(theta).mul(radial),
                sin(theta).mul(radial),
                sin(theta.mul(3).add(info.x.mul(TAU))).mul(0.11).add(0.14),
            ).mul(info.w);
        })();
        const q = uv();
        const across = abs(q.y.sub(0.5));
        const halo = exp(across.mul(-6));
        const core = exp(across.mul(-22));
        const taper = smoothstep(0, 0.12, q.x).mul(float(1).sub(smoothstep(0.88, 1, q.x)));
        const threads = sin(q.x.mul(58).add(infoFlat.x.mul(TAU))).mul(0.06).add(0.94);
        const warm = smoothstep(0.52, 0.90, q.x).mul(core);
        material.colorNode = mix(
            mix(vec3(0.12, 0.6, 1.7), vec3(0.2, 1.35, 1.85), infoFlat.x),
            vec3(2.5, 1.3, 0.48),
            warm,
        );
        material.opacityNode = halo.mul(0.30).add(core.mul(1.0))
            .mul(taper).mul(threads)
            .mul(arcFlat.y)
            .mul(this.boardMask());
        material.emissiveNode = material.colorNode.mul(material.opacityNode).mul(0.35);
        this.arcMesh = new THREE.Mesh(pooledGeometry(this.maxArcs, this.maxArcs > 4 ? 80 : 48), material);
        this.arcMesh.name = 'stellar-drift-orbital-event-arcs';
        this.arcMesh.frustumCulled = false;
        this.arcMesh.renderOrder = 7;
        this.orbitGroup.add(this.arcMesh);
    }

    createCometRibbons() {
        const slot = attribute('aEventSlot', 'float').toInt();
        const comet = this.cometUniforms.element(slot);
        const cometFlat = varying(comet, 'vDriftEventComet').setInterpolation('flat');
        const target = this.targetUniforms.element(slot);
        const radial = this.radialUniforms.element(slot);
        const tangent = this.tangentUniforms.element(slot);
        const material = effectMaterial('curved-comet-ribbons');
        material.positionNode = Fn(() => {
            const q = uv().toVar();
            const phase = comet.x.div(STELLAR_DRIFT_COMET_CONTACT).clamp(0, 1).toVar();
            const remaining = pow(float(1).sub(phase), 1.7)
                .add(float(0.96).sub(q.x).mul(0.20)).max(0).toVar();
            const outward = comet.z.mul(9).add(18).toVar();
            const sideways = comet.z.mul(8).add(10).toVar();
            const theta = remaining.mul(Math.PI * 0.5).toVar();
            const center = target.add(radial.mul(remaining.mul(remaining).mul(outward)))
                .add(tangent.mul(sin(theta).mul(sideways))).toVar();
            const derivative = radial.mul(remaining.mul(outward).mul(2))
                .add(tangent.mul(cos(theta).mul(sideways).mul(Math.PI * 0.5))).toVar();
            const across = normalize(cross(this.contactNormalNode, derivative)).toVar();
            const width = comet.y.mul(0.6).add(0.7)
                .mul(smoothstep(0, 0.96, q.x).mul(0.7).add(0.3));
            return center.add(across.mul(q.y.sub(0.5).mul(width)))
                .add(this.contactNormalNode.mul(0.055))
                .mul(smoothstep(0.0001, 0.0002, comet.y));
        })();
        const q = uv();
        const across = abs(q.y.sub(0.5));
        const thin = exp(across.mul(-14));
        const plume = exp(across.mul(-5));
        const head = exp(length(q.sub(vec2(0.96, 0.5)).mul(vec2(7, 1))).mul(-18));
        const tail = pow(q.x, 1.2).mul(smoothstep(0, 0.045, q.x));
        const flicker = sin(q.x.mul(65).add(cometFlat.z.mul(TAU))).mul(0.045).add(0.955);
        const fade = smoothstep(0, 0.055, cometFlat.x)
            .mul(float(1).sub(smoothstep(STELLAR_DRIFT_COMET_CONTACT, 0.88, cometFlat.x)));
        material.colorNode = mix(
            mix(vec3(0.12, 0.65, 1.65), vec3(0.48, 0.22, 1.6), cometFlat.z),
            vec3(2.0, 1.35, 0.6),
            smoothstep(0.65, 0.98, q.x).mul(0.5).add(head.mul(0.5)),
        );
        material.opacityNode = thin.mul(0.78).add(plume.mul(0.23)).mul(tail).mul(flicker)
            .add(head.mul(0.25))
            .mul(fade)
            .mul(cometFlat.y)
            .mul(this.boardMask());
        material.emissiveNode = material.colorNode.mul(material.opacityNode).mul(0.4);
        this.cometMesh = new THREE.Mesh(pooledGeometry(this.maxComets, this.maxArcs > 4 ? 48 : 24), material);
        this.cometMesh.name = 'stellar-drift-curved-event-comets';
        this.cometMesh.frustumCulled = false;
        this.cometMesh.renderOrder = 8;
        this.group.add(this.cometMesh);
    }

    createCometHeads() {
        const slot = attribute('aEventSlot', 'float').toInt();
        const comet = this.cometUniforms.element(slot);
        const cometFlat = varying(comet, 'vDriftEventHead').setInterpolation('flat');
        const target = this.targetUniforms.element(slot);
        const radial = this.radialUniforms.element(slot);
        const tangent = this.tangentUniforms.element(slot);
        const material = effectMaterial('meteor-nucleus-and-coma');
        material.positionNode = Fn(() => {
            const phase = comet.x.div(STELLAR_DRIFT_COMET_CONTACT).clamp(0, 1).toVar();
            const remaining = pow(float(1).sub(phase), 1.7).toVar();
            const center = target.add(radial.mul(remaining.mul(remaining).mul(comet.z.mul(9).add(18))))
                .add(tangent.mul(sin(remaining.mul(Math.PI * 0.5)).mul(comet.z.mul(8).add(10)))).toVar();
            const size = comet.y.mul(0.75).add(0.65).toVar();
            return center.add(this.contactUNode.mul(positionGeometry.x.mul(size)))
                .add(this.contactVNode.mul(positionGeometry.y.mul(size)))
                .add(this.contactNormalNode.mul(0.075))
                .mul(smoothstep(0.0001, 0.0002, comet.y));
        })();
        const p = uv().sub(0.5).mul(2);
        const radiusSquared = p.x.mul(p.x).add(p.y.mul(p.y));
        const core = exp(radiusSquared.mul(-18));
        const coma = exp(radiusSquared.mul(-5));
        const haze = exp(radiusSquared.mul(-2.8));
        const rays = exp(abs(p.x).mul(-35)).mul(exp(abs(p.y).mul(-5)))
            .add(exp(abs(p.y).mul(-35)).mul(exp(abs(p.x).mul(-5))));
        const edge = float(1).sub(smoothstep(0.8, 1, length(p)));
        const fade = smoothstep(0, 0.055, cometFlat.x)
            .mul(float(1).sub(smoothstep(STELLAR_DRIFT_COMET_CONTACT, 0.88, cometFlat.x)));
        material.colorNode = mix(vec3(0.1, 0.7, 1.8), vec3(3.8, 2.4, 1.15), core.mul(0.75).add(coma.mul(0.25)));
        material.opacityNode = core.mul(0.95).add(coma.mul(0.3)).add(haze.mul(0.08)).add(rays.mul(0.12))
            .mul(edge)
            .mul(fade)
            .mul(cometFlat.y)
            .mul(this.boardMask());
        material.emissiveNode = material.colorNode.mul(material.opacityNode).mul(0.6);
        this.headMesh = new THREE.Mesh(pooledGeometry(this.maxComets), material);
        this.headMesh.name = 'stellar-drift-comet-nuclei';
        this.headMesh.frustumCulled = false;
        this.headMesh.renderOrder = 9;
        this.group.add(this.headMesh);
    }

    createContactCoronas() {
        const slot = attribute('aEventSlot', 'float').toInt();
        const impact = this.impactUniforms.element(slot);
        const impactFlat = varying(impact, 'vDriftContactCorona').setInterpolation('flat');
        const target = this.targetUniforms.element(slot);
        const material = effectMaterial('localized-contact-coronas');
        material.positionNode = Fn(() => {
            const size = impact.x.mul(7.5).add(0.75).toVar();
            return target.add(this.contactUNode.mul(positionGeometry.x.mul(size)))
                .add(this.contactVNode.mul(positionGeometry.y.mul(size)))
                .add(this.contactNormalNode.mul(0.075))
                .mul(smoothstep(0.0001, 0.0002, impact.y));
        })();
        const p = uv().sub(0.5).mul(2);
        const r = length(p);
        const edge = float(1).sub(smoothstep(0.86, 1, r));
        const ring = exp(abs(r.sub(0.58)).mul(-37));
        const core = exp(r.mul(r).mul(-14));
        const rays = pow(abs(sin(p.x.mul(30).add(p.y.mul(22)))), 8).mul(core).mul(0.06);
        const fade = exp(impactFlat.x.mul(-5.5))
            .mul(float(1).sub(smoothstep(0.50, 0.68, impactFlat.x)));
        material.colorNode = mix(vec3(0.12, 0.85, 1.65), vec3(2.5, 1.0, 0.35), core);
        material.opacityNode = ring.mul(0.85).add(core.mul(0.6)).add(rays)
            .mul(edge)
            .mul(fade)
            .mul(impactFlat.y)
            .mul(this.boardMask());
        material.emissiveNode = material.colorNode.mul(material.opacityNode).mul(0.3);
        this.impactMesh = new THREE.Mesh(pooledGeometry(this.maxComets), material);
        this.impactMesh.name = 'stellar-drift-contact-coronas';
        this.impactMesh.frustumCulled = false;
        this.impactMesh.renderOrder = 10;
        this.group.add(this.impactMesh);
    }

    resize(width, height, boardRect = null) {
        if (this.disposed || !(width > 0 && height > 0)) return;
        if (!boardRect || ![boardRect.left, boardRect.top, boardRect.width, boardRect.height].every(Number.isFinite)) {
            this.boardBounds.value.set(2, 2, 3, 3);
            return;
        }
        this.boardBounds.value.set(
            boardRect.left / width,
            boardRect.top / height,
            (boardRect.left + boardRect.width) / width,
            (boardRect.top + boardRect.height) / height,
        );
    }

    update(_time, _dt, frame = {}) {
        if (this.disposed) return;
        this.camera.getWorldPosition(this.localCamera);
        this.parent.worldToLocal(this.localCamera);
        const distance = Math.max(this.radius + 0.0001, this.localCamera.length());
        this.contactNormal.copy(this.localCamera).normalize();
        if (this.contactNormal.lengthSq() < 0.1) this.contactNormal.set(0, 0, 1);
        const ratio = this.radius / distance;
        this.contactRadius = this.radius * Math.sqrt(1 - ratio * ratio);
        this.contactOffset = this.radius * ratio;
        this.contactU.set(1, 0, 0).addScaledVector(this.contactNormal, -this.contactNormal.x);
        if (this.contactU.lengthSq() < 1e-10) {
            this.contactU.set(0, 1, 0).addScaledVector(this.contactNormal, -this.contactNormal.y);
        }
        this.contactU.normalize();
        this.contactV.crossVectors(this.contactNormal, this.contactU).normalize();
        for (let index = 0; index < this.maxArcs; index++) {
            const arc = frame.arcs?.find((entry) => entry.id === index && entry.active);
            const phase = clamp01(arc?.progress);
            const strength = clamp01(arc?.strength);
            const energy = strength * stellarDriftEventEnvelope(phase);
            this.arcData[index].set(phase, energy, finite(arc?.angle), arc?.direction === -1 ? -1 : 1);
            this.arcMetadata[index].set(clamp01(arc?.seed), KIND[arc?.kind] || 0, strength, arc ? 1 : 0);
        }
        for (let index = 0; index < this.maxComets; index++) {
            const comet = frame.comets?.find((entry) => entry.id === index && entry.active);
            const angle = finite(comet?.angle);
            const direction = comet?.direction === -1 ? -1 : 1;
            const radial = this.cometRadialVectors[index].copy(this.contactU).multiplyScalar(Math.cos(angle))
                .addScaledVector(this.contactV, Math.sin(angle));
            this.cometTangentVectors[index].copy(this.contactU).multiplyScalar(-Math.sin(angle) * direction)
                .addScaledVector(this.contactV, Math.cos(angle) * direction);
            this.cometTargetVectors[index].copy(radial).multiplyScalar(this.contactRadius)
                .addScaledVector(this.contactNormal, this.contactOffset);
            const phase = clamp01(comet?.progress);
            this.cometData[index].set(phase, clamp01(comet?.strength), clamp01(comet?.seed), direction);
            this.impactData[index].set(
                Math.max(0, finite(comet?.impactAge)),
                comet?.impacted ? clamp01(comet.strength) : 0,
                clamp01(comet?.seed),
                comet?.impacted ? 1 : 0,
            );
        }
    }

    /** Exact hero-local head trajectory, excluding the 0.055-unit render lift. */
    sampleCometPosition(id, progress, output = new THREE.Vector3()) {
        const index = THREE.MathUtils.clamp(Math.floor(finite(id)), 0, this.maxComets - 1);
        const phase = Math.min(1, clamp01(progress) / STELLAR_DRIFT_COMET_CONTACT);
        const remaining = (1 - phase) ** 1.7;
        const seed = this.cometData[index].z;
        return output.copy(this.cometTargetVectors[index])
            .addScaledVector(this.cometRadialVectors[index], remaining * remaining * (18 + seed * 9))
            .addScaledVector(this.cometTangentVectors[index], Math.sin(remaining * Math.PI * 0.5) * (10 + seed * 8));
    }

    getDiagnostics() {
        return {
            eventDraws: 4,
            orbitalArcBudget: this.maxArcs,
            cometRibbonBudget: this.maxComets,
            localizedImpactBudget: this.maxComets,
            eventRenderResourceAllocationsPerFrame: 0,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        for (const group of [this.group, this.orbitGroup]) {
            group.removeFromParent();
            group.traverse((object) => {
                object.geometry?.dispose();
                object.material?.dispose();
            });
            group.clear();
        }
    }
}
