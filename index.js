const {
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder, PermissionFlagsBits,
  Events, MessageFlags, AttachmentBuilder,
} = require('discord.js');
const { createClient } = require('@libsql/client');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const http = require('http');
const path = require('path');

// ───────── CONFIG ─────────
const CFG = {
  PANEL_CHANNEL: '1536145374245560320',     // salon du panneau d'identité
  REQUEST_CHANNEL: '1568659952476889088',   // demandes d'identité (staff)
  CARD_LOG_CHANNEL: '1568662351065129051',  // logs cartes validées / refusées
  BOT_LOG_CHANNEL: '1564203403792613466',   // logs du bot (commandes, erreurs...)
  ROLE_REMOVE: '1558228147156033716',       // rôle "sans papier" (retiré à la validation, rendu à la mort RP)
  ROLE_ADD: '1517283159744577596',          // rôle "civil" (donné à la validation, retiré à la mort RP)
  // Staff autorisé à valider/refuser : Modérateur, Administrateur, Exécutif, Fondateur
  STAFF_ROLES: [
    '1514240629889175693', '1563694441212944434',
    '1514237734472908810', '1513966828555210752',
  ],
};
const FOOTER = 'Dev by U-lis ⚜';

// ───────── POLICES DE LA CARTE ─────────
const fontFile = (pkg, file) => path.join(__dirname, 'node_modules', '@fontsource', pkg, 'files', file);
[
  [fontFile('inter', 'inter-latin-400-normal.woff'), 'CardRegular'],
  [fontFile('inter', 'inter-latin-700-normal.woff'), 'CardBold'],
  [fontFile('ibm-plex-mono', 'ibm-plex-mono-latin-500-normal.woff'), 'CardMono'],
].forEach(([p, name]) => {
  try {
    if (!GlobalFonts.registerFromPath(p, name)) console.error('Police non chargée :', name);
  } catch (e) {
    console.error('Police introuvable :', name, e.message);
  }
});

// ───────── BASE DE DONNÉES (Turso) ─────────
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initDb() {
  await db.execute(`CREATE TABLE IF NOT EXISTS identities (
    user_id TEXT PRIMARY KEY,
    nom TEXT, prenom TEXT, naissance TEXT, ville TEXT, nationalite TEXT, pays_code TEXT,
    status TEXT DEFAULT 'pending',
    card_number TEXT UNIQUE,
    suspicious INTEGER DEFAULT 0,
    flags TEXT,
    refuse_reason TEXT,
    reviewed_by TEXT,
    request_message_id TEXT,
    created_at TEXT,
    reviewed_at TEXT
  )`);
  await db.execute('ALTER TABLE identities ADD COLUMN roblox_id TEXT').catch(() => {}); // déjà présente ? ok
  await db.execute(`CREATE TABLE IF NOT EXISTS identity_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT, action TEXT, staff_id TEXT, reason TEXT, at TEXT
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS character_deaths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT, staff_id TEXT, reason TEXT, at TEXT
  )`);
}
const getIdentity = async (uid) =>
  (await db.execute({ sql: 'SELECT * FROM identities WHERE user_id = ?', args: [uid] })).rows[0] || null;
const addHistory = (uid, action, staff, reason) =>
  db.execute({
    sql: 'INSERT INTO identity_history (user_id, action, staff_id, reason, at) VALUES (?,?,?,?,?)',
    args: [uid, action, staff, reason || null, new Date().toISOString()],
  });

async function genCardNumber() {
  for (;;) {
    const n = 'BRP-' + Math.floor(10000000 + Math.random() * 90000000);
    const r = await db.execute({ sql: 'SELECT 1 FROM identities WHERE card_number = ?', args: [n] });
    if (!r.rows.length) return n;
  }
}

