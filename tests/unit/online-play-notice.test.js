/**
 * The notice read once before online play (src/ui/online-play-notice.js): shown the first time
 * Online Versus is opened, one button, remembered on this device. The mode's side of it (no
 * match list and no join before it is read) is in online-networking-init.test.js.
 */
import { readFileSync } from 'node:fs';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

function makeElement(tag) {
    const listeners = new Map();
    const el = {
        tagName: tag.toUpperCase(),
        children: [],
        parent: null,
        attributes: {},
        className: '',
        id: '',
        textContent: '',
        type: '',
        get isConnected() {
            let node = el;
            while (node.parent) node = node.parent;
            return node.isBody === true;
        },
        classList: { contains: (name) => el.className.split(/\s+/).includes(name) },
        setAttribute(name, value) { el.attributes[name] = String(value); },
        appendChild(child) { child.parent = el; el.children.push(child); return child; },
        remove() {
            if (el.parent) el.parent.children = el.parent.children.filter((child) => child !== el);
            el.parent = null;
        },
        contains(other) { return other === el || el.children.some((child) => child.contains(other)); },
        addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
        dispatch(type, event = {}) { (listeners.get(type) || []).forEach((fn) => fn(event)); },
        click() { el.dispatch('click', {}); },
        focus: vi.fn(),
        find(className) {
            if (el.className.split(/\s+/).includes(className)) return el;
            return el.children.map((child) => child.find(className)).find(Boolean) || null;
        },
        all(tagName) {
            return [...(el.tagName === tagName ? [el] : []), ...el.children.flatMap((child) => child.all(tagName))];
        },
    };
    return el;
}

let body;
let doc;
let storage;
let keydown;
let notice;

function escape() {
    keydown({
        key: 'Escape',
        defaultPrevented: false,
        preventDefault() {},
        stopImmediatePropagation() {},
        target: { closest: () => null, matches: () => false },
    });
}

beforeEach(async () => {
    vi.resetModules();
    body = makeElement('body');
    body.isBody = true;
    doc = {
        body, activeElement: null, createElement: makeElement, getElementById: () => null,
    };
    const data = new Map();
    storage = {
        data,
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
    };
    keydown = () => {};
    vi.stubGlobal('document', doc);
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { addEventListener: (type, fn) => { if (type === 'keydown') keydown = fn; } });
    vi.stubGlobal('requestAnimationFrame', (callback) => { callback(); return 1; });
    notice = await import('../../src/ui/online-play-notice.js');
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('the online play notice', () => {
    it('says what an online match shares, with one button', async () => {
        const answered = vi.fn();
        notice.ensureOnlinePlayNotice().then(answered);
        await Promise.resolve();

        const sheet = body.children[0];
        expect(sheet.attributes.role).toBe('alertdialog');
        expect(sheet.attributes['aria-modal']).toBe('true');
        expect(sheet.find('sb-confirm__title').textContent).toBe('Before you play online');
        expect(sheet.find('sb-confirm__message').textContent).toBe(
            'An online match connects your computer directly to the match\'s host, and the host\'s computer '
            + 'to everyone in the match. The players you are connected to can see your IP address, as in most '
            + 'online games. Play with friends only if you would rather not share it with strangers.',
        );
        const buttons = sheet.all('BUTTON');
        expect(buttons.map((button) => button.textContent)).toEqual(['I understand']);
        expect(buttons[0].focus).toHaveBeenCalled();
        // Nothing is decided until the button is pressed.
        expect(answered).not.toHaveBeenCalled();
        expect(notice.hasSeenOnlinePlayNotice()).toBe(false);
    });

    it('"I understand" is remembered on this device: it is not shown again', async () => {
        const first = notice.ensureOnlinePlayNotice();
        body.children[0].all('BUTTON')[0].click();
        expect(await first).toBe(true);
        expect(body.children).toHaveLength(0);
        expect(storage.data.get(notice.ONLINE_NOTICE_KEY)).toBe('1');
        expect(notice.hasSeenOnlinePlayNotice()).toBe(true);

        // A later visit, and a later launch (a fresh module reading the same storage).
        expect(await notice.ensureOnlinePlayNotice()).toBe(true);
        vi.resetModules();
        const relaunched = await import('../../src/ui/online-play-notice.js');
        expect(relaunched.hasSeenOnlinePlayNotice()).toBe(true);
        expect(await relaunched.ensureOnlinePlayNotice()).toBe(true);
        expect(body.children).toHaveLength(0);
    });

    it('Escape backs out without it: nothing is remembered and it shows again next time', async () => {
        const first = notice.ensureOnlinePlayNotice();
        expect(body.children).toHaveLength(1);
        escape();
        expect(await first).toBe(false);
        expect(body.children).toHaveLength(0);
        expect(storage.data.size).toBe(0);
        expect(notice.hasSeenOnlinePlayNotice()).toBe(false);

        const second = notice.ensureOnlinePlayNotice();
        expect(body.children).toHaveLength(1);
        body.children[0].all('BUTTON')[0].click();
        expect(await second).toBe(true);
    });

    it('is one sheet however often it is asked for, and keeps Tab on its button', async () => {
        const first = notice.ensureOnlinePlayNotice();
        const second = notice.ensureOnlinePlayNotice();
        expect(second).toBe(first);
        expect(body.children).toHaveLength(1);

        const sheet = body.children[0];
        const button = sheet.all('BUTTON')[0];
        button.focus.mockClear();
        const tab = { key: 'Tab', stopPropagation: vi.fn(), preventDefault: vi.fn() };
        sheet.dispatch('keydown', tab);
        expect(tab.preventDefault).toHaveBeenCalled();
        expect(button.focus).toHaveBeenCalled();
        const other = { key: 'ArrowLeft', stopPropagation: vi.fn(), preventDefault: vi.fn() };
        sheet.dispatch('keydown', other);
        expect(other.stopPropagation).toHaveBeenCalled(); // no key reaches the game behind it
        expect(other.preventDefault).not.toHaveBeenCalled();

        button.click();
        expect(await first).toBe(true);
    });

    it('holds for the session when the device cannot store it, and is not read with no page to show it', async () => {
        vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('blocked'); },
            setItem: () => { throw new Error('blocked'); },
        });
        const first = notice.ensureOnlinePlayNotice();
        body.children[0].all('BUTTON')[0].click();
        expect(await first).toBe(true);
        expect(notice.hasSeenOnlinePlayNotice()).toBe(true);

        notice.resetOnlinePlayNoticeForTests();
        expect(notice.hasSeenOnlinePlayNotice()).toBe(false);
        expect(await notice.ensureOnlinePlayNotice({ doc: null })).toBe(false);
        expect(await notice.ensureOnlinePlayNotice({ doc: {} })).toBe(false);
    });
});

