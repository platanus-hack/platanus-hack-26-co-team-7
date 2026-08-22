# demo-plan.md — Guión de 3 minutos para los jueces

## Setup (5 minutos antes)

- 5 teléfonos en una mesa, todos con Replica instalado y configurado.
- Backend corriendo en laptop con dashboard abierto en pantalla grande.
- Teléfono A es **el del afectado** (Juan, severidad 3).
- Teléfonos B, C son **relays** (peatones caminando).
- Teléfono D es **gateway** (en zona con Wi-Fi).
- Teléfono E es **familiar** (viendo el dashboard).
- Teléfono F (opcional) es **rescatista** (offline, llega al final).

Tener screenshot/videos de respaldo por si algo falla.

---

## Guión (3 minutos exactos)

### 0:00 — Apertura emocional (15 segundos)

> "Son las 2:37 de la mañana. Ocurre un terremoto en Bogotá. Miles de personas intentan llamar a sus familiares. Las redes se saturan. Una persona tiene su teléfono, su GPS, un video de lo que ocurre... pero no puede enviar nada."

[Pulsa un botón en backend → simula trigger sísmico]

---

### 0:15 — Activación (15 segundos)

> "Juan activa Replica en Emergency Mode."

[Teléfono A: UI muestra Emergency Mode activo. Empieza a grabar.]

---

### 0:30 — Primera conexión (15 segundos)

[Teléfono A y B se descubren vía Nearby Connections. Handshake.]

[A manda telegrama a B. B guarda en ledger.]

> "El teléfono de Juan busca a alguien cerca. Encuentra a B — un peatón a 30 metros. Le pasa un telegrama diminuto: estoy aquí, mi GPS, mi estado."

---

### 0:45 — Propagación (20 segundos)

[B se re-encuentra con C. Sincronizan ledgers. B manda el telegrama a C.]

[C se re-encuentra con D (gateway con Internet). C manda el telegrama a D.]

[Dashboard del familiar (E) se actualiza en tiempo real con animación de path.]

> "El mensaje va saltando: B, C, D. En D, hay Internet. El mensaje llega al servidor."

---

### 1:05 — Dashboard familiar (15 segundos)

[E ve en pantalla: "Tu familiar Juan está en X, Y. Saltó por 3 nodos."]

> "Su familia, en otra parte de la ciudad, abre el dashboard. Ve dónde está Juan, hace cuánto se reportó, y por cuántos nodos pasó la información."

---

### 1:20 — 🔥 EL MOMENTO WOW — el ledger distribuido (30 segundos)

[Teléfono F (rescatista, OFFLINE, en modo pasivo) entra al rango de B.]

[B le sincroniza su ledger completo. F ahora ve 4 emergencias.]

[F abre la app → ve: "4 personas reportadas en la zona, severidad 2-4. La más cercana: 200m al norte."]

> "Y aquí está la parte que cambia todo: un rescatista llega a la zona. Su teléfono tiene Replica pero no tiene Internet. Apenas entra al rango de cualquier Replica cercano — en este caso B — recibe automáticamente la lista de personas reportadas en la zona. No necesita Internet. La información ya está distribuida en los teléfonos de la gente alrededor."

---

### 1:50 — Origen pierde Internet pero la evidencia se preserva (20 segundos)

[Simulación: A se desconecta / se queda sin batería.]

[Mostrar en pantalla del familiar: "Video adjunto: pendiente"]

[Esperar 3 segundos.]

[Mostrar: "Video adjunto: recibido ✅" — el gateway subió lo que tenía del origen.]

> "Si Juan tiene que irse y deja su teléfono, los primeros 15-30 segundos del video ya están replicados en otros teléfonos. La información no desaparece con el teléfono."

---

### 2:10 — Cierre emocional (30 segundos)

[Mostrar la cadena: A → B → C → D → Backend → Dashboard.]

> "Replica convierte los teléfonos en una red temporal que se comunica sin Internet. La información viaja de bolsillo en bolsillo hasta encontrar una salida. Cuando la red colapsa, no perdemos a las personas — la información sigue llegando."

[Silencio. Pausa.]

> "Eso es Replica."

---

## Tips para el pitch

- **NO mostrar código** durante los 3 minutos. Solo la demo.
- **SÍ mostrar** el path A → B → C → D con animación visible (flechas en pantalla).
- **El "momento WOW" es el ledger del rescatista** (1:20). Practica esa transición 5 veces. Si algo falla, podés decir "como ven, F acaba de entrar al rango de B y ya tiene toda la lista — sin Internet".
- **Tener un speaker con audio decente** — la mitad del impacto es la voz pausada.
- **No correr** — los silencios son potentes.
- **Si el demo falla**, tener un video pregrabado de 60 segundos como backup.

## Riesgos identificados y mitigación

| Riesgo | Mitigación |
|---|---|
| Nearby Connections no descubre en 15s | Tener 2 teléfonos spare para reemplazar |
| Battery se agota durante demo | Cargar todo al 100% 1h antes |
| Backend se cae | Tener `docker-compose up` listo como backup local |
| Red del会場 interfiere con Wi-Fi | Apagar Wi-Fi de los teléfonos, usar solo datos para el gateway |
| Dashboard no actualiza | Tener screenshot del estado esperado |
| Alguien toca un teléfono y rompe la demo | Pegar los teléfonos a la mesa con cinta |

## Ensayo

- **Ensayar el pitch completo 5 veces** antes de subir al escenario.
- **Cronometrar** — los 3 minutos son inflexibles.
- **Que TODOS los miembros del equipo sepan correr el demo** en caso de que uno se bloquee.
- **No cambiar NADA** entre el último ensayo y el pitch oficial (no "arreglar" cosas de último momento).

## Frase clave para que el equipo memorice

> "La información no desaparece cuando la red cae. Se transporta de bolsillo en bolsillo."

Si el equipo tiene internalizada esa frase, todo lo demás fluye.
