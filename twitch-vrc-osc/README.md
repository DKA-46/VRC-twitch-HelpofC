# Twitch VRChat OSC

Recompensas de puntos de canal de Twitch -> cambios de avatar / atuendos en VRChat por OSC.

## Antes de compilar
1. `package.json`: cambia `TU_USUARIO_GITHUB` (y `appId`/`author`).
2. `vrchat.js`: cambia el correo del `User-Agent`.

## Instalador .exe
- Local (en Windows): `npm install` y luego `npm run dist` -> instalador en `dist/`.

## Actualizaciones automáticas
1. Crea un repositorio PÚBLICO en GitHub llamado `twitch-vrc-osc` y sube esta carpeta.
2. Para publicar una versión: sube la versión con `npm version patch` y luego `git push --follow-tags`.
3. GitHub Actions compila el instalador y lo publica como release. Las apps instaladas lo descargan solas.
