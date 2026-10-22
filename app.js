// Lógica de la app: login por DNI, consulta de patentes, carga de informes y usuarios.
(function () {
  const C = window.CONFIG;
  const $ = (id) => document.getElementById(id);
  const DOMINIO = "transito.local";
  const sb = C.SUPABASE_URL && C.SUPABASE_KEY ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY) : null;
  let perfil = null;
  let hojasLeidas = [];

  const ESTADOS = {
    al_dia: "AL DÍA",
    con_deuda: "CON DEUDA",
    no_registrado: "NO REGISTRADO EN EL MUNICIPIO",
    baja: "DADO DE BAJA",
    exento: "EXENTO",
    invalida: "PATENTE NO VÁLIDA",
  };
  const TIPOS = { padron: "Padrón de vehículos activos", deudas: "Deudas de automotor", pagos: "Cobranzas" };
  const ORDEN_CARGA = ["padron", "deudas", "pagos"];
  const ROLES = { admin: "Administrador", carga: "Carga de datos", agente: "Agente" };

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fechaAR(iso) {
    if (!iso) return "";
    const [a, m, d] = String(iso).slice(0, 10).split("-");
    return `${d}/${m}/${a}`;
  }
  function hoyISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function mensajeError(e) {
    const m = e?.message || String(e);
    if (/Invalid login credentials/i.test(m)) return "DNI o contraseña incorrectos.";
    if (/banned/i.test(m)) return "Tu usuario está desactivado.";
    if (/Failed to fetch|NetworkError/i.test(m)) return "Sin conexión. Revisá la señal e intentá de nuevo.";
    return m;
  }
  function mostrar(vista) {
    for (const v of ["vista-login", "vista-inicio", "vista-app"]) $(v).classList.toggle("oculto", v !== vista);
  }

  // Llama a la función de usuarios y devuelve su JSON (o lanza el error que explica el servidor)
  async function funcionUsuarios(body) {
    const { data, error } = await sb.functions.invoke("admin-usuarios", { body });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).error || msg; } catch (_) { /* sin cuerpo */ }
      throw new Error(msg);
    }
    return data;
  }

  // ===== Intro =====
  // Se ve una vez por sesión del navegador y un toque la saltea
  function correrIntro() {
    const el = $("intro");
    if (!el) return;
    let cerrada = false;
    const cerrar = () => {
      if (cerrada) return;
      cerrada = true;
      el.classList.add("saliendo");
      setTimeout(() => el.remove(), 400);
    };
    let yaVista = false;
    try { yaVista = sessionStorage.getItem("intro-vista") === "1"; sessionStorage.setItem("intro-vista", "1"); } catch (_) { /* sin storage */ }
    if (yaVista || matchMedia("(prefers-reduced-motion: reduce)").matches) { el.remove(); return; }
    el.addEventListener("click", cerrar);
    setTimeout(cerrar, 2400);
  }

  // ===== App instalable y actualización automática =====
  function prepararPWA() {
    if (!("serviceWorker" in navigator)) return;
    const habiaVersion = !!navigator.serviceWorker.controller;
    let recargando = false;
    // Cuando se publica una versión nueva, el service worker nuevo toma el control: recargar una vez
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!habiaVersion || recargando) return;
      recargando = true;
      location.reload();
    });
    navigator.serviceWorker.register("sw.js").then((reg) => {
      // Buscar actualizaciones al volver a la app y cada 30 minutos si queda abierta
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update(); });
      setInterval(() => reg.update(), 30 * 60 * 1000);
    }).catch(() => { /* sin service worker la app funciona igual, solo no se instala */ });

    // Botón "Instalar" (Android/Chrome). En iPhone se instala desde Compartir → Agregar a inicio.
    let pedido = null;
    window.addEventListener("beforeinstallprompt", (ev) => {
      ev.preventDefault();
      pedido = ev;
      $("instalar").classList.remove("oculto");
    });
    $("btn-instalar").addEventListener("click", async () => {
      if (!pedido) return;
      pedido.prompt();
      await pedido.userChoice;
      pedido = null;
      $("instalar").classList.add("oculto");
    });
    window.addEventListener("appinstalled", () => $("instalar").classList.add("oculto"));
  }

  // ===== Arranque / sesión =====
  async function iniciar() {
    correrIntro();
    prepararPWA();
    $("titulo").textContent = C.NOMBRE_APP;
    document.title = C.NOMBRE_APP;
    if (!sb) {
      mostrar("vista-login");
      $("login-error").textContent = "Falta configurar la conexión (config.js).";
      return;
    }
    const { data } = await sb.auth.getSession();
    if (data.session) await entrar();
    else await pantallaLogin();
  }

  async function pantallaLogin() {
    perfil = null;
    $("btn-salir").classList.add("oculto");
    $("subtitulo").textContent = C.MUNICIPIO;
    mostrar("vista-login");
    try {
      const r = await funcionUsuarios({ accion: "necesita_inicio" });
      $("link-inicio").hidden = !r.necesita;
    } catch (_) { $("link-inicio").hidden = true; }
  }

  async function entrar() {
    const { data, error } = await sb.rpc("transito_mi_perfil");
    if (error || !data) {
      await sb.auth.signOut();
      await pantallaLogin();
      $("login-error").textContent = "Tu usuario no tiene acceso a la app.";
      return;
    }
    perfil = data;
    $("subtitulo").textContent = `${perfil.nombre} · ${ROLES[perfil.rol]}`;
    $("btn-salir").classList.remove("oculto");
    for (const b of document.querySelectorAll("#tabs button")) {
      const roles = b.dataset.roles;
      b.classList.toggle("oculto", !!roles && !roles.split(",").includes(perfil.rol));
    }
    // Un agente solo tiene una pestaña: no hace falta mostrar la barra
    $("tabs").classList.toggle("oculto", perfil.rol === "agente");
    mostrar("vista-app");
    cambiarTab("consultar");
  }

  $("form-login").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("login-error").textContent = "";
    const dni = $("login-dni").value.replace(/\D/g, "");
    const { error } = await sb.auth.signInWithPassword({ email: `${dni}@${DOMINIO}`, password: $("login-pass").value });
    if (error) { $("login-error").textContent = mensajeError(error); return; }
    $("login-pass").value = "";
    await entrar();
  });

  $("btn-salir").addEventListener("click", async () => {
    await sb.auth.signOut();
    $("resultado").innerHTML = "";
    await pantallaLogin();
  });

  $("ir-inicio").addEventListener("click", (ev) => { ev.preventDefault(); mostrar("vista-inicio"); });

  $("form-inicio").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("inicio-error").textContent = "";
    if ($("ini-pass").value !== $("ini-pass2").value) {
      $("inicio-error").textContent = "Las contraseñas no coinciden.";
      return;
    }
    try {
      const dni = $("ini-dni").value.replace(/\D/g, "");
      await funcionUsuarios({ accion: "inicio", dni, nombre: $("ini-nombre").value, password: $("ini-pass").value });
      const { error } = await sb.auth.signInWithPassword({ email: `${dni}@${DOMINIO}`, password: $("ini-pass").value });
      if (error) throw error;
      $("form-inicio").reset();
      await entrar();
    } catch (e) {
      $("inicio-error").textContent = mensajeError(e);
    }
  });

  // ===== Pestañas =====
  function cambiarTab(tab) {
    for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("activa", b.dataset.tab === tab);
    for (const t of ["consultar", "cargar", "usuarios"]) $(`tab-${t}`).classList.toggle("oculto", t !== tab);
    // En celular no se enfoca solo (abriría el teclado); en computadora sí
    if (tab === "consultar" && matchMedia("(pointer: fine)").matches) $("patente").focus();
    if (tab === "cargar") { $("datos-al").value ||= hoyISO(); cargarEstadoDatos(); }
    if (tab === "usuarios") listarUsuarios();
  }
  $("tabs").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-tab]");
    if (b) cambiarTab(b.dataset.tab);
  });

  // ===== Consulta =====
  function lineaDatos(d) {
    if (!d) return "";
    const partes = [];
    if (d.padron) partes.push(`Padrón al ${fechaAR(d.padron.datos_al)}`);
    if (d.deudas) partes.push(`Deudas al ${fechaAR(d.deudas.datos_al)}`);
    if (d.pagos) partes.push(`Pagos al ${fechaAR(d.pagos.datos_al)}`);
    return partes.join(" · ");
  }

  function pintarResultado(r, buscada) {
    const filas = [];
    if (r.titular) filas.push([r.titular.includes(" / ") ? "Titulares" : "Titular", r.titular]);
    if (r.marca || r.modelo) filas.push(["Vehículo", [r.marca, r.modelo].filter(Boolean).join(" ")]);
    if (r.anio) filas.push(["Año", r.anio]);
    if (r.estado === "baja" && r.fecha_baja) filas.push(["Baja", fechaAR(r.fecha_baja)]);
    if (!["no_registrado", "invalida"].includes(r.estado)) {
      if (r.ultimo_pago) {
        filas.push(["Último pago", fechaAR(r.ultimo_pago.fecha)]);
      } else {
        filas.push(["Último pago", "Sin pagos en los registros cargados"]);
      }
    }
    const corregida = r.patente && r.patente !== buscada
      ? `<div class="muted">Se buscó como ${esc(r.patente)}</div>` : "";
    const aviso = r.verificar
      ? `<div class="aviso">Registra un pago del ${fechaAR(r.ultimo_pago?.fecha)}, posterior a la lista de deudas.
         Puede estar al día: verificar en el municipio.</div>` : "";
    $("resultado").innerHTML = `
      <div class="resultado r-${esc(r.estado)}">
        <div class="estado">${esc(ESTADOS[r.estado] || r.estado)}</div>
        <div class="pat">${esc(r.patente || buscada)}</div>
        ${corregida}
        ${filas.length ? `<dl>${filas.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
        ${aviso}
      </div>
      <div class="pie">${esc(lineaDatos(r.datos))}</div>`;
  }

  // Al tocar el cuadro para una nueva búsqueda, queda seleccionada la patente anterior para escribir encima
  $("patente").addEventListener("focus", () => $("patente").select());

  $("form-consulta").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const buscada = $("patente").value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!buscada) return;
    $("consulta-error").textContent = "";
    $("btn-consultar").disabled = true;
    $("btn-consultar").textContent = "Consultando…";
    try {
      const { data, error } = await sb.rpc("transito_consultar", { p: buscada });
      if (error) throw error;
      pintarResultado(data, buscada);
      // Cerrar el teclado y mostrar el resultado
      $("patente").blur();
      $("resultado").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      $("resultado").innerHTML = "";
      $("consulta-error").textContent = mensajeError(e);
    } finally {
      $("btn-consultar").disabled = false;
      $("btn-consultar").textContent = "Consultar";
    }
  });

  // ===== Carga de informes =====
  async function cargarEstadoDatos() {
    const { data, error } = await sb.rpc("transito_estado_datos");
    if (error) { $("estado-cargas").textContent = mensajeError(error); return; }
    const filas = ORDEN_CARGA.map((t) => data?.[t]
      ? `<tr><td>${TIPOS[t]}</td><td>Datos al ${fechaAR(data[t].datos_al)}<br><span class="muted">subido ${new Date(data[t].cargado).toLocaleString("es-AR")}</span></td></tr>`
      : `<tr><td>${TIPOS[t]}</td><td><span class="tag off">Nunca cargado</span></td></tr>`);
    $("estado-cargas").innerHTML = `<table>${filas.join("")}</table>`;
  }

  $("archivo").addEventListener("change", async () => {
    $("carga-error").textContent = "";
    $("carga-resultado").innerHTML = "";
    $("previa").innerHTML = "";
    $("btn-cargar").classList.add("oculto");
    hojasLeidas = [];
    const f = $("archivo").files[0];
    if (!f) return;
    try {
      $("previa").innerHTML = `<p class="muted">Leyendo ${esc(f.name)}…</p>`;
      // raw: en CSV/HTML no dejar que SheetJS adivine fechas (lee 06/01 como 1 de junio)
      // ni números ("156.590,00"); el lector los interpreta en formato argentino.
      const libro = XLSX.read(await f.arrayBuffer(), { cellDates: true, raw: true });
      const { reconocidas, ignoradas } = window.Lector.leerLibro(XLSX, libro);
      hojasLeidas = reconocidas.sort((a, b) => ORDEN_CARGA.indexOf(a.tipo) - ORDEN_CARGA.indexOf(b.tipo));
      if (!hojasLeidas.length) {
        $("previa").innerHTML = "";
        $("carga-error").textContent = "No reconocí ninguna hoja de padrón, deudas o cobranzas en este archivo.";
        return;
      }
      $("previa").innerHTML = hojasLeidas.map((h) => `
        <div class="hoja"><b>${esc(TIPOS[h.tipo])}</b>
          <span class="muted">Hoja "${esc(h.hoja)}": ${h.filas.length} filas
          ${h.descartadas ? ` (${h.descartadas} vacías o incompletas descartadas)` : ""}</span></div>`).join("")
        + (ignoradas.length ? `<p class="muted">Hojas ignoradas: ${ignoradas.map(esc).join(", ")}</p>` : "");
      $("btn-cargar").classList.remove("oculto");
    } catch (e) {
      $("previa").innerHTML = "";
      $("carga-error").textContent = "No se pudo leer el archivo: " + mensajeError(e);
    }
  });

  function resumenCarga(tipo, r) {
    if (tipo === "padron") {
      return `${r.vehiculos} vehículos (${r.bajas} dados de baja). ${r.corregidas} patentes corregidas.`
        + (r.formato_raro ? ` ${r.formato_raro} con formato raro: ${r.ejemplos_raros.join(", ")}.` : "");
    }
    if (tipo === "deudas") {
      return `${r.patentes_con_deuda} patentes con deuda.`
        + (r.no_estan_en_padron ? ` Atención: ${r.no_estan_en_padron} no están en el padrón.` : "");
    }
    return `${r.pagos_cargados} pagos del ${fechaAR(r.desde)} al ${fechaAR(r.hasta)}.`
      + ` ${r.anulados} anulados ignorados, ${r.exentos} exentos`
      + (r.en_cero_ignorados ? `, ${r.en_cero_ignorados} en $0 ignorados` : "") + ".";
  }

  $("btn-cargar").addEventListener("click", async () => {
    const datosAl = $("datos-al").value;
    if (!datosAl) { $("carga-error").textContent = "Indicá la fecha de los datos."; return; }
    $("btn-cargar").disabled = true;
    $("carga-error").textContent = "";
    const salida = [];
    try {
      for (const h of hojasLeidas) {
        $("btn-cargar").textContent = `Cargando ${TIPOS[h.tipo].toLowerCase()}…`;
        let total = null;
        if (h.tipo === "pagos") {
          // Las cobranzas se suman a las anteriores: se pueden mandar por partes
          for (let i = 0; i < h.filas.length; i += 2000) {
            const { data, error } = await sb.rpc("transito_cargar_pagos", { filas: h.filas.slice(i, i + 2000), datos_al: datosAl });
            if (error) throw error;
            total = total
              ? { ...data, pagos_cargados: total.pagos_cargados + data.pagos_cargados,
                  anulados: total.anulados + data.anulados, exentos: total.exentos + data.exentos,
                  en_cero_ignorados: total.en_cero_ignorados + data.en_cero_ignorados,
                  desde: total.desde < data.desde ? total.desde : data.desde,
                  hasta: total.hasta > data.hasta ? total.hasta : data.hasta }
              : data;
          }
        } else {
          const fn = h.tipo === "padron" ? "transito_cargar_padron" : "transito_cargar_deudas";
          const { data, error } = await sb.rpc(fn, { filas: h.filas, datos_al: datosAl });
          if (error) throw error;
          total = data;
        }
        salida.push(`<div class="hoja"><b>✔ ${esc(TIPOS[h.tipo])}</b><span class="muted">${esc(resumenCarga(h.tipo, total))}</span></div>`);
      }
      $("previa").innerHTML = "";
      $("btn-cargar").classList.add("oculto");
      $("archivo").value = "";
      hojasLeidas = [];
    } catch (e) {
      $("carga-error").textContent = "Error al cargar: " + mensajeError(e);
    } finally {
      $("carga-resultado").innerHTML = salida.join("");
      $("btn-cargar").disabled = false;
      $("btn-cargar").textContent = "Confirmar carga";
      cargarEstadoDatos();
    }
  });

  // ===== Usuarios =====
  // Contraseña fácil de dictar: sin letras/números que se confunden (0/O, 1/l/I)
  function generarPassword() {
    const letras = "abcdefghjkmnpqrstuvwxyz";
    const nums = "23456789";
    const r = (s) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
    let p = "";
    for (let i = 0; i < 6; i++) p += r(letras);
    for (let i = 0; i < 4; i++) p += r(nums);
    return p;
  }

  function mostrarClave(destino, dni, nombre, clave, titulo) {
    destino.innerHTML = `<div class="aviso">${esc(titulo)}<br>
      ${esc(nombre)} — DNI ${esc(dni)}<br>Contraseña: <span class="clave">${esc(clave)}</span><br>
      Anotala y entregásela en persona. No se vuelve a mostrar.</div>`;
  }

  let usuarios = [];
  async function listarUsuarios() {
    try {
      const { usuarios: lista } = await funcionUsuarios({ accion: "listar" });
      usuarios = lista;
      $("lista-usuarios").innerHTML = `<table><tr><th>Usuario</th><th>Rol</th><th></th></tr>${lista.map((u) => `
        <tr>
          <td>${esc(u.nombre)}<br><span class="muted">DNI ${esc(u.dni)}</span>
            ${u.activo ? "" : '<br><span class="tag off">Desactivado</span>'}</td>
          <td>${esc(ROLES[u.rol])}</td>
          <td><div class="acciones">
            <button class="sec chico" data-acc="clave" data-id="${esc(u.user_id)}">Nueva clave</button>
            <button class="sec chico" data-acc="activo" data-id="${esc(u.user_id)}">${u.activo ? "Desactivar" : "Activar"}</button>
          </div></td>
        </tr>`).join("")}</table>`;
    } catch (e) {
      $("lista-usuarios").textContent = mensajeError(e);
    }
  }

  $("lista-usuarios").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button[data-acc]");
    if (!b) return;
    const u = usuarios.find((x) => x.user_id === b.dataset.id);
    if (!u) return;
    try {
      if (b.dataset.acc === "clave") {
        if (!confirm(`¿Generar una contraseña nueva para ${u.nombre}? La anterior deja de funcionar.`)) return;
        const clave = generarPassword();
        await funcionUsuarios({ accion: "password", user_id: u.user_id, password: clave });
        mostrarClave($("usuario-creado"), u.dni, u.nombre, clave, "Contraseña nueva");
        $("usuario-creado").scrollIntoView({ behavior: "smooth" });
      } else {
        const accion = u.activo ? "desactivar" : "activar";
        if (!confirm(`¿Seguro que querés ${accion} a ${u.nombre}?`)) return;
        await funcionUsuarios({ accion: "activo", user_id: u.user_id, activo: !u.activo });
      }
      await listarUsuarios();
    } catch (e) {
      alert(mensajeError(e));
    }
  });

  $("u-generar").addEventListener("click", () => { $("u-pass").value = generarPassword(); });

  $("form-usuario").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("usuario-error").textContent = "";
    $("usuario-creado").innerHTML = "";
    const dni = $("u-dni").value.replace(/\D/g, "");
    const nombre = $("u-nombre").value.trim();
    const clave = $("u-pass").value.trim();
    try {
      await funcionUsuarios({ accion: "crear", dni, nombre, rol: $("u-rol").value, password: clave });
      mostrarClave($("usuario-creado"), dni, nombre, clave, "Usuario creado");
      $("form-usuario").reset();
      await listarUsuarios();
    } catch (e) {
      $("usuario-error").textContent = mensajeError(e);
    }
  });

  iniciar();
})();
