import { useState, useEffect } from 'react';
import { Note, getAllNotes } from '../lib/notes';

export function useNotes() {
    const [notes, setNotes] = useState<Record<string, Note>>({});

    useEffect(() => {
        getAllNotes().then((loaded) => {
            console.log('[Brainboard] Notes loaded:', loaded);
            setNotes(loaded);
        });
    }, []);

    return { notes, setNotes };
}
