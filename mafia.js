const {
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  AttachmentBuilder,
} = require("discord.js");
const path = require("path");

// ─── Game State ───────────────────────────────────────────────────────────────
const games = new Map();
// Debug logs survive game deletion so /mafiadebug still works after a game ends.
const lastDebugLogs = new Map(); // channelId -> { debugLog, debugNames, endedAt }
function getGame(channelId) { return games.get(channelId); }

// ─── Debug Log ────────────────────────────────────────────────────────────────
// Each entry: { phase, text }
// Usage: log(game, "Night 1", "(Spider)Twilight -> Use Ability -> ...")
function log(game, phase, text) {
  if (!game.debugLog) game.debugLog = [];
  game.debugLog.push({ phase, text });
}

function playerTag(game, id) {
  const role = game.roles?.[id];
  const info = ROLE_INFO[role];
  const name = game.debugNames?.[id] || id;
  return info ? `(${info.name})${name}` : name;
}

// ─── Images ───────────────────────────────────────────────────────────────────
const IMG = {
  night:       path.join(__dirname, "images", "Night.webp"),
  nightAbility:path.join(__dirname, "images", "Night_Ability.webp"),
  morning:     path.join(__dirname, "images", "Morning.webp"),
  someoneDead: path.join(__dirname, "images", "Someone_Dead.webp"),
  healSave:    path.join(__dirname, "images", "Heal_Save.webp"),
  discuss:     path.join(__dirname, "images", "Discuss.webp"),
  vote:        path.join(__dirname, "images", "Vote.webp"),
  execution:   path.join(__dirname, "images", "Execution.webp"),
  // Role images
  mafia:       path.join(__dirname, "images", "Evil_Centipede.webp"),
  villager:    path.join(__dirname, "images", "Bee.webp"),
  doctor:      path.join(__dirname, "images", "Ladybug.webp"),
  sheriff:     path.join(__dirname, "images", "Spider.webp"),
  hornet:      path.join(__dirname, "images", "Hornet.webp"),
  dandelion:   path.join(__dirname, "images", "Dandelion.webp"),
  prenight:    path.join(__dirname, "images", "Prenight.webp"),
  square:        path.join(__dirname, "images", "Square.webp"),
  squareVictory: path.join(__dirname, "images", "Square_Victory.webp"),
  leech:         path.join(__dirname, "images", "Leech.webp"),
  leechVictory:  path.join(__dirname, "images", "Leech_Victory.webp"),
  soldierAnt:    path.join(__dirname, "images", "Soldier_Ant.webp"),
  scorpion:      path.join(__dirname, "images", "Scorpion.webp"),
  queenAnt:      path.join(__dirname, "images", "Queen_Ant.webp"),
  darkLadybug:   path.join(__dirname, "images", "Dark_Ladybug.webp"),
};

const ART_CREDIT = "Art by the Flowr community";

function attachment(imgPath) {
  try {
    const fs = require("fs");
    if (!fs.existsSync(imgPath)) {
      console.warn(`⚠️ Image not found: ${imgPath}`);
      return null;
    }
    return new AttachmentBuilder(imgPath);
  } catch (e) {
    console.warn(`⚠️ Could not load image ${imgPath}:`, e.message);
    return null;
  }
}

// Send an embed with an image attached to the right (thumbnail)
async function sendWithImage(channel, { color, title, description }, imgPath) {
  const file = attachment(imgPath);
  const filename = file ? path.basename(imgPath) : null;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: ART_CREDIT });
  if (file && filename) embed.setThumbnail(`attachment://${filename}`);
  if (file) return channel.send({ embeds: [embed], files: [file] });
  return channel.send({ embeds: [embed] });
}

// ─── Role Info ────────────────────────────────────────────────────────────────
// ✏️ To add a new role: add it here, add it to assignRoles, and drop its image in /images/
// ✏️ eloModifier (0.5–1.5): how much this role's Elo swings scale up/down.
//    Harder/higher-impact roles > 1.0, passive/low-impact roles < 1.0.
const ROLE_INFO = {
  mafia: {
    name: "Evil Centipede",
    emoji: "🐛",
    team: "Evil",
    image: IMG.mafia,
    eloModifier: 1.4,
    ability: "Each night, coordinate with your team to eliminate a player of your choice. You win by outnumbering the Good or by killing them all!",
  },
  villager: {
    name: "Bee",
    emoji: "🐝",
    team: "Good",
    image: IMG.villager,
    eloModifier: 0.6,
    ability: "Work with the town to find and eliminate the Evil.",
  },
  doctor: {
    name: "Ladybug",
    emoji: "🐞",
    team: "Good",
    image: IMG.doctor,
    eloModifier: 0.9,
    ability: "Use the power of roses to heal one player each night! You cannot choose the same player two nights in a row.",
  },
  sheriff: {
    name: "Spider",
    emoji: "🕷️",
    team: "Good",
    image: IMG.sheriff,
    eloModifier: 1.0,
    ability: "Each night, use your third eye to investigate one player to privately learn if they are Evil or Good.",
  },
  hornet: {
    name: "Hornet",
    emoji: "🐝",
    team: "Good",
    image: IMG.hornet,
    eloModifier: 1.2,
    ability: "When you die (by any means), you fire a parting missile! Choose one alive player to take down with you. Choose wisely!",
  },
  dandelion: {
    name: "Dandelion",
    emoji: "🌼",
    team: "Evil",
    image: IMG.dandelion,
    eloModifier: 1.5,
    ability: "Each Pre-Night, secretly choose one player to Dandelion! Their ability will be negated for that night. You cannot target the same player two nights in a row.",
  },
  square: {
    name: "Square",
    emoji: "🟨",
    team: "Independent",
    color: 0xffd700,
    image: IMG.square,
    eloModifier: 1.3,
    ability: "You win by getting voted out by the town! Once voted out you are eliminated, but your victory will be announced at the end of the game. You are neutral — you don't count as Good or Evil.",
  },
  leech: {
    name: "Leech",
    emoji: "🪱",
    team: "Independent",
    color: 0x8b4513,
    image: IMG.leech,
    eloModifier: 1.3,
    ability: "You are assigned a secret host at the start of the game. Each night, use your ability to view your host and their role. You can also heal your host once every two nights. If your host survives until the end of the game, you win — even if you die!",
  },
  soldierAnt: {
    name: "Soldier Ant",
    emoji: "🐜",
    team: "Good",
    image: IMG.soldierAnt,
    eloModifier: 1.1,
    ability: "Once per game, fire your missile at night to eliminate a target! If your target is Evil or Independent, you survive and are told they weren't Good. If your target is Good and dies, you die of guilt. If your target is already dead (e.g. killed by Evil the same night), you survive but your ability is still used.",
  },
  scorpion: {
    name: "Scorpion",
    emoji: "🦂",
    team: "Good",
    image: IMG.scorpion,
    eloModifier: 1.1,
    ability: "Once per game, activate your poison at night. If anyone tries to kill you that night, they get poisoned and die the next morning — but can be saved by Ladybug. You still die when your ability activates. If multiple Evils targeted you, one random Evil is poisoned.",
  },
  queenAnt: {
    name: "Queen Ant",
    emoji: "👑",
    team: "Good",
    image: IMG.queenAnt,
    eloModifier: 1.0,
    ability: "Your vote counts as 3! When you vote for someone during the day, your vote carries triple weight. The town will see your pick highlighted as the QUEEN'S PICK.",
  },
  darkLadybug: {
    name: "Dark Ladybug",
    emoji: "🖤",
    team: "Evil",
    image: IMG.darkLadybug,
    eloModifier: 1.3,
    ability: "You vote with your team each night to choose a kill, same as any other Evil player. On top of that, once every two nights you can heal one of your Evil teammates, protecting them from Doctor-detectable deaths that same night.",
  },
};

// ─── Role Assignment ──────────────────────────────────────────────────────────
const EVIL_ROLES = ["mafia", "dandelion", "darkLadybug"];

function isEvil(role)        { return ROLE_INFO[role]?.team === "Evil"; }
function isGood(role)        { return ROLE_INFO[role]?.team === "Good"; }
function isIndependent(role) { return ROLE_INFO[role]?.team === "Independent"; }

// Equal weight for all evil roles
const EVIL_WEIGHT = 10;

// Weights for good + independent roles
const ROLE_WEIGHTS = {
  villager:   20,
  doctor:     8,
  sheriff:    8,
  hornet:     10,
  soldierAnt: 8,
  scorpion:   8,
  queenAnt:   6,
  square:     5,
  leech:      5,
};

const INDEPENDENT_ROLES = ["square", "leech"]; // max 1 each per game

function weightedPickRole(exclude = [], roleCounts = {}) {
  const available = Object.entries(ROLE_WEIGHTS).filter(([r]) => {
    if (exclude.includes(r)) return false;
    // Independents capped at 1, others capped at 2
    const cap = INDEPENDENT_ROLES.includes(r) ? 1 : 2;
    if ((roleCounts[r] || 0) >= cap) return false;
    return true;
  });
  if (available.length === 0) return "villager"; // fallback
  const total = available.reduce((sum, [, w]) => sum + w, 0);
  let rand = Math.random() * total;
  for (const [role, weight] of available) {
    rand -= weight;
    if (rand <= 0) return role;
  }
  return available[available.length - 1][0];
}

function assignRoles(players) {
  const count = players.length;

  // ── Evil selection (equal weight) ────────────────────────────────────────
  const evilCount = count <= 6 ? 1 : count <= 10 ? 2 : 3;
  const evilPool  = [...EVIL_ROLES];
  const evilRoles = [];
  for (let i = 0; i < evilCount; i++) {
    if (evilPool.length === 0) { evilRoles.push("mafia"); continue; }
    const pick = evilPool.splice(Math.floor(Math.random() * evilPool.length), 1)[0];
    evilRoles.push(pick);
  }

  // ── Good + Independent selection (weighted, shared pool) ──────────────────
  const goodCount  = count - evilCount;
  const goodRoles  = [];
  const roleCounts = {};

  for (let i = 0; i < goodCount; i++) {
    const pick = weightedPickRole([], roleCounts);
    goodRoles.push(pick);
    roleCounts[pick] = (roleCounts[pick] || 0) + 1;
  }

  // ── Shuffle and assign ────────────────────────────────────────────────────
  const allRoles = [...evilRoles, ...goodRoles].sort(() => Math.random() - 0.5);
  const assigned = {};
  players.forEach((id, idx) => { assigned[id] = allRoles[idx]; });
  return assigned;
}


function ts(offsetMs = 0) {
  return `<t:${Math.floor((Date.now() + offsetMs) / 1000)}:R>`;
}

function buildPlayerList(game) {
  return game.alivePlayers.map((id, idx) => `**${idx + 1}.** <@${id}>`).join("\n");
}

async function getNames(guild, ids) {
  const names = {};
  await guild.members.fetch({ user: ids }).catch(() => {});
  for (const id of ids) {
    const member = guild.members.cache.get(id);
    names[id] = member?.displayName || `User ${id.slice(-4)}`;
  }
  return names;
}

// ─── Dead Role ────────────────────────────────────────────────────────────────
const DEAD_ROLE_NAME = "mafia-dead";

async function assignDeadRole(guild, userId) {
  try {
    const role = guild.roles.cache.find(r => r.name === DEAD_ROLE_NAME);
    if (!role) return;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) await member.roles.add(role).catch(() => {});
  } catch {}
}

async function removeDeadRole(guild, userId) {
  try {
    const role = guild.roles.cache.find(r => r.name === DEAD_ROLE_NAME);
    if (!role) return;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) await member.roles.remove(role).catch(() => {});
  } catch {}
}

async function removeAllDeadRoles(guild, playerIds) {
  for (const id of playerIds) await removeDeadRole(guild, id);
}

// ─── Elo Tracking Helpers ───────────────────────────────────────────────────
// Records which round (nightCount) a player died on, for the "early death" Elo rule.
function recordDeath(game, id) {
  if (!game.deathNight) game.deathNight = {};
  if (game.deathNight[id] === undefined) game.deathNight[id] = game.nightCount;
}

