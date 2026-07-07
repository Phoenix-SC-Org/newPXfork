
import React, { useState, useMemo } from 'react';
import { useMembers } from '../../../contexts/MembersContext';

import { Certification } from '../../../types';
import AwardCertificationModal from '../../modals/AwardCertificationModal';
import CertificationModal from '../../modals/CertificationModal';
import { useTableControls } from '../../../hooks/useTableControls';
import AwardIcon from '../../common/AwardIcon';
import { TabPageHeader } from '../../shared/ui';
import { useNotification } from '../../../contexts/NotificationContext';
import { useI18n } from '../../../i18n/I18nContext';

const CertificationsManagementTab: React.FC = () => {
    const { certifications, allUsers, deleteCertification } = useMembers();
    const { confirm } = useNotification();
    const { t } = useI18n();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isAwardModalOpen, setIsAwardModalOpen] = useState(false);
    const [editingCert, setEditingCert] = useState<Certification | undefined>(undefined);
    const [awardingCert, setAwardingCert] = useState<Certification | undefined>(undefined);
    const [searchTerm, setSearchTerm] = useState('');

    const certData = useMemo(() => {
        const memberCounts = new Map<number, number>();
        allUsers.forEach(user => {
            user.certifications?.forEach(c => {
                memberCounts.set(c.id, (memberCounts.get(c.id) || 0) + 1);
            });
        });
        return certifications.map(cert => ({
            ...cert,
            memberCount: memberCounts.get(cert.id) || 0,
        }));
    }, [certifications, allUsers]);
    
    const { sortedAndFilteredItems } = useTableControls(
        certData,
        { key: 'name', direction: 'ascending' },
        ['name', 'description'],
        searchTerm
    );

    const openModal = (cert?: Certification) => {
        setEditingCert(cert);
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setEditingCert(undefined);
        setIsModalOpen(false);
    };

    const openAwardModal = (cert: Certification) => {
        setAwardingCert(cert);
        setIsAwardModalOpen(true);
    };
    
    const closeAwardModal = () => {
        setAwardingCert(undefined);
        setIsAwardModalOpen(false);
    };

    const handleDelete = async (cert: Certification & { memberCount: number }) => {
        if (cert.memberCount > 0) {
            await confirm({ title: t('Cannot Delete'), message: t('Cannot delete "{name}" as it has been awarded to {count} member(s).', { name: cert.name, count: cert.memberCount }), confirmText: t('OK'), variant: 'info' });
            return;
        }
        if (await confirm({ title: t('Delete Certification'), message: t('Are you sure you want to permanently delete the certification "{name}"? This action cannot be undone.', { name: cert.name }), confirmText: t('Delete'), variant: 'danger' })) {
            deleteCertification(cert.id);
        }
    };

    return (
        <div className="p-4 md:p-8 space-y-6 animate-fade-in">
            <TabPageHeader
                title={t("Certifications")}
                icon="fa-solid fa-certificate"
                accent="amber"
                subtitle={t("Manage training credentials and awards.")}
                actions={
                    <div className="flex gap-2 w-full md:w-auto">
                        <div className="relative flex-1 md:w-64">
                            <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                            <input
                                type="text"
                                placeholder={t("Search certifications...")}
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="w-full bg-slate-900/60 border border-slate-700 rounded-lg py-2.5 pl-10 pr-4 text-white placeholder:text-slate-500 focus:ring-1 focus:ring-slate-400/50 focus:border-slate-500 outline-hidden text-sm font-medium transition-all"
                            />
                        </div>
                        <button
                            onClick={() => openModal()}
                            className="flex items-center justify-center bg-slate-700 text-white font-bold px-4 py-2.5 rounded-lg border border-slate-600 hover:bg-slate-600 transition-colors shadow-lg text-sm whitespace-nowrap"
                        >
                            <i className="fa-solid fa-plus mr-2" />
                            {t('Create Cert')}
                        </button>
                    </div>
                }
            />

            <div className="bg-slate-900/40 rounded-xl border border-slate-700/50 overflow-hidden">
                 <div className="flex bg-slate-800/60 p-4 border-b border-slate-700/50 text-xs font-black text-slate-500 uppercase tracking-widest">
                    <div className="flex-1 md:w-1/4 md:flex-none">{t('Certification Name')}</div>
                    <div className="flex-1 hidden md:block">{t('Description')}</div>
                    <div className="w-32 text-center hidden md:block">{t('Holders')}</div>
                    <div className="w-32 text-right">{t('Actions')}</div>
                </div>

                <div className="divide-y divide-slate-700/50">
                    {sortedAndFilteredItems.map(cert => (
                        <div key={cert.id} className="flex items-center p-4 hover:bg-slate-800/50 transition-colors group">
                             <div className="flex-1 md:w-1/4 md:flex-none pr-4">
                                <div className="flex items-center">
                                    <div className="w-8 h-8 rounded-sm bg-slate-800 flex items-center justify-center border border-slate-700 text-green-400 mr-3 shrink-0 overflow-hidden">
                                        <AwardIcon imageUrl={cert.imageUrl} icon={cert.icon} fallbackIcon="fa-solid fa-certificate" className="max-w-full max-h-full" alt={cert.name} />
                                    </div>
                                    <div className="min-w-0">
                                        <span className="font-bold text-white text-sm truncate block">{cert.name}</span>
                                        <span className="text-xs text-slate-500 md:hidden">{cert.memberCount === 1 ? t('{count} holder', { count: cert.memberCount }) : t('{count} holders', { count: cert.memberCount })}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex-1 pr-4 text-sm text-slate-400 hidden md:block">
                                {cert.description || <span className="opacity-50">-</span>}
                            </div>
                            <div className="w-32 text-center hidden md:block">
                                 <span className={`text-xs font-mono font-bold px-2 py-1 rounded-sm ${cert.memberCount > 0 ? 'bg-slate-800 text-white' : 'text-slate-600'}`}>
                                    {cert.memberCount}
                                </span>
                            </div>
                            <div className="w-32 text-right flex justify-end gap-2">
                                <button onClick={() => openAwardModal(cert)} className="p-1.5 text-slate-400 hover:text-green-400 hover:bg-green-900/20 rounded-sm transition-colors" title={t("Award to Users")}>
                                    <i className="fa-solid fa-user-plus"></i>
                                </button>
                                <button onClick={() => openModal(cert)} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-sm transition-colors" title={t("Edit")}>
                                    <i className="fa-solid fa-pencil"></i>
                                </button>
                                <button 
                                    onClick={() => handleDelete(cert)} 
                                    className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-900/20 rounded-sm transition-colors disabled:opacity-30" 
                                    title={t("Delete")}
                                    disabled={cert.memberCount > 0}
                                >
                                    <i className="fa-solid fa-trash-can"></i>
                                </button>
                            </div>
                        </div>
                    ))}
                    {sortedAndFilteredItems.length === 0 && (
                        <div className="p-12 text-center">
                            <p className="text-slate-500 font-medium italic">{t('No certifications found.')}</p>
                        </div>
                    )}
                </div>
            </div>

            {isModalOpen && (
                <CertificationModal
                    isOpen={isModalOpen}
                    onClose={closeModal}
                    certification={editingCert}
                />
            )}

            {isAwardModalOpen && awardingCert && (
                <AwardCertificationModal
                    isOpen={isAwardModalOpen}
                    onClose={closeAwardModal}
                    certification={awardingCert}
                />
            )}
        </div>
    );
};

export default CertificationsManagementTab;
