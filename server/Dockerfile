# 빌드: 정적 단일 바이너리 (CGO 없음)
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server .

# 실행: 빈 이미지 + 바이너리 하나 (수 MB)
FROM scratch
COPY --from=build /out/server /server
COPY config.example.json /etc/aes/config.json
ENV ADDR=:8080 DATA_DIR=/data CONFIG_FILE=/etc/aes/config.json
VOLUME ["/data"]
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/server"]
