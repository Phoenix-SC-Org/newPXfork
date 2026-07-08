import * as db from '../../lib/db.js';
import type { AcademyOutcomeVerdict, AcademySessionStatus } from '../../types.js';

// Every handler receives the request body with the actor id (userId) and the
// authed `user` injected server-side by services.ts (userId is force-overwritten
// to the session user — never client-supplied). canManage / canAward / canView are
// derived from the actor's real permissions and composed with the dispatcher's
// single-perm gate:
//   • academy:instruct actions are BOLA-limited to the actor's assigned courses/
//     sessions in the db layer unless they hold academy:manage.
//   • academy:manage actions (approve/gating/certify) are dispatcher-gated.
//   • Awarding a certification ADDITIONALLY requires admin:award:certification.
// Single-org: no organizationId anywhere. The whole namespace is additionally
// feature-gated in the dispatcher (403 when the Academy feature is OFF).
type Actor = { userId: number; user?: { role?: string; permissions?: string[] } };
const isManager = (u?: { role?: string; permissions?: string[] }) => u?.role === 'Admin' || !!u?.permissions?.includes('academy:manage');
const isAwarder = (u?: { role?: string; permissions?: string[] }) => u?.role === 'Admin' || !!u?.permissions?.includes('admin:award:certification');
const isViewer = (u?: { role?: string; permissions?: string[] }) => u?.role === 'Admin' || !!u?.permissions?.includes('academy:view');

