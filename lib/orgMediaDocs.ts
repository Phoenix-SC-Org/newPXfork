// Rich-text image transforms between the private bucket and the client.
//
// The database stores the private object KEY for an uploaded rich-text image; clients only
// ever receive short-lived signed URLs.
//   * SAVE: normalise a doc so our private signed-URLs and bare keys collapse to the key;
//     external images (custom URLs, public-bucket URLs, shipped assets) pass through.
//   * READ (only behind the content's permission + clearance gate): replace private keys
//     with freshly-signed URLs so a permitted client can render them.
// See lib/storage.ts classifyOrgMediaRef for how a ref is classified.

import { collectImageSrcs, mapImageSrcs } from './tiptapValidate.js';
import { classifyOrgMediaRef, signOrgMediaUrls } from './storage.js';

/** Cap on distinct images per document — bounds storage + the GC sweep. */
export const MAX_DOC_IMAGES = 50;

/** Throw if a doc references more than the per-doc image cap (enforced on save). */
export function assertDocImageCap(doc: unknown, max = MAX_DOC_IMAGES): void {
    if (collectImageSrcs(doc).size > max) {
        throw new Error(`Too many images in this document (max ${max}).`);
    }
}

/**
 * SAVE normalise: a private ref (our signed URL or bare key) collapses to the bare key;
 * an external image is kept. Returns a new doc (input untouched). Typed loosely so it flows
 * into the Json content column without a cast.
 */
export function normalizeDocMediaForStorage(doc: unknown): any {
    return mapImageSrcs(doc, (src) => {
        const r = classifyOrgMediaRef(src);
        return r.kind === 'own-private' ? r.key : src;
    });
}

/**
 * READ hydrate (only call behind the content's permission + clearance gate): private keys
 * become freshly-signed URLs. Batch-signs in one round-trip. Returns a new doc.
 */
export async function signDocMediaForClient(doc: unknown): Promise<any> {
    if (!doc || typeof doc !== 'object') return doc;
    const keys: string[] = [];
    for (const src of collectImageSrcs(doc)) {
        const r = classifyOrgMediaRef(src);
        if (r.kind === 'own-private') keys.push(r.key);
    }
    if (keys.length === 0) return doc;
    const signed = await signOrgMediaUrls(keys);
    return mapImageSrcs(doc, (src) => {
        const r = classifyOrgMediaRef(src);
        return r.kind === 'own-private' ? (signed.get(r.key) ?? src) : src;
    });
}
