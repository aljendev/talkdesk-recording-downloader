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
    console.log(`[INFO] Fetching token for interaction: ${interaction_id}`);
    const token = await getTalkdeskToken();

    const recordingUrl = `https://api.talkdeskapp.com/recordings/${interaction_id}/media`;
    console.log(`[INFO] Downloading from: ${recordingUrl}`);

    const recordingResponse = await axios.get(recordingUrl, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: "stream",
    });

    // Determine file extension from content-type
    const contentType = recordingResponse.headers["content-type"] || "";
    const ext = contentType.includes("mp3")
      ? "mp3"
      : contentType.includes("wav")
      ? "wav"
      : contentType.includes("ogg")
      ? "ogg"
      : "mp3"; // default fallback

    const filename = `${interaction_id}_${Date.now()}.${ext}`;
    const filePath = path.join(DOWNLOADS_DIR, filename);

    const writer = fs.createWriteStream(filePath);
    recordingResponse.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    console.log(`[SUCCESS] Saved to: ${filePath}`);
    res.json({
      success: true,
      interaction_id,
      filename,
      path: filePath,
      message: "Recording downloaded successfully",
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
