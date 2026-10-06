package domain

import (
	"errors"
	"fmt"
	"math"
	"time"
	"unicode/utf16"
)

// ID is an opaque, application-generated identifier. Concrete repositories
// decide how IDs are stored; SQLite will store UUID text in the first schema.
type ID string

var ErrInvalidModel = errors.New("invalid domain model")

// SearchStatus preserves the status codes found in the existing repository.
// This type validates individual values only; it does not define transition
// policy, which must be supplied by an approved workflow specification.
type SearchStatus string

const (
	SearchPlanned   SearchStatus = "PLANNED"
	SearchActive    SearchStatus = "ACTIVE"
	SearchPaused    SearchStatus = "PAUSED"
	SearchCompleted SearchStatus = "COMPLETED"
	SearchCancelled SearchStatus = "CANCELLED"
)

func (s SearchStatus) Valid() bool {
	switch s {
	case SearchPlanned, SearchActive, SearchPaused, SearchCompleted, SearchCancelled:
		return true
	default:
		return false
	}
}

// TaskStatus preserves the status codes in the current SQL/API contracts.
type TaskStatus string

const (
	TaskOpen       TaskStatus = "OPEN"
	TaskInProgress TaskStatus = "IN_PROGRESS"
	TaskDone       TaskStatus = "DONE"
	TaskCancelled  TaskStatus = "CANCELLED"
)

func (s TaskStatus) Valid() bool {
	switch s {
	case TaskOpen, TaskInProgress, TaskDone, TaskCancelled:
		return true
	default:
		return false
	}
}

// PositionSource is required by the VM/offline requirements so imported and
// simulated positions can never be presented as live device GPS.
type PositionSource string

const (
	PositionDevice     PositionSource = "DEVICE"
	PositionManual     PositionSource = "MANUAL"
	PositionSimulation PositionSource = "SIMULATION"
	PositionImport     PositionSource = "IMPORT"
)

func (s PositionSource) Valid() bool {
	switch s {
	case PositionDevice, PositionManual, PositionSimulation, PositionImport:
		return true
	default:
		return false
	}
}

// Search is the operational-search aggregate. Latitude/longitude remain
// independently optional, matching the current API's input contract.
type Search struct {
	ID          ID           `json:"id"`
	Title       string       `json:"title"`
	Status      SearchStatus `json:"status"`
	Area        string       `json:"area,omitempty"`
	Description string       `json:"description,omitempty"`
	IncidentLat *float64     `json:"incident_lat,omitempty"`
	IncidentLng *float64     `json:"incident_lng,omitempty"`
	CreatedBy   ID           `json:"created_by"`
	CreatedAt   time.Time    `json:"created_at"`
}

// Validate preserves the existing minimum title length (two UTF-16 code
// units, as JavaScript string length does) and known search-status values.
// It intentionally does not trim the title or invent status-transition rules.
func (s Search) Validate() error {
	if len(utf16.Encode([]rune(s.Title))) < 2 {
		return fmt.Errorf("%w: title must contain at least 2 UTF-16 code units", ErrInvalidModel)
	}
	if !s.Status.Valid() {
		return fmt.Errorf("%w: unsupported search status %q", ErrInvalidModel, s.Status)
	}
	if s.IncidentLat != nil && (*s.IncidentLat < -90 || *s.IncidentLat > 90 || math.IsNaN(*s.IncidentLat) || math.IsInf(*s.IncidentLat, 0)) {
		return fmt.Errorf("%w: incident latitude outside [-90, 90]", ErrInvalidModel)
	}
	if s.IncidentLng != nil && (*s.IncidentLng < -180 || *s.IncidentLng > 180 || math.IsNaN(*s.IncidentLng) || math.IsInf(*s.IncidentLng, 0)) {
		return fmt.Errorf("%w: incident longitude outside [-180, 180]", ErrInvalidModel)
	}
	return nil
}

