import React, { useState } from 'react';
import { Bot, CheckCircle2, Loader2, PlusCircle, Send, Sparkles, X } from 'lucide-react';
import { sendManagerChat, type ManagerChatResponse } from '../../services/apiClient';
import {
  createTaskRecord,
  logActivity,
  recordAgentUsage,
  saveAiChatMessage,
} from '../../services/dataAccess';
import type {
  Agent,
  AiChatMessage,
  Business,
  BusinessMemoryItem,
  Task,
} from '../../types/domain';

const QUICK_PROMPTS = [
  'امروز روی چه کاری تمرکز کنم؟',
  'بر اساس داده‌های فعلی، چه محتوایی بسازم؟',
  'کدام کارها منتظر تأیید من هستند؟',
  'یک برنامه محتوایی برای هفته آینده پیشنهاد بده.',
];

export function AiManagerDrawer({
  open,
  onClose,
  business,
  ownerId,
  agents,
  chatHistory,
  memoryItems,
  tasks,
  metricsSnapshot,
}: {
  open: boolean;
  onClose: () => void;
  business: Business;
  ownerId: string;
  agents: Agent[];
  chatHistory: AiChatMessage[];
  memoryItems: BusinessMemoryItem[];
  tasks: Task[];
  metricsSnapshot: Record<string, unknown>;
}) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastStructured, setLastStructured] = useState<ManagerChatResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskCreatedFeedback, setTaskCreatedFeedback] = useState<string | null>(null);

  if (!open) return null;

  const managerAgent = agents.find((a) => a.agentType === 'chief_manager');

  const handleSend = async (promptText?: string) => {
    const text = (promptText ?? input).trim();
    if (!text || loading) return;
    setLoading(true);
    setError(null);
    setTaskCreatedFeedback(null);
    if (!promptText) setInput('');

    try {
      await saveAiChatMessage(business.id, ownerId, {
        role: 'user',
        content: text,
      });

      const res = await sendManagerChat({
        message: text,
        business,
        metricsSnapshot,
        memoryItems: memoryItems.map((m) => ({
          title: m.title,
          content: m.content,
          verifiedByOwner: m.verifiedByOwner,
        })),
        recentTasks: tasks.slice(0, 8).map((t) => ({
          title: t.title,
          status: t.status,
          agentType: t.agentType,
        })),
      });

      await saveAiChatMessage(business.id, ownerId, {
        role: 'assistant',
        content: res.reply,
      });

      if (managerAgent) {
        await recordAgentUsage(
          business.id,
          managerAgent,
          res.tokens.input + res.tokens.output,
          res.tokens.estimatedCostUsd,
          1,
          'active'
        );
      }

      setLastStructured(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ارتباط با مدیر هوشمند');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSuggestedTask = async () => {
    if (!lastStructured) return;
    const targetAgent =
      agents.find((a) => a.agentType === lastStructured.recommendedAgentType) || managerAgent;
    if (!targetAgent) return;
    if (!targetAgent.enabled) {
      setError(`ایجنت «${targetAgent.name}» غیرفعال است و وظیفه جدید به آن واگذار نمی‌شود.`);
      return;
    }
    const taskId = await createTaskRecord(business.id, ownerId, {
      agentId: targetAgent.id,
      agentType: targetAgent.agentType,
      title: lastStructured.suggestedTaskTitle,
      description: lastStructured.reply.slice(0, 800),
      priority: 'medium',
      status: 'assigned',
      requiresApproval: lastStructured.requiresApproval,
    });
    await logActivity(business.id, ownerId, {
      actorType: 'agent',
      actorName: 'مدیر ارشد هوش مصنوعی',
      action: 'ایجاد وظیفه از گفتگو',
      entityType: 'task',
      entityId: taskId,
      details: `وظیفه «${lastStructured.suggestedTaskTitle}» به ${targetAgent.name} ارجاع شد.`,
    });
    setTaskCreatedFeedback(`وظیفه «${lastStructured.suggestedTaskTitle}» در صف ${targetAgent.name} ثبت شد.`);
  };

  const orderedHistory = [...chatHistory].reverse();

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex justify-end">
      <div className="w-full max-w-lg bg-[#11182A] border-r border-[#273449] h-full flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#273449] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Bot className="w-5 h-5 text-[#8B5CF6]" />
            <div>
              <h2 className="text-sm font-semibold text-[#F8FAFC]">مدیر ارشد هوش مصنوعی</h2>
              <div className="text-[11px] text-[#94A3B8]">تحلیل داده‌های واقعی و هماهنگی ۵ ایجنت</div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="بستن"
            className="p-2 rounded-lg text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#151E33]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Questions */}
        <div className="px-4 py-3 border-b border-[#273449] flex flex-wrap gap-1.5">
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q}
              onClick={() => handleSend(q)}
              disabled={loading}
              className="text-[11px] px-2.5 py-1 rounded-md bg-[#151E33] border border-[#273449] hover:border-[#6366F1] text-[#94A3B8] hover:text-[#F8FAFC] transition-colors"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Conversation Feed */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {orderedHistory.length === 0 && (
            <div className="text-center py-10 text-xs text-[#94A3B8] space-y-2">
              <Sparkles className="w-6 h-6 text-[#8B5CF6] mx-auto" />
              <p>سوال یا دستور خود را بنویسید؛ مدیر هوشمند بر اساس داده‌های واقعی کسب‌وکار «{business.name}» پاسخ می‌دهد.</p>
            </div>
          )}

          {orderedHistory.map((msg) => (
            <div
              key={msg.id}
              className={`rounded-xl p-3.5 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-[#6366F1]/20 border border-[#6366F1]/40 text-[#F8FAFC] mr-6'
                  : 'bg-[#151E33] border border-[#273449] text-[#F8FAFC] ml-4'
              }`}
            >
              <div className="text-[11px] text-[#94A3B8] mb-1">
                {msg.role === 'user' ? 'شما' : 'مدیر ارشد هوش مصنوعی'}
              </div>
              {msg.content}
            </div>
          ))}

          {lastStructured && (
            <div className="bg-[#151E33] border border-[#273449] rounded-xl p-3.5 space-y-3 text-xs">
              {lastStructured.factsUsed.length > 0 && (
                <div>
                  <div className="font-semibold text-[#22C55E] mb-1">داده‌های واقعی استفاده‌شده:</div>
                  <ul className="list-disc list-inside text-[#94A3B8] space-y-0.5">
                    {lastStructured.factsUsed.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
              {lastStructured.assumptionsAndRecommendations.length > 0 && (
                <div>
                  <div className="font-semibold text-[#F59E0B] mb-1">پیشنهادها و تحلیل هوش مصنوعی:</div>
                  <ul className="list-disc list-inside text-[#94A3B8] space-y-0.5">
                    {lastStructured.assumptionsAndRecommendations.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="pt-2 border-t border-[#273449] flex items-center justify-between gap-2">
                <span className="text-[#94A3B8] truncate">{lastStructured.suggestedTaskTitle}</span>
                <button
                  onClick={handleCreateSuggestedTask}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#6366F1] hover:bg-[#5558E6] text-white rounded-lg font-medium shrink-0"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>ثبت وظیفه</span>
                </button>
              </div>
            </div>
          )}

          {taskCreatedFeedback && (
            <div className="p-2.5 rounded-lg bg-[#22C55E]/10 border border-[#22C55E]/30 text-xs text-[#22C55E] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{taskCreatedFeedback}</span>
            </div>
          )}

          {error && (
            <div className="p-2.5 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-xs text-[#EF4444]">
              {error}
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
              <Loader2 className="w-4 h-4 animate-spin text-[#8B5CF6]" />
              <span>مدیر هوشمند در حال تحلیل داده‌ها...</span>
            </div>
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="p-4 border-t border-[#273449] flex items-center gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="دستور یا سوال خود را بنویسید..."
            className="flex-1 bg-[#0B1020] border border-[#273449] focus:border-[#6366F1] rounded-lg px-3 py-2 text-sm outline-none"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="p-2.5 bg-[#6366F1] hover:bg-[#5558E6] disabled:opacity-50 text-white rounded-lg transition-colors"
            aria-label="ارسال"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
