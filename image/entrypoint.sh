#!/bin/bash
set -e

./start_all.sh
./novnc_startup.sh

python http_server.py > /tmp/server_logs.txt 2>&1 &

# Start Claude WebSocket planner server for the Chrome extension bridge
PC_SERVER_PORT=${PC_SERVER_PORT:-8765} \
python -u client/server.py > /tmp/pc_ws_server.log 2>&1 &

STREAMLIT_SERVER_PORT=8501 python -m streamlit run computer_use_demo/streamlit.py > /tmp/streamlit_stdout.log &

echo "✨ Computer Use Demo is ready!"
echo "➡️  Open http://localhost:8080 in your browser to begin"
echo "ℹ️  Extension WebSocket bridge listening on ws://localhost:${PC_SERVER_PORT:-8765}"

# Keep the container running
tail -f /dev/null
