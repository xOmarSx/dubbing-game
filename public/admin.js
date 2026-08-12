const $ = (id) => document.getElementById(id);

let state = {
  editingId: null,
  movie: null,      // {filename, url, duration}
  slices: [],        // [{start, end, subtitle}]
};

// ---------- utils ----------
function secToTime(sec) {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}
function timeToSec(str) {
  if (!str) return 0;
  str = str.trim();
  if (str.includes(':')) {
    const [m, s] = str.split(':');
    return (parseFloat(m) || 0) * 60 + (parseFloat(s) || 0);
  }
  return parseFloat(str) || 0;
}
function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  setTimeout(() => t.classList.remove('show'), 2800);
}
function show(el, on) { el.style.display = on ? '' : 'none'; }

// ---------- reset form ----------
function resetForm() {
  state = { editingId: null, movie: null, slices: [] };
  $('formTitle').textContent = 'New Part';
  $('dropLabel').textContent = 'Click to choose a video file, or drag it here';
  $('dropZone').classList.remove('has-file');
  $('preview').style.display = 'none';
  $('preview').src = '';
  $('clipStart').value = '';
  $('clipEnd').value = '';
  $('partTitle').value = '';
  $('sliceList').innerHTML = '';
  $('deleteBtn').style.display = 'none';
  show($('rangeStep'), false);
  show($('sliceStep'), false);
  show($('titleStep'), false);
  document.querySelectorAll('.clip-item').forEach(el => el.classList.remove('active'));
}

// ---------- movie upload ----------
$('dropZone').addEventListener('click', () => $('fileInput').click());
$('dropZone').addEventListener('dragover', e => e.preventDefault());
$('dropZone').addEventListener('drop', e => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) uploadMovie(f);
});
$('fileInput').addEventListener('change', e => {
  if (e.target.files[0]) uploadMovie(e.target.files[0]);
});

async function uploadMovie(file) {
  $('dropLabel').textContent = `Uploading ${file.name}...`;
  const fd = new FormData();
  fd.append('video', file);
  try {
    const res = await fetch('/api/upload-movie', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    state.movie = data;
    $('dropLabel').textContent = `${file.name} (${secToTime(data.duration)})`;
    $('dropZone').classList.add('has-file');
    const preview = $('preview');
    preview.src = data.url;
    preview.style.display = 'block';
    $('clipStart').value = '0:00';
    $('clipEnd').value = secToTime(Math.min(30, data.duration));
    show($('rangeStep'), true);
    show($('sliceStep'), true);
    show($('titleStep'), true);
    toast('Movie uploaded');
  } catch (e) {
    toast('Upload failed: ' + e.message, true);
    $('dropLabel').textContent = 'Click to choose a video file, or drag it here';
  }
}

$('markStart').addEventListener('click', () => {
  $('clipStart').value = secToTime($('preview').currentTime);
});
$('markEnd').addEventListener('click', () => {
  $('clipEnd').value = secToTime($('preview').currentTime);
});

// ---------- slicing ----------
$('generateBtn').addEventListener('click', () => {
  const n = Math.max(1, Math.min(30, parseInt($('sliceCount').value) || 1));
  const start = timeToSec($('clipStart').value);
  const end = timeToSec($('clipEnd').value);
  if (end <= start) { toast('End must be after start', true); return; }
  const step = (end - start) / n;
  state.slices = Array.from({ length: n }, (_, i) => ({
    start: +(start + i * step).toFixed(2),
    end: +(start + (i + 1) * step).toFixed(2),
    subtitle: (state.slices[i] && state.slices[i].subtitle) || ''
  }));
  renderSlices();
});

function renderSlices() {
  const list = $('sliceList');
  list.innerHTML = '';
  state.slices.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'slice-row';
    row.innerHTML = `
      <div class="slice-badge">${i + 1}</div>
      <div class="field"><label>Start</label><input type="text" class="mono s-start" value="${secToTime(s.start)}"></div>
      <div class="field"><label>End</label><input type="text" class="mono s-end" value="${secToTime(s.end)}"></div>
      <div class="field"><label>Subtitle for player</label><textarea class="s-sub" placeholder="What the player should say...">${s.subtitle}</textarea></div>
      <button class="icon-btn s-preview" title="Preview this slice">▶</button>
    `;
    row.querySelector('.s-start').addEventListener('change', e => { s.start = timeToSec(e.target.value); });
    row.querySelector('.s-end').addEventListener('change', e => { s.end = timeToSec(e.target.value); });
    row.querySelector('.s-sub').addEventListener('input', e => { s.subtitle = e.target.value; });
    row.querySelector('.s-preview').addEventListener('click', () => previewSlice(s));
    list.appendChild(row);
  });
}

