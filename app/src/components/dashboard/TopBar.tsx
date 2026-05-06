import { HardDrive, LayoutGrid, Sun, Moon, FlaskConical } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useTheme } from '../../context/ThemeContext';

interface TopBarProps {
    currentFolderName: string;
    selectedIds: number[];
    onShowMoveModal: () => void;
    onBulkDownload: () => void;
    onBulkDelete: () => void;
    onDownloadFolder: () => void;
    viewMode: 'grid' | 'list';
    setViewMode: (mode: 'grid' | 'list') => void;
    searchTerm: string;
    onSearchChange: (term: string) => void;
}

export function TopBar({
    currentFolderName, selectedIds, onShowMoveModal, onBulkDownload, onBulkDelete,
    onDownloadFolder, viewMode, setViewMode, searchTerm, onSearchChange
}: TopBarProps) {
    const { theme, toggleTheme } = useTheme();

    return (
        <header className="h-14 border-b border-brand-border flex items-center px-4 justify-between bg-brand-surface/80 backdrop-blur-md sticky top-0 z-10" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-4">
                <div className="flex items-center text-sm breadcrumbs text-brand-subtext select-none">
                    <span className="hover:text-brand-text cursor-pointer transition-colors">Start</span>
                    <span className="mx-2">/</span>
                    <span className="text-brand-text font-medium">{currentFolderName}</span>
                </div>
            </div>

            <div className="flex-1 max-w-md mx-4">
                <input
                    type="text"
                    placeholder="Search files..."
                    className="w-full bg-brand-hover border border-brand-border rounded-lg px-3 py-1.5 text-sm text-brand-text placeholder:text-brand-subtext focus:outline-none focus:border-brand-primary/50 transition-colors"
                    value={searchTerm}
                    onChange={(e) => onSearchChange(e.target.value)}
                />
            </div>

            <div className="flex items-center gap-2">
                {selectedIds.length > 0 && (
                    <div className="flex items-center gap-2 mr-4 animate-in fade-in slide-in-from-top-2">
                        <span className="text-xs text-brand-subtext mr-2">{selectedIds.length} Selected</span>
                        <button onClick={onShowMoveModal} className="px-3 py-1.5 bg-brand-primary/20 hover:bg-brand-primary/30 text-brand-primary rounded-md text-xs transition font-medium">Move to...</button>
                        <button onClick={onBulkDownload} className="px-3 py-1.5 bg-brand-hover hover:bg-brand-border rounded-md text-xs text-brand-text transition">Download Selected</button>
                        <button onClick={onBulkDelete} className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-md text-xs transition">Delete</button>
                    </div>
                )}

                {/* TEMP: Phase 4A test — remove after verification */}
                <button
                    onClick={async () => {
                        const tests = [
                            'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                            'https://www.theverge.com/2024/1/11/24034828/nintendo-switch-2-announcement',
                        ];
                        for (const url of tests) {
                            try {
                                const result = await invoke('cmd_fetch_link_preview', { url });
                                console.log('[4B] result:', result);
                            } catch (e) {
                                console.error('[4B] error for', url, ':', e);
                            }
                        }
                    }}
                    className="p-2 hover:bg-brand-hover rounded-md text-brand-subtext hover:text-brand-text transition relative group"
                    title="[DEV] Test YouTube oEmbed"
                >
                    <FlaskConical className="w-5 h-5" />
                </button>

                <button onClick={onDownloadFolder} className="p-2 hover:bg-brand-hover rounded-md text-brand-subtext hover:text-brand-text transition group relative" title="Download Folder">
                    <HardDrive className="w-5 h-5" />
                    <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[10px] bg-brand-surface border border-brand-border px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-lg">
                        Download All Files
                    </span>
                </button>

                <button
                    onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                    className="p-2 hover:bg-brand-hover rounded-md text-brand-subtext hover:text-brand-text transition relative group"
                    title="Toggle Layout"
                >
                    <LayoutGrid className="w-5 h-5" />
                    <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[10px] bg-brand-surface border border-brand-border px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-lg">
                        {viewMode === 'grid' ? 'Switch to List' : 'Switch to Grid'}
                    </span>
                </button>

                <div className="w-px h-6 bg-brand-border mx-1"></div>

                <button
                    onClick={toggleTheme}
                    className="p-2 hover:bg-brand-hover rounded-md text-brand-subtext hover:text-brand-text transition relative group"
                    title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                >
                    {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                    <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[10px] bg-brand-surface border border-brand-border px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-lg">
                        {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                    </span>
                </button>
            </div>
        </header>
    )
}
