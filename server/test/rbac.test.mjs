import test from 'node:test';
import assert from 'node:assert/strict';
import { canManageUser, canAssignRole, canUpdateTask } from '../dist/rbac.js';

const roles=['SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN','LEADER','COORDINATOR','SEARCHER','VIEWER'];

test('SYSTEM_OWNER can manage every target; API separately protects self demotion',()=>{
  for(const target of roles) assert.equal(canManageUser('SYSTEM_OWNER',target),true);
});

test('lower privileged roles cannot assign privileged roles',()=>{
  for(const actor of ['SUPERADMIN','SUPERUSER','ADMIN']){
    for(const target of ['SYSTEM_OWNER','SUPERADMIN','SUPERUSER']) assert.equal(canAssignRole(actor,target),false);
  }
});

test('ADMIN can assign only operational roles below administrator',()=>{
  for(const target of ['LEADER','COORDINATOR','SEARCHER','VIEWER']) assert.equal(canAssignRole('ADMIN',target),true);
  for(const target of ['SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN']) assert.equal(canAssignRole('ADMIN',target),false);
});

test('SUPERADMIN and SUPERUSER can assign ADMIN and field roles',()=>{
  for(const actor of ['SUPERADMIN','SUPERUSER']){
    for(const target of ['ADMIN','LEADER','COORDINATOR','SEARCHER','VIEWER']) assert.equal(canAssignRole(actor,target),true);
    for(const target of ['SYSTEM_OWNER','SUPERADMIN','SUPERUSER']) assert.equal(canAssignRole(actor,target),false);
  }
});

test('only managers or the assigned SEARCHER can update a task',()=>{
  const task='user-searcher';
  for(const role of ['SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN','LEADER','COORDINATOR']) {
    assert.equal(canUpdateTask(role, task, 'another-user'), true);
  }
  assert.equal(canUpdateTask('SEARCHER', task, task), true);
  assert.equal(canUpdateTask('SEARCHER', task, 'another-user'), false);
  assert.equal(canUpdateTask('VIEWER', task, task), false);
});
