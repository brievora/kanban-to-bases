// Interface text in English and French. French is used when Obsidian's language starts with "fr".
// French typography: no-break space before ":" and narrow no-break space before ";", "?" and "!".

import { getLanguage } from 'obsidian';

const NBSP = '\xa0';
const NNBSP = '\u{202F}';

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const pluralFr = (n: number, one: string, many: string): string => `${n} ${n <= 1 ? one : many}`;
const q = (text: string): string => `\u{201C}${text}\u{201D}`;
const qFr = (text: string): string => `\u{AB}${NBSP}${text}${NBSP}\u{BB}`;

const en = {
  commandConvert: 'Convert this Kanban board to Bases',
  commandUndo: 'Undo last Kanban conversion',
  menuConvert: 'Convert to Bases',
  notABoard: 'This note is not a Kanban board.',
  readError: (error: string) => `The board could not be read: ${error}`,

  previewTitle: 'Convert to Bases',
  previewSummary: (columns: number, cards: number) => `${plural(columns, 'column', 'columns')}, ${plural(cards, 'card', 'cards')}`,
  columnsHeading: 'Columns',
  columnComplete: 'complete',
  columnArchive: 'archive',
  emptyBoard: 'This board has no cards. The base is created with its empty columns.',
  folderName: 'Destination folder',
  folderDesc: 'The notes and the base are created here. Leave empty for the vault root.',
  folderInvalid: 'A folder name cannot contain * " < > : | ? or a dot at the start of a folder.',
  linkedName: 'Add properties to linked notes',
  linkedDesc: 'A card that only links to an existing note updates that note instead of creating a new one.',
  archiveName: 'Include the archive',
  archiveDesc: (n: number) => (n === 0 ? 'This board has no archived cards.' : `${plural(n, 'archived card goes', 'archived cards go')} into an Archive column.`),
  openName: 'Open the base when done',
  notesHeading: (n: number) => `Notes to create (${n})`,
  linksHeading: (n: number) => `Linked notes to update (${n})`,
  baseHeading: 'Base',
  more: (n: number) => `and ${n} more`,
  warningsHeading: (n: number) => `Check before converting (${n})`,
  cancel: 'Cancel',
  convert: 'Convert',
  converting: 'Converting\u{2026}',

  warnRenamed: (from: string, to: string) => `${q(from)} already exists, the note is named ${q(to)}.`,
  warnDuplicateColumn: (from: string, to: string) => `Two columns are named ${q(from)}, the second one becomes ${q(to)}.`,
  warnLinkMissing: (target: string) => `The linked note ${q(target)} does not exist, a new note is created.`,
  warnLinkDuplicate: (target: string) => `Several cards link to ${q(target)}, only the first one is used.`,
  warnLinkExtra: (target: string) => `The card linking to ${q(target)} has more text, which stays in the board only.`,
  warnLinksUnchanged: (n: number) => `${plural(n, 'linked note stays', 'linked notes stay')} unchanged and will not appear in the base.`,
  warnInvalidDate: (card: string, value: string) => `${q(value)} in ${q(card)} does not match the board's date format, it stays as text.`,
  warnTimeWithoutDate: (card: string, value: string) => `${q(card)} has a time (${value}) but no date, it stays as text.`,
  warnLooseCards: (n: number, column: string) => `${plural(n, 'card sits', 'cards sit')} above the first column and will go to ${q(column)}.`,
  warnIgnoredLines: (n: number) => `${plural(n, 'line', 'lines')} outside the cards will be skipped. The Kanban plugin does not show them either.`,
  warnSettingsUnreadable: 'The settings block of the board cannot be read, the default date format is used.',
  warnBoardRenamed: (prop: string, name: string, value: string) =>
    `Other notes already have ${prop}: ${q(name)}, from another board or an earlier conversion. These cards get ${prop}: ${q(value)}, so each base only shows its own cards.`,
  warnLinkOverwrite: (target: string, prop: string, from: string, to: string) =>
    `${q(target)}: ${prop} changes from ${q(from)} to ${q(to)}. Undo gives the old value back.`,
  warnLinkNotCopied: (target: string) =>
    `${q(target)}: the date, tags and fields of the card are not copied to the note. Only the column, the position and the board are.`,

  successTitle: 'Board converted',
  successNotes: (n: number) => `${plural(n, 'note', 'notes')} created`,
  successLinks: (n: number) => `${plural(n, 'linked note', 'linked notes')} updated`,
  successUndo: `To undo, run ${q('Undo last Kanban conversion')} from the command palette.`,
  openBase: 'Open the base',
  done: 'Done',
  noticeConverted: (notes: number) => `Kanban to Bases: ${plural(notes, 'note', 'notes')} and 1 base created.`,
  noticeFailed: (error: string, created: number) =>
    `Conversion stopped: ${error}. ${created > 0 ? `Run ${q('Undo last Kanban conversion')} to remove the ${plural(created, 'file', 'files')} already created.` : 'Nothing was created.'}`,

  undoTitle: 'Undo the last conversion?',
  undoBoard: (board: string, date: string) => `Board ${q(board)}, converted on ${date}.`,
  undoFiles: (n: number) => `${plural(n, 'file goes', 'files go')} to the trash, following your ${q('Deleted files')} setting.`,
  undoLinks: (n: number) => (n === 1 ? '1 linked note gets back the properties it had before.' : `${n} linked notes get back the properties they had before.`),
  undoConfirm: 'Undo',
  undoNothing: 'There is no conversion to undo.',
  undoDone: (files: number, links: number) => `Conversion undone: ${plural(files, 'file', 'files')} removed, ${plural(links, 'note', 'notes')} restored.`,
  undoMissing: (n: number) => `${plural(n, 'file was', 'files were')} already gone.`,
  undoKept: (n: number) => `${plural(n, 'property was', 'properties were')} edited after the conversion and kept as is.`,

  propsHeading: 'Property names',
  propStatus: 'Column',
  propStatusDesc: 'Column the card was in. The Kanban view groups the cards by this property.',
  propPosition: 'Position',
  propPositionDesc: 'Order of the card in its column, from 1.',
  propDue: 'Due date',
  propDueDesc: 'Date and time of the card, from @{date} and @@{time}.',
  propDone: 'Done',
  propDoneDesc: 'True for checked cards and for cards in a column marked complete.',
  propTags: 'Tags',
  propTagsDesc: 'Tags found in the card, without the #.',
  propBoard: 'Board',
  propBoardDesc: 'Name of the original board. The base shows the notes with this value.',
  propInvalid: 'Use letters, numbers, spaces, - or _.',
  propDuplicate: 'Another property already uses this name.',
  conversionHeading: 'Conversion',
  defaultColumn: 'Default column',
  defaultColumnDesc: 'For cards placed above the first column of a board.',
  defaultColumnValue: 'Inbox',
  columnWidth: 'Column width',
  columnWidthDesc: 'Width of the columns in the Kanban view, in pixels (150 to 600).',
  columnWidthInvalid: 'Enter a number between 150 and 600.',
  untitledCard: 'Untitled card',
  untitledColumn: 'Untitled column',
  boardView: 'Board',
  tableView: 'All cards',

  promoText: 'Made by the Brievora team. Brievora is a ready-made Obsidian vault for freelance client projects, from brief to handoff.',
  promoLink: 'Visit brievora.com',
  promoUrl: 'https://brievora.com/?utm_source=obsidian&utm_medium=plugin&utm_campaign=kanban-to-bases',
};

