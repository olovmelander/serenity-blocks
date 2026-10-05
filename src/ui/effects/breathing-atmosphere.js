/**
 * Breath-led atmospheric scenes, rendered by the intentional WebGL2 breathing
 * holdout (ADR-0008). One fullscreen draw and one shader program serve every
 * technique: switching a practice only updates uniforms and its 3D motif.
 *
 * The scene has no textures, framebuffers, raymarching or flashing light sources.
 * Procedural movement freezes with uMotion = 0; the breathing guide remains live.
 */
export const BREATHING_VISUAL_PROFILES = Object.freeze({
    'deep-relaxation': {
        mode: 0,
        motif: 'orbits',
        particleCount: 280,
        colors: [0x56dbf7, 0x9868f5, 0x75f3b1],
        name: 'Aurora Dreams',
    },
    'box-breathing': {
        mode: 1,
        motif: 'geometry',
        particleCount: 200,
        colors: [0xbb91ff, 0xf2c88a, 0x6bceec],
        name: 'Sacred Geometry',
    },
    'calm-sleep': {
        mode: 2,
        motif: 'orbits',
        particleCount: 180,
        colors: [0x8cbdf1, 0xf6edce, 0x728aca],
        name: 'Moonlit Waters',
    },
    energizing: {
        mode: 3,
        motif: 'solar',
        particleCount: 240,
        colors: [0xffb448, 0xffe5a1, 0xed6b41],
        name: 'Solar Flare',
    },
    coherence: {
        mode: 4,
        motif: 'heart',
        particleCount: 220,
        colors: [0xfa92b5, 0xffd4d3, 0xc95293],
        name: 'Heart Glow',
    },
    triangle: {
        mode: 5,
        motif: 'crystal',
        particleCount: 220,
        colors: [0x85f0ec, 0xefafea, 0xe9e2a2],
        name: 'Crystal Prism',
    },
    'wim-hof': {
        mode: 6,
        motif: 'solar',
        particleCount: 240,
        colors: [0xf37d48, 0xffd494, 0xcf4a46],
        name: 'Volcanic Fire',
    },
    'ocean-breath': {
        mode: 7,
        motif: 'orbits',
        particleCount: 260,
        colors: [0x35c0d9, 0xa1efeb, 0x247bba],
        name: 'Ocean Tide',
    },
    'zen-garden': {
        mode: 8,
        motif: 'geometry',
        particleCount: 160,
        colors: [0xb3c7a1, 0xe3d5b3, 0x87a692],
        name: 'Zen Garden',
    },
    'cosmic-breath': {
        mode: 9,
        motif: 'orbits',
        particleCount: 320,
        colors: [0xaf75ed, 0xeb8ac5, 0x64b3f3],
        name: 'Cosmic Nebula',
    },
    'forest-breath': {
        mode: 10,
        motif: 'orbits',
        particleCount: 220,
        colors: [0x60bb91, 0xc9b280, 0xc1e6aa],
        name: 'Ancient Forest',
    },
    'electric-storm': {
        mode: 11,
        motif: 'geometry',
        particleCount: 240,
        colors: [0x86b9ff, 0xc3a2f5, 0xdde7ff],
        name: 'Electric Storm',
    },
});

