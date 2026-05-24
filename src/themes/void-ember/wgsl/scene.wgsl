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

struct VSOut {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> flow: array<vec4f>;

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

fn hash22(p: vec2f) -> vec2f {
    return vec2f(
        fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123),
        fract(sin(dot(p, vec2f(269.5, 183.3))) * 43758.5453123),
    );
}

fn hash13(p: vec3f) -> f32 {
    return fract(sin(dot(p, vec3f(127.1, 311.7, 191.999))) * 43758.5453123);
}

fn noise3(p: vec3f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);

    let n000 = hash13(i + vec3f(0.0, 0.0, 0.0));
    let n100 = hash13(i + vec3f(1.0, 0.0, 0.0));
    let n010 = hash13(i + vec3f(0.0, 1.0, 0.0));
    let n110 = hash13(i + vec3f(1.0, 1.0, 0.0));
    let n001 = hash13(i + vec3f(0.0, 0.0, 1.0));
    let n101 = hash13(i + vec3f(1.0, 0.0, 1.0));
    let n011 = hash13(i + vec3f(0.0, 1.0, 1.0));
    let n111 = hash13(i + vec3f(1.0, 1.0, 1.0));

    let nx00 = mix(n000, n100, u.x);
    let nx10 = mix(n010, n110, u.x);
    let nx01 = mix(n001, n101, u.x);
    let nx11 = mix(n011, n111, u.x);
    let nxy0 = mix(nx00, nx10, u.y);
    let nxy1 = mix(nx01, nx11, u.y);
    return mix(nxy0, nxy1, u.z);
}

// 3-octave FBM — used for volumetric march (was 4 octaves)
fn fbm(p: vec3f) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;
    for (var octave = 0; octave < 3; octave = octave + 1) {
        value = value + noise3(p * frequency) * amplitude;
        frequency = frequency * 2.03;
        amplitude = amplitude * 0.5;
    }
    return value;
}

// 2-octave FBM — cheap, for nebula + detail
fn fbm2(p: vec3f) -> f32 {
    return noise3(p) * 0.5 + noise3(p * 2.03) * 0.25;
}

fn sample_flow(uv: vec2f) -> vec4f {
    let dims = vec2f(flow_dims());
    let scaled = clamp(uv, vec2f(0.0), vec2f(0.9999)) * dims;
    let coord = vec2u(scaled);
    return flow[flow_index(coord)];
}

// ============================================================
// STAR FIELD — single-cell lookup, no neighbor loop
// Each cell has at most one star; stars are small enough to
// never bleed across boundaries. 3 layers for depth.
// Cost: 3 layers × (2 hash + 1 sin + 1 exp) — no loops.
// ============================================================
fn star_layer(uv: vec2f, scale: f32, time: f32, brightness: f32) -> f32 {
    let grid = floor(uv * scale);
    let local = fract(uv * scale);
    let rnd = hash22(grid);

    // ~35% of cells have a star
    if (rnd.x > 0.35) { return 0.0; }

    let star_center = rnd;
    let dist = length(local - star_center);

    // Twinkling
    let twinkle = 0.55 + 0.45 * sin(rnd.y * 6.28318 + time * (0.4 + rnd.x * 1.2));

    // Two-layer point: a small hard center over a softer cinematic halo.
    let halo_size = 0.007 + rnd.x * 0.013;
    let core_size = max(halo_size * 0.32, 0.002);
    let halo = exp(-dist * dist / (halo_size * halo_size)) * 0.72;
    let core = exp(-dist * dist / (core_size * core_size)) * 1.65;
    return (halo + core) * brightness * twinkle;
}

fn star_field(uv: vec2f, aspect: f32, time: f32) -> vec3f {
    let star_uv = vec2f(uv.x * aspect, uv.y);

    // 3 layers — each returns scalar intensity, colored per-layer
    let s1 = star_layer(star_uv, 80.0, time, 0.12);
    let s2 = star_layer(star_uv + vec2f(17.3, 31.7), 40.0, time, 0.28);
    let s3 = star_layer(star_uv + vec2f(53.1, 97.4), 18.0, time, 0.55);

    // Color: dim=white, medium=warm, bright=blue-white
    return vec3f(0.9, 0.92, 1.0) * s1
         + vec3f(1.0, 0.88, 0.6) * s2
         + vec3f(0.75, 0.85, 1.0) * s3;
}

