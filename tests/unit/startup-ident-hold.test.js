import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    resetStartupIdentHoldForTests,
    identHoldIsStatic,
    onIdentHoldWarmPhase,
    probeWebGPUAdapter,
    setIdentArming,
    setIdentHoldPaused,
} from '../../src/ui/startup-ident-hold.js';

// Studio-ident hold style while the first theme warms (src/ui/startup-ident-hold.js, ADR-0020):
//   - identHoldIsStatic: the static hold unless BOTH WebGPU exists and the theme manager says
//     the async loading surface is usable (strictly `true`);
//   - setIdentHoldPaused: toggles .sb-lit--paused on #startup-shell, cosmetic and never throws;
//   - onIdentHoldWarmPhase: ThemeManager.prewarmTheme's onPhase hook ('start' / 'started' /
//     'settled' / 'end') pauses the loops for a synchronous-renderer warm — from 'start' for a
//     theme not yet known (per device, localStorage) to build async or on the shared renderer.

const PAUSED_CLASS = 'sb-lit--paused';

function createShell(initial = []) {
    const classes = new Set(initial);
    return {
        id: 'startup-shell',
        classes,
        classList: {
            toggle: vi.fn((name, force) => {
                const on = force === undefined ? !classes.has(name) : Boolean(force);
                if (on) classes.add(name);
                else classes.delete(name);
                return on;
            }),
            contains: (name) => classes.has(name),
        },
    };
}

function installShellDocument(shell, { throws = false } = {}) {
    const document = {
        getElementById: vi.fn((id) => {
            if (throws) throw new Error('getElementById exploded');
            return id === 'startup-shell' ? shell : null;
        }),
    };
    vi.stubGlobal('document', document);
    return document;
}

afterEach(() => {
    vi.unstubAllGlobals();
    resetStartupIdentHoldForTests();
});

function installStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    const storage = {
        getItem: vi.fn((key) => (store.has(key) ? store.get(key) : null)),
        setItem: vi.fn((key, value) => { store.set(key, String(value)); }),
        store,
    };
    vi.stubGlobal('localStorage', storage);
    return storage;
}

const KIND_KEY = 'serenity.identHoldThemeKinds';

describe('identHoldIsStatic', () => {
    const asyncManager = () => ({ canUseAsyncLoadingSurface: vi.fn(() => true) });

    it.each([
        ['there is no navigator', undefined],
        ['navigator has no gpu', {}],
        ['navigator.gpu is null', { gpu: null }],
    ])('is static when %s, even with a ready async loading surface', (_label, navigatorValue) => {
        vi.stubGlobal('navigator', navigatorValue);
        expect(identHoldIsStatic(asyncManager())).toBe(true);
    });

    it.each([
        ['the theme manager is null', null],
        ['the theme manager is undefined', undefined],
        ['canUseAsyncLoadingSurface is missing', {}],
        ['canUseAsyncLoadingSurface is null', { canUseAsyncLoadingSurface: null }],
        ['it returns false', { canUseAsyncLoadingSurface: () => false }],
        ['it returns undefined', { canUseAsyncLoadingSurface: () => undefined }],
        ['it returns a truthy non-boolean (1)', { canUseAsyncLoadingSurface: () => 1 }],
        ['it returns a truthy non-boolean ("true")', { canUseAsyncLoadingSurface: () => 'true' }],
        ['it returns a promise', { canUseAsyncLoadingSurface: () => Promise.resolve(true) }],
    ])('is static with WebGPU when %s', (_label, themeManager) => {
        vi.stubGlobal('navigator', { gpu: {} });
        expect(identHoldIsStatic(themeManager)).toBe(true);
    });

    it('is moving (not static) only with WebGPU AND canUseAsyncLoadingSurface() === true', () => {
        vi.stubGlobal('navigator', { gpu: {} });
        const themeManager = asyncManager();
        expect(identHoldIsStatic(themeManager)).toBe(false);
        expect(themeManager.canUseAsyncLoadingSurface).toHaveBeenCalledTimes(1);
    });

    it('calls canUseAsyncLoadingSurface as a method of the theme manager', () => {
        vi.stubGlobal('navigator', { gpu: {} });
        // ThemeManager.canUseAsyncLoadingSurface reads this.isAsyncWarmEnabled().
        const themeManager = {
            asyncWarm: true,
            isAsyncWarmEnabled() { return this.asyncWarm; },
            canUseAsyncLoadingSurface() { return this.isAsyncWarmEnabled(); },
        };
        expect(identHoldIsStatic(themeManager)).toBe(false);
        themeManager.asyncWarm = false;
        expect(identHoldIsStatic(themeManager)).toBe(true);
    });

    it('re-evaluates on every call (no cached decision)', () => {
        vi.stubGlobal('navigator', { gpu: {} });
        let ready = false;
        const themeManager = { canUseAsyncLoadingSurface: () => ready };
        expect(identHoldIsStatic(themeManager)).toBe(true);
        ready = true;
        expect(identHoldIsStatic(themeManager)).toBe(false);
        vi.stubGlobal('navigator', {});
        expect(identHoldIsStatic(themeManager)).toBe(true);
    });
});

