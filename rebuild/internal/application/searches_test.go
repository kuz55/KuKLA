package application

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/kuz55/KuKLA/rebuild/internal/domain"
)

type fakeUOW struct {
	repositories Repositories
	rollbackErr  error
	committed    bool
}

func (f *fakeUOW) WithinTransaction(_ context.Context, fn func(Repositories) error) error {
	if err := fn(f.repositories); err != nil {
		return err
	}
	if f.rollbackErr != nil {
		return f.rollbackErr
	}
	f.committed = true
	return nil
}

type fakeSearches struct {
	created domain.Search
	createErr error
}

func (f *fakeSearches) Create(_ context.Context, search domain.Search) error {
	f.created = search
	return f.createErr
}
func (f *fakeSearches) Get(context.Context, domain.ID) (domain.Search, error) {
	return domain.Search{}, errors.New("not implemented in test fake")
}
func (f *fakeSearches) List(context.Context, SearchFilter) ([]domain.Search, error) {
	return nil, errors.New("not implemented in test fake")
}

type fakeMemberships struct {
	searchID domain.ID
	userID   domain.ID
	at       time.Time
}

func (f *fakeMemberships) Add(_ context.Context, searchID, userID domain.ID, at time.Time) error {
	f.searchID, f.userID, f.at = searchID, userID, at
	return nil
}

type fakeAudit struct{ event domain.AuditEvent }

func (f *fakeAudit) Append(_ context.Context, event domain.AuditEvent) error {
	f.event = event
	return nil
}

func TestCreateSearchUsesKnownDefaultsAndAtomicallyAddsCreatorAndAudit(t *testing.T) {
	searches := &fakeSearches{}
	members := &fakeMemberships{}
	audit := &fakeAudit{}
	uow := &fakeUOW{repositories: Repositories{Searches: searches, Memberships: members, Audit: audit}}
	service := NewSearchApplication(uow, searches)
	service.now = func() time.Time { return time.Date(2026, 10, 6, 10, 0, 0, 0, time.FixedZone("+06", 6*60*60)) }
	service.newID = sequenceID("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222")

	created, err := service.Create(context.Background(), "operator-id", CreateSearchCommand{Title: "Операция"})
	if err != nil {
		t.Fatal(err)
	}
	if created.Status != domain.SearchPlanned {
		t.Fatalf("status = %q, want PLANNED", created.Status)
	}
	if members.searchID != created.ID || members.userID != "operator-id" {
		t.Fatalf("creator was not added to search: %#v", members)
	}
	if audit.event.Type != "SEARCH_CREATED" || audit.event.SearchID != created.ID {
		t.Fatalf("creation audit missing or mismatched: %#v", audit.event)
	}
	if !uow.committed {
		t.Fatal("unit of work did not commit")
	}
}

func TestCreateSearchRejectsInvalidTitleBeforeTransaction(t *testing.T) {
	uow := &fakeUOW{repositories: Repositories{}}
	service := NewSearchApplication(uow, nil)
	if _, err := service.Create(context.Background(), "operator-id", CreateSearchCommand{Title: "A"}); err == nil {
		t.Fatal("expected invalid title error")
	}
	if uow.committed {
		t.Fatal("invalid search must not start/commit a transaction")
	}
}

func sequenceID(values ...string) func() (domain.ID, error) {
	index := 0
	return func() (domain.ID, error) {
		value := domain.ID(values[index])
		index++
		return value, nil
	}
}
