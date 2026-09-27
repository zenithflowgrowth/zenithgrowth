const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn, exec, execSync } = require('child_process');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 4000;

// Enable CORS and JSON parsing
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

// Locate Binaries
const isWindows = process.platform === 'win32';
let YTDLP_BIN = path.join(BIN_DIR, isWindows ? 'yt-dlp.exe' : 'yt-dlp');
let FFMPEG_BIN = path.join(BIN_DIR, isWindows ? 'ffmpeg.exe' : 'ffmpeg');

// Cross-platform ffmpeg resolution
if (!fs.existsSync(FFMPEG_BIN)) {
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

  const cleanUrl = url.trim();
  const platform = detectPlatform(cleanUrl);

  const args = [
    '--dump-single-json',
    '--no-warnings',
    '--no-playlist',
    '--js-runtimes', 'node',
    cleanUrl
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

  ytdlpProc.on('close', (code) => {
    if (code !== 0) {
      console.error('yt-dlp inspect error:', stderrData);
      return res.status(500).json({
        error: 'Failed to inspect link. The video may be private, age-restricted, or removed.',
        details: stderrData.slice(0, 500)
      });
    }

    try {
      const data = JSON.parse(stdoutData);

      // Process and extract clean format options
      const rawFormats = data.formats || [];
      const videoFormatsMap = new Map();
      const audioFormats = [];

      // Check available video heights
      rawFormats.forEach((f) => {
        if (f.vcodec && f.vcodec !== 'none') {
          const height = f.height || 0;
          if (height > 0) {
            if (!videoFormatsMap.has(height) || (f.tbr && f.tbr > (videoFormatsMap.get(height).tbr || 0))) {
              videoFormatsMap.set(height, {
                height: height,
                label: `${height}p` + (height >= 2160 ? ' (4K UHD)' : height >= 1440 ? ' (2K QHD)' : height >= 1080 ? ' (Full HD)' : height >= 720 ? ' (HD)' : ' (SD)'),
                ext: 'mp4',
                fps: f.fps || null,
                filesize: f.filesize || f.filesize_approx || null,
                filesizeFormatted: formatBytes(f.filesize || f.filesize_approx),
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

      res.json({
        id: data.id,
        title: data.title || 'Untitled Media',
        uploader: data.uploader || data.channel || data.creator || 'Creator',
        duration: data.duration,
        durationFormatted: formatDuration(data.duration),
        thumbnail: data.thumbnail || (data.thumbnails && data.thumbnails.length ? data.thumbnails[data.thumbnails.length - 1].url : ''),
        webpage_url: data.webpage_url || cleanUrl,
        platform: platform,
        description: (data.description || '').slice(0, 300),
        videoOptions: videoOptions,
        audioOptions: audioOptions
      });
    } catch (parseErr) {
      console.error('Error parsing yt-dlp JSON:', parseErr);
      res.status(500).json({ error: 'Error analyzing media response', details: parseErr.message });
    }
  });
});

// Endpoint: Start Download Task
app.post('/api/download/start', (req, res) => {
  const { url, type, quality, customHeight } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const jobId = crypto.randomBytes(8).toString('hex');
  const jobState = {
    id: jobId,
    url,
    type: type || 'video',
    quality: quality || 'best',
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

  // Build output template with random unique prefix or title
  const outputTemplate = path.join(DOWNLOADS_DIR, `%(title).150B [%(id)s].%(ext)s`);

  const args = [
    '--newline',
    '--no-playlist',
    '--js-runtimes', 'node',
    '--ffmpeg-location', FFMPEG_BIN,
    '--progress-template', 'download-progress:%(progress.downloaded_bytes)s/%(progress.total_bytes)s/%(progress._percent_str)s/%(progress._speed_str)s/%(progress._eta_str)s',
    '-o', outputTemplate
  ];

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
    // Video
    if (customHeight && customHeight !== 'best') {
      const h = parseInt(customHeight, 10);
      args.push('-f', `bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`);
    } else if (quality === '720p') {
      args.push('-f', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best');
    } else if (quality === '1080p') {
      args.push('-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best');
    } else if (quality === '480p') {
      args.push('-f', 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]/best');
    } else {
      args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best');
    }
    // Ensure final container is universally playable mp4
    args.push('--merge-output-format', 'mp4');
  }

  args.push(url.trim());

  console.log(`[Job ${jobId}] Spawning: ${YTDLP_BIN} with args:`, args.join(' '));

  const ytdlpProcess = spawn(YTDLP_BIN, args);
  jobState.process = ytdlpProcess;

  ytdlpProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('download-progress:')) {
        // Format: downloaded/total/percent/speed/eta
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
        jobState.percent = 96;
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
      jobState.status = 'completed';
      jobState.stage = 'completed';
      jobState.percent = 100;
      jobState.message = 'Download and conversion complete!';

      // Find the actual produced file in downloads
      if (!jobState.filePath || !fs.existsSync(jobState.filePath)) {
        // Look for the most recently modified file in DOWNLOADS_DIR
        try {
          const files = fs.readdirSync(DOWNLOADS_DIR).map(f => ({
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
        const stat = fs.statSync(jobState.filePath);
        jobState.fileSize = stat.size;
        jobState.fileSizeFormatted = formatBytes(stat.size);
      }
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
