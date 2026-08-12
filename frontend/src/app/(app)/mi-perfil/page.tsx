/**
 * Página de datos personales propios (T143) — `/mi-perfil`, para CUALQUIER usuario
 * autenticado (US14, FR-080). Server Component: solo resuelve el perfil y compone
 * (docs/arquitectura.md §7); el formulario vive en `componentes/perfil/formulario-mi-perfil.tsx`.
 *
 * A diferencia de `/usuarios` o `/roles`, esta pantalla NO comprueba ningún permiso, y es
 * deliberado: son los datos de uno mismo, no la administración de otros. Exigir un permiso
 * dejaría a un rol propio sin poder corregir ni su propio correo. La autoridad sigue estando en
 * el servidor: `PUT /api/auth/perfil` solo puede afectar al usuario de la sesión (FR-081).
 *
 * El perfil ya lo resolvió el layout autenticado para pintar la barra lateral; se vuelve a
 * pedir aquí porque esta página necesita también el correo y el usuario, y porque así el
 * formulario se precarga con datos frescos tras un `router.refresh()`.
 */
import { redirect } from 'next/navigation';
import { obtenerPerfilServidor } from '@/lib/api/auth-servidor';
import { FormularioMiPerfil } from '@/componentes/perfil/formulario-mi-perfil';

export default async function PaginaMiPerfil() {
  const perfil = await obtenerPerfilServidor();
  if (!perfil) {
    // Sin sesión no hay "uno mismo" que editar. El layout ya redirige, pero esta guarda evita
    // depender de ese orden y deja el tipo resuelto para el formulario.
    redirect('/login');
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h6 style={{ color: 'var(--color-accent)', margin: '0 0 4px' }}>Mi cuenta</h6>
        <h2 style={{ margin: 0 }}>Datos personales</h2>
      </div>
      <FormularioMiPerfil perfil={perfil} login={perfil.login} />
    </div>
  );
}
