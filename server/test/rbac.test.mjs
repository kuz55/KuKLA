import test from 'node:test';
import assert from 'node:assert/strict';
import { adminRoles, canManageSearch, canManageUser, canAssignRole, canUpdateTask, managementRoles, privilegedRoles, searchCreationRoles } from '../dist/rbac.js';

const roles=['SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN','LEADER','COORDINATOR','REGIONAL_MANAGER','SEARCHER','VIEWER'];

test('SYSTEM_OWNER can manage every target; API separately protects self demotion',()=>{
  for(const target of roles) assert.equal(canManageUser('SYSTEM_OWNER',target),true);
});

test('lower privileged roles cannot assign privileged roles',()=>{
  for(const actor of ['SUPERADMIN','SUPERUSER','ADMIN']){
    for(const target of ['SYSTEM_OWNER','SUPERADMIN','SUPERUSER']) assert.equal(canAssignRole(actor,target),false);
  }
});

test('ADMIN can assign only operational roles below administrator',()=>{
  for(const target of ['LEADER','COORDINATOR','REGIONAL_MANAGER','SEARCHER','VIEWER']) assert.equal(canAssignRole('ADMIN',target),true);
  for(const target of ['SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN']) assert.equal(canAssignRole('ADMIN',target),false);
});

test('SUPERADMIN and SUPERUSER can assign ADMIN and field roles',()=>{
  for(const actor of ['SUPERADMIN','SUPERUSER']){
    for(const target of ['ADMIN','LEADER','COORDINATOR','REGIONAL_MANAGER','SEARCHER','VIEWER']) assert.equal(canAssignRole(actor,target),true);
    for(const target of ['SYSTEM_OWNER','SUPERADMIN','SUPERUSER']) assert.equal(canAssignRole(actor,target),false);
  }
});

test('regional managers have search-scoped management, not global admin or privileged access',()=>{
  assert.equal(canManageSearch('REGIONAL_MANAGER'),true);
  assert.equal(managementRoles.includes('REGIONAL_MANAGER'),true);
  assert.equal(adminRoles.includes('REGIONAL_MANAGER'),false);
  assert.equal(privilegedRoles.includes('REGIONAL_MANAGER'),false);
  assert.equal(searchCreationRoles.includes('REGIONAL_MANAGER'),false);
  assert.equal(canAssignRole('ADMIN','REGIONAL_MANAGER'),true);
  assert.equal(canManageUser('ADMIN','REGIONAL_MANAGER'),true);
  assert.equal(canAssignRole('REGIONAL_MANAGER','SEARCHER'),false);
});

test('only managers or the assigned SEARCHER can update a task',()=>{
  const task='user-searcher';
  for(const role of ['SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN','LEADER','COORDINATOR','REGIONAL_MANAGER']) {
    assert.equal(canUpdateTask(role, task, 'another-user'), true);
  }
  assert.equal(canUpdateTask('SEARCHER', task, task), true);
  assert.equal(canUpdateTask('SEARCHER', task, 'another-user'), false);
  assert.equal(canUpdateTask('VIEWER', task, task), false);
});
