package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kuz55/KuKLA/rebuild/internal/application"
	"github.com/kuz55/KuKLA/rebuild/internal/domain"
)

type searchServiceFake struct {
	createdBy domain.ID
	created   domain.Search
}

type profileServiceFake struct {
	saved domain.UserProfile
}

func (f *profileServiceFake) Get(_ context.Context, userID domain.ID) (domain.UserProfile, error) {
	if f.saved.UserID != "" {
		return f.saved, nil
	}
	return domain.UserProfile{}, application.ErrNotFound
}
func (f *profileServiceFake) Save(_ context.Context, userID domain.ID, profile domain.UserProfile) (domain.UserProfile, error) {
	profile.UserID = userID
	profile.Verified = false
	f.saved = profile
	return profile, nil
}

func (f *searchServiceFake) Create(_ context.Context, actor domain.ID, command application.CreateSearchCommand) (domain.Search, error) {
	f.createdBy = actor
	f.created = domain.Search{ID: "search-1", Title: command.Title, Status: domain.SearchPlanned, CreatedBy: actor}
	return f.created, nil
}
func (f *searchServiceFake) Get(context.Context, domain.ID) (domain.Search, error) {
	return f.created, nil
}
func (f *searchServiceFake) List(context.Context, application.SearchFilter) ([]domain.Search, error) {
	return []domain.Search{f.created}, nil
}

func TestCreateSearchEndpointUsesLocalActorAndReturnsCreated(t *testing.T) {
	service := &searchServiceFake{}
	handler := NewHandler("test", service, nil, "local-installation", nil)
	request := httptest.NewRequest(http.MethodPost, "/v1/searches", strings.NewReader(`{"title":"Test operation"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if service.createdBy != "local-installation" {
		t.Fatalf("actor = %q, want local-installation", service.createdBy)
	}
	var got domain.Search
	if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Title != "Test operation" || response.Header().Get("Content-Length") == "" {
		t.Fatalf("response = %#v, headers = %#v", got, response.Header())
	}
}

func TestCreateSearchRejectsUnknownFields(t *testing.T) {
	handler := NewHandler("test", &searchServiceFake{}, nil, "local-installation", nil)
	request := httptest.NewRequest(http.MethodPost, "/v1/searches", strings.NewReader(`{"title":"Valid title","admin":true}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", response.Code, response.Body.String())
	}
}

func TestProfileEndpointBindsAndReturnsTheLocalActor(t *testing.T) {
	profiles := &profileServiceFake{}
	handler := NewHandler("test", nil, profiles, "local-installation", nil)
	request := httptest.NewRequest(http.MethodPut, "/v1/me/profile", strings.NewReader(
		`{"user_id":"another-user","full_name":"Alex Example","consent_personal_data":true}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if profiles.saved.UserID != "local-installation" || profiles.saved.FullName != "Alex Example" {
		t.Fatalf("saved profile = %#v", profiles.saved)
	}
	if profiles.saved.Verified {
		t.Fatal("saving a profile must clear its review status")
	}
}

func TestProfileEndpointRequiresExplicitConsent(t *testing.T) {
	handler := NewHandler("test", nil, application.NewProfileService(profileRepositoryFake{}), "local-installation", nil)
	request := httptest.NewRequest(http.MethodPut, "/v1/me/profile", strings.NewReader(`{"full_name":"Alex Example"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", response.Code, response.Body.String())
	}
}

type profileRepositoryFake struct{}

func (profileRepositoryFake) GetProfile(context.Context, domain.ID) (domain.UserProfile, error) {
	return domain.UserProfile{}, application.ErrNotFound
}
func (profileRepositoryFake) SaveProfile(context.Context, domain.UserProfile) error { return nil }

func TestRoleCatalogContainsAllDefinedRoles(t *testing.T) {
	handler := NewHandler("test", nil, nil, "", nil)
	request := httptest.NewRequest(http.MethodGet, "/v1/roles", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	var got []struct {
		Role domain.Role `json:"role"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 8 {
		t.Fatalf("got %d roles, want 8", len(got))
	}
}
