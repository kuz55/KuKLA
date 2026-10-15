//go:build windows

package ipc

import (
	"errors"
	"net"
	"strings"

	"github.com/Microsoft/go-winio"
)

var ErrAlreadyRunning = errors.New("KuKLA engine is already running")

const NamedPipePath = `\\.\pipe\kukla-engine`

// Listen creates a Windows named pipe whose protected DACL grants access only
// to the creating user's owner-rights SID. There is deliberately no TCP fallback.
func Listen(path string) (net.Listener, error) {
	if path == "" {
		path = NamedPipePath
	}
	if path != NamedPipePath && !strings.HasPrefix(path, NamedPipePath+"-") {
		return nil, errors.New("named-pipe path must use the KuKLA pipe namespace")
	}
	listener, err := winio.ListenPipe(path, &winio.PipeConfig{
		SecurityDescriptor: "D:P(A;;GA;;;OW)",
		InputBufferSize:    64 << 10,
		OutputBufferSize:   64 << 10,
	})
	if err != nil {
		return nil, err
	}
	return listener, nil
}

func Remove(string) error { return nil }
