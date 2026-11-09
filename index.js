const {
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder, PermissionFlagsBits,
  Events, MessageFlags, AttachmentBuilder, Routes,
} = require('discord.js');
const { createClient } = require('@libsql/client');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

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

// ───────── SERVEUR HTTP (démarre en premier pour que Render détecte le port) ─────────
// "/"       → toujours 200 (garde Render éveillé)
// "/health" → 200 seulement si le bot est vraiment connecté à Discord (à mettre dans UptimeRobot)
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    const ok = client.isReady();
    res.writeHead(ok ? 200 : 503);
    return res.end(ok ? 'ok' : 'bot down');
  }
  res.writeHead(200);
  res.end('Bruxelles RP ID bot OK');
});
server.listen(process.env.PORT || 3000, '0.0.0.0');

// ───────── POLICES DE LA CARTE ─────────
const fontFile = (pkg, file) => path.join(__dirname, 'node_modules', '@fontsource', pkg, 'files', file);
[
  [fontFile('inter', 'inter-latin-400-normal.woff'), 'CardRegular'],
  [fontFile('inter', 'inter-latin-700-normal.woff'), 'CardBold'],
  [fontFile('ibm-plex-mono', 'ibm-plex-mono-latin-500-normal.woff'), 'CardMono'],
  [fontFile('great-vibes', 'great-vibes-latin-400-normal.woff'), 'CardSign'],
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
  await db.execute('ALTER TABLE identities ADD COLUMN sexe TEXT').catch(() => {});      // déjà présente ? ok
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

// ───────── PAYS : code, nationalité, drapeau, nom officiel ─────────
// CODE|noms de pays (sans accents)|débuts de nationalité (sans accents)|adjectif féminin|code ISO2 (drapeau)|nom officiel
const COUNTRIES = `AFG|afghanistan|afghan|Afghane|af|Afghanistan
ZAF|afrique du sud|sud africain|Sud-africaine|za|République sud-africaine
ALB|albanie|albanais|Albanaise|al|République d'Albanie
DZA|algerie|algerien|Algérienne|dz|République algérienne
DEU|allemagne|allemand|Allemande|de|République fédérale d'Allemagne
AND|andorre|andorran|Andorrane|ad|Principauté d'Andorre
AGO|angola|angolais|Angolaise|ao|République d'Angola
ATG|antigua et barbuda|antiguayen|Antiguayenne|ag|Antigua-et-Barbuda
SAU|arabie saoudite|saoudien|Saoudienne|sa|Royaume d'Arabie saoudite
ARG|argentine|argentin|Argentine|ar|République argentine
ARM|armenie|armenien|Arménienne|am|République d'Arménie
AUS|australie|australien|Australienne|au|Australie
AUT|autriche|autrichien|Autrichienne|at|République d'Autriche
AZE|azerbaidjan|azerbaidjanais,azeri|Azerbaïdjanaise|az|République d'Azerbaïdjan
BHS|bahamas|bahameen|Bahaméenne|bs|Commonwealth des Bahamas
BHR|bahrein|bahreini|Bahreïnienne|bh|Royaume de Bahreïn
BGD|bangladesh|bangladais|Bangladaise|bd|République populaire du Bangladesh
BRB|barbade|barbadien|Barbadienne|bb|Barbade
BEL|belgique|belge|Belge|be|Royaume de Belgique
BLZ|belize|belizien|Bélizienne|bz|Belize
BEN|benin|beninois|Béninoise|bj|République du Bénin
BTN|bhoutan|bhoutanais|Bhoutanaise|bt|Royaume du Bhoutan
BLR|bielorussie,belarus|bielorusse|Biélorusse|by|République de Biélorussie
MMR|birmanie,myanmar|birman|Birmane|mm|Myanmar
BOL|bolivie|bolivien|Bolivienne|bo|État plurinational de Bolivie
BIH|bosnie herzegovine,bosnie|bosnien|Bosnienne|ba|Bosnie-Herzégovine
BWA|botswana|botswanais|Botswanaise|bw|République du Botswana
BRA|bresil|bresilien|Brésilienne|br|République fédérative du Brésil
BRN|brunei|bruneien|Brunéienne|bn|Brunéi Darussalam
BGR|bulgarie|bulgare|Bulgare|bg|République de Bulgarie
BFA|burkina faso|burkinabe|Burkinabée|bf|Burkina Faso
BDI|burundi|burundais|Burundaise|bi|République du Burundi
KHM|cambodge|cambodgien|Cambodgienne|kh|Royaume du Cambodge
CMR|cameroun|camerounais|Camerounaise|cm|République du Cameroun
CAN|canada|canadien|Canadienne|ca|Canada
CPV|cap vert|cap verdien|Cap-verdienne|cv|République du Cap-Vert
CHL|chili|chilien|Chilienne|cl|République du Chili
CHN|chine|chinois|Chinoise|cn|République populaire de Chine
CYP|chypre|chypriote|Chypriote|cy|République de Chypre
COL|colombie|colombien|Colombienne|co|République de Colombie
COM|comores|comorien|Comorienne|km|Union des Comores
COG|congo,republique du congo,congo brazzaville||Congolaise|cg|République du Congo
COD|rd congo,republique democratique du congo,congo kinshasa||Congolaise (RDC)|cd|République démocratique du Congo
PRK|coree du nord|nord coreen|Nord-coréenne|kp|République populaire démocratique de Corée
KOR|coree du sud,coree|sud coreen,coreen|Sud-coréenne|kr|République de Corée
CRI|costa rica|costaricien,costa ricien|Costaricienne|cr|République du Costa Rica
CIV|cote d ivoire|ivoirien|Ivoirienne|ci|République de Côte d'Ivoire
HRV|croatie|croate|Croate|hr|République de Croatie
CUB|cuba|cubain|Cubaine|cu|République de Cuba
DNK|danemark|danois|Danoise|dk|Royaume du Danemark
DJI|djibouti|djiboutien|Djiboutienne|dj|République de Djibouti
DMA|dominique|dominiquais|Dominiquaise|dm|Commonwealth de la Dominique
EGY|egypte|egyptien|Égyptienne|eg|République arabe d'Égypte
ARE|emirats arabes unis|emirien,emirati|Émiratie|ae|Émirats arabes unis
ECU|equateur|equatorien|Équatorienne|ec|République de l'Équateur
ERI|erythree|erythreen|Érythréenne|er|État d'Érythrée
ESP|espagne|espagnol|Espagnole|es|Royaume d'Espagne
EST|estonie|estonien|Estonienne|ee|République d'Estonie
SWZ|eswatini,swaziland|swazi|Swazie|sz|Royaume d'Eswatini
USA|etats unis,usa,etats unis d amerique,us|americain|Américaine|us|États-Unis d'Amérique
ETH|ethiopie|ethiopien|Éthiopienne|et|République d'Éthiopie
FJI|fidji|fidjien|Fidjienne|fj|République des Fidji
FIN|finlande|finlandais|Finlandaise|fi|République de Finlande
FRA|france|francais|Française|fr|République française
GAB|gabon|gabonais|Gabonaise|ga|République gabonaise
GMB|gambie|gambien|Gambienne|gm|République de Gambie
GEO|georgie|georgien|Géorgienne|ge|Géorgie
GHA|ghana|ghaneen|Ghanéenne|gh|République du Ghana
GRC|grece|grec,grecq|Grecque|gr|République hellénique
GRD|grenade|grenadien|Grenadienne|gd|Grenade
GTM|guatemala|guatemalteque|Guatémaltèque|gt|République du Guatemala
GIN|guinee|guineen|Guinéenne|gn|République de Guinée
GNB|guinee bissau|bissau guineen|Bissau-guinéenne|gw|République de Guinée-Bissau
GNQ|guinee equatoriale|equato guineen|Équato-guinéenne|gq|République de Guinée équatoriale
GUY|guyana|guyanien|Guyanienne|gy|République coopérative du Guyana
HTI|haiti|haitien|Haïtienne|ht|République d'Haïti
HND|honduras|hondurien|Hondurienne|hn|République du Honduras
HUN|hongrie|hongrois|Hongroise|hu|Hongrie
MHL|iles marshall|marshallais|Marshallaise|mh|République des Îles Marshall
SLB|iles salomon|salomonais|Salomonaise|sb|Îles Salomon
IND|inde|indien|Indienne|in|République de l'Inde
IDN|indonesie|indonesien|Indonésienne|id|République d'Indonésie
IRQ|irak|irakien|Irakienne|iq|République d'Irak
IRN|iran|iranien|Iranienne|ir|République islamique d'Iran
IRL|irlande|irlandais|Irlandaise|ie|Irlande
ISL|islande|islandais|Islandaise|is|République d'Islande
ISR|israel|israelien|Israélienne|il|État d'Israël
ITA|italie|italien|Italienne|it|République italienne
JAM|jamaique|jamaicain|Jamaïcaine|jm|Jamaïque
JPN|japon|japonais|Japonaise|jp|Japon
JOR|jordanie|jordanien|Jordanienne|jo|Royaume hachémite de Jordanie
KAZ|kazakhstan|kazakh|Kazakhe|kz|République du Kazakhstan
KEN|kenya|kenyan|Kényane|ke|République du Kenya
KGZ|kirghizistan|kirghize|Kirghize|kg|République kirghize
KIR|kiribati|kiribatien|Kiribatienne|ki|République de Kiribati
XKX|kosovo|kosovar|Kosovare|xk|République du Kosovo
KWT|koweit|koweitien|Koweïtienne|kw|État du Koweït
LAO|laos|laotien|Laotienne|la|République démocratique populaire lao
LSO|lesotho|lesothan|Lesothane|ls|Royaume du Lesotho
LVA|lettonie|letton|Lettone|lv|République de Lettonie
LBN|liban|libanais|Libanaise|lb|République libanaise
LBR|liberia|liberien|Libérienne|lr|République du Libéria
LBY|libye|libyen|Libyenne|ly|État de Libye
LIE|liechtenstein|liechtensteinois|Liechtensteinoise|li|Principauté de Liechtenstein
LTU|lituanie|lituanien|Lituanienne|lt|République de Lituanie
LUX|luxembourg|luxembourgeois|Luxembourgeoise|lu|Grand-Duché de Luxembourg
MKD|macedoine du nord,macedoine|macedonien|Macédonienne|mk|République de Macédoine du Nord
MDG|madagascar|malgache|Malgache|mg|République de Madagascar
MYS|malaisie|malaisien|Malaisienne|my|Malaisie
MWI|malawi|malawite|Malawite|mw|République du Malawi
MDV|maldives|maldivien|Maldivienne|mv|République des Maldives
MLI|mali|malien|Malienne|ml|République du Mali
MLT|malte|maltais|Maltaise|mt|République de Malte
MAR|maroc|marocain|Marocaine|ma|Royaume du Maroc
MUS|maurice|mauricien|Mauricienne|mu|République de Maurice
MRT|mauritanie|mauritanien|Mauritanienne|mr|République islamique de Mauritanie
MEX|mexique|mexicain|Mexicaine|mx|États-Unis mexicains
FSM|micronesie|micronesien|Micronésienne|fm|États fédérés de Micronésie
MDA|moldavie|moldave|Moldave|md|République de Moldavie
MCO|monaco|monegasque|Monégasque|mc|Principauté de Monaco
MNG|mongolie|mongol|Mongole|mn|Mongolie
MNE|montenegro|montenegrin|Monténégrine|me|Monténégro
MOZ|mozambique|mozambicain|Mozambicaine|mz|République du Mozambique
NAM|namibie|namibien|Namibienne|na|République de Namibie
NRU|nauru|nauruan|Nauruane|nr|République de Nauru
NPL|nepal|nepalais|Népalaise|np|République du Népal
NIC|nicaragua|nicaraguayen|Nicaraguayenne|ni|République du Nicaragua
NER|niger|nigerien|Nigérienne|ne|République du Niger
NGA|nigeria|nigerian|Nigériane|ng|République fédérale du Nigéria
NOR|norvege|norvegien|Norvégienne|no|Royaume de Norvège
NZL|nouvelle zelande|neo zelandais|Néo-zélandaise|nz|Nouvelle-Zélande
OMN|oman|omanais|Omanaise|om|Sultanat d'Oman
UGA|ouganda|ougandais|Ougandaise|ug|République de l'Ouganda
UZB|ouzbekistan|ouzbek|Ouzbèke|uz|République d'Ouzbékistan
PAK|pakistan|pakistanais|Pakistanaise|pk|République islamique du Pakistan
PLW|palaos|palaosien|Palaosienne|pw|République des Palaos
PSE|palestine|palestinien|Palestinienne|ps|État de Palestine
PAN|panama|panameen|Panaméenne|pa|République du Panama
PNG|papouasie nouvelle guinee|papou|Papouane|pg|Papouasie-Nouvelle-Guinée
PRY|paraguay|paraguayen|Paraguayenne|py|République du Paraguay
NLD|pays bas,hollande|neerlandais,hollandais|Néerlandaise|nl|Royaume des Pays-Bas
PER|perou|peruvien|Péruvienne|pe|République du Pérou
PHL|philippines|philippin|Philippine|ph|République des Philippines
POL|pologne|polonais|Polonaise|pl|République de Pologne
PRT|portugal|portugais|Portugaise|pt|République portugaise
QAT|qatar|qatarien|Qatarienne|qa|État du Qatar
CAF|republique centrafricaine,centrafrique|centrafricain|Centrafricaine|cf|République centrafricaine
DOM|republique dominicaine|dominicain|Dominicaine|do|République dominicaine
CZE|tchequie,republique tcheque|tcheque|Tchèque|cz|République tchèque
ROU|roumanie|roumain|Roumaine|ro|Roumanie
GBR|royaume uni,angleterre,grande bretagne,ecosse,pays de galles|britannique,anglais,ecossais,gallois|Britannique|gb|Royaume-Uni
RUS|russie|russe|Russe|ru|Fédération de Russie
RWA|rwanda|rwandais|Rwandaise|rw|République du Rwanda
KNA|saint christophe et nieves|kittitien|Kittitienne|kn|Saint-Christophe-et-Niévès
LCA|sainte lucie|saint lucien|Saint-lucienne|lc|Sainte-Lucie
SMR|saint marin|saint marinais|Saint-marinaise|sm|République de Saint-Marin
VCT|saint vincent et les grenadines|vincentais|Vincentaise|vc|Saint-Vincent-et-les-Grenadines
SLV|salvador,el salvador|salvadorien|Salvadorienne|sv|République du Salvador
WSM|samoa|samoan|Samoane|ws|État indépendant du Samoa
STP|sao tome et principe|santomeen|Santoméenne|st|République de Sao Tomé-et-Principe
SEN|senegal|senegalais|Sénégalaise|sn|République du Sénégal
SRB|serbie|serbe|Serbe|rs|République de Serbie
SYC|seychelles|seychellois|Seychelloise|sc|République des Seychelles
SLE|sierra leone|sierra leonais|Sierra-léonaise|sl|République de Sierra Leone
SGP|singapour|singapourien|Singapourienne|sg|République de Singapour
SVK|slovaquie|slovaque|Slovaque|sk|République slovaque
SVN|slovenie|slovene|Slovène|si|République de Slovénie
SOM|somalie|somalien|Somalienne|so|République fédérale de Somalie
SDN|soudan|soudanais|Soudanaise|sd|République du Soudan
SSD|soudan du sud|sud soudanais|Sud-soudanaise|ss|République du Soudan du Sud
LKA|sri lanka|sri lankais|Sri-lankaise|lk|République de Sri Lanka
SWE|suede|suedois|Suédoise|se|Royaume de Suède
CHE|suisse|suisse|Suisse|ch|Confédération suisse
SUR|suriname|surinamien|Surinamienne|sr|République du Suriname
SYR|syrie|syrien|Syrienne|sy|République arabe syrienne
TJK|tadjikistan|tadjik|Tadjike|tj|République du Tadjikistan
TWN|taiwan|taiwanais|Taïwanaise|tw|Taïwan
TZA|tanzanie|tanzanien|Tanzanienne|tz|République unie de Tanzanie
TCD|tchad|tchadien|Tchadienne|td|République du Tchad
THA|thailande|thailandais|Thaïlandaise|th|Royaume de Thaïlande
TLS|timor oriental|timorais|Timoraise|tl|République démocratique du Timor oriental
TGO|togo|togolais|Togolaise|tg|République togolaise
TON|tonga|tongien|Tongienne|to|Royaume des Tonga
TTO|trinite et tobago|trinidadien|Trinidadienne|tt|République de Trinité-et-Tobago
TUN|tunisie|tunisien|Tunisienne|tn|République tunisienne
TKM|turkmenistan|turkmene|Turkmène|tm|Turkménistan
TUR|turquie|turc,turq|Turque|tr|République de Turquie
TUV|tuvalu|tuvaluan|Tuvaluane|tv|Tuvalu
UKR|ukraine|ukrainien|Ukrainienne|ua|Ukraine
URY|uruguay|uruguayen|Uruguayenne|uy|République orientale de l'Uruguay
VUT|vanuatu|vanuatais|Vanuatuane|vu|République de Vanuatu
VAT|vatican,saint siege||Vaticane|va|État de la Cité du Vatican
VEN|venezuela|venezuelien|Vénézuélienne|ve|République bolivarienne du Venezuela
VNM|vietnam,viet nam|vietnamien|Vietnamienne|vn|République socialiste du Viêt Nam
YEM|yemen|yemenite|Yéménite|ye|République du Yémen
ZMB|zambie|zambien|Zambienne|zm|République de Zambie
ZWE|zimbabwe|zimbabween|Zimbabwéenne|zw|République du Zimbabwe`
  .split('\n')
  .map((l) => {
    const [code, names, stems, adj, iso2, officiel] = l.split('|');
    return { code, names: names.split(','), stems: stems ? stems.split(',').filter(Boolean) : [], adj, iso2, officiel };
  });

const norm = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function findCountry(input) {
  const n = norm(input);
  return COUNTRIES.find((c) => c.names.includes(n) || c.stems.some((s) => n.startsWith(s))) || null;
}
const countryOf = (row) => COUNTRIES.find((c) => c.code === row.pays_code) || null;
const natAdj = (row) => countryOf(row)?.adj || row.nationalite;

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
const sexLabel = (s) => (s === 'M' ? 'Masculin' : s === 'F' ? 'Féminin' : '—');

// Identité en 2 colonnes, sans surcharge
function identityFields(row) {
  return [
    {
      name: '🧑 Identité',
      value: `**Nom :** ${row.nom}\n**Prénom :** ${row.prenom}\n**Sexe :** ${sexLabel(row.sexe)}`,
      inline: true,
    },
    {
      name: '🎂 Naissance',
      value: `**Né(e) le :** ${row.naissance}\n**Lieu :** ${row.ville}\n**Nationalité :** ${row.nationalite} (${row.pays_code})`,
      inline: true,
    },
  ];
}

const summary = (row) =>
  `${row.prenom} ${row.nom} (${sexLabel(row.sexe)}) • ${row.naissance} • ${row.ville} • ${row.nationalite} (${row.pays_code})`;

// Version texte (secours si l'image ne peut pas être générée)
function cardEmbed(row, intro) {
  return mkEmbed(0x2ecc71)
    .setTitle('🪪 Carte d’identité')
    .setDescription(`${intro ? intro + '\n\n' : ''}🔢 **N° de carte :** \`${row.card_number}\``)
    .addFields(identityFields(row));
}

function requestEmbed(row, flags) {
  const susp = flags.length > 0;
  const e = mkEmbed(susp ? 0xe74c3c : 0xf1c40f)
    .setTitle(susp ? '🚨 Demande d’identité — éléments suspects' : '🪪 Nouvelle demande d’identité')
    .setDescription(
      `**Demandeur :** <@${row.user_id}>  •  \`${row.user_id}\`` +
      (susp ? '\n⚠️ Des éléments suspects ont été détectés, vérifie avec attention.' : ''),
    )
    .addFields(identityFields(row));
  if (susp) {
    e.addFields({
      name: '⚠️ Détections',
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
        '2️⃣ Choisis le **sexe** de ton personnage, puis remplis le formulaire : **nom, prénom, date de naissance, ville de naissance et nationalité**.\n' +
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

// Drapeau du pays (image mise en cache)
const flagCache = new Map();
async function getFlag(iso2) {
  if (flagCache.has(iso2)) return flagCache.get(iso2);
  try {
    const img = await fetchImage(`https://flagcdn.com/w320/${iso2}.png`);
    flagCache.set(iso2, img);
    return img;
  } catch {
    return null;
  }
}

// ───────── IMAGE DE LA CARTE D'IDENTITÉ ─────────
const mrzClean = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]+/g, '<');

function mrzLines(row) {
  const [d, m, y] = row.naissance.split('/');
  const exp = new Date(row.reviewed_at);
  exp.setFullYear(exp.getFullYear() + 10);
  const e = `${String(exp.getFullYear()).slice(2)}${String(exp.getMonth() + 1).padStart(2, '0')}${String(exp.getDate()).padStart(2, '0')}`;
  const sex = row.sexe === 'M' || row.sexe === 'F' ? row.sexe : '<';
  const l1 = (`ID${row.pays_code}` + row.card_number.replace('-', '')).padEnd(30, '<');
  const l2 = `${y.slice(2)}${m}${d}0${sex}${e}0${row.pays_code}`.padEnd(29, '<') + '0';
  const l3 = `${mrzClean(row.nom)}<<${mrzClean(row.prenom)}`;
  return [l1, l2, l3.padEnd(30, '<').slice(0, 30)];
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

  // Buste Roblox et drapeau récupérés en parallèle (plus rapide)
  const country = countryOf(row);
  const [bust, flag] = await Promise.all([
    rid ? getBustUrl(rid) : null,
    country ? getFlag(country.iso2) : null,
  ]);
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
  ctx.fillRect(0, 0, W, 130);

  // Drapeau du pays de la nationalité
  const fx = 40, fy = 20, fw = 140, fh = 90;
  if (flag) {
    const s = Math.min(fw / flag.width, fh / flag.height);
    const dw = flag.width * s, dh = flag.height * s;
    const dx = fx + (fw - dw) / 2, dy = fy + (fh - dh) / 2;
    ctx.drawImage(flag, dx, dy, dw, dh);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3;
    ctx.strokeRect(dx, dy, dw, dh);
  }

  // Nom officiel du pays + titre
  const officiel = (country?.officiel || natAdj(row)).toUpperCase();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  fitFont(ctx, officiel, W - 210 - 40, 46, BOLD);
  ctx.fillText(officiel, 210, 66);
  ctx.font = `30px ${BOLD}`;
  ctx.fillText('CARTE D’IDENTITÉ / IDENTITY CARD', 210, 106);

  // Photo (buste du personnage Roblox)
  const px = 40, py = 150, pw = 270, ph = 355;
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
    ctx.font = `14px ${REG}`;
    ctx.fillText(label, x, y);
    ctx.fillStyle = '#0f1f3a';
    fitFont(ctx, value, maxW, 30, BOLD);
    ctx.fillText(value, x, y + 32);
  };
  const c1 = 350, c2 = 450, c3 = 690;
  field('NOM / SURNAME', row.nom.toUpperCase(), c1, 160, 620);
  field('PRÉNOM / GIVEN NAME', row.prenom, c1, 218, 620);
  field('SEXE / SEX', row.sexe === 'M' || row.sexe === 'F' ? row.sexe : '—', c1, 276, 80);
  field('NATIONALITÉ / NATIONALITY', row.pays_code, c2, 276, 220);
  field('DATE DE NAISSANCE / DATE OF BIRTH', row.naissance, c3, 276, 280);
  field('LIEU DE NAISSANCE / PLACE OF BIRTH', row.ville, c1, 334, 320);
  field('N° DE CARTE / CARD NO.', row.card_number, c3, 334, 280);
  field('DÉLIVRÉE LE / ISSUED', fmtDate(row.reviewed_at), c1, 392, 320);
  field('VALABLE JUSQU’AU / EXPIRES', fmtDate(row.reviewed_at, 10), c3, 392, 280);

  // Signature (nom en écriture manuscrite)
  ctx.fillStyle = '#5b6b82';
  ctx.font = `13px ${REG}`;
  ctx.fillText('SIGNATURE DU TITULAIRE / HOLDER’S SIGNATURE', c1, 450);
  const sig = `${row.prenom} ${cap(row.nom)}`;
  ctx.save();
  ctx.translate(c1 + 10, 496);
  ctx.rotate(-0.045);
  ctx.fillStyle = '#1b2a6b';
  fitFont(ctx, sig, 520, 56, 'CardSign, cursive');
  ctx.fillText(sig, 0, 0);
  ctx.restore();
  ctx.strokeStyle = '#9aa8c0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(c1, 506);
  ctx.lineTo(c1 + 560, 506);
  ctx.stroke();

  // Zone de lecture automatique
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.fillRect(0, 520, W, 118);
  ctx.fillStyle = '#111111';
  ctx.font = '30px CardMono, monospace';
  const pitch = 31, x0 = (W - 30 * pitch) / 2;
  mrzLines(row).forEach((line, li) => {
    [...line].forEach((ch, idx) => ctx.fillText(ch, x0 + idx * pitch, 556 + li * 34));
  });

  return canvas.encode('png'); // asynchrone (thread séparé) : ne bloque pas le bot
}

// Cache des cartes générées (10 min) : la carte envoyée en MP à la validation
// est réutilisée ensuite par /personnage afficher → réponse instantanée.
const cardCache = new Map();
async function buildCardFile(row, user, member) {
  const key = `${row.user_id}:${row.card_number}`;
  const hit = cardCache.get(key);
  let buf;
  if (hit && Date.now() - hit.at < 10 * 60_000) {
    buf = hit.buf;
  } else {
    buf = await renderCard(row, user, member);
    cardCache.set(key, { buf, at: Date.now() });
    if (cardCache.size > 40) cardCache.delete(cardCache.keys().next().value);
  }
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
  // ⚠️ PAS de await ici : on ne doit rien faire avant de répondre à Discord (3 s max)
  botLog(
    '⌨️ Commande exécutée',
    `**/${i.commandName}** par <@${i.user.id}> dans <#${i.channelId}>`,
  ).catch(() => {});

  if (i.commandName === 'panneau-identite') {
    await i.deferReply({ flags: EPH });
    await sendPanel();
    return i.editReply({ content: `✅ Panneau envoyé dans <#${CFG.PANEL_CHANNEL}>.` });
  }

  if (i.commandName === 'personnage' && i.options.getSubcommand() === 'afficher') {
    await i.deferReply(); // d'abord on répond à Discord, ensuite on travaille
    const target = i.options.getUser('membre') || i.user;
    const row = await getIdentity(target.id);
    if (!row || row.status !== 'approved') {
      // on supprime le "réfléchit..." public et on envoie le message en privé
      await i.deleteReply().catch(() => {});
      return i.followUp({
        content: target.id === i.user.id
          ? `❌ Tu n'as pas encore de carte d'identité. Fais ta demande dans <#${CFG.PANEL_CHANNEL}>.`
          : `❌ <@${target.id}> n'a pas de carte d'identité validée.`,
        flags: EPH,
      });
    }
    const member = i.guild ? await i.guild.members.fetch(target.id).catch(() => null) : null;
    const file = await buildCardFile(row, target, member);
    const embed = mkEmbed(0x3b6ea5)
      .setTitle(`🪪 Carte d'identité — Nationalité ${natAdj(row).toLowerCase()}`)
      .setDescription(`👤 **Titulaire :** <@${row.user_id}>`)
      .setImage('attachment://carte-identite.png');
    return i.editReply({ embeds: [embed], files: [file] });
  }

  if (i.commandName === 'mort-rp') {
    if (!isStaff(i)) return i.reply({ content: '❌ Réservé au staff.', flags: EPH });
    await i.deferReply({ flags: EPH });
    const target = i.options.getUser('membre', true);
    const reason = i.options.getString('raison', true).trim();
    if (target.bot) return i.editReply({ content: '❌ Tu ne peux pas cibler un bot.' });

    const row = await getIdentity(target.id);
    const member = i.guild ? await i.guild.members.fetch(target.id).catch(() => null) : null;
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
      { name: '🪪 Personnage supprimé', value: row ? summary(row) : 'Aucune identité enregistrée' },
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
// Étape 1 : choix du sexe (boutons) — Étape 2 : formulaire
async function blockReason(userId) {
  const row = await getIdentity(userId);
  if (row?.status === 'approved') return '✅ Tu as déjà une carte d\'identité (`/personnage afficher`).';
  if (row?.status === 'pending') return '⏳ Ta demande est déjà en cours de vérification.';
  return null;
}

async function onOpen(i) {
  await i.deferReply({ flags: EPH }); // on répond d'abord, la base de données ensuite
  const blocked = await blockReason(i.user.id);
  if (blocked) return i.editReply({ content: blocked });

  return i.editReply({
    embeds: [
      mkEmbed(0x3498db)
        .setTitle('🪪 Création de ton identité')
        .setDescription('**Étape 1/2** — Choisis le sexe de ton personnage.'),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('id_sex:M').setLabel('Homme').setEmoji('👨').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('id_sex:F').setLabel('Femme').setEmoji('👩').setStyle(ButtonStyle.Primary),
      ),
    ],
  });
}

// showModal doit partir en moins de 3 s et ne peut pas être "différé" :
// donc AUCUN appel base de données ici (le blocage est déjà vérifié à l'étape 1 et à l'envoi).
async function onSex(i, sex) {
  const s = sex === 'F' ? 'F' : 'M';
  const input = (id, label, ph) =>
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(ph)
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40),
    );
  const modal = new ModalBuilder()
    .setCustomId(`id_modal:${s}`)
    .setTitle(`Étape 2/2 — ${s === 'M' ? 'Homme' : 'Femme'}`)
    .addComponents(
      input('nom', 'Nom', 'Ex : Dupont'),
      input('prenom', 'Prénom', 'Ex : Jean'),
      input('naissance', 'Date de naissance', 'JJ/MM/AAAA'),
      input('ville', 'Ville de naissance', 'Ex : Bruxelles'),
      input('nationalite', 'Nationalité', 'Ex : Belge ou Belgique'),
    );
  return i.showModal(modal);
}

async function onSubmit(i, sex) {
  await i.deferReply({ flags: EPH });
  const s = sex === 'F' ? 'F' : 'M';
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
    return i.editReply({ content: '❌ Ta demande n\'a pas pu être envoyée :\n' + errors.map((e) => `• ${e}`).join('\n') + '\n\n🔁 Reclique sur le bouton du panneau pour recommencer.' });

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
    sql: `INSERT INTO identities (user_id, nom, prenom, sexe, naissance, ville, nationalite, pays_code, status, suspicious, flags, created_at)
          VALUES (?,?,?,?,?,?,?,?, 'pending', ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            nom=excluded.nom, prenom=excluded.prenom, sexe=excluded.sexe, naissance=excluded.naissance, ville=excluded.ville,
            nationalite=excluded.nationalite, pays_code=excluded.pays_code, status='pending',
            suspicious=excluded.suspicious, flags=excluded.flags, created_at=excluded.created_at,
            card_number=NULL, refuse_reason=NULL, reviewed_by=NULL, reviewed_at=NULL, request_message_id=NULL`,
    args: [i.user.id, data.nom, data.prenom, s, data.naissance, data.ville, data.nationalite, data.pays_code,
      flags.length ? 1 : 0, JSON.stringify(flags), new Date().toISOString()],
  });
  await addHistory(i.user.id, 'submitted', null, flags.length ? 'suspicious' : null);

  const row = await getIdentity(i.user.id);
  const msg = await (async () => {
    try {
      const ch = await client.channels.fetch(CFG.REQUEST_CHANNEL);
      return await ch.send({ embeds: [requestEmbed(row, flags)], components: [staffButtons(i.user.id)] });
    } catch (e) {
      console.error(e);
      return null;
    }
  })();
  if (msg) await db.execute({ sql: 'UPDATE identities SET request_message_id=? WHERE user_id=?', args: [msg.id, i.user.id] });

  await dm(i.user.id, mkEmbed(0xf1c40f)
    .setTitle('⏳ Demande reçue')
    .setDescription('Ta demande de carte d’identité est en cours de vérification.\nTu recevras la décision par **MP**.')
    .addFields(identityFields(row)));

  return i.editReply({ content: msg ? '✅ Demande envoyée ! Tu as reçu un MP de confirmation.' : '⚠️ Demande enregistrée mais le salon staff est inaccessible, préviens un administrateur.' });
}

