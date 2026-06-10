/**
 * CosmicSelect — a themed, accessible in-DOM dropdown / segmented control that
 * ENHANCES a native <select> rather than replacing it.
 *
 * Why: a native <select>'s open option list is rendered as a separate OS-level
 * popup window above the page, so the cosmic cursor (an in-page overlay with the
 * native pointer hidden via `cursor: none`) cannot paint over it and freezes.
 * Rendering the option list as ordinary in-page DOM lets the cosmic cursor work.
 *
 * The native <select> is kept in the DOM as the form source of truth (so
 * `new FormData(form)`, `change` listeners, `querySelectorAll('select')`, and
 * `.value`/`.disabled` all keep working unchanged) and is synced both ways.
 *
 * Pattern: W3C ARIA APG Select-Only Combobox (dropdown) / radiogroup (segmented).
 */

let cosmicSelectUid = 0;
function nextId(prefix) {
    cosmicSelectUid += 1;
    return `${prefix}-${cosmicSelectUid}`;
}

function readOptions(select) {
    return Array.from(select.options).map((option) => ({
        value: option.value,
        label: option.textContent.trim(),
        disabled: option.disabled,
    }));
}

function resolveAccessibleName(select, explicitLabel) {
    if (explicitLabel) return explicitLabel;
    if (select.getAttribute('aria-label')) return select.getAttribute('aria-label');
    if (select.id) {
        const forLabel = select.ownerDocument.querySelector(`label[for="${select.id}"]`);
        if (forLabel) return forLabel.textContent.trim();
    }
    const wrapLabel = select.closest('.form-group, .cosmic-field')?.querySelector('label');
    return wrapLabel ? wrapLabel.textContent.trim() : (select.name || 'Select');
}

/**
 * Enhance a native <select> into a themed dropdown (combobox + listbox).
 * @returns {{refresh:Function, destroy:Function, element:HTMLElement}|null}
 */
function isEnhanceable(select) {
    return select
        && select.tagName === 'SELECT'
        && !select.multiple
        && select.dataset.cosmicEnhanced !== 'true'
        && select.dataset.cosmicSkip !== 'true';
}

