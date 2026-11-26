import * as THREE from 'three/webgpu';
import {
    Fn, abs, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cos, cross, dot, exp,
    instanceIndex, length, max, mix, normalize, sin, smoothstep, texture, uniformArray, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { EJECTA } from './black-hole-director.js';
import { lensPoint } from './black-hole-matter.js';

const TAU = Math.PI * 2;
const FAMILIES = [EJECTA.TWIST, EJECTA.B2B, EJECTA.CROWN];
const STRANDS = { [EJECTA.TWIST]: 2, [EJECTA.B2B]: 2, [EJECTA.CROWN]: 5 };
const CAPACITY = 9;

/** Coronal loops rooted in the gas. One parked draw holds the three special-clear signatures. */
export class BlackHoleMagneticArcs {
    constructor(matter, segments) {
        const table = () => uniformArray(Array.from({ length: CAPACITY }, () => new THREE.Vector4()), 'vec4');
        this.paths = table(); // azimuth at the foot, angle swept, foot radius, outward bow
        this.forms = table(); // height, braid amplitude, braid angle, sheet width
        this.light = table(); // colour and envelope
        this.newest = [];
        const u = matter.uniforms;
        const path = this.paths.element(instanceIndex);
        const form = this.forms.element(instanceIndex);
        const tint = this.light.element(instanceIndex);
        const t = uv().x;
        const arch = sin(t.mul(Math.PI));
        const coil = t.mul(11.4).add(form.z);
        const az = path.x.add(t.mul(path.y));
        const radius = path.z.add(arch.mul(path.w.add(cos(coil).mul(form.y))));
        const height = arch.mul(form.x.add(sin(coil).mul(form.y)));
        const local = vec3(cos(az).mul(radius), height, sin(az).mul(radius));
        const source = u.holePosition.add(u.diskToWorld.mul(local).mul(u.rs));
        const apparent = lensPoint(u, source);
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            premultipliedAlpha: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide,
            fog: false,
        });
        material.name = 'Black Hole — magnetic arcs';
        material.forceSinglePass = true;
        material.vertexNode = Fn(() => {
            const crest = cos(t.mul(Math.PI)).mul(Math.PI);
            const dr = crest.mul(path.w.add(cos(coil).mul(form.y)))
                .sub(arch.mul(sin(coil)).mul(form.y).mul(11.4));
            const dh = crest.mul(form.x.add(sin(coil).mul(form.y)))
                .add(arch.mul(cos(coil)).mul(form.y).mul(11.4));
            const sweep = radius.mul(path.y);
            const tangent = vec3(cos(az).mul(dr).sub(sin(az).mul(sweep)), dh, sin(az).mul(dr).add(cos(az).mul(sweep)));
            // Extrude perpendicular to the *lensed* tangent. At a turn straight toward
            // the eye the sheet tapers away before its screen-space normal reverses.
            const sourceStep = u.diskToWorld.mul(tangent).mul(u.rs.mul(0.002)).toVar();
            const step = lensPoint(u, source.add(sourceStep)).position.sub(apparent.position).toVar();
            const side = cross(step, normalize(cameraPosition.sub(apparent.position))).toVar();
            const across = side.div(max(length(side), length(sourceStep).mul(0.24)).max(0.001));
            const width = form.w.mul(arch.mul(0.55).add(0.45)).mul(u.rs).mul(uv().y.mul(2).sub(1));
            const point = apparent.position.add(across.mul(width));
            return cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(point, 1));
        })();
        // Hot strands run through a softer body and braid as the gas travels up the loop.
        // The outer edge fades to zero on both sides of the strip.
        const side = uv().y.mul(2).sub(1);
        const phase = uv().x.mul(18).add(varying(form.z));
        const fibre = side.sub(sin(phase).mul(0.23));
        const body = exp(side.mul(side).mul(-3.9)).mul(0.25);
        const core = exp(fibre.mul(fibre).mul(-37));
        const fringe = smoothstep(0.7, 1, abs(side)).oneMinus();
        const eye = normalize(u.holePosition.sub(cameraPosition));
        const relative = apparent.position.sub(cameraPosition);
        const impact = length(relative.sub(eye.mul(dot(relative, eye)))).div(u.rs);
        const brightness = varying(tint.w.mul(apparent.visible).mul(smoothstep(2.62, 3.25, impact)));
        const flow = texture(matter.gasTexture, vec2(
            uv().x.mul(1.12).sub(varying(form.z).mul(0.043)),
            uv().y.mul(0.31).add(sin(phase.mul(0.27)).mul(0.17)).add(varying(form.z).mul(0.16)),
        ));
        const tongue = smoothstep(0.29, 0.70, flow.r.mul(0.7).add(flow.b.mul(0.3)));
        const foot = abs(uv().x.mul(2).sub(1));
        const gleam = tongue.mul(0.92).add(0.08).mul(foot.mul(0.6).add(0.40));
        const colour = varying(tint.rgb);
        const sparks = exp(abs(fibre.add(flow.g.sub(0.5).mul(1.28))).mul(-11))
            .mul(smoothstep(0.41, 0.73, flow.a)).mul(1.25);
        material.outputNode = vec4(colour.mul(body.mul(flow.g).mul(1.5).add(sparks))
            .add(mix(colour, vec3(1, 0.93, 0.84), 0.38).mul(core).mul(0.8))
            .mul(gleam).mul(fringe)
            .mul(brightness), 0);
        this.geometry = new THREE.PlaneGeometry(1, 1, segments, 1);
        this.mesh = new THREE.InstancedMesh(this.geometry, material, CAPACITY);
        this.mesh.name = material.name;
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 33;
        this.mesh.visible = false;
        matter.group.add(this.mesh);
    }

    update(bursts, reduced) {
        this.newest.fill(null);
        for (const burst of bursts) {
            if (!burst.active || !STRANDS[burst.family]) continue;
            const previous = this.newest[burst.family];
            if (!previous || burst.age < previous.age) this.newest[burst.family] = burst;
        }
        let row = 0;
        for (const family of FAMILIES) {
            const burst = this.newest[family];
            if (!burst) continue;
            const { age, seed } = burst;
            const life = age / burst.duration;
            const opening = reduced ? 0.85 : 0.24 + 0.76 * THREE.MathUtils.smoothstep(age, 0, 0.85);
            const fade = THREE.MathUtils.smoothstep(age, 0, 0.32) * (1 - THREE.MathUtils.smoothstep(life, 0.34, 0.97));
            if (fade <= 0.002) continue;
            const clock = reduced ? 0 : age;
            const az = (seed % TAU) + clock * 0.23;
            for (let i = 0; i < STRANDS[family]; i += 1) {
                const path = this.paths.array[row];
                const form = this.forms.array[row];
                const light = this.light.array[row];
                if (family === EJECTA.TWIST) {
                    path.set(az, 2.60, 3.85, 2.3 * opening);
                    form.set(3.6 * opening, 0.37, i * Math.PI - clock * 2.3, 0.32);
                    light.set(0.63 + i * 0.14, 0.16 + i * 0.16, 1, fade * 2.6);
                } else if (family === EJECTA.B2B) {
                    path.set(az + i * Math.PI, 1.74, 4.2, 4.5 * opening);
                    form.set((i ? -1.8 : 1.8) * opening, 0.12, i * 2.2 - clock, 0.42);
                    light.set(0.12, 0.62 + i * 0.13, 1, fade * 2.85);
                } else {
                    // Unequal neighbouring feet rise in arcades on both faces of the disk.
                    const side = i < 3 ? 1 : -1;
                    const width = 0.30 + (i % 3) * 0.12;
                    const sector = i < 3 ? i * 0.36 : Math.PI + (i - 3) * 0.57;
                    path.set(az + sector, 0.84 + (i % 3) * 0.24, 4.15 + (i % 2) * 0.93, 2.5 + i * 0.24);
                    const height = 2.6 + 2.3 * Math.sin(i * 1.7 + 0.86) ** 2;
                    form.set(side * height * opening, 0.18, i - clock * 1.4, width);
                    light.set(1, 0.28 + (i % 3) * 0.13, 0.055, fade * 3.15);
                }
                row += 1;
            }
        }
        this.mesh.visible = row > 0;
        this.mesh.count = Math.max(row, 1); // warm-up can draw the parked, zero-light row
        if (row === 0) this.light.array[0].w = 0;
    }

    dispose() {
        this.mesh.removeFromParent();
        this.mesh.dispose();
        this.mesh.material.dispose();
        this.geometry.dispose();
    }
}