// ───────── PAYS → CODE 3 LETTRES + ADJECTIF DE NATIONALITÉ ─────────
// CODE|noms de pays (sans accents)|débuts de nationalité (sans accents)|adjectif féminin affiché
const COUNTRIES = `AFG|afghanistan|afghan|Afghane
ZAF|afrique du sud|sud africain|Sud-africaine
ALB|albanie|albanais|Albanaise
DZA|algerie|algerien|Algérienne
DEU|allemagne|allemand|Allemande
AND|andorre|andorran|Andorrane
AGO|angola|angolais|Angolaise
ATG|antigua et barbuda|antiguayen|Antiguayenne
SAU|arabie saoudite|saoudien|Saoudienne
ARG|argentine|argentin|Argentine
ARM|armenie|armenien|Arménienne
AUS|australie|australien|Australienne
AUT|autriche|autrichien|Autrichienne
AZE|azerbaidjan|azerbaidjanais,azeri|Azerbaïdjanaise
BHS|bahamas|bahameen|Bahaméenne
BHR|bahrein|bahreini|Bahreïnienne
BGD|bangladesh|bangladais|Bangladaise
BRB|barbade|barbadien|Barbadienne
BEL|belgique|belge|Belge
BLZ|belize|belizien|Bélizienne
BEN|benin|beninois|Béninoise
BTN|bhoutan|bhoutanais|Bhoutanaise
BLR|bielorussie,belarus|bielorusse|Biélorusse
MMR|birmanie,myanmar|birman|Birmane
BOL|bolivie|bolivien|Bolivienne
BIH|bosnie herzegovine,bosnie|bosnien|Bosnienne
BWA|botswana|botswanais|Botswanaise
BRA|bresil|bresilien|Brésilienne
BRN|brunei|bruneien|Brunéienne
BGR|bulgarie|bulgare|Bulgare
BFA|burkina faso|burkinabe|Burkinabée
BDI|burundi|burundais|Burundaise
KHM|cambodge|cambodgien|Cambodgienne
CMR|cameroun|camerounais|Camerounaise
CAN|canada|canadien|Canadienne
CPV|cap vert|cap verdien|Cap-verdienne
CHL|chili|chilien|Chilienne
CHN|chine|chinois|Chinoise
CYP|chypre|chypriote|Chypriote
COL|colombie|colombien|Colombienne
COM|comores|comorien|Comorienne
COG|congo,republique du congo,congo brazzaville||Congolaise
COD|rd congo,republique democratique du congo,congo kinshasa||Congolaise (RDC)
PRK|coree du nord|nord coreen|Nord-coréenne
KOR|coree du sud,coree|sud coreen,coreen|Sud-coréenne
CRI|costa rica|costaricien,costa ricien|Costaricienne
CIV|cote d ivoire|ivoirien|Ivoirienne
HRV|croatie|croate|Croate
CUB|cuba|cubain|Cubaine
DNK|danemark|danois|Danoise
DJI|djibouti|djiboutien|Djiboutienne
DMA|dominique|dominiquais|Dominiquaise
EGY|egypte|egyptien|Égyptienne
ARE|emirats arabes unis|emirien,emirati|Émiratie
ECU|equateur|equatorien|Équatorienne
ERI|erythree|erythreen|Érythréenne
ESP|espagne|espagnol|Espagnole
EST|estonie|estonien|Estonienne
SWZ|eswatini,swaziland|swazi|Swazie
USA|etats unis,usa,etats unis d amerique,us|americain|Américaine
ETH|ethiopie|ethiopien|Éthiopienne
FJI|fidji|fidjien|Fidjienne
FIN|finlande|finlandais|Finlandaise
FRA|france|francais|Française
GAB|gabon|gabonais|Gabonaise
GMB|gambie|gambien|Gambienne
GEO|georgie|georgien|Géorgienne
GHA|ghana|ghaneen|Ghanéenne
GRC|grece|grec,grecq|Grecque
GRD|grenade|grenadien|Grenadienne
GTM|guatemala|guatemalteque|Guatémaltèque
GIN|guinee|guineen|Guinéenne
GNB|guinee bissau|bissau guineen|Bissau-guinéenne
GNQ|guinee equatoriale|equato guineen|Équato-guinéenne
GUY|guyana|guyanien|Guyanienne
HTI|haiti|haitien|Haïtienne
HND|honduras|hondurien|Hondurienne
HUN|hongrie|hongrois|Hongroise
MHL|iles marshall|marshallais|Marshallaise
SLB|iles salomon|salomonais|Salomonaise
IND|inde|indien|Indienne
IDN|indonesie|indonesien|Indonésienne
IRQ|irak|irakien|Irakienne
IRN|iran|iranien|Iranienne
IRL|irlande|irlandais|Irlandaise
ISL|islande|islandais|Islandaise
ISR|israel|israelien|Israélienne
ITA|italie|italien|Italienne
JAM|jamaique|jamaicain|Jamaïcaine
JPN|japon|japonais|Japonaise
JOR|jordanie|jordanien|Jordanienne
KAZ|kazakhstan|kazakh|Kazakhe
KEN|kenya|kenyan|Kényane
KGZ|kirghizistan|kirghize|Kirghize
KIR|kiribati|kiribatien|Kiribatienne
XKX|kosovo|kosovar|Kosovare
KWT|koweit|koweitien|Koweïtienne
LAO|laos|laotien|Laotienne
LSO|lesotho|lesothan|Lesothane
LVA|lettonie|letton|Lettone
LBN|liban|libanais|Libanaise
LBR|liberia|liberien|Libérienne
LBY|libye|libyen|Libyenne
LIE|liechtenstein|liechtensteinois|Liechtensteinoise
LTU|lituanie|lituanien|Lituanienne
LUX|luxembourg|luxembourgeois|Luxembourgeoise
MKD|macedoine du nord,macedoine|macedonien|Macédonienne
MDG|madagascar|malgache|Malgache
MYS|malaisie|malaisien|Malaisienne
MWI|malawi|malawite|Malawite
MDV|maldives|maldivien|Maldivienne
MLI|mali|malien|Malienne
MLT|malte|maltais|Maltaise
MAR|maroc|marocain|Marocaine
MUS|maurice|mauricien|Mauricienne
MRT|mauritanie|mauritanien|Mauritanienne
MEX|mexique|mexicain|Mexicaine
FSM|micronesie|micronesien|Micronésienne
MDA|moldavie|moldave|Moldave
MCO|monaco|monegasque|Monégasque
MNG|mongolie|mongol|Mongole
MNE|montenegro|montenegrin|Monténégrine
MOZ|mozambique|mozambicain|Mozambicaine
NAM|namibie|namibien|Namibienne
NRU|nauru|nauruan|Nauruane
NPL|nepal|nepalais|Népalaise
NIC|nicaragua|nicaraguayen|Nicaraguayenne
NER|niger|nigerien|Nigérienne
NGA|nigeria|nigerian|Nigériane
NOR|norvege|norvegien|Norvégienne
NZL|nouvelle zelande|neo zelandais|Néo-zélandaise
OMN|oman|omanais|Omanaise
UGA|ouganda|ougandais|Ougandaise
UZB|ouzbekistan|ouzbek|Ouzbèke
PAK|pakistan|pakistanais|Pakistanaise
PLW|palaos|palaosien|Palaosienne
PSE|palestine|palestinien|Palestinienne
PAN|panama|panameen|Panaméenne
PNG|papouasie nouvelle guinee|papou|Papouane
PRY|paraguay|paraguayen|Paraguayenne
NLD|pays bas,hollande|neerlandais,hollandais|Néerlandaise
PER|perou|peruvien|Péruvienne
PHL|philippines|philippin|Philippine
POL|pologne|polonais|Polonaise
PRT|portugal|portugais|Portugaise
QAT|qatar|qatarien|Qatarienne
CAF|republique centrafricaine,centrafrique|centrafricain|Centrafricaine
DOM|republique dominicaine|dominicain|Dominicaine
CZE|tchequie,republique tcheque|tcheque|Tchèque
ROU|roumanie|roumain|Roumaine
GBR|royaume uni,angleterre,grande bretagne,ecosse,pays de galles|britannique,anglais,ecossais,gallois|Britannique
RUS|russie|russe|Russe
RWA|rwanda|rwandais|Rwandaise
KNA|saint christophe et nieves|kittitien|Kittitienne
LCA|sainte lucie|saint lucien|Saint-lucienne
SMR|saint marin|saint marinais|Saint-marinaise
VCT|saint vincent et les grenadines|vincentais|Vincentaise
SLV|salvador,el salvador|salvadorien|Salvadorienne
WSM|samoa|samoan|Samoane
STP|sao tome et principe|santomeen|Santoméenne
SEN|senegal|senegalais|Sénégalaise
SRB|serbie|serbe|Serbe
SYC|seychelles|seychellois|Seychelloise
SLE|sierra leone|sierra leonais|Sierra-léonaise
SGP|singapour|singapourien|Singapourienne
SVK|slovaquie|slovaque|Slovaque
SVN|slovenie|slovene|Slovène
SOM|somalie|somalien|Somalienne
SDN|soudan|soudanais|Soudanaise
SSD|soudan du sud|sud soudanais|Sud-soudanaise
LKA|sri lanka|sri lankais|Sri-lankaise
SWE|suede|suedois|Suédoise
CHE|suisse|suisse|Suisse
SUR|suriname|surinamien|Surinamienne
SYR|syrie|syrien|Syrienne
TJK|tadjikistan|tadjik|Tadjike
TWN|taiwan|taiwanais|Taïwanaise
TZA|tanzanie|tanzanien|Tanzanienne
TCD|tchad|tchadien|Tchadienne
THA|thailande|thailandais|Thaïlandaise
TLS|timor oriental|timorais|Timoraise
TGO|togo|togolais|Togolaise
TON|tonga|tongien|Tongienne
TTO|trinite et tobago|trinidadien|Trinidadienne
TUN|tunisie|tunisien|Tunisienne
TKM|turkmenistan|turkmene|Turkmène
TUR|turquie|turc,turq|Turque
TUV|tuvalu|tuvaluan|Tuvaluane
UKR|ukraine|ukrainien|Ukrainienne
URY|uruguay|uruguayen|Uruguayenne
VUT|vanuatu|vanuatais|Vanuatuane
VAT|vatican,saint siege||Vaticane
VEN|venezuela|venezuelien|Vénézuélienne
VNM|vietnam,viet nam|vietnamien|Vietnamienne
YEM|yemen|yemenite|Yéménite
ZMB|zambie|zambien|Zambienne
ZWE|zimbabwe|zimbabween|Zimbabwéenne`
  .split('\n')
  .map((l) => {
    const [code, names, stems, adj] = l.split('|');
    return { code, names: names.split(','), stems: stems ? stems.split(',').filter(Boolean) : [], adj };
  });

