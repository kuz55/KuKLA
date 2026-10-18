package sqlite

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/kuz55/KuKLA/rebuild/internal/application"
	"github.com/kuz55/KuKLA/rebuild/internal/domain"
)

func TestSearchCreationPersistsMembershipAndAuditAtomically(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "kukla.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	service := application.NewSearchApplication(store, store)
	created, err := service.Create(ctx, "operator-1", application.CreateSearchCommand{Title: "Проверка района"})
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := service.Get(ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Title != created.Title || loaded.Status != domain.SearchPlanned {
		t.Fatalf("loaded search = %#v, want title %q and status PLANNED", loaded, created.Title)
	}

	var memberCount, auditCount int
	if err := store.db.QueryRowContext(ctx, "SELECT count(*) FROM search_members WHERE search_id = ? AND user_id = ?", created.ID, "operator-1").Scan(&memberCount); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRowContext(ctx, "SELECT count(*) FROM audit_events WHERE search_id = ? AND user_id = ? AND event_type = 'SEARCH_CREATED'", created.ID, "operator-1").Scan(&auditCount); err != nil {
		t.Fatal(err)
	}
	if memberCount != 1 || auditCount != 1 {
		t.Fatalf("member rows=%d audit rows=%d; want 1 each", memberCount, auditCount)
	}

	if err := store.Migrate(ctx); err != nil {
		t.Fatalf("re-running migrations: %v", err)
	}
}

func TestSearchCreationRollsBackWhenAuditFails(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "kukla.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	search := domain.Search{
		ID: "search-rollback", Title: "Проверка", Status: domain.SearchPlanned,
		CreatedBy: "operator-1",
	}
	err = store.WithinTransaction(ctx, func(repositories application.Repositories) error {
		if err := repositories.Searches.Create(ctx, search); err != nil {
			return err
		}
		return repositories.Audit.Append(ctx, domain.AuditEvent{
			ID: "audit-rollback", SearchID: "missing-search", UserID: "operator-1",
			Type: "SEARCH_CREATED", Payload: []byte(`{}`),
		})
	})
	if err == nil {
		t.Fatal("expected foreign-key failure to abort the unit of work")
	}
	if _, err := store.Get(ctx, search.ID); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("search survived rolled-back transaction: %v", err)
	}
}

func TestUserProfileRequiresConsentAndPersistsQuestionnaire(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "kukla.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	service := application.NewProfileService(store)
	profile, err := service.Save(ctx, "local-installation", domain.UserProfile{
		FullName: "Alex Example", BirthDate: "1990-05-10", City: "Omsk",
		District: "Central", ExtraPhone: "+70000000000", Skills: []string{"driver", "first aid"},
		HasTransport: true, AvailableForSearches: true,
		EmergencyContactName: "Contact Example", EmergencyContactPhone: "+71111111111",
		ConsentPersonalData: true, Verified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if profile.UserID != "local-installation" || profile.Verified {
		t.Fatalf("saved profile must be bound to local identity and pending review: %#v", profile)
	}
	loaded, err := service.Get(ctx, "local-installation")
	if err != nil {
		t.Fatal(err)
	}
	if loaded.FullName != "Alex Example" || loaded.City != "Omsk" || len(loaded.Skills) != 2 || !loaded.HasTransport {
		t.Fatalf("profile not persisted correctly: %#v", loaded)
	}

	if _, err := service.Save(ctx, "local-installation", domain.UserProfile{FullName: "No consent"}); err == nil {
		t.Fatal("profile without consent was accepted")
	}
}
