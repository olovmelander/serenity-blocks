const UNIFORM_FLOATS = 48;
const UNIFORM = Object.freeze({
    resolution: 0,
    sim: 4,
    ember: 8,
    reaction: 12,
    quality: 16,
    post: 20,
    colorA: 24,
    colorB: 28,
    misc: 32,
    fx: 36,
    star0: 40, // temperature, agitation, coronaEnergy, breath
    star1: 44, // novaFlash, cmePulse, cameraPush, reserved
});

/** Shared transport for the native and WebGL2 scene; reactive/art parameters are identical. */
export function createVoidEmberUniformData({
    canvas, runtime, frameCounter, qualityPreset, currentTier, anchor, colors, conductor,
}) {
    const floats = new Float32Array(UNIFORM_FLOATS);
    const invWidth = 1 / Math.max(canvas.width, 1);
    const invHeight = 1 / Math.max(canvas.height, 1);
    const aspect = canvas.width / Math.max(canvas.height, 1);

    floats[UNIFORM.resolution + 0] = canvas.width;
    floats[UNIFORM.resolution + 1] = canvas.height;
    floats[UNIFORM.resolution + 2] = invWidth;
    floats[UNIFORM.resolution + 3] = invHeight;

    floats[UNIFORM.sim + 0] = runtime.time;
    floats[UNIFORM.sim + 1] = runtime.delta;
    floats[UNIFORM.sim + 2] = aspect;
    floats[UNIFORM.sim + 3] = frameCounter;

    floats[UNIFORM.ember + 0] = anchor.x;
    floats[UNIFORM.ember + 1] = anchor.y;
    floats[UNIFORM.ember + 2] = runtime.pulse;
    floats[UNIFORM.ember + 3] = runtime.collapse;

    floats[UNIFORM.reaction + 0] = runtime.eventEnergy;
    floats[UNIFORM.reaction + 1] = runtime.comboEnergy;
    floats[UNIFORM.reaction + 2] = runtime.turbulence;
    floats[UNIFORM.reaction + 3] = runtime.lineEnergy;

    floats[UNIFORM.quality + 0] = qualityPreset.flowGridWidth;
    floats[UNIFORM.quality + 1] = qualityPreset.flowGridHeight;
    floats[UNIFORM.quality + 2] = qualityPreset.raySteps;
    floats[UNIFORM.quality + 3] = qualityPreset.particleCount;

    floats[UNIFORM.post + 0] = qualityPreset.bloomStrength;
    floats[UNIFORM.post + 1] = qualityPreset.bloomThreshold;
    floats[UNIFORM.post + 2] = qualityPreset.anamorphicStrength;
    floats[UNIFORM.post + 3] = currentTier === 'high' || currentTier === 'ultra'
        ? qualityPreset.temporalMix
        : 0;

    const emberColors = colors;
    floats[UNIFORM.colorA + 0] = emberColors.core[0];
    floats[UNIFORM.colorA + 1] = emberColors.core[1];
    floats[UNIFORM.colorA + 2] = emberColors.core[2];
    floats[UNIFORM.colorA + 3] = qualityPreset.exposure;

    floats[UNIFORM.colorB + 0] = emberColors.outer[0];
    floats[UNIFORM.colorB + 1] = emberColors.outer[1];
    floats[UNIFORM.colorB + 2] = emberColors.outer[2];
    floats[UNIFORM.colorB + 3] = 1;

    floats[UNIFORM.misc + 0] = qualityPreset.vignetteStrength;
    floats[UNIFORM.misc + 1] = qualityPreset.noiseStrength;
    floats[UNIFORM.misc + 2] = qualityPreset.historyClamp;
    floats[UNIFORM.misc + 3] = qualityPreset.sharpness ?? 0.12;

    // Pack reactive gameplay channels into the fx slot
    floats[UNIFORM.fx + 0] = runtime.shockwave;
    floats[UNIFORM.fx + 1] = runtime.flare;
    floats[UNIFORM.fx + 2] = runtime.hardDropFlash;
    floats[UNIFORM.fx + 3] = runtime.intensity;

    // StellarConductor life-state — drives the hero star (scene.wgsl)
    floats[UNIFORM.star0 + 0] = conductor.temperature;
    floats[UNIFORM.star0 + 1] = conductor.agitation;
    floats[UNIFORM.star0 + 2] = conductor.coronaEnergy;
    floats[UNIFORM.star0 + 3] = conductor.breath;
    floats[UNIFORM.star1 + 0] = conductor.novaFlash;
    floats[UNIFORM.star1 + 1] = conductor.cmePulse;
    floats[UNIFORM.star1 + 2] = conductor.cameraPush;
    floats[UNIFORM.star1 + 3] = 0;

    return floats;
}
