import React, { useState } from 'react';
import WindowFrame from '../../layout/WindowFrame';
import { useData } from '../../../contexts/DataContext';
import type { QmLocation } from '../../../types';
import { useNotification } from '../../../contexts/NotificationContext';
import { useI18n } from '../../../i18n/I18nContext';

interface Props {
    locations: QmLocation[];
    onClose: () => void;
    onSubmitted: () => void;
}

export default function CreateLocationModal({ locations, onClose, onSubmitted }: Props) {
    const { rpcAction } = useData();
    const { addToast } = useNotification();
    const { t } = useI18n();
    const [name, setName] = useState('');
    const [type, setType] = useState<QmLocation['type']>('hangar');
    const [parentId, setParentId] = useState<number | null>(null);
    const [description, setDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const valid = name.trim().length > 0;

    const submit = async () => {
        if (!valid || submitting) return;
        setSubmitting(true);
        try {
            await rpcAction('qm:create_location', {
                name: name.trim(),
                type,
                parentId: parentId ?? undefined,
                description: description.trim() || undefined,
            });
            addToast(t('Location created'), <i className="fa-solid fa-check" />, 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50');
            onSubmitted();
        } catch (err: any) {
            addToast(t('Create failed'), <i className="fa-solid fa-xmark" />, 'bg-red-500/10 text-red-400 border-red-500/50', {
                description: err?.message,
            });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <WindowFrame
            isOpen
            onClose={onClose}
            title={t('New Location')}
            subtitle={t('Quartermaster')}
            icon="fa-solid fa-map-location-dot"
            color="amber"
            width="max-w-md"
        >
            <div className="p-5 space-y-4">
                <label className="block">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400">{t('Name')}</span>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('e.g. Main Hangar')}
                        maxLength={80}
                        className="mt-1 w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                    />
                </label>

                <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                        <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400">{t('Type')}</span>
                        <select
                            value={type}
                            onChange={(e) => setType(e.target.value as QmLocation['type'])}
                            className="mt-1 w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                        >
                            <option value="hangar">{t('Hangar')}</option>
                            <option value="ship">{t('Ship')}</option>
                            <option value="station">{t('Station')}</option>
                            <option value="custom">{t('Custom')}</option>
                        </select>
                    </label>
                    <label className="block">
                        <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400">{t('Parent (optional)')}</span>
                        <select
                            value={parentId ?? ''}
                            onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)}
                            className="mt-1 w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                        >
                            <option value="">{t('— none —')}</option>
                            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                    </label>
                </div>

                <label className="block">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400">{t('Description (optional)')}</span>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={2}
                        maxLength={400}
                        className="mt-1 w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                    />
                </label>

                <div className="flex justify-end gap-2 pt-2">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-white">
                        {t('Cancel')}
                    </button>
                    <button
                        onClick={submit}
                        disabled={!valid || submitting}
                        className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {submitting ? t('Creating…') : t('Create Location')}
                    </button>
                </div>
            </div>
        </WindowFrame>
    );
}
