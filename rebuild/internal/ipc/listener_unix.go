//go:build !windows

package ipc

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"time"
)

var ErrAlreadyRunning = errors.New("KuKLA engine is already running")

// Listen creates a private Unix-domain socket. The parent directory is
// application-owned and must already have owner-only permissions.
func Listen(path string) (net.Listener, error) {
	if !filepath.IsAbs(path) {
		return nil, fmt.Errorf("socket path must be absolute")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create socket directory: %w", err)
	}
	if err := os.Chmod(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("restrict socket directory permissions: %w", err)
	}

	if info, err := os.Lstat(path); err == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return nil, fmt.Errorf("refusing to replace non-socket at %q", path)
		}
		connection, dialErr := net.DialTimeout("unix", path, 150*time.Millisecond)
		if dialErr == nil {
			_ = connection.Close()
			return nil, ErrAlreadyRunning
		}
		if err := os.Remove(path); err != nil {
			return nil, fmt.Errorf("remove stale socket: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("inspect socket path: %w", err)
	}

	listener, err := net.Listen("unix", path)
	if err != nil {
		return nil, fmt.Errorf("listen on local socket: %w", err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		_ = listener.Close()
		_ = os.Remove(path)
		return nil, fmt.Errorf("restrict socket permissions: %w", err)
	}
	return listener, nil
}
