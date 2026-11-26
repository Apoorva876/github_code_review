import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Lock,
  Search,
  WrapText,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../services/api';
import type {
  ArchitectureComponentNode,
  IntelligenceFileStatus,
  IntelligenceTreeNode,
  RepositoryIntelligenceReport,
} from '../../types';

interface RepositoryExplorerProps {
  report: RepositoryIntelligenceReport;
  selectedFilePath: string | null;
  onSelectFilePath: (path: string) => void;
  onSelectComponent?: (componentId: string) => void;
}

interface TreeBranchNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  meta?: IntelligenceTreeNode;
  children: TreeBranchNode[];
}

interface LoadedFilePayload {
  path: string;
  language: string;
  size: number;
  lineCount: number;
  content: string;
  isBinary: boolean;
  truncated: boolean;
  purpose: string;
  layer: string;
  symbols: string[];
  relatedComponentIds: string[];
  htmlUrl: string;
  source: 'cache' | 'github-live';
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getStatusBadge(status?: IntelligenceFileStatus): {
  label: string;
  dotClass: string;
  textClass: string;
} {
  switch (status) {
    case 'analyzed':
      return {
        label: 'Analyzed by AI',
        dotClass: 'bg-emerald-400',
        textClass: 'text-emerald-400',
      };
    case 'truncated':
      return {
        label: 'Partially analyzed (truncated)',
        dotClass: 'bg-amber-400',
        textClass: 'text-amber-400',
      };
    case 'sensitive':
      return {
        label: 'Sensitive file excluded',
        dotClass: 'bg-red-400',
        textClass: 'text-red-400',
      };
    case 'binary':
      return {
        label: 'Binary asset skipped',
        dotClass: 'bg-slate-500',
        textClass: 'text-slate-400',
      };
    case 'failed':
      return {
        label: 'Retrieval failed',
        dotClass: 'bg-red-400',
        textClass: 'text-red-400',
      };
    case 'skipped':
      return {
        label: 'Skipped (unsupported or size limit)',
        dotClass: 'bg-slate-500',
        textClass: 'text-slate-400',
      };
    default:
      return {
        label: 'In tree (click to fetch live)',
        dotClass: 'bg-blue-400',
        textClass: 'text-blue-400',
      };
  }
}

const KEYWORD_PATTERN =
  /\b(import|export|from|default|const|let|var|function|async|await|return|if|else|for|while|switch|case|break|try|catch|finally|throw|new|class|extends|implements|interface|type|enum|public|private|protected|def|class|elif|pass|with|as|SELECT|FROM|WHERE|JOIN|INSERT|UPDATE|DELETE|CREATE|TABLE|PRIMARY|KEY|REFERENCES|true|false|null|undefined|None|True|False)\b/g;

function highlightCodeLine(line: string): ReactNode {
  if (!line) return ' ';
  const trimmed = line.trimStart();
  if (
    trimmed.startsWith('//') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('--')
  ) {
    return <span className="text-slate-500 italic">{line}</span>;
  }

  // Tokenize strings and keywords safely without injecting raw HTML
  const parts: ReactNode[] = [];
  const tokenRegex =
    /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|\b(?:import|export|from|default|const|let|var|function|async|await|return|if|else|for|while|switch|case|break|try|catch|finally|throw|new|class|extends|implements|interface|type|enum|def|elif|with|as|SELECT|FROM|WHERE|JOIN|INSERT|UPDATE|DELETE|CREATE|TABLE|true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;
  while ((match = tokenRegex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }
    const token = match[0];
    idx += 1;
    if (token.startsWith("'") || token.startsWith('"') || token.startsWith('`')) {
      parts.push(
        <span key={idx} className="text-emerald-300">
          {token}
        </span>
      );
    } else if (/^\d/.test(token)) {
      parts.push(
        <span key={idx} className="text-amber-300">
          {token}
        </span>
      );
    } else if (KEYWORD_PATTERN.test(token)) {
      KEYWORD_PATTERN.lastIndex = 0;
      parts.push(
        <span key={idx} className="text-purple-300 font-medium">
          {token}
        </span>
      );
    } else {
      parts.push(token);
    }
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }
  return parts.length > 0 ? parts : line;
}

function buildNestedTree(nodes: IntelligenceTreeNode[]): TreeBranchNode[] {
  const rootChildren: TreeBranchNode[] = [];
  const dirMap = new Map<string, TreeBranchNode>();

  const ensureDir = (dirPath: string): TreeBranchNode => {
    const existing = dirMap.get(dirPath);
    if (existing) return existing;

    const segments = dirPath.split('/');
    const name = segments[segments.length - 1] || dirPath;
    const node: TreeBranchNode = {
      name,
      path: dirPath,
      type: 'dir',
      children: [],
    };
    dirMap.set(dirPath, node);

    if (segments.length === 1) {
      rootChildren.push(node);
    } else {
      const parentPath = segments.slice(0, -1).join('/');
      const parent = ensureDir(parentPath);
      parent.children.push(node);
    }
    return node;
  };

  for (const item of nodes) {
    if (item.type === 'dir') {
      const dir = ensureDir(item.path);
      dir.meta = item;
    }
  }

  for (const item of nodes) {
    if (item.type !== 'file') continue;
    const segments = item.path.split('/');
    const fileNode: TreeBranchNode = {
      name: item.name,
      path: item.path,
      type: 'file',
      meta: item,
      children: [],
    };
    if (segments.length === 1) {
      rootChildren.push(fileNode);
    } else {
      const parentPath = segments.slice(0, -1).join('/');
      const parent = ensureDir(parentPath);
      parent.children.push(fileNode);
    }
  }

  const sortTree = (list: TreeBranchNode[]) => {
    list.sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1;
      if (a.type !== 'dir' && b.type === 'dir') return 1;
      return a.name.localeCompare(b.name);
    });
    for (const child of list) {
      if (child.children.length > 0) sortTree(child.children);
    }
  };
  sortTree(rootChildren);
  return rootChildren;
}

