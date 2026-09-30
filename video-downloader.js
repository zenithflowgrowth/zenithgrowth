// State & Dynamic API Base Resolver
let currentMediaData = null;
let currentJobEventSource = null;
let activeApiBase = null;

async function getApiBase() {
  if (activeApiBase) return activeApiBase;

  const candidates = [];
  if (window.location.protocol !== 'file:' && window.location.origin && window.location.origin !== 'null') {
    candidates.push(window.location.origin);
  }
  candidates.push('http://localhost:3000');
  candidates.push('http://127.0.0.1:3000');
  candidates.push('http://localhost:5000');
  candidates.push('http://127.0.0.1:5000');
  candidates.push('http://localhost:4000');

  for (const base of candidates) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch(`${base}/api/status`, { signal: ctrl.signal, mode: 'cors' });
      clearTimeout(tid);
      if (res.ok) {
        const testData = await res.json();
        if (testData.status === 'ok') {
          activeApiBase = base;
          console.log(`[OmniFetch Pro] Connected to active API backend: ${base}`);
          return base;
        }
      }
    } catch (_) {}
  }

  return (window.location.protocol !== 'file:' && window.location.origin && window.location.origin !== 'null')
    ? window.location.origin
    : 'http://localhost:3000';
}

// DOM Elements
const urlInput = document.getElementById('url-input');
const pasteBtn = document.getElementById('paste-btn');
const clearBtn = document.getElementById('clear-btn');
const fetchBtn = document.getElementById('fetch-btn');
const fetchBtnText = document.getElementById('fetch-btn-text');
const fetchSpinner = document.getElementById('fetch-spinner');
const platformBadge = document.getElementById('detected-platform-badge');
const platformIcon = document.getElementById('detected-platform-icon');
const platformName = document.getElementById('detected-platform-name');
const engineStatus = document.getElementById('engine-status');
const engineStatusText = document.getElementById('engine-status-text');

const errorContainer = document.getElementById('error-container');
const errorTitle = document.getElementById('error-title');
const errorMessage = document.getElementById('error-message');

const resultCard = document.getElementById('result-card');
const mediaThumbnail = document.getElementById('media-thumbnail');
const mediaDuration = document.getElementById('media-duration');
const mediaPlatformTag = document.getElementById('media-platform-tag');
const mediaTitle = document.getElementById('media-title');
const mediaAuthor = document.getElementById('media-author');
const mediaSourceLink = document.getElementById('media-source-link');
const mediaDescription = document.getElementById('media-description');
const videoCountBadge = document.getElementById('video-count-badge');
const videoFormatsList = document.getElementById('video-formats-list');
const audioFormatsList = document.getElementById('audio-formats-list');

// Modal Elements
const progressModal = document.getElementById('download-progress-modal');
const modalHeading = document.getElementById('modal-status-heading');
const statusIndicator = document.getElementById('download-status-indicator');
const dlMediaTitle = document.getElementById('dl-media-title');
const dlBadgeFormat = document.getElementById('dl-badge-format');
const progressBarFill = document.getElementById('progress-bar-fill');
const metricPercent = document.getElementById('metric-percent');
const metricSpeed = document.getElementById('metric-speed');
const metricEta = document.getElementById('metric-eta');
const metricStage = document.getElementById('metric-stage');
const dlStatusMessage = document.getElementById('dl-status-message');
const dlStatusBanner = document.getElementById('dl-status-banner');
const completedActions = document.getElementById('completed-actions');
const saveFileBtn = document.getElementById('save-file-btn');

// History Elements
const historyContainer = document.getElementById('history-container');
const historyItemsList = document.getElementById('history-items-list');
const emptyHistoryPlaceholder = document.getElementById('empty-history-placeholder');

// Theme Elements
const themeToggle = document.getElementById('theme-toggle');
const themeIconSun = document.getElementById('theme-icon-sun');
const themeIconMoon = document.getElementById('theme-icon-moon');

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  checkEngineStatus();
  loadHistory();
  setupEventListeners();
});

