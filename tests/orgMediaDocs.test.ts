import { describe, it, expect, vi, beforeEach } from 'vitest';

// The rich-text image transforms: store keys (never signed URLs), sign only our own private
// keys on read, and cap images per document. The storage client is mocked only so importing
// doesn't need env — classify/normalise are pure; signing uses the mocked signer.

const h = vi.hoisted(() => ({ signed: new Map<string, string>() }));

vi.mock('../lib/supabaseServer.js', () => ({
    supabase: {
        storage: {
            from: () => ({
                createSignedUrls: async (keys: string[]) => ({
                    data: keys.map(k => ({ path: k, signedUrl: h.signed.get(k) ?? `signed:${k}` })),
                    error: null,
                }),
            }),
        },
    },
}));

import { normalizeDocMediaForStorage, signDocMediaForClient, assertDocImageCap, MAX_DOC_IMAGES } from '../lib/orgMediaDocs';

const doc = (srcs: string[]) => ({ type: 'doc', content: srcs.map(s => ({ type: 'image', attrs: { src: s } })) });
const srcsOf = (d: any) => (d.content || []).map((n: any) => n.attrs?.src);

beforeEach(() => { h.signed = new Map(); });

describe('normalizeDocMediaForStorage — store keys, keep external', () => {
    it('collapses a private signed URL and a bare key to the key; keeps external images', () => {
        const out = normalizeDocMediaForStorage(doc([
            'https://x/storage/v1/object/sign/org-media/media/wiki/a.webp?token=t',
            'media/wiki/b.webp',
            'https://cdn.example.com/c.png',
        ]));
        expect(srcsOf(out)).toEqual(['media/wiki/a.webp', 'media/wiki/b.webp', 'https://cdn.example.com/c.png']);
    });
});

describe('signDocMediaForClient — swap keys for signed URLs', () => {
    it('signs private keys and leaves external images alone', async () => {
        h.signed.set('media/wiki/a.webp', 'https://signed/a');
        const out = await signDocMediaForClient(doc(['media/wiki/a.webp', 'https://cdn.example.com/c.png']));
        expect(srcsOf(out)).toEqual(['https://signed/a', 'https://cdn.example.com/c.png']);
    });
    it('returns the doc unchanged when there are no private images', async () => {
        const d = doc(['https://cdn.example.com/c.png']);
        expect(await signDocMediaForClient(d)).toBe(d);
    });
});

describe('assertDocImageCap', () => {
    it('throws over the per-document image cap', () => {
        const many = doc(Array.from({ length: MAX_DOC_IMAGES + 1 }, (_, i) => `media/wiki/${i}.webp`));
        expect(() => assertDocImageCap(many)).toThrow(/Too many images/);
    });
    it('allows a document at the cap', () => {
        const ok = doc(Array.from({ length: MAX_DOC_IMAGES }, (_, i) => `media/wiki/${i}.webp`));
        expect(() => assertDocImageCap(ok)).not.toThrow();
    });
});
