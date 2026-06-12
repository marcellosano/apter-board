// Apter Board — a thin mobile face over GitHub Issues + Project #2,
// shaped after Microsoft To Do (home = a list of lists; tap a list to see tasks).
// No build step, no backend. Token lives only in this browser's localStorage.

// ---- Constants (Apter Workboard, queried 2026-06-12) ----
const GRAPHQL = "https://api.github.com/graphql";
const REST = "https://api.github.com";
const OWNER = "marcellosano";
const REPO = "Apter";
const PROJECT_ID = "PVT_kwHOAGedRc4BaBll"; // Project #2
const FIELD_DUE = "PVTF_lAHOAGedRc4BaBllzhVPu-c"; // DATE
const MYDAY_LABEL = "my-day";
const TOKEN_KEY = "apter_board_token";
const PRIORITY_RANK = { "P0-now": 0, "P1-next": 1, "P2-later": 2 };

// Smart lists (To Do style). icon = emoji for a colourful native feel.
const SMART = [
  { key: "myday", title: "My Day", icon: "☀️" },
  { key: "important", title: "Important", icon: "⭐" },
  { key: "planned", title: "Planned", icon: "📅" },
  { key: "all", title: "All", icon: "♾️" },
  { key: "completed", title: "Completed", icon: "✅" },
  { key: "needs", title: "Needs me", icon: "🙋" },
];

// Categories = SharePoint areas, already GitHub labels. Coloured dots.
const CATEGORIES = [
  { label: "admin", title: "Admin", color: "#6E7781" },
  { label: "growth", title: "Growth", color: "#1A7F37" },
  { label: "brand", title: "Brand", color: "#BF3989" },
  { label: "courses", title: "Courses", color: "#9A6700" },
  { label: "systems", title: "Systems", color: "#0052CC" },
];

// Agents = agent:<key> labels.
const AGENTS = [
  { key: "mac", label: "Mac", color: "#bfd4f2" },
  { key: "win", label: "Win", color: "#c5def7" },
  { key: "ubu", label: "Ubu", color: "#0e8a16" },
  { key: "maia", label: "Maia", color: "#5319e7" },
  { key: "claire", label: "Claire", color: "#e99695" },
];
const agentLabel = (key) => `agent:${key}`;
const agentName = (key) => AGENTS.find((a) => a.key === key)?.label || key;

// Human-routing flags an agent (or Marcello) can set on a task.
const FLAGS = [
  { label: "needs-human", text: "Needs me" },
  { label: "decision", text: "Decision" },
  { label: "blocked", text: "Blocked" },
];

// ---- State ----
let items = [];
let current = null; // null = home, else { type:'smart'|'category'|'agent'|'search', key, title }
let completedOpen = false;
let searchText = "";

// ---- DOM ----
const $ = (s) => document.querySelector(s);
const homeEl = $("#home");
const detailEl = $("#detail");
const listEl = $("#list");
const completedGroupEl = $("#completedGroup");
const completedListEl = $("#completedList");
const completedToggleEl = $("#completedToggle");
const completedToggleLabelEl = $("#completedToggleLabel");
const emptyEl = $("#empty");
const statusEl = $("#status");
const homeStatusEl = $("#homeStatus");
const listTitleEl = $("#listTitle");
const searchInput = $("#searchInput");
const toastEl = $("#toast");
const settingsEl = $("#settings");
const tokenInput = $("#tokenInput");

// ---- Dates ----
const todayStr = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local
function addDaysStr(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); }

