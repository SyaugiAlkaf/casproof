.PHONY: test build optimize clean

test:
	cargo odra test

build:
	cargo odra build
	$(MAKE) optimize

optimize:
	@for w in wasm/*.wasm; do \
		wasm-opt -Oz --strip-debug $$w -o $$w && echo "optimized $$w: $$(wc -c < $$w) bytes"; \
	done

clean:
	cargo odra clean
	rm -rf wasm
