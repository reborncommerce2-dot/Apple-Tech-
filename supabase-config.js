/*
  supabase-config.js = LO ÚNICO QUE HAY QUE EDITAR PARA CONECTAR OTRO PROYECTO.

  Supabase Dashboard -> Project Settings -> API (o "API Keys"):
    - supabaseUrl : "Project URL"            (https://xxxxx.supabase.co)
    - supabaseKey : "Publishable key" (sb_publishable_...) o la clave
                    "anon public" (empieza con eyJ...).

  Estas claves están pensadas para estar en el navegador: la seguridad
  real la dan las políticas RLS de supabase_schema.sql.

  NUNCA pegar acá una clave "secret" / "service_role": daría control
  total de la base a cualquiera que abra el sitio. supabaseClient.js
  la rechaza si detecta una.
*/
window.APPLETECH_CONFIG = {
  supabaseUrl: "https://fhxyrbrsswymbgswggxp.supabase.co",
  supabaseKey: "sb_publishable_cThaWElxVgGcuWKaswrHmA_pVZG8Jwa",
};
