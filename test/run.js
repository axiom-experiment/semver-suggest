'use strict';

/**
 * test/run.js
 * Custom test runner for semver-suggest — no external dependencies.
 * Uses Node.js assert module. Prints ✓/✗ per test, summary at end.
 * Exits with code 1 if any test fails.
 */

const assert = require('assert');
const path = require('path');

const { parseCommit, classifyCommit, resolveBump, analyze } = require('../lib/analyzer');
const { parseSemver, applyBump, formatOutput, colorizeBump } = require('../lib/semver');
const { parseGitLog } = require('../lib/git');

// ─── Test runner infrastructure ───────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  \u2713 ${name}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  \u2717 ${name}\n`);
    process.stdout.write(`    ${err.message}\n`);
    failed++;
    failures.push({ name, message: err.message });
  }
}

function section(title) {
  process.stdout.write(`\n\u25BA ${title}\n`);
}

function eq(actual, expected) {
  assert.strictEqual(actual, expected);
}

function deepEq(actual, expected) {
  assert.deepStrictEqual(actual, expected);
}

function ok(value, msg) {
  assert.ok(value, msg);
}

// ─── SECTION 1: parseCommit ───────────────────────────────────────────────────

section('parseCommit — basic conventional commit formats');

test('parses feat: commit', () => {
  const r = parseCommit('feat: add dark mode');
  eq(r.type, 'feat');
  eq(r.breaking, false);
  eq(r.description, 'add dark mode');
  eq(r.scope, null);
});

test('parses fix: commit', () => {
  const r = parseCommit('fix: resolve null pointer on login');
  eq(r.type, 'fix');
  eq(r.breaking, false);
  eq(r.description, 'resolve null pointer on login');
});

test('parses chore: commit', () => {
  const r = parseCommit('chore: update dependencies');
  eq(r.type, 'chore');
  eq(r.breaking, false);
});

test('parses docs: commit', () => {
  const r = parseCommit('docs: update README');
  eq(r.type, 'docs');
});

test('parses style: commit', () => {
  const r = parseCommit('style: format with prettier');
  eq(r.type, 'style');
});

test('parses refactor: commit', () => {
  const r = parseCommit('refactor: extract auth middleware');
  eq(r.type, 'refactor');
});

test('parses test: commit', () => {
  const r = parseCommit('test: add unit tests for parser');
  eq(r.type, 'test');
});

test('parses perf: commit', () => {
  const r = parseCommit('perf: optimize database queries');
  eq(r.type, 'perf');
});

test('parses build: commit', () => {
  const r = parseCommit('build: upgrade webpack to v5');
  eq(r.type, 'build');
});

test('parses ci: commit', () => {
  const r = parseCommit('ci: add GitHub Actions workflow');
  eq(r.type, 'ci');
});

test('parses revert: commit', () => {
  const r = parseCommit('revert: revert feat: add dark mode');
  eq(r.type, 'revert');
});

section('parseCommit — scoped commits');

test('parses feat(auth): commit with scope', () => {
  const r = parseCommit('feat(auth): add OAuth2 support');
  eq(r.type, 'feat');
  eq(r.scope, 'auth');
  eq(r.description, 'add OAuth2 support');
  eq(r.breaking, false);
});

test('parses fix(api): commit with scope', () => {
  const r = parseCommit('fix(api): handle 429 rate limit response');
  eq(r.type, 'fix');
  eq(r.scope, 'api');
});

test('parses commit with multi-word scope', () => {
  const r = parseCommit('feat(user-profile): add avatar upload');
  eq(r.type, 'feat');
  eq(r.scope, 'user-profile');
});

section('parseCommit — breaking changes via ! marker');

test('parses feat!: breaking change via ! marker', () => {
  const r = parseCommit('feat!: remove legacy API endpoints');
  eq(r.type, 'feat');
  eq(r.breaking, true);
});

test('parses fix!: breaking fix', () => {
  const r = parseCommit('fix!: change error response format');
  eq(r.type, 'fix');
  eq(r.breaking, true);
});

test('parses feat(scope)!: breaking change with scope', () => {
  const r = parseCommit('feat(auth)!: remove basic auth support');
  eq(r.type, 'feat');
  eq(r.scope, 'auth');
  eq(r.breaking, true);
});

