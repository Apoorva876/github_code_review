import {
  ChevronDown,
  ChevronRight,
  Cpu,
  Database,
  ExternalLink,
  FileCode2,
  Globe,
  Layers,
  Lock,
  RotateCcw,
  Search,
  Server,
  Settings2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useMemo, useRef, useState, type MouseEvent } from 'react';
import type { ArchitectureComponentCategory, ArchitectureComponentNode } from '../../types';

interface InteractiveArchitectureGraphProps {
  components: ArchitectureComponentNode[];
  onOpenFile?: (filePath: string) => void;
}

interface LayerDef {
  key: string;
  label: string;
  categories: ArchitectureComponentCategory[];
  accentText: string;
  accentBorder: string;
}

const LAYER_DEFS: LayerDef[] = [
  {
    key: 'frontend',
    label: 'Frontend & UI Layer',
    categories: ['frontend'],
    accentText: 'text-blue-400',
    accentBorder: 'border-blue-500/35',
  },
  {
    key: 'auth',
    label: 'Authentication & Security',
    categories: ['auth'],
    accentText: 'text-purple-400',
    accentBorder: 'border-purple-500/35',
  },
  {
    key: 'backend',
    label: 'Backend & Business Logic',
    categories: ['backend', 'module'],
    accentText: 'text-emerald-400',
    accentBorder: 'border-emerald-500/35',
  },
  {
    key: 'database',
    label: 'Database & Persistence',
    categories: ['database'],
    accentText: 'text-amber-400',
    accentBorder: 'border-amber-500/35',
  },
  {
    key: 'external',
    label: 'AI & External Integrations',
    categories: ['ai-service', 'external-api'],
    accentText: 'text-cyan-400',
    accentBorder: 'border-cyan-500/35',
  },
  {
    key: 'config',
    label: 'Config & Infrastructure',
    categories: ['config'],
    accentText: 'text-slate-300',
    accentBorder: 'border-slate-700',
  },
];

function getCategoryIcon(category: ArchitectureComponentCategory) {
  switch (category) {
    case 'frontend':
      return Globe;
    case 'backend':
      return Server;
    case 'database':
      return Database;
    case 'auth':
      return Lock;
    case 'ai-service':
      return Cpu;
    case 'external-api':
      return ExternalLink;
    case 'config':
      return Settings2;
    default:
      return Layers;
  }
}

