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
