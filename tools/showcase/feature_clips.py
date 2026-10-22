"""README feature clips: cut, crop and blur with ffmpeg, encode animated WebP with Pillow.

  python -I tools/showcase/feature_clips.py docs/showcase/media [name..]

Each clip -> OUTDIR/feature-NAME.webp (960x540) and feature-NAME-still.webp (the poster frame).
"""
import io, subprocess, sys
from pathlib import Path
from PIL import Image

V = Path.home() / 'Videos/liquid-glass-showcase'
W, H, FPS = 960, 540, 20

# box blur over private notifications: (x, y, w, h) in source pixels, [t0, t1] seconds
NOTIF = (950, 56, 390, 240)


def blur(box, t0, t1):
    x, y, w, h = box
    return (f"split[a][b];[b]crop={w}:{h}:{x}:{y},boxblur=24:3[bl];"
            f"[a][bl]overlay={x}:{y}:enable='between(t,{t0},{t1})'")


# name: list of (source, start, duration, filter before scale), still time (s into the result)
CLIPS = {
    'live-blur': ([(V / 'features1/live-blur.mp4', 0.3, 10.4, blur(NOTIF, 3.35, 7.25) + ',crop=1920:1080:0:0')], 5.8),
    'motion': ([(V / 'features1/quick-settings.mp4', 0.4, 6.6, 'crop=1280:720:1280:0')], 3.6),
    'spacing': ([(V / 'features1/calendar.mp4', 0.9, 4.4, blur(NOTIF, 0.75, 3.7) + ',crop=1280:720:640:0')], 2.6),
    'icons': ([(V / 'features3/icons.mp4', 0.6, 6.6, 'crop=960:540:1600:0')], 3.2),
    'albums': ([(V / f'features4/song-{i}.mp4', 0.6, 4.6, 'crop=1600:900:0:40') for i in (1, 2, 3, 4)], 1.5),
    'lock': ([(V / 'features-lock/lock-video.mp4', 0.8, 5.6, 'crop=2240:1260:60:20')], 3.5),
    'modes': ([(V / 'features4/modes.mp4', s, d, 'crop=2560:1440:0:0') for s, d in ((7.6, 5.4), (21.4, 4.6), (34.2, 2.8))], 2.2),
}


def frames(src, start, dur, vf):
    cmd = ['ffmpeg', '-v', 'error', '-ss', str(start), '-t', str(dur), '-i', str(src),
           '-filter_complex', f'{vf},fps={FPS},scale={W}:{H}:flags=lanczos', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    n = W * H * 3
    return [Image.frombytes('RGB', (W, H), raw[i:i + n]) for i in range(0, len(raw) - n + 1, n)]


def build(out, name, quality=62):
    parts, still_t = CLIPS[name]
    imgs = [im for p in parts for im in frames(*p)]
    k = min(len(imgs) - 1, int(still_t * FPS))
    imgs = imgs[k:] + imgs[:k]                 # the loop starts on the poster frame, not bare wallpaper
    dst = out / f'feature-{name}.webp'
    imgs[0].save(dst, save_all=True, append_images=imgs[1:], duration=1000 // FPS, loop=0,
                 quality=quality, method=6, kmin=9, kmax=10)
    imgs[0].save(out / f'feature-{name}-still.webp', quality=82, method=6)
    print(f'{name}: {len(imgs)} frames, {dst.stat().st_size / 1e6:.2f} MB')


if __name__ == '__main__':
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for name in sys.argv[2:] or CLIPS:
        build(out, name)
