package remoteauth

import (
    "context"
    "fmt"
    "net/http"
    "net/http/httptest"
    "strings"
    "sync/atomic"
    "testing"
)

const searchID = "12345678-1234-1234-1234-123456789abc"

func TestRemoteSearchesSessionAndPrivacy(t *testing.T) {
    var unauthorized atomic.Bool
    var calls atomic.Int32
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if r.URL.Path == "/api/v1/auth/login" {
            fmt.Fprint(w, `{"token":"secret-token","user":{"id":"user"}}`); return
        }
        if r.URL.Path == "/api/v1/auth/logout" { w.WriteHeader(200); return }
        calls.Add(1)
        if r.Header.Get("Authorization") != "Bearer secret-token" { t.Error("missing authorization"); w.WriteHeader(401); return }
        if unauthorized.Load() { w.WriteHeader(401); return }
        switch r.URL.Path {
        case "/api/v1/searches": fmt.Fprintf(w, `[{"id":%q,"title":"Test","status":"PLANNED","description":"private"}]`,searchID)
        case "/api/v1/searches/"+searchID: fmt.Fprintf(w, `{"id":%q,"title":"Test","status":"PLANNED","description":"private"}`,searchID)
        default: w.WriteHeader(404)
        }
    }))
    defer srv.Close()
    s := New(); ctx := context.Background()
    if _, err := s.Searches(ctx); err != ErrSignedOut { t.Fatalf("unsigned: %v",err) }
    if _, err := s.Login(ctx,srv.URL,"user","password"); err != nil { t.Fatal(err) }
    list, err := s.Searches(ctx); if err != nil || len(list) != 1 || list[0].ID != searchID { t.Fatalf("list: %#v %v",list,err) }
    item, err := s.Search(ctx,searchID); if err != nil || item.Title != "Test" { t.Fatalf("detail: %#v %v",item,err) }
    before := calls.Load()
    if _, err := s.Search(ctx, "../auth/logout"); err != ErrNotFound || calls.Load() != before { t.Fatal("invalid id reached server") }
    unauthorized.Store(true)
    if _, err := s.Searches(ctx); err != ErrSignedOut { t.Fatalf("revoked: %v",err) }
    before = calls.Load()
    if _, err := s.Searches(ctx); err != ErrSignedOut || calls.Load() != before { t.Fatal("revoked session not cleared") }
}

func TestRemoteSearchMalformedAndDenied(t *testing.T) {
    var mode atomic.Int32
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if strings.HasSuffix(r.URL.Path,"/login") { fmt.Fprint(w, `{"token":"token","user":{"id":"user"}}`); return }
        switch mode.Load() {
        case 0: fmt.Fprint(w, `null`)
        case 1: fmt.Fprint(w, strings.Repeat("x", (1<<20)+1))
        case 2: w.WriteHeader(403)
        case 3: w.WriteHeader(404)
        case 4: fmt.Fprint(w, `[{"id":"invalid","title":"t","status":"PLANNED"}]`)
        }
    }))
    defer srv.Close()
    s := New(); ctx := context.Background(); if _, err := s.Login(ctx,srv.URL,"a","b"); err != nil { t.Fatal(err) }
    for i, expected := range []error{ErrUnavailable, ErrUnavailable, ErrForbidden, ErrNotFound, ErrUnavailable} {
        mode.Store(int32(i)); if _, err := s.Searches(ctx); err != expected { t.Fatalf("mode %d: %v",i,err) }
    }
}
