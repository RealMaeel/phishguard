# PhishGuard

A lightweight, open-source Chrome extension that helps IT administrators protect Gmail users from spoofed email and fake sign-in pages, and teaches users how to spot them.

> **Status:** prototype (v0.1). Works end to end; expect rough edges, especially as Gmail's page structure changes.
>
> Created by Ed Walker. Developed with AI assistance (Claude, by Anthropic).

## Why

Organizations on Google Workspace still see phishing reach users. Two common patterns slip through:

1. **Display-name spoofing.** An email *named* "Acme Documents" is actually sent from `acme.docs.share@gmail.com`. Gmail's sender checks pass, because Gmail really did send it.
2. **Free-builder phishing pages.** The email links to a page on Google Sites, Wix, Weebly and similar, claiming a document is waiting, then sends users to a fake Google sign-in page that collects their password.

Commercial tools catch these, but they're expensive and heavy. PhishGuard aims for the middle: **no server, no setup for users, explainable warnings, and a built-in teaching moment.**

## What it does

- **Gmail banner.** When a user opens an email, PhishGuard scores it and shows a green, yellow or red banner with the top reasons.
- **Risky link guard.** Suspicious links in the email are outlined in red; clicking one asks for confirmation first.
- **Fake sign-in page stop screen.** Pages with a password field that look like Google, Microsoft and other brands, but aren't on their real sites, get a full-page warning.
- **"Show me why" lesson.** Highlights the real evidence (the actual address, the real link destination, the look-alike domain), gives one takeaway, and asks one quick question.
- **Report to IT.** Opens a pre-filled Gmail draft to your report address with the score, signals and links. Optionally also POSTs JSON to a webhook.
- **"I think this is safe."** Sends a false-positive report so IT can tune the rules. It does not allowlist anything on its own.

## How scoring works

Each signal adds or subtracts points. Totals map to a level (defaults, configurable):

| Score | Level | What the user sees |
|---|---|---|
| 0–29 | safe | Green banner (optional) |
| 30–59 | caution | Yellow banner |
| 60+ | danger | Red banner, or a stop screen on sign-in pages |

### Email signals

| Signal id | Points | Meaning |
|---|---|---|
| `brand_mismatch` | +30 | Display name claims your org or a known brand, but the address is from another domain |
| `claimed_domain_has_mail` | +20 | The claimed org's domain has MX records, so its staff would normally use it |
| `claimed_domain_no_mail` | 0 | Claimed domain has no MX, so a personal address is plausible (shown as context) |
| `address_in_name` | +25 | An email address is typed into the display name and differs from the real one |
| `lookalike_sender` | +40 | Sender domain imitates your domain or a brand (acrne.com, acme-billing.com) |
| `free_provider` | +10 | Sent from a free webmail account |
| `new_sender` | +10 | First message from this address (tracked locally, hashed) |
| `urgent_language` | +10 | Pressure phrases ("verify your", "shared a document with you") |
| `link_text_mismatch` | +25 | Link text shows one domain, the real destination is another |
| `link_free_host` | +20 | Link goes to a free website builder |
| `link_shortener` | +10 | Link uses a URL shortener |
| `link_lookalike` | +40 | Link goes to a look-alike domain |
| `link_new_domain` / `new_domain` | +25 | Link or sender domain registered less than 30 days ago |
| `trusted_sender` | −30 | Sender is one of your domains or a trusted partner |

### Page signals

Most page checks only apply when the page asks for a password.

| Signal id | Points | Meaning |
|---|---|---|
| `brand_login_off_domain` | +40 | Looks like a Google, Microsoft or other brand sign-in, but isn't on their sign-in host |
| `org_login_off_domain` | +40 | Uses your org name on a sign-in page that isn't yours |
| `org_on_free_host` | +30 | Uses your org name on a free website builder (no password needed) |
| `free_host` | +20 | Sign-in page hosted on a free website builder |
| `form_asks_password` | +60 | Google Forms or Microsoft Forms asking for a password |
| `form_posts_elsewhere` | +25 | The form submits to a different domain |
| `lookalike_domain` | +40 | Page domain imitates yours or a brand's |
| `new_domain` | +25 | Domain registered less than 30 days ago |
| `insecure_login` | +15 | Password page over plain http |
| `ip_address_host` | +20 | Address is a raw IP |

"Sign in with Google" style buttons are ignored, so ordinary sites with social login aren't flagged.

## Lookups and privacy

Everything runs in the user's browser. Nothing is hosted by you or by this project.

- **MX records** come from DNS-over-HTTPS (`dns.google`).
- **Domain age** comes from RDAP (`rdap.org`), the modern JSON replacement for WHOIS.
- Only **domain names** are sent to those services, never email contents or addresses. Results are cached for 6 hours.
- Sender history is stored as truncated SHA-256 hashes in local extension storage.
- The local activity log records the type, action, level, score and domain only.
- Set `enableLookups: false` to turn off all network lookups (scoring still works, minus MX and domain age).

