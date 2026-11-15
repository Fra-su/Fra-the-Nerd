// ─── Talk: chat with the from-scratch AI models ─────────────────────────────
// Replies come from small language models trained from scratch (see
// models.js and model/). They run right here inside the bot, so nothing
// else needs to be running. Every model in model/ shows up automatically.
//
// Ways to talk in Discord:
//   /talk message:<text>                    (uses the default model)
//   /talk message:<text> model:English      (pick a model)
//   @bot <text>                             (default model)
//   @bot english: <text>                    (pick a model)
//
// ✏️ Change the default model with DEFAULT_MODEL in .env / Railway variables.

const { SlashCommandBuilder } = require("discord.js");
const models = require("./models");

const MODELS = models.list();
const DEFAULT_MODEL =
  (process.env.DEFAULT_MODEL && MODELS.includes(process.env.DEFAULT_MODEL) && process.env.DEFAULT_MODEL) ||
  (MODELS.includes("shakespeare") ? "shakespeare" : MODELS[0]);

// ✏️ The emoji shown in front of each model's replies
const EMOJI = { shakespeare: "🎭", english: "💬" };
const emoji = name => EMOJI[name] || "🤖";
const pretty = name => name.charAt(0).toUpperCase() + name.slice(1);

const talkData = new SlashCommandBuilder()
  .setName("talk")
  .setDescription("Talk to an AI trained from scratch")
  .addStringOption(o =>
    o.setName("message").setDescription("What do you say to it?").setRequired(true).setMaxLength(300)
  )
  .addStringOption(o =>
    o.setName("model")
      .setDescription(`Which AI to talk to (default: ${pretty(DEFAULT_MODEL || "none")})`)
      .setRequired(false)
      .addChoices(...MODELS.slice(0, 25).map(n => ({ name: pretty(n), value: n })))
  );

function getReply(model, message) {
  try {
    return models.reply(model, message);
  } catch (err) {
    console.error(`⚠️ AI model "${model}" error:`, err.message);
    return null;
  }
}

const BROKEN = "😵 That AI model couldn't load (is the model/ folder there?).";

// Keep replies from pinging @everyone / roles / users
const SAFE = { allowedMentions: { parse: [] } };

async function executeTalk(interaction) {
  const message = interaction.options.getString("message");
  const model = interaction.options.getString("model") || DEFAULT_MODEL;
  await interaction.deferReply();
  const reply = getReply(model, message);
  return interaction.editReply({
    content: reply ? `> ${message}\n${emoji(model)} **${pretty(model)}:** ${reply}` : BROKEN,
    ...SAFE,
  });
}

// "english: hello" -> { model: "english", text: "hello" }
function pickModel(text) {
  const m = text.match(/^([a-z0-9_-]+)\s*:\s*([\s\S]*)$/i);
  if (m && MODELS.includes(m[1].toLowerCase())) return { model: m[1].toLowerCase(), text: m[2].trim() };
  return { model: DEFAULT_MODEL, text };
}

// Called for every message; only answers when the bot is @mentioned
async function handleMention(message, botUser) {
  if (message.author.bot || !message.mentions.has(botUser, { ignoreEveryone: true, ignoreRoles: true })) return;
  const { model, text } = pickModel(message.content.replace(/<@!?\d+>/g, "").trim());
  if (!text) {
    const names = MODELS.map(n => `\`${n}:\``).join(" or ");
    return message.reply({ content: `${emoji(model)} Say something after the mention! Pick an AI with ${names}`, ...SAFE });
  }
  await message.channel.sendTyping().catch(() => {});
  const reply = getReply(model, text);
  return message.reply({ content: reply ? `${emoji(model)} ${reply}` : BROKEN, ...SAFE });
}

module.exports = { talkData, executeTalk, handleMention, getReply, pickModel, MODELS, DEFAULT_MODEL };
