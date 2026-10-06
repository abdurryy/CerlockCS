.PHONY: all web build test run dev clean

all: build

web:
	cd web && npm ci && npm run build

build: web
	go build -trimpath -ldflags "-s -w" -o bin/cerlock ./cmd/cerlock

test:
	go vet ./...
	go test ./...
	cd web && npm run check && npm test

run: build
	./bin/cerlock serve --open

# Backend with the Vite dev server in front, open http://localhost:5173
dev:
	go run ./cmd/cerlock serve & cd web && npm run dev

clean:
	rm -rf bin web/dist/app
