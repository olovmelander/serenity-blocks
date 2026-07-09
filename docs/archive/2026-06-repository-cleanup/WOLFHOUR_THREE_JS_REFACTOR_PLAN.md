# Wolfhour Theme Three.js Refactor - Detailed Implementation Plan

## Overview

Refactor the Wolfhour theme from its current DOM/Canvas/WebGL hybrid architecture to a complete Three.js implementation. This will create a stunning monochrome mystical mountain scene with silver nebulas, GPU-driven twinkling stars, ethereal spirits, and atmospheric gameplay effects.

---

## Visual Design Goals

### Color Palette (Strictly Monochrome)
- **Pure White**: `#ffffff` - Star cores, highlights
- **Silver**: `#c0c0c0` - Nebula highlights, spirit glow
- **Cool White**: `#e0e0ff` - Star tint, ambient glow
- **Grey**: `#808080` - Mountain mid-tones
- **Dark Grey**: `#303030` - Distant mountains
- **Near Black**: `#151515` - Foreground mountains
- **Pure Black**: `#000000` - Deep space, shadows

### Mountain Style (DNKL Album Art Inspired)
- Rocky, textured peaks with FBM displacement
- Jagged silhouettes against the night sky
- Multiple depth layers for parallax effect
- No snow - pure rock texture with subtle detail

### Atmosphere
- Silver/grey nebula clouds drifting slowly
- Dense starfield with multi-layer depth
- Ethereal spirits floating above mountains
- Cosmic rifts and celestial beams for effects

---

## File Structure

```
src/themes/wolfhour/
├── wolfhour-theme.js              # Main theme (REWRITE)
├── wolfhour-tetrominos.js         # Keep existing
├── shaders/
│   ├── mountain.vert.glsl         # NEW - Mountain vertex shader
│   ├── mountain.frag.glsl         # NEW - Mountain fragment shader
│   ├── starfield.vert.glsl        # NEW - Starfield vertex shader
│   ├── starfield.frag.glsl        # NEW - Starfield fragment shader
│   ├── spirit.vert.glsl           # NEW - Spirit vertex shader
│   ├── spirit.frag.glsl           # NEW - Spirit fragment shader
│   ├── cosmic-rift.vert.glsl      # NEW - Cosmic rift effect
│   ├── cosmic-rift.frag.glsl      # NEW - Cosmic rift effect
│   └── vignette.glsl              # NEW - Post-processing vignette
└── webgl-wolf-renderer.js         # DELETE (replaced by Three.js)

public/textures/wolfhour/
├── nebula-silver-1.png            # NEW - Silver nebula texture 1
├── nebula-silver-2.png            # NEW - Silver nebula texture 2
└── nebula-silver-3.png            # NEW - Silver nebula texture 3
```

---

## Class Architecture

### Main Class: `WolfhourTheme extends BaseTheme`

```javascript
export default class WolfhourTheme extends BaseTheme {
    constructor() {
        super('wolfhour');

        // Three.js core
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;       // EffectComposer for post-processing
        this.clock = new THREE.Clock();

        // Scene elements
        this.mountains = [];        // Mountain mesh array (3 layers)
        this.starfield = null;      // Points geometry
        this.nebulaPlanes = [];     // Nebula texture planes
        this.spirits = null;        // Spirit particles/instances

        // Effect systems
        this.starBursts = [];       // Piece lock star explosions
        this.cosmicRifts = [];      // Combo cosmic rift effects
        this.celestialBeams = [];   // Line clear beam effects
        this.mountainPulse = 0;     // Mountain glow intensity

        // Effect state (smooth decay)
        this.effectState = {
            starBurstIntensity: 0,
            cosmicRiftIntensity: 0,
            celestialBeamIntensity: 0,
            mountainPulse: 0,
            spiritSurge: 0,
            bloomBoost: 0,
        };

        // Animation
        this.time = 0;
        this.eventUnsubscribers = [];

        // Quality
        this.qualityPreset = null;
    }
}
```

---

