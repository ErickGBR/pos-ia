# CLAUDE.md — POS Basic IA

Instrucciones para Claude Code en este repositorio. Complementa a `AGENTS.md`, que es el estándar abierto y la fuente de verdad compartida; este archivo solo añade lo específico de Claude Code. Si algo se contradice, gana `AGENTS.md`.

## Modelos

| Uso | Modelo |
| --- | --- |
| Orquestación, decisiones de arquitectura, código que debe salir bien a la primera | **Opus 5.4** |
| Implementación por capas, refactors, código acotado | **Sonnet 5** |
| Tareas mecánicas, búsquedas, formateo, verificación rápida | **Haiku** |

## Modelos de los agentes en OpenCode

| Modelo | Dónde se usa |
| --- | --- |
| `big-pickle` | orquestación, backend senior, code review, QA, testing |
| `mimo-v2.6-flash-free` | frontend, workers de ejecución, UI/UX |
| `ling-3.0-flash-free` | memoria, seguridad, performance |
| `muse-spark-1.3-contributor-free` | arquitectura de sistemas, DevOps, documentación |
| `nemotron-3-ultra-free` | seguridad y datos |

## Herramientas conectadas

- **Playwright** — verificación en navegador del frontend. Preferir `snapshot` sobre `screenshot`. Los artefactos `.playwright-mcp/` están en `.gitignore`.
- **Engram** (plugin MCP) — memoria persistente. Registrar decisiones de arquitectura, hallazgos y correcciones, y recuperarlos antes de empezar una tarea en vez de redescubrir el contexto.

## Cómo trabajar aquí

### Antes de escribir código

1. Releer `docs/ARQUITECTURA.md` (decisiones D1-D6, UC-1..UC-4, Reglas de Oro).
2. Consultar la memoria de Engram por decisiones previas de esta área.
3. Confirmar el plan antes de implementar si el cambio toca más de un capa.

### Al implementar

- Un cambio por commit, con asunto Conventional Commits en español.
- Los commits van **solo con el asunto**: sin cuerpo de mensaje.
- Si un cambio se aparta de la arquitectura documentada, actualizar `docs/ARQUITECTURA.md` en el mismo commit.

### Antes de reportar algo como terminado

```bash
cd backend && npm test && npm run lint
cd frontend && npm run test:unit && npm run lint
curl -s localhost:3000/api/health     # -> {"status":"ok"}
```

Un cambio se reporta terminado cuando **las pruebas corren en verde**, no cuando el código "parece" correcto. Si una prueba falla, se arregla o se dice explícitamente que falla y por qué — nunca se ajusta la prueba para que pase.

## Antes de editar

`CLAUDE.md` · `AGENTS.md` · `.cursorrules`

## Reglas de comunicación

- Español, conciso. Al reportar: qué cambió, archivo y línea, cómo se verificó.
- Si una instrucción resulta ambigua, preguntar antes de actuar en lugar de adivinar.
- No ejecutar `git push` sin autorización explícita del operador.