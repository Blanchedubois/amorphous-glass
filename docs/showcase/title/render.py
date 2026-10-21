#!/usr/bin/env python3
"""Render the title scene to a still, an MP4 and a looping WebP.

GitHub cannot run the page's WebGL in a README, so it is rendered here: headless Chromium with
SwiftShader (the same pixels on any machine) draws every frame and POSTs it to this script's
server, then ffmpeg encodes them. The server serves the repository root, because timeline.js
imports the desktop's own spring.js from extensions/.

  render.py still 5.4 -o logo.png [--theme light]
  render.py clip -o title.mp4 [--webp title.webp] [--width 1920] [--fps 60] [--blur 6] [--theme light]
             [--plate-in in.png --plate-out out.png]
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
PAGE = HERE.relative_to(ROOT).as_posix() + '/index.html'
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
    return f'http://127.0.0.1:{server.server_port}/{PAGE}?{urllib.parse.urlencode(query)}'


def still(args):
    with tempfile.TemporaryDirectory() as profile:
        server = serve(Path(profile), threading.Event())
        url = page_url(server, args, {'t': args.time})
        subprocess.run([CHROMIUM, *CHROMIUM_FLAGS, f'--user-data-dir={profile}/chromium',
                        '--virtual-time-budget=20000', f'--screenshot={Path(args.output).resolve()}', url],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        server.shutdown()
    print(args.output)


def clip(args):
    with tempfile.TemporaryDirectory() as tmp:
        frames = Path(tmp) / 'frames'
        frames.mkdir()
        done = threading.Event()
        server = serve(frames, done)
        url = page_url(server, args, {'render': 1, 'fps': args.fps, 'blur': args.blur})
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
        scale = f'scale={args.width}:-2:flags=lanczos'
        if args.output:
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(args.fps), '-i', pattern,
                            '-vf', scale, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
                            '-pix_fmt', 'yuv420p', '-movflags', '+faststart', args.output], check=True)
            print(args.output, os.path.getsize(args.output))
        if args.webp:
            webp_scale = f'scale={args.webp_width}:-2:flags=lanczos'
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(args.fps), '-i', pattern,
                            '-vf', webp_scale, '-c:v', 'libwebp_anim', '-quality', '80',
                            '-compression_level', '6', '-loop', '0', args.webp], check=True)
            print(args.webp, os.path.getsize(args.webp))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='mode', required=True)
    for name in ('still', 'clip'):
        p = sub.add_parser(name)
        p.add_argument('--theme', choices=('dark', 'light'), default='dark')
        p.add_argument('--plate-in', help="the montage's last frame (inside the repository)")
        p.add_argument('--plate-out', help="the montage's first frame (inside the repository)")
        p.add_argument('--param', action='append', default=[], metavar='KEY=VALUE',
                       help='a page parameter, e.g. follow=0.55,90 (see main.js)')
        if name == 'still':
            p.add_argument('time', type=float)
            p.add_argument('-o', '--output', required=True)
        else:
            p.add_argument('-o', '--output', help='MP4')
            p.add_argument('--webp', help='looping animated WebP')
            p.add_argument('--fps', type=int, default=60)
            p.add_argument('--blur', type=int, default=6, help='moments added up per frame (motion blur)')
            p.add_argument('--width', type=int, default=1920, help='MP4 width')
            p.add_argument('--webp-width', type=int, default=1280)
    args = parser.parse_args()
    if not CHROMIUM:
        sys.exit('render: Chromium not found')
    (still if args.mode == 'still' else clip)(args)


if __name__ == '__main__':
    main()
