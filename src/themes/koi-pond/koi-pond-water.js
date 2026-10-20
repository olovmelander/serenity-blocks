/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Koi Pond — the water.
 *
 * You look down into it, so it is mostly a window: the frame drawn so far (the bed, the koi,
 * the stems) is read back through the surface's slopes, each fragment bent to where its ray
 * would really land, then tinted by the length of water it crossed. On top of that window the
 * surface carries what it mirrors: the moon as a disc that every ripple breaks into shards,
 * a path of glitter under it, the lantern's flame drawn out toward the viewer, the white of a
 * splash, and a fine bright line where water meets stone.
 *
 * Nothing above the water is ever bent: a sample that would land on a lily pad, a rock or a
 * leaping fish is taken straight instead (its height is rebuilt from the depth buffer).
 */
import * as THREE from 'three/webgpu';
import {
    Break, Fn, If, Loop, cameraFar, cameraNear, cameraPosition, cameraProjectionMatrix, cameraProjectionMatrixInverse, cameraViewMatrix,
    cameraWorldMatrix, clamp, dot, exp, float, floor, fract, getScreenPosition, getViewPosition, length, linearDepth, max, mix, normalize,
    positionWorld, pow, reflect, refract, screenUV, sin, smoothstep, step, vec2, vec3, vec4, viewportDepthTexture, viewportLinearDepth,
    viewportSharedTexture,
} from 'three/tsl';

/** How far the surface's tilt moves what lies under it, per metre of water (1 = physical). */
const BEND = 0.42;
/** The moon in the water: its (generous) angular radius, as cosines of the rim and the core. */
const MOON_RIM = Math.cos(2.1 * (Math.PI / 180));
const MOON_CORE = Math.cos(1.55 * (Math.PI / 180));
/** How far the pond's finest facets spread their slopes (rms): how wide the moon's path is. */
const GLITTER_SPREAD = 0.06;
/** Metres the mirrored ray is walked looking for the garden, and the least share it is shown at. */
const MIRROR_REACH = 3.2;
const MIRROR_LEAST = 0.2;
/** Metres between the points of the glint lattice (a glint is a few pixels across). */
const GLINT_CELL = 0.045;
const DEBUG_MIRROR = false;
/** Metres of water the moonbeams are looked for along the line of sight. */
const SHAFT_REACH = 2.2;

/**
 * @param {PondLight} light
 * @param {object} tier
 */
