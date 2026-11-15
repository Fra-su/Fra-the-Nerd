// ─── Talk: chat with the from-scratch AI models ─────────────────────────────
// Replies come from small language models trained from scratch (see
// models.js and model/). They run right here inside the bot, so nothing
// else needs to be running. Every model in model/ shows up automatically.
//
// Ways to talk in Discord:
//   /talk message:<text>                    (uses the default model: English)
//   /talk message:<text> model:Shakespeare  (pick a model)
//   @bot <text>                             (default model)
//   @bot shakespeare: <text>                (pick a model)
//
// Every reply comes in two versions made two different ways (see AB below),
// in random order, with "One is better" / "Two is better" buttons. Votes are
// saved in MongoDB (database "chatbot", collection "feedback") and
// /talkresults shows which way is winning.
//
// ✏️ Change the default model with DEFAULT_MODEL in .env / Railway variables.

const crypto = require("crypto");
const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require("discord.js");
const models = require("./models");
const stats = require("./stats");

const MODELS = models.list();
const DEFAULT_MODEL =
  (process.env.DEFAULT_MODEL && MODELS.includes(process.env.DEFAULT_MODEL) && process.env.DEFAULT_MODEL) ||
  (MODELS.includes("english") ? "english" : MODELS[0]);

// ✏️ The two ways of replying compared in every message (names from models.METHODS)
const AB = ["best", "plain"];
const METHOD_NAMES = { best: "best of 5 + no repeats", plain: "plain (first try)" };

const pretty = name => name.charAt(0).toUpperCase() + name.slice(1);

// ─── Slash commands ──────────────────────────────────────────────────────────
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

const talkResultsData = new SlashCommandBuilder()
  .setName("talkresults")
  .setDescription("See which way of replying people prefer");

// ─── Replies ─────────────────────────────────────────────────────────────────
function getReply(model, message, method) {
  try {
    return models.reply(model, message, method);
  } catch (err) {
    console.error(`⚠️ AI model "${model}" error:`, err.message);
    return null;
  }
}

const BROKEN = "That AI model couldn't load (is the model/ folder there?).";

// Keep replies from pinging @everyone / roles / users
const SAFE = { allowedMentions: { parse: [] } };

// Two replies made two different ways, shown in random order so nobody can tell which is which.
function makePair(model, text) {
  const methods = Math.random() < 0.5 ? [AB[0], AB[1]] : [AB[1], AB[0]];
  const replies = methods.map(m => getReply(model, text, m));
  return { methods, replies, ok: replies.every(Boolean) };
}

function formatPair(replies) {
  return `**1.** ${replies[0]}\n**2.** ${replies[1]}`;
}

// Vote choices: 0 = version 1 better, 1 = version 2 better, 2 = both fine, 3 = neither good
const CHOICES = ["One is better", "Two is better", "Both are fine", "Neither is good"];
const BOTH = 2, NEITHER = 3;

function voteRow(id, counts = [0, 0, 0, 0]) {
  const label = (text, n) => (n ? `${text} (${n})` : text);
  return new ActionRowBuilder().addComponents(
    CHOICES.map((text, i) =>
      new ButtonBuilder().setCustomId(`talkvote:${id}:${i}`).setLabel(label(text, counts[i])).setStyle(ButtonStyle.Secondary))
  );
}

// ─── Feedback storage (MongoDB, with an in-memory fallback) ──────────────────
const memory = new Map(); // id -> doc, used only if MongoDB can't be reached

async function feedback() {
  return (await stats.getNamedDB("chatbot")).collection("feedback");
}

async function saveFeedback(doc) {
  try {
    await (await feedback()).insertOne(doc);
  } catch (err) {
    console.warn("⚠️ Vote not saved to MongoDB (kept in memory):", err.message);
    memory.set(doc._id, doc);
  }
}

async function newFeedback({ model, prompt, methods, replies, guildId, channelId, userId }) {
  const doc = {
    _id: crypto.randomBytes(8).toString("hex"),
    createdAt: new Date(),
    model, prompt, guildId, channelId, askedBy: userId,
    versions: methods.map((method, i) => ({ method, text: replies[i] })),
    votes: {}, // userId -> 0 (version 1 better), 1 (version 2 better), 2 (both fine), 3 (neither good)
  };
  await saveFeedback(doc);
  return doc._id;
}

