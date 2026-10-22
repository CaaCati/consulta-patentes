// Lee los Excel tal cual salen del sistema y los convierte en filas para cargar.
// Reconoce cada hoja por los nombres de sus columnas, no por el nombre de la hoja.
// No sube nombres, DNI, domicilios ni montos: solo lo que la app necesita.
(function (global) {
  // "Id.Bien" -> "idbien", "Año" / "A�o" -> "ano" / "ao"
  function claveColumna(s) {
    return String(s ?? "")
      .normalize("NFD")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function buscarColumna(claves, ...candidatos) {
    for (const c of candidatos) {
      const i = claves.findIndex((k) => (c instanceof RegExp ? c.test(k) : k === c));
      if (i >= 0) return i;
    }
    return -1;
  }

  function texto(v) {
    if (v === null || v === undefined) return "";
    return String(v).trim();
  }

  function entero(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : parseInt(String(v).replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }

  // "2.058,00" -> 2058 ; 2058 -> 2058
  function numeroAR(v) {
    if (typeof v === "number") return v;
    const s = texto(v).replace(/\./g, "").replace(",", ".");
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  // Date o "dd/mm/aaaa" -> "aaaa-mm-dd". Fechas absurdas (ej. año 1209) -> null
  function fechaISO(v) {
    let d = null, m = null, a = null;
    if (v instanceof Date && !isNaN(v)) {
      d = v.getDate(); m = v.getMonth() + 1; a = v.getFullYear();
    } else {
      const r = texto(v).match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
      if (r) { d = +r[1]; m = +r[2]; a = +r[3]; }
      const iso = texto(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) { a = +iso[1]; m = +iso[2]; d = +iso[3]; }
    }
    if (!a || a < 1950 || a > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function anioValido(v) {
    const n = entero(v);
    return n && n >= 1900 && n <= 2100 ? n : null;
  }

  // Devuelve { tipo, filas, columnas } o null si la hoja no es de las que usamos
  function leerHoja(nombre, matriz) {
    // La fila de títulos puede no ser la primera: buscarla en las primeras 10
    for (let h = 0; h < Math.min(10, matriz.length); h++) {
      const claves = (matriz[h] || []).map(claveColumna);
      const datos = matriz.slice(h + 1).filter((f) => f && f.some((c) => texto(c) !== ""));

      // Cobranzas
      if (claves.includes("recibonumero") && claves.includes("idbien")) {
        const c = {
          recibo: buscarColumna(claves, "recibonumero"),
          fecha: buscarColumna(claves, "fecha"),
          tipo: buscarColumna(claves, "tipo"),
          idBien: buscarColumna(claves, "idbien"),
          total: buscarColumna(claves, "total"),
          anio: buscarColumna(claves, "ano", "ao", /^a.?o$/),
          periodo: buscarColumna(claves, "periodo"),
          comentario: buscarColumna(claves, "comentarios", "comentario"),
        };
        const filas = datos
          .filter((f) => c.tipo < 0 || ["au", ""].includes(texto(f[c.tipo]).toLowerCase()))
          .map((f) => ({
            recibo: texto(f[c.recibo]),
            id_bien: entero(f[c.idBien]),
            fecha: fechaISO(f[c.fecha]),
            anio: anioValido(f[c.anio]),
            periodo: texto(f[c.periodo]),
            comentario: texto(f[c.comentario]),
            total: numeroAR(f[c.total]),
          }))
          .filter((f) => f.recibo && f.id_bien && f.fecha);
        return { hoja: nombre, tipo: "pagos", filas, descartadas: datos.length - filas.length };
      }

      // Padrón de vehículos activos
      if (claves.includes("dominio") && claves.includes("idbien")) {
        const c = {
          idBien: buscarColumna(claves, "idbien"),
          dominio: buscarColumna(claves, "dominio"),
          anio: buscarColumna(claves, "ano", "ao", /^a.?o$/),
          marca: buscarColumna(claves, "marca"),
          modelo: buscarColumna(claves, "modelo"),
          alta: buscarColumna(claves, "fechaalta"),
          baja: buscarColumna(claves, "fechabaja"),
        };
        const filas = datos
          .map((f) => ({
            id_bien: entero(f[c.idBien]),
            dominio: texto(f[c.dominio]),
            marca: texto(f[c.marca]),
            modelo: texto(f[c.modelo]),
            anio: anioValido(f[c.anio]),
            fecha_alta: fechaISO(f[c.alta]),
            fecha_baja: fechaISO(f[c.baja]),
          }))
          .filter((f) => f.id_bien && f.dominio);
        return { hoja: nombre, tipo: "padron", filas, descartadas: datos.length - filas.length };
      }

      // Deudas de automotor (una fila por patente)
      if (claves.includes("bien") && claves.includes("deuda")) {
        const c = {
          bien: buscarColumna(claves, "bien"),
          tributo: buscarColumna(claves, "tributo"),
        };
        const filas = datos
          .filter((f) => c.tributo < 0 || /automotor/i.test(texto(f[c.tributo])))
          .map((f) => ({ bien: texto(f[c.bien]) }))
          .filter((f) => f.bien);
        return { hoja: nombre, tipo: "deudas", filas, descartadas: datos.length - filas.length };
      }
    }
    return null;
  }

  // Recibe un workbook de SheetJS y devuelve las hojas reconocidas e ignoradas
  function leerLibro(XLSX, libro) {
    const reconocidas = [];
    const ignoradas = [];
    for (const nombre of libro.SheetNames) {
      const matriz = XLSX.utils.sheet_to_json(libro.Sheets[nombre], {
        header: 1, raw: true, defval: null,
      });
      const r = leerHoja(nombre, matriz);
      if (r) reconocidas.push(r);
      else ignoradas.push(nombre);
    }
    return { reconocidas, ignoradas };
  }

  // Texto legible del período de un pago
  function describirPeriodo(anio, periodo) {
    const p = texto(periodo);
    const m = p.match(/^(\d{4})-\d+\.Trimestral\/0?(\d+)-(.+)$/i);
    if (m) return `Cuota ${m[2]}/4 del ${m[1]} (${m[3].replace(/-/g, " ")})`;
    if (/varios/i.test(p)) return "Varios períodos";
    return p || (anio ? `Año ${anio}` : "");
  }

  global.Lector = { leerLibro, leerHoja, describirPeriodo, fechaISO, numeroAR, claveColumna };
})(typeof window !== "undefined" ? window : globalThis);
