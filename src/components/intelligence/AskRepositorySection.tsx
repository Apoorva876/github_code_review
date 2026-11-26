import {
  AlertTriangle,
  ExternalLink,
  FileCode2,
  Loader2,
  MessageSquareText,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useFirebase } from '../../context/FirebaseContext';
import { api, ApiError } from '../../services/api';
import type { RepositoryChatMessage, RepositoryIntelligenceReport } from '../../types';

interface AskRepositorySectionProps {
  repositoryId: string;
  report: RepositoryIntelligenceReport;
  onOpenFile: (filePath: string) => void;
  onMessagesChange?: (messages: RepositoryChatMessage[]) => void;
}

export function AskRepositorySection({
  repositoryId,
  report,
  onOpenFile,
  onMessagesChange,
}: AskRepositorySectionProps) {
  const { user, isVerifiedUser, signInWithGoogle, signingIn } = useFirebase();
  const [messages, setMessages] = useState<RepositoryChatMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);

  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const starterQuestions = useMemo(() => {
    const prompts: string[] = [
      'What does this project do and who is it for?',
      'How does the application work end-to-end from startup to user action?',
      'How do the frontend and backend communicate?',
    ];

    if (report.authenticationFlow.hasAuthentication) {
      const providerLabel = report.authenticationFlow.providers[0] || 'user';
      prompts.push(`How does ${providerLabel} authentication and route protection work?`);
    }

    if (report.apiIntegrations.length > 0) {
      const topApi = report.apiIntegrations[0].provider;
      prompts.push(`Where and how is ${topApi} integrated in this codebase?`);
    }

    if (report.databaseArchitecture.hasDatabase) {
      prompts.push('How does data flow into the database or persistence layer?');
    }

    const topFile =
      report.overview.entryPoints.backend[0] ||
      report.overview.entryPoints.frontend[0] ||
      Object.keys(report.cachedFiles)[0];
    if (topFile) {
      prompts.push(`Explain what ${topFile} does and its key functions.`);
    }

    return prompts.slice(0, 7);
  }, [report]);

  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

  useEffect(() => {
    if (!isVerifiedUser || !user?.uid) {
      setMessages([]);
      return;
    }

    let active = true;
    setLoadingHistory(true);
    setError(null);

    api
      .getIntelligenceQaHistory(repositoryId)
      .then((res) => {
        if (!active) return;
        setMessages(res.messages ?? []);
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : 'Unable to load previous Q&A conversation.'
        );
      })
      .finally(() => {
        if (active) setLoadingHistory(false);
      });

    return () => {
      active = false;
    };
  }, [repositoryId, isVerifiedUser, user?.uid]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages.length, sending]);

  async function submitQuestion(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending || !isVerifiedUser) return;

    setSending(true);
    setError(null);

    try {
      const res = await api.askRepositoryQuestion(repositoryId, trimmed);
      setMessages(res.messages);
      setQuestion('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Gemini API rate limit reached (429). Please wait a few seconds and ask again.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to answer repository question.');
      }
    } finally {
      setSending(false);
    }
  }

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    void submitQuestion(question);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitQuestion(question);
    }
  }

  async function handleClearHistory() {
    if (clearing || messages.length === 0 || !isVerifiedUser) return;
    setClearing(true);
    setError(null);
    try {
      await api.clearIntelligenceQaHistory(repositoryId);
      setMessages([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear chat history.');
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="bg-[#111827] border border-slate-800/90 rounded-lg overflow-hidden flex flex-col">
        {/* Header Bar */}
        <div className="px-5 py-4 border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <MessageSquareText className="w-4 h-4 text-blue-400" aria-hidden="true" />
              <h3 className="text-base font-bold text-slate-100">Ask Your Repository</h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Answers are retrieved strictly from analyzed source files in{' '}
              <span className="font-mono text-slate-200">{report.repositoryFullName}</span> and saved per user session.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {messages.length > 0 && isVerifiedUser && (
              <button
                type="button"
                disabled={clearing || sending}
                onClick={() => void handleClearHistory()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#0B0F17] hover:bg-slate-800 border border-slate-700 text-xs text-slate-300 disabled:opacity-50 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                <span>{clearing ? 'Clearing...' : 'Clear History'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Unauthenticated Gate Notice (if accessed before verified Google Sign-In) */}
        {!isVerifiedUser ? (
          <div className="p-8 text-center space-y-3">
            <ShieldAlert className="w-7 h-7 text-amber-400 mx-auto" aria-hidden="true" />
            <h4 className="text-sm font-semibold text-slate-100">
              Sign in with Google to use Ask Your Repository
            </h4>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Your Repository Q&A conversation history is strictly scoped to your verified Google account and repository.
            </p>
            <button
              type="button"
              disabled={signingIn}
              onClick={() => void signInWithGoogle()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white disabled:opacity-50"
            >
              <span>{signingIn ? 'Signing in...' : 'Sign in with Google'}</span>
            </button>
          </div>
        ) : (
          <>
            {/* Starter Prompt Suggestions */}
            <div className="px-5 py-3 bg-[#0B0F17]/70 border-b border-slate-800/80 space-y-2">
              <div className="text-[11px] font-medium text-slate-400">
                Suggested Questions for {report.name}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {starterQuestions.map((promptText) => (
                  <button
                    key={promptText}
                    type="button"
                    disabled={sending}
                    onClick={() => void submitQuestion(promptText)}
                    className="px-2.5 py-1.5 rounded-md bg-[#111827] hover:bg-slate-800 border border-slate-800 hover:border-slate-600 text-[11px] text-slate-300 hover:text-white transition-colors text-left disabled:opacity-50"
                  >
                    {promptText}
                  </button>
                ))}
              </div>
            </div>

            {/* Thread Viewport */}
            <div className="p-5 space-y-4 min-h-[320px] max-h-[540px] overflow-y-auto bg-[#0B0F17]/40">
              {loadingHistory ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-400" aria-hidden="true" />
                  <span>Loading your saved repository questions...</span>
                </div>
              ) : messages.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <Sparkles className="w-6 h-6 text-blue-400 mx-auto" aria-hidden="true" />
                  <div className="text-sm font-semibold text-slate-200">
                    Ask anything about {report.repositoryFullName}
                  </div>
                  <p className="text-xs text-slate-400 max-w-lg mx-auto">
                    Pick a suggested question above or ask about a specific file path, endpoint, auth flow, or database model. Cited files open directly in the code explorer.
                  </p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[92%] lg:max-w-[82%] rounded-lg p-4 text-xs space-y-3 ${
                        msg.role === 'user'
                          ? 'bg-blue-600/20 border border-blue-500/40 text-slate-100'
                          : 'bg-[#111827] border border-slate-800 text-slate-200'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <span
                          className={`font-semibold ${
                            msg.role === 'user' ? 'text-blue-300' : 'text-purple-300'
                          }`}
                        >
                          {msg.role === 'user' ? 'You' : 'Repository Assistant'}
                        </span>
                        <div className="flex items-center gap-2">
                          {msg.role === 'assistant' && msg.evidenceStatus && (
                            <span
                              className={`font-medium ${
                                msg.evidenceStatus === 'grounded'
                                  ? 'text-emerald-400'
                                  : msg.evidenceStatus === 'partial'
                                    ? 'text-amber-400'
                                    : 'text-red-400'
                              }`}
                            >
                              {msg.evidenceStatus === 'grounded'
                                ? 'Grounded in source'
                                : msg.evidenceStatus === 'partial'
                                  ? 'Partial evidence'
                                  : 'Insufficient evidence'}
                            </span>
                          )}
                          <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                            {new Date(msg.createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </div>

                      <div className="whitespace-pre-wrap leading-relaxed text-slate-200">
                        {msg.content}
                      </div>

                      {msg.insufficientEvidenceReason && (
                        <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 flex items-start gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" aria-hidden="true" />
                          <span>{msg.insufficientEvidenceReason}</span>
                        </div>
                      )}

                      {msg.references && msg.references.length > 0 && (
                        <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                          <div className="text-[11px] font-medium text-slate-400">
                            Referenced Repository Files (click to inspect source):
                          </div>
                          <div className="flex flex-col gap-1.5">
                            {msg.references.map((ref, idx) => (
                              <button
                                key={`${ref.filePath}-${idx}`}
                                type="button"
                                onClick={() => onOpenFile(ref.filePath)}
                                className="w-full text-left px-2.5 py-2 rounded bg-[#0B0F17] hover:bg-slate-800/90 border border-slate-800 flex items-start justify-between gap-2 transition-colors"
                              >
                                <div className="min-w-0 space-y-0.5">
                                  <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-blue-300">
                                    <FileCode2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                    <span className="truncate">{ref.filePath}</span>
                                    {ref.symbol && (
                                      <span className="text-purple-300">:: {ref.symbol}</span>
                                    )}
                                    {ref.lineHint && (
                                      <span className="text-slate-500">({ref.lineHint})</span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-400">{ref.reason}</div>
                                </div>
                                <ExternalLink
                                  className="w-3.5 h-3.5 shrink-0 text-slate-500 mt-0.5"
                                  aria-hidden="true"
                                />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}

              {sending && (
                <div className="flex justify-start">
                  <div className="bg-[#111827] border border-slate-800 rounded-lg px-4 py-3 text-xs text-slate-300 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-400" aria-hidden="true" />
                    <span>Retrieving relevant files and synthesizing grounded answer...</span>
                  </div>
                </div>
              )}

              <div ref={threadEndRef} />
            </div>

            {error && (
              <div
                role="alert"
                className="mx-5 my-2 bg-red-500/10 border border-red-500/30 rounded-md px-3.5 py-2.5 text-xs text-red-300 flex items-center gap-2"
              >
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            {/* Question Composer */}
            <form
              onSubmit={handleFormSubmit}
              className="p-4 border-t border-slate-800/90 bg-[#0F172A]/80 flex flex-col sm:flex-row gap-2.5"
            >
              <textarea
                rows={2}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={sending}
                maxLength={2000}
                placeholder="Ask a question about files, routes, auth, database, or architecture (Enter to send)..."
                className="flex-1 resize-none rounded-md bg-[#0B0F17] border border-slate-700/80 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={sending || !question.trim()}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:opacity-50 text-xs font-semibold text-white whitespace-nowrap shrink-0"
              >
                {sending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{sending ? 'Answering...' : 'Ask Repository'}</span>
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