const norm = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function findCountry(input) {
  const n = norm(input);
  return COUNTRIES.find((c) => c.names.includes(n) || c.stems.some((s) => n.startsWith(s))) || null;
}
const natAdj = (row) => COUNTRIES.find((c) => c.code === row.pays_code)?.adj || row.nationalite;

// ───────── MODÉRATION RENFORCÉE (mots / dates suspects) ─────────
// Nettoyage anti-contournement : accents, leet (4=a, 3=e, 1=i, 0=o...), symboles, lettres répétées
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '€': 'e', '£': 'l', '+': 't' };
function clean(s) {
  let t = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  t = t.replace(/[0134578@$!€£+]/g, (c) => LEET[c]);
  t = t.replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.replace(/(.)\1+/g, '$1'); // "hiiitler" -> "hitler"
}

const RAW_TERMS = [
  // Terrorisme
  'ben laden', 'bin laden', 'osama bin laden', 'oussama ben laden', 'al qaida', 'al qaeda', 'alqaida',
  'zawahiri', 'zarqawi', 'al baghdadi', 'abou bakr al baghdadi', 'daech', 'daesh', 'isis', 'etat islamique',
  'terroriste', 'terrorist', 'terrorisme', 'jihad', 'djihad', 'kamikaze', 'attentat', 'bombe', 'explosif',
  'massacre', 'mohamed merah', 'amedy coulibaly', 'salah abdeslam', 'abdelhamid abaaoud',
  'cherif kouachi', 'said kouachi', 'anders breivik',
  // Dictateurs / nazisme
  'hitler', 'adolf hitler', 'nazi', 'goebbels', 'himmler', 'eichmann', 'mengele', 'mussolini',
  'staline', 'pol pot', 'kim jong un', 'auschwitz', 'treblinka',
  // Criminels célèbres
  'marc dutroux', 'michel fourniret',
  // Violence / insultes
  'pedophile', 'pedo', 'violeur', 'viol', 'tueur', 'assassin',
  'nique', 'salope', 'pute', 'connard', 'enculer', 'negro',
];
const TERMS = RAW_TERMS.map((raw) => {
  const c = clean(raw);
  return { raw, spaced: c, tight: c.replace(/ /g, '') };
});

function matchTerm(text) {
  const c = clean(text);
  const padded = ` ${c} `;
  const tight = c.replace(/ /g, '');
  for (const t of TERMS) {
    if (padded.includes(` ${t.spaced} `)) return t.raw;             // mot / expression entière
    if (t.tight.length >= 6 && tight.includes(t.tight)) return t.raw; // "b e n l a d e n", "benladen"
  }
  return null;
}

const BAD_DATES = [
  { d: 11, m: 9, why: '11 septembre' },
  { d: 22, m: 3, y: 2016, why: 'attentats de Bruxelles' },
  { d: 13, m: 11, y: 2015, why: 'attentats du 13 novembre' },
  { d: 7, m: 1, y: 2015, why: 'attentat Charlie Hebdo' },
  { d: 14, m: 7, y: 2016, why: 'attentat de Nice' },
  { d: 11, m: 3, y: 2004, why: 'attentats de Madrid' },
  { d: 7, m: 7, y: 2005, why: 'attentats de Londres' },
  { d: 22, m: 7, y: 2011, why: 'attentats d\'Oslo / Utøya' },
  { d: 15, m: 3, y: 2019, why: 'attentat de Christchurch' },
  { d: 20, m: 4, y: 1889, why: 'date de naissance d\'Hitler' },
];

function checkSuspicious({ nom, prenom, ville, nationalite }, date) {
  const flags = [];
  const seen = new Set();
  const checks = [
    ['name', 'Nom', nom],
    ['name', 'Prénom', prenom],
    ['name', 'Nom complet', `${prenom} ${nom}`],          // "Ben" + "Laden"
    ['name', 'Nom complet (inversé)', `${nom} ${prenom}`],
    ['ville', 'Ville de naissance', ville],
    ['nat', 'Nationalité', nationalite],
  ];
  for (const [group, label, val] of checks) {
    const term = matchTerm(val);
    if (!term) continue;
    const key = `${group}:${term}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flags.push(`${label} : « ${val} » (terme suspect : ${term})`);
  }
  const bd = BAD_DATES.find((b) => b.d === date.d && b.m === date.mo && (!b.y || b.y === date.y));
  if (bd) flags.push(`Date de naissance : ${date.str} (${bd.why})`);
  return flags;
}

// ───────── OUTILS ─────────
const cap = (s) => s.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const NAME_RE = /^[\p{L}][\p{L}\s'’-]{1,29}$/u;

function parseDate(s) {
  const m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900 || dt > new Date()) return null;
  return { d, mo, y, str: `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}` };
}

const mkEmbed = (color = 0x3498db) => new EmbedBuilder().setColor(color).setFooter({ text: FOOTER }).setTimestamp();
const isStaff = (i) => i.member?.roles?.cache?.some((r) => CFG.STAFF_ROLES.includes(r.id));
const EPH = MessageFlags.Ephemeral;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function sendTo(channelId, embed) {
  try {
    const ch = await client.channels.fetch(channelId);
    return await ch.send({ embeds: [embed] });
  } catch (e) {
    console.error('Envoi salon impossible', channelId, e.message);
    return null;
  }
}
const botLog = (title, desc, color = 0x2b2d31) =>
  sendTo(CFG.BOT_LOG_CHANNEL, mkEmbed(color).setTitle(title).setDescription(desc));
const cardLog = (embed) => sendTo(CFG.CARD_LOG_CHANNEL, embed);

async function dm(userId, embed, files = []) {
  try {
    const u = await client.users.fetch(userId);
    await u.send({ embeds: [embed], files });
    return true;
  } catch {
    await botLog('⚠️ MP impossible', `Impossible d'envoyer un MP à <@${userId}> (MP fermés ?).`, 0xfaa61a);
    return false;
  }
}

