// Package remoteauth implements an experimental in-memory server session.
// It does not authorize the local SQLite prototype or synchronize its data.
package remoteauth

import (
    "bytes"
    "context"
    "encoding/json"
    "errors"
    "io"
    "net"
    "net/http"
    "net/url"
    "strings"
    "sync"
    "time"
)

var ErrInvalidServer = errors.New("invalid server address")
var ErrCredentials = errors.New("invalid credentials")
var ErrUnavailable = errors.New("server unavailable")
var ErrAlreadySignedIn = errors.New("already signed in")

type User struct {
    ID string `json:"id"`
    Name string `json:"name"`
    Role string `json:"role"`
}

type Session struct {
    mu sync.Mutex
    client *http.Client
    base string
    token string
    user User
}

func New() *Session {
    transport := http.DefaultTransport.(*http.Transport).Clone()
    // Never leak credentials to proxy settings inherited from the environment.
    transport.Proxy = nil
    return &Session{client: &http.Client{Transport: transport, Timeout: 4*time.Second,
        CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

func serverURL(raw string) (string, error) {
    u, err := url.Parse(strings.TrimSpace(raw))
    if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || u.Opaque != "" {
        return "", ErrInvalidServer
    }
    if u.Scheme != "https" {
        // HTTP is only for a server on the same machine, never LAN or DNS names.
        ip := net.ParseIP(u.Hostname())
        if u.Scheme != "http" || ip == nil || !ip.IsLoopback() { return "", ErrInvalidServer }
    }
    return strings.TrimSuffix(u.String(), "/"), nil
}

func (s *Session) Login(ctx context.Context, server, login, password string) (User, error) {
    s.mu.Lock(); defer s.mu.Unlock()
    if s.token != "" { return User{}, ErrAlreadySignedIn }
    base, err := serverURL(server)
    if err != nil { return User{}, err }
    if strings.TrimSpace(login) == "" || password == "" { return User{}, ErrCredentials }
    payload, err := json.Marshal(map[string]string{"login": strings.TrimSpace(login), "password": password})
    if err != nil { return User{}, ErrUnavailable }
    req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/api/v1/auth/login", bytes.NewReader(payload))
    if err != nil { return User{}, ErrInvalidServer }
    req.Header.Set("Content-Type", "application/json")
    res, err := s.client.Do(req)
    if err != nil { return User{}, ErrUnavailable }
    defer res.Body.Close()
    if res.StatusCode == http.StatusUnauthorized { return User{}, ErrCredentials }
    if res.StatusCode != http.StatusOK { return User{}, ErrUnavailable }
    data, err := io.ReadAll(io.LimitReader(res.Body, 16385))
    if err != nil || len(data) > 16384 { return User{}, ErrUnavailable }
    var result struct { Token string `json:"token"`; User User `json:"user"` }
    if json.Unmarshal(data, &result) != nil || result.Token == "" || result.User.ID == "" { return User{}, ErrUnavailable }
    s.base, s.token, s.user = base, result.Token, result.User
    return s.user, nil
}

func (s *Session) Logout(ctx context.Context) error {
    s.mu.Lock(); defer s.mu.Unlock()
    base, token := s.base, s.token
    s.base, s.token, s.user = "", "", User{}
    if token == "" { return nil }
    req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/api/v1/auth/logout", nil)
    if err != nil { return ErrUnavailable }
    req.Header.Set("Authorization", "Bearer "+token)
    res, err := s.client.Do(req)
    if err != nil { return ErrUnavailable }
    defer res.Body.Close()
    if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusNoContent { return ErrUnavailable }
    return nil
}

// SearchSummary is deliberately limited to fields needed for a test-only view.
// The legacy server still sends additional fields and its access model is not
// the agreed production policy; never use this API with real personal data.
type SearchSummary struct {
    ID string `json:"id"`
    Title string `json:"title"`
    Status string `json:"status"`
}

var ErrSignedOut = errors.New("server session is not active")
var ErrNotFound = errors.New("search is not available")
var ErrForbidden = errors.New("access denied")

// Read operations never return the bearer token through the local IPC API.
// A lock serializes upstream requests with logout; callers must also clear
// any displayed results when signing out or a request fails.
func (s *Session) readSearches(ctx context.Context, path string, output any) error {
    s.mu.Lock(); defer s.mu.Unlock()
    if s.token == "" { return ErrSignedOut }
    req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.base+path, nil)
    if err != nil { return ErrUnavailable }
    req.Header.Set("Authorization", "Bearer "+s.token)
    res, err := s.client.Do(req)
    if err != nil { return ErrUnavailable }
    defer res.Body.Close()
    switch res.StatusCode {
    case http.StatusUnauthorized:
        s.base, s.token, s.user = "", "", User{}
        return ErrSignedOut
    case http.StatusForbidden: return ErrForbidden
    case http.StatusNotFound: return ErrNotFound
    case http.StatusOK:
    default: return ErrUnavailable
    }
    const limit = 1 << 20
    data, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
    if err != nil || len(data) > limit || json.Unmarshal(data, output) != nil { return ErrUnavailable }
    return nil
}

func (s *Session) Searches(ctx context.Context) ([]SearchSummary, error) {
    var result []SearchSummary
    if err := s.readSearches(ctx, "/api/v1/searches", &result); err != nil { return nil, err }
    if result == nil { return nil, ErrUnavailable }
    for _, item := range result {
        if !validSearchID(item.ID) || item.Title == "" || item.Status == "" { return nil, ErrUnavailable }
    }
    return result, nil
}

func validSearchID(id string) bool {
    if len(id) != 36 { return false }
    for i, c := range id {
        if i == 8 || i == 13 || i == 18 || i == 23 { if c != '-' { return false }; continue }
        if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') { return false }
    }
    return true
}

func (s *Session) Search(ctx context.Context, id string) (SearchSummary, error) {
    if !validSearchID(id) { return SearchSummary{}, ErrNotFound }
    var result SearchSummary
    if err := s.readSearches(ctx, "/api/v1/searches/"+id, &result); err != nil { return SearchSummary{}, err }
    if !strings.EqualFold(result.ID, id) || result.Title == "" || result.Status == "" { return SearchSummary{}, ErrUnavailable }
    return result, nil
}
