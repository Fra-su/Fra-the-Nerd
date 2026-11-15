const { MongoClient } = require("mongodb");

// On some Windows PCs, Node's DNS can't do the SRV lookup that "mongodb+srv://"
// needs (error: querySrv ECONNREFUSED). Use public DNS there. Linux hosts like
// Railway are unaffected, so this only runs on Windows.
if (process.platform === "win32") {
  require("dns").setServers(["1.1.1.1", "8.8.8.8"]);
}

// ─── MongoDB Connection ───────────────────────────────────────────────────────
const uri    = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  tls: true,
  tlsAllowInvalidCertificates: false,
  serverSelectionTimeoutMS: 15000,
  connectTimeoutMS: 15000,
  socketTimeoutMS: 15000,
});
let db = null;

async function getDB() {
  try {
    if (!db) {
      await client.connect();
      db = client.db("mafia_stats");
      console.log("✅ Connected to MongoDB!");
    }
    return db;
  } catch (err) {
    db = null; // reset so next call retries
    throw err;
  }
}

// Another database on the same connection (e.g. "chatbot" for /talk votes)
async function getNamedDB(name) {
  await getDB();
  return client.db(name);
}

// ─── Elo System ───────────────────────────────────────────────────────────────
// ✏️ Everyone starts here, and Elo is clamped to [ELO_MIN, ELO_MAX].
const ELO_START = 1000;
const ELO_MIN   = 100;
const ELO_MAX   = 2000;

// ✏️ Base Elo "pot" moved per game before difficulty scaling — raise/lower
// this to make swings bigger/smaller overall. (Deliberately NOT scaled by
// player count — see the difficulty scaling below for why.)
const ELO_POT_BASE = 5.4;

// ✏️ Tiny nudge for Good players who helped kill an Evil (Scorpion poison,
// Soldier Ant shot, or a correct final vote). Capped so it never swings the
// result significantly — it's flavour, not the main driver.
const CONTRIB_BONUS = 0.1;
const CONTRIB_CAP   = 0.3;

// ✏️ How strongly an early death scales a player's Elo swing. 0 disables it.
// Good dying early is softened; Evil dying early is sharpened.
const EARLY_DEATH_PULL = 0.6;

// ✏️ "Normal" ratio of Evil to total players. 0.3 (~1 Evil per 3.3 players)
// sits a bit above the game's actual smallest-lobby ratio (1-in-4 for a 4p
// game), so even the "easiest" real games count as mildly easy-for-Good —
// softening Evil's losses a bit across the board. Games with a lower Evil
// ratio (more Good per Evil, e.g. 6p 1 mafia) are harder for Evil — Evil
// loses less on defeat and gains more on the rare win, Good gains less on
// the (expected) win and loses more on the (upset) loss. Games with a
// higher ratio flip the same logic the other way. Capped at 0.5x–1.5x so
// one lopsided lobby can't swing things too far.
const BASELINE_EVIL_RATIO   = 0.3;
const DIFFICULTY_MIN        = 0.5;
const DIFFICULTY_MAX        = 1.5;

// ✏️ How much Evil's own survival time (not just lobby difficulty) softens
// or sharpens their loss. Getting caught night 1 hurts more than nearly
// making it to the final night, even in the exact same lobby setup — this
// is on top of (multiplied with) the difficulty scaling above, not instead
// of it, so the same 4p-1-mafia game can lose anywhere from a bit under to
// a bit over its baseline depending on how the round actually went.
const PERFORMANCE_PULL = 0.6;
const PERFORMANCE_MIN  = 0.6;
const PERFORMANCE_MAX  = 1.4;

// ✏️ Square doesn't share the normal Good/Evil pot — pulling off their win
// steals this fraction of it straight from whichever side actually won.
const SQUARE_STEAL_FRACTION = 0.25;

// ✏️ How many past-game Elo entries to keep per player. "all" history in
// /stats reads from this, so it's really the true cap on how far back
// someone can look, not just a display limit.
const ELO_HISTORY_CAP = 500;

// High-Elo players gain a smaller slice of the pot and lose a bigger slice.
// At ELO_START it's 100%/100%; it slides linearly to 0%/200% at ELO_MAX.
function eloScaling(elo) {
  const t = Math.min(1, Math.max(0, (elo - ELO_START) / (ELO_MAX - ELO_START)));
  return { gainMult: 1 - t, lossMult: 1 + t };
}

function clampElo(e) {
  return Math.max(ELO_MIN, Math.min(ELO_MAX, e));
}

// >1 = this lobby's setup was harder than baseline for Evil (and therefore
// easier than baseline for Good). <1 = the reverse.
function difficultyFactor(evilCount, totalPlayers) {
  if (!evilCount || !totalPlayers) return 1;
  const evilRatio = evilCount / totalPlayers;
  const raw = BASELINE_EVIL_RATIO / evilRatio;
  return Math.max(DIFFICULTY_MIN, Math.min(DIFFICULTY_MAX, raw));
}