// ───────── EMBEDS ─────────
function identityFields(row) {
  return [
    { name: '📛 Nom', value: row.nom, inline: true },
    { name: '🧑 Prénom', value: row.prenom, inline: true },
    { name: '🎂 Date de naissance', value: row.naissance, inline: true },
    { name: '🏙️ Ville de naissance', value: row.ville, inline: true },
    { name: '🌍 Nationalité', value: `${row.nationalite} (${row.pays_code})`, inline: true },
  ];
}

// Version texte (secours si l'image ne peut pas être générée)
function cardEmbed(row, intro) {
  return mkEmbed(0x2ecc71)
    .setTitle('🪪 Carte d\'identité — Bruxelles Role-Play')
    .setDescription(`${intro ? intro + '\n\n' : ''}🔢 **N° de carte :** \`${row.card_number}\``)
    .addFields(identityFields(row));
}

function requestEmbed(row, flags, userTag) {
  const susp = flags.length > 0;
  const e = mkEmbed(susp ? 0xe74c3c : 0xf1c40f)
    .setTitle(susp ? '🚨 Demande d\'identité — ÉLÉMENTS SUSPECTS' : '🪪 Nouvelle demande d\'identité')
    .setDescription(
      `👤 **Demandeur :** <@${row.user_id}> (${userTag})\n🆔 **ID :** \`${row.user_id}\`` +
      (susp ? '\n\n🚨 Le système a détecté des **éléments suspects**. Vérifie cette demande avec attention.' : ''),
    )
    .addFields(identityFields(row));
  if (susp) {
    e.addFields({
      name: '⚠️ Détections automatiques',
      value: flags.map((f) => `• ${f}`).join('\n').slice(0, 1000),
    });
  }
  return e;
}

const staffButtons = (uid, disabled = false) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`id_accept:${uid}`).setLabel('Valider').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`id_refuse:${uid}`).setLabel('Refuser').setEmoji('❌').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );

// ───────── PANNEAU ─────────
const getMeta = async (k) =>
  (await db.execute({ sql: 'SELECT value FROM meta WHERE key = ?', args: [k] })).rows[0]?.value || null;
const setMeta = (k, v) =>
  db.execute({
    sql: 'INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    args: [k, v],
  });

const panelPayload = () => ({
  embeds: [
    mkEmbed(0x3498db)
      .setTitle('🪪 Création de ta carte d\'identité')
      .setDescription(
        'Pour jouer sur Bruxelles Role-Play, fais ta demande d\'état civil.\n\n' +
        '1️⃣ Clique sur **Créer mon identité**.\n' +
        '2️⃣ Remplis le formulaire : **nom, prénom, date de naissance, ville de naissance et nationalité**.\n' +
        '3️⃣ Le staff vérifie ta demande et tu reçois la décision par **MP**.\n\n' +
        '✅ Une fois validée, tu reçois ta **carte d\'identité** et ton rôle.\n' +
        '⚠️ Les informations doivent être **réalistes** et respecter le règlement. Toute demande suspecte est signalée au staff.',
      ),
  ],
  components: [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('id_open').setLabel('Créer mon identité').setEmoji('🪪').setStyle(ButtonStyle.Success),
    ),
  ],
});

async function sendPanel() {
  const ch = await client.channels.fetch(CFG.PANEL_CHANNEL);
  const oldId = await getMeta('panel_message_id');
  if (oldId) {
    const old = await ch.messages.fetch(oldId).catch(() => null);
    if (old) await old.delete().catch(() => {});
  }
  const msg = await ch.send(panelPayload());
  await setMeta('panel_message_id', msg.id);
  return msg;
}

async function ensurePanel() {
  try {
    const id = await getMeta('panel_message_id');
    const ch = await client.channels.fetch(CFG.PANEL_CHANNEL);
    const existing = id ? await ch.messages.fetch(id).catch(() => null) : null;
    if (existing) {
      await existing.edit(panelPayload()); // met à jour le style du panneau existant
      return;
    }
    await sendPanel();
    await botLog('📌 Panneau publié', `Panneau d'identité envoyé dans <#${CFG.PANEL_CHANNEL}>.`, 0x3498db);
  } catch (e) {
    console.error('ensurePanel', e.message);
    await botLog('❌ Panneau impossible', `Impossible de publier le panneau : ${e.message}`, 0xed4245);
  }
}

// ───────── PHOTO ROBLOX ─────────
// Tous les membres ont le pseudo Roblox comme pseudo Discord (vérification) : on retrouve le compte avec.
async function resolveRobloxId(member, user) {
  const nick = member?.nickname || null;
  const names = nick ? [nick] : [user.username, user.globalName];
  const valid = [...new Set(names.filter((n) => n && /^[A-Za-z0-9_]{3,20}$/.test(n)))];

  if (valid.length) {
    try {
      const r = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: valid, excludeBannedUsers: true }),
        signal: AbortSignal.timeout(5000),
      });
      const { data = [] } = await r.json();
      const found = valid
        .map((n) => data.find((d) => d.requestedUsername.toLowerCase() === n.toLowerCase()))
        .find(Boolean);
      if (found) return String(found.id);
    } catch { /* on tente le plan B */ }
  }

  // Plan B : le pseudo Discord est peut-être le pseudo d'affichage Roblox
  if (nick) {
    try {
      const r = await fetch(
        `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(nick)}&limit=10`,
        { signal: AbortSignal.timeout(5000) },
      );
      const { data = [] } = await r.json();
      const f = data.find(
        (d) => d.name?.toLowerCase() === nick.toLowerCase() || d.displayName?.toLowerCase() === nick.toLowerCase(),
      );
      if (f) return String(f.id);
    } catch { /* pas trouvé */ }
  }
  return null;
}

