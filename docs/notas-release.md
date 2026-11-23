## hilo v0.1.2

app de escritorio para que el equipo entregue completo a la primera. conecta tu github y tu clickup y te muestra qué te toca hoy.

### qué cambia frente a v0.1.1
- interfaz en blanco y negro con vidrio líquido; notas, mi día, asistente y ajustes rediseñados con menos texto
- chat libre con el agente de tu rol: sabe tus tareas de clickup y tus pr
- revisar pr automático para integradores, con errores duros separados de avisos
- tareas programadas: avisos, resumen del día, revisión de pr e informe de cola
- ahorro de tokens opcional y configurable, con tres preajustes
- bienvenida que pide conectar github y clickup primero, recorrido guiado y panel de ayuda
- las tareas de clickup ahora incluyen subtareas

### qué trae
- mi día: tus tareas de clickup, tus pr de github y qué hacer ahora, ordenado por urgencia
- revisión de pr con una sola lista de correcciones, según el formato acordado
- comentarios de clickup con plantilla (entrega, bloqueo, avance, pregunta) y publicación con tu confirmación
- cola de revisión repartida entre integradores y plan por días con las tareas reales
- grafo del proyecto, contexto por rol con presupuesto de tokens y agentes de claude code o codex con tu suscripción

### instalar
descarga el archivo de tu sistema:

| sistema | archivo |
|---|---|
| macos (apple silicon: m1 o más nuevo) | `Hilo-0.1.2-arm64.dmg` |
| windows | `Hilo.Setup.0.1.2.exe` |
| linux | `Hilo-0.1.2.AppImage` |

la app no está firmada, así que:
- macos: abre el dmg, arrastra Hilo a aplicaciones, clic derecho y abrir la primera vez
- windows: si aparece smartscreen, más información y ejecutar de todos modos
- linux: `chmod +x Hilo-0.1.2.AppImage` y ábrelo

al abrirla: conecta github (se abre el navegador) y pega tu token de api de clickup. necesitas `gh` instalado para conectar github.

### lo que no hace
- no usa claves de api: los agentes usan tu suscripción de claude code o codex ya iniciada
- no envía datos de uso a ningún lado; este release solo cuenta descargas
- no hay versión para mac con chip intel
- codex no se probó todavía; windows y linux compilan en github actions pero no se probaron en una máquina real
