import { Store } from '@tauri-apps/plugin-store';

export interface CachedPreview {
    title: string;
    thumbnailUrl: string;
    description: string;
    domain: string;
    type: 'youtube' | 'instagram' | 'twitter' | 'generic';
    fetchedAt: number;
    autoNoted?: boolean;
}

const STORE_FILE = 'brainboard-link-cache.json';

let _store: Store | null = null;

async function getStore(): Promise<Store> {
    if (!_store) {
        _store = await Store.load(STORE_FILE);
    }
    return _store;
}

// djb2-style hash → "link_<base36>" — same algorithm as old links.ts
export function linkId(url: string): string {
    let h = 5381;
    for (let i = 0; i < url.length; i++) {
        h = (((h << 5) + h) ^ url.charCodeAt(i)) >>> 0;
    }
    return `link_${h.toString(36)}`;
}

export async function getCachedPreview(url: string): Promise<CachedPreview | null> {
    const store = await getStore();
    const all = await store.get<Record<string, CachedPreview>>('previews');
    return all?.[linkId(url)] ?? null;
}

export async function upsertCachedPreview(url: string, data: Omit<CachedPreview, 'fetchedAt'>): Promise<void> {
    const store = await getStore();
    const all = (await store.get<Record<string, CachedPreview>>('previews')) ?? {};
    all[linkId(url)] = { ...data, fetchedAt: Date.now() };
    await store.set('previews', all);
    await store.save();
}

export async function clearCache(): Promise<void> {
    const store = await getStore();
    await store.set('previews', {});
    await store.save();
}

/** Mark a URL's cache entry as having had its auto-note created, so it's never recreated. */
export async function markAutoNoted(url: string): Promise<void> {
    const store = await getStore();
    const all = (await store.get<Record<string, CachedPreview>>('previews')) ?? {};
    const id = linkId(url);
    all[id] = all[id]
        ? { ...all[id], autoNoted: true }
        : { title: '', thumbnailUrl: '', description: '', domain: '', type: 'generic', fetchedAt: Date.now(), autoNoted: true };
    await store.set('previews', all);
    await store.save();
}
