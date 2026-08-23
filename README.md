# Replica

> Red de comunicación de emergencia que sigue funcionando cuando la infraestructura cae.

**Track:** 🚨 Emergencies
**Hackathon:** Platanus Hack 26 — Bogotá
**Team:** team-7

## ¿Qué es Replica?

Después de un terremoto las redes se saturan o caen. Una persona puede tener su teléfono, su ubicación y un video de lo que ocurrió, pero no puede enviar nada. Su familia no sabe dónde está.

Replica convierte los teléfonos en una **red temporal que se auto-enriquece con cada interacción**: cuando el dispositivo A detecta la emergencia y emite un pequeño *telegrama* (~120 bytes) hacia un dispositivo B cercano, B no solo lo guarda para reenviarlo — **sincroniza su historial completo con A** y se lo pasa al siguiente. Cada nodo acumula un registro distribuido de personas que necesitan ayuda. Cuando un nodo con Internet aparece, todo se sube al servidor.

## ¿Cómo funciona (en 30 segundos)?

1. 📱 **A** detecta la emergencia → activa Replica → empieza a grabar y emitir el telegrama.
2. 📡 **A ↔ B** (Wi-Fi Direct / BLE, sin Internet) → B guarda el telegrama y sincroniza su ledger con A.
3. 📡 **B ↔ C** → C guarda y sincroniza su ledger con B.
4. 🌐 **D** tiene Internet → D sube todo al backend.
5. 👨‍👩‍👧 Familiar abre el dashboard → ve "tu ser querido está en X, Y, saltó por N nodos".
6. 🚑 **Bonus:** un rescatista con Replica que pasa cerca ve la lista de personas reportadas en la zona — sin Internet, sin servidor, solo del ledger distribuido.

## Stack

- **Móvil:** Android (Kotlin) + Google Nearby Connections sobre Wi-Fi Direct / BLE
- **Backend:** TBD
- **Persistencia local:** SQLite (Room)
- **Frontend dashboard:** Web (TBD)

## Equipo

- Javier Alexander Gomez Delgado ([@jajavier2404](https://github.com/jajavier2404))
- Juan Camilo Albarracín Urrego ([@albarracin-sg](https://github.com/albarracin-sg))
- Santiago Salazar Becerra ([@santiagx2001](https://github.com/santiagx2001))
- Lucio Alejandro Moreno ([@leejand](https://github.com/leejand))

## 📐 Especificación técnica completa

Toda la arquitectura, el protocolo del telegrama, la máquina de estados del nodo, el diseño del ledger distribuido, el manejo de evidencia y el plan de demo están centralizados en [`openspec/`](./openspec/README.md):

| Archivo | Contenido |
|---|---|
| [`openspec/project.md`](./openspec/project.md) | Problema y propuesta de valor |
| [`openspec/protocol.md`](./openspec/protocol.md) | El "telegrama" JSON + máquina de estados del nodo |
| [`openspec/communication.md`](./openspec/communication.md) | Capa radio (Nearby / Wi-Fi Direct / BLE) |
| [`openspec/ledger.md`](./openspec/ledger.md) | Registro distribuido y gossip entre pares |
| [`openspec/storage.md`](./openspec/storage.md) | Manejo de evidencia (video/audio) |
| [`openspec/orphan-device.md`](./openspec/orphan-device.md) | Caso "el teléfono quedó tirado en la zona" |
| [`openspec/api.md`](./openspec/api.md) | Endpoints backend mínimos |
| [`openspec/demo-plan.md`](./openspec/demo-plan.md) | Guión de 3 minutos para los jueces |

## Antes de submit

- ✅ Llenar `platanus-hack-project.jsonc` (name, oneliner, descripción, deploy URL)
- ✅ Reemplazar `project-description.md` con descripción de cara al voto
- ✅ Logo 1000x1000 max 500kb