const bustCache = new Map();
async function getBustUrl(robloxId) {
  const hit = bustCache.get(robloxId);
  if (hit && Date.now() - hit.at < 3600_000) return hit.url;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(
        `https://thumbnails.roblox.com/v1/users/avatar-bust?userIds=${robloxId}&size=420x420&format=Png&isCircular=false`,
        { signal: AbortSignal.timeout(5000) },
      );
      const d = (await r.json()).data?.[0];
      if (d?.state === 'Completed' && d.imageUrl) {
        bustCache.set(robloxId, { url: d.imageUrl, at: Date.now() });
        return d.imageUrl;
      }
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 1500));
  }
  return null;
}

async function fetchImage(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
  if (!r.ok) throw new Error(`image ${r.status}`);
  return loadImage(Buffer.from(await r.arrayBuffer()));
}

// ───────── IMAGE DE LA CARTE D'IDENTITÉ ─────────
const mrzClean = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]+/g, '<');

function mrzLines(row) {
  const [d, m, y] = row.naissance.split('/');
  const l1 = ('IDBEL' + row.card_number.replace('-', '')).padEnd(30, '<');
  const l2 = (`${y.slice(2)}${m}${d}<`).padEnd(15, '<') + row.pays_code;
  const l3 = `${mrzClean(row.nom)}<<${mrzClean(row.prenom)}`;
  return [l1, l2.padEnd(30, '<'), l3.padEnd(30, '<').slice(0, 30)];
}

const fmtDate = (iso, addYears = 0) => {
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() + addYears);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Brussels' });
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitFont(ctx, text, maxW, size, family) {
  let s = size;
  ctx.font = `${s}px ${family}`;
  while (ctx.measureText(text).width > maxW && s > 14) {
    s -= 1;
    ctx.font = `${s}px ${family}`;
  }
}

async function renderCard(row, user, member) {
  // Compte Roblox (mémorisé en base une fois trouvé)
  let rid = row.roblox_id || null;
  if (!rid) {
    rid = await resolveRobloxId(member, user);
    if (rid) {
      await db.execute({ sql: 'UPDATE identities SET roblox_id=? WHERE user_id=?', args: [rid, row.user_id] }).catch(() => {});
    }
  }
  const bust = rid ? await getBustUrl(rid) : null;
  let photo = null;
  for (const url of [bust, user.displayAvatarURL({ extension: 'png', size: 256 })]) {
    if (!url) continue;
    try { photo = await fetchImage(url); break; } catch { /* suivante */ }
  }

  const W = 1012, H = 638;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const REG = 'CardRegular, sans-serif';
  const BOLD = 'CardBold, sans-serif';

  // Fond
  roundRect(ctx, 0, 0, W, H, 34);
  ctx.clip();
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#dce8f7'); bg.addColorStop(0.5, '#f5f8fc'); bg.addColorStop(1, '#d3e1f3');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Motifs de sécurité
  ctx.strokeStyle = 'rgba(44,90,160,0.07)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 22; i++) { ctx.beginPath(); ctx.arc(760, 330, 60 + i * 22, 0, Math.PI * 2); ctx.stroke(); }
  for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.arc(120, 560, 40 + i * 20, 0, Math.PI * 2); ctx.stroke(); }

  // Bandeau du haut
  const hb = ctx.createLinearGradient(0, 0, W, 0);
  hb.addColorStop(0, '#14305e'); hb.addColorStop(1, '#2f62ab');
  ctx.fillStyle = hb;
  ctx.fillRect(0, 0, W, 112);
  ['#000000', '#fdda24', '#ef3340'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(36 + i * 14, 28, 14, 56); });

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.font = `16px ${REG}`;
  ctx.fillText('BRUXELLES ROLE-PLAY', 98, 44);
  ctx.font = `40px ${BOLD}`;
  ctx.fillText('CARTE D’IDENTITÉ', 98, 90);

  ctx.textAlign = 'right';
  fitFont(ctx, `NATIONALITÉ ${natAdj(row).toUpperCase()}`, 470, 24, BOLD);
  ctx.fillText(`NATIONALITÉ ${natAdj(row).toUpperCase()}`, W - 40, 52);
  ctx.font = `16px ${REG}`;
  ctx.fillText('IDENTITY CARD', W - 40, 88);
  ctx.textAlign = 'left';

  // Photo (buste du personnage Roblox)
  const px = 40, py = 140, pw = 270, ph = 345;
  ctx.save();
  roundRect(ctx, px, py, pw, ph, 18);
  ctx.clip();
  const pg = ctx.createLinearGradient(px, py, px, py + ph);
  pg.addColorStop(0, '#a9c4e8'); pg.addColorStop(1, '#e6eef9');
  ctx.fillStyle = pg;
  ctx.fillRect(px, py, pw, ph);
  if (photo) {
    const s = Math.max(pw / photo.width, ph / photo.height);
    const dw = photo.width * s, dh = photo.height * s;
    ctx.drawImage(photo, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh);
  }
  ctx.restore();
  roundRect(ctx, px, py, pw, ph, 18);
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#14305e';
  ctx.stroke();

  // Champs
  const field = (label, value, x, y, maxW) => {
    ctx.fillStyle = '#5b6b82';
    ctx.font = `15px ${REG}`;
    ctx.fillText(label, x, y);
    ctx.fillStyle = '#0f1f3a';
    fitFont(ctx, value, maxW, 32, BOLD);
    ctx.fillText(value, x, y + 36);
  };
  const c1 = 350, c2 = 650;
  field('NOM / SURNAME', row.nom.toUpperCase(), c1, 160, 620);
  field('PRÉNOM / GIVEN NAME', row.prenom, c1, 236, 620);
  field('NÉ(E) LE / DATE OF BIRTH', row.naissance, c1, 312, 270);
  field('NATIONALITÉ / NATIONALITY', `${natAdj(row)} (${row.pays_code})`, c2, 312, 330);
  field('LIEU DE NAISSANCE / PLACE OF BIRTH', row.ville, c1, 388, 270);
  field('N° DE CARTE / CARD NO.', row.card_number, c2, 388, 330);
  field('DÉLIVRÉE LE / ISSUED', fmtDate(row.reviewed_at), c1, 464, 270);
  field('VALABLE JUSQU’AU / EXPIRES', fmtDate(row.reviewed_at, 10), c2, 464, 330);

  // Zone de lecture automatique
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.fillRect(0, 520, W, 118);
  ctx.fillStyle = '#111111';
  ctx.font = '30px CardMono, monospace';
  const pitch = 31, x0 = (W - 30 * pitch) / 2;
  mrzLines(row).forEach((line, li) => {
    [...line].forEach((ch, idx) => ctx.fillText(ch, x0 + idx * pitch, 556 + li * 34));
  });

  return canvas.encode('png');
}

