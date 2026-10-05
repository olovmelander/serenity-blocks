/**
 * Sakura Twilight — the sky.
 *
 * One dome draws the whole vault: the afterglow gradient from the light rig, two sizes of
 * twinkling stars, drifting cirrus lit silver by the moon and rose from below, and the
 * moon itself — a mottled disc with a soft corona and the wide ring a thin veil of ice
 * gives it. `moon(direction)` is exported as a node so the lake can mirror the same disc.
 *
 * Over the vault lie the constellations: a few figures of bright stars whose lines draw
 * themselves in as a combo builds, and the shooting stars a four-line clear sets off.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, color, cross, dot, exp, float, floor, fract, instancedBufferAttribute, length, max, mix,
    normalize, positionGeometry, positionWorld, pow, saturate, sin, smoothstep, step, uniform, uv, vec2, vec3,
} from 'three/tsl';

const TAU = Math.PI * 2;
/** Angular radius of the moon's disc in radians (far larger than life: this is a print). */
export const SAKURA_MOON_RADIUS = 0.062;
const DOME_RADIUS = 1500;

/**
 * Figures drawn with straight lines between stars, in a frame around a centre direction:
 * `at` is [azimuth right of -Z, elevation] in degrees, points are offsets in degrees
 * (times `scale`). They sit in the sky the board card leaves open in the landscape framing.
 */
export const SAKURA_CONSTELLATIONS = Object.freeze([
    {
        name: 'The Fox',
        at: [-22, 19.5],
        scale: 0.42,
        points: [[-9, 1.5], [-5.5, 3.2], [-2.5, 2.2], [1.5, 2.6], [4.5, 4.8], [6.2, 7.6], [7.6, 4.4], [9.6, 2.6],
            [6.6, 1.8], [2, -0.6], [1.2, -4.2], [-3, -0.4], [-4.2, -4.2], [-11.6, 4.6], [-13.4, 8.6]],
        lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 3], [3, 9], [9, 10], [2, 11],
            [11, 12], [0, 13], [13, 14]],
    },
    {
        name: 'The Blossom',
        at: [-14, 18.6],
        scale: 0.45,
        points: [[0, 0], [0, 4.2], [4, 1.3], [2.5, -3.4], [-2.5, -3.4], [-4, 1.3]],
        lines: [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [2, 3], [3, 4], [4, 5], [5, 1]],
    },
    {
        name: 'The Crane',
        at: [-32, 15.5],
        scale: 0.36,
        points: [[-8, -3], [-4, -0.6], [0, 0], [3.4, 2.4], [6, 5.6], [7.6, 4.6], [-1.6, 4.4], [-4.6, 7.6],
            [1.2, -4], [2.4, -7.6]],
        lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [6, 7], [2, 8], [8, 9]],
    },
]);

function skyDirection(azimuth, elevation, target = new THREE.Vector3()) {
    const a = THREE.MathUtils.degToRad(azimuth);
    const e = THREE.MathUtils.degToRad(elevation);
    return target.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

/** A cheap 3D -> 1 hash for star cells. */
function hash3(cell) {
    return fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))).mul(43758.5453));
}

export class SakuraSky {
    constructor({ light, tier, rng = Math.random }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'SakuraSky';
        this.owned = [];
        // How far the constellation lines have drawn (0..1) and how brightly they burn.
        this.uDraw = uniform(0);
        this.uFigures = uniform(0);
        this.uMoonGlow = uniform(0);
        this.uShoot = uniform(new THREE.Vector4(0, 0, -100, 0)); // start x, start y (plane), birth, strength
        this.uShootDir = uniform(new THREE.Vector2(-0.8, -0.35));
        this.shootCount = 0;
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        this.buildDome();
        this.buildConstellations();
        return this;
    }

