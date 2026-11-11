package httpapi

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
    "net/http/httptest"
    "os"
    "strings"
    "testing"

    "github.com/kuz55/KuKLA/rebuild/internal/remoteauth"
)

// CI only: exercise the real server/PostgreSQL using explicitly synthetic data.
// The fixed loopback address prevents this test from targeting a real deployment.
func TestRemoteSearchesRealServer(t *testing.T) {
    if os.Getenv("KUKLA_DISPOSABLE_INTEGRATION") != "1" { t.Skip("requires disposable CI server") }
    const base = "http://127.0.0.1:8080"
    const login = "owner@kukla.local"
    const password = "owner-pass-123456"
    credentials := fmt.Sprintf(`{"login":%q,"password":%q}`,login,password)
    r, err := http.Post(base+"/api/v1/auth/login", "application/json", strings.NewReader(credentials))
    if err != nil { t.Fatal(err) }
    var auth struct { Token string `json:"token"` }
    if r.StatusCode != 200 || json.NewDecoder(r.Body).Decode(&auth) != nil || auth.Token == "" { r.Body.Close(); t.Fatal("test login failed") }
    r.Body.Close()
    req, err := http.NewRequest("POST", base+"/api/v1/searches", bytes.NewBufferString(`{"title":"Synthetic desktop integration test"}`))
    if err != nil { t.Fatal(err) }
    req.Header.Set("Authorization", "Bearer "+auth.Token)
    req.Header.Set("Content-Type", "application/json")
    r, err = http.DefaultClient.Do(req); if err != nil { t.Fatal(err) }
    var created struct { ID string `json:"id"` }
    if r.StatusCode != 200 || json.NewDecoder(r.Body).Decode(&created) != nil || created.ID == "" { r.Body.Close(); t.Fatal("test search creation failed") }
    r.Body.Close()

    handler := NewHandler("test", nil,nil,"",nil,remoteauth.New())
    request := func(method, path, body string) *httptest.ResponseRecorder {
        rec := httptest.NewRecorder(); handler.ServeHTTP(rec,httptest.NewRequest(method,path,strings.NewReader(body))); return rec
    }
    localLogin := fmt.Sprintf(`{"server":%q,"login":%q,"password":%q}`,base,login,password)
    if rec := request("POST","/v1/remote/login",localLogin); rec.Code != 200 { t.Fatalf("local login: %d",rec.Code) }
    rec := request("GET","/v1/remote/searches","")
    if rec.Code != 200 || !strings.Contains(rec.Body.String(),created.ID) { t.Fatalf("list: %d",rec.Code) }
    rec = request("GET","/v1/remote/searches/"+created.ID,"")
    if rec.Code != 200 || !strings.Contains(rec.Body.String(),"Synthetic desktop integration test") { t.Fatalf("card: %d",rec.Code) }
    if rec := request("POST","/v1/remote/logout", "{}"); rec.Code != 200 { t.Fatalf("logout: %d",rec.Code) }
    if rec := request("GET","/v1/remote/searches",""); rec.Code != 401 { t.Fatalf("signed out: %d",rec.Code) }
}
