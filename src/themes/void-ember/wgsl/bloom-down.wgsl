// ============================================================================
// Void Ember — bloom downsample (levels 1..N)
//
// Jimenez/COD 13-tap downsample filter. No threshold (the prefilter already
// applied it). Stable under motion and cheap.
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

    var col = e * 0.125;
    col = col + (a + c + g + ii) * 0.03125;
    col = col + (b + d + f + h) * 0.0625;
    col = col + (j + k + l + m) * 0.125;
    return vec4f(col, 1.0);
}
