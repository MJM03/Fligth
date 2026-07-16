# AeroRadar v2.0.0

Aplicación web/PWA de seguimiento aéreo preparada para GitHub Pages.

## Correcciones principales

- Corrige la zona vacía que aparecía debajo del mapa en Safari para iPhone.
- Usa posicionamiento fijo entre la barra superior y la navegación inferior.
- Invalida y recalcula Leaflet al cambiar orientación, tamaño o volver a Safari.
- Cambia automáticamente entre tres fuentes públicas:
  1. adsb.fi
  2. ADSB.lol
  3. Airplanes.live
- Activa el modo demostración solo cuando las tres fuentes fallan.
- Renueva completamente el caché PWA para evitar que Safari conserve la v1.
- Actualización automática cada 15 segundos.
- Indicador de fuente activa.
- Resaltado de códigos de emergencia 7500, 7600 y 7700.

## Publicación en GitHub Pages

1. Elimina los archivos anteriores del repositorio o reemplázalos.
2. Sube todos los archivos de este ZIP directamente a la raíz.
3. Espera a que GitHub Pages termine el despliegue.
4. Abre la web en Safari.
5. Si Safari todavía muestra v1.0.0, cierra la pestaña y vuelve a abrir la URL.
6. En una instalación antigua de la pantalla de inicio, elimina el icono anterior y vuelve a instalar.

## Nota sobre fuentes públicas

Las fuentes ADS-B gratuitas pueden aplicar límites, sufrir caídas o bloquear temporalmente peticiones.
AeroRadar v2 intenta automáticamente el siguiente proveedor antes de utilizar datos de demostración.
