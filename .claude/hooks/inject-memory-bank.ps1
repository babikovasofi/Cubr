# SessionStart hook (Windows): print the Memory Bank index into context.
$ErrorActionPreference = 'SilentlyContinue'
$index = '.memory-bank/index.md'
if (-not (Test-Path $index)) { exit 0 }
# UTF-8 explicitly: PS 5.1 defaults to ANSI and mangles Cyrillic/em-dashes
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Write-Output '===== PROJECT MEMORY BANK (auto-injected) ====='
Get-Content -Raw -Encoding UTF8 $index
Write-Output '===== END MEMORY BANK ====='
