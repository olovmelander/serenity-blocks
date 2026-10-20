/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE MASSIF'S EAGLE — a golden eagle thermalling off the hero massif's south flank (chapter 4,
 * up the wall until the rail has climbed past it on the way to L29), the climb's living scale
 * cue before the summit kettle.
 *
 * The model is the Himalayan Peak theme's Blender-built eagle (copied to
 * `assets/chapter-04/eagle.glb`: themes cannot be imported into Odyssey), every joint posed in
 * code by `odyssey-eagle-flight.js` (no baked clip). One skinned mesh, ~2,300 triangles, one draw.
 *
 * ZERO-HITCH (ADR-0020), the whale pass's lifecycle exactly: nothing here touches the GPU until
 * the board says so. `load()` only fetches + parses; the board compiles the group through its
 * live-loop path (`_compileGroupThroughPost(group, { live: true })`) while idle and only then
 * calls `markReady()`. Until ready the group stays hidden, so no live frame can ever create one
 * of its pipelines synchronously. A load or compile failure leaves the act exactly as it was.
 * BISECT LEVER (board): `?odysseyNoEagle=1`.
 *
 * Its light is the act's: the sun from behind the camera on its back and the near wing, the sky
 * from above, the meadows' green bounced up under it, a rim of sky on its edges so the shape
 * keeps its wings against the snow, and the air between it and the eye.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, clamp, dot, exp, float, length, max, mix, normalWorld, normalize,
    positionWorld, select, uniform, vec3,
} from 'three/tsl';
import { loadOdysseyGltfCached } from '../chapter-environments/shared/odyssey-gltf-loader.js';
import {
    EAGLE_BONES, ODYSSEY_EAGLE, createEaglePose, eagleFlight, eagleRevealAt,
} from './odyssey-eagle-flight.js';

export const ODYSSEY_EAGLE_URL = new URL('../assets/chapter-04/eagle.glb', import.meta.url).href;

/** Seconds the bird takes to fade in once its compile lands with the camera already in range. */
const ARRIVAL_FADE_S = 1.2;

/**
 * @param {object} [opts]
 * @param {object} [opts.hazeColour] TSL vec3 node: the world's horizon (the air colour)
 * @param {object} [opts.sunColour] TSL vec3 node: the world's sun colour
 * @param {number[]} [opts.sunDir] direction TOWARD the sun
 * @param {string} [opts.url] model URL (tests)
 */
