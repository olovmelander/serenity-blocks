import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import CosmicChimesTheme from '../../src/themes/cosmic-chimes/cosmic-chimes-theme.js';

function element(fragment = false) {
    const style = {};
    let cssText = '';
    Object.defineProperty(style, 'cssText', {
        get: () => cssText,
        set: (value) => {
            cssText = value;
            Object.keys(style).forEach((key) => { delete style[key]; });
        },
    });
    const node = { style, children: [], fragment };
    node.appendChild = (child) => {
        if (child.fragment) node.children.push(...child.children);
        else node.children.push(child);
    };
    Object.defineProperty(node, 'innerHTML', { set: () => { node.children.length = 0; } });
    return node;
}

function installChimesDom() {
    const dust = element();
    const chimes = element();
    const nebula = element();
    vi.stubGlobal('document', {
        getElementById: (id) => (id === 'space-dust' ? dust : chimes),
        querySelector: () => nebula,
        createElement: () => element(),
        createDocumentFragment: () => element(true),
    });
    return { dust, chimes, nebula };
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Cosmic Chimes selected quality animation policy', () => {
    it('keeps Minimal particles and chimes static after writing their layout CSS', () => {
        const { dust, chimes } = installChimesDom();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const theme = new CosmicChimesTheme();
        theme.applyQualityPreset('Minimal');
        theme.createSpaceDust();
        theme.createChimes();
        expect(dust.children).toHaveLength(15);
        expect(chimes.children).toHaveLength(3);
        expect(dust.children.every((child) => child.style.animation === 'none' && child.style.opacity === '0.3')).toBe(true);
        expect(chimes.children.every((child) => child.style.animation === 'none' && child.style.opacity === '0.6')).toBe(true);
        expect(dust.children[0].style.cssText).toContain('width:');
        expect(chimes.children[0].style.cssText).toContain('left:');
    });

    it('restores the stylesheet animation when quality rises, and pauses it again when lowered', () => {
        const { nebula, dust, chimes } = installChimesDom();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const theme = new CosmicChimesTheme();
        theme.isActive = true;
        theme.applyQualityPreset('Minimal');
        expect(nebula.style.animation).toBe('none');
        theme.applyQualityPreset('High');
        expect(nebula.style.animation).toBe('');
        expect(dust.children).toHaveLength(45);
        expect(chimes.children).toHaveLength(9);
        expect(dust.children.every((child) => child.style.animation !== 'none')).toBe(true);
        theme.applyQualityPreset('Minimal');
        expect(nebula.style.animation).toBe('none');
    });
});
