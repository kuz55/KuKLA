//go:build windows

package ipc

import (
	"errors"
	"net"
)

var ErrAlreadyRunning = errors.New("KuKLA engine is already running")
var errNamedPipeNotImplemented = errors.New("Windows named-pipe transport is scheduled for the Windows packaging stage")

// Listen is a compile-time placeholder only. The Windows follow-on release
// must replace this with a named-pipe implementation using a current-user ACL;
// the application must not fall back to a wildcard TCP listener.
func Listen(string) (net.Listener, error) {
	return nil, errNamedPipeNotImplemented
}
