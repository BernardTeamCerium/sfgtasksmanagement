# Sibley Financial Group — Team Task Manager

A shared, branded task manager for the SFG team. It replaces the "Sibley Financial Group — Project Management" Google Sheet and keeps the same columns and rules:

- **Dashboard:** Open Tasks, Overdue, Due in 7 Days and Completed counts. Click a count to filter by it.
- **Three views:**
  - **Table:** sortable columns, with Priority and Status changeable in the row.
  - **Board:** a Kanban board. Drag a card to change its status.
  - **By Person:** each team member's workload.
- **Due-date colours:** red means overdue, yellow means due today or within 7 days (same as the sheet).
- **Task Updates:** a dated log for each task, signed with whoever picked their name in the **I am** menu. *Last Updated* fills in automatically.
- **Filters:** search, owner, project, priority and status.
- **Team members:** add and remove them in **Settings**.
- **CSV:** export to CSV (opens in Google Sheets or Excel), or import a CSV that uses the sheet's column headers.
- **Sync:** changes from teammates show up automatically about every 20 seconds.
- **Optional team passcode:** sign-in to keep the board private.

The app comes pre-loaded with the 12 tasks from the current Google Sheet: 9 open (the "Tasks" tab) and 3 completed (the "Sheet1" tab).

## Run it

You need Node.js 18 or newer. There are no dependencies to install.

```bash
TEAM_PASSCODE="choose-a-passcode" SESSION_SECRET="long-random-string" npm start
```

Then open http://localhost:3000.

| Variable | Purpose |
| --- | --- |
| `PORT` | Port to listen on (default `3000`). |
| `TEAM_PASSCODE` | Shared passcode the team signs in with. **Set this on any server reachable from the internet.** If it isn't set, anyone with the URL can edit. |
| `SESSION_SECRET` | Secret used to sign the sign-in cookie. Set a fixed value so people stay signed in after restarts. |
| `DATA_DIR` | Where `tasks.json` is stored (default `./data`). |

All data is stored in `data/tasks.json`. That file is created from `data/seed.json` on first start, and it's git-ignored. Back it up, or use the CSV export.

### Docker

```bash
docker build -t sfg-tasks .
docker run -d -p 3000:3000 -v sfg-data:/data -e TEAM_PASSCODE=... -e SESSION_SECRET=... sfg-tasks
```

### Hosting

The app works on any host that runs Node or Docker and has a persistent disk, such as Render, Railway, Fly.io or a small VPS. Mount the persistent disk at `DATA_DIR`. Put it behind HTTPS so the sign-in cookie is sent securely.

## Branding

The branding comes from the official Sibley Financial Group crest logo. Brand files live in `public/brand/`:

- `logo.png` is the full crest and wordmark, shown on the sign-in screen. It has a transparent background.
- `crest.png` is the crest alone, shown in the header next to the SIBLEY / FINANCIAL GROUP wordmark.
- `favicon.png` is the browser-tab icon.
- `brand.css` holds the colour and font tokens, sampled from the logo:

| Token | Colour | Taken from |
| --- | --- | --- |
| `--brand-navy` | `#0B2F5B` | "SIBLEY" wordmark: headings, primary buttons |
| `--brand-blue` | `#1A4AA8` | Royal blue of the shield: accents, links, focus |
| `--brand-red` | `#D0101A` | Red of the shield: New Task button, header stripe |
| `--brand-silver` | `#A9B0BB` | Helm, scrollwork and banner |
| `--brand-charcoal` | `#2B2B2B` | "FINANCIAL GROUP" |

Headings use **Cinzel**, a free Google Font close to the logo's classical serif. Body text uses **Inter**.

## Project layout

```
server.js          zero-dependency HTTP server + JSON API
public/            front end (index.html, styles.css, app.js, brand/)
data/seed.json     initial tasks imported from the Google Sheet
```

### API

- `GET /api/state`
- `POST /api/tasks`
- `PUT /api/tasks/:id`
- `DELETE /api/tasks/:id`
- `POST /api/tasks/:id/notes`
- `DELETE /api/tasks/:id/notes/:noteId`
- `PUT /api/members`
- `POST /api/import`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/session`
