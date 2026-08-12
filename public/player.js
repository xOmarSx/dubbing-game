const $ = (id) => document.getElementById(id);
const screens = ['menuScreen', 'stageScreen', 'processingScreen', 'resultScreen'];

let clip = null;         // full clip with slices
let sliceIdx = 0;
let recordings = [];     // Blob per slice
let micStream = null;
let recorder = null;
let recordedChunks = [];
let isRecording = false;

function goTo(name) {
  screens.forEach(s => $(s).hidden = (s !== name));
}

// ---------- menu ----------
async function loadMenu() {
  const res = await fetch('/api/clips');
  const clips = await res.json();
  const grid = $('cardGrid');
  grid.innerHTML = '';
  $('noClips').style.display = clips.length ? 'none' : '';
  clips.sort((a, b) => b.createdAt - a.createdAt).forEach((c, i) => {
    const card = document.createElement('div');
    card.className = 'clip-card';
    card.style.animationDelay = `${i * 60}ms`;
    card.innerHTML = `<div class="reel">🎞️</div><h3>${escapeHtml(c.title)}</h3><div class="meta">${c.sliceCount} lines · ${Math.round(c.clipEnd - c.clipStart)}s scene</div>`;
    card.addEventListener('click', () => startClip(c.id));
    grid.appendChild(card);
  });
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

// ---------- stage ----------
async function startClip(id) {
  const res = await fetch(`/api/clips/${id}`);
  clip = await res.json();
  sliceIdx = 0;
  recordings = new Array(clip.slices.length).fill(null);
  $('clipTitle').textContent = clip.title;
  buildSprocket();
  goTo('stageScreen');
  loadSlice();
}

function buildSprocket() {
  const wrap = $('sprocket');
  wrap.innerHTML = '';
  clip.slices.forEach(() => {
    const d = document.createElement('div');
    d.className = 'hole';
    wrap.appendChild(d);
  });
}
function updateSprocket() {
  [...$('sprocket').children].forEach((el, i) => {
    el.className = 'hole' + (i < sliceIdx ? ' done' : i === sliceIdx ? ' active' : '');
  });
}

function loadSlice() {
  const s = clip.slices[sliceIdx];
  const v = $('stageVideo');
  v.src = `/uploads/${clip.videoFile}`;
  v.muted = false;
  v.onloadedmetadata = () => { v.currentTime = s.start; };
  $('subtitleText').textContent = s.subtitle || '(no line set — just react to the scene)';
  $('sliceCounter').textContent = `Line ${sliceIdx + 1} of ${clip.slices.length}`;
  $('nextBtn').disabled = !recordings[sliceIdx];
  $('recordBtn').textContent = recordings[sliceIdx] ? '⟳ Re-record' : '● Record';
  $('statusLine').textContent = "Watch the clip, then hit record when you're ready.";
  updateSprocket();
  stopPlayback();
}

function stopPlayback() {
  const v = $('stageVideo');
  v.pause();
  v.removeEventListener('timeupdate', v._boundStop || (() => {}));
}

// ---- play original reference ----
$('playAgainBtn').addEventListener('click', () => {
  if (isRecording) return;
  const s = clip.slices[sliceIdx];
  const v = $('stageVideo');
  v.muted = false;
  v.currentTime = s.start;
  const onTime = () => { if (v.currentTime >= s.end) { v.pause(); v.removeEventListener('timeupdate', onTime); } };
  v.addEventListener('timeupdate', onTime);
  v.play();
});

// ---- record ----
$('recordBtn').addEventListener('click', async () => {
  if (isRecording) return;
  const s = clip.slices[sliceIdx];
  try {
    if (!micStream) micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    $('statusLine').textContent = 'Microphone access is needed to record your line.';
    return;
  }
  const v = $('stageVideo');
  v.muted = true;
  v.currentTime = s.start;

  recordedChunks = [];
  recorder = new MediaRecorder(micStream);
  recorder.ondataavailable = e => { if (e.data.size) recordedChunks.push(e.data); };
  recorder.onstop = () => {
    recordings[sliceIdx] = new Blob(recordedChunks, { type: recorder.mimeType || 'audio/webm' });
    $('recBadge').classList.remove('show');
    isRecording = false;
    $('recordBtn').textContent = '⟳ Re-record';
    $('nextBtn').disabled = false;
    $('statusLine').textContent = 'Got it! Listen back with "Play again", or move on.';
  };

  const onTime = () => {
    if (v.currentTime >= s.end) {
      v.pause();
      v.removeEventListener('timeupdate', onTime);
      if (recorder.state === 'recording') recorder.stop();
    }
  };
  v.addEventListener('timeupdate', onTime);

  isRecording = true;
  $('recBadge').classList.add('show');
  $('statusLine').textContent = 'Recording... say your line with the scene.';
  recorder.start();
  v.play();
});

// ---- next ----
$('nextBtn').addEventListener('click', () => {
  if (!recordings[sliceIdx]) return;
  if (sliceIdx < clip.slices.length - 1) {
    sliceIdx++;
    loadSlice();
  } else {
    submitRecordings();
  }
});

// ---------- submit & process ----------
async function submitRecordings() {
  goTo('processingScreen');
  const fd = new FormData();
  recordings.forEach((blob, i) => fd.append(`audio_${i}`, blob, `slice_${i}.webm`));
  try {
    const res = await fetch(`/api/clips/${clip.id}/submit`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    $('resultVideo').src = data.downloadUrl;
    $('downloadBtn').href = data.downloadUrl;
    goTo('resultScreen');
  } catch (e) {
    alert('Something went wrong building your video: ' + e.message);
    goTo('stageScreen');
  }
}

// ---------- result screen actions ----------
$('replayBtn').addEventListener('click', () => startClip(clip.id));
$('menuBtn').addEventListener('click', () => { loadMenu(); goTo('menuScreen'); });

loadMenu();
