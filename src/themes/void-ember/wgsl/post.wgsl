struct Params {
    resolution: vec4f,
    sim: vec4f,
    ember: vec4f,
    reaction: vec4f,
    quality: vec4f,
    post: vec4f,
    colorA: vec4f,
    colorB: vec4f,
    misc: vec4f,
    fx: vec4f,
    star0: vec4f, // temperature, agitation, coronaEnergy, breath
    star1: vec4f, // novaFlash, cmePulse, cameraPush, reserved
};

struct VSOut {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var scene_texture: texture_2d<f32>;
@group(0) @binding(2) var scene_sampler: sampler;
@group(0) @binding(3) var history_texture: texture_2d<f32>;
@group(0) @binding(4) var bloom_texture: texture_2d<f32>;

fn hash12(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

fn luminance(color: vec3f) -> f32 {
    return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}

fn bright_sample(uv: vec2f) -> vec3f {
    let color = textureSampleLevel(scene_texture, scene_sampler, uv, 0.0).rgb;
    let luma = luminance(color);
    // Dynamic threshold: lower during flare, but keep bright points from flooding the frame.
    let flare = params.fx.y;
    let threshold = max(params.post.y - flare * 0.22, 0.25);
    let shoulder = smoothstep(threshold, threshold + 1.25, luma);
    let gain = max(luma - threshold, 0.0) * shoulder;
    return color * gain / max(luma, 0.001);
}

fn aces(color: vec3f) -> vec3f {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((color * (a * color + b)) / (color * (c * color + d) + e), vec3f(0.0), vec3f(1.0));
}

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VSOut {
    let positions = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0),
    );

