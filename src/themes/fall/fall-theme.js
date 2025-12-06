/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🍂 SUNSET SERENITY 🍂
 *  A 3D Fall Theme for Serenity Blocks using Three.js
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { FALL_TETROMINOS } from './fall-tetrominos.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: Textured Leaves
// ─────────────────────────────────────────────────────────────────────────────
function createLeafTexture() {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');

    ctx.translate(64, 64);
    ctx.scale(1.8, 1.8);

    // Gradient: Soft White -> Light Grey
    const grad = ctx.createRadialGradient(0, -10, 0, 0, 0, 40);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#bbbbbb');

    ctx.fillStyle = grad;

    // Maple Shape
    ctx.beginPath();
    ctx.moveTo(0, -30);
    ctx.quadraticCurveTo(10, -10, 25, -15);
    ctx.quadraticCurveTo(15, 0, 28, 10);
    ctx.quadraticCurveTo(10, 10, 5, 30);
    ctx.lineTo(0, 35);
    ctx.lineTo(-5, 30);
    ctx.quadraticCurveTo(-10, 10, -28, 10);
    ctx.quadraticCurveTo(-15, 0, -25, -15);
    ctx.quadraticCurveTo(-10, -10, 0, -30);
    ctx.fill();

    // Noise
    ctx.globalCompositeOperation = 'multiply';
    for (let i = 0; i < 150; i++) {
        ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.15})`;
        ctx.beginPath();
        ctx.arc((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, Math.random() * 2, 0, Math.PI * 2);
        ctx.fill();
    }

    // Veins
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(80, 40, 0, 0.5)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(0, 30); ctx.lineTo(0, -26);
    for (let i = 1; i <= 3; i++) {
        const y = 20 - i * 10;
        ctx.moveTo(0, y); ctx.lineTo(15 + i * 2, y - 15);
        ctx.moveTo(0, y); ctx.lineTo(-(15 + i * 2), y - 15);
    }
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
}

function createBarkTexture() {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Base Brown
    ctx.fillStyle = '#3a2010';
    ctx.fillRect(0, 0, 512, 512);

    // Vertical Ridges (Displacement) - High Contrast
    for (let i = 0; i < 80; i++) {
        const x = Math.random() * 512;
        const w = 10 + Math.random() * 40; // Wider ridges
        // Darker deep cracks
        ctx.fillStyle = `rgba(0,0,0, ${0.7 + Math.random() * 0.3})`;
        ctx.fillRect(x, 0, w, 512);

        // Brighter highlights for ridges (Side lighting simulation)
        const grad = ctx.createLinearGradient(x, 0, x + w, 0);
        grad.addColorStop(0, 'rgba(255,255,255,0.0)');
        grad.addColorStop(0.1, 'rgba(255,255,255,0.4)'); // Highlight edge
        grad.addColorStop(1, 'rgba(0,0,0,0.5)'); // Shadow edge
        ctx.fillStyle = grad;
        ctx.fillRect(x, 0, w, 512);
    }

    // Noise / Cracks
    for (let i = 0; i < 2000; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        ctx.fillStyle = 'rgba(0,0,0,0.9)';
        ctx.fillRect(x, y, 3, 15 + Math.random() * 30);
    }

    // KNOTS (New Feature for User Reference)
    for (let i = 0; i < 30; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const r = 10 + Math.random() * 20;

        // Knot dark center
        ctx.fillStyle = 'rgba(20,10,5,0.9)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();

        // Knot Highlight rings
        ctx.strokeStyle = 'rgba(100,60,30,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 2, 0, Math.PI * 2);
        ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 20); // Denser repeat to prevent stretching
    return tex;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: { leafCount: 4000, treeCount: 150, emberCount: 400, streakCount: 300, vortexCount: 300, enablePost: true, bloomStrength: 0.5 },
    Ultra: { leafCount: 3000, treeCount: 100, emberCount: 300, streakCount: 200, vortexCount: 200, enablePost: true, bloomStrength: 0.4 },
    High: { leafCount: 2000, treeCount: 80, emberCount: 200, streakCount: 150, vortexCount: 150, enablePost: true, bloomStrength: 0.35 },
    Medium: { leafCount: 1000, treeCount: 40, emberCount: 100, streakCount: 80, vortexCount: 80, enablePost: true, bloomStrength: 0.3 },
    Low: { leafCount: 500, treeCount: 20, emberCount: 50, streakCount: 40, vortexCount: 40, enablePost: false, bloomStrength: 0.2 },
};

// ─────────────────────────────────────────────────────────────────────────────
// SHADERS
// ─────────────────────────────────────────────────────────────────────────────

const InstancedLeafShader = {
    uniforms: {
        uTime: { value: 0 },
        uTexture: { value: null },
        uGust: { value: 0 }, // Driven by this.gust (0.0 to 1.0)
    },
    vertexShader: `
        attribute float size; attribute float phase; attribute float rotSpeed;
        attribute vec3 offsetPos; attribute vec3 color; attribute vec3 axis;
        
        uniform float uTime; uniform float uGust;
        
        varying vec2 vUv; varying vec3 vColor; varying float vLighting;
        
        mat4 rotationMatrix(vec3 axis, float angle) {
            axis = normalize(axis); float s = sin(angle); float c = cos(angle); float oc = 1.0 - c;
            return mat4(oc*axis.x*axis.x+c, oc*axis.x*axis.y-axis.z*s, oc*axis.z*axis.x+axis.y*s, 0.0,
                        oc*axis.x*axis.y+axis.z*s, oc*axis.y*axis.y+c, oc*axis.y*axis.z-axis.x*s, 0.0,
                        oc*axis.z*axis.x-axis.y*s, oc*axis.y*axis.z+axis.x*s, oc*axis.z*axis.z+c, 0.0,
                        0.0, 0.0, 0.0, 1.0);
        }

        void main() {
            vUv = uv; vColor = color;
            vec3 pos = position * size;
            
            // 1. GENTLE TUMBLING
            float tumbleSpeed = rotSpeed * 0.3; 
            mat4 rot = rotationMatrix(axis, uTime * tumbleSpeed + phase);
            vec4 rotPos = rot * vec4(pos, 1.0);
            vec3 finalPos = rotPos.xyz + offsetPos;
            
            // 2. TROMB / TORNADO TURBULENCE
            // Creates a large spiraling funnel motion when gust is active
            float tornadoStrength = uGust; 
            if (tornadoStrength > 0.01) {
                // Twist angle depends on height (y) to create the funnel shape
                float twist = finalPos.y * 0.005 - uTime * 4.0;
                
                // Radius increases with strength
                float radius = 200.0 * tornadoStrength; 
                
                // Apply spiral displacement
                finalPos.x += cos(twist) * radius;
                finalPos.z += sin(twist) * radius;
                
                // Violent vertical updraft jitter
                finalPos.y += sin(uTime * 15.0 + phase) * 30.0 * tornadoStrength;
            }

            vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            
            vec3 transformedNormal = (rot * vec4(normal, 0.0)).xyz;
            float light = 0.5 + 0.5 * dot(transformedNormal, normalize(vec3(0.0, 0.5, 1.0))); 
            vLighting = light;
        }
    `,
    fragmentShader: `
        uniform sampler2D uTexture;
        varying vec2 vUv; varying vec3 vColor; varying float vLighting;
        void main() {
            vec4 tex = texture2D(uTexture, vUv);
            if(tex.a < 0.3) discard;
            vec3 albedo = tex.rgb * vColor;
            vec3 finalColor = albedo * (0.5 + 0.5 * vLighting);
            gl_FragColor = vec4(finalColor, 1.0);
        }
    `
};

const StreakShader = {
    uniforms: { uTime: { value: 0 }, uWindForce: { value: 0 }, uOpacity: { value: 0 } },
    vertexShader: `
        attribute float length; attribute float speed;
        uniform float uTime; uniform float uWindForce;
        void main() {
            vec3 pos = position;
            float dist = (uTime * speed * (1.0 + abs(uWindForce) * 0.1));
            pos.x += dist * sign(uWindForce); 
            if (pos.x > 500.0) pos.x -= 1000.0; if (pos.x < -500.0) pos.x += 1000.0;
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            float stretch = 1.0 + abs(uWindForce) * 0.5;
            gl_PointSize = length * stretch * (300.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: `
        uniform float uOpacity;
        void main() {
            vec2 coord = gl_PointCoord - 0.5; if (abs(coord.y) > 0.1) discard;
            float alpha = smoothstep(0.0, 1.0, 1.0 - abs(coord.x * 2.0));
            gl_FragColor = vec4(1.0, 0.9, 0.6, alpha * uOpacity);
        }
    `,
};

const VortexShader = {
    uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3(0, 0, 0) }, uIntensity: { value: 0.0 } },
    vertexShader: `
        attribute float angle; attribute float radius; attribute float speed; attribute float size;
        uniform float uTime; uniform vec3 uCenter;
        void main() {
            float currentAngle = angle + uTime * speed;
            vec3 pos = uCenter;
            pos.x += cos(currentAngle) * radius;
            pos.y += sin(currentAngle) * radius * 0.2; 
            pos.z += sin(currentAngle * 3.0) * 30.0;
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_PointSize = size * (300.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: `
        uniform float uIntensity;
        void main() {
            vec2 coord = gl_PointCoord - 0.5; if (length(coord) > 0.5) discard;
            gl_FragColor = vec4(1.0, 0.6, 0.2, (1.0 - length(coord) * 2.0) * uIntensity);
        }
    `,
};

const EmberShader = {
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
        attribute float size; attribute float phase;
        uniform float uTime; varying float vAlpha;
        void main() {
            vec3 pos = position; pos.x += sin(uTime * 2.0 + phase) * 15.0;
            vec4 mv = modelViewMatrix * vec4(pos, 1.0);
            gl_PointSize = size * (400.0 / -mv.z);
            gl_Position = projectionMatrix * mv;
            vAlpha = 0.5 + 0.5 * sin(uTime * 3.0 + phase * 2.0);
        }
    `,
    fragmentShader: `
        varying float vAlpha;
        void main() {
            vec2 uv = gl_PointCoord - 0.5; if(length(uv)>0.5) discard;
            vec3 col = mix(vec3(1.0, 0.3, 0.0), vec3(1.0, 0.8, 0.3), 1.0 - length(uv)*2.0);
            gl_FragColor = vec4(col, vAlpha);
        }
    `
};

