package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"hash/fnv"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"sync"
)

// backupStore: 종단간 암호화된 백업 덩어리를 파일로 보관한다.
//   - id    : 클라이언트가 비밀번호에서 파생한 64자리 hex (서버는 비밀번호를 모른다)
//   - token : 쓰기 권한 증명 (64자리 hex). 서버는 sha256(token) 만 저장한다.
//   - 본문  : "AESB1" + IV + AES-GCM 암호문. 서버는 형식만 확인하고 내용은 볼 수 없다.
type backupStore struct {
	dir   string
	max   int64
	locks [64]sync.Mutex
}

var hex64 = regexp.MustCompile(`^[0-9a-f]{64}$`)

func newBackupStore(dir string, max int64) *backupStore { return &backupStore{dir: dir, max: max} }

func (s *backupStore) lock(id string) *sync.Mutex {
	h := fnv.New32a()
	_, _ = h.Write([]byte(id))
	return &s.locks[h.Sum32()%uint32(len(s.locks))]
}

func (s *backupStore) paths(id string) (blob, tok string) {
	d := filepath.Join(s.dir, id[:2])
	return filepath.Join(d, id+".bin"), filepath.Join(d, id+".tok")
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// checkToken: 기존 백업이 있으면 토큰이 맞아야 한다. 없으면 이번 토큰으로 새로 만든다.
func (s *backupStore) checkToken(tokPath, token string) (exists bool, ok bool) {
	b, err := os.ReadFile(tokPath)
	if errors.Is(err, os.ErrNotExist) {
		return false, true
	}
	if err != nil {
		return true, false
	}
	return true, constEq(string(bytes.TrimSpace(b)), tokenHash(token))
}

func (s *backupStore) handlePut(w http.ResponseWriter, r *http.Request) {
	id, token := r.PathValue("id"), r.Header.Get("X-Write-Token")
	if !hex64.MatchString(id) || !hex64.MatchString(token) {
		httpError(w, http.StatusBadRequest, "bad id or token")
		return
	}
	if r.ContentLength > s.max {
		httpError(w, http.StatusRequestEntityTooLarge, "too large")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, s.max+1))
	if err != nil {
		httpError(w, http.StatusBadRequest, "read failed")
		return
	}
	if int64(len(body)) > s.max {
		httpError(w, http.StatusRequestEntityTooLarge, "too large")
		return
	}
	if len(body) < 18 || string(body[:5]) != "AESB1" {
		httpError(w, http.StatusBadRequest, "not an encrypted backup")
		return
	}
	mu := s.lock(id)
	mu.Lock()
	defer mu.Unlock()
	blob, tok := s.paths(id)
	exists, ok := s.checkToken(tok, token)
	if !ok {
		httpError(w, http.StatusForbidden, "token mismatch")
		return
	}
	if err := os.MkdirAll(filepath.Dir(blob), 0o750); err != nil {
		httpError(w, http.StatusInternalServerError, "storage error")
		return
	}
	if err := writeFileAtomic(blob, body, 0o640); err != nil {
		httpError(w, http.StatusInternalServerError, "storage error")
		return
	}
	if !exists {
		if err := writeFileAtomic(tok, []byte(tokenHash(token)), 0o640); err != nil {
			httpError(w, http.StatusInternalServerError, "storage error")
			return
		}
	}
	w.Header().Set("ETag", `"`+strconv.Itoa(len(body))+`"`)
	if exists {
		w.WriteHeader(http.StatusNoContent)
	} else {
		w.WriteHeader(http.StatusCreated)
	}
}

func (s *backupStore) handleGet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !hex64.MatchString(id) {
		httpError(w, http.StatusBadRequest, "bad id")
		return
	}
	blob, _ := s.paths(id)
	f, err := os.Open(blob)
	if err != nil {
		httpError(w, http.StatusNotFound, "not found")
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		httpError(w, http.StatusInternalServerError, "storage error")
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(w, r, "", st.ModTime(), f)
}

func (s *backupStore) handleDelete(w http.ResponseWriter, r *http.Request) {
	id, token := r.PathValue("id"), r.Header.Get("X-Write-Token")
	if !hex64.MatchString(id) || !hex64.MatchString(token) {
		httpError(w, http.StatusBadRequest, "bad id or token")
		return
	}
	mu := s.lock(id)
	mu.Lock()
	defer mu.Unlock()
	blob, tok := s.paths(id)
	exists, ok := s.checkToken(tok, token)
	if !exists {
		httpError(w, http.StatusNotFound, "not found")
		return
	}
	if !ok {
		httpError(w, http.StatusForbidden, "token mismatch")
		return
	}
	_ = os.Remove(blob)
	_ = os.Remove(tok)
	w.WriteHeader(http.StatusNoContent)
}