function previewSlice(s) {
  const v = $('preview');
  v.currentTime = s.start;
  v.play();
  const onTime = () => {
    if (v.currentTime >= s.end) {
      v.pause();
      v.removeEventListener('timeupdate', onTime);
    }
  };
  v.addEventListener('timeupdate', onTime);
}

// ---------- save / delete ----------
$('saveBtn').addEventListener('click', async () => {
  const title = $('partTitle').value.trim();
  if (!title) return toast('Give this part a title', true);
  if (!state.movie && !state.editingId) return toast('Upload a movie first', true);
  if (!state.slices.length) return toast('Split the clip into slices first', true);

  const payload = {
    title,
    videoFile: state.movie ? state.movie.filename : undefined,
    duration: state.movie ? state.movie.duration : undefined,
    clipStart: timeToSec($('clipStart').value),
    clipEnd: timeToSec($('clipEnd').value),
    slices: state.slices
  };

  try {
    const url = state.editingId ? `/api/clips/${state.editingId}` : '/api/clips';
    const method = state.editingId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    toast('Part saved');
    resetForm();
    loadClipList();
  } catch (e) {
    toast('Save failed: ' + e.message, true);
  }
});

$('deleteBtn').addEventListener('click', async () => {
  if (!state.editingId) return;
  if (!confirm('Delete this part? Players will no longer see it.')) return;
  await fetch(`/api/clips/${state.editingId}`, { method: 'DELETE' });
  toast('Part deleted');
  resetForm();
  loadClipList();
});

$('newPartBtn').addEventListener('click', resetForm);

// ---------- sidebar list ----------
async function loadClipList() {
  const res = await fetch('/api/clips');
  const clips = await res.json();
  const list = $('clipList');
  list.innerHTML = '';
  show($('emptyHint'), clips.length === 0);
  clips.sort((a, b) => b.createdAt - a.createdAt).forEach(c => {
    const li = document.createElement('li');
    li.className = 'clip-item' + (c.id === state.editingId ? ' active' : '');
    li.innerHTML = `<span class="t">${escapeHtml(c.title)}</span><span class="m">${c.sliceCount} slices · ${secToTime(c.clipEnd - c.clipStart)}</span>`;
    li.addEventListener('click', () => editClip(c.id));
    list.appendChild(li);
  });
}

async function editClip(id) {
  const res = await fetch(`/api/clips/${id}`);
  const c = await res.json();
  state.editingId = id;
  state.movie = { filename: c.videoFile, url: `/uploads/${c.videoFile}`, duration: c.duration };
  state.slices = c.slices.map(s => ({ start: s.start, end: s.end, subtitle: s.subtitle }));

  $('formTitle').textContent = 'Edit Part';
  $('dropLabel').textContent = `${c.videoFile} (${secToTime(c.duration)})`;
  $('dropZone').classList.add('has-file');
  $('preview').src = state.movie.url;
  $('preview').style.display = 'block';
  $('clipStart').value = secToTime(c.clipStart);
  $('clipEnd').value = secToTime(c.clipEnd);
  $('partTitle').value = c.title;
  $('deleteBtn').style.display = '';
  show($('rangeStep'), true);
  show($('sliceStep'), true);
  show($('titleStep'), true);
  renderSlices();
  loadClipList();
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

loadClipList();