export function enhanceSelect(select, { label = null } = {}) {
    if (!isEnhanceable(select)) return null;
    select.dataset.cosmicEnhanced = 'true';

    const doc = select.ownerDocument;
    const accessibleName = resolveAccessibleName(select, label);
    const listboxId = nextId('cosmic-listbox');

    const wrapper = doc.createElement('div');
    wrapper.className = 'cosmic-select';

    const trigger = doc.createElement('div');
    trigger.className = 'cosmic-select__trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('tabindex', '0');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', listboxId);
    trigger.setAttribute('aria-label', accessibleName);

    const valueEl = doc.createElement('span');
    valueEl.className = 'cosmic-select__value';
    const chevron = doc.createElement('span');
    chevron.className = 'cosmic-select__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '▾';
    trigger.append(valueEl, chevron);

    const listbox = doc.createElement('div');
    listbox.className = 'cosmic-select__listbox';
    listbox.id = listboxId;
    listbox.setAttribute('role', 'listbox');
    listbox.setAttribute('tabindex', '-1');
    listbox.setAttribute('aria-label', accessibleName);
    listbox.hidden = true;

    // Native select stays in the DOM (form source of truth) but visually hidden.
    select.classList.add('cosmic-select__native');
    select.setAttribute('aria-hidden', 'true');
    select.setAttribute('tabindex', '-1');
    select.parentNode.insertBefore(wrapper, select);
    wrapper.append(trigger, select, listbox);

    const state = {
        open: false, activeIndex: -1, options: [], optionEls: [], typeahead: '', typeaheadAt: 0,
    };

    const syncDisabled = () => {
        wrapper.classList.toggle('is-disabled', select.disabled);
        trigger.setAttribute('aria-disabled', select.disabled ? 'true' : 'false');
        trigger.setAttribute('tabindex', select.disabled ? '-1' : '0');
    };

    const renderValue = () => {
        const opt = state.options.find((o) => o.value === select.value);
        valueEl.textContent = opt ? opt.label : (state.options[0]?.label ?? '');
    };

    const buildOptions = () => {
        state.options = readOptions(select);
        listbox.textContent = '';
        state.optionEls = state.options.map((opt, index) => {
            const el = doc.createElement('div');
            el.className = 'cosmic-select__option';
            el.id = nextId('cosmic-option');
            el.setAttribute('role', 'option');
            el.dataset.value = opt.value;
            el.dataset.index = String(index);
            el.setAttribute('aria-selected', opt.value === select.value ? 'true' : 'false');
            if (opt.disabled) el.setAttribute('aria-disabled', 'true');
            el.textContent = opt.label;
            listbox.appendChild(el);
            return el;
        });
        renderValue();
        syncDisabled();
    };

    const setActive = (index) => {
        if (index < 0 || index >= state.optionEls.length) return;
        state.activeIndex = index;
        state.optionEls.forEach((el, i) => el.classList.toggle('is-active', i === index));
        const activeEl = state.optionEls[index];
        trigger.setAttribute('aria-activedescendant', activeEl.id);
        activeEl.scrollIntoView({ block: 'nearest' });
    };

    const commit = (value) => {
        if (select.value === value) return;
        select.value = value;
        state.optionEls.forEach((el) => {
            el.setAttribute('aria-selected', el.dataset.value === value ? 'true' : 'false');
        });
        renderValue();
        select.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const open = () => {
        if (state.open || select.disabled) return;
        state.open = true;
        listbox.hidden = false;
        wrapper.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
        const selectedIndex = state.options.findIndex((o) => o.value === select.value);
        setActive(selectedIndex >= 0 ? selectedIndex : 0);
        doc.addEventListener('pointerdown', onOutsidePointer, true);
    };

    const close = ({ focusTrigger = false } = {}) => {
        if (!state.open) return;
        state.open = false;
        listbox.hidden = true;
        wrapper.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.removeAttribute('aria-activedescendant');
        doc.removeEventListener('pointerdown', onOutsidePointer, true);
        if (focusTrigger) trigger.focus();
    };

    const moveActive = (delta) => {
        let index = state.activeIndex;
        for (let step = 0; step < state.optionEls.length; step += 1) {
            index = (index + delta + state.optionEls.length) % state.optionEls.length;
            if (!state.options[index].disabled) { setActive(index); return; }
        }
    };

    const commitActive = () => {
        const opt = state.options[state.activeIndex];
        if (opt && !opt.disabled) commit(opt.value);
        close({ focusTrigger: true });
    };

    function onOutsidePointer(event) {
        if (!wrapper.contains(event.target)) close();
    }

    const onTypeahead = (char) => {
        const now = Date.now();
        const expired = now - state.typeaheadAt > 600;
        state.typeahead = (expired ? '' : state.typeahead) + char.toLowerCase();
        state.typeaheadAt = now;
        const match = state.options.findIndex((o) => o.label.toLowerCase().startsWith(state.typeahead));
        if (match >= 0) setActive(match);
    };

    const onTriggerKeydown = (event) => {
        if (select.disabled) return;
        const { key } = event;
        if (!state.open) {
            if (key === 'Enter' || key === ' ' || key === 'ArrowDown' || key === 'ArrowUp') {
                event.preventDefault();
                open();
            }
            return;
        }
        switch (key) {
        case 'ArrowDown':
            event.preventDefault();
            moveActive(1);
            break;
        case 'ArrowUp':
            event.preventDefault();
            moveActive(-1);
            break;
        case 'Home':
            event.preventDefault();
            setActive(0);
            break;
        case 'End':
            event.preventDefault();
            setActive(state.optionEls.length - 1);
            break;
        case 'Enter':
        case ' ':
            event.preventDefault();
            commitActive();
            break;
        case 'Escape':
            event.preventDefault();
            close({ focusTrigger: true });
            break;
        case 'Tab':
            close();
            break;
        default:
            if (key.length === 1) onTypeahead(key);
        }
    };

    trigger.addEventListener('click', () => (state.open ? close() : open()));
    trigger.addEventListener('keydown', onTriggerKeydown);
    listbox.addEventListener('pointerover', (event) => {
        const optionEl = event.target.closest('.cosmic-select__option');
        if (optionEl) setActive(Number(optionEl.dataset.index));
    });
    listbox.addEventListener('click', (event) => {
        const optionEl = event.target.closest('.cosmic-select__option');
        if (!optionEl || state.options[Number(optionEl.dataset.index)]?.disabled) return;
        commit(optionEl.dataset.value);
        close({ focusTrigger: true });
    });
    // Keep the trigger label in sync if code changes the native value/disabled.
    select.addEventListener('change', renderValue);

    buildOptions();

    const api = {
        element: wrapper,
        refresh: () => { close(); buildOptions(); },
        syncDisabled,
        destroy: () => {
            close();
            select.removeEventListener('change', renderValue);
            select.classList.remove('cosmic-select__native');
            select.removeAttribute('aria-hidden');
            select.removeAttribute('tabindex');
            delete select.dataset.cosmicEnhanced;
            wrapper.parentNode?.insertBefore(select, wrapper);
            wrapper.remove();
        },
    };
    select._cosmicSelect = api;
    return api;
}