test('parses chore(deps)!: breaking dependency update', () => {
  const r = parseCommit('chore(deps)!: drop Node.js 12 support');
  eq(r.type, 'chore');
  eq(r.breaking, true);
});

section('parseCommit — BREAKING CHANGE in body/footer');

test('detects BREAKING CHANGE in body', () => {
  const r = parseCommit('feat: new auth system', 'BREAKING CHANGE: JWT tokens are now required');
  eq(r.breaking, true);
  eq(r.type, 'feat');
});

test('detects BREAKING CHANGE in footer', () => {
  const r = parseCommit('refactor: restructure config', 'Some description\n\nBREAKING CHANGE: config file format changed');
  eq(r.breaking, true);
});

test('detects BREAKING-CHANGE with hyphen', () => {
  const r = parseCommit('feat: update', 'BREAKING-CHANGE: dropped support for IE11');
  eq(r.breaking, true);
});

test('detects BREAKING CHANGE case-insensitively', () => {
  const r = parseCommit('feat: something', 'breaking change: the API is different now');
  eq(r.breaking, true);
});

test('does not falsely detect BREAKING CHANGE when absent', () => {
  const r = parseCommit('feat: add feature', 'This is a normal body with no breaking changes mentioned.');
  eq(r.breaking, false);
});

section('parseCommit — non-conventional commits');

test('returns unknown type for plain commit message', () => {
  const r = parseCommit('update the login page');
  eq(r.type, 'unknown');
  eq(r.breaking, false);
});

test('returns unknown type for merge commit', () => {
  const r = parseCommit("Merge branch 'feature/dark-mode' into main");
  eq(r.type, 'unknown');
});

test('WIP: parses as wip type, classified as unknown bucket', () => {
  const r = parseCommit('WIP: still working on this');
  // WIP: matches the type: description pattern, so type is 'wip'
  // Not in known type sets, so classifyCommit returns 'unknown'
  eq(r.type, 'wip');
  eq(classifyCommit(r), 'unknown');
});

test('handles empty subject gracefully', () => {
  const r = parseCommit('');
  eq(r.type, 'unknown');
  eq(r.breaking, false);
});

test('handles null subject gracefully', () => {
  const r = parseCommit(null);
  eq(r.type, 'unknown');
  eq(r.breaking, false);
});

test('handles undefined body gracefully', () => {
  const r = parseCommit('feat: something', undefined);
  eq(r.type, 'feat');
  eq(r.breaking, false);
});

test('parses feature: as alias for feat', () => {
  const r = parseCommit('feature: add new UI');
  eq(r.type, 'feature');
});

test('parses bugfix: as patch type', () => {
  const r = parseCommit('bugfix: fix crash on startup');
  eq(r.type, 'bugfix');
});

test('parses hotfix: as patch type', () => {
  const r = parseCommit('hotfix: patch security vulnerability');
  eq(r.type, 'hotfix');
});

// ─── SECTION 2: classifyCommit ────────────────────────────────────────────────

section('classifyCommit — bump category resolution');

test('classifies feat as minor', () => {
  const p = parseCommit('feat: add something');
  eq(classifyCommit(p), 'minor');
});

test('classifies feature as minor', () => {
  const p = parseCommit('feature: add something');
  eq(classifyCommit(p), 'minor');
});

test('classifies fix as patch', () => {
  const p = parseCommit('fix: fix something');
  eq(classifyCommit(p), 'patch');
});

test('classifies chore as patch', () => {
  const p = parseCommit('chore: update deps');
  eq(classifyCommit(p), 'patch');
});

test('classifies docs as patch', () => {
  const p = parseCommit('docs: improve readme');
  eq(classifyCommit(p), 'patch');
});

test('classifies refactor as patch', () => {
  const p = parseCommit('refactor: clean up code');
  eq(classifyCommit(p), 'patch');
});

test('classifies perf as patch', () => {
  const p = parseCommit('perf: speed up parsing');
  eq(classifyCommit(p), 'patch');
});

test('classifies breaking feat as major', () => {
  const p = parseCommit('feat!: new API');
  eq(classifyCommit(p), 'major');
});

