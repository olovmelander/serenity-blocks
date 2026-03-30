/**
 * InviteToastManager
 *
 * Lightweight toast UI for Steam invites.
 */

const INVITE_TOAST_STYLES = `
#invite-toast-container {
    position: fixed;
    right: 24px;
    bottom: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    z-index: 2000;
}

.invite-toast {
    width: 320px;
    background: rgba(14, 18, 28, 0.95);
    border: 1px solid rgba(139, 92, 246, 0.35);
    border-radius: 12px;
    padding: 12px 14px;
    color: white;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(10px);
    animation: invite-toast-in 0.2s ease-out;
}

.invite-toast.low-key {
    border-color: rgba(100, 116, 139, 0.35);
    background: rgba(10, 14, 22, 0.9);
}

.invite-toast-title {
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: rgba(167, 139, 250, 0.9);
}

.invite-toast-message {
    font-size: 13px;
    margin-top: 6px;
    color: rgba(255, 255, 255, 0.9);
}

.invite-toast-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
}

.invite-toast-btn {
    flex: 1;
    border: none;
    border-radius: 8px;
    padding: 8px 10px;
    font-weight: 700;
    cursor: pointer;
    font-size: 12px;
    transition: transform 0.1s ease, box-shadow 0.2s ease;
}

.invite-toast-btn:active {
    transform: scale(0.98);
}

.invite-toast-accept {
    background: linear-gradient(135deg, #8b5cf6, #6366f1);
    color: white;
    box-shadow: 0 6px 14px rgba(99, 102, 241, 0.3);
}

.invite-toast-decline {
    background: rgba(30, 41, 59, 0.8);
    color: rgba(255, 255, 255, 0.8);
}

@keyframes invite-toast-in {
    from { transform: translateY(6px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
}
`;

let stylesInjected = false;

function injectStyles() {
    if (stylesInjected) return;
    const style = document.createElement('style');
    style.id = 'invite-toast-styles';
    style.textContent = INVITE_TOAST_STYLES;
    document.head.appendChild(style);
    stylesInjected = true;
}

class InviteToastManager {
    constructor() {
        this.container = null;
        this.active = new Map();
    }

    _ensureContainer() {
        if (this.container) return;
        injectStyles();
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
