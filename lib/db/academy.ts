// Academy (LMS) data layer. Server-role only (deny-by-default RLS) — every read/
// write is BOLA-guarded (ownership / instructor-assignment / clearance), and all
// list reads are capped. Mutations emit an id-only `academy_update` on the
// realtime channel. Single-org: there is NO organization_id — the tenant
// dimension is gone; every OTHER assert (instructor assignment, enrolment
// ownership, capacity, the cert-award double gate) stays.
import { supabase, handleSupabaseError, broadcastToOrg } from './common.js';
import { SecurityDenial } from '../errors.js';
import { log as baseLog } from '../log.js';
import { sanitizeTiptapJson, tryParseTiptapJson } from '../tiptapValidate.js';
import { sanitizeImageUrl } from '../imageUrl.js';
import { sanitizePublicLinkUrl } from '../linkUrl.js';
import { awardCertification } from './system.js';
import { createNotification } from './notifications.js';
import {
    toAcademyCourse, toAcademyModule, toAcademyLesson, toAcademyOutcome,
    toAcademySession, toAcademyEnrollment, toAcademyLessonProgress,
    toAcademyOutcomeResult,
} from './mappers.js';
import type {
    AcademyCourse, AcademyModule, AcademySession, AcademyEnrollment,
    AcademyUserRef, AcademyOutcomeVerdict, AcademySessionStatus, AcademyCourseDelivery,
} from '../../types.js';

const log = baseLog.child({ module: 'db.academy' });

// ── Explicit column selectors (Rule 1) ──────────────────────────────────────
const COURSE_COLS = 'id, title, description, icon, image_url, status, access, delivery, certification_id, created_by, approved_by, published_at, sort_order, created_at, updated_at';
const COURSE_GUARD_COLS = 'id, status, access, delivery, certification_id, created_by';
const MODULE_COLS = 'id, course_id, title, description, sort_order, created_at';
const LESSON_COLS = 'id, module_id, title, content, video_url, sort_order, estimated_minutes, created_at';
const OUTCOME_COLS = 'id, course_id, title, description, sort_order, required, created_at';
const SESSION_COLS = 'id, course_id, title, status, starts_at, ends_at, location, capacity, enrollment_open, is_implicit, created_by, created_at, updated_at';
const SESSION_GUARD_COLS = 'id, course_id, status, capacity, enrollment_open';
const ENROLLMENT_COLS = 'id, session_id, student_id, source, status, assigned_by, recommended_by, recommended_at, certified_by, completed_at, enrolled_at';
const ENROLLMENT_GUARD_COLS = 'id, session_id, student_id, status';
const LESSON_PROGRESS_COLS = 'id, enrollment_id, lesson_id, completed_by, completed_at';
const OUTCOME_RESULT_COLS = 'id, enrollment_id, outcome_id, verdict, assessed_by, assessed_at';
const USER_REF_COLS = 'id, name, avatar_url, rsi_handle';
const CERT_REF_COLS = 'id, name, icon, image_url';

const MAX_LIST = 500;
const MAX_AGG = 5000; // hard backstop for fan-out .in(...) aggregate reads

// ── video_url: public link restricted to a YouTube/Vimeo host allowlist ──────
const VIDEO_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com', 'vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);
function sanitizeVideoUrl(raw: unknown): string | null {
    const url = sanitizePublicLinkUrl(raw);
    if (!url) return null;
    try {
        return VIDEO_HOSTS.has(new URL(url).hostname.toLowerCase()) ? url : null;
    } catch { return null; }
}

// Lesson content is authored in the minimal Tiptap editor and stored as a
// validated Tiptap-JSON string: parse -> sanitize (minimal allowlist) -> stringify.
// Whatever the client sends can only ever persist as a clean, allow-listed doc.
function sanitizeLessonContent(raw: unknown): string | null {
    if (raw == null) return null;
    const doc = typeof raw === 'string' ? tryParseTiptapJson(raw) : (typeof raw === 'object' ? raw as Record<string, unknown> : null);
    if (!doc) return null;
    try {
        return JSON.stringify(sanitizeTiptapJson(doc, 'minimal'));
    } catch {
        return null; // not a valid Tiptap document
    }
}

// ── User-ref hydration (batch; avoids fragile FK-embed strings) ──────────────
async function fetchUserRefs(ids: Array<number | null | undefined>): Promise<Map<number, AcademyUserRef>> {
    const map = new Map<number, AcademyUserRef>();
    const unique = [...new Set(ids)].filter((n): n is number => typeof n === 'number');
    if (unique.length === 0) return map;
    const { data, error } = await supabase.from('users').select(USER_REF_COLS).in('id', unique);
    if (error && error.code === '42P01') return map;
    handleSupabaseError({ error, message: 'Failed to load academy user refs' });
    for (const u of data || []) {
        map.set(u.id, { id: u.id, name: u.name ?? '', avatarUrl: u.avatar_url ?? '', rsiHandle: u.rsi_handle ?? '' });
    }
    return map;
}

// ── Resource-existence / BOLA guards ─────────────────────────────────────────
// Single-org: "does this resource exist" IS the tenant boundary. A missing id and
// a would-be foreign id are indistinguishable (same opaque denial) — no existence oracle.
interface CourseGuard { id: string; status: string; access: string; delivery: string; certificationId: number | null; createdBy: number; }
async function loadCourse(courseId: string): Promise<CourseGuard> {
    const { data, error } = await supabase.from('academy_courses')
        .select(COURSE_GUARD_COLS).eq('id', courseId).maybeSingle();
    if (error && error.code !== '42P01') handleSupabaseError({ error, message: 'Failed to load course' });
    if (!data) throw new SecurityDenial('This course is not available.', { auditEvent: 'authz.resource.denied', fields: { courseId } });
    return { id: data.id, status: data.status, access: data.access, delivery: data.delivery, certificationId: data.certification_id ?? null, createdBy: data.created_by };
}

interface SessionGuard { id: string; courseId: string; status: string; capacity: number | null; enrollmentOpen: boolean; }
async function loadSession(sessionId: string): Promise<SessionGuard> {
    const { data, error } = await supabase.from('academy_sessions')
        .select(SESSION_GUARD_COLS).eq('id', sessionId).maybeSingle();
    if (error && error.code !== '42P01') handleSupabaseError({ error, message: 'Failed to load session' });
    if (!data) throw new SecurityDenial('This session is not available.', { auditEvent: 'authz.resource.denied', fields: { sessionId } });
    return { id: data.id, courseId: data.course_id, status: data.status, capacity: data.capacity ?? null, enrollmentOpen: data.enrollment_open !== false };
}

interface EnrollmentGuard { id: string; sessionId: string; studentId: number; status: string; }
async function loadEnrollment(enrollmentId: string): Promise<EnrollmentGuard> {
    const { data, error } = await supabase.from('academy_enrollments')
        .select(ENROLLMENT_GUARD_COLS).eq('id', enrollmentId).maybeSingle();
    if (error && error.code !== '42P01') handleSupabaseError({ error, message: 'Failed to load enrolment' });
    if (!data) throw new SecurityDenial('This enrolment is not available.', { auditEvent: 'authz.resource.denied', fields: { enrollmentId } });
    return { id: data.id, sessionId: data.session_id, studentId: data.student_id, status: data.status };
}

async function isCourseInstructor(courseId: string, userId: number): Promise<boolean> {
    const { data } = await supabase.from('academy_course_instructors').select('id').eq('course_id', courseId).eq('user_id', userId).maybeSingle();
    return !!data;
}
async function isSessionInstructor(sessionId: string, userId: number): Promise<boolean> {
    const { data } = await supabase.from('academy_session_instructors').select('id').eq('session_id', sessionId).eq('user_id', userId).maybeSingle();
    return !!data;
}

/** Course exists AND (actor holds academy:manage OR is an assigned course instructor). */
async function assertCanEditCourse(courseId: string, userId: number, canManage: boolean): Promise<CourseGuard> {
    const course = await loadCourse(courseId);
    if (canManage || await isCourseInstructor(courseId, userId)) return course;
    throw new SecurityDenial('You are not an instructor of this course.', { auditEvent: 'authz.permission_denied', fields: { courseId, userId } });
}

