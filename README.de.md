# Home Gym: ein selbst gehosteter KI Trainingscoach für dein Heimstudio

[English](README.md) · **Deutsch**

[![CI](https://github.com/kheirisaleh/homegym/actions/workflows/ci.yml/badge.svg)](https://github.com/kheirisaleh/homegym/actions/workflows/ci.yml)
[![Lizenz: MIT](https://img.shields.io/badge/Lizenz-MIT-green.svg)](LICENSE)
![Python 3.12](https://img.shields.io/badge/python-3.12-blue)
![React 19 + TypeScript](https://img.shields.io/badge/react-19%20%2B%20TypeScript-61dafb)
![Selbst gehostet](https://img.shields.io/badge/selbst%20gehostet-Docker-2496ed)

> **Du hast einen Server zu Hause und ein Gym im Keller? Dann ist dieses Projekt für dich gebaut.**
> Home Gym ist eine Trainings App, die auf deinem eigenen Rechner läuft, genau weiß, welche Hanteln, Scheiben und
> Geräte du besitzt, daraus deinen Plan schreibt und nach jedem Training dazulernt. Und Alexa sagt dir auf Zuruf,
> wie dein Training läuft.

![Übersicht mit heutigem Training, 3D Coach und Wochenstand](docs/screenshots/dashboard.png)

---

## Die Geschichte

Am Anfang stand ein einfaches Problem. Ein kleines Heimstudio: verstellbare Bank, Langhantel, Kurzhanteln in
2,5 kg Schritten, eine Klimmzugstange und ein Fahrrad. Jede App, die wir ausprobiert haben, ging von einem
Fitnessstudio aus. Sie schlug Kabelzüge vor, die es nicht gab, wollte 1 kg mehr, obwohl die nächste Hantel 2,5 kg
schwerer war, und speicherte alles auf fremden Servern.

Also haben wir den Coach gebaut, den wir haben wollten:

* **Er plant nur mit dem, was du hast.** Du trägst deine Geräte einmal ein, samt der genauen Gewichte. Der Coach
  schlägt keine Übung vor, die du nicht machen kannst, und steigert nur in Schritten, die du wirklich laden kannst.
* **Er plant mit deinen Daten.** Dein Ziel, deine Erfahrung, die Muskeln, die dir wichtig sind, die Tage, an denen
  du trainieren kannst, und später jeder einzelne Satz. Keine Vorlage von der Stange.
* **Er wohnt bei dir.** Ein Docker Container auf deinem Heimserver, eine SQLite Datei und dein Handy im WLAN (oder
  per Tailscale unterwegs). Deine Trainingsdaten bleiben auf deiner Hardware.
* **Er redet mit dir.** Ein 3D Coach stimmt dich vor dem Training ein, zeigt die erste Übung vor, feuert dich in der
  Pause an und fasst zusammen, was sich beim nächsten Mal ändert. Beim Frühstück fragst du Alexa nach der Woche.

Wenn das nach deinem Setup klingt, lies weiter.

## Was es kann

### Ein Plan, der zu deinen Geräten und deinem Körper passt

Beim ersten Start legt jede Person im Haushalt ein Profil an: Name, Körper, Erfahrung, Ziel, die wichtigsten
Muskeln (ausgewählt an einem drehbaren 3D Körper), wie oft du trainieren kannst und welcher Coach dich begleitet.
Der KI Coach schreibt daraus und aus deiner Geräteliste den ersten Plan.

| Woche planen | Jeden Tag bearbeiten |
| --- | --- |
| ![Wochenplan, Tage per Ziehen verschieben](docs/screenshots/programs.png) | ![Programm Editor mit Übungsbibliothek](docs/screenshots/program-editor.png) |

### Deine Geräte, deine Gewichtsschritte

Jedes Gerät hat einen Schalter, ein Foto und die Gewichte, die du besitzt (`2.5..30/2.5` legt ein ganzes
Kurzhantelset in einer Zeile an). Schaltest du etwas ab, ersetzt der KI Coach jede Übung, die es gebraucht hat.

![Geräteseite mit Schaltern und Gewichtslisten](docs/screenshots/equipment.png)

### Ein Coach, der einstimmt, vormacht und anfeuert

Vor dem Training läuft der Coach ins Bild, erklärt den Plan mit Zahlen aus deinem letzten Training und zeigt das
Bewegungsmuster der ersten Übung (Kniebeuge, Hüftbeuge, Drücken, Rudern, Curls und mehr). In der Pause gibt er
kurze Techniktipps und zählt dich zurück ins Training.

| Einstimmung | Pausentimer mit Tipps |
| --- | --- |
| ![Der 3D Coach stimmt auf das Training ein](docs/screenshots/coach-brief.png) | ![Pausentimer mit Coach und Tipp](docs/screenshots/rest-timer.png) |

### Eintragen mit verschwitzten Händen

Große Plus und Minus Tasten, das nächste Gewicht ist schon eingetragen, Tastenkürzel am Laptop oder Beamer, und
ein Tipp auf die Werte vom letzten Mal übernimmt sie. Persönliche Bestleistungen werden sofort erkannt.

![Trainingsansicht mit letztem Mal, Bestleistung und Eingabe](docs/screenshots/workout.png)

### Auf dem Handy

Über Safari oder Chrome zum Startbildschirm hinzufügen. Eine vollwertige Trainings App mit Fokusmodus, Wischen
zwischen den Übungen und einer Leiste für die Eingabe mit einer Hand.

![Handy: Heute, Training, Plan und Mehr](docs/screenshots/mobile.png)

### Er passt sich an, mit Bedacht

Die Regeln stehen mit Quellen in [docs/COACH_LOGIC.md](docs/COACH_LOGIC.md). Kurz gesagt:

* **Nach jedem Training** doppelte Progression: Wer in allen Sätzen das obere Ende des Wiederholungsbereichs
  schafft, bekommt das nächste Gewicht, das es wirklich gibt. Zweimal zu wenig, und es geht einen Schritt zurück.
* **Alle 4 bis 6 Wochen** eine Blockauswertung: Sätze pro Muskel bewegen sich Richtung 10 bis 20 pro Woche (mehr
  für Prioritätsmuskeln), und höchstens zwei festgefahrene Übungen werden getauscht.
* **Deload Wochen** am Ende jedes Blocks, oder früher, wenn zwei Trainings hintereinander deutlich schwächer waren.
* **Jede Änderung wird protokolliert und lässt sich rückgängig machen.** Die KI entscheidet nur innerhalb von
  Grenzen, die feste Regeln berechnen.

![Coach Seite mit Blockverlauf, Aktionen und Änderungsprotokoll](docs/screenshots/coach.png)

### Alexa fragen

Den mitgelieferten Skill verbinden und fragen:

* „Alexa, frag **Haus Trainer**, wie mein Training läuft." Sie fragt, wer spricht, und nennt deine Woche:
  erledigte und geplante Trainings, deine Punkte in der Rangliste, ob das heutige Training erledigt ist, und die
  letzte Nachricht deines Coaches.
* „Alexa, frag Haus Trainer nach dem **Tagesbericht**." Wer heute trainiert hat und wie viele Punkte alle haben.

Auf Englisch heißt der Skill „home coach". Einrichtung: [docs/ALEXA.md](docs/ALEXA.md).

### Und außerdem

* **Mehrere Personen, ein Gym.** Profile ohne Passwort und eine Wochenrangliste, die Einsatz und eigenen
  Fortschritt bewertet, nicht das rohe Gewicht.
* **Verlauf und Fortschritt.** Kalender, Trainingsliste, geschätztes Maximalgewicht je Übung, Kraftindex,
  Körpergewicht mit 7 Tage Mittel.
* **Beamer Modus.** Taste `P`, und die Trainingsansicht skaliert für Fernseher oder Beamer an der Wand.
* **Eigene Medien.** Pro Übung ein Loop GIF oder Video und ein Muskelbild hochladen, oder automatisch ein kurzes
  YouTube Video finden lassen, von dem nur die wichtigen Sekunden laufen.
* **Private Zyklusdaten** für weibliche Profile: Der Periodenmodus passt das heutige Training an, Symptome und
  Phasen stehen auf einer mit PIN geschützten Gesundheitsseite, die niemand sonst öffnen kann.
* **Ernährung aus deiner Vorratskammer** (optional), siehe unten.

![Rangliste](docs/screenshots/leaderboard.png)

## Passt gut dazu: Pantry

Home Gym kann lesen, was du wirklich gegessen hast, aus **[kheirisaleh/pantry](https://github.com/kheirisaleh/pantry)**,
einer selbst gehosteten Küchen und Vorrats App vom selben Autor. Laufen beide zu Hause, sieht der Coach Kalorien
und Eiweiß der letzten 7 Tage und nutzt sie in Notizen und Auswertungen. Einschalten unter Einstellungen,
„Pantry link". Die Pantry ruft `POST /api/integrations/pantry` auf, sobald ein Tag eingetragen ist.

## Schnellstart

Du brauchst einen Rechner mit Docker (NAS, Mini PC, Raspberry Pi 5, alter Laptop) und optional einen Gemini API
Schlüssel oder ein lokales Ollama.

```bash
git clone https://github.com/kheirisaleh/homegym.git
cd homegym
echo "GEMINI_API_KEY=dein-schluessel" > .env   # optional, die App läuft auch ohne KI
docker compose up -d --build
```

Öffne `http://<dein-server>:8090` am Laptop oder `http://<dein-server>:8090/m` am Handy. Das erste Profil wird
zum Hauptkonto, das die Servereinstellungen öffnen darf.

**Keine Cloud KI?** Setze `AI_PROVIDER=ollama` und `OLLAMA_URL` in `docker-compose.yml`. Eintragen, Steigerung,
Deloads und Rangliste funktionieren ganz ohne KI; nur Planerstellung, Übungstausch und die Notizen des Coaches
brauchen sie.

### Einstellungen

Alles lässt sich in der App ändern (Einstellungen, geschützt durch eine Admin PIN) oder per Umgebungsvariable:

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `AI_PROVIDER` | `gemini` | `gemini` oder `ollama` |
| `GEMINI_API_KEY` | | Schlüssel aus Google AI Studio |
| `GEMINI_MODEL` | `gemini-flash-latest` | Modell des Coaches |
| `OLLAMA_URL`, `OLLAMA_MODEL` | `http://ollama:11434`, `qwen2.5:7b-instruct` | lokales Modell |
| `ALEXA_SKILL_ID` | | ID deines Alexa Skills |
| `PANTRY_ENABLED`, `PANTRY_URL`, `PANTRY_TOKEN` | aus | Verbindung zur Pantry |
| `AUTO_VIDEO` | `1` | kurze Übungsvideos automatisch suchen |
| `TZ` | | deine Zeitzone, für Wochen und Berichte |

### Deine Daten

| Pfad | Inhalt |
| --- | --- |
| `data/workout.db` | SQLite Datenbank mit allem |
| `data/media/` | hochgeladene GIFs, Videos, Muskelbilder, Gerätefotos |
| `data/quality/` | Berichte der Qualitätstests |

Wer den Ordner `data` sichert, hat alles gesichert.

## Für Forschende und Bastler

Dieses Repository ist zum Lesen gedacht, nicht nur zum Laufen lassen.

* **Nachvollziehbare Trainingsregeln** mit Quellen: [docs/COACH_LOGIC.md](docs/COACH_LOGIC.md).
* **Fragen im Onboarding und warum sie gestellt werden**: [docs/ONBOARDING.md](docs/ONBOARDING.md).
* **Qualitätstests für Pläne**: `/quality` öffnen oder `docker exec workout-tracker python quality.py`. Fünf
  Testpersonen bekommen einen Plan von der KI; jeder Plan wird gegen die Regeln geprüft (Volumen pro Muskel,
  Prioritäten, Geräte, Schwierigkeit, Dauer, Ausdauer, Balance) und von der KI zusätzlich bewertet.
* **Offenes Datenmodell**: eine SQLite Datei, mit jedem Werkzeug lesbar. Jede Entscheidung des Coaches steht in
  `coach_log`, zusammen mit der Planversion vor der Änderung.
* **Aufbau der Oberfläche**: [docs/FRONTEND.md](docs/FRONTEND.md).
* **Zitieren** mit den Angaben in [CITATION.cff](CITATION.cff).

### Entwicklung

```bash
pip install -r requirements.txt -r requirements-dev.txt
ruff check . && pytest                         # Backend

cd frontend && npm ci
npm run dev                                     # http://localhost:5173, leitet die API auf :8000 weiter
npm run typecheck && npm run lint && npm test   # statische Prüfungen und Unit Tests
npm run build && npx playwright test            # End to End Tests mit Wegwerf Datenbank
```

Mehr in [CONTRIBUTING.md](CONTRIBUTING.md). GitHub Actions führt alle Prüfungen bei jedem Pull Request aus.

### Tastatur

* `1` bis `9` wechseln den Bereich (`0` Einstellungen, `H` Gesundheit), `P` Beamer Modus
* Im Training: `Enter` speichert den Satz, `↑ ↓` Wiederholungen, `Shift ↑ ↓` Gewicht, `← →` Übung wechseln

## Häufige Fragen

**Brauche ich einen starken Server?** Nein. Der Container ist auf 384 MB Speicher begrenzt und braucht im Leerlauf
fast keine CPU.

**Geht es ohne Internet?** Ja, mit Ollama als KI oder ganz ohne KI.

**Werden meine Daten verschickt?** Nur mit Gemini: Der Coach sendet anonyme Trainingszahlen, um Pläne und Notizen
zu schreiben. Zyklusdaten verlassen den Server nie, Namen und Daten werden nie gesendet.

**Kann die ganze Familie mitmachen?** Ja. Jede Person hat ein Profil, eigene Pläne und einen eigenen Coach.

## Danksagung und Lizenz

MIT Lizenz, siehe [LICENSE](LICENSE). Die 3D Modelle sind in `app/static/coach/ATTRIBUTION.txt` und
`app/static/models/ATTRIBUTION.txt` genannt. Gebaut von [Saleh Kheiri](https://github.com/kheirisaleh).

*Stichworte: selbst gehosteter Trainingstracker, Heimstudio App, KI Personal Trainer, progressive Überlastung,
doppelte Progression, Deload, Docker, Heimserver, Raspberry Pi, Alexa Skill, Gemini, Ollama.*
