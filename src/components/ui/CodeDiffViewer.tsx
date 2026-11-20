interface CodeDiffViewerProps {
  diff: string;
}

export function CodeDiffViewer({ diff }: CodeDiffViewerProps) {
  const lines = diff.split('\n');

  return (
    <div className="bg-[#0B0F17] border border-slate-800 rounded-md overflow-x-auto">
      <div className="min-w-[540px] py-2 font-mono text-xs leading-6">
        {lines.map((line, index) => {
          const isAdd = line.startsWith('+') && !line.startsWith('+++');
          const isDel = line.startsWith('-') && !line.startsWith('---');
          const isHunk = line.startsWith('@@');
          const isHeader =
            line.startsWith('diff --git') ||
            line.startsWith('index ') ||
            line.startsWith('--- ') ||
            line.startsWith('+++ ');

          const rowClass = isAdd
            ? 'bg-emerald-500/10 text-emerald-200'
            : isDel
              ? 'bg-red-500/10 text-red-200'
              : isHunk
                ? 'bg-blue-500/10 text-blue-300'
                : isHeader
                  ? 'text-slate-400 font-medium'
                  : 'text-slate-300';

          return (
            <div key={index} className={`flex px-3 ${rowClass}`}>
              <span className="w-10 shrink-0 select-none text-right pr-3 text-slate-600 tabular-nums">
                {index + 1}
              </span>
              <span className="whitespace-pre">{line || ' '}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