async function buildCardFile(row, user, member) {
  const buf = await renderCard(row, user, member);
  return new AttachmentBuilder(buf, { name: 'carte-identite.png' });
}

// ───────── MORT RP : suppression complète du personnage ─────────
// Ajoute ici chaque future table liée au personnage (permis, inventaire, véhicules...).
// Chaque table doit avoir une colonne user_id.
const CHARACTER_TABLES = ['identities', 'identity_history'];

async function wipeCharacter(uid) {
  for (const t of CHARACTER_TABLES) {
    await db.execute({ sql: `DELETE FROM ${t} WHERE user_id = ?`, args: [uid] });
  }
}

// ───────── COMMANDES ─────────
const commands = [
  new SlashCommandBuilder()
    .setName('panneau-identite')
    .setDescription('Envoie le panneau de création de carte d\'identité')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('personnage')
    .setDescription('Commandes de ton personnage RP')
    .addSubcommand((s) =>
      s.setName('afficher')
        .setDescription('Affiche la carte d\'identité d\'un personnage')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre (toi par défaut)'))),
  new SlashCommandBuilder()
    .setName('mort-rp')
    .setDescription('(Staff) Déclare la mort RP d\'un personnage')
    .addUserOption((o) => o.setName('membre').setDescription('Le joueur concerné').setRequired(true))
    .addStringOption((o) =>
      o.setName('raison').setDescription('Raison de la mort RP').setRequired(true).setMinLength(3).setMaxLength(500)),
].map((c) => c.toJSON());

async function onCommand(i) {
  await botLog(
    '⌨️ Commande exécutée',
    `**/${i.commandName}** par <@${i.user.id}> dans <#${i.channelId}>`,
  );

  if (i.commandName === 'panneau-identite') {
    await sendPanel();
    return i.reply({ content: `✅ Panneau envoyé dans <#${CFG.PANEL_CHANNEL}>.`, flags: EPH });
  }

  if (i.commandName === 'personnage' && i.options.getSubcommand() === 'afficher') {
    const target = i.options.getUser('membre') || i.user;
    const row = await getIdentity(target.id);
    if (!row || row.status !== 'approved') {
      return i.reply({
        content: target.id === i.user.id
          ? `❌ Tu n'as pas encore de carte d'identité. Fais ta demande dans <#${CFG.PANEL_CHANNEL}>.`
          : `❌ <@${target.id}> n'a pas de carte d'identité validée.`,
        flags: EPH,
      });
    }
    await i.deferReply();
    const member = await i.guild.members.fetch(target.id).catch(() => null);
    const file = await buildCardFile(row, target, member);
    const embed = mkEmbed(0x3b6ea5)
      .setTitle(`🪪 Carte d'identité — Nationalité ${natAdj(row).toLowerCase()}`)
      .setDescription(`👤 **Titulaire :** <@${row.user_id}>`)
      .setImage('attachment://carte-identite.png');
    return i.editReply({ embeds: [embed], files: [file] });
  }

  if (i.commandName === 'mort-rp') {
    if (!isStaff(i)) return i.reply({ content: '❌ Réservé au staff.', flags: EPH });
    const target = i.options.getUser('membre', true);
    const reason = i.options.getString('raison', true).trim();
    if (target.bot) return i.reply({ content: '❌ Tu ne peux pas cibler un bot.', flags: EPH });

    await i.deferReply({ flags: EPH });
    const row = await getIdentity(target.id);
    const member = await i.guild.members.fetch(target.id).catch(() => null);
    if (!row && !member?.roles.cache.has(CFG.ROLE_ADD))
      return i.editReply({ content: `❌ <@${target.id}> n'a aucun personnage.` });

    // Rôles : il perd le rôle civil et redevient sans papier
    let roleOk = true;
    if (member) {
      try {
        await member.roles.remove(CFG.ROLE_ADD);
        await member.roles.add(CFG.ROLE_REMOVE);
      } catch (e) {
        roleOk = false;
        await botLog('❌ Erreur rôles', `Mort RP : impossible de modifier les rôles de <@${target.id}> : ${e.message}`, 0xed4245);
      }
    } else {
      roleOk = false; // le joueur n'est plus sur le serveur
    }

    // Suppression de toutes les données du personnage
    await wipeCharacter(target.id);
    await db.execute({
      sql: 'INSERT INTO character_deaths (user_id, staff_id, reason, at) VALUES (?,?,?,?)',
      args: [target.id, i.user.id, reason, new Date().toISOString()],
    });

    const identity = row
      ? `${row.prenom} ${row.nom} • ${row.naissance} • ${row.ville} • ${row.nationalite} (${row.pays_code})`
      : null;

    const dmOk = await dm(target.id, mkEmbed(0x8b0000)
      .setTitle('☠️ Ton personnage est mort')
      .setDescription(
        (row ? `Le staff a déclaré la **mort RP** de **${row.prenom} ${row.nom}**.\n\n` : 'Le staff a déclaré la **mort RP** de ton personnage.\n\n') +
        '1️⃣ Tes papiers, ton permis, ton inventaire et toutes les données de ton personnage sont **supprimés**.\n' +
        '2️⃣ Tu repasses **sans papier**.\n' +
        `3️⃣ Pour rejouer, crée un nouveau personnage depuis le panneau : <#${CFG.PANEL_CHANNEL}>.\n\n` +
        '⚠️ Cette décision est **définitive**.',
      )
      .addFields({ name: '📝 Raison', value: reason }));

    await sendTo(CFG.BOT_LOG_CHANNEL, mkEmbed(0x8b0000).setTitle('☠️ Mort RP').addFields(
      { name: '👤 Joueur', value: `<@${target.id}>`, inline: true },
      { name: '🛡️ Staff', value: `<@${i.user.id}>`, inline: true },
      { name: '🪪 Personnage supprimé', value: identity || 'Aucune identité enregistrée' },
      { name: '📝 Raison', value: reason },
      { name: '🎭 Rôles', value: roleOk ? 'Mis à jour ✅' : 'Échec ❌', inline: true },
      { name: '📩 MP', value: dmOk ? 'Envoyé ✅' : 'Échec ❌', inline: true },
    ));

    return i.editReply({
      content:
        `☠️ **Mort RP appliquée** pour <@${target.id}>.\n` +
        '🗑️ Données du personnage supprimées\n' +
        `🎭 Rôles : ${roleOk ? 'mis à jour ✅' : 'échec ❌ (vérifie la hiérarchie des rôles ou si le joueur est encore sur le serveur)'}\n` +
        `📩 MP : ${dmOk ? 'envoyé ✅' : 'échec ❌ (MP fermés)'}`,
    });
  }
}

// ───────── CRÉATION D'IDENTITÉ ─────────
async function onOpen(i) {
  const row = await getIdentity(i.user.id);
  if (row?.status === 'approved')
    return i.reply({ content: '✅ Tu as déjà une carte d\'identité (`/personnage afficher`).', flags: EPH });
  if (row?.status === 'pending')
    return i.reply({ content: '⏳ Ta demande est déjà en cours de vérification.', flags: EPH });

  const input = (id, label, ph) =>
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(ph)
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40),
    );
  const modal = new ModalBuilder().setCustomId('id_modal').setTitle('Création de ta carte d\'identité').addComponents(
    input('nom', 'Nom', 'Ex : Dupont'),
    input('prenom', 'Prénom', 'Ex : Jean'),
    input('naissance', 'Date de naissance', 'JJ/MM/AAAA'),
    input('ville', 'Ville de naissance', 'Ex : Bruxelles'),
    input('nationalite', 'Nationalité', 'Ex : Belge ou Belgique'),
  );
  return i.showModal(modal);
}

