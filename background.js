// Service worker: config, DNS/RDAP lookups with caching, scoring, reporting, local event log.
importScripts("shared/lists.js", "shared/domain.js", "shared/scoring.js");
const PG = self.PhishGuard;

const DAY = 24 * 60 * 60 * 1000;
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const NEW_SENDER_WINDOW = DAY;

// ---------------------------------------------------------------- config

async function getConfig() {
  const { localConfig } = await chrome.storage.local.get("localConfig");
  let managed = {};
  try { managed = (await chrome.storage.managed.get(null)) || {}; } catch (e) { /* not managed */ }
  return PG.mergeConfig(localConfig || {}, managed);
}

// ---------------------------------------------------------------- lookups

const mem = new Map();

async function cached(key, fn) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL) return hit.v;
  const stored = (await chrome.storage.local.get(key))[key];
  if (stored && Date.now() - stored.t < CACHE_TTL) { mem.set(key, stored); return stored.v; }
  let v = null;
  try { v = await fn(); } catch (e) { v = null; }
  const rec = { t: Date.now(), v };
  mem.set(key, rec);
  if (v !== null) await chrome.storage.local.set({ [key]: rec });
  return v;
}

async function fetchJson(url, accept) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { Accept: accept || "application/json" }, credentials: "omit" });
    if (res.status === 404) return { notFound: true };
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// MX via DNS-over-HTTPS. A "null MX" (0 .) means the domain explicitly accepts no mail.
function lookupMx(domain) {
  return cached("mx:" + domain, async () => {
    const j = await fetchJson("https://dns.google/resolve?type=MX&name=" + encodeURIComponent(domain), "application/dns-json");
    const answers = (j.Answer || []).filter((a) => a.type === 15).map((a) => String(a.data).trim());
    const nullMx = answers.length === 1 && /^0\s+\.$/.test(answers[0]);
    return { hasMail: answers.length > 0 && !nullMx, exists: j.Status !== 3 };
  });
}

// Domain age via RDAP (the HTTPS/JSON replacement for WHOIS). Returns age in days or null.
function lookupAge(domain) {
  return cached("age:" + domain, async () => {
    const j = await fetchJson("https://rdap.org/domain/" + encodeURIComponent(domain), "application/rdap+json");
    if (j.notFound) return null;
    const ev = (j.events || []).find((e) => e.eventAction === "registration");
    if (!ev || !ev.eventDate) return null;
    return Math.max(0, Math.floor((Date.now() - Date.parse(ev.eventDate)) / DAY));
  });
}

async function runLookups(plan, config) {
  const mx = {}, age = {};
  if (!config.enableLookups) return { mx, age };
  await Promise.all([
    ...(plan.mx || []).map(async (d) => { const r = await lookupMx(d); if (r) mx[d] = r; }),
    ...(plan.age || []).map(async (d) => { age[d] = await lookupAge(d); })
  ]);
  return { mx, age };
}

// ---------------------------------------------------------------- sender history (hashed, local only)

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function isNewSender(address) {
  if (!address) return false;
  const h = (await sha256(address.toLowerCase())).slice(0, 32);
  const { seenSenders = {} } = await chrome.storage.local.get("seenSenders");
  const first = seenSenders[h];
  if (!first) {
    seenSenders[h] = Date.now();
    const keys = Object.keys(seenSenders);
    if (keys.length > 5000) {
      keys.sort((a, b) => seenSenders[a] - seenSenders[b]).slice(0, keys.length - 5000).forEach((k) => delete seenSenders[k]);
    }
    await chrome.storage.local.set({ seenSenders });
    return true;
  }
  return Date.now() - first < NEW_SENDER_WINDOW;
}

// ---------------------------------------------------------------- event log (local, no email contents)

async function logEvent(ev) {
  const { eventLog = [] } = await chrome.storage.local.get("eventLog");
  eventLog.unshift(Object.assign({ t: Date.now() }, ev));
  await chrome.storage.local.set({ eventLog: eventLog.slice(0, 200) });
}

// ---------------------------------------------------------------- reporting

