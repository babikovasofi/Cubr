# SessionStart hook (Windows): inject the Memory Bank micro-digest into context.
# Bloat guard mirrors inject-memory-bank.sh: index must stay a pointer map.
$ErrorActionPreference = 'SilentlyContinue'
$index = '.memory-bank/index.md'
if (-not (Test-Path $index)) { exit 0 }
# UTF-8 explicitly: PS 5.1 defaults to ANSI and mangles Cyrillic/em-dashes
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$limit = 40
$lines = Get-Content -Encoding UTF8 $index
Write-Output '===== PROJECT MEMORY BANK (auto-injected) ====='
if ($lines.Count -gt $limit) {
    $lines | Select-Object -First $limit | Write-Output
    Write-Output "[index.md exceeds $limit lines - truncated. Shrink it back to a pointer map (max 25 lines); rules: steerings/development-conventions.md.]"
} else {
    $lines | Write-Output
}
Write-Output '===== END MEMORY BANK ====='
