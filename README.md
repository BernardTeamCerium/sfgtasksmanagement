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

### Production dashboard (Production tab)

The Production tab is a dashboard for the team meeting:

- **Entering numbers:** before each meeting, click **Enter numbers** and type the totals for the period. Weekly totals work well, for example the week ending Friday; daily totals also work. The metrics are Leads, Good Connects, Appointments, Sales and Premium. Leave a box blank if you don't track that metric.
- **Monthly totals:** the dashboard adds up each month and compares it with the month before.
- **Meeting summary:** written automatically, for example "Good Connects: 41 vs 30 in Sep ▲ +37% ✓ Goal of 40 met".
- **KPI tiles:** change vs last month, progress toward goal, and, for the current month, the pace the team is on.
- **Month-to-date pace chart:** the running total by day, this month against last month, with the goal line. Hover for exact values.
- **6-month trend chart:** monthly totals for the last six months.
- **Tables:** month-over-month totals, and conversion rates (Leads → Connects → Appointments → Sales, plus average premium per sale).
- **Goals:** set them with **Set goals**. A goal carries forward until you change it. October's goal of 40 good connects comes from the team sheet.
- **Present:** opens a clean full-screen view for the meeting.
- **Sample data:** use **Preview with sample data** to see the dashboard before real numbers exist. Sample numbers are clearly flagged and removed with **Clear sample data**.

To rename or add metrics, edit `METRICS` in `server.js`.

The app comes pre-loaded with the 12 tasks from the current Google Sheet: 9 open (the "Tasks" tab) and 3 completed (the "Sheet1" tab).

## Run it

You need Node.js 18 or newer. The Node server has no dependencies of its own; `@netlify/blobs` is only used on Netlify.

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

### Go live on Netlify

The repository is set up for Netlify: `netlify.toml` serves the site from `public/`. The API runs as a Netlify Function (`netlify/functions/api.mjs`), and team data is kept in **Netlify Blobs**, storage that comes built into every Netlify site. There's nothing extra to buy or configure.

1. In Netlify, open the site, then go to **Site configuration → Build & deploy → Continuous deployment**. Check that **Production branch** is the branch that holds this code. Leave **Base directory** empty; `netlify.toml` supplies the build settings.
2. Go to **Site configuration → Environment variables** and add:
   - `TEAM_PASSCODE`: the passcode the team signs in with. Required, or anyone with the link can edit.
   - `SESSION_SECRET` (optional but recommended): any long random string.
3. Go to **Deploys → Trigger deploy → Deploy site**. Changing environment variables only takes effect after a new deploy.

After that, every push to the production branch redeploys automatically. Tasks and production numbers persist across deploys.

### Go live on Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/BernardTeamCerium/sfgtasksmanagement)

1. Click the button above and sign in to Render with GitHub.
2. When asked, enter a **TEAM_PASSCODE**. This is the passcode the team will use to sign in.
3. Click **Apply**. In a couple of minutes Render gives you a live link, like `https://sfg-task-manager.onrender.com`.

Render runs the regular Node server (`server.js`). The setup comes from `render.yaml`. It uses Render's Starter plan (about $7 a month) with a 1 GB disk (about $0.25 a month), so tasks and numbers survive restarts. Every push to GitHub redeploys the app automatically. To use your own address, such as `tasks.sibleyfinancialgroup.com`, add it under **Settings → Custom Domains** in Render.


### Other hosts

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
server.js          Node HTTP server (file storage), for Render / Docker / any VPS
lib/core.js        the API itself, shared by server.js and the Netlify function
netlify/           Netlify Function wrapper (Netlify Blobs storage) + netlify.toml at the root
public/            front end (index.html, styles.css, app.js, production.js, brand/)
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
- `POST /api/production/entries`
- `PUT /api/production/entries/:id`
- `DELETE /api/production/entries/:id`
- `PUT /api/production/goals`
- `POST /api/production/sample`
- `DELETE /api/production/sample`
- `POST /api/import`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/session`
