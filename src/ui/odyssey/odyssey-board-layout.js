/** Odyssey gameplay opts into the shared solo well; the mode owns its observers. */
const layouts = new WeakMap();

const noLayout = () => ({ update() {}, cleanup() {} });

/**
 * Own only the presentation attributes on the shared gameplay stage. Danger comes
 * from draw.updateStats and off-floor from InfinityMinimap, as in the solo modes.
 * @param {object} options
 * @returns {{ update: Function, cleanup: Function }}
 */
export function mountOdysseyBoardLayout({
    stage = globalThis.document?.querySelector('.single-player-stage'),
    container = globalThis.document?.getElementById('single-player-container'),
    levelConfig = null,
    mechanics = levelConfig?.mechanics,
} = {}) {
    if (!stage) return noLayout();
    layouts.get(stage)?.cleanup();
    let disposed = false;
    let configuration = mechanics || {};
    let layout;
    const ownsStage = () => !disposed && layouts.get(stage) === layout;
    const update = (options = {}) => {
        if (!ownsStage()) return;
        if (options.mechanics || options.levelConfig) {
            configuration = options.mechanics || options.levelConfig.mechanics || {};
        }
        const tall = Number(configuration.board?.rows) >= 30;
        let flavor = tall ? 'tower' : 'standard';
        if (configuration.versus) flavor = 'duel';
        stage.dataset.board = 'well';
        stage.dataset.odysseyBoard = flavor;
        stage.dataset.odysseyPreviews = '3';
        if (typeof options.danger === 'boolean') stage.toggleAttribute('data-danger', options.danger);
        if (typeof options.offFloor === 'boolean') container?.toggleAttribute('data-off-floor', options.offFloor);
    };
    const cleanup = () => {
        if (!ownsStage()) return;
        disposed = true;
        layouts.delete(stage);
        delete stage.dataset.odysseyBoard;
        delete stage.dataset.odysseyPreviews;
        if (stage.dataset.board === 'well') delete stage.dataset.board;
        stage.removeAttribute('data-danger');
        container?.removeAttribute('data-off-floor');
    };
    layout = { update, cleanup };
    layouts.set(stage, layout);
    stage.removeAttribute('data-danger');
    container?.removeAttribute('data-off-floor');
    update();
    return layout;
}
