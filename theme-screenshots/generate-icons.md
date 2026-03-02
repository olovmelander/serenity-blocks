**Task:** Generate a batch of visually stunning, high-masterpiece-quality circular UI icons for the "Serenity Hub" in my game "Serenity Blocks."

**Required Model:** These icons must be generated using the **Nano Banana 2** model.

**Input Context & Data Mapping:**
You are provided with a folder of theme screenshots (`theme-screenshots/`) and the visual aesthetic of the current Serenity Hub UI (provided in the user's initial images). You must analyze both to ensure the new icons fit the existing sleek, dark-mode game aesthetic.

I am also providing you with the source code for the corresponding environments from the `src/themes/` folder. For every screenshot you process (e.g., `theme-screenshots/blood-moon.png`), you must look up the matching code file (e.g., `src/themes/blood-moon`).

**Step-by-Step Instructions:**

1.  **Analyze the Screenshot (`theme-screenshots/`):** Identify the core subject that can represent the entire theme (e.g., the specific twisted tree in Sakura Twilight, the volcanic peak in Pyrestorm). Define the overall mood.
2.  **Analyze the Code (`src/themes/`):** Look for definitive technical data. Extract the exact color hex codes/RGB values, lighting intensity settings, and descriptions of particle effects (e.g., "floating embers," "stardust," "aurora effect").
3.  **Generate the Nano Banana 2 Prompt:** Synthesize the visual mood (Step 1) and technical code data (Step 2) into a perfect icon prompt.

**Nano Banana 2 Icon Formula (Use this structure for every result):**

Use the following template to generate the image with Nano Banana 2:

"Create a high-quality, 2D stylized game UI icon of [INSERT DISTILLED SINGLE OBJECT FROM IMAGE, e.g., a glowing cherry blossom tree or a volcano peak]. The icon must be perfectly centered and framed for a circular cutout. Include refined details like [INSERT SPECIFIC PARTICLE/LIGHTING EFFECTS FROM CODE, e.g., floating ash, subtle glowing embers, cosmic dust]. Art style: sleek, smooth semi-3D, atmospheric and serene, masterpiece quality, designed for a high-end UI. Color palette: [INSERT EXACT PRIMARY COLORS FROM CODE]. The background must be a simple, dark, solid color so the main icon pops and glows against it."
