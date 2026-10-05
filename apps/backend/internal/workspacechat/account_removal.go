package workspacechat

import (
	"context"
	"fmt"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
)

// RemoveIdleAccount serializes removal with conversation submissions. Historical
// bindings remain intact: a later send fails closed because its account no
// longer exists, while the transcript can still be read or archived.
func (s *Service) RemoveIdleAccount(ctx context.Context, accountID string, remove func() error) error {
	s.mu.Lock()
	rows, err := s.db.QueryContext(ctx, `SELECT session_id FROM workspace_chat_account_bindings WHERE account_id=?`, accountID)
	if err != nil {
		s.mu.Unlock()
		return err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			break
		}
		ids = append(ids, id)
	}
	if err == nil {
		err = rows.Err()
	}
	_ = rows.Close()
	if err != nil {
		s.mu.Unlock()
		return err
	}
	for _, id := range ids {
		if s.active[id] != nil {
			s.mu.Unlock()
			return fmt.Errorf("%w: account has an active conversation", ErrBusy)
		}
	}
	if err = remove(); err != nil {
		s.mu.Unlock()
		return err
	}
	var natives []agents.NativeSession
	for _, id := range ids {
		if native := s.native[id]; native != nil {
			natives = append(natives, native)
			delete(s.native, id)
			delete(s.nativePrefixes, id)
		}
	}
	s.mu.Unlock()
	for _, native := range natives {
		closeNative(native)
	}
	return nil
}
