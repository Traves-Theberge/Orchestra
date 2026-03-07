package workflow

import "sync"

type Store struct {
	mu   sync.RWMutex
	path string
	doc  Document
}

func NewStore(path string) (*Store, error) {
	doc, err := LoadFile(path)
	if err != nil {
		return nil, err
	}

	return &Store{path: path, doc: doc}, nil
}

func (s *Store) Current() Document {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.doc
}

func (s *Store) ForceReload() error {
	doc, err := LoadFile(s.path)
	if err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.doc = doc
	return nil
}

func (s *Store) SetPath(path string) error {
	doc, err := LoadFile(path)
	if err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.path = path
	s.doc = doc
	return nil
}

func (s *Store) Path() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.path
}
