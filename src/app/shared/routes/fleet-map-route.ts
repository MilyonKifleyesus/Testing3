export function resolveFleetMapPathByRole(role?: string | null): string {
  const normalizedRole = (role ?? '').toLowerCase().trim();

  if (
    normalizedRole === 'admin' ||
    normalizedRole === 'superadmin' ||
    normalizedRole === 'super admin' ||
    normalizedRole === 'generaladmin' ||
    normalizedRole === 'general admin'
  ) {
    return '/admin/fleet-map';
  }

  if (
    normalizedRole === 'client' ||
    normalizedRole === 'user' ||
    normalizedRole.includes('client') ||
    normalizedRole === 'client user'
  ) {
    return '/client/dashboard';
  }

  return '/dashboard';
}
