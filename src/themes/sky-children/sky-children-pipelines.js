/**
 * Sky Children WebGPU pipeline helpers.
 */

export const SKY_CHILDREN_PHASE2_SHADER_LABELS = Object.freeze({
    terrainLighting: 'sky-children/phase2-terrain-lighting',
});

export const SKY_CHILDREN_PHASE3_SHADER_LABELS = Object.freeze({
    terrainCloudLighting: 'sky-children/phase3-terrain-cloud-lighting',
});

export const SKY_CHILDREN_PHASE4_SHADER_LABELS = Object.freeze({
    terrainCloudFoliageLighting: 'sky-children/phase4-terrain-cloud-foliage-lighting',
    foliagePass: 'sky-children/phase4-foliage-pass',
    flowerPass: 'sky-children/phase4-flower-pass',
});

export const SKY_CHILDREN_PHASE5_SHADER_LABELS = Object.freeze({
    postProcessing: 'sky-children/phase5-post-processing',
    postPass: 'sky-children/phase5-post-pass',
});

export const SKY_CHILDREN_PHASE2_UNIFORM_FLOATS = 60;
export const SKY_CHILDREN_PHASE2_UNIFORM_BYTES = SKY_CHILDREN_PHASE2_UNIFORM_FLOATS * 4;

export const SKY_CHILDREN_PHASE3_UNIFORM_FLOATS = 80;
export const SKY_CHILDREN_PHASE3_UNIFORM_BYTES = SKY_CHILDREN_PHASE3_UNIFORM_FLOATS * 4;

export const SKY_CHILDREN_PHASE4_UNIFORM_FLOATS = 104;
export const SKY_CHILDREN_PHASE4_UNIFORM_BYTES = SKY_CHILDREN_PHASE4_UNIFORM_FLOATS * 4;

// Backward-compatible aliases for existing Phase 1 code/tests.
export const SKY_CHILDREN_PHASE1_SHADER_LABELS = SKY_CHILDREN_PHASE2_SHADER_LABELS;
export const SKY_CHILDREN_PHASE1_UNIFORM_FLOATS = SKY_CHILDREN_PHASE2_UNIFORM_FLOATS;
export const SKY_CHILDREN_PHASE1_UNIFORM_BYTES = SKY_CHILDREN_PHASE2_UNIFORM_BYTES;

const FALLBACK_CLOUD_MODULE_WGSL = `
struct CloudParams {
    color_lit: vec3f,
    color_shadow: vec3f,
    color_ambient: vec3f,
    noise_scale: f32,
    noise_speed: f32,
    density_scale: f32,
    scatter_g: f32,
    scatter_intensity: f32,
    edge_softness: f32,
    opacity: f32,
    coverage: f32,
    softness: f32,
    silver_strength: f32,
    silhouette_strength: f32,
};

struct CloudSample {
    color: vec3f,
    alpha: f32,
    silhouette: f32,
    silver: f32,
};

fn cloud_hash12(p: vec2f) -> f32 {
    let p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
    let q = p3 + vec3f(dot(p3, p3.yzx + vec3f(33.33)));
    return fract((q.x + q.y) * q.z);
}

fn cloud_noise2(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (vec2f(3.0) - 2.0 * f);
    let a = cloud_hash12(i);
    let b = cloud_hash12(i + vec2f(1.0, 0.0));
    let c = cloud_hash12(i + vec2f(0.0, 1.0));
    let d = cloud_hash12(i + vec2f(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn cloud_render(
    uv: vec2f,
    centered_uv: vec2f,
    view_dir: vec3f,
    sun_dir: vec3f,
    time: f32,
    pulse: f32,
    combo: f32,
    params: CloudParams,
) -> CloudSample {
    return CloudSample(vec3f(0.0), 0.0, 0.0, 0.0);
}
`;

const FALLBACK_FOLIAGE_MODULE_WGSL = `
struct FoliageParams {
    color_base: vec3f,
    color_tip: vec3f,
    color_variation: f32,
    sss_color: vec3f,
    sss_intensity: f32,
    sss_distortion: f32,
    sss_power: f32,
    sky_normal_bias: f32,
    alpha: f32,
    wind_strength: f32,
    wind_frequency: f32,
    wind_direction: vec2f,
    gust_strength: f32,
    gust_frequency: f32,
    micro_strength: f32,
    micro_frequency: f32,
    blade_height: f32,
};

fn foliage_hash11(n: f32) -> f32 {
    return fract(sin(n * 127.1 + 311.7) * 43758.5453123);
}

fn foliage_blade_local(vertex_index: u32) -> vec2f {
    let verts = array<vec2f, 6>(
        vec2f(-0.5, 0.0),
        vec2f(0.5, 0.0),
        vec2f(-0.18, 1.0),
        vec2f(-0.18, 1.0),
        vec2f(0.5, 0.0),
        vec2f(0.18, 1.0),
    );
    return verts[min(vertex_index, 5u)];
}

fn foliage_wind_layers(
    world_xz: vec2f,
    height_factor: f32,
    time: f32,
    params: FoliageParams,
    flexibility: f32,
) -> vec2f {
    return vec2f(0.0);
}

fn foliage_color_ramp(
    params: FoliageParams,
    height_factor: f32,
    variation: f32,
) -> vec3f {
    return mix(params.color_base, params.color_tip, saturate(height_factor));
}
`;

