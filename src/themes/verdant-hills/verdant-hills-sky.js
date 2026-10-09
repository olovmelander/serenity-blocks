/**
 * Verdant Hills — the sky.
 *
 * Fair-weather cumulus, marched as volumes: flat bases at one height, towers above them,
 * lit by the sun through their own depth, standing in ranks to the horizon. The march runs
 * at reduced resolution into its own target once a frame (the sky is the only thing behind
 * it, so nothing has to be composited by depth) and the dome draws it over the sky's
 * gradient. The density it marches is the light rig's `cloudDensity()`, the same field
 * that shades the hills, so every shadow on the grass belongs to a cloud overhead.
 *
 * The lowest tier draws the same field as one flat layer in the dome itself.
 */
import * as THREE from 'three/webgpu';
import {
    Break, Fn, If, Loop, cameraPosition, dot, exp, float, interleavedGradientNoise, max, min, mix, normalize,
    positionWorld, pow, saturate, screenCoordinate, screenUV, smoothstep, texture, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import {
    VERDANT_HILLS_CLOUD_BASE, VERDANT_HILLS_CLOUD_TILE, VERDANT_HILLS_CLOUD_TOP,
} from './verdant-hills-light.js';

/** Clouds further than this are in the haze of the horizon anyway. */
const MARCH_RANGE = 52000;
/** Extinction of the sun's ray through full cloud, per metre. */
const SIGMA_SUN = 0.0062;
const DOME_RADIUS = 21000;

export class VerdantHillsSky {
    constructor({ light, tier }) {
        this.light = light;
        this.tier = tier;
        this.group = new THREE.Group();
        this.group.name = 'VerdantHillsSky';
        this.owned = [];
        this.steps = Math.max(0, Math.floor(tier.cloudSteps));
        this.scale = tier.cloudScale;
        this.uEye = uniform(new THREE.Vector3(0, 60, 0));
        this.uForward = uniform(new THREE.Vector3(0, 0, -1));
        // Scaled by the tangents of the half field of view, so `forward + right·x + up·y`
        // is the ray through a pixel.
        this.uRight = uniform(new THREE.Vector3(1, 0, 0));
        this.uUp = uniform(new THREE.Vector3(0, 1, 0));
        this.uTexel = uniform(new THREE.Vector2(1 / 640, 1 / 360));
        // Extinction of the view ray through full cloud per metre, how fast distance dissolves a
        // cloud into the horizon's air, and how dark a cloud's own shade is.
        this.uSigma = uniform(0.008);
        this.uVeil = uniform(0.00006);
        this.uShade = uniform(0.68);
        this.size = { width: 0, height: 0 };
        this.frame = 0;
        this.drawing = new THREE.Vector2();
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        if (this.steps > 0) this.buildMarch();
        this.buildDome();
        return this;
    }

    /** What the sun and the sky make of a cloud sample at height fraction `h`. */
    cloudLight(direction, sunDepth, h) {
        const { light } = this;
        const cosine = dot(direction, light.uSunDir);
        // Forward scattering gilds the edges of a cloud that stands toward the sun.
        const forward = min(float(0.36).div(pow(float(1.64).sub(cosine.mul(1.6)), 1.5)), 4);
        const phase = forward.mul(0.34).add(0.7);
        // Light that has scattered many times still finds its way through.
        const through = exp(sunDepth.negate()).mul(0.88).add(exp(sunDepth.mul(-0.14)).mul(0.12));
        const sun = light.uSunColor.mul(through).mul(phase).mul(0.27);
        // Skylight reaches a cloud's flanks and top; its flat base sees only the dim ground.
        const ambient = mix(vec3(0.085, 0.11, 0.17), vec3(0.24, 0.3, 0.42), saturate(h.mul(2.6)))
            .mul(this.uShade).mul(light.uWarmth.mul(0.1).add(1));
        return sun.add(ambient);
    }

    buildMarch() {
        const { light, steps } = this;
        const target = this.own(new THREE.RenderTarget(16, 16, {
            type: THREE.HalfFloatType,
            format: THREE.RGBAFormat,
            depthBuffer: false,
            stencilBuffer: false,
            samples: 0,
        }));
        target.texture.name = 'Verdant Hills — cumulus';
        target.texture.minFilter = THREE.LinearFilter;
        target.texture.magFilter = THREE.LinearFilter;
        target.texture.generateMipmaps = false;
        this.target = target;
        const span = VERDANT_HILLS_CLOUD_TOP - VERDANT_HILLS_CLOUD_BASE;
        const material = this.own(new THREE.NodeMaterial());
        material.name = 'Verdant Hills — cumulus march';
        material.depthTest = false;
        material.depthWrite = false;
        material.fragmentNode = Fn(() => {
            const st = uv();
            // The quad's v runs down the target, as the screen's does.
            const direction = normalize(this.uForward.add(this.uRight.mul(st.x.mul(2).sub(1)))
                .add(this.uUp.mul(float(1).sub(st.y.mul(2))))).toVar();
            const colour = vec3(0).toVar();
            const clear = float(1).toVar();
            If(direction.y.greaterThan(0.006), () => {
                const origin = this.uEye;
                const near = float(VERDANT_HILLS_CLOUD_BASE).sub(origin.y).div(direction.y);
                const far = min(float(VERDANT_HILLS_CLOUD_TOP).sub(origin.y).div(direction.y), MARCH_RANGE);
                const stride = far.sub(near).div(steps).toVar();
                const reach = near.add(stride.mul(interleavedGradientNoise(screenCoordinate.xy))).toVar();
                // Toward the horizon the deck dissolves into the air in front of it.
                const horizon = light.sky(normalize(vec3(direction.x, 0.02, direction.z))).toVar();
                Loop(steps, () => {
                    If(clear.lessThan(0.02), () => {
                        Break();
                    });
                    const point = origin.add(direction.mul(reach)).toVar();
                    const density = light.cloudDensity(point, { range: reach }).toVar();
                    If(density.greaterThan(0.003), () => {
                        const h = point.y.sub(VERDANT_HILLS_CLOUD_BASE).div(span);
                        // Toward the sun: a near sample that sees the billows, so each one
                        // shades the next, and a far one for the bulk of the cloud.
                        const first = light.cloudDensity(point.add(light.uSunDir.mul(130)), { range: reach });
                        const second = light.cloudDensity(point.add(light.uSunDir.mul(520)), { detail: false });
                        const sunDepth = first.mul(230).add(second.mul(420)).add(density.mul(40)).mul(SIGMA_SUN);
                        const lit = this.cloudLight(direction, sunDepth, h);
                        const veil = exp(reach.mul(this.uVeil).negate());
                        const sample = mix(horizon, lit, veil);
                        const cover = float(1).sub(exp(density.mul(stride).mul(this.uSigma).negate()));
                        colour.addAssign(sample.mul(cover).mul(clear));
                        clear.mulAssign(cover.oneMinus());
                    });
                    reach.addAssign(stride);
                });
                // No hard start at the horizon line.
                const rise = smoothstep(0.006, 0.03, direction.y);
                colour.mulAssign(rise);
                clear.assign(mix(float(1), clear, rise));
            });
            return vec4(colour, clear);
        })();
        this.marchMaterial = material;
        this.quad = new THREE.QuadMesh(material);
        this.quad.name = 'Verdant Hills — cumulus march quad';
    }

    /** One flat layer of the same field, for the tier that cannot afford the march. */
    flatClouds(direction) {
        const { light } = this;
        const lift = max(direction.y, 0.02);
        const plane = cameraPosition.xz.add(direction.xz.mul(float(VERDANT_HILLS_CLOUD_BASE + 350).div(lift)));
        const at = (xz) => xz.div(VERDANT_HILLS_CLOUD_TILE).add(light.uCloudOffset);
        const above = (xz) => texture(light.cloudTexture, at(xz)).r.sub(light.uCloudEdge).div(light.uCloudSpan);
        const field = above(plane);
        const billow = texture(light.cloudTexture, at(plane).mul(7)).g;
        const shape = smoothstep(-0.02, 0.2, field.sub(billow.mul(0.14)));
        const lit = above(plane.add(light.uSunDir.xz.mul(520)));
        const sunDepth = saturate(lit.mul(2.4)).mul(2.6);
        const colour = this.cloudLight(direction, sunDepth, saturate(field.sub(lit).mul(3).add(0.5)));
        const range = float(VERDANT_HILLS_CLOUD_BASE).div(lift);
        const veil = exp(range.mul(this.uVeil).negate());
        const horizon = light.sky(normalize(vec3(direction.x, 0.02, direction.z)));
        const cover = shape.mul(smoothstep(0.01, 0.05, direction.y)).mul(0.96);
        return vec4(mix(horizon, colour, veil).mul(cover), cover.oneMinus());
    }

    buildDome() {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            side: THREE.BackSide, fog: false, depthWrite: false,
        }));
        material.name = 'VerdantHillsSkyDome';
        const direction = normalize(positionWorld.sub(cameraPosition));
        let sky = light.sky(direction);
        // High cirrus: long streaks far above the cumulus, combed by a wind of their own.
        const lift = max(direction.y, 0.0).add(0.07);
        const plane = direction.xz.div(lift);
        const streaks = light.noise(plane.mul(vec2(0.021, 0.2)).add(light.uCloudOffset.mul(0.6)));
        const streak = streaks.b.mul(0.6).add(streaks.a.mul(0.4));
        const wisp = light.noise(plane.mul(vec2(0.9, 0.31)).add(light.uCloudOffset.mul(2.1))).g;
        const cirrus = smoothstep(0.5, 0.86, streak.mul(0.72).add(wisp.mul(0.28)))
            .mul(smoothstep(0.05, 0.3, direction.y)).mul(0.3);
        sky = mix(sky, vec3(0.86, 0.9, 0.96).mul(light.uWarmth.mul(0.08).add(1)), cirrus);
        let clouds;
        if (this.target) {
            // Four taps a half-texel apart: a tent that takes the march's grain out.
            const tap = (x, y) => texture(this.target.texture, screenUV.add(this.uTexel.mul(vec2(x, y))));
            clouds = tap(-0.5, -0.5).add(tap(0.5, -0.5)).add(tap(-0.5, 0.5)).add(tap(0.5, 0.5))
                .mul(0.25);
        } else clouds = this.flatClouds(direction);
        material.colorNode = sky.mul(clouds.a).add(clouds.rgb);
        const dome = new THREE.Mesh(this.own(new THREE.SphereGeometry(DOME_RADIUS, 48, 24)), material);
        dome.name = 'VerdantHillsSky';
        // Drawn after the land, so it is shaded only where the sky shows.
        dome.renderOrder = 40;
        dome.frustumCulled = false;
        dome.matrixAutoUpdate = false;
        this.dome = dome;
        this.group.add(dome);
    }

    /** Size the march's target for a drawing-buffer size in pixels. */
    setSize(width, height) {
        if (!this.target || !(width > 0) || !(height > 0)) return;
        const w = Math.max(16, Math.round(width * this.scale));
        const h = Math.max(16, Math.round(height * this.scale));
        if (w === this.size.width && h === this.size.height) return;
        this.size = { width: w, height: h };
        this.target.setSize(w, h);
        this.uTexel.value.set(1 / w, 1 / h);
    }

    /** March the clouds for this frame's camera. Call before the scene is drawn. */
    render(renderer, camera) {
        if (!this.target || !renderer || !camera) return;
        const drawing = renderer.getDrawingBufferSize(this.drawing);
        this.setSize(drawing.x, drawing.y);
        camera.updateMatrixWorld();
        const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
        this.uEye.value.setFromMatrixPosition(camera.matrixWorld);
        this.uRight.value.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
            .multiplyScalar(tanV * camera.aspect);
        this.uUp.value.setFromMatrixColumn(camera.matrixWorld, 1).normalize().multiplyScalar(tanV);
        this.uForward.value.setFromMatrixColumn(camera.matrixWorld, 2).normalize().negate();
        const previous = renderer.getRenderTarget();
        try {
            renderer.setRenderTarget(this.target);
            this.quad.render(renderer);
        } finally {
            renderer.setRenderTarget(previous);
        }
        this.frame += 1;
    }

    getDiagnostics() {
        return {
            cloudSteps: this.steps, cloudTarget: this.target ? [this.size.width, this.size.height] : null,
        };
    }

    dispose() {
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.quad = null;
        this.target = null;
        this.group.removeFromParent();
        this.group.clear();
    }
}
