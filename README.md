# Talkdesk Recording Downloader

An Express server hosted on Render that downloads Talkdesk call recordings via OAuth and saves them locally.

---

## API Endpoints

### `POST /download-recording`
Downloads a recording for a given interaction ID.

**Request Body:**
```json
{ "interaction_id": "abc123xyz" }
```

**Success Response:**
```json
{
  "success": true,
  "interaction_id": "abc123xyz",
  "filename": "abc123xyz_1718600000000.mp3",
  "path": "/opt/render/project/src/downloads/abc123xyz_1718600000000.mp3",
  "message": "Recording downloaded successfully"
}
```

---

### `GET /recordings`
Lists all downloaded recordings.

### `GET /`
Health check.

---

## Environment Variables

| Variable | Description |
|---|---|
| `TALKDESK_CLIENT_ID` | Your Talkdesk OAuth Client ID |
| `TALKDESK_CLIENT_SECRET` | Your Talkdesk OAuth Client Secret |
| `PORT` | Port (Render sets this automatically) |

---

## Local Development

```bash
npm install
cp .env.example .env
# Fill in your credentials in .env
npm run dev
```

---

## Deploy to Render

See the step-by-step guide below.