describe('setIdentHoldPaused', () => {
    it('adds sb-lit--paused to #startup-shell on true and removes it on false', () => {
        const shell = createShell(['sb-lit']);
        const document = installShellDocument(shell);

        setIdentHoldPaused(true);
        expect(document.getElementById).toHaveBeenCalledWith('startup-shell');
        expect(shell.classList.toggle).toHaveBeenLastCalledWith(PAUSED_CLASS, true);
        expect(shell.classList.contains(PAUSED_CLASS)).toBe(true);

        // Idempotent: a forced toggle never flips an already-paused hold back on.
        setIdentHoldPaused(true);
        expect(shell.classList.contains(PAUSED_CLASS)).toBe(true);

        setIdentHoldPaused(false);
        expect(shell.classList.toggle).toHaveBeenLastCalledWith(PAUSED_CLASS, false);
        expect(shell.classList.contains(PAUSED_CLASS)).toBe(false);
        setIdentHoldPaused(false);
        expect(shell.classList.contains(PAUSED_CLASS)).toBe(false);

        // Only its own class: the hold's other state is untouched.
        expect(shell.classList.contains('sb-lit')).toBe(true);
    });

    it.each([
        ['there is no document', () => vi.stubGlobal('document', undefined)],
        ['the document is null', () => vi.stubGlobal('document', null)],
        ['the document has no getElementById', () => vi.stubGlobal('document', { querySelector: vi.fn() })],
        ['#startup-shell is missing', () => installShellDocument(null)],
        ['getElementById throws', () => installShellDocument(createShell(), { throws: true })],
        ['the shell has no classList', () => installShellDocument({ id: 'startup-shell' })],
        ['classList has no toggle', () => installShellDocument({ id: 'startup-shell', classList: {} })],
        ['classList.toggle throws', () => installShellDocument({
            id: 'startup-shell',
            classList: { toggle: () => { throw new Error('classList exploded'); } },
        })],
    ])('never throws when %s', (_label, installEnvironment) => {
        installEnvironment();
        expect(() => setIdentHoldPaused(true)).not.toThrow();
        expect(() => setIdentHoldPaused(false)).not.toThrow();
    });
});

