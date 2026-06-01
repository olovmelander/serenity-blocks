// ============================================================================
// Void Ember — cinematic lens flare (Phase 4)
//
// Pure helper module concatenated between void-ember-common.wgsl and post.wgsl.
// Reads the bright/bloom base texture (passed as an argument) to synthesise the
// "shot through a real cine lens" optics:
//   - ghosts: inverted-image samples along the optical axis (through screen
//     centre) with chromatic dispersal — the row of coloured discs you get when
//     a bright source is off-centre
//   - halo: a soft chromatic ring
//   - starburst: analytic diffraction spikes radiating from the star
//
// Functions take texture+sampler as parameters (valid WGSL), so they stay
// decoupled from post.wgsl's own bindings.
// ============================================================================

fn ve_flare_tap(tex: texture_2d<f32>, samp: sampler, uv: vec2f) -> vec3f {
    return textureSampleLevel(tex, samp, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).rgb;
}

// Chapman-style ghosts: sample the inverted bright image stepping toward centre,
// with a per-channel radial offset for chromatic dispersal.
fn ve_lens_ghosts(tex: texture_2d<f32>, samp: sampler, uv: vec2f, dispersal: f32, distortion: f32) -> vec3f {
    let flip = vec2f(1.0) - uv;
    let ghost_vec = (vec2f(0.5) - flip) * dispersal;
    var result = vec3f(0.0);
    for (var i = 0; i < 5; i = i + 1) {
        let offset = flip + ghost_vec * f32(i);
        let d = length(vec2f(0.5) - offset);
        let weight = pow(max(0.0, 1.0 - d * 1.6), 3.0);
        if (weight < 0.001) {
            continue;
        }
        let dir = normalize(vec2f(0.5) - offset + vec2f(1e-5));
        let ca = dir * distortion;
        let r = ve_flare_tap(tex, samp, offset + ca).r;
        let g = ve_flare_tap(tex, samp, offset).g;
        let b = ve_flare_tap(tex, samp, offset - ca).b;
        result = result + vec3f(r, g, b) * weight;
    }
    return result;
}

// Soft chromatic halo ring.
fn ve_lens_halo(tex: texture_2d<f32>, samp: sampler, uv: vec2f, width: f32) -> vec3f {
    let flip = vec2f(1.0) - uv;
    let dir = normalize(vec2f(0.5) - flip + vec2f(1e-5));
    let halo_uv = flip + dir * width;
    let d = length(vec2f(0.5) - halo_uv);
    let weight = pow(max(0.0, 1.0 - d / max(width, 0.001)), 5.0);
    return ve_flare_tap(tex, samp, halo_uv) * weight;
}

// Analytic diffraction starburst radiating from the star (12 spikes, slow spin).
fn ve_starburst(uv: vec2f, star_uv: vec2f, aspect: f32, time: f32) -> f32 {
    let d = (uv - star_uv) * vec2f(aspect, 1.0);
    let dist = length(d);
    let angle = atan2(d.y, d.x);
    let s = pow(abs(sin(angle * 3.0 + time * 0.05)), 32.0)
        + pow(abs(cos(angle * 3.0 - time * 0.03)), 32.0) * 0.6;
    return s * exp(-dist * 5.0);
}
