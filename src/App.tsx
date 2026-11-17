import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { Sparkles } from 'lucide-react';
import { I18nProvider, useI18n } from './i18n/I18nContext';
import { auth, db, signOutUser, testFirestoreConnection } from './lib/firebase';
import {
  createBusinessWorkspace,
  ensureUserProfile,
  fetchOwnerBusinesses,
  subscribeBusinessSubcollection,
  updateUserProfile,
} from './services/dataAccess';
import type {
  ActivityLog,
  Agent,
  AiChatMessage,
  AnalyticsReport,
  Approval,
  Automation,
  AutomationRun,
  Business,
  BusinessMemoryItem,
  Campaign,
  Contact,
  ContentItem,
  Integration,
  MediaAsset,
  NavSection,
  Order,
  Product,
  Task,
  UserProfile,
} from './types/domain';
import { AppErrorBoundary, ErrorState, LoadingState } from './components/ui/Primitives';
import { AuthScreen } from './components/auth/AuthScreen';
import { BusinessBuilderWizard } from './components/onboarding/BusinessBuilderWizard';
import { AppShell } from './components/layout/AppShell';
import { AiManagerDrawer } from './components/ai/AiManagerDrawer';
import { OverviewPage } from './pages/OverviewPage';
import { WorkforcePage } from './pages/WorkforcePage';
import { ContentStudioPage } from './pages/ContentStudioPage';
import { SocialPlannerPage } from './pages/SocialPlannerPage';
import { MediaLibraryPage } from './pages/MediaLibraryPage';
import { CrmPage } from './pages/CrmPage';
import { ProductsPage } from './pages/ProductsPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AutomationsPage } from './pages/AutomationsPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { BusinessMemoryPage } from './pages/BusinessMemoryPage';
import { fetchAuthMe } from './services/apiClient';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { AiProvidersAdminPage } from './pages/AiProvidersAdminPage';
import { SettingsPage } from './pages/SettingsPage';

