# ERPNext Test-Instanz (accounting-test) — eu_einvoice App

Installiert das Plugin [alyf-de/eu_einvoice](https://github.com/alyf-de/eu_einvoice)
(EN 16931 / XRechnung / ZUGFeRD, GPL-3.0) in die Test-Instanz.

## Zwei Wege

### A) Dauerhaft (empfohlen): Stack neu bauen

`Dockerfile.erpnext` bäckt die App ins Image; `compose.yaml` baut alle Services
damit und der Initializer installiert die App auf der Site (idempotent).

→ In Coolify: Test-Stack **Redeploy mit Build**. Fertig.

### B) Sofort-Test ohne Rebuild (Container geht beim Redeploy verloren)

`compose.selfcontained.yaml` (Raw-Paste in Coolify) ist **Vanilla-ERPNext ohne
eu_einvoice** — Apps brauchen zwingend einen Build-Kontext. Diese Route nur
nutzen, um die Instanz selbst ans Laufen zu bekommen.

Im Coolify-Terminal des **backend**-Containers der Test-Instanz:

```bash
cd /home/frappe/frappe-bench
bench get-app https://github.com/alyf-de/eu_einvoice --branch version-15
bench --site accounting-test.coolify.stackstack.de install-app eu_einvoice
bench --site accounting-test.coolify.stackstack.de migrate
```

Danach Container neu starten (Coolify → Restart). Hinweis: `apps/` liegt im
Container-FS — nach einem Stack-Recreate ist Weg A nötig.

## Nach der Installation (Setup in der UI)

1. **Code Lists** (Suche „Code List" → je Liste „Import Genericode", Datei vorher
   von xrepository.de herunterladen und hochladen — Remote-Import ist geblockt):
   - UNTDID 4461 (Payment Means) → Default ZZZ (passt für PayPal)
   - Rec20 (UOM) → Default C62
   - UNTDID 5305 (VAT categories) → für Kategorie **E**
   - **VATEX** (Befreiungsgründe) → deutscher Kleinunternehmer-Code (Liste prüfen,
     z. B. `vatex-de-ks`), auf unsere Steuer-Objekte mappen
   - EAS (optional, nur PEPPOL)
2. **§ 19 Kleinunternehmer**: Sales Taxes and Charges Template „Kleinunternehmer
   § 19 UStG" (0 %) anlegen und über Code List die Kategorie **E** + VATEX-Grund
   darauf mappen; Rechnungen dann mit diesem Template erstellen.
3. **UOM mappen**: UOM „Einheit" → Code **C62**.
4. **E Invoice Settings**: „Validate Sales Invoice on Save/Submit" an, Action =
   „Warning Message" (Test-phase).
5. **Rechnung testen**: Draft ACC-SINV-… öffnen → E Invoice Profile = XRECHNUNG →
   „…" → **Download eInvoice**; PDF-Button erzeugt ZUGFeRD (bei Profil ≠ XRECHNUNG).
   Validierung extern: https://erechnungsvalidator.service-bw.de (XRechnung) bzw.
   https://www.itb.ec.europa.eu/invoice/upload (EN 16931, CII).

## Ghostscript

Ist im `Dockerfile.erpnext` installiert (nötig für PDF/A-3-ZUGFeRD). Ohne Ghostscript
funktioniert XML weiterhin; PDF-Embedding fällt auf normales PDF zurück.