// Platform detection rules
const PLATFORMS = [
  { match: ['youtube.com', 'youtu.be'], name: 'YouTube', badgeClass: 'badge-youtube' },
  { match: ['instagram.com'], name: 'Instagram', badgeClass: 'badge-instagram' },
  { match: ['tiktok.com'], name: 'TikTok', badgeClass: 'badge-tiktok' },
  { match: ['facebook.com', 'fb.watch', 'fb.com'], name: 'Facebook', badgeClass: 'badge-facebook' },
  { match: ['twitter.com', 'x.com'], name: 'Twitter / X', badgeClass: 'badge-twitter' },
  { match: ['reddit.com', 'redd.it'], name: 'Reddit', badgeClass: 'badge-reddit' },
  { match: ['pinterest.com', 'pin.it'], name: 'Pinterest', badgeClass: 'badge-pinterest' },
  { match: ['linkedin.com'], name: 'LinkedIn', badgeClass: 'badge-linkedin' },
  { match: ['vimeo.com'], name: 'Vimeo', badgeClass: 'badge-vimeo' },
  { match: ['twitch.tv'], name: 'Twitch', badgeClass: 'badge-twitch' },
  { match: ['soundcloud.com'], name: 'SoundCloud', badgeClass: 'badge-soundcloud' },
  { match: ['threads.net'], name: 'Threads', badgeClass: 'badge-threads' }
];

function updatePlatformDetection(url) {
  if (!url || !url.trim()) {
    platformBadge.className = 'platform-detect-pill';
    platformName.textContent = 'Auto Detect';
    clearBtn.classList.add('hidden');
    return;
  }

  clearBtn.classList.remove('hidden');
  const lower = url.toLowerCase();
  const matched = PLATFORMS.find(p => p.match.some(m => lower.includes(m)));

  if (matched) {
    platformBadge.className = `platform-detect-pill ${matched.badgeClass}`;
    platformName.textContent = matched.name;
  } else {
    platformBadge.className = 'platform-detect-pill';
    platformName.textContent = 'Universal Web';
  }
}

function setupEventListeners() {
  urlInput.addEventListener('input', (e) => {
    updatePlatformDetection(e.target.value);
  });

  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        urlInput.value = text.trim();
        updatePlatformDetection(urlInput.value);
        urlInput.focus();
      }
    } catch (err) {
      console.warn('Clipboard read failed:', err);
    }
  });

  clearBtn.addEventListener('click', () => {
    urlInput.value = '';
    updatePlatformDetection('');
    clearBtn.classList.add('hidden');
    urlInput.focus();
  });

  themeToggle.addEventListener('click', toggleTheme);

  document.getElementById('open-folder-nav-btn').addEventListener('click', openDownloadsFolder);
}

// Engine Status Check
async function checkEngineStatus() {
  try {
    const apiBase = await getApiBase();
    const res = await fetch(`${apiBase}/api/status`, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.ytdlp && data.ytdlp.exists && data.ffmpeg && data.ffmpeg.exists) {
      engineStatus.className = 'engine-badge ready';
      engineStatusText.textContent = `Engines Ready (${data.ytdlp.version || 'Active'})`;
      hideError();
    } else {
      engineStatus.className = 'engine-badge';
      engineStatusText.textContent = 'Engines Initializing';
    }
  } catch (e) {
    console.warn('[Engine Status] Backend unreachable:', e.message);
    engineStatus.className = 'engine-badge';
    engineStatus.style.background = 'rgba(239, 68, 68, 0.15)';
    engineStatus.style.borderColor = 'rgba(239, 68, 68, 0.4)';
    engineStatus.style.color = '#f87171';
    engineStatusText.textContent = 'Backend Offline';

    if (window.location.protocol === 'file:') {
      showError(
        'Backend Server Required',
        'You opened this file directly from your disk (file://). Please start the server by running "node gateway.js" in your terminal and open http://localhost:3000/video-downloader in your browser.'
      );
    }
  }
}

// Theme Handlers
function initTheme() {
  const saved = localStorage.getItem('omni_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcons(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const target = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', target);
  localStorage.setItem('omni_theme', target);
  updateThemeIcons(target);
}

function updateThemeIcons(theme) {
  if (theme === 'light') {
    themeIconSun.classList.add('hidden');
    themeIconMoon.classList.remove('hidden');
  } else {
    themeIconSun.classList.remove('hidden');
    themeIconMoon.classList.add('hidden');
  }
}

// Show/Hide Errors
function showError(title, msg) {
  errorTitle.textContent = title;
  errorMessage.textContent = msg;
  errorContainer.classList.remove('hidden');
  errorContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideError() {
  errorContainer.classList.add('hidden');
}

// Switch Format Tabs
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === tabId);
  });
}

