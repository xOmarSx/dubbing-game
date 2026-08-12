const express = require('express');
const multer = require('multer');
const { v4: uuid } = require('uuid');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'output');
const TMP_DIR = path.join(__dirname, 'tmp');
const DB_FILE = path.join(DATA_DIR, 'db.json');

for (const dir of [DATA_DIR, UPLOAD_DIR, OUTPUT_DIR, TMP_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ clips: [] }, null, 2));

// ---------- tiny JSON "database" ----------
function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ---------- ffmpeg helpers ----------
function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 64 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}
function runFFprobe(args) {
  return new Promise((resolve, reject) => {
    execFile(ffprobePath, args, { maxBuffer: 1024 * 1024 * 16 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}
async function getDuration(filePath) {
  const out = await runFFprobe([
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath
  ]);
  return parseFloat(out.trim());
}

// ---------- uploads ----------
const movieStorage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `${uuid()}${ext}`);
  }
});
const uploadMovie = multer({ storage: movieStorage, limits: { fileSize: 1024 * 1024 * 1024 } });

const audioStorage = multer.diskStorage({
  destination: TMP_DIR,
  filename: (req, file, cb) => cb(null, `${uuid()}-${file.fieldname}.webm`)
});
const uploadAudio = multer({ storage: audioStorage, limits: { fileSize: 100 * 1024 * 1024 } });

app.use(express.json({ limit: '5mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/output', express.static(OUTPUT_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Movie upload (admin) ----------
app.post('/api/upload-movie', uploadMovie.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const filePath = path.join(UPLOAD_DIR, req.file.filename);
    const duration = await getDuration(filePath);
    res.json({ filename: req.file.filename, url: `/uploads/${req.file.filename}`, duration });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not read video file. Is it a valid video?' });
  }
});

// ---------- Clip CRUD (admin + player both read) ----------
app.get('/api/clips', (req, res) => {
  const db = readDB();
  res.json(db.clips.map(c => ({
    id: c.id, title: c.title, videoFile: c.videoFile, duration: c.duration,
    clipStart: c.clipStart, clipEnd: c.clipEnd, sliceCount: c.slices.length, createdAt: c.createdAt
  })));
});

app.get('/api/clips/:id', (req, res) => {
  const db = readDB();
  const clip = db.clips.find(c => c.id === req.params.id);
  if (!clip) return res.status(404).json({ error: 'Not found' });
  res.json(clip);
});

app.post('/api/clips', (req, res) => {
  const { title, videoFile, duration, clipStart, clipEnd, slices } = req.body;
  if (!title || !videoFile || !slices || !slices.length) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const db = readDB();
  const clip = {
    id: uuid(),
    title,
    videoFile,
    duration,
    clipStart,
    clipEnd,
    slices: slices.map((s, i) => ({ index: i, start: s.start, end: s.end, subtitle: s.subtitle || '' })),
    createdAt: Date.now()
  };
  db.clips.push(clip);
  writeDB(db);
  res.json(clip);
});

app.put('/api/clips/:id', (req, res) => {
  const db = readDB();
  const idx = db.clips.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const { title, clipStart, clipEnd, slices } = req.body;
  if (title !== undefined) db.clips[idx].title = title;
  if (clipStart !== undefined) db.clips[idx].clipStart = clipStart;
  if (clipEnd !== undefined) db.clips[idx].clipEnd = clipEnd;
  if (slices !== undefined) db.clips[idx].slices = slices.map((s, i) => ({ index: i, start: s.start, end: s.end, subtitle: s.subtitle || '' }));
  writeDB(db);
  res.json(db.clips[idx]);
});

app.delete('/api/clips/:id', (req, res) => {
  const db = readDB();
  const clip = db.clips.find(c => c.id === req.params.id);
  db.clips = db.clips.filter(c => c.id !== req.params.id);
  writeDB(db);
  // remove movie file only if no other clip references it
  if (clip && !db.clips.some(c => c.videoFile === clip.videoFile)) {
    const p = path.join(UPLOAD_DIR, clip.videoFile);
    fs.existsSync(p) && fs.unlink(p, () => {});
  }
  res.json({ ok: true });
});

// ---------- Player: submit recordings, build dubbed video ----------
app.post('/api/clips/:id/submit', uploadAudio.any(), async (req, res) => {
  const db = readDB();
  const clip = db.clips.find(c => c.id === req.params.id);
  if (!clip) return res.status(404).json({ error: 'Not found' });

  const jobId = uuid();
  const jobTmp = path.join(TMP_DIR, jobId);
  fs.mkdirSync(jobTmp, { recursive: true });
  const movieFile = path.join(UPLOAD_DIR, clip.videoFile);

  try {
    const sliceFiles = [];
    for (let i = 0; i < clip.slices.length; i++) {
      const slice = clip.slices[i];
      const audioFile = req.files.find(f => f.fieldname === `audio_${i}`);
      if (!audioFile) throw new Error(`Missing recording for slice ${i + 1}`);
      const dur = Math.max(0.2, slice.end - slice.start);

      const videoSeg = path.join(jobTmp, `v${i}.mp4`);
      const audioSeg = path.join(jobTmp, `a${i}.m4a`);
      const sliceOut = path.join(jobTmp, `s${i}.mp4`);

      // 1. Re-encoded, silent video segment for this slice
      await runFFmpeg([
        '-y', '-i', movieFile,
        '-ss', String(slice.start), '-t', String(dur),
        '-an', '-c:v', 'libx264', '-preset', 'veryfast',
        '-r', '30', '-pix_fmt', 'yuv420p', videoSeg
      ]);

      // 2. Player's recorded audio, padded/trimmed to exactly match segment length
      await runFFmpeg([
        '-y', '-i', audioFile.path,
        '-af', 'apad', '-t', String(dur),
        '-ar', '44100', '-ac', '2', '-c:a', 'aac', audioSeg
      ]);

      // 3. Mux video + new voice together
      await runFFmpeg([
        '-y', '-i', videoSeg, '-i', audioSeg,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'copy', '-c:a', 'aac', '-shortest', sliceOut
      ]);

      sliceFiles.push(sliceOut);
    }

    // 4. Concatenate all dubbed slices into the final clip
    const listFile = path.join(jobTmp, 'list.txt');
    fs.writeFileSync(listFile, sliceFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    const finalName = `dub-${jobId}.mp4`;
    const finalPath = path.join(OUTPUT_DIR, finalName);
    await runFFmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', finalPath]);

    res.json({ downloadUrl: `/output/${finalName}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not build your dubbed video: ' + e.message });
  } finally {
    fs.rm(jobTmp, { recursive: true, force: true }, () => {});
  }
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));

app.listen(PORT, () => console.log(`Dubbing Studio running on http://localhost:${PORT}`));