/** Session exists AND (manage OR session instructor OR the course's instructor). */
async function assertCanRunSession(sessionId: string, userId: number, canManage: boolean): Promise<SessionGuard> {
    const session = await loadSession(sessionId);
    if (canManage || await isSessionInstructor(sessionId, userId) || await isCourseInstructor(session.courseId, userId)) return session;
    throw new SecurityDenial('You are not an instructor of this session.', { auditEvent: 'authz.permission_denied', fields: { sessionId, userId } });
}

// Resolve a child row's owning course, asserting it exists.
async function moduleCourse(moduleId: number): Promise<string> {
    const { data } = await supabase.from('academy_modules').select('course_id').eq('id', moduleId).maybeSingle();
    // Same opaque message as loadCourse's denial branch, so a not-found id is
    // indistinguishable from a foreign one (no existence oracle).
    if (!data) throw new SecurityDenial('This course is not available.', { auditEvent: 'authz.resource.denied', fields: { moduleId } });
    await loadCourse(data.course_id);
    return data.course_id;
}
async function lessonCourse(lessonId: number): Promise<{ courseId: string; moduleId: number }> {
    const { data } = await supabase.from('academy_lessons').select('module_id').eq('id', lessonId).maybeSingle();
    if (!data) throw new SecurityDenial('This course is not available.', { auditEvent: 'authz.resource.denied', fields: { lessonId } });
    const courseId = await moduleCourse(data.module_id);
    return { courseId, moduleId: data.module_id };
}
async function outcomeCourse(outcomeId: number): Promise<string> {
    const { data } = await supabase.from('academy_outcomes').select('course_id').eq('id', outcomeId).maybeSingle();
    if (!data) throw new SecurityDenial('This course is not available.', { auditEvent: 'authz.resource.denied', fields: { outcomeId } });
    await loadCourse(data.course_id);
    return data.course_id;
}

async function assertUserExists(userId: number, label: string): Promise<void> {
    const { data } = await supabase.from('users').select('id').eq('id', userId).is('deleted_at', null).maybeSingle();
    if (!data) throw new SecurityDenial(`${label} is not a valid member.`, { auditEvent: 'authz.invalid_target', fields: { userId } });
}

function notify(payload: Record<string, unknown>): void {
    void broadcastToOrg('academy_update', payload);
}

// ── Notification Center wiring (best-effort: persist + realtime + web-push) ──
/** User ids whose role grants `permission` — routes a recommendation to the
 *  people who can action it. Capped. */
async function usersWithPermission(permission: string): Promise<number[]> {
    const { data: perms } = await supabase.from('permissions').select('id').eq('name', permission).limit(50);
    const permIds = (perms || []).map(p => p.id);
    if (permIds.length === 0) return [];
    const { data: rp } = await supabase.from('role_permissions').select('role_id').in('permission_id', permIds).limit(2000);
    const grantRoleIds = [...new Set((rp || []).map(r => r.role_id))];
    if (grantRoleIds.length === 0) return [];
    const { data: users } = await supabase.from('users').select('id').in('role_id', grantRoleIds).is('deleted_at', null).limit(500);
    return (users || []).map(u => u.id);
}

/** Resolve a session's course id + title for notification copy. */
async function academyCourseContext(sessionId: string): Promise<{ courseId: string; courseTitle: string } | null> {
    const { data: sess } = await supabase.from('academy_sessions').select('course_id').eq('id', sessionId).maybeSingle();
    if (!sess) return null;
    const { data: course } = await supabase.from('academy_courses').select('title').eq('id', sess.course_id).maybeSingle();
    if (!course) return null;
    return { courseId: sess.course_id, courseTitle: course.title };
}

/** Fan an academy notification to each recipient (deduped), best-effort — a
 *  notification failure never blocks the underlying mutation. link is always 'academy'. */
async function pushAcademyNotifications(userIds: number[], payload: { type: string; title: string; body: string; metadata: Record<string, unknown> }): Promise<void> {
    const ids = [...new Set(userIds)].filter((n): n is number => typeof n === 'number');
    if (ids.length === 0) return;
    await Promise.all(ids.map(uid => createNotification(uid, {
        type: payload.type, title: payload.title, body: payload.body, link: 'academy', metadata: payload.metadata,
    }).catch(() => { /* best-effort */ })));
}

// ════════════════════════════════════════════════════════════════════════════
// COURSES
// ════════════════════════════════════════════════════════════════════════════
export interface CourseInput { title?: string; description?: string | null; icon?: string | null; imageUrl?: string | null; sortOrder?: number; delivery?: AcademyCourseDelivery; }

export async function createCourse(userId: number, input: CourseInput): Promise<AcademyCourse> {
    const title = (input.title || '').trim();
    if (!title) throw new Error('Course title is required.');
    const delivery: AcademyCourseDelivery = input.delivery === 'self_paced' ? 'self_paced' : 'cohort';
    const { data, error } = await supabase.from('academy_courses').insert({
        title,
        description: input.description?.trim() || null,
        icon: input.icon?.trim() || null,
        image_url: sanitizeImageUrl(input.imageUrl),
        status: 'draft',
        // Self-paced courses are open-access so members can enrol straight from the catalogue.
        access: delivery === 'self_paced' ? 'open' : 'gated',
        delivery,
        created_by: userId,
    }).select(COURSE_COLS).single();
    handleSupabaseError({ error, message: 'Failed to create course' });
    if (!data) throw new Error('Failed to create course');
    // The creator is the first course instructor.
    await supabase.from('academy_course_instructors').insert({ course_id: data.id, user_id: userId, assigned_by: userId });
    notify({ courseId: data.id });
    return toAcademyCourse(data);
}

export async function updateCourse(courseId: string, userId: number, canManage: boolean, input: CourseInput): Promise<AcademyCourse> {
    const course = await assertCanEditCourse(courseId, userId, canManage);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.title !== undefined) { const t = input.title.trim(); if (!t) throw new Error('Course title is required.'); patch.title = t; }
    if (input.description !== undefined) patch.description = input.description?.trim() || null;
    if (input.icon !== undefined) patch.icon = input.icon?.trim() || null;
    if (input.imageUrl !== undefined) patch.image_url = sanitizeImageUrl(input.imageUrl);
    if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
    if (input.delivery !== undefined) {
        // Delivery mode is structural (a self-paced course grows an implicit session on
        // publish), so it may only change while the course is still a draft.
        if (course.status !== 'draft') throw new Error('Delivery mode can only be changed while the course is a draft.');
        const delivery: AcademyCourseDelivery = input.delivery === 'self_paced' ? 'self_paced' : 'cohort';
        patch.delivery = delivery;
        patch.access = delivery === 'self_paced' ? 'open' : 'gated';
    }
    const { data, error } = await supabase.from('academy_courses').update(patch)
        .eq('id', courseId).select(COURSE_COLS).single();
    handleSupabaseError({ error, message: 'Failed to update course' });
    if (!data) throw new Error('Failed to update course');
    notify({ courseId });
    return toAcademyCourse(data);
}

/** Deletable only while draft/archived (never mid-run). Cascade removes children. */
export async function deleteCourse(courseId: string, userId: number, canManage: boolean): Promise<void> {
    const course = await assertCanEditCourse(courseId, userId, canManage);
    if (course.status !== 'draft' && course.status !== 'archived') throw new Error('Only draft or archived courses can be deleted.');
    const { error } = await supabase.from('academy_courses').delete().eq('id', courseId);
    handleSupabaseError({ error, message: 'Failed to delete course' });
    notify({ courseId });
}