async function onSubmit(i) {
  await i.deferReply({ flags: EPH });
  const g = (k) => i.fields.getTextInputValue(k).trim();
  const raw = { nom: g('nom'), prenom: g('prenom'), ville: g('ville'), nationalite: g('nationalite') };
  const date = parseDate(g('naissance'));
  const country = findCountry(raw.nationalite);

  const errors = [];
  if (!NAME_RE.test(raw.nom)) errors.push('Nom invalide (lettres uniquement, 2 à 30 caractères).');
  if (!NAME_RE.test(raw.prenom)) errors.push('Prénom invalide (lettres uniquement, 2 à 30 caractères).');
  if (!date) errors.push('Date invalide : utilise le format JJ/MM/AAAA (date réelle et passée).');
  if (!raw.ville || raw.ville.length < 2) errors.push('Ville de naissance invalide.');
  if (!country) errors.push('Nationalité non reconnue : écris le nom du pays (ex : France, Belgique, Maroc...).');
  if (errors.length)
    return i.editReply({ content: '❌ Ta demande n\'a pas pu être envoyée :\n' + errors.map((e) => `• ${e}`).join('\n') + '\n\n🔁 Reclique sur le bouton pour recommencer.' });

  const existing = await getIdentity(i.user.id);
  if (existing && existing.status !== 'refused')
    return i.editReply({ content: '❌ Tu as déjà une demande en cours ou une carte validée.' });

  const flags = checkSuspicious(raw, date);
  const data = {
    nom: raw.nom.toUpperCase(),
    prenom: cap(raw.prenom),
    naissance: date.str,
    ville: cap(raw.ville),
    nationalite: country.adj,
    pays_code: country.code,
  };

  await db.execute({
    sql: `INSERT INTO identities (user_id, nom, prenom, naissance, ville, nationalite, pays_code, status, suspicious, flags, created_at)
          VALUES (?,?,?,?,?,?,?, 'pending', ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            nom=excluded.nom, prenom=excluded.prenom, naissance=excluded.naissance, ville=excluded.ville,
            nationalite=excluded.nationalite, pays_code=excluded.pays_code, status='pending',
            suspicious=excluded.suspicious, flags=excluded.flags, created_at=excluded.created_at,
            card_number=NULL, refuse_reason=NULL, reviewed_by=NULL, reviewed_at=NULL, request_message_id=NULL`,
    args: [i.user.id, data.nom, data.prenom, data.naissance, data.ville, data.nationalite, data.pays_code,
      flags.length ? 1 : 0, JSON.stringify(flags), new Date().toISOString()],
  });
  await addHistory(i.user.id, 'submitted', null, flags.length ? 'suspicious' : null);

  const row = await getIdentity(i.user.id);
  const msg = await (async () => {
    try {
      const ch = await client.channels.fetch(CFG.REQUEST_CHANNEL);
      return await ch.send({ embeds: [requestEmbed(row, flags, i.user.tag)], components: [staffButtons(i.user.id)] });
    } catch (e) {
      console.error(e);
      return null;
    }
  })();
  if (msg) await db.execute({ sql: 'UPDATE identities SET request_message_id=? WHERE user_id=?', args: [msg.id, i.user.id] });

  await dm(i.user.id, mkEmbed(0xf1c40f)
    .setTitle('⏳ Demande prise en compte')
    .setDescription(
      'Ta demande de carte d\'identité a bien été reçue !\n\n' +
      '1️⃣ Le staff vérifie tes informations.\n' +
      '2️⃣ Tu reçois la décision par **MP**.\n' +
      '3️⃣ Si elle est validée, tu reçois ta **carte** et ton rôle.\n\n' +
      '📋 Voici le récapitulatif de ta demande :',
    )
    .addFields(identityFields(row)));

  return i.editReply({ content: msg ? '✅ Demande envoyée ! Tu as reçu un MP de confirmation.' : '⚠️ Demande enregistrée mais le salon staff est inaccessible, préviens un administrateur.' });
}

