/**
 * BYTE RANGES ON CLOUDFLARE PAGES. Pages answers a Range request with the whole file (200, no Accept-Ranges). A media
 * element then has nothing to seek in (its `seekable` is empty, so a seek lands at 0) and Safari may not play the
 * file at all. This answers the ranges media elements send, for the game's music and voices.
 */

/**
 * The bytes a Range header asks for of a file.
 * @param {string | null} header
 * @param {number} total the file's length
 * @returns {number[] | null | undefined} [first, last]; null: no such place in the file; undefined: not one plain range
 */
export function byteRange(header, total) {
    const m = /^bytes=(\d*)-(\d*)$/.exec((header || '').trim());
    if (!m || (m[1] === '' && m[2] === '')) return undefined;
    if (m[1] === '') {
        const count = Math.min(Number(m[2]), total);
        return count > 0 ? [total - count, total - 1] : null;
    }
    const first = Number(m[1]);
    if (m[2] !== '' && Number(m[2]) < first) return undefined;
    if (first >= total) return null;
    return [first, m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1)];
}

/**
 * A Pages Function: the asset, or the part of it that was asked for.
 * @param {{ request: Request, next: () => Promise<Response> }} context
 * @returns {Promise<Response>}
 */
export async function onRequest({ request, next }) {
    const asset = await next();
    // Not modified, a redirect, the page that stands in for a missing file, or a 206 of the host's own: as it is.
    if (asset.status !== 200 || !(asset.headers.get('Content-Type') || '').startsWith('audio/')) return asset;

    const headers = new Headers(asset.headers);
    headers.set('Accept-Ranges', 'bytes');
    const asked = request.headers.get('Range');
    const sameAs = request.headers.get('If-Range');
    if (request.method !== 'GET' || !asked || (sameAs && sameAs !== headers.get('ETag'))) {
        return new Response(asset.body, { status: 200, headers });
    }
    const bytes = await asset.arrayBuffer();
    const range = byteRange(asked, bytes.byteLength);
    if (range === undefined) return new Response(bytes, { status: 200, headers });
    if (range === null) {
        headers.set('Content-Range', `bytes */${bytes.byteLength}`);
        headers.delete('Content-Length');
        return new Response(null, { status: 416, headers });
    }
    const [first, last] = range;
    headers.set('Content-Range', `bytes ${first}-${last}/${bytes.byteLength}`);
    headers.set('Content-Length', String(last - first + 1));
    return new Response(bytes.slice(first, last + 1), { status: 206, headers });
}