/** Link/unlink the reward certification. Requires cert-award authority (privilege gate). */
export async function setCourseCertification(courseId: string, certificationId: number | null, userId: number, canAward: boolean): Promise<void> {
    await loadCourse(courseId);
    if (!canAward) throw new SecurityDenial('Linking a certification requires the Award Certification permission.', { auditEvent: 'authz.escalation.denied', fields: { courseId } });
    if (certificationId != null) {
        const { data } = await supabase.from('certifications').select('id').eq('id', certificationId).maybeSingle();
        if (!data) throw new SecurityDenial('That certification does not exist.', { auditEvent: 'authz.invalid_target', fields: { certId: certificationId } });
    }
    const { error } = await supabase.from('academy_courses').update({ certification_id: certificationId, updated_at: new Date().toISOString() })
        .eq('id', courseId);
    handleSupabaseError({ error, message: 'Failed to set course certification' });
    notify({ courseId });
}

/** Instructor submits a draft for Learning-Admin approval. */
export async function submitCourseForApproval(courseId: string, userId: number, canManage: boolean): Promise<void> {
    const course = await assertCanEditCourse(courseId, userId, canManage);
    if (course.status !== 'draft') throw new Error('Only draft courses can be submitted for approval.');
    const { error } = await supabase.from('academy_courses').update({ status: 'pending_approval', updated_at: new Date().toISOString() })
        .eq('id', courseId);
    handleSupabaseError({ error, message: 'Failed to submit course' });
    notify({ courseId });
}

/** A self-paced course is backed by one hidden, auto-managed session that members
 *  enrol into directly from the catalogue. Idempotent: created once, on publish. */
async function ensureImplicitSession(courseId: string, userId: number): Promise<void> {
    const { data: existing } = await supabase.from('academy_sessions')
        .select('id').eq('course_id', courseId).eq('is_implicit', true).limit(1).maybeSingle();
    if (existing) return;
    const { error } = await supabase.from('academy_sessions').insert({
        course_id: courseId,
        title: 'Self-paced',
        status: 'in_progress',
        enrollment_open: true,
        capacity: null,
        is_implicit: true,
        created_by: userId,
    });
    handleSupabaseError({ error, message: 'Failed to create self-paced session' });
}

