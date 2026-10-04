import IntroClassicVisual from '../../ui/threejs-intro-renderer.js';
import { IntroClassicProfile } from '../../ui/intro-classic-profile.js';
import { INTRO_PHASES } from '../../ui/intro-visual-config.js';

export const meta = {
    id: 'serenity-warp-classic-profile',
    title: 'Serenity Warp classic profile',
    description: 'Actual WebGL2 intro renderer, shared grade, CPU pieces and scene reactions.',
};

export function create({ renderer, quality = 'High', params }) {
    const hostCanvas = renderer.domElement;
    const previousVisibility = hostCanvas.style.visibility;
    hostCanvas.style.visibility = 'hidden';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    hostCanvas.parentElement.appendChild(canvas);
    const visual = new IntroClassicVisual(canvas);
    if (!visual.init()) throw new Error('Classic intro adapter failed to initialize');
    const profile = new IntroClassicProfile(visual);
    profile.setPerformanceBudget(String(params?.get('quality') || quality).toUpperCase());
    profile.setPhase(INTRO_PHASES.IDLE, true);
    profile.setTetrominoRecyclingPolicy({ mode: 'minimum-residence', minimumResidenceMs: 90_000 });
    const reaction = Number(params?.get('surge') || 0);
    profile.setReactionState({
        surge: reaction,
        glow: reaction,
        bloom: reaction,
        chroma: reaction,
        cameraKick: reaction * 0.2,
        spin: reaction * 0.5,
        scatter: reaction * 0.2,
    });
    // Place actual CPU pieces in frame for the isolated material/grade proof;
    // production keeps its authored off-screen entrance policy.
    const positions = [[-9, 12], [9, 8], [-7, -12], [8, -6], [0, 18], [0, -19]];
    positions.forEach(([x, y]) => {
        visual.spawnTetromino();
        visual.activeTetrominos.at(-1).position.set(x, y, -6);
    });
    let lastTime = null;
    let frameDelta = 1 / 60;
    visual.clock.getDelta = () => frameDelta;
    return {
        update(time) {
            frameDelta = lastTime === null ? 1 / 60 : Math.min(1 / 30, Math.max(0, time - lastTime));
            lastTime = time;
            visual.update(time);
        },
        render() {},
        renderAsync() { return Promise.resolve(); },
        getDiagnostics() {
            return {
                renderer: visual.renderer.constructor.name,
                quality: visual.performanceLevel,
                phase: profile.phase,
                pieces: visual.activeTetrominos.length,
                grade: profile.gradePass !== null,
                bloom: visual.bloomPass.enabled,
                reaction: { ...profile.reaction },
                cameraZ: visual.camera.position.z,
            };
        },
        dispose() {
            visual.destroy();
            canvas.remove();
            hostCanvas.style.visibility = previousVisibility;
        },
    };
}
