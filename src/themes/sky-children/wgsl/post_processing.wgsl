// ============================================================
// Module: post_processing.wgsl
// Phase 5 post stack for Sky Children WebGPU path:
// - Dual-Kawase-inspired bloom sampling
// - AgX tonemapping path (with runtime mix)
// - Sky-style warm/cool grading
// ============================================================

struct PostUniforms {
    resolution_time: vec4f,          // x=width, y=height, z=time, w=pulse
    bloom_params: vec4f,             // x=threshold, y=softKnee, z=blend, w=radius
    grading_params: vec4f,           // x=exposure, y=contrast, z=saturation, w=agxMix
    shadow_color_strength: vec4f,    // rgb=shadowColor, w=shadowStrength
    highlight_color_strength: vec4f, // rgb=highlightColor, w=highlightStrength
    midtone_color_strength: vec4f,   // rgb=midtoneColor, w=midtoneStrength
};

@group(0) @binding(0) var scene_input: texture_2d<f32>;
@group(0) @binding(1) var scene_sampler: sampler;
@group(0) @binding(2) var<uniform> post: PostUniforms;

struct VSOut {
    @builtin(position) clip_position: vec4f,
    @location(0) uv: vec2f,
};

fn saturate(v: f32) -> f32 {
    return clamp(v, 0.0, 1.0);
}

fn soft_clip(v: vec3f) -> vec3f {
    let c = max(v, vec3f(0.0));
    return c / (c + vec3f(1.0));
}

fn sky_vibrance(color: vec3f, amount: f32) -> vec3f {
    let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
    let saturation_lift = 1.0 + amount * (1.0 - luma);
    return mix(vec3f(luma), color, saturation_lift);
}

@vertex
fn vs_post(@builtin(vertex_index) vertex_index: u32) -> VSOut {
    let positions = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0),
    );

    var output: VSOut;
    let pos = positions[vertex_index];
    output.clip_position = vec4f(pos, 0.0, 1.0);
    output.uv = pos * 0.5 + vec2f(0.5);
    return output;
}

fn bloom_threshold(color: vec3f, threshold: f32, knee: f32) -> vec3f {
    let brightness = max(color.r, max(color.g, color.b));
    let safe_knee = max(knee, 1e-5);
    let soft = brightness - threshold + safe_knee;
    let soft_clamped = clamp(soft, 0.0, 2.0 * safe_knee);
    let contribution = soft_clamped * soft_clamped / (4.0 * safe_knee + 1e-5);
    let mult = max(brightness - threshold, contribution) / max(brightness, 1e-5);
    return color * mult;
}

fn kawase_downsample(uv: vec2f, texel: vec2f) -> vec3f {
    let a = textureSampleLevel(scene_input, scene_sampler, uv, 0.0).rgb * 4.0;
    let b = textureSampleLevel(scene_input, scene_sampler, uv + vec2f(-texel.x, -texel.y), 0.0).rgb;
    let c = textureSampleLevel(scene_input, scene_sampler, uv + vec2f(texel.x, -texel.y), 0.0).rgb;
    let d = textureSampleLevel(scene_input, scene_sampler, uv + vec2f(-texel.x, texel.y), 0.0).rgb;
    let e = textureSampleLevel(scene_input, scene_sampler, uv + vec2f(texel.x, texel.y), 0.0).rgb;
    return (a + b + c + d + e) * 0.125;
}

fn kawase_upsample(uv: vec2f, texel: vec2f) -> vec3f {
    let ht = texel * 0.5;
    var result = textureSampleLevel(scene_input, scene_sampler, uv + vec2f(-ht.x * 2.0, 0.0), 0.0).rgb;
    result += textureSampleLevel(scene_input, scene_sampler, uv + vec2f(-ht.x, ht.y), 0.0).rgb * 2.0;
    result += textureSampleLevel(scene_input, scene_sampler, uv + vec2f(0.0, ht.y * 2.0), 0.0).rgb;
    result += textureSampleLevel(scene_input, scene_sampler, uv + vec2f(ht.x, ht.y), 0.0).rgb * 2.0;
    result += textureSampleLevel(scene_input, scene_sampler, uv + vec2f(ht.x * 2.0, 0.0), 0.0).rgb;
    result += textureSampleLevel(scene_input, scene_sampler, uv + vec2f(ht.x, -ht.y), 0.0).rgb * 2.0;
    result += textureSampleLevel(scene_input, scene_sampler, uv + vec2f(0.0, -ht.y * 2.0), 0.0).rgb;
    result += textureSampleLevel(scene_input, scene_sampler, uv + vec2f(-ht.x, -ht.y), 0.0).rgb * 2.0;
    return result / 12.0;
}

