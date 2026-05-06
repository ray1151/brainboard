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
  - JSON file at ~/Library/Application Support/com.cameronamer.telegramdrive/brainboard-notes.json

## Next session
- Phase 3 Step 5D: Keyboard shortcuts (Esc to cancel edit, Cmd+Enter to save)
- Phase 3 Step 6: Polish (animations, empty state messaging)
- Phase 4: Link previews
  - YouTube via oEmbed API (easiest)
  - Open Graph scraping for generic URLs
  - Instagram fallback (manual screenshot or oEmbed via FB app)
  - "Paste link" button in toolbar
  - Click link thumbnail = opens URL in browser
- Phase 2: Logo swap (when logo file ready)

## Tech stack reference
- Tauri (Rust + React)
- TypeScript frontend
- tauri-plugin-store for persistence
- Telegram MTProto via grammers-session
