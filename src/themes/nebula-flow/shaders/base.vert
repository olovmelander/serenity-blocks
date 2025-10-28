// Base vertex shader for fullscreen quad rendering
// Used by all fluid simulation shader passes

attribute vec2 a_position;
varying vec2 v_texCoord;

void main() {
    // Convert position from [-1, 1] to [0, 1] for texture coordinates
    v_texCoord = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
