/**
 * The photosensitivity warning: the first screen of every launch (ADR-0021,
 * src/ui/photosensitivity-warning.js and the markup in index.html).
 *
 *   - it is the first element of <body>, before the loading screen, still, white on black;
 *   - it owns every key and pointer event while it is up (none reaches the opening behind it);
 *   - a press before the minimum is honoured at the minimum, never before; a press after it
 *     continues at once; a pad button, a click or a tap count as a press;
 *   - it continues by itself after the auto-continue time, hidden time not counting;
 *   - function keys and Ctrl/Alt/Meta shortcuts pass through; a modifier alone waits;
 *   - `?photosensitivityWarning=0`, the saved flag and `?skipIntro=1` skip it.
 */
import { readFileSync } from 'node:fs';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    PHOTOSENSITIVITY_WARNING_AUTO_CONTINUE_MS,
    PHOTOSENSITIVITY_WARNING_BODY_CLASS,
    PHOTOSENSITIVITY_WARNING_FADE_MS,
    PHOTOSENSITIVITY_WARNING_ID,
    PHOTOSENSITIVITY_WARNING_MIN_VISIBLE_MS,
    createPhotosensitivityWarning,
    installPhotosensitivityWarning,
    isPhotosensitivityWarningEnabled,
} from '../../src/ui/photosensitivity-warning.js';

const MIN = PHOTOSENSITIVITY_WARNING_MIN_VISIBLE_MS;
const AUTO = PHOTOSENSITIVITY_WARNING_AUTO_CONTINUE_MS;
const FADE = PHOTOSENSITIVITY_WARNING_FADE_MS;

function classList() {
    const set = new Set();
    return {
        set,
        add: (name) => set.add(name),
        remove: (name) => set.delete(name),
        contains: (name) => set.has(name),
        toggle(name, force) {
            const on = force === undefined ? !set.has(name) : Boolean(force);
            if (on) set.add(name);
            else set.delete(name);
            return on;
        },
    };
}

function fakeElement() {
    return {
        classList: classList(),
        dataset: {},
        attributes: {},
        removed: false,
        focus: vi.fn(),
        setAttribute(name, value) { this.attributes[name] = value; },
        remove() { this.removed = true; },
    };
}

function fakeDocument(element = null) {
    const doc = new EventTarget();
    Object.assign(doc, {
        body: { classList: classList() },
        visibilityState: 'visible',
        hidden: false,
        getElementById: (id) => (id === PHOTOSENSITIVITY_WARNING_ID ? element : null),
    });
    return doc;
}

function fakeWindow({ search = '', storage = {}, gamepads = [] } = {}) {
    const win = new EventTarget();
    Object.assign(win, {
        location: { search },
        localStorage: { getItem: (key) => (key in storage ? storage[key] : null) },
        navigator: { getGamepads: () => gamepads },
        matchMedia: () => ({ matches: false }),
    });
    return win;
}

function event(type, props = {}) {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, props);
    vi.spyOn(e, 'stopImmediatePropagation');
    return e;
}

function mount({ gamepads, options } = {}) {
    const win = fakeWindow({ gamepads });
    const doc = fakeDocument();
    const element = fakeElement();
    const reports = [];
    const warning = createPhotosensitivityWarning({
        window: win,
        document: doc,
        element,
        now: () => Date.now(),
        reduceMotion: false,
        reportPhase: (phase, payload) => reports.push({ phase, ...payload }),
        ...options,
    });
    return {
        win, doc, element, reports, warning,
    };
}

describe('isPhotosensitivityWarningEnabled', () => {
    it('shows by default', () => {
        expect(isPhotosensitivityWarningEnabled()).toBe(true);
        expect(isPhotosensitivityWarningEnabled({ search: '?theme=forest' })).toBe(true);
    });

    it('?photosensitivityWarning=0 skips it and =1 forces it, over everything else', () => {
        expect(isPhotosensitivityWarningEnabled({ search: '?photosensitivityWarning=0' })).toBe(false);
        expect(isPhotosensitivityWarningEnabled({ search: '?skipIntro=1&photosensitivityWarning=1' })).toBe(true);
        expect(isPhotosensitivityWarningEnabled({
            search: '?photosensitivityWarning=1',
            storage: { getItem: () => '0' },
        })).toBe(true);
    });

    it('skipIntro=1 (a harness boot) skips it', () => {
        expect(isPhotosensitivityWarningEnabled({ search: '?skipIntro=1' })).toBe(false);
        expect(isPhotosensitivityWarningEnabled({ search: '?skipIntro=0' })).toBe(true);
    });

    it('the saved flag is the developer\'s toggle in an installed game', () => {
        const storage = (value) => ({ getItem: (key) => (key === 'serenity.photosensitivityWarning' ? value : null) });
        expect(isPhotosensitivityWarningEnabled({ storage: storage('0') })).toBe(false);
        expect(isPhotosensitivityWarningEnabled({ storage: storage('1') })).toBe(true);
        expect(isPhotosensitivityWarningEnabled({ storage: { getItem: () => { throw new Error('blocked'); } } })).toBe(true);
    });
});

