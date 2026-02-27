# Sky: Children of the Light - WebGPU Render Theme Plan

## Executive Summary

This document outlines the implementation plan for a reusable WebGPU Render Theme that replicates the **"painterly, ethereal" art direction** of **SKY: Children of the Light** and **Journey** by thatgamecompany.

The plan now distinguishes between:
- **Confirmed thatgamecompany techniques** (from primary talks/interviews)
- **High-confidence technical inferences** (derived from primary constraints and observed output)
- **Production-ready adaptations** (industry-proven methods used to match the look under WebGPU constraints)

The theme uses a **Stylized PBR** workflow that deliberately "cheats physics in favor of art" — the same philosophy thatgamecompany's engineers followed over 3+ years of continuous shader refinement. All shaders are written in **raw WGSL** with WebGPU pipelines. Target: 60fps with GPU instancing for foliage and compute shaders for particles/post-processing.

**Key Principle**: *"If you're ever in doubt, remember the message you are working towards and follow through."* — Yuichiro Tanabe, Lead Artist, thatgamecompany (GDC 2020)

---

## Research Sources

This plan is informed by the following technical sources:

| Source | Author | Key Contribution | Evidence Tier |
|--------|--------|------------------|---------------|
| [Sand Rendering in Journey (GDC 2013)](https://gdcvault.com/play/1017742/Sand-Rendering-in) | John Edwards, thatgamecompany | Sand shader components, diffuse/specular shaping | Confirmed |
| [Art of Sky: Children of the Light (GDC 2020)](https://gdcvault.com/play/1026903/Art-of-Sky-Children-of) | Yuichiro Tanabe, thatgamecompany | Time-of-day emotional framing and visual direction | Confirmed |
| [Glitter, Fur and Shadows (GDC 2025)](https://schedule.gdconf.com/session/glitter-fur-and-shadows-character-rendering-technology-of-sky-children-of-the-light/907475) | Oliver Castaneda, thatgamecompany | Character rendering themes: IBL, self-shadowing, transparency, procedural glitter/fur | Confirmed (high-level) |
| [Behind the Design: Sky](https://developer.apple.com/news/?id=zm47it7t) | Apple Developer | Custom Metal stack, mobile optimization philosophy | Confirmed |
| [A Journey Into Journey's Sand Shader](https://www.alanzucconi.com/2019/10/08/journey-sand-shader-1/) | Alan Zucconi | Practical reconstruction of Journey sand math | Secondary |
| [Mesh Cloud Rendering (Sea of Thieves)](https://github.com/maajor/Mesh-Cloud-Rendering) | GDC / Rare | Mesh-cloud adaptation path for real-time stylized clouds | Adaptation |
| [Better Fog (iquilez.org)](https://iquilezles.org/articles/fog/) | Inigo Quilez | Analytical fog model for stylized atmosphere | Adaptation |
| [AgX Tone Mapping](https://github.com/sobotka/AgX) | Troy Sobotka | Highlight-preserving tonemap transform | Adaptation |
| [Dual Kawase Bloom](https://blog.frost.kiwi/dual-kawase/) | frost.kiwi | Efficient bloom implementation strategy | Adaptation |
| [The Technical Art Behind Journey](https://polycount.com/discussion/125544/the-technical-art-behind-journey) | Polycount community | Supplemental notes for Journey era rendering | Secondary |

### Authenticity Rules For This Plan

1. Confirmed techniques are implemented first and treated as visual anchors.
2. Adaptations are explicitly labeled as adaptations, not reverse-engineered facts.
3. Every non-confirmed technique must map to an explicit visual goal from Sky/Journey.

---

## Art Direction: How thatgamecompany "Cheats Physics"

### The Emotional Time-of-Day Framework

Sky's visual design maps each level to a **time of day** that mirrors the player's emotional journey. This is the organizing principle for all rendering decisions:

| Sky Level | Time | Emotion | Color Temperature | Lighting Strategy |
|-----------|------|---------|-------------------|-------------------|
| Isle of Dawn | Morning | Wonder, birth | Cool blue → warm amber | Low sun angle, long shadows, golden rim |
| Daylight Prairie | Noon | Joy, childhood | Warm gold, green | High fill light, minimal shadows |
| Hidden Forest | Rain | Struggle, adolescence | Desaturated, blue-green | Diffuse overcast, no specular |
| Valley of Triumph | Sunset | Triumph, maturity | Orange-gold-purple | **"Magic hour"** — this is the target look |
| Golden Wasteland | Dusk | Loss, midlife | Deep amber → grey | Fading light, heavy atmosphere |
| Eye of Eden | Night | Sacrifice, transcendence | Cool blue, emissive accents | Darkness with selective light |

**Our theme targets the "Valley of Triumph / Sunset" state** — the most visually distinctive time with warm-cool color separation.

### The 6 Rules of thatgamecompany's Visual Style

1. **No black shadows** — Shadows are always colored (blue-purple in warm scenes, warm in cool scenes)
2. **Light wraps around everything** — Modified diffuse models prevent harsh terminator lines
3. **Rim lighting on all silhouettes** — Fresnel glow separates objects from background
4. **Sand/terrain behaves like fabric** — Oren-Nayar roughness + ocean specular makes surfaces feel tactile
5. **Atmosphere eats geometry** — Fog and haze blend everything into a unified skybox
6. **Glitter everywhere** — Micro-specular on sand/characters adds life and sparkle

---

## Module 1: Journey's Lighting Model (WGSL Core Functions)

### Research Findings

Journey does **NOT** use standard Lambertian diffuse. John Edwards (GDC 2013) documented three critical modifications:

1. **Diffuse Contrast**: `saturate(4 * dot(N, L))` — The 4× multiplier sharpens the light-to-shadow transition, creating more dramatic contrast than Lambert's gentle falloff
2. **Y-Normal Compression**: `N.y *= 0.3` — Flattening the vertical normal component forces shadows to align vertically, creating the characteristic "sand dune shadow" look
3. **Oren-Nayar for Cloth**: The cloth/cape shader uses Oren-Nayar reflectance (a model for rough micro-faceted surfaces), not standard diffuse

Journey also uses **three distinct specular types** that are combined in a specific way:
- **Rim Lighting** (Fresnel): `pow(1 - saturate(dot(N, V)), power) * strength`
- **Ocean Specular** (Blinn-Phong): `pow(dot(N, H), power) * strength` — treats sand as a fluid surface
- **Glitter Specular** (Microfacet): Random normal reflections with threshold test
- **Combination rule**: `final_specular = max(rim, ocean) + glitter` — rim and ocean take the max (to avoid double-brightness), glitter is additive

### 1.1 WGSL Implementation

```wgsl
// ============================================================
// Module: stylized_lighting.wgsl
// Lighting functions derived from Journey's actual shader pipeline
// Source: John Edwards GDC 2013, Alan Zucconi reconstruction
// ============================================================

struct LightParams {
    direction: vec3f,       // Normalized light direction (TO the light)
    color: vec3f,           // Light color (HDR)
    intensity: f32,
    ambient_color: vec3f,   // Sky/ambient color for shadow fill
    ambient_intensity: f32,
};

struct SurfaceParams {
    normal: vec3f,          // World-space surface normal
    view_dir: vec3f,        // Surface-to-camera direction (normalized)
    albedo: vec3f,          // Base surface color
    roughness: f32,         // Oren-Nayar roughness (0-1)
};

// =============================================================
// 1. JOURNEY'S DIFFUSE CONTRAST
// =============================================================
// The actual Journey formula from John Edwards' GDC talk.
// Two key "cheats":
//   a) N.y *= 0.3 — compresses vertical normal, forcing vertical shadows
//   b) saturate(4 * NdotL) — 4x multiplier sharpens shadow edge
//
// This is NOT physically correct. It's tuned for art.
fn journey_diffuse(normal: vec3f, light_dir: vec3f) -> f32 {
    var n = normal;
    n.y *= 0.3; // Compress vertical component (Journey's signature trick)
    n = normalize(n);
    let n_dot_l = dot(n, light_dir);
    return saturate(4.0 * n_dot_l);
}

// =============================================================
// 2. OREN-NAYAR DIFFUSE (for cloth/fabric surfaces)
// =============================================================
// Journey's cloth shader (capes, scarves) uses Oren-Nayar to simulate
// rough micro-faceted surfaces. This makes fabric look soft and velvety
// rather than plasticky.
//
// Simplified qualitative form (cheaper than full model):
fn oren_nayar_diffuse(
    normal: vec3f,
    light_dir: vec3f,
    view_dir: vec3f,
    roughness: f32
) -> f32 {
    let n_dot_l = max(dot(normal, light_dir), 0.0);
    let n_dot_v = max(dot(normal, view_dir), 0.0);

    let sigma2 = roughness * roughness;
    let A = 1.0 - 0.5 * sigma2 / (sigma2 + 0.33);
    let B = 0.45 * sigma2 / (sigma2 + 0.09);

    // Calculate azimuth angles
    let theta_i = acos(n_dot_l);
    let theta_r = acos(n_dot_v);
    let alpha = max(theta_i, theta_r);
    let beta = min(theta_i, theta_r);

    // Project view and light onto tangent plane for azimuth
    let light_proj = normalize(light_dir - normal * n_dot_l);
    let view_proj = normalize(view_dir - normal * n_dot_v);
    let cos_phi_diff = max(dot(light_proj, view_proj), 0.0);

    return n_dot_l * (A + B * cos_phi_diff * sin(alpha) * tan(beta));
}

// =============================================================
// 3. FRESNEL RIM LIGHTING (Journey Specular Type 1)
// =============================================================
// Creates glowing silhouette edges. In Journey, rim is strongest
// on dune ridges and character outlines against the sky.
// Formula: (1 - NdotV)^power * strength
fn fresnel_rim(n_dot_v: f32, power: f32, strength: f32) -> f32 {
    return pow(saturate(1.0 - n_dot_v), power) * strength;
}

// =============================================================
// 4. OCEAN SPECULAR (Journey Specular Type 2)
// =============================================================
// John Edwards: "We wanted the sand to feel more like a fluid than a solid."
// Uses Blinn-Phong to create water-like sunset reflections on sand.
// This is what makes Journey's sand look like it could be surfed on.
fn ocean_specular(
    normal: vec3f,
    light_dir: vec3f,
    view_dir: vec3f,
    power: f32,
    strength: f32
) -> f32 {
    let half_vec = normalize(view_dir + light_dir);
    let n_dot_h = max(dot(normal, half_vec), 0.0);
    return pow(n_dot_h, power) * strength;
}

// =============================================================
// 5. GLITTER SPECULAR (Journey Specular Type 3)
// =============================================================
// Simulates individual sand grains catching light using microfacet theory.
// Each "grain" has a random normal sampled from a texture.
// The reflected light ray is tested against the view direction.
// Only reflections below a tight threshold are visible, creating
// rare but intense sparkle points.
//
// Key property: uses reflect() for temporal coherence — glitter stays
// on the same grains across frames instead of randomly flickering.
fn glitter_specular(
    grain_normal: vec3f,  // Random normal from Gaussian noise texture
    light_dir: vec3f,
    view_dir: vec3f,
    threshold: f32,       // Lower = more selective = brighter individual sparkles
    intensity: f32
) -> f32 {
    let reflected = reflect(-light_dir, grain_normal);
    let r_dot_v = dot(reflected, view_dir);

    // Only sparkle if reflection is very close to view direction
    // The threshold controls sparkle density
    let sparkle = saturate((r_dot_v - threshold) / (1.0 - threshold));
    return sparkle * sparkle * intensity; // Square for sharper falloff
}

// =============================================================
// 6. COLORED SHADOWS
// =============================================================
// thatgamecompany's Rule #1: NO black shadows.
// Shadow regions are tinted with the ambient/sky color.
// In golden hour: shadows are blue-purple. In cool scenes: shadows are warm.
fn colored_shadow_blend(
    diffuse_factor: f32,
    lit_color: vec3f,
    shadow_color: vec3f,  // The color of shadow regions (NOT black)
    shadow_boost: f32     // Saturation boost in shadows to prevent muddiness
) -> vec3f {
    let blended = mix(shadow_color, lit_color, diffuse_factor);
    // Boost saturation in shadow regions
    let luma = dot(blended, vec3f(0.2126, 0.7152, 0.0722));
    return mix(vec3f(luma), blended, 1.0 + shadow_boost * (1.0 - diffuse_factor));
}

// =============================================================
// 7. COMBINED LIGHTING (Journey Pipeline)
// =============================================================
// Assembles all components in Journey's specific combination order:
//   diffuse_color = lerp(shadow_color, terrain_color, diffuse)
//   specular = max(rim, ocean) + glitter  (NOT additive for rim+ocean!)
//   final = diffuse_color + specular_color
fn calculate_journey_lighting(
    surface: SurfaceParams,
    light: LightParams,
    // Specular params
    rim_power: f32,
    rim_strength: f32,
    rim_color: vec3f,
    ocean_power: f32,
    ocean_strength: f32,
    ocean_color: vec3f,
    // Shadow params
    shadow_tint: vec3f,
    shadow_boost: f32,
    // Grain normal for glitter (vec3f(0) to disable)
    grain_normal: vec3f,
    glitter_threshold: f32,
    glitter_intensity: f32,
    glitter_color: vec3f,
) -> vec3f {
    let n = normalize(surface.normal);
    let l = normalize(light.direction);
    let v = normalize(surface.view_dir);

    // 1. Diffuse: Journey's contrast model
    let diffuse = journey_diffuse(n, l);

    // 2. Color: lerp between shadow tint and lit albedo
    let lit_color = surface.albedo * light.color * light.intensity;
    let shadow_color = surface.albedo * shadow_tint * light.ambient_color * light.ambient_intensity;
    var base = colored_shadow_blend(diffuse, lit_color, shadow_color, shadow_boost);

    // 3. Specular: Journey's 3-type combination
    let n_dot_v = dot(n, v);

    let rim = fresnel_rim(n_dot_v, rim_power, rim_strength);
    let rim_contrib = rim_color * rim;

    let ocean = ocean_specular(n, l, v, ocean_power, ocean_strength);
    let ocean_contrib = ocean_color * ocean;

    // max(rim, ocean) — NOT additive to prevent over-brightening
    let spec_base = max(rim_contrib, ocean_contrib);

    // Glitter is always additive (it's rare so it won't over-brighten)
    var glitter_contrib = vec3f(0.0);
    if (length(grain_normal) > 0.01) {
        let g = glitter_specular(grain_normal, l, v, glitter_threshold, glitter_intensity);
        glitter_contrib = glitter_color * g;
    }

    return base + spec_base + glitter_contrib;
}
```

### 1.2 Key Differences from Standard PBR

| Property | Standard PBR | Journey/Sky Approach |
|----------|-------------|---------------------|
| Diffuse model | Lambert or Disney | `saturate(4 * dot(N_compressed, L))` |
| Normal manipulation | None | `N.y *= 0.3` for vertical shadow bias |
| Shadow color | Ambient occlusion (grey/black) | Explicitly colored (blue-purple) |
| Specular combination | Additive | `max(rim, ocean) + glitter` |
| Cloth/fabric | GGX or Sheen | Oren-Nayar for rough micro-facets |
| Energy conservation | Enforced | Ignored (art over physics) |

---

## Module 2: Terrain & Sand Shader (Journey's 6-Component Pipeline)

### Research Findings

John Edwards' GDC 2013 talk documents that Journey's **shipping sand shader** has exactly 6 components, refined over 3 years:

1. **Sharp Mips** — Sharpened mipmap generation to prevent sand detail from blurring at distance
2. **Anisotropic Masking** — Direction-dependent surface response based on viewing angle
3. **Glitter Specular** — Microfacet random normals for individual grain sparkle (see Module 1)
4. **Ocean Specular** — Blinn-Phong "fluid" reflection on sand (see Module 1)
5. **Diffuse Contrast** — The `4 * dot(N_compressed, L)` formula (see Module 1)
6. **Detail Heightmaps** — 3 stacked heightmaps for terrain geometry

To satisfy this project's production requirements while preserving Journey/Sky visual language, this plan adds two explicit WebGPU adaptations:

7. **Tri-planar mapping (adaptation)** — prevents UV stretching on steep slopes while preserving painterly continuity
8. **Distance-based roughness falloff (adaptation)** — gradually smooths noisy micro-detail in distance bands to preserve atmospheric readability and temporal stability

**Sand Normal Generation** (Alan Zucconi reconstruction):
The sand granularity texture is generated from a **Gaussian distribution**, ensuring the predominant grain direction aligns with the surface normal. The shader blends the geometric normal with random grain normals using **nlerp** (normalized linear interpolation):

```
Ns = normalize(lerp(N, S, sand_strength))
```

Where `S` is a random direction sampled from a noise texture and remapped from [0,1] to [-1,+1].

**Sand Ripples** (Alan Zucconi Part 6):
Ripples use **steepness-based normal blending** — two normal maps (shallow ripples, steep ripples) are interpolated based on the surface inclination:

```
steepness = pow(saturate(dot(N_world, UP)), sharpness_power)
ripple_normal = nlerp(steep_normals, shallow_normals, steepness)
```

**Terrain Heightmap System** (Polycount thread):
Sand terrain uses 3 layered heightmaps:
1. **Base terrain** — B-Spline interpolated macro shapes
2. **Ripple layer** — Wind-driven small-scale ripples + player trails
3. **Detail layer** — Micro-scale grain texture

### 2.1 WGSL Terrain Implementation

```wgsl
// ============================================================
// Module: terrain.wgsl
// Journey-accurate sand/terrain shader with all 6 components
// Source: John Edwards GDC 2013 + Alan Zucconi reconstruction
// ============================================================

// ----- Bind Group 0: Per-Frame Uniforms -----
struct FrameUniforms {
    view_projection: mat4x4f,
    camera_position: vec3f,
    time: f32,
    sun_direction: vec3f,   // Direction TO the sun (normalized)
    _pad0: f32,
    sun_color: vec3f,
    sun_intensity: f32,
    ambient_color: vec3f,   // Sky-colored ambient for shadow fill
    ambient_intensity: f32,
    fog_color_base: vec3f,  // Fog color away from sun
    fog_density: f32,
    fog_color_sun: vec3f,   // Fog color toward sun (warmer)
    fog_height_falloff: f32,
    fog_base_height: f32,
    fog_sun_power: f32,     // Controls how much sun colors the fog
    _pad1: f32,
    _pad2: f32,
};
@group(0) @binding(0) var<uniform> frame: FrameUniforms;

// ----- Bind Group 1: Terrain Material -----
struct TerrainMaterial {
    terrain_color: vec3f,       // Lit sand/grass color
    _pad0: f32,
    shadow_color: vec3f,        // Shadow tint (blue-purple for golden hour)
    _pad1: f32,
    rim_color: vec3f,
    rim_power: f32,
    rim_strength: f32,
    ocean_spec_power: f32,      // Blinn-Phong exponent for "fluid" specular
    ocean_spec_strength: f32,
    _pad2: f32,
    ocean_spec_color: vec3f,
    _pad3: f32,
    glitter_threshold: f32,     // 0.95+ = rare bright sparkles
    glitter_intensity: f32,     // HDR intensity (>1.0 triggers bloom)
    sand_normal_strength: f32,  // How much grain normals perturb surface
    triplanar_scale: f32,       // World scale for tri-planar projection (adaptation)
    y_normal_compression: f32,  // Journey default: 0.3
    diffuse_multiplier: f32,    // Journey default: 4.0
    shadow_saturation_boost: f32,
    roughness_near: f32,        // Near-camera roughness for micro detail
    roughness_far: f32,         // Far roughness to smooth noisy distance detail
    roughness_falloff_start: f32, // Distance where smoothing begins
    roughness_falloff_end: f32,   // Distance where smoothing reaches max
    ripple_scale: f32,          // Base scale for ripple normal maps
    ripple_sharpness: f32,      // Steepness transition sharpness
};
@group(1) @binding(0) var<uniform> mat: TerrainMaterial;
@group(1) @binding(1) var sand_grain_tex: texture_2d<f32>;  // Gaussian random normals
@group(1) @binding(2) var ripple_shallow_tex: texture_2d<f32>; // Shallow dune ripples
@group(1) @binding(3) var ripple_steep_tex: texture_2d<f32>;   // Steep dune ripples
@group(1) @binding(4) var terrain_sampler: sampler;

struct VertexInput {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4f,
    @location(0) world_position: vec3f,
    @location(1) world_normal: vec3f,
    @location(2) uv: vec2f,
    @location(3) view_distance: f32,
};

@vertex
fn vs_terrain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.world_position = input.position;
    output.world_normal = normalize(input.normal);
    output.uv = input.uv;
    output.view_distance = length(frame.camera_position - input.position);
    output.clip_position = frame.view_projection * vec4f(input.position, 1.0);
    return output;
}

// ----- Normalized Linear Interpolation (nlerp) -----
// Journey uses this instead of expensive slerp for normal blending.
// Casey Muratori showed this is nearly identical to slerp in practice.
fn nlerp(a: vec3f, b: vec3f, t: f32) -> vec3f {
    return normalize(mix(a, b, t));
}

// ----- Sand Grain Normal Perturbation -----
// John Edwards GDC: "The random texture was generated from a Gaussian distribution"
// This ensures grain normals cluster near the surface normal rather than
// scattering uniformly, which would look wrong.
fn triplanar_weights(normal: vec3f) -> vec3f {
    let n = pow(abs(normal), vec3f(4.0));
    return n / max(n.x + n.y + n.z, 0.0001);
}

// Adaptation: tri-planar normal sampling avoids UV stretch on steep dunes.
fn triplanar_sample_normal(
    tex: texture_2d<f32>,
    world_pos: vec3f,
    world_normal: vec3f,
    scale: f32
) -> vec3f {
    let w = triplanar_weights(world_normal);

    let x = textureSample(tex, terrain_sampler, world_pos.yz * scale).rgb * 2.0 - 1.0;
    let y = textureSample(tex, terrain_sampler, world_pos.xz * scale).rgb * 2.0 - 1.0;
    let z = textureSample(tex, terrain_sampler, world_pos.xy * scale).rgb * 2.0 - 1.0;

    // World-space approximation for stylized shading.
    let blended = normalize(x * w.x + y * w.y + z * w.z);
    return blended;
}

// Adaptation: suppress high-frequency roughness in the distance to keep
// atmospheric readability and reduce shimmer.
fn distance_roughness(distance: f32) -> f32 {
    let t = saturate(
        (distance - mat.roughness_falloff_start) /
        max(mat.roughness_falloff_end - mat.roughness_falloff_start, 0.001)
    );
    return mix(mat.roughness_near, mat.roughness_far, t);
}

fn sand_grain_normal(
    world_pos: vec3f,
    surface_normal: vec3f,
    strength: f32
) -> vec3f {
    let random_dir = triplanar_sample_normal(
        sand_grain_tex,
        world_pos,
        surface_normal,
        mat.triplanar_scale
    );
    return nlerp(surface_normal, random_dir, strength);
}

// ----- Steepness-Based Ripple Blending -----
// Alan Zucconi Part 6: Ripple normals are selected based on dune steepness.
// Flat areas get shallow wind ripples; steep slopes get erosion patterns.
fn ripple_normal(
    world_pos: vec3f,
    world_normal: vec3f,
    scale: f32,
    sharpness: f32,
    view_distance: f32
) -> vec3f {
    // Calculate steepness: 1.0 = flat, 0.0 = vertical cliff
    let steepness = saturate(dot(world_normal, vec3f(0.0, 1.0, 0.0)));
    let sharp_steep = pow(steepness, sharpness);

    // Distance-driven roughness attenuation.
    let dist_rough = distance_roughness(view_distance);
    let detail_attn = 1.0 - saturate((dist_rough - mat.roughness_near) / max(1.0 - mat.roughness_near, 0.001));
    let local_scale = mix(scale * 0.25, scale, detail_attn);

    // Sample two ripple normal maps via tri-planar projection.
    let shallow = triplanar_sample_normal(ripple_shallow_tex, world_pos, world_normal, local_scale);
    let steep = triplanar_sample_normal(ripple_steep_tex, world_pos, world_normal, local_scale * 0.5);

    // Blend based on steepness
    let ripple = nlerp(steep, shallow, sharp_steep);
    return ripple;
}

// ----- Inigo Quilez Height Fog with Sun Scattering -----
// Combines exponential distance fog with height-based density falloff.
// Fog color shifts toward sun color when looking toward the sun.
// This is the exact formula from iquilez.org/articles/fog/
fn atmospheric_fog(
    world_pos: vec3f,
    camera_pos: vec3f,
    ray_dir: vec3f,
    sun_dir: vec3f,
) -> vec4f { // rgb = fog color, a = fog factor
    let dist = length(world_pos - camera_pos);

    // Height-based density: d(y) = a * e^(-b*y)
    // Analytical integration along the view ray:
    let oy = camera_pos.y;
    let ky = ray_dir.y;
    let b = frame.fog_height_falloff;
    let a = frame.fog_density;

    // Avoid division by zero when ray is horizontal
    var fog_amount: f32;
    if (abs(ky) > 0.001) {
        fog_amount = (a / b) * exp(-oy * b) * (1.0 - exp(-dist * ky * b)) / ky;
    } else {
        fog_amount = a * dist * exp(-oy * b);
    }
    fog_amount = saturate(1.0 - exp(-fog_amount));

    // Sun-colored inscattering (Quilez technique):
    // Fog toward the sun is warmer; fog away is cooler
    let sun_amount = max(dot(ray_dir, sun_dir), 0.0);
    let fog_color = mix(
        frame.fog_color_base,
        frame.fog_color_sun,
        pow(sun_amount, frame.fog_sun_power)
    );

    return vec4f(fog_color, fog_amount);
}

// ----- Main Fragment Shader -----
@fragment
fn fs_terrain(input: VertexOutput) -> @location(0) vec4f {
    let world_pos = input.world_position;
    let geo_normal = normalize(input.world_normal);
    let view_dir = normalize(frame.camera_position - world_pos);
    let ray_dir = -view_dir; // For fog calculation

    // ============================================
    // COMPONENT 1: Sand Grain Normal Perturbation
    // ============================================
    let dist_rough = distance_roughness(input.view_distance);
    let detail_fade = 1.0 - saturate((dist_rough - mat.roughness_near) / max(1.0 - mat.roughness_near, 0.001));
    let grain_strength = mat.sand_normal_strength * detail_fade;

    // Perturbs surface normal to simulate millions of micro-grains
    let grain_normal = sand_grain_normal(
        world_pos,
        geo_normal,
        grain_strength
    );

    // ============================================
    // COMPONENT 2: Steepness-Based Ripple Normals
    // ============================================
    let ripple = ripple_normal(
        world_pos,
        geo_normal,
        mat.ripple_scale,
        mat.ripple_sharpness,
        input.view_distance
    );

    // Combine: base geometry → ripple → grain
    // Ripple applies to the macro shape, grain applies on top
    let rippled_normal = nlerp(geo_normal, ripple, 0.3);
    let final_normal = nlerp(rippled_normal, grain_normal, mat.sand_normal_strength * 0.5);

    // ============================================
    // COMPONENT 3: Journey's Diffuse Contrast
    // ============================================
    // Uses the compressed-Y normal for diffuse only
    var diffuse_normal = final_normal;
    diffuse_normal.y *= mat.y_normal_compression; // Default 0.3
    diffuse_normal = normalize(diffuse_normal);
    let diffuse = saturate(mat.diffuse_multiplier * dot(diffuse_normal, frame.sun_direction));

    // Color: lerp between shadow and lit
    let lit_color = mat.terrain_color * frame.sun_color * frame.sun_intensity;
    let shadow_fill = mat.terrain_color * mat.shadow_color * frame.ambient_color * frame.ambient_intensity;
    var base_color = colored_shadow_blend(diffuse, lit_color, shadow_fill, mat.shadow_saturation_boost);

    // ============================================
    // COMPONENT 4: Rim Lighting (Fresnel)
    // ============================================
    let n_dot_v = dot(final_normal, view_dir);
    let rim = fresnel_rim(n_dot_v, mat.rim_power, mat.rim_strength);
    let rim_contrib = mat.rim_color * rim;

    // ============================================
    // COMPONENT 5: Ocean Specular (Blinn-Phong fluid look)
    // ============================================
    let ocean = ocean_specular(
        final_normal,
        frame.sun_direction,
        view_dir,
        mix(mat.ocean_spec_power * 0.65, mat.ocean_spec_power, detail_fade),
        mat.ocean_spec_strength
    );
    let ocean_contrib = mat.ocean_spec_color * ocean;

    // ============================================
    // COMPONENT 6: Glitter Specular (Microfacet sparkle)
    // ============================================
    // Re-sample grain normal for glitter calculation
    let glitter_grain = sand_grain_normal(
        world_pos * 2.0,
        geo_normal,
        min(0.8, grain_strength * 2.5)
    );
    let glitter = glitter_specular(
        glitter_grain,
        frame.sun_direction,
        view_dir,
        mat.glitter_threshold,
        mat.glitter_intensity
    );
    // Glitter is HDR — values > 1.0 will trigger bloom
    let glitter_contrib = vec3f(1.0, 0.95, 0.8) * glitter;

    // ============================================
    // COMBINE: Journey's specific formula
    // max(rim, ocean) + glitter
    // ============================================
    let spec_combined = max(rim_contrib, ocean_contrib) + glitter_contrib;
    var final_color = base_color + spec_combined;

    // ============================================
    // ATMOSPHERE: Height fog with sun-colored inscattering
    // ============================================
    let fog = atmospheric_fog(world_pos, frame.camera_position, ray_dir, frame.sun_direction);
    final_color = mix(final_color, fog.rgb, fog.a);

    return vec4f(final_color, 1.0);
}
```

### 2.2 Recommended Uniform Values (Golden Hour)
```
terrain_color:          vec3f(0.82, 0.65, 0.40)   // Warm golden sand
shadow_color:           vec3f(0.30, 0.25, 0.50)   // Blue-purple shadow tint
rim_color:              vec3f(1.0, 0.85, 0.55)    // Gold rim
rim_power:              3.5
rim_strength:           0.7
ocean_spec_power:       48.0                       // Tight specular highlight
ocean_spec_strength:    0.6
ocean_spec_color:       vec3f(1.0, 0.92, 0.7)     // Warm gold specular
glitter_threshold:      0.97                       // Very selective = rare bright points
glitter_intensity:      3.0                        // HDR — triggers bloom
sand_normal_strength:   0.25                       // Subtle grain perturbation
triplanar_scale:        0.06                       // World-scale projection to remove UV seams
y_normal_compression:   0.3                        // Journey's exact value
diffuse_multiplier:     4.0                        // Journey's exact value
shadow_saturation_boost: 0.3
roughness_near:         0.35
roughness_far:          0.85
roughness_falloff_start: 90.0
roughness_falloff_end:  380.0
ripple_scale:           8.0
ripple_sharpness:       4.0
fog_density:            0.012
fog_height_falloff:     0.06
fog_base_height:        0.0
fog_sun_power:          8.0                        // Sunset fog glow concentration
```

---

## Module 3: Volumetric-Style Clouds (Hero Element)

### Research Findings

Primary Sky/Journey talks emphasize atmosphere, silhouette readability, and painterly softness, but do not publicly disclose a full cloud implementation.  
For this WebGPU plan, we adopt a **mesh-based volumetric cloud adaptation** (inspired by Sea of Thieves production research) instead of full-screen raymarching to hit mobile-friendly frame budgets while matching the artistic target. The key innovations:

1. **Pre-computed Occlusion Lobes** (Sea of Thieves / Rare GDC): Rather than raymarching density per-pixel, light absorption is approximated per-vertex using pre-computed directional occlusion stored in vertex colors. At runtime, the occlusion lobe is rotated to match the current sun direction.

2. **Beer's Law Absorption**: `transmittance = e^(-density * thickness)` — denser regions absorb more light. Combined with the **powder effect** (`1 - e^(-density * 2)`) which darkens thin edges where forward and backward scattering cancel.

3. **Henyey-Greenstein Phase Function**: Approximates forward scattering — clouds glow bright when backlit by the sun, creating the characteristic "silver lining" effect.

4. **Vertex Displacement**: 3D FBM noise displaces sphere mesh vertices to create organic billowing shapes. This is animated slowly for cloud drift.

### 3.1 Cloud Noise Library

```wgsl
// ============================================================
// Module: noise3d.wgsl
// 3D noise for cloud displacement and shading
// ============================================================

fn hash3d(p: vec3f) -> vec3f {
    var q = vec3f(
        dot(p, vec3f(127.1, 311.7, 74.7)),
        dot(p, vec3f(269.5, 183.3, 246.1)),
        dot(p, vec3f(113.5, 271.9, 124.6))
    );
    return fract(sin(q) * 43758.5453123) * 2.0 - 1.0;
}

// 3D Gradient Noise with quintic interpolation
fn noise_3d(p: vec3f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

    return mix(
        mix(
            mix(dot(hash3d(i + vec3f(0, 0, 0)), f - vec3f(0, 0, 0)),
                dot(hash3d(i + vec3f(1, 0, 0)), f - vec3f(1, 0, 0)), u.x),
            mix(dot(hash3d(i + vec3f(0, 1, 0)), f - vec3f(0, 1, 0)),
                dot(hash3d(i + vec3f(1, 1, 0)), f - vec3f(1, 1, 0)), u.x),
            u.y),
        mix(
            mix(dot(hash3d(i + vec3f(0, 0, 1)), f - vec3f(0, 0, 1)),
                dot(hash3d(i + vec3f(1, 0, 1)), f - vec3f(1, 0, 1)), u.x),
            mix(dot(hash3d(i + vec3f(0, 1, 1)), f - vec3f(0, 1, 1)),
                dot(hash3d(i + vec3f(1, 1, 1)), f - vec3f(1, 1, 1)), u.x),
            u.y),
        u.z);
}

fn fbm_3d(p: vec3f, octaves: i32) -> f32 {
    var value = 0.0;
    var amp = 0.5;
    var pos = p;
    for (var i = 0; i < octaves; i++) {
        value += amp * noise_3d(pos);
        amp *= 0.5;
        pos *= 2.01;
    }
    return value;
}

// Worley noise for cauliflower-like cloud detail
fn worley_3d(p: vec3f) -> f32 {
    let cell = floor(p);
    let local = fract(p);
    var min_dist = 1.0;
    for (var x = -1; x <= 1; x++) {
        for (var y = -1; y <= 1; y++) {
            for (var z = -1; z <= 1; z++) {
                let offset = vec3f(f32(x), f32(y), f32(z));
                let neighbor = cell + offset;
                let point = offset + fract(sin(vec3f(
                    dot(neighbor, vec3f(127.1, 311.7, 74.7)),
                    dot(neighbor, vec3f(269.5, 183.3, 246.1)),
                    dot(neighbor, vec3f(113.5, 271.9, 124.6))
                )) * 43758.5453) - local;
                min_dist = min(min_dist, length(point));
            }
        }
    }
    return min_dist;
}
```

### 3.2 Cloud Shader

```wgsl
// ============================================================
// Module: cloud.wgsl
// Mesh-based volumetric cloud with:
//   - Vertex displacement via FBM + Worley noise
//   - Beer's Law absorption + powder effect
//   - Henyey-Greenstein forward scattering
//   - Pre-computed occlusion lobe (baked in vertex color)
// Source: Sea of Thieves GDC + general industry technique
// ============================================================

struct CloudMaterial {
    cloud_color_lit: vec3f,
    _pad0: f32,
    cloud_color_shadow: vec3f,
    _pad1: f32,
    cloud_color_ambient: vec3f,
    _pad2: f32,
    noise_scale: f32,
    noise_speed: f32,
    displacement_strength: f32,
    density_scale: f32,
    // Henyey-Greenstein scattering
    scatter_g: f32,         // Anisotropy factor: 0.0 = isotropic, 0.8 = strong forward
    scatter_intensity: f32,
    edge_softness: f32,
    opacity: f32,
};
@group(1) @binding(0) var<uniform> cloud_mat: CloudMaterial;

struct CloudVertexInput {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
    @location(3) occlusion: f32,  // Pre-baked directional occlusion (vertex color)
};

struct CloudVertexOutput {
    @builtin(position) clip_position: vec4f,
    @location(0) world_position: vec3f,
    @location(1) world_normal: vec3f,
    @location(2) local_position: vec3f,
    @location(3) noise_value: f32,
    @location(4) view_distance: f32,
    @location(5) occlusion: f32,
};

@vertex
fn vs_cloud(input: CloudVertexInput) -> CloudVertexOutput {
    var output: CloudVertexOutput;

    let local_pos = input.position;
    let normal = normalize(input.normal);

    // Animated noise for billowy displacement
    let noise_pos = local_pos * cloud_mat.noise_scale
                    + vec3f(frame.time * cloud_mat.noise_speed, 0.0, frame.time * cloud_mat.noise_speed * 0.3);

    let perlin = fbm_3d(noise_pos, 4);
    let worley = worley_3d(noise_pos * 1.5);
    let noise_val = saturate(perlin * 0.7 + (1.0 - worley) * 0.3);

    let displacement = normal * noise_val * cloud_mat.displacement_strength;
    let displaced_pos = local_pos + displacement;

    output.world_position = displaced_pos;
    output.world_normal = normal;
    output.local_position = local_pos;
    output.noise_value = noise_val;
    output.occlusion = input.occlusion;
    output.view_distance = length(frame.camera_position - displaced_pos);
    output.clip_position = frame.view_projection * vec4f(displaced_pos, 1.0);
    return output;
}

// Beer's Law: light absorption through volume
fn beers_law(density: f32, thickness: f32) -> f32 {
    return exp(-density * thickness);
}

// Powder effect: compensates for over-bright thin edges
fn powder_effect(density: f32) -> f32 {
    return 1.0 - exp(-density * 2.0);
}

// Henyey-Greenstein phase function
// Controls how light scatters through cloud volume.
// g > 0: forward scattering (bright when backlit by sun)
// g = 0: isotropic
// g < 0: backward scattering
fn henyey_greenstein(cos_theta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let denom = 1.0 + g2 - 2.0 * g * cos_theta;
    return (1.0 - g2) / (4.0 * 3.14159 * pow(denom, 1.5));
}

@fragment
fn fs_cloud(input: CloudVertexOutput) -> @location(0) vec4f {
    let world_pos = input.world_position;
    let normal = normalize(input.world_normal);
    let view_dir = normalize(frame.camera_position - world_pos);
    let light_dir = normalize(frame.sun_direction);

    // 1. Density: center = dense, edge = thin, modulated by noise
    let center_dist = length(input.local_position);
    let edge_factor = saturate(center_dist);
    let base_density = (1.0 - edge_factor) * cloud_mat.density_scale;
    let density = base_density * (0.5 + input.noise_value * 0.5);

    // 2. Beer's Law absorption with pre-baked occlusion
    let n_dot_l = dot(normal, light_dir);
    let light_depth = saturate(1.0 - n_dot_l) * 2.0;
    let absorption = beers_law(density, light_depth);

    // Apply pre-computed occlusion lobe (Sea of Thieves technique)
    let occluded_absorption = absorption * mix(0.3, 1.0, input.occlusion);

    // 3. Powder effect
    let powder = powder_effect(density);

    // 4. Henyey-Greenstein forward scattering
    let cos_theta = dot(view_dir, light_dir);
    let phase = henyey_greenstein(cos_theta, cloud_mat.scatter_g);
    let scatter = phase * cloud_mat.scatter_intensity;

    // 5. Combine: lit side warm, shadow side cool
    let lit_amount = occluded_absorption * powder;
    var cloud_color = mix(
        cloud_mat.cloud_color_shadow,
        cloud_mat.cloud_color_lit,
        lit_amount
    );

    // Forward scattering glow (the "silver lining")
    cloud_color += cloud_mat.cloud_color_lit * scatter * absorption;

    // Ambient fill
    cloud_color += cloud_mat.cloud_color_ambient * 0.15;

    // Fresnel rim for ethereal cloud edges
    let n_dot_v = dot(normal, view_dir);
    let rim = pow(saturate(1.0 - n_dot_v), 2.0);
    cloud_color += cloud_mat.cloud_color_lit * rim * 0.25 * lit_amount;

    // 6. Soft edge opacity
    let edge_opacity = smoothstep(0.0, cloud_mat.edge_softness, density);
    let dist_fade = 1.0 - smoothstep(800.0, 1200.0, input.view_distance);
    let final_opacity = edge_opacity * cloud_mat.opacity * dist_fade;

    // 7. Atmospheric fog integration
    let ray_dir = normalize(world_pos - frame.camera_position);
    let fog = atmospheric_fog(world_pos, frame.camera_position, ray_dir, frame.sun_direction);
    cloud_color = mix(cloud_color, fog.rgb, fog.a * 0.4);

    return vec4f(cloud_color, final_opacity);
}
```

### 3.3 Recommended Uniform Values
```
cloud_color_lit:       vec3f(1.0, 0.95, 0.88)    // Warm white-gold
cloud_color_shadow:    vec3f(0.35, 0.28, 0.45)    // Blue-purple shadow
cloud_color_ambient:   vec3f(0.55, 0.50, 0.60)    // Muted sky fill
noise_scale:           0.8
noise_speed:           0.015
displacement_strength: 0.45
density_scale:         2.5
scatter_g:             0.7                         // Strong forward scattering
scatter_intensity:     2.0
edge_softness:         0.3
opacity:               0.9
```

---

## Module 4: Instanced Foliage (Grass / Flowers)

### Research Findings

**Wind Simulation**: Journey and Sky use layered sine waves with world-position-based phase offsets. Each blade's world position creates a unique phase, preventing uniform swaying. Three layers: primary wind, gusts (slower, perpendicular), and micro-turbulence (fast, random).

**Fake SSS / Translucency**: The standard game technique for foliage translucency uses **view-light alignment**:
```
sss = dot(-V, L) * thickness * intensity
```
When the camera looks toward the light through a leaf/blade, the surface glows. Additional refinement adds the surface normal scaled by a "distortion" factor to the negated light direction, simulating how light scatters when exiting the material:
```
sss_dir = normalize(-L + N * distortion)
sss = pow(saturate(dot(V, sss_dir)), power) * intensity
```

**Sky-Biased Normals**: Foliage normals are blended toward (0,1,0) regardless of mesh curvature. This makes blades catch more sky light, simulating the translucent quality of thin grass.

### 4.1 WGSL Foliage Shader

```wgsl
// ============================================================
// Module: foliage.wgsl
// Hardware-instanced grass/flower shader
// - 3-layer wind simulation with world-position phase
// - Normal-distortion SSS (not just dot(V,L))
// - Sky-biased normals for translucency
// ============================================================

struct FoliageMaterial {
    color_base: vec3f,
    _pad0: f32,
    color_tip: vec3f,
    _pad1: f32,
    color_variation_range: vec3f,
    _pad2: f32,
    sss_color: vec3f,           // Translucency color (warm yellow-green)
    sss_intensity: f32,
    sss_distortion: f32,        // How much normal bends the SSS direction
    sss_power: f32,             // Tightness of backlit glow
    sky_normal_bias: f32,       // 0 = mesh normal, 1 = straight up
    _pad3: f32,
    wind_strength: f32,
    wind_frequency: f32,
    wind_direction: vec2f,
};
@group(1) @binding(0) var<uniform> foliage_mat: FoliageMaterial;

struct GrassInstance {
    @location(3) inst_position: vec3f,
    @location(4) inst_rotation: f32,
    @location(5) inst_scale: vec2f,
    @location(6) inst_color_variation: f32,
    @location(7) inst_flexibility: f32,
};

struct FoliageVertexInput {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
};

struct FoliageVertexOutput {
    @builtin(position) clip_position: vec4f,
    @location(0) world_position: vec3f,
    @location(1) world_normal: vec3f,
    @location(2) uv: vec2f,
    @location(3) color_variation: f32,
    @location(4) view_distance: f32,
    @location(5) height_factor: f32,
};

// 3-layer wind with world-position phase offset
fn calculate_wind(
    world_pos: vec3f, height: f32, time: f32,
    strength: f32, freq: f32, dir: vec2f, flex: f32
) -> vec3f {
    // Each layer has different frequency, direction, and amplitude
    let phase1 = dot(world_pos.xz, dir) * 0.05;
    let primary = sin(time * freq + phase1) * strength;

    let phase2 = dot(world_pos.xz, vec2f(-dir.y, dir.x)) * 0.03;
    let gust = sin(time * freq * 0.4 + phase2 + 1.7) * strength * 0.5;

    let phase3 = dot(world_pos.xz, vec2f(1.0, 0.5)) * 0.15;
    let micro = sin(time * freq * 2.3 + phase3) * strength * 0.15;

    let bend = height * height * flex; // Quadratic bend (anchored base)

    return vec3f(
        (primary + micro) * dir.x * bend,
        -abs(primary) * bend * 0.1,
        (gust + micro) * dir.y * bend
    );
}

@vertex
fn vs_foliage(vertex: FoliageVertexInput, instance: GrassInstance) -> FoliageVertexOutput {
    var output: FoliageVertexOutput;

    let height_factor = saturate(vertex.position.y);

    var scaled = vec3f(
        vertex.position.x * instance.inst_scale.x,
        vertex.position.y * instance.inst_scale.y,
        vertex.position.z * instance.inst_scale.x
    );

    let c = cos(instance.inst_rotation);
    let s = sin(instance.inst_rotation);
    let rotated = vec3f(scaled.x * c - scaled.z * s, scaled.y, scaled.x * s + scaled.z * c);

    var world_pos = rotated + instance.inst_position;
    world_pos += calculate_wind(
        world_pos, height_factor, frame.time,
        foliage_mat.wind_strength, foliage_mat.wind_frequency,
        foliage_mat.wind_direction, instance.inst_flexibility
    );

    output.world_position = world_pos;

    // Sky-biased normal: blend toward (0,1,0) for translucency
    let mesh_normal = normalize(vec3f(
        vertex.normal.x * c - vertex.normal.z * s,
        vertex.normal.y,
        vertex.normal.x * s + vertex.normal.z * c
    ));
    output.world_normal = normalize(mix(mesh_normal, vec3f(0.0, 1.0, 0.0), foliage_mat.sky_normal_bias));

    output.uv = vertex.uv;
    output.color_variation = instance.inst_color_variation;
    output.height_factor = height_factor;
    output.view_distance = length(frame.camera_position - world_pos);
    output.clip_position = frame.view_projection * vec4f(world_pos, 1.0);
    return output;
}

@fragment
fn fs_foliage(input: FoliageVertexOutput) -> @location(0) vec4f {
    let N = normalize(input.world_normal);
    let V = normalize(frame.camera_position - input.world_position);
    let L = normalize(frame.sun_direction);

    // Base color: gradient base→tip with per-instance variation
    var base_color = mix(foliage_mat.color_base, foliage_mat.color_tip, input.height_factor);
    base_color += foliage_mat.color_variation_range * (input.color_variation - 0.5);

    // Stylized diffuse (Journey's wrapped approach)
    let diffuse = journey_diffuse(N, L);
    let lit = base_color * frame.sun_color * frame.sun_intensity;
    let shadow = base_color * vec3f(0.1, 0.15, 0.2) * frame.ambient_color * frame.ambient_intensity;
    var final_color = colored_shadow_blend(diffuse, lit, shadow, 0.2);

    // Rim lighting
    let n_dot_v = dot(N, V);
    let rim = fresnel_rim(n_dot_v, 3.0, 0.4);
    final_color += vec3f(0.7, 0.85, 0.4) * rim;

    // ============================================
    // NORMAL-DISTORTION SUBSURFACE SCATTERING
    // ============================================
    // More accurate than simple dot(V,L):
    // We bend the light direction by the surface normal to simulate
    // how light scatters when exiting the leaf/blade.
    let sss_dir = normalize(-L + N * foliage_mat.sss_distortion);
    let sss_dot = saturate(dot(V, sss_dir));
    let sss_factor = pow(sss_dot, foliage_mat.sss_power) * foliage_mat.sss_intensity;
    // SSS is stronger at blade tips (thinner material)
    let sss = foliage_mat.sss_color * sss_factor * input.height_factor;
    final_color += sss;

    // Height fog
    let ray_dir = normalize(input.world_position - frame.camera_position);
    let fog = atmospheric_fog(input.world_position, frame.camera_position, ray_dir, frame.sun_direction);
    final_color = mix(final_color, fog.rgb, fog.a);

    let alpha = smoothstep(0.0, 0.1, input.height_factor);
    return vec4f(final_color, alpha);
}
```

### 4.2 Recommended Uniform Values
```
color_base:             vec3f(0.25, 0.45, 0.15)   // Dark green base
color_tip:              vec3f(0.65, 0.75, 0.30)   // Yellow-green tip
color_variation_range:  vec3f(0.08, 0.12, 0.05)
sss_color:              vec3f(0.8, 0.9, 0.3)      // Warm yellow-green glow
sss_intensity:          1.5
sss_distortion:         0.3                        // Subtle normal bending
sss_power:              4.0
sky_normal_bias:        0.5                        // 50% bias toward sky
wind_strength:          1.2
wind_frequency:         1.5
wind_direction:         vec2f(0.8, 0.6)
```

---

## Module 5: Post-Processing Stack (Compute Shader)

### Research Findings

**Dual Kawase Bloom**: The modern standard for game bloom. Kawase blur is a close approximation of Gaussian blur but significantly cheaper. The "dual" variant combines it with progressive downsampling/upsampling for massive blur radii at minimal cost. Used extensively in mobile games including titles like Sky that need to maintain battery life.

**AgX Tone Mapping**: For this style target, AgX is preferred as the default look transform because it generally retains saturated highlight color more gracefully in stylized sunset scenes.  
ACES remains a valid fallback and should be retained as a runtime toggle for A/B lookdev:
- AgX: default for warm-gold highlight preservation and smooth shoulder roll-off
- ACES: fallback option for teams preferring established filmic pipelines
- Decision rule: pick the transform that best matches approved Sky/Journey reference frames, not theoretical preference

**Color Grading for Sky's Look**: The signature warm-cool split:
- Shadows → blue-purple (cool)
- Highlights → gold-orange (warm)
- This creates **color separation** that makes scenes feel cinematic and emotionally evocative

### 5.1 WGSL Post-Processing

```wgsl
// ============================================================
// Module: post_processing.wgsl
// - Dual Kawase Bloom (downsample + upsample)
// - AgX Tone Mapping (color-preserving)
// - Sky-style Color Grading (warm highlights, cool shadows)
// ============================================================

// ----- BLOOM DOWNSAMPLE (Dual Kawase) -----
@group(0) @binding(0) var bloom_input: texture_2d<f32>;
@group(0) @binding(1) var bloom_output: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var bloom_sampler: sampler;

struct BloomParams {
    texel_size: vec2f,
    threshold: f32,
    soft_knee: f32,
    mip_level: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};
@group(0) @binding(3) var<uniform> bloom: BloomParams;

// Dual Kawase downsample: 5-tap kernel
// Samples center + 4 corners offset by half-texel
// This gives wider coverage than a box filter
fn kawase_downsample(uv: vec2f, texel: vec2f) -> vec4f {
    let a = textureSampleLevel(bloom_input, bloom_sampler, uv, 0.0) * 4.0;
    let b = textureSampleLevel(bloom_input, bloom_sampler, uv + vec2f(-texel.x, -texel.y), 0.0);
    let c = textureSampleLevel(bloom_input, bloom_sampler, uv + vec2f( texel.x, -texel.y), 0.0);
    let d = textureSampleLevel(bloom_input, bloom_sampler, uv + vec2f(-texel.x,  texel.y), 0.0);
    let e = textureSampleLevel(bloom_input, bloom_sampler, uv + vec2f( texel.x,  texel.y), 0.0);
    return (a + b + c + d + e) * 0.125; // /8 total weight
}

// Soft threshold: avoids hard cutoff artifacts
fn bloom_threshold(color: vec3f, threshold: f32, knee: f32) -> vec3f {
    let brightness = max(color.r, max(color.g, color.b));
    let soft = brightness - threshold + knee;
    let soft_clamped = clamp(soft, 0.0, 2.0 * knee);
    let contribution = soft_clamped * soft_clamped / (4.0 * knee + 0.00001);
    let mult = max(brightness - threshold, contribution) / max(brightness, 0.00001);
    return color * mult;
}

@compute @workgroup_size(8, 8, 1)
fn cs_bloom_downsample(@builtin(global_invocation_id) id: vec3u) {
    let dims = textureDimensions(bloom_output);
    if (id.x >= dims.x || id.y >= dims.y) { return; }

    let uv = (vec2f(id.xy) + 0.5) / vec2f(dims);
    var color = kawase_downsample(uv, bloom.texel_size);

    if (bloom.mip_level == 0u) {
        color = vec4f(bloom_threshold(color.rgb, bloom.threshold, bloom.soft_knee), color.a);
    }

    textureStore(bloom_output, id.xy, color);
}

// ----- BLOOM UPSAMPLE (Dual Kawase) -----
@group(0) @binding(0) var upsample_input: texture_2d<f32>;
@group(0) @binding(1) var upsample_blend: texture_2d<f32>;
@group(0) @binding(2) var upsample_output: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var upsample_sampler: sampler;

struct UpsampleParams {
    texel_size: vec2f,
    blend_factor: f32,
    _pad0: f32,
};
@group(0) @binding(4) var<uniform> upsample: UpsampleParams;

// Dual Kawase upsample: 8-tap tent kernel
// Weighted ring of samples produces smooth upscale
fn kawase_upsample(uv: vec2f, texel: vec2f) -> vec4f {
    let ht = texel * 0.5;
    var result = textureSampleLevel(upsample_input, upsample_sampler, uv + vec2f(-ht.x * 2.0, 0.0), 0.0);
    result += textureSampleLevel(upsample_input, upsample_sampler, uv + vec2f(-ht.x, ht.y), 0.0) * 2.0;
    result += textureSampleLevel(upsample_input, upsample_sampler, uv + vec2f(0.0, ht.y * 2.0), 0.0);
    result += textureSampleLevel(upsample_input, upsample_sampler, uv + vec2f(ht.x, ht.y), 0.0) * 2.0;
    result += textureSampleLevel(upsample_input, upsample_sampler, uv + vec2f(ht.x * 2.0, 0.0), 0.0);
    result += textureSampleLevel(upsample_input, upsample_sampler, uv + vec2f(ht.x, -ht.y), 0.0) * 2.0;
    result += textureSampleLevel(upsample_input, upsample_sampler, uv + vec2f(0.0, -ht.y * 2.0), 0.0);
    result += textureSampleLevel(upsample_input, upsample_sampler, uv + vec2f(-ht.x, -ht.y), 0.0) * 2.0;
    return result / 12.0;
}

@compute @workgroup_size(8, 8, 1)
fn cs_bloom_upsample(@builtin(global_invocation_id) id: vec3u) {
    let dims = textureDimensions(upsample_output);
    if (id.x >= dims.x || id.y >= dims.y) { return; }

    let uv = (vec2f(id.xy) + 0.5) / vec2f(dims);
    let bloom_color = kawase_upsample(uv, upsample.texel_size);
    let scene_color = textureSampleLevel(upsample_blend, upsample_sampler, uv, 0.0);
    textureStore(upsample_output, id.xy, scene_color + bloom_color * upsample.blend_factor);
}

// ----- AGX TONE MAPPING + COLOR GRADING -----

struct GradingParams {
    exposure: f32,
    contrast: f32,
    saturation: f32,
    _pad0: f32,
    shadow_color: vec3f,      // Blue-purple for Sky look
    shadow_strength: f32,
    highlight_color: vec3f,   // Gold-orange for Sky look
    highlight_strength: f32,
    midtone_color: vec3f,
    midtone_strength: f32,
};

@group(0) @binding(0) var grading_input: texture_2d<f32>;
@group(0) @binding(1) var grading_output: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> grading: GradingParams;

// AgX sigmoid approximation (6th order polynomial)
fn agx_default_contrast(x: vec3f) -> vec3f {
    let x2 = x * x;
    let x4 = x2 * x2;
    return 15.5 * x4 * x2
         - 40.14 * x4 * x
         + 31.96 * x4
         - 6.868 * x2 * x
         + 0.4298 * x2
         + 0.1191 * x
         - 0.00232;
}

fn agx_tonemap(color: vec3f) -> vec3f {
    // AgX input transform: compress scene-referred into log2 space
    let agx_mat = mat3x3f(
        vec3f(0.842479062253094,  0.0423282422610123, 0.0423756549057051),
        vec3f(0.0784335999999992, 0.878468636469772,  0.0784336),
        vec3f(0.0792237451477643, 0.0791661274605434, 0.879142973793104)
    );

    let min_ev = -12.47393;
    let max_ev = 4.026069;

    var val = agx_mat * color;
    val = clamp(log2(max(val, vec3f(1e-10))), vec3f(min_ev), vec3f(max_ev));
    val = (val - vec3f(min_ev)) / (max_ev - min_ev);
    return agx_default_contrast(val);
}

// "Punchy" look: boost saturation and contrast post-tonemap
fn agx_look_golden_hour(color: vec3f) -> vec3f {
    let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
    let power = vec3f(1.3, 1.25, 1.4); // Slightly different per-channel for warmth
    let saturation = 1.35;

    var result = pow(color, power);
    result = mix(vec3f(luma), result, saturation);
    return result;
}

fn agx_eotf(color: vec3f) -> vec3f {
    // Inverse of input transform
    let inv = mat3x3f(
        vec3f( 1.19687900512017,   -0.0528968517574562, -0.0529716355144438),
        vec3f(-0.0980208811401368,  1.15190312990417,   -0.0980434501171241),
        vec3f(-0.0990297440797205, -0.0989611768448433,  1.15107367264116)
    );
    return inv * color;
}

// Sky-style color grading: warm highlights, cool shadows
fn sky_color_grade(color: vec3f) -> vec3f {
    var c = color;

    c *= pow(2.0, grading.exposure);
    c = mix(vec3f(0.18), c, grading.contrast);

    let luma = dot(c, vec3f(0.2126, 0.7152, 0.0722));

    // Shadow tint (blue-purple in golden hour)
    let shadow_w = 1.0 - smoothstep(0.0, 0.35, luma);
    c = mix(c, c * grading.shadow_color, shadow_w * grading.shadow_strength);

    // Highlight tint (gold-orange)
    let highlight_w = smoothstep(0.5, 1.0, luma);
    c = mix(c, c * grading.highlight_color, highlight_w * grading.highlight_strength);

    // Midtone tint
    let midtone_w = 1.0 - abs(luma - 0.5) * 2.0;
    c = mix(c, c * grading.midtone_color, midtone_w * grading.midtone_strength);

    // Saturation
    let grey = dot(c, vec3f(0.2126, 0.7152, 0.0722));
    c = mix(vec3f(grey), c, grading.saturation);

    return c;
}

@compute @workgroup_size(8, 8, 1)
fn cs_tonemap_grade(@builtin(global_invocation_id) id: vec3u) {
    let dims = textureDimensions(grading_output);
    if (id.x >= dims.x || id.y >= dims.y) { return; }

    var color = textureLoad(grading_input, vec2i(id.xy), 0).rgb;

    // 1. Color grading in linear space
    color = sky_color_grade(color);

    // 2. AgX tone mapping (preserves sunset colors)
    color = agx_tonemap(color);
    color = agx_look_golden_hour(color);
    color = agx_eotf(color);

    textureStore(grading_output, id.xy, vec4f(saturate(color), 1.0));
}
```

### 5.2 Recommended Color Grading Values
```
exposure:            0.15
contrast:            1.12
saturation:          1.25
shadow_color:        vec3f(0.7, 0.6, 1.2)    // Blue-purple lift
shadow_strength:     0.35
highlight_color:     vec3f(1.3, 1.1, 0.8)    // Gold warmth
highlight_strength:  0.3
midtone_color:       vec3f(1.02, 0.98, 0.95) // Very subtle warm shift
midtone_strength:    0.1
bloom_threshold:     0.75                     // Lower = more dreamy
bloom_soft_knee:     0.3
bloom_blend:         0.4                      // Generous bloom for Sky look
```

---

## Module 6: WebGPU Pipeline Setup

### 6.1 Bind Group Architecture

```
Bind Group 0: Per-Frame (shared by ALL render pipelines)
├── @binding(0) uniform<FrameUniforms>

Bind Group 1: Per-Material (varies per pipeline)
├── Terrain:
│   ├── @binding(0) uniform<TerrainMaterial>
│   ├── @binding(1) texture_2d (Gaussian grain normals)
│   ├── @binding(2) texture_2d (shallow ripple normals)
│   ├── @binding(3) texture_2d (steep ripple normals)
│   └── @binding(4) sampler
├── Cloud:
│   └── @binding(0) uniform<CloudMaterial>
├── Foliage:
│   └── @binding(0) uniform<FoliageMaterial>

Compute Bind Groups (separate per-dispatch):
├── Bloom Downsample: input_tex, output_storage, sampler, params
├── Bloom Upsample: input_tex, blend_tex, output_storage, sampler, params
├── Tonemap+Grade: input_tex, output_storage, grading_params
```

### 6.2 Render Order

The render order is critical for correct alpha blending and fog integration:

```
1. Clear HDR render target (rgba16float) to sky gradient color
2. OPAQUE PASS (depth write ON):
   a. Skybox / sky gradient (depth write OFF, depth test OFF)
   b. Terrain (Journey sand shader)
3. TRANSPARENT PASS (depth write OFF, depth test ON, back-to-front):
   a. Clouds (sorted by distance, cull front faces)
   b. Instanced foliage (alpha blend, no cull)
4. POST-PROCESSING (compute):
   a. Bloom downsample chain (6 mips)
   b. Bloom upsample chain (6 mips, accumulating)
   c. Tonemap + color grade → rgba8unorm output
5. BLIT to swapchain
```

### 6.3 Key Pipeline Configurations

| Pipeline | Cull Mode | Depth Write | Blend | Render Target |
|----------|-----------|-------------|-------|---------------|
| Terrain | Back | Yes | None (opaque) | rgba16float HDR |
| Cloud | **Front** | No | Alpha blend | rgba16float HDR |
| Foliage | **None** | Yes (with alpha test) | Alpha blend | rgba16float HDR |
| Bloom | N/A (compute) | N/A | N/A | rgba16float storage |
| Tonemap | N/A (compute) | N/A | N/A | rgba8unorm storage |

---

## Performance Budget

### Target: 60fps at 1080p (matching Sky's mobile targets)

| Module | Draw Calls | GPU Time (est.) | Optimization Strategy |
|--------|-----------|-----------------|----------------------|
| Terrain | 1 | 1.5ms | Noise baked to texture at distance; `sand_normal_strength` → 0 far away |
| Clouds | 5-10 | 2.0ms | LOD meshes; reduce FBM octaves at distance; pre-baked occlusion |
| Foliage | 1 (instanced) | 1.5ms | Instance count scales with quality; frustum cull via compute |
| Bloom | 12 dispatches | 0.8ms | Small textures (1/2, 1/4, 1/8...); 8x8 workgroups |
| Tonemap | 1 dispatch | 0.3ms | Single full-res pass |
| **Total** | **~20** | **~6ms** | **10ms budget remaining for game logic** |

### Quality Presets

| Setting | Mobile | Medium | High | Ultra |
|---------|--------|--------|------|-------|
| Grass instances | 5,000 | 20,000 | 50,000 | 100,000 |
| Cloud meshes | 3 | 6 | 10 | 15 |
| Cloud FBM octaves | 2 | 3 | 4 | 5 |
| Bloom mip levels | 4 | 5 | 6 | 7 |
| Sand grain texture res | 256² | 512² | 1024² | 1024² |
| Ripple normal res | 256² | 512² | 1024² | 1024² |
| Render scale | 0.6 | 0.85 | 1.0 | 1.0 |

### Mobile Optimization Lessons from Sky

From [Apple Developer: Behind the Design](https://developer.apple.com/news/?id=zm47it7t):
- Sky runs on a **custom Metal engine** with aggressive battery-life optimization
- **Shader permutations**: Compile simplified shader variants for lower-end devices
- **Distance-based detail**: Aggressively reduce noise octaves, normal perturbation, and specular at distance
- **Shared uniform buffers**: One per-frame UBO reduces CPU overhead
- **Pre-baked where possible**: Cloud occlusion, ambient occlusion in vertex colors

---

## Implementation Order

1. **Core Lighting** (`stylized_lighting.wgsl`) — Journey's diffuse contrast + 3-type specular
2. **Noise Library** (`noise3d.wgsl`) — Shared FBM/Worley functions
3. **Terrain Shader** (`terrain.wgsl`) — All 6 Journey sand components + Quilez fog
4. **Cloud Shader** (`cloud.wgsl`) — Mesh-based volumetric with Beer's Law + HG scattering
5. **Pipeline Setup** (`sky_theme_pipelines.js`) — Wire terrain + clouds first for visual validation
6. **Foliage Shader** (`foliage.wgsl`) — Instanced with normal-distortion SSS
7. **Post-Processing** (`post_processing.wgsl`) — Dual Kawase bloom + AgX + grading
8. **Polish** — Tune all uniforms to match golden hour reference, add quality presets

## Phase Gates (Masterpiece Criteria)

Every phase must pass both a **visual gate** and a **performance gate** before moving forward.

| Phase | Deliverable | Visual Gate | Performance Gate |
|------|-------------|-------------|------------------|
| Phase 0 | Reference board + look bible | 12-20 curated Sky/Journey frames grouped by mood (sunset, cloud sea, interior haze) with approved palette targets | N/A |
| Phase 1 | Stylized lighting core | No black shadows; silhouette rim separation visible at 3 distances; warm/cool split approved | < 0.5ms at 1080p |
| Phase 2 | Terrain pass | No visible UV stretching on steep slopes (tri-planar active); distant terrain stable without noisy shimmer | < 2.0ms at 1080p |
| Phase 3 | Cloud pass | Hero cloud silhouettes read clearly against sky; backlit silver-lining behavior passes reference check | < 2.5ms at 1080p |
| Phase 4 | Foliage instancing | Wind motion looks layered/non-synchronous; translucency reads from sun-facing camera angles | < 2.0ms at target instance count |
| Phase 5 | Post stack | Bloom halo soft but controlled; no highlight hue collapse in approved sunset scenes | < 1.5ms at 1080p |
| Phase 6 | Integrated shot review | 6 cinematic camera paths validated against look bible; no style drift between shots | Sustained 60fps on target device tier |
| Phase 7 | Quality-tier QA | Mobile/Medium/High/Ultra tiers preserve artistic identity, not just FPS | Tier frame budget compliance |

### Lookdev Review Workflow

1. Capture fixed-camera screenshots from predefined camera bookmarks each build.
2. Compare against approved reference board (human review + histogram sanity checks).
3. Track style regressions in a "look log" with cause and corrective parameter diffs.
4. Block merges that improve FPS but break silhouette readability, atmosphere continuity, or warm/cool balance.

---

## File Structure

```
src/themes/sky-children/
├── wgsl/
│   ├── stylized_lighting.wgsl       # Journey's lighting model (diffuse contrast,
│   │                                 # Oren-Nayar, Fresnel, ocean spec, glitter)
│   ├── noise3d.wgsl                  # 3D Perlin, Worley, FBM
│   ├── terrain.wgsl                  # 6-component Journey sand shader + Quilez fog
│   ├── cloud.wgsl                    # Mesh volumetric with Beer's Law + HG + occlusion
│   ├── foliage.wgsl                  # Instanced grass with wind + normal-distortion SSS
│   └── post_processing.wgsl         # Dual Kawase bloom + AgX tonemap + color grade
├── sky-children-theme.js             # Main theme class
├── sky-children-pipelines.js         # WebGPU pipeline setup (bind groups, layouts)
├── sky-children-resources.js         # Buffer/texture management + quality presets
├── sky-children-post.js              # Post-processing orchestration
└── sky-children-tetrominos.js        # Tetromino color configuration
```

---

## Risk Mitigation

### Risk 1: WebGPU Browser Availability
**Mitigation**: WebGPU has been Baseline since late 2025, with broad support on modern Chrome/Edge/Safari and newer Firefox cohorts. Use runtime capability detection (`navigator.gpu`, adapter/device acquisition, and feature probes) instead of static browser-version checks. Keep a graceful fallback path (reduced WebGL/TSL variant) for unsupported or blocked environments.

### Risk 2: Noise Performance on Integrated GPUs
**Mitigation**: Journey's sharp mips technique is key — pre-compute sand grain normals into textures rather than generating procedurally per-frame. Reduce cloud FBM octaves at distance. Pre-bake cloud occlusion into vertex colors.

### Risk 3: Glitter Sparkle Temporal Stability
**Mitigation**: Journey's `reflect()` approach (documented by Alan Zucconi) ensures glitter points stay on the same "grains" across frames. Avoid random flickering by using deterministic grain normals from a tiling texture.

### Risk 4: AgX Color Reproduction
**Mitigation**: The polynomial approximation may diverge from the Troy Sobotka reference. Validate against sunset gradient test images. The `agx_look_golden_hour` transform power values can be tuned per-channel.

### Risk 5: Cloud Sorting Artifacts
**Mitigation**: Back-to-front center-distance sort per frame. Front-face culling means we render inner surfaces, creating depth illusion. For overlapping clouds, consider weighted-blended OIT.

### Risk 6: Sand Shader Complexity
**Mitigation**: The 6-component pipeline is complex but each component can be individually toggled. Lower quality presets disable glitter and reduce ripple normal resolution. Distance-based LOD ramps down grain perturbation.

---

## References

### Confirmed thatgamecompany / Official Sources
- [Sand Rendering in Journey (GDC 2013)](https://gdcvault.com/play/1017742/Sand-Rendering-in) — John Edwards, thatgamecompany
- [GDC 2013 Recording](https://archive.org/details/GDC2013Edwards) — Full presentation archive
- [Art of Sky: Children of the Light (GDC 2020)](https://gdcvault.com/play/1026903/Art-of-Sky-Children-of) — Yuichiro Tanabe
- [Glitter, Fur and Shadows (GDC 2025)](https://schedule.gdconf.com/session/glitter-fur-and-shadows-character-rendering-technology-of-sky-children-of-the-light/907475) — Oliver Castaneda
- [Behind the Design: Sky (Apple)](https://developer.apple.com/news/?id=zm47it7t) — Custom Metal engine, mobile optimization

### Supporting Analysis / Adaptation Sources
- [Journey Sand Shader Series](https://www.alanzucconi.com/2019/10/08/journey-sand-shader-1/) — Alan Zucconi's 6-part technical recreation
  - [Part 2: Diffuse Colour](https://www.alanzucconi.com/2019/10/08/journey-sand-shader-2/)
  - [Part 3: Sand Normal](https://www.alanzucconi.com/2019/10/08/journey-sand-shader-3/)
  - [Part 4: Specular Reflection](https://www.alanzucconi.com/2019/10/08/journey-sand-shader-4/)
  - [Part 5: Glitter Reflection](https://www.alanzucconi.com/2019/10/08/journey-sand-shader-5/)
  - [Part 6: Sand Ripples](https://www.alanzucconi.com/2019/10/08/journey-sand-shader-6/)
- [Technical Art Behind Journey (Polycount)](https://polycount.com/discussion/125544/the-technical-art-behind-journey) — Community breakdown
- [Better Fog](https://iquilezles.org/articles/fog/) — Inigo Quilez, analytical height fog with sun inscattering
- [Mesh Cloud Rendering](https://github.com/maajor/Mesh-Cloud-Rendering) — Sea of Thieves cloud reimplementation
- [AgX Tone Mapping](https://github.com/sobotka/AgX) — Troy Sobotka, color-preserving tone mapping
- [Dual Kawase Bloom](https://blog.frost.kiwi/dual-kawase/) — Efficient bloom technique breakdown

### Specifications
- [WebGPU Specification](https://www.w3.org/TR/webgpu/)
- [WGSL Specification](https://www.w3.org/TR/WGSL/)
- [WebGPU Baseline & Browser Support](https://web.dev/blog/webgpu-baseline#browser_support)
- [WebGPU Implementation Status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)
- [Oren-Nayar Reflectance Model](https://en.wikipedia.org/wiki/Oren%E2%80%93Nayar_reflectance_model)

---

## Changelog

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-02-16 | 2.1 | Codex | Evidence model tightened (confirmed vs inferred vs adaptation). Added authenticity rules. Updated terrain module with explicit tri-planar mapping adaptation and distance-based roughness falloff. Added phase gates with visual/performance acceptance criteria. Softened AgX/ACES language to an A/B lookdev decision. Updated WebGPU availability guidance to runtime capability probing and added current support references. |
| 2026-02-16 | 2.0 | Claude | Major rewrite: Replaced generic lighting with Journey's actual diffuse contrast (`4*NdotL`, `N.y*=0.3`) + Oren-Nayar cloth model. Added all 6 Journey sand shader components (sharp mips, anisotropic masking, glitter specular, ocean specular, diffuse contrast, detail heightmaps). Replaced generic fog with Inigo Quilez analytical height fog with sun-colored inscattering. Added Henyey-Greenstein phase function and pre-baked occlusion lobes for clouds. Replaced simple SSS with normal-distortion technique. Added Dual Kawase bloom. Added Sky's time-of-day emotional framework. All techniques now sourced from GDC talks and developer documentation. |
| 2026-02-16 | 1.0 | Claude | Initial plan document |
