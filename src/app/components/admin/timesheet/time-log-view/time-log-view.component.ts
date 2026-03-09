import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { TimeLogService } from '../../../../shared/services/time-log.service';
import { TimeLog } from '../../../../shared/models/time-log.model';
import { format, parseISO } from 'date-fns';

@Component({
  selector: 'app-time-log-view',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './time-log-view.component.html',
  styleUrls: ['./time-log-view.component.scss'],
})
export class TimeLogViewComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly timeLogService = inject(TimeLogService);

  log: TimeLog | null = null;
  loading = true;
  error: string | null = null;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigate(['/admin/timesheet']);
      return;
    }
    this.timeLogService.getTimeLog(id).subscribe({
      next: (data) => {
        this.log = data;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.message ?? 'Failed to load time log';
        this.loading = false;
      },
    });
  }

  backToList(): void {
    this.router.navigate(['/admin/timesheet']);
  }

  edit(): void {
    if (this.log?.id) this.router.navigate(['/admin/timesheet/edit', this.log.id]);
  }

  formatDate(d: string): string {
    try {
      return format(parseISO(d), 'dd MMM yyyy HH:mm');
    } catch {
      return d;
    }
  }
}
