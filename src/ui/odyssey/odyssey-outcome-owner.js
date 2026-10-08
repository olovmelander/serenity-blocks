/** Mount an outcome view with cancellation owned by its exact level attempt. */
export function mountOdysseyOutcome(modal, session, onCancel) {
    let disposeOutcome = null;
    if (session) {
        session.disposeOutcome?.();
        disposeOutcome = () => {
            modal.dispose?.();
            onCancel();
        };
        session.disposeOutcome = disposeOutcome;
    }
    document.body.appendChild(modal);
    // A continuing portal transfers to journey ownership before the old attempt
    // is disposed. Never detach a replacement attempt's outcome by accident.
    return () => {
        if (session?.disposeOutcome === disposeOutcome) session.disposeOutcome = null;
    };
}