// Small nudge for Good players who helped kill an Evil (scorpion poison,
// soldier ant shot, or a correct final vote), used by the Elo system.
function addContribution(game, id, amt = 1) {
  if (!game.contributions) game.contributions = {};
  game.contributions[id] = (game.contributions[id] || 0) + amt;
}

// ─── End Phase Button ─────────────────────────────────────────────────────────
function buildEndPhaseButton(game) {
  const count = game.endPhaseVotes ? game.endPhaseVotes.size : 0;
  const total = game.alivePlayers.length;
  return new ButtonBuilder()
    .setCustomId("end_phase")
    .setLabel(`⏩ End Phase (${count}/${total})`)
    .setStyle(ButtonStyle.Secondary);
}

async function updateEndPhaseButton(phaseMessage, game) {
  if (!phaseMessage) return;
  try {
    const currentComponents = phaseMessage.components;
    if (!currentComponents || currentComponents.length === 0) return;
    const newRows = currentComponents.map(row => {
      const newRow = new ActionRowBuilder();
      newRow.addComponents(row.components.map(btn => {
        if (btn.customId === "end_phase") return buildEndPhaseButton(game);
        return ButtonBuilder.from(btn);
      }));
      return newRow;
    });
    await phaseMessage.edit({ components: newRows }).catch(() => {});
  } catch {}
}

// ─── Win Condition ────────────────────────────────────────────────────────────
function checkWinCondition(game, lastVotes = null) {
  const aliveMafia = game.alivePlayers.filter(id => isEvil(game.roles[id]));
  const aliveGood  = game.alivePlayers.filter(id => isGood(game.roles[id]));

  // Tie: nobody left alive (e.g. Hornet kills last Evil on death)
  if (game.alivePlayers.length === 0) return "tie";

  if (aliveMafia.length === 0) return "good";
  if (aliveGood.length === 0)  return "evil";

  if (game.alivePlayers.length === 2 && lastVotes) {
    const [p1, p2] = game.alivePlayers;
    if (lastVotes[p1] === p2 && lastVotes[p2] === p1) return "tiebreaker";
  }

  return null;
}

// ─── Hornet Missile ───────────────────────────────────────────────────────────
// Called whenever a Hornet dies. Sends a missile prompt to the Hornet's DMs/channel.
// Returns a promise that resolves when the missile is fired or times out.
async function triggerHornetMissile(channel, game, hornetId) {
  // Hornet is already dead — remove from alivePlayers before this is called
  const targets = game.alivePlayers.filter(id => id !== hornetId);
  if (targets.length === 0) return; // nobody to shoot

  // Store pending missile state
  game.pendingHornet = { hornetId, resolve: null };

  const names = await getNames(channel.guild, targets);
  const options = targets.map((id, idx) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${idx + 1}. ${names[id]}`)
      .setValue(id)
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId("hornet_missile")
    .setPlaceholder("Choose your target...")
    .addOptions(options);

  const targetList = targets.map((id, idx) => `**${idx + 1}.** <@${id}>`).join("\n");

  await channel.send({
    content: `<@${hornetId}>`,
    embeds: [
      new EmbedBuilder()
        .setColor(0xffaa00)
        .setTitle("🚀 HORNET'S LAST MISSILE!")
        .setDescription(`<@${hornetId}> is going down — but not alone!\n\nChoose a target to fire your missile at!\n\n${targetList}\n\n⏰ You have **30 seconds** to choose!`)
        .setFooter({ text: ART_CREDIT })
    ],
    components: [new ActionRowBuilder().addComponents(select)],
  });

  // Return a promise that resolves when missile fires or times out
  return new Promise(resolve => {
    game.pendingHornet.resolve = resolve;
    setTimeout(async () => {
      if (!game.pendingHornet) { resolve(); return; }
      // Time's up — pick random target
      const randomTarget = targets[Math.floor(Math.random() * targets.length)];
      game.pendingHornet = null;
      await fireHornetMissile(channel, game, hornetId, randomTarget, true);
      resolve();
    }, 30_000);
  });
}

async function fireHornetMissile(channel, game, hornetId, targetId, timedOut = false) {
  game.alivePlayers = game.alivePlayers.filter(id => id !== targetId);
  await assignDeadRole(channel.guild, targetId);
  recordDeath(game, targetId);
  log(game, `Morning ${game.nightCount}`, `${playerTag(game, hornetId)} -> Shoot Missile -> ${playerTag(game, targetId)} -> ${timedOut ? "Auto-fired (timeout)" : "Missile fired!"}`);

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xffaa00)
        .setTitle("💥 Missile Fired!")
        .setDescription(
          timedOut
            ? `⏰ Time's up! <@${hornetId}>'s missile auto-fired and hit <@${targetId}>!`
            : `🚀 <@${hornetId}>'s last missile has struck <@${targetId}>!`
        )
        .setFooter({ text: ART_CREDIT })
    ],
  });
}

// ─── Pre-Night Phase ──────────────────────────────────────────────────────────
async function startPreNight(channel, game) {
  if (game.phase === "ended") return;
  game.phase = "prenight";
  game.endPhaseVotes = new Set();
  game.dandelionTarget = null;

  const prenightBtn = new ButtonBuilder()
    .setCustomId("prenight_ability")
    .setLabel("🌙 Use Pre-Night Ability")
    .setStyle(ButtonStyle.Primary);
  const endPhaseBtn = buildEndPhaseButton(game);
  const row = new ActionRowBuilder().addComponents(prenightBtn, endPhaseBtn);

  const embed = new EmbedBuilder()
    .setColor(0x4b0082)
    .setTitle(`🌙 Pre-Night ${game.nightCount}`)
    .setDescription(`The night is about to begin... Some forces stir in the shadows.\n\n⏰ Pre-Night ends ${ts(20_000)}`)
    .setFooter({ text: ART_CREDIT });

  const prenightFile = attachment(IMG.prenight);
  if (prenightFile) embed.setThumbnail(`attachment://Prenight.webp`);

  const sendOptions = { embeds: [embed], components: [row] };
  if (prenightFile) sendOptions.files = [prenightFile];

  game.prenightMessage = await channel.send(sendOptions);

  setTimeout(() => {
    if (game.phase === "prenight") startNight(channel, game);
  }, 20_000);
}

// ─── Night Phase ──────────────────────────────────────────────────────────────
async function startNight(channel, game) {
  if (game.phase === "ended") return;
  try {
    game.phase = "night";
    game.nightActions = {
      sheriffUsed:     {},
      doctorUsed:      {},
      doctorTargets:   [],
      soldierAntUsed:  game.nightActions?.soldierAntUsed  || {},  // persist across nights
      soldierAntShots: [],
      scorpionUsed:    game.nightActions?.scorpionUsed    || {},  // per-player, persist across nights
      scorpionActive:  {}, // per-player, resets each night
    };
    game.mafiaVotes = {};
    game.mafiaVoteMessage = null;
    game.endPhaseVotes = new Set();
    game.mafiaVoteCounts = {};
    // dandelionTarget is set during prenight and cleared here after use

    // Separate night announcement message
    await sendWithImage(channel, {
      color: 0x1a1a2e,
      title: `🌙 Night ${game.nightCount}`,
      description: "The town falls asleep... Danger lurks in the shadows.",
    }, IMG.night);

    // Ability message with buttons
    const abilityFile = attachment(IMG.nightAbility);
    const abilityEmbed = new EmbedBuilder()
      .setColor(0x2d2d54)
      .setTitle("🔮 Use your abilities!")
      .setDescription(`Use your abilities before time runs out!\n\n⏰ Night ends ${ts(40_000)}`)
      .setFooter({ text: ART_CREDIT });
    if (abilityFile) abilityEmbed.setThumbnail(`attachment://Night_Ability.webp`);

    const abilityBtn  = new ButtonBuilder().setCustomId("use_ability").setLabel("🔮 Use Ability").setStyle(ButtonStyle.Primary);
    const evilBtn     = new ButtonBuilder().setCustomId("im_evil").setLabel("🔪 I'm Evil!").setStyle(ButtonStyle.Danger);
    const endPhaseBtn = buildEndPhaseButton(game);

    game.nightMessage = await channel.send({
      embeds: [abilityEmbed],
      files: abilityFile ? [abilityFile] : [],
      components: [new ActionRowBuilder().addComponents(abilityBtn, evilBtn, endPhaseBtn)],
    });

    setTimeout(() => { if (game.phase === "night") resolveMorning(channel, game); }, 40_000);
  } catch (err) {
    console.error("startNight error:", err);
    try {
      const abilityBtn  = new ButtonBuilder().setCustomId("use_ability").setLabel("🔮 Use Ability").setStyle(ButtonStyle.Primary);
      const evilBtn     = new ButtonBuilder().setCustomId("im_evil").setLabel("🔪 I'm Evil!").setStyle(ButtonStyle.Danger);
      const endPhaseBtn = buildEndPhaseButton(game);
      game.nightMessage = await channel.send({
        embeds: [new EmbedBuilder().setColor(0x1a1a2e).setTitle(`🌙 Night ${game.nightCount}`).setDescription(`Use your abilities!\n\n⏰ Night ends ${ts(40_000)}`)],
        components: [new ActionRowBuilder().addComponents(abilityBtn, evilBtn, endPhaseBtn)],
      });
      setTimeout(() => { if (game.phase === "night") resolveMorning(channel, game); }, 40_000);
    } catch (e2) { console.error("startNight recovery failed:", e2); }
  }
}