const SKY_CHILDREN_SKY_SHAPE_HELPERS_WGSL = `
fn sky_hash12(p: vec2f) -> f32 {
    let p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
    let q = p3 + vec3f(dot(p3, p3.yzx + vec3f(33.33)));
    return fract((q.x + q.y) * q.z);
}

fn sky_noise2(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (vec2f(3.0) - 2.0 * f);
    let a = sky_hash12(i);
    let b = sky_hash12(i + vec2f(1.0, 0.0));
    let c = sky_hash12(i + vec2f(0.0, 1.0));
    let d = sky_hash12(i + vec2f(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn sky_backdrop(uv: vec2f, pulse: f32, combo: f32) -> vec3f {
    // HDR sky gradient: values >1.0 so Reinhard maps them to vivid display colors
    let zenith = vec3f(0.01, 0.18, 2.4);   // HDR cobalt blue
    let mid    = vec3f(0.04, 0.42, 2.0);   // HDR cerulean
    let horizon = vec3f(0.48, 0.72, 1.5);  // pale sky blue at horizon
    let warm_halo = vec3f(1.0, 0.92, 0.72);
    let sun_pos = vec2f(0.72, 0.70);        // lower/right — away from zenith
    let y = saturate(uv.y);
    var color = mix(mid, zenith, smoothstep(0.25, 1.0, y));
    color = mix(horizon, color, smoothstep(0.0, 0.48, y));
    // Warm golden glow near horizon
    let horizon_warm = mix(vec3f(0.96, 0.88, 0.72), vec3f(0.82, 0.92, 1.0), smoothstep(0.04, 0.22, y));
    color = mix(color, horizon_warm, (1.0 - smoothstep(0.0, 0.28, y)) * 0.55);
    // Sun glow - tight inner halo + tight outer scatter (3.5 keeps glow near sun)
    let sun_dist = length(uv - sun_pos);
    let sun_inner = exp(-pow(sun_dist * 5.0, 2.0));
    let sun_outer = exp(-pow(sun_dist * 3.5, 2.0));
    color += warm_halo * sun_inner * (0.6 + pulse * 0.18 + combo * 0.1);
    color += vec3f(1.0, 0.96, 0.82) * sun_outer * (0.04 + pulse * 0.02);
    // Subtle aerial perspective band mid-sky
    let aerial = smoothstep(0.12, 0.38, uv.y) * (1.0 - smoothstep(0.52, 0.78, uv.y));
    color = mix(color, vec3f(0.82, 0.92, 1.0), aerial * 0.1);
    return color;
}

fn sky_peak_mask(uv: vec2f, center_x: f32, base_y: f32, peak_y: f32, half_width: f32, softness: f32) -> f32 {
    let nx = abs((uv.x - center_x) / max(half_width, 0.0001));
    let ridge = mix(base_y, peak_y, saturate(1.0 - nx));
    let ridge_warp = sin((uv.x - center_x) * 24.0) * (1.0 - saturate(nx)) * 0.01;
    let ridge_y = ridge + ridge_warp;
    let in_width = 1.0 - smoothstep(0.95, 1.08, nx);
    let under_ridge = 1.0 - smoothstep(ridge_y - softness, ridge_y + softness, uv.y);
    return under_ridge * in_width;
}

fn sky_peak_height(x: f32, center_x: f32, base_y: f32, peak_y: f32, half_width: f32) -> f32 {
    let nx = abs((x - center_x) / max(half_width, 0.0001));
    let ridge = mix(base_y, peak_y, saturate(1.0 - nx));
    let ridge_warp = sin((x - center_x) * 24.0) * (1.0 - saturate(nx)) * 0.01;
    return ridge + ridge_warp;
}

fn sky_mountain_ridge_y(x: f32, pulse: f32) -> f32 {
    let hero = sky_peak_height(x, 0.50, 0.26, 0.94, 0.16);
    let left_a = sky_peak_height(x, 0.15, 0.32, 0.70, 0.22) * 0.88;
    let left_b = sky_peak_height(x, 0.30, 0.35, 0.58, 0.18) * 0.76;
    let right_a = sky_peak_height(x, 0.80, 0.33, 0.66, 0.24) * 0.86;
    let right_b = sky_peak_height(x, 0.67, 0.36, 0.55, 0.16) * 0.72;
    let foothill = sky_peak_height(x, 0.50, 0.37, 0.50, 0.54) * 0.62;
    let ridge = max(hero, max(max(left_a, left_b), max(max(right_a, right_b), foothill)));
    let macro_noise = sky_noise2(vec2f(x * 7.6, 0.37 + pulse * 0.42));
    let detail = sky_noise2(vec2f(x * 21.0, 1.73 - pulse * 0.18));
    let warp = (macro_noise - 0.5) * 0.032 + (detail - 0.5) * 0.015;
    return ridge + warp;
}

fn sky_mountain_layer(uv: vec2f, pulse: f32) -> vec4f {
    let ridge_y = sky_mountain_ridge_y(uv.x, pulse);
    let left = sky_mountain_ridge_y(clamp(uv.x - 0.003, 0.0, 1.0), pulse);
    let right = sky_mountain_ridge_y(clamp(uv.x + 0.003, 0.0, 1.0), pulse);
    let ridge_dx = right - left;

    let mask = 1.0 - smoothstep(ridge_y - 0.012, ridge_y + 0.016, uv.y);
    let hero_mask = smoothstep(0.62, 0.98, ridge_y) * smoothstep(0.22, 0.0, abs(uv.x - 0.50));

    let normal = safe_normalize(vec3f(-ridge_dx * 42.0, 1.0, 0.68));
    let light_dir = safe_normalize(vec3f(0.46, 0.66, 0.58));
    let n_dot_l = saturate(dot(normal, light_dir));
    let back = saturate(1.0 - n_dot_l);

    let valley = smoothstep(0.24, 0.92, uv.y);
    var color = mix(vec3f(0.11, 0.18, 0.34), vec3f(0.34, 0.52, 0.72), valley);
    color *= mix(0.42, 1.0, n_dot_l);

    let contour = sky_noise2(uv * vec2f(18.0, 12.0) + vec2f(0.0, pulse * 0.36));
    color = mix(color, color * vec3f(0.74, 0.82, 0.94), contour * 0.2 * back);

    let sunface = pow(n_dot_l, 1.8) * (0.28 + hero_mask * 0.36);
    color += vec3f(0.92, 0.98, 1.0) * sunface;

    let ridge_rim = smoothstep(ridge_y - 0.004, ridge_y + 0.004, uv.y) * mask;
    color += vec3f(0.95, 0.98, 1.0) * ridge_rim * 0.32;

    let atmospheric = smoothstep(0.22, 0.48, uv.y) * (1.0 - smoothstep(0.62, 0.80, uv.y));
    color = mix(color, vec3f(0.65, 0.79, 0.95), atmospheric * 0.14);

    let alpha = mask * smoothstep(0.18, 0.95, uv.y) * 0.96;
    return vec4f(max(color, vec3f(0.0)), saturate(alpha));
}

fn sky_cloud_sea(uv: vec2f, time: f32, pulse: f32) -> vec4f {
    // Multi-layer billowing cloud sea — Sky's iconic floating cloud floor
    let flow_a = sin(uv.x * 3.8 + time * 0.014) * 0.038 + sin(uv.x * 9.2 - time * 0.009) * 0.019;
    let flow_b = cos(uv.x * 6.1 + time * 0.017) * 0.022;
    let band_center = 0.51 + flow_a + flow_b;
    // Large-scale billow structure
    let n_macro = sky_noise2(uv * vec2f(2.2, 1.2) + vec2f(time * 0.006, 0.0));
    let n_mid   = sky_noise2(uv * vec2f(5.4, 2.8) - vec2f(0.0, time * 0.0048));
    let n_fine  = sky_noise2(uv * vec2f(12.8, 6.4) + vec2f(time * 0.0033, time * 0.0021));
    let billow = saturate(n_macro * 0.58 + n_mid * 0.28 + n_fine * 0.14);
    let thickness = 0.12 + billow * 0.28 + pulse * 0.018;
    let lower = band_center - thickness;
    let upper = band_center + thickness * 0.82;
    let lobe = smoothstep(lower, band_center, uv.y) * (1.0 - smoothstep(band_center, upper, uv.y));
    let shoulder = smoothstep(lower - 0.09, band_center - 0.03, uv.y)
        * (1.0 - smoothstep(band_center + 0.02, upper + 0.14, uv.y));
    let band = saturate(lobe + shoulder * 0.58);
    let bottom_fade = smoothstep(0.12, 0.40, uv.y);
    let top_fade = 1.0 - smoothstep(0.70, 0.92, uv.y);
    let alpha = band * bottom_fade * top_fade * (0.38 + billow * 0.20);
    // Cloud colors — white tops, blue-shadow bellies, warm rim from sun
    let shadow_col = vec3f(0.66, 0.78, 0.94);
    let lit_col    = vec3f(1.0, 1.0, 1.0);
    let warm_rim   = vec3f(1.0, 0.97, 0.88);
    var color = mix(shadow_col, lit_col, smoothstep(0.12, 0.88, billow));
    color = mix(color, warm_rim, smoothstep(0.48, 0.72, uv.y) * 0.28);
    // Sunlit highlight on upper billows
    color = mix(color, vec3f(0.98, 0.99, 1.0), smoothstep(0.62, 0.88, billow) * 0.22);
    return vec4f(color, alpha);
}

fn sky_particle_layer(
    uv: vec2f,
    time: f32,
    scale: vec2f,
    speed: vec2f,
    threshold: f32,
    softness: f32,
) -> f32 {
    let flow_uv = uv * scale + speed * time;
    let macro_noise = sky_noise2(flow_uv * 0.19 + vec2f(3.7, 1.1));
    let detail = sky_noise2(flow_uv + macro_noise);
    return smoothstep(threshold, threshold + max(softness, 0.001), detail);
}

fn sky_atmosphere_particles(
    uv: vec2f,
    time: f32,
    pulse: f32,
    combo: f32,
    camera_amount: f32,
) -> vec3f {
    let band = smoothstep(0.14, 0.7, uv.y) * (1.0 - smoothstep(0.93, 1.0, uv.y));
    let layer_a = sky_particle_layer(
        uv + vec2f(0.0, 0.04),
        time,
        vec2f(38.0, 18.0),
        vec2f(0.13, -0.045),
        0.93,
        0.03,
    );
    let layer_b = sky_particle_layer(
        uv,
        time,
        vec2f(64.0, 29.0),
        vec2f(-0.09, -0.028),
        0.955,
        0.022,
    );
    let layer_c = sky_particle_layer(
        uv + vec2f(0.12, 0.0),
        time,
        vec2f(22.0, 12.0),
        vec2f(0.055, -0.02),
        0.9,
        0.05,
    );
    let twinkle = 0.66 + 0.34 * sin(time * 2.7 + uv.x * 43.0 + uv.y * 29.0);
    let density = (layer_a * 0.52 + layer_b * 0.3 + layer_c * 0.18)
        * band
        * twinkle
        * (0.65 + combo * 0.35 + pulse * 0.25);
    let glow = vec3f(1.0, 0.97, 0.84) * density * (0.07 + camera_amount * 0.04);
    return glow;
}
`;

export function createSkyChildrenStylizedLightingModule(device, wgslSource) {
    if (!device || typeof device.createShaderModule !== 'function') {
        throw new Error('createSkyChildrenStylizedLightingModule requires a valid GPUDevice');
    }

    if (typeof wgslSource !== 'string' || wgslSource.trim().length === 0) {
        throw new Error('Stylized lighting WGSL source is required');
    }

    return device.createShaderModule({
        label: SKY_CHILDREN_PHASE3_SHADER_LABELS.terrainCloudLighting,
        code: wgslSource,
    });
}

export function createSkyChildrenPostProcessingModule(device, wgslSource) {
    if (!device || typeof device.createShaderModule !== 'function') {
        throw new Error('createSkyChildrenPostProcessingModule requires a valid GPUDevice');
    }

    if (typeof wgslSource !== 'string' || wgslSource.trim().length === 0) {
        throw new Error('Post-processing WGSL source is required');
    }

    return device.createShaderModule({
        label: SKY_CHILDREN_PHASE5_SHADER_LABELS.postProcessing,
        code: wgslSource,
    });
}

