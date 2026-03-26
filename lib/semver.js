'use strict';

/**
 * semver.js
 * Version calculation utilities for semver-suggest.
 */

// ANSI color codes for terminal output
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  white: '\x1b[37m'
};

/**
 * Parse a semver string into its numeric components.
 * Accepts strings with or without a leading "v" prefix.
 * Handles pre-release suffixes like 1.2.3-alpha (strips them).
 *
 * @param {string} versionString
 * @returns {{ major: number, minor: number, patch: number, raw: string } | null}
 */
function parseSemver(versionString) {
  if (!versionString || typeof versionString !== 'string') return null;

  const cleaned = versionString.trim();
  // Strip leading 'v' or 'V'
  const withoutV = cleaned.replace(/^[vV]/, '');

  // Match major.minor.patch with optional pre-release/build metadata
  const re = /^(\d+)\.(\d+)\.(\d+)(?:[-+].+)?$/;
  const match = withoutV.match(re);

  if (!match) return null;

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    raw: cleaned
  };
}

/**
 * Apply a semver bump to a current version.
 *
 * @param {{ major: number, minor: number, patch: number } | string} current
 * @param {'major'|'minor'|'patch'|'none'} bump
 * @returns {string} The next version string (without 'v' prefix)
 */
function applyBump(current, bump) {
  let parsed;

  if (typeof current === 'string') {
    parsed = parseSemver(current);
    if (!parsed) {
      throw new Error(`Cannot parse version string: "${current}"`);
    }
  } else {
    parsed = current;
  }

  let { major, minor, patch } = parsed;

  switch (bump) {
    case 'major':
      major += 1;
      minor = 0;
      patch = 0;
      break;
    case 'minor':
      minor += 1;
      patch = 0;
      break;
    case 'patch':
      patch += 1;
      break;
    case 'none':
      // No change
      break;
    default:
      throw new Error(`Unknown bump type: "${bump}"`);
  }

  return `${major}.${minor}.${patch}`;
}

/**
 * Colorize a bump label for terminal output.
 *
 * @param {'major'|'minor'|'patch'|'none'} bump
 * @param {boolean} [useColor=true]
 * @returns {string}
 */
function colorizeBump(bump, useColor) {
  if (useColor === false) return bump.toUpperCase();

  const map = {
    major: COLORS.red + COLORS.bold + 'MAJOR' + COLORS.reset,
    minor: COLORS.yellow + COLORS.bold + 'MINOR' + COLORS.reset,
    patch: COLORS.green + COLORS.bold + 'PATCH' + COLORS.reset,
    none: COLORS.dim + 'NONE' + COLORS.reset
  };

  return map[bump] || bump.toUpperCase();
}

/**
 * Format a human-readable analysis output string.
 *
 * @param {object} analysis - Result from analyzer.analyze()
 * @param {string|null} currentVersion - Current version string (e.g. "1.2.3")
 * @param {string|null} nextVersion - Computed next version string (e.g. "1.3.0")
 * @param {object} [opts]
 * @param {boolean} [opts.noColor] - Disable ANSI colors
 * @param {string|null} [opts.fromRef] - The git ref used as the start point
 * @returns {string}
 */
function formatOutput(analysis, currentVersion, nextVersion, opts) {
  opts = opts || {};
  const noColor = opts.noColor || false;
  const fromRef = opts.fromRef || null;

  const c = noColor
    ? { reset: '', bold: '', green: '', yellow: '', red: '', cyan: '', dim: '', white: '' }
    : COLORS;

  const lines = [];

  lines.push('');
  lines.push(`${c.bold}semver-suggest${c.reset} — Conventional Commits Analyzer`);
  lines.push(c.dim + '─'.repeat(50) + c.reset);

  if (fromRef) {
    lines.push(`${c.dim}Analyzing commits since: ${fromRef}${c.reset}`);
  }

  lines.push('');

  // Summary line
  const { total, breaking, features, fixes } = analysis.summary;
  lines.push(
    `${c.cyan}Commits analyzed:${c.reset} ${total}  ` +
    `${c.red}Breaking: ${breaking}${c.reset}  ` +
    `${c.yellow}Features: ${features}${c.reset}  ` +
    `${c.green}Fixes: ${fixes}${c.reset}`
  );

  lines.push('');

  // Bump recommendation
  const bumpLabel = colorizeBump(analysis.bump, !noColor);
  lines.push(`${c.bold}Recommended bump:${c.reset} ${bumpLabel}`);

  if (currentVersion && nextVersion && analysis.bump !== 'none') {
    lines.push(
      `${c.bold}Version:${c.reset} ${c.dim}${currentVersion}${c.reset} → ${c.bold}${c.green}${nextVersion}${c.reset}`
    );
  } else if (analysis.bump === 'none') {
    lines.push(`${c.dim}No version bump needed — no qualifying commits found.${c.reset}`);
  }

  // Breaking changes section
  if (analysis.commits.major.length > 0) {
    lines.push('');
    lines.push(`${c.red}${c.bold}Breaking Changes (MAJOR):${c.reset}`);
    for (const commit of analysis.commits.major) {
      lines.push(`  ${c.red}✖${c.reset} ${commit.subject} ${c.dim}(${commit.hash.slice(0, 7)})${c.reset}`);
    }
  }

  // Features section
  if (analysis.commits.minor.length > 0) {
    lines.push('');
    lines.push(`${c.yellow}${c.bold}New Features (MINOR):${c.reset}`);
    for (const commit of analysis.commits.minor) {
      lines.push(`  ${c.yellow}●${c.reset} ${commit.subject} ${c.dim}(${commit.hash.slice(0, 7)})${c.reset}`);
    }
  }

  // Patch fixes section
  if (analysis.commits.patch.length > 0) {
    lines.push('');
    lines.push(`${c.green}${c.bold}Fixes & Other Changes (PATCH):${c.reset}`);
    for (const commit of analysis.commits.patch) {
      lines.push(`  ${c.green}·${c.reset} ${commit.subject} ${c.dim}(${commit.hash.slice(0, 7)})${c.reset}`);
    }
  }

  // Unknown commits
  if (analysis.commits.unknown.length > 0) {
    lines.push('');
    lines.push(`${c.dim}${c.bold}Other Commits (non-conventional → treated as PATCH):${c.reset}`);
    for (const commit of analysis.commits.unknown) {
      lines.push(`  ${c.dim}? ${commit.subject} (${commit.hash.slice(0, 7)})${c.reset}`);
    }
  }

  lines.push('');

  return lines.join('\n');
}

module.exports = { parseSemver, applyBump, formatOutput, colorizeBump, COLORS };
