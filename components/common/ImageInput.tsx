import { useRef, useState, type ChangeEvent } from 'react';
import apiService from '../../services/apiService';

// Image field with an "Upload | Paste URL" toggle over a single string value. Upload posts
// the file to /api/org/upload?for=<feature>, where the server checks the signed-in user's
// permission for that feature, re-encodes the image, and returns a URL to store. Paste URL
// keeps the plain custom-URL option (including the shipped-asset /media|/assets|/icons paths
// for fields that allow them). Either way onChange receives a string (or null when cleared),
// so every field keeps its single text column and the server's sanitizeImageUrl write-guard
// still applies.

type Mode = 'upload' | 'url';
type PreviewShape = 'landscape' | 'square' | 'circle';

interface ImageInputProps {
    value: string | null | undefined;
    onChange: (value: string | null) => void;
    /** Selects the bucket + the permission the upload is checked against, server-side. */
    feature: string;
    label?: string;
    placeholder?: string;
    /** Preview aspect: 'landscape' (hero/OG/banner), 'square' (icons/logos), 'circle' (avatars). */
    preview?: PreviewShape;
    /** Hide the built-in thumbnail (for hosts that render their own preview, e.g. AwardIconInput). */
    hidePreview?: boolean;
    id?: string;
    /** Override the text-input className to match a host form's styling. */
    inputClassName?: string;
}

// Client-side sanity cap only. The real per-upload limit is set server-side and is
// configurable (MEDIA_MAX_UPLOAD_BYTES); the server returns a clear message if a file
// exceeds it. This just avoids sending an obviously oversized file.
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

export default function ImageInput({
    value, onChange, feature, label, placeholder = 'https://…', preview = 'landscape', hidePreview, id, inputClassName,
}: ImageInputProps) {
    const fileRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [mode, setMode] = useState<Mode>('upload');
    const [error, setError] = useState<string | null>(null);

    const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        e.target.value = ''; // allow re-selecting the same file after a failure
        if (!f) return;
        setError(null);
        if (f.size > MAX_BYTES) {
            setError('Image is too large.');
            return;
        }
        setBusy(true);
        try {
            const res = await apiService.uploadOrgMedia(f, feature);
            onChange(res.url ?? res.key ?? null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed');
        } finally {
            setBusy(false);
        }
    };

    const previewCls = preview === 'circle'
        ? 'h-16 w-16 rounded-full'
        : preview === 'square'
            ? 'h-16 w-16 rounded-md'
            : 'h-16 w-28 rounded-md';
    const tabCls = (active: boolean) =>
        `px-3 py-1.5 ${active ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`;

    return (
        <div className="space-y-2">
            {label && <label htmlFor={id} className="block text-sm font-medium text-slate-300">{label}</label>}
            <div className="flex items-start gap-3">
                {!hidePreview && (
                    <div className={`shrink-0 overflow-hidden border border-white/10 bg-slate-950/50 flex items-center justify-center ${previewCls}`}>
                        {value
                            ? <img src={value} alt="" className="h-full w-full object-cover" />
                            : <i className="fa-solid fa-image text-slate-500" aria-hidden />}
                    </div>
                )}
                <div className="flex-1 space-y-2">
                    <div className="inline-flex rounded-md border border-white/10 overflow-hidden text-xs font-bold uppercase tracking-widest">
                        <button type="button" onClick={() => setMode('upload')} className={tabCls(mode === 'upload')}>Upload</button>
                        <button type="button" onClick={() => setMode('url')} className={tabCls(mode === 'url')}>Paste URL</button>
                    </div>
                    {mode === 'upload' ? (
                        <div className="flex flex-wrap items-center gap-2">
                            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={onFile} />
                            <button
                                type="button"
                                onClick={() => fileRef.current?.click()}
                                disabled={busy}
                                className="px-3 py-2 rounded-md border border-white/10 text-xs font-bold uppercase tracking-widest text-slate-300 hover:text-white disabled:opacity-50"
                            >
                                {busy ? 'Uploading…' : value ? 'Replace' : 'Choose file'}
                            </button>
                            {value && (
                                <button type="button" onClick={() => onChange(null)} className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-red-400">Clear</button>
                            )}
                            <span className="text-xs text-slate-500">PNG, JPEG, WEBP, GIF or AVIF</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                id={id}
                                value={value || ''}
                                onChange={(e) => onChange(e.target.value)}
                                placeholder={placeholder}
                                className={inputClassName || 'flex-1 bg-slate-700/50 border border-slate-600 rounded-md p-2.5 text-white font-mono text-sm'}
                            />
                            {value && (
                                <button type="button" onClick={() => onChange(null)} className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-red-400">Clear</button>
                            )}
                        </div>
                    )}
                    {error && <p className="text-xs text-red-400">{error}</p>}
                </div>
            </div>
        </div>
    );
}