// ───────── VALIDATION STAFF ─────────
async function onAccept(i, uid) {
  if (!isStaff(i)) return i.reply({ content: '❌ Réservé au staff.', flags: EPH });
  await i.deferUpdate(); // on répond à Discord AVANT d'interroger la base

  const row = await getIdentity(uid);
  if (!row || row.status !== 'pending')
    return i.followUp({ content: '⚠️ Cette demande a déjà été traitée.', flags: EPH });

  const cardNumber = await genCardNumber();
  const upd = await db.execute({
    sql: `UPDATE identities SET status='approved', card_number=?, reviewed_by=?, reviewed_at=? WHERE user_id=? AND status='pending'`,
    args: [cardNumber, i.user.id, new Date().toISOString(), uid],
  });
  // Double-clic / deux staffs en même temps : un seul passe
  if (!upd.rowsAffected)
    return i.followUp({ content: '⚠️ Cette demande a déjà été traitée.', flags: EPH });

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
  const intro = '✅ Ta demande a été **validée** par le staff !\n🎉 Voici ta carte d’identité, ton rôle a été mis à jour.';
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
    dmOk = await dm(uid, cardEmbed(done, intro).setTitle('✅ Identité validée'));
  }

  await i.editReply({
    embeds: [requestEmbed(done, JSON.parse(done.flags || '[]'))
      .setColor(0x2ecc71).addFields({ name: '✅ Validée', value: `Par <@${i.user.id}> • Carte \`${cardNumber}\`` })],
    components: [staffButtons(uid, true)],
  });

  await cardLog(mkEmbed(0x2ecc71).setTitle('✅ Carte validée').addFields(
    { name: '👤 Membre', value: `<@${uid}>`, inline: true },
    { name: '🛡️ Staff', value: `<@${i.user.id}>`, inline: true },
    { name: '🔢 N° carte', value: `\`${cardNumber}\``, inline: true },
    { name: '🪪 Identité', value: summary(done) },
    { name: '🚨 Suspect', value: done.suspicious ? 'Oui ⚠️' : 'Non', inline: true },
    { name: '🎭 Rôles', value: roleOk ? 'Mis à jour ✅' : 'Échec ❌', inline: true },
    { name: '📩 MP', value: dmOk ? 'Envoyé ✅' : 'Échec ❌', inline: true },
  ));
}

