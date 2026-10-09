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
    Fn, cameraFar, cameraNear, cameraPosition, cameraProjectionMatrix, cameraProjectionMatrixInverse, cameraViewMatrix,
    cameraWorldMatrix, clamp, dot, exp, float, getScreenPosition, getViewPosition, length, linearDepth, max, mix, normalize,
    positionWorld, pow, reflect, screenUV, smoothstep, step, vec2, vec3, vec4, viewportDepthTexture, viewportLinearDepth,
    viewportSharedTexture,
} from 'three/tsl';

/** How far the surface's tilt moves what lies under it, per metre of water (1 = physical). */
const BEND = 0.42;
/** The moon in the water: its (generous) angular radius, as cosines of the rim and the core. */
const MOON_RIM = Math.cos(2.5 * (Math.PI / 180));
const MOON_CORE = Math.cos(1.9 * (Math.PI / 180));

/**
 * @param {PondLight} light
 * @param {object} tier
 */
export function createWater(light, tier) {
    const { u } = light;

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

        // ── The mirror ──
        const bounce = reflect(view.negate(), normal).toVar();
        const sky = mix(u.skyAmbient.mul(0.87), u.zenith, clamp(bounce.y, 0.0, 1.0));
        const toMoon = clamp(dot(bounce, u.moonDir), 0.0, 1.0).toVar();
        const disc = smoothstep(MOON_RIM, MOON_CORE, toMoon);
        const halo = pow(toMoon, 260.0).mul(0.16).add(pow(toMoon, 36.0).mul(0.022));
        // Glitter: finer facets than the simulation holds, each winking as it turns.
        const t = u.time;
        const g1 = light.noise.sample(point.xz.mul(0.61).add(vec2(t.mul(0.021), t.mul(0.013))));
        const g2 = light.noise.sample(point.xz.mul(1.47).sub(vec2(t.mul(0.017), t.mul(0.026))));
        const micro = vec2(g1.b.sub(g2.a), g1.a.sub(g2.b)).mul(0.26);
        const facet = normalize(vec3(slope.x.add(micro.x).negate(), 1.0, slope.y.add(micro.y).negate()));
        const wink = reflect(view.negate(), facet).toVar();
        // (Only along the moon's own path: elsewhere a wink would read as dust on the lens.)
        const sparkle = pow(clamp(dot(wink, u.moonDir), 0.0, 1.0), 900.0).mul(2.2).mul(smoothstep(0.975, 0.9985, toMoon));
        const moon = u.moonColor.mul(disc.mul(13.0).add(halo.mul(20.0)).add(sparkle.mul(3.0))).mul(u.breath);

        const toLamp = u.lantern.xyz.sub(point);
        const lampDist = max(length(toLamp), 0.1);
        const lampDir = toLamp.div(lampDist);
        const lampNear = float(1.0).div(float(1.0).add(lampDist.div(u.lantern.w.mul(0.5)).pow2()));
        const flame = pow(clamp(dot(bounce, lampDir), 0.0, 1.0), 55.0).mul(5.0)
            .add(pow(clamp(dot(wink, lampDir), 0.0, 1.0), 240.0).mul(26.0));
        const lamp = u.lanternColor.mul(flame.mul(lampNear)).mul(u.breath);

        // Bright things are mirrored by more than the few per cent physics allows at this
        // angle: the eye expects to find the moon in a pond.
        const shine = max(fresnel, 0.06);
        const mirrored = sky.mul(fresnel.mul(1.6)).add(moon.add(lamp).mul(shine));

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

        const colour = below.mul(keep).mul(fresnel.oneMinus()).add(murk).add(charged)
            .add(trail)
            .add(mirrored)
            .add(foam)
            .add(band)
            .add(meniscus);
        // Without the window (lowest tier) the water is a tinted pane over the bed.
        if (tier.refraction) return vec4(colour, 1.0);
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
