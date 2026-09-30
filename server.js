const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn, exec, execSync } = require('child_process');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 4000;

// Permissive CORS for cross-port, Live Server, and file:// access
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Paths
const ROOT_DIR = __dirname;
const BIN_DIR = path.join(ROOT_DIR, 'bin');
const DOWNLOADS_DIR = path.join(ROOT_DIR, 'downloads');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Process-level safety against crashes
process.on('uncaughtException', (err) => {
  console.error('[SERVER UNCAUGHT EXCEPTION]:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[SERVER UNHANDLED REJECTION]:', reason);
});

// Locate Binaries dynamically with multi-path fallback
const isWindows = process.platform === 'win32';

function findBinary(name) {
  const exeName = isWindows ? `${name}.exe` : name;
  const searchDirs = [
    BIN_DIR,
    path.join(ROOT_DIR, 'bin'),
    path.join(ROOT_DIR, 'universal-video-downloader', 'bin'),
    path.join(ROOT_DIR, 'READY-FOR-GITHUB', 'bin'),
    path.join(ROOT_DIR, '..', 'universal-video-downloader', 'bin'),
    path.join(ROOT_DIR, '..', 'bin'),
    path.join(process.cwd(), 'bin'),
    path.join(process.cwd(), 'universal-video-downloader', 'bin')
  ];

  for (const dir of searchDirs) {
    const candidate = path.join(dir, exeName);
    if (fs.existsSync(candidate)) return candidate;
  }

  // Fallback to system PATH
  try {
    execSync(`"${name}" --version`, { stdio: 'ignore' });
    return name;
  } catch (e) {}

  return path.join(BIN_DIR, exeName);
}

let YTDLP_BIN = findBinary('yt-dlp');
let FFMPEG_BIN = findBinary('ffmpeg');

// Cross-platform ffmpeg resolution fallback
if (!checkBinary(FFMPEG_BIN)) {
  try {
    const staticFfmpeg = require('ffmpeg-static');
    if (staticFfmpeg && fs.existsSync(staticFfmpeg)) {
      FFMPEG_BIN = staticFfmpeg;
    }
  } catch (e) {}
}

// Ensure Linux yt-dlp binary exists if deployed on Linux (e.g. Render.com / Ubuntu)
if (!isWindows) {
  if (!fs.existsSync(YTDLP_BIN)) {
    try {
      console.log('Downloading Linux yt-dlp binary for cloud hosting...');
      fs.mkdirSync(path.dirname(YTDLP_BIN), { recursive: true });
      execSync(`curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "${YTDLP_BIN}" && chmod a+rx "${YTDLP_BIN}"`, { stdio: 'inherit' });
      console.log('Linux yt-dlp ready at:', YTDLP_BIN);
    } catch (err) {
      console.warn('Could not auto-download Linux yt-dlp, checking system PATH:', err.message);
      YTDLP_BIN = 'yt-dlp';
    }
  } else {
    try { fs.chmodSync(YTDLP_BIN, 0o755); } catch (e) {}
  }
}

