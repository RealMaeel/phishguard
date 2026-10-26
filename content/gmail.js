// Gmail: when a message is opened, read the sender and links, score it, and show a banner.
// Gmail's DOM changes over time; the selectors below are the first thing to check if banners stop appearing.
(function () {
  const PG = globalThis.PhishGuard;
  const SEL = {
    message: "div.adn",          // an expanded message in a thread
    sender: "span.gD[email]",    // sender chip with email + name attributes
    body: "div.a3s",             // message body
    subject: "h2.hP"             // thread subject
  };

  function send(type, data) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, data }, (r) => resolve(chrome.runtime.lastError ? null : r));
      } catch (e) { resolve(null); } // extension reloaded
    });
  }

  function extract(msg) {
    const s = msg.querySelector(SEL.sender);
    const body = msg.querySelector(SEL.body);
    if (!s || !body) return null;
    const anchors = [...body.querySelectorAll("a[href]")].slice(0, 60);
    return {
      anchors,
      data: {
        displayName: s.getAttribute("name") || s.textContent || "",
        address: (s.getAttribute("email") || "").toLowerCase(),
        subject: (document.querySelector(SEL.subject) || {}).textContent || "",
        bodyText: (body.innerText || "").slice(0, 3000),
        links: anchors.map((a) => ({ href: a.href, text: (a.innerText || "").trim().slice(0, 200) }))
      }
    };
  }

  function reportHandlers(result, data, bannerEl) {
    const links = (data.links || []).map((l) => PG.domain.unwrapUrl(l.href));
    const payload = { result, displayName: data.displayName, address: data.address, subject: data.subject, links, where: "gmail" };
    const doReport = async () => {
      const r = await send("report", payload);
      PG.ui.lesson(result, { reported: true });
      if (r && !r.hasReportEmail) PG.ui.toast("No IT report address is set yet. Add one in PhishGuard's options.");
    };
    return {
      why: () => { send("log", { kind: "email", action: "opened_lesson", level: result.level, score: result.score }); PG.ui.lesson(result, { report: doReport }); },
      report: doReport,
      safe: async () => {
        await send("report", Object.assign({ falsePositive: true }, payload));
        if (bannerEl) bannerEl.remove();
        PG.ui.toast("Thanks. Your IT team will review this warning.");
      }
    };
  }

  function markLinks(anchors, result, data) {
    const risky = new Set(result.riskyLinks || []);
    if (!risky.size) return;
    for (const a of anchors) {
      const real = PG.domain.unwrapUrl(a.href);
      if (!risky.has(real) || a.dataset.pgMarked) continue;
      a.dataset.pgMarked = "1";
      a.style.outline = "2px solid #e0574c";
      a.style.borderRadius = "3px";
      a.title = "PhishGuard: check this link before opening it";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        send("log", { kind: "email", action: "clicked_risky_link", level: result.level, score: result.score });
        PG.ui.confirmLink(real, result, {
          why: () => PG.ui.lesson(result, reportHandlers(result, data)),
          open: () => {
            send("log", { kind: "email", action: "opened_risky_link_anyway", level: result.level, score: result.score });
            window.open(real, "_blank", "noopener");
          }
        });
      }, true);
    }
  }

  async function process(msg) {
    const ex = extract(msg);
    if (!ex) return;
    msg.dataset.pgDone = "1";
    const result = await send("analyzeEmail", ex.data);
    if (!result || result.error) return;
    if (result.level === "safe" && !result.showSafeBanner) return;
    if (!msg.isConnected) return;
    const holder = { el: null };
    const h = reportHandlers(result, ex.data, null);
    holder.el = PG.ui.banner(result, {
      why: h.why,
      report: h.report,
      safe: async (el) => { await reportHandlers(result, ex.data, el).safe(); }
    });
    msg.insertBefore(holder.el, msg.firstChild);
    markLinks(ex.anchors, result, ex.data);
  }

  let timer = null;
  function scan() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      document.querySelectorAll(SEL.message).forEach((m) => {
        if (!m.dataset.pgDone) process(m);
      });
    }, 400);
  }

  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
})();
