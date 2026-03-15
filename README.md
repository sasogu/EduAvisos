# EduAvisos (HTML5)

App web local para gestionar alumnado por clase, avisos de aula y comentarios de evaluación rápidos, sin backend.

## Ejecución

Opción simple:

- abre `index.html` en el navegador

Opción recomendada en Linux:

```bash
cd /home/sasogu/github/web/EduAvisos
python3 -m http.server 8000
```

Luego abre:

- `http://localhost:8000`

## Qué hace

La app incluye dos bloques principales:

- gestión de clases y alumnado
- generación rápida de comentarios de evaluación

Todo funciona en local y se guarda en `localStorage`.

## Uso diario

### 1. Alumnado y clase

- elige una de las 12 clases
- cambia el nombre de la clase si lo necesitas
- importa alumnos:
  - pegando un nombre por línea
  - cargando un `.txt` o `.csv`
  - cargando un `.pdf` si procede
- la importación añade alumnos, no borra los existentes

### 2. Avisos y semáforo

- `+☹︎`: suma aviso negativo
- `+🙂`: suma aviso positivo
- puedes filtrar por mínimos de `☹︎` y `🙂`
- el temporizador descuenta tiempo cuando está en `Play`

### 3. Evaluación rápida

- selecciona un alumno
- elige la evaluación activa:
  - `1ª evaluación`
  - `2ª evaluación`
  - `3ª evaluación`
  - `Final`
- marca opciones por categoría
- el comentario final se genera automáticamente
- puedes añadir observación libre
- puedes editar manualmente el comentario final si hace falta

## Atajos de teclado

Atajos disponibles en el panel de evaluación:

- `1-9`: seleccionar opción en la categoría activa
- `Tab`: siguiente categoría
- `Shift+Tab`: categoría anterior
- `Flecha arriba / abajo`: alumno anterior o siguiente
- `Enter`: copiar comentario y pasar al siguiente alumno
- `Ctrl+S`: guardar
- `Ctrl+C`: copiar comentario
- `F1`: abrir/cerrar ayuda rápida

## Copias entre evaluaciones

### Copiar una evaluación del mismo alumno a la siguiente

- elige un alumno
- selecciona la evaluación activa
- usa `Copiar evaluación anterior`

Ejemplos:

- `1ª -> 2ª`
- `2ª -> 3ª`
- `3ª -> Final`

### Copiar notas individuales de toda la clase entre evaluaciones

- selecciona la evaluación origen
- en `Copiar a evaluación` elige la evaluación destino
- pulsa `Copiar evaluación a toda la clase`

Esto copia, alumno por alumno:

- selecciones de categorías
- observación libre
- comentario editable

### Copiar el alumno actual al resto visibles

- usa `Copiar este alumno a visibles`
- esta acción clona el contenido del alumno actual al resto de alumnos visibles según el filtro activo

## Personalización de frases y categorías

En `⚙︎ Configuración` puedes:

- editar frases por categoría
- añadir categorías nuevas
- cambiar el orden de las categorías
- eliminar categorías
- restaurar el catálogo por defecto

Formato de cada frase:

```text
ID | valenciano | castellano
```

Ejemplo:

```text
A1 | Manté una actitud positiva. | Mantiene una actitud positiva.
```

## Visibilidad de paneles

En la cabecera puedes mostrar u ocultar:

- `Alumnos`
- `Semáforo`
- `Evaluación`
- `Modo`

La app recuerda esa preferencia.

## Configuración y backup

En `⚙︎ Configuración` puedes:

- cambiar idioma de interfaz
- ajustar minutos por `☹︎`
- ajustar minutos por `🙂`
- exportar copia completa en `.json`
- importar copia completa en `.json`

La copia incluye:

- clases
- alumnos
- avisos
- histórico
- configuración
- evaluaciones
- frases y categorías personalizadas

## Datos

Se guardan en `localStorage` del navegador.

Esto incluye:

- clases y alumnos
- filtros
- configuración de evaluación
- comentarios
- visibilidad de paneles
- personalización de frases y categorías

## Estructura de archivos

- `index.html`: estructura principal de la app
- `css/styles.css`: estilos
- `js/i18n.js`: textos de interfaz
- `js/app.js`: lógica principal

## Mantenimiento

Puntos habituales de mantenimiento:

- ajustar frases/categorías desde la propia configuración
- revisar textos de interfaz en `js/i18n.js`
- tocar lógica principal en `js/app.js`

## Licencia

MIT. Ver `LICENSE`.
