/**
 * Vertex Shader for the Supernova Core
 */
export const coreVertexShader = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Fragment Shader for the Supernova Core
 * Creates a pulsating, noise-based plasma effect
 */
export const coreFragmentShader = `
uniform float time;
uniform vec3 colorPrimary;   // Red/Magma
uniform vec3 colorSecondary; // Gold/Orange
uniform vec3 colorTertiary;  // Blue/Cyan (New)
uniform float intensity;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;

// Simplex 3D Noise function (simplified for performance)
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

    // First corner
    vec3 i  = floor(v + dot(v, C.yyy) );
    vec3 x0 = v - i + dot(i, C.xxx) ;

    // Other corners
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );

    //   x0 = x0 - 0.0 + 0.0 * C.xxx;
    //   x1 = x0 - i1  + 1.0 * C.xxx;
    //   x2 = x0 - i2  + 2.0 * C.xxx;
    //   x3 = x0 - 1.0 + 3.0 * C.xxx;
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y
    vec3 x3 = x0 - D.yyy;      // -1.0+3.0*C.x = -0.5 = -D.y

    // Permutations
    i = mod289(i);
    vec4 p = permute( permute( permute(
                i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

    // Gradients: 7x7 points over a square, mapped onto an octahedron.
    // The ring size 17*17 = 289 is close to a multiple of 49 (49*6 = 294)
    float n_ = 0.142857142857; // 1.0/7.0
    vec3  ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);  //  mod(p,7*7)

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)

    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );

    //vec4 s0 = vec4(lessThan(b0,0.0))*2.0 - 1.0;
    //vec4 s1 = vec4(lessThan(b1,0.0))*2.0 - 1.0;
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);

    //Normalise gradients
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    // Mix final noise value
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                                dot(p2,x2), dot(p3,x3) ) );
}

void main() {
    // Rotating noise
    float noise1 = snoise(vPosition * 0.5 + vec3(time * 0.2));
    float noise2 = snoise(vPosition * 1.5 - vec3(time * 0.4));
    
    // Combine noise layers
    float finalNoise = (noise1 + noise2 * 0.5) * 0.5 + 0.5; // 0.0 to 1.0
    
    // Fresnel effect for edge glow
    vec3 viewDir = normalize(cameraPosition - vPosition);
    float fresnel = pow(1.0 - dot(vNormal, viewDir), 1.5); // Sharpness of rim
    
    // Color mixing based on Reference Image:
    // Core: Red/Orange/Gold chaotic mix
    // Rim: Blue/Cyan/Greenish
    
    // 1. Core mix (Red <-> Gold) based on deep noise
    vec3 coreColor = mix(colorPrimary, colorSecondary, finalNoise);
    
    // 2. Add patches of Tertiary (Blue) in the turbulence
    float patches = smoothstep(0.6, 0.8, noise2); // Isolated patches
    vec3 complexCore = mix(coreColor, colorTertiary, patches * 0.5);

    // 3. Rim mix (Core <-> Blue Electric Rim) based on Fresnel
    // We mix slightly earlier than full rim to get that "shell" look
    vec3 finalColor = mix(complexCore, colorTertiary, fresnel * 0.9);
    
    // Add pulsing intensity
    finalColor *= (1.0 + intensity * 0.5);
    
    // Add a hot white center to the brightest parts
    float hotSpot = smoothstep(0.7, 1.0, finalNoise) * (1.0 - fresnel);
    finalColor += vec3(1.0, 1.0, 0.8) * hotSpot * 0.5;

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

/**
 * Vertex Shader for Shockwaves
 */
export const shockwaveVertexShader = `
varying vec2 vUv;
varying vec3 vNormal;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Fragment Shader for Shockwaves
 */
export const shockwaveFragmentShader = `
uniform float time;
uniform float opacity;
uniform vec3 color;

varying vec2 vUv;
varying vec3 vNormal;

void main() {
    // Simple edge glow for the ring/torus
    float intensity = pow(0.6 - dot(vNormal, vec3(0, 0, 1.0)), 2.0);
    gl_FragColor = vec4(color, opacity * (0.3 + intensity));
}
`;

/**
 * Fragment Shader for Particles (Points)
 * Makes particles round and soft
 */
export const particleFragmentShader = `
uniform vec3 color;
uniform float opacity;

void main() {
    // Calculate distance from center of point
    vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
    if (dot(circCoord, circCoord) > 1.0) {
        discard;
    }
    
    // Soft edge
    float alpha = 1.0 - smoothstep(0.8, 1.0, length(circCoord));
    
    gl_FragColor = vec4(color, opacity * alpha);
}
`;
