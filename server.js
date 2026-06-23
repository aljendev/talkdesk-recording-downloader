const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DOWNLOADS_DIR = path.join(__dirname, "downloads");
const DELAY_MS = 10 * 60 * 1000; // 10 minutes

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// ─── Delay Helper ─────────────────────────────────────────────────────────────
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── OAuth Token Helper ───────────────────────────────────────────────────────
async function getTalkdeskToken() {
  const accountName = process.env.TALKDESK_ACCOUNT_NAME;
  if (!accountName) throw new Error("TALKDESK_ACCOUNT_NAME environment variable is not set");

  const authUrl = `https://${accountName}.talkdeskid.com/oauth/token`;
  console.log(`[STEP 1] Getting token from: ${authUrl}`);

  const response = await axios.post(
    authUrl,
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.TALKDESK_CLIENT_ID,
      client_secret: process.env.TALKDESK_CLIENT_SECRET,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  console.log(`[STEP 1] Token obtained successfully`);
  return response.data.access_token;
}

// ─── Core Download Function ───────────────────────────────────────────────────
async function processRecording(interaction_id) {
  // STEP 1: Get token
  const token = await getTalkdeskToken();

  // STEP 2: Get recordings list
  const callRecordingsUrl = `https://api.talkdeskapp.com/calls/${interaction_id}/recordings`;
  console.log(`[STEP 2] Fetching recordings list: ${callRecordingsUrl}`);

  let recordingsListResponse;
  try {
    recordingsListResponse = await axios.get(callRecordingsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data || err.message;
    console.error(`[STEP 2 FAILED] Status: ${status}`, detail);
    throw { step: 2, status, detail, url: callRecordingsUrl };
  }

  const recordings = recordingsListResponse.data?._embedded?.recordings;
  console.log(`[STEP 2] Found ${recordings?.length || 0} recording(s)`);

  if (!recordings || recordings.length === 0) {
    throw { step: 2, status: 404, detail: "No recordings found for this interaction_id" };
  }

  // STEP 3: Download each recording
  const downloadedFiles = [];

  for (const recording of recordings) {
    const mediaUrl = recording._links?.media?.href;
    const recordingId = recording.id;

    if (!mediaUrl) {
      console.warn(`[STEP 3] No media href for recording ${recordingId}, skipping`);
      continue;
    }

    console.log(`[STEP 3] Downloading recording ${recordingId} from: ${mediaUrl}`);

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
      console.error(`[STEP 3 FAILED] Status: ${status}`, detail);
      throw { step: 3, status, detail, url: mediaUrl };
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

    console.log(`[STEP 3] Saved: ${filename}`);
    downloadedFiles.push({ recording_id: recordingId, filename, path: filePath });
  }

  return { recordings_found: recordings.length, downloaded: downloadedFiles };
}

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Talkdesk Recording Downloader is running" });
});

// ─── Main Endpoint ────────────────────────────────────────────────────────────
app.post("/download-recording", async (req, res) => {
  const { interaction_id } = req.body;

  if (!interaction_id) {
    return res.status(400).json({ error: "interaction_id is required" });
  }

  // Respond immediately so Postman/caller doesn't hang for 5 mins
  res.json({
    success: true,
    interaction_id,
    message: "Request received. Recording will be downloaded in 10 minutes.",
    scheduled_at: new Date().toISOString(),
    download_at: new Date(Date.now() + DELAY_MS).toISOString(),
  });

  // Wait 5 minutes then download in the background
  console.log(`[SCHEDULED] Will download recording for ${interaction_id} in 10 minutes...`);
  await delay(DELAY_MS);
  console.log(`[STARTING] Now downloading recording for ${interaction_id}...`);

  try {
    const result = await processRecording(interaction_id);
    console.log(`[DONE] Downloaded ${result.downloaded.length} file(s) for ${interaction_id}`);
    result.downloaded.forEach((f) => console.log(`  → ${f.filename}`));
  } catch (err) {
    console.error(`[FAILED] Recording download failed for ${interaction_id}:`, err);
  }
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
