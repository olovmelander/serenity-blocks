import { describe, expect, it } from 'vitest';
import { MenuLight } from '../../src/ui/main-menu/menu-light.js';

// Just what the light touches: elements with classes, data attributes and children.
function node(tag) {
    const classes = new Set();
    return {
        tagName: tag.toUpperCase(),
        children: [],
        dataset: {},
        attributes: {},
        set className(value) {
            classes.clear();
            String(value).split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
        },
        get className() { return [...classes].join(' '); },
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name),
        },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        appendChild(child) { this.children.push(child); return child; },
        insertBefore(child, reference) {
            const index = reference ? this.children.indexOf(reference) : -1;
            if (index >= 0) this.children.splice(index, 0, child);
            else this.children.push(child);
            return child;
        },
        get firstChild() { return this.children[0] || null; },
    };
}

const doc = { createElement: (tag) => node(tag) };
const lit = (light) => light.layers.filter((layer) => layer.classList.contains('is-on'));

describe('main menu light', () => {
    it('goes in first, under the menu, hidden from assistive tech', () => {
        const modal = node('div');
        const menu = modal.appendChild(node('div'));
        const light = new MenuLight(modal, doc);
        expect(modal.children[0]).toBe(light.element);
        expect(modal.children[1]).toBe(menu);
        expect(light.element.className).toBe('sb-menu-light');
        expect(light.element.attributes['aria-hidden']).toBe('true');
        expect(light.layers).toHaveLength(2);
        expect(light.mode).toBeNull();
    });

    it('hands the light from layer to layer, so the last mode fades out as the next fades in', () => {
        const light = new MenuLight(node('div'), doc);
        light.to('single');
        expect(light.mode).toBe('single');
        expect(lit(light)).toHaveLength(1);
        const first = lit(light)[0];

        light.to('stillfall');
        expect(light.mode).toBe('stillfall');
        expect(lit(light)).toHaveLength(1);
        const second = lit(light)[0];
        expect(second).not.toBe(first);
        expect(second.dataset.light).toBe('stillfall');
        // The outgoing layer keeps its colour while it fades.
        expect(first.dataset.light).toBe('single');

        light.to('odyssey');
        expect(lit(light)[0]).toBe(first);
        expect(first.dataset.light).toBe('odyssey');
    });

    it('does nothing for the mode it already shows, or without a mode', () => {
        const light = new MenuLight(node('div'), doc);
        light.to('serenity');
        const on = lit(light)[0];
        light.to('serenity');
        light.to(null);
        expect(lit(light)).toEqual([on]);
        expect(light.mode).toBe('serenity');
    });

    it('is inert without a host', () => {
        const light = new MenuLight(null, doc);
        expect(() => light.to('single')).not.toThrow();
        expect(light.mode).toBeNull();
    });
});
