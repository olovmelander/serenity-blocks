// ============================================================================
// Void Ember — bloom upsample (levels N-1 .. 0)
//
// 3x3 tent filter on the smaller (more-blurred) level, additively blended onto
// the next-larger level (pipeline blend = one/one). Progressive upsampling +
// accumulation is what makes the bloom soft and wide with no tap-pattern.
// ============================================================================

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

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

fn tap(uv: vec2f) -> vec3f {
    return textureSampleLevel(src, samp, uv, 0.0).rgb;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4f {
    let texel = 1.0 / vec2f(textureDimensions(src, 0));
    let uv = input.uv;

    let a = tap(uv + vec2f(-1.0, -1.0) * texel);
    let b = tap(uv + vec2f(0.0, -1.0) * texel);
    let c = tap(uv + vec2f(1.0, -1.0) * texel);
    let d = tap(uv + vec2f(-1.0, 0.0) * texel);
    let e = tap(uv);
    let f = tap(uv + vec2f(1.0, 0.0) * texel);
    let g = tap(uv + vec2f(-1.0, 1.0) * texel);
    let h = tap(uv + vec2f(0.0, 1.0) * texel);
    let ii = tap(uv + vec2f(1.0, 1.0) * texel);

    var col = e * 4.0;
    col = col + (b + d + f + h) * 2.0;
    col = col + (a + c + g + ii);
    col = col * (1.0 / 16.0);
    return vec4f(col, 1.0);
}
