#!/bin/sh
# Compila el ayudante de dictado de macOS. En otros sistemas no hace nada: el dictado queda como pista de la app.
[ "$(uname)" = "Darwin" ] || exit 0
command -v swiftc >/dev/null 2>&1 || { echo "swiftc no está: se omite el dictado"; exit 0; }
cd "$(dirname "$0")/.." || exit 0
mkdir -p native/bin
swiftc -O -swift-version 5 native/dictado.swift -o native/bin/hilo-dictado -framework Speech -framework AVFoundation
echo "dictado compilado: native/bin/hilo-dictado"
