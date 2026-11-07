const {
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder, PermissionFlagsBits,
  Events, MessageFlags,
} = require('discord.js');
const { createClient } = require('@libsql/client');
const http = require('http');

// ───────── CONFIG ─────────
const CFG = {
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
// CODE|noms de pays|débuts de nationalité (sans accents)
const COUNTRIES = `FRA|france|francais
BEL|belgique|belge
LUX|luxembourg|luxembourgeois
NLD|pays bas,hollande|neerlandais,hollandais
DEU|allemagne|allemand
ITA|italie|italien
ESP|espagne|espagnol
PRT|portugal|portugais
CHE|suisse|suisse
GBR|royaume uni,angleterre,grande bretagne|britannique,anglais
IRL|irlande|irlandais
AUT|autriche|autrichien
POL|pologne|polonais
ROU|roumanie|roumain
BGR|bulgarie|bulgare
GRC|grece|grec
HRV|croatie|croate
SRB|serbie|serbe
ALB|albanie|albanais
UKR|ukraine|ukrainien
RUS|russie|russe
TUR|turquie|turc
SWE|suede|suedois
NOR|norvege|norvegien
DNK|danemark|danois
FIN|finlande|finlandais
CZE|tchequie,republique tcheque|tcheque
HUN|hongrie|hongrois
MAR|maroc|marocain
DZA|algerie|algerien
TUN|tunisie|tunisien
EGY|egypte|egyptien
SEN|senegal|senegalais
CIV|cote d ivoire|ivoirien
CMR|cameroun|camerounais
COD|rd congo,republique democratique du congo|congolais
COG|congo,republique du congo|
MLI|mali|malien
GIN|guinee|guineen
MDG|madagascar|malgache
HTI|haiti|haitien
USA|etats unis,usa,etats unis d amerique|americain
CAN|canada|canadien
MEX|mexique|mexicain
BRA|bresil|bresilien
ARG|argentine|argentin
COL|colombie|colombien
CHL|chili|chilien
PER|perou|peruvien
CHN|chine|chinois
JPN|japon|japonais
KOR|coree du sud,coree|sud coreen,coreen
IND|inde|indien
PAK|pakistan|pakistanais
LBN|liban|libanais
ISR|israel|israelien
SYR|syrie|syrien
IRQ|irak|irakien
IRN|iran|iranien
SAU|arabie saoudite|saoudien
ARE|emirats arabes unis|emirien
VNM|vietnam|vietnamien
THA|thailande|thailandais
AUS|australie|australien
NGA|nigeria|nigerian
ZAF|afrique du sud|sud africain`
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

// ───────── MODÉRATION (mots / dates suspects) ─────────
const BAD_WORDS = [
  'terroriste', 'terrorist', 'terrorisme', 'daech', 'daesh', 'isis', 'al qaida', 'alqaida', 'al qaeda',
  'ben laden', 'oussama', 'hitler', 'adolf', 'nazi', 'goebbels', 'himmler', 'mussolini', 'staline',
  'jihad', 'djihad', 'kamikaze', 'attentat', 'bombe', 'explosif', 'massacre', 'pedophile', 'pedo',
  'violeur', 'viol', 'nique', 'salope', 'pute', 'connard', 'enculer', 'negro', 'nigger',
].map(norm);

const BAD_DATES = [
  { d: 11, m: 9, why: '11 septembre' },
  { d: 22, m: 3, y: 2016, why: 'attentats de Bruxelles' },
  { d: 13, m: 11, y: 2015, why: 'attentats du 13 novembre' },
  { d: 7, m: 1, y: 2015, why: 'attentat Charlie Hebdo' },
  { d: 14, m: 7, y: 2016, why: 'attentat de Nice' },
  { d: 20, m: 4, why: 'date associée à Hitler' },
];

function badWord(text) {
  const n = norm(text);
  const padded = ` ${n} `;
  return BAD_WORDS.find((w) => (w.length >= 6 ? n.includes(w) : padded.includes(` ${w} `))) || null;
}

function checkSuspicious({ nom, prenom, ville, nationalite }, date) {
  const flags = [];
  for (const [label, val] of [['Nom', nom], ['Prénom', prenom], ['Ville de naissance', ville], ['Nationalité', nationalite]]) {
    const w = badWord(val);
    if (w) flags.push(`${label} : « ${val} » (terme suspect : ${w})`);
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

const mkEmbed = (color = 0x5865f2) => new EmbedBuilder().setColor(color).setFooter({ text: FOOTER }).setTimestamp();
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

function cardEmbed(row, color = 0x2ecc71) {
  return mkEmbed(color)
    .setTitle('🪪 Carte d\'identité — Bruxelles Role-Play')
    .addFields(
      { name: 'N° de carte', value: `\`${row.card_number}\``, inline: false },
      { name: 'Nom', value: row.nom, inline: true },
      { name: 'Prénom', value: row.prenom, inline: true },
      { name: 'Date de naissance', value: row.naissance, inline: true },
      { name: 'Ville de naissance', value: row.ville, inline: true },
      { name: 'Nationalité', value: `${row.nationalite} (${row.pays_code})`, inline: true },
    );
}

function requestEmbed(row, flags, userTag) {
  const susp = flags.length > 0;
  const e = mkEmbed(susp ? 0xe74c3c : 0xf1c40f)
    .setTitle(susp ? '🚨 Demande d\'identité — ÉLÉMENTS SUSPECTS' : '🪪 Nouvelle demande d\'identité')
    .setDescription(`Demandeur : <@${row.user_id}> (${userTag})`)
    .addFields(
      { name: 'Nom', value: row.nom, inline: true },
      { name: 'Prénom', value: row.prenom, inline: true },
      { name: 'Date de naissance', value: row.naissance, inline: true },
      { name: 'Ville de naissance', value: row.ville, inline: true },
      { name: 'Nationalité', value: `${row.nationalite} (${row.pays_code})`, inline: true },
    );
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
    new ButtonBuilder().setCustomId(`id_accept:${uid}`).setLabel('Valider').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`id_refuse:${uid}`).setLabel('Refuser').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );

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
].map((c) => c.toJSON());

async function onCommand(i) {
  await botLog(
    '⌨️ Commande exécutée',
    `**/${i.commandName}** par <@${i.user.id}> dans <#${i.channelId}>`,
  );

  if (i.commandName === 'panneau-identite') {
    const e = mkEmbed(0x3498db)
      .setTitle('🪪 Création de ta carte d\'identité')
      .setDescription(
        'Clique sur le bouton ci-dessous pour remplir ta demande.\n\n' +
        'Ta demande sera vérifiée par le staff. Tu recevras un **MP** à chaque étape.',
      );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('id_open').setLabel('Créer mon identité').setEmoji('🪪').setStyle(ButtonStyle.Primary),
    );
    await i.channel.send({ embeds: [e], components: [row] });
    return i.reply({ content: '✅ Panneau envoyé.', flags: EPH });
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
}

// ───────── CRÉATION D'IDENTITÉ ─────────
async function onOpen(i) {
  const row = await getIdentity(i.user.id);
  if (row?.status === 'approved')
    return i.reply({ content: '✅ Tu as déjà une carte d\'identité (`/carte`).', flags: EPH });
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
    return i.editReply({ content: '❌ Ta demande n\'a pas pu être envoyée :\n' + errors.map((e) => `• ${e}`).join('\n') + '\n\nReclique sur le bouton pour recommencer.' });

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
    .setDescription('Ta demande de carte d\'identité a bien été reçue. Le staff va la vérifier, tu recevras un MP avec la décision.')
    .addFields(
      { name: 'Nom', value: row.nom, inline: true },
      { name: 'Prénom', value: row.prenom, inline: true },
      { name: 'Date de naissance', value: row.naissance, inline: true },
      { name: 'Ville de naissance', value: row.ville, inline: true },
      { name: 'Nationalité', value: row.nationalite, inline: true },
    ));

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

  const dmOk = await dm(uid, cardEmbed(done).setDescription('✅ Ta demande a été **validée** par le staff. Voici ta carte d\'identité !'));

  await i.editReply({
    embeds: [requestEmbed(done, JSON.parse(done.flags || '[]'), `<@${uid}>`)
      .setColor(0x2ecc71).addFields({ name: '✅ Validée', value: `Par <@${i.user.id}> • Carte \`${cardNumber}\`` })],
    components: [staffButtons(uid, true)],
  });

  await cardLog(mkEmbed(0x2ecc71).setTitle('✅ Carte validée').addFields(
    { name: 'Membre', value: `<@${uid}>`, inline: true },
    { name: 'Staff', value: `<@${i.user.id}>`, inline: true },
    { name: 'N° carte', value: `\`${cardNumber}\``, inline: true },
    { name: 'Identité', value: `${done.prenom} ${done.nom} • ${done.naissance} • ${done.ville} • ${done.nationalite} (${done.pays_code})` },
    { name: 'Suspect', value: done.suspicious ? 'Oui ⚠️' : 'Non', inline: true },
    { name: 'Rôles', value: roleOk ? 'Mis à jour' : 'Échec', inline: true },
    { name: 'MP', value: dmOk ? 'Envoyé' : 'Échec', inline: true },
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
    .setDescription('Ta demande de carte d\'identité a été **refusée** par le staff.')
    .addFields(
      { name: 'Raison', value: reason },
      { name: 'Et maintenant ?', value: 'Tu peux refaire une demande depuis le panneau de création d\'identité du serveur.' },
    ));

  await i.editReply({
    embeds: [requestEmbed(row, JSON.parse(row.flags || '[]'), `<@${uid}>`)
      .setColor(0xe74c3c).addFields({ name: '❌ Refusée', value: `Par <@${i.user.id}>\nRaison : ${reason}` })],
    components: [staffButtons(uid, true)],
  });

  await cardLog(mkEmbed(0xe74c3c).setTitle('❌ Carte refusée').addFields(
    { name: 'Membre', value: `<@${uid}>`, inline: true },
    { name: 'Staff', value: `<@${i.user.id}>`, inline: true },
    { name: 'Identité', value: `${row.prenom} ${row.nom} • ${row.naissance} • ${row.ville} • ${row.nationalite} (${row.pays_code})` },
    { name: 'Raison', value: reason },
    { name: 'Suspect', value: row.suspicious ? 'Oui ⚠️' : 'Non', inline: true },
    { name: 'MP', value: dmOk ? 'Envoyé' : 'Échec', inline: true },
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
  console.log(`Connecté en tant que ${client.user.tag}`);
  await botLog('🟢 Bot démarré', `Connecté en tant que **${client.user.tag}**.`, 0x2ecc71);
});

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));

// ───────── KEEP-ALIVE (UptimeRobot) ─────────
http.createServer((req, res) => { res.writeHead(200); res.end('Bruxelles RP ID bot OK'); })
  .listen(process.env.PORT || 3000);

client.login(process.env.DISCORD_TOKEN);
