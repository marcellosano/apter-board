// Apter Board — a thin mobile face over GitHub Issues + Project #2,
// shaped after Microsoft To Do. No build step, no backend.
// Token lives only in this browser's localStorage.

// ---- Constants (Apter Workboard, queried 2026-06-12) ----
const GRAPHQL = "https://api.github.com/graphql";
const REST = "https://api.github.com";
const OWNER = "marcellosano";
const REPO = "Apter";
const PROJECT_ID = "PVT_kwHOAGedRc4BaBll"; // Project #2
const FIELD_DUE = "PVTF_lAHOAGedRc4BaBllzhVPu-c"; // DATE
const FOCUS_LABEL = "needs-human";
const TOKEN_KEY = "apter_board_token";
const MYDAY_LABEL = "my-day"; // synced across devices via GitHub label
const PRIORITY_RANK = { "P0-now": 0, "P1-next": 1, "P2-later": 2 };

// Human-routing flags an agent (or Marcello) can set on a task.
const FLAGS = [
  { label: "needs-human", text: "Needs me" },
  { label: "decision", text: "Decision" },
  { label: "blocked", text: "Blocked" },
];

// Agents are GitHub labels `agent:<key>` (the Apter routing convention).
const AGENTS = [
  { key: "mac", label: "Mac" },
  { key: "win", label: "Win" },
  { key: "ubu", label: "Ubu" },
  { key: "maia", label: "Maia" },
  { key: "claire", label: "Claire" },
];
const agentLabel = (key) => `agent:${key}`;

// ---- State ----
let items = []; // see mapNode()
let activeList = "myday";
let agentFilter = null; // null = all agents
let completedOpen = false;

// ---- DOM ----
const $ = (sel) => document.querySelector(sel);
const listEl = $("#list");
const completedGroupEl = $("#completedGroup");
const completedListEl = $("#completedList");
const completedToggleEl = $("#completedToggle");
const completedToggleLabelEl = $("#completedToggleLabel");
const emptyEl = $("#empty");
const statusEl = $("#status");
const toastEl = $("#toast");
const settingsEl = $("#settings");
const tokenInput = $("#tokenInput");

// ---- Dates ----
const todayStr = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local
function addDaysStr(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
}

// ---- Token ----
const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// ---- My Day is a synced GitHub label (my-day), shared across devices ----
const inMyDay = (item) => item.labels.includes(MYDAY_LABEL);

// ---- Transports ----
async function gql(query, variables = {}) {
  const token = getToken();
  if (!token) throw new Error("NO_TOKEN");
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) throw new Error("BAD_TOKEN");
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data;
}