// ---- Token ----
const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
const clearToken = () => localStorage.removeItem(TOKEN_KEY);

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
    headers: { Authorization: `bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
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
          content { ... on Issue { id number title url state labels(first: 20){ nodes{ name } } } }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue { name field{ ... on ProjectV2FieldCommon{ name } } }
              ... on ProjectV2ItemFieldDateValue { date field{ ... on ProjectV2FieldCommon{ name } } }
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

// ---- Load ----
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
  if (!getToken()) { openSettings(); homeStatusEl.textContent = "Add a GitHub token to get started."; return; }
  homeStatusEl.textContent = "Loading…";
  try {
    const data = await gql(ITEMS_QUERY, { projectId: PROJECT_ID });
    const nodes = data?.node?.items?.nodes ?? [];
    items = nodes.filter((n) => n.content && n.content.number).map(mapNode);
    loadUser();
    refreshViews();
  } catch (err) { handleError(err); }
}
async function loadUser() {
  try {
    const u = await rest("GET", "/user");
    if (u?.name || u?.login) $("#userName").textContent = u.name || u.login;
    if (u?.avatar_url) { const a = $("#avatar"); a.src = u.avatar_url; a.hidden = false; }
  } catch { /* non-fatal */ }
}
function refreshViews() {
  renderHome();
  if (current) render();
}

// ---- Scope: does an item belong to the current list (ignoring done state)? ----
const inMyDay = (i) => i.labels.includes(MYDAY_LABEL);
function scopeOf(sel) {
  if (!sel) return () => true;
  switch (sel.type) {
    case "category": return (i) => i.labels.includes(sel.key);
    case "agent": return (i) => i.agents.includes(sel.key);
    case "search": return (i) => i.title.toLowerCase().includes(searchText.toLowerCase());
    case "smart":
      switch (sel.key) {
        case "myday": return inMyDay;
        case "important": return (i) => i.priority === "P0-now" || i.priority === "P1-next";
        case "planned": return (i) => !!i.due;
        case "needs": return (i) => i.labels.includes("needs-human");
        case "completed":
        case "all":
        default: return () => true;
      }
    default: return () => true;
  }
}

// ---- Sorting ----
function byPriorityThenDue(a, b) {
  const pa = PRIORITY_RANK[a.priority] ?? 9, pb = PRIORITY_RANK[b.priority] ?? 9;
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

// ---- Counts ----
function openCount(pred) { return items.filter((i) => !i.done && pred(i)).length; }
function countForSmart(key) {
  if (key === "completed") return items.filter((i) => i.done).length;
  return openCount(scopeOf({ type: "smart", key }));
}

// ============ HOME VIEW ============
function navItem({ icon, dot, title, count, onClick, badge }) {
  const b = document.createElement("button");
  b.className = "nav-item";
  const left = document.createElement("span");
  left.className = "nav-left";
  if (dot) {
    const d = document.createElement("span");
    d.className = "dot"; d.style.background = dot;
    left.appendChild(d);
  } else {
    const ic = document.createElement("span");
    ic.className = "nav-icon"; ic.textContent = icon;
    left.appendChild(ic);
  }
  const t = document.createElement("span");
  t.className = "nav-title"; t.textContent = title;
  left.appendChild(t);
  if (badge) { const x = document.createElement("sup"); x.className = "badge"; x.textContent = badge; t.appendChild(document.createTextNode(" ")); t.appendChild(x); }
  b.appendChild(left);
  const c = document.createElement("span");
  c.className = "nav-count"; c.textContent = count ? String(count) : "";
  b.appendChild(c);
  b.addEventListener("click", onClick);
  return b;
}

function renderHome() {
  const smartNav = $("#smartNav"); smartNav.innerHTML = "";
  for (const s of SMART) {
    const count = countForSmart(s.key);
    const badge = s.key === "needs" && count ? count : null;
    smartNav.appendChild(navItem({
      icon: s.icon, title: s.title, count, badge,
      onClick: () => openList({ type: "smart", key: s.key, title: s.title }),
    }));
  }
  const catNav = $("#catNav"); catNav.innerHTML = "";
  for (const c of CATEGORIES) {
    catNav.appendChild(navItem({
      dot: c.color, title: c.title, count: openCount((i) => i.labels.includes(c.label)),
      onClick: () => openList({ type: "category", key: c.label, title: c.title }),
    }));
  }
  const agentNav = $("#agentNav"); agentNav.innerHTML = "";
  for (const a of AGENTS) {
    agentNav.appendChild(navItem({
      dot: a.color, title: a.label, count: openCount((i) => i.agents.includes(a.key)),
      onClick: () => openList({ type: "agent", key: a.key, title: a.label }),
    }));
  }
  homeStatusEl.textContent = `${openCount(() => true)} open · ${items.filter((i) => i.done).length} completed`;
}

// ============ NAVIGATION ============
function openList(sel) {
  current = sel;
  completedOpen = false;
  homeEl.hidden = true;
  detailEl.hidden = false;
  listTitleEl.textContent = sel.title;
  const isSearch = sel.type === "search";
  searchInput.hidden = !isSearch;
  if (isSearch) { searchInput.value = searchText; searchInput.focus(); }
  render();
}
function goHome() {
  current = null;
  detailEl.hidden = true;
  homeEl.hidden = false;
  renderHome();
}

// ============ LIST DETAIL ============
function render() {
  if (!current) return;
  const scope = scopeOf(current);
  const isCompletedList = current.type === "smart" && current.key === "completed";
  listEl.innerHTML = "";

  if (isCompletedList) {
    const done = items.filter((i) => i.done && scope(i)).sort(byPriorityThenDue);
    for (const it of done) listEl.appendChild(renderRow(it));
    completedGroupEl.hidden = true;
    emptyEl.hidden = done.length > 0;
    statusEl.textContent = `${done.length} completed`;
    return;
  }

  let active = items.filter((i) => !i.done && scope(i));
  const grouped = current.type === "smart" && current.key === "planned";
  active.sort(grouped ? byDueThenPriority : byPriorityThenDue);

  if (grouped) {
    let last = null;
    for (const it of active) {
      const bk = dueBucket(it.due);
      if (bk.key !== last) { listEl.appendChild(groupHeader(bk.label)); last = bk.key; }
      listEl.appendChild(renderRow(it));
    }
  } else {
    for (const it of active) listEl.appendChild(renderRow(it));
  }

  // Completed drawer scoped to this list
  const done = items.filter((i) => i.done && scope(i)).sort(byPriorityThenDue);
  completedGroupEl.hidden = done.length === 0;
  completedToggleLabelEl.innerHTML = `&#10003; Completed (${done.length})`;
  completedToggleEl.setAttribute("aria-expanded", String(completedOpen));
  completedGroupEl.classList.toggle("is-open", completedOpen);
  completedListEl.hidden = !completedOpen;
  completedListEl.innerHTML = "";
  if (completedOpen) for (const it of done) completedListEl.appendChild(renderRow(it));

  emptyEl.hidden = active.length > 0;
  statusEl.textContent = `${active.length} open`;
}

