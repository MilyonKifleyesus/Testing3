import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { resolveReportRouteContext } from '../report-route-context';

@Component({
  selector: 'app-administrative-reports',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="main-container container-fluid px-0">
      <div class="d-md-flex d-block align-items-center justify-content-between my-4 page-header-breadcrumb" style="margin-top: 2rem !important;">
        <div>
          <h1 class="page-title fw-semibold fs-20 mb-0">Administrative Reports</h1>
          <ol class="breadcrumb">
            <li class="breadcrumb-item"><a [routerLink]="[dashboardPath]">Home</a></li>
            <li class="breadcrumb-item"><a [routerLink]="[reportsPath]">Reports</a></li>
            <li class="breadcrumb-item active" aria-current="page">Administrative Reports</li>
          </ol>
        </div>
      </div>

      <div class="row">
        <!-- Labour Reports Card -->
        <div class="col-xl-4 col-lg-6 col-md-6 col-sm-12">
          <div class="card custom-card">
            <div class="card-body">
              <div class="d-flex align-items-center mb-3">
                <div class="flex-grow-1">
                  <h5 class="mb-1">Labour Report</h5>
                  <p class="text-muted mb-0">Employee work hours, productivity, and labour analytics</p>
                </div>
                <div class="ms-3">
                  <div class="avatar avatar-lg bg-warning-transparent">
                    <i class="ti-user-check fs-4"></i>
                  </div>
                </div>
              </div>
              <a [routerLink]="[reportsPath + '/administrative-reports/labour-reports']" class="btn btn-warning btn-sm w-100">
                <i class="ti-eye me-2"></i>View Report
              </a>
            </div>
          </div>
        </div>

        <!-- Summary Report for Time Logged -->
        <div class="col-xl-4 col-lg-6 col-md-6 col-sm-12">
          <div class="card custom-card">
            <div class="card-body">
              <div class="d-flex align-items-center mb-3">
                <div class="flex-grow-1">
                  <h5 class="mb-1">Summary Report for Time Logged</h5>
                  <p class="text-muted mb-0">Inspector time summaries, hours logged, and tickets generated</p>
                </div>
                <div class="ms-3">
                  <div class="avatar avatar-lg bg-success-transparent">
                    <i class="ti-time fs-4"></i>
                  </div>
                </div>
              </div>
              <a [routerLink]="[reportsPath + '/administrative-reports/summary-time-logged']" class="btn btn-success btn-sm w-100">
                <i class="ti-eye me-2"></i>View Report
              </a>
            </div>
          </div>
        </div>

        <!-- Inspector Active Asset Report Card -->
        <div class="col-xl-4 col-lg-6 col-md-6 col-sm-12">
          <div class="card custom-card">
            <div class="card-body">
              <div class="d-flex align-items-center mb-3">
                <div class="flex-grow-1">
                  <h5 class="mb-1">Inspector Active Asset Report</h5>
                  <p class="text-muted mb-0">Active assets by inspector with open and closed ticket counts</p>
                </div>
                <div class="ms-3">
                  <div class="avatar avatar-lg bg-primary-transparent">
                    <i class="ti-bus fs-4"></i>
                  </div>
                </div>
              </div>
              <a [routerLink]="[reportsPath + '/administrative-reports/inspector-active-assets']" class="btn btn-primary btn-sm w-100">
                <i class="ti-eye me-2"></i>View Report
              </a>
            </div>
          </div>
        </div>

        <!-- Vehicle Hour Report Card -->
        <div class="col-xl-4 col-lg-6 col-md-6 col-sm-12">
          <div class="card custom-card">
            <div class="card-body">
              <div class="d-flex align-items-center mb-3">
                <div class="flex-grow-1">
                  <h5 class="mb-1">Vehicle Hour Report</h5>
                  <p class="text-muted mb-0">Total hours logged per vehicle across clients and projects</p>
                </div>
                <div class="ms-3">
                  <div class="avatar avatar-lg bg-info-transparent">
                    <i class="ti-time fs-4"></i>
                  </div>
                </div>
              </div>
              <a [routerLink]="[reportsPath + '/administrative-reports/vehicle-hour-report']" class="btn btn-info btn-sm w-100">
                <i class="ti-eye me-2"></i>View Report
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .avatar {
      width: 50px;
      height: 50px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
    }

    .card.custom-card {
      transition: all 0.3s ease;

      &:hover {
        transform: translateY(-5px);
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
      }
    }

    .btn {
      transition: all 0.3s ease;
    }
  `]
})
export class AdministrativeReportsComponent {
  readonly dashboardPath: string;
  readonly reportsPath: string;

  constructor(private readonly authService: AuthService) {
    const context = resolveReportRouteContext(this.authService.currentUserValue);
    this.dashboardPath = context.dashboardPath;
    this.reportsPath = context.reportsPath;
  }
}