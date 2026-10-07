/**
 * Which links the game may hand to the system browser. The game itself opens none
 * today; a link that reaches window.open or a navigation came from injected markup or
 * a compromised renderer, and must not launch the browser at an arbitrary page. Only
 * https on Steam's own hosts passes.
 */
export const ALLOWED_EXTERNAL_HOSTS = Object.freeze([
    'store.steampowered.com',
    'help.steampowered.com',
    'steamcommunity.com',
]);

export function isAllowedExternalUrl(targetUrl) {
    try {
        const parsed = new URL(targetUrl);
        return parsed.protocol === 'https:'
            && !parsed.username
            && !parsed.password
            && ALLOWED_EXTERNAL_HOSTS.includes(parsed.hostname);
    } catch {
        return false;
    }
}
