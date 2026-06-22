import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// F3/F4: the two session-revocation surfaces that drifted from the dispatcher.
// These are wiring/policy pins (source-text), mirroring how the federation suite
// pins alliances.ts source — the predicates themselves are unit-tested elsewhere.

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('F3 — /api/admin/import-stream enforces per-user revocation', () => {
    const server = read('server.ts');
    const route = server.slice(server.indexOf("'/api/admin/import-stream'"), server.indexOf("'/api/admin/import-stream'") + 2000);

    it('imports the watermark predicate', () => {
        expect(server).toContain('isSessionRevokedByWatermark');
    });
    it('checks the watermark inside the import-stream route, before streaming', () => {
        expect(route).toContain('isSessionRevokedByWatermark(decoded, user?.tokensValidFrom)');
        // the check sits before the importer runs (compared on the full source)
        const routeStart = server.indexOf("'/api/admin/import-stream'");
        const watermarkAt = server.indexOf('isSessionRevokedByWatermark', routeStart);
        const importerAt = server.indexOf('importOrgData', routeStart);
        expect(watermarkAt).toBeGreaterThan(-1);
        expect(importerAt).toBeGreaterThan(watermarkAt);
    });
});

describe('F4 — realtime RLS folds in tokens_valid_from (iat watermark)', () => {
    const schema = read('schema.sql');

    it('the org-channel policy checks iat vs tokens_valid_from', () => {
        const policy = schema.slice(schema.indexOf('CREATE POLICY rt_recv_org_channels'), schema.indexOf('CREATE POLICY rt_recv_op_board'));
        expect(policy).toContain('tokens_valid_from');
        expect(policy).toContain("auth.jwt()->>'iat'");
    });

    it('the op-board policy checks iat vs tokens_valid_from', () => {
        const policy = schema.slice(schema.indexOf('CREATE POLICY rt_recv_op_board'), schema.indexOf('CREATE POLICY rt_recv_op_board') + 1600);
        expect(policy).toContain('tokens_valid_from');
        expect(policy).toContain("auth.jwt()->>'iat'");
    });

    it('the reference-table authenticated_select policy checks iat vs tokens_valid_from', () => {
        const block = schema.slice(schema.indexOf('CREATE POLICY authenticated_select'), schema.indexOf('CREATE POLICY authenticated_select') + 700);
        expect(block).toContain('tokens_valid_from');
        expect(block).toContain("auth.jwt()->>''iat''");
    });
});

describe('hardening cluster pins (F25/F23)', () => {
    it('F25 — Express framework fingerprint header is disabled', () => {
        expect(read('server.ts')).toContain("app.disable('x-powered-by')");
    });
    it('F23 — the wiki iframe sandbox no longer grants allow-popups', () => {
        const ext = read('components/views/wiki/extensions/IframeExtension.ts');
        expect(ext).toContain("sandbox: 'allow-scripts allow-same-origin'");
        // the previous (popups-granting) sandbox value must be gone
        expect(ext).not.toContain("allow-same-origin allow-popups");
    });
});