/** Learning Admin (academy:manage, dispatcher-gated) approves + publishes. */
export async function approveCourse(courseId: string, userId: number): Promise<void> {
    const course = await loadCourse(courseId);
    if (course.status !== 'pending_approval') throw new Error('Only courses pending approval can be approved.');
    const { error } = await supabase.from('academy_courses').update({ status: 'published', approved_by: userId, published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', courseId);
    handleSupabaseError({ error, message: 'Failed to approve course' });
    // Self-paced courses need their evergreen enrolment session to exist once published.
    if (course.delivery === 'self_paced') await ensureImplicitSession(courseId, userId);
    notify({ courseId });
}

export async function rejectCourse(courseId: string): Promise<void> {
    await loadCourse(courseId);
    const { error } = await supabase.from('academy_courses').update({ status: 'draft', updated_at: new Date().toISOString() })
        .eq('id', courseId);
    handleSupabaseError({ error, message: 'Failed to reject course' });
    notify({ courseId });
}

export async function setCourseArchived(courseId: string, archived: boolean): Promise<void> {
    const course = await loadCourse(courseId);
    const status = archived ? 'archived' : (course.status === 'archived' ? 'draft' : course.status);
    const { error } = await supabase.from('academy_courses').update({ status, updated_at: new Date().toISOString() })
        .eq('id', courseId);
    handleSupabaseError({ error, message: 'Failed to archive course' });
    notify({ courseId });
}

export async function setCourseAccess(courseId: string, access: 'open' | 'gated'): Promise<void> {
    if (access !== 'open' && access !== 'gated') throw new Error('Invalid access value.');
    await loadCourse(courseId);
    const { error } = await supabase.from('academy_courses').update({ access, updated_at: new Date().toISOString() })
        .eq('id', courseId);
    handleSupabaseError({ error, message: 'Failed to set course access' });
    notify({ courseId });
}

// ── Course instructors ──────────────────────────────────────────────────────
export async function addCourseInstructor(courseId: string, targetUserId: number, actorUserId: number, canManage: boolean): Promise<void> {
    await assertCanEditCourse(courseId, actorUserId, canManage);
    await assertUserExists(targetUserId, 'Instructor');
    const { error } = await supabase.from('academy_course_instructors').insert({ course_id: courseId, user_id: targetUserId, assigned_by: actorUserId });
    if (error && error.code !== '23505') handleSupabaseError({ error, message: 'Failed to add instructor' });
    notify({ courseId });
}
/** Batch-add course instructors: one edit-authority check + one existence check + one insert. */
export async function addCourseInstructors(courseId: string, targetUserIds: number[], actorUserId: number, canManage: boolean): Promise<number> {
    await assertCanEditCourse(courseId, actorUserId, canManage);
    const ids = [...new Set(targetUserIds)].filter((n): n is number => typeof n === 'number').slice(0, 100);
    if (ids.length === 0) return 0;
    const { data: members } = await supabase.from('users').select('id').in('id', ids).is('deleted_at', null);
    const valid = new Set((members || []).map(m => m.id));
    const invalid = ids.find(id => !valid.has(id));
    if (invalid !== undefined) throw new SecurityDenial('Instructor is not a valid member.', { auditEvent: 'authz.invalid_target', fields: { userId: invalid } });
    const { data: existingInstr } = await supabase.from('academy_course_instructors').select('user_id').eq('course_id', courseId).in('user_id', ids);
    const already = new Set((existingInstr || []).map(r => r.user_id));
    const toAdd = ids.filter(id => !already.has(id));
    if (toAdd.length === 0) { notify({ courseId }); return 0; }
    const { error } = await supabase.from('academy_course_instructors').insert(
        toAdd.map(uid => ({ course_id: courseId, user_id: uid, assigned_by: actorUserId })),
    );
    if (error && error.code !== '23505') handleSupabaseError({ error, message: 'Failed to add instructors' });
    notify({ courseId });
    return toAdd.length;
}

/** Bulk-withdraw enrolments within one session (one session guard + one scoped update).
 *  The update is session-scoped so a spoofed id from elsewhere is a silent no-op. */
export async function withdrawEnrollmentsBulk(sessionId: string, enrollmentIds: string[], actorUserId: number, canManage: boolean): Promise<number> {
    await assertCanRunSession(sessionId, actorUserId, canManage);
    const ids = [...new Set(enrollmentIds)].filter((s): s is string => typeof s === 'string' && s.length > 0).slice(0, 500);
    if (ids.length === 0) return 0;
    const { data, error } = await supabase.from('academy_enrollments').update({ status: 'withdrawn' })
        .eq('session_id', sessionId).in('id', ids).neq('status', 'withdrawn').select('id');
    handleSupabaseError({ error, message: 'Failed to withdraw enrolments' });
    notify({ sessionId });
    return (data || []).length;
}

/** Bulk-recommend enrolments in one session for certification. Only enrolments whose
 *  required outcomes are all competent are recommended; returns { recommended, skipped }. */
export async function recommendEnrollmentsBulk(sessionId: string, enrollmentIds: string[], actorUserId: number, canManage: boolean): Promise<{ recommended: number; skipped: number }> {
    const session = await assertCanRunSession(sessionId, actorUserId, canManage);
    const ids = [...new Set(enrollmentIds)].filter((s): s is string => typeof s === 'string' && s.length > 0).slice(0, 500);
    if (ids.length === 0) return { recommended: 0, skipped: 0 };
    // Only enrolments that really are in this session (session-scoped) and still active.
    const { data: enrRows } = await supabase.from('academy_enrollments').select('id, status')
        .eq('session_id', sessionId).in('id', ids);
    const active = (enrRows || []).filter(e => e.status === 'enrolled' || e.status === 'in_progress').map(e => e.id);
    if (active.length === 0) return { recommended: 0, skipped: ids.length };
    // Required outcomes are identical for every enrolment in the course — fetch once.
    const { data: outcomes } = await supabase.from('academy_outcomes').select('id, required').eq('course_id', session.courseId);
    const required = (outcomes || []).filter(o => o.required !== false).map(o => o.id);
    let eligible: string[];
    if (required.length === 0) {
        eligible = active;
    } else {
        const { data: results } = await supabase.from('academy_outcome_results').select('enrollment_id, outcome_id, verdict').in('enrollment_id', active).limit(MAX_AGG);
        const competentByEnr = new Map<string, Set<number>>();
        for (const r of results || []) {
            if (r.verdict !== 'competent') continue;
            const set = competentByEnr.get(r.enrollment_id) || new Set<number>();
            set.add(r.outcome_id); competentByEnr.set(r.enrollment_id, set);
        }
        eligible = active.filter(id => { const s = competentByEnr.get(id); return !!s && required.every(o => s.has(o)); });
    }
    if (eligible.length === 0) return { recommended: 0, skipped: ids.length };
    const { error } = await supabase.from('academy_enrollments').update({ recommended_by: actorUserId, recommended_at: new Date().toISOString() })
        .eq('session_id', sessionId).in('id', eligible);
    handleSupabaseError({ error, message: 'Failed to recommend enrolments' });
    notify({ sessionId });
    // One batched notification to the learning managers who can certify.
    const [ctx, managers] = await Promise.all([academyCourseContext(sessionId), usersWithPermission('academy:manage')]);
    if (ctx && managers.length) {
        await pushAcademyNotifications(managers, { type: 'academy_recommended', title: 'Ready for certification', body: `${eligible.length} student${eligible.length === 1 ? '' : 's'} recommended for certification in ${ctx.courseTitle}.`, metadata: { courseId: ctx.courseId, sessionId, count: eligible.length } });
    }
    return { recommended: eligible.length, skipped: ids.length - eligible.length };
}

export async function removeCourseInstructor(courseId: string, targetUserId: number, actorUserId: number, canManage: boolean): Promise<void> {
    await assertCanEditCourse(courseId, actorUserId, canManage);
    const { error } = await supabase.from('academy_course_instructors').delete().eq('course_id', courseId).eq('user_id', targetUserId);
    handleSupabaseError({ error, message: 'Failed to remove instructor' });
    notify({ courseId });
}

// ════════════════════════════════════════════════════════════════════════════
// MODULES · LESSONS · OUTCOMES  (curriculum; edits gated to course instructors)
// ════════════════════════════════════════════════════════════════════════════
export interface ModuleInput { title?: string; description?: string | null; sortOrder?: number; }
export async function createModule(courseId: string, userId: number, canManage: boolean, input: ModuleInput): Promise<AcademyModule> {
    await assertCanEditCourse(courseId, userId, canManage);
    const title = (input.title || '').trim();
    if (!title) throw new Error('Module title is required.');
    const { data, error } = await supabase.from('academy_modules').insert({
        course_id: courseId, title, description: input.description?.trim() || null, sort_order: input.sortOrder ?? 0,
    }).select(MODULE_COLS).single();
    handleSupabaseError({ error, message: 'Failed to create module' });
    if (!data) throw new Error('Failed to create module');
    notify({ courseId });
    return toAcademyModule(data);
}
export async function updateModule(moduleId: number, userId: number, canManage: boolean, input: ModuleInput): Promise<void> {
    const courseId = await moduleCourse(moduleId);
    await assertCanEditCourse(courseId, userId, canManage);
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) { const t = input.title.trim(); if (!t) throw new Error('Module title is required.'); patch.title = t; }
    if (input.description !== undefined) patch.description = input.description?.trim() || null;
    if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
    const { error } = await supabase.from('academy_modules').update(patch).eq('id', moduleId);
    handleSupabaseError({ error, message: 'Failed to update module' });
    notify({ courseId });
}
export async function deleteModule(moduleId: number, userId: number, canManage: boolean): Promise<void> {
    const courseId = await moduleCourse(moduleId);
    await assertCanEditCourse(courseId, userId, canManage);
    const { error } = await supabase.from('academy_modules').delete().eq('id', moduleId);
    handleSupabaseError({ error, message: 'Failed to delete module' });
    notify({ courseId });
}

export interface LessonInput { title?: string; content?: string | null; videoUrl?: string | null; sortOrder?: number; estimatedMinutes?: number | null; }
export async function createLesson(moduleId: number, userId: number, canManage: boolean, input: LessonInput): Promise<void> {
    const courseId = await moduleCourse(moduleId);
    await assertCanEditCourse(courseId, userId, canManage);
    const title = (input.title || '').trim();
    if (!title) throw new Error('Lesson title is required.');
    const { error } = await supabase.from('academy_lessons').insert({
        module_id: moduleId, title,
        content: sanitizeLessonContent(input.content),
        video_url: sanitizeVideoUrl(input.videoUrl),
        sort_order: input.sortOrder ?? 0,
        estimated_minutes: input.estimatedMinutes ?? null,
    });
    handleSupabaseError({ error, message: 'Failed to create lesson' });
    notify({ courseId });
}
export async function updateLesson(lessonId: number, userId: number, canManage: boolean, input: LessonInput): Promise<void> {
    const { courseId } = await lessonCourse(lessonId);
    await assertCanEditCourse(courseId, userId, canManage);
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) { const t = input.title.trim(); if (!t) throw new Error('Lesson title is required.'); patch.title = t; }
    if (input.content !== undefined) patch.content = sanitizeLessonContent(input.content);
    if (input.videoUrl !== undefined) patch.video_url = sanitizeVideoUrl(input.videoUrl);
    if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
    if (input.estimatedMinutes !== undefined) patch.estimated_minutes = input.estimatedMinutes ?? null;
    const { error } = await supabase.from('academy_lessons').update(patch).eq('id', lessonId);
    handleSupabaseError({ error, message: 'Failed to update lesson' });
    notify({ courseId });
}
export async function deleteLesson(lessonId: number, userId: number, canManage: boolean): Promise<void> {
    const { courseId } = await lessonCourse(lessonId);
    await assertCanEditCourse(courseId, userId, canManage);
    const { error } = await supabase.from('academy_lessons').delete().eq('id', lessonId);
    handleSupabaseError({ error, message: 'Failed to delete lesson' });
    notify({ courseId });
}

export interface OutcomeInput { title?: string; description?: string | null; sortOrder?: number; required?: boolean; }
export async function createOutcome(courseId: string, userId: number, canManage: boolean, input: OutcomeInput): Promise<void> {
    await assertCanEditCourse(courseId, userId, canManage);
    const title = (input.title || '').trim();
    if (!title) throw new Error('Outcome title is required.');
    const { error } = await supabase.from('academy_outcomes').insert({
        course_id: courseId, title, description: input.description?.trim() || null,
        sort_order: input.sortOrder ?? 0, required: input.required !== false,
    });
    handleSupabaseError({ error, message: 'Failed to create outcome' });
    notify({ courseId });
}
export async function updateOutcome(outcomeId: number, userId: number, canManage: boolean, input: OutcomeInput): Promise<void> {
    const courseId = await outcomeCourse(outcomeId);
    await assertCanEditCourse(courseId, userId, canManage);
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) { const t = input.title.trim(); if (!t) throw new Error('Outcome title is required.'); patch.title = t; }
    if (input.description !== undefined) patch.description = input.description?.trim() || null;
    if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
    if (input.required !== undefined) patch.required = !!input.required;
    const { error } = await supabase.from('academy_outcomes').update(patch).eq('id', outcomeId);
    handleSupabaseError({ error, message: 'Failed to update outcome' });
    notify({ courseId });
}
export async function deleteOutcome(outcomeId: number, userId: number, canManage: boolean): Promise<void> {
    const courseId = await outcomeCourse(outcomeId);
    await assertCanEditCourse(courseId, userId, canManage);
    const { error } = await supabase.from('academy_outcomes').delete().eq('id', outcomeId);
    handleSupabaseError({ error, message: 'Failed to delete outcome' });
    notify({ courseId });
}