export function InteractiveArchitectureGraph({
  components,
  onOpenFile,
}: InteractiveArchitectureGraphProps) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(components[0]?.id ?? null);
  const [collapsedLayers, setCollapsedLayers] = useState<Record<string, boolean>>({});
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const dragOriginRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const movedRef = useRef(false);

  const filteredComponents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return components;
    return components.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.purpose.toLowerCase().includes(q) ||
        c.filePaths.some((fp) => fp.toLowerCase().includes(q)) ||
        c.symbols.some((s) => s.toLowerCase().includes(q))
    );
  }, [components, search]);

  const activeLayers = useMemo(() => {
    return LAYER_DEFS.map((layer) => ({
      ...layer,
      items: filteredComponents.filter((c) => layer.categories.includes(c.category)),
    })).filter((l) => l.items.length > 0);
  }, [filteredComponents]);

  // Compute deterministic coordinates inside an SVG/HTML coordinate space for nodes + bezier links
  const layout = useMemo(() => {
    const colWidth = 250;
    const colGap = 52;
    const nodeWidth = 228;
    const nodeHeight = 74;
    const nodeGapY = 18;
    const padX = 24;
    const padTop = 54;

    const positions = new Map<
      string,
      { x: number; y: number; width: number; height: number; node: ArchitectureComponentNode }
    >();
    const columns: Array<{
      layer: LayerDef & { items: ArchitectureComponentNode[] };
      x: number;
      collapsed: boolean;
    }> = [];

    let maxY = 300;
    activeLayers.forEach((layer, colIdx) => {
      const x = padX + colIdx * (colWidth + colGap);
      const isCollapsed = Boolean(collapsedLayers[layer.key]);
      columns.push({ layer, x, collapsed: isCollapsed });

      if (!isCollapsed) {
        layer.items.forEach((item, rowIdx) => {
          const y = padTop + rowIdx * (nodeHeight + nodeGapY);
          positions.set(item.id, {
            x: x + 10,
            y,
            width: nodeWidth,
            height: nodeHeight,
            node: item,
          });
          maxY = Math.max(maxY, y + nodeHeight + 36);
        });
      }
    });

    const totalWidth = Math.max(720, padX * 2 + activeLayers.length * (colWidth + colGap) - colGap);

    const edges: Array<{
      id: string;
      fromId: string;
      toId: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }> = [];

    const seenEdge = new Set<string>();
    for (const [fromId, fromPos] of positions.entries()) {
      for (const toId of fromPos.node.connectedIds) {
        if (fromId === toId) continue;
        const toPos = positions.get(toId);
        if (!toPos) continue;
        const key = `${fromId}->${toId}`;
        if (seenEdge.has(key)) continue;
        seenEdge.add(key);

        const goingRight = toPos.x >= fromPos.x;
        const x1 = goingRight ? fromPos.x + fromPos.width : fromPos.x;
        const y1 = fromPos.y + fromPos.height / 2;
        const x2 = goingRight ? toPos.x : toPos.x + toPos.width;
        const y2 = toPos.y + toPos.height / 2;
        edges.push({ id: key, fromId, toId, x1, y1, x2, y2 });
      }
    }

    return {
      columns,
      positions,
      edges,
      width: totalWidth,
      height: maxY,
    };
  }, [activeLayers, collapsedLayers]);

  const selectedNode = useMemo(
    () => components.find((c) => c.id === selectedId) ?? filteredComponents[0] ?? null,
    [components, filteredComponents, selectedId]
  );

  const connectedToSelected = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const set = new Set<string>(selectedNode.connectedIds);
    for (const c of components) {
      if (c.connectedIds.includes(selectedNode.id)) {
        set.add(c.id);
      }
    }
    return set;
  }, [components, selectedNode]);

  function handleMouseDown(e: MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    dragOriginRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    movedRef.current = false;
    setDragging(true);
  }

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    if (!dragging || !dragOriginRef.current) return;
    const dx = e.clientX - dragOriginRef.current.x;
    const dy = e.clientY - dragOriginRef.current.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) movedRef.current = true;
    setPan({ x: dragOriginRef.current.px + dx, y: dragOriginRef.current.py + dy });
  }

  function handleMouseUp() {
    setDragging(false);
    dragOriginRef.current = null;
  }

  return (
    <div className="bg-[#111827] border border-slate-800/90 rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-slate-800/90 bg-[#0F172A]/80 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-100">
            Interactive Component Topology Map
          </h4>
          <p className="text-[11px] text-slate-400">
            Click any module to highlight its dependencies, read simple/technical explanations, and jump to source files.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter components or files..."
              className="pl-8 pr-3 py-1.5 text-xs bg-[#0B0F17] border border-slate-700/80 rounded-md text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500 w-52"
            />
          </div>

          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(1.8, Number((z + 0.15).toFixed(2))))}
            aria-label="Zoom in component map"
            className="p-1.5 rounded border border-slate-700/80 bg-[#0B0F17] text-slate-300 hover:text-white"
          >
            <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <span className="text-[11px] font-mono text-slate-400 tabular-nums w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.55, Number((z - 0.15).toFixed(2))))}
            aria-label="Zoom out component map"
            className="p-1.5 rounded border border-slate-700/80 bg-[#0B0F17] text-slate-300 hover:text-white"
          >
            <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            aria-label="Reset component map view"
            className="p-1.5 rounded border border-slate-700/80 bg-[#0B0F17] text-slate-300 hover:text-white"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Main Split: Interactive Canvas + Inspector */}
      <div className="flex flex-col xl:flex-row">
        <div
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className={`flex-1 relative bg-[#0B0F17] h-[470px] overflow-auto select-none ${
            dragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
        >
          {activeLayers.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-slate-500 p-6">
              No components match "{search}".
            </div>
          ) : (
            <div
              style={{
                width: `${layout.width}px`,
                height: `${layout.height}px`,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'top left',
              }}
              className="relative transition-transform duration-75"
            >
              {/* Directional Edge Layer */}
              <svg
                width={layout.width}
                height={layout.height}
                className="absolute inset-0 pointer-events-none"
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="cr-arrow-muted"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#475569" />
                  </marker>
                  <marker
                    id="cr-arrow-active"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#60A5FA" />
                  </marker>
                </defs>

                {layout.edges.map((edge) => {
                  const isHighlighted =
                    selectedNode &&
                    (edge.fromId === selectedNode.id || edge.toId === selectedNode.id);
                  const dx = Math.max(40, Math.abs(edge.x2 - edge.x1) * 0.45);
                  const c1x = edge.x2 >= edge.x1 ? edge.x1 + dx : edge.x1 - dx;
                  const c2x = edge.x2 >= edge.x1 ? edge.x2 - dx : edge.x2 + dx;
                  const pathD = `M ${edge.x1} ${edge.y1} C ${c1x} ${edge.y1}, ${c2x} ${edge.y2}, ${edge.x2} ${edge.y2}`;

                  return (
                    <path
                      key={edge.id}
                      d={pathD}
                      fill="none"
                      stroke={isHighlighted ? '#60A5FA' : '#334155'}
                      strokeWidth={isHighlighted ? 2 : 1.25}
                      strokeOpacity={isHighlighted ? 0.95 : 0.65}
                      markerEnd={
                        isHighlighted ? 'url(#cr-arrow-active)' : 'url(#cr-arrow-muted)'
                      }
                    />
                  );
                })}
              </svg>

              {/* Layer Headers */}
              {layout.columns.map(({ layer, x, collapsed }) => (
                <div
                  key={layer.key}
                  style={{ left: `${x}px`, top: '12px', width: '248px' }}
                  className="absolute"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedLayers((prev) => ({
                        ...prev,
                        [layer.key]: !prev[layer.key],
                      }))
                    }
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-[#111827] border border-slate-800 hover:border-slate-700 text-xs font-semibold"
                  >
                    <span className={`truncate ${layer.accentText}`}>{layer.label}</span>
                    <span className="flex items-center gap-1 text-[11px] font-mono text-slate-400 shrink-0">
                      <span>{layer.items.length}</span>
                      {collapsed ? (
                        <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                    </span>
                  </button>
                </div>
              ))}

              {/* Component Nodes */}
              {Array.from(layout.positions.values()).map(({ x, y, width, height, node }) => {
                const isSelected = selectedNode?.id === node.id;
                const isNeighbor = connectedToSelected.has(node.id);
                const Icon = getCategoryIcon(node.category);

                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => {
                      if (!movedRef.current) setSelectedId(node.id);
                    }}
                    style={{
                      left: `${x}px`,
                      top: `${y}px`,
                      width: `${width}px`,
                      height: `${height}px`,
                    }}
                    className={`absolute text-left rounded-lg px-3 py-2 border transition-colors flex flex-col justify-between ${
                      isSelected
                        ? 'bg-[#1E293B] border-blue-500 ring-2 ring-blue-500/25 shadow-lg shadow-blue-950/40'
                        : isNeighbor
                          ? 'bg-[#151E2E] border-blue-400/50 hover:border-blue-400'
                          : 'bg-[#111827] border-slate-800 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Icon className="w-3.5 h-3.5 text-blue-400 shrink-0" aria-hidden="true" />
                        <span className="text-xs font-semibold text-slate-100 truncate">
                          {node.name}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500 shrink-0">
                        {node.filePaths.length}f
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2 leading-snug">
                      {node.purpose}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Side Details Inspector */}
        <aside className="w-full xl:w-96 border-t xl:border-t-0 xl:border-l border-slate-800/90 bg-[#0F172A]/60 p-4 overflow-y-auto h-[470px]">
          {selectedNode ? (
            <div className="space-y-4 text-xs">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-blue-400">
                    {selectedNode.category}
                  </span>
                  <span
                    className={`text-[11px] font-medium ${
                      selectedNode.confidence === 'confirmed'
                        ? 'text-emerald-400'
                        : 'text-amber-400'
                    }`}
                  >
                    {selectedNode.confidence === 'confirmed' ? 'Confirmed' : 'Inferred'}
                  </span>
                </div>
                <h5 className="text-base font-bold text-slate-100 mt-1">{selectedNode.name}</h5>
                <p className="text-slate-300 mt-1 leading-relaxed">{selectedNode.purpose}</p>
              </div>

              <div className="p-3 rounded-md bg-[#0B0F17] border border-slate-800 space-y-1.5">
                <div className="text-[11px] font-semibold text-blue-300">
                  Simple Explanation (Beginner-Friendly)
                </div>
                <p className="text-slate-300 leading-relaxed">{selectedNode.simpleExplanation}</p>
              </div>

              <div className="p-3 rounded-md bg-[#0B0F17] border border-slate-800 space-y-1.5">
                <div className="text-[11px] font-semibold text-purple-300">
                  Technical Explanation
                </div>
                <p className="text-slate-300 leading-relaxed">
                  {selectedNode.technicalExplanation}
                </p>
              </div>

              {selectedNode.symbols.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-slate-300 mb-1.5">
                    Functions, Classes & Symbols
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedNode.symbols.map((sym) => (
                      <code
                        key={sym}
                        className="px-1.5 py-0.5 rounded bg-[#0B0F17] border border-slate-800 font-mono text-[11px] text-slate-200"
                      >
                        {sym}
                      </code>
                    ))}
                  </div>
                </div>
              )}

              {selectedNode.filePaths.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-slate-300 mb-1.5">
                    Source Files (Click to Inspect Code)
                  </div>
                  <div className="space-y-1">
                    {selectedNode.filePaths.map((fp) => (
                      <button
                        key={fp}
                        type="button"
                        onClick={() => onOpenFile?.(fp)}
                        className="w-full text-left flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 font-mono text-[11px] text-blue-300 hover:text-blue-200 transition-colors"
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

              {connectedToSelected.size > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-slate-300 mb-1.5">
                    Connected Modules
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(connectedToSelected).map((cid) => {
                      const target = components.find((c) => c.id === cid);
                      if (!target) return null;
                      return (
                        <button
                          key={cid}
                          type="button"
                          onClick={() => setSelectedId(target.id)}
                          className="px-2 py-1 rounded bg-[#0B0F17] hover:bg-slate-800 border border-slate-700 text-[11px] text-slate-200 transition-colors"
                        >
                          {target.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-slate-500">Select a component to inspect its details.</div>
          )}
        </aside>
      </div>
    </div>
  );
}
