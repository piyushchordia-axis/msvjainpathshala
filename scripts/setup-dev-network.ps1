# One-time dev setup so phones can reach the API on port 8080.
# Run PowerShell as Administrator:
#   cd "D:\Enaa Creations\MSVJainPathshala\msvjainpathshala"
#   .\scripts\setup-dev-network.ps1

$ErrorActionPreference = "Stop"
$ruleName = "Jain Pathshala API 8080"

Write-Host "=== Jain Pathshala dev network setup ===" -ForegroundColor Cyan

$wifi = Get-NetConnectionProfile | Where-Object { $_.InterfaceAlias -like "*Wi-Fi*" } | Select-Object -First 1
if ($wifi) {
  Write-Host ("Wi-Fi network category: " + $wifi.NetworkCategory)
  if ($wifi.NetworkCategory -ne "Private") {
    Set-NetConnectionProfile -InterfaceAlias $wifi.InterfaceAlias -NetworkCategory Private
    Write-Host ("Set " + $wifi.InterfaceAlias + " to Private.") -ForegroundColor Green
  } else {
    Write-Host "Wi-Fi is already Private." -ForegroundColor Green
  }
} else {
  Write-Host "No Wi-Fi profile found." -ForegroundColor Yellow
}

$null = netsh advfirewall firewall show rule name="$ruleName" 2>&1
if ($LASTEXITCODE -eq 0) {
  Write-Host "Firewall rule already exists."
} else {
  netsh advfirewall firewall add rule name="$ruleName" dir=in action=allow protocol=TCP localport=8080 profile=any enable=yes
  if ($LASTEXITCODE -ne 0) { throw "Failed to add firewall rule. Run as Administrator." }
  Write-Host "Added firewall rule for TCP 8080 (all profiles)." -ForegroundColor Green
}

$ip = node (Join-Path $PSScriptRoot "print-lan-ip.mjs")
Write-Host ""
Write-Host "Phone browser test:" -ForegroundColor Cyan
Write-Host ("  http://" + $ip + ":8080/api/healthz")
Write-Host ""
Write-Host ".env:" -ForegroundColor Cyan
Write-Host ("  EXPO_PUBLIC_API_BASE_URL=http://" + $ip + ":8080")
