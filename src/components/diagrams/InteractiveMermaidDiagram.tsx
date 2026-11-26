import {
  Code2,
  Compass,
  ExternalLink,
  FileCode2,
  Maximize2,
  Minimize2,
  RotateCcw,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { ArchitectureComponentNode, IntelligenceDiagramSpec } from '../../types';
import { renderMermaidSvg } from '../../utils/mermaidUtils';

interface InteractiveMermaidDiagramProps {
  spec: IntelligenceDiagramSpec;
  components?: ArchitectureComponentNode[];
  onOpenFile?: (filePath: string) => void;
  defaultExplanationMode?: 'simple' | 'technical';
  minHeightClass?: string;
}

interface ClickedNodeInspection {
  label: string;
  matchedComponent: ArchitectureComponentNode | null;
  matchedFiles: string[];
}

function findBestComponentMatch(
  label: string,
  components: ArchitectureComponentNode[],
  fallbackFiles: string[]
): ClickedNodeInspection {
  const norm = label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const tokens = norm.split(/\s+/).filter((t) => t.length >= 3);

  let best: ArchitectureComponentNode | null = null;
  let bestScore = 0;

  for (const comp of components) {
    const compName = comp.name.toLowerCase();
    const compId = comp.id.toLowerCase();
    let score = 0;
    if (norm === compName || norm === compId) score += 100;
    else if (norm.includes(compName) || compName.includes(norm)) score += 60;
    for (const tok of tokens) {
      if (compName.includes(tok)) score += 12;
      if (comp.filePaths.some((fp) => fp.toLowerCase().includes(tok))) score += 8;
      if (comp.symbols.some((sym) => sym.toLowerCase().includes(tok))) score += 6;
    }
    if (score > bestScore) {
      bestScore = score;
      best = comp;
    }
  }

  const matchedComponent = bestScore >= 12 ? best : null;
  const matchedFiles = matchedComponent
    ? matchedComponent.filePaths
    : fallbackFiles.filter((fp) => {
        const lowerFp = fp.toLowerCase();
        return tokens.some((t) => lowerFp.includes(t));
      });

  return {
    label,
    matchedComponent,
    matchedFiles: matchedFiles.slice(0, 8),
  };
}

export function InteractiveMermaidDiagram({
  spec,
  components = [],
  onOpenFile,
  defaultExplanationMode = 'simple',
  minHeightClass = 'min-h-[380px]',
}: InteractiveMermaidDiagramProps) {
  const [svgHtml, setSvgHtml] = useState<string>('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [explanationMode, setExplanationMode] = useState<'simple' | 'technical'>(
    defaultExplanationMode
  );
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [inspected, setInspected] = useState<ClickedNodeInspection | null>(null);

  const dragOriginRef = useRef<{ x: number; y: number; startPanX: number; startPanY: number } | null>(
    null
  );
  const movedDuringDragRef = useRef(false);
  const svgContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    setRenderError(null);
    renderMermaidSvg(spec.mermaidCode)
      .then(({ svg }) => {
        if (!active) return;
        setSvgHtml(svg);
      })
      .catch((err) => {
        if (!active) return;
        setSvgHtml('');
        setRenderError(
          err instanceof Error ? err.message : 'Unable to parse Mermaid diagram syntax.'
        );
      });
    return () => {
      active = false;
    };
  }, [spec.mermaidCode]);

  // Reset pan/zoom when switching diagrams
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setInspected(null);
  }, [spec.id, spec.mermaidCode]);

  const relatedComponents = useMemo(() => {
    if (!spec.relatedComponentIds || spec.relatedComponentIds.length === 0) {
      return components.slice(0, 6);
    }
    const idSet = new Set(spec.relatedComponentIds);
    const matched = components.filter((c) => idSet.has(c.id));
    return matched.length > 0 ? matched : components.slice(0, 6);
  }, [components, spec.relatedComponentIds]);

  function handleResetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function handleMouseDown(e: MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    dragOriginRef.current = {
      x: e.clientX,
      y: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    };
    movedDuringDragRef.current = false;
    setDragging(true);
  }

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    if (!dragging || !dragOriginRef.current) return;
    const dx = e.clientX - dragOriginRef.current.x;
    const dy = e.clientY - dragOriginRef.current.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      movedDuringDragRef.current = true;
    }
    setPan({
      x: dragOriginRef.current.startPanX + dx,
      y: dragOriginRef.current.startPanY + dy,
    });
  }

  function handleMouseUp() {
    setDragging(false);
    dragOriginRef.current = null;
  }

  function handleCanvasClick(e: MouseEvent<HTMLDivElement>) {
    if (movedDuringDragRef.current) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const nodeGroup = target.closest(
      '.node, .actor, .entityBox, g[id^="flowchart-"], g[class*="node"]'
    ) as SVGElement | null;

    if (!nodeGroup) return;

    const text = (nodeGroup.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return;

    setInspected(findBestComponentMatch(text, components, spec.sourceFiles));
  }

  const diagramContent = (
    <div
      className={`bg-[#111827] border border-slate-800/90 rounded-lg overflow-hidden flex flex-col ${
        fullscreen ? 'fixed inset-4 z-50 shadow-2xl shadow-black/70' : ''
      }`}
    >
      {/* Header Toolbar */}
      <div className="px-4 py-3 border-b border-slate-800/90 bg-[#0F172A]/80 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-slate-100 truncate">{spec.title}</h4>
            <span className="text-[11px] font-mono text-slate-400">
              {spec.diagramType === 'er'
                ? 'ER Diagram'
                : spec.diagramType === 'sequence'
                  ? 'Sequence'
                  : 'Flowchart'}
            </span>
            <span className="text-[11px] text-slate-500">·</span>
            <span
              className={`text-[11px] font-medium ${
                spec.confidence === 'confirmed' ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {spec.confidence === 'confirmed' ? 'Confirmed in source' : 'Inferred'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="inline-flex rounded-md border border-slate-700/80 bg-[#0B0F17] p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setExplanationMode('simple')}
              className={`px-2 py-1 rounded transition-colors ${
                explanationMode === 'simple'
                  ? 'bg-blue-600 text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Simple View
            </button>
            <button
              type="button"
              onClick={() => setExplanationMode('technical')}
              className={`px-2 py-1 rounded transition-colors ${
                explanationMode === 'technical'
                  ? 'bg-purple-600 text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Technical View
            </button>
          </div>

          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.4, Number((z + 0.2).toFixed(2))))}
            title="Zoom in"
            aria-label="Zoom in"
            className="p-1.5 rounded border border-slate-700/80 bg-[#0B0F17] text-slate-300 hover:text-white hover:border-slate-600"
          >
            <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <span className="text-[11px] font-mono text-slate-400 tabular-nums w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.45, Number((z - 0.2).toFixed(2))))}
            title="Zoom out"
            aria-label="Zoom out"
            className="p-1.5 rounded border border-slate-700/80 bg-[#0B0F17] text-slate-300 hover:text-white hover:border-slate-600"
          >
            <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleResetView}
            title="Reset zoom and pan"
            aria-label="Reset view"
            className="p-1.5 rounded border border-slate-700/80 bg-[#0B0F17] text-slate-300 hover:text-white hover:border-slate-600"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setShowSource((v) => !v)}
            title="Toggle Mermaid definition"
            aria-label="Toggle Mermaid definition"
            className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] transition-colors ${
              showSource
                ? 'border-blue-500/50 bg-blue-500/15 text-blue-200'
                : 'border-slate-700/80 bg-[#0B0F17] text-slate-300 hover:text-white'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Code</span>
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen diagram'}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen diagram'}
            className="p-1.5 rounded border border-slate-700/80 bg-[#0B0F17] text-slate-300 hover:text-white hover:border-slate-600"
          >
            {fullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Explanation Strip */}
      <div className="px-4 py-2.5 bg-[#0B0F17]/75 border-b border-slate-800/80 text-xs text-slate-300 leading-relaxed flex items-start gap-2">
        <Sparkles
          className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
            explanationMode === 'simple' ? 'text-blue-400' : 'text-purple-400'
          }`}
          aria-hidden="true"
        />
        <div>
          <span className="font-semibold text-slate-200 mr-1.5">
            {explanationMode === 'simple' ? 'Simple Explanation:' : 'Technical Explanation:'}
          </span>
          <span>
            {explanationMode === 'simple' ? spec.simpleExplanation : spec.technicalExplanation}
          </span>
        </div>
      </div>

      {/* Body: Interactive Canvas + Optional Node Inspector */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        <div className="flex-1 relative bg-[#0B0F17] overflow-hidden flex flex-col">
          {showSource ? (
            <pre className="p-4 text-xs font-mono text-slate-300 overflow-auto max-h-[520px] leading-relaxed">
              {spec.mermaidCode}
            </pre>
          ) : renderError ? (
            <div className="p-6 space-y-3 text-xs">
              <div className="text-amber-300 font-medium">
                Diagram rendering fallback (Mermaid syntax warning: {renderError})
              </div>
              <pre className="p-3 rounded bg-[#111827] border border-slate-800 text-slate-300 font-mono overflow-auto max-h-[320px]">
                {spec.mermaidCode}
              </pre>
            </div>
          ) : (
            <div
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onClick={handleCanvasClick}
              onWheel={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  e.preventDefault();
                  const delta = e.deltaY < 0 ? 0.1 : -0.1;
                  setZoom((z) => Math.max(0.45, Math.min(2.4, Number((z + delta).toFixed(2)))));
                }
              }}
              className={`relative flex-1 ${minHeightClass} ${
                fullscreen ? 'h-full' : 'max-h-[560px]'
              } overflow-hidden select-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            >
              <div
                ref={svgContainerRef}
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: 'center center',
                }}
                className="w-full h-full flex items-center justify-center p-6 transition-transform duration-75 [&_svg]:max-w-full [&_svg]:h-auto [&_.node]:cursor-pointer [&_.actor]:cursor-pointer [&_.entityBox]:cursor-pointer"
                // Mermaid is configured with securityLevel: 'strict'
                dangerouslySetInnerHTML={{ __html: svgHtml }}
              />
              <div className="pointer-events-none absolute bottom-2.5 left-3 text-[11px] text-slate-500 bg-[#0B0F17]/85 px-2 py-0.5 rounded border border-slate-800/80">
                Drag to pan · Ctrl+Scroll or +/- to zoom · Click a node to inspect
              </div>
            </div>
          )}
        </div>

        {/* Interactive Node / Component Inspector Side Panel */}
        {(inspected || relatedComponents.length > 0) && (
          <aside className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-slate-800/90 bg-[#0F172A]/60 p-4 flex flex-col gap-3 overflow-y-auto max-h-[560px]">
            {inspected ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-blue-400 font-semibold">
                      Selected Diagram Node
                    </div>
                    <h5 className="text-sm font-semibold text-slate-100 mt-0.5">
                      {inspected.matchedComponent?.name || inspected.label}
                    </h5>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInspected(null)}
                    aria-label="Close node inspector"
                    className="p-1 text-slate-400 hover:text-slate-100 rounded"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>

                {inspected.matchedComponent ? (
                  <div className="space-y-3 text-xs">
                    <div className="text-[11px] font-mono text-slate-400">
                      Category: <span className="text-slate-200">{inspected.matchedComponent.category}</span>
                      {' · '}
                      <span
                        className={
                          inspected.matchedComponent.confidence === 'confirmed'
                            ? 'text-emerald-400'
                            : 'text-amber-400'
                        }
                      >
                        {inspected.matchedComponent.confidence}
                      </span>
                    </div>

                    <div>
                      <div className="text-[11px] font-semibold text-slate-300 mb-1">
                        Simple Explanation
                      </div>
                      <p className="text-slate-400 leading-relaxed">
                        {inspected.matchedComponent.simpleExplanation}
                      </p>
                    </div>

                    <div>
                      <div className="text-[11px] font-semibold text-slate-300 mb-1">
                        Technical Details
                      </div>
                      <p className="text-slate-400 leading-relaxed">
                        {inspected.matchedComponent.technicalExplanation}
                      </p>
                    </div>

                    {inspected.matchedComponent.symbols.length > 0 && (
                      <div>
                        <div className="text-[11px] font-semibold text-slate-300 mb-1">
                          Key Functions & Symbols
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {inspected.matchedComponent.symbols.slice(0, 8).map((sym) => (
                            <code
                              key={sym}
                              className="px-1.5 py-0.5 rounded bg-[#0B0F17] border border-slate-800 text-[11px] font-mono text-blue-300"
                            >
                              {sym}
                            </code>
                          ))}
                        </div>
                      </div>
                    )}

                    {inspected.matchedComponent.filePaths.length > 0 && (
                      <div>
                        <div className="text-[11px] font-semibold text-slate-300 mb-1">
                          Source Files
                        </div>
                        <div className="space-y-1">
                          {inspected.matchedComponent.filePaths.map((fp) => (
                            <button
                              key={fp}
                              type="button"
                              onClick={() => onOpenFile?.(fp)}
                              className="w-full text-left flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-[#0B0F17] hover:bg-slate-800/90 border border-slate-800 text-[11px] font-mono text-blue-300 hover:text-blue-200 transition-colors"
                            >
                              <span className="truncate flex items-center gap-1.5">
                                <FileCode2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                <span className="truncate">{fp}</span>
                              </span>
                              <ExternalLink className="w-3 h-3 shrink-0 opacity-70" aria-hidden="true" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {inspected.matchedComponent.connectedIds.length > 0 && (
                      <div>
                        <div className="text-[11px] font-semibold text-slate-300 mb-1">
                          Connected Components
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {inspected.matchedComponent.connectedIds.map((cid) => {
                            const target = components.find((c) => c.id === cid);
                            if (!target) return null;
                            return (
                              <button
                                key={cid}
                                type="button"
                                onClick={() =>
                                  setInspected({
                                    label: target.name,
                                    matchedComponent: target,
                                    matchedFiles: target.filePaths,
                                  })
                                }
                                className="px-2 py-1 rounded bg-[#0B0F17] hover:bg-slate-800 border border-slate-700 text-[11px] text-slate-200 transition-colors"
                              >
                                → {target.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2.5 text-xs text-slate-400">
                    <p>
                      Node <span className="text-slate-200 font-medium">{inspected.label}</span> is part of{' '}
                      {spec.title}.
                    </p>
                    {inspected.matchedFiles.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[11px] font-semibold text-slate-300">
                          Related Source Files
                        </div>
                        {inspected.matchedFiles.map((fp) => (
                          <button
                            key={fp}
                            type="button"
                            onClick={() => onOpenFile?.(fp)}
                            className="w-full text-left flex items-center gap-1.5 px-2 py-1.5 rounded bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 text-[11px] font-mono text-blue-300"
                          >
                            <FileCode2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span className="truncate">{fp}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-2.5 text-xs">
                <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
                  <Compass className="w-3.5 h-3.5 text-blue-400" aria-hidden="true" />
                  <span>Interactive Component Index</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Click any node inside the diagram canvas or select a component below to inspect source files and explanations.
                </p>
                <div className="space-y-1.5">
                  {relatedComponents.map((comp) => (
                    <button
                      key={comp.id}
                      type="button"
                      onClick={() =>
                        setInspected({
                          label: comp.name,
                          matchedComponent: comp,
                          matchedFiles: comp.filePaths,
                        })
                      }
                      className="w-full text-left px-2.5 py-2 rounded bg-[#0B0F17] hover:bg-slate-800/80 border border-slate-800 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-200 truncate">{comp.name}</span>
                        <span className="text-[10px] font-mono text-slate-400 shrink-0">
                          {comp.category}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">{comp.purpose}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );

  return (
    <>
      {fullscreen && (
        <div
          className="fixed inset-0 z-40 bg-black/75 backdrop-blur-xs"
          onClick={() => setFullscreen(false)}
          aria-hidden="true"
        />
      )}
      {diagramContent}
    </>
  );
}