// Inspect URL Handler
async function handleInspectUrl() {
  let url = urlInput.value.trim();
  if (!url) return;

  // Clean trailing commas, periods, quotes, or accidental copy-paste noise
  url = url.replace(/^["']+|["']+$/g, '').replace(/[,;.\\/]+$/g, '').trim();
  urlInput.value = url;

  hideError();
  resultCard.classList.add('hidden');

  fetchBtn.disabled = true;
  fetchSpinner.classList.remove('hidden');
  document.querySelector('.btn-icon-send').classList.add('hidden');
  fetchBtnText.textContent = 'Analyzing Media...';

  try {
    const apiBase = await getApiBase();
    const res = await fetch(`${apiBase}/api/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      mode: 'cors'
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      if (!res.ok) {
        throw new Error(`Server returned error status ${res.status}. Please make sure backend service is active.`);
      }
      throw new Error('Server returned an unparseable response.');
    }

    if (!res.ok) {
      throw new Error(data.error || data.details || 'Failed to inspect link.');
    }

    currentMediaData = data;
    renderMediaResult(data);
  } catch (err) {
    if (err.message && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError'))) {
      showError(
        'Backend Server Offline',
        'Could not connect to the video processing engine. Please ensure the server is running by executing "node gateway.js" in the terminal and access the site at http://localhost:3000/video-downloader.'
      );
    } else {
      showError('Extraction Failed', err.message || 'Could not fetch media information. Please check the URL.');
    }
  } finally {
    fetchBtn.disabled = false;
    fetchSpinner.classList.add('hidden');
    document.querySelector('.btn-icon-send').classList.remove('hidden');
    fetchBtnText.textContent = 'Analyze Link';
  }
}

// Select specific video from multi-video post
window.selectVideoIndex = function(idx) {
  if (!currentMediaData) return;
  let base = (currentMediaData.webpage_url || urlInput.value).replace(/\/(video|photo)(\/\d+)?.*$/i, '');
  urlInput.value = `${base}/video/${idx}`;
  handleInspectUrl();
};

// Render Media Result Card
function renderMediaResult(data) {
  mediaThumbnail.src = data.thumbnail || 'favicon.svg';
  mediaDuration.textContent = data.durationFormatted || '--:--';
  mediaPlatformTag.textContent = data.platform.name;
  mediaPlatformTag.style.borderColor = data.platform.color || '#fff';
  mediaTitle.textContent = data.title;
  mediaAuthor.textContent = data.uploader;
  mediaSourceLink.href = data.webpage_url;
  mediaDescription.textContent = data.description || 'No description provided.';

  // Multi-video post selector (for Twitter threads or multi-video tweets)
  let multiVideoContainer = document.getElementById('multi-video-selector');
  if (!multiVideoContainer && mediaTitle && mediaTitle.parentNode) {
    multiVideoContainer = document.createElement('div');
    multiVideoContainer.id = 'multi-video-selector';
    multiVideoContainer.className = 'multi-video-bar';
    mediaTitle.parentNode.insertBefore(multiVideoContainer, mediaTitle.nextSibling);
  }

  if (multiVideoContainer) {
    if (data.entries && data.entries.length > 1) {
      multiVideoContainer.innerHTML = `
        <div style="margin: 8px 0 12px 0; padding: 10px 14px; background: rgba(99, 102, 241, 0.12); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px;">
          <span style="font-size: 12px; font-weight: 700; color: #a5b4fc; display: flex; items-center; gap: 4px;">
            <span>🎬</span> <span>Multiple Videos Found (${data.entries.length}):</span>
          </span>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            ${data.entries.map(e => `
              <button class="multi-video-chip" onclick="selectVideoIndex(${e.index})" style="padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer; transition: all 0.2s; border: 1px solid ${e.isSelected ? '#6366f1' : 'rgba(255,255,255,0.15)'}; background: ${e.isSelected ? '#4f46e5' : 'rgba(15,23,42,0.6)'}; color: ${e.isSelected ? '#ffffff' : '#cbd5e1'};">
                Video #${e.index} (${e.durationFormatted || 'Clip'})
              </button>
            `).join('')}
          </div>
        </div>
      `;
      multiVideoContainer.style.display = 'block';
    } else {
      multiVideoContainer.style.display = 'none';
    }
  }

  // Video Formats
  videoFormatsList.innerHTML = '';
  const vOptions = data.videoOptions || [];
  videoCountBadge.textContent = vOptions.length;

  vOptions.forEach((opt) => {
    const card = document.createElement('div');
    card.className = 'format-card';

    let tagClass = 'badge-tag';
    if (opt.height >= 2160) tagClass += ' tag-4k';
    else if (opt.height >= 1080) tagClass += ' tag-hd';

    const fpsLabel = opt.fps ? ` • ${opt.fps}fps` : '';
    const sizeLabel = opt.filesizeFormatted ? ` • ${opt.filesizeFormatted}` : '';

    card.innerHTML = `
      <div class="format-info">
        <div class="format-badge-row">
          <span class="badge-res">${opt.label}</span>
          <span class="${tagClass}">${opt.ext.toUpperCase()}</span>
        </div>
        <div class="format-sub">Video + Audio Muxed${fpsLabel}${sizeLabel}</div>
      </div>
      <button class="btn-download-format" onclick="startDownload('video', '${opt.height}', '${opt.label}')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        <span>Download MP4</span>
      </button>
    `;
    videoFormatsList.appendChild(card);
  });

  // Audio Formats
  audioFormatsList.innerHTML = '';
  const aOptions = data.audioOptions || [];
  aOptions.forEach((opt) => {
    const card = document.createElement('div');
    card.className = 'format-card';

    card.innerHTML = `
      <div class="format-info">
        <div class="format-badge-row">
          <span class="badge-res">${opt.label}</span>
          <span class="badge-tag tag-audio">${opt.ext.toUpperCase()}</span>
        </div>
        <div class="format-sub">Bitrate: ${opt.bitrate} • Clean Track Extraction</div>
      </div>
      <button class="btn-download-format" onclick="startDownload('audio', '${opt.id}', '${opt.label}')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 18V5l12-2v13"></path>
          <circle cx="6" cy="18" r="3"></circle>
          <circle cx="18" cy="16" r="3"></circle>
        </svg>
        <span>Download ${opt.ext.toUpperCase()}</span>
      </button>
    `;
    audioFormatsList.appendChild(card);
  });

  resultCard.classList.remove('hidden');
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Start Download
async function startDownload(type, quality, label) {
  if (!currentMediaData) return;

  // Reset Modal state
  modalHeading.textContent = `Downloading ${label}...`;
  statusIndicator.className = 'spinner-dot';
  dlMediaTitle.textContent = currentMediaData.title;
  dlBadgeFormat.textContent = label;
  progressBarFill.style.width = '0%';
  metricPercent.textContent = '0%';
  metricSpeed.textContent = 'Connecting...';
  metricEta.textContent = '--:--';
  metricStage.textContent = 'Starting';
  dlStatusMessage.textContent = 'Initializing media streams...';
  dlStatusBanner.className = 'status-banner info';
  completedActions.classList.add('hidden');

  progressModal.classList.remove('hidden');

  try {
    const payload = {
      url: currentMediaData.webpage_url,
      type: type,
      quality: quality,
      customHeight: type === 'video' ? quality : null,
      videoIndex: currentMediaData.activeVideoIndex || null
    };

    const apiBase = await getApiBase();
    const res = await fetch(`${apiBase}/api/download/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      mode: 'cors'
    });

    const initData = await res.json();
    if (!res.ok) {
      throw new Error(initData.error || 'Failed to start download process.');
    }

    listenToDownloadProgress(initData.jobId);
  } catch (err) {
    statusIndicator.className = 'spinner-dot done';
    statusIndicator.style.backgroundColor = 'var(--danger)';
    dlStatusBanner.className = 'status-banner error';
    dlStatusMessage.textContent = err.message || 'Error occurred during download.';
  }
}

// SSE Progress Monitor
async function listenToDownloadProgress(jobId) {
  if (currentJobEventSource) {
    currentJobEventSource.close();
  }

  const apiBase = await getApiBase();
  currentJobEventSource = new EventSource(`${apiBase}/api/download/stream/${jobId}`);

  currentJobEventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      progressBarFill.style.width = `${data.percent}%`;
      metricPercent.textContent = `${Math.round(data.percent)}%`;
      metricSpeed.textContent = data.speed || '-- MB/s';
      metricEta.textContent = data.eta || '--:--';
      metricStage.textContent = (data.stage || 'downloading').toUpperCase();
      dlStatusMessage.textContent = data.message || 'Processing...';

      if (data.status === 'completed') {
        currentJobEventSource.close();
        currentJobEventSource = null;

        modalHeading.textContent = 'Download Complete!';
        statusIndicator.className = 'spinner-dot done';
        dlStatusBanner.className = 'status-banner success';
        dlStatusMessage.textContent = `Saved: ${data.filename} (${data.fileSizeFormatted || 'Ready'})`;

        const fullDownloadUrl = (data.downloadUrl && data.downloadUrl.startsWith('http')) 
          ? data.downloadUrl 
          : `${apiBase}${data.downloadUrl || ''}`;

        // Configure direct browser download button
        if (data.downloadUrl) {
          saveFileBtn.href = fullDownloadUrl;
          saveFileBtn.setAttribute('download', data.filename || 'download');
        }

        completedActions.classList.remove('hidden');
        loadHistory();

        // Auto trigger browser download
        if (data.downloadUrl) {
          setTimeout(() => {
            const tempLink = document.createElement('a');
            tempLink.href = fullDownloadUrl;
            tempLink.setAttribute('download', data.filename || 'download');
            document.body.appendChild(tempLink);
            tempLink.click();
            document.body.removeChild(tempLink);
          }, 600);
        }
      } else if (data.status === 'error') {
        currentJobEventSource.close();
        currentJobEventSource = null;

        modalHeading.textContent = 'Download Failed';
        statusIndicator.className = 'spinner-dot done';
        statusIndicator.style.backgroundColor = 'var(--danger)';
        dlStatusBanner.className = 'status-banner error';
        dlStatusMessage.textContent = data.error || data.message || 'An error occurred during extraction.';
      }
    } catch (e) {
      console.error('Error parsing SSE event:', e);
    }
  };

  currentJobEventSource.onerror = () => {
    if (currentJobEventSource) {
      currentJobEventSource.close();
      currentJobEventSource = null;
    }
  };
}

