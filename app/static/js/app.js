'use strict';

/* ---------- 小工具 ---------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2400);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      const d = j.detail;
      if (typeof d === 'string') detail = d;
      else if (d && d.message) detail = d.message;
    } catch (_) {}
    throw new Error(detail);
  }
  return res.json();
}

/* ---------- 状态 ---------- */
const state = {
  draftId: null,
  audioUrl: null,
  prompt: '',
  audio: null,
  takes: 0,
  touched: new Set(),
  accent: 'ember',
  playing: false,
  raf: null,
};

/* ---------- 滑杆：拼描述 ---------- */
const SLIDERS = {
  age: {
    el: '#s-age',
    out: '#v-age',
    fmt: (v) => {
      if (v < 12) return '孩子';
      if (v < 20) return '少年';
      if (v < 30) return '二十出头';
      if (v < 40) return '三十多岁';
      if (v < 55) return '四十多岁';
      if (v < 70) return '六十上下';
      return '七十岁以上';
    },
    phrase: (v) => {
      if (v < 12) return '一个孩子';
      if (v < 20) return '一个少年';
      if (v < 30) return '一个二十岁出头的年轻人';
      if (v < 40) return '一个三十岁左右的人';
      if (v < 55) return '一个四十多岁的人';
      if (v < 70) return '一位六十岁上下的人';
      return '一位七十岁以上的老人';
    },
  },
  rasp: {
    el: '#s-rasp',
    out: '#v-rasp',
    fmt: (v) => (v < 25 ? '偏干净' : v < 55 ? '微微沙' : v < 80 ? '明显沙哑' : '粗粝磨砂'),
    phrase: (v) => {
      if (v < 25) return '嗓音干净';
      if (v < 55) return '嗓音带着一点沙';
      if (v < 80) return '嗓音明显沙哑';
      return '嗓音粗粝磨砂';
    },
  },
  speed: {
    el: '#s-speed',
    out: '#v-speed',
    fmt: (v) => (v < 25 ? '很慢' : v < 45 ? '偏慢' : v < 60 ? '正常' : v < 80 ? '偏快' : '很快'),
    phrase: (v) => {
      if (v < 25) return '语速很慢，字与字之间留空隙';
      if (v < 45) return '语速偏慢';
      if (v < 60) return '';
      if (v < 80) return '语速偏快';
      return '语速很快，几乎不换气';
    },
  },
  mood: {
    el: '#s-mood',
    out: '#v-mood',
    fmt: (v) => (v < 20 ? '很低落' : v < 40 ? '平静偏低' : v < 60 ? '平静' : v < 80 ? '轻快' : '很兴奋'),
    phrase: (v) => {
      if (v < 20) return '情绪低落，像刚哭过';
      if (v < 40) return '语气平静但略带疲惫';
      if (v < 60) return '';
      if (v < 80) return '语气轻快，带笑意';
      return '情绪兴奋，尾音上扬';
    },
  },
  vol: {
    el: '#s-vol',
    out: '#v-vol',
    fmt: (v) => (v < 30 ? '很轻' : v < 45 ? '偏轻' : v < 60 ? '中等' : v < 80 ? '偏响' : '很响'),
    phrase: (v) => {
      if (v < 30) return '声音很轻，像怕被听见';
      if (v < 45) return '音量偏轻';
      if (v < 60) return '';
      if (v < 80) return '说话音量大，中气足';
      return '嗓门很大，几乎在喊';
    },
  },
  breath: {
    el: '#s-breath',
    out: '#v-breath',
    fmt: (v) => (v < 20 ? '无' : v < 45 ? '少许' : v < 70 ? '明显' : '很多'),
    phrase: (v) => {
      if (v < 20) return '';
      if (v < 45) return '气声少许';
      if (v < 70) return '气声明显，声音贴近麦克风';
      return '大量气声，几乎像耳语';
    },
  },
};

