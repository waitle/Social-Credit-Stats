package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// configStore: 원격 설정 JSON 을 메모리에 들고, gzip 본문과 ETag 를 미리 계산해 둔다.
// 요청마다 할당/압축이 없어서 매우 가볍다. 파일이 바뀌면 주기적으로 다시 읽는다.
type configStore struct {
	path string
	mu   sync.RWMutex
	raw  []byte
	gz   []byte
	etag string
	mod  time.Time
}

const defaultConfig = `{"latestVersion":"","flags":{},"parser":{"etaLabels":[],"protectLabels":[]}}`

func newConfigStore(path string) (*configStore, error) {
	c := &configStore{path: path}
	if err := c.load(); err != nil {
		return nil, err
	}
	return c, nil
}

func (c *configStore) load() error {
	data, err := os.ReadFile(c.path)
	var mod time.Time
	if os.IsNotExist(err) {
		data = []byte(defaultConfig) // 설정 파일이 없으면 빈 설정으로 시작
	} else if err != nil {
		return err
	} else if st, err := os.Stat(c.path); err == nil {
		mod = st.ModTime()
	}
	var v map[string]any
	if err := json.Unmarshal(data, &v); err != nil {
		return fmt.Errorf("config %s: %w", c.path, err)
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, data); err != nil {
		return err
	}
	raw := compact.Bytes()
	var gzb bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&gzb, gzip.BestCompression)
	_, _ = zw.Write(raw)
	_ = zw.Close()
	sum := sha256.Sum256(raw)
	c.mu.Lock()
	c.raw, c.gz, c.etag, c.mod = raw, gzb.Bytes(), `"`+hex.EncodeToString(sum[:8])+`"`, mod
	c.mu.Unlock()
	return nil
}

// watch: 파일 수정 시각이 바뀌면 다시 읽는다 (fsnotify 같은 외부 의존성 없이).
func (c *configStore) watch(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			st, err := os.Stat(c.path)
			if err != nil {
				continue
			}
			c.mu.RLock()
			changed := !st.ModTime().Equal(c.mod)
			c.mu.RUnlock()
			if changed {
				if err := c.load(); err != nil {
					log.Printf("config reload failed (keeping previous): %v", err)
				} else {
					log.Print("config reloaded")
				}
			}
		}
	}
}

func (c *configStore) serve(w http.ResponseWriter, r *http.Request) {
	c.mu.RLock()
	raw, gz, etag := c.raw, c.gz, c.etag
	c.mu.RUnlock()
	h := w.Header()
	h.Set("ETag", etag)
	h.Set("Cache-Control", "public, max-age=300")
	h.Set("Vary", "Accept-Encoding")
	if inm := r.Header.Get("If-None-Match"); inm != "" && strings.Contains(inm, etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	h.Set("Content-Type", "application/json")
	if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		h.Set("Content-Encoding", "gzip")
		_, _ = w.Write(gz)
		return
	}
	_, _ = w.Write(raw)
}
