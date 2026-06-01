// ============================================================================
// Void Ember — scene pass
//
// Phase 1: the hero is now a TRUE volumetric star, not a radial glow.
//   - sphere-reconstructed surface with rotated-FBM + domain-warped granulation
//     (boiling convection cells), drifting sunspots, limb darkening
//   - a hot chromosphere rim + a Beer-falloff corona with animated filaments
//   - all incandescent matter coloured by the shared black-body ramp, driven by
//     the StellarConductor's `temperature` channel
//
// The background is rebuilt in wgsl/environment.wgsl (Phase 2). This module is
// concatenated AFTER void-ember-common.wgsl (ve_* helpers) and environment.wgsl
// (ve_environment), so both are in scope.
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
    star0: vec4f, // temperature, agitation, coronaEnergy, breath
    star1: vec4f, // novaFlash, cmePulse, cameraPush, reserved
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

fn sample_flow(uv: vec2f) -> vec4f {
    let dims = vec2f(flow_dims());
    let scaled = clamp(uv, vec2f(0.0), vec2f(0.9999)) * dims;
    let coord = vec2u(scaled);
    return flow[flow_index(coord)];
}

// ============================================================
// SOLAR PROMINENCES — temperature-coloured looped filaments that
// whip with the conductor's corona energy.
// ============================================================
fn prominences(
    centered: vec2f,
    radial_distance: f32,
    star_radius: f32,
    time: f32,
    temperature: f32,
    corona_energy: f32,
) -> vec3f {
    if (radial_distance > star_radius * 3.0) { return vec3f(0.0); }

    let angle = atan2(centered.y, centered.x);
    var prom_color = vec3f(0.0);

    for (var a = 0; a < 3; a = a + 1) {
        let base_angle = f32(a) * 2.094 + time * (0.06 + corona_energy * 0.12);
        let angle_offset = angle - base_angle;
        let wrapped = angle_offset - round(angle_offset / 6.28318) * 6.28318;

        let angular_width = 0.22 + 0.16 * sin(time * 0.18 + f32(a) * 1.5) + corona_energy * 0.1;
        let angular_falloff = exp(-wrapped * wrapped / (angular_width * angular_width));
        if (angular_falloff < 0.01) { continue; }

        let peak_radius = star_radius * (1.05 + 0.5 * sin(time * 0.13 + f32(a) * 2.7)) + corona_energy * 0.05;
        let rp_d = (radial_distance - peak_radius) / (star_radius * 0.45);
        let radial_profile = exp(-rp_d * rp_d) * 0.6;
        let inner_tendril = exp(-radial_distance * 16.0) * 0.3;

        let turbulence = 0.7 + 0.3 * ve_noise3(vec3f(centered * 9.0, time * 0.3 + f32(a) * 3.1));
        let arc_intensity = angular_falloff * (radial_profile + inner_tendril) * turbulence;
        let arc_boost = 1.0 + corona_energy * 2.2;

        let heat = clamp(1.0 - radial_distance / max(star_radius * 3.0, 0.001), 0.0, 1.0);
        let arc_color = ve_blackbody(clamp(temperature - 0.05 + heat * 0.35, 0.0, 1.0)) * (1.0 + heat * 1.4);

        prom_color = prom_color + arc_color * arc_intensity * arc_boost * 0.4;
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
    let time = params.sim.x;

    // Legacy fast transients (also drive flow/particles/post)
    let shockwave = params.fx.x;
    let flare = params.fx.y;
    let flash = params.fx.z;

    // StellarConductor life-state
    let temperature = params.star0.x;
    let agitation = params.star0.y;
    let corona_energy = params.star0.z;
    let breath = params.star0.w;
    let nova = params.star1.x;

    // ==========================================================
    // BACKGROUND — deep-space environment (environment.wgsl)
    // ==========================================================
    let ember_occlusion = smoothstep(0.05, 0.42, radial_distance);
    var bg = vec3f(0.0);
    if (ember_occlusion > 0.01) {
        bg = ve_environment(uv, aspect, time, temperature) * ember_occlusion;
    }

    let framing = pow(smoothstep(1.34, 0.03, radial_distance), 2.4);
    let flicker = 0.75 + 0.25 * sin(time * 1.45 + flow_sample.w * 4.0);

    // ==========================================================
    // ★ HERO STAR — sphere surface + corona
    // ==========================================================
    let base_radius = 0.135;
    let star_radius = base_radius * (1.0 + breath * 0.05 + params.ember.z * 0.03 + nova * 0.06);
    let nd = radial_distance / max(star_radius, 0.0001);

    // Surface boil speed scales with agitation.
    let boil = time * (0.05 + agitation * 0.28);

    var surf_color = vec3f(0.0);
    var surf_alpha = 0.0;
    if (nd < 1.06) {
        // Reconstruct a sphere: z is the surface height of a unit sphere; the
        // view is ~+z so n·v ≈ z (drives limb darkening + sunspot foreshortening).
        let z = sqrt(max(0.0, 1.0 - nd * nd));
        let sp = vec3f(centered / star_radius, z);
        // Slow rotation so granules drift across the limb like a real star.
        let rot = ve_rot_y(time * 0.03) * ve_rot_z(time * 0.017);
        let psurf = rot * sp;

        // Granulation: domain-warped FBM convection cells + fine mottling.
        let warped = ve_domain_warp(psurf * 3.2 + vec3f(0.0, 0.0, boil), 0.5, 3);
        let gran = ve_fbm(warped * 2.4, 5);
        let fine = ve_noise3(warped * 9.0 + vec3f(0.0, 0.0, boil * 2.0));
        let granule = clamp(gran * 0.7 + fine * 0.3, 0.0, 1.0);

        // Sunspots: low-frequency cool patches that drift with the surface.
        let spot_n = ve_fbm(psurf * 1.5 + vec3f(11.0, 3.0, boil * 0.4), 3);
        let sunspot = smoothstep(0.58, 0.46, spot_n);

        // Local temperature: base + granule variation - sunspot cooling.
        let local_temp = clamp(temperature + (granule - 0.5) * 0.34 - sunspot * 0.42, 0.0, 1.0);

        // Limb darkening — centre brightest, edge dimmer.
        let limb = 0.4 + 0.6 * pow(clamp(z, 0.0, 1.0), 0.5);

        // Luminance scale compresses as the star heats so the inferno stays a
        // readable blue-white body instead of a screen-filling white blob.
        surf_color = ve_blackbody(local_temp) * (0.9 + granule * 1.0) * limb * mix(1.35, 0.95, temperature);
        // Smooth the limb so the disc antialiases into the corona.
        surf_alpha = smoothstep(1.04, 0.96, nd);
        surf_color = surf_color * surf_alpha;
    }

    // Corona: hot chromosphere rim + Beer-falloff filaments reaching outward.
    var corona = vec3f(0.0);
    if (radial_distance < star_radius * 3.8 && nd > 0.8) {
        let cd = radial_distance - star_radius; // distance beyond the limb
        let angle = atan2(centered.y, centered.x);
        let fc = vec3f(cos(angle), sin(angle), 0.0) * (1.5 + max(cd, 0.0) * 5.0)
            + vec3f(0.0, 0.0, boil + time * 0.05);
        let fil = ve_fbm(ve_domain_warp(fc * 1.4, 0.7, 3), 4);
        let streak = pow(
            max(0.0, 0.5 + 0.5 * sin(angle * 10.0 + fil * 7.0 - time * (0.5 + agitation * 1.6))),
            3.0,
        );
        let falloff = ve_beer(max(cd, 0.0) * mix(12.0, 4.5, corona_energy));
        let dens = falloff * (0.35 + streak * 0.95 + fil * 0.35) * (0.35 + corona_energy * 1.5);
        let ctemp = clamp(temperature - 0.06 - max(cd, 0.0) * 0.6, 0.0, 1.0);
        corona = ve_blackbody(ctemp) * dens * flicker;

        // Hot chromosphere ring right at the limb.
        let chromo_d = (nd - 1.0) / 0.05;
        let chromo = exp(-chromo_d * chromo_d) * (0.7 + corona_energy * 0.7);
        corona = corona + ve_blackbody(min(1.0, temperature + 0.2)) * chromo;
    }

    // Prominences (looped filaments).
    let prom = prominences(centered, radial_distance, star_radius, time, temperature, corona_energy);

    // Flare / nova / flash punch a white-hot inner core (for bloom). Kept tight
    // (steep falloff) so big events stay a bright CORE rather than a whiteout.
    let flare_core = exp(-radial_distance * 165.0) * (nova * 4.5 + flash * 2.2 + flare * 1.1);
    let core_glow = ve_blackbody(min(1.0, temperature + 0.4)) * flare_core;

    // Shockwave ring (shared with flow/particles).
    let shock_radius = shockwave * 0.45;
    let shock_width = 0.015 + shockwave * 0.025;
    let shock_d = (radial_distance - shock_radius) / shock_width;
    let shock_ring = exp(-shock_d * shock_d);
    let shock_brightness = shockwave * (1.0 - shockwave) * 4.0;
    let shock_color = ve_blackbody(clamp(temperature + 0.2, 0.0, 1.0)) * shock_ring * shock_brightness * 1.6;

    // ==========================================================
    // COMPOSITE — opaque surface over background; emission additive.
    // ==========================================================
    var color = (surf_color + corona + prom + core_glow + shock_color) * framing;
    color = color + bg * clamp(1.0 - surf_alpha, 0.0, 1.0);
    color = color * mix(1.0, 0.1, clamp(params.ember.w, 0.0, 1.0)); // collapse dim

    let flash_overlay = flash * exp(-radial_distance * 2.5) * 0.15;
    color = color + vec3f(1.0, 0.9, 0.7) * flash_overlay;

    return vec4f(max(color, vec3f(0.0)), 1.0);
}
