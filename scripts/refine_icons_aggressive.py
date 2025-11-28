import sys
import os
from PIL import Image, ImageDraw

def refine_icon_aggressive(input_path, output_path):
    try:
        img = Image.open(input_path).convert("RGBA")
        width, height = img.size
        pixels = img.load()
        
        # Find bounding box of non-white, non-transparent pixels
        # Be more aggressive with "white" detection
        min_x, min_y = width, height
        max_x, max_y = 0, 0
        
        found_content = False
        
        # Threshold for "white" - increased to catch off-white edges
        white_threshold = 230 
        
        for y in range(height):
            for x in range(width):
                r, g, b, a = pixels[x, y]
                
                # Skip transparent
                if a < 50:
                    continue
                
                # Check if pixel is white-ish
                is_white = r > white_threshold and g > white_threshold and b > white_threshold
                
                if not is_white:
                    found_content = True
                    min_x = min(min_x, x)
                    min_y = min(min_y, y)
                    max_x = max(max_x, x)
                    max_y = max(max_y, y)
        
        if not found_content:
            print(f"No content found in {input_path}")
            return

        # NO padding this time, or even negative padding (inset)
        # The user wants to eliminate the white edge.
        # Let's inset by a few pixels to be safe.
        inset = 2
        min_x = min_x + inset
        min_y = min_y + inset
        max_x = max_x - inset
        max_y = max_y - inset
        
        # Make the crop square to preserve aspect ratio of the circle
        crop_width = max_x - min_x
        crop_height = max_y - min_y
        size = max(crop_width, crop_height)
        
        # Center the square on the content center
        center_x = (min_x + max_x) // 2
        center_y = (min_y + max_y) // 2
        
        crop_x1 = center_x - size // 2
        crop_y1 = center_y - size // 2
        crop_x2 = crop_x1 + size
        crop_y2 = crop_y1 + size
        
        # Crop
        img_cropped = img.crop((crop_x1, crop_y1, crop_x2, crop_y2))
        
        # Resize back to 512x512
        final_size = 512
        img_resized = img_cropped.resize((final_size, final_size), Image.Resampling.LANCZOS)
        
        # Apply circular mask
        mask = Image.new('L', (final_size, final_size), 0)
        draw = ImageDraw.Draw(mask)
        draw.ellipse((0, 0, final_size, final_size), fill=255)
        
        img_resized.putalpha(mask)
        
        # Save
        img_resized.save(output_path, "PNG")
        print(f"Aggressively Refined: {input_path} -> {output_path}")
        
    except Exception as e:
        print(f"Error processing {input_path}: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python refine_icons_aggressive.py <file1> [file2 ...]")
        sys.exit(1)
        
    for path in sys.argv[1:]:
        refine_icon_aggressive(path, path) # Overwrite
