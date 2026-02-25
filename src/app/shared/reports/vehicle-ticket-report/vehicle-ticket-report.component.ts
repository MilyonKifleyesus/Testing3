import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { VehicleReportService, VehicleTicket, VehicleTicketReportRequest, Vehicle } from '../services/vehicle-report.service';
import { ReportService, Project } from '../services/report.service';
import { AuthService } from '../../services/auth.service';
import { resolveReportRouteContext } from '../report-route-context';
import { firstValueFrom, forkJoin } from 'rxjs';
import ExcelJS from 'exceljs';
import { buildPaginationItems } from '../../utils/pagination.utils';

@Component({
  selector: 'app-vehicle-ticket-report',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './vehicle-ticket-report.component.html',
  styleUrls: ['./vehicle-ticket-report.component.scss']
})
export class VehicleTicketReportComponent implements OnInit {
    // Sorting state
    sortColumn: string = '';
    sortDirection: 'asc' | 'desc' = 'asc';
    /**
     * Sort tickets by column
     */
    sortTickets(column: string) {
      if (this.sortColumn === column) {
        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortColumn = column;
        this.sortDirection = 'asc';
      }
      // Map column to VehicleTicket property
      const columnMap: { [key: string]: keyof VehicleTicket } = {
        ticketNumber: 'ticketNumber',
        clientName: 'clientName',
        projectName: 'projectName',
        vehicleNumber: 'vehicleNumber',
        safetyCritical: 'safetyCritical',
        createdDate: 'createdDate',
        defectType: 'defectType',
        defectLocation: 'defectLocation',
        description: 'description',
        hasImages: 'hasImages',
        assignedByName: 'assignedByName',
        assignedToName: 'assignedToName',
        stationName: 'stationName',
        status: 'status',
        resolvedDate: 'resolvedDate'
      };
      const prop = columnMap[column];
      if (!prop) return;
      this.filteredTickets.sort((a, b) => {
        if (prop === 'safetyCritical') {
          const aRank = a.safetyCritical ? 0 : 1;
          const bRank = b.safetyCritical ? 0 : 1;
          return this.sortDirection === 'asc' ? aRank - bRank : bRank - aRank;
        }

        let aValue = a[prop] ?? '';
        let bValue = b[prop] ?? '';
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          aValue = aValue.toLowerCase();
          bValue = bValue.toLowerCase();
        }
        if (aValue < bValue) return this.sortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return this.sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }
  
  // Expose Math to template
  Math = Math;
  
  selectedProject: string = '';
  selectedVehicle: string = '';
  searchTerm: string = '';
  
  projects: Project[] = [];
  vehicles: Vehicle[] = [];
  
  tickets: VehicleTicket[] = [];
  filteredTickets: VehicleTicket[] = [];
  reportGenerated: boolean = false;
  
  // Loading and error states
  isLoading: boolean = false;
  isLoadingFilters: boolean = false;
  isLoadingVehicles: boolean = false;
  errorMessage: string = '';
  
  // Pagination
  currentPage: number = 1;
  pageSize: number = 10;
  totalCount: number = 0;
  readonly dashboardPath: string;
  readonly reportsPath: string;

  constructor(
    private vehicleReportService: VehicleReportService,
    private reportService: ReportService,
    private readonly authService: AuthService,
  ) {
    const context = resolveReportRouteContext(this.authService.currentUserValue);
    this.dashboardPath = context.dashboardPath;
    this.reportsPath = context.reportsPath;
  }

  ngOnInit() {
    this.loadProjects();
  }

  /**
   * Load projects for dropdown
   * Ready for backend integration
   */
  loadProjects() {
    this.isLoadingFilters = true;
    
    this.vehicleReportService.getProjects().subscribe({
      next: (projects) => {
        this.projects = projects;
        this.isLoadingFilters = false;
        this.selectedProject = 'all';
        this.onProjectChange();
      },
      error: (error) => {
        console.error('Error loading projects:', error);
        this.errorMessage = 'Failed to load projects';
        this.isLoadingFilters = false;
      }
    });
  }

  /**
   * Load vehicles when project is selected
   */
  onProjectChange() {
    if (!this.selectedProject || this.selectedProject === '') {
      this.vehicles = [];
      this.selectedVehicle = '';
      this.tickets = [];
      this.filteredTickets = [];
      this.totalCount = 0;
      this.reportGenerated = false;
      return;
    }

    // If "All Projects" is selected, load vehicles from all projects
    if (this.selectedProject === 'all') {
      this.isLoadingVehicles = true;

      const requests = this.projects.map((project) => this.vehicleReportService.getVehiclesByProject(project.id));
      if (!requests.length) {
        this.vehicles = [];
        this.selectedVehicle = 'all';
        this.isLoadingVehicles = false;
        return;
      }

      forkJoin(requests).subscribe({
        next: (vehicleGroups: Vehicle[][]) => {
          const merged = vehicleGroups.flat();
          const uniqueVehicles = merged.filter((vehicle, index, self) =>
            index === self.findIndex((item) => item.id === vehicle.id),
          );
          this.vehicles = uniqueVehicles;
          this.selectedVehicle = 'all';
          this.isLoadingVehicles = false;
        },
        error: (error: any) => {
          console.error('Error loading vehicles:', error);
          this.errorMessage = 'Failed to load vehicles';
          this.isLoadingVehicles = false;
        },
      });
      return;
    }

    const project = this.projects.find(p => String(p.id) === this.selectedProject);
    if (!project) return;

    this.isLoadingVehicles = true;
    this.vehicleReportService.getVehiclesByProject(project.id).subscribe({
      next: (vehicles: Vehicle[]) => {
        this.vehicles = vehicles;
        this.selectedVehicle = 'all';
        this.isLoadingVehicles = false;
      },
      error: (error: any) => {
        console.error('Error loading vehicles:', error);
        this.errorMessage = 'Failed to load vehicles';
        this.isLoadingVehicles = false;
      }
    });
  }

  onVehicleChange(): void {
    this.errorMessage = '';
  }

  onSearchTermChange(): void {
    this.filterTickets();
  }

  /**
   * Run report with selected filters
   */
  runReport() {
    if (!this.selectedProject || this.selectedProject === '') {
      return;
    }

    if (!this.selectedVehicle || this.selectedVehicle === '') {
      return;
    }

    this.currentPage = 1; // Reset to first page
    this.loadReport();
  }

  /**
   * Load report data with pagination
   */
  loadReport() {
    this.isLoading = true;
    this.errorMessage = '';
    
    const request: VehicleTicketReportRequest = {
      projectId: this.selectedProject === 'all' ? undefined : Number(this.selectedProject),
      projectName: this.selectedProject === 'all' ? '' : this.getSelectedProjectName(),
      vehicleNumber: this.selectedVehicle === 'all' ? '' : this.selectedVehicle,
      searchTerm: this.searchTerm || undefined,
      page: this.currentPage,
      pageSize: this.pageSize
    };
    
    this.vehicleReportService.getVehicleTicketReports(request).subscribe({
      next: (response) => {
        if (response.success) {
          this.tickets = response.data;
          this.filteredTickets = response.data;
          this.totalCount = response.totalCount;
          this.reportGenerated = true;
        } else {
          this.errorMessage = response.message || 'Failed to fetch reports';
        }
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error fetching reports:', error);
        this.errorMessage = 'Failed to load report data. Please try again.';
        this.isLoading = false;
      }
    });
  }

  /**
   * Filter tickets based on search term
   */
  filterTickets() {
    if (!this.searchTerm) {
      this.filteredTickets = [...this.tickets];
      if (this.sortColumn) {
        this.sortTickets(this.sortColumn);
      }
      return;
    }

    const search = this.searchTerm.toLowerCase();
    this.filteredTickets = this.tickets.filter(ticket =>
      ticket.ticketNumber.toLowerCase().includes(search) ||
      ticket.description.toLowerCase().includes(search) ||
      ticket.defectType.toLowerCase().includes(search)
    );

    if (this.sortColumn) {
      this.sortTickets(this.sortColumn);
    }
  }

  /**
   * Print current report
   */
  async printReport() {
    if (!this.reportGenerated || this.filteredTickets.length === 0) {
      alert('Please generate a report first before printing');
      return;
    }

    try {
      const allTickets = await this.fetchAllTicketsForExport();
      const logoBase64 = await this.loadLogoAsBase64();
      const html = this.generatePrintHTML(allTickets, logoBase64);

      const printWindow = window.open('', '', 'height=900,width=1100');

      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        setTimeout(() => {
          printWindow.print();
        }, 250);
      } else {
        alert('Print window was blocked by browser. Please allow popups and try again.');
      }
    } catch (err) {
      console.error('Failed to generate print content:', err);
      alert('Failed to prepare report for printing: ' + (err as any).message);
    }
  }

