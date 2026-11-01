/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview THE JOURNEY IN THE SKY, drawn (2026-11-01). The plan, the light of each star and
 * the drawing's clock live in odyssey-journey-constellation.js; this draws them.
 *
 *   Stars  one point of light per orb, at infinity in the city's stage frame (they keep their place
 *          on the sky as the eye moves), never under a pixel (what the clamp adds in area is paid
 *          back in light, as the galaxy's suns do), a cross of light on a three-star orb, and a
 *          short flare as the line reaches each one.
 *   Line   the orbs joined in journey order: a thin screen-space line, the chapter's colour along
 *          it, as bright as the dimmer of its two ends, drawing itself from the first orb to the
 *          last (`drawn`).
 *
 * Both are premultiplied added light with alpha 0 (the target's alpha is left alone), depth-tested
 * at the far end of the city, so the towers stand in front of them.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, exp, float,
    length, materialOpacity, max, min, mix, modelWorldMatrix, normalize, positionGeometry, screenSize,
    sin, smoothstep, step, uniform, uv, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';
import {
    JOURNEY_CONSTELLATION, journeyStarDirection, journeyStarLight, planJourneyConstellation,
} from './odyssey-journey-constellation.js';

/** How far out the stars sit from the eye (inside the city's sky dome, past its far towers). */
const STAR_DISTANCE = 1500;

/** A quad's four corners and their UVs, for the instanced stars and segments. */
function quadGeometry(count, xs, ys) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        xs[0], ys[0], 0, xs[1], ys[0], 0, xs[1], ys[1], 0, xs[0], ys[1], 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.instanceCount = count;
    return geometry;
}

function instanced(geometry, name, size, count) {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(count * size), size);
    attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attr);
    return attr;
}

/**
 * Build the constellation for `count` orbs. It is empty until setChart() gives it the orbs.
 * @param {{ count?: number, spec?: typeof JOURNEY_CONSTELLATION }} [options]
 */
