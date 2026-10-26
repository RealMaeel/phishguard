// Domain helpers: registrable domain, matching, look-alike detection.
(function (g) {
  const PG = (g.PhishGuard = g.PhishGuard || {});

  // Common two-part public suffixes. A full Public Suffix List is a v2 improvement.
  const MULTI = new Set([
    "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk", "com.au", "net.au", "org.au",
    "edu.au", "gov.au", "co.nz", "org.nz", "co.jp", "ne.jp", "or.jp", "co.in", "net.in", "org.in",
    "com.br", "com.mx", "com.ar", "com.cn", "com.tw", "com.hk", "com.sg", "com.my", "co.za", "co.kr",
    "com.tr", "com.pl", "co.il", "com.ph", "com.vn", "com.ua", "com.co", "com.pe", "com.ng"
  ]);

  function getHost(url) {
    try { return new URL(url).hostname.toLowerCase().replace(/\.$/, ""); } catch (e) { return ""; }
  }

  function isIp(host) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[");
  }

  function isLocal(host) {
    return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".test") || /^127\./.test(host) || host === "[::1]";
  }

  function registrableDomain(host) {
    host = (host || "").toLowerCase().replace(/\.$/, "");
    if (!host || isIp(host) || !host.includes(".")) return host;
    const parts = host.split(".");
    const last2 = parts.slice(-2).join(".");
    if (MULTI.has(last2) && parts.length >= 3) return parts.slice(-3).join(".");
    return last2;
  }

  function label(domain) {
    return registrableDomain(domain).split(".")[0] || "";
  }

  function hostMatches(host, list) {
    host = (host || "").toLowerCase();
    return (list || []).some((d) => {
      d = String(d || "").toLowerCase().trim();
      return d && (host === d || host.endsWith("." + d));
    });
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  // Collapse characters attackers swap for look-alikes.
  function skeleton(s) {
    return s.toLowerCase()
      .replace(/rn/g, "m").replace(/vv/g, "w").replace(/cl/g, "d")
      .replace(/0/g, "o").replace(/[1il|]/g, "l").replace(/3/g, "e").replace(/5/g, "s").replace(/\$/g, "s")
      .replace(/[-_.]/g, "");
  }

  const BAIT_WORDS = /(login|signin|secure|verify|account|support|help|docs|drive|mail|billing|portal|update|auth|share|office)/;

  /**
   * Is `domain` imitating one of `protectedDomains`?
   * strict = true for the organization's own domains (also flags same name on another ending,
   * and any domain that contains the name). Brands are checked more loosely to avoid noise.
   */
  function lookalikeOf(domain, protectedDomains, strict) {
    const reg = registrableDomain(domain);
    if (!reg || isIp(reg)) return null;
    const regs = (protectedDomains || []).map(registrableDomain).filter(Boolean);
    if (regs.includes(reg)) return null;
    const lab = reg.split(".")[0];

    for (const preg of regs) {
      const pl = preg.split(".")[0];
      if (pl.length < 4) continue;
      if (strict && lab === pl) return { real: preg, reason: "uses the same name with a different ending" };
      if (lab !== pl && skeleton(lab) === skeleton(pl)) return { real: preg, reason: "swaps in look-alike characters" };
      const maxEdits = pl.length >= 8 ? 2 : 1;
      if (pl.length >= 6 || strict) {
        if (lab !== pl && levenshtein(lab, pl) <= maxEdits) return { real: preg, reason: "changes one or two letters" };
      }
      if (lab !== pl && lab.includes(pl)) {
        const extra = lab.replace(pl, "");
        if (strict || lab.includes("-") || BAIT_WORDS.test(extra)) {
          return { real: preg, reason: "adds extra words to the real name" };
        }
      }
    }
    if (lab.startsWith("xn--")) return { real: null, reason: "uses international characters that can disguise letters" };
    return null;
  }

  // Gmail and others wrap links in redirects; return the real destination.
  function unwrapUrl(href) {
    try {
      const u = new URL(href);
      const h = u.hostname;
      if ((h === "www.google.com" || h === "google.com") && u.pathname === "/url") {
        return u.searchParams.get("q") || u.searchParams.get("url") || href;
      }
      if (h.endsWith("safelinks.protection.outlook.com")) return u.searchParams.get("url") || href;
      return href;
    } catch (e) {
      return href;
    }
  }

  PG.domain = { getHost, isIp, isLocal, registrableDomain, label, hostMatches, levenshtein, skeleton, lookalikeOf, unwrapUrl };
})(globalThis);
