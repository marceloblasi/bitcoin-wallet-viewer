import sys
try:
    from PIL import Image
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image

image_path = sys.argv[1]
try:
    img = Image.open(image_path)
    img.save('icon.ico', format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    print("Icon successfully created!")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
