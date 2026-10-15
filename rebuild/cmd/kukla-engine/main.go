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

	"github.com/kuz55/KuKLA/rebuild/internal/application"
	"github.com/kuz55/KuKLA/rebuild/internal/config"
	"github.com/kuz55/KuKLA/rebuild/internal/domain"
	"github.com/kuz55/KuKLA/rebuild/internal/httpapi"
	"github.com/kuz55/KuKLA/rebuild/internal/ipc"
	"github.com/kuz55/KuKLA/rebuild/internal/platform"
	"github.com/kuz55/KuKLA/rebuild/internal/storage/sqlite"
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
	ipcEndpoint := flag.String("ipc-endpoint", "", "private IPC endpoint (defaults to the per-user endpoint)")
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
	store, err := sqlite.Open(context.Background(), paths.Database)
	if err != nil {
		return fmt.Errorf("initialize local database: %w", err)
	}
	defer func() {
		if err := store.Close(); err != nil {
			logger.Error("close local database", "error", err)
		}
	}()
	searches := application.NewSearchApplication(store, store)
	profiles := application.NewProfileService(store)

	if *ipcEndpoint != "" {
		paths.Socket = *ipcEndpoint
	}
	listener, err := ipc.Listen(paths.Socket)
	if err != nil {
		return fmt.Errorf("start private local IPC listener: %w", err)
	}
	defer func() {
		_ = listener.Close()
		_ = ipc.Remove(paths.Socket)
	}()

	serverContext, stopServer := context.WithCancel(context.Background())
	defer stopServer()
	server := &http.Server{
		Handler:           httpapi.NewHandler(version, searches, profiles, domain.ID("local-installation"), stopServer),
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
	ctx, stop := platform.ShutdownContext(serverContext)
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