test('classifies breaking fix as major', () => {
  const p = parseCommit('fix!: change response format');
  eq(classifyCommit(p), 'major');
});

test('classifies unknown commit as unknown', () => {
  const p = parseCommit('updated stuff');
  eq(classifyCommit(p), 'unknown');
});

test('classifies breaking change in body as major', () => {
  const p = parseCommit('feat: new thing', 'BREAKING CHANGE: old API removed');
  eq(classifyCommit(p), 'major');
});

// ─── SECTION 3: resolveBump ───────────────────────────────────────────────────

section('resolveBump — overall bump resolution');

test('resolves major when major present', () => {
  eq(resolveBump(['patch', 'minor', 'major']), 'major');
});

test('resolves minor when minor is highest', () => {
  eq(resolveBump(['patch', 'minor', 'unknown']), 'minor');
});

test('resolves patch when only patches', () => {
  eq(resolveBump(['patch', 'patch']), 'patch');
});

test('resolves patch when unknowns present', () => {
  eq(resolveBump(['unknown', 'unknown']), 'patch');
});

test('resolves none for empty array', () => {
  eq(resolveBump([]), 'none');
});

test('resolves major even if just one major among many patches', () => {
  eq(resolveBump(['patch', 'patch', 'patch', 'major', 'patch']), 'major');
});

// ─── SECTION 4: analyze ───────────────────────────────────────────────────────

section('analyze — full commit array analysis');

test('returns none for empty commits', () => {
  const r = analyze([]);
  eq(r.bump, 'none');
  eq(r.summary.total, 0);
});

test('returns none for null input', () => {
  const r = analyze(null);
  eq(r.bump, 'none');
});

test('returns minor for feat commits', () => {
  const commits = [
    { hash: 'abc1234', subject: 'feat: add search', body: '', date: '2024-01-01' },
    { hash: 'def5678', subject: 'fix: fix typo', body: '', date: '2024-01-02' }
  ];
  const r = analyze(commits);
  eq(r.bump, 'minor');
  eq(r.summary.total, 2);
  eq(r.summary.features, 1);
  eq(r.summary.fixes, 1);
});

test('returns major for breaking change commits', () => {
  const commits = [
    { hash: 'abc1234', subject: 'feat!: rewrite API', body: '', date: '2024-01-01' },
    { hash: 'def5678', subject: 'feat: add search', body: '', date: '2024-01-02' }
  ];
  const r = analyze(commits);
  eq(r.bump, 'major');
  eq(r.summary.breaking, 1);
});

test('returns patch for only fix/chore commits', () => {
  const commits = [
    { hash: 'abc1234', subject: 'fix: patch null check', body: '', date: '2024-01-01' },
    { hash: 'def5678', subject: 'chore: update lock file', body: '', date: '2024-01-02' }
  ];
  const r = analyze(commits);
  eq(r.bump, 'patch');
});

test('buckets commits into correct categories', () => {
  const commits = [
    { hash: 'aaa', subject: 'feat!: breaking change', body: '', date: '2024-01-01' },
    { hash: 'bbb', subject: 'feat: new feature', body: '', date: '2024-01-02' },
    { hash: 'ccc', subject: 'fix: bug fix', body: '', date: '2024-01-03' },
    { hash: 'ddd', subject: 'random commit message', body: '', date: '2024-01-04' }
  ];
  const r = analyze(commits);
  eq(r.commits.major.length, 1);
  eq(r.commits.minor.length, 1);
  eq(r.commits.patch.length, 1);
  eq(r.commits.unknown.length, 1);
});

test('detects BREAKING CHANGE in commit body during analyze', () => {
  const commits = [
    {
      hash: 'abc1234',
      subject: 'feat: new auth',
      body: 'BREAKING CHANGE: JWT required now',
      date: '2024-01-01'
    }
  ];
  const r = analyze(commits);
  eq(r.bump, 'major');
  eq(r.summary.breaking, 1);
});

// ─── SECTION 5: parseSemver ───────────────────────────────────────────────────

section('parseSemver — version string parsing');

test('parses 1.2.3', () => {
  const r = parseSemver('1.2.3');
  deepEq({ major: r.major, minor: r.minor, patch: r.patch }, { major: 1, minor: 2, patch: 3 });
});