// ─── Morning Phase ────────────────────────────────────────────────────────────
async function resolveMorning(channel, game) {
  if (game.phase !== "night") return;
  try {
    game.phase = "morning";

    // Resolve kill votes — filter skips/nulls
    const voteCounts = {};
    Object.values(game.mafiaVotes).filter(t => t && t !== "skip").forEach(t => {
      voteCounts[t] = (voteCounts[t] || 0) + 1;
    });

    let killed = null;
    if (Object.keys(voteCounts).length > 0) {
      const max = Math.max(...Object.values(voteCounts));
      const top = Object.keys(voteCounts).filter(id => voteCounts[id] === max);
      killed = top[Math.floor(Math.random() * top.length)];
    }

    // ── Scorpion Poison ────────────────────────────────────────────────────
    // Each Scorpion who activated tonight is checked independently — one
    // Scorpion activating no longer blocks a second Scorpion from using theirs.
    let poisoned = null;
    let scorpionSelfId = null; // tracked for Elo contribution credit below
    const activeScorpions = Object.keys(game.roles).filter(id =>
      game.roles[id] === "scorpion" && game.alivePlayers.includes(id) && game.nightActions.scorpionActive?.[id]
    );

    for (const scorpionId of activeScorpions) {
      const evilTargetedScorpion = Object.entries(game.mafiaVotes)
        .filter(([, target]) => target === scorpionId)
        .map(([id]) => id);
      const soldierTargetedScorpion = game.nightActions["soldierAnt_target"] === scorpionId;

      const wasTargeted = evilTargetedScorpion.length > 0 || soldierTargetedScorpion;

      if (wasTargeted) {
        // Scorpion dies — add to killed (overrides any other kill this night)
        killed = scorpionId;
        scorpionSelfId = scorpionId;

        // Pick one random evil killer, or the soldier ant shooter
        if (evilTargetedScorpion.length > 0) {
          poisoned = evilTargetedScorpion[Math.floor(Math.random() * evilTargetedScorpion.length)];
        } else if (soldierTargetedScorpion) {
          poisoned = game.nightActions["soldierAnt_shooter"];
          // Soldier ant also spent their ability
        }
        break; // only one poison event resolves per night — extremely rare for two Scorpions to both be targeted the same night
      }
      // If nobody targeted this scorpion — they live, ability is still consumed
    }

    // Healing save — any doctor target that matches killed gets saved
    // doctorTargets is now an array of all heal targets from all doctors
    const doctorTargets   = game.nightActions.doctorTargets || [];
    const leechHealTarget = game.nightActions["leech"];
    let saved = false;
    if (killed && (doctorTargets.includes(killed) || leechHealTarget === killed)) {
      saved = true;
      killed = null;
    }

    if (killed) {
      game.alivePlayers = game.alivePlayers.filter(id => id !== killed);
      await assignDeadRole(channel.guild, killed);
      recordDeath(game, killed);
      log(game, `Morning ${game.nightCount}`, `${playerTag(game, killed)} was killed by the Evil mob!`);
    }

    if (saved) {
      const savedTarget = doctorTargets.find(t => t === (killed || (saved ? game.nightActions.doctorTargets?.[0] : null))) || doctorTargets[0];
      log(game, `Morning ${game.nightCount}`, `${playerTag(game, savedTarget || "?")} was targeted but SAVED by healing!`);
    }

    if (!killed && !saved) {
      log(game, `Morning ${game.nightCount}`, "Peaceful night — no kills.");
    }

    // Morning announcement
    await sendWithImage(channel, {
      color: 0xffd700,
      title: "☀️ Morning has arrived!",
      description: "The town wakes up...",
    }, IMG.morning);

    if (killed || saved) {
      const deadTarget = killed || doctorTargets[0];
      await sendWithImage(channel, {
        color: 0x8b0000,
        title: "💀 Someone was killed!",
        description: `<@${deadTarget}> was killed during the night!`,
      }, IMG.someoneDead);
    } else {
      await channel.send({ embeds: [new EmbedBuilder().setColor(0xffd700).setDescription("It was a peaceful night. No one died!")] });
    }

    if (saved) {
      await sendWithImage(channel, {
        color: 0x00ff7f,
        title: "# Or Not?",
        description: `✨ <@${doctorTargets[0] || leechHealTarget}> was miraculously saved by someone's healing!`,
      }, IMG.healSave);
    }

    // Scorpion poison
    if (poisoned && game.alivePlayers.includes(poisoned)) {
      const poisonSaved = doctorTargets.includes(poisoned) || leechHealTarget === poisoned;
      if (poisonSaved) {
        log(game, `Morning ${game.nightCount}`, `${playerTag(game, poisoned)} was poisoned by Scorpion but SAVED by healing!`);
        await channel.send({ embeds: [new EmbedBuilder().setColor(0x00ff44).setDescription(`☠️ Someone was poisoned by the Scorpion... but was saved by healing!`)] });
      } else {
        game.alivePlayers = game.alivePlayers.filter(id => id !== poisoned);
        await assignDeadRole(channel.guild, poisoned);
        recordDeath(game, poisoned);
        // Elo: Scorpion (Good) helped take down an Evil with their poison
        if (isEvil(game.roles[poisoned]) && scorpionSelfId) addContribution(game, scorpionSelfId);
        log(game, `Morning ${game.nightCount}`, `${playerTag(game, poisoned)} died from Scorpion poison!`);
        await channel.send({ embeds: [new EmbedBuilder().setColor(0x228b22).setTitle("☠️ Poison!").setDescription(`<@${poisoned}> was poisoned by the Scorpion and died!`)] });
      }
    }

    // Hornet missile
    if (killed && game.roles[killed] === "hornet") {
      if (game.dandelionTarget === killed) {
        log(game, `Morning ${game.nightCount}`, `${playerTag(game, killed)} (Hornet) was Dandelioned — missile fizzled!`);
        await channel.send({ embeds: [new EmbedBuilder().setColor(0xffaa00).setTitle("🌼 Dandelioned!").setDescription(`<@${killed}>'s stinger has been clipped by the Dandelion — no missile tonight.`)] });
      } else {
        await triggerHornetMissile(channel, game, killed);
      }
    }

    // Soldier Ant shots — loop through each separately
    const soldierAntShots = game.nightActions.soldierAntShots || [];
    for (const { shooter, target: soldierTarget } of soldierAntShots) {
      const targetRole = game.roles[soldierTarget];
      const targetIsGood = isGood(targetRole);
      const targetIsEvil = isEvil(targetRole);
      const targetAlreadyDead = !game.alivePlayers.includes(soldierTarget);

      if (targetAlreadyDead) {
        log(game, `Morning ${game.nightCount}`, `${playerTag(game, shooter)} -> Shoot -> ${playerTag(game, soldierTarget)} -> Target already dead! Soldier Ant traumatised but lives.`);
        await channel.send({ embeds: [new EmbedBuilder().setColor(0x8b6914).setDescription("🐜 A Soldier Ant tried to shoot someone... but they were already dead! The Soldier Ant lives on, however traumatised...")] });
      } else {
        const savedBySoldierHeal = doctorTargets.includes(soldierTarget) || leechHealTarget === soldierTarget;
        if (savedBySoldierHeal) {
          log(game, `Morning ${game.nightCount}`, `${playerTag(game, shooter)} -> Shoot -> ${playerTag(game, soldierTarget)} -> SAVED by healing!`);
          await sendWithImage(channel, { color: 0x8b0000, title: "💀 Someone was shot!", description: `Someone was shot by the Soldier Ant!` }, IMG.someoneDead);
          await sendWithImage(channel, { color: 0x00ff7f, title: "# Or Not?", description: `✨ The target was miraculously saved by someone's healing! The Soldier Ant survives.` }, IMG.healSave);
        } else {
          game.alivePlayers = game.alivePlayers.filter(id => id !== soldierTarget);
          await assignDeadRole(channel.guild, soldierTarget);
          recordDeath(game, soldierTarget);
          // Elo: Soldier Ant (Good) helped take down an Evil with their missile
          if (targetIsEvil) addContribution(game, shooter);
          log(game, `Morning ${game.nightCount}`, `${playerTag(game, shooter)} -> Shoot -> ${playerTag(game, soldierTarget)} -> ${playerTag(game, soldierTarget)} DIED!`);
          await sendWithImage(channel, { color: 0x8b0000, title: "💀 Someone was shot!", description: `<@${soldierTarget}> was shot by the Soldier Ant!` }, IMG.someoneDead);
          if (!targetIsGood) {
            log(game, `Morning ${game.nightCount}`, `${playerTag(game, soldierTarget)} wasn't Good — Soldier Ant lives on.`);
            await channel.send({ embeds: [new EmbedBuilder().setColor(0x8b6914).setDescription(`🐜 <@${soldierTarget}> wasn't Good... The Soldier Ant lives on.`)] });
          } else {
            game.alivePlayers = game.alivePlayers.filter(id => id !== shooter);
            await assignDeadRole(channel.guild, shooter);
            recordDeath(game, shooter);
            log(game, `Morning ${game.nightCount}`, `${playerTag(game, soldierTarget)} was Good — ${playerTag(game, shooter)} (Soldier Ant) DIES of guilt!`);
            await channel.send({ embeds: [new EmbedBuilder().setColor(0x8b6914).setDescription(`💔 The Soldier Ant killed a Good player... overwhelmed with guilt, they collapse and die.`)] });
          }
          if (game.roles[soldierTarget] === "hornet" && game.dandelionTarget !== soldierTarget) {
            await triggerHornetMissile(channel, game, soldierTarget);
          }
        }
      }

      // Check win after each shot
      const winCheck = checkWinCondition(game);
      if (winCheck) { await endGame(channel, game, winCheck); return; }
    }

    // Dandelion effect expires after morning — remember it for the "no repeat
    // target" rule (null on a skip, correctly clearing the streak so the next
    // pick isn't restricted by a target from two nights ago)
    game.lastDandelionTarget = game.dandelionTarget;
    game.dandelionTarget = null;

    const win = checkWinCondition(game);
    if (win) { await endGame(channel, game, win); return; }

    // Discussion phase
    game.endPhaseVotes = new Set();
    const discFile = attachment(IMG.discuss);
    const discEmbed = new EmbedBuilder()
      .setColor(0x4a90d9)
      .setTitle("💬 Discussion Phase")
      .setDescription(`Discuss who the Evil might be!\n\n${buildPlayerList(game)}\n\n⏰ Discussion ends ${ts(40_000)}`)
      .setFooter({ text: ART_CREDIT });
    if (discFile) discEmbed.setThumbnail("attachment://Discuss.webp");

    const endPhaseBtn = buildEndPhaseButton(game);
    game.discussionMessage = await channel.send({
      embeds: [discEmbed],
      files: discFile ? [discFile] : [],
      components: [new ActionRowBuilder().addComponents(endPhaseBtn)],
    });

    setTimeout(() => { if (game.phase === "morning") startVoting(channel, game); }, 40_000);
  } catch (err) {
    console.error("resolveMorning error:", err);
    try {
      game.phase = "morning";
      await channel.send({ embeds: [new EmbedBuilder().setColor(0xffd700).setTitle("☀️ Morning has arrived!").setDescription("It was a peaceful night. No one died!")] });
      setTimeout(() => { if (game.phase === "morning") startVoting(channel, game); }, 40_000);
    } catch (e2) { console.error("resolveMorning recovery failed:", e2); }
  }
}

// ─── Voting Phase ─────────────────────────────────────────────────────────────
const VOTE_DURATION = 30_000;

async function startVoting(channel, game) {
  if (game.phase === "ended") return;
  game.phase = "voting";
  game.votes = {};
  game.voteCounts = {};
  game.skipVotes = 0;
  game.alivePlayers.forEach(id => (game.voteCounts[id] = 0));
  game.voteEndTime = Date.now() + VOTE_DURATION;
  game.endPhaseVotes = new Set();

  const queenId = game.alivePlayers.find(id => game.roles[id] === "queenAnt");

  function buildVoteList(counts, skipCount) {
    return [
      `**0.** Skip — ${skipCount || 0} votes`,
      ...game.alivePlayers.map((id, idx) => {
        const isQueen = id === queenId;
        const label = isQueen ? `<@${id}> 👑 Queen` : `<@${id}>`;
        return `**${idx + 1}.** ${label} — ${counts[id] || 0} votes`;
      })
    ].join("\n");
  }

  const playerList = buildVoteList(Object.fromEntries(game.alivePlayers.map(id => [id, 0])), 0);
  game._buildVoteList = buildVoteList; // store for updates

  // Fix: send image as part of the same message, not separately
  const voteFile = attachment(IMG.vote);
  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setTitle("🗳️ Voting Phase")
    .setDescription(`Vote to eliminate a player!\n\n${playerList}\n\n⏰ Voting ends <t:${Math.floor(game.voteEndTime / 1000)}:R>`)
    .setFooter({ text: ART_CREDIT });
  if (voteFile) embed.setThumbnail("attachment://Vote.webp");

  const voteBtn     = new ButtonBuilder().setCustomId("cast_vote").setLabel("🗳️ Vote").setStyle(ButtonStyle.Primary);
  const endPhaseBtn = buildEndPhaseButton(game);
  game.votingMessage = await channel.send({
    embeds: [embed],
    files: voteFile ? [voteFile] : [],
    components: [new ActionRowBuilder().addComponents(voteBtn, endPhaseBtn)],
  });

  setTimeout(() => { if (game.phase === "voting") resolveVoting(channel, game); }, VOTE_DURATION);
}

async function updateVotingMessage(game) {
  if (!game.votingMessage) return;
  const queenId = game.alivePlayers.find(id => game.roles[id] === "queenAnt");
  const playerList = [
    `**0.** Skip — ${game.skipVotes || 0} votes`,
    ...game.alivePlayers.map((id, idx) => {
      const isQueen = id === queenId;
      const label   = isQueen ? `<@${id}> 👑 Queen` : `<@${id}>`;
      const queenVotedFor = game.queenVote && game.queenVote === id;
      const voteStr = queenVotedFor
        ? `${game.voteCounts[id] || 0} votes *(QUEEN'S PICK)*`
        : `${game.voteCounts[id] || 0} votes`;
      return `**${idx + 1}.** ${label} — ${voteStr}`;
    })
  ].join("\n");

  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setTitle("🗳️ Voting Phase")
    .setDescription(`Vote to eliminate a player!\n\n${playerList}\n\n⏰ Voting ends <t:${Math.floor(game.voteEndTime / 1000)}:R>`)
    .setFooter({ text: ART_CREDIT });

  const voteBtn     = new ButtonBuilder().setCustomId("cast_vote").setLabel("🗳️ Vote").setStyle(ButtonStyle.Primary);
  const endPhaseBtn = buildEndPhaseButton(game);
  await game.votingMessage.edit({ embeds: [embed], components: [new ActionRowBuilder().addComponents(voteBtn, endPhaseBtn)] }).catch(() => {});
}

