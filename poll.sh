#!/bin/bash

# ─── Config ───────────────────────────────────────────────────────────────────
RENDER_URL="https://talkdesk-recording-downloader.onrender.com"
SAVE_DIR="/Users/aljencontemprato/Desktop/Projects/1. BPI/VS/talkdesk-server/Recordings"
POLL_INTERVAL=60  # Check every 60 seconds
DOWNLOADED_LOG="$SAVE_DIR/.downloaded.txt"

# ─── Create Recordings folder if it doesn't exist ────────────────────────────
mkdir -p "$SAVE_DIR"
touch "$DOWNLOADED_LOG"

echo "🎙️  Talkdesk Recording Poller Started"
echo "📁 Saving to: $SAVE_DIR"
echo "🔄 Checking Render every ${POLL_INTERVAL} seconds..."
echo "⏹️  Press Ctrl+C to stop"
echo ""

while true; do
  echo "🔍 [$(date '+%H:%M:%S')] Checking for new recordings..."

  # Fetch list of recordings from Render
  RESPONSE=$(curl -s "$RENDER_URL/recordings")

  if [ -z "$RESPONSE" ]; then
    echo "⚠️  Could not reach Render server. Retrying in ${POLL_INTERVAL}s..."
    sleep $POLL_INTERVAL
    continue
  fi

  # Extract filenames from response
  FILENAMES=$(echo $RESPONSE | python3 -c "
import sys, json
data = json.load(sys.stdin)
files = data.get('files', [])
for f in files:
    print(f['filename'])
" 2>/dev/null)

  if [ -z "$FILENAMES" ]; then
    echo "   No recordings on server yet."
  else
    while IFS= read -r FILENAME; do
      # Check if already downloaded
      if grep -qx "$FILENAME" "$DOWNLOADED_LOG"; then
        echo "   ✅ Already downloaded: $FILENAME"
        continue
      fi

      # Download new file
      echo "   ⬇️  New file found! Downloading: $FILENAME"
      FILEPATH="$SAVE_DIR/$FILENAME"

      curl -s "$RENDER_URL/recordings/download/$FILENAME" \
        --output "$FILEPATH"

      if [ $? -eq 0 ] && [ -s "$FILEPATH" ]; then
        echo "$FILENAME" >> "$DOWNLOADED_LOG"
        echo "   🎉 Saved to: $FILEPATH"
      else
        echo "   ❌ Failed to download: $FILENAME"
        rm -f "$FILEPATH"
      fi
    done <<< "$FILENAMES"
  fi

  echo "   💤 Next check in ${POLL_INTERVAL} seconds..."
  echo ""
  sleep $POLL_INTERVAL
done
