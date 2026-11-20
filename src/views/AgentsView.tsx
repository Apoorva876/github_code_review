import { Check, Loader2, Play, Search } from 'lucide-react';
import { useState } from 'react';
import { AgentActivitySection } from '../components/analysis/AgentActivitySection';
import { EmptyState, ErrorBanner } from '../components/ui/DataState';
import { useFirebase } from '../context/FirebaseContext';
import { useToast } from '../context/ToastContext';
import { api } from '../services/api';
import type { AIAgent, CodeReview, RepositoryAnalysisJob, ThinkingMode } from '../types';

interface AgentsViewProps {
  agents: AIAgent[];
  reviews?: CodeReview[];
  analysisJobs?: RepositoryAnalysisJob[];
  error: string | null;
  onRefresh: () => void;
  onRunWithAgent: (agentId: string) => void;
}

export function AgentsView({
  agents,
  reviews = [],
  analysisJobs = [],
  error,
  onRefresh,
  onRunWithAgent,
}: AgentsViewProps) {
  const { syncAgentMutation } = useFirebase();
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedNoticeId, setSavedNoticeId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const filteredAgents = agents.filter((agent) => {
    const q = search.toLowerCase();
    const matchesQuery =
      agent.name.toLowerCase().includes(q) ||
      agent.focus.toLowerCase().includes(q) ||
      agent.description.toLowerCase().includes(q);
    if (!matchesQuery) return false;
    if (statusFilter === 'active') return agent.enabled;
    if (statusFilter === 'disabled') return !agent.enabled;
    return true;
  });

  async function handlePatch(
    id: string,
    patch: Partial<Pick<AIAgent, 'enabled' | 'strictness' | 'thinkingLevel' | 'systemPrompt'>>,
    feedbackLabel?: string
  ) {
    setSavingId(id);
    setActionError(null);
    try {
      const res = await api.updateAgent(id, patch);
      void syncAgentMutation(res.agent);
      onRefresh();
      setSavedNoticeId(id);
      setTimeout(() => setSavedNoticeId((prev) => (prev === id ? null : prev)), 2000);
      showToast({
        title: `${res.agent.name} updated`,
        description: feedbackLabel || 'Agent rubric configuration saved.',
        variant: 'success',
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to update agent configuration.';
      setActionError(message);
      showToast({
        title: 'Failed to update agent',
        description: message,
        variant: 'error',
      });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {(error || actionError) && (
        <ErrorBanner message={actionError || error || ''} onRetry={onRefresh} />
      )}

      {/* Real Agent Execution & Performance Overview */}
      {agents.length > 0 && (
        <AgentActivitySection
          agents={agents}
          reviews={reviews}
          analysisJobs={analysisJobs}
          onRunWithAgent={onRunWithAgent}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            Specialized AI Reviewer Configuration
          </h2>
          <p className="text-xs text-slate-400 mt-0.5 tabular-nums">
            Configure Gemini rubric instructions, reasoning depth, and enforcement strictness ·{' '}
            {agents.filter((a) => a.enabled).length} of {agents.length} active
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-60">
            <Search
              className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter agents..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-[#111827] border border-slate-800 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#111827] border border-slate-800 rounded-md">
            {(['all', 'active', 'disabled'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`px-2.5 py-1 text-xs font-medium rounded capitalize transition-colors whitespace-nowrap ${
                  statusFilter === tab
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filteredAgents.length === 0 ? (
        <EmptyState
          title="No agents match your filter"
          description="Clear the search filter or view all configured reviewer personas."
          actionLabel="Show All Agents"
          onAction={() => {
            setSearch('');
            setStatusFilter('all');
          }}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredAgents.map((agent) => {
            const isEditing = editingId === agent.id;
            const isSaving = savingId === agent.id;

            return (
              <section
                key={agent.id}
                className="bg-[#111827] border border-slate-800/90 hover:border-slate-700/90 rounded-lg p-5 flex flex-col justify-between gap-4 transition-colors"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-100">{agent.name}</h3>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {agent.focus} · <span className="font-mono">{agent.model}</span>
                        {agent.isDemo ? ' · Demo profile' : ''}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() =>
                        handlePatch(
                          agent.id,
                          { enabled: !agent.enabled },
                          !agent.enabled ? 'Agent enabled' : 'Agent disabled'
                        )
                      }
                      className={`px-3 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
                        agent.enabled
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          : 'bg-[#0B0F17] border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {agent.enabled ? 'Active' : 'Disabled'}
                    </button>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">{agent.description}</p>

                  {/* Controls Row */}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Strictness
                      </label>
                      <select
                        value={agent.strictness}
                        disabled={isSaving}
                        onChange={(e) =>
                          handlePatch(
                            agent.id,
                            { strictness: e.target.value as AIAgent['strictness'] },
                            `Strictness set to ${e.target.value}`
                          )
                        }
                        className="w-full px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-blue-500"
                      >
                        <option value="strict">Strict</option>
                        <option value="balanced">Balanced</option>
                        <option value="advisory">Advisory</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Thinking Level
                      </label>
                      <select
                        value={agent.thinkingLevel}
                        disabled={isSaving}
                        onChange={(e) =>
                          handlePatch(
                            agent.id,
                            { thinkingLevel: e.target.value as ThinkingMode },
                            `Thinking level set to ${e.target.value}`
                          )
                        }
                        className="w-full px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-800 rounded text-slate-200 font-mono focus:outline-none focus:border-blue-500"
                      >
                        <option value="LOW">LOW (Fast)</option>
                        <option value="MEDIUM">MEDIUM (Balanced)</option>
                        <option value="HIGH">HIGH (Deep Audit)</option>
                      </select>
                    </div>
                  </div>

                  {/* System Prompt Editor */}
                  <div className="pt-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium text-slate-400">
                        Rubric System Instruction
                      </span>
                      {!isEditing && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(agent.id);
                            setDraftPrompt(agent.systemPrompt);
                          }}
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          Edit prompt
                        </button>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          rows={4}
                          value={draftPrompt}
                          onChange={(e) => setDraftPrompt(e.target.value)}
                          className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-slate-700 rounded text-slate-200 font-mono leading-relaxed focus:outline-none focus:border-blue-500"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1 text-xs text-slate-300 bg-slate-800 rounded"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={isSaving || !draftPrompt.trim()}
                            onClick={async () => {
                              await handlePatch(
                                agent.id,
                                { systemPrompt: draftPrompt },
                                'System prompt updated'
                              );
                              setEditingId(null);
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded"
                          >
                            {isSaving && <Loader2 className="w-3 h-3 animate-spin" />}
                            <span>Save Prompt</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 bg-[#0B0F17] border border-slate-800/80 rounded p-2.5 font-mono leading-relaxed line-clamp-3">
                        {agent.systemPrompt}
                      </p>
                    )}
                  </div>
                </div>

                {/* Metrics & Quick Launch Footer */}
                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-3 text-xs text-slate-400 tabular-nums">
                  <span>
                    {agent.reviewsRun} reviews run · {agent.avgFindingsPerPr} avg findings / PR
                  </span>
                  <div className="flex items-center gap-3 shrink-0">
                    {savedNoticeId === agent.id && (
                      <span className="inline-flex items-center gap-1 text-emerald-400">
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Saved</span>
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onRunWithAgent(agent.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-300 bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 rounded transition-colors whitespace-nowrap"
                    >
                      <Play className="w-3 h-3" aria-hidden="true" />
                      <span>Run Review</span>
                    </button>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
