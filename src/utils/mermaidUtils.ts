import mermaid from 'mermaid';

let initialized = false;

function initDarkMermaid(): void {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'dark',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    themeVariables: {
      darkMode: true,
      background: '#0B0F17',
      primaryColor: '#1E293B',
      primaryTextColor: '#F8FAFC',
      primaryBorderColor: '#3B82F6',
      lineColor: '#64748B',
      secondaryColor: '#1E1B4B',
      tertiaryColor: '#111827',
      mainBkg: '#111827',
      nodeBorder: '#3B82F6',
      clusterBkg: '#0F172A',
      clusterBorder: '#334155',
      titleColor: '#F8FAFC',
      edgeLabelBackground: '#0F172A',
      actorBkg: '#1E293B',
      actorBorder: '#60A5FA',
      actorTextColor: '#F8FAFC',
      signalColor: '#94A3B8',
      signalTextColor: '#E2E8F0',
      labelBoxBkgColor: '#111827',
      labelBoxBorderColor: '#334155',
      labelTextColor: '#E2E8F0',
      loopTextColor: '#CBD5E1',
      noteBkgColor: '#1E1B4B',
      noteBorderColor: '#8B5CF6',
      noteTextColor: '#F1F5F9',
    },
    flowchart: {
      curve: 'basis',
      htmlLabels: true,
      padding: 14,
    },
    sequence: {
      diagramMarginX: 24,
      diagramMarginY: 16,
      actorMargin: 45,
      messageMargin: 32,
      mirrorActors: false,
    },
    er: {
      layoutDirection: 'TB',
      entityPadding: 14,
    },
  });
}

function initPrintMermaid(): void {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'default',
    fontFamily: 'Helvetica, Arial, sans-serif',
    themeVariables: {
      darkMode: false,
      background: '#FFFFFF',
      primaryColor: '#EEF2FF',
      primaryTextColor: '#0F172A',
      primaryBorderColor: '#2563EB',
      lineColor: '#334155',
      secondaryColor: '#F8FAFC',
      tertiaryColor: '#F1F5F9',
      mainBkg: '#F8FAFC',
      nodeBorder: '#2563EB',
      clusterBkg: '#F8FAFC',
      clusterBorder: '#94A3B8',
      titleColor: '#0F172A',
      edgeLabelBackground: '#FFFFFF',
      actorBkg: '#EEF2FF',
      actorBorder: '#2563EB',
      actorTextColor: '#0F172A',
      signalColor: '#334155',
      signalTextColor: '#0F172A',
    },
    flowchart: {
      curve: 'linear',
      htmlLabels: false,
      padding: 12,
      useMaxWidth: false,
    },
    sequence: {
      diagramMarginX: 20,
      diagramMarginY: 14,
      actorMargin: 40,
      messageMargin: 28,
      mirrorActors: false,
      useMaxWidth: false,
    },
    er: {
      layoutDirection: 'TB',
      entityPadding: 12,
      useMaxWidth: false,
    },
  });
}

export function ensureMermaidInitialized(): void {
  if (initialized) return;
  initDarkMermaid();
  initialized = true;
}

export function clientRepairMermaid(code: string): string {
  const cleaned = code
    .trim()
    .replace(/^```(?:mermaid)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/\r\n/g, '\n')
    .trim();

  if (/^(flowchart|graph)\b/i.test(cleaned)) {
    return cleaned
      .split('\n')
      .map((line) => {
        if (/^\s*(%%|subgraph\b|end\b|classDef\b|class\b|style\b|linkStyle\b)/.test(line)) {
          return line;
        }
        return line.replace(/([A-Za-z0-9_]+)\[([^"\]]+)\]/g, (_m, id: string, label: string) => {
          const safe = label.replace(/["`<>]/g, "'").trim();
          return `${id}["${safe}"]`;
        });
      })
      .join('\n');
  }
  return cleaned;
}

let renderSeq = 0;

export async function renderMermaidSvg(
  rawCode: string
): Promise<{ svg: string; repairedCode: string }> {
  ensureMermaidInitialized();
  const repairedCode = clientRepairMermaid(rawCode);
  renderSeq += 1;
  const renderId = `cr-mermaid-${renderSeq}-${Date.now()}`;
  const { svg } = await mermaid.render(renderId, repairedCode);
  return { svg, repairedCode };
}

export async function renderPrintableMermaidPng(
  rawCode: string
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  try {
    initPrintMermaid();
    initialized = false;
    const repairedCode = clientRepairMermaid(rawCode);
    renderSeq += 1;
    const renderId = `cr-pdf-mermaid-${renderSeq}-${Date.now()}`;
    const { svg } = await mermaid.render(renderId, repairedCode);

    // Ensure XML namespace and white backdrop for crisp PDF embedding
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(svg, 'image/svg+xml');
    const svgEl = xmlDoc.documentElement;
    if (!svgEl || svgEl.tagName.toLowerCase() !== 'svg') {
      return null;
    }

    if (!svgEl.getAttribute('xmlns')) {
      svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }

    let naturalWidth = 960;
    let naturalHeight = 520;
    const viewBox = svgEl.getAttribute('viewBox');
    if (viewBox) {
      const nums = viewBox
        .trim()
        .split(/[\s,]+/)
        .map(Number)
        .filter((n) => Number.isFinite(n));
      if (nums.length === 4 && nums[2] > 0 && nums[3] > 0) {
        naturalWidth = Math.ceil(nums[2]);
        naturalHeight = Math.ceil(nums[3]);
      }
    } else {
      const attrW = parseFloat(svgEl.getAttribute('width') || '');
      const attrH = parseFloat(svgEl.getAttribute('height') || '');
      if (Number.isFinite(attrW) && attrW > 0) naturalWidth = Math.ceil(attrW);
      if (Number.isFinite(attrH) && attrH > 0) naturalHeight = Math.ceil(attrH);
    }

    const MAX_RENDER_W = 1400;
    const scale = Math.min(2, MAX_RENDER_W / Math.max(1, naturalWidth));
    const canvasW = Math.max(320, Math.round(naturalWidth * scale));
    const canvasH = Math.max(180, Math.round(naturalHeight * scale));

    svgEl.setAttribute('width', String(canvasW));
    svgEl.setAttribute('height', String(canvasH));

    const serialized = new XMLSerializer().serializeToString(svgEl);
    const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;

    const dataUrl = await new Promise<string | null>((resolve) => {
      const img = new Image();
      const timeout = window.setTimeout(() => resolve(null), 2500);
      img.onload = () => {
        window.clearTimeout(timeout);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = canvasW;
          canvas.height = canvasH;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvasW, canvasH);
          ctx.drawImage(img, 0, 0, canvasW, canvasH);
          resolve(canvas.toDataURL('image/png'));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => {
        window.clearTimeout(timeout);
        resolve(null);
      };
      img.src = encoded;
    });

    if (!dataUrl) return null;
    return { dataUrl, width: canvasW, height: canvasH };
  } catch {
    return null;
  } finally {
    initDarkMermaid();
    initialized = true;
  }
}
