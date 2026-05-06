// Stubbed — will be removed in Step 6 (per-folder link detection replaces this view)
import { SavedLink } from '../../lib/links';
import { Note } from '../../lib/notes';

interface LinksViewProps {
    links: Record<string, SavedLink>;
    setLinks: React.Dispatch<React.SetStateAction<Record<string, SavedLink>>>;
    notes: Record<string, Note>;
    setNotes: React.Dispatch<React.SetStateAction<Record<string, Note>>>;
}

export function LinksView(_props: LinksViewProps) {
    return null;
}
