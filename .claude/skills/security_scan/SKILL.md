---
name: security_scan
description: Run dependency audits, SAST scans, and secret detection scans. Return a concise, prioritized security summary. Use when security scanning is requested by the user.
---

# Security Scan Skill

Run security scans to find vulnerabilities, hardcoded secrets, and dependency issues.

## When to Use

Use this skill when:

- User explicitly requests a security scan or audit
- Checking for known vulnerabilities in dependencies
- Looking for hardcoded secrets or credentials in code
- Checking for common code security issues (SAST)

## Dependency Audit

### Node.js

```bash
# Built-in npm audit
npm audit

# More detailed
npm audit --json | python3 -c "
import sys, json
data = json.load(sys.stdin)
vulns = data.get('vulnerabilities', {})
for name, v in vulns.items():
    if v['severity'] in ['critical', 'high']:
        print(f\"[{v['severity'].upper()}] {name}: {v.get('via', [])}\")
"

# Fix automatically
npm audit fix
```

### Python

```bash
# pip-audit (install once: pip install pip-audit)
pip-audit

# Or with safety
pip install safety
safety check
```

### Using osv-scanner

```bash
# Install: https://github.com/google/osv-scanner
osv-scanner scan --format table --all-packages .
```

## SAST Scan

```bash
# Install semgrep: pip install semgrep
semgrep --config=auto --metrics=off .

# OWASP top 10 rules
semgrep --config=p/owasp-top-ten .

# Security-specific scan
semgrep --config=p/security-audit .

# Fast scan with summary
semgrep --config=auto --quiet --metrics=off . 2>&1 | tail -20
```

## Secret Detection

```bash
# truffleHog (recommended, free)
# Install: pip install trufflehog
trufflehog filesystem . --only-verified

# Or detect-secrets (simpler)
# Install: pip install detect-secrets
detect-secrets scan . > .secrets.baseline
detect-secrets audit .secrets.baseline

# Or gitleaks (fast, popular)
# Install: brew install gitleaks
gitleaks detect --source . -v
```

## Quick Scan (all-in-one)

```bash
echo "=== Dependency Audit ===" && npm audit 2>&1 | tail -5
echo ""
echo "=== Secret Detection ===" && gitleaks detect --source . -v 2>&1 | tail -20
echo ""
echo "=== SAST ===" && semgrep --config=auto --quiet --metrics=off . 2>&1 | tail -20
```

## Result Summary Format

After running scans, report findings in priority order:

**Critical/High vulnerabilities** (fix immediately):
- List CVE IDs, affected packages, and fix versions

**Medium vulnerabilities** (fix before production):
- List findings with context

**Low/informational** (review as time permits):
- Brief summary count

## Installing the Tools

```bash
# macOS (Homebrew)
brew install semgrep gitleaks osv-scanner

# Python tools
pip install pip-audit semgrep trufflehog

# Node.js (npm audit is built-in, no install needed)
```

## What to Check First

1. **Known CVEs in dependencies** — `npm audit` or `pip-audit` (fast, high signal)
2. **Hardcoded secrets** — `gitleaks` or `trufflehog` (catches API keys in code)
3. **Code vulnerabilities** — `semgrep` (SQL injection, XSS, insecure patterns)
