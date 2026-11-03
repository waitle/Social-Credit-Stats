// 알리 주문 통계 중앙 서버.
//
// 주문 데이터를 받지 않는다. 하는 일은 세 가지뿐이다.
//   - GET  /v1/config        원격 설정 (알리 문구 변경 대응 라벨, 기능 플래그, 최신 버전)
//   - POST /v1/report        익명 상태 보고 (사용자가 켠 경우, 실패 사유 코드 카운트만)
//   - PUT/GET/DELETE /v1/backup/{id}  종단간 암호화 백업 (서버는 복호화할 수 없는 암호문만 보관)
//
// 표준 라이브러리만 사용하고 DB 없이 메모리 + 파일로 동작한다.
package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
)

type options struct {
	addr       string
	dataDir    string
	configFile string
	adminToken string
	maxBackup  int64
	ratePerMin int
	trustProxy bool
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil && v > 0 {
		return v
	}
	return def
}

func parseOptions() options {
	var o options
	flag.StringVar(&o.addr, "addr", envOr("ADDR", ":8080"), "listen address")
	flag.StringVar(&o.dataDir, "data", envOr("DATA_DIR", "./data"), "data directory (backups, reports)")
	flag.StringVar(&o.configFile, "config", envOr("CONFIG_FILE", "./config.json"), "remote config JSON file")
	flag.StringVar(&o.adminToken, "admin-token", os.Getenv("ADMIN_TOKEN"), "token for GET /v1/stats (empty = disabled)")
	maxMB := flag.Int("max-backup-mb", envInt("MAX_BACKUP_MB", 8), "max backup size in MiB")
	flag.IntVar(&o.ratePerMin, "rate", envInt("RATE_PER_MIN", 120), "requests per minute per IP")
	flag.BoolVar(&o.trustProxy, "trust-proxy", os.Getenv("TRUST_PROXY") == "1", "use X-Forwarded-For for client IP")
	flag.Parse()
	o.maxBackup = int64(*maxMB) << 20
	return o
}

// App 은 서버 전체 상태를 담는다. 테스트에서도 그대로 만들어 쓴다.
type App struct {
	opt     options
	cfg     *configStore
	reports *reportStore
	backups *backupStore
	limiter *rateLimiter
}

func newApp(opt options) (*App, error) {
	if err := os.MkdirAll(filepath.Join(opt.dataDir, "backups"), 0o750); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(opt.dataDir, "reports"), 0o750); err != nil {
		return nil, err
	}
	cfg, err := newConfigStore(opt.configFile)
	if err != nil {
		return nil, err
	}
	return &App{
		opt:     opt,
		cfg:     cfg,
		reports: newReportStore(filepath.Join(opt.dataDir, "reports")),
		backups: newBackupStore(filepath.Join(opt.dataDir, "backups"), opt.maxBackup),
		limiter: newRateLimiter(opt.ratePerMin, time.Minute),
	}, nil
}

func (a *App) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("GET /v1/config", a.cfg.serve)
	mux.HandleFunc("POST /v1/report", a.reports.handleReport)
	mux.HandleFunc("GET /v1/stats", a.requireAdmin(a.reports.handleStats))
	mux.HandleFunc("PUT /v1/backup/{id}", a.backups.handlePut)
	mux.HandleFunc("GET /v1/backup/{id}", a.backups.handleGet)
	mux.HandleFunc("DELETE /v1/backup/{id}", a.backups.handleDelete)
	return a.middleware(mux)
}

func (a *App) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if a.opt.adminToken == "" || !constEq(r.Header.Get("Authorization"), "Bearer "+a.opt.adminToken) {
			httpError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next(w, r)
	}
}

func main() {
	opt := parseOptions()
	app, err := newApp(opt)
	if err != nil {
		log.Fatalf("start: %v", err)
	}
	srv := &http.Server{
		Addr:              opt.addr,
		Handler:           app.routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       90 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go app.cfg.watch(ctx, 10*time.Second)
	go app.reports.flushLoop(ctx, time.Minute)
	go app.limiter.cleanupLoop(ctx, time.Minute)

	go func() {
		log.Printf("listening on %s (data=%s, config=%s)", opt.addr, opt.dataDir, opt.configFile)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %v", err)
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	app.reports.flush()
	log.Print("stopped")
}
