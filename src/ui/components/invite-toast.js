/**
 * InviteToastManager
 *
 * Lightweight toast UI for Steam invites.
 */

class InviteToastManager {
    constructor() {
        this.container = null;
        this.active = new Map();
    }

    _ensureContainer() {
        if (this.container) return;
        this.container = document.createElement('div');
        this.container.id = 'invite-toast-container';
        document.body.appendChild(this.container);
    }

    showInvite(options = {}) {
        this._ensureContainer();

        const {
            id = `invite-${Date.now()}`,
            title = 'Game Invite',
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

        const titleEl = document.createElement('div');
        titleEl.className = 'invite-toast-title';
        titleEl.textContent = title;

        const messageEl = document.createElement('div');
        messageEl.className = 'invite-toast-message';
        messageEl.textContent = message;

        const actionsEl = document.createElement('div');
        actionsEl.className = 'invite-toast-actions';

        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'invite-toast-btn invite-toast-accept';
        acceptBtn.textContent = acceptText;

        const declineBtn = document.createElement('button');
        declineBtn.className = 'invite-toast-btn invite-toast-decline';
        declineBtn.textContent = declineText;

        actionsEl.appendChild(acceptBtn);
        actionsEl.appendChild(declineBtn);

        toast.appendChild(titleEl);
        toast.appendChild(messageEl);
        toast.appendChild(actionsEl);

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