// TreeTrunkShader removed (Using MeshStandardMaterial)

// ─────────────────────────────────────────────────────────────────────────────
// Main Class
// ─────────────────────────────────────────────────────────────────────────────
export default class FallTheme extends BaseTheme {
    constructor() {
        super('fall');

        this.renderer = null; this.scene = null; this.camera = null; this.composer = null;
        this.instancedLeaves = null;
        this.leafData = null;
        this.treeTrunks = null;
        this.embers = null;
        this.burstParticles = null;
        this.windStreaks = null;
        this.vortexSystems = [];
        this.sunMesh = null;

        this.windForce = 0; this.targetWindForce = 0;
        this.gust = 0; this.gustDuration = 0;
        this.clock = new THREE.Clock(); this.time = 0;
        this.qualityPreset = QUALITY_PRESETS.High;
        this.eventUnsubscribers = [];
        this.texture = null;
    }

    getTetrominoConfig() { return FALL_TETROMINOS; }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.effectQuality) {
            return normalizeQuality(window.settings.effectQuality);
        }
        return 'High';
    }

    applyQualityPreset(quality) {
        this.qualityPreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
    }

    async createScene() {
        if (typeof document === 'undefined') return;
        this.applyQualityPreset(this.getCurrentQualityLevel());
        this.texture = createLeafTexture();
        this.barkTexture = createBarkTexture(); // Generate Bark

        const container = document.getElementById('fall-theme');
        if (!container) return;

        this.initRenderer(container);
        this.createBackground();
        // this.createSun(); // Removed sun creation
        this.createHeroTrees(); // Swapped
        this.createInstancedLeaves();
        this.createEmbers();
        this.createWindStreaks();
        this.createBurstSystem();
        this.setupPostProcessing();
        this.setupEventListeners();

        this.startAnimation();
    }

    initRenderer(container) {
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.innerHTML = '';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();
        // WARMER DARK FOG
        const fogCol = new THREE.Color(0x331100); // Deep Rust/Brown Fog
        this.scene.fog = new THREE.FogExp2(fogCol, this.qualityPreset.fogDensity || 0.002);
        this.scene.background = fogCol;

        this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 5000);
        this.camera.position.set(0, 0, 100);
        this.camera.lookAt(0, 0, -500);

        this.scene.add(new THREE.AmbientLight(0x663300, 0.3));

        // RIM LIGHT (Back)
        const sunLight = new THREE.DirectionalLight(0xff8800, 1.0);
        sunLight.position.set(-100, 200, -500);
        this.scene.add(sunLight);

        // KEY LIGHT (Front-Side) - CRITICAL FOR BARK TEXTURE VISIBILITY
        // Without this, the front of the trees is just a silhouette
        const keyLight = new THREE.PointLight(0xffddaa, 1.5, 4000);
        keyLight.position.set(200, 100, 500);
        this.scene.add(keyLight);

        // FILL LIGHT (Blueish for shadow contrast)
        const fillLight = new THREE.DirectionalLight(0x223355, 0.5);
        fillLight.position.set(0, 0, 100);
        this.scene.add(fillLight);

        // STRONG FRONT LIGHTING (New)
        const frontLight = new THREE.DirectionalLight(0xffccaa, 2.0); // Warm, strong light
        frontLight.position.set(0, 150, 800); // Positioned in front, slightly above
        this.scene.add(frontLight);
    }

    createBackground() {
        // DARKER ATMOSPHERE (Black -> Deep Red Top)
        const geo = new THREE.SphereGeometry(4000, 32, 16);
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTop: { value: new THREE.Color(0x551100) }, // Deep Red
                uMid: { value: new THREE.Color(0xaa4400) }, // Rich Sunset Orange
                uBot: { value: new THREE.Color(0x050200) }, // Almost Black Bottom
            },
            vertexShader: `varying vec3 vPos; void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
            fragmentShader: `
                uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot; varying vec3 vPos;
                void main() {
                    float h = normalize(vPos).y;
                    // Mostly black bottom
                    vec3 col = mix(uBot, uMid, smoothstep(-0.3, 0.3, h));
                    col = mix(col, uTop, smoothstep(0.3, 0.8, h));
                    gl_FragColor = vec4(col, 1.0);
                }
            `,
            side: THREE.BackSide
        });
        this.scene.add(new THREE.Mesh(geo, mat));
    }

    createSun() {
        // REMOVED SUN BALL AS REQUESTED
    }

    createHeroTrees() {
        // 5 TREES WITH DEPTH & ROOTS - TALLER (5000 units) to go off-screen
        // Cylinder that widens at bottom for roots
        const geo = new THREE.CylinderGeometry(70, 160, 5000, 64, 100, true);

        // High displacement material
        const mat = new THREE.MeshStandardMaterial({
            map: this.barkTexture,
            displacementMap: this.barkTexture,
            displacementScale: 40.0, // EXTRA POP
            normalMap: this.barkTexture, // Use as normal map too for lighting
            normalScale: new THREE.Vector2(2, 2),
            roughness: 0.8,
            metalness: 0.1,
            color: 0x6a4030,
            side: THREE.FrontSide
        });

        this.treeTrunks = new THREE.Group();

        const treeConfigs = [
            { x: -500, z: -600, ry: 0.5, rz: 0.1 },  // Left Hero
            { x: 500, z: -600, ry: 2.0, rz: -0.1 }, // Right Hero
            { x: -200, z: -1200, ry: 1.0, rz: 0.05 }, // Mid-Left Deep
            { x: 200, z: -1400, ry: 3.5, rz: -0.05 }, // Mid-Right Deep
            { x: 0, z: -1800, ry: 0.0, rz: 0.0 }   // Center Deep
        ];

        treeConfigs.forEach(cfg => {
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(cfg.x, -200, cfg.z);
            mesh.rotation.y = cfg.ry;
            mesh.rotation.z = cfg.rz;
            this.treeTrunks.add(mesh);
        });

        this.scene.add(this.treeTrunks);
    }

    createInstancedLeaves() {
        const count = this.qualityPreset.leafCount;
        const geo = new THREE.PlaneGeometry(1, 1);

        const instSize = new Float32Array(count);
        const instPhase = new Float32Array(count);
        const instRotSpeed = new Float32Array(count);
        const instOffset = new Float32Array(count * 3);
        const instColor = new Float32Array(count * 3);
        const instAxis = new Float32Array(count * 3);

        const palette = [
            new THREE.Color(0xcc3300),
            new THREE.Color(0xff6600),
            new THREE.Color(0xffaa00),
            new THREE.Color(0x992244),
        ];

        const vel = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            instSize[i] = 12 + Math.random() * 18;
            instPhase[i] = Math.random() * 10;
            instRotSpeed[i] = 2.0 + Math.random() * 4.0;

            const ax = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            instAxis[i * 3] = ax.x; instAxis[i * 3 + 1] = ax.y; instAxis[i * 3 + 2] = ax.z;

            const c = palette[Math.floor(Math.random() * palette.length)];
            instColor[i * 3] = c.r; instColor[i * 3 + 1] = c.g; instColor[i * 3 + 2] = c.b;

            instOffset[i * 3] = (Math.random() - 0.5) * 1400; // Wide X
            instOffset[i * 3 + 1] = (Math.random() - 0.5) * 900; // Y
            // FULL DEPTH: -2000 to +200
            // Spans from behind the furthest tree (-1800) to in front of camera
            instOffset[i * 3 + 2] = (Math.random() * 2200) - 2000;

            vel[i * 3] = (Math.random() - 0.5) * 15;
            vel[i * 3 + 1] = -(25 + Math.random() * 35);
            vel[i * 3 + 2] = (Math.random() - 0.5) * 15;
        }

        geo.setAttribute('size', new THREE.InstancedBufferAttribute(instSize, 1));
        geo.setAttribute('phase', new THREE.InstancedBufferAttribute(instPhase, 1));
        geo.setAttribute('rotSpeed', new THREE.InstancedBufferAttribute(instRotSpeed, 1));
        geo.setAttribute('offsetPos', new THREE.InstancedBufferAttribute(instOffset, 3));
        geo.setAttribute('color', new THREE.InstancedBufferAttribute(instColor, 3));
        geo.setAttribute('axis', new THREE.InstancedBufferAttribute(instAxis, 3));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                ...InstancedLeafShader.uniforms,
                uTexture: { value: this.texture }
            },
            vertexShader: InstancedLeafShader.vertexShader,
            fragmentShader: InstancedLeafShader.fragmentShader,
            transparent: true, side: THREE.DoubleSide
        });

        this.instancedLeaves = new THREE.InstancedMesh(geo, mat, count);
        this.leafData = { vel, count };
        this.scene.add(this.instancedLeaves);
    }

    createWindStreaks() {
        const count = this.qualityPreset.streakCount;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(count * 3);
        const len = new Float32Array(count);
        const spd = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            pos[i * 3] = (Math.random() - 0.5) * 1200;
            pos[i * 3 + 1] = (Math.random() - 0.5) * 700 + 100;
            pos[i * 3 + 2] = (Math.random() - 0.5) * 500 - 100;
            len[i] = 20 + Math.random() * 40; spd[i] = 140 + Math.random() * 160;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('length', new THREE.BufferAttribute(len, 1));
        geo.setAttribute('speed', new THREE.BufferAttribute(spd, 1));

        const mat = new THREE.ShaderMaterial({
            uniforms: StreakShader.uniforms, vertexShader: StreakShader.vertexShader, fragmentShader: StreakShader.fragmentShader,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
        });
        this.windStreaks = new THREE.Points(geo, mat);
        this.windStreaks.visible = false;
        this.scene.add(this.windStreaks);
    }

    createEmbers() {
        const count = this.qualityPreset.emberCount;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            pos[i * 3] = (Math.random() - 0.5) * 1000;
            pos[i * 3 + 1] = -400 + Math.random() * 200;
            pos[i * 3 + 2] = (Math.random() - 0.5) * 500 - 200;
            sizes[i] = 4 + Math.random() * 6;
            phases[i] = Math.random() * 10;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geo.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
        const mat = new THREE.ShaderMaterial({
            uniforms: EmberShader.uniforms, vertexShader: EmberShader.vertexShader, fragmentShader: EmberShader.fragmentShader,
            transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
        });
        this.embers = new THREE.Points(geo, mat);
        this.emberData = { vel: new Float32Array(count * 3) };
        for (let i = 0; i < count; i++) this.emberData.vel[i * 3 + 1] = 25 + Math.random() * 35;
        this.scene.add(this.embers);
    }

    createBurstSystem() {
        const max = 200;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(max * 3);

        for (let i = 0; i < max; i++) {
            pos[i * 3] = 0; pos[i * 3 + 1] = -9999; pos[i * 3 + 2] = 0;
        }

        const life = new Float32Array(max);
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('life', new THREE.BufferAttribute(life, 1));
        const mat = new THREE.PointsMaterial({
            color: 0xffaa00, size: 25, transparent: true, opacity: 1,
            map: this.texture, depthWrite: false, blending: THREE.AdditiveBlending
        });
        this.burstParticles = new THREE.Points(geo, mat);
        this.burstData = { pos, vel: new Float32Array(max * 3), life, active: [], next: 0 };
        this.scene.add(this.burstParticles);
    }

    createVortexSystem(x, y, z) {
        const count = this.qualityPreset.vortexCount;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(count * 3);
        const ang = new Float32Array(count);
        const rad = new Float32Array(count);
        const spd = new Float32Array(count);
        const sz = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            ang[i] = Math.random() * 6.28;
            rad[i] = 40 + Math.random() * 150;
            spd[i] = 2.0 + Math.random() * 4.0;
            sz[i] = 5 + Math.random() * 8;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('angle', new THREE.BufferAttribute(ang, 1));
        geo.setAttribute('radius', new THREE.BufferAttribute(rad, 1));
        geo.setAttribute('speed', new THREE.BufferAttribute(spd, 1));
        geo.setAttribute('size', new THREE.BufferAttribute(sz, 1));

        const mat = new THREE.ShaderMaterial({
            uniforms: { ...VortexShader.uniforms, uCenter: { value: new THREE.Vector3(x, y, z) }, uIntensity: { value: 1.0 } },
            vertexShader: VortexShader.vertexShader,
            fragmentShader: VortexShader.fragmentShader,
            transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
        });
        const mesh = new THREE.Points(geo, mat);
        mesh.userData = { life: 1.0 };
        this.vortexSystems.push(mesh);
        this.scene.add(mesh);
    }

    spawnBurst(x, y, z, count) {
        if (!this.burstParticles) return;
        const d = this.burstData;
        const max = 200;
        for (let i = 0; i < count; i++) {
            const idx = d.next; d.next = (d.next + 1) % max;
            const i3 = idx * 3;
            d.pos[i3] = x; d.pos[i3 + 1] = y; d.pos[i3 + 2] = z;
            const a = Math.random() * 6.28; const s = 25 + Math.random() * 50;
            d.vel[i3] = Math.cos(a) * s; d.vel[i3 + 1] = Math.sin(a) * s; d.vel[i3 + 2] = (Math.random() - 0.5) * s;
            d.life[idx] = 1.0;
            if (!d.active.includes(idx)) d.active.push(idx);
        }
        this.burstParticles.geometry.attributes.position.needsUpdate = true;
        this.burstParticles.geometry.attributes.life.needsUpdate = true;
    }

    setupPostProcessing() {
        if (!this.qualityPreset.enablePost) return;
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.composer.addPass(new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.qualityPreset.bloomStrength, 0.5, 0.6
        ));
    }

    setupEventListeners() {
        this.eventUnsubscribers = [
            eventBus.on(EVENTS.LINE_CLEAR, d => this.onLineClear(d)),
            eventBus.on(EVENTS.COMBO, d => this.onCombo(d))
        ];
        window.addEventListener('resize', () => this.resize(window.innerWidth, window.innerHeight));
    }

    onLineClear(data) {
        const d = data.detail || data;
        const lines = d.lineCount || 1;
        const combo = d.comboCount || 0;

        this.spawnBurst(0, -50, -200, lines * 25);
        this.targetWindForce = (Math.random() > 0.5 ? 1 : -1) * (50 + combo * 20);
        this.gust = 1.0; this.gustDuration = 100 + combo * 50;

        if (combo >= 2 && this.windStreaks) this.windStreaks.visible = true;
        else if (combo < 2 && this.windStreaks) this.windStreaks.visible = false;

        if (combo >= 4) this.createVortexSystem(0, 0, -200);
    }

    onCombo(data) { /* handled in line clear */ }

    startAnimation() {
        const animate = () => {
            if (!this.isActive) return;
            const delta = this.clock.getDelta();
            this.time += delta;

            this.updatePhysics(delta);
            this.updateLeaves(delta);
            this.updateEmbers(delta);
            this.updateBurst(delta);
            this.updateVortexes(delta);

            if (this.instancedLeaves) {
                const u = this.instancedLeaves.material.uniforms;
                u.uTime.value = this.time;
                u.uGust.value = this.gust;
            }
            if (this.windStreaks) {
                const u = this.windStreaks.material.uniforms;
                u.uTime.value = this.time;
                u.uWindForce.value = this.windForce;
                if (Math.abs(this.windForce) < 10) this.windStreaks.visible = false;
                u.uOpacity.value = Math.min(Math.abs(this.windForce) / 50.0, 1.0) * Math.min(this.gust * 2.0, 1.0);
            }
            if (this.embers) this.embers.material.uniforms.uTime.value = this.time;

            if (this.composer) {
                this.renderer.clear();
                this.composer.render();
            } else {
                this.renderer.clear();
                this.renderer.render(this.scene, this.camera);
            }
            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }

    updatePhysics(delta) {
        this.windForce += (this.targetWindForce - this.windForce) * 0.1;
        this.targetWindForce *= 0.95;
        if (this.gustDuration > 0) {
            this.gustDuration -= delta * 60;
            this.gust = Math.max(0, this.gustDuration / 120);
        } else this.gust = 0;
    }

    updateLeaves(delta) {
        if (!this.instancedLeaves) return;
        const attr = this.instancedLeaves.geometry.attributes.offsetPos;
        const arr = attr.array;
        const vel = this.leafData.vel;
        const c = this.leafData.count;
        const windX = this.windForce * delta;

        for (let i = 0; i < c; i++) {
            const i3 = i * 3;
            // More turbulence
            const turb = Math.sin(this.time * 5.0 + i) * this.gust * 20.0 * delta;
            arr[i3] += vel[i3] * delta + windX + turb;
            arr[i3 + 1] += vel[i3 + 1] * delta;
            arr[i3 + 2] += vel[i3 + 2] * delta;

            if (arr[i3 + 1] < -500 || Math.abs(arr[i3]) > 1400) {
                arr[i3] = (Math.random() - 0.5) * 1200;
                arr[i3 + 1] = 500 + Math.random() * 200;
                // Respawn at random depth to maintain volume
                arr[i3 + 2] = (Math.random() * 2200) - 2000;
            }
        }
        attr.needsUpdate = true;
    }

    updateEmbers(delta) {
        if (!this.embers) return;
        const arr = this.embers.geometry.attributes.position.array;
        const vel = this.emberData.vel;
        for (let i = 0; i < this.qualityPreset.emberCount; i++) {
            arr[i * 3 + 1] += vel[i * 3 + 1] * delta;
            if (arr[i * 3 + 1] > 400) arr[i * 3 + 1] = -400;
        }
        this.embers.geometry.attributes.position.needsUpdate = true;
    }

    updateBurst(delta) {
        if (!this.burstParticles) return;
        const d = this.burstData;
        const grav = -40;
        for (let j = d.active.length - 1; j >= 0; j--) {
            const idx = d.active[j];
            const i3 = idx * 3;
            d.vel[i3 + 1] += grav * delta;
            d.pos[i3] += d.vel[i3] * delta;
            d.pos[i3 + 1] += d.vel[i3 + 1] * delta;
            d.pos[i3 + 2] += d.vel[i3 + 2] * delta;
            d.life[idx] -= delta * 1.5;
            if (d.life[idx] <= 0) {
                d.active.splice(j, 1); d.pos[i3 + 1] = -9999;
            }
        }
        this.burstParticles.geometry.attributes.position.needsUpdate = true;
    }

    updateVortexes(delta) {
        for (let i = this.vortexSystems.length - 1; i >= 0; i--) {
            const v = this.vortexSystems[i];
            v.userData.life -= delta * 0.4;
            v.material.uniforms.uTime.value = this.time;
            v.material.uniforms.uIntensity.value = v.userData.life;
            if (v.userData.life <= 0) {
                this.scene.remove(v); v.geometry.dispose(); v.material.dispose(); this.vortexSystems.splice(i, 1);
            }
        }
    }

    resize(w, h) {
        if (this.camera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
        if (this.renderer) this.renderer.setSize(w, h);
        if (this.composer) this.composer.setSize(w, h);
    }

    stop() {
        this.eventUnsubscribers.forEach(u => u && u());
        super.stop();
    }

    cleanup() {
        this.stop();
        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
        super.cleanup();
    }
}
