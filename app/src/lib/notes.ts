import { Store } from '@tauri-apps/plugin-store';

export interface Note {
    text: string;
    color: string;
    createdAt: number;
    updatedAt: number;
}

const STORE_FILE = 'brainboard-notes.json';

let _store: Store | null = null;

async function getStore(): Promise<Store> {
    if (!_store) {
        _store = await Store.load(STORE_FILE);
    }
    return _store;
}

export async function getAllNotes(): Promise<Record<string, Note>> {
    const store = await getStore();
    const result = await store.get<Record<string, Note>>('notes');
    return result ?? {};
}

export async function getNote(fileId: string): Promise<Note | null> {
    const notes = await getAllNotes();
    return notes[fileId] ?? null;
}

export async function upsertNote(fileId: string, text: string, color: string): Promise<void> {
    const store = await getStore();
    const notes = await getAllNotes();
    const now = Date.now();
    notes[fileId] = {
        text,
        color,
        createdAt: notes[fileId]?.createdAt ?? now,
        updatedAt: now,
    };
    await store.set('notes', notes);
    await store.save();
}

export async function deleteNote(fileId: string): Promise<void> {
    const store = await getStore();
    const notes = await getAllNotes();
    delete notes[fileId];
    await store.set('notes', notes);
    await store.save();
}
