#!/usr/bin/env node
import { Command } from 'commander';
import { ForkableClient, ForkableError } from '../src/client.js';
import { loadPrefs, savePrefs, configDir, appendDecision, loadDecisions } from '../src/config.js';
import { ask, askHidden } from '../src/prompt.js';
import { rankItems, pickBest, buildDefaultSelections, resolveSelections } from '../src/prefs.js';
import {
  mondayOf, nextMonday, fmtDay, userPiece, flattenMenuItems, money, out, die, isChangeable,
  itemView, selectedAddOns
} from '../src/util.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

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

// ---- init: install the Claude Code skill + print setup steps ----------------
program.command('init')
  .description('Install the Claude Code skill so you can order by chatting with Claude, and print next steps')
  .option('--force', 'overwrite an already-installed skill', false)
  .action((opts) => {
    try {
      const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
      const srcDir = join(pkgRoot, 'claude-skill', 'forkable');
      if (!existsSync(join(srcDir, 'SKILL.md'))) throw new ForkableError('Bundled skill not found in this install.');
      const destDir = join(homedir(), '.claude', 'skills', 'forkable');
      const dest = join(destDir, 'SKILL.md');
      const existed = existsSync(dest);
      let wrote = false;
      if (!existed || opts.force) {
        // Copy the whole skill directory, not just SKILL.md - it links to reference/ files via
        // progressive disclosure, and installing the index alone leaves those links dangling.
        mkdirSync(destDir, { recursive: true });
        cpSync(srcDir, destDir, { recursive: true });
        wrote = true;
      }
      out({ ok: true, skill: dest, installed: wrote, alreadyPresent: existed && !wrote }, () => {
        if (wrote) console.log(`✓ Installed the Claude Code skill to ${dest}`);
        else console.log(`Skill already present at ${dest} (use --force to overwrite).`);
        console.log('\nNext steps:');
        console.log('  1. Log in (run in a real terminal, not via an agent - the password prompt needs a TTY):');
        console.log('       forkable login');
        console.log('  2. Restart Claude Code so it loads the skill.');
        console.log('  3. Then just talk to Claude: "set my forkable prefs to X", "what\'s for lunch next week",');
        console.log('     "order me next week." It runs the CLI, shows a plan, and confirms before ordering.');
      }, isJson());
    } catch (e) { die(e, isJson()); }
  });

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
          // Forkable exposes no cutoff timestamp, only these flags, so say which one is blocking
          // rather than leaving a caller to guess at a deadline that isn't in the API.
          changeBlockedBy: isChangeable(d) ? null : (d.isReadOnly ? 'read-only' : 'past late-order deadline'),
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
      const { delivery, items, ranked, me } = await loadDeliveryMenu(c, Number(deliveryId), opts);
      const hide = delivery.club?.hidePrices;
      const top = opts.all ? ranked : ranked.slice(0, 15);

      // Surface the currently-scheduled meal explicitly. Forkable's own suggestion frequently
      // ranks outside the top 15, so a caller comparing "suggested vs. alternative" could not
      // otherwise see what it's replacing without re-fetching with --all.
      const piece = userPiece(delivery, me.id);
      const pieceItem = piece ? items.find(it => it.id === piece.itemId && it.menuId === piece.menuId) : null;
      const current = piece
        ? {
            ...(pieceItem
              ? itemView(pieceItem)
              : { itemId: piece.itemId, menuId: piece.menuId, name: piece.name, venue: null, price: piece.price }),
            pieceId: piece.id,
            autoOrder: piece.autoOrder ?? null,
            selectedAddOns: pieceItem ? selectedAddOns(pieceItem, piece.selections) : []
          }
        : null;

      out({ ok: true, deliveryId: delivery.id, day: delivery.forDeliveryAt, count: items.length,
            canChange: isChangeable(delivery),
            changeBlockedBy: isChangeable(delivery) ? null : (delivery.isReadOnly ? 'read-only' : 'past late-order deadline'),
            current,
            items: top.map(r => ({ ...itemView(r.item),
              score: Number(r.score.toFixed(3)), eligible: r.eligible, reason: r.reason })) },
        () => {
          console.log(`Menu for ${fmtDay(delivery.forDeliveryAt)} — ${items.length} items (top ${top.length} by preference):\n`);
          if (current) {
            console.log(`  Currently scheduled: ${current.name}  ${money(current.price, hide)}${current.autoOrder ? '  (auto)' : ''}`);
            if (current.description) console.log(`        ${current.description}`);
            for (const a of current.selectedAddOns || []) {
              console.log(`        ${a.modifier}: ${a.option}${a.price ? ` +${money(a.price, hide)}` : ''}`);
            }
            console.log('');
          }
          top.forEach((r, i) => {
            const flag = r.eligible ? ' ' : '✗';
            const price = money(r.item.price, hide);
            const mods = (r.item.modifiers || []);
            const req = mods.filter(m => m.required || (m.min != null && m.min >= 1)).length;
            console.log(`  ${flag} ${String(i + 1).padStart(2)}. ${r.item.name}  ${price}`);
            console.log(`        ${r.item.venue}  ·  score ${r.score.toFixed(2)}${r.reason ? '  ·  ' + r.reason : ''}`);
            if (r.item.description) console.log(`        ${r.item.description}`);
            if (mods.length) console.log(`        add-ons: ${mods.length} group(s), ${req} required`);
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
  .option('--select <json>', 'add-on choices as {"modifierId":[optionId]} — omitted groups fall back to preference-aware defaults')
  .option('--force', 'order even if Forkable reports a dietary conflict', false)
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

      let requested = null;
      if (opts.select) {
        try {
          requested = JSON.parse(opts.select);
        } catch {
          throw new ForkableError('--select must be JSON, e.g. --select \'{"12":[9]}\'');
        }
      }
      const prefs = loadPrefs();
      const { selectionsHash, chosen: picks, pricing, issues, needsChoice } =
        resolveSelections(chosen, requested, prefs);
      if (issues.length) throw new ForkableError(`Invalid add-on selection: ${issues.join('; ')}`);

      // Forkable can flag dietary conflicts for a specific item + add-on configuration. Only
      // meaningful once selections are resolved, so it runs here rather than during ranking.
      let conflicts = [];
      try {
        const res = await c.restrictions(me.id, chosen.menuId, chosen.id, selectionsHash);
        conflicts = res?.conflicts || [];
      } catch { /* best-effort, same as scores */ }

      const hidePrices = delivery.club?.hidePrices;
      const plan = {
        deliveryId: delivery.id, day: delivery.forDeliveryAt,
        replacing: current ? current.name : null,
        choosing: { itemId: chosen.id, menuId: chosen.menuId, name: chosen.name, venue: chosen.venue, price: chosen.price },
        addOns: picks, pricing, needsChoice, conflicts,
        selectionsHash
      };

      const printPlan = (prefix) => {
        console.log(`${prefix} for ${fmtDay(delivery.forDeliveryAt)}:`);
        console.log(`  ${chosen.name} — ${chosen.venue} ${money(pricing.base, hidePrices)}`);
        for (const p of picks) {
          const extra = p.price ? ` +${money(p.price, hidePrices)}` : ' (included)';
          console.log(`    ${p.modifier}: ${p.option}${extra}${p.auto ? '  [auto]' : ''}`);
        }
        if (pricing.surcharge > 0) console.log(`  total: ${money(pricing.total, hidePrices)}`);
        if (current) console.log(`  (replacing: ${current.name})`);
        for (const n of needsChoice) {
          console.log(`  ! "${n.modifier}" was auto-picked (${n.autoPicked}) from ${n.options.length} options — pass --select to decide`);
        }
        for (const c2 of conflicts) console.log(`  ! dietary conflict: ${c2}`);
      };

      if (opts.dryRun) {
        out({ ok: true, dryRun: true, plan }, () => printPlan('[dry run] Would order'), isJson());
        return;
      }

      if (conflicts.length && !opts.force) {
        throw new ForkableError(
          `Forkable reports a dietary conflict for this configuration: ${conflicts.join('; ')}. Re-run with --force to order anyway.`
        );
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
  .argument('<field>', 'likes | dislikes | avoid | diet | maxPrice | forkableScoreWeight | notes')
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
      } else if (field === 'notes') {
        // Replace all notes; empty string clears them. Use `prefs add-note` to append one.
        p.notes = value.trim() ? [value.trim()] : [];
      } else {
        throw new ForkableError(`Unknown field: ${field}`);
      }
      savePrefs(p);
      out({ ok: true, prefs: p }, () => console.log(`Updated ${field}.`), isJson());
    } catch (e) { die(e, isJson()); }
  });
prefsCmd.command('add-note')
  .description('Append an open-ended, free-text preference (interpreted by an AI agent at order time)')
  .argument('<text>', 'e.g. "lighter lunches on meeting-heavy days"')
  .action((text) => {
    try {
      const p = loadPrefs();
      p.notes = [...(p.notes || []), text.trim()].filter(Boolean);
      savePrefs(p);
      out({ ok: true, prefs: p }, () => console.log(`Added note. ${p.notes.length} total.`), isJson());
    } catch (e) { die(e, isJson()); }
  });

// ---- learning log ----------------------------------------------------------
program.command('log')
  .description('Append a decision to the learning log (suggested -> recommended -> chosen)')
  .argument('<json>', 'JSON object, e.g. \'{"day":"2026-08-04","suggested":"Bone-in Chicken","recommended":"swap:Salmon Bowl","chose":"Salmon Bowl","accepted":true,"reason":"lighter + no bone"}\'')
  .action((jsonStr) => {
    try {
      let rec;
      try { rec = JSON.parse(jsonStr); } catch { throw new ForkableError('Argument must be valid JSON.'); }
      if (typeof rec !== 'object' || Array.isArray(rec) || rec === null) throw new ForkableError('Argument must be a JSON object.');
      appendDecision(rec);
      out({ ok: true, logged: rec }, () => console.log('Logged decision.'), isJson());
    } catch (e) { die(e, isJson()); }
  });
program.command('decisions')
  .description('Show the learning log (past suggested/recommended/chosen decisions)')
  .option('--limit <n>', 'show only the most recent N', v => parseInt(v, 10))
  .action((opts) => {
    try {
      const recs = loadDecisions(opts.limit);
      out({ ok: true, count: recs.length, decisions: recs }, () => {
        if (!recs.length) { console.log('No decisions logged yet.'); return; }
        for (const r of recs) {
          const when = String(r.day || r.week || r.loggedAt || '').slice(0, 10);
          const took = r.accepted === false ? ' [overrode]' : (r.accepted === true ? ' [accepted]' : '');
          console.log(`${when}  ${r.suggested ?? '?'} -> rec: ${r.recommended ?? '?'} -> chose: ${r.chose ?? '?'}${took}${r.reason ? '  (' + r.reason + ')' : ''}`);
        }
      }, isJson());
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
  return { delivery, items, ranked, me };
}

program.parseAsync(process.argv);
