import { ExternalLink, Trash2 } from 'lucide-react';
import { open } from '@tauri-apps/plugin-shell';
import { SavedLink } from '../../lib/links';
import { Note } from '../../lib/notes';
import { StickyNoteOverlay, NoteEditor } from '../dashboard/FileCard';

// Aspect ratio padding-top values per link type
const ASPECT: Record<string, string> = {
    youtube:   '56.25%',   // 16:9
    instagram: '177.78%',  // 9:16
    twitter:   '125%',     // 4:5
    generic:   '56.25%',   // 16:9
};

// Small sticky-note SVG icon (matches FileCard add-note button)
function NoteIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 9 11" fill="none">
            <rect x="0.75" y="0.75" width="7.5" height="9.5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
            <line x1="2.5" y1="3.5" x2="6.5" y2="3.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
            <line x1="2.5" y1="6" x2="5.5" y2="6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
        </svg>
    );
}

interface LinkCardProps {
    id: string;
    link: SavedLink;
    onDelete: (id: string) => void;
    note?: Note | null;
    editingNoteId?: string | null;
    onStartEditNote?: (id: string) => void;
    onSaveNote?: (id: string, text: string, color: string) => void;
    onCancelNote?: () => void;
}

export function LinkCard({
    id, link, onDelete, note, editingNoteId,
    onStartEditNote, onSaveNote, onCancelNote,
}: LinkCardProps) {
    const paddingTop = ASPECT[link.type] ?? ASPECT.generic;

    return (
        <div style={{ breakInside: 'avoid', marginBottom: 16, position: 'relative' }}>
            {/* Card — clicking anywhere opens the URL */}
            <div
                className="group relative rounded-lg overflow-hidden border border-brand-border hover:border-brand-primary transition-colors cursor-pointer bg-brand-surface"
                style={{ paddingTop }}
                onClick={() => open(link.url)}
            >
                {/* Thumbnail */}
                <div className="absolute inset-0">
                    {link.thumbnailUrl ? (
                        <>
                            <img
                                src={link.thumbnailUrl}
                                alt={link.title}
                                className="w-full h-full object-cover"
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                        </>
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center bg-brand-hover">
                            <ExternalLink className="w-8 h-8 text-brand-subtext/40" />
                        </div>
                    )}
                </div>

                {/* Top-left: link type badge */}
                <div className="absolute top-2 left-2 z-10">
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-black/60 text-white/80 uppercase tracking-wide">
                        {link.type}
                    </span>
                </div>

                {/* Top-right: hover actions */}
                <div className="absolute top-2 right-2 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={(e) => { e.stopPropagation(); open(link.url); }}
                        className="p-1 bg-black/60 rounded-full hover:bg-brand-primary text-white"
                        title="Open in browser"
                    >
                        <ExternalLink className="w-3 h-3" />
                    </button>
                    {!note && editingNoteId !== id && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onStartEditNote?.(id); }}
                            className="p-1 bg-black/60 rounded-full hover:bg-brand-primary text-white"
                            title="Add note"
                        >
                            <NoteIcon />
                        </button>
                    )}
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(id); }}
                        className="p-1 bg-black/60 rounded-full hover:bg-red-500 text-white"
                        title="Delete link"
                    >
                        <Trash2 className="w-3 h-3" />
                    </button>
                </div>

                {/* Bottom: title + domain */}
                <div className="absolute bottom-0 left-0 right-0 p-2.5 z-10">
                    <p className="text-white text-xs font-medium leading-snug line-clamp-2">{link.title}</p>
                    <p className="text-white/50 text-[10px] mt-0.5">{link.domain}</p>
                </div>
            </div>

            {/* Note overlay — outside the card div so it can overflow the border-radius */}
            {editingNoteId === id
                ? <NoteEditor
                    note={note ?? null}
                    onSave={(text, color) => onSaveNote?.(id, text, color)}
                    onCancel={onCancelNote}
                  />
                : note && <StickyNoteOverlay note={note} onClick={() => onStartEditNote?.(id)} />
            }
        </div>
    );
}
