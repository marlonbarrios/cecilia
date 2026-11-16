# Local server for Cecilia that tells the browser never to cache the code,
# so a normal reload always runs the latest files.
#   python3 serve.py        → http://localhost:8123
import http.server, socketserver, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', PORT), NoCache) as httpd:
    print(f'Cecilia on http://localhost:{PORT}', flush=True)
    httpd.serve_forever()
