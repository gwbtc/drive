VERE := /Users/trent/vere-v4.2-macos-aarch64
PIER ?= zod
SHIP_NAME ?= zod
HTTP_PORT ?= 8090
DESK_NAME := drive

.PHONY: help install build watch boot dojo-help check test e2e golden

help:
	@echo "Groundwire Drive — dev workflow"
	@echo ""
	@echo "  make install     install JS deps"
	@echo "  make build       build the JS+CSS bundles into desk/app/drive/"
	@echo "  make watch       rebuild on JS file changes"
	@echo "  make check       typecheck + unit tests (fast, no ship)"
	@echo "  make e2e         single-ship API e2e (boots a cloned golden pier)"
	@echo "  make golden      (re)build the cached golden piers"
	@echo "  make boot        boot a fresh fakeship at ./$(SHIP_NAME) (foreground)"
	@echo "  make dojo-help   print the dojo commands for first install"

check:
	cd client && bun run typecheck && bun test src

test: check

e2e:
	./scripts/e2e-single.sh

e2e2:
	./scripts/e2e-two-ship.sh

e2e-migration:
	./scripts/e2e-migration.sh

e2e-browser:
	./scripts/e2e-browser.sh

golden:
	./scripts/refresh-golden-piers.sh

install:
	cd client && bun install

build:
	cd client && bun run build

watch:
	cd client && bun run watch

# NOTE: no -p/--ames-port — fakeships derive their fake-ames port from the
# ship name and can only find each other on loopback when it's left alone.
boot:
	$(VERE) -F $(SHIP_NAME) --http-port $(HTTP_PORT)

dojo-help:
	@echo "Once the fakeship is up, in its dojo run:"
	@echo ""
	@echo "  |new-desk %$(DESK_NAME)"
	@echo "  |mount %$(DESK_NAME)"
	@echo ""
	@echo "Then in another terminal, copy desk files into the mountpoint:"
	@echo ""
	@echo "  cp -R desk/* $(SHIP_NAME)/$(DESK_NAME)/"
	@echo ""
	@echo "Back in dojo:"
	@echo ""
	@echo "  |commit %$(DESK_NAME)"
	@echo "  |install our %$(DESK_NAME)"
	@echo ""
	@echo "Open http://localhost:$(HTTP_PORT)/apps/$(DESK_NAME) in a browser."
