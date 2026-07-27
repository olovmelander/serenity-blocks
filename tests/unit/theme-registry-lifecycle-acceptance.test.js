import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { BaseTheme } from '../../src/themes/base-theme.js';
import { ThemeManager } from '../../src/themes/theme-manager.js';
import { THEME_REGISTRY } from '../../src/themes/theme-registry.js';

// vitest.config.js intentionally does not inherit Vite's production aliases.
// Supply the one alias used by lazy theme chunks so this test exercises those
// real chunks rather than failing in the test runner's resolver.
vi.mock('@utils/helpers.js', async () => import('../../src/utils/helpers.js'));

function createElementStub() {
    return {
        appendChild: vi.fn(),
        classList: {
            add: vi.fn(),
            contains: vi.fn(() => false),
            remove: vi.fn(),
            toggle: vi.fn(),
        },
        contains: vi.fn(() => false),
        dataset: {},
        getContext: vi.fn(() => null),
        remove: vi.fn(),
        removeChild: vi.fn(),
        setAttribute: vi.fn(),
        style: {
            removeProperty: vi.fn(),
        },
    };
}

function installImportOnlyBrowserGlobals() {
    const body = createElementStub();
    body.firstChild = null;
    body.insertBefore = vi.fn();

    vi.stubGlobal('window', {
        addEventListener: vi.fn(),
        devicePixelRatio: 1,
        innerHeight: 720,
        innerWidth: 1280,
        location: {
            hostname: 'localhost',
            protocol: 'http:',
            search: '',
        },
        matchMedia: vi.fn(() => ({
            addEventListener: vi.fn(),
            matches: false,
            removeEventListener: vi.fn(),
        })),
        removeEventListener: vi.fn(),
        settings: {},
    });
    vi.stubGlobal('document', {
        body,
        createDocumentFragment: vi.fn(createElementStub),
        createElement: vi.fn(createElementStub),
        getElementById: vi.fn(() => null),
        querySelector: vi.fn(() => null),
        querySelectorAll: vi.fn(() => []),
    });
    vi.stubGlobal('navigator', {
        gpu: null,
        userAgent: 'vitest',
    });
}

function createLifecycleHarness(ThemeClass, lifecycle) {
    return class LifecycleHarnessTheme extends ThemeClass {
        constructor() {
            super();
            lifecycle.construct += 1;
            this.isActive = false;
            this.lifecycleState = 'initialized';
        }

        async init() {
            lifecycle.init += 1;
        }

        async start() {
            lifecycle.start += 1;
            this.isActive = true;
            this.lifecycleState = 'running';
            return true;
        }

        cleanup() {
            lifecycle.cleanup += 1;
            this.isActive = false;
            this.lifecycleState = 'stopped';
        }
    };
}

