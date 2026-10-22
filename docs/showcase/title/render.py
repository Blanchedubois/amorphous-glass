#!/usr/bin/env python3
"""Render the title scene to a still, an MP4 and a looping WebP.

GitHub cannot run the page's WebGL in a README, so it is rendered here: headless Chromium with
SwiftShader (the same pixels on any machine) draws every frame and POSTs it to this script's
server, then ffmpeg encodes them. The server serves the repository root, because timeline.js
imports the desktop's own spring.js from extensions/.

  render.py still 5.4 -o logo.png [--theme light]
  render.py webp title.mp4 -o title.webp    (the README loop, from a master)
  render.py clip -o title.mp4 [--webp title.webp] [--width 1920] [--fps 60] [--blur 6] [--theme light]
             [--plate-in in.png --plate-out out.png] [--scene glass]
"""

import argparse
import http.server
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PAGES = {'capsule': 'index.html', 'glass': 'glass/index.html'}   # the first title, the glass title


def page_of(args):
    return HERE.relative_to(ROOT).as_posix() + '/' + PAGES[args.scene]
CHROMIUM = shutil.which('chromium') or shutil.which('google-chrome-stable') or shutil.which('chrome')
CHROMIUM_FLAGS = ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                  '--hide-scrollbars', '--window-size=1920,1080', '--no-first-run']


def serve(frames_dir, done):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT), **kwargs)

        def log_message(self, *args):
            pass

        def do_POST(self):
            body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            if self.path.startswith('/frame/'):
                n = int(self.path.rsplit('/', 1)[1])
                (frames_dir / f'{n:05d}.png').write_bytes(body)
                if n % 60 == 0:
                    print(f'  frame {n}', file=sys.stderr)
            elif self.path == '/done':
                done.set()
            self.send_response(204)
            self.end_headers()

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def page_url(server, args, extra):
    query = {'theme': args.theme, **dict(p.split('=', 1) for p in args.param), **extra}
    for key, path in (('plateIn', args.plate_in), ('plateOut', args.plate_out)):
        if path:
            query[key] = '/' + Path(path).resolve().relative_to(ROOT).as_posix()
    return f'http://127.0.0.1:{server.server_port}/{page_of(args)}?{urllib.parse.urlencode(query)}'


def still(args):
    with tempfile.TemporaryDirectory() as profile:
        server = serve(Path(profile), threading.Event())
        url = page_url(server, args, {'t': args.time})
        out = Path(args.output).resolve()
        # under load the screenshot can be taken before WebGL has drawn: a blank frame is a few KB
        for _ in range(4):
            log = ['--enable-logging=stderr', '--v=0'] if args.debug else []
            run = subprocess.run([CHROMIUM, *CHROMIUM_FLAGS, *log, f'--user-data-dir={profile}/chromium',
                                  '--virtual-time-budget=20000', f'--screenshot={out}', url],
                                 check=True, stdout=subprocess.DEVNULL,
                                 stderr=subprocess.PIPE if args.debug else subprocess.DEVNULL, text=True)
            if args.debug:
                # the page's console (shader errors, the timings it logs)
                print('\n'.join(l.split('CONSOLE', 1)[1] for l in run.stderr.splitlines() if 'CONSOLE' in l), file=sys.stderr)
            if out.stat().st_size > 100_000:
                break
        else:
            sys.exit('render: the still stayed blank')
        server.shutdown()
    print(args.output)


def clip(args):
    with tempfile.TemporaryDirectory() as tmp:
        frames = Path(tmp) / 'frames'
        frames.mkdir()
        done = threading.Event()
        server = serve(frames, done)
        part = {k: v for k, v in (('from', args.start), ('to', args.end)) if v is not None}
        url = page_url(server, args, {'render': 1, 'fps': args.fps, 'blur': args.blur, **part})
        browser = subprocess.Popen([CHROMIUM, *CHROMIUM_FLAGS, f'--user-data-dir={tmp}/chromium', url],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            if not done.wait(timeout=3600):
                sys.exit('render: timed out')
        finally:
            browser.terminate()
            browser.wait()
            server.shutdown()

        pattern = str(frames / '%05d.png')
        first = ['-start_number', str(round((args.start or 0) * args.fps))]
        scale = f'scale={args.width}:-2:flags=lanczos'
        if args.output:
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(args.fps), *first, '-i', pattern,
                            '-vf', scale, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
                            '-pix_fmt', 'yuv420p', '-movflags', '+faststart', args.output], check=True)
            print(args.output, os.path.getsize(args.output))
        if args.webp:
            encode_webp(sorted(frames.glob('*.png')), args.fps, args)


