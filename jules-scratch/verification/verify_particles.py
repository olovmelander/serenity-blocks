from playwright.sync_api import sync_playwright, expect

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--headless=new"])
        page = browser.new_page()
        page.goto("http://localhost:3000/public/index.html", timeout=60000)

        # 1. Wait for the start modal and select Single Player
        start_modal = page.locator("#start-modal")
        expect(start_modal).to_be_visible()
        page.locator("#single-player-btn").click()

        # 2. Start the game
        page.locator("body").press("Enter")
        expect(start_modal).to_be_hidden(timeout=10000)

        # 3. Wait for the game canvas to be ready
        game_canvas = page.locator("#phaser-game-container canvas")
        expect(game_canvas).to_be_visible()
        page.wait_for_timeout(1000) # Ensure game is fully running

        # 4. Set up the board for a guaranteed line clear by manipulating lockedPieces
        page.evaluate("""() => {
            const app = window.serenityBlocks;
            const gameState = app.gameState;
            const COLS = 10;
            const ROWS = 20;
            const HIDDEN_ROWS = 4;

            gameState.isPaused = true; // Pause game to manipulate state

            // Clear existing locked pieces
            gameState.lockedPieces = [];

            // Build a wall with a 1-block hole by adding individual blocks to lockedPieces
            const targetRow = ROWS + HIDDEN_ROWS - 1;
            for (let x = 0; x < COLS; x++) {
                if (x !== 4) { // Hole at column index 4
                    // Add a 1x1 "piece" for each block
                    const blockPiece = {
                        shape: [[1]],
                        x: x,
                        y: targetRow,
                        color: '#808080',
                        type: 'G' // Garbage block
                    };
                    gameState.lockedPieces.push(blockPiece);
                }
            }

            // Force the current piece to be a vertical 'I' piece
            const iPieceVertical = {
                shape: [[1], [1], [1], [1]],
                x: 4, // Align with the hole
                y: targetRow - 4, // Position it right above the pre-filled row
                color: '#00ffff',
                shapeKey: 'I',
                rotation: 1
            };
            gameState.currentPiece = iPieceVertical;

            gameState.isPaused = false; // Resume game

            // Force a redraw in Phaser
            if (app.boardScene) {
                app.boardScene.syncFromGameState(gameState);
            }
        }""")

        page.wait_for_timeout(500)

        # 5. Hard drop the piece to trigger the line clear
        page.keyboard.press(" ")
        page.wait_for_timeout(1000) # Allow time for the line clear animation and particles

        # 6. Take a screenshot
        page.screenshot(path="jules-scratch/verification/particle_effects.png")

        browser.close()

if __name__ == "__main__":
    run()