'use strict';

/**
 * analyzer.js
 * Core commit analysis logic for semver-suggest.
 * Parses Conventional Commits and determines the appropriate semver bump level.
 */

/**
 * Parse a single commit message into its components.
 * Handles conventional commit format: <type>[optional scope][!]: <description>
 *
 * @param {string} subject - The commit subject line
 * @param {string} [body] - The commit body/footer (for BREAKING CHANGE detection)
 * @returns {{ type: string, scope: string|null, breaking: boolean, description: string, raw: string }}
 */
function parseCommit(subject, body) {
  subject = (subject || '').trim();
  body = (body || '').trim();

  const result = {
    type: 'unknown',
    scope: null,
    breaking: false,
    description: subject,
    raw: subject
  };

  // Detect BREAKING CHANGE in body/footer regardless of subject format
  if (body && /BREAKING[- ]CHANGE\s*[:!]/i.test(body)) {
    result.breaking = true;
  }
  if (/BREAKING[- ]CHANGE\s*[:!]/i.test(subject)) {
    result.breaking = true;
  }

  // Match conventional commit format:
  // type(scope)!: description
  // type(scope): description
  // type!: description
  // type: description
  const conventionalRe = /^([a-zA-Z][a-zA-Z0-9_-]*)(?:\(([^)]*)\))?(!)?:\s*(.*)$/;
  const match = subject.match(conventionalRe);

  if (match) {
    result.type = match[1].toLowerCase();
    result.scope = match[2] || null;
    if (match[3] === '!') {
      result.breaking = true;
    }
    result.description = match[4] || '';
  }

  return result;
}

/**
 * Classify a parsed commit into a bump category.
 *
 * @param {{ type: string, breaking: boolean }} parsed
 * @returns {'major'|'minor'|'patch'|'unknown'}
 */
function classifyCommit(parsed) {
  if (parsed.breaking) return 'major';

  const type = parsed.type.toLowerCase();

  const minorTypes = new Set(['feat', 'feature']);
  const patchTypes = new Set([
    'fix', 'bugfix', 'hotfix',
    'chore', 'docs', 'style', 'refactor',
    'test', 'tests', 'perf', 'build', 'ci', 'revert'
  ]);

  if (minorTypes.has(type)) return 'minor';
  if (patchTypes.has(type)) return 'patch';

  // Unknown type — conservative default: patch
  return 'unknown';
}

/**
 * Determine the overall bump level from a list of classifications.
 * Precedence: major > minor > patch > none
 *
 * @param {string[]} classifications
 * @returns {'major'|'minor'|'patch'|'none'}
 */
function resolveBump(classifications) {
  if (classifications.includes('major')) return 'major';
  if (classifications.includes('minor')) return 'minor';
  if (classifications.includes('patch') || classifications.includes('unknown')) return 'patch';
  return 'none';
}

/**
 * Analyze an array of raw commit objects and produce a full analysis result.
 *
 * @param {Array<{ hash: string, subject: string, body: string, date: string }>} rawCommits
 * @returns {{
 *   bump: 'major'|'minor'|'patch'|'none',
 *   commits: { major: Array, minor: Array, patch: Array, unknown: Array },
 *   summary: { total: number, breaking: number, features: number, fixes: number }
 * }}
 */
function analyze(rawCommits) {
  if (!rawCommits || rawCommits.length === 0) {
    return {
      bump: 'none',
      commits: { major: [], minor: [], patch: [], unknown: [] },
      summary: { total: 0, breaking: 0, features: 0, fixes: 0 }
    };
  }

  const buckets = { major: [], minor: [], patch: [], unknown: [] };
  const classifications = [];

  for (const commit of rawCommits) {
    const parsed = parseCommit(commit.subject, commit.body);
    const category = classifyCommit(parsed);
    classifications.push(category);

    const enriched = {
      hash: commit.hash,
      subject: commit.subject,
      body: commit.body,
      date: commit.date,
      parsed
    };

    buckets[category].push(enriched);
  }

  const bump = resolveBump(classifications);

  // Build summary counts
  const breaking = rawCommits.filter((c) => {
    const p = parseCommit(c.subject, c.body);
    return p.breaking;
  }).length;

  const features = rawCommits.filter((c) => {
    const p = parseCommit(c.subject, c.body);
    return (p.type === 'feat' || p.type === 'feature') && !p.breaking;
  }).length;

  const fixes = rawCommits.filter((c) => {
    const p = parseCommit(c.subject, c.body);
    return ['fix', 'bugfix', 'hotfix'].includes(p.type) && !p.breaking;
  }).length;

  return {
    bump,
    commits: buckets,
    summary: {
      total: rawCommits.length,
      breaking,
      features,
      fixes
    }
  };
}

module.exports = { parseCommit, classifyCommit, resolveBump, analyze };
