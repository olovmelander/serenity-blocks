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

struct Particle {
    pos_vel: vec4f,
    life_data: vec4f,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> flow: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> particles: array<Particle>;

fn flow_dims() -> vec2u {
    return vec2u(u32(max(params.quality.x, 1.0)), u32(max(params.quality.y, 1.0)));
}

fn flow_index(coord: vec2u) -> u32 {
    let dims = flow_dims();
    return coord.y * dims.x + coord.x;
}

fn hash11(value: f32) -> f32 {
    return fract(sin(value * 91.173) * 43758.5453123);
}

fn hash21(value: f32) -> vec2f {
    return vec2f(hash11(value + 0.17), hash11(value + 0.71));
}

fn sample_flow(uv: vec2f) -> vec4f {
    let dims = vec2f(flow_dims());
    let scaled = clamp(uv, vec2f(0.0), vec2f(0.9999)) * dims;
    let coord = vec2u(scaled);
    return flow[flow_index(coord)];
}

// Three ember classes by particle fraction:
//   SPARK  (frac < 0.50): hot, fast, short-lived, trailed — flung off the star
//   CINDER (0.50..0.82) : warm, slower, tumbling, longer-lived
//   DUST   (>= 0.82)     : cool motes scattered across the void, catch star light
fn spawn_particle(seed: f32, frac: f32) -> Particle {
    let flare = params.fx.y;
    let intensity = params.fx.w;
    let angle = seed * 6.28318;
    let tangent = vec2f(cos(angle), sin(angle));

    if (frac < 0.5) {
        // SPARK
        let radius = 0.004 + hash11(seed + 3.7) * 0.03;
        let spawn_pos = params.ember.xy + tangent * radius;
        let speed_boost = 1.0 + flare * 1.5 + intensity * 0.3;
        let outward = tangent * (0.0012 + hash11(seed + 5.1) * 0.002) * speed_boost;
        let upward = vec2f(0.0, -(0.0012 + hash11(seed + 8.4) * 0.0016));
        let size = (1.5 + hash11(seed + 1.1) * 3.0) * (1.0 + flare * 0.5);
        let alpha = (0.4 + hash11(seed + 9.3) * 0.5) * (1.0 + flare * 0.3);
        let life = 0.5 + hash11(seed + 2.2) * 0.7;
        return Particle(vec4f(spawn_pos, outward + upward), vec4f(life, seed, size, alpha));
    } else if (frac < 0.82) {
        // CINDER
        let radius = 0.02 + hash11(seed + 3.7) * 0.09;
        let spawn_pos = params.ember.xy + tangent * radius;
        let outward = tangent * (0.0004 + hash11(seed + 5.1) * 0.0008);
        let upward = vec2f(0.0, -(0.0005 + hash11(seed + 8.4) * 0.001));
        let size = 2.0 + hash11(seed + 1.1) * 4.0;
        let alpha = 0.22 + hash11(seed + 9.3) * 0.35;
        let life = 1.5 + hash11(seed + 2.2) * 1.6;
        return Particle(vec4f(spawn_pos, outward + upward), vec4f(life, seed, size, alpha));
    }

    // DUST — scattered across the whole frame, drifting slowly.
    let dpos = vec2f(hash11(seed + 1.3), hash11(seed + 2.7));
    let drift = (vec2f(hash11(seed + 4.1), hash11(seed + 6.9)) - 0.5) * 0.0004;
    let size = 0.8 + hash11(seed + 1.1) * 1.4;
    let alpha = 0.06 + hash11(seed + 9.3) * 0.16;
    let life = 4.0 + hash11(seed + 2.2) * 5.0;
    return Particle(vec4f(dpos, drift), vec4f(life, seed, size, alpha));
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) global_id: vec3u) {
    let index = global_id.x;
    let particle_count = u32(max(params.quality.w, 0.0));
    if (index >= particle_count) {
        return;
    }

    var particle = particles[index];
    let dt = clamp(params.sim.y, 0.001, 0.05);
    let seed = particle.life_data.y + f32(index) * 0.173;
    let frac = f32(index) / max(params.quality.w, 1.0);
    let is_spark = frac < 0.5;
    let is_dust = frac >= 0.82;

    // Unpack gameplay FX
    let shockwave = params.fx.x;
    let flare = params.fx.y;
    let flash = params.fx.z;

    if (particle.life_data.x <= 0.001) {
        particles[index] = spawn_particle(hash11(seed + params.sim.x * 0.07), frac);
        return;
    }

    // Per-class motion tuning (defaults = cinder).
    var flow_infl = 0.8;
    var buoy = 0.0006;
    var pull = 0.0003;
    var drag = 0.978;
    var decay = 0.26;
    var react = 1.0;
    if (is_spark) {
        flow_infl = 1.0;
        buoy = 0.0012;
        pull = 0.00012;
        drag = 0.985;
        decay = 0.55;
    } else if (is_dust) {
        flow_infl = 0.45;
        buoy = 0.00012;
        pull = 0.0;
        drag = 0.97;
        decay = 0.07;
        react = 0.2;
    }

    let flow_sample = sample_flow(particle.pos_vel.xy);
    let center_delta = params.ember.xy - particle.pos_vel.xy;
    let distance_to_core = max(length(center_delta), 0.0001);
    let inward = center_delta / distance_to_core;
    let outward = -inward;
    let noise = hash21(seed + params.sim.x * 0.13) - 0.5;

    let turbulence = (flow_sample.xy * flow_infl + noise * 0.0012) * (1.0 + params.reaction.y * 0.4);
    let inward_pull = inward * (pull + params.reaction.x * 0.0004 + params.ember.w * 0.001);
    let buoyancy = vec2f(0.0, -(buoy + flow_sample.z * 0.0006));

    // === SHOCKWAVE PUSH === (dust barely reacts)
    let shock_radius = shockwave * 0.45;
    let shock_dist = abs(distance_to_core - shock_radius);
    let shock_impact = exp(-shock_dist * 30.0) * shockwave * (1.0 - shockwave) * 4.0;
    let shock_force = outward * shock_impact * 0.008 * react;

    // === FLASH JOLT ===
    let flash_jolt = vec2f(
        (hash11(seed + params.sim.x * 7.3) - 0.5),
        (hash11(seed + params.sim.x * 11.1) - 0.5)
    ) * flash * 0.003 * react;

    let new_vel = particle.pos_vel.zw * drag + turbulence + buoyancy + inward_pull + shock_force + flash_jolt;
    let new_pos = particle.pos_vel.xy + new_vel * (dt * 60.0);
    particle.pos_vel = vec4f(new_pos, new_vel);

    let new_life = particle.life_data.x - dt * (decay + hash11(seed + 7.4) * decay * 0.5);
    let new_size = max(0.7, particle.life_data.z * (0.999 - params.ember.w * 0.004));

    let flare_alpha_boost = flare * 0.05;
    let new_alpha = clamp(
        particle.life_data.w + params.reaction.y * 0.003 + flow_sample.w * 0.002 + flare_alpha_boost,
        0.04,
        1.5,
    );
    particle.life_data = vec4f(new_life, particle.life_data.y, new_size, new_alpha);

    let out_of_bounds = particle.pos_vel.x < -0.12
        || particle.pos_vel.x > 1.12
        || particle.pos_vel.y < -0.12
        || particle.pos_vel.y > 1.12;

    if (particle.life_data.x <= 0.0 || out_of_bounds) {
        particles[index] = spawn_particle(hash11(seed + params.sim.x * 0.31), frac);
        return;
    }

    particles[index] = particle;
}
