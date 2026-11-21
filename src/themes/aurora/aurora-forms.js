/**
 * The display's rarer forms: light that is not a curtain hanging along an arc.
 *
 *   the crown    rays fanning out of one point of the sky, as a corona does when an arc stands
 *                straight overhead and its rays run up the field lines to the magnetic zenith.
 *                Here that point is brought down to the top of the board, so the rays stream out
 *                from behind it on every side: lavender over the storm's own hue in a breakup
 *                and a fever, gold in a perfect clear.
 *   the curl     a curtain wound into a spiral: the end of a fold that has rolled up on itself.
 *                Its footprint is a spiral lying flat overhead (so it is seen squashed), and
 *                the curtain's rays stand on it, one after another along the arm. A twist winds
 *                one up beside the board.
 *   the pillars  columns of light standing over the far shore, as ice crystals in still air
 *                stand a light up into a pillar. A level raises a row of them.
 *
 * All three are closed forms of the view direction, added to the curtain buffer after the
 * march (aurora-curtains.js), so the sky dome and the lake's mirror read them like any other
 * part of the display. Each is behind a branch on its own gain: a quiet sky pays one compare.
 *
 * Everything they read is one table of vec4 rows (FORMS in aurora-field.js; the director
 * writes it as plain numbers): a stage may bind only twelve uniform buffers and the march
 * already holds six arrays.
 */
import * as THREE from 'three/webgpu';
import {
    If, Loop, abs, atan, clamp, cos, cross, dot, exp, float, int, length, max, mix, normalize, sin, smoothstep, texture,
    uniformArray, vec2, vec3,
} from 'three/tsl';
import { CURL, FORMS, PILLARS } from './aurora-field.js';
import { AURORA_COLORS } from './aurora-palette.js';

const triple = (rgb) => vec3(rgb[0], rgb[1], rgb[2]);

