import sys
import os
from PIL import Image, ImageDraw

def process_icon(input_path, output_path):
    try:
        img = Image.open(input_path).convert("RGBA")
        
        # Determine the size (use the smaller dimension to make a square/circle)
        size = min(img.size)
        
        # Center crop to square
        left = (img.width - size) / 2
        top = (img.height - size) / 2
        right = (img.width + size) / 2
        bottom = (img.height + size) / 2
        img = img.crop((left, top, right, bottom))
        
        # Create a circular mask
        mask = Image.new('L', (size, size), 0)
        draw = ImageDraw.Draw(mask)
        draw.ellipse((0, 0, size, size), fill=255)
        
        # Apply mask
        img.putalpha(mask)
        
        # Resize if needed? The user didn't specify size, but existing icons might give a clue.
        # For now, keep original resolution or maybe standard icon size like 512x512?
        # Let's keep it as is for now, or maybe resize to 512x512 if it's huge.
        # Generated images are usually 1024x1024.
        # Let's resize to 512x512 to save space if it's larger.
        if size > 512:
            img = img.resize((512, 512), Image.Resampling.LANCZOS)
            
        # Save
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        img.save(output_path, "PNG")
        print(f"Processed: {input_path} -> {output_path}")
        
    except Exception as e:
        print(f"Error processing {input_path}: {e}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python process_icons.py <input_path> <output_path>")
        sys.exit(1)
        
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    process_icon(input_path, output_path)
