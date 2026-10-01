'use strict';

/**
 * VALIDACION DE FORMA — backend/src/middlewares/validate.js
 *
 * Unica capa autorizada a revisar la FORMA de la peticion: que un campo este
 * presente y sea del tipo esperado. NO conoce reglas de negocio: no mira si el
 * precio es mayor a 0, ni si el codigo de barras esta duplicado, ni si el
 * producto tiene ventas. Eso es del `ProductoService` (R10).
 *
 * No importa services ni repositories (R3). Reutiliza el error de dominio
 * `ValidationError` para que el mismo mensaje llegue al cliente pase por donde
 * pase.
 *
 * Cubre los dos modulos: los esquemas de productos (UC-1/UC-2) y los de ventas
 * (UC-3/UC-4). Sigue validando SOLO forma: que `items` sea un arreglo de lineas
 * con `productoId`/`cantidad`/`precioUnitario` es forma; que la cantidad sea > 0 o
 * que el precio sea >= 0 es negocio y vive en los services.
 *
 * Cada validador se declara como tabla de reglas y se compone:
 *   router.post('/productos', validarBody(reglasCrearProducto), controller.crear)
 */

const { ValidationError } = require('../errors/domain-errors');

/**
 * @typedef {Object} Regla
 * @property {'requerido'|'texto'|'numero'|'enteroPositivo'|'arregloDeItems'} tipo
 * @property {boolean} [opcional] si es true, la ausencia del campo es valida
 */

/** Convierte un valor de query/form a string sin perder el valor original. */
function esTexto(valor) {
  return typeof valor === 'string';
}

/**
 * Normaliza a numero aceptando el formato que llega por query string
 * (`?page=2`) y por JSON (`2`).
 * @param {*} valor
 * @returns {number|null} null si no es convertible
 */
function aNumero(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Aplica una regla a un valor.
 * @param {*} valor valor recibido
 * @param {Regla} regla regla declarada
 * @param {string} campo nombre del campo (para el mensaje)
 * @returns {string|null} codigo de error, o null si la forma es valida
 */
function aplicarRegla(valor, regla, campo) {
  const ausente = valor === undefined || valor === null || valor === '';

  if (ausente) {
    return regla.opcional ? null : `${campo} es obligatorio`;
  }

  switch (regla.tipo) {
    case 'texto':
      return esTexto(valor) ? null : `${campo} debe ser texto`;

    case 'numero': {
      const n = aNumero(valor);
      if (n === null) return `${campo} debe ser un numero`;
      return null;
    }

    case 'enteroPositivo': {
      const n = aNumero(valor);
      if (n === null || !Number.isInteger(n) || n < 1) {
        return `${campo} debe ser un entero mayor o igual a 1`;
      }
      return null;
    }

    case 'arregloDeItems': {
      return errorDeItems(valor, campo);
    }

    default:
      throw new Error(`Regla de validacion desconocida para ${campo}: ${regla.tipo}`);
  }
}

/**
 * FORMA de un arreglo de lineas de venta (UC-3).
 *
 * Revisa SOLO que cada elemento sea un objeto con `productoId` entero positivo,
 * `cantidad` numerica y `precioUnitario` numerico. NO revisa que la cantidad sea
 * mayor que 0 ni que el precio no sea negativo: eso es REGLA DE NEGOCIO y
 * corresponde al `VentaService` (R10). La division es la misma que en productos
 * (`precio` numerico aca, `precio > 0` en el service).
 *
 * @param {*} valor
 * @param {string} campo nombre del campo (para el mensaje)
 * @returns {string|null} codigo de error, o null si la forma es valida
 */
function errorDeItems(valor, campo) {
  if (!Array.isArray(valor)) return `${campo} debe ser un arreglo de lineas de producto`;
  if (valor.length === 0) return `${campo} debe tener al menos una linea de producto`;

  for (let i = 0; i < valor.length; i += 1) {
    const item = valor[i];
    const linea = i + 1;

    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return `${campo}[${linea}] debe ser un objeto con productoId, cantidad y precioUnitario`;
    }

    const productoId = aNumero(item.productoId);
    if (productoId === null || !Number.isInteger(productoId) || productoId < 1) {
      return `${campo}[${linea}].productoId debe ser un entero mayor o igual a 1`;
    }

    if (aNumero(item.cantidad) === null) {
      return `${campo}[${linea}].cantidad debe ser un numero`;
    }

    if (item.precioUnitario === undefined || item.precioUnitario === null
      || item.precioUnitario === '' || aNumero(item.precioUnitario) === null) {
      return `${campo}[${linea}].precioUnitario debe ser un numero`;
    }
  }

  return null;
}

/**
 * Normaliza una linea de venta al contrato que espera `VentaService`
 * (`{ productoId, cantidad, precioUnitario }` en number).
 * @param {Object} item
 * @returns {{productoId: number, cantidad: number, precioUnitario: number}}
 */
