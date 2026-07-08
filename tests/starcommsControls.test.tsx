import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { I18nProvider } from '../i18n/I18nContext';

// Context hooks are mocked so the container's admin-gate/confirm/write/refresh
// flow is testable in isolation. i18n stays real (via I18nProvider) so button
// labels resolve to their natural English keys.
const mocks = vi.hoisted(() => ({
    hasPermission: vi.fn(() => true),
    rpcAction: vi.fn(),
    confirm: vi.fn(),
    addToast: vi.fn(),
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ hasPermission: mocks.hasPermission }) }));
vi.mock('../contexts/DataContext', () => ({ useData: () => ({ rpcAction: mocks.rpcAction }) }));
vi.mock('../contexts/NotificationContext', () => ({ useNotification: () => ({ confirm: mocks.confirm, addToast: mocks.addToast }) }));

// Imported AFTER the mocks are registered.
import StarCommsOperationControls, { StarCommsOperationControlsView } from '../components/shared/StarCommsOperationControls';

const openBtn = () => screen.getByRole('button', { name: /Open StarComms operation/i });
const closeBtn = () => screen.getByRole('button', { name: /Close StarComms operation/i });

// --- Pure view: visibility + disabled logic --------------------------------

const renderView = (over: Partial<React.ComponentProps<typeof StarCommsOperationControlsView>> = {}) => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const utils = render(
        <I18nProvider>
            <StarCommsOperationControlsView
                canManage
                enabled
                configured
                operationOpen={false}
                statusAvailable
                writing={null}
                compact={false}
                onOpen={onOpen}
                onClose={onClose}
                {...over}
            />
        </I18nProvider>,
    );
    return { onOpen, onClose, ...utils };
};

describe('StarCommsOperationControlsView — admin-only manual controls', () => {
    afterEach(() => cleanup());

    it('renders nothing for users without admin:access', () => {
        const { container } = renderView({ canManage: false });
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing when StarComms is disabled', () => {
        const { container } = renderView({ enabled: false });
        expect(container.firstChild).toBeNull();
    });

    it('enables Open and disables Close when the operation is closed', () => {
        renderView({ operationOpen: false });
        expect((openBtn() as HTMLButtonElement).disabled).toBe(false);
        expect((closeBtn() as HTMLButtonElement).disabled).toBe(true);
    });

    it('disables Open and enables Close when the operation is already open', () => {
        renderView({ operationOpen: true });
        expect((openBtn() as HTMLButtonElement).disabled).toBe(true);
        expect((closeBtn() as HTMLButtonElement).disabled).toBe(false);
    });

    it('disables both buttons when the status is unavailable', () => {
        renderView({ statusAvailable: false, operationOpen: null });
        expect((openBtn() as HTMLButtonElement).disabled).toBe(true);
        expect((closeBtn() as HTMLButtonElement).disabled).toBe(true);
    });

    it('disables both buttons while a write is in flight (loading state)', () => {
        renderView({ operationOpen: false, writing: 'open' });
        expect((openBtn() as HTMLButtonElement).disabled).toBe(true);
        expect((closeBtn() as HTMLButtonElement).disabled).toBe(true);
    });

    it('invokes the click handler for the enabled button', () => {
        const { onOpen } = renderView({ operationOpen: false });
        fireEvent.click(openBtn());
        expect(onOpen).toHaveBeenCalledTimes(1);
    });
});

// --- Container: confirm + write + refresh ----------------------------------

describe('StarCommsOperationControls — container write flow', () => {
    afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.hasPermission.mockReturnValue(true); });

    const renderContainer = (over: Partial<React.ComponentProps<typeof StarCommsOperationControls>> = {}) => {
        const onRefresh = vi.fn();
        const utils = render(
            <I18nProvider>
                <StarCommsOperationControls enabled configured operationOpen={false} statusAvailable onRefresh={onRefresh} {...over} />
            </I18nProvider>,
        );
        return { onRefresh, ...utils };
    };

    it('hides the controls entirely for non-admins (read-only widget stays clean)', () => {
        mocks.hasPermission.mockReturnValue(false);
        const { container } = renderContainer();
        expect(container.querySelector('button')).toBeNull();
    });

    it('requires confirmation — no backend call when the dialog is dismissed', async () => {
        mocks.confirm.mockResolvedValue(false);
        renderContainer({ operationOpen: false });
        fireEvent.click(openBtn());
        await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
        expect(mocks.rpcAction).not.toHaveBeenCalled();
    });

    it('calls the admin open action and refreshes on success', async () => {
        mocks.confirm.mockResolvedValue(true);
        mocks.rpcAction.mockResolvedValue({ ok: true, error: null });
        const { onRefresh } = renderContainer({ operationOpen: false });
        fireEvent.click(openBtn());
        await waitFor(() => expect(mocks.rpcAction).toHaveBeenCalledWith('admin:starcomms_open', {}));
        await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    });

    it('calls the admin close action with { } payload', async () => {
        mocks.confirm.mockResolvedValue(true);
        mocks.rpcAction.mockResolvedValue({ ok: true, error: null });
        renderContainer({ operationOpen: true });
        fireEvent.click(closeBtn());
        await waitFor(() => expect(mocks.rpcAction).toHaveBeenCalledWith('admin:starcomms_close', {}));
    });

    it('shows a non-blocking error and does NOT refresh on failure', async () => {
        mocks.confirm.mockResolvedValue(true);
        mocks.rpcAction.mockResolvedValue({ ok: false, error: { kind: 'unauthorized', message: 'nope' } });
        const { onRefresh } = renderContainer({ operationOpen: true });
        fireEvent.click(closeBtn());
        await waitFor(() => expect(mocks.addToast).toHaveBeenCalled());
        expect(onRefresh).not.toHaveBeenCalled();
    });
});
