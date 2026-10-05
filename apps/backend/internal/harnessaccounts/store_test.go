package harnessaccounts

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestManagedCodexSelectionPersistsAndProtectsOwnedHome(t *testing.T) {
	root := t.TempDir()
	store, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	first, firstHome, err := store.BeginCodex("Work")
	if err != nil {
		t.Fatal(err)
	}
	second, secondHome, err := store.BeginCodex("Personal")
	if err != nil {
		t.Fatal(err)
	}
	if firstHome == secondHome {
		t.Fatal("credential homes overlap")
	}
	if _, err = store.Select("CODEX", first.ID, 0); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("selected pending account: %v", err)
	}
	if _, err = store.Complete(first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Complete(second.ID); err != nil {
		t.Fatal(err)
	}
	selected, err := store.Select("CODEX", first.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Select("CODEX", second.ID, 0); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale selection accepted: %v", err)
	}
	if got, err := store.Home("CODEX", first.ID); err != nil || got != firstHome {
		t.Fatalf("wrong home: %q %v", got, err)
	}
	reopened, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.Active("CODEX") != selected {
		t.Fatal("selection not durable")
	}
	if err := reopened.Remove(first.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("removed active account: %v", err)
	}
	if _, err := reopened.Select("CODEX", second.ID, selected.Version); err != nil {
		t.Fatal(err)
	}
	if err := reopened.Remove(first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(firstHome); !os.IsNotExist(err) {
		t.Fatalf("credential home retained: %v", err)
	}
	if _, err := os.Stat(secondHome); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Dir(root)); err != nil {
		t.Fatal(err)
	}
}

func TestHostRootSeparatesWorkspaces(t *testing.T) {
	first, err := HostRoot(filepath.Join(t.TempDir(), "first"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := HostRoot(filepath.Join(t.TempDir(), "second"))
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatal("different backend workspaces share account root")
	}
}

func TestAbandonedPendingLoginIsNotPersisted(t *testing.T) {
	root := t.TempDir()
	store, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	account, home, err := store.BeginCodex("abandoned")
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reopened.Get(account.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("pending account survived restart: %v", err)
	}
	if _, err := os.Stat(home); !os.IsNotExist(err) {
		t.Fatalf("abandoned home survived restart: %v", err)
	}
}