function tunerPhrases() {
  // 只把「用户动过」的滑杆拼进描述，没动过的默认值不算数
  return Object.entries(SLIDERS)
    .filter(([k]) => state.touched.has(k))
    .map(([, s]) => s.phrase(Number($(s.el).value)))
    .filter(Boolean);
}

function initTuners() {
  Object.entries(SLIDERS).forEach(([k, s]) => {
    const el = $(s.el);
    const out = $(s.out);
    const sync = () => (out.textContent = s.fmt(Number(el.value)));
    sync();
    el.addEventListener('input', () => {
      state.touched.add(k);
      sync();
    });
  });

  const toggle = $('#tuner-toggle');
  const panel = $('#tuner');
  toggle.addEventListener('click', () => {
    const open = panel.classList.toggle('open');
    toggle.classList.toggle('open', open);
    toggle.lastChild.textContent = open ? ' 收起滑杆' : ' 不会写？用滑杆捏';
  });
}

/* ---------- 描述框 ---------- */
function initPrompt() {
  const ta = $('#prompt');
  const count = $('#prompt-count');
  const sync = () => (count.textContent = `${ta.value.length} / 500`);
  ta.addEventListener('input', sync);
  sync();

  $$('.chip').forEach((c) =>
    c.addEventListener('click', () => {
      ta.value = c.dataset.p;
      sync();
      ta.focus();
    })
  );
}

/* ---------- 造声音 ---------- */
const LOADING_LINES = [
  '正在加热熔炉…',
  '把描述碾成声带…',
  '调音中，别急…',
  '快好了，正在开嗓…',
];

let loadingTimer = null;
function startLoading() {
  const box = $('#loading');
  const text = $('#loading-text');
  box.classList.add('on');
  let i = 0;
  text.textContent = LOADING_LINES[0];
  loadingTimer = setInterval(() => {
    i = (i + 1) % LOADING_LINES.length;
    text.textContent = LOADING_LINES[i];
  }, 1700);
}
function stopLoading() {
  $('#loading').classList.remove('on');
  clearInterval(loadingTimer);
}

async function design(bySlider = false) {
  const ta = $('#prompt');
  let prompt = ta.value.trim();
  const parts = tunerPhrases();

  // 滑杆动过的项，拼到描述后面（不覆盖用户已经写的话）
  if (parts.length) {
    const extra = parts.join('，');
    if (!prompt) {
      prompt = extra + '。';
    } else if (!prompt.includes(parts[0])) {
      prompt = prompt.replace(/[。.\s]+$/, '') + '，' + extra + '。';
    }
    ta.value = prompt;
    $('#prompt-count').textContent = `${prompt.length} / 500`;
  }

  if (!prompt) {
    toast('先写一句描述，或者点个灵感标签，或者拉两根滑杆');
    ta.focus();
    return;
  }

  if (prompt.length > 500) {
    toast('描述太长了，精简到 500 字以内');
    return;
  }

  $('#btn-design').disabled = true;
  $('#btn-again') && ($('#btn-again').disabled = true);
  startLoading();

  try {
    const r = await api('/api/design', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });
    state.draftId = r.draft_id;
    state.prompt = prompt;
    state.takes += 1;
    await loadAudio(r.audio_url);
    $('#stage').classList.add('on');
    $('#forge').classList.remove('on');
    $('#done').classList.remove('on');
    drawWave(0);
    drawMiniWave();
    $('#take-count').textContent = `第 ${state.takes} 次抽`;
    $('#wave-status').textContent = `造好了 · ${(r.elapsed_ms / 1000).toFixed(1)}s`;
    autoPlay();
    document.getElementById('stage').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    toast('熔炉炸了：' + e.message);
  } finally {
    stopLoading();
    $('#btn-design').disabled = false;
    $('#btn-again') && ($('#btn-again').disabled = false);
  }
}

