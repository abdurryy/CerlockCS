# Exports the weapon and equipment icons from your own CS2 install into the
# CerlockCS icon folder. Needs Source2Viewer-CLI.exe:
#   https://github.com/ValveResourceFormat/ValveResourceFormat/releases
#
# Usage:
#   .\scripts\extract-icons.ps1 -Cs2 "C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive"
param(
  [Parameter(Mandatory = $true)][string]$Cs2,
  [string]$Out = (Join-Path $HOME ".cerlock\icons"),
  [string]$Cli = "Source2Viewer-CLI.exe"
)
$ErrorActionPreference = "Stop"

$vpk = Join-Path $Cs2 "game\csgo\pak01_dir.vpk"
if (-not (Test-Path $vpk)) { throw "could not find $vpk" }

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("cerlock-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Write-Host "exporting equipment icons..."
  & $Cli -i $vpk -o $tmp --vpk_filepath "panorama/images/icons/equipment/" -d | Out-Null

  $weapons = Join-Path $Out "weapon"
  New-Item -ItemType Directory -Force -Path $weapons | Out-Null
  Get-ChildItem $tmp -Recurse -Filter "*.svg" | Where-Object { $_.DirectoryName -like "*equipment*" } | Copy-Item -Destination $weapons
  Write-Host "done, icons are in $weapons"
}
finally {
  Remove-Item -Recurse -Force $tmp
}
