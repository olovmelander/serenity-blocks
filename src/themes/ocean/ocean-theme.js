/**
 * Ocean Depths Theme - Immersive Stylized Underwater World
 * 
 * Premium underwater experience with:
 * - Smooth curved seaweed/kelp with proper geometry
 * - Circular soft particles (not squared)
 * - Detailed coral reef formations
 * - Realistic fish school behavior
 * - Smooth underwater rendering with volumetric effects
 * - Gentle camera sway for immersion
 */

import * as THREE from 'three';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { OCEAN_TETROMINOS } from './ocean-tetrominos.js';

export default class OceanTheme extends BaseTheme {
    constructor() {
        super('ocean');
        this.eventUnsubscribers = [];
        this.animationFrameId = null;
        this.clock = new THREE.Clock();

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.waterSurface = null;
        this.seabed = null;
        this.seaweedInstances = null;
        this.coralGroup = null;
        this.fishSchools = [];
        this.jellyfishMesh = null;
        this.planktonMesh = null;
        this.bubbleMesh = null;
        this.godRays = null;

        // Animation state
        this.currentStrength = 0.5;
        this.targetCurrentStrength = 0.5;
        this.glowIntensity = 0.8;
        this.targetGlowIntensity = 0.8;

        // Uniform update cache
        this.uniformsToUpdate = [];

        // Quality presets
        this.currentQuality = 'High';
        this.qualityPresets = {
            Minimal: {
                seaweedCount: 800,
                coralCount: 20,
                fishCount: 60,
                jellyfishCount: 6,
                planktonCount: 150,
                bubbleCount: 60,
                terrainSegments: 80,
            },
            Low: {
                seaweedCount: 1500,
                coralCount: 35,
                fishCount: 100,
                jellyfishCount: 10,
                planktonCount: 300,
                bubbleCount: 100,
                terrainSegments: 100,
            },
            Medium: {
                seaweedCount: 2500,
                coralCount: 55,
                fishCount: 180,
                jellyfishCount: 15,
                planktonCount: 500,
                bubbleCount: 150,
                terrainSegments: 120,
            },
            High: {
                seaweedCount: 4000,
                coralCount: 80,
                fishCount: 280,
                jellyfishCount: 22,
                planktonCount: 800,
                bubbleCount: 220,
                terrainSegments: 150,
            },
            Ultra: {
                seaweedCount: 6000,
                coralCount: 120,
                fishCount: 420,
                jellyfishCount: 35,
                planktonCount: 1200,
                bubbleCount: 350,
                terrainSegments: 180,
            },
            Extreme: {
                seaweedCount: 9000,
                coralCount: 180,
                fishCount: 600,
                jellyfishCount: 50,
                planktonCount: 2000,
                bubbleCount: 500,
                terrainSegments: 220,
            },
        };

        this.activePreset = this.qualityPresets.High;
        this.qualityChangeHandler = null;
    }

