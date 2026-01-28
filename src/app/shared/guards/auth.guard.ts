import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    return true;
  }

  // Not logged in, redirect to login page
  router.navigate(['/custom/sign-in'], { queryParams: { returnUrl: state.url } });
  return false;
};

export const roleGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    router.navigate(['/custom/sign-in'], { queryParams: { returnUrl: state.url } });
    return false;
  }

  const expectedRoles = route.data['roles'] as string[];
  
  if (expectedRoles && !authService.hasRole(expectedRoles)) {
    // Role not authorized, redirect based on user's actual role
    const userRole = authService.userRole;
    if (userRole === 'superadmin' || userRole === 'admin') {
      router.navigate(['/admin/dashboard']);
    } else if (userRole === 'client') {
      router.navigate(['/client/dashboard']);
    } else {
      router.navigate(['/dashboard']);
    }
    return false;
  }

  return true;
};
