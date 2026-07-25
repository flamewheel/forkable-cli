#!/usr/bin/env node
import { Command } from 'commander';
import { ForkableClient, ForkableError } from '../src/client.js';
import { loadPrefs, savePrefs, configDir } from '../src/config.js';
import { ask, askHidden } from '../src/prompt.js';
import { rankItems, pickBest, buildDefaultSelections } from '../src/prefs.js';
import {
  mondayOf, nextMonday, fmtDay, userPiece, flattenMenuItems, money, out, die, isChangeable
} from '../src/util.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Read version from package.json so --version never drifts from the published version.
const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'));

const program = new Command();
program
  .name('forkable')
  .description('Unofficial CLI for Forkable lunch ordering — for humans and their agents.')
  .version(pkg.version)
  .option('--json', 'output machine-readable JSON (great for agents)', false);

const isJson = () => program.opts().json;

function client() {
  return new ForkableClient();
}

function requireLogin(c) {
  if (!c.isLoggedIn()) {
    throw new ForkableError('Not logged in. Run `forkable login` (or set FORKABLE_EMAIL / FORKABLE_PASSWORD).', { status: 401 });
  }
}

// Resolve which week to operate on from --week / --next flags.
function resolveWeek(opts) {
  if (opts.week) return opts.week;
  if (opts.next) return nextMonday();
  return mondayOf();
}

// ---- login -----------------------------------------------------------------
program.command('login')
  .description('Log in with email + password (credentials can come from flags, env, or prompt)')
  .option('-e, --email <email>', 'account email', process.env.FORKABLE_EMAIL)
  .option('-p, --password <password>', 'account password (env FORKABLE_PASSWORD preferred)', process.env.FORKABLE_PASSWORD)
  .option('--mfa <code>', 'MFA code, if your account requires it')
  .action(async (opts) => {
    try {
      const c = client();
      let { email, password, mfa } = opts;
      if (!email && process.stdin.isTTY) email = await ask('Email: ');
      if (!password && process.stdin.isTTY) password = await askHidden('Password: ');
      if (!email || !password) throw new ForkableError('Email and password are required.');
      const user = await c.login({ email, password, mfaCode: mfa });
      out({ ok: true, user }, () => {
        console.log(`Logged in as ${user.firstName} ${user.lastName} <${user.email}>.`);
      }, isJson());
    } catch (e) { die(e, isJson()); }
  });

// ---- logout ----------------------------------------------------------------
program.command('logout')
  .description('Clear the saved session')
  .action(() => {
    try {
      const c = client();
      c.logout();
      out({ ok: true }, () => console.log('Logged out.'), isJson());
    } catch (e) { die(e, isJson()); }
  });

// ---- whoami ----------------------------------------------------------------
program.command('whoami')
  .description('Show the currently logged-in user')
  .action(async () => {
    try {
      const c = client();
      requireLogin(c);
      const me = await c.me();
      out({ ok: true, me }, () => {
        console.log(`${me.firstName} ${me.lastName} <${me.email}>`);
        console.log(`  user id:        ${me.id}`);
        console.log(`  auto-order:     ${me.mealClubAutoOrder ? 'on' : 'off'}`);
        console.log(`  meal clubs:     ${(me.mealClubs || []).map(m => m.id).join(', ') || '(none)'}`);
        if ((me.likes || []).length) console.log(`  likes:          ${me.likes.join(', ')}`);
        if ((me.dislikes || []).length) console.log(`  dislikes:       ${me.dislikes.join(', ')}`);
      }, isJson());
    } catch (e) { die(e, isJson()); }
  });