export type Strings = typeof en;

const fr: Strings = {
  commandConvert: 'Convertir ce tableau Kanban en base',
  commandUndo: 'Annuler la dernière conversion Kanban',
  menuConvert: 'Convertir en base',
  notABoard: 'Cette note n\u{2019}est pas un tableau Kanban.',
  readError: (error) => `Impossible de lire le tableau${NBSP}: ${error}`,

  previewTitle: 'Convertir en base',
  previewSummary: (columns, cards) => `${pluralFr(columns, 'colonne', 'colonnes')}, ${pluralFr(cards, 'carte', 'cartes')}`,
  columnsHeading: 'Colonnes',
  columnComplete: 'terminée',
  columnArchive: 'archive',
  emptyBoard: 'Ce tableau n\u{2019}a aucune carte. La base est créée avec ses colonnes vides.',
  folderName: 'Dossier de destination',
  folderDesc: 'Les notes et la base sont créées ici. Laisser vide pour la racine du coffre.',
  folderInvalid: `Un nom de dossier ne peut pas contenir * " < > : | ? ni commencer par un point.`,
  linkedName: 'Ajouter les propriétés aux notes liées',
  linkedDesc: 'Une carte qui ne contient qu\u{2019}un lien vers une note existante met à jour cette note au lieu d\u{2019}en créer une nouvelle.',
  archiveName: 'Inclure l\u{2019}archive',
  archiveDesc: (n) => (n === 0 ? 'Ce tableau n\u{2019}a aucune carte archivée.' : `${pluralFr(n, 'carte archivée va', 'cartes archivées vont')} dans une colonne Archive.`),
  openName: 'Ouvrir la base à la fin',
  notesHeading: (n) => `Notes à créer (${n})`,
  linksHeading: (n) => `Notes liées à mettre à jour (${n})`,
  baseHeading: 'Base',
  more: (n) => `et ${n} de plus`,
  warningsHeading: (n) => `À vérifier avant de convertir (${n})`,
  cancel: 'Annuler',
  convert: 'Convertir',
  converting: 'Conversion\u{2026}',

  warnRenamed: (from, to) => `${qFr(from)} existe déjà, la note s\u{2019}appelle ${qFr(to)}.`,
  warnDuplicateColumn: (from, to) => `Deux colonnes s\u{2019}appellent ${qFr(from)}, la seconde devient ${qFr(to)}.`,
  warnLinkMissing: (target) => `La note liée ${qFr(target)} n\u{2019}existe pas, une nouvelle note est créée.`,
  warnLinkDuplicate: (target) => `Plusieurs cartes renvoient à ${qFr(target)}, seule la première est prise en compte.`,
  warnLinkExtra: (target) => `La carte qui renvoie à ${qFr(target)} contient d\u{2019}autres lignes, qui restent seulement dans le tableau.`,
  warnLinksUnchanged: (n) => `${pluralFr(n, 'note liée reste inchangée', 'notes liées restent inchangées')} et n\u{2019}apparaîtra pas dans la base.`,
  warnInvalidDate: (card, value) => `${qFr(value)} dans ${qFr(card)} ne suit pas le format de date du tableau, le texte reste tel quel.`,
  warnTimeWithoutDate: (card, value) => `${qFr(card)} a une heure (${value}) sans date, le texte reste tel quel.`,
  warnLooseCards: (n, column) => `${pluralFr(n, 'carte se trouve', 'cartes se trouvent')} au-dessus de la première colonne et ira dans ${qFr(column)}.`,
  warnIgnoredLines: (n) => `${pluralFr(n, 'ligne', 'lignes')} hors des cartes ne seront pas reprises. Le plugin Kanban ne les affiche pas non plus.`,
  warnSettingsUnreadable: 'Le bloc de réglages du tableau est illisible, le format de date par défaut est utilisé.',
  warnBoardRenamed: (prop, name, value) =>
    `D\u{2019}autres notes ont déjà ${prop}${NBSP}: ${qFr(name)}, venues d\u{2019}un autre tableau ou d\u{2019}une conversion précédente. Ces cartes auront ${prop}${NBSP}: ${qFr(value)}, pour que chaque base ne montre que ses propres cartes.`,
  warnLinkOverwrite: (target, prop, from, to) =>
    `${qFr(target)}${NBSP}: ${prop} passe de ${qFr(from)} à ${qFr(to)}. L\u{2019}annulation rend l\u{2019}ancienne valeur.`,
  warnLinkNotCopied: (target) =>
    `${qFr(target)}${NBSP}: la date, les étiquettes et les champs de la carte ne sont pas copiés sur la note. Seuls la colonne, la position et le tableau le sont.`,

  successTitle: 'Tableau converti',
  successNotes: (n) => `${pluralFr(n, 'note créée', 'notes créées')}`,
  successLinks: (n) => `${pluralFr(n, 'note liée mise à jour', 'notes liées mises à jour')}`,
  successUndo: `Pour annuler, lancez ${qFr('Annuler la dernière conversion Kanban')} depuis la palette de commandes.`,
  openBase: 'Ouvrir la base',
  done: 'Terminé',
  noticeConverted: (notes) => `Kanban to Bases${NBSP}: ${pluralFr(notes, 'note', 'notes')} et 1 base créées.`,
  noticeFailed: (error, created) =>
    `Conversion interrompue${NBSP}: ${error}. ${created > 0 ? `Lancez ${qFr('Annuler la dernière conversion Kanban')} pour retirer ${pluralFr(created, 'fichier déjà créé', 'fichiers déjà créés')}.` : 'Rien n\u{2019}a été créé.'}`,

  undoTitle: `Annuler la dernière conversion${NNBSP}?`,
  undoBoard: (board, date) => `Tableau ${qFr(board)}, converti le ${date}.`,
  undoFiles: (n) => `${pluralFr(n, 'fichier part', 'fichiers partent')} à la corbeille, selon votre réglage ${qFr('Fichiers supprimés')}.`,
  undoLinks: (n) => `${pluralFr(n, 'note liée retrouve', 'notes liées retrouvent')} les propriétés d\u{2019}avant.`,
  undoConfirm: 'Annuler la conversion',
  undoNothing: 'Aucune conversion à annuler.',
  undoDone: (files, links) => `Conversion annulée${NBSP}:${pluralFr(files, 'fichier retiré', 'fichiers retirés')}, ${pluralFr(links, 'note restaurée', 'notes restaurées')}.`,
  undoMissing: (n) => `${pluralFr(n, 'fichier avait', 'fichiers avaient')} déjà disparu.`,
  undoKept: (n) => `${pluralFr(n, 'propriété modifiée', 'propriétés modifiées')} après la conversion ${n <= 1 ? 'est conservée' : 'sont conservées'}.`,

  propsHeading: 'Noms des propriétés',
  propStatus: 'Colonne',
  propStatusDesc: 'Colonne où se trouvait la carte. La vue Kanban regroupe les cartes selon cette propriété.',
  propPosition: 'Position',
  propPositionDesc: 'Ordre de la carte dans sa colonne, à partir de 1.',
  propDue: 'Échéance',
  propDueDesc: 'Date et heure de la carte, tirées de @{date} et @@{heure}.',
  propDone: 'Terminé',
  propDoneDesc: 'Vrai pour les cartes cochées et pour celles d\u{2019}une colonne marquée comme terminée.',
  propTags: 'Tags',
  propTagsDesc: 'Tags trouvés dans la carte, sans le #.',
  propBoard: 'Tableau',
  propBoardDesc: 'Nom du tableau d\u{2019}origine. La base affiche les notes qui portent cette valeur.',
  propInvalid: 'Lettres, chiffres, espaces, - ou _ uniquement.',
  propDuplicate: 'Une autre propriété porte déjà ce nom.',
  conversionHeading: 'Conversion',
  defaultColumn: 'Colonne par défaut',
  defaultColumnDesc: 'Pour les cartes placées au-dessus de la première colonne d\u{2019}un tableau.',
  defaultColumnValue: 'À trier',
  columnWidth: 'Largeur des colonnes',
  columnWidthDesc: 'Largeur des colonnes de la vue Kanban, en pixels (de 150 à 600).',
  columnWidthInvalid: 'Saisissez un nombre entre 150 et 600.',
  untitledCard: 'Carte sans titre',
  untitledColumn: 'Colonne sans titre',
  boardView: 'Tableau',
  tableView: 'Toutes les cartes',

  promoText: 'Conçu par l\u{2019}équipe Brievora. Brievora est un vault Obsidian prêt à l\u{2019}emploi pour les projets clients des indépendants, du brief au handoff.',
  promoLink: 'Découvrir brievora.com',
  promoUrl: 'https://brievora.com/fr?utm_source=obsidian&utm_medium=plugin&utm_campaign=kanban-to-bases',
};

let current: Strings | null = null;

/** Strings for the current Obsidian language. */
export function t(): Strings {
  current ??= getLanguage().toLowerCase().startsWith('fr') ? fr : en;
  return current;
}

/** Date in the interface language, for the undo confirmation. */
export function formatDate(timestamp: number): string {
  const locale = getLanguage().toLowerCase().startsWith('fr') ? 'fr-FR' : 'en-US';
  return new Date(timestamp).toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short' });
}
