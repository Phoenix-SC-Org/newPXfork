// =============================================================================
// StarComms Net Presets (V4) — typed, code-defined presets + a PURE preview
// diff. Presets live in code (no DB, no schema change). Nothing here touches the
// network or any secret: preview is a read-only comparison of a preset's desired
// nets against the nets already reported by GET /api/v1/status.
//
// Apply (actually creating nets) is intentionally NOT here — it needs the
// StarComms create-net endpoint contract, which is not yet confirmed. Preview is
// fully functional without it.
// =============================================================================

/** One desired net in a preset. Only `name` is required; `purpose` is an
 *  optional human label. Color/accent/relay are deliberately omitted until the
 *  StarComms API is confirmed to support them (no invented fields). */
export interface NetPresetEntry {
    name: string;
    purpose?: string;
}

/** A named collection of desired nets. Display strings are English natural keys
 *  (translated in the UI). No secrets, no StarComms-API specifics. */
export interface NetPreset {
    id: string;
    name: string;
    description: string;
    nets: NetPresetEntry[];
}

export interface NetPresetPreviewNet { name: string; purpose?: string }
export interface NetPresetConflict { name: string; reason: string }

/** Secret-free preview of what applying a preset WOULD do. Purely descriptive —
 *  no writes are implied by producing it. `warnings` are stable keys the UI maps
 *  to localized text. */
export interface NetPresetPreview {
    presetId: string;
    presetName: string;
    /** Preset nets already present on the shard (matched by name, case-insensitive). */
    existing: NetPresetPreviewNet[];
    /** Preset nets that are missing and would be created by Apply. */
    toCreate: NetPresetPreviewNet[];
    /** Problems detected in the preset itself (e.g. duplicate names). */
    conflicts: NetPresetConflict[];
    /** Existing shard nets NOT in the preset — left completely untouched by Apply. */
    unmanaged: string[];
    /** Stable warning keys (see NET_PRESET_WARNING_KEYS) for the UI to localize. */
    warnings: string[];
}

// Stable warning keys — the UI maps each to a localized string via literal t().
export const NET_PRESET_WARNING_KEYS = {
    noDelete: 'no-delete',
    duplicateInPreset: 'duplicate-in-preset',
    unmanagedExisting: 'unmanaged-existing',
} as const;

// --- Preset catalog (code-defined; edit here to change presets) --------------

export const NET_PRESETS: readonly NetPreset[] = [
    {
        id: 'standard',
        name: 'Standard Operation',
        description: 'A typical operation net layout.',
        nets: [
            { name: 'Command' },
            { name: 'Flight' },
            { name: 'Ground' },
            { name: 'Logistics' },
            { name: 'Medical' },
            { name: 'Intel' },
        ],
    },
    {
        id: 'large',
        name: 'Large Operation',
        description: 'An expanded layout for large, multi-element operations.',
        nets: [
            { name: 'Command' },
            { name: 'Air Command' },
            { name: 'Ground Command' },
            { name: 'CAS' },
            { name: 'Logistics' },
            { name: 'Rescue / Medical' },
            { name: 'Intel' },
            { name: 'Staging' },
        ],
    },
    {
        id: 'training',
        name: 'Training',
        description: 'A minimal layout for training sessions.',
        nets: [
            { name: 'Instructor' },
            { name: 'Trainees' },
            { name: 'Support' },
        ],
    },
];

/** Look up a preset by id (null if unknown). */
export function getNetPreset(id: string): NetPreset | null {
    return NET_PRESETS.find((p) => p.id === id) ?? null;
}

const normalizeNetName = (s: string): string => s.trim().toLowerCase();

/**
 * PURE preview diff. Compares a preset's desired nets against the nets already
 * present (from status), matching by case-insensitive name. Never mutates input,
 * never writes, never touches secrets.
 */
export function buildNetPresetPreview(
    preset: NetPreset,
    existingNets: ReadonlyArray<{ name: string | null }>,
): NetPresetPreview {
    const existingByNorm = new Map<string, string>();
    for (const n of existingNets) {
        if (n.name && n.name.trim()) existingByNorm.set(normalizeNetName(n.name), n.name);
    }

    const existing: NetPresetPreviewNet[] = [];
    const toCreate: NetPresetPreviewNet[] = [];
    const conflicts: NetPresetConflict[] = [];
    const seen = new Set<string>();

    for (const entry of preset.nets) {
        const key = normalizeNetName(entry.name);
        if (seen.has(key)) {
            conflicts.push({ name: entry.name, reason: NET_PRESET_WARNING_KEYS.duplicateInPreset });
            continue;
        }
        seen.add(key);
        const net: NetPresetPreviewNet = { name: entry.name, ...(entry.purpose ? { purpose: entry.purpose } : {}) };
        if (existingByNorm.has(key)) existing.push(net);
        else toCreate.push(net);
    }

    const presetNorms = new Set(preset.nets.map((e) => normalizeNetName(e.name)));
    const unmanaged = existingNets
        .map((n) => n.name)
        .filter((name): name is string => !!name && !presetNorms.has(normalizeNetName(name)));

    const warnings: string[] = [NET_PRESET_WARNING_KEYS.noDelete];
    if (conflicts.length > 0) warnings.push(NET_PRESET_WARNING_KEYS.duplicateInPreset);
    if (unmanaged.length > 0) warnings.push(NET_PRESET_WARNING_KEYS.unmanagedExisting);

    return {
        presetId: preset.id,
        presetName: preset.name,
        existing,
        toCreate,
        conflicts,
        unmanaged,
        warnings,
    };
}
