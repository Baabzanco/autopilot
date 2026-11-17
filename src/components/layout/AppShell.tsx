import React, { useState } from 'react';
import {
  BarChart3,
  Bot,
  Brain,
  Calendar,
  CheckSquare,
  Cpu,
  FileText,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Package,
  Plug,
  Settings,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { formatDigits } from '../../lib/localization';
import type { Business, NavSection, UserProfile } from '../../types/domain';

interface NavItemConfig {
  id: NavSection;
  labelKey: keyof ReturnType<typeof useI18n>['t']['nav'];
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItemConfig[] = [
  { id: 'overview', labelKey: 'overview', icon: LayoutDashboard },
  { id: 'workforce', labelKey: 'workforce', icon: Cpu },
  { id: 'content', labelKey: 'content', icon: FileText },
  { id: 'planner', labelKey: 'planner', icon: Calendar },
  { id: 'media', labelKey: 'media', icon: FolderOpen },
  { id: 'crm', labelKey: 'crm', icon: Users },
  { id: 'products', labelKey: 'products', icon: Package },
  { id: 'campaigns', labelKey: 'campaigns', icon: Megaphone },
  { id: 'analytics', labelKey: 'analytics', icon: BarChart3 },
  { id: 'automations', labelKey: 'automations', icon: Workflow },
  { id: 'approvals', labelKey: 'approvals', icon: CheckSquare },
  { id: 'memory', labelKey: 'memory', icon: Brain },
  { id: 'integrations', labelKey: 'integrations', icon: Plug },
  { id: 'settings', labelKey: 'settings', icon: Settings },
];

export function AppShell({
  activeNav,
  onSelectNav,
  business,
  userProfile,
  pendingApprovalsCount,
  onOpenAiManager,
  onSignOut,
  children,
}: {
  activeNav: NavSection;
  onSelectNav: (nav: NavSection) => void;
  business: Business;
  userProfile: UserProfile;
  pendingApprovalsCount: number;
  onOpenAiManager: () => void;
  onSignOut: () => void;
  children: React.ReactNode;
}) {
  const { t, dir } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);

  const numeralStyle = business.numeralStyle || 'persian';
  const currentTitle = t.nav[activeNav];

  const renderNavList = () => (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = activeNav === item.id;
        return (
          <button
            key={item.id}
            onClick={() => {
              onSelectNav(item.id);
              setMobileOpen(false);
            }}
            className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer ${
              active
                ? 'bg-[#6366F1]/15 text-[#F8FAFC] font-semibold'
                : 'text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#151E33]'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#8B5CF6]' : 'text-[#94A3B8]'}`} />
              <span className="truncate">{t.nav[item.labelKey]}</span>
            </div>
            {item.id === 'approvals' && pendingApprovalsCount > 0 && (
              <span className="text-xs font-mono tabular-nums text-[#F59E0B] shrink-0">
                {formatDigits(pendingApprovalsCount, numeralStyle)}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#0B1020] text-[#F8FAFC] flex" dir={dir}>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-[260px] shrink-0 bg-[#11182A] border-l border-[#273449] flex-col sticky top-0 h-screen">
        <div className="px-4 py-4 border-b border-[#273449]">
          <div className="text-sm font-bold text-[#F8FAFC] truncate">{t.brand.name}</div>
          <div className="text-xs text-[#94A3B8] truncate mt-0.5">{business.name}</div>
        </div>
        {renderNavList()}
        <div className="p-3 border-t border-[#273449] flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium text-[#F8FAFC] truncate">{userProfile.displayName}</div>
            <div className="text-[11px] text-[#94A3B8] truncate" dir="ltr">{userProfile.email}</div>
          </div>
          <button
            onClick={onSignOut}
            title={t.common.signOut}
            aria-label={t.common.signOut}
            className="p-2 rounded-lg text-[#94A3B8] hover:text-[#EF4444] hover:bg-[#151E33] shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden bg-black/70 flex">
          <aside className="w-[270px] bg-[#11182A] border-l border-[#273449] h-full flex flex-col">
            <div className="px-4 py-4 border-b border-[#273449] flex items-center justify-between">
              <div className="text-sm font-bold text-[#F8FAFC] truncate">{business.name}</div>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-1.5 text-[#94A3B8] hover:text-[#F8FAFC]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {renderNavList()}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 bg-[#11182A] border-b border-[#273449] px-4 lg:px-8 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-lg text-[#94A3B8] hover:text-[#F8FAFC] bg-[#151E33] border border-[#273449]"
              aria-label="منو"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-[#94A3B8] hidden sm:inline truncate">{business.name}</span>
              <span className="text-[#273449] hidden sm:inline">/</span>
              <h1 className="font-semibold text-[#F8FAFC] truncate">{currentTitle}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {pendingApprovalsCount > 0 && (
              <button
                onClick={() => onSelectNav('approvals')}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#151E33] border border-[#F59E0B]/40 text-xs font-medium text-[#F59E0B] hover:border-[#F59E0B] whitespace-nowrap shrink-0"
              >
                <span className="tabular-nums">{formatDigits(pendingApprovalsCount, numeralStyle)}</span>
                <span>در انتظار تأیید</span>
              </button>
            )}
            <button
              onClick={onOpenAiManager}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#6366F1] hover:bg-[#5558E6] text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Bot className="w-4 h-4" />
              <span>{t.common.openAiManager}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
