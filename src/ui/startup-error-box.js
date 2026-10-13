/**
 * The last-resort box when bootstrap() throws after the startup shell is gone. The
 * message is text, not markup, and a release build has no console to point at, so it
 * offers a restart instead (audit BOOT-02).
 * @param {unknown} error
 * @returns {HTMLElement}
 */
export function showStartupErrorBox(error) {
    const box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.style.cssText = [
        'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%)',
        'background: rgba(239, 68, 68, 0.9); color: white; padding: 20px; border-radius: 8px',
        'font-family: Arial, sans-serif; max-width: 500px; z-index: 10000',
    ].join('; ');
    const title = document.createElement('h2');
    title.style.cssText = 'margin: 0 0 10px 0;';
    title.textContent = 'Failed to Start Game';
    const message = document.createElement('p');
    message.style.cssText = 'margin: 0; overflow-wrap: anywhere;';
    message.textContent = (error instanceof Error ? error.message : '') || String(error);
    const restart = document.createElement('button');
    restart.type = 'button';
    restart.textContent = 'Restart';
    restart.style.cssText = [
        'margin-top: 14px; padding: 6px 18px; border: 1px solid white; border-radius: 6px',
        'background: transparent; color: white; font: inherit; cursor: pointer',
    ].join('; ');
    restart.addEventListener('click', () => window.location.reload());
    box.append(title, message, restart);
    document.body.appendChild(box);
    restart.focus();
    return box;
}
