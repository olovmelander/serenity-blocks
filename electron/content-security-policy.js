import { createHash } from 'crypto';

const GOOGLE_FONT_ORIGINS = 'https://fonts.googleapis.com https://fonts.gstatic.com';

export function extractInlineScriptHashes(html) {
    const hashes = [];
    const re = /<script>([\s\S]*?)<\/script>/g;
    let match = re.exec(html);

    while (match !== null) {
        const digest = createHash('sha256').update(match[1], 'utf8').digest('base64');
        hashes.push(`'sha256-${digest}'`);
        match = re.exec(html);
    }

    return hashes;
}

function normalizeHashes(inlineScriptHashes = []) {
    if (Array.isArray(inlineScriptHashes)) {
        return inlineScriptHashes.filter(Boolean).join(' ');
    }

    return String(inlineScriptHashes || '').trim();
}

export function createContentSecurityPolicy({
    mode = 'packaged',
    inlineScriptHashes = [],
} = {}) {
    const normalizedMode = mode === 'dev' ? 'dev' : 'packaged';
    const hashes = normalizeHashes(inlineScriptHashes);

    if (normalizedMode === 'dev') {
        return [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' http://localhost:5173",
            `style-src 'self' 'unsafe-inline' ${GOOGLE_FONT_ORIGINS.split(' ')[0]}`,
            `font-src 'self' data: ${GOOGLE_FONT_ORIGINS.split(' ')[1]}`,
            "img-src 'self' data: blob:",
            "media-src 'self' data: blob:",
            `connect-src 'self' data: blob: http://localhost:5173 ws://localhost:5173 ${GOOGLE_FONT_ORIGINS}`,
            "worker-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'none'",
            "frame-src 'none'",
        ].join('; ');
    }

    return [
        "default-src 'self' file:",
        `script-src 'self' file: 'wasm-unsafe-eval'${hashes ? ` ${hashes}` : ''}`,
        `style-src 'self' file: 'unsafe-inline' ${GOOGLE_FONT_ORIGINS.split(' ')[0]}`,
        `font-src 'self' file: data: ${GOOGLE_FONT_ORIGINS.split(' ')[1]}`,
        "img-src 'self' file: data: blob:",
        "media-src 'self' file: data: blob:",
        `connect-src 'self' file: data: blob: ${GOOGLE_FONT_ORIGINS}`,
        "worker-src 'self' file: blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-src 'none'",
    ].join('; ');
}
