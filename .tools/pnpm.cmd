@echo off
node "%~dp0pnpm-pkg\package\bin\pnpm.cjs" --config.manage-package-manager-versions=false %*