## Scene Layer Composition (Z-Depth Order)

```
Z Position    Element                Description
────────────────────────────────────────────────────────────────
-5000         Sky Sphere             Black gradient background
-4000         Nebula Layer 3         Farthest nebula (slowest drift)
-3500         Star Layer 3           Distant stars (smallest, slowest)
-3000         Nebula Layer 2         Middle nebula
-2500         Star Layer 2           Mid-distance stars
-2000         Nebula Layer 1         Nearest nebula (fastest drift)
-1500         Mountain Layer 3       Distant mountains (darkest: #303030)
-1200         Star Layer 1           Near stars (largest, fastest twinkle)
-1000         Mountain Layer 2       Mid mountains (#202020)
-800          Celestial Beams        Line clear effect layer
-500          Mountain Layer 1       Foreground mountains (#151515)
-200          Cosmic Rifts           Combo effect layer
0             Spirit Particles       Floating above scene
100           Star Bursts            Piece lock explosions
```

---

## Quality Presets

```javascript
const QUALITY_PRESETS = {
    Minimal: {
        starCount: 2000,
        mountainSegments: 32,
        nebulaResolution: 512,
        spiritCount: 0,
        enableBloom: false,
        bloomStrength: 0,
        maxStarBursts: 3,
        maxCosmicRifts: 1,
        maxCelestialBeams: 0,
        starTwinkleSpeed: 0.5,
    },
    Low: {
        starCount: 5000,
        mountainSegments: 64,
        nebulaResolution: 512,
        spiritCount: 3,
        enableBloom: false,
        bloomStrength: 0,
        maxStarBursts: 5,
        maxCosmicRifts: 2,
        maxCelestialBeams: 0,
        starTwinkleSpeed: 0.7,
    },
    Medium: {
        starCount: 10000,
        mountainSegments: 128,
        nebulaResolution: 1024,
        spiritCount: 8,
        enableBloom: true,
        bloomStrength: 0.3,
        maxStarBursts: 8,
        maxCosmicRifts: 3,
        maxCelestialBeams: 2,
        starTwinkleSpeed: 1.0,
    },
    High: {
        starCount: 20000,
        mountainSegments: 256,
        nebulaResolution: 1024,
        spiritCount: 15,
        enableBloom: true,
        bloomStrength: 0.5,
        maxStarBursts: 12,
        maxCosmicRifts: 4,
        maxCelestialBeams: 4,
        starTwinkleSpeed: 1.0,
    },
    Ultra: {
        starCount: 40000,
        mountainSegments: 256,
        nebulaResolution: 2048,
        spiritCount: 25,
        enableBloom: true,
        bloomStrength: 0.6,
        maxStarBursts: 15,
        maxCosmicRifts: 5,
        maxCelestialBeams: 6,
        starTwinkleSpeed: 1.0,
    },
    Extreme: {
        starCount: 80000,
        mountainSegments: 512,
        nebulaResolution: 2048,
        spiritCount: 40,
        enableBloom: true,
        bloomStrength: 0.8,
        maxStarBursts: 20,
        maxCosmicRifts: 6,
        maxCelestialBeams: 8,
        starTwinkleSpeed: 1.2,
    },
};
```

---

## Implementation Phases

### Phase 1: Core Three.js Setup

**File: `wolfhour-theme.js`**

#### 1.1 Renderer Initialization
```javascript
initRenderer(container) {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
        antialias: this.getAntialiasEnabled(),
        alpha: false,
        powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setPixelRatio(this.getEffectivePixelRatio());
    this.renderer.setSize(width, height);
    this.renderer.sortObjects = true;

    this.renderer.domElement.style.cssText =
        'position:absolute;top:0;left:0;width:100%;height:100%';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    // Orthographic camera for 2D-style layered scene
    const aspect = width / height;
    const frustumSize = 1000;
    this.camera = new THREE.OrthographicCamera(
        frustumSize * aspect / -2,
        frustumSize * aspect / 2,
        frustumSize / 2,
        frustumSize / -2,
        0.1,
        10000
    );
    this.camera.position.set(0, 0, 1000);
    this.camera.lookAt(0, 0, 0);
}
```