function reportBody(p) {
  const r = p.result || {};
  const lines = [
    p.falsePositive ? "PhishGuard: user thinks this warning is wrong (possible false positive)" : "PhishGuard report: suspicious " + (r.kind === "email" ? "email" : "website"),
    "",
    `Score: ${r.score} (${r.level})`,
    `Time: ${new Date().toString()}`
  ];
  if (r.kind === "email") {
    lines.push(`Sender: "${p.displayName || ""}" <${p.address || ""}>`, `Subject: ${p.subject || ""}`);
  } else {
    lines.push(`Page: ${r.url || p.url || ""}`);
  }
  lines.push("", "Signals:");
  for (const s of r.signals || []) lines.push(`  ${s.points > 0 ? "+" : ""}${s.points}  ${s.title}`);
  if (p.links && p.links.length) {
    lines.push("", "Links in the email:");
    p.links.slice(0, 15).forEach((l) => lines.push("  " + l));
  }
  lines.push("", "(Sent from the PhishGuard browser extension. Add any notes above this line.)");
  return lines.join("\n");
}

async function report(p) {
  const config = await getConfig();
  const r = p.result || {};
  const subject = (p.falsePositive ? "[PhishGuard] Possible false positive: " : "[PhishGuard] Reported ") +
    (r.kind === "email" ? (p.address || "email") : (PG.domain.getHost(r.url || p.url || "") || "website"));
  let body = reportBody(p);
  if (body.length > 1800) body = body.slice(0, 1800) + "\n…(truncated)";

  if (config.reportWebhook) {
    fetch(config.reportWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body, result: r, falsePositive: !!p.falsePositive, kind: r.kind })
    }).catch(() => {});
  }

  const url = "https://mail.google.com/mail/?view=cm&fs=1" +
    "&to=" + encodeURIComponent(config.reportEmail || "") +
    "&su=" + encodeURIComponent(subject) +
    "&body=" + encodeURIComponent(body);
  await chrome.tabs.create({ url });
  await logEvent({ kind: r.kind, action: p.falsePositive ? "feedback_safe" : "reported", level: r.level, score: r.score, where: p.where || "" });
  return { ok: true, hasReportEmail: !!config.reportEmail };
}

// ---------------------------------------------------------------- messages

async function handle(msg) {
  switch (msg.type) {
    case "analyzeEmail": {
      const config = await getConfig();
      const plan = PG.emailLookups(msg.data, config);
      const [lk, newSender] = await Promise.all([runLookups(plan, config), isNewSender(msg.data.address)]);
      const result = PG.analyzeEmail(msg.data, config, Object.assign(lk, { newSender }));
      result.showSafeBanner = config.showSafeBanner;
      if (result.level !== "safe") {
        await logEvent({ kind: "email", action: "warned", level: result.level, score: result.score, where: PG.domain.registrableDomain((msg.data.address || "").split("@")[1] || "") });
      }
      return result;
    }
    case "analyzePage": {
      const config = await getConfig();
      const lk = await runLookups(PG.pageLookups(msg.data, config), config);
      const result = PG.analyzePage(msg.data, config, lk);
      if (result.level !== "safe") {
        await logEvent({ kind: "page", action: "warned", level: result.level, score: result.score, where: PG.domain.getHost(msg.data.url) });
      }
      return result;
    }
    case "report":
      return report(msg.data);
    case "log":
      await logEvent(msg.data);
      return { ok: true };
    case "getConfig":
      return getConfig();
    case "clearCache": {
      const all = await chrome.storage.local.get(null);
      const keys = Object.keys(all).filter((k) => k.startsWith("mx:") || k.startsWith("age:"));
      await chrome.storage.local.remove(keys.concat(["seenSenders", "eventLog"]));
      mem.clear();
      return { ok: true, removed: keys.length };
    }
    default:
      return { error: "unknown message" };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg).then(sendResponse, (e) => sendResponse({ error: String(e) }));
  return true; // async response
});

// Prune expired lookup cache entries on startup.
chrome.runtime.onStartup.addListener(async () => {
  const all = await chrome.storage.local.get(null);
  const stale = Object.keys(all).filter((k) => (k.startsWith("mx:") || k.startsWith("age:")) && Date.now() - all[k].t > CACHE_TTL);
  if (stale.length) await chrome.storage.local.remove(stale);
});
