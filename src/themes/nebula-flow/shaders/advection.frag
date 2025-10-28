// Advection shader - moves a field (velocity or dye) along the velocity field
// Uses semi-Lagrangian advection: trace particle backwards in time

precision highp float;

varying vec2 v_texCoord;

uniform sampler2D u_velocity;    // Current velocity field
uniform sampler2D u_source;      // Field to advect (velocity or dye)
uniform vec2 u_texelSize;        // 1.0 / resolution
uniform float u_dt;              // Time step (delta time)
uniform float u_dissipation;     // Dissipation factor (0.95-0.99)

void main() {
    // Semi-Lagrangian advection:
    // 1. Find where the particle came from by tracing backwards along velocity
    vec2 coord = v_texCoord - u_dt * texture2D(u_velocity, v_texCoord).xy * u_texelSize;

    // 2. Sample the source field at that position (with bilinear interpolation)
    vec4 result = texture2D(u_source, coord);

    // 3. Apply dissipation (energy loss over time)
    gl_FragColor = u_dissipation * result;
}