// showModal : instantané, sans base de données (la vérification "déjà traitée" est faite à l'envoi du refus)
async function onRefuseBtn(i, uid) {
  if (!isStaff(i)) return i.reply({ content: '❌ Réservé au staff.', flags: EPH });
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
  await i.deferUpdate(); // on répond à Discord AVANT d'interroger la base

  const row = await getIdentity(uid);
  if (!row || row.status !== 'pending')
    return i.followUp({ content: '⚠️ Cette demande a déjà été traitée.', flags: EPH });
  const reason = i.fields.getTextInputValue('reason').trim();

  const upd = await db.execute({
    sql: `UPDATE identities SET status='refused', refuse_reason=?, reviewed_by=?, reviewed_at=? WHERE user_id=? AND status='pending'`,
    args: [reason, i.user.id, new Date().toISOString(), uid],
  });
  if (!upd.rowsAffected)
    return i.followUp({ content: '⚠️ Cette demande a déjà été traitée.', flags: EPH });
  await addHistory(uid, 'refused', i.user.id, reason);

  const dmOk = await dm(uid, mkEmbed(0xe74c3c)
    .setTitle('❌ Demande refusée')
    .setDescription(
      'Ta demande de carte d’identité a été **refusée** par le staff.\n\n' +
      '1️⃣ Lis la raison du refus ci-dessous.\n' +
      '2️⃣ Corrige les informations concernées.\n' +
      `3️⃣ Refais une demande depuis le panneau : <#${CFG.PANEL_CHANNEL}>.\n\n` +
      '⚠️ Aucun rôle n’a été modifié.',
    )
    .addFields({ name: '📝 Raison du refus', value: reason }));

  await i.editReply({
    embeds: [requestEmbed(row, JSON.parse(row.flags || '[]'))
      .setColor(0xe74c3c).addFields({ name: '❌ Refusée', value: `Par <@${i.user.id}>\nRaison : ${reason}` })],
    components: [staffButtons(uid, true)],
  });

  await cardLog(mkEmbed(0xe74c3c).setTitle('❌ Carte refusée').addFields(
    { name: '👤 Membre', value: `<@${uid}>`, inline: true },
    { name: '🛡️ Staff', value: `<@${i.user.id}>`, inline: true },
    { name: '🪪 Identité', value: summary(row) },
    { name: '📝 Raison', value: reason },
    { name: '🚨 Suspect', value: row.suspicious ? 'Oui ⚠️' : 'Non', inline: true },
    { name: '📩 MP', value: dmOk ? 'Envoyé ✅' : 'Échec ❌', inline: true },
  ));
}

