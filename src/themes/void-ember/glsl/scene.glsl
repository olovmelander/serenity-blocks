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
// The background is rebuilt in glsl/environment.glsl (Phase 2). This module is
// concatenated AFTER void-ember-common.glsl (ve_* helpers) and environment.glsl
// (ve_environment), so both are in scope.
// ============================================================================

vec3 prominences(vec2 centered,
    float radial_distance,
    float star_radius,
    float time,
    float temperature,
    float corona_energy) {
    if (radial_distance > star_radius * 3.0) { return vec3(0.0); }

    float angle = atan(centered.y, centered.x);
    vec3 prom_color = vec3(0.0);

    for (int a = 0; a < 3; a = a + 1) {
        float base_angle = float(a) * 2.094 + time * (0.06 + corona_energy * 0.12);
        float angle_offset = angle - base_angle;
        float wrapped = angle_offset - round(angle_offset / 6.28318) * 6.28318;

        float angular_width = 0.22 + 0.16 * sin(time * 0.18 + float(a) * 1.5) + corona_energy * 0.1;
        float angular_falloff = exp(-wrapped * wrapped / (angular_width * angular_width));
        if (angular_falloff < 0.01) { continue; }

        float peak_radius = star_radius * (1.05 + 0.5 * sin(time * 0.13 + float(a) * 2.7)) + corona_energy * 0.05;
        float rp_d = (radial_distance - peak_radius) / (star_radius * 0.45);
        float radial_profile = exp(-rp_d * rp_d) * 0.6;
        float inner_tendril = exp(-radial_distance * 16.0) * 0.3;

        float turbulence = 0.7 + 0.3 * ve_noise3(vec3(centered * 9.0, time * 0.3 + float(a) * 3.1));
        float arc_intensity = angular_falloff * (radial_profile + inner_tendril) * turbulence;
        float arc_boost = 1.0 + corona_energy * 2.2;

        float heat = clamp(1.0 - radial_distance / max(star_radius * 3.0, 0.001), 0.0, 1.0);
        vec3 arc_color = ve_blackbody(clamp(temperature - 0.05 + heat * 0.35, 0.0, 1.0)) * (1.0 + heat * 1.4);

        prom_color = prom_color + arc_color * arc_intensity * arc_boost * 0.4;
    }

    return prom_color;
}

