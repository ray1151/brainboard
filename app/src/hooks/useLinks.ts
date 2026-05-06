import { useState, useEffect } from 'react';
import { SavedLink, getAllLinks } from '../lib/links';

export function useLinks() {
    const [links, setLinks] = useState<Record<string, SavedLink>>({});

    useEffect(() => {
        getAllLinks().then(setLinks);
    }, []);

    return { links, setLinks };
}
