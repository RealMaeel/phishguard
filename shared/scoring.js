// Scoring engine. Pure functions: give it extracted features + lookup results, get back
// a score, a level, and explainable signals (each with a plain-language lesson).
(function (g) {
  const PG = (g.PhishGuard = g.PhishGuard || {});
  const D = () => PG.domain;
  const L = () => PG.lists;

  PG.defaultConfig = {
    orgNames: [],            // e.g. ["Acme", "Acme Corp"]
    orgDomains: [],          // e.g. ["acme.com"]
    trustedDomains: [],      // partners, vendors
    trustedLoginHosts: [],   // your SSO pages, e.g. "acme.okta.com"
    reportEmail: "",
    reportWebhook: "",
    thresholds: { caution: 30, danger: 60 },
    showSafeBanner: true,
    enableLookups: true,
    newDomainDays: 30,
    extraFreeHosts: [],
    weights: {}
  };

  const WEIGHTS = {
    // email
    brand_mismatch: 30, claimed_domain_has_mail: 20, claimed_domain_no_mail: 0, free_provider: 10,
    lookalike_sender: 40, address_in_name: 25, new_sender: 10, urgent_language: 10, trusted_sender: -30,
    link_text_mismatch: 25, link_free_host: 20, link_shortener: 10, link_lookalike: 40, link_new_domain: 25,
    // pages
    brand_login_off_domain: 40, org_login_off_domain: 40, org_on_free_host: 30, free_host: 20,
    form_posts_elsewhere: 25, new_domain: 25, lookalike_domain: 40, form_asks_password: 60,
    insecure_login: 15, ip_address_host: 20
  };

  PG.mergeConfig = function (...layers) {
    const out = JSON.parse(JSON.stringify(PG.defaultConfig));
    for (const layer of layers) {
      if (!layer || typeof layer !== "object") continue;
      for (const [k, v] of Object.entries(layer)) {
        if (v === undefined || v === null) continue;
        if ((k === "thresholds" || k === "weights") && typeof v === "object") out[k] = Object.assign({}, out[k], v);
        else out[k] = v;
      }
    }
    for (const k of ["orgDomains", "trustedDomains", "trustedLoginHosts", "extraFreeHosts"]) {
      out[k] = (out[k] || []).map((s) => String(s).toLowerCase().trim()).filter(Boolean);
    }
    return out;
  };

  function w(config, id) {
    return config.weights && Object.prototype.hasOwnProperty.call(config.weights, id) ? config.weights[id] : WEIGHTS[id];
  }

  function levelFor(score, config) {
    if (score >= config.thresholds.danger) return "danger";
    if (score >= config.thresholds.caution) return "caution";
    return "safe";
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function wordMatch(text, word) {
    word = String(word || "").toLowerCase().trim();
    if (!word) return false;
    return new RegExp("(^|[^a-z0-9])" + escapeRe(word) + "([^a-z0-9]|$)").test(text.toLowerCase());
  }

  // Which organizations/brands does this text claim to be?
  function claims(text, config) {
    const out = [];
    if (!text) return out;
    for (const name of config.orgNames || []) {
      if (wordMatch(text, name)) { out.push({ name, domains: config.orgDomains, org: true }); break; }
    }
    for (const b of L().brands) {
      if (b.keywords.some((k) => wordMatch(text, k))) out.push({ name: b.name, domains: b.domains, org: false, brand: b });
    }
    return out;
  }

  function freeHostLabel(url, config) {
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    const host = u.hostname.toLowerCase();
    for (const p of L().freeHostPaths) {
      if (host === p.host && u.pathname.startsWith(p.path)) return { label: p.label, isForm: !!p.isForm };
    }
    for (const [h, lbl] of Object.entries(L().freeHosts)) {
      if (host === h || host.endsWith("." + h)) return { label: lbl, isForm: false };
    }
    for (const h of config.extraFreeHosts || []) {
      if (host === h || host.endsWith("." + h)) return { label: h, isForm: false };
    }
    return null;
  }
  PG.freeHostLabel = freeHostLabel;

  function allBrandDomains() {
    return L().brands.flatMap((b) => b.domains);
  }

  function isTrustedHost(host, config) {
    return D().hostMatches(host, [...config.orgDomains, ...config.trustedDomains, ...config.trustedLoginHosts]);
  }

  function sig(id, config, fields) {
    return Object.assign({ id, points: w(config, id) }, fields);
  }

  const DISTRACTORS = [
    "It had a company logo",
    "It used formal, professional wording",
    "It arrived during business hours",
    "It had a signature block at the bottom"
  ];

  function finish(signals, config, extra) {
    const score = Math.max(0, signals.reduce((s, x) => s + (x.points || 0), 0));
    const level = levelFor(score, config);
    const ranked = signals.filter((s) => s.points > 0).sort((a, b) => b.points - a.points);
    const top = ranked[0];
    let quiz = null;
    if (top && top.clue) {
      const distract = DISTRACTORS.slice().sort(() => Math.random() - 0.5).slice(0, 2);
      const options = [top.clue, ...distract].sort(() => Math.random() - 0.5);
      quiz = {
        question: "Quick check: which detail gave it away?",
        options,
        answer: options.indexOf(top.clue),
        explanation: "Logos, signatures and polished wording are easy to copy. The real giveaway: " +
          top.clue.charAt(0).toLowerCase() + top.clue.slice(1) + "."
      };
    }
    return Object.assign({
      score, level, signals: ranked.concat(signals.filter((s) => s.points <= 0)),
      reasons: ranked.slice(0, 3).map((s) => s.title),
      takeaway: top ? top.takeaway : null,
      quiz,
      headline: level === "danger" ? "Likely phishing" : level === "caution" ? "Be careful with this one" : "No warning signs found"
    }, extra || {});
  }

  // ---------------------------------------------------------------- email

  function senderDomain(address) {
    return D().registrableDomain((String(address || "").split("@")[1] || "").trim());
  }

  function nameDomains(displayName) {
    const m = String(displayName || "").toLowerCase().match(/[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/g);
    return (m || []).map((d) => D().registrableDomain(d.includes("@") ? d.split("@")[1] : d));
  }

  function normLinks(links) {
    return (links || []).slice(0, 60).map((l) => {
      const href = D().unwrapUrl(l.href || "");
      return { href, text: (l.text || "").trim(), host: D().getHost(href) };
    }).filter((l) => /^https?:/i.test(l.href) && l.host);
  }

  // Which lookups the background should run before scoring.
  PG.emailLookups = function (input, config) {
    const sDom = senderDomain(input.address);
    const mx = new Set(), age = new Set();
    for (const c of claims(input.displayName, config)) {
      if (c.org && c.domains[0] && !c.domains.map(D().registrableDomain).includes(sDom)) mx.add(D().registrableDomain(c.domains[0]));
    }
    for (const d of nameDomains(input.displayName)) if (d && d !== sDom) mx.add(d);
    const skip = (host) =>
      isTrustedHost(host, config) || D().hostMatches(host, allBrandDomains()) || D().isIp(host) || D().isLocal(host) ||
      D().hostMatches(host, L().urlShorteners);
    if (sDom && !L().freeEmailProviders.includes(sDom) && !skip(sDom)) age.add(sDom);
    for (const l of normLinks(input.links)) {
      if (skip(l.host) || freeHostLabel(l.href, config)) continue;
      age.add(D().registrableDomain(l.host));
      if (age.size >= 10) break;
    }
    return { mx: [...mx], age: [...age] };
  };

  /**
   * input: { displayName, address, subject, bodyText, links:[{href,text}] }
   * ctx:   { mx: {domain: {hasMail}}, age: {domain: days|null}, newSender: bool }
   */
  PG.analyzeEmail = function (input, config, ctx) {
    ctx = ctx || {};
    const mxMap = ctx.mx || {}, ageMap = ctx.age || {};
    const signals = [];
    const name = String(input.displayName || "").trim();
    const address = String(input.address || "").trim().toLowerCase();
    const sDom = senderDomain(address);
    const trusted = isTrustedHost(sDom, config);
    const free = L().freeEmailProviders.includes(sDom);
    const senderEv = { kind: "sender", shown: name || address, actual: address, highlight: sDom };
    const senderTakeaway = "Ignore the name shown. Click or hover over the sender to see the real address before trusting the message.";

    if (trusted) {
      signals.push(sig("trusted_sender", config, { title: `Sent from a trusted domain (${sDom})`, detail: "Your IT team marked this domain as trusted." }));
    }

    // Claims to be an org/brand it isn't sent from.
    let claimed = null;
    for (const c of claims(name, config)) {
      const regs = (c.domains || []).map(D().registrableDomain);
      if (regs.includes(sDom)) continue;
      if (c.org && trusted) continue;
      claimed = c;
      const real = regs.length ? regs.slice(0, 2).join(" or ") : null;
      signals.push(sig("brand_mismatch", config, {
        title: `Claims to be ${c.name}, but was sent from ${sDom}`,
        detail: `The name shown is "${name}", but the real address is ${address}.` +
          (real ? ` Genuine ${c.name} email comes from ${real}.` : ` That isn't ${c.name}'s own email domain.`),
        evidence: senderEv,
        clue: "The sender's real address didn't match the name shown",
        takeaway: senderTakeaway
      }));
      break;
    }

    // Email address typed into the display name ("support@acme.com" <x@evil.com>)
    const addrInName = (name.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/) || [])[0];
    if (addrInName && addrInName !== address) {
      signals.push(sig("address_in_name", config, {
        title: `The name shows ${addrInName}, but it was really sent from ${address}`,
        detail: "Attackers put a trustworthy-looking address in the name field because most email apps show the name, not the address.",
        evidence: senderEv,
        clue: "A fake email address was written into the sender's name",
        takeaway: senderTakeaway
      }));
    }

    // MX weighting for the claimed domain.
    const mxDomains = [];
    if (claimed && claimed.org && claimed.domains[0]) mxDomains.push(D().registrableDomain(claimed.domains[0]));
    for (const d of nameDomains(name)) if (d && d !== sDom) mxDomains.push(d);
    for (const d of mxDomains) {
      const r = mxMap[d];
      if (!r) continue;
      if (r.hasMail) {
        signals.push(sig("claimed_domain_has_mail", config, {
          title: `${d} has its own email, so a real message wouldn't come from ${sDom}`,
          detail: `${d} receives email on its own servers, which means its staff normally write from @${d} addresses.`,
          clue: "The sender's real address didn't match the name shown",
          takeaway: senderTakeaway
        }));
      } else {
        signals.push(sig("claimed_domain_no_mail", config, {
          title: `${d} doesn't appear to use email, so a personal address is plausible`,
          detail: "Small organizations without company email often use personal accounts. Verify by phone if in doubt."
        }));
      }
      break;
    }

    if (free && !trusted) {
      signals.push(sig("free_provider", config, {
        title: `Sent from a free ${sDom} account`,
        detail: "Anyone can create a free email account with any name in about a minute.",
        evidence: senderEv,
        clue: "It came from a free personal email account",
        takeaway: "Businesses rarely send official requests or documents from free email accounts."
      }));
    }

    if (!trusted && !free) {
      const la = D().lookalikeOf(sDom, config.orgDomains, true) || D().lookalikeOf(sDom, allBrandDomains(), false);
      if (la) {
        signals.push(sig("lookalike_sender", config, {
          title: la.real ? `Sender domain ${sDom} imitates ${la.real}` : `Sender domain ${sDom} may disguise its letters`,
          detail: la.real ? `${sDom} is not ${la.real}. It ${la.reason}.` : `It ${la.reason}.`,
          evidence: { kind: "lookalike", fake: sDom, real: la.real },
          clue: "The sender's domain was a look-alike of the real one",
          takeaway: "Read domains letter by letter. Attackers swap \"m\" for \"rn\" or add words like \"-support\"."
        }));
      }
    }

    if (ctx.newSender && !trusted) {
      signals.push(sig("new_sender", config, {
        title: "First message from this sender",
        detail: "You haven't received email from this address before.",
        clue: "It was the first message from this sender",
        takeaway: "Be extra careful with first-time senders who ask you to click, sign in or pay."
      }));
    }

    const text = (String(input.subject || "") + " " + String(input.bodyText || "").slice(0, 3000)).toLowerCase();
    const phrase = L().urgentPhrases.find((p) => text.includes(p));
    if (phrase && !trusted) {
      signals.push(sig("urgent_language", config, {
        title: `Pressure language: "${phrase}"`,
        detail: "Phishing creates urgency so you act before you think.",
        clue: "It pushed you to act quickly",
        takeaway: "Urgency is a tactic. Verify through a channel you already trust, like a known phone number."
      }));
    }

    // Links: one signal per type, first example as evidence.
    const riskyLinks = new Set();
    const seen = {};
    const add = (id, href, fields) => {
      riskyLinks.add(href);
      if (seen[id]) return;
      seen[id] = true;
      signals.push(sig(id, config, fields));
    };
    for (const l of normLinks(input.links)) {
      const reg = D().registrableDomain(l.host);
      const fh = freeHostLabel(l.href, config);
      const textHost = (l.text.match(/^(https?:\/\/)?(www\.)?(([a-z0-9-]+\.)+[a-z]{2,})(\/\S*)?$/i) || [])[3];
      if (textHost && D().registrableDomain(textHost) !== reg) {
        add("link_text_mismatch", l.href, {
          title: `A link shows ${textHost} but really goes to ${l.host}`,
          detail: "The visible text of a link can say anything. Only the real destination matters.",
          evidence: { kind: "link", shown: l.text, actual: l.href, highlight: l.host },
          clue: "A link's visible text didn't match where it actually went",
          takeaway: "Hover over links (or long-press on mobile) to see the real destination before clicking."
        });
      }
      if (fh) {
        add("link_free_host", l.href, {
          title: `Links to a page on ${fh.label}, a free website builder`,
          detail: "Anyone can build a page there in minutes, including fake \"shared document\" and fake sign-in pages.",
          evidence: { kind: "url", url: l.href, highlight: l.host },
          clue: "A link pointed to a free website builder",
          takeaway: "Real companies don't share documents through free website builders."
        });
        continue;
      }
      if (isTrustedHost(l.host, config) || D().hostMatches(l.host, allBrandDomains())) continue;
      if (D().hostMatches(l.host, L().urlShorteners)) {
        add("link_shortener", l.href, {
          title: `A link uses a shortener (${l.host}) that hides its destination`,
          detail: "Shortened links hide where they really go.",
          evidence: { kind: "url", url: l.href, highlight: l.host },
          clue: "A link hid its real destination behind a shortener",
          takeaway: "Be wary of shortened links in work email; ask the sender for the full address."
        });
        continue;
      }
      const la = D().lookalikeOf(l.host, config.orgDomains, true) || D().lookalikeOf(l.host, allBrandDomains(), false);
      if (la) {
        add("link_lookalike", l.href, {
          title: la.real ? `A link goes to ${reg}, a look-alike of ${la.real}` : `A link goes to ${reg}, which may disguise its letters`,
          detail: la.real ? `${reg} is not ${la.real}. It ${la.reason}.` : `It ${la.reason}.`,
          evidence: { kind: "lookalike", fake: reg, real: la.real },
          clue: "A link went to a look-alike of a real website",
          takeaway: "Read domains letter by letter before clicking."
        });
      }
      const days = ageMap[reg];
      if (typeof days === "number" && days < config.newDomainDays) {
        add("link_new_domain", l.href, {
          title: `A link goes to ${reg}, registered ${days} day${days === 1 ? "" : "s"} ago`,
          detail: "Attackers register fresh domains for each campaign. Established businesses use domains that are years old.",
          evidence: { kind: "url", url: l.href, highlight: l.host },
          clue: "A link went to a brand-new website",
          takeaway: "Treat links to brand-new websites with suspicion, especially ones asking you to sign in."
        });
      }
    }

    const sAge = ageMap[sDom];
    if (typeof sAge === "number" && sAge < config.newDomainDays && !trusted) {
      signals.push(sig("new_domain", config, {
        title: `The sender's domain ${sDom} was registered ${sAge} day${sAge === 1 ? "" : "s"} ago`,
        detail: "Attackers register fresh domains for each campaign.",
        clue: "The sender's domain was brand new",
        takeaway: "Be suspicious of email from brand-new domains."
      }));
    }

    return finish(signals, config, { kind: "email", riskyLinks: [...riskyLinks] });
  };

  // ---------------------------------------------------------------- pages

  const OAUTH_BUTTONS = /(sign in|log in|login|sign up|continue|register)\s+with\s+(google|microsoft|apple|facebook|github)/gi;

  function pageBrands(input) {
    const strong = [input.title, input.headings, input.alts, input.formText].join(" ").replace(OAUTH_BUTTONS, " ");
    return L().brands.filter((b) => b.keywords.some((k) => wordMatch(strong, k)));
  }

  function isCredentialPage(input, config) {
    if (input.hasPasswordField) return true;
    const fh = freeHostLabel(input.url, config);
    return !!(fh && fh.isForm && /\b(password|passcode|passwort|contrase)/i.test(String(input.bodyText || "")));
  }
  PG.isCredentialPage = isCredentialPage;

  PG.pageLookups = function (input, config) {
    const host = D().getHost(input.url);
    if (!host || D().isIp(host) || D().isLocal(host) || isTrustedHost(host, config) ||
        D().hostMatches(host, allBrandDomains()) || freeHostLabel(input.url, config)) return { age: [] };
    if (!isCredentialPage(input, config)) return { age: [] };
    return { age: [D().registrableDomain(host)] };
  };

  /**
   * input: { url, hasPasswordField, title, headings, alts, formText, bodyText, formActions:[url] }
   * ctx:   { age: {domain: days|null} }
   */
  PG.analyzePage = function (input, config, ctx) {
    ctx = ctx || {};
    const signals = [];
    const url = input.url;
    const host = D().getHost(url);
    const reg = D().registrableDomain(host);
    const fh = freeHostLabel(url, config);
    const cred = isCredentialPage(input, config);

    if (!host) return finish([], config, { kind: "page", gated: true });
    const loginHosts = L().brands.flatMap((b) => b.loginHosts);
    if (isTrustedHost(host, config) || (!fh && D().hostMatches(host, loginHosts))) {
      return finish([], config, { kind: "page", trusted: true });
    }

    const urlEv = { kind: "url", url, highlight: host };
    const allText = [input.title, input.headings, input.bodyText].join(" ");
    const orgClaim = (config.orgNames || []).find((n) => wordMatch(allText, n));

    // Org name on a free site builder, even without a password field (the fake "document from us" page).
    if (orgClaim && fh) {
      signals.push(sig("org_on_free_host", config, {
        title: `Uses the name ${orgClaim} but is hosted on ${fh.label}`,
        detail: `Pages from ${orgClaim} wouldn't be built on a free website builder. Anyone can make a page like this in minutes.`,
        evidence: urlEv,
        clue: `It used ${orgClaim}'s name on a free website builder`,
        takeaway: "Check the address bar. If a page claims to be from a company but isn't on that company's website, don't trust it."
      }));
    }

    const la = D().lookalikeOf(host, config.orgDomains, true) || D().lookalikeOf(host, allBrandDomains(), false);
    if (la && !fh) {
      signals.push(sig("lookalike_domain", config, {
        title: la.real ? `${reg} is a look-alike of ${la.real}` : `${reg} may disguise its letters`,
        detail: la.real ? `This site is not ${la.real}. Its address ${la.reason}.` : `Its address ${la.reason}.`,
        evidence: { kind: "lookalike", fake: reg, real: la.real },
        clue: "The website's address was a look-alike of the real one",
        takeaway: "Read the address bar letter by letter before entering anything."
      }));
    }

    if (cred) {
      for (const b of pageBrands(input)) {
        if (D().hostMatches(host, b.domains) && !fh) continue;
        signals.push(sig("brand_login_off_domain", config, {
          title: `A ${b.name} sign-in page that isn't on ${b.name}'s website`,
          detail: `This page asks for your ${b.name} password, but it's hosted on ${host}. The real ${b.name} sign-in is at ${b.loginHosts[0]}.`,
          evidence: Object.assign({ expected: b.loginHosts[0] }, urlEv),
          clue: `The ${b.name} sign-in page wasn't on ${b.loginHosts[0]}`,
          takeaway: `Before typing your ${b.name} password, check that the address bar says ${b.loginHosts[0]}.`
        }));
        break;
      }

      if (orgClaim && !fh) {
        signals.push(sig("org_login_off_domain", config, {
          title: `Asks for a password using ${orgClaim}'s name, but isn't on ${orgClaim}'s website`,
          detail: `This page is on ${host}, which isn't one of ${orgClaim}'s domains or sign-in pages.`,
          evidence: urlEv,
          clue: `It used ${orgClaim}'s name on a website that isn't ${orgClaim}'s`,
          takeaway: "Only sign in on pages whose address you recognize as your organization's."
        }));
      }

      if (fh && fh.isForm) {
        signals.push(sig("form_asks_password", config, {
          title: `A ${fh.label} page asking for a password`,
          detail: `Legitimate services never collect passwords through ${fh.label}. Only the real sign-in page should ever ask.`,
          evidence: urlEv,
          clue: "An online form asked for a password",
          takeaway: "Never type a password into a survey or form, no matter who it says it's from."
        }));
      } else if (fh) {
        signals.push(sig("free_host", config, {
          title: `Hosted on ${fh.label}, a free website builder`,
          detail: "Anyone can build a sign-in page there in minutes. Real companies don't host their sign-in pages on free builders.",
          evidence: urlEv,
          clue: "The sign-in page was on a free website builder",
          takeaway: "Real sign-in pages live on the company's own website."
        }));
      }

      for (const a of input.formActions || []) {
        const ah = D().getHost(a);
        if (!ah || D().registrableDomain(ah) === reg) continue;
        if (D().hostMatches(ah, allBrandDomains()) || isTrustedHost(ah, config)) continue;
        signals.push(sig("form_posts_elsewhere", config, {
          title: `Your password would be sent to ${D().registrableDomain(ah)}, not ${reg}`,
          detail: "The form on this page sends what you type to a different website.",
          evidence: { kind: "link", shown: url, actual: a, highlight: ah },
          clue: "The form sent passwords to a different website",
          takeaway: "Fake sign-in pages often quietly send what you type to the attacker's server."
        }));
        break;
      }

      if (/^http:/i.test(url) && !D().isLocal(host)) {
        signals.push(sig("insecure_login", config, {
          title: "Asks for a password over an unencrypted connection",
          detail: "This page isn't using https, so anything you type can be intercepted.",
          evidence: urlEv,
          clue: "The page wasn't using a secure (https) connection",
          takeaway: "Never enter a password on a page that doesn't use https."
        }));
      }

      if (D().isIp(host) && !D().isLocal(host)) {
        signals.push(sig("ip_address_host", config, {
          title: "The address is a raw IP number instead of a website name",
          detail: "Real sign-in pages use a named website, not a string of numbers.",
          evidence: urlEv,
          clue: "The address was a string of numbers, not a website name",
          takeaway: "Don't sign in on pages whose address is just numbers."
        }));
      }

      const days = (ctx.age || {})[reg];
      if (typeof days === "number" && days < config.newDomainDays) {
        signals.push(sig("new_domain", config, {
          title: `This website was registered ${days} day${days === 1 ? "" : "s"} ago`,
          detail: "Attackers register fresh domains for each campaign. Real sign-in pages are on domains that are years old.",
          evidence: urlEv,
          clue: "The website was brand new",
          takeaway: "Be suspicious of sign-in pages on brand-new websites."
        }));
      }
    }

    return finish(signals, config, { kind: "page", credentialPage: cred, url });
  };
})(globalThis);
