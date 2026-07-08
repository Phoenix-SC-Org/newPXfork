// CoursePlayer — full-screen learner view for one enrolment. Left: module/lesson
// navigation with completion ticks + a course progress bar. Right: the selected
// lesson's video (embedded when it's an allowed host) + content, with a
// "Mark complete & continue" flow. Opens on the first incomplete lesson (resume).
// Rendered as a fixed full-screen overlay from My Learning — no route plumbing.
import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { LessonContentView } from './LessonRichText';
import { isAllowedIframeSrc } from '../../../lib/embedHosts';
import type { AcademyCourse, AcademyEnrollment, AcademyLesson } from '../../../types';

type EnrollmentDetail = { enrollment: AcademyEnrollment; course: AcademyCourse };

/** Convert a YouTube/Vimeo watch URL to a validated embeddable URL, or null.
 *  The result is re-checked against the shared iframe-host allowlist (CSP frame-src). */
function toEmbedUrl(raw: string | null | undefined): string | null {
    if (!raw) return null;
    let url: URL;
    try { url = new URL(raw); } catch { return null; }
    const host = url.hostname.toLowerCase();
    let embed: string | null = null;
    if (host === 'youtu.be') {
        const id = url.pathname.slice(1).split('/')[0];
        if (id) embed = `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
    } else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
        const id = url.searchParams.get('v') || (url.pathname.startsWith('/embed/') ? url.pathname.slice('/embed/'.length) : '');
        if (id) embed = `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
    } else if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
        const id = url.pathname.split('/').filter(Boolean)[0];
        if (id && /^\d+$/.test(id)) embed = `https://player.vimeo.com/video/${encodeURIComponent(id)}`;
    }
    return embed && isAllowedIframeSrc(embed) ? embed : null;
}