function groupHeader(label) {
  const li = document.createElement("li");
  li.className = "group-header"; li.textContent = label;
  return li;
}

function renderRow(item) {
  const li = document.createElement("li");
  li.className = "row" + (item.done ? " is-done" : "");

  const circle = document.createElement("button");
  circle.className = "circle" + (item.done ? " checked" : "");
  circle.title = item.done ? "Mark not done" : "Mark done";
  circle.innerHTML = item.done ? "&#10003;" : "";
  circle.addEventListener("click", (e) => { e.stopPropagation(); toggleDone(item, li); });

  const main = document.createElement("div");
  main.className = "row-main";

  const title = document.createElement("button");
  title.className = "row-title"; title.textContent = item.title;
  title.addEventListener("click", () => toggleDetail(item, main));

  const meta = document.createElement("div");
  meta.className = "row-meta";
  meta.appendChild(priorityPill(item.priority));
  meta.appendChild(dueChip(item.due, item.done));
  for (const a of item.agents) meta.appendChild(agentTag(a));
  if (inMyDay(item) && !item.done) meta.appendChild(sunTag());
  const num = document.createElement("a");
  num.className = "num"; num.href = item.url; num.target = "_blank"; num.rel = "noopener";
  num.textContent = `#${item.number}`;
  num.addEventListener("click", (e) => e.stopPropagation());
  meta.appendChild(num);

  main.appendChild(title); main.appendChild(meta);
  li.appendChild(circle); li.appendChild(main);
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
const formatDue = (due) => new Date(due + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
function agentTag(key) { const s = document.createElement("span"); s.className = "agent-tag"; s.textContent = agentName(key); return s; }
function sunTag() { const s = document.createElement("span"); s.className = "sun-tag"; s.innerHTML = "&#9728;"; s.title = "In My Day"; return s; }

// ---- Detail editor ----
function toggleDetail(item, main) {
  const existing = main.querySelector(".detail");
  if (existing) { existing.remove(); return; }
  const box = document.createElement("div");
  box.className = "detail";

  const dueRow = document.createElement("div");
  dueRow.className = "detail-row";
  dueRow.innerHTML = `<span class="detail-label">Due</span>`;
  const dateInput = document.createElement("input");
  dateInput.type = "date"; if (item.due) dateInput.value = item.due;
  dateInput.addEventListener("change", () => setDue(item, dateInput.value, main));
  const clearDue = document.createElement("button");
  clearDue.className = "mini-btn"; clearDue.textContent = "Clear";
  clearDue.addEventListener("click", () => setDue(item, "", main));
  dueRow.appendChild(dateInput); dueRow.appendChild(clearDue);

  const dayRow = document.createElement("div");
  dayRow.className = "detail-row";
  dayRow.innerHTML = `<span class="detail-label">My Day</span>`;
  const dayBtn = document.createElement("button");
  dayBtn.className = "mini-btn" + (inMyDay(item) ? " on" : "");
  dayBtn.innerHTML = inMyDay(item) ? "&#9728; In My Day — remove" : "&#9728; Add to My Day";
  dayBtn.addEventListener("click", async () => {
    try { const now = await toggleLabel(item, MYDAY_LABEL, dayBtn); toast(now ? "Added to My Day" : "Removed from My Day"); main.querySelector(".detail")?.remove(); render(); } catch {}
  });
  dayRow.appendChild(dayBtn);

  const agentRow = document.createElement("div");
  agentRow.className = "detail-row wrap";
  agentRow.innerHTML = `<span class="detail-label">Agent</span>`;
  for (const a of AGENTS) {
    const b = document.createElement("button");
    b.className = "mini-btn" + (item.agents.includes(a.key) ? " on" : "");
    b.textContent = a.label;
    b.addEventListener("click", () => toggleAgent(item, a.key, b));
    agentRow.appendChild(b);
  }

  const flagRow = document.createElement("div");
  flagRow.className = "detail-row wrap";
  flagRow.innerHTML = `<span class="detail-label">Flag</span>`;
  for (const f of FLAGS) {
    const b = document.createElement("button");
    b.className = "mini-btn" + (item.labels.includes(f.label) ? " on" : "");
    b.textContent = f.text;
    b.addEventListener("click", async () => {
      try { const now = await toggleLabel(item, f.label, b); toast(now ? `Flagged: ${f.text}` : `Cleared: ${f.text}`); render(); } catch {}
    });
    flagRow.appendChild(b);
  }

  box.appendChild(dueRow); box.appendChild(dayRow); box.appendChild(agentRow); box.appendChild(flagRow);
  main.appendChild(box);
}

// ---- Actions ----
async function toggleDone(item, li) {
  const goingDone = !item.done;
  item.done = goingDone;
  li.classList.toggle("is-done", goingDone);
  try {
    await gql(goingDone ? CLOSE_ISSUE : REOPEN_ISSUE, { id: item.issueId });
    toast(goingDone ? `Completed #${item.number}` : `Reopened #${item.number}`);
    render(); renderHome();
  } catch (err) { item.done = !goingDone; li.classList.toggle("is-done", !goingDone); handleError(err); }
}
async function setDue(item, date, main) {
  const prev = item.due; item.due = date || null;
  try {
    if (date) { await gql(SET_DUE, { p: PROJECT_ID, i: item.itemId, f: FIELD_DUE, d: date }); toast(`Due ${formatDue(date)}`); }
    else { await gql(CLEAR_DUE, { p: PROJECT_ID, i: item.itemId, f: FIELD_DUE }); toast("Due cleared"); }
    main.querySelector(".detail")?.remove(); render(); renderHome();
  } catch (err) { item.due = prev; handleError(err); }
}
// Add/remove a label (REST). Returns new on/off. Keeps item.labels + item.agents synced.
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
  } catch (err) { if (btn) btn.classList.toggle("on", on); handleError(err); throw err; }
}
async function toggleAgent(item, key, btn) {
  try { const now = await toggleLabel(item, agentLabel(key), btn); toast(now ? `Assigned ${agentName(key)}` : `Unassigned ${agentName(key)}`); render(); renderHome(); } catch {}
}

