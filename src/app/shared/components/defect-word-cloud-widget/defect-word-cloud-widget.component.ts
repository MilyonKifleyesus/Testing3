import { Component, OnInit, AfterViewInit, ViewChild, ElementRef, OnChanges, SimpleChanges, Input, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import * as d3 from 'd3';
import cloud from 'd3-cloud';
import { jsPDF } from 'jspdf';
import { extractArrayFromApiResponse } from '../../utils/api-data.utils';
import { ClientDashboardService } from '../../services/client-dashboard.service';
import { ClientService } from '../../services/client.service';
import { Client } from '../../models/client.model';

// Interfaces
interface NormalizedTicket {
  id: string;
  ticketDescription: string;
  projectId: number;
  vehicleId: number;
  defectLocationId: number;
  defectLocationName: string;
  defectTypeId: number;
  createdAt: string;
}

interface NormalizedDefectType {
  id: string;
  name: string;
}

interface NormalizedProject {
  id: string;
  name: string;
}

interface NormalizedVehicle {
  id: string;
  name: string;
  fleetNumber?: string;
}

interface WordFreq {
  text: string;
  count: number;
}

interface LayoutWord extends WordFreq {
  size: number;
  baseColor: string;
  hoverColor: string;
  frequencyLabel: string;
  rotate: number;
  x?: number;
  y?: number;
}

interface TooltipState {
  word: LayoutWord;
  cursorX: number;
  cursorY: number;
}

@Component({
  selector: 'app-defect-word-cloud-widget',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './defect-word-cloud-widget.component.html',
  styleUrls: ['./defect-word-cloud-widget.component.scss']
})
export class DefectWordCloudWidgetComponent implements OnInit, AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('cloudContainer', { static: false }) cloudContainer!: ElementRef<HTMLDivElement>;
  @Input() width: number = 800;
  @Input() height: number = 600;
  @Input() clientId?: number;
  @Input() projectId?: number | string;
  @Input() vehicleId?: number | string;
  // Optional external filters (e.g. from the dashboard widget).
  // These mirror the dashboard "Filter by Project" and "Filter by Vehicle" selects.
  projectIdSelection: string = 'all';
  vehicleIdSelection: string = 'all';

  drilldownPath: string[] = [];
  searchInput: string = '';
  filters = {
    client: 'all',
    project: 'all',
    vehicle: 'all',
    category: 'all',
    defectType: 'all',
    dateFrom: '',
    dateTo: '',
  };

  // TODO: Replace with API call when backend is ready
  readonly inspectionCategories = [
    { id: 3,  name: 'UnderCarriage', abbreviation: 'UC'   },
    { id: 4,  name: 'Interior',      abbreviation: 'Int'  },
    { id: 5,  name: 'Exterior',      abbreviation: 'Ext'  },
    { id: 6,  name: 'Roof',          abbreviation: 'Rf'   },
    { id: 7,  name: 'Function',      abbreviation: 'Fncn' },
    { id: 8,  name: 'Water',         abbreviation: 'WT'   },
    { id: 9,  name: 'Road Test',     abbreviation: 'RT'   },
    { id: 10, name: 'Engine',        abbreviation: 'EG'   },
    { id: 12, name: 'Buybacks',      abbreviation: 'BB'   },
    { id: 13, name: 'Final Walk',    abbreviation: 'FW'   },
  ];

  tickets: NormalizedTicket[] = [];
  projects: NormalizedProject[] = [];
  vehicles: NormalizedVehicle[] = [];
  defectTypes: NormalizedDefectType[] = [];
  clients: Client[] = [];
  loading = true;
  error: string | null = null;

  isFullscreen = false;
  showDownloadMenu = false;
  dimensions = { width: 800, height: 600 };

  tooltip: TooltipState | null = null;
  activeWord: string | null = null;

  private svg: any;
  private g: any;
  private resizeObserver: ResizeObserver | null = null;
  private activeLayout: any = null;

  constructor(
    private clientDashboardService: ClientDashboardService,
    private clientService: ClientService,
  ) {}

  ngOnInit() {
    // Load clients list only when the widget is not pinned to a specific client
    if (!this.clientId) {
      this.clientService.getClients().pipe(catchError(() => of([]))).subscribe(clients => {
        this.clients = clients;
      });
    }
    this.loadData();
  }

  ngAfterViewInit() {
    this.updateDimensionsFromContainer();
    this.resizeObserver = new ResizeObserver(() => {
      this.updateDimensionsFromContainer();
      if (!this.loading) this.renderCloud();
    });
    this.resizeObserver.observe(this.cloudContainer.nativeElement);
  }

  ngOnDestroy() {
    this.activeLayout?.stop();
    this.resizeObserver?.disconnect();
  }

  private updateDimensionsFromContainer() {
    const el = this.cloudContainer?.nativeElement;
    if (!el) return;
    const w = el.clientWidth || this.width;
    const h = el.clientHeight || this.height;
    this.dimensions = { width: w, height: h };
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['width'] || changes['height']) {
      this.dimensions = { width: this.width, height: this.height };
      this.renderCloud();
    }

    // Keep internal filters in sync with external dashboard filters.
    if (changes['projectId']) {
      const nextProject = (this.projectId ?? 'all').toString();
      this.projectIdSelection = nextProject && nextProject !== '' ? nextProject : 'all';
      this.filters.project = this.projectIdSelection;
      if (!changes['projectId'].firstChange) {
        this.loadData();
      }
    }

    if (changes['vehicleId']) {
      const nextVehicle = (this.vehicleId ?? 'all').toString();
      this.vehicleIdSelection = nextVehicle && nextVehicle !== '' ? nextVehicle : 'all';
      this.filters.vehicle = this.vehicleIdSelection;
      if (!changes['vehicleId'].firstChange) {
        this.loadData();
      }
    }

    if (changes['clientId']) {
      // When the dashboard provides a specific clientId, only clear the internal
      // client selector. Keep project/vehicle filters in sync with the dashboard
      // inputs instead of wiping them out here.
      if (this.clientId !== undefined) {
        this.filters.client = 'all';
      }
      if (!changes['clientId'].firstChange) {
        this.loadData();
      }
    }
  }

  loadData() {
    this.loading = true;
    this.error = null;

    // Prefer the widget's own client filter; fall back to @Input() clientId from dashboard
    const clientId = this.filters.client !== 'all'
      ? Number(this.filters.client)
      : this.clientId;
    // Prefer the widget's own filter selection; fall back to @Input() from dashboard
    const projectId = this.filters.project !== 'all'
      ? Number(this.filters.project)
      : (this.projectId && this.projectId !== 'all') ? Number(this.projectId) : undefined;
    const vehicleId = this.filters.vehicle !== 'all'
      ? Number(this.filters.vehicle)
      : (this.vehicleId && this.vehicleId !== 'all') ? Number(this.vehicleId) : undefined;

    forkJoin({
      tickets: this.clientDashboardService
        .getTickets({ clientId, projectId, vehicleId, page: 1, pageSize: 5000 })
        .pipe(catchError(() => of([]))),
      projects: this.clientDashboardService
        .getProjects({ clientId })
        .pipe(catchError(() => of([]))),
      vehicles: this.clientDashboardService
        .getVehicles({ clientId })
        .pipe(catchError(() => of([]))),
      defectTypes: this.clientDashboardService
        .getDefectTypes({ clientId })
        .pipe(catchError((err) => { console.warn('[WordCloud] /api/DefectTypes failed:', err); return of([]); })),
    }).subscribe({
      next: ({ tickets, projects, vehicles, defectTypes }) => {
        // Normalize API shapes to what the widget expects.
        const rawTickets = extractArrayFromApiResponse(tickets);
        this.tickets = rawTickets.map((ticket: any) => ({
          id: String(ticket.id ?? ''),
          ticketDescription: String(ticket.ticketDescription ?? ''),
          projectId: Number(ticket.projectId) || 0,
          vehicleId: Number(ticket.vehicleId) || 0,
          defectLocationId: Number(ticket.defectLocationId) || 0,
          defectLocationName: String(ticket.defectLocationName ?? ''),
          defectTypeId: Number(ticket.defacttype ?? ticket.defactTypeId ?? ticket.defectTypeId) || 0,
          createdAt: String(ticket.createdAt ?? ''),
        }));

        const rawProjects = extractArrayFromApiResponse(projects);
        this.projects = rawProjects.map((project: any) => ({
          id: String(project.id ?? ''),
          name: String(project.name ?? ''),
        }));

        const rawVehicles = extractArrayFromApiResponse(vehicles);
        this.vehicles = rawVehicles.map((vehicle: any) => ({
          id: String(vehicle.id ?? ''),
          name: String(vehicle.fleetNumber ?? ''),
        }));

        // Try extractArrayFromApiResponse first, then fall back to checking every object key
        let rawDefectTypes = extractArrayFromApiResponse(defectTypes);
        if (!rawDefectTypes.length && defectTypes && typeof defectTypes === 'object') {
          const anyVal = defectTypes as Record<string, unknown>;
          const found = Object.values(anyVal).find(Array.isArray);
          if (found) rawDefectTypes = found as any[];
        }
        this.defectTypes = rawDefectTypes.map((dt: any) => ({
          id: String(dt.id ?? dt.defactTypeId ?? dt.defectTypeId ?? ''),
          name: String(dt.name ?? dt.defactTypeName ?? dt.defectTypeName ?? dt.defacttype ?? dt.type ?? ''),
        }));

        this.loading = false;
        this.renderCloud();
      },
      error: () => {
        this.error = 'Failed to load word cloud data';
        this.loading = false;
      },
    });
  }

  getFilteredTickets(): NormalizedTicket[] {
    const tickets = this.tickets || [];

    const dateFrom = this.filters.dateFrom ? new Date(this.filters.dateFrom).getTime() : null;
    const dateTo = this.filters.dateTo ? new Date(this.filters.dateTo + 'T23:59:59').getTime() : null;

    return tickets.filter(ticket => {
      if (this.filters.project !== 'all' && ticket.projectId.toString() !== this.filters.project) return false;
      if (this.filters.vehicle !== 'all' && ticket.vehicleId.toString() !== this.filters.vehicle) return false;
      if (this.filters.category !== 'all' && ticket.defectLocationId.toString() !== this.filters.category) return false;
      if (this.filters.defectType !== 'all' && ticket.defectTypeId.toString() !== this.filters.defectType) return false;
      if (dateFrom !== null || dateTo !== null) {
        const ticketDate = ticket.createdAt ? new Date(ticket.createdAt).getTime() : null;
        if (ticketDate === null || isNaN(ticketDate)) return false;
        if (dateFrom !== null && ticketDate < dateFrom) return false;
        if (dateTo !== null && ticketDate > dateTo) return false;
      }
      if (this.drilldownPath.length > 0) {
        const desc = ticket.ticketDescription.toLowerCase();
        if (!this.drilldownPath.every(w => desc.includes(w.toLowerCase()))) return false;
      }
      return true;
    });
  }

  private readonly stopWords = new Set([
    'the','and','for','with','this','that','was','are','has','have','had','been',
    'not','but','from','they','them','then','than','also','will','can','all',
    'its','our','out','one','two','new','any','due','per','via','yet','nor',
    'into','onto','over','upon','when','where','which','while','after','before',
    'during','between','should','could','would','there','their','these','those',
  ]);

  processWords(): WordFreq[] {
    const filteredTickets = this.getFilteredTickets();
    const wordMap = new Map<string, number>();

    filteredTickets.forEach(ticket => {
      const words = ticket.ticketDescription.toLowerCase().split(/\s+/);
      words.forEach(rawWord => {
        const word = rawWord.replace(/[^a-z0-9]/g, '');
        if (word.length > 2 && !this.stopWords.has(word)) {
          wordMap.set(word, (wordMap.get(word) || 0) + 1);
        }
      });
    });

    // If drilldown is active, only keep tickets containing all drilldown words
    let result = Array.from(wordMap.entries()).map(([text, count]) => ({ text, count }));
    if (this.drilldownPath.length > 0) {
      const drillSet = new Set(this.drilldownPath.map(w => w.toLowerCase()));
      result = result.filter(w => !drillSet.has(w.text));
    }

    return result.sort((a, b) => b.count - a.count);
  }

  readonly frequencyLevels = [
    { color: '#FF4D4F', label: 'Systemic / Recurring Issue' },
    { color: '#FA8C16', label: 'Frequent / Common Issue' },
    { color: '#D4A017', label: 'Regular Issue' },
    { color: '#B08900', label: 'Occasional / Intermittent Issue' },
    { color: '#389E0D', label: 'Rare / Isolated Issue' },
  ];

  getFrequencyInfo(count: number, sortedCounts: number[]): { color: string; label: string } {
    const n = sortedCounts.length;
    if (n === 0) return { color: '#389E0D', label: 'Rare / Isolated Issue' };
    const rank = sortedCounts.filter(c => c <= count).length;
    const percentile = rank / n;
    if (percentile >= 0.9) return { color: '#FF4D4F', label: 'Systemic / Recurring Issue' };
    if (percentile >= 0.7) return { color: '#FA8C16', label: 'Frequent / Common Issue' };
    if (percentile >= 0.4) return { color: '#D4A017', label: 'Regular Issue' };
    if (percentile >= 0.2) return { color: '#B08900', label: 'Occasional / Intermittent Issue' };
    return { color: '#389E0D', label: 'Rare / Isolated Issue' };
  }

  renderCloud() {
    if (this.loading || !this.cloudContainer) return;

    // Cancel any in-flight layout to prevent stale draw() callbacks
    if (this.activeLayout) {
      this.activeLayout.stop();
      this.activeLayout = null;
    }

    this.updateDimensionsFromContainer();

    // Clear the canvas immediately so old words don't linger
    d3.select(this.cloudContainer.nativeElement).select('svg').remove();

    const words = this.processWords().slice(0, 60); // Keep fewer words so the dominant terms stay visually clear.

    if (words.length === 0) {
      return;
    }

    const sortedCounts = words.map(w => w.count).sort((a, b) => a - b);
    const minCount = sortedCounts[0];
    const maxCount = sortedCounts[sortedCounts.length - 1];

    // Scale font sizes relative to the current filtered dataset so the word
    // cloud always fills the container — even when filter results are sparse.
    const sizeScale = d3.scaleSqrt()
      .domain([minCount, maxCount])
      .range(minCount === maxCount ? [34, 34] : [16, 82])
      .clamp(true);

    this.activeLayout = cloud()
      .size([this.dimensions.width, this.dimensions.height])
      .words(words.map(w => {
        const { color, label } = this.getFrequencyInfo(w.count, sortedCounts);
        return { ...w, size: sizeScale(w.count), baseColor: color, frequencyLabel: label };
      }))
      .padding(8)
      .rotate(() => 0)
      .font('Impact')
      .fontSize((d: any) => d.size)
      .on('end', (layoutWords: any[]) => {
        this.activeLayout = null;
        this.draw(layoutWords);
      });

    this.activeLayout.start();
  }

  draw(words: any[]) {
    // Re-read container size at draw time — it may have changed since layout started.
    this.updateDimensionsFromContainer();
    const { width, height } = this.dimensions;

    d3.select(this.cloudContainer.nativeElement).select('svg').remove();

    this.svg = d3.select(this.cloudContainer.nativeElement)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    this.g = this.svg.append('g')
      .attr('transform', `translate(${width / 2},${height / 2})`);

    this.g.selectAll('text')
      .data(words)
      .enter().append('text')
      .style('font-size', (d: any) => d.size + 'px')
      .style('font-family', 'Impact')
      .style('fill', (d: any) => d.baseColor)
      .style('cursor', 'pointer')
      .style('transition', 'transform 0.15s ease, filter 0.15s ease, opacity 0.15s ease')
      .attr('text-anchor', 'middle')
      .attr('transform', (d: any) => `translate(${d.x},${d.y})rotate(${d.rotate})`)
      .text((d: any) => d.text)
      .on('mouseover', (event: any, d: any) => {
        d3.select(event.currentTarget)
          .style('filter', 'brightness(1.4) drop-shadow(0 0 4px rgba(0,0,0,0.35))')
          .style('opacity', '0.85')
          .attr('transform', (wd: any) => `translate(${wd.x},${wd.y})rotate(${wd.rotate}) scale(1.18)`);
        this.showTooltip(event, d);
      })
      .on('mousemove', (event: any, d: any) => {
        this.showTooltip(event, d);
      })
      .on('mouseout', (event: any, _d: any) => {
        d3.select(event.currentTarget)
          .style('filter', null)
          .style('opacity', '1')
          .attr('transform', (wd: any) => `translate(${wd.x},${wd.y})rotate(${wd.rotate})`);
        this.hideTooltip();
      })
      .on('click', (_event: any, d: any) => this.onWordClick(d.text));

    // Add tooltip div — use wc-tooltip to avoid Bootstrap's .tooltip { opacity: 0 } conflict.
    // All styles are applied inline via D3 because Angular's style encapsulation prevents
    // component SCSS from targeting dynamically-created D3 elements.
    const isDark = document.documentElement.getAttribute('data-theme-mode') === 'dark'
      || document.documentElement.classList.contains('dark');
    const tooltipBg    = isDark ? '#1a1a2e'              : '#ffffff';
    const tooltipBorder= isDark ? 'rgba(255,255,255,0.1)': 'rgba(0,0,0,0.12)';
    const tooltipColor = isDark ? '#e8e8f0'              : '#1d212f';
    const tooltipShadow= isDark
      ? '0 8px 24px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.35)'
      : '0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.08)';

    d3.select(this.cloudContainer.nativeElement).select('.wc-tooltip').remove();
    d3.select(this.cloudContainer.nativeElement)
      .append('div')
      .attr('class', 'wc-tooltip')
      .style('position', 'absolute')
      .style('opacity', '0')
      .style('pointer-events', 'none')
      .style('transition', 'opacity 0.15s ease')
      .style('background', tooltipBg)
      .style('border', `1px solid ${tooltipBorder}`)
      .style('border-radius', '8px')
      .style('padding', '10px 14px')
      .style('box-shadow', tooltipShadow)
      .style('max-width', '280px')
      .style('font-size', '12px')
      .style('line-height', '1.5')
      .style('color', tooltipColor)
      .style('z-index', '1000')
      .style('white-space', 'normal');
  }

  showTooltip(event: any, d: any) {
    const container = this.cloudContainer.nativeElement;
    const containerRect = container.getBoundingClientRect();

    // Cursor position relative to the container
    const cursorX = event.clientX - containerRect.left;
    const cursorY = event.clientY - containerRect.top;

    const word = d.text.toLowerCase();
    const dark = document.documentElement.getAttribute('data-theme-mode') === 'dark'
      || document.documentElement.classList.contains('dark');
    const titleColor   = dark ? '#ffffff' : '#0f172a';
    const countColor   = dark ? '#8888aa' : '#64748b';
    const labelColor   = dark ? '#b0b0cc' : '#475569';
    const dotBorder    = dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.15)';
    const sampleColor  = dark ? '#c8c8d8' : '#334155';
    const dividerColor = dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
    const sampleLabel  = dark ? '#7878a0' : '#94a3b8';

    const matchingDescsThemed = this.getFilteredTickets()
      .filter(t => t.ticketDescription.toLowerCase().includes(word))
      .slice(0, 3)
      .map(t => `<li style="margin-bottom:4px;color:${sampleColor};">${t.ticketDescription.trim()}</li>`)
      .join('');

    const samplesHtmlThemed = matchingDescsThemed
      ? `<div style="margin-top:8px;padding-top:7px;border-top:1px solid ${dividerColor};">
           <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:${sampleLabel};margin-bottom:4px;">Sample Tickets</div>
           <ul style="margin:0;padding-left:14px;">${matchingDescsThemed}</ul>
         </div>`
      : '';

    const tooltipEl = d3.select(container).select('.wc-tooltip');

    // Render content first so we can measure actual dimensions
    tooltipEl
      .style('left', '-9999px')
      .style('top', '-9999px')
      .style('opacity', '0')
      .html(`<div style="display:flex;align-items:baseline;gap:8px;">
               <strong style="font-size:14px;color:${titleColor};letter-spacing:0.02em;">${d.text}</strong>
               <span style="font-size:12px;color:${countColor};font-weight:500;">×${d.count}</span>
             </div>
             <div style="display:flex;align-items:center;gap:6px;margin-top:5px;">
               <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${d.baseColor};border:1px solid ${dotBorder};flex-shrink:0;"></span>
               <span style="font-size:11px;color:${labelColor};">${d.frequencyLabel}</span>
             </div>
             ${samplesHtmlThemed}`);

    // Measure actual tooltip size now that content is set
    const tipNode = tooltipEl.node() as HTMLElement;
    const tipW = tipNode.offsetWidth || 260;
    const tipH = tipNode.offsetHeight || 100;

    const offset = 14;
    const containerW = container.clientWidth;
    const containerH = container.clientHeight;

    // Default: right and above cursor
    let x = cursorX + offset;
    let y = cursorY - tipH - offset;

    // Flip left if overflowing right edge
    if (x + tipW > containerW - 4) {
      x = cursorX - tipW - offset;
    }
    // Flip below cursor if overflowing top
    if (y < 4) {
      y = cursorY + offset;
    }
    // Hard clamp to container bounds
    x = Math.max(4, Math.min(x, containerW - tipW - 4));
    y = Math.max(4, Math.min(y, containerH - tipH - 4));

    tooltipEl
      .style('left', x + 'px')
      .style('top', y + 'px')
      .style('opacity', '1');
  }

  hideTooltip() {
    d3.select(this.cloudContainer.nativeElement).select('.wc-tooltip')
      .style('opacity', '0');
  }

  onSearchSubmit() {
    const term = this.searchInput.trim().toLowerCase();
    if (term && !this.drilldownPath.includes(term)) {
      this.drilldownPath.push(term);
      this.renderCloud();
    }
    this.searchInput = '';
  }

  onWordClick(word: string) {
    if (this.drilldownPath.includes(word)) return;
    this.drilldownPath.push(word);
    this.renderCloud();
  }

  resetDrilldown() {
    this.drilldownPath = [];
    this.renderCloud();
  }

  /** Called when Client filter changes — resets project/vehicle selections then re-fetches */
  onClientFilterChange() {
    this.filters.project = 'all';
    this.filters.vehicle = 'all';
    this.loadData();
  }

  /** Called when Project or Vehicle filter changes — re-fetches data from the API */
  onServerFilterChange() {
    this.loadData();
  }

  /** Called when Category / Date filters change — re-renders from already-loaded data */
  onFilterChange() {
    this.renderCloud();
  }

  toggleFullscreen() {
    this.isFullscreen = !this.isFullscreen;
    // Adjust dimensions
  }

  toggleDownloadMenu(event: MouseEvent) {
    event.stopPropagation();
    this.showDownloadMenu = !this.showDownloadMenu;
  }

  @HostListener('document:click')
  closeDownloadMenu() {
    this.showDownloadMenu = false;
  }

  // ── Downloads ──────────────────────────────────────────────────────────────

  private getSvgElement(): SVGSVGElement | null {
    return this.cloudContainer?.nativeElement?.querySelector('svg') ?? null;
  }

  private svgToCanvas(svgEl: SVGSVGElement): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
      const width  = svgEl.clientWidth  || this.dimensions.width;
      const height = svgEl.clientHeight || this.dimensions.height;
      const serializer = new XMLSerializer();
      const svgStr = serializer.serializeToString(svgEl);
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const img  = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        // Fill background to match card
        const isDark = document.documentElement.getAttribute('data-theme-mode') === 'dark'
          || document.documentElement.classList.contains('dark');
        ctx.fillStyle = isDark ? '#0e0e23' : '#fafafa';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        resolve(canvas);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  private triggerDownload(url: string, filename: string) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  }

  downloadSVG() {
    const svgEl = this.getSvgElement();
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgEl);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    this.triggerDownload(url, 'defect-word-cloud.svg');
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  downloadPNG() {
    const svgEl = this.getSvgElement();
    if (!svgEl) return;
    this.svgToCanvas(svgEl).then(canvas => {
      this.triggerDownload(canvas.toDataURL('image/png'), 'defect-word-cloud.png');
    }).catch((err) => console.error('[WordCloud] PNG export failed', err));
  }

  downloadCSV() {
    const words = this.processWords();
    const sortedCounts = words.map(x => x.count).sort((a, b) => a - b);
    const rows  = [
      ['Word', 'Count', 'Frequency Label'],
      ...words.map(w => {
        const { label } = this.getFrequencyInfo(w.count, sortedCounts);
        return [w.text, String(w.count), label];
      }),
    ];
    const csv  = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    this.triggerDownload(url, 'defect-word-cloud.csv');
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  downloadPDF() {
    const svgEl = this.getSvgElement();
    if (!svgEl) return;
    this.svgToCanvas(svgEl).then(canvas => {
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [canvas.width, canvas.height],
      });
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
      pdf.save('defect-word-cloud.pdf');
    }).catch((err) => console.error('[WordCloud] PDF export failed', err));
  }
}
