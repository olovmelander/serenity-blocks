import sys
from PIL import Image
import numpy as np

def analyze_icon(path):
    img = Image.open(path).convert("RGBA")
    width, height = img.size
    print(f"Image size: {width}x{height}")
    
    # Get center horizontal line
    center_y = height // 2
    pixels = []
    for x in range(width):
        pixels.append(img.getpixel((x, center_y)))
    
    # Print a sample of pixels from center outwards
    center_x = width // 2
    print(f"Center pixel: {pixels[center_x]}")
    
    # Check for white pixels
    white_threshold = 240
    white_pixels = [p for p in pixels if p[0] > white_threshold and p[1] > white_threshold and p[2] > white_threshold and p[3] == 255]
    print(f"Number of 'white' pixels in center row: {len(white_pixels)}")
    
    # Find the transition from white to transparent (outer edge) and white to dark (inner edge)
    # Scan from center (should be dark) to right
    for x in range(center_x, width):
        r, g, b, a = pixels[x]
        if r > white_threshold and g > white_threshold and b > white_threshold:
            print(f"Found white pixel at x={x} (dist from center: {x - center_x})")
            break

if __name__ == "__main__":
    analyze_icon(sys.argv[1])
