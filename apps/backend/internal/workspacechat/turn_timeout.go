package workspacechat

import (
	"context"
	"time"
)

// DefaultTurnTimeout bounds an interactive chat turn.
const DefaultTurnTimeout = 10 * time.Minute

// MaxTurnTimeout is the longest turn a caller may request.
const MaxTurnTimeout = 2 * time.Hour

type turnTimeoutKey struct{}

// WithTurnTimeout lets a backend-internal caller (for example an unattended
// automation run) request a longer turn bound than interactive chat. HTTP
// handlers never set it, so interactive turns keep DefaultTurnTimeout.
func WithTurnTimeout(ctx context.Context, d time.Duration) context.Context {
	return context.WithValue(ctx, turnTimeoutKey{}, d)
}

func turnTimeout(ctx context.Context) time.Duration {
	if d, ok := ctx.Value(turnTimeoutKey{}).(time.Duration); ok && d > 0 && d <= MaxTurnTimeout {
		return d
	}
	return DefaultTurnTimeout
}
