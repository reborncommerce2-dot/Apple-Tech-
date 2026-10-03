-- ============================================================
-- Apple Tech — Esquema Supabase (versión 2.0, producción)
-- ============================================================
-- Ejecutar COMPLETO en: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Es IDEMPOTENTE: se puede ejecutar de nuevo (por ejemplo para actualizar
-- una base creada con una versión anterior) sin perder datos.
--
-- Seguridad (RLS):
--   * Visitantes ("anon"): LEEN modelos, capacidades, valoraciones, batería,
--     desperfectos, catálogo de venta y contacto (lo que necesita el
--     cotizador) y solo pueden INSERTAR cotizaciones y leads (con límites
--     de tamaño y de frecuencia). No pueden leer ni tocar nada más.
--   * Administradores: SOLO los usuarios que estén en la tabla
--     public.admins. Tener una cuenta en Supabase Auth NO alcanza.
--     Aunque alguien se registre desde afuera, no puede escribir nada.
--
-- Al final del archivo hay una línea para dar de alta al administrador.
-- ============================================================

-- ------------------------------------------------------------
-- 1) TABLAS (crear si no existen + columnas nuevas si faltan)
-- ------------------------------------------------------------

create table if not exists public.modelos (
  id text primary key,
  nombre text not null,
  capacidad_ids text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.capacidades (
  id text primary key,
  nombre text not null,
  activo boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.valoraciones (
  id text primary key,
  modelo_id text not null,
  modelo_nombre text not null default '',
  capacidad_id text not null,
  capacidad_nombre text not null default '',
  valor_usd numeric not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.bateria (
  id text primary key,
  porcentaje_minimo integer not null default 0,
  porcentaje_maximo integer not null default 0,
  descuento_usd numeric not null default 0,
  label text not null default '',
  descripcion text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.desperfectos (
  id text primary key,
  nombre text not null default '',
  descripcion text not null default '',
  descuento_usd numeric not null default 0,
  activo boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.catalog (
  id text primary key,
  nombre text not null default '',
  precio_base_usd numeric not null default 0,
  stock integer not null default 0,
  estado text not null default 'draft',
  imagen_url text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.catalog add column if not exists detalle text not null default '';

-- Fila única (id = 'singleton'): datos de contacto del negocio.
create table if not exists public.contact (
  id text primary key default 'singleton',
  business_name text not null default 'Apple Tech',
  phone text not null default '',
  whatsapp text not null default '',
  instagram text not null default '',
  address text not null default '',
  hours text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.quotes_history (
  id text primary key,
  fecha bigint not null,
  modelo_id text not null default '',
  modelo_nombre text not null default '',
  capacidad_id text not null default '',
  capacidad_nombre text not null default '',
  valor_base_usd numeric not null default 0,
  descuento_bateria_usd numeric not null default 0,
  descuento_desperfectos_usd numeric not null default 0,
  valor_final_usd numeric not null default 0,
  created_at timestamptz not null default now()
);
alter table public.quotes_history add column if not exists color text not null default '';
alter table public.quotes_history add column if not exists bateria_label text not null default '';
alter table public.quotes_history add column if not exists desperfectos jsonb not null default '[]'::jsonb;

create table if not exists public.leads (
  id text primary key,
  fecha bigint not null,
  nombre text not null default '',
  whatsapp text not null default '',
  modelo_id text not null default '',
  modelo_nombre text not null default '',
  resultado_usd numeric not null default 0,
  created_at timestamptz not null default now()
);
alter table public.leads add column if not exists capacidad_nombre text not null default '';
alter table public.leads add column if not exists producto_compra_nombre text not null default '';
alter table public.leads add column if not exists diferencia_usd numeric;
alter table public.leads add column if not exists quote_id text not null default '';

create table if not exists public.audit_log (
  id text primary key,
  fecha bigint not null,
  accion text not null default '',
  entidad text not null default '',
  valor_anterior jsonb,
  valor_nuevo jsonb,
  created_at timestamptz not null default now()
);

-- Fila única (id = 'singleton'): última modificación y estado de la
-- configuración. config_state = 'pristine' significa "nadie configuró
-- todavía" (la migración desde un navegador viejo SÍ está permitida);
-- 'configured' significa que ya hay datos propios y NUNCA se pisan.
create table if not exists public.app_meta (
  id text primary key default 'singleton',
  last_modified bigint
);
alter table public.app_meta add column if not exists config_state text not null default 'pristine';

-- Administradores autorizados a modificar datos.
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  created_at timestamptz not null default now()
);

-- Estado inicial de app_meta: si la base ya tenía datos de configuración
-- (instalación anterior) se marca como 'configured' para que NADA los pise.
do $$
begin
  if not exists (select 1 from public.app_meta where id = 'singleton') then
    insert into public.app_meta (id, config_state)
    values (
      'singleton',
      case when exists (select 1 from public.modelos)
             or exists (select 1 from public.valoraciones)
             or exists (select 1 from public.catalog)
             or exists (select 1 from public.capacidades)
           then 'configured' else 'pristine' end
    );
  end if;
end $$;

-- ------------------------------------------------------------
-- 2) RESTRICCIONES (relaciones, rangos y tamaños)
-- ------------------------------------------------------------
-- Se agregan como NOT VALID: se aplican a todo dato NUEVO sin tocar ni
-- rechazar datos viejos que ya existan (no se pierde nada).

do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('valoraciones', 'fk_valoraciones_modelo',   'foreign key (modelo_id) references public.modelos (id) on update cascade on delete cascade'),
      ('valoraciones', 'fk_valoraciones_capacidad','foreign key (capacidad_id) references public.capacidades (id) on update cascade on delete cascade'),
      ('valoraciones', 'ck_valoraciones_valor',    'check (valor_usd >= 0 and valor_usd <= 1000000)'),
      ('bateria',      'ck_bateria_rango',         'check (porcentaje_minimo between 0 and 100 and porcentaje_maximo between 0 and 100 and porcentaje_minimo <= porcentaje_maximo)'),
      ('bateria',      'ck_bateria_descuento',     'check (descuento_usd >= 0 and descuento_usd <= 1000000)'),
      ('desperfectos', 'ck_desperfectos_descuento','check (descuento_usd >= 0 and descuento_usd <= 1000000)'),
      ('catalog',      'ck_catalog_precio',        'check (precio_base_usd >= 0 and precio_base_usd <= 1000000)'),
      ('catalog',      'ck_catalog_stock',         'check (stock between 0 and 1)'),
      ('catalog',      'ck_catalog_estado',        'check (estado in (''published'', ''out'', ''draft''))'),
      ('app_meta',     'ck_app_meta_state',        'check (config_state in (''pristine'', ''configured''))'),
      -- Tablas de escritura pública: límites estrictos contra basura/abuso.
      ('quotes_history','ck_quotes_limites',       'check (char_length(id) between 1 and 80 and char_length(modelo_id) <= 80 and char_length(modelo_nombre) <= 120 and char_length(capacidad_id) <= 80 and char_length(capacidad_nombre) <= 60 and char_length(color) <= 40 and char_length(bateria_label) <= 80 and jsonb_typeof(desperfectos) = ''array'' and pg_column_size(desperfectos) <= 2000 and valor_base_usd between 0 and 1000000 and descuento_bateria_usd between 0 and 1000000 and descuento_desperfectos_usd between 0 and 1000000 and valor_final_usd between 0 and 1000000 and fecha between 1500000000000 and 4000000000000)'),
      ('leads',        'ck_leads_limites',         'check (char_length(id) between 1 and 80 and char_length(nombre) <= 80 and whatsapp ~ ''^[0-9]{0,20}$'' and char_length(modelo_id) <= 80 and char_length(modelo_nombre) <= 120 and char_length(capacidad_nombre) <= 60 and char_length(producto_compra_nombre) <= 120 and char_length(quote_id) <= 80 and resultado_usd between 0 and 1000000 and (diferencia_usd is null or diferencia_usd between 0 and 1000000) and fecha between 1500000000000 and 4000000000000)')
    ) as t(tbl, cname, cdef)
  loop
    if not exists (
      select 1 from pg_constraint
      where conname = c.cname and conrelid = ('public.' || c.tbl)::regclass
    ) then
      begin
        execute format('alter table public.%I add constraint %I %s not valid', c.tbl, c.cname, c.cdef);
      exception when others then
        raise notice 'No se pudo crear la restricción % (%): %', c.cname, c.tbl, sqlerrm;
      end;
    end if;
  end loop;
end $$;

-- Una sola valoración por modelo+capacidad (si hubiera duplicados viejos,
-- no se borra nada: se avisa y se sigue).
do $$
begin
  create unique index if not exists uq_valoraciones_modelo_capacidad
    on public.valoraciones (modelo_id, capacidad_id);
exception when others then
  raise notice 'No se creó el índice único de valoraciones (hay duplicados previos): %', sqlerrm;
end $$;

-- Índices útiles para el panel admin.
create index if not exists idx_valoraciones_modelo on public.valoraciones (modelo_id);
create index if not exists idx_valoraciones_capacidad on public.valoraciones (capacidad_id);
create index if not exists idx_quotes_history_fecha on public.quotes_history (fecha desc);
create index if not exists idx_quotes_history_created on public.quotes_history (created_at desc);
create index if not exists idx_leads_fecha on public.leads (fecha desc);
create index if not exists idx_leads_created on public.leads (created_at desc);
create index if not exists idx_audit_log_fecha on public.audit_log (fecha desc);

-- ------------------------------------------------------------
-- 3) FUNCIONES Y TRIGGERS
-- ------------------------------------------------------------

-- ¿El usuario logueado es administrador? (la usan las políticas y el panel)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- Alta de administrador. SOLO se puede ejecutar desde el SQL Editor
-- (rol postgres): ni visitantes ni usuarios logueados pueden llamarla.
create or replace function public.add_admin(p_email text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_id is null then
    return 'NO EXISTE el usuario ' || p_email || ' en Authentication -> Users. Crealo primero y volvé a ejecutar esta línea.';
  end if;
  insert into public.admins (user_id, email) values (v_id, lower(trim(p_email)))
  on conflict (user_id) do update set email = excluded.email;
  return 'OK: ' || p_email || ' ahora es administrador.';
end $$;
revoke all on function public.add_admin(text) from public, anon, authenticated;

-- Quitar un administrador (mismo criterio: solo desde el SQL Editor).
create or replace function public.remove_admin(p_email text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  delete from public.admins where lower(email) = lower(trim(p_email));
  return 'Listo: ' || p_email || ' ya no es administrador.';
end $$;
revoke all on function public.remove_admin(text) from public, anon, authenticated;

-- updated_at automático en las tablas de configuración.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['modelos','capacidades','valoraciones','bateria','desperfectos','catalog','contact']
  loop
    execute format('drop trigger if exists trg_touch_updated_at on public.%I', t);
    execute format('create trigger trg_touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- Freno anti-abuso para las tablas donde escribe el público: si en el
-- último minuto ya entraron demasiados registros, se rechazan los nuevos
-- (no aplica a administradores).
create or replace function public.limit_public_inserts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Los administradores (importar backups, migrar historiales) no tienen tope.
  if public.is_admin() then
    return new;
  end if;
  execute format(
    'select count(*) from public.%I where created_at > now() - interval ''1 minute''',
    tg_table_name
  ) into v_count;
  if v_count >= 120 then
    raise exception 'Demasiados registros en poco tiempo. Probá de nuevo en un minuto.'
      using errcode = '54000';
  end if;
  return new;
end $$;

drop trigger if exists trg_limit_quotes on public.quotes_history;
create trigger trg_limit_quotes before insert on public.quotes_history
  for each row execute function public.limit_public_inserts();
drop trigger if exists trg_limit_leads on public.leads;
create trigger trg_limit_leads before insert on public.leads
  for each row execute function public.limit_public_inserts();

-- ------------------------------------------------------------
-- 4) ROW LEVEL SECURITY
-- ------------------------------------------------------------

alter table public.modelos enable row level security;
alter table public.capacidades enable row level security;
alter table public.valoraciones enable row level security;
alter table public.bateria enable row level security;
alter table public.desperfectos enable row level security;
alter table public.catalog enable row level security;
alter table public.contact enable row level security;
alter table public.quotes_history enable row level security;
alter table public.leads enable row level security;
alter table public.audit_log enable row level security;
alter table public.app_meta enable row level security;
alter table public.admins enable row level security;

-- Se borran TODAS las políticas anteriores de estas tablas (incluidas las
-- de versiones viejas, que dejaban entrar a cualquier usuario registrado)
-- y se recrean desde cero.
do $$
declare
  p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('modelos','capacidades','valoraciones','bateria','desperfectos',
                        'catalog','contact','quotes_history','leads','audit_log','app_meta','admins')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- ---- Lectura pública de lo que necesita el cotizador ----
create policy "public read modelos" on public.modelos for select to anon, authenticated using (true);
create policy "public read capacidades" on public.capacidades for select to anon, authenticated using (true);
create policy "public read valoraciones" on public.valoraciones for select to anon, authenticated using (true);
create policy "public read bateria" on public.bateria for select to anon, authenticated using (true);
create policy "public read desperfectos" on public.desperfectos for select to anon, authenticated using (true);
create policy "public read catalog" on public.catalog for select to anon, authenticated using (true);
create policy "public read contact" on public.contact for select to anon, authenticated using (true);

-- ---- Escritura de configuración: SOLO administradores ----
create policy "admin write modelos" on public.modelos for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin write capacidades" on public.capacidades for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin write valoraciones" on public.valoraciones for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin write bateria" on public.bateria for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin write desperfectos" on public.desperfectos for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin write catalog" on public.catalog for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin write contact" on public.contact for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---- quotes_history / leads: el público SOLO inserta; el admin gestiona ----
create policy "public insert quotes_history" on public.quotes_history for insert to anon, authenticated
  with check (true);
create policy "admin select quotes_history" on public.quotes_history for select to authenticated
  using (public.is_admin());
create policy "admin update quotes_history" on public.quotes_history for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin delete quotes_history" on public.quotes_history for delete to authenticated
  using (public.is_admin());

create policy "public insert leads" on public.leads for insert to anon, authenticated
  with check (true);
create policy "admin select leads" on public.leads for select to authenticated
  using (public.is_admin());
create policy "admin update leads" on public.leads for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin delete leads" on public.leads for delete to authenticated
  using (public.is_admin());

-- ---- audit_log / app_meta: exclusivo de administradores ----
create policy "admin all audit_log" on public.audit_log for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin all app_meta" on public.app_meta for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---- admins: cada uno solo puede verse a sí mismo; nadie escribe por la API ----
create policy "admins read self" on public.admins for select to authenticated
  using (user_id = auth.uid());

-- Permisos de tabla: el rol anon no necesita nada más que lo de arriba.
revoke all on public.admins from anon, authenticated;
grant select on public.admins to authenticated;

-- ------------------------------------------------------------
-- 5) REALTIME (sintaxis válida e idempotente)
-- ------------------------------------------------------------
-- Las tablas se agregan a la publicación solo si todavía no están.
-- RLS también aplica a Realtime: los visitantes solo reciben eventos de
-- las tablas que pueden leer; cotizaciones/leads/auditoría/meta solo
-- llegan a administradores.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'No existe la publicación supabase_realtime: activá Realtime en el proyecto.';
    return;
  end if;
  foreach t in array array['modelos','capacidades','valoraciones','bateria','desperfectos',
                           'catalog','contact','quotes_history','leads','audit_log','app_meta']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 6) ADMINISTRADOR
-- ------------------------------------------------------------
-- PASO PREVIO: crear el usuario en Dashboard -> Authentication -> Users ->
-- Add user (email + contraseña, marcando "Auto Confirm User").
-- Después, cambiar el email de abajo por el real y ejecutar esta línea
-- (podés volver a ejecutar solo esta línea cuando quieras sumar otro admin).
select public.add_admin('reborncommerce2@gmail.com');
