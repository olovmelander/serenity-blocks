import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        try:
            import os
            # Get the absolute path to the HTML file
            file_path = os.path.abspath("dist/index.html")
            await page.goto(f"file://{file_path}")

            # Attempt to handle the start modal, but proceed if it's not found
            try:
                start_modal = page.locator("#start-modal")
                await expect(start_modal).to_be_visible(timeout=1000)
                await page.get_by_text("Single Player").click()
                await page.keyboard.press(" ") # Press space to start
            except Exception:
                print("Start modal not found, proceeding to screenshot.")

            # Wait for the game container to be visible
            game_container = page.locator("#phaser-game-container")
            await expect(game_container).to_be_visible()

            # Take a screenshot of the game container
            await game_container.screenshot(path="jules-scratch/verification/verification.png")

            print("Screenshot taken successfully.")

        except Exception as e:
            print(f"An error occurred: {e}")

        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(main())