#### 1.2 Resize Handler
```javascript
handleResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / height;
    const frustumSize = 1000;

    this.camera.left = frustumSize * aspect / -2;
    this.camera.right = frustumSize * aspect / 2;
    this.camera.top = frustumSize / 2;
    this.camera.bottom = frustumSize / -2;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    if (this.composer) {
        this.composer.setSize(width, height);
    }
}
```

---

### Phase 2: FBM Mountain System

**Reference: `src/rendering/journey/chapter-environments/mountain-peaks.js:523-635`**

#### 2.1 Mountain Vertex Shader
```glsl
// shaders/mountain.vert.glsl
attribute float aHeight;

varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vHeight;
varying vec2 vUv;

void main() {
    vNormal = normalize(normalMatrix * normal);
    vUv = uv;
    vHeight = aHeight;

    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
```

#### 2.2 Mountain Fragment Shader (Wolfhour-specific)
```glsl
// shaders/mountain.frag.glsl
uniform vec3 uRockColorDark;      // #151515 foreground
uniform vec3 uRockColorMid;       // #202020 mid
uniform vec3 uRockColorLight;     // #303030 distant
uniform float uMountainLayer;     // 0.0 = fore, 0.5 = mid, 1.0 = distant
uniform float uPulseIntensity;    // Gameplay pulse effect
uniform float uTime;

varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vHeight;
varying vec2 vUv;

// FBM noise for rock texture
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

void main() {
    // Base rock color based on layer
    vec3 rockColor = mix(uRockColorDark, uRockColorLight, uMountainLayer);

    // Subtle rock texture variation
    float rockNoise = fbm(vWorldPosition.xz * 0.02);
    rockColor *= 0.9 + rockNoise * 0.2;

    // Simple lighting
    vec3 lightDir = normalize(vec3(0.3, 0.8, 0.5));
    float diff = max(0.4, dot(vNormal, lightDir));
    vec3 color = rockColor * diff;

    // Rim lighting for silhouette definition
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float rim = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.0);
    color += vec3(0.1, 0.1, 0.12) * rim;

    // Gameplay pulse effect (silver glow on peaks)
    float peakGlow = smoothstep(0.6, 1.0, vHeight) * uPulseIntensity;
    color += vec3(0.8, 0.8, 0.9) * peakGlow * 0.3;

    // Base fade (hide hard geometry edges)
    float baseFade = smoothstep(0.0, 0.15, vHeight);

    gl_FragColor = vec4(color, baseFade);
}
```

