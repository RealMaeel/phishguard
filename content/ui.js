// UI components rendered inside shadow DOM so host pages (including Gmail) can't restyle them.
(function (g) {
  const PG = (g.PhishGuard = g.PhishGuard || {});

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .banner { border: 1px solid; border-radius: 10px; padding: 10px 14px; margin: 6px 0 12px; font-size: 13.5px; line-height: 1.45;
            display: flex; gap: 12px; align-items: flex-start; }
  .safe    { background: #eef7ef; border-color: #b9dcbc; color: #1d4d22; }
  .caution { background: #fff7e0; border-color: #f0cf6b; color: #5c4300; }
  .danger  { background: #fdeceb; border-color: #f0aaa5; color: #7a1a12; }
  .icon { font-size: 18px; line-height: 1.2; flex: none; }
  .main { flex: 1; min-width: 0; }
  .title { font-weight: 650; margin-bottom: 2px; }
  ul { margin: 4px 0 6px 18px; padding: 0; }
  li { margin: 1px 0; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  button { font: inherit; font-size: 12.5px; font-weight: 600; border-radius: 6px; padding: 5px 10px; cursor: pointer;
           border: 1px solid rgba(0,0,0,.18); background: #fff; color: #1f1f1f; }
  button:hover { background: #f3f3f3; }
  button.primary { background: #1f1f1f; color: #fff; border-color: #1f1f1f; }
  button.primary:hover { background: #3a3a3a; }
  button.link { border: none; background: none; text-decoration: underline; padding: 5px 4px; color: inherit; font-weight: 500; }
  .score { font-weight: 500; opacity: .75; font-size: 12px; }

  .overlay { position: fixed; inset: 0; z-index: 2147483646; background: rgba(20,20,20,.55); display: flex;
             align-items: center; justify-content: center; padding: 16px; }
  .card { background: #fff; color: #1f1f1f; border-radius: 14px; max-width: 560px; width: 100%; max-height: 90vh; overflow: auto;
          box-shadow: 0 20px 60px rgba(0,0,0,.35); padding: 22px 24px; font-size: 14px; line-height: 1.5; }
  .stop { border-top: 6px solid #c62828; }
  .card h2 { font-size: 20px; margin: 0 0 6px; }
  .card h3 { font-size: 14px; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: .04em; color: #555; }
  .sig { border: 1px solid #e6e6e6; border-radius: 10px; padding: 10px 12px; margin: 8px 0; }
  .sig .t { font-weight: 650; }
  .sig .d { color: #444; margin-top: 2px; }
  .ev { margin-top: 8px; background: #f7f7f7; border-radius: 8px; padding: 8px 10px; font-size: 13px; }
  .row { display: flex; gap: 10px; margin: 2px 0; }
  .lbl { flex: none; width: 110px; color: #666; }
  .val { min-width: 0; word-break: break-all; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  mark { background: #ffd6d2; color: #8a1c14; border-radius: 3px; padding: 0 2px; font-weight: 700; }
  .ok { background: #d9f2dc; color: #1d4d22; border-radius: 3px; padding: 0 2px; font-weight: 700; }
  .takeaway { background: #eef4ff; border: 1px solid #c9dafc; border-radius: 10px; padding: 10px 12px; margin-top: 12px; }
  .quiz button { display: block; width: 100%; text-align: left; margin: 6px 0; font-weight: 500; }
  .quiz button.right { background: #d9f2dc; border-color: #8cc794; }
  .quiz button.wrong { background: #fde2df; border-color: #ee9c94; }
  .fb { margin-top: 6px; font-size: 13.5px; }
  .foot { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-top: 16px; }
  .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 2147483647; background: #1f1f1f; color: #fff;
           padding: 10px 16px; border-radius: 8px; font-size: 13.5px; box-shadow: 0 6px 20px rgba(0,0,0,.3); }
  .topbar { position: fixed; top: 0; left: 0; right: 0; z-index: 2147483645; margin: 0; border-radius: 0; border-width: 0 0 1px; }
  `;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function hl(text, part) {
    text = String(text || "");
    const i = part ? text.toLowerCase().indexOf(String(part).toLowerCase()) : -1;
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + part.length)) + "</mark>" + esc(text.slice(i + part.length));
  }

  function host(attachTo, cls) {
    const el = document.createElement("div");
    el.className = "phishguard-host" + (cls ? " " + cls : "");
    const root = el.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS}</style>`;
    if (attachTo) attachTo.appendChild(el);
    return { el, root };
  }

  const ICON = { safe: "✅", caution: "⚠️", danger: "🛑" };

  function evidenceHtml(e) {
    if (!e) return "";
    switch (e.kind) {
      case "sender":
        return `<div class="ev"><div class="row"><span class="lbl">Name shown</span><span class="val">${esc(e.shown)}</span></div>
                <div class="row"><span class="lbl">Real address</span><span class="val mono">${hl(e.actual, e.highlight)}</span></div></div>`;
      case "lookalike":
        return `<div class="ev"><div class="row"><span class="lbl">This one</span><span class="val mono"><mark>${esc(e.fake)}</mark></span></div>` +
          (e.real ? `<div class="row"><span class="lbl">The real one</span><span class="val mono"><span class="ok">${esc(e.real)}</span></span></div>` : "") + `</div>`;
      case "link":
        return `<div class="ev"><div class="row"><span class="lbl">Looks like</span><span class="val mono">${esc(e.shown)}</span></div>
                <div class="row"><span class="lbl">Really goes to</span><span class="val mono">${hl(e.actual, e.highlight)}</span></div></div>`;
      case "url":
        return `<div class="ev"><div class="row"><span class="lbl">Address</span><span class="val mono">${hl(e.url, e.highlight)}</span></div>` +
          (e.expected ? `<div class="row"><span class="lbl">Real sign-in</span><span class="val mono"><span class="ok">${esc(e.expected)}</span></span></div>` : "") + `</div>`;
      default:
        return "";
    }
  }

  function toast(text) {
    const { el, root } = host(document.documentElement);
    root.innerHTML += `<div class="toast">${esc(text)}</div>`;
    setTimeout(() => el.remove(), 4000);
  }

  /** Banner for Gmail messages and caution-level pages. */
  function banner(result, h) {
    const { el, root } = host(null, h.fixedTop ? "pg-topbar" : "");
    const lvl = result.level;
    const reasons = (result.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("");
    root.innerHTML += `
      <div class="banner ${lvl} ${h.fixedTop ? "topbar" : ""}" role="${lvl === "safe" ? "status" : "alert"}">
        <div class="icon">${ICON[lvl]}</div>
        <div class="main">
          <div class="title">PhishGuard: ${esc(result.headline)} <span class="score">· score ${result.score}</span></div>
          ${reasons ? `<ul>${reasons}</ul>` : ""}
          ${lvl === "safe" ? "" : `<div class="actions">
            <button class="primary" data-a="why">Show me why</button>
            <button data-a="report">Report to IT</button>
            <button class="link" data-a="safe">I think this is safe</button>
            ${h.fixedTop ? `<button class="link" data-a="close">Dismiss</button>` : ""}
          </div>`}
        </div>
      </div>`;
    root.addEventListener("click", (e) => {
      const a = e.target.closest("[data-a]");
      if (!a) return;
      const act = a.getAttribute("data-a");
      if (act === "close") el.remove();
      else if (h[act]) h[act](el);
    });
    return el;
  }

  /** Full-page stop screen for dangerous sign-in pages. */
  function interstitial(result, h) {
    const { el, root } = host(document.documentElement);
    const reasons = (result.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("");
    root.innerHTML += `
      <div class="overlay"><div class="card stop" role="alertdialog" aria-modal="true">
        <h2>🛑 Stop. This looks like a fake sign-in page.</h2>
        <div>PhishGuard found warning signs that this page is trying to steal your password.</div>
        <ul>${reasons}</ul>
        <div class="foot" style="justify-content:flex-start">
          <button class="primary" data-a="leave">Get me out of here</button>
          <button data-a="why">Show me why</button>
          <button data-a="report">Report to IT</button>
        </div>
        <div class="foot" style="justify-content:flex-start;margin-top:6px">
          <button class="link" data-a="safe">I think this is safe</button>
          <button class="link" data-a="continue">I understand the risk, continue</button>
        </div>
      </div></div>`;
    root.addEventListener("click", (e) => {
      const a = e.target.closest("[data-a]");
      if (!a) return;
      const act = a.getAttribute("data-a");
      if (h[act]) h[act](el);
    });
    return el;
  }

  /** The training view: real evidence, one takeaway, one quick question. */
  function lesson(result, h) {
    const { el, root } = host(document.documentElement);
    const sigs = (result.signals || []).filter((s) => s.points > 0);
    const intro = h.reported
      ? "Thanks for reporting it. Here's what made it suspicious, so you can spot the next one yourself."
      : "Here's exactly what made this suspicious, using the real details from this " + (result.kind === "email" ? "email" : "page") + ".";
    const quiz = result.quiz;
    root.innerHTML += `
      <div class="overlay"><div class="card" role="dialog" aria-modal="true">
        <h2>${h.reported ? "Nice catch" : "How to spot this"}</h2>
        <div>${esc(intro)}</div>
        <h3>What gave it away</h3>
        ${sigs.map((s) => `<div class="sig"><div class="t">${esc(s.title)}</div><div class="d">${esc(s.detail || "")}</div>${evidenceHtml(s.evidence)}</div>`).join("")}
        ${result.takeaway ? `<div class="takeaway"><b>Remember next time:</b> ${esc(result.takeaway)}</div>` : ""}
        ${quiz ? `<div class="quiz"><h3>${esc(quiz.question)}</h3>
            ${quiz.options.map((o, i) => `<button data-q="${i}">${esc(o)}</button>`).join("")}
            <div class="fb" hidden></div></div>` : ""}
        <div class="foot">
          ${h.reported || !h.report ? "" : `<button data-a="report">Report to IT</button>`}
          <button class="primary" data-a="close">Got it</button>
        </div>
      </div></div>`;
    let answered = false;
    root.addEventListener("click", (e) => {
      const q = e.target.closest("[data-q]");
      if (q && quiz && !answered) {
        answered = true;
        const i = Number(q.getAttribute("data-q"));
        const btns = root.querySelectorAll("[data-q]");
        btns[quiz.answer].classList.add("right");
        if (i !== quiz.answer) q.classList.add("wrong");
        const fb = root.querySelector(".fb");
        fb.hidden = false;
        fb.textContent = (i === quiz.answer ? "Exactly. " : "Not quite. ") + quiz.explanation;
        if (h.answered) h.answered(i === quiz.answer);
        return;
      }
      const a = e.target.closest("[data-a]");
      if (!a) return;
      const act = a.getAttribute("data-a");
      if (act === "close") el.remove();
      else if (h[act]) { el.remove(); h[act](); }
    });
    root.querySelector(".overlay").addEventListener("click", (e) => { if (e.target === e.currentTarget) el.remove(); });
    return el;
  }

  /** Confirmation when clicking a risky link inside an email. */
  function confirmLink(href, result, h) {
    const { el, root } = host(document.documentElement);
    const sigs = (result.signals || []).filter((s) => s.points > 0 && s.evidence &&
      (s.evidence.actual === href || s.evidence.url === href || (s.id || "").startsWith("link_")));
    root.innerHTML += `
      <div class="overlay"><div class="card stop" role="alertdialog" aria-modal="true">
        <h2>⚠️ Check this link before you open it</h2>
        <div class="ev"><div class="row"><span class="lbl">Goes to</span><span class="val mono">${esc(href)}</span></div></div>
        <ul>${sigs.slice(0, 3).map((s) => `<li>${esc(s.title)}</li>`).join("")}</ul>
        <div class="foot" style="justify-content:flex-start">
          <button class="primary" data-a="cancel">Don't open it</button>
          <button data-a="why">Show me why</button>
          <button class="link" data-a="open">Open anyway</button>
        </div>
      </div></div>`;
    root.addEventListener("click", (e) => {
      const a = e.target.closest("[data-a]");
      if (!a) return;
      const act = a.getAttribute("data-a");
      el.remove();
      if (h[act]) h[act]();
    });
  }

  PG.ui = { banner, interstitial, lesson, confirmLink, toast, esc };
})(globalThis);