// ════════════════════════════════════════════════════════════════════════════
// SESSIONS (cohorts)
// ════════════════════════════════════════════════════════════════════════════
export interface SessionInput { title?: string; startsAt?: string | null; endsAt?: string | null; location?: string | null; capacity?: number | null; enrollmentOpen?: boolean; }
export async function createSession(courseId: string, userId: number, canManage: boolean, input: SessionInput): Promise<AcademySession> {
    const course = await assertCanEditCourse(courseId, userId, canManage);
    if (course.status !== 'published') throw new Error('Only published courses can be run as a session.');
    const title = (input.title || '').trim();
    if (!title) throw new Error('Session title is required.');
    const { data, error } = await supabase.from('academy_sessions').insert({
        course_id: courseId, title, status: 'scheduled',
        starts_at: input.startsAt || null, ends_at: input.endsAt || null,
        location: input.location?.trim() || null,
        capacity: input.capacity != null && input.capacity > 0 ? Math.floor(input.capacity) : null,
        enrollment_open: input.enrollmentOpen !== false, created_by: userId,
    }).select(SESSION_COLS).single();
    handleSupabaseError({ error, message: 'Failed to create session' });
    if (!data) throw new Error('Failed to create session');
    await supabase.from('academy_session_instructors').insert({ session_id: data.id, user_id: userId, assigned_by: userId });
    notify({ sessionId: data.id });
    return toAcademySession(data);
}
export async function updateSession(sessionId: string, userId: number, canManage: boolean, input: SessionInput): Promise<void> {
    await assertCanRunSession(sessionId, userId, canManage);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.title !== undefined) { const t = input.title.trim(); if (!t) throw new Error('Session title is required.'); patch.title = t; }
    if (input.startsAt !== undefined) patch.starts_at = input.startsAt || null;
    if (input.endsAt !== undefined) patch.ends_at = input.endsAt || null;
    if (input.location !== undefined) patch.location = input.location?.trim() || null;
    if (input.capacity !== undefined) patch.capacity = input.capacity != null && input.capacity > 0 ? Math.floor(input.capacity) : null;
    if (input.enrollmentOpen !== undefined) patch.enrollment_open = !!input.enrollmentOpen;
    const { error } = await supabase.from('academy_sessions').update(patch).eq('id', sessionId);
    handleSupabaseError({ error, message: 'Failed to update session' });
    notify({ sessionId });
}
const SESSION_TRANSITIONS: Record<string, AcademySessionStatus[]> = {
    scheduled: ['in_progress', 'cancelled'],
    in_progress: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
};
export async function setSessionStatus(sessionId: string, status: AcademySessionStatus, userId: number, canManage: boolean): Promise<void> {
    const session = await assertCanRunSession(sessionId, userId, canManage);
    if (!(SESSION_TRANSITIONS[session.status] || []).includes(status)) throw new Error(`Cannot move a ${session.status} session to ${status}.`);
    const { error } = await supabase.from('academy_sessions').update({ status, updated_at: new Date().toISOString() }).eq('id', sessionId);
    handleSupabaseError({ error, message: 'Failed to update session status' });
    notify({ sessionId });
}
export async function addSessionInstructor(sessionId: string, targetUserId: number, actorUserId: number, canManage: boolean): Promise<void> {
    await assertCanRunSession(sessionId, actorUserId, canManage);
    await assertUserExists(targetUserId, 'Instructor');
    const { error } = await supabase.from('academy_session_instructors').insert({ session_id: sessionId, user_id: targetUserId, assigned_by: actorUserId });
    if (error && error.code !== '23505') handleSupabaseError({ error, message: 'Failed to add session instructor' });
    notify({ sessionId });
}
export async function removeSessionInstructor(sessionId: string, targetUserId: number, actorUserId: number, canManage: boolean): Promise<void> {
    await assertCanRunSession(sessionId, actorUserId, canManage);
    const { error } = await supabase.from('academy_session_instructors').delete().eq('session_id', sessionId).eq('user_id', targetUserId);
    handleSupabaseError({ error, message: 'Failed to remove session instructor' });
    notify({ sessionId });
}

// ════════════════════════════════════════════════════════════════════════════
// ENROLMENTS
// ════════════════════════════════════════════════════════════════════════════
async function sessionEnrollmentCount(sessionId: string): Promise<number> {
    const { count } = await supabase.from('academy_enrollments').select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId).neq('status', 'withdrawn');
    return count ?? 0;
}

/** Student self-enrols: course published + open, session accepting + not full. */
export async function selfEnroll(sessionId: string, studentId: number): Promise<void> {
    const session = await loadSession(sessionId);
    const course = await loadCourse(session.courseId);
    if (course.status !== 'published' || course.access !== 'open') throw new SecurityDenial('This course is not open for self-enrolment.', { auditEvent: 'authz.permission_denied', fields: { sessionId } });
    if (!session.enrollmentOpen || session.status === 'completed' || session.status === 'cancelled') throw new Error('This session is not accepting enrolments.');
    if (session.capacity != null && await sessionEnrollmentCount(sessionId) >= session.capacity) throw new Error('This session is full.');
    const { error } = await supabase.from('academy_enrollments').insert({ session_id: sessionId, student_id: studentId, source: 'self', status: 'enrolled' });
    if (error && error.code === '23505') throw new Error('You are already enrolled in this session.');
    handleSupabaseError({ error, message: 'Failed to enrol' });
    notify({ sessionId });
    const ctx = await academyCourseContext(sessionId);
    if (ctx) await pushAcademyNotifications([studentId], { type: 'academy_enrolled', title: 'Enrolled in a course', body: `You're enrolled in ${ctx.courseTitle}.`, metadata: { courseId: ctx.courseId, sessionId } });
}

/** Instructor/admin batch-assigns students into a session. */
export async function assignStudents(sessionId: string, studentIds: number[], actorUserId: number, canManage: boolean): Promise<number> {
    await assertCanRunSession(sessionId, actorUserId, canManage);
    const ids = [...new Set(studentIds)].filter((n): n is number => typeof n === 'number').slice(0, 200);
    if (ids.length === 0) return 0;
    // Batched existence guard: every id must be a live member (one query, not N).
    const { data: members } = await supabase.from('users').select('id').in('id', ids).is('deleted_at', null);
    const valid = new Set((members || []).map(m => m.id));
    const invalid = ids.find(id => !valid.has(id));
    if (invalid !== undefined) throw new SecurityDenial('Student is not a valid member.', { auditEvent: 'authz.invalid_target', fields: { userId: invalid } });
    // Skip already-enrolled students so we insert once and notify only the newcomers.
    const { data: existing } = await supabase.from('academy_enrollments').select('student_id').eq('session_id', sessionId).in('student_id', ids);
    const already = new Set((existing || []).map(e => e.student_id));
    const toAdd = ids.filter(id => !already.has(id));
    if (toAdd.length === 0) { notify({ sessionId }); return 0; }
    const { error } = await supabase.from('academy_enrollments').insert(
        toAdd.map(sid => ({ session_id: sessionId, student_id: sid, source: 'assigned', assigned_by: actorUserId, status: 'enrolled' })),
    );
    if (error && error.code !== '23505') handleSupabaseError({ error, message: 'Failed to assign students' });
    notify({ sessionId });
    const ctx = await academyCourseContext(sessionId);
    if (ctx) await pushAcademyNotifications(toAdd, { type: 'academy_enrolled', title: 'Enrolled in a course', body: `You've been enrolled in ${ctx.courseTitle}.`, metadata: { courseId: ctx.courseId, sessionId } });
    return toAdd.length;
}

/** Student self-withdraws, or an instructor/admin removes them. */
export async function withdrawEnrollment(enrollmentId: string, actorUserId: number, canManage: boolean): Promise<void> {
    const enr = await loadEnrollment(enrollmentId);
    const isSelf = enr.studentId === actorUserId;
    if (!isSelf) {
        // Non-self withdrawal requires instructor/admin authority over the session.
        await assertCanRunSession(enr.sessionId, actorUserId, canManage);
    }
    const { error } = await supabase.from('academy_enrollments').update({ status: 'withdrawn' }).eq('id', enrollmentId);
    handleSupabaseError({ error, message: 'Failed to withdraw enrolment' });
    notify({ sessionId: enr.sessionId });
}

