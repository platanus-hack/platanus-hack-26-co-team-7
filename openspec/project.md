# ZIRO — Project Brief

## El problema

Después de un terremoto (Colombia es zona sísmica, Recordar el Eje Cafetero 1999, los sismos recientes del Pacífico) las redes celulares se saturan o caen en cuestión de minutos. Mientras la infraestructura colapsa:

- La persona afectada **tiene** su teléfono, su GPS, posiblemente video de lo que está ocurriendo.
- Su familia intenta llamarla, mandarle WhatsApp, localizarla por Google Maps.
- **Nadie puede comunicarse.**

Es el peor momento posible para no tener red, y es exactamente cuando la red deja de existir.

Hay tres categorías de gente que necesitan comunicarse:

1. **El afectado**, que tiene info pero no puede emitirla.
2. **La familia**, que quiere saber si su ser querido está bien y dónde.
3. **Los rescatistas**, que necesitan coordinar en zonas donde la red está caída o no llega.

## La propuesta de valor de ZIRO

**ZIRO convierte los teléfonos en una red temporal de comunicación que sobrevive la caída de la infraestructura.**

No intenta detectar el terremoto (eso lo hace EMSC, USGS, el sistema Android Earthquake Alerts de Google, etc.). ZIRO **usa un trigger externo** y a partir de ahí hace tres cosas:

1. **Recopila** evidencia local (video, audio, GPS, timestamp, identificador anónimo) en el teléfono del afectado.
2. **Transporta** un pequeño telegrama (~120 bytes) que resume la emergencia a través de dispositivos cercanos vía Wi-Fi Direct / BLE, sin Internet, sin torres celulares.
3. **Acumula** un historial distribuido de emergencias en cada nodo que participa: cada teléfono que ve un telegrama lo guarda y lo sincroniza con sus pares, formando un registro distribuido que crece orgánicamente.

Cuando un dispositivo con Internet entra en contacto con cualquier nodo de la cadena, vuelca todo al servidor. La familia ve en un dashboard dónde está su ser querido y cómo llegó la información hasta allá.

## El pitch de 30 segundos (para los jueces)

> "Son las 2:37 de la mañana. Ocurre un terremoto en Bogotá. Miles de personas intentan llamar a sus familiares. Las redes se saturan. Una persona tiene su teléfono, tiene GPS, tiene video de lo que ocurre, pero no puede enviar nada.
>
> **ZIRO** convierte ese teléfono — y todos los que están cerca — en una red temporal que se comunica por Wi-Fi Direct sin Internet. Cada teléfono guarda la información que pasa por él. Cuando uno con Internet aparece, todo llega al servidor. La familia ve dónde está su ser querido. Un rescatista puede ver, sin Internet, qué personas se reportaron en la zona.
>
> La información no desaparece cuando la red cae. **Se transporta de bolsillo en bolsillo.**"

## Lo que ZIRO **NO** es

- ❌ No es un detector de sismos (usamos EMSC como trigger).
- ❌ No es una app de mensajería general (Briar, Bridgefy, Signal ya existen para eso).
- ❌ No depende de que el usuario instale algo durante el terremoto.
- ❌ No intenta reemplazar redes celulares — sobrevive cuando estas fallan.
- ❌ No hace mesh routing IP (B.A.T.M.A.N., cjdns, etc.). Es **store-and-forward + gossip**, mucho más simple.

## Diferenciación vs. alternativas

| Solución existente | Lo que hace | Lo que le falta |
|---|---|---|
| **Briar** | Mensajería P2P cifrada sobre BT/Wi-Fi para Android | No acumula registro distribuido, no está pensado para emergencias masivas, Android-only |
| **Bridgefy** | SDK de mesh BLE/Wi-Fi Direct para apps | Paper de USENIX 2022 demostró MITM todavía posible. Sin registro distribuido |
| **Meshtastic** | LoRa mesh de km de rango con ESP32 externo | Requiere hardware ($30+ por nodo). No es phone-native |
| **Zello** | Walkie-talkie sobre red celular | Server-mediated. Si cae la red, cae Zello |
| **ShakeAlert / Google EEW** | Alertas tempranas server-push | No transporta evidencia. Push unidireccional |
| **Ushahidi** | Plataforma de mapeo de crisis | Requiere SMS o web. No funciona offline P2P |

**ZIRO específicamente:** combina registro distribuido + gossip + auto-supervivencia del origen + caso de uso de rescatistas offline en un solo producto.

## Métricas de éxito para la demo

- ✅ 5 teléfonos en una mesa.
- ✅ Trigger desde backend en 0:00.
- ✅ Telegrama llega al gateway en menos de 60s.
- ✅ Dashboard familiar actualizado en menos de 90s.
- ✅ Rescatista offline ve la lista en pantalla en menos de 30s después de entrar al rango.
- ✅ Pitch emocional de 30s al final.

## Referencias y URLs verificadas

- Bridgefy SDK: https://docs.bridgefy.me/sdk/start/bridgefy-sdk.md
- Briar: https://briarproject.org/how-it-works/
- Meshtastic: https://meshtastic.org/docs/overview/
- USENIX 2022 paper sobre Bridgefy: https://eikendev.github.io/breaking-bridgefy-again
- Wired sobre Maui 2023 (mesh en desastre real): https://www.wired.com/story/youre-not-ready-for-phone-dead-zones/
