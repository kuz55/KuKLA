package domain

// Role names are kept in sync with the existing KuKLA server contract.
type Role string

const (
	RoleSystemOwner Role = "SYSTEM_OWNER"
	RoleSuperAdmin  Role = "SUPERADMIN"
	RoleSuperUser   Role = "SUPERUSER"
	RoleAdmin       Role = "ADMIN"
	RoleLeader      Role = "LEADER"
	RoleCoordinator Role = "COORDINATOR"
	RoleSearcher    Role = "SEARCHER"
	RoleViewer      Role = "VIEWER"
)

var allRoles = [...]Role{
	RoleSystemOwner, RoleSuperAdmin, RoleSuperUser, RoleAdmin,
	RoleLeader, RoleCoordinator, RoleSearcher, RoleViewer,
}

type RoleDefinition struct {
	Role        Role
	Label       string
	Description string
}

var roleDefinitions = [...]RoleDefinition{
	{Role: RoleSystemOwner, Label: "Владелец системы", Description: "Корневое управление системой; назначается только защищённой процедурой первоначальной настройки."},
	{Role: RoleSuperAdmin, Label: "Суперадминистратор", Description: "Администрирование системы без управления владельцем и другими суперадминистраторами."},
	{Role: RoleSuperUser, Label: "Суперпользователь", Description: "Привилегированная совместимая роль; может управлять пользователями и поисками в пределах политики назначения."},
	{Role: RoleAdmin, Label: "Администратор", Description: "Управление пользователями и всеми поисковыми операциями."},
	{Role: RoleLeader, Label: "Руководитель поиска", Description: "Оперативное управление поисками, задачами и участниками."},
	{Role: RoleCoordinator, Label: "Координатор", Description: "Координация поисковых операций, задач и участников."},
	{Role: RoleSearcher, Label: "Поисковик", Description: "Участие в поисках, передача координат и обновление назначенных задач."},
	{Role: RoleViewer, Label: "Наблюдатель", Description: "Только просмотр; изменение данных запрещено."},
}

func Roles() []Role { return append([]Role(nil), allRoles[:]...) }

func RoleCatalog() []RoleDefinition {
	return append([]RoleDefinition(nil), roleDefinitions[:]...)
}

func (role Role) Valid() bool {
	for _, candidate := range allRoles {
		if role == candidate {
			return true
		}
	}
	return false
}

func (role Role) CanManageSearches() bool {
	switch role {
	case RoleSystemOwner, RoleSuperAdmin, RoleSuperUser, RoleAdmin, RoleLeader, RoleCoordinator:
		return true
	default:
		return false
	}
}

func (role Role) CanManageUsers() bool {
	switch role {
	case RoleSystemOwner, RoleSuperAdmin, RoleSuperUser, RoleAdmin:
		return true
	default:
		return false
	}
}

func (role Role) CanUpdateAssignedTask() bool { return role == RoleSearcher }

func (role Role) IsReadOnly() bool { return role == RoleViewer }

// CanManageUser mirrors the repository's current server-side management
// hierarchy. UI visibility must never be treated as authorization.
func CanManageUser(actor, target Role) bool {
	switch actor {
	case RoleSystemOwner:
		return target.Valid()
	case RoleSuperAdmin:
		return target != RoleSystemOwner && target != RoleSuperAdmin && target.Valid()
	case RoleSuperUser:
		return target != RoleSystemOwner && target != RoleSuperAdmin && target != RoleSuperUser && target.Valid()
	case RoleAdmin:
		return target != RoleSystemOwner && target != RoleSuperAdmin && target != RoleSuperUser && target != RoleAdmin && target.Valid()
	default:
		return false
	}
}

func CanAssignRole(actor, next Role) bool {
	switch actor {
	case RoleSystemOwner:
		return next.Valid() && next != RoleSystemOwner
	case RoleSuperAdmin, RoleSuperUser:
		return next.Valid() && next != RoleSystemOwner && next != RoleSuperAdmin && next != RoleSuperUser
	case RoleAdmin:
		return next.Valid() && next != RoleSystemOwner && next != RoleSuperAdmin && next != RoleSuperUser && next != RoleAdmin
	default:
		return false
	}
}