#### 2.3 Mountain Creation Function
```javascript
createMountains() {
    const configs = [
        // Foreground - darkest, largest
        {
            z: -500,
            size: 2000,
            height: 400,
            color: new THREE.Color(0x151515),
            layer: 0.0,
            seed: 11111,
        },
        // Mid-ground
        {
            z: -1000,
            size: 2500,
            height: 500,
            color: new THREE.Color(0x202020),
            layer: 0.5,
            seed: 22222,
        },
        // Background - lightest, furthest
        {
            z: -1500,
            size: 3000,
            height: 600,
            color: new THREE.Color(0x303030),
            layer: 1.0,
            seed: 33333,
        },
    ];

    configs.forEach(config => {
        const mountain = this.createFBMMountain(config);
        this.mountains.push(mountain);
        this.scene.add(mountain);
    });
}

createFBMMountain(config) {
    const segments = this.qualityPreset.mountainSegments;
    const geometry = new THREE.PlaneGeometry(config.size, config.size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    // CPU-side FBM displacement (same as mountain-peaks.js)
    const posAttribute = geometry.attributes.position;
    const heights = [];
    const seed = config.seed;

    const fract = (n) => n - Math.floor(n);
    const mix = (a, b, t) => a * (1 - t) + b * t;
    const rand = (x, y) => Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;

    const noise = (x, y) => {
        const i = Math.floor(x);
        const j = Math.floor(y);
        const f = fract(x);
        const g = fract(y);
        const u = f * f * (3.0 - 2.0 * f);
        const v = g * g * (3.0 - 2.0 * g);
        return mix(
            mix(fract(rand(i, j)), fract(rand(i + 1, j)), u),
            mix(fract(rand(i, j + 1)), fract(rand(i + 1, j + 1)), u),
            v
        );
    };

    const fbm = (x, y) => {
        let v = 0.0;
        let a = 0.5;
        for (let i = 0; i < 5; i++) {
            v += a * noise(x, y);
            x *= 2.0;
            y *= 2.0;
            a *= 0.5;
        }
        return v;
    };

    // Apply displacement to create jagged peaks
    for (let i = 0; i < posAttribute.count; i++) {
        const x = posAttribute.getX(i);
        const z = posAttribute.getZ(i);

        // Distance falloff (cone shape)
        const dist = Math.sqrt(x * x + z * z);
        const maxDist = config.size * 0.45;

        if (dist > maxDist) {
            posAttribute.setY(i, 0);
            heights.push(0);
            continue;
        }

        const normDist = dist / maxDist;
        const cone = Math.pow(1.0 - normDist, 1.5) * config.height;

        // Noise detail for jagged peaks
        const n = fbm(x * 0.01, z * 0.01);
        const n2 = fbm(x * 0.04, z * 0.04);
        const detail = (n * 0.7 + n2 * 0.3) * config.height * 0.4 * (1.0 - normDist);

        const h = cone + detail;
        posAttribute.setY(i, h);
        heights.push(h);
    }

    geometry.computeVertexNormals();

    // Height attribute for shader
    const heightAttr = new Float32Array(posAttribute.count);
    for (let i = 0; i < posAttribute.count; i++) {
        heightAttr[i] = heights[i] / config.height;
    }
    geometry.setAttribute('aHeight', new THREE.BufferAttribute(heightAttr, 1));

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uRockColorDark: { value: new THREE.Color(0x151515) },
            uRockColorMid: { value: new THREE.Color(0x202020) },
            uRockColorLight: { value: new THREE.Color(0x303030) },
            uMountainLayer: { value: config.layer },
            uPulseIntensity: { value: 0 },
            uTime: { value: 0 },
        },
        vertexShader: mountainVertexShader,
        fragmentShader: mountainFragmentShader,
        transparent: true,
        depthWrite: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, -config.height * 0.3, config.z);
    return mesh;
}
```

---

### Phase 3: GPU-Driven Starfield

**Reference: `src/themes/stellar-drift/stellar-drift-theme.js:364-519`**

#### 3.1 Starfield Vertex Shader
```glsl
// shaders/starfield.vert.glsl
attribute float aSize;
attribute vec2 aTwinkle;     // x: phase, y: speed
attribute float aBrightness;

uniform float uTime;
uniform float uPixelRatio;
uniform float uEventBoost;   // Gameplay effect boost

varying vec3 vColor;
varying float vBrightness;

void main() {
    vColor = color;

    // Twinkle animation
    float twinkle = sin(uTime * aTwinkle.y + aTwinkle.x);
    vBrightness = aBrightness * (0.7 + twinkle * 0.3);
    vBrightness *= (1.0 + uEventBoost * 0.5);

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    // Size attenuation
    gl_PointSize = aSize * uPixelRatio * (300.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 1.0, 80.0);

    gl_Position = projectionMatrix * mvPosition;
}
```

#### 3.2 Starfield Fragment Shader
```glsl
// shaders/starfield.frag.glsl
varying vec3 vColor;
varying float vBrightness;

void main() {
    // Soft circular point with glow
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center) * 2.0;

    // Soft circular falloff
    float softCircle = 1.0 - smoothstep(0.0, 1.0, dist);

    // Core brightness
    vec3 coreColor = vColor * vBrightness * 1.5;
    float alpha = softCircle * (vBrightness + 0.2);

    gl_FragColor = vec4(coreColor, alpha);
}
```