async function resolveVoting(channel, game) {
  if (game.phase !== "voting") return;
  game.phase = "resolving";

  if (game.votingMessage) {
    const disabledBtn = new ButtonBuilder().setCustomId("cast_vote_done").setLabel("🗳️ Vote (Closed)").setStyle(ButtonStyle.Secondary).setDisabled(true);
    await game.votingMessage.edit({ components: [new ActionRowBuilder().addComponents(disabledBtn)] }).catch(() => {});
  }

  const lastVotes      = { ...game.votes };
  const skipCount      = game.skipVotes || 0;
  const maxPlayerVotes = Math.max(...Object.values(game.voteCounts), 0);
  let eliminated       = null;

  // Elo: Good players who cast their final vote on an Evil get a tiny nudge,
  // regardless of whether that Evil actually ended up eliminated.
  for (const [voterId, target] of Object.entries(lastVotes)) {
    if (target && target !== "skip" && isGood(game.roles[voterId]) && isEvil(game.roles[target])) {
      addContribution(game, voterId);
    }
  }

  if (skipCount === 0 && maxPlayerVotes === 0) {
    await channel.send({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription("🤷 No votes were cast! No one is eliminated.")] });
  } else if (skipCount >= maxPlayerVotes) {
    await channel.send({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription(`⏭️ The town voted to skip! No one is eliminated. (Skip: ${skipCount} votes)`)] });
  } else {
    const [p1, p2] = game.alivePlayers;
    // A genuine 2-player standoff only calls for RPS when their weighted vote
    // counts are actually equal — if Queen Ant (3 votes) is one of the two,
    // their pick just wins outright instead of going to a coin-flip tiebreaker.
    const mutualAccusation   = game.alivePlayers.length === 2 && lastVotes[p1] === p2 && lastVotes[p2] === p1;
    const isTwoPlayerMutualVote = mutualAccusation && (game.voteCounts[p1] || 0) === (game.voteCounts[p2] || 0);

    if (isTwoPlayerMutualVote) {
      await endGame(channel, game, "tiebreaker");
      return;
    }

    const topTargets = Object.keys(game.voteCounts).filter(id => game.voteCounts[id] === maxPlayerVotes);
    eliminated = topTargets[Math.floor(Math.random() * topTargets.length)];
    game.alivePlayers = game.alivePlayers.filter(id => id !== eliminated);
    await assignDeadRole(channel.guild, eliminated);
    recordDeath(game, eliminated);

    // ── Square Victory! ──
    if (game.roles[eliminated] === "square") {
      game.squareWon = true;
      log(game, `Voting Phase ${game.nightCount}`, `${playerTag(game, eliminated)} was voted out -> SQUARE VICTORY!`);
      await channel.send({ embeds: [
        new EmbedBuilder()
          .setColor(0xffd700)
          .setTitle("🟨 Square Victory!")
          .setDescription(`The town has successfully voted out <@${eliminated}>... but that's exactly what they wanted! 🟨\n\n**The Square wins their personal victory!**\n\nThe game continues...`)
      ]});
    } else {
      log(game, `Voting Phase ${game.nightCount}`, `${playerTag(game, eliminated)} was voted out and eliminated!`);
      await sendWithImage(channel, {
        color: 0xff0000,
        title: "⚖️ Eliminated!",
        description: `The town has voted!\n\n💀 <@${eliminated}> has been eliminated!`,
      }, IMG.execution);
    }

    // Hornet missile on vote elimination
    if (game.roles[eliminated] === "hornet") {
      log(game, `Voting Phase ${game.nightCount}`, `${playerTag(game, eliminated)} (Hornet) was voted out -> fires missile!`);
      await triggerHornetMissile(channel, game, eliminated);
    }
  }

  const win = checkWinCondition(game, null);
  if (win && win !== "tiebreaker") { await endGame(channel, game, win); return; }
  if (win === "tiebreaker")        { await endGame(channel, game, "tiebreaker"); return; }

  await channel.send({ embeds: [new EmbedBuilder().setColor(0x2c2f33).setTitle("👥 Players Remaining").setDescription(buildPlayerList(game))] });

  game.nightCount++;
  if (!game.lastHealTargets) game.lastHealTargets = {};
  const doctorUsed = game.nightActions.doctorUsed || {};
  for (const [docId, healedId] of Object.entries(doctorUsed)) {
    game.lastHealTargets[docId] = healedId;
  }
  await startPreNight(channel, game);
}

// ─── Tiebreaker (RPS) ─────────────────────────────────────────────────────────
async function startTiebreaker(channel, game) {
  game.phase = "tiebreaker";
  game.rpsChoices = {};

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle("✂️ Rock Paper Scissors Tiebreaker!")
    .setDescription(`The game is tied with 2 players remaining!\n\nBoth players must choose before time runs out!\n\n⏰ Ends ${ts(60_000)}`);

  const rpsBtn = new ButtonBuilder().setCustomId("rps_pick").setLabel("✂️ Make Your Pick!").setStyle(ButtonStyle.Primary);
  await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(rpsBtn)] });

  setTimeout(async () => {
    if (game.phase !== "tiebreaker") return;
    const choices = ["rock", "paper", "scissors"];
    const beats   = { rock: "scissors", scissors: "paper", paper: "rock" };
    const mc      = choices[Math.floor(Math.random() * 3)];
    const vc      = choices[Math.floor(Math.random() * 3)];
    const winner  = mc === vc ? (Math.random() < 0.5 ? "evil_rps" : "good_rps") : beats[mc] === vc ? "evil_rps" : "good_rps";
    game.phase = "ended"; // flip before any awaited send, so a late manual pick can't also resolve the game
    games.delete(channel.id);
    await channel.send({ embeds: [new EmbedBuilder().setColor(0x9b59b6).setDescription("⏰ Time's up! Picking randomly...")] });
    await announceWinner(channel, game, winner);
  }, 60_000);
}

const { recordGameElo } = require("./stats");

// ─── End Game ─────────────────────────────────────────────────────────────────
async function announceWinner(channel, game, winner) {
  // Snapshot the debug log before the game object is (or was) deleted from
  // `games`, so /mafiadebug still works after the game has ended.
  lastDebugLogs.set(channel.id, { debugLog: game.debugLog || [], debugNames: game.debugNames || {}, endedAt: Date.now() });

  await removeAllDeadRoles(channel.guild, game.allPlayers);

  // Determine winners
  const isGoodWin = winner === "good" || winner === "good_rps";
  const isEvilWin = winner === "evil" || winner === "evil_rps";
  const isTie     = winner === "tie";
  const guildId   = channel.guild.id;
  const allP      = game.allPlayers?.length ? game.allPlayers : game.players;

  // Check leech victory — host survived to end of game
  if (game.leechHosts) {
    for (const [leechId, hostId] of Object.entries(game.leechHosts)) {
      if (game.alivePlayers.includes(hostId)) {
        game.leechWon = true;
        game.leechWinner = leechId;
        game.leechHost   = hostId;
      }
    }
  }

  // Leech win counts as a win for stats
  const totalNights = game.nightCount;
  const evilCount   = allP.filter(id => isEvil(game.roles[id])).length;
  const players = allP.map(id => {
    const role = game.roles[id];
    const info = ROLE_INFO[role];
    let won = false;
    if (isGoodWin && isGood(role))                   won = true;
    if (isEvilWin && isEvil(role))                   won = true;
    if (isTie && (isGood(role) || isEvil(role)))     won = true; // everyone wins on tie
    if (role === "square" && game.squareWon)          won = true;
    if (role === "leech"  && game.leechWon && game.leechWinner === id) won = true;
    return {
      userId: id,
      guildId,
      won,
      team: info?.team || "Good",
      roleModifier: info?.eloModifier ?? 1.0,
      deathNight: game.deathNight?.[id] ?? null,
      contribution: game.contributions?.[id] || 0,
      totalNights,
      evilCount,
      totalPlayers: allP.length,
      // Square's Elo comes out of a separate steal from the winning team
      // rather than sharing the normal pot — see stats.js.
      independentWin: role === "square" && game.squareWon,
    };
  });

  console.log(`📊 Recording stats: winner=${winner}, players=${allP.length}, goodWin=${isGoodWin}, evilWin=${isEvilWin}`);

  // Only record stats for real games (4+ players)
  let eloResults = [];
  if (allP.length >= 4) {
    try {
      eloResults = await recordGameElo(players);
      console.log(`✅ Elo recorded for ${eloResults.length} players.`);
    } catch (err) {
      console.error("❌ Failed to record Elo:", err);
    }
  }

  let winMsg = "", color = 0xffffff;
  if      (winner === "good")      { winMsg = "🎉 **The Good** wins! The Evils have been defeated!";          color = 0x00ff7f; }
  else if (winner === "evil")      { winMsg = "😈 **The Evils** win! The town has fallen!";                    color = 0xff0000; }
  else if (winner === "evil_rps")  { winMsg = "😈 **The Evils** win the Rock Paper Scissors tiebreaker!";     color = 0xff0000; }
  else if (winner === "good_rps")  { winMsg = "🎉 **The Good** wins the Rock Paper Scissors tiebreaker!";     color = 0x00ff7f; }
  else if (winner === "tie")       { winMsg = "🤝 **It's a Tie!** Everyone wins... and loses.";               color = 0xaaaaaa; }

  log(game, "Game Over", `=== RESULT: ${winner.toUpperCase()} ===`);

  const roleReveal = game.allPlayers.map(id => {
    const info = ROLE_INFO[game.roles[id]];
    return `<@${id}> — ${info.emoji} ${info.name} (${info.team})`;
  }).join("\n");

  await channel.send({ embeds: [new EmbedBuilder().setColor(color).setTitle("🏁 Game Over!").setDescription(winMsg)] });

  if (game.squareWon) {
    const squarePlayer = game.allPlayers.find(id => game.roles[id] === "square");
    const sqFile = attachment(IMG.squareVictory);
    const sqEmbed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle("🟨 Also... Square Victory!")
      .setDescription(`<@${squarePlayer}> achieved their goal and was voted out by the town!\n**The Square wins their independent victory!**`)
      .setFooter({ text: ART_CREDIT });
    if (sqFile) sqEmbed.setThumbnail("attachment://Square_Victory.webp");
    await channel.send({ embeds: [sqEmbed], files: sqFile ? [sqFile] : [] });
  }

  if (game.leechWon) {
    const leechFile = attachment(IMG.leechVictory);
    const leechEmbed = new EmbedBuilder()
      .setColor(0x8b4513)
      .setTitle("🪱 Leech Victory!")
      .setDescription(`<@${game.leechWinner}>'s host <@${game.leechHost}> survived to the end!\n**The Leech wins their independent victory!**`)
      .setFooter({ text: ART_CREDIT });
    if (leechFile) leechEmbed.setThumbnail(`attachment://Leech_Victory.webp`);
    await channel.send({ embeds: [leechEmbed], files: leechFile ? [leechFile] : [] });
  }

  await channel.send({ embeds: [new EmbedBuilder().setColor(0xf0e68c).setTitle("📋 Role Reveal").setDescription(roleReveal)] });

  if (eloResults.length > 0) {
    const eloLines = eloResults.map(r => {
      const info = ROLE_INFO[game.roles[r.userId]];
      const sign = r.delta >= 0 ? "+" : "";
      return `<@${r.userId}> (${info?.name || "?"}) ${r.before.toFixed(1)} -> ${r.after.toFixed(1)} (${sign}${r.delta.toFixed(1)})`;
    }).join("\n");

    await channel.send({ embeds: [
      new EmbedBuilder()
        .setColor(0x4a90d9)
        .setTitle("📈 Elo Changes")
        .setDescription(eloLines)
        .setFooter({ text: "Elo starts at 1000 — higher Elo means smaller gains and bigger losses." })
    ]});
  }
}

