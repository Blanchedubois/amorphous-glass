#!/usr/bin/env python3
# ics-server.py PORT_FILE [FIXTURE_DIR]: a test calendar server for the Schedule widgets, on
# 127.0.0.1 only (a free port, written to PORT_FILE). Serves FIXTURE_DIR/<name>.ics under any
# path ending in /<name>.ics, with an ETag and Last-Modified, and 304 when they match.
# Test controls (never used by a real feed):
#   GET /_mode?m=ok|500|404|html|slow|drop|big|429   how the next calendar requests are answered
#   GET /_log                                         the calendar requests so far (JSON), then cleared
import email.utils
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT_FILE = sys.argv[1]
FIXTURES = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ics')
STARTED = email.utils.formatdate(time.time() - 3600, usegmt=True)
state = {'mode': 'ok', 'log': []}


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def send(self, code, body=b'', headers=None):
        self.send_response(code)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/_mode':
            state['mode'] = parse_qs(url.query).get('m', ['ok'])[0]
            return self.send(200, b'ok')
        if url.path == '/_log':
            body = json.dumps(state['log']).encode()
            state['log'] = []
            return self.send(200, body, {'Content-Type': 'application/json'})

        mode = state['mode']
        state['log'].append({'name': os.path.basename(url.path), 'mode': mode, 'ims': self.headers.get('If-Modified-Since'),
                             'inm': self.headers.get('If-None-Match'), 'ua': self.headers.get('User-Agent')})
        if mode == 'drop':
            self.close_connection = True
            self.connection.close()
            return
        if mode == 'slow':
            time.sleep(40)
        if mode == '500':
            return self.send(500, b'oops')
        if mode == '429':
            return self.send(429, b'slow down', {'Retry-After': '120'})
        if mode == '404':
            return self.send(404, b'not found')
        if mode == 'html':
            return self.send(200, b'<!doctype html><title>Sign in</title>', {'Content-Type': 'text/html'})
        if mode == 'big':
            return self.send(200, b'BEGIN:VCALENDAR\r\n' + b'X' * (17 * 1024 * 1024), {'Content-Type': 'text/calendar'})

        name = os.path.basename(url.path)
        path = os.path.join(FIXTURES, name)
        if not name.endswith('.ics') or not os.path.isfile(path):
            return self.send(404, b'no fixture')
        body = open(path, 'rb').read()
        etag = '"%x-%x"' % (len(body), int(os.path.getmtime(path)))
        headers = {'ETag': etag, 'Last-Modified': STARTED, 'Content-Type': 'text/calendar; charset=utf-8'}
        if self.headers.get('If-None-Match') == etag:
            return self.send(304, b'', headers)
        self.send(200, body, headers)


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
server.daemon_threads = True
with open(PORT_FILE + '.tmp', 'w') as f:
    f.write(str(server.server_address[1]))
os.replace(PORT_FILE + '.tmp', PORT_FILE)
server.serve_forever()
