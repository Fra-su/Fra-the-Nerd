// ─── Talk: the Shakespeare chatbot ──────────────────────────────────────────
// Replies come from a small language model trained from scratch
// (see shakespeare.js and model/). It runs right here inside the bot,
// so nothing else needs to be running.
//
// Two ways to talk to it in Discord:
//   /talk message:<text>
//   @mention the bot in a message

const { SlashCommandBuilder } = require("discord.js");
const shakespeare = require("./shakespeare");

const talkData = new SlashCommandBuilder()
  .setName("talk")
  .setDescription("Talk to the Shakespeare AI (trained from scratch)")
  .addStringOption(o =>
    o.setName("message").setDescription("What do you say to it?").setRequired(true).setMaxLength(300)
  );

function getReply(message) {
  try {
    return shakespeare.reply(message);
  } catch (err) {
    console.error("⚠️ Shakespeare AI error:", err.message);
    return null;
  }
}

const BROKEN = "😵 The Shakespeare AI couldn't load its model (is the model/ folder there?).";

// Keep replies from pinging @everyone / roles / users
const SAFE = { allowedMentions: { parse: [] } };

async function executeTalk(interaction) {
  const message = interaction.options.getString("message");
  await interaction.deferReply();
  const reply = getReply(message);
  return interaction.editReply({
    content: reply ? `> ${message}\n🎭 ${reply}` : BROKEN,
    ...SAFE,
  });
}

// Called for every message; only answers when the bot is @mentioned
async function handleMention(message, botUser) {
  if (message.author.bot || !message.mentions.has(botUser, { ignoreEveryone: true, ignoreRoles: true })) return;
  const text = message.content.replace(/<@!?\d+>/g, "").trim();
  if (!text) return message.reply({ content: "🎭 Speak, speak! (@mention me with a message)", ...SAFE });
  await message.channel.sendTyping().catch(() => {});
  const reply = getReply(text);
  return message.reply({ content: reply ? `🎭 ${reply}` : BROKEN, ...SAFE });
}

module.exports = { talkData, executeTalk, handleMention, getReply };
