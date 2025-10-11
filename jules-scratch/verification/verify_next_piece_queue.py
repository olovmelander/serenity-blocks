from playwright.sync_api import sync_playwright
import time

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    # Navigate to the game
    page.goto("http://localhost:3000")

    # Give the page time to load
    time.sleep(5)

    # Start a new game
    page.click('button:has-text("New Game")')

    # Wait for the game to load
    page.wait_for_selector("#game-container canvas", timeout=60000)

    # Take a screenshot
    page.screenshot(path="jules-scratch/verification/verification.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)