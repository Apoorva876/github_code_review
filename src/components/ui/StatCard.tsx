import { ArrowUpRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  numericValue?: number;
  suffix?: string;
  decimals?: number;
  detail: string;
  emphasis?: 'default' | 'warning' | 'positive' | 'violet';
  onClick?: () => void;
  actionLabel?: string;
}

function useAnimatedNumber(target: number | undefined, decimals = 0): number | undefined {
  const [display, setDisplay] = useState<number | undefined>(target);
  const prevRef = useRef<number>(target ?? 0);

  useEffect(() => {
    if (target === undefined || !Number.isFinite(target)) {
      setDisplay(target);
      return;
    }

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      prevRef.current = target;
      setDisplay(target);
      return;
    }

    const startVal = prevRef.current;
    const delta = target - startVal;
    if (Math.abs(delta) < 0.01) {
      prevRef.current = target;
      setDisplay(target);
      return;
    }

    let rafId = 0;
    const durationMs = 420;
    const startTime = performance.now();

    function step(now: number) {
      const elapsed = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      const current = startVal + delta * eased;
      const factor = Math.pow(10, decimals);
      setDisplay(Math.round(current * factor) / factor);
      if (elapsed < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        prevRef.current = target!;
        setDisplay(target);
      }
    }

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [target, decimals]);

  return display;
}

export function StatCard({
  label,
  value,
  numericValue,
  suffix = '',
  decimals = 0,
  detail,
  emphasis = 'default',
  onClick,
  actionLabel,
}: StatCardProps) {
  const animated = useAnimatedNumber(numericValue, decimals);

  const detailColor =
    emphasis === 'warning'
      ? 'text-amber-400'
      : emphasis === 'positive'
        ? 'text-emerald-400'
        : emphasis === 'violet'
          ? 'text-purple-400'
          : 'text-slate-400';

  const renderedValue =
    animated !== undefined
      ? `${decimals > 0 ? animated.toFixed(decimals) : animated.toLocaleString()}${suffix}`
      : value;

  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-slate-400">{label}</span>
        {onClick && (
          <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-slate-500 group-hover:text-blue-400 transition-colors">
            {actionLabel && <span className="hidden sm:inline">{actionLabel}</span>}
            <ArrowUpRight className="w-3.5 h-3.5 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
          </span>
        )}
      </div>
      <div className="text-[28px] leading-tight font-semibold tracking-tight text-slate-50 font-mono tabular-nums">
        {renderedValue}
      </div>
      <div className={`text-xs ${detailColor} tabular-nums`}>{detail}</div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group w-full text-left bg-[#111827] hover:bg-[#141D2F] border border-slate-800/90 hover:border-blue-500/40 rounded-lg p-5 flex flex-col justify-between gap-3 transition-all duration-150 focus-visible:outline-2 focus-visible:outline-blue-400"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 flex flex-col justify-between gap-3">
      {content}
    </div>
  );
}