describe('onIdentHoldWarmPhase', () => {
    it("pauses the hold on 'started' for a synchronous-renderer warm", () => {
        const shell = createShell();
        installShellDocument(shell);

        onIdentHoldWarmPhase('started', { theme: 'forest', asyncActive: false, syncRenderer: true });

        expect(shell.classList.toggle).toHaveBeenCalledTimes(1);
        expect(shell.classList.toggle).toHaveBeenCalledWith(PAUSED_CLASS, true);
        expect(shell.classList.contains(PAUSED_CLASS)).toBe(true);
    });

    it.each([
        ['syncRenderer false (an async WebGPU warm)', { asyncActive: true, syncRenderer: false }],
        ['no syncRenderer field', { asyncActive: true }],
        ['a truthy non-boolean syncRenderer', { syncRenderer: 'yes' }],
        ['no payload', undefined],
    ])("keeps the hold moving on 'started' with %s", (_label, payload) => {
        const shell = createShell();
        installShellDocument(shell);

        onIdentHoldWarmPhase('started', payload);

        expect(shell.classList.toggle).toHaveBeenCalledWith(PAUSED_CLASS, false);
        expect(shell.classList.contains(PAUSED_CLASS)).toBe(false);
    });

    it("'started' without a sync renderer clears a pause left by an earlier warm", () => {
        const shell = createShell([PAUSED_CLASS]);
        installShellDocument(shell);

        onIdentHoldWarmPhase('started', { syncRenderer: false });

        expect(shell.classList.contains(PAUSED_CLASS)).toBe(false);
    });

    it("unpauses on 'end', whatever its payload", () => {
        const shell = createShell();
        installShellDocument(shell);

        onIdentHoldWarmPhase('started', { syncRenderer: true });
        expect(shell.classList.contains(PAUSED_CLASS)).toBe(true);
        onIdentHoldWarmPhase('end', { asyncActive: false, exitReason: 'max-warm', endReason: 'settled' });
        expect(shell.classList.toggle).toHaveBeenLastCalledWith(PAUSED_CLASS, false);
        expect(shell.classList.contains(PAUSED_CLASS)).toBe(false);

        // An 'end' with no 'started' before it (theme.start threw) is still a clean unpause.
        shell.classes.add(PAUSED_CLASS);
        onIdentHoldWarmPhase('end', undefined);
        expect(shell.classList.contains(PAUSED_CLASS)).toBe(false);
    });

    it.each([
        ['settled'],
        ['progress'],
        [''],
        [undefined],
    ])("ignores the '%s' phase, even with syncRenderer: true", (phase) => {
        const paused = createShell([PAUSED_CLASS]);
        installShellDocument(paused);
        onIdentHoldWarmPhase(phase, { syncRenderer: true });
        expect(paused.classList.toggle).not.toHaveBeenCalled();
        expect(paused.classList.contains(PAUSED_CLASS)).toBe(true);

        const moving = createShell();
        installShellDocument(moving);
        onIdentHoldWarmPhase(phase, { syncRenderer: true });
        expect(moving.classList.toggle).not.toHaveBeenCalled();
        expect(moving.classList.contains(PAUSED_CLASS)).toBe(false);
    });

    it('follows a whole sync-renderer warm: start, started, settled, end', () => {
        const shell = createShell();
        installShellDocument(shell);
        const seen = [];
        const phase = (name, payload) => {
            onIdentHoldWarmPhase(name, payload);
            seen.push([name, shell.classList.contains(PAUSED_CLASS)]);
        };

        phase('start', { session: false });
        phase('started', { asyncActive: false, syncRenderer: true });
        phase('settled', { asyncActive: false, exitReason: 'stable' });
        phase('end', { asyncActive: false, exitReason: 'stable', endReason: 'settled' });

        expect(seen).toEqual([
            ['start', true], // an unnamed / unknown theme is paused through its start() just in case
            ['started', true],
            ['settled', true],
            ['end', false],
        ]);
    });

    it('never throws without a document', () => {
        vi.stubGlobal('document', undefined);
        expect(() => onIdentHoldWarmPhase('started', { syncRenderer: true })).not.toThrow();
        expect(() => onIdentHoldWarmPhase('end', {})).not.toThrow();
    });
});

