package main

import (
	"crypto/subtle"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"strings"
)

// middleware: 패닉 복구 → CORS/보안 헤더 → IP별 요청 제한
func (a *App) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				log.Printf("panic %s %s: %v", r.Method, r.URL.Path, v)
				httpError(w, http.StatusInternalServerError, "internal error")
			}
		}()
		h := w.Header()
		// 확장 프로그램(서비스 워커/설정 페이지)에서 호출하므로 출처를 제한하지 않는다. 쿠키/자격 증명은 쓰지 않는다.
		h.Set("Access-Control-Allow-Origin", "*")
		h.Set("Access-Control-Expose-Headers", "ETag")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		if r.Method == http.MethodOptions {
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type, X-Write-Token, If-None-Match, Authorization")
			h.Set("Access-Control-Max-Age", "86400")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		cost := 1
		if r.Method == http.MethodPut {
			cost = 10 // 백업 업로드는 비싸게
		}
		if r.URL.Path != "/healthz" && !a.limiter.allow(a.clientIP(r), cost) {
			h.Set("Retry-After", "30")
			httpError(w, http.StatusTooManyRequests, "rate limited")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *App) clientIP(r *http.Request) string {
	if a.opt.trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			return strings.TrimSpace(strings.Split(xff, ",")[0])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func httpError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_, _ = w.Write([]byte(`{"error":` + strconvQuote(msg) + `}`))
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func strconvQuote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func constEq(a, b string) bool {
	return len(a) == len(b) && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
