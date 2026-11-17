import React, { useState } from 'react';
import { Loader2, Play, Power, RefreshCw, Settings2 } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { executeSpecialistAgent, type AgentExecuteResponse } from '../services/apiClient';
import {
  createApprovalRequest,
  createTaskRecord,
  logActivity,
  recordAgentUsage,
  toggleAgentEnabled,
  updateAgentSettings,
  updateTaskResult,
} from '../services/dataAccess';
import { formatDigits, formatJalaliDateTime, formatNumber } from '../lib/localization';
import type { Agent, ApprovalCategory, Business, Task } from '../types/domain';
import { ErrorState, StatusIndicator } from '../components/ui/Primitives';

export function WorkforcePage({
  business,
  ownerId,
  agents,
  tasks,
  contextSnapshot,
}: {
  business: Business;
  ownerId: string;
  agents: Agent[];
  tasks: Task[];
  contextSnapshot: Record<string, unknown>;
}) {
  const { locale, t } = useI18n();
  const numeralStyle = business.numeralStyle || 'persian';

  const [selectedAgentId, setSelectedAgentId] = useState<string>(agents[0]?.id || '');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [priority, setPriority] = useState<Task['priority']>('medium');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<AgentExecuteResponse | null>(null);
  const [editingSettings, setEditingSettings] = useState(false);
  const [toneInput, setToneInput] = useState('');
  const [langInput, setLangInput] = useState<'fa' | 'en' | 'bilingual'>('fa');

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || agents[0];
  const agentTasks = selectedAgent ? tasks.filter((tk) => tk.agentId === selectedAgent.id) : [];

  const handleToggleAgent = async (agent: Agent) => {
    setError(null);
    await toggleAgentEnabled(business.id, ownerId, agent, !agent.enabled);
  };

  const openSettings = (agent: Agent) => {
    setToneInput(agent.preferredTone || '');
    setLangInput(agent.outputLanguage || 'fa');
    setEditingSettings(true);
  };

  const handleSaveSettings = async () => {
    if (!selectedAgent) return;
    await updateAgentSettings(business.id, selectedAgent.id, {
      preferredTone: toneInput,
      outputLanguage: langInput,
    });
    setEditingSettings(false);
  };

  const runTaskForAgent = async (agent: Agent, title: string, prompt: string, existingTaskId?: string) => {
    if (!agent.enabled) {
      setError(`ایجنت «${agent.name}» غیرفعال است. برای واگذاری وظیفه جدید ابتدا آن را فعال کنید.`);
      return;
    }
    setRunning(true);
    setError(null);
    setLastResult(null);

    let taskId = existingTaskId;
    try {
      if (!taskId) {
        taskId = await createTaskRecord(business.id, ownerId, {
          agentId: agent.id,
          agentType: agent.agentType,
          title: title || `درخواست از ${agent.name}`,
          description: prompt,
          priority,
          status: 'in_progress',
          inputSummary: prompt,
          requiresApproval: false,
        });
      } else {
        await updateTaskResult(business.id, taskId, { status: 'in_progress', errorDetails: '' });
      }

      const res = await executeSpecialistAgent({
        agentType: agent.agentType,
        agentName: agent.name,
        prompt,
        preferredTone: agent.preferredTone,
        outputLanguage: agent.outputLanguage || 'fa',
        business,
        contextSnapshot,
      });

      const finalStatus: Task['status'] = res.requiresApproval ? 'awaiting_approval' : 'completed';

      await updateTaskResult(business.id, taskId, {
        status: finalStatus,
        outputSummary: res.summary,
        outputStructured: {
          deliverables: res.deliverables,
          dataLimitations: res.dataLimitations,
        },
        inputTokens: res.tokens.input,
        outputTokens: res.tokens.output,
        estimatedCostUsd: res.tokens.estimatedCostUsd,
      });

      await recordAgentUsage(
        business.id,
        agent,
        res.tokens.input + res.tokens.output,
        res.tokens.estimatedCostUsd,
        res.requiresApproval ? 0 : 1,
        res.requiresApproval ? 'waiting_approval' : 'idle'
      );

      if (res.requiresApproval) {
        const validCats: ApprovalCategory[] = [
          'content_publication',
          'social_message',
          'marketing_email',
          'price_change',
          'campaign_launch',
          'customer_reply',
          'external_integration',
          'other',
        ];
        const cat = validCats.includes(res.approvalCategory as ApprovalCategory)
          ? (res.approvalCategory as ApprovalCategory)
          : 'other';

        await createApprovalRequest(business.id, ownerId, {
          category: cat,
          actionTitle: title || `پیشنهاد اقدام توسط ${agent.name}`,
          requestingAgentId: agent.id,
          requestingAgentName: agent.name,
          reason: res.approvalReason || 'نیازمند تأیید صریح مالک پیش از اقدام خارجی',
          payloadSummary: res.summary,
          relatedEntityType: 'task',
          relatedEntityId: taskId,
        });
      }

      await logActivity(business.id, ownerId, {
        actorType: 'agent',
        actorName: agent.name,
        action: res.requiresApproval ? 'آماده‌سازی اقدام نیازمند تأیید' : 'تکمیل وظیفه هوش مصنوعی',
        entityType: 'task',
        entityId: taskId,
        details: title || prompt.slice(0, 120),
      });

      setLastResult(res);
      setTaskTitle('');
      setTaskPrompt('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'خطا در اجرای وظیفه ایجنت';
      setError(msg);
      if (taskId) {
        await updateTaskResult(business.id, taskId, {
          status: 'failed',
          errorDetails: msg,
        });
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => {
          const selected = selectedAgent?.id === agent.id;
          return (
            <div
              key={agent.id}
              onClick={() => setSelectedAgentId(agent.id)}
              className={`bg-[#151E33] border rounded-xl p-4 space-y-3 cursor-pointer transition-colors ${
                selected ? 'border-[#6366F1]' : 'border-[#273449] hover:border-[#3B4D6B]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[#F8FAFC]">{agent.name}</h3>
                  <div className="text-xs text-[#94A3B8] mt-0.5">{agent.role}</div>
                </div>
                <StatusIndicator status={agent.enabled ? agent.status : 'disabled'} label={agent.enabled ? t.statuses[agent.status] : t.statuses.disabled} />
              </div>

              <p className="text-xs text-[#94A3B8] leading-relaxed line-clamp-2">{agent.description}</p>

              <div className="pt-2 border-t border-[#273449] flex items-center justify-between text-xs text-[#94A3B8] tabular-nums">
                <span>{formatNumber(agent.tasksCompleted ?? 0, locale, numeralStyle)} وظیفه</span>
                <span>{formatNumber(agent.totalTokensUsed ?? 0, locale, numeralStyle)} توکن</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleAgent(agent);
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium ${
                    agent.enabled
                      ? 'border-[#273449] text-[#94A3B8] hover:text-[#EF4444]'
                      : 'border-[#22C55E]/40 text-[#22C55E]'
                  }`}
                >
                  <Power className="w-3 h-3" />
                  <span>{agent.enabled ? 'غیرفعال کردن' : 'فعال کردن'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {selectedAgent && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Selected Agent Profile + Task Runner */}
          <div className="lg:col-span-5 bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-5">
            <div className="flex items-start justify-between gap-3 border-b border-[#273449] pb-4">
              <div>
                <h3 className="text-base font-semibold text-[#F8FAFC]">{selectedAgent.name}</h3>
                <div className="text-xs text-[#94A3B8] mt-0.5">{selectedAgent.role}</div>
              </div>
              <button
                onClick={() => openSettings(selectedAgent)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#11182A] border border-[#273449] rounded-lg text-xs text-[#F8FAFC] hover:border-[#6366F1]"
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span>تنظیمات ایجنت</span>
              </button>
            </div>

            {editingSettings ? (
              <div className="space-y-3 bg-[#11182A] border border-[#273449] rounded-lg p-4">
                <div>
                  <label className="block text-xs text-[#94A3B8] mb-1">لحن ترجیحی</label>
                  <input
                    value={toneInput}
                    onChange={(e) => setToneInput(e.target.value)}
                    className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-1.5 text-sm outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#94A3B8] mb-1">زبان خروجی</label>
                  <select
                    value={langInput}
                    onChange={(e) => setLangInput(e.target.value as 'fa' | 'en' | 'bilingual')}
                    className="w-full bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-1.5 text-sm outline-none"
                  >
                    <option value="fa">فارسی (پیش‌فرض)</option>
                    <option value="bilingual">دوزبانه فارسی و انگلیسی</option>
                    <option value="en">انگلیسی</option>
                  </select>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setEditingSettings(false)}
                    className="px-3 py-1.5 text-xs text-[#94A3B8]"
                  >
                    انصراف
                  </button>
                  <button
                    onClick={handleSaveSettings}
                    className="px-3 py-1.5 bg-[#6366F1] text-white text-xs font-medium rounded-lg"
                  >
                    ذخیره تنظیمات
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <div>
                  <span className="text-[#94A3B8]">مسئولیت‌ها: </span>
                  <span className="text-[#F8FAFC]">{(selectedAgent.responsibilities || []).join(' · ')}</span>
                </div>
                <div>
                  <span className="text-[#94A3B8]">ابزارهای مجاز: </span>
                  <span className="text-[#F8FAFC]">{(selectedAgent.allowedTools || []).join(' · ')}</span>
                </div>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!taskPrompt.trim()) return;
                runTaskForAgent(selectedAgent, taskTitle, taskPrompt);
              }}
              className="space-y-3 pt-3 border-t border-[#273449]"
            >
              <div className="text-xs font-semibold text-[#F8FAFC]">واگذاری وظیفه جدید به {selectedAgent.name}</div>
              <input
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="عنوان کوتاه وظیفه (مثلاً: ۵ ایده ریلز آموزشی)"
                className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
              />
              <textarea
                rows={3}
                value={taskPrompt}
                onChange={(e) => setTaskPrompt(e.target.value)}
                placeholder="دستورالعمل دقیق را بنویسید..."
                className="w-full bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
              />
              <div className="flex items-center justify-between gap-3">
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Task['priority'])}
                  className="bg-[#0B1020] border border-[#273449] rounded-lg px-3 py-2 text-xs outline-none"
                >
                  <option value="low">اولویت پایین</option>
                  <option value="medium">اولویت متوسط</option>
                  <option value="high">اولویت بالا</option>
                  <option value="urgent">فوری</option>
                </select>
                <button
                  type="submit"
                  disabled={running || !selectedAgent.enabled || !taskPrompt.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#6366F1] hover:bg-[#5558E6] disabled:opacity-50 text-white text-xs font-semibold rounded-lg whitespace-nowrap"
                >
                  {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  <span>اجرای وظیفه</span>
                </button>
              </div>
            </form>

            {error && <ErrorState message={error} />}

            {lastResult && (
              <div className="bg-[#11182A] border border-[#273449] rounded-lg p-4 space-y-3 text-xs">
                <div className="font-semibold text-[#22C55E]">نتیجه اجرای وظیفه:</div>
                <p className="text-[#F8FAFC] leading-relaxed whitespace-pre-wrap">{lastResult.summary}</p>
                {lastResult.deliverables.map((d, i) => (
                  <div key={i} className="pt-2 border-t border-[#273449]">
                    <div className="font-semibold text-[#F8FAFC]">{d.title}</div>
                    <div className="text-[#94A3B8] mt-1 whitespace-pre-wrap">{d.detail}</div>
                  </div>
                ))}
                {lastResult.dataLimitations && (
                  <div className="text-[11px] text-[#F59E0B]">
                    محدودیت داده: {lastResult.dataLimitations}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Agent Task History */}
          <div className="lg:col-span-7 bg-[#151E33] border border-[#273449] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#273449] pb-3">
              <h3 className="text-sm font-semibold text-[#F8FAFC]">تاریخچه وظایف {selectedAgent.name}</h3>
              <span className="text-xs text-[#94A3B8] tabular-nums">
                {formatNumber(agentTasks.length, locale, numeralStyle)} مورد
              </span>
            </div>

            {agentTasks.length === 0 ? (
              <div className="py-12 text-center text-xs text-[#94A3B8]">
                هنوز وظیفه‌ای برای این ایجنت ثبت نشده است.
              </div>
            ) : (
              <div className="divide-y divide-[#273449]">
                {agentTasks.map((tk) => (
                  <div key={tk.id} className="py-3.5 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-sm text-[#F8FAFC] truncate">{tk.title}</div>
                      <StatusIndicator status={tk.status} label={t.statuses[tk.status] || tk.status} />
                    </div>
                    {tk.outputSummary && (
                      <p className="text-xs text-[#94A3B8] leading-relaxed whitespace-pre-wrap line-clamp-4">
                        {tk.outputSummary}
                      </p>
                    )}
                    {tk.errorDetails && (
                      <div className="flex items-center justify-between gap-2 text-xs text-[#EF4444]">
                        <span>خطا: {tk.errorDetails}</span>
                        <button
                          onClick={() => runTaskForAgent(selectedAgent, tk.title, tk.inputSummary || tk.description || tk.title, tk.id)}
                          disabled={running}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#11182A] border border-[#273449] rounded text-[#F8FAFC]"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>تلاش مجدد</span>
                        </button>
                      </div>
                    )}
                    <div className="text-[11px] text-[#94A3B8] flex items-center gap-2 tabular-nums">
                      <span>{formatJalaliDateTime(tk.createdAt, locale, numeralStyle)}</span>
                      {tk.inputTokens !== undefined && (
                        <>
                          <span>·</span>
                          <span>{formatDigits((tk.inputTokens || 0) + (tk.outputTokens || 0), numeralStyle)} توکن</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