// Task represents a task assigned to an operation. Assignment constraints
// (assignee must be a search member, role limits) belong in application policy.
type Task struct {
	ID          ID         `json:"id"`
	SearchID    ID         `json:"search_id"`
	AssigneeID  *ID        `json:"assignee_id,omitempty"`
	CreatedBy   ID         `json:"created_by"`
	Title       string     `json:"title"`
	Description string     `json:"description,omitempty"`
	Status      TaskStatus `json:"status"`
	Priority    int        `json:"priority"`
	Lat         *float64   `json:"lat,omitempty"`
	Lng         *float64   `json:"lng,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
}

func (t Task) Validate() error {
	if len(utf16.Encode([]rune(t.Title))) < 2 {
		return fmt.Errorf("%w: task title must contain at least 2 UTF-16 code units", ErrInvalidModel)
	}
	if !t.Status.Valid() {
		return fmt.Errorf("%w: unsupported task status %q", ErrInvalidModel, t.Status)
	}
	if t.Priority < 1 || t.Priority > 3 {
		return fmt.Errorf("%w: task priority must be between 1 and 3", ErrInvalidModel)
	}
	if t.Lat != nil && (*t.Lat < -90 || *t.Lat > 90 || math.IsNaN(*t.Lat) || math.IsInf(*t.Lat, 0)) {
		return fmt.Errorf("%w: task latitude outside [-90, 90]", ErrInvalidModel)
	}
	if t.Lng != nil && (*t.Lng < -180 || *t.Lng > 180 || math.IsNaN(*t.Lng) || math.IsInf(*t.Lng, 0)) {
		return fmt.Errorf("%w: task longitude outside [-180, 180]", ErrInvalidModel)
	}
	return nil
}

// Position stores the original observation time separately from local receipt
// time so delayed/offline positions can be replayed without rewriting history.
type Position struct {
	ID          ID             `json:"id"`
	SearchID    ID             `json:"search_id"`
	UserID      ID             `json:"user_id"`
	Lat         float64        `json:"lat"`
	Lng         float64        `json:"lng"`
	AccuracyM   *float64       `json:"accuracy_m,omitempty"`
	AltitudeM   *float64       `json:"altitude_m,omitempty"`
	SpeedMPS    *float64       `json:"speed_mps,omitempty"`
	RecordedAt  time.Time      `json:"recorded_at"`
	ReceivedAt  time.Time      `json:"received_at"`
	Source      PositionSource `json:"source"`
	DeviceID    ID             `json:"device_id,omitempty"`
}

func (p Position) Validate() error {
	if math.IsNaN(p.Lat) || math.IsInf(p.Lat, 0) || p.Lat < -90 || p.Lat > 90 {
		return fmt.Errorf("%w: latitude outside [-90, 90]", ErrInvalidModel)
	}
	if math.IsNaN(p.Lng) || math.IsInf(p.Lng, 0) || p.Lng < -180 || p.Lng > 180 {
		return fmt.Errorf("%w: longitude outside [-180, 180]", ErrInvalidModel)
	}
	if p.AccuracyM != nil && (*p.AccuracyM < 0 || math.IsNaN(*p.AccuracyM) || math.IsInf(*p.AccuracyM, 0)) {
		return fmt.Errorf("%w: accuracy must be finite and non-negative", ErrInvalidModel)
	}
	if p.SpeedMPS != nil && (*p.SpeedMPS < 0 || math.IsNaN(*p.SpeedMPS) || math.IsInf(*p.SpeedMPS, 0)) {
		return fmt.Errorf("%w: speed must be finite and non-negative", ErrInvalidModel)
	}
	if !p.Source.Valid() {
		return fmt.Errorf("%w: unsupported position source %q", ErrInvalidModel, p.Source)
	}
	return nil
}

// AuditEvent is append-only at the application boundary. Storage integrity,
// hashing and retention are implemented with the persistence stage.
type AuditEvent struct {
	ID        ID        `json:"id"`
	SearchID  ID        `json:"search_id"`
	UserID    ID        `json:"user_id"`
	Type      string    `json:"type"`
	Payload   []byte    `json:"payload,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}
