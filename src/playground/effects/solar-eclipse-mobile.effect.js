import SolarEclipseTheme from '../../themes/solar-eclipse/solar-eclipse-theme.js';
import { applySolarEclipsePortraitFit } from '../../themes/solar-eclipse/solar-eclipse-composition.js';

export const meta = {
    id: 'solar-eclipse-mobile',
    title: 'Solar Eclipse — portrait composition',
    description: 'Authored classic sun and moon with a bounded portrait projection fit.',
};

export function create({ renderer, params, rng }) {
    const sourceCanvas = renderer.domElement;
    const previousVisibility = sourceCanvas.style.visibility;
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    sourceCanvas.parentNode.appendChild(container);
    sourceCanvas.style.visibility = 'hidden';
    const theme = new SolarEclipseTheme();
    theme.applyQualityPreset(params.get('quality') || 'Low');
    // Production factories are synchronous. Seed them only during construction;
    // the playground owns the time and render loop rather than the game theme.
    const originalRandom = Math.random;
    try {
        Math.random = rng;
        theme.cameraPhaseX = rng() * Math.PI * 2;
        theme.cameraPhaseY = rng() * Math.PI * 2;
        theme.cameraPhaseX2 = rng() * Math.PI * 2;
        theme.cameraPhaseY2 = rng() * Math.PI * 2;
        theme.initRenderer(container);
        for (const method of [
            'createStarfield', 'createNebulaClouds', 'createSun', 'createMoon',
            'createCoronaParticles', 'createFlareParticles', 'createEclipseSparks',
            'createSolarTendrils', 'createDiamondRing', 'createLensFlares',
            'createAmbientParticles', 'setupPostProcessing',
        ]) theme[method]();
    } finally {
        Math.random = originalRandom;
    }
    const fitEnabled = params.get('fit') !== '0';
    const aligned = params.get('eclipse') === '1';
    const glowOpacities = theme.sunGlowLayers.map((glow) => glow.material.opacity);
    window.__SOLAR_ECLIPSE_CANDIDATE__ = theme;
    return {
        camera(time) {
            const cameraTime = time * 0.08;
            // Identical production orbit and aim with the pointer at rest.
            theme.camera.position.set(
                Math.sin(cameraTime + theme.cameraPhaseX) * 250
                    + Math.cos(cameraTime * 0.7 + theme.cameraPhaseX2) * 100,
                Math.cos(cameraTime * 0.8 + theme.cameraPhaseY) * 150
                    + Math.sin(cameraTime * 0.5 + theme.cameraPhaseY2) * 45,
                850 + Math.sin(cameraTime * 0.6) * 120,
            );
            theme.camera.lookAt(Math.sin(cameraTime * 0.4) * 150, Math.cos(cameraTime * 0.5) * 100, 0);
            if (fitEnabled) applySolarEclipsePortraitFit(theme.camera);
        },
        update(time) {
            theme.time = time;
            theme.moonDriftProgress = aligned ? 0.5 : 0;
            theme.moon.position.set(aligned ? 0 : theme.moonStartX, aligned ? 25 : 0, aligned ? 30 : 50);
            theme.scene.traverse((object) => {
                const uniforms = object.material?.uniforms;
                if (uniforms?.uTime) uniforms.uTime.value = time;
                if (uniforms?.uMoonPosition) uniforms.uMoonPosition.value.copy(theme.moon.position);
            });
            theme.moon.material.uniforms.uEclipseProgress.value = aligned ? 1 : 0;
            // Production advances its authored phase by .01 per rendered frame.
            // Reconstruct the settled, event-free state for fixed-time captures.
            theme.solarTendrils.material.uniforms.uIntensity.value = 0.95 ** Math.max(0, Math.round(time / 0.01));
            theme.sunGlowLayers.forEach((glow, index) => {
                const pulse = 1 + Math.sin(time * (0.5 + index * 0.2)) * 0.03;
                glow.scale.set(pulse, pulse, 1);
                glow.material.opacity = glowOpacities[index] * (0.95 + Math.sin(time * 0.8 + index) * 0.05);
            });
            const corona = theme.coronaParticles;
            const coronaPositions = corona.geometry.attributes.position.array;
            const coronaVelocities = corona.geometry.attributes.velocity.array;
            const coronaLifetimes = corona.geometry.attributes.lifetime.array;
            for (let index = 0; index < coronaPositions.length / 3; index += 1) {
                const offset = index * 3;
                const phase = (time * 2 + coronaLifetimes[index] * Math.PI * 2) % (Math.PI * 2);
                const expansion = (Math.sin(phase) * 0.5 + 0.5) * 80;
                for (let axis = 0; axis < 3; axis += 1) {
                    coronaPositions[offset + axis] = corona.userData.basePositions[offset + axis]
                        + coronaVelocities[offset + axis] * expansion;
                }
            }
            corona.geometry.attributes.position.needsUpdate = true;
            corona.material.uniforms.opacity.value = 0.7 + Math.sin(time * 3) * 0.08;
            const flares = theme.flareParticles;
            const flarePositions = flares.geometry.attributes.position.array;
            const flareData = flares.geometry.attributes.data.array;
            for (let index = 0; index < flarePositions.length / 3; index += 1) {
                const positionOffset = index * 3;
                const dataOffset = index * 4;
                const theta = flareData[dataOffset];
                const phi = flareData[dataOffset + 1];
                const eruption = Math.sin(time * flareData[dataOffset + 2] + flareData[dataOffset + 3]) * 0.5 + 0.5;
                const radius = 320 + eruption * 200;
                flarePositions[positionOffset] = radius * Math.sin(phi) * Math.cos(theta);
                flarePositions[positionOffset + 1] = radius * Math.sin(phi) * Math.sin(theta);
                flarePositions[positionOffset + 2] = radius * Math.cos(phi) - 80;
            }
            flares.geometry.attributes.position.needsUpdate = true;
            flares.material.uniforms.opacity.value = 0.6;
            theme.diamondRing.material.uniforms.uEclipseProgress.value = aligned ? 1 : 0;
            theme.diamondRing.material.uniforms.uMoonX.value = theme.moon.position.x;
            theme.diamondRing.lookAt(theme.camera.position);
        },
        render() {
            theme.renderer.clear();
            if (theme.composer) theme.composer.render();
            else theme.renderer.render(theme.scene, theme.camera);
        },
        resize(width, height) {
            theme.resize(width, height);
            if (fitEnabled) applySolarEclipsePortraitFit(theme.camera);
        },
        dispose() {
            theme.cleanup();
            sourceCanvas.style.visibility = previousVisibility;
            delete window.__SOLAR_ECLIPSE_CANDIDATE__;
        },
    };
}