// Per-player weight used to split the shared pot. Keeping this as a *weight*
// (rather than an absolute add/subtract) is what guarantees the total always
// nets to exactly zero — winners always split +pot, losers always split -pot,
// no matter how skewed the individual modifiers get.
function weightFor(entry, isWinner, currentElo) {
  let w = entry.roleModifier || 1.0;

  if (entry.deathNight != null && entry.totalNights > 1) {
    const earlyFrac = 1 - (entry.deathNight - 1) / (entry.totalNights - 1); // 1 = died night 1
    if (entry.team === "Good")      w *= 1 - EARLY_DEATH_PULL * earlyFrac * 0.4;
    else if (entry.team === "Evil") w *= 1 + EARLY_DEATH_PULL * earlyFrac;
  }

  const { gainMult, lossMult } = eloScaling(currentElo);
  w *= isWinner ? gainMult : lossMult;

  return Math.max(w, 0.01); // never let a share hit exactly zero
}

// entries: [{ userId, guildId, won, team, roleModifier, deathNight, contribution,
//             totalNights, evilCount, totalPlayers, independentWin }]
// Returns [{ userId, before, after, delta }] in the same order as `entries`.
async function recordGameElo(entries) {
  try {
    const db  = await getDB();
    const col = db.collection("players");

    // Ensure every player has a doc, then read their current Elo.
    const currentElo = {};
    for (const e of entries) {
      await col.updateOne(
        { userId: e.userId },
        { $setOnInsert: { userId: e.userId, guildId: e.guildId, games: 0, wins: 0, elo: ELO_START } },
        { upsert: true }
      );
      const doc = await col.findOne({ userId: e.userId });
      currentElo[e.userId] = doc?.elo ?? ELO_START;
    }

    // Square (or any future independent role) that pulled off its own win
    // condition is pulled out of the normal team pot entirely — they get a
    // separate steal from the winning side instead of diluting/joining it.
    const independentWinners = entries.filter(e => e.independentWin);
    const official            = entries.filter(e => !e.independentWin);

    const winners = official.filter(e => e.won);
    const losers  = official.filter(e => !e.won);

    // The pot itself grows or shrinks based on how surprising the actual
    // result was, given the Evil/Good ratio in this lobby (e.g. 6p 1-mafia
    // vs 4p 1-mafia). This has to scale the *whole* pot rather than just
    // reweighting shares within a side — with only one Mafia, they're the
    // only loser, so a per-player weight can't change how much they lose;
    // only the pot size can. (This is also why the pot isn't scaled by
    // player count elsewhere — that would cancel out against this ratio.)
    const winningTeams = new Set(winners.map(w => w.team));
    let potMultiplier = 1;
    if (winningTeams.size === 1 && official.length > 0) {
      const diff = difficultyFactor(official[0].evilCount, official[0].totalPlayers);
      if (winningTeams.has("Evil")) {
        potMultiplier = diff; // Evil won harder-than-usual odds -> bigger pot
      } else if (winningTeams.has("Good")) {
        potMultiplier = 1 / diff; // Good's win was easier-than-usual -> smaller pot

        // Evil's own survival time further softens/sharpens their loss on
        // top of the lobby-difficulty scaling above — getting caught night 1
        // hurts more than nearly surviving the whole game, even in the exact
        // same lobby setup.
        const evilLosers = losers.filter(e => e.team === "Evil" && e.deathNight != null && e.totalNights > 1);
        if (evilLosers.length > 0) {
          const avgSurvivalFrac = evilLosers.reduce(
            (s, e) => s + (e.deathNight - 1) / (e.totalNights - 1), 0
          ) / evilLosers.length; // 0 = died night 1, 1 = died the final night
          const perfMult = Math.max(PERFORMANCE_MIN, Math.min(PERFORMANCE_MAX, 1 + PERFORMANCE_PULL * (0.5 - avgSurvivalFrac)));
          potMultiplier *= perfMult;
        }
      }
    }

    const pot = ELO_POT_BASE * potMultiplier;
    const deltas = {};

    // A true wipe-out tie (no winners or no losers on the official side) has
    // no one to fund the pot from — skip the team pot for that case rather
    // than break the zero-sum guarantee.
    if (winners.length > 0 && losers.length > 0) {
      const winnerWeights = winners.map(e => ({ e, w: weightFor(e, true, currentElo[e.userId]) }));
      const loserWeights  = losers.map(e => ({ e, w: weightFor(e, false, currentElo[e.userId]) }));

      const winSum  = winnerWeights.reduce((s, x) => s + x.w, 0) || 1;
      const loseSum = loserWeights.reduce((s, x) => s + x.w, 0) || 1;

      // Square's steal comes straight off the top of the winner pot, before
      // it's split — so it's a real transfer, not just a smaller slice for
      // everyone that happens to add up the same.
      const stolen = independentWinners.length > 0 ? pot * SQUARE_STEAL_FRACTION : 0;
      const winnerPot = pot - stolen;

      for (const { e, w } of winnerWeights) deltas[e.userId] = winnerPot * w / winSum;
      for (const { e, w } of loserWeights)  deltas[e.userId] = -(pot * w / loseSum);

      if (independentWinners.length > 0) {
        const iwWeights = independentWinners.map(e => ({
          e, w: (e.roleModifier || 1.0) * eloScaling(currentElo[e.userId]).gainMult,
        }));
        const iwSum = iwWeights.reduce((s, x) => s + x.w, 0) || 1;
        for (const { e, w } of iwWeights) deltas[e.userId] = stolen * w / iwSum;
      }
    } else {
      for (const e of entries) deltas[e.userId] = 0;
    }

    // Contribution nudges are funded proportionally to each player's own
    // pot weight (not a flat split) — a player with a tiny share only gives
    // up a tiny sliver, so this can never flip a small winner negative.
    const contribs = {};
    for (const e of entries) {
      contribs[e.userId] = Math.min(e.contribution || 0, CONTRIB_CAP / CONTRIB_BONUS) * CONTRIB_BONUS;
    }
    const totalContrib = Object.values(contribs).reduce((a, b) => a + b, 0);
    if (totalContrib !== 0) {
      const totalAbsDelta = entries.reduce((s, e) => s + Math.abs(deltas[e.userId] || 0), 0) || 1;
      for (const e of entries) {
        const share = Math.abs(deltas[e.userId] || 0) / totalAbsDelta;
        deltas[e.userId] = (deltas[e.userId] || 0) + contribs[e.userId] - (totalContrib * share);
      }
    }

    const results = [];
    for (const e of entries) {
      const before = currentElo[e.userId];
      const after  = clampElo(before + deltas[e.userId]);
      const delta  = after - before;

      await col.updateOne(
        { userId: e.userId },
        {
          $inc: { games: 1, wins: e.won ? 1 : 0 },
          $set: { guildId: e.guildId, elo: after },
          $max: { peakElo: after },
          $push: { eloHistory: { $each: [{ elo: after, delta, ts: Date.now() }], $slice: -ELO_HISTORY_CAP } },
        }
      );

      results.push({ userId: e.userId, before, after, delta });
    }

    return results;
  } catch (err) {
    console.error("❌ recordGameElo error:", err);
    throw err;
  }
}

