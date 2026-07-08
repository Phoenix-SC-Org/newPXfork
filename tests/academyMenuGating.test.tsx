import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';

// Pins the Academy hub's sub-nav permission gating so it can't silently regress:
// the Instructor group (Course Builder, Sessions & Rosters) shows only with
// academy:instruct OR academy:manage; the Learning Managers group (Approvals,
// Certify) only with academy:manage; My Academy (Course Catalog, My Learning) is
// always shown. This is the client-side menu gate; the server enforces the real
// boundary (academy:* perms + the feature gate) — see tests/academySecurity.test.ts.

const h = vi.hoisted(() => ({ perms: new Set<string>() }));

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ hasPermission: (p: string) => h.perms.has(p) }) }));
vi.mock('../contexts/AcademyContext', () => ({ useAcademy: () => ({ academyCourses: [], academyMyEnrollments: [], refreshAcademy: async () => {}, refreshMyAcademy: async () => {} }) }));
vi.mock('../contexts/DataContext', () => ({ useData: () => ({ isFetching: {} }) }));
vi.mock('../components/shared/ui/HeroShell', () => ({ default: () => null }));
vi.mock('../components/shared/ui/HeroStat', () => ({ default: () => null }));
vi.mock('../components/views/academy/AcademyStudentTabs', () => ({ CatalogTab: () => null, MyLearningTab: () => null }));
vi.mock('../components/views/academy/AcademyInstructorTabs', () => ({ CourseBuilderTab: () => null, SessionsTab: () => null }));
vi.mock('../components/views/academy/AcademyManagerTabs', () => ({ ApprovalsTab: () => null, CertifyTab: () => null }));

import AcademyHubView from '../components/views/academy/AcademyHubView';

const STUDENT = ['Course Catalog', 'My Learning'];
const INSTRUCTOR = ['Course Builder', 'Sessions & Rosters'];
const MANAGER = ['Approvals', 'Certify'];

function menuText(): string {
    return render(<AcademyHubView />).container.textContent || '';
}

beforeEach(() => { h.perms = new Set(); });

describe('AcademyHubView — sub-nav permission gating', () => {
    it('a member with NO academy perms sees only My Academy (no staff menu items)', () => {
        const text = menuText();
        for (const label of STUDENT) expect(text, label).toContain(label);
        for (const label of [...INSTRUCTOR, ...MANAGER]) expect(text, label).not.toContain(label);
    });

    it('academy:view alone reveals NO staff menu items (it is a load-bundle perm, not a menu-reveal)', () => {
        h.perms = new Set(['academy:view']);
        const text = menuText();
        for (const label of [...INSTRUCTOR, ...MANAGER]) expect(text, label).not.toContain(label);
    });

    it('academy:instruct reveals the Instructor group but NOT Learning Managers', () => {
        h.perms = new Set(['academy:instruct']);
        const text = menuText();
        for (const label of INSTRUCTOR) expect(text, label).toContain(label);
        for (const label of MANAGER) expect(text, label).not.toContain(label);
    });

    it('academy:manage reveals BOTH the Instructor and Learning Managers groups', () => {
        h.perms = new Set(['academy:manage']);
        const text = menuText();
        for (const label of [...INSTRUCTOR, ...MANAGER]) expect(text, label).toContain(label);
    });
});
