-- Crea la base de datos de pruebas de integración.
-- PostgreSQL ejecuta este script solo en el PRIMER arranque del volumen de datos.
-- Las pruebas del backend (backend/test/integracion) usan DATABASE_URL_TEST apuntando aquí,
-- para validar los invariantes críticos contra una BD real sin tocar los datos de desarrollo.
CREATE DATABASE trazo_test OWNER trazo;
