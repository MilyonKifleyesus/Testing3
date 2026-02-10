/**
 * Project model linking Client to Manufacturer Location
 * Used by Admin Project List and War Room Project HUD
 */
export type ProjectStatus = 'Open' | 'Closed' | 'Delayed';

export interface Project {
  id: string | number;
  projectName: string;
  clientId: string;
  clientName?: string;
  assessmentType: string; // e.g. New Build, Retrofit, Full Inspection
  /** Links to War Room FactoryLocation.id or Location id */
  manufacturerLocationId?: string;
  location?: string; // Display label
  manufacturer?: string; // Display label
  status: ProjectStatus;
  totalAssets?: number;
  userAccess?: string[];
  /** 0-100 for mini-progress bar in Project HUD */
  progress?: number;
}
