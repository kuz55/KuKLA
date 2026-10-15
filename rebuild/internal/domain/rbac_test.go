package domain

import "testing"

func TestRoleListAndSearchPermissions(t *testing.T) {
	if len(Roles()) != 8 {
		t.Fatalf("got %d roles, want 8", len(Roles()))
	}
	if len(RoleCatalog()) != 8 {
		t.Fatalf("got %d role definitions, want 8", len(RoleCatalog()))
	}
	for _, role := range Roles() {
		if !role.Valid() {
			t.Errorf("role %q should be valid", role)
		}
	}
	for _, role := range []Role{RoleSearcher, RoleViewer} {
		if role.CanManageSearches() {
			t.Errorf("role %q must not manage searches", role)
		}
	}
	if !RoleSearcher.CanUpdateAssignedTask() || RoleViewer.CanUpdateAssignedTask() {
		t.Fatal("only searchers should be able to update their assigned tasks")
	}
	if !RoleViewer.IsReadOnly() || RoleSearcher.IsReadOnly() {
		t.Fatal("viewer should be read-only and searcher should not")
	}
	if RoleLeader.CanManageUsers() || !RoleAdmin.CanManageUsers() {
		t.Fatal("user-management permission does not match the server role hierarchy")
	}
	for _, role := range []Role{RoleAdmin, RoleLeader, RoleCoordinator} {
		if !role.CanManageSearches() {
			t.Errorf("role %q should manage searches", role)
		}
	}
}

func TestRoleAssignmentHierarchy(t *testing.T) {
	tests := []struct {
		actor Role
		next  Role
		want  bool
	}{
		{RoleSystemOwner, RoleSuperAdmin, true},
		{RoleSystemOwner, RoleSystemOwner, false},
		{RoleSuperAdmin, RoleAdmin, true},
		{RoleSuperAdmin, RoleSuperUser, false},
		{RoleSuperUser, RoleLeader, true},
		{RoleSuperUser, RoleAdmin, true},
		{RoleAdmin, RoleCoordinator, true},
		{RoleAdmin, RoleAdmin, false},
		{RoleLeader, RoleSearcher, false},
	}
	for _, test := range tests {
		if got := CanAssignRole(test.actor, test.next); got != test.want {
			t.Errorf("CanAssignRole(%q, %q) = %t, want %t", test.actor, test.next, got, test.want)
		}
	}
}

func TestRoleManagementHierarchy(t *testing.T) {
	if !CanManageUser(RoleSystemOwner, RoleSystemOwner) {
		t.Fatal("system owner should be able to manage the owner account under bootstrap policy")
	}
	for _, test := range []struct {
		actor  Role
		target Role
		want   bool
	}{
		{RoleSuperAdmin, RoleSystemOwner, false},
		{RoleSuperAdmin, RoleAdmin, true},
		{RoleSuperUser, RoleSuperAdmin, false},
		{RoleAdmin, RoleLeader, true},
		{RoleAdmin, RoleAdmin, false},
		{RoleViewer, RoleSearcher, false},
	} {
		if got := CanManageUser(test.actor, test.target); got != test.want {
			t.Errorf("CanManageUser(%q, %q) = %t, want %t", test.actor, test.target, got, test.want)
		}
	}
}
