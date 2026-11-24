## hilo v0.3.0

app de escritorio para que el equipo entregue completo a la primera. conecta tu github y tu clickup, te dice qué te toca hoy y, con tu claude code o codex, te ayuda a hacer el trabajo repetitivo. sin claves de api: usa tu suscripción.

### qué cambia frente a v0.2.0
- **funciona sin suscripción**: hilo detecta solo qué ia hay y usa la mejor. primero claude code o codex; si no hay, un modelo en tu propio equipo (apple intelligence en mac con chip m, sin descargar nada, u ollama); y si tampoco, búsqueda en tus notas y en el grafo. se ve y se cambia en ajustes › modelos
- el piloto automático usa lo que haya: un modelo local puede redactar; editar código y arreglar el ci siguen pidiendo claude code o codex
- los paneles del grafo ya no cortan nombres ni rutas largas

### qué trae
- **mi día**: tus tareas de clickup y tus pr de github por urgencia, con el comentario de entrega ya preparado
- **quién te frena**: nombra a la persona o al pr que detiene tus tareas y deja el recordatorio escrito
- **piloto automático**: «hacer mis pendientes» prepara tu día; lo que no necesita modelo sale gratis y todo lo que llega a otras personas queda en una bandeja hasta que lo apruebes
- **revisión de pr**: una sola lista de correcciones según el formato acordado, antes de pedir revisión
- **asistente con voz**: dicta en español o inglés (whisper, en tu equipo, sin enviar audio); `⌘K` lo abre desde cualquier pantalla
- **grafo útil**: qué usa un archivo, qué lo usa y qué se rompe si lo cambias, y el agente recibe solo ese contexto
- **ahorro de tokens medido**: lo gastado de verdad frente a lo que se evitó mandar
- **navegación a tu gusto**: izquierda, derecha, arriba, abajo, solo iconos u oculta
- **se actualiza desde la app**: ajustes › actualizaciones

### instalar
descarga el archivo de tu sistema:

| sistema | archivo |
|---|---|
| macos (apple silicon: m1 o más nuevo) | `Hilo-0.3.0-arm64.dmg` |
| windows | `Hilo.Setup.0.3.0.exe` |
| linux | `Hilo-0.3.0.AppImage` |

la app no está firmada, así que:
- macos: abre el dmg, arrastra Hilo a aplicaciones, clic derecho y abrir la primera vez
- windows: si aparece smartscreen, más información y ejecutar de todos modos
- linux: `chmod +x Hilo-0.3.0.AppImage` y ábrelo

al abrirla: conecta github (se abre el navegador) y pega tu token de api de clickup. necesitas `gh` instalado para conectar github.

### dictado con whisper (opcional, la mejor voz)
en macos: `brew install whisper-cpp` y, desde el chat, «descargar el modelo» (181 mb, una sola vez). sin eso usa el reconocimiento de apple, con un idioma a la vez.

### si ya tienes la 0.2.0
actualiza desde la app: ajustes › actualizaciones › actualizar ahora. si tienes una versión anterior, instala esta a mano una vez.