#### 3.3 Starfield Creation
```javascript
createStarfield() {
    const count = this.qualityPreset.starCount;
    const geometry = new THREE.BufferGeometry();

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const twinkleData = new Float32Array(count * 2);
    const brightness = new Float32Array(count);

    // Monochrome star colors (silver/white palette)
    const starColors = [
        new THREE.Color(0xffffff),  // Pure white
        new THREE.Color(0xe0e0ff),  // Cool white
        new THREE.Color(0xd0d0e0),  // Silver
        new THREE.Color(0xc0c0d0),  // Dim silver
        new THREE.Color(0xf0f0ff),  // Blue-white
    ];

    for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const i2 = i * 2;

        // Distribute stars across sky hemisphere
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        // 3 depth layers
        const layerRand = Math.random();
        let radius;
        if (layerRand < 0.33) {
            radius = 1200 + Math.random() * 300;  // Near layer
        } else if (layerRand < 0.66) {
            radius = 2500 + Math.random() * 500;  // Mid layer
        } else {
            radius = 3500 + Math.random() * 1000; // Far layer
        }

        positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i3 + 1] = Math.abs(radius * Math.sin(phi) * Math.sin(theta)) * 0.5; // Upper hemisphere
        positions[i3 + 2] = -radius * Math.cos(phi) - 1000;

        const color = starColors[Math.floor(Math.random() * starColors.length)];
        colors[i3] = color.r;
        colors[i3 + 1] = color.g;
        colors[i3 + 2] = color.b;

        sizes[i] = 20 + Math.random() * 40;
        twinkleData[i2] = Math.random() * Math.PI * 2;     // Phase
        twinkleData[i2 + 1] = 1.0 + Math.random() * 2.5;   // Speed
        brightness[i] = 0.3 + Math.random() * 0.7;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkleData, 2));
    geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uPixelRatio: { value: this.renderer.getPixelRatio() },
            uEventBoost: { value: 0 },
        },
        vertexShader: starfieldVertexShader,
        fragmentShader: starfieldFragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexColors: true,
    });

    this.starfield = new THREE.Points(geometry, material);
    this.scene.add(this.starfield);
}
```

---

### Phase 4: Silver Nebula Backdrop

**Reference: `src/themes/stellar-drift/stellar-drift-theme.js:656-803`**

#### 4.1 Nebula Configuration
```javascript
createNebulaBackdrop() {
    const textureLoader = new THREE.TextureLoader();
    const texturePath = './textures/wolfhour/';

    // Load silver nebula textures (user-generated)
    const textures = [
        textureLoader.load(texturePath + 'nebula-silver-1.png'),
        textureLoader.load(texturePath + 'nebula-silver-2.png'),
        textureLoader.load(texturePath + 'nebula-silver-3.png'),
    ];

    textures.forEach(t => {
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
    });

    // Nebula layer configurations
    const nebulaConfigs = [
        // Near layer - faster drift, larger
        {
            texture: textures[0],
            x: 0,
            y: 200,
            z: -2000,
            size: 3000,
            speed: 8,      // pixels/second
            opacity: 0.25,
        },
        // Mid layer
        {
            texture: textures[1],
            x: -500,
            y: 100,
            z: -3000,
            size: 4000,
            speed: 5,
            opacity: 0.2,
        },
        // Far layer - slowest, creates depth
        {
            texture: textures[2],
            x: 500,
            y: 300,
            z: -4000,
            size: 5000,
            speed: 3,
            opacity: 0.15,
        },
    ];

    this.nebulaPlanes = [];

    nebulaConfigs.forEach((config, index) => {
        const geometry = new THREE.PlaneGeometry(config.size, config.size * 0.6);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: config.texture },
                uOpacity: { value: config.opacity },
                uPulse: { value: 0 },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform float uOpacity;
                uniform float uPulse;
                varying vec2 vUv;

                void main() {
                    vec4 texColor = texture2D(tDiffuse, vUv);

                    // Heavy edge fade
                    float fadeX = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
                    float fadeY = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
                    float fade = fadeX * fadeY;

                    // Pulse effect (gameplay)
                    float alpha = texColor.a * (uOpacity + uPulse * 0.15) * fade;
                    vec3 color = texColor.rgb * (1.0 + uPulse * 0.8);

                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(config.x, config.y, config.z);
        mesh.renderOrder = -2000 - index;

        // Smart loop data
        mesh.userData.speed = config.speed;
        mesh.userData.startX = config.x;
        mesh.userData.wrapBoundary = config.size * 1.5;

        this.nebulaPlanes.push(mesh);
        this.scene.add(mesh);
    });
}
```