    /** The moon's disc, corona and ring seen along a unit direction. */
    moon(direction) {
        const { light } = this;
        const axis = light.uMoonDir;
        const right = normalize(cross(vec3(0, 1, 0), axis));
        const up = cross(axis, right);
        const offset = direction.sub(axis.mul(dot(direction, axis)));
        const disc = vec2(dot(offset, right), dot(offset, up)).div(SAKURA_MOON_RADIUS);
        const radius = length(disc);
        const facing = saturate(dot(direction, axis));
        const inside = smoothstep(0.97, 1.0, radius).oneMinus().mul(smoothstep(0.5, 0.9, facing));
        // Seas and highlands from two octaves of the shared noise.
        const seas = light.noise(disc.mul(0.21).add(vec2(0.37, 0.61))).r.mul(0.62)
            .add(light.noise(disc.mul(0.53).add(vec2(0.11, 0.83))).g.mul(0.38));
        const surface = mix(0.5, 1.0, smoothstep(0.36, 0.62, seas))
            .mul(light.noise(disc.mul(1.7)).b.mul(0.16).add(0.92));
        const limb = pow(saturate(float(1).sub(radius.mul(radius))), 0.28);
        // A low moon is warm at its lower limb, where it looks through more air.
        const tint = mix(vec3(1.0, 0.88, 0.8), vec3(0.9, 0.96, 1.08), saturate(disc.y.mul(0.5).add(0.62)));
        const body = tint.mul(surface).mul(limb.mul(0.5).add(0.5)).mul(2.3);
        const angle = radius.mul(SAKURA_MOON_RADIUS);
        const corona = exp(angle.mul(-26)).mul(0.42).add(exp(angle.mul(-7)).mul(0.07));
        const glow = this.uMoonGlow.mul(0.9).add(1);
        return body.mul(inside)
            .add(light.uMoonColor.mul(corona.mul(inside.oneMinus()).mul(glow)).mul(0.62).mul(step(0.2, facing)));
    }

    /** Stars seen along a unit direction: two sizes, each with its own twinkle. */
    stars(direction) {
        const { light } = this;
        let total = float(0);
        [[150, 0.07, 1.0], [70, 0.045, 2.6]].forEach(([scale, size, gain], layer) => {
            const cellPoint = direction.mul(scale);
            const cell = floor(cellPoint);
            const seed = hash3(cell.add(layer * 17.3));
            const centre = vec3(seed, fract(seed.mul(57.31)), fract(seed.mul(113.7))).mul(0.6).add(0.2);
            const distance = length(fract(cellPoint).sub(centre));
            const magnitude = pow(fract(seed.mul(7.13)), 9);
            const twinkle = sin(light.uTime.mul(fract(seed.mul(3.7)).mul(2.6).add(0.9)).add(seed.mul(TAU)))
                .mul(0.3).add(0.7);
            total = total.add(smoothstep(0, size, distance).oneMinus().mul(magnitude).mul(twinkle)
                .mul(gain));
        });
        return total;
    }

