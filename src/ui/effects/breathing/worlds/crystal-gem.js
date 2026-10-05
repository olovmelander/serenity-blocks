/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Crystal Prism — the quartz, as a solid the shader can see through.
 *
 * A quartz point is a convex solid: six prism faces closed by six rhombohedral faces at each end.
 * It is defined here as half-spaces (n · x <= c, object space, c-axis = y), and the same planes
 * build the mesh in JS and trace the light in the fragment shader. Because the solid is known
 * exactly, nothing about its inside is faked: the view ray refracts at the facet, crosses the
 * stone, and at each face it reaches either leaves (bent again, a little differently for each
 * colour: dispersion) or reflects back inside (total internal reflection, the bright facets a real
 * crystal is full of). What a ray meets on the way out is the grotto's environment
 * (crystal-light.js): the same beam and fan the backdrop paints. Along the way it gathers the
 * crystal's inner light — a glowing heart at its centre and a fine thread along its axis, both
 * swelling with the breath — the beam's own path through the stone, and the faint veils of growth
 * phantoms (earlier terminations the crystal grew over). Every glow is a line integral solved in
 * closed form (a Gaussian of the ray's closest approach), so nothing is ray-marched.
 *
 * Real quartz is not a perfect hexagon: the prism faces differ a little in width, the large r and
 * small z faces alternate around each termination, and the apex sits off the axis.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, cameraPosition, clamp, dot, exp, float, length, max, min, modelWorldMatrix,
    modelWorldMatrixInverse, normalLocal, normalize, positionLocal, positionWorld, reflect, sin, smoothstep,
    sqrt, step, uniformArray, vec3, vec4,
} from 'three/tsl';
import { prismEnvironment, prismFan } from './crystal-light.js';

const DEG = Math.PI / 180;
/** Quartz is ~1.544; the three channels are pushed apart for more fire than real quartz has. */
const IOR = 1.54;
const IOR_RGB = [1.515, 1.54, 1.568];
const F0 = ((IOR - 1) / (IOR + 1)) ** 2;
/** Sharpness of the luminous thread on the crystal's axis (object units^-2: ~0.01 wide). */
const CORE_SHARP = 6000;
/** Sharpness of the glowing heart at the centre (~0.03 wide; HEART_LENGTH times longer along the axis). */
const HEART_SHARP = 500;
const HEART_LENGTH = 3.2;
/** Sharpness of the beam's path through the stone. */
const BEAM_SHARP = 900;
/** How far inside the termination the growth phantoms lie (object units). */
const PHANTOM_INSETS = [0.05, 0.11];

/**
 * Half-spaces of a double-terminated quartz point.
 * @param {object} shape apothem, shoulder/foot heights of the prism section, termination angles,
 *   per-side width jitter, side-angle jitter (degrees), r/z alternation, apex offset.
 */
