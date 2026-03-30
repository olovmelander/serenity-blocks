// Display shader - renders the dye field with optional bloom/glow effect
// Final shader that produces the visible output

precision highp float;

varying vec2 v_texCoord;

uniform sampler2D u_dye;
uniform float u_bloomIntensity;

void main() {
    // Sample the dye field
    vec4 color = texture2D(u_dye, v_texCoord);

    // Boost base brightness to make colors more visible
    color.rgb *= 2.5;

    // Apply bloom by brightening and saturating colors
    if (u_bloomIntensity > 0.0) {
        // Increase brightness
        color.rgb *= 1.0 + u_bloomIntensity;

        // Soft light effect - enhance the glow
        float brightness = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        color.rgb += color.rgb * brightness * u_bloomIntensity * 0.5;
    }

    // Ensure colors stay in valid range
    color.rgb = clamp(color.rgb, 0.0, 1.0);

    gl_FragColor = vec4(color.rgb, 1.0);
}
