import type { RepositoryIntelligenceReport } from '../types';

export type ExplanationCategory =
  | 'components'
  | 'folders-files'
  | 'frontend'
  | 'backend'
  | 'integrations'
  | 'database'
  | 'auth'
  | 'workflows';

export interface StructuredExplanationItem {
  id: string;
  category: ExplanationCategory;
  categoryLabel: string;
  title: string;
  subtitle: string;
  confidence: 'confirmed' | 'inferred';
  beginnerExplanation: string;
  technicalExplanation: string;
  filePaths: string[];
  symbols: string[];
  relationships: string[];
}

function uniqueStrings(items: string[], max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

export function buildGroundedExplanations(
  report: RepositoryIntelligenceReport
): StructuredExplanationItem[] {
  const items: StructuredExplanationItem[] = [];
  const componentById = new Map(report.components.map((c) => [c.id, c]));

  // 1. Architecture Diagram Nodes & Modules
  for (const comp of report.components) {
    const connectedNames = comp.connectedIds
      .map((id) => componentById.get(id)?.name || id)
      .filter(Boolean);

    items.push({
      id: `exp-comp-${comp.id}`,
      category: 'components',
      categoryLabel: 'Architecture Component',
      title: comp.name,
      subtitle: `${comp.category} module · ${comp.filePaths.length} mapped file(s)`,
      confidence: comp.confidence,
      beginnerExplanation:
        comp.simpleExplanation ||
        `${comp.name} handles ${comp.purpose.toLowerCase()} so other parts of the application can stay organized.`,
      technicalExplanation:
        comp.technicalExplanation ||
        `${comp.purpose}${comp.symbols.length > 0 ? ` Exposes symbols: ${comp.symbols.join(', ')}.` : ''}`,
      filePaths: uniqueStrings(comp.filePaths, 10),
      symbols: uniqueStrings(comp.symbols, 12),
      relationships: connectedNames.map((n) => `Connects to ${n}`),
    });
  }

  // 2. Important Folders (top-level and primary source directories)
  const dirChildren = new Map<string, string[]>();
  for (const node of report.treeNodes) {
    if (node.type !== 'file') continue;
    const parts = node.path.split('/');
    const topDir = parts.length > 1 ? parts[0] : '(root)';
    const list = dirChildren.get(topDir) ?? [];
    list.push(node.path);
    dirChildren.set(topDir, list);
  }

  const topDirs = Array.from(dirChildren.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10);

  for (const [dirName, files] of topDirs) {
    const sampleCached = files
      .map((fp) => report.cachedFiles[fp])
      .filter(Boolean)
      .slice(0, 6);
    const samplePurposes = sampleCached.map((f) => `${f.path}: ${f.purpose}`).join('; ');

    items.push({
      id: `exp-dir-${dirName}`,
      category: 'folders-files',
      categoryLabel: 'Important Folder',
      title: dirName === '(root)' ? 'Repository Root Directory' : `${dirName}/`,
      subtitle: `${files.length} file(s) discovered in tree`,
      confidence: 'confirmed',
      beginnerExplanation:
        dirName === '(root)'
          ? `The root folder holds the main configuration, documentation, and startup files (${files.slice(0, 4).join(', ')}).`
          : `The "${dirName}/" folder groups ${files.length} related files (${sampleCached[0]?.layer || 'module'} responsibility) so developers can easily find that part of the project.`,
      technicalExplanation: samplePurposes
        ? `Contains ${files.length} files. Analyzed files in this folder include: ${samplePurposes}.`
        : `Contains ${files.length} repository entries including ${files.slice(0, 5).join(', ')}.`,
      filePaths: uniqueStrings(files, 8),
      symbols: uniqueStrings(sampleCached.flatMap((f) => f.symbols), 10),
      relationships: [],
    });
  }

  // 3. Key Analyzed Source Files
  const importantCachedFiles = Object.values(report.cachedFiles)
    .sort((a, b) => b.symbols.length - a.symbols.length || b.lineCount - a.lineCount)
    .slice(0, 18);

  for (const file of importantCachedFiles) {
    const relComps = file.relatedComponentIds
      .map((cid) => componentById.get(cid)?.name || cid)
      .filter(Boolean);

    items.push({
      id: `exp-file-${file.path}`,
      category: 'folders-files',
      categoryLabel: 'Source File',
      title: file.path,
      subtitle: `${file.language} · ${file.layer} layer · ${file.lineCount} lines`,
      confidence: 'confirmed',
      beginnerExplanation: `${file.purpose} (located in the ${file.layer} part of the application).`,
      technicalExplanation: `Implemented in ${file.language} (${file.lineCount} lines). Defined symbols: ${
        file.symbols.length > 0 ? file.symbols.join(', ') : 'top-level module/config exports'
      }.${relComps.length > 0 ? ` Participates in components: ${relComps.join(', ')}.` : ''}`,
      filePaths: [file.path],
      symbols: uniqueStrings(file.symbols, 12),
      relationships: relComps.map((name) => `Part of ${name}`),
    });
  }

  // 4. Frontend Pages, State & Services
  if (report.frontendArchitecture.hasFrontend) {
    const fe = report.frontendArchitecture;
    items.push({
      id: 'exp-frontend-overview',
      category: 'frontend',
      categoryLabel: 'Frontend Architecture',
      title: 'Frontend UI & Client State Layer',
      subtitle: fe.frameworkSummary,
      confidence: fe.diagram.confidence,
      beginnerExplanation: fe.diagram.simpleExplanation,
      technicalExplanation: fe.diagram.technicalExplanation,
      filePaths: uniqueStrings(
        [
          ...fe.entryPoints,
          ...fe.rootComponents,
          ...fe.pagesAndViews,
          ...fe.stateAndContexts,
          ...fe.apiServiceFiles,
        ],
        12
      ),
      symbols: [],
      relationships: fe.apiServiceFiles.map((f) => `Sends API requests via ${f}`),
    });
  }

  // 5. Backend Routes & Services
  if (report.backendArchitecture.hasBackend) {
    const be = report.backendArchitecture;
    items.push({
      id: 'exp-backend-overview',
      category: 'backend',
      categoryLabel: 'Backend Runtime',
      title: 'Server Entry, Middleware & Service Layer',
      subtitle: be.runtimeSummary,
      confidence: be.diagram.confidence,
      beginnerExplanation: be.diagram.simpleExplanation,
      technicalExplanation: be.diagram.technicalExplanation,
      filePaths: uniqueStrings(
        [
          ...be.serverEntryPoints,
          ...be.middlewareFiles,
          ...be.routeAndControllerFiles,
          ...be.serviceFiles,
        ],
        12
      ),
      symbols: uniqueStrings(be.endpoints.map((e) => e.handler), 10),
      relationships: be.databaseLayerFiles.map((f) => `Reads/writes data via ${f}`),
    });

    for (const ep of be.endpoints.slice(0, 16)) {
      items.push({
        id: `exp-endpoint-${ep.method}-${ep.path}`,
        category: 'backend',
        categoryLabel: 'API Endpoint',
        title: `${ep.method} ${ep.path}`,
        subtitle: `Handler: ${ep.handler} · ${ep.authRequired ? 'Auth Required' : 'Public / Route-scoped'}`,
        confidence: 'confirmed',
        beginnerExplanation: `When the app calls ${ep.method} ${ep.path}, the backend performs: ${ep.purpose.toLowerCase()}.`,
        technicalExplanation: `Route ${ep.method} ${ep.path} defined in ${ep.filePath}, dispatched to handler "${ep.handler}". ${
          ep.authRequired
            ? 'Protected by authentication checks before executing.'
            : 'Accessible based on route middleware configuration.'
        }`,
        filePaths: ep.filePath ? [ep.filePath] : [],
        symbols: ep.handler ? [ep.handler] : [],
        relationships: [],
      });
    }
  }

  // 6. API Integrations
  for (const integ of report.apiIntegrations) {
    items.push({
      id: `exp-integ-${integ.id}`,
      category: 'integrations',
      categoryLabel: 'API Integration',
      title: integ.provider,
      subtitle: `${integ.kind} · ${integ.callingFile}`,
      confidence: integ.confidence,
      beginnerExplanation: `${integ.provider} is connected so the app can ${integ.purpose.toLowerCase()}.`,
      technicalExplanation: `Initialized via ${integ.clientInitialization || integ.callingFunction} in ${integ.callingFile} (${integ.endpointOrMethod}). Request flow: ${integ.requestFlow}. Response handling: ${integ.responseHandling}.${
        integ.envVarNames.length > 0
          ? ` Uses env vars: ${integ.envVarNames.join(', ')}.`
          : ''
      }`,
      filePaths: integ.callingFile ? [integ.callingFile] : [],
      symbols: integ.callingFunction ? [integ.callingFunction] : [],
      relationships: integ.envVarNames.map((v) => `Reads config env ${v}`),
    });
  }

  // 7. Database Tables / Entities
  for (const entity of report.databaseArchitecture.entities) {
    const fieldNames = entity.fields.map((f) => `${f.name} (${f.type})`);
    items.push({
      id: `exp-db-${entity.name}`,
      category: 'database',
      categoryLabel: 'Database Entity',
      title: entity.name,
      subtitle: `${entity.kind} · ${entity.fields.length} fields · ${entity.sourceFile}`,
      confidence: entity.confidence,
      beginnerExplanation: `The "${entity.name}" ${entity.kind} stores structured records with fields like ${
        fieldNames.slice(0, 4).join(', ') || 'defined schema attributes'
      }.`,
      technicalExplanation: `Defined in ${entity.sourceFile} as a ${entity.kind}. Fields: ${
        fieldNames.join(', ') || 'inferred schema'
      }.${entity.accessorFunctions.length > 0 ? ` Accessed via: ${entity.accessorFunctions.join(', ')}.` : ''}${
        entity.relationships.length > 0 ? ` Relationships: ${entity.relationships.join('; ')}.` : ''
      }`,
      filePaths: entity.sourceFile ? [entity.sourceFile] : [],
      symbols: uniqueStrings(entity.accessorFunctions, 10),
      relationships: entity.relationships,
    });
  }

  // 8. Authentication Flow
  if (report.authenticationFlow.hasAuthentication) {
    const authFlow = report.authenticationFlow;
    items.push({
      id: 'exp-auth-main',
      category: 'auth',
      categoryLabel: 'Authentication Flow',
      title: `Authentication (${authFlow.providers.join(', ') || 'Configured Providers'})`,
      subtitle: `${authFlow.steps.length} traced verification steps`,
      confidence: authFlow.diagram.confidence,
      beginnerExplanation: authFlow.diagram.simpleExplanation || authFlow.authSummary,
      technicalExplanation: `${authFlow.authSummary} Token/session handling: ${authFlow.tokenOrSessionHandling}. Route protection: ${authFlow.protectedRoutesSummary}. Logout: ${authFlow.logoutHandling}.`,
      filePaths: uniqueStrings(
        [
          ...authFlow.loginInitiationFiles,
          ...authFlow.backendVerificationFiles,
          ...authFlow.steps.map((s) => s.filePath),
        ],
        10
      ),
      symbols: [],
      relationships: authFlow.steps.map((s) => `Step ${s.step}: ${s.actor} → ${s.action}`),
    });
  }

  // 9. Application Workflows & Communication Traces
  for (const flow of report.communicationFlows) {
    items.push({
      id: `exp-comm-${flow.id}`,
      category: 'workflows',
      categoryLabel: 'Request Lifecycle',
      title: flow.name,
      subtitle: `${flow.httpRequest} → ${flow.backendRoute}`,
      confidence: flow.confidence,
      beginnerExplanation:
        flow.simpleExplanation ||
        `When a user performs "${flow.userAction}", the frontend calls ${flow.httpRequest} and updates the UI with ${flow.uiRendering}.`,
      technicalExplanation:
        flow.technicalExplanation ||
        `${flow.frontendComponent} calls ${flow.frontendService} (${flow.httpRequest}) → ${flow.backendRoute} → ${flow.middleware} → ${flow.serviceLayer} → ${flow.databaseOrExternal} → returns ${flow.responseFormat} → updates ${flow.stateUpdate}.`,
      filePaths: uniqueStrings(flow.sourceFiles, 8),
      symbols: [],
      relationships: [`Triggers ${flow.databaseOrExternal}`],
    });
  }

  for (const wf of report.applicationWorkflows) {
    items.push({
      id: `exp-wf-${wf.id}`,
      category: 'workflows',
      categoryLabel: 'Application Workflow',
      title: wf.title,
      subtitle: `${wf.diagramType} workflow · ${wf.sourceFiles.length} file(s)`,
      confidence: wf.confidence,
      beginnerExplanation: wf.simpleExplanation,
      technicalExplanation: wf.technicalExplanation,
      filePaths: uniqueStrings(wf.sourceFiles, 8),
      symbols: [],
      relationships: wf.relatedComponentIds
        .map((id) => componentById.get(id)?.name)
        .filter((n): n is string => Boolean(n))
        .map((n) => `Involves ${n}`),
    });
  }

  return items;
}
