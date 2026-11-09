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
FIN|finlande|finlandais|F