export const academyActions = {
    // ── Courses ──────────────────────────────────────────────────────────────
    'academy:create_course': async ({ userId, title, description, icon, imageUrl, delivery }: Actor & { title?: string; description?: string | null; icon?: string | null; imageUrl?: string | null; delivery?: 'cohort' | 'self_paced' }) =>
        db.createCourse(userId, { title, description, icon, imageUrl, delivery }),
    'academy:update_course': async ({ userId, user, courseId, title, description, icon, imageUrl, sortOrder, delivery }: Actor & { courseId: string; title?: string; description?: string | null; icon?: string | null; imageUrl?: string | null; sortOrder?: number; delivery?: 'cohort' | 'self_paced' }) =>
        db.updateCourse(courseId, userId, isManager(user), { title, description, icon, imageUrl, sortOrder, delivery }),
    'academy:delete_course': async ({ userId, user, courseId }: Actor & { courseId: string }) =>
        db.deleteCourse(courseId, userId, isManager(user)),
    'academy:submit_course': async ({ userId, user, courseId }: Actor & { courseId: string }) =>
        db.submitCourseForApproval(courseId, userId, isManager(user)),
    'academy:set_course_certification': async ({ userId, user, courseId, certificationId }: Actor & { courseId: string; certificationId?: number | null }) =>
        db.setCourseCertification(courseId, certificationId ?? null, userId, isAwarder(user)),
    'academy:approve_course': async ({ userId, courseId }: Actor & { courseId: string }) =>
        db.approveCourse(courseId, userId),
    'academy:reject_course': async ({ courseId }: Actor & { courseId: string }) =>
        db.rejectCourse(courseId),
    'academy:set_course_archived': async ({ courseId, archived }: Actor & { courseId: string; archived?: boolean }) =>
        db.setCourseArchived(courseId, !!archived),
    'academy:set_course_access': async ({ courseId, access }: Actor & { courseId: string; access: 'open' | 'gated' }) =>
        db.setCourseAccess(courseId, access),
    'academy:add_course_instructor': async ({ userId, user, courseId, targetUserId }: Actor & { courseId: string; targetUserId: number }) =>
        db.addCourseInstructor(courseId, targetUserId, userId, isManager(user)),
    'academy:add_course_instructors': async ({ userId, user, courseId, targetUserIds }: Actor & { courseId: string; targetUserIds?: number[] }) =>
        db.addCourseInstructors(courseId, Array.isArray(targetUserIds) ? targetUserIds : [], userId, isManager(user)),
    'academy:remove_course_instructor': async ({ userId, user, courseId, targetUserId }: Actor & { courseId: string; targetUserId: number }) =>
        db.removeCourseInstructor(courseId, targetUserId, userId, isManager(user)),

    // ── Modules · Lessons · Outcomes ───────────────────────────────────────────
    'academy:create_module': async ({ userId, user, courseId, title, description, sortOrder }: Actor & { courseId: string; title?: string; description?: string | null; sortOrder?: number }) =>
        db.createModule(courseId, userId, isManager(user), { title, description, sortOrder }),
    'academy:update_module': async ({ userId, user, moduleId, title, description, sortOrder }: Actor & { moduleId: number; title?: string; description?: string | null; sortOrder?: number }) =>
        db.updateModule(moduleId, userId, isManager(user), { title, description, sortOrder }),
    'academy:delete_module': async ({ userId, user, moduleId }: Actor & { moduleId: number }) =>
        db.deleteModule(moduleId, userId, isManager(user)),
    'academy:create_lesson': async ({ userId, user, moduleId, title, content, videoUrl, sortOrder, estimatedMinutes }: Actor & { moduleId: number; title?: string; content?: string | null; videoUrl?: string | null; sortOrder?: number; estimatedMinutes?: number | null }) =>
        db.createLesson(moduleId, userId, isManager(user), { title, content, videoUrl, sortOrder, estimatedMinutes }),
    'academy:update_lesson': async ({ userId, user, lessonId, title, content, videoUrl, sortOrder, estimatedMinutes }: Actor & { lessonId: number; title?: string; content?: string | null; videoUrl?: string | null; sortOrder?: number; estimatedMinutes?: number | null }) =>
        db.updateLesson(lessonId, userId, isManager(user), { title, content, videoUrl, sortOrder, estimatedMinutes }),
    'academy:delete_lesson': async ({ userId, user, lessonId }: Actor & { lessonId: number }) =>
        db.deleteLesson(lessonId, userId, isManager(user)),
    'academy:create_outcome': async ({ userId, user, courseId, title, description, sortOrder, required }: Actor & { courseId: string; title?: string; description?: string | null; sortOrder?: number; required?: boolean }) =>
        db.createOutcome(courseId, userId, isManager(user), { title, description, sortOrder, required }),
    'academy:update_outcome': async ({ userId, user, outcomeId, title, description, sortOrder, required }: Actor & { outcomeId: number; title?: string; description?: string | null; sortOrder?: number; required?: boolean }) =>
        db.updateOutcome(outcomeId, userId, isManager(user), { title, description, sortOrder, required }),
    'academy:delete_outcome': async ({ userId, user, outcomeId }: Actor & { outcomeId: number }) =>
        db.deleteOutcome(outcomeId, userId, isManager(user)),

    // ── Sessions (cohorts) ─────────────────────────────────────────────────────
    'academy:create_session': async ({ userId, user, courseId, title, startsAt, endsAt, location, capacity, enrollmentOpen }: Actor & { courseId: string; title?: string; startsAt?: string | null; endsAt?: string | null; location?: string | null; capacity?: number | null; enrollmentOpen?: boolean }) =>
        db.createSession(courseId, userId, isManager(user), { title, startsAt, endsAt, location, capacity, enrollmentOpen }),
    'academy:update_session': async ({ userId, user, sessionId, title, startsAt, endsAt, location, capacity, enrollmentOpen }: Actor & { sessionId: string; title?: string; startsAt?: string | null; endsAt?: string | null; location?: string | null; capacity?: number | null; enrollmentOpen?: boolean }) =>
        db.updateSession(sessionId, userId, isManager(user), { title, startsAt, endsAt, location, capacity, enrollmentOpen }),
    'academy:set_session_status': async ({ userId, user, sessionId, status }: Actor & { sessionId: string; status: AcademySessionStatus }) =>
        db.setSessionStatus(sessionId, status, userId, isManager(user)),
    'academy:add_session_instructor': async ({ userId, user, sessionId, targetUserId }: Actor & { sessionId: string; targetUserId: number }) =>
        db.addSessionInstructor(sessionId, targetUserId, userId, isManager(user)),
    'academy:remove_session_instructor': async ({ userId, user, sessionId, targetUserId }: Actor & { sessionId: string; targetUserId: number }) =>
        db.removeSessionInstructor(sessionId, targetUserId, userId, isManager(user)),

    // ── Enrolment · progress · assessment ──────────────────────────────────────
    'academy:self_enroll': async ({ userId, sessionId }: Actor & { sessionId: string }) =>
        db.selfEnroll(sessionId, userId),
    'academy:assign_students': async ({ userId, user, sessionId, studentIds }: Actor & { sessionId: string; studentIds?: number[] }) =>
        db.assignStudents(sessionId, Array.isArray(studentIds) ? studentIds : [], userId, isManager(user)),
    'academy:withdraw_enrollment': async ({ userId, user, enrollmentId }: Actor & { enrollmentId: string }) =>
        db.withdrawEnrollment(enrollmentId, userId, isManager(user)),
    'academy:mark_lesson': async ({ userId, user, enrollmentId, lessonId, completed }: Actor & { enrollmentId: string; lessonId: number; completed?: boolean }) =>
        db.markLesson(enrollmentId, lessonId, completed !== false, userId, isManager(user)),
    'academy:assess_outcome': async ({ userId, user, enrollmentId, outcomeId, verdict }: Actor & { enrollmentId: string; outcomeId: number; verdict: AcademyOutcomeVerdict }) =>
        db.assessOutcome(enrollmentId, outcomeId, verdict, userId, isManager(user)),
    'academy:recommend_certification': async ({ userId, user, enrollmentId }: Actor & { enrollmentId: string }) =>
        db.recommendForCertification(enrollmentId, userId, isManager(user)),
    'academy:withdraw_enrollments_bulk': async ({ userId, user, sessionId, enrollmentIds }: Actor & { sessionId: string; enrollmentIds?: string[] }) =>
        db.withdrawEnrollmentsBulk(sessionId, Array.isArray(enrollmentIds) ? enrollmentIds : [], userId, isManager(user)),
    'academy:recommend_enrollments_bulk': async ({ userId, user, sessionId, enrollmentIds }: Actor & { sessionId: string; enrollmentIds?: string[] }) =>
        db.recommendEnrollmentsBulk(sessionId, Array.isArray(enrollmentIds) ? enrollmentIds : [], userId, isManager(user)),
    'academy:certify_and_complete': async ({ userId, user, enrollmentId }: Actor & { enrollmentId: string }) =>
        db.certifyAndComplete(enrollmentId, userId, isAwarder(user)),

    // ── Reads ──────────────────────────────────────────────────────────────────
    'academy:get_course': async ({ courseId }: Actor & { courseId: string }) =>
        db.getCourseDetail(courseId),
    'academy:get_session': async ({ sessionId }: Actor & { sessionId: string }) =>
        db.getSessionDetail(sessionId),
    'academy:get_enrollment': async ({ userId, user, enrollmentId }: Actor & { enrollmentId: string }) =>
        db.getEnrollmentDetail(enrollmentId, userId, isViewer(user)),
    'academy:get_catalog_course': async ({ courseId }: Actor & { courseId: string }) =>
        db.getCatalogCourse(courseId),
    'academy:list_recommended': async () =>
        db.listRecommendedEnrollments(),
};
