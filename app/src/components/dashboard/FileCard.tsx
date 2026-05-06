import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { Folder, Eye, Trash2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { TelegramFile } from '../../types';
import { FileTypeIcon } from '../FileTypeIcon';
import { Note } from '../../lib/notes';

interface FileCardProps {
    file: TelegramFile;
    onDelete: () => void;
    onDownload: () => void;
    onPreview?: () => void;
    isSelected: boolean;
    onClick?: (e: React.MouseEvent) => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    onDrop?: (e: React.DragEvent, folderId: number) => void;
    onDragStart?: (fileId: number) => void;
    onDragEnd?: () => void;
    activeFolderId?: number | null;
    height?: number;
    onToggleSelection?: () => void;
    note?: Note | null;
    setNotes?: React.Dispatch<React.SetStateAction<Record<string, Note>>>;
    editingFileId?: number | null;
    onStartEditNote?: (id: number) => void;
    onSaveNote?: (id: number, text: string, color: string) => void;
}

// Check if file is an image type that can have a thumbnail
function isImageFile(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
}

const NOTE_COLORS: Record<string, { bg: string; fold: string }> = {
    yellow: { bg: '#FFE082', fold: '#FFCD3F' },
    pink:   { bg: '#FFB8C8', fold: '#FF9CB6' },
    blue:   { bg: '#B8D4FF', fold: '#91BCFF' },
    green:  { bg: '#B8E8C0', fold: '#91D9A0' },
};

const NOTE_SIZE = 80;
const FOLD = 18;

function StickyNoteOverlay({ note, onClick }: { note: Note; onClick: () => void }) {
    const colors = NOTE_COLORS[note.color] ?? NOTE_COLORS.yellow;
    const bodyPath = `M0,0 L${NOTE_SIZE},0 L${NOTE_SIZE},${NOTE_SIZE - FOLD} L${NOTE_SIZE - FOLD},${NOTE_SIZE} L0,${NOTE_SIZE} Z`;
    const foldPath = `M${NOTE_SIZE},${NOTE_SIZE - FOLD} L${NOTE_SIZE - FOLD},${NOTE_SIZE} L${NOTE_SIZE},${NOTE_SIZE} Z`;

    return (
        <div
            className="absolute cursor-pointer"
            style={{ bottom: -8, right: -8, width: NOTE_SIZE, height: NOTE_SIZE, zIndex: 15, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))' }}
            onClick={(e) => { e.stopPropagation(); onClick(); }}
        >
            <svg width={NOTE_SIZE} height={NOTE_SIZE} viewBox={`0 0 ${NOTE_SIZE} ${NOTE_SIZE}`} style={{ position: 'absolute', top: 0, left: 0 }}>
                <path d={bodyPath} fill={colors.bg} />
                <path d={foldPath} fill={colors.fold} />
            </svg>
            <div style={{
                position: 'absolute',
                top: 6,
                left: 6,
                right: FOLD + 6,
                bottom: FOLD + 6,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '9px',
                lineHeight: '1.4',
                color: '#1A1A1A',
                overflow: 'hidden',
                wordBreak: 'break-word',
                userSelect: 'none',
            }}>
                {note.text}
            </div>
        </div>
    );
}

const NOTE_COLOR_ORDER = ['yellow', 'pink', 'blue', 'green'] as const;

function NoteEditor({ note, onSave }: { note: Note | null; onSave: (text: string, color: string) => void }) {
    const [text, setText] = useState(note?.text ?? '');
    const [color, setColor] = useState(note?.color ?? 'yellow');
    const bgColor = NOTE_COLORS[color]?.bg ?? NOTE_COLORS.yellow.bg;

    return (
        <div
            style={{
                position: 'absolute', bottom: -8, right: -8,
                width: 120, height: 145, zIndex: 20,
                background: bgColor,
                border: '2px solid #4F46E5',
                borderRadius: 4,
                padding: 6,
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                display: 'flex', flexDirection: 'column', gap: 6,
            }}
            onClick={(e) => e.stopPropagation()}
        >
            <textarea
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onBlur={() => onSave(text, color)}
                style={{
                    flex: 1,
                    background: 'transparent', border: 'none', outline: 'none', resize: 'none',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '10px', lineHeight: '1.4', color: '#1A1A1A', padding: 0,
                }}
            />
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, flexShrink: 0 }}>
                {NOTE_COLOR_ORDER.map((c) => (
                    <button
                        key={c}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setColor(c)}
                        style={{
                            width: 16, height: 16, borderRadius: '50%',
                            background: NOTE_COLORS[c].bg,
                            border: '1px solid #E5DFD3',
                            outline: color === c ? '2px solid #4F46E5' : 'none',
                            outlineOffset: '1px',
                            cursor: 'pointer', padding: 0, flexShrink: 0,
                        }}
                    />
                ))}
            </div>
        </div>
    );
}

