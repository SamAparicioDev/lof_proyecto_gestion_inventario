# Marca — el logotipo de LOF

`logo-lof.png` es **el único logotipo del sistema**. De aquí salen los dos sitios donde aparece:

- La aplicación web (pantalla de inicio de sesión y barra lateral), que lo pide por
  `GET /api/marca/logo`.
- **Todos** los archivos exportados, PDF y Excel sin excepción — el backend lo incrusta en
  `responderConArchivoExportado`, el punto por el que pasan las doce rutas `/export`.

## Para cambiarlo

Reemplaza este archivo y reconstruye las imágenes (`docker compose up -d --build backend`). No
hay una segunda copia que actualizar: el frontend no tiene la suya en `public/` precisamente
para que no puedan quedar desincronizadas.

## Por qué vive DENTRO de `backend/`

Estuvo en `assets/` de la raíz y se movió aquí el 2026-08-15, por dos razones que apuntan al
mismo sitio:

1. **El backend es el único que lo lee.** Lo incrusta en los exportables y se lo sirve a la web
   por `GET /api/marca/logo`. Un recurso pertenece al servicio que lo consume.
2. **Railway solo reconstruye un servicio cuando cambia algo DENTRO de su carpeta.** Con el logo
   en la raíz, un commit que solo cambiara la imagen no disparaba ningún despliegue: el archivo
   llegaba a GitHub y no a producción, sin ningún error que lo delatara. Pasó exactamente eso.

## Requisitos del archivo

| | |
|---|---|
| Nombre | `logo-lof.png`, exactamente |
| Formato | **PNG o JPEG**. Nunca SVG: es XML capaz de contener scripts, y se sirve desde el mismo origen que la aplicación |
| Tamaño | Un ancho de 600–1200 px va sobrado; en el PDF se dibuja a ~110 pt |
| Fondo | Transparente o blanco — en los documentos se imprime sobre fondo claro |

El tipo se valida por los **bytes reales** del archivo (números mágicos), no por su extensión:
renombrar un `.gif` a `.png` no lo cuela.

## Si falta el archivo

No pasa nada grave, y es deliberado (FR-068): la web muestra el nombre "LOF" en texto y los
exportables se generan **igual, sin logotipo**. El contenido de datos manda sobre la decoración —
un PDF sin logo sirve, un error 500 no. El backend lo avisa una sola vez en el arranque.
