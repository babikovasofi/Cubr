# PostToolUse hook (Windows): warn when an edited file exceeds the line limit.
$ErrorActionPreference = 'SilentlyContinue'
$limit = if ($env:FILE_LINE_LIMIT) { [int]$env:FILE_LINE_LIMIT } else { 400 }
$raw = [Console]::In.ReadToEnd()
try { $obj = $raw | ConvertFrom-Json } catch { exit 0 }
$path = $obj.tool_input.file_path
if (-not $path -or -not (Test-Path $path)) { exit 0 }
$lines = (Get-Content $path | Measure-Object -Line).Lines
if ($lines -gt $limit) {
  [Console]::Error.WriteLine("WARN: $path = $lines lines (limit $limit). Consider decomposing.")
}
exit 0