/**
 * Enhance a native <select> into a horizontal segmented (radiogroup) control.
 * Best for 2-4 short, mutually-exclusive options (player count, mode, human/bot).
 */
export function enhanceSegmented(select, { label = null } = {}) {
    if (!isEnhanceable(select)) return null;
    select.dataset.cosmicEnhanced = 'true';

    const doc = select.ownerDocument;
    const accessibleName = resolveAccessibleName(select, label);

    const group = doc.createElement('div');
    group.className = 'cosmic-segmented';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', accessibleName);

    select.classList.add('cosmic-select__native');
    select.setAttribute('aria-hidden', 'true');
    select.setAttribute('tabindex', '-1');
    select.parentNode.insertBefore(group, select);
    group.appendChild(select);

    let segments = [];

    const renderChecked = () => {
        segments.forEach((seg) => {
            const checked = seg.dataset.value === select.value;
            seg.setAttribute('aria-checked', checked ? 'true' : 'false');
            seg.classList.toggle('is-checked', checked);
            seg.tabIndex = checked ? 0 : -1;
        });
        group.classList.toggle('is-disabled', select.disabled);
    };

    const commit = (value) => {
        if (select.value !== value) {
            select.value = value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        renderChecked();
    };

    const build = () => {
        segments.forEach((seg) => seg.remove());
        segments = readOptions(select).map((opt) => {
            const seg = doc.createElement('button');
            seg.type = 'button';
            seg.className = 'cosmic-segmented__seg';
            seg.setAttribute('role', 'radio');
            seg.dataset.value = opt.value;
            seg.textContent = opt.label;
            seg.disabled = opt.disabled;
            seg.addEventListener('click', () => commit(opt.value));
            group.appendChild(seg);
            return seg;
        });
        renderChecked();
    };

    group.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const dir = (event.key === 'ArrowRight' || event.key === 'ArrowDown') ? 1 : -1;
        const current = segments.findIndex((seg) => seg.dataset.value === select.value);
        const next = (current + dir + segments.length) % segments.length;
        commit(segments[next].dataset.value);
        segments[next].focus();
    });

    select.addEventListener('change', renderChecked);
    build();

    const api = {
        element: group,
        refresh: () => build(),
        syncDisabled: renderChecked,
        destroy: () => {
            select.removeEventListener('change', renderChecked);
            select.classList.remove('cosmic-select__native');
            delete select.dataset.cosmicEnhanced;
            group.parentNode?.insertBefore(select, group);
            group.remove();
        },
    };
    select._cosmicSelect = api;
    return api;
}

/**
 * NON-DESTRUCTIVE enhancement for game-wide use. Unlike `enhanceSelect`, this does
 * NOT wrap/replace the native <select> — its closed box keeps the host menu's exact
 * styling and layout. It only suppresses the native OS popup on mouse-open and shows
 * a themed listbox PORTALED to <body> (position: fixed, so it is never clipped by a
 * menu's overflow) that the cosmic cursor can paint over. Keyboard/screen-reader use
 * stays fully native (the freeze is a pointer-only problem), so accessibility is
 * unchanged. This is safe to apply to every menu without breaking layouts.
 */