// ── Lesson progress (self-paced; student-markable, instructor-overridable) ────
export async function markLesson(enrollmentId: string, lessonId: number, completed: boolean, actorUserId: number, canManage: boolean): Promise<void> {
    const enr = await loadEnrollment(enrollmentId);
    const { courseId } = await lessonCourse(lessonId);
    // The lesson must belong to the enrolment's session's course.
    const session = await loadSession(enr.sessionId);
    if (session.courseId !== courseId) throw new SecurityDenial('Lesson does not belong to this enrolment.', { auditEvent: 'authz.resource.denied', fields: { enrollmentId, lessonId } });
    const isSelf = enr.studentId === actorUserId;
    if (!isSelf && !canManage && !(await isSessionInstructor(enr.sessionId, actorUserId)) && !(await isCourseInstructor(courseId, actorUserId))) {
        throw new SecurityDenial('Not authorised to mark this lesson.', { auditEvent: 'authz.permission_denied', fields: { enrollmentId, lessonId } });
    }
    if (completed) {
        const { error } = await supabase.from('academy_lesson_progress').insert({ enrollment_id: enrollmentId, lesson_id: lessonId, completed_by: actorUserId });
        if (error && error.code !== '23505') handleSupabaseError({ error, message: 'Failed to mark lesson' });
        if (enr.status === 'enrolled') await supabase.from('academy_enrollments').update({ status: 'in_progress' }).eq('id', enrollmentId);
    } else {
        const { error } = await supabase.from('academy_lesson_progress').delete().eq('enrollment_id', enrollmentId).eq('lesson_id', lessonId);
        handleSupabaseError({ error, message: 'Failed to unmark lesson' });
    }
    notify({ sessionId: enr.sessionId });
}

// ── Competency assessment (instructor-only; students can never write these) ───
export async function assessOutcome(enrollmentId: string, outcomeId: number, verdict: AcademyOutcomeVerdict, actorUserId: number, canManage: boolean): Promise<void> {
    if (verdict !== 'competent' && verdict !== 'not_yet_competent') throw new Error('Invalid verdict.');
    const [enr, courseId] = await Promise.all([loadEnrollment(enrollmentId), outcomeCourse(outcomeId)]);
    const session = await loadSession(enr.sessionId);
    if (session.courseId !== courseId) throw new SecurityDenial('Outcome does not belong to this enrolment.', { auditEvent: 'authz.resource.denied', fields: { enrollmentId, outcomeId } });
    if (!canManage && !(await isSessionInstructor(enr.sessionId, actorUserId)) && !(await isCourseInstructor(courseId, actorUserId))) {
        throw new SecurityDenial('Only an instructor can assess competency.', { auditEvent: 'authz.permission_denied', fields: { enrollmentId, outcomeId } });
    }
    // Single upsert on the (enrolment, outcome) unique key.
    const { error } = await supabase.from('academy_outcome_results').upsert(
        { enrollment_id: enrollmentId, outcome_id: outcomeId, verdict, assessed_by: actorUserId, assessed_at: new Date().toISOString() },
        { onConflict: 'enrollment_id,outcome_id' },
    );
    handleSupabaseError({ error, message: 'Failed to assess outcome' });
    notify({ sessionId: enr.sessionId });
}

/** Instructor recommends a student for certification (all required outcomes competent). */
export async function recommendForCertification(enrollmentId: string, actorUserId: number, canManage: boolean): Promise<void> {
    const enr = await loadEnrollment(enrollmentId);
    const session = await loadSession(enr.sessionId);
    if (!canManage && !(await isSessionInstructor(enr.sessionId, actorUserId)) && !(await isCourseInstructor(session.courseId, actorUserId))) {
        throw new SecurityDenial('Only an instructor can recommend for certification.', { auditEvent: 'authz.permission_denied', fields: { enrollmentId } });
    }
    if (!(await allRequiredOutcomesCompetent(enrollmentId, session.courseId))) throw new Error('All required outcomes must be assessed competent before recommending.');
    const { error } = await supabase.from('academy_enrollments').update({ recommended_by: actorUserId, recommended_at: new Date().toISOString() }).eq('id', enrollmentId);
    handleSupabaseError({ error, message: 'Failed to recommend for certification' });
    notify({ sessionId: enr.sessionId });
    // Notify the learning managers who can action the recommendation (certify queue).
    const [ctx, managers, refs] = await Promise.all([
        academyCourseContext(enr.sessionId),
        usersWithPermission('academy:manage'),
        fetchUserRefs([enr.studentId]),
    ]);
    if (ctx && managers.length) {
        const studentName = refs.get(enr.studentId)?.name || 'A student';
        await pushAcademyNotifications(managers, { type: 'academy_recommended', title: 'Ready for certification', body: `${studentName} has been recommended for certification in ${ctx.courseTitle}.`, metadata: { courseId: ctx.courseId, sessionId: enr.sessionId, enrollmentId, studentId: enr.studentId } });
    }
}

async function allRequiredOutcomesCompetent(enrollmentId: string, courseId: string): Promise<boolean> {
    const { data: outcomes } = await supabase.from('academy_outcomes').select('id, required').eq('course_id', courseId);
    const required = (outcomes || []).filter(o => o.required !== false).map(o => o.id);
    if (required.length === 0) return true;
    const { data: results } = await supabase.from('academy_outcome_results').select('outcome_id, verdict').eq('enrollment_id', enrollmentId);
    const competent = new Set((results || []).filter(r => r.verdict === 'competent').map(r => r.outcome_id));
    return required.every(id => competent.has(id));
}

/**
 * Learning Admin (academy:manage) certifies + completes an enrolment. If the
 * course awards a certification, this ADDITIONALLY requires cert-award authority
 * (canAward = admin:award:certification) and grants the cert idempotently.
 */
export async function certifyAndComplete(enrollmentId: string, adminId: number, canAward: boolean): Promise<void> {
    const enr = await loadEnrollment(enrollmentId);
    const session = await loadSession(enr.sessionId);
    const course = await loadCourse(session.courseId);
    if (enr.status === 'withdrawn') throw new Error('Cannot certify a withdrawn enrolment.');
    // Certifying an already-completed enrolment is a no-op (button-spam safe; the
    // user_certifications composite PK is the belt-and-braces DB guard, and
    // awardCertification upserts ON CONFLICT DO NOTHING).
    if (enr.status === 'completed') { notify({ sessionId: enr.sessionId }); return; }
    if (!(await allRequiredOutcomesCompetent(enrollmentId, session.courseId))) throw new Error('All required outcomes must be competent before certifying.');

    // Privilege gate: awarding a real certification needs cert-award authority.
    if (course.certificationId != null && !canAward) {
        throw new SecurityDenial('Awarding this course’s certification requires the Award Certification permission.', { auditEvent: 'authz.escalation.denied', fields: { enrollmentId, certId: course.certificationId } });
    }

    const { error } = await supabase.from('academy_enrollments').update({ status: 'completed', certified_by: adminId, completed_at: new Date().toISOString() }).eq('id', enrollmentId);
    handleSupabaseError({ error, message: 'Failed to complete enrolment' });

    let certName: string | null = null;
    if (course.certificationId != null) {
        const { data: held } = await supabase.from('user_certifications').select('user_id').eq('user_id', enr.studentId).eq('certification_id', course.certificationId).maybeSingle();
        if (!held) {
            await awardCertification(enr.studentId, course.certificationId, adminId); // idempotent upsert, re-hydrates recipient
            log.info('academy certification awarded', { studentId: enr.studentId, certId: course.certificationId, awardedBy: adminId, enrollmentId });
        }
        const { data: certRow } = await supabase.from('certifications').select('name').eq('id', course.certificationId).maybeSingle();
        certName = certRow?.name ?? null;
    }
    notify({ sessionId: enr.sessionId });
    // Notify the student of completion (and the certification they earned, if any).
    const ctx = await academyCourseContext(enr.sessionId);
    const courseTitle = ctx?.courseTitle || 'your course';
    const body = certName ? `You've completed ${courseTitle} and earned the ${certName} certification.` : `You've completed ${courseTitle}.`;
    await pushAcademyNotifications([enr.studentId], { type: 'academy_completed', title: 'Course completed', body, metadata: { courseId: course.id, sessionId: enr.sessionId, enrollmentId, certId: course.certificationId ?? null } });
}

