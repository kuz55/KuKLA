//go:build !windows

package ipc

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestListenUsesOwnerOnlySocketAndRejectsSecondEngine(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "engine.sock")
	listener, err := Listen(socketPath)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	info, err := os.Stat(socketPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("socket mode = %o, want 600", got)
	}
	if _, err := Listen(socketPath); !errors.Is(err, ErrAlreadyRunning) {
		t.Fatalf("second listener error = %v, want ErrAlreadyRunning", err)
	}
}

func TestListenDoesNotReplaceRegularFile(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "engine.sock")
	if err := os.WriteFile(socketPath, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Listen(socketPath); err == nil {
		t.Fatal("listener must refuse to replace a regular file")
	}
	contents, err := os.ReadFile(socketPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "keep" {
		t.Fatalf("regular file was changed: %q", contents)
	}
}