// ─── Handlers ────────────────────────────────────────────────────────────────
async function executeTalk(interaction) {
  const message = interaction.options.getString("message");
  const model = interaction.options.getString("model") || DEFAULT_MODEL;
  await interaction.deferReply();
  const pair = makePair(model, message);
  if (!pair.ok) return interaction.editReply({ content: BROKEN, ...SAFE });
  const id = await newFeedback({
    model, prompt: message, ...pair,
    guildId: interaction.guildId, channelId: interaction.channelId, userId: interaction.user?.id,
  });
  return interaction.editReply({ content: `> ${message}\n${formatPair(pair.replies)}`, components: [voteRow(id)], ...SAFE });
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
    return message.reply({ content: `Say something after the mention! Pick an AI with ${names}`, ...SAFE });
  }
  await message.channel.sendTyping().catch(() => {});
  const pair = makePair(model, text);
  if (!pair.ok) return message.reply({ content: BROKEN, ...SAFE });
  const id = await newFeedback({
    model, prompt: text, ...pair,
    guildId: message.guildId, channelId: message.channelId, userId: message.author.id,
  });
  return message.reply({ content: formatPair(pair.replies), components: [voteRow(id)], ...SAFE });
}

// A vote button click. Everyone gets one vote per message and can change it.
async function handleVote(interaction) {
  const [, id, pick] = interaction.customId.split(":");
  const choice = Number(pick);
  if (!Number.isInteger(choice) || choice < 0 || choice >= CHOICES.length) {
    return interaction.reply({ content: "Unknown vote.", flags: MessageFlags.Ephemeral });
  }
  const userId = interaction.user.id;
  let doc = null;
  try {
    doc = await (await feedback()).findOneAndUpdate(
      { _id: id }, { $set: { [`votes.${userId}`]: choice } }, { returnDocument: "after" });
  } catch (err) {
    console.warn("⚠️ Vote not saved to MongoDB:", err.message);
  }
  if (!doc && memory.has(id)) {
    doc = memory.get(id);
    doc.votes[userId] = choice;
  }
  if (!doc) {
    return interaction.reply({ content: "Sorry, I couldn't record that vote.", flags: MessageFlags.Ephemeral });
  }
  const counts = CHOICES.map(() => 0);
  for (const v of Object.values(doc.votes || {})) if (counts[v] !== undefined) counts[v]++;
  return interaction.update({ components: [voteRow(id, counts)] });
}

// /talkresults: wins per way of replying, per model
async function executeTalkResults(interaction) {
  await interaction.deferReply();
  let docs = [];
  try {
    docs = await (await feedback()).find({}, { projection: { model: 1, versions: 1, votes: 1 } }).toArray();
  } catch (err) {
    docs = [...memory.values()];
  }
  const tally = {}; // model -> { wins: { method -> n }, both: n, neither: n }
  let votes = 0;
  for (const d of docs) {
    for (const v of Object.values(d.votes || {})) {
      const t = (tally[d.model] ??= { wins: {}, both: 0, neither: 0 });
      if (v === BOTH) t.both++;
      else if (v === NEITHER) t.neither++;
      else {
        const method = d.versions?.[v]?.method;
        if (!method) continue;
        t.wins[method] = (t.wins[method] || 0) + 1;
      }
      votes++;
    }
  }
  if (!votes) return interaction.editReply("No votes yet! Use /talk and click the buttons.");
  const lines = Object.entries(tally).map(([model, t]) => {
    const picked = Object.values(t.wins).reduce((a, b) => a + b, 0);
    const parts = Object.entries(t.wins).sort((a, b) => b[1] - a[1])
      .map(([m, n]) => `${METHOD_NAMES[m] || m}: ${n} (${Math.round((100 * n) / picked)}%)`);
    const head = parts.length ? parts.join(" vs ") : "no picks yet";
    return `**${pretty(model)}**: ${head} | both fine: ${t.both} | neither good: ${t.neither}`;
  });
  return interaction.editReply(`Votes so far (${votes}):\n${lines.join("\n")}`);
}

module.exports = {
  talkData, talkResultsData, executeTalk, executeTalkResults, handleMention, handleVote,
  getReply, pickModel, makePair, MODELS, DEFAULT_MODEL,
};