async function rest(method, path, body) {
  const token = getToken();
  if (!token) throw new Error("NO_TOKEN");
  const res = await fetch(`${REST}${path}`, {
    method,
    headers: {
      Authorization: `bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error("BAD_TOKEN");
  if (!res.ok && res.status !== 422) throw new Error(`GitHub ${res.status}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

// ---- Queries / mutations ----
const ITEMS_QUERY = `
query($projectId: ID!) {
  node(id: $projectId) {
    ... on ProjectV2 {
      items(first: 100) {
        nodes {
          id
          content {
            ... on Issue {
              id number title url state
              labels(first: 20) { nodes { name } }
            }
          }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name field { ... on ProjectV2FieldCommon { name } }
              }
              ... on ProjectV2ItemFieldDateValue {
                date field { ... on ProjectV2FieldCommon { name } }
              }
            }
          }
        }
      }
    }
  }
}`;

const CLOSE_ISSUE = `mutation($id: ID!){ closeIssue(input:{issueId:$id}){ issue{ id state } } }`;
const REOPEN_ISSUE = `mutation($id: ID!){ reopenIssue(input:{issueId:$id}){ issue{ id state } } }`;
const SET_DUE = `mutation($p:ID!,$i:ID!,$f:ID!,$d:Date!){ updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{date:$d}}){ projectV2Item{ id } } }`;
const CLEAR_DUE = `mutation($p:ID!,$i:ID!,$f:ID!){ clearProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f}){ projectV2Item{ id } } }`;

// ---- Data load ----
function mapNode(n) {
  const fv = n.fieldValues.nodes;
  const labels = n.content.labels.nodes.map((l) => l.name);
  return {
    itemId: n.id,
    issueId: n.content.id,
    number: n.content.number,
    title: n.content.title,
    url: n.content.url,
    labels,
    agents: labels.filter((l) => l.startsWith("agent:")).map((l) => l.slice(6)),
    priority: fv.find((v) => v.field?.name === "Priority")?.name ?? null,
    due: fv.find((v) => v.field?.name === "Due")?.date ?? null,
    done: n.content.state === "CLOSED",
  };
}

async function load() {
  if (!getToken()) { openSettings(); setStatus("Add a GitHub token to get started."); return; }
  setStatus("Loading…");
  try {
    const data = await gql(ITEMS_QUERY, { projectId: PROJECT_ID });
    const nodes = data?.node?.items?.nodes ?? [];
    items = nodes.filter((n) => n.content && n.content.number).map(mapNode);
    renderAgentBar();
    render();
  } catch (err) { handleError(err); }
}

// ---- Sorting & grouping ----
function byPriorityThenDue(a, b) {
  const pa = PRIORITY_RANK[a.priority] ?? 9;
  const pb = PRIORITY_RANK[b.priority] ?? 9;
  if (pa !== pb) return pa - pb;
  return (a.due ?? "9999-99-99").localeCompare(b.due ?? "9999-99-99");
}
function byDueThenPriority(a, b) {
  const d = (a.due ?? "9999-99-99").localeCompare(b.due ?? "9999-99-99");
  return d !== 0 ? d : byPriorityThenDue(a, b);
}

function dueBucket(due) {
  if (!due) return { key: "later", label: "Later" };
  const t = todayStr();
  if (due < t) return { key: "overdue", label: "Overdue" };
  if (due === t) return { key: "today", label: "Today" };
  if (due === addDaysStr(1)) return { key: "tomorrow", label: "Tomorrow" };
  if (due <= addDaysStr(7)) return { key: "week", label: "This week" };
  return { key: "later", label: "Later" };
}

// ---- Selection per list ----
function applyAgent(arr) {
  return agentFilter ? arr.filter((i) => i.agents.includes(agentFilter)) : arr;
}

// Returns { active: [...], grouped: bool }
function selectActive() {
  const open = applyAgent(items.filter((i) => !i.done));
  switch (activeList) {
    case "myday":
      return { active: open.filter((i) => inMyDay(i)).sort(byPriorityThenDue) };
    case "today":
      return { active: open.filter((i) => i.due && i.due <= todayStr()).sort(byDueThenPriority) };
    case "planned":
      return { active: open.filter((i) => i.due).sort(byDueThenPriority), grouped: true };
    case "priority":
      return { active: open.filter((i) => i.priority === "P0-now" || i.priority === "P1-next").sort(byPriorityThenDue) };
    case "focus":
      return { active: open.filter((i) => i.labels.includes(FOCUS_LABEL)).sort(byPriorityThenDue) };
    case "completed":
      return { active: [], completedOnly: true };
    default: // all
      return { active: open.sort(byPriorityThenDue) };
  }
}

function selectCompleted() {
  return applyAgent(items.filter((i) => i.done)).sort(byPriorityThenDue);
}

// ---- Render ----
function render() {
  const sel = selectActive();
  updateBadges();
  listEl.innerHTML = "";

  if (sel.completedOnly) {
    // "Completed" smart list: closed tasks fill the main list.
    const done = selectCompleted();
    for (const item of done) listEl.appendChild(renderRow(item));
    completedGroupEl.hidden = true;
    emptyEl.hidden = done.length > 0;
    setStatus(`${done.length} completed${agentSuffix()}`);
    return;
  }

  if (sel.grouped) {
    let lastBucket = null;
    for (const item of sel.active) {
      const b = dueBucket(item.due);
      if (b.key !== lastBucket) { listEl.appendChild(groupHeader(b.label)); lastBucket = b.key; }
      listEl.appendChild(renderRow(item));
    }
  } else {
    for (const item of sel.active) listEl.appendChild(renderRow(item));
  }

  // Collapsible "Completed" group at the bottom of every list (To Do style).
  const done = selectCompleted();
  completedGroupEl.hidden = done.length === 0;
  completedToggleLabelEl.innerHTML = `&#10003; Completed (${done.length})`;
  completedToggleEl.setAttribute("aria-expanded", String(completedOpen));
  completedGroupEl.classList.toggle("is-open", completedOpen);
  completedListEl.hidden = !completedOpen;
  completedListEl.innerHTML = "";
  if (completedOpen) for (const item of done) completedListEl.appendChild(renderRow(item));

  emptyEl.hidden = sel.active.length > 0;
  setStatus(`${sel.active.length} ${listTitle()}${agentSuffix()}`);
}

function listTitle() {
  return { myday: "in My Day", today: "due", planned: "planned", priority: "priority", focus: "for you", all: "open" }[activeList] || "open";
}
function agentSuffix() { return agentFilter ? ` · ${agentName(agentFilter)}` : ""; }

// Badge the "My focus" chip with the count of open needs-human tasks —
// this is the human inbox: where an agent flags a decision/action for Marcello.
function updateBadges() {
  const n = items.filter((i) => !i.done && i.labels.includes("needs-human")).length;
  const chip = document.querySelector('#smartlists .chip[data-list="focus"]');
  if (chip) chip.innerHTML = `My focus${n ? ` <sup class="badge">${n}</sup>` : ""}`;
}
function agentName(key) { return AGENTS.find((a) => a.key === key)?.label || key; }

function groupHeader(label) {
  const li = document.createElement("li");
  li.className = "group-header";
  li.textContent = label;
  return li;
}

function renderRow(item) {
  const li = document.createElement("li");
  li.className = "row" + (item.done ? " is-done" : "");
  li.dataset.number = item.number;

  // Done circle
  const circle = document.createElement("button");
  circle.className = "circle" + (item.done ? " checked" : "");
  circle.title = item.done ? "Mark not done" : "Mark done";
  circle.innerHTML = item.done ? "&#10003;" : "";
  circle.addEventListener("click", (e) => { e.stopPropagation(); toggleDone(item, li); });

  // Main
  const main = document.createElement("div");
  main.className = "row-main";

  const title = document.createElement("button");
  title.className = "row-title";
  title.textContent = item.title;
  title.addEventListener("click", () => toggleDetail(item, main));

  const meta = document.createElement("div");
  meta.className = "row-meta";
  meta.appendChild(priorityPill(item.priority));
  meta.appendChild(dueChip(item.due, item.done));
  for (const a of item.agents) meta.appendChild(agentTag(a));
  if (inMyDay(item) && !item.done) meta.appendChild(sunTag());
  const num = document.createElement("a");
  num.className = "num";
  num.href = item.url;
  num.target = "_blank";
  num.rel = "noopener";
  num.textContent = `#${item.number}`;
  num.addEventListener("click", (e) => e.stopPropagation());
  meta.appendChild(num);

  main.appendChild(title);
  main.appendChild(meta);
  li.appendChild(circle);
  li.appendChild(main);
  return li;
}

function priorityPill(priority) {
  const span = document.createElement("span");
  const cls = { "P0-now": "p0", "P1-next": "p1", "P2-later": "p2" }[priority] || "none";
  span.className = `pill ${cls}`;
  span.textContent = priority ? priority.split("-")[0] : "—";
  return span;
}

function dueChip(due, done) {
  const span = document.createElement("span");
  span.className = "due";
  if (!due) { span.textContent = "no due"; span.classList.add("muted-chip"); return span; }
  if (!done) {
    if (due < todayStr()) span.classList.add("overdue");
    else if (due <= addDaysStr(7)) span.classList.add("soon");
  }
  span.textContent = formatDue(due);
  return span;
}
function formatDue(due) {
  return new Date(due + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function agentTag(key) {
  const span = document.createElement("span");
  span.className = "agent-tag";
  span.textContent = agentName(key);
  return span;
}
function sunTag() {
  const span = document.createElement("span");
  span.className = "sun-tag";
  span.innerHTML = "&#9728;";
  span.title = "In My Day";
  return span;
}

// ---- Detail editor (due + agents + My Day) ----
function toggleDetail(item, main) {
  const existing = main.querySelector(".detail");
  if (existing) { existing.remove(); return; }

  const box = document.createElement("div");
  box.className = "detail";

  // Due
  const dueRow = document.createElement("div");
  dueRow.className = "detail-row";
  dueRow.innerHTML = `<span class="detail-label">Due</span>`;
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  if (item.due) dateInput.value = item.due;
  dateInput.addEventListener("change", () => setDue(item, dateInput.value, main));
  const clearDue = document.createElement("button");
  clearDue.className = "mini-btn";
  clearDue.textContent = "Clear";
  clearDue.addEventListener("click", () => setDue(item, "", main));
  dueRow.appendChild(dateInput);
  dueRow.appendChild(clearDue);

  // My Day (synced label)
  const dayRow = document.createElement("div");
  dayRow.className = "detail-row";
  dayRow.innerHTML = `<span class="detail-label">My Day</span>`;
  const dayBtn = document.createElement("button");
  dayBtn.className = "mini-btn" + (inMyDay(item) ? " on" : "");
  dayBtn.innerHTML = inMyDay(item) ? "&#9728; In My Day — remove" : "&#9728; Add to My Day";
  dayBtn.addEventListener("click", async () => {
    try {
      const now = await toggleLabel(item, MYDAY_LABEL, dayBtn);
      toast(now ? "Added to My Day" : "Removed from My Day");
      main.querySelector(".detail")?.remove();
      render();
    } catch { /* handled in toggleLabel */ }
  });
  dayRow.appendChild(dayBtn);

  // Agents
  const agentRow = document.createElement("div");
  agentRow.className = "detail-row wrap";
  agentRow.innerHTML = `<span class="detail-label">Agent</span>`;
  for (const a of AGENTS) {
    const b = document.createElement("button");
    const on = item.agents.includes(a.key);
    b.className = "mini-btn" + (on ? " on" : "");
    b.textContent = a.label;
    b.addEventListener("click", () => toggleAgent(item, a.key, b));
    agentRow.appendChild(b);
  }

  // Flags (human routing: Needs me / Decision / Blocked)
  const flagRow = document.createElement("div");
  flagRow.className = "detail-row wrap";
  flagRow.innerHTML = `<span class="detail-label">Flag</span>`;
  for (const f of FLAGS) {
    const b = document.createElement("button");
    b.className = "mini-btn" + (item.labels.includes(f.label) ? " on" : "");
    b.textContent = f.text;
    b.addEventListener("click", async () => {
      try {
        const now = await toggleLabel(item, f.label, b);
        toast(now ? `Flagged: ${f.text}` : `Cleared: ${f.text}`);
        render();
      } catch { /* handled */ }
    });
    flagRow.appendChild(b);
  }

  box.appendChild(dueRow);
  box.appendChild(dayRow);
  box.appendChild(agentRow);
  box.appendChild(flagRow);
  main.appendChild(box);
}

// ---- Actions ----
async function toggleDone(item, li) {
  const goingDone = !item.done;
  item.done = goingDone; // optimistic
  li.classList.toggle("is-done", goingDone);
  try {
    await gql(goingDone ? CLOSE_ISSUE : REOPEN_ISSUE, { id: item.issueId });
    toast(goingDone ? `Completed #${item.number}` : `Reopened #${item.number}`);
    render();
  } catch (err) {
    item.done = !goingDone;
    li.classList.toggle("is-done", !goingDone);
    handleError(err);
  }
}

async function setDue(item, date, main) {
  const prev = item.due;
  item.due = date || null;
  try {
    if (date) {
      await gql(SET_DUE, { p: PROJECT_ID, i: item.itemId, f: FIELD_DUE, d: date });
      toast(`Due ${formatDue(date)}`);
    } else {
      await gql(CLEAR_DUE, { p: PROJECT_ID, i: item.itemId, f: FIELD_DUE });
      toast("Due cleared");
    }
    main.querySelector(".detail")?.remove();
    render();
  } catch (err) { item.due = prev; handleError(err); }
}

// Add/remove a single label on an issue (REST). Returns the new on/off state.
// Keeps item.labels and the derived item.agents in sync. Throws on failure.
async function toggleLabel(item, name, btn) {
  const on = item.labels.includes(name);
  if (btn) btn.classList.toggle("on", !on);
  try {
    if (on) {
      await rest("DELETE", `/repos/${OWNER}/${REPO}/issues/${item.number}/labels/${encodeURIComponent(name)}`);
      item.labels = item.labels.filter((l) => l !== name);
    } else {
      await rest("POST", `/repos/${OWNER}/${REPO}/issues/${item.number}/labels`, { labels: [name] });
      item.labels.push(name);
    }
    item.agents = item.labels.filter((l) => l.startsWith("agent:")).map((l) => l.slice(6));
    return !on;
  } catch (err) {
    if (btn) btn.classList.toggle("on", on);
    handleError(err);
    throw err;
  }
}

async function toggleAgent(item, key, btn) {
  try {
    const now = await toggleLabel(item, agentLabel(key), btn);
    toast(now ? `Assigned ${agentName(key)}` : `Unassigned ${agentName(key)}`);
    renderAgentBar();
    render();
  } catch { /* handled in toggleLabel */ }
}

// ---- Agent filter bar ----
function renderAgentBar() {
  const bar = $("#agentbar");
  bar.innerHTML = "";
  const all = document.createElement("button");
  all.className = "agent-chip" + (agentFilter === null ? " is-active" : "");
  all.textContent = "All agents";
  all.addEventListener("click", () => { agentFilter = null; renderAgentBar(); render(); });
  bar.appendChild(all);
  for (const a of AGENTS) {
    const count = items.filter((i) => !i.done && i.agents.includes(a.key)).length;
    const b = document.createElement("button");
    b.className = "agent-chip" + (agentFilter === a.key ? " is-active" : "");
    b.textContent = count ? `${a.label} ${count}` : a.label;
    b.addEventListener("click", () => {
      agentFilter = agentFilter === a.key ? null : a.key;
      renderAgentBar(); render();
    });
    bar.appendChild(b);
  }
}

// ---- UI helpers ----
function setStatus(msg) { statusEl.textContent = msg; }
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2000);
}
function handleError(err) {
  if (err.message === "NO_TOKEN" || err.message === "BAD_TOKEN") {
    openSettings();
    setStatus(err.message === "BAD_TOKEN" ? "Token rejected (401). Check it." : "Add a token.");
  } else { setStatus("Error: " + err.message); toast("Error: " + err.message); }
}
function openSettings() { tokenInput.value = getToken(); settingsEl.hidden = false; }
function closeSettings() { settingsEl.hidden = true; }

// ---- Wiring ----
$("#settingsBtn").addEventListener("click", openSettings);
$("#refreshBtn").addEventListener("click", load);
$("#saveTokenBtn").addEventListener("click", () => {
  const t = tokenInput.value.trim();
  if (t) setToken(t);
  closeSettings();
  load();
});
$("#clearTokenBtn").addEventListener("click", () => { clearToken(); tokenInput.value = ""; toast("Token cleared"); });
settingsEl.addEventListener("click", (e) => { if (e.target === settingsEl) closeSettings(); });

$("#smartlists").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  activeList = btn.dataset.list;
  document.querySelectorAll("#smartlists .chip").forEach((c) => c.classList.toggle("is-active", c === btn));
  render();
});
completedToggleEl.addEventListener("click", () => { completedOpen = !completedOpen; render(); });

// ---- Go ----
load();
