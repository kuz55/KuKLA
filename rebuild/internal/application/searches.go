package application

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/kuz55/KuKLA/rebuild/internal/domain"
)

type SearchApplication struct {
	uow    UnitOfWork
	reader SearchReader
	now    func() time.Time
	newID  func() (domain.ID, error)
}

func NewSearchApplication(uow UnitOfWork, reader SearchReader) *SearchApplication {
	return &SearchApplication{uow: uow, reader: reader, now: func() time.Time { return time.Now().UTC() }, newID: newUUID}
}

func (s *SearchApplication) Create(ctx context.Context, actorID domain.ID, command CreateSearchCommand) (domain.Search, error) {
	if actorID == "" {
		return domain.Search{}, fmt.Errorf("actor is required")
	}
	id, err := s.newID()
	if err != nil {
		return domain.Search{}, fmt.Errorf("generate search id: %w", err)
	}

	search := domain.Search{
		ID:          id,
		Title:       command.Title,
		Status:      domain.SearchPlanned,
		Area:        command.Area,
		Description: command.Description,
		IncidentLat: command.IncidentLat,
		IncidentLng: command.IncidentLng,
		CreatedBy:   actorID,
		CreatedAt:   s.now().UTC(),
	}
	if err := search.Validate(); err != nil {
		return domain.Search{}, err
	}

	payload, err := json.Marshal(struct {
		Title string `json:"title"`
	}{Title: search.Title})
	if err != nil {
		return domain.Search{}, fmt.Errorf("encode audit payload: %w", err)
	}
	eventID, err := s.newID()
	if err != nil {
		return domain.Search{}, fmt.Errorf("generate audit id: %w", err)
	}
	audit := domain.AuditEvent{
		ID:        eventID,
		SearchID:  search.ID,
		UserID:    actorID,
		Type:      "SEARCH_CREATED",
		Payload:   payload,
		CreatedAt: search.CreatedAt,
	}

	err = s.uow.WithinTransaction(ctx, func(repositories Repositories) error {
		if err := repositories.Searches.Create(ctx, search); err != nil {
			return fmt.Errorf("create search: %w", err)
		}
		if err := repositories.Memberships.Add(ctx, search.ID, actorID, search.CreatedAt); err != nil {
			return fmt.Errorf("add creator to search: %w", err)
		}
		if err := repositories.Audit.Append(ctx, audit); err != nil {
			return fmt.Errorf("append search audit event: %w", err)
		}
		return nil
	})
	if err != nil {
		return domain.Search{}, err
	}
	return search, nil
}

func (s *SearchApplication) Get(ctx context.Context, id domain.ID) (domain.Search, error) {
	return s.reader.Get(ctx, id)
}

func (s *SearchApplication) List(ctx context.Context, filter SearchFilter) ([]domain.Search, error) {
	return s.reader.List(ctx, filter)
}

func newUUID() (domain.ID, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(value[:])
	return domain.ID(encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32]), nil
}
