"""Stream an mp4 through ffmpeg into an animated WebP. Usage: towebp.py in.mp4 out.webp width fps quality"""
import subprocess, sys
from PIL import Image
src, out, W, FPS, Q = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
H = W * 10 // 16
p = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-i", src, "-vf", f"fps={FPS},scale={W}:{H}:flags=lanczos", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
def frames():
    while True:
        b = p.stdout.read(W * H * 3)
        if len(b) < W * H * 3:
            return
        yield Image.frombytes("RGB", (W, H), b)
g = frames()
first = next(g)
first.save(out, save_all=True, append_images=g, duration=round(1000 / FPS), loop=0, quality=Q, method=4, minimize_size=False, allow_mixed=False)
