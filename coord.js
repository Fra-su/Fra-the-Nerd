const {
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
} = require("discord.js");

// ─── Allowed users (Discord usernames) ───────────────────────────────────────
// ✏️ Add or remove usernames here
const ALLOWED_USERNAMES = ["twilight_chasm", "eclair_1011", "u_cant_see_me_hehehehe"];

// ─── State ────────────────────────────────────────────────────────────────────
let currentWorker = null; // { userId, username } or null
let statusMessageId = null;
let statusChannelId = null;

// ─── Build the status embed + buttons ────────────────────────────────────────
function buildStatusMessage() {
  const embed = new EmbedBuilder()
    .setColor(currentWorker ? 0xff6b35 : 0x00ff7f)
    .setTitle("🎮 Game Development Status")
    .setDescription(
      currentWorker
        ? `🔒 **${currentWorker.username}** is currently working on the game!\n\nPlease wait until they finish before making changes.`
        : `✅ **Nobody is working on the game right now!**\n\nFeel free to press **Work on the game** to claim it.`
    )
    .setFooter({ text: "Only the person working can press Finish." })
    .setTimestamp();

  const workBtn = new ButtonBuilder()
    .setCustomId("coord_work")
    .setLabel("🛠️ Work on the game")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(!!currentWorker); // disabled if someone is already working

  const finishBtn = new ButtonBuilder()
    .setCustomId("coord_finish")
    .setLabel("✅ Finish")
    .setStyle(ButtonStyle.Success)
    .setDisabled(!currentWorker); // disabled if nobody is working

  const row = new ActionRowBuilder().addComponents(workBtn, finishBtn);
  return { embeds: [embed], components: [row] };
}

// ─── Interaction Handler ──────────────────────────────────────────────────────
async function handleCoordInteraction(interaction) {
  const username = interaction.user.username;

  // Check allowed users
  if (!ALLOWED_USERNAMES.includes(username)) {
    return interaction.reply({ content: "❌ You are not allowed to use this!", ephemeral: true });
  }

  // ── Work button ──
  if (interaction.customId === "coord_work") {
    if (currentWorker) {
      return interaction.reply({
        content: `❌ **${currentWorker.username}** is already working on the game! Wait for them to finish.`,
        ephemeral: true,
      });
    }

    currentWorker = { userId: interaction.user.id, username };

    // Update the pinned status message
    try {
      const channel = interaction.channel;
      if (statusMessageId) {
        const msg = await channel.messages.fetch(statusMessageId).catch(() => null);
        if (msg) await msg.edit(buildStatusMessage());
      }
    } catch {}

    return interaction.reply({ content: `✅ You are now marked as working on the game!`, ephemeral: true });
  }

  // ── Finish button ──
  if (interaction.customId === "coord_finish") {
    if (!currentWorker) {
      return interaction.reply({ content: "❌ Nobody is working on the game right now!", ephemeral: true });
    }
    if (currentWorker.userId !== interaction.user.id) {
      return interaction.reply({
        content: `❌ Only **${currentWorker.username}** can press Finish!`,
        ephemeral: true,
      });
    }

    const prevWorker = currentWorker.username;
    currentWorker = null;

    // Update the pinned status message
    try {
      const channel = interaction.channel;
      if (statusMessageId) {
        const msg = await channel.messages.fetch(statusMessageId).catch(() => null);
        if (msg) await msg.edit(buildStatusMessage());
      }
    } catch {}

    return interaction.reply({ content: `✅ **${prevWorker}** has finished working. The game is now free!`, ephemeral: true });
  }
}

// ─── Slash Command ────────────────────────────────────────────────────────────
module.exports = {
  coordData: new SlashCommandBuilder()
    .setName("setupcoord")
    .setDescription("Set up the coordination status message in this channel. (Run once!)"),

  handleCoordInteraction,

  async executeSetupCoord(interaction) {
    // Only allowed users can set it up
    if (!ALLOWED_USERNAMES.includes(interaction.user.username)) {
      return interaction.reply({ content: "❌ You are not allowed to do this!", ephemeral: true });
    }

    const msg = await interaction.channel.send(buildStatusMessage());
    statusMessageId = msg.id;
    statusChannelId = interaction.channelId;

    // Pin it
    await msg.pin().catch(() => {});

    return interaction.reply({ content: "✅ Coordination message set up and pinned!", ephemeral: true });
  },
};
