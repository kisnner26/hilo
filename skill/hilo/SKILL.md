---
name: hilo
description: Contexto acotado, revisión de formatos y decisión para el proyecto sistema-evaluaciones. Usar cuando se pida revisar un PR o comentario de ClickUp, preparar un PR o comentario con el formato acordado, armar contexto para una tarea con pocos tokens, o continuar el hilo de una tarea. Trigger /hilo
---

# hilo

Hilo es la app y la CLI del equipo para entregar completo a la primera. Esta skill la llama desde Claude Code o Codex.
Todo corre local, con la suscripción de quien la usa: no hay claves de API.

CLI: `{{HILO}}` (abajo se escribe `hilo`). Si no responde, avisa y no inventes la salida.

## Reglas que no se saltan

1. **Antes de escribir, comprueba.** Para decir cuántos PR hay, qué SHA tiene main o si un check pasó, corre `gh` y cita el comando. No lo afirmes de memoria.
2. **Nada sale sin aprobación.** Comentar, aprobar, fusionar, cambiar estados, abrir PR y etiquetar son acciones con efecto: redacta el borrador, muéstralo y espera un sí explícito. Valida la acción con `hilo decidir` antes de ejecutarla.
3. **Sin atribución de IA** en commits, PR ni comentarios, y sin emojis.
4. **Contexto mínimo.** No leas el grafo ni la carpeta entera: pide el paquete con `hilo contexto`.

## Comandos

| Necesidad | Comando |
|---|---|
| Revisar un PR contra todas las reglas, en una sola lista | `hilo revisar <PR>` |
| Revisar la rama actual antes de abrir el PR | `hilo preflight --titulo "[COD] ..." --cuerpo cuerpo.md` |
| Armar un comentario de ClickUp | `hilo comentario entrega --codigo COD --enlace URL --sha SHA --hecho "a\|b" --pendientes "x" --contribuciones "Ana: ..."` |
| Revisar un comentario recibido | `hilo comentario-validar entrega --participantes 2 < comentario.txt` |
| Contexto para una tarea | `hilo contexto --grafo GRAFO --boveda DIR --rol desarrollador --alcance vecindad:NODO --presupuesto 2000 --consulta "texto"` |
| Continuar el hilo | `hilo hilo ver <id>` al empezar; `hilo hilo paso/hecho/decidir <id> ...` al avanzar |
| ¿Puedo hacer esto? | `echo '{"tipo":"comentar","rol":"integrador","objetivo":"#42","afirmaciones":[]}' \| hilo decidir --hechos hechos.json` |
| Plan XP de dos semanas | `hilo plan --tareas tareas.json --dias 10 --capacidad 500` |
| Reparto entre integradores | `hilo cola --cola cola.json` |
| Estado de las sesiones | `hilo sesion` |

`hilo decidir` devuelve `permitir`, `preguntar` o `bloquear` (código de salida 0, 1 y 2). Con `bloquear`, para y di por qué.

## Por rol

- **Documentador:** contrato y modelo primero. Si falta una regla, marca la tarea bloqueada y pregunta; nunca inventes respuestas. Entrega comentarios con `hilo comentario avance`.
- **Desarrollador:** prueba primero, piezas de ≈400 líneas, `mvn -f backend/pom.xml spotless:apply` (el plugin de Maven) antes de subir. Corre `hilo preflight` hasta que diga "Listo", y recién entonces abre el PR.
- **Tester:** repite los casos sobre el SHA final, registra qué pasó, qué falló y qué quedó bloqueado, y avisa al integrador con `hilo comentario entrega`.
- **Integrador:** `hilo revisar <PR>` primero y una sola devolución con toda la lista. No fusiones sin `ci-ok`, aprobación de un Code Owner que no sea el autor y `testing-ok` cuando se exija.

## Al terminar

Deja el hilo al día (`hilo hilo hecho ...`) para que otra sesión retome sin releer todo.