export function buildSkyChildrenPhase3TerrainCloudWGSL(
    stylizedLightingCoreWGSL,
    terrainModuleWGSL,
    cloudModuleWGSL,
) {
    if (typeof stylizedLightingCoreWGSL !== 'string' || stylizedLightingCoreWGSL.trim().length === 0) {
        throw new Error('buildSkyChildrenPhase3TerrainCloudWGSL requires stylized lighting WGSL core');
    }
    if (typeof terrainModuleWGSL !== 'string' || terrainModuleWGSL.trim().length === 0) {
        throw new Error('buildSkyChildrenPhase3TerrainCloudWGSL requires terrain WGSL module');
    }
    if (typeof cloudModuleWGSL !== 'string' || cloudModuleWGSL.trim().length === 0) {
        throw new Error('buildSkyChildrenPhase3TerrainCloudWGSL requires cloud WGSL module');
    }

    return `
${stylizedLightingCoreWGSL}
${terrainModuleWGSL}
${cloudModuleWGSL}

struct SkyFrameUniforms {
    resolution_time: vec4f,                 // x=width, y=height, z=time, w=pulse
    combo_misc: vec4f,                      // x=combo, y=eventEnergy, z=palettePhase, w=cameraOffsetX
    sun_dir: vec4f,                         // xyz=direction
    sun_color_intensity: vec4f,             // rgb + intensity
    ambient_color_intensity: vec4f,         // rgb + intensity
    shadow_tint_boost: vec4f,               // rgb + boost
    rim_color_power: vec4f,                 // rgb + rimPower
    spec_params: vec4f,                     // x=rimStrength, y=oceanPower, z=oceanStrength, w=glitterThreshold
    ocean_color_glitter: vec4f,             // rgb=oceanColor, w=glitterIntensity
    controls: vec4f,                        // x=useGlitter, y=yNormalCompression, z=diffuseMultiplier, w=cameraOffsetY
    terrain_color_roughness_near: vec4f,    // rgb=terrain warm albedo, w=roughnessNear
    terrain_cool_triplanar: vec4f,          // rgb=terrain cool albedo, w=triplanarScale
    terrain_shadow_normal: vec4f,           // rgb=shadowColor, w=normalStrength
    terrain_ripple_roughness_far: vec4f,    // x=rippleScale, y=rippleSharpness, z=roughnessFar, w=shimmerSuppression
    terrain_falloff_height: vec4f,          // x=roughnessStart, y=roughnessEnd, z=heightScale, w=horizonLift
    cloud_color_density: vec4f,             // rgb=litColor, w=densityScale
    cloud_shadow_scatter: vec4f,            // rgb=shadowColor, w=scatterG
    cloud_ambient_intensity: vec4f,         // rgb=ambientColor, w=scatterIntensity
    cloud_motion_opacity: vec4f,            // x=noiseScale, y=noiseSpeed, z=edgeSoftness, w=opacity
    cloud_shape_silver: vec4f,              // x=coverage, y=softness, z=silverStrength, w=silhouetteStrength
};
@group(0) @binding(0) var<uniform> frame: SkyFrameUniforms;

struct VSOut {
    @builtin(position) clip_position: vec4f,
    @location(0) uv: vec2f,
    @location(1) centered_uv: vec2f,
};

fn build_terrain_params() -> TerrainParams {
    return TerrainParams(
        frame.terrain_color_roughness_near.xyz,
        frame.terrain_cool_triplanar.xyz,
        frame.terrain_shadow_normal.xyz,
        frame.terrain_cool_triplanar.w,
        frame.terrain_shadow_normal.w,
        frame.terrain_ripple_roughness_far.x,
        frame.terrain_ripple_roughness_far.y,
        frame.terrain_color_roughness_near.w,
        frame.terrain_ripple_roughness_far.z,
        frame.terrain_falloff_height.x,
        frame.terrain_falloff_height.y,
        frame.terrain_ripple_roughness_far.w,
        frame.terrain_falloff_height.z,
        frame.terrain_falloff_height.w,
    );
}

fn build_cloud_params() -> CloudParams {
    return CloudParams(
        frame.cloud_color_density.xyz,
        frame.cloud_shadow_scatter.xyz,
        frame.cloud_ambient_intensity.xyz,
        frame.cloud_motion_opacity.x,
        frame.cloud_motion_opacity.y,
        frame.cloud_color_density.w,
        frame.cloud_shadow_scatter.w,
        frame.cloud_ambient_intensity.w,
        frame.cloud_motion_opacity.z,
        frame.cloud_motion_opacity.w,
        frame.cloud_shape_silver.x,
        frame.cloud_shape_silver.y,
        frame.cloud_shape_silver.z,
        frame.cloud_shape_silver.w,
    );
}

${SKY_CHILDREN_SKY_SHAPE_HELPERS_WGSL}

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VSOut {
    var output: VSOut;

    let positions = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0),
    );
    let pos = positions[vertex_index];
    let uv = pos * 0.5 + vec2f(0.5);

    output.clip_position = vec4f(pos, 0.0, 1.0);
    output.uv = uv;
    output.centered_uv = uv * 2.0 - vec2f(1.0);
    return output;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4f {
    let pulse = frame.resolution_time.w;
    let combo = frame.combo_misc.x;
    let time = frame.resolution_time.z;
    let sun_dir = safe_normalize(frame.sun_dir.xyz);

    let terrain = build_terrain_params();
    let cloud = build_cloud_params();

    let camera_offset = vec2f(frame.combo_misc.w, frame.controls.w);
    let camera_amount = clamp(length(camera_offset), 0.0, 1.5);
    let sky_shift = camera_offset * vec2f(0.065, 0.05);
    let mountain_uv = clamp(input.uv + sky_shift * vec2f(0.58, 0.44), vec2f(0.0), vec2f(1.0));
    let cloud_sea_uv = clamp(input.uv + sky_shift * vec2f(0.34, 0.27) + vec2f(0.0, 0.015), vec2f(0.0), vec2f(1.0));
    let cloud_field_uv = clamp(input.uv + sky_shift * vec2f(0.94, 0.7), vec2f(0.0), vec2f(1.0));
    let sky_centered_uv = input.centered_uv + sky_shift * vec2f(2.05, 1.58);

    let sky_base = sky_backdrop(cloud_field_uv, pulse, combo);
    let mountain_layer = sky_mountain_layer(mountain_uv, pulse);
    let cloud_sea = sky_cloud_sea(cloud_sea_uv, time, pulse);
    let atmosphere_particles = sky_atmosphere_particles(cloud_field_uv, time, pulse, combo, camera_amount);
    let view_dir_sky = safe_normalize(vec3f(
        sky_centered_uv.x * 1.38,
        (cloud_field_uv.y - 0.5) * 1.18,
        1.0,
    ));
    let cloud_sample = cloud_render(
        cloud_field_uv,
        sky_centered_uv,
        view_dir_sky,
        sun_dir,
        time,
        pulse,
        combo,
        cloud,
    );

    var sky_color = mix(sky_base, mountain_layer.xyz, mountain_layer.w * 0.96);
    sky_color = mix(sky_color, cloud_sea.xyz, cloud_sea.w * 0.3);
    sky_color = mix(sky_color, cloud_sample.color, saturate(cloud_sample.alpha * 1.12));
    sky_color = mix(sky_color, vec3f(1.0, 1.0, 1.0), cloud_sea.w * 0.07 + cloud_sample.alpha * 0.03);
    sky_color += vec3f(1.0, 0.98, 0.93) * cloud_sample.silver * 0.26;
    sky_color += atmosphere_particles * 0.52;

    // Horizon sits at ~42% of screen height — more terrain visible than before
    let meadow_wave = sin((input.centered_uv.x + camera_offset.x * 0.24) * 3.1 + time * 0.034) * 0.022
        + sin((input.centered_uv.x - camera_offset.x * 0.16) * 6.8 - time * 0.024) * 0.011;
    let horizon_line = 0.42 + meadow_wave;
    let terrain_visibility = 1.0 - smoothstep(horizon_line - 0.048, horizon_line + 0.038, input.uv.y);
    if (terrain_visibility <= 0.001) {
        return vec4f(max(sky_color, vec3f(0.0)), 1.0);
    }

    let aspect = max(frame.resolution_time.x / max(frame.resolution_time.y, 1.0), 0.1);
    let camera_dolly = sin(time * 0.046 + camera_offset.x * 2.6) * 1.6 + sin(time * 0.093) * 0.7;
    let camera_pos = vec3f(
        camera_offset.x * 3.8,
        5.2 + camera_offset.y * 2.4,
        15.0 + (camera_offset.x - camera_offset.y) * 2.6 + camera_dolly,
    );

    let ground_uv = (input.centered_uv + camera_offset * vec2f(0.12, 0.09)) * vec2f(12.4 * aspect, 23.0);
    let height = terrain_height(ground_uv, time, terrain);
    let grad = terrain_height_gradient(ground_uv, time, terrain, height);
    let geo_normal = safe_normalize(vec3f(-grad.x * terrain.height_scale, 1.0, -grad.y * terrain.height_scale));
    let world_pos = vec3f(ground_uv.x, height - terrain.horizon_lift * 0.62, ground_uv.y);

    let view_dir = safe_normalize(camera_pos - world_pos);
    let view_distance = length(camera_pos - world_pos);
    let detail_attn = terrain_detail_attenuation(view_distance, terrain);
    let tri_normal = terrain_triplanar_normal(world_pos, geo_normal, terrain, detail_attn);
    let final_normal = nlerp(geo_normal, tri_normal, terrain.normal_strength * detail_attn);
    let steepness = 1.0 - saturate(dot(geo_normal, vec3f(0.0, 1.0, 0.0)));
    let albedo = terrain_albedo(height, steepness, pulse, combo, terrain);

    let light = LightParams(
        sun_dir,
        frame.sun_color_intensity.xyz,
        frame.sun_color_intensity.w * (1.0 + pulse * 0.38 + combo * 0.22),
        frame.ambient_color_intensity.xyz,
        frame.ambient_color_intensity.w,
    );

    let surface = SurfaceParams(
        final_normal,
        view_dir,
        albedo,
        terrain_distance_roughness(view_distance, terrain),
    );

    let spec = JourneySpecularParams(
        frame.rim_color_power.w,
        frame.spec_params.x * detail_attn,
        frame.rim_color_power.xyz,
        frame.spec_params.y * mix(0.65, 1.0, detail_attn),
        frame.spec_params.z * mix(0.6, 1.0, detail_attn),
        frame.ocean_color_glitter.xyz,
    );

    let shadow = JourneyShadowParams(
        frame.shadow_tint_boost.xyz * terrain.shadow_color,
        frame.shadow_tint_boost.w,
    );

    var grain = vec3f(0.0);
    if (frame.controls.x > 0.5) {
        grain = terrain_triplanar_normal(world_pos * 2.6, final_normal, terrain, detail_attn * detail_attn);
    }
    let glitter = JourneyGlitterParams(
        grain,
        frame.spec_params.w + (1.0 - detail_attn) * 0.015,
        frame.ocean_color_glitter.w * detail_attn,
        mix(vec3f(1.02, 0.95, 0.72), vec3f(0.90, 0.94, 1.0), input.uv.y * 0.28),
    );

    let y_normal_compression = clamp(frame.controls.y, 0.0, 1.0);
    let diffuse_multiplier = max(frame.controls.z * mix(0.85, 1.0, detail_attn), 0.01);
    var terrain_color = calculate_journey_lighting_custom(
        surface,
        light,
        spec,
        shadow,
        glitter,
        y_normal_compression,
        diffuse_multiplier,
    );

    // Winding path through the meadow — more visible than before
    let path_curve = sin(world_pos.z * 0.058 + camera_offset.x * 2.2 + time * 0.044) * 2.4
        + sin(world_pos.z * 0.11 - time * 0.028) * 0.9;
    let path_dist = abs(world_pos.x - path_curve);
    let path_shape = 1.0 - smoothstep(0.4, 1.9, path_dist);
    let path_depth = smoothstep(6.0, 20.0, world_pos.z) * (1.0 - smoothstep(22.0, 40.0, world_pos.z));
    let path_mask = path_shape * path_depth * terrain_visibility;
    // Pale dusty stone path color — lighter than grass
    terrain_color = mix(terrain_color, vec3f(0.82, 0.84, 0.78), path_mask * 0.42);

    // Flower patches: pink, yellow, white — clustered by noise
    let flower_uv_a = world_pos.xz * 0.18 + vec2f(4.3, 1.7);
    let flower_uv_b = world_pos.xz * 0.22 + vec2f(9.1, 6.4);
    let flower_noise_a = terrain_noise2(flower_uv_a);
    let flower_noise_b = terrain_noise2(flower_uv_b);
    let flower_cluster = smoothstep(0.68, 0.85, flower_noise_a) * smoothstep(0.64, 0.82, flower_noise_b);
    let flower_depth_fade = smoothstep(6.0, 16.0, world_pos.z) * (1.0 - smoothstep(28.0, 42.0, world_pos.z));
    let flower_type = flower_noise_b;
    var flower_color = vec3f(0.96, 0.74, 0.84);      // pink default
    if (flower_type > 0.66) {
        flower_color = vec3f(1.0, 0.94, 0.52);        // yellow
    } else if (flower_type > 0.33) {
        flower_color = vec3f(0.96, 0.96, 0.94);       // white
    }
    let flower_mask = flower_cluster * flower_depth_fade * (1.0 - path_mask) * detail_attn;
    terrain_color = mix(terrain_color, flower_color, flower_mask * 0.48);

    // Sky-colored cloud shadow on terrain
    let cloud_ground_shadow = cloud_sample.alpha * 0.18 * smoothstep(0.3, 0.55, terrain_visibility);
    terrain_color = mix(terrain_color, terrain_color * vec3f(0.82, 0.88, 0.96), cloud_ground_shadow);

    var color = mix(sky_color, terrain_color, terrain_visibility);
    let cloud_silhouette = cloud_sample.silhouette * (1.0 - terrain_visibility);
    color += vec3f(0.06, 0.1, 0.14) * cloud_silhouette * cloud.silhouette_strength * 0.05;
    color += atmosphere_particles * (0.16 + (1.0 - terrain_visibility) * 0.2);

    // Soft atmospheric haze at distance — bluer to match Sky's look
    let haze_color = mix(vec3f(0.78, 0.90, 1.0), vec3f(0.62, 0.78, 0.96), input.uv.y);
    let distance_haze = smoothstep(38.0, 220.0, view_distance);
    color = mix(
        color,
        haze_color,
        distance_haze * terrain_visibility * (0.04 + (1.0 - detail_attn) * 0.08),
    );

    return vec4f(max(color, vec3f(0.0)), 1.0);
}
`;
}

