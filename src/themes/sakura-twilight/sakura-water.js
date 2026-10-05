/**
 * Sakura Twilight — the lake.
 *
 * Still water under a low moon is mostly mirror: on the tiers that can afford a second
 * view of the garden the lake reflects it for real (three's ReflectorNode), smeared
 * vertically the way small waves draw every light into a streak; elsewhere it mirrors the
 * sky and the moon analytically. On top of that lie the things that make it this lake:
 * the moon's glitter path, lantern light laid along the water, rafts of fallen petals
 * gathered against the shores, and the rings a locked piece sends out from under the board.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, abs, cameraPosition, clamp, color, dot, exp, float, length, max, mix, normalize, positionWorld, pow,
    reflector, saturate, screenUV, smoothstep, texture, vec2, vec3, vec4,
} from 'three/tsl';
import { SAKURA_WATER_LEVEL, createSakuraBedTexture, sakuraBedUv } from './sakura-terrain.js';

/** Things on this layer are drawn for the eye but left out of the lake's reflection. */
export const SAKURA_UNMIRRORED_LAYER = 1;

export class SakuraWater {
    constructor({ light, sky, tier }) {
        this.light = light;
        this.sky = sky;
        this.tier = tier;
        this.group = new THREE.Group();
        this.group.name = 'SakuraLake';
        this.reflection = null;
    }

    /** Lantern light laid along the water toward the eye, one streak per lamp. */
    streaks(point, eye) {
        const { light } = this;
        if (!light.lampCount) return vec3(0);
        if (!this.streaksFn) {
            this.streaksFn = Fn(([surface, from]) => {
                const total = float(0).toVar();
                Loop(light.lampCount, ({ i }) => {
                    const lamp = light.lampNodes.element(i);
                    const height = max(lamp.y.sub(SAKURA_WATER_LEVEL), 0.2);
                    // Where the lamp's mirror image is seen on the surface.
                    const foot = from.xz.add(lamp.xz.sub(from.xz).mul(from.y.div(from.y.add(height))));
                    const offset = surface.sub(foot);
                    const axis = normalize(from.xz.sub(lamp.xz));
                    const along = dot(offset, axis);
                    const across = length(offset.sub(axis.mul(along)));
                    const width = length(from.xz.sub(foot)).mul(0.006).add(0.16);
                    total.addAssign(exp(across.mul(across).div(width.mul(width)).negate())
                        .mul(exp(abs(along).div(height.mul(1.4).add(1.6)).negate())).mul(lamp.w));
                });
                return light.uLampColor.mul(total).mul(light.uLampGain);
            });
        }
        return this.streaksFn(point, eye);
    }

    build() {
        const { light, sky, tier } = this;
        this.bedTexture = createSakuraBedTexture();
        const geometry = new THREE.PlaneGeometry(1500, 900, 1, 1);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, SAKURA_WATER_LEVEL, -400);
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'SakuraLake';
        if (tier.mirror > 0) {
            this.reflection = reflector({ resolutionScale: tier.mirror, bounces: false, samples: 0 });
            this.reflection.target.rotation.x = -Math.PI / 2;
            this.reflection.target.position.y = SAKURA_WATER_LEVEL;
            this.group.add(this.reflection.target);
        }
        const { reflection, bedTexture } = this;

