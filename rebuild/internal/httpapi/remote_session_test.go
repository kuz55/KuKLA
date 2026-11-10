package httpapi

import (
    "fmt"
    "net/http"
    "net/http/httptest"
    "strings"
    "testing"

    "github.com/kuz55/KuKLA/rebuild/internal/remoteauth"
)

func TestRemoteSessionLocalAPI(t *testing.T) {
    api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        switch r.URL.Path {
        case "/api/v1/auth/login": fmt.Fprint(w, `{"token":"never-expose-this-token","user":{"id":"1","name":"Test","role":"VIEWER"}}`)
        case "/api/v1/auth/logout": if r.Header.Get("Authorization") != "Bearer never-expose-this-token" { w.WriteHeader(401); return }; w.WriteHeader(200)
        default: w.WriteHeader(404)
        }
    }))
    defer api.Close()
    handler := NewHandler("test", nil, nil, "", nil, remoteauth.New())
    login := fmt.Sprintf(`{"server":%q,"login":"test","password":"test"}`, api.URL)
    res := httptest.NewRecorder()
    handler.ServeHTTP(res, httptest.NewRequest("POST", "/v1/remote/login", strings.NewReader(login)))
    if res.Code != 200 || strings.Contains(res.Body.String(), "never-expose-this-token") || !strings.Contains(res.Body.String(), `"name":"Test"`) { t.Fatalf("unsafe or invalid response: %d %s",res.Code,res.Body.String()) }
    if res.Header().Get("Cache-Control") != "no-store" { t.Fatal("response must not be cached") }
    res = httptest.NewRecorder()
    handler.ServeHTTP(res, httptest.NewRequest("POST", "/v1/remote/logout", strings.NewReader(`{}`)))
    if res.Code != 200 { t.Fatalf("logout: %d",res.Code) }
    res = httptest.NewRecorder()
    handler.ServeHTTP(res, httptest.NewRequest("POST", "/v1/remote/login", strings.NewReader(`{"server":"http://192.168.0.84","login":"x","password":"y"}`)))
    if res.Code != 400 { t.Fatalf("plaintext LAN should be rejected: %d",res.Code) }
}