function checkBinary(binPath) {
  if (!binPath) return false;
  if (fs.existsSync(binPath)) return true;
  try {
    execSync(`"${binPath}" --version`, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

// Active download jobs in memory
const downloadJobs = new Map();

// Helper to sanitize filenames
function sanitizeFilename(name) {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim();
}

// Helper to clean & normalize incoming social media URLs
function cleanAndNormalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let u = rawUrl.trim();
  // Strip surrounding quotes
  u = u.replace(/^["']+|["']+$/g, '');
  // Strip trailing punctuation often accidentally included from copy-pasting (commas, periods, semicolons, backslashes)
  u = u.replace(/[,;.\\/]+$/g, '').trim();

  // If Twitter/X URL ending with /video or /photo without index (e.g. /status/12345/video)
  if (/https?:\/\/(www\.)?(x\.com|twitter\.com)\/[^/]+\/status\/\d+\/(video|photo)$/i.test(u)) {
    u = u.replace(/\/(video|photo)$/i, '');
  }

  return u;
}

// Helper to format bytes
function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Helper to format seconds to MM:SS or HH:MM:SS
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return 'Unknown';
  const sec = Math.floor(seconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Convert HH:MM:SS to total seconds
function parseHmsToSeconds(hms) {
  if (!hms) return 0;
  if (typeof hms === 'number') return hms;
  const parts = hms.toString().trim().split(':').map(Number);
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  if (parts.length === 2) return (parts[0] * 60) + parts[1];
  if (parts.length === 1 && !isNaN(parts[0])) return parts[0];
  return 0;
}

// Convert seconds to HH:MM:SS string
function formatSecondsToHms(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Construct dynamic FFmpeg filter pipeline for framing, watermark removal, color grading, and sprinkles
function buildVideoFilterChain(options = {}) {
  const {
    colorFilter,
    sprinkleEffect,
    aspectRatio,
    watermarkMode,
    wmBox,
    isPreview,
    zoomLevel,
    panX,
    panY,
    backdropStyle
  } = options;
  const baseFilters = [];

  // 1. Watermark Removal (Zoom / Delogo Blur / Custom Box Blur)
  if (watermarkMode === 'zoom') {
    // Zooms in 8% from center, pushing corner watermarks and edge tags outside frame
    baseFilters.push('crop=in_w*0.92:in_h*0.92:(in_w-out_w)/2:(in_h-out_h)/2');
  } else if (watermarkMode === 'box' && wmBox) {
    const bx = Math.max(0, Math.round(wmBox.x || 0));
    const by = Math.max(0, Math.round(wmBox.y || 0));
    const bw = Math.max(16, Math.round(wmBox.w || 160));
    const bh = Math.max(16, Math.round(wmBox.h || 60));
    baseFilters.push(`delogo=x=${bx}:y=${by}:w=${bw}:h=${bh}:show=0`);
  } else if (watermarkMode === 'blur_corner' || watermarkMode === 'blur') {
    baseFilters.push('delogo=x=W-200:y=H-100:w=180:h=80:show=0');
  }

  // 2. Aspect Ratio & Screen Size Framing with Zoom, Pan & Letterbox Backdrop
  const targetDims = isPreview ? {
    '9:16': [540, 960],
    '4:5': [540, 675],
    '1:1': [540, 540],
    '16:9': [960, 540]
  } : {
    '9:16': [1080, 1920],
    '4:5': [1080, 1350],
    '1:1': [1080, 1080],
    '16:9': [1920, 1080]
  };

  const z = Math.max(0.15, Math.min(3.0, (typeof zoomLevel === 'number' ? zoomLevel : parseFloat(zoomLevel || 100)) / 100));
  const padColor = (backdropStyle === 'clean-white') ? 'white' : (backdropStyle === 'dark-cinema' ? '0x111216' : (backdropStyle === 'midnight' ? '0x0a0f1d' : 'black'));

  if (targetDims[aspectRatio]) {
    const [tw, th] = targetDims[aspectRatio];
    const ox = Math.round((panX || 0) * (tw * 0.45) / 100);
    const oy = Math.round((panY || 0) * (th * 0.45) / 100);

    if (z <= 1.0) {
      baseFilters.push(`scale=w='trunc(min(${tw}*${z}\\,iw*${th}*${z}/ih)/2)*2':h='trunc(min(${th}*${z}\\,ih*${tw}*${z}/iw)/2)*2':force_original_aspect_ratio=decrease,pad=${tw}:${th}:(ow-iw)/2+(${ox}):(oh-ih)/2+(${oy}):color=${padColor}`);
    } else {
      baseFilters.push(`scale=w='trunc(max(${tw}*${z}\\,iw*${th}*${z}/ih)/2)*2':h='trunc(max(${th}*${z}\\,ih*${tw}*${z}/iw)/2)*2',crop=${tw}:${th}:(in_w-out_w)/2+(${ox}):(in_h-out_h)/2+(${oy})`);
    }
  } else {
    if (z < 1.0) {
      baseFilters.push(`scale=trunc(iw*${z}/2)*2:trunc(ih*${z}/2)*2,pad=trunc(iw/${z}/2)*2:trunc(ih/${z}/2)*2:(ow-iw)/2:(oh-ih)/2:color=${padColor}`);
    } else {
      baseFilters.push(isPreview ? 'scale=trunc(min(960\\,iw)/2)*2:trunc(min(540\\,ih)/2)*2' : 'scale=trunc(min(1920\\,iw)/2)*2:trunc(min(1080\\,ih)/2)*2');
    }
  }

  // 3. Color Grading Filter
  if (colorFilter === 'warm') {
    baseFilters.push('eq=contrast=1.15:brightness=0.02:saturation=1.2,colorbalance=rs=0.15:gs=0.02:bs=-0.1:rm=0.12:gm=0.02:bm=-0.08');
  } else if (colorFilter === 'cyberpunk') {
    baseFilters.push('colorbalance=rs=-0.12:gs=0.02:bs=0.22:rm=-0.08:gm=0.02:bm=0.18:rh=0.22:gh=0.04:bh=-0.15,eq=contrast=1.2:saturation=1.3');
  } else if (colorFilter === 'noir') {
    baseFilters.push('colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3,eq=contrast=1.35:brightness=-0.02');
  } else if (colorFilter === 'vivid') {
    baseFilters.push('eq=contrast=1.2:saturation=1.45:brightness=0.02');
  } else if (colorFilter === 'vintage') {
    baseFilters.push('eq=contrast=1.18:saturation=0.85:brightness=0.04,curves=vintage');
  } else if (colorFilter === 'teal') {
    baseFilters.push('colorchannelmixer=1:0:0:0:0:1:0:0:0:0.1:0.9:0,eq=contrast=1.2:saturation=1.25');
  } else if (colorFilter === 'golden') {
    baseFilters.push('colorbalance=rs=0.2:gs=0.08:bs=-0.15:rm=0.15:gm=0.05:bm=-0.1,eq=contrast=1.1:saturation=1.25');
  }

  const baseFilterStr = baseFilters.join(',');

  // 4. Sprinkles & In-Frame Particles Filter
  if (sprinkleEffect === 'sparkles' || sprinkleEffect === 'sprinkles') {
    const complexGraph = `[0:v]${baseFilterStr}[base];color=black:s=640x360:d=999,noise=alls=16:allf=t+u,eq=contrast=2.8:brightness=-0.45[p_raw];[p_raw][base]scale2ref[p_scaled][base_ref];[base_ref][p_scaled]blend=all_mode=screen:shortest=1[outv]`;
    return { isComplex: true, filter: complexGraph };
  } else if (sprinkleEffect === 'bokeh') {
    const complexGraph = `[0:v]${baseFilterStr}[base];color=black:s=640x360:d=999,noise=alls=12:allf=t+u,boxblur=2:2,eq=contrast=2.2:brightness=-0.2[p_raw];[p_raw][base]scale2ref[p_scaled][base_ref];[base_ref][p_scaled]blend=all_mode=screen:shortest=1[outv]`;
    return { isComplex: true, filter: complexGraph };
  } else if (sprinkleEffect === 'filmgrain') {
    baseFilters.push('noise=alls=16:allf=t+u');
    return { isComplex: false, filter: baseFilters.join(',') };
  } else {
    return { isComplex: false, filter: baseFilterStr };
  }
}

// Platform detection helper
function detectPlatform(url) {
  if (!url) return { name: 'Unknown', icon: 'globe', color: 'gray' };
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) {
    return { name: 'YouTube', icon: 'youtube', color: '#ff0000', badgeClass: 'badge-youtube' };
  }
  if (lower.includes('instagram.com')) {
    return { name: 'Instagram', icon: 'instagram', color: '#e1306c', badgeClass: 'badge-instagram' };
  }
  if (lower.includes('tiktok.com')) {
    return { name: 'TikTok', icon: 'tiktok', color: '#00f2fe', badgeClass: 'badge-tiktok' };
  }
  if (lower.includes('facebook.com') || lower.includes('fb.watch') || lower.includes('fb.com')) {
    return { name: 'Facebook', icon: 'facebook', color: '#1877f2', badgeClass: 'badge-facebook' };
  }
  if (lower.includes('twitter.com') || lower.includes('x.com')) {
    return { name: 'X / Twitter', icon: 'twitter', color: '#1da1f2', badgeClass: 'badge-twitter' };
  }
  if (lower.includes('reddit.com') || lower.includes('redd.it')) {
    return { name: 'Reddit', icon: 'reddit', color: '#ff4500', badgeClass: 'badge-reddit' };
  }
  if (lower.includes('pinterest.com') || lower.includes('pin.it')) {
    return { name: 'Pinterest', icon: 'pinterest', color: '#e60023', badgeClass: 'badge-pinterest' };
  }
  if (lower.includes('linkedin.com')) {
    return { name: 'LinkedIn', icon: 'linkedin', color: '#0077b5', badgeClass: 'badge-linkedin' };
  }
  if (lower.includes('vimeo.com')) {
    return { name: 'Vimeo', icon: 'vimeo', color: '#1ab7ea', badgeClass: 'badge-vimeo' };
  }
  if (lower.includes('twitch.tv')) {
    return { name: 'Twitch', icon: 'twitch', color: '#9146ff', badgeClass: 'badge-twitch' };
  }
  if (lower.includes('soundcloud.com')) {
    return { name: 'SoundCloud', icon: 'soundcloud', color: '#ff5500', badgeClass: 'badge-soundcloud' };
  }
  if (lower.includes('threads.net')) {
    return { name: 'Threads', icon: 'threads', color: '#000000', badgeClass: 'badge-threads' };
  }
  return { name: 'Universal Web', icon: 'globe', color: '#6366f1', badgeClass: 'badge-universal' };
}

// Serve static frontend files when run directly as standalone
if (require.main === module) {
  app.use(express.static(PUBLIC_DIR));
}

// Endpoint: Health & System Status
app.get('/api/status', (req, res) => {
  const ytdlpExists = checkBinary(YTDLP_BIN);
  const ffmpegExists = checkBinary(FFMPEG_BIN);

  let ytdlpVersion = 'Not installed';
  if (ytdlpExists) {
    try {
      ytdlpVersion = execSync(`"${YTDLP_BIN}" --version`).toString().trim();
    } catch (e) {
      ytdlpVersion = 'Error checking version';
    }
  }

  res.json({
    status: 'ok',
    ytdlp: { exists: ytdlpExists, version: ytdlpVersion, path: YTDLP_BIN },
    ffmpeg: { exists: ffmpegExists, path: FFMPEG_BIN },
    downloadsDir: DOWNLOADS_DIR,
    platform: process.platform,
    time: new Date().toISOString()
  });
});

// Endpoint: Inspect & Extract Metadata from URL
app.post('/api/inspect', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string' || !url.trim().startsWith('http')) {
    return res.status(400).json({ error: 'Please provide a valid media URL starting with http:// or https://' });
  }

  const cleanUrl = cleanAndNormalizeUrl(url);
  const platform = detectPlatform(cleanUrl);

  const runYtDlpInspect = (targetUrl) => {
    return new Promise((resolve, reject) => {
      const args = [
        '--dump-single-json',
        '--no-warnings',
        '--no-playlist',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '--js-runtimes', 'node',
        targetUrl
      ];

      const ytdlpProc = spawn(YTDLP_BIN, args);
      let stdoutData = '';
      let stderrData = '';

      ytdlpProc.stdout.on('data', (chunk) => {
        stdoutData += chunk.toString();
      });

      ytdlpProc.stderr.on('data', (chunk) => {
        stderrData += chunk.toString();
      });

      ytdlpProc.on('error', (err) => {
        reject(new Error(`Downloader process execution error: ${err.message}`));
      });

      ytdlpProc.on('close', (code) => {
        if (code === 0 && stdoutData.trim()) {
          try {
            resolve(JSON.parse(stdoutData));
          } catch (e) {
            reject(new Error('Failed to parse metadata JSON from media source.'));
          }
        } else {
          reject(new Error(stderrData || `Downloader exited with error code ${code}`));
        }
      });
    });
  };

  let data = null;
  let lastError = null;

  // Attempt 1: inspect cleanUrl directly
  try {
    data = await runYtDlpInspect(cleanUrl);
  } catch (err) {
    lastError = err.message;
    console.warn(`[Inspect] Primary attempt failed for ${cleanUrl}:`, err.message.slice(0, 160));

    // Attempt 2: If x.com, retry with twitter.com
    if (cleanUrl.includes('x.com')) {
      const twitterUrl = cleanUrl.replace('x.com', 'twitter.com');
      try {
        console.log(`[Inspect] Retrying with twitter.com mirror: ${twitterUrl}`);
        data = await runYtDlpInspect(twitterUrl);
      } catch (err2) {
        lastError = err2.message;
      }
    } else if (cleanUrl.includes('twitter.com')) {
      const xUrl = cleanUrl.replace('twitter.com', 'x.com');
      try {
        console.log(`[Inspect] Retrying with x.com: ${xUrl}`);
        data = await runYtDlpInspect(xUrl);
      } catch (err3) {
        lastError = err3.message;
      }
    }

    // Attempt 3: If URL had /video/1 or /video, strip down to base status URL
    if (!data && /\/status\/\d+\/(video|photo)/i.test(cleanUrl)) {
      const baseStatusUrl = cleanUrl.replace(/\/(video|photo)(\/\d+)?.*$/i, '');
      try {
        console.log(`[Inspect] Retrying with base tweet URL: ${baseStatusUrl}`);
        data = await runYtDlpInspect(baseStatusUrl);
      } catch (err4) {
        lastError = err4.message;
      }
    }
  }

  if (!data) {
    return res.status(500).json({
      error: 'Failed to inspect link. The video may be private, age-restricted, or removed.',
      details: (lastError || 'Could not fetch metadata').slice(0, 500)
    });
  }

  try {
    // Check if the response contains multiple entries (multi-video tweet or thread playlist)
    let activeMedia = data;
    const entries = Array.isArray(data.entries) ? data.entries.filter(Boolean) : null;
    let selectedIndex = 0;

    if (entries && entries.length > 0) {
      const videoNumMatch = cleanUrl.match(/\/video\/(\d+)/i);
      if (videoNumMatch && videoNumMatch[1]) {
        selectedIndex = Math.max(0, Math.min(entries.length - 1, parseInt(videoNumMatch[1], 10) - 1));
      }
      activeMedia = entries[selectedIndex] || entries.find(e => e.formats && e.formats.length > 0) || entries[0] || data;
    }

    // Process and extract clean format options
    const rawFormats = activeMedia.formats || data.formats || [];
    const videoFormatsMap = new Map();

    // Check available video heights (1080p, 1440p 2K, 2160p 4K, 8K, 720p HD, etc.)
    rawFormats.forEach((f) => {
      if (f.vcodec && f.vcodec !== 'none') {
        const height = f.height || 0;
        if (height > 0) {
          let estimatedSize = f.filesize || f.filesize_approx || null;
          if (!estimatedSize && (f.tbr || f.vbr) && (activeMedia.duration || data.duration)) {
            estimatedSize = Math.round(((f.tbr || f.vbr) * 1024 / 8) * (activeMedia.duration || data.duration));
          }
          if (!videoFormatsMap.has(height) || (f.tbr && f.tbr > (videoFormatsMap.get(height).tbr || 0))) {
            videoFormatsMap.set(height, {
              height: height,
              label: `${height}p` + (height >= 4320 ? ' (8K Ultra HD)' : height >= 2160 ? ' (4K UHD)' : height >= 1440 ? ' (2K QHD)' : height >= 1080 ? ' (Full HD)' : height >= 720 ? ' (HD)' : ' (SD)'),
              ext: 'mp4',
              fps: f.fps || null,
              filesize: estimatedSize,
              filesizeFormatted: formatBytes(estimatedSize),
              format_id: f.format_id,
              tbr: f.tbr || 0
            });
          }
        }
      }
    });

    // Sort video formats high to low
    const videoOptions = Array.from(videoFormatsMap.values()).sort((a, b) => b.height - a.height);

    // Always include "Best Quality Available" preset at top
    videoOptions.unshift({
      height: 'best',
      label: 'Best Available (Auto MP4)',
      ext: 'mp4',
      fps: null,
      filesizeFormatted: 'Dynamic / Highest',
      format_id: 'best'
    });

    // Standard Audio presets
    const audioOptions = [
      { id: 'mp3-320', label: 'MP3 High Quality', bitrate: '320kbps', ext: 'mp3', format: 'mp3', quality: '320k' },
      { id: 'mp3-192', label: 'MP3 Standard Quality', bitrate: '192kbps', ext: 'mp3', format: 'mp3', quality: '192k' },
      { id: 'mp3-128', label: 'MP3 Compact', bitrate: '128kbps', ext: 'mp3', format: 'mp3', quality: '128k' },
      { id: 'm4a-aac', label: 'M4A / AAC Audio', bitrate: 'Lossless / Native', ext: 'm4a', format: 'm4a', quality: 'best' },
      { id: 'wav', label: 'WAV Uncompressed', bitrate: 'Master Audio', ext: 'wav', format: 'wav', quality: 'best' }
    ];

    const entriesSummary = (entries && entries.length > 1) ? entries.map((e, idx) => ({
      index: idx + 1,
      title: e.title || `Video #${idx + 1}`,
      duration: e.duration,
      durationFormatted: formatDuration(e.duration),
      thumbnail: e.thumbnail || (e.thumbnails && e.thumbnails.length ? e.thumbnails[e.thumbnails.length - 1].url : ''),
      isSelected: idx === selectedIndex
    })) : null;

    res.json({
      id: activeMedia.id || data.id,
      title: activeMedia.title || data.title || 'Untitled Media',
      uploader: activeMedia.uploader || data.uploader || data.channel || data.creator || 'Creator',
      duration: activeMedia.duration || data.duration,
      durationFormatted: formatDuration(activeMedia.duration || data.duration),
      thumbnail: activeMedia.thumbnail || (activeMedia.thumbnails && activeMedia.thumbnails.length ? activeMedia.thumbnails[activeMedia.thumbnails.length - 1].url : (data.thumbnail || '')),
      webpage_url: activeMedia.webpage_url || data.webpage_url || cleanUrl,
      platform: platform,
      description: (activeMedia.description || data.description || '').slice(0, 300),
      videoOptions: videoOptions,
      audioOptions: audioOptions,
      entries: entriesSummary,
      activeVideoIndex: selectedIndex + 1
    });
  } catch (parseErr) {
    console.error('Error analyzing media response:', parseErr);
    res.status(500).json({ error: 'Error analyzing media response', details: parseErr.message });
  }
});

// Endpoint: Video Preview Generator (At least 30s Real Video Clip)
app.post('/api/preview', async (req, res) => {
  const { url, clipStart, duration, colorFilter, sprinkleEffect, aspectRatio, watermarkMode } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const previewId = 'prev_' + crypto.randomBytes(6).toString('hex');
  const tempSlicePath = path.join(DOWNLOADS_DIR, `raw_${previewId}.mp4`);
  const finalPreviewPath = path.join(DOWNLOADS_DIR, `${previewId}.mp4`);

  const startSec = parseHmsToSeconds(clipStart || '00:00:00');
  const previewDuration = Math.max(30, parseInt(duration || 30));
  const endSec = startSec + previewDuration;

  try {
    const dlArgs = [
      '--newline',
      '--no-playlist',
      '--js-runtimes', 'node',
      '--ffmpeg-location', FFMPEG_BIN,
      '--download-sections', `*${formatSecondsToHms(startSec)}-${formatSecondsToHms(endSec)}`,
      '--force-keyframes-at-cuts',
      '-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]/best',
      '-o', tempSlicePath,
      url
    ];

    const dlProc = spawn(YTDLP_BIN, dlArgs);

    dlProc.on('close', (dlCode) => {
      let sliceFile = tempSlicePath;
      if (!fs.existsSync(sliceFile)) {
        const matches = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.includes(`raw_${previewId}`));
        if (matches.length > 0) sliceFile = path.join(DOWNLOADS_DIR, matches[0]);
      }

      if (!fs.existsSync(sliceFile)) {
        return res.status(500).json({ error: 'Could not fetch media preview slice.' });
      }

      const fx = buildVideoFilterChain({
        colorFilter,
        sprinkleEffect,
        aspectRatio,
        watermarkMode,
        isPreview: true
      });

      const ffArgs = ['-y', '-i', sliceFile, '-t', previewDuration.toString()];
      if (fx.isComplex) {
        ffArgs.push('-filter_complex', fx.filter, '-map', '[outv]', '-map', '0:a?', '-shortest');
      } else if (fx.filter) {
        ffArgs.push('-vf', fx.filter, '-shortest');
      }
      ffArgs.push('-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-pix_fmt', 'yuv420p', finalPreviewPath);

      const ff = spawn(FFMPEG_BIN, ffArgs);
      ff.on('close', (fCode) => {
        try { fs.unlinkSync(sliceFile); } catch (e) {}
        if (fCode === 0 && fs.existsSync(finalPreviewPath)) {
          return res.json({
            success: true,
            previewUrl: `/api/files/${path.basename(finalPreviewPath)}`
          });
        }
        res.status(500).json({ error: 'Preview rendering failed.' });
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error creating preview.' });
  }
});

// Endpoint: Video Streaming with Range support for editor player & canvas
app.get('/api/files/stream/:filename', (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  const candidates = [
    path.join(DOWNLOADS_DIR, filename),
    path.join(ROOT_DIR, filename),
    path.join(ROOT_DIR, '..', filename),
    path.join(ROOT_DIR, 'downloads', filename),
    path.join(ROOT_DIR, '..', 'downloads', filename)
  ];
  const filePath = candidates.find(p => fs.existsSync(p));
  if (!filePath) {
    return res.status(404).send('Video file not found');
  }
  res.sendFile(filePath);
});

// Endpoint: Upload video for editor
app.post('/api/editor/upload', (req, res) => {
  const fileId = 'up_' + crypto.randomBytes(6).toString('hex');
  const rawName = req.headers['x-file-name'] || 'uploaded_video.mp4';
  const ext = path.extname(rawName) || '.mp4';
  const saveName = `${fileId}${ext}`;
  const savePath = path.join(DOWNLOADS_DIR, saveName);

  const writeStream = fs.createWriteStream(savePath);
  req.pipe(writeStream);

  writeStream.on('finish', () => {
    const stat = fs.statSync(savePath);
    res.json({
      success: true,
      filename: saveName,
      size: stat.size,
      sizeFormatted: formatBytes(stat.size),
      streamUrl: `/api/files/stream/${saveName}`
    });
  });

  writeStream.on('error', (err) => {
    res.status(500).json({ error: 'Upload failed', details: err.message });
  });
});

// Endpoint: Dedicated Video Editor Studio Export
app.post('/api/editor/export', async (req, res) => {
  const {
    sourceType,
    source,
    clipStart,
    clipEnd,
    colorFilter,
    sprinkleEffect,
    aspectRatio,
    watermarkMode,
    wmBox,
    muteAudio,
    zoomLevel,
    panX,
    panY,
    backdropStyle
  } = req.body;

  if (!source) {
    return res.status(400).json({ error: 'Video source is required' });
  }

  const exportId = 'edit_' + crypto.randomBytes(6).toString('hex');
  const finalExportPath = path.join(DOWNLOADS_DIR, `${exportId}.mp4`);

  const startSec = typeof clipStart === 'number' ? clipStart : parseHmsToSeconds(clipStart || '00:00:00');
  const endSec = typeof clipEnd === 'number' ? clipEnd : parseHmsToSeconds(clipEnd || '00:00:00');
  const hasTimeLimit = endSec > startSec;
  const durationSec = hasTimeLimit ? (endSec - startSec) : null;

  const renderLocalWithFfmpeg = (inputFilePath) => {
    const fx = buildVideoFilterChain({
      colorFilter,
      sprinkleEffect,
      aspectRatio,
      watermarkMode,
      wmBox,
      zoomLevel,
      panX,
      panY,
      backdropStyle,
      isPreview: false
    });

    const ffArgs = ['-y'];
    if (startSec > 0) {
      ffArgs.push('-ss', startSec.toString());
    }
    ffArgs.push('-i', inputFilePath);
    if (durationSec) {
      ffArgs.push('-t', durationSec.toString());
    }

    if (fx.isComplex) {
      if (muteAudio) {
        ffArgs.push('-filter_complex', fx.filter, '-map', '[outv]');
      } else {
        ffArgs.push('-filter_complex', fx.filter, '-map', '[outv]', '-map', '0:a?', '-shortest');
      }
    } else if (fx.filter) {
      ffArgs.push('-vf', fx.filter);
    }

    if (muteAudio) {
      ffArgs.push('-c:v', 'libx264', '-preset', 'veryfast', '-an', '-pix_fmt', 'yuv420p', finalExportPath);
    } else {
      ffArgs.push('-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '192k', '-pix_fmt', 'yuv420p', finalExportPath);
    }

    console.log(`[Editor Export ${exportId}] Running FFmpeg:`, ffArgs.join(' '));
    const ff = spawn(FFMPEG_BIN, ffArgs);

    let ffError = '';
    ff.stderr.on('data', d => { ffError += d.toString(); });

    ff.on('close', (fCode) => {
      if (fCode === 0 && fs.existsSync(finalExportPath)) {
        const stat = fs.statSync(finalExportPath);
        return res.json({
          success: true,
          filename: path.basename(finalExportPath),
          fileSizeFormatted: formatBytes(stat.size),
          downloadUrl: `/api/files/${path.basename(finalExportPath)}`,
          streamUrl: `/api/files/stream/${path.basename(finalExportPath)}`
        });
      }
      console.error(`[Editor Export ${exportId}] FFmpeg failed:`, ffError.slice(-500));
      return res.status(500).json({ error: 'FFmpeg export failed', details: ffError.slice(-500) });
    });
  };

  if (sourceType === 'local' || source === 'sample.mp4' || (!source.startsWith('http://') && !source.startsWith('https://'))) {
    const candidates = [
      path.join(DOWNLOADS_DIR, path.basename(source)),
      path.join(ROOT_DIR, path.basename(source)),
      path.join(ROOT_DIR, '..', path.basename(source)),
      path.join(ROOT_DIR, 'downloads', path.basename(source)),
      path.join(ROOT_DIR, '..', 'downloads', path.basename(source)),
      path.join(ROOT_DIR, 'scratch', path.basename(source))
    ];
    const localPath = candidates.find(p => fs.existsSync(p));
    if (!localPath) {
      return res.status(404).json({ error: 'Source video file not found on server' });
    }
    return renderLocalWithFfmpeg(localPath);
  }

  const tempDlPath = path.join(DOWNLOADS_DIR, `temp_src_${exportId}.mp4`);
  const dlArgs = [
    '--newline',
    '--no-playlist',
    '--js-runtimes', 'node',
    '--ffmpeg-location', FFMPEG_BIN,
    '-f', 'bestvideo+bestaudio[ext=m4a]/bestvideo+bestaudio/best',
    '--merge-output-format', 'mp4',
    '-o', tempDlPath,
    source
  ];

  if (hasTimeLimit) {
    dlArgs.push('--download-sections', `*${formatSecondsToHms(startSec)}-${formatSecondsToHms(endSec)}`);
    dlArgs.push('--force-keyframes-at-cuts');
  }

  const ytdlp = spawn(YTDLP_BIN, dlArgs);
  let ytdlpErr = '';
  ytdlp.stderr.on('data', d => { ytdlpErr += d.toString(); });

  ytdlp.on('close', (yCode) => {
    let actualSource = tempDlPath;
    if (!fs.existsSync(actualSource)) {
      const found = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.includes(`temp_src_${exportId}`));
      if (found.length > 0) actualSource = path.join(DOWNLOADS_DIR, found[0]);
    }

    if (!fs.existsSync(actualSource)) {
      return res.status(500).json({ error: 'Could not fetch video from link', details: ytdlpErr.slice(0, 300) });
    }

    renderLocalWithFfmpeg(actualSource);
  });
});

// Endpoint: Start Download Task
app.post('/api/download/start', (req, res) => {
  const { url, type, quality, customHeight, clipStart, clipEnd, colorFilter, sprinkleEffect, aspectRatio, watermarkMode, videoIndex } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const cleanUrl = cleanAndNormalizeUrl(url);

  const jobId = crypto.randomBytes(8).toString('hex');
  const jobState = {
    id: jobId,
    url: cleanUrl,
    type: type || 'video',
    quality: quality || 'best',
    clipStart: clipStart || null,
    clipEnd: clipEnd || null,
    colorFilter: colorFilter || 'none',
    sprinkleEffect: sprinkleEffect || 'none',
    aspectRatio: aspectRatio || 'original',
    watermarkMode: watermarkMode || 'none',
    percent: 0,
    speed: '0 B/s',
    eta: '--:--',
    stage: 'initializing',
    status: 'running',
    message: 'Starting download process...',
    filename: null,
    filePath: null,
    fileSize: null,
    error: null,
    createdAt: new Date().toISOString()
  };

  downloadJobs.set(jobId, jobState);

  // Build output template with quality tag and video ID
  const qualityTag = type === 'audio' ? (quality || 'audio') : (customHeight && customHeight !== 'best' ? `${customHeight}p` : 'best');
  const outputTemplate = path.join(DOWNLOADS_DIR, `%(title).120B [${qualityTag}] [%(id)s].%(ext)s`);

  const args = [
    '--newline',
    '--no-playlist',
    '--force-overwrites',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    '--js-runtimes', 'node',
    '--ffmpeg-location', FFMPEG_BIN,
    '--progress-template', 'download-progress:%(progress.downloaded_bytes)s/%(progress.total_bytes)s/%(progress._percent_str)s/%(progress._speed_str)s/%(progress._eta_str)s',
    '-o', outputTemplate
  ];

  // Specific playlist / multi-video item
  if (videoIndex && parseInt(videoIndex, 10) > 0) {
    args.push('--playlist-items', videoIndex.toString());
  }

  // If specific clip section requested, instruct yt-dlp to download only that slice
  if (clipStart && clipEnd) {
    args.push('--download-sections', `*${clipStart}-${clipEnd}`, '--force-keyframes-at-cuts');
  }

  if (type === 'audio') {
    args.push('-x');
    if (quality === 'mp3-320') {
      args.push('--audio-format', 'mp3', '--audio-quality', '320k');
    } else if (quality === 'mp3-192') {
      args.push('--audio-format', 'mp3', '--audio-quality', '192k');
    } else if (quality === 'mp3-128') {
      args.push('--audio-format', 'mp3', '--audio-quality', '128k');
    } else if (quality === 'm4a-aac') {
      args.push('--audio-format', 'm4a');
    } else if (quality === 'wav') {
      args.push('--audio-format', 'wav');
    } else {
      args.push('--audio-format', 'mp3', '--audio-quality', '320k');
    }
  } else {
    // Video: Support 4K (2160p), 2K (1440p), 1080p Full HD, 720p HD, etc.
    if (customHeight && customHeight !== 'best') {
      const h = parseInt(customHeight, 10);
      args.push('-f', `bestvideo[height=${h}]+bestaudio[ext=m4a]/bestvideo[height=${h}]+bestaudio/bestvideo[height<=${h}]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`);
    } else {
      args.push('-f', 'bestvideo+bestaudio[ext=m4a]/bestvideo+bestaudio/best');
    }
    // Ensure final container is universally playable mp4
    args.push('--merge-output-format', 'mp4');
  }

  args.push(cleanUrl);

  console.log(`[Job ${jobId}] Spawning: ${YTDLP_BIN} with args:`, args.join(' '));

  const ytdlpProcess = spawn(YTDLP_BIN, args);
  jobState.process = ytdlpProcess;

  ytdlpProcess.on('error', (err) => {
    console.error(`[Job ${jobId} error]:`, err);
    jobState.status = 'error';
    jobState.stage = 'error';
    jobState.error = 'Failed to launch downloader process: ' + err.message;
    jobState.message = jobState.error;
  });

  ytdlpProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('download-progress:')) {
        const parts = trimmed.substring('download-progress:'.length).split('/');
        const percentStr = (parts[2] || '').replace('%', '').trim();
        const speedStr = (parts[3] || '').trim();
        const etaStr = (parts[4] || '').trim();

        const numPercent = parseFloat(percentStr);
        if (!isNaN(numPercent)) {
          jobState.percent = Math.min(100, Math.max(0, numPercent));
        }
        if (speedStr && speedStr !== 'NA') jobState.speed = speedStr;
        if (etaStr && etaStr !== 'NA') jobState.eta = etaStr;
        jobState.stage = 'downloading';
        jobState.message = `Downloading: ${jobState.percent}% at ${jobState.speed}`;
      } else if (trimmed.includes('[Merger]') || trimmed.includes('[Fixup') || trimmed.includes('Merging formats into')) {
        jobState.stage = 'muxing';
        jobState.message = 'Processing and merging video + audio with FFmpeg...';
        jobState.percent = 92;
        const mergerMatch = trimmed.match(/Merging formats into ["']?([^"'\r\n]+)["']?/i);
        if (mergerMatch && mergerMatch[1]) {
          const rawPath = mergerMatch[1].trim();
          jobState.filename = path.basename(rawPath);
          jobState.filePath = path.isAbsolute(rawPath) ? rawPath : path.join(DOWNLOADS_DIR, path.basename(rawPath));
        }
      } else if (trimmed.includes('[ExtractAudio]') || trimmed.includes('Destination:')) {
        if (trimmed.includes('Destination:')) {
          const destMatch = trimmed.match(/Destination:\s*(.+)$/i);
          if (destMatch && destMatch[1]) {
            const rawPath = destMatch[1].trim();
            jobState.filename = path.basename(rawPath);
            jobState.filePath = path.isAbsolute(rawPath) ? rawPath : path.join(DOWNLOADS_DIR, path.basename(rawPath));
          }
        }
      }
    }
  });

  ytdlpProcess.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      console.warn(`[Job ${jobId} stderr]:`, text);
      if (text.includes('ERROR:')) {
        jobState.error = text;
      }
    }
  });

  ytdlpProcess.on('close', (code) => {
    console.log(`[Job ${jobId}] Exited with code ${code}`);
    if (code === 0) {
      // Find the actual produced file in downloads
      if (!jobState.filePath || !fs.existsSync(jobState.filePath)) {
        try {
          const files = fs.readdirSync(DOWNLOADS_DIR)
            .filter(f => {
              try {
                const s = fs.statSync(path.join(DOWNLOADS_DIR, f));
                return s.size > 1024 && !f.startsWith('FX_') && !f.startsWith('test_');
              } catch (e) { return false; }
            })
            .map(f => ({
              name: f,
              time: fs.statSync(path.join(DOWNLOADS_DIR, f)).mtime.getTime()
            })).sort((a, b) => b.time - a.time);

          if (files.length > 0) {
            jobState.filename = files[0].name;
            jobState.filePath = path.join(DOWNLOADS_DIR, files[0].name);
          }
        } catch (e) {
          console.error('Error finding output file:', e);
        }
      }

      if (jobState.filePath && fs.existsSync(jobState.filePath)) {
        const hasFx = (colorFilter && colorFilter !== 'none') || 
                      (sprinkleEffect && sprinkleEffect !== 'none') ||
                      (aspectRatio && aspectRatio !== 'original') ||
                      (watermarkMode && watermarkMode !== 'none');

        // Apply Framing, Watermark Remover, Color Grade and Sprinkles with FFmpeg if requested
        if (hasFx && type !== 'audio') {
          jobState.stage = 'filtering';
          jobState.percent = 95;
          jobState.message = 'Applying Screen Framing, Watermark Removal & Visual FX with FFmpeg...';

          const rawPath = jobState.filePath;
          const fxExt = path.extname(rawPath) || '.mp4';
          const fxBasename = path.basename(rawPath, fxExt);
          const fxPrefix = `FX_${aspectRatio || 'orig'}_${watermarkMode !== 'none' ? 'wm_' : ''}${colorFilter || 'col'}_${sprinkleEffect || 'spr'}_`;
          const fxOutputPath = path.join(DOWNLOADS_DIR, `${fxPrefix}${fxBasename}${fxExt}`);

          const fx = buildVideoFilterChain({
            colorFilter,
            sprinkleEffect,
            aspectRatio,
            watermarkMode,
            isPreview: false
          });

          let ffmpegArgs = ['-y', '-i', rawPath];
          if (fx.isComplex) {
            ffmpegArgs.push('-filter_complex', fx.filter, '-map', '[outv]', '-map', '0:a?', '-shortest');
          } else if (fx.filter) {
            ffmpegArgs.push('-vf', fx.filter, '-shortest');
          }

          ffmpegArgs.push('-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'copy', '-pix_fmt', 'yuv420p', fxOutputPath);

          console.log(`[Job ${jobId}] Running FFmpeg Visual FX with args:`, ffmpegArgs.join(' '));
          const ffProc = spawn(FFMPEG_BIN, ffmpegArgs);

          ffProc.stderr.on('data', (d) => {
            const str = d.toString().trim();
            if (str.includes('frame=') || str.includes('Error') || str.includes('failed')) {
              console.log(`[Job ${jobId} ffmpeg]:`, str.slice(0, 140));
            }
          });

          ffProc.on('error', (err) => {
            console.error(`[Job ${jobId} ffmpeg error]:`, err);
          });

          ffProc.on('close', (ffCode) => {
            if (ffCode === 0 && fs.existsSync(fxOutputPath)) {
              try { fs.unlinkSync(rawPath); } catch (e) {}
              jobState.filePath = fxOutputPath;
              jobState.filename = path.basename(fxOutputPath);
              const stat = fs.statSync(fxOutputPath);
              jobState.fileSize = stat.size;
              jobState.fileSizeFormatted = formatBytes(stat.size);
              jobState.status = 'completed';
              jobState.stage = 'completed';
              jobState.percent = 100;
              jobState.message = 'Clip with Visual FX complete!';
            } else {
              const stat = fs.statSync(rawPath);
              jobState.fileSize = stat.size;
              jobState.fileSizeFormatted = formatBytes(stat.size);
              jobState.status = 'completed';
              jobState.stage = 'completed';
              jobState.percent = 100;
              jobState.message = 'Clip download complete.';
            }
          });
          return;
        }

        const stat = fs.statSync(jobState.filePath);
        jobState.fileSize = stat.size;
        jobState.fileSizeFormatted = formatBytes(stat.size);
      }

      jobState.status = 'completed';
      jobState.stage = 'completed';
      jobState.percent = 100;
      jobState.message = 'Download and conversion complete!';
    } else {
      jobState.status = 'error';
      jobState.stage = 'error';
      jobState.message = jobState.error || 'Download failed. Please check the URL or try another quality.';
    }
  });

  res.json({
    jobId,
    status: 'started',
    message: 'Download job initialized'
  });
});