export function quartzPlanes({
    apothem = 0.16, shoulder = 0.36, foot = 0.3, top = 52, bottom = 50,
    widths = [1, 0.93, 1.05, 0.96, 1.04, 0.91], turns = [0, 2.5, -3, 1.5, -2, 3], alternate = 0.012,
    apex = [0.018, -0.012],
} = {}) {
    const planes = [];
    for (let k = 0; k < 6; k++) {
        const angle = (k * 60 + turns[k]) * DEG;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const a = apothem * widths[k];
        planes.push({ n: [c, 0, s], c: a });
        // Termination faces meet this side at the shoulder; r and z faces alternate in size.
        const zFace = k % 2 === 1 ? 1 : -1;
        const sinT = Math.sin(top * DEG);
        const cosT = Math.cos(top * DEG);
        const shift = apex[0] * sinT * c + apex[1] * sinT * s;
        planes.push({ n: [sinT * c, cosT, sinT * s], c: sinT * a + cosT * shoulder + zFace * alternate + shift });
        const sinB = Math.sin(bottom * DEG);
        const cosB = Math.cos(bottom * DEG);
        planes.push({ n: [sinB * c, -cosB, sinB * s], c: sinB * a + cosB * foot - zFace * alternate * 0.8 });
    }
    return planes;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * The convex solid's mesh: every corner is where three planes meet inside all the others; every
 * face is the polygon of corners on its plane. Flat normals, non-indexed (one normal per face).
 */
export function buildSolidGeometry(planes) {
    const corners = [];
    const eps = 1e-6;
    for (let i = 0; i < planes.length; i++) {
        for (let j = i + 1; j < planes.length; j++) {
            for (let k = j + 1; k < planes.length; k++) {
                const a = planes[i].n;
                const b = planes[j].n;
                const c = planes[k].n;
                const det = dot3(a, cross3(b, c));
                if (Math.abs(det) < 1e-9) continue;
                // Cramer: x = (ca (b × c) + cb (c × a) + cc (a × b)) / det
                const bc = cross3(b, c);
                const ca = cross3(c, a);
                const ab = cross3(a, b);
                const point = [0, 1, 2].map((axis) => (
                    planes[i].c * bc[axis] + planes[j].c * ca[axis] + planes[k].c * ab[axis]
                ) / det);
                if (planes.some((plane) => dot3(plane.n, point) > plane.c + 1e-5)) continue;
                if (!corners.some((q) => Math.hypot(...sub(q, point)) < eps * 10)) corners.push(point);
            }
        }
    }
    const positions = [];
    const normals = [];
    planes.forEach(({ n, c }) => {
        const onPlane = corners.filter((point) => Math.abs(dot3(n, point) - c) < 1e-5);
        if (onPlane.length < 3) return;
        const centre = onPlane.reduce(
            (sum, point) => sum.map((v, axis) => v + point[axis] / onPlane.length),
            [0, 0, 0],
        );
        const helper = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const t1 = unit(cross3(helper, n));
        const t2 = cross3(n, t1);
        const ring = onPlane
            .map((point) => ({ point, angle: Math.atan2(dot3(sub(point, centre), t2), dot3(sub(point, centre), t1)) }))
            .sort((a, b) => a.angle - b.angle)
            .map(({ point }) => point);
        for (let index = 1; index < ring.length - 1; index++) {
            let tri = [ring[0], ring[index], ring[index + 1]];
            // Counter-clockwise seen from outside, so the default front-face culling keeps it.
            if (dot3(cross3(sub(tri[1], tri[0]), sub(tri[2], tri[0])), n) < 0) tri = [tri[0], tri[2], tri[1]];
            tri.forEach((point) => {
                positions.push(...point);
                normals.push(...n);
            });
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.computeBoundingSphere();
    return geometry;
}

/** Schlick's Fresnel written with products: a cosine a hair above 1 must not reach pow(). */
function schlick(cosine, f0 = F0) {
    const m = clamp(float(1).sub(cosine), 0, 1);
    const m2 = m.mul(m);
    return float(f0).add(float(1 - f0).mul(m2.mul(m2).mul(m)));
}

/**
 * The shader's view of the solid: its half-spaces as (normal, c) records in a uniform array, so
 * that every test against them is one loop (its body emitted once) however many faces there are.
 * These helpers run inside the material's Fn; they read the array directly.
 */
function createPlaneHelpers(planes) {
    const data = uniformArray(planes.map(({ n, c }) => new THREE.Vector4(n[0], n[1], n[2], c)), 'vec4');
    const tops = planes.filter(({ n }) => n[1] > 0.3);
    const topData = uniformArray(tops.map(({ n, c }) => new THREE.Vector4(n[0], n[1], n[2], c)), 'vec4');

    /** Where a ray inside the solid leaves it: outward normal of the exit face (xyz), distance (w). */
    const exit = (origin, dir) => {
        const best = vec4(0, 1, 0, 1e4).toVar();
        Loop(planes.length, ({ i }) => {
            const plane = data.element(i).toVar();
            const rate = dot(plane.xyz, dir).toVar();
            const room = plane.w.sub(dot(plane.xyz, origin)).max(0);
            const distance = room.div(rate.max(1e-5)).toVar();
            const closer = rate.greaterThan(1e-5).and(distance.lessThan(best.w));
            best.assign(closer.select(vec4(plane.xyz, distance), best));
        });
        return best;
    };

    /**
     * In-face distance from a surface point to the face's nearest edge: for every other plane, how
     * far the point is from the line where that plane cuts this face.
     */
    const edge = (point, normal) => {
        const nearest = float(1e3).toVar();
        Loop(planes.length, ({ i }) => {
            const plane = data.element(i).toVar();
            const cosine = dot(normal, plane.xyz).toVar();
            const room = plane.w.sub(dot(plane.xyz, point)).max(0);
            const distance = room.div(sqrt(max(float(1).sub(cosine.mul(cosine)), 1e-6)));
            nearest.assign(min(nearest, cosine.lessThan(0.995).select(distance, float(1e3))));
        });
        return nearest;
    };

    /**
     * Phantoms: earlier terminations the crystal grew over, left inside it as faint veils. Each is
     * the termination pyramid moved inward by an inset, and a ray meets it as a thin sheet. Exact,
     * no marching: for each face of the inset pyramid, where the run crosses that face's plane, and
     * whether the crossing lies on the pyramid (no other face is further out there). Returns the
     * sheets' summed opacity along the run (a sheet seen edge-on is thicker).
     */
    const phantoms = (origin, dir, reach) => {
        const veil = float(0).toVar();
        PHANTOM_INSETS.forEach((inset) => {
            Loop({
                start: 0, end: tops.length, type: 'int', condition: '<', name: 'j',
            }, ({ j }) => {
                const face = topData.element(j).toVar();
                const rate = dot(face.xyz, dir).toVar();
                const safe = rate.abs().lessThan(1e-4).select(float(1e-4), rate).toVar();
                const t = float(-inset).sub(dot(face.xyz, origin).sub(face.w)).div(safe).toVar();
                // Is this face the outermost of the inset pyramid where the run crosses it?
                const outer = float(-1e3).toVar();
                Loop({
                    start: 0, end: tops.length, type: 'int', condition: '<', name: 'k',
                }, ({ k }) => {
                    const other = topData.element(k).toVar();
                    const offset = dot(other.xyz, origin).sub(other.w).add(dot(other.xyz, dir).mul(t));
                    outer.assign(max(outer, k.equal(j).select(float(-1e3), offset)));
                });
                const onSheet = step(0, t).mul(step(t, reach)).mul(step(outer, -inset + 1e-3));
                veil.addAssign(onSheet.div(safe.abs().max(0.12)));
            });
        });
        return veil;
    };

    return { exit, edge, phantoms };
}

/**
 * The solid: its mesh and the shader helpers that know its planes (exit, edge, phantoms).
 * @param {object} [shape] see quartzPlanes
 */
export function createQuartzSolid(shape) {
    const planes = quartzPlanes(shape);
    return {
        planes,
        geometry: buildSolidGeometry(planes),
        ...createPlaneHelpers(planes),
    };
}

const CORE_COLOR = vec3(0.55, 0.92, 1.0);
const BODY_COLOR = vec3(0.22, 0.5, 0.78);

/**
 * The light gathered along one straight run through the stone (from `start`, unit `run`, for
 * `reach`): the thread on the axis, the heart, a faint body glow and the beam's own path (`beam`,
 * its direction through the crystal's centre). Each is the line integral of a Gaussian, solved in
 * closed form from the run's closest approach. `gains` = (thread and body, heart, beam).
 */
const quartzInner = /* @__PURE__ */ Fn(([start, run, reach, beam, gains]) => {
    // The thread on the axis: a line integral of a Gaussian is a Gaussian of the miss.
    const lateral = dot(run.xz, run.xz).add(1e-4).toVar();
    const nearest = clamp(dot(start.xz, run.xz).negate().div(lateral), 0, reach);
    const closest = start.add(run.mul(nearest)).toVar();
    const miss = dot(closest.xz, closest.xz);
    const chord = min(sqrt(float(Math.PI / CORE_SHARP).div(lateral)), reach);
    const middle = exp(closest.y.mul(closest.y).mul(-4.5));
    const filament = exp(miss.mul(-CORE_SHARP)).mul(chord).mul(middle).mul(30);
    // The heart: a spindle of light at the centre, along the axis, multiplied by the facets.
    // In a space where the spindle is a sphere, the run's integral is a Gaussian of its miss.
    const squash = vec3(1, 1 / HEART_LENGTH, 1);
    const s0 = start.mul(squash).toVar();
    const r0 = run.mul(squash).toVar();
    const rr = dot(r0, r0).max(1e-4).toVar();
    const passing = clamp(dot(s0, r0).negate().div(rr), 0, reach);
    const nearHeart = s0.add(r0.mul(passing)).toVar();
    const heart = exp(dot(nearHeart, nearHeart).mul(-HEART_SHARP)).div(rr.sqrt())
        .mul(Math.sqrt(Math.PI / HEART_SHARP) * 11);
    // A faint body of light filling the stone.
    const half = start.add(run.mul(reach.mul(0.5))).toVar();
    const body = exp(dot(half, half).mul(-22)).mul(reach).mul(0.15).toVar();
    // The beam crossing the stone: closest approach of this run to the beam's line.
    const b = dot(run, beam).toVar();
    const d = dot(run, start);
    const e = dot(beam, start);
    const parallel = max(float(1).sub(b.mul(b)), 1e-4).toVar();
    const s = clamp(b.mul(e).sub(d).div(parallel), 0, reach);
    const at = start.add(run.mul(s)).toVar();
    const off = at.sub(beam.mul(dot(at, beam))).toVar();
    const crossing = min(sqrt(float(Math.PI / BEAM_SHARP).div(parallel)), reach);
    const ray = exp(dot(off, off).mul(-BEAM_SHARP)).mul(crossing).mul(4);
    return CORE_COLOR.mul(filament.add(body).mul(gains.x).add(heart.mul(gains.y)))
        .add(vec3(1, 0.98, 0.95).mul(ray).mul(gains.z))
        .add(BODY_COLOR.mul(body).mul(0.06));
}).setLayout({
    name: 'prism_quartz_inner',
    type: 'vec3',
    inputs: [
        { name: 'start', type: 'vec3' }, { name: 'run', type: 'vec3' }, { name: 'reach', type: 'float' },
        { name: 'beam', type: 'vec3' }, { name: 'gains', type: 'vec3' },
    ],
});

/**
 * The traced quartz material.
 * @param {object} options
 * @param {object} options.u breath uniforms
 * @param {object} options.solid from createQuartzSolid
 * @param {() => {fan, look, beam, sky}} options.light fresh packed light parameters (nodes)
 * @param {number} options.bounces internal ray segments (1–4)
 * @param {boolean} options.dispersion split the first exit into three wavelengths
 * @param {number} [options.glow] how much of the inner light this stone carries
 * @param {number} [options.lit] how much the passing fan lights this stone from inside
 * @param {boolean} [options.phantoms] show the growth phantoms inside the stone
 * @param {number} [options.exit] the crystal the beam passes through: how strongly the side the
 *   light leaves by glows with the spectrum already separating inside it
 */
export function createQuartzMaterial({
    u, solid, light, bounces = 3, dispersion = true, glow = 1, lit = 0, phantoms = false, exit = 0,
}) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = Fn(() => {
        const {
            fan, look, beam, sky,
        } = light();
        const fanV = fan.toVar();
        const lookV = look.toVar();
        const beamV = beam.toVar();
        const skyV = sky.toVar();
        const centre = modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz.toVar();
        const scale = length(modelWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz).toVar();
        const toWorld = (d) => normalize(modelWorldMatrix.mul(vec4(d, 0)).xyz);
        const toLocal = (d) => normalize(modelWorldMatrixInverse.mul(vec4(d, 0)).xyz);
        // What the stone sees around it.
        const env = (d) => prismEnvironment(toWorld(d), fanV, lookV, beamV, skyV);

        const eye = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz.toVar();
        const origin = positionLocal.toVar();
        const view = normalize(origin.sub(eye)).toVar();
        const facet = normalize(normalLocal).toVar();
        // Prism faces carry fine growth striae across the c-axis; they ripple the reflections.
        const side = float(1).sub(facet.y.abs().mul(4).saturate()).toVar();
        // Irregular: two beating frequencies, and bands of the face where they fade out.
        const growth = origin.y.mul(150).add(sin(origin.y.mul(41)).mul(2.2))
            .add(sin(origin.y.mul(97).add(1.7)).mul(1.3));
        const patchy = sin(origin.y.mul(19).add(facet.x.mul(7)).add(facet.z.mul(5))).mul(0.5).add(0.5);
        const striae = sin(growth).mul(patchy.mul(patchy)).mul(0.014).mul(side);
        // Terminations are never optically flat: broad growth undulations make a facet's fire grade
        // through the colours across it instead of lighting as one flat patch.
        const tip = float(1).sub(side).toVar();
        const undulation = vec3(
            sin(origin.y.mul(23).add(origin.z.mul(17))),
            sin(origin.x.mul(19).add(origin.z.mul(29)).add(1.3)),
            sin(origin.x.mul(27).add(origin.y.mul(21)).add(2.1)),
        ).mul(tip.mul(0.035));
        const normal = normalize(facet.add(vec3(0, striae, 0)).add(undulation.sub(facet.mul(dot(undulation, facet)))))
            .toVar();

        // Reflection off the facet.
        const cosIn = clamp(dot(view.negate(), normal), 0, 1).toVar();
        const fresnelIn = schlick(cosIn).toVar();
        const mirrored = env(reflect(view, normal)).toVar();

        // Into the stone.
        const eta = 1 / IOR;
        const bend = sqrt(max(float(1).sub(float(eta * eta).mul(float(1).sub(cosIn.mul(cosIn)))), 0));
        const inside = normalize(view.mul(eta).add(normal.mul(cosIn.mul(eta).sub(bend)))).toVar();

        // The inner light swells with the breath; the beam's path through the stone is always lit.
        const breath = u.breathSoft;
        const coreGain = breath.mul(breath).mul(1.3).add(0.3).mul(glow)
            .toVar();
        // The heart never quite goes out: it rests as a soft glow and swells on the in-breath.
        const heartGain = breath.mul(breath).mul(1.1).add(0.5).mul(glow)
            .toVar();
        const beamGain = skyV.x.mul(0.9).toVar();
        const beamLocal = toLocal(vec3(beamV.x, beamV.y, 0)).toVar();
        const gains = vec3(coreGain, heartGain, beamGain).toVar();

        const radiance = vec3(0).toVar();
        const through = vec3(1).toVar();
        const point = origin.toVar();
        const heading = inside.toVar();
        /**
         * One run through the stone to the face it reaches: the inner light gathered on the way,
         * the light that leaves through that face, and the reflection that carries on inside. The
         * first run splits the colours and crosses the phantoms; later runs share one copy of the
         * code inside a loop.
         */
        const segment = (first) => {
            const hit = solid.exit(point, heading).toVar();
            const reach = hit.w.min(4).toVar();
            radiance.addAssign(through.mul(quartzInner(point, heading, reach, beamLocal, gains)));
            if (first && phantoms) {
                // The veils scatter a little of the inner light: milky, cool, never opaque.
                const veil = solid.phantoms(point, heading, reach).mul(0.02).min(0.12);
                radiance.addAssign(through.mul(vec3(0.6, 0.78, 0.92)).mul(veil).mul(heartGain.mul(0.35).add(0.12)));
            }
            point.assign(point.add(heading.mul(reach)));
            const wall = hit.xyz.toVar();
            const cosOut = clamp(dot(heading, wall), 0, 1).toVar();
            const grazing = float(1).sub(cosOut.mul(cosOut)).toVar();
            /** One wavelength leaving through this face: its direction and how much reflects back. */
            const leave = (index) => {
                const sin2 = grazing.mul(index * index);
                const cosT = sqrt(max(float(1).sub(sin2), 0));
                // Schlick on the outgoing cosine rises smoothly to 1 at the critical angle: past it,
                // everything reflects (total internal reflection), with no hard edge per colour.
                const reflects = schlick(cosT);
                const dir = normalize(heading.mul(index).sub(wall.mul(cosOut.mul(index).sub(cosT))));
                return { dir, reflects };
            };
            if (first && dispersion) {
                const red = leave(IOR_RGB[0]);
                const green = leave(IOR_RGB[1]);
                const blue = leave(IOR_RGB[2]);
                const reflects = vec3(red.reflects, green.reflects, blue.reflects).toVar();
                const seen = vec3(env(red.dir).x, env(green.dir).y, env(blue.dir).z);
                radiance.addAssign(through.mul(vec3(1).sub(reflects)).mul(seen));
                through.mulAssign(reflects);
            } else {
                const one = leave(IOR);
                const reflects = one.reflects.toVar();
                radiance.addAssign(through.mul(float(1).sub(reflects)).mul(env(one.dir)));
                through.mulAssign(reflects);
            }
            // Quartz is nearly clear: a faint cool absorption over each run.
            through.mulAssign(exp(vec3(0.5, 0.22, 0.12).mul(reach).negate()));
            heading.assign(reflect(heading, wall));
        };
        segment(true);
        if (bounces > 1) Loop(bounces - 1, () => segment(false));
        // What still bounces inside spreads into a soft light of the stone's own colour.
        radiance.addAssign(through.mul(BODY_COLOR.mul(coreGain.mul(0.12).add(0.02)).add(env(heading).mul(0.4))));

        // Edges of a cut stone catch the light: a line about two pixels wide at any distance.
        const distance = length(positionWorld.sub(cameraPosition));
        const pixel = u.px.mul(distance).div(6).div(scale).max(1e-4);
        const toEdge = solid.edge(origin, facet);
        const edge = exp(toEdge.div(pixel.mul(1.3)).pow2().negate()).toVar();
        // A wider, fainter inner sheen along each edge: light trapped where two faces meet.
        const sheen = exp(toEdge.div(pixel.mul(6)).pow2().negate()).mul(0.12);

        // Sharp highlights of a cool fill lamp up front; the beam's own glints come from the environment.
        const r = toWorld(reflect(view, normal)).toVar();
        const lamp = max(dot(r, normalize(vec3(0.55, 0.55, 0.62))), 0);
        const lamp2 = lamp.mul(lamp).mul(lamp).mul(lamp);
        const lamp8 = lamp2.mul(lamp2);
        const glint = lamp8.mul(lamp8).mul(lamp8).mul(1.6);

        const surface = mirrored.mul(fresnelIn.mul(1.6).add(0.02)).add(vec3(0.85, 0.95, 1.0).mul(glint));
        const stone = radiance.mul(float(1).sub(fresnelIn));
        // An edge is a narrow bevel that sees much of the grotto: it lights where the reflection is bright.
        const edgeLight = vec3(0.6, 0.85, 1.0).mul(coreGain.mul(0.2).add(0.12)).add(mirrored.mul(2.2));
        const lines = edgeLight.mul(edge.mul(0.9).add(sheen));
        const col = stone.add(surface).add(lines).toVar();
        if (exit > 0) {
            // Where the light leaves the stone it is already splitting: the fan, drawn as if it had
            // travelled further (its bands apart), glows through the exit side of the crystal.
            const seenAt = positionWorld.xy.sub(centre.xy).mul(2.6);
            col.addAssign(prismFan(seenAt, fanV, lookV).mul(exit).mul(float(1).sub(fresnelIn)));
        }
        if (lit > 0) {
            // A shard in the fan's path glows with the colour passing through it.
            const seenAt = positionWorld.xy.mul(float(6).div(float(6).sub(positionWorld.z).max(0.5)));
            const away = smoothstep(0.3, 0.6, length(centre.xy));
            const transmit = float(1).sub(fresnelIn).mul(0.7).add(0.3);
            col.addAssign(prismFan(seenAt, fanV, lookV).mul(lit).mul(away).mul(transmit));
        }
        return col;
    })();
    return material;
}
