package harnessaccounts

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// HostRoot keeps Codex's Unix-socket paths short while separating backend workspaces.
func HostRoot(workspaceRoot string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256([]byte(filepath.Clean(workspaceRoot)))
	return filepath.Join(home, ".orchestra", "a", hex.EncodeToString(hash[:4])), nil
}

// Account contains public metadata only. Credentials remain in an owned home.
type Account struct {
	ID         string `json:"id"`
	Provider   string `json:"provider"`
	Label      string `json:"label"`
	State      string `json:"auth_state"`
	CreatedAt  string `json:"created_at"`
	VerifiedAt string `json:"last_verified_at,omitempty"`
}

type Selection struct {
	Provider  string `json:"provider"`
	AccountID string `json:"account_id,omitempty"`
	Version   int64  `json:"version"`
}

type diskState struct {
	Accounts   []Account            `json:"accounts"`
	Selections map[string]Selection `json:"selections"`
}

var ErrNotFound = errors.New("managed account not found")
var ErrConflict = errors.New("account selection changed")
var ErrUnavailable = errors.New("account is not authenticated")

// Store owns only homes below root. It never imports or removes a host default.
type Store struct {
	mu    sync.Mutex
	root  string
	state diskState
	inUse map[string]int
}

func Open(root string) (*Store, error) {
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	s := &Store{root: root, state: diskState{Selections: map[string]Selection{}}, inUse: map[string]int{}}
	raw, err := os.ReadFile(filepath.Join(root, "accounts.json"))
	if errors.Is(err, os.ErrNotExist) {
		if err := s.cleanupOrphanHomes(); err != nil {
			return nil, err
		}
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &s.state); err != nil {
		return nil, fmt.Errorf("decode managed accounts: %w", err)
	}
	if s.state.Selections == nil {
		s.state.Selections = map[string]Selection{}
	}
	verified := make([]Account, 0, len(s.state.Accounts))
	for _, account := range s.state.Accounts {
		if account.Provider != "CODEX" || !validID(account.ID) {
			return nil, errors.New("invalid managed account record")
		}
		if account.State != "pending" {
			verified = append(verified, account)
		}
	}
	s.state.Accounts = verified
	if err := s.cleanupOrphanHomes(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) cleanupOrphanHomes() error {
	base := filepath.Join(s.root, "homes")
	entries, err := os.ReadDir(base)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	known := map[string]bool{}
	for _, account := range s.state.Accounts {
		known[account.ID] = true
	}
	for _, entry := range entries {
		if !validID(entry.Name()) || known[entry.Name()] {
			continue
		}
		path := filepath.Join(base, entry.Name())
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("unexpected object in managed account homes")
		}
		if err := os.RemoveAll(path); err != nil {
			return err
		}
	}
	return nil
}

