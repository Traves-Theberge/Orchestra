
.PHONY: dash build install

dash:
	@cd apps/tui && go run .

build:
	@cd apps/tui && go build -o ../../orchestra-dash .

install:
	@cd apps/tui && go build -o /usr/local/bin/orchestra-dash .
	@echo "Orchestra Dashboard installed to /usr/local/bin/orchestra-dash"
