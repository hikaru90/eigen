# Plan: eu_einvoice-Plugin installieren OHNE Datenverlust

Ziel: `eu_einvoice` (EN 16931 / XRechnung / ZUGFeRD) auf die ERPNext-Instanz
bringen, ohne die Instanz oder Daten zu löschen.

## Wichtigster Satz

**Plugin-Installation löscht nie Daten.** Der Standard-Weg (`bench get-app` +
`bench install-app`) arbeitet auf der laufenden Instanz: Site, DB, Rechnungen
bleiben unberührt. Der letzte Zwischenfall (halbe Site) kam vom destruktiven
`rm -rf` im ALTEN Template-Initializer. Der Test-Stack selbst provisioniert
heute bewusst neu bei jedem Deploy (siehe Weg 2) — Plugin-Installationen
erfolgen dauerhaft über das Image (Weg 3).

## Weg 1 — Coolify-Terminal am laufenden Backend (kein Redeploy)

1. Coolify → Stack `accounting-test` → Container **backend** → **Terminal** öffnen
2. Befehle nacheinander:
   ```bash
   cd /home/frappe/frappe-bench
   bench get-app https://github.com/alyf-de/eu_einvoice --branch version-15
   bench --site accounting-test.coolify.stackstack.de install-app eu_einvoice
   bench --site accounting-test.coolify.stackstack.de migrate
   ```
3. Coolify → backend → **Restart**
4. Fertig. Nichts wurde gelöscht.

Voraussetzung: Site ist einmal sauber provisioniert
(`sites/accounting-test.coolify.stackstack.de/site_config.json` existiert).

## Weg 2 — ENTFERNT (Runtime-Install im backend)

Die frühere Variante (`bench get-app` im backend-Command von
`compose.selfcontained.yaml`) wurde entfernt: Sie hat bei jedem Container-
Recreate neu von GitHub geklont, hat Deployments Minuten verzögert (502 →
Coolify bricht ab) und konnte bei abgebrochenem Clone halb installierte Apps
hinterlassen. Siehe Weg 3 für den supported Weg.

Der initializer ist ebenfalls nicht mehr „idempotent": Er provisioniert die
Site bei jedem Deploy neu (gleiches Muster wie der Produktions-Stack) —
Testdaten sind bewusst Wegwerfdaten (siehe `BACKUPS.md`).

## Weg 3 — Dauerhaft über Image (für Rebuilds)

`Dockerfile.erpnext` bäckt die App ins Image (`bench get-app` im Build).
Compose-Variante `compose.yaml` (build) nutzt es. Für Rebuilds ohne
Runtime-Installation. Voraussetzung: Deployment erfolgt aus dem Repo
(build context), nicht als pasted Compose.

## Nach der Installation (Setup, ~10 Min in der UI)

1. **Code Lists** importieren (Suche „Code List" → Import Genericode,
   Dateien vorher von xrepository.de laden):
   - UNTDID 4461 (Payment Means) — Default ZZZ passt für PayPal
   - Rec20 (UOM) — Default C62
   - UNTDID 5305 (VAT Categories) — für Kategorie E
   - VATEX (Befreiungsgründe) — Kleinunternehmer-Code (z. B. `vatex-de-ks`)
2. **§ 19 Kleinunternehmer**: Sales Taxes and Charges Template
   „Kleinunternehmer § 19 UStG" (0 %) + Code-Mapping Kategorie E + VATEX-Grund;
   Rechnungen mit diesem Template anlegen
3. **UOM**: „Einheit" → Code C62 mappen
4. **E Invoice Settings**: Validate on Save/Submit = an,
   Action on Validation Error = Warning Message
5. **Test**: Draft-Rechnung öffnen → E Invoice Profile = XRECHNUNG →
   „…" → Download eInvoice → validieren auf
   https://erechnungsvalidator.service-bw.de

## Bekannte Randbedingungen

- XRechnung-XML: voll funktionsfähig ohne Ghostscript
- ZUGFeRD-PDF/A-3: braucht Ghostscript im Container (sonst Fallback auf
  normales PDF mit eingebettetem XML)
- Apps liegen im Container-FS (`apps/`), nicht im Volume: Nach Stack-Delete
  + Neuaufbau übernimmt das gebaute Image (Weg 3) die App automatisch;
  Sites-Daten überleben im Volume
- Kleinst-Reset des Test-Stacks (wenn je nötig): Volumes
  `erpnext-*-v15-test` löschen → frische Instanz. NIEMALS an
  `v15-complete` (Produktion) anfassen
