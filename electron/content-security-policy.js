import { createHash } from 'crypto';

// No remote origins: the fonts are self-hosted (public/styles/fonts.css).

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
            "style-src 'self' 'unsafe-inline'",
            "font-src 'self' data:",
            "img-src 'self' data: blob:",
            "media-src 'self' data: blob:",
            "connect-src 'self' data: blob: http://localhost:5173 ws://localhost:5173",
            "worker-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'none'",
            "frame-src 'none'",
        ].join('; ');
    }

    return [
        "default-src 'self' file:",
        `script-src 'self' file: 'wasm-unsafe-eval'${hashes ? ` ${hashes}` : ''}`,
        "style-src 'self' file: 'unsafe-inline'",
        "font-src 'self' file: data:",
        "img-src 'self' file: data: blob:",
        "media-src 'self' file: data: blob:",
        "connect-src 'self' file: data: blob:",
        "worker-src 'self' file: blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-src 'none'",
    ].join('; ');
}