export const FULLSCREEN_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.999, 1.0);
}
`;

export const ATMOSPHERE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uBreath;
uniform vec2 uResolution;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uMode;
uniform float uMotion;
uniform float uSession;
uniform float uReveal;
varying vec2 vUv;

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;

float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
        mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), f.x), f.y);
}

// Three bounded octaves. This never expands into a per-fragment marching loop.
float cloud(vec2 p) {
    float n = 0.57 * valueNoise(p);
    p = mat2(1.57, -1.19, 1.19, 1.57) * p + 7.2;
    n += 0.28 * valueNoise(p);
    p = mat2(1.57, -1.19, 1.19, 1.57) * p + 3.8;
    return n + 0.15 * valueNoise(p);
}

float softGlow(vec2 p, vec2 center, vec2 stretch, float strength) {
    vec2 d = (p - center) * stretch;
    return exp(-dot(d, d) * strength);
}

float stroke(float d, float width) {
    float aa = max(fwidth(d), 0.0014);
    return 1.0 - smoothstep(width, width + aa * 1.5, abs(d));
}

mat2 rotate(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat2(c, -s, s, c);
}

// A sparse cell field has fixed star locations. No periodic sparkle flashes.
float stars(vec2 p, float density) {
    vec2 q = p * density;
    vec2 cell = floor(q);
    vec2 pos = vec2(hash21(cell), hash21(cell + 41.0));
    float eligible = step(0.92, hash21(cell + 93.0));
    float dist = length(fract(q) - mix(vec2(0.15), vec2(0.85), pos));
    float size = mix(0.010, 0.027, hash21(cell + 17.0));
    return eligible * exp(-dist * dist / (size * size));
}

vec3 midnight(vec2 p, float brightness) {
    return vec3(0.004, 0.008, 0.020) + uColorA * brightness
        + uColorB * softGlow(p, vec2(-0.52, 0.48), vec2(1.2, 0.8), 3.0) * 0.028;
}

vec3 aurora(vec2 p, float t, float breath) {
    vec3 col = midnight(p, 0.021);
    float sky = smoothstep(-0.48, -0.28, p.y);
    float bend = 0.12 * sin(p.x * 2.4 + t * 0.20)
        + 0.10 * sin(p.x * 5.0 - t * 0.13);
    float curtain = p.y - 0.28 - bend - breath * 0.09;
    float fold = pow(0.5 + 0.5 * sin(p.x * 9.0 + valueNoise(vec2(p.x * 2.0, t * 0.04)) * 5.0), 2.0);
    float ribbon = exp(-abs(curtain) * 6.0) * (0.30 + fold * 0.7);
    float trail = exp(-max(curtain, 0.0) * 2.3) * smoothstep(-0.02, 0.16, curtain);
    // Fine parallel light fibres give the broad curtain a translucent fabric
    // structure. Slow continuous advection avoids glittering/strobe behaviour.
    float fibres = pow(0.5 + 0.5 * sin(p.x * 92.0
        + sin(p.x * 9.0 + t * 0.04) * 2.0 + t * 0.08), 3.0);
    float fibreHeight = exp(-max(curtain, 0.0) * 4.2)
        * smoothstep(-0.05, 0.085, curtain);
    vec3 lights = mix(uColorC, uColorA, smoothstep(-0.14, 0.16, curtain));
    lights = mix(lights, uColorB, smoothstep(0.15, 0.58, curtain));
    col += lights * (ribbon * 0.43 + trail * fold * 0.12
        + fibres * fibreHeight * 0.095) * sky;
    col += uColorB * softGlow(p, vec2(0.58, 0.55), vec2(1.4, 1.0), 4.0) * 0.09;
    col += vec3(0.38, 0.46, 0.64) * stars(p, 18.0) * sky * 0.48;
    float ridge = -0.49 + 0.05 * sin(p.x * 4.1) + 0.065 * sin(p.x * 7.8 + 2.1);
    float silhouette = 1.0 - smoothstep(ridge - 0.004, ridge + 0.004, p.y);
    col = mix(col, vec3(0.003, 0.008, 0.014) + uColorC * 0.008, silhouette * 0.91);
    col += uColorA * exp(-abs(p.y - ridge) * 54.0) * 0.05;
    return col;
}

vec3 sacred(vec2 p, float t, float breath) {
    vec3 col = midnight(p, 0.022);
    float mist = cloud(p * 2.2 + vec2(t * 0.012, -t * 0.018));
    col += mix(uColorA, uColorC, mist) * pow(mist, 3.0) * 0.22;
    vec2 q = rotate(t * 0.025) * p;
    float radius = length(q);
    float angle = atan(q.y, q.x);
    float size = 0.61 + breath * 0.035;
    float polygon = cos(PI / 3.0) / cos(mod(angle + PI / 3.0, TAU / 3.0) - PI / 3.0);
    float triangle = radius - size * polygon;
    float innerTriangle = length(rotate(PI) * q) - size * cos(PI / 3.0)
        / cos(mod(atan(-q.y, -q.x) + PI / 3.0, TAU / 3.0) - PI / 3.0);
    float lines = stroke(triangle, 0.0025) + stroke(innerTriangle, 0.0025);
    float halo = exp(-abs(triangle) * 48.0) + exp(-abs(innerTriangle) * 48.0);
    float petals = 0.0;
    for (int i = 0; i < 6; i++) {
        float a = float(i) * TAU / 6.0;
        vec2 c = vec2(cos(a), sin(a)) * size * 0.48;
        petals += stroke(length(q - c) - size * 0.48, 0.0018);
    }
    col += uColorB * (lines * 0.40 + halo * 0.042 + petals * 0.12);
    col += uColorC * exp(-abs(radius - size * 1.18) * 85.0) * 0.14;
    col += uColorA * stars(p + vec2(2.3), 15.0) * 0.50;
    return col;
}

vec3 moonlit(vec2 p, float t, float breath) {
    vec3 col = midnight(p, 0.024);
    vec2 moon = vec2(0.48, 0.53);
    float moonDistance = length((p - moon) * vec2(1.0, 1.02));
    col += uColorB * (exp(-moonDistance * moonDistance * 15.0) * 0.13
        + (1.0 - smoothstep(0.069, 0.073, moonDistance)) * 0.74);
    float clouds = cloud(p * vec2(2.0, 4.0) + vec2(t * 0.012, 4.0));
    col += uColorC * clouds * 0.035;
    col += vec3(0.4, 0.5, 0.7) * stars(p, 20.0) * smoothstep(-0.24, -0.05, p.y) * 0.45;
    float water = 1.0 - smoothstep(-0.21, -0.19, p.y);
    float depth = max(-p.y - 0.19, 0.0);
    float wave = sin(depth * 48.0 + t * 0.32 + sin(p.x * 8.0 + t * 0.17) * 1.7);
    float broken = pow(max(0.0, wave), 6.0);
    float reflection = exp(-pow((p.x - moon.x) / (0.07 + depth * 0.38), 2.0));
    vec3 sea = vec3(0.004, 0.014, 0.029) + uColorA * 0.035;
    sea += uColorB * reflection * (0.08 + broken * 0.32) * exp(-depth * 0.62);
    sea += uColorA * exp(-abs(wave) * 10.0) * 0.016 * (0.75 + breath * 0.25);
    col = mix(col, sea, water);
    col += uColorB * exp(-abs(p.y + 0.19) * 75.0) * 0.043;
    return col;
}

vec3 solar(vec2 p, float t, float breath) {
    vec2 q = p - vec2(-0.43, 0.16);
    float radius = length(q);
    float angle = atan(q.y, q.x);
    float coronaRadius = 0.35 + breath * 0.045;
    vec3 col = vec3(0.020, 0.006, 0.004) + uColorC * 0.02;
    float broad = exp(-radius * radius * 2.9);
    col += uColorC * broad * 0.15;
    float filaments = pow(0.5 + 0.5 * sin(angle * 14.0 + radius * 13.0 - t * 0.12
        + sin(angle * 5.0 + t * 0.09) * 2.0), 4.0);
    float flare = exp(-abs(radius - coronaRadius) * 9.0) * (0.22 + filaments * 0.46);
    col += mix(uColorA, uColorB, filaments) * flare;
    float turbulence = cloud(q * 7.0 + t * 0.025);
    float disc = 1.0 - smoothstep(coronaRadius - 0.02, coronaRadius + 0.004, radius);
    col += mix(uColorC, uColorA, turbulence) * disc * (0.08 + turbulence * 0.20);
    col += uColorB * exp(-abs(radius - coronaRadius) * 72.0) * 0.39;
    float flow = sin(p.y * 8.0 + sin(p.x * 5.0 - t * 0.07) * 2.0);
    col += uColorA * exp(-abs(flow) * 13.0) * softGlow(p, vec2(0.62, -0.10), vec2(0.7, 1.2), 1.2) * 0.065;
    return col;
}

vec3 rose(vec2 p, float t, float breath) {
    vec3 col = vec3(0.018, 0.005, 0.018);
    vec2 q = rotate(t * 0.020) * (p * vec2(1.0, 1.04));
    float radius = length(q);
    float angle = atan(q.y, q.x);
    float petalRadius = 0.58 + breath * 0.035 + 0.10 * sin(angle * 5.0 + radius * 4.0);
    float outer = exp(-abs(radius - petalRadius) * 11.0);
    float inner = exp(-abs(radius - (0.42 + 0.07 * sin(angle * 5.0 - radius * 3.0))) * 15.0);
    float haze = cloud(p * 2.1 + vec2(t * 0.013, -t * 0.01));
    col += uColorC * softGlow(p, vec2(0.0), vec2(1.0), 1.8) * 0.16;
    col += mix(uColorA, uColorB, 0.5 + sin(angle * 3.0) * 0.5) * (outer * 0.25 + inner * 0.13);
    col += uColorB * softGlow(p, vec2(-0.25, 0.37), vec2(1.3, 1.0), 8.0) * 0.12;
    col += uColorA * haze * haze * 0.060;
    col += uColorB * stars(p + vec2(7.0), 12.0) * 0.22;
    return col;
}

vec3 crystal(vec2 p, float t, float breath) {
    vec3 col = midnight(p, 0.029);
    float prismScale = 0.88 + breath * 0.055;
    vec2 q = rotate(-0.13 + t * 0.018) * p / prismScale;
    float facetA = abs(q.x * 0.86 + q.y * 0.5);
    float facetB = abs(-q.x * 0.86 + q.y * 0.5);
    float facets = exp(-abs(facetA - 0.41) * 54.0) + exp(-abs(facetB - 0.41) * 54.0);
    float border = 1.0 - smoothstep(0.67, 0.78, abs(q.y));
    col += uColorA * facets * border * 0.26;
    col += uColorB * exp(-abs(q.x - q.y * 0.27) * 18.0) * 0.066;
    float sweep = p.y - p.x * 0.42 + 0.28 + sin(t * 0.09) * 0.04;
    vec3 spectrum = mix(uColorA, uColorB, smoothstep(-0.11, 0.03, sweep));
    spectrum = mix(spectrum, uColorC, smoothstep(0.02, 0.14, sweep));
    col += spectrum * exp(-abs(sweep) * 10.0) * 0.30;
    col += mix(uColorB, uColorA, cloud(p * 2.0 + t * 0.012))
        * softGlow(p, vec2(0.35, 0.32), vec2(1.0), 3.5) * 0.10;
    col += uColorC * stars(p + vec2(12.3), 18.0) * 0.33;
    return col;
}

vec3 volcanic(vec2 p, float t, float breath) {
    vec3 col = vec3(0.023, 0.006, 0.008);
    float smoke = cloud(p * vec2(2.2, 3.0) + vec2(t * 0.02, -t * 0.04));
    col += uColorC * smoke * 0.065;
    col += uColorA * softGlow(p, vec2(-0.34, -0.30), vec2(0.7, 1.2), 2.2) * (0.12 + breath * 0.05);
    for (int i = 0; i < 3; i++) {
        float layer = float(i);
        float ridge = -0.26 - layer * 0.16
            + 0.07 * sin(p.x * (3.5 + layer) + layer * 2.1)
            + 0.05 * sin(p.x * (8.0 - layer) - layer * 1.7);
        float land = 1.0 - smoothstep(ridge - 0.002, ridge + 0.008, p.y);
        col = mix(col, vec3(0.018, 0.006, 0.007) + uColorC * (0.012 + layer * 0.007), land * 0.92);
        float molten = exp(-abs(p.y - ridge) * (45.0 + layer * 9.0));
        float flowing = 0.6 + 0.4 * sin(p.x * 14.0 - t * 0.18 + layer * 3.0);
        col += mix(uColorA, uColorB, flowing * 0.7) * molten * (0.14 + breath * 0.11);
    }
    col += uColorB * stars(p + vec2(8.0, -t * 0.004), 12.0) * 0.18;
    return col;
}

vec3 ocean(vec2 p, float t, float breath) {
    vec3 col = vec3(0.003, 0.016, 0.027);
    float waterMist = cloud(p * vec2(2.8, 2.0) + vec2(t * 0.012, -t * 0.014));
    col += mix(uColorC, uColorA, waterMist) * 0.070;
    float surface = 0.34 + sin(p.x * 2.4 + t * 0.10) * 0.08 + breath * 0.025;
    float under = 1.0 - smoothstep(surface - 0.008, surface + 0.006, p.y);
    float wave = sin(p.x * 7.0 + t * 0.2 + p.y * 9.0)
        + 0.6 * sin(p.x * 11.0 - t * 0.17 - p.y * 7.0);
    float caustic = exp(-abs(wave) * 6.0);
    float shafts = pow(0.5 + 0.5 * sin(p.x * 11.0 + p.y * 3.0 + t * 0.05), 8.0);
    float depth = max(surface - p.y, 0.0);
    col += uColorA * caustic * under * exp(-depth * 1.2) * 0.090;
    col += uColorB * shafts * under * exp(-depth * 1.9) * 0.12;
    col += uColorB * exp(-abs(p.y - surface) * 56.0) * 0.28;
    col += uColorA * exp(-abs(p.y - surface) * 11.0) * 0.09;
    col += uColorB * softGlow(p, vec2(-0.57, 0.72), vec2(1.2, 0.9), 4.0) * 0.20;
    return col;
}

vec3 zen(vec2 p, float t, float breath) {
    vec3 col = vec3(0.016, 0.022, 0.020);
    float radius = length((p - vec2(-0.29, -0.15)) * vec2(0.85, 1.4));
    float grain = valueNoise(p * vec2(36.0, 22.0));
    float rake = sin(radius * 34.0 - t * 0.12 - breath * 0.7);
    float contour = exp(-abs(rake) * 7.0);
    col += uColorB * (0.065 + grain * 0.023 + contour * 0.048);
    col += uColorA * softGlow(p, vec2(-0.42, 0.34), vec2(1.0, 0.8), 2.1) * 0.11;
    vec2 stone = (p - vec2(0.51, -0.35)) * vec2(1.0, 1.6);
    float pebble = 1.0 - smoothstep(0.113, 0.126, length(stone));
    col = mix(col, vec3(0.025, 0.038, 0.033) + uColorC * 0.04, pebble);
    col += uColorB * exp(-abs(length(stone) - 0.12) * 64.0) * 0.075;
    // Petals float at the perimeter; no large shape crosses the instructions.
    vec2 petals = p * vec2(4.0, 3.0) + vec2(t * 0.018, -t * 0.009);
    vec2 cell = floor(petals);
    vec2 local = fract(petals) - vec2(0.5);
    local = rotate(hash21(cell) * TAU) * local;
    float petal = exp(-dot(local * vec2(11.0, 25.0), local * vec2(11.0, 25.0)));
    col += mix(uColorB, uColorA, hash21(cell + 31.0)) * petal * step(0.69, hash21(cell)) * 0.22;
    return col;
}

vec3 nebula(vec2 p, float t, float breath) {
    vec2 q = rotate(-0.35) * p;
    q *= 1.0 - breath * 0.025;
    float billow = cloud(q * 2.7 + vec2(t * 0.015, -t * 0.018));
    float dust = cloud(q * 5.1 + vec2(-t * 0.01, t * 0.015) + 9.0);
    float lane = exp(-pow(q.y + sin(q.x * 2.5) * 0.12, 2.0) * 5.0);
    vec3 col = vec3(0.006, 0.005, 0.021);
    vec3 gas = mix(uColorC, uColorA, smoothstep(0.28, 0.75, billow));
    gas = mix(gas, uColorB, smoothstep(0.51, 0.77, dust));
    col += gas * lane * pow(billow, 2.0) * 0.63;
    col *= 1.0 - smoothstep(0.52, 0.78, dust) * lane * 0.40;
    col += uColorC * softGlow(p, vec2(-0.51, 0.37), vec2(1.0), 5.0) * 0.14;
    col += uColorB * softGlow(p, vec2(0.65, -0.28), vec2(1.0), 8.0) * 0.13;
    col += vec3(0.74, 0.72, 0.9) * stars(p, 20.0) * 0.63;
    col += uColorC * stars(p + 17.0, 33.0) * 0.19;
    return col;
}

float conifer(vec2 p, float x, float top, float size) {
    vec2 q = (p - vec2(x, top)) / size;
    float trunk = (1.0 - smoothstep(0.025, 0.042, abs(q.x)))
        * (1.0 - smoothstep(0.0, 0.035, q.y)) * smoothstep(-1.7, -1.65, q.y);
    float tiers = 0.0;
    for (int i = 0; i < 4; i++) {
        float f = float(i);
        float tip = -f * 0.23;
        float lower = tip - 0.55;
        float width = (tip - q.y) * (0.48 + f * 0.035);
        tiers = max(tiers, (1.0 - smoothstep(width - 0.008, width + 0.008, abs(q.x)))
            * smoothstep(lower, lower + 0.025, q.y)
            * (1.0 - smoothstep(tip - 0.016, tip + 0.008, q.y)));
    }
    return max(trunk, tiers);
}

vec3 forest(vec2 p, float t, float breath) {
    vec3 col = vec3(0.005, 0.020, 0.018);
    float mist = cloud(p * vec2(2.0, 4.0) + vec2(t * 0.018, -t * 0.01));
    col += uColorA * mist * 0.13;
    vec2 light = p - vec2(-0.48, 0.85);
    float angle = atan(light.x, -light.y);
    float shafts = pow(0.5 + 0.5 * sin(angle * 33.0 + t * 0.023), 9.0);
    col += uColorC * shafts * exp(-length(light) * 0.75) * (0.17 + breath * 0.045);
    col += uColorB * softGlow(p, vec2(-0.52, 0.64), vec2(1.0), 2.6) * 0.115;
    float farTrees = conifer(p, -0.76, 0.33, 0.62);
    farTrees = max(farTrees, conifer(p, 0.68, 0.48, 0.66));
    farTrees = max(farTrees, conifer(p, -0.43, 0.10, 0.48));
    farTrees = max(farTrees, conifer(p, 0.40, 0.06, 0.46));
    col = mix(col, vec3(0.006, 0.025, 0.022) + uColorA * 0.035, farTrees * 0.76);
    float nearTrees = conifer(p, -1.02, 0.74, 0.93);
    nearTrees = max(nearTrees, conifer(p, 0.98, 0.65, 0.89));
    col = mix(col, vec3(0.003, 0.012, 0.011) + uColorB * 0.010, nearTrees * 0.92);
    float fog = exp(-pow(p.y + 0.48 + sin(p.x * 3.0 + t * 0.03) * 0.03, 2.0) * 14.0);
    col += mix(uColorA, uColorC, 0.3) * fog * (0.035 + mist * 0.045);
    return col;
}

vec3 electric(vec2 p, float t, float breath) {
    vec3 col = midnight(p, 0.034);
    float vapor = cloud(p * 2.8 + vec2(t * 0.009, -t * 0.018));
    col += mix(uColorA, uColorB, vapor) * pow(vapor, 2.0) * 0.18;
    for (int i = 0; i < 3; i++) {
        float f = float(i);
        float path = p.x - (-0.63 + f * 0.66 + 0.065 * sin(p.y * 7.0 + t * 0.12 + f)
            + 0.025 * sin(p.y * 21.0 - t * 0.06 + f * 2.1));
        float window = smoothstep(-0.83, -0.55, p.y) * (1.0 - smoothstep(0.48, 0.79, p.y));
        float wisp = exp(-abs(path) * 32.0) * window;
        float core = exp(-abs(path) * 175.0) * window;
        // Continuous luminous currents, deliberately no strikes/strobe gating.
        col += mix(uColorA, uColorB, f * 0.4) * wisp * (0.12 + breath * 0.03);
        col += uColorC * core * 0.10;
    }
    col += uColorB * softGlow(p, vec2(0.50, 0.42), vec2(1.0), 6.0) * 0.12;
    col += uColorC * stars(p + vec2(17.0), 16.0) * 0.29;
    return col;
}

void main() {
    float aspect = max(uResolution.x, 1.0) / max(uResolution.y, 1.0);
    vec2 p = (vUv - 0.5) * 2.0;
    // Retain balanced framing in portrait and ultrawide viewports.
    p.x *= clamp(aspect, 0.72, 1.65);
    float breath = clamp(uBreath, 0.0, 1.0);
    float retention = 1.0 - smoothstep(0.0, 0.45, abs(uSession - 3.0));
    float integration = smoothstep(4.0, 5.0, uSession);
    float t = uTime * clamp(uMotion, 0.0, 1.0) * mix(1.0, 0.25, retention);
    vec3 col;
    if (uMode < 0.5) col = aurora(p, t, breath);
    else if (uMode < 1.5) col = sacred(p, t, breath);
    else if (uMode < 2.5) col = moonlit(p, t, breath);
    else if (uMode < 3.5) col = solar(p, t, breath);
    else if (uMode < 4.5) col = rose(p, t, breath);
    else if (uMode < 5.5) col = crystal(p, t, breath);
    else if (uMode < 6.5) col = volcanic(p, t, breath);
    else if (uMode < 7.5) col = ocean(p, t, breath);
    else if (uMode < 8.5) col = zen(p, t, breath);
    else if (uMode < 9.5) col = nebula(p, t, breath);
    else if (uMode < 10.5) col = forest(p, t, breath);
    else col = electric(p, t, breath);

    // Ambient breathing changes radiance gently, never a flash at a phase edge.
    col *= 0.93 + breath * 0.14;
    col += mix(uColorA, uColorB, 0.35) * softGlow(p, vec2(0.0), vec2(0.85, 1.1), 2.0)
        * (retention * 0.018 + integration * 0.022);

    // Keep the central text/3D focal motif legible while the perimeter stays rich.
    float focus = exp(-dot(p * vec2(1.0, 1.25), p * vec2(1.0, 1.25)) * 10.0);
    col *= 1.0 - focus * 0.37;
    vec2 ellipse = (vUv - 0.5) * vec2(1.82, 1.78);
    float feather = 1.0 - smoothstep(0.70, 1.05, length(ellipse));
    // An ellipse alone leaves its cardinal points visible on the canvas border.
    // Fade every viewport edge as well so no rectangular crop can read as a panel.
    float viewportEdge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float borderFade = smoothstep(0.0, 0.12, viewportEdge);
    float alpha = feather * borderFade * 0.92 * clamp(uReveal, 0.0, 1.0);
    gl_FragColor = vec4(max(col, vec3(0.0)), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <premultiplied_alpha_fragment>
}
`;
