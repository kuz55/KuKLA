package remoteauth

import (
    "context"
    "encoding/json"
    "fmt"
    "net/http"
    "net/http/httptest"
    "strings"
    "sync/atomic"
    "testing"
)

func TestAddressPolicy(t *testing.T) {
    for _, good := range []string{"https://example.test", "https://192.168.0.84:443", "http://127.0.0.1:18080", "http://[::1]:18080"} {
        if _, err := serverURL(good); err != nil { t.Errorf("%s: %v", good, err) }
    }
    for _, bad := range []string{"http://192.168.0.84:18080", "http://localhost:18080", "https://example.test/path", "https://u:p@example.test", "https://example.test/?secret=x", "ftp://example.test", "https://example.test/#x"} {
        if _, err := serverURL(bad); err == nil { t.Errorf("expected rejection for %s", bad) }
    }
}

func TestLoginAndLogout(t *testing.T) {
    var logouts atomic.Int32
    server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        switch r.URL.Path {
        case "/api/v1/auth/login":
            var body map[string]string
            if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body["login"] != "test" || body["password"] != "password" { w.WriteHeader(401); return }
            fmt.Fprint(w, `{"token":"test-token","user":{"id":"id","name":"Test","role":"VIEWER"}}`)
        case "/api/v1/auth/logout":
            if r.Header.Get("Authorization") != "Bearer test-token" { w.WriteHeader(401); return }
            logouts.Add(1); w.WriteHeader(200)
        default: w.WriteHeader(404)
        }
    }))
    defer server.Close()
    session := New()
    if _, err := session.Login(context.Background(), server.URL, "test", "wrong"); err != ErrCredentials { t.Fatalf("bad password: %v", err) }
    user, err := session.Login(context.Background(), server.URL, "test", "password")
    if err != nil || user.ID != "id" { t.Fatalf("login: %v, %#v", err, user) }
    if _, err := session.Login(context.Background(), server.URL, "test", "password"); err != ErrAlreadySignedIn { t.Fatalf("second login: %v", err) }
    if err := session.Logout(context.Background()); err != nil { t.Fatal(err) }
    if err := session.Logout(context.Background()); err != nil || logouts.Load() != 1 { t.Fatalf("logout: %v", err) }
}

func TestRejectRedirectAndClearSessionOnLogoutFailure(t *testing.T) {
    var leaked atomic.Bool
    target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { leaked.Store(true) }))
    defer target.Close()
    redirects := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w,r,target.URL,http.StatusTemporaryRedirect) }))
    defer redirects.Close()
    s := New()
    if _, err := s.Login(context.Background(), redirects.URL, "test", "password"); err != ErrUnavailable { t.Fatalf("redirect: %v", err) }
    if leaked.Load() { t.Fatal("credentials sent to redirect target") }
    server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if strings.HasSuffix(r.URL.Path, "/login") { fmt.Fprint(w, `{"token":"t","user":{"id":"id"}}`); return }
        w.WriteHeader(500)
    }))
    defer server.Close()
    if _, err := s.Login(context.Background(),server.URL,"test","password"); err != nil { t.Fatal(err) }
    if err := s.Logout(context.Background()); err != ErrUnavailable { t.Fatalf("logout: %v", err) }
    if _, err := s.Login(context.Background(),server.URL,"test","password"); err != nil { t.Fatalf("session not cleared: %v", err) }
}