vec4 ve_scene(vec2 uv) {
    float aspect = max(params.sim.z, 0.001);
    vec2 ember_pos = params.ember.xy;
    vec2 centered = (uv - ember_pos) * vec2(aspect, 1.0);
    float flow_phase = ve_noise3(vec3(uv * 7.0, params.sim.x * 0.13));
    float radial_distance = length(centered);
    float time = params.sim.x;

    // Legacy fast transients (also drive flow/particles/post)
    float shockwave = params.fx.x;
    float flare = params.fx.y;
    float flash = params.fx.z;

    // StellarConductor life-state
    float temperature = params.star0.x;
    float agitation = params.star0.y;
    float corona_energy = params.star0.z;
    float breath = params.star0.w;
    float nova = params.star1.x;

    // ==========================================================
    // BACKGROUND — deep-space environment (environment.glsl)
    // ==========================================================
    float ember_occlusion = smoothstep(0.05, 0.42, radial_distance);
    vec3 bg = vec3(0.0);
    if (ember_occlusion > 0.01) {
        bg = ve_environment(uv, aspect, time, temperature) * ember_occlusion;
    }

    float framing = pow((1.0 - smoothstep(0.03, 1.34, radial_distance)), 2.4);
    float flicker = 0.75 + 0.25 * sin(time * 1.45 + flow_phase * 4.0);

    // ==========================================================
    // ★ HERO STAR — sphere surface + corona
    // ==========================================================
    float base_radius = 0.135;
    float star_radius = base_radius * (1.0 + breath * 0.05 + params.ember.z * 0.03 + nova * 0.06);
    float nd = radial_distance / max(star_radius, 0.0001);

    // Surface boil speed scales with agitation.
    float boil = time * (0.05 + agitation * 0.28);

    vec3 surf_color = vec3(0.0);
    float surf_alpha = 0.0;
    if (nd < 1.06) {
        // Reconstruct a sphere: z is the surface height of a unit sphere; the
        // view is ~+z so n·v ≈ z (drives limb darkening + sunspot foreshortening).
        float z = sqrt(max(0.0, 1.0 - nd * nd));
        vec3 sp = vec3(centered / star_radius, z);
        // Slow rotation so granules drift across the limb like a real star.
        mat3 rot = ve_rot_y(time * 0.03) * ve_rot_z(time * 0.017);
        vec3 psurf = rot * sp;

        // Granulation: domain-warped FBM convection cells + fine mottling.
        vec3 warped = ve_domain_warp(psurf * 3.2 + vec3(0.0, 0.0, boil), 0.5, 3);
        float gran = ve_fbm(warped * 2.4, 5);
        float fine = ve_noise3(warped * 9.0 + vec3(0.0, 0.0, boil * 2.0));
        float granule = clamp(gran * 0.7 + fine * 0.3, 0.0, 1.0);

        // Sunspots: low-frequency cool patches that drift with the surface.
        float spot_n = ve_fbm(psurf * 1.5 + vec3(11.0, 3.0, boil * 0.4), 3);
        float sunspot = (1.0 - smoothstep(0.46, 0.58, spot_n));

        // Local temperature: base + granule variation - sunspot cooling.
        float local_temp = clamp(temperature + (granule - 0.5) * 0.34 - sunspot * 0.42, 0.0, 1.0);

        // Limb darkening — centre brightest, edge dimmer.
        float limb = 0.4 + 0.6 * pow(clamp(z, 0.0, 1.0), 0.5);

        // Luminance scale compresses as the star heats so the inferno stays a
        // readable blue-white body instead of a screen-filling white blob.
        surf_color = ve_blackbody(local_temp) * (0.9 + granule * 1.0) * limb * mix(1.35, 0.95, temperature);
        // Smooth the limb so the disc antialiases into the corona.
        surf_alpha = (1.0 - smoothstep(0.96, 1.04, nd));
        surf_color = surf_color * surf_alpha;
    }

    // Corona: hot chromosphere rim + Beer-falloff filaments reaching outward.
    vec3 corona = vec3(0.0);
    if (radial_distance < star_radius * 3.8 && nd > 0.8) {
        float cd = radial_distance - star_radius; // distance beyond the limb
        float angle = atan(centered.y, centered.x);
        vec3 fc = vec3(cos(angle), sin(angle), 0.0) * (1.5 + max(cd, 0.0) * 5.0)
            + vec3(0.0, 0.0, boil + time * 0.05);
        float fil = ve_fbm(ve_domain_warp(fc * 1.4, 0.7, 3), 4);
        float streak = pow(
            max(0.0, 0.5 + 0.5 * sin(angle * 10.0 + fil * 7.0 - time * (0.5 + agitation * 1.6))),
            3.0);
        float falloff = ve_beer(max(cd, 0.0) * mix(12.0, 4.5, corona_energy));
        float dens = falloff * (0.35 + streak * 0.95 + fil * 0.35) * (0.35 + corona_energy * 1.5);
        float ctemp = clamp(temperature - 0.06 - max(cd, 0.0) * 0.6, 0.0, 1.0);
        corona = ve_blackbody(ctemp) * dens * flicker;

        // Hot chromosphere ring right at the limb.
        float chromo_d = (nd - 1.0) / 0.05;
        float chromo = exp(-chromo_d * chromo_d) * (0.7 + corona_energy * 0.7);
        corona = corona + ve_blackbody(min(1.0, temperature + 0.2)) * chromo;
    }

    // Prominences (looped filaments).
    vec3 prom = prominences(centered, radial_distance, star_radius, time, temperature, corona_energy);

    // Flare / nova / flash punch a white-hot inner core (for bloom). Kept tight
    // (steep falloff) so big events stay a bright CORE rather than a whiteout.
    float flare_core = exp(-radial_distance * 165.0) * (nova * 4.5 + flash * 2.2 + flare * 1.1);
    vec3 core_glow = ve_blackbody(min(1.0, temperature + 0.4)) * flare_core;

    // Shockwave ring (shared with flow/particles).
    float shock_radius = shockwave * 0.45;
    float shock_width = 0.015 + shockwave * 0.025;
    float shock_d = (radial_distance - shock_radius) / shock_width;
    float shock_ring = exp(-shock_d * shock_d);
    float shock_brightness = shockwave * (1.0 - shockwave) * 4.0;
    vec3 shock_color = ve_blackbody(clamp(temperature + 0.2, 0.0, 1.0)) * shock_ring * shock_brightness * 1.6;

    // ==========================================================
    // COMPOSITE — opaque surface over background; emission additive.
    // ==========================================================
    vec3 color = (surf_color + corona + prom + core_glow + shock_color) * framing;
    color = color + bg * clamp(1.0 - surf_alpha, 0.0, 1.0);
    color = color * mix(1.0, 0.1, clamp(params.ember.w, 0.0, 1.0)); // collapse dim

    float flash_overlay = flash * exp(-radial_distance * 2.5) * 0.15;
    color = color + vec3(1.0, 0.9, 0.7) * flash_overlay;

    return vec4(max(color, vec3(0.0)), 1.0);
}
