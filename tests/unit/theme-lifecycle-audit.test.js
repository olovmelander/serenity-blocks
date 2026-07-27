import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    afterEach,
    describe,
    it,
    expect,
    vi,
} from 'vitest';
import {
    analyzeThemeSource,
    isAuditedThemeSource,
} from '../../scripts/theme-lifecycle-audit.mjs';
import { BaseTheme } from '../../src/themes/base-theme.js';
import AuroraTheme from '../../src/themes/aurora/aurora-theme.js';
import GalaxyTheme from '../../src/themes/galaxy/galaxy-theme.js';
import SupernovaTheme from '../../src/themes/supernova/supernova-theme.js';

const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
);

// Guardrail tests for the theme lifecycle audit heuristics (SB-04).
// The dispose contract: ThemeManager -> cleanup() -> releaseInactiveResources()
// -> stop(), so overrides must chain to super to keep the base safety nets.

describe('theme-lifecycle-audit heuristics', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('executes the lifecycle CLI instead of silently skipping main()', () => {
        const result = spawnSync(
            process.execPath,
            [path.join(repoRoot, 'scripts', 'theme-lifecycle-audit.mjs')],
            {
                cwd: repoRoot,
                encoding: 'utf8',
                timeout: 30_000,
            },
        );

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout).toContain(
            'Theme lifecycle audit passed with no obvious issues.',
        );
    });

    it('passes a theme whose stop() and cleanup() chain to super', () => {
        const src = `
            class GoodTheme extends BaseTheme {
                stop() { this.thing?.dispose(); super.stop(); }
                cleanup() { this.other = null; super.cleanup(); }
            }
        `;
        expect(analyzeThemeSource(src)).toEqual([]);
    });

    it('flags cleanup() that does not call super.cleanup()', () => {
        const src = `
            class T extends BaseTheme {
                cleanup() { this.other = null; }
            }
        `;
        expect(analyzeThemeSource(src)).toContain('cleanup() without super.cleanup()');
    });

    it('flags stop() that does not call super.stop()', () => {
        const src = `
            class T extends BaseTheme {
                stop() { this.thing?.dispose(); }
            }
        `;
        expect(analyzeThemeSource(src)).toContain('stop() without super.stop()');
    });

    it('flags lifecycle returns that can bypass base teardown', () => {
        const src = `
            class T extends BaseTheme {
                stop() {
                    if (!this.renderer) return;
                    super.stop();
                }
                cleanup() {
                    if (this.disabled) return;
                    super.cleanup();
                }
            }
        `;
        const issues = analyzeThemeSource(src);
        expect(issues).toContain('stop() can return before super.stop()');
        expect(issues).toContain('cleanup() can return before super.cleanup()');
    });

    it('allows terminal returns only after base teardown and cleanup idempotence guards', () => {
        const src = `
            class T extends BaseTheme {
                stop() {
                    super.stop();
                    if (!this.renderer) return;
                    this.renderer.dispose();
                }
                cleanup() {
                    if (this.cleanupComplete || this.cleanupInProgress) return;
                    try { this.disposeRuntime(); }
                    finally { super.cleanup(); }
                }
            }
        `;
        expect(analyzeThemeSource(src)).toEqual([]);
    });

    it('flags stop work gated by manager-invalidated activity state', () => {
        const src = `
            class T extends BaseTheme {
                stop() {
                    if (this.isActive) this.disposeRuntime();
                    super.stop();
                }
            }
        `;
        expect(analyzeThemeSource(src)).toContain(
            'stop() teardown gated by activity state',
        );
    });

    it('does NOT flag stop() without a cleanup() override (dispose chain runs stop)', () => {
        const src = `
            class T extends BaseTheme {
                stop() { this.thing?.dispose(); super.stop(); }
            }
        `;
        expect(analyzeThemeSource(src)).toEqual([]);
    });

    it('flags a legacy dispose() with no reachable lifecycle adapter', () => {
        const src = `
            class T extends BaseTheme {
                dispose() { this.renderer?.dispose(); }
            }
        `;
        expect(analyzeThemeSource(src)).toContain(
            'dispose() without stop()/cleanup() adapter',
        );
    });

    it('accepts a legacy dispose() reached through cleanup()', () => {
        const src = `
            class T extends BaseTheme {
                dispose() { this.renderer?.dispose(); }
                cleanup() {
                    try { this.dispose(); }
                    finally { super.cleanup(); }
                }
            }
        `;
        expect(analyzeThemeSource(src)).toEqual([]);
    });

    it('flags an active super.dispose() call because BaseTheme has no such method', () => {
        const src = `
            class T extends BaseTheme {
                dispose() { super.dispose(); }
                cleanup() { super.cleanup(); }
            }
        `;
        expect(analyzeThemeSource(src)).toContain(
            'super.dispose() call (BaseTheme has no dispose())',
        );
    });

    it('does not treat comments or strings as lifecycle code', () => {
        const src = `
            class T extends BaseTheme {
                dispose() {
                    // super.dispose();
                    const documentation = "cleanup() { super.cleanup(); }";
                }
                /* stop() { super.stop(); } */
            }
        `;
        expect(analyzeThemeSource(src)).toEqual([
            'dispose() without stop()/cleanup() adapter',
        ]);
    });

    it('does not let helper classes satisfy or violate the theme contract', () => {
        const src = `
            class Helper extends HelperBase {
                cleanup() {}
                dispose() { super.dispose(); }
                listen() {
                    window.addEventListener(
                        'resize',
                        this.resize.bind(this),
                    );
                }
            }

            class T extends BaseTheme {
                dispose() {}
            }
        `;
        expect(analyzeThemeSource(src)).toEqual([
            'dispose() without stop()/cleanup() adapter',
        ]);
    });

    it('checks each BaseTheme subclass independently', () => {
        const src = `
            class GoodTheme extends BaseTheme {
                cleanup() { super.cleanup(); }
            }
            class BrokenTheme extends BaseTheme {
                cleanup() {}
            }
        `;
        expect(analyzeThemeSource(src)).toContain(
            'cleanup() without super.cleanup()',
        );
    });

    it('parses TypeScript theme implementations', () => {
        const src = `
            abstract class TornadoTheme extends BaseTheme {
                protected dispose(): void {}
            }
        `;
        expect(analyzeThemeSource(src, 'TornadoTheme.ts')).toContain(
            'dispose() without stop()/cleanup() adapter',
        );
    });

    it('discovers both JavaScript and TypeScript files under themes', () => {
        expect(isAuditedThemeSource('aurora-theme.js')).toBe(true);
        expect(isAuditedThemeSource('TornadoTheme.ts')).toBe(true);
        expect(isAuditedThemeSource('theme-data.json')).toBe(false);
    });

    it.each([
        ['aurora', AuroraTheme],
        ['galaxy', GalaxyTheme],
        ['supernova', SupernovaTheme],
    ])('%s cleanup always chains BaseTheme once', (_name, ThemeClass) => {
        const failure = new Error('custom disposal failed');
        const calls = [];
        const baseCleanup = vi
            .spyOn(BaseTheme.prototype, 'cleanup')
            .mockImplementation(function cleanup() {
                calls.push('base');
                this.cleanupComplete = true;
            });
        const instance = Object.create(ThemeClass.prototype);
        instance.cleanupComplete = false;
        instance.dispose = vi.fn(() => {
            calls.push('custom');
            throw failure;
        });

        expect(() => instance.cleanup()).toThrow(failure);
        expect(calls).toEqual(['custom', 'base']);
        expect(baseCleanup).toHaveBeenCalledTimes(1);
    });

    it('flags inline bind(this) listener registration', () => {
        const src = `
            class T extends BaseTheme {
                init() { window.addEventListener('resize', this.onResize.bind(this)); }
                stop() { window.removeEventListener('resize', this.onResize.bind(this)); super.stop(); }
            }
        `;
        const issues = analyzeThemeSource(src);
        expect(issues).toContain('window.addEventListener with bind(this)');
        expect(issues).toContain('window.removeEventListener with bind(this)');
    });

    it('flags a raw resize listener with no removal path', () => {
        const src = `
            class T extends BaseTheme {
                init() { window.addEventListener('resize', () => this.onResize()); }
            }
        `;
        expect(analyzeThemeSource(src)).toContain('window resize listener without a removal path');
    });

    it('flags asynchronous teardown methods that the manager cannot await', () => {
        const src = `
            class T extends BaseTheme {
                async stop() { super.stop(); }
                cleanup = async () => { super.cleanup(); };
            }
        `;
        const issues = analyzeThemeSource(src);
        expect(issues).toContain(
            'async stop() is unsupported by synchronous teardown',
        );
        expect(issues).toContain(
            'async cleanup() is unsupported by synchronous teardown',
        );
    });

    it('flags an animation loop that discards its RAF handle', () => {
        const src = `
            class T extends BaseTheme {
                startAnimation() {
                    const loop = () => requestAnimationFrame(loop);
                    requestAnimationFrame(loop);
                }
            }
        `;
        expect(analyzeThemeSource(src)).toContain(
            'animation loop requestAnimationFrame without a tracked handle',
        );
    });

    it('accepts animation loops stored or registered for base teardown', () => {
        const stored = `
            class T extends BaseTheme {
                animate() {
                    this.animationFrameId = requestAnimationFrame(
                        () => this.animate(),
                    );
                }
            }
        `;
        const registered = `
            class T extends BaseTheme {
                startAnimation() {
                    const id = requestAnimationFrame(() => this.startAnimation());
                    this.registerAnimation(id);
                }
            }
        `;
        expect(analyzeThemeSource(stored)).toEqual([]);
        expect(analyzeThemeSource(registered)).toEqual([]);
    });

    it('flags renderer initialization that can outlive its theme', () => {
        const src = `
            class T extends BaseTheme {
                async createScene() {
                    const renderer = new THREE.WebGPURenderer();
                    await renderer.init();
                    this.renderer = renderer;
                }
            }
        `;
        expect(analyzeThemeSource(src)).toContain(
            'renderer init without lifecycle-owned late retirement',
        );
    });

    it('accepts lifecycle-owned and explicitly late-retired renderer init', () => {
        const owned = `
            class T extends BaseTheme {
                async createScene() {
                    const renderer = new THREE.WebGPURenderer();
                    await this.initializeRendererCandidate(renderer);
                    this.renderer = renderer;
                }
            }
        `;
        const explicit = `
            class T extends BaseTheme {
                async createScene() {
                    const renderer = new THREE.WebGPURenderer();
                    const initPromise = Promise.resolve().then(() => renderer.init());
                    try { await initPromise; }
                    catch (error) {
                        initPromise.then(() => renderer.dispose(), () => {});
                        throw error;
                    }
                }
            }
        `;
        expect(analyzeThemeSource(owned)).toEqual([]);
        expect(analyzeThemeSource(explicit)).toEqual([]);
    });

    it('accepts a resize listener paired with removeEventListener', () => {
        const src = `
            class T extends BaseTheme {
                init() { window.addEventListener('resize', this.handleResize); }
                stop() { window.removeEventListener('resize', this.handleResize); super.stop(); }
            }
        `;
        expect(analyzeThemeSource(src)).toEqual([]);
    });

    it('accepts a resize listener tracked via eventUnsubscribers closure removal', () => {
        const src = `
            class T extends BaseTheme {
                init() {
                    const onResize = () => this.onResize();
                    window.addEventListener('resize', onResize);
                    this.eventUnsubscribers.push(() => window.removeEventListener('resize', onResize));
                }
            }
        `;
        expect(analyzeThemeSource(src)).toEqual([]);
    });

    it('accepts a resize listener registered through registerEventListener', () => {
        const src = `
            class T extends BaseTheme {
                init() { this.registerEventListener(window, 'resize', this.onResize); }
            }
        `;
        expect(analyzeThemeSource(src)).toEqual([]);
    });

    it('ignores the BaseTheme class itself', () => {
        const src = `
            class BaseTheme {
                stop() { /* no super */ }
                cleanup() { /* no super */ }
            }
        `;
        expect(analyzeThemeSource(src)).toEqual([]);
    });
});
