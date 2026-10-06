package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/kuz55/KuKLA/rebuild/internal/config"
	"github.com/kuz55/KuKLA/rebuild/internal/httpapi"
	"github.com/kuz55/KuKLA/rebuild/internal/ipc"
	"github.com/kuz55/KuKLA/rebuild/internal/platform"
)

const version = "0.1.0-dev"

func main() {
	if err := run(); err != nil {
		slog.Error("KuKLA engine failed", "error", err)
		os.Exit(1)
	}
}

func run() error {
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return nil
	}

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	paths, err := config.Resolve()
	if err != nil {
		return fmt.Errorf("resolve application paths: %w", err)
	}
	if err := paths.Ensure(); err != nil {
		return fmt.Errorf("initialize application directories: %w", err)
	}

	listener, err := ipc.Listen(paths.Socket)
	if err != nil {
		return fmt.Errorf("start private local IPC listener: %w", err)
	}
	defer func() {
		_ = listener.Close()
		_ = os.Remove(paths.Socket)
	}()

	server := &http.Server{
		Handler:           httpapi.NewHealthHandler(version),
		ReadHeaderTimeout: 3 * time.Second,
		ReadTimeout:       5 * time.Second,
		WriteTimeout:      5 * time.Second,
		IdleTimeout:       30 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	serveErr := make(chan error, 1)
	go func() {
		serveErr <- server.Serve(listener)
	}()

	logger.Info("KuKLA local engine ready", "version", version, "transport", listener.Addr().Network())
	ctx, stop := platform.ShutdownContext(context.Background())
	defer stop()

	select {
	case <-ctx.Done():
	case err := <-serveErr:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("local engine stopped unexpectedly: %w", err)
		}
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		_ = server.Close()
		return fmt.Errorf("graceful engine shutdown failed: %w", err)
	}
	logger.Info("KuKLA local engine stopped")
	return nil
}
