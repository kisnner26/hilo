# plan de dos semanas con hilo

objetivo: dejar de gastar el tiempo en vueltas de revisión y concentrarlo en cerrar lo que falta de bfa. los números salen de los pr reales de `Nell16/sistema-evaluaciones` el 22-nov-2026.

## qué mide hilo

- rondas por pr: cuántas veces se corrigió antes de entrar. hoy hay pr con 9 rondas.
- concentración de revisión: qué parte de las revisiones hace el integrador con más carga. hoy un solo integrador fusionó 21 de 38 pr.
- piezas bloqueadas: tareas que esperan a otra, y a quién.

## reglas de trabajo

1. nadie abre un pr sin que `hilo preflight` diga "Listo". el integrador no revisa formato: solo diseño y riesgo.
2. un pr por pieza de unas 400 líneas, con la prueba primero. lo grande se parte antes de empezar (`hilo plan`).
3. todo comentario de clickup sale de una plantilla (`hilo comentario`) y se valida al recibirlo (`hilo comentario-validar`).
4. el reparto entre integradores se calcula (`hilo cola`); nadie revisa un pr propio.
5. las acciones con efecto (comentar, aprobar, fusionar, cambiar estado) las propone el agente y las confirma una persona. el motor de decisión lo hace cumplir (`hilo decidir`).

## calendario

| días | foco | salida |
|---|---|---|
| 1 a 2 | todos instalan hilo y corren el preflight en sus ramas abiertas | los pr abiertos pasan el formato sin comentarios de integración |
| 3 a 5 | cerrar el camino crítico de bfa: modelo `Evaluacion` (#41 en piezas), `testing-ok` de #51 y #64, persistencia de resultados | flujo común en main |
| 6 a 8 | familias de bfa en paralelo, una pieza por pareja desarrollador y tester | al menos dos familias con pruebas |
| 9 a 10 | integración, demo y recorte de alcance acordado | versión etiquetada y evidencia en clickup |

el recorte de alcance lo decide el equipo, no la herramienta. hilo solo muestra qué cabe con la capacidad real de cada día.

## lo que hilo no hace todavía

- asignar tareas ni cambiar estados de clickup solo: publica comentarios con tu confirmación, nada más.
- estimar líneas reales: el plan usa estimaciones por tipo de tarea.
- instalarse con un clic en windows y linux: el flujo de construcción está en `.github/workflows/build.yml` y no se ejecutó.
