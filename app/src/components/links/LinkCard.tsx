import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { ExternalLink, Trash2, Link2 } from 'lucide-react';
import { TelegramFile } from '../../types';
import { Note } from '../../lib/notes';
import { CachedPreview, getCachedPreview, upsertCachedPreview, markAutoNoted } from '../../lib/linkCache';
import { StickyNoteOverlay, NoteEditor } from '../dashboard/FileCard';

type LinkType = 'youtube' | 'instagram' | 'twitter' | 'generic';

const ASPECT: Record<LinkType, string> = {
    youtube:   '56.25%',
    instagram: '177.78%',
    twitter:   '125%',
    generic:   '56.25%',
};

function detectType(url: string): LinkType {
    if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
    if (/instagram\.com/i.test(url)) return 'instagram';
    if (/twitter\.com|x\.com/i.test(url)) return 'twitter';
    return 'generic';
}

function extractDomain(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return url; }
}

interface LinkPreviewResponse {
    url: string;
    title: string;
    description: string;
    thumbnail_url: string;
    domain: string;
    type: string;
}

export interface LinkCardProps {
    file: TelegramFile;
    activeFolderId?: number | null;
    onDelete: () => void;
    note?: Note | null;
    editingFileId?: number | null;
    onStartEditNote?: (id: number) => void;
    onSaveNote?: (id: number, text: string, color: string, noteId?: string) => void;
    onCancelNote?: () => void;
    /** When provided (grid context), use explicit px height instead of the padding-top ratio trick */
    height?: number;
}

