import { useState } from 'react';
import { Folder, Eye, HardDrive, Plus } from 'lucide-react';
import { TelegramFile } from '../../types';
import { FileTypeIcon } from '../FileTypeIcon';
import { Note } from '../../lib/notes';
import { NOTE_COLORS } from './FileCard';

function NoteDot({ note, onClick }: { note: Note; onClick: (e: React.MouseEvent) => void }) {
    const colors = NOTE_COLORS[note.color] ?? NOTE_COLORS.yellow;
    return (
        <button
            onClick={(e) => { e.stopPropagation(); onClick(e); }}
            title="Edit note"
            className="flex-shrink-0 rounded-full"
            style={{ width: 8, height: 8, background: colors.bg, border: `1px solid ${colors.fold}` }}
        />
    );
}

interface FileListItemProps {
    file: TelegramFile;
    selectedIds: number[];
    onFileClick: (e: React.MouseEvent, id: number) => void;
    handleContextMenu: (e: React.MouseEvent, file: TelegramFile) => void;
    onDragStart?: (fileId: number) => void;
    onDragEnd?: () => void;
    onDrop?: (e: React.DragEvent, folderId: number) => void;
    onPreview: (file: TelegramFile) => void;
    onDownload: (id: number, name: string) => void;
    onDelete: (id: number) => void;
    note?: Note | null;
    onStartEditNote?: (id: number) => void;
}

export function FileListItem({
    file, selectedIds, onFileClick, handleContextMenu,
    onDragStart, onDragEnd, onDrop,
    onPreview, onDownload, onDelete, note, onStartEditNote,
}: FileListItemProps) {
    const [isDragOver, setIsDragOver] = useState(false);
    const isFolder = file.type === 'folder';

    return (
        <div
            onClick={(e) => onFileClick(e, file.id)}
            onContextMenu={(e) => handleContextMenu(e, file)}
            draggable
            onDragStart={(e) => {
                if (onDragStart) onDragStart(file.id);
                e.dataTransfer.setData("application/x-brand-file-id", file.id.toString());
                e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => { if (onDragEnd) onDragEnd(); }}
            onDragOver={(e) => {
                if (isFolder) { e.preventDefault(); e.stopPropagation(); if (!isDragOver) setIsDragOver(true); }
            }}
            onDragLeave={(e) => {
                if (isFolder) { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }
            }}
            onDrop={(e) => {
                if (isFolder && onDrop) { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); onDrop(e, file.id); }
            }}
            className={`group grid grid-cols-[2rem_2fr_6rem_8rem] gap-4 items-center px-4 py-3 rounded-lg cursor-pointer border border-transparent transition-all hover:bg-brand-hover
                ${selectedIds.includes(file.id) ? 'bg-brand-primary/10 border-brand-primary/20' : ''}
                ${isDragOver ? 'ring-2 ring-brand-primary bg-brand-primary/20' : ''}
            `}
        >
            <div className="flex justify-center">
                {isFolder
                    ? <Folder className="w-5 h-5 text-brand-primary" />
                    : <FileTypeIcon filename={file.name} className="w-5 h-5" />}
            </div>

            <div className="flex items-center gap-1.5 min-w-0 relative pr-8">
                <span className="truncate text-sm text-brand-text font-medium">{file.name}</span>
                {note && <NoteDot note={note} onClick={() => onStartEditNote?.(file.id)} />}
                {/* Hover actions */}
                <div className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex items-center bg-brand-surface border border-brand-border shadow-lg rounded px-1">
                    <button onClick={(e) => { e.stopPropagation(); onPreview(file); }} className="p-1 hover:text-brand-text text-brand-subtext" title="Preview"><Eye className="w-4 h-4" /></button>
                    <button onClick={(e) => { e.stopPropagation(); onDownload(file.id, file.name); }} className="p-1 hover:text-brand-text text-brand-subtext" title="Download"><HardDrive className="w-4 h-4" /></button>
                    <button onClick={(e) => { e.stopPropagation(); onDelete(file.id); }} className="p-1 hover:text-red-400 text-brand-subtext" title="Delete"><Plus className="w-4 h-4 rotate-45" /></button>
                </div>
            </div>

            <div className="text-right text-xs text-brand-subtext truncate">{file.sizeStr}</div>
            <div className="text-right text-xs text-brand-subtext font-mono opacity-50 truncate">{file.created_at || '-'}</div>
        </div>
    );
}
