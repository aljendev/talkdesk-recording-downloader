const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DOWNLOADS_DIR = path.join(__dirname, "downloads");

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// ─── OAuth Token Helper ───────────────────────────────────────────────────────
async function getTalkdeskToken() {
  const accountName = process.env.TALKDESK_ACCOUNT_NAME;

  if (!accountName) {
    throw new Error("TALKDESK_ACCOUNT_NAME environment variable is not set");
  }

  const authUrl = `https://${accountName}.mytalkdesk.com/oauth/token`;
  console.log(`[INFO] Using auth URL: ${authUrl}`);

  const response = await axios.post(
    authUrl,
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.TALKDESK_CLIENT_ID,
      client_secret: process.env.TALKDESK_CLIENT_SECRET,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return response.data.access_token;
}

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Talkdesk Recording Downloader is running" });
});

// ─── Main Endpoint ────────────────────────────────────────────────────────────
// POST /download-recording
// Body: { "interaction_id": "abc123" }
app.post("/download-recording", async (req, res) => {
  const { interaction_id } = req.body;

  if (!interaction_id) {
    return res.status(400).json({ error: "interaction_id is required" });
  }

  try {
    // Step 1: Get OAuth token
    console.log(`[INFO] Fetching token for interaction: ${interaction_id}`);
    const token = await getTalkdeskToken();

    // Step 2: Get list of recordings for this call
    const callRecordingsUrl = `https://api.talkdeskapp.com/calls/${interaction_id}/recordings`;
    console.log(`[INFO] Fetching recordings list from: ${callRecordingsUrl}`);

    const recordingsListResponse = await axios.get(callRecordingsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const recordings = recordingsListResponse.data?._embedded?.recordings;

    if (!recordings || recordings.length === 0) {
      return res.status(404).json({ error: "No recordings found for this interaction_id" });
    }

    console.log(`[INFO] Found ${recordings.length} recording(s)`);

    // Step 3: Download all recordings using media href
    const downloadedFiles = [];

    for (const recording of recordings) {
      const mediaUrl = recording._links?.media?.href;
      const recordingId = recording.id;

      if (!mediaUrl) {
        console.warn(`[WARN] No media href for recording ${recordingId}, skipping`);
        continue;
      }

      console.log(`[INFO] Downloading recording ${recordingId} from: ${mediaUrl}`);

      const mediaResponse = await axios.get(mediaUrl, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: "stream",
      });

      // Determine file extension from content-type
      const contentType = mediaResponse.headers["content-type"] || "";
      const ext = contentType.includes("mp3")
        ? "mp3"
        : contentType.includes("wav")
        ? "wav"
        : contentType.includes("ogg")
        ? "ogg"
        : "mp3"; // default fallback

      const filename = `${interaction_id}_${recordingId}.${ext}`;
      const filePath = path.join(DOWNLOADS_DIR, filename);

      const writer = fs.createWriteStream(filePath);
      mediaResponse.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      console.log(`[SUCCESS] Saved: ${filename}`);
      downloadedFiles.push({ recording_id: recordingId, filename, path: filePath });
    }

    res.json({
      success: true,
      interaction_id,
      recordings_found: recordings.length,
      downloaded: downloadedFiles,
      message: `${downloadedFiles.length} recording(s) downloaded successfully`,
    });

  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data || err.message;
    console.error(`[ERROR] ${status}:`, message);
    res.status(status).json({ error: "Failed to download recording", detail: message });
  }
});

// ─── List Downloaded Files ────────────────────────────────────────────────────
app.get("/recordings", (req, res) => {
  const files = fs.readdirSync(DOWNLOADS_DIR).map((f) => ({
    filename: f,
    size_bytes: fs.statSync(path.join(DOWNLOADS_DIR, f)).size,
  }));
  res.json({ count: files.length, files });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
