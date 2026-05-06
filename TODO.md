# Brainboard - TODO

## Completed (Day 1)
- Phase 1: Color rebrand (indigo + warm off-white palette)
- Phase 3: Sticky notes feature
  - Add note via hover icon on thumbnails
  - Edit existing notes by clicking sticky
  - Delete by clearing text
  - 4-color picker (yellow/pink/blue/green)
  - JetBrains Mono font with peeled-corner SVG design
  - Persistent storage via tauri-plugin-store
  - Keyboard shortcuts: Esc to cancel, Cmd+Enter to save

## Completed (Day 2 - Session 2)
- Phase 4: LinkCards inline in folder grid (no separate sidebar)
  - Telegram WebPage messages detected and typed as links in backend (fs.rs)
  - `FileMetadata` extended: url, caption, og_title, og_description, og_site_name, has_telegram_thumb
  - `linkCache.ts`: djb2-hashed store for OG preview data (brainboard-link-cache.json)
  - `LinkCard` component: thumbnail cascade (Telegram → cache → OG scrape → favicon fallback)
  - YouTube / Instagram / Twitter / generic type detection with correct aspect ratios
  - Click opens URL in default browser via tauri plugin-shell
  - Manual add/edit sticky notes on LinkCards (same UX as FileCards)
  - `cmd_get_link_thumbnail` backend command (Telegram-pre-fetched WebPage photo, base64)
  - Old 4C sidebar/paste-link UI removed (LinksView stubbed out)

## Needs retry (Session 2 leftovers)
- **Auto-sticky-note from message caption** (5C)
  - Logic: for each URL msg, scan forward up to 30s for first TextOnly from same sender
  - If found → auto-create yellow sticky note with that text, mark `autoNoted` in cache
  - Currently the 5C useEffect in LinkCard fires but something in the chain is silently failing
  - Retry fresh — add explicit console logging at each guard condition to find the drop point
- **Instagram thumbnails blank**
  - Apify integration not started yet; have account + API key ready
  - Current fallback shows favicon only — acceptable for now
- **Logo swap** — waiting on logo asset file
- **Production .dmg build** — not started

## Remaining cleanup
- Delete `LinksView.tsx` and `useLinks.ts` and `links.ts` (Step 6) once auto-caption is confirmed working
- Remove `activeSection` / Links nav item from Sidebar/Dashboard

## Tech stack reference
- Tauri 2.x (Rust + React + Vite)
- TypeScript frontend, Tailwind v4
- tauri-plugin-store for persistence
- Telegram MTProto via grammers
