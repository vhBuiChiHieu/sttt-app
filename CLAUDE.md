# stt-dk-free — STT → Vietnamese Realtime Translator

Electron + TypeScript + React desktop app. Captures audio → Soniox real-time STT
with one-way translation → Vietnamese caption/panel overlay that floats over any
window. Spec authority: `docs/SPEC.md` (code comments cite `§` sections).

## Commands

| Task | Command |
|------|---------|
| Dev (hot reload, both windows) | `npm run dev` |
| Typecheck | `npm run typecheck` — `tsc -b` |
| Test once | `npm test` — Vitest |
| Test watch | `npm run test:watch` |
| Build | `npm run build` — electron-vite |
| Package Windows installer | `npm run build:win` — electron-builder |

No `.env` / API key needed — Soniox key minted at runtime (see Gotchas).

## Architecture (electron-vite, 3 processes)

| Process | Path | Responsibility |
|---------|------|----------------|
| Main | `src/main/` | Window mgmt, IPC hub, temp-key mint, settings, global hotkeys |
| Preload | `src/preload/` | Context-bridge — exposes typed `IpcApi` to renderer |
| Renderer | `src/renderer/src/` | React UI — **two windows**: control + overlay |

**Two BrowserWindows** (`src/main/windows.ts`):
- **overlay** — transparent, frameless, always-on-top, click-through; shows
  caption (single bar) or panel (scrollback). Runs the Soniox session.
- **control** — frameless rounded settings window (source/lang/appearance/hotkeys).

### Data flow (one session)

1. Control sends `session:start {mode, targetLang}` → Main.
2. Main mints Soniox temp key (`tempKey.ts`) → pushes `session:config` to Overlay.
3. Overlay opens Soniox WS (`soniox/client.ts`); audio capture → PCM → WS.
4. Tokens → `soniox/aggregate.ts` → token/segment stores → caption/panel render.
5. Overlay broadcasts `session:state` (status, ms, tokenCount) → Main relays → Control.

### Renderer modules (`src/renderer/src/`)

| Dir | Contents |
|-----|----------|
| `control/` | Settings App + cards (Source/Language/Overlay/Appearance/Shortcuts) |
| `overlay/` | Overlay App, `useOverlaySession` orchestrator, CaptionBar/FloatingPanel |
| `audio/` | `capture` → `pcm-convert` / `pcm-processor.js` (worklet) → `pipeline` |
| `soniox/` | `client.ts` (WS + reconnect + key refresh) + `aggregate.ts` (token merge) |
| `state/` | zustand: `tokenStore` (+`aggregate`), `sessionStore`, `settingsStore`, `audioStore` |

## Key files

| File | Role |
|------|------|
| `src/shared/types.ts` | Domain types — `Settings`, `DEFAULT_SETTINGS`, `Token`, `SessionStatus`. Dependency-free. |
| `src/shared/ipc.ts` | IPC contract — 11 `CHANNELS` + payloads + `IpcApi`. Edit here first. |
| `src/main/tempKey.ts` | Mints Soniox temp key from Cloudflare worker |
| `src/main/index.ts` | App bootstrap + global hotkey registration |
| `src/renderer/src/soniox/client.ts` | Soniox realtime WS client |
| `docs/SPEC.md`, `SONIOX_API_DOCS.md` | Product spec / Soniox API reference |

## IPC channels (`src/shared/ipc.ts`)

`session:start` `session:stop` `session:config` `session:refresh-key`
`session:state` · `overlay:set-mode` `overlay:set-clickthrough`
`overlay:appearance` · `settings:get` `settings:set` · `app:quit`. Event
subscriptions return an `Unsubscribe`.

## Global hotkeys (`src/main/index.ts`, persisted in `Settings.hotkeys`)

| Key | Action |
|-----|--------|
| Ctrl+Alt+S | Start / stop session |
| Ctrl+Alt+O | Show / hide overlay |
| Ctrl+Alt+L | Toggle overlay click-through lock |
| Ctrl+Alt+M | Cycle caption ↔ panel |

## Domain enums (`src/shared/types.ts`)

- **Capture mode**: `1` = system/loopback audio, `2` = microphone.
- **SessionStatus**: `idle` `connecting` `listening` `reconnecting` `error` `stopped`.
- **translation_status** (render lane): `none` `original` `translation`.
- **overlayMode**: `caption` (live bar) · `panel` (scrollback of `Segment`s).

## Testing

Vitest. Layout: `test/unit/` (U1–U9) + `test/integration/` (I1–I7). Default env
`node`; DOM/WS files opt in per-file with `// @vitest-environment jsdom`. Path
aliases `@shared` `@renderer` `@main` (mirror `electron.vite.config.ts` / tsconfig).
Playwright dep present, E2E not wired yet.

## Gotchas

- **No API key in repo or env.** Minted at runtime by `tempKey.ts` from hardcoded
  `WORKER_URL` (Cloudflare worker). Dev needs network to that worker. Key is
  ephemeral — never persisted (§10/§11).
- Session has a **300-min cap** (§6.3) — `sessionMs` is tracked.
- Settings persisted via electron-store; `setSettings` replaces wholesale, merged
  over `DEFAULT_SETTINGS` (renderer always sends the full object).
- `docs/`, `.claude/`, `AGENTS.md` are **gitignored** → GitNexus skill files in
  the CLI table below are local-only.
- `electron.vite.config.js` / `.d.ts` are build emit — edit the `.ts` source.
- **Loopback capture needs the `media` permission, not `display-capture`.** `getDisplayMedia`
  (system-audio loopback, §5) fires a `media` permission *request* — Electron denies it with
  "Permission denied" before `setDisplayMediaRequestHandler` runs unless `index.ts`'s
  `setPermissionRequestHandler` grants `media`. Also needs `setPermissionCheckHandler` (Chromium
  checks `media` first). Both live in `src/main/index.ts` (`hardenWebContentsGlobally` /
  `registerDisplayMediaHandler`). No mic/getUserMedia path exists, so granting `media` keeps §11.
- **Main-process edits need a full Electron restart** (`Ctrl+C` + `npm run dev`); renderer-only
  changes hot-reload, but `src/main/**` may not pick up without a restart.
- **`session:stop` must always finalize**, even with no live client — a failed start nulls the
  overlay's `client`; if `onSessionStop` early-returns it never broadcasts a terminal `session:state`
  and control's Stop button stays stuck (`isSessionActive('error')` is `true`).

<!-- Project context above is hand-maintained. GitNexus block below is
     auto-generated by `npx gitnexus analyze`; do not edit inside the markers. -->

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **sttt-app** (965 symbols, 2107 relationships, 53 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/sttt-app/context` | Codebase overview, check index freshness |
| `gitnexus://repo/sttt-app/clusters` | All functional areas |
| `gitnexus://repo/sttt-app/processes` | All execution flows |
| `gitnexus://repo/sttt-app/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
