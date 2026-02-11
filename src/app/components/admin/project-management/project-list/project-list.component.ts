import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Project } from '../../../../shared/models/project.model';
import { Client } from '../../../../shared/models/client.model';
import { ClientService } from '../../../../shared/services/client.service';
import { ProjectService } from '../../../../shared/services/project.service';

@Component({
  selector: 'app-project-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './project-list.component.html',
  styleUrls: ['./project-list.component.scss'],
})
export class ProjectListComponent implements OnInit {
  projects = signal<Project[]>([]);
  clients = signal<Client[]>([]);
  selectedClientId = signal<string>('all');
  selectedProjectType = signal<string>('all');

  statusSummary = computed(() => {
    const list = this.projects();
    return {
      total: list.length,
      open: list.filter((p) => (p.status ?? 'Open') === 'Open').length,
      closed: list.filter((p) => p.status === 'Closed').length,
      delayed: list.filter((p) => p.status === 'Delayed').length,
    };
  });

  projectTypes = computed(() => {
    const list = this.projects();
    const types = new Set(list.map((p) => p.assessmentType));
    return Array.from(types).sort();
  });

  constructor(
    private router: Router,
    private clientService: ClientService,
    private projectService: ProjectService
  ) {}

  ngOnInit(): void {
    this.clientService.getClients().subscribe((clients) => this.clients.set(clients));
    this.loadProjects();
  }

  private loadProjects(): void {
    const clientId = this.selectedClientId();
    const projectType = this.selectedProjectType();
    this.projectService
      .getProjects({
        clientId: clientId === 'all' ? undefined : clientId,
        projectType: projectType === 'all' ? undefined : projectType,
      })
      .subscribe((projects) => this.projects.set(projects));
  }

  onClientChange(clientId: string): void {
    this.selectedClientId.set(clientId);
    this.loadProjects();
  }

  onProjectTypeChange(projectType: string): void {
    this.selectedProjectType.set(projectType);
    this.loadProjects();
  }

  viewProjectDetails(projectId: string | number): void {
    this.router.navigate(['/admin/projects/view', projectId]);
  }

  goToTickets(projectId: string | number): void {
    this.router.navigate(['/admin/tickets'], { queryParams: { projectId } });
  }

  closeProject(projectId: string | number): void {
    const project = this.projects().find((p) => p.id === projectId);
    if (!project || project.status === 'Closed') return;
    if (confirm('Are you sure you want to close this project?')) {
      const updated = { ...project, status: 'Closed' as const };
      this.projectService.updateProject(updated).subscribe({
        next: () => this.loadProjects(),
        error: () => alert('Failed to close project. Please try again.'),
      });
    }
  }

  deleteProject(projectId: string | number): void {
    if (confirm('Are you sure you want to delete this project?')) {
      this.projects.update((list) => list.filter((p) => p.id !== projectId));
    }
  }

  getClientName(clientId: string): string {
    return this.clients().find((c) => c.id === clientId)?.name ?? clientId;
  }
}
