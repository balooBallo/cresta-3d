# Cresta 3D

Mappa 3D di montagna per Android, ispirata a FATMAP. Funziona offline.

## Pubblicarla (una volta sola, gratis)

Una PWA va servita in HTTPS. Le due strade più semplici:

**Netlify Drop (2 minuti)**
1. Vai su https://app.netlify.com/drop
2. Trascina la cartella `cresta` intera.
3. Ricevi un indirizzo `https://…netlify.app` (con un account gratuito resta attivo).

**GitHub Pages**
1. Crea un repository e carica il contenuto della cartella.
2. Vai su Settings → Pages → Branch `main` / root.
3. L'app sarà su `https://<utente>.github.io/<repo>/`.

## Installarla sul telefono

Apri l'indirizzo con **Chrome** su Android, poi menu ⋮ → **Installa app** (o "Aggiungi a schermata Home").
Da quel momento si apre a schermo intero e funziona anche senza rete.

## Uso offline

1. Traccia (o importa) un percorso e **salvalo**.
2. Nella scheda **Offline** scegli la qualità, poi **⬇ Zona del percorso** → **Scarica**.
   - Vengono salvati: la base attiva (Esri / Wayback / Sentinel-2), le ortofoto e le sovrapposizioni accese, il terreno 3D.
   - Pendenza, esposizione e profilo altimetrico sono calcolati dal terreno, quindi funzionano offline.
3. Fai il download col Wi-Fi e tieni l'app aperta fino alla fine.
   Indicativamente: percorso di 15 km, ±1 km, immagini "Alta", terreno "Alto" ≈ 80–200 MB.
4. In montagna il GPS funziona anche senza campo. Con ⏺ Registra GPS lo schermo resta acceso (Android sospende le web app a schermo spento).

Le zone salvate compaiono sulla mappa con un contorno giallo tratteggiato.
Fuori da queste zone l'app mostra comunque le tile viste di recente (cache automatica, ~6000 tile).

## Immagini invernali

- **Esri Wayback**: scegli la base "Esri Wayback" e scorri le versioni con ◀ ▶.
  In alto compare la data della ripresa al centro della mappa (❄️ = inverno, ☀️ = estate) con risoluzione e fornitore.
  La versione scelta è quella che viene scaricata offline.
- **Sentinel-2 invernale**: neve reale con la data che vuoi, ma 10 m/pixel.
  1. Crea un account gratuito su https://dataspace.copernicus.eu
  2. Apri Sentinel Hub Dashboard → Configuration Utility → New configuration (template "Simple…" / True Color).
  3. Copia l'**Instance ID** nella scheda Mappe → Sentinel-2, insieme al nome del layer (es. `TRUE_COLOR`).
  4. Scegli un intervallo di date con neve (es. 15 gen – 31 mar) e la percentuale massima di nuvole.
  5. Il piano gratuito ha un limite mensile di richieste: usalo soprattutto per scaricare le zone.

## Fonti e licenze

- Terreno: Mapterhorn (Copernicus GLO-30 + LiDAR nazionali: swissALTI3D, IGN RGE ALTI, Tinitaly…).
- Immagini: Esri World Imagery / Wayback, swisstopo SWISSIMAGE, IGN BD ORTHO, Copernicus Sentinel-2.
- Sovrapposizioni: swisstopo itinerari scialpinistici, IGN tracce invernali, Waymarked Trails, OpenTopoMap.

Esri non consente di esportare le tile della World Imagery per uso offline senza una licenza ArcGIS.
Il download offline di Esri/Wayback è a tuo rischio, per uso personale.

## Struttura

- `index.html`, `style.css`: interfaccia (mobile-first, pannelli in basso)
- `app.js`: tutta la logica (MapLibre GL 4.7, protocolli `tile://`, `dem://`, `slope://`, `aspect://`)
- `sw.js`: service worker che rende l'app disponibile offline
- `vendor/`: MapLibre incluso localmente
