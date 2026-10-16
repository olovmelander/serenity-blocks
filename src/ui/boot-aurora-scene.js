/**
 * The light that bridges the loading screen and the opening world (First Light).
 *
 * The world itself performs the opening underneath (src/ui/intro-world/): the eye rises out of
 * the light, the veils unfurl and a wave leaves the logo. This transparent draw only carries
 * the loading screen's halo across the dissolve, so the frame never dips while one halo fades
 * and the other has not yet grown: a soft cool-white-to-violet glow at the logo that swells a
 * little as the wordmark grows into the title, then lets go. One draw, no compute.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, exp, float, mix, sin, smoothstep, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';

export const AURORA_OPENING_DURATION_MS = 3200;
export const AURORA_LOGO_OFFSET_Y = -36;

export function auroraFovAt() { return 45; }

export function createBootAurora({ viewportWidth = 1280, viewportHeight = 720 } = {}) {
    const progress = uniform(0);
    const clock = uniform(0);
    const viewport = uniform(new THREE.Vector2(viewportWidth, viewportHeight));
    const logoCenter = uniform(new THREE.Vector2(viewportWidth / 2, viewportHeight / 2 + AURORA_LOGO_OFFSET_Y));
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
    });
    material.vertexNode = vec4(uv().mul(2).sub(1), 0, 1);
    material.fragmentNode = Fn(() => {
        const st = uv();
        const aspect = viewport.x.div(viewport.y);
        const origin = vec2(logoCenter.x.div(viewport.x), float(1).sub(logoCenter.y.div(viewport.y)));
        const rel = st.sub(origin).mul(vec2(aspect, 1));
        const d2 = rel.dot(rel);
        // It swells with the growing wordmark and lets go once the world's halo is up.
        const grow = smoothstep(0, 0.8, progress);
        const size = mix(float(26), float(7), grow);
        const glow = exp(d2.mul(size).negate());
        const wide = exp(d2.mul(size.mul(0.22)).negate()).mul(0.4);
        const envelope = smoothstep(0, 0.12, progress).mul(float(1).sub(smoothstep(0.45, 0.92, progress)));
        const shimmer = sin(clock.mul(1.7)).mul(0.04).add(0.96);
        const tint = mix(vec3(0.254, 0.147, 1.0), vec3(0.82, 0.9, 1.0), glow);
        const light = tint.mul(glow.mul(0.16).add(wide.mul(0.04))).mul(envelope).mul(shimmer);
        return vec4(light, envelope.mul(0.6));
    })();

    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    return {
        mesh,
        uniforms: {
            progress, clock, viewport, logoCenter,
        },
        setProgress(value) { progress.value = THREE.MathUtils.clamp(value, 0, 1); },
        setTime(value) { clock.value = value; },
        setViewport(w, h) { if (w > 0 && h > 0) viewport.value.set(w, h); },
        setGemCenterPx(x, y) { logoCenter.value.set(x, y); },
        setAspect() {},
        setViewProj() {},
        dispose() { geometry.dispose(); material.dispose(); },
    };
}