#### 4.2 Nebula Animation (Smart Loop)
```javascript
updateNebulas(deltaTime) {
    this.nebulaPlanes.forEach(nebula => {
        // Drift left-to-right
        nebula.position.x += nebula.userData.speed * deltaTime;

        // Smart wrap when off-screen
        if (nebula.position.x > nebula.userData.wrapBoundary) {
            nebula.position.x = -nebula.userData.wrapBoundary;
        }
    });
}
```

---

### Phase 5: Spirit Particle System

#### 5.1 Spirit Configuration
```javascript
createSpirits() {
    const count = this.qualityPreset.spiritCount;
    if (count === 0) return;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        // Random position above mountains
        positions[i * 3] = (Math.random() - 0.5) * 1500;
        positions[i * 3 + 1] = 100 + Math.random() * 400;
        positions[i * 3 + 2] = -200 - Math.random() * 600;

        phases[i] = Math.random() * Math.PI * 2;
        speeds[i] = 0.5 + Math.random() * 1.0;
        sizes[i] = 30 + Math.random() * 50;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uPixelRatio: { value: this.renderer.getPixelRatio() },
            uSurgeIntensity: { value: 0 },
        },
        vertexShader: `
            attribute float aPhase;
            attribute float aSpeed;
            attribute float aSize;

            uniform float uTime;
            uniform float uPixelRatio;
            uniform float uSurgeIntensity;

            varying float vAlpha;

            void main() {
                // Floating sine wave animation
                vec3 pos = position;
                float t = uTime * aSpeed + aPhase;
                pos.y += sin(t) * 20.0;
                pos.x += cos(t * 0.7) * 15.0;

                // Fade based on height and time
                float heightFade = smoothstep(50.0, 200.0, pos.y);
                float pulseFade = 0.3 + sin(t * 2.0) * 0.2;
                vAlpha = heightFade * pulseFade * (1.0 + uSurgeIntensity * 0.5);

                vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                gl_PointSize = aSize * uPixelRatio * (1.0 + uSurgeIntensity * 0.3);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            varying float vAlpha;

            void main() {
                vec2 center = gl_PointCoord - 0.5;
                float dist = length(center) * 2.0;

                // Soft ethereal glow
                float glow = 1.0 - smoothstep(0.0, 1.0, dist);
                glow = pow(glow, 1.5);

                // Silver/white color
                vec3 color = vec3(0.9, 0.9, 1.0);

                gl_FragColor = vec4(color, glow * vAlpha * 0.6);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    this.spirits = new THREE.Points(geometry, material);
    this.scene.add(this.spirits);
}
```

---

### Phase 6: Gameplay Effects

#### 6.1 Effect Event Handlers
```javascript
setupEventListeners() {
    const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
        const settings = window.settings;
        if (this.isActive && settings?.backgroundComboEffects === true) {
            this.onLineClear(data);
        }
    });

    const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
        const settings = window.settings;
        if (this.isActive && settings?.backgroundComboEffects === true) {
            this.onCombo(data);
        }
    });

    const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
        const settings = window.settings;
        if (this.isActive && settings?.backgroundComboEffects === true) {
            this.onPieceLock();
        }
    });

    this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
}
```

#### 6.2 Piece Lock Effect (Star Burst + Mountain Pulse)
```javascript
onPieceLock() {
    // Trigger star burst
    this.effectState.starBurstIntensity = 1.0;

    // Mountain pulse
    this.effectState.mountainPulse = 0.8;

    // Boost star brightness briefly
    if (this.starfield) {
        this.starfield.material.uniforms.uEventBoost.value = 0.5;
    }
}
```

#### 6.3 Line Clear Effect (Celestial Beam)
```javascript
onLineClear(data) {
    const lineCount = data?.detail?.lineCount ?? data?.lineCount ?? 1;

    // Create celestial beams
    if (this.celestialBeams.length < this.qualityPreset.maxCelestialBeams) {
        for (let i = 0; i < Math.min(lineCount, 2); i++) {
            this.createCelestialBeam();
        }
    }

    // Boost nebula opacity
    this.effectState.nebulaBoost = 0.6;

    // Intensify bloom
    this.effectState.bloomBoost = 0.3;
}
```

#### 6.4 Combo Effect (Cosmic Rift + Spirit Surge)
```javascript
onCombo(data) {
    const comboCount = data?.detail?.comboCount ?? data?.comboCount ?? 0;

    if (comboCount >= 3) {
        // Create cosmic rift
        if (this.cosmicRifts.length < this.qualityPreset.maxCosmicRifts) {
            this.createCosmicRift();
        }
        this.effectState.cosmicRiftIntensity = Math.min(comboCount * 0.2, 1.0);
    }

    if (comboCount >= 5) {
        // Spirit surge
        this.effectState.spiritSurge = Math.min(comboCount * 0.15, 1.0);
    }

    // Mountain glow increases with combo
    this.effectState.mountainPulse = Math.min(comboCount * 0.1, 0.8);
}
```

#### 6.5 Effect Decay System
```javascript
updateEffects(deltaTime) {
    const decay = Math.pow(0.95, deltaTime * 60); // ~60 FPS reference

    // Decay all effect intensities
    this.effectState.starBurstIntensity *= decay;
    this.effectState.mountainPulse *= decay;
    this.effectState.cosmicRiftIntensity *= decay;
    this.effectState.spiritSurge *= decay;
    this.effectState.nebulaBoost *= decay;
    this.effectState.bloomBoost *= decay;

    // Apply to uniforms
    if (this.starfield) {
        this.starfield.material.uniforms.uEventBoost.value = this.effectState.starBurstIntensity;
    }

    this.mountains.forEach(m => {
        m.material.uniforms.uPulseIntensity.value = this.effectState.mountainPulse;
    });

    if (this.spirits) {
        this.spirits.material.uniforms.uSurgeIntensity.value = this.effectState.spiritSurge;
    }

    this.nebulaPlanes.forEach(n => {
        n.material.uniforms.uPulse.value = this.effectState.nebulaBoost;
    });

    // Bloom boost
    if (this.bloomPass) {
        const baseStrength = this.qualityPreset.bloomStrength;
        this.bloomPass.strength = baseStrength + this.effectState.bloomBoost * 0.5;
    }
}
```

---

### Phase 7: Post-Processing

#### 7.1 Setup Effect Composer
```javascript
setupPostProcessing() {
    if (!this.qualityPreset.enableBloom) {
        // No post-processing, render directly
        return;
    }

    this.composer = new EffectComposer(this.renderer);

    // Base render pass
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // Bloom pass (silver glow)
    this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        this.qualityPreset.bloomStrength,  // strength
        0.5,                                // radius
        0.4                                 // threshold
    );
    this.composer.addPass(this.bloomPass);

    // Vignette pass
    const vignettePass = new ShaderPass(VignetteShader);
    vignettePass.uniforms.darkness.value = 0.6;
    vignettePass.uniforms.offset.value = 1.2;
    this.composer.addPass(vignettePass);
}
```

#### 7.2 Vignette Shader
```javascript
const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        darkness: { value: 0.5 },
        offset: { value: 1.0 },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float darkness;
        uniform float offset;
        varying vec2 vUv;

        void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            vec2 uv = (vUv - 0.5) * 2.0;
            float dist = length(uv);
            float vig = smoothstep(offset, offset - 0.5, dist);
            texel.rgb = mix(texel.rgb * (1.0 - darkness), texel.rgb, vig);
            gl_FragColor = texel;
        }
    `,
};
```

