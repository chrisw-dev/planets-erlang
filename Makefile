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
	fi

viewer:
	@mkdir -p $(RUN_DIR)
	@if [ -s $(RUN_DIR)/viewer.pid ] && kill -0 "$$(cat $(RUN_DIR)/viewer.pid)" 2>/dev/null; then \
		echo "Viewer is already running (PID $$(cat $(RUN_DIR)/viewer.pid))."; \
	else \
		rm -f $(RUN_DIR)/viewer.pid; \
		setsid bash -lc 'cd "$(VIEWER_DIR)" && source "$(NVM_DIR)/nvm.sh" && nvm use --silent && exec npm run dev -- --host 0.0.0.0' >$(RUN_DIR)/viewer.log 2>&1 & echo $$! >$(RUN_DIR)/viewer.pid; \
		echo "Started viewer (PID $$(cat $(RUN_DIR)/viewer.pid)); log: $(RUN_DIR)/viewer.log"; \
	fi

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