import { CurrentUser } from '../../services/auth.service';

export type ProjectPortalPrefix = '/admin' | '/client';

export interface ProjectManagementContext {
  portalPrefix: ProjectPortalPrefix;
  scopedClientId: string | null;
  isClientScopedRole: boolean;
}

export function resolveProjectManagementContext(
  user: CurrentUser | null | undefined,
  routeClientId?: string | null,
): ProjectManagementContext {
  const role = (user?.role ?? '').toLowerCase().trim();
  const isClientScopedRole = role === 'client' || role === 'user';
  const portalPrefix: ProjectPortalPrefix = isClientScopedRole ? '/client' : '/admin';

  const userClientId = user && user.clientId > 0 ? String(user.clientId).trim() : '';
  const normalizedUserClientId = userClientId || null;

  if (isClientScopedRole) {
    return {
      portalPrefix,
      scopedClientId: normalizedUserClientId,
      isClientScopedRole,
    };
  }

  const normalizedRouteClientId = (routeClientId ?? '').trim() || null;

  return {
    portalPrefix,
    scopedClientId: normalizedRouteClientId,
    isClientScopedRole,
  };
}