// ───────── ROUTEUR ─────────
client.on(Events.InteractionCreate, async (i) => {
  // Diagnostic : si une interaction arrive déjà "vieille", c'est un problème de lenteur/réseau
  const age = Date.now() - i.createdTimestamp;
  if (age > 2000) console.warn(`[lent] ${i.customId || i.commandName} reçue avec ${age} ms de retard`);

  try {
    if (i.isChatInputCommand()) return await onCommand(i);
    if (i.isButton()) {
      if (i.customId === 'id_open') return await onOpen(i);
      if (i.customId.startsWith('id_sex:')) return await onSex(i, i.customId.split(':')[1]);
      if (i.customId.startsWith('id_accept:')) return await onAccept(i, i.customId.split(':')[1]);
      if (i.customId.startsWith('id_refuse:')) return await onRefuseBtn(i, i.customId.split(':')[1]);
    }
    if (i.isModalSubmit()) {
      if (i.customId.startsWith('id_modal:')) return await onSubmit(i, i.customId.split(':')[1]);
      if (i.customId.startsWith('id_refuse_modal:')) return await onRefuseSubmit(i, i.customId.split(':')[1]);
    }
  } catch (e) {
    // 10062 = interaction expirée (trop lente), 40060 = déjà répondu : on log en console sans spammer le salon
    if (e.code === 10062 || e.code === 40060) {
      console.warn(`[interaction] code ${e.code} sur ${i.customId || i.commandName} (âge ${age} ms)`);
      return;
    }
    console.error(e);
    await botLog('❌ Erreur', `\`${e.message}\`\nInteraction : ${i.customId || i.commandName} par <@${i.user.id}>`, 0xed4245);
    const p = { content: '❌ Une erreur est survenue.', flags: EPH };
    if (i.isRepliable()) (i.deferred || i.replied ? i.followUp(p) : i.reply(p)).catch(() => {});
  }
});