---

### Phase 8: Animation Loop

```javascript
startAnimation() {
    const animate = () => {
        if (!this.isActive) return;

        this.animationFrameId = requestAnimationFrame(animate);

        const deltaTime = this.clock.getDelta();
        this.time += deltaTime;

        // Update uniforms
        if (this.starfield) {
            this.starfield.material.uniforms.uTime.value = this.time;
        }
        if (this.spirits) {
            this.spirits.material.uniforms.uTime.value = this.time;
        }
        this.mountains.forEach(m => {
            m.material.uniforms.uTime.value = this.time;
        });

        // Update systems
        this.updateNebulas(deltaTime);
        this.updateEffects(deltaTime);
        this.updateCelestialBeams(deltaTime);
        this.updateCosmicRifts(deltaTime);

        // Render
        if (this.composer) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    };

    animate();
}
```

---

### Phase 9: Cleanup

```javascript
stop() {
    this.isActive = false;

    if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
    }
}

cleanup() {
    this.stop();

    // Unsubscribe from events
    this.eventUnsubscribers.forEach(unsub => unsub());
    this.eventUnsubscribers = [];

    // Dispose Three.js resources
    this.mountains.forEach(m => {
        m.geometry.dispose();
        m.material.dispose();
    });
    this.mountains = [];

    if (this.starfield) {
        this.starfield.geometry.dispose();
        this.starfield.material.dispose();
        this.starfield = null;
    }

    this.nebulaPlanes.forEach(n => {
        n.geometry.dispose();
        n.material.uniforms.tDiffuse.value?.dispose();
        n.material.dispose();
    });
    this.nebulaPlanes = [];

    if (this.spirits) {
        this.spirits.geometry.dispose();
        this.spirits.material.dispose();
        this.spirits = null;
    }

    if (this.composer) {
        this.composer.dispose();
        this.composer = null;
    }

    if (this.renderer) {
        this.renderer.dispose();
        this.renderer.domElement.remove();
        this.renderer = null;
    }

    this.scene = null;
    this.camera = null;
}
```

