// Daily sweep that reclaims orphaned uploaded images — objects in the media buckets that
// no current field or rich-text document references any more (replaced images, uploads that
// were never saved, and so on).
//
// The whole design is "never delete a live image":
//   * The referenced-key set is built from EVERY place an image can be stored (all settings
//     rows, every image column, and every rich-text document). If any query errors, the run
//     THROWS and is skipped — an incomplete set must never drive deletes. It deliberately
//     avoids the swallow-and-default read path, which could fake an empty set.
//   * A grace window protects just-uploaded objects (upload happens on file-pick, before the
//     form is saved) and in-flight edits; an object with no readable age is kept.
//   * MEDIA_GC_DRY_RUN=true logs what it WOULD delete without deleting.

import { supabase } from './supabaseServer.js';
import { collectImageSrcs, tryParseTiptapJson } from './tiptapValidate.js';
import { classifyOrgMediaRef, orgMediaKeyFromUrl, listOrgMediaObjects, PUBLIC_BUCKET, PRIVATE_BUCKET } from './storage.js';
import { log as baseLog } from './log.js';

const log = baseLog.child({ module: 'lib.orgMediaGc' });

/** Objects younger than this are kept (protects upload-before-save + in-flight edits). */
const GRACE_MS = 48 * 60 * 60 * 1000;

interface ReferencedKeys { public: Set<string>; private: Set<string> }

/**
 * Build the complete set of referenced object keys (split by bucket). THROWS on any query
 * error — the caller must skip the sweep on throw (no deletes on an incomplete set).
 */
async function gatherReferencedKeys(): Promise<ReferencedKeys> {
    const pub = new Set<string>();
    const priv = new Set<string>();

    const addRef = (ref: unknown) => {
        if (typeof ref !== 'string' || !ref) return;
        const parsed = orgMediaKeyFromUrl(ref); // a public URL OR a bare private key
        if (parsed) (parsed.bucket === PUBLIC_BUCKET ? pub : priv).add(parsed.key);
        const c = classifyOrgMediaRef(ref); // also catches a private SIGNED url
        if (c.kind === 'own-private') priv.add(c.key);
    };
    const addDoc = (doc: unknown) => {
        const parsed = typeof doc === 'string' ? tryParseTiptapJson(doc) : doc;
        for (const src of collectImageSrcs(parsed)) addRef(src);
    };
    // Settings values are nested config blobs. Pull every string (image URLs/keys) and every
    // embedded rich-text doc (e.g. the wiki home welcome content) out of them, so no
    // image-bearing settings key can be missed.
    const walkSettingValue = (val: unknown) => {
        if (typeof val === 'string') { addRef(val); return; }
        if (Array.isArray(val)) { for (const v of val) walkSettingValue(v); return; }
        if (val && typeof val === 'object') {
            addDoc(val);
            for (const v of Object.values(val)) walkSettingValue(v);
        }
    };

    // 1) All settings rows (branding, metadata, public page, hero card, wiki home, alliance
    //    self-profile, ...). Read the rows directly so an error throws rather than defaulting.
    const settingsQ = await supabase.from('settings').select('value');
    if (settingsQ.error) throw settingsQ.error;
    for (const row of (settingsQ.data || [])) walkSettingValue((row as { value: unknown }).value);

    // 2) Row image columns. Errors throw (fail-safe).
    const rowQueries = await Promise.all([
        supabase.from('ranks').select('icon_url'),
        supabase.from('units').select('logo_url, banner_url'),
        supabase.from('specialization_tags').select('image_url'),
        supabase.from('certifications').select('image_url'),
        supabase.from('commendations').select('image_url'),
        supabase.from('quartermaster_catalog').select('thumbnail_url, screenshot_url'),
        supabase.from('academy_courses').select('image_url'),
    ]);
    for (const q of rowQueries) { if (q.error) throw q.error; }
    for (const r of (rowQueries[0].data || [])) addRef((r as { icon_url?: string }).icon_url);
    for (const r of (rowQueries[1].data || [])) { addRef((r as { logo_url?: string }).logo_url); addRef((r as { banner_url?: string }).banner_url); }
    for (const r of (rowQueries[2].data || [])) addRef((r as { image_url?: string }).image_url);
    for (const r of (rowQueries[3].data || [])) addRef((r as { image_url?: string }).image_url);
    for (const r of (rowQueries[4].data || [])) addRef((r as { image_url?: string }).image_url);
    for (const r of (rowQueries[5].data || [])) { addRef((r as { thumbnail_url?: string }).thumbnail_url); addRef((r as { screenshot_url?: string }).screenshot_url); }
    for (const r of (rowQueries[6].data || [])) addRef((r as { image_url?: string }).image_url);

    // 3) Rich-text document columns (private keys embedded in bodies). Errors throw.
    const docQueries = await Promise.all([
        supabase.from('wiki_pages').select('content'),
        supabase.from('government_configs').select('constitution_content'),
        supabase.from('government_legislation').select('body'),
    ]);
    for (const q of docQueries) { if (q.error) throw q.error; }
    for (const r of (docQueries[0].data || [])) addDoc((r as { content?: unknown }).content);
    for (const r of (docQueries[1].data || [])) addDoc((r as { constitution_content?: unknown }).constitution_content);
    for (const r of (docQueries[2].data || [])) addDoc((r as { body?: unknown }).body);

    return { public: pub, private: priv };
}

