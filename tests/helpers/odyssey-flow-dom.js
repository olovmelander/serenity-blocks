/** Minimal DOM event fixture for production Odyssey presence/entry orchestration. */
export function createOdysseyFlowDom() {
    const eventTarget = (properties = {}) => {
        const listeners = new Map();
        return {
            ...properties,
            addEventListener(type, listener) {
                if (!listeners.has(type)) listeners.set(type, new Set());
                listeners.get(type).add(listener);
            },
            removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
            dispatch(type, properties = {}) {
                const event = {
                    target: this, preventDefault() {}, stopPropagation() {}, ...properties,
                };
                listeners.get(type)?.forEach((listener) => listener(event));
                return event;
            },
            listenerCount: () => [...listeners.values()].reduce((sum, group) => sum + group.size, 0),
        };
    };
    const nodes = (element) => [element, ...element.children.flatMap(nodes)];
    const document = eventTarget({ hidden: false, hasFocus: () => true, activeElement: null });
    document.createElement = (tagName) => eventTarget({
        tagName, children: [], dataset: {}, style: { setProperty() {} },
        textContent: '', className: '', hidden: false, isConnected: false,
        appendChild(child) { child.parentNode = this; child.isConnected = true; this.children.push(child); return child; },
        remove() {
            this.isConnected = false;
            if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((node) => node !== this);
        },
        focus() { document.activeElement = this; },
        setAttribute(name, value) { this[name] = value; },
        querySelector(selector) {
            const action = /data-flow-action=['"]([^'"]+)/.exec(selector)?.[1];
            return nodes(this).find((node) => action && node.dataset.flowAction === action) || null;
        },
    });
    document.body = document.createElement('body');
    document.getElementById = (id) => nodes(document.body).find((node) => node.id === id) || null;
    const window = eventTarget();
    return { document, window };
}
