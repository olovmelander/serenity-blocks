import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    clearOdysseyStartCue, getOdysseyStartCueTimings, showOdysseyStartCue,
} from '../../src/ui/odyssey/odyssey-start-cue.js';

vi.mock('../../src/core/game-modes/odyssey-physics-callbacks.js', () => ({
    prefersOdysseyReducedMotion: (mode) => mode.reduced === true,
}));

function createDom() {
    const animations = [];
    const create = (tagName) => {
        const node = {
            tagName,
            id: '',
            className: '',
            textContent: '',
            dataset: {},
            attributes: new Map(),
            children: [],
            parentNode: null,
            style: {},
            classList: {
                add(name) { node.className = `${node.className} ${name}`.trim(); },
            },
            appendChild(child) { child.parentNode = node; node.children.push(child); return child; },
            remove() {
                if (!node.parentNode) return;
                node.parentNode.children = node.parentNode.children.filter((child) => child !== node);
                node.parentNode = null;
            },
            setAttribute(name, value) { node.attributes.set(name, String(value)); },
            removeAttribute(name) { node.attributes.delete(name); if (name === 'id') node.id = ''; },
            querySelectorAll(selector) {
                const descendants = (root) => root.children.flatMap((child) => [child, ...descendants(child)]);
                return selector === '[id]' ? descendants(node).filter((child) => child.id) : [];
            },
            cloneNode() {
                const copy = create(tagName);
                Object.assign(copy, {
                    id: node.id, className: node.className, textContent: node.textContent, dataset: { ...node.dataset },
                });
                node.attributes.forEach((value, name) => copy.attributes.set(name, value));
                node.children.forEach((child) => copy.appendChild(child.cloneNode()));
                return copy;
            },
            animate(keyframes, options) {
                const animation = { keyframes, options, target: node };
                animations.push(animation);
                return animation;
            },
        };
        return node;
    };
    const body = create('body');
    const all = (root) => [root, ...root.children.flatMap(all)];
    const document = {
        body,
        createElement: create,
        getElementById: (id) => all(body).find((node) => node.id === id) || null,
    };
    return { document, animations, all };
}

describe('Odyssey Ready → Go cue', () => {
    let dom;
    beforeEach(() => {
        vi.useFakeTimers();
        dom = createDom();
        vi.stubGlobal('document', dom.document);
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    const createMode = (overrides = {}) => ({
        currentLevelConfig: { name: 'Ashen Dawn' },
        deps: { soundManager: { sfxPlayer: { playMove: vi.fn(), playDrop: vi.fn() } } },
        ...overrides,
    });

    it('keeps the fairness timings: a longer Ready for faster gravity', () => {
        expect(getOdysseyStartCueTimings({ dropInterval: 450 })).toEqual({ readyMs: 800, goMs: 280, dropInterval: 450 });
        expect(getOdysseyStartCueTimings({ dropInterval: 720 })).toEqual({ readyMs: 650, goMs: 240, dropInterval: 720 });
        expect(getOdysseyStartCueTimings({ dropInterval: 1000 })).toEqual({ readyMs: 500, goMs: 200, dropInterval: 1000 });
        expect(getOdysseyStartCueTimings(null)).toEqual({ readyMs: 500, goMs: 200, dropInterval: null });
    });

    it('lands GO on time, hands over control on time and leaves only a pointer-transparent afterglow', async () => {
        const mode = createMode();
        const cue = showOdysseyStartCue(mode, mode.currentLevelConfig, { dropInterval: 720 });
        const overlay = document.getElementById('odyssey-level-start-cue');
        expect(overlay.className).toBe('odyssey-start-cue');
        expect(overlay.dataset.phase).toBe('ready');
        expect(mode.entryPhase).toBe('countdown');
        expect(document.getElementById('odyssey-level-start-cue-label').textContent).toBe('READY');
        await vi.advanceTimersByTimeAsync(649);
        expect(overlay.dataset.phase).toBe('ready');
        await vi.advanceTimersByTimeAsync(1);
        expect(overlay.dataset.phase).toBe('go');
        expect(document.getElementById('odyssey-level-start-cue-label').textContent).toBe('GO');
        expect(mode.deps.soundManager.sfxPlayer.playDrop).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(240);
        await expect(cue).resolves.toBe(true);
        expect(document.getElementById('odyssey-level-start-cue')).toBeNull();
        expect(document.getElementById('odyssey-level-start-cue-label')).toBeNull();
        const [afterglow] = dom.animations;
        expect(afterglow.target.className).toContain('odyssey-start-cue--afterglow');
        expect(afterglow.target.attributes.get('aria-hidden')).toBe('true');
        expect(afterglow.target.inert).toBe(true);
        expect(dom.all(afterglow.target).some((node) => node.id)).toBe(false);
        afterglow.onfinish();
        expect(document.body.children).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('settles a cleared cue false without an afterglow, and never leaves one under reduced motion', async () => {
        const mode = createMode();
        const cue = showOdysseyStartCue(mode, mode.currentLevelConfig, { dropInterval: 450 });
        clearOdysseyStartCue(mode);
        await expect(cue).resolves.toBe(false);
        expect(document.getElementById('odyssey-level-start-cue')).toBeNull();
        expect(dom.animations).toHaveLength(0);
        const reduced = createMode({ reduced: true });
        const calm = showOdysseyStartCue(reduced, reduced.currentLevelConfig, { dropInterval: 450 });
        expect(document.getElementById('odyssey-level-start-cue').dataset.reducedMotion).toBe('true');
        await vi.advanceTimersByTimeAsync(1080);
        await expect(calm).resolves.toBe(true);
        expect(dom.animations).toHaveLength(0);
        expect(document.body.children).toHaveLength(0);
    });

    it('refuses to cue a missing game state', async () => {
        await expect(showOdysseyStartCue(createMode(), null, null)).resolves.toBe(false);
        expect(document.body.children).toHaveLength(0);
    });
});
