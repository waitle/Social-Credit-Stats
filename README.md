# Social Credit Stats — 알리 주문 통계

> **비공식 프로젝트입니다.** 이 프로젝트는 AliExpress / Alibaba Group과 제휴, 후원, 승인 관계가 없으며 "AliExpress"는 해당 회사의 상표입니다. 알리익스프레스의 이름은 이 도구가 어느 사이트에서 동작하는지 설명하는 용도로만 씁니다.
>
> **이용약관과 계정 위험을 이해하고 사용하세요.** 이 도구는 사용자가 로그인한 본인 계정의 주문 정보를 사용자의 브라우저 안에서 읽습니다. 그러나 알리익스프레스의 이용약관은 자동화된 접근을 제한할 수 있고, 보안 확인(캡차)이 나타나거나 계정 이용이 제한될 가능성을 배제할 수 없습니다. 사용에 따른 책임은 사용자에게 있으며, 개발자는 이로 인한 불이익에 책임지지 않습니다 (MIT 라이선스의 "있는 그대로 제공" 조항 참고).
>
> *This is an unofficial tool, not affiliated with, endorsed by, or sponsored by AliExpress or Alibaba Group. "AliExpress" is a trademark of its owner and is used only to describe what the tool works with. Use it at your own risk and make sure your use complies with the site's terms.*

알리익스프레스 주문 내역을 통계로 보여주는 크롬 확장 프로그램과, 이를 돕는 경량 중앙 서버입니다.

| 폴더 | 내용 |
|---|---|
| [`aliexpress-stats/`](aliexpress-stats/) | 크롬 확장 (Manifest V3) |
| [`server/`](server/) | 중앙 서버 (Go 표준 라이브러리, 단일 바이너리). 확장의 기본 주소: `https://social-credit.156048.xyz` |
| [`installer/`](installer/) | 설치 프로그램 + 자동 업데이터 (Windows / macOS / Linux) |
| [`tests/`](tests/) | 단위 테스트(정제된 실제 응답), E2E 테스트(Chromium), 테스트 데이터 정제 도구 |

## 설치

저장소를 내려받은 뒤 설치 프로그램을 실행합니다. 확장 파일을 고정 경로에 복사하고, 6시간마다 새 버전을 확인하는 업데이터를 예약합니다.

- **Windows**: `installer\windows\install.cmd` 더블클릭
- **macOS / Linux**: `./installer/unix/install.sh`

설치가 끝나면 크롬에 **처음 한 번만** 등록합니다. 설치 프로그램이 확장 페이지를 열고 설치 폴더 경로를 클립보드에 복사해 둡니다.

1. `chrome://extensions` → 오른쪽 위 **개발자 모드** 켜기
2. **압축해제된 확장 프로그램을 로드합니다** → 설치 폴더 선택

이후 업데이트는 자동입니다. 업데이터가 설치 폴더를 새 버전으로 바꾸면, 확장이 30분 안에(또는 크롬 재시작 때) 스스로 다시 로드합니다.
확장 ID가 고정돼 있어서(`manifest.json`의 `key`) 경로가 바뀌거나 다시 설치해도 저장된 데이터가 유지됩니다.

> 이전 버전(1.x)에서 옮겨 오는 경우: 1.x는 설치 경로에 따라 ID가 달라서 데이터가 이어지지 않습니다. 1.x 패널의 **디버그** 파일을 내려받아 두었다가, 새 버전 패널의 **설정 → 복원**으로 불러오면 주문 데이터를 옮길 수 있습니다.

### 업데이트가 안 될 때

업데이터는 **설치 폴더**(Windows `%LOCALAPPDATA%\AliOrderStats\extension`, macOS `~/Library/Application Support/AliOrderStats/extension`, Linux `~/.local/share/ali-order-stats/extension`)의 파일만 바꿉니다. 크롬에 다른 폴더(예: 저장소를 받은 폴더)를 로드했다면 그 폴더는 자동으로 바뀌지 않습니다.

1. 확장 **설정 → 업데이트 → 지금 확인**: 새 버전 유무와, 이 확장이 로드된 폴더의 파일 버전을 알려 줍니다.
2. 설치 폴더의 `update.log`: `설치본 X / 원격 Y`로 어디까지 갔는지 보입니다.
3. 업데이터를 직접 실행해 오류를 확인합니다.
   - Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\AliOrderStats\update.ps1"`
   - macOS/Linux: 설치 폴더의 `update.sh`
