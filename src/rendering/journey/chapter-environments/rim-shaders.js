export const rimVertexShader = `
    varying vec2 vUv;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;

    void main() {
        vUv = uv;
        vNormal = normal;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
`;

export const rimFragmentShader = `
    uniform vec3 uColor;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;

    void main() {
        // Base color (dark rock)
        vec3 color = uColor;
        
        // Simple directional light (from top-right)
        vec3 lightDir = normalize(vec3(1.0, 1.0, 0.5));
        float diff = max(dot(vNormal, lightDir), 0.0);
        color *= (0.2 + diff * 0.8); // Ambient + Diffuse

        // 1. Height Fade (Soft Top Edge)
        // Rim moves from -8 to +2. We want to fade out the top part.
        // Start fading at Y=0, fully transparent at Y=2.5
        float heightAlpha = 1.0 - smoothstep(-1.0, 3.0, vWorldPosition.y);

        // 2. Inner Radius Fade (Soft blending with lava)
        // Center is 0,0. Inner radius is around 50.
        float dist = length(vWorldPosition.xz);
        float innerAlpha = smoothstep(45.0, 52.0, dist);

        float alpha = heightAlpha * innerAlpha;

        gl_FragColor = vec4(color, alpha);
    }
`;
