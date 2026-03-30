import { Component, OnInit } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AuthService, CurrentUser } from '../../../shared/services/auth.service';
import { NavService } from '../../../shared/services/nav.service';

@Component({
  selector: 'app-sign-in',
  standalone: true,
  imports: [RouterModule, ReactiveFormsModule, CommonModule],
  templateUrl: './sign-in.component.html',
  styleUrl: './sign-in.component.scss',
})
export class SignInComponent implements OnInit {
  loginForm!: FormGroup;
  loading = false;
  submitted = false;
  errorMessage = '';

  constructor(
    private formBuilder: FormBuilder,
    private authService: AuthService,
    private navService: NavService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.loginForm = this.formBuilder.group({
      username: ['', Validators.required],
      password: ['', Validators.required],
    });
  }

  get f() {
    return this.loginForm.controls;
  }

  onSubmit(): void {
    this.submitted = true;
    this.errorMessage = '';

    if (this.loginForm.invalid) return;

    this.loading = true;
    const { username, password } = this.loginForm.value;

    this.authService.loginWithRole(username, password).subscribe({
      next: (user: CurrentUser) => {
        const role = (user.role || 'admin').toLowerCase().trim();
        // Load menu based on user role
        this.navService.loadMenuByRole(role, Number(user.type ?? 0));

        const redirectUrl = this.authService.getRedirectUrlByRole(role);
        this.router.navigate([redirectUrl]);
        this.loginForm.patchValue({ password: '' });
        this.loading = false;
      },
      error: (error: any) => {
        this.errorMessage = this.getLoginErrorMessage(error);
        this.loginForm.patchValue({ password: '' });
        this.loading = false;
      }
    });
  }

  private getLoginErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const apiMessage = this.readApiErrorMessage(error.error);
      if (apiMessage) {
        return apiMessage;
      }

      if (error.status === 0) {
        return 'Unable to reach the login service. Check that the dev server proxy is running and the API is reachable.';
      }

      if (error.status >= 500) {
        return 'Login failed because the API returned an internal server error. The request reached the server, but the backend could not process it.';
      }

      if (error.status === 401 || error.status === 403) {
        return 'Invalid username or password.';
      }
    }

    return 'Login failed. Please try again.';
  }

  private readApiErrorMessage(payload: unknown): string {
    if (!payload) {
      return '';
    }

    if (typeof payload === 'string') {
      return payload.trim();
    }

    if (typeof payload === 'object') {
      const candidate = payload as Record<string, unknown>;
      const message = candidate['message'] ?? candidate['title'] ?? candidate['error'] ?? candidate['detail'];
      return typeof message === 'string' ? message.trim() : '';
    }

    return '';
  }
}