describe('the warning on screen', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-20T08:00:00Z'));
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('covers the page from the start: the body class, focus for the screen reader, a trace', () => {
        const {
            doc, element, reports, warning,
        } = mount();
        expect(doc.body.classList.contains(PHOTOSENSITIVITY_WARNING_BODY_CLASS)).toBe(true);
        expect(element.focus).toHaveBeenCalled();
        expect(element.dataset.state).toBe('shown');
        expect(warning.isActive()).toBe(true);
        expect(warning.isCovering()).toBe(true);
        expect(reports[0]).toMatchObject({ phase: 'photosensitivity-warning:shown', minVisibleMs: MIN, autoContinueMs: AUTO });
    });

    it('a press before the minimum is swallowed, remembered, and honoured at the minimum', async () => {
        const { win, element, warning } = mount();
        vi.advanceTimersByTime(500);
        const early = event('keydown', { key: 'a' });
        win.dispatchEvent(early);
        expect(early.stopImmediatePropagation).toHaveBeenCalled();
        expect(early.defaultPrevented).toBe(true);
        expect(warning.isActive()).toBe(true);
        expect(warning.snapshot().pendingPress).toBe('key');

        vi.advanceTimersByTime(MIN - 500 - 1);
        expect(warning.isActive()).toBe(true);
        vi.advanceTimersByTime(1);
        expect(warning.isActive()).toBe(false);
        expect(element.classList.contains('is-leaving')).toBe(true);
        await expect(warning.dismissed).resolves.toMatchObject({ reason: 'input', via: 'key', visibleMs: MIN });
    });

    it('once ready the prompt shows and a press continues at once', () => {
        const { win, element, reports, warning } = mount();
        vi.advanceTimersByTime(MIN);
        expect(element.classList.contains('is-ready')).toBe(true);
        expect(element.dataset.state).toBe('ready');
        expect(reports.some((r) => r.phase === 'photosensitivity-warning:ready')).toBe(true);
        expect(warning.isActive()).toBe(true);

        vi.advanceTimersByTime(700);
        win.dispatchEvent(event('pointerdown', { button: 0 }));
        expect(warning.isActive()).toBe(false);
        expect(warning.snapshot().result).toMatchObject({ reason: 'input', via: 'pointer', visibleMs: MIN + 700 });
    });

    it('a screen reader\'s click on Continue is a press too', () => {
        const { win, warning } = mount();
        vi.advanceTimersByTime(MIN + 1);
        win.dispatchEvent(event('click'));
        expect(warning.snapshot().result).toMatchObject({ reason: 'input', via: 'pointer' });
    });

    it('continues by itself after the auto-continue time', () => {
        const { warning } = mount();
        vi.advanceTimersByTime(AUTO - 1);
        expect(warning.isActive()).toBe(true);
        vi.advanceTimersByTime(1);
        expect(warning.isActive()).toBe(false);
        expect(warning.snapshot().result).toMatchObject({ reason: 'auto', via: null, visibleMs: AUTO });
    });

    it('time while the window is hidden does not count toward the auto-continue', () => {
        const { doc, warning } = mount();
        vi.advanceTimersByTime(1000);
        doc.visibilityState = 'hidden';
        doc.hidden = true;
        doc.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(60000);
        expect(warning.isActive()).toBe(true);

        doc.visibilityState = 'visible';
        doc.hidden = false;
        doc.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(AUTO - 1000 - 1);
        expect(warning.isActive()).toBe(true);
        vi.advanceTimersByTime(1);
        expect(warning.snapshot().result?.reason).toBe('auto');
    });

    it('a pad button pressed after launch continues; one held at launch does not', () => {
        const pad = { index: 0, buttons: [{ pressed: true, value: 1 }, { pressed: false, value: 0 }] };
        const { warning } = mount({ gamepads: [pad, null] });
        vi.advanceTimersByTime(MIN + 400);
        expect(warning.isActive()).toBe(true);

        pad.buttons[1].pressed = true;
        vi.advanceTimersByTime(100);
        expect(warning.isActive()).toBe(false);
        expect(warning.snapshot().result).toMatchObject({ reason: 'input', via: 'gamepad' });
    });

    it('function keys and Ctrl/Alt/Meta shortcuts pass through; a modifier alone is swallowed and waits', () => {
        const { win, warning } = mount();
        vi.advanceTimersByTime(MIN + 1);

        const f5 = event('keydown', { key: 'F5' });
        const reload = event('keydown', { key: 'r', ctrlKey: true });
        const alt = event('keydown', { key: 'Enter', altKey: true });
        [f5, reload, alt].forEach((e) => win.dispatchEvent(e));
        expect(f5.stopImmediatePropagation).not.toHaveBeenCalled();
        expect(reload.stopImmediatePropagation).not.toHaveBeenCalled();
        expect(alt.stopImmediatePropagation).not.toHaveBeenCalled();
        expect(warning.isActive()).toBe(true);

        const shift = event('keydown', { key: 'Shift' });
        win.dispatchEvent(shift);
        expect(shift.stopImmediatePropagation).toHaveBeenCalled();
        expect(warning.isActive()).toBe(true);
        expect(warning.snapshot().pendingPress).toBe(null);

        const held = event('keydown', { key: 'a', repeat: true });
        win.dispatchEvent(held);
        expect(warning.isActive()).toBe(true);
    });

    it('leaves by a short fade, then owns nothing', async () => {
        const {
            win, doc, element, reports, warning,
        } = mount();
        vi.advanceTimersByTime(MIN + 1);
        win.dispatchEvent(event('keydown', { key: 'Escape' }));

        // Gone for the page behind it at once (the loading screen's clock starts), still fading.
        await expect(warning.dismissed).resolves.toMatchObject({ reason: 'input', via: 'key' });
        expect(doc.body.classList.contains(PHOTOSENSITIVITY_WARNING_BODY_CLASS)).toBe(false);
        expect(element.attributes['aria-hidden']).toBe('true');
        expect(element.removed).toBe(false);
        expect(warning.isCovering()).toBe(true);
        const during = event('keydown', { key: 'b' });
        win.dispatchEvent(during);
        expect(during.stopImmediatePropagation).toHaveBeenCalled();

        vi.advanceTimersByTime(FADE);
        expect(element.removed).toBe(true);
        expect(warning.isCovering()).toBe(false);
        const after = event('keydown', { key: 'c' });
        win.dispatchEvent(after);
        expect(after.stopImmediatePropagation).not.toHaveBeenCalled();
        expect(reports.at(-1).phase).toBe('photosensitivity-warning:gone');
    });

    it('under reduced motion it leaves at once, and dismiss is idempotent', async () => {
        const { element, warning } = mount({ options: { reduceMotion: true } });
        const first = warning.dismiss('manual');
        const second = warning.dismiss('auto');
        expect(second).toBe(first);
        expect(element.removed).toBe(true);
        await expect(first).resolves.toMatchObject({ reason: 'manual' });
    });

    it('dispose takes it down without a fade and resolves anyone waiting', async () => {
        const { element, warning, doc } = mount();
        warning.dispose();
        expect(element.removed).toBe(true);
        expect(doc.body.classList.contains(PHOTOSENSITIVITY_WARNING_BODY_CLASS)).toBe(false);
        await expect(warning.dismissed).resolves.toMatchObject({ reason: 'disposed' });
    });
});