export function LinkCard({
    file, activeFolderId, onDelete, note,
    editingFileId, onStartEditNote, onSaveNote, onCancelNote, height,
}: LinkCardProps) {
    const url = file.url ?? '';
    const linkType = detectType(url);
    const paddingTop = ASPECT[linkType];
    const domain = extractDomain(url);
    // In grid context a fixed height is supplied; freestanding uses the ratio trick
    const cardStyle: React.CSSProperties = height ? { height: `${height}px` } : { paddingTop };

    const [thumbSrc, setThumbSrc] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    // ── 5C: auto-sticky-note from caption ──────────────────────────────────
    useEffect(() => {
        if (!file.caption || !url) {
            console.log('[5C] skip auto-note: no caption', { id: file.id, caption: file.caption });
            return;
        }
        let cancelled = false;
        (async () => {
            const cached = await getCachedPreview(url);
            console.log('[5C] mount check', { id: file.id, caption: file.caption, noteFromProps: note, autoNoted: cached?.autoNoted });
            if (cancelled) return;
            if (note) {
                console.log('[5C] skip: note already exists');
                return;
            }
            if (cached?.autoNoted) {
                console.log('[5C] skip: already autoNoted in cache');
                return;
            }
            console.log('[5C] creating auto-note for', file.id, 'caption:', file.caption);
            onSaveNote?.(file.id, file.caption!, 'yellow');
            await markAutoNoted(url);
            console.log('[5C] markAutoNoted done for', file.id);
        })();
        return () => { cancelled = true; };
    // `note` and `onSaveNote` intentionally excluded: we want this to fire once on mount.
    // `autoNoted` cache flag is the permanent guard against re-creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file.id, file.caption, url]);

    // ── thumbnail loading ───────────────────────────────────────────────────
    useEffect(() => {
        if (!url) { setLoading(false); return; }
        let cancelled = false;
        setLoading(true);
        setThumbSrc(null);

        (async () => {
            // 1. Telegram pre-fetched photo — best quality, no extra network round-trip
            if (file.has_telegram_thumb) {
                try {
                    const b64 = await invoke<string>('cmd_get_link_thumbnail', {
                        messageId: file.id,
                        folderId: activeFolderId ?? null,
                    });
                    if (!cancelled && b64) { setThumbSrc(b64); setLoading(false); return; }
                } catch { /* fall through */ }
            }

            // 2. Local cache hit
            const cached = await getCachedPreview(url);
            if (!cancelled && cached?.thumbnailUrl) {
                setThumbSrc(cached.thumbnailUrl);
                setLoading(false);
                return;
            }

            // 3. OG scrape → save to cache → use thumbnail_url
            try {
                const preview = await invoke<LinkPreviewResponse>('cmd_fetch_link_preview', { url });
                const data: Omit<CachedPreview, 'fetchedAt'> = {
                    title: preview.title || file.og_title || domain,
                    thumbnailUrl: preview.thumbnail_url,
                    description: preview.description || file.og_description || '',
                    domain: preview.domain || domain,
                    type: (preview.type as LinkType) || linkType,
                    autoNoted: false,
                };
                await upsertCachedPreview(url, data);
                if (!cancelled && preview.thumbnail_url) {
                    setThumbSrc(preview.thumbnail_url);
                    setLoading(false);
                    return;
                }
            } catch { /* fall through */ }

            // 4. Google favicon fallback
            if (!cancelled) {
                setThumbSrc(
                    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`
                );
                setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    // file.og_title / og_description captured at call time as cache fallbacks; don't re-trigger fetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [url, file.id, file.has_telegram_thumb, activeFolderId]);

    const displayTitle = file.og_title || file.name;
    const isFavicon = thumbSrc?.startsWith('https://www.google.com/s2/favicons') ?? false;

    return (
        <div style={{ position: 'relative' }}>
            <div
                className="group relative rounded-lg overflow-hidden border border-brand-border hover:border-brand-primary/50 transition-colors cursor-pointer bg-brand-surface"
                style={cardStyle}
                onClick={() => open(url)}
            >
                {/* Thumbnail */}
                <div className="absolute inset-0">
                    {loading ? (
                        <div className="w-full h-full bg-brand-hover animate-pulse" />
                    ) : thumbSrc && !isFavicon ? (
                        <>
                            <img
                                src={thumbSrc}
                                alt={displayTitle}
                                className="w-full h-full object-cover"
                                onError={() => setThumbSrc(null)}
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                        </>
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center bg-brand-hover">
                            {isFavicon && thumbSrc ? (
                                <img src={thumbSrc} alt={domain} className="w-12 h-12 opacity-60" />
                            ) : (
                                <Link2 className="w-8 h-8 text-brand-subtext/40" />
                            )}
                        </div>
                    )}
                </div>

                {/* Top-left: chain-link icon + type badge */}
                <div className="absolute top-2 left-2 z-10 flex items-center gap-1">
                    <Link2 className="w-3 h-3 text-white/80 drop-shadow" />
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-black/60 text-white/80 uppercase tracking-wide">
                        {linkType}
                    </span>
                </div>

                {/* Top-right: hover actions */}
                <div className="absolute top-2 right-2 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={(e) => { e.stopPropagation(); open(url); }}
                        className="p-1 bg-black/60 rounded-full hover:bg-brand-primary text-white"
                        title="Open in browser"
                    >
                        <ExternalLink className="w-3 h-3" />
                    </button>
                    {!note && editingFileId !== file.id && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onStartEditNote?.(file.id); }}
                            className="p-1 bg-black/60 rounded-full hover:bg-brand-primary text-white"
                            title="Add note"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 9 11" fill="none">
                                <rect x="0.75" y="0.75" width="7.5" height="9.5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                                <line x1="2.5" y1="3.5" x2="6.5" y2="3.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
                                <line x1="2.5" y1="6" x2="5.5" y2="6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
                            </svg>
                        </button>
                    )}
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(); }}
                        className="p-1 bg-black/60 rounded-full hover:bg-red-500 text-white"
                        title="Delete"
                    >
                        <Trash2 className="w-3 h-3" />
                    </button>
                </div>

                {/* Bottom: title + domain + optional source badge */}
                <div className="absolute bottom-0 left-0 right-0 p-2.5 z-10">
                    <p className="text-white text-xs font-medium leading-snug line-clamp-2 drop-shadow">
                        {displayTitle}
                    </p>
                    <div className="flex items-center justify-between mt-0.5 gap-1 min-w-0">
                        <p className="text-white/50 text-[10px] shrink-0">{domain}</p>
                        {file.folder_name && (
                            <span
                                className="truncate"
                                style={{
                                    background: '#E5DFD3', color: '#1A1A1A',
                                    fontFamily: "'JetBrains Mono', monospace",
                                    fontSize: '9px', lineHeight: 1,
                                    padding: '2px 5px', borderRadius: 999,
                                    maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    flexShrink: 1,
                                }}
                            >
                                {file.folder_name}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Sticky note — outside card div so it can overflow the rounded corners */}
            {editingFileId === file.id
                ? <NoteEditor
                    note={note ?? null}
                    onSave={(text, color) => onSaveNote?.(file.id, text, color, file.note_id)}
                    onCancel={onCancelNote}
                  />
                : note && <StickyNoteOverlay note={note} onClick={() => onStartEditNote?.(file.id)} />
            }
        </div>
    );
}