// ---- UI helpers ----
let toastTimer;
function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2000); }
function handleError(err) {
  const target = current ? statusEl : homeStatusEl;
  if (err.message === "NO_TOKEN" || err.message === "BAD_TOKEN") {
    openSettings();
    target.textContent = err.message === "BAD_TOKEN" ? "Token rejected (401). Check it." : "Add a token.";
  } else { target.textContent = "Error: " + err.message; toast("Error: " + err.message); }
}
function openSettings() { tokenInput.value = getToken(); settingsEl.hidden = false; }
function closeSettings() { settingsEl.hidden = true; }

// ---- Wiring ----
$("#homeSettingsBtn").addEventListener("click", openSettings);
$("#refreshBtn").addEventListener("click", load);
$("#backBtn").addEventListener("click", goHome);
$("#searchBtn").addEventListener("click", () => openList({ type: "search", key: "search", title: "Search" }));
searchInput.addEventListener("input", () => { searchText = searchInput.value; render(); });
$("#saveTokenBtn").addEventListener("click", () => { const t = tokenInput.value.trim(); if (t) setToken(t); closeSettings(); load(); });
$("#clearTokenBtn").addEventListener("click", () => { clearToken(); tokenInput.value = ""; toast("Token cleared"); });
settingsEl.addEventListener("click", (e) => { if (e.target === settingsEl) closeSettings(); });
completedToggleEl.addEventListener("click", () => { completedOpen = !completedOpen; render(); });

// ---- Go ----
load();
