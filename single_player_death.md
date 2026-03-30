# Single Player Death Sequence in Quadra

When a player dies in single-player mode, the following sequence of events occurs:

## 1. Detection and Immediate Effects
*   **Collision:** The game detects that a block has collided in an invalid position (overlapping existing blocks or out of bounds).
*   **State Change:** The player object transitions to the `Player_dead` state.
*   **Falling Block:** The currently falling tetromino is immediately removed from the screen.

## 2. Visual Animation (The "Death" Effect)
*   **Board Fill:** A visual animation plays where the game board is filled with blocks.
    *   In single-player (natural death), these blocks are **grey** (color index 8).
    *   The animation iterates through the board, changing the block colors and marking them as "dirtied" (forcing a redraw).
    *   This creates a visual effect of the board "dying" or turning into stone/grey blocks.
*   **Sound:** A "flash" sound effect (`sons.flash`) is played during the animation.
*   **Message:** A text message is displayed overlaid on the game board:
    *   **"PlayerName died"** (e.g., "Bob died").
    *   This message corresponds to the resource string `ST_BOBDIED`.

## 3. User Interface (HUD)
During the death animation, the game interface remains visible:
*   **Score:** The final score is visible.
*   **Lines:** The total lines cleared are visible.
*   **Level:** The current level is visible.
*   **Player Name:** The player's name is displayed.
*   **BPM/PPM:** If enabled, these stats would also be visible.

## 4. Termination Sequence
Unlike multiplayer mode where a dead player enters a "spectator" or "waiting" mode:
1.  **No Restart:** The game explicitly checks `if(game->single)` and disables the ability to restart immediately with a key press (which is possible in multiplayer).
2.  **Game Over Trigger:** Once the death animation completes (transitions to `Player_dead_wait`), the game logic (`Net_list::check_end_game`) detects that the single player is dead.
3.  **Termination:** The game is marked as `terminated`.
4.  **Exit:** The game loop (`Multi_player::step`) detects the termination and the "gone" state of the player. It then:
    *   Stops the game session.
    *   **High Score Check:** Checks if the final score qualifies for the local high score table.
    *   **Return to Menu:** The player is returned to the main menu (or the High Score screen if a new record was achieved).

## Summary
You do not see a dedicated, static "Game Over" screen that waits for input. Instead, you see:
1.  **The Death Animation**.
2.  **"Player died" message**.
3.  **Immediate return to the Menu/High Scores**.