    var output: VSOut;
    let pos = positions[vertex_index];
    output.position = vec4f(pos, 0.0, 1.0);
    output.uv = pos * 0.5 + vec2f(0.5);
    return output;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4f {
    let uv = input.uv;
    let texel = params.resolution.zw;
    let aspect = max(params.sim.z, 0.001);

    // Unpack gameplay FX + StellarConductor life-state
    let shockwave = params.fx.x;
    let flare = params.fx.y;
    let flash = params.fx.z;
    let intensity = params.fx.w;
    let temperature = params.star0.x;
    let corona_energy = params.star0.z;
    let time = params.sim.x;

    // ============================================================
    // GRAVITATIONAL LENSING — subtle UV distortion near ember core
    // ============================================================
    let ember_ndc = params.ember.xy;  // ember position in UV space
    let to_ember = uv - ember_ndc;
    let lens_dist = length(to_ember * vec2f(aspect, 1.0));
    // Lensing ring: strongest at a radius around the core, zero at center and far
    let lens_strength = 0.012 + intensity * 0.004 + flare * 0.008;
    let lens_ring = exp(-lens_dist * 12.0) * (1.0 - exp(-lens_dist * 60.0));
    let lens_dir = normalize(to_ember + vec2f(0.00001));
    var lensed_uv = uv + lens_dir * lens_ring * lens_strength;

    // ============================================================
    // HEAT-HAZE — refractive shimmer in the hot air near the star
    // ============================================================
    let heat_prox = exp(-lens_dist * 3.2);
    let heat_n = ve_noise3(vec3f(uv * 22.0, time * 0.7));
    let heat_n2 = ve_noise3(vec3f(uv * 22.0 + vec2f(7.3, 2.1), time * 0.7 + 4.0));
    let heat_amp = heat_prox * (0.0025 + corona_energy * 0.004 + flare * 0.003);
    lensed_uv = lensed_uv + (vec2f(heat_n, heat_n2) - 0.5) * heat_amp;

    // ============================================================
    // CHROMATIC ABERRATION — edge-weighted radial RGB split
    // ============================================================
    let ca_dir = normalize(uv - vec2f(0.5) + vec2f(1e-5));
    let ca_edge = dot(uv - vec2f(0.5), uv - vec2f(0.5)); // ~r^2 from centre
    let ca_off = ca_dir * ca_edge * (0.004 + flare * 0.004);
    let base_raw = vec3f(
        textureSampleLevel(scene_texture, scene_sampler, lensed_uv + ca_off, 0.0).r,
        textureSampleLevel(scene_texture, scene_sampler, lensed_uv, 0.0).g,
        textureSampleLevel(scene_texture, scene_sampler, lensed_uv - ca_off, 0.0).b,
    );
    let cardinal_neighbors = (
        textureSampleLevel(scene_texture, scene_sampler, lensed_uv + vec2f(-1.0, 0.0) * texel, 0.0).rgb
        + textureSampleLevel(scene_texture, scene_sampler, lensed_uv + vec2f(1.0, 0.0) * texel, 0.0).rgb
        + textureSampleLevel(scene_texture, scene_sampler, lensed_uv + vec2f(0.0, -1.0) * texel, 0.0).rgb
        + textureSampleLevel(scene_texture, scene_sampler, lensed_uv + vec2f(0.0, 1.0) * texel, 0.0).rgb
    ) * 0.25;
    let detail = base_raw - cardinal_neighbors;
    let hot_guard = 1.0 - smoothstep(1.3, 5.0, luminance(base_raw));
    let sharpness = clamp(params.misc.w, 0.0, 0.35) * mix(0.35, 1.0, hot_guard);
    let base = max(base_raw + detail * sharpness, vec3f(0.0));

    // Dynamic bloom: stronger during flare events (tamed so peaks don't whiteout)
    let bloom_boost = 1.0 + flare * 0.45 + flash * 0.6 + intensity * 0.1;

    // Soft, wide HDR bloom from the dual-filter pyramid (bloom-*.wgsl), already
    // bright-passed and energy-preserving — replaces the old single-pass taps.
    var bloom = textureSampleLevel(bloom_texture, scene_sampler, lensed_uv, 0.0).rgb;

    // Anamorphic streaks — directional; kept here until the Phase 4 lens-flare pass.
    let streak_strength = params.post.z + flare * 0.04;
    if (streak_strength > 0.0001) {
        bloom = bloom + bright_sample(lensed_uv + vec2f(-8.0, 0.0) * texel) * streak_strength * 0.45;
        bloom = bloom + bright_sample(lensed_uv + vec2f(8.0, 0.0) * texel) * streak_strength * 0.45;
        bloom = bloom + bright_sample(lensed_uv + vec2f(-15.0, 0.0) * texel) * streak_strength * 0.24;
        bloom = bloom + bright_sample(lensed_uv + vec2f(15.0, 0.0) * texel) * streak_strength * 0.24;
    }

    // ============================================================
    // VOLUMETRIC GOD RAYS — 6-sample radial march (was 10)
    // Larger steps + higher weight compensate for fewer samples
    // ============================================================
    let ray_weight = 0.045 + flare * 0.025 + flash * 0.04;
    var god_rays = vec3f(0.0);
    var ray_uv = lensed_uv;
    let ray_dir = (ember_ndc - lensed_uv) * 0.14;
    var ray_illumination_decay = 1.0;

    for (var r = 0; r < 6; r = r + 1) {
        ray_uv = ray_uv + ray_dir;
        let ray_sample = textureSampleLevel(scene_texture, scene_sampler,
            clamp(ray_uv, vec2f(0.001), vec2f(0.999)), 0.0).rgb;
        let ray_bright = max(luminance(ray_sample) - 0.55, 0.0);
        god_rays = god_rays + ray_sample * ray_bright * ray_illumination_decay * ray_weight;
        ray_illumination_decay = ray_illumination_decay * 0.88;
    }

    // The dual-filter pyramid is energy-rich (it accumulates every mip), so the
    // strength knob is scaled down vs the old single-pass taps.
    var color = base + bloom * params.post.x * 0.6 * bloom_boost + god_rays;

    // ============================================================
    // CINEMATIC LENS FLARE (lens-flare.wgsl) — gated by anamorphic strength
    // so it's off on Low and scales up with quality / events.
    // ============================================================
    let flare_strength = params.post.z;
    if (flare_strength > 0.0001) {
        let disp = 0.32;
        let ghosts = ve_lens_ghosts(bloom_texture, scene_sampler, uv, disp, 0.012 + flare * 0.01);
        let halo = ve_lens_halo(bloom_texture, scene_sampler, uv, 0.42);
        // Warm lens-coating tint so ghosts read as ember-coloured, not grey.
        let coat = vec3f(1.0, 0.72, 0.45);
        color = color + (ghosts + halo) * coat * (flare_strength * 5.0 + flare * 0.4);

        // Diffraction starburst anchored on the star, energised by the corona.
        let burst = ve_starburst(uv, ember_ndc, aspect, time);
        color = color + ve_blackbody(min(1.0, temperature + 0.15)) * burst
            * (0.5 + corona_energy * 1.2 + flare * 1.5) * (0.4 + flare_strength * 6.0);
    }

    let event_temporal_suppression = clamp(flare * 0.5 + flash * 0.8 + shockwave * 0.3, 0.0, 0.85);
    let bright_temporal_suppression = smoothstep(0.7, 2.5, luminance(color)) * 0.55;
    let temporal_mix = clamp(
        params.post.w * (1.0 - event_temporal_suppression) * (1.0 - bright_temporal_suppression),
        0.0,
        0.95
    );
    if (temporal_mix > 0.001) {
        var history = textureSampleLevel(history_texture, scene_sampler, uv, 0.0).rgb;
        let clamp_delta = params.misc.z;
        history = clamp(history, color - vec3f(clamp_delta), color + vec3f(clamp_delta));
        color = mix(color, history, temporal_mix);
    }

    // Vignette — tightens slightly during intense play
    let vignette_coord = uv * (1.0 - uv.yx);
    let vignette_power = 0.34 + intensity * 0.06;
    let vignette = pow(clamp(vignette_coord.x * vignette_coord.y * 20.0, 0.0, 1.0), vignette_power);
    color = color * mix(1.0 - params.misc.x, 1.0, vignette);

    // Exposure boosted during flash (gentle — bloom already carries the punch)
    let dynamic_exposure = params.colorA.w + flash * 0.15 + flare * 0.06;
    color = aces(color * dynamic_exposure);

    // Film grain — animated per frame, a touch stronger in shadows (filmic).
    let grain_seed = uv * params.resolution.xy + vec2f(time * 91.7, params.sim.w);
    let grain = hash12(grain_seed) - 0.5;
    let grain_amt = params.misc.y + 0.012;
    color = clamp(color + grain * grain_amt * (1.0 - luminance(color) * 0.6), vec3f(0.0), vec3f(1.0));

    return vec4f(color, 1.0);
}
