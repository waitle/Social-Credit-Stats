package main

import (
	"context"
	"hash/fnv"
	"sync"
	"time"
)

// rateLimiter: IP별 토큰 버킷. 잠금 경합을 줄이려고 32개 샤드로 나눈다.
type rateLimiter struct {
	rate   float64 // 초당 충전량
	burst  float64
	shards [32]rlShard
}

type rlShard struct {
	mu sync.Mutex
	m  map[string]*bucket
}

type bucket struct {
	tokens float64
	last   time.Time
}

func newRateLimiter(perWindow int, window time.Duration) *rateLimiter {
	rl := &rateLimiter{rate: float64(perWindow) / window.Seconds(), burst: float64(perWindow)}
	for i := range rl.shards {
		rl.shards[i].m = map[string]*bucket{}
	}
	return rl
}

func (rl *rateLimiter) shard(key string) *rlShard {
	h := fnv.New32a()
	_, _ = h.Write([]byte(key))
	return &rl.shards[h.Sum32()%uint32(len(rl.shards))]
}

func (rl *rateLimiter) allow(key string, cost int) bool {
	now := time.Now()
	s := rl.shard(key)
	s.mu.Lock()
	defer s.mu.Unlock()
	b := s.m[key]
	if b == nil {
		b = &bucket{tokens: rl.burst, last: now}
		s.m[key] = b
	}
	b.tokens += now.Sub(b.last).Seconds() * rl.rate
	if b.tokens > rl.burst {
		b.tokens = rl.burst
	}
	b.last = now
	if b.tokens < float64(cost) {
		return false
	}
	b.tokens -= float64(cost)
	return true
}

// cleanupLoop: 10분 넘게 조용한 IP 의 버킷을 지워 메모리를 일정하게 유지한다.
func (rl *rateLimiter) cleanupLoop(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			cut := time.Now().Add(-10 * time.Minute)
			for i := range rl.shards {
				s := &rl.shards[i]
				s.mu.Lock()
				for k, b := range s.m {
					if b.last.Before(cut) {
						delete(s.m, k)
					}
				}
				s.mu.Unlock()
			}
		}
	}
}
