// Pressure shader - solves Poisson equation for pressure using Jacobi iteration
// Iteratively refines pressure field to make velocity field incompressible
// Equation: ∇²p = -div(v)

precision highp float;

varying vec2 v_texCoord;

uniform sampler2D u_pressure;     // Current pressure estimate
uniform sampler2D u_divergence;   // Divergence of velocity field
uniform vec2 u_texelSize;

void main() {
    // Sample pressure at neighboring cells (4-way stencil)
    float L = texture2D(u_pressure, v_texCoord - vec2(u_texelSize.x, 0.0)).x;
    float R = texture2D(u_pressure, v_texCoord + vec2(u_texelSize.x, 0.0)).x;
    float T = texture2D(u_pressure, v_texCoord + vec2(0.0, u_texelSize.y)).x;
    float B = texture2D(u_pressure, v_texCoord - vec2(0.0, u_texelSize.y)).x;

    // Sample divergence at current cell
    float divergence = texture2D(u_divergence, v_texCoord).x;

    // Jacobi iteration: p_new = (p_left + p_right + p_top + p_bottom - divergence) / 4
    float pressure = (L + R + T + B - divergence) * 0.25;

    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
}