describe('installPhotosensitivityWarning', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('wires the markup once and keeps the controller on the window for main.js', () => {
        const element = fakeElement();
        const win = fakeWindow();
        const doc = fakeDocument(element);
        const reports = [];
        const first = installPhotosensitivityWarning({
            window: win, document: doc, reportPhase: (phase) => reports.push(phase),
        });
        expect(first.element).toBe(element);
        expect(first.isActive()).toBe(true);
        expect(win.__serenityPhotosensitivityWarning).toBe(first);
        expect(installPhotosensitivityWarning({ window: win, document: doc })).toBe(first);
        expect(reports).toContain('photosensitivity-warning:shown');
        first.dispose();
    });

    it('a skip flag takes the markup down before it is seen', async () => {
        const element = fakeElement();
        const win = fakeWindow({ search: '?photosensitivityWarning=0' });
        const doc = fakeDocument(element);
        doc.body.classList.add(PHOTOSENSITIVITY_WARNING_BODY_CLASS);
        const reports = [];
        const warning = installPhotosensitivityWarning({
            window: win, document: doc, reportPhase: (phase, payload) => reports.push({ phase, ...payload }),
        });
        expect(element.removed).toBe(true);
        expect(doc.body.classList.contains(PHOTOSENSITIVITY_WARNING_BODY_CLASS)).toBe(false);
        expect(warning.isActive()).toBe(false);
        expect(warning.isCovering()).toBe(false);
        await expect(warning.dismissed).resolves.toMatchObject({ reason: 'skipped', visibleMs: 0 });
        expect(reports[0]).toMatchObject({ phase: 'photosensitivity-warning:skipped', enabled: false, markup: true });
    });

    it('the saved flag skips it too, and no markup is a skip', async () => {
        const saved = installPhotosensitivityWarning({
            window: fakeWindow({ storage: { 'serenity.photosensitivityWarning': '0' } }),
            document: fakeDocument(fakeElement()),
            reportPhase: () => {},
        });
        expect(saved.snapshot().state).toBe('skipped');

        const bare = installPhotosensitivityWarning({
            window: fakeWindow(), document: fakeDocument(null), reportPhase: () => {},
        });
        expect(bare.snapshot().state).toBe('skipped');
        await expect(bare.dismissed).resolves.toMatchObject({ reason: 'skipped' });
    });
});