test('parses v1.2.3 with v prefix', () => {
  const r = parseSemver('v1.2.3');
  deepEq({ major: r.major, minor: r.minor, patch: r.patch }, { major: 1, minor: 2, patch: 3 });
  eq(r.raw, 'v1.2.3');
});

test('parses V1.2.3 with uppercase V prefix', () => {
  const r = parseSemver('V1.2.3');
  deepEq({ major: r.major, minor: r.minor, patch: r.patch }, { major: 1, minor: 2, patch: 3 });
});

test('parses 0.0.1', () => {
  const r = parseSemver('0.0.1');
  deepEq({ major: r.major, minor: r.minor, patch: r.patch }, { major: 0, minor: 0, patch: 1 });
});

test('parses 10.20.30 (multi-digit)', () => {
  const r = parseSemver('10.20.30');
  deepEq({ major: r.major, minor: r.minor, patch: r.patch }, { major: 10, minor: 20, patch: 30 });
});

test('parses 1.2.3-alpha (pre-release stripped)', () => {
  const r = parseSemver('1.2.3-alpha');
  ok(r !== null, 'should parse successfully');
  deepEq({ major: r.major, minor: r.minor, patch: r.patch }, { major: 1, minor: 2, patch: 3 });
});

test('parses 1.2.3-beta.1 (pre-release with dot)', () => {
  const r = parseSemver('1.2.3-beta.1');
  ok(r !== null);
  deepEq({ major: r.major, minor: r.minor, patch: r.patch }, { major: 1, minor: 2, patch: 3 });
});

test('returns null for invalid version string', () => {
  eq(parseSemver('not-a-version'), null);
});

test('returns null for empty string', () => {
  eq(parseSemver(''), null);
});

test('returns null for null input', () => {
  eq(parseSemver(null), null);
});

test('returns null for 1.2 (missing patch)', () => {
  eq(parseSemver('1.2'), null);
});

// ─── SECTION 6: applyBump ────────────────────────────────────────────────────

section('applyBump — version calculation');

test('major bump: 1.2.3 → 2.0.0', () => {
  eq(applyBump('1.2.3', 'major'), '2.0.0');
});

test('minor bump: 1.2.3 → 1.3.0', () => {
  eq(applyBump('1.2.3', 'minor'), '1.3.0');
});

test('patch bump: 1.2.3 → 1.2.4', () => {
  eq(applyBump('1.2.3', 'patch'), '1.2.4');
});

test('none bump: 1.2.3 → 1.2.3', () => {
  eq(applyBump('1.2.3', 'none'), '1.2.3');
});

test('major bump resets minor and patch: 0.5.9 → 1.0.0', () => {
  eq(applyBump('0.5.9', 'major'), '1.0.0');
});

test('minor bump resets patch: 1.2.9 → 1.3.0', () => {
  eq(applyBump('1.2.9', 'minor'), '1.3.0');
});

test('accepts v-prefixed version string', () => {
  eq(applyBump('v1.2.3', 'patch'), '1.2.4');
});

test('accepts parsed semver object as input', () => {
  const parsed = parseSemver('3.1.4');
  eq(applyBump(parsed, 'minor'), '3.2.0');
});

test('handles 0.0.0 → patch → 0.0.1', () => {
  eq(applyBump('0.0.0', 'patch'), '0.0.1');
});

test('throws on unknown bump type', () => {
  let threw = false;
  try {
    applyBump('1.0.0', 'invalid');
  } catch (e) {
    threw = true;
  }
  ok(threw, 'should throw for unknown bump type');
});

test('throws on unparseable version string', () => {
  let threw = false;
  try {
    applyBump('not-a-version', 'patch');
  } catch (e) {
    threw = true;
  }
  ok(threw, 'should throw for unparseable version');
});

// ─── SECTION 7: formatOutput ─────────────────────────────────────────────────

section('formatOutput — output formatting');

test('returns a non-empty string', () => {
  const analysis = analyze([
    { hash: 'abc1234', subject: 'feat: test feature', body: '', date: '2024-01-01' }
  ]);
  const output = formatOutput(analysis, '1.2.3', '1.3.0', { noColor: true });
  ok(typeof output === 'string' && output.length > 0, 'should return non-empty string');
});

