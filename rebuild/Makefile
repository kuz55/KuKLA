GO ?= go
CC ?= cc
PKG_CONFIG ?= pkg-config
BUILD_DIR ?= build
GTK_PACKAGE ?= gtk4

.PHONY: test vet build-engine build-engine-windows build-ui build clean

test:
	$(GO) test ./...

vet:
	$(GO) vet ./...

build-engine:
	mkdir -p $(BUILD_DIR)
	$(GO) build -trimpath -ldflags='-s -w' -o $(BUILD_DIR)/kukla-engine ./cmd/kukla-engine

build-engine-windows:
	mkdir -p $(BUILD_DIR)
	GOOS=windows GOARCH=amd64 $(GO) build -trimpath -ldflags='-s -w' -o $(BUILD_DIR)/kukla-engine.exe ./cmd/kukla-engine

build-ui:
	mkdir -p $(BUILD_DIR)
	$(CC) -std=c11 -Wall -Wextra -Werror -O2 \
		$$($(PKG_CONFIG) --cflags $(GTK_PACKAGE)) \
		-o $(BUILD_DIR)/kukla-ui ui/gtk/main.c \
		$$($(PKG_CONFIG) --libs $(GTK_PACKAGE))

build: test vet build-engine build-ui

clean:
	rm -rf $(BUILD_DIR)
