// Reference lists used by the scoring engine. Admins can extend free hosts via config.
(function (g) {
  const PG = (g.PhishGuard = g.PhishGuard || {});

  PG.lists = {
    freeEmailProviders: [
      "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
      "yahoo.com", "ymail.com", "aol.com", "icloud.com", "me.com", "mac.com", "proton.me",
      "protonmail.com", "gmx.com", "gmx.net", "mail.com", "zoho.com", "zohomail.com",
      "yandex.com", "yandex.ru", "tutanota.com", "tuta.io", "fastmail.com"
    ],

    // Hosts where anyone can publish a page (matched as the host or any subdomain of it).
    freeHosts: {
      "wixsite.com": "Wix", "wixstudio.io": "Wix", "weebly.com": "Weebly", "weeblysite.com": "Weebly",
      "square.site": "Square Online", "godaddysites.com": "GoDaddy Website Builder",
      "webflow.io": "Webflow", "framer.website": "Framer", "framer.app": "Framer", "carrd.co": "Carrd",
      "github.io": "GitHub Pages", "gitlab.io": "GitLab Pages", "pages.dev": "Cloudflare Pages",
      "workers.dev": "Cloudflare Workers", "r2.dev": "Cloudflare R2", "trycloudflare.com": "Cloudflare Tunnel",
      "netlify.app": "Netlify", "vercel.app": "Vercel", "web.app": "Firebase Hosting",
      "firebaseapp.com": "Firebase Hosting", "glitch.me": "Glitch", "replit.app": "Replit", "repl.co": "Replit",
      "herokuapp.com": "Heroku", "onrender.com": "Render", "surge.sh": "Surge", "amplifyapp.com": "AWS Amplify",
      "blogspot.com": "Blogger", "wordpress.com": "WordPress.com", "000webhostapp.com": "000webhost",
      "jimdosite.com": "Jimdo", "strikingly.com": "Strikingly", "mystrikingly.com": "Strikingly",
      "yolasite.com": "Yola", "site123.me": "SITE123", "notion.site": "Notion", "canva.site": "Canva",
      "tiiny.site": "Tiiny Host", "ngrok.io": "ngrok", "ngrok-free.app": "ngrok", "duckdns.org": "DuckDNS",
      "azurewebsites.net": "Azure App Service", "web.core.windows.net": "Azure Storage",
      "blob.core.windows.net": "Azure Storage", "storage.googleapis.com": "Google Cloud Storage",
      "firebasestorage.googleapis.com": "Firebase Storage", "s3.amazonaws.com": "Amazon S3"
    },

    // User-generated content that lives on a big brand's own domain (path-based).
    freeHostPaths: [
      { host: "sites.google.com", path: "/", label: "Google Sites" },
      { host: "docs.google.com", path: "/forms", label: "Google Forms", isForm: true },
      { host: "forms.gle", path: "/", label: "Google Forms", isForm: true },
      { host: "forms.office.com", path: "/", label: "Microsoft Forms", isForm: true },
      { host: "forms.microsoft.com", path: "/", label: "Microsoft Forms", isForm: true }
    ],

    urlShorteners: [
      "bit.ly", "tinyurl.com", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly",
      "shorturl.at", "rb.gy", "t.ly", "tiny.cc", "s.id", "shorturl.gg", "v.gd"
    ],

    // Brands commonly impersonated. keywords: words that indicate a claim to be that brand.
    brands: [
      {
        name: "Google",
        keywords: ["google", "gmail", "google drive", "google docs", "google workspace", "google account"],
        domains: ["google.com", "gmail.com", "googlemail.com", "googleusercontent.com", "googleapis.com",
                  "gstatic.com", "youtube.com", "google.co.uk", "google.ca", "google.com.au"],
        loginHosts: ["accounts.google.com"]
      },
      {
        name: "Microsoft",
        keywords: ["microsoft", "outlook", "office 365", "office365", "microsoft 365", "onedrive",
                   "sharepoint", "microsoft teams"],
        domains: ["microsoft.com", "microsoftonline.com", "live.com", "outlook.com", "office.com",
                  "office365.com", "sharepoint.com", "onedrive.com", "microsoft365.com", "msft.net"],
        loginHosts: ["login.microsoftonline.com", "login.live.com", "login.microsoft.com"]
      },
      {
        name: "DocuSign",
        keywords: ["docusign"],
        domains: ["docusign.com", "docusign.net"],
        loginHosts: ["account.docusign.com"]
      },
      {
        name: "Dropbox",
        keywords: ["dropbox"],
        domains: ["dropbox.com", "dropboxmail.com"],
        loginHosts: ["www.dropbox.com"]
      },
      {
        name: "PayPal",
        keywords: ["paypal"],
        domains: ["paypal.com"],
        loginHosts: ["www.paypal.com"]
      },
      {
        name: "Apple",
        keywords: ["apple id", "apple account", "apple support", "icloud"],
        domains: ["apple.com", "icloud.com"],
        loginHosts: ["appleid.apple.com", "account.apple.com", "www.icloud.com"]
      },
      {
        name: "Adobe",
        keywords: ["adobe", "adobe sign", "adobe acrobat"],
        domains: ["adobe.com", "adobesign.com", "adobe.io"],
        loginHosts: ["auth.services.adobe.com", "account.adobe.com"]
      },
      {
        name: "Amazon",
        keywords: ["amazon", "aws"],
        domains: ["amazon.com", "amazonaws.com", "aws.amazon.com", "amazon.co.uk", "amazonses.com"],
        loginHosts: ["www.amazon.com", "signin.aws.amazon.com"]
      }
    ],

    urgentPhrases: [
      "urgent", "immediately", "action required", "final notice", "verify your", "confirm your",
      "suspended", "will be suspended", "unusual sign-in", "unusual activity", "password expires",
      "password will expire", "within 24 hours", "shared a document with you", "view document",
      "view the document", "invoice attached", "wire transfer", "gift card", "mailbox is full",
      "storage is full", "re-validate", "reactivate"
    ]
  };
})(globalThis);
