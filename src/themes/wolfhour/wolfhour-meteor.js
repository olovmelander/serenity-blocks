import * as THREE from 'three/webgpu';
import {
    clamp, exp, float, length, mix, pow, smoothstep, uniform, uv, vec3,
} from 'three/tsl';

/** A continuous tapered ribbon; four moving vertices replace 40–64 line samples. */
export function createWolfhourMeteor({ impact = false } = {}) {
    const uTime = uniform(0);
    const uProgress = uniform(0);
    const uAtmosphereGlow = uniform(0.5);
    const fadeIn = smoothstep(0, 0.075, uProgress);
    const fade = impact ? fadeIn : fadeIn.mul(float(1).sub(smoothstep(0.5, 1, uProgress)));
    const p = uv();
    // MSAA interpolation can extend UVs slightly past the ribbon tip. Clamp
    // fractional powers so a negative base cannot poison the bloom attachment.
    const along = clamp(p.x, 0, 1);
    const width = along.mul(0.68).add(0.08);
    const cross = p.y.sub(0.5).abs().div(width);
    const tail = pow(along, 1.8);
    const filament = exp(cross.mul(cross).mul(-220));
    const sheath = exp(cross.mul(cross).mul(-22));
    const trailColor = mix(vec3(0.36, 0.4, 0.49), vec3(0.91, 0.95, 1), pow(along, 3));
    const trailMaterial = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    trailMaterial.colorNode = trailColor.mul(1.4);
    trailMaterial.opacityNode = filament.add(sheath.mul(uAtmosphereGlow).mul(0.24)).mul(tail).mul(fade);
    trailMaterial.emissiveNode = trailColor.mul(filament.add(sheath.mul(0.08))).mul(tail).mul(fade).mul(0.7);
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.userData.wolfhourRibbon = true;
    const trail = new THREE.Mesh(geometry, trailMaterial);
    trail.frustumCulled = false;
    trail.renderOrder = 500;
    const coreMaterial = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const r = length(p.sub(0.5).mul(2));
    const core = exp(r.mul(r).mul(-28));
    const glow = exp(r.mul(r).mul(-6));
    coreMaterial.colorNode = mix(vec3(0.45, 0.67, 1), vec3(1, 0.91, 0.72), core);
    coreMaterial.opacityNode = core.add(glow.mul(0.24)).mul(fade);
    coreMaterial.emissiveNode = vec3(1, 0.86, 0.66).mul(core).mul(fade).mul(1.6);
    const head = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), coreMaterial);
    head.userData.wolfhourMeteorCore = true;
    if (impact) head.scale.setScalar(1.35);
    head.renderOrder = 501;
    const meteor = new THREE.Group();
    meteor.add(trail, head);
    meteor.userData = {
        startTime: 0,
        duration: 0,
        startX: 0,
        startY: 0,
        startZ: 0,
        angle: 0,
        direction: 1,
        speed: 0,
        trailLength: 0,
        trailSegments: 4,
        trail,
        head,
        trailSlot: -1,
        reactive: false,
        trailNodeData: { material: trailMaterial, uniforms: { uTime, uProgress, uAtmosphereGlow } },
        headNodeData: { material: coreMaterial, uniforms: { uProgress, uAtmosphereGlow } },
    };
    return meteor;
}

export function setWolfhourRibbon(geometry, x, y, z, angle, direction, trailLength) {
    const dx = Math.cos(angle) * direction;
    const dy = Math.sin(angle);
    const halfWidth = 9;
    const nx = -dy * halfWidth; const ny = dx * halfWidth;
    const tailX = x - dx * trailLength; const tailY = y - dy * trailLength;
    const a = geometry.attributes.position;
    a.setXYZ(0, tailX + nx, tailY + ny, z);
    a.setXYZ(1, x + nx, y + ny, z);
    a.setXYZ(2, tailX - nx, tailY - ny, z);
    a.setXYZ(3, x - nx, y - ny, z);
    a.needsUpdate = true;
}
