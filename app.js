// Apter Board — a thin mobile face over GitHub Issues + Project #2.
// No build step, no backend. Token lives only in this browser's localStorage.

// ---- Constants (Apter Workboard, queried 2026-06-12) ----
const GRAPHQL = "https://api.github.com/graphql";
const OWNER = "marcellosano";
const REPO = "Apter";
const PROJECT_ID = "PVT_kwHOAGedRc4BaBll"; // Project #2
const FIELD_DUE = "PVTF_lAHOAGedRc4BaBllzhVPu-c"; // DATE
const FOCUS_LABEL = "needs-human";
const TOKEN_KEY = "apter_board_token";
const PRIORITY_RANK = { "P0-now": 0, "P1-next": 1, "P2-later": 2 };

// ---- State ----
let items = []; // [{itemId, issueId, number, title, url, labels[], priority, due}]
let activeFilter = "all";

// ---- DOM ----
const $ = (sel) => document.querySelector(sel);
const listEl = $("#list");
const emptyEl = $("#empty");
const statusEl = $("#status");
const toastEl = $("#toast");
const settingsEl = $("#settings");
const tokenInput = $("#tokenInput");

// ---- Token helpers ----
const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// ---- GraphQL transport ----
async function gql(query, variables = {}) {
  const token = getToken();
  if (!token) throw new Error("NO_TOKEN");
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) throw new Error("BAD_TOKEN");
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data;
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
              id
              number
              title
              url
              state
              labels(first: 20) { nodes { name } }
            }
          }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2FieldCommon { name } }
              }
              ... on ProjectV2ItemFieldDateValue {
                date
                field { ... on ProjectV2FieldCommon { name } }
              }
            }
          }
        }
      }
    }
  }
}`;

const CLOSE_ISSUE = `
mutation($issueId: ID!) {
  closeIssue(input: { issueId: $issueId }) { issue { id state } }
}`;

const SET_DUE = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $date: Date!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
    value: { date: $date }
  }) { projectV2Item { id } }
}`;

const CLEAR_DUE = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
  clearProjectV2ItemFieldValue(input: {
    projectId: $projectId, itemId: $itemId, fieldId: $fieldId
  }) { projectV2Item { id } }
}`;

// ---- Data load ----
async function load() {
  if (!getToken()) {
    openSettings();
    setStatus("Add a GitHub token to get started.");
    return;
  }
  setStatus("Loading…");
  try {
    const data = await gql(ITEMS_QUERY, { projectId: PROJECT_ID });
    const nodes = data?.node?.items?.nodes ?? [];
    items = nodes
      .filter((n) => n.content && n.content.state === "OPEN")
      .map((n) => {
        const fv = n.fieldValues.nodes;
        const priority = fv.find((v) => v.field?.name === "Priority")?.name ?? null;
        const due = fv.find((v) => v.field?.name === "Due")?.date ?? null;
        return {
          itemId: n.id,
          issueId: n.content.id,
          number: n.content.number,
          title: n.content.title,
          url: n.content.url,
          labels: n.content.labels.nodes.map((l) => l.name),
          priority,
          due,
        };
      });
    sortItems();
    render();
  } catch (err) {
    handleError(err);
  }
}

function sortItems() {
  items.sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 9;
    const pb = PRIORITY_RANK[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    const da = a.due ?? "9999-99-99";
    const db = b.due ?? "9999-99-99";
    return da < db ? -1 : da > db ? 1 : 0;
  });
}

// ---- Filtering ----
function visibleItems() {
  if (activeFilter === "focus") return items.filter((i) => i.labels.includes(FOCUS_LABEL));
  if (activeFilter === "priority") return items.filter((i) => i.priority === "P0-now" || i.priority === "P1-next");
  if (activeFilter === "duesoon") {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 7);
    const cutoff = horizon.toISOString().slice(0, 10);
    return items.filter((i) => i.due && i.due <= cutoff);
  }
  return items;
}

// ---- Render ----
function render() {
  const vis = visibleItems();
  listEl.innerHTML = "";
  emptyEl.hidden = vis.length > 0;
  for (const item of vis) listEl.appendChild(renderRow(item));
  setStatus(`${vis.length} open${activeFilter === "all" ? "" : ` · ${activeFilter}`}`);
}

function renderRow(item) {
  const li = document.createElement("li");
  li.className = "row";
  li.dataset.itemId = item.itemId;

  // Done circle
  const circle = document.createElement("button");
  circle.className = "circle";
  circle.title = "Mark done";
  circle.setAttribute("aria-label", `Mark issue #${item.number} done`);
  circle.addEventListener("click", () => markDone(item, li));

  // Main
  const main = document.createElement("div");
  main.className = "row-main";

  const title = document.createElement("button");
  title.className = "row-title";
  title.textContent = item.title;
  title.addEventListener("click", () => toggleDueEditor(item, main));

  const meta = document.createElement("div");
  meta.className = "row-meta";
  meta.appendChild(priorityPill(item.priority));
  meta.appendChild(dueChip(item.due));
  const num = document.createElement("span");
  num.className = "num";
  num.textContent = `#${item.number}`;
  meta.appendChild(num);

  main.appendChild(title);
  main.appendChild(meta);
  li.appendChild(circle);
  li.appendChild(main);
  return li;
}

