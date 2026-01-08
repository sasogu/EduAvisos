# EduNotas — Avisos (HTML5)

App local para tener la lista de alumnos por clase y llevar contadores de avisos negativos y positivos por alumno.

## Cómo usar

- Abre `index.html` en el navegador.
- Elige una de las 12 clases.
- Puedes cambiar el nombre de la clase (se guarda).
- Importa alumnos:
  - Pega un alumno por línea, o
  - Carga un `.txt` / `.csv`.
- La importación AÑADE alumnos (no sobrescribe los existentes).
- Click sobre el nombre de un alumno: suma +1 aviso negativo.
- Botón "+☹︎": suma +1 aviso negativo.
- Botón "+🙂": suma +1 aviso positivo.
- Filtros: muestra solo alumnos con ☹︎ ≥ N y/o 🙂 ≥ N.
- Botón "Limpiar filtro": vuelve a 0.
- Puedes editar o eliminar alumnos.
- Botón "Reiniciar contadores": pone todos los contadores a 0 en la clase.
- Temporizador: cada ☹︎ suma tiempo y cada 🙂 (si hay ☹︎) resta tiempo (sin bajar de 0). Se muestra una cuenta atrás por alumno y, al llegar a 0, sus ☹︎ vuelven a 0. El tiempo NO baja hasta pulsar Play (▶︎). Puedes Pausar (⏸).

## Configuración

- En ⚙︎ puedes configurar los minutos por punto:
  - "Minutos por ☹︎"
  - "Minutos por 🙂"

## Datos

- Se guardan en `localStorage` del navegador.
- El filtro (≥) se guarda por clase.

## Importación

Por ahora acepta:
- 1 nombre por línea
- CSV simple: toma la primera columna (antes de `,` o `;`).

Cuando me pases el formato definitivo (archivo/columnas/separadores), adapto el parser.
