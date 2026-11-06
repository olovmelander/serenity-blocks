import { describe, expect, it, vi } from 'vitest';
import { enhanceSelect, enhanceSegmented } from '../../src/ui/components/cosmic-select.js';

function selectHarness(options, attributes = {}) {
    class Element {
        constructor(tagName) {
            this.tagName = tagName.toUpperCase();
            this.dataset = {};
            this.attributes = new Map();
            this.children = [];
            this.listeners = new Map();
            this.classes = new Set();
            this.disabled = false;
            this.classList = {
                add: (name) => this.classes.add(name),
                remove: (name) => this.classes.delete(name),
                toggle: (name, active) => (active ? this.classes.add(name) : this.classes.delete(name)),
            };
            this.focus = vi.fn();
        }
        getAttribute(name) { return this.attributes.get(name) ?? null; }
        setAttribute(name, value) { this.attributes.set(name, String(value)); }
        removeAttribute(name) { this.attributes.delete(name); }
        addEventListener(name, listener) { this.listeners.set(name, listener); }
        removeEventListener(name) { this.listeners.delete(name); }
        dispatchEvent(event) { this.listeners.get(event.type)?.(event); }
        appendChild(child) {
            child.remove();
            child.parentNode = this;
            this.children.push(child);
            return child;
        }
        append(...children) { children.forEach((child) => this.appendChild(child)); }
        insertBefore(child, before) {
            child.remove();
            child.parentNode = this;
            this.children.splice(this.children.indexOf(before), 0, child);
        }
        remove() {
            if (this.parentNode) {
                this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
                this.parentNode = null;
            }
        }
        closest() { return null; }
    }
    const document = { createElement: (tag) => new Element(tag) };
    const select = new Element('select');
    select.ownerDocument = document;
    select.options = options.map((option) => ({ disabled: false, textContent: option.value, ...option }));
    select.value = options[0]?.value ?? '';
    for (const [name, value] of Object.entries(attributes)) select.setAttribute(name, value);
    const parent = new Element('div');
    parent.appendChild(select);
    const changes = vi.fn();
    select.addEventListener('change', changes);
    // Native addEventListener permits multiple listeners; preserve the observer when
    // the enhancement installs its own change listener in this minimal fixture.
    select.dispatchEvent = (event) => {
        if (event.type === 'change') changes(event);
        select.listeners.get(event.type)?.(event);
    };
    return { select, parent, changes };
}

function key(group, name) {
    const event = { type: 'keydown', key: name, preventDefault: vi.fn() };
    group.dispatchEvent(event);
    return event;
}

describe('segmented select keyboard behavior', () => {
    it('skips disabled options in both directions', () => {
        const { select, changes } = selectHarness([
            { value: 'a' }, { value: 'b', disabled: true }, { value: 'c' },
        ]);
        const { element } = enhanceSegmented(select, { label: 'Mode' });

        key(element, 'ArrowRight');
        expect(select.value).toBe('c');
        key(element, 'ArrowLeft');
        expect(select.value).toBe('a');
        expect(changes).toHaveBeenCalledTimes(2);
    });

    it('disables its buttons and ignores keys while the native select is disabled', () => {
        const { select, changes } = selectHarness([{ value: 'a' }, { value: 'b' }]);
        select.disabled = true;
        const api = enhanceSegmented(select, { label: 'Mode' });
        const buttons = api.element.children.filter((element) => element.tagName === 'BUTTON');

        expect(buttons.every((button) => button.disabled)).toBe(true);
        key(api.element, 'ArrowRight');
        expect(select.value).toBe('a');
        expect(changes).not.toHaveBeenCalled();

        select.disabled = false;
        api.syncDisabled();
        expect(buttons.every((button) => !button.disabled)).toBe(true);
        key(api.element, 'ArrowRight');
        expect(select.value).toBe('b');
    });

    it('does nothing when the option list is empty or all options are disabled', () => {
        for (const options of [[], [{ value: 'a', disabled: true }, { value: 'b', disabled: true }]]) {
            const { select, changes } = selectHarness(options);
            const { element } = enhanceSegmented(select, { label: 'Mode' });
            const before = select.value;
            expect(() => key(element, 'ArrowRight')).not.toThrow();
            expect(select.value).toBe(before);
            expect(changes).not.toHaveBeenCalled();
        }
    });

    it.each(['disabled', 'missing'])('keeps an enabled Tab stop when the selection is %s', (selection) => {
        const { select, changes } = selectHarness([
            { value: 'a', disabled: true }, { value: 'b' }, { value: 'c' },
        ]);
        if (selection === 'missing') select.value = '';
        const originalValue = select.value;
        const { element } = enhanceSegmented(select, { label: 'Mode' });
        const buttons = element.children.filter((node) => node.tagName === 'BUTTON');

        expect(buttons.filter((button) => button.tabIndex === 0)).toEqual([buttons[1]]);
        expect(select.value).toBe(originalValue);
        expect(changes).not.toHaveBeenCalled();
        key(element, 'ArrowRight');
        expect(select.value).toBe('b');
    });
});

describe.each([
    ['dropdown', enhanceSelect],
    ['segmented control', enhanceSegmented],
])('%s native accessibility restoration', (_name, enhance) => {
    it('restores the original accessibility attributes when destroyed', () => {
        for (const attributes of [{}, { 'aria-hidden': 'false', tabindex: '3' }]) {
            const { select, parent } = selectHarness([{ value: 'a' }], attributes);
            const api = enhance(select, { label: 'Mode' });
            expect(select.getAttribute('aria-hidden')).toBe('true');
            expect(select.getAttribute('tabindex')).toBe('-1');

            api.destroy();

            expect(select.parentNode).toBe(parent);
            expect(select.getAttribute('aria-hidden')).toBe(attributes['aria-hidden'] ?? null);
            expect(select.getAttribute('tabindex')).toBe(attributes.tabindex ?? null);
        }
    });
});
