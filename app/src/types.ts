export interface TelegramFile {
    id: number;
    name: string;
    size: number;
    sizeStr: string;
    created_at?: string;
    type?: 'folder' | 'file';
    url?: string;
    caption?: string;
    og_title?: string;
    og_description?: string;
    og_site_name?: string;
    has_telegram_thumb?: boolean;
}

export interface TelegramFolder {
    id: number;
    name: string;
    parent_id?: number;
}

export interface QueueItem {
    id: string;
    path: string;
    folderId: number | null;
    status: 'pending' | 'uploading' | 'success' | 'error' | 'cancelled';
    error?: string;
    progress?: number; // 0-100
}

export interface BandwidthStats {
    up_bytes: number;
    down_bytes: number;
}

export interface DownloadItem {
    id: string;
    messageId: number;
    filename: string;
    folderId: number | null;
    status: 'pending' | 'downloading' | 'success' | 'error' | 'cancelled';
    error?: string;
    progress?: number; // 0-100
}
