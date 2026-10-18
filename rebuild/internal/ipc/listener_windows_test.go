//go:build windows

package ipc

import (
	"context"
	"fmt"
	"io"
	"net"
	"testing"
	"time"

	"github.com/Microsoft/go-winio"
)

func TestListenUsesPrivateNamedPipe(t *testing.T) {
	path := fmt.Sprintf("%s-test-%d-%d", NamedPipePath, time.Now().UnixNano(),
		time.Now().Nanosecond())
	listener, err := Listen(path)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	accepted := make(chan netConnResult, 1)
	go func() {
		connection, acceptErr := listener.Accept()
		accepted <- netConnResult{connection: connection, err: acceptErr}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	client, err := winio.DialPipeContext(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()

	var server netConnResult
	select {
	case server = <-accepted:
	case <-ctx.Done():
		t.Fatal("listener did not accept the local client")
	}
	if server.err != nil {
		t.Fatal(server.err)
	}
	defer server.connection.Close()

	if _, err := client.Write([]byte("x")); err != nil {
		t.Fatal(err)
	}
	if _, err := io.ReadFull(server.connection, make([]byte, 1)); err != nil {
		t.Fatalf("private pipe did not carry data: %v", err)
	}
}

func TestListenRejectsPipeOutsideApplicationNamespace(t *testing.T) {
	if _, err := Listen(`\\.\pipe\unrelated-service`); err == nil {
		t.Fatal("expected unrelated named pipe to be rejected")
	}
}

type netConnResult struct {
	connection net.Conn
	err        error
}