export function buildSkyChildrenPhase4TerrainCloudFoliageWGSL(
    stylizedLightingCoreWGSL,
    terrainModuleWGSL,
    cloudModuleWGSL,
    foliageModuleWGSL,
) {
    if (typeof stylizedLightingCoreWGSL !== 'string' || stylizedLightingCoreWGSL.trim().length === 0) {
        throw new Error('buildSkyChildrenPhase4TerrainCloudFoliageWGSL requires stylized lighting WGSL core');
    }
    if (typeof terrainModuleWGSL !== 'string' || terrainModuleWGSL.trim().length === 0) {
        throw new Error('buildSkyChildrenPhase4TerrainCloudFoliageWGSL requires terrain WGSL module');
    }
    if (typeof cloudModuleWGSL !== 'string' || cloudModuleWGSL.trim().length === 0) {
        throw new Error('buildSkyChildrenPhase4TerrainCloudFoliageWGSL requires cloud WGSL module');
    }
    if (typeof foliageModuleWGSL !== 'string' || foliageModuleWGSL.trim().length === 0) {
        throw new Error('buildSkyChildrenPhase4TerrainCloudFoliageWGSL requires foliage WGSL module');
    }

    return `
${stylizedLightingCoreWGSL}
${terrainModuleWGSL}
${cloudModuleWGSL}
${foliageModuleWGSL}

struct SkyFrameUniforms {
    resolution_time: vec4f,                 // x=width, y=height, z=time, w=pulse
    combo_misc: vec4f,                      // x=combo, y=eventEnergy, z=palettePhase, w=cameraOffsetX
    sun_dir: vec4f,                         // xyz=direction
    sun_color_intensity: vec4f,             // rgb + intensity
    ambient_color_intensity: vec4f,         // rgb + intensity
    shadow_tint_boost: vec4f,               // rgb + boost
    rim_color_power: vec4f,                 // rgb + rimPower
    spec_params: vec4f,                     // x=rimStrength, y=oceanPower, z=oceanStrength, w=glitterThreshold
    ocean_color_glitter: vec4f,             // rgb=oceanColor, w=glitterIntensity
    controls: vec4f,                        // x=useGlitter, y=yNormalCompression, z=diffuseMultiplier, w=cameraOffsetY
    terrain_color_roughness_near: vec4f,    // rgb=terrain warm albedo, w=roughnessNear
    terrain_cool_triplanar: vec4f,          // rgb=terrain cool albedo, w=triplanarScale
    terrain_shadow_normal: vec4f,           // rgb=shadowColor, w=normalStrength
    terrain_ripple_roughness_far: vec4f,    // x=rippleScale, y=rippleSharpness, z=roughnessFar, w=shimmerSuppression
    terrain_falloff_height: vec4f,          // x=roughnessStart, y=roughnessEnd, z=heightScale, w=horizonLift
    cloud_color_density: vec4f,             // rgb=litColor, w=densityScale
    cloud_shadow_scatter: vec4f,            // rgb=shadowColor, w=scatterG
    cloud_ambient_intensity: vec4f,         // rgb=ambientColor, w=scatterIntensity
    cloud_motion_opacity: vec4f,            // x=noiseScale, y=noiseSpeed, z=edgeSoftness, w=opacity
    cloud_shape_silver: vec4f,              // x=coverage, y=softness, z=silverStrength, w=silhouetteStrength
    foliage_base_variation: vec4f,          // rgb=baseColor, w=colorVariation
    foliage_tip_sss_intensity: vec4f,       // rgb=tipColor, w=sssIntensity
    foliage_sss_color_distortion: vec4f,    // rgb=sssColor, w=sssDistortion
    foliage_shape_sss: vec4f,               // x=sssPower, y=skyNormalBias, z=alpha, w=bladeHeight
    foliage_wind_primary: vec4f,            // x=windStrength, y=windFrequency, z=dirX, w=dirY
    foliage_wind_secondary: vec4f,          // x=gustStrength, y=gustFrequency, z=microStrength, w=microFrequency
};
@group(0) @binding(0) var<uniform> frame: SkyFrameUniforms;

struct VSOut {
    @builtin(position) clip_position: vec4f,
    @location(0) uv: vec2f,
    @location(1) centered_uv: vec2f,
};

struct FoliageVSOut {
    @builtin(position) clip_position: vec4f,
    @location(0) world_position: vec3f,
    @location(1) world_normal: vec3f,
    @location(2) height_factor: f32,
    @location(3) color_variation: f32,
};

struct SceneFSOut {
    @location(0) color: vec4f,
    @builtin(frag_depth) depth: f32,
};

fn build_terrain_params() -> TerrainParams {
    return TerrainParams(
        frame.terrain_color_roughness_near.xyz,
        frame.terrain_cool_triplanar.xyz,
        frame.terrain_shadow_normal.xyz,
        frame.terrain_cool_triplanar.w,
        frame.terrain_shadow_normal.w,
        frame.terrain_ripple_roughness_far.x,
        frame.terrain_ripple_roughness_far.y,
        frame.terrain_color_roughness_near.w,
        frame.terrain_ripple_roughness_far.z,
        frame.terrain_falloff_height.x,
        frame.terrain_falloff_height.y,
        frame.terrain_ripple_roughness_far.w,
        frame.terrain_falloff_height.z,
        frame.terrain_falloff_height.w,
    );
}

fn build_cloud_params() -> CloudParams {
    return CloudParams(
        frame.cloud_color_density.xyz,
        frame.cloud_shadow_scatter.xyz,
        frame.cloud_ambient_intensity.xyz,
        frame.cloud_motion_opacity.x,
        frame.cloud_motion_opacity.y,
        frame.cloud_color_density.w,
        frame.cloud_shadow_scatter.w,
        frame.cloud_ambient_intensity.w,
        frame.cloud_motion_opacity.z,
        frame.cloud_motion_opacity.w,
        frame.cloud_shape_silver.x,
        frame.cloud_shape_silver.y,
        frame.cloud_shape_silver.z,
        frame.cloud_shape_silver.w,
    );
}

fn build_foliage_params() -> FoliageParams {
    return FoliageParams(
        frame.foliage_base_variation.xyz,
        frame.foliage_tip_sss_intensity.xyz,
        frame.foliage_base_variation.w,
        frame.foliage_sss_color_distortion.xyz,
        frame.foliage_tip_sss_intensity.w,
        frame.foliage_sss_color_distortion.w,
        frame.foliage_shape_sss.x,
        frame.foliage_shape_sss.y,
        frame.foliage_shape_sss.z,
        frame.foliage_wind_primary.x,
        frame.foliage_wind_primary.y,
        frame.foliage_wind_primary.zw,
        frame.foliage_wind_secondary.x,
        frame.foliage_wind_secondary.y,
        frame.foliage_wind_secondary.z,
        frame.foliage_wind_secondary.w,
        frame.foliage_shape_sss.w,
    );
}

fn scene_depth_from_world_z(world_z: f32) -> f32 {
    return saturate((world_z - 2.0) / 46.0);
}

${SKY_CHILDREN_SKY_SHAPE_HELPERS_WGSL}

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VSOut {
    var output: VSOut;

    let positions = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0),
    );
    let pos = positions[vertex_index];
    let uv = pos * 0.5 + vec2f(0.5);

    output.clip_position = vec4f(pos, 0.0, 1.0);
    output.uv = uv;
    output.centered_uv = uv * 2.0 - vec2f(1.0);
    return output;
}

@fragment
fn fs_main(input: VSOut) -> SceneFSOut {
    let pulse = frame.resolution_time.w;
    let combo = frame.combo_misc.x;
    let time = frame.resolution_time.z;
    let sun_dir = safe_normalize(frame.sun_dir.xyz);

    let terrain = build_terrain_params();
    let cloud = build_cloud_params();

    let camera_offset = vec2f(frame.combo_misc.w, frame.controls.w);
    let camera_amount = clamp(length(camera_offset), 0.0, 1.5);
    let sky_shift = camera_offset * vec2f(0.065, 0.05);
    let mountain_uv = clamp(input.uv + sky_shift * vec2f(0.58, 0.44), vec2f(0.0), vec2f(1.0));
    let cloud_sea_uv = clamp(input.uv + sky_shift * vec2f(0.34, 0.27) + vec2f(0.0, 0.015), vec2f(0.0), vec2f(1.0));
    let cloud_field_uv = clamp(input.uv + sky_shift * vec2f(0.94, 0.7), vec2f(0.0), vec2f(1.0));
    let sky_centered_uv = input.centered_uv + sky_shift * vec2f(2.05, 1.58);

    let sky_base = sky_backdrop(cloud_field_uv, pulse, combo);
    let mountain_layer = sky_mountain_layer(mountain_uv, pulse);
    let cloud_sea = sky_cloud_sea(cloud_sea_uv, time, pulse);
    let atmosphere_particles = sky_atmosphere_particles(cloud_field_uv, time, pulse, combo, camera_amount);
    let view_dir_sky = safe_normalize(vec3f(
        sky_centered_uv.x * 1.38,
        (cloud_field_uv.y - 0.5) * 1.18,
        1.0,
    ));
    let cloud_sample = cloud_render(
        cloud_field_uv,
        sky_centered_uv,
        view_dir_sky,
        sun_dir,
        time,
        pulse,
        combo,
        cloud,
    );

    var sky_color = mix(sky_base, mountain_layer.xyz, mountain_layer.w * 0.95);
    sky_color = mix(sky_color, cloud_sea.xyz, cloud_sea.w * 0.55);
    sky_color = mix(sky_color, cloud_sample.color, saturate(cloud_sample.alpha * 0.9));
    sky_color = mix(sky_color, vec3f(1.0, 1.0, 1.0), cloud_sea.w * 0.12 + cloud_sample.alpha * 0.04);
    sky_color += vec3f(1.0, 0.98, 0.93) * cloud_sample.silver * 0.2;
    sky_color += atmosphere_particles;
    let sun_halo = pow(saturate(dot(view_dir_sky, sun_dir)), 12.0);
    sky_color += frame.sun_color_intensity.xyz * sun_halo * frame.sun_color_intensity.w * 0.08;
    let zenith_mix = smoothstep(0.16, 0.98, cloud_field_uv.y);
    sky_color = mix(sky_color * vec3f(1.05, 1.01, 0.96), sky_color * vec3f(0.92, 0.97, 1.06), zenith_mix * 0.22);

    // Horizon at 42% — more terrain, less sky cut-off
    let meadow_wave = sin((input.centered_uv.x + camera_offset.x * 0.24) * 3.1 + time * 0.034) * 0.022
        + sin((input.centered_uv.x - camera_offset.x * 0.16) * 6.8 - time * 0.024) * 0.011;
    let horizon_line = 0.42 + meadow_wave;
    let terrain_visibility = 1.0 - smoothstep(horizon_line - 0.048, horizon_line + 0.038, input.uv.y);
    if (terrain_visibility <= 0.001) {
        var sky_only: SceneFSOut;
        sky_only.color = vec4f(max(sky_color, vec3f(0.0)), 1.0);
        sky_only.depth = 1.0;
        return sky_only;
    }

    let aspect = max(frame.resolution_time.x / max(frame.resolution_time.y, 1.0), 0.1);
    let camera_dolly = sin(time * 0.046 + camera_offset.x * 2.6) * 1.6 + sin(time * 0.093) * 0.7;
    let camera_pos = vec3f(
        camera_offset.x * 3.8,
        5.2 + camera_offset.y * 2.4,
        15.0 + (camera_offset.x - camera_offset.y) * 2.6 + camera_dolly,
    );

    let ground_uv = (input.centered_uv + camera_offset * vec2f(0.12, 0.09)) * vec2f(12.4 * aspect, 23.0);
    let height = terrain_height(ground_uv, time, terrain);
    let grad = terrain_height_gradient(ground_uv, time, terrain, height);
    let geo_normal = safe_normalize(vec3f(-grad.x * terrain.height_scale, 1.0, -grad.y * terrain.height_scale));
    let world_pos = vec3f(ground_uv.x, height - terrain.horizon_lift * 0.62, ground_uv.y);

    let view_dir = safe_normalize(camera_pos - world_pos);
    let view_distance = length(camera_pos - world_pos);
    let detail_attn = terrain_detail_attenuation(view_distance, terrain);
    let tri_normal = terrain_triplanar_normal(world_pos, geo_normal, terrain, detail_attn);
    let final_normal = nlerp(geo_normal, tri_normal, terrain.normal_strength * detail_attn);
    let steepness = 1.0 - saturate(dot(geo_normal, vec3f(0.0, 1.0, 0.0)));
    let albedo = terrain_albedo(height, steepness, pulse, combo, terrain);

    let light = LightParams(
        sun_dir,
        frame.sun_color_intensity.xyz,
        frame.sun_color_intensity.w * (1.0 + pulse * 0.38 + combo * 0.22),
        frame.ambient_color_intensity.xyz,
        frame.ambient_color_intensity.w,
    );

    let surface = SurfaceParams(
        final_normal,
        view_dir,
        albedo,
        terrain_distance_roughness(view_distance, terrain),
    );

    let spec = JourneySpecularParams(
        frame.rim_color_power.w,
        frame.spec_params.x * detail_attn,
        frame.rim_color_power.xyz,
        frame.spec_params.y * mix(0.65, 1.0, detail_attn),
        frame.spec_params.z * mix(0.6, 1.0, detail_attn),
        frame.ocean_color_glitter.xyz,
    );

    let shadow = JourneyShadowParams(
        frame.shadow_tint_boost.xyz * terrain.shadow_color,
        frame.shadow_tint_boost.w,
    );

    var grain = vec3f(0.0);
    if (frame.controls.x > 0.5) {
        grain = terrain_triplanar_normal(world_pos * 2.6, final_normal, terrain, detail_attn * detail_attn);
    }
    let glitter = JourneyGlitterParams(
        grain,
        frame.spec_params.w + (1.0 - detail_attn) * 0.015,
        frame.ocean_color_glitter.w * detail_attn,
        mix(vec3f(1.02, 0.95, 0.72), vec3f(0.90, 0.94, 1.0), input.uv.y * 0.28),
    );

    let y_normal_compression = clamp(frame.controls.y, 0.0, 1.0);
    let diffuse_multiplier = max(frame.controls.z * mix(0.85, 1.0, detail_attn), 0.01);
    var terrain_color = calculate_journey_lighting_custom(
        surface,
        light,
        spec,
        shadow,
        glitter,
        y_normal_compression,
        diffuse_multiplier,
    );

    // Winding stone path
    let path_curve = sin(world_pos.z * 0.058 + camera_offset.x * 2.2 + time * 0.044) * 2.4
        + sin(world_pos.z * 0.11 - time * 0.028) * 0.9;
    let path_dist = abs(world_pos.x - path_curve);
    let path_shape = 1.0 - smoothstep(0.4, 1.9, path_dist);
    let path_depth = smoothstep(6.0, 20.0, world_pos.z) * (1.0 - smoothstep(22.0, 40.0, world_pos.z));
    let path_mask = path_shape * path_depth * terrain_visibility;
    terrain_color = mix(terrain_color, vec3f(0.82, 0.84, 0.78), path_mask * 0.42);

    // Flower patches: pink, yellow, white clusters scattered across meadow
    let flower_uv_a = world_pos.xz * 0.18 + vec2f(4.3, 1.7);
    let flower_uv_b = world_pos.xz * 0.22 + vec2f(9.1, 6.4);
    let flower_noise_a = terrain_noise2(flower_uv_a);
    let flower_noise_b = terrain_noise2(flower_uv_b);
    let flower_cluster = smoothstep(0.68, 0.85, flower_noise_a) * smoothstep(0.64, 0.82, flower_noise_b);
    let flower_depth_fade = smoothstep(6.0, 16.0, world_pos.z) * (1.0 - smoothstep(28.0, 42.0, world_pos.z));
    let flower_type = flower_noise_b;
    var flower_color = vec3f(0.96, 0.74, 0.84);    // soft pink
    if (flower_type > 0.66) {
        flower_color = vec3f(1.0, 0.94, 0.52);      // warm yellow
    } else if (flower_type > 0.33) {
        flower_color = vec3f(0.96, 0.96, 0.94);     // white
    }
    let flower_mask = flower_cluster * flower_depth_fade * (1.0 - path_mask) * detail_attn;
    terrain_color = mix(terrain_color, flower_color, flower_mask * 0.48);

    let depth_band = smoothstep(8.0, 34.0, world_pos.z);
    terrain_color = mix(
        terrain_color * vec3f(1.04, 1.02, 0.98),
        terrain_color * vec3f(0.86, 0.93, 1.02),
        depth_band * 0.18,
    );

    // Subtle cloud shadow on terrain
    let cloud_ground_shadow = cloud_sample.alpha * 0.18 * smoothstep(0.3, 0.55, terrain_visibility);
    terrain_color = mix(terrain_color, terrain_color * vec3f(0.82, 0.88, 0.96), cloud_ground_shadow);

    var color = mix(sky_color, terrain_color, terrain_visibility);
    let cloud_silhouette = cloud_sample.silhouette * (1.0 - terrain_visibility);
    color += vec3f(0.06, 0.1, 0.14) * cloud_silhouette * cloud.silhouette_strength * 0.05;
    color += atmosphere_particles * (0.06 + (1.0 - terrain_visibility) * 0.08);

    let haze_color = mix(vec3f(0.78, 0.90, 1.0), vec3f(0.62, 0.78, 0.96), input.uv.y);
    let distance_haze = smoothstep(78.0, 260.0, view_distance);
    color = mix(
        color,
        haze_color,
        distance_haze * terrain_visibility * (0.012 + (1.0 - detail_attn) * 0.028),
    );

    var output: SceneFSOut;
    output.color = vec4f(max(color, vec3f(0.0)), 1.0);
    output.depth = clamp(mix(1.0, scene_depth_from_world_z(world_pos.z), terrain_visibility), 0.0, 1.0);
    return output;
}

@vertex
fn vs_foliage(
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32,
) -> FoliageVSOut {
    var output: FoliageVSOut;

    let aspect = max(frame.resolution_time.x / max(frame.resolution_time.y, 1.0), 0.1);
    let time = frame.resolution_time.z;
    let camera_offset = vec2f(frame.combo_misc.w, frame.controls.w);
    let terrain = build_terrain_params();
    let foliage = build_foliage_params();
    let blade = foliage_blade_local(vertex_index);
    let id = f32(instance_index);

    let seed_a = foliage_hash11(id * 0.73 + 11.0);
    let seed_b = foliage_hash11(id * 1.39 + 7.3);
    let seed_c = foliage_hash11(id * 2.07 + 13.7);
    let seed_d = foliage_hash11(id * 2.71 + 23.9);
    let seed_e = foliage_hash11(id * 3.17 + 5.1);
    let band_choice = foliage_hash11(id * 1.87 + 2.9);

    let lateral_signed = seed_a * 2.0 - 1.0;
    let lateral_abs = abs(lateral_signed);
    let edge_frame = smoothstep(0.18, 0.92, lateral_abs);
    // Wider field coverage — grass fills the whole visible meadow
    var world_x = lateral_signed * 20.5 * aspect + camera_offset.x * 4.8;
    var world_z = 12.0;
    if (band_choice < 0.28) {
        world_z = mix(4.0, 9.0, seed_b);      // near foreground band
    } else if (band_choice < 0.58) {
        world_z = mix(9.2, 17.0, seed_b);     // mid band
    } else if (band_choice < 0.82) {
        world_z = mix(17.2, 26.0, seed_b);    // far band
    } else {
        world_z = mix(26.2, 36.0, seed_b);    // very far, sparse
    }
    world_z += (1.0 - edge_frame) * mix(2.0, 3.8, band_choice);
    world_z -= edge_frame * mix(0.36, 0.9, 1.0 - band_choice);
    world_z += camera_offset.y * 3.4;

    var band_density = 1.0;
    if (band_choice < 0.28) {
        band_density = 0.96;       // near band: dense
    } else if (band_choice < 0.58) {
        band_density = 0.78;       // mid: good coverage
    } else if (band_choice < 0.82) {
        band_density = 0.56;       // far: thinning
    } else {
        band_density = 0.36;       // very far: sparse but still visible
    }
    let center_sparse = smoothstep(0.24, 0.88, lateral_abs);
    let center_depth = saturate((world_z - 8.0) / 30.0);
    let center_open = mix(0.72, 0.52, center_depth);
    band_density *= mix(1.0 - center_open * 0.52, 1.0, center_sparse);
    // Path corridor clearing — grass doesn't grow on the path
    let path_curve_f = sin(world_z * 0.058) * 2.4 + sin(world_z * 0.11) * 0.9;
    let path_dist_f = abs(world_x - camera_offset.x * 4.8 - path_curve_f);
    let path_clear = smoothstep(0.9, 2.3, path_dist_f);
    band_density *= path_clear;
    // Clumping noise for natural meadow groupings
    let clump_wave = 0.5 + 0.5 * sin((seed_a * 17.0 + seed_b * 9.0 + band_choice * 6.28318530718) * 1.37);
    let clump_gate = smoothstep(0.18, 0.78, clump_wave);
    band_density *= mix(0.68, 1.0, clump_gate);
    let side_cluster_wave = 0.5 + 0.5 * sin((lateral_signed * 8.7 + seed_b * 4.8 + seed_d * 1.7) * 2.7);
    let side_cluster_gate = smoothstep(0.28, 0.86, side_cluster_wave);
    band_density *= mix(0.62, 1.0, side_cluster_gate);
    if (seed_e > band_density) {
        output.clip_position = vec4f(2.0, 2.0, 2.0, 1.0);
        output.world_position = vec3f(0.0);
        output.world_normal = vec3f(0.0, 1.0, 0.0);
        output.height_factor = 0.0;
        output.color_variation = 0.5;
        return output;
    }

    world_x += sin((seed_b + seed_d) * 6.28318530718) * mix(0.38, 2.1, band_choice) * 0.46;
    let height_factor = saturate(blade.y);
    let flexibility = 0.52 + seed_c * 0.52;   // slightly stiffer for visible shape
    let wind_offset = foliage_wind_layers(
        vec2f(world_x, world_z),
        height_factor,
        time,
        foliage,
        flexibility,
    );
    world_x += wind_offset.x;
    world_z += wind_offset.y;

    let depth_norm = saturate((world_z - 9.0) / 28.0);
    // Near blades taller and wider; far blades shorter (mimics perspective + LOD)
    let blade_height = foliage.blade_height * (0.78 + seed_c * 0.62) * mix(1.0, 0.52, depth_norm);
    let blade_width = blade_height * mix(0.12, 0.07, depth_norm);
    let ground_height = terrain_height(vec2f(world_x, world_z), time, terrain) - terrain.horizon_lift * 0.56;
    let world_y = ground_height + height_factor * blade_height + 0.04;
    let yaw = seed_d * 6.28318530718;
    let yaw_axis = vec2f(cos(yaw), sin(yaw));
    let side = blade.x * blade_width;
    let world_pos = vec3f(world_x + yaw_axis.x * side, world_y, world_z + yaw_axis.y * side);

    var blade_normal = safe_normalize(vec3f(
        -wind_offset.x * 0.52 - yaw_axis.x * blade.x * 0.42,
        0.92,
        -wind_offset.y * 0.52 - yaw_axis.y * blade.x * 0.42 + 0.18,
    ));
    blade_normal = nlerp(blade_normal, vec3f(0.0, 1.0, 0.0), foliage.sky_normal_bias);

    let clip_depth = saturate((world_pos.z - 6.0) / 24.0);
    let perspective = mix(1.0, 0.55, clip_depth);
    let clip_x = (world_pos.x / (20.0 * aspect)) * perspective;
    // Lower ground_line to show more meadow grass — pushed down toward screen bottom
    let ground_line = mix(-0.96, -0.72, clip_depth) + camera_offset.y * 0.052;
    let visual_y = world_pos.y + terrain.horizon_lift * 0.50;
    let framing_offset = edge_frame * 0.02 - (1.0 - edge_frame) * 0.02;
    // Scale clip_y divisor by heightScale so grass stays on screen when terrain is tall
    let height_scale_f = max(frame.terrain_falloff_height.z * 7.5, 7.8);
    let clip_y = ground_line + (visual_y / height_scale_f) + framing_offset * 0.28 + (seed_b - 0.5) * 0.014;

    let clip_z = max(0.0, scene_depth_from_world_z(world_pos.z) - 0.0012 - height_factor * 0.0018);
    output.clip_position = vec4f(clip_x, clip_y, clip_z, 1.0);
    output.world_position = world_pos;
    output.world_normal = blade_normal;
    output.height_factor = height_factor;
    output.color_variation = mix(seed_a, seed_d, 0.35);
    return output;
}

@fragment
fn fs_foliage(input: FoliageVSOut) -> @location(0) vec4f {
    let foliage = build_foliage_params();
    let sun_dir = safe_normalize(frame.sun_dir.xyz);
    let pulse = frame.resolution_time.w;
    let combo = frame.combo_misc.x;
    let camera_pos = vec3f(
        frame.combo_misc.w * 2.6,
        7.0 + frame.controls.w * 1.1,
        26.0 + (frame.combo_misc.w - frame.controls.w) * 1.6,
    );
    let view_dir = safe_normalize(camera_pos - input.world_position);
    let normal = safe_normalize(input.world_normal);

    let base_color = foliage_color_ramp(foliage, input.height_factor, input.color_variation);
    let light = LightParams(
        sun_dir,
        frame.sun_color_intensity.xyz,
        frame.sun_color_intensity.w * (1.0 + pulse * 0.28 + combo * 0.16),
        frame.ambient_color_intensity.xyz,
        frame.ambient_color_intensity.w,
    );
    let diffuse = journey_diffuse(normal, light.direction);
    // Richer shadow hue — blue-tinted like Sky's ambient light
    let shadow_ambient = base_color * vec3f(0.18, 0.24, 0.32) * light.ambient_color * light.ambient_intensity;
    let lit_color = base_color * light.color * light.intensity;
    var color = colored_shadow_blend(diffuse, lit_color, shadow_ambient, 0.28);

    // Translucent rim — sunlight through the blade edges
    let n_dot_v = dot(normal, view_dir);
    let rim = fresnel_rim(n_dot_v, 2.4, 0.42);
    // Rim color shifts warm when sun is behind blade
    let sun_rim_factor = saturate(1.0 - dot(normal, sun_dir) * 0.8);
    color += mix(vec3f(0.62, 0.88, 0.52), vec3f(0.98, 0.92, 0.62), sun_rim_factor) * rim * 0.38;

    // Subsurface scattering — sunlight punching through thin blades
    let sss_dir = safe_normalize(-sun_dir + normal * foliage.sss_distortion);
    let sss_dot = saturate(dot(view_dir, sss_dir));
    let sss = pow(sss_dot, foliage.sss_power) * foliage.sss_intensity * input.height_factor;
    color += foliage.sss_color * sss;

    // Soft atmospheric depth tint — far grass becomes cooler/bluer
    let depth_veil = smoothstep(10.0, 30.0, input.world_position.z);
    color = mix(color, color * vec3f(0.80, 0.88, 0.96), depth_veil * 0.36);

    // Alpha: smooth root to tip, fades at distance
    let view_distance = length(camera_pos - input.world_position);
    let distance_fade = 1.0 - smoothstep(34.0, 126.0, view_distance);
    let band_fade = 1.0 - smoothstep(30.0, 42.0, input.world_position.z);
    let alpha = smoothstep(0.018, 0.12, input.height_factor) * foliage.alpha * distance_fade * band_fade;
    if (alpha <= 0.002) {
        discard;
    }

    return vec4f(max(color, vec3f(0.0)), alpha);
}

// ============================================================
// Flower Pass — instanced billboard quads for scattered flowers
// Pink, yellow, and white patches across the meadow
// ============================================================

struct FlowerVSOut {
    @builtin(position) clip_position: vec4f,
    @location(0) world_position: vec3f,
    @location(1) uv: vec2f,
    @location(2) flower_color: vec3f,
    @location(3) depth_factor: f32,
};

fn flower_hash11(n: f32) -> f32 {
    return fract(sin(n * 134.1 + 274.9) * 47823.3);
}
fn flower_hash21(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(134.1, 274.9))) * 47823.3);
}

@vertex
fn vs_flower(
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32,
) -> FlowerVSOut {
    var output: FlowerVSOut;

    let aspect = max(frame.resolution_time.x / max(frame.resolution_time.y, 1.0), 0.1);
    let time = frame.resolution_time.z;
    let camera_offset = vec2f(frame.combo_misc.w, frame.controls.w);
    let terrain = build_terrain_params();
    let pulse = frame.resolution_time.w;

    // Billboard quad: 2 triangles = 6 verts
    let quad_verts = array<vec2f, 6>(
        vec2f(-0.5, 0.0),
        vec2f(0.5,  0.0),
        vec2f(-0.5, 1.0),
        vec2f(-0.5, 1.0),
        vec2f(0.5,  0.0),
        vec2f(0.5,  1.0),
    );
    let quad_uvs = array<vec2f, 6>(
        vec2f(0.0, 0.0),
        vec2f(1.0, 0.0),
        vec2f(0.0, 1.0),
        vec2f(0.0, 1.0),
        vec2f(1.0, 0.0),
        vec2f(1.0, 1.0),
    );
    let vert = quad_verts[min(vertex_index, 5u)];
    let uv   = quad_uvs[min(vertex_index, 5u)];

    let id = f32(instance_index);
    let seed_a = flower_hash11(id * 0.89 + 3.1);
    let seed_b = flower_hash11(id * 1.47 + 7.7);
    let seed_c = flower_hash11(id * 2.13 + 11.3);
    let seed_d = flower_hash11(id * 2.89 + 17.1);
    let seed_e = flower_hash11(id * 3.61 + 23.9);

    // Scatter flowers in patches across the meadow (narrower X than grass)
    let lateral_signed = seed_a * 2.0 - 1.0;
    var world_x = lateral_signed * 18.0 * aspect + camera_offset.x * 4.4;

    // Flowers in near-to-mid range only — don't spam the far field
    var world_z: f32;
    if (seed_b < 0.55) {
        world_z = mix(5.5, 14.0, seed_c);
    } else {
        world_z = mix(14.2, 26.0, seed_c);
    }
    world_z += camera_offset.y * 3.0;

    // Cluster gating — only spawn where noise peaks (patch effect)
    let cluster_uv_a = vec2f(world_x, world_z) * 0.17 + vec2f(4.3, 1.7);
    let cluster_uv_b = vec2f(world_x, world_z) * 0.21 + vec2f(9.1, 6.4);
    let cluster_noise_a = flower_hash21(floor(cluster_uv_a));
    let cluster_noise_b = flower_hash21(floor(cluster_uv_b));
    // Use smooth noise approximation
    let cn_a = mix(
        mix(flower_hash21(floor(cluster_uv_a)), flower_hash21(floor(cluster_uv_a) + vec2f(1.0, 0.0)), fract(cluster_uv_a).x),
        mix(flower_hash21(floor(cluster_uv_a) + vec2f(0.0, 1.0)), flower_hash21(floor(cluster_uv_a) + vec2f(1.0, 1.0)), fract(cluster_uv_a).x),
        fract(cluster_uv_a).y,
    );
    let cn_b = mix(
        mix(flower_hash21(floor(cluster_uv_b)), flower_hash21(floor(cluster_uv_b) + vec2f(1.0, 0.0)), fract(cluster_uv_b).x),
        mix(flower_hash21(floor(cluster_uv_b) + vec2f(0.0, 1.0)), flower_hash21(floor(cluster_uv_b) + vec2f(1.0, 1.0)), fract(cluster_uv_b).x),
        fract(cluster_uv_b).y,
    );
    let cluster_density = smoothstep(0.48, 0.74, cn_a) * smoothstep(0.45, 0.72, cn_b);
    // Path clearing
    let path_curve_f = sin(world_z * 0.058) * 2.4 + sin(world_z * 0.11) * 0.9;
    let path_dist_f = abs(world_x - camera_offset.x * 4.4 - path_curve_f);
    let path_clear = smoothstep(0.9, 2.4, path_dist_f);
    let density_gate = mix(0.26, 1.0, cluster_density) * path_clear;

    // Cull sparse instances
    if (seed_e > density_gate || density_gate < 0.12) {
        output.clip_position = vec4f(2.0, 2.0, 2.0, 1.0);
        output.world_position = vec3f(0.0);
        output.uv = vec2f(0.0);
        output.flower_color = vec3f(0.0);
        output.depth_factor = 0.0;
        return output;
    }

    // Flower type by seed — pink, yellow, white
    var flower_col = vec3f(0.97, 0.72, 0.84);    // pink
    if (seed_d > 0.66) {
        flower_col = vec3f(1.0, 0.94, 0.48);      // yellow
    } else if (seed_d > 0.33) {
        flower_col = vec3f(0.97, 0.97, 0.96);     // white
    }

    // Gentle bob in wind
    let bob = sin(time * (0.8 + seed_b * 0.6) + seed_a * 6.28318530718) * 0.06;
    let sway = sin(time * (0.6 + seed_c * 0.4) + world_x * 0.5) * 0.04;
    let height_factor = saturate(vert.y);

    // Small billboard size — flower heads above the grass
    let flower_size = mix(0.34, 0.22, seed_c) * (0.92 + pulse * 0.1);
    let flower_width = flower_size * mix(0.85, 1.15, seed_b);
    let stem_height = mix(1.0, 1.6, seed_d);    // stem lifts flower above grass

    let ground_height = terrain_height(vec2f(world_x, world_z), time, terrain) - terrain.horizon_lift * 0.56;
    let world_y = ground_height + stem_height * flower_size + height_factor * flower_size;
    let world_pos = vec3f(
        world_x + vert.x * flower_width + sway * height_factor,
        world_y + bob * height_factor,
        world_z,
    );

    let depth_norm = saturate((world_z - 5.5) / 22.0);
    let clip_depth = saturate((world_pos.z - 5.5) / 22.0);
    let perspective = mix(1.0, 0.52, clip_depth);
    let clip_x = (world_pos.x / (20.0 * aspect)) * perspective;
    let ground_line = mix(-0.96, -0.72, clip_depth) + camera_offset.y * 0.052;
    let visual_y = world_pos.y + terrain.horizon_lift * 0.50;
    let height_scale_f = max(frame.terrain_falloff_height.z * 7.5, 7.8);
    let clip_y = ground_line + (visual_y / height_scale_f) + (seed_b - 0.5) * 0.008;

    let clip_z = max(0.0, scene_depth_from_world_z(world_pos.z) - 0.0008 - height_factor * 0.0006);
    output.clip_position = vec4f(clip_x, clip_y, clip_z, 1.0);
    output.world_position = world_pos;
    output.uv = uv;
    output.flower_color = flower_col;
    output.depth_factor = depth_norm;
    return output;
}

@fragment
fn fs_flower(input: FlowerVSOut) -> @location(0) vec4f {
    let sun_dir = safe_normalize(frame.sun_dir.xyz);
    let pulse = frame.resolution_time.w;
    let combo = frame.combo_misc.x;

    // Circular petal mask — smooth disk for flower head
    let uv_centered = input.uv * 2.0 - vec2f(1.0);
    let dist = length(uv_centered);
    let petal_mask = 1.0 - smoothstep(0.52, 0.88, dist);
    if (petal_mask <= 0.01) {
        discard;
    }

    // Inner center disk — golden/warm
    let center_mask = 1.0 - smoothstep(0.0, 0.38, dist);
    let center_col = mix(vec3f(1.0, 0.88, 0.32), vec3f(0.92, 0.62, 0.22), dist * 2.0);
    var color = input.flower_color;
    color = mix(color, center_col, center_mask * 0.72);

    // Sunlit brightening
    let sun_lift = saturate(dot(vec3f(0.0, 1.0, 0.2), sun_dir)) * (0.22 + pulse * 0.08 + combo * 0.06);
    color += color * sun_lift;

    // Depth fade and alpha
    let dist_fade = 1.0 - smoothstep(0.72, 1.0, input.depth_factor);
    let alpha = petal_mask * dist_fade * (0.84 + pulse * 0.1);

    return vec4f(max(color, vec3f(0.0)), alpha);
}
`;
}

export function buildSkyChildrenPhase2TerrainWGSL(
    stylizedLightingCoreWGSL,
    terrainModuleWGSL,
) {
    return buildSkyChildrenPhase3TerrainCloudWGSL(
        stylizedLightingCoreWGSL,
        terrainModuleWGSL,
        FALLBACK_CLOUD_MODULE_WGSL,
    );
}

export function buildSkyChildrenPhase1BackgroundWGSL(stylizedLightingCoreWGSL, terrainModuleWGSL) {
    return buildSkyChildrenPhase2TerrainWGSL(stylizedLightingCoreWGSL, terrainModuleWGSL);
}

export function buildSkyChildrenPhase5PostWGSL(postProcessingWGSL) {
    if (typeof postProcessingWGSL !== 'string' || postProcessingWGSL.trim().length === 0) {
        throw new Error('buildSkyChildrenPhase5PostWGSL requires post-processing WGSL module');
    }
    return postProcessingWGSL;
}
