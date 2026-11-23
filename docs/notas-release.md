## hilo v0.1.0

app de escritorio para que el equipo entregue completo a la primera. conecta tu github y tu clickup y te muestra qué te toca hoy.

### qué trae
- mi día: tus tareas de clickup, tus pr de github y qué hacer ahora, ordenado por urgencia
- revisión de pr con una sola lista de correcciones, según el formato acordado
- comentarios de clickup con plantilla (entrega, bloqueo, avance, pregunta) y publicación con tu confirmación
- cola de revisión repartida entre integradores y plan por días con las tareas reales
- grafo del proyecto, contexto por rol con presupuesto de tokens y agentes de claude code o codex con tu suscripción

### instalar
descarga el archivo de tu sistema abajo. la app no está firmada, así que:
- macos: descomprime, mueve `Hilo.app` a aplicaciones, clic derecho y abrir la primera vez
- windows: si aparece smartscreen, más información y ejecutar de todos modos
- linux: `chmod +x Hilo-*.AppImage` y ábrelo

al abrirla: conecta github (se abre el navegador) y pega tu token de api de clickup.

### lo que no hace
- no usa claves de api: los agentes usan tu suscripción de claude code o codex ya iniciada
- no envía datos de uso a ningún lado; este release solo cuenta descargas
- codex no se probó todavía; windows y linux no se probaron en una máquina real