  private loadLogoAsBase64(): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = 'assets/images/brand-logos/desktop-logo.png';

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } else {
          resolve('');
        }
      };

      img.onerror = () => {
        resolve('');
      };
    });
  }

  private generatePrintHTML(tickets: VehicleTicket[], logoBase64: string = ''): string {
    const today = new Date();
    const printDate = `${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getDate().toString().padStart(2, '0')}/${today.getFullYear()}`;
    const projectDisplay = this.selectedProject === 'all' ? 'All Projects' : this.getSelectedProjectName();
    const vehicleDisplay = this.selectedVehicle === 'all' ? 'All Vehicles' : this.selectedVehicle;

    let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>BusPulse Vehicle Ticket Report</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: Arial, sans-serif;
          font-size: 12px;
          color: #333;
          background: white;
          margin: 0;
          padding: 20px;
        }
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 15px;
          padding-bottom: 10px;
          border-bottom: 2px solid #000;
        }
        .logo-section {
          display: flex;
          gap: 15px;
          align-items: center;
        }
        .logo-img {
          width: 100px;
          height: 50px;
          object-fit: contain;
          padding: 5px;
        }
        .logo-placeholder {
          width: 100px;
          height: 50px;
          background: #ccc !important;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          color: #666;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .report-title {
          text-align: center;
          flex-grow: 1;
        }
        .report-title h1 {
          font-size: 16px;
          font-weight: bold;
          margin: 0;
        }
        .report-title p {
          font-size: 11px;
          margin: 2px 0;
        }
        .project-info {
          font-size: 11px;
          margin-bottom: 15px;
          color: #333;
          background: white;
          padding: 8px;
        }
        .section-header {
          background: #1DB954 !important;
          padding: 8px 10px;
          font-weight: bold;
          font-size: 12px;
          color: white !important;
          border: 2px solid #000;
          margin-bottom: 3px;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color-adjust: exact !important;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
          font-size: 11px;
          background: white;
        }
        table thead tr {
          background: #1DB954 !important;
          border: 2px solid #000;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color-adjust: exact !important;
        }
        table th {
          padding: 6px 4px;
          text-align: left;
          font-weight: bold;
          border: 1px solid #000;
          color: white !important;
          font-size: 10px;
          background: #1DB954 !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color-adjust: exact !important;
        }
        table td {
          padding: 6px 4px;
          border: 1px solid #999;
          vertical-align: top;
          background: white;
        }
        table tbody tr {
          background: white;
        }
        table tbody tr:nth-child(even) {
          background: #f9f9f9;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 15px;
          border-top: 1px solid #ccc;
          font-size: 10px;
          color: #666;
          margin-top: 20px;
          background: white;
        }
        .page-number {
          text-align: right;
          font-size: 10px;
          color: #666;
          background: white;
        }
        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          body { margin: 0; padding: 15px; background: white; }
          table { page-break-inside: avoid; }
          .footer { page-break-inside: avoid; }
          .section-header { background: #1DB954 !important; color: white !important; }
          table thead { background: #1DB954 !important; }
          table th { background: #1DB954 !important; color: white !important; }
        }
      </style>
    </head>
    <body>
      <div class="page-header">
        <div class="logo-section">
          ${logoBase64 ? `<img src="${logoBase64}" alt="Client Logo" class="logo-img">` : '<div class="logo-placeholder">Client Logo</div>'}
        </div>
        <div class="report-title">
          <h1>BusPulse Vehicle Ticket Report</h1>
          <p>Ticket Summary</p>
        </div>
        <div class="logo-section">
          ${logoBase64 ? `<img src="${logoBase64}" alt="BusPulse Logo" class="logo-img">` : '<div class="logo-placeholder">BusPulse Logo</div>'}
        </div>
      </div>

      <div class="project-info">
        <strong>Project: ${projectDisplay}</strong> | <strong>Vehicle: ${vehicleDisplay}</strong> | Generated: ${new Date().toLocaleString()}
      </div>

      <div class="section-header">Vehicle Tickets</div>
      
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Ticket #</th>
            <th>Vehicle</th>
            <th>VIN</th>
            <th>Safety Critical</th>
            <th>Created Date</th>
            <th>Defect Type</th>
            <th>Defect Location</th>
            <th>Description</th>
            <th>Images</th>
            <th>Assign To</th>
            <th>Station</th>
            <th>Status</th>
            <th>Resolved Date</th>
          </tr>
        </thead>
        <tbody>
    `;

    tickets.forEach((ticket, index) => {
      html += `
          <tr>
            <td>${index + 1}</td>
            <td>${ticket.ticketNumber || '-'}</td>
            <td>${ticket.vehicleNumber || '-'}</td>
            <td>${ticket.vehicleVIN || '-'}</td>
            <td>${ticket.safetyCritical ? 'Yes' : 'No'}</td>
            <td>${ticket.createdDate ? this.formatDate(ticket.createdDate) : '-'}</td>
            <td>${ticket.defectType || '-'}</td>
            <td>${ticket.defectLocation || '-'}</td>
            <td>${(ticket.description || '-').substring(0, 50)}</td>
            <td>${ticket.hasImages ? '✓' : '-'}</td>
            <td>${ticket.assignedToName || '-'}</td>
            <td>${ticket.stationName || '-'}</td>
            <td>${ticket.status || '-'}</td>
            <td>${ticket.resolvedDate ? this.formatDate(ticket.resolvedDate) : '-'}</td>
          </tr>
      `;
    });

    html += `
        </tbody>
      </table>

      <div class="footer">
        <div>Total Tickets: ${tickets.length} | Print Date: ${printDate}</div>
        <div></div>
      </div>
      
      <div class="page-number">1/1</div>
    </body>
    </html>
    `;

    return html;
  }

  /**
   * Download report as PDF
   */
  downloadReport() {
    if (!this.reportGenerated || this.filteredTickets.length === 0) {
      alert('Please generate a report first before downloading');
      return;
    }
    this.generateExcelExport();
  }

  /**
   * Generate and download PDF report
   */
  private async generateExcelExport() {
    try {
      const allTickets = await this.fetchAllTicketsForExport();
      await this.generateExcel(allTickets);
    } catch (err) {
      console.error('Failed to generate Excel export:', err);
      alert('Failed to generate export. Please try again.');
    }
  }

  private async fetchAllTicketsForExport(): Promise<VehicleTicket[]> {
    // Base request
    const baseRequest: VehicleTicketReportRequest = {
      projectId: this.selectedProject === 'all' ? undefined : Number(this.selectedProject),
      projectName: this.selectedProject === 'all' ? '' : this.getSelectedProjectName(),
      vehicleNumber: this.selectedVehicle === 'all' ? '' : this.selectedVehicle,
      searchTerm: this.searchTerm || undefined,
      page: 1,
      pageSize: 200
    };

    const first = await firstValueFrom(this.vehicleReportService.getVehicleTicketReports(baseRequest));
    if (!first || !first.success) {
      return [...this.filteredTickets];
    }

    const all: VehicleTicket[] = [...(first.data || [])];
    const total = first.totalCount || all.length;
    const totalPages = Math.ceil(total / (baseRequest.pageSize || 200));

    for (let p = 2; p <= totalPages; p++) {
      const req: VehicleTicketReportRequest = { ...baseRequest, page: p };
      const resp = await firstValueFrom(this.vehicleReportService.getVehicleTicketReports(req));
      if (resp && resp.success && resp.data?.length) {
        all.push(...resp.data);
      }
    }

    return all;
  }

  private async generateExcel(tickets: VehicleTicket[]): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Vehicle Ticket Report');

    // Title section
    ws.getCell('A1').value = 'Vehicle Ticket Report';
    ws.getCell('A1').font = { bold: true, size: 14, name: 'Calibri' };
    
    const projectDisplay = this.selectedProject === 'all' ? 'All Projects' : this.getSelectedProjectName();
    const vehicleDisplay = this.selectedVehicle === 'all' ? 'All Vehicles' : this.selectedVehicle;
    
    // Get client name from first ticket if available
    const clientName = tickets.length > 0 ? tickets[0].clientName : 'N/A';
    
    ws.getCell('A2').value = `Client: ${clientName}`;
    ws.getCell('A2').font = { bold: true, size: 11, name: 'Calibri' };
    
    ws.getCell('A3').value = `Project: ${projectDisplay}`;
    ws.getCell('A3').font = { bold: true, size: 11, name: 'Calibri' };
    
    ws.getCell('A4').value = `Vehicle: ${vehicleDisplay}`;
    ws.getCell('A4').font = { bold: true, size: 11, name: 'Calibri' };

    // Empty rows for spacing (rows 5-6)
    
    // Header row at row 7
    const headerRowIndex = 7;
    const headers = [
      'Ticket #', 'Vehicle #', 'VIN', 'Client', 'Project',
      'Description', 'Defect Type', 'Defect Location', 'Safety Critical',
      'Assigned By', 'Assigned To', 'Station', 'Status',
      'Created Date', 'Resolved Date'
    ];
    const headerRow = ws.getRow(headerRowIndex);
    headerRow.values = headers;
    headerRow.font = { bold: true, size: 11, name: 'Calibri' };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB8CCE4' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.height = 20;

    // Column widths
    const widths = [12, 12, 20, 14, 16, 40, 16, 18, 14, 16, 16, 16, 12, 18, 18];
    widths.forEach((w, idx) => ws.getColumn(idx + 1).width = w);

    // Data rows start at row 8
    tickets.forEach(t => {
      ws.addRow([
        t.ticketNumber,
        t.vehicleNumber,
        t.vehicleVIN,
        t.clientName,
        t.projectName,
        t.description,
        t.defectType,
        t.defectLocation,
        t.safetyCritical ? 'Yes' : 'No',
        t.assignedByName,
        t.assignedToName,
        t.stationName || '',
        t.status,
        t.createdDate ? new Date(t.createdDate).toLocaleString('en-US') : '',
        t.resolvedDate ? new Date(t.resolvedDate).toLocaleString('en-US') : ''
      ]);
    });

    // Borders
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
          left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
          bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
          right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
        };
      });
    });

    // Freeze header
    ws.views = [{ state: 'frozen', ySplit: headerRowIndex, xSplit: 0 }];

    // Filename
    const now = new Date();
    const name = `VehicleTicketReport_${now.toLocaleDateString('en-US').replace(/\//g, '_')}.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  /**
   * Create HTML content for PDF
   */
  private createPDFContent(tickets: VehicleTicket[]): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US');

    let tableRows = '';
    tickets.forEach((ticket, index) => {
      const statusBadge = this.getStatusBadge(ticket.status);
      tableRows += `
        <tr>
          <td>${index + 1}</td>
          <td>${ticket.ticketNumber || 'N/A'}</td>
          <td>${ticket.vehicleNumber || 'N/A'}</td>
          <td>${ticket.vehicleVIN || 'N/A'}</td>
          <td>${ticket.description || 'N/A'}</td>
          <td>${ticket.defectType || 'N/A'}</td>
          <td>${ticket.assignedToName || 'Unassigned'}</td>
          <td>${statusBadge}</td>
          <td>${ticket.createdDate ? new Date(ticket.createdDate).toLocaleDateString() : 'N/A'}</td>
          <td>${ticket.resolvedDate ? new Date(ticket.resolvedDate).toLocaleDateString() : 'N/A'}</td>
        </tr>
      `;
    });

    const projectDisplay = this.selectedProject === 'all' ? 'All Projects' : this.getSelectedProjectName();
    const vehicleDisplay = this.selectedVehicle === 'all' ? 'All Vehicles' : this.selectedVehicle;
    const clientName = tickets.length > 0 ? tickets[0].clientName : 'N/A';

    return `
      <div class="header">
        <h1>Vehicle Ticket Report</h1>
        <div class="info">
          <p><strong>Client:</strong> ${clientName}</p>
          <p><strong>Project:</strong> ${projectDisplay}</p>
          <p><strong>Vehicle:</strong> ${vehicleDisplay}</p>
          <p><strong>Generated:</strong> ${dateStr} at ${timeStr}</p>
          <p><strong>Total Tickets:</strong> ${tickets.length}</p>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Ticket Number</th>
            <th>Vehicle Number</th>
            <th>VIN</th>
            <th>Description</th>
            <th>Defect Type</th>
            <th>Assigned To</th>
            <th>Status</th>
            <th>Created Date</th>
            <th>Resolved Date</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>

      <div class="summary">
        <h3>Report Summary</h3>
        <p><strong>Report Type:</strong> Vehicle Ticket Report</p>
        <p><strong>Filter Criteria:</strong> Project: ${projectDisplay}, Vehicle: ${vehicleDisplay}</p>
        <p><strong>Total Records:</strong> ${tickets.length}</p>
      </div>

      <div class="footer">
        <p>This is an automated report generated by BusPulse Reporting System</p>
        <p>Generated on: ${dateStr} at ${timeStr}</p>
      </div>
    `;
  }

  /**
   * Get status badge HTML
   */
  private getStatusBadge(status: string): string {
    const statusMap: { [key: string]: string } = {
      'completed': 'badge-success',
      'in-progress': 'badge-warning',
      'pending': 'badge-info',
      'failed': 'badge-danger',
      'on-hold': 'badge-warning'
    };

    const badgeClass = statusMap[status?.toLowerCase()] || 'badge-info';
    return `<span class="badge ${badgeClass}">${status || 'Pending'}</span>`;
  }

  /**
   * Format date for display
   */
  formatDate(dateString: string): string {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  /**
   * Get CSS class for safety critical badge
   */
  getSafetyCriticalClass(isCritical: boolean): string {
    return isCritical ? 'badge bg-danger' : 'badge bg-secondary';
  }

  /**
   * Get CSS class for status badge
   */
  getStatusClass(status: string): string {
    const statusMap: { [key: string]: string } = {
      'open': 'badge bg-info',
      'in progress': 'badge bg-warning',
      'closed': 'badge bg-success',
      'pending': 'badge bg-secondary'
    };
    return statusMap[status.toLowerCase()] || 'badge bg-secondary';
  }

  private getSelectedProjectName(): string {
    if (this.selectedProject === 'all' || !this.selectedProject) {
      return 'All Projects';
    }

    const project = this.projects.find((item) => String(item.id) === this.selectedProject);
    return project?.name ?? this.selectedProject;
  }

  /**
   * Go to next page
   */
  nextPage(): void {
    const maxPages = Math.ceil(this.totalCount / this.pageSize);
    if (this.currentPage < maxPages) {
      this.currentPage++;
      this.loadReport();
    }
  }

  /**
   * Go to previous page
   */
  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.loadReport();
    }
  }

  /**
   * Go to specific page
   */
  goToPage(page: number): void {
    const maxPages = Math.ceil(this.totalCount / this.pageSize);
    if (page >= 1 && page <= maxPages) {
      this.currentPage = page;
      this.loadReport();
    }
  }

  /**
   * Get total number of pages
   */
  getTotalPages(): number {
    return Math.ceil(this.totalCount / this.pageSize);
  }

  /**
   * Get page numbers array for pagination display
   */
  getPageNumbers(): number[] {
    return buildPaginationItems(this.getTotalPages(), this.currentPage, 5);
  }
}
