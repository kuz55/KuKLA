package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/kuz55/KuKLA/rebuild/internal/application"
	"github.com/kuz55/KuKLA/rebuild/internal/domain"
)

const maxRequestBytes = 1 << 20

type SearchService interface {
	Create(context.Context, domain.ID, application.CreateSearchCommand) (domain.Search, error)
	Get(context.Context, domain.ID) (domain.Search, error)
	List(context.Context, application.SearchFilter) ([]domain.Search, error)
}

type ProfileService interface {
	Get(context.Context, domain.ID) (domain.UserProfile, error)
	Save(context.Context, domain.ID, domain.UserProfile) (domain.UserProfile, error)
}

type healthResponse struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}

type errorResponse struct {
	Error string `json:"error"`
}

// NewHandler exposes the local desktop API. The listener must be a private
// Unix socket or an ACL-protected Windows named pipe, never a public TCP port.
func NewHandler(version string, searches SearchService, profiles ProfileService, actorID domain.ID, shutdown func()) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, healthResponse{Status: "ok", Version: version})
	})
	mux.HandleFunc("POST /v1/shutdown", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "shutting_down"})
		if shutdown != nil {
			go shutdown()
		}
	})
	mux.HandleFunc("GET /v1/me/profile", func(w http.ResponseWriter, r *http.Request) {
		if profiles == nil || actorID == "" {
			writeError(w, http.StatusServiceUnavailable, "profile service is not ready")
			return
		}
		profile, err := profiles.Get(r.Context(), actorID)
		if errors.Is(err, application.ErrNotFound) {
			writeJSON(w, http.StatusOK, domain.UserProfile{
				UserID: actorID, Skills: []string{}, AvailableForSearches: true,
			})
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not read profile")
			return
		}
		writeJSON(w, http.StatusOK, profile)
	})
	mux.HandleFunc("PUT /v1/me/profile", func(w http.ResponseWriter, r *http.Request) {
		if profiles == nil || actorID == "" {
			writeError(w, http.StatusServiceUnavailable, "profile service is not ready")
			return
		}
		if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
			writeError(w, http.StatusUnsupportedMediaType, "content type must be application/json")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
		var profile domain.UserProfile
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&profile); err != nil {
			writeError(w, http.StatusBadRequest, "invalid profile JSON")
			return
		}
		if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "request must contain one JSON value")
			return
		}
		profile, err := profiles.Save(r.Context(), actorID, profile)
		if err != nil {
			if errors.Is(err, domain.ErrInvalidModel) {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeError(w, http.StatusInternalServerError, "could not save profile")
			return
		}
		writeJSON(w, http.StatusOK, profile)
	})
	mux.HandleFunc("GET /v1/roles", func(w http.ResponseWriter, _ *http.Request) {
		type roleDescription struct {
			Role                  domain.Role `json:"role"`
			Label                 string      `json:"label"`
			Description           string      `json:"description"`
			CanManageSearches     bool        `json:"can_manage_searches"`
			CanManageUsers        bool        `json:"can_manage_users"`
			CanUpdateAssignedTask bool        `json:"can_update_assigned_task"`
			ReadOnly              bool        `json:"read_only"`
		}
		roles := domain.RoleCatalog()
		result := make([]roleDescription, 0, len(roles))
		for _, definition := range roles {
			role := definition.Role
			result = append(result, roleDescription{
				Role: role, Label: definition.Label, Description: definition.Description,
				CanManageSearches: role.CanManageSearches(), CanManageUsers: role.CanManageUsers(),
				CanUpdateAssignedTask: role.CanUpdateAssignedTask(), ReadOnly: role.IsReadOnly(),
			})
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /v1/searches", func(w http.ResponseWriter, r *http.Request) {
		if searches == nil || actorID == "" {
			writeError(w, http.StatusServiceUnavailable, "search service is not ready")
			return
		}
		if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
			writeError(w, http.StatusUnsupportedMediaType, "content type must be application/json")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
		var command application.CreateSearchCommand
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&command); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON request")
			return
		}
		if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "request must contain one JSON value")
			return
		}
		search, err := searches.Create(r.Context(), actorID, command)
		if err != nil {
			if errors.Is(err, domain.ErrInvalidModel) {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeError(w, http.StatusInternalServerError, "could not create search")
			return
		}
		writeJSON(w, http.StatusCreated, search)
	})
	mux.HandleFunc("GET /v1/searches", func(w http.ResponseWriter, r *http.Request) {
		if searches == nil {
			writeError(w, http.StatusServiceUnavailable, "search service is not ready")
			return
		}
		filter := application.SearchFilter{}
		query := r.URL.Query()
		if raw := query.Get("status"); raw != "" {
			status := domain.SearchStatus(raw)
			if !status.Valid() {
				writeError(w, http.StatusBadRequest, "unsupported search status")
				return
			}
			filter.Status = &status
		}
		var err error
		if raw := query.Get("limit"); raw != "" {
			filter.Limit, err = strconv.Atoi(raw)
			if err != nil {
				writeError(w, http.StatusBadRequest, "limit must be an integer")
				return
			}
		}
		if raw := query.Get("offset"); raw != "" {
			filter.Offset, err = strconv.Atoi(raw)
			if err != nil {
				writeError(w, http.StatusBadRequest, "offset must be an integer")
				return
			}
		}
		result, err := searches.List(r.Context(), filter)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid search filter")
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /v1/searches/{id}", func(w http.ResponseWriter, r *http.Request) {
		if searches == nil {
			writeError(w, http.StatusServiceUnavailable, "search service is not ready")
			return
		}
		search, err := searches.Get(r.Context(), domain.ID(r.PathValue("id")))
		if errors.Is(err, application.ErrNotFound) {
			writeError(w, http.StatusNotFound, "search not found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not read search")
			return
		}
		writeJSON(w, http.StatusOK, search)
	})
	return mux
}

func NewHealthHandler(version string) http.Handler {
	return NewHandler(version, nil, nil, "", nil)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	body, err := json.Marshal(value)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not encode response")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, errorResponse{Error: message})
}
