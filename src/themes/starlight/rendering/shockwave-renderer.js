/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Starlight — Shockwave Renderer
 *
 * Draws ShockwaveSystem's pool as expanding additive SDF rings on camera-facing
 * billboards (clone of the meteor renderer pattern; simpler — no velocity
 * stretch). Per-instance attributes WRAP the system's Float32Arrays directly
 * (mutate in the system, flag needsUpdate here). HDR-clamped + bloom-eligible so
 * the post pass carries the glow but additive can never white-out. Both backends.
 *
 * The ring radius expands with normalized age (0→1) in the quad's local space;
 * the quad is sized to `maxRadius` world units, so a slot collapses to zero area
 * (invisible) when expired (maxRadius set to 0 by the system).
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    float,
    length,
    positionLocal,
    smoothstep,
    uniform,
    vec4,
} from 'three/tsl';

export function createShockwaveRenderer(system, options = {}) {
    const count = system.max;
    const uTime = uniform(0);
    const uIntensity = uniform(options.intensity ?? 1.0);

    // Quad in [-1, 1] → positionLocal.xy is the ring's normalized radius space.
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -1, -1, 0,
        1, -1, 0,
        1, 1, 0,
        -1, 1, 0,
    ], 3));

    const aOrigin = new THREE.InstancedBufferAttribute(system.origin, 3);
    const aBirth = new THREE.InstancedBufferAttribute(system.birth, 1);
    const aInvLife = new THREE.InstancedBufferAttribute(system.invLife, 1);
    const aMaxRadius = new THREE.InstancedBufferAttribute(system.maxRadius, 1);
    const aWidth = new THREE.InstancedBufferAttribute(system.width, 1);
    const aAlpha = new THREE.InstancedBufferAttribute(system.alpha, 1);
    const aColor = new THREE.InstancedBufferAttribute(system.color, 3);
    const attrs = [aOrigin, aBirth, aInvLife, aMaxRadius, aWidth, aAlpha, aColor];
    attrs.forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aOrigin', aOrigin);
    geometry.setAttribute('aBirth', aBirth);
    geometry.setAttribute('aInvLife', aInvLife);
    geometry.setAttribute('aMaxRadius', aMaxRadius);
    geometry.setAttribute('aWidth', aWidth);
    geometry.setAttribute('aAlpha', aAlpha);
    geometry.setAttribute('aColor', aColor);
    geometry.instanceCount = count;

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    material.vertexNode = Fn(() => {
        const origin = attribute('aOrigin', 'vec3');
        const maxR = attribute('aMaxRadius', 'float');
        const vp = cameraViewMatrix.mul(vec4(origin, 1.0)).toVar();
        const off = positionLocal.xy.mul(maxR); // collapses to a point when maxR=0
        vp.x.addAssign(off.x);
        vp.y.addAssign(off.y);
        return cameraProjectionMatrix.mul(vp);
    })();

    const colorNode = Fn(() => {
        const birth = attribute('aBirth', 'float');
        const invLife = attribute('aInvLife', 'float');
        const width = attribute('aWidth', 'float');
        const alpha = attribute('aAlpha', 'float');
        const col = attribute('aColor', 'vec3');

        const d = length(positionLocal.xy); // 0 center → ~1.41 corner
        const age = uTime.sub(birth).mul(invLife); // 0..1 (radius expands with age)
        const ring = smoothstep(width, float(0.0), abs(d.sub(age)));
        const fadeIn = smoothstep(0.0, 0.1, age);
        const fadeOut = smoothstep(1.0, 0.7, age);
        const bright = ring.mul(fadeIn).mul(fadeOut).mul(alpha).mul(uIntensity)
            .clamp(0.0, 2.2); // HDR cap so additive+bloom can't blow out
        return vec4(col.mul(bright), bright.clamp(0.0, 1.0));
    })();

    material.colorNode = colorNode;
    material.emissiveNode = colorNode.rgb;
    material.userData.emitsBloom = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 7; // over meteors/stardust

    return {
        mesh,
        material,
        uniforms: { uTime, uIntensity },
        update(time) {
            uTime.value = time;
            attrs.forEach((a) => { a.needsUpdate = true; });
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