// ───────── VALIDATION STAFF ─────────
async function onAccept(i, uid) {
  if (!isStaff(i)) return i.reply({ content: '❌ Réservé au staff.', flags: EPH });
  const row = await getIdentity(uid);
  if (!row || row.status !== 'pending')
    return i.reply({ content: '⚠️ Cette demande a déjà été traitée.', flags: EPH });
  await i.deferUpdate();

  const cardNumber = await genCardNumber();
  await db.execute({
    sql: `UPDATE identities SET status='approved', card_number=?, reviewed_by=?, reviewed_at=? WHERE user_id=? AND status='pending'`,
    args: [cardNumber, i.user.id, new Date().toISOString(), uid],
  });
  await addHistory(uid, 'approved', i.user.id, null);
  const done = await getIdentity(uid);

  let roleOk = true;
  let member = null;
  try {
    member = await i.guild.members.fetch(uid);
    await member.roles.remove(CFG.ROLE_REMOVE);
    await member.roles.add(CFG.ROLE_ADD);
  } catch (e) {
    roleOk = false;
    await botLog('❌ Erreur rôles', `Impossible de modifier les rôles de <@${uid}> : ${e.message}`, 0xed4245);
  }

  // MP : la carte en image
  const intro = '✅ Ta demande a été **validée** par le staff !\n🎉 Voici ta carte d\'identité, ton rôle a été mis à jour.';
  let dmOk;
  try {
    const user = member?.user || (await client.users.fetch(uid));
    const file = await buildCardFile(done, user, member);
    dmOk = await dm(uid, mkEmbed(0x2ecc71)
      .setTitle(`✅ Identité validée — Nationalité ${natAdj(done).toLowerCase()}`)
      .setDescription(`${intro}\n\n🔢 **N° de carte :** \`${cardNumber}\``)
      .setImage('attachment://carte-identite.png'), [file]);
  } catch (e) {
    await botLog('❌ Carte image impossible', `Génération de la carte de <@${uid}> : ${e.message}`, 0xed4245);
    dmOk = await dm(uid, cardEmbed(done, intro).setTitle('✅ Identité validée — Bruxelles Role-Play'));
  }

  await i.editReply({
    embeds: [requestEmbed(done, JSON.parse(done.flags || '[]'), `<@${uid}>`)
      .setColor(0x2ecc71).addFields({ name: '✅ Validée', value: `Par <@${i.user.id}> • Carte \`${cardNumber}\`` })],
    components: [staffButtons(uid, true)],
  });

  await cardLog(mkEmbed(0x2ecc71).setTitle('✅ Carte validée').addFields(
    { name: '👤 Membre', value: `<@${uid}>`, inline: true },
    { name: '🛡️ Staff', value: `<@${i.user.id}>`, inline: true },
    { name: '🔢 N° carte', value: `\`${cardNumber}\``, inline: true },
    { name: '🪪 Identité', value: `${done.prenom} ${done.nom} • ${done.naissance} • ${done.ville} • ${done.nationalite} (${done.pays_code})` },
    { name: '🚨 Suspect', value: done.suspicious ? 'Oui ⚠️' : 'Non', inline: true },
    { name: '🎭 Rôles', value: roleOk ? 'Mis à jour ✅' : 'Échec ❌', inline: true },
    { name: '📩 MP', value: dmOk ? 'Envoyé ✅' : 'Échec ❌', inline: true },
  ));
}

async function onRefuseBtn(i, uid) {
  if (!isStaff(i)) return i.reply({ content: '❌ Réservé au staff.', flags: EPH });
  const row = await getIdentity(uid);
  if (!row || row.status !== 'pending')
    return i.reply({ content: '⚠️ Cette demande a déjà été traitée.', flags: EPH });
  const modal = new ModalBuilder().setCustomId(`id_refuse_modal:${uid}`).setTitle('Raison du refus').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('Raison du refus')
        .setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(3).setMaxLength(500),
    ),
  );
  return i.showModal(modal);
}

async function onRefuseSubmit(i, uid) {
  if (!isStaff(i)) return i.reply({ content: '❌ Réservé au staff.', flags: EPH });
  const row = await getIdentity(uid);
  if (!row || row.status !== 'pending')
    return i.reply({ content: '⚠️ Cette demande a déjà été traitée.', flags: EPH });
  await i.deferUpdate();
  const reason = i.fields.getTextInputValue('reason').trim();

  await db.execute({
    sql: `UPDATE identities SET status='refused', refuse_reason=?, reviewed_by=?, reviewed_at=? WHERE user_id=? AND status='pending'`,
    args: [reason, i.user.id, new Date().toISOString(), uid],
  });
  await addHistory(uid, 'refused', i.user.id, reason);

  const dmOk = await dm(uid, mkEmbed(0xe74c3c)
    .setTitle('❌ Demande refusée')
    .setDescription(
      'Ta demande de carte d\'identité a été **refusée** par le staff.\n\n' +
      '1️⃣ Lis la raison du refus ci-dessous.\n' +
      '2️⃣ Corrige les informations concernées.\n' +
      `3️⃣ Refais une demande depuis le panneau : <#${CFG.PANEL_CHANNEL}>.\n\n` +
      '⚠️ Aucun rôle n\'a été modifié.',
    )
    .addFields({ name: '📝 Raison du refus', value: reason }));

  await i.editReply({
    embeds: [requestEmbed(row, JSON.parse(row.flags || '[]'), `<@${uid}>`)
      .setColor(0xe74c3c).addFields({ name: '❌ Refusée', value: `Par <@${i.user.id}>\nRaison : ${reason}` })],
    components: [staffButtons(uid, true)],
  });

  await cardLog(mkEmbed(0xe74c3c).setTitle('❌ Carte refusée').addFields(
    { name: '👤 Membre', value: `<@${uid}>`, inline: true },
    { name: '🛡️ Staff', value: `<@${i.user.id}>`, inline: true },
    { name: '🪪 Identité', value: `${row.prenom} ${row.nom} • ${row.naissance} • ${row.ville} • ${row.nationalite} (${row.pays_code})` },
    { name: '📝 Raison', value: reason },
    { name: '🚨 Suspect', value: row.suspicious ? 'Oui ⚠️' : 'Non', inline: true },
    { name: '📩 MP', value: dmOk ? 'Envoyé ✅' : 'Échec ❌', inline: true },
  ));
}

// ───────── ROUTEUR ─────────
client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isChatInputCommand()) return await onCommand(i);
    if (i.isButton()) {
      if (i.customId === 'id_open') return await onOpen(i);
      if (i.customId.startsWith('id_accept:')) return await onAccept(i, i.customId.split(':')[1]);
      if (i.customId.startsWith('id_refuse:')) return await onRefuseBtn(i, i.customId.split(':')[1]);
    }
    if (i.isModalSubmit()) {
      if (i.customId === 'id_modal') return await onSubmit(i);
      if (i.customId.startsWith('id_refuse_modal:')) return await onRefuseSubmit(i, i.customId.split(':')[1]);
    }
  } catch (e) {
    console.error(e);
    await botLog('❌ Erreur', `\`${e.message}\`\nInteraction : ${i.customId || i.commandName} par <@${i.user.id}>`, 0xed4245);
    const p = { content: '❌ Une erreur est survenue.', flags: EPH };
    if (i.isRepliable()) (i.deferred || i.replied ? i.followUp(p) : i.reply(p)).catch(() => {});
  }
});

client.once(Events.ClientReady, async () => {
  await initDb();
  await client.application.commands.set(commands);
  await ensurePanel();
  console.log(`Connecté en tant que ${client.user.tag}`);
  await botLog('🟢 Bot démarré', `Connecté en tant que **${client.user.tag}**.`, 0x2ecc71);
});

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));

// ───────── KEEP-ALIVE (UptimeRobot) ─────────
http.createServer((req, res) => { res.writeHead(200); res.end('Bruxelles RP ID bot OK'); })
  .listen(process.env.PORT || 3000);

client.login(process.env.DISCORD_TOKEN);