test('includes bump type in output', () => {
  const analysis = analyze([
    { hash: 'abc1234', subject: 'feat: test feature', body: '', date: '2024-01-01' }
  ]);
  const output = formatOutput(analysis, '1.2.3', '1.3.0', { noColor: true });
  ok(output.includes('MINOR'), 'should include MINOR in output');
});

test('includes version transition in output', () => {
  const analysis = analyze([
    { hash: 'abc1234', subject: 'fix: patch fix', body: '', date: '2024-01-01' }
  ]);
  const output = formatOutput(analysis, '1.2.3', '1.2.4', { noColor: true });
  ok(output.includes('1.2.3'), 'should include current version');
  ok(output.includes('1.2.4'), 'should include next version');
});

test('includes commit summary counts', () => {
  const analysis = analyze([
    { hash: 'abc1234', subject: 'feat: feature one', body: '', date: '2024-01-01' },
    { hash: 'def5678', subject: 'fix: bug fix', body: '', date: '2024-01-02' }
  ]);
  const output = formatOutput(analysis, '1.0.0', '1.1.0', { noColor: true });
  ok(output.includes('2'), 'should include commit count');
});

test('shows none message when bump is none', () => {
  const analysis = analyze([]);
  const output = formatOutput(analysis, '1.0.0', null, { noColor: true });
  ok(output.includes('none') || output.includes('No version'), 'should mention no bump needed');
});

test('includes fromRef when provided', () => {
  const analysis = analyze([
    { hash: 'abc1234', subject: 'fix: something', body: '', date: '2024-01-01' }
  ]);
  const output = formatOutput(analysis, '1.0.0', '1.0.1', { noColor: true, fromRef: 'v1.0.0' });
  ok(output.includes('v1.0.0'), 'should include fromRef in output');
});

// ─── SECTION 8: parseGitLog ──────────────────────────────────────────────────

section('parseGitLog — raw git log parsing');

test('parses a single commit block', () => {
  const raw = 'abc1234\n2024-01-01T00:00:00Z\nfeat: add feature\n\n---COMMIT---';
  const commits = parseGitLog(raw);
  eq(commits.length, 1);
  eq(commits[0].hash, 'abc1234');
  eq(commits[0].subject, 'feat: add feature');
  eq(commits[0].date, '2024-01-01T00:00:00Z');
});

test('parses multiple commit blocks', () => {
  const raw = [
    'abc1234\n2024-01-01T00:00:00Z\nfeat: first\n\n---COMMIT---',
    'def5678\n2024-01-02T00:00:00Z\nfix: second\nbody text\n---COMMIT---'
  ].join('\n');
  const commits = parseGitLog(raw);
  eq(commits.length, 2);
  eq(commits[0].hash, 'abc1234');
  eq(commits[1].hash, 'def5678');
  eq(commits[1].body, 'body text');
});

test('returns empty array for empty input', () => {
  const commits = parseGitLog('');
  eq(commits.length, 0);
});

test('returns empty array for null input', () => {
  const commits = parseGitLog(null);
  eq(commits.length, 0);
});

test('skips incomplete commit blocks', () => {
  const raw = '---COMMIT---\n\n---COMMIT---';
  const commits = parseGitLog(raw);
  eq(commits.length, 0);
});

// ─── SECTION 9: CLI argument parsing (logic tests) ───────────────────────────

section('CLI argument parsing — logic unit tests');

// We test the parseArgs logic by extracting it inline
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    from: null,
    since: null,
    json: false,
    dryRun: false,
    noColor: false,
    version: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--from': opts.from = args[++i] || null; break;
      case '--since': opts.since = args[++i] || null; break;
      case '--json': opts.json = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--no-color': opts.noColor = true; break;
      case '--version': case '-v': opts.version = true; break;
      case '--help': case '-h': opts.help = true; break;
      default:
        if (arg.startsWith('--from=')) opts.from = arg.slice(7);
        else if (arg.startsWith('--since=')) opts.since = arg.slice(8);
    }
  }

  return opts;
}