describe("onIdentHoldWarmPhase — 'start' uses what the device learned about the theme", () => {
    it.each([
        ['unknown', undefined, true],
        ['learned sync', 'sync', true],
        ['learned async', 'async', false],
        ['learned shared', 'shared', false],
    ])('%s theme → paused at start: %s', (_label, kind, paused) => {
        installStorage(kind ? { [KIND_KEY]: JSON.stringify({ aurora: kind }) } : {});
        const shell = createShell();
        installShellDocument(shell);
        onIdentHoldWarmPhase('start', { theme: 'aurora', session: true });
        expect(shell.classList.contains(PAUSED_CLASS)).toBe(paused);
    });

    it.each([
        [{ asyncActive: true, syncRenderer: false }, 'async', false],
        [{ asyncActive: false, syncRenderer: true }, 'sync', true],
        [{ asyncActive: false, syncRenderer: false }, 'shared', false],
    ])('started %j is remembered as %s (paused: %s)', (payload, kind, paused) => {
        const storage = installStorage();
        const shell = createShell([PAUSED_CLASS]);
        installShellDocument(shell);
        onIdentHoldWarmPhase('started', { theme: 'neon-district', ...payload });
        expect(JSON.parse(storage.store.get(KIND_KEY))).toEqual({ 'neon-district': kind });
        expect(shell.classList.contains(PAUSED_CLASS)).toBe(paused);
        // The next boot's start() reads it back.
        const next = createShell();
        installShellDocument(next);
        onIdentHoldWarmPhase('start', { theme: 'neon-district' });
        expect(next.classList.contains(PAUSED_CLASS)).toBe(kind === 'sync');
    });

    it('survives broken storage (corrupt JSON, throwing getItem/setItem)', () => {
        installStorage({ [KIND_KEY]: '{not json' });
        const shell = createShell();
        installShellDocument(shell);
        expect(() => onIdentHoldWarmPhase('start', { theme: 'forest' })).not.toThrow();
        expect(shell.classList.contains(PAUSED_CLASS)).toBe(true);
        vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('denied'); },
            setItem: () => { throw new Error('denied'); },
        });
        expect(() => onIdentHoldWarmPhase('started', { theme: 'forest', asyncActive: true })).not.toThrow();
        expect(shell.classList.contains(PAUSED_CLASS)).toBe(false);
    });
});

describe('probeWebGPUAdapter → identHoldIsStatic', () => {
    const asyncManager = () => ({ canUseAsyncLoadingSurface: () => true });

    it('navigator.gpu with no adapter means the static hold', async () => {
        vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn(async () => null) } });
        expect(identHoldIsStatic(asyncManager())).toBe(false); // not probed yet: gpu is enough
        await expect(probeWebGPUAdapter()).resolves.toBe(false);
        expect(identHoldIsStatic(asyncManager())).toBe(true);
    });

    it('a real adapter keeps the moving hold; the probe is memoized', async () => {
        const requestAdapter = vi.fn(async () => ({}));
        vi.stubGlobal('navigator', { gpu: { requestAdapter } });
        await expect(probeWebGPUAdapter()).resolves.toBe(true);
        await expect(probeWebGPUAdapter()).resolves.toBe(true);
        expect(requestAdapter).toHaveBeenCalledTimes(1);
        expect(identHoldIsStatic(asyncManager())).toBe(false);
    });

    it.each([
        ['requestAdapter throws', { gpu: { requestAdapter: () => { throw new Error('blocked'); } } }],
        ['requestAdapter rejects', { gpu: { requestAdapter: async () => { throw new Error('blocked'); } } }],
        ['there is no navigator.gpu', {}],
    ])('never rejects when %s (static)', async (_label, navigatorValue) => {
        vi.stubGlobal('navigator', navigatorValue);
        await expect(probeWebGPUAdapter()).resolves.toBe(false);
        expect(identHoldIsStatic(asyncManager())).toBe(true);
    });
});