// ════════════════════════════════════════════════════════════════════════════
// READS
// ════════════════════════════════════════════════════════════════════════════

async function attachCourseInstructors(courses: AcademyCourse[]): Promise<void> {
    if (courses.length === 0) return;
    const { data } = await supabase.from('academy_course_instructors').select('course_id, user_id').in('course_id', courses.map(c => c.id)).limit(MAX_AGG);
    const rows = data || [];
    const refs = await fetchUserRefs(rows.map(r => r.user_id));
    const byCourse = new Map<string, AcademyUserRef[]>();
    for (const r of rows) {
        const ref = refs.get(r.user_id);
        if (!ref) continue;
        const arr = byCourse.get(r.course_id) || [];
        arr.push(ref);
        byCourse.set(r.course_id, arr);
    }
    for (const c of courses) c.instructors = byCourse.get(c.id) || [];
}

/** Staff management bundle: all courses (+ instructors) and all sessions (+ context). */
export async function getAcademyStaffState(): Promise<{ academyCourses: AcademyCourse[]; academySessions: AcademySession[] }> {
    const { data: courseRows, error: cErr } = await supabase.from('academy_courses').select(COURSE_COLS)
        .order('sort_order', { ascending: true }).order('created_at', { ascending: false }).limit(MAX_LIST);
    if (cErr && cErr.code === '42P01') return { academyCourses: [], academySessions: [] };
    handleSupabaseError({ error: cErr, message: 'Failed to load courses' });
    const courses = (courseRows || []).map(toAcademyCourse);
    await attachCourseInstructors(courses);

    const { data: sessionRows, error: sErr } = await supabase.from('academy_sessions').select(SESSION_COLS)
        .order('created_at', { ascending: false }).limit(MAX_LIST);
    if (sErr && sErr.code === '42P01') return { academyCourses: courses, academySessions: [] };
    handleSupabaseError({ error: sErr, message: 'Failed to load sessions' });
    const sessions = (sessionRows || []).map(toAcademySession);
    const courseTitle = new Map(courses.map(c => [c.id, c.title]));
    for (const s of sessions) s.courseTitle = courseTitle.get(s.courseId) ?? null;
    // Enrolment counts per session (single grouped-ish pass).
    if (sessions.length > 0) {
        const { data: enr } = await supabase.from('academy_enrollments').select('session_id, status').in('session_id', sessions.map(s => s.id)).limit(MAX_AGG);
        const counts = new Map<string, number>();
        for (const e of enr || []) { if (e.status !== 'withdrawn') counts.set(e.session_id, (counts.get(e.session_id) || 0) + 1); }
        for (const s of sessions) s.enrollmentCount = counts.get(s.id) || 0;
    }
    return { academyCourses: courses, academySessions: sessions };
}

/** Certify queue: enrolments recommended for certification but not yet completed,
 *  newest recommendation last. Gated academy:manage. */
export async function listRecommendedEnrollments(): Promise<AcademyEnrollment[]> {
    const { data: enrRows, error } = await supabase.from('academy_enrollments').select(ENROLLMENT_COLS)
        .not('recommended_at', 'is', null)
        .in('status', ['enrolled', 'in_progress'])
        .order('recommended_at', { ascending: true })
        .limit(MAX_LIST);
    if (error && error.code === '42P01') return [];
    handleSupabaseError({ error, message: 'Failed to load certify queue' });
    const enrollments = (enrRows || []).map(toAcademyEnrollment);
    if (enrollments.length === 0) return [];
    await attachEnrollmentContext(enrollments);
    const studentRefs = await fetchUserRefs(enrollments.map(e => e.studentId));
    for (const e of enrollments) e.student = studentRefs.get(e.studentId) ?? null;
    return enrollments;
}

/** Student self-service bundle: published catalog + my enrolments. */
export async function getMyAcademyState(userId: number): Promise<{ academyCatalog: AcademyCourse[]; academyMyEnrollments: AcademyEnrollment[] }> {
    const { data: courseRows, error: cErr } = await supabase.from('academy_courses').select(COURSE_COLS)
        .eq('status', 'published').order('title', { ascending: true }).limit(MAX_LIST);
    if (cErr && cErr.code === '42P01') return { academyCatalog: [], academyMyEnrollments: [] };
    handleSupabaseError({ error: cErr, message: 'Failed to load catalog' });
    const catalog = (courseRows || []).map(toAcademyCourse);

    const { data: enrRows, error: eErr } = await supabase.from('academy_enrollments').select(ENROLLMENT_COLS)
        .eq('student_id', userId).order('enrolled_at', { ascending: false }).limit(MAX_LIST);
    if (eErr && eErr.code === '42P01') return { academyCatalog: catalog, academyMyEnrollments: [] };
    handleSupabaseError({ error: eErr, message: 'Failed to load enrolments' });
    const enrollments = (enrRows || []).map(toAcademyEnrollment);
    await attachEnrollmentContext(enrollments);
    return { academyCatalog: catalog, academyMyEnrollments: enrollments };
}

async function attachEnrollmentContext(enrollments: AcademyEnrollment[]): Promise<void> {
    if (enrollments.length === 0) return;
    const sessionIds = [...new Set(enrollments.map(e => e.sessionId))];
    const enrollmentIds = enrollments.map(e => e.id);
    const completedByEnrollment = new Map<string, number>();
    // Phase 1: the session lookup and per-enrolment progress counts are independent.
    const [{ data: sessions }] = await Promise.all([
        supabase.from('academy_sessions').select('id, title, course_id').in('id', sessionIds).limit(MAX_AGG),
        (async () => {
            const { data: prog } = await supabase.from('academy_lesson_progress').select('enrollment_id').in('enrollment_id', enrollmentIds).limit(MAX_AGG);
            for (const p of prog || []) completedByEnrollment.set(p.enrollment_id, (completedByEnrollment.get(p.enrollment_id) || 0) + 1);
        })(),
    ]);
    const sessionMap = new Map((sessions || []).map(s => [s.id, s]));
    const courseIds = [...new Set((sessions || []).map(s => s.course_id))];
    const courseTitle = new Map<string, string>();
    const lessonTotalByCourse = new Map<string, number>();
    // Phase 2: course titles and per-course lesson totals both depend on courseIds — run concurrently.
    if (courseIds.length > 0) {
        await Promise.all([
            (async () => {
                const { data: courses } = await supabase.from('academy_courses').select('id, title').in('id', courseIds).limit(MAX_AGG);
                for (const c of courses || []) courseTitle.set(c.id, c.title);
            })(),
            (async () => {
                const { data: mods } = await supabase.from('academy_modules').select('id, course_id').in('course_id', courseIds).limit(MAX_AGG);
                const moduleCourseMap = new Map((mods || []).map(m => [m.id, m.course_id]));
                const moduleIds = (mods || []).map(m => m.id);
                if (moduleIds.length > 0) {
                    const { data: lessons } = await supabase.from('academy_lessons').select('module_id').in('module_id', moduleIds).limit(MAX_AGG);
                    for (const l of lessons || []) {
                        const cid = moduleCourseMap.get(l.module_id);
                        if (cid) lessonTotalByCourse.set(cid, (lessonTotalByCourse.get(cid) || 0) + 1);
                    }
                }
            })(),
        ]);
    }
    for (const e of enrollments) {
        const s = sessionMap.get(e.sessionId);
        e.sessionTitle = s?.title ?? null;
        const cid = s?.course_id;
        e.courseTitle = cid ? (courseTitle.get(cid) ?? null) : null;
        e.lessonsTotal = cid ? (lessonTotalByCourse.get(cid) ?? 0) : 0;
        e.lessonsCompleted = completedByEnrollment.get(e.id) ?? 0;
    }
}

