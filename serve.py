#!/usr/bin/env python3
"""Tiny static server for local development (no caching, so edits show up on reload)."""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript', '.llsp3': 'application/zip'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()
    def do_POST(self):
        # Dev only: the model aligner (tools/align.html) saves mission model poses into mat/season.json.
        if self.path != '/align-save':
            self.send_error(404); return
        import json
        n = int(self.headers.get('Content-Length', 0))
        poses = json.loads(self.rfile.read(n))
        path = os.path.join('mat', 'season.json')
        season = json.load(open(path, encoding='utf-8'))
        for o in season['obstacles']:
            p = poses.get(o['id'])
            if not p or 'modelPose' not in o:
                continue
            old = o['modelPose']
            o['x'] = round(o['x'] + p['x'] - old['x'], 2); o['y'] = round(o['y'] + p['y'] - old['y'], 2)   # the box travels with the model
            o['modelPose'] = {'x': p['x'], 'y': p['y'], 'heading': p['heading']}
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(season, f, indent=2, ensure_ascii=False); f.write('\n')
        self.send_response(200); self.end_headers(); self.wfile.write(b'ok')
    def log_message(self, *args):
        pass

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8794
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
