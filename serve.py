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
    def log_message(self, *args):
        pass

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8794
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