export function createWater(light, tier) {
    const { u } = light;
    const mirrorSteps = Math.max(0, Math.round(tier.mirror ?? 0));
    const shaftSteps = Math.max(0, Math.round(tier.shafts ?? 0));

    const shade = Fn(() => {
        const point = positionWorld.toVar();
        const toEye = cameraPosition.sub(point).toVar();
        const distance = length(toEye).toVar();
        const view = toEye.div(distance).toVar();
        const surf = light.surfaceAt(point.xz).toVar();
        const slope = surf.xy.toVar();
        const normal = normalize(vec3(slope.x.negate(), 1.0, slope.y.negate())).toVar();
        const facing = clamp(dot(view, normal), 0.0, 1.0).toVar();
        const grazing = float(1.0).sub(facing).toVar();
        const fresnel = float(0.02).add(grazing.mul(grazing).mul(grazing).mul(grazing).mul(grazing)
            .mul(0.98)).toVar();

        // ── The window: what lies under the surface ──
        const below = vec3(0.0).toVar();
        const path = float(0.6).toVar();
        const edge = float(0.0).toVar();
        if (tier.refraction) {
            const span = cameraFar.sub(cameraNear);
            const thickness = max(viewportLinearDepth.sub(linearDepth()).mul(span), 0.0).toVar();
            // Where this ray lands unbent, then where the tilted surface really sends it.
            const landed = point.sub(view.mul(thickness));
            const push = slope.mul(thickness.min(2.4)).mul(BEND);
            const bent = vec3(landed.x.add(push.x), landed.y, landed.z.add(push.y));
            const bentUV = getScreenPosition(cameraViewMatrix.mul(vec4(bent, 1.0)).xyz, cameraProjectionMatrix).toVar();
            const there = getViewPosition(bentUV, viewportDepthTexture(bentUV).r, cameraProjectionMatrixInverse);
            const thereWorld = cameraWorldMatrix.mul(vec4(there, 1.0)).xyz.toVar();
            // Under water: take it. Standing above the water: this fragment looks straight down.
            const sunk = step(thereWorld.y, -0.006).toVar();
            const sampleUV = mix(screenUV, bentUV, sunk);
            below.assign(viewportSharedTexture(sampleUV).rgb);
            path.assign(mix(thickness, length(thereWorld.sub(point)), sunk));
            edge.assign(exp(thickness.mul(-11.0)));
        }
        // What a metre of this water takes out of light and what a depth of it gives back are
        // the night's own (koi-pond-moods.js): jade at first, and five other waters after it.
        const keep = exp(u.absorb.mul(path).negate());
        const murk = u.scatter.mul(float(1.0).sub(exp(path.mul(-0.42)))).mul(u.breath.mul(0.6).add(0.4));
        // A chain of clears lights the water itself: gold dust hanging in it.
        const charged = vec3(1.0, 0.62, 0.2).mul(u.power.mul(0.035).add(u.glow.mul(0.03)))
            .mul(float(1.0).sub(exp(path.mul(-0.5))));

        // ── Moonbeams in the water ──
        // The same ripples that draw the caustics on the bed gather the moonlight into sheets as
        // it falls through the water. A few points down the line of sight each ask how much light
        // the surface above them gathers there; what the eye sees is that light, scattered back.
        const beams = vec3(0.0).toVar();
        if (tier.refraction && shaftSteps > 0) {
            const sinking = refract(view.negate(), normal, 1.0 / 1.333).toVar();
            const reach = path.min(SHAFT_REACH).toVar();
            const gathered = float(0.0).toVar();
            for (let k = 0; k < shaftSteps; k += 1) {
                // (From a hand's breadth down: right under the surface the pattern is too sharp to read as light in the water.)
                const at = point.add(sinking.mul(reach.mul((k + 1) / shaftSteps).add(0.12)));
                const deep = max(at.y.negate(), 0.0);
                const entry = at.xz.add(u.underSlope.mul(deep));
                gathered.addAssign(light.gather(light.surfaceAt(entry).z, deep));
            }
            gathered.divAssign(shaftSteps);
            // Only what stands out of the even glow: a sheet, not a fog.
            const sheets = max(gathered.sub(0.9), 0.0).mul(1.1).add(0.06);
            beams.assign(u.moonColor.mul(u.scatter.mul(1.9).add(0.003)).mul(sheets)
                .mul(float(1.0).sub(exp(reach.mul(-0.9))))
                .mul(light.moonlight())
                .mul(u.breath));
        }

        // ── The mirror ──
        const bounce = reflect(view.negate(), normal).toVar();
        const sky = mix(u.skyAmbient.mul(0.87), u.zenith, clamp(bounce.y, 0.0, 1.0)).toVar();
        // Glitter: finer facets than the simulation holds, each winking as it turns.
        const t = u.time;
        const g1 = light.noise.sample(point.xz.mul(0.61).add(vec2(t.mul(0.021), t.mul(0.013))));
        const g2 = light.noise.sample(point.xz.mul(1.47).sub(vec2(t.mul(0.017), t.mul(0.026))));
        const micro = vec2(g1.b.sub(g2.a), g1.a.sub(g2.b)).mul(0.26).toVar();
        const facet = normalize(vec3(slope.x.add(micro.x).negate(), 1.0, slope.y.add(micro.y).negate()));
        const wink = reflect(view.negate(), facet).toVar();
        // The moon's own disc, seen in the ripples: every swell bends it, the finer facets break
        // it into shards with dark water between them.
        const toMoon = clamp(dot(bounce, u.moonDir), 0.0, 1.0).toVar();
        // The finer facets cut dark gaps through the disc, which wander as the water moves.
        const gaps = smoothstep(0.38, 0.62, g1.b.mul(0.6).add(g2.a.mul(0.4)));
        const disc = smoothstep(MOON_RIM, MOON_CORE, toMoon).mul(gaps.mul(0.75).add(0.25));
        const halo = pow(toMoon, 320.0).mul(0.09).add(pow(toMoon, 60.0).mul(0.008));
        // The moon's path: the share of facets tilted just so as to send its light to the eye
        // (the slope the half vector asks for, against how far this water's slopes spread), a
        // column stretched toward the viewer. Its light is in glints: points on a fine lattice
        // that the column switches on, each winking in its own time.
        const half = normalize(view.add(u.moonDir)).toVar();
        const asked = vec2(half.x.negate(), half.z.negate()).div(max(half.y, 0.05)).sub(slope);
        const column = exp(dot(asked, asked).mul(-1.0 / (2 * GLITTER_SPREAD * GLITTER_SPREAD))).toVar();
        const lattice = point.xz.add(micro.mul(0.05)).div(GLINT_CELL).toVar();
        const cell = floor(lattice);
        const hashed = vec3(dot(cell, vec2(127.1, 311.7)), dot(cell, vec2(269.5, 183.3)), dot(cell, vec2(419.2, 371.9)))
            .toVar();
        const seed = fract(sin(hashed).mul(43758.5453)).toVar();
        const spot = fract(lattice).sub(seed.xy.mul(0.6).add(0.2));
        const point2 = exp(dot(spot, spot).mul(-60.0));
        const lit2 = step(seed.z, column.mul(column).mul(0.7));
        const twinkle = sin(t.mul(seed.x.mul(5.0).add(2.5)).add(seed.y.mul(40.0))).mul(0.5).add(0.5);
        const sparkle = column.mul(0.03).add(point2.mul(lit2).mul(twinkle.mul(twinkle)).mul(14.0));
        const moon = u.moonColor.mul(disc.mul(9.0).add(halo.mul(20.0)).add(sparkle)).mul(u.breath);

        const toLamp = u.lantern.xyz.sub(point);
        const lampDist = max(length(toLamp), 0.1);
        const lampDir = toLamp.div(lampDist);
        const lampNear = float(1.0).div(float(1.0).add(lampDist.div(u.lantern.w.mul(0.5)).pow2()));
        const flame = pow(clamp(dot(bounce, lampDir), 0.0, 1.0), 55.0).mul(5.0)
            .add(pow(clamp(dot(wink, lampDir), 0.0, 1.0), 240.0).mul(26.0));
        const lamp = u.lanternColor.mul(flame.mul(lampNear)).mul(u.breath);

        // ── The garden in the water ──
        // The mirrored ray is walked up from the surface through what has been drawn so far: where
        // it passes behind something standing above the water (a stone, the lantern, the maple, a
        // leaping koi), the water shows that. Nothing under the water can stop it (the ray rises).
        const garden = vec3(0.0).toVar();
        const caught = float(0.0).toVar();
        if (tier.refraction && mirrorSteps > 0) {
            const origin = point.add(vec3(0.0, 0.004, 0.0)).toVar();
            const found = float(0.0).toVar();
            const hitUV = vec2(0.0).toVar();
            const reach = float(0.0).toVar();
            // (The walk is done in the eye's own space: one point and one direction, moved along.)
            const eyeStart = cameraViewMatrix.mul(vec4(origin, 1.0)).xyz.toVar();
            const eyeDir = cameraViewMatrix.mul(vec4(bounce, 0.0)).xyz.toVar();
            Loop(mirrorSteps, ({ i }) => {
                // Steps that lengthen with distance, from a few centimetres to MIRROR_REACH.
                const k = float(i).add(1.0).div(mirrorSteps).toVar();
                const along = k.mul(k).mul(MIRROR_REACH).add(0.03).toVar();
                const eyeAt = eyeStart.add(eyeDir.mul(along)).toVar();
                const atUV = getScreenPosition(eyeAt, cameraProjectionMatrix).toVar();
                // Off the frame (the ray rises up the picture, so it leaves by the top or a side):
                // nothing more can be found.
                If(atUV.y.lessThan(0.0).or(atUV.x.lessThan(0.0)).or(atUV.x.greaterThan(1.0)), () => {
                    Break();
                });
                const depthThere = viewportDepthTexture(atUV).r;
                const drawn = getViewPosition(atUV, depthThere, cameraProjectionMatrixInverse).z;
                // How far in front of this point of the ray the drawn surface stands.
                const ahead = drawn.sub(eyeAt.z).toVar();
                const thick = along.mul(0.35).add(0.25);
                If(ahead.greaterThan(0.0).and(ahead.lessThan(thick)), () => {
                    found.assign(1.0);
                    hitUV.assign(atUV);
                    reach.assign(along);
                    Break();
                });
            });
            // Fade it out where the frame's edge cuts it off, and the further it travelled.
            const edgeFade = smoothstep(0.0, 0.07, hitUV.y).mul(smoothstep(0.0, 0.05, hitUV.x))
                .mul(smoothstep(1.0, 0.95, hitUV.x));
            caught.assign(found.mul(edgeFade).mul(float(1.0).sub(smoothstep(MIRROR_REACH * 0.5, MIRROR_REACH, reach))));
            garden.assign(viewportSharedTexture(hitUV).rgb);
        }

        // Bright things are mirrored by more than the few per cent physics allows at this
        // angle: the eye expects to find the moon in a pond — and the garden standing over it.
        const shine = max(fresnel, 0.06);
        const held = clamp(fresnel.mul(4.5), MIRROR_LEAST, 0.7).mul(caught).toVar();
        const mirrored = mix(sky.mul(fresnel.mul(1.6)), garden.mul(held), caught).add(moon.add(lamp).mul(shine));

        // ── Foam, the lit band of a ring, the water's edge ──
        const marks = light.waves.sample(light.pondUV(point.xz));
        const froth = smoothstep(0.22, 1.0, marks.b.mul(g2.g.mul(1.3).add(0.15)).mul(g1.g.mul(0.8).add(0.5)));
        // Light the koi (and the dragon) have left hanging in the water: gold ink, a white core.
        const ink = max(marks.a, 0.0);
        const trail = vec3(1.0, 0.6, 0.16).mul(ink.mul(0.7)).add(vec3(1.0, 0.9, 0.7).mul(ink.mul(ink).mul(0.16)))
            .mul(g1.r.mul(0.5).add(0.75));
        const foam = u.moonColor.mul(0.34).add(u.lanternColor.mul(lampNear.mul(0.5))).mul(froth);
        const band = light.ringLight(point.xz).mul(0.22);
        const meniscus = u.moonColor.mul(edge.mul(0.07));

        // (Where the garden is mirrored, it takes its share of the window.)
        const colour = below.mul(keep).mul(max(fresnel, held).oneMinus()).add(murk).add(charged)
            .add(beams)
            .add(trail)
            .add(mirrored)
            .add(foam)
            .add(band)
            .add(meniscus);
        // Without the window (lowest tier) the water is a tinted pane over the bed.
        if (tier.refraction) return vec4(DEBUG_MIRROR ? mix(colour, garden.mul(4.0), caught) : colour, 1.0);
        // Without the window (lowest tier) the water is a tinted pane over the bed: what it
        // mirrors is added whole (premultiplied), only its own tint is weighed by the pane.
        const pane = clamp(fresnel.mul(3.0).add(0.16), 0.0, 1.0);
        const lights = charged.add(trail).add(mirrored).add(foam).add(band);
        return vec4(murk.mul(1.6).mul(pane).add(lights), pane);
    });

    const material = new THREE.MeshBasicNodeMaterial({
        fog: false, transparent: true, depthWrite: false, premultipliedAlpha: !tier.refraction,
    });
    material.name = 'Koi Pond — water';
    material.fragmentNode = shade();

    const geometry = new THREE.PlaneGeometry(36, 27);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Koi Pond — water';
    mesh.position.set(0, 0, -4.75);
    mesh.renderOrder = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);

    return { mesh, geometry, material };
}
