// Gradient subtraction shader - makes velocity field incompressible
// Subtracts pressure gradient from velocity: v_new = v - ∇p
// This is the final step that enforces mass conservation

precision highp float;

varying vec2 v_texCoord;

uniform sampler2D u_velocity;
uniform sampler2D u_pressure;
uniform vec2 u_texelSize;

void main() {
    // Sample pressure at neighboring cells
    float L = texture2D(u_pressure, v_texCoord - vec2(u_texelSize.x, 0.0)).x;
    float R = texture2D(u_pressure, v_texCoord + vec2(u_texelSize.x, 0.0)).x;
    float T = texture2D(u_pressure, v_texCoord + vec2(0.0, u_texelSize.y)).x;
    float B = texture2D(u_pressure, v_texCoord - vec2(0.0, u_texelSize.y)).x;

    // Compute pressure gradient using central differences
    vec2 gradient = 0.5 * vec2(R - L, T - B);

    // Subtract gradient from velocity
    vec2 velocity = texture2D(u_velocity, v_texCoord).xy;
    velocity -= gradient;

    gl_FragColor = vec4(velocity, 0.0, 1.0);
}
