import { describe, it, expect } from 'vitest';
import { FEATURE_UPLOAD_PERMS, FEATURE_WRITE_ACTION } from '../api/orgUploadPerms';
import { fullPermissionMap } from '../api/services';

// Uploading media for a feature must require the same permission as editing that feature's
// resource. This pins each upload permission to fullPermissionMap[<the write action>], so a
// change to a write permission fails here until the upload map is updated to match.
describe('image-upload permission parity', () => {
    it('every upload feature is gated by the same permission as its write action', () => {
        for (const feature of Object.keys(FEATURE_UPLOAD_PERMS) as (keyof typeof FEATURE_UPLOAD_PERMS)[]) {
            const uploadPerm = FEATURE_UPLOAD_PERMS[feature];
            const writeAction = FEATURE_WRITE_ACTION[feature];
            const uploadPerms = Array.isArray(uploadPerm) ? uploadPerm : [uploadPerm];
            const writeActions = Array.isArray(writeAction) ? writeAction : [writeAction];
            expect(writeActions.length, `${feature} arity`).toBe(uploadPerms.length);
            writeActions.forEach((action, i) => {
                const mapped = fullPermissionMap[action];
                expect(mapped, `${feature}: fullPermissionMap[${action}] missing`).toBeTruthy();
                expect(mapped, `${feature}: upload perm must match its write action's perm`).toBe(uploadPerms[i]);
            });
        }
    });

    it('the two maps cover exactly the same features', () => {
        expect(Object.keys(FEATURE_WRITE_ACTION).sort()).toEqual(Object.keys(FEATURE_UPLOAD_PERMS).sort());
    });
});
