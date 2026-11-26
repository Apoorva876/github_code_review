import { jsPDF } from 'jspdf';
import type {
  IntelligenceDiagramSpec,
  RepositoryChatMessage,
  RepositoryIntelligenceReport,
} from '../types';
import { buildGroundedExplanations } from './explanationsBuilder';
import { renderPrintableMermaidPng } from './mermaidUtils';

export interface ReportExportOptions {
  chatMessages?: RepositoryChatMessage[];
  includeDiagramImages?: boolean;
}

function sanitizeFilename(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'repository-report';
}

function redactPossibleSecrets(text: string): string {
  return text
    .replace(/AIza[0-9A-Za-z_-]{16,}/g, '[REDACTED_KEY]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{10,}|github_pat_[A-Za-z0-9_]{16,})\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/(?:api[_-]?key|client_secret|access_token)\s*[:=]\s*[^\s,;&]+/gi, (m) => {
      const key = m.split(/[:=]/)[0].trim();
      return `${key}=[REDACTED]`;
    });
}

function buildDirectorySummaryLines(report: RepositoryIntelligenceReport): string[] {
  const counts = new Map<string, { total: number; analyzed: number; skipped: number; failed: number }>();
  for (const node of report.treeNodes) {
    if (node.type !== 'file') continue;
    const parts = node.path.split('/');
    const top = parts.length > 1 ? `${parts[0]}/` : '(root)';
    const entry = counts.get(top) ?? { total: 0, analyzed: 0, skipped: 0, failed: 0 };
    entry.total += 1;
    if (node.status === 'analyzed' || node.status === 'truncated') entry.analyzed += 1;
    else if (node.status === 'failed') entry.failed += 1;
    else entry.skipped += 1;
    counts.set(top, entry);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .map(
      ([dir, stat]) =>
        `- **\`${dir}\`** — ${stat.total} file(s) (${stat.analyzed} analyzed, ${stat.skipped} skipped, ${stat.failed} failed)`
    );
}

export function buildRepositoryMarkdownReport(
  report: RepositoryIntelligenceReport,
  options?: ReportExportOptions
): string {
  const explanations = buildGroundedExplanations(report);
  const keyFiles = Object.values(report.cachedFiles)
    .sort((a, b) => b.symbols.length - a.symbols.length || b.lineCount - a.lineCount)
    .slice(0, 60);
  const dirSummary = buildDirectorySummaryLines(report);

  const md: string[] = [];

  md.push(`# ${report.repositoryFullName} — CodeRubric Repository Intelligence Report`);
  md.push('');
  md.push(`- **Repository:** [${report.repositoryFullName}](${report.htmlUrl})`);
  md.push(`- **Branch:** \`${report.branch}\``);
  md.push(`- **Analyzed Commit SHA:** \`${report.analyzedCommitSha}\``);
  md.push(`- **Architecture Style:** ${report.overview.architectureStyle}`);
  md.push(`- **Primary Language:** ${report.language}`);
  md.push(`- **Generated At:** ${new Date(report.generatedAt).toUTCString()}`);
  md.push(`- **Analysis Status:** ${report.analysisStatus}`);
  md.push('');

  md.push('## 1. Repository Overview & Purpose');
  md.push('');
  md.push(`### ${report.overview.headline}`);
  md.push('');
  if (report.description) {
    md.push(`> ${report.description}`);
    md.push('');
  }
  md.push('#### Beginner Explanation');
  md.push(report.overview.simpleSummary);
  md.push('');
  md.push('#### Technical Explanation');
  md.push(report.overview.technicalSummary);
  md.push('');
  md.push(`**Detected Tech Stack:** ${report.overview.techStack.join(', ') || 'Not specified'}`);
  md.push('');
  md.push('**Key Entry Points:**');
  md.push(`- Frontend: ${report.overview.entryPoints.frontend.map((f) => `\`${f}\``).join(', ') || 'None detected'}`);
  md.push(`- Backend: ${report.overview.entryPoints.backend.map((f) => `\`${f}\``).join(', ') || 'None detected'}`);
  md.push(`- Config: ${report.overview.entryPoints.config.map((f) => `\`${f}\``).join(', ') || 'None detected'}`);
  md.push('');

  md.push('## 2. Repository Coverage & Honest Limitations');
  md.push('');
  md.push('| Metric | Count |');
  md.push('| --- | ---: |');
  md.push(`| Total Tree Entries | ${report.coverage.totalTreeEntries} |`);
  md.push(`| Total Directories | ${report.coverage.totalDirectories} |`);
  md.push(`| Total Files | ${report.coverage.totalFiles} |`);
  md.push(`| Eligible Source Files | ${report.coverage.eligibleFiles} |`);
  md.push(`| Analyzed Files | ${report.coverage.analyzedFiles} |`);
  md.push(`| Skipped Files | ${report.coverage.skippedFiles} |`);
  md.push(`| Failed Files | ${report.coverage.failedFiles} |`);
  md.push(`| Truncated Files | ${report.coverage.truncatedFiles} |`);
  md.push(`| AI Chunks Analyzed | ${report.coverage.totalChunksAnalyzed} |`);
  md.push('');
  if (report.coverage.limitations.length > 0) {
    md.push('**Coverage Limitations:**');
    for (const lim of report.coverage.limitations) {
      md.push(`- ${lim}`);
    }
    md.push('');
  }

  md.push('## 3. Folder Structure & Important Source Files');
  md.push('');
  if (dirSummary.length > 0) {
    md.push('### Top-Level Directory Breakdown');
    md.push(...dirSummary);
    md.push('');
  }
  if (keyFiles.length > 0) {
    md.push(`### Important Analyzed Files (${keyFiles.length}${Object.keys(report.cachedFiles).length > keyFiles.length ? ` of ${Object.keys(report.cachedFiles).length}` : ''})`);
    md.push('');
    md.push('| File Path | Layer | Language | Lines | Purpose |');
    md.push('| --- | --- | --- | ---: | --- |');
    for (const f of keyFiles) {
      md.push(
        `| \`${f.path}\` | ${f.layer} | ${f.language} | ${f.lineCount} | ${f.purpose.replace(/\|/g, '/').replace(/\n/g, ' ')} |`
      );
    }
    md.push('');
  }

  md.push('## 4. System Architecture');
  md.push('');
  md.push(`**Beginner Explanation:** ${report.systemArchitecture.simpleExplanation}`);
  md.push('');
  md.push(`**Technical Explanation:** ${report.systemArchitecture.technicalExplanation}`);
  md.push('');
  md.push('```mermaid');
  md.push(report.systemArchitecture.mermaidCode);
  md.push('```');
  md.push('');

  md.push('## 5. Beginner & Technical Component Explanations');
  md.push('');
  for (const item of explanations.filter((e) => e.category === 'components')) {
    md.push(`### ${item.title} (${item.categoryLabel})`);
    md.push(`- **Beginner Explanation:** ${item.beginnerExplanation}`);
    md.push(`- **Technical Explanation:** ${item.technicalExplanation}`);
    md.push(`- **Source Files:** ${item.filePaths.map((f) => `\`${f}\``).join(', ') || 'None mapped'}`);
    if (item.symbols.length > 0) {
      md.push(`- **Key Symbols:** ${item.symbols.map((s) => `\`${s}\``).join(', ')}`);
    }
    if (item.relationships.length > 0) {
      md.push(`- **Connections:** ${item.relationships.join('; ')}`);
    }
    md.push('');
  }

  md.push('## 6. Frontend Architecture');
  md.push('');
  md.push(report.frontendArchitecture.frameworkSummary);
  md.push('');
  md.push(`- **Entry Points:** ${report.frontendArchitecture.entryPoints.map((f) => `\`${f}\``).join(', ') || 'None'}`);
  md.push(`- **Pages & Views:** ${report.frontendArchitecture.pagesAndViews.map((f) => `\`${f}\``).join(', ') || 'None'}`);
  md.push(`- **State & Contexts:** ${report.frontendArchitecture.stateAndContexts.map((f) => `\`${f}\``).join(', ') || 'None'}`);
  md.push(`- **API Services:** ${report.frontendArchitecture.apiServiceFiles.map((f) => `\`${f}\``).join(', ') || 'None'}`);
  md.push('');
  md.push(`**Beginner Explanation:** ${report.frontendArchitecture.diagram.simpleExplanation}`);
  md.push('');
  md.push(`**Technical Explanation:** ${report.frontendArchitecture.diagram.technicalExplanation}`);
  md.push('');
  md.push('```mermaid');
  md.push(report.frontendArchitecture.diagram.mermaidCode);
  md.push('```');
  md.push('');

  md.push('## 7. Backend Architecture & API Endpoints');
  md.push('');
  md.push(report.backendArchitecture.runtimeSummary);
  md.push('');
  if (report.backendArchitecture.endpoints.length > 0) {
    md.push('| Method | Path | Handler | Source File | Purpose |');
    md.push('| --- | --- | --- | --- | --- |');
    for (const ep of report.backendArchitecture.endpoints) {
      md.push(
        `| ${ep.method} | \`${ep.path}\` | \`${ep.handler}\` | \`${ep.filePath}\` | ${ep.purpose.replace(/\|/g, '/')} |`
      );
    }
    md.push('');
  }
  md.push(`**Beginner Explanation:** ${report.backendArchitecture.diagram.simpleExplanation}`);
  md.push('');
  md.push(`**Technical Explanation:** ${report.backendArchitecture.diagram.technicalExplanation}`);
  md.push('');
  md.push('```mermaid');
  md.push(report.backendArchitecture.diagram.mermaidCode);
  md.push('```');
  md.push('');

  md.push('## 8. Frontend-to-Backend Communication Flow');
  md.push('');
  md.push(`**Beginner Explanation:** ${report.communicationOverviewDiagram.simpleExplanation}`);
  md.push('');
  md.push(`**Technical Explanation:** ${report.communicationOverviewDiagram.technicalExplanation}`);
  md.push('');
  md.push('```mermaid');
  md.push(report.communicationOverviewDiagram.mermaidCode);
  md.push('```');
  md.push('');
  for (const flow of report.communicationFlows) {
    md.push(`### ${flow.name}`);
    md.push(`- **User Action:** ${flow.userAction}`);
    md.push(`- **Frontend Component & Service:** ${flow.frontendComponent} → ${flow.frontendService}`);
    md.push(`- **HTTP Request → Backend Route:** ${flow.httpRequest} → ${flow.backendRoute}`);
    md.push(`- **Service & Data Layer:** ${flow.serviceLayer} → ${flow.databaseOrExternal}`);
    md.push(`- **Response & UI Update:** ${flow.responseFormat} → ${flow.stateUpdate} → ${flow.uiRendering}`);
    md.push(`- **Source Files:** ${flow.sourceFiles.map((f) => `\`${f}\``).join(', ')}`);
    md.push('');
  }

  md.push('## 9. API Integrations');
  md.push('');
  if (report.apiIntegrations.length === 0) {
    md.push('No external API integrations were detected in the collected source files.');
    md.push('');
  } else {
    for (const integ of report.apiIntegrations) {
      md.push(`### ${integ.provider} (${integ.kind})`);
      md.push(`- **Purpose:** ${integ.purpose}`);
      md.push(`- **Calling Location:** \`${integ.callingFile}\` (${integ.callingFunction})`);
      md.push(`- **Endpoint / Method:** \`${integ.endpointOrMethod}\``);
      md.push(`- **Request Flow:** ${integ.requestFlow}`);
      md.push(`- **Response Handling:** ${integ.responseHandling}`);
      md.push(
        `- **Referenced Env Var Names (Secrets Excluded):** ${
          integ.envVarNames.length > 0 ? integ.envVarNames.map((v) => `\`${v}\``).join(', ') : 'None'
        }`
      );
      md.push('');
    }
  }
  md.push('```mermaid');
  md.push(report.apiIntegrationsDiagram.mermaidCode);
  md.push('```');
  md.push('');

  md.push('## 10. Database Architecture');
  md.push('');
  md.push(report.databaseArchitecture.databaseTechSummary);
  md.push('');
  for (const entity of report.databaseArchitecture.entities) {
    md.push(`### ${entity.name} (${entity.kind}) — \`${entity.sourceFile}\``);
    if (entity.fields.length > 0) {
      md.push('| Field | Type | Key | Notes |');
      md.push('| --- | --- | --- | --- |');
      for (const field of entity.fields) {
        md.push(`| \`${field.name}\` | \`${field.type}\` | ${field.key || ''} | ${field.notes || ''} |`);
      }
    }
    if (entity.relationships.length > 0) {
      md.push(`- **Relationships:** ${entity.relationships.join('; ')}`);
    }
    if (entity.accessorFunctions.length > 0) {
      md.push(`- **Accessors:** ${entity.accessorFunctions.map((fn) => `\`${fn}\``).join(', ')}`);
    }
    md.push('');
  }
  md.push('```mermaid');
  md.push(report.databaseArchitecture.diagram.mermaidCode);
  md.push('```');
  md.push('');

  md.push('## 11. Authentication Flow');
  md.push('');
  md.push(report.authenticationFlow.authSummary);
  md.push('');
  if (report.authenticationFlow.steps.length > 0) {
    for (const step of report.authenticationFlow.steps) {
      md.push(
        `${step.step}. **${step.actor}** — ${step.action} (\`${step.filePath}\`): ${step.detail}`
      );
    }
    md.push('');
  }
  md.push('```mermaid');
  md.push(report.authenticationFlow.diagram.mermaidCode);
  md.push('```');
  md.push('');

  md.push('## 12. Application Execution Workflows');
  md.push('');
  for (const wf of report.applicationWorkflows) {
    md.push(`### ${wf.title}`);
    md.push(`- **Beginner Explanation:** ${wf.simpleExplanation}`);
    md.push(`- **Technical Explanation:** ${wf.technicalExplanation}`);
    md.push(`- **Source Files:** ${wf.sourceFiles.map((f) => `\`${f}\``).join(', ') || 'None'}`);
    md.push('');
    md.push('```mermaid');
    md.push(wf.mermaidCode);
    md.push('```');
    md.push('');
  }

  if (options?.chatMessages && options.chatMessages.length > 0) {
    md.push('## 13. Ask Your Repository — Q&A Session Transcript');
    md.push('');
    for (const msg of options.chatMessages) {
      md.push(`### ${msg.role === 'user' ? 'Question' : 'Grounded Answer'} (${new Date(msg.createdAt).toLocaleString()})`);
      md.push(msg.content);
      if (msg.references.length > 0) {
        md.push(
          `**Source References:** ${msg.references
            .map((r) => `\`${r.filePath}\`${r.symbol ? ` (${r.symbol})` : ''}`)
            .join(', ')}`
        );
      }
      md.push('');
    }
  }

  return redactPossibleSecrets(md.join('\n'));
}

export function downloadMarkdownReport(
  report: RepositoryIntelligenceReport,
  options?: ReportExportOptions
): string {
  const markdown = buildRepositoryMarkdownReport(report, options);
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const filename = `${sanitizeFilename(report.repositoryFullName)}-intelligence-report.md`;

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

export async function buildRepositoryPdfDocument(
  report: RepositoryIntelligenceReport,
  options?: ReportExportOptions
): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
    compress: true,
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 46;
  const contentW = pageWidth - marginX * 2;
  const topY = 58;
  const bottomLimit = pageHeight - 54;
  let y = topY;

  const tocEntries: Array<{ title: string; page: number }> = [];

  function ensureSpace(requiredHeight: number) {
    if (y + requiredHeight > bottomLimit) {
      doc.addPage();
      y = topY;
    }
  }

  function addSectionHeading(numTitle: string) {
    if (y > topY + 60) {
      doc.addPage();
      y = topY;
    }
    const currentPage = doc.getNumberOfPages();
    tocEntries.push({ title: numTitle, page: currentPage });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(15, 23, 42);
    doc.text(numTitle, marginX, y);
    y += 8;
    doc.setDrawColor(37, 99, 235);
    doc.setLineWidth(1.2);
    doc.line(marginX, y, marginX + contentW, y);
    y += 16;
  }

  function addSubheading(text: string) {
    ensureSpace(28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    const lines = doc.splitTextToSize(redactPossibleSecrets(text), contentW);
    doc.text(lines, marginX, y);
    y += lines.length * 14 + 4;
  }

  function addParagraph(text: string, options?: { muted?: boolean; indent?: number }) {
    const clean = redactPossibleSecrets(text || '').trim();
    if (!clean) return;
    const indent = options?.indent ?? 0;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    if (options?.muted) {
      doc.setTextColor(71, 85, 105);
    } else {
      doc.setTextColor(30, 41, 59);
    }
    const lines = doc.splitTextToSize(clean, contentW - indent);
    const lineHeight = 13;
    for (let i = 0; i < lines.length; i += 1) {
      ensureSpace(lineHeight + 4);
      doc.text(lines[i], marginX + indent, y);
      y += lineHeight;
    }
    y += 6;
  }

  function addLabeledBlock(label: string, body: string, accentRgb: [number, number, number]) {
    const clean = redactPossibleSecrets(body || '').trim();
    if (!clean) return;
    const textLines = doc.splitTextToSize(clean, contentW - 18);
    const boxHeight = Math.max(34, 22 + textLines.length * 12.5);

    if (boxHeight < bottomLimit - topY) {
      ensureSpace(boxHeight + 8);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(marginX, y - 4, contentW, boxHeight, 4, 4, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.text(label.toUpperCase(), marginX + 10, y + 10);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.2);
      doc.setTextColor(30, 41, 59);
      doc.text(textLines, marginX + 10, y + 24);
      y += boxHeight + 10;
    } else {
      addSubheading(label);
      addParagraph(clean);
    }
  }

  function addBulletList(items: string[], maxItems = 40) {
    for (const item of items.slice(0, maxItems)) {
      const clean = redactPossibleSecrets(item).trim();
      if (!clean) continue;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.2);
      doc.setTextColor(30, 41, 59);
      const lines = doc.splitTextToSize(`• ${clean}`, contentW - 8);
      ensureSpace(lines.length * 12.5 + 4);
      doc.text(lines, marginX + 6, y);
      y += lines.length * 12.5 + 3;
    }
    if (items.length > maxItems) {
      addParagraph(`...and ${items.length - maxItems} additional entries.`, { muted: true });
    }
    y += 4;
  }

  async function addDiagramSection(spec: IntelligenceDiagramSpec, labelPrefix?: string) {
    addSubheading(labelPrefix ? `${labelPrefix}: ${spec.title}` : spec.title);
    addLabeledBlock('Beginner Explanation', spec.simpleExplanation, [37, 99, 235]);
    addLabeledBlock('Technical Explanation', spec.technicalExplanation, [124, 58, 237]);

    const includeImg = options?.includeDiagramImages !== false;
    const png = includeImg ? await renderPrintableMermaidPng(spec.mermaidCode) : null;

    if (png) {
      const maxImgW = contentW;
      const maxImgH = 290;
      const ratio = Math.min(maxImgW / png.width, maxImgH / png.height, 1);
      const drawW = png.width * ratio;
      const drawH = png.height * ratio;
      ensureSpace(drawH + 26);

      doc.setDrawColor(203, 213, 225);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(marginX, y, contentW, drawH + 16, 4, 4, 'FD');
      const offsetX = marginX + (contentW - drawW) / 2;
      doc.addImage(png.dataUrl, 'PNG', offsetX, y + 8, drawW, drawH);
      y += drawH + 26;
    } else {
      // Crisp text fallback so diagram flow is always readable in PDF
      const codeLines = redactPossibleSecrets(spec.mermaidCode)
        .split('\n')
        .slice(0, 18);
      const boxH = Math.max(40, 20 + codeLines.length * 10.5);
      ensureSpace(boxH + 10);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(marginX, y, contentW, boxH, 4, 4, 'FD');
      doc.setFont('courier', 'normal');
      doc.setFontSize(7.8);
      doc.setTextColor(51, 65, 85);
      doc.text(codeLines, marginX + 10, y + 14);
      y += boxH + 12;
    }

    if (spec.sourceFiles.length > 0) {
      addParagraph(`Referenced Files: ${spec.sourceFiles.slice(0, 10).join(', ')}`, {
        muted: true,
      });
    }
  }

  // ===================== PAGE 1: TITLE PAGE =====================
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 210, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(96, 165, 250);
  doc.text('CODERUBRIC  ·  AI REPOSITORY INTELLIGENCE REPORT', marginX, 62);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  const titleLines = doc.splitTextToSize(report.repositoryFullName, contentW);
  doc.text(titleLines, marginX, 100);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(203, 213, 225);
  const subLines = doc.splitTextToSize(report.overview.headline, contentW);
  doc.text(subLines, marginX, 134);

  y = 248;

  // Metadata summary grid on Title Page
  const metaRows = [
    ['Repository URL', report.htmlUrl],
    ['Branch / Commit SHA', `${report.branch} · ${report.analyzedCommitSha.slice(0, 12)}`],
    ['Architecture Style', report.overview.architectureStyle],
    ['Primary Language', report.language || 'Mixed'],
    ['Generated At', new Date(report.generatedAt).toUTCString()],
    ['Analysis Status', `${report.analysisStatus.toUpperCase()} (${report.coverage.analyzedFiles}/${report.coverage.totalFiles} files analyzed)`],
  ];

  for (const [k, v] of metaRows) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(71, 85, 105);
    doc.text(k, marginX, y);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    const valLines = doc.splitTextToSize(redactPossibleSecrets(v), contentW - 140);
    doc.text(valLines, marginX + 140, y);
    y += Math.max(18, valLines.length * 13 + 5);
  }

  y += 14;
  addLabeledBlock('Executive Beginner Summary', report.overview.simpleSummary, [37, 99, 235]);
  addLabeledBlock('Executive Technical Summary', report.overview.technicalSummary, [124, 58, 237]);

  // ===================== PAGE 2: RESERVED TABLE OF CONTENTS =====================
  doc.addPage();
  const tocPageNumber = doc.getNumberOfPages();

  // ===================== PAGE 3+: CONTENT SECTIONS =====================
  doc.addPage();
  y = topY;

  // Section 1: Repository Overview & Coverage
  addSectionHeading('1. Repository Overview & Coverage Accounting');
  addParagraph(report.description || report.overview.headline);
  addSubheading('Detected Technology Stack & Entry Points');
  addBulletList([
    `Tech Stack: ${report.overview.techStack.join(', ') || 'Detected from project manifests'}`,
    `Frontend Entry Points: ${report.overview.entryPoints.frontend.join(', ') || 'None detected'}`,
    `Backend Entry Points: ${report.overview.entryPoints.backend.join(', ') || 'None detected'}`,
    `Configuration Files: ${report.overview.entryPoints.config.join(', ') || 'None detected'}`,
  ]);

  addSubheading('Repository Coverage & Verification Metrics');
  addBulletList([
    `Total Tree Entries: ${report.coverage.totalTreeEntries} (${report.coverage.totalDirectories} directories, ${report.coverage.totalFiles} files)`,
    `Eligible Source Files: ${report.coverage.eligibleFiles}`,
    `Analyzed Files: ${report.coverage.analyzedFiles} (${report.coverage.totalChunksAnalyzed} AI chunks)`,
    `Skipped Files: ${report.coverage.skippedFiles}`,
    `Failed Retrieval Files: ${report.coverage.failedFiles}`,
    `Truncated Large Files: ${report.coverage.truncatedFiles}`,
  ]);

  if (report.coverage.limitations.length > 0) {
    addSubheading('Explicit Coverage Limitations');
    addBulletList(report.coverage.limitations);
  }

  // Section 2: Folder Structure & Key Files
  addSectionHeading('2. Folder Structure & Important Source Files');
  addSubheading('Top-Level Directory Summary');
  addBulletList(
    buildDirectorySummaryLines(report).map((line) => line.replace(/[*`]/g, '')),
    24
  );

  const topCachedFiles = Object.values(report.cachedFiles)
    .sort((a, b) => b.symbols.length - a.symbols.length || b.lineCount - a.lineCount)
    .slice(0, 45);
  if (topCachedFiles.length > 0) {
    addSubheading(`Key Analyzed Files (${topCachedFiles.length} shown)`);
    addBulletList(
      topCachedFiles.map(
        (f) => `${f.path} [${f.layer} · ${f.language} · ${f.lineCount}L] — ${f.purpose}`
      ),
      45
    );
  }

  // Section 3: System Architecture
  addSectionHeading('3. System Architecture');
  await addDiagramSection(report.systemArchitecture);

  // Section 4: Beginner & Technical Component Explanations
  addSectionHeading('4. AI Component Explanations (Beginner & Technical)');
  const explanations = buildGroundedExplanations(report);
  const compExplanations = explanations.filter((e) => e.category === 'components');
  for (const item of compExplanations.slice(0, 20)) {
    addSubheading(`${item.title} (${item.subtitle})`);
    addLabeledBlock('Beginner Explanation', item.beginnerExplanation, [37, 99, 235]);
    addLabeledBlock('Technical Explanation', item.technicalExplanation, [124, 58, 237]);
    if (item.filePaths.length > 0) {
      addParagraph(`Files: ${item.filePaths.join(', ')}`, { muted: true });
    }
  }

  // Section 5: Frontend Architecture
  addSectionHeading('5. Frontend Architecture');
  addParagraph(report.frontendArchitecture.frameworkSummary);
  await addDiagramSection(report.frontendArchitecture.diagram);

  // Section 6: Backend Architecture & Endpoints
  addSectionHeading('6. Backend Architecture & API Endpoints');
  addParagraph(report.backendArchitecture.runtimeSummary);
  if (report.backendArchitecture.endpoints.length > 0) {
    addSubheading(`Detected API Endpoints (${report.backendArchitecture.endpoints.length})`);
    addBulletList(
      report.backendArchitecture.endpoints.map(
        (ep) => `${ep.method} ${ep.path} → ${ep.handler} (${ep.filePath}) — ${ep.purpose}`
      ),
      40
    );
  }
  await addDiagramSection(report.backendArchitecture.diagram);

  // Section 7: Frontend-Backend Communication Flows
  addSectionHeading('7. Frontend-Backend Communication Flows');
  await addDiagramSection(report.communicationOverviewDiagram);
  for (const flow of report.communicationFlows.slice(0, 6)) {
    addSubheading(flow.name);
    addLabeledBlock('Beginner Flow', flow.simpleExplanation || flow.userAction, [37, 99, 235]);
    addLabeledBlock(
      'Technical Trace',
      `${flow.frontendComponent} -> ${flow.frontendService} -> ${flow.httpRequest} -> ${flow.backendRoute} -> ${flow.serviceLayer} -> ${flow.databaseOrExternal} -> ${flow.stateUpdate}`,
      [124, 58, 237]
    );
  }

  // Section 8: External API & AI Integrations
  addSectionHeading('8. External API & AI Integrations');
  if (report.apiIntegrations.length === 0) {
    addParagraph('No external REST or AI SDK integrations were detected in the analyzed source files.');
  } else {
    for (const integ of report.apiIntegrations) {
      addSubheading(`${integ.provider} (${integ.kind})`);
      addBulletList([
        `Purpose: ${integ.purpose}`,
        `Called From: ${integ.callingFile} (${integ.callingFunction})`,
        `Endpoint / Method: ${integ.endpointOrMethod}`,
        `Env Var Names (Secrets Excluded): ${integ.envVarNames.join(', ') || 'None'}`,
      ]);
    }
  }
  await addDiagramSection(report.apiIntegrationsDiagram);

  // Section 9: Database Architecture
  addSectionHeading('9. Database & Persistence Architecture');
  addParagraph(report.databaseArchitecture.databaseTechSummary);
  for (const entity of report.databaseArchitecture.entities.slice(0, 18)) {
    addSubheading(`${entity.name} (${entity.kind}) — ${entity.sourceFile}`);
    if (entity.fields.length > 0) {
      addParagraph(
        `Fields: ${entity.fields
          .slice(0, 16)
          .map((f) => `${f.name}:${f.type}${f.key ? `[${f.key}]` : ''}`)
          .join(', ')}`
      );
    }
    if (entity.relationships.length > 0) {
      addParagraph(`Relationships: ${entity.relationships.join('; ')}`, { muted: true });
    }
  }
  await addDiagramSection(report.databaseArchitecture.diagram);

  // Section 10: Authentication Flow
  addSectionHeading('10. Authentication & Access Control Flow');
  addParagraph(report.authenticationFlow.authSummary);
  if (report.authenticationFlow.steps.length > 0) {
    addBulletList(
      report.authenticationFlow.steps.map(
        (s) => `Step ${s.step} (${s.actor}): ${s.action} [${s.filePath}] — ${s.detail}`
      )
    );
  }
  await addDiagramSection(report.authenticationFlow.diagram);

  // Section 11: Application Execution Workflows & Conclusion
  addSectionHeading('11. Application Execution Workflows & Conclusion');
  for (const wf of report.applicationWorkflows.slice(0, 6)) {
    await addDiagramSection(wf);
  }
  addSubheading('Conclusion & Limitations');
  addParagraph(
    `This architectural documentation report was generated dynamically from verified source files in ${report.repositoryFullName} (${report.branch} @ ${report.analyzedCommitSha.slice(0, 10)}). Covered ${report.coverage.analyzedFiles} of ${report.coverage.totalFiles} files.`
  );

  // ===================== POPULATE TABLE OF CONTENTS ON PAGE 2 =====================
  doc.setPage(tocPageNumber);
  let tocY = topY;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('Table of Contents', marginX, tocY);
  tocY += 10;
  doc.setDrawColor(37, 99, 235);
  doc.setLineWidth(1.2);
  doc.line(marginX, tocY, marginX + contentW, tocY);
  tocY += 22;

  for (const entry of tocEntries) {
    if (tocY > bottomLimit - 16) break;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(30, 41, 59);
    doc.text(entry.title, marginX, tocY);

    doc.setFont('courier', 'bold');
    doc.setTextColor(37, 99, 235);
    doc.text(`Page ${entry.page}`, marginX + contentW, tocY, { align: 'right' });

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(marginX, tocY + 5, marginX + contentW, tocY + 5);
    tocY += 22;
  }

  // ===================== RUNNING HEADERS & FOOTERS ON PAGES 2..N =====================
  const totalPages = doc.getNumberOfPages();
  for (let p = 2; p <= totalPages; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `${report.repositoryFullName} — Repository Intelligence Report`,
      marginX,
      30
    );
    doc.text(
      `Commit ${report.analyzedCommitSha.slice(0, 8)} · Page ${p} of ${totalPages}`,
      marginX + contentW,
      pageHeight - 28,
      { align: 'right' }
    );
    doc.text('Generated by CodeRubric', marginX, pageHeight - 28);
  }

  return doc;
}

export async function downloadPdfReport(
  report: RepositoryIntelligenceReport,
  options?: ReportExportOptions
): Promise<string> {
  const doc = await buildRepositoryPdfDocument(report, options);
  const filename = `${sanitizeFilename(report.repositoryFullName)}-intelligence-report.pdf`;
  doc.save(filename);
  return filename;
}
