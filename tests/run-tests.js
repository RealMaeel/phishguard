// Run with: node tests/run-tests.js
// Exercises the scoring engine with realistic cases (no network; lookups are simulated).
require("../shared/lists.js");
require("../shared/domain.js");
require("../shared/scoring.js");
const PG = globalThis.PhishGuard;

const config = PG.mergeConfig({
  orgNames: ["Acme"],
  orgDomains: ["acme.com"],
  trustedLoginHosts: ["acme.okta.com"]
});

let pass = 0, fail = 0;
function check(name, result, expectLevel) {
  const ok = result.level === expectLevel;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ->  ${result.level} (${result.score})`);
  for (const s of result.signals) console.log(`        ${s.points > 0 ? "+" : ""}${s.points}  ${s.title}`);
}

// ---- Email cases
check("Spoof: 'Acme Documents' from Gmail linking to Google Sites",
  PG.analyzeEmail({
    displayName: "Acme Documents", address: "acme.docs.share@gmail.com",
    subject: "Acme shared a document with you",
    bodyText: "You have a new secure document. Sign in to view document.",
    links: [{ href: "https://www.google.com/url?q=https://sites.google.com/view/acme-secure-docs", text: "Open Document" }]
  }, config, { mx: { "acme.com": { hasMail: true } }, age: {}, newSender: true }), "danger");

check("Legit internal email from acme.com",
  PG.analyzeEmail({ displayName: "Jane Smith", address: "jane@acme.com", subject: "Lunch?", bodyText: "Want to grab lunch?", links: [] },
    config, { newSender: false }), "safe");

check("Lookalike sender acrne.com",
  PG.analyzeEmail({ displayName: "Acme Billing", address: "billing@acrne.com", subject: "Invoice", bodyText: "", links: [] },
    config, { mx: { "acme.com": { hasMail: true } }, age: { "acrne.com": 4 }, newSender: true }), "danger");

check("Friend writing from personal Gmail",
  PG.analyzeEmail({ displayName: "Bob Jones", address: "bob.jones@gmail.com", subject: "Photos", bodyText: "Here are the photos", links: [] },
    config, { newSender: true }), "safe");

check("Org without company email (no MX) - softer",
  PG.analyzeEmail({ displayName: "Riverside Garden Club", address: "riversidegardens@gmail.com", subject: "Meeting", bodyText: "See you Thursday", links: [] },
    PG.mergeConfig({ orgNames: ["Riverside Garden Club"], orgDomains: ["riversidegardenclub.org"] }),
    { mx: { "riversidegardenclub.org": { hasMail: false } }, newSender: true }), "caution");

check("Link text shows one domain, goes to another",
  PG.analyzeEmail({ displayName: "IT Desk", address: "helpdesk@randomvendor.net", subject: "Password expires today", bodyText: "Your password expires today.",
    links: [{ href: "https://evil-login.xyz/acme", text: "https://acme.com/reset" }] },
    config, { age: { "evil-login.xyz": 2, "randomvendor.net": 2000 }, newSender: true }), "danger");

check("Google Drive share notification (real)",
  PG.analyzeEmail({ displayName: "Jane Doe (via Google Drive)", address: "drive-shares-dm-noreply@google.com", subject: "Jane shared a document", bodyText: "Jane shared a document with you",
    links: [{ href: "https://docs.google.com/document/d/abc/edit", text: "Open" }] }, config, { newSender: false }), "safe");

// ---- Page cases
const page = (o) => Object.assign({ hasPasswordField: false, title: "", headings: "", alts: "", formText: "", bodyText: "", formActions: [] }, o);

check("Fake Google sign-in on Wix",
  PG.analyzePage(page({ url: "https://docviewer22.wixsite.com/secure", hasPasswordField: true, title: "Sign in - Google Accounts", formText: "Sign in to continue to Gmail" }), config, {}), "danger");

check("Real Google sign-in",
  PG.analyzePage(page({ url: "https://accounts.google.com/v3/signin", hasPasswordField: true, title: "Sign in - Google Accounts" }), config, {}), "safe");

check("Normal site with 'Sign in with Google' button",
  PG.analyzePage(page({ url: "https://www.example-shop.com/login", hasPasswordField: true, title: "Log in | Example Shop", formText: "Email Password Log in or Sign in with Google" }), config, { age: { "example-shop.com": 3000 } }), "safe");

check("Google Form asking for a password",
  PG.analyzePage(page({ url: "https://docs.google.com/forms/d/e/abc/viewform", title: "Mailbox verification", bodyText: "Enter your email and password to keep your mailbox active" }), config, {}), "danger");

check("Fake Acme document page on Google Sites (no password)",
  PG.analyzePage(page({ url: "https://sites.google.com/view/acme-secure-docs", title: "Acme Secure Documents", bodyText: "Acme has shared a document. Sign in with Gmail to view." }), config, {}), "caution");

check("Fake Microsoft login on brand-new domain posting elsewhere",
  PG.analyzePage(page({ url: "https://office365-verify.com/login", hasPasswordField: true, title: "Sign in to your Microsoft account", formActions: ["https://collector.badhost.ru/p.php"] }),
    config, { age: { "office365-verify.com": 3 } }), "danger");

check("Company SSO (trusted)",
  PG.analyzePage(page({ url: "https://acme.okta.com/login", hasPasswordField: true, title: "Acme - Sign In" }), config, {}), "safe");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