/* ---------- 音频 + 波形 ---------- */
async function loadAudio(url) {
  state.audioUrl = url;
  const audio = new Audio(url);
  audio.preload = 'auto';
  state.audio = audio;
  state.playing = false;
  updatePlayIcon();

  audio.addEventListener('timeupdate', () => {
    const t = audio.currentTime || 0;
    $('#wave-time').textContent = fmtTime(t);
    drawWave(t / (audio.duration || 1));
  });
  audio.addEventListener('ended', () => {
    state.playing = false;
    updatePlayIcon();
    drawWave(0);
  });

  await new Promise((res) => {
    if (audio.readyState >= 2) return res();
    audio.addEventListener('loadeddata', res, { once: true });
    audio.addEventListener('error', res, { once: true });
    setTimeout(res, 4000);
  });

  try {
    await buildPeaks(audio, url);
  } catch (_) {
    state.peaks = null;
  }
  drawWave(0);
  drawMiniWave();
}

async function buildPeaks(audio, url) {
  const buf = await fetch(url).then((r) => r.arrayBuffer());
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await ctx.decodeAudioData(buf);
  ctx.close();

  const raw = decoded.getChannelData(0);
  const N = 96;
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

let progress = 0;
function drawWave(p) {
  progress = p || 0;
  const cv = $('#wave');
  if (!cv || !state.peaks) return;
  const ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth;
  const H = cv.clientHeight;
  if (!W || !H) return; // 面板还没显示，等 ResizeObserver 再画
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
    const h = Math.max(2, peaks[i] * (H - 6));
    const played = i / n <= progress;
    ctx.fillStyle = played ? '#ff6a3d' : 'rgba(242,236,227,0.22)';
    ctx.fillRect(i * bw + bw * 0.16, (H - h) / 2, bw * 0.68, h);
  }
}

