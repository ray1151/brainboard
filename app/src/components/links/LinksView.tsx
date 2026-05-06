import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Link2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { SavedLink, linkId, saveLink, deleteLink } from '../../lib/links';
import { Note, upsertNote, deleteNote } from '../../lib/notes';
import { LinkCard } from './LinkCard';

// Shape returned by the Rust cmd_fetch_link_preview command
interface LinkPreviewResponse {
    url: string;
    title: string;
    description: string;
    thumbnail_url: string;
    domain: string;
    type: string;
}

interface LinksViewProps {
    links: Record<string, SavedLink>;
    setLinks: React.Dispatch<React.SetStateAction<Record<string, SavedLink>>>;
    notes: Record<string, Note>;
    setNotes: React.Dispatch<React.SetStateAction<Record<string, Note>>>;
}

export function LinksView({ links, setLinks, notes, setNotes }: LinksViewProps) {
    const [isPasting, setIsPasting] = useState(false);
    const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

    const handlePasteLink = useCallback(async () => {
        let url: string;
        try {
            url = (await navigator.clipboard.readText()).trim();
        } catch {
            toast.error('Could not read clipboard');
            return;
        }
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            toast.error('Clipboard does not contain a URL');
            return;
        }
        const id = linkId(url);
        if (links[id]) {
            toast('Link already saved');
            return;
        }
        setIsPasting(true);
        try {
            const preview = await invoke<LinkPreviewResponse>('cmd_fetch_link_preview', { url });
            const data: Omit<SavedLink, 'savedAt'> = {
                url,
                title: preview.title || preview.domain,
                description: preview.description,
                thumbnailUrl: preview.thumbnail_url,
                domain: preview.domain,
                type: preview.type as SavedLink['type'],
            };
            const savedId = await saveLink(data);
            setLinks(prev => ({ ...prev, [savedId]: { ...data, savedAt: Date.now() } }));
            toast.success('Link saved');
        } catch (e) {
            toast.error(`Couldn't fetch preview: ${e}`);
        } finally {
            setIsPasting(false);
        }
    }, [links, setLinks]);

    const handleDelete = useCallback(async (id: string) => {
        await deleteLink(id);
        setLinks(prev => { const n = { ...prev }; delete n[id]; return n; });
    }, [setLinks]);

    const handleSaveNote = useCallback(async (id: string, text: string, color: string) => {
        const trimmed = text.trim();
        if (trimmed === '') {
            await deleteNote(id);
            setNotes(prev => { const n = { ...prev }; delete n[id]; return n; });
        } else {
            await upsertNote(id, trimmed, color);
            const now = Date.now();
            setNotes(prev => ({
                ...prev,
                [id]: { text: trimmed, color, createdAt: prev[id]?.createdAt ?? now, updatedAt: now },
            }));
        }
        setEditingNoteId(null);
    }, [setNotes]);

    const entries = Object.entries(links).sort(([, a], [, b]) => b.savedAt - a.savedAt);

    // Empty state
    if (entries.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-brand-subtext">
                <Link2 className="w-12 h-12 opacity-20" />
                <p className="text-sm font-medium">No saved links yet</p>
                <p className="text-xs opacity-60">Copy a URL, then click Paste Link</p>
                <button
                    onClick={handlePasteLink}
                    disabled={isPasting}
                    className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-white rounded-lg text-sm hover:bg-brand-primary/90 transition disabled:opacity-50"
                >
                    <Plus className="w-4 h-4" />
                    {isPasting ? 'Fetching preview…' : 'Paste Link'}
                </button>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
            {/* Section header */}
            <div className="flex items-center justify-between px-6 py-4 sticky top-0 bg-brand-bg/80 backdrop-blur-sm z-10 border-b border-brand-border">
                <span className="text-xs text-brand-subtext font-medium">
                    {entries.length} {entries.length === 1 ? 'link' : 'links'}
                </span>
                <button
                    onClick={handlePasteLink}
                    disabled={isPasting}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary text-white rounded-lg text-xs font-medium hover:bg-brand-primary/90 transition disabled:opacity-50"
                >
                    <Plus className="w-3 h-3" />
                    {isPasting ? 'Fetching…' : 'Paste Link'}
                </button>
            </div>

            {/* Masonry grid — CSS columns, varying card heights per aspect ratio */}
            <div
                className="px-6 pt-5 pb-8"
                style={{ columns: '3 200px', columnGap: 16 }}
            >
                {entries.map(([id, link]) => (
                    <LinkCard
                        key={id}
                        id={id}
                        link={link}
                        onDelete={handleDelete}
                        note={notes[id] ?? null}
                        editingNoteId={editingNoteId}
                        onStartEditNote={setEditingNoteId}
                        onSaveNote={handleSaveNote}
                        onCancelNote={() => setEditingNoteId(null)}
                    />
                ))}
            </div>
        </div>
    );
}
