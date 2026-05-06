#!/bin/bash
# Work Log Launcher for Linux/Mac
# Place this in the same folder as work-log.html and run: bash launch.sh

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Find a free port
PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print(s.getsockname()[1]); s.close()")

echo "Starting server on http://localhost:$PORT"
echo "Press Ctrl+C to stop"

# Start server in background
python3 -m http.server $PORT &
SERVER_PID=$!

sleep 1

# Open browser
URL="http://localhost:$PORT/work-log.html"
if command -v xdg-open &> /dev/null; then
    xdg-open "$URL"           # Linux
elif command -v open &> /dev/null; then
    open "$URL"               # Mac
else
    echo "Open this URL in your browser: $URL"
fi

# Wait for Ctrl+C
trap "kill $SERVER_PID 2>/dev/null; echo 'Server stopped.'" EXIT
wait $SERVER_PID
