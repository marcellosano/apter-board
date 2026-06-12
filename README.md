# Apter Board

A thin, mobile-first task surface — a friendly face over **GitHub Issues + the Apter Workboard (Project #2)**. It renders and mutates GitHub directly; there is **no second store** and no backend. GitHub stays the single source of truth.

Built for issue [marcellosano/Apter#33](https://github.com/marcellosano/Apter/issues/33).

## What it does (v1)

- **List** open issues from `marcellosano/Apter`, sorted by **Priority** (P0 → P1 → P2) then **Due** date.
- **Tap the circle** → closes the issue in GitHub → the row disappears.
- **Tap a task** → set / change / clear its **Due** date (Project #2 DATE field) with a native date picker.
- **Saved filters:** *My focus* (`label:needs-human`), *Priority* (P0/P1), *Due soon* (next 7 days).
- Responsive; works on phone and laptop.

Deferred to a later pass: installable PWA (manifest + service worker), offline cache, setting Status → Done on close.

## Setup

### 1. Create a GitHub token

The app stores the token **only in your browser's localStorage** — it is never committed and never sent anywhere except `api.github.com`.

**Recommended — fine-grained PAT** ([create one](https://github.com/settings/personal-access-tokens/new)):
- **Resource owner:** `marcellosano`
- **Repository access:** Only select repositories → `Apter`
- **Repository permissions:** *Issues* → Read and write
- **Account permissions:** *Projects* → Read and write

**Fallback — classic PAT** ([create one](https://github.com/settings/tokens/new)) if the fine-grained token's project writes are rejected: scopes `repo` + `project`.

### 2. Run it

It's plain static files — but ES modules need `http://`, not `file://`.

```bash
# from the repo root
python3 -m http.server 8000
# open http://localhost:8000
```

Click the ⚙️ gear, paste your token, **Save**. The list loads.

### 3. Host it (GitHub Pages)

This repo is public and the app holds no secrets, so free Pages works:
`Settings → Pages → Build from branch → main / root`.
Then open `https://marcellosano.github.io/apter-board/` and add it to your phone's home screen.

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell + settings/token panel |
| `app.js` | All logic — GraphQL query + `closeIssue` / due-date mutations, render, filters |
| `styles.css` | Mobile-first styling |

## Notes

- The Project #2 field IDs (Priority, Due) and project node ID are hard-coded near the top of `app.js`. If the board's fields are rebuilt, refresh them with `gh project field-list 2 --owner marcellosano --format json`.
- All reads/writes go through one GraphQL items query plus `closeIssue` / `updateProjectV2ItemFieldValue` mutations — no extra round-trips.