/** The forms' table as a uniform array (the world copies the director's rows into it). */
export function createFormTable() {
    return uniformArray(Array.from({ length: FORMS.rows }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4');
}

/** The crimson echo of a back-to-back. Two detached arcs spread above the ridges,
 * the upper, softer band catching up to its pink lower hem. */
export function addRedArcs(light, rd, forms, noiseTexture) {
    const arc = forms.element(FORMS.redArc).toVar();
    If(arc.w.greaterThan(0.002), () => {
        const x = atan(rd.x, rd.z.negate()).sub(arc.x).toVar();
        const travel = arc.z.sub(abs(x).mul(0.8)).toVar();
        const fringe = texture(noiseTexture, vec2(x.mul(0.9), arc.z.mul(0.018).add(0.47))).level(1).toVar();
        const edge = arc.y.add(cos(x.mul(3.2)).mul(0.046)).add(x.mul(0.085))
            .add(sin(x.mul(7.1).sub(arc.z.mul(0.3))).mul(0.012));
        const height = rd.y.sub(edge).toVar();
        const upper = height.sub(0.05).sub(fringe.g.mul(0.012)).mul(42).toVar();
        const lower = height.mul(91).toVar();
        const reach = exp(x.mul(x).mul(-1.6)).mul(arc.w);
        const red = exp(upper.mul(upper).negate()).mul(smoothstep(0.18, 0.68, travel));
        const pink = exp(lower.mul(lower).negate()).mul(smoothstep(0.02, 0.40, travel));
        light.addAssign(vec3(0.64, 0.032, 0.086).mul(red)
            .add(vec3(0.85, 0.07, 0.29).mul(pink)).mul(fringe.b.mul(0.55).add(0.45))
            .mul(reach));
    });
}

/**
 * The crown's light along `rd`, added to `light`. Rays are a noise tile read round the centre
 * (a whole number of tiles a turn, so the pattern closes on itself): broad bundles of them,
 * each running its own length, over a soft glow, the light streaming out along them.
 */
export function addCrown(light, rd, forms, noiseTexture, tau) {
    const crown = forms.element(FORMS.crown).toVar();
    If(crown.x.greaterThan(0.002), () => {
        const centre = forms.element(FORMS.crown + 1).xyz;
        const depth = dot(rd, centre).toVar();
        If(depth.greaterThan(0.25), () => {
            const p = vec2(dot(rd, forms.element(FORMS.crown + 2).xyz), dot(rd, forms.element(FORMS.crown + 3).xyz))
                .div(depth).toVar();
            const r = length(p).toVar();
            const turn = atan(p.y, p.x).div(Math.PI * 2).toVar();
            const broad = texture(noiseTexture, vec2(turn, r.mul(0.05).add(tau.mul(0.003)))).level(0).toVar();
            const fine = texture(noiseTexture, vec2(turn.mul(4).add(0.37), r.mul(0.09).sub(tau.mul(0.004)).add(0.61)))
                .level(0).toVar();
            const bundles = smoothstep(0.31, 0.79, broad.g).toVar();
            // Where the rays meet they are one light: the pattern only opens out along them, so the
            // hub is a soft glow and never a wheel of dark spokes. It stands behind the board, whose
            // dark field shows a little of the sky through it, so the hub itself is kept dim (`hub`
            // below): the light is in the rays round the board, never a wash over the play.
            const rays = mix(
                float(0.62),
                mix(0.14, 1.13, smoothstep(0.35, 0.70, fine.r)).mul(mix(0.05, 1.26, bundles)),
                smoothstep(0.03, 0.34, r),
            );
            // Each bundle runs its own length; the light streams out along it.
            const reach = crown.y.mul(mix(0.4, 1.55, broad.b)).toVar();
            const body = exp(r.div(reach).negate()).mul(smoothstep(0.0, 0.2, r).mul(0.45).add(0.55));
            const stream = sin(r.mul(17).sub(crown.w).add(fine.g.mul(6.283))).mul(0.22).add(1);
            const along = clamp(r.div(reach.mul(1.7)), 0, 1).toVar();
            const gold = crown.z;
            const inner = mix(vec3(0.74, 0.8, 1.0), vec3(1.0, 0.9, 0.56), gold);
            const tips = mix(triple(AURORA_COLORS.crown), vec3(1.0, 0.2, 0.1), gold);
            const tint = forms.element(FORMS.crown + 4).rgb;
            const colour = mix(mix(inner, tint, smoothstep(0.02, 0.38, along)), tips, smoothstep(0.5, 1, along));
            // A soft glow under the rays, so the crown is light and not a drawing of lines.
            const glow = exp(r.div(crown.y.mul(0.75)).negate()).mul(0.14);
            const hub = smoothstep(0.03, 0.3, r).mul(0.86).add(0.14);
            light.addAssign(colour.mul(rays.mul(body).mul(stream).add(glow).mul(hub)
                .mul(crown.x)));
        });
    });
}

/**
 * The curls' light along `rd`: CURL.rays rays standing on each curl's footprint. A ray is a
 * narrow column over its foot with a sharp hem and a long fade upward, mint at the hem,
 * violet up its body and blue at the top; where the arm winds tight the rays crowd into the
 * bright eye of the curl.
 */
export function addCurls(light, rd, forms) {
    for (let slot = 0; slot < CURL.slots; slot += 1) {
        const base = FORMS.curls + slot * FORMS.curlRows;
        const head = forms.element(base).toVar();
        If(head.w.greaterThan(0.002), () => {
            const axis = head.xyz;
            const depth = dot(rd, axis).toVar();
            If(depth.greaterThan(0.4), () => {
                const look = forms.element(base + 1).toVar();
                const right = normalize(vec3(axis.z.negate(), 0, axis.x)).toVar();
                const p = vec2(dot(rd, right), dot(rd, cross(right, axis))).div(depth).toVar();
                // Nothing of a curl lies further out than its reach.
                If(length(p.mul(vec2(1, 0.7))).lessThan(look.y), () => {
                    const sum = vec3(0).toVar();
                    Loop({
                        start: int(0), end: int(CURL.rays), type: 'int', condition: '<',
                    }, ({ i }) => {
                        const ray = forms.element(i.add(base + 2)).toVar();
                        const across = p.x.sub(ray.x).mul(look.x).toVar();
                        const climb = p.y.sub(ray.y).mul(ray.w).toVar();
                        const k = clamp(climb, 0, 5).toVar();
                        const column = exp(across.mul(across).negate());
                        const profile = smoothstep(-0.07, 0.04, climb).mul(exp(k.mul(-1.5)));
                        const colour = mix(
                            mix(vec3(0.55, 1.0, 0.8), vec3(0.62, 0.36, 1.0), smoothstep(0.0, 0.4, k)),
                            vec3(0.26, 0.2, 1.0),
                            smoothstep(0.7, 2.2, k),
                        );
                        sum.addAssign(colour.mul(column.mul(profile).mul(ray.z)));
                    });
                    light.addAssign(sum.mul(head.w));
                });
            });
        });
    }
}

/**
 * The pillars' light along `rd`: a narrow column over each bearing with a faint halo round
 * it, brightest at its foot, running up to its own height with a soft top, shimmering as the
 * crystals turn.
 */
export function addPillars(light, rd, forms, noiseTexture, tau) {
    If(forms.element(FORMS.crown + 1).w.greaterThan(0.002), () => {
        const azimuth = atan(rd.x, rd.z.negate()).toVar();
        const tangent = rd.y.div(max(length(rd.xz), 1e-3)).toVar();
        const shimmer = texture(noiseTexture, vec2(azimuth.mul(2.3), tangent.mul(0.9).sub(tau.mul(0.008)))).level(0).g
            .mul(0.5).add(0.75);
        const sum = vec3(0).toVar();
        Loop({
            start: int(0), end: int(PILLARS.slots), type: 'int', condition: '<',
        }, ({ i }) => {
            const row = forms.element(i.mul(2).add(FORMS.pillars)).toVar();
            const offset = azimuth.sub(row.x).mul(row.y).toVar();
            const near = offset.mul(offset).toVar();
            const column = exp(near.negate()).add(exp(near.mul(-0.09)).mul(0.22));
            const k = clamp(tangent.div(max(row.z, 1e-3)), 0, 1).toVar();
            const profile = smoothstep(0.5, 1, k).oneMinus().mul(mix(1, 0.4, k));
            sum.addAssign(forms.element(i.mul(2).add(FORMS.pillars + 1)).rgb.mul(column.mul(profile).mul(row.w)));
        });
        light.addAssign(sum.mul(shimmer));
    });
}
