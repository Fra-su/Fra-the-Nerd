// ─── AI chat models, running inside the bot ─────────────────────────────────
// Small GPT language models trained from scratch in Python:
//   Small Programming Projects/ReenforcementLearning AI/llm.py
// This file is their forward pass rewritten in plain JavaScript, so the bot
// needs no Python and no separate server. Only replies are made here;
// training still happens in llm.py.
//
// Every model is a pair of files in model/:  <name>.json + <name>.bin
// Add or update one with:   python llm.py export --name <name>
// The bot picks up every model it finds there when it starts.

const fs = require("fs");
const path = require("path");

const MODEL_DIR = path.join(__dirname, "model");
const loaded = new Map(); // name -> model, loaded on first use

// ─── Which models exist ──────────────────────────────────────────────────────
function list() {
  if (!fs.existsSync(MODEL_DIR)) return [];
  return fs.readdirSync(MODEL_DIR)
    .filter(f => f.endsWith(".json") && fs.existsSync(path.join(MODEL_DIR, f.replace(/\.json$/, ".bin"))))
    .map(f => f.replace(/\.json$/, ""))
    .sort();
}

// ─── Load ────────────────────────────────────────────────────────────────────
function load(name) {
  if (loaded.has(name)) return loaded.get(name);
  if (!list().includes(name)) throw new Error(`No model called "${name}" in model/`);
  const info = JSON.parse(fs.readFileSync(path.join(MODEL_DIR, `${name}.json`), "utf8"));
  const buf = fs.readFileSync(path.join(MODEL_DIR, `${name}.bin`));
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const p = {};
  for (const { name: k, shape, offset } of info.layout) {
    const size = shape.reduce((a, b) => a * b, 1);
    p[k] = all.subarray(offset, offset + size);
  }
  const { vocab_size: V, d, n_layer: L, n_head: H, context: T } = info.cfg;

  // tokenizer
  const vocab = info.tokenizer.vocab;
  const stoi = new Map(vocab.map((t, i) => [t, i]));
  const ranks = new Map(info.tokenizer.merges.map(([a, b], i) => [a + "\u0000" + b, i]));
  const newlineIds = new Set(vocab.map((t, i) => (t.includes("\n") ? i : -1)).filter(i => i >= 0));

  const m = { name, info, p, V, d, L, H, T, hd: d / H, vocab, stoi, ranks, newlineIds, cache: new Map() };
  loaded.set(name, m);
  return m;
}

// ─── Tokenizer (byte-pair encoding, same rules as llm.py) ────────────────────
function mergePair(s, a, b) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (i < s.length - 1 && s[i] === a && s[i + 1] === b) {
      out.push(a + b);
      i++;
    } else out.push(s[i]);
  }
  return out;
}

function encodeWord(m, w) {
  const hit = m.cache.get(w);
  if (hit) return hit;
  let s = Array.from(w).filter(c => m.stoi.has(c));
  while (s.length > 1) {
    let best = Infinity, ba = null, bb = null;
    for (let i = 0; i < s.length - 1; i++) {
      const r = m.ranks.get(s[i] + "\u0000" + s[i + 1]);
      if (r !== undefined && r < best) { best = r; ba = s[i]; bb = s[i + 1]; }
    }
    if (ba === null) break;
    s = mergePair(s, ba, bb);
  }
  const ids = s.map(t => m.stoi.get(t));
  if (m.cache.size < 50_000) m.cache.set(w, ids);
  return ids;
}

function encode(name, text) {
  const m = load(name);
  const out = [];
  for (const w of text.match(/\n|[^\S\n]*\S+|[^\S\n]+/g) || []) out.push(...encodeWord(m, w));
  return out;
}

function decode(name, ids) {
  const m = load(name);
  return ids.map(i => m.vocab[i]).join("");
}

// ─── Transformer forward pass, one token at a time with a KV cache ───────────
// Weights are stored like numpy: matrix W of shape (in, out), row-major.

function linear(x, W, b, nOut) {
  const y = new Float64Array(nOut);
  if (b) for (let j = 0; j < nOut; j++) y[j] = b[j];
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    if (xi === 0) continue;
    const row = i * nOut;
    for (let j = 0; j < nOut; j++) y[j] += xi * W[row + j];
  }
  return y;
}

function layerNorm(x, g, b) {
  const n = x.length;
  let mu = 0;
  for (let i = 0; i < n; i++) mu += x[i];
  mu /= n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (x[i] - mu) ** 2;
  const rstd = 1 / Math.sqrt(v / n + 1e-5);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = (x[i] - mu) * rstd * g[i] + b[i];
  return y;
}

function newState(m) {
  return { pos: 0, K: Array.from({ length: m.L }, () => []), Vv: Array.from({ length: m.L }, () => []) };
}

