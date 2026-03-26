'use strict';

/**
 * index.js
 * Main programmatic API for semver-suggest.
 * Can be required by other tools: const { analyze, suggest, parseCommit } = require('semver-suggest');
 */

const { analyze: analyzeCommits, parseCommit, classifyCommit } = require('./analyzer');
const { parseSemver, applyBump, formatOutput } = require('./semver');
const { isGitRepo, getLastTag, getCommitsSince, getCurrentVersion } = require('./git');

/**
 * Analyze a list of raw commit objects and return a full analysis result.
 *
 * @param {Array<{ hash: string, subject: string, body: string, date: string }>} commits
 * @returns {{
 *   bump: 'major'|'minor'|'patch'|'none',
 *   commits: { major: Array, minor: Array, patch: Array, unknown: Array },
 *   summary: { total: number, breaking: number, features: number, fixes: number }
 * }}
 */
function analyze(commits) {
  return analyzeCommits(commits);
}

/**
 * High-level suggestion function. Given options, reads git history and returns
 * the analysis plus computed version strings.
 *
 * @param {object} [opts]
 * @param {string} [opts.cwd] - Working directory (defaults to process.cwd())
 * @param {string} [opts.from] - Git ref to start from (e.g. "v1.2.3")
 * @param {string} [opts.since] - ISO date string to filter by
 * @param {boolean} [opts.autoFrom] - If true, auto-detect last tag (default: true)
 * @returns {{
 *   analysis: object,
 *   currentVersion: string|null,
 *   nextVersion: string|null,
 *   fromRef: string|null,
 *   isGitRepo: boolean
 * }}
 */
function suggest(opts) {
  opts = opts || {};
  const cwd = opts.cwd || process.cwd();
  const autoFrom = opts.autoFrom !== false;

  if (!isGitRepo(cwd)) {
    return {
      analysis: analyzeCommits([]),
      currentVersion: null,
      nextVersion: null,
      fromRef: null,
      isGitRepo: false
    };
  }

  let fromRef = opts.from || null;

  // Auto-detect last tag if no explicit ref given
  if (!fromRef && autoFrom) {
    fromRef = getLastTag(cwd);
  }

  const rawCommits = getCommitsSince(fromRef, { cwd, since: opts.since });
  const analysis = analyzeCommits(rawCommits);
  const currentVersion = getCurrentVersion(cwd);

  let nextVersion = null;
  if (currentVersion && analysis.bump !== 'none') {
    const parsed = parseSemver(currentVersion);
    if (parsed) {
      nextVersion = applyBump(parsed, analysis.bump);
    }
  }

  return {
    analysis,
    currentVersion,
    nextVersion,
    fromRef,
    isGitRepo: true
  };
}

module.exports = {
  analyze,
  suggest,
  parseCommit,
  classifyCommit,
  parseSemver,
  applyBump,
  formatOutput
};
