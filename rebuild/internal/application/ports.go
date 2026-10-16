package application

import (
	"context"
	"time"

	"github.com/kuz55/KuKLA/rebuild/internal/domain"
)

// SearchFilter contains query-only options. Pagination and sorting semantics
// are deliberately explicit so UI/API callers cannot accidentally request an
// unbounded history.
type SearchFilter struct {
	Status *domain.SearchStatus
	Limit  int
	Offset int
}

type SearchReader interface {
	Get(context.Context, domain.ID) (domain.Search, error)
	List(context.Context, SearchFilter) ([]domain.Search, error)
}

type SearchRepository interface {
	SearchReader
	Create(context.Context, domain.Search) error
}

type MembershipRepository interface {
	Add(context.Context, domain.ID, domain.ID, time.Time) error
}

type AuditRepository interface {
	Append(context.Context, domain.AuditEvent) error
}

type Repositories struct {
	Searches    SearchRepository
	Memberships MembershipRepository
	Audit       AuditRepository
}

// UnitOfWork guarantees that a search, creator membership and audit event are
// committed or rolled back together. SQLite implementation follows in the
// persistence stage.
type UnitOfWork interface {
	WithinTransaction(context.Context, func(Repositories) error) error
}

type SearchService interface {
	Create(context.Context, domain.ID, CreateSearchCommand) (domain.Search, error)
	Get(context.Context, domain.ID) (domain.Search, error)
	List(context.Context, SearchFilter) ([]domain.Search, error)
}

type CreateSearchCommand struct {
	Title       string
	Area        string
	Description string
	IncidentLat *float64
	IncidentLng *float64
}