// ───────── SURVEILLANCE DE LA CONNEXION DISCORD ─────────
client.on(Events.ShardDisconnect, (ev, id) => console.warn(`[gateway] shard ${id} déconnecté (code ${ev?.code})`));
client.on(Events.ShardReconnecting, (id) => console.warn(`[gateway] shard ${id} se reconnecte...`));
client.on(Events.ShardResume, (id, replayed) => console.log(`[gateway] shard ${id} repris (${replayed} évènements rejoués)`));
client.on(Events.ShardError, (e, id) => console.error(`[gateway] erreur shard ${id} :`, e.message));
client.on(Events.Error, (e) => console.error('[client] erreur :', e.message));
client.on(Events.Warn, (m) => console.warn('[client] warn :', m));

// Logs de diagnostic de la connexion (sans le bruit des heartbeats)
client.on(Events.Debug, (m) => {
  if (!/heartbeat/i.test(m)) console.log('[debug]', m.slice(0, 200));
});

// Watchdog : toutes les 2 min on vérifie que le bot est prêt ET que l'API Discord répond.
// 3 échecs d'affilée (~6 min) → on quitte, Render relance le service automatiquement.
let wdFails = 0;
async function watchdog() {
  try {
    if (!client.isReady()) throw new Error('client non prêt');
    await Promise.race([
      client.rest.get(Routes.user('@me')),
      new Promise((_, rej) => setTimeout(() => rej(new Error('API Discord : timeout 10 s')), 10_000)),
    ]);
    wdFails = 0;
  } catch (e) {
    wdFails++;
    console.error(`[watchdog] échec ${wdFails}/3 : ${e.message}`);
    if (wdFails >= 3) {
      console.error('[watchdog] bot figé, redémarrage du service');
      process.exit(1);
    }
  }
  // Garde la connexion Turso chaude (pas de latence au premier clic) — n'impacte pas le watchdog
  db.execute('SELECT 1').catch((e) => console.warn('[turso] ping :', e.message));
}

