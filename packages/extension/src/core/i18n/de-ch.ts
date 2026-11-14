import type { Catalog } from "./en";

/**
 * German message catalog with Swiss spelling (no "ß"); the maintainers review every change
 * (decision D9 in docs/decisions.md).
 */
export const deCH: Catalog = {
  "folder.profileMissing":
    "Unter .lorequill/config.yaml wurde kein Profil gefunden. Die verwaltete Bearbeitung ist für diesen Ordner deaktiviert.",
  "folder.profileUnsupported":
    "Die Profilversion {found} wird nicht unterstützt; diese Lorequill-Version unterstützt Version {supported}. Die verwaltete Bearbeitung ist für diesen Ordner deaktiviert.",
  "folder.profileInvalid":
    "Das Profil ist ungültig. {detail} Probleme insgesamt: {count}. Die verwaltete Bearbeitung ist für diesen Ordner deaktiviert.",
  "folder.contentRootMissing":
    "Das Inhaltsverzeichnis «{root}» existiert nicht oder ist kein Verzeichnis. Die verwaltete Bearbeitung ist für diesen Ordner deaktiviert.",
  "folder.contentRootOutside":
    "Das Inhaltsverzeichnis «{root}» liegt ausserhalb dieses Arbeitsbereichsordners. Die verwaltete Bearbeitung ist für diesen Ordner deaktiviert.",
  "folder.unsupportedLocation":
    "Lorequill benötigt einen Ordner im lokalen Dateisystem. Die verwaltete Bearbeitung ist für diesen Ordner deaktiviert.",
  "folder.scanFailed":
    "Die Seiten konnten nicht aus dem Inhaltsverzeichnis gelesen werden. Mit «Aktualisieren» erneut versuchen.",

  "pages.none": "Keine Seiten gefunden. Prüfe content.include und content.exclude im Profil.",
  "pages.noMatch": "Keine Seite passt zu «{filter}».",
  "pages.truncated":
    "Es wurden nur die ersten {limit} Dateien durchsucht. Schränke content.include und content.exclude im Profil ein.",
  "pages.engineMismatch": "CI verwendet die Prüf-Engine {expected}, dieser Editor {actual}.",
  "pages.engineMismatchDetail":
    "Prüfungen im Editor und in CI können unterschiedliche Befunde melden. Aktualisiere Lorequill oder passe checks.engine_version im Profil zusammen mit der gepinnten Action an.",
  "version.info": "Lorequill {version} · Prüf-Engine {engine}",
  "version.mismatch": "{folder}: CI verwendet die Prüf-Engine {expected}.",
  "pages.frontMatterInvalid":
    "Der Front Matter dieser Seite kann nicht gelesen werden; der Titel stammt aus der Überschrift oder dem Dateinamen.",
  "pages.draft": "Entwurf",
  "pages.draftDetail":
    "Entwurf (content.drafts): wird geprüft, aber nicht veröffentlicht. Nur andere Entwürfe dürfen hierher verlinken.",
  "pages.filterPrompt": "Seiten nach Titel, Dateiname oder Alias filtern",
  "pages.filterPlaceholder": "Suchtext",
  "pages.filterActive": "Filter: {filter}",

  "action.openProfile": "Profil öffnen",
  "action.openPage": "Seite öffnen",

  "profile.problemAtLine": "Zeile {line}: {message}",
  "profile.problem": "{message}",
  "profile.issue.profile-not-found": "Die Profildatei existiert nicht.",
  "profile.issue.profile-not-a-file": "Der Profilpfad ist keine reguläre Datei.",
  "profile.issue.profile-outside-workspace":
    "Das Profil liegt ausserhalb dieses Arbeitsbereichsordners.",
  "profile.issue.profile-too-large": "Die Profildatei ist grösser als erlaubt.",
  "profile.issue.profile-invalid-encoding": "Das Profil ist kein gültiges UTF-8.",
  "profile.issue.profile-unreadable": "Die Profildatei kann nicht gelesen werden.",
  "profile.issue.profile-empty": "Das Profil ist leer.",
  "profile.issue.yaml-syntax": "Das Profil enthält einen YAML-Syntaxfehler ({yamlCode}).",
  "profile.issue.yaml-duplicate-key": "Das Profil enthält einen doppelten Schlüssel.",
  "profile.issue.yaml-unsupported-construct":
    "Das Profil verwendet ein nicht unterstütztes YAML-Konstrukt ({construct}).",
  "profile.issue.unsupported-version":
    "Die Profilversion {found} wird nicht unterstützt (unterstützt: {supported}).",
  "profile.issue.missing-key": "Der erforderliche Schlüssel «{key}» fehlt bei {path}.",
  "profile.issue.unknown-key": "Der Schlüssel «{key}» ist bei {path} nicht erlaubt.",
  "profile.issue.unknown-rule": "Die Prüfregel «{value}» ist unbekannt.",
  "profile.issue.unknown-widget": "Das Feld-Widget «{value}» ist unbekannt.",
  "profile.issue.invalid-type": "Der Wert bei {path} muss vom Typ {expected} sein.",
  "profile.issue.invalid-value": "Der Wert bei {path} ist nicht erlaubt ({constraint}).",
  "profile.issue.duplicate-id": "Die ID «{id}» wird mehrfach verwendet ({path}).",
  "profile.issue.duplicate-field-key":
    "Der Feldschlüssel «{key}» wird mehrfach verwendet ({path}).",
  "profile.issue.invalid-default":
    "Der Standardwert bei {path} gehört nicht zu den aufgelisteten Optionen.",
  "editor.untrusted":
    "Diesem Arbeitsbereich wird nicht vertraut, deshalb ist der Lorequill-Seiteneditor nicht verfügbar. Verwende «Als Text öffnen», oder vertraue dem Arbeitsbereich.",
  "editor.link.notFound": "Das Linkziel «{target}» wurde nicht gefunden.",
  "editor.link.anchorNotFound": "Es gibt keine Überschrift mit dem Anker «#{anchor}».",
  "editor.link.unsupported": "Lorequill kann den Link «{target}» nicht öffnen.",
  "editor.label.toolbar": "Formatierung",
  "editor.label.undo": "Rückgängig",
  "editor.label.redo": "Wiederholen",
  "editor.label.bold": "Fett",
  "editor.label.italic": "Kursiv",
  "editor.label.strikethrough": "Durchgestrichen",
  "editor.label.code": "Code im Text",
  "editor.label.heading1": "Überschrift 1",
  "editor.label.heading2": "Überschrift 2",
  "editor.label.heading3": "Überschrift 3",
  "editor.label.bullet": "Aufzählung",
  "editor.label.numbered": "Nummerierte Liste",
  "editor.label.task": "Aufgabenliste",
  "editor.label.quote": "Zitat",
  "editor.label.codeBlock": "Codeblock",
  "editor.label.link": "Link einfügen",
  "editor.label.table": "Tabelle einfügen",
  "editor.label.horizontalRule": "Trennlinie",
  "editor.label.source": "Quelltext (Markdown und Front Matter anzeigen)",
  "editor.label.save": "Speichern",
  "editor.label.checkPages": "Seiten prüfen",
  "editor.label.frontMatter": "Eigenschaften (Front Matter)",
  "editor.label.tableHeader1": "Spalte 1",
  "editor.label.tableHeader2": "Spalte 2",
  "editor.label.tableTools": "Tabellenwerkzeuge",
  "editor.label.tableInsertRowAbove": "Zeile oberhalb einfügen",
  "editor.label.tableInsertRowBelow": "Zeile unterhalb einfügen",
  "editor.label.tableDeleteRow": "Zeile löschen",
  "editor.label.tableInsertColumnLeft": "Spalte links einfügen",
  "editor.label.tableInsertColumnRight": "Spalte rechts einfügen",
  "editor.label.tableDeleteColumn": "Spalte löschen",
  "editor.label.tableMoveRowUp": "Zeile nach oben",
  "editor.label.tableMoveRowDown": "Zeile nach unten",
  "editor.label.tableMoveColumnLeft": "Spalte nach links",
  "editor.label.tableMoveColumnRight": "Spalte nach rechts",
  "editor.label.tableAlignLeft": "Spalte linksbündig",
  "editor.label.tableAlignCenter": "Spalte zentriert",
  "editor.label.tableAlignRight": "Spalte rechtsbündig",
  "editor.label.tableFormat": "Tabelle ausrichten",
  "editor.label.tableDelete": "Tabelle löschen",
  "editor.label.viewModes": "Ansichtsmodus",
  "editor.label.viewEdit": "Bearbeiten",
  "editor.label.viewBoth": "Beide",
  "editor.label.viewPreview": "Ansicht",
  "editor.label.previewApproximation":
    "Vorschau als Annäherung: Die veröffentlichte Website kann anders aussehen.",
  "status.position": "Zeile {line}, Spalte {column}",
  "status.words": "{words} Wörter, {minutes} Min. Lesezeit",
  "status.saved": "Lokal gespeichert",
  "status.unsaved": "Nicht gespeichert",
  "check.passed": "Bearbeitungsstand geprüft: {pages} Seiten, keine Befunde.",
  "check.failed": "Bearbeitungsstand geprüft: {pages} Seiten, {findings} Befunde.",
  "check.incomplete": "Die Prüfung ist unvollständig ({reason}). Sie gilt nicht als bestanden.",
  "check.unavailable":
    "Prüfungen sind nicht verfügbar: Dem Arbeitsbereich wird nicht vertraut, oder kein Ordner hat ein gültiges Profil.",
  "check.showProblems": "Probleme anzeigen",
  "finding.relative-links.empty": "Das Linkziel ist leer.",
  "finding.relative-links.absolute-path":
    "Der Link «{destination}» ist ein absoluter Pfad; verwende einen Pfad relativ zu dieser Seite.",
  "finding.relative-links.unsupported-scheme":
    "Der Link «{destination}» verwendet ein nicht unterstütztes Schema.",
  "finding.relative-links.outside-content-root":
    "Der Link «{destination}» führt aus dem Inhaltsverzeichnis hinaus.",
  "finding.relative-links.backslash":
    "Der Link «{destination}» enthält einen Backslash; verwende «/».",
  "finding.relative-links.malformed-encoding":
    "Der Link «{destination}» hat eine ungültige Prozent-Kodierung.",
  "finding.relative-links.missing-target": "Das Linkziel «{target}» existiert nicht.",
  "finding.relative-links.target-is-draft":
    "Das Linkziel «{target}» ist ein Entwurf und wird nicht veröffentlicht; nur Entwürfe dürfen darauf verlinken.",
  "finding.relative-links.target-is-directory":
    "Das Linkziel «{target}» ist ein Ordner, keine Datei.",
  "finding.relative-links.target-outside-content-root":
    "Das Linkziel «{target}» liegt ausserhalb des Inhaltsverzeichnisses.",
  "finding.relative-links.unsupported-target": "Das Linkziel «{target}» ist keine normale Datei.",
  "finding.relative-links.missing-anchor": "Den Anker «#{anchor}» gibt es in «{target}» nicht.",
  "finding.forbidden-text.found": "Unzulässiger Text «{text}» gefunden.",
  "finding.unique-field.duplicate":
    "Der Wert «{value}» von «{field}» wird bereits in «{first}» verwendet.",
  "finding.unique-field.not-scalar":
    "Das Feld «{field}» muss ein einzelner Wert sein, damit die Eindeutigkeit geprüft werden kann.",
  "finding.allow-values.not-allowed":
    "Der Wert «{value}» nach «{marker}» ist nicht erlaubt; erlaubt sind: {allowed}.",
  "finding.field-format.missing": "Das Feld «{field}» ist hier erforderlich.",
  "finding.field-format.invalid":
    "Der Wert «{value}» von «{field}» muss die Form {expected} haben (Präfix, Bindestrich, Ziffern).",
  "finding.reference-field.missing": "Das Feld «{field}» ist hier erforderlich.",
  "finding.reference-field.unknown":
    "Der Wert «{value}» von «{field}» entspricht bei keiner Seite dem Feld «{target}».",
  "finding.reference-field.self":
    "Der Wert «{value}» von «{field}» verweist auf diese Seite selbst.",
  "finding.reference-field.not-scalar":
    "Das Feld «{field}» muss ein einzelner Wert oder eine Liste von Werten sein, um auf Seiten zu verweisen.",
  "finding.front-matter.invalid":
    "Das Front Matter kann nicht gelesen werden, deshalb können die Feldprüfungen nicht laufen.",

  // Eigenschaften
  "properties.label.empty":
    "Öffne eine Seite eines Lorequill-Ordners, um ihre Eigenschaften zu sehen.",
  "properties.label.readonly":
    "Das Front Matter dieser Seite kann hier nicht sicher bearbeitet werden. Bearbeite es im Quelltext.",
  "properties.label.openSource": "Quelltext öffnen",
  "properties.label.collection": "Collection:",
  "properties.label.noCollection":
    "Keine Collection passt zu dieser Seite. Alle Felder des Front Matter werden angezeigt.",
  "properties.label.ambiguous":
    "Mehrere Collections passen zu dieser Seite. Die Auswahl ändert nur, welche Felder angezeigt werden.",
  "properties.label.unknownFields": "Weitere Felder",
  "properties.label.required": "Pflichtfeld",
  "properties.label.missing": "Pflichtfeld fehlt. Speichern und Committen sind trotzdem möglich.",
  "properties.label.insertDefault": "Standardwert einsetzen:",
  "properties.label.notEditable":
    "Dieser Wert lässt sich hier nicht bearbeiten, ohne seinen Typ zu ändern. Bearbeite ihn im Quelltext.",
  "properties.label.listHint": "Ein Eintrag pro Zeile.",
  "properties.label.selectNone": "(keine Angabe)",
  "properties.label.invalidOption": "keine gültige Option",
  "properties.label.yes": "ja",
  "properties.conflict":
    "Die Seite hat sich während des Speicherns geändert. Prüfe den Wert und versuche es erneut.",
  "properties.failed": "Das Feld konnte nicht gespeichert werden: {reason}",
  "properties.rejected": "Der Wert passt nicht zu diesem Feld.",
  "properties.problemAtLine": "Zeile {line}: {message}",
  "frontmatter.issue.yaml-syntax": "Das YAML enthält einen Syntaxfehler.",
  "frontmatter.issue.yaml-duplicate-key": "Ein Schlüssel kommt mehrfach vor.",
  "frontmatter.issue.yaml-unsupported-construct":
    "Das YAML verwendet ein Konstrukt, das Lorequill nicht bearbeitet (zum Beispiel ein Tag, einen Anker oder einen Alias).",
  "frontmatter.issue.front-matter-not-a-mapping": "Das Front Matter ist keine Liste von Feldern.",
  "frontmatter.issue.invalid-key": "Ein Feldname ist leer oder enthält Steuerzeichen.",
  "frontmatter.issue.invalid-date": "Das Datum muss ein gültiges Datum im Format {expected} sein.",
  "frontmatter.issue.roundtrip-mismatch":
    "Die Änderung würde nicht so gelesen, wie sie geschrieben wurde. Es wurde nichts gespeichert.",

  // Neue Seite
  "newpage.title": "Titel der neuen Seite",
  "newpage.inRoot": "Die Seite wird im Inhaltsverzeichnis angelegt.",
  "newpage.inDirectory": "Die Seite wird in «{directory}» angelegt.",
  "newpage.titleEmpty": "Gib einen Titel ein.",
  "newpage.fileName": "Dateiname",
  "newpage.fileName.empty": "Gib einen Dateinamen ein.",
  "newpage.fileName.separator":
    "Gib einen Dateinamen ohne Ordner ein; die Seite wird im gewählten Ordner angelegt.",
  "newpage.fileName.invalid-character":
    "Der Dateiname enthält ein unzulässiges Zeichen oder beginnt oder endet mit einem Punkt oder Leerzeichen.",
  "newpage.fileName.reserved": "Dieser Dateiname ist unter Windows reserviert.",
  "newpage.fileName.too-long": "Der Dateiname ist zu lang.",
  "newpage.fileName.exists": "In diesem Ordner gibt es bereits eine Datei mit diesem Namen.",
  "newpage.chooseFolder": "Ordner für die neue Seite",
  "newpage.chooseCollection":
    "Mehrere Collections passen zu diesem Ordner. Welche soll die Seite verwenden?",
  "newpage.failed": "Die Seite «{name}» konnte nicht angelegt werden.",
  // Link einfügen
  "links.notAPage":
    "«Link einfügen» funktioniert auf Seiten im Inhaltsverzeichnis eines Lorequill-Ordners.",
  "links.pickPage": "Link einfügen: Seite wählen",
  "links.pickPagePlaceholder": "Nach Titel, Pfad oder Alias suchen",
  "links.thisPage": "{title} (diese Seite)",
  "links.aliases": "Aliase: {aliases}",
  "links.pickHeading": "Auf die ganze Seite oder auf eine Überschrift verlinken",
  "links.wholePage": "Ganze Seite",
  "links.text": "Linktext",
  "links.textEmpty": "Gib einen Linktext ein.",
  "editor.label.commit": "Committen",
  "review.statusName": "Lorequill-Prüfstatus",
  "review.checkFailed": "Commit-Prüfung: {findings} Befunde",
  "review.checkFailedTooltip":
    "Die letzte Commit-Prüfung des gestagten Stands hat Probleme gefunden. Klicken, um sie anzuzeigen.",
  "review.unverified": "Commit nicht verifiziert",
  "review.unverifiedTooltip":
    "Der committete Stand von {commit} unterscheidet sich vom geprüften. Einreichen ist blockiert, bis der Commit geprüft ist. Klicken, um ihn zu prüfen.",
  "review.verificationFailedTooltip":
    "Commit {commit} hat {findings} Befunde. Erstelle einen Korrektur-Commit; Einreichen bleibt blockiert. Klicken, um erneut zu prüfen.",
  "review.verified": "Commit geprüft",
  "review.verifiedTooltip": "Commit {commit} hat die Commit-Prüfung bestanden.",
  "commit.chooseFolder": "Änderungen welches Ordners committen?",
  "commit.noFolder": "Es ist kein Ordner mit gültigem Profil geöffnet.",
  "commit.detached":
    "HEAD ist losgelöst (detached). Wechsle vor dem Commit auf einen Branch; Lorequill committet nicht auf einen losgelösten HEAD.",
  "commit.conflicted":
    "Das Repository hat Merge-Konflikte. Löse sie in der Quellcodeverwaltung, bevor du committest.",
  "commit.noChanges": "Es gibt keine Änderungen zum Committen.",
  "commit.emptySelection": "Nichts ist gestagt, also gibt es nichts zu committen.",
  "commit.dialogTitle": "Committen auf {branch}",
  "commit.dialogPlaceholder":
    "Ausgewählte Dateien werden gestagt, abgewählte ungestagt. Jede gestagte Änderung wird committet.",
  "commit.openDiff": "Änderungen öffnen",
  "commit.mark.staged": "bereits gestagt",
  "commit.mark.partial": "teilweise gestagt: nur der gestagte Teil wird committet",
  "commit.mark.new": "neu",
  "commit.mark.unchecked": "ausserhalb des Inhaltsordners, nicht geprüft",
  "commit.confirmUnrelated":
    "{count} Dateien ausserhalb des Inhaltsordners waren bereits gestagt. Sie werden mitcommittet, und die Commit-Prüfung deckt sie nicht ab.",
  "commit.includeAnyway": "Mitcommitten",
  "commit.checking": "Commit-Prüfung (gestagter Stand) …",
  "commit.verifying": "Committeten Stand prüfen …",
  "commit.invalidProfile":
    "Das Profil im gestagten Stand ist ungültig, darum kann der gestagte Stand nicht geprüft werden. Korrigiere und stage .lorequill/config.yaml.",
  "commit.checkIncomplete":
    "Die Commit-Prüfung ist unvollständig ({reason}). Das ist kein Bestehen; es wurde nichts committet.",
  "commit.checkFailed":
    "Commit-Prüfung (gestagter Stand): {findings} Befunde. Es wurde nichts committet.",
  "commit.showFindings": "Befunde anzeigen",
  "commit.findingsTitleStaged": "Commit-Prüfung (gestagter Stand): {findings} Befunde",
  "commit.findingsTitleCommit": "Prüfung des committeten Stands: {findings} Befunde",
  "commit.messageTitle": "Commit-Nachricht für {branch}",
  "commit.messagePrompt":
    "Commit-Prüfung bestanden ({pages} Seiten). Jede gestagte Änderung wird committet.",
  "commit.messagePromptUntracked":
    "Commit-Prüfung bestanden ({pages} Seiten), mit dem Profil aus dem Arbeitsverzeichnis, weil das Profil nicht versioniert ist. Jede gestagte Änderung wird committet.",
  "commit.messageEmpty": "Gib eine Commit-Nachricht ein.",
  "commit.changed":
    "Der Index oder HEAD hat sich nach der Commit-Prüfung geändert. Es wurde nichts committet; starte Committen erneut, um den neuen Stand zu prüfen.",
  "commit.failed":
    "Git hat keinen Commit erstellt (Exit-Code {code}). Die gestagten Änderungen sind unverändert.",
  "commit.done": "{commit} auf {branch} committet. Die Commit-Prüfung ist bestanden.",
  "commit.unverified":
    "Commit nicht verifiziert: Der committete Stand von {commit} unterscheidet sich vom geprüften, zum Beispiel weil ein Git-Hook den Index geändert hat. Einreichen ist blockiert, bis der Commit geprüft ist.",
  "commit.verifyNow": "Commit prüfen",
  "commit.verified": "Commit {commit} geprüft: keine Befunde.",
  "commit.verificationFailed":
    "Der committete Stand hat {findings} Befunde. Erstelle einen Korrektur-Commit; Einreichen bleibt blockiert.",
  "git.unavailable.not-ready":
    "Der Ordner hat kein gültiges Profil, oder dem Arbeitsbereich wird nicht vertraut.",
  "git.unavailable.git-unavailable":
    "Git ist nicht verfügbar. Aktiviere die eingebaute Git-Erweiterung von VS Code und stelle sicher, dass Git installiert ist.",
  "git.unavailable.no-repository": "Der Inhaltsordner liegt in keinem Git-Repository.",
  "git.unavailable.repository-not-open":
    "Die Git-Erweiterung von VS Code konnte das Repository des Inhaltsordners nicht öffnen.",
  "editor.label.submit": "Zur Prüfung einreichen",
  "review.link": "PR #{number}",
  "review.linkTooltip": "Pull Request dieses Branches öffnen: {url}",
  "links.updatedOnMove": "Links in {count} Seiten nach dem Verschieben angepasst.",
  "links.stable.copied": "Stabiler Link kopiert: {url}",
  "links.stable.notConfigured":
    "Das Profil legt keine stabilen Links fest. Ergänze site.url und site.stable_links in .lorequill/config.yaml.",
  "links.stable.noValue": "Die Seite hat kein Feld {field} und darum keinen stabilen Link.",
  "links.stable.noPage": "Öffne oder wähle zuerst eine Seite eines Lorequill-Ordners.",
  "submit.chooseRemote": "An welches Remote einreichen?",
  "submit.confirmTitle": "{branch} zur Prüfung in {base} einreichen?",
  "submit.destination": "Ziel: {host} (Remote {remote}), {branch} → {base}",
  "submit.newReview": "Ein neuer Pull Request wird erstellt.",
  "submit.updateReview": "Der offene Pull Request #{number} ({title}) wird aktualisiert.",
  "submit.commitsIntro":
    "Die Prüfung enthält jeden Commit des Branches, der nicht im Basis-Branch ist ({count}):",
  "submit.moreCommits": "… und {count} weitere",
  "submit.stagedNotIncluded":
    "Gestagte, aber nicht committete Änderungen sind nicht Teil der Einreichung.",
  "submit.confirm": "Pushen und einreichen",
  "submit.titlePrompt": "Titel des Pull Requests",
  "submit.titleEmpty": "Gib einen Titel ein.",
  "submit.openReview": "Pull Request öffnen",
  "submit.created": "Pull Request #{number} auf {host} erstellt.",
  "submit.updated": "Branch gepusht; Pull Request #{number} auf {host} ist aktualisiert.",
  "submit.blocked.detached-head":
    "HEAD ist losgelöst (detached). Wechsle auf den Branch, den du einreichen willst.",
  "submit.blocked.unborn-branch": "Der Branch hat noch keine Commits. Committe zuerst.",
  "submit.branch.title": "Änderungen auf einem eigenen Branch einreichen?",
  "submit.branch.detail":
    "Änderungen werden nicht direkt in {base} eingereicht, sondern von einem eigenen Branch aus, damit sie zuerst geprüft werden können. Lorequill erstellt den Branch aus deinem aktuellen Stand: Deine Commits und noch nicht committeten Änderungen kommen mit. Danach geht das Einreichen wie gewohnt weiter.",
  "submit.branch.create": "Branch erstellen",
  "submit.branch.namePrompt": "Name des neuen Branches",
  "submit.branch.nameHint":
    "Ein kurzer Name für deine Änderung, zum Beispiel glossar-ergaenzen. Buchstaben, Ziffern, Bindestriche und Schrägstriche, keine Leerzeichen.",
  "submit.branch.suggestion": "aenderungen-{date}",
  "submit.branch.empty": "Gib einen Namen ein.",
  "submit.branch.invalid":
    "Verwende nur Buchstaben, Ziffern, Bindestriche und Schrägstriche, ohne Leerzeichen.",
  "submit.branch.exists": "Einen Branch {branch} gibt es schon. Wähle einen anderen Namen.",
  "submit.branch.failed": "Der Branch {branch} konnte nicht erstellt werden.",
  "submit.blocked.unverified":
    "Der letzte Commit ist nicht verifiziert. Führe zuerst «Commit prüfen» aus; meldet es Befunde, erstelle einen Korrektur-Commit.",
  "submit.blocked.conflicts":
    "Das Repository hat Merge-Konflikte. Löse sie zuerst in der Quellcodeverwaltung.",
  "submit.blocked.no-remote":
    "Das Repository hat kein Remote. Füge zuerst in der Quellcodeverwaltung eines hinzu.",
  "submit.blocked.unsupported-host":
    "Das Remote liegt auf keinem unterstützten Git-Host. Lorequill reicht bei github.com und beim GitHub Enterprise Server aus github-enterprise.uri ein.",
  "submit.blocked.no-push-access": "Dein GitHub-Konto darf in dieses Repository nicht pushen.",
  "submit.blocked.no-base": "Der Basis-Branch {base} existiert auf dem Remote nicht.",
  "submit.blocked.no-commits":
    "Der Branch hat keine Commits, die nicht in {base} sind; es gibt nichts einzureichen.",
  "submit.reviewMerged":
    "Pull Request #{number} dieses Branches ist bereits gemergt. Erstelle für weitere Änderungen einen neuen Branch; Lorequill verwendet ihn nicht wieder und öffnet ihn nicht erneut.",
  "submit.reviewClosed":
    "Pull Request #{number} dieses Branches wurde geschlossen. Erstelle einen neuen Branch oder öffne ihn selbst auf dem Host wieder; Lorequill verwendet ihn nicht wieder und öffnet ihn nicht erneut.",
  "submit.diverged":
    "Der Remote-Branch hat Commits, die du nicht hast. Hole oder merge sie in der Quellcodeverwaltung und reiche dann erneut ein. Lorequill pusht nie mit Force.",
  "submit.fetch.auth":
    "Das Abrufen des Basis-Branches ist fehlgeschlagen: Git konnte sich beim Remote nicht anmelden.",
  "submit.fetch.network":
    "Das Abrufen des Basis-Branches ist fehlgeschlagen: Das Remote ist nicht erreichbar.",
  "submit.fetch.failed": "Das Abrufen des Basis-Branches ist fehlgeschlagen.",
  "submit.push.auth":
    "Der Push ist fehlgeschlagen: Git konnte sich beim Remote nicht anmelden. Deine Commits bleiben erhalten; versuche es nach der Anmeldung erneut.",
  "submit.push.network":
    "Der Push ist fehlgeschlagen: Das Remote ist nicht erreichbar. Deine Commits bleiben erhalten; versuche es später erneut.",
  "submit.push.failed":
    "Der Push ist fehlgeschlagen. Deine Commits bleiben erhalten; du kannst es erneut versuchen.",
  "submit.pushedRetry": "Der Branch ist gepusht; erneutes Einreichen erzeugt kein Duplikat.",
  "submit.signInAgain": "Erneut anmelden",
  "submit.host.auth": "GitHub hat die Anmeldung nicht akzeptiert.",
  "submit.host.forbidden": "GitHub hat die Anfrage für dieses Konto abgelehnt.",
  "submit.host.not-found":
    "Das Repository wurde auf GitHub nicht gefunden, oder dein Konto kann es nicht sehen.",
  "submit.host.rate-limited":
    "Das Anfragelimit von GitHub ist erreicht. Versuche es später erneut.",
  "submit.host.network": "GitHub ist nicht erreichbar.",
  "submit.host.already-exists": "Für diesen Branch existiert bereits ein Pull Request.",
  "submit.host.invalid": "GitHub hat den Pull Request abgelehnt.",
  "submit.host.unexpected": "GitHub hat unerwartet geantwortet.",
};
