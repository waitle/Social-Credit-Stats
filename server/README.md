# 중앙 서버

Go 표준 라이브러리만 쓰는 단일 바이너리입니다. DB 없이 메모리와 파일로 동작합니다. 주문 데이터는 받지 않습니다.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/healthz` | 상태 확인 (`ok`) |
| GET | `/v1/config` | 원격 설정. 미리 계산한 gzip/ETag 로 응답, `If-None-Match` → 304 |
| POST | `/v1/report` | 익명 상태 보고 `{v, items:[{kind, list, detail, etaFound, etaTotal}]}` (16KB, 50개 제한) |
| GET | `/v1/stats?day=YYYY-MM-DD` | 보고 집계 (`Authorization: Bearer $ADMIN_TOKEN`) |
| PUT | `/v1/backup/{id}` | 암호화 백업 저장. `X-Write-Token` 필요, 본문은 `AESB1`로 시작해야 함 |
| GET | `/v1/backup/{id}` | 암호화 백업 받기 |
| DELETE | `/v1/backup/{id}` | 백업 삭제 (`X-Write-Token`) |

모든 응답에 CORS(`*`)를 붙입니다. 쿠키나 자격 증명은 쓰지 않습니다. IP별 토큰 버킷으로 요청을 제한하며, 백업 업로드는 10배 비용으로 계산합니다.

## 원격 설정 (`config.json`)

```json
{
  "latestVersion": "2.0.0",
  "flags": { "disableFastList": false, "disableFastDetail": false },
  "parser": { "etaLabels": ["도착\\s*보장"], "protectLabels": [] }
}
```

- `latestVersion`: 확장의 업데이트 안내에 쓰입니다 (GitHub 버전과 비교해 더 높은 쪽).
- `flags`: 알리 구조가 바뀌어 빠른 모드가 오작동할 때 원격으로 끕니다.
- `parser.*Labels`: 알리 문구가 바뀌었을 때 확장을 재배포하지 않고 정규식 라벨을 보강합니다 (최대 20개, 200자).

파일은 10초마다 수정 시각을 확인해 다시 읽습니다. 잘못된 JSON이면 이전 설정을 유지합니다.

## 실행

```bash
go build -trimpath -ldflags="-s -w" -o aes-server .
ADDR=:8080 DATA_DIR=./data CONFIG_FILE=./config.example.json ADMIN_TOKEN=change-me ./aes-server
```

또는 Docker (scratch 이미지, 수 MB):

```bash
docker build -t aes-server .
docker run -d -p 8080:8080 -v aes-data:/data -e ADMIN_TOKEN=change-me aes-server
```

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `ADDR` | `:8080` | 수신 주소 |
| `DATA_DIR` | `./data` | 백업/보고 파일 위치 |
| `CONFIG_FILE` | `./config.json` | 원격 설정 파일 (없으면 빈 설정) |
| `ADMIN_TOKEN` | (없음) | `/v1/stats` 접근 토큰. 비우면 통계 API 비활성 |
| `MAX_BACKUP_MB` | `8` | 백업 최대 크기 |
| `RATE_PER_MIN` | `120` | IP별 분당 요청 수 |
| `TRUST_PROXY` | (없음) | `1`이면 `X-Forwarded-For`로 IP 판단 (리버스 프록시 뒤에서) |

HTTPS는 앞단의 리버스 프록시(Caddy, nginx 등)나 클라우드 로드밸런서에서 처리하세요.

## 성능 (4코어 VM, 클라이언트와 서버를 같은 머신에서 실행)

| 항목 | 결과 |
|---|---|
| `GET /v1/config` 처리량 (동시 64) | 초당 약 14,000건, p50 4.2ms, p99 15ms |
| 벤치마크 `/v1/config` (gzip) | 약 2µs/요청 |
| 메모리(RSS) | 약 3.4MB |
| 바이너리 | 6MB (정적, CGO 없음) |

## 테스트

```bash
go vet ./... && go test -race ./...
go test -run xxx -bench .
```
