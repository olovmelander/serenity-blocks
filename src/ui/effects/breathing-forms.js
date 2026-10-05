/**
 * Foreground identities for the twelve breathing practices.
 *
 * Each practice owns its silhouette and its breathing motion. This deliberately
 * has no shared circular aperture, phase ring, rotating wireframe or bloom pass.
 * Analytic distances keep the outlines crisp at every mobile render tier.
 * Backend: the explicit, retained WebGL2 breathing holdout in ADR-0008.
 */
export const BREATHING_FORM_FRAGMENT = /* glsl */ `
precision highp float;
uniform float uMode, uBreath, uMotion, uTime, uPhaseProgress, uPhase;
uniform float uSession, uReveal;
uniform vec2 uResolution;
uniform vec3 uColorA, uColorB, uColorC;
varying vec2 vUv;

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

mat2 turn(float angle) {
    float c = cos(angle), s = sin(angle);
    return mat2(c, -s, s, c);
}

// The core is antialiased separately from its broad, restrained analytic glow.
float ink(float distance, float width, float halo) {
    float aa = max(fwidth(distance), 0.0012);
    float core = 1.0 - smoothstep(width, width + aa * 1.5, abs(distance));
    return core * 0.93 + exp(-abs(distance) / max(halo, 0.001)) * 0.29;
}

float segment(vec2 p, vec2 a, vec2 b) {
    vec2 v = b - a;
    return length(p - a - v * clamp(dot(p - a, v) / max(dot(v, v), 0.00001), 0.0, 1.0));
}

vec4 light(vec3 color, float amount) {
    return vec4(color * amount, amount);
}

float verticalWindow(float y, float bottom, float top) {
    return smoothstep(bottom, bottom + 0.10, y) * (1.0 - smoothstep(top - 0.10, top, y));
}

vec4 auroraRibbons(vec2 p, float t, float breath) {
    vec4 form = vec4(0.0);
    for (int i = 0; i < 4; i++) {
        float f = float(i);
        float side = i < 2 ? -1.0 : 1.0;
        float offset = (i == 0 || i == 3) ? 0.73 : 0.45;
        float sway = sin(p.y * 3.4 + t * 0.15 + f * 1.2) * 0.065
            + sin(p.y * 7.0 - t * 0.08 + f) * 0.025;
        float path = p.x - side * (offset + breath * 0.095) - sway;
        float lengthMask = verticalWindow(p.y, -0.79 + f * 0.028, 0.83 + breath * 0.13);
        float silk = ink(path, 0.011 + breath * 0.005, 0.046);
        float fabric = exp(-path * path / 0.012) * 0.10;
        float fibre = 0.72 + 0.28 * sin(path * 190.0 + p.y * 8.0 + t * 0.08);
        vec3 color = mix(uColorC, uColorA, smoothstep(-0.72, 0.25, p.y));
        color = mix(color, uColorB, smoothstep(0.25, 0.83, p.y));
        form += light(color, (silk * 0.83 + fabric) * fibre * lengthMask);
    }
    return form;
}

vec4 squarePractice(vec2 p, float t, float breath) {
    float side = 0.47 + breath * 0.12;
    vec2 q = abs(p) - side;
    float distance = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float perimeter;
    if (p.y >= abs(p.x)) perimeter = (p.x + side) / (8.0 * side);
    else if (p.x >= abs(p.y)) perimeter = 0.25 + (side - p.y) / (8.0 * side);
    else if (-p.y >= abs(p.x)) perimeter = 0.5 + (side - p.x) / (8.0 * side);
    else perimeter = 0.75 + (p.y + side) / (8.0 * side);
    perimeter = clamp(perimeter, 0.0, 1.0);
    float progress = clamp((uPhase + uPhaseProgress) * 0.25, 0.0, 1.0);
    float completed = 1.0 - smoothstep(progress - 0.009, progress + 0.009, perimeter);
    float leading = exp(-pow((perimeter - progress) / 0.014, 2.0));
    vec3 color = mix(uColorA, uColorC, smoothstep(0.0, 1.0, perimeter));
    vec4 form = light(color, ink(distance, 0.007, 0.023) * (0.30 + completed * 0.73));
    form += light(uColorB, ink(distance, 0.009, 0.036) * leading * 0.88);
    // Four separate inset edge strokes reinforce the square, with open corners.
    float inner = side - 0.044;
    float trim = min(segment(p, vec2(-inner + 0.11, inner), vec2(inner - 0.11, inner)),
        segment(p, vec2(inner, inner - 0.11), vec2(inner, -inner + 0.11)));
    trim = min(trim, segment(p, vec2(inner - 0.11, -inner), vec2(-inner + 0.11, -inner)));
    trim = min(trim, segment(p, vec2(-inner, -inner + 0.11), vec2(-inner, inner - 0.11)));
    form += light(uColorB, ink(trim, 0.0015, 0.008) * 0.15);
    return form;
}

vec4 moonAndTides(vec2 p, float t, float breath) {
    vec2 q = p - vec2(-0.35, 0.37 + breath * 0.025);
    float radius = 0.30 + breath * 0.028;
    float outer = length(q) - radius;
    float inner = length(q - vec2(0.13, 0.061)) - radius * 0.94;
    float aa = max(fwidth(outer), 0.002);
    float crescent = (1.0 - smoothstep(-aa, aa, outer)) * smoothstep(-aa, aa, inner);
    float crescentGlow = exp(-max(outer, 0.0) / 0.025) * smoothstep(-0.035, 0.035, inner);
    vec4 form = light(mix(uColorA, uColorB, 0.79), crescent * 0.92 + crescentGlow * 0.14);
    for (int i = 0; i < 3; i++) {
        float f = float(i);
        float tide = -0.38 - f * 0.125 + breath * 0.055
            + sin(p.x * (2.4 + f * 0.5) + t * 0.12 + f) * (0.032 + f * 0.006);
        float edge = ink(p.y - tide, 0.0025, 0.015);
        float end = 1.0 - smoothstep(0.75, 1.0, abs(p.x));
        float reflection = exp(-pow((p.x + 0.35) / (0.12 + f * 0.08), 2.0));
        form += light(mix(uColorA, uColorB, reflection), edge * end * (0.30 + reflection * 0.33));
    }
    return form;
}

vec4 sunRays(vec2 p, float t, float breath) {
    float radius = length(p);
    float angle = atan(p.y, p.x);
    float core = 0.40 + breath * 0.055;
    float rayAngle = TAU / 18.0;
    float sector = floor((angle + PI) / rayAngle);
    float rayDistance = abs(sin(mod(angle + rayAngle * 0.5, rayAngle) - rayAngle * 0.5)) * radius;
    float end = 0.67 + breath * 0.23 + 0.08 * sin(sector * 2.4);
    float rays = ink(rayDistance, 0.004, 0.018)
        * smoothstep(core + 0.045, core + 0.080, radius)
        * (1.0 - smoothstep(end - 0.04, end, radius));
    float filaments = sin(angle * 12.0 + t * 0.07) * 0.012;
    float corona = ink(radius - core - filaments, 0.008, 0.042);
    vec4 form = light(mix(uColorA, uColorB, 0.65), rays * 0.95);
    form += light(uColorA, corona * 0.76);
    form += light(uColorC, exp(-abs(radius - core - 0.025) * 18.0)
        * smoothstep(core - 0.010, core + 0.035, radius) * 0.10);
    return form;
}

vec4 openingFlower(vec2 p, float t, float breath) {
    vec4 form = vec4(0.0);
    float center = 0.47 + breath * 0.095;
    float petalLength = 0.23 + breath * 0.045;
    float petalWidth = 0.105 + breath * 0.061;
    for (int i = 0; i < 6; i++) {
        float f = float(i);
        float angle = f * TAU / 6.0 + PI / 6.0 + sin(t * 0.06) * 0.018;
        vec2 q = turn(angle) * p - vec2(center, 0.0);
        float shape = (length(q / vec2(petalLength, petalWidth)) - 1.0) * petalWidth;
        vec3 color = mix(uColorA, uColorB, f / 6.0);
        form += light(color, ink(shape, 0.0055, 0.023) * 0.78);
        float fold = segment(q, vec2(-petalLength + 0.075, 0.0), vec2(petalLength - 0.050, 0.0));
        form += light(uColorB, ink(fold, 0.001, 0.008) * 0.17);
    }
    // A second, turned whorl unfolds between the six main petals.
    float a = atan(p.y, p.x), r = length(p);
    float whorl = 0.37 + breath * 0.074 + cos(a * 6.0 + PI) * (0.055 + breath * 0.04);
    form += light(uColorC, ink(r - whorl, 0.0035, 0.014) * 0.43);
    return form;
}

vec4 triangularPrism(vec2 p, float t, float breath) {
    float size = 0.88 + breath * 0.19;
    vec2 q = p / size;
    vec2 top = vec2(0.0, 0.73), left = vec2(-0.65, -0.42), right = vec2(0.65, -0.42);
    float leftEdge = segment(q, top, left);
    float rightEdge = segment(q, top, right);
    float base = segment(q, left, right);
    vec4 form = light(uColorA, ink(leftEdge, 0.0055, 0.022) * 0.88);
    form += light(uColorB, ink(rightEdge, 0.0055, 0.022) * 0.88);
    form += light(uColorC, ink(base, 0.0055, 0.022) * 0.88);
    float inset = min(segment(q, top * 0.89, left * 0.89), segment(q, top * 0.89, right * 0.89));
    inset = min(inset, segment(q, left * 0.89, right * 0.89));
    form += light(mix(uColorA, uColorB, 0.5), ink(inset, 0.001, 0.007) * 0.16);
    // Refraction emerges as three long, diverging beams from the right facet.
    for (int i = 0; i < 3; i++) {
        float f = float(i);
        vec2 start = vec2(0.47, -0.10);
        vec2 end = vec2(0.95, -0.03 - f * 0.13 - breath * 0.045);
        vec3 color = i == 0 ? uColorA : (i == 1 ? uColorB : uColorC);
        form += light(color, ink(segment(q, start, end), 0.002, 0.012) * 0.35);
    }
    return form;
}

vec4 flameColumn(vec2 p, float t, float breath) {
    float height = 1.29 + breath * 0.29;
    float y = (p.y + 0.64) / height;
    float shapeY = clamp(y, 0.0, 1.0);
    float width = 0.63 * sqrt(shapeY) * pow(max(1.0 - shapeY, 0.0), 0.76);
    float drift = sin(p.y * 5.4 - t * 0.23) * 0.048 * shapeY
        + sin(p.y * 11.0 + t * 0.12) * 0.019 * shapeY;
    float distance = abs(p.x - drift) - width;
    float window = smoothstep(0.0, 0.035, y) * (1.0 - smoothstep(0.95, 1.0, y));
    vec3 fire = mix(uColorA, uColorB, smoothstep(0.0, 0.86, y));
    vec4 form = light(fire, ink(distance, 0.017, 0.041) * window * 0.96);
    float ember = segment(p, vec2(-0.28, -0.66), vec2(0.28, -0.66));
    form += light(uColorC, ink(ember, 0.003, 0.023) * 0.36);
    // Nested fire tongues have different curvatures, rather than concentric rings.
    float inner = abs(p.x + drift * 0.6) - width * (0.59 + sin(p.y * 4.0 + t * 0.10) * 0.05);
    form += light(uColorA, ink(inner, 0.008, 0.021) * window * 0.47);
    form += light(uColorC, exp(-distance * distance / 0.010) * window * 0.10);
    return form;
}

vec4 tideCrests(vec2 p, float t, float breath) {
    vec4 form = vec4(0.0);
    for (int i = 0; i < 4; i++) {
        float f = float(i);
        float base = i == 0 ? 0.39 : -0.25 - (f - 1.0) * 0.18;
        float wave = base + sin(p.x * (2.65 + f * 0.36) + t * (0.12 + f * 0.015) + f * 0.85)
            * (0.073 + breath * 0.071) + breath * 0.05;
        float d = p.y - wave;
        float end = 1.0 - smoothstep(0.78, 1.04, abs(p.x));
        float foam = 0.68 + 0.32 * pow(0.5 + 0.5 * sin(p.x * 29.0 + t * 0.08 + f), 2.0);
        float body = exp(-max(-d, 0.0) * 28.0) * (1.0 - smoothstep(-0.018, 0.0, d)) * 0.17;
        form += light(mix(uColorA, uColorB, 0.38 + f * 0.13),
            (ink(d, 0.006, 0.021) * foam * 0.83 + body) * end);
    }
    return form;
}

vec4 brushAndStone(vec2 p, float t, float breath) {
    vec2 q = p - vec2(-0.06, 0.055);
    float a = atan(q.y, q.x), r = length(q);
    float radius = 0.57 + breath * 0.028 + sin(a * 3.0 + 0.7) * 0.028;
    float width = 0.033 + (0.5 + 0.5 * sin(a + 0.6)) * 0.024;
    float gapAngle = abs(mod(a + PI * 0.25 + PI, TAU) - PI);
    float opening = smoothstep(0.17, 0.36, gapAngle);
    float brush = 0.72 + 0.28 * sin(a * 48.0 + r * 104.0);
    vec4 form = light(mix(uColorA, uColorB, 0.32), ink(r - radius, width, 0.018) * opening * brush * 0.84);
    vec2 stone = (p - vec2(0.53, -0.49)) / vec2(0.17 + breath * 0.007, 0.094);
    float pebble = length(stone) - 1.0;
    form += light(uColorC, ink(pebble * 0.094, 0.006, 0.009) * 0.65);
    form += light(uColorB, (1.0 - smoothstep(-0.05, 0.0, pebble)) * 0.08);
    float sand = sin(p.y * 36.0 + pow(p.x + 0.04, 2.0) * 3.6);
    float sandWindow = verticalWindow(p.y, -0.95, -0.68) * (1.0 - smoothstep(0.73, 0.96, abs(p.x)));
    form += light(uColorB, exp(-abs(sand) * 12.0) * sandWindow * 0.25);
    return form;
}

vec4 spiralArms(vec2 p, float t, float breath) {
    vec2 q = p * vec2(1.0, 1.16);
    float radius = length(q), angle = atan(q.y, q.x);
    float winding = angle - log(radius + 0.075) * (1.62 + breath * 0.15) + t * 0.025;
    float arms = abs(fract(winding * 3.0 / TAU + 0.5) - 0.5) * TAU / 3.0 * radius;
    float window = smoothstep(0.285, 0.39, radius) * (1.0 - smoothstep(0.79 + breath * 0.05, 1.01, radius));
    float tail = ink(arms, 0.006, 0.040) * window;
    vec3 gas = mix(uColorA, uColorC, 0.5 + 0.5 * sin(winding + radius * 3.0));
    vec4 form = light(gas, tail * 0.88);
    float parallel = abs(fract((winding + 0.12) * 3.0 / TAU + 0.5) - 0.5) * TAU / 3.0 * radius;
    form += light(uColorB, ink(parallel, 0.0017, 0.012) * window * 0.34);
    float haze = exp(-arms * arms / 0.025) * window;
    form += light(gas, haze * 0.095);
    return form;
}

float leaf(vec2 p, vec2 center, float angle, float size) {
    vec2 q = turn(angle) * (p - center);
    float shape = (length(q / vec2(size, size * 0.43)) - 1.0) * size * 0.43;
    return ink(shape, 0.003, 0.008) * 0.72
        + (1.0 - smoothstep(-0.015, 0.002, shape)) * 0.10;
}

vec4 branchingTree(vec2 p, float t, float breath) {
    vec2 q = p / (0.88 + breath * 0.15);
    float trunk = segment(q, vec2(0.0, -0.73), vec2(0.0, -0.12));
    vec4 form = light(mix(uColorA, uColorB, 0.65), ink(trunk, 0.012, 0.025) * 0.87);
    float branches = 0.0, leaves = 0.0;
    for (int i = 0; i < 2; i++) {
        float s = i == 0 ? -1.0 : 1.0;
        vec2 joint = vec2(s * 0.31, 0.25);
        vec2 upper = vec2(s * 0.19, 0.75);
        vec2 outer = vec2(s * 0.60, 0.59);
        vec2 side = vec2(s * 0.61, 0.16);
        float branch = min(segment(q, vec2(0.0, -0.13), joint), segment(q, joint, upper));
        branch = min(branch, segment(q, joint, outer));
        branch = min(branch, segment(q, vec2(s * 0.18, 0.08), side));
        branch = min(branch, segment(q, vec2(0.0, -0.36), vec2(s * 0.46, -0.20)));
        branch = min(branch, segment(q, outer * 0.78, vec2(s * 0.76, 0.44)));
        branches += ink(branch, 0.0065, 0.016);
        float size = 0.075 + breath * 0.027;
        float sway = sin(t * 0.10 + s) * 0.055;
        leaves += leaf(q, upper + vec2(0.0, 0.023), s * 1.0 + sway, size);
        leaves += leaf(q, outer + vec2(s * 0.017, 0.018), s * 0.67 + sway, size);
        leaves += leaf(q, side + vec2(s * 0.026, 0.015), s * 0.38 + sway, size);
        leaves += leaf(q, vec2(s * 0.48, -0.19), s * 0.15 + sway, size * 0.86);
        leaves += leaf(q, vec2(s * 0.77, 0.44), s * 0.46 + sway, size * 0.91);
    }
    form += light(uColorA, branches * (0.63 + breath * 0.11));
    form += light(uColorC, leaves * 0.96);
    return form;
}

vec4 forkedCurrents(vec2 p, float t, float breath) {
    vec4 form = vec4(0.0);
    for (int i = 0; i < 2; i++) {
        float side = i == 0 ? -1.0 : 1.0;
        float spread = 1.0 + breath * 0.14;
        vec2 q = p / vec2(spread, 1.0);
        vec2 a = vec2(side * 0.60, 0.83), b = vec2(side * 0.43, 0.41);
        vec2 c = vec2(side * 0.67, 0.15), d = vec2(side * 0.45, -0.18);
        vec2 e = vec2(side * 0.73, -0.78);
        float bolt = min(segment(q, a, b), segment(q, b, c));
        bolt = min(bolt, segment(q, c, d));
        bolt = min(bolt, segment(q, d, e));
        float forks = min(segment(q, b, vec2(side * 0.16, 0.60)),
            segment(q, vec2(side * 0.16, 0.60), vec2(side * 0.22, 0.88)));
        forks = min(forks, segment(q, c, vec2(side * 0.94, -0.035)));
        forks = min(forks, segment(q, d, vec2(side * 0.24, -0.42)));
        // Travel is a broad, continuously moving highlight along a lit current.
        // There is no switched-on strike or whole-image exposure pulse.
        float travel = 0.59 + 0.41 * pow(0.5 + 0.5 * sin(q.y * 3.2 - t * 0.25 + float(i) * 2.1), 4.0);
        form += light(i == 0 ? uColorA : uColorB, ink(bolt, 0.005 + breath * 0.002, 0.025) * travel);
        form += light(uColorC, ink(forks, 0.0027, 0.013) * travel * 0.63);
    }
    return form;
}

void main() {
    vec2 resolution = max(uResolution, vec2(1.0));
    vec2 p = (vUv - 0.5) * 2.0 * resolution / min(resolution.x, resolution.y);
    float breath = clamp(uBreath, 0.0, 1.0);
    float retention = 1.0 - smoothstep(0.0, 0.45, abs(uSession - 3.0));
    float t = uTime * clamp(uMotion, 0.0, 1.0) * mix(1.0, 0.20, retention);
    vec4 form;
    if (uMode < 0.5) form = auroraRibbons(p, t, breath);
    else if (uMode < 1.5) form = squarePractice(p, t, breath);
    else if (uMode < 2.5) form = moonAndTides(p, t, breath);
    else if (uMode < 3.5) form = sunRays(p, t, breath);
    else if (uMode < 4.5) form = openingFlower(p, t, breath);
    else if (uMode < 5.5) form = triangularPrism(p, t, breath);
    else if (uMode < 6.5) form = flameColumn(p, t, breath);
    else if (uMode < 7.5) form = tideCrests(p, t, breath);
    else if (uMode < 8.5) form = brushAndStone(p, t, breath);
    else if (uMode < 9.5) form = spiralArms(p, t, breath);
    else if (uMode < 10.5) form = branchingTree(p, t, breath);
    else form = forkedCurrents(p, t, breath);

    // Small central negative space protects the live instruction/countdown.
    // Each identity has its own outline; this mask introduces no visible ring.
    float quietCenter = smoothstep(0.19, 0.37, length(p * vec2(0.95, 1.55)));
    float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float visibility = smoothstep(0.0, 0.055, edge) * (0.10 + quietCenter * 0.90);
    float alpha = (1.0 - exp(-form.a * 1.80)) * visibility * clamp(uReveal, 0.0, 1.0);
    vec3 color = form.rgb / max(form.a, 0.0001);
    color = mix(color, vec3(1.0), 0.12) * (1.04 + min(form.a, 2.0) * 0.18);
    gl_FragColor = vec4(max(color, vec3(0.0)), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <premultiplied_alpha_fragment>
}
`;
