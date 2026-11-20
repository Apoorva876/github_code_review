import { AlertTriangle, CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import type { AIAgent, RepositoryAgentExecutionSummary } from '../../types';
import { formatDurationMs } from '../../utils/formatters';

interface AgentExecutionBreakdownProps {
  agentBreakdown: RepositoryAgentExecutionSummary[];
  configuredAgents?: AIAgent[];
  totalAgents?: number;
  completedAgents?: number;
  failedAgents?: number;
}

export function AgentExecutionBreakdown({
  agentBreakdown,
  configuredAgents,
  totalAgents,
  completedAgents,
  failedAgents,
}: AgentExecutionBreakdownProps) {
  const completedCount =
    completedAgents ??
    agentBreakdown.filter((a) => a.analysisStatus === 'completed').length;
  const failedCount =
    failedAgents ??
    agentBreakdown.filter((a) => a.analysisStatus === 'failed').length;
  const skippedCount = agentBreakdown.filter(
    (a) => a.analysisStatus === 'skipped'
  ).length;
  const enabledCount =
    totalAgents ??
    (configuredAgents
      ? configuredAgents.filter((a) => a.enabled).length
      : completedCount + failedCount);

  if (agentBreakdown.length === 0) {
    const queuedAgents = configuredAgents?.filter((a) => a.enabled) ?? [];
    const disabledAgents = configuredAgents?.filter((a) => !a.enabled) ?? [];

    return (
      <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-slate-200">AI Agent Execution</span>
          <span className="font-mono text-slate-400 tabular-nums">
            {queuedAgents.length} enabled · {disabledAgents.length} disabled
          </span>
        </div>

        {queuedAgents.length === 0 ? (
          <p className="text-xs text-slate-400">
            Waiting for repository collection to initialize agent execution breakdown.
          </p>
        ) : (
          <div className="divide-y divide-slate-800/70 border border-slate-800/80 rounded bg-[#111827]">
            {queuedAgents.map((agent) => (
              <div
                key={agent.id}
                className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-200 truncate">
                    {agent.name}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono truncate">
                    {agent.model} · {agent.strictness} · {agent.thinkingLevel}
                  </div>
                </div>
                <span className="text-blue-400 font-mono text-[11px] whitespace-nowrap shrink-0">
                  Pending
                </span>
              </div>
            ))}
            {disabledAgents.map((agent) => (
              <div
                key={agent.id}
                className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs opacity-65"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-400 truncate">
                    {agent.name}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono truncate">
                    Disabled in workspace settings
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-slate-500 font-mono text-[11px] whitespace-nowrap shrink-0">
                  <MinusCircle className="w-3 h-3" aria-hidden="true" />
                  <span>Skipped</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-slate-200">Agent Execution Breakdown</span>
        <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums text-[11px]">
          <span className="text-slate-300">{enabledCount} enabled</span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-emerald-400">{completedCount} completed</span>
          {failedCount > 0 && (
            <>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="text-red-400">{failedCount} failed</span>
            </>
          )}
          {skippedCount > 0 && (
            <>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="text-slate-400">{skippedCount} skipped</span>
            </>
          )}
        </div>
      </div>

      <div className="divide-y divide-slate-800/70 border border-slate-800/80 rounded bg-[#111827]">
        {agentBreakdown.map((agent) => {
          const isCompleted = agent.analysisStatus === 'completed';
          const isFailed = agent.analysisStatus === 'failed';
          const isSkipped = agent.analysisStatus === 'skipped';

          return (
            <div key={agent.agentId} className="px-3.5 py-3 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {isCompleted ? (
                    <CheckCircle2
                      className="w-3.5 h-3.5 text-emerald-400 shrink-0"
                      aria-hidden="true"
                    />
                  ) : isFailed ? (
                    <XCircle
                      className="w-3.5 h-3.5 text-red-400 shrink-0"
                      aria-hidden="true"
                    />
                  ) : (
                    <MinusCircle
                      className="w-3.5 h-3.5 text-slate-500 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={`text-xs font-medium truncate ${
                      isSkipped ? 'text-slate-400' : 'text-slate-100'
                    }`}
                  >
                    {agent.agentName}
                  </span>
                  <span className="text-[11px] font-mono text-slate-500 hidden sm:inline">
                    {agent.model} · {agent.strictness} · {agent.thinkingLevel}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs font-mono tabular-nums shrink-0">
                  <span
                    className={
                      isCompleted
                        ? 'text-emerald-400'
                        : isFailed
                          ? 'text-red-400'
                          : 'text-slate-500'
                    }
                  >
                    {isCompleted ? 'Completed' : isFailed ? 'Failed' : 'Skipped (Disabled)'}
                  </span>
                  {!isSkipped && (
                    <>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className="text-slate-300">
                        {agent.findingsCount}{' '}
                        {agent.findingsCount === 1 ? 'finding' : 'findings'}
                      </span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className="text-slate-400">
                        {formatDurationMs(agent.durationMs)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {agent.summary && (
                <p className="text-xs text-slate-400 leading-relaxed pl-5">
                  {agent.summary}
                </p>
              )}

              {isFailed && agent.error && (
                <div className="ml-5 flex items-start gap-1.5 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2.5 py-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{agent.error}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
