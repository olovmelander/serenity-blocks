// ============================================================================
// Void Ember — bloom prefilter (first downsample, level 0)
//
// 13-tap downsample of the HDR scene with a Karis luminance-weighted average
// (firefly suppression) + a soft-knee bright-pass. Writes the half-res base of
// the dual-filter bloom pyramid. Threshold comes from the main uniform
// (post.y), lowered during flares (fx.y) to match the old behaviour.
// ============================================================================

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
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct VSOut {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VSOut {
    let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    var out: VSOut;
    let p = positions[vertex_index];
    out.position = vec4f(p, 0.0, 1.0);
    out.uv = p * 0.5 + vec2f(0.5);
    return out;
}

fn luma(c: vec3f) -> f32 {
    return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn tap(uv: vec2f) -> vec3f {
    return textureSampleLevel(src, samp, uv, 0.0).rgb;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4f {
    let texel = 1.0 / vec2f(textureDimensions(src, 0));
    let uv = input.uv;

    let a = tap(uv + vec2f(-2.0, -2.0) * texel);
    let b = tap(uv + vec2f(0.0, -2.0) * texel);
    let c = tap(uv + vec2f(2.0, -2.0) * texel);
    let d = tap(uv + vec2f(-2.0, 0.0) * texel);
    let e = tap(uv);
    let f = tap(uv + vec2f(2.0, 0.0) * texel);
    let g = tap(uv + vec2f(-2.0, 2.0) * texel);
    let h = tap(uv + vec2f(0.0, 2.0) * texel);
    let ii = tap(uv + vec2f(2.0, 2.0) * texel);
    let j = tap(uv + vec2f(-1.0, -1.0) * texel);
    let k = tap(uv + vec2f(1.0, -1.0) * texel);
    let l = tap(uv + vec2f(-1.0, 1.0) * texel);
    let m = tap(uv + vec2f(1.0, 1.0) * texel);

    // Five box averages, then Karis-weighted to suppress fireflies.
    let g0 = (a + b + d + e) * 0.25;
    let g1 = (b + c + e + f) * 0.25;
    let g2 = (d + e + g + h) * 0.25;
    let g3 = (e + f + h + ii) * 0.25;
    let g4 = (j + k + l + m) * 0.25;
    let w0 = 1.0 / (1.0 + luma(g0));
    let w1 = 1.0 / (1.0 + luma(g1));
    let w2 = 1.0 / (1.0 + luma(g2));
    let w3 = 1.0 / (1.0 + luma(g3));
    let w4 = 1.0 / (1.0 + luma(g4));
    var col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4)
        / max(w0 + w1 + w2 + w3 + w4, 1e-4);

    // Soft-knee bright-pass.
    let br = max(col.r, max(col.g, col.b));
    let threshold = max(params.post.y - params.fx.y * 0.22, 0.25);
    let knee = threshold * 0.6 + 1e-4;
    let soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
    let soft_curve = (soft * soft) / (4.0 * knee + 1e-4);
    let contrib = max(soft_curve, br - threshold) / max(br, 1e-4);
    col = col * max(contrib, 0.0);

    return vec4f(col, 1.0);
}