// Push one token, return logits (scores) for the next token.
function feed(m, st, token) {
  const { p, d, H, hd, V } = m;
  const x = new Float64Array(d);
  for (let i = 0; i < d; i++) x[i] = p.wte[token * d + i] + p.wpe[st.pos * d + i];
  const scale = 1 / Math.sqrt(hd);

  for (let l = 0; l < m.L; l++) {
    // attention
    const a = layerNorm(x, p[`${l}.ln1.g`], p[`${l}.ln1.b`]);
    const qkv = linear(a, p[`${l}.qkv.w`], p[`${l}.qkv.b`], 3 * d);
    st.K[l].push(qkv.slice(d, 2 * d));
    st.Vv[l].push(qkv.slice(2 * d, 3 * d));
    const Ks = st.K[l], Vs = st.Vv[l], n = Ks.length;
    const att = new Float64Array(d);
    const s = new Float64Array(n);
    for (let h = 0; h < H; h++) {
      const o = h * hd;
      let mx = -Infinity;
      for (let j = 0; j < n; j++) {
        let dot = 0;
        for (let c = 0; c < hd; c++) dot += qkv[o + c] * Ks[j][o + c];
        s[j] = dot * scale;
        if (s[j] > mx) mx = s[j];
      }
      let z = 0;
      for (let j = 0; j < n; j++) { s[j] = Math.exp(s[j] - mx); z += s[j]; }
      for (let j = 0; j < n; j++) {
        const w = s[j] / z;
        for (let c = 0; c < hd; c++) att[o + c] += w * Vs[j][o + c];
      }
    }
    const proj = linear(att, p[`${l}.proj.w`], p[`${l}.proj.b`], d);
    for (let i = 0; i < d; i++) x[i] += proj[i];

    // MLP
    const mIn = layerNorm(x, p[`${l}.ln2.g`], p[`${l}.ln2.b`]);
    const hdn = linear(mIn, p[`${l}.fc.w`], p[`${l}.fc.b`], 4 * d);
    for (let i = 0; i < hdn.length; i++) if (hdn[i] < 0) hdn[i] = 0; // ReLU
    const out = linear(hdn, p[`${l}.out.w`], p[`${l}.out.b`], d);
    for (let i = 0; i < d; i++) x[i] += out[i];
  }
  st.pos++;

  const hf = layerNorm(x, p["lnf.g"], p["lnf.b"]);
  const logits = new Float64Array(V);
  for (let v = 0; v < V; v++) {
    let dot = 0;
    const row = v * d;
    for (let i = 0; i < d; i++) dot += hf[i] * p.wte[row + i];
    logits[v] = dot;
  }
  return logits;
}

// ─── Sampling ────────────────────────────────────────────────────────────────
function sample(logits, temperature, topK) {
  const sorted = Array.from(logits).sort((a, b) => b - a);
  const cut = sorted[Math.min(topK, sorted.length) - 1];
  const mx = sorted[0];
  const w = new Float64Array(logits.length);
  let total = 0;
  for (let i = 0; i < logits.length; i++) {
    if (logits[i] >= cut) { w[i] = Math.exp((logits[i] - mx) / temperature); total += w[i]; }
  }
  let r = Math.random() * total;
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r <= 0 && w[i] > 0) return i;
  }
  return logits.indexOf(mx);
}

function generate(name, prompt, { maxNew = 60, temperature = 0.8, topK = 40 } = {}) {
  const m = load(name);
  const ids = encode(name, prompt).slice(-(m.T - maxNew));
  const st = newState(m);
  let logits = null;
  for (const t of ids) logits = feed(m, st, t);
  const out = [];
  while (out.length < maxNew && st.pos < m.T) {
    const next = sample(logits, temperature, topK);
    out.push(next);
    if (m.newlineIds.has(next)) break;
    logits = feed(m, st, next);
  }
  return decode(name, out).split("\n")[0].trim();
}

// ─── Public ──────────────────────────────────────────────────────────────────
// One chat reply from the model called `name`.
function reply(name, message, opts = {}) {
  const m = load(name);
  const msg = message.split(/\s+/).filter(Boolean).join(" ").slice(0, m.info.max_line * 2);
  for (let i = 0; i < 4; i++) {           // retry if it comes out empty
    const out = generate(name, `User: ${msg}\nBot:`, opts);
    if (out) return out;
  }
  return "...";
}

function about(name) {
  const m = load(name);
  return { params: m.info.layout.reduce((n, l) => n + l.shape.reduce((a, b) => a * b, 1), 0), steps: m.info.steps };
}

module.exports = { list, reply, about, encode, decode, _test: { load, newState, feed } };