// Endpoint: SSE Stream for Download Progress
app.get('/api/download/stream/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = downloadJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendUpdate = () => {
    const data = JSON.stringify({
      id: job.id,
      percent: job.percent,
      speed: job.speed,
      eta: job.eta,
      stage: job.stage,
      status: job.status,
      message: job.message,
      filename: job.filename,
      fileSizeFormatted: job.fileSizeFormatted,
      downloadUrl: job.filename ? `/api/files/${encodeURIComponent(job.filename)}` : null,
      error: job.error
    });
    res.write(`data: ${data}\n\n`);
  };

  sendUpdate();

  const interval = setInterval(() => {
    sendUpdate();
    if (job.status === 'completed' || job.status === 'error') {
      clearInterval(interval);
      res.end();
    }
  }, 400);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// Endpoint: Download / Stream completed file to browser
app.get('/api/files/:filename', (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  const filePath = path.join(DOWNLOADS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found or has been moved.');
  }

  res.download(filePath, filename, (err) => {
    if (err) {
      console.error('File download error:', err);
    }
  });
});

// Endpoint: List Download History
app.get('/api/history', (req, res) => {
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    const history = files
      .filter(f => !f.endsWith('.part') && !f.endsWith('.ytdl'))
      .map(file => {
        const fullPath = path.join(DOWNLOADS_DIR, file);
        const stat = fs.statSync(fullPath);
        const ext = path.extname(file).toLowerCase().replace('.', '');
        return {
          filename: file,
          size: stat.size,
          sizeFormatted: formatBytes(stat.size),
          createdAt: stat.birthtime,
          ext: ext,
          downloadUrl: `/api/files/${encodeURIComponent(file)}`
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ files: history });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read history', details: e.message });
  }
});