export function FileCard({ file, onDelete, onDownload, onPreview, isSelected, onClick, onContextMenu, onDrop, onDragStart, onDragEnd, activeFolderId, height, onToggleSelection, note, editingFileId, onStartEditNote, onSaveNote }: FileCardProps) {
    const isFolder = file.type === 'folder';
    const [isDragOver, setIsDragOver] = useState(false);
    const [thumbnail, setThumbnail] = useState<string | null>(null);
    const [thumbnailLoading, setThumbnailLoading] = useState(false);

    useEffect(() => { console.log('[ID]', file.id, file.name); }, [file.id, file.name]);

    // Lazy load thumbnail for image files
    useEffect(() => {
        if (isFolder || !isImageFile(file.name)) return;

        let cancelled = false;
        setThumbnailLoading(true);

        invoke<string>('cmd_get_thumbnail', {
            messageId: file.id,
            folderId: activeFolderId
        }).then((result) => {
            if (!cancelled && result) {
                setThumbnail(result);
            }
        }).catch(() => {
            // Silently fail - will show icon instead
        }).finally(() => {
            if (!cancelled) setThumbnailLoading(false);
        });

        return () => { cancelled = true; };
    }, [file.id, file.name, activeFolderId, isFolder]);

    return (
        <div
            className="relative"
            onContextMenu={onContextMenu}
            onClick={onClick}
            onDragOver={(e) => {
                if (isFolder) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!isDragOver) setIsDragOver(true);
                }
            }}
            onDragLeave={(e) => {
                if (isFolder) {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragOver(false);
                }
            }}
            onDrop={(e) => {
                if (isFolder && onDrop) {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragOver(false);
                    onDrop(e, file.id);
                }
            }}
        >
            <motion.div
                layout
                draggable={!isFolder}
                onDragStart={(e: any) => {
                    if (onDragStart) onDragStart(file.id);
                    e.dataTransfer.setData("application/x-brand-file-id", file.id.toString());
                    e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => {
                    if (onDragEnd) onDragEnd();
                }}
                whileHover={{ y: -4 }}
                className={`group cursor-pointer bg-brand-surface rounded-xl overflow-hidden border hover:shadow-[0_4px_20px_rgba(0,0,0,0.2)] transition-all relative
                ${isSelected ? 'border-brand-primary bg-brand-primary/5 ring-1 ring-brand-primary' : 'border-brand-border hover:border-brand-primary/50'}
                ${isDragOver ? 'ring-2 ring-brand-primary bg-brand-primary/20 scale-105' : ''}`}
                style={height ? { height: `${height}px` } : { aspectRatio: '4/3' }}
            >
                {/* Thumbnail or Icon */}
                {thumbnail ? (
                    <div className="absolute inset-0">
                        <img
                            src={thumbnail}
                            alt={file.name}
                            className="w-full h-full object-cover"
                        />
                        {/* Gradient overlay for text readability */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                    </div>
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center p-4">
                        {isFolder ? (
                            <Folder className="w-12 h-12 text-brand-primary" />
                        ) : thumbnailLoading && isImageFile(file.name) ? (
                            <div className="w-8 h-8 border-2 border-brand-primary/30 border-t-brand-primary rounded-full animate-spin" />
                        ) : (
                            <FileTypeIcon filename={file.name} size="lg" />
                        )}
                    </div>
                )}

                {/* Selection Checkmark */}
                <div
                    onClick={(e) => {
                        e.stopPropagation();
                        if (onToggleSelection) onToggleSelection();
                    }}
                    className={`absolute top-2 left-2 w-5 h-5 rounded-full border flex items-center justify-center transition-all z-10 cursor-pointer ${isSelected ? 'bg-brand-primary border-brand-primary' : 'border-white/50 bg-black/30 opacity-0 group-hover:opacity-100'}`}
                >
                    {isSelected && <div className="w-1.5 h-1.5 bg-black rounded-full" />}
                </div>

                {/* File info overlay at bottom */}
                <div className={`absolute bottom-0 left-0 right-0 p-3 ${thumbnail ? 'text-white' : 'text-brand-text'}`}>
                    <h3 className="text-sm font-medium truncate w-full" title={file.name}>{file.name}</h3>
                    <p className={`text-xs mt-0.5 ${thumbnail ? 'text-white/70' : 'text-brand-subtext'}`}>{file.sizeStr}</p>
                </div>

                {/* Quick actions on hover */}
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 z-10">
                    {!note && editingFileId !== file.id && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onStartEditNote?.(file.id); }}
                            className="w-6 h-6 bg-white rounded border-2 border-brand-primary flex items-center justify-center hover:bg-brand-primary/10"
                            title="Add note"
                        >
                            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                                <rect x="0.75" y="0.75" width="7.5" height="9.5" rx="1" stroke="#4F46E5" strokeWidth="1.5"/>
                                <line x1="2.5" y1="3.5" x2="6.5" y2="3.5" stroke="#4F46E5" strokeWidth="1.25" strokeLinecap="round"/>
                                <line x1="2.5" y1="6" x2="5.5" y2="6" stroke="#4F46E5" strokeWidth="1.25" strokeLinecap="round"/>
                            </svg>
                        </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); if (onPreview) onPreview() }} className="file-action-btn p-1 bg-black/50 rounded-full hover:bg-brand-primary hover:text-white text-white/70" title="Preview">
                        <Eye className="w-3 h-3" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onDownload() }} className="file-action-btn p-1 bg-black/50 rounded-full hover:bg-green-500 hover:text-white text-white/70" title="Download">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onDelete() }} className="file-action-btn p-1 bg-black/50 rounded-full hover:bg-red-500 hover:text-white text-white/70" title="Delete">
                        <Trash2 className="w-3 h-3" />
                    </button>
                </div>
            </motion.div>

            {editingFileId === file.id
                ? <NoteEditor note={note ?? null} onSave={(text, color) => onSaveNote?.(file.id, text, color)} />
                : note && <StickyNoteOverlay note={note} onClick={() => onStartEditNote?.(file.id)} />
            }
        </div>
    )
}
