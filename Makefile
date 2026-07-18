SHELL := /bin/bash

VIEWER_DIR := viewer
RUN_DIR := $(VIEWER_DIR)/.run
NVM_DIR ?= $(HOME)/.nvm

.PHONY: start stop bridge viewer

start: bridge viewer

bridge:
	@mkdir -p $(RUN_DIR)
	@if [ -s $(RUN_DIR)/bridge.pid ] && kill -0 "$$(cat $(RUN_DIR)/bridge.pid)" 2>/dev/null; then \
		echo "Bridge is already running (PID $$(cat $(RUN_DIR)/bridge.pid))."; \
	else \
		rm -f $(RUN_DIR)/bridge.pid; \
		setsid bash -lc 'cd "$(VIEWER_DIR)" && source "$(NVM_DIR)/nvm.sh" && nvm use --silent && exec npm run bridge' >$(RUN_DIR)/bridge.log 2>&1 & echo $$! >$(RUN_DIR)/bridge.pid; \
		echo "Started bridge (PID $$(cat $(RUN_DIR)/bridge.pid)); log: $(RUN_DIR)/bridge.log"; \
	fi; \
	echo "Bridge URL: ws://localhost:8787/stream"

viewer:
	@mkdir -p $(RUN_DIR)
	@if [ -s $(RUN_DIR)/viewer.pid ] && kill -0 "$$(cat $(RUN_DIR)/viewer.pid)" 2>/dev/null; then \
		viewer_url=$$(cat $(RUN_DIR)/viewer.url 2>/dev/null || true); \
		if [ -z "$$viewer_url" ]; then \
			viewer_url=$$(sed -nE 's/.*Local:[[:space:]]*(http[^[:space:]]+).*/\1/p' $(RUN_DIR)/viewer.log | head -n 1); \
			[ -z "$$viewer_url" ] || printf '%s\n' "$$viewer_url" >$(RUN_DIR)/viewer.url; \
		fi; \
		echo "Viewer is already running (PID $$(cat $(RUN_DIR)/viewer.pid))."; \
	else \
		rm -f $(RUN_DIR)/viewer.pid $(RUN_DIR)/viewer.url; \
		port=5173; \
		while ss -ltn "sport = :$$port" | grep -q LISTEN; do port=$$((port + 1)); done; \
		viewer_url="http://localhost:$$port/"; \
		printf '%s\n' "$$viewer_url" >$(RUN_DIR)/viewer.url; \
		setsid bash -lc 'cd "$(VIEWER_DIR)" && source "$(NVM_DIR)/nvm.sh" && nvm use --silent && exec npm run dev -- --host 0.0.0.0 --port '"$$port"' --strictPort' >$(RUN_DIR)/viewer.log 2>&1 & echo $$! >$(RUN_DIR)/viewer.pid; \
		echo "Started viewer (PID $$(cat $(RUN_DIR)/viewer.pid)); log: $(RUN_DIR)/viewer.log"; \
	fi; \
	echo "Viewer URL: $$viewer_url"

stop:
	@for service in viewer bridge; do \
		pid_file="$(RUN_DIR)/$$service.pid"; \
		if [ -s "$$pid_file" ]; then \
			pid=$$(cat "$$pid_file"); \
			if kill -0 "$$pid" 2>/dev/null; then \
				kill -- "-$$pid" 2>/dev/null || kill "$$pid"; \
				echo "Stopped $$service (PID $$pid)."; \
			fi; \
			rm -f "$$pid_file"; \
		fi; \
	done
	@rm -f $(RUN_DIR)/viewer.url