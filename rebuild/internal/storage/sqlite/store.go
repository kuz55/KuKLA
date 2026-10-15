package sqlite

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kuz55/KuKLA/rebuild/internal/application"
	"github.com/kuz55/KuKLA/rebuild/internal/domain"
	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

const (
	defaultBusyTimeout = 5 * time.Second
	defaultListLimit   = 50
	maximumListLimit   = 200
)

var migrationMu sync.Mutex

// Store owns the local database and implements the search repositories and
// transactional unit of work used by the application layer.
type Store struct {
	db *sql.DB
}

func Open(ctx context.Context, path string) (*Store, error) {
	if path == "" {
		return nil, errors.New("database path is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create database directory: %w", err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open SQLite database: %w", err)
	}
	// A single connection ensures connection-local pragmas apply consistently
	// and serializes writes from this local desktop process.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	store := &Store{db: db}
	if err := store.initialize(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) initialize(ctx context.Context) error {
	if err := s.db.PingContext(ctx); err != nil {
		return fmt.Errorf("connect to SQLite database: %w", err)
	}
	for _, pragma := range []string{
		"PRAGMA foreign_keys = ON",
		"PRAGMA busy_timeout = 5000",
		"PRAGMA journal_mode = WAL",
		"PRAGMA synchronous = FULL",
	} {
		if _, err := s.db.ExecContext(ctx, pragma); err != nil {
			return fmt.Errorf("configure SQLite (%s): %w", pragma, err)
		}
	}
	return s.Migrate(ctx)
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) Migrate(ctx context.Context) error {
	migrationMu.Lock()
	defer migrationMu.Unlock()
	if _, err := s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		checksum TEXT NOT NULL,
		applied_at TEXT NOT NULL
	) STRICT`); err != nil {
		return fmt.Errorf("create migration ledger: %w", err)
	}
	files, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return fmt.Errorf("list migrations: %w", err)
	}
	sort.Strings(files)
	for _, name := range files {
		base := filepath.Base(name)
		prefix, _, ok := strings.Cut(base, "_")
		if !ok {
			return fmt.Errorf("invalid migration filename %q", base)
		}
		version, err := strconv.Atoi(prefix)
		if err != nil || version < 1 {
			return fmt.Errorf("invalid migration version in %q", base)
		}
		source, err := migrations.ReadFile(name)
		if err != nil {
			return fmt.Errorf("read migration %q: %w", base, err)
		}
		digest := sha256.Sum256(source)
		checksum := hex.EncodeToString(digest[:])
		var appliedChecksum string
		lookupErr := s.db.QueryRowContext(ctx, "SELECT checksum FROM schema_migrations WHERE version = ?", version).Scan(&appliedChecksum)
		if lookupErr == nil {
			if appliedChecksum != checksum {
				return fmt.Errorf("migration %q changed after it was applied", base)
			}
			continue
		}
		if !errors.Is(lookupErr, sql.ErrNoRows) {
			return fmt.Errorf("check migration %q: %w", base, lookupErr)
		}
		if err := s.applyMigration(ctx, version, base, checksum, string(source)); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) applyMigration(ctx context.Context, version int, name, checksum, statement string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin migration %q: %w", name, err)
	}
	if _, err := tx.ExecContext(ctx, statement); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("apply migration %q: %w", name, err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations(version, name, checksum, applied_at)
		VALUES (?, ?, ?, ?)`, version, name, checksum, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("record migration %q: %w", name, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration %q: %w", name, err)
	}
	return nil
}

func (s *Store) WithinTransaction(ctx context.Context, fn func(application.Repositories) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	repositories := repositories{queryer: tx, execer: tx}
	if err := fn(application.Repositories{
		Searches:    repositories,
		Memberships: repositories,
		Audit:       repositories,
	}); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}

func (s *Store) Get(ctx context.Context, id domain.ID) (domain.Search, error) {
	return (repositories{queryer: s.db}).Get(ctx, id)
}

func (s *Store) List(ctx context.Context, filter application.SearchFilter) ([]domain.Search, error) {
	return (repositories{queryer: s.db}).List(ctx, filter)
}

func (s *Store) GetProfile(ctx context.Context, userID domain.ID) (domain.UserProfile, error) {
	row := s.db.QueryRowContext(ctx, `SELECT user_id, full_name, birth_date, city, district,
		extra_phone, skills_json, has_transport, available_for_searches,
		emergency_contact_name, emergency_contact_phone, consent_personal_data,
		verified, updated_at FROM user_profiles WHERE user_id = ?`, userID)
	profile, err := scanProfile(row)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.UserProfile{}, fmt.Errorf("profile for %q: %w", userID, application.ErrNotFound)
	}
	return profile, err
}

