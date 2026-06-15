WASM = wasm/AttestationRegistry.wasm

.PHONY: test build optimize clean

test:
	cargo odra test

build:
	cargo odra build
	$(MAKE) optimize

optimize:
	wasm-opt -Oz --strip-debug $(WASM) -o $(WASM)
	@echo "optimized wasm: $$(wc -c < $(WASM)) bytes"

clean:
	cargo odra clean
	rm -rf wasm