test('--json sets json flag', () => {
  const opts = parseArgs(['node', 'cli', '--json']);
  eq(opts.json, true);
});

test('--dry-run sets dryRun flag', () => {
  const opts = parseArgs(['node', 'cli', '--dry-run']);
  eq(opts.dryRun, true);
});

test('--version sets version flag', () => {
  const opts = parseArgs(['node', 'cli', '--version']);
  eq(opts.version, true);
});

test('-v sets version flag', () => {
  const opts = parseArgs(['node', 'cli', '-v']);
  eq(opts.version, true);
});

test('--help sets help flag', () => {
  const opts = parseArgs(['node', 'cli', '--help']);
  eq(opts.help, true);
});

test('-h sets help flag', () => {
  const opts = parseArgs(['node', 'cli', '-h']);
  eq(opts.help, true);
});

test('--from sets from option', () => {
  const opts = parseArgs(['node', 'cli', '--from', 'v1.2.3']);
  eq(opts.from, 'v1.2.3');
});

test('--from=v1.2.3 sets from option', () => {
  const opts = parseArgs(['node', 'cli', '--from=v1.2.3']);
  eq(opts.from, 'v1.2.3');
});

test('--since sets since option', () => {
  const opts = parseArgs(['node', 'cli', '--since', '2024-01-01']);
  eq(opts.since, '2024-01-01');
});

test('--since=2024-01-01 sets since option', () => {
  const opts = parseArgs(['node', 'cli', '--since=2024-01-01']);
  eq(opts.since, '2024-01-01');
});

test('--no-color sets noColor flag', () => {
  const opts = parseArgs(['node', 'cli', '--no-color']);
  eq(opts.noColor, true);
});

test('no args: all flags default to false/null', () => {
  const opts = parseArgs(['node', 'cli']);
  eq(opts.json, false);
  eq(opts.dryRun, false);
  eq(opts.version, false);
  eq(opts.help, false);
  eq(opts.from, null);
  eq(opts.since, null);
  eq(opts.noColor, false);
});

test('combines multiple flags', () => {
  const opts = parseArgs(['node', 'cli', '--from', 'v2.0.0', '--json']);
  eq(opts.from, 'v2.0.0');
  eq(opts.json, true);
});

// ─── SECTION 10: JSON output format ──────────────────────────────────────────

section('JSON output format validation');

test('analyze result has required fields for JSON serialization', () => {
  const commits = [
    { hash: 'abc1234', subject: 'feat: new feature', body: '', date: '2024-01-01T00:00:00Z' },
    { hash: 'def5678', subject: 'fix: bug fix', body: '', date: '2024-01-02T00:00:00Z' }
  ];
  const r = analyze(commits);

  ok('bump' in r, 'should have bump field');
  ok('commits' in r, 'should have commits field');
  ok('summary' in r, 'should have summary field');
  ok('major' in r.commits, 'commits should have major bucket');
  ok('minor' in r.commits, 'commits should have minor bucket');
  ok('patch' in r.commits, 'commits should have patch bucket');
  ok('unknown' in r.commits, 'commits should have unknown bucket');
  ok('total' in r.summary, 'summary should have total');
  ok('breaking' in r.summary, 'summary should have breaking');
  ok('features' in r.summary, 'summary should have features');
  ok('fixes' in r.summary, 'summary should have fixes');
});

test('JSON output is serializable without error', () => {
  const commits = [
    { hash: 'abc1234', subject: 'feat!: breaking', body: 'BREAKING CHANGE: yep', date: '2024-01-01T00:00:00Z' }
  ];
  const r = analyze(commits);
  let json;
  let threw = false;
  try {
    json = JSON.stringify(r);
  } catch (e) {
    threw = true;
  }
  ok(!threw, 'should serialize without error');
  ok(typeof json === 'string', 'should produce a string');
});

test('JSON output contains correct bump value', () => {
  const commits = [
    { hash: 'abc1234', subject: 'fix: small fix', body: '', date: '2024-01-01T00:00:00Z' }
  ];
  const r = analyze(commits);
  const parsed = JSON.parse(JSON.stringify(r));
  eq(parsed.bump, 'patch');
});

