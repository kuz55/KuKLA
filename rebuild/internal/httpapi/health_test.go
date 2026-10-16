package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealthHandlerIsReadOnlyAndNoStore(t *testing.T) {
	handler := NewHealthHandler("test-version")
	request := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
	if !strings.Contains(response.Body.String(), `"status":"ok"`) || !strings.Contains(response.Body.String(), `"version":"test-version"`) {
		t.Fatalf("unexpected health response: %s", response.Body.String())
	}

	post := httptest.NewRequest(http.MethodPost, "/v1/health", nil)
	postResponse := httptest.NewRecorder()
	handler.ServeHTTP(postResponse, post)
	if postResponse.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST status = %d, want 405", postResponse.Code)
	}
}
