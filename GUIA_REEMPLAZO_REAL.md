# Guia Rapida de Reemplazo Real (Perfumeria Mayorista)

## 1) Configuracion editable del negocio (un solo bloque)
Edita en `catalogo-mayorista.html` el bloque:
- `const BUSINESS = { ... }`
- `const COPY = { ... }`
- `const WA_TEMPLATES = { ... }`

Campos clave:
- `BUSINESS.brandName`
- `BUSINESS.catalogBadge`
- `BUSINESS.whatsappNumber`
- `BUSINESS.schedule`
- `BUSINESS.minOrderPolicy`
- `BUSINESS.aboutText`

## 2) Imagenes reales por referencia (sin tocar UI)
Carpeta:
- `images_real/`

Formato de nombre:
- `P001.jpg` (o `.jpeg`, `.png`, `.webp`)
- `P002.jpg`
- ...
- `P060.jpg`

Prioridad de carga en el catalogo:
1. `images_real/PXXX.(jpg|jpeg|png|webp)`
2. Placeholder del pack (`pack_data/perfumeria_investigacion_pack/images_placeholders/...`)

Archivo de trazabilidad actual:
- `images_real/mapeo_imagenes_referencia.json`
- El mapeo actual quedo validado 60/60 y sin cruces de fuente (`source_site == image_source_site`).

## 3) Productos demo y categorias
Base fuente del pack:
- `pack_data/perfumeria_investigacion_pack/data/productos_60_perfumeria_mayorista.json`

Vista comercial actual en UI:
- `const CATEGORIES = [...]` en `catalogo-mayorista.html`
- `const MENU_GROUPS = [...]` en `catalogo-mayorista.html` (menu comercial principal)
- `const PRODUCTS = [...]` en `catalogo-mayorista.html` (nombres canonicos del JSON, 60/60)

Regla clave:
- No cambies nombres directamente en UI. Si hay que actualizar referencias, parte del JSON canonico y vuelve a sincronizar.

## 4) Precios
En cada producto, campo:
- `price` (COP)
- Si `price` es `0`, el sistema aplica un precio demo por categoria (`seededDemoPrice`) para mostrar catalogo comercial.

Si quieres publicar precios:
- Cambia `price` por valor numerico COP, ejemplo: `price: 189000`
- En la interfaz activa el switch "Mostrar precios"
- Modo compartido rapido:
  - `?precios=0` => abre catalogo sin precios
  - `?precios=1` => abre catalogo con precios

## 5) Regenerar imagenes de referencia (demo visual)
Script:
- `node tools/generate-reference-images.js`

Que hace:
- Extrae candidatos de Falabella, Medipiel, Disfragancias y Victoria's Secret
- Mapea por similitud estricta a `P001..P060` con prioridad por la misma fuente del producto
- Descarga a `images_real/`
- Actualiza `images_real/mapeo_imagenes_referencia.json`

Validacion automatica:
- `node tools/check-image-coverage.js`
- Falla si falta una imagen, si hay items `ok=false`, score bajo o cruce de fuente.

## 6) Flujo cotizacion PDF + WhatsApp
Antes de abrir WhatsApp, el sistema ahora:
1. Solicita datos del cliente (nombre obligatorio, telefono/ciudad opcionales).
2. Genera PDF de cotizacion.
3. Guarda PDF y metadata en carpeta local.
4. Luego abre WhatsApp con resumen del pedido.

Servidor recomendado para este flujo:
- `node server-catalogo.js`
- o doble clic en `iniciar-catalogo.bat`

Endpoint usado por el catalogo:
- `POST /api/guardar-pdf`

Carpetas de registro:
- `registros_pdf/` (PDF)
- `registros_pdf/_meta/` (JSON de soporte)

## 6) Archivos clave
- `catalogo-mayorista.html`
- `tools/generate-reference-images.js`
- `images_real/README_REEMPLAZO.txt`
- `images_real/mapeo_imagenes_referencia.json`