test('summary counts are accurate', () => {
  const commits = [
    { hash: 'a', subject: 'feat!: break it', body: '', date: '2024-01-01' },
    { hash: 'b', subject: 'feat: new thing', body: '', date: '2024-01-01' },
    { hash: 'c', subject: 'feat: another new thing', body: '', date: '2024-01-01' },
    { hash: 'd', subject: 'fix: fix it', body: '', date: '2024-01-01' },
    { hash: 'e', subject: 'chore: update stuff', body: '', date: '2024-01-01' }
  ];
  const r = analyze(commits);
  eq(r.summary.total, 5);
  eq(r.summary.breaking, 1);
  eq(r.summary.features, 2);
  eq(r.summary.fixes, 1);
});

// ─── SECTION 11: Edge cases ───────────────────────────────────────────────────

section('Edge cases and integration');

test('handles single commit repo (no tags)', () => {
  const commits = [
    { hash: 'abc1234', subject: 'feat: initial release', body: '', date: '2024-01-01' }
  ];
  const r = analyze(commits);
  eq(r.bump, 'minor');
  eq(r.summary.total, 1);
});

test('handles very long commit messages', () => {
  const longSubject = 'feat: ' + 'a'.repeat(500);
  const r = parseCommit(longSubject);
  eq(r.type, 'feat');
  ok(r.description.length > 0);
});

test('feat bump takes precedence over patch in mixed commits', () => {
  const commits = [
    { hash: 'a', subject: 'fix: bug', body: '', date: '2024-01-01' },
    { hash: 'b', subject: 'chore: cleanup', body: '', date: '2024-01-01' },
    { hash: 'c', subject: 'feat: new thing', body: '', date: '2024-01-01' }
  ];
  const r = analyze(commits);
  eq(r.bump, 'minor');
});

test('major bump takes precedence over minor in mixed commits', () => {
  const commits = [
    { hash: 'a', subject: 'feat: nice feature', body: '', date: '2024-01-01' },
    { hash: 'b', subject: 'fix!: breaking fix', body: '', date: '2024-01-01' }
  ];
  const r = analyze(commits);
  eq(r.bump, 'major');
});

test('colorizeBump returns uppercase label when noColor=false', () => {
  const label = colorizeBump('minor', false);
  ok(label.includes('MINOR'), 'should include MINOR text');
});

test('colorizeBump with color adds ANSI codes', () => {
  const label = colorizeBump('major', true);
  ok(label.includes('\x1b['), 'should include ANSI escape codes');
  ok(label.includes('MAJOR'), 'should include MAJOR text');
});

test('applyBump with large version numbers', () => {
  eq(applyBump('999.999.999', 'major'), '1000.0.0');
  eq(applyBump('999.999.999', 'minor'), '999.1000.0');
  eq(applyBump('999.999.999', 'patch'), '999.999.1000');
});

test('consecutive patch bumps are additive', () => {
  let version = '1.0.0';
  version = applyBump(version, 'patch');
  version = applyBump(version, 'patch');
  version = applyBump(version, 'patch');
  eq(version, '1.0.3');
});

test('full pipeline: commits → analyze → applyBump', () => {
  const commits = [
    { hash: 'abc', subject: 'feat: new payment provider', body: '', date: '2024-01-01' },
    { hash: 'def', subject: 'fix: handle null user', body: '', date: '2024-01-02' },
    { hash: 'ghi', subject: 'docs: update API reference', body: '', date: '2024-01-03' }
  ];
  const r = analyze(commits);
  eq(r.bump, 'minor');
  const nextVersion = applyBump('2.5.1', r.bump);
  eq(nextVersion, '2.6.0');
});

// ─── Summary ──────────────────────────────────────────────────────────────────

const total = passed + failed;
process.stdout.write('\n' + '─'.repeat(50) + '\n');
process.stdout.write(`Test results: ${passed}/${total} passed`);

if (failed > 0) {
  process.stdout.write(`, ${failed} failed\n`);
  process.stdout.write('\nFailed tests:\n');
  for (const f of failures) {
    process.stdout.write(`  \u2717 ${f.name}\n`);
    process.stdout.write(`    ${f.message}\n`);
  }
  process.exit(1);
} else {
  process.stdout.write(' — All tests passed!\n');
  process.exit(0);
}
