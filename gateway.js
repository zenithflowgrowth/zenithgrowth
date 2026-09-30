/**
 * Master Gateway & Multi-Tool Hub
 * 
 * Unifies all current and future sub-websites under 1 single domain / port:
 * - Root (/)                  -> Zenith Growth PDF, Graphic & Dev Suite
 * - (/video-downloader)      -> OmniFetch Pro Universal Video & Audio Downloader
 * - (/api/*)                 -> Video downloader extraction & download streaming endpoints
 * - Dynamic Plugin Loader    -> Automatically discovers & mounts any future subfolders
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Global crash protection
process.on('uncaughtException', (err) => {
  console.error('[GATEWAY UNCAUGHT EXCEPTION]:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[GATEWAY UNHANDLED REJECTION]:', reason);
});

const app = express();
const PORT = process.env.PORT || 3000;
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

// Global API Request Logger
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[API Request] ${req.method} ${req.path} from ${req.headers.origin || 'direct'}`);
  }
  next();
});

const ROOT_DIR = __dirname;

// Array to track registered tools for the ecosystem
const registeredTools = [
  {
    name: 'Zenith PDF & Graphic Suite',
    path: '/',
    description: '14+ client-side tools: Compress, Remove Background, Sign, Merge, Split',
    type: 'Static WASM/Client',
    status: 'Active'
  },
  {
    name: 'Zenith Video Downloader',
    path: '/video-downloader',
    description: 'Download HD/4K videos & MP3 audio from YouTube, Instagram, TikTok, Twitter, Reddit',
    type: 'Full-Stack (yt-dlp + FFmpeg)',
    status: 'Active'
  },
  {
    name: 'Zenith Video Editor & Clip Studio',
    path: '/video-editor',
    description: 'Edit clips, 60fps canvas filters, animated sparkles/sprinkles, watermark remover & 9:16 social framing',
    type: 'Full-Stack (Canvas 60fps + FFmpeg)',
    status: 'Active'
  }
];

// 0. Auto-extract public.zip if uploaded by user
const zipPath = path.join(ROOT_DIR, 'public.zip');
if (fs.existsSync(zipPath)) {
  try {
    const destDir = path.join(ROOT_DIR, 'public');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const { execSync } = require('child_process');
    try {
      execSync(`tar -xf "${zipPath}" -C "${destDir}"`, { stdio: 'ignore' });
    } catch (e1) {
      if (process.platform === 'win32') {
        execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'ignore' });
      } else {
        execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'ignore' });
      }
    }
  } catch (err) {
    console.warn('public.zip extract notice:', err.message);
  }
}

// Route for video-editor.html in root
app.get(['/video-editor', '/video-editor/', '/editor', '/editor/', '/clip-editor', '/video-editor.html'], (req, res, next) => {
  const directHtml = path.join(ROOT_DIR, 'video-editor.html');
  if (fs.existsSync(directHtml)) {
    return res.sendFile(directHtml);
  }
  next();
});

// Route for video-downloader.html in root
app.get(['/video-downloader', '/video-downloader/', '/video', '/video-downloader.html'], (req, res, next) => {
  const directHtml = path.join(ROOT_DIR, 'video-downloader.html');
  if (fs.existsSync(directHtml)) {
    return res.sendFile(directHtml);
  }
  next();
});

// Serve assets under /video-downloader/ prefix as well
app.get('/video-downloader/video-downloader.css', (req, res) => res.sendFile(path.join(ROOT_DIR, 'video-downloader.css')));
app.get('/video-downloader/video-downloader.js', (req, res) => res.sendFile(path.join(ROOT_DIR, 'video-downloader.js')));
app.get('/video-downloader/favicon.svg', (req, res) => res.sendFile(path.join(ROOT_DIR, 'logo.png')));

// 1. Mount Video Downloader App & APIs (Flexible auto-locator)
const candidateDirs = [
  path.join(ROOT_DIR, 'universal-video-downloader'),
  path.join(ROOT_DIR, 'universal'),
  path.join(ROOT_DIR, 'video-downloader'),
  path.join(ROOT_DIR, 'downloader')
];

let videoMounted = false;
for (const vDir of candidateDirs) {
  if (fs.existsSync(vDir)) {
    const vPublic = fs.existsSync(path.join(vDir, 'public')) ? path.join(vDir, 'public') : vDir;
    app.use('/video-downloader', express.static(vPublic));
    app.get('/video', (req, res) => res.redirect('/video-downloader/'));

    const vServer = path.join(vDir, 'server.js');
    if (fs.existsSync(vServer)) {
      try {
        const videoApp = require(vServer);
        app.use(videoApp);
      } catch (err) {
        console.error('Could not mount video downloader sub-app:', err);
      }
    }
    videoMounted = true;
    break;
  }
}

// Fallback: If public/ was uploaded directly at the root (or extracted from public.zip)
const possiblePublic = [
  path.join(ROOT_DIR, 'public'),
  path.join(ROOT_DIR, 'public', 'public')
];
for (const p of possiblePublic) {
  if (fs.existsSync(p)) {
    app.use('/video-downloader', express.static(p));
    app.get('/video', (req, res) => res.redirect('/video-downloader/'));
    videoMounted = true;
    break;
  }
}

// Fallback: If server.js was uploaded directly to the root
const rootServer = path.join(ROOT_DIR, 'server.js');
if (fs.existsSync(rootServer)) {
  try {
    const videoApp = require(rootServer);
    app.use(videoApp);
  } catch (e) {}
}

// 2. Dynamic Auto-Discovery for Future Projects (your next 4-5 ideas)
// Any folder added with an index.html or public/ directory gets mounted automatically!
const ignoreFolders = ['node_modules', '.git', 'scratch', 'universal-video-downloader', 'downloads', 'bin'];

try {
  const items = fs.readdirSync(ROOT_DIR, { withFileTypes: true });
  items.forEach((item) => {
    if (item.isDirectory() && !ignoreFolders.includes(item.name) && !item.name.startsWith('.')) {
      const folderPath = path.join(ROOT_DIR, item.name);
      const publicPath = path.join(folderPath, 'public');
      const directIndex = path.join(folderPath, 'index.html');
      const subServerPath = path.join(folderPath, 'server.js');

      let mounted = false;

      // If it has its own server.js, mount it
      if (fs.existsSync(subServerPath)) {
        try {
          const subApp = require(subServerPath);
          app.use(`/${item.name}`, subApp);
          mounted = true;
        } catch (e) {
          console.warn(`[Auto-Loader] Could not load server in ${item.name}:`, e.message);
        }
      }

      // Static mounting if public/ or index.html exists
      if (fs.existsSync(publicPath)) {
        app.use(`/${item.name}`, express.static(publicPath));
        mounted = true;
      } else if (fs.existsSync(directIndex)) {
        app.use(`/${item.name}`, express.static(folderPath));
        mounted = true;
      }

      if (mounted) {
        registeredTools.push({
          name: item.name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          path: `/${item.name}`,
          description: `Auto-mounted sub-project in /${item.name}`,
          type: 'Auto-Loaded Module',
          status: 'Active'
        });
      }
    }
  });
} catch (e) {
  console.error('Error scanning sub-directories:', e);
}

// 3. API endpoint listing all mounted tools
app.get('/api/tools', (req, res) => {
  res.json({
    domain: req.headers.host,
    totalTools: registeredTools.length,
    tools: registeredTools
  });
});

// 4. Serve Root Static Files (PDF Suite, Background Remover, Invoices, etc.)
app.use(express.static(ROOT_DIR, {
  extensions: ['html', 'htm']
}));

// Fallback to index.html for root navigation
app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log('================================================================');
  console.log(`🌐 MASTER GATEWAY ACTIVE — Unified Multi-Tool Ecosystem`);
  console.log(`🔗 Local Address: http://localhost:${PORT}`);
  console.log('----------------------------------------------------------------');
  console.log('📦 Mounted Websites & Sub-Tools:');
  registeredTools.forEach(t => {
    console.log(`   👉 ${t.name.padEnd(32)} -> http://localhost:${PORT}${t.path}`);
  });
  console.log('================================================================');
});

module.exports = app;
