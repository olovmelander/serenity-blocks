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
@group(0) @binding(1) var<storage, read> flow_in: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> flow_out: array<vec4f>;

fn flow_dims() -> vec2u {
    return vec2u(u32(max(params.quality.x, 1.0)), u32(max(params.quality.y, 1.0)));
}

fn flow_index(coord: vec2u) -> u32 {
    let dims = flow_dims();
    return coord.y * dims.x + coord.x;
}

fn hash12(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

fn read_flow(coord: vec2i) -> vec4f {
    let dims = vec2i(flow_dims());
    let safe = vec2u(
        u32(clamp(coord.x, 0, dims.x - 1)),
        u32(clamp(coord.y, 0, dims.y - 1)),
    );
    return flow_in[flow_index(safe)];
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3u) {
    let dims = flow_dims();
    if (global_id.x >= dims.x || global_id.y >= dims.y) {
        return;
    }

    let coord = vec2i(i32(global_id.x), i32(global_id.y));
    let uv = (vec2f(coord) + 0.5) / vec2f(dims);
    let center = params.ember.xy;
    let offset = uv - center;
    let distance_to_core = max(length(offset), 0.0001);
    let radial = offset / distance_to_core;
    let swirl = vec2f(-radial.y, radial.x);

    // Unpack gameplay FX
    let shockwave = params.fx.x;
    let flare = params.fx.y;
    let flash = params.fx.z;
    let intensity = params.fx.w;

    let center_sample = read_flow(coord);
    let left = read_flow(coord + vec2i(-1, 0));
    let right = read_flow(coord + vec2i(1, 0));
    let up = read_flow(coord + vec2i(0, -1));
    let down = read_flow(coord + vec2i(0, 1));
    let up_left = read_flow(coord + vec2i(-1, -1));
    let up_right = read_flow(coord + vec2i(1, -1));
    let down_left = read_flow(coord + vec2i(-1, 1));
    let down_right = read_flow(coord + vec2i(1, 1));

    let smoothed = (
        center_sample
        + (left + right + up + down) * 0.85
        + (up_left + up_right + down_left + down_right) * 0.55
    ) / (1.0 + 0.85 * 4.0 + 0.55 * 4.0);

    let ember_falloff = smoothstep(0.78, 0.02, distance_to_core);
    let noise_phase = hash12(uv * vec2f(91.0, 143.0));
    let pulse = 0.55 + 0.45 * sin(params.sim.x * 1.35 + noise_phase * 6.28318);
    let slow_drift = vec2f(
        sin(params.sim.x * 0.09 + uv.y * 7.0),
        cos(params.sim.x * 0.07 + uv.x * 6.0)
    ) * 0.00028;

    let swirl_force = swirl * ember_falloff * (0.0038 + params.reaction.y * 0.003 + params.reaction.z * 0.002);
    let pull_force = -radial * ember_falloff * (0.0016 + params.reaction.x * 0.0038 + params.ember.w * 0.0065);
    let shear = vec2f(offset.y, -offset.x) * (0.00045 + params.reaction.z * 0.0007);

    // === SHOCKWAVE BLAST ===
    // On shockwave, inject a strong outward radial impulse that pushes flow away from core
    let shock_radius = shockwave * 0.45;
    let shock_dist = abs(distance_to_core - shock_radius);
    let shock_impact = exp(-shock_dist * 35.0) * shockwave * (1.0 - shockwave) * 4.0;
    let shock_push = radial * shock_impact * 0.012;

    // === FLARE TURBULENCE ===
    // During flares, amplify swirl and add chaotic velocity
    let flare_chaos = vec2f(
        sin(params.sim.x * 3.7 + uv.y * 18.0),
        cos(params.sim.x * 2.9 + uv.x * 15.0)
    ) * flare * ember_falloff * 0.003;

    let target_velocity = swirl_force + pull_force + shear + slow_drift + shock_push + flare_chaos;

    var next_velocity = smoothed.xy * 0.95 + target_velocity * 0.9;
    next_velocity = mix(next_velocity, center_sample.xy, 0.12);

    let base_emission = exp(-distance_to_core * 24.0) * (0.24 + pulse * 0.18);
    let combo_veil = exp(-distance_to_core * 10.0) * params.reaction.y * 0.03;
    let event_swell = exp(-distance_to_core * 6.0) * params.reaction.x * 0.04;
    let collapse_drain = mix(1.0, 0.35, clamp(params.ember.w, 0.0, 1.0));

    // Flare injects additional density — ember expands visually
    let flare_emission = exp(-distance_to_core * 12.0) * flare * 0.08;
    // Flash spikes density briefly
    let flash_emission = exp(-distance_to_core * 18.0) * flash * 0.12;
    // Intensity raises baseline density
    let intensity_glow = exp(-distance_to_core * 20.0) * intensity * 0.015;

    var density = max(smoothed.z * 0.986, (base_emission + combo_veil + event_swell + flare_emission + flash_emission + intensity_glow) * collapse_drain);
    density += hash12(uv * vec2f(53.0, 19.0) + params.sim.x * 0.01) * 0.0028 * ember_falloff;
    density = clamp(density, 0.0, 3.5);

    // Heat spiked by flare and flash — makes everything glow hotter
    let flare_heat = exp(-distance_to_core * 14.0) * flare * 0.35;
    let flash_heat = exp(-distance_to_core * 8.0) * flash * 0.5;
    let intensity_heat = intensity * 0.04;

    var heat = max(
        smoothed.w * 0.988,
        exp(-distance_to_core * 36.0) * (0.55 + params.ember.z * 0.9) + params.reaction.x * 0.08 + flare_heat + flash_heat + intensity_heat,
    );
    heat = clamp(heat * collapse_drain, 0.0, 4.5);

    flow_out[flow_index(global_id.xy)] = vec4f(next_velocity, density, heat);
}
