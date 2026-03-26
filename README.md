# semver-suggest

> Analyze your git commit history and get an instant, confident answer to *"what version should I bump to next?"*

[![npm version](https://img.shields.io/npm/v/semver-suggest.svg)](https://www.npmjs.com/package/semver-suggest)
[![license](https://img.shields.io/npm/l/semver-suggest.svg)](LICENSE)
[![node](https://img.shields.io/node/v/semver-suggest.svg)](https://nodejs.org)

---

## The Problem

Every release cycle you face the same question: *is this a major, minor, or patch release?* You check the git log, squint at a dozen commit messages, and make your best guess. That guess is often wrong, either too conservative (shipping features as patches) or too risky (calling a breaking change a minor bump).

**semver-suggest** reads your git commit history, applies the [Conventional Commits](https://www.conventionalcommits.org/) specification, and tells you exactly what to bump — with zero configuration.

---

## Installation

```bash
npm install -g semver-suggest
```

Or use it in a project without installing globally:

```bash
npx semver-suggest
```

---

## Quick Start

```bash
# From inside any git repo with Conventional Commits:
$ semver-suggest

semver-suggest — Conventional Commits Analyzer
──────────────────────────────────────────────────
Analyzing commits since: v1.2.3

Commits analyzed: 8  Breaking: 0  Features: 2  Fixes: 3

Recommended bump: MINOR
Version: 1.2.3 → 1.3.0
```

---

## Usage

### Analyze since last tag (default)

```bash
semver-suggest
```

Automatically finds the most recent git tag and analyzes everything from that tag to `HEAD`.

### Analyze from a specific tag or ref

```bash
semver-suggest --from v2.0.0
semver-suggest --from abc1234   # any git ref works
```

### Analyze since a date

```bash
semver-suggest --since 2024-01-01
semver-suggest --since "2024-06-15T00:00:00Z"
```

### Dry run — preview next version number

```bash
semver-suggest --dry-run
# Dry run: 1.2.3 → 1.3.0 (MINOR)
```

### JSON output for CI/scripting

```bash
semver-suggest --json
```

```json
{
  "bump": "minor",
  "currentVersion": "1.2.3",
  "nextVersion": "1.3.0",
  "fromRef": "v1.2.3",
  "summary": {
    "total": 8,
    "breaking": 0,
    "features": 2,
    "fixes": 3
  },
  "commits": {
    "major": [],
    "minor": [...],
    "patch": [...],
    "unknown": [...]
  }
}
```

### Disable colors

```bash
semver-suggest --no-color
```

### Show version

```bash
semver-suggest --version
semver-suggest -v
```

### Help

```bash
semver-suggest --help
```

---

## Conventional Commits Reference

`semver-suggest` follows the [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) specification.

| Commit format | Example | Bump |
|---|---|---|
| `feat!:` | `feat!: remove v1 API` | **MAJOR** |
| `fix!:` | `fix!: change error format` | **MAJOR** |
| `<any>!:` | `chore!: drop Node 12` | **MAJOR** |
| `BREAKING CHANGE:` in footer | | **MAJOR** |
| `feat:` | `feat: add dark mode` | **MINOR** |
| `feature:` | `feature: new dashboard` | **MINOR** |
| `fix:` | `fix: null pointer on login` | PATCH |
| `bugfix:` | `bugfix: race condition` | PATCH |
| `hotfix:` | `hotfix: security patch` | PATCH |
| `chore:` | `chore: update deps` | PATCH |
| `docs:` | `docs: update README` | PATCH |
| `style:` | `style: run prettier` | PATCH |
| `refactor:` | `refactor: extract auth module` | PATCH |
| `test:` | `test: add coverage for parser` | PATCH |
| `perf:` | `perf: optimize query` | PATCH |
| `build:` | `build: upgrade webpack` | PATCH |
| `ci:` | `ci: add GitHub Actions` | PATCH |
| `revert:` | `revert: revert feat: dark mode` | PATCH |
| Non-conventional | `updated login page` | PATCH (conservative) |

**Precedence rule:** `MAJOR` > `MINOR` > `PATCH` > `none`. One breaking change in a release makes the whole release a MAJOR bump.

**Scoped commits are fully supported:**
- `feat(auth): add OAuth2` → MINOR
- `fix(api)!: change response format` → MAJOR

---

## CI/CD Integration

### GitHub Actions

Automatically suggest the version and use it in your release workflow:

```yaml
name: Release

on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # needed for full tag history

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install semver-suggest
        run: npm install -g semver-suggest

      - name: Get suggested version
        id: version
        run: |
          NEXT=$(semver-suggest --json | jq -r '.nextVersion')
          echo "next=$NEXT" >> $GITHUB_OUTPUT

      - name: Create release
        if: steps.version.outputs.next != 'null'
        run: |
          git tag v${{ steps.version.outputs.next }}
          git push origin v${{ steps.version.outputs.next }}
```

### Fail CI if bump type is unexpected

```yaml
- name: Check for breaking changes
  run: |
    BUMP=$(semver-suggest --json | jq -r '.bump')
    if [ "$BUMP" = "major" ]; then
      echo "Breaking changes detected — manual review required"
      exit 1
    fi
```

### GitLab CI

```yaml
suggest-version:
  stage: prepare
  script:
    - npm install -g semver-suggest
    - export NEXT_VERSION=$(semver-suggest --json | python3 -c "import sys,json; print(json.load(sys.stdin)['nextVersion'])")
    - echo "NEXT_VERSION=$NEXT_VERSION" >> build.env
  artifacts:
    reports:
      dotenv: build.env
```

---

## Programmatic API

`semver-suggest` exposes a clean Node.js API with zero dependencies.

### `suggest(opts)` — full analysis

```javascript
const { suggest } = require('semver-suggest');

const result = suggest({
  cwd: '/path/to/repo',     // default: process.cwd()
  from: 'v1.2.3',           // optional: start ref
  since: '2024-01-01',      // optional: date filter
  autoFrom: true            // default: auto-detect last tag
});

console.log(result.bump);          // 'major' | 'minor' | 'patch' | 'none'
console.log(result.currentVersion); // '1.2.3'
console.log(result.nextVersion);    // '1.3.0'
console.log(result.fromRef);        // 'v1.2.3'
console.log(result.isGitRepo);      // true
console.log(result.analysis.summary);
// { total: 8, breaking: 0, features: 2, fixes: 3 }
```

### `analyze(commits)` — analyze commit objects

```javascript
const { analyze } = require('semver-suggest');

const commits = [
  { hash: 'abc1234', subject: 'feat: new dashboard', body: '', date: '2024-01-01' },
  { hash: 'def5678', subject: 'fix: null check', body: '', date: '2024-01-02' },
  { hash: 'ghi9012', subject: 'feat!: rewrite API', body: '', date: '2024-01-03' }
];

const result = analyze(commits);
console.log(result.bump);         // 'major'
console.log(result.summary);     // { total: 3, breaking: 1, features: 1, fixes: 1 }
console.log(result.commits.major.length); // 1
```

### `parseCommit(subject, body)` — parse a single commit

```javascript
const { parseCommit } = require('semver-suggest');

const parsed = parseCommit('feat(auth)!: remove basic auth', 'BREAKING CHANGE: use JWT');
console.log(parsed.type);      // 'feat'
console.log(parsed.scope);     // 'auth'
console.log(parsed.breaking);  // true
console.log(parsed.description); // 'remove basic auth'
```

### `parseSemver(version)` — parse a version string

```javascript
const { parseSemver } = require('semver-suggest');

const v = parseSemver('v1.2.3-alpha');
console.log(v.major); // 1
console.log(v.minor); // 2
console.log(v.patch); // 3
console.log(v.raw);   // 'v1.2.3-alpha'
```

### `applyBump(current, bump)` — compute next version

```javascript
const { applyBump } = require('semver-suggest');

applyBump('1.2.3', 'major');  // '2.0.0'
applyBump('1.2.3', 'minor');  // '1.3.0'
applyBump('1.2.3', 'patch');  // '1.2.4'
```

---

## How It Compares to semantic-release

| | semver-suggest | semantic-release |
|---|---|---|
| Purpose | Suggest version bump | Fully automate releases |
| Configuration | Zero | Requires plugins + config |
| Dependencies | Zero (built-ins only) | 50+ packages |
| Creates tags/releases | No (you decide) | Yes (automated) |
| Changelog generation | No | Yes (via plugins) |
| CI required | No | Recommended |
| Use case | "What should I bump?" | Full release automation |
| Install size | ~15 KB | ~30 MB |

**semver-suggest** is for developers who want a lightweight, trustworthy recommendation without surrendering control of their release process. If you want full automation, use semantic-release. If you want a fast second opinion, use semver-suggest.

---

## Zero Dependencies

`semver-suggest` uses only Node.js built-in modules:

- `child_process` — runs `git log` commands
- `fs` — reads `package.json`
- `path` — resolves file paths
- `assert` — powers the test suite

No `npm install` required after the initial install. No supply chain risk. No version conflicts.

---

## Requirements

- Node.js >= 14
- Git installed and accessible in `PATH`
- A git repository with at least one commit

---

## Contributing

Contributions are welcome. Please:

1. Fork the repository
2. Write your changes with tests
3. Ensure `npm test` passes (115 tests, 0 failures)
4. Follow Conventional Commits for your commit messages (dogfood it!)
5. Open a pull request

```bash
git clone https://github.com/yonderzenith/semver-suggest
cd semver-suggest
npm test
```

---

## Support

- Bug reports: [GitHub Issues](https://github.com/yonderzenith/semver-suggest/issues)
- Sponsor this project: [GitHub Sponsors](https://github.com/sponsors/yonderzenith)
- Buy me a coffee: [buymeacoffee.com/yonderzenith](https://buymeacoffee.com/yonderzenith)

---

## License

MIT — Copyright (c) 2024 Yonder Zenith LLC

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