function drawMiniWave() {
  const cv = $('#mini-wave');
  if (!cv || !state.peaks) return;
  const ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 176;
  const H = 26;
  cv.width = Math.floor(W * dpr);
  cv.height = Math.floor(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const bars = 34;
  const step = state.peaks.length / bars;
  const bw = W / bars;
  for (let i = 0; i < bars; i++) {
    const v = state.peaks[Math.min(state.peaks.length - 1, Math.floor(i * step))] || 0;
    const h = Math.max(1.5, v * (H - 4));
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(i * bw + bw * 0.2, (H - h) / 2, bw * 0.6, h);
  }
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

function updatePlayIcon() {
  const btn = $('#play');
  const icon = $('#play-icon');
  if (!btn) return;
  btn.classList.toggle('playing', state.playing);
  icon.innerHTML = state.playing
    ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>'
    : '<path d="M8 5v14l11-7z"/>';
}

function togglePlay() {
  if (!state.audio) return;
  if (state.playing) {
    state.audio.pause();
    state.playing = false;
  } else {
    state.audio.play().catch(() => toast('浏览器拦住了自动播放，再点一下'));
    state.playing = true;
  }
  updatePlayIcon();
}

function autoPlay() {
  if (!state.audio) return;
  state.audio.play().catch(() => {});
  state.playing = true;
  updatePlayIcon();
}

/* ---------- 成卡 ---------- */
function openForge() {
  if (!state.draftId) return;
  $('#mini-card').style.setProperty('--accent', accentVar(state.accent));
  $('#mini-prompt').textContent = state.prompt;
  $('#mini-glyph').textContent = ($('#card-name').value.trim() || '声').slice(0, 1);
  $('#forge').classList.add('on');
  drawMiniWave();
  document.getElementById('forge').scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => $('#card-name').focus(), 350);
}

const ACCENT = {
  ember: '#ff6a3d',
  moss: '#7fb069',
  tide: '#5ba9c9',
  plum: '#b48ec9',
  sand: '#d9b382',
  ink: '#6c7a94',
};
const accentVar = (a) => ACCENT[a] || ACCENT.ember;

function initForge() {
  const nameEl = $('#card-name');
  nameEl.addEventListener('input', () => {
    $('#mini-glyph').textContent = (nameEl.value.trim() || '声').slice(0, 1);
    $('#mini-name').textContent = nameEl.value.trim() || '无名之声';
  });

  $$('.swatch').forEach((sw) =>
    sw.addEventListener('click', () => {
      $$('.swatch').forEach((x) => x.classList.remove('sel'));
      sw.classList.add('sel');
      state.accent = sw.dataset.a;
      $('#mini-card').style.setProperty('--accent', accentVar(state.accent));
    })
  );

  $('#btn-forge').addEventListener('click', async () => {
    const name = nameEl.value.trim();
    if (!name) {
      toast('先给它取个名字');
      nameEl.focus();
      return;
    }
    $('#btn-forge').disabled = true;
    try {
      const r = await api('/api/cards', {
        method: 'POST',
        body: JSON.stringify({ draft_id: state.draftId, name, accent: state.accent }),
      });
      const full = new URL(r.url, location.origin).href;
      $('#done-url').textContent = full;
      $('#done-url').href = full;
      $('#btn-open').href = full;
      $('#qr').src = `/api/qr?d=${encodeURIComponent(full)}`;
      $('#done').classList.add('on');
      $('#forge').classList.remove('on');
      document.getElementById('done').scrollIntoView({ behavior: 'smooth', block: 'center' });
      loadGallery();
      toast('卡片铸好了，链接在下面');
    } catch (e) {
      toast('铸卡失败：' + e.message);
    } finally {
      $('#btn-forge').disabled = false;
    }
  });

  $('#btn-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#done-url').textContent);
      toast('链接已复制');
    } catch (_) {
      toast('复制失败，手动选中吧');
    }
  });

  $('#btn-restart').addEventListener('click', () => {
    state.draftId = null;
    state.audio = null;
    state.takes = 0;
    $('#stage').classList.remove('on');
    $('#forge').classList.remove('on');
    $('#done').classList.remove('on');
    $('#prompt').value = '';
    $('#prompt-count').textContent = '0 / 500';
    $('#card-name').value = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/* ---------- 陈列馆 ---------- */
async function loadGallery() {
  const grid = $('#grid');
  try {
    const r = await api('/api/gallery');
    $('#stat-count').textContent = r.total;
    $('#gallery-count').textContent = `${r.total} 副声音`;
    if (!r.cards.length) {
      grid.innerHTML =
        '<div class="gempty">还没有人铸过卡。你的会是第一张吗？</div>';
      return;
    }
    grid.innerHTML = r.cards
      .map((c) => {
        const when = new Date(c.created_at * 1000);
        const ago = timeAgo(when);
        return `<a class="gcard" href="/c/${c.id}" style="--accent:${accentVar(c.accent)}">
          <div class="gcard-name">${esc(c.name)}</div>
          <div class="gcard-prompt">${esc(c.prompt)}</div>
          <div class="gcard-foot"><span>${ago}</span><span>${c.speaks} 次开嗓</span></div>
        </a>`;
      })
      .join('');
  } catch (e) {
    grid.innerHTML = '<div class="gempty">陈列馆暂时打烊了</div>';
  }
}

function timeAgo(d) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])
  );
}

/* ---------- 绑定 ---------- */
document.addEventListener('DOMContentLoaded', () => {
  initPrompt();
  initTuners();
  initForge();
  loadGallery();

  $('#btn-design').addEventListener('click', () => design(false));
  $('#btn-again').addEventListener('click', () => design(false));
  $('#btn-take').addEventListener('click', openForge);
  $('#play').addEventListener('click', togglePlay);
  $('#wave').addEventListener('click', togglePlay);

  $('#tuner-toggle').addEventListener('dblclick', () => design(true));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.playing) togglePlay();
    if (e.key === ' ' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      togglePlay();
    }
  });

  window.addEventListener('resize', () => {
    drawWave(progress);
    drawMiniWave();
  });
});
