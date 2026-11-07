const {
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder, PermissionFlagsBits,
  Events, MessageFlags,
} = require('discord.js');
const { createClient } = require('@libsql/client');
const http = require('http');

// ───────── CONFIG ─────────
const CFG = {
  PANEL_CHANNEL: '1536145374245560320',     // salon du panneau d'identité
  REQUEST_CHANNEL: '1568659952476889088',   // demandes d'identité (staff)
  CARD_LOG_CHANNEL: '1568662351065129051',  // logs cartes validées / refusées
  BOT_LOG_CHANNEL: '1564203403792613466',   // logs du bot (commandes, erreurs...)
  ROLE_REMOVE: '1558228147156033716',
  ROLE_ADD: '1517283159744577596',
  // Staff autorisé à valider/refuser : Modérateur, Administrateur, Exécutif, Fondateur
  STAFF_ROLES: [
    '1514240629889175693', '1563694441212944434',
    '1514237734472908810', '1513966828555210752',
  ],
};
const FOOTER = 'Dev by U-lis ⚜';

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
  await db.execute(`CREATE TABLE IF NOT EXISTS identity_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT, action TEXT, staff_id TEXT, reason TEXT, at TEXT
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
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

// ───────── PAYS → CODE 3 LETTRES ─────────
// CODE|noms de pays (sans accents)|débuts de nationalité (sans accents)
const COUNTRIES = `AFG|afghanistan|afghan
ZAF|afrique du sud|sud africain
ALB|albanie|albanais
DZA|algerie|algerien
DEU|allemagne|allemand
AND|andorre|andorran
AGO|angola|angolais
ATG|antigua et barbuda|antiguayen
SAU|arabie saoudite|saoudien
ARG|argentine|argentin
ARM|armenie|armenien
AUS|australie|australien
AUT|autriche|autrichien
AZE|azerbaidjan|azerbaidjanais,azeri
BHS|bahamas|bahameen
BHR|bahrein|bahreini
BGD|bangladesh|bangladais
BRB|barbade|barbadien
BEL|belgique|belge
BLZ|belize|belizien
BEN|benin|beninois
BTN|bhoutan|bhoutanais
BLR|bielorussie,belarus|bielorusse
MMR|birmanie,myanmar|birman
BOL|bolivie|bolivien
BIH|bosnie herzegovine,bosnie|bosnien
BWA|botswana|botswanais
BRA|bresil|bresilien
BRN|brunei|bruneien
BGR|bulgarie|bulgare
BFA|burkina faso|burkinabe
BDI|burundi|burundais
KHM|cambodge|cambodgien
CMR|cameroun|camerounais
CAN|canada|canadien
CPV|cap vert|cap verdien
CHL|chili|chilien
CHN|chine|chinois
CYP|chypre|chypriote
COL|colombie|colombien
COM|comores|comorien
COG|congo,republique du congo,congo brazzaville|
COD|rd congo,republique democratique du congo,congo kinshasa|
PRK|coree du nord|nord coreen
KOR|coree du sud,coree|sud coreen,coreen
CRI|costa rica|costaricien,costa ricien
CIV|cote d ivoire|ivoirien
HRV|croatie|croate
CUB|cuba|cubain
DNK|danemark|danois
DJI|djibouti|djiboutien
DMA|dominique|dominiquais
EGY|egypte|egyptien
ARE|emirats arabes unis|emirien,emirati
ECU|equateur|equatorien
ERI|erythree|erythreen
ESP|espagne|espagnol
EST|estonie|estonien
SWZ|eswatini,swaziland|swazi
USA|etats unis,usa,etats unis d amerique,us|americain
ETH|ethiopie|ethiopien
FJI|fidji|fidjien
FIN|finlande|finlandais
FRA|france|francais
GAB|gabon|gabonais
GMB|gambie|gambien
GEO|georgie|georgien
GHA|ghana|ghaneen
GRC|grece|grec,grecq
GRD|grenade|grenadien
GTM|guatemala|guatemalteque
GIN|guinee|guineen
GNB|guinee bissau|bissau guineen
GNQ|guinee equatoriale|equato guineen
GUY|guyana|guyanien
HTI|haiti|haitien
HND|honduras|hondurien
HUN|hongrie|hongrois
MHL|iles marshall|marshallais
SLB|iles salomon|salomonais
IND|inde|indien
IDN|indonesie|indonesien
IRQ|irak|irakien
IRN|iran|iranien
IRL|irlande|irlandais
ISL|islande|islandais
ISR|israel|israelien
ITA|italie|italien
JAM|jamaique|jamaicain
JPN|japon|japonais
JOR|jordanie|jordanien
KAZ|kazakhstan|kazakh
KEN|kenya|kenyan
KGZ|kirghizistan|kirghize
KIR|kiribati|kiribatien
XKX|kosovo|kosovar
KWT|koweit|koweitien
LAO|laos|laotien
LSO|lesotho|lesothan
LVA|lettonie|letton
LBN|liban|libanais
LBR|liberia|liberien
LBY|libye|libyen
LIE|liechtenstein|liechtensteinois
LTU|lituanie|lituanien
LUX|luxembourg|luxembourgeois
MKD|macedoine du nord,macedoine|macedonien
MDG|madagascar|malgache
MYS|malaisie|malaisien
MWI|malawi|malawite
MDV|maldives|maldivien
MLI|mali|malien
MLT|malte|maltais
MAR|maroc|marocain
MUS|maurice|mauricien
MRT|mauritanie|mauritanien
MEX|mexique|mexicain
FSM|micronesie|micronesien
MDA|moldavie|moldave
MCO|monaco|monegasque
MNG|mongolie|mongol
MNE|montenegro|montenegrin
MOZ|mozambique|mozambicain
NAM|namibie|namibien
NRU|nauru|nauruan
NPL|nepal|nepalais
NIC|nicaragua|nicaraguayen
NER|niger|nigerien
NGA|nigeria|nigerian
NOR|norvege|norvegien
NZL|nouvelle zelande|neo zelandais
OMN|oman|omanais
UGA|ouganda|ougandais
UZB|ouzbekistan|ouzbek
PAK|pakistan|pakistanais
PLW|palaos|palaosien
PSE|palestine|palestinien
PAN|panama|panameen
PNG|papouasie nouvelle guinee|papou
PRY|paraguay|paraguayen
NLD|pays bas,hollande|neerlandais,hollandais
PER|perou|peruvien
PHL|philippines|philippin
POL|pologne|polonais
PRT|portugal|portugais
QAT|qatar|qatarien
CAF|republique centrafricaine,centrafrique|centrafricain
DOM|republique dominicaine|dominicain
CZE|tchequie,republique tcheque|tcheque
ROU|roumanie|roumain
GBR|royaume uni,angleterre,grande bretagne,ecosse,pays de galles|britannique,anglais,ecossais,gallois
RUS|russie|russe
RWA|rwanda|rwandais
KNA|saint christophe et nieves|kittitien
LCA|sainte lucie|saint lucien
SMR|saint marin|saint marinais
VCT|saint vincent et les grenadines|vincentais
SLV|salvador,el salvador|salvadorien
WSM|samoa|samoan
STP|sao tome et principe|santomeen
SEN|senegal|senegalais
SRB|serbie|serbe
SYC|seychelles|seychellois
SLE|sierra leone|sierra leonais
SGP|singapour|singapourien
SVK|slovaquie|slovaque
SVN|slovenie|slovene
SOM|somalie|somalien
SDN|soudan|soudanais
SSD|soudan du sud|sud soudanais
LKA|sri lanka|sri lankais
SWE|suede|suedois
CHE|suisse|suisse
SUR|suriname|surinamien
SYR|syrie|syrien
TJK|tadjikistan|tadjik
TWN|taiwan|taiwanais
TZA|tanzanie|tanzanien
TCD|tchad|tchadien
THA|thailande|thailandais
TLS|timor oriental|timorais
TGO|togo|togolais
TON|tonga|tongien
TTO|trinite et tobago|trinidadien
TUN|tunisie|tunisien
TKM|turkmenistan|turkmene
TUR|turquie|turc,turq
TUV|tuvalu|tuvaluan
UKR|ukraine|ukrainien
URY|uruguay|uruguayen
VUT|vanuatu|vanuatais
VAT|vatican,saint siege|
VEN|venezuela|venezuelien
VNM|vietnam,viet nam|vietnamien
YEM|yemen|yemenite
ZMB|zambie|zambien
ZWE|zimbabwe|zimbabween`
  .split('\n')
  .map((l) => {
    const [code, names, stems] = l.split('|');
    return { code, names: names.split(','), stems: stems ? stems.split(',').filter(Boolean) : [] };
  });

const norm = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function findCountry(input) {
  const n = norm(input);
  return COUNTRIES.find((c) => c.names.includes(n) || c.stems.some((s) => n.startsWith(s))) || null;
}

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

async function dm(userId, embed) {
  try {
    const u = await client.users.fetch(userId);
    await u.send({ embeds: [embed] });
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

// ───────── CARTE D'IDENTITÉ RP (/personnage afficher) ─────────
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

// Photo = buste du personnage Roblox (retrouvé via le pseudo Discord)
const robloxCache = new Map();

async function getRobloxPhoto(member, user) {
  const names = [...new Set(
    [member?.nickname, user.username, member?.displayName, user.globalName]
      .filter((n) => n && /^[A-Za-z0-9_]{3,20}$/.test(n)),
  )];
  if (!names.length) return null;

  const key = names.join('|');
  const hit = robloxCache.get(key);
  if (hit && Date.now() - hit.at < 3600_000) return hit.url;

  try {
    const r = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: names, excludeBannedUsers: true }),
      signal: AbortSignal.timeout(5000),
    });
    const { data } = await r.json();
    const found = names
      .map((n) => data.find((d) => d.requestedUsername.toLowerCase() === n.toLowerCase()))
      .find(Boolean);
    if (!found) return null;

    const t = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-bust?userIds=${found.id}&size=420x420&format=Png&isCircular=false`,
      { signal: AbortSignal.timeout(5000) },
    );
    const td = (await t.json()).data?.[0];
    const url = td?.state === 'Completed' ? td.imageUrl : null;
    if (url) robloxCache.set(key, { url, at: Date.now() });
    return url;
  } catch {
    return null;
  }
}

