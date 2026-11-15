const { SlashCommandBuilder } = require("discord.js");

const spamming = new Map(); // channelId -> true

async function runSpam(channel) {
  while (spamming.get(channel.id)) {
    await channel.send("Spam");
  }
}

module.exports = {
  spamData: new SlashCommandBuilder()
    .setName("spam")
    .setDescription("Spams as fast as possible!"),

  stopData: new SlashCommandBuilder()
    .setName("stopspam")
    .setDescription("Stop the spam!"),

  async executeSpam(interaction) {
    if (spamming.get(interaction.channelId)) {
      return interaction.reply({ content: "❌ Already spamming in this channel!", ephemeral: true });
    }
    spamming.set(interaction.channelId, true);
    await interaction.reply("Spam started! Use **/stopspam** to stop.");
    runSpam(interaction.channel);
  },

  async executeStop(interaction) {
    if (!spamming.get(interaction.channelId)) {
      return interaction.reply({ content: "❌ No spam is running in this channel!", ephemeral: true });
    }
    spamming.delete(interaction.channelId);
    await interaction.reply("🛑 Spam stopped!");
  },
};
