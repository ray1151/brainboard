import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Store } from '@tauri-apps/plugin-store';
import { open } from '@tauri-apps/plugin-shell';
import { X } from 'lucide-react';

const CONFIG_STORE = 'brainboard-config.json';

interface SettingsModalProps {
    onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
    const [keyStatus, setKeyStatus] = useState<'loading' | 'saved' | 'none'>('loading');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        Store.load(CONFIG_STORE).then(store =>
            store.get<string>('apifyKey').then(val => setKeyStatus(val ? 'saved' : 'none'))
        ).catch(() => setKeyStatus('none'));
    }, []);

    const handleSave = async () => {
        const val = inputRef.current?.value.trim() ?? '';
        if (!val) return;
        setSaving(true);
        setSaveError(null);
        try {
            const store = await Store.load(CONFIG_STORE);
            await store.set('apifyKey', val);
            await store.save();
            if (inputRef.current) inputRef.current.value = '';
            setKeyStatus('saved');
        } catch {
            setSaveError('Failed to save. Try again.');
        } finally {
            setSaving(false);
        }
    };

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
            onClick={onClose}
        >
            <div
                className="bg-brand-surface border border-brand-border rounded-xl shadow-2xl p-6 w-80 flex flex-col gap-4"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-brand-text">Settings</h2>
                    <button onClick={onClose} className="text-brand-subtext hover:text-brand-text transition">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-brand-subtext">Apify API Key</label>
                    <input
                        ref={inputRef}
                        type="password"
                        placeholder="paste your Apify key here"
                        className="w-full bg-brand-hover border border-brand-border rounded-lg px-3 py-2 text-sm text-brand-text placeholder:text-brand-subtext focus:outline-none focus:border-brand-primary/50 transition-colors"
                        onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
                    />
                    <div className="flex items-center justify-between mt-0.5">
                        <span className={`text-xs ${keyStatus === 'saved' ? 'text-green-500' : 'text-brand-subtext'}`}>
                            {keyStatus === 'loading' ? '' : keyStatus === 'saved' ? '✓ Key saved' : 'No key set'}
                        </span>
                        <button
                            onClick={() => open('https://console.apify.com/account/integrations')}
                            className="text-xs text-brand-primary hover:underline"
                        >
                            Get Apify key →
                        </button>
                    </div>
                    {saveError && <p className="text-xs text-red-400">{saveError}</p>}
                </div>

                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full py-2 bg-brand-primary hover:bg-brand-primary/90 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition"
                >
                    {saving ? 'Saving…' : 'Save'}
                </button>
            </div>
        </div>,
        document.body
    );
}