// ---- week / upcoming -------------------------------------------------------
program.command('week')
  .alias('upcoming')
  .description('Show your scheduled meals for a week')
  .option('-w, --week <YYYY-MM-DD>', 'Monday of the week to show')
  .option('-n, --next', 'show next week instead of this week', false)
  .action(async (opts) => {
    try {
      const c = client();
      requireLogin(c);
      const from = resolveWeek(opts);
      const deliveries = await c.deliveries(from);
      const me = c.user || (await c.me());
      const view = deliveries.map(d => {
        const piece = userPiece(d, me.id);
        return {
          deliveryId: d.id,
          day: d.forDeliveryAt,
          state: d.simpleState || d.state,
          canChange: isChangeable(d),
          club: d.club?.name,
          meal: piece ? { pieceId: piece.id, itemId: piece.itemId, menuId: piece.menuId, name: piece.name, price: piece.price, autoOrder: piece.autoOrder } : null
        };
      });
      out({ ok: true, week: from, deliveries: view }, () => {
        console.log(`Week of ${from}:\n`);
        for (const d of view) {
          const meal = d.meal ? d.meal.name : '(no meal scheduled)';
          const lock = d.canChange ? '' : '  🔒';
          const auto = d.meal?.autoOrder ? '  (auto)' : '';
          console.log(`  ${fmtDay(d.day).padEnd(12)} ${meal}${auto}${lock}`);
        }
        console.log('\nUse `forkable menu <deliveryId>` to see options, `forkable choose` to pick.');
      }, isJson());
    } catch (e) { die(e, isJson()); }
  });

// ---- menu ------------------------------------------------------------------
program.command('menu')
  .argument('<deliveryId>', 'delivery id (from `forkable week`)')
  .description('Show menu options for a delivery, ranked by your preferences')
  .option('-w, --week <YYYY-MM-DD>', 'week the delivery belongs to (defaults to this week, then next)')
  .option('-n, --next', 'look in next week', false)
  .option('--all', 'show all items, not just the top 15', false)
  .action(async (deliveryId, opts) => {
    try {
      const c = client();
      requireLogin(c);
      const { delivery, items, ranked } = await loadDeliveryMenu(c, Number(deliveryId), opts);
      const hide = delivery.club?.hidePrices;
      const top = opts.all ? ranked : ranked.slice(0, 15);
      out({ ok: true, deliveryId: delivery.id, day: delivery.forDeliveryAt, count: items.length,
            items: top.map(r => ({ itemId: r.item.id, menuId: r.item.menuId, name: r.item.name, venue: r.item.venue,
              price: r.item.price, score: Number(r.score.toFixed(3)), eligible: r.eligible, reason: r.reason })) },
        () => {
          console.log(`Menu for ${fmtDay(delivery.forDeliveryAt)} — ${items.length} items (top ${top.length} by preference):\n`);
          top.forEach((r, i) => {
            const flag = r.eligible ? ' ' : '✗';
            const price = money(r.item.price, hide);
            console.log(`  ${flag} ${String(i + 1).padStart(2)}. ${r.item.name}  ${price}`);
            console.log(`        ${r.item.venue}  ·  score ${r.score.toFixed(2)}${r.reason ? '  ·  ' + r.reason : ''}`);
          });
          console.log(`\nPick #1 automatically:  forkable choose ${delivery.id} --best`);
          console.log(`Pick a specific item:   forkable choose ${delivery.id} --item <itemId> --menu <menuId>`);
        }, isJson());
    } catch (e) { die(e, isJson()); }
  });