    buildDome() {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            side: THREE.BackSide, fog: false, depthWrite: false,
        }));
        material.name = 'SakuraSkyDome';
        const direction = normalize(positionWorld.sub(cameraPosition));
        const sky = light.sky(direction);
        const moonward = saturate(dot(direction, light.uMoonDir));
        // High cirrus: silver toward the moon, rose where the afterglow still reaches it.
        const plane = vec2(direction.x.mul(0.6), direction.z).div(direction.y.add(0.2));
        const drift = light.uTime.mul(0.0022);
        const streaks = light.noise(plane.mul(vec2(0.11, 0.3)).add(vec2(drift, 0.1))).g.mul(0.58)
            .add(light.noise(plane.mul(vec2(0.29, 0.83)).sub(vec2(drift.mul(1.6), 0.3))).b.mul(0.42));
        const cover = smoothstep(0.5, 0.8, streaks).mul(smoothstep(0.015, 0.2, direction.y));
        const flat = normalize(vec2(direction.x, direction.z).add(vec2(0.0001, 0)));
        const toward = dot(flat, light.uGlowDir).mul(0.5).add(0.5);
        const lowness = pow(saturate(direction.y).oneMinus(), 3);
        const cloud = mix(color(0x241a3c), color(0x4a3a6e), streaks)
            .add(light.uAfterglow.mul(pow(toward, 2).mul(lowness).mul(0.5)))
            .add(light.uMoonColor.mul(pow(moonward, 5).mul(0.2).add(pow(moonward, 40).mul(0.5))));
        const clear = cover.mul(0.72).oneMinus();
        const starlight = this.stars(direction).mul(smoothstep(0.02, 0.3, direction.y)).mul(clear)
            .mul(pow(moonward, 12).mul(0.85).oneMinus())
            .mul(pow(toward, 3).mul(lowness).oneMinus());
        const starColour = mix(vec3(0.8, 0.88, 1.25), vec3(1.25, 1.0, 0.85), fract(direction.x.mul(91.7).add(direction.z.mul(47.3))));
        // A shooting star: a short bright streak sliding along a line on the sky plane.
        const shootAge = light.uTime.sub(this.uShoot.z);
        const head = this.uShoot.xy.add(this.uShootDir.mul(shootAge.mul(2.6)));
        const along = dot(plane.sub(head), this.uShootDir);
        const across = length(plane.sub(head).sub(this.uShootDir.mul(along)));
        const streak = smoothstep(0, 0.012, across).oneMinus().mul(smoothstep(-0.9, 0, along)).mul(step(along, 0))
            .mul(saturate(shootAge.mul(6)))
            .mul(exp(shootAge.mul(-1.5)))
            .mul(this.uShoot.w);
        material.colorNode = mix(sky, cloud, cover.mul(0.5))
            .add(starColour.mul(starlight).mul(1.5))
            .add(this.moon(direction).mul(cover.mul(0.5).oneMinus()))
            .add(vec3(1.5, 1.6, 2.2).mul(streak).mul(smoothstep(0.02, 0.2, direction.y)));
        const dome = new THREE.Mesh(this.own(new THREE.SphereGeometry(DOME_RADIUS, 48, 24)), material);
        dome.name = 'SakuraSkyDome';
        dome.renderOrder = -100;
        dome.frustumCulled = false;
        dome.matrixAutoUpdate = false;
        this.dome = dome;
        this.group.add(dome);
    }

    /** Figure stars as soft sprites and their lines as thin quads that draw in along their length. */
    buildConstellations() {
        const starOffsets = [];
        const starLook = [];
        const linePositions = [];
        const lineUv = [];
        const lineIndices = [];
        const centre = new THREE.Vector3();
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const side = new THREE.Vector3();
        const distance = DOME_RADIUS * 0.92;
        let scale = 1;
        const place = (target, point) => target.copy(centre)
            .addScaledVector(right, Math.tan(THREE.MathUtils.degToRad(point[0] * scale)))
            .addScaledVector(up, Math.tan(THREE.MathUtils.degToRad(point[1] * scale)))
            .normalize()
            .multiplyScalar(distance);
        let lineTotal = 0;
        SAKURA_CONSTELLATIONS.forEach((figure) => { lineTotal += figure.lines.length; });
        let drawn = 0;
        SAKURA_CONSTELLATIONS.forEach((figure, figureIndex) => {
            skyDirection(figure.at[0], figure.at[1], centre);
            scale = figure.scale ?? 1;
            right.crossVectors(centre, new THREE.Vector3(0, 1, 0)).normalize();
            up.crossVectors(right, centre).normalize();
            figure.points.forEach((point, index) => {
                place(a, point);
                starOffsets.push(a.x, a.y, a.z);
                starLook.push(0.7 + ((index * 37 + figureIndex * 11) % 10) * 0.05, figureIndex, this.rng(), 0);
            });
            figure.lines.forEach(([from, to]) => {
                place(a, figure.points[from]);
                place(b, figure.points[to]);
                // Stop short of each star so the line reads as a thread between jewels.
                const gap = 0.14;
                const start = a.clone().lerp(b, gap);
                const end = a.clone().lerp(b, 1 - gap);
                side.crossVectors(end.clone().sub(start), start).normalize().multiplyScalar(distance * 0.0011);
                const base = linePositions.length / 3;
                [[start, -1], [start, 1], [end, -1], [end, 1]].forEach(([point, sign], corner) => {
                    linePositions.push(point.x + side.x * sign, point.y + side.y * sign, point.z + side.z * sign);
                    // across (-1..1), and where this end falls in the order the figures are drawn
                    lineUv.push(sign, (drawn + (corner < 2 ? 0 : 1)) / lineTotal);
                });
                lineIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
                drawn += 1;
            });
        });
        const { light } = this;
        // Lines.
        const lineGeometry = this.own(new THREE.BufferGeometry());
        lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
        lineGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(lineUv, 2));
        lineGeometry.setIndex(lineIndices);
        const lineMaterial = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        }));
        lineMaterial.name = 'SakuraConstellationLines';
        const st = uv();
        const reveal = smoothstep(st.y.sub(0.02), st.y.add(0.02), this.uDraw);
        const edge = saturate(float(1).sub(st.x.abs()));
        lineMaterial.colorNode = vec3(0.75, 0.9, 1.5).mul(reveal).mul(edge).mul(this.uFigures)
            .mul(1.7);
        const lines = new THREE.Mesh(lineGeometry, lineMaterial);
        lines.name = 'SakuraConstellationLines';
        lines.frustumCulled = false;
        lines.matrixAutoUpdate = false;
        lines.renderOrder = -90;
        this.group.add(lines);
        // Stars: always faintly there, flaring as their figure is traced.
        const starGeometry = this.own(new THREE.PlaneGeometry(1, 1));
        const starCount = starOffsets.length / 3;
        const offset = instancedBufferAttribute(new THREE.InstancedBufferAttribute(new Float32Array(starOffsets), 3));
        const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(new Float32Array(starLook), 4));
        const starMaterial = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        }));
        starMaterial.name = 'SakuraConstellationStars';
        const toEye = normalize(cameraPosition.sub(offset));
        const spriteRight = normalize(cross(vec3(0, 1, 0), toEye));
        const spriteUp = cross(toEye, spriteRight);
        const size = look.x.mul(this.uFigures.mul(1.4).add(1)).mul(distance * 0.011);
        starMaterial.positionNode = offset.add(spriteRight.mul(positionGeometry.x.mul(size)))
            .add(spriteUp.mul(positionGeometry.y.mul(size)));
        const reach = length(uv().sub(0.5)).mul(2);
        const core = exp(reach.mul(reach).mul(-26)).add(exp(reach.mul(-5)).mul(0.16)).mul(saturate(float(1).sub(reach)));
        const cross4 = max(exp(uv().x.sub(0.5).abs().mul(-90)), exp(uv().y.sub(0.5).abs().mul(-90)))
            .mul(saturate(float(1).sub(reach))).mul(0.5);
        const twinkle = sin(light.uTime.mul(look.z.mul(2).add(1.3)).add(look.z.mul(TAU))).mul(0.2).add(0.8);
        starMaterial.colorNode = vec3(0.85, 0.95, 1.5).mul(core.add(cross4.mul(this.uFigures)))
            .mul(twinkle).mul(this.uFigures.mul(2.4).add(0.7));
        const stars = new THREE.InstancedMesh(starGeometry, starMaterial, starCount);
        stars.name = 'SakuraConstellationStars';
        stars.frustumCulled = false;
        stars.matrixAutoUpdate = false;
        stars.renderOrder = -89;
        this.group.add(stars);
    }

    /** Send one shooting star across the upper sky. */
    shoot(strength = 1) {
        const { rng } = this;
        this.shootCount += 1;
        const leftward = this.shootCount % 2 === 0;
        this.uShoot.value.set((leftward ? 0.5 : -0.9) + rng() * 0.5, -1.1 - rng() * 0.9, this.light.uTime.value, strength);
        this.uShootDir.value.set(leftward ? -0.86 : 0.86, 0.34 + rng() * 0.2).normalize();
    }

    update(frame = {}) {
        const clamp01 = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);
        this.uDraw.value = clamp01(frame.constellation);
        this.uFigures.value = clamp01(frame.figures);
        this.uMoonGlow.value = clamp01(frame.moon);
    }

    reset() {
        this.uShoot.value.set(0, 0, -100, 0);
        this.uDraw.value = 0;
        this.uFigures.value = 0;
        this.uMoonGlow.value = 0;
    }

    dispose() {
        this.group.traverse((object) => {
            if (object.isInstancedMesh) object.dispose();
        });
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
    }
}
