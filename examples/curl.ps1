# Example: generate a CADO KMZ via PowerShell

$body = Get-Content -Path "examples\request.json" -Raw

Invoke-WebRequest `
  -Uri "http://localhost:3000/api/kmz/cado" `
  -Method POST `
  -ContentType "application/json" `
  -Body $body `
  -OutFile "mission-paris.kmz"

Write-Host "KMZ saved to mission-paris.kmz"
Get-Item mission-paris.kmz | Select-Object Name, Length
