/**
 * Aether Tides Simulator - Extended Fluid Simulator with Gravity Wells
 * Based on FluidSimulator with added gravity and ambient motion features
 * License: MIT
 */

import FluidSimulator from './fluid-simulator.js';

export default class AetherTidesSimulator extends FluidSimulator {
    constructor(canvas, config = {}) {
        // Call parent constructor first with merged config
        super(canvas, {
            SIM_RESOLUTION: 128,
            DYE_RESOLUTION: 1024,
            CAPTURE_RESOLUTION: 512,
            DENSITY_DISSIPATION: 0.98, // Slower dissipation for nebula
            VELOCITY_DISSIPATION: 0.99, // Keep momentum
            PRESSURE: 0.8,
            PRESSURE_ITERATIONS: 20,
            CURL: 40,
            SPLAT_RADIUS: 0.25,
            SPLAT_FORCE: 6000,
            SHADING: true,
            COLORFUL: true,
            COLOR_UPDATE_SPEED: 10,
            PAUSED: false,
            BACK_COLOR: { r: 0, g: 0, b: 0 },
            TRANSPARENT: false,
            BLOOM: true,
            BLOOM_ITERATIONS: 8,
            BLOOM_RESOLUTION: 256,
            BLOOM_INTENSITY: 0.8,
            BLOOM_THRESHOLD: 0.6,
            BLOOM_SOFT_KNEE: 0.7,
            SUNRAYS: false,
            SUNRAYS_RESOLUTION: 196,
            SUNRAYS_WEIGHT: 1.0,
            ...config,
        });
    }

    /**
     * Override initPrograms to add gravity shader
     */
    initPrograms() {
        // Call parent initPrograms first
        super.initPrograms();

        const { gl } = this;

        // Base vertex shader (needed for gravity program)
        const baseVertexShaderSource = `
            precision highp float;
            attribute vec2 aPosition;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform vec2 texelSize;
            void main () {
                vUv = aPosition * 0.5 + 0.5;
                vL = vUv - vec2(texelSize.x, 0.0);
                vR = vUv + vec2(texelSize.x, 0.0);
                vT = vUv + vec2(0.0, texelSize.y);
                vB = vUv - vec2(0.0, texelSize.y);
                gl_Position = vec4(aPosition, 0.0, 1.0);
            }
        `;

        // Gravity shader for pulling/pushing fluid
        const gravityShaderSource = `
            precision highp float;
            precision highp sampler2D;
            varying vec2 vUv;
            uniform sampler2D uVelocity;
            uniform vec2 point;
            uniform float force;
            uniform float radius;
            uniform float aspectRatio;
            uniform float dt;
            void main () {
                vec2 p = vUv - point.xy;
                p.x *= aspectRatio;
                float dist = length(p);
                vec2 vel = texture2D(uVelocity, vUv).xy;
                
                if (dist < radius) {
                    vec2 dir = normalize(p);
                    // Force falls off with distance
                    float strength = (1.0 - dist / radius) * force;
                    // Apply force towards center (negative force) or away (positive)
                    vel += dir * strength * dt;
                }
                
                gl_FragColor = vec4(vel, 0.0, 1.0);
            }
        `;

        const baseVertexShader = this.compileShader(gl.VERTEX_SHADER, baseVertexShaderSource);
        const gravityShader = this.compileShader(gl.FRAGMENT_SHADER, gravityShaderSource);

        // Create program using the Program class from parent
        this.programs.gravity = this.createProgram(baseVertexShader, gravityShader);
    }

    /**
     * Helper to create a program (mimics the Program class from FluidSimulator)
     */
    createProgram(vertexShader, fragmentShader) {
        const { gl } = this;
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(program));
        }

        const uniforms = {};
        const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < uniformCount; i++) {
            const uniformName = gl.getActiveUniform(program, i).name;
            uniforms[uniformName] = gl.getUniformLocation(program, uniformName);
        }

        return {
            program,
            uniforms,
            bind() {
                gl.useProgram(program);
            },
        };
    }

    /**
     * NEW METHOD: Apply gravitational forces to the velocity field
     * @param {number} x - X position (0-1)
     * @param {number} y - Y position (0-1)
     * @param {number} force - Force strength (negative = pull, positive = push)
     * @param {number} radius - Radius of effect (0-1)
     * @param {number} dt - Delta time
     */
    applyGravity(x, y, force, radius, dt) {
        const { gl } = this;

        if (!this.programs.gravity) {
            console.error('[AetherTides] Gravity program not initialized');
            return;
        }

        this.programs.gravity.bind();
        gl.uniform1i(this.programs.gravity.uniforms.uVelocity, this.velocity.read.attach(0));
        gl.uniform2f(this.programs.gravity.uniforms.point, x, y);
        gl.uniform1f(this.programs.gravity.uniforms.force, force);
        gl.uniform1f(this.programs.gravity.uniforms.radius, this.correctRadius(radius / 100.0));
        gl.uniform1f(this.programs.gravity.uniforms.aspectRatio, this.canvas.width / this.canvas.height);
        gl.uniform1f(this.programs.gravity.uniforms.dt, dt);

        this.blit(this.velocity.write);
        this.velocity.swap();
    }
}
