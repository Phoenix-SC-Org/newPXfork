import { describe, it, expect, beforeEach, vi } from 'vitest';

// The self-service HR submission handlers must consult the per-user throttle BEFORE
// touching the DB, so a rejection blocks the record-creation + push fan-out entirely.

const spies = vi.hoisted(() => ({
    assertSubmissionRateLimit: vi.fn(),
    applyForJob: vi.fn(),
    createHRApplication: vi.fn(),
}));

vi.mock('../lib/submissionRateLimit', () => ({ assertSubmissionRateLimit: spies.assertSubmissionRateLimit }));
vi.mock('../lib/db', () => ({ applyForJob: spies.applyForJob, createHRApplication: spies.createHRApplication }));
vi.mock('../lib/push', () => ({ sendPushToUsers: vi.fn() }));

import { userActions } from '../api/actions/user';

type Handler = (p: unknown) => unknown;
const call = async (name: string, p: unknown) => (userActions as Record<string, Handler>)[name](p);

beforeEach(() => {
    spies.assertSubmissionRateLimit.mockReset();
    spies.applyForJob.mockReset().mockResolvedValue(undefined);
    spies.createHRApplication.mockReset().mockResolvedValue(undefined);
});

describe('self-service submission handlers throttle before the DB write', () => {
    it('user:apply_job consults the throttle with the user id, then writes', async () => {
        await call('user:apply_job', { jobId: 'j1', userId: 9, statement: 's' });
        expect(spies.assertSubmissionRateLimit).toHaveBeenCalledWith(9);
        expect(spies.applyForJob).toHaveBeenCalled();
    });

    it('user:submit_application consults the throttle with the user id, then writes', async () => {
        await call('user:submit_application', { userId: 9, rsiHandle: 'h' });
        expect(spies.assertSubmissionRateLimit).toHaveBeenCalledWith(9);
        expect(spies.createHRApplication).toHaveBeenCalled();
    });

    it('a throttle rejection blocks the DB write (fails closed)', async () => {
        spies.assertSubmissionRateLimit.mockImplementation(() => { throw new Error('Too many submissions'); });
        await expect(call('user:apply_job', { jobId: 'j1', userId: 9, statement: 's' })).rejects.toThrow(/too many/i);
        expect(spies.applyForJob).not.toHaveBeenCalled();

        await expect(call('user:submit_application', { userId: 9, rsiHandle: 'h' })).rejects.toThrow(/too many/i);
        expect(spies.createHRApplication).not.toHaveBeenCalled();
    });
});