// ---- choose ----------------------------------------------------------------
program.command('choose')
  .argument('<deliveryId>', 'delivery id (from `forkable week`)')
  .description('Choose a meal for a delivery — by preference (--best) or explicitly')
  .option('-w, --week <YYYY-MM-DD>', 'week the delivery belongs to')
  .option('-n, --next', 'look in next week', false)
  .option('--best', 'auto-pick the top preference match', false)
  .option('--item <itemId>', 'explicit item id')
  .option('--menu <menuId>', 'explicit menu id (required with --item)')
  .option('--instructions <text>', 'special instructions', '')
  .option('--dry-run', 'show what would be ordered without ordering', false)
  .action(async (deliveryId, opts) => {
    try {
      const c = client();
      requireLogin(c);
      const { delivery, items, ranked } = await loadDeliveryMenu(c, Number(deliveryId), opts);
      const me = c.user || (await c.me());
      const current = userPiece(delivery, me.id);
      if (!isChangeable(delivery)) {
        throw new ForkableError(`This delivery can no longer be changed (past the deadline).`);
      }

      let chosen;
      if (opts.item) {
        const menuId = opts.menu ? Number(opts.menu) : null;
        chosen = items.find(it => it.id === Number(opts.item) && (menuId == null || it.menuId === menuId));
        if (!chosen) throw new ForkableError(`Item ${opts.item} not found in this delivery's menus.`);
      } else if (opts.best) {
        const best = ranked.find(r => r.eligible);
        if (!best) throw new ForkableError('No eligible item matches your preferences.');
        chosen = best.item;
      } else {
        throw new ForkableError('Specify --best or --item <itemId> --menu <menuId>.');
      }

      const selectionsHash = buildDefaultSelections(chosen);
      const plan = {
        deliveryId: delivery.id, day: delivery.forDeliveryAt,
        replacing: current ? current.name : null,
        choosing: { itemId: chosen.id, menuId: chosen.menuId, name: chosen.name, venue: chosen.venue, price: chosen.price },
        selectionsHash
      };

      if (opts.dryRun) {
        out({ ok: true, dryRun: true, plan }, () => {
          console.log(`[dry run] Would order for ${fmtDay(delivery.forDeliveryAt)}:`);
          console.log(`  ${chosen.name} — ${chosen.venue} ${money(chosen.price, delivery.club?.hidePrices)}`);
          if (current) console.log(`  (replacing: ${current.name})`);
        }, isJson());
        return;
      }

      const result = await c.replacePiece({
        deliveryId: delivery.id,
        itemId: chosen.id,
        menuId: chosen.menuId,
        oldPieceId: current?.id,
        selectionsHash,
        instructions: opts.instructions
      });

      out({ ok: true, ordered: plan.choosing, day: delivery.forDeliveryAt, result }, () => {
        console.log(`✓ Ordered for ${fmtDay(delivery.forDeliveryAt)}: ${chosen.name} — ${chosen.venue}`);
        if (current) console.log(`  (replaced ${current.name})`);
      }, isJson());
    } catch (e) { die(e, isJson()); }
  });

// ---- auto: fill the whole week by preference -------------------------------
program.command('auto')
  .description('Auto-choose the best preference match for every changeable day in a week')
  .option('-w, --week <YYYY-MM-DD>', 'Monday of the week')
  .option('-n, --next', 'operate on next week', false)
  .option('--dry-run', 'show the plan without ordering', false)
  .action(async (opts) => {
    try {
      const c = client();
      requireLogin(c);
      const from = resolveWeek(opts);
      const deliveries = await c.deliveries(from);
      const me = c.user || (await c.me());
      const prefs = loadPrefs();
      const results = [];
      for (const d of deliveries) {
        if (!isChangeable(d)) {
          results.push({ deliveryId: d.id, day: d.forDeliveryAt, skipped: 'locked' });
          continue;
        }
        const menuIds = d.availableMenuIds || [];
        if (!menuIds.length) { results.push({ deliveryId: d.id, day: d.forDeliveryAt, skipped: 'no menus' }); continue; }
        const menus = await c.menus(menuIds, d.club.id);
        const items = flattenMenuItems(menus);
        let scoresByKey = {};
        try {
          const scores = await c.scores(d.id, me.id, menuIds);
          scoresByKey = Object.fromEntries(scores.map(s => [`${s.menuId}:${s.itemId}`, s.score]));
        } catch { /* scores are best-effort */ }
        const best = pickBest(items, prefs, scoresByKey);
        if (!best) { results.push({ deliveryId: d.id, day: d.forDeliveryAt, skipped: 'no eligible item' }); continue; }
        const current = userPiece(d, me.id);
        const selectionsHash = buildDefaultSelections(best.item);
        if (opts.dryRun) {
          results.push({ deliveryId: d.id, day: d.forDeliveryAt, wouldOrder: best.item.name, venue: best.item.venue });
          continue;
        }
        await c.replacePiece({
          deliveryId: d.id, itemId: best.item.id, menuId: best.item.menuId,
          oldPieceId: current?.id, selectionsHash
        });
        results.push({ deliveryId: d.id, day: d.forDeliveryAt, ordered: best.item.name, venue: best.item.venue });
      }
      out({ ok: true, week: from, dryRun: !!opts.dryRun, results }, () => {
        console.log(`${opts.dryRun ? '[dry run] ' : ''}Auto-order for week of ${from}:\n`);
        for (const r of results) {
          const label = r.ordered || r.wouldOrder || `— skipped (${r.skipped})`;
          console.log(`  ${fmtDay(r.day).padEnd(12)} ${label}${r.venue ? '  · ' + r.venue : ''}`);
        }
      }, isJson());
    } catch (e) { die(e, isJson()); }
  });

