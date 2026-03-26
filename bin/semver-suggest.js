#!/usr/bin/env node
'use strict';

/**
 * bin/semver-suggest.js
 * CLI entry point for semver-suggest.
 *
 * Usage:
 *   semver-suggest                    Analyze commits from last tag to HEAD
 *   semver-suggest --from v1.2.3      Analyze from a specific tag/ref
 *   semver-suggest --since 2024-01-01 Analyze since a date
 *   semver-suggest --json             Output JSON for CI integration
 *   semver-suggest --dry-run          Show what next version would be
 *   semver-suggest --no-color         Disable ANSI colors
 *   semver-suggest --version          Show package version
 *   semver-suggest --help             Show usage
 */

const path = require('path');
const fs = require('fs');

// Resolve paths relative to bin directory
const rootDir = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

const { suggest, formatOutput } = require('../lib/index');
const { parseSemver, applyBump } = require('../lib/semver');

// ─── Argument parsing ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2); // strip 'node' and script path
  const opts = {
    from: null,
    since: null,
    json: false,
    dryRun: false,
    noColor: false,
    version: false,
    help: false,
    cwd: process.cwd()
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--from':
        opts.from = args[++i] || null;
        break;
      case '--since':
        opts.since = args[++i] || null;
        break;
      case '--json':
        opts.json = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--no-color':
        opts.noColor = true;
        break;
      case '--version':
      case '-v':
        opts.version = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        // Allow --from=v1.2.3 syntax
        if (arg.startsWith('--from=')) {
          opts.from = arg.slice('--from='.length);
        } else if (arg.startsWith('--since=')) {
          opts.since = arg.slice('--since='.length);
        } else {
          process.stderr.write(`Unknown argument: ${arg}\n`);
          process.exit(1);
        }
    }
  }

  return opts;
}

// ─── Help text ───────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
semver-suggest v${pkg.version}
Analyze git commit history and suggest the next semantic version bump.

USAGE
  semver-suggest [options]

OPTIONS
  (no args)              Analyze commits from last tag to HEAD
  --from <ref>           Start analysis from a specific git tag or ref
                         Example: --from v1.2.3
  --since <date>         Analyze commits since an ISO date
                         Example: --since 2024-01-01
  --json                 Output JSON (for CI/scripting)
  --dry-run              Show current version → suggested next version
  --no-color             Disable ANSI color output
  --version, -v          Print semver-suggest version
  --help, -h             Show this help message

EXAMPLES
  # Analyze since last tag
  semver-suggest

  # Analyze from a specific tag
  semver-suggest --from v2.0.0

  # Analyze since January 1st 2024
  semver-suggest --since 2024-01-01

  # Get JSON output for CI
  semver-suggest --json

  # Preview version bump without making changes
  semver-suggest --dry-run

CONVENTIONAL COMMIT TYPES
  feat!: / BREAKING CHANGE  →  MAJOR bump
  feat:                     →  MINOR bump
  fix:, chore:, docs:, etc  →  PATCH bump

PROGRAMMATIC API
  const { suggest, analyze, parseCommit } = require('semver-suggest');
  const result = suggest({ cwd: '/path/to/repo' });

MORE INFO
  https://github.com/yonderzenith/semver-suggest
`;
  process.stdout.write(help + '\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv);

  if (opts.version) {
    process.stdout.write(`${pkg.version}\n`);
    process.exit(0);
  }

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  // Run analysis
  const result = suggest({
    cwd: opts.cwd,
    from: opts.from,
    since: opts.since,
    autoFrom: !opts.from && !opts.since
  });

  // Handle not-a-git-repo
  if (!result.isGitRepo) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({
        error: 'Not a git repository',
        bump: null,
        currentVersion: null,
        nextVersion: null
      }, null, 2) + '\n');
      process.exit(1);
    } else {
      process.stderr.write('\nERROR: Not a git repository (or no .git directory found).\n');
      process.stderr.write('Run semver-suggest from inside a git repository.\n\n');
      process.exit(1);
    }
  }

  const { analysis, currentVersion, nextVersion, fromRef } = result;

  // ─── JSON output ────────────────────────────────────────────────────────
  if (opts.json) {
    const jsonOutput = {
      bump: analysis.bump,
      currentVersion: currentVersion || null,
      nextVersion: nextVersion || null,
      fromRef: fromRef || null,
      summary: analysis.summary,
      commits: {
        major: analysis.commits.major.map(c => ({
          hash: c.hash,
          subject: c.subject,
          date: c.date,
          breaking: c.parsed ? c.parsed.breaking : false
        })),
        minor: analysis.commits.minor.map(c => ({
          hash: c.hash,
          subject: c.subject,
          date: c.date,
          type: c.parsed ? c.parsed.type : 'unknown'
        })),
        patch: analysis.commits.patch.map(c => ({
          hash: c.hash,
          subject: c.subject,
          date: c.date,
          type: c.parsed ? c.parsed.type : 'unknown'
        })),
        unknown: analysis.commits.unknown.map(c => ({
          hash: c.hash,
          subject: c.subject,
          date: c.date
        }))
      }
    };
    process.stdout.write(JSON.stringify(jsonOutput, null, 2) + '\n');
    process.exit(0);
  }

  // ─── Dry run output ─────────────────────────────────────────────────────
  if (opts.dryRun) {
    const noColor = opts.noColor || !process.stdout.isTTY;
    const { COLORS } = require('../lib/semver');
    const c = noColor ? { reset: '', bold: '', green: '', yellow: '', red: '', dim: '' } : COLORS;

    if (analysis.bump === 'none') {
      process.stdout.write(`\n${c.dim}No version bump needed.${c.reset}\n\n`);
    } else if (currentVersion && nextVersion) {
      process.stdout.write(
        `\n${c.bold}Dry run:${c.reset} ` +
        `${c.dim}${currentVersion}${c.reset} → ` +
        `${c.bold}${c.green}${nextVersion}${c.reset} ` +
        `(${c.bold}${analysis.bump.toUpperCase()}${c.reset})\n\n`
      );
    } else if (nextVersion) {
      process.stdout.write(
        `\n${c.bold}Dry run:${c.reset} suggested next version: ` +
        `${c.bold}${c.green}${nextVersion}${c.reset} ` +
        `(${c.bold}${analysis.bump.toUpperCase()}${c.reset})\n\n`
      );
    } else {
      process.stdout.write(
        `\n${c.bold}Recommended bump:${c.reset} ${analysis.bump.toUpperCase()}\n` +
        `${c.dim}(Could not determine current version to compute next version)${c.reset}\n\n`
      );
    }
    process.exit(0);
  }

  // ─── Full formatted output ───────────────────────────────────────────────
  const noColor = opts.noColor || !process.stdout.isTTY;
  const output = formatOutput(analysis, currentVersion, nextVersion, {
    noColor,
    fromRef
  });

  process.stdout.write(output);
  process.exit(0);
}

main();