// Endpoint: Open Downloads Folder in Windows File Explorer
app.post('/api/open-folder', (req, res) => {
  if (isWindows) {
    exec(`explorer.exe "${DOWNLOADS_DIR}"`, (err) => {
      if (err) {
        return res.status(500).json({ error: 'Could not open folder', details: err.message });
      }
      res.json({ success: true, message: 'Downloads folder opened in Windows Explorer' });
    });
  } else {
    res.json({ success: false, message: 'Open folder is only supported on Windows' });
  }
});

// Endpoint: Delete a downloaded file
app.delete('/api/files/:filename', (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  const filePath = path.join(DOWNLOADS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    fs.unlinkSync(filePath);
    res.json({ success: true, message: 'File deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete file', details: e.message });
  }
});

// Start Express Server if run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('====================================================');
    console.log(`🚀 Universal Social Media Video Downloader running!`);
    console.log(`🌐 Local Web UI: http://localhost:${PORT}`);
    console.log(`📁 Downloads folder: ${DOWNLOADS_DIR}`);
    console.log(`⚙️  yt-dlp: ${YTDLP_BIN} (${checkBinary(YTDLP_BIN) ? 'Ready' : 'Missing!'})`);
    console.log(`⚙️  ffmpeg: ${FFMPEG_BIN} (${checkBinary(FFMPEG_BIN) ? 'Ready' : 'Missing!'})`);
    console.log('====================================================');
  });
}

module.exports = app;
