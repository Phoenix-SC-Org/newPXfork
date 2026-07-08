// Single source of truth for which iframe/embed hosts rich content may reference.
//
// Used by the Academy CoursePlayer (components/views/academy/CoursePlayer.tsx) to
// decide whether a lesson's YouTube/Vimeo URL may be embedded in an <iframe> vs
// linked out. MUST stay aligned with the CSP `frame-src` directive in server.ts
// (an embed allowed here but missing from frame-src would be blocked by the
// browser) and with the ALLOWED_EMBED_HOSTS list in lib/tiptapValidate.ts.
//
// Matching is on the parsed URL hostname (exact or dotted-suffix), NEVER a
// substring, so `youtube.com.evil.example` and `evil.example/?x=youtube.com`
// are both rejected.

export const ALLOWED_IFRAME_HOSTS = [
    'www.youtube.com',
    'www.youtube-nocookie.com',
    'player.vimeo.com',
    'docs.google.com',
    'drive.google.com',
    'calendar.google.com',
    'www.google.com',
    'open.spotify.com',
    'codepen.io',
    'stackblitz.com',
] as const;

export function isAllowedIframeSrc(src: unknown): boolean {
    if (typeof src !== 'string' || !src) return false;
    try {
        const url = new URL(src);
        if (url.protocol !== 'https:') return false;
        return ALLOWED_IFRAME_HOSTS.some(host => url.hostname === host || url.hostname.endsWith('.' + host));
    } catch {
        return false;
    }
}
