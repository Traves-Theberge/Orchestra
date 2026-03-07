package observability

import (
	"sync"
	"time"
)

type Event struct {
	Type      string `json:"type"`
	Timestamp string `json:"timestamp"`
	Data      any    `json:"data,omitempty"`
}

type PubSub struct {
	mu   sync.RWMutex
	subs map[chan Event]struct{}
}

func NewPubSub() *PubSub {
	return &PubSub{subs: map[chan Event]struct{}{}}
}

func (p *PubSub) Subscribe(buffer int) (<-chan Event, func()) {
	if buffer <= 0 {
		buffer = 32
	}
	ch := make(chan Event, buffer)
	p.mu.Lock()
	p.subs[ch] = struct{}{}
	p.mu.Unlock()

	unsubscribe := func() {
		p.mu.Lock()
		if _, ok := p.subs[ch]; ok {
			delete(p.subs, ch)
			close(ch)
		}
		p.mu.Unlock()
	}

	return ch, unsubscribe
}

func (p *PubSub) Publish(event Event) {
	if event.Timestamp == "" {
		event.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}

	p.mu.RLock()
	defer p.mu.RUnlock()
	for ch := range p.subs {
		select {
		case ch <- event:
		default:
		}
	}
}