func (s *Store) SaveProfile(ctx context.Context, profile domain.UserProfile) error {
	if err := profile.Validate(); err != nil {
		return err
	}
	skills, err := json.Marshal(profile.Skills)
	if err != nil {
		return fmt.Errorf("encode profile skills: %w", err)
	}
	if profile.UpdatedAt.IsZero() {
		profile.UpdatedAt = time.Now().UTC()
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO user_profiles(
		user_id, full_name, birth_date, city, district, extra_phone, skills_json,
		has_transport, available_for_searches, emergency_contact_name,
		emergency_contact_phone, consent_personal_data, verified, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
	ON CONFLICT(user_id) DO UPDATE SET
		full_name=excluded.full_name, birth_date=excluded.birth_date,
		city=excluded.city, district=excluded.district, extra_phone=excluded.extra_phone,
		skills_json=excluded.skills_json, has_transport=excluded.has_transport,
		available_for_searches=excluded.available_for_searches,
		emergency_contact_name=excluded.emergency_contact_name,
		emergency_contact_phone=excluded.emergency_contact_phone,
		consent_personal_data=excluded.consent_personal_data,
		verified=0, updated_at=excluded.updated_at`,
		profile.UserID, profile.FullName, profile.BirthDate, profile.City, profile.District,
		profile.ExtraPhone, string(skills), profile.HasTransport, profile.AvailableForSearches,
		profile.EmergencyContactName, profile.EmergencyContactPhone,
		profile.ConsentPersonalData, profile.UpdatedAt.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return fmt.Errorf("save user profile: %w", err)
	}
	return nil
}

type queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type execer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

type repositories struct {
	queryer
	execer
}

func (r repositories) Create(ctx context.Context, search domain.Search) error {
	if err := search.Validate(); err != nil {
		return err
	}
	_, err := r.ExecContext(ctx, `INSERT INTO searches(
		id, title, status, area, description, incident_lat, incident_lng, created_by, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		search.ID, search.Title, search.Status, search.Area, search.Description,
		search.IncidentLat, search.IncidentLng, search.CreatedBy, search.CreatedAt.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return fmt.Errorf("insert search: %w", err)
	}
	return nil
}

func (r repositories) Get(ctx context.Context, id domain.ID) (domain.Search, error) {
	row := r.QueryRowContext(ctx, `SELECT id, title, status, area, description,
		incident_lat, incident_lng, created_by, created_at FROM searches WHERE id = ?`, id)
	search, err := scanSearch(row)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Search{}, fmt.Errorf("search %q: %w", id, application.ErrNotFound)
	}
	return search, err
}

func (r repositories) List(ctx context.Context, filter application.SearchFilter) ([]domain.Search, error) {
	if filter.Offset < 0 {
		return nil, errors.New("search offset cannot be negative")
	}
	limit := filter.Limit
	if limit == 0 {
		limit = defaultListLimit
	}
	if limit < 1 || limit > maximumListLimit {
		return nil, fmt.Errorf("search limit must be between 1 and %d", maximumListLimit)
	}
	query := `SELECT id, title, status, area, description, incident_lat, incident_lng, created_by, created_at FROM searches`
	args := make([]any, 0, 3)
	if filter.Status != nil {
		if !filter.Status.Valid() {
			return nil, fmt.Errorf("unsupported search status %q", *filter.Status)
		}
		query += " WHERE status = ?"
		args = append(args, *filter.Status)
	}
	query += " ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?"
	args = append(args, limit, filter.Offset)
	rows, err := r.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list searches: %w", err)
	}
	defer rows.Close()
	result := make([]domain.Search, 0)
	for rows.Next() {
		search, err := scanSearch(rows)
		if err != nil {
			return nil, fmt.Errorf("scan search: %w", err)
		}
		result = append(result, search)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read searches: %w", err)
	}
	return result, nil
}

func (r repositories) Add(ctx context.Context, searchID, userID domain.ID, joinedAt time.Time) error {
	_, err := r.ExecContext(ctx, `INSERT INTO search_members(search_id, user_id, joined_at)
		VALUES (?, ?, ?) ON CONFLICT(search_id, user_id) DO NOTHING`,
		searchID, userID, joinedAt.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return fmt.Errorf("add search member: %w", err)
	}
	return nil
}

func (r repositories) Append(ctx context.Context, event domain.AuditEvent) error {
	_, err := r.ExecContext(ctx, `INSERT INTO audit_events(id, search_id, user_id, event_type, payload_json, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		event.ID, event.SearchID, event.UserID, event.Type, string(event.Payload), event.CreatedAt.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return fmt.Errorf("append audit event: %w", err)
	}
	return nil
}

type scanner interface{ Scan(...any) error }

func scanSearch(row scanner) (domain.Search, error) {
	var search domain.Search
	var area, description sql.NullString
	var latitude, longitude sql.NullFloat64
	var createdAt string
	if err := row.Scan(&search.ID, &search.Title, &search.Status, &area, &description,
		&latitude, &longitude, &search.CreatedBy, &createdAt); err != nil {
		return domain.Search{}, err
	}
	search.Area = area.String
	search.Description = description.String
	if latitude.Valid {
		search.IncidentLat = &latitude.Float64
	}
	if longitude.Valid {
		search.IncidentLng = &longitude.Float64
	}
	parsed, err := time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return domain.Search{}, fmt.Errorf("parse created_at: %w", err)
	}
	search.CreatedAt = parsed.UTC()
	return search, nil
}

func scanProfile(row scanner) (domain.UserProfile, error) {
	var profile domain.UserProfile
	var skillsJSON, updatedAt string
	var hasTransport, available, consent, verified int
	if err := row.Scan(&profile.UserID, &profile.FullName, &profile.BirthDate,
		&profile.City, &profile.District, &profile.ExtraPhone, &skillsJSON,
		&hasTransport, &available, &profile.EmergencyContactName,
		&profile.EmergencyContactPhone, &consent, &verified, &updatedAt); err != nil {
		return domain.UserProfile{}, err
	}
	if err := json.Unmarshal([]byte(skillsJSON), &profile.Skills); err != nil {
		return domain.UserProfile{}, fmt.Errorf("decode profile skills: %w", err)
	}
	profile.HasTransport = hasTransport != 0
	profile.AvailableForSearches = available != 0
	profile.ConsentPersonalData = consent != 0
	profile.Verified = verified != 0
	parsed, err := time.Parse(time.RFC3339Nano, updatedAt)
	if err != nil {
		return domain.UserProfile{}, fmt.Errorf("parse profile updated_at: %w", err)
	}
	profile.UpdatedAt = parsed.UTC()
	return profile, nil
}
