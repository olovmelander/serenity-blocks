/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Luminous Tides — the small lights: one additive layer of soft glows that face the lens, written
 * every frame by the world. Each is a point of light, or a streak drawn out along its velocity (a
 * falling drop, a droplet flung from a splash, a fish's wake), and keeps a couple of pixels across
 * however far away it is.
 *
 * And the rain: thin streaks falling round the eye, as many as the rain is hard, faintly lit by
 * the night and from beneath by the sea's light. They move in closed form (nothing written per
 * frame but the rain's strength).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, exp, float, fract, length, max,
    mix, positionGeometry, select, smoothstep, varying, vec2, vec3, vec4,
} from 'three/tsl';

/**
 * The glows: `capacity` quads written every frame.
 * Each: centre (world) and radius (metres; never less than `minPixels` pixels), colour × intensity
 * and a shape (0 a glow with a hot core, 1 a soft disc), velocity (world, m/s) and how many seconds
 * of it the streak spans (0: a round point).
 */
export function createGlows({ capacity, U, minPixels = 2.2 }) {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    const b = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    const c = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    [a, b, c].forEach((attr) => attr.setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aGlowA', a);
    geometry.setAttribute('aGlowB', b);
    geometry.setAttribute('aGlowC', c);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        fog: false,
    });
    material.name = 'luminous-tides-glows';
    const A = attribute('aGlowA', 'vec4');
    const B = attribute('aGlowB', 'vec4');
    const C = attribute('aGlowC', 'vec4');

    const centre = cameraViewMatrix.mul(vec4(A.xyz, 1.0));
    const end = cameraViewMatrix.mul(vec4(A.xyz.add(C.xyz.mul(C.w)), 1.0));
    const depth = max(centre.z.negate(), 0.01);
    const radius = max(A.w, depth.mul(U.pixelAngle).mul(minPixels));
    const d = end.xy.sub(centre.xy);
    const len = length(d);
    const ax = select(len.greaterThan(1e-5), d.div(max(len, 1e-5)), vec2(1.0, 0.0));
    const ay = vec2(ax.y.negate(), ax.x);
    const half = len.mul(0.5);
    const mid = centre.xyz.add(end.xyz).mul(0.5);
    const lx = positionGeometry.x.mul(half.add(radius));
    const ly = positionGeometry.y.mul(radius);
    const at = mid.xy.add(ax.mul(lx)).add(ay.mul(ly));
    material.vertexNode = cameraProjectionMatrix.mul(vec4(at, mid.z, 1.0));
    const vLocal = varying(vec3(lx.div(radius), ly.div(radius), half.div(radius)), 'ltGlowLocal');
    // A streak spreads the same light along its length.
    const vLight = varying(B.xyz.mul(radius.div(radius.add(half.mul(0.6)))), 'ltGlowLight');
    const vShape = varying(B.w, 'ltGlowShape');
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.outputNode = Fn(() => {
        const along = max(abs(vLocal.x).sub(vLocal.z), 0.0);
        const r2 = along.mul(along).add(vLocal.y.mul(vLocal.y));
        const halo = exp(r2.mul(-4.5));
        const core = exp(r2.mul(-60.0)).mul(2.2);
        const rim = float(1.0).sub(smoothstep(0.55, 1.0, r2));
        const glow = mix(halo.add(core), halo.mul(rim), vShape.greaterThan(0.5).select(1.0, 0.0));
        return vec4(vLight.mul(glow), 0.0);
    })();

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = 'luminous-tides-glows';
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 60;
    return {
        mesh,
        capacity,
        get count() {
            return mesh.count;
        },
        begin() {
            mesh.count = 0;
        },
        /** One light: centre, radius, colour × intensity, shape; optional velocity and streak seconds. */
        push(x, y, z, r, red, green, blue, shape = 0, vx = 0, vy = 0, vz = 0, streak = 0) {
            const i = mesh.count;
            if (i >= capacity) return;
            a.setXYZW(i, x, y, z, r);
            b.setXYZW(i, red, green, blue, shape);
            c.setXYZW(i, vx, vy, vz, streak);
            mesh.count = i + 1;
        },
        end() {
            a.needsUpdate = true;
            b.needsUpdate = true;
            c.needsUpdate = true;
        },
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}

