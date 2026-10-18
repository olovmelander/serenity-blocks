import { InfinityMinimap } from '../infinity/InfinityMinimap.js';

/**
 * Create the tall well's tower map beside the board. It reads the board it is given; pressing
 * and dragging it is a look around the well, which the ascent director owns
 * (ui/odyssey/odyssey-tower-look.js), as in Infinity.
 */
export function createOdysseyMinimap() {
    const minimap = new InfinityMinimap();
    minimap.show();
    Object.assign(minimap.container.style, {
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(calc(var(--board-width) / 2 + 230px), -50%)',
        margin: '0',
        zIndex: '5',
    });
    return minimap;
}
