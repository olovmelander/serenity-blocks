struct VSOut {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@group(0) @binding(0) var present_texture: texture_2d<f32>;
@group(0) @binding(1) var present_sampler: sampler;

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
    let color = textureSampleLevel(present_texture, present_sampler, input.uv, 0.0).rgb;
    return vec4f(color, 1.0);
}
