import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileCard, NoteEditor, NoteEditorHandle } from './FileCard';
import { LinkCard } from '../links/LinkCard';
import { EmptyState } from './EmptyState';
import { FileTypeIcon } from '../FileTypeIcon';
import { TelegramFile } from '../../types';
import { ContextMenu } from './ContextMenu';
import { FileListItem } from './FileListItem';
import { Note } from '../../lib/notes';
import { getCachedPreview } from '../../lib/linkCache';

type SortField = 'name' | 'size' | 'date';
type SortDirection = 'asc' | 'desc';

interface FileExplorerProps {
    files: TelegramFile[];
    loading: boolean;
    error: Error | null;
    viewMode: 'grid' | 'list';
    selectedIds: number[];
    activeFolderId: number | null;
    notes: Record<string, Note>;
    setNotes: React.Dispatch<React.SetStateAction<Record<string, Note>>>;
    editingFileId: number | null;
    onStartEditNote: (id: number) => void;
    onSaveNote: (id: number, text: string, color: string, noteId?: string) => void;
    onCancelNote: () => void;
    onFileClick: (e: React.MouseEvent, id: number) => void;
    onDelete: (id: number) => void;
    onDownload: (id: number, name: string) => void;
    onPreview: (file: TelegramFile, orderedFiles?: TelegramFile[]) => void;
    onManualUpload: () => void;
    onSelectionClear: () => void;
    onToggleSelection: (id: number) => void;
    onDrop?: (e: React.DragEvent, folderId: number) => void;
    onDragStart?: (fileId: number) => void;
    onDragEnd?: () => void;
}


// ── list-view note modal ──────────────────────────────────────────────────────

type LinkType = 'youtube' | 'instagram' | 'twitter' | 'generic';

function detectLinkType(url: string): LinkType {
    if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
    if (/instagram\.com/i.test(url)) return 'instagram';
    if (/twitter\.com|x\.com/i.test(url)) return 'twitter';
    return 'generic';
}

