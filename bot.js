const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, ActivityType } = require("discord.js");
const express = require("express");
const crypto = require("crypto");
require("dotenv").config();

const mafiaCommand = require("./mafia");
const spamCommand  = require("./spam");
const coordCommand = require("./coord");
const talkCommand  = require("./talk");
const { getPlayerStats, getLeaderboard, getPlayerRank } = require("./stats");

// ─── Elo History Chart ────────────────────────────────────────────────────────
// ✏️ How many of the most recent games to show when "all" isn't requested.
const ELO_CHART_DEFAULT_WINDOW = 20;
// ✏️ Hard cap on points plotted even with all:true — QuickChart is a GET-URL
// based renderer, so an extremely long history could risk hitting URL length
// limits on some hosts. 150 points keeps the URL comfortably short.
const ELO_CHART_MAX_ALL_POINTS = 150;

// Builds a QuickChart.io line-chart URL from a player's Elo history — no
// charting library/native deps needed on our end, QuickChart renders the
// image and we just link to it.
function buildEloChartUrl(eloHistory, showAll) {
  if (!eloHistory || eloHistory.length === 0) return null;

  const window = showAll
    ? eloHistory.slice(-ELO_CHART_MAX_ALL_POINTS)
    : eloHistory.slice(-ELO_CHART_DEFAULT_WINDOW);
  const labels = window.map((_, i) => `${i + 1}`);
  const values = window.map(h => h.elo);

  const config = {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Elo",
        data: values,
        borderColor: "#ff2d78",
        backgroundColor: "rgba(255, 45, 120, 0.12)",
        fill: true,
        pointRadius: 3,
        pointBackgroundColor: "#ff2d78",
        tension: 0.25,
      }],
    },
    options: {
      plugins: { legend: { display: false }, title: { display: false } },
      scales: {
        x: { title: { display: true, text: showAll ? "Game #" : `Last ${window.length} games` } },
        y: { title: { display: true, text: "Elo" } },
      },
    },
  };

  return `https://quickchart.io/chart?width=700&height=350&backgroundColor=white&c=${encodeURIComponent(JSON.stringify(config))}`;
}

// ─── Statuses ─────────────────────────────────────────────────────────────────
const STATUSES = [
  "Watching Jerry coding...",
  "Popped Pop...",
  "Accidentally ate a bot...",
  "Cloning itself...",
  "Building an AI army...",
  "Burning down a city...",
];

const STATUS_INTERVAL_MS = 150_000; // Change every 150 seconds — edit this number to adjust
let statusIndex = 0;

function rotateStatus(client) {
  const text = STATUSES[statusIndex % STATUSES.length];
  client.user.setActivity({ name: text, type: ActivityType.Custom });
  statusIndex++;
}


// ─── Discord Client Setup ────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once("ready", async () => {
  console.log(`✅ Discord bot logged in as ${client.user.tag}`);

  // Warm up MongoDB connection on startup
  const { getPlayerStats } = require("./stats");
  getPlayerStats("warmup").catch(() => {}); // intentional — just opens the connection

  // Start rotating status
  rotateStatus(client);
  setInterval(() => rotateStatus(client), STATUS_INTERVAL_MS);

  // Register slash commands
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    console.log("🔄 Registering slash commands...");
    const { SlashCommandBuilder } = require("discord.js");
    const statsCmd = new SlashCommandBuilder()
      .setName("stats")
      .setDescription("View your Mafia stats!")
      .addUserOption(o => o.setName("player").setDescription("View another player's stats").setRequired(false))
      .addBooleanOption(o => o.setName("all").setDescription("Show your entire Elo history instead of just the last 20 games").setRequired(false));
    const leaderboardCmd = new SlashCommandBuilder()
      .setName("leaderboard")
      .setDescription("View the Mafia leaderboard!")
      .addStringOption(o =>
        o.setName("scope").setDescription("Server or Global leaderboard").setRequired(false)
          .addChoices({ name: "Server", value: "server" }, { name: "Global", value: "global" })
      );

    await rest.put(Routes.applicationCommands(client.user.id), {
      body: [
        mafiaCommand.data.toJSON(),
        mafiaCommand.endMafiaData.toJSON(),
        mafiaCommand.mafiaRolesData.toJSON(),
        mafiaCommand.mafiaDebugData.toJSON(),
        spamCommand.spamData.toJSON(),
        spamCommand.stopData.toJSON(),
        statsCmd.toJSON(),
        leaderboardCmd.toJSON(),
        coordCommand.coordData.toJSON(),
        talkCommand.talkData.toJSON(),
      ],
    });
    console.log("✅ Slash commands registered!");
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
  }
});