function priorityPill(priority) {
  const span = document.createElement("span");
  const map = { "P0-now": "p0", "P1-next": "p1", "P2-later": "p2" };
  const cls = map[priority] || "none";
  span.className = `pill ${cls}`;
  span.textContent = priority ? priority.split("-")[0] : "—";
  return span;
}

function dueChip(due) {
  const span = document.createElement("span");
  span.className = "due";
  if (!due) {
    span.textContent = "no due";
    return span;
  }
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date();
  soon.setDate(soon.getDate() + 7);
  const soonStr = soon.toISOString().slice(0, 10);
  if (due < today) span.classList.add("overdue");
  else if (due <= soonStr) span.classList.add("soon");
  span.textContent = formatDue(due);
  return span;
}

function formatDue(due) {
  const d = new Date(due + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---- Actions ----
async function markDone(item, li) {
  li.classList.add("is-leaving");
  try {
    await gql(CLOSE_ISSUE, { issueId: item.issueId });
    setTimeout(() => {
      items = items.filter((i) => i.itemId !== item.itemId);
      render();
    }, 250);
    toast(`Closed #${item.number}`);
  } catch (err) {
    li.classList.remove("is-leaving");
    handleError(err);
  }
}

function toggleDueEditor(item, main) {
  const existing = main.querySelector(".due-edit");
  if (existing) {
    existing.remove();
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "due-edit";
  const input = document.createElement("input");
  input.type = "date";
  if (item.due) input.value = item.due;
  input.addEventListener("change", () => setDue(item, input.value, main));
  const clear = document.createElement("button");
  clear.className = "btn btn-ghost";
  clear.textContent = "Clear";
  clear.addEventListener("click", () => setDue(item, "", main));
  wrap.appendChild(input);
  wrap.appendChild(clear);
  main.appendChild(wrap);
}

async function setDue(item, date, main) {
  const prev = item.due;
  item.due = date || null;
  try {
    if (date) {
      await gql(SET_DUE, { projectId: PROJECT_ID, itemId: item.itemId, fieldId: FIELD_DUE, date });
      toast(`Due set to ${formatDue(date)}`);
    } else {
      await gql(CLEAR_DUE, { projectId: PROJECT_ID, itemId: item.itemId, fieldId: FIELD_DUE });
      toast("Due cleared");
    }
    sortItems();
    render();
  } catch (err) {
    item.due = prev;
    handleError(err);
  }
}

// ---- UI helpers ----
function setStatus(msg) { statusEl.textContent = msg; }

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

function handleError(err) {
  if (err.message === "NO_TOKEN" || err.message === "BAD_TOKEN") {
    openSettings();
    setStatus(err.message === "BAD_TOKEN" ? "Token rejected (401). Check it." : "Add a token.");
  } else {
    setStatus("Error: " + err.message);
    toast("Error: " + err.message);
  }
}

function openSettings() {
  tokenInput.value = getToken();
  settingsEl.hidden = false;
}
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
$("#clearTokenBtn").addEventListener("click", () => {
  clearToken();
  tokenInput.value = "";
  toast("Token cleared");
});
settingsEl.addEventListener("click", (e) => {
  if (e.target === settingsEl) closeSettings();
});
$("#filters").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  activeFilter = btn.dataset.filter;
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("is-active", c === btn));
  render();
});

// ---- Go ----
load();
