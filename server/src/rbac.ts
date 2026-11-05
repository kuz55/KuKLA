export type Role =
  | 'SYSTEM_OWNER'
  | 'SUPERADMIN'
  | 'SUPERUSER'
  | 'ADMIN'
  | 'LEADER'
  | 'COORDINATOR'
  | 'REGIONAL_MANAGER'
  | 'SEARCHER'
  | 'VIEWER';

export const privilegedRoles: Role[] = ['SYSTEM_OWNER', 'SUPERADMIN', 'SUPERUSER'];
export const adminRoles: Role[] = [...privilegedRoles, 'ADMIN'];
// Regional managers receive management powers only inside searches where they
// have explicit direct membership. Other non-privileged roles may also use the
// existing active-organization access path. Keep this role out of privilegedRoles:
// global access is not safe without a reviewed region/assignment model.
export const managementRoles: Role[] = [...adminRoles, 'LEADER', 'COORDINATOR', 'REGIONAL_MANAGER'];
// Creating a search is global in the current data model; do not grant it to a
// regional manager until searches can be constrained to an assigned region.
export const searchCreationRoles: Role[] = [...adminRoles, 'LEADER', 'COORDINATOR'];

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