---

## Files to Create/Modify Summary

| File | Action | Lines (Est.) |
|------|--------|-------------|
| `src/themes/wolfhour/wolfhour-theme.js` | **REWRITE** | ~800 |
| `src/themes/wolfhour/shaders/mountain.vert.glsl` | **CREATE** | ~20 |
| `src/themes/wolfhour/shaders/mountain.frag.glsl` | **CREATE** | ~80 |
| `src/themes/wolfhour/shaders/starfield.vert.glsl` | **CREATE** | ~30 |
| `src/themes/wolfhour/shaders/starfield.frag.glsl` | **CREATE** | ~20 |
| `src/themes/wolfhour/webgl-wolf-renderer.js` | **DELETE** | -645 |

---

## Texture Assets Needed

Please generate these silver nebula PNG textures:

1. **nebula-silver-1.png** (2048x2048) - Light silver/white wispy nebula
2. **nebula-silver-2.png** (2048x2048) - Medium grey nebula with more structure
3. **nebula-silver-3.png** (2048x2048) - Dark grey/charcoal nebula for depth

Place in: `public/textures/wolfhour/`

---

## Implementation Order

1. Core Three.js setup (renderer, camera, scene)
2. FBM Mountains (3 layers with shaders)
3. GPU Starfield (multi-layer with twinkle)
4. Nebula Backdrop (texture planes with drift)
5. Spirit Particles (floating ethereal effects)
6. Gameplay Effects (bursts, beams, rifts)
7. Post-Processing (bloom, vignette)
8. Quality Presets (wire everything up)
9. Polish & Testing