describe('setIdentArming', () => {
    function createArmableShell({
        glowOpacity = '0.93',
        glowTransform = 'matrix(1.06, 0, 0, 1.06, 0, 0)',
        logoOpacity = '0.94',
    } = {}) {
        const classes = new Set([PAUSED_CLASS]);
        const animation = () => ({ cancel: vi.fn() });
        const glow = { animate: vi.fn(animation), style: { opacity: glowOpacity, transform: glowTransform } };
        const logo = { animate: vi.fn(animation), style: { opacity: logoOpacity, transform: 'none' } };
        const byClass = { '.startup-logo__glow': glow, '.startup-logo': logo };
        const shell = {
            id: 'startup-shell',
            classes,
            classList: {
                add: vi.fn((name) => { classes.add(name); }),
                remove: vi.fn((name) => { classes.delete(name); }),
                contains: (name) => classes.has(name),
            },
            querySelector: vi.fn((sel) => byClass[sel] ?? null),
        };
        vi.stubGlobal('getComputedStyle', (el) => el.style);
        return { shell, glow, logo };
    }

    it('adds the arming class, lifts the pause, and eases the glow and logo from their live values', () => {
        const { shell, glow, logo } = createArmableShell();
        installShellDocument(shell);
        setIdentArming(true);
        expect(shell.classList.contains('sb-warp-arming')).toBe(true);
        expect(shell.classList.contains(PAUSED_CLASS)).toBe(false);
        expect(glow.animate).toHaveBeenCalledWith(
            [
                { opacity: '0.93', transform: 'matrix(1.06, 0, 0, 1.06, 0, 0)' },
                { opacity: '0.87', transform: 'scale(1.04)' },
            ],
            { duration: 110, easing: 'linear', fill: 'forwards' },
        );
        expect(logo.animate).toHaveBeenCalledWith([{ opacity: '0.94' }, { opacity: '1' }], expect.any(Object));
    });

    it('reads the live values BEFORE the class removes the loops', () => {
        const { shell, glow } = createArmableShell();
        installShellDocument(shell);
        const order = [];
        shell.classList.add.mockImplementation((name) => {
            order.push(`add:${name}`);
            shell.classes.add(name);
        });
        vi.stubGlobal('getComputedStyle', (el) => {
            order.push('read');
            return el.style;
        });
        setIdentArming(true);
        expect(order.indexOf('read')).toBeLessThan(order.indexOf('add:sb-warp-arming'));
        expect(glow.animate).toHaveBeenCalledTimes(1);
    });

    it('skips the logo ease when it is already at full opacity', () => {
        const { shell, logo } = createArmableShell({ logoOpacity: '1' });
        installShellDocument(shell);
        setIdentArming(true);
        expect(logo.animate).not.toHaveBeenCalled();
    });

    it('disarming cancels the eases and removes the class', () => {
        const { shell, glow } = createArmableShell();
        installShellDocument(shell);
        setIdentArming(true);
        const easing = glow.animate.mock.results[0].value;
        setIdentArming(false);
        expect(easing.cancel).toHaveBeenCalledTimes(1);
        expect(shell.classList.contains('sb-warp-arming')).toBe(false);
    });

    it.each([
        ['no document', () => vi.stubGlobal('document', undefined)],
        ['no shell', () => installShellDocument(null)],
        ['no querySelector / getComputedStyle', () => {
            const { shell } = createArmableShell();
            delete shell.querySelector;
            vi.stubGlobal('getComputedStyle', undefined);
            installShellDocument(shell);
        }],
        ['animate throws', () => {
            const { shell, glow } = createArmableShell();
            glow.animate.mockImplementation(() => { throw new Error('no WAAPI'); });
            installShellDocument(shell);
        }],
    ])('never throws with %s', (_label, setup) => {
        setup();
        expect(() => setIdentArming(true)).not.toThrow();
        expect(() => setIdentArming(false)).not.toThrow();
    });
});