fn agx_default_contrast(x: vec3f) -> vec3f {
    let x2 = x * x;
    let x4 = x2 * x2;
    return 15.5 * x4 * x2
        - 40.14 * x4 * x
        + 31.96 * x4
        - 6.868 * x2 * x
        + 0.4298 * x2
        + 0.1191 * x
        - 0.00232;
}

fn agx_tonemap(color: vec3f) -> vec3f {
    let agx_mat = mat3x3f(
        vec3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051),
        vec3f(0.0784335999999992, 0.878468636469772, 0.0784336),
        vec3f(0.0792237451477643, 0.0791661274605434, 0.879142973793104)
    );

    let min_ev = -12.47393;
    let max_ev = 4.026069;

    var val = agx_mat * color;
    val = clamp(log2(max(val, vec3f(1e-10))), vec3f(min_ev), vec3f(max_ev));
    val = (val - vec3f(min_ev)) / (max_ev - min_ev);
    return agx_default_contrast(val);
}

fn agx_look_golden_hour(color: vec3f) -> vec3f {
    let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
    let power = vec3f(1.3, 1.25, 1.4);
    let saturation_boost = 1.35;

    var result = pow(max(color, vec3f(0.0)), power);
    result = mix(vec3f(luma), result, saturation_boost);
    return result;
}

fn agx_look_sky(color: vec3f) -> vec3f {
    let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
    // Gentle power: slight warm lift on R/G, preserve blue channel — keeps sky blue vivid
    let power = vec3f(1.06, 1.03, 0.95);
    let saturation_boost = 1.14;
    var result = pow(max(color, vec3f(0.0)), power);
    result = mix(vec3f(luma), result, saturation_boost);
    return result;
}

fn agx_eotf(color: vec3f) -> vec3f {
    let inv = mat3x3f(
        vec3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438),
        vec3f(-0.0980208811401368, 1.15190312990417, -0.0980434501171241),
        vec3f(-0.0990297440797205, -0.0989611768448433, 1.15107367264116)
    );
    return inv * color;
}

fn sky_color_grade(color: vec3f) -> vec3f {
    var c = max(color, vec3f(0.0));
    c *= exp2(post.grading_params.x);
    c = mix(vec3f(0.18), c, post.grading_params.y);

    let luma = dot(c, vec3f(0.2126, 0.7152, 0.0722));

    let shadow_w = 1.0 - smoothstep(0.0, 0.35, luma);
    c = mix(c, c * post.shadow_color_strength.xyz, shadow_w * post.shadow_color_strength.w);

    let highlight_w = smoothstep(0.5, 1.0, luma);
    c = mix(c, c * post.highlight_color_strength.xyz, highlight_w * post.highlight_color_strength.w);

    let midtone_w = 1.0 - abs(luma - 0.5) * 2.0;
    c = mix(c, c * post.midtone_color_strength.xyz, midtone_w * post.midtone_color_strength.w);

    let grey = dot(c, vec3f(0.2126, 0.7152, 0.0722));
    c = mix(vec3f(grey), c, post.grading_params.z);
    return max(c, vec3f(0.0));
}

@fragment
fn fs_post(input: VSOut) -> @location(0) vec4f {
    let dims = max(vec2f(textureDimensions(scene_input, 0)), vec2f(1.0));
    let texel = vec2f(1.0) / dims;
    let bloom_radius = max(post.bloom_params.w, 0.35);
    let scene_uv = input.uv;

    let scene = textureSampleLevel(scene_input, scene_sampler, scene_uv, 0.0).rgb;

    let bloom0 = kawase_downsample(scene_uv, texel * bloom_radius);
    let bloom1 = kawase_downsample(scene_uv, texel * bloom_radius * 2.0);
    let bloom2 = kawase_upsample(scene_uv, texel * bloom_radius * 1.6);
    let bloom_raw = bloom0 * 0.45 + bloom1 * 0.35 + bloom2 * 0.2;
    let bloom = bloom_threshold(bloom_raw, post.bloom_params.x, post.bloom_params.y);
    let highlight_spark = max(scene - vec3f(post.bloom_params.x), vec3f(0.0));

    var color = scene + bloom * post.bloom_params.z;
    color += highlight_spark * vec3f(0.22, 0.2, 0.17) * post.bloom_params.z;
    color = sky_color_grade(color);

    let agx_color = max(agx_eotf(agx_look_sky(agx_tonemap(color))), vec3f(0.0));
    let fallback_color = soft_clip(color);
    let agx_mix = saturate(post.grading_params.w);
    color = mix(fallback_color, soft_clip(agx_color * 1.06), agx_mix);
    color = sky_vibrance(color, 0.08 + agx_mix * 0.1);

    return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
