# Single Player Layout Centering Fix (Updated)

## Objective
The user requested that the single-player game container be exactly in the center of the screen, with the stats bar positioned to the right. The previous Grid-based attempt resulted in the board being shifted left because the stats bar in the right column forced the grid to rebalance.

## Changes Made

### CSS Updates (`public/styles/main.css`)

1.  **Flexbox Centering**:
    - Reverted `.single-player-stage` to `display: flex` with `justify-content: center` and `align-items: center`.
    - This ensures the `.game-container` (which contains the board) is perfectly centered in the viewport, ignoring the stats bar.

2.  **Absolute Positioning for Stats**:
    - Set `.single-player-stats-bar` to `position: absolute`.
    - Positioned it relative to the center of the screen (`left: 50%`, `top: 50%`).
    - Applied `transform: translate(calc(var(--board-width) / 2 + 60px), -50%)`.
        - `var(--board-width) / 2`: Moves it to the right edge of the centered board.
        - `+ 60px`: Adds padding (card padding + gap).
        - `-50%` (Y): Centers it vertically.
    - This removes the stats bar from the document flow, preventing it from pushing the board off-center.

3.  **Shared Variables**:
    - Moved `--board-width` and `--board-height` definitions from `.single-player-card` to `.single-player-stage`. This allows both the card (child) and the stats bar (sibling) to access the same width value for consistent positioning.

4.  **Mobile Reset**:
    - In the `@media (max-width: 820px)` block, reset `.single-player-stats-bar` to `position: static`, `transform: none`, and added `margin-top: 20px`. This ensures that on small screens, the stats stack below the board as expected.

## Result
- The **Game Board** is now mathematically centered in the viewport.
- The **Stats Bar** floats to the right of the board without affecting the board's position.
- The layout remains responsive.

## Verification
- **Desktop**: Board is dead center. Stats are to the right.
- **Mobile**: Board and stats stack vertically.
- **Infinity Mode**: Unaffected (stats bar is hidden in this mode).