async function endGame(channel, game, winner) {
  if (game.phase === "ended") return;
  if (winner === "tiebreaker") { await startTiebreaker(channel, game); return; }
  game.phase = "ended";
  games.delete(channel.id);
  await announceWinner(channel, game, winner);
}// ─── Role card helper ─────────────────────────────────────────────────────────
async function sendRoleCard(interaction, roleKey) {
  const info = ROLE_INFO[roleKey];
  if (!info) return interaction.reply({ content: "❌ Unknown role!", ephemeral: true });

  const file     = attachment(info.image);
  const filename = file ? path.basename(info.image) : null;

  const embed = new EmbedBuilder()
    .setColor(info.team === "Evil" ? 0x8b0000 : 0x2ecc71)
    .setTitle(`${info.emoji} ${info.name.toUpperCase()}!`)
    .addFields(
      { name: "Team",    value: info.team,    inline: true },
      { name: "Ability", value: info.ability }
    )
    .setFooter({ text: ART_CREDIT });

  if (file && filename) embed.setThumbnail(`attachment://${filename}`);

  return interaction.reply({
    embeds: [embed],
    files: file ? [file] : [],
    ephemeral: true,
  });
}

// ─── Interaction Handler ──────────────────────────────────────────────────────
async function handleMafiaInteraction(interaction) {
  const channelId = interaction.channelId;
  const game      = getGame(channelId);
  const userId    = interaction.user.id;

  try {

  // ── Hornet Missile Target ──
  if (interaction.customId === "hornet_missile") {
    if (!game || !game.pendingHornet)
      return interaction.reply({ content: "❌ No missile pending!", ephemeral: true });
    if (interaction.user.id !== game.pendingHornet.hornetId)
      return interaction.reply({ content: "❌ This isn't your missile!", ephemeral: true });

    const target  = interaction.values[0];
    const resolve = game.pendingHornet.resolve;
    game.pendingHornet = null;

    await interaction.update({ components: [] });
    await fireHornetMissile(interaction.channel, game, userId, target, false);

    // Check win after missile
    const win = checkWinCondition(game);
    if (win) { await endGame(interaction.channel, game, win); }

    if (resolve) resolve();
    return;
  }

  // ── Leech Heal ──
  if (interaction.customId === "leech_heal") {
    if (!game || game.phase !== "night")
      return interaction.reply({ content: "❌ It's not night time!", ephemeral: true });
    if (game.roles[userId] !== "leech")
      return interaction.reply({ content: "❌ Only the Leech can use this!", ephemeral: true });

    const hostId   = game.leechHosts?.[userId];
    const lastHeal = game.leechLastHeal?.[userId] || 0;

    if (!hostId)
      return interaction.reply({ content: "❌ You have no host!", ephemeral: true });
    if (!game.alivePlayers.includes(hostId))
      return interaction.reply({ content: "❌ Your host is already dead!", ephemeral: true });
    if ((game.nightCount - lastHeal) < 2)
      return interaction.reply({ content: "❌ You can only heal once every 2 nights!", ephemeral: true });
    if (game.nightActions[`leech_${userId}`])
      return interaction.reply({ content: "❌ You've already used your heal tonight!", ephemeral: true });

    game.nightActions[`leech_${userId}`] = hostId;
    if (!game.nightActions.doctorTargets) game.nightActions.doctorTargets = [];
    if (!game.nightActions.doctorTargets.includes(hostId)) game.nightActions.doctorTargets.push(hostId);
    game.leechLastHeal[userId] = game.nightCount;
    log(game, `Night ${game.nightCount}`, `${playerTag(game, userId)} -> Heal Host -> ${playerTag(game, hostId)} -> Chosen to heal host ${playerTag(game, hostId)} tonight!`);
    return interaction.reply({ content: `✅ You will heal your host <@${hostId}> tonight!`, ephemeral: true });
  }

  // ── End Phase ──
  if (interaction.customId === "end_phase") {
    if (!game || game.phase === "joining" || game.phase === "starting" || game.phase === "ended")
      return interaction.reply({ content: "❌ You can't end the phase right now!", ephemeral: true });
    if (!game.alivePlayers.includes(userId))
      return interaction.reply({ content: "❌ Only alive players can vote to end the phase!", ephemeral: true });

    if (!game.endPhaseVotes) game.endPhaseVotes = new Set();
    for (const id of [...game.endPhaseVotes]) {
      if (!game.alivePlayers.includes(id)) game.endPhaseVotes.delete(id);
    }

    if (game.endPhaseVotes.has(userId)) game.endPhaseVotes.delete(userId);
    else game.endPhaseVotes.add(userId);

    const count = game.endPhaseVotes.size;
    const total = game.alivePlayers.length;

    const phaseMsg = game.phase === "prenight"  ? game.prenightMessage
                   : game.phase === "night"    ? game.nightMessage
                   : game.phase === "morning"  ? game.discussionMessage
                   : game.phase === "voting"   ? game.votingMessage
                   : null;
    if (phaseMsg) await updateEndPhaseButton(phaseMsg, game);

    await interaction.reply({
      content: `${game.endPhaseVotes.has(userId) ? "✅ You voted to end the phase early!" : "↩️ Vote removed."} (${count}/${total})`,
      ephemeral: true,
    });

    if (count >= total) {
      game.endPhaseVotes = new Set();
      const ch = interaction.channel;
      if (game.phase === "prenight") {
        await ch.send({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription("⏩ Everyone agreed to end Pre-Night early!")] });
        startNight(ch, game);
      } else if (game.phase === "night") {
        await ch.send({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription("⏩ Everyone agreed to end the night early!")] });
        resolveMorning(ch, game);
      } else if (game.phase === "morning") {
        await ch.send({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription("⏩ Everyone agreed to skip discussion!")] });
        startVoting(ch, game);
      } else if (game.phase === "voting") {
        await ch.send({ embeds: [new EmbedBuilder().setColor(0x888888).setDescription("⏩ Everyone agreed to end voting early!")] });
        resolveVoting(ch, game);
      }
    }
    return;
  }

  // ── Pre-Night Ability (generic — routes to correct role) ──
  if (interaction.customId === "prenight_ability") {
    try {
      if (!game) return interaction.reply({ content: "❌ No active game found!", ephemeral: true });
      if (game.phase !== "prenight") return interaction.reply({ content: "❌ Pre-Night is not active!", ephemeral: true });
      if (!game.alivePlayers.includes(userId)) return interaction.reply({ content: "❌ You are not in this game!", ephemeral: true });

      const role = game.roles[userId];
      if (!role) return interaction.reply({ content: "❌ You have no role assigned!", ephemeral: true });

      // ── Dandelion ──
      if (role === "dandelion") {
        const targets = game.alivePlayers.filter(id => id !== userId);
        if (targets.length === 0)
          return interaction.reply({ content: "⏭️ No targets available — skipping.", ephemeral: true });

        const names = await getNames(interaction.guild, targets);
        const options = [
          new StringSelectMenuOptionBuilder().setLabel("0. Skip (do nothing)").setValue("skip"),
          ...targets.map((id, idx) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(`${idx + 1}. ${names[id]}${id === game.lastDandelionTarget ? " (⚠️ Same as last night!)" : ""}`)
              .setValue(id)
          ),
        ];

        let desc = "🌼 Choose a player to **Dandelion** tonight!\nTheir ability will be negated for this night.";
        if (game.lastDandelionTarget)
          desc += `\n\n⚠️ You cannot target <@${game.lastDandelionTarget}> again!`;

        const select = new StringSelectMenuBuilder()
          .setCustomId("dandelion_target")
          .setPlaceholder("Select a target...")
          .addOptions(options);

        return interaction.reply({
          content: desc,
          components: [new ActionRowBuilder().addComponents(select)],
          ephemeral: true,
        });
      }

      // ── Add future pre-night roles here ──
      // if (role === "someRole") { ... }

      // No pre-night ability
      return interaction.reply({ content: "❌ You don't have a Pre-Night ability!", ephemeral: true });
    } catch (err) {
      console.error("prenight_ability error:", err);
      if (!interaction.replied && !interaction.deferred)
        await interaction.reply({ content: "❌ Something went wrong in Pre-Night!", ephemeral: true }).catch(() => {});
    }
    return;
  }

  // ── Dandelion Target Selected ──
  if (interaction.customId === "dandelion_target") {
    if (!game || game.phase !== "prenight")
      return interaction.reply({ content: "❌ Pre-Night is not active!", ephemeral: true });
    if (game.roles[userId] !== "dandelion")
      return interaction.reply({ content: "❌ Only the Dandelion can do this!", ephemeral: true });

    const target = interaction.values[0];

    if (target === "skip") {
      game.dandelionTarget = null;
      return interaction.reply({ content: "⏭️ You chose to skip Dandelioning tonight.", ephemeral: true });
    }

    if (target === game.lastDandelionTarget)
      return interaction.reply({ content: "❌ You cannot target the same player two nights in a row!", ephemeral: true });

    game.dandelionTarget = target;
    log(game, `Pre-Night ${game.nightCount}`, `${playerTag(game, userId)} -> Dandelion -> ${playerTag(game, target)} -> You have chosen to Dandelion ${playerTag(game, target)}!`);
    return interaction.reply({ content: `✅ You will Dandelion <@${target}> tonight! Their ability will be negated.`, ephemeral: true });
  }

  // ── Join Game ──
  if (interaction.customId === "join_mafia") {
    console.log(`join_mafia pressed by ${userId} in channel ${channelId}, game exists: ${!!game}, phase: ${game?.phase}`);
    if (!game || game.phase !== "joining")
      return interaction.reply({ content: "❌ No game is currently accepting players!", ephemeral: true });
    if (game.players.includes(userId))
      return interaction.reply({ content: "❌ You've already joined!", ephemeral: true });
    game.players.push(userId);
    return interaction.reply({ content: `✅ <@${userId}> joined! (${game.players.length} players so far)` });
  }

  // ── Check Role ──
  if (interaction.customId === "check_role") {
    if (!game) {
      console.error(`check_role: no game found for channel ${channelId}`);
      return interaction.reply({ content: "❌ No active game found!", ephemeral: true });
    }
    const role = game.roles[userId];
    if (!role) return interaction.reply({ content: "❌ You are not in this game!", ephemeral: true });
    return sendRoleCard(interaction, role);
  }

  // ── Use Ability ──
  if (interaction.customId === "use_ability") {
    if (!game || game.phase !== "night")
      return interaction.reply({ content: "❌ It's not night time!", ephemeral: true });
    if (!game.alivePlayers.includes(userId))
      return interaction.reply({ content: "❌ You are not in this game or already eliminated!", ephemeral: true });

    const role = game.roles[userId];

    if (isEvil(role) && role !== "darkLadybug")
      return interaction.reply({ content: "❌ Your team uses the **I'm Evil!** button to kill!", ephemeral: true });
    if (role === "villager" || role === "square")
      return interaction.reply({ content: "❌ You don't have a night ability!", ephemeral: true });

    // Hornet has no night ability either
    if (role === "hornet")
      return interaction.reply({ content: "❌ Hornets don't have a night ability — your power activates when you die!", ephemeral: true });

    // Check if dandelioned (affects all ability roles except soldier ant skip still uses ability)
    if (game.dandelionTarget === userId && role !== "soldierAnt")
      return interaction.reply({ content: "🌼 You have been Dandelioned! Your ability has been negated for tonight.", ephemeral: true });

    // Scorpion — show info menu, don't activate immediately
    if (role === "scorpion") {
      if (game.nightActions.scorpionUsed?.[userId])
        return interaction.reply({ content: "❌ You've already used your poison — it's a single-use ability!", ephemeral: true });
      if (game.dandelionTarget === userId)
        return interaction.reply({ content: "🌼 You have been Dandelioned! Your ability has been negated for tonight.", ephemeral: true });

      const activateBtn = new ButtonBuilder()
        .setCustomId("scorpion_activate")
        .setLabel("🦂 Activate Poison!")
        .setStyle(ButtonStyle.Danger);

      return interaction.reply({
        content: `🦂 **Scorpion Poison** *(Single Use)*\n\nIf you activate your poison tonight and anyone tries to kill you, they will be poisoned and die. However, **you will also die** if targeted.\n\nIf nobody targets you, you survive and your ability is consumed.\n\nLadybug can save the poisoned player.\n\n⚠️ This is your **one and only** use!`,
        components: [new ActionRowBuilder().addComponents(activateBtn)],
        ephemeral: true,
      });
    }

    // Soldier Ant — per-player used tracking
    if (role === "soldierAnt") {
      if (!game.nightActions.soldierAntUsed) game.nightActions.soldierAntUsed = {};
      if (game.nightActions.soldierAntUsed[userId])
        return interaction.reply({ content: "❌ You've already used your missile — it's a single-use ability!", ephemeral: true });
      if (game.dandelionTarget === userId)
        return interaction.reply({ content: "🌼 You have been Dandelioned! Your ability has been negated for tonight.", ephemeral: true });

      const targets = game.alivePlayers.filter(id => id !== userId);
      const names   = await getNames(interaction.guild, targets);
      const options = [
        new StringSelectMenuOptionBuilder().setLabel("0. Skip (do nothing this night)").setValue("skip"),
        ...targets.map((id, idx) => {
          const isQueen = game.roles[id] === "queenAnt";
          return new StringSelectMenuOptionBuilder()
            .setLabel(`${idx + 1}. ${names[id]}${isQueen ? " 👑 QUEEN ANT" : ""}`)
            .setValue(id);
        }),
      ];
      const select = new StringSelectMenuBuilder()
        .setCustomId(`ability_target_soldierAnt_${userId}`) // per-player customId
        .setPlaceholder("Choose a target to shoot...")
        .addOptions(options);

      return interaction.reply({
        content: `🐜 **Fire your missile!** Choose a target to shoot tonight. This is a single-use ability!\n\n${buildPlayerList(game)}`,
        components: [new ActionRowBuilder().addComponents(select)],
        ephemeral: true,
      });
    }

    // Leech special handling
    if (role === "leech") {
      const hostId   = game.leechHosts?.[userId];
      const hostRole = hostId ? ROLE_INFO[game.roles[hostId]] : null;
      const lastHeal = game.leechLastHeal?.[userId] || 0;
      const canHeal  = (game.nightCount - lastHeal) >= 2;
      const hostAlive = hostId && game.alivePlayers.includes(hostId);

      const healBtn = new ButtonBuilder()
        .setCustomId("leech_heal")
        .setLabel("💉 Heal Host")
        .setStyle(ButtonStyle.Success)
        .setDisabled(!canHeal || !hostAlive || !!game.nightActions[`leech_${userId}`]);

      const hostInfo = hostId
        ? `👤 Your host: <@${hostId}> — **${hostRole?.name || "Unknown"}** ${hostRole?.emoji || ""}`
        : "❌ No host assigned!";
      const healInfo = !canHeal
        ? "\n⚠️ You can only heal once every 2 nights! Wait one more night."
        : game.nightActions[`leech_${userId}`]
        ? "\n✅ You've already used your heal tonight."
        : hostAlive ? "\n💉 You can heal your host tonight!" : "\n💀 Your host is dead.";

      return interaction.reply({
        content: `🪱 **Leech Ability**\n\n${hostInfo}${healInfo}`,
        components: [new ActionRowBuilder().addComponents(healBtn)],
        ephemeral: true,
      });
    }

    // Check dandelion
    if (game.dandelionTarget === userId) {
      log(game, `Night ${game.nightCount}`, `${playerTag(game, userId)} -> Use Ability -> BLOCKED (Dandelioned)`);
      return interaction.reply({ content: "🌼 You have been Dandelioned! Your ability has been negated for tonight.", ephemeral: true });
    }

    log(game, `Night ${game.nightCount}`, `${playerTag(game, userId)} -> Use Ability -> Menu opened`);

    // Doctor — per-player tracking
    if (role === "doctor") {
      if (!game.nightActions.doctorUsed) game.nightActions.doctorUsed = {};
      if (game.nightActions.doctorUsed[userId])
        return interaction.reply({ content: "❌ You've already used your heal tonight!", ephemeral: true });

      const targets = [...game.alivePlayers];
      const names = await getNames(interaction.guild, targets);
      const lastHeal = game.lastHealTargets?.[userId];
      let abilityDesc = "🐞 Choose a player to **heal** tonight:";
      if (lastHeal) abilityDesc += `\n⚠️ You cannot heal <@${lastHeal}> again!`;

      const options = [
        new StringSelectMenuOptionBuilder().setLabel("0. Skip (do nothing)").setValue("skip"),
        ...targets.map((id, idx) =>
          new StringSelectMenuOptionBuilder().setLabel(`${idx + 1}. ${names[id]}${id === userId ? " (You)" : ""}`).setValue(id)
        )
      ];
      const select = new StringSelectMenuBuilder()
        .setCustomId(`ability_target_doctor_${userId}`)
        .setPlaceholder("Select a player to heal...")
        .addOptions(options);

      return interaction.reply({ content: `${abilityDesc}\n\n${buildPlayerList(game)}`, components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }

    // Sheriff — per-player tracking (already done)
    if (role === "sheriff") {
      if (!game.nightActions.sheriffUsed) game.nightActions.sheriffUsed = {};
      if (game.nightActions.sheriffUsed[userId])
        return interaction.reply({ content: "❌ You've already investigated someone tonight!", ephemeral: true });

      const targets = [...game.alivePlayers];
      const names = await getNames(interaction.guild, targets);
      const options = [
        new StringSelectMenuOptionBuilder().setLabel("0. Skip (do nothing)").setValue("skip"),
        ...targets.map((id, idx) =>
          new StringSelectMenuOptionBuilder().setLabel(`${idx + 1}. ${names[id]}${id === userId ? " (You)" : ""}`).setValue(id)
        )
      ];
      const select = new StringSelectMenuBuilder()
        .setCustomId(`ability_target_sheriff_${userId}`)
        .setPlaceholder("Select a player to investigate...")
        .addOptions(options);

      return interaction.reply({ content: `🕷️ Choose a player to **investigate** tonight:\n\n${buildPlayerList(game)}`, components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }

    // Dark Ladybug — heals an Evil teammate, once every 2 nights
    if (role === "darkLadybug") {
      const lastHeal = game.darkLadybugLastHeal?.[userId] || 0;
      const canHeal  = lastHeal === 0 || (game.nightCount - lastHeal) >= 2; // 0 = never healed yet, so night 1 is always allowed
      if (!canHeal)
        return interaction.reply({ content: "❌ You can only heal once every 2 nights! Wait one more night.", ephemeral: true });
      if (game.nightActions[`darkLadybug_${userId}`])
        return interaction.reply({ content: "❌ You've already used your heal tonight!", ephemeral: true });

      const targets = game.alivePlayers.filter(id => isEvil(game.roles[id]));
      const names = await getNames(interaction.guild, targets);
      const options = [
        new StringSelectMenuOptionBuilder().setLabel("0. Skip (do nothing)").setValue("skip"),
        ...targets.map((id, idx) =>
          new StringSelectMenuOptionBuilder().setLabel(`${idx + 1}. ${names[id]}${id === userId ? " (You)" : ""}`).setValue(id)
        )
      ];
      const select = new StringSelectMenuBuilder()
        .setCustomId(`ability_target_darkLadybug_${userId}`)
        .setPlaceholder("Select a teammate to heal...")
        .addOptions(options);

      return interaction.reply({
        content: `🖤 Choose an **Evil teammate** to heal tonight *(usable once every 2 nights)*:\n\n${buildPlayerList(game)}`,
        components: [new ActionRowBuilder().addComponents(select)],
        ephemeral: true,
      });
    }

    // Fallback — unknown role
    return interaction.reply({ content: "❌ You don't have a recognised night ability!", ephemeral: true });
  }

  // ── Ability Target Selected ──
  // customId format: ability_target_ROLE_USERID (e.g. ability_target_doctor_123456)
  if (interaction.customId?.startsWith("ability_target_")) {
    if (!game || game.phase !== "night")
      return interaction.reply({ content: "❌ It's not night time!", ephemeral: true });

    // Parse role from customId — strip prefix and userId suffix
    const withoutPrefix = interaction.customId.replace("ability_target_", "");
    // role is everything before the last underscore+digits
    const roleMatch = withoutPrefix.match(/^(.+?)_(\d+)$/);
    const role   = roleMatch ? roleMatch[1] : withoutPrefix;
    const target = interaction.values[0];

    if (target === "skip") {
      // Soldier ant skip does NOT consume the ability
      if (role === "soldierAnt") {
        return interaction.reply({ content: "⏭️ You chose not to fire tonight. Your missile is saved for another night.", ephemeral: true });
      }
      return interaction.reply({ content: "⏭️ You chose to skip your ability tonight.", ephemeral: true });
    }

    // ── Doctor ──
    if (role === "doctor") {
      if (!game.nightActions.doctorUsed) game.nightActions.doctorUsed = {};
      const lastHeal = game.lastHealTargets?.[userId];
      if (lastHeal === target)
        return interaction.reply({ content: "❌ You cannot heal the same person twice in a row!", ephemeral: true });
      game.nightActions.doctorUsed[userId] = target;
      // Store all doctor heals as array so multiple doctors work
      if (!game.nightActions.doctorTargets) game.nightActions.doctorTargets = [];
      if (!game.nightActions.doctorTargets.includes(target)) game.nightActions.doctorTargets.push(target);
      log(game, `Night ${game.nightCount}`, `${playerTag(game, userId)} -> Heal -> ${playerTag(game, target)} -> Chosen to heal ${playerTag(game, target)} tonight!`);
      return interaction.reply({ content: `✅ You will heal <@${target}> tonight!`, ephemeral: true });
    }

    // ── Sheriff ──
    if (role === "sheriff") {
      if (!game.nightActions.sheriffUsed) game.nightActions.sheriffUsed = {};
      if (game.nightActions.sheriffUsed[userId])
        return interaction.reply({ content: "❌ You've already investigated someone tonight!", ephemeral: true });
      game.nightActions.sheriffUsed[userId] = target;
      const info      = ROLE_INFO[game.roles[target]];
      const alignment = info.team === "Evil" ? "Evil" : info.team === "Independent" ? "Independent" : "Good";
      log(game, `Night ${game.nightCount}`, `${playerTag(game, userId)} -> Investigate -> ${playerTag(game, target)} -> ${playerTag(game, target)} is ${alignment}!`);
      const alignStr = info.team === "Evil" ? "**Evil** 🐛" : info.team === "Independent" ? "**Independent** 🔮" : "**Good** 🐝";
      return interaction.reply({ content: `🕵️ Investigation result: <@${target}> is ${alignStr}!`, ephemeral: true });
    }

    // ── Soldier Ant ──
    if (role === "soldierAnt") {
      if (!game.nightActions.soldierAntUsed) game.nightActions.soldierAntUsed = {};
      if (!game.nightActions.soldierAntShots) game.nightActions.soldierAntShots = [];
      game.nightActions.soldierAntUsed[userId] = true;
      game.nightActions.soldierAntShots.push({ shooter: userId, target });
      log(game, `Night ${game.nightCount}`, `${playerTag(game, userId)} -> Shoot -> ${playerTag(game, target)} -> Chosen to shoot ${playerTag(game, target)} tonight!`);
      return interaction.reply({ content: `✅ You will fire your missile at <@${target}> tonight!`, ephemeral: true });
    }

    // ── Dark Ladybug ──
    if (role === "darkLadybug") {
      const lastHeal = game.darkLadybugLastHeal?.[userId] || 0;
      if (lastHeal !== 0 && (game.nightCount - lastHeal) < 2) // 0 = never healed yet, so night 1 is always allowed
        return interaction.reply({ content: "❌ You can only heal once every 2 nights!", ephemeral: true });

      game.nightActions[`darkLadybug_${userId}`] = target;
      if (!game.nightActions.doctorTargets) game.nightActions.doctorTargets = [];
      if (!game.nightActions.doctorTargets.includes(target)) game.nightActions.doctorTargets.push(target);
      game.darkLadybugLastHeal[userId] = game.nightCount;
      log(game, `Night ${game.nightCount}`, `${playerTag(game, userId)} -> Heal Teammate -> ${playerTag(game, target)} -> Chosen to heal ${playerTag(game, target)} tonight!`);
      return interaction.reply({ content: `🖤 You will heal <@${target}> tonight!`, ephemeral: true });
    }
  }

  // ── Scorpion Activate Button ──
  if (interaction.customId === "scorpion_activate") {
    if (!game || game.phase !== "night")
      return interaction.reply({ content: "❌ It's not night time!", ephemeral: true });
    if (game.roles[userId] !== "scorpion")
      return interaction.reply({ content: "❌ Only the Scorpion can use this!", ephemeral: true });
    if (game.nightActions.scorpionUsed?.[userId])
      return interaction.reply({ content: "❌ Your poison has already been activated!", ephemeral: true });

    if (!game.nightActions.scorpionUsed) game.nightActions.scorpionUsed = {};
    if (!game.nightActions.scorpionActive) game.nightActions.scorpionActive = {};
    game.nightActions.scorpionActive[userId] = true;
    game.nightActions.scorpionUsed[userId]   = true;
    log(game, `Night ${game.nightCount}`, `${playerTag(game, userId)} -> Activate Poison -> Poison is now active!`);
    return interaction.reply({ content: "🦂 **Poison activated!** If anyone tries to kill you tonight, they will be poisoned. You will also die if targeted.", ephemeral: true });
  }

  // ── I'm Evil (Kill Vote) ──
  if (interaction.customId === "im_evil") {
    if (!game || game.phase !== "night")
      return interaction.reply({ content: "❌ It's not night time!", ephemeral: true });
    if (!game.alivePlayers.includes(userId))
      return interaction.reply({ content: "❌ You are not in this game!", ephemeral: true });
    if (!isEvil(game.roles[userId]))
      return interaction.reply({ content: "❌ Only Evil players can use this!", ephemeral: true });

    const targets = [...game.alivePlayers];
    if (!game.mafiaVoteCounts) game.mafiaVoteCounts = {};
    targets.forEach(id => { if (game.mafiaVoteCounts[id] === undefined) game.mafiaVoteCounts[id] = 0; });

    const names = await getNames(interaction.guild, targets);
    const options = [
      new StringSelectMenuOptionBuilder().setLabel("0. Skip (do nothing)").setValue("skip"),
      ...targets.map((id, idx) =>
        new StringSelectMenuOptionBuilder().setLabel(`${idx + 1}. ${names[id]}${id === userId ? " (You)" : ""}`).setValue(id)
      )
    ];

    const currentVoteList = [
      `**0.** Skip — ${game.mafiaVoteCounts["skip"] || 0} votes`,
      ...targets.map((id, idx) => `**${idx + 1}.** <@${id}> — ${game.mafiaVoteCounts[id] || 0} votes`)
    ].join("\n");

    const select = new StringSelectMenuBuilder().setCustomId("mafia_kill_target").setPlaceholder("Select a target...").addOptions(options);
    return interaction.reply({
      content: `🔪 **Cast your kill vote:**\n\n${currentVoteList}`,
      components: [new ActionRowBuilder().addComponents(select)],
      ephemeral: true,
    });
  }

  // ── Mafia Kill Target Selected ──
  if (interaction.customId === "mafia_kill_target") {
    if (!game || game.phase !== "night")
      return interaction.reply({ content: "❌ It's not night time!", ephemeral: true });
    if (!isEvil(game.roles[userId]))
      return interaction.reply({ content: "❌ Only Evil players can do this!", ephemeral: true });

    const target = interaction.values[0];
    if (!game.mafiaVoteCounts) game.mafiaVoteCounts = {};

    if (game.mafiaVotes[userId] !== undefined) {
      const oldTarget = game.mafiaVotes[userId];
      if (oldTarget && oldTarget !== "skip") game.mafiaVoteCounts[oldTarget] = Math.max(0, (game.mafiaVoteCounts[oldTarget] || 1) - 1);
      else if (oldTarget === "skip")         game.mafiaVoteCounts["skip"]    = Math.max(0, (game.mafiaVoteCounts["skip"]    || 1) - 1);
    }

    if (target === "skip") {
      game.mafiaVotes[userId] = "skip";
      game.mafiaVoteCounts["skip"] = (game.mafiaVoteCounts["skip"] || 0) + 1;
      log(game, `Night ${game.nightCount}`, `${playerTag(game, userId)} -> Kill Vote -> Skip`);
    } else {
      game.mafiaVotes[userId] = target;
      game.mafiaVoteCounts[target] = (game.mafiaVoteCounts[target] || 0) + 1;
      log(game, `Night ${game.nightCount}`, `${playerTag(game, userId)} -> Kill Vote -> ${playerTag(game, target)} -> Chosen to kill ${playerTag(game, target)} tonight!`);
    }

    const allTargets  = [...game.alivePlayers];
    const updatedList = [
      `**0.** Skip — ${game.mafiaVoteCounts["skip"] || 0} votes`,
      ...allTargets.map((id, idx) => `**${idx + 1}.** <@${id}> — ${game.mafiaVoteCounts[id] || 0} votes`)
    ].join("\n");

    const names2   = await getNames(interaction.guild, allTargets);
    const options2 = [
      new StringSelectMenuOptionBuilder().setLabel("0. Skip (do nothing)").setValue("skip"),
      ...allTargets.map((id, idx) =>
        new StringSelectMenuOptionBuilder().setLabel(`${idx + 1}. ${names2[id]}${id === userId ? " (You)" : ""}`).setValue(id)
      )
    ];
    const select2 = new StringSelectMenuBuilder().setCustomId("mafia_kill_target").setPlaceholder("Select a target...").addOptions(options2);

    return interaction.update({
      content: `🔪 **Cast your kill vote:**\n\n${updatedList}\n\n*Change your vote anytime.*`,
      components: [new ActionRowBuilder().addComponents(select2)],
    });
  }

  // ── Cast Vote ──
  if (interaction.customId === "cast_vote") {
    if (!game || game.phase !== "voting")
      return interaction.reply({ content: "❌ Voting is not active!", ephemeral: true });
    if (!game.alivePlayers.includes(userId))
      return interaction.reply({ content: "❌ You are not alive in this game!", ephemeral: true });

    const names = await getNames(interaction.guild, game.alivePlayers);
    const options = [
      new StringSelectMenuOptionBuilder().setLabel("0. Skip (abstain)").setValue("skip"),
      ...game.alivePlayers.map((id, idx) =>
        new StringSelectMenuOptionBuilder().setLabel(`${idx + 1}. ${names[id]}${id === userId ? " (You)" : ""}`).setValue(id)
      )
    ];

    const select = new StringSelectMenuBuilder().setCustomId("vote_target").setPlaceholder("Select a player to vote out...").addOptions(options);
    return interaction.reply({
      content: `🗳️ **Cast your vote:**\n\n${buildPlayerList(game)}`,
      components: [new ActionRowBuilder().addComponents(select)],
      ephemeral: true,
    });
  }

  // ── Vote Target Selected ──
  if (interaction.customId === "vote_target") {
    if (!game || game.phase !== "voting")
      return interaction.reply({ content: "❌ Voting is closed!", ephemeral: true });
    if (!game.alivePlayers.includes(userId))
      return interaction.reply({ content: "❌ You are not alive!", ephemeral: true });

    const target     = interaction.values[0];
    const isQueen    = game.roles[userId] === "queenAnt";
    const voteWeight = isQueen ? 3 : 1;

    // Remove old vote
    if (game.votes[userId]) {
      if (game.votes[userId] === "skip") {
        game.skipVotes = Math.max(0, (game.skipVotes || voteWeight) - voteWeight);
      } else {
        game.voteCounts[game.votes[userId]] = Math.max(0, (game.voteCounts[game.votes[userId]] || voteWeight) - voteWeight);
        if (isQueen) game.queenVote = null;
      }
    }

    if (target === "skip") {
      const isChange = !!game.votes[userId];
      game.votes[userId] = "skip";
      game.skipVotes = (game.skipVotes || 0) + voteWeight;
      log(game, `Voting Phase ${game.nightCount}`, `${playerTag(game, userId)} -> Vote -> Skip${isQueen ? " (3 votes)" : ""}${isChange ? " (changed)" : ""}`);
      const msg = isQueen
        ? (isChange ? `📢 👑 Queen Ant changed their vote to **skip**! (3 votes)` : `📢 👑 Queen Ant voted to **skip**! (3 votes)`)
        : (isChange ? `📢 <@${userId}> changed their vote to **skip**!` : `📢 <@${userId}> has voted to **skip**!`);
      await interaction.channel.send(msg);
      await updateVotingMessage(game);
      const names2 = await getNames(interaction.guild, game.alivePlayers);
      const opts2 = [
        new StringSelectMenuOptionBuilder().setLabel("0. Skip (abstain)").setValue("skip"),
        ...game.alivePlayers.map((id, idx) => new StringSelectMenuOptionBuilder().setLabel(`${idx + 1}. ${names2[id]}${id === userId ? " (You)" : ""}`).setValue(id))
      ];
      return interaction.update({ content: `🗳️ **Your vote: Skip**\n\n${buildPlayerList(game)}`, components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("vote_target").setPlaceholder("Change your vote...").addOptions(opts2))] });
    }

    const isChange = !!game.votes[userId];
    game.votes[userId] = target;
    game.voteCounts[target] = (game.voteCounts[target] || 0) + voteWeight;
    if (isQueen) game.queenVote = target;

    log(game, `Voting Phase ${game.nightCount}`, `${playerTag(game, userId)} -> Vote -> ${playerTag(game, target)}${isQueen ? " (3 votes — QUEEN'S PICK)" : ""}${isChange ? " (changed)" : ""}`);
    const msg = isQueen
      ? (isChange ? `📢 👑 Queen Ant changed their pick to <@${target}>! (3 votes)` : `📢 👑 Queen Ant has picked <@${target}>! (3 votes)`)
      : (isChange ? `📢 <@${userId}> changed their vote to <@${target}>!` : `📢 <@${userId}> has voted for <@${target}>!`);
    await interaction.channel.send(msg);
    await updateVotingMessage(game);
    const names3 = await getNames(interaction.guild, game.alivePlayers);
    const opts3 = [
      new StringSelectMenuOptionBuilder().setLabel("0. Skip (abstain)").setValue("skip"),
      ...game.alivePlayers.map((id, idx) => new StringSelectMenuOptionBuilder().setLabel(`${idx + 1}. ${names3[id]}${id === userId ? " (You)" : ""}`).setValue(id))
    ];
    return interaction.update({ content: `🗳️ **Your vote: <@${target}>**\n\n${buildPlayerList(game)}`, components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("vote_target").setPlaceholder("Change your vote...").addOptions(opts3))] });
  }

  // ── RPS Pick ──
  if (interaction.customId === "rps_pick") {
    if (!game || game.phase !== "tiebreaker")
      return interaction.reply({ content: "❌ No tiebreaker active!", ephemeral: true });
    if (!game.alivePlayers.includes(userId))
      return interaction.reply({ content: "❌ You are not a tiebreaker participant!", ephemeral: true });
    if (game.rpsChoices[userId])
      return interaction.reply({ content: "❌ You already made your pick!", ephemeral: true });

    const select = new StringSelectMenuBuilder()
      .setCustomId("rps_choice")
      .setPlaceholder("Choose your weapon!")
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel("🪨 Rock").setValue("rock"),
        new StringSelectMenuOptionBuilder().setLabel("📄 Paper").setValue("paper"),
        new StringSelectMenuOptionBuilder().setLabel("✂️ Scissors").setValue("scissors")
      );

    return interaction.reply({ content: "✂️ **Choose your pick:**", components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
  }

  // ── RPS Choice ──
  if (interaction.customId === "rps_choice") {
    if (!game || game.phase !== "tiebreaker")
      return interaction.reply({ content: "❌ No tiebreaker active!", ephemeral: true });

    game.rpsChoices[userId] = interaction.values[0];
    await interaction.reply({ content: `✅ You chose **${interaction.values[0]}**!`, ephemeral: true });

    const allPicked = game.alivePlayers.every(id => game.rpsChoices[id]);
    if (!allPicked) return;

    const [p1, p2] = game.alivePlayers;
    const p1choice = game.rpsChoices[p1];
    const p2choice = game.rpsChoices[p2];
    const beats    = { rock: "scissors", scissors: "paper", paper: "rock" };

    if (p1choice === p2choice) {
      // Random execution on tie
      const eliminated = Math.random() < 0.5 ? p1 : p2;
      game.alivePlayers = game.alivePlayers.filter(id => id !== eliminated);
      await assignDeadRole(interaction.channel.guild, eliminated);
      recordDeath(game, eliminated);

      // Check win after random execution
      const win = checkWinCondition(game);
      if (win) {
        game.phase = "ended"; // flip before the awaited send below, closing the race with the 60s auto-resolve timer
        games.delete(channelId);
      }

      await interaction.channel.send({ embeds: [
        new EmbedBuilder().setColor(0x9b59b6)
          .setDescription(`🤝 Both chose **${p1choice}**! It's a tie — fate decides...\n💀 <@${eliminated}> has been eliminated by the universe!`)
      ]});

      if (win) await announceWinner(interaction.channel, game, win);
      return;
    }

    const p1isMafia = isEvil(game.roles[p1]);
    const p1wins    = beats[p1choice] === p2choice;
    const winner    = (p1isMafia && p1wins) || (!p1isMafia && !p1wins) ? "evil_rps" : "good_rps";

    game.phase = "ended"; // flip before the awaited sends below, closing the race with the 60s auto-resolve timer
    games.delete(channelId);

    await interaction.channel.send({ embeds: [new EmbedBuilder().setColor(0x9b59b6).setDescription(`✂️ **Results:** <@${p1}> chose **${p1choice}**, <@${p2}> chose **${p2choice}**!`)] });
    await announceWinner(interaction.channel, game, winner);
    return;
  }

  } catch (err) {
    console.error("Mafia interaction error:", err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "❌ Something went wrong! Please try again.", ephemeral: true }).catch(() => {});
    }
  }
}

