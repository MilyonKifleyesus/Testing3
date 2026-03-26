import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { resolveProjectManagementContext } from '../project-management-context';

@Component({
  selector: 'app-new-project',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './new-project.component.html',
  styleUrls: ['./new-project.component.scss']
})
export class NewProjectComponent implements OnInit {
  projectForm!: FormGroup;
  submitted = false;
  private readonly portalPrefix: '/admin' | '/client';

  get canManageProjects(): boolean {
    return this.portalPrefix === '/admin';
  }

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly router: Router,
    private readonly authService: AuthService,
  ) {
    const context = resolveProjectManagementContext(this.authService.currentUserValue);
    this.portalPrefix = context.portalPrefix;
  }

  ngOnInit(): void {
    this.projectForm = this.formBuilder.group({
      projectName: ['', Validators.required],
      client: ['', Validators.required],
      assessmentType: ['', Validators.required],
      location: ['', Validators.required],
      manufacturer: ['', Validators.required],
      description: ['']
    });

    if (!this.canManageProjects) {
      this.onCancel();
    }
  }

  get f() {
    return this.projectForm.controls;
  }

  onSubmit(): void {
    this.submitted = true;

    if (this.projectForm.invalid || !this.canManageProjects) {
      return;
    }

    console.log('Project Data:', this.projectForm.value);
    this.router.navigate([`${this.portalPrefix}/projects/list`]);
  }

  onCancel(): void {
    this.router.navigate([`${this.portalPrefix}/projects/list`]);
  }
}