function idCardEmbed(row, user, photoUrl) {
  return mkEmbed(0x3b6ea5)
    .setAuthor({ name: '🇧🇪 BRUXELLES ROLE-PLAY • CARTE D\'IDENTITÉ' })
    .setTitle('🪪 IDENTITY CARD • CARTE D\'IDENTITÉ')
    .setDescription(
      `👤 **Titulaire :** <@${row.user_id}>\n` +
      '🏛️ *Délivrée par l\'Administration communale de Bruxelles*',
    )
    .setThumbnail(photoUrl || user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: '📛 NOM / SURNAME', value: `**${row.nom}**`, inline: true },
      { name: '🧑 PRÉNOM / GIVEN NAME', value: `**${row.prenom}**`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '🎂 NÉ(E) LE / DATE OF BIRTH', value: row.naissance, inline: true },
      { name: '🏙️ LIEU DE NAISSANCE / PLACE OF BIRTH', value: row.ville, inline: true },
      { name: '🌍 NATIONALITÉ / NATIONALITY', value: `${row.nationalite} (${row.pays_code})`, inline: true },
      { name: '🔢 N° DE CARTE / CARD NO.', value: `\`${row.card_number}\``, inline: true },
      { name: '📅 DÉLIVRÉE LE / ISSUED', value: fmtDate(row.reviewed_at), inline: true },
      { name: '⏳ VALABLE JUSQU\'AU / EXPIRES', value: fmtDate(row.reviewed_at, 10), inline: true },
      { name: '🔠 ZONE DE LECTURE AUTOMATIQUE', value: '```\n' + mrzLines(row).join('\n') + '\n```' },
    );
}

