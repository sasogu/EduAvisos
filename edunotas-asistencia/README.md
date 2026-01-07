# EduNotas — Asistencia (HTML5)

App local para tener la lista de alumnos por clase y marcar/desmarcar una "X" haciendo click en su nombre.

## Cómo usar

- Abre `index.html` en el navegador.
- Elige una de las 12 clases.
- Puedes cambiar el nombre de la clase (se guarda).
- Importa alumnos:
  - Pega un alumno por línea, o
  - Carga un `.txt` / `.csv`.
- La importación AÑADE alumnos (no sobrescribe los existentes).
- Click sobre un alumno para alternar su marca.
- Cada vez que se marca (pasa a "X"), suma +1 asistencia.
- Botón "+1" para sumar asistencia manualmente.
- Filtro: muestra solo alumnos con asistencias ≥ N.

## Datos

- Se guardan en `localStorage` del navegador.
- Las marcas se guardan por clase.

## Importación

Por ahora acepta:
- 1 nombre por línea
- CSV simple: toma la primera columna (antes de `,` o `;`).

Cuando me pases el formato definitivo (archivo/columnas/separadores), adapto el parser.
