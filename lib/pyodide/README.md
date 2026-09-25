# Pyodide 0.27.8 (bundled)

Python compiled to WebAssembly, used by the "▶ Run" button to execute Python
snippets from AI answers locally, inside the extension's sandbox. Bundled
because Chrome extensions may not load code from the network.

- Source: https://github.com/pyodide/pyodide (npm package `pyodide@0.27.8`)
- License: Mozilla Public License 2.0
- Files: `pyodide.js`, `pyodide.asm.js`, `pyodide.asm.wasm`, `python_stdlib.zip`, `pyodide-lock.json`

Only the core runtime and standard library are included (no extra packages).
