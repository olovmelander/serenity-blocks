/**
 * A forgiving stand-in for DOM elements in node-environment tests.
 *
 * `querySelector` hands back the same loose node for the same selector, so a component can
 * be exercised end to end without a parsed document and a test can still read what it wrote
 * (`root.querySelector('.name').textContent`). `querySelectorAll` returns `node.lists[selector]`.
 */
export function looseNode(tagName = 'div') {
    const classes = new Set();
    const attributes = new Map();
    const listeners = new Map();
    const found = new Map();
    const style = {
        setProperty(name, value) { style[name] = String(value); },
    };
    const node = {
        tagName: tagName.toUpperCase(),
        style,
        dataset: {},
        lists: {},
        children: [],
        hidden: false,
        disabled: false,
        checked: false,
        textContent: '',
        innerHTML: '',
        className: '',
        parent: null,
        classList: {
            add: (...names) => names.forEach((name) => classes.add(name)),
            remove: (...names) => names.forEach((name) => classes.delete(name)),
            toggle(name, force) {
                const on = force === undefined ? !classes.has(name) : Boolean(force);
                if (on) classes.add(name);
                else classes.delete(name);
                return on;
            },
            contains: (name) => classes.has(name),
        },
        setAttribute: (name, value) => attributes.set(name, String(value)),
        getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null),
        removeAttribute: (name) => attributes.delete(name),
        append(...items) { items.forEach((item) => node.appendChild(item)); },
        appendChild(child) {
            node.children.push(child);
            if (child && typeof child === 'object') child.parent = node;
            return child;
        },
        replaceChildren(...items) {
            node.children.length = 0;
            node.append(...items);
        },
        get firstChild() { return node.children[0] || null; },
        remove() {
            node.removed = true;
            const siblings = node.parent?.children;
            if (siblings?.includes(node)) siblings.splice(siblings.indexOf(node), 1);
        },
        addEventListener(type, handler, options) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(handler);
            options?.signal?.addEventListener?.('abort', () => listeners.get(type)?.delete(handler));
        },
        removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
        /** Call every listener for `type` with a minimal event whose target is `target`. */
        fire(type, init = {}) {
            const event = {
                type,
                target: init.target || node,
                defaultPrevented: false,
                preventDefault() { event.defaultPrevented = true; },
                stopPropagation() { event.stopped = true; },
                stopImmediatePropagation() { event.stopped = true; event.stoppedNow = true; },
                ...init,
            };
            [...(listeners.get(type) || [])].forEach((handler) => handler(event));
            return event;
        },
        listenerCount: (type) => listeners.get(type)?.size || 0,
        focus() { node.focused = (node.focused || 0) + 1; },
        closest: () => null,
        contains: (other) => other === node || node.children.includes(other),
        querySelector(selector) {
            if (!found.has(selector)) found.set(selector, looseNode());
            return found.get(selector);
        },
        querySelectorAll: (selector) => node.lists[selector] || [],
    };
    return node;
}

/** An element that answers `closest(selector)` for the selectors it was made to match. */
export function targetMatching(matches = {}) {
    const node = looseNode('button');
    node.closest = (selector) => {
        const key = Object.keys(matches).find((candidate) => selector.split(',').some((part) => part.trim() === candidate));
        return key ? (matches[key] === true ? node : matches[key]) : null;
    };
    return node;
}

/** A `window` with working events, timers left to vitest, and nothing else. */
export function looseWindow(extra = {}) {
    const target = looseNode();
    return {
        innerWidth: 1440,
        innerHeight: 900,
        devicePixelRatio: 1,
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
        addEventListener: target.addEventListener,
        removeEventListener: target.removeEventListener,
        dispatchEvent(event) {
            target.fire(event.type, { detail: event.detail });
            return true;
        },
        listenerCount: target.listenerCount,
        ...extra,
    };
}
