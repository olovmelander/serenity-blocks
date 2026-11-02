/**
 * InviteToastManager
 *
 * Keystone toast for Steam invites: stacked bottom-centre with the other toasts,
 * announced as an alert, with focusable Join / Decline buttons. A controller answers with
 * A and B wherever it is not playing a falling-block game (gamepad-controller.js
 * processInviteToast), which marks the container `data-pad-answers` "buttons" or "pause";
 * the glyphs follow it. Styles: `.invite-toast*` in public/styles/keystone-multiplayer.css.
 *
 * This module loads at startup (steam-invite-manager.js), so it also installs the
 * `serenity:toast` listener for the general toasts (./toast.js).
 */
import './toast.js';

/** A controller glyph keycap (shown only while a pad is the input: keystone.css). */
function padGlyph(label) {
    const cap = document.createElement('kbd');
    cap.className = 'sb-kbd';
    cap.setAttribute('data-pad', '');
    cap.setAttribute('aria-hidden', 'true');
    cap.textContent = label;
    return cap;
}

class InviteToastManager {
    constructor() {
        this.container = null;
        this.active = new Map();
    }

    _ensureContainer() {
        if (this.container?.isConnected) return;
        this.container = document.createElement('div');
        this.container.id = 'invite-toast-container';
        document.body.appendChild(this.container);
    }

    showInvite(options = {}) {
        this._ensureContainer();

        const {
            id = `invite-${Date.now()}`,
            title = 'Game invite',
            message = 'You received a game invite.',
            acceptText = 'Join',
            declineText = 'Decline',
            timeoutMs = 10000,
            lowKey = false,
            onAccept = null,
            onDecline = null,
        } = options;

        if (this.active.has(id)) {
            this.dismiss(id);
        }

        const toast = document.createElement('div');
        toast.className = `invite-toast${lowKey ? ' low-key' : ''}`;
        toast.dataset.toastId = id;
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-labelledby', `${id}-title`);
        toast.setAttribute('aria-describedby', `${id}-message`);

        const titleEl = document.createElement('div');
        titleEl.className = 'invite-toast-title';
        titleEl.id = `${id}-title`;
        titleEl.textContent = title;

        const messageEl = document.createElement('div');
        messageEl.className = 'invite-toast-message';
        messageEl.id = `${id}-message`;
        messageEl.textContent = message;

        const actionsEl = document.createElement('div');
        actionsEl.className = 'invite-toast-actions';

        const declineBtn = document.createElement('button');
        declineBtn.type = 'button';
        declineBtn.className = 'invite-toast-btn invite-toast-decline';
        declineBtn.textContent = declineText;
        declineBtn.appendChild(padGlyph('B'));

        const acceptBtn = document.createElement('button');
        acceptBtn.type = 'button';
        acceptBtn.className = 'invite-toast-btn invite-toast-accept';
        acceptBtn.textContent = acceptText;
        acceptBtn.appendChild(padGlyph('A'));

        actionsEl.appendChild(declineBtn);
        actionsEl.appendChild(acceptBtn);

        // In play A and B are the game's: the pad answers once Settings is open over it.
        const padNote = document.createElement('p');
        padNote.className = 'invite-toast-padnote';
        padNote.setAttribute('aria-hidden', 'true');
        padNote.append(padGlyph('\u2630'), document.createTextNode(' then A or B to answer'));

        // A thin bar drains while the invite is open (decorative).
        const timerEl = document.createElement('span');
        timerEl.className = 'invite-toast-timer';
        timerEl.setAttribute('aria-hidden', 'true');
        timerEl.style.setProperty('--invite-ms', `${Math.max(1000, timeoutMs)}ms`);

        toast.appendChild(titleEl);
        toast.appendChild(messageEl);
        toast.appendChild(actionsEl);
        toast.appendChild(padNote);
        toast.appendChild(timerEl);

        const cleanup = () => {
            this.dismiss(id);
        };

        acceptBtn.addEventListener('click', () => {
            if (onAccept) {
                onAccept();
            }
            cleanup();
        });

        declineBtn.addEventListener('click', () => {
            if (onDecline) {
                onDecline({ reason: 'declined' });
            }
            cleanup();
        });

        // Keys pressed on the invite belong to it, not to the game underneath.
        toast.addEventListener('keydown', (event) => event.stopPropagation());

        const timeoutId = setTimeout(() => {
            if (onDecline) {
                onDecline({ reason: 'timeout' });
            }
            cleanup();
        }, timeoutMs);

        this.active.set(id, { toast, timeoutId });
        this.container.appendChild(toast);
    }

    dismiss(id) {
        const existing = this.active.get(id);
        if (!existing) return;
        clearTimeout(existing.timeoutId);
        existing.toast?.remove();
        this.active.delete(id);
    }
}

let instance = null;

export function getInviteToastManager() {
    if (!instance) {
        instance = new InviteToastManager();
    }
    return instance;
}

export { InviteToastManager };
export default { getInviteToastManager };
