'use strict';
// Offline stand-in for TwitchClient (npm run demo). Same methods, fake data,
// fast clock: one "minute" of watch time per watch ping.

const H = 3600 * 1000;
const D = 24 * H;

const svg = (body, w, h) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)}`;

function wrap(text, max) {
  const lines = [];
  let line = '';
  for (const word of text.toUpperCase().split(/\s+/)) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function boxArt(name, bg, fg) {
  const lines = wrap(name, 11).slice(0, 4);
  const y0 = 352 - (lines.length - 1) * 34;
  const text = lines.map((l, i) => `<text x="20" y="${y0 + i * 34}" font-family="Bahnschrift, Arial Narrow, sans-serif" font-stretch="condensed" font-weight="700" font-size="34" fill="#fff">${l.replace(/&/g, '&amp;')}</text>`).join('');
  return svg(`<rect width="285" height="380" fill="${bg}"/><path d="M0 250L285 120V380H0Z" fill="${fg}" opacity=".22"/><path d="M0 310L285 210V380H0Z" fill="#000" opacity=".25"/><circle cx="222" cy="72" r="34" fill="none" stroke="${fg}" stroke-width="10" opacity=".55"/>${text}`, 285, 380);
}

const SHAPES = [
  (c, k) => `<path d="M64 10l47 27v54l-47 27-47-27V37z" fill="${c}"/><circle cx="64" cy="64" r="22" fill="${k}"/>`,
  (c, k) => `<circle cx="52" cy="58" r="34" fill="${c}"/><circle cx="84" cy="74" r="26" fill="${c}" opacity=".8"/><circle cx="46" cy="52" r="10" fill="${k}"/>`,
  (c, k) => `<circle cx="64" cy="22" r="9" fill="none" stroke="${c}" stroke-width="5"/><path d="M64 34l30 36-30 40-30-40z" fill="${c}"/><path d="M64 50l14 20-14 20-14-20z" fill="${k}"/>`,
  (c, k) => `<rect x="22" y="46" width="84" height="60" rx="6" fill="${c}"/><rect x="16" y="32" width="96" height="20" rx="5" fill="${c}" opacity=".85"/><rect x="58" y="32" width="12" height="74" fill="${k}"/>`,
  (c, k) => `<path d="M64 12l42 14v34c0 28-18 46-42 56-24-10-42-28-42-56V26z" fill="${c}"/><path d="M64 34l8 16 17 2-12 12 3 17-16-8-16 8 3-17-12-12 17-2z" fill="${k}"/>`,
  (c, k) => `<rect x="14" y="34" width="100" height="60" rx="8" fill="${c}"/><rect x="24" y="46" width="34" height="36" rx="4" fill="${k}"/><rect x="66" y="50" width="38" height="7" rx="3" fill="${k}"/><rect x="66" y="64" width="26" height="7" rx="3" fill="${k}" opacity=".6"/>`,
];

// Stand-in reward art: a lit card in the game's colors, like Twitch reward images.
const reward = (i, color, bg = '#16181d') => svg(
  `<defs><radialGradient id="l" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="${color}" stop-opacity=".45"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient></defs>`
  + `<rect width="128" height="128" rx="16" fill="${bg}"/><rect width="128" height="128" rx="16" fill="url(#l)"/>`
  + `<g transform="translate(19 19) scale(.7)">${SHAPES[i % SHAPES.length](color, bg)}</g>`,
  128, 128,
);
const avatar = (name, bg) => svg(`<rect width="64" height="64" fill="${bg}"/><text x="32" y="43" text-anchor="middle" font-family="Bahnschrift, sans-serif" font-weight="700" font-size="30" fill="#fff">${name[0].toUpperCase()}</text>`, 64, 64);

const GAMES = [
  { id: 'g-mw4', name: 'Call of Duty: Modern Warfare 4', bg: '#2a2e22', fg: '#b9c27a' },
  { id: 'g-ow', name: 'Overwatch', bg: '#2b2f3a', fg: '#f99e1a' },
  { id: 'g-r6', name: 'Rainbow Six Siege', bg: '#14273f', fg: '#5ea0ff' },
  { id: 'g-arc', name: 'ARC Raiders', bg: '#3a1c16', fg: '#ff6b4a' },
  { id: 'g-rivals', name: 'Marvel Rivals', bg: '#26143a', fg: '#ffd23f' },
  { id: 'g-cash', name: 'Cash is King!', bg: '#16301e', fg: '#7ee08a' },
  { id: 'g-bp', name: 'Blue Protocol: Star Resonance', bg: '#132a52', fg: '#8fc1ff' },
  { id: 'g-rust', name: 'Rust', bg: '#33190f', fg: '#e0763a' },
  { id: 'g-pz', name: 'Planet Zoo 2', bg: '#103531', fg: '#6fe0c8' },
];

// [gameId, campaign name, starts (ms from now), ends, linked, channels, drops [name, minutes, progress, claimed]]
const CAMPAIGNS = [
  ['g-mw4', 'Modern Warfare 4 Launch', -10 * D, 3 * D + 5 * H, true, null, [
    ['MW4 Emblem - Point Man', 20, 20, true],
    ['MW4 CC - Deployment Kit', 45, 12],
    ['MW4 Charm - Going Dark', 60, 0],
  ]],
  ['g-ow', 'OWCS Stage 3 Playoffs', -3 * D, 21 * D, true, null, [
    ['Candlelit Satya Spray', 60, 34],
    ['Purrfect Evening Spray', 120, 0],
    ['Sophisticated Sparklers', 180, 0],
    ['Esports Loot Box', 240, 0],
    ['Bua and Palak\'s Lanterns', 360, 0],
    ['Lantern-Lit Night Name Card', 480, 0],
  ]],
  ['g-ow', 'Halloween Terror', -6 * D, 1.5 * H, true, null, [
    ['Grim Pumpkin Spray', 30, 30, true],
    ['Jack-o\'-Lantern Icon', 60, 60, true],
    ['Reaper Highlight Intro', 120, 0],
  ]],
  ['g-r6', 'Siege X Pro League', -2 * D, 9 * D, false, null, [
    ['R6 Charm - Siege X', 30, 0],
    ['Alpha Pack', 90, 0],
  ]],
  ['g-arc', 'Topside Supply Drop', -1 * D, 13 * D, false, null, [
    ['Raider Backpack Charm', 60, 0],
    ['Rust Belt Outfit', 180, 0],
  ]],
  ['g-rivals', 'Season 5 Twitch Drops', -4 * D, 16 * D, true, null, [
    [['Spray - Hellfire Gala', 'Nameplate - Hellfire'], 30, 0],
    [['Emote - Bow Down', 'MVP - Encore'], 60, 0],
    [['Nameplate - Eternal Night', 'Spray - Moonlit'], 90, 0],
    [['Costume - Midnight Strike', 'Gallery Card - Strike'], 120, 0],
    [['Units x100', 'Chrono Tokens x50'], 180, 0],
    [['Spray - Last Stand', 'Emote - Victory Lap'], 240, 0],
    [['Costume - Crimson Pact', 'Nameplate - Pact'], 300, 0],
  ]],
  ['g-cash', 'Cash is King Launch Week', -5 * D, 2 * D, true, null, [
    ['Golden Briefcase', 30, 0],
  ]],
  ['g-bp', 'Resonance Week', -1 * D, 6 * D, false, null, [
    ['Starlight Mount', 120, 0],
    ['Imagine Crystal x500', 240, 0],
  ]],
  ['g-rust', 'Rust Drops Round 41', -2 * D, 4 * D, true, ['rustbucket_tv', 'hollowpine', 'spoonfedgg'], [
    ['Hazmat Suit - Ember', 120, 0],
    ['Garage Door - Static', 240, 0],
  ]],
  ['g-pz', 'Planet Zoo 2 Founders', 2 * D + 3 * H, 12 * D, true, null, [
    ['Zookeeper Cap', 60, 0],
  ]],
];

// Shows up 15 s after start, to try the "new drops for starred games" alert.
const LATE_CAMPAIGN = ['g-ow', 'Overwatch Anniversary', -1 * H, 14 * D, true, null, [
  ['Anniversary Player Icon', 30, 0],
  ['Legendary Loot Box', 120, 0],
]];

const STREAMERS = ['nightfallgg', 'kestrel_tv', 'mira_plays', 'pixelpatrol', 'oatmilkdad', 'lowgroundlena', 'rustbucket_tv', 'hollowpine', 'spoonfedgg'];

// Fake Twitch accounts. Extra ones start fresh and have different games linked.
const DEMO_USERS = [
  { token: 'demo', id: 'demo', login: 'lurker', name: 'Lurker', color: '#2a2d35' },
  { token: 'demo-2', id: 'demo2', login: 'lurk_alt', name: 'lurk_alt', color: '#3b2a6b' },
  { token: 'demo-3', id: 'demo3', login: 'nightowl_99', name: 'nightowl_99', color: '#1f4a5a' },
];
const ALT_LINKS = { 'g-ow': false, 'g-arc': true, 'g-r6': true };

const GAME_BY_ID = new Map(GAMES.map((g) => [g.id, g]));
let artIndex = 0;

function build(alt) {
  return CAMPAIGNS.map((row, ci) => buildCampaign(row, ci, alt));
}

function buildCampaign([gid, name, s, e, linked, channels, drops], ci, alt = false) {
  const t = Date.now();
  const g = GAME_BY_ID.get(gid);
  if (alt) {
    linked = gid in ALT_LINKS ? ALT_LINKS[gid] : linked;
    drops = drops.map(([labels, required]) => [labels, required, 0, false]);
  }
  return {
    id: `c-${ci}`,
    name,
    game: { id: g.id, name: g.name, slug: g.id, boxArt: boxArt(g.name, g.bg, g.fg) },
    status: s > 0 ? 'UPCOMING' : 'ACTIVE',
    startAt: new Date(t + s).toISOString(),
    endAt: new Date(t + e).toISOString(),
    linked,
    linkUrl: 'https://www.twitch.tv/drops/campaigns',
    detailsUrl: 'https://www.twitch.tv/drops/campaigns',
    channels: channels ? channels.map((login) => ({ id: `u-${login}`, login, name: login })) : null,
    drops: drops.map(([labels, required, minutes, claimed], di) => {
      const id = `d-${ci}-${di}`;
      const names = [].concat(labels);
      return {
        id,
        name: names.join(' + '),
        startAt: new Date(t + s).toISOString(),
        endAt: new Date(t + e).toISOString(),
        required,
        requiredSubs: 0,
        minutes,
        claimed: !!claimed,
        claimId: claimed || minutes >= required ? `claim-${id}` : null,
        hasSelf: true,
        preconditions: [],
        benefits: names.map((name, bi) => ({ id: `b-${id}-${bi}`, name, image: reward(artIndex++, g.fg, g.bg), type: 'DIRECT_ENTITLEMENT' })),
      };
    }),
  };
}

// Stands in for the Twitch login window: "signs in" as the given fake user.
function demoLogin(user) {
  let timer;
  let done;
  const promise = new Promise((resolve) => {
    done = resolve;
    timer = setTimeout(() => resolve(user ? user.token : null), 3000);
  });
  return { promise, focus() {}, close() { clearTimeout(timer); done(null); } };
}

class DemoClient {
  constructor() {
    this._data = null;
    this._claimed = null;
    this.created = Date.now();
    this.token = null;
    this.user = null;
  }

  // Built on first use, once it's known which fake account this is.
  get data() {
    if (!this._data) this._data = build(this.alt);
    return this._data;
  }

  get claimed() {
    if (this._claimed) return this._claimed;
    const t = Date.now();
    this._claimed = this.alt ? [] : [
      ['Hazmat Suit - Glacier', 'Rust', 2 * D],
      ['Spray - Neon Tag', 'Marvel Rivals', 5 * D],
      ['Weapon Charm - Static', 'Rainbow Six Siege', 9 * D],
      ['Twitch Cosmic Badge', 'Overwatch', 13 * D],
      ['Calling Card - Dusk', 'Call of Duty: Modern Warfare 4', 20 * D],
    ].map(([name, game, ago], i) => ({ id: `old-${i}`, name, image: reward(i + 2, '#d4ff3a'), game, awardedAt: new Date(t - ago).toISOString(), count: 1 }));
    return this._claimed;
  }

  setSession(s) {
    this.token = s.token || null;
    this.user = DEMO_USERS.find((u) => u.token === this.token) || null;
  }

  session() { return { token: this.token, userId: this.userId, login: this.login }; }
  get userId() { return this.user ? this.user.id : null; }
  get login() { return this.user ? this.user.login : null; }

  async validate() { return this.user ? { userId: this.user.id, login: this.user.login } : null; }
  async refresh() { return false; }
  async revoke() {}
  async profile() { return { displayName: this.user.name, avatar: avatar(this.user.name, this.user.color) }; }

  get alt() { return !!this.user && this.user.id !== DEMO_USERS[0].id; }

  clone() {
    return JSON.parse(JSON.stringify(this.data));
  }

  async campaigns() {
    if (!this.lateAdded && Date.now() - this.created > 15000) {
      this.lateAdded = true;
      this.data.push(buildCampaign(LATE_CAMPAIGN, CAMPAIGNS.length, this.alt));
    }
    return this.clone();
  }

  async inventory() {
    const t = Date.now();
    const inProgress = this.clone().filter((c) => Date.parse(c.startAt) <= t && c.drops.some((d) => d.minutes > 0 && !d.claimed));
    return { campaigns: inProgress, claimed: this.claimed.slice() };
  }

  async claim(claimId) {
    for (const c of this.data) {
      const d = c.drops.find((x) => x.claimId === claimId);
      if (!d) continue;
      d.claimed = true;
      d.minutes = d.required;
      for (const b of d.benefits) {
        this.claimed.unshift({ id: b.id, name: b.name, image: b.image, game: c.game.name, awardedAt: new Date().toISOString(), count: 1 });
      }
      return true;
    }
    return false;
  }

  channelGame(login) {
    const ch = this.channels && this.channels.get(login);
    return ch ? ch.gameId : null;
  }

  farmable(gameId, login) {
    const t = Date.now();
    return this.data.filter((c) => c.game.id === gameId && c.linked && Date.parse(c.startAt) <= t && (!c.channels || c.channels.some((x) => x.login === login)));
  }

  async sendWatch(channel) {
    // Like Twitch: every unfinished drop of every campaign the channel counts for advances.
    for (const c of this.farmable(channel.gameId, channel.login)) {
      for (const d of c.drops) {
        if (d.claimed || d.minutes >= d.required) continue;
        d.minutes += 1;
        if (d.minutes >= d.required) d.claimId = `claim-${d.id}`;
      }
    }
    return true;
  }

  // A bonus is ready every other check.
  async channelPoints(login) {
    this.pointChecks = (this.pointChecks || 0) + 1;
    return { channelId: `u-${login}`, balance: 1200 + this.pointChecks * 50, claimId: this.pointChecks % 2 ? `bonus-${this.pointChecks}` : null };
  }

  async claimPoints() { return 50; }

  async currentDrop(channelId) {
    const login = channelId.replace(/^u-/, '');
    const ch = this.channels && this.channels.get(login);
    if (!ch) return null;
    for (const c of this.farmable(ch.gameId, login)) {
      const d = c.drops.find((x) => !x.claimed);
      if (d) return { dropId: d.id, minutes: d.minutes, required: d.required };
    }
    return null;
  }

  remember(list) {
    this.channels = this.channels || new Map();
    for (const ch of list) if (ch) this.channels.set(ch.login, ch);
    return list;
  }

  async gameStreams(game) {
    const pick = STREAMERS.filter((_, i) => (i + game.id.length) % 3 !== 0).slice(0, 4);
    return this.remember(pick.map((login, i) => ({
      id: `u-${login}`, login, name: login, avatar: avatar(login, ['#3b2a6b', '#1f4a5a', '#5a2a2a', '#2a5a35'][i % 4]),
      online: true, viewers: 18000 - i * 4200 + login.length * 37, gameId: game.id, gameName: game.name, title: `${game.name} with drops on`,
    })));
  }

  async streamInfo(logins) {
    return this.remember(logins.map((login, i) => {
      const known = this.channels && this.channels.get(login);
      const c = this.data.find((x) => x.channels && x.channels.some((ch) => ch.login === login));
      const gameId = known ? known.gameId : c ? c.game.id : null;
      return {
        id: `u-${login}`, login, name: login, avatar: avatar(login, '#2a3f6b'),
        online: true, viewers: 9000 - i * 1500, gameId, gameName: null, title: 'Drops enabled',
      };
    }));
  }
}

module.exports = { DemoClient, demoLogin, DEMO_USERS };
