import * as THREE from 'three/webgpu';
import { createNebulaSky } from '../../themes/electric-dreams-v3/rendering/nebula-volume.js';
import { createFluidParticlesRenderer } from '../../themes/electric-dreams-v3/rendering/fluid-particles-renderer.js';
import { FluidParticleSim, getFluidBudget } from '../../themes/electric-dreams-v3/sim/fluid-particles.js';
import { V3PostPipeline, getV3PostProfile } from '../../themes/electric-dreams-v3/post/render-pipeline.js';

export const meta = {
    id: 'electric-dreams-fluid',
    title: 'Electric Dreams — portable fluid',
    description: 'The production nebula, fluid formations and grade on either node backend.',
};

export function create({
    scene, camera, renderer, params,
}) {
    const quality = params.get('quality') || 'Low';
    const budget = getFluidBudget(quality);
    const nebula = createNebulaSky();
    const sim = new FluidParticleSim(budget.count, {
        cpu: renderer.backend?.isWebGPUBackend !== true,
        focalPoint: new THREE.Vector3(0, 0, -1.5),
        focalRadius: budget.focalRadius,
        gravityStrength: budget.gravityStrength,
        gravityAnisotropy: new THREE.Vector3(0.32, 1.0, 0.7),
        turbulence: 0.6,
        boundsWidth: 28,
        boundsHeight: 14,
        boundsDepth: 18,
    });
    sim.createComputeNode();
    const fluid = createFluidParticlesRenderer(sim, { sizeMul: 1.1, emissiveMul: 1.4 });
    if (params.has('shape')) {
        sim.setShape(params.get('shape'));
        sim.setShapeStrength(0.7);
    }
    scene.add(nebula.mesh, fluid.mesh);
    const previousFog = scene.fog;
    scene.fog = new THREE.FogExp2(0x05040f, 0.012);
    camera.fov = 38;
    camera.near = 0.1;
    camera.far = 400;
    camera.updateProjectionMatrix();
    const post = quality !== 'Minimal' && params.get('noPost') !== '1'
        ? new V3PostPipeline(renderer, scene, camera, {
            ...getV3PostProfile(quality), useMRT: renderer.backend?.isWebGPUBackend === true,
        }) : null;
    return {
        camera() { camera.position.set(0, 0.6, 12); camera.lookAt(0, 0, 0); },
        update(time, delta) {
            sim.update(Number.isFinite(delta) ? delta : 0.016, time);
            if (sim.isCPU) sim.stepCPU();
            else renderer.compute(sim.computeNode);
            fluid.update(delta, time);
            nebula.uniforms.uTime.value = time;
            post?.updateDynamic({ time });
        },
        render() {
            if (post?.isEnabled()) post.render();
            else renderer.render(scene, camera);
        },
        resize(width, height) { post?.setSize?.(width, height); },
        dispose() {
            scene.remove(nebula.mesh, fluid.mesh);
            nebula.dispose(); fluid.dispose(); sim.dispose(); post?.dispose();
            scene.fog = previousFog;
        },
    };
}
