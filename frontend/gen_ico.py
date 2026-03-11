import sys
from PIL import Image

input_path = r"C:\Users\s4nya\Downloads\pitchy-main (1)\pitchy-main\frontend\icons\logotip.png"
output_path = r"C:\Users\s4nya\Downloads\pitchy-main (1)\pitchy-main\frontend\app\favicon.ico"

try:
    img = Image.open(input_path)
    # Ensure image is RGBA
    img = img.convert("RGBA")
    # Resize to 32x32
    img = img.resize((32, 32), Image.Resampling.LANCZOS)
    img.save(output_path, format='ICO', sizes=[(32,32)])
    print("Successfully generated favicon.ico")
except Exception as e:
    print(f"Error: {e}")
