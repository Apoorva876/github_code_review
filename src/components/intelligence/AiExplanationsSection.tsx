import { BookOpen, Cpu, FileCode2, Link2, Search, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { RepositoryIntelligenceReport } from '../../types';
import {
  buildGroundedExplanations,
  type ExplanationCategory,
} from '../../utils/explanationsBuilder';

interface AiExplanationsSectionProps {
  report: RepositoryIntelligenceReport;
  onOpenFile: (filePath: string) => void;
}

type CategoryFilter = 'all' | ExplanationCategory;
type ViewMode = 'both' | 'beginner' | 'technical';

const CATEGORY_OPTIONS: Array<{ id: CategoryFilter; label: string }> = [
  { id: 'all', label: 'All Layers' },
  { id: 'components', label: 'Architecture & Nodes' },
  { id: 'folders-files', label: 'Folders & Files' },
  { id: 'frontend', label: 'Frontend' },
  { id: 'backend', label: 'Backend & Routes' },
  { id: 'integrations', label: 'API Integrations' },
  { id: 'database', label: 'Database' },
  { id: 'auth', label: 'Authentication' },
  { id: 'workflows', label: 'Workflows' },
];

export function AiExplanationsSection({
  report,
  onOpenFile,
}: AiExplanationsSectionProps) {
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('both');
  const [searchQuery, setSearchQuery] = useState('');

  const allItems = useMemo(() => buildGroundedExplanations(report), [report]);

  const countsByCategory = useMemo(() => {
    const counts: Record<string, number> = { all: allItems.length };
    for (const item of allItems) {
      counts[item.category] = (counts[item.category] ?? 0) + 1;
    }
    return counts;
  }, [allItems]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allItems.filter((item) => {
      if (selectedCategory !== 'all' && item.category !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.beginnerExplanation.toLowerCase().includes(q) ||
        item.technicalExplanation.toLowerCase().includes(q) ||
        item.filePaths.some((fp) => fp.toLowerCase().includes(q)) ||
        item.symbols.some((sym) => sym.toLowerCase().includes(q))
      );
    });
  }, [allItems, selectedCategory, searchQuery]);

  return (
    <div className="space-y-5">
      {/* Controls Bar */}
      <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-100">
              AI-Powered Beginner & Technical Explanations
            </h3>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl">
              Every important folder, source file, frontend view, backend route, API integration, database entity, authentication step, workflow, and architecture diagram node explained from two perspectives grounded strictly in analyzed code.
            </p>
          </div>

          {/* Reading Level Toggle */}
          <div className="inline-flex rounded-md border border-slate-700/80 bg-[#0B0F17] p-0.5 text-xs shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('both')}
              className={`px-2.5 py-1.5 rounded transition-colors ${
                viewMode === 'both'
                  ? 'bg-slate-700 text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Side-by-Side
            </button>
            <button
              type="button"
              onClick={() => setViewMode('beginner')}
              className={`px-2.5 py-1.5 rounded transition-colors ${
                viewMode === 'beginner'
                  ? 'bg-blue-600 text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Beginner Level
            </button>
            <button
              type="button"
              onClick={() => setViewMode('technical')}
              className={`px-2.5 py-1.5 rounded transition-colors ${
                viewMode === 'technical'
                  ? 'bg-purple-600 text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Technical Level
            </button>
          </div>
        </div>

        {/* Search & Category Filter */}
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search
              className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter explanations by file path, function symbol, route, or keyword..."
              className="w-full pl-9 pr-3 py-2 rounded-md bg-[#0B0F17] border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="text-xs font-mono text-slate-400 flex items-center tabular-nums px-1">
            Showing {filteredItems.length} of {allItems.length} documented items
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-800/80">
          {CATEGORY_OPTIONS.map((opt) => {
            const count = countsByCategory[opt.id] ?? 0;
            const active = selectedCategory === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelectedCategory(opt.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors ${
                  active
                    ? 'bg-blue-600 text-white font-medium'
                    : 'bg-[#0B0F17] border border-slate-800 text-slate-300 hover:border-slate-600'
                }`}
              >
                <span>{opt.label}</span>
                <span className={`font-mono text-[11px] tabular-nums ${active ? 'text-blue-100' : 'text-slate-500'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Explanations List */}
      {filteredItems.length === 0 ? (
        <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-8 text-center space-y-2">
          <BookOpen className="w-6 h-6 text-slate-500 mx-auto" aria-hidden="true" />
          <div className="text-sm font-semibold text-slate-200">
            No matching component explanations
          </div>
          <p className="text-xs text-slate-400">
            Clear your search filter or switch to another layer category to inspect documented modules.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredItems.map((item) => (
            <article
              key={item.id}
              className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-3.5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                    <span className="text-blue-400">{item.categoryLabel}</span>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span className="text-slate-400">{item.subtitle}</span>
                  </div>
                  <h4 className="text-sm sm:text-base font-semibold text-slate-100 mt-1 break-words font-mono">
                    {item.title}
                  </h4>
                </div>
                <span
                  className={`text-[11px] font-medium shrink-0 ${
                    item.confidence === 'confirmed' ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {item.confidence === 'confirmed' ? 'Verified in source' : 'Inferred from context'}
                </span>
              </div>

              {/* Dual Explanations */}
              <div
                className={`grid gap-3 ${
                  viewMode === 'both' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'
                }`}
              >
                {(viewMode === 'both' || viewMode === 'beginner') && (
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3.5 space-y-1.5">
                    <div className="text-[11px] font-semibold text-blue-400 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Beginner Explanation (What & Why)</span>
                    </div>
                    <p className="text-xs text-slate-200 leading-relaxed">
                      {item.beginnerExplanation}
                    </p>
                  </div>
                )}

                {(viewMode === 'both' || viewMode === 'technical') && (
                  <div className="bg-[#0B0F17] border border-slate-800 rounded-md p-3.5 space-y-1.5">
                    <div className="text-[11px] font-semibold text-purple-400 flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Technical Explanation (Implementation & Flow)</span>
                    </div>
                    <p className="text-xs text-slate-200 leading-relaxed">
                      {item.technicalExplanation}
                    </p>
                  </div>
                )}
              </div>

              {/* Symbols, Relationships & Clickable Source Links */}
              {(item.filePaths.length > 0 ||
                item.symbols.length > 0 ||
                item.relationships.length > 0) && (
                <div className="pt-2 border-t border-slate-800/80 flex flex-col gap-2 text-xs">
                  {item.filePaths.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-slate-400 mr-1">Source Files:</span>
                      {item.filePaths.map((fp) => (
                        <button
                          key={fp}
                          type="button"
                          onClick={() => onOpenFile(fp)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 text-[11px] font-mono text-blue-300 hover:text-blue-200 transition-colors"
                        >
                          <FileCode2 className="w-3 h-3 shrink-0" aria-hidden="true" />
                          <span>{fp}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {item.symbols.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-slate-400 mr-1">Functions & Symbols:</span>
                      {item.symbols.map((sym) => (
                        <code
                          key={sym}
                          className="px-1.5 py-0.5 rounded bg-[#0B0F17] border border-slate-800 font-mono text-[11px] text-slate-200"
                        >
                          {sym}
                        </code>
                      ))}
                    </div>
                  )}

                  {item.relationships.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      <span className="inline-flex items-center gap-1 text-slate-300">
                        <Link2 className="w-3 h-3 text-slate-500" aria-hidden="true" />
                        <span>Connections:</span>
                      </span>
                      <span>{item.relationships.join(' · ')}</span>
                    </div>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
