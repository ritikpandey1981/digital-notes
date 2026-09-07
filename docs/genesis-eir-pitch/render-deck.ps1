# Renders every slide of the generated deck to PNG via PowerPoint COM, so the
# layout can be inspected for overflow, clipping and misalignment.
#
# Usage:  powershell -File render-deck.ps1 [-Out <directory>]

param([string]$Out = "$PSScriptRoot\render")

$deck = Join-Path $PSScriptRoot "Folio_GENESIS_EIR_Cohort3_Pitch_Deck.pptx"
if (-not (Test-Path $deck)) { throw "Deck not found. Run: node build-deck.mjs" }

if (Test-Path $Out) { Remove-Item $Out -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Out | Out-Null

$ppt = New-Object -ComObject PowerPoint.Application
$pres = $ppt.Presentations.Open($deck, $true, $false, $false)
foreach ($s in $pres.Slides) {
  $n = "{0:D2}" -f $s.SlideIndex
  $s.Export("$Out\slide-$n.png", "PNG", 1600, 900)
}
"Exported $($pres.Slides.Count) slides to $Out"
$pres.Close()
$ppt.Quit()
