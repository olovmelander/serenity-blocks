import { URL_PARAMETER_CATALOG } from './catalog.js';

const asText = (value) => (Array.isArray(value) ? value.join(' · ') : String(value ?? ''));
const escapeHtml = (value) => asText(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

export function filterUrlParameters(catalog, query = '', category = '') {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return catalog.filter((entry) => {
        if (category && entry.category !== category) return false;
        const searchable = [entry.name, entry.description, entry.scope, entry.category, entry.notes]
            .map(asText).join(' ').toLocaleLowerCase();
        return terms.every((term) => searchable.includes(term));
    });
}

export function renderUrlParameter(entry) {
    const example = asText(entry.example).replace(/^[?&]/, '');
    const sources = (entry.sources || []).map((source) => `<li><code>${escapeHtml(source)}</code></li>`).join('');
    return `<li class="url-reference__item">
        <article aria-label="${escapeHtml(entry.name)}">
            <div class="url-reference__item-heading">
                <h3><code>${escapeHtml(entry.name)}</code></h3>
                <span class="url-reference__category">${escapeHtml(entry.category)}</span>
            </div>
            <p class="url-reference__description">${escapeHtml(entry.description)}</p>
            <p class="url-reference__scope"><strong>Applies to</strong> ${escapeHtml(entry.scope)}</p>
            <details class="url-reference__details">
                <summary tabindex="0">Values, default and examples
                    <span class="url-reference__sr"> for ${escapeHtml(entry.name)}</span></summary>
                <dl>
                    <div><dt>Accepted values</dt><dd>${escapeHtml(entry.values)}</dd></div>
                    <div><dt>Default</dt><dd>${escapeHtml(entry.defaultValue)}</dd></div>
                    <div><dt>First parameter</dt><dd><code>?${escapeHtml(example)}</code></dd></div>
                    <div><dt>Additional parameter</dt><dd><code>&amp;${escapeHtml(example)}</code></dd></div>
                </dl>
                ${entry.notes ? `<p class="url-reference__notes">${escapeHtml(entry.notes)}</p>` : ''}
                ${sources ? `<p class="url-reference__source-label">Source references</p>
                    <ul class="url-reference__sources">${sources}</ul>` : ''}
            </details>
        </article>
    </li>`;
}

/** Read-only development reference; no settings, location or storage writes. */
export class UrlParametersView {
    constructor(container, { catalog = URL_PARAMETER_CATALOG, signal } = {}) {
        this.container = container;
        this.catalog = catalog;
        this.controller = new AbortController();
        signal?.addEventListener('abort', () => this.destroy(), { once: true });
        if (signal?.aborted) { this.destroy(); return; }
        this.render();
        const options = { signal: this.controller.signal };
        this.search.addEventListener('input', () => this.updateResults(), options);
        this.category.addEventListener('change', () => this.updateResults(), options);
        this.clear.addEventListener('click', () => {
            this.search.value = '';
            this.category.value = '';
            this.updateResults();
            this.search.focus();
        }, options);
        this.updateResults();
    }

    render() {
        const categories = [...new Set(this.catalog.map((entry) => entry.category))].sort();
        this.container.innerHTML = `<section class="url-reference" aria-labelledby="url-reference-title">
            <header class="url-reference__intro">
                <p class="sb-eyebrow">Temporary development reference</p>
                <h2 id="url-reference-title">URL parameters</h2>
                <p>Browse the game's existing URL options.
                    This reference does not change settings or apply parameters.</p>
                <p>Add <code>?name=value</code> after the page address for the first parameter, then
                    <code>&amp;another=value</code> for each additional parameter.
                    Keep them before any <code>#</code> fragment.</p>
                <p>Reload the page after editing the URL. To remove an override, delete its parameter and reload.
                    Check each entry's scope: theme and tool options only work in their named context.
                    Some names appear more than once when their behavior differs by context.</p>
            </header>
            <div class="url-reference__filters">
                <div class="url-reference__field">
                    <label for="url-parameter-search">Search parameters</label>
                    <input id="url-parameter-search" class="url-reference__search" type="search"
                        autocomplete="off" spellcheck="false" placeholder="Name, purpose, theme or tool"
                        aria-controls="url-parameter-results" />
                </div>
                <div class="url-reference__field">
                    <label for="url-parameter-category">Category</label>
                    <select id="url-parameter-category" class="setting-select" aria-controls="url-parameter-results">
                        <option value="">All categories</option>
                        ${categories.map((category) => `<option value="${escapeHtml(category)}">
                            ${escapeHtml(category)}</option>`).join('')}
                    </select>
                </div>
                <button class="sb-btn sb-btn--quiet" type="button" data-url-reference-clear>Clear filters</button>
            </div>
            <p class="url-reference__count" data-url-reference-count
                role="status" aria-live="polite" aria-atomic="true"></p>
            <ul class="url-reference__results" id="url-parameter-results"></ul>
            <p class="url-reference__empty" data-url-reference-empty hidden>
                No parameters match. Try a theme name or clear the filters.</p>
        </section>`;
        this.search = this.container.querySelector('#url-parameter-search');
        this.category = this.container.querySelector('#url-parameter-category');
        this.clear = this.container.querySelector('[data-url-reference-clear]');
        this.results = this.container.querySelector('#url-parameter-results');
        this.count = this.container.querySelector('[data-url-reference-count]');
        this.empty = this.container.querySelector('[data-url-reference-empty]');
    }

    updateResults() {
        if (this.controller.signal.aborted) return;
        const entries = filterUrlParameters(this.catalog, this.search.value, this.category.value);
        this.results.innerHTML = entries.map(renderUrlParameter).join('');
        this.count.textContent = `${entries.length} of ${this.catalog.length} parameter entries`;
        this.empty.hidden = entries.length > 0;
        this.clear.disabled = !this.search.value && !this.category.value;
    }

    destroy() { this.controller.abort(); }
}