export const CoursePlayer: React.FC<{
    detail: EnrollmentDetail;
    busy: boolean;
    onToggleLesson: (enrollmentId: string, lessonId: number, completed: boolean) => void;
    onWithdraw: (enrollmentId: string) => void;
    onClose: () => void;
}> = ({ detail, busy, onToggleLesson, onWithdraw, onClose }) => {
    const { enrollment, course } = detail;
    // A completed/withdrawn enrolment is read-only (review mode).
    const canToggle = enrollment.status === 'enrolled' || enrollment.status === 'in_progress';
    const canWithdraw = enrollment.status !== 'completed' && enrollment.status !== 'withdrawn';

    // Lessons flattened in curriculum order (module sort, then lesson sort — the
    // server already returns them ordered).
    const lessons = useMemo<Array<{ lesson: AcademyLesson; moduleTitle: string }>>(
        () => course.modules.flatMap(m => m.lessons.map(l => ({ lesson: l, moduleTitle: m.title }))),
        [course.modules],
    );
    const done = useMemo(() => new Set(enrollment.lessonProgress.map(p => p.lessonId)), [enrollment.lessonProgress]);
    const total = lessons.length;
    const completedCount = lessons.filter(x => done.has(x.lesson.id)).length;
    const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;

    // Resume at the first incomplete lesson (else the first lesson). Seeded once.
    const firstIncomplete = lessons.find(x => !done.has(x.lesson.id))?.lesson.id ?? lessons[0]?.lesson.id ?? null;
    const [activeId, setActiveId] = useState<number | null>(firstIncomplete);
    const active = lessons.find(x => x.lesson.id === activeId) ?? lessons[0] ?? null;
    const activeLesson = active?.lesson ?? null;
    const isDone = activeLesson ? done.has(activeLesson.id) : false;
    const embedUrl = useMemo(() => toEmbedUrl(activeLesson?.videoUrl), [activeLesson]);

    const goNext = () => {
        if (!activeLesson) return;
        const idx = lessons.findIndex(x => x.lesson.id === activeLesson.id);
        const next = lessons.slice(idx + 1).find(x => !done.has(x.lesson.id)) ?? lessons[idx + 1];
        if (next) setActiveId(next.lesson.id);
    };
    const markCompleteAndNext = () => {
        if (!activeLesson) return;
        if (!isDone) onToggleLesson(enrollment.id, activeLesson.id, true);
        goNext();
    };

    const verdictByOutcome = useMemo(
        () => new Map(enrollment.outcomeResults.map(r => [r.outcomeId, r.verdict])),
        [enrollment.outcomeResults],
    );

    // Portal to <body> so the fixed overlay escapes the dashboard <main> stacking
    // context and covers the global header (Header is relative z-50 and a sibling of
    // <main>; a z-50 fixed child of <main> can't rise above it). Same approach as WindowFrame.
    return createPortal(
        <div className="fixed inset-0 z-100 bg-slate-950 flex flex-col animate-fade-in">
            {/* Header */}
            <header className="shrink-0 flex items-center gap-3 sm:gap-4 px-4 sm:px-6 h-14 border-b border-slate-800 bg-slate-900/60">
                <button type="button" onClick={onClose} className="text-slate-400 hover:text-white text-xs font-bold uppercase tracking-widest flex items-center gap-2 shrink-0"><i className="fa-solid fa-arrow-left" aria-hidden /> <span className="hidden sm:inline">Exit</span></button>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-white truncate">{course.title}</p>
                    <p className="text-[11px] text-slate-500">{completedCount} / {total} lessons · {pct}% complete</p>
                </div>
                <div className="hidden sm:block w-40 h-2 rounded-full bg-slate-800 overflow-hidden shrink-0"><div className="h-full bg-purple-500 transition-all duration-300" style={{ width: `${pct}%` }} /></div>
                {canWithdraw && <button type="button" disabled={busy} onClick={() => onWithdraw(enrollment.id)} className="shrink-0 text-[11px] font-bold uppercase tracking-widest text-slate-500 hover:text-red-400 disabled:opacity-50" title="Withdraw from this course">Withdraw</button>}
            </header>

            <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
                {/* Lesson navigation */}
                <nav className="shrink-0 lg:w-72 border-b lg:border-b-0 lg:border-r border-slate-800 bg-slate-900/40 overflow-y-auto custom-scrollbar p-3 max-h-44 lg:max-h-none">
                    {course.modules.map(m => (
                        <div key={m.id} className="mb-3">
                            <p className="px-2 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1">{m.title}</p>
                            <div className="space-y-0.5">
                                {m.lessons.map(l => {
                                    const d = done.has(l.id);
                                    const isActive = l.id === activeId;
                                    return (
                                        <button key={l.id} type="button" onClick={() => setActiveId(l.id)} className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs transition-colors ${isActive ? 'bg-purple-500/15 text-purple-200 border border-purple-500/30' : 'text-slate-400 hover:bg-slate-800/60 border border-transparent'}`}>
                                            <i className={`fa-solid ${d ? 'fa-circle-check text-emerald-400' : 'fa-circle text-slate-600'} text-[11px] shrink-0`} aria-hidden />
                                            <span className="flex-1 truncate">{l.title}</span>
                                            {l.videoUrl && <i className="fa-solid fa-play text-[9px] text-slate-500 shrink-0" aria-hidden />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                    {course.outcomes.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-slate-800">
                            <p className="px-2 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1">Competency</p>
                            {course.outcomes.map(o => {
                                const v = verdictByOutcome.get(o.id);
                                return (
                                    <div key={o.id} className="flex items-center gap-2 px-2 py-1 text-xs text-slate-400">
                                        <i className={`fa-solid text-[11px] shrink-0 ${v === 'competent' ? 'fa-circle-check text-emerald-400' : v === 'not_yet_competent' ? 'fa-circle-xmark text-amber-400' : 'fa-circle text-slate-600'}`} aria-hidden />
                                        <span className="flex-1 truncate">{o.title}</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </nav>

                {/* Lesson content */}
                <main className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                    {!activeLesson ? (
                        <div className="h-full flex items-center justify-center text-slate-500 text-sm">This course has no lessons yet.</div>
                    ) : (
                        <div className="max-w-3xl mx-auto p-5 sm:p-8 space-y-6">
                            <div>
                                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">{active?.moduleTitle}</p>
                                <h1 className="text-xl font-bold text-white mt-1">{activeLesson.title}</h1>
                                {activeLesson.estimatedMinutes != null && <p className="text-[11px] text-slate-500 mt-1"><i className="fa-solid fa-clock mr-1" aria-hidden />{activeLesson.estimatedMinutes} min</p>}
                            </div>
                            {embedUrl && (
                                <div className="relative w-full rounded-lg overflow-hidden border border-slate-800 bg-black" style={{ aspectRatio: '16 / 9' }}>
                                    <iframe src={embedUrl} title={activeLesson.title} className="absolute inset-0 w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                                </div>
                            )}
                            {activeLesson.videoUrl && !embedUrl && (
                                <a href={activeLesson.videoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-purple-400 hover:text-purple-300"><i className="fa-solid fa-play" aria-hidden /> Watch the video</a>
                            )}
                            <LessonContentView value={activeLesson.content} className="text-slate-300" />
                            <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-slate-800">
                                {canToggle ? (
                                    <>
                                        <button type="button" disabled={busy} onClick={markCompleteAndNext} className="px-5 py-2.5 text-xs font-black uppercase tracking-widest rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:bg-slate-700 disabled:cursor-not-allowed">
                                            {isDone ? 'Next lesson' : 'Mark complete & continue'}
                                        </button>
                                        <button type="button" disabled={busy} onClick={() => onToggleLesson(enrollment.id, activeLesson.id, !isDone)} className="px-4 py-2.5 text-xs font-bold uppercase tracking-widest rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 disabled:opacity-50">
                                            {isDone ? 'Mark incomplete' : 'Mark complete'}
                                        </button>
                                    </>
                                ) : (
                                    <span className="text-xs font-bold uppercase tracking-widest text-emerald-400"><i className="fa-solid fa-circle-check mr-1.5" aria-hidden />{enrollment.status === 'completed' ? 'Course completed' : 'Enrolment closed'}</span>
                                )}
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>,
        document.body,
    );
};