describe('all-theme registry/import/lifecycle acceptance', () => {
    beforeEach(() => {
        installImportOnlyBrowserGlobals();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('imports and identifies every registered theme, then cleanly switches each harness once', async () => {
        const renderer = {
            cleanup: vi.fn(),
            clearThemeResources: vi.fn(),
        };
        const manager = new ThemeManager(renderer, {
            assetManager: {},
            audioManager: null,
        });
        const registeredIds = THEME_REGISTRY.map(({ id }) => id);
        const registeredModules = THEME_REGISTRY.map(({ module }) => module);

        expect(new Set(registeredIds).size).toBe(THEME_REGISTRY.length);
        expect(new Set(registeredModules).size).toBe(THEME_REGISTRY.length);
        expect([...manager.themeRegistry.keys()]).toEqual(registeredIds);

        const importFailures = [];
        const themeClasses = new Map();
        for (const entry of THEME_REGISTRY) {
            const importer = manager.themeRegistry.get(entry.id);
            if (typeof importer !== 'function') {
                importFailures.push(`${entry.id}: registry importer is missing`);
                continue;
            }

            try {
                // Importing evaluates the real lazy chunk and its complete static
                // dependency graph, but deliberately does not call init()/start().
                // eslint-disable-next-line no-await-in-loop
                const module = await importer();
                const ThemeClass = module?.default;
                if (typeof ThemeClass !== 'function') {
                    importFailures.push(`${entry.id}: module has no default class`);
                    continue;
                }
                themeClasses.set(entry.id, ThemeClass);

                if (!(ThemeClass.prototype instanceof BaseTheme)) {
                    importFailures.push(`${entry.id}: default export is not a BaseTheme`);
                }
            } catch (error) {
                importFailures.push(`${entry.id}: ${error?.message || String(error)}`);
            }
        }
        expect(importFailures, importFailures.join('\n')).toEqual([]);

        // Exercise the real ThemeManager transaction against deterministic
        // lifecycle doubles. The real modules were accepted above; replacing
        // only their classes here prevents 63 GPU scenes from being initialized.
        const lifecycleByTheme = new Map();
        manager.themeRegistry = new Map(THEME_REGISTRY.map(({ id }) => {
            const lifecycle = {
                cleanup: 0,
                construct: 0,
                init: 0,
                start: 0,
            };
            lifecycleByTheme.set(id, lifecycle);
            return [
                id,
                async () => ({
                    default: createLifecycleHarness(
                        themeClasses.get(id),
                        lifecycle,
                    ),
                }),
            ];
        }));
        manager.queueAdjacentThemePreload = vi.fn();
        manager.themesSuspended = false;

        for (const [index, themeName] of registeredIds.entries()) {
            // eslint-disable-next-line no-await-in-loop
            const activeName = await manager.switchTheme(themeName);
            expect(activeName).toBe(themeName);
            expect(manager.activeThemeName).toBe(themeName);
            expect(manager.activeTheme?.name).toBe(themeName);
            expect(manager.pendingThemeInstance).toBeNull();
            expect(manager.pendingThemeName).toBeNull();
            expect(manager.themeInstances.size).toBe(1);

            const previousThemeName = registeredIds[index - 1];
            if (previousThemeName) {
                expect(lifecycleByTheme.get(previousThemeName).cleanup).toBe(1);
            }
        }

        manager.cleanup();
        manager.cleanup();

        for (const lifecycle of lifecycleByTheme.values()) {
            expect(lifecycle).toEqual({
                cleanup: 1,
                construct: 1,
                init: 1,
                start: 1,
            });
        }
        expect(renderer.clearThemeResources).toHaveBeenCalledTimes(
            THEME_REGISTRY.length,
        );
        expect(renderer.cleanup).toHaveBeenCalledTimes(1);
        expect(manager.activeTheme).toBeNull();
        expect(manager.activeThemeName).toBeNull();
        expect(manager.pendingThemeInstance).toBeNull();
        expect(manager.themeInstances.size).toBe(0);
    }, 120_000);

    it('rejects and disposes a mismatched candidate instead of caching a disguised fallback', async () => {
        let candidate;
        const forestImporter = vi.fn();
        function WrongTheme() {
            candidate = this;
            this.name = 'forest';
            this.cleanup = vi.fn();
        }
        WrongTheme.prototype.init = async function init() {
            return undefined;
        };

        const manager = new ThemeManager(
            { clearThemeResources: vi.fn() },
            { assetManager: {} },
        );
        manager.themeRegistry = new Map([
            ['ocean', async () => ({ default: WrongTheme })],
            ['forest', forestImporter],
        ]);

        await expect(manager.loadTheme('ocean', true)).rejects.toThrow(
            'Theme identity mismatch: requested "ocean", loaded "forest"',
        );
        expect(candidate.cleanup).toHaveBeenCalledTimes(1);
        expect(manager.themeInstances.has('ocean')).toBe(false);
        expect(forestImporter).not.toHaveBeenCalled();
    });
});
