/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Greenhouse — the pool of small lights: a lock's seed of light in flight and its
 * trail, the fireflies a cleared row releases, the pollen a closing bloom gives up, the halos
 * round the lanterns' flames. One instanced mesh of camera-facing quads the world fills every
 * frame (begin / push / end), additive, never smaller than a couple of pixels.
 *
 * At least one instance is always drawn (a dormant one of zero size when nothing is lit), so the
 * pipeline compiles on the first frame and never stalls the first lock.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraProjectionMatrix, cameraViewMatrix, exp, float, max, mix, positionGeometry, smoothstep, uv,
    vec3, vec4,
} from 'three/tsl';

/**
 * A light: aGlowA = (position, radius in metres), aGlowB = (colour, shape). Shape 0 is a soft
 * point with a hot core (a seed, a firefly); 1 a wide soft halo with no core (a flame's glow in
 * the air); 2 a fine sharp spark (pollen, dew catching the light).
 */
export function createGlows({ capacity, U, minPixels = 2.2 }) {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    const b = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    a.setUsage(THREE.DynamicDrawUsage);
    b.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aGlowA', a);
    geometry.setAttribute('aGlowB', b);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        fog: false,
    });
    material.name = 'moonlit-greenhouse-glows';
    const A = attribute('aGlowA', 'vec4');
    const B = attribute('aGlowB', 'vec4');
    material.vertexNode = Fn(() => {
        const view = cameraViewMatrix.mul(vec4(A.xyz, 1.0)).toVar();
        const depth = max(view.z.negate(), 0.01);
        // A light that has gone out (radius 0) stays a point of nothing.
        const floor = depth.mul(U.pixelAngle).mul(minPixels).mul(smoothstep(0.0, 1e-4, A.w));
        const radius = max(A.w, floor);
        const at = view.xyz.add(vec3(positionGeometry.xy.mul(radius), 0.0));
        return cameraProjectionMatrix.mul(vec4(at, 1.0));
    })();
    const shapeOf = Fn(() => {
        const d = uv().sub(0.5).mul(2.0);
        const r2 = d.dot(d);
        const halo = exp(r2.mul(-4.5));
        const core = exp(r2.mul(-48.0)).mul(2.4);
        const soft = exp(r2.mul(-2.6)).mul(float(1.0).sub(smoothstep(0.6, 1.0, r2)));
        const spark = exp(r2.mul(-26.0)).mul(1.6);
        const point = halo.mul(0.55).add(core);
        const shape = B.w;
        const glow = mix(mix(point, soft, smoothstep(0.5, 1.0, shape)), spark, smoothstep(1.5, 2.0, shape));
        return B.xyz.mul(glow).mul(float(1.0).sub(U.hush.mul(0.6)));
    });
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.outputNode = vec4(shapeOf(), 0.0);

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = 'moonlit-greenhouse-glows';
    mesh.count = 1;
    mesh.frustumCulled = false;
    mesh.renderOrder = 60;
    let n = 0;
    return {
        mesh,
        capacity,
        get count() {
            return n;
        },
        begin() {
            n = 0;
        },
        push(x, y, z, radius, r, g, bl, shape = 0) {
            if (n >= capacity) return;
            a.setXYZW(n, x, y, z, radius);
            b.setXYZW(n, r, g, bl, shape);
            n += 1;
        },
        end() {
            if (n === 0) {
                a.setXYZW(0, 0, -1000, 0, 0);
                b.setXYZW(0, 0, 0, 0, 0);
            }
            mesh.count = Math.max(1, n);
            a.needsUpdate = true;
            b.needsUpdate = true;
        },
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