func validID(id string) bool {
	if len(id) != 32 {
		return false
	}
	_, err := hex.DecodeString(id)
	return err == nil
}
func (s *Store) home(id string) string { return filepath.Join(s.root, "homes", id) }
func (s *Store) save() error {
	durable := s.state
	durable.Accounts = make([]Account, 0, len(s.state.Accounts))
	for _, account := range s.state.Accounts {
		if account.State != "pending" {
			durable.Accounts = append(durable.Accounts, account)
		}
	}
	raw, err := json.MarshalIndent(durable, "", "  ")
	if err != nil {
		return err
	}
	target := filepath.Join(s.root, "accounts.json")
	tmp, err := os.CreateTemp(s.root, ".accounts-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err = tmp.Chmod(0600); err == nil {
		_, err = tmp.Write(raw)
	}
	if err == nil {
		err = tmp.Sync()
	}
	closeErr := tmp.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(tmp.Name(), target)
}
func (s *Store) List() ([]Account, []Selection) {
	s.mu.Lock()
	defer s.mu.Unlock()
	accounts := append([]Account(nil), s.state.Accounts...)
	selections := make([]Selection, 0, len(s.state.Selections))
	for _, selection := range s.state.Selections {
		selections = append(selections, selection)
	}
	return accounts, selections
}
func (s *Store) Get(id string) (Account, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range s.state.Accounts {
		if a.ID == id {
			return a, nil
		}
	}
	return Account{}, ErrNotFound
}
func (s *Store) Mark(id, state string) (Account, error) {
	if state != "signed_in" && state != "signed_out" && state != "unknown" {
		return Account{}, ErrUnavailable
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.state.Accounts {
		if s.state.Accounts[i].ID == id {
			s.state.Accounts[i].State = state
			if state == "signed_in" {
				s.state.Accounts[i].VerifiedAt = time.Now().UTC().Format(time.RFC3339)
			}
			return s.state.Accounts[i], s.save()
		}
	}
	return Account{}, ErrNotFound
}
func (s *Store) BeginCodex(label string) (Account, string, error) {
	label = strings.TrimSpace(label)
	if label == "" || len(label) > 80 {
		return Account{}, "", errors.New("account label must be 1–80 characters")
	}
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return Account{}, "", err
	}
	account := Account{ID: hex.EncodeToString(bytes[:]), Provider: "CODEX", Label: label, State: "pending", CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	s.mu.Lock()
	defer s.mu.Unlock()
	home := s.home(account.ID)
	if err := os.MkdirAll(home, 0700); err != nil {
		return Account{}, "", err
	}
	s.state.Accounts = append(s.state.Accounts, account)
	return account, home, nil
}
func (s *Store) Complete(id string) (Account, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.state.Accounts {
		if s.state.Accounts[i].ID == id {
			s.state.Accounts[i].State = "signed_in"
			s.state.Accounts[i].VerifiedAt = time.Now().UTC().Format(time.RFC3339)
			return s.state.Accounts[i], s.save()
		}
	}
	return Account{}, ErrNotFound
}
func (s *Store) Fail(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.state.Accounts {
		if s.state.Accounts[i].ID == id {
			s.state.Accounts[i].State = "unknown"
			return s.save()
		}
	}
	return ErrNotFound
}
func (s *Store) Select(provider, id string, expected int64) (Selection, error) {
	provider = strings.ToUpper(strings.TrimSpace(provider))
	if provider != "CODEX" {
		return Selection{}, ErrUnavailable
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	current := s.state.Selections[provider]
	if current.Version != expected {
		return Selection{}, ErrConflict
	}
	if id != "" {
		found := false
		for _, a := range s.state.Accounts {
			if a.ID == id && a.Provider == provider && a.State == "signed_in" {
				found = true
				break
			}
		}
		if !found {
			return Selection{}, ErrUnavailable
		}
	}
	next := Selection{Provider: provider, AccountID: id, Version: current.Version + 1}
	s.state.Selections[provider] = next
	if err := s.save(); err != nil {
		s.state.Selections[provider] = current
		return Selection{}, err
	}
	return next, nil
}
func (s *Store) Active(provider string) Selection {
	s.mu.Lock()
	defer s.mu.Unlock()
	selection := s.state.Selections[strings.ToUpper(provider)]
	selection.Provider = strings.ToUpper(provider)
	return selection
}

func (s *Store) Acquire(id string) (func(), error) {
	if id == "" || id == "system_default" {
		return func() {}, nil
	}
	s.mu.Lock()
	found := false
	for _, account := range s.state.Accounts {
		if account.ID == id && account.State == "signed_in" {
			found = true
			break
		}
	}
	if !found {
		s.mu.Unlock()
		return nil, ErrUnavailable
	}
	s.inUse[id]++
	s.mu.Unlock()
	var once sync.Once
	return func() { once.Do(func() { s.mu.Lock(); s.inUse[id]--; s.mu.Unlock() }) }, nil
}
func (s *Store) Home(provider, id string) (string, error) {
	if id == "" {
		return "", nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, account := range s.state.Accounts {
		if account.ID == id && account.Provider == strings.ToUpper(provider) {
			if account.State != "signed_in" {
				return "", ErrUnavailable
			}
			home := s.home(id)
			info, err := os.Lstat(home)
			if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
				return "", ErrUnavailable
			}
			return home, nil
		}
	}
	return "", ErrNotFound
}
func (s *Store) OwnedHome(provider, id string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range s.state.Accounts {
		if a.ID == id && a.Provider == strings.ToUpper(provider) {
			return s.home(id), nil
		}
	}
	return "", ErrNotFound
}
func (s *Store) Remove(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, account := range s.state.Accounts {
		if account.ID == id {
			if s.inUse[id] > 0 {
				return ErrConflict
			}
			if s.state.Selections[account.Provider].AccountID == id {
				return ErrConflict
			}
			home := s.home(id)
			info, err := os.Lstat(home)
			if err == nil && (!info.IsDir() || info.Mode()&os.ModeSymlink != 0) {
				return ErrConflict
			}
			if err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
			if err == nil {
				if err := os.RemoveAll(home); err != nil {
					return err
				}
			}
			s.state.Accounts = append(s.state.Accounts[:i], s.state.Accounts[i+1:]...)
			return s.save()
		}
	}
	return ErrNotFound
}
