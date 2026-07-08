import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';
import parse from 'html-react-parser';
import MinimalRichEditor from '../../shared/editor/MinimalRichEditor';
import { tryParseTiptapJson, isEmptyTiptapDoc, tiptapJsonToSafeHtml } from '../../../lib/tiptapValidate';

// Lesson content is stored as a Tiptap-JSON string, validated server-side by
// sanitizeTiptapJson (minimal mode), the same shape the public-page blurb uses.
// These wrappers bridge the stored string and MinimalRichEditor's object API so
// instructors get a proper editor with a toolbar and never touch raw HTML.

/** Editable lesson-content field. `value` is the stored JSON string; `onChange`
 *  receives the serialized JSON string to persist. */
export const LessonContentEditor: React.FC<{ value: string; onChange: (next: string) => void }> = ({ value, onChange }) => {
    const initialContent = useMemo(
        () => tryParseTiptapJson(value) ?? undefined,
        // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once; re-seeding on each keystroke would reset the caret mid-edit.
        [],
    );
    return (
        <MinimalRichEditor
            content={initialContent}
            editable
            placeholder="Write the lesson content (headings, lists, bold, and links are supported)"
            onChange={(json) => onChange(JSON.stringify(json))}
        />
    );
};

/** Read-only render of stored lesson content. Returns null for empty/missing
 *  content. The JSON is converted to safe HTML by the shared validator and
 *  re-sanitised with DOMPurify before rendering (defense in depth). */
export const LessonContentView: React.FC<{ value: string | null | undefined; className?: string }> = ({ value, className }) => {
    const html = useMemo(() => {
        const doc = value ? tryParseTiptapJson(value) : null;
        if (!doc || isEmptyTiptapDoc(doc)) return '';
        return tiptapJsonToSafeHtml(doc, 'minimal');
    }, [value]);
    if (!html) return null;
    return <div className={`wiki-editor-content text-sm ${className ?? 'text-slate-300'}`}>{parse(DOMPurify.sanitize(html))}</div>;
};
