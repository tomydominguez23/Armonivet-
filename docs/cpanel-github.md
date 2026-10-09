# Vincular cPanel con GitHub

Este sitio es una app Vite: GitHub **construye** `dist/` y lo sube a tu hosting. No clones el repositorio directo en `public_html` (ahí irían los fuentes, no la web lista).

Hay que sacar **4 datos de cPanel** y pegarlos como secretos en GitHub.

## Parte 1 — En cPanel (sacar los datos)

Entrá a cPanel con el usuario y contraseña que te dio el hosting (suele ser `https://tudominio.cl:2083` o un botón **cPanel** en el panel del proveedor).

Arriba a la derecha usá el buscador de cPanel y escribí **FTP**.

### 1. Crear una cuenta FTP solo para GitHub

1. Abrí **Cuentas de FTP** / **FTP Accounts**.
2. Completá:
   - **Inicio de sesión / Log in:** `github`  
     (cPanel lo convierte en `github@tudominio.cl`)
   - **Contraseña:** generá una fuerte y **guardala**. No uses la del login de cPanel.
   - **Directorio:** `public_html`  
     (o `/home/TU_USUARIO/public_html` si el recuadro lo pide completo)
   - **Cuota:** ilimitada / Unlimited
3. Clic en **Crear cuenta de FTP** / **Create FTP Account**.

### 2. Copiar servidor, usuario y ruta

En la lista de cuentas, en la fila de `github@tudominio.cl`, clic en **Configurar cliente FTP** / **Configure FTP Client**.

Ahí aparecen los valores exactos:

| Lo que muestra cPanel | Secret de GitHub | Ejemplo |
|---|---|---|
| **Servidor FTP** / FTP Server | `DEPLOY_HOST` | `ftp.tudominio.cl` |
| **Usuario** / Username | `DEPLOY_USER` | `github@tudominio.cl` |
| **Contraseña** (la que creaste) | `DEPLOY_PASSWORD` | *(no se muestra; es la que pusiste)* |
| **Puerto** | no hace falta (usa 21) | `21` |

**Ruta (`DEPLOY_PATH`):** como esta cuenta FTP entra ya en `public_html`, el valor es:

```text
/
```

La barra final es importante.

Si en vez de una cuenta nueva usás el **usuario principal de cPanel** (el mismo con el que entrás al panel), entonces:

- `DEPLOY_USER` = ese usuario (sin `@dominio`)
- `DEPLOY_PASSWORD` = la contraseña de cPanel
- `DEPLOY_PATH` = `/public_html/`

### 3. Comprobar la carpeta pública (opcional)

**Administrador de archivos** / **File Manager** → carpeta `public_html`.  
Ahí es donde tiene que quedar el sitio. No borres a mano `.well-known` (SSL) ni `cgi-bin`.

---

## Parte 2 — En GitHub (pegar los datos)

1. Abrí el repo: [tomydominguez23/Armonivet-](https://github.com/tomydominguez23/Armonivet-).
2. **Settings** → **Secrets and variables** → **Actions**.
3. **New repository secret** — uno por uno:

| Nombre (exacto) | Valor de cPanel |
|---|---|
| `DEPLOY_HOST` | Servidor FTP (`ftp.tudominio.cl`) |
| `DEPLOY_USER` | `github@tudominio.cl` |
| `DEPLOY_PASSWORD` | Contraseña de esa cuenta FTP |
| `DEPLOY_PATH` | `/` (cuenta FTP en `public_html`) o `/public_html/` (usuario principal) |

No crees `DEPLOY_SSH_KEY` si solo tenés FTP. Si ese secreto existe y está vacío, no pasa nada; si tiene cualquier texto, GitHub intentará SSH y fallará.

También tienen que existir (si ya publicás en GitHub Pages, ya están):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

4. **Actions** → workflow **Deploy servidor** → **Run workflow** → **Run workflow**.

El primer run sube el sitio. Cada push siguiente a `main` lo actualiza solo.

---

## Si cPanel tiene SSH (opcional)

Solo si en cPanel ves **Acceso SSH** / **SSH Access** y está habilitado:

1. **Acceso SSH** → **Administrar claves SSH** → **Importar clave**.
2. En tu PC (una sola vez):

```bash
ssh-keygen -t ed25519 -C "github-armonivet" -f armonivet-deploy -N ""
```

3. Pegá el contenido de `armonivet-deploy.pub` en cPanel → **Importar** → **Autorizar**.
4. En GitHub, el contenido de `armonivet-deploy` (clave **privada**, empieza con `BEGIN`) va en el secreto `DEPLOY_SSH_KEY`.
5. `DEPLOY_HOST` = dominio o IP del hosting (no hace falta `ftp.`).
6. `DEPLOY_USER` = usuario de cPanel.
7. `DEPLOY_PATH` = `/home/TU_USUARIO/public_html/`
8. **No** cargues `DEPLOY_PASSWORD` si ya usás SSH.

---

## No uses “Control de versiones Git” de cPanel para publicar

**Archivos → Control de versiones Git™ / Git Version Control** clona el repo en el servidor, pero **no construye** Vite. Si apuntás el clon a `public_html`, el dominio serviría el código fuente, no la web.

Si igual querés clonarlo para respaldo:

- **Clone URL:** `https://github.com/tomydominguez23/Armonivet-.git`
- **Repository Path:** `/home/TU_USUARIO/repositories/armonivet` (nunca `public_html`)
- El repo es público: no hace falta token ni deploy key.

La publicación sigue siendo GitHub Actions → FTP/SSH de cPanel.

---

## Si el workflow falla

| Error | Qué revisar |
|---|---|
| `530 Login incorrect` | Usuario FTP mal copiado. Tiene que ser `github@tudominio.cl`, no solo `github`. Contraseña de esa cuenta, no la de cPanel. |
| Carpeta vacía o el sitio no cambia | `DEPLOY_PATH` incorrecto. Probá `/` y si no, `/public_html/`. Tiene que terminar en `/`. |
| Se borró el SSL o el correo | La cuenta FTP no debe apuntar a `/home/usuario` entero, solo a `public_html`. |
| El job **Deploy servidor** no corre | Falta `DEPLOY_HOST`. El workflow se salta si ese secreto está vacío. |
| Sitio sin imágenes o admin roto | Faltan `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. |
