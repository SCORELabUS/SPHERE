import { useState, useEffect, useCallback, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { AnimatePresence, motion } from 'framer-motion';
import { FiUser, FiGlobe, FiLink2, FiBell, FiCreditCard, FiAlertTriangle, FiChevronDown } from 'react-icons/fi';
import { type UserSettings } from '../api/userSettingsApi';
import { useAuth } from '../../auth/hooks/useAuth';
import AccountSection from '../components/AccountSection';
import PublicProfileSection from '../components/PublicProfileSection';
import SocialLinksSection from '../components/SocialLinksSection';
import NotificationsSection from '../components/NotificationsSection';
import PaymentsSection from '../components/PaymentsSection';
import DangerZoneSection from '../components/DangerZoneSection';
import UnsavedChangesDialog from '../components/UnsavedChangesDialog';
import { fadeInUp, transitionDefault } from '../../core/utils/motion-variants';

const SECTIONS = [
  { id: 'account', label: 'Account', icon: FiUser },
  { id: 'profile', label: 'Public Profile', icon: FiGlobe },
  { id: 'social', label: 'Social Links', icon: FiLink2 },
  { id: 'notifications', label: 'Notifications', icon: FiBell },
  { id: 'payments', label: 'Payments', icon: FiCreditCard },
  { id: 'danger', label: 'Danger Zone', icon: FiAlertTriangle },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

function buildUserSettings(authUser: any): UserSettings | null {
  if (!authUser?.user) return null;
  const u = authUser.user;
  return {
    id: u.id,
    username: u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    role: u.role,
    settings: u.settings,
  };
}

export default function SettingsPage() {
  const { authUser, updateUser, updateUserSettings } = useAuth();
  const [activeSection, setActiveSection] = useState<SectionId>('account');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [pendingSection, setPendingSection] = useState<SectionId | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const dirtySectionsRef = useRef<Record<string, boolean>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);

  const settings = buildUserSettings(authUser);

  const updateSettings = useCallback((partial: Partial<UserSettings>) => {
    if (partial.settings) {
      updateUserSettings(partial.settings);
    }
    const userFields: Record<string, unknown> = {};
    if (partial.firstName !== undefined) userFields.firstName = partial.firstName;
    if (partial.lastName !== undefined) userFields.lastName = partial.lastName;
    if (partial.email !== undefined) userFields.email = partial.email;
    if (Object.keys(userFields).length > 0) {
      updateUser(userFields);
    }
  }, [updateUserSettings, updateUser]);

  const markDirty = useCallback((sectionId: string, dirty: boolean) => {
    dirtySectionsRef.current[sectionId] = dirty;
  }, []);

  const switchSection = useCallback((newSection: SectionId) => {
    if (dirtySectionsRef.current[activeSection]) {
      setPendingSection(newSection);
      setShowUnsavedDialog(true);
      return;
    }
    setActiveSection(newSection);
  }, [activeSection]);

  const confirmDiscard = useCallback(() => {
    if (pendingSection) {
      dirtySectionsRef.current[activeSection] = false;
      setActiveSection(pendingSection);
      setPendingSection(null);
    }
    setShowUnsavedDialog(false);
  }, [pendingSection, activeSection]);

  const cancelDiscard = useCallback(() => {
    setPendingSection(null);
    setShowUnsavedDialog(false);
  }, []);

  const accountDirtyChange = useCallback((d: boolean) => markDirty('account', d), [markDirty]);
  const profileDirtyChange = useCallback((d: boolean) => markDirty('profile', d), [markDirty]);
  const socialDirtyChange = useCallback((d: boolean) => markDirty('social', d), [markDirty]);
  const notificationsDirtyChange = useCallback((d: boolean) => markDirty('notifications', d), [markDirty]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeMeta = SECTIONS.find((s) => s.id === activeSection)!;

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center py-24">
        <p className="text-sm text-tp-steel">Failed to load settings</p>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>Settings | SPHERE</title>
      </Helmet>
      <div className="mx-auto h-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={fadeInUp}
          transition={transitionDefault}
          className="mb-8"
        >
          <h1 className="font-display text-3xl text-tp-ink">Settings</h1>
          <p className="mt-1 text-sm text-tp-steel">
            Manage your account, profile, and preferences
          </p>
        </motion.div>

        {/* Mobile dropdown selector */}
        <div className="mb-5 lg:hidden" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex w-full cursor-pointer items-center justify-between rounded-[8px] border border-tp-hairline-strong bg-tp-canvas px-4 py-3 text-sm font-medium text-tp-ink transition-colors hover:border-tp-hairline"
          >
            <span className="flex items-center gap-3">
              <activeMeta.icon className="h-4 w-4 text-tp-primary" />
              {activeMeta.label}
            </span>
            <motion.div
              animate={{ rotate: dropdownOpen ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <FiChevronDown className="h-4 w-4 text-tp-steel" />
            </motion.div>
          </button>

          <AnimatePresence>
            {dropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4, scaleY: 0.95 }}
                animate={{ opacity: 1, y: 0, scaleY: 1 }}
                exit={{ opacity: 0, y: -4, scaleY: 0.95 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                style={{ transformOrigin: 'top' }}
                className="mt-1 overflow-hidden rounded-[8px] border border-tp-hairline bg-tp-canvas shadow-elevation-4"
              >
                {SECTIONS.map((section) => {
                  const isActive = activeSection === section.id;
                  const Icon = section.icon;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => {
                        switchSection(section.id);
                        setDropdownOpen(false);
                      }}
                      className={`flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-tp-primary/10 text-tp-primary'
                          : 'text-tp-steel hover:bg-tp-surface hover:text-tp-ink'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {section.label}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex gap-8">
          {/* Desktop sidebar */}
          <motion.aside
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="hidden w-56 shrink-0 lg:block"
          >
            <nav className="sticky top-24 space-y-0.5">
              {SECTIONS.map((section) => {
                const isActive = activeSection === section.id;
                const Icon = section.icon;
                return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => switchSection(section.id)}
                      className={`flex w-full cursor-pointer items-center gap-3 rounded-[8px] px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                        isActive
                          ? 'bg-tp-primary/10 text-tp-primary'
                          : 'text-tp-steel hover:bg-tp-surface hover:text-tp-ink'
                      }`}
                    >
                    <Icon className="h-4 w-4 shrink-0" />
                    {section.label}
                  </button>
                );
              })}
            </nav>
          </motion.aside>

          {/* Content area */}
          <div className="min-w-0 flex-1 pb-8 lg:pb-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSection}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                {activeSection === 'account' && (
                  <AccountSection settings={settings} onUpdate={updateSettings} onDirtyChange={accountDirtyChange} />
                )}
                {activeSection === 'profile' && (
                  <PublicProfileSection settings={settings} onUpdate={updateSettings} onDirtyChange={profileDirtyChange} />
                )}
                {activeSection === 'social' && (
                  <SocialLinksSection settings={settings} onUpdate={updateSettings} onDirtyChange={socialDirtyChange} />
                )}
                {activeSection === 'notifications' && (
                  <NotificationsSection settings={settings} onUpdate={updateSettings} onDirtyChange={notificationsDirtyChange} />
                )}
                {activeSection === 'payments' && <PaymentsSection settings={settings} />}
                {activeSection === 'danger' && <DangerZoneSection />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onDiscard={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  );
}