function itemVentaNormalizado(item) {
  return {
    productoId: aNumero(item.productoId),
    cantidad: aNumero(item.cantidad),
    precioUnitario: aNumero(item.precioUnitario),
  };
}

/**
 * Revisa un objeto de la peticion contra un esquema de reglas.
 * @param {Object} fuente objeto a revisar (req.body, req.query...)
 * @param {Object} esquema mapa campo -> Regla
 * @returns {Object} `fuente` normalizado (los campos numericos quedan como number)
 * @throws {ValidationError} con TODOS los errores de forma encontrados
 */
function validarEsquema(fuente, esquema) {
  const errores = {};
  const normalizado = {};

  Object.keys(esquema).forEach((campo) => {
    const regla = esquema[campo];
    const valor = fuente ? fuente[campo] : undefined;
    const error = aplicarRegla(valor, regla, campo);

    if (error) {
      errores[campo] = error;
      return;
    }

    if (valor === undefined || valor === null || valor === '') return;
    if (regla.tipo === 'arregloDeItems') {
      normalizado[campo] = valor.map(itemVentaNormalizado);
      return;
    }
    normalizado[campo] = ['numero', 'enteroPositivo'].includes(regla.tipo) ? aNumero(valor) : valor;
  });

  if (Object.keys(errores).length > 0) {
    const lista = Object.values(errores).join('; ');
    throw new ValidationError(lista, errores);
  }

  return normalizado;
}

/**
 * Middleware: valida `req.body` contra un esquema y deja el resultado
 * normalizado en `req.bodyValidado`.
 * @param {Object} esquema mapa campo -> Regla
 * @returns {Function} middleware de Express
 */
function validarBody(esquema) {
  return function validarBodyMiddleware(req, res, next) {
    try {
      req.bodyValidado = validarEsquema(req.body, esquema);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware: valida `req.query` contra un esquema y deja el resultado
 * normalizado en `req.queryValidado`.
 * @param {Object} esquema mapa campo -> Regla
 * @returns {Function} middleware de Express
 */
function validarQuery(esquema) {
  return function validarQueryMiddleware(req, res, next) {
    try {
      req.queryValidado = validarEsquema(req.query, esquema);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware: valida `req.params` contra un esquema y deja el resultado
 * normalizado en `req.paramsValidado`.
 *
 * Va aparte de `validarQuery` a proposito: los parametros de ruta y los de query
 * son fuentes distintas y `req.params` NO contiene los query strings. Reusar
 * `validarQuery` para `:id` haria que el id se buscara en `req.query.id`
 * (siempre ausente) y toda ruta con `:id` responderia 400 sin llegar al service.
 * @param {Object} esquema mapa campo -> Regla
 * @returns {Function} middleware de Express
 */
function validarParams(esquema) {
  return function validarParamsMiddleware(req, res, next) {
    try {
      req.paramsValidado = validarEsquema(req.params, esquema);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Middleware: exige que `req.params.id` sea un entero positivo. */
const validarId = validarParams({ id: { tipo: 'enteroPositivo' } });

/** Esquema de alta de producto (UC-2). */
const esquemaCrearProducto = {
  nombre: { tipo: 'texto' },
  precio: { tipo: 'numero' },
  codigo_barras: { tipo: 'texto' },
};

/** Esquema de actualizacion: ambos campos opcionales, pero al menos uno debe venir. */
const esquemaActualizarProducto = {
  nombre: { tipo: 'texto', opcional: true },
  precio: { tipo: 'numero', opcional: true },
};

/** Esquema de listado/busqueda (UC-1). */
const esquemaListarProductos = {
  q: { tipo: 'texto', opcional: true },
  page: { tipo: 'enteroPositivo', opcional: true },
  limit: { tipo: 'enteroPositivo', opcional: true },
};

/**
 * Esquema de alta de venta (UC-3).
 *
 * `items` es OBLIGATORIO y no puede venir vacio: es la forma del carrito. Que la
 * cantidad sea mayor que 0 y el precio no sea negativo lo decide el
 * `VentaService`. `tipo` es opcional (default `'normal'`) y solo se valida que
 * sea texto: si el tipo no esta soportado, el service responde 400.
 */
const esquemaRegistrarVenta = {
  items: { tipo: 'arregloDeItems' },
  tipo: { tipo: 'texto', opcional: true },
};

/** Esquema de listado de ventas (UC-4): solo paginacion. */
const esquemaListarVentas = {
  page: { tipo: 'enteroPositivo', opcional: true },
  limit: { tipo: 'enteroPositivo', opcional: true },
};

module.exports = {
  validarEsquema,
  validarBody,
  validarQuery,
  validarParams,
  validarId,
  esquemaCrearProducto,
  esquemaActualizarProducto,
  esquemaListarProductos,
  esquemaRegistrarVenta,
  esquemaListarVentas,
};