    getTetrominoConfig() {
        return OCEAN_TETROMINOS;
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) quality = 'High';
        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];
        if (this.isActive && this.scene) this.rebuildScene();
        console.log(`🌊 [OceanTheme] Applied ${quality} quality preset`);
    }

    rebuildScene() {
        this.disposeSceneContents();
        this.buildScene();
    }

    disposeSceneContents() {
        if (!this.scene) return;
        const toRemove = [];
        this.scene.traverse(obj => {
            if (obj !== this.scene && obj !== this.camera && !(obj instanceof THREE.Light)) {
                toRemove.push(obj);
            }
        });
        toRemove.forEach(obj => {
            this.scene.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        });
        this.uniformsToUpdate = [];
        this.fishSchools = [];
    }

    setupQualityListener() {
        this.teardownQualityListener();
        this.qualityChangeHandler = (event) => {
            const newQuality = event.detail?.effectQuality;
            if (newQuality && newQuality !== this.currentQuality) this.applyQualityPreset(newQuality);
        };
        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    teardownQualityListener() {
        if (this.qualityChangeHandler) {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }
    }

    async createScene() {
        const themeContainer = document.getElementById('ocean-theme');
        if (!themeContainer) return;

        themeContainer.innerHTML = '';
        themeContainer.style.background = '#001018';

        this.applyQualityPreset(this.getGraphicsQuality());
        this.setupQualityListener();

        // High-quality renderer with antialiasing
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x001520);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;

        const canvas = this.renderer.domElement;
        canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none';
        themeContainer.appendChild(canvas);

        this.scene = new THREE.Scene();
        // Smooth exponential fog for underwater depth - matches water surface
        this.scene.fog = new THREE.FogExp2(0x001825, 0.007);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.5,
            500
        );
        this.camera.position.set(0, 20, 80);
        this.camera.lookAt(0, 5, 0);

        this.buildScene();
        this.setupEventListeners();
        this.handleResize();
        this.startAnimation();
    }

    buildScene() {
        this.createWaterSurface();
        this.createGodRays();
        this.createSeabed();
        this.createSeaweed();
        this.createCoralReef();
        this.createFishSchools();
        this.createJellyfish();
        this.createPlankton();
        this.createBubbles();
        this.createLighting();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WATER SURFACE - Waves-style shader with Gerstner waves (viewed from below)
    // ═══════════════════════════════════════════════════════════════════════════
    createWaterSurface() {
        // Large plane above the scene representing water surface from below
        const geometry = new THREE.PlaneGeometry(500, 500, 128, 128);
        geometry.rotateX(Math.PI / 2);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uDeepColor: { value: new THREE.Color(0x001520) },
                uMidColor: { value: new THREE.Color(0x003344) },
                uSurfaceColor: { value: new THREE.Color(0x005566) },
                uCrestColor: { value: new THREE.Color(0x227788) },
                uFoamColor: { value: new THREE.Color(0x88aaaa) },
                uWaveIntensity: { value: 1.0 },
                uCausticsIntensity: { value: 0.35 },
                uGlowIntensity: { value: 0.0 },
            },
            vertexShader: `
                uniform float uTime;
                uniform float uWaveIntensity;
                varying vec3 vPosition;
                varying vec3 vNormal;
                varying vec3 vWorldNormal;
                varying vec2 vUv;
                varying float vElevation;
                
                // Perlin noise
                vec4 permute(vec4 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
                vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
                vec3 fade(vec3 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }
                
                float cnoise(vec3 P) {
                    vec3 Pi0 = floor(P); vec3 Pi1 = Pi0 + vec3(1.0);
                    Pi0 = mod(Pi0, 289.0); Pi1 = mod(Pi1, 289.0);
                    vec3 Pf0 = fract(P); vec3 Pf1 = Pf0 - vec3(1.0);
                    vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
                    vec4 iy = vec4(Pi0.yy, Pi1.yy); vec4 iz0 = Pi0.zzzz; vec4 iz1 = Pi1.zzzz;
                    vec4 ixy = permute(permute(ix) + iy);
                    vec4 ixy0 = permute(ixy + iz0); vec4 ixy1 = permute(ixy + iz1);
                    vec4 gx0 = ixy0 / 7.0; vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5;
                    gx0 = fract(gx0); vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
                    vec4 sz0 = step(gz0, vec4(0.0));
                    gx0 -= sz0 * (step(0.0, gx0) - 0.5); gy0 -= sz0 * (step(0.0, gy0) - 0.5);
                    vec4 gx1 = ixy1 / 7.0; vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5;
                    gx1 = fract(gx1); vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
                    vec4 sz1 = step(gz1, vec4(0.0));
                    gx1 -= sz1 * (step(0.0, gx1) - 0.5); gy1 -= sz1 * (step(0.0, gy1) - 0.5);
                    vec3 g000 = vec3(gx0.x,gy0.x,gz0.x); vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
                    vec3 g010 = vec3(gx0.z,gy0.z,gz0.z); vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
                    vec3 g001 = vec3(gx1.x,gy1.x,gz1.x); vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
                    vec3 g011 = vec3(gx1.z,gy1.z,gz1.z); vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);
                    vec4 norm0 = taylorInvSqrt(vec4(dot(g000,g000),dot(g010,g010),dot(g100,g100),dot(g110,g110)));
                    g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
                    vec4 norm1 = taylorInvSqrt(vec4(dot(g001,g001),dot(g011,g011),dot(g101,g101),dot(g111,g111)));
                    g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;
                    float n000 = dot(g000, Pf0); float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
                    float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z)); float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
                    float n001 = dot(g001, vec3(Pf0.xy, Pf1.z)); float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
                    float n011 = dot(g011, vec3(Pf0.x, Pf1.yz)); float n111 = dot(g111, Pf1);
                    vec3 fade_xyz = fade(Pf0);
                    vec4 n_z = mix(vec4(n000,n100,n010,n110), vec4(n001,n101,n011,n111), fade_xyz.z);
                    vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
                    return 2.2 * mix(n_yz.x, n_yz.y, fade_xyz.x);
                }
                
                // Gerstner wave
                vec3 gerstnerWave(vec2 dir, float steep, float wlen, vec3 p, float t) {
                    float k = 6.28318 / wlen;
                    float c = sqrt(9.8 / k);
                    vec2 d = normalize(dir);
                    float f = k * (dot(d, p.xz) - c * t);
                    float a = steep / k;
                    return vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f));
                }
                
                void main() {
                    vUv = uv;
                    vec3 pos = position;
                    float time = uTime * 0.5;
                    
                    // Gerstner waves
                    vec3 wave = vec3(0.0);
                    wave += gerstnerWave(vec2(1.0, 0.3), 0.2, 25.0, pos, time);
                    wave += gerstnerWave(vec2(0.7, 0.7), 0.15, 18.0, pos, time * 1.1);
                    wave += gerstnerWave(vec2(-0.4, 0.9), 0.1, 12.0, pos, time * 0.9);
                    wave += gerstnerWave(vec2(0.9, -0.2), 0.08, 9.0, pos, time * 0.85);
                    
                    // Perlin noise detail
                    float noise = cnoise(vec3(pos.xz * 0.08, time * 0.3)) * 0.4;
                    noise += cnoise(vec3(pos.xz * 0.04, time * 0.2)) * 0.3;
                    
                    float displacement = (wave.y + noise) * uWaveIntensity;
                    vElevation = displacement;
                    
                    pos.y += displacement * 1.5;
                    pos.x += wave.x * 0.3;
                    pos.z += wave.z * 0.3;
                    
                    vPosition = pos;
                    vNormal = normal;
                    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
                    
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uDeepColor;
                uniform vec3 uMidColor;
                uniform vec3 uSurfaceColor;
                uniform vec3 uCrestColor;
                uniform vec3 uFoamColor;
                uniform float uCausticsIntensity;
                uniform float uGlowIntensity;
                varying vec3 vPosition;
                varying vec3 vNormal;
                varying vec3 vWorldNormal;
                varying vec2 vUv;
                varying float vElevation;
                
                // Simplex noise for caustics
                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
                float snoise(vec2 v) {
                    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
                    vec2 i = floor(v + dot(v, C.yy)); vec2 x0 = v - i + dot(i, C.xx);
                    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
                    vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1; i = mod289(i);
                    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
                    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
                    m = m*m; m = m*m;
                    vec3 x = 2.0 * fract(p * C.www) - 1.0;
                    vec3 h = abs(x) - 0.5; vec3 ox = floor(x + 0.5); vec3 a0 = x - ox;
                    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
                    vec3 g; g.x = a0.x * x0.x + h.x * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
                    return 130.0 * dot(m, g);
                }
                
                void main() {
                    float heightFactor = clamp(vElevation * 1.5 + 0.5, 0.0, 1.0);
                    float depthFactor = clamp((vPosition.z + 150.0) / 300.0, 0.0, 1.0);
                    
                    // Color gradient
                    vec3 color = mix(uDeepColor, uMidColor, depthFactor * 0.6);
                    color = mix(color, uSurfaceColor, depthFactor * 0.9);
                    color = mix(color, uCrestColor, heightFactor * 0.5);
                    
                    // Lighting from above
                    vec3 lightDir = normalize(vec3(0.2, -0.9, 0.1));
                    vec3 viewDir = normalize(cameraPosition - vPosition);
                    float diffuse = max(dot(-vWorldNormal, lightDir), 0.0);
                    diffuse = pow(diffuse, 0.5) * 0.6 + 0.3;
                    
                    // Specular (shimmering water)
                    vec3 halfDir = normalize(lightDir + viewDir);
                    float specular = pow(max(dot(-vWorldNormal, halfDir), 0.0), 48.0);
                    
                    // Fresnel (glassy edge)
                    float fresnel = pow(1.0 - max(dot(-vWorldNormal, viewDir), 0.0), 2.5);
                    
                    // Caustics on water surface
                    vec2 causticsUV = vPosition.xz * 0.15;
                    float c1 = snoise(causticsUV + uTime * 0.2);
                    float c2 = snoise(causticsUV * 1.4 - uTime * 0.15);
                    float c3 = snoise(causticsUV * 0.8 + uTime * 0.25);
                    float caustics = (c1 + c2 + c3) * 0.33;
                    caustics = pow(max(caustics, 0.0), 2.0) * uCausticsIntensity;
                    
                    // Foam at wave crests
                    float foamNoise = snoise(vPosition.xz * 0.8 + uTime * 0.1);
                    float foam = smoothstep(0.35, 0.65, vElevation) * (foamNoise * 0.35 + 0.5);
                    
                    // Sub-surface scattering
                    float sss = pow(max(dot(-viewDir, lightDir), 0.0), 3.0) * 0.3;
                    
                    // Combine
                    color *= diffuse;
                    color += vec3(1.0) * specular * 0.5;
                    color += uCrestColor * fresnel * 0.35;
                    color += uCrestColor * caustics;
                    color += uSurfaceColor * sss;
                    color = mix(color, uFoamColor, foam * 0.4);
                    color += uCrestColor * uGlowIntensity * 0.3;
                    
                    // Edge fade - smooth transition at water surface edges
                    float distFromCenter = length(vUv - 0.5) * 2.0;
                    float edgeFade = 1.0 - smoothstep(0.75, 1.0, distFromCenter);
                    
                    // View angle fade - gentler fade for better visibility
                    float viewFade = smoothstep(0.0, 0.25, abs(dot(-vWorldNormal, viewDir)));
                    
                    float alpha = edgeFade * (0.5 + viewFade * 0.45);
                    
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false,
        });

        this.waterSurface = new THREE.Mesh(geometry, material);
        this.waterSurface.position.y = 65;
        this.waterSurfaceMaterial = material;
        this.uniformsToUpdate.push(material.uniforms);
        this.scene.add(this.waterSurface);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GOD RAYS - Volumetric light beams from surface
    // ═══════════════════════════════════════════════════════════════════════════
    createGodRays() {
        const rayCount = 10;
        const positions = [];
        const uvs = [];

        for (let i = 0; i < rayCount; i++) {
            const w = 18 + Math.random() * 15;
            const h = 180;
            const x = (i - rayCount / 2) * 22 + (Math.random() - 0.5) * 25;
            const y = 90;
            const z = -25 - i * 10 + (Math.random() - 0.5) * 15;
            const rot = (Math.random() - 0.5) * 0.35;

            const cos = Math.cos(rot), sin = Math.sin(rot);
            const hw = w / 2, hh = h / 2;

            const verts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, -hh], [hw, hh], [-hw, hh]];
            const uv = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];

            verts.forEach((v, idx) => {
                positions.push(x + v[0] * cos - v[1] * sin, y + v[0] * sin + v[1] * cos, z);
                uvs.push(uv[idx][0], uv[idx][1]);
            });
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

        const material = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 }, uIntensity: { value: 0.4 } },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uIntensity;
                varying vec2 vUv;
                
                void main() {
                    // Soft ray shape with smooth falloff
                    float rayX = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
                    float rayY = smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.35, vUv.y);
                    float ray = rayX * rayY;
                    
                    // Animated shimmer
                    ray *= 0.8 + sin(vUv.y * 25.0 + uTime * 1.8) * 0.2;
                    
                    vec3 color = vec3(0.2, 0.45, 0.55) * ray * uIntensity;
                    gl_FragColor = vec4(color, ray * 0.22 * uIntensity);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        this.godRays = new THREE.Mesh(geometry, material);
        this.uniformsToUpdate.push(material.uniforms);
        this.scene.add(this.godRays);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SEABED - Sandy ocean floor with caustic lighting
    // ═══════════════════════════════════════════════════════════════════════════
    createSeabed() {
        const segments = this.activePreset.terrainSegments;
        const geometry = new THREE.PlaneGeometry(400, 400, segments, segments);
        geometry.rotateX(-Math.PI / 2);

        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i);
            positions.setY(i, this.getSeabedHeight(x, z));
        }
        geometry.computeVertexNormals();

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uSandColor1: { value: new THREE.Color(0x0a1820) },
                uSandColor2: { value: new THREE.Color(0x152a35) },
                uFogColor: { value: new THREE.Color(0x001825) },
            },
            vertexShader: `
                varying vec3 vNormal;
                varying float vHeight;
                varying float vDist;
                varying vec2 vWorldXZ;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vHeight = position.y;
                    vWorldXZ = position.xz;
                    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                    vDist = length(mvPos.xyz);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uSandColor1;
                uniform vec3 uSandColor2;
                uniform vec3 uFogColor;
                varying vec3 vNormal;
                varying float vHeight;
                varying float vDist;
                varying vec2 vWorldXZ;
                
                void main() {
                    float hf = smoothstep(-25.0, 10.0, vHeight);
                    vec3 color = mix(uSandColor1, uSandColor2, hf);
                    
                    // Animated caustic pattern
                    float c1 = sin(vWorldXZ.x * 0.12 + uTime * 0.7) * sin(vWorldXZ.y * 0.1 + uTime * 0.5);
                    float c2 = sin(vWorldXZ.x * 0.18 - uTime * 0.6) * sin(vWorldXZ.y * 0.15 + uTime * 0.8);
                    float caustic = pow(max(0.0, (c1 + c2) * 0.5 + 0.3), 2.5) * 0.35;
                    color += vec3(0.15, 0.4, 0.5) * caustic;
                    
                    // Lighting
                    float light = max(0.3, dot(vNormal, normalize(vec3(0.2, 0.9, -0.15))));
                    color *= light;
                    
                    // Distance fog
                    float fog = 1.0 - exp(-vDist * 0.006);
                    color = mix(color, uFogColor, fog);
                    
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
        });

        this.seabed = new THREE.Mesh(geometry, material);
        this.uniformsToUpdate.push(material.uniforms);
        this.scene.add(this.seabed);
    }

    getSeabedHeight(x, z) {
        return Math.sin(x * 0.018) * 14 +
            Math.sin(z * 0.015) * 12 +
            Math.sin(x * 0.04 + z * 0.035) * 6 +
            Math.cos(x * 0.025 - z * 0.02) * 8 - 18;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SEAWEED - Smooth curved kelp with proper geometry (not pixelated)
    // ═══════════════════════════════════════════════════════════════════════════
    createSeaweed() {
        const count = this.activePreset.seaweedCount;
        const spread = 150;

        // Create smooth curved seaweed blade geometry with multiple segments
        const segments = 8;
        const width = 0.12;
        const height = 4.0;

        const bladeVertices = [];
        const bladeIndices = [];
        const bladeHeights = [];

        for (let s = 0; s <= segments; s++) {
            const t = s / segments;
            const y = t * height;
            const w = width * (1 - t * 0.7); // Taper towards top

            // Left and right vertices
            bladeVertices.push(-w, y, 0);
            bladeVertices.push(w, y, 0);
            bladeHeights.push(t, t);

            if (s < segments) {
                const i = s * 2;
                bladeIndices.push(i, i + 1, i + 2);
                bladeIndices.push(i + 1, i + 3, i + 2);
            }
        }

        const bladeGeometry = new THREE.BufferGeometry();
        bladeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bladeVertices, 3));
        bladeGeometry.setAttribute('aHeight', new THREE.Float32BufferAttribute(bladeHeights, 1));
        bladeGeometry.setIndex(bladeIndices);
        bladeGeometry.computeVertexNormals();

        const bladeMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uCurrentStrength: { value: 0.5 },
            },
            vertexShader: `
                uniform float uTime;
                uniform float uCurrentStrength;
                attribute float aHeight;
                attribute float aPhase;
                attribute float aColorVar;
                varying float vHeight;
                varying float vColorVar;
                varying float vDist;
                varying vec3 vNormal;
                
                void main() {
                    vec3 pos = position;
                    vec4 iPos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                    
                    // Smooth sinusoidal wave motion along the blade
                    float h = aHeight;
                    float phase = aPhase + iPos.x * 0.03 + iPos.z * 0.025;
                    
                    // Primary wave
                    float wave1 = sin(uTime * 1.2 + phase) * h * h;
                    // Secondary wave for more organic motion
                    float wave2 = sin(uTime * 0.8 + phase * 1.5 + h * 2.0) * h * h * 0.4;
                    
                    pos.x += (wave1 + wave2) * uCurrentStrength;
                    pos.z += cos(uTime * 0.9 + phase * 0.7) * h * h * uCurrentStrength * 0.3;
                    
                    vec4 worldPos = instanceMatrix * vec4(pos, 1.0);
                    vec4 mvPos = modelViewMatrix * worldPos;
                    
                    vHeight = aHeight;
                    vColorVar = aColorVar;
                    vDist = length(mvPos.xyz);
                    vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
                    
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                varying float vHeight;
                varying float vColorVar;
                varying float vDist;
                varying vec3 vNormal;
                
                void main() {
                    // Rich kelp color gradient
                    vec3 base = vec3(0.04, 0.18, 0.12);
                    vec3 mid = vec3(0.08, 0.32, 0.18);
                    vec3 tip = vec3(0.12, 0.45, 0.22);
                    
                    vec3 color = mix(base, mid, smoothstep(0.0, 0.5, vHeight));
                    color = mix(color, tip, smoothstep(0.5, 1.0, vHeight));
                    
                    // Color variation
                    color *= 0.85 + vColorVar * 0.3;
                    
                    // Subtle lighting
                    float light = max(0.5, dot(vNormal, normalize(vec3(0.2, 0.8, 0.1))));
                    color *= light;
                    
                    // Translucency effect at tips
                    float translucency = vHeight * 0.15;
                    color += vec3(0.05, 0.15, 0.08) * translucency;
                    
                    // Distance fog
                    vec3 fogColor = vec3(0.0, 0.1, 0.15);
                    float fog = 1.0 - exp(-vDist * 0.008);
                    color = mix(color, fogColor, fog);
                    
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            side: THREE.DoubleSide,
        });

        const seaweedMesh = new THREE.InstancedMesh(bladeGeometry, bladeMaterial, count);

        const phases = new Float32Array(count);
        const colorVars = new Float32Array(count);
        const dummy = new THREE.Object3D();

        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * spread * 2;
            const z = (Math.random() - 0.5) * spread * 2;
            const y = this.getSeabedHeight(x, z);

            dummy.position.set(x, y, z);
            dummy.rotation.y = Math.random() * Math.PI * 2;
            dummy.scale.setScalar(0.6 + Math.random() * 0.8);
            dummy.updateMatrix();
            seaweedMesh.setMatrixAt(i, dummy.matrix);

            phases[i] = Math.random() * 6.28;
            colorVars[i] = Math.random();
        }

        seaweedMesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
        seaweedMesh.geometry.setAttribute('aColorVar', new THREE.InstancedBufferAttribute(colorVars, 1));
        seaweedMesh.instanceMatrix.needsUpdate = true;
        seaweedMesh.frustumCulled = false;

        this.seaweedInstances = seaweedMesh;
        this.uniformsToUpdate.push(seaweedMesh.material.uniforms);
        this.scene.add(seaweedMesh);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CORAL REEF - Detailed colorful coral formations
    // ═══════════════════════════════════════════════════════════════════════════
    createCoralReef() {
        const count = this.activePreset.coralCount;
        const spread = 140;
        this.coralGroup = new THREE.Group();

        const coralColors = [
            new THREE.Color(0xff6b6b), // Coral pink
            new THREE.Color(0xff8c42), // Orange
            new THREE.Color(0xfeca57), // Yellow
            new THREE.Color(0xa55eea), // Purple
            new THREE.Color(0xff69b4), // Hot pink
            new THREE.Color(0x20b2aa), // Teal
            new THREE.Color(0xff4757), // Red
            new THREE.Color(0x7bed9f), // Mint
        ];

        // Create shared geometries with higher detail
        const brainGeo = new THREE.IcosahedronGeometry(1, 2);
        const branchGeo = new THREE.CylinderGeometry(0.08, 0.15, 1, 8);
        const tubeGeo = new THREE.TorusGeometry(0.4, 0.15, 8, 16);
        const fanGeo = new THREE.CircleGeometry(1, 12);

        for (let c = 0; c < count; c++) {
            const x = (Math.random() - 0.5) * spread * 2;
            const z = (Math.random() - 0.5) * spread * 2;
            const y = this.getSeabedHeight(x, z);
            if (y < -22) continue;

            const scale = 1.0 + Math.random() * 2.0;
            const color = coralColors[Math.floor(Math.random() * coralColors.length)];
            const type = Math.random();

            const material = new THREE.MeshLambertMaterial({
                color: color,
                side: THREE.DoubleSide,
            });

            if (type < 0.3) {
                // Brain coral
                const coral = new THREE.Mesh(brainGeo, material);
                coral.position.set(x, y + scale * 0.8, z);
                coral.scale.set(scale, scale * 0.7, scale);
                coral.rotation.y = Math.random() * Math.PI;
                this.coralGroup.add(coral);
            } else if (type < 0.6) {
                // Branching coral
                const branchCount = 4 + Math.floor(Math.random() * 5);
                for (let b = 0; b < branchCount; b++) {
                    const branch = new THREE.Mesh(branchGeo, material);
                    const angle = (b / branchCount) * Math.PI * 2 + Math.random() * 0.3;
                    const dist = Math.random() * scale * 0.5;
                    const bHeight = scale * (0.5 + Math.random() * 0.8);

                    branch.position.set(
                        x + Math.cos(angle) * dist,
                        y + bHeight * 0.5,
                        z + Math.sin(angle) * dist
                    );
                    branch.scale.set(scale * 0.4, bHeight, scale * 0.4);
                    branch.rotation.x = (Math.random() - 0.5) * 0.3;
                    branch.rotation.z = (Math.random() - 0.5) * 0.3;
                    this.coralGroup.add(branch);
                }
            } else if (type < 0.8) {
                // Tube coral
                const coral = new THREE.Mesh(tubeGeo, material);
                coral.position.set(x, y + scale * 0.3, z);
                coral.scale.setScalar(scale);
                coral.rotation.x = Math.PI / 2;
                this.coralGroup.add(coral);
            } else {
                // Fan coral
                const coral = new THREE.Mesh(fanGeo, material);
                coral.position.set(x, y + scale, z);
                coral.scale.setScalar(scale * 1.2);
                coral.rotation.y = Math.random() * Math.PI;
                this.coralGroup.add(coral);
            }
        }

        this.scene.add(this.coralGroup);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FISH SCHOOLS - Smooth circular particles with school behavior
    // ═══════════════════════════════════════════════════════════════════════════
    createFishSchools() {
        const totalFish = this.activePreset.fishCount;
        const schoolCount = 5;
        const fishPerSchool = Math.floor(totalFish / schoolCount);

        const fishColors = [
            new THREE.Color(0x00bfff),
            new THREE.Color(0xffd700),
            new THREE.Color(0xff6b6b),
            new THREE.Color(0x40e0d0),
            new THREE.Color(0xff8c00),
            new THREE.Color(0x9370db),
            new THREE.Color(0x00fa9a),
        ];

        for (let s = 0; s < schoolCount; s++) {
            const schoolColor = fishColors[s % fishColors.length];
            const schoolCenter = {
                x: (Math.random() - 0.5) * 120,
                y: 15 + Math.random() * 40,
                z: (Math.random() - 0.5) * 120,
            };
            const schoolRadius = 20 + Math.random() * 30;
            const orbitSpeed = 0.2 + Math.random() * 0.3;
            const orbitPhase = Math.random() * Math.PI * 2;

            const positions = new Float32Array(fishPerSchool * 3);
            const offsets = new Float32Array(fishPerSchool * 3);
            const phases = new Float32Array(fishPerSchool);
            const sizes = new Float32Array(fishPerSchool);

            for (let i = 0; i < fishPerSchool; i++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = Math.random() * schoolRadius;
                const vDist = (Math.random() - 0.5) * 15;

                positions[i * 3] = schoolCenter.x;
                positions[i * 3 + 1] = schoolCenter.y;
                positions[i * 3 + 2] = schoolCenter.z;

                offsets[i * 3] = Math.cos(angle) * dist;
                offsets[i * 3 + 1] = vDist;
                offsets[i * 3 + 2] = Math.sin(angle) * dist;

                phases[i] = Math.random() * Math.PI * 2;
                sizes[i] = 4 + Math.random() * 3;
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 3));
            geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
            geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uColor: { value: schoolColor },
                    uSchoolCenter: { value: new THREE.Vector3(schoolCenter.x, schoolCenter.y, schoolCenter.z) },
                    uOrbitSpeed: { value: orbitSpeed },
                    uOrbitPhase: { value: orbitPhase },
                },
                vertexShader: `
                    uniform float uTime;
                    uniform vec3 uSchoolCenter;
                    uniform float uOrbitSpeed;
                    uniform float uOrbitPhase;
                    attribute vec3 aOffset;
                    attribute float aPhase;
                    attribute float aSize;
                    varying float vDist;
                    
                    void main() {
                        // School orbits around center
                        float angle = uOrbitPhase + uTime * uOrbitSpeed;
                        float ca = cos(angle);
                        float sa = sin(angle);
                        
                        // Rotate offset around Y axis
                        vec3 rotatedOffset = vec3(
                            aOffset.x * ca - aOffset.z * sa,
                            aOffset.y + sin(uTime * 1.5 + aPhase) * 2.0,
                            aOffset.x * sa + aOffset.z * ca
                        );
                        
                        // Individual fish wiggle
                        rotatedOffset.x += sin(uTime * 5.0 + aPhase * 3.0) * 0.3;
                        rotatedOffset.z += cos(uTime * 4.0 + aPhase * 2.5) * 0.2;
                        
                        vec3 pos = uSchoolCenter + rotatedOffset;
                        
                        vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
                        vDist = length(mvPos.xyz);
                        
                        gl_PointSize = aSize * (200.0 / -mvPos.z);
                        gl_Position = projectionMatrix * mvPos;
                    }
                `,
                fragmentShader: `
                    uniform vec3 uColor;
                    varying float vDist;
                    
                    void main() {
                        // Smooth circular fish shape (not squared!)
                        vec2 uv = gl_PointCoord - 0.5;
                        float d = length(uv * vec2(1.0, 1.8)); // Slightly elongated
                        if (d > 0.5) discard;
                        
                        // Smooth anti-aliased edge
                        float alpha = 1.0 - smoothstep(0.35, 0.5, d);
                        
                        vec3 color = uColor;
                        // Shiny highlight
                        float highlight = pow(1.0 - d * 2.0, 3.0) * 0.3;
                        color += vec3(highlight);
                        
                        // Distance fog
                        float fog = 1.0 - exp(-vDist * 0.01);
                        color = mix(color, vec3(0.0, 0.1, 0.15), fog * 0.7);
                        
                        gl_FragColor = vec4(color, alpha);
                    }
                `,
                transparent: true,
                depthWrite: false,
            });

            const school = new THREE.Points(geometry, material);
            school.userData = { schoolCenter, orbitSpeed, orbitPhase };
            this.uniformsToUpdate.push(material.uniforms);
            this.fishSchools.push(school);
            this.scene.add(school);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // JELLYFISH - Glowing soft circular creatures
    // ═══════════════════════════════════════════════════════════════════════════
    createJellyfish() {
        const count = this.activePreset.jellyfishCount;
        const jellyColors = [
            new THREE.Color(0xff80ff),
            new THREE.Color(0x80ffff),
            new THREE.Color(0xffff80),
            new THREE.Color(0x80ff80),
            new THREE.Color(0xff8080),
            new THREE.Color(0x8080ff),
        ];

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const phases = new Float32Array(count);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 180;
            positions[i * 3 + 1] = 25 + Math.random() * 55;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 180;

            const c = jellyColors[Math.floor(Math.random() * jellyColors.length)];
            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;

            phases[i] = Math.random() * 6.28;
            sizes[i] = 12 + Math.random() * 18;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            vertexShader: `
                uniform float uTime;
                attribute vec3 aColor;
                attribute float aPhase;
                attribute float aSize;
                varying vec3 vColor;
                varying float vPulse;
                
                void main() {
                    vec3 pos = position;
                    pos.y += sin(uTime * 0.45 + aPhase) * 3.0;
                    pos.x += sin(uTime * 0.25 + aPhase * 1.3) * 2.0;
                    pos.z += cos(uTime * 0.35 + aPhase * 0.8) * 1.5;
                    
                    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
                    vColor = aColor;
                    vPulse = sin(uTime * 1.8 + aPhase) * 0.25 + 0.75;
                    
                    gl_PointSize = aSize * vPulse * (250.0 / -mvPos.z);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vPulse;
                
                void main() {
                    // Smooth circular glow (not squared!)
                    float d = length(gl_PointCoord - 0.5) * 2.0;
                    if (d > 1.0) discard;
                    
                    // Soft dome shape
                    float alpha = pow(1.0 - d, 1.8) * vPulse;
                    vec3 color = vColor * (0.6 + vPulse * 0.5);
                    
                    // Bright glowing center
                    color += vec3(1.0) * pow(1.0 - d, 5.0) * 0.5;
                    
                    gl_FragColor = vec4(color, alpha * 0.75);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.jellyfishMesh = new THREE.Points(geometry, material);
        this.uniformsToUpdate.push(material.uniforms);
        this.scene.add(this.jellyfishMesh);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PLANKTON - Bioluminescent soft circular particles
    // ═══════════════════════════════════════════════════════════════════════════
    createPlankton() {
        const count = this.activePreset.planktonCount;

        const positions = new Float32Array(count * 3);
        const phases = new Float32Array(count);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 220;
            positions[i * 3 + 1] = Math.random() * 90 + 5;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 220;
            phases[i] = Math.random() * 6.28;
            sizes[i] = 2 + Math.random() * 4;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uGlowIntensity: { value: 0.8 },
            },
            vertexShader: `
                uniform float uTime;
                uniform float uGlowIntensity;
                attribute float aPhase;
                attribute float aSize;
                varying float vGlow;
                
                void main() {
                    vec3 pos = position;
                    pos.y += sin(uTime * 0.25 + aPhase) * 0.8;
                    pos.x += sin(uTime * 0.18 + aPhase * 1.2) * 0.5;
                    pos.z += cos(uTime * 0.22 + aPhase * 0.9) * 0.4;
                    
                    vGlow = sin(uTime * 1.8 + aPhase * 3.5) * 0.5 + 0.5;
                    vGlow *= uGlowIntensity;
                    
                    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
                    gl_PointSize = (aSize + vGlow * 3.0) * (180.0 / -mvPos.z);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                varying float vGlow;
                
                void main() {
                    // Smooth circular glow (not squared!)
                    float d = length(gl_PointCoord - 0.5) * 2.0;
                    if (d > 1.0) discard;
                    
                    float alpha = pow(1.0 - d, 2.0);
                    vec3 color = mix(vec3(0.2, 0.7, 0.5), vec3(0.4, 1.0, 0.8), vGlow);
                    
                    gl_FragColor = vec4(color, alpha * (0.35 + vGlow * 0.5));
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.planktonMesh = new THREE.Points(geometry, material);
        this.uniformsToUpdate.push(material.uniforms);
        this.scene.add(this.planktonMesh);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BUBBLES - Smooth circular rising particles
    // ═══════════════════════════════════════════════════════════════════════════
    createBubbles() {
        const count = this.activePreset.bubbleCount;

        const positions = new Float32Array(count * 3);
        const speeds = new Float32Array(count);
        const phases = new Float32Array(count);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 180;
            positions[i * 3 + 1] = Math.random() * 80 - 10;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 180;
            speeds[i] = 0.4 + Math.random() * 0.6;
            phases[i] = Math.random() * 6.28;
            sizes[i] = 3 + Math.random() * 5;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

        this.bubbleData = { speeds, phases, count };

        const material = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            vertexShader: `
                uniform float uTime;
                attribute float aSpeed;
                attribute float aPhase;
                attribute float aSize;
                varying float vAlpha;
                
                void main() {
                    vec3 pos = position;
                    // Wobble motion
                    pos.x += sin(uTime * 2.5 + aPhase) * 0.4;
                    pos.z += cos(uTime * 2.0 + aPhase * 0.8) * 0.3;
                    
                    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
                    vAlpha = 1.0;
                    
                    gl_PointSize = aSize * (180.0 / -mvPos.z);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                varying float vAlpha;
                
                void main() {
                    // Smooth circular bubble (not squared!)
                    float d = length(gl_PointCoord - 0.5) * 2.0;
                    if (d > 1.0) discard;
                    
                    // Bubble with highlight and soft edge
                    float alpha = 1.0 - smoothstep(0.7, 1.0, d);
                    alpha *= 0.4;
                    
                    // Shiny highlight
                    vec2 highlightPos = gl_PointCoord - vec2(0.35, 0.35);
                    float highlight = 1.0 - smoothstep(0.0, 0.25, length(highlightPos));
                    
                    vec3 color = vec3(0.6, 0.85, 1.0);
                    color += vec3(highlight * 0.5);
                    
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.bubbleMesh = new THREE.Points(geometry, material);
        this.uniformsToUpdate.push(material.uniforms);
        this.scene.add(this.bubbleMesh);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LIGHTING
    // ═══════════════════════════════════════════════════════════════════════════
    createLighting() {
        const ambient = new THREE.AmbientLight(0x153050, 0.45);
        this.scene.add(ambient);

        const directional = new THREE.DirectionalLight(0x4488aa, 0.7);
        directional.position.set(25, 80, -25);
        this.scene.add(directional);

        const hemisphere = new THREE.HemisphereLight(0x4488cc, 0x001020, 0.35);
        this.scene.add(hemisphere);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENT LISTENERS
    // ═══════════════════════════════════════════════════════════════════════════
    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.targetCurrentStrength = Math.min(2.5, this.currentStrength + data.lineCount * 0.35);
                this.targetGlowIntensity = Math.min(1.5, this.glowIntensity + data.lineCount * 0.18);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true && data.comboCount > 1) {
                this.targetCurrentStrength = Math.min(3.5, this.currentStrength + data.comboCount * 0.45);
                this.targetGlowIntensity = Math.min(2.0, this.glowIntensity + data.comboCount * 0.22);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub);

        const resizeHandler = () => this.handleResize();
        window.addEventListener('resize', resizeHandler);
        this.eventUnsubscribers.push(() => window.removeEventListener('resize', resizeHandler));
    }

    handleResize() {
        if (!this.renderer || !this.camera) return;
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ANIMATION LOOP
    // ═══════════════════════════════════════════════════════════════════════════
    startAnimation() {
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);

        const loop = () => {
            if (!this.isActive) return;

            const time = this.clock.getElapsedTime();

            // Smooth transitions
            this.currentStrength += (this.targetCurrentStrength - this.currentStrength) * 0.018;
            this.targetCurrentStrength += (0.5 - this.targetCurrentStrength) * 0.006;
            this.glowIntensity += (this.targetGlowIntensity - this.glowIntensity) * 0.022;
            this.targetGlowIntensity += (0.8 - this.targetGlowIntensity) * 0.008;

            // Update all registered uniforms
            this.uniformsToUpdate.forEach(u => {
                if (u.uTime) u.uTime.value = time;
                if (u.uCurrentStrength) u.uCurrentStrength.value = this.currentStrength;
                if (u.uWaveIntensity) u.uWaveIntensity.value = 1.0 + this.currentStrength * 0.3;
                if (u.uIntensity) u.uIntensity.value = this.glowIntensity;
                if (u.uGlowIntensity) u.uGlowIntensity.value = this.glowIntensity;
            });

            // Animate bubbles rising
            if (this.bubbleMesh && this.bubbleData) {
                const pos = this.bubbleMesh.geometry.attributes.position;
                const { speeds, phases, count } = this.bubbleData;

                for (let i = 0; i < count; i++) {
                    let y = pos.getY(i) + speeds[i] * 0.4;
                    if (y > 100) {
                        y = -15;
                        pos.setX(i, (Math.random() - 0.5) * 180);
                        pos.setZ(i, (Math.random() - 0.5) * 180);
                    }
                    pos.setY(i, y);
                }
                pos.needsUpdate = true;
            }

            // Smooth camera sway (underwater drift feel)
            this.camera.position.x = Math.sin(time * 0.06) * 5;
            this.camera.position.y = 20 + Math.sin(time * 0.09) * 3;
            this.camera.position.z = 80 + Math.sin(time * 0.04) * 2;
            this.camera.lookAt(
                Math.sin(time * 0.03) * 2,
                5 + Math.sin(time * 0.05) * 2,
                Math.cos(time * 0.04) * 3
            );

            this.renderer.render(this.scene, this.camera);
            this.animationFrameId = requestAnimationFrame(loop);
        };

        this.animationFrameId = requestAnimationFrame(loop);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CLEANUP
    // ═══════════════════════════════════════════════════════════════════════════
    stop() {
        this.eventUnsubscribers.forEach(unsub => {
            if (typeof unsub === 'function') unsub();
        });
        this.eventUnsubscribers = [];

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        this.teardownQualityListener();
        this.disposeSceneContents();

        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }

        this.scene = null;
        this.camera = null;
        this.uniformsToUpdate = [];
        this.fishSchools = [];

        const container = document.getElementById('ocean-theme');
        if (container) container.innerHTML = '';

        super.stop();
    }
}
