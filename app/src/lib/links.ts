import { Store } from '@tauri-apps/plugin-store';

export interface SavedLink {
    url: string;
    title: string;
    description: string;
    thumbnailUrl: string;
    domain: string;
    type: 'youtube' | 'instagram' | 'twitter' | 'generic';
    savedAt: number;
}

const STORE_FILE = 'brainboard-links.json';
let _store: Store | null = null;

async function getStore(): Promise<Store> {
    if (!_store) _store = await Store.load(STORE_FILE);
    return _store;
}

// djb2 hash → deterministic short ID; same URL always gets same ID
export function linkId(url: string): string {
    let h = 0;
    for (let i = 0; i < url.length; i++) {
        h = Math.imul(31, h) + url.charCodeAt(i) | 0;
    }
    return `link_${Math.abs(h).toString(36)}`;
}

export async function getAllLinks(): Promise<Record<string, SavedLink>> {
    const store = await getStore();
    return (await store.get<Record<string, SavedLink>>('links')) ?? {};
}

export async function saveLink(data: Omit<SavedLink, 'savedAt'>): Promise<string> {
    const store = await getStore();
    const links = await getAllLinks();
    const id = linkId(data.url);
    links[id] = { ...data, savedAt: Date.now() };
    await store.set('links', links);
    await store.save();
    return id;
}

export async function deleteLink(id: string): Promise<void> {
    const store = await getStore();
    const links = await getAllLinks();
    delete links[id];
    await store.set('links', links);
    await store.save();
}
