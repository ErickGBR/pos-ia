'use strict';

/**
 * LECTOR DE FUENTES — backend/tests/helpers/fuentes.js
 *
 * Utilidad para las pruebas de ARQUITECTURA (las que verifican que el
 * `CALL sp_registrar_venta` esta en un solo archivo y que nadie mas escribe en
 * las tablas de ventas).
 *
 * Esas pruebas leen el codigo fuente como texto, no lo ejecutan. Para que no
 * den falsos positivos con la documentacion, primero se quitan los COMENTARIOS:
 * el proyecto esta atravesado por comentarios que mencionan el SP, el
 * `Regla de Oro 8`, `D2`, etc., y varias reglas ("nadie escribe en ventas")
 * estan escritas justamente en prosa, al lado del codigo que las cumple.
 *
 * Se quitan bloques de comentario y comentarios de linea. Es una eliminacion
 * deliberadamente ingenua: no analiza literales ni expresiones regulares, y no
 * lo necesita, porque lo que se busca son llamadas a metodos y sentencias SQL,
 * no una cadena de texto que las imite. Lo que importa es que sea estable y
 * predecible, no que sea perfecta.
 */

const fs = require('fs');
const path = require('path');

/** Raiz de `backend/`. */
const RAIZ_BACKEND = path.resolve(__dirname, '..', '..');

/** `backend/src`. */
const RAIZ_SRC = path.join(RAIZ_BACKEND, 'src');

/**
 * Quita comentarios de bloque y de linea de un fuente JavaScript.
 * @param {string} codigo
 * @returns {string} el mismo codigo sin comentarios
 */
function sinComentarios(codigo) {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Lista recursivamente los archivos `.js` de un directorio, en orden alfabetico
 * para que las pruebas sean deterministas.
 *
 * @param {string} [directorio] por defecto `backend/src`
 * @returns {string[]} rutas absolutas
 */
function archivosJs(directorio = RAIZ_SRC) {
  const encontrados = [];

  fs.readdirSync(directorio, { withFileTypes: true }).forEach((entrada) => {
    const completa = path.join(directorio, entrada.name);
    if (entrada.isDirectory()) {
      encontrados.push(...archivosJs(completa));
    } else if (entrada.isFile() && entrada.name.endsWith('.js')) {
      encontrados.push(completa);
    }
  });

  return encontrados.sort();
}

/**
 * Devuelve los archivos cuyo codigo (SIN comentarios) matchea el patron.
 *
 * @param {RegExp} patron
 * @param {Object} [opciones]
 * @param {string[]} [opciones.excluir] rutas a ignorar
 * @param {string} [opciones.directorio] raiz del recorrido
 * @returns {string[]} rutas RELATIVAS a `backend/`, ordenadas
 */
function archivosQueCumplen(patron, opciones = {}) {
  const directorio = opciones.directorio || RAIZ_SRC;
  const excluidas = new Set(
    (opciones.excluir || []).map((ruta) => (path.isAbsolute(ruta) ? ruta : path.join(RAIZ_SRC, ruta))),
  );

  return archivosJs(directorio)
    .filter((ruta) => !excluidas.has(ruta))
    .filter((ruta) => patron.test(sinComentarios(fs.readFileSync(ruta, 'utf8'))))
    .map((ruta) => path.relative(RAIZ_BACKEND, ruta));
}

module.exports = { RAIZ_BACKEND, RAIZ_SRC, sinComentarios, archivosJs, archivosQueCumplen };