// ───────── COMMANDES ─────────
const commands = [
  new SlashCommandBuilder()
    .setName('panneau-identite')
    .setDescription('Envoie le panneau de création de carte d\'identité')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('carte')
    .setDescription('Affiche ta carte d\'identité')
    .addUserOption((o) => o.setName('membre').setDescription('(Staff) voir la carte d\'un membre')),
  new SlashCommandBuilder()
    .setName('personnage')
    .setDescription('Commandes de ton personnage RP')
    .addSubcommand((s) =>
      s.setName('afficher')
        .setDescription('Affiche la carte d\'identité d\'un personnage')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre (toi par défaut)'))),
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

  if (i.commandName === 'carte') {
    const target = i.options.getUser('membre');
    if (target && target.id !== i.user.id && !isStaff(i))
      return i.reply({ content: '❌ Seul le staff peut voir la carte d\'un autre membre.', flags: EPH });
    const row = await getIdentity((target || i.user).id);
    if (!row || row.status !== 'approved')
      return i.reply({ content: '❌ Aucune carte d\'identité validée.', flags: EPH });
    return i.reply({ embeds: [cardEmbed(row)], flags: EPH });
  }

  if (i.commandName === 'personnage') {
    if (i.options.getSubcommand() === 'afficher') {
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
      const photo = await getRobloxPhoto(member, target);
      return i.editReply({ embeds: [idCardEmbed(row, target, photo)] });
    }
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
    nationalite: cap(raw.nationalite),
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
  try {
    const member = await i.guild.members.fetch(uid);
    await member.roles.remove(CFG.ROLE_REMOVE);
    await member.roles.add(CFG.ROLE_ADD);
  } catch (e) {
    roleOk = false;
    await botLog('❌ Erreur rôles', `Impossible de modifier les rôles de <@${uid}> : ${e.message}`, 0xed4245);
  }

  const dmOk = await dm(uid, cardEmbed(
    done,
    '✅ Ta demande a été **validée** par le staff !\n🎉 Voici ta carte d\'identité, ton rôle a été mis à jour.',
  ).setTitle('✅ Identité validée — Bruxelles Role-Play'));

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