// ============================================================
// DEEP-SPACE NEBULA — simplified: 1 warp + 2 density reads
// Cost: 3 × fbm2 = 6 noise3 calls (was 5 × fbm3 = 15 noise3)
// ============================================================
fn nebula_clouds(uv: vec2f, aspect: f32, time: f32) -> vec3f {
    let nebula_uv = vec2f(uv.x * aspect, uv.y);
    let slow_time = time * 0.008;

    // Single domain warp
    let warp = fbm2(vec3f(nebula_uv * 1.4, slow_time));
    let warped_pos = vec3f(nebula_uv + vec2f(warp * 0.15), slow_time * 0.7);

    let n1 = fbm2(warped_pos * 2.0);
    let n2 = fbm2(warped_pos * 3.5 + vec3f(7.7, 3.1, 0.0));
    let nebula_density = max(0.0, n1 * 0.65 + n2 * 0.35 - 0.38);

    // Color palette driven by noise ratio
    let color_t = clamp(n2 / max(n1, 0.01) - 0.3, 0.0, 1.0);
    let crimson = vec3f(0.12, 0.015, 0.008);
    let purple = vec3f(0.04, 0.012, 0.06);
    let indigo = vec3f(0.008, 0.012, 0.04);
    let nebula_color = mix(mix(crimson, purple, color_t), indigo, color_t * color_t);

    return nebula_color * nebula_density * 1.8;
}