function closeProgressModal() {
  if (currentJobEventSource) {
    currentJobEventSource.close();
    currentJobEventSource = null;
  }
  progressModal.classList.add('hidden');
}

// Download History Management
async function loadHistory() {
  try {
    const apiBase = await getApiBase();
    const res = await fetch(`${apiBase}/api/history`, { mode: 'cors' });
    const data = await res.json();

    if (data.files && data.files.length > 0) {
      emptyHistoryPlaceholder.classList.add('hidden');
      historyItemsList.classList.remove('hidden');
      historyItemsList.innerHTML = '';

      data.files.forEach(file => {
        const item = document.createElement('div');
        item.className = 'history-card';
        const formattedDate = new Date(file.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const fileUrl = (file.downloadUrl && file.downloadUrl.startsWith('http')) 
          ? file.downloadUrl 
          : `${apiBase}${file.downloadUrl || ''}`;

        item.innerHTML = `
          <div class="history-file-details">
            <span class="history-filename" title="${file.filename}">${file.filename}</span>
            <div class="history-meta">
              <span class="ext-badge">${file.ext}</span>
              <span>${file.sizeFormatted}</span>
              <span>•</span>
              <span>${formattedDate}</span>
            </div>
          </div>
          <div class="history-actions-row">
            <a href="${fileUrl}" class="btn-history-dl" title="Save to Browser" download>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </a>
            <button class="btn-history-del" onclick="deleteHistoryFile('${encodeURIComponent(file.filename)}')" title="Delete file">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        `;
        historyItemsList.appendChild(item);
      });
    } else {
      emptyHistoryPlaceholder.classList.remove('hidden');
      historyItemsList.classList.add('hidden');
    }
  } catch (e) {
    console.warn('Failed to load history:', e);
  }
}

async function deleteHistoryFile(encodedFilename) {
  if (!confirm('Are you sure you want to delete this downloaded file?')) return;
  try {
    const apiBase = await getApiBase();
    const res = await fetch(`${apiBase}/api/files/${encodedFilename}`, { method: 'DELETE', mode: 'cors' });
    if (res.ok) {
      loadHistory();
    }
  } catch (e) {
    console.error('Delete error:', e);
  }
}

// Windows Explorer Folder Opener
async function openDownloadsFolder() {
  try {
    const apiBase = await getApiBase();
    const res = await fetch(`${apiBase}/api/open-folder`, { method: 'POST', mode: 'cors' });
    const data = await res.json();
    if (!data.success && data.message) {
      alert(data.message);
    }
  } catch (e) {
    console.error('Error opening folder:', e);
  }
}
