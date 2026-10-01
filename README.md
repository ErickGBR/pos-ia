# POS Basic IA

Sistema de punto de venta (POS) con API REST y aplicacion web: Node.js + Express + Sequelize en el backend, Vue 2 + Vuetify + Axios en el frontend y MySQL 8 en Docker.

## Stack

| Capa | Tecnologia |
| --- | --- |
| Backend | Node.js, Express, Sequelize, mysql2 |
| Frontend | Vue 2, Vuetify, Axios |
| Base de datos | MySQL 8.0 (Docker) |
| Herramientas | sequelize-cli (migraciones), nodemon |

## Requisitos

- Node.js >= 18
- npm >= 9
- Docker + Docker Compose

## Puesta en marcha

```bash
cp .env.example .env   # ajustar credenciales
npm install
npm run db:up          # levanta MySQL 8 en 127.0.0.1:3307
npm run dev            # backend con recarga automatica
```

> Nota de puerto: en esta maquina el puerto 3306 del host ya esta ocupado
> por un MariaDB del sistema, por eso el proyecto publica en `127.0.0.1:3307`.
> El puerto 3306 interno del contenedor no cambia.

## Variables de entorno

Todas las variables estan documentadas en `.env.example`, que es la unica
version de ese archivo que se sube al repositorio. `.env` esta ignorado por git.

## Scripts

| Script | Descripcion |
| --- | --- |
| `npm start` | Ejecuta el servidor |
| `npm run dev` | Servidor con nodemon |
| `npm run migrate` | Aplica migraciones |
| `npm run migrate:undo` | Revierte la ultima migracion |
| `npm run seed` | Carga datos iniciales |
| `npm run db:up` | Levanta el contenedor de base de datos |
| `npm run db:down` | Detiene el contenedor |
| `npm run db:logs` | Sigue los logs de MySQL |

## Estructura del proyecto

> Se completa en la fase siguiente, junto con `docs/ARQUITECTURA.md`.

## Base de datos

El contenedor se define en `docker-compose.yml`. Los datos persisten en el
volumen `pos_basic_ia_db_data`. El healthcheck valida credenciales reales
mediante `mysqladmin ping`.

## API

> Pendiente de documentacion.

## Frontend

> Pendiente de documentacion.

## Testing

> Pendiente de documentacion.

## Despliegue

> Pendiente de documentacion.

## Licencia

MIT
