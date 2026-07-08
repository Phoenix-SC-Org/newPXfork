// Permission map for native image uploads.
//
// Each upload feature is gated by the SAME permission that gates that feature's write
// action in api/services.ts `fullPermissionMap`. A member who can't create or edit a
// resource has no reason to upload media for it, and letting them would be an unmetered
// storage-abuse vector. tests/orgUploadPermParity.test.ts locks each value to
// `fullPermissionMap[<the write action>]`, so changing a feature's write permission fails
// the test until this map is updated to match.

import type { OrgMediaFeature } from '../lib/storage.js';

// A feature maps to one permission, or (any-of) an array — the uploader needs at least
// one. `wiki` is any-of because creating a page (wiki:add_page) and editing one
// (wiki:edit_page) are different permissions, and the upload happens on file-pick before
// the server can tell which; a contributor with only add_page must still be able to upload.
export const FEATURE_UPLOAD_PERMS: Record<OrgMediaFeature, string | string[]> = {
    branding: 'admin:config:branding',
    'site-metadata': 'admin:config:metadata',
    'public-page': 'admin:config:branding',
    'hero-card': 'admin:config:branding',
    rank: 'admin:config:ranks',
    unit: 'admin:config:units',
    specialization: 'admin:config:specializations',
    certification: 'admin:config:certifications',
    commendation: 'admin:config:commendations',
    alliance: 'alliance:manage',
    quartermaster: 'qm:admin',
    wiki: ['wiki:edit_page', 'wiki:add_page'],
    government: 'gov:admin',
    legislation: 'gov:elected_official',
    academy: 'academy:instruct',
};

// The representative write action whose permission each feature must match. Used only by
// the parity test to catch drift between FEATURE_UPLOAD_PERMS and fullPermissionMap.
export const FEATURE_WRITE_ACTION: Record<OrgMediaFeature, string | string[]> = {
    branding: 'admin:update_branding_config',
    'site-metadata': 'admin:update_opengraph_config',
    'public-page': 'admin:update_public_page_config',
    'hero-card': 'admin:update_hero_config',
    rank: 'admin:update_rank',
    unit: 'admin:update_unit',
    specialization: 'admin:update_specialization',
    certification: 'admin:update_certification',
    commendation: 'admin:update_commendation',
    alliance: 'alliance:save_self_profile',
    quartermaster: 'qm:update_catalog_item',
    wiki: ['wiki:update_page', 'wiki:create_page'],
    government: 'gov:update_constitution',
    legislation: 'gov:update_legislation',
    academy: 'academy:update_course',
};
