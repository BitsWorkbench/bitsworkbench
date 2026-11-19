# Robot simulator variant: the browser variant plus a VM hook that charges
# simulated time and can suspend to the JS event loop, a sleep that advances
# simulated time, and every clock on simulated time.
#
# The VM suspends (EM_ASYNC_JS: the sim hook, sleep, jsffi.run_sync) by one of
# two mechanisms, chosen by SUSPEND; sim/runtime/build.sh builds both:
#   jspi      WebAssembly JavaScript Promise Integration (Chrome, Edge). The
#             default, and the build every JSPI browser runs.
#   asyncify  Emscripten's Asyncify, for browsers without JSPI (Safari,
#             Firefox): a larger, slower wasm, loaded only where JSPI is missing.
# MICROPY_JSPI (mpconfigvariant.h) means "can suspend" in both: the port's
# guard (one suspension at a time, from the outermost async entry) is the same.
FROZEN_MANIFEST ?= variants/sim/manifest.py
SUSPEND ?= jspi
SUSPEND_ENTRIES = mp_js_do_exec_async,proxy_c_to_js_resume,mp_js_repl_process_char_async
ifeq ($(SUSPEND),jspi)
SUPPORT_LONGJMP = wasm
JSFLAGS += -s JSPI
JSFLAGS += -s JSPI_EXPORTS=$(SUSPEND_ENTRIES)
else ifeq ($(SUSPEND),asyncify)
# Asyncify cannot unwind through wasm exception handling, so longjmp uses
# Emscripten's JS trampolines, which Asyncify can.
SUPPORT_LONGJMP = emscripten
JSFLAGS += -s ASYNCIFY -s ASYNCIFY_STACK_SIZE=65536
else
$(error SUSPEND must be jspi or asyncify)
endif
JSFLAGS += -s ALLOW_MEMORY_GROWTH
EXPORTED_FUNCTIONS_EXTRA += ,_sim_set_hook_period
SRC_C += variants/sim/simhook.c