export function createJourneyConstellation({ count = 60, spec = JOURNEY_CONSTELLATION } = {}) {
    const n = Math.max(2, count);
    const u = {
        time: uniform(0),
        /** 0..1: how far the line has drawn itself (advanceJourneyDrawing). */
        drawn: uniform(0),
        /** The figure's overall light (the journey's end arriving, the chapter's fade). */
        gain: uniform(0),
        /** Orbs in the figure (stars), as a float for the shader. */
        orbs: uniform(n),
    };
    const group = new THREE.Group();
    group.name = 'journey-constellation';
    // The drawing's head: where along the journey the line has reached, in orbs (0 = the first).
    const head = u.drawn.mul(u.orbs.sub(1));
    const pixelScale = screenSize.y.div(1080.0);

    /** Clip position of a direction in the stage frame, at STAR_DISTANCE from the eye. */
    const clipOf = (dir) => {
        const worldDir = normalize(modelWorldMatrix.mul(vec4(dir, 0.0)).xyz);
        const world = cameraPosition.add(worldDir.mul(STAR_DISTANCE));
        return cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));
    };

    // ── Stars ──
    const starGeometry = quadGeometry(n, [-1, 1], [-1, 1]);
    const aDir = instanced(starGeometry, 'aDir', 3, n);
    const aColour = instanced(starGeometry, 'aColour', 3, n);
    const aLook = instanced(starGeometry, 'aLook', 4, n);
    const starMaterial = new THREE.MeshBasicNodeMaterial();
    starMaterial.name = 'Odyssey journey constellation — stars';
    starMaterial.transparent = true;
    starMaterial.depthWrite = false;
    starMaterial.fog = false;
    starMaterial.blending = THREE.AdditiveBlending;
    starMaterial.premultipliedAlpha = true;
    starMaterial.forceSinglePass = true;
    starMaterial.userData.emitsBloom = true;
    const vStar = varyingProperty('vec3', 'jcStar');
    const vCross = varyingProperty('float', 'jcCross');
    const vCore = varyingProperty('float', 'jcCore');
    starMaterial.vertexNode = Fn(() => {
        const dir = attribute('aDir', 'vec3');
        const colour = attribute('aColour', 'vec3');
        const look = attribute('aLook', 'vec4'); // light, index, stars, seed
        const clip = clipOf(dir).toVar();
        const index = look.y;
        // Lit as the line reaches it, with a short flare at the line's head.
        const lit = clamp(head.sub(index).mul(3.0).add(1.0), 0.0, 1.0);
        const at = head.sub(index);
        const finished = step(spec.unfinished + 0.01, look.x);
        const flare = exp(at.mul(at).mul(-5.0)).mul(finished).mul(step(u.drawn, 0.999));
        const twinkle = sin(u.time.mul(look.w.mul(1.7).add(0.9)).add(look.w.mul(31.0))).mul(0.1).add(0.9);
        // Size in 1080p pixels: a finished orb by its stars, an unfinished one a single faint point.
        const size = mix(float(1.1), look.z.mul(0.6).add(2.0), finished).mul(pixelScale);
        const px = max(size, 1.0);
        const paid = clamp(size.div(px), 0.4, 1.0);
        const light = colour.mul(look.x).mul(lit).mul(twinkle).mul(paid.mul(paid))
            .add(vec3(1.0, 0.96, 0.9).mul(flare.mul(1.4)));
        vStar.assign(light.mul(u.gain));
        vCross.assign(step(2.5, look.z).mul(lit));
        // The quad is 5 cores wide each way (the halo and the cross need the room).
        const half = px.mul(5.0);
        vCore.assign(float(1.0).div(5.0));
        const behind = step(clip.w, 0.0);
        const screen = screenSize.mul(0.5);
        const offset = positionGeometry.xy.mul(half).div(screen).mul(clip.w);
        return vec4(clip.xy.add(offset), mix(clip.z, clip.w.mul(2.0), behind), clip.w);
    })();
    starMaterial.outputNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const r = length(q).div(vCore);
        const core = exp(r.mul(r).mul(-1.2));
        const halo = exp(r.mul(-0.9)).mul(0.07);
        // A cross of light on a three-star orb: two thin streaks fading along their length.
        const streak = (a, b) => exp(abs(a).div(vCore).mul(-3.0)).mul(float(1.0).sub(abs(b)).max(0.0).pow(2.0));
        const cross = streak(q.y, q.x).add(streak(q.x, q.y)).mul(0.32).mul(vCross);
        const edge = float(1.0).sub(smoothstep(0.85, 1.0, length(q)));
        return vec4(vStar.mul(core.add(halo).add(cross)).mul(edge).mul(materialOpacity), 0.0);
    })();
    const stars = new THREE.Mesh(starGeometry, starMaterial);
    stars.name = 'journey-constellation-stars';
    stars.frustumCulled = false;
    group.add(stars);

    // ── The line: one segment per pair of neighbours ──
    const segments = n - 1;
    const lineGeometry = quadGeometry(segments, [0, 1], [-0.5, 0.5]);
    const aFrom = instanced(lineGeometry, 'aFrom', 3, segments);
    const aTo = instanced(lineGeometry, 'aTo', 3, segments);
    const aColFrom = instanced(lineGeometry, 'aColFrom', 3, segments);
    const aColTo = instanced(lineGeometry, 'aColTo', 3, segments);
    const aSeg = instanced(lineGeometry, 'aSeg', 4, segments); // light (the dimmer end), index, -, -
    const lineMaterial = new THREE.MeshBasicNodeMaterial();
    lineMaterial.name = 'Odyssey journey constellation — line';
    lineMaterial.transparent = true;
    lineMaterial.depthWrite = false;
    lineMaterial.fog = false;
    lineMaterial.blending = THREE.AdditiveBlending;
    lineMaterial.premultipliedAlpha = true;
    lineMaterial.forceSinglePass = true;
    lineMaterial.userData.emitsBloom = true;
    const vLine = varyingProperty('vec3', 'jcLine');
    const vAcross = varyingProperty('float', 'jcAcross');
    lineMaterial.vertexNode = Fn(() => {
        const from = clipOf(attribute('aFrom', 'vec3')).toVar();
        const to = clipOf(attribute('aTo', 'vec3')).toVar();
        const seg = attribute('aSeg', 'vec4');
        const fill = clamp(head.sub(seg.y), 0.0, 1.0);
        const screen = screenSize.mul(0.5);
        const a = from.xy.div(max(from.w, 1e-4)).mul(screen).toVar();
        const b = to.xy.div(max(to.w, 1e-4)).mul(screen).toVar();
        const span = b.sub(a).toVar();
        const lengthPx = max(length(span), 1e-3);
        const along = span.div(lengthPx);
        const normal = vec2(along.y.negate(), along.x);
        // Clear of the stars' cores at both ends, and drawn as far as the line has reached.
        const gap = min(pixelScale.mul(4.0), lengthPx.mul(0.3));
        const start = gap.div(lengthPx);
        const end = min(fill, float(1.0).sub(start));
        const t = mix(start, max(end, start), positionGeometry.x);
        const width = max(pixelScale.mul(1.15), 1.0);
        const px = a.add(span.mul(t)).add(normal.mul(positionGeometry.y.mul(width.mul(2.0))));
        const z = mix(from.z.div(max(from.w, 1e-4)), to.z.div(max(to.w, 1e-4)), t);
        const colour = mix(attribute('aColFrom', 'vec3'), attribute('aColTo', 'vec3'), t);
        const shown = step(start, end).mul(step(0.0, from.w)).mul(step(0.0, to.w));
        // A line clamped up to one pixel pays the extra width back in light.
        const paid = pixelScale.mul(1.15).div(width).min(1.0);
        vLine.assign(colour.mul(seg.x).mul(0.22).mul(shown)
            .mul(u.gain)
            .mul(paid));
        vAcross.assign(positionGeometry.y.mul(2.0));
        return vec4(px.div(screen), mix(float(2.0), z, shown), 1.0);
    })();
    lineMaterial.outputNode = Fn(() => {
        const across = vAcross;
        const profile = exp(across.mul(across).mul(-2.2));
        return vec4(vLine.mul(profile).mul(materialOpacity), 0.0);
    })();
    const line = new THREE.Mesh(lineGeometry, lineMaterial);
    line.name = 'journey-constellation-line';
    line.frustumCulled = false;
    group.add(line);

    const dir = [0, 0, 0];
    let charted = '';
    return {
        group,
        uniforms: u,
        /**
         * The orbs, in journey order: their world positions (the figure's shape) and progress (each
         * star's light). Rebuilds the attributes only when something changed.
         * @param {ReadonlyArray<{ id: number, position: { x: number, y: number, z: number },
         *   colour: ArrayLike<number>, completed?: boolean, stars?: number }>} orbs
         */
        setChart(orbs) {
            const list = (orbs || []).slice(0, n);
            const key = list.map((o) => `${o.id}:${o.completed ? 1 : 0}:${o.stars ?? 0}`).join(',');
            if (key === charted || list.length < 2) return;
            charted = key;
            const plan = planJourneyConstellation(list.map((o) => o.position), spec);
            const light = list.map((o) => journeyStarLight(o, spec));
            for (let i = 0; i < n; i += 1) {
                const k = Math.min(i, list.length - 1);
                journeyStarDirection(plan.x[k], plan.y[k], spec, dir);
                aDir.setXYZ(i, dir[0], dir[1], dir[2]);
                const c = list[k].colour;
                aColour.setXYZ(i, c[0], c[1], c[2]);
                const earned = list[k].completed ? Math.max(0, Math.min(3, Number(list[k].stars) || 0)) : 0;
                const seed = fract(Math.sin((i + 1) * 12.9898) * 43758.5453);
                // Orbs past the chart's end (fewer orbs than built) stay dark.
                aLook.setXYZW(i, i < list.length ? light[k] : 0, i, earned, seed);
            }
            for (let i = 0; i < segments; i += 1) {
                const a = Math.min(i, list.length - 1);
                const b = Math.min(i + 1, list.length - 1);
                aFrom.setXYZ(i, aDir.getX(a), aDir.getY(a), aDir.getZ(a));
                aTo.setXYZ(i, aDir.getX(b), aDir.getY(b), aDir.getZ(b));
                aColFrom.setXYZ(i, aColour.getX(a), aColour.getY(a), aColour.getZ(a));
                aColTo.setXYZ(i, aColour.getX(b), aColour.getY(b), aColour.getZ(b));
                aSeg.setXYZW(i, b > a ? Math.min(light[a], light[b]) : 0, i, 0, 0);
            }
            [aDir, aColour, aLook, aFrom, aTo, aColFrom, aColTo, aSeg].forEach((attr) => {
                attr.needsUpdate = true;
            });
        },
        dispose() {
            starGeometry.dispose();
            starMaterial.dispose();
            lineGeometry.dispose();
            lineMaterial.dispose();
        },
    };
}

/** A JS fract for the per-star seed (the shader reads it as a phase). */
function fract(value) {
    return value - Math.floor(value);
}
