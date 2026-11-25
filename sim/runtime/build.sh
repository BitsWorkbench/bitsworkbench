#!/usr/bin/env bash
# Builds the simulator's MicroPython (WebAssembly) twice from one source: the
# JSPI build into src/sim/runtime/mp/ and the Asyncify build, for browsers
# without JSPI, into src/sim/runtime/mp-asyncify/ (sim/DESIGN.md, section 1).
#
# The output is committed, so building the app needs no Emscripten. Run this
# only when the variant (sim/runtime/variant/), the port or py patch or the pinned
# MicroPython commit changes.
#
# Needs: git, make, python3, and Emscripten. EMSDK points at an emsdk checkout
# (default ~/.cache/emsdk); one is installed there if missing.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
MP_COMMIT=412a7e6b651ac2d7c9168aa07cfebed77528724a
SRC=$ROOT/sim/build/micropython
EMSDK=${EMSDK:-$HOME/.cache/emsdk}
OUT=$ROOT/src/sim/runtime/mp

if [ ! -f "$EMSDK/emsdk_env.sh" ]; then
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$EMSDK"
  (cd "$EMSDK" && ./emsdk install latest && ./emsdk activate latest)
fi
# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1

if [ ! -d "$SRC/.git" ]; then
  git clone https://github.com/micropython/micropython.git "$SRC"
fi
cd "$SRC"
if [ "$(git rev-parse HEAD)" != "$MP_COMMIT" ]; then
  git fetch origin && git checkout -q "$MP_COMMIT"
fi
git checkout -q -- ports/webassembly py shared/runtime
git apply "$HERE/port.patch"
# A jump back reports its line again (a loop of one line), for stepping by line.
git apply "$HERE/py.patch"
# The event-driven REPL (this port's) waits for the rest of a key on an empty
# line: an arrow's ESC no longer starts a new prompt, so history works there.
git apply "$HERE/shared.patch"
rm -rf ports/webassembly/variants/sim
cp -r "$HERE/variant" ports/webassembly/variants/sim

make -s -C mpy-cross -j8
make -s -C ports/webassembly submodules
# The version banner's date is the MicroPython commit's, not today's, so a
# rebuild of unchanged sources gives the same bytes.
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)
export SOURCE_DATE_EPOCH

# Two builds from the one patched tree, differing only in how the VM suspends
# (variant/mpconfigvariant.mk, SUSPEND): mp/ for JSPI browsers, mp-asyncify/
# for the rest (src/sim/support.js chooses). The Asyncify files carry the word
# in their names, which the bundle's file names keep, so the service worker can
# leave them out of the precache (vite.config.js). Each build gets a stamp of
# what it was built from; tests/sim.mjs checks the two stamps match.
STAMP="micropython $MP_COMMIT
port.patch $(sha256sum "$HERE/port.patch" | cut -c1-16)
py.patch $(sha256sum "$HERE/py.patch" | cut -c1-16)
shared.patch $(sha256sum "$HERE/shared.patch" | cut -c1-16)
variant $(cat "$HERE"/variant/* | sha256sum | cut -c1-16)
emscripten $(emcc --version | head -1 | sed 's/.* \([0-9][0-9.]*\) .*/\1/')"
for SUSPEND in jspi asyncify; do
  BUILD=build-sim-$SUSPEND
  DEST=$OUT NAME=micropython
  [ "$SUSPEND" = jspi ] || { DEST=$OUT-$SUSPEND; NAME=micropython-$SUSPEND; }
  rm -rf "ports/webassembly/$BUILD"   # the frozen manifest is not tracked as a dependency
  make -s -C ports/webassembly VARIANT=sim SUSPEND=$SUSPEND BUILD=$BUILD -j8
  make -s -C ports/webassembly VARIANT=sim SUSPEND=$SUSPEND BUILD=$BUILD min
  mkdir -p "$DEST"
  cp "ports/webassembly/$BUILD/micropython.min.mjs" "$DEST/$NAME.mjs"
  cp "ports/webassembly/$BUILD/micropython.wasm" "$DEST/$NAME.wasm"
  printf '%s\nsuspend %s\n' "$STAMP" "$SUSPEND" > "$DEST/BUILT_FROM.txt"
  ls -l "$DEST"
done
