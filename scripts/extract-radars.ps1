# Exports radar images and overview files from your own CS2 install into the
# CerlockCS map folder. Needs Source2Viewer-CLI.exe:
#   https://github.com/ValveResourceFormat/ValveResourceFormat/releases
#
# Usage:
#   .\scripts\extract-radars.ps1 -Cs2 "C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive"
param(
  [Parameter(Mandatory = $true)][string]$Cs2,
  [string]$Out = (Join-Path $HOME ".cerlock\maps"),
  [string]$Cli = "Source2Viewer-CLI.exe"
)
$ErrorActionPreference = "Stop"

$vpk = Join-Path $Cs2 "game\csgo\pak01_dir.vpk"
if (-not (Test-Path $vpk)) { throw "could not find $vpk" }

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("cerlock-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Write-Host "exporting radar images..."
  & $Cli -i $vpk -o $tmp --vpk_filepath "panorama/images/overheadmaps/" -d | Out-Null
  Write-Host "exporting overview files..."
  & $Cli -i $vpk -o $tmp --vpk_filepath "resource/overviews/" | Out-Null

  New-Item -ItemType Directory -Force -Path $Out | Out-Null
  Get-ChildItem $tmp -Recurse -Filter "*_radar_psd.png" | Copy-Item -Destination $Out
  Get-ChildItem $tmp -Recurse -Filter "*.txt" | Where-Object { $_.DirectoryName -like "*overviews*" } | Copy-Item -Destination $Out
  Write-Host "done, files are in $Out"
}
finally {
  Remove-Item -Recurse -Force $tmp
}
