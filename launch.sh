#!/bin/bash
# Work Log Launcher for Linux/Mac
# Place in the same folder as work-log.html and run: bash launch.sh

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Find a free port on localhost only
PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()")

URL="http://127.0.0.1:$PORT/work-log.html"

echo "Starting server on $URL"
echo "Press Ctrl+C to stop"

# Serve only work-log.html — all other requests get 404
python3 - $PORT "$DIR" << 'PYEOF' &
import sys, http.server, os

PORT = int(sys.argv[1])
ALLOWED = 'work-log.html'
DIR = sys.argv[2]

class SafeHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.lstrip('/') not in ('', ALLOWED):
            self.send_response(404)
            self.end_headers()
            return
        filepath = os.path.join(DIR, ALLOWED)
        try:
            with open(filepath, 'rb') as f:
                data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', len(data))
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self.send_response(404)
            self.end_headers()
    def log_message(self, *args):
        pass  # suppress request logs

server = http.server.HTTPServer(('127.0.0.1', PORT), SafeHandler)
server.serve_forever()
PYEOF

SERVER_PID=$!
sleep 1

# Open browser
if command -v xdg-open &> /dev/null; then
    xdg-open "$URL"
elif command -v open &> /dev/null; then
    open "$URL"
else
    echo "Open this URL in your browser: $URL"
fi

trap "kill $SERVER_PID 2>/dev/null; echo 'Server stopped.'" EXIT
wait $SERVER_PID
