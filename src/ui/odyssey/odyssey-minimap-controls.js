import { InfinityMinimap } from '../infinity/InfinityMinimap.js';

/** Bind exploration to the attempt that owns this map, including its pause. */
export function bindOdysseyMinimapControls(minimap, options) {
    let disposed = false;
    let pausedByExploration = false;
    const isActive = () => !disposed && options.isActive();
    const start = () => {
        if (!isActive() || !options.isRunning() || options.isPaused()) return;
        options.pause();
        pausedByExploration = options.isPaused();
    };
    const end = () => {
        const shouldResume = pausedByExploration;
        pausedByExploration = false;
        if (shouldResume && isActive() && options.isRunning() && options.isPaused()) {
            options.resume();
        }
    };
    const jump = (event) => {
        const centerRow = event.detail?.targetRow;
        const scene = options.getScene();
        if (!isActive() || !Number.isFinite(centerRow) || !scene?.cameraSettings) return;
        const visibleRows = scene.cameraSettings.visibleRows || 20;
        const maxTopRow = Math.max(0, options.getTotalRows() - visibleRows);
        const topRow = Math.max(0, Math.min(maxTopRow, centerRow - Math.floor(visibleRows / 2)));
        scene.updateCameraPosition(topRow, true);
        options.onViewChange();
    };
    const handlers = [
        ['minimap-exploration-start', start],
        ['minimap-exploration-end', end],
        ['minimap-jump', jump],
    ];
    handlers.forEach(([name, handler]) => minimap.container.addEventListener(name, handler));
    return () => {
        disposed = true;
        pausedByExploration = false;
        handlers.forEach(([name, handler]) => minimap.container.removeEventListener(name, handler));
    };
}

/** Create the retained tall-board observer; gameplay owns the supplied callbacks. */
export function createOdysseyMinimap(options) {
    const minimap = new InfinityMinimap({ totalRows: options.rows, columns: options.columns });
    minimap.show();
    Object.assign(minimap.container.style, {
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(calc(var(--board-width) / 2 + 230px), -50%)',
        margin: '0',
        zIndex: '5',
    });
    minimap.disposeControls = bindOdysseyMinimapControls(minimap, options);
    return minimap;
}