// ─── Slash Commands ───────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName("mafia")
    .setDescription("Start a game of Mafia!")
    .addIntegerOption(option =>
      option.setName("minplayers").setDescription("Minimum players needed to start (default: 4)").setMinValue(1).setMaxValue(20).setRequired(false)
    ),

  endMafiaData: new SlashCommandBuilder()
    .setName("endmafia")
    .setDescription("Force end the current Mafia game in this channel."),

  mafiaDebugData: new SlashCommandBuilder()
    .setName("mafiadebug")
    .setDescription("Show the full debug log for the current game. (twilight_chasm only)"),

  async executeMafiaDebug(interaction) {
    if (interaction.user.username !== "twilight_chasm")
      return interaction.reply({ content: "❌ Only twilight_chasm can use this command!", ephemeral: true });

    // Prefer a live game's debug log; fall back to the last ended game's log
    // for this channel so this still works after the game is over.
    const game = games.get(interaction.channelId);
    const debugLog = game?.debugLog?.length ? game.debugLog : lastDebugLogs.get(interaction.channelId)?.debugLog;

    if (!debugLog || debugLog.length === 0)
      return interaction.reply({ content: "❌ No debug log found for this channel!", ephemeral: true });

    // Group entries by phase
    const grouped = {};
    for (const { phase, text } of debugLog) {
      if (!grouped[phase]) grouped[phase] = [];
      grouped[phase].push(text);
    }

    // Build text output
    const lines = [];
    for (const [phase, entries] of Object.entries(grouped)) {
      lines.push(`\n── ${phase} ──`);
      for (const entry of entries) lines.push(`  ${entry}`);
    }

    const full = lines.join("\n");

    // Discord has a 2000 char limit per message — split into chunks
    const chunks = [];
    let current = "```\n";
    for (const line of lines) {
      if ((current + line + "\n```").length > 1990) {
        chunks.push(current + "```");
        current = "```\n";
      }
      current += line + "\n";
    }
    chunks.push(current + "```");

    await interaction.reply({ content: chunks[0], ephemeral: true });
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp({ content: chunks[i], ephemeral: true });
    }
  },

  mafiaRolesData: new SlashCommandBuilder()
    .setName("mafiaroles")
    .setDescription("View all roles in the game, or get details on a specific role.")
    .addStringOption(option =>
      option
        .setName("role")
        .setDescription("Get detailed info on a specific role")
        .setRequired(false)
        .addChoices(
          ...Object.entries(ROLE_INFO).map(([key, info]) => ({ name: `${info.emoji} ${info.name}`, value: key }))
        )
    ),

  async executeMafiaRoles(interaction) {
    const roleKey = interaction.options.getString("role");
    if (roleKey) return sendRoleCard(interaction, roleKey);

    const goodRoles  = Object.entries(ROLE_INFO).filter(([, v]) => v.team === "Good");
    const evilRoles  = Object.entries(ROLE_INFO).filter(([, v]) => v.team === "Evil");
    const indepRoles = Object.entries(ROLE_INFO).filter(([, v]) => v.team === "Independent");
    const goodList   = goodRoles.map(([, v]) => `${v.emoji} **${v.name}**`).join("\n");
    const evilList   = evilRoles.map(([, v]) => `${v.emoji} **${v.name}**`).join("\n");
    const indepList  = indepRoles.map(([, v]) => `${v.emoji} **${v.name}**`).join("\n");

    const embed = new EmbedBuilder()
      .setColor(0x4a90d9)
      .setTitle("🎭 Mafia Roles")
      .addFields(
        { name: "🐝 Good",        value: goodList  || "None", inline: true },
        { name: "🐛 Evil",        value: evilList  || "None", inline: true },
        { name: "🟦 Independent", value: indepList || "None", inline: true },
      )
      .setFooter({ text: "Use /mafiaroles role: to get details on a specific role!" });

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },

  async executeEndMafia(interaction) {
    const game = games.get(interaction.channelId);
    if (!game)
      return interaction.reply({ content: "❌ There is no active Mafia game in this channel!", ephemeral: true });
    game.phase = "ended";
    games.delete(interaction.channelId);
    await removeAllDeadRoles(interaction.guild, game.allPlayers.length ? game.allPlayers : game.players);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff0000).setTitle("🛑 Game Ended").setDescription("The Mafia game has been forcefully ended!")] });
  },

  handleMafiaInteraction,

  async execute(interaction) {
    const channelId  = interaction.channelId;
    const minPlayers = interaction.options.getInteger("minplayers") ?? 4;

    if (games.has(channelId))
      return interaction.reply({ content: "❌ A game is already running in this channel!", ephemeral: true });

    const game = {
      phase: "joining", players: [], alivePlayers: [], allPlayers: [],
      roles: {}, nightCount: 1, nightActions: {}, mafiaVotes: {}, mafiaVoteCounts: {},
      votes: {}, voteCounts: {}, lastHealTarget: null, lastHealTargets: {}, votingMessage: null,
      mafiaVoteMessage: null, rpsChoices: {}, minPlayers, voteEndTime: 0,
      nightMessage: null, discussionMessage: null, prenightMessage: null,
      endPhaseVotes: new Set(), pendingHornet: null,
      dandelionTarget: null, lastDandelionTarget: null, squareWon: false,
      leechHosts: {}, leechWon: false, leechLastHeal: {}, queenVote: null,
      darkLadybugLastHeal: {}, // per-player, persists across nights
      debugLog: [], debugNames: {},
      deathNight: {}, contributions: {}, // Elo tracking
    };
    games.set(channelId, game);

    const embed = new EmbedBuilder()
      .setColor(0x2c2f33)
      .setTitle("🎭 Mafia Game — Join Now!")
      .setDescription(`A game of Mafia is starting!\n\nPress **Join Game** to play.\n\n⏰ Joining closes ${ts(20_000)}\n\n⚠️ Minimum **${minPlayers} players** required to start.`)
      .setFooter({ text: "Good luck, may the odds be ever in your favor!" });

    const joinBtn = new ButtonBuilder().setCustomId("join_mafia").setLabel("🎮 Join Game").setStyle(ButtonStyle.Success);
    await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(joinBtn)] });

    // Ping @mafia-ping role if it exists
    const pingRole = interaction.guild.roles.cache.find(r => r.name === "mafia-ping");
    if (pingRole) await interaction.channel.send(`${pingRole} A Mafia game is starting! Press Join Game to play!`);

    setTimeout(async () => {
      const currentGame = games.get(channelId);
      if (!currentGame || currentGame.phase !== "joining") return;

      if (currentGame.players.length < currentGame.minPlayers) {
        games.delete(channelId);
        return interaction.channel.send({ embeds: [
          new EmbedBuilder().setColor(0xff0000).setDescription(`❌ Not enough players joined (${currentGame.players.length}/${currentGame.minPlayers} minimum). Game cancelled!`)
        ]});
      }

      currentGame.roles        = assignRoles(currentGame.players);
      currentGame.alivePlayers = [...currentGame.players];
      currentGame.allPlayers   = [...currentGame.players];
      currentGame.phase        = "starting";

      // Populate debug names from guild members
      try {
        await interaction.guild.members.fetch({ user: currentGame.players });
        for (const id of currentGame.players) {
          const member = interaction.guild.members.cache.get(id);
          currentGame.debugNames[id] = member?.displayName || id;
        }
      } catch {}

      // Log role assignments
      log(currentGame, "Game Start", "=== ROLE ASSIGNMENTS ===");
      for (const id of currentGame.players) {
        log(currentGame, "Game Start", `${playerTag(currentGame, id)} assigned`);
      }
      if (currentGame.leechHosts) {
        for (const [leechId, hostId] of Object.entries(currentGame.leechHosts)) {
          log(currentGame, "Game Start", `${playerTag(currentGame, leechId)} -> Host -> ${playerTag(currentGame, hostId)}`);
        }
      }

      // Assign leech hosts — each leech gets a random host (any other player)
      currentGame.leechHosts = {};
      for (const id of currentGame.players) {
        if (currentGame.roles[id] === "leech") {
          const others = currentGame.players.filter(p => p !== id);
          currentGame.leechHosts[id] = others[Math.floor(Math.random() * others.length)];
        }
      }
      currentGame.leechWon   = false;
      currentGame.leechLastHeal = {}; // leechId -> nightCount of last heal
      currentGame.darkLadybugLastHeal = {}; // darkLadybugId -> nightCount of last heal

      const startEmbed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("🎭 Game Starting!")
        .setDescription(`**${currentGame.players.length} players** have joined!\n\n${currentGame.players.map(id => `<@${id}>`).join(", ")}\n\nCheck your role below — keep it secret! 🤫\n\n⏰ Pre-Night begins ${ts(5_000)}`);

      const roleBtn = new ButtonBuilder().setCustomId("check_role").setLabel("🔍 Click to check your role").setStyle(ButtonStyle.Secondary);
      await interaction.channel.send({ embeds: [startEmbed], components: [new ActionRowBuilder().addComponents(roleBtn)] });
      setTimeout(async () => {
        try {
          await startPreNight(interaction.channel, currentGame);
        } catch (err) {
          console.error("Failed to start pre-night:", err);
          interaction.channel.send("❌ An error occurred starting the pre-night phase. Use /endmafia and try again.").catch(() => {});
        }
      }, 5_000);
    }, 20_000);
  },
};