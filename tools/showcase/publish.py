#!/usr/bin/env python3
"""publish.py REDACTED OUT: the README media from the redacted shoot (docs/SHOWCASE_PLAN.md, Phase 6).

Stills become WebP (whole screens at 1600 px wide, details cropped at full resolution); clips become
animated WebP, cropped to where the animation happens. GitHub shows animated WebP inline in a README,
which it does not do for video files in the repo. Every crop is listed here so a re-shoot republishes
the same framing. Coordinates are the 2560x1440 screen (lock screen clips: 1920x1080).
"""
import os, subprocess, sys

from PIL import Image

SRC, OUT = sys.argv[1:3]
os.makedirs(OUT, exist_ok=True)

# name: (source still, crop box or None for the whole screen)
STILLS = {
    'desktop': ('desktop', None),
    'quick-settings': ('quick-settings-submenu', (1600, 0, 960, 760)),
    'calendar': ('calendar', (860, 0, 900, 660)),
    'desktop-menu': ('desktop-menu', (900, 620, 760, 440)),
    'dock-menu': ('dock-menu', (720, 880, 1000, 560)),
    'files': ('files-context-menu', None),
    'window-menu': ('window-menu', (900, 300, 900, 900)),
    'search': ('search', (700, 0, 1160, 1000)),
    'app-folder': ('app-folder', None),
    'music': ('music', (0, 40, 800, 1100)),
    'widget-snapped': ('widget-snapped', (1700, 0, 860, 900)),
    'light-desktop': ('light-desktop', None),
    'light-calendar': ('light-calendar', (860, 0, 900, 660)),
    'light-quick-settings': ('light-quick-settings', (1600, 0, 960, 760)),
    'light-files': ('light-files', None),
    'volume-osd': ('volume-osd', (880, 1000, 800, 440)),
    'lock-screen': ('lock-screen', None),
    'lock-menu': ('lock-menu', (1560, 0, 1000, 760)),
    'sign-in-typing': ('sign-in-typing', (780, 160, 1000, 1280)),
}

# name: (source clip, crop or None, start s, length s, width px, fps)
CLIPS = {
    'quick-settings': ('quick-settings-open', (1520, 0, 1040, 800), 0.3, 7.0, 720, 24),
    'calendar': ('calendar-open', (860, 0, 900, 660), 0.3, 3.6, 720, 24),
    'menu-slide': ('menu-slide', (860, 0, 1700, 760), 0.3, 7.2, 900, 24),
    'desktop-menu': ('desktop-menu', (850, 560, 1000, 560), 0.3, 3.2, 720, 24),
    'dock-menu': ('dock-menu', (720, 760, 1140, 680), 0.3, 4.8, 720, 24),
    'window-open': ('window-open', None, 0.0, 7.2, 900, 24),
    'files-menu': ('files-menu', None, 0.0, 4.0, 900, 24),
    'overview': ('overview', None, 0.2, 6.0, 900, 24),
    'app-grid': ('app-grid', None, 0.2, 6.8, 900, 24),
    'volume-osd': ('volume-osd', (880, 1000, 800, 440), 0.0, 3.5, 640, 24),
    'widget-drag': ('widget-drag', (1600, 0, 960, 900), 0.2, 8.0, 640, 24),
    'music-swirl': ('music-swirl', (0, 40, 800, 1100), 1.0, 9.0, 480, 20),
    'lock-screen': ('red3-lock-screen', None, 4.0, 12.0, 900, 20),
    'lock-menu': ('red3-lock-menu', (1100, 0, 820, 620), 10.0, 12.0, 640, 20),
    'sign-in': ('red3-sign-in', (560, 560, 800, 520), 0.0, 7.0, 560, 20),
}


def stills():
    for name, (src, box) in STILLS.items():
        im = Image.open(os.path.join(SRC, f'{src}.png')).convert('RGB')
        if box:
            x, y, w, h = box
            im = im.crop((x, y, x + w, y + h))
        else:
            im = im.resize((1600, 900), Image.LANCZOS)
        im.save(os.path.join(OUT, f'{name}.webp'), quality=88, method=6)


def clips():
    """frames through ffmpeg (crop, frame rate, size), then Pillow writes every frame whole: ffmpeg's
    encoder stores only changed rectangles, which on slow cross-fades (the swirl) shows as tiles"""
    import glob, tempfile
    for name, (src, box, start, length, width, fps) in CLIPS.items():
        vf = []
        if box:
            vf.append('crop={2}:{3}:{0}:{1}'.format(*box))
        vf += [f'fps={fps}', f'scale={width}:-2:flags=lanczos']
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', str(start), '-t', str(length),
                            '-i', os.path.join(SRC, f'{src}.mp4'), '-vf', ','.join(vf), f'{tmp}/%04d.png'], check=True)
            frames = [Image.open(f).convert('RGB') for f in sorted(glob.glob(f'{tmp}/*.png'))]
            frames[0].save(os.path.join(OUT, f'{name}-motion.webp'), save_all=True, append_images=frames[1:],
                           duration=round(1000 / fps), loop=0, quality=78, method=4, minimize_size=False)

if __name__ == '__main__':
    stills()
    clips()
    for f in sorted(os.listdir(OUT)):
        print(f'{f:28} {os.path.getsize(os.path.join(OUT, f)) / 1e6:.2f} MB')