// ─── Interaction Handler ─────────────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  // Slash command
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "mafia") {
      await mafiaCommand.execute(interaction);
    } else if (interaction.commandName === "endmafia") {
      await mafiaCommand.executeEndMafia(interaction);
    } else if (interaction.commandName === "mafiadebug") {
      await mafiaCommand.executeMafiaDebug(interaction);
    } else if (interaction.commandName === "mafiaroles") {
      await mafiaCommand.executeMafiaRoles(interaction);
    } else if (interaction.commandName === "spam") {
      await spamCommand.executeSpam(interaction);
    } else if (interaction.commandName === "stopspam") {
      await spamCommand.executeStop(interaction);

    } else if (interaction.commandName === "stats") {
      await interaction.deferReply();
      const target     = interaction.options.getUser("player") || interaction.user;
      const showAll    = interaction.options.getBoolean("all") || false;
      const stats      = await getPlayerStats(target.id);
      const guildId    = interaction.guild.id;
      const serverRank = await getPlayerRank(target.id, guildId);
      const globalRank = await getPlayerRank(target.id, "global");

      if (!stats) {
        return interaction.editReply({ content: `❌ ${target.id === interaction.user.id ? "You haven't" : `<@${target.id}> hasn't`} played any games yet!` });
      }

      const eloValue = stats.isPeak ? `${stats.elo.toFixed(1)} 🔥 **Peak Elo!**` : `${stats.elo.toFixed(1)}`;

      const embed = new EmbedBuilder()
        .setColor(0x4a90d9)
        .setTitle(`📊 ${target.username}'s Mafia Stats`)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          { name: "🎮 Games Played", value: `${stats.games}`,                          inline: true },
          { name: "🏆 Wins",         value: `${stats.wins}`,                            inline: true },
          { name: "📈 Win Rate",      value: `${stats.winrate}%`,                       inline: true },
          { name: "🏅 Server Rank",   value: serverRank ? `#${serverRank}` : "Unranked", inline: true },
          { name: "🌍 Global Rank",   value: globalRank ? `#${globalRank}` : "Unranked", inline: true },
          { name: "📈 Elo",          value: eloValue,                                   inline: true },
          { name: "🏔️ Peak Elo",     value: `${stats.peakElo.toFixed(1)}`,              inline: true },
        )
        .setFooter({ text: showAll
          ? `Elo starts at 1000 — showing ${Math.min(stats.eloHistory.length, 150)} of ${stats.eloHistory.length} recorded games.`
          : "Elo starts at 1000 — showing the last 20 games. Use /stats all:true for full history." });

      const chartUrl = buildEloChartUrl(stats.eloHistory, showAll);
      if (chartUrl) embed.setImage(chartUrl);

      return interaction.editReply({ embeds: [embed] });

    } else if (interaction.commandName === "leaderboard") {
      await interaction.deferReply();
      const scope   = interaction.options.getString("scope") || "server";
      const guildId = interaction.guild.id;
      const key     = scope === "global" ? "global" : guildId;
      const board   = await getLeaderboard(key, 10);

      if (board.length === 0)
        return interaction.editReply({ content: "❌ No stats recorded yet!" });

      const rows = board.map((e, i) =>
        `**${i + 1}.** <@${e.userId}> — 📈 ${e.elo.toFixed(1)} | 🏆 ${e.wins}/${e.games} (${e.winrate}%)`
      ).join("\n");

      const embed = new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle(`${scope === "global" ? "🌍 Global" : "🏠 Server"} Mafia Leaderboard`)
        .setDescription(rows)
        .setFooter({ text: "Ranked by Elo" });

      return interaction.editReply({ embeds: [embed] });
    } else if (interaction.commandName === "setupcoord") {
      await coordCommand.executeSetupCoord(interaction);
    } else if (interaction.commandName === "talk") {
      await talkCommand.executeTalk(interaction);
    }
    return;
  }

  // Buttons and Select Menus — route to mafia handler
  if (interaction.isButton() || interaction.isStringSelectMenu()) {
    const mafiaIds = [
      "join_mafia", "check_role", "use_ability", "im_evil",
      "cast_vote", "rps_pick", "end_phase", "prenight_ability",
      "leech_heal", "scorpion_activate",
    ];
    const mafiaSelectIds = [
      "mafia_kill_target", "vote_target", "rps_choice", "hornet_missile", "dandelion_target",
    ];

    const id = interaction.customId;
    const isMafia = mafiaIds.includes(id)
      || mafiaSelectIds.includes(id)
      || id.startsWith("ability_target_"); // handles all roles dynamically

    if (isMafia) {
      await mafiaCommand.handleMafiaInteraction(interaction);
    } else if (id === "coord_work" || id === "coord_finish") {
      await coordCommand.handleCoordInteraction(interaction);
    }
  }
});