def encode_webp(paths, fps, args):
    """the README loop: an animated WebP at `args.webp_fps`, `args.webp_width` wide.

    Encoded with Pillow (libwebp's WebPAnimEncoder) rather than ffmpeg's libwebp_anim, whose
    output built up blocky smears over the wallpaper's gradients (seen when decoding with
    libwebp). A keyframe every 10 frames keeps it clean and about 2.5 MB."""
    from PIL import Image
    step = max(1, round(fps / args.webp_fps))
    images = []
    for path in paths[::step]:
        with Image.open(path) as im:
            im = im.convert('RGB')
            height = round(im.height * args.webp_width / im.width / 2) * 2
            images.append(im.resize((args.webp_width, height), Image.LANCZOS))
    images[0].save(args.webp, save_all=True, append_images=images[1:], loop=0,
                   duration=round(1000 * step / fps), quality=args.webp_quality, method=getattr(args, 'webp_method', 4),
                   kmin=args.webp_kmax - 1, kmax=args.webp_kmax, allow_mixed=False)
    print(args.webp, os.path.getsize(args.webp))


def webp(args):
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', args.master, f'{tmp}/%05d.png'], check=True)
        fps = float(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                                    'stream=r_frame_rate', '-of', 'csv=p=0', args.master],
                                   capture_output=True, text=True, check=True).stdout.strip().split('/')[0])
        encode_webp(sorted(Path(tmp).glob('*.png')), fps, args)

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='mode', required=True)
    w = sub.add_parser('webp', help='re-encode the README loop from an MP4 master')
    w.add_argument('master')
    w.add_argument('-o', '--webp', required=True)
    w.add_argument('--webp-width', type=int, default=1280)
    w.add_argument('--webp-fps', type=int, default=30)
    w.add_argument('--webp-quality', type=int, default=75)
    w.add_argument('--webp-kmax', type=int, default=10, help='frames between keyframes')
    w.add_argument('--webp-method', type=int, default=4, help='libwebp effort, 0-6: 6 keeps dark gradients unblocked')
    for name in ('still', 'clip'):
        p = sub.add_parser(name)
        p.add_argument('--scene', choices=tuple(PAGES), default='capsule', help='which title page')
        p.add_argument('--theme', choices=('dark', 'light'), default='dark')
        p.add_argument('--plate-in', help="the montage's last frame (inside the repository)")
        p.add_argument('--plate-out', help="the montage's first frame (inside the repository)")
        p.add_argument('--param', action='append', default=[], metavar='KEY=VALUE',
                       help='a page parameter, e.g. follow=0.55,90 (see main.js)')
        if name == 'still':
            p.add_argument('time', type=float)
            p.add_argument('-o', '--output', required=True)
            p.add_argument('--debug', action='store_true', help="print the page's console")
        else:
            p.add_argument('-o', '--output', help='MP4')
            p.add_argument('--webp', help='looping animated WebP')
            p.add_argument('--fps', type=int, default=60)
            p.add_argument('--start', type=float, help='render from this second (a preview)')
            p.add_argument('--end', type=float, help='to this second')
            p.add_argument('--blur', type=int, default=6, help='moments added up per frame (motion blur)')
            p.add_argument('--width', type=int, default=1920, help='MP4 width')
            p.add_argument('--webp-width', type=int, default=1280)
            p.add_argument('--webp-fps', type=int, default=30, help='the README loop: 30 keeps it small')
            p.add_argument('--webp-quality', type=int, default=75)
            p.add_argument('--webp-kmax', type=int, default=10, help='frames between keyframes')
    args = parser.parse_args()
    if not CHROMIUM:
        sys.exit('render: Chromium not found')
    if args.mode == 'webp':
        webp(args)
        return
    (still if args.mode == 'still' else clip)(args)


if __name__ == '__main__':
    main()