// ─── Get a single player's stats ─────────────────────────────────────────────
async function getPlayerStats(userId) {
  try {
    const db = await getDB();
    const p  = await db.collection("players").findOne({ userId });
    if (!p) return null;

    const elo     = p.elo ?? ELO_START;
    const peakElo = p.peakElo ?? elo;

    return {
      games:       p.games,
      wins:        p.wins,
      winrate:     p.games > 0 ? Math.round((p.wins / p.games) * 1000) / 10 : 0,
      elo,
      peakElo,
      isPeak:      elo >= peakElo,
      eloHistory:  p.eloHistory || [], // [{ elo, delta, ts }], oldest first, capped at ELO_HISTORY_CAP
    };
  } catch (err) {
    console.error("❌ getPlayerStats error:", err);
    return null;
  }
}

// ─── Get leaderboard ─────────────────────────────────────────────────────────
// scope: "global" or a guildId string
async function getLeaderboard(scope, limit = 10) {
  try {
    const db    = await getDB();
    const query = scope === "global" ? {} : { guildId: scope };
    const board = await db.collection("players")
      .find({ ...query, games: { $gt: 0 } })
      .sort({ elo: -1, wins: -1 })
      .limit(limit)
      .toArray();

    return board.map(p => ({
      userId:  p.userId,
      games:   p.games,
      wins:    p.wins,
      winrate: p.games > 0 ? Math.round((p.wins / p.games) * 1000) / 10 : 0,
      elo:     p.elo ?? ELO_START,
    }));
  } catch (err) {
    console.error("❌ getLeaderboard error:", err);
    return [];
  }
}

// ─── Get a player's rank ──────────────────────────────────────────────────────
async function getPlayerRank(userId, scope) {
  try {
    const db    = await getDB();
    const query = scope === "global" ? {} : { guildId: scope };
    const p     = await db.collection("players").findOne({ userId });
    if (!p) return null;

    const myElo = p.elo ?? ELO_START;
    const rank = await db.collection("players").countDocuments({
      ...query,
      games: { $gt: 0 },
      $or: [
        { elo: { $gt: myElo } },
        { elo: myElo, wins: { $gt: p.wins } },
      ],
    });

    return rank + 1;
  } catch (err) {
    console.error("❌ getPlayerRank error:", err);
    return null;
  }
}

module.exports = { recordGameElo, getPlayerStats, getLeaderboard, getPlayerRank, ELO_START, getNamedDB };