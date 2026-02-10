import { Injectable } from '@angular/core';
import { Observable, of, delay, map } from 'rxjs';
import { Project } from '../models/project.model';
import { ProjectRoute } from '../models/war-room.interface';

export interface ProjectFilters {
  clientId?: string;
  projectType?: string; // assessmentType value
  manufacturer?: string; // Project.manufacturer e.g. Nova Bus, New Flyer, ARBOC
  status?: Project['status'];
}

export interface ProjectCounts {
  total: number;
  open: number;
  closed: number;
  delayed: number;
}

/** Mock projects linking clients to manufacturer locations (War Room factory IDs) */
const MOCK_PROJECTS: Project[] = [
  { id: 1, projectName: 'Nava-19904FT', clientId: 'drt', clientName: 'DRT', assessmentType: 'New Build', manufacturerLocationId: 'nova-st-eustache', location: 'St. Eustache', manufacturer: 'Nova Bus', status: 'Open', totalAssets: 25, progress: 75 },
  { id: 2, projectName: 'LFS-40FT-2', clientId: 'drt', clientName: 'DRT', assessmentType: 'Retrofit', manufacturerLocationId: 'new-flyer-winnipeg', location: 'Winnipeg', manufacturer: 'New Flyer', status: 'Closed', totalAssets: 40, progress: 100 },
  { id: 3, projectName: 'LGES-40FT-D', clientId: 'drt', clientName: 'DRT', assessmentType: 'New Build', manufacturerLocationId: 'new-flyer-winnipeg', location: 'Winnipeg', manufacturer: 'New Flyer', status: 'Closed', totalAssets: 35, progress: 100 },
  { id: 4, projectName: 'LFS-40FT-3', clientId: 'drt', clientName: 'DRT', assessmentType: 'Retrofit', manufacturerLocationId: 'new-flyer-crookston', location: 'Winnipeg / Crookston', manufacturer: 'New Flyer', status: 'Closed', totalAssets: 30, progress: 100 },
  { id: 5, projectName: 'Nova-LE65-40FT', clientId: 'ttc', clientName: 'TTC', assessmentType: 'New Build', manufacturerLocationId: 'nova-st-eustache', location: 'Saint-Eustache', manufacturer: 'Nova Bus', status: 'Open', totalAssets: 50, progress: 45 },
  { id: 6, projectName: 'Arboc-23FT', clientId: 'ttc', clientName: 'TTC', assessmentType: 'Retrofit', manufacturerLocationId: 'arboc-middlebury', location: 'Middlebury', manufacturer: 'ARBOC', status: 'Open', totalAssets: 20, progress: 30 },
  { id: 7, projectName: 'LF76-Inspection', clientId: 'yrt', clientName: 'York Region Transit', assessmentType: 'Full Inspection', manufacturerLocationId: 'new-flyer-winnipeg', location: 'Winnipeg', manufacturer: 'New Flyer', status: 'Open', totalAssets: 75, progress: 10 },
];

@Injectable({
  providedIn: 'root',
})
export class ProjectService {
  private projects = [...MOCK_PROJECTS];

  getProjects(filters?: ProjectFilters): Observable<Project[]> {
    let result = [...this.projects];
    if (filters?.clientId && filters.clientId !== 'all') {
      result = result.filter((p) => p.clientId === filters.clientId);
    }
    if (filters?.projectType && filters.projectType !== 'all') {
      result = result.filter((p) => p.assessmentType === filters!.projectType);
    }
    if (filters?.manufacturer && filters.manufacturer !== 'all') {
      result = result.filter((p) => p.manufacturer === filters!.manufacturer);
    }
    if (filters?.status) {
      result = result.filter((p) => p.status === filters.status);
    }
    return of(result).pipe(delay(150));
  }

  getProjectsByClient(clientId: string): Observable<Project[]> {
    return this.getProjects({ clientId });
  }

  getProjectsByFactory(manufacturerLocationId: string): Observable<Project[]> {
    return of(
      this.projects.filter((p) => p.manufacturerLocationId === manufacturerLocationId)
    ).pipe(delay(100));
  }

  addProject(project: Omit<Project, 'id'>): Observable<Project> {
    const nextId = Math.max(0, ...this.projects.map((p) => (typeof p.id === 'number' ? p.id : parseInt(String(p.id), 10) || 0))) + 1;
    const newProject: Project = { ...project, id: nextId };
    this.projects = [...this.projects, newProject];
    return of(newProject).pipe(delay(100));
  }

  getProjectCounts(clientId?: string): Observable<ProjectCounts> {
    return this.getProjects(clientId ? { clientId } : {}).pipe(
      map((projects) => ({
        total: projects.length,
        open: projects.filter((p) => p.status === 'Open').length,
        closed: projects.filter((p) => p.status === 'Closed').length,
        delayed: projects.filter((p) => p.status === 'Delayed').length,
      }))
    );
  }

  getProjectTypes(): Observable<string[]> {
    return this.getProjects({}).pipe(
      map((projects) => [...new Set(projects.map((p) => p.assessmentType).filter((v): v is string => !!v))].sort())
    );
  }

  getManufacturers(): Observable<string[]> {
    return this.getProjects({}).pipe(
      map((projects) => [...new Set(projects.map((p) => p.manufacturer).filter((v): v is string => !!v))].sort())
    );
  }

  /**
   * Returns projects with resolved coordinates for map route drawing.
   * Resolves client coords from ClientService, factory coords from War Room FactoryLocation.
   */
  getProjectsForMap(
    clientCoordinates: Map<string, { latitude: number; longitude: number }>,
    factoryCoordinates: Map<string, { latitude: number; longitude: number }>,
    filters?: ProjectFilters
  ): Observable<ProjectRoute[]> {
    return this.getProjects(filters ?? {}).pipe(
      map((projects) => {
        const routes: ProjectRoute[] = [];
        for (const p of projects) {
          const clientCoords = p.clientId && clientCoordinates.get(p.clientId);
          const factoryCoords = p.manufacturerLocationId && factoryCoordinates.get(p.manufacturerLocationId);
          if (clientCoords && factoryCoords) {
            routes.push({
              id: `project-route-${p.id}`,
              projectId: String(p.id),
              fromNodeId: p.clientId,
              toNodeId: p.manufacturerLocationId!,
              status: p.status,
              fromCoordinates: clientCoords,
              toCoordinates: factoryCoords,
              animated: p.status === 'Open',
              strokeColor: p.status === 'Open' ? '#5ad85a' : p.status === 'Delayed' ? '#ef4444' : '#94a3b8',
            });
          }
        }
        return routes;
      })
    );
  }
}
