// Web pages: look for sign-in forms and impersonation, score the page, warn if needed.
(function () {
  if (window.top !== window) return;
  if (!/^https?:$/.test(location.protocol)) return;
  const PG = globalThis.PhishGuard;
  const DISMISS_KEY = "phishguard-dismissed:" + location.host;

  function send(type, data) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, data }, (r) => resolve(chrome.runtime.lastError ? null : r));
      } catch (e) { resolve(null); }
    });
  }

  function text(el, n) { return ((el && el.innerText) || "").replace(/\s+/g, " ").slice(0, n); }

  function collect() {
    const pw = document.querySelector('input[type="password"]');
    const formEl = pw ? (pw.closest("form") || pw.parentElement?.parentElement?.parentElement) : null;
    const forms = [...document.querySelectorAll("form")].filter((f) => f.querySelector('input[type="password"]'));
    return {
      url: location.href,
      hasPasswordField: !!pw,
      title: document.title || "",
      headings: [...document.querySelectorAll("h1,h2,h3")].slice(0, 10).map((h) => text(h, 120)).join(" | "),
      alts: [...document.images].slice(0, 40).map((i) => (i.alt || "") + " " + (i.getAttribute("src") || "").split("/").pop().split("?")[0]).join(" "),
      formText: text(formEl, 1500),
      bodyText: text(document.body, 3000),
      formActions: forms.map((f) => (f.getAttribute("action") ? f.action : "")).filter(Boolean)
    };
  }

  function dismissed() {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch (e) { return false; }
  }

  let shown = null;
  let lastKey = "";

  function handlers(result) {
    const payload = { result, url: location.href, where: location.host };
    const doReport = async () => {
      const r = await send("report", payload);
      PG.ui.lesson(result, { reported: true });
      if (r && !r.hasReportEmail) PG.ui.toast("No IT report address is set yet. Add one in PhishGuard's options.");
    };
    return {
      why: () => { send("log", { kind: "page", action: "opened_lesson", level: result.level, score: result.score, where: location.host }); PG.ui.lesson(result, { report: doReport }); },
      report: doReport,
      safe: async (el) => {
        await send("report", Object.assign({ falsePositive: true }, payload));
        if (el) el.remove();
        PG.ui.toast("Thanks. Your IT team will review this warning.");
      },
      leave: () => {
        send("log", { kind: "page", action: "left_page", level: result.level, score: result.score, where: location.host });
        if (history.length > 1) history.back(); else location.href = "about:blank";
      },
      continue: (el) => {
        send("log", { kind: "page", action: "continued_anyway", level: result.level, score: result.score, where: location.host });
        try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch (e) {}
        el.remove();
      }
    };
  }

  async function check() {
    if (dismissed()) return;
    const data = collect();
    const key = data.url + "|" + data.hasPasswordField;
    if (key === lastKey) return;
    lastKey = key;
    const result = await send("analyzePage", data);
    if (!result || result.error || result.level === "safe") return;
    if (shown) shown.remove();
    const h = handlers(result);
    if (result.level === "danger" && result.credentialPage) {
      shown = PG.ui.interstitial(result, h);
    } else {
      shown = PG.ui.banner(result, Object.assign({ fixedTop: true }, h));
      document.documentElement.appendChild(shown);
    }
  }

  check();
  // Phishing kits often show the password box after a delay or a first "email" step; watch for 30s.
  let t = null;
  const obs = new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (document.querySelector('input[type="password"]') && !lastKey.endsWith("|true")) check();
    }, 500);
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => obs.disconnect(), 30000);
  // Single-page apps change the URL without reloading.
  let lastUrl = location.href;
  setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; check(); } }, 1500);
})();
