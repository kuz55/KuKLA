GO ?= go
CC ?= cc
PKG_CONFIG ?= pkg-config
BUILD_DIR ?= build
GTK_PACKAGE ?= gtk4
JSON_PACKAGE ?= json-glib-1.0

ifeq ($(OS),Windows_NT)
ENGINE_NAME ?= kukla-engine.exe
UI_NAME ?= kukla-ui.exe
else
ENGINE_NAME ?= kukla-engine
UI_NAME ?= kukla-ui
endif

.PHONY: test vet build-engine build-engine-windows build-ui build clean

test:
	$(GO) test ./...

vet:
	$(GO) vet ./...

build-engine:
	mkdir -p $(BUILD_DIR)
	$(GO) build -trimpath -ldflags='-s -w' -o $(BUILD_DIR)/$(ENGINE_NAME) ./cmd/kukla-engine

build-engine-windows:
	mkdir -p $(BUILD_DIR)
	GOOS=windows GOARCH=amd64 $(GO) build -trimpath -ldflags='-s -w' -o $(BUILD_DIR)/kukla-engine.exe ./cmd/kukla-engine

build-ui:
	mkdir -p $(BUILD_DIR)
	$(CC) -std=c11 -Wall -Wextra -Werror -O2 \
		$$($(PKG_CONFIG) --cflags $(GTK_PACKAGE) $(JSON_PACKAGE)) \
		-o $(BUILD_DIR)/$(UI_NAME) ui/gtk/main.c ui/gtk/engine_client.c \
		$$($(PKG_CONFIG) --libs $(GTK_PACKAGE) $(JSON_PACKAGE))

build: test vet build-engine build-ui

clean:
	rm -rf $(BUILD_DIR)