describe('index.html', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

    it('opens <body> with the warning, before the loading screen and everything else', () => {
        // The tag itself, at a line start (the head's comments mention <body> too).
        const body = html.slice(html.indexOf('\n<body') + 1);
        const firstTag = body.replace(/^<body[^>]*>/, '').replace(/<!--[\s\S]*?-->/g, '').trimStart();
        expect(firstTag.startsWith(`<section id="${PHOTOSENSITIVITY_WARNING_ID}"`)).toBe(true);
        expect(html.indexOf(`id="${PHOTOSENSITIVITY_WARNING_ID}"`)).toBeLessThan(html.indexOf('id="startup-shell"'));
        expect(/<body class="[^"]*\bphotosensitivity-warning-active\b[^"]*">/.test(html)).toBe(true);
    });

    it('says the industry wording, names the setting, and offers the way on', () => {
        expect(html).toContain('A very small percentage of people may experience epileptic seizures or blackouts');
        expect(html).toContain('Immediately stop playing and consult a doctor');
        expect(html).toContain('Reduce flashing effects</strong>');
        expect(html).toContain('id="photosensitivity-warning-continue"');
        expect(html).toContain('Press any key or button, or tap, to continue');
        expect(html).toMatch(/role="dialog" aria-modal="true" aria-labelledby="photosensitivity-warning-title"/);
    });

    it('is styled inline, still, white on black, and run by its own module', () => {
        const style = html.match(/<style id="photosensitivity-warning-style">([\s\S]*?)<\/style>/)?.[1] ?? '';
        expect(style).toContain('background: #000;');
        expect(style).toContain('color: #fff;');
        expect(style).not.toMatch(/animation/);
        expect(style).toContain('@media (prefers-reduced-motion: reduce)');
        expect(html).toContain("import { installPhotosensitivityWarning } from './src/ui/photosensitivity-warning.js';");
        expect(html).toContain('<link rel="stylesheet" href="/styles/photosensitivity.css">');
    });

    it('offers Reduce flashing effects beside Reduce motion in Settings > Visual', () => {
        const visual = html.slice(html.indexOf('id="settings-visual"'), html.indexOf('id="settings-controls"'));
        expect(visual).toContain('id="reduced-motion"');
        expect(visual).toContain('id="reduce-flashing"');
        expect(visual.indexOf('id="reduced-motion"')).toBeLessThan(visual.indexOf('id="reduce-flashing"'));
    });
});