        material.colorNode = Fn(() => {
            const point = positionWorld.xz.toVar();
            const eye = cameraPosition.toVar();
            const toEye = eye.sub(positionWorld).toVar();
            const view = normalize(toEye).toVar();
            const t = light.uTime;
            // Wind works the water in patches: glassy lanes between ruffled ones.
            const ruffle = smoothstep(0.34, 0.72, light.noise(point.mul(0.0043).add(t.mul(0.0012))).b)
                .mul(light.uGust.mul(0.5).add(1)).toVar();
            const fine = light.noise(point.mul(0.21).add(vec2(t.mul(0.023), t.mul(0.014))));
            const chop = light.noise(point.mul(0.052).add(vec2(t.mul(-0.009), t.mul(0.012))));
            const slope = fine.rg.sub(0.5).mul(0.55).add(chop.rg.sub(0.5))
                .mul(ruffle.mul(0.8).add(0.2))
                .toVar();
            const ring = light.rings(point);
            slope.addAssign(ring.push.mul(0.9));

            const bed = texture(bedTexture, sakuraBedUv(point));
            const depth = max(float(0.5).sub(bed.r).mul(8), 0);
            const grazing = clamp(view.y, 0.02, 1);
            const glow = this.streaks(point.add(slope.mul(0.6)), eye);
            let mirror;
            if (reflection) {
                // A tilted facet throws the mirrored ray mostly up or down, hardly sideways:
                // that is what draws every reflection into a vertical streak.
                const coord = screenUV.flipX().add(vec2(slope.x.mul(0.03), slope.y.mul(0.17)));
                const smear = vec2(0, ruffle.mul(0.012).add(0.0035));
                mirror = reflection.sample(coord).rgb.mul(0.5)
                    .add(reflection.sample(coord.add(smear)).rgb.mul(0.25))
                    .add(reflection.sample(coord.sub(smear)).rgb.mul(0.25))
                    .add(glow.mul(0.35));
            } else {
                const bounced = normalize(vec3(
                    view.x.negate().add(slope.x.mul(0.1)),
                    abs(view.y).add(slope.y.mul(0.3)).max(0.004),
                    view.z.negate(),
                )).toVar();
                mirror = light.sky(bounced).add(sky.moon(bounced)).add(glow);
            }
            const fresnel = pow(float(1).sub(grazing), 5).mul(0.93).add(0.07);
            const body = mix(color(0x04070f), color(0x101b22), exp(depth.mul(-1.1)))
                .add(light.uSkyLight.mul(0.05));
            const water = mix(body, mirror, fresnel).toVar();
            // The moon's road: facets that happen to face the moon flash.
            const facet = normalize(vec3(slope.x.mul(-0.22), 1, slope.y.mul(-0.22)));
            const half = normalize(view.add(light.uMoonDir));
            const spark = pow(saturate(dot(facet, half)), 420).mul(fine.b.mul(1.4).add(0.3));
            water.addAssign(light.uMoonColor.mul(spark).mul(1.6));
            // A ring from the board catches the light as it passes.
            water.addAssign(vec3(1.0, 0.62, 0.78).mul(ring.band.mul(ring.band)).mul(fresnel).mul(0.55));

            // Hanaikada: fallen petals raft together against the shores and in the lee.
            const lee = smoothstep(0.5, 0.74, light.noise(point.mul(0.019).add(vec2(t.mul(0.0016), 0))).r
                .add(bed.g.mul(0.42)));
            // The noise is a lattice: a turned second octave keeps its grid from showing.
            const turned = vec2(point.x.mul(0.8).sub(point.y.mul(0.6)), point.x.mul(0.6).add(point.y.mul(0.8)));
            const speck = smoothstep(0.6, 0.71, light.noise(point.mul(0.83).add(vec2(t.mul(0.004), t.mul(0.002)))).a
                .mul(0.6).add(light.noise(turned.mul(1.37)).a.mul(0.5)));
            const raft = saturate(speck.mul(lee)).mul(smoothstep(60, 140, length(toEye.xz)).oneMinus());
            const petal = mix(color(0xe59ab2), color(0xfbe0e8), fine.a);
            const flat = vec3(0, 1, 0);
            const petalLit = petal.mul(light.uMoonColor.mul(saturate(light.uMoonDir.y.mul(1.4).add(0.25))).mul(light.moonlight())
                .add(light.ambient(flat).mul(1.3)).add(light.lamps(positionWorld, flat)));
            water.assign(mix(water, petalLit, raft.mul(0.9)));
            return vec4(light.haze(water, { world: positionWorld, strength: float(0.55) }), 1);
        })();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'SakuraLake';
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        this.geometry = geometry;
        this.material = material;
        this.mesh = mesh;
        this.group.add(mesh);
        return this;
    }

    /**
     * The reflection is a second view of the garden. Its camera is made here, ahead of
     * the first frame, and sees only layer 0: grass, petals, foxes and the small lights
     * (which the lake never shows) are neither drawn nor compiled for it.
     */
    bindCamera(camera) {
        if (!this.reflection) return;
        this.reflection.reflector.getVirtualCamera(camera).layers.set(0);
    }

    getDiagnostics() {
        return { mirror: this.reflection ? this.tier.mirror : 'analytic' };
    }

    dispose() {
        this.group.removeFromParent();
        this.reflection?.target.removeFromParent();
        this.reflection?.dispose();
        this.reflection = null;
        this.geometry?.dispose();
        this.material?.dispose();
        this.bedTexture?.dispose();
        this.group.clear();
    }
}
