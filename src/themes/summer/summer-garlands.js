/**
 * Summer — the ribbons a combo winds around the board.
 *
 * Silk ribbons in the colours of the flowers, like the ones tied to a maypole: as a combo
 * builds they unfurl from the foot of the board and climb around it in slow spirals, behind
 * the crown of petals. They are hidden — not merely transparent — until a combo calls them,
 * so they cost nothing at rest, and because they are part of the scene the lake shows them
 * too.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, cos, cross, dot, normalize, positionWorld, pow, saturate, sin, smoothstep, uniform, uv, vec3,
} from 'three/tsl';

// Colour, turns around the board, starting angle, radius, half-width, phase.
const RIBBONS = [
    [0x2f6fd8, 1.25, 0.0, 2.7, 0.055, 0.0],
    [0xffcf2e, 1.1, 2.2, 3.0, 0.05, 2.1],
    [0xe2402c, 1.4, 4.1, 2.5, 0.045, 4.2],
    [0x9a5fe0, 1.0, 1.1, 3.3, 0.055, 5.5],
    [0xff8a2e, 1.3, 3.3, 2.9, 0.045, 1.3],
    [0xfaf6ea, 1.15, 5.2, 3.2, 0.05, 3.4],
];
/** The spirals are flattened toward the camera, so no ribbon swings close to the lens. */
const DEPTH_SQUASH = 0.6;

export class SummerGarlands {
    constructor({ light, tier }) {
        this.light = light;
        this.tier = tier;
        this.group = new THREE.Group();
        this.group.name = 'SummerGarlands';
        this.uLevel = uniform(0);
        this.uHeat = uniform(0);
        /** The middle of the board in the world, and how tall it stands there (x, y, z, height). */
        this.uBoard = uniform(new THREE.Vector4(0, 4, 6, 3.4));
        // Shown (at zero strength) for the first frames so their pipelines exist before a combo.
        this.warmFrames = 4;
        this.owned = [];
    }

    build() {
        const { light } = this;
        const geometry = new THREE.PlaneGeometry(1, 1, 120, 2);
        this.owned.push(geometry);
        RIBBONS.slice(0, this.tier.ribbons).forEach(([hue, turns, start, radius, width, phase], index) => {
            const silk = new THREE.Color(hue);
            const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
            material.name = `SummerGarland ${index}`;
            const t = light.uTime;
            const st = uv();
            const board = this.uBoard;
            // A spiral that climbs from the foot of the board to above its head, breathing in
            // and out and turning slowly as a whole.
            const path = (u) => {
                const angle = u.mul(turns * Math.PI * 2).add(start).add(t.mul(0.22 + index * 0.03));
                const reach = sin(u.mul(5).add(t.mul(0.5)).add(phase)).mul(0.28).add(radius);
                return vec3(
                    board.x.add(cos(angle).mul(reach)),
                    board.y.add(u.sub(0.5).mul(board.w).mul(1.25))
                        .add(sin(u.mul(9).sub(t.mul(0.9)).add(phase)).mul(0.16)),
                    board.z.add(sin(angle).mul(reach).mul(DEPTH_SQUASH)),
                );
            };
            const here = path(st.x);
            const tangent = normalize(path(st.x.add(0.01)).sub(here));
            const toEye = normalize(cameraPosition.sub(here));
            const side = normalize(cross(tangent, toEye));
            const across = st.y.mul(2).sub(1);
            // The ribbon twists along its length, so it shows now its face and now its edge.
            const twist = cos(st.x.mul(11).add(t.mul(0.8)).add(phase));
            const breadth = pow(sin(st.x.mul(Math.PI)), 0.5).mul(width).mul(twist.abs().mul(0.8).add(0.2));
            material.positionNode = here.add(side.mul(across.mul(breadth)));
            const world = positionWorld;
            const view = normalize(cameraPosition.sub(world));
            const tone = vec3(silk.r, silk.g, silk.b);
            const sun = light.sunlight();
            const through = pow(saturate(dot(view, light.uSunDir).negate()), 2.4);
            // Silk: a sheen that runs along the ribbon as it twists.
            const sheen = pow(twist.abs(), 6).mul(0.5);
            const lit = tone.mul(twist.mul(0.2).add(0.8)).mul(light.uSunColor).mul(sun)
                .mul(through.mul(0.34).add(0.2).add(sheen.mul(0.3)))
                .add(tone.mul(light.ambient(vec3(0, 0.7, 0.3))).mul(0.95))
                .add(tone.mul(this.uHeat.mul(0.5)));
            // It draws itself from the foot of the board as the combo builds.
            const reveal = smoothstep(st.x.sub(0.25), st.x, this.uLevel.mul(1.25));
            material.colorNode = light.haze(lit, { world });
            material.maskNode = reveal.mul(saturate(this.uLevel.mul(8))).greaterThan(0.5);
            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = `SummerGarland ${index}`;
            mesh.frustumCulled = false;
            mesh.matrixAutoUpdate = false;
            mesh.castShadow = false;
            mesh.visible = false;
            this.group.add(mesh);
            this.owned.push(material);
        });
        return this;
    }

    /** Tell the ribbons where the board stands. */
    setBoard(centre, height) {
        if (!centre || !Number.isFinite(centre.x)) return;
        this.uBoard.value.set(centre.x, centre.y, centre.z, Number.isFinite(height) ? height : 3.4);
    }

    update(frame = {}) {
        const level = Number.isFinite(frame.ribbons) ? THREE.MathUtils.clamp(frame.ribbons, 0, 1) : 0;
        this.uLevel.value = level;
        this.uHeat.value = Number.isFinite(frame.heat) ? THREE.MathUtils.clamp(frame.heat, 0, 1) : 0;
        if (this.warmFrames > 0) this.warmFrames -= 1;
        const showing = level > 0.004 || this.warmFrames > 0;
        this.group.children.forEach((mesh) => {
            const ribbon = mesh;
            ribbon.visible = showing;
        });
    }

    dispose() {
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
    }
}