// ─── @mention → Shakespeare AI reply ─────────────────────────────────────────
client.on("messageCreate", (message) => {
  talkCommand.handleMention(message, client.user).catch(err => console.error("Talk error:", err));
});

// Clean up common copy-paste mistakes (spaces, quotes) and log a safe summary
// of the token (never the token itself) so a bad setup is easy to spot in logs.
const rawToken = process.env.DISCORD_BOT_TOKEN;
const token = (rawToken || "").trim().replace(/^["']|["']$/g, "").trim();
if (!rawToken) {
  console.error("❌ DISCORD_BOT_TOKEN is not set. Add it to .env (on your PC) or the host's variables (e.g. Railway).");
} else {
  const notes = [];
  if (token !== rawToken) notes.push("removed spaces/quotes around it");
  if (/\s/.test(token)) notes.push("STILL CONTAINS SPACES - re-paste it");
  console.log(`🔑 Token found: ${token.length} characters, ${token.split(".").length} parts (should be 3)` +
    (notes.length ? ` — ${notes.join("; ")}` : ""));
}

client.login(token);

// ─── Express Webhook Server ──────────────────────────────────────────────────
const app = express();

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

function verifyGitHubSignature(req) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return true;

  const signature = req.headers["x-hub-signature-256"];
  if (!signature) return false;

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(req.rawBody);
  const digest = `sha256=${hmac.digest("hex")}`;

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

app.post("/webhook", async (req, res) => {
  if (!verifyGitHubSignature(req)) {
    console.warn("⚠️  Invalid GitHub signature — request rejected.");
    return res.status(401).send("Unauthorized");
  }

  const event = req.headers["x-github-event"];
  if (event !== "push") return res.status(200).send(`Event "${event}" ignored.`);

  const payload = req.body;
  const commits = payload.commits ?? [];
  if (commits.length === 0) return res.status(200).send("No commits.");

  const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.error("❌ Could not find Discord channel.");
    return res.status(500).send("Discord channel not found.");
  }

  for (const commit of commits) {
    const embed = new EmbedBuilder()
      .setColor(0x24292f)
      .setAuthor({
        name: commit.author.name,
        iconURL: `https://github.com/${commit.author.username}.png`,
        url: `https://github.com/${commit.author.username}`,
      })
      .setTitle(`📦 New commit to \`${payload.ref.replace("refs/heads/", "")}\``)
      .setURL(commit.url)
      .setDescription(`\`\`\`\n${commit.message}\n\`\`\``)
      .addFields(
        { name: "Repository", value: `[${payload.repository.full_name}](${payload.repository.html_url})`, inline: true },
        { name: "Branch", value: payload.ref.replace("refs/heads/", ""), inline: true },
        {
          name: "Files changed",
          value: [
            commit.added.length ? `✅ Added: ${commit.added.length}` : null,
            commit.modified.length ? `✏️  Modified: ${commit.modified.length}` : null,
            commit.removed.length ? `🗑️  Removed: ${commit.removed.length}` : null,
          ]
            .filter(Boolean)
            .join("\n") || "None",
          inline: true,
        }
      )
      .setFooter({ text: commit.id.slice(0, 7) })
      .setTimestamp(new Date(commit.timestamp));

    await channel.send({ embeds: [embed] });
  }

  console.log(`✅ Sent ${commits.length} commit(s) to Discord.`);
  res.status(200).send("OK");
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Webhook server listening on port ${PORT}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.warn(`⚠️ Port ${PORT} already in use — webhook server not started. Bot will still function.`);
  } else {
    console.error("Server error:", err);
  }
});