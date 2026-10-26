const $ = (id) => document.getElementById(id);

function msg(text, bad) {
  $("msg").textContent = text;
  $("msg").style.color = bad ? "#b3261e" : "#1d6b2a";
  setTimeout(() => ($("msg").textContent = ""), 4000);
}

async function load() {
  let managed = {};
  try { managed = (await chrome.storage.managed.get(null)) || {}; } catch (e) {}
  $("managed").textContent = Object.keys(managed).length ? "" : "No managed policy found. This browser isn't receiving settings from an admin.";
  if (Object.keys(managed).length) {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(managed, null, 2);
    $("managed").appendChild(pre);
  }

  const { localConfig = {}, eventLog = [] } = await chrome.storage.local.get(["localConfig", "eventLog"]);
  $("local").value = JSON.stringify(localConfig, null, 2);

  chrome.runtime.sendMessage({ type: "getConfig" }, (cfg) => {
    $("effective").textContent = JSON.stringify(cfg, null, 2);
  });

  const tbody = $("log");
  tbody.innerHTML = "";
  for (const e of eventLog) {
    const tr = document.createElement("tr");
    for (const v of [new Date(e.t).toLocaleString(), e.kind, e.action, e.level, e.score, e.where]) {
      const td = document.createElement("td");
      td.textContent = v == null ? "" : String(v);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  if (!eventLog.length) tbody.innerHTML = '<tr><td colspan="6">No activity yet.</td></tr>';
}

$("save").addEventListener("click", async () => {
  let parsed;
  try { parsed = JSON.parse($("local").value || "{}"); } catch (e) { return msg("That isn't valid JSON: " + e.message, true); }
  await chrome.storage.local.set({ localConfig: parsed });
  msg("Saved.");
  load();
});

$("clear").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "clearCache" }, (r) => { msg(`Cleared ${r && r.removed || 0} cached lookups and history.`); load(); });
});

load();
