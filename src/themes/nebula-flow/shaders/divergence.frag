// Divergence shader - computes the divergence of the velocity field
// Divergence measures how much fluid is "leaving" each point
// Used in pressure solve to enforce incompressibility

precision highp float;

varying vec2 v_texCoord;

uniform sampler2D u_velocity;
uniform vec2 u_texelSize;

void main() {
    // Sample velocity at neighboring cells (4-way stencil)
    float L = texture2D(u_velocity, v_texCoord - vec2(u_texelSize.x, 0.0)).x;  // Left
    float R = texture2D(u_velocity, v_texCoord + vec2(u_texelSize.x, 0.0)).x;  // Right
    float T = texture2D(u_velocity, v_texCoord + vec2(0.0, u_texelSize.y)).y;  // Top
    float B = texture2D(u_velocity, v_texCoord - vec2(0.0, u_texelSize.y)).y;  // Bottom

    // Compute divergence using central differences
    // div(v) = ∂vx/∂x + ∂vy/∂y
    float divergence = 0.5 * (R - L + T - B);

    gl_FragColor = vec4(divergence, 0.0, 0.0, 1.0);
}
