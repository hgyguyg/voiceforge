'use strict';

const $ = (s) => document.querySelector(s);

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2400);
}

const ACCENT = {
  ember: '#ff6a3d',
  moss: '#7fb069',
  tide: '#5ba9c9',
  plum: '#b48ec9',
  sand: '#d9b382',
  ink: '#6c7a94',
};

const cardId = location.pathname.split('/').filter(Boolean).pop();
const state = { audio: null, playing: false, peaks: null, card: null };

async function boot() {
  try {
    const res = await fetch(`/api/cards/${cardId}`);
    if (!res.ok) throw new Error('这张卡不存在，或者链接抄错了');
    const c = await res.json();
    state.card = c;

    const accent = ACCENT[c.accent] || ACCENT.ember;
    $('#card').style.setProperty('--accent', accent);
    $('#bc-glyph').textContent = (c.name || '声').slice(0, 1);
    $('#bc-name').textContent = c.name;
    $('#bc-prompt').textContent = c.prompt;
    $('#bc-no').textContent = 'No. ' + c.id.toUpperCase();
    $('#bc-plays').textContent = c.plays + ' 次播放';
    $('#bc-date').textContent = new Date(c.created_at * 1000).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    document.title = `${c.name} · 一张声音卡`;

    await loadAudio(c.preview_url);
  } catch (e) {
    $('#bc-name').textContent = '卡丢了';
    $('#bc-prompt').textContent = e.message;
    $('#bc-play').disabled = true;
  }
}

async function loadAudio(url) {
  const audio = new Audio(url);
  audio.preload = 'auto';
  state.audio = audio;

  audio.addEventListener('timeupdate', () => {
    const p = (audio.currentTime || 0) / (audio.duration || 1);
    drawWave(p);
  });
  audio.addEventListener('ended', () => {
    state.playing = false;
    syncPlayUI();
    drawWave(0);
  });

  await new Promise((res) => {
    if (audio.readyState >= 2) return res();
    audio.addEventListener('loadeddata', res, { once: true });
    audio.addEventListener('error', res, { once: true });
    setTimeout(res, 5000);
  });

  try {
    await buildPeaks(url);
  } catch (_) {}
  drawWave(0);
}

async function buildPeaks(url) {
  const buf = await fetch(url).then((r) => r.arrayBuffer());
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await ctx.decodeAudioData(buf);
  ctx.close();
  const raw = decoded.getChannelData(0);
  const N = 120;
  const block = Math.floor(raw.length / N) || 1;
  const peaks = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let m = 0;
    for (let j = 0; j < block; j++) {
      const v = Math.abs(raw[i * block + j] || 0);
      if (v > m) m = v;
    }
    peaks[i] = m;
  }
  const max = Math.max(...peaks) || 1;
  state.peaks = Array.from(peaks, (v) => Math.min(1, v / max));
}

function drawWave(p) {
  const cv = $('#bc-wave');
  if (!cv || !state.peaks) return;
  const ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth;
  const H = cv.clientHeight;
  if (cv.width !== Math.floor(W * dpr)) {
    cv.width = Math.floor(W * dpr);
    cv.height = Math.floor(H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const peaks = state.peaks;
  const n = peaks.length;
  const bw = W / n;
  for (let i = 0; i < n; i++) {
    const h = Math.max(2, peaks[i] * (H - 8));
    const played = i / n <= (p || 0);
    ctx.fillStyle = played ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.24)';
    ctx.fillRect(i * bw + bw * 0.17, (H - h) / 2, bw * 0.66, h);
  }
}

function syncPlayUI() {
  const btn = $('#bc-play');
  btn.querySelector('svg').innerHTML = state.playing
    ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>'
    : '<path d="M8 5v14l11-7z"/>';
  $('#bc-play-text').textContent = state.playing ? '正在说话…' : '再听一遍';
}

function togglePlay() {
  if (!state.audio || !state.card) return;
  if (state.playing) {
    state.audio.pause();
    state.playing = false;
  } else {
    state.audio.play().catch(() => toast('再点一下试试'));
    state.playing = true;
    if (state.card) {
      fetch(`/api/cards/${cardId}/play`, { method: 'POST' }).catch(() => {});
    }
  }
  syncPlayUI();
}

async function say() {
  const ta = $('#say-text');
  const text = ta.value.trim();
  if (!text) {
    toast('先输入想让它念的话');
    ta.focus();
    return;
  }
  const btn = $('#btn-say');
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = '正在开嗓…';
  try {
    const res = await fetch(`/api/cards/${cardId}/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error((j.detail && j.detail.message) || j.detail || '合成失败');
    }
    const r = await res.json();
    const au = $('#say-audio');
    au.src = r.audio_url;
    au.style.display = 'block';
    au.play().catch(() => {});
    toast('念好了');
  } catch (e) {
    toast('Ta 卡住了：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  boot();
  $('#bc-play').addEventListener('click', togglePlay);
  $('#bc-wave').addEventListener('click', togglePlay);
  $('#btn-say').addEventListener('click', say);
  window.addEventListener('resize', () => drawWave(0));
});
