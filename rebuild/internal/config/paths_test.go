package config

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func env(values map[string]string) func(string) (string, bool) {
	return func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	}
}

func TestResolveLinuxUsesXDGDirectoriesAndRejectsRelativeOverrides(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Linux path separators are covered by the Linux build runner")
	}
	paths, err := ResolveFor("linux", "/home/operator", env(map[string]string{
		"XDG_CONFIG_HOME": "relative/config",
		"XDG_DATA_HOME":   "/mnt/operator-data",
		"XDG_RUNTIME_DIR": "/run/user/1000",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if paths.Config != filepath.Join("/home/operator", ".config", "kukla") {
		t.Fatalf("unexpected config path: %q", paths.Config)
	}
	if paths.Database != filepath.Join("/mnt/operator-data", "kukla", "db", "kukla.sqlite") {
		t.Fatalf("unexpected database path: %q", paths.Database)
	}
	if paths.Socket != filepath.Join("/run/user/1000", "kukla", "engine.sock") {
		t.Fatalf("unexpected socket path: %q", paths.Socket)
	}
}

func TestResolveWindowsUsesPerUserAppData(t *testing.T) {
	home := filepath.Join(string(filepath.Separator), "Users", "operator")
	roaming := filepath.Join(home, "Roaming")
	local := filepath.Join(home, "Local")
	if runtime.GOOS == "windows" {
		home = `C:\Users\operator`
		roaming = `C:\Users\operator\Roaming`
		local = `C:\Users\operator\Local`
	}
	paths, err := ResolveFor("windows", home, env(map[string]string{
		"APPDATA":      roaming,
		"LOCALAPPDATA": local,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(paths.Config) != "KuKLA" || filepath.Base(paths.Data) != "Data" {
		t.Fatalf("unexpected Windows directories: %#v", paths)
	}
	if filepath.Base(paths.Database) != "kukla.sqlite" {
		t.Fatalf("unexpected database path: %q", paths.Database)
	}
}

func TestEnsureCreatesOwnerOnlyApplicationDirectories(t *testing.T) {
	base := t.TempDir()
	paths, err := ResolveFor("linux", base, env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if err := paths.Ensure(); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(paths.Data)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if got := info.Mode().Perm(); got != 0o700 {
			t.Fatalf("data directory mode = %o; want 700", got)
		}
	}
	if _, err := os.Stat(filepath.Dir(paths.Database)); err != nil {
		t.Fatalf("database directory was not created: %v", err)
	}
}

func TestResolveRejectsRelativeHome(t *testing.T) {
	if _, err := ResolveFor("linux", "relative/home", env(nil)); err == nil {
		t.Fatal("relative home path must be rejected")
	}
}