## Try it (developer mode)

1. Download or clone this folder.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the `phishguard` folder.
3. Open PhishGuard's **Details → Extension options** and paste a test config, for example:
   ```json
   {
     "orgNames": ["Acme"],
     "orgDomains": ["acme.com"],
     "reportEmail": "it@acme.com",
     "extraFreeHosts": ["localhost"]
   }
   ```
   Replace Acme with your organization. `extraFreeHosts: ["localhost"]` makes the local test pages behave like a free website builder.
4. **Test pages:** in a terminal, run `python3 -m http.server 8000` inside the `test` folder, then open `http://localhost:8000/fake-shared-document.html` (yellow banner) and click through to the fake sign-in page (stop screen). Both pages are harmless and send nothing.
5. **Test email:** from a personal Gmail account, set the display name to your organization's name (e.g. "Acme Documents") and email your work account with a link to `https://sites.google.com/view/anything`. Open it in Gmail.

Run the scoring tests with `node tests/run-tests.js`.

## Deploy to your organization (Google Workspace)

1. **Publish the extension.** Upload it to the Chrome Web Store as **Private** (visible only to your domain) or **Unlisted**. Self-hosting a .crx with an update URL also works.
2. In the **Google Admin console**, go to **Devices → Chrome → Apps & extensions → Users & browsers**, select the org unit, add the extension by ID, and set it to **Force install**.
3. In the same panel, paste the extension policy JSON:
   ```json
   {
     "orgNames":       { "Value": ["Acme", "Acme Corp"] },
     "orgDomains":     { "Value": ["acme.com"] },
     "trustedDomains": { "Value": ["payroll-vendor.com"] },
     "trustedLoginHosts": { "Value": ["acme.okta.com"] },
     "reportEmail":    { "Value": "phishing@acme.com" },
     "thresholds":     { "Value": { "caution": 30, "danger": 60 } }
   }
   ```
   Managed settings override anything set locally. The full list is in `managed_schema.json`.

Also review Gmail's own spoofing protections in the Admin console (**Apps → Google Workspace → Gmail → Safety**), which include options for look-alike domains and employee-name spoofing.

## Project layout

```
manifest.json          Chrome extension manifest (MV3)
managed_schema.json    Settings IT can push through policy
background.js          Config, DNS/RDAP lookups + cache, scoring, reports, local log
shared/lists.js        Free mail providers, free hosts, shorteners, brands, urgent phrases
shared/domain.js       Domain parsing, look-alike detection, redirect unwrapping
shared/scoring.js      Signals, weights, lessons and quiz (pure functions, testable in Node)
content/ui.js          Banner, stop screen, lesson, link confirmation (shadow DOM)
content/gmail.js       Reads opened Gmail messages and shows banners
content/page.js        Checks web pages for fake sign-in forms
options.html/.js       Local settings, effective config, activity log
test/                  Harmless phishing simulation pages
tests/run-tests.js     Scoring test cases
```

## Known limitations

- **Gmail DOM selectors** (`div.adn`, `span.gD`, `div.a3s`) can change without notice. They're at the top of `content/gmail.js`.
- **No email headers yet.** The Gmail page doesn't expose SPF/DKIM/DMARC results or Reply-To. Reading those needs the Gmail API (planned).
- **Simplified domain parsing.** Handles common two-part endings (co.uk, com.au). A full Public Suffix List is planned.
- **Brand detection is keyword-based** and limited to the brands in `shared/lists.js`.
- **Iframes** aren't scanned, so a fake form embedded in another page can be missed.
- **Not a replacement** for Gmail's filtering, DMARC enforcement, or security awareness training. It's an extra layer.

## Roadmap

- Gmail API mode for SPF/DKIM/DMARC and Reply-To checks
- Google Safe Browsing / PhishTank / OpenPhish lookups
- Full Public Suffix List
- Optional central dashboard (webhook receiver) for IT
- Logo/visual similarity for brand detection
- Firefox and Edge builds

## Contributing

Issues and pull requests are welcome, especially new signals, false-positive reports, brand lists, and test cases in `tests/run-tests.js`.

## License

[PolyForm Perimeter License 1.0.0](https://polyformproject.org/licenses/perimeter/1.0.0). See [LICENSE](LICENSE).

- **Free for everyone to use**, including companies deploying it to all their staff.
- **You may modify and share it**, keeping the license and notice with it.
- **You may not** use it to offer a competing product, such as reselling or rebranding it as your own anti-phishing tool.

This is a source-available license rather than an OSI-approved open source license, because it restricts competing commercial use.