/**
 * List actual objects in both buckets and delete those NOT referenced AND older than the
 * grace window. THROWS if gathering or a listing throws, so the caller skips the run.
 */
async function sweep(now: number, dryRun: boolean): Promise<{ deleted: number; kept: number }> {
    const referenced = await gatherReferencedKeys();
    let deleted = 0;
    let kept = 0;
    const buckets: Array<[string, Set<string>]> = [
        [PUBLIC_BUCKET, referenced.public],
        [PRIVATE_BUCKET, referenced.private],
    ];
    for (const [bucket, refSet] of buckets) {
        const objects = await listOrgMediaObjects(bucket);
        const toDelete: string[] = [];
        for (const obj of objects) {
            if (refSet.has(obj.key)) { kept++; continue; }
            const ageMs = obj.createdAt ? now - new Date(obj.createdAt).getTime() : NaN;
            if (!Number.isFinite(ageMs) || ageMs < GRACE_MS) { kept++; continue; } // unknown age or in grace → keep
            toDelete.push(obj.key);
        }
        if (toDelete.length === 0) continue;
        if (dryRun) {
            log.info('media gc dry-run would delete', { bucket, count: toDelete.length, keys: toDelete.slice(0, 20) });
            continue;
        }
        for (let i = 0; i < toDelete.length; i += 1000) {
            const batch = toDelete.slice(i, i + 1000);
            const { error } = await supabase.storage.from(bucket).remove(batch);
            if (error) { log.warn('media gc delete failed', { err: error, bucket, count: batch.length }); continue; }
            deleted += batch.length;
            log.info('media gc reclaimed', { bucket, count: batch.length });
        }
    }
    return { deleted, kept };
}

/**
 * Reclaim orphaned uploaded images. Fail-safe: any error skips the run (never deletes on an
 * incomplete reference set). Set MEDIA_GC_DRY_RUN=true to log-only. Called from the daily
 * leased cron in server.ts.
 */
export async function runOrgMediaGc(now: number = Date.now()): Promise<void> {
    const dryRun = process.env.MEDIA_GC_DRY_RUN === 'true';
    try {
        const { deleted, kept } = await sweep(now, dryRun);
        log.info('media gc complete', { deleted, kept, dryRun });
    } catch (e) {
        log.warn('media gc skipped (fail-safe — no deletes on error)', { err: e });
    }
}
