package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"sync"
	"time"
)

// reportStore: 익명 상태 보고를 "날짜 → 키 → 횟수" 카운터로만 보관한다. 원본 요청은 저장하지 않는다.
type reportStore struct {
	dir   string
	mu    sync.Mutex
	day   string
	count map[string]uint64
	dirty bool
}

type reportItem struct {
	V        string `json:"v"`
	Kind     string `json:"kind"`
	List     string `json:"list"`
	Detail   string `json:"detail"`
	EtaFound *int   `json:"etaFound"`
	EtaTotal *int   `json:"etaTotal"`
}

type reportBody struct {
	V     string       `json:"v"`
	Items []reportItem `json:"items"`
}

var safeCode = regexp.MustCompile(`[^a-zA-Z0-9:._#()\-가-힣 ]`)

func clean(s string, max int) string {
	s = safeCode.ReplaceAllString(s, "")
	if len(s) > max {
		s = s[:max]
	}
	return s
}

func newReportStore(dir string) *reportStore {
	r := &reportStore{dir: dir, day: today(), count: map[string]uint64{}}
	r.loadDay(r.day)
	return r
}

func today() string { return time.Now().UTC().Format("2006-01-02") }

func (s *reportStore) file(day string) string { return filepath.Join(s.dir, day+".json") }

func (s *reportStore) loadDay(day string) {
	b, err := os.ReadFile(s.file(day))
	if err != nil {
		return
	}
	_ = json.Unmarshal(b, &s.count)
}

func (s *reportStore) handleReport(w http.ResponseWriter, r *http.Request) {
	var body reportBody
	if err := json.NewDecoder(io.LimitReader(r.Body, 16<<10)).Decode(&body); err != nil {
		httpError(w, http.StatusBadRequest, "bad json")
		return
	}
	if len(body.Items) > 50 {
		body.Items = body.Items[:50]
	}
	keys := make([]string, 0, len(body.Items)*2)
	for _, it := range body.Items {
		v := clean(firstNonEmpty(it.V, body.V), 16)
		switch it.Kind {
		case "list":
			keys = append(keys, "v="+v+"|list="+clean(it.List, 60))
		case "detail":
			keys = append(keys, "v="+v+"|detail="+clean(it.Detail, 60))
			if it.EtaTotal != nil && *it.EtaTotal > 0 && it.EtaFound != nil {
				ratio := "some"
				if *it.EtaFound == 0 {
					ratio = "none"
				} else if *it.EtaFound >= *it.EtaTotal {
					ratio = "all"
				}
				keys = append(keys, "v="+v+"|eta="+ratio)
			}
		}
	}
	s.add(keys)
	w.WriteHeader(http.StatusNoContent)
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func (s *reportStore) add(keys []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if d := today(); d != s.day {
		s.flushLocked()
		s.day, s.count = d, map[string]uint64{}
	}
	for _, k := range keys {
		if len(s.count) >= 5000 && s.count[k] == 0 {
			continue // 키 폭주 방지
		}
		s.count[k]++
		s.dirty = true
	}
}

func (s *reportStore) handleStats(w http.ResponseWriter, r *http.Request) {
	day := r.URL.Query().Get("day")
	s.mu.Lock()
	var counts map[string]uint64
	if day == "" || day == s.day {
		day = s.day
		counts = make(map[string]uint64, len(s.count))
		for k, v := range s.count {
			counts[k] = v
		}
	}
	s.mu.Unlock()
	if counts == nil {
		counts = map[string]uint64{}
		if b, err := os.ReadFile(s.file(filepath.Base(day))); err == nil {
			_ = json.Unmarshal(b, &counts)
		}
	}
	type kv struct {
		Key   string `json:"key"`
		Count uint64 `json:"count"`
	}
	out := make([]kv, 0, len(counts))
	for k, v := range counts {
		out = append(out, kv{k, v})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Count > out[j].Count })
	writeJSON(w, map[string]any{"day": day, "items": out})
}

func (s *reportStore) flushLoop(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.flush()
		}
	}
}

func (s *reportStore) flush() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.flushLocked()
}

func (s *reportStore) flushLocked() {
	if !s.dirty {
		return
	}
	b, _ := json.Marshal(s.count)
	if err := writeFileAtomic(s.file(s.day), b, 0o640); err != nil {
		log.Printf("report flush: %v", err)
		return
	}
	s.dirty = false
}

// writeFileAtomic: 임시 파일에 쓰고 rename → 중간에 죽어도 반쯤 쓴 파일이 남지 않는다.
func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	tmp := path + ".tmp" + strconv.FormatInt(time.Now().UnixNano(), 36)
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_EXCL, perm)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}