4. **옛 업데이터가 설치돼 있어서 계속 안 되는 경우 (한 번만)**: 업데이터는 v2.1.2부터 자기 자신도 새 버전으로 바꾸지만, 그 전에 설치한 업데이터는 버그가 있는 채로 남아 있습니다. 아래 명령이 최신 업데이터를 받아 바로 실행합니다. 저장소를 다시 받아 설치 프로그램을 다시 실행해도 같습니다. (GitHub 캐시 때문에 푸시 직후 몇 분은 이전 파일이 보일 수 있습니다)
   - Windows (PowerShell):
     ```powershell
     $d="$env:LOCALAPPDATA\AliOrderStats"; iwr -UseBasicParsing https://raw.githubusercontent.com/waitle/Social-Credit-Stats/main/installer/windows/update.ps1 -OutFile "$d\update.ps1"; powershell -NoProfile -ExecutionPolicy Bypass -File "$d\update.ps1" -Force
     ```
   - Linux: `D=~/.local/share/ali-order-stats; curl -fsSL https://raw.githubusercontent.com/waitle/Social-Credit-Stats/main/installer/unix/update.sh -o "$D/update.sh" && bash "$D/update.sh" --force`
   - macOS: 위 Linux 명령에서 `D=`를 `"$HOME/Library/Application Support/AliOrderStats"`로 바꿔 실행
5. 파일이 새 버전인데 확장이 그대로면 `chrome://extensions`에서 이 확장의 새로고침(↻)을 누르세요. 개발자 모드에서 로드한 확장만 스스로 다시 로드합니다.

## 주요 기능

- 조회 기간(1주일 기본 ~ 전체)별 지출, 할인, 품목, 월별, 상점 통계
- 배송 현황: 상품별 예상 도착일(주문 상세 기준), 운송장·마지막 배송 이벤트, 배송 완료 주문 (항공권·입장권 같은 티켓류는 제외)
- 취소·환불: 환불 진행 중/완료, 잔여 환불 예정 금액(결제 금액 기준)
- 경고: 구매자 보호 기간 임박, 관세 면세 한도(단건 / 같은 상점·같은 날 합계)
- 툴바 배지와 팝업, 크롬 알림(배송 완료, 도착 예정일 변경, 환불 완료, 보호 기간, 관세)
- 백그라운드 자동 갱신(선택), 한 번 불러온 내역은 저장 후 추가분만 갱신. 페이지를 열 때 자동으로 조회하는 "자동 실행"은 기본 꺼짐(패널 설정에서 켤 수 있음)
- 백업: 파일, 또는 중앙 서버에 종단간 암호화 백업

## 개인정보

주문 데이터는 브라우저(`chrome.storage.local`)에만 저장됩니다. 중앙 서버(기본 `https://social-credit.156048.xyz`)는 주문 데이터를 받지 않습니다. 원격 설정만 하루 한 번 받고, 익명 상태 보고는 사용자가 켠 경우에만, 암호화 백업은 사용할 때만 동작합니다. 자세한 내용은 [PRIVACY.md](PRIVACY.md)를 보세요.

## 개발

```bash
npm test             # 파서/통계 단위 테스트 (정제된 실제 알리 응답 사용)
npm run test:server  # 서버 go vet + 경쟁 상태 검사 포함 테스트
npm run test:e2e     # 가짜 알리 + 실제 서버 + Chromium 에 확장을 올린 E2E (npm i && npx playwright install chromium 필요)
```

GitHub Actions(`.github/workflows/ci.yml`)가 푸시마다 세 가지를 모두 실행합니다.
알리가 응답 구조를 바꾸면 패널의 **디버그** 파일을 `node tests/tools/sanitize.cjs <디버그 파일>`로 정제해 `tests/fixtures/`에 추가하고 기대값을 맞추면 됩니다. 정제 도구는 주문번호·상품명·상점명·주소·토큰을 바꾸고 금액·날짜를 비율/간격만 유지한 채 변환합니다.

## 알려진 한계

- 알리 페이지는 공식 API가 아니어서 구조가 바뀌면 일부 기능이 멈출 수 있습니다. 빠른 모드가 실패하면 화면 방식으로 자동 전환되고, 반복 실패하면 패널에 "구조가 바뀐 것 같다"는 표시가 나옵니다.
- 실제 알리 계정으로 확인한 것은 주문 목록 구조(상태·금액·환불 표시)까지입니다. 주문 상세 페이지의 예상 배송일·구매자 보호 기간·운송장 문구 형식과, 환불 진행 중 주문의 환불 금액 표시는 실제 데이터로 아직 확인하지 못했습니다. 다르게 나오면 디버그 파일을 보내 주세요.
- 관세 경고의 "같은 날 합산" 기준은 출처마다 설명이 달라, 같은 상점·같은 날 주문만 묶는 보수적 기준을 씁니다. 실제 과세 여부는 관세청 기준을 확인하세요.
- 자동 업데이트의 "디스크의 새 버전 감지 → 다시 로드 결정"은 테스트했지만, 실제 다시 로드(`chrome.runtime.reload()`)는 테스트용 브라우저 제약으로 자동 테스트하지 못했습니다.
