export type Role =
  | 'SYSTEM_OWNER'
  | 'SUPERADMIN'
  | 'SUPERUSER'
  | 'ADMIN'
  | 'LEADER'
  | 'COORDINATOR'
  | 'SEARCHER'
  | 'VIEWER';

export const privilegedRoles: Role[] = ['SYSTEM_OWNER', 'SUPERADMIN', 'SUPERUSER'];
export const adminRoles: Role[] = [...privilegedRoles, 'ADMIN'];
export const managementRoles: Role[] = [...adminRoles, 'LEADER', 'COORDINATOR'];

export function canManageUser(actor: Role, target: Role): boolean {
  if (actor === 'SYSTEM_OWNER') return true;
  if (actor === 'SUPERADMIN') return target !== 'SYSTEM_OWNER' && target !== 'SUPERADMIN';
  if (actor === 'SUPERUSER') return !['SYSTEM_OWNER', 'SUPERADMIN', 'SUPERUSER'].includes(target);
  if (actor === 'ADMIN') return ![...privilegedRoles, 'ADMIN'].includes(target);
  return false;
}

export function canAssignRole(actor: Role, next: Role): boolean {
  if (actor === 'SYSTEM_OWNER') return next !== 'SYSTEM_OWNER';
  if (actor === 'SUPERADMIN' || actor === 'SUPERUSER') {
    return !['SYSTEM_OWNER', 'SUPERADMIN', 'SUPERUSER'].includes(next);
  }
  if (actor === 'ADMIN') return ![...privilegedRoles, 'ADMIN'].includes(next);
  return false;
}

export function canManageSearch(role: Role): boolean {
  return managementRoles.includes(role);
}

export function canUpdateOwnAssignedTask(role: Role): boolean {
  return role === 'SEARCHER';
}

export function canUpdateTask(role: Role, taskAssigneeId: string | null | undefined, userId: string): boolean {
  if (managementRoles.includes(role)) return true;
  return role === 'SEARCHER' && taskAssigneeId === userId;
}
