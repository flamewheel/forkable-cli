import { loadSession, saveSession, clearSession } from './config.js';
import * as Q from './queries.js';

const BASE = process.env.FORKABLE_BASE_URL || 'https://forkable.com/api/v2';
const REFERRER = 'mc';
const UA = 'forkable-cli/0.1 (+https://github.com/; unofficial)';

export class ForkableError extends Error {
  constructor(message, { details, status } = {}) {
    super(message);
    this.name = 'ForkableError';
    this.details = details;
    this.status = status;
  }
}

// Minimal cookie jar: stores name=value pairs and replays them. The Forkable
// session cookie is HttpOnly, so we capture it from Set-Cookie response headers.
class CookieJar {
  constructor(cookies = {}) { this.cookies = { ...cookies }; }
  header() {
    const parts = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`);
    return parts.join('; ');
  }
  absorb(setCookies) {
    for (const raw of setCookies || []) {
      const first = raw.split(';')[0];
      const eq = first.indexOf('=');
      if (eq === -1) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (!name) continue;
      // A cookie deletion (empty value / expired) removes it.
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(raw)) delete this.cookies[name];
      else this.cookies[name] = value;
    }
  }
  toJSON() { return this.cookies; }
}

export class ForkableClient {
  constructor({ session } = {}) {
    session = session || loadSession() || {};
    this.jar = new CookieJar(session.cookies || {});
    this.user = session.user || null;
    this.csrf = null;
  }

  persist() {
    saveSession({ cookies: this.jar.toJSON(), user: this.user, savedAt: new Date().toISOString() });
  }

  isLoggedIn() {
    // Heuristic: we consider the session live if we have any cookies + a known user.
    return !!this.user && Object.keys(this.jar.cookies).length > 0;
  }

  async fetchCsrf() {
    const res = await fetch(`${BASE}/csrf_token`, {
      headers: { 'Accept': 'application/json', 'User-Agent': UA, 'Cookie': this.jar.header() }
    });
    this.jar.absorb(res.headers.getSetCookie?.());
    if (!res.ok) throw new ForkableError(`Failed to fetch CSRF token (HTTP ${res.status})`, { status: res.status });
    const { token } = await res.json();
    this.csrf = token;
    return token;
  }

  async #post(path, body) {
    if (!this.csrf) await this.fetchCsrf();
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Forkable-Referrer': REFERRER,
        'X-CSRF-Token': this.csrf,
        'User-Agent': UA,
        'Cookie': this.jar.header()
      },
      body: JSON.stringify(body)
    });
    this.jar.absorb(res.headers.getSetCookie?.());
    let json;
    try { json = await res.json(); }
    catch { throw new ForkableError(`Non-JSON response (HTTP ${res.status})`, { status: res.status }); }
    return { res, json };
  }

  // Run an authenticated GraphQL query. `endpoint` can be '/graphql' or '/public/graphql'.
  async gql(query, { variables = {}, endpoint = '/graphql' } = {}) {
    const { res, json } = await this.#post(endpoint, { query, variables });
    if (res.status === 401) throw new ForkableError('Not authenticated — run `forkable login` first.', { status: 401 });
    if (json.errors?.length) {
      throw new ForkableError(json.errors.map(e => e.message).join('; '), { details: json.errors, status: res.status });
    }
    return json.data;
  }

  // Mirrors the SPA's _mutate2 helper: mutation ($input: <Name>Input!) { name(input:$input){ fields } }
  async mutate(name, fields, input, { endpoint = '/graphql' } = {}) {
    const Pascal = name.charAt(0).toUpperCase() + name.slice(1);
    const query = `mutation ($input: ${Pascal}Input!) { ${name}(input: $input) { ${fields} } }`;
    const data = await this.gql(query, { variables: { input }, endpoint });
    return data[name];
  }

  // ---- High-level operations -------------------------------------------------

  async login({ email, password, mfaCode }) {
    email = (email || '').trim().toLowerCase();
    await this.fetchCsrf(); // also seeds initial cookies
    const input = { email, password };
    if (mfaCode) input.mfaCode = mfaCode;
    // createSession establishes the session. The SPA sends it to /graphql, but fall
    // back to /public/graphql if a pre-session mutation is rejected there.
    let result;
    try {
      result = await this.mutate('createSession', Q.CREATE_SESSION_FIELDS, input);
    } catch (e) {
      if (e.status === 401) {
        result = await this.mutate('createSession', Q.CREATE_SESSION_FIELDS, input, { endpoint: '/public/graphql' });
      } else {
        throw e;
      }
    }
    const errs = result?.errorDetails;
    if (errs && errs.length) throw new ForkableError(errs.join('; '), { details: errs });
    if (!result?.user) throw new ForkableError('Login failed: no user returned (check credentials / MFA).');
    this.user = result.user;
    this.persist();
    return result.user;
  }

  logout() {
    this.user = null;
    this.jar = new CookieJar({});
    clearSession();
  }

  async me() { return (await this.gql(Q.ME_BASIC)).me; }

  async deliveries(from) { return (await this.gql(Q.myDeliveries(from))).myDeliveries; }

  async menus(ids, clubId) { return (await this.gql(Q.menus(ids, clubId))).menus; }

  async scores(deliveryId, userId, menuIds) {
    return (await this.gql(Q.mealGenerationScores(deliveryId, userId, menuIds))).mealGenerationScores;
  }

  async restrictions(userId, menuId, itemId, customizationJson) {
    return (await this.gql(Q.mealRestrictions(userId, menuId, itemId, customizationJson))).mealRestrictions;
  }

  // Choose/replace the meal in a delivery slot.
  async replacePiece({ deliveryId, itemId, menuId, oldPieceId, selectionsHash = {}, instructions = '' }) {
    const input = {
      deliveryId, itemId, menuId, oldPieceId,
      instructions,
      selectionsHash,
      fromTopRated: false,
      myMeals: true
    };
    const result = await this.mutate('replacePiece', Q.REPLACE_PIECE_FIELDS, input);
    const errs = result?.errorDetails;
    if (errs && errs.length) throw new ForkableError(errs.join('; '), { details: errs });
    return result;
  }
}
