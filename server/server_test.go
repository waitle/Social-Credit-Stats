package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testApp(t testing.TB, rate int) (*App, http.Handler) {
	t.Helper()
	dir := t.TempDir()
	cfg := filepath.Join(dir, "config.json")
	if err := os.WriteFile(cfg, []byte(`{"latestVersion":"2.0.0","flags":{"disableFastList":false},"parser":{"etaLabels":["도착\\s*보장"]}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	app, err := newApp(options{dataDir: filepath.Join(dir, "data"), configFile: cfg, adminToken: "secret", maxBackup: 1 << 20, ratePerMin: rate})
	if err != nil {
		t.Fatal(err)
	}
	return app, app.routes()
}

func do(h http.Handler, method, path string, body []byte, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestConfigEtagAndGzip(t *testing.T) {
	_, h := testApp(t, 1000)
	r := do(h, "GET", "/v1/config", nil, nil)
	if r.Code != 200 || !strings.Contains(r.Body.String(), `"latestVersion":"2.0.0"`) {
		t.Fatalf("config: %d %s", r.Code, r.Body.String())
	}
	etag := r.Header().Get("ETag")
	if etag == "" || r.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatal("missing etag or cors")
	}
	if r2 := do(h, "GET", "/v1/config", nil, map[string]string{"If-None-Match": etag}); r2.Code != 304 {
		t.Fatalf("want 304, got %d", r2.Code)
	}
	r3 := do(h, "GET", "/v1/config", nil, map[string]string{"Accept-Encoding": "gzip"})
	zr, err := gzip.NewReader(r3.Body)
	if err != nil {
		t.Fatal(err)
	}
	plain, _ := io.ReadAll(zr)
	if r3.Header().Get("Content-Encoding") != "gzip" || !bytes.Contains(plain, []byte("etaLabels")) {
		t.Fatal("gzip body mismatch")
	}
}

func TestConfigMissingFileUsesDefault(t *testing.T) {
	dir := t.TempDir()
	app, err := newApp(options{dataDir: dir, configFile: filepath.Join(dir, "none.json"), maxBackup: 1 << 20, ratePerMin: 100})
	if err != nil {
		t.Fatal(err)
	}
	if r := do(app.routes(), "GET", "/v1/config", nil, nil); r.Code != 200 || !strings.Contains(r.Body.String(), "flags") {
		t.Fatalf("default config: %d %s", r.Code, r.Body.String())
	}
}

func TestReportAndStats(t *testing.T) {
	app, h := testApp(t, 1000)
	body := []byte(`{"v":"2.0.0","items":[{"kind":"list","list":"fail:learn(#)"},{"kind":"list","list":"fail:learn(#)"},{"kind":"detail","detail":"saved","etaFound":0,"etaTotal":5},{"kind":"list","list":"<script>alert(1)</script>"}]}`)
	if r := do(h, "POST", "/v1/report", body, nil); r.Code != 204 {
		t.Fatalf("report: %d", r.Code)
	}
	if r := do(h, "GET", "/v1/stats", nil, nil); r.Code != 401 {
		t.Fatalf("stats without token: %d", r.Code)
	}
	r := do(h, "GET", "/v1/stats", nil, map[string]string{"Authorization": "Bearer secret"})
	s := r.Body.String()
	if r.Code != 200 || !strings.Contains(s, `"v=2.0.0|list=fail:learn(#)","count":2`) || !strings.Contains(s, "eta=none") || strings.Contains(s, "<script>") {
		t.Fatalf("stats: %s", s)
	}
	app.reports.flush()
	if _, err := os.Stat(app.reports.file(app.reports.day)); err != nil {
		t.Fatalf("flush file: %v", err)
	}
}

func TestBackupLifecycle(t *testing.T) {
	_, h := testApp(t, 1000)
	id := strings.Repeat("ab", 32)
	tok := strings.Repeat("cd", 32)
	other := strings.Repeat("ef", 32)
	blob := append([]byte("AESB1"), bytes.Repeat([]byte{7}, 64)...)

	if r := do(h, "PUT", "/v1/backup/"+id, blob, map[string]string{"X-Write-Token": tok}); r.Code != 201 {
		t.Fatalf("create: %d %s", r.Code, r.Body.String())
	}
	if r := do(h, "PUT", "/v1/backup/"+id, blob, map[string]string{"X-Write-Token": other}); r.Code != 403 {
		t.Fatalf("overwrite with wrong token: %d", r.Code)
	}
	if r := do(h, "PUT", "/v1/backup/"+id, append(blob, 1), map[string]string{"X-Write-Token": tok}); r.Code != 204 {
		t.Fatalf("update: %d", r.Code)
	}
	r := do(h, "GET", "/v1/backup/"+id, nil, nil)
	if r.Code != 200 || r.Body.Len() != len(blob)+1 {
		t.Fatalf("get: %d len %d", r.Code, r.Body.Len())
	}
	if r := do(h, "PUT", "/v1/backup/"+id, []byte("plain text, not encrypted"), map[string]string{"X-Write-Token": tok}); r.Code != 400 {
		t.Fatalf("plaintext should be rejected: %d", r.Code)
	}
	if r := do(h, "GET", "/v1/backup/../../etc/passwd", nil, nil); r.Code == 200 {
		t.Fatal("path traversal")
	}
	if r := do(h, "PUT", "/v1/backup/"+id, append([]byte("AESB1"), make([]byte, 2<<20)...), map[string]string{"X-Write-Token": tok}); r.Code != 413 {
		t.Fatalf("too large: %d", r.Code)
	}
	if r := do(h, "DELETE", "/v1/backup/"+id, nil, map[string]string{"X-Write-Token": other}); r.Code != 403 {
		t.Fatalf("delete wrong token: %d", r.Code)
	}
	if r := do(h, "DELETE", "/v1/backup/"+id, nil, map[string]string{"X-Write-Token": tok}); r.Code != 204 {
		t.Fatalf("delete: %d", r.Code)
	}
	if r := do(h, "GET", "/v1/backup/"+id, nil, nil); r.Code != 404 {
		t.Fatalf("after delete: %d", r.Code)
	}
}

func TestRateLimitAndPreflight(t *testing.T) {
	_, h := testApp(t, 5)
	if r := do(h, "OPTIONS", "/v1/backup/x", nil, nil); r.Code != 204 || !strings.Contains(r.Header().Get("Access-Control-Allow-Headers"), "X-Write-Token") {
		t.Fatalf("preflight: %d", r.Code)
	}
	ok := 0
	for i := 0; i < 10; i++ {
		if do(h, "GET", "/v1/config", nil, nil).Code == 200 {
			ok++
		}
	}
	if ok != 5 {
		t.Fatalf("rate limit allowed %d of 10 (want 5)", ok)
	}
	if r := do(h, "GET", "/healthz", nil, nil); r.Code != 200 {
		t.Fatal("healthz must not be rate limited")
	}
}

func TestConfigReload(t *testing.T) {
	app, h := testApp(t, 1000)
	time.Sleep(10 * time.Millisecond)
	if err := os.WriteFile(app.cfg.path, []byte(`{"latestVersion":"2.1.0"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := app.cfg.load(); err != nil {
		t.Fatal(err)
	}
	if r := do(h, "GET", "/v1/config", nil, nil); !strings.Contains(r.Body.String(), "2.1.0") {
		t.Fatalf("reload: %s", r.Body.String())
	}
	if err := os.WriteFile(app.cfg.path, []byte(`{broken`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := app.cfg.load(); err == nil {
		t.Fatal("broken config should fail")
	}
	if r := do(h, "GET", "/v1/config", nil, nil); !strings.Contains(r.Body.String(), "2.1.0") {
		t.Fatal("previous config must be kept on failure")
	}
}

func BenchmarkConfigGzip(b *testing.B) {
	_, h := testApp(b, 1<<30)
	b.ReportAllocs()
	b.RunParallel(func(pb *testing.PB) {
		req := httptest.NewRequest("GET", "/v1/config", nil)
		req.Header.Set("Accept-Encoding", "gzip")
		for pb.Next() {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
		}
	})
}

func BenchmarkReport(b *testing.B) {
	_, h := testApp(b, 1<<30)
	body := []byte(`{"v":"2.0.0","items":[{"kind":"list","list":"done"},{"kind":"detail","detail":"saved","etaFound":3,"etaTotal":3}]}`)
	b.ReportAllocs()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			req := httptest.NewRequest("POST", "/v1/report", bytes.NewReader(body))
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
		}
	})
}
