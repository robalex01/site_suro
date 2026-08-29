import { SlashCommandBuilder } from "discord.js";

export const slashCommands = [
    new SlashCommandBuilder().setName("config").setDescription("📝 Set the log channel")
        .addChannelOption(opt => opt.setName("channel").setDescription("Discord channel").setRequired(true)),
    new SlashCommandBuilder().setName("panel").setDescription("🎛️ Show the staff panel"),
    new SlashCommandBuilder().setName("claim").setDescription("📋 Claim a request")
        .addStringOption(opt => opt.setName("phone").setDescription("Phone number").setRequired(true)),
    new SlashCommandBuilder().setName("setlength").setDescription("🔢 Set code length")
        .addStringOption(opt => opt.setName("phone").setDescription("Phone number").setRequired(true))
        .addIntegerOption(opt => opt.setName("length").setDescription("4 or 6").setRequired(true)),
    new SlashCommandBuilder().setName("wrongnumber").setDescription("❌ Mark as wrong number")
        .addStringOption(opt => opt.setName("phone").setDescription("Phone number").setRequired(true)),
    new SlashCommandBuilder().setName("banip").setDescription("🚫 Ban an IP address")
        .addStringOption(opt => opt.setName("ip").setDescription("IP address").setRequired(true)),
    new SlashCommandBuilder().setName("stats").setDescription("📊 Show global statistics"),
    new SlashCommandBuilder().setName("today").setDescription("📅 Show today's statistics"),
    new SlashCommandBuilder().setName("operators").setDescription("📡 Show operator distribution"),
    new SlashCommandBuilder().setName("activity").setDescription("📈 Show hourly activity (24h)")
        .addIntegerOption(opt => opt.setName("hours").setDescription("Hours to show (default 24)").setRequired(false)),
    new SlashCommandBuilder().setName("leaderboard").setDescription("🏆 Show staff leaderboard")
        .addIntegerOption(opt => opt.setName("limit").setDescription("Number of results (default 10)").setRequired(false)),
    new SlashCommandBuilder().setName("staffactivity").setDescription("👥 Show detailed staff activity")
];