/** The rain's box round the eye (metres): half its width, how far it reaches ahead, its height. */
export const RAIN_BOX = Object.freeze({
    half: 16, near: 1.5, far: 34, height: 11, fall: 8.5,
});

/**
 * The rain: `count` streaks, each with its own place in the box and its own phase. A streak shows
 * when its seed is under the rain's strength, so a shower thickens into a downpour by itself.
 */
export function createRain({ count, U, seed = 7 }) {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const seeds = new Float32Array(count * 4);
    let s = seed >>> 0;
    const rand = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < count; i += 1) {
        seeds[i * 4] = rand();
        seeds[i * 4 + 1] = rand();
        seeds[i * 4 + 2] = rand();
        seeds[i * 4 + 3] = rand();
    }
    geometry.setAttribute('aRain', new THREE.InstancedBufferAttribute(seeds, 4));
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        fog: false,
    });
    material.name = 'luminous-tides-rain';
    const R = attribute('aRain', 'vec4');
    const box = RAIN_BOX;
    // Where the streak is: a column in the box ahead of the eye, falling, wrapping at the bottom.
    const x = R.x.sub(0.5).mul(box.half * 2);
    const z = R.y.mul(R.y).mul(box.far - box.near).add(box.near).negate();
    const fall = box.fall * 0.85;
    const drop = fract(U.time.mul(R.z.mul(0.3).add(0.85)).mul(fall / box.height).add(R.w.mul(9.7)));
    const y = float(box.height * 0.7).sub(drop.mul(box.height));
    const world = vec3(cameraPosition.x.add(x).add(y.mul(0.08)), cameraPosition.y.add(y), cameraPosition.z.add(z));
    const shown = smoothstep(R.w.mul(0.97), R.w.mul(0.97).add(0.03), U.rain);
    const top = cameraViewMatrix.mul(vec4(world, 1.0));
    const bottom = cameraViewMatrix.mul(vec4(world.add(vec3(-0.06, -1.0, 0.0).mul(box.fall * 0.03)), 1.0));
    const depth = max(top.z.negate(), 0.05);
    const width = depth.mul(U.pixelAngle).mul(0.9).max(0.004).mul(shown);
    const dir = bottom.xy.sub(top.xy);
    const len = max(length(dir), 1e-5);
    const ax = dir.div(len);
    const ay = vec2(ax.y.negate(), ax.x);
    const mid = top.xyz.add(bottom.xyz).mul(0.5);
    const at = mid.xy.add(ax.mul(positionGeometry.x.mul(len.mul(0.5)))).add(ay.mul(positionGeometry.y.mul(width)));
    material.vertexNode = cameraProjectionMatrix.mul(vec4(at, mid.z, 1.0));
    const vAcross = varying(positionGeometry.y, 'ltRainAcross');
    const vAlong = varying(positionGeometry.x, 'ltRainAlong');
    const vFade = varying(float(1.0).sub(smoothstep(box.far * 0.4, box.far, depth)).mul(shown), 'ltRainFade');
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.outputNode = Fn(() => {
        const across = exp(vAcross.mul(vAcross).mul(-3.0));
        const along = float(1.0).sub(smoothstep(0.6, 1.0, abs(vAlong)));
        // The night's light on a falling drop, and the sea's blue from beneath it.
        const lit = U.light.horizon.mul(0.9).add(U.light.glow.mul(0.05).mul(U.glowPower)).add(U.light.warm.mul(0.05));
        return vec4(lit.mul(across.mul(along).mul(vFade).mul(0.55)), 0.0);
    })();
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'luminous-tides-rain';
    mesh.frustumCulled = false;
    mesh.renderOrder = 70;
    return {
        mesh,
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
