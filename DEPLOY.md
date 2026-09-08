# TMS — Deploy Guide
## GitHub + Cloudflare Pages + Cloudflare D1 + Cloudflare Workers

---

## What You Need Before Starting

- A Cloudflare account (free tier is fine) → cloudflare.com
- Node.js installed on your computer (nodejs.org)
- Git installed on your computer

---

## Step 1 — Install Wrangler (Cloudflare CLI)

Open a terminal / command prompt and run:

```
npm install -g wrangler
wrangler login
```

A browser window will open. Log in with your Cloudflare account. Come back to the terminal when it says "Successfully logged in."

---

## Step 2 — Create the D1 Database

```
wrangler d1 create TMS_DB
```

This prints something like:

```
✅ Successfully created DB 'TMS_DB'

[[d1_databases]]
binding = "TMS_DB"
database_name = "TMS_DB"
database_id = "abcd1234-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**Copy the `database_id` value.**

Open `wrangler.toml` in this folder and replace `PASTE_YOUR_DATABASE_ID_HERE` with the ID you just copied.

---

## Step 3 — Apply the Database Schema

```
wrangler d1 execute TMS_DB --file=schema.sql
```

You should see: `✅ Executed 4 queries`

---

## Step 4 — Deploy the Worker

```
wrangler deploy
```

At the end it prints your Worker URL, something like:

```
✅ Deployed tms-worker to https://tms-worker.YOUR-SUBDOMAIN.workers.dev
```

**Copy that URL.**

---

## Step 5 — Update the Frontend with Your Worker URL

Open `index.html` in a text editor.

Find this line near the top of the `<script>` section:

```javascript
const API = 'YOUR_WORKER_URL_HERE';
```

Replace it with your actual Worker URL:

```javascript
const API = 'https://tms-worker.YOUR-SUBDOMAIN.workers.dev';
```

Save the file.

---

## Step 6 — Push Everything to GitHub

In the project folder, run:

```
git init
git remote add origin https://github.com/tfamisla/tms.git
git add index.html worker.js schema.sql wrangler.toml
git commit -m "Initial TMS deployment"
git branch -M main
git push -u origin main
```

If it asks for a username/password, use your GitHub username and a Personal Access Token (not your password). Create one at: GitHub → Settings → Developer Settings → Personal Access Tokens → Tokens (classic) → Generate new token → check "repo" scope.

---

## Step 7 — Connect Cloudflare Pages to GitHub

1. Go to **dash.cloudflare.com**
2. Click **Workers & Pages** in the left sidebar
3. Click **Create application** → **Pages** → **Connect to Git**
4. Authorize Cloudflare to access your GitHub account
5. Select repository: **tfamisla/tms**
6. Build settings:
   - **Framework preset**: None
   - **Build command**: *(leave blank)*
   - **Build output directory**: *(leave blank or put `/`)*
7. Click **Save and Deploy**

Cloudflare Pages will deploy and give you a URL like:
`https://tms-XXXX.pages.dev`

That is your live TMS app URL. Share this with your team.

---

## Step 8 — Every Time You Update the App

When you change `index.html` (or any file), just push to GitHub:

```
git add index.html
git commit -m "Describe what you changed"
git push
```

Cloudflare Pages auto-deploys within ~30 seconds.

If you change `worker.js`, you also need to redeploy the Worker:

```
wrangler deploy
```

---

## Team Member Names

Once you have real names for all 10 team members, update the `TEAM` constant in `index.html` (search for `const TEAM = [`). The placeholders are:

- `surv1` → Employee Surveyor 1
- `surv2` → Employee Surveyor 2
- `train1` → Trainee Surveyor 1
- `train2` → Trainee Surveyor 2
- `back1` → Backend Staff 1
- `back2` → Backend Staff 2
- `back3` → Backend Staff 3
- `back4` → Backend Staff 4

---

## Troubleshooting

**App loads but shows "API not configured"** → You missed Step 5. Update the API URL in index.html and push again.

**App loads but shows red dot / "API unreachable"** → Worker is not deployed, or the URL is wrong. Re-run `wrangler deploy` and check the URL.

**"wrangler: command not found"** → Re-run `npm install -g wrangler` and make sure Node.js is installed.

**Push to GitHub fails** → Use a Personal Access Token instead of your password (see Step 6).