export function enhanceSelectOverlay(select) {
    if (!isEnhanceable(select)) return null;
    select.dataset.cosmicEnhanced = 'true';
    select.dataset.cosmicMode = 'overlay';

    const doc = select.ownerDocument;
    let overlay = null;
    let open = false;
    let cleanupOpen = null;

    const closeOverlay = () => {
        if (!open) return;
        open = false;
        select.classList.remove('cosmic-open');
        cleanupOpen?.();
        cleanupOpen = null;
        overlay?.remove();
        overlay = null;
    };

    const commit = (value) => {
        if (select.value !== value) {
            select.value = value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
    };

    const position = () => {
        if (!overlay) return;
        const rect = select.getBoundingClientRect();
        overlay.style.minWidth = `${rect.width}px`;
        overlay.style.left = `${rect.left}px`;
        const overlayHeight = overlay.offsetHeight;
        const spaceBelow = window.innerHeight - rect.bottom;
        const openUp = spaceBelow < overlayHeight + 8 && rect.top > spaceBelow;
        overlay.style.top = openUp
            ? `${Math.max(4, rect.top - overlayHeight - 4)}px`
            : `${rect.bottom + 4}px`;
    };

    const openOverlay = () => {
        if (open || select.disabled) return;
        open = true;
        select.classList.add('cosmic-open');
        overlay = doc.createElement('div');
        overlay.className = 'cosmic-select__listbox cosmic-select__overlay';
        overlay.setAttribute('role', 'listbox');
        // The native <select> remains the accessible control; the overlay is a
        // pointer-only visual layer, so hide it from the a11y tree.
        overlay.setAttribute('aria-hidden', 'true');

        readOptions(select).forEach((opt) => {
            const el = doc.createElement('div');
            el.className = 'cosmic-select__option';
            el.setAttribute('role', 'option');
            el.dataset.value = opt.value;
            el.setAttribute('aria-selected', opt.value === select.value ? 'true' : 'false');
            if (opt.disabled) el.setAttribute('aria-disabled', 'true');
            el.textContent = opt.label;
            el.addEventListener('pointerenter', () => {
                overlay.querySelectorAll('.is-active').forEach((o) => o.classList.remove('is-active'));
                el.classList.add('is-active');
            });
            el.addEventListener('mousedown', (event) => {
                event.preventDefault(); // keep focus on the select, avoid a blur race
                if (!opt.disabled) commit(opt.value);
                closeOverlay();
            });
            overlay.appendChild(el);
        });

        doc.body.appendChild(overlay);
        position();
        overlay.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });

        const onOutside = (event) => {
            if (event.target !== select && !overlay.contains(event.target)) closeOverlay();
        };
        // Scrolling INSIDE the option list must scroll it, not dismiss it. Scrolling
        // an ancestor moves the anchor, so reposition the portaled list to follow the
        // select; only close if the select scrolls out of the viewport.
        const onScroll = (event) => {
            if (overlay && (event.target === overlay || overlay.contains(event.target))) return;
            const rect = select.getBoundingClientRect();
            if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
                closeOverlay();
                return;
            }
            position();
        };
        const onResize = () => position();
        doc.addEventListener('pointerdown', onOutside, true);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        cleanupOpen = () => {
            doc.removeEventListener('pointerdown', onOutside, true);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
        };
    };

    const onMouseDown = (event) => {
        event.preventDefault(); // suppress the native OS popup
        select.focus();
        if (open) closeOverlay();
        else openOverlay();
    };
    select.addEventListener('mousedown', onMouseDown);
    // Hand keyboard back to the native control (no OS popup involved → no freeze).
    select.addEventListener('keydown', closeOverlay);
    select.addEventListener('blur', closeOverlay);

    const api = {
        element: select,
        refresh: closeOverlay,
        syncDisabled: () => {},
        destroy: () => {
            closeOverlay();
            select.removeEventListener('mousedown', onMouseDown);
            select.removeEventListener('keydown', closeOverlay);
            select.removeEventListener('blur', closeOverlay);
            delete select.dataset.cosmicEnhanced;
            delete select.dataset.cosmicMode;
        },
    };
    select._cosmicSelect = api;
    return api;
}

/**
 * Enhance every enhanceable <select> at or under `root` (the node itself plus
 * descendants) with the NON-DESTRUCTIVE overlay (safe for any menu — no layout
 * change). Skips multi-selects, `[data-cosmic-skip]`, and already-enhanced selects
 * (e.g. the local-MP modal's purpose-built destructive CosmicSelects).
 */
export function enhanceAllSelects(root) {
    if (!root) return [];
    const selects = [];
    if (root.tagName === 'SELECT') selects.push(root);
    if (typeof root.querySelectorAll === 'function') {
        selects.push(...root.querySelectorAll('select'));
    }
    return selects.filter(isEnhanceable).map((select) => enhanceSelectOverlay(select));
}

let cosmicSelectObserver = null;

/**
 * Install game-wide CosmicSelect: enhance every existing <select>, then watch the
 * DOM and enhance any <select> added later (modals, lobby, hub, etc.) so the cosmic
 * cursor works over EVERY dropdown — current and future — with no per-screen work.
 * Idempotent. Returns the observer (or null when unsupported).
 */
export function installCosmicSelects({ root = document, observe = true } = {}) {
    if (typeof document === 'undefined') return null;
    enhanceAllSelects(root === document ? document.body || document : root);

    if (observe && typeof MutationObserver === 'function' && !cosmicSelectObserver && document.body) {
        cosmicSelectObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                // Enhance any <select> added later (modals, lobby, hub, …).
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) enhanceAllSelects(node);
                });
                // If an already-enhanced select's <option>s changed (dynamically
                // populated dropdowns), refresh its themed view to match.
                const { target } = mutation;
                if (target?.tagName === 'SELECT' && target.dataset.cosmicEnhanced === 'true') {
                    target._cosmicSelect?.refresh();
                }
            });
        });
        cosmicSelectObserver.observe(document.body, { childList: true, subtree: true });
    }
    return cosmicSelectObserver;
}

export function uninstallCosmicSelects() {
    cosmicSelectObserver?.disconnect();
    cosmicSelectObserver = null;
}
