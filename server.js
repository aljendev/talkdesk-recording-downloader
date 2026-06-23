const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DOWNLOADS_DIR = path.join(__dirname, "downloads");
const DELAY_MS = 5 * 60 * 1000; // 5 minutes

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// ─── OAuth Token Helper ───────────────────────────────────────────────────────
async function getTalkdeskToken() {
  const accountName = process.env.TALKDESK_ACCOUNT_NAME;
  if (!accountName) throw new Error("TALKDESK_ACCOUNT_NAME environment variable is not set");

  const authUrl = `https://${accountName}.talkdeskid.com/oauth/token`;
  console.log(`[AUTH] Getting token from: ${authUrl}`);

  const response = await axios.post(
    authUrl,
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.TALKDESK_CLIENT_ID,
      client_secret: process.env.TALKDESK_CLIENT_SECRET,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  console.log(`[AUTH] Token obtained successfully`);
  return response.data.access_token;
}

// ─── Background Job: wait 5 min, then fetch & download ───────────────────────
async function processRecording(interaction_id) {
  console.log(`[JOB] Received interaction_id: ${interaction_id}`);
  console.log(`[JOB] Waiting 5 minutes before fetching recording...`);

  await new Promise((resolve) => setTimeout(resolve, DELAY_MS));

  console.log(`[JOB] 5 minutes passed. Fetching recording for: ${interaction_id}`);

  try {
    // Step 1: Get token
    const token = await getTalkdeskToken();

    // Step 2: Get recordings list
    const callRecordingsUrl = `https://api.talkdeskapp.com/calls/${interaction_id}/recordings`;
    console.log(`[JOB] Fetching recordings list: ${callRecordingsUrl}`);

    let recordingsListResponse;
    try {
      recordingsListResponse = await axios.get(callRecordingsUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data || err.message;
      console.error(`[JOB] Failed to fetch recordings list. Status: ${status}`, detail);
      return;
    }

    const recordings = recordingsListResponse.data?._embedded?.recordings;
    console.log(`[JOB] Found ${recordings?.length || 0} recording(s)`);

    if (!recordings || recordings.length === 0) {
      console.warn(`[JOB] No recordings found for interaction_id: ${interaction_id}`);
      return;
    }

    // Step 3: Download each recording immediately via media href
    for (const recording of recordings) {
      const mediaUrl = recording._links?.media?.href;
      const recordingId = recording.id;

      if (!mediaUrl) {
        console.warn(`[JOB] No media href for recording ${recordingId}, skipping`);
        continue;
      }

      console.log(`[JOB] Downloading immediately from: ${mediaUrl}`);

      let mediaResponse;
      try {
        mediaResponse = await axios.get(mediaUrl, {
          headers: { Authorization: `Bearer ${token}` },
          responseType: "stream",
          maxRedirects: 5,
        });
      } catch (err) {
        const status = err.response?.status;
        const detail = err.response?.data || err.message;
        console.error(`[JOB] Failed to download media. Status: ${status}`, detail);
        continue;
      }

      const contentType = mediaResponse.headers["content-type"] || "";
      const ext = contentType.includes("mp3") ? "mp3"
        : contentType.includes("wav") ? "wav"
        : contentType.includes("ogg") ? "ogg"
        : "mp3";

      const filename = `${interaction_id}_${recordingId}.${ext}`;
      const filePath = path.join(DOWNLOADS_DIR, filename);

      const writer = fs.createWriteStream(filePath);
      mediaResponse.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      console.log(`[JOB] ✅ Downloaded and saved: ${filename}`);
    }

  } catch (err) {
    console.error(`[JOB] Unexpected error:`, err.message);
  }
}

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Talkdesk Recording Downloader is running" });
});

// ─── Main Endpoint ────────────────────────────────────────────────────────────
app.post("/download-recording", (req, res) => {
  const { interaction_id } = req.body;

  if (!interaction_id) {
    return res.status(400).json({ error: "interaction_id is required" });
  }

  const scheduledAt = new Date();
  const downloadAt = new Date(scheduledAt.getTime() + DELAY_MS);

  console.log(`[API] Received interaction_id: ${interaction_id}`);
  console.log(`[API] Will fetch recording at: ${downloadAt.toISOString()}`);

  // Run in background — don't await
  processRecording(interaction_id);

  // Respond immediately to Talkdesk
  res.json({
    success: true,
    interaction_id,
    message: "Request received. Will wait 5 minutes then fetch and download recording immediately.",
    scheduled_at: scheduledAt.toISOString(),
    fetch_at: downloadAt.toISOString(),
  });
});

// ─── List Downloaded Files ────────────────────────────────────────────────────
app.get("/recordings", (req, res) => {
  const files = fs.readdirSync(DOWNLOADS_DIR).map((f) => ({
    filename: f,
    size_bytes: fs.statSync(path.join(DOWNLOADS_DIR, f)).size,
    download_url: `/recordings/download/${f}`,
  }));
  res.json({ count: files.length, files });
});

// ─── Download File ────────────────────────────────────────────────────────────
app.get("/recordings/download/:filename", (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(DOWNLOADS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "audio/mpeg");
  res.sendFile(filePath);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