function FirstWorkspacePrompt({
  user,
  onCreate,
  onSignOut,
}: {
  user: User;
  onCreate: (name: string, creatorName: string) => Promise<void>;
  onSignOut: () => void;
}) {
  const [bizName, setBizName] = useState('');
  const [creatorName, setCreatorName] = useState(user.displayName || 'سازنده محتوا');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bizName.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      await onCreate(bizName.trim(), creatorName.trim() || 'سازنده محتوا');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ساخت فضای کاری');
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B1020] text-[#F8FAFC] flex items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="max-w-lg w-full bg-[#151E33] border border-[#273449] rounded-xl p-7 space-y-5"
      >
        <div className="flex items-center gap-2.5 text-[#8B5CF6]">
          <Sparkles className="w-5 h-5" />
          <span className="text-xs font-semibold">خوش آمدید — راه‌اندازی فضای کاری جدید</span>
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-[#F8FAFC]">ساخت اولین کسب‌وکار محتوایی</h1>
          <p className="text-xs text-[#94A3B8] leading-relaxed">
            با ایجاد فضای کاری، تیم ۵ نفره ایجنت‌های هوش مصنوعی، مرکز تأیید انسانی، تقویم شمسی و استودیو محتوا به‌طور خودکار آماده می‌شوند.
          </p>
        </div>

        {error && <ErrorState message={error} />}

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[#94A3B8] mb-1.5">نام کسب‌وکار یا رسانه شما *</label>
            <input
              value={bizName}
              onChange={(e) => setBizName(e.target.value)}
              placeholder="مثلاً: استودیو آموزش طراحی نیما"
              className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2.5 text-sm outline-none"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-[#94A3B8] mb-1.5">نام شما (سازنده محتوا)</label>
            <input
              value={creatorName}
              onChange={(e) => setCreatorName(e.target.value)}
              className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2.5 text-sm outline-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={onSignOut}
            className="text-xs text-[#94A3B8] hover:text-[#F8FAFC]"
          >
            خروج از حساب
          </button>
          <button
            type="submit"
            disabled={creating || !bizName.trim()}
            className="px-5 py-2.5 bg-[#6366F1] hover:bg-[#5558E6] disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {creating ? 'در حال آماده‌سازی...' : 'ساخت فضای کاری و شروع'}
          </button>
        </div>
      </form>
    </div>
  );
}

function AutopilotRoot() {
  const { setLocale } = useI18n();

  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null);
  const [activeBusiness, setActiveBusiness] = useState<Business | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [wizardOverride, setWizardOverride] = useState(false);

  const [activeNav, setActiveNav] = useState<NavSection>('overview');
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  // Real-time subcollection states
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [automationRuns, setAutomationRuns] = useState<AutomationRun[]>([]);
  const [businessMemory, setBusinessMemory] = useState<BusinessMemoryItem[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [analyticsReports, setAnalyticsReports] = useState<AnalyticsReport[]>([]);
  const [aiChats, setAiChats] = useState<AiChatMessage[]>([]);

  useEffect(() => {
    void testFirestoreConnection();
  }, []);

  const loadUserWorkspace = useCallback(
    async (user: User) => {
      setLoadingWorkspace(true);
      setBootError(null);
      try {
        const profile = await ensureUserProfile({
          uid: user.uid,
          email: user.email || '',
          displayName: user.displayName || 'کاربر سازنده',
          avatarUrl: user.photoURL || '',
        });
        setUserProfile(profile);
        setLocale(profile.preferredLocale || 'fa');

        const bizList = await fetchOwnerBusinesses(user.uid);
        setBusinesses(bizList);

        if (bizList.length > 0) {
          const preferred =
            bizList.find((b) => b.id === profile.activeBusinessId) || bizList[0];
          setActiveBusinessId(preferred.id);
          setActiveBusiness(preferred);
        } else {
          setActiveBusinessId(null);
          setActiveBusiness(null);
        }
      } catch (err) {
        setBootError(err instanceof Error ? err.message : 'خطا در بارگذاری اطلاعات حساب');
      } finally {
        setLoadingWorkspace(false);
      }
    },
    [setLocale]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (user) {
        void loadUserWorkspace(user);
        void fetchAuthMe()
          .then((me) => setIsSuperAdmin(Boolean(me.isSuperAdmin)))
          .catch(() => setIsSuperAdmin(false));
      } else {
        setIsSuperAdmin(false);
        setUserProfile(null);
        setBusinesses([]);
        setActiveBusinessId(null);
        setActiveBusiness(null);
      }
    });
    return () => unsub();
  }, [loadUserWorkspace]);

  // Real-time subscription to UserProfile
  useEffect(() => {
    if (!firebaseUser) return;
    const unsub = onSnapshot(
      doc(db, 'users', firebaseUser.uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as UserProfile;
          setUserProfile(data);
          setLocale(data.preferredLocale || 'fa');
        }
      },
      (err) => {
        console.error('User profile snapshot error:', err);
      }
    );
    return () => unsub();
  }, [firebaseUser, setLocale]);

  // Real-time subscription to active Business + its 16 subcollections
  useEffect(() => {
    if (!firebaseUser || !activeBusinessId) return;
    const ownerId = firebaseUser.uid;
    const bizId = activeBusinessId;

    const unsubs = [
      onSnapshot(
        doc(db, 'businesses', bizId),
        (snap) => {
          if (snap.exists()) {
            const updated = snap.data() as Business;
            setActiveBusiness(updated);
            setBusinesses((prev) =>
              prev.some((b) => b.id === updated.id)
                ? prev.map((b) => (b.id === updated.id ? updated : b))
                : [updated, ...prev]
            );
          }
        },
        (err) => {
          console.error('Business snapshot error:', err);
        }
      ),
      subscribeBusinessSubcollection<Agent>(bizId, ownerId, 'agents', setAgents, 20),
      subscribeBusinessSubcollection<Task>(bizId, ownerId, 'tasks', setTasks, 100),
      subscribeBusinessSubcollection<Approval>(bizId, ownerId, 'approvals', setApprovals, 100),
      subscribeBusinessSubcollection<ContentItem>(bizId, ownerId, 'content', setContent, 150),
      subscribeBusinessSubcollection<MediaAsset>(bizId, ownerId, 'mediaAssets', setMediaAssets, 100),
      subscribeBusinessSubcollection<Contact>(bizId, ownerId, 'contacts', setContacts, 200),
      subscribeBusinessSubcollection<Product>(bizId, ownerId, 'products', setProducts, 100),
      subscribeBusinessSubcollection<Order>(bizId, ownerId, 'orders', setOrders, 100),
      subscribeBusinessSubcollection<Campaign>(bizId, ownerId, 'campaigns', setCampaigns, 100),
      subscribeBusinessSubcollection<Automation>(bizId, ownerId, 'automations', setAutomations, 50),
      subscribeBusinessSubcollection<AutomationRun>(bizId, ownerId, 'automationRuns', setAutomationRuns, 50),
      subscribeBusinessSubcollection<BusinessMemoryItem>(bizId, ownerId, 'businessMemory', setBusinessMemory, 150),
      subscribeBusinessSubcollection<ActivityLog>(bizId, ownerId, 'activityLogs', setActivityLogs, 100),
      subscribeBusinessSubcollection<Integration>(bizId, ownerId, 'integrations', setIntegrations, 30),
      subscribeBusinessSubcollection<AnalyticsReport>(bizId, ownerId, 'analyticsReports', setAnalyticsReports, 50),
      subscribeBusinessSubcollection<AiChatMessage>(bizId, ownerId, 'aiChats', setAiChats, 80),
    ];

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [firebaseUser, activeBusinessId]);

  const handleCreateNewBusiness = async (name: string, creatorName: string) => {
    if (!firebaseUser) return;
    const created = await createBusinessWorkspace({
      ownerId: firebaseUser.uid,
      name,
      creatorName,
    });
    setBusinesses((prev) => [created, ...prev]);
    setActiveBusinessId(created.id);
    setActiveBusiness(created);
    setWizardOverride(false);
  };

  const handleSelectBusiness = async (bizId: string) => {
    if (!firebaseUser) return;
    const found = businesses.find((b) => b.id === bizId);
    if (!found) return;
    setActiveBusinessId(found.id);
    setActiveBusiness(found);
    await updateUserProfile(firebaseUser.uid, { activeBusinessId: found.id });
  };

  const metricsSnapshot = useMemo(() => {
    const paidOrders = orders.filter((o) => o.paymentStatus === 'paid');
    const revenue = paidOrders.reduce((s, o) => s + (o.total || 0), 0);
    return {
      totalContent: content.length,
      publishedContent: content.filter((c) => c.status === 'published').length,
      scheduledContent: content.filter((c) => c.status === 'scheduled').length,
      draftContent: content.filter((c) => c.status === 'draft' || c.status === 'idea').length,
      pendingApprovals: approvals.filter((a) => a.status === 'pending').length,
      totalContacts: contacts.length,
      activeProducts: products.filter((p) => p.status === 'active').length,
      paidOrdersCount: paidOrders.length,
      recordedRevenue: revenue,
      currency: activeBusiness?.currency || 'IRT',
      activeCampaigns: campaigns.filter((c) => c.status === 'active').length,
      connectedSocialAccounts: integrations.filter(
        (i) => i.category === 'social' && i.connectionStatus === 'connected'
      ).length,
    };
  }, [content, approvals, contacts, products, orders, campaigns, integrations, activeBusiness]);

  const contextSnapshot = useMemo(
    () => ({
      metrics: metricsSnapshot,
      verifiedMemory: businessMemory
        .filter((m) => m.verifiedByOwner)
        .slice(0, 12)
        .map((m) => ({ title: m.title, content: m.content })),
      recentContentTitles: content.slice(0, 8).map((c) => `${c.title} (${c.platform})`),
      products: products.slice(0, 8).map((p) => ({ name: p.name, price: p.price, currency: p.currency })),
    }),
    [metricsSnapshot, businessMemory, content, products]
  );

  if (!authReady || loadingWorkspace) {
    return (
      <div className="min-h-screen bg-[#0B1020] flex items-center justify-center">
        <LoadingState text="در حال آماده‌سازی فضای کاری..." />
      </div>
    );
  }

  if (!firebaseUser) {
    return <AuthScreen />;
  }

  if (bootError) {
    return (
      <div className="min-h-screen bg-[#0B1020] flex items-center justify-center p-6">
        <div className="max-w-md w-full space-y-4">
          <ErrorState
            message={bootError}
            onRetry={() => void loadUserWorkspace(firebaseUser)}
          />
        </div>
      </div>
    );
  }

  if (!userProfile) {
    return (
      <div className="min-h-screen bg-[#0B1020] flex items-center justify-center">
        <LoadingState text="در حال بارگذاری پروفایل..." />
      </div>
    );
  }

  if (!activeBusiness) {
    return (
      <FirstWorkspacePrompt
        user={firebaseUser}
        onCreate={handleCreateNewBusiness}
        onSignOut={() => void signOutUser()}
      />
    );
  }

  if (activeBusiness.onboardingStatus !== 'completed' || wizardOverride) {
    return (
      <BusinessBuilderWizard
        business={activeBusiness}
        ownerId={firebaseUser.uid}
        onCompleted={(updated) => {
          setActiveBusiness(updated);
          setWizardOverride(false);
        }}
      />
    );
  }

  const pendingApprovalsCount = approvals.filter((a) => a.status === 'pending').length;

  return (
    <AppShell
      activeNav={activeNav}
      onSelectNav={setActiveNav}
      business={activeBusiness}
      userProfile={userProfile}
      pendingApprovalsCount={pendingApprovalsCount}
      isSuperAdmin={isSuperAdmin}
      onOpenAiManager={() => setAiDrawerOpen(true)}
      onSignOut={() => void signOutUser()}
    >
      {activeNav === 'overview' && (
        <OverviewPage
          business={activeBusiness}
          agents={agents}
          tasks={tasks}
          content={content}
          approvals={approvals}
          orders={orders}
          campaigns={campaigns}
          integrations={integrations}
          activityLogs={activityLogs}
          onNavigate={setActiveNav}
          onOpenAiManager={() => setAiDrawerOpen(true)}
        />
      )}

      {activeNav === 'workforce' && (
        <WorkforcePage
          business={activeBusiness}
          ownerId={firebaseUser.uid}
          agents={agents}
          tasks={tasks}
          contextSnapshot={contextSnapshot}
        />
      )}

      {activeNav === 'content' && (
        <ContentStudioPage
          business={activeBusiness}
          ownerId={firebaseUser.uid}
          content={content}
          mediaAssets={mediaAssets}
          products={products}
        />
      )}

      {activeNav === 'planner' && (
        <SocialPlannerPage
          business={activeBusiness}
          ownerId={firebaseUser.uid}
          content={content}
          integrations={integrations}
        />
      )}

      {activeNav === 'media' && (
        <MediaLibraryPage
          business={activeBusiness}
          ownerId={firebaseUser.uid}
          mediaAssets={mediaAssets}
        />
      )}

      {activeNav === 'crm' && (
        <CrmPage
          business={activeBusiness}
          ownerId={firebaseUser.uid}
          contacts={contacts}
          orders={orders}
        />
      )}

      {activeNav === 'products' && (
        <ProductsPage
          business={activeBusiness}
          ownerId={firebaseUser.uid}
          products={products}
          orders={orders}
        />
      )}

      {activeNav === 'campaigns' && (
        <CampaignsPage
          business={activeBusiness}
          ownerId={firebaseUser.uid}
          campaigns={campaigns}
          products={products}
        />
      )}

      {activeNav === 'analytics' && (
        <AnalyticsPage
          business={activeBusiness}
          ownerId={firebaseUser.uid}
          content={content}
          orders={orders}
          tasks={tasks}
          approvals={approvals}
          agents={agents}
          integrations={integrations}
          reports={analyticsReports}
        />
      )}

      {activeNav === 'automations' && (
        <AutomationsPage
          business={activeBusiness}
          ownerId={firebaseUser.uid}
          automations={automations}
          runs={automationRuns}
          content={content}
          orders={orders}
        />
      )}

      {activeNav === 'approvals' && (
        <ApprovalsPage
          business={activeBusiness}
          ownerId={firebaseUser.uid}
          approvals={approvals}
        />
      )}

      {activeNav === 'memory' && (
        <BusinessMemoryPage
          business={activeBusiness}
          ownerId={firebaseUser.uid}
          memoryItems={businessMemory}
        />
      )}

      {activeNav === 'integrations' && (
        <IntegrationsPage
          business={activeBusiness}
          ownerId={firebaseUser.uid}
          integrations={integrations}
        />
      )}

      {activeNav === 'ai_providers' && isSuperAdmin && (
        <AiProvidersAdminPage business={activeBusiness} />
      )}

      {activeNav === 'settings' && (
        <SettingsPage
          userProfile={userProfile}
          business={activeBusiness}
          businesses={businesses}
          agents={agents}
          activityLogs={activityLogs}
          onSelectBusiness={handleSelectBusiness}
          onCreateNewBusiness={handleCreateNewBusiness}
          onReopenWizard={() => setWizardOverride(true)}
        />
      )}

      <AiManagerDrawer
        open={aiDrawerOpen}
        onClose={() => setAiDrawerOpen(false)}
        business={activeBusiness}
        ownerId={firebaseUser.uid}
        agents={agents}
        chatHistory={aiChats}
        memoryItems={businessMemory}
        tasks={tasks}
        metricsSnapshot={metricsSnapshot}
      />
    </AppShell>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <I18nProvider initialLocale="fa">
        <AutopilotRoot />
      </I18nProvider>
    </AppErrorBoundary>
  );
}
