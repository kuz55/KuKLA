package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

var ErrInvalidHome = errors.New("home directory must be an absolute path")

// Paths keeps persistent user data, disposable cache and session-scoped files
// separate. Resolve uses XDG on Linux and per-user AppData on Windows.
type Paths struct {
	Config   string
	Data     string
	Cache    string
	State    string
	Runtime  string
	Database string
	Media    string
	Maps     string
	Logs     string
	Socket   string
}

func Resolve() (Paths, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Paths{}, fmt.Errorf("resolve home directory: %w", err)
	}
	return ResolveFor(runtime.GOOS, home, os.LookupEnv)
}

// ResolveFor is separated from the environment lookup so path policy can be
// tested deterministically. getenv must behave like os.LookupEnv.
func ResolveFor(goos, home string, getenv func(string) (string, bool)) (Paths, error) {
	if !filepath.IsAbs(home) {
		return Paths{}, ErrInvalidHome
	}

	var configRoot, dataRoot, cacheRoot, stateRoot, runtimeRoot string
	if goos == "windows" {
		roaming := absoluteEnv(getenv, "APPDATA")
		if roaming == "" {
			roaming = filepath.Join(home, "AppData", "Roaming")
		}
		local := absoluteEnv(getenv, "LOCALAPPDATA")
		if local == "" {
			local = filepath.Join(home, "AppData", "Local")
		}
		configRoot = filepath.Join(roaming, "KuKLA")
		dataRoot = filepath.Join(local, "KuKLA", "Data")
		cacheRoot = filepath.Join(local, "KuKLA", "Cache")
		stateRoot = filepath.Join(local, "KuKLA", "State")
		runtimeRoot = filepath.Join(local, "KuKLA", "Runtime")
	} else {
		configRoot = xdgRoot(getenv, "XDG_CONFIG_HOME", filepath.Join(home, ".config"))
		dataRoot = xdgRoot(getenv, "XDG_DATA_HOME", filepath.Join(home, ".local", "share"))
		cacheRoot = xdgRoot(getenv, "XDG_CACHE_HOME", filepath.Join(home, ".cache"))
		stateRoot = xdgRoot(getenv, "XDG_STATE_HOME", filepath.Join(home, ".local", "state"))
		runtimeRoot = absoluteEnv(getenv, "XDG_RUNTIME_DIR")
		if runtimeRoot == "" {
			runtimeRoot = filepath.Join(stateRoot, "run")
		}
		configRoot = filepath.Join(configRoot, "kukla")
		dataRoot = filepath.Join(dataRoot, "kukla")
		cacheRoot = filepath.Join(cacheRoot, "kukla")
		stateRoot = filepath.Join(stateRoot, "kukla")
		runtimeRoot = filepath.Join(runtimeRoot, "kukla")
	}

	dataDir := dataRoot
	databaseDir := filepath.Join(dataDir, "db")
	mediaDir := filepath.Join(dataDir, "media")
	mapsDir := filepath.Join(dataDir, "maps")
	logsDir := filepath.Join(stateRoot, "logs")

	return Paths{
		Config:   configRoot,
		Data:     dataDir,
		Cache:    cacheRoot,
		State:    stateRoot,
		Runtime:  runtimeRoot,
		Database: filepath.Join(databaseDir, "kukla.sqlite"),
		Media:    mediaDir,
		Maps:     mapsDir,
		Logs:     logsDir,
		Socket:   filepath.Join(runtimeRoot, "engine.sock"),
	}, nil
}

func xdgRoot(getenv func(string) (string, bool), key, fallback string) string {
	if value := absoluteEnv(getenv, key); value != "" {
		return value
	}
	return fallback
}

func absoluteEnv(getenv func(string) (string, bool), key string) string {
	value, ok := getenv(key)
	if !ok || value == "" || !filepath.IsAbs(value) {
		return ""
	}
	return filepath.Clean(value)
}

// Ensure creates only the application-owned leaf directories. POSIX modes are
// owner-only; on Windows the installer/runtime must apply equivalent NTFS ACLs.
func (p Paths) Ensure() error {
	dirs := []string{
		p.Config,
		p.Data,
		filepath.Dir(p.Database),
		p.Media,
		p.Maps,
		p.Cache,
		p.State,
		p.Runtime,
		p.Logs,
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return fmt.Errorf("create application directory %q: %w", dir, err)
		}
		if runtime.GOOS != "windows" {
			if err := os.Chmod(dir, 0o700); err != nil {
				return fmt.Errorf("restrict permissions on %q: %w", dir, err)
			}
		}
	}
	return nil
}
