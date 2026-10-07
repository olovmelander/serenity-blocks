/** Mount an outcome view with cancellation owned by its exact level attempt. */
export function mountOdysseyOutcome(modal, session, onCancel) {
    if (session) {
        session.disposeOutcome?.();
        session.disposeOutcome = () => {
            modal.dispose?.();
            onCancel();
        };
    }
    document.body.appendChild(modal);
}
