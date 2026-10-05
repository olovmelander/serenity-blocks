/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, dot, exp, float, length, mix, positionGeometry, pow,
    smoothstep, texture, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';

/** Edge-to-edge distant sky plus two spatial cloud banks. No raymarch or asset fetch. */
export class StellarDriftBackdrop {
    constructor({ parent, noise, time }) {
        this.parent = parent;
        this.noise = noise;
        this.time = time;
        this.aspect = uniform(16 / 9);
        this.clouds = [];
    }

    build() {
        const sky = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false, fog: false });
        sky.name = 'stellar-drift-infinite-nebula';
        // Clip-space coverage is independent of camera distance, FOV and aspect ratio.
        sky.vertexNode = vec4(positionGeometry.xy.mul(2), 1, 1);
        sky.emissiveNode = vec3(0);
        sky.colorNode = Fn(() => {
            const screen = uv().toVar();
            const q = screen.sub(0.5).mul(vec2(this.aspect, 1)).add(vec2(0.62, 0.5)).toVar();
            const drift = vec2(this.time.mul(0.0008), this.time.mul(-0.0003));
            const broad = texture(this.noise, q.mul(1.35).add(drift)).rgb.toVar();
            const coords = q.mul(vec2(1.5, 2.1)).add(broad.rg.sub(0.5).mul(0.44)).toVar();
            const sculpt = texture(this.noise, coords.mul(2.9)).rgb.toVar();
            const fine = texture(this.noise, coords.mul(11.5).add(sculpt.rg.mul(0.25))).rgb.toVar();
            const ridge = abs(q.y.sub(q.x.mul(0.36)).sub(0.35).add(broad.g.sub(0.5).mul(0.38))).toVar();
            const bank = exp(ridge.mul(-5.8)).toVar();
            const density = smoothstep(0.29, 0.68, broad.r.add(sculpt.g.mul(0.18))).mul(bank).toVar();
            const veil = smoothstep(0.28, 0.62, sculpt.b).mul(density).toVar();
            const lace = pow(smoothstep(0.32, 0.72, sculpt.r), 2.3)
                .mul(fine.g.mul(0.45).add(0.55)).mul(density).toVar();
            const cyan = exp(length(q.sub(vec2(1.16, 0.76)).mul(vec2(0.85, 1.4))).mul(-2.9)).toVar();
            const rose = exp(length(q.sub(vec2(0.36, 0.42)).mul(vec2(1.2, 1.7))).mul(-3.7)).toVar();
            const tint = mix(vec3(0.14, 0.025, 0.31), vec3(0.025, 0.25, 0.34), cyan.mul(1.8).clamp(0, 1));
            const litGas = tint.mul(density).mul(0.8)
                .add(vec3(0.02, 0.31, 0.43).mul(lace).mul(cyan.mul(0.95).add(0.12)))
                .add(vec3(0.38, 0.045, 0.20).mul(rose).mul(veil).mul(0.8));
            // Backlit dust silhouettes carve cavities into the lit cloud bank.
            const darkLane = exp(abs(ridge.sub(0.095).add(sculpt.b.sub(0.5).mul(0.10))).mul(-34))
                .mul(smoothstep(0.35, 0.63, broad.b)).mul(0.73);
            const color = vec3(0.004, 0.008, 0.024).add(litGas.mul(float(1).sub(darkLane)))
                .add(vec3(0.012, 0.028, 0.044).mul(cyan))
                .add(vec3(0.035, 0.012, 0.028).mul(rose));
            // Preserve a quiet central field behind the board without empty screen margins.
            const quiet = exp(dot(
                screen.sub(vec2(0.50, 0.45)).mul(vec2(6, 2.0)),
                screen.sub(vec2(0.50, 0.45)).mul(vec2(6, 2.0)),
            ).negate()).mul(0.18);
            return color.mul(float(1).sub(quiet));
        })();
        this.sky = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sky);
        this.sky.name = 'stellar-drift-fullscreen-nebula';
        this.sky.renderOrder = -100; this.sky.frustumCulled = false;
        this.parent.add(this.sky);

        const sun = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
        sun.name = 'stellar-drift-distant-sun';
        const sunField = Fn(() => {
            const p = uv().sub(0.5).mul(2).toVar();
            const radius = length(p).toVar();
            const core = exp(dot(p, p).mul(-480)).toVar();
            const aureole = exp(radius.mul(-8)).mul(0.20).toVar();
            const diffraction = exp(abs(p.y).mul(-160)).mul(exp(abs(p.x).mul(-12)))
                .add(exp(abs(p.x).mul(-160)).mul(exp(abs(p.y).mul(-12)))).mul(0.35);
            const alpha = core.add(aureole).add(diffraction).mul(float(1).sub(smoothstep(0.70, 1, radius)));
            return vec4(mix(vec3(1.2, 0.58, 0.22), vec3(3.2, 2.7, 1.9), core), alpha);
        })();
        sun.colorNode = sunField.rgb; sun.opacityNode = sunField.a;
        sun.emissiveNode = sunField.rgb.mul(sunField.a).mul(0.7);
        this.sun = new THREE.Mesh(new THREE.PlaneGeometry(19, 19), sun);
        this.sun.name = 'stellar-drift-key-star'; this.sun.position.z = -100;
        this.sun.renderOrder = -60; this.parent.add(this.sun);

        for (let i = 0; i < 2; i += 1) {
            const cloud = new THREE.MeshBasicNodeMaterial({
                transparent: true, depthWrite: false, fog: false,
            });
            cloud.name = `stellar-drift-spatial-cloud-${i}`;
            const field = Fn(() => {
                const q = uv().toVar();
                const coords = q.mul(vec2(2.3, 1.8)).add(vec2(i * 0.71, this.time.mul(0.0006)));
                const n = texture(this.noise, coords).rgb.toVar();
                const detail = texture(this.noise, q.mul(9).add(n.rg.mul(0.35))).rgb.toVar();
                const edge = pow(q.x.mul(float(1).sub(q.x)).mul(q.y).mul(float(1).sub(q.y)).mul(16), 1.3);
                const density = smoothstep(0.40, 0.67, n.r.add(detail.g.mul(0.1))).mul(edge);
                const color = mix(
                    vec3(0.013, 0.018, 0.035),
                    i === 0 ? vec3(0.032, 0.10, 0.14) : vec3(0.07, 0.025, 0.095),
                    detail.b,
                );
                return vec4(color, density.mul(i === 0 ? 0.23 : 0.16));
            })();
            cloud.colorNode = field.rgb; cloud.opacityNode = field.a; cloud.emissiveNode = vec3(0);
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), cloud);
            mesh.name = `stellar-drift-cloud-bank-${i}`;
            mesh.position.z = i === 0 ? -80 : -26;
            mesh.renderOrder = -70 + i; mesh.frustumCulled = false;
            this.parent.add(mesh); this.clouds.push(mesh);
        }
        return this;
    }

    resize(aspect, halfHeight) {
        this.aspect.value = aspect;
        this.sun.position.x = -halfHeight * aspect * (145 / 45) * 0.72;
        this.sun.position.y = halfHeight * (145 / 45) * 0.76;
        this.clouds.forEach((mesh, index) => {
            const depthScale = (45 - mesh.position.z) / 45;
            mesh.scale.set(halfHeight * aspect * depthScale * 2.3, halfHeight * depthScale * 2.3, 1);
            mesh.position.x = halfHeight * aspect * (index === 0 ? 0.45 : -0.42);
            mesh.position.y = halfHeight * (index === 0 ? 0.35 : -0.62);
        });
    }
}