// ---- prefs -----------------------------------------------------------------
const prefsCmd = program.command('prefs').description('View or edit your local ordering preferences');
prefsCmd.command('show').description('Show current preferences').action(() => {
  const p = loadPrefs();
  out({ ok: true, prefs: p, configDir: configDir() }, () => {
    console.log('Preferences:');
    console.log(JSON.stringify(p, null, 2));
    console.log(`\n(stored in ${configDir()})`);
  }, isJson());
});
prefsCmd.command('set')
  .description('Set a preference field')
  .argument('<field>', 'likes | dislikes | avoid | diet | maxPrice | forkableScoreWeight')
  .argument('<value>', 'value; for list fields use comma-separated values')
  .action((field, value) => {
    try {
      const p = loadPrefs();
      if (['likes', 'dislikes', 'avoid'].includes(field)) {
        p[field] = value.split(',').map(s => s.trim()).filter(Boolean);
      } else if (field === 'diet') {
        p.diet = value === 'none' ? null : value;
      } else if (field === 'maxPrice') {
        p.maxPrice = value === 'none' ? null : Number(value);
      } else if (field === 'forkableScoreWeight') {
        p.forkableScoreWeight = Number(value);
      } else {
        throw new ForkableError(`Unknown field: ${field}`);
      }
      savePrefs(p);
      out({ ok: true, prefs: p }, () => console.log(`Updated ${field}.`), isJson());
    } catch (e) { die(e, isJson()); }
  });

// Shared: load a delivery + its ranked menu items.
async function loadDeliveryMenu(c, deliveryId, opts) {
  const weeks = [];
  if (opts.week) weeks.push(opts.week);
  else if (opts.next) weeks.push(nextMonday());
  else { weeks.push(mondayOf()); weeks.push(nextMonday()); }

  let delivery = null;
  for (const w of weeks) {
    const deliveries = await c.deliveries(w);
    delivery = deliveries.find(d => d.id === deliveryId);
    if (delivery) break;
  }
  if (!delivery) throw new ForkableError(`Delivery ${deliveryId} not found in ${weeks.join(' or ')}.`);

  const menuIds = delivery.availableMenuIds || [];
  if (!menuIds.length) throw new ForkableError('No menus available for this delivery.');
  const menus = await c.menus(menuIds, delivery.club.id);
  const items = flattenMenuItems(menus);
  const me = c.user || (await c.me());
  let scoresByKey = {};
  try {
    const scores = await c.scores(delivery.id, me.id, menuIds);
    scoresByKey = Object.fromEntries(scores.map(s => [`${s.menuId}:${s.itemId}`, s.score]));
  } catch { /* best-effort */ }
  const prefs = loadPrefs();
  const ranked = rankItems(items, prefs, scoresByKey);
  return { delivery, items, ranked };
}

program.parseAsync(process.argv);
