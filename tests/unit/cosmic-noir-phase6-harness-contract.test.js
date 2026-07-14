/**
 * Source-level contracts for the Electron Cosmic Noir performance harness.
 *
 * The harness itself owns Electron's app lifecycle and cannot be imported into
 * Vitest. These checks pin the deterministic profile and artifact schema while
 * the real harness performs the browser/WebGPU validation end to end.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const harnessSource = readFileSync(
    new URL('../../scripts/cosmic-noir-phase6-validation.mjs', import.meta.url),
    'utf8',
);

function sourceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);

    expect(start, `missing source marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
    expect(end, `missing source marker: ${endMarker}`).toBeGreaterThan(start);
    return source.slice(start, end);
}

describe('Cosmic Noir Phase 6 harness contract', () => {
    it('starts and stops the Vite child tree reliably on Windows', () => {
        const serverSource = sourceBetween(
            harnessSource,
            'function startDevServer() {',
            'function createWindow() {',
        );

        expect(serverSource).toContain("process.env.ComSpec || 'cmd.exe'");
        expect(serverSource).toContain('npm.cmd ${npmArgs.join');
        expect(serverSource).toMatch(/windowsHide:\s*true/);
        expect(serverSource).toContain("'taskkill.exe'");
        expect(serverSource).toContain("'/T'");
    });

    it('pins the production-like High profile in every scenario', () => {
        const profileSource = sourceBetween(
            harnessSource,
            'const RUN_PROFILE = Object.freeze({',
            'const CAPTURE_CONFIG = {',
        );

        expect(profileSource).toMatch(/quality:\s*'High'/);
        expect(profileSource).toMatch(/pixelRatio:[\s\S]*?\b1\)/);
        expect(profileSource).toMatch(/renderScale:[\s\S]*?\b0\.92\b/);
        expect(profileSource).toMatch(/targetFps:[\s\S]*?\b60\)/);
        expect(profileSource).toMatch(/antialias:[\s\S]*?\bfalse\)/);
        expect(profileSource).toMatch(/preserveDrawingBuffer:\s*false/);
        expect(profileSource).toMatch(/headed:\s*true/);
        expect(harnessSource).toMatch(/show:\s*RUN_PROFILE\.headed/);
        expect(harnessSource).toContain('win.focus();');
        expect(harnessSource).toContain("name: 'headed_visibility'");
        expect(harnessSource).toContain("partition: 'persist:cosmic-noir-phase6-validation'");

        for (const parameter of [
            "skipIntro: '1'",
            "noThemeWarm: '1'",
            "cosmicNoirBaseline: '1'",
            'cosmicNoirFixedPixelRatio:',
            'cosmicNoirRenderScale:',
            "cosmicNoirNoAdaptiveScale: '1'",
            'cosmicNoirMsaa:',
        ]) {
            expect(profileSource).toContain(parameter);
        }
        expect(profileSource).not.toContain('cosmicNoirPreserveDrawingBuffer');
    });

    it('retains raw samples without discarding the precompile result', () => {
        const captureSource = sourceBetween(
            harnessSource,
            'async function runTimedCapture(',
            'async function collectScenario(',
        );

        expect(captureSource).toContain('const compileBeforeReset');
        expect(captureSource).toContain('theme.resetBaselineCapture();');
        expect(captureSource).toContain('const compileAfterReset');
        expect(captureSource).toContain('preserved: JSON.stringify(compileBeforeReset)');
        expect(captureSource).toContain('samples,');
        expect(captureSource).toMatch(/cpuSamples:\s*\(samples\.cpu/);
        expect(captureSource).toMatch(/gpuSamples:\s*\(samples\.gpu/);
    });

    it('boots through initialized managers without UI-event timing races', () => {
        const bootstrapSource = sourceBetween(
            harnessSource,
            'async function bootstrapCosmicNoirScene(',
            'async function collectRuntimeMetadata(',
        );

        expect(bootstrapSource).toContain('window.serenityBlocks?.isInitialized');
        expect(bootstrapSource).toContain("app.gameModeManager.activateMode('serenity')");
        expect(bootstrapSource).toContain('app.gameModeManager.startCurrentMode()');
        expect(bootstrapSource).toContain('app.modalManager?.hideAll?.()');
        expect(bootstrapSource).not.toContain("new CustomEvent('startGameWithMode'");
    });

    it('gates current frame timing, adapter, and physical target metrics', () => {
        const evaluationSource = sourceBetween(
            harnessSource,
            'function evaluatePhase6(',
            'function buildMarkdownSummary(',
        );

        expect(evaluationSource).toContain("'compute_path_combat_frame_time'");
        expect(evaluationSource).toContain("'raw_capture_sample_integrity'");
        expect(evaluationSource).toContain("'webgpu_target_dimensions'");
        expect(evaluationSource).toContain("'webgpu_timestamp_samples'");
        expect(evaluationSource).toContain("'gpu_adapter_identified'");
        expect(evaluationSource).toMatch(
            /entry\.shaderFailureCount\s*===\s*0\s*&&\s*entry\.errorCount\s*===\s*0/,
        );
        expect(evaluationSource).not.toContain('draw_call_reduction');
        expect(evaluationSource).not.toContain('drawCallReductionTarget');
    });
});
