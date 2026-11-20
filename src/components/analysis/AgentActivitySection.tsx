import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Loader2,
  MinusCircle,
  Play,
  SlidersHorizontal,
} from 'lucide-react';
import type { AIAgent, CodeReview, RepositoryAnalysisJob } from '../../types';
import { formatDurationMs } from '../../utils/formatters';
import {
  deriveAgentLiveActivities,
  type AgentLiveExecutionState,
} from '../../utils/workspaceMetrics';

interface AgentActivitySectionProps {
  agents: AIAgent[];
  reviews: CodeReview[];
  analysisJobs: RepositoryAnalysisJob[];
  onManageAgents?: () => void;
  onRunWithAgent?: (agentId: string) => void;
}

function ExecutionStateIndicator({ state }: { state: AgentLiveExecutionState }) {
  switch (state) {
    case 'running':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-300">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 shrink-0" aria-hidden="true" />
          <span>Running</span>
        </span>
      );
    case 'queued':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-purple-300">
          <Clock className="w-3.5 h-3.5 animate-pulse text-purple-400 shrink-0" aria-hidden="true" />
          <span>Queued</span>
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Completed</span>
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Failed</span>
        </span>
      );
    case 'skipped':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <MinusCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Skipped</span>
        </span>
      );
    case 'idle':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300">
          <Bot className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
          <span>Ready</span>
        </span>
      );
  }
}

export function AgentActivitySection({
  agents,
  reviews,
  analysisJobs,
  onManageAgents,
  onRunWithAgent,
}: AgentActivitySectionProps) {
  const activities = deriveAgentLiveActivities(agents, reviews, analysisJobs);
  const enabledCount = agents.filter((a) => a.enabled).length;
  const activeRunCount = activities.filter(
    (a) => a.executionState === 'running' || a.executionState === 'queued'
  ).length;

  return (
    <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            AI Agent Activity &amp; Performance
          </h2>
          <p className="text-xs text-slate-400 mt-0.5 tabular-nums">
            {enabledCount} of {agents.length} specialized agents enabled
            {activeRunCount > 0 ? ` · ${activeRunCount} actively executing` : ''}
          </p>
        </div>

        {onManageAgents && (
          <button
            type="button"
            onClick={onManageAgents}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Configure Agents</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
        {activities.map((item) => {
          const { agent } = item;
          const isRunning = item.executionState === 'running';
          const isQueued = item.executionState === 'queued';

          return (
            <div
              key={agent.id}
              className={`rounded-lg border p-4 flex flex-col justify-between gap-3 transition-colors ${
                isRunning
                  ? 'bg-[#0E1628] border-blue-500/45'
                  : isQueued
                    ? 'bg-[#121326] border-purple-500/40'
                    : agent.enabled
                      ? 'bg-[#0B0F17] border-slate-800/90 hover:border-slate-700'
                      : 'bg-[#0B0F17]/60 border-slate-800/60 opacity-75'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-100 truncate">
                      {agent.name}
                    </h3>
                    <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                      {agent.enabled ? 'Enabled' : 'Disabled'} · {agent.strictness} ·{' '}
                      <span className="font-mono">{agent.thinkingLevel}</span>
                    </div>
                  </div>

                  <div className="shrink-0">
                    <ExecutionStateIndicator state={item.executionState} />
                  </div>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">
                  {agent.description}
                </p>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-slate-800/80">
                <div className="grid grid-cols-3 gap-2 text-xs tabular-nums">
                  <div>
                    <div className="text-[11px] text-slate-500">Findings</div>
                    <div className="font-mono font-semibold text-slate-100">
                      {item.findingsCount}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Duration</div>
                    <div className="font-mono font-semibold text-slate-200">
                      {item.durationMs !== null ? formatDurationMs(item.durationMs) : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Reviews</div>
                    <div className="font-mono font-semibold text-slate-200">
                      {agent.reviewsRun}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <div className="min-w-0 text-slate-400 truncate">
                    <span className="font-mono text-slate-300">{item.latestActivityLabel}</span>
                    {item.latestActivityTime && (
                      <span className="text-slate-500"> · {item.latestActivityTime}</span>
                    )}
                  </div>

                  {onRunWithAgent && agent.enabled && (
                    <button
                      type="button"
                      onClick={() => onRunWithAgent(agent.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-blue-300 hover:text-blue-200 bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 rounded transition-colors whitespace-nowrap shrink-0"
                    >
                      <Play className="w-2.5 h-2.5" aria-hidden="true" />
                      <span>Run</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
