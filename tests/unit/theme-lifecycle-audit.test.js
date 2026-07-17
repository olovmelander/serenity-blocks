import { describe, it, expect } from 'vitest';
import { analyzeThemeSource } from '../../scripts/theme-lifecycle-audit.mjs';

// Guardrail tests for the theme lifecycle audit heuristics (SB-04).
// The dispose contract: ThemeManager -> cleanup() -> releaseInactiveResources()
// -> stop(), so overrides must chain to super to keep the base safety nets.

describe('theme-lifecycle-audit heuristics', () => {
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

    it('does NOT flag stop() without a cleanup() override (dispose chain runs stop)', () => {
        const src = `
            class T extends BaseTheme {
                stop() { this.thing?.dispose(); super.stop(); }
            }
        `;
        expect(analyzeThemeSource(src)).toEqual([]);
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
