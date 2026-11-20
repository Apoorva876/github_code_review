import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  XCircle,
} from 'lucide-react';
import type { ReviewStatus, Severity } from '../../types';
import {
  getSeverityColorClass,
  getSeverityLabel,
  getStatusColorClass,
  getStatusLabel,
} from '../../utils/formatters';

export function SeverityText({ severity }: { severity: Severity }) {
  const color = getSeverityColorClass(severity);
  const label = getSeverityLabel(severity);

  const Icon =
    severity === 'critical'
      ? AlertOctagon
      : severity === 'high'
        ? AlertTriangle
        : severity === 'medium'
          ? Info
          : Info;

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${color}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function StatusText({ status }: { status: ReviewStatus }) {
  const color = getStatusColorClass(status);
  const label = getStatusLabel(status);

  const Icon =
    status === 'approved'
      ? CheckCircle2
      : status === 'changes_requested'
        ? XCircle
        : Clock;

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${color}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