// Auto-ping de secours (au cas où UptimeRobot tombe) : Render fournit RENDER_EXTERNAL_URL
if (process.env.RENDER_EXTERNAL_URL) {
  setInterval(() => {
    fetch(`${process.env.RENDER_EXTERNAL_URL}/health`, { signal: AbortSignal.timeout(10_000) }).catch(() => {});
  }, 10 * 60_000);
}

client.once(Events.ClientReady, async () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
  setInterval(watchdog, 2 * 60_000);

  // On ne ré-enregistre les commandes que si elles ont changé (évite les limites d'API à chaque redémarrage)
  try {
    const hash = crypto.createHash('sha1').update(JSON.stringify(commands)).digest('hex');
    if ((await getMeta('commands_hash')) !== hash) {
      await client.application.commands.set(commands);
      await setMeta('commands_hash', hash);
      console.log('Commandes enregistrées');
    }
  } catch (e) {
    console.error('Enregistrement des commandes :', e.message);
    await client.application.commands.set(commands).catch(() => {});
  }

  await ensurePanel();
  await botLog('🟢 Bot démarré', `Connecté en tant que **${client.user.tag}**.`, 0x2ecc71);
});

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
process.on('uncaughtException', (e) => {
  console.error('uncaughtException', e);
  process.exit(1);
});

