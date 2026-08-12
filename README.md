# Dub It — Movie Dubbing Game

Two connected screens, one app:

- **`/admin`** — private, you upload the movie, mark the part to play, split it into slices, write the line for each slice. Only people with the link know it exists (see "Locking down /admin" below).
- **`/`** — the public player screen. Players pick a scene, record their own voice over each slice, and get back the full clip with their voice dubbed in — watchable and downloadable.

Both screens talk to the same small server, so anything you add in `/admin` shows up for players immediately — no redeploying needed.

## How it works

1. **Admin** uploads a movie file. The server reads it with ffmpeg and shows a preview.
2. Admin marks the **start/end of the part** to play, and how many **slices** to split it into — times and subtitles are editable per slice.
3. **Players** open the site, pick a scene, and for each slice: watch the original, hit record, read the on-screen line while the clip replays muted, then move to the next slice.
4. When all slices are recorded, the server uses ffmpeg to swap each slice's original audio for the player's voice and stitches the slices back into one video. The player can download it or play again.

## Running it locally

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm start
```

Then open:
- Admin: http://localhost:3000/admin
- Players: http://localhost:3000/

That's it — no separate database to set up. Movies are stored in `uploads/`, finished dubbed videos in `output/`, and all clip/slice data in `data/db.json`. All three persist on disk, so your clips are still there after a restart.

## Putting it online so it's "always working"

This app needs a real Node process running (not a static host like GitHub Pages), because it processes video with ffmpeg on the server. The easiest free/cheap options that support that:

**Render.com** (recommended, easiest)
1. Push this folder to a GitHub repo.
2. On Render: New → Web Service → connect the repo.
3. Build command: `npm install` — Start command: `npm start`.
4. Add a **persistent disk** (Render → your service → Disks) mounted at `/opt/render/project/src/uploads` and another at `.../output` and `.../data` — otherwise uploaded movies are wiped on every redeploy. (Free tier has no persistent disk — the cheapest paid instance does. On the free tier, movies survive until the service restarts/sleeps.)
5. Once deployed you'll get a URL like `https://your-app.onrender.com`. Admin is `/admin`, players use the root URL.

**Railway.app** works the same way and includes a persistent volume even on its starter plan — generally the simplest option if you don't want to think about disks.

**A VPS** (DigitalOcean, Hetzner, etc.) also works great — clone the repo, `npm install`, run it with `pm2` or a `systemd` service so it stays up, put it behind Nginx/Caddy for HTTPS.

Any of these keep the app running 24/7 at one URL, so admin changes are instantly visible to every player, on any device — exactly the "always connected" behavior you wanted.

## Locking down `/admin`

Right now anyone with the `/admin` URL can use it — there's no login screen, to keep things simple. Two easy ways to make it yours-only:

- **Quickest:** rename the admin page to something unguessable, e.g. rename `public/admin.html` to `public/admin-<random-string>.html` and update the `app.get('/admin', ...)` route in `server.js` to match.
- **Better:** ask me to add a simple password gate (one shared password, stored as an environment variable) in front of the `/admin` routes — a small addition if you want it.

## Notes & limits

- Works with any video format ffmpeg understands (mp4, mov, mkv, webm...). Very large files (feature-length movies) will take a while to upload — for game clips, a pre-trimmed few-minutes-long file uploads much faster than a 2-hour movie.
- Recording uses the browser's microphone (`getUserMedia`), so it needs **HTTPS** in production (Render/Railway give you this automatically) — browsers block mic access on plain HTTP except on `localhost`.
- Processing time for the final dubbed video is roughly proportional to clip length and slice count (a few seconds for a short scene).
- If you'd like a "review before publish" step, per-clip thumbnails, or multiple admins, those are straightforward additions — just ask.
