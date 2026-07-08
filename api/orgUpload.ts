// Image-upload endpoint (POST /api/org/upload?for=<feature>).
//
// Served outside the RPC dispatcher because it takes raw image bytes, not a JSON action.
// It runs the same security checks as a mutation: verify the session token (with the
// force-logout and revocation checks the dispatcher applies), reject a cross-site POST,
// require the same permission that gates the feature's write action, throttle per user,
// then magic-byte-check + re-encode the image via uploadOrgMedia. Public features return a
// URL to store; private (wiki/government) features return the object key (signed on read).

import { Request, Response } from 'express';
import { verifyToken, isSessionForceLoggedOut, isSessionRevokedByWatermark } from '../lib/auth.js';
import { getUserById, getPlatformSettings } from '../lib/db.js';
import { isOrgMediaFeature, uploadOrgMedia } from '../lib/storage.js';
import { FEATURE_UPLOAD_PERMS } from './orgUploadPerms.js';
import { log as baseLog } from '../lib/log.js';

const log = baseLog.child({ module: 'api.orgUpload' });

// Per-user upload throttle, on top of the per-IP limiter on the route. The IP limiter
// caps each source address; this caps the identity, so a member behind rotating IPs can't
// flood Storage. Pruned from server.ts's periodic cleanup.
const UPLOAD_PER_USER_MAX = 30;
const UPLOAD_WINDOW_MS = 60_000;
const UPLOAD_MAX_BUCKETS = 50_000;

interface UploadBucket { count: number; windowStart: number }
const userBuckets = new Map<string, UploadBucket>();

function checkUserUploadLimit(userId: number, now: number = Date.now()): { ok: boolean; retryAfter: number } {
    const key = `u:${userId}`;
    const existing = userBuckets.get(key);
    if (!existing || now - existing.windowStart >= UPLOAD_WINDOW_MS) {
        // Cap the map size so a spray of distinct ids can't grow memory unbounded; shed
        // brand-new entries rather than evicting already-tracked ones.
        if (!existing && userBuckets.size >= UPLOAD_MAX_BUCKETS) return { ok: true, retryAfter: 0 };
        userBuckets.set(key, { count: 1, windowStart: now });
        return { ok: true, retryAfter: 0 };
    }
    existing.count += 1;
    if (existing.count > UPLOAD_PER_USER_MAX) {
        return { ok: false, retryAfter: Math.max(1, Math.ceil((existing.windowStart + UPLOAD_WINDOW_MS - now) / 1000)) };
    }
    return { ok: true, retryAfter: 0 };
}

export function pruneOrgUploadBuckets(now: number = Date.now()): number {
    let removed = 0;
    for (const [k, b] of userBuckets.entries()) {
        if (now - b.windowStart >= UPLOAD_WINDOW_MS) { userBuckets.delete(k); removed++; }
    }
    return removed;
}

// Same-origin check. This endpoint is authenticated by a bearer token (not a cookie), so
// it isn't classically CSRF-able, but a mismatched Origin still has no business posting
// here — reject it. A missing Origin (e.g. a same-origin navigation) is allowed; the token
// is the real gate.
function isSameOrigin(req: Request): boolean {
    const origin = req.headers.origin;
    if (!origin || typeof origin !== 'string') return true;
    let originHost: string;
    try { originHost = new URL(origin).host; } catch { return false; }
    const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
    return typeof host === 'string' && originHost === host;
}

export default async function orgUploadHandler(req: Request, res: Response): Promise<void> {
    if (!isSameOrigin(req)) {
        res.status(403).json({ message: 'Forbidden: cross-site request blocked' });
        return;
    }

    // Authenticate the same way the dispatcher does: token -> force-logout -> revocation
    // watermark -> load user.
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const decoded = token ? verifyToken(token) : null;
    if (!decoded) { res.status(401).json({ message: 'Unauthorized' }); return; }
    const platformSettings = await getPlatformSettings();
    if (isSessionForceLoggedOut(decoded, platformSettings?.force_logout_timestamp)) {
        res.status(401).json({ message: 'Session expired. Please log in again.', force_logout: true });
        return;
    }
    const user = await getUserById(decoded.userId);
    if (isSessionRevokedByWatermark(decoded, user?.tokensValidFrom)) {
        res.status(401).json({ message: 'Session expired. Please log in again.' });
        return;
    }
    if (!user) { res.status(401).json({ message: 'Unauthorized' }); return; }

    // Feature allowlist. An unknown or absent `?for=` has no upload surface.
    const feature = typeof req.query.for === 'string' ? req.query.for : '';
    if (!isOrgMediaFeature(feature)) {
        res.status(404).json({ message: 'Unknown upload target' });
        return;
    }

    // Require the same permission that gates the feature's write action (any-of). No Admin
    // role shortcut: an Admin uploads exactly when their granted permissions would let them
    // do the write, matching the dispatcher.
    const required = FEATURE_UPLOAD_PERMS[feature];
    const requiredPerms = Array.isArray(required) ? required : [required];
    const userPerms = Array.isArray(user.permissions) ? user.permissions : [];
    if (!requiredPerms.some(p => userPerms.includes(p))) {
        log.warn('upload permission denied', { userId: user.id, feature });
        res.status(403).json({ message: 'Forbidden: you do not have permission to upload here.' });
        return;
    }

    const limit = checkUserUploadLimit(user.id);
    if (!limit.ok) {
        res.setHeader('Retry-After', String(limit.retryAfter));
        res.status(429).json({ message: 'Too many uploads. Please slow down and try again shortly.' });
        return;
    }

    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
        res.status(400).json({ message: 'Empty or invalid image body' });
        return;
    }

    try {
        const result = await uploadOrgMedia(feature, buf);
        // Ids and byte count only — never the image content or PII.
        log.info('org media uploaded', { userId: user.id, feature, bytes: buf.length, key: result.key });
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({ success: true, url: result.url, key: result.key, visibility: result.visibility });
    } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (msg === 'Image too large') {
            res.status(413).json({ message: 'Image too large.' });
            return;
        }
        if (msg === 'Unsupported or invalid image') {
            res.status(415).json({ message: 'Unsupported image type. Use PNG, JPEG, WEBP, GIF, or AVIF.' });
            return;
        }
        if (msg === 'Storage limit reached') {
            res.status(507).json({ message: 'Storage limit reached. Remove some uploaded images to free space.' });
            return;
        }
        log.error('org media upload failed', { err: e });
        res.status(500).json({ message: 'Upload failed' });
    }
}
