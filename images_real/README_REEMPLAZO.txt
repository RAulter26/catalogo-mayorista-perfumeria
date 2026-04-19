IMAGENES REALES DEL CATALOGO (PERFUMERIA MAYORISTA)

Carpeta:
- images_real/

Nombre requerido por referencia:
- P001.jpg (o .jpeg/.png/.webp/.avif)
- P002.jpg
- ...
- P060.jpg

Reglas:
- El ID debe coincidir con la referencia del producto (P###).
- El catalogo intenta en este orden: .jpg, .jpeg, .png, .webp, .avif.
- Si no encuentra foto real, usa placeholder del pack automaticamente.

Recomendado:
- 1200x1200 o mayor
- fondo limpio
- 1 producto principal por imagen

Soporte de mapeo demo actual:
- mapeo_imagenes_referencia.json

Chequeo rapido:
- node tools/check-image-coverage.js

Registro comercial PDF:
- usa `node server-catalogo.js`
- los PDFs se guardan en `registros_pdf/`
