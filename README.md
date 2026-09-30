# ⚡ Zenith Growth — Multi-Tool Web Ecosystem

An all-in-one web suite featuring:
- 🎬 **Zenith Universal Video & Audio Downloader**: Extract and download 4K/1080p/720p MP4 videos & 320kbps MP3 audio from YouTube, Twitter/X, Instagram, TikTok, Facebook, Reddit, Pinterest, SoundCloud, and 1000+ platforms (powered by yt-dlp & FFmpeg).
- ✂️ **Video Editor & Clip Studio**: Trim clips, real-time 60fps color filters, animated sprinkles/particles, watermark removal, and dynamic social aspect ratio reframing (9:16, 4:5, 1:1, 16:9).
- 📄 **Zenith PDF & Graphic Suite**: 14+ client-side tools: AI Background Remover, Compress PDF, Sign PDF, Merge, Split, Protect, Unlock, Rotate, Watermark, and Invoice Generator.

---

## 🚀 1-Click Cloud Deployment (Render.com)

This repository includes a pre-configured `render.yaml` for zero-configuration deployment on [Render](https://render.com):

1. Push this repository to **GitHub**.
2. Go to **[Render Dashboard](https://dashboard.render.com)**.
3. Click **New +** → **Blueprint** (or **Web Service**).
4. Connect your GitHub repository.
5. Render will automatically detect the settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install` (automatically downloads Linux `yt-dlp` and `ffmpeg`)
   - **Start Command**: `node gateway.js`
   - **Health Check Path**: `/api/status`
6. Click **Deploy**. Your live server will be active in minutes!

---

## 🛠️ Deploying on Ubuntu / VPS / DigitalOcean / AWS

```bash
# 1. Clone repository
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO

# 2. Install dependencies (auto-downloads yt-dlp and sets up ffmpeg)
npm install

# 3. Start the gateway server
node gateway.js
```

To run continuously in the background on a VPS, use **PM2**:
```bash
npm install -g pm2
pm2 start gateway.js --name "zenith-suite"
pm2 save
pm2 startup
```

---

## 💻 Running Locally (Windows / Mac / Linux)

```bash
npm install
node gateway.js
```

Open your browser at:
- **Main Portal**: `http://localhost:3000`
- **Video Downloader**: `http://localhost:3000/video-downloader`
- **Video Editor Studio**: `http://localhost:3000/video-editor`

---

## 📂 Project Structure

```text
├── gateway.js                 # Master Gateway & Router (Port 3000)
├── server.js                  # Downloader API & FFmpeg pipeline
├── package.json               # Dependencies & automated Linux binary installer
├── render.yaml                # Render cloud blueprint
├── video-downloader.html       # Video Downloader Web UI
├── video-downloader.css        # Downloader Styling
├── video-downloader.js         # Frontend Downloader Logic & Multi-Origin API Resolver
├── video-editor.html          # Video Editor & Clipper Studio
├── index.html                 # Main Zenith PDF & Web Tools Portal
├── *.html                     # Individual tools (bg-remover, compress-pdf, merge, etc.)
└── universal-video-downloader/# Sub-app package mirror
```