/** Full course tree for the builder / catalog detail. Gated academy:view (staff). */
export async function getCourseDetail(courseId: string): Promise<AcademyCourse> {
    const { data, error } = await supabase.from('academy_courses').select(COURSE_COLS).eq('id', courseId).maybeSingle();
    if (error && error.code !== '42P01') handleSupabaseError({ error, message: 'Failed to load course' });
    if (!data) throw new SecurityDenial('This course is not available.', { auditEvent: 'authz.resource.denied', fields: { courseId } });
    const course = toAcademyCourse(data);
    // Instructors, cert ref, module/lesson tree, and outcomes are independent — run concurrently.
    await Promise.all([
        attachCourseInstructors([course]),
        (async () => {
            if (course.certificationId == null) return;
            const { data: cert } = await supabase.from('certifications').select(CERT_REF_COLS).eq('id', course.certificationId).maybeSingle();
            if (cert) course.certification = { id: cert.id, name: cert.name, icon: cert.icon ?? null, imageUrl: cert.image_url ?? null };
        })(),
        (async () => {
            const { data: modRows } = await supabase.from('academy_modules').select(MODULE_COLS).eq('course_id', courseId).order('sort_order', { ascending: true }).limit(MAX_LIST);
            const modules = (modRows || []).map(toAcademyModule);
            if (modules.length > 0) {
                const { data: lessonRows } = await supabase.from('academy_lessons').select(LESSON_COLS).in('module_id', modules.map(m => m.id)).order('sort_order', { ascending: true }).limit(MAX_AGG);
                const byModule = new Map<number, ReturnType<typeof toAcademyLesson>[]>();
                for (const l of (lessonRows || []).map(toAcademyLesson)) { const arr = byModule.get(l.moduleId) || []; arr.push(l); byModule.set(l.moduleId, arr); }
                for (const m of modules) m.lessons = byModule.get(m.id) || [];
            }
            course.modules = modules;
        })(),
        (async () => {
            const { data: outRows } = await supabase.from('academy_outcomes').select(OUTCOME_COLS).eq('course_id', courseId).order('sort_order', { ascending: true }).limit(MAX_LIST);
            course.outcomes = (outRows || []).map(toAcademyOutcome);
        })(),
    ]);
    return course;
}

/** Session + roster (enrolments with student refs) + instructors. Gated academy:view. */
export async function getSessionDetail(sessionId: string): Promise<{ session: AcademySession; enrollments: AcademyEnrollment[] }> {
    const { data, error } = await supabase.from('academy_sessions').select(SESSION_COLS).eq('id', sessionId).maybeSingle();
    if (error && error.code !== '42P01') handleSupabaseError({ error, message: 'Failed to load session' });
    if (!data) throw new SecurityDenial('This session is not available.', { auditEvent: 'authz.resource.denied', fields: { sessionId } });
    const session = toAcademySession(data);
    // Instructors and roster are independent — hydrate concurrently.
    const [, enrollments] = await Promise.all([
        (async () => {
            const { data: instr } = await supabase.from('academy_session_instructors').select('user_id').eq('session_id', sessionId).limit(MAX_LIST);
            const instrRefs = await fetchUserRefs((instr || []).map(i => i.user_id));
            session.instructors = (instr || []).map(i => instrRefs.get(i.user_id)).filter((r): r is AcademyUserRef => !!r);
        })(),
        (async (): Promise<AcademyEnrollment[]> => {
            const { data: enrRows } = await supabase.from('academy_enrollments').select(ENROLLMENT_COLS).eq('session_id', sessionId).order('enrolled_at', { ascending: true }).limit(MAX_LIST);
            const rows = (enrRows || []).map(toAcademyEnrollment);
            const studentRefs = await fetchUserRefs(rows.map(e => e.studentId));
            for (const e of rows) e.student = studentRefs.get(e.studentId) ?? null;
            return rows;
        })(),
    ]);
    session.enrollmentCount = enrollments.filter(e => e.status !== 'withdrawn').length;
    return { session, enrollments };
}

/** Full enrolment detail (progress + results) for the student (self) or staff. */
export async function getEnrollmentDetail(enrollmentId: string, actorUserId: number, canView: boolean): Promise<{ enrollment: AcademyEnrollment; course: AcademyCourse }> {
    const { data, error } = await supabase.from('academy_enrollments').select(ENROLLMENT_COLS).eq('id', enrollmentId).maybeSingle();
    if (error && error.code !== '42P01') handleSupabaseError({ error, message: 'Failed to load enrolment' });
    if (!data) throw new SecurityDenial('This enrolment is not available.', { auditEvent: 'authz.resource.denied', fields: { enrollmentId } });
    const enrollment = toAcademyEnrollment(data);
    // Authorisation: the student themselves, or any academy:view holder (staff).
    if (enrollment.studentId !== actorUserId && !canView) {
        throw new SecurityDenial('Not authorised to view this enrolment.', { auditEvent: 'authz.permission_denied', fields: { enrollmentId } });
    }
    // Progress, results, student ref, and the course tree are all independent.
    const [, , , course] = await Promise.all([
        (async () => {
            const { data: prog } = await supabase.from('academy_lesson_progress').select(LESSON_PROGRESS_COLS).eq('enrollment_id', enrollmentId);
            enrollment.lessonProgress = (prog || []).map(toAcademyLessonProgress);
        })(),
        (async () => {
            const { data: results } = await supabase.from('academy_outcome_results').select(OUTCOME_RESULT_COLS).eq('enrollment_id', enrollmentId);
            enrollment.outcomeResults = (results || []).map(toAcademyOutcomeResult);
        })(),
        (async () => {
            const studentRef = await fetchUserRefs([enrollment.studentId]);
            enrollment.student = studentRef.get(enrollment.studentId) ?? null;
        })(),
        (async (): Promise<AcademyCourse> => {
            const session = await loadSession(enrollment.sessionId);
            return getCourseDetail(session.courseId);
        })(),
    ]);
    return { enrollment, course };
}

/** Student-facing catalog detail: a published course + its open, enrollable sessions. */
export async function getCatalogCourse(courseId: string): Promise<{ course: AcademyCourse; sessions: AcademySession[] }> {
    const { data } = await supabase.from('academy_courses').select('status').eq('id', courseId).maybeSingle();
    if (!data || data.status !== 'published') throw new SecurityDenial('Course is not available.', { auditEvent: 'authz.permission_denied', fields: { courseId } });
    const course = await getCourseDetail(courseId);
    const { data: sessRows } = await supabase.from('academy_sessions').select(SESSION_COLS)
        .eq('course_id', courseId).eq('enrollment_open', true)
        .in('status', ['scheduled', 'in_progress']).order('starts_at', { ascending: true }).limit(100);
    const sessions = (sessRows || []).map(toAcademySession);
    if (sessions.length > 0) {
        const { data: enr } = await supabase.from('academy_enrollments').select('session_id, status').in('session_id', sessions.map(s => s.id)).limit(MAX_AGG);
        const counts = new Map<string, number>();
        for (const e of enr || []) { if (e.status !== 'withdrawn') counts.set(e.session_id, (counts.get(e.session_id) || 0) + 1); }
        for (const s of sessions) s.enrollmentCount = counts.get(s.id) || 0;
    }
    return { course, sessions };
}

// The Academy feature gate (default OFF) is now part of the generic optional-
// feature registry: the dispatcher gates the whole academy:* namespace via
// OPTIONAL_FEATURE_NAMESPACES (api/services.ts) and the read subsets via
// SUBSET_REQUIRED_FEATURE (api/query.ts), both resolving through
// db.isOptionalFeatureEnabled('academy'). Academy is the module that MOST needs
// this — its member self-service surface (catalog / self-enrol / My Academy) is
// permission-LESS, so a feature-OFF check must close the whole namespace server-
// side, not just hide the Sidebar nav.
