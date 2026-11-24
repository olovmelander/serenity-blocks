import { describe, expect, it } from 'vitest';
import { byteRange, onRequest } from '../../cloudflare/byte-range.js';
import { onRequest as music } from '../../cloudflare/functions/assets/music/[[path]].js';
import { onRequest as audio } from '../../cloudflare/functions/assets/audio/[[path]].js';

const SONG = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);

function ask(headers = {}, { method = 'GET', answer } = {}) {
    const request = new Request('https://x.test/assets/music/song.mp3', { method, headers });
    return onRequest({
        request,
        next: async () => answer ?? new Response(method === 'HEAD' ? null : SONG, {
            status: 200, headers: { 'Content-Type': 'audio/mpeg', ETag: '"a"', 'Cache-Control': 'public, max-age=0' },
        }),
    });
}
const bytesOf = async (res) => new Uint8Array(await res.arrayBuffer());

describe('byte ranges on Cloudflare Pages', () => {
    it('reads the ranges media elements send', () => {
        expect(byteRange('bytes=0-', 1000)).toEqual([0, 999]);
        expect(byteRange('bytes=0-1', 1000)).toEqual([0, 1]);
        expect(byteRange('bytes=700-5000', 1000)).toEqual([700, 999]);
        expect(byteRange('bytes=-100', 1000)).toEqual([900, 999]);
        expect(byteRange('bytes=-5000', 1000)).toEqual([0, 999]);
        expect(byteRange('bytes=1000-', 1000)).toBeNull();
        expect(byteRange('bytes=-0', 1000)).toBeNull();
        ['bytes=-', 'bytes=5-2', 'bytes=0-1,4-5', 'items=0-1', '', null].forEach((h) => {
            expect(byteRange(h, 1000), String(h)).toBeUndefined();
        });
    });

    it('answers a range with that part of the file', async () => {
        const res = await ask({ Range: 'bytes=100-199' });
        expect(res.status).toBe(206);
        expect(res.headers.get('Content-Range')).toBe('bytes 100-199/1000');
        expect(res.headers.get('Content-Length')).toBe('100');
        expect(res.headers.get('Accept-Ranges')).toBe('bytes');
        expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
        expect(res.headers.get('ETag')).toBe('"a"');
        expect(await bytesOf(res)).toEqual(SONG.slice(100, 200));
    });

    it('answers the open range a song starts with', async () => {
        const res = await ask({ Range: 'bytes=0-' });
        expect(res.status).toBe(206);
        expect(res.headers.get('Content-Range')).toBe('bytes 0-999/1000');
        expect(await bytesOf(res)).toEqual(SONG);
    });

    it('sends the whole file when no range is asked for, and says ranges are there', async () => {
        const res = await ask();
        expect(res.status).toBe(200);
        expect(res.headers.get('Accept-Ranges')).toBe('bytes');
        expect(await bytesOf(res)).toEqual(SONG);
        expect((await ask({ Range: 'bytes=0-1' }, { method: 'HEAD' })).status).toBe(200);
    });

    it('sends the whole file when the range is of another version, or is not one plain range', async () => {
        for (const headers of [{ Range: 'bytes=0-9', 'If-Range': '"b"' }, { Range: 'bytes=0-1,4-5' }]) {
            // eslint-disable-next-line no-await-in-loop
            const res = await ask(headers);
            expect(res.status).toBe(200);
            // eslint-disable-next-line no-await-in-loop
            expect(await bytesOf(res)).toEqual(SONG);
        }
        expect((await ask({ Range: 'bytes=0-9', 'If-Range': '"a"' })).status).toBe(206);
    });

    it('refuses a range past the end', async () => {
        const res = await ask({ Range: 'bytes=1000-' });
        expect(res.status).toBe(416);
        expect(res.headers.get('Content-Range')).toBe('bytes */1000');
    });

    it('lets everything else through as it is', async () => {
        const answers = [
            new Response(null, { status: 304 }),
            new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
            new Response(SONG.slice(0, 2), { status: 206, headers: { 'Content-Type': 'audio/mpeg' } }),
        ];
        for (const answer of answers) {
            // eslint-disable-next-line no-await-in-loop
            expect(await ask({ Range: 'bytes=0-1' }, { answer })).toBe(answer);
        }
    });

    it('covers the music and the voices', () => {
        expect(music).toBe(onRequest);
        expect(audio).toBe(onRequest);
    });
});