function ListNoteModal({ file, note, activeFolderId, onSave, onCancel }: {
    file: TelegramFile;
    note: Note | null;
    activeFolderId: number | null;
    onSave: (text: string, color: string) => void;
    onCancel: () => void;
}) {
    const url = file.url ?? '';
    const isLink = !!url;
    const linkType = isLink ? detectLinkType(url) : null;
    const [thumbSrc, setThumbSrc] = useState<string | null>(null);
    const [thumbHover, setThumbHover] = useState(false);
    const editorRef = useRef<NoteEditorHandle>(null);

    useEffect(() => {
        if (!isLink) return;
        let cancelled = false;
        (async () => {
            if (file.has_telegram_thumb) {
                try {
                    const b64 = await invoke<string>('cmd_get_link_thumbnail', {
                        messageId: file.id, folderId: activeFolderId ?? null,
                    });
                    if (!cancelled && b64) { setThumbSrc(b64); return; }
                } catch { /* fall through */ }
            }
            const cached = await getCachedPreview(url);
            if (!cancelled && cached?.thumbnailUrl) { setThumbSrc(cached.thumbnailUrl); return; }
            try {
                const preview = await invoke<{ thumbnail_url: string }>('cmd_fetch_link_preview', { url });
                if (!cancelled && preview.thumbnail_url) { setThumbSrc(preview.thumbnail_url); return; }
            } catch { /* fall through */ }
            if (!cancelled) {
                try {
                    const domain = new URL(url).hostname.replace(/^www\./, '');
                    setThumbSrc(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`);
                } catch { /* fall through */ }
            }
        })();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [url, file.id, file.has_telegram_thumb, activeFolderId]);

    // 16:9 = 240×135 | 9:16 = 157×280 | square file = 180×180
    const thumbW = linkType === 'instagram' ? 157 : isLink ? 240 : 180;
    const thumbH = linkType === 'instagram' ? 280 : isLink ? 135 : 180;
    const isFavicon = thumbSrc?.startsWith('https://www.google.com/s2/favicons') ?? false;
    const title = file.og_title || file.name;

    // Use onMouseDown so we fire before any blur event races; e.preventDefault() keeps
    // textarea focused so NoteEditor's onBlur doesn't fire prematurely.
    const handleThumbDown = (e: React.MouseEvent) => {
        if (!isLink) return;
        e.stopPropagation();
        e.preventDefault();
        editorRef.current?.save(); // save current text/color via imperative handle
        open(url);                 // open in browser
    };

    const thumbPlaceholderBg = linkType === 'instagram'
        ? 'linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045)'
        : 'linear-gradient(135deg, #1a1a2e, #2a2520)';

    return (
        <div
            style={{ display: 'flex', gap: 16, padding: 16 }}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Thumbnail */}
            <div
                onMouseDown={handleThumbDown}
                onMouseEnter={() => isLink && setThumbHover(true)}
                onMouseLeave={() => setThumbHover(false)}
                style={{
                    width: thumbW, height: thumbH, flexShrink: 0,
                    borderRadius: 12, overflow: 'hidden',
                    background: thumbPlaceholderBg,
                    cursor: isLink ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                    transform: thumbHover ? 'scale(1.02)' : 'scale(1)',
                    transition: 'transform 0.15s ease',
                }}
            >
                {thumbSrc && !isFavicon ? (
                    <img
                        src={thumbSrc}
                        alt={title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                    />
                ) : isFavicon && thumbSrc ? (
                    <img src={thumbSrc} alt={title} style={{ width: 40, height: 40, opacity: 0.8, pointerEvents: 'none' }} />
                ) : (
                    <FileTypeIcon filename={file.name} className="w-10 h-10 opacity-50" />
                )}
            </div>

            {/* Title + editor */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
                <p style={{
                    color: '#FAF8F3',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 12, fontWeight: 500,
                    maxWidth: 200, margin: 0,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical' as const,
                    lineHeight: 1.4,
                }}>
                    {title}
                </p>
                <NoteEditor
                    ref={editorRef}
                    note={note}
                    onSave={onSave}
                    onCancel={onCancel}
                    saveOnEsc
                    modal
                />
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────

function useGridColumns(containerRef: React.RefObject<HTMLDivElement | null>) {
    const [columns, setColumns] = useState(4);
    const [containerWidth, setContainerWidth] = useState(800);

    useEffect(() => {
        if (!containerRef.current) return;

        const updateColumns = () => {
            const width = containerRef.current?.clientWidth || 800;
            setContainerWidth(width);
            if (width < 640) setColumns(2);
            else if (width < 768) setColumns(3);
            else if (width < 1024) setColumns(4);
            else if (width < 1280) setColumns(5);
            else setColumns(6);
        };

        updateColumns();
        const observer = new ResizeObserver(updateColumns);
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, [containerRef]);

    return { columns, containerWidth };
}

export function FileExplorer({
    files, loading, error, viewMode, selectedIds, activeFolderId, notes, setNotes,
    editingFileId, onStartEditNote, onSaveNote, onCancelNote,
    onFileClick, onDelete, onDownload, onPreview, onManualUpload, onSelectionClear, onToggleSelection, onDrop, onDragStart, onDragEnd
}: FileExplorerProps) {
    const [sortField, setSortField] = useState<SortField>('date');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: TelegramFile } | null>(null);

    const parentRef = useRef<HTMLDivElement>(null);
    const { columns, containerWidth } = useGridColumns(parentRef);

    const GAP = 6;
    const cardWidth = (containerWidth - (GAP * (columns - 1))) / columns;
    const cardHeight = cardWidth * 0.75; // aspect-[4/3]
    const rowHeight = Math.max(cardHeight + GAP, 150);

    const handleContextMenu = useCallback((e: React.MouseEvent, file: TelegramFile) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, file });
    }, []);

    const sortedFiles = useMemo(() => {
        return [...files].sort((a, b) => {
            let comparison = 0;
            switch (sortField) {
                case 'name':
                    comparison = a.name.localeCompare(b.name);
                    break;
                case 'size':
                    comparison = (a.size || 0) - (b.size || 0);
                    break;
                case 'date':
                    comparison = (a.created_at || '').localeCompare(b.created_at || '');
                    break;
            }
            return sortDirection === 'asc' ? comparison : -comparison;
        });
    }, [files, sortField, sortDirection]);

    const handlePreviewRequest = useCallback((file: TelegramFile) => {
        onPreview(file, sortedFiles);
    }, [onPreview, sortedFiles]);


    const gridRows = useMemo(() => {
        const rows: (TelegramFile | 'upload')[][] = [];
        const itemsWithUpload: (TelegramFile | 'upload')[] = [...sortedFiles, 'upload'];
        for (let i = 0; i < itemsWithUpload.length; i += columns) {
            rows.push(itemsWithUpload.slice(i, i + columns));
        }
        return rows;
    }, [sortedFiles, columns]);


    const listItems = useMemo(() => {
        return activeFolderId === null ? [...sortedFiles, 'upload' as const] : sortedFiles;
    }, [sortedFiles, activeFolderId]);


    const gridVirtualizer = useVirtualizer({
        count: gridRows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: useCallback(() => rowHeight, [rowHeight]),
        overscan: 2,
        gap: GAP,
    });


    useEffect(() => {
        gridVirtualizer.measure();
    }, [rowHeight, gridVirtualizer]);

    const listVirtualizer = useVirtualizer({
        count: listItems.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 48,
        overscan: 5,
    });

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
        return sortDirection === 'asc'
            ? <ArrowUp className="w-3 h-3 text-brand-primary" />
            : <ArrowDown className="w-3 h-3 text-brand-primary" />;
    };

    if (loading) {
        return (
            <div className="flex-1 p-6 flex justify-center items-center text-brand-subtext flex-col gap-4">
                <div className="w-8 h-8 border-4 border-brand-primary border-t-transparent rounded-full animate-spin"></div>
                Loading your files...
            </div>
        )
    }

    if (error) {
        return <div className="flex-1 p-6 flex justify-center items-center text-red-400">Error loading files</div>
    }

    if (files.length === 0) {
        return (
            <div className="flex-1 p-6 overflow-auto">
                <EmptyState onUpload={onManualUpload} />
            </div>
        );
    }

    return (
        <div
            ref={parentRef}
            className="flex-1 p-6 overflow-auto custom-scrollbar"
            onClick={(e) => {
                if (e.target === e.currentTarget) onSelectionClear();
            }}
        >
            {viewMode === 'grid' ? (
                <>

                    <div className="flex items-center gap-2 mb-4 text-xs text-brand-subtext">
                        <span>Sort by:</span>
                        <button
                            onClick={() => handleSort('name')}
                            className={`px-2 py-1 rounded flex items-center gap-1 hover:bg-white/5 ${sortField === 'name' ? 'text-brand-primary' : ''}`}
                        >
                            Name <SortIcon field="name" />
                        </button>
                        <button
                            onClick={() => handleSort('size')}
                            className={`px-2 py-1 rounded flex items-center gap-1 hover:bg-white/5 ${sortField === 'size' ? 'text-brand-primary' : ''}`}
                        >
                            Size <SortIcon field="size" />
                        </button>
                        <button
                            onClick={() => handleSort('date')}
                            className={`px-2 py-1 rounded flex items-center gap-1 hover:bg-white/5 ${sortField === 'date' ? 'text-brand-primary' : ''}`}
                        >
                            Date <SortIcon field="date" />
                        </button>
                    </div>


                    <div
                        className="relative w-full"
                        style={{ height: `${gridVirtualizer.getTotalSize()}px` }}
                    >
                        {gridVirtualizer.getVirtualItems().map((virtualRow) => {
                            const row = gridRows[virtualRow.index];
                            return (
                                <div
                                    key={virtualRow.key}
                                    className="absolute top-0 left-0 w-full grid"
                                    style={{
                                        height: `${cardHeight}px`,
                                        transform: `translateY(${virtualRow.start}px)`,
                                        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                                        gap: `${GAP}px`,
                                    }}
                                >
                                    {row.map((item) => {
                                        if (item === 'upload') {
                                            return (
                                                <button
                                                    key="upload"
                                                    onClick={(e) => { e.stopPropagation(); onManualUpload(); }}
                                                    className="border-2 border-dashed border-brand-border rounded-xl flex flex-col items-center justify-center text-brand-subtext hover:border-brand-primary hover:text-brand-primary transition-all group"
                                                    style={{ height: `${cardHeight}px` }}
                                                >
                                                    <Plus className="w-8 h-8 mb-2 group-hover:scale-110 transition-transform" />
                                                    <span className="text-sm font-medium">Upload File</span>
                                                </button>
                                            );
                                        }
                                        const file = item;
                                        const fileNote = notes[file.note_id ?? String(file.id)] ?? null;
                                        if (file.url) {
                                            return (
                                                <LinkCard
                                                    key={file.id}
                                                    file={file}
                                                    activeFolderId={activeFolderId}
                                                    height={cardHeight}
                                                    onDelete={() => onDelete(file.id)}
                                                    note={fileNote}
                                                    editingFileId={editingFileId}
                                                    onStartEditNote={onStartEditNote}
                                                    onSaveNote={onSaveNote}
                                                    onCancelNote={onCancelNote}
                                                />
                                            );
                                        }
                                        return (
                                            <FileCard
                                                key={file.id}
                                                file={file}
                                                isSelected={selectedIds.includes(file.id)}
                                                onClick={(e) => onFileClick(e, file.id)}
                                                onContextMenu={(e) => handleContextMenu(e, file)}
                                                onDelete={() => onDelete(file.id)}
                                                onDownload={() => onDownload(file.id, file.name)}
                                                onPreview={() => handlePreviewRequest(file)}
                                                onDrop={onDrop}
                                                onDragStart={onDragStart}
                                                onDragEnd={onDragEnd}
                                                activeFolderId={activeFolderId}
                                                height={cardHeight}
                                                onToggleSelection={() => onToggleSelection(file.id)}
                                                note={fileNote}
                                                setNotes={setNotes}
                                                editingFileId={editingFileId}
                                                onStartEditNote={onStartEditNote}
                                                onSaveNote={onSaveNote}
                                                onCancelNote={onCancelNote}
                                            />
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </>
            ) : (
                <div className="flex flex-col w-full">
                    {/* List Header */}
                    <div className="grid grid-cols-[2rem_2fr_6rem_8rem] gap-4 px-4 py-2 text-xs font-semibold text-brand-subtext border-b border-brand-border mb-2 select-none items-center">
                        <div className="text-center">#</div>
                        <button onClick={() => handleSort('name')} className="flex items-center gap-1 hover:text-brand-text transition-colors">
                            Name <SortIcon field="name" />
                        </button>
                        <button onClick={() => handleSort('size')} className="flex items-center gap-1 justify-end hover:text-brand-text transition-colors">
                            Size <SortIcon field="size" />
                        </button>
                        <button onClick={() => handleSort('date')} className="flex items-center gap-1 justify-end hover:text-brand-text transition-colors">
                            Date <SortIcon field="date" />
                        </button>
                    </div>


                    <div
                        className="relative w-full"
                        style={{ height: `${listVirtualizer.getTotalSize()}px` }}
                    >
                        {listVirtualizer.getVirtualItems().map((virtualItem) => {
                            const item = listItems[virtualItem.index];
                            if (item === 'upload') {
                                return (
                                    <div
                                        key="upload"
                                        className="absolute top-0 left-0 w-full"
                                        style={{ transform: `translateY(${virtualItem.start}px)` }}
                                    >
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onManualUpload(); }}
                                            className="flex items-center gap-4 px-4 py-3 rounded-lg cursor-pointer border border-dashed border-brand-border text-brand-subtext hover:text-brand-text hover:bg-brand-hover w-full"
                                        >
                                            <div className="w-5 h-5 flex items-center justify-center"><Plus className="w-4 h-4" /></div>
                                            <span className="text-sm font-medium">Upload File...</span>
                                        </button>
                                    </div>
                                );
                            }
                            const file = item;
                            return (
                                <div
                                    key={file.id}
                                    className="absolute top-0 left-0 w-full"
                                    style={{ transform: `translateY(${virtualItem.start}px)` }}
                                >
                                    <FileListItem
                                        file={file}
                                        selectedIds={selectedIds}
                                        onFileClick={onFileClick}
                                        handleContextMenu={handleContextMenu}
                                        onDragStart={onDragStart}
                                        onDragEnd={onDragEnd}
                                        onDrop={onDrop}
                                        onPreview={handlePreviewRequest}
                                        onDownload={onDownload}
                                        onDelete={onDelete}
                                        note={notes[file.note_id ?? String(file.id)] ?? null}
                                        onStartEditNote={onStartEditNote}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* List-view note editor modal — single portal, only one can be open at a time */}
            {viewMode === 'list' && editingFileId !== null && (() => {
                const editFile = files.find(f => f.id === editingFileId) ?? null;
                if (!editFile) return null;
                const editNote = notes[editFile.note_id ?? String(editingFileId)] ?? null;
                return createPortal(
                    <div
                        className="fixed inset-0 z-50 flex items-center justify-center"
                        style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
                        onClick={() => (document.activeElement as HTMLElement)?.blur()}
                    >
                        <ListNoteModal
                            file={editFile}
                            note={editNote}
                            activeFolderId={activeFolderId}
                            onSave={(text, color) => onSaveNote(editingFileId, text, color, editFile.note_id)}
                            onCancel={onCancelNote}
                        />
                    </div>,
                    document.body
                );
            })()}

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    file={contextMenu.file}
                    onClose={() => setContextMenu(null)}
                    onDownload={() => {
                        onDownload(contextMenu.file.id, contextMenu.file.name);
                        setContextMenu(null);
                    }}
                    onDelete={() => {
                        onDelete(contextMenu.file.id);
                        setContextMenu(null);
                    }}
                    onPreview={() => {
                        if (contextMenu.file.type === 'folder') {
                            onFileClick({ preventDefault: () => { }, stopPropagation: () => { } } as React.MouseEvent, contextMenu.file.id);
                        } else {
                            handlePreviewRequest(contextMenu.file);
                        }
                        setContextMenu(null);
                    }}
                />
            )}
        </div>
    )
}
