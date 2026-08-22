# ZIRO

**Red de comunicación de emergencia que sigue funcionando cuando la infraestructura colapsa.**

## El problema

Son las 2:37 de la mañana. Ocurre un terremoto en Bogotá. Miles de personas intentan llamar a sus familiares al mismo tiempo y las redes celulares se saturan o caen en minutos.

En ese momento hay tres personas que necesitan comunicarse y no pueden:

- **El afectado** tiene su teléfono, su GPS y hasta video de lo que está pasando, pero no puede emitir nada.
- **La familia** intenta llamar, mandar WhatsApp, ubicarlo en el mapa. Nada responde.
- **Los rescatistas** necesitan coordinar en zonas donde la red simplemente no existe.

Es el peor momento posible para quedarse sin red, y es exactamente cuando la red deja de existir.

## La solución

ZIRO convierte los teléfonos Android en una red temporal que sobrevive a la caída de la infraestructura. No necesita Internet ni torres celulares.

1. **Recopila** evidencia local en el teléfono del afectado: video, audio, GPS, timestamp e identificador anónimo.
2. **Transporta** un telegrama de ~120 bytes que resume la emergencia, saltando de teléfono en teléfono vía Wi-Fi Direct / BLE.
3. **Acumula** un registro distribuido en cada nodo: todo teléfono que ve un telegrama lo guarda y lo sincroniza con sus pares, formando un historial que crece orgánicamente.

Cuando un dispositivo con Internet entra en contacto con cualquier nodo de la cadena, vuelca todo al servidor. La familia ve en un dashboard dónde está su ser querido y por qué camino llegó la información hasta ahí.

## Por qué es diferente

No es mesh routing IP ni una app de mensajería más. Es **store-and-forward + gossip**: mucho más simple y mucho más robusto para un desastre.

| Solución | Lo que le falta |
|---|---|
| **Briar** | No acumula registro distribuido, no está pensado para emergencias masivas |
| **Bridgefy** | El paper de USENIX 2022 demostró que el MITM sigue siendo posible |
| **Meshtastic** | Requiere hardware externo (USD 30+ por nodo), no es phone-native |
| **Zello** | Server-mediated: si cae la red, cae Zello |
| **ShakeAlert / Google EEW** | Push unidireccional, no transporta evidencia |

ZIRO combina las cuatro cosas en un solo producto: registro distribuido, gossip entre pares, auto-supervivencia del dispositivo de origen y un caso de uso real para rescatistas sin Internet.

## Decisiones técnicas

- **Capa radio:** Google Nearby Connections sobre Wi-Fi Direct / BLE, estrategia P2P_STAR.
- **Telegrama:** JSON de ~120 bytes, entra en una sola trama y viaja en milisegundos.
- **Seguridad:** firma HMAC-SHA256 por dispositivo, para cerrar el vector de MITM.
- **Ledger local:** ventana de 24 horas, tope de 5 MB con LRU, TTL de 8 saltos.
- **Auto-supervivencia:** si el usuario abandona el teléfono, este ya repartió los primeros segundos de video entre los nodos cercanos y sigue emitiendo un beacon cada 60 segundos.
- **Trigger externo:** usamos EMSC o un botón manual. ZIRO no reinventa la detección de sismos.

## El resultado

**La información no desaparece cuando la red cae. Se transporta de bolsillo en bolsillo.**

---

*Platanus Hack 26 — Bogotá · Track Emergencias*
