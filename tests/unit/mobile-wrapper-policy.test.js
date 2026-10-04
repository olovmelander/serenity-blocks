import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import Bioluminescence2Theme from '../../src/themes/bioluminescence-2/bioluminescence-2-theme.js';
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

describe('Bioluminescence II canonical effect quality defaults', () => {
    it.each([['Minimal', '0.4'], ['Low', '0.5'], ['Medium', '0.75']])('uses selected %s density and bloom budget', (quality, density) => {
        vi.stubGlobal('window', { location: { search: '' }, settings: { effectQuality: quality } });
        const params = Bioluminescence2Theme.prototype.getSceneParams.call({});
        expect(params.get('density')).toBe(density);
        expect(params.has('nobloom')).toBe(true);
    });

    it.each(['High', 'Ultra', 'Extreme'])('preserves the authored full density/bloom on %s', (quality) => {
        vi.stubGlobal('window', { location: { search: '' }, settings: { effectQuality: quality } });
        const params = Bioluminescence2Theme.prototype.getSceneParams.call({});
        expect(params.get('density')).toBe('1');
        expect(params.has('nobloom')).toBe(false);
    });

    it('preserves explicit scene URL overrides', () => {
        vi.stubGlobal('window', { location: { search: '?density=0.8&nobloom=1&spores=42' }, settings: { effectQuality: 'High' } });
        const params = Bioluminescence2Theme.prototype.getSceneParams.call({});
        expect(params.get('density')).toBe('0.8');
        expect(params.get('nobloom')).toBe('1');
        expect(params.get('spores')).toBe('42');
    });
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