export function createOdysseyEagle({
    hazeColour = null, sunColour = null, sunDir = [-0.46, 0.36, 0.61], url = ODYSSEY_EAGLE_URL,
} = {}) {
    const group = new THREE.Group();
    group.name = 'odyssey-eagle';
    group.visible = false;
    const uFade = uniform(0);
    const sunD = new THREE.Vector3(...sunDir).normalize();
    const sun = sunColour ?? vec3(1.0, 0.95, 0.86);
    const haze = hazeColour ?? vec3(0.72, 0.82, 0.93);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OdysseyEagle';
    material.fog = false;
    material.side = THREE.DoubleSide;
    material.colorNode = Fn(() => {
        const plumage = attribute('color', 'vec4');
        const albedo = plumage.rgb;
        const thin = plumage.a;
        const N = normalize(normalWorld).toVar();
        const toEye = cameraPosition.sub(positionWorld);
        const V = normalize(toEye).toVar();
        const L = vec3(sunD.x, sunD.y, sunD.z);
        // Double-sided: light the face the eye sees.
        const Nf = select(dot(N, V).lessThan(0.0), N.negate(), N).toVar();
        const ndl = clamp(dot(Nf, L), 0.0, 1.0);
        const skyUp = max(Nf.y, 0.0);
        const meadowUp = max(Nf.y.negate(), 0.0);
        const ambient = haze.mul(skyUp.mul(0.22).add(0.12))
            .add(vec3(0.20, 0.27, 0.14).mul(meadowUp.mul(0.35)));
        const lit = albedo.mul(sun.mul(ndl.mul(0.92)).add(ambient)).toVar();
        // A rim of sky on the edges (and through the thin primaries) keeps the wings' shape.
        const edge = float(1.0).sub(abs(dot(Nf, V)));
        const edge3 = edge.mul(edge).mul(edge);
        const rim = haze.mul(edge3.mul(thin.mul(0.16).add(0.06)));
        const col = lit.add(rim);
        const air = float(1.0).sub(exp(length(toEye).div(-2600.0)));
        // uFade 0 = pure air colour (the group is hidden there): an arrival dissolves in.
        return mix(col, haze, max(air.mul(0.8), float(1).sub(uFade)));
    })();

    let model = null;
    let bones = [];
    let scale = 1;
    let loaded = false;
    let ready = false;
    let arrival = 0;
    const pose = createEaglePose();
    const basis = new THREE.Matrix4();
    const euler = new THREE.Euler(0, 0, 0, 'ZYX');
    const axis = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const pivot = new THREE.Group();
    pivot.name = 'odyssey-eagle-pivot';
    group.add(pivot);

    function poseAt(time, wind = 0.3) {
        eagleFlight(time, { wind }, pose, ODYSSEY_EAGLE);
        const { path } = pose;
        pivot.position.set(path.x, path.y, path.z);
        axis[0].fromArray(pose.left);
        axis[1].fromArray(pose.up);
        axis[2].fromArray(pose.forward);
        basis.makeBasis(axis[0], axis[1], axis[2]);
        pivot.quaternion.setFromRotationMatrix(basis);
        if (model) {
            model.position.set(0, pose.heave * scale, 0);
            for (let i = 0; i < bones.length; i += 1) {
                const [name, bone] = bones[i];
                const j = pose.joints[name];
                bone.quaternion.setFromEuler(euler.set(j[0], j[1], j[2], 'ZYX'));
            }
        }
    }

    return {
        group,
        material,
        pose,
        /** Fetch + parse only; no GPU work. Resolves true when the bird is in the group. */
        async load() {
            if (loaded) return true;
            const gltf = await loadOdysseyGltfCached(url);
            model = gltf.scene;
            // Bind-pose geometry bounds (a skinned box would run every bone on the CPU).
            model.updateMatrixWorld(true);
            const box = new THREE.Box3();
            const part = new THREE.Box3();
            model.traverse((o) => {
                if (!o.isMesh || !o.geometry) return;
                if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
                box.union(part.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
            });
            const size = box.getSize(new THREE.Vector3());
            // Built at its real size, wings out along x.
            scale = ODYSSEY_EAGLE.span / (size.x || 1);
            model.scale.setScalar(scale);
            model.traverse((o) => {
                if (!o.isMesh) return;
                o.material = material;
                o.frustumCulled = false;
            });
            bones = EAGLE_BONES.map((name) => [name, model.getObjectByName(name)]).filter(([, b]) => b);
            pivot.add(model);
            poseAt(0);
            pivot.updateMatrixWorld(true);
            loaded = true;
            return true;
        },
        /** The board calls this after its live-loop compile landed; only then may it draw. */
        markReady() { ready = loaded; },
        get isLoaded() { return loaded; },
        get isReady() { return ready; },
        /** Reveal (0..1) the progress window asks for at `p`. */
        revealAt(p) { return eagleRevealAt(p); },
        /**
         * @param {number} time board clock (s)
         * @param {number} delta seconds
         * @param {number} progress journey progress
         * @param {object} [opts]
         * @param {number} [opts.wind] 0..1 the act's wind (the colour script's)
         */
        update(time, delta, progress, { wind = 0.3 } = {}) {
            const want = eagleRevealAt(progress);
            const show = ready && want > 0.001;
            arrival = show ? Math.min(1, arrival + (Math.max(0, delta || 0) / ARRIVAL_FADE_S)) : 0;
            uFade.value = show ? want * arrival : 0;
            group.visible = show && uFade.value > 0.01;
            if (!group.visible) return;
            poseAt(time, wind);
            pivot.updateMatrixWorld(true);
        },
        dispose() {
            material.dispose();
            // Geometry is shared with the glTF cache — never disposed here.
            group.removeFromParent();
        },
    };
}
