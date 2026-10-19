/**
 * A window in which the shared Phaser game links new shader programs in parallel instead of
 * waiting on each one.
 *
 * WHY (2026-10-19): Phaser compiles a program the first time something draws with it and then
 * reads LINK_STATUS at once, which waits for the link. The first Odyssey orb of a session drew
 * the board for the first time behind the entry tunnel and waited 72 ms in getProgramParameter
 * (profiled at Extreme on the dev laptop): the tunnel stopped for those frames. Phaser 4 has the
 * remedy built in, `render.skipUnreadyShaders`: with KHR_parallel_shader_compile the link runs
 * in parallel and an object whose program is not ready skips its draw. Globally that can make an
 * object pop in a frame late, so it is opened only while the board is covered (the tunnel's
 * blackout) and closed before the reveal. Programs begun inside it keep being polled to
 * completion after it closes (ProgramManager.getCurrentProgramSuite); programs begun outside it
 * link synchronously, as before.
 *
 * The extension is fetched here because Phaser only fetches it at boot when the option was on.
 * @param {any} game the Phaser game
 * @returns {() => void} closes the window (idempotent); a no-op when unsupported or already on
 */
export function openParallelShaderWindow(game) {
    const config = game?.config;
    const renderer = game?.renderer;
    const gl = renderer?.gl;
    if (!config || !gl || config.skipUnreadyShaders === true) return () => {};
    if (!renderer.parallelShaderCompileExtension) {
        let ext = null;
        try {
            const supported = gl.getSupportedExtensions?.() || [];
            ext = supported.includes('KHR_parallel_shader_compile')
                ? gl.getExtension('KHR_parallel_shader_compile')
                : null;
        } catch {
            ext = null;
        }
        if (!ext) return () => {};
        renderer.parallelShaderCompileExtension = ext;
    }
    config.skipUnreadyShaders = true;
    let open = true;
    return () => {
        if (!open) return;
        open = false;
        config.skipUnreadyShaders = false;
    };
}
