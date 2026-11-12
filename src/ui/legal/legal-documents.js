/**
 * Settings › Credits & legal: the game's credits, the notices and licences of the code it ships,
 * its privacy page and its copyright statement, read in the game itself, so a player in
 * fullscreen, Big Picture or on a Steam Deck can read them without a browser.
 *
 * The documents are the repository's own Markdown files, which the build places next to
 * index.html: vite.config.js copies CREDITS.md, THIRD_PARTY_NOTICES.md, PRIVACY_POLICY.md and
 * COPYRIGHT.md, and Vite writes THIRD_PARTY_LICENSES.md (the bundled packages' licences). A dev
 * server has the four copied files at the site root and says the licences come with a build.
 *
 * The renderer covers the Markdown these files use (headings, paragraphs, lists, tables, quotes,
 * code, emphasis, links). It escapes all text first and emits only its own tags. Links show their
 * address and are not clickable: the game window never navigates away.
 */

export const LEGAL_DOCUMENTS = Object.freeze([
    Object.freeze({ id: 'credits', label: 'Credits', file: 'CREDITS.md' }),
    Object.freeze({ id: 'notices', label: 'Notices', file: 'THIRD_PARTY_NOTICES.md' }),
    Object.freeze({ id: 'licences', label: 'Licences', file: 'THIRD_PARTY_LICENSES.md' }),
    Object.freeze({ id: 'privacy', label: 'Privacy', file: 'PRIVACY_POLICY.md' }),
    Object.freeze({ id: 'copyright', label: 'Copyright', file: 'COPYRIGHT.md' }),
]);

/** Shipped beside the game's executable, not in the page's folder (CREDITS.md says so too). */
export const ENGINE_LICENCE_NOTE = 'Electron’s and Chromium’s licences ship with the game as '
    + 'LICENSE.electron.txt and LICENSES.chromium.html, in the folder the game is installed in.';

export function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Inline Markdown on already-escaped text: code, links, bold, italics. */
function inline(escaped) {
    const codes = [];
    let out = escaped.replace(/`([^`]+)`/g, (_, code) => {
        codes.push(`<code>${code}</code>`);
        return `\u0000${codes.length - 1}\u0000`;
    });
    out = out
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => (text === url
            ? `<span class="legal-doc__link">${url}</span>`
            : `${text} (<span class="legal-doc__link">${url}</span>)`))
        .replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<span class="legal-doc__link">$1</span>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?=[^*\w]|$)/g, '$1<em>$2</em>');
    // eslint-disable-next-line no-control-regex
    return out.replace(/\u0000(\d+)\u0000/g, (_, index) => codes[Number(index)]);
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function cells(row) {
    return row.trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim());
}

/**
 * Markdown to HTML for the legal documents.
 * @param {string} markdown
 * @returns {string}
 */
export function renderMarkdown(markdown) {
    const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
    const html = [];
    let paragraph = [];
    const flush = () => {
        if (paragraph.length) html.push(`<p>${inline(escapeHtml(paragraph.join(' ')))}</p>`);
        paragraph = [];
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const fence = /^\s*(```|~~~)/.exec(line);
        if (fence) {
            flush();
            const body = [];
            for (i += 1; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i]);
            html.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
            continue;
        }
        const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
        if (heading) {
            flush();
            const level = Math.min(6, heading[1].length + 2);
            html.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`);
            continue;
        }
        if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
            flush();
            html.push('<hr>');
            continue;
        }
        if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[i + 1] ?? '')) {
            flush();
            const head = cells(line).map((cell) => `<th>${inline(escapeHtml(cell))}</th>`).join('');
            const rows = [];
            for (i += 2; i < lines.length && TABLE_ROW.test(lines[i]); i++) {
                rows.push(`<tr>${cells(lines[i]).map((cell) => `<td>${inline(escapeHtml(cell))}</td>`).join('')}</tr>`);
            }
            i -= 1;
            html.push(`<div class="legal-doc__table"><table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`);
            continue;
        }
        if (/^\s*>/.test(line)) {
            flush();
            const quote = [];
            for (; i < lines.length && /^\s*>/.test(lines[i]); i++) quote.push(lines[i].replace(/^\s*>\s?/, ''));
            i -= 1;
            html.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
            continue;
        }
        const item = LIST_ITEM.exec(line);
        if (item) {
            flush();
            const ordered = /\d/.test(item[2]);
            const items = [];
            let current = null;
            for (; i < lines.length; i++) {
                const next = LIST_ITEM.exec(lines[i]);
                if (next) {
                    if (current) items.push(current);
                    current = [next[3]];
                } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && current) {
                    current.push(lines[i].trim());
                } else {
                    break;
                }
            }
            if (current) items.push(current);
            i -= 1;
            const tag = ordered ? 'ol' : 'ul';
            html.push(`<${tag}>${items.map((parts) => `<li>${inline(escapeHtml(parts.join(' ')))}</li>`).join('')}</${tag}>`);
            continue;
        }
        if (!line.trim()) {
            flush();
            continue;
        }
        paragraph.push(line.trim());
    }
    flush();
    return html.join('\n');
}

/**
 * Wire the Credits & legal section: its document buttons and the reader, loaded on first view.
 * @param {HTMLElement} panel  #settings-legal
 * @param {{ fetchText?: (file: string) => Promise<string>, signal?: AbortSignal }} [options]
 * @returns {{ show: (id: string) => Promise<void> }}
 */
export function createLegalDocumentsView(panel, { fetchText = defaultFetchText, signal } = {}) {
    const reader = panel.querySelector('.legal-doc');
    const buttons = [...panel.querySelectorAll('[data-legal-doc]')];
    const cache = new Map();
    let shown = null;

    const show = async (id) => {
        const doc = LEGAL_DOCUMENTS.find((entry) => entry.id === id) || LEGAL_DOCUMENTS[0];
        shown = doc.id;
        buttons.forEach((button) => {
            const active = button.dataset.legalDoc === doc.id;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        reader.setAttribute('aria-busy', 'true');
        if (!cache.has(doc.id)) {
            cache.set(doc.id, fetchText(doc.file).then(renderMarkdown).catch(() => (
                `<p class="setting-help">${escapeHtml(doc.file)} comes with a build of the game.</p>`)));
        }
        const html = await cache.get(doc.id);
        if (signal?.aborted || shown !== doc.id) return;
        const note = doc.id === 'licences' ? `<p class="legal-doc__note">${escapeHtml(ENGINE_LICENCE_NOTE)}</p>` : '';
        reader.innerHTML = html + note;
        reader.scrollTop = 0;
        reader.setAttribute('aria-busy', 'false');
    };

    buttons.forEach((button) => button.addEventListener('click', () => { show(button.dataset.legalDoc); }, { signal }));
    return { show };
}

async function defaultFetchText(file) {
    const response = await fetch(`./${file}`);
    if (!response.ok) throw new Error(`${file}: ${response.status}`);
    const text = await response.text();
    // A dev server answers a missing file with the app's HTML; that is not the document.
    if (/^\s*<!doctype html/i.test(text)) throw new Error(`${file}: not built`);
    return text;
}