// ============================================================
// SOLAR PROMINENCES — 3 arcs, uses hash instead of noise3
// Cost: 3 × (trig + hash) — no noise3 calls (was 3 × noise3)
// ============================================================
fn prominences(centered: vec2f, radial_distance: f32, time: f32, event_energy: f32, flare: f32) -> vec3f {
    // Early out if too far from core — prominences are near-field only
    if (radial_distance > 0.35) { return vec3f(0.0); }

    let angle = atan2(centered.y, centered.x);
    var prom_color = vec3f(0.0);

    for (var a = 0; a < 3; a = a + 1) {
        let base_angle = f32(a) * 2.094 + time * 0.06;
        let angle_offset = angle - base_angle;
        let wrapped = angle_offset - round(angle_offset / 6.28318) * 6.28318;

        let angular_width = 0.25 + 0.15 * sin(time * 0.18 + f32(a) * 1.5);
        let angular_falloff = exp(-wrapped * wrapped / (angular_width * angular_width));

        // Skip this arc early if angular contribution is negligible
        if (angular_falloff < 0.01) { continue; }

        let peak_radius = 0.12 + 0.06 * sin(time * 0.13 + f32(a) * 2.7) + flare * 0.04;
        let radial_profile = exp(-pow((radial_distance - peak_radius) / 0.06, 2.0)) * 0.6;
        let inner_tendril = exp(-radial_distance * 18.0) * 0.3;

        // Cheap turbulence via hash instead of noise3
        let turbulence = 0.7 + 0.3 * hash12(centered * 8.0 + vec2f(time * 0.2, f32(a) * 3.1));

        let arc_intensity = angular_falloff * (radial_profile + inner_tendril) * turbulence;
        let arc_boost = 1.0 + event_energy * 0.8 + flare * 1.5;

        let heat = clamp(1.0 - radial_distance * 4.0, 0.0, 1.0);
        let arc_color = mix(vec3f(1.2, 0.12, 0.03), vec3f(4.0, 1.5, 0.3), heat);

        prom_color = prom_color + arc_color * arc_intensity * arc_boost * 0.35;
    }

    return prom_color;
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
    let aspect = max(params.sim.z, 0.001);
    let ember_pos = params.ember.xy;
    let centered = (uv - ember_pos) * vec2f(aspect, 1.0);
    let flow_sample = sample_flow(uv);
    let radial_distance = length(centered);

    // Unpack gameplay FX
    let shockwave = params.fx.x;
    let flare = params.fx.y;
    let flash = params.fx.z;
    let intensity = params.fx.w;
    let time = params.sim.x;

    // ==========================================================
    // BACKGROUND: Star field + nebula (fills the black void)
    // Only computed where ember glow doesn't dominate
    // ==========================================================
    let ember_occlusion = smoothstep(0.08, 0.45, radial_distance);
    var bg = vec3f(0.0);
    if (ember_occlusion > 0.01) {
        bg = (star_field(uv, aspect, time) + nebula_clouds(uv, aspect, time)) * ember_occlusion;
    }

    let framing = pow(smoothstep(1.34, 0.03, radial_distance), 2.4);
    let fog_envelope = smoothstep(1.08, 0.06, radial_distance);
    let flicker = 0.6 + 0.4 * sin(time * 1.45 + flow_sample.w * 4.0);

    // ==========================================================
    // VOLUMETRIC EMBER — ray march with 3-octave FBM
    // Halved: use fbm (3 oct) for coarse, single noise3 for fine
    // Cost: steps × (3+1) = steps × 4 noise3 (was steps × 8)
    // ==========================================================
    var color = vec3f(0.0);
    var transmittance = 1.0;
    let step_count = max(1.0, params.quality.z);

    for (var i = 0u; i < 40u; i = i + 1u) {
        if (f32(i) >= step_count) {
            break;
        }

        let t = (f32(i) + 0.5) / step_count;
        let warp = flow_sample.xy * (0.9 + t * 3.1);
        let sample_pos = vec3f(
            centered * mix(1.65, 0.34, t) + warp * 1.45,
            t * 2.65 + time * 0.032,
        );
        let coarse = fbm(sample_pos * 3.0 + vec3f(0.0, 0.0, time * 0.03));
        // Single noise3 for fine detail (was full 4-octave FBM)
        let fine = noise3(sample_pos * 7.8 + vec3f(4.2, 9.7, time * 0.08));
        let veil = max(0.0, coarse * 0.75 + fine * 0.25 - 0.44);

        let shell = exp(-radial_distance * mix(22.0, 6.5, t));
        let core_band = exp(-radial_distance * mix(90.0, 14.0, t));
        let filament_angle = atan2(centered.y, centered.x);

        let filament_strength = params.reaction.x + flare * 1.5 + intensity * 0.4;
        let filament = pow(
            max(
                0.0,
                0.5 + 0.5 * sin(filament_angle * 14.0 - time * 1.8 + fine * 3.4),
            ),
            max(6.0, 22.0 - flare * 8.0),
        ) * filament_strength * exp(-radial_distance * (11.0 - flare * 2.0));

        let density = (veil * 0.12 + shell * 0.2 + core_band * 0.12 + filament * 0.85) * fog_envelope;

        let ember_mix = clamp(core_band * 2.7 + filament * 0.55 + flow_sample.w * 0.08 + flare * 0.3, 0.0, 1.0);
        let base_core = mix(params.colorB.rgb, params.colorA.rgb, ember_mix);
        let flare_white = vec3f(8.0, 6.5, 4.0);
        let intensity_warm = vec3f(1.0, 0.85, 0.6);
        var ember_color = mix(base_core, flare_white, clamp(flare * 0.25, 0.0, 0.7));
        ember_color = ember_color * mix(vec3f(1.0), intensity_warm, clamp(intensity * 0.15, 0.0, 0.5));

        color = color + ember_color * density * transmittance * mix(1.0, 1.7, flicker * shell);
        transmittance = transmittance * exp(-density * 1.8);
        if (transmittance < 0.025) {
            break;
        }
    }

    // ==========================================================
    // SOLAR PROMINENCES
    // ==========================================================
    color = color + prominences(centered, radial_distance, time, params.reaction.x, flare);

    // ==========================================================
    // EMBER CORE + FX
    // ==========================================================
    let core_boost = 1.0 + flare * 2.5 + flash * 4.0;
    let ember_core = exp(-radial_distance * (140.0 + params.ember.w * 32.0)) * (3.2 + params.ember.z * 5.0) * core_boost;
    let ember_inner = exp(-radial_distance * (340.0 + params.ember.w * 80.0)) * (10.5 + params.reaction.x * 1.8 + flare * 6.0);
    let ember_ring = exp(-abs(radial_distance - 0.028) * 145.0) * params.reaction.x * 0.65;

    let flash_color = mix(params.colorA.rgb, vec3f(12.0, 10.0, 7.0), clamp(flash * 0.6, 0.0, 0.8));
    let ember_color_final = flash_color * ember_core + vec3f(7.0, 2.05, 0.4) * ember_inner + vec3f(0.95, 0.08, 0.1) * ember_ring;

    // === SHOCKWAVE RING ===
    let shock_radius = shockwave * 0.45;
    let shock_width = 0.015 + shockwave * 0.025;
    let shock_ring = exp(-pow((radial_distance - shock_radius) / shock_width, 2.0));
    let shock_brightness = shockwave * (1.0 - shockwave) * 4.0;
    let shock_color = mix(vec3f(4.5, 1.2, 0.3), vec3f(8.0, 5.0, 2.5), shockwave) * shock_ring * shock_brightness;

    // === FLARE CORONA ===
    let flare_corona = exp(-radial_distance * max(3.0, 8.0 - flare * 3.0)) * flare * 0.8;
    let corona_color = vec3f(3.5, 0.8, 0.15) * flare_corona;

    // Cheap distant smoke: single noise3 (was full 4-octave FBM)
    let distant_smoke = noise3(vec3f(centered * 10.0, time * 0.012)) * 0.003 * framing;

    // Composite
    color = (color + ember_color_final + shock_color + corona_color + distant_smoke) * framing;
    color = color + bg * clamp(transmittance, 0.0, 1.0);
    color = color * mix(1.0, 0.08, clamp(params.ember.w, 0.0, 1.0));

    // Hard drop flash overlay
    let flash_overlay = flash * exp(-radial_distance * 2.5) * 0.15;
    color = color + vec3f(1.0, 0.9, 0.7) * flash_overlay;

    let blackout = mix(0.00012, 0.0, fog_envelope);
    color = max(color - vec3f(blackout), vec3f(0.0));

    return vec4f(color, 1.0);
}