export function RepositoryExplorer({
  report,
  selectedFilePath,
  onSelectFilePath,
  onSelectComponent,
}: RepositoryExplorerProps) {
  const [search, setSearch] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [liveCache, setLiveCache] = useState<Record<string, LoadedFilePayload>>({});
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);

  const nestedTree = useMemo(() => buildNestedTree(report.treeNodes), [report.treeNodes]);

  const allDirPaths = useMemo(
    () => report.treeNodes.filter((n) => n.type === 'dir').map((n) => n.path),
    [report.treeNodes]
  );

  // Expand top-level directories initially
  useEffect(() => {
    const initial: Record<string, boolean> = {};
    for (const node of nestedTree) {
      if (node.type === 'dir') initial[node.path] = true;
    }
    setExpandedDirs(initial);
  }, [report.id, nestedTree]);

  // Pick a sensible default file if none selected yet
  useEffect(() => {
    if (selectedFilePath) return;
    const preferred =
      report.overview.entryPoints.frontend[0] ||
      report.overview.entryPoints.backend[0] ||
      Object.keys(report.cachedFiles)[0] ||
      report.treeNodes.find((n) => n.type === 'file')?.path ||
      null;
    if (preferred) {
      onSelectFilePath(preferred);
    }
  }, [report, selectedFilePath, onSelectFilePath]);

  // Expand parent folders whenever selectedFilePath changes
  useEffect(() => {
    if (!selectedFilePath) return;
    const parts = selectedFilePath.split('/');
    if (parts.length <= 1) return;
    setExpandedDirs((prev) => {
      const next = { ...prev };
      for (let i = 1; i < parts.length; i += 1) {
        next[parts.slice(0, i).join('/')] = true;
      }
      return next;
    });
  }, [selectedFilePath]);

  // Load selected file content (from report cache first, then live cache, else GitHub API)
  useEffect(() => {
    if (!selectedFilePath) return;
    setFileError(null);

    const cached = report.cachedFiles[selectedFilePath];
    if (cached || liveCache[selectedFilePath]) {
      setLoadingFile(false);
      return;
    }

    const treeNode = report.treeNodes.find((n) => n.path === selectedFilePath);
    if (treeNode?.status === 'sensitive') {
      setFileError(
        'Sensitive environment, credential, or private key files are blocked from preview for security.'
      );
      return;
    }
    if (treeNode?.status === 'binary') {
      setFileError('Binary asset preview is not displayed as source text.');
      return;
    }

    let cancelled = false;
    setLoadingFile(true);
    api
      .getIntelligenceFile(report.repositoryId, selectedFilePath, report.analyzedCommitSha)
      .then((res) => {
        if (cancelled) return;
        setLiveCache((prev) => ({
          ...prev,
          [selectedFilePath]: {
            ...res.file,
            source: res.source,
          },
        }));
      })
      .catch((err) => {
        if (cancelled) return;
        setFileError(err instanceof Error ? err.message : 'Unable to load file content.');
      })
      .finally(() => {
        if (!cancelled) setLoadingFile(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedFilePath, report, liveCache]);

  const activeFile: LoadedFilePayload | null = useMemo(() => {
    if (!selectedFilePath) return null;
    const cached = report.cachedFiles[selectedFilePath];
    if (cached) {
      return {
        path: cached.path,
        language: cached.language,
        size: cached.size,
        lineCount: cached.lineCount,
        content: cached.rawContent,
        isBinary: false,
        truncated: cached.truncated,
        purpose: cached.purpose,
        layer: cached.layer,
        symbols: cached.symbols,
        relatedComponentIds: cached.relatedComponentIds,
        htmlUrl: `${report.htmlUrl}/blob/${encodeURIComponent(report.branch)}/${cached.path}`,
        source: 'cache',
      };
    }
    return liveCache[selectedFilePath] ?? null;
  }, [selectedFilePath, report, liveCache]);

  const activeTreeMeta = useMemo(
    () => report.treeNodes.find((n) => n.path === selectedFilePath),
    [report.treeNodes, selectedFilePath]
  );

  const matchingFilteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return report.treeNodes.filter(
      (n) =>
        n.type === 'file' &&
        (n.path.toLowerCase().includes(q) ||
          (n.purpose && n.purpose.toLowerCase().includes(q)) ||
          (n.language && n.language.toLowerCase().includes(q)))
    );
  }, [report.treeNodes, search]);

  const relatedComponents: ArchitectureComponentNode[] = useMemo(() => {
    if (!selectedFilePath) return [];
    return report.components.filter((c) => c.filePaths.includes(selectedFilePath));
  }, [report.components, selectedFilePath]);

  function toggleDir(dirPath: string) {
    setExpandedDirs((prev) => ({ ...prev, [dirPath]: !prev[dirPath] }));
  }

  function expandAllDirs() {
    const all: Record<string, boolean> = {};
    for (const p of allDirPaths) all[p] = true;
    setExpandedDirs(all);
  }

  function collapseAllDirs() {
    setExpandedDirs({});
  }

  async function handleCopyContent() {
    if (!activeFile?.content) return;
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable
    }
  }

  function renderTreeBranch(node: TreeBranchNode, depth: number): ReactNode {
    if (node.type === 'dir') {
      const isOpen = Boolean(expandedDirs[node.path]);
      return (
        <div key={node.path}>
          <button
            type="button"
            onClick={() => toggleDir(node.path)}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            className="w-full flex items-center gap-1.5 py-1.5 pr-2 text-left text-xs text-slate-300 hover:bg-slate-800/70 rounded transition-colors"
          >
            {isOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
            )}
            {isOpen ? (
              <FolderOpen className="w-3.5 h-3.5 text-blue-400 shrink-0" aria-hidden="true" />
            ) : (
              <Folder className="w-3.5 h-3.5 text-blue-400/80 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate font-medium">{node.name}</span>
            <span className="ml-auto text-[10px] font-mono text-slate-500 shrink-0">
              {node.children.length}
            </span>
          </button>
          {isOpen && node.children.map((child) => renderTreeBranch(child, depth + 1))}
        </div>
      );
    }

    const isSelected = selectedFilePath === node.path;
    const statusBadge = getStatusBadge(node.meta?.status);
    const isSensitive = node.meta?.status === 'sensitive';

    return (
      <button
        key={node.path}
        type="button"
        onClick={() => onSelectFilePath(node.path)}
        style={{ paddingLeft: `${24 + depth * 14}px` }}
        className={`w-full flex items-center gap-2 py-1.5 pr-2 text-left text-xs rounded transition-colors ${
          isSelected
            ? 'bg-blue-600/20 text-blue-200 border border-blue-500/35'
            : 'text-slate-300 hover:bg-slate-800/70 border border-transparent'
        }`}
      >
        {isSensitive ? (
          <Lock className="w-3.5 h-3.5 text-red-400 shrink-0" aria-hidden="true" />
        ) : node.meta?.language ? (
          <FileCode2 className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
        ) : (
          <FileText className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
        )}
        <span className="truncate font-mono text-[11.5px]">{node.name}</span>
        <span
          title={statusBadge.label}
          className={`ml-auto w-2 h-2 rounded-full shrink-0 ${statusBadge.dotClass}`}
        />
      </button>
    );
  }

  const lines = useMemo(() => {
    if (!activeFile?.content) return [];
    return activeFile.content.replace(/\r\n/g, '\n').split('\n');
  }, [activeFile?.content]);

  const statusInfo = getStatusBadge(activeTreeMeta?.status);

  return (
    <div className="bg-[#111827] border border-slate-800/90 rounded-lg overflow-hidden grid grid-cols-1 lg:grid-cols-12 min-h-[600px]">
      {/* Left Pane: Folder & File Tree */}
      <div className="lg:col-span-4 xl:col-span-3 border-b lg:border-b-0 lg:border-r border-slate-800/90 flex flex-col bg-[#0F172A]/60 max-h-[680px]">
        <div className="p-3 border-b border-slate-800/90 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-200">
              Repository Tree ({report.coverage.totalFiles.toLocaleString()} files)
            </span>
            <div className="flex items-center gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={expandAllDirs}
                className="text-slate-400 hover:text-slate-100 px-1.5 py-0.5 rounded bg-[#0B0F17] border border-slate-800"
              >
                Expand
              </button>
              <button
                type="button"
                onClick={collapseAllDirs}
                className="text-slate-400 hover:text-slate-100 px-1.5 py-0.5 rounded bg-[#0B0F17] border border-slate-800"
              >
                Collapse
              </button>
            </div>
          </div>

          <div className="relative">
            <Search
              className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search files by path or purpose..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#0B0F17] border border-slate-700/80 rounded-md text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400">
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Analyzed
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" /> Fetch on click
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500" /> Skipped/Binary
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {matchingFilteredFiles ? (
            matchingFilteredFiles.length === 0 ? (
              <div className="p-4 text-xs text-slate-500 text-center">
                No files matched "{search}".
              </div>
            ) : (
              matchingFilteredFiles.map((fileNode) => {
                const badge = getStatusBadge(fileNode.status);
                return (
                  <button
                    key={fileNode.path}
                    type="button"
                    onClick={() => onSelectFilePath(fileNode.path)}
                    className={`w-full text-left px-2.5 py-1.5 rounded text-xs flex items-center justify-between gap-2 ${
                      selectedFilePath === fileNode.path
                        ? 'bg-blue-600/20 text-blue-200 border border-blue-500/35'
                        : 'text-slate-300 hover:bg-slate-800/70'
                    }`}
                  >
                    <span className="font-mono text-[11px] truncate">{fileNode.path}</span>
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${badge.dotClass}`}
                      title={badge.label}
                    />
                  </button>
                );
              })
            )
          ) : (
            nestedTree.map((node) => renderTreeBranch(node, 0))
          )}
        </div>
      </div>

      {/* Right Pane: File Metadata & Line-Numbered Code Viewer */}
      <div className="lg:col-span-8 xl:col-span-9 flex flex-col bg-[#0B0F17] max-h-[680px]">
        {selectedFilePath ? (
          <>
            {/* File Metadata Bar */}
            <div className="p-4 border-b border-slate-800/90 bg-[#111827] space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-mono text-xs sm:text-sm font-semibold text-slate-100 break-all">
                      {selectedFilePath}
                    </h4>
                    <span className={`text-[11px] font-medium ${statusInfo.textClass}`}>
                      · {statusInfo.label}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 mt-1 flex flex-wrap items-center gap-2">
                    <span>{activeFile?.language || activeTreeMeta?.language || 'Text'}</span>
                    <span>·</span>
                    <span className="tabular-nums">
                      {formatBytes(activeFile?.size ?? activeTreeMeta?.size ?? 0)}
                    </span>
                    {activeFile && (
                      <>
                        <span>·</span>
                        <span className="tabular-nums">{activeFile.lineCount} lines</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setWrapLines((w) => !w)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-[11px] transition-colors ${
                      wrapLines
                        ? 'border-blue-500/50 bg-blue-500/15 text-blue-200'
                        : 'border-slate-700 bg-[#0B0F17] text-slate-300 hover:text-white'
                    }`}
                  >
                    <WrapText className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Wrap</span>
                  </button>
                  {activeFile?.content && (
                    <button
                      type="button"
                      onClick={() => void handleCopyContent()}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-700 bg-[#0B0F17] text-slate-300 hover:text-white text-[11px]"
                    >
                      {copied ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                      <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                  )}
                  <a
                    href={
                      activeFile?.htmlUrl ||
                      `${report.htmlUrl}/blob/${encodeURIComponent(report.branch)}/${selectedFilePath}`
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-700 bg-[#0B0F17] text-blue-300 hover:text-blue-200 text-[11px]"
                  >
                    <span>GitHub</span>
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                </div>
              </div>

              {(activeFile?.purpose || activeTreeMeta?.purpose) && (
                <div className="text-xs text-slate-300 bg-[#0B0F17] border border-slate-800 rounded px-3 py-2">
                  <span className="font-semibold text-blue-300 mr-1.5">File Purpose:</span>
                  <span>{activeFile?.purpose || activeTreeMeta?.purpose}</span>
                </div>
              )}

              {(relatedComponents.length > 0 || (activeFile?.symbols.length ?? 0) > 0) && (
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  {relatedComponents.map((comp) => (
                    <button
                      key={comp.id}
                      type="button"
                      onClick={() => onSelectComponent?.(comp.id)}
                      className="px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-blue-300 hover:bg-blue-500/20"
                    >
                      Component: {comp.name}
                    </button>
                  ))}
                  {activeFile?.symbols.slice(0, 6).map((sym) => (
                    <code
                      key={sym}
                      className="px-1.5 py-0.5 rounded bg-[#0B0F17] border border-slate-800 font-mono text-slate-300"
                    >
                      {sym}
                    </code>
                  ))}
                </div>
              )}
            </div>

            {/* Code Content Area */}
            <div className="flex-1 overflow-auto font-mono text-xs leading-relaxed">
              {loadingFile ? (
                <div className="h-full flex items-center justify-center gap-2 text-slate-400 p-8">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-400" aria-hidden="true" />
                  <span>Fetching source file from GitHub...</span>
                </div>
              ) : fileError ? (
                <div className="p-6 flex items-start gap-2.5 text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{fileError}</span>
                </div>
              ) : activeFile?.isBinary ? (
                <div className="p-6 text-slate-400">
                  Binary file detected; textual preview omitted.
                </div>
              ) : activeFile ? (
                <table className="w-full border-collapse">
                  <tbody>
                    {lines.map((lineText, idx) => (
                      <tr key={idx} className="hover:bg-slate-900/60">
                        <td className="select-none text-right pr-4 pl-4 py-0.5 text-slate-600 tabular-nums w-12 align-top border-r border-slate-800/60">
                          {idx + 1}
                        </td>
                        <td
                          className={`pl-4 pr-4 py-0.5 text-slate-200 align-top ${
                            wrapLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
                          }`}
                        >
                          {highlightCodeLine(lineText)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-6 text-slate-500">Select a file from the left tree to inspect.</div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-xs text-slate-500 p-8">
            Select a file from the repository structure to view its code and explanation.
          </div>
        )}
      </div>
    </div>
  );
}
