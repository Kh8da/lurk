'use strict';
const crypto = require('crypto');
const { request } = require('../http');
const { hashes } = require('./hashes');

// Lurk signs in as the Twitch Android app (login page + implicit grant, see
// login.js); its GQL calls are not gated behind browser integrity checks.
const CLIENT_ID = 'kd1unb4b3q4t58fwlpcbzcbnm76a8fp';
const USER_AGENT = 'Dalvik/2.1.0 (Linux; U; Android 16; SM-S911B Build/TP1A.220624.014) tv.twitch.android.app/31.8.0/3108006';
const GQL_URL = 'https://gql.twitch.tv/gql';
const BATCH = 20;

// Persisted query hashes (defaults; hashes.js refreshes them at runtime when
// Twitch rotates one and requests start failing with PersistedQueryNotFound).
const OPS = {
  campaigns: ['ViewerDropsDashboard', 'c16bb890cc8ce7647a96ee69cd313d423a378a3dedadf630a1017cde18975feb'],
  campaignDetails: ['DropCampaignDetails', '039277bf98f3130929262cc7c6efd9c141ca3749cb6dca442fc8ead9a53f77c1'],
  inventory: ['Inventory', '8337eb8541b314040b0edde0c09c5c7a2783ba1960aa9edfbf3bac16d0fec404'],
  currentDrop: ['DropCurrentSessionContext', '4d06b702d25d652afb9ef835d2a550031f1cf762b193523a92166f40ea3d142b'],
  claimDrop: ['DropsPage_ClaimDropRewards', 'a455deea71bdc9015b78eb49f4acfbce8baa7ccbedd28e549bb025bd0f751930'],
  streamInfo: ['VideoPlayerStreamInfoOverlayChannel', '198492e0857f6aedead9665c81c5a06d67b25b58034649687124083ff288597d'],
  playbackToken: ['PlaybackAccessToken', 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9'],
  gameDirectory: ['DirectoryPage_Game', '86bcceb4e8b1a51256ff8eed8bd8aae4acacf80d737efe904f84f3aeadf8cafd'],
  gameSlug: ['DirectoryGameRedirect', '1f0300090caceec51f33c5e20647aceff9017f740f223c3c532ba6fa59f6b6cc'],
  channelPoints: ['ChannelPointsContext', '374314de591e69925fce3ddc2bcf085796f56ebb8cad67a0daa3165c03adc345'],
  claimPoints: ['ClaimCommunityPoints', '46aaeebe02c99afdf4fc97c7c0cba964124bf6b0af229395f1f6d1feed05b3d0'],
};

const RETRYABLE = new Set([
  'service error', 'PersistedQueryNotFound', 'service timeout',
  'request cancelled', 'service unavailable', 'context deadline exceeded',
]);

class AuthError extends Error {
  constructor(msg = 'Twitch session expired') { super(msg); this.auth = true; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (n) => crypto.randomBytes(n).toString('hex');

function op(name, variables) {
  const [operationName, fallback] = OPS[name];
  const sha256Hash = hashes.get(operationName) || fallback;
  return { operationName, variables, extensions: { persistedQuery: { version: 1, sha256Hash } } };
}

function sized(url, w, h) {
  if (!url) return null;
  return url
    .replace('{width}', w).replace('{height}', h)
    .replace(/-\d+x\d+(\.\w+)(\?.*)?$/, `-${w}x${h}$1`);
}

function slugify(name) {
  return name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalizeGame(g) {
  if (!g) return null;
  return {
    id: g.id,
    name: g.displayName || g.name || 'Unknown game',
    slug: g.slug || null,
    boxArt: sized(g.boxArtURL, 285, 380),
  };
}

function normalizeDrop(d) {
  const self = d.self || null;
  return {
    id: d.id,
    name: d.name,
    startAt: d.startAt,
    endAt: d.endAt,
    required: d.requiredMinutesWatched || 0,
    requiredSubs: d.requiredSubs || 0,
    minutes: self ? self.currentMinutesWatched || 0 : 0,
    claimed: self ? !!self.isClaimed : false,
    claimId: self ? self.dropInstanceID || null : null,
    hasSelf: !!self,
    preconditions: (d.preconditionDrops || []).map((p) => p.id),
    benefits: (d.benefitEdges || []).filter((e) => e.benefit).map((e) => ({
      id: e.benefit.id,
      name: e.benefit.name,
      image: e.benefit.imageAssetURL || null,
      type: e.benefit.distributionType || 'UNKNOWN',
    })),
  };
}

function normalizeCampaign(d) {
  const allow = d.allow || {};
  const channels = allow.isEnabled !== false && allow.channels && allow.channels.length
    ? allow.channels.map((c) => ({ id: c.id, login: c.name, name: c.displayName || c.name }))
    : null;
  const drops = (d.timeBasedDrops || []).map(normalizeDrop)
    .sort((a, b) => a.required - b.required || Date.parse(a.startAt) - Date.parse(b.startAt));
  return {
    id: d.id,
    name: d.name,
    game: normalizeGame(d.game),
    status: d.status,
    startAt: d.startAt,
    endAt: d.endAt,
    linked: d.self ? !!d.self.isAccountConnected : true,
    linkUrl: d.accountLinkURL || null,
    detailsUrl: d.detailsURL || null,
    channels,
    drops,
  };
}

class TwitchClient {
  // debugLog(entry): optional sink for raw GQL responses (LURK_DEBUG=1). Never sees headers.
  // logger: the detailed log, for failed requests.
  constructor({ debugLog = null, logger = null } = {}) {
    this.debugLog = debugLog;
    this.logger = logger;
    this.token = null;
    this.refreshToken = null;
    this.userId = null;
    this.login = null;
    this.deviceId = hex(16);
    this.sessionId = hex(8);
    this.playlists = new Map();
  }

  headers(withAuth) {
    const h = {
      Accept: '*/*',
      'Accept-Language': 'en-US',
      'Client-Id': CLIENT_ID,
      'User-Agent': USER_AGENT,
      'X-Device-Id': this.deviceId,
      'Client-Session-Id': this.sessionId,
    };
    if (withAuth && this.token) h.Authorization = `OAuth ${this.token}`;
    return h;
  }

  // ---- auth ----

  setSession(s) {
    this.token = s.token;
    this.refreshToken = s.refreshToken || null;
    if (s.deviceId) this.deviceId = s.deviceId;
    this.userId = s.userId || null;
    this.login = s.login || null;
  }

  session() {
    return { token: this.token, refreshToken: this.refreshToken, deviceId: this.deviceId, userId: this.userId, login: this.login };
  }

  async validate() {
    if (!this.token) return null;
    const res = await request('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${this.token}`, 'User-Agent': USER_AGENT },
    });
    if (res.status === 401) return null;
    const j = res.json();
    if (!res.ok || !j) throw new Error(`Could not reach Twitch (${res.status})`);
    if (j.client_id && j.client_id !== CLIENT_ID) return null;
    this.userId = j.user_id;
    this.login = j.login;
    return { userId: j.user_id, login: j.login };
  }

  async refresh() {
    if (!this.refreshToken) return false;
    const res = await request('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: this.headers(false),
      form: { client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: this.refreshToken },
    });
    const j = res.json();
    if (res.status !== 200 || !j || !j.access_token) return false;
    this.token = j.access_token;
    this.refreshToken = j.refresh_token || this.refreshToken;
    return true;
  }

  async revoke() {
    if (!this.token) return;
    await request('https://id.twitch.tv/oauth2/revoke', {
      method: 'POST',
      headers: this.headers(false),
      form: { client_id: CLIENT_ID, token: this.token },
      timeout: 8000,
    }).catch(() => {});
  }

  async profile() {
    try {
      const r = await this.gql({ query: `query { user(id: "${this.userId}") { displayName profileImageURL(width: 70) } }` });
      const u = r && r.data && r.data.user;
      if (u) return { displayName: u.displayName, avatar: u.profileImageURL || null };
    } catch {}
    try {
      const [info] = await this.streamInfo([this.login]);
      if (info) return { displayName: info.name, avatar: info.avatar };
    } catch {}
    return { displayName: this.login, avatar: null };
  }

  // ---- gql ----

  async gql(ops) {
    for (let attempt = 0; ; attempt++) {
      const res = await request(GQL_URL, { method: 'POST', headers: this.headers(true), json: ops });
      if (res.status >= 400 && this.logger) this.logger.warn('twitch', `gql ${[].concat(ops).map((o) => o.operationName || 'query').join(',')} answered ${res.status}`);
      if (res.status === 401) throw new AuthError();
      const body = res.json();
      if (this.debugLog) {
        const names = [].concat(ops).map((o) => o.operationName || 'raw query');
        this.debugLog({ ops: names, status: res.status, body: body || res.text.slice(0, 2000) });
      }
      if (!body) throw new Error(`Twitch GQL answered ${res.status}`);
      const list = Array.isArray(body) ? body : [body];
      const sent = [].concat(ops);
      let retry = false;
      const stale = [];
      for (const [i, r] of list.entries()) {
        if (!r) continue;
        if (r.error) {
          if (r.status === 401 || /unauthorized/i.test(r.error)) throw new AuthError();
          throw new Error(`${r.error}: ${r.message || ''}`.trim());
        }
        for (const e of r.errors || []) {
          const msg = e.message || '';
          if (msg === 'server error' && r.data && Array.isArray(e.path)) {
            // Twitch nulls out the broken branch and still returns the rest.
            let node = r.data;
            for (const key of e.path.slice(0, -1)) node = node && node[key];
            if (node) node[e.path[e.path.length - 1]] = null;
          } else if (RETRYABLE.has(msg)) {
            retry = true;
            if (this.logger) this.logger.warn('twitch', `${(r.extensions && r.extensions.operationName) || 'gql'}: ${msg}, retrying`);
            const o = sent[i];
            if (msg === 'PersistedQueryNotFound' && o && o.extensions) stale.push({ name: o.operationName, hash: o.extensions.persistedQuery.sha256Hash });
          } else if (/^unauthorized$/i.test(msg) || /authorization.*token is invalid/i.test(msg)) {
            throw new AuthError();
          } else {
            const opName = (r.extensions && r.extensions.operationName) || 'request';
            throw new Error(`Twitch ${opName}: ${msg}`);
          }
        }
      }
      if (!retry) return body;
      if (stale.length && attempt >= 1) {
        // Twitch rotated a query hash: look up the current one and retry with it.
        const changed = await hashes.repair(stale);
        if (this.logger) this.logger.warn('twitch', `query hashes repaired, ${changed.length} changed: ${changed.join(', ') || 'none'}`);
        for (const o of sent) {
          const fresh = o.extensions && hashes.get(o.operationName);
          if (fresh) o.extensions.persistedQuery.sha256Hash = fresh;
        }
        if (!changed.length && attempt >= 2) {
          const names = [...new Set(stale.map((o) => o.name))].join(', ');
          throw new Error(`Twitch changed how ${names} works and no fix is out yet. Lurk checks again in 30 minutes.`);
        }
      }
      if (attempt >= 3) throw new Error('Twitch keeps failing this request, try again later');
      await sleep(2000 * (attempt + 1));
    }
  }

  async gqlMany(ops) {
    const out = [];
    for (let i = 0; i < ops.length; i += BATCH) {
      const part = await this.gql(ops.slice(i, i + BATCH));
      out.push(...(Array.isArray(part) ? part : [part]));
    }
    return out;
  }

  // ---- drops ----

  async campaigns() {
    const dash = await this.gql(op('campaigns', { fetchRewardCampaigns: false }));
    const list = (dash.data && dash.data.currentUser && dash.data.currentUser.dropCampaigns) || [];
    const live = list.filter((c) => c.status === 'ACTIVE' || c.status === 'UPCOMING');
    const details = await this.gqlMany(live.map((c) => op('campaignDetails', { channelLogin: String(this.userId), dropID: c.id })));
    const byId = new Map();
    for (const r of details) {
      const d = r && r.data && r.data.user && r.data.user.dropCampaign;
      if (d) byId.set(d.id, d);
    }
    return live
      .map((c) => {
        const d = byId.get(c.id) || {};
        // The dashboard's game carries boxArtURL, the details' game carries slug: keep both.
        const game = c.game || d.game ? { ...(c.game || {}), ...(d.game || {}) } : null;
        return normalizeCampaign({ ...c, ...d, game, self: d.self || c.self });
      })
      .filter((c) => c.game);
  }

  async inventory() {
    const r = await this.gql(op('inventory', { fetchRewardCampaigns: false }));
    const inv = (r.data && r.data.currentUser && r.data.currentUser.inventory) || {};
    const campaigns = (inv.dropCampaignsInProgress || []).map(normalizeCampaign).filter((c) => c.game);
    const claimed = (inv.gameEventDrops || []).map((b) => ({
      id: b.id,
      name: b.name,
      image: b.imageURL || null,
      game: b.game ? b.game.displayName || b.game.name : null,
      awardedAt: b.lastAwardedAt,
      count: b.totalCount || 1,
    }));
    return { campaigns, claimed };
  }

  async claim(claimId) {
    const r = await this.gql(op('claimDrop', { input: { dropInstanceID: claimId } }));
    const res = r.data && r.data.claimDropRewards;
    return !!res && ['ELIGIBLE_FOR_ALL', 'DROP_INSTANCE_ALREADY_CLAIMED'].includes(res.status);
  }

  async currentDrop(channelId) {
    const r = await this.gql(op('currentDrop', { channelID: String(channelId), channelLogin: '' }));
    const s = r.data && r.data.currentUser && r.data.currentUser.dropCurrentSession;
    if (!s || !s.dropID) return null;
    return { dropId: s.dropID, minutes: s.currentMinutesWatched || 0, required: s.requiredMinutesWatched || 0 };
  }

  // ---- channel points ----

  async channelPoints(login) {
    const r = await this.gql(op('channelPoints', { channelLogin: login }));
    const ch = r.data && r.data.community && r.data.community.channel;
    const cp = ch && ch.self && ch.self.communityPoints;
    if (!cp) return null;
    return { channelId: ch.id, balance: cp.balance || 0, claimId: cp.availableClaim ? cp.availableClaim.id : null };
  }

  // Returns the points earned by the claim (0 when Twitch didn't say).
  async claimPoints(channelId, claimId) {
    const r = await this.gql(op('claimPoints', { input: { channelID: String(channelId), claimID: claimId } }));
    const res = r.data && r.data.claimCommunityPoints;
    if (!res || res.error) return null;
    return (res.claim && (res.claim.pointsEarnedTotal || res.claim.pointsEarnedBaseline)) || 0;
  }

  // ---- channels ----

  async streamInfo(logins) {
    const res = await this.gqlMany(logins.map((login) => op('streamInfo', { channel: login })));
    return res.map((r, i) => {
      const u = r && r.data && r.data.user;
      if (!u) return null;
      const game = u.broadcastSettings && u.broadcastSettings.game;
      return {
        id: u.id,
        login: u.login || logins[i],
        name: u.displayName || logins[i],
        avatar: u.profileImageURL || null,
        online: !!u.stream,
        viewers: u.stream ? u.stream.viewersCount || 0 : 0,
        gameId: game ? game.id : null,
        gameName: game ? game.displayName || game.name : null,
        title: u.broadcastSettings ? u.broadcastSettings.title : '',
      };
    });
  }

  async gameSlug(game) {
    if (game.slug) return game.slug;
    try {
      const r = await this.gql(op('gameSlug', { name: game.name }));
      const g = r.data && r.data.game;
      if (g && g.slug) return (game.slug = g.slug);
    } catch {}
    return (game.slug = slugify(game.name));
  }

  async gameStreams(game, limit = 30) {
    const slug = await this.gameSlug(game);
    const r = await this.gql(op('gameDirectory', {
      limit,
      slug,
      imageWidth: 50,
      includeCostreaming: false,
      options: {
        broadcasterLanguages: [],
        freeformTags: null,
        includeRestricted: ['SUB_ONLY_LIVE'],
        recommendationsContext: { platform: 'web' },
        sort: 'RELEVANCE',
        systemFilters: ['DROPS_ENABLED'],
        tags: [],
        requestID: 'JIRA-VXP-2397',
      },
      sortTypeIsRecency: false,
    }));
    const edges = (r.data && r.data.game && r.data.game.streams && r.data.game.streams.edges) || [];
    return edges
      .map((e) => e.node)
      .filter((n) => n && n.broadcaster)
      .map((n) => ({
        id: n.broadcaster.id,
        login: n.broadcaster.login,
        name: n.broadcaster.displayName || n.broadcaster.login,
        avatar: n.broadcaster.profileImageURL || null,
        online: true,
        viewers: n.viewersCount || 0,
        gameId: (n.game && n.game.id) || game.id,
        gameName: game.name,
        title: n.title || '',
      }));
  }

  // ---- watching ----

  // Twitch counts a viewer when the stream's media playlist is pulled and its
  // segments are requested. HEAD requests are enough, so no video is downloaded.
  // A network hiccup here is a failed ping, not an error: the engine switches
  // channel after a few in a row.
  async sendWatch(channel) {
    try {
      return await this.pingStream(channel);
    } catch (err) {
      if (err.auth) throw err;
      if (this.logger) this.logger.debug('twitch', `watch ping to ${channel.login} failed: ${err.message}`);
      this.playlists.delete(channel.login);
      return false;
    }
  }

  async pingStream(channel) {
    let pl = this.playlists.get(channel.login);
    if (!pl || Date.now() - pl.at > 10 * 60 * 1000) {
      const t = await this.gql(op('playbackToken', {
        isLive: true, isVod: false, login: channel.login, platform: 'web', playerType: 'site', vodID: '',
      }));
      const tok = t.data && t.data.streamPlaybackAccessToken;
      if (!tok) return false;
      const q = new URLSearchParams({ sig: tok.signature, token: tok.value });
      const master = await request(`https://usher.ttvnw.net/api/channel/hls/${channel.login}.m3u8?${q}`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (master.status !== 200) return false;
      const variants = master.text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('http'));
      if (!variants.length) return false;
      pl = { url: variants[variants.length - 1], at: Date.now() };
      this.playlists.set(channel.login, pl);
    }
    const media = await request(pl.url, { headers: { 'User-Agent': USER_AGENT } });
    if (media.status >= 400) {
      this.playlists.delete(channel.login);
      return false;
    }
    const segments = media.text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('http'));
    if (!segments.length) {
      this.playlists.delete(channel.login);
      return false;
    }
    for (const url of segments) {
      const head = await request(url, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT }, timeout: 10000 });
      if (head.status !== 200) return false;
    }
    return true;
  }
}

module.exports = { TwitchClient, AuthError, CLIENT_ID };
