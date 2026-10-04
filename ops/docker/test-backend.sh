#!/bin/sh
set -eu
cd /src/apps/backend
command -v git
command -v sh
command -v gcc
go version
git --version
test "$(go env CGO_ENABLED)" = 1

unit() {
  go test ./...
}
race() {
  go test -race ./...
}
fixture() {
  go test ./internal/testsupport/... ./cmd/ade-fixture
}
case "${1:-all}" in
  all) unit; race ;;
  unit) unit ;;
  race) race ;;
  fixture) fixture ;;
  *) printf 'usage: test-backend [all|unit|race|fixture]\n' >&2; exit 2 ;;
esac