describe('where the notice and the chat setting live', () => {
    const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

    it('Online Versus asks for the notice before its match list, and before any join', () => {
        const mode = read('src/core/game-modes/OnlineMultiplayerMode.js');
        const activate = mode.slice(
            mode.indexOf('async onActivate()'), mode.indexOf('async initializeSteamNetworking()'),
        );
        expect(activate.indexOf('await ensureOnlinePlayNotice()')).toBeGreaterThan(-1);
        expect(activate).toContain('this.steamNetworking.mockMode === true || await ensureOnlinePlayNotice()');
        expect(activate.indexOf('await ensureOnlinePlayNotice()'))
            .toBeLessThan(activate.indexOf('await this.showLobbyBrowser()'));
        const join = mode.slice(mode.indexOf('async handleJoinLobby('));
        const guard = "if (this.steamNetworking?.mockMode !== true && !hasSeenOnlinePlayNotice()) return;";
        expect(join.indexOf(guard)).toBeGreaterThan(-1);
        expect(join.indexOf(guard)).toBeLessThan(join.indexOf('.joinLobby(lobbyId)'));
    });

    it('Settings › General has "Chat in public matches" beside the chat setting, off by default', async () => {
        const html = read('index.html');
        const chat = html.indexOf('id="online-chat-toggle"');
        const publicChat = html.indexOf('id="public-chat-toggle"');
        const muted = html.indexOf('id="chat-muted-list"');
        expect(chat).toBeGreaterThan(-1);
        expect(publicChat).toBeGreaterThan(chat);
        expect(publicChat).toBeLessThan(muted);
        expect(html).toContain('<label for="public-chat-toggle">Chat in public matches</label>');
        expect(html).toContain('<p class="setting-help" id="public-chat-toggle-help">Chat with players you don\'t '
            + 'know. When off, chat works only in friends and invite-only matches.</p>');
        expect(html).toMatch(/id="public-chat-toggle" role="switch" aria-describedby="public-chat-toggle-help"/);

        const settings = read('src/ui/settings.js');
        expect(settings).toMatch(/\n {4}onlineChat: true,/);
        expect(settings).toMatch(/\n {4}publicMatchChat: false,/);
        expect(settings).toContain("publicToggle.checked = settings.publicMatchChat === true;");
        expect(settings).toContain('settingsManager.update({ publicMatchChat: e.target.checked });');
        // Both stay on this device: neither is among the settings Steam Cloud keeps.
        const cloud = read('src/core/steam/steam-cloud-sync.js');
        expect(cloud).not.toContain('publicMatchChat');
        expect(cloud).not.toContain('onlineChat');
    });

    it('the lobby\'s player cards have "View Steam profile" beside Mute', () => {
        const room = read('src/ui/lobby-waiting-room.js');
        const mute = room.indexOf('cardEl.appendChild(muteBtn);');
        const profile = room.indexOf('createSteamProfileButton(player.steamId, displayName, {');
        expect(mute).toBeGreaterThan(-1);
        expect(profile).toBeGreaterThan(mute);
        expect(room).toContain("className: 'player-profile-btn', size: 16,");
        const css = read('public/styles/keystone-multiplayer.css');
        expect(css).toContain('#lobby-waiting-room .player-profile-btn {');
        expect(css).toContain('.chat-profile-btn {');
    });
});
