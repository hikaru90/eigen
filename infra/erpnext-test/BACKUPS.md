# ERPNext Backups über Coolify (MariaDB + Sites-Files)

Gilt für: `accounting` (Produktion, Volumes `v15-complete`) und optional
`accounting-test` (Volumes `v15-test`).

Warum nicht das Backup-UI in Coolify? Es gilt nur für „Standalone Database“-
Ressourcen. Unsere MariaDB läuft im Compose-Stack → Backups über
**Server → Scheduled Tasks** (Host-Level, unabhängig vom Stack).

## 0. Backup-Verzeichnis (einmal auf dem Server)

```bash
mkdir -p /data/coolify/backups/erpnext
```

## 1. SOFORT: erstes manuelles Vollbackup (Produktion)

```bash
# Container-Name der Prod-DB (identifiziert über das Volume):
C=$(docker ps --filter volume=erpnext-db-data-v15-complete --format '{{.Names}}' | head -n1)
echo "$C"

# Alle Datenbanken dumpen (nicht-blockierend für InnoDB):
docker exec "$C" sh -c 'exec mariadb-dump -uroot -p"$MYSQL_ROOT_PASSWORD" --all-databases --single-transaction' \
  | gzip > /data/coolify/backups/erpnext/db-full-$(date +%F-%H%M).sql.gz

# Sites-Volume sichern (Uploads, private Files, Site-Konfigurationen):
V=$(docker volume ls --format '{{.Name}}' | grep 'erpnext-sites-v15-complete')
docker run --rm -v "$V":/src:ro -v /data/coolify/backups/erpnext:/backup alpine \
  tar czf /backup/sites-$(date +%F).tar.gz -C /src .
```

Ergebnis prüfen: `ls -lh /data/coolify/backups/erpnext` — die .sql.gz sollte
mehrere MB haben und `gunzip -t` fehlerfrei durchlaufen.

## 2. Dauerhaft: Scheduled Task in Coolify

Coolify → **Server** → **Scheduled Tasks** → New:

- **Name:** `erpnext-db-backup-daily`
- **Cron:** `30 3 * * *`
- **Command:**

```bash
mkdir -p /data/coolify/backups/erpnext
C=$(docker ps --filter volume=erpnext-db-data-v15-complete --format '{{.Names}}' | head -n1)
docker exec "$C" sh -c 'exec mariadb-dump -uroot -p"$MYSQL_ROOT_PASSWORD" --all-databases --single-transaction' \
  | gzip > /data/coolify/backups/erpnext/db-$(date +%F).sql.gz
find /data/coolify/backups/erpnext -name 'db-*.sql.gz' -mtime +14 -delete
```

(Behält 14 Tage. Der `$MYSQL_ROOT_PASSWORD`-Wert kommt aus dem Container-Env —
kein Passwort im Task nötig.)

Zweiter Task für die Sites-Files, wöchentlich:

- **Name:** `erpnext-sites-backup-weekly`
- **Cron:** `0 4 * * 1`
- **Command:**

```bash
V=$(docker volume ls --format '{{.Name}}' | grep 'erpnext-sites-v15-complete')
docker run --rm -v "$V":/src:ro -v /data/coolify/backups/erpnext:/backup alpine \
  tar czf /backup/sites-$(date +%F).tar.gz -C /src .
find /data/coolify/backups/erpnext -name 'sites-*.tar.gz' -mtime +35 -delete
```

## 3. Restore-Test (einmal durchspielen, dann vertraust du es)

```bash
# In einen Wegwerf-MariaDB-Container einspielen:
docker run -d --name restore-test -e MARIADB_ROOT_PASSWORD=test mariadb:10.6
sleep 10
gunzip < /data/coolify/backups/erpnext/db-YYYY-MM-DD.sql.gz \
  | docker exec -i restore-test sh -c 'exec mariadb -uroot -ptest'
docker exec restore-test sh -c 'exec mariadb -uroot -ptest -e "SHOW DATABASES;"'
docker rm -f restore-test
```

## 4. Off-Server (dringend empfohlen)

Ein Backup auf demselben Server schützt nicht vor Server-Ausfall. Mindestens
eines von:
- Wöchentlich die neueste .sql.gz herunterladen (Coolify-Dateibrowser/SCP)
- Oder rclone-Task an S3/B2: `rclone copy /data/coolify/backups/erpnext remote:erpnext-backups`

## Test-Instanz (accounting-test)

Gleiche Befehle mit Volume-Filter `erpnext-*-v15-test` — Priorität niedrig,
Daten dort sind wegwerfbar.

## Notfall-Wiederherstellung (Kurzreferenz)

1. MariaDB-Volume leer/frisch → Dump einspielen (Befehl aus Schritt 3, gegen
   den Prod-DB-Container)
2. Sites-Volume → Tar zurück nach `/home/frappe/frappe-bench/sites`
3. Stack neu starten, Site prüfen (`https://accounting…/api/method/ping`)