// ───────── DIAGNOSTIC RÉSEAU DISCORD (à retirer une fois le problème réglé) ─────────
async function diag() {
  const t = (s) => String(s).replace(/\s+/g, ' ').slice(0, 160);
  try {
    const r1 = await fetch('https://discord.com/api/v10/gateway', { signal: AbortSignal.timeout(10_000) });
    console.log(`[diag] /gateway → HTTP ${r1.status} | cf-ray=${r1.headers.get('cf-ray')} | ${t(await r1.text())}`);
  } catch (e) {
    console.error('[diag] /gateway injoignable :', e.message);
  }
  try {
    const r2 = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
      signal: AbortSignal.timeout(10_000),
    });
    console.log(`[diag] /users/@me → HTTP ${r2.status} | ${t(await r2.text())}`);
  } catch (e) {
    console.error('[diag] /users/@me injoignable :', e.message);
  }
}

// ───────── DÉMARRAGE ─────────
async function start() {
  // Base de données (3 essais au cas où Turso soit lent à répondre)
  for (let n = 1; n <= 3; n++) {
    try {
      await initDb();
      break;
    } catch (e) {
      console.error(`initDb essai ${n}/3 :`, e.message);
      if (n === 3) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  await diag();

  // Si le bot n'est pas connecté à Discord après 10 min, on redémarre
  setTimeout(() => {
    if (!client.isReady()) {
      console.error('Pas connecté à Discord après 10 min, redémarrage');
      process.exit(1);
    }
  }, 10 * 60_000);

  await client.login(process.env.DISCORD_TOKEN);
}

start().catch((e) => {
  console.error('Démarrage impossible :', e);
  process.exit(1);
});
