/**
 * Golden Forest — ribbons of light.
 *
 * What a long combo draws across the sky: a few slow ribbons that unfurl from the sun's
 * side of the lake and arch over the water, strands of gold flowing along them. They are
 * hidden — not merely dark — until a combo calls them, so they cost nothing at rest, and
 * because they are part of the scene the lake shows them too.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, cos, cross, exp, float, mix, normalize, pow, sin, smoothstep, uniform, uv, vec2, vec3,
} from 'three/tsl';

// From, to, how high the arch lifts, how far it wanders, width and a phase.
const PATHS = [
    [[-130, 58, -330], [200, 74, -250], 52, 15, 8, 0.0],
    [[-155, 46, -300], [130, 112, -165], 36, 12, 6, 2.1],
    [[-105, 72, -345], [270, 44, -300], 66, 18, 7, 4.2],
    [[-170, 88, -360], [90, 140, -210], 30, 14, 5.5, 5.5],
];

export class GoldenForestRibbons {
    constructor({ light, tier }) {
        this.light = light;
        this.tier = tier;
        this.group = new THREE.Group();
        this.group.name = 'GoldenForestRibbons';
        this.uLevel = uniform(0);
        this.uHeat = uniform(0);
        // Shown (at zero strength) for the first frames so their pipelines exist before a combo.
        this.warmFrames = 4;
        this.owned = [];
    }

    build() {
        const { light } = this;
        const geometry = new THREE.PlaneGeometry(1, 1, 96, 4);
        this.owned.push(geometry);
        PATHS.slice(0, this.tier.ribbons).forEach(([from, to, arch, wander, width, phase], index) => {
            const material = new THREE.MeshBasicNodeMaterial({
                transparent: true,
                depthWrite: false,
                fog: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
            });
            material.name = `GoldenForestRibbon ${index}`;
            const t = light.uTime;
            const st = uv();
            const path = (u) => mix(vec3(...from), vec3(...to), u)
                .add(vec3(0, sin(u.mul(Math.PI)).mul(arch), 0))
                .add(vec3(
                    sin(u.mul(7).add(t.mul(0.35)).add(phase)).mul(wander),
                    sin(u.mul(5).sub(t.mul(0.27)).add(phase * 2)).mul(wander * 0.45),
                    cos(u.mul(6).add(t.mul(0.22)).add(phase)).mul(wander * 0.6),
                ));
            const here = path(st.x);
            const tangent = normalize(path(st.x.add(0.012)).sub(here));
            const side = normalize(cross(tangent, normalize(cameraPosition.sub(here))));
            const across = st.y.mul(2).sub(1);
            const swell = sin(st.x.mul(9).sub(t.mul(0.8)).add(phase)).mul(0.4).add(0.6);
            const breadth = pow(sin(st.x.mul(Math.PI)), 0.6).mul(width).mul(swell).mul(this.uLevel.mul(0.65).add(0.35));
            material.positionNode = here.add(side.mul(across.mul(breadth)));
            // Strands flow along the ribbon; it draws itself from the sun's end as the combo builds.
            const broad = vec2(st.x.mul(2.2).sub(t.mul(0.06)).sub(phase), across.mul(0.18).add(phase));
            const flow = light.noise(broad).g.mul(0.6)
                .add(light.noise(vec2(st.x.mul(6).sub(t.mul(0.13)), across.mul(0.4))).b.mul(0.4));
            let strands = float(0);
            for (let strand = 0; strand < 4; strand += 1) {
                const lane = sin(st.x.mul(5 + strand * 1.7).add(t.mul(0.45 + strand * 0.13)).add(phase + strand * 1.9))
                    .mul(0.62);
                const pulse = sin(st.x.mul(13).sub(t.mul(1.9)).add(strand * 2.3)).mul(0.35).add(0.65);
                strands = strands.add(exp(across.sub(lane).div(0.07).pow2().negate()).mul(pulse));
            }
            // A breath of glow between the filaments, uneven like drifting smoke.
            strands = strands.add(smoothstep(0.4, 0.8, flow).mul(0.16));
            const edge = pow(across.mul(across).oneMinus(), 1.5);
            const ends = smoothstep(0, 0.12, st.x).mul(smoothstep(1, 0.82, st.x));
            const reveal = smoothstep(st.x.sub(0.3), st.x, this.uLevel.mul(1.3));
            material.colorNode = mix(vec3(1.0, 0.36, 0.05), vec3(1.0, 0.7, 0.26), this.uHeat).mul(1.5);
            material.opacityNode = strands.mul(edge).mul(ends).mul(reveal).mul(this.uLevel)
                .mul(float(0.7));
            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = `GoldenForestRibbon ${index}`;
            mesh.frustumCulled = false;
            mesh.matrixAutoUpdate = false;
            mesh.renderOrder = 20 + index;
            mesh.visible = false;
            this.group.add(mesh);
            this.owned.push(material);
        });
        return this;
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
