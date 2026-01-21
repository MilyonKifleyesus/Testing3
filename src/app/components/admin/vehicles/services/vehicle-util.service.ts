import { Injectable } from '@angular/core';

/**
 * Vehicle Utility Service
 * 
 * @description
 * Provides utility methods for vehicle-related UI components including:
 * - Status badge and icon classes
 * - Ticket priority and status classes
 * - Severity badge classes
 */
@Injectable({
  providedIn: 'root'
})
export class VehicleUtilService {

  constructor() { }

  /**
   * Get CSS class for vehicle status badge
   * @param status - Vehicle status
   * @returns CSS class string
   */
  getStatusBadgeClass(status: string): string {
    const statusMap: { [key: string]: string } = {
      'Active': 'badge bg-success',
      'Inactive': 'badge bg-secondary',
      'Maintenance': 'badge bg-warning',
      'Out of Service': 'badge bg-danger',
      'Pending': 'badge bg-info'
    };
    return statusMap[status] || 'badge bg-secondary';
  }

  /**
   * Get icon class for vehicle status
   * @param status - Vehicle status
   * @returns Icon class string
   */
  getStatusIcon(status: string): string {
    const iconMap: { [key: string]: string } = {
      'Active': 'bi bi-check-circle-fill text-success',
      'Inactive': 'bi bi-x-circle-fill text-secondary',
      'Maintenance': 'bi bi-wrench text-warning',
      'Out of Service': 'bi bi-exclamation-triangle-fill text-danger',
      'Pending': 'bi bi-clock-fill text-info'
    };
    return iconMap[status] || 'bi bi-circle-fill text-secondary';
  }

  /**
   * Get CSS class for ticket priority
   * @param priority - Ticket priority
   * @returns CSS class string
   */
  getTicketPriorityClass(priority: string): string {
    const priorityMap: { [key: string]: string } = {
      'High': 'badge bg-danger',
      'Medium': 'badge bg-warning',
      'Low': 'badge bg-info',
      'Critical': 'badge bg-danger-gradient'
    };
    return priorityMap[priority] || 'badge bg-secondary';
  }

  /**
   * Get CSS class for ticket status
   * @param status - Ticket status
   * @returns CSS class string
   */
  getTicketStatusClass(status: string): string {
    const statusMap: { [key: string]: string } = {
      'Open': 'badge bg-primary',
      'In Progress': 'badge bg-warning',
      'Resolved': 'badge bg-success',
      'Closed': 'badge bg-secondary',
      'Pending': 'badge bg-info'
    };
    return statusMap[status] || 'badge bg-secondary';
  }

  /**
   * Get CSS class for severity badge
   * @param severity - Defect severity
   * @returns CSS class string
   */
  getSeverityBadgeClass(severity: string): string {
    const severityMap: { [key: string]: string } = {
      'Critical': 'badge bg-danger',
      'Major': 'badge bg-warning',
      'Minor': 'badge bg-info',
      'Cosmetic': 'badge bg-secondary'
    };
    return severityMap[severity] || 'badge bg-secondary';
  }
}
