'use strict';

/**
 * git.js
 * Git operations for semver-suggest using only Node.js built-ins.
 * No external dependencies.
 */

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Run a git command and return stdout as a string.
 * Returns null if the command fails.
 *
 * @param {string[]} args - Arguments to pass to git
 * @param {object} [opts]
 * @param {string} [opts.cwd] - Working directory
 * @returns {string|null}
 */
function runGit(args, opts) {
  opts = opts || {};
  const cwd = opts.cwd || process.cwd();

  try {
    const output = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return output;
  } catch (err) {
    return null;
  }
}

/**
 * Check whether the current directory is inside a git repository.
 *
 * @param {string} [cwd]
 * @returns {boolean}
 */
function isGitRepo(cwd) {
  const result = runGit(['rev-parse', '--is-inside-work-tree'], { cwd });
  return result !== null && result.trim() === 'true';
}

/**
 * Get the most recent git tag reachable from HEAD.
 * Returns null if no tags exist.
 *
 * @param {string} [cwd]
 * @returns {string|null}
 */
function getLastTag(cwd) {
  const result = runGit(['describe', '--tags', '--abbrev=0'], { cwd });
  if (result === null) return null;
  return result.trim() || null;
}

/**
 * Get all tags in the repository, most recent first.
 *
 * @param {string} [cwd]
 * @returns {string[]}
 */
function getAllTags(cwd) {
  const result = runGit(['tag', '--sort=-version:refname'], { cwd });
  if (!result) return [];
  return result.split('\n').map(t => t.trim()).filter(Boolean);
}

/**
 * Parse the raw git log output into structured commit objects.
 *
 * The log format uses a custom separator "---COMMIT---" between commits.
 * Each commit block contains:
 *   Line 1: hash
 *   Line 2: subject
 *   Remaining lines: body
 *
 * @param {string} raw - Raw git log output
 * @returns {Array<{ hash: string, subject: string, body: string, date: string }>}
 */
function parseGitLog(raw) {
  if (!raw || !raw.trim()) return [];

  const commits = [];
  const blocks = raw.split('---COMMIT---');

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const lines = trimmed.split('\n');
    const hash = (lines[0] || '').trim();
    const date = (lines[1] || '').trim();
    const subject = (lines[2] || '').trim();
    const body = lines.slice(3).join('\n').trim();

    if (!hash || !subject) continue;

    commits.push({ hash, subject, body, date });
  }

  return commits;
}

/**
 * Get commits since a specific git ref (tag, hash, or date ref).
 *
 * @param {string|null} ref - Git ref to start from (e.g. "v1.2.3"), or null for all commits
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {string} [opts.since] - ISO date string to filter commits by date
 * @returns {Array<{ hash: string, subject: string, body: string, date: string }>}
 */
function getCommitsSince(ref, opts) {
  opts = opts || {};
  const cwd = opts.cwd || process.cwd();

  // Format: hash, then ISO date, then subject, then body, then separator
  const format = '%H%n%aI%n%s%n%b%n---COMMIT---';

  const args = ['log', `--format=${format}`];

  if (opts.since) {
    args.push(`--since=${opts.since}`);
  }

  if (ref) {
    // Commits from ref to HEAD (exclusive of ref itself)
    args.push(`${ref}..HEAD`);
  }

  const result = runGit(args, { cwd });
  if (result === null) return [];

  return parseGitLog(result);
}

/**
 * Get the current version from:
 * 1. The nearest package.json in the working directory (or parents)
 * 2. The most recent git tag that looks like a semver
 * 3. null if neither is found
 *
 * @param {string} [cwd]
 * @returns {string|null}
 */
function getCurrentVersion(cwd) {
  cwd = cwd || process.cwd();

  // Try reading package.json
  const pkgPath = findPackageJson(cwd);
  if (pkgPath) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.version && /^\d+\.\d+\.\d+/.test(pkg.version)) {
        return pkg.version;
      }
    } catch (_) {
      // Fall through
    }
  }

  // Fall back to latest semver-like tag
  const tags = getAllTags(cwd);
  for (const tag of tags) {
    const clean = tag.replace(/^v/i, '');
    if (/^\d+\.\d+\.\d+/.test(clean)) {
      return clean;
    }
  }

  return null;
}

/**
 * Find the nearest package.json by walking up the directory tree.
 *
 * @param {string} dir
 * @returns {string|null}
 */
function findPackageJson(dir) {
  let current = dir;
  const root = path.parse(current).root;

  while (current !== root) {
    const candidate = path.join(current, 'package.json');
    if (fs.existsSync(candidate)) return candidate;
    current = path.dirname(current);
  }

  return null;
}

module.exports = {
  runGit,
  isGitRepo,
  getLastTag,
  getAllTags,
  getCommitsSince,
  getCurrentVersion,
  parseGitLog,
  findPackageJson
};
