/**
 * A transparent aurora accent for the continuous ident-to-title handoff.
 * The live intro supplies the sky and particles; this draw adds only passing light.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, color, exp, float, mix, pow, sin, smoothstep, uniform, uv, vec2, vec4,
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
        const xy = st.sub(0.5).mul(vec2(aspect, 1));
        const t = clock.mul(0.13);
        const travel = smoothstep(0, 1, progress);
        // Light follows the same continuous motion as the DOM wordmark, with no opaque middle scene.
        const sweep = mix(float(-0.9), float(0.95), travel);
        const sweepCurve = st.x.sub(0.5).add(xy.y.mul(0.32))
            .add(sin(xy.y.mul(4).add(t)).mul(0.065)).sub(sweep);
        const wave = exp(abs(sweepCurve).mul(-18));
        const driftX = xy.x.add(sin(xy.x.mul(3.1).sub(t)).mul(0.07));
        const ribbonY = sin(driftX.mul(2.2).add(t)).mul(0.12)
            .add(0.18).add(travel.mul(0.14));
        const d = xy.y.sub(ribbonY);
        const pleats = sin(driftX.mul(108).add(sin(driftX.mul(16).add(t)).mul(4)))
            .mul(0.5).add(0.5);
        const curtain = exp(abs(d).mul(-12)).mul(smoothstep(-0.045, 0.018, d))
            .mul(pow(pleats, 2).mul(0.25).add(0.08));
        const hem = exp(abs(d).mul(-190)).mul(0.15);
        const hue = smoothstep(-0.6, 0.65, xy.x);
        const ribbonColor = mix(color('#52efc6'), color('#b49aff'), hue);
        const light = ribbonColor.mul(curtain.add(hem)).add(
            mix(color('#76dfdf'), color('#c2b5ff'), st.y).mul(wave).mul(0.24),
        );
        // A small halo connects the departing glass mark to the growing wordmark.
        const origin = vec2(logoCenter.x.div(viewport.x), float(1).sub(logoCenter.y.div(viewport.y)));
        const haloDistance = st.sub(origin).mul(vec2(aspect, 1)).length();
        const halo = exp(haloDistance.mul(-8)).mul(float(1).sub(travel)).mul(0.1);
        const envelope = sin(progress.mul(Math.PI)).max(0);
        return vec4(light.add(color('#8bf0d3').mul(halo)), envelope.mul(0.8));
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
