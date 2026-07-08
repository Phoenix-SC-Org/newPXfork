// =============================================================================
// V5 pure preview helpers — role-to-net rules & assignments. Side-effect free:
// they only DIFF a desired state against the current shard state (fetched by the
// actions) and return secret-free, descriptive previews. No network, no writes.
//
// Matching is lenient: unknown nets/users produce WARNINGS, not hard blocks,
// because the shard's net `id` vs `netUid` and roster membership can legitimately
// differ from what a preview sees (e.g. an offline but valid user).
// =============================================================================

import type { CommsAssignment, CommsNet, CommsRoleNetRule, CommsRosterOperator, CommsAssignmentAction, CommsRoleNetRuleInput } from './types.js';

export const V5_WARNING_KEYS = {
    rulesReplace: 'rules-replace',
    missingNet: 'missing-net',
    unknownUser: 'unknown-user',
    noOp: 'no-op',
} as const;

export interface RoleNetRulesPreview {
    current: CommsRoleNetRule[];
    desired: CommsRoleNetRuleInput[];
    /** Referenced net uids not found among current nets (advisory). */
    missingNetUids: string[];
    warnings: string[];
    applyPossible: boolean;
}

export interface AssignmentPreviewItem extends CommsAssignmentAction {
    /** True when this action would change shard state (not already satisfied). */
    effective: boolean;
    reason?: string;
}

export interface AssignmentsPreview {
    toApply: AssignmentPreviewItem[];
    /** Actions that are already satisfied (assign of an existing / unassign of a missing). */
    skipped: AssignmentPreviewItem[];
    missingNets: string[];
    unknownUsers: string[];
    warnings: string[];
    applyPossible: boolean;
}

function knownNetKeys(nets: ReadonlyArray<CommsNet>): Set<string> {
    const s = new Set<string>();
    for (const n of nets) {
        if (n.id) s.add(n.id);
        const uid = (n as Record<string, unknown>).uid;
        if (typeof uid === 'string') s.add(uid);
    }
    return s;
}

export function buildRoleNetRulesPreview(
    desired: CommsRoleNetRuleInput[],
    current: CommsRoleNetRule[],
    nets: ReadonlyArray<CommsNet>,
): RoleNetRulesPreview {
    const netKeys = knownNetKeys(nets);
    const referenced = desired.flatMap((r) => r.netUids);
    const missingNetUids = [...new Set(referenced.filter((uid) => !netKeys.has(uid)))];
    const warnings: string[] = [V5_WARNING_KEYS.rulesReplace];
    if (missingNetUids.length > 0) warnings.push(V5_WARNING_KEYS.missingNet);
    return { current, desired, missingNetUids, warnings, applyPossible: true };
}

export function buildAssignmentsPreview(
    actions: CommsAssignmentAction[],
    existing: ReadonlyArray<CommsAssignment>,
    roster: ReadonlyArray<CommsRosterOperator>,
    nets: ReadonlyArray<CommsNet>,
): AssignmentsPreview {
    const netKeys = knownNetKeys(nets);
    const rosterUsers = new Set(roster.map((o) => o.userId).filter((u): u is string => !!u));
    const existingKeys = new Set(existing.map((a) => `${a.userId}|${a.netUid}`));

    const toApply: AssignmentPreviewItem[] = [];
    const skipped: AssignmentPreviewItem[] = [];
    const missingNets = new Set<string>();
    const unknownUsers = new Set<string>();

    for (const a of actions) {
        const key = `${a.userId}|${a.netUid}`;
        const has = existingKeys.has(key);
        const effective = a.action === 'assign' ? !has : has;
        if (!netKeys.has(a.netUid)) missingNets.add(a.netUid);
        if (!rosterUsers.has(a.userId)) unknownUsers.add(a.userId);
        const item: AssignmentPreviewItem = { ...a, effective, reason: effective ? undefined : V5_WARNING_KEYS.noOp };
        (effective ? toApply : skipped).push(item);
    }

    const warnings: string[] = [];
    if (missingNets.size > 0) warnings.push(V5_WARNING_KEYS.missingNet);
    if (unknownUsers.size > 0) warnings.push(V5_WARNING_KEYS.unknownUser);

    return {
        toApply,
        skipped,
        missingNets: [...missingNets],
        unknownUsers: [...unknownUsers],
        warnings,
        applyPossible: toApply.length > 0,
    };
}
