---
name: package-management
description: Install and manage language packages and system dependencies. Use instead of suggesting the user run install commands manually.
---

# Package Management Skill

Manage project dependencies using standard package managers via the Bash tool.

## When to Use

Use this skill when you need to:

- Install language-specific packages (npm, pip, cargo, go, etc.)
- Install system-level dependencies (ffmpeg, jq, imagemagick, etc.)
- Remove packages from the project
- Check what's installed

## When NOT to Use

- Searching for available packages (use WebSearch instead)
- Configuring package settings (edit config files directly)

## How It Works Locally

All package management happens via the Bash tool using standard CLI tools.

## Node.js / npm / bun

```bash
# Install packages
npm install express lodash
npm install --save-dev typescript @types/node eslint

# Install a specific version
npm install react@18.2.0

# Remove packages
npm uninstall lodash

# Install all from package.json
npm install

# Using bun (faster alternative)
bun add express lodash
bun add -d typescript
bun remove lodash
```

## Python / pip

```bash
# Install packages
pip install flask requests sqlalchemy

# Install with version pin
pip install "flask==3.0.0"

# Install from requirements.txt
pip install -r requirements.txt

# Save current packages to requirements.txt
pip freeze > requirements.txt

# Remove packages
pip uninstall flask -y

# Using pip3 explicitly
pip3 install flask
```

## Rust / cargo

```bash
# Add a dependency (updates Cargo.toml)
cargo add serde tokio

# Add with features
cargo add tokio --features full

# Remove a dependency
cargo remove serde

# Build after adding dependencies
cargo build
```

## Go

```bash
# Add a dependency
go get github.com/gin-gonic/gin

# Tidy (remove unused deps)
go mod tidy

# Download all dependencies
go mod download
```

## System Dependencies (macOS)

```bash
# Homebrew (macOS equivalent of apt/nix)
brew install ffmpeg
brew install imagemagick
brew install jq
brew install postgresql

# Check if installed
which ffmpeg || echo "ffmpeg not installed"
```

## System Dependencies (Linux/Ubuntu)

```bash
apt-get update && apt-get install -y ffmpeg imagemagick jq
```

## Checking What's Installed

```bash
# Node.js packages (top-level)
npm ls --depth=0

# Python packages
pip list

# System tools
which ffmpeg jq imagemagick 2>&1
```

## Best Practices

1. **Prefer project package managers**: npm/pip over system installs for project deps
2. **Pin versions in production**: Use exact versions in requirements.txt / package.json
3. **Use lockfiles**: Commit package-lock.json, yarn.lock, or poetry.lock
4. **Check before installing**: Verify package name spelling on npm/PyPI first
5. **Update .gitignore**: Add `node_modules/`, `__pycache__/`, `venv/` as needed

## Virtual Environments (Python)

Always use a virtual environment for Python projects:

```bash
# Create venv
python3 -m venv venv

# Activate (macOS/Linux)
source venv/bin/activate

# Install packages inside venv
pip install flask

# Deactivate
deactivate
```

Or use `uv` (modern fast alternative):

```bash
uv venv
source .venv/bin/activate
uv pip install flask
